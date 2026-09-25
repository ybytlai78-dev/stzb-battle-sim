/**
 * 典藏战法 · 第一批（9 张，2026-09-21 批次）：
 *   河内世泽 / 汜水关 / 桃园结义 / 枭雄 / 凤仪亭 / 人中吕布 / 鼎足江东 / 单骑救主 / 火烧连营。
 * 覆盖：装配口径 / 主效果结算 / 【追加】段（条件命中与不命中）/ 成长率留空与下架登记。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, TroopType, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isLearnableSkillListed } from '../src/data/listing';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  tickRoundStartStatuses,
  triggerActiveSkill,
  triggerCommandSkills,
  triggerPassiveSkills,
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
    attack: 120,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
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
    preparations: [],
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
function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (!s || s.type !== 'passive') throw new Error(`${id} 不是被动战法`);
  return s;
}

/** 强制发动一次主动战法（触发率置 1，不改注册表本体） */
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
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && (skillId == null || e.skillId === skillId)
  );

// ────────────────────────────── 河内世泽 ──────────────────────────────

describe('河内世泽（S 主动 4 · 25%~35% · 敌军群体 1-2）', () => {
  it('装配：两段随机战法组（落雷/迷阵/溃堤/夹攻 + 伐谋/雀伏/火辎/毒泉），有效距离 4', () => {
    const s = asActive('heneishize');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toEqual([0.25, 0.35]);
    expect(s.output).toEqual([]);
    expect(s.chainSkillPickGroups?.map((g) => g.skillIds)).toEqual([
      ['luolei', 'mizhen', 'kuidi', 'jiagong'],
      ['famou', 'quefu', 'huoozi', 'duquan'],
    ]);
  });

  it('发动：每组各随机 1 个战法，事件归属被引用战法（两组各 1 次 skill_cast）', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'heneishize');
    const refIds = new Set([
      'luolei', 'mizhen', 'kuidi', 'jiagong',
      'famou', 'quefu', 'huoozi', 'duquan',
    ]);
    const casts = evs(ctx, 'skill_cast').filter((e) => refIds.has((e as { skillId: string }).skillId));
    expect(casts).toHaveLength(2);
    const g1 = ['luolei', 'mizhen', 'kuidi', 'jiagong'];
    const g2 = ['famou', 'quefu', 'huoozi', 'duquan'];
    const ids = casts.map((e) => (e as { skillId: string }).skillId);
    expect(ids.some((id) => g1.includes(id))).toBe(true);
    expect(ids.some((id) => g2.includes(id))).toBe(true);
  });

  it('被引用战法的准备段被跳过（毒泉 / 火辎即使被抽中也不进入准备）', () => {
    const ctx = makeCtx([dummy('c', '中军')], undefined, 21);
    castActive(ctx, 'heneishize');
    expect(evs(ctx, 'prepare_start')).toHaveLength(0);
  });

  it('选敌距离统一取 4：距离 5 的敌军大营不会被命中（施法者大营 vs 敌军大营）', () => {
    const ctx = makeCtx(
      [dummy('c', '大营'), dummy('a-mid', '中军'), dummy('a-front', '前锋')],
      [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
      5
    );
    castActive(ctx, 'heneishize');
    const refIds = new Set(['luolei', 'mizhen', 'kuidi', 'jiagong', 'famou', 'quefu', 'huoozi', 'duquan']);
    const hits = dmgEvs(ctx).filter((e) => refIds.has(e.skillId ?? ''));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.targetId !== 'e-back')).toBe(true);
  });
});

// ────────────────────────────── 汜水关 ──────────────────────────────

describe('汜水关（A 主动 5 · 30% · 敌军单体）', () => {
  it('装配：动摇 = panic DoT 130%（3 次）+ 引爆（detonate）+ 攻击 180%', () => {
    const s = asActive('sishuiguan');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.3);
    expect(s.targetMode).toBe('random_single');
    expect(s.output.map((o) => o.kind)).toEqual(['conditional', 'conditional', 'physical_damage']);
    const branch = s.output[0];
    if (branch.kind !== 'conditional') throw new Error('段型不符');
    const st = branch.outputs[0];
    if (st.kind !== 'inflict_status' || Array.isArray(st.status)) throw new Error('状态段不符');
    expect(st.status.type).toBe('panic');
    if (st.status.type === 'panic') {
      expect(st.status.rate).toBe(130);
      expect(st.status.duration).toBe(3);
      expect(st.status.growthRate).toBe(0);
      expect(st.status.clearBuffsOnTick).toBe(true); // 【追加】关羽
    }
    expect(st.detonate).toEqual({ rate: 130, duration: 3, adjacent: false });
    const atk = s.output[2];
    if (atk.kind !== 'physical_damage') throw new Error('伤害段不符');
    expect(atk.rate).toBe(180);
  });

  it('首次释放：目标挂 3 回合动摇（无存量可引爆）+ 一次 180% 攻击', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'sishuiguan');
    const target = ctx.enemyTeam.find((u) => statusOf(u, 'panic'));
    if (!target) throw new Error('未挂动摇');
    expect(statusOf(target, 'panic')?.type).toBe('panic');
    expect(dmgEvs(ctx, 'sishuiguan')).toHaveLength(1);
    expect(evs(ctx, 'dot_tick')).toHaveLength(0);
  });

  it('引爆：目标已有本战法动摇时，立即结算剩余跳伤后重新挂 3 回合', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    const target = ctx.enemyTeam[0];
    // 预置一条 2 回合剩余的本战法动摇（含挂上时冻结伤害：直接构造 Status 走回退实时结算路径）
    target.statuses.push({
      type: 'panic',
      remaining: 2,
      rate: 130,
      sourceStrategy: 60,
      appliedRound: 1,
      sourceSkillType: 'active',
      sourceSkillId: 'sishuiguan',
      sourceUnitId: 'c',
    });
    castActive(ctx, 'sishuiguan');
    expect(evs(ctx, 'dot_tick')).toHaveLength(2); // 剩余 2 次立即触发
    const reapplied = statusOf(target, 'panic');
    expect(reapplied?.type).toBe('panic');
    expect(reapplied && 'remaining' in reapplied ? reapplied.remaining : 0).toBe(3);
  });

  it('【追加】关羽：动摇跳伤时移除目标有益效果；其他武将不移除', () => {
    const run = (name: string) => {
      const ctx = makeCtx([dummy('c', '中军', { name })]);
      const target = ctx.enemyTeam[0];
      inflictStatus(ctx, target, { type: 'attack_buff', amount: 30, duration: 5 }, 'active', 'some_active');
      castActive(ctx, 'sishuiguan');
      const dot = statusOf(target, 'panic');
      if (!dot) throw new Error('未挂动摇');
      actUnit(ctx, target); // 行动时跳伤 → 触发 clearBuffsOnTick
      return statusOf(target, 'attack_buff') != null;
    };
    expect(run('关羽')).toBe(false);
    expect(run('张飞')).toBe(true);
  });
});

// ────────────────────────────── 桃园结义 ──────────────────────────────

describe('桃园结义（S 指挥 · 距离 3 · 我军单体）', () => {
  it('装配：一类指挥 + 回合前分段（1~4 回合恢复 / 第 5 回合起策略 / 【追加】交替援护）', () => {
    const s = asCommand('taoyuanjieyi');
    expect(s.phase).toBe('prep');
    expect(s.output).toEqual([]);
    const outs = s.roundStartRepeat?.output ?? [];
    expect(outs.map((o) => o.kind)).toEqual(['conditional', 'conditional', 'conditional', 'conditional']);
    const [healSeg, dmgSeg] = outs;
    if (healSeg.kind !== 'conditional' || dmgSeg.kind !== 'conditional') throw new Error('段型不符');
    expect(healSeg.require).toEqual({ startRound: 1, endRound: 4 });
    const heal = healSeg.outputs[0];
    if (heal.kind !== 'heal') throw new Error('恢复段不符');
    expect(heal.rate).toBe(160);
    expect(heal.strategyScaled).toBe(true);
    expect(heal.growthRate).toBe(0); // 成长率未确认 → 必填字段给 0（按基值）
    expect(heal.targetPick).toBe('lowest_troops_ally');
    expect(dmgSeg.require).toEqual({ startRound: 5 });
    const dmg = dmgSeg.outputs[0];
    if (dmg.kind !== 'strategy_damage') throw new Error('伤害段不符');
    expect(dmg.rate).toBe(120);
    expect(dmg.strategyScaled).toBe(true);
    expect(dmg.growthRate).toBeUndefined(); // 留空 = 按基值
    expect(dmg.range).toBe(4);
    expect(dmg.targetPick).toBe('lowest_troops_in_range');
  });

  it('前 4 回合：第 1 回合为我军兵力最低单体恢复；第 5 回合起改为策略攻击', () => {
    const team = [dummy('c', '大营', { commandSkills: ['taoyuanjieyi'] }), dummy('a-mid', '中军'), dummy('a-front', '前锋')];
    const ctx = makeCtx(team);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.myTeam[2].troops = 3000; // 兵力最低
    tickRoundStartStatuses(ctx);
    const heals = evs(ctx, 'heal').filter((e) => (e as { skillId: string }).skillId === 'taoyuanjieyi');
    expect(heals).toHaveLength(1);
    expect((heals[0] as { targetId: string }).targetId).toBe('a-front');

    // 第 4 回合仍恢复；第 5 回合起改为策略攻击
    ctx.currentRound = 4;
    tickRoundStartStatuses(ctx);
    expect(evs(ctx, 'heal').filter((e) => (e as { skillId: string }).skillId === 'taoyuanjieyi')).toHaveLength(2);
    ctx.currentRound = 5;
    tickRoundStartStatuses(ctx);
    const hits = dmgEvs(ctx, 'taoyuanjieyi');
    expect(hits).toHaveLength(1);
    expect(hits[0].damageType).toBe('strategy');
  });

  it('第 5 回合起：只打距离 4 以内、兵力最低的敌军', () => {
    const ctx = makeCtx(
      [dummy('c', '大营', { commandSkills: ['taoyuanjieyi'] }), dummy('a-mid', '中军'), dummy('a-front', '前锋')],
      [
        dummy('e-front', '前锋', { troops: 9000 }),
        dummy('e-mid', '中军', { troops: 2000 }),
        dummy('e-back', '大营', { troops: 500 }),
      ]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 5;
    tickRoundStartStatuses(ctx);
    const hits = dmgEvs(ctx, 'taoyuanjieyi');
    expect(hits).toHaveLength(1);
    // 中军距离 4，大营距离 5（超范围）→ 选兵力更低的中军
    expect(hits[0].targetId).toBe('e-mid');
  });

  it('【追加】我军 3 将阵营相同：第 5、7 回合前锋援护，第 6、8 回合中军援护', () => {
    const team = [dummy('c', '大营', { faction: '蜀', commandSkills: ['taoyuanjieyi'] }), dummy('a-mid', '中军', { faction: '蜀' }), dummy('a-front', '前锋', { faction: '蜀' })];
    const ctx = makeCtx(team);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 5;
    tickRoundStartStatuses(ctx);
    expect(statusOf(ctx.myTeam[2], 'cover')).toBeTruthy(); // 前锋
    expect(statusOf(ctx.myTeam[1], 'cover')).toBeFalsy();
    ctx.myTeam.forEach((u) => (u.statuses = []));
    ctx.currentRound = 6;
    tickRoundStartStatuses(ctx);
    expect(statusOf(ctx.myTeam[1], 'cover')).toBeTruthy(); // 中军
    expect(statusOf(ctx.myTeam[2], 'cover')).toBeFalsy();
  });

  it('【追加】不满足（阵营不同）：不产生援护', () => {
    const team = [dummy('c', '大营', { faction: '蜀', commandSkills: ['taoyuanjieyi'] }), dummy('a-mid', '中军', { faction: '魏' }), dummy('a-front', '前锋', { faction: '吴' })];
    const ctx = makeCtx(team);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 5;
    tickRoundStartStatuses(ctx);
    expect(ctx.myTeam.every((u) => !statusOf(u, 'cover'))).toBe(true);
  });

  it('成长率未确认 → 配将池下架（OFFLINE_LEARNABLE_SKILLS）', () => {
    expect(isLearnableSkillListed('taoyuanjieyi')).toBe(false);
  });
});

// ────────────────────────────── 枭雄 ──────────────────────────────

describe('枭雄（B 被动 · 距离 1 · 自己）', () => {
  it('装配：前 4 回合 90% 洞察 + 自身犹豫；【追加】曹操四维 +10%', () => {
    const s = asPassive('xiaoxiong');
    expect(s.timing).toBe('battle_start');
    expect(s.roundStartRepeat?.endRound).toBe(4);
    const group = s.roundStartRepeat?.output[0];
    if (!group || group.kind !== 'chance_group') throw new Error('段型不符');
    expect(group.chance).toBe(0.9);
    const kinds = group.outputs.map((o) => (o.kind === 'inflict_status' && !Array.isArray(o.status) ? o.status.type : ''));
    expect(kinds).toEqual(['hesitation', 'insight']); // 先犹豫、再洞察（顺序不可颠倒）
    const bonus = s.output[0];
    if (bonus.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require?.casterNames).toEqual(['曹操']);
    const buffs = bonus.outputs[0];
    if (buffs.kind !== 'inflict_status' || !Array.isArray(buffs.status)) throw new Error('状态段不符');
    expect(buffs.status.map((b) => b.type)).toEqual(['attack_buff', 'defense_buff', 'strategy_buff']);
    expect(buffs.status.every((b) => 'percent' in b && b.percent === true)).toBe(true);
  });

  it('常规（必中覆写）：自身获得洞察 + 犹豫（本回合无法发动主动战法）', () => {
    const g = dummy('c', '前锋', { passiveSkills: ['xiaoxiong'] });
    const ctx = makeCtx([g, dummy('a-mid', '中军'), dummy('a-back', '大营')]);
    triggerPassiveSkills(ctx, ctx.myTeam[0], 'battle_start');
    const skill = { ...asPassive('xiaoxiong') } as Extract<Skill, { type: 'passive' }>;
    const rs = skill.roundStartRepeat?.output[0];
    if (rs?.kind === 'chance_group') rs.chance = 1;
    ctx.skills.set('xiaoxiong', skill);
    const unit = ctx.myTeam[0];
    actUnit(ctx, unit);
    expect(statusOf(unit, 'insight')).toBeTruthy();
    expect(statusOf(unit, 'hesitation')).toBeTruthy();
  });

  it('洞察免疫控制（含新增的挑衅拦截）：被施加混乱 / 挑衅时整段被拦', () => {
    const ctx = makeCtx([dummy('c', '前锋')]);
    const unit = ctx.myTeam[0];
    inflictStatus(ctx, unit, { type: 'insight', duration: 3 }, 'active', 'xiaoxiong');
    inflictStatus(ctx, unit, { type: 'confusion', duration: 2 }, 'active', 'other');
    inflictStatus(ctx, unit, { type: 'taunt', duration: 2, targetId: 'e-front' }, 'active', 'other');
    expect(statusOf(unit, 'confusion')).toBeUndefined();
    expect(statusOf(unit, 'taunt')).toBeUndefined();
    expect(evs(ctx, 'insight_blocked')).toHaveLength(2);
  });

  it('【追加】曹操：开场四维 +10%（percent）；非曹操不生效', () => {
    const run = (name: string) => {
      const ctx = makeCtx([dummy('c', '前锋', { name, passiveSkills: ['xiaoxiong'] })]);
      triggerPassiveSkills(ctx, ctx.myTeam[0], 'battle_start');
      const u = ctx.myTeam[0];
      return ['attack_buff', 'defense_buff', 'strategy_buff'].every((t) => statusOf(u, t));
    };
    expect(run('曹操')).toBe(true);
    expect(run('刘备')).toBe(false);
  });
});

// ────────────────────────────── 凤仪亭 ──────────────────────────────

describe('凤仪亭（A 主动 4 · 40% · 自己）', () => {
  it('装配：增伤（受击可叠至 4 层）+ 自身延迟猛攻 288% + 【追加】3 将兵种相同', () => {
    const s = asActive('fengyiting');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(4);
    expect(s.output.map((o) => o.kind)).toEqual(['conditional', 'conditional', 'schedule_strike']);
    const base = s.output[0];
    if (base.kind !== 'conditional') throw new Error('段型不符');
    expect(base.unless).toEqual({ teamTroopSame: true });
    const st = base.outputs[0];
    if (st.kind !== 'inflict_status' || Array.isArray(st.status)) throw new Error('状态段不符');
    if (st.status.type === 'damage_boost') {
      expect(st.status.rate).toBe(0.2);
      expect(st.status.damageType).toBe('physical');
      expect(st.status.maxStacks).toBe(4);
      expect(st.status.hurtStackPer).toBe(0.2);
    }
    const bonus = s.output[1];
    if (bonus.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require).toEqual({ teamTroopSame: true });
    const sched = s.output[2];
    if (sched.kind !== 'schedule_strike') throw new Error('段型不符');
    const hit = sched.output[0];
    if (hit.kind !== 'physical_damage') throw new Error('伤害段不符');
    expect(hit.rate).toBe(288);
    expect(hit.targetSide).toBe('enemy');
  });

  it('释放：自身挂攻击伤害提高 20%，并把猛攻排入自身延迟队列', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'fengyiting');
    const unit = ctx.myTeam[0];
    const boost = statusOf(unit, 'damage_boost');
    expect(boost && 'rate' in boost ? boost.rate : 0).toBeCloseTo(0.2);
    expect(ctx.pendingStrikes).toHaveLength(1);
    expect(ctx.pendingStrikes![0].targetId).toBe('c');
  });

  it('受击叠层：每受到 1 次实际扣兵伤害 +1 层（0.2 → 0.4 → 0.6 → 0.8，封顶 4 层）', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'fengyiting');
    const unit = ctx.myTeam[0];
    const enemy = ctx.enemyTeam[0];
    const rate = () => {
      const st = statusOf(unit, 'damage_boost');
      return st && 'rate' in st ? (st.rate as number) : 0;
    };
    for (const expected of [0.4, 0.6, 0.8, 0.8]) {
      applyDamage(ctx, unit, 100, enemy, 'physical', 'skill');
      expect(rate()).toBeCloseTo(expected);
    }
  });

  it('下一回合行动前：施法者行动开始时打出猛攻（对距离 4 内随机敌军）', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'fengyiting');
    expect(dmgEvs(ctx, 'fengyiting')).toHaveLength(0);
    actUnit(ctx, ctx.myTeam[0]);
    const hits = dmgEvs(ctx, 'fengyiting');
    expect(hits).toHaveLength(1);
    expect(ctx.enemyTeam.some((e) => e.general.id === hits[0].targetId)).toBe(true);
    expect(ctx.pendingStrikes ?? []).toHaveLength(0);
  });

  it('【追加】我军 3 将兵种相同：每层 25% 且自身无法恢复兵力（围困）', () => {
    const team = [
      dummy('c', '大营', { troopType: 'cavalry' }),
      dummy('a-mid', '中军', { troopType: 'cavalry' }),
      dummy('a-front', '前锋', { troopType: 'cavalry' }),
    ];
    const ctx = makeCtx(team);
    castActive(ctx, 'fengyiting');
    const unit = ctx.myTeam[0];
    const boost = statusOf(unit, 'damage_boost');
    expect(boost && 'rate' in boost ? boost.rate : 0).toBeCloseTo(0.25);
    expect(statusOf(unit, 'siege')).toBeTruthy();
  });
});

// ────────────────────────────── 人中吕布 ──────────────────────────────

describe('人中吕布（A 主动·准备 5 · 35% · 敌军群体 2-3）', () => {
  it('装配：准备 1 回合、groupCount [2,3]、三条按兵种过滤的减益', () => {
    const s = asActive('renzhonglvbu');
    expect(s.prepare).toBe(true);
    expect(s.range).toBe(5);
    expect(s.groupCount).toEqual([2, 3]);
    const debuffs = s.output.filter((o) => o.kind === 'inflict_status');
    expect(debuffs).toHaveLength(3);
    const types = debuffs.map((o) => (o.kind === 'inflict_status' && !Array.isArray(o.status) ? o.status.type : ''));
    expect(types).toEqual(['range_buff', 'damage_boost', 'siege']);
    expect(debuffs.map((o) => (o.kind === 'inflict_status' ? o.troopTypes : undefined))).toEqual([
      ['archer'],
      ['cavalry'],
      ['infantry'],
    ]);
    const cav = debuffs[1];
    if (cav.kind === 'inflict_status' && !Array.isArray(cav.status) && cav.status.type === 'damage_boost') {
      expect(cav.status.rate).toBe(-0.5);
      expect(cav.status.skillTypes).toEqual(['active']);
      expect(cav.status.duration).toBe(1);
    }
  });

  it('释放：三种兵种各吃对应减益（弓 −2 距离 / 骑主动伤害 −50% / 步围困）', () => {
    const ctx = makeCtx([dummy('c', '中军')], [
      dummy('e-cav', '前锋', { troopType: 'cavalry' }),
      dummy('e-arc', '中军', { troopType: 'archer' }),
      dummy('e-inf', '大营', { troopType: 'infantry' }),
    ]);
    castActive(ctx, 'renzhonglvbu', { prepare: false, groupCount: 3 });
    const cav = ctx.enemyTeam[0];
    const arc = ctx.enemyTeam[1];
    const inf = ctx.enemyTeam[2];
    const cavBoost = statusOf(cav, 'damage_boost');
    expect(cavBoost && 'rate' in cavBoost && cavBoost.rate).toBeCloseTo(-0.5);
    const arcRange = statusOf(arc, 'range_buff');
    expect(arcRange && 'amount' in arcRange ? arcRange.amount : 0).toBe(-2);
    expect(statusOf(inf, 'siege')).toBeTruthy();
    expect(dmgEvs(ctx, 'renzhonglvbu')).toHaveLength(3);
  });

  it('【追加】吕布：造成的伤害无视兵种相克（步兵打骑兵不再 −30%）', () => {
    const run = (name: string) => {
      const ctx = makeCtx(
        [dummy('c', '中军', { name, troopType: 'infantry' })],
        [dummy('e-cav', '前锋', { troopType: 'cavalry' }), dummy('e-mid', '中军'), dummy('e-inf', '大营')],
        3
      );
      castActive(ctx, 'renzhonglvbu', { prepare: false, groupCount: 2 });
      return dmgEvs(ctx, 'renzhonglvbu').reduce((sum, e) => sum + e.damage, 0);
    };
    expect(run('吕布')).toBeGreaterThan(run('张飞'));
  });
});

// ────────────────────────────── 鼎足江东 ──────────────────────────────

describe('鼎足江东（A 主动 2 · 40% · 我军群体 2）', () => {
  it('装配：立即恢复 75% + 休整 75%（受谋略，成长率留空/0）+ 增伤 17% 持续 2 回合', () => {
    const s = asActive('dingzujiangdong');
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    const heal = s.output[0];
    if (heal.kind !== 'heal') throw new Error('恢复段不符');
    expect(heal.rate).toBe(75);
    expect(heal.strategyScaled).toBe(true);
    expect(heal.growthRate).toBe(0); // 必填字段 = 0（按基值）
    const restSeg = s.output[1];
    if (restSeg.kind !== 'conditional') throw new Error('段型不符');
    const rest = restSeg.outputs[0];
    if (rest.kind !== 'inflict_status' || Array.isArray(rest.status)) throw new Error('状态段不符');
    if (rest.status.type === 'rest') {
      expect(rest.status.rate).toBe(75);
      expect(rest.status.growthRate).toBe(0);
      expect(rest.status.duration).toBe(1);
      expect(rest.status.strategyScaled).toBe(true);
    }
    const boost = s.output[3];
    if (boost.kind !== 'inflict_status' || Array.isArray(boost.status)) throw new Error('状态段不符');
    if (boost.status.type === 'damage_boost') {
      expect(boost.status.rate).toBe(0.17);
      expect(boost.status.duration).toBe(2);
      expect(boost.status.direction).toBe('caused');
      expect(boost.status.strategyScaled).toBe(true);
      expect(boost.status.growthRate).toBeUndefined();
    }
  });

  it('释放：两名友军恢复 + 休整 + 增伤', () => {
    const ctx = makeCtx([
      dummy('c', '中军', { troopType: 'cavalry' }),
      dummy('a-front', '前锋', { troopType: 'archer' }),
      dummy('a-back', '大营', { troopType: 'infantry' }),
    ]);
    ctx.myTeam.forEach((u) => (u.troops = 6000));
    castActive(ctx, 'dingzujiangdong', { groupCount: 2 });
    const heals = evs(ctx, 'heal').filter((e) => (e as { skillId: string }).skillId === 'dingzujiangdong');
    expect(heals).toHaveLength(2);
    const rested = ctx.myTeam.filter((u) => statusOf(u, 'rest'));
    expect(rested.length).toBeGreaterThan(0);
    const boosted = ctx.myTeam.filter((u) => statusOf(u, 'damage_boost'));
    expect(boosted.length).toBeGreaterThan(0);
  });

  it('【追加】我军 3 将兵种相同：休整段变为立即恢复（同一目标两段恢复）', () => {
    const run = (sameTroop: boolean) => {
      const team = [
        dummy('c', '中军', { troopType: 'cavalry' }),
        dummy('a-front', '前锋', { troopType: sameTroop ? 'cavalry' : 'archer' }),
        dummy('a-back', '大营', { troopType: sameTroop ? 'cavalry' : 'infantry' }),
      ];
      const ctx = makeCtx(team);
      ctx.myTeam.forEach((u) => (u.troops = 6000));
      castActive(ctx, 'dingzujiangdong', { groupCount: 3 });
      return {
        restCount: ctx.myTeam.filter((u) => statusOf(u, 'rest')).length,
        healCount: evs(ctx, 'heal').filter((e) => (e as { skillId: string }).skillId === 'dingzujiangdong').length,
      };
    };
    expect(run(false).restCount).toBeGreaterThan(0);
    expect(run(true).restCount).toBe(0);
    expect(run(true).healCount).toBeGreaterThan(run(false).healCount);
  });

  it('成长率未确认 → 配将池下架', () => {
    expect(isLearnableSkillListed('dingzujiangdong')).toBe(false);
  });
});

// ────────────────────────────── 单骑救主 ──────────────────────────────

describe('单骑救主（A 指挥 · 距离 5 · 自己）', () => {
  it('装配：自身受击 100%（共 7 次）→ 随机我军规避 + 随机敌军造成伤害 −25%；【追加】赵云前 2 回合免怯战', () => {
    const s = asCommand('danqijiuzhu');
    const cfg = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    expect(cfg?.victim).toBe('self');
    expect(cfg?.rate).toBe(1);
    expect(cfg?.maxTriggers).toBe(7);
    const outs = cfg?.output ?? [];
    expect(outs).toHaveLength(2);
    const first = outs[0];
    if (first.kind !== 'inflict_status' || Array.isArray(first.status)) throw new Error('段型不符');
    expect(first.targetSide).toBe('ally');
    expect(first.targetMode).toBe('random_single');
    expect(first.status.type).toBe('evasion');
    const second = outs[1];
    if (second.kind !== 'inflict_status' || Array.isArray(second.status)) throw new Error('段型不符');
    if (second.status.type === 'damage_boost') {
      expect(second.targetSide).toBe('enemy');
      expect(second.status.rate).toBe(-0.25);
      expect(second.status.direction).toBe('caused');
      expect(second.status.defenseScaled).toBe(true);
      expect(second.status.growthRate).toBeUndefined(); // 成长率未确认 → 留空按基值
    }
    const bonus = s.initialOutput?.[0];
    if (bonus?.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require?.casterNames).toEqual(['赵云']);
    const imm = bonus.outputs[0];
    if (imm.kind !== 'inflict_status' || Array.isArray(imm.status)) throw new Error('状态段不符');
    if (imm.status.type !== 'cowardice_immune') throw new Error('状态类型不符');
    expect(imm.status.duration).toBe(2);
  });

  it('自身受击触发（100%）：随机我军单体获得 1 层规避 + 随机敌军单体获得造成伤害降低 25%', () => {
    const ctx = makeCtx([dummy('c', '中军', { commandSkills: ['danqijiuzhu'] }), dummy('a-front', '前锋'), dummy('a-back', '大营')]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const carrier = ctx.myTeam[0];
    applyDamage(ctx, carrier, 200, ctx.enemyTeam[0], 'physical', 'skill');
    const evaded = ctx.myTeam.filter((u) => statusOf(u, 'evasion'));
    expect(evaded).toHaveLength(1);
    expect(statusOf(evaded[0], 'evasion')?.type).toBe('evasion');
    const debuffed = ctx.enemyTeam.filter((u) => statusOf(u, 'damage_boost'));
    expect(debuffed).toHaveLength(1);
  });

  it('友军受击不触发（触发者 = 施法者自身）', () => {
    const ctx = makeCtx([dummy('c', '中军', { commandSkills: ['danqijiuzhu'] }), dummy('a-front', '前锋'), dummy('a-back', '大营')]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    applyDamage(ctx, ctx.myTeam[1], 200, ctx.enemyTeam[0], 'physical', 'skill');
    expect(ctx.myTeam.every((u) => !statusOf(u, 'evasion'))).toBe(true);
    expect(ctx.enemyTeam.every((u) => !statusOf(u, 'damage_boost'))).toBe(true);
  });

  it('上限：整场最多触发 7 次', () => {
    const ctx = makeCtx([dummy('c', '中军', { commandSkills: ['danqijiuzhu'] })]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const carrier = ctx.myTeam[0];
    for (let i = 0; i < 9; i++) {
      applyDamage(ctx, carrier, 50, ctx.enemyTeam[0], 'physical', 'skill');
    }
    expect(ctx.hurtTriggerCounters?.get('c:danqijiuzhu')).toBe(7);
  });

  it('【追加】赵云：开场前 2 回合免疫怯战；其他武将没有', () => {
    const run = (name: string) => {
      const ctx = makeCtx([dummy('c', '中军', { name, commandSkills: ['danqijiuzhu'] })]);
      triggerCommandSkills(ctx, ctx.myTeam[0]);
      return statusOf(ctx.myTeam[0], 'cowardice_immune') != null;
    };
    expect(run('赵云')).toBe(true);
    expect(run('张飞')).toBe(false);
  });

  it('成长率未确认 → 配将池下架', () => {
    expect(isLearnableSkillListed('danqijiuzhu')).toBe(false);
  });
});

// ────────────────────────────── 火烧连营 ──────────────────────────────

describe('火烧连营（S 主动·准备 5 · 35% · 敌军群体 3）', () => {
  it('装配：围困全体 + 3 次火攻（dotFormula）各挂受伤提升 + 燃烧/恐慌【追加】二选一', () => {
    const s = asActive('huoshaolianying');
    expect(s.prepare).toBe(true);
    expect(s.groupCount).toBe(3);
    const kinds = s.output.map((o) => o.kind);
    expect(kinds).toEqual([
      'inflict_status',
      'strategy_damage',
      'inflict_status',
      'strategy_damage',
      'inflict_status',
      'strategy_damage',
      'inflict_status',
      'conditional',
      'conditional',
    ]);
    const fire = s.output[1];
    if (fire.kind !== 'strategy_damage') throw new Error('伤害段不符');
    expect(fire.rate).toBe(50);
    expect(fire.strategyScaled).toBe(true);
    expect(fire.growthRate).toBeUndefined(); // 成长率未确认 → 留空按基值
    expect(fire.dotFormula).toBe(true);
    expect(fire.targetMode).toBe('random_single');
    const boost = s.output[2];
    if (boost.kind === 'inflict_status' && !Array.isArray(boost.status) && boost.status.type === 'damage_boost') {
      expect(boost.sameTargetsAsLastDamage).toBe(true);
      expect(boost.status.rate).toBe(0.05);
      expect(boost.status.dotTypes).toEqual(['burning', 'sorcery', 'panic', 'curse', 'ignite']);
      expect(boost.status.stack).toBe(true);
      expect(boost.status.duration).toBe(999);
      expect(boost.status.growthRate).toBeUndefined();
    }
    const bonus = s.output[7];
    if (bonus.kind !== 'conditional') throw new Error('段型不符');
    expect(bonus.require?.casterNames).toEqual(['陆逊']);
  });

  it('释放：敌军全体围困 + 3 次火攻（每次独立选靶）+ 燃烧覆盖全体', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'huoshaolianying', { prepare: false });
    const fires = dmgEvs(ctx, 'huoshaolianying');
    expect(fires).toHaveLength(3);
    expect(fires.every((f) => f.damageType === 'strategy')).toBe(true);
    expect(ctx.enemyTeam.every((u) => statusOf(u, 'siege'))).toBe(true);
    expect(ctx.enemyTeam.every((u) => statusOf(u, 'burning'))).toBe(true);
  });

  it('火攻命中后：目标获得「受到火攻与持续性伤害提升 5%」（可叠加、持续至战斗结束）', () => {
    const ctx = makeCtx([dummy('c', '中军')]);
    castActive(ctx, 'huoshaolianying', { prepare: false, groupCount: 3 });
    const boosted = ctx.enemyTeam.filter((u) => statusOf(u, 'damage_boost'));
    expect(boosted.length).toBeGreaterThan(0);
    const st = statusOf(boosted[0], 'damage_boost');
    // 同一目标可能被多次火攻命中 → 每命中一次 +5%（可叠加）
    if (st && 'rate' in st) {
      const pct = Math.round((st.rate as number) * 100);
      expect([5, 10, 15]).toContain(pct);
    }
    if (st && 'dotTypes' in st) expect(st.dotTypes).toEqual(['burning', 'sorcery', 'panic', 'curse', 'ignite']);
  });

  it('【追加】陆逊：燃烧改为恐慌；张飞仍为燃烧', () => {
    const run = (name: string) => {
      const ctx = makeCtx([dummy('c', '中军', { name })]);
      castActive(ctx, 'huoshaolianying', { prepare: false, groupCount: 3 });
      return {
        burning: ctx.enemyTeam.filter((u) => statusOf(u, 'burning')).length,
        panic: ctx.enemyTeam.filter((u) => statusOf(u, 'panic')).length,
      };
    };
    expect(run('陆逊')).toEqual({ burning: 0, panic: 3 });
    expect(run('张飞')).toEqual({ burning: 3, panic: 0 });
  });

  it('成长率未确认 → 配将池下架', () => {
    expect(isLearnableSkillListed('huoshaolianying')).toBe(false);
  });
});
