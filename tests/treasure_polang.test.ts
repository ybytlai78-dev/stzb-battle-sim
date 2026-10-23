/**
 * 沧海「破浪」回归（报障 2026-10-23：宝物增伤不生效）。
 *
 * 机制链：受击钩子 `updateTreasureOnHurt` 让 `hurt_stack(mode:'boost')` +1 层（≤10）→
 * `hurtStackBoostOf` 把 `stacks × perStack` 并入造成侧增伤 → `buffMult` 求和。
 *
 * 时点口径（用户 2026-10-23 二轮明确，**这是唯一正确口径**）：
 * 「破浪是每回合独立计算，如第一回合受到 8 次攻击叠加八层增伤，到**大回合结束**才会清除，
 *   而非行动前移除」。
 * ⇒ 清零发生在**回合结束时**（`tickStatuses` 的 `hurt_stack` 分支），**不在回合开始**，
 *    更不在单位行动前。本回合受击叠出的层数整回合有效，下一回合从 0 层重新累积。
 *    清零前发一条 `status_changed` 标注，战报能看出本回合实际吃到的层数。
 * 同状态类型的【不屈】（`mode:'reduce'`）共用同一时点。
 */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/engine/combat';
import {
  inflictStatus,
  tickRoundStartStatuses,
  tickStatuses,
  type CombatContext,
} from '../src/engine/action';
import { buildTreasureStatuses } from '../src/engine/treasure';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';

const TREASURE = { treasureId: 1108, level: 10 };

function gen(p: Partial<General> & { id: string; position: General['position'] }): General {
  return {
    name: p.id,
    rarity: '5星',
    cost: 3,
    faction: '蜀',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    attack: 120,
    defense: 120,
    strategy: 100,
    speed: 50,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...p,
  };
}

function dummyUnit(id: string, position: Position, side: 'my' | 'enemy' = 'my'): UnitState {
  const g = gen({ id, position });
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
    hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 往单位身上挂一条真实的「破浪」（走 buildTreasureStatuses，保证形状与线上一致） */
function attachPolang(ctx: CombatContext, unit: UnitState): Extract<Status, { type: 'hurt_stack' }> {
  const entry = buildTreasureStatuses(TREASURE, unit.general).find((e) => e.create.type === 'hurt_stack');
  expect(entry).toBeDefined();
  inflictStatus(ctx, unit, entry!.create, 'passive', entry!.sourceId, unit.general.id);
  const status = unit.statuses.find(
    (s): s is Extract<Status, { type: 'hurt_stack' }> => s.type === 'hurt_stack' && s.mode === 'boost'
  );
  expect(status).toBeDefined();
  return status!;
}

/** 我方前锋 t0 带沧海，敌方三人同速 60、攻 300（必然打 t0）。返回事件流 */
function events(withTreasure = true): BattleEvent[] {
  const t0 = gen({
    id: 't0',
    position: '前锋',
    attack: 150,
    defense: 150,
    speed: 60,
    ...(withTreasure ? { treasure: TREASURE } : {}),
  });
  const my = [t0, gen({ id: 't1', position: '中军', attack: 100 }), gen({ id: 't2', position: '大营', attack: 100 })];
  const ef = ([0, 1, 2] as const).map((i) =>
    gen({ id: 'e' + i, position: (['前锋', '中军', '大营'] as const)[i], attack: 300, defense: 100, speed: 60 })
  );
  return runBattle({ myTeam: my, enemyTeam: ef, seed: 11, maxRounds: 4 }).events;
}

describe('沧海 · 破浪受击叠层增伤', () => {
  it('佩戴沧海后挂上破浪叠层状态（hurt_stack / boost）；不戴则一条都不挂', () => {
    const on = events(true).filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'hurt_stack' && e.unitId === 't0'
    );
    expect(on.length).toBe(1);
    const off = events(false).filter((e) => e.type === 'status_changed' || e.type === 'status_inflicted');
    expect(off.some((e) => (e as { statusType?: string }).statusType === 'hurt_stack')).toBe(false);
  });

  it('时点：回合开始**不**清零（tickRoundStartStatuses 后层数原样保留）', () => {
    const ctx = makeCtx([dummyUnit('t0', '前锋')], [dummyUnit('e0', '前锋', 'enemy')]);
    const unit = ctx.myTeam[0];
    const status = attachPolang(ctx, unit);
    status.stacks = 8;

    tickRoundStartStatuses(ctx);

    expect(status.stacks).toBe(8);
    expect(ctx.events.filter((e) => e.type === 'status_changed')).toHaveLength(0);
  });

  it('时点：回合结束清零 + 一条「本回合叠至 N 层」标注', () => {
    const ctx = makeCtx([dummyUnit('t0', '前锋')], [dummyUnit('e0', '前锋', 'enemy')]);
    const unit = ctx.myTeam[0];
    const status = attachPolang(ctx, unit);
    status.stacks = 8;

    tickStatuses(ctx, [unit]);

    expect(status.stacks).toBe(0);
    const notices = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_changed' }> =>
        e.type === 'status_changed' && e.statusType === 'hurt_stack'
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].detail).toContain('【破浪】本回合叠至 8 层（造成伤害 +80%）');
    expect(notices[0].detail).toContain('回合结束清除');
  });

  it('战斗级：标注出现在该回合 round_end 之前（清零发生在回合末）', () => {
    const evts = events(true);
    const notices = evts
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === 'status_changed' && e.statusType === 'hurt_stack' && e.unitId === 't0');
    expect(notices.length).toBeGreaterThan(0);

    const roundEnds = evts
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === 'round_end')
      .map(({ i }) => i);

    for (const { e, i } of notices) {
      const n = e as Extract<BattleEvent, { type: 'status_changed' }>;
      expect(n.detail).toContain('【破浪】');
      expect(n.detail).toContain('回合结束清除');
      const next = roundEnds.find((x) => x > i);
      expect(next).toBeDefined();
      const stacks = Number(n.detail.match(/(\d+) 层/)![1]);
      expect(stacks).toBeGreaterThanOrEqual(1);
      expect(stacks).toBeLessThanOrEqual(10);
    }
  });
});
