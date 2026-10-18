/**
 * 探针（2026-10-18）：举贤决机 × 缓师徐持 的「受击钩子重入」验证
 *  - 一次 applyDamage（敌军已行动）→ 缓师判定恰好 2 次（rolls），不被举贤的二次伤害回灌
 *  - 举贤的二次伤害事件之后不得再出现缓师判定（否则 = 套环）
 */
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { applyDamage, type CombatContext, type LockedCommand } from '../src/engine/action';
import type { CommandSkill, Position, Skill, UnitState } from '../src/engine/types';

function makeUnit(id: string, position: Position): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '群',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position,
      attack: 100,
      defense: 100,
      strategy: 200,
      speed: 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  } as UnitState;
}

const ctx: CombatContext = {
  rng: new Rng(7),
  myTeam: [],
  enemyTeam: [],
  events: [],
  skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
  lockedCommands: [],
  stackBuffs: [],
  currentRound: 1,
};

const caster = makeUnit('h794', '大营'); // 汉荀彧
const jushou = makeUnit('h771', '中军'); // 沮授
const victim = makeUnit('e1', '前锋');
victim.side = 'enemy';
victim.hasActedThisRound = true; // 满足缓师「已行动的敌军受到伤害后」
caster.general.commandSkillIds = ['juxian_jueji'];
jushou.general.commandSkillIds = ['huanshi_xuchi'];
ctx.myTeam.push(caster, jushou);
ctx.enemyTeam.push(victim);

const juxian = structuredClone(SKILL_REGISTRY['juxian_jueji']) as CommandSkill;
juxian.onAttrChange = (juxian.onAttrChange ?? []).map((r) => ({ ...r, rate: 1 })); // 必中，便于计数
const huanshi = structuredClone(SKILL_REGISTRY['huanshi_xuchi']) as CommandSkill;
huanshi.onHurt = { ...(huanshi.onHurt as any), rate: 1, rateStrategyScaled: false, rolls: 2 }; // 必中两次

const lock = (skill: Skill, casterId: string, targets: UnitState[]): LockedCommand => ({
  skill,
  casterId,
  targets,
  currentRate: 1,
});
ctx.lockedCommands.push(lock(huanshi, 'h771', ctx.enemyTeam));
ctx.lockedCommands.push(lock(juxian, 'h794', ctx.myTeam));

// ── 用例 1（对照）：正常受击 → 缓师 2 次判定 → 举贤 8 段伤害，这 8 段不再回灌
applyDamage(ctx, victim, 1000, caster, 'physical', 'skill');
const huanshi1 = ctx.events.filter((e: any) => e.type === 'skill_trigger' && e.skillId === 'huanshi_xuchi').length;
const juxian1 = ctx.events.filter((e: any) => e.type === 'damage' && e.skillId === 'juxian_jueji').length;

// ── 用例 2（机制）：人为把 ctx 标记成「正在受击钩子内」→ 这一次伤害完全不进受击链
const before = ctx.events.length;
ctx.resolvingHurtHooks = true;
applyDamage(ctx, victim, 1000, caster, 'physical', 'skill');
ctx.resolvingHurtHooks = false;
const nest = (ctx.events as any[]).slice(before);
const huanshi2 = nest.filter((e) => e.type === 'skill_trigger' && e.skillId === 'huanshi_xuchi').length;
const juxian2 = nest.filter((e) => e.type === 'damage' && e.skillId === 'juxian_jueji').length;
console.log(`
[用例1 对照] 缓师判定 ${huanshi1}｜举贤伤害 ${juxian1} 段`);
console.log(`[用例2 嵌套] 缓师判定 ${huanshi2}｜举贤伤害 ${juxian2} 段  (期望都是 0，且这 8 段伤害也不会再回灌)`);

// ── 用例 3（粒度）：钩子外的两个独立伤害事件 → 2 × 2 = 4 次判定（判定单位是「伤害事件」）
const mark3 = ctx.events.length;
applyDamage(ctx, victim, 1000, caster, 'physical', 'skill');
applyDamage(ctx, victim, 1000, caster, 'physical', 'skill');
const huanshi3 = (ctx.events as any[]).slice(mark3).filter((e) => e.type === 'skill_trigger' && e.skillId === 'huanshi_xuchi').length;
console.log(`[用例3 粒度] 两次独立受击 → 缓师判定 ${huanshi3} 次（期望 4 = 2 事件 × 2 rolls）`);


const ev = ctx.events as any[];
const huanshiTrig = ev.filter((e) => e.type === 'skill_trigger' && e.skillId === 'huanshi_xuchi');
const juxianTrig = ev.filter((e) => e.type === 'skill_trigger' && e.skillId === 'juxian_jueji');
const juxianDmg = ev.filter((e) => e.type === 'damage' && e.skillId === 'juxian_jueji');

console.log('事件序列：');
for (const e of ev) {
  if (e.type === 'skill_trigger') console.log(`  [trigger] ${e.skillName} → ${e.targetId} success=${e.success}`);
  else if (e.type === 'damage') console.log(`  [damage] ${e.skillName ?? e.skillId} → ${e.targetId} ${e.damage}`);
  else if (e.type === 'status_inflicted') console.log(`  [status] ${e.unitId} ${e.statusType} ${e.detail ?? ''}`);
}
console.log(
  `\n缓师判定 ${huanshiTrig.length} 次（rolls=2，期望 2）｜举贤判定 ${juxianTrig.length} 次｜举贤伤害 ${juxianDmg.length} 段`
);

// 套环检测：举贤伤害事件之后是否又冒出缓师判定
let reentered = 0;
let afterJuxianDmg = false;
for (const e of ev) {
  if (e.type === 'damage' && e.skillId === 'juxian_jueji') afterJuxianDmg = true;
  if (afterJuxianDmg && e.type === 'skill_trigger' && e.skillId === 'huanshi_xuchi') reentered++;
}
console.log(reentered === 0 ? '✅ 无回灌：举贤的二次伤害没有再次触发缓师（无套环）' : `❌ 回灌 ${reentered} 次`);
