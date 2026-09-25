/**
 * 主动战法判定：准备战法「开始准备」后**不跳过**其余主动战法的判定（用户 2026-09-22 口径）。
 *
 * 用户场景（战报）：司马师携带 1 个准备主动 + 1 个瞬发主动 —— 准备战法判定成功「开始准备」后，
 * 瞬发主动整段没有被判定（旧实现 `if (unit.isPreparing) break`），连运筹决胜的
 * 「自身每次试图发动主动战法时」都少触发了一次。
 *
 * 保持的边界：引擎只有**单一准备槽**（UnitState.preparingSkillId）→ 本回合已进入准备时，
 * 其余【准备战法】本回合不再判定（否则会覆盖已登记的准备、被覆盖的那个永远不释放）。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function dummy(id: string, position: Position): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
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

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
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

/** 1 回合准备主动（发动率 100%）：判定成功 → prepare_start，下回合行动释放策略伤害 */
const PREP: Skill = {
  id: 'test_prep',
  name: '测试准备主动',
  type: 'active',
  prepare: true,
  range: 5,
  triggerRate: 1,
  targetMode: 'single',
  targetSide: 'enemy',
  tags: ['damage'],
  output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
};

/** 另一个 1 回合准备主动（用于验证单一准备槽） */
const PREP2: Skill = { ...PREP, id: 'test_prep_2', name: '测试准备主动2' };

/** 瞬发主动（发动率 100%） */
const INSTANT: Skill = {
  id: 'test_instant',
  name: '测试瞬发主动',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'single',
  targetSide: 'enemy',
  tags: ['damage'],
  output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
};

/** 装配一套「准备 + 瞬发」的司马师（主战法运筹决胜走 before_active 钩子） */
function simashiWith(activeSkillIds: string[]): UnitState {
  const g = dummy('simashi', '中军');
  g.name = '司马师';
  g.commandSkillIds = ['yunchou_juesheng'];
  g.activeSkillIds = activeSkillIds;
  return makeUnit(g);
}

function skillOf(ctx: CombatContext, id: string): Skill {
  const s = ctx.skills.get(id);
  if (!s) throw new Error(`测试战法 ${id} 未注册`);
  return s;
}

function triggersOf(ctx: CombatContext, skillId: string) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId
  );
}

function damageOf(ctx: CombatContext, skillId: string) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );
}

describe('主动战法判定：进入准备不跳过其余主动', () => {
  it('准备在先：准备战法成功「开始准备」后，瞬发主动仍照常判定并发动', () => {
    const u = simashiWith(['test_prep', 'test_instant']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', PREP);
    ctx.skills.set('test_instant', INSTANT);
    // 关闭运筹决胜的两段 effect，隔离本条（只验证主动判定本身）
    ctx.skills.set('yunchou_juesheng', {
      ...(skillOf(ctx, 'yunchou_juesheng') as Extract<Skill, { type: 'command' }>),
      output: [],
    });

    actUnit(ctx, u);

    // 准备战法：判定成功 → 开始准备
    const prepStart = ctx.events.find((e) => e.type === 'prepare_start');
    expect(prepStart && prepStart.type === 'prepare_start' && prepStart.skillId).toBe('test_prep');
    expect(u.isPreparing).toBe(true);
    expect(u.preparingSkillId).toBe('test_prep');

    // 瞬发主动：必须仍然进入发动率判定（旧实现整段被跳过 → 这里为空）
    const instantTrigger = triggersOf(ctx, 'test_instant');
    expect(instantTrigger).toHaveLength(1);
    expect(instantTrigger[0].success).toBe(true);
    // 并且真的打出了伤害
    expect(damageOf(ctx, 'test_instant').length).toBeGreaterThanOrEqual(1);
    // 时序：准备登记在前、瞬发判定在后（战报里两条都在「主动战法判定」段内）
    const instantIdx = ctx.events.findIndex((e) => e.type === 'skill_trigger' && e.skillId === 'test_instant');
    expect(instantIdx).toBeGreaterThan(ctx.events.indexOf(prepStart!));

    // 下回合：准备中的战法照常释放
    ctx.events.length = 0;
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(ctx.events.some((e) => e.type === 'prepare_end' && e.skillId === 'test_prep')).toBe(true);
    expect(damageOf(ctx, 'test_prep').length).toBeGreaterThanOrEqual(1);
    expect(u.isPreparing).toBe(false);
  });

  it('瞬发在先：两者都判定，顺序不影响结果', () => {
    const u = simashiWith(['test_instant', 'test_prep']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', PREP);
    ctx.skills.set('test_instant', INSTANT);
    ctx.skills.set('yunchou_juesheng', {
      ...(skillOf(ctx, 'yunchou_juesheng') as Extract<Skill, { type: 'command' }>),
      output: [],
    });

    actUnit(ctx, u);

    expect(triggersOf(ctx, 'test_instant')).toHaveLength(1);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'test_prep')).toBe(true);
    // 瞬发在前 → 其伤害先于准备登记
    const instantDmg = ctx.events.findIndex((e) => e.type === 'damage' && e.skillId === 'test_instant');
    const prepStart = ctx.events.findIndex((e) => e.type === 'prepare_start');
    expect(instantDmg).toBeGreaterThanOrEqual(0);
    expect(instantDmg).toBeLessThan(prepStart);
  });

  it('司马师实战：一准备一瞬发 → 运筹决胜两次「试图发动主动战法」判定（4 条 skill_trigger）', () => {
    const u = simashiWith(['test_prep', 'test_instant']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', PREP);
    ctx.skills.set('test_instant', INSTANT);
    // 运筹决胜保持原生两段（暴走 30% / 策略 50%）：每次试图发动 = 2 条 skill_trigger（与是否成功无关）

    actUnit(ctx, u);

    // 两个主动都进入判定 = 2 次 before_active = 4 条；旧实现准备成功后 break → 只有 2 条
    expect(triggersOf(ctx, 'yunchou_juesheng')).toHaveLength(4);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'test_prep')).toBe(true);
    expect(triggersOf(ctx, 'test_instant')).toHaveLength(1);
  });

  it('单一准备槽：本回合已进入准备后，其余【准备战法】不再判定（不覆盖已登记的准备）', () => {
    const u = simashiWith(['test_prep', 'test_prep_2']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', PREP);
    ctx.skills.set('test_prep_2', PREP2);
    ctx.skills.set('yunchou_juesheng', {
      ...(skillOf(ctx, 'yunchou_juesheng') as Extract<Skill, { type: 'command' }>),
      output: [],
    });

    actUnit(ctx, u);

    const prepStarts = ctx.events.filter((e) => e.type === 'prepare_start');
    expect(prepStarts).toHaveLength(1);
    expect(u.preparingSkillId).toBe('test_prep'); // 第二个不覆盖
    expect(triggersOf(ctx, 'test_prep_2')).toHaveLength(0); // 第二个准备战法本回合未被判定
  });
});
