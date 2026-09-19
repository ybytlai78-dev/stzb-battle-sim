/**
 * 回合持续时间测试（v0.9 / 口径更新 2026-09-18）
 *   规则：行动前施加的计数器回合（准备阶段）→ 回合末递减，持续到第 N+1 回合行动前；
 *        行动中施加的计数器回合（正式回合）→ **携带者行动结束后**递减（duration N = 目标接下来 N 次行动，
 *        与双方出手先后无关；旧口径是「下次行动开始前递减」，目标已出手时只生效 N−1 次）。
 *        例外：priority / counter 仍是行动开始前递减（见 duration.test.ts 末尾与 AGENTS.md）。
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

describe('行动中施加的计数器回合：携带者行动结束后递减（duration = 接下来 N 次行动）', () => {
  it('玄武洰流怯战 duration=2（行动中施加）：连续 2 次行动都被怯战，第 2 次行动结束后移除', () => {
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

    // 回合 2：行动被怯战（无普攻），行动结束后 2→1 仍在
    ctx.currentRound = 2;
    actUnit(ctx, e1);
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'e1')).toHaveLength(0);
    const afterAct = getStatus(e1, 'cowardice');
    expect(afterAct).toBeDefined();
    expect(afterAct!.remaining).toBe(1);

    // 回合 3：第 2 次行动仍被怯战（新口径：先让本次行动生效完），行动结束后 1→0 移除
    ctx.currentRound = 3;
    actUnit(ctx, e1);
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'e1')).toHaveLength(0);
    expect(hasStatus(e1, 'cowardice')).toBe(false);

    // 回合 4：恢复普攻（status 已移除）
    ctx.currentRound = 4;
    actUnit(ctx, e1);
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

// ─── 行动中施加：duration = 目标接下来 N 次行动（2026-09-18 口径）验收对照 ───

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

describe('行动中施加的计数器回合：duration = 目标接下来 N 次行动（A/B 时序对称）', () => {
  it('控制（犹豫）/ 属性（攻击提高）/ DoT（燃烧）：A、B 时序都恰好生效 duration 次（1/2/3）', () => {
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
    }
  });

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
