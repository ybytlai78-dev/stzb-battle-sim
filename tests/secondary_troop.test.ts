/**
 * 二级兵种（兵种转换）数据层测试
 *
 * 依据 `docs/兵种转换调研.md`（用户 2026-09-20 审定口径）：
 *  - 13 个常规二级兵种 + 5 个武将专属（占位）
 *  - 每个五星武将恰好两个转换方向
 *  - 通用特性按兵系成池，现版每系 5 个；已移除的 6 个不出现
 *  - 攻击距离修正：长弓兵 +1 / 死士 −1
 *  - 相克改写：长枪兵克骑被弓克；其余按基础兵系
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_SECONDARY_TROOPS,
  CODE_TO_TROOP,
  FAMILY_TRAITS,
  SECONDARY_TROOPS,
  TRAIT_SLOTS_MAX,
  diLiBonus,
  familyOf,
  liRenAttackBonus,
  rangeModOf,
  traitsFor,
  troopCounterReduceOf,
  type GeneralTrait,
  type SecondaryTroopType,
} from '../src/engine/secondaryTroop';
import { HERO_SECONDARY_TROOPS, INCOMPLETE_SECONDARY_TROOPS, PENDING_SECONDARY_TROOPS } from '../src/data/secondaryTroops';

describe('二级兵种注册表', () => {
  it('共 13 个常规 + 5 个武将专属，代码唯一', () => {
    expect(ALL_SECONDARY_TROOPS).toHaveLength(18);
    const codes = ALL_SECONDARY_TROOPS.map((t) => SECONDARY_TROOPS[t].code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(ALL_SECONDARY_TROOPS.filter((t) => SECONDARY_TROOPS[t].exclusive)).toEqual([
      '解烦兵',
      '白毦兵',
      '西凉铁骑',
      '白衣死士',
      '木牛流马',
    ]);
  });

  it('兵系归属：步 5 / 弓 3 / 骑 5（常规）+ 专属按兵系挂靠', () => {
    const byFamily: Record<string, SecondaryTroopType[]> = { 步兵系: [], 弓兵系: [], 骑兵系: [] };
    for (const t of ALL_SECONDARY_TROOPS) byFamily[familyOf(t)].push(t);
    // 常规：步 5（重步兵/长枪兵/禁卫/蛮兵/藤甲兵）、弓 3、骑 5
    expect(byFamily['步兵系'].filter((t) => !SECONDARY_TROOPS[t].exclusive)).toEqual([
      '重步兵',
      '长枪兵',
      '禁卫',
      '蛮兵',
      '藤甲兵',
    ]);
    expect(byFamily['弓兵系'].filter((t) => !SECONDARY_TROOPS[t].exclusive)).toEqual(['长弓兵', '弩兵', '死士']);
    expect(byFamily['骑兵系'].filter((t) => !SECONDARY_TROOPS[t].exclusive)).toEqual([
      '重骑兵',
      '轻骑兵',
      '铁骑兵',
      '弓骑兵',
      '象兵',
    ]);
    // 含专属：步 6 / 弓 4 / 骑 8
    expect(byFamily['步兵系']).toHaveLength(6);
    expect(byFamily['弓兵系']).toHaveLength(4);
    expect(byFamily['骑兵系']).toHaveLength(8);
  });

  it('代码 → 兵种名双向可查（官方编码规律：十位=兵系，个位=系内序号）', () => {
    expect(CODE_TO_TROOP['11']).toBe('长弓兵');
    expect(CODE_TO_TROOP['21']).toBe('弩兵');
    expect(CODE_TO_TROOP['31']).toBe('死士');
    expect(CODE_TO_TROOP['22']).toBe('长枪兵');
    expect(CODE_TO_TROOP['32']).toBe('禁卫');
    expect(CODE_TO_TROOP['33']).toBe('弓骑兵');
    expect(CODE_TO_TROOP['43']).toBe('铁骑兵');
    expect(CODE_TO_TROOP['53']).toBe('象兵');
    expect(SECONDARY_TROOPS['弩兵'].code).toBe('21');
  });

  it('攻击距离修正：长弓兵 +1、死士 −1、其余 0', () => {
    expect(rangeModOf('长弓兵')).toBe(1);
    expect(rangeModOf('死士')).toBe(-1);
    expect(rangeModOf('弩兵')).toBe(0);
    expect(rangeModOf('象兵')).toBe(0);
    expect(rangeModOf(undefined)).toBe(0);
  });
});

describe('通用特性池（现版）', () => {
  const REMOVED: string[] = ['固阵', '近战', '射马', '伪装', '乱阵', '侧击'];

  it('每兵系恰好 5 个特性，且不含 2025-06-25 已移除的 6 个', () => {
    for (const family of ['步兵系', '弓兵系', '骑兵系'] as const) {
      const pool = FAMILY_TRAITS[family];
      expect(pool).toHaveLength(5);
      for (const removed of REMOVED) expect(pool).not.toContain(removed);
    }
  });

  it('骑兵系池 = 出奇/疾行/难测/扰后/挫锐（用户举例：轻骑、铁骑都能选）', () => {
    expect(FAMILY_TRAITS['骑兵系']).toEqual(['出奇', '疾行', '难测', '扰后', '挫锐']);
    expect(traitsFor('轻骑兵')).toEqual(traitsFor('铁骑兵'));
    expect(traitsFor('铁骑兵')).toEqual(traitsFor('象兵'));
  });

  it('同兵系所有高级兵种共享同一池（跨兵种间接验证）', () => {
    expect(traitsFor('重步兵')).toEqual(traitsFor('藤甲兵'));
    expect(traitsFor('长弓兵')).toEqual(traitsFor('死士'));
    expect(traitsFor('重骑兵')).toEqual(traitsFor('弓骑兵'));
  });

  it('特性栏最多 2 个', () => {
    expect(TRAIT_SLOTS_MAX).toBe(2);
  });

  it('利刃：每个非主动战法 +22 攻击，上限 +66', () => {
    expect(liRenAttackBonus(0)).toBe(0);
    expect(liRenAttackBonus(2)).toBe(44);
    expect(liRenAttackBonus(3)).toBe(66);
    expect(liRenAttackBonus(5)).toBe(66);
  });

  it('地利：现版数值（前锋防 24 / 中军防谋 10 / 大营攻防谋 6）', () => {
    expect(diLiBonus('前锋')).toEqual({ defense: 24 });
    expect(diLiBonus('中军')).toEqual({ defense: 10, strategy: 10 });
    expect(diLiBonus('大营')).toEqual({ attack: 6, defense: 6, strategy: 6 });
  });
});

describe('高级兵种改写相克（统一 −30%，长枪兵反转）', () => {
  it('基础兵系相克：骑克步、步克弓、弓克骑，被克制方 −30%', () => {
    // 步兵打骑兵 → 步兵被克 → 减伤 0.3
    expect(troopCounterReduceOf({ attackerTroop: 'infantry', targetTroop: 'cavalry' })).toBeCloseTo(0.3);
    // 骑兵打步兵 → 克制方 → 无
    expect(troopCounterReduceOf({ attackerTroop: 'cavalry', targetTroop: 'infantry' })).toBe(0);
    // 弓兵打步兵 → 被克 → 0.3
    expect(troopCounterReduceOf({ attackerTroop: 'archer', targetTroop: 'infantry' })).toBeCloseTo(0.3);
    // 骑兵打弓兵 → 被克 → 0.3
    expect(troopCounterReduceOf({ attackerTroop: 'cavalry', targetTroop: 'archer' })).toBeCloseTo(0.3);
  });

  it('长枪兵：克骑（骑打枪 −30%）、对骑增伤 +30%、被弓克（弓打枪 +30%、枪打弓 −30%）', () => {
    // 骑兵打长枪兵 → 枪克骑 → 骑受伤？不：骑被克制 → 骑造成伤害 −30%
    expect(
      troopCounterReduceOf({ attackerTroop: 'cavalry', targetTroop: 'infantry', targetSecondary: '长枪兵' })
    ).toBeCloseTo(0.3);
    // 长枪兵打骑兵 → 长枪兵对骑 +30%（目标受到的伤害提高 → 返回 −0.3）
    expect(
      troopCounterReduceOf({ attackerTroop: 'infantry', attackerSecondary: '长枪兵', targetTroop: 'cavalry' })
    ).toBeCloseTo(-0.3);
    // 弓兵打长枪兵 → 弓克枪 → 弓增伤 +30%（目标受到的伤害提高 → 返回 −0.3）
    expect(
      troopCounterReduceOf({ attackerTroop: 'archer', targetTroop: 'infantry', targetSecondary: '长枪兵' })
    ).toBeCloseTo(-0.3);
    // 长枪兵打弓兵 → 枪被弓克 → 长枪兵造成伤害 −30%（返回 0.3）
    expect(
      troopCounterReduceOf({ attackerTroop: 'infantry', attackerSecondary: '长枪兵', targetTroop: 'archer' })
    ).toBeCloseTo(0.3);
  });

  it('长枪兵 vs 步兵：无相克（不互为克制链）', () => {
    expect(
      troopCounterReduceOf({ attackerTroop: 'infantry', targetTroop: 'infantry', attackerSecondary: '长枪兵' })
    ).toBe(0);
  });

  it('其余高级兵种沿用基础兵系相克（重步兵/弩兵/铁骑兵等）', () => {
    expect(
      troopCounterReduceOf({ attackerTroop: 'infantry', targetTroop: 'cavalry', attackerSecondary: '重步兵' })
    ).toBeCloseTo(0.3);
    expect(
      troopCounterReduceOf({ attackerTroop: 'cavalry', targetTroop: 'archer', attackerSecondary: '铁骑兵' })
    ).toBeCloseTo(0.3);
    expect(
      troopCounterReduceOf({ attackerTroop: 'archer', targetTroop: 'cavalry', attackerSecondary: '弩兵' })
    ).toBe(0);
  });
});

describe('武将转换方向数据', () => {
  it('每个武将恰好 2 个方向、非空且互不相同、代码可解', () => {
    for (const [id, troops] of Object.entries(HERO_SECONDARY_TROOPS)) {
      expect(troops, id).toHaveLength(2);
      expect(troops[0], id).not.toBe(troops[1]);
      for (const t of troops) expect(SECONDARY_TROOPS[t], `${id} → ${t}`).toBeDefined();
    }
  });

  it('覆盖本仓库 161 将', () => {
    expect(Object.keys(HERO_SECONDARY_TROOPS)).toHaveLength(161);
  });

  it('样本与官方表一致（调研文档 §三.2）', () => {
    expect(HERO_SECONDARY_TROOPS['taishici']).toEqual(['弩兵', '弓骑兵']); // 太史慈
    expect(HERO_SECONDARY_TROOPS['h476']).toEqual(['死士', '轻骑兵']); // 郭嘉
    expect(HERO_SECONDARY_TROOPS['h519']).toEqual(['蛮兵', '藤甲兵']); // 兀突骨
    expect(HERO_SECONDARY_TROOPS['h452']).toEqual(['蛮兵', '象兵']); // 木鹿大王
    expect(HERO_SECONDARY_TROOPS['h13']).toEqual(['轻骑兵', '西凉铁骑']); // 马超
    expect(HERO_SECONDARY_TROOPS['h793']).toEqual(['禁卫', '白毦兵']); // 陈到
    expect(HERO_SECONDARY_TROOPS['h807']).toEqual(['禁卫', '白衣死士']); // 司马懿 XP
    expect(HERO_SECONDARY_TROOPS['h472']).toEqual(['重步兵', '禁卫']); // 司马懿 魏
    expect(HERO_SECONDARY_TROOPS['h808']).toEqual(['弩兵', '解烦兵']); // 孙权 XP
    expect(HERO_SECONDARY_TROOPS['sunquan']).toEqual(['长弓兵', '死士']); // 孙权 本体
  });

  it('武将专属兵种只出现在对应武将上', () => {
    const owners = new Map<SecondaryTroopType, string[]>();
    for (const [id, troops] of Object.entries(HERO_SECONDARY_TROOPS)) {
      for (const t of troops) {
        if (!SECONDARY_TROOPS[t].exclusive) continue;
        owners.set(t, [...(owners.get(t) ?? []), id]);
      }
    }
    expect(owners.get('解烦兵')).toEqual(['h808']);
    expect(owners.get('白毦兵')).toEqual(['h793']);
    expect(owners.get('西凉铁骑')).toEqual(['h13']);
    expect(owners.get('白衣死士')).toEqual(['h807']);
    expect(owners.get('木牛流马')).toEqual(['xp_jiangwei']);
  });

  it('5 个武将专属兵种的专属特性留空占位（用户口径：数值待补，不编造）', () => {
    for (const t of ['解烦兵', '白毦兵', '西凉铁骑', '白衣死士', '木牛流马'] as SecondaryTroopType[]) {
      expect(SECONDARY_TROOPS[t].exclusiveTrait, t).toEqual([]);
    }
  });

  it('13 个常规兵种的专属特性均已登记', () => {
    for (const t of ALL_SECONDARY_TROOPS) {
      if (SECONDARY_TROOPS[t].exclusive) continue;
      expect(SECONDARY_TROOPS[t].exclusiveTrait.length, t).toBeGreaterThan(0);
    }
  });

  it('未上线五星已登记（钟会/蔡夫人/王美人…），数据不完整的单列', () => {
    const names = PENDING_SECONDARY_TROOPS.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['钟会', '蔡夫人', '王美人']));
    for (const p of PENDING_SECONDARY_TROOPS) expect(p.troops).toHaveLength(2);
    // 「名将」只有 1 个方向（官方数据不完整）→ 进 INCOMPLETE 名单，不占转换表
    expect(INCOMPLETE_SECONDARY_TROOPS.map((p) => p.name)).toContain('名将');
    expect(names).not.toContain('名将');
  });
});
