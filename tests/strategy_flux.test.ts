/**
 * 敛微穷极（刘徽 h814）· 策略伤害浮动 `strategy_flux` —— 用户 2026-10-23 报障「详情战报里伤害率没有变化」。
 *
 * 报障根因（本次钉死）：
 *  ① 浮动区间与收敛值**完全没读谋略**（旧 CreateStatus 带 strategyScaled/growthRate 但 pushStatus 与施加点
 *     都不看；数据层也没写 growthRate）→ 区间恒 80~150、第 6 回合恒 115%，与谋略无关；
 *  ② 战报里唯一的「伤害率」文字 = 准备阶段那条状态 detail，写死成 `80%~150%（6 回合内收敛至 115%）`，
 *     **不随回合收敛更新、也不含谋略缩放** → 看上去「伤害率没有变化」；
 *  ③ 每击实际生效的伤害率根本没进事件流（damage 事件只有 damage + breakdown）→ 战报无从显示。
 *
 * 口径（包内 tb_cfg_skill_detail 200296 真值，2026-10-23）：
 *  - 机制 82「伤害率波动上限」= 138 + 0.4×30 = **150.0%**，成长 **0.15/点谋略**；
 *    机制 83「下限」= 80 + 0.4×0 = **80.0%**，成长 **0**（官方只标「上限受谋略属性影响」）；
 *  - 逐回合 6 档（上限 29/131、28/124、27/118、26/111、25/105；下限 5/85、10/90、15/95、20/100、25/105）：
 *      第 1 回合 80.0~150.0、第 2 87.0~142.6、第 3 94.0~135.2、第 4 101.0~128.8、第 5 108.0~121.4、第 6 起 115.0~115.0；
 *  - 施加阶段按**施法者**生效谋略逐档 `scaledValue(值, 该档成长率, 谋略)` 缩放并冻结（与 damage_boost 受谋略同口径）；
 *  - 每击 `伤害率 = 基础率 × 档位区间内均匀随机系数`，事件写 `damageRate`（%）与 `rateFlux{low,high,factor}`；
 *  - DoT 挂上时冻结、**不参与浮动**（官方「造成策略伤害时」= 直接伤害段）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Rng } from '../src/engine/rng';
import { triggerActiveSkill, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';
import type {
  BattleEvent,
  CommandSkill,
  General,
  Position,
  Skill,
  SkillOutput,
  UnitState,
} from '../src/engine/types';

/** 包内 6 档（谋略 80 的满级基准）：[下限, 上限] */
const PACKAGE_STEPS: Array<[number, number]> = [
  [80, 150],
  [87, 142.6],
  [94, 135.2],
  [101, 128.8],
  [108, 121.4],
  [115, 115],
];

function gen(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '晋',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'archer',
    position,
    attack: 100,
    defense: 100,
    strategy: 80,
    speed: 50,
    attackRange: 3,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

/** 测试用策略攻击：发动率 100%、伤害率固定 200%（不含受谋略缩放）→ 伤害率数值可直接对账 */
const TEST_STRATEGY: Skill = {
  id: 'test_strategy_hit',
  name: '测试策略攻击',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'random_single',
  targetSide: 'enemy',
  tags: ['damage'],
  output: [{ kind: 'strategy_damage', rate: 200, strategyScaled: false }],
};

const TEST_STRATEGY_RATE = 200;

function scene(opts: { flux: boolean; strategy?: number }) {
  const strategy = opts.strategy ?? 80;
  const caster = unit(gen('caster', '前锋', { strategy }), 'my');
  const liuhui = unit(
    gen('liuhui', '中军', {
      strategy,
      // 一类指挥：准备阶段一次性给友军全体挂增伤 + 策略伤害浮动
      ...(opts.flux ? { commandSkillIds: ['lianwei_qiongji'], mainSkillId: 'lianwei_qiongji' } : {}),
    }),
    'my'
  );
  const pacer = unit(gen('pacer', '大营'), 'my');
  const foes = [unit(gen('e1', '前锋'), 'enemy'), unit(gen('e2', '中军'), 'enemy')];
  const ctx: CombatContext = {
    rng: new Rng(20260101),
    myTeam: [caster, liuhui, pacer],
    enemyTeam: foes,
    events: [],
    skills: new Map<string, Skill>([...Object.entries(SKILL_REGISTRY), [TEST_STRATEGY.id, TEST_STRATEGY]]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  triggerCommandSkills(ctx, liuhui);
  return { ctx, caster, liuhui, pals: [caster, liuhui, pacer], foes };
}

const cast = (ctx: CombatContext, caster: UnitState, pals: UnitState[], foes: UnitState[]) =>
  triggerActiveSkill(ctx, caster, TEST_STRATEGY, foes, pals, foes);

const strategyHits = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.damageType === 'strategy'
  );

const fluxOf = (u: UnitState) =>
  u.statuses.find((s) => s.type === 'strategy_flux') as
    | { type: 'strategy_flux'; steps: Array<{ low: number; high: number }> }
    | undefined;

describe('敛微穷极 · 策略伤害浮动（数据 = 包内 6 档表）', () => {
  it('数据：浮动态是逐回合 6 档，且每档自带成长率（机制 82 / 83）', () => {
    // 主战法是指挥型（一类指挥 prep），initialOutput 只在 CommandSkill 上；
    // 状态类输出既可能是单个 CreateStatus 也可能是数组（奇佐鬼谋那种「随机 1 种」），这里只认单个
    const skill = SKILL_REGISTRY.lianwei_qiongji as CommandSkill;
    const fluxOut = skill.initialOutput?.find(
      (o) =>
        o.kind === 'inflict_status' &&
        !Array.isArray(o.status) &&
        o.status.type === 'strategy_flux'
    );
    expect(fluxOut).toBeTruthy();
    const fluxCreate = (fluxOut as Extract<SkillOutput, { kind: 'inflict_status' }>).status as {
      steps: Array<{ low: number; high: number; lowGrowthRate?: number; highGrowthRate?: number }>;
    };
    expect(fluxCreate.steps.map((s) => [s.low, s.high])).toEqual(PACKAGE_STEPS);
    // 上限逐档收敛（0.15 → 0.125），下限从 0 起涨（官方只标「上限受谋略属性影响」）
    expect(fluxCreate.steps.map((s) => s.highGrowthRate)).toEqual([0.15, 0.145, 0.14, 0.135, 0.13, 0.125]);
    expect(fluxCreate.steps.map((s) => s.lowGrowthRate)).toEqual([0, 0.025, 0.05, 0.075, 0.1, 0.125]);
  });

  it('谋略 80：施加后 6 档 = 包内原值（不放大）', () => {
    const { pals } = scene({ flux: true, strategy: 80 });
    for (const u of pals) {
      const flux = fluxOf(u);
      expect(flux).toBeTruthy();
      expect(flux!.steps.map((s) => [s.low, s.high])).toEqual(PACKAGE_STEPS);
    }
  });

  it('谋略 180：区间与终值一起放大（第 1 回合 80.0~165.0、第 6 回合 127.5）', () => {
    const { pals } = scene({ flux: true, strategy: 180 });
    const steps = fluxOf(pals[0])!.steps;
    expect(steps[0]).toEqual({ low: 80, high: 165 }); // 下限成长 0 → 仍 80
    expect(steps[1]).toEqual({ low: 89.5, high: 157.1 });
    expect(steps[5]).toEqual({ low: 127.5, high: 127.5 });
  });

  it('谋略 < 80：按 scaledValue 的回落口径，下限低于基准 80', () => {
    const { pals } = scene({ flux: true, strategy: 60 });
    expect(fluxOf(pals[0])!.steps[0].low).toBeLessThan(80);
  });

  it('施加时写一条 description 正确的状态行（首档区间 + 收敛后的末档，含谋略缩放）', () => {
    const { ctx } = scene({ flux: true, strategy: 180 });
    const line = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'strategy_flux'
    );
    expect(line?.detail).toContain('80.0%~165.0%');
    expect(line?.detail).toContain('127.5%（固定）');
  });
});

describe('敛微穷极 · 每击伤害率 = 基础率 × 档位内随机系数', () => {
  it('第 1 回合：系数落在 80~165，事件写 damageRate 与 rateFlux，且同回合多次施放不重复', () => {
    const { ctx, caster, pals, foes } = scene({ flux: true, strategy: 180 });
    for (let i = 0; i < 5; i++) cast(ctx, caster, pals, foes);
    const hits = strategyHits(ctx);
    expect(hits.length).toBe(5);
    const factors: number[] = [];
    for (const h of hits) {
      expect(h.rateFlux).toBeTruthy();
      const { low, high, factor } = h.rateFlux!;
      expect([low, high]).toEqual([80, 165]);
      expect(factor).toBeGreaterThanOrEqual(low);
      expect(factor).toBeLessThanOrEqual(high);
      // 伤害率 = 基础率 × 系数（两端都按 0.1% 取整，故留 0.2% 容差）
      const expected = (TEST_STRATEGY_RATE * factor) / 100;
      expect(Math.abs(h.damageRate! - expected)).toBeLessThan(0.2);
      factors.push(factor);
    }
    // 浮动真的在动：同一回合 5 次不会全是同一个系数
    expect(new Set(factors).size).toBeGreaterThan(1);
  });

  it('第 6 回合：区间收敛到一点，系数恒为 127.5%、伤害率恒为 255%', () => {
    const { ctx, caster, pals, foes } = scene({ flux: true, strategy: 180 });
    ctx.currentRound = 6;
    cast(ctx, caster, pals, foes);
    cast(ctx, caster, pals, foes);
    const hits = strategyHits(ctx);
    expect(hits.length).toBe(2);
    for (const h of hits) {
      expect(h.rateFlux).toEqual({ low: 127.5, high: 127.5, factor: 127.5 });
      expect(h.damageRate).toBe(255);
    }
  });

  it('没有浮动时：伤害率恒为基础值，事件不带 rateFlux', () => {
    const { ctx, caster, pals, foes } = scene({ flux: false, strategy: 180 });
    cast(ctx, caster, pals, foes);
    cast(ctx, caster, pals, foes);
    const hits = strategyHits(ctx);
    expect(hits.length).toBe(2);
    for (const h of hits) {
      expect(h.rateFlux).toBeUndefined();
      expect(h.damageRate).toBe(TEST_STRATEGY_RATE);
    }
  });
});

describe('敛微穷极 · 详情战报（runBattle 真事件流）', () => {
  beforeAll(async () => {
    await initHeroDB();
  });

  /** 刘徽（一类指挥）+ 迷阵 / 楚歌四起 的友军，打不还手木桩 8 回合 */
  function run(seed: number) {
    const liuhui = level40(HERO_REGISTRY['h814'], {}, 9000);
    const caster = withSkills(gen('caster', '中军'), { activeSkillIds: ['mizhen', 'chuge_siqi'] });
    return runBattle({
      myTeam: [liuhui, caster, gen('pacer', '前锋')],
      enemyTeam: [gen('e1', '前锋'), gen('e2', '中军'), gen('e3', '大营')],
      seed,
      maxRounds: 8,
      inertSides: ['enemy'],
    });
  }

  it('每条策略伤害都带伤害率；浮动生效的还带本回合区间，区间随时间单调收敛', () => {
    const report = run(7);
    const hits = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.damageType === 'strategy'
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.damageRate).toBeGreaterThan(0);

    const fluxed = hits.filter((h) => h.rateFlux);
    expect(fluxed.length).toBeGreaterThan(0);
    for (const h of fluxed) {
      const { low, high, factor } = h.rateFlux!;
      expect(factor).toBeGreaterThanOrEqual(low);
      expect(factor).toBeLessThanOrEqual(high);
    }
    // 区间随时间单调收敛：事件流按时间顺序，故相邻两条满足「下限不降、上限不升」
    for (let i = 1; i < fluxed.length; i++) {
      const prev = fluxed[i - 1].rateFlux!;
      const cur = fluxed[i].rateFlux!;
      expect(cur.low).toBeGreaterThanOrEqual(prev.low);
      expect(cur.high).toBeLessThanOrEqual(prev.high);
    }
    // 8 回合跑完必然收敛到第 6 档：两端相等，且系数就是该端点
    const converged = fluxed.filter((h) => h.rateFlux!.low === h.rateFlux!.high);
    expect(converged.length).toBeGreaterThan(0);
    for (const h of converged) expect(h.rateFlux!.factor).toBe(h.rateFlux!.low);
  });

  it('状态行随回合收敛：有「收敛至」状态变更行，且首档区间出现在第 1 回合的施加行里', () => {
    const report = run(11);
    const conv = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_changed' }> =>
        e.type === 'status_changed' && e.statusType === 'strategy_flux'
    );
    expect(conv.length).toBeGreaterThan(0);
    expect(conv.every((e) => e.detail.includes('收敛至'))).toBe(true);
    // 施加行（准备阶段一次）必须写明首档区间与末档终值，不能再是写死的 80%~150%/115%
    const applied = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'strategy_flux'
    );
    expect(applied.length).toBeGreaterThan(0);
    for (const a of applied) {
      expect(a.detail).toContain('80.0%~');
      expect(a.detail).toContain('（固定）');
    }
  });

  it('DoT 不参与浮动：dot_tick 不带 rateFlux（挂上时冻结）', () => {
    const report = run(13);
    const dots = report.events.filter((e) => e.type === 'dot_tick');
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) expect('rateFlux' in d).toBe(false);
  });
});
