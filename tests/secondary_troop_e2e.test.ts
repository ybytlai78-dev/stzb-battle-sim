/**
 * 二级兵种：端到端接线测试
 *
 * 验证「武将 id → 转换方向数据 → General → 战斗结算」整条链路：
 *  1. 用真实武将（HERO_REGISTRY）取转换方向；
 *  2. 转换方向数据只含已注册的二级兵种；
 *  3. 装上二级兵种 + 通用特性后能正常跑完整场战斗（不抛错、事件完整）；
 *  4. 专属兵种（占位）也能正常跑（特性数值为空 → 只有转换方向生效）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';
import { HERO_SECONDARY_TROOPS, PENDING_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { SECONDARY_TROOPS, traitsFor, TRAIT_SLOTS_MAX } from '../src/engine/secondaryTroop';
import type { General } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

/** 给武将装上二级兵种 + 前 2 个通用特性 */
function convert(g: General): General {
  const [a] = HERO_SECONDARY_TROOPS[g.id] ?? [];
  if (!a) return g;
  return {
    ...g,
    secondaryTroop: a,
    secondaryTraits: traitsFor(a).slice(0, TRAIT_SLOTS_MAX),
  };
}

describe('兵种转换端到端', () => {
  it('本仓库已注册武将的转换方向都能解到有效二级兵种', () => {
    for (const [id, troops] of Object.entries(HERO_SECONDARY_TROOPS)) {
      for (const t of troops) expect(SECONDARY_TROOPS[t], `${id} → ${t}`).toBeDefined();
    }
  });

  it('未上线五星的转换方向同样有效', () => {
    for (const p of PENDING_SECONDARY_TROOPS) {
      for (const t of p.troops) expect(SECONDARY_TROOPS[t], `${p.name} → ${t}`).toBeDefined();
    }
  });

  it('真实武将转换后能跑完整场战斗（太史慈 弩兵/弓骑兵）', () => {
    const rec = HERO_REGISTRY['taishici'];
    expect(rec, '太史慈应已入库').toBeDefined();
    const base = level40(rec, {}, 9000);
    expect(HERO_SECONDARY_TROOPS['taishici']).toEqual(['弩兵', '弓骑兵']);

    const my = convert({ ...base, position: '大营' });
    const enemy = convert({ ...level40(HERO_REGISTRY['h476'], {}, 9000), position: '大营' }); // 郭嘉 死士/轻骑兵
    const rep = runBattle({ myTeam: [my], enemyTeam: [enemy], seed: 20260920, maxRounds: 8 });

    expect(rep.events.some((e) => e.type === 'battle_start')).toBe(true);
    expect(rep.events.some((e) => e.type === 'attack_hit')).toBe(true);
    // 转换后的兵种确实写进了运行时单位
    expect(my.secondaryTroop).toBe('弩兵');
    expect(my.secondaryTraits).toEqual(traitsFor('弩兵').slice(0, 2));
  });

  it('专属兵种（占位）也能跑完整场战斗（孙权 XP 解烦兵）', () => {
    const rec = HERO_REGISTRY['h808'];
    expect(rec, 'XP孙权应已入库').toBeDefined();
    expect(HERO_SECONDARY_TROOPS['h808']).toEqual(['弩兵', '解烦兵']);
    const g = { ...level40(rec, {}, 9000), position: '大营' as const, secondaryTroop: '解烦兵' as const };
    // 解烦兵专属特性留空占位 → traitsFor 仍给弓兵系池
    const rep = runBattle({
      myTeam: [{ ...g, secondaryTraits: traitsFor('解烦兵').slice(0, 2) }],
      enemyTeam: [level40(HERO_REGISTRY['h476'], {}, 9000)],
      seed: 7,
      maxRounds: 4,
    });
    expect(rep.events.some((e) => e.type === 'attack_hit')).toBe(true);
    expect(SECONDARY_TROOPS['解烦兵'].exclusiveTrait).toEqual([]);
  });

  it('withSkills 不覆盖兵种字段（配将流程可叠加额外战法）', () => {
    const rec = HERO_REGISTRY['taishici'];
    const g = withSkills(convert(level40(rec, {}, 9000)), { activeSkillIds: ['tujin'] });
    expect(g.secondaryTroop).toBe('弩兵');
    expect(g.activeSkillIds).toContain('tujin');
  });
});
