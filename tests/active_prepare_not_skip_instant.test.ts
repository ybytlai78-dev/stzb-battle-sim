/**
 * 主动战法判定 · 准备槽（用户 2026-09-22 口径）：
 *  ① 准备战法判定成功「开始准备」后，本回合**其余主动照常判定**（瞬发 / 其他准备战法都不跳过）；
 *  ② 准备槽**按战法**记录（`UnitState.preparations`），同一武将可同时准备多个主动战法；
 *  ③ 释放的那一回合只跳过「被释放的这个战法」的发动率判定，其余主动照常判定；
 *  ④ 准备中的战法在准备期间不再判定（防同一战法重复登记）。
 *
 * 用户示例（双准备）：第 1 回合判 A 成功（登记 A 准备槽）/ B 失败 →
 * 第 2 回合释放 A，且继续判 B（B 成功后登记自己的准备槽）→ 第 3 回合释放 B。
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
    preparations: [],
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

/** 准备主动（发动率 1；可选 prepareTurns） */
function prepSkill(id: string, prepareTurns?: number): Skill {
  return {
    id,
    name: `测试准备主动${id}`,
    type: 'active',
    prepare: true,
    ...(prepareTurns != null ? { prepareTurns } : {}),
    range: 5,
    triggerRate: 1,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
  };
}

/** 瞬发主动（发动率 1） */
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
  output: [{ kind: 'physical_damage', rate: 100 }],
};

/** 装配司马师（主战法运筹决胜走 before_active 钩子） */
function simashiWith(activeSkillIds: string[]): UnitState {
  const g = dummy('simashi', '中军');
  g.name = '司马师';
  g.commandSkillIds = ['yunchou_juesheng'];
  g.activeSkillIds = activeSkillIds;
  return makeUnit(g);
}

/** 覆盖 ctx 里某个战法的发动率（让某回合成功 / 失败可控） */
function setRate(ctx: CombatContext, skillId: string, rate: number): void {
  const s = ctx.skills.get(skillId);
  if (!s) throw new Error(`测试战法 ${skillId} 未注册`);
  ctx.skills.set(skillId, { ...s, triggerRate: rate } as Skill);
}

/** 关闭运筹决胜的两段 effect（隔离主动判定本身） */
function muteYunchou(ctx: CombatContext): void {
  const s = ctx.skills.get('yunchou_juesheng');
  if (!s || s.type !== 'command') throw new Error('运筹决胜未注册');
  ctx.skills.set('yunchou_juesheng', { ...s, output: [] });
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

function prepareEnds(ctx: CombatContext) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'prepare_end' }> => e.type === 'prepare_end' && e.success
  );
}

describe('主动战法：进入准备不跳过其余主动；准备槽按战法记录', () => {
  it('准备在先：准备战法成功「开始准备」后，瞬发主动仍照常判定并发动', () => {
    const u = simashiWith(['test_prep', 'test_instant']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', prepSkill('test_prep'));
    ctx.skills.set('test_instant', INSTANT);
    muteYunchou(ctx);

    actUnit(ctx, u);

    const prepStart = ctx.events.find((e) => e.type === 'prepare_start');
    expect(prepStart && prepStart.type === 'prepare_start' && prepStart.skillId).toBe('test_prep');
    expect(u.preparations).toEqual([{ skillId: 'test_prep', left: 1 }]);

    // 瞬发主动：必须仍然进入发动率判定（旧实现整段被跳过 → 这里为空）
    const instantTrigger = triggersOf(ctx, 'test_instant');
    expect(instantTrigger).toHaveLength(1);
    expect(instantTrigger[0].success).toBe(true);
    expect(damageOf(ctx, 'test_instant').length).toBeGreaterThanOrEqual(1);
    const instantIdx = ctx.events.findIndex(
      (e) => e.type === 'skill_trigger' && e.skillId === 'test_instant'
    );
    expect(instantIdx).toBeGreaterThan(ctx.events.indexOf(prepStart!));

    // 下回合：释放准备中的战法，且**被释放的战法本回合不再做发动率判定**
    ctx.events.length = 0;
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(prepareEnds(ctx).map((e) => e.skillId)).toEqual(['test_prep']);
    expect(damageOf(ctx, 'test_prep').length).toBeGreaterThanOrEqual(1);
    expect(triggersOf(ctx, 'test_prep')).toHaveLength(0);
    expect(u.preparations).toHaveLength(0);
  });

  it('瞬发在先：两者都判定，顺序不影响结果', () => {
    const u = simashiWith(['test_instant', 'test_prep']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', prepSkill('test_prep'));
    ctx.skills.set('test_instant', INSTANT);
    muteYunchou(ctx);

    actUnit(ctx, u);

    expect(triggersOf(ctx, 'test_instant')).toHaveLength(1);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'test_prep')).toBe(true);
    const instantDmg = ctx.events.findIndex((e) => e.type === 'damage' && e.skillId === 'test_instant');
    const prepStart = ctx.events.findIndex((e) => e.type === 'prepare_start');
    expect(instantDmg).toBeGreaterThanOrEqual(0);
    expect(instantDmg).toBeLessThan(prepStart);
  });

  it('司马师实战：一准备一瞬发 → 运筹决胜两次「试图发动主动战法」判定（4 条 skill_trigger）', () => {
    const u = simashiWith(['test_prep', 'test_instant']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', prepSkill('test_prep'));
    ctx.skills.set('test_instant', INSTANT);
    // 运筹决胜保持原生两段（暴走 30% / 策略 50%）：每次试图发动 = 2 条 skill_trigger（与成败无关）

    actUnit(ctx, u);

    expect(triggersOf(ctx, 'yunchou_juesheng')).toHaveLength(4);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'test_prep')).toBe(true);
    expect(triggersOf(ctx, 'test_instant')).toHaveLength(1);
  });

  it('用户示例·双准备：第 1 回合 A 成功 / B 失败 → 第 2 回合释放 A 并继续判 B → 第 3 回合释放 B', () => {
    const u = simashiWith(['test_prep', 'test_prep_2']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', prepSkill('test_prep'));
    ctx.skills.set('test_prep_2', prepSkill('test_prep_2'));
    setRate(ctx, 'test_prep_2', 0); // 第 1 回合 B 判定失败
    muteYunchou(ctx);

    // 第 1 回合：A 成功进入准备；B 判定失败
    actUnit(ctx, u);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'test_prep')).toBe(true);
    expect(triggersOf(ctx, 'test_prep_2')).toHaveLength(1);
    expect(triggersOf(ctx, 'test_prep_2')[0].success).toBe(false);
    expect(u.preparations).toEqual([{ skillId: 'test_prep', left: 1 }]);

    // 第 2 回合：释放 A，且继续判定 B（B 这次成功 → 登记 B 自己的准备槽）
    setRate(ctx, 'test_prep_2', 1);
    ctx.events.length = 0;
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(prepareEnds(ctx).map((e) => e.skillId)).toEqual(['test_prep']); // 释放 A
    expect(triggersOf(ctx, 'test_prep')).toHaveLength(0); // 释放回合不再判 A
    expect(triggersOf(ctx, 'test_prep_2')).toHaveLength(1); // 继续判 B
    expect(triggersOf(ctx, 'test_prep_2')[0].success).toBe(true);
    expect(u.preparations).toEqual([{ skillId: 'test_prep_2', left: 1 }]);

    // 第 3 回合：释放 B；A 本回合已空出准备槽 → 按用户口径「其他战法该判定还需要判定」照常判定
    setRate(ctx, 'test_prep', 0); // 让 A 本次判定失败，便于断言
    ctx.events.length = 0;
    ctx.currentRound = 3;
    actUnit(ctx, u);
    expect(prepareEnds(ctx).map((e) => e.skillId)).toEqual(['test_prep_2']);
    expect(triggersOf(ctx, 'test_prep')).toHaveLength(1);
    expect(triggersOf(ctx, 'test_prep')[0].success).toBe(false);
    expect(u.preparations).toHaveLength(0);
  });

  it('释放回合：只跳过被释放的战法，瞬发主动照常判定', () => {
    const u = simashiWith(['test_prep', 'test_instant']);
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep', prepSkill('test_prep'));
    ctx.skills.set('test_instant', INSTANT);
    setRate(ctx, 'test_instant', 0); // 第 1 回合瞬发不发动（隔离出第 2 回合的判定）
    muteYunchou(ctx);

    actUnit(ctx, u);
    expect(u.preparations).toEqual([{ skillId: 'test_prep', left: 1 }]);

    setRate(ctx, 'test_instant', 1);
    ctx.events.length = 0;
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(prepareEnds(ctx).map((e) => e.skillId)).toEqual(['test_prep']); // A 释放
    expect(triggersOf(ctx, 'test_prep')).toHaveLength(0); // A 本回合不再判定
    expect(triggersOf(ctx, 'test_instant')).toHaveLength(1); // B 照常判定
    expect(triggersOf(ctx, 'test_instant')[0].success).toBe(true);
    expect(damageOf(ctx, 'test_instant').length).toBeGreaterThanOrEqual(1);
  });

  it('多准备槽：两个准备战法各自按 prepareTurns 释放（准备期间不重复判定）', () => {
    const u = simashiWith(['test_prep_2turn', 'test_prep']); // A = 2 回合准备，B = 1 回合准备
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([u], [enemy]);
    ctx.skills.set('test_prep_2turn', prepSkill('test_prep_2turn', 2));
    ctx.skills.set('test_prep', prepSkill('test_prep'));
    muteYunchou(ctx);

    // 第 1 回合：两个准备战法都判定成功 → 两个准备槽共存
    actUnit(ctx, u);
    expect(ctx.events.filter((e) => e.type === 'prepare_start')).toHaveLength(2);
    expect(u.preparations).toEqual([
      { skillId: 'test_prep_2turn', left: 2 },
      { skillId: 'test_prep', left: 1 },
    ]);

    // 第 2 回合：B 释放（A 继续准备，left 2→1）；两者本回合都不做发动率判定
    ctx.events.length = 0;
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(prepareEnds(ctx).map((e) => e.skillId)).toEqual(['test_prep']);
    expect(u.preparations).toEqual([{ skillId: 'test_prep_2turn', left: 1 }]);
    expect(triggersOf(ctx, 'test_prep_2turn')).toHaveLength(0);
    expect(triggersOf(ctx, 'test_prep')).toHaveLength(0);

    // 第 3 回合：A 释放；B 本回合已空出准备槽 → 照常判定（让 B 判定失败以便断言）
    setRate(ctx, 'test_prep', 0);
    ctx.events.length = 0;
    ctx.currentRound = 3;
    actUnit(ctx, u);
    expect(prepareEnds(ctx).map((e) => e.skillId)).toEqual(['test_prep_2turn']);
    expect(triggersOf(ctx, 'test_prep')).toHaveLength(1);
    expect(u.preparations).toHaveLength(0);
  });
});
