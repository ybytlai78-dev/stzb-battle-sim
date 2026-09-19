/**
 * 令明负榇（庞德·群·骑 主战法）：一类指挥，我军群体（有效距离内 2 目标）。
 * 前 3 回合每回合使我军群体骑兵/步兵攻击伤害提高 6%（同战法累加，满 3 层 18% 停止，持续至战斗结束）；
 * 第 4 回合起进入分兵状态（伤害率 50%），持续至战斗结束。
 *
 * 引擎配套：`delayedOutput` 新增「非伤害输出」分支（此前只能打伤害），本战法为首个用例。
 * 注：同战法重复施加 damage_boost 为「静默累加」（只首次推送 status_inflicted 事件）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, troopType: General['troopType'] = 'infantry'): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType,
    position,
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
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

function pangdeTeam(): General[] {
  const pd = withSkills(level40(hero('h586')), { commandSkillIds: ['lingming_fuchen'] });
  return [dummy('ally-front', '前锋', 'cavalry'), dummy('ally-mid', '中军', 'cavalry'), { ...pd, position: '大营' }];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
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
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
const of = (events: BattleEvent[], type: string): Inflicted[] =>
  events.filter((e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === type);

describe('令明负榇（庞德，一类指挥：前 3 回合叠增伤 → 第 4 回合起分兵）', () => {
  it('装配挂槽：庞德主战法挂入指挥槽，一类指挥对我军群体 2 目标', () => {
    const g = hero('h586');
    expect(g.name).toBe('庞德');
    expect(g.commandSkillIds).toContain('lingming_fuchen');

    const s = SKILL_REGISTRY['lingming_fuchen'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect(s.type === 'command' && s.targetSide === 'ally' && s.targetMode === 'group').toBe(true);
    expect(s.type === 'command' && s.groupCount).toBe(2);
    expect(s.type === 'command' && s.range).toBe(4);
    expect(s.tags).toEqual(expect.arrayContaining(['damage_boost', 'split']));
    expect(s.type === 'command' && s.delayedOutput?.atRound).toBe(4);
  });

  it('机制：前 3 回合每回合判定 2 次（2 目标），首次施加 6% 增伤', () => {
    const report = run(pangdeTeam(), 1, 6);
    // 前 3 回合 × 2 目标 = 6 次判定
    const triggers = report.events.filter(
      (e) => e.type === 'skill_trigger' && e.skillName === '令明负榇'
    );
    expect(triggers).toHaveLength(6);
    // 第 4 回合起不再判定
    const r4 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 4);
    const after = report.events.slice(r4).filter((e) => e.type === 'skill_trigger' && e.skillName === '令明负榇');
    expect(after).toHaveLength(0);

    // 首次施加：我军群体 2 目标各一条 6%（同战法重复施加静默累加，不重复推事件）
    const boosts = of(report.events, 'damage_boost');
    expect(boosts).toHaveLength(2);
    expect(boosts[0].detail).toContain('提高 6%');
  });

  it('机制：第 4 回合起对锁定目标施加分兵（伤害率 50%），全程仅一次不刷新', () => {
    const report = run(pangdeTeam(), 1, 8);
    const r4 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 4);
    expect(r4).toBeGreaterThan(0);

    expect(of(report.events.slice(0, r4), 'split')).toHaveLength(0);

    const splits = of(report.events, 'split');
    expect(splits).toHaveLength(2);
    expect(splits[0].detail).toContain('50%');
    expect(report.events.indexOf(splits[0])).toBeGreaterThan(r4);
  });

  it('数值：同战法重复施加累加 6% → 12% → 18%，满 3 层封顶不再增长', () => {
    const u = makeUnit(dummy('u', '大营', 'cavalry'));
    const ctx = makeCtx([u]);
    const create = {
      type: 'damage_boost' as const,
      rate: 0.06,
      duration: 999,
      direction: 'caused' as const,
      stacks: 1,
      maxStacks: 3,
    };
    const rates: number[] = [];
    for (let i = 0; i < 5; i++) {
      inflictStatus(ctx, u, create, 'command', 'lingming_fuchen');
      const st = u.statuses.find((s) => s.type === 'damage_boost');
      rates.push((st as { rate: number } | undefined)?.rate ?? -1);
    }
    expect(rates[0]).toBeCloseTo(0.06, 6);
    expect(rates[1]).toBeCloseTo(0.12, 6);
    expect(rates[2]).toBeCloseTo(0.18, 6);
    // 带 stacks + maxStacks 的显式叠层：第 4/5 次达到上限后不再累加（roundRepeat endRound:3 另有战法层封顶）
    expect(rates[3]).toBeCloseTo(0.18, 6);
    expect(rates[4]).toBeCloseTo(0.18, 6);
    expect(u.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(1);
  });
});
