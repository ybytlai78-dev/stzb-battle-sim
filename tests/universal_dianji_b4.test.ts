/**
 * 典籍战法批次 4（`dateyuan/通用战法待添加名单.md` §三 收官 6 张）：
 *   悬权而动（A 指挥 200241）/ 九变之利（A 准备主动 200243）/ 知己知彼（A 指挥 200249）/
 *   兵者诡道（A 被动 200253）/ 奇正之势（B 主动 200815）/ 计险远近（A 指挥 200248）。
 * 下架：兵者诡道（策略 170% / 恢复 150% 受谋略、官方未给系数）——其余 5 张全文无「受 XX 属性影响」→ 上架。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  applyDamage,
  consumeEvasion,
  effectiveMorale,
  inflictStatus,
  tickRoundStartStatuses,
  triggerActiveSkill,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, DamageModifiers, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isLearnableSkillListed } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 20000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
    ...extra,
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

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动战法`);
  return s;
}

function asCommand(id: string): Extract<Skill, { type: 'command' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥战法`);
  return s;
}

/** 直接释放（跳过准备、发动率固定 1） */
function castActive(ctx: CombatContext, unit: UnitState, skillId: string): void {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

/** 只「试图发动」一次主动战法（发动率 0 → 必定不释放，但会走试图发动钩子） */
function attemptActive(ctx: CombatContext, unit: UnitState, skillId: string): void {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 0 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

const dmg = (ctx: CombatContext, id: string) => ctx.events.filter((e) => e.type === 'damage' && e.skillId === id);

function magnitude(rate: number): DamageModifiers {
  return {
    caused: [{ unitId: 'x', skillId: 'probe', skillName: '试探增伤', rate, direction: 'caused' }],
    taken: [],
    reduce: [],
  };
}

const statusOf = <T extends Status['type']>(u: UnitState, type: T) =>
  u.statuses.find((s): s is Extract<Status, { type: T }> => s.type === type);

// ── 悬权而动 ──────────────────────────────────────────────────────

describe('悬权而动（A 指挥·一类·距离 3·友军群体 2：前 2 回合士气 <160 时伤害后 +3；第 3 回合起士气最高友军增伤 30%）', () => {
  it('装配：allyDealStack 士气跟踪（endRound 2 / requireMoraleBelow 160 / +3 可叠）+ 第 3 回合行动起 once 增伤', () => {
    const s = asCommand('xuanquan_erdong');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect(s.output).toHaveLength(0);
    const stack = s.allyDealStack;
    expect(Array.isArray(stack)).toBe(false);
    expect(stack).toMatchObject({
      endRound: 2,
      requireMoraleBelow: 160,
      status: { type: 'morale_boost', amount: 3, duration: 999, stack: true },
      initialStatus: { type: 'morale_boost', amount: 0, duration: 999, stack: true },
    });
    const seg = s.onActSegments?.[0];
    expect(seg).toMatchObject({ startRound: 3, once: true });
    expect(seg?.output[0]).toMatchObject({
      kind: 'inflict_status',
      targetPick: 'highest_morale_ally',
      status: { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused' },
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('xuanquan_erdong')).toBe(true);
  });

  it('窗口 1~2 回合：锁定 2 名友军；造成伤害后 +3 士气，第 3 回合起不再叠', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['xuanquan_erdong'] });
    const ctx = makeCtx(
      [makeUnit(carrier), makeUnit(dummy('a1', '前锋')), makeUnit(dummy('a2', '中军'))],
      [makeUnit(dummy('e', '前锋', { maxTroops: 99999 }), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    expect(ctx.lockedCommands[0].targets.length).toBe(2);
    const tracked = ctx.lockedCommands[0].targets;
    expect(tracked.every((t) => statusOf(t, 'morale_boost'))).toBe(true);

    const before = effectiveMorale(tracked[0]);
    applyDamage(ctx, ctx.enemyTeam[0], 500, tracked[0], 'physical', 'basic', magnitude(0.1));
    expect(effectiveMorale(tracked[0])).toBe(before + 3);
    // 另一名被锁定友军没出手 → 不动
    expect(effectiveMorale(tracked[1])).toBe(before);

    ctx.currentRound = 3;
    applyDamage(ctx, ctx.enemyTeam[0], 500, tracked[0], 'physical', 'basic', magnitude(0.1));
    expect(effectiveMorale(tracked[0])).toBe(before + 3); // 窗口关闭
  });

  it('士气门槛 160：158 → 160 边缘只吃到 <160 的那一次（159 → 162 后不再加）', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['xuanquan_erdong'] });
    const me = makeUnit(dummy('a1', '前锋', { morale: 158 }));
    const ctx = makeCtx([me, makeUnit(carrier)], [makeUnit(dummy('e', '前锋', { maxTroops: 99999 }), 'enemy')]);
    triggerCommandSkills(ctx, ctx.myTeam[1]);
    // carrier 已行动/未锁定？锁定池 = 友军全体按 group 2 抽 2 人 → 2 人队必含 a1
    expect(ctx.lockedCommands[0].targets.includes(me)).toBe(true);

    applyDamage(ctx, ctx.enemyTeam[0], 500, me, 'physical', 'basic', magnitude(0.1));
    expect(effectiveMorale(me)).toBe(161);
    applyDamage(ctx, ctx.enemyTeam[0], 500, me, 'physical', 'basic', magnitude(0.1));
    expect(effectiveMorale(me)).toBe(161); // 已 ≥160，不再叠
  });

  it('第 3 回合自身行动：当下士气最高友军获得 +30% 造成增伤（once，整场只一次）', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['xuanquan_erdong'] });
    const hi = makeUnit(dummy('hi', '前锋', { morale: 140 }));
    const lo = makeUnit(dummy('lo', '中军', { morale: 120 }));
    const ctx = makeCtx([hi, lo, makeUnit(carrier)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    triggerCommandSkills(ctx, ctx.myTeam[2]);

    ctx.currentRound = 3;
    actUnit(ctx, ctx.myTeam[2]);
    const boost = statusOf(hi, 'damage_boost');
    expect(boost?.rate).toBeCloseTo(0.3, 5);
    expect(boost?.direction).toBe('caused');
    expect(boost?.remaining).toBe(999);
    expect(statusOf(lo, 'damage_boost')).toBeUndefined();

    // once：第 4 回合不再重挂（hi 的增伤不刷新为叠加）
    ctx.currentRound = 4;
    actUnit(ctx, ctx.myTeam[2]);
    expect(hi.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(1);
  });
});

// ── 九变之利 ──────────────────────────────────────────────────────

describe('九变之利（A 准备主动·距离 4·40%·敌军群体 2：控制/持续伤害/否则 三分支 + 攻击 180%）', () => {
  it('装配：prepare / groupCount 2 / 三条逐目标状态门槛 + 怯战或动摇 + 攻击 180%', () => {
    const s = asActive('jiubian_zhili');
    expect(s.prepare).toBe(true);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    expect(s.output).toHaveLength(5);
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      requireTargetStatuses: ['confusion', 'rampage', 'cowardice', 'hesitation'],
      status: { type: 'defense_buff', amount: -35, duration: 2 },
    });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      requireTargetStatuses: ['confusion', 'rampage', 'cowardice', 'hesitation'],
      status: { type: 'strategy_buff', amount: -35, duration: 2 },
    });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      requireTargetStatuses: ['sorcery', 'burning', 'panic', 'curse', 'ignite'],
      status: { type: 'damage_boost', rate: 0.4, duration: 2, direction: 'taken' },
    });
    expect(s.output[3]).toMatchObject({
      kind: 'inflict_status',
      status: [
        { type: 'cowardice', duration: 2 },
        { type: 'panic', duration: 2, rate: 90, growthRate: 0 },
      ],
    });
    expect(s.output[4]).toMatchObject({ kind: 'physical_damage', rate: 180 });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('jiubian_zhili')).toBe(true);
  });

  it('控制轨优先：控制目标只降防/谋，带 DoT 目标只吃受伤 +40%，两者都挨 180% 攻击', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['jiubian_zhili'] });
    const e1 = makeUnit(dummy('e1', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e2', '大营'), 'enemy');
    const ctx = makeCtx([makeUnit(me)], [e1, e2]);
    inflictStatus(ctx, e1, { type: 'confusion', duration: 2 }, 'passive', 'probe');
    inflictStatus(ctx, e2, { type: 'burning', duration: 2, rate: 100, growthRate: 0 }, 'passive', 'probe');
    ctx.events.length = 0;

    castActive(ctx, ctx.myTeam[0], 'jiubian_zhili');

    // 控制分支：防 / 谋 −35，且不吃受伤提升、不落控制
    expect(statusOf(e1, 'defense_buff')?.amount).toBe(-35);
    expect(statusOf(e1, 'strategy_buff')?.amount).toBe(-35);
    expect(statusOf(e1, 'damage_boost')).toBeUndefined();
    // DoT 分支：受伤 +40%（攻击 + 策略），且不吃属性下降
    expect(statusOf(e2, 'damage_boost')).toMatchObject({ rate: 0.4, direction: 'taken', remaining: 2 });
    expect(statusOf(e2, 'defense_buff')).toBeUndefined();
    expect(statusOf(e2, 'strategy_buff')).toBeUndefined();
    // 两目标各吃一次 180% 攻击
    expect(dmg(ctx, 'jiubian_zhili')).toHaveLength(2);
  });

  it('否则分支：无状态目标进入怯战或动摇（二选一），并同样挨攻击', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['jiubian_zhili'] });
    const e1 = makeUnit(dummy('e1', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e2', '大营'), 'enemy');
    const ctx = makeCtx([makeUnit(me)], [e1, e2]);
    castActive(ctx, ctx.myTeam[0], 'jiubian_zhili');
    for (const foe of ctx.enemyTeam) {
      const ctrl = statusOf(foe, 'cowardice');
      const panic = statusOf(foe, 'panic');
      // 恰好落一种，且都是 2 回合
      expect([ctrl, panic].filter(Boolean)).toHaveLength(1);
      expect((ctrl ?? panic)?.remaining).toBe(2);
      expect(foe.statuses.some((s) => s.type === 'defense_buff' || s.type === 'damage_boost')).toBe(false);
    }
    expect(dmg(ctx, 'jiubian_zhili')).toHaveLength(2);
  });
});

// ── 知己知彼 ──────────────────────────────────────────────────────

describe('知己知彼（A 指挥·一类·距离 5·敌我群体：我方造成侧 / 敌方受到侧各两条独立轨 60% ×8% ×5 层）', () => {
  it('装配：allyDealStack 两条造成轨（60%）+ initialOutput / onHurt 两条受到轨（60%）', () => {
    const s = asCommand('zhiji_zhibi');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    const dealt = s.allyDealStack;
    expect(Array.isArray(dealt)).toBe(true);
    const dealtTracks = Array.isArray(dealt) ? dealt : [];
    expect(dealtTracks.map((c) => c.damageType)).toEqual(['physical', 'strategy']);
    for (const c of dealtTracks) {
      expect(c.rate).toBe(0.6);
      expect(c.status).toMatchObject({
        type: 'damage_boost',
        rate: 0.08,
        direction: 'caused',
        stack: true,
        maxStacks: 5,
      });
    }
    expect(s.initialOutput?.map((o) => o.kind)).toEqual(['inflict_status', 'inflict_status']);
    const hurts = Array.isArray(s.onHurt) ? s.onHurt : [];
    expect(hurts.map((h) => h.damageKind)).toEqual(['physical', 'strategy']);
    for (const h of hurts) {
      expect(h.rate).toBe(0.6);
      expect(h.victim).toBe('enemy');
      expect(h.applyTo).toBe('victim');
    }
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('zhiji_zhibi')).toBe(true);
  });

  it('准备阶段：我方 3 将各带造成轨 2 条、敌军 3 将各带受到轨 2 条（免费首层）', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['zhiji_zhibi'] });
    const ctx = makeCtx(
      [makeUnit(carrier), makeUnit(dummy('a1', '前锋')), makeUnit(dummy('a2', '中军'))],
      [makeUnit(dummy('e1', '前锋'), 'enemy'), makeUnit(dummy('e2', '大营'), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    for (const u of ctx.myTeam) {
      const tracks = u.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
      );
      expect(tracks).toHaveLength(2);
      expect(tracks.every((t) => t.direction === 'caused' && t.rate === 0.08 && t.stacks === 1)).toBe(true);
    }
    for (const u of ctx.enemyTeam) {
      const tracks = u.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
      );
      expect(tracks).toHaveLength(2);
      expect(tracks.every((t) => t.direction === 'taken' && t.rate === 0.08 && t.stacks === 1)).toBe(true);
    }
  });

  it('两种效果独立判断：一次物理伤害后我方造成轨 / 敌军受到轨各自 60% 判定、类型轨互不影响、封顶 5 层', () => {
    let observed: { allyPhys: number; foePhys: number; causedStrategy: number; takenStrategy: number } | undefined;
    for (let seed = 1; seed <= 60 && !observed; seed += 1) {
      const carrier = dummy('carrier', '大营', { commandSkillIds: ['zhiji_zhibi'] });
      const ally = makeUnit(dummy('a1', '前锋'));
      const ctx = makeCtx([ally, makeUnit(carrier)], [makeUnit(dummy('e1', '前锋', { maxTroops: 99999 }), 'enemy')], seed);
      triggerCommandSkills(ctx, ctx.myTeam[1]);
      const foe = ctx.enemyTeam[0];
      // 单次物理伤害：同时走我方「造成匹配伤害」与敌方「受到匹配伤害」两条钩子
      for (let i = 0; i < 8; i += 1) {
        applyDamage(ctx, foe, 500, ally, 'physical', 'basic', magnitude(0.1));
        ally.troops = ally.general.maxTroops;
      }
      const allyTracks = ally.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
      );
      const foeTracks = foe.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
      );
      const allyPhys = allyTracks.find((s) => s.damageType === 'physical')!;
      const allyStr = allyTracks.find((s) => s.damageType === 'strategy')!;
      const foePhys = foeTracks.find((s) => s.damageType === 'physical')!;
      const foeStr = foeTracks.find((s) => s.damageType === 'strategy')!;
      // 至少两条物理轨都触发过（证明「独立判断」下同一事件可分别命中）
      if ((allyPhys.stacks ?? 1) > 1 && (foePhys.stacks ?? 1) > 1) {
        observed = { allyPhys: allyPhys.stacks!, foePhys: foePhys.stacks!, causedStrategy: allyStr.stacks!, takenStrategy: foeStr.stacks! };
      }
      // 物理轨数值 = 0.08 × 层数，封顶 5 层；另一类型轨不动
      expect(allyPhys.rate).toBeCloseTo(0.08 * (allyPhys.stacks ?? 1), 5);
      expect(foePhys.rate).toBeCloseTo(0.08 * (foePhys.stacks ?? 1), 5);
      expect(allyPhys.stacks).toBeLessThanOrEqual(5);
      expect(foePhys.stacks).toBeLessThanOrEqual(5);
      expect(allyStr.stacks).toBe(1);
      expect(foeStr.stacks).toBe(1);
    }
    expect(observed).toBeTruthy();
    expect(observed!.causedStrategy).toBe(1);
    expect(observed!.takenStrategy).toBe(1);
  });
});

// ── 兵者诡道 ──────────────────────────────────────────────────────

describe('兵者诡道（A 被动·距离 5·自己：每试图发动 3 次主动或追击后随机触发三选一）', () => {
  it('装配：attemptEvery.every=3 + random_pick 三选项（策略 170% / 规避 2 层 / 自身+友军恢复 150%）', () => {
    const s = SKILL_REGISTRY['bingzhe_guidao'];
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(s.output).toHaveLength(0);
    expect(s.attemptEvery?.every).toBe(3);
    const pick = s.attemptEvery?.output[0];
    expect(pick?.kind).toBe('random_pick');
    if (pick?.kind !== 'random_pick') throw new Error('期望 random_pick');
    expect(pick.count).toBe(1);
    expect(pick.options).toHaveLength(3);
    expect(pick.options[0][0]).toMatchObject({ kind: 'strategy_damage', rate: 170, strategyScaled: true });
    expect(pick.options[0][0]).not.toHaveProperty('growthRate');
    expect(pick.options[1][0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'evasion', stacks: 2 },
    });
    expect(pick.options[2][0]).toMatchObject({ kind: 'heal', rate: 150, strategyScaled: true, growthRate: 0, target: 'self' });
    expect(pick.options[2][1]).toMatchObject({
      kind: 'heal',
      rate: 150,
      strategyScaled: true,
      growthRate: 0,
      targetSide: 'ally',
      targetMode: 'random_single',
      excludeSelf: true,
    });
  });

  it('下架：策略 170% / 恢复 150% 受谋略成长未确认', () => {
    expect(isLearnableSkillListed('bingzhe_guidao')).toBe(false);
  });

  it('计数：前 2 次试图发动主动不触发、第 3 次触发一次（active 与 pursuit 共用同一计数）', () => {
    const me = dummy('me', '前锋', { passiveSkillIds: ['bingzhe_guidao'] });
    const ctx = makeCtx([makeUnit(me), makeUnit(dummy('a1', '中军'))], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    attemptActive(ctx, ctx.myTeam[0], 'jizhan');
    attemptActive(ctx, ctx.myTeam[0], 'jizhan');
    const key = `${me.id}:bingzhe_guidao`;
    expect(ctx.skillAttemptCounters?.get(key)).toBe(2);
    // 第 2 次后还没有任何触发效果
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'bingzhe_guidao')).toBe(false);
    ctx.events.length = 0;
    attemptActive(ctx, ctx.myTeam[0], 'jizhan');
    expect(ctx.skillAttemptCounters?.get(key)).toBe(3);
    const fired =
      ctx.events.some((e) => e.type === 'damage' && e.skillId === 'bingzhe_guidao') ||
      ctx.events.some((e) => e.type === 'heal' && e.skillId === 'bingzhe_guidao') ||
      ctx.myTeam[0].statuses.some((s) => s.type === 'evasion');
    expect(fired).toBe(true);
  });

  it('多次种子覆盖：三种随机效果都可触发（策略伤害 / 规避 2 层 / 双恢复）', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40 && seen.size < 3; seed += 1) {
      const me = dummy('me', '前锋', { passiveSkillIds: ['bingzhe_guidao'] });
      const ally = dummy('a1', '中军');
      const ctx = makeCtx(
        [makeUnit(me), makeUnit(ally)],
        [makeUnit(dummy('e', '前锋', { maxTroops: 99999 }), 'enemy')],
        seed
      );
      // 掉兵 → 恢复分支才有恢复量（满兵 + 空伤兵池时不产生 heal 事件）
      ctx.myTeam.forEach((u) => (u.troops -= 6000));
      attemptActive(ctx, ctx.myTeam[0], 'jizhan');
      attemptActive(ctx, ctx.myTeam[0], 'jizhan');
      attemptActive(ctx, ctx.myTeam[0], 'jizhan');
      if (ctx.events.some((e) => e.type === 'damage' && e.skillId === 'bingzhe_guidao')) seen.add('damage');
      if (ctx.myTeam[0].statuses.some((s) => s.type === 'evasion' && s.stacks === 2)) seen.add('evasion');
      if (ctx.events.some((e) => e.type === 'heal' && e.skillId === 'bingzhe_guidao')) seen.add('heal');
    }
    expect([...seen].sort()).toEqual(['damage', 'evasion', 'heal']);
  });
});

// ── 奇正之势 ──────────────────────────────────────────────────────

describe('奇正之势（B 主动·距离 4·30%·敌军单体：240% 猛攻 + 攻击最高友军首试主动时二段 220% / 无视 30% 防御）', () => {
  it('装配：240% 攻击 + allyActiveAttemptStrike（最高攻击友军 / ignore_def 30% 1 回合 + 220% 攻击）', () => {
    const s = asActive('qizheng_zhishi');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.3);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 240 });
    expect(s.allyActiveAttemptStrike?.targetPick).toBe('highest_attack_ally');
    expect(s.allyActiveAttemptStrike?.output[0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'ignore_def', rate: 0.3, duration: 1 },
    });
    expect(s.allyActiveAttemptStrike?.output[1]).toMatchObject({
      kind: 'physical_damage',
      rate: 220,
      targetSide: 'enemy',
      targetMode: 'random_single',
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('qizheng_zhishi')).toBe(true);
  });

  it('释放：一段 240% 归施法者；同时把标记登记到**攻击最高友军**（排除施法者自身）', () => {
    const carrier = dummy('carrier', '大营', { activeSkillIds: ['qizheng_zhishi'] });
    const ctx = makeCtx(
      [makeUnit(dummy('hit', '前锋', { attack: 200 })), makeUnit(dummy('mid', '中军', { attack: 100 })), makeUnit(carrier)],
      [makeUnit(dummy('e', '前锋', { maxTroops: 99999 }), 'enemy')]
    );
    castActive(ctx, ctx.myTeam[2], 'qizheng_zhishi');
    const hits = dmg(ctx, 'qizheng_zhishi');
    expect(hits).toHaveLength(1);
    expect((hits[0] as Extract<BattleEvent, { type: 'damage' }>).sourceId).toBe('carrier');
    expect(ctx.allyActiveMarks).toHaveLength(1);
    expect(ctx.allyActiveMarks?.[0].unitId).toBe('hit');
  });

  it('二段：该友军首次试图发动主动战法时，由该友军打出 220% 并获得无视 30% 防御（标记消耗）', () => {
    const carrier = dummy('carrier', '大营', { activeSkillIds: ['qizheng_zhishi'] });
    const hit = dummy('hit', '前锋', { attack: 200, activeSkillIds: ['jizhan'] });
    const ctx = makeCtx(
      [makeUnit(hit), makeUnit(dummy('mid', '中军', { attack: 100 })), makeUnit(carrier)],
      [makeUnit(dummy('e', '前锋', { maxTroops: 99999 }), 'enemy')]
    );
    castActive(ctx, ctx.myTeam[2], 'qizheng_zhishi');
    ctx.events.length = 0;

    // 该友军试图发动主动（发动率 0 → 不释放本体，但「试图发动」即触发二段）
    attemptActive(ctx, ctx.myTeam[0], 'jizhan');
    const second = dmg(ctx, 'qizheng_zhishi');
    expect(second).toHaveLength(1);
    expect((second[0] as Extract<BattleEvent, { type: 'damage' }>).sourceId).toBe('hit');
    expect((second[0] as Extract<BattleEvent, { type: 'damage' }>).damageType).toBe('physical');
    // 该友军获得 1 回合无视 30% 防御
    expect(statusOf(ctx.myTeam[0], 'ignore_def')?.rate).toBeCloseTo(0.3, 5);
    // 标记消耗，第二次试图发动不再触发
    expect(ctx.allyActiveMarks ?? []).toHaveLength(0);
    ctx.events.length = 0;
    attemptActive(ctx, ctx.myTeam[0], 'jizhan');
    expect(dmg(ctx, 'qizheng_zhishi')).toHaveLength(0);
  });
});

// ── 计险远近 ──────────────────────────────────────────────────────

describe('计险远近（A 指挥·一类·距离 5·我军全体：3 将基础攻击距离均不同时大营无规避 / 中军三属性 +20 / 前锋每回合首次减伤 50% / 全军普攻后受伤 +15%）', () => {
  it('装配：teamAttackRangeDistinct 门闩 + 大营 ignore_evasion(throughRound) / 中军三 buff / 前锋回合减伤 charges 1 / basicHitProc', () => {
    const s = asCommand('jixian_yuanjin');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.teamAttackRangeDistinct).toBe(true);
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      positions: ['大营'],
      status: { type: 'ignore_evasion', duration: 999, throughRound: 999 },
    });
    expect(s.output[1]).toMatchObject({ kind: 'inflict_status', positions: ['中军'], applyAll: true });
    if (s.output[1].kind !== 'inflict_status' || !Array.isArray(s.output[1].status)) throw new Error('期望属性数组');
    expect(s.output[1].status).toMatchObject([
      { type: 'attack_buff', amount: 20, duration: 999 },
      { type: 'defense_buff', amount: 20, duration: 999 },
      { type: 'strategy_buff', amount: 20, duration: 999 },
    ]);
    expect(s.roundStartRepeat?.output[0]).toMatchObject({
      kind: 'inflict_status',
      positions: ['前锋'],
      status: { type: 'damage_reduce', rate: 0.5, duration: 1, charges: 1 },
    });
    expect(s.basicHitProc?.rate).toBe(1);
    expect(s.basicHitProc?.output[0]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'damage_boost', rate: 0.15, duration: 1, direction: 'taken', stack: true },
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('jixian_yuanjin')).toBe(true);
  });

  it('门闩满足：大营获得整场无视规避、中军三属性 +20、每回合前锋首次减伤；不满足则整次不生效', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['jixian_yuanjin'] });
    const ctx = makeCtx(
      [
        makeUnit(dummy('front', '前锋', { attackRange: 2 })),
        makeUnit(dummy('mid', '中军', { attackRange: 3 })),
        makeUnit(carrier),
      ],
      [makeUnit(dummy('e', '前锋'), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[2]);
    const back = statusOf(ctx.myTeam[2], 'ignore_evasion');
    expect(back?.throughRound).toBe(999);
    const mid = ctx.myTeam[1];
    expect(statusOf(mid, 'attack_buff')?.amount).toBe(20);
    expect(statusOf(mid, 'defense_buff')?.amount).toBe(20);
    expect(statusOf(mid, 'strategy_buff')?.amount).toBe(20);
    expect(statusOf(ctx.myTeam[0], 'damage_reduce')).toBeUndefined();
    tickRoundStartStatuses(ctx);
    expect(statusOf(ctx.myTeam[0], 'damage_reduce')).toMatchObject({ rate: 0.5, charges: 1 });

    // 基础攻击距离并非两两不同 → 整次不生效
    const dup = makeCtx(
      [
        makeUnit(dummy('front', '前锋', { attackRange: 2 })),
        makeUnit(dummy('mid', '中军', { attackRange: 2 })),
        makeUnit(dummy('carrier2', '大营', { commandSkillIds: ['jixian_yuanjin'], attackRange: 3 })),
      ],
      [makeUnit(dummy('e', '前锋'), 'enemy')]
    );
    triggerCommandSkills(dup, dup.myTeam[2]);
    tickRoundStartStatuses(dup);
    for (const u of dup.myTeam) {
      expect(u.statuses.some((x) => x.type === 'ignore_evasion' || x.type === 'attack_buff' || x.type === 'damage_reduce')).toBe(false);
    }
    expect(dup.basicHitProcs ?? []).toHaveLength(0);
  });

  it('大营伤害无视规避（throughRound 不消耗）；我军任意普攻命中后给目标挂受伤 +15%', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['jixian_yuanjin'] });
    const ctx = makeCtx(
      [
        makeUnit(dummy('front', '前锋', { attackRange: 2, attack: 200 })),
        makeUnit(dummy('mid', '中军', { attackRange: 3 })),
        makeUnit(carrier),
      ],
      [makeUnit(dummy('e', '前锋', { maxTroops: 99999 }), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[2]);
    expect(ctx.basicHitProcs).toHaveLength(3);

    // 规避判定：大营带 throughRound 型 ignore_evasion → 不消耗目标规避、直接命中
    const foe = ctx.enemyTeam[0];
    inflictStatus(ctx, foe, { type: 'evasion', stacks: 1 }, 'passive', 'probe');
    expect(consumeEvasion(ctx, foe, 'carrier')).toBe(false);
    expect(statusOf(foe, 'evasion')?.stacks).toBe(1); // 未消耗
    // 清掉规避，避免挡住下面这次普攻
    foe.statuses = foe.statuses.filter((s) => s.type !== 'evasion');

    // 我军前锋普攻命中 → 攻击目标获得「受到所有伤害 +15%（可叠加）」
    actUnit(ctx, ctx.myTeam[0]);
    const debuff = statusOf(foe, 'damage_boost');
    expect(debuff?.rate).toBeCloseTo(0.15, 5);
    expect(debuff?.direction).toBe('taken');
    expect(debuff?.sourceSkillId).toBe('jixian_yuanjin');
  });
});
