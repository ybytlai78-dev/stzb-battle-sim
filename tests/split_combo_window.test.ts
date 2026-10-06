/**
 * 连击 / 分兵状态的生效窗口（用户口径：每回合独立判定、只在该回合生效）
 * ---------------------------------------------------------------------------
 * 用户报告：长兵方阵官方描述「战斗开始后前 3 回合，使我军群体每回合都有 75.0% 的几率进入分兵状态」，
 *          实战却持续到**第 5 回合**。
 * 根因（两层叠加）：
 *   ① 数据层：`changbing_fangzhen` 的 `roundRepeat` 窗口（1~3）是对的，但分兵状态写成 `duration: 3`
 *      —— 把「判定窗口 3 回合」当成了「状态时长 3 回合」；
 *   ② 引擎层：连击 / 分兵原先落在「行动结束后递减」的行动计数桶，而该桶只在行动**开始**时收集状态
 *      （`markStatusesOnActStart` 早于指挥预备判定 `triggerPreparedEffectOnAct`）→ 目标自己行动时
 *      挂上的 `duration: 1` 在本次行动结束不减，白多覆盖一次行动；再叠加同源刷新（remaining 取 max），
 *      第 3 回合判定成功就把状态续到 3 → 覆盖第 3/4/5 回合。
 * 修复口径（用户确认）：
 *   - 每回合**独立**判定，命中只覆盖该回合（连击 / 分兵归入第 2 组「下次行动前递减」状态）；
 *   - 第 4 回合**行动前**状态即被清除 → 第 4 回合行动时不再持有、也不会再获得分兵 / 连击。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext, type LockedCommand } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  General,
  Position,
  Skill,
  Status,
  UnitState,
} from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

// ─── 单元级夹具（与 split_basic_only.test.ts 同款最小上下文）───

type SplitStatus = Extract<Status, { type: 'split' }>;
type SplitEvent = Extract<BattleEvent, { type: 'split_damage' }>;

function makeUnit(
  id: string,
  opts: { position?: Position; side?: 'my' | 'enemy'; maxTroops?: number } = {}
): UnitState {
  const maxTroops = opts.maxTroops ?? 30000;
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: 200,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: 5,
      maxTroops,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: opts.side ?? 'my',
    troops: maxTroops,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(seed = 7): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 一类指挥：按指定几率锁定预备判定目标（避开 75% 随机，使机制断言确定性） */
function lockWithRepeatRate(
  ctx: CombatContext,
  id: string,
  rate: number,
  casterId: string,
  targets: UnitState[]
): void {
  const base = SKILL_REGISTRY[id];
  if (base.type !== 'command') throw new Error(`${id} 不是指挥战法`);
  const skill: CommandSkill = { ...base, roundRepeat: { ...base.roundRepeat!, rate } };
  ctx.skills.set(id, skill);
  const locked: LockedCommand = { skill, casterId, targets, currentRate: 1 };
  ctx.lockedCommands.push(locked);
}

/** 三敌木桩（保证普攻有相邻目标可溅射、且不会被打死） */
function enemyTrio(): UnitState[] {
  return [
    makeUnit('e1', { side: 'enemy', position: '前锋' }),
    makeUnit('e2', { side: 'enemy', position: '中军' }),
    makeUnit('e3', { side: 'enemy', position: '大营' }),
  ];
}

const splitsOf = (events: BattleEvent[]): SplitEvent[] =>
  events.filter((e): e is SplitEvent => e.type === 'split_damage');

const splitStatusOf = (unit: UnitState): SplitStatus | undefined =>
  unit.statuses.find((s): s is SplitStatus => s.type === 'split');

const normalAttackSegments = (events: BattleEvent[], unitId: string): number =>
  events.filter((e) => e.type === 'unit_act_start' && e.unitId === unitId && e.phase === 'normal_attack').length;

/** 事件流里每个事件的所属回合（按 round_start 推进；准备阶段记 0） */
function withRound(events: BattleEvent[]): Array<{ round: number; ev: BattleEvent }> {
  let round = 0;
  return events.map((ev) => {
    if (ev.type === 'round_start') round = ev.round;
    return { round, ev };
  });
}

// ─── A. 装配 / 数据 ───

describe('长兵方阵：判定窗口 ≠ 状态时长', () => {
  it('装配/数据：roundRepeat 窗口 1~3、每回合 75%；分兵 duration 1、伤害率 60%', () => {
    const s = SKILL_REGISTRY['changbing_fangzhen'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') throw new Error('长兵方阵应为一类指挥');
    expect(s.phase).toBe('prep');
    expect(s.targetSide).toBe('ally');
    expect(s.roundRepeat).toEqual({ startRound: 1, endRound: 3, rate: 0.75 });
    expect(s.tags).toContain('split');

    const statuses = s.output.flatMap((o) =>
      o.kind === 'inflict_status' ? (Array.isArray(o.status) ? o.status : [o.status]) : []
    );
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ type: 'split', duration: 1, rate: 60 });
  });
});

// ─── B/C/D/E. 机制（确定性单元）───

describe('行动中挂上的连击 / 分兵只覆盖本次行动（第 2 组递减口径）', () => {
  it('长兵方阵（预备判定 100%）：第 3 回合判定成功 → 第 4 回合行动时状态已清、无分兵伤害', () => {
    const ctx = makeCtx(11);
    const caster = makeUnit('caster', { position: '大营' });
    const carrier = makeUnit('carrier', { position: '前锋' });
    ctx.myTeam = [carrier, caster];
    ctx.enemyTeam = enemyTrio();
    lockWithRepeatRate(ctx, 'changbing_fangzhen', 1, 'caster', [carrier]);

    // 第 3 回合（窗口最后一回合）行动：判定必中 → 挂分兵 → 本次普攻立即溅射
    ctx.currentRound = 3;
    ctx.events = [];
    actUnit(ctx, carrier);
    expect(splitStatusOf(carrier), '第 3 回合判定成功后应挂上分兵').toBeDefined();
    expect(splitsOf(ctx.events).length, '第 3 回合的普攻应带分兵溅射').toBeGreaterThan(0);
    // 第 2 组口径：本次行动结束补一次递减（remaining 0），状态留到「下一次行动开始前」
    expect(splitStatusOf(carrier)!.remaining).toBe(0);
    expect(splitStatusOf(carrier), '行动结束时状态仍在身（持续到第 4 回合行动前）').toBeDefined();

    // 第 4 回合（窗口已关闭）：行动开始前清除 → 既不再持有、也不再获得
    ctx.currentRound = 4;
    ctx.events = [];
    actUnit(ctx, carrier);
    expect(splitStatusOf(carrier), '第 4 回合行动开始前分兵应被清除').toBeUndefined();
    expect(splitsOf(ctx.events).length, '第 4 回合行动不应再打出分兵').toBe(0);
  });

  it('连击同口径（其疾如风 预备判定 100%）：判定成功本次行动两次普攻，第 4 回合无残留', () => {
    const ctx = makeCtx(12);
    const caster = makeUnit('caster', { position: '大营' });
    const carrier = makeUnit('carrier', { position: '前锋' });
    ctx.myTeam = [carrier, caster];
    ctx.enemyTeam = enemyTrio();
    lockWithRepeatRate(ctx, 'qiji_rufeng', 1, 'caster', [carrier]);

    ctx.currentRound = 1;
    ctx.events = [];
    actUnit(ctx, carrier);
    expect(normalAttackSegments(ctx.events, 'carrier'), '连击 → 本次行动两次普攻').toBe(2);
    const combo = carrier.statuses.find((s) => s.type === 'combo');
    expect(combo, '连击状态应挂上').toBeDefined();
    expect((combo as { remaining: number }).remaining, '行动结束补一次递减 → 0（待下次行动清除）').toBe(0);

    ctx.currentRound = 4;
    ctx.events = [];
    actUnit(ctx, carrier);
    expect(carrier.statuses.some((s) => s.type === 'combo'), '第 4 回合行动开始前连击应被清除').toBe(false);
    expect(normalAttackSegments(ctx.events, 'carrier'), '无连击 → 第 4 回合只有一次普攻').toBe(1);
  });

  it('不变量：分兵 duration N = 接下来 N 次行动（N=2 覆盖两次行动，第 3 次行动开始前移除）', () => {
    const ctx = makeCtx(13);
    const carrier = makeUnit('carrier', { position: '前锋' });
    ctx.myTeam = [carrier];
    ctx.enemyTeam = enemyTrio();
    ctx.currentRound = 1;
    inflictStatus(ctx, carrier, { type: 'split', duration: 2, rate: 60 } as CreateStatus, 'command', 'test_split');

    const roundsWithSplit: number[] = [];
    for (const r of [1, 2, 3]) {
      ctx.currentRound = r;
      ctx.events = [];
      actUnit(ctx, carrier);
      if (splitsOf(ctx.events).length > 0) roundsWithSplit.push(r);
    }
    expect(roundsWithSplit, 'duration 2 → 生效第 1、2 次行动；第 3 次行动开始前移除').toEqual([1, 2]);
    expect(splitStatusOf(carrier)).toBeUndefined();
  });

  it('回归：次数型分兵（charges）仍不按回合递减 —— 跨回合保留、按普攻次数消耗', () => {
    const ctx = makeCtx(14);
    const carrier = makeUnit('carrier', { position: '前锋' });
    ctx.myTeam = [carrier];
    ctx.enemyTeam = enemyTrio();
    ctx.currentRound = 1;
    // duration 1 + charges 2：若被当成「按回合递减」会在第 2 次行动前被摘掉
    inflictStatus(
      ctx,
      carrier,
      { type: 'split', duration: 1, rate: 60, charges: 2 } as CreateStatus,
      'passive',
      'trait_sanshe_split'
    );

    ctx.events = [];
    actUnit(ctx, carrier);
    expect(splitsOf(ctx.events).length, '第 1 次普攻带分兵').toBeGreaterThan(0);
    const afterFirst = splitStatusOf(carrier);
    expect(afterFirst, 'charges 型分兵不因行动结束 / 回合结束被摘').toBeDefined();
    expect(afterFirst!.charges).toBe(1);

    ctx.currentRound = 2;
    ctx.events = [];
    actUnit(ctx, carrier);
    expect(splitsOf(ctx.events).length, '第 2 次普攻仍带分兵（跨回合保留）').toBeGreaterThan(0);
    expect(splitStatusOf(carrier), 'charges 用尽 → 移除').toBeUndefined();
  });
});

// ─── F/G. 端到端（真实战法 + runBattle）───

/** 端到端木桩（兵力给足，避免中盘阵亡把断言打成空跑） */
function e2eDummy(id: string, position: Position, patch: Partial<General> = {}): General {
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
    attack: 120,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 2,
    maxTroops: 30000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

const e2eEnemy = (): General[] => [
  e2eDummy('e1', '前锋'),
  e2eDummy('e2', '中军'),
  e2eDummy('e3', '大营'),
];

describe('端到端：分兵 / 连击不越出各自窗口', () => {
  it('长兵方阵：分兵状态与分兵伤害只出现在第 1~3 回合（第 4 回合起为 0）', () => {
    let sawRound3Grant = false;
    let sawSplit = false;
    for (let seed = 1; seed <= 30; seed++) {
      const report = runBattle({
        seed,
        maxRounds: 8,
        myTeam: [
          e2eDummy('caster', '大营', { commandSkillIds: ['changbing_fangzhen'] }),
          e2eDummy('front', '前锋'),
          e2eDummy('mid', '中军'),
        ],
        enemyTeam: e2eEnemy(),
      });
      for (const { round, ev } of withRound(report.events)) {
        if (ev.type === 'status_inflicted' && ev.statusType === 'split') {
          expect(round, `seed ${seed}：分兵状态只应在第 1~3 回合挂出`).toBeLessThanOrEqual(3);
          if (round === 3) sawRound3Grant = true;
        }
        if (ev.type === 'split_damage') {
          sawSplit = true;
          expect(round, `seed ${seed}：第 ${round} 回合不该再有分兵伤害`).toBeLessThanOrEqual(3);
        }
      }
    }
    expect(sawRound3Grant, '样本里应包含「第 3 回合判定成功」的场景（否则用例空跑）').toBe(true);
    expect(sawSplit, '样本里应打出过分兵伤害（否则用例空跑）').toBe(true);
  });

  it('其疾如风：判定窗口关闭后（第 4 回合起）不再有连击残留 —— 每回合只有 1 次普攻', () => {
    let sawDoubleAttack = false;
    for (let seed = 1; seed <= 8; seed++) {
      const report = runBattle({
        seed,
        maxRounds: 5,
        myTeam: [
          e2eDummy('caster', '中军', { commandSkillIds: ['qiji_rufeng'] }),
          e2eDummy('front', '前锋'),
          e2eDummy('back', '大营'),
        ],
        enemyTeam: e2eEnemy(),
      });
      const perRound = new Map<number, number>();
      for (const { round, ev } of withRound(report.events)) {
        if (ev.type === 'unit_act_start' && ev.unitId === 'caster' && ev.phase === 'normal_attack') {
          perRound.set(round, (perRound.get(round) ?? 0) + 1);
        }
      }
      for (const [round, count] of perRound) {
        if (round <= 3 && count >= 2) sawDoubleAttack = true;
        if (round >= 4) {
          expect(count, `seed ${seed}：第 ${round} 回合连击不该残留（普攻段应只有 1 次）`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(sawDoubleAttack, '样本里应出现「连击触发 → 两次普攻」（否则用例空跑）').toBe(true);
  });
});
