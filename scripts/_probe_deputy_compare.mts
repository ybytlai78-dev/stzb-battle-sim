/**
 * 核验：同一支预设队，常规赛季 vs 北伐副本（挂副将）各打 20 场，对比战果
 * 用法：npx tsx scripts/_probe_deputy_compare.mts
 */
import { buildGeneralForSlot, deputyRejectReason, emptyDeputy, normalizeDeputy, zeroPoints, type DeputySlotLike, type SeasonMode } from '../web/deputy';
import { SLOTTED_HEROES } from '../web/heroes';
import { loadHotPresets } from '../web/hotPresets';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

const presets = loadHotPresets();
const redPreset = presets[0];
const bluePreset = presets[1];
console.log('红方预设', redPreset.name, '｜蓝方预设', bluePreset.name);

const POS = ['大营', '中军', '前锋'] as const;

function slots(preset: typeof redPreset, season: SeasonMode): DeputySlotLike[] {
  return preset.slots.map((s) => {
    const slot: DeputySlotLike = {
      heroId: s.heroId,
      extraSkillIds: [...s.extraSkillIds],
      freePoints: { ...s.freePoints },
      redness: s.redness,
      level: s.level,
      secondaryTroop: s.secondaryTroop,
      secondaryTraits: s.secondaryTraits,
      treasure: s.treasure,
      chenshou: s.chenshou,
      deputy: s.deputy,
    };
    if (season === 'beifa' && slot.heroId && !slot.deputy) {
      // 与 UI 选择器同口径：第一个合法同阵营候选
      const cand = SLOTTED_HEROES.find((h) => !deputyRejectReason(slot.heroId!, h.id));
      if (cand) slot.deputy = normalizeDeputy(emptyDeputy(cand.id), slot.heroId, slot.level) ?? undefined;
    }
    if (season === 'classic') delete slot.deputy;
    return slot;
  });
}

function team(preset: typeof redPreset, season: SeasonMode): General[] {
  return slots(preset, season).map((s, i) => buildGeneralForSlot(s, POS[i], 120, season)).filter(Boolean) as General[];
}

const blue = team(bluePreset, 'classic');
for (const mode of ['classic', 'beifa'] as SeasonMode[]) {
  const red = team(redPreset, mode);
  let win = 0, myLeft = 0, enemyLeft = 0, myDmg = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rep = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 } as any) as any;
    const left = rep.finalMyTroops.reduce((a: number, b: number) => a + b, 0);
    const enemy = rep.finalEnemyTroops.reduce((a: number, b: number) => a + b, 0);
    myLeft += left;
    enemyLeft += enemy;
    let dealt = 0;
    for (const e of rep.events) if (e.type === 'damage' && e.side !== 'enemy') dealt += e.amount ?? 0;
    myDmg += dealt;
    if (rep.winner === 'red' || rep.winner === 'my' || rep.outcome === 'win') win++;
  }
  console.log(
    `${mode.padEnd(7)} 红方平均剩余 ${Math.round(myLeft / 20)} ｜蓝方平均剩余 ${Math.round(enemyLeft / 20)} ｜红方总伤害 ${Math.round(myDmg / 20)} ｜胜 ${win}/20`
  );
  console.log('  红队四维', red.map((g) => `${g.position}:${g.attack}/${g.defense}/${g.strategy}/${g.speed}`).join(' '));
}

console.log('副将配置', JSON.stringify(slots(redPreset, 'beifa').map((s) => [s.heroId, s.deputy?.heroId ?? null])));
console.log('zeroPoints 示例', zeroPoints());
