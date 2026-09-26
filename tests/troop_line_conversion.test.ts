/**
 * 兵种系（有效兵系）判定 —— 二级兵种转换后可**跨兵系**（用户 2026-09-22 口径）：
 *   祝融夫人 群·骑 → 蛮兵（**步兵系**）→ 战法文本「步兵…」的效果必须对她生效。
 * 依据 `docs/兵种转换调研.md`：蛮兵/藤甲兵为步系、死士为弓系、象兵为骑系；两个转换方向可跨兵系。
 *
 * 覆盖：
 *  - `effectiveTroopLine()` 单元（蛮兵 → infantry / 死士 → archer / 未转换 = 原兵种）；
 *  - 战法效果 `troopTypes` 过滤：真实战法【衡轭】——骑兵 谋略+50 / 步兵 普攻增伤 50%；
 *  - 阵容兵种门闩（`teamPassesTroopFilter`）：弓兵本色转蛮兵后按步兵算，「仅骑+步生效」应通过。
 */
import { describe, it, expect } from 'vitest';
import { teamPassesTroopFilter, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { effectiveTroopLine } from '../src/engine/secondaryTroop';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function unit(id: string, position: Position, extra: Partial<General> = {}): UnitState {
  const g: General = {
    id, name: id, rarity: '5星', cost: 3, faction: '群', tags: [],
    mutualExclusionGroup: null, troopType: 'cavalry', position,
    attack: 150, defense: 100, strategy: 80, speed: 50, attackRange: 3, maxTroops: 9000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side: 'my', troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[]): CombatContext {
  return {
    rng: new Rng(7), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

function statusOf(u: UnitState, type: Status['type']): Status | undefined {
  return u.statuses.find((s) => s.type === type);
}

describe('effectiveTroopLine：二级兵种按兵系归属', () => {
  it('蛮兵=步兵系、死士=弓兵系、藤甲兵=步兵系、象兵=骑兵系；未转换取原兵种', () => {
    // 跨兵系转换：骑 → 蛮兵（步系）
    expect(effectiveTroopLine({ troopType: 'cavalry', secondaryTroop: '蛮兵' })).toBe('infantry');
    // 弓 → 死士（弓系，同系）
    expect(effectiveTroopLine({ troopType: 'archer', secondaryTroop: '死士' })).toBe('archer');
    // 步 → 藤甲兵（步系）
    expect(effectiveTroopLine({ troopType: 'infantry', secondaryTroop: '藤甲兵' })).toBe('infantry');
    // 骑 → 象兵（骑系）
    expect(effectiveTroopLine({ troopType: 'cavalry', secondaryTroop: '象兵' })).toBe('cavalry');
    // 弓 → 弓骑兵（骑系，跨系）
    expect(effectiveTroopLine({ troopType: 'archer', secondaryTroop: '弓骑兵' })).toBe('cavalry');
    // 未转换
    expect(effectiveTroopLine({ troopType: 'cavalry' })).toBe('cavalry');
    expect(effectiveTroopLine({ troopType: 'infantry' })).toBe('infantry');
  });
});

describe('衡轭：骑兵谋略+50 / 步兵普攻增伤 50%（按有效兵系）', () => {
  it('蛮兵祝融（骑本色）吃步兵普攻增伤；骑兵队友吃谋略+50', () => {
    // 曹操/华雄本色骑兵，祝融夫人 骑 → 蛮兵（步兵系）
    const caocao = unit('caocao', '前锋', { commandSkillIds: ['henge'], strategy: 200 });
    const huaxiong = unit('huaxiong', '中军');
    const zhurong = unit('zhurong', '大营', { secondaryTroop: '蛮兵' });
    const foe = unit('foe', '前锋', { troopType: 'infantry' });
    foe.side = 'enemy';
    const ctx = makeCtx([caocao, huaxiong, zhurong], [foe]);

    triggerCommandSkills(ctx, caocao);

    expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === 'henge')).toBe(true);
    // 骑兵（曹操/华雄）：谋略 +50
    for (const u of [caocao, huaxiong]) {
      const buff = statusOf(u, 'strategy_buff');
      expect(buff && buff.type === 'strategy_buff' && buff.amount).toBe(50);
    }
    // 蛮兵祝融：步兵段 → 普攻增伤 50%（不是谋略）
    const boost = statusOf(zhurong, 'damage_boost');
    expect(boost && boost.type === 'damage_boost' && boost.rate).toBe(0.5);
    expect(boost && boost.type === 'damage_boost' && boost.damageSource).toBe('basic');
    expect(statusOf(zhurong, 'strategy_buff')).toBeUndefined();
  });

  it('回归：未转换的三骑仍只吃谋略+50（无步兵，无普攻增伤）', () => {
    const a = unit('a', '前锋', { commandSkillIds: ['henge'] });
    const b = unit('b', '中军');
    const c = unit('c', '大营');
    const foe = unit('foe', '前锋');
    foe.side = 'enemy';
    const ctx = makeCtx([a, b, c], [foe]);

    triggerCommandSkills(ctx, a);

    for (const u of [a, b, c]) {
      expect(statusOf(u, 'strategy_buff')).toBeDefined();
      expect(statusOf(u, 'damage_boost')).toBeUndefined();
    }
  });
});

describe('teamPassesTroopFilter：阵容门闩按有效兵系', () => {
  it('弓兵本色转蛮兵（步兵系）后，衡轭的「仅骑+步」门闩应通过', () => {
    const archerAsManbing = unit('a', '前锋', { troopType: 'archer', secondaryTroop: '蛮兵' });
    const cavalry = unit('c', '中军');
    expect(teamPassesTroopFilter([archerAsManbing, cavalry], ['cavalry', 'infantry'])).toBe(true);
    // 未转换的弓兵本色仍被拒
    expect(teamPassesTroopFilter([unit('plain', '前锋', { troopType: 'archer' }), cavalry], ['cavalry', 'infantry'])).toBe(false);
  });

  it('骑本色转死士（弓兵系）后，疏数的「仅弓+骑」门闩应通过', () => {
    const cavAsSishi = unit('a', '前锋', { troopType: 'cavalry', secondaryTroop: '死士' });
    expect(teamPassesTroopFilter([cavAsSishi, unit('b', '中军', { troopType: 'archer' })], ['archer', 'cavalry'])).toBe(true);
  });
});
