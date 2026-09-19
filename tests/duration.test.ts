/**
 * 回合持续时间测试（v0.9 / 口径更新 2026-09-20）
 *   规则（用户口径 2026-09-20，承接 8032010）：
 *     · 行动前施加的计数器回合（准备阶段 appliedRound=0）→ 回合末递减，「前 N 回合」生效至第 N+1 回合行动前；
 *     · 行动中施加（appliedRound>0）分两组：
 *         第 1 组（DoT：妖术/燃烧/恐慌/妖术诅咒/引燃 + 治愈：急救/休整）→ **携带者行动结束后**递减，
 *              duration N = 目标接下来 N 次行动都生效；
 *         第 2 组（控制：犹豫/怯战/混乱/暴走 + 属性：攻击/防御/谋略/速度 + 增减伤）→ **下次行动开始时递减**：
 *              duration N 仍生效 N 次行动，但状态在第 N 次生效行动结束后**仍在身**，直到「再下一次行动
 *              开始」（actUnit 入口清理）才移除 —— 即移除时点推迟到下一次行动开始，不会白挂；
 *       例外：priority / counter 仍是行动开始前递减（priority 作用在回合初排序；counter 窗口一开就到点）。
 *   连击是主动战法：获得一回合连击，覆盖当次行动；中途再次获得主动类型连击 → 冲突无法挂上。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, actUnit, triggerCommandSkills, hasStatus, getStatus, tickStatuses } from '../src/engine/action';
import { buildPriorityOrder } from '../src/engine/combat';
import type { CombatContext } from '../src/engine/action';
import type { BattleEvent, CreateStatus, Position, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, opts: { position?: Position; attackRange?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: opts.attackRange ?? 3,
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
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

describe('行动前施加（准备阶段）：计数器回合末递减，「前N回合」生效至第 N+1 回合行动前', () => {
  it('避其锋芒 duration=3：行动前施加 → 第1/2/3回末各减1，第4回行动前消失', () => {
    const ctx = makeCtx();
    const wg = makeUnit('caster', { position: '中军' });
    wg.general.commandSkillIds = ['biqi_fengmang'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];

    triggerCommandSkills(ctx, wg); // 准备阶段施加，appliedRound=0, remaining=3
    expect(hasStatus(ally, 'damage_reduce')).toBe(true);

    // 回合 1 结束：3→2，仍有效（第2回合行动前还有）
    ctx.currentRound = 1;
    actUnit(ctx, ally);
    actUnit(ctx, e1);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(ally, 'damage_reduce')).toBe(true);

    // 回合 2 结束：2→1
    ctx.currentRound = 2;
    actUnit(ctx, ally);
    actUnit(ctx, e1);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(ally, 'damage_reduce')).toBe(true);

    // 回合 3 结束：1→0，消失（第4回合行动前不再有减伤）
    ctx.currentRound = 3;
    actUnit(ctx, ally);
    actUnit(ctx, e1);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(ally, 'damage_reduce')).toBe(false);
  });

  it('第4回合行动前已无减伤，验证「前三回合」= 第4回合行动前仍享受、第4回行动后消失', () => {
    const ctx = makeCtx();
    const wg = makeUnit('caster', { position: '中军' });
    wg.general.commandSkillIds = ['biqi_fengmang'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];

    triggerCommandSkills(ctx, wg);
    // 完整推进 3 回合（行动+回合末递减）
    for (let r = 1; r <= 3; r++) {
      ctx.currentRound = r;
      actUnit(ctx, ally);
      actUnit(ctx, e1);
      tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    }
    // 第 4 回合开始行动前：状态已在第 3 回末消失
    ctx.currentRound = 4;
    actUnit(ctx, ally); // 行动前已无减伤
    expect(hasStatus(ally, 'damage_reduce')).toBe(false);
  });
});

describe('行动中施加的计数器回合（第 2 组：控制/属性/增减伤）：下次行动开始时递减、移除推迟到再下一次行动开始', () => {
  it('玄武洰流怯战 duration=2（行动中施加）：连续 2 次行动都被怯战；第 2 次行动结束后仍在身，下次行动开始时移除', () => {
    const ctx = makeCtx();
    const caster = makeUnit('caster', { position: '大营', attackRange: 5 });
    caster.general.activeSkillIds = ['xuanwu_fuliu']; // 主动：全体 150% + 怯战2回
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    const e2 = makeUnit('e2', { position: '中军' });
    e2.side = 'enemy';
    const e3 = makeUnit('e3', { position: '大营' });
    e3.side = 'enemy';
    ctx.myTeam = [caster];
    ctx.enemyTeam = [e1, e2, e3];

    // 回合 1 施放主动战法（seed 7 下大概率发动）
    ctx.currentRound = 1;
    actUnit(ctx, caster);
    const cowardice = getStatus(e1, 'cowardice');
    if (!cowardice) {
      // 若未发动则换高发动率方式直接施加，验证时序语义
      inflictStatus(ctx, e1, { type: 'cowardice', duration: 2 } as CreateStatus, 'active', 'xuanwu_fuliu');
    }
    const c = getStatus(e1, 'cowardice')!;
    expect(c.remaining).toBe(2); // 行动中施加：remaining=duration
    expect(c.appliedRound).toBe(1);

    // 回合 1 末：行动中施加的不递减
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(e1, 'cowardice')).toBe(true);

    // 回合 2：行动开始 2→1（仍生效，无普攻）；行动结束后仍在身
    ctx.currentRound = 2;
    actUnit(ctx, e1);
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'e1')).toHaveLength(0);
    const afterR2 = getStatus(e1, 'cowardice');
    expect(afterR2).toBeDefined();
    expect(afterR2!.remaining).toBe(1);

    // 回合 3：第 2 次行动仍被怯战；行动开始 1→0 只打「下次行动开始时移除」标记，本次行动照常生效，
    // 行动结束后状态**仍在身**（第 2 组的移除时点 = 再下一次行动开始时）
    ctx.currentRound = 3;
    actUnit(ctx, e1);
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'e1')).toHaveLength(0);
    const afterR3 = getStatus(e1, 'cowardice');
    expect(afterR3).toBeDefined();
    expect(afterR3!.remaining).toBe(0);

    // 回合 4：行动开始即清理 → 恢复普攻
    ctx.currentRound = 4;
    expect(hasStatus(e1, 'cowardice')).toBe(true); // 上一次行动结束后仍在身
    actUnit(ctx, e1);
    expect(hasStatus(e1, 'cowardice')).toBe(false);
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'e1').length).toBeGreaterThan(0);
  });
});

describe('连击（主动）：1回合，覆盖当次行动；同类型冲突', () => {
  it('主动连击 duration=1：行动中施加 → 本次行动完整享受连击，行动结束后才移除', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];

    ctx.currentRound = 1;
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'wei_skill');
    const c = getStatus(u, 'combo')!;
    expect(c.remaining).toBe(1);
    expect(c.appliedRound).toBe(1);

    // 本回行动：连击生效（两次普攻）
    actUnit(ctx, u);
    const hits = ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'u');
    expect(hits).toHaveLength(2);

    // 新口径：行动结束才递减 → 本次行动已完整生效，行动结束后 1→0 移除
    expect(hasStatus(u, 'combo')).toBe(false);

    // 回合末不递减（行动中施加；此时已移除）
    tickStatuses(ctx, [u]);
    expect(hasStatus(u, 'combo')).toBe(false);

    // 下回合无连击：单次普攻
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'u')).toHaveLength(3);
    expect(hasStatus(u, 'combo')).toBe(false);
  });

  it('主动连击 vs 主动连击：同类型冲突，后施加被拒', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.currentRound = 1;
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'skill_a');
    const before = getStatus(u, 'combo')!.sourceSkillId;
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'skill_b');
    // 冲突：仍是第一个的连击
    expect(getStatus(u, 'combo')!.sourceSkillId).toBe(before);
    expect(ctx.events.some((e) => e.type === 'status_conflict' && e.statusType === 'combo')).toBe(true);
  });

  it('指挥连击 vs 主动连击：不同类型各自共存', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.currentRound = 1;
    inflictStatus(ctx, u, { type: 'combo', duration: 3 } as CreateStatus, 'command', 'xianqu_tuji');
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'wei_skill');
    expect(u.statuses.filter((s) => s.type === 'combo').length).toBe(2);
  });
});

// ─── 行动中施加：duration = 目标接下来 N 次行动（用户口径 2026-09-20）A/B 时序验收对照 ───
//   A 时序 = 先挂状态再让 B 行动（施加回合 B 尚未出手，appliedRound=1）；
//   B 时序 = 先让 B 行动完再挂状态（appliedRound=1，从下一回合起观察）。
//   两组都要求：生效次数 A = B = duration（1/2/3 对称）；第 2 组另验「移除推迟到再下一次行动开始」。

/** 探针用必中主动战法：单体、100% 发动，便于逐回合统计「该回合是否生效」 */
const PROBE_ACTIVE: Skill = {
  id: 'probe_active',
  name: '必中主动',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'random_single',
  targetSide: 'enemy',
  tags: ['damage'],
  output: [{ kind: 'physical_damage', rate: 100 }],
};

/** B=携带者（带必中主动战法）；A=大营、速度更高（施加者 / DoT 施法者）；E=超大兵力木桩（不会被打死） */
function timingScene(): { ctx: CombatContext; b: UnitState } {
  const a = makeUnit('A', { position: '大营', attackRange: 5 });
  a.general.speed = 100;
  const b = makeUnit('B', { position: '前锋' });
  b.general.speed = 10; // 默认 A 先出手；只有先手（priority）生效时 B 才排第一
  b.general.activeSkillIds = ['probe_active'];
  const e = makeUnit('E', { position: '前锋' });
  e.side = 'enemy';
  e.general.maxTroops = 999999;
  e.troops = 999999;
  const ctx = makeCtx();
  ctx.myTeam = [a, b];
  ctx.enemyTeam = [e];
  ctx.skills.set('probe_active', PROBE_ACTIVE);
  return { ctx, b };
}

/** A 时序 = 先挂状态再让 B 行动（B 在施加回合尚未出手）；
 *  B 时序 = 先让 B 行动再挂状态（施加回合 B 已出手）。两者都构造 appliedRound=1。 */
function applyByTiming(ctx: CombatContext, b: UnitState, timing: 'A' | 'B', create: CreateStatus | null): void {
  ctx.currentRound = 1;
  if (timing === 'A') {
    if (create) inflictStatus(ctx, b, create, 'active', 'probe_src', 'A');
  } else {
    actUnit(ctx, b); // 先出手（此时无状态）
    if (create) inflictStatus(ctx, b, create, 'active', 'probe_src', 'A');
  }
}

const observeRounds = (timing: 'A' | 'B'): number[] => (timing === 'A' ? [1, 2, 3, 4] : [2, 3, 4, 5]);

/** 逐回合推进 4 个观察回合，返回「该回合状态是否生效」的次数 */
function observeRoundsEffective(
  timing: 'A' | 'B',
  create: CreateStatus,
  measure: (roundEvents: BattleEvent[]) => boolean
): number {
  const { ctx, b } = timingScene();
  applyByTiming(ctx, b, timing, create);
  let hits = 0;
  for (const r of observeRounds(timing)) {
    ctx.currentRound = r;
    const mark = ctx.events.length;
    actUnit(ctx, b);
    if (measure(ctx.events.slice(mark))) hits += 1;
  }
  return hits;
}

const activeSkillCasts = (events: BattleEvent[]): number =>
  events.filter((e) => e.type === 'damage' && e.skillId === 'probe_active').length;

const dotTicks = (events: BattleEvent[]): number => events.filter((e) => e.type === 'dot_tick').length;

const damageDealt = (events: BattleEvent[]): number =>
  events.reduce((sum, e) => {
    if (e.type === 'damage' || e.type === 'attack_hit' || e.type === 'split_damage') return sum + e.damage;
    return sum;
  }, 0);

/** 属性类判定走「同种子有/无该状态」的伤害对照（不读 statuses，避免把「行动内先删」误判为生效） */
function observeAttributeEffective(timing: 'A' | 'B', create: CreateStatus): number {
  const run = (withStatus: boolean): number[] => {
    const { ctx, b } = timingScene();
    applyByTiming(ctx, b, timing, withStatus ? create : null);
    const out: number[] = [];
    for (const r of observeRounds(timing)) {
      ctx.currentRound = r;
      const mark = ctx.events.length;
      actUnit(ctx, b);
      out.push(damageDealt(ctx.events.slice(mark)));
    }
    return out;
  };
  const withStatus = run(true);
  const without = run(false);
  return withStatus.filter((v, i) => v > without[i]).length;
}

/** 第 1 组治愈（first_aid）探针：E 每回合先手用必中主动打 B（构成「受击」触发急救），B 再行动（行动结束递减）。
 *  生效次数 = heal 事件（skillId=probe_aid）次数。 */
function aidScene(): { ctx: CombatContext; b: UnitState; e: UnitState } {
  const b = makeUnit('B', { position: '前锋' });
  b.general.speed = 10;
  const e = makeUnit('E', { position: '前锋' });
  e.side = 'enemy';
  e.general.attack = 300; // 每回合伤害 >> 恢复量，保证兵力池不为空、每回合都有 heal 事件
  e.general.speed = 100;
  e.general.activeSkillIds = ['probe_active'];
  e.general.maxTroops = 999999;
  e.troops = 999999;
  const ctx = makeCtx();
  ctx.myTeam = [b];
  ctx.enemyTeam = [e];
  ctx.skills.set('probe_active', PROBE_ACTIVE);
  // 持续型急救的触发率走战法级计数器（直构状态时手工建一个 100% 的）
  ctx.firstAidCounters = [{ skillId: 'probe_aid', casterId: 'A', rate: 100, triggerCount: 0 }];
  return { ctx, b, e };
}

function observeAidEffective(timing: 'A' | 'B', duration: number): number {
  const { ctx, b, e } = aidScene();
  const create = {
    type: 'first_aid',
    healRate: 100,
    healGrowthRate: 0,
    triggerUpEvery: 0,
    triggerUpIncrement: 0,
    duration,
  } as CreateStatus;
  ctx.currentRound = 1;
  if (timing === 'A') {
    inflictStatus(ctx, b, create, 'command', 'probe_aid', 'A');
  } else {
    actUnit(ctx, e); // 回合 1：先让 B 受击 + 行动完
    actUnit(ctx, b);
    inflictStatus(ctx, b, create, 'command', 'probe_aid', 'A');
  }
  let hits = 0;
  for (const r of observeRounds(timing)) {
    ctx.currentRound = r;
    const mark = ctx.events.length;
    actUnit(ctx, e); // 先手打 B → 触发急救
    actUnit(ctx, b); // 行动结束 → 递减
    if (ctx.events.slice(mark).some((ev) => ev.type === 'heal' && ev.skillId === 'probe_aid')) hits += 1;
  }
  return hits;
}

describe('行动中施加的计数器回合：duration = 目标接下来 N 次行动（第 1/2 组 A/B 时序都对称）', () => {
  it('第 2 组控制（犹豫）/ 属性（攻击提高）+ 第 1 组 DoT（燃烧）/ 治愈（急救）：A、B 都恰好生效 duration 次（1/2/3）', () => {
    for (const d of [1, 2, 3]) {
      const hesA = observeRoundsEffective('A', { type: 'hesitation', duration: d }, (evs) => activeSkillCasts(evs) === 0);
      const hesB = observeRoundsEffective('B', { type: 'hesitation', duration: d }, (evs) => activeSkillCasts(evs) === 0);
      expect([hesA, hesB], `犹豫 duration ${d}`).toEqual([d, d]);

      const buffA = observeAttributeEffective('A', { type: 'attack_buff', amount: 50, duration: d });
      const buffB = observeAttributeEffective('B', { type: 'attack_buff', amount: 50, duration: d });
      expect([buffA, buffB], `攻击提高 duration ${d}`).toEqual([d, d]);

      const dotA = observeRoundsEffective('A', { type: 'burning', rate: 100, growthRate: 0, duration: d }, (evs) => dotTicks(evs) > 0);
      const dotB = observeRoundsEffective('B', { type: 'burning', rate: 100, growthRate: 0, duration: d }, (evs) => dotTicks(evs) > 0);
      expect([dotA, dotB], `燃烧 duration ${d}`).toEqual([d, d]);

      const aidA = observeAidEffective('A', d);
      const aidB = observeAidEffective('B', d);
      expect([aidA, aidB], `急救 duration ${d}`).toEqual([d, d]);
    }
  });

  it('第 2 组移除时点（关键）：duration 1 生效完本次行动后仍在身；A 在下一次行动开始时移除、B 在 N+2 行动开始时移除', () => {
    // A 时序：回合 1 挂 → 回合 1 行动生效（未发动主动）→ 行动结束后仍在身 → 回合 2 行动开始（actUnit 入口）才移除
    const runA = () => {
      const { ctx, b } = timingScene();
      applyByTiming(ctx, b, 'A', { type: 'hesitation', duration: 1 });
      ctx.currentRound = 1;
      actUnit(ctx, b);
      const afterOwnAct = hasStatus(b, 'hesitation'); // 本次行动结束后仍在身
      const castsR1 = activeSkillCasts(ctx.events);
      ctx.currentRound = 2;
      actUnit(ctx, b); // 下一次行动开始 → 入口清理
      const afterNextAct = hasStatus(b, 'hesitation');
      return { afterOwnAct, afterNextAct, castsR1, castsR2: activeSkillCasts(ctx.events) - castsR1 };
    };
    expect(runA()).toEqual({ afterOwnAct: true, afterNextAct: false, castsR1: 0, castsR2: 1 });

    // B 时序：回合 1 行动完再挂 → N+1（回合 2）行动生效 → N+1 行动结束后仍在身 → N+2（回合 3）行动开始才移除
    const runB = () => {
      const { ctx, b } = timingScene();
      applyByTiming(ctx, b, 'B', { type: 'hesitation', duration: 1 });
      const base = activeSkillCasts(ctx.events); // 回合 1 已出手
      ctx.currentRound = 2;
      actUnit(ctx, b); // N+1 行动：生效
      const afterN1Act = hasStatus(b, 'hesitation');
      const castsN1 = activeSkillCasts(ctx.events) - base;
      ctx.currentRound = 3;
      actUnit(ctx, b); // N+2 行动开始 → 入口清理
      const afterN2Act = hasStatus(b, 'hesitation');
      return { afterN1Act, afterN2Act, castsN1, castsN2: activeSkillCasts(ctx.events) - base - castsN1 };
    };
    expect(runB()).toEqual({ afterN1Act: true, afterN2Act: false, castsN1: 0, castsN2: 1 });
  });
});

describe('例外：priority / counter 仍是「行动开始前递减 + 即时移除」', () => {
  it('priority 例外：先手作用在回合初排序，仍是行动开始前递减（A、B 时序各 1 回合）', () => {
    const count = (timing: 'A' | 'B'): number => {
      const { ctx, b } = timingScene();
      applyByTiming(ctx, b, timing, { type: 'priority', duration: 1 } as CreateStatus);
      let hits = 0;
      // 施加回合的排序发生在施加之前，两个时序都从回合 2 起观察
      for (const r of [2, 3, 4, 5]) {
        ctx.currentRound = r;
        if (buildPriorityOrder([...ctx.myTeam, ...ctx.enemyTeam], r, ctx.skills)[0] === b) hits += 1;
        actUnit(ctx, b);
      }
      return hits;
    };
    expect(count('A')).toBe(1);
    expect(count('B')).toBe(1);
  });

  it('counter 例外：窗口仍是「携带者下次行动开始前」，不因本次行动结束而延长', () => {
    const presence = (timing: 'A' | 'B'): boolean[] => {
      const { ctx, b } = timingScene();
      applyByTiming(ctx, b, timing, { type: 'counter', rate: 100, duration: 1 } as CreateStatus);
      const out: boolean[] = [];
      for (const r of [2, 3, 4, 5]) {
        ctx.currentRound = r;
        out.push(hasStatus(b, 'counter'));
        actUnit(ctx, b);
      }
      return out;
    };
    // 回合 2 开始前仍带着反击；携带者行动一开始即移除（不会被延长到行动结束）
    expect(presence('A')).toEqual([true, false, false, false]);
    expect(presence('B')).toEqual([true, false, false, false]);
  });
});
