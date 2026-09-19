/**
 * 虎豹督军（曹纯·魏·骑 主战法）：一类指挥，我军群体（有效距离内 2–3 目标，各 50%）
 * 进行攻击的伤害提高 50%，该效果每回合开始时减少 1/8。
 * 时点（用户口径 2026-09-18）：官方口径「战斗开始后首回合」——准备阶段只释放+锁目标，
 * 效果在**第 1 回合开始**才结算并计数：第 1 回合 8/8 → 第 2 回合 7/8 → … → 第 8 回合 1/8（第 9 回合移除）。
 * 「受攻击属性影响」成长率 = 0.25/点（用户实测：攻击 277.8 → 99%、266 → 96%）。
 *
 * 引擎新增：`damage_boost` 支持 `decayEighths`（此前仅 `damage_reduce` 有）；
 * `CommandSkill.settleOnFirstRound`（首回合开始结算，与谋议宏图共用）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { tickRoundStartStatuses, inflictStatus } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, troops = 10000): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 曹纯（大营）+ 两名木桩友军：我军群体增伤有 3 个候选目标 */
function caoTeam(): General[] {
  const cao = withSkills(level40(hero('h498')), { commandSkillIds: ['hubao_dujun'] });
  return [dummy('ally-front', '前锋'), dummy('ally-mid', '中军'), { ...cao, position: '大营' }];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;

function boostEvents(events: BattleEvent[]): Inflicted[] {
  return events.filter((e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === 'damage_boost');
}

function makeUnit(g: General): UnitState {
  return {
    general: g,
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(units: UnitState[]): CombatContext {
  return {
    rng: new Rng(1),
    myTeam: units,
    enemyTeam: [],
    events: [],
    skills: new Map(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('虎豹督军（曹纯，一类指挥：我军群体增伤 50%，每回合 1/8 衰减）', () => {
  it('装配挂槽：曹纯主战法挂入指挥槽，一类指挥对我军群体 2–3 目标', () => {
    const g = hero('h498');
    expect(g.name).toBe('曹纯');
    expect(g.commandSkillIds).toContain('hubao_dujun');

    const s = SKILL_REGISTRY['hubao_dujun'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect(s.type === 'command' && s.targetSide === 'ally' && s.targetMode === 'group').toBe(true);
    expect(s.type === 'command' && s.groupCount).toEqual([2, 3]);
    expect(s.type === 'command' && s.range).toBe(3);
    expect(s.tags).toEqual(expect.arrayContaining(['damage_boost']));
  });

  it('机制：准备阶段只释放不结算；第 1 回合开始挂 8/8 增伤 73%（曹纯 40 级攻击 173）；第 2 回合起衰减', () => {
    const report = run(caoTeam(), 1, 2);
    expect(report.events.filter((e) => e.type === 'skill_cast' && e.skillName === '虎豹督军')).toHaveLength(1);

    const prepEnd = report.events.findIndex((e) => e.type === 'preparation_end');
    const r1 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 1);
    const r2 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 2);

    // 准备阶段：只释放（skill_cast/skill_target），不挂增伤
    expect(report.events.some((e, i) => i < prepEnd && e.type === 'skill_cast' && e.skillName === '虎豹督军')).toBe(
      true
    );
    expect(
      report.events.some((e, i) => i < prepEnd && e.type === 'status_inflicted' && e.statusType === 'damage_boost')
    ).toBe(false);

    // 第 1 回合开始才结算：我军群体 2–3 目标（groupCount [2,3] 各 50%）、满额 8/8
    const r1Boosts = report.events.filter(
      (e, i): e is Inflicted =>
        i > r1 && i < r2 && e.type === 'status_inflicted' && e.statusType === 'damage_boost'
    );
    expect(r1Boosts.length).toBeGreaterThanOrEqual(2);
    expect(r1Boosts.length).toBeLessThanOrEqual(3);
    // 攻击 173 → 50 + 0.25×(173−80) = 73.25 → 八舍九入 73%（受攻击成长率 0.25，用户实测）
    expect(r1Boosts.every((e) => e.detail.includes('提高 73%') && e.detail.includes('剩余 8/8'))).toBe(true);

    const decayed = report.events.find(
      (e, i): e is Inflicted =>
        i > r2 && e.type === 'status_inflicted' && e.statusType === 'damage_boost' && e.detail.includes('剩余 7/8')
    );
    expect(decayed).toBeDefined();
    expect(decayed!.detail).toContain('提高 64%'); // 0.73 × 7/8 = 0.63875 → 64%
  });

  it('数值：第 1 回合 8/8 → 第 8 回合 1/8（第 9 回合才移除），rate 按份数等比缩放', () => {
    const report = run(caoTeam(), 1, 8);
    const details = boostEvents(report.events).map((e) => e.detail);
    expect(details.some((d) => d.includes('剩余 8/8'))).toBe(true);
    expect(details.some((d) => d.includes('剩余 1/8'))).toBe(true);
    // 8 回合内不会到期移除：1/8 落在第 8 回合，移除发生在第 9 回合
    expect(
      report.events.some((e) => e.type === 'status_expired' && e.statusType === 'damage_boost')
    ).toBe(false);

    // 单元级：第 1 回合不衰减 → 第 2..8 回合各 −1/8 → 第 9 回合移除
    const unit = makeUnit(dummy('unit', '大营'));
    const ctx = makeCtx([unit]);
    const st = () => unit.statuses.find((s) => s.type === 'damage_boost');
    const eighths = () => {
      const s = st();
      return s && 'eighths' in s ? s.eighths : undefined;
    };
    inflictStatus(ctx, unit, {
      type: 'damage_boost',
      rate: 0.5,
      duration: 999,
      direction: 'caused',
      attackScaled: true,
      decayEighths: 8,
    }, 'command', 'hubao_dujun');
    expect(eighths()).toBe(8);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    expect(eighths()).toBe(8); // 第 1 回合保持满额
    for (let r = 2; r <= 8; r++) {
      ctx.currentRound = r;
      tickRoundStartStatuses(ctx);
    }
    expect(eighths()).toBe(1);
    expect(st() && st()!.type === 'damage_boost' ? st()!.rate : undefined).toBeCloseTo(0.5 * (1 / 8), 8);
    ctx.currentRound = 9;
    tickRoundStartStatuses(ctx);
    expect(st()).toBeUndefined();
  });
});
