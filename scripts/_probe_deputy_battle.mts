/**
 * 核验：北伐副将进战斗（合成后的 General 能不能真的打，副将主战法在事件流里出不出现）
 * 用法：npx tsx scripts/_probe_deputy_battle.mts
 */
import { buildGeneralForSlot, emptyDeputy, zeroPoints, type DeputySlotLike } from '../web/deputy';
import { SLOTTED_HEROES, buildGeneral } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { mainSkillSlot } from '../src/data/hero-utils';
import { runBattle } from '../src/engine/combat';

/** 配将槽位（结构子集；不引 teamEditor，那个模块会拉进 css） */
const slotOf = (heroId: string, patch: Partial<DeputySlotLike> = {}): DeputySlotLike => ({
  heroId,
  extraSkillIds: [],
  freePoints: zeroPoints(),
  redness: 0,
  level: 40,
  ...patch,
});

const usable = SLOTTED_HEROES.filter((h) => h.mainSkillId && SKILL_REGISTRY[h.mainSkillId]);
// 副将取「主动」主战法（发动频率高，事件流里一眼能看到）
const activeMains = usable.filter((h) => {
  const s = SKILL_REGISTRY[h.mainSkillId!];
  return s && s.type === 'active';
});
const deputyHero = activeMains[0];
const mainHero = usable.find((h) => h.faction === deputyHero.faction && h.id !== deputyHero.id)!;
const deputySkill = deputyHero.mainSkillId!;

const slot = slotOf(mainHero.id, { deputy: emptyDeputy(deputyHero.id) });

const classicG = buildGeneralForSlot(slot, '前锋', 120, 'classic')!;
const beifaG = buildGeneralForSlot(slot, '前锋', 120, 'beifa')!;

console.log('主将', mainHero.name, mainHero.id, '｜副将', deputyHero.name, deputyHero.id, '｜副将主战法', SKILL_REGISTRY[deputySkill].name);
console.log('副将主战法槽位', mainSkillSlot(deputySkill));
console.log('classic 四维', { a: classicG.attack, d: classicG.defense, s: classicG.strategy, v: classicG.speed });
console.log('beifa   四维', { a: beifaG.attack, d: beifaG.defense, s: beifaG.strategy, v: beifaG.speed });
console.log('beifa 该槽数组', (beifaG as any)[mainSkillSlot(deputySkill)!]);

const others = usable.filter((h) => h.id !== mainHero.id && h.id !== deputyHero.id).slice(0, 4);
const mk = (id: string, pos: any, mode: 'classic' | 'beifa') =>
  buildGeneralForSlot(slotOf(id), pos, 120, mode);

const red = [beifaG, mk(others[0].id, '中军', 'beifa'), mk(others[1].id, '大营', 'beifa')];
const blue = [mk(others[2].id, '前锋', 'classic'), mk(others[3].id, '中军', 'classic'), mk(others[0].id, '大营', 'classic')];

let deputyCasts = 0;
let redTotal = 0;
let blueTotal = 0;
let rounds = 0;
for (let seed = 1; seed <= 12; seed++) {
  const rep = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 } as any);
  for (const e of rep.events as any[]) {
    if (e.skillId === deputySkill && (e.type === 'skill_cast' || e.type === 'skill_trigger' || e.type === 'skill_prepare')) deputyCasts++;
    if (e.type === 'damage') {
      if (e.sourceSide === 'red' || e.from === 'red') redTotal += e.amount ?? 0;
      else blueTotal += e.amount ?? 0;
    }
    if (e.type === 'round_end') rounds++;
  }
}
console.log('12 场：副将主战法相关事件', deputyCasts, '｜回合末事件', rounds);
const rep = runBattle({ myTeam: red, enemyTeam: blue, seed: 7, maxRounds: 8 } as any);
const dmg = (rep.events as any[]).filter((e) => e.type === 'damage');
console.log('单场伤害事件', dmg.length, '｜红方兵力', (rep as any).finalMyTroops, '｜蓝方兵力', (rep as any).finalEnemyTroops);
const bySkill: Record<string, number> = {};
for (const e of dmg) bySkill[e.skillId ?? 'basic'] = (bySkill[e.skillId ?? 'basic'] ?? 0) + 1;
console.log('伤害来源分布', bySkill);
console.log('副将技能在事件里出现次数（单场）', dmg.filter((e) => e.skillId === deputySkill).length);
