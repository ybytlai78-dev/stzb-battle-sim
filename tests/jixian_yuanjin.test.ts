/**
 * 计险远近（A 指挥 · 一类 · 距离 5 · 我军全体，典籍战法 官方 id 200248）。
 *
 * 覆盖：
 *   ① 装配口径 + **基础攻击距离**条件闸门（3 将互不相同才整次生效；重复即整次不生效）
 *   ② 大营 → 造成的伤害无视规避（常驻不消耗，不会被第一次伤害吃掉）
 *   ③ 中军 → 攻击 / 防御 / 谋略 +20
 *   ④ 前锋 → **每回合**受到的首次**攻击或策略攻击**伤害 −50%（同回合第二次不吃、下回合恢复、
 *      DoT 跳伤不算攻击、普攻也不吃）
 *   ⑤ 我军全体普攻命中后 → 该目标本回合受到的所有伤害 +15%，可叠加（多将打同一目标累加）
 */
import { describe, it, expect } from 'vitest';
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  General,
  Position,
  Skill,
  SkillType,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isLearnableSkillListed } from '../src/data/listing';
import {
  actUnit,
  applyDamage,
  consumeEvasion,
  dealDotDamage,
  effectiveStat,
  inflictStatus,
  sumReduce,
  teamAttackRangesDistinct,
  tickRoundStartStatuses,
  tickStatuses,
  triggerCommandSkills,
  type CombatContext,
  type DamageHitContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';

function dummy(
  id: string,
  position: Position,
  attackRange = 2,
  opts: { faction?: string; attack?: number; strategy?: number } = {}
): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: opts.faction ?? '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: opts.attack ?? 100,
    defense: 80,
    strategy: opts.strategy ?? 60,
    speed: 20,
    attackRange,
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

/** 我方 3 将基础攻击距离默认 1/2/3（互不相同）→ 满足计险远近条件 */
function team(skillId = 'jixian_yuanjin', ranges: [number, number, number] = [1, 2, 3]): General[] {
  const carrier = dummy('ally-front', '前锋', ranges[0]);
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', ranges[1]), dummy('ally-back', '大营', ranges[2])];
}

function enemyTeam(range = 2): General[] {
  return [dummy('enemy-front', '前锋', range), dummy('enemy-mid', '中军', range), dummy('enemy-back', '大营', range)];
}

function makeCtx(my: General[], enemies: General[] = enemyTeam(), seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemies.map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function commandSkill(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);

const byPos = (ctx: CombatContext, position: Position) => ctx.myTeam.find((u) => u.general.position === position)!;

/** 本回合该单位的「每回合首次减伤」额度（按伤害类型分轨，key = 回合:单位:战法:伤害类型） */
const reduceUsedThisRound = (ctx: CombatContext, u: UnitState, skillId: string, kind: 'attack' | 'strategy') =>
  (ctx.firstHitReduceKeys ?? new Set<string>()).has(`${ctx.currentRound}:${u.general.id}:${skillId}:${kind}`);

/**
 * 走真实伤害结算口径打一次伤害（`dealAttack` / 战法伤害段的调用形态）：
 * 先按 hit 求减伤合计，再 applyDamage —— 两处传入**同一个** hit（与引擎内既有写法一致）。
 */
function hitUnit(
  ctx: CombatContext,
  target: UnitState,
  source: UnitState,
  damage: number,
  damageType: 'physical' | 'strategy',
  damageSource: 'basic' | 'skill',
  /** 缺省 = 普攻那种不带 skillType 的伤害（与 dealAttack 同口径） */
  skillType?: SkillType
): void {
  const hit: DamageHitContext = { damageSource, damageType, ...(skillType ? { skillType } : {}) };
  const reduce = sumReduce(ctx, target, hit, source);
  applyDamage(ctx, target, Math.round(damage * (1 - reduce)), source, damageType, damageSource);
}

/** 只留 1 个敌军（前锋），返回该单位（普攻选靶不再随机） */
function isolateTarget(ctx: CombatContext): UnitState {
  ctx.enemyTeam.forEach((e) => (e.alive = e.general.id === 'enemy-front'));
  return ctx.enemyTeam.find((e) => e.general.id === 'enemy-front')!;
}

/** 前锋减伤状态对（等价第 1 回合回合开始由 roundStartRepeat 挂上）：攻击 / 策略攻击两类各限一次 */
const FRONT_REDUCE: CreateStatus[] = [
  { type: 'damage_reduce', rate: 0.5, duration: 999, damageType: 'physical', firstHitPerRound: 'attack', excludeDot: true },
  { type: 'damage_reduce', rate: 0.5, duration: 999, damageType: 'strategy', firstHitPerRound: 'strategy', excludeDot: true },
];

/** 按计险远近前锋段口径挂上两条减伤（等价段内 `applyAll` 同源施加） */
function applyFrontReduce(ctx: CombatContext, front: UnitState, round: number): void {
  ctx.currentRound = round;
  for (const c of FRONT_REDUCE) {
    inflictStatus(ctx, front, c, 'command', 'jixian_yuanjin', front.general.id);
  }
}

describe('计险远近（A 指挥：3 将基础攻击距离互不相同 → 大营无视规避 / 中军四维+20 / 前锋每回合首次减伤 / 全体普攻增伤）', () => {
  it('装配：一类指挥 prep、距离 5、我军全体、基础攻击距离条件开关；四段机制字段齐备', () => {
    const s = commandSkill('jixian_yuanjin');
    expect(s.name).toBe('计险远近');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.retainAfterDeath).toBe(true);
    expect(s.teamAttackRangeDistinct).toBe(true);
    expect(s.tags).toEqual(
      expect.arrayContaining(['insight', 'attack_buff', 'defense_buff', 'strategy_buff', 'damage_reduce', 'damage_boost'])
    );

    // 效果段全在 roundStartRepeat（第 1 回合开始起每回合执行）
    expect(s.output).toEqual([]);
    const outs = s.roundStartRepeat!.output;
    expect(outs.map((o) => o.kind)).toEqual(['inflict_status', 'inflict_status', 'inflict_status']);
    expect(outs.map((o) => (o.kind === 'inflict_status' ? o.requirePositions : null))).toEqual([
      ['大营'],
      ['中军'],
      ['前锋'],
    ]);

    // ② 大营：无视规避（常驻不消耗）
    const backOut = outs[0];
    if (backOut.kind !== 'inflict_status' || Array.isArray(backOut.status)) throw new Error('期望大营单体状态');
    expect(backOut.status.type).toBe('ignore_evasion');
    if (backOut.status.type === 'ignore_evasion') {
      expect(backOut.status.throughRound).toBe(999); // 不给 throughRound 会被 consumeEvasion 吃掉一次
    }

    // ③ 中军：攻/防/谋 +20（点数、非百分比）
    const midOut = outs[1];
    if (midOut.kind !== 'inflict_status' || !Array.isArray(midOut.status)) throw new Error('期望中军三段属性');
    expect(midOut.applyAll).toBe(true);
    expect(midOut.status.map((x) => x.type)).toEqual(['attack_buff', 'defense_buff', 'strategy_buff']);
    for (const st of midOut.status) {
      if (st.type !== 'attack_buff' && st.type !== 'defense_buff' && st.type !== 'strategy_buff') continue;
      expect(st.amount).toBe(20);
      expect(st.duration).toBe(999);
      expect(st.percent).toBeUndefined();
      expect(st.growthRate).toBeUndefined();
    }

    // ④ 前锋：每回合首次「攻击或策略攻击」各 −50%（两条过滤维不同的减伤共存），DoT 不算攻击
    const frontOut = outs[2];
    if (frontOut.kind !== 'inflict_status' || !Array.isArray(frontOut.status)) throw new Error('期望前锋减伤段');
    expect(frontOut.applyAll).toBe(true);
    expect(frontOut.status.map((x) => x.type)).toEqual(['damage_reduce', 'damage_reduce']);
    expect(frontOut.status.map((x) => (x.type === 'damage_reduce' ? x.damageType : null))).toEqual([
      'physical',
      'strategy',
    ]);
    for (const st of frontOut.status) {
      if (st.type !== 'damage_reduce') continue;
      expect(st.rate).toBe(0.5);
      expect(st.duration).toBe(999); // 常驻：每回合额度靠记账键重置，不靠状态生命周期
      // 攻击轨 / 策略轨各自只认自己那一类首次伤害（key 分轨记账）
      expect(st.firstHitPerRound).toBe(st.damageType === 'physical' ? 'attack' : 'strategy');
      expect(st.excludeDot).toBe(true);
    }

    // ⑤ 我军全体普攻后：目标本回合受到的所有伤害 +15%，可叠加
    const proc = s.basicHitProc!;
    expect(proc.rate).toBe(1);
    const boostOut = proc.output[0];
    if (boostOut.kind !== 'inflict_status' || Array.isArray(boostOut.status)) throw new Error('期望普攻增伤段');
    expect(boostOut.status.type).toBe('damage_boost');
    if (boostOut.status.type === 'damage_boost') {
      expect(boostOut.status.rate).toBe(0.15);
      expect(boostOut.status.direction).toBe('taken');
      expect(boostOut.status.stack).toBe(true);
      expect(boostOut.status.duration).toBe(1); // 本回合
    }

    // 非武将主战法 → 无需下架登记（典籍战法可作为装配战法出现）
    expect(isLearnableSkillListed('jixian_yuanjin')).toBe(true);
  });

  it('基础攻击距离条件：3 将互不相同 → 生效；有两人相同 → 整次不生效（不锁目标、不发 skill_cast）', () => {
    // 单元口径
    const okTeam = team().map((g) => unitFrom(g));
    expect(teamAttackRangesDistinct(okTeam)).toBe(true);
    const dupTeam = team('jixian_yuanjin', [2, 2, 3]).map((g) => unitFrom(g));
    expect(teamAttackRangesDistinct(dupTeam)).toBe(false);
    expect(teamAttackRangesDistinct([okTeam[0], okTeam[1]])).toBe(false); // 不足 3 将

    const ok = makeCtx(team());
    triggerCommandSkills(ok, ok.myTeam[0]);
    expect(ok.lockedCommands).toHaveLength(1);
    expect(ok.events.some((e) => e.type === 'skill_cast' && e.skillId === 'jixian_yuanjin')).toBe(true);

    const bad = makeCtx(team('jixian_yuanjin', [2, 2, 3]));
    triggerCommandSkills(bad, bad.myTeam[0]);
    expect(bad.lockedCommands).toHaveLength(0);
    expect(bad.events.some((e) => e.type === 'skill_cast' && e.skillId === 'jixian_yuanjin')).toBe(false);

    // 条件读**部署名单**（不论 alive）：该侧全灭也不中途改判；阵亡单位自然不结算
    const dead = makeCtx(team());
    triggerCommandSkills(dead, dead.myTeam[0]);
    dead.myTeam.forEach((u) => (u.alive = false));
    dead.currentRound = 2;
    tickRoundStartStatuses(dead);
    expect(statusOf(byPos(dead, '大营'), 'ignore_evasion')).toBeUndefined();
  });

  it('生效：第 1 回合开始按站位分段施加——大营无视规避 / 中军攻防谋 +20 / 前锋每回合首次减伤 50%', () => {
    const ctx = makeCtx(team());
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    tickRoundStartStatuses(ctx); // 第 1 回合开始

    expect(statusOf(byPos(ctx, '大营'), 'ignore_evasion')?.sourceSkillId).toBe('jixian_yuanjin');
    expect(statusOf(byPos(ctx, '中军'), 'attack_buff')).toBeDefined();
    expect(statusOf(byPos(ctx, '中军'), 'defense_buff')).toBeDefined();
    expect(statusOf(byPos(ctx, '中军'), 'strategy_buff')).toBeDefined();
    const reduces = byPos(ctx, '前锋').statuses.filter((s) => s.type === 'damage_reduce');
    expect(reduces).toHaveLength(2); // 攻击轨 + 策略轨（过滤维不同 → 独立共存）
    expect(reduces.map((s) => (s.type === 'damage_reduce' ? s.damageType : null))).toEqual(['physical', 'strategy']);
    for (const r of reduces) {
      expect(r.sourceSkillId).toBe('jixian_yuanjin');
      if (r.type === 'damage_reduce') expect(r.remaining).toBe(999);
    }
    // 站位互斥：前锋不拿属性、中军不拿减伤（每将只拿自己那一段）
    expect(statusOf(byPos(ctx, '前锋'), 'attack_buff')).toBeUndefined();
    expect(statusOf(byPos(ctx, '中军'), 'damage_reduce')).toBeUndefined();
    expect(byPos(ctx, '前锋').statuses).toHaveLength(2);
    expect(byPos(ctx, '中军').statuses).toHaveLength(3);
    expect(byPos(ctx, '大营').statuses).toHaveLength(1);

    // 属性加成计入生效属性（+20 点数）
    expect(effectiveStat(byPos(ctx, '中军'), 'attack')).toBe(120);
    expect(effectiveStat(byPos(ctx, '中军'), 'defense')).toBe(100);
    expect(effectiveStat(byPos(ctx, '中军'), 'strategy')).toBe(80);

    // 下回合重挂：两条减伤仍在（每回合各有一次额度）
    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    expect(byPos(ctx, '前锋').statuses.filter((s) => s.type === 'damage_reduce')).toHaveLength(2);
    expect(reduceUsedThisRound(ctx, byPos(ctx, '前锋'), 'jixian_yuanjin', 'attack')).toBe(false);
    expect(reduceUsedThisRound(ctx, byPos(ctx, '前锋'), 'jixian_yuanjin', 'strategy')).toBe(false);
  });

  it('前锋减伤：每回合「攻击」「策略攻击」各限首次 −50%（两类互不顶掉）；下回合额度重置', () => {
    const ctx = makeCtx(team());
    const front = byPos(ctx, '前锋');
    const enemy = isolateTarget(ctx);
    const amount = (damageType: 'physical' | 'strategy', damageSource: 'basic' | 'skill', skillType?: SkillType) => {
      const before = front.troops;
      hitUnit(ctx, front, enemy, 1000, damageType, damageSource, skillType);
      return before - front.troops;
    };

    applyFrontReduce(ctx, front, 1);
    // ① 首次物理（普攻也算「攻击伤害」）−50%
    expect(amount('physical', 'basic')).toBe(500);
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'attack')).toBe(true);
    // ② 同回合第二次物理不再减
    expect(amount('physical', 'skill', 'active')).toBe(1000);
    // ③ 攻击轨用完**不影响**策略攻击轨：本回合首次策略攻击仍 −50%
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'strategy')).toBe(false);
    expect(amount('strategy', 'skill', 'active')).toBe(500);
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'strategy')).toBe(true);
    // ④ 两轨都用完后本回合不再减
    expect(amount('strategy', 'skill', 'active')).toBe(1000);
    expect(amount('physical', 'skill', 'pursuit')).toBe(1000);

    // ⑤ 下回合重挂 → 两轨额度都恢复（策略先行也只吃掉策略轨）
    applyFrontReduce(ctx, front, 2);
    expect(amount('strategy', 'skill', 'active')).toBe(500);
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'strategy')).toBe(true);
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'attack')).toBe(false);
    expect(amount('physical', 'skill', 'pursuit')).toBe(500);

    // ⑥ 状态常驻（duration 999）+ 同源重挂 = 刷新，不新增实例
    expect(front.statuses.filter((s) => s.type === 'damage_reduce')).toHaveLength(2);
  });

  it('前锋减伤：DoT 跳伤不算攻击（excludeDot）→ 不吃减伤、也不消耗本回合额度', () => {
    const ctx = makeCtx(team());
    const front = byPos(ctx, '前锋');
    const enemy = isolateTarget(ctx);
    applyFrontReduce(ctx, front, 1);

    // 构造带「挂上时冻结」的燃烧，走 dealDotDamage 的 dot_tick 路径（hit 带 dotType）
    front.statuses.push({
      type: 'burning',
      remaining: 2,
      rate: 1,
      sourceStrategy: 100,
      appliedRound: 1,
      sourceSkillType: 'active',
      sourceSkillId: 'huoshi_fengwei',
      sourceUnitId: enemy.general.id,
      stored: { damage: 600, breakdown: { troopBase: 0, statBase: 0, main: 600 } },
    } as never);
    const burning = front.statuses.find((s) => s.type === 'burning')!;
    const before = front.troops;
    dealDotDamage(ctx, front, burning as never);
    expect(before - front.troops).toBe(600); // DoT 不吃 50% 减伤
    expect(ctx.events.some((e) => e.type === 'dot_tick')).toBe(true);
    // 两轨额度都没被 DoT 消耗
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'attack')).toBe(false);
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'strategy')).toBe(false);

    // 额度仍在 → 随后的主动策略攻击 −50%（DoT 是策略伤害，但不算「策略攻击」）
    const next = front.troops;
    hitUnit(ctx, front, enemy, 1000, 'strategy', 'skill', 'active');
    expect(next - front.troops).toBe(500);
    expect(reduceUsedThisRound(ctx, front, 'jixian_yuanjin', 'strategy')).toBe(true);
  });

  it('大营无视规避：常驻不消耗——连续两次攻击都免疫规避；中军照旧被规避', () => {
    const ctx = makeCtx(team());
    const back = byPos(ctx, '大营');
    const enemy = ctx.enemyTeam[0];
    ctx.currentRound = 1;
    inflictStatus(
      ctx,
      back,
      { type: 'ignore_evasion', duration: 999, throughRound: 999 },
      'command',
      'jixian_yuanjin',
      back.general.id
    );
    // 目标带 2 层必挡规避
    inflictStatus(ctx, enemy, { type: 'evasion', stacks: 2 }, 'command', 'xuefen_duanbing', enemy.general.id);

    expect(consumeEvasion(ctx, enemy, back.general.id)).toBe(false); // 大营攻击 → 不规避
    expect(statusOf(back, 'ignore_evasion')).toBeDefined(); // 常驻，未被消耗
    expect(ctx.events.some((e) => e.type === 'evasion_blocked')).toBe(false);
    expect(statusOf(enemy, 'evasion')).toBeDefined(); // 敌方规避层也未消耗

    expect(consumeEvasion(ctx, enemy, back.general.id)).toBe(false); // 第二次依旧无视
    expect(statusOf(back, 'ignore_evasion')).toBeDefined();

    // 对照：**中军**攻击仍会被规避（效果只给大营）
    expect(consumeEvasion(ctx, enemy, byPos(ctx, '中军').general.id)).toBe(true);
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked')).toHaveLength(1);
  });

  it('普攻增伤：被注册的我军（非携带者）普攻命中后，目标本回合受伤 +15%；同一目标叠加', () => {
    const ctx = makeCtx(team(), [dummy('enemy-front', '前锋', 2), dummy('enemy-mid', '中军', 2)]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    expect(ctx.basicHitProcs ?? []).toHaveLength(3); // 我军全体逐单位注册

    // 条件读部署名单：即便我军已有 2 人阵亡（实时距离/存活数改变），本战法仍照常生效
    ctx.myTeam[0].alive = false;
    ctx.myTeam[2].alive = false;

    const target = isolateTarget(ctx);
    const mid = byPos(ctx, '中军');
    mid.general.attack = 1000; // 保证命中扣兵
    actUnit(ctx, mid);

    const boost = statusOf(target, 'damage_boost');
    expect(boost?.sourceSkillId).toBe('jixian_yuanjin');
    if (boost?.type === 'damage_boost') {
      expect(boost.direction).toBe('taken');
      expect(boost.rate).toBeCloseTo(0.15, 6);
    }
    const trig = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'jixian_yuanjin'
    );
    expect(trig?.unitId).toBe('ally-mid'); // 判定方 = 实际普攻者
    expect(trig?.skillName).toBe('计险远近');
    // 同回合内多重命中靠状态自身叠层（stack: true），不靠重复注册
    expect(ctx.basicHitProcs ?? []).toHaveLength(3);
  });

  it('普攻增伤：同一目标被多次命中时同战法累加（+15% → +30%）', () => {
    const ctx = makeCtx(team(), [dummy('enemy-front', '前锋', 2)]);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const target = isolateTarget(ctx);

    // 模拟两名友军先后普攻命中同一目标（同一被注册钩子被触发两次）
    const front = byPos(ctx, '前锋');
    const boostStatus: CreateStatus = {
      type: 'damage_boost',
      rate: 0.15,
      duration: 1,
      direction: 'taken',
      stack: true,
    };
    inflictStatus(ctx, target, boostStatus, 'command', 'jixian_yuanjin', front.general.id);
    inflictStatus(ctx, target, boostStatus, 'command', 'jixian_yuanjin', front.general.id);

    const stacked = statusOf(target, 'damage_boost');
    // 显式 stack: true → 同源重复施加累加（不带「可叠加」标记的效果一律刷新）
    if (stacked?.type === 'damage_boost') expect(stacked.rate).toBeCloseTo(0.3, 6);
    else throw new Error('期望目标身上有计险远近的受伤提升');
  });

  it('普攻增伤：数值真的吃到（同种子双跑：增伤后单次普攻伤害更高，且 < 115%）', () => {
    const run = (withBoost: boolean) => {
      const ctx = makeCtx(team(), [dummy('enemy-front', '前锋', 2)]);
      const target = isolateTarget(ctx);
      const striker = ctx.myTeam[1]; // 中军
      striker.general.attack = 500;
      striker.general.attackRange = 3;
      if (withBoost) {
        inflictStatus(
          ctx,
          target,
          { type: 'damage_boost', rate: 0.15, duration: 1, direction: 'taken', stack: true },
          'command',
          'jixian_yuanjin',
          striker.general.id
        );
      }
      actUnit(ctx, striker); // 普攻（无连击 → 恰好 1 次）
      const hits = ctx.events.filter(
        (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
          e.type === 'attack_hit' && e.sourceId === striker.general.id
      );
      return hits[0]?.damage ?? 0;
    };
    const base = run(false);
    const boosted = run(true);
    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(base);
    expect(boosted / base).toBeLessThanOrEqual(1.15);
  });
});
