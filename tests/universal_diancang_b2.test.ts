/**
 * 典藏战法 · 第二批（5 张，2026-09-21 批次）：
 *   威震逍遥 / 当阳桥 / 正始之变 / 定军山 / 七擒七纵。
 * 覆盖：装配口径 / 主效果结算 / 新增机制（普攻触发动摇、延迟回合施加、敌军伤害门槛 + 再次发动、
 *       选中大营、全队前 N 次抵挡）/【追加】段 / 成长率留空与下架登记。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, TroopType, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isLearnableSkillListed } from '../src/data/listing';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  removeDebuffs,
  tickRoundStartStatuses,
  triggerActiveSkill,
  triggerCommandSkills,
  triggerPendingRoundOutputs,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';

function dummy(
  id: string,
  position: Position,
  opts: {
    troops?: number;
    name?: string;
    faction?: string;
    troopType?: TroopType;
    attack?: number;
    activeSkills?: string[];
    commandSkills?: string[];
    passiveSkills?: string[];
  } = {}
): General {
  return {
    id,
    name: opts.name ?? `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: opts.faction ?? '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: opts.troopType ?? 'infantry',
    position,
    attack: opts.attack ?? 120,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 3,
    maxTroops: opts.troops ?? 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: opts.activeSkills ?? [],
    passiveSkillIds: opts.passiveSkills ?? [],
    commandSkillIds: opts.commandSkills ?? [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function unitFrom(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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
    hasActedThisRound: false,
  };
}

function makeCtx(my: General[], enemies?: General[], seed = 7): CombatContext {
  const foe = enemies ?? [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')];
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: foe.map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (!s || s.type !== 'active') throw new Error(`${id} 不是主动战法`);
  return s;
}
function asCommand(id: string): Extract<Skill, { type: 'command' }> {
  const s = SKILL_REGISTRY[id];
  if (!s || s.type !== 'command') throw new Error(`${id} 不是指挥战法`);
  return s;
}

function castActive(
  ctx: CombatContext,
  skillId: string,
  patch: Partial<Extract<Skill, { type: 'active' }>> = {},
  caster?: UnitState
): void {
  const copy = { ...asActive(skillId), triggerRate: 1, ...patch } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  const u = caster ?? ctx.myTeam[0];
  triggerActiveSkill(ctx, u, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);
const statusesOf = (u: UnitState, type: string) => u.statuses.filter((s) => s.type === type);
const evs = (ctx: CombatContext, type: string) => ctx.events.filter((e) => e.type === type);
const dmgEvs = (ctx: CombatContext, skillId?: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && (skillId == null || e.skillId === skillId)
  );
const attackHits = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');

// ────────────────────────────── 威震逍遥 ──────────────────────────────

describe('威震逍遥（A 主动 4 · 30% · 敌军群体 2）', () => {
  it('装配：动摇 = panic{普攻触发 · 2 次 · 不可移除}；受伤提升 24% 受速度；【追加】张辽无视规避', () => {
    const s = asActive('weizhen_xiaoyao');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.3);
    expect(s.groupCount).toBe(2);
    expect(s.output.map((o) => o.kind)).toEqual(['conditional', 'conditional', 'inflict_status']);
    const zhangliao = s.output[0];
    if (zhangliao.kind !== 'conditional') throw new Error('段型不符');
    expect(zhangliao.require?.casterNames).toEqual(['张辽']);
    const st = zhangliao.outputs[0];
    if (st.kind !== 'inflict_status' || Array.isArray(st.status) || st.status.type !== 'panic') throw new Error('状态段不符');
    expect(st.status.rate).toBe(125);
    expect(st.status.triggerOnBasic).toBe(true);
    expect(st.status.charges).toBe(2);
    expect(st.status.duration).toBe(2);
    expect(st.status.ignoresEvasionOnTick).toBe(true);
    expect(st.status.undispellable).toBe(true);
    expect(st.status.growthRate).toBe(0); // DoT 必填字段：未给系数 → 按基值
    const other = s.output[1];
    if (other.kind !== 'conditional') throw new Error('段型不符');
    const st2 = other.outputs[0];
    if (st2.kind !== 'inflict_status' || Array.isArray(st2.status) || st2.status.type !== 'panic') throw new Error('状态段不符');
    expect(st2.status.ignoresEvasionOnTick).toBeUndefined();
    const boost = s.output[2];
    if (boost.kind !== 'inflict_status' || Array.isArray(boost.status) || boost.status.type !== 'damage_boost') {
      throw new Error('状态段不符');
    }
    expect(boost.status.rate).toBe(0.24);
    expect(boost.status.direction).toBe('taken');
    expect(boost.status.damageType).toBe('physical');
    expect(boost.status.speedScaled).toBe(true);
    expect(boost.status.growthRate).toBeUndefined();
    expect(boost.status.undispellable).toBe(true);
  });

  it('释放：敌军群体各挂普攻触发动摇 + 受伤提升', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'weizhen_xiaoyao', { groupCount: 3 });
    expect(ctx.enemyTeam.filter((u) => statusOf(u, 'panic'))).toHaveLength(3);
    expect(ctx.enemyTeam.filter((u) => statusOf(u, 'damage_boost'))).toHaveLength(3);
    // 行动时不跳伤（普攻触发口径）：给目标加怯战使其本回合无法普攻 → 行动阶段无 dot_tick
    const target = ctx.enemyTeam[0];
    inflictStatus(ctx, target, { type: 'cowardice', duration: 1 }, 'active', 'other');
    actUnit(ctx, target);
    expect(evs(ctx, 'dot_tick')).toHaveLength(0);
  });

  it('普攻触发：发动普攻跳 1 次逃兵（2 → 1），受到普攻再跳 1 次后移除', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    const target = ctx.enemyTeam[0];
    castActive(ctx, 'weizhen_xiaoyao', { groupCount: 1 });
    // 发动普攻：actUnit 内先 tickDots（跳过）再普攻 → 触发 1 次
    actUnit(ctx, target);
    expect(evs(ctx, 'dot_tick')).toHaveLength(1);
    const mark = statusOf(target, 'panic');
    expect(mark && 'charges' in mark ? mark.charges : 0).toBe(1);
    // 受到普攻：第 2 次触发后用尽移除
    applyDamage(ctx, target, 100, ctx.myTeam[0], 'physical', 'basic');
    expect(evs(ctx, 'dot_tick')).toHaveLength(2);
    expect(statusOf(target, 'panic')).toBeUndefined();
  });

  it('不可移除：removeDebuffs 跳过动摇与受伤提升', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'weizhen_xiaoyao', { groupCount: 1 });
    const target = ctx.enemyTeam[0];
    removeDebuffs(ctx, [target]);
    expect(statusOf(target, 'panic')).toBeTruthy();
    expect(statusOf(target, 'damage_boost')).toBeTruthy();
  });

  it('【追加】张辽：动摇跳伤无视规避（张飞版本被规避）', () => {
    const run = (name: string) => {
      const ctx = makeCtx([dummy('c', '中军', { name })]);
      const target = ctx.enemyTeam[0];
      castActive(ctx, 'weizhen_xiaoyao', { groupCount: 1 });
      inflictStatus(ctx, target, { type: 'evasion', stacks: 1 }, 'active', 'other');
      actUnit(ctx, target); // 发动普攻触发跳伤
      return {
        tick: evs(ctx, 'dot_tick').length,
        evasionLeft: statusesOf(target, 'evasion').length,
      };
    };
    expect(run('张辽')).toEqual({ tick: 1, evasionLeft: 1 });
    expect(run('张飞')).toEqual({ tick: 0, evasionLeft: 0 });
  });

  it('成长率未确认 → 配将池下架', () => {
    expect(isLearnableSkillListed('weizhen_xiaoyao')).toBe(false);
  });
});

// ────────────────────────────── 当阳桥 ──────────────────────────────

describe('当阳桥（S 主动·准备 4 · 25%~40% · 敌军单体）', () => {
  it('装配：混乱 1~2 回合 + 1/2 回合后延迟控制 + 【追加】张飞主动增伤', () => {
    const s = asActive('dangyangqiao');
    expect(s.prepare).toBe(true);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toEqual([0.25, 0.4]);
    const confusion = s.output[0];
    if (confusion.kind !== 'inflict_status' || Array.isArray(confusion.status) || confusion.status.type !== 'confusion') {
      throw new Error('状态段不符');
    }
    if (confusion.status.type !== 'confusion') throw new Error('状态类型不符');
    expect(confusion.status.duration).toEqual([1, 2]);
    const delayed = s.delayedRoundOutputs ?? [];
    expect(delayed.map((d) => d.afterRounds)).toEqual([1, 2]);
    const d1 = delayed[0].output[0];
    const d2 = delayed[1].output[0];
    if (d1.kind !== 'inflict_status' || Array.isArray(d1.status)) throw new Error('段型不符');
    if (d2.kind !== 'inflict_status' || Array.isArray(d2.status)) throw new Error('段型不符');
    expect(d1.status.type).toBe('hesitation');
    expect(d2.status.type).toBe('cowardice');
    expect(delayed.every((d) => d.targetMode === 'group')).toBe(true);
    const bonus = s.output[1];
    if (bonus.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require?.casterNames).toEqual(['张飞']);
    const boost = bonus.outputs[0];
    if (boost.kind !== 'inflict_status' || Array.isArray(boost.status) || boost.status.type !== 'damage_boost') {
      throw new Error('状态段不符');
    }
    expect(boost.status.skillTypes).toEqual(['active']);
    expect(boost.status.duration).toBe(3);
  });

  it('释放：混乱命中 + 两段延迟控制锁定敌军群体', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'dangyangqiao', { prepare: false });
    const confused = ctx.enemyTeam.filter((u) => statusOf(u, 'confusion'));
    expect(confused).toHaveLength(1);
    expect(ctx.pendingRoundOutputs).toHaveLength(2);
    expect(ctx.pendingRoundOutputs!.every((p) => p.targetIds.length === 2)).toBe(true);
    expect(ctx.pendingRoundOutputs!.map((p) => p.atRound)).toEqual([2, 3]);
  });

  it('延迟施加：第 2 回合犹豫、第 3 回合怯战（锁定目标，阵亡跳过）', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'dangyangqiao', { prepare: false });
    const lockedIds = [...ctx.pendingRoundOutputs![0].targetIds];
    const secondIds = [...ctx.pendingRoundOutputs![1].targetIds];
    // 其中一名锁定目标阵亡 → 延迟段只对存活者结算
    const dead = ctx.enemyTeam.find((u) => u.general.id === lockedIds[0]);
    if (dead) dead.alive = false;
    triggerPendingRoundOutputs(ctx, 2);
    const hesitant = ctx.enemyTeam.filter((u) => statusOf(u, 'hesitation')).map((u) => u.general.id);
    expect([...hesitant].sort()).toEqual(lockedIds.filter((id) => id !== lockedIds[0]).sort());
    triggerPendingRoundOutputs(ctx, 3);
    const cowards = ctx.enemyTeam.filter((u) => statusOf(u, 'cowardice')).map((u) => u.general.id);
    expect([...cowards].sort()).toEqual(secondIds.filter((id) => id !== lockedIds[0]).sort());
    expect(cowards).not.toContain(lockedIds[0]);
    expect(ctx.pendingRoundOutputs ?? []).toHaveLength(0);
  });

  it('【追加】张飞：自身主动战法伤害 +10% 持续 3 回合；非张飞不生效', () => {
    const run = (name: string) => {
      const ctx = makeCtx([dummy('c', '中军', { name })]);
      castActive(ctx, 'dangyangqiao', { prepare: false });
      return statusOf(ctx.myTeam[0], 'damage_boost') != null;
    };
    expect(run('张飞')).toBe(true);
    expect(run('关羽')).toBe(false);
  });
});

// ────────────────────────────── 正始之变 ──────────────────────────────

describe('正始之变（S 指挥 · 距离 5 · 自己）', () => {
  it('装配：敌军 15 次伤害门槛（下回合犹豫 + 【追加】司马家恢复）+ 主动/追击再次发动 100%', () => {
    const s = asCommand('zhengshi_zhibian');
    expect(s.phase).toBe('prep');
    expect(s.output).toEqual([]);
    const cfg = s.enemyDamageThreshold;
    expect(cfg?.count).toBe(15);
    expect(cfg?.windowRounds).toBe(1);
    const hesitation = cfg?.output[0];
    if (hesitation?.kind !== 'inflict_status' || Array.isArray(hesitation.status)) throw new Error('段型不符');
    if (hesitation.status.type !== 'hesitation') throw new Error('状态类型不符');
    expect(hesitation.status.duration).toBe(1);
    const bonus = cfg?.output[1];
    if (bonus?.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require?.casterNames).toEqual(['司马懿', '司马师', '司马昭']);
    const heal = bonus.outputs[0];
    if (heal.kind !== 'heal') throw new Error('段型不符');
    expect(heal.rate).toBe(300);
    expect(heal.strategyScaled).toBe(false);
    expect(heal.growthRate).toBe(0);
    expect(s.allyRecast).toEqual({
      rate: 100,
      factor: 1,
      skillTypes: ['active', 'pursuit'],
      everyCast: true,
    });
  });

  it('门槛：敌军累计 15 次伤害 → 下回合开始（犹豫 2 目标 + 司马懿自身恢复）', () => {
    const ctx = makeCtx(
      [dummy('c', '中军', { name: '司马懿', commandSkills: ['zhengshi_zhibian'] }), dummy('a-front', '前锋')],
      [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.myTeam[0].troops = 5000;
    for (let i = 0; i < 15; i++) {
      applyDamage(ctx, ctx.myTeam[1], 50, ctx.enemyTeam[0], 'physical', 'skill');
    }
    expect(ctx.enemyDamageCounters?.get('c:zhengshi_zhibian')).toBe(15);
    expect(ctx.pendingRoundOutputs).toHaveLength(1);
    expect(ctx.pendingRoundOutputs![0].atRound).toBe(2);
    expect(ctx.skillRecastWindows?.get('c:zhengshi_zhibian')).toBe(2);
    triggerPendingRoundOutputs(ctx, 2);
    expect(ctx.enemyTeam.filter((u) => statusOf(u, 'hesitation')).length).toBe(2);
    expect(evs(ctx, 'heal').length).toBeGreaterThan(0);
  });

  it('15 次前不触发；未达标时 allyRecast 不生效', () => {
    const ctx = makeCtx(
      [dummy('c', '中军', { commandSkills: ['zhengshi_zhibian'] }), dummy('a-front', '前锋')],
      [dummy('e1', '前锋'), dummy('e2', '中军')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    applyDamage(ctx, ctx.myTeam[1], 50, ctx.enemyTeam[0], 'physical', 'skill');
    expect(ctx.pendingRoundOutputs ?? []).toHaveLength(0);
    // 未达标：友军成功发动主动战法不触发再次发动
    const ally = ctx.myTeam[1];
    ally.general.activeSkillIds = ['tujin'];
    castActive(ctx, 'tujin', { prepare: false }, ally);
    expect(evs(ctx, 'skill_cast').filter((e) => (e as { skillId: string }).skillId === 'tujin')).toHaveLength(1);
  });

  it('窗口内：友军成功发动主动战法后 100% 再次发动（同一战法两次释放）', () => {
    const ctx = makeCtx(
      [dummy('c', '中军', { commandSkills: ['zhengshi_zhibian'] }), dummy('a-front', '前锋', { activeSkills: ['tujin'] })],
      [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.skillRecastWindows = new Map([['c:zhengshi_zhibian', 2]]);
    ctx.currentRound = 2;
    const ally = ctx.myTeam[1];
    const copy = { ...asActive('tujin'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
    ctx.skills.set('tujin', copy);
    triggerActiveSkill(ctx, ally, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const casts = evs(ctx, 'skill_cast').filter((e) => (e as { skillId: string }).skillId === 'tujin');
    expect(casts).toHaveLength(2);
    const triggers = evs(ctx, 'skill_trigger').filter(
      (e) => (e as { skillId: string }).skillId === 'zhengshi_zhibian'
    );
    expect(triggers.some((t) => (t as { success: boolean }).success)).toBe(true);
  });
});

// ────────────────────────────── 定军山 ──────────────────────────────

describe('定军山（S 指挥 · 距离 5 · 敌军群体 2）', () => {
  it('装配：首个主动/追击战法伤害大幅降低（次数制）+ 第 4 回合强化段', () => {
    const s = asCommand('dingjunshan');
    expect(s.phase).toBe('prep');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    const first = s.output[0];
    if (first.kind !== 'inflict_status' || Array.isArray(first.status) || first.status.type !== 'damage_boost') {
      throw new Error('状态段不符');
    }
    expect(first.status.rate).toBe(-99.99);
    expect(first.status.direction).toBe('caused');
    expect(first.status.skillTypes).toEqual(['active', 'pursuit']);
    expect(first.status.charges).toBe(1);
    const seg = s.onActSegments?.[0];
    expect(seg?.startRound).toBe(4);
    expect(seg?.endRound).toBe(4);
    const boost = seg?.output[0];
    if (boost?.kind !== 'inflict_status' || Array.isArray(boost.status) || boost.status.type !== 'trigger_boost') {
      throw new Error('状态段不符');
    }
    expect(boost.targetPick).toBe('highest_attack_ally');
    expect(boost.status.rate).toBe(1);
    expect(boost.status.attackSkillsOnly).toBe(true);
    expect(boost.status.charges).toBe(1);
    const snipe = seg?.output[1];
    if (snipe?.kind !== 'conditional') throw new Error('段型不符');
    const mark = snipe.outputs[0];
    if (mark.kind !== 'mark_position_snipe') throw new Error('段型不符');
    expect(mark.position).toBe('大营');
    expect(mark.snipeChance).toBe(0.4);
    const snipe2 = seg?.output[2];
    if (snipe2?.kind !== 'conditional') throw new Error('段型不符');
    expect(snipe2.require?.casterNames).toEqual(['黄忠']);
    if (snipe2.outputs[0].kind === 'mark_position_snipe') {
      expect(snipe2.outputs[0].snipeChance).toBe(0.5); // 【追加】黄忠 50%
    }
  });

  it('首个战法伤害大幅降低：敌军首次主动战法伤害被压到下限，且消耗次数', () => {
    const ctx = makeCtx([dummy('c', '中军', { commandSkills: ['dingjunshan'] })], [
      dummy('e1', '前锋', { activeSkills: ['tujin'] }),
      dummy('e2', '中军'),
    ]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const foe = ctx.enemyTeam[0];
    const debuff = statusOf(foe, 'damage_boost');
    expect(debuff && 'rate' in debuff ? debuff.rate : 0).toBeCloseTo(-99.99);
    // 敌军释放一次伤害主动战法 → 伤害大幅降低
    const before = ctx.myTeam[0].troops;
    const copy = { ...asActive('tujin'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
    ctx.skills.set('tujin', copy);
    triggerActiveSkill(ctx, foe, copy, ctx.myTeam, ctx.enemyTeam, ctx.myTeam);
    const dealt = before - ctx.myTeam[0].troops;
    expect(dealt).toBeGreaterThan(0);
    expect(dealt).toBeLessThan(400); // 大幅降低（下限 10%）后的个位数级别
    expect(statusOf(foe, 'damage_boost')).toBeUndefined(); // charges 1 已消耗
  });

  it('第 4 回合自身行动：我军攻击最高单体获得「下 1 次发动率 +100%」与选中大营标记', () => {
    const ctx = makeCtx(
      [
        dummy('c', '中军', { commandSkills: ['dingjunshan'] }),
        dummy('a-front', '前锋', { attack: 200 }),
        dummy('a-back', '大营', { attack: 50 }),
      ],
      [dummy('e1', '前锋'), dummy('e2', '中军')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 4;
    actUnit(ctx, ctx.myTeam[0]);
    const boosted = ctx.myTeam[1]; // 攻击 200 最高
    const tb = statusOf(boosted, 'trigger_boost');
    expect(tb).toBeTruthy();
    expect(ctx.positionSnipes?.some((s) => s.unitId === 'a-front' && s.position === '大营')).toBe(true);
  });

  it('选中大营：受标者的首次普通攻击改为打敌军大营（几率置 1）', () => {
    const ctx = makeCtx(
      [dummy('c', '中军'), dummy('a-front', '前锋')],
      [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')]
    );
    ctx.positionSnipes = [{ unitId: 'a-front', casterId: 'c', skillId: 'dingjunshan', position: '大营', chance: 1 }];
    actUnit(ctx, ctx.myTeam[1]);
    const hits = attackHits(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe('e3');
    expect(ctx.positionSnipes ?? []).toHaveLength(0);
  });
});

// ────────────────────────────── 七擒七纵 ──────────────────────────────

describe('七擒七纵（S 指挥 · 距离 5 · 我军群体）', () => {
  it('装配：全队共享 7 次抵挡（50%）+ 惩罚造成伤害最高者；【追加】蜀阵营追加防御 −10%', () => {
    const s = asCommand('qiqin_qizong');
    expect(s.phase).toBe('prep');
    const guard = s.instanceGuard;
    expect(guard?.count).toBe(7);
    expect(guard?.rate).toBe(0.5);
    const punish = guard?.punish ?? [];
    const first = punish[0];
    if (first.kind !== 'inflict_status' || Array.isArray(first.status) || first.status.type !== 'damage_boost') {
      throw new Error('段型不符');
    }
    expect(first.status.rate).toBe(-99.99);
    expect(first.status.duration).toBe(1);
    const bonus = punish[1];
    if (bonus.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require?.casterFactions).toEqual(['蜀']);
  });

  it('抵挡（几率 100%）：受到的伤害完全规避、计数消耗', () => {
    const ctx = makeCtx([dummy('c', '中军', { commandSkills: ['qiqin_qizong'] }), dummy('a-front', '前锋')]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const skill = { ...asCommand('qiqin_qizong') } as Extract<Skill, { type: 'command' }>;
    skill.instanceGuard!.rate = 1;
    ctx.skills.set('qiqin_qizong', skill);
    const before = ctx.myTeam[1].troops;
    applyDamage(ctx, ctx.myTeam[1], 500, ctx.enemyTeam[0], 'physical', 'skill');
    expect(ctx.myTeam[1].troops).toBe(before);
    expect(evs(ctx, 'evasion_blocked')).toHaveLength(1);
    expect(ctx.instanceGuards?.get('c:qiqin_qizong')?.used).toBe(1);
  });

  it('控制抵挡：将被施加控制时整段抵御（不落状态、发 status_resisted）', () => {
    const ctx = makeCtx([dummy('c', '中军', { commandSkills: ['qiqin_qizong'] }), dummy('a-front', '前锋')]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const skill = { ...asCommand('qiqin_qizong') } as Extract<Skill, { type: 'command' }>;
    skill.instanceGuard!.rate = 1;
    ctx.skills.set('qiqin_qizong', skill);
    inflictStatus(ctx, ctx.myTeam[1], { type: 'confusion', duration: 2 }, 'active', 'other', 'e-front');
    expect(statusOf(ctx.myTeam[1], 'confusion')).toBeUndefined();
    expect(evs(ctx, 'status_resisted')).toHaveLength(1);
  });

  it('7 次计满：立即惩罚造成伤害累计最高的敌军（下回合造成伤害大幅降低）', () => {
    const ctx = makeCtx(
      [dummy('c', '中军', { commandSkills: ['qiqin_qizong'] }), dummy('a-front', '前锋')],
      [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const skill = { ...asCommand('qiqin_qizong') } as Extract<Skill, { type: 'command' }>;
    skill.instanceGuard!.rate = 0; // 全不抵挡 → 7 次全部计入
    ctx.skills.set('qiqin_qizong', skill);
    // e1 造成伤害最高
    for (let i = 0; i < 3; i++) applyDamage(ctx, ctx.myTeam[1], 300, ctx.enemyTeam[0], 'physical', 'skill');
    for (let i = 0; i < 4; i++) applyDamage(ctx, ctx.myTeam[1], 50, ctx.enemyTeam[1], 'physical', 'skill');
    const punished = statusOf(ctx.enemyTeam[0], 'damage_boost');
    if (!punished || !('rate' in punished)) throw new Error('未惩罚最高伤害者');
    expect(punished.rate).toBeCloseTo(-99.99);
    expect(statusOf(ctx.enemyTeam[1], 'damage_boost')).toBeUndefined();
    expect(ctx.instanceGuards?.get('c:qiqin_qizong')?.fired).toBe(true);
  });

  it('【追加】蜀阵营武将：惩罚同时使其防御属性 −10%（非蜀不追加）', () => {
    const run = (faction: string) => {
      const ctx = makeCtx(
        [dummy('c', '中军', { faction, commandSkills: ['qiqin_qizong'] }), dummy('a-front', '前锋')],
        [dummy('e1', '前锋'), dummy('e2', '中军')]
      );
      triggerCommandSkills(ctx, ctx.myTeam[0]);
      const skill = { ...asCommand('qiqin_qizong') } as Extract<Skill, { type: 'command' }>;
      skill.instanceGuard!.rate = 0;
      ctx.skills.set('qiqin_qizong', skill);
      for (let i = 0; i < 7; i++) applyDamage(ctx, ctx.myTeam[1], 100, ctx.enemyTeam[0], 'physical', 'skill');
      return statusOf(ctx.enemyTeam[0], 'defense_buff') != null;
    };
    expect(run('蜀')).toBe(true);
    expect(run('魏')).toBe(false);
  });
});
