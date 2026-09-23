/**
 * 回合期望模型（L2）：把一支队伍的战法配置折算成「每回合期望伤害 / 前三回合总伤」。
 * ---------------------------------------------------------------------------
 * 口径（用户 2026-09-22 确认）：**只算回合期望，不含控制、规避、兵力截断、目标阵亡**——
 * 即输出上界口径；这些减益以后单独做折损列，不混进本模型。
 *
 * 每个战法解析成三样东西，再按回合做期望求和：
 *   ① segments 直接伤害段：伤害率 / 目标数 / 重复次数 / 段几率 / 回合窗口 / 无视防御 / 免受克制
 *   ② dots     持续伤害：妖术·燃烧·恐慌·诅咒·引燃 → 跳数 × 单跳伤害（兵力基础 ×1/3、谋略基础 ×0.25）
 *   ③ effects  修正：增减伤 / 属性 / 连击 / 发动率提升（同类型取较高、显式叠层累加 —— 引擎冲突口径）
 *
 * 出手位（与引擎主流程一致）：普攻（每回合 1 次；连击 → 2 次）→ 追击（每次普攻后判定）→
 * 主动（每回合判定）→ 准备主动（发动后隔 k 回合释放，占用该回合）→ 一类指挥（准备阶段 1 次）→
 * 二类指挥（每回合判定 / 动态发动率）→ 被动（battle_start 一次 / round_start 每回合一次）
 *
 * 期望发动次数（解析式，非模拟）：
 *   主动 / 二类指挥：E[回合 t] = pᵗ
 *   准备主动（prepareTurns = k）：E[回合 t] = p(1−p)^(t−1−k)（t ≥ k+1，否则 0）
 *   追击：E = 普攻次数(t) × pᵗ，普攻次数 = 1 + P(连击)
 *   动态发动率：r₁ = base，未生效 +inc、生效重置 base
 *   发动率递减 / 伤害率递增：按「此前期望发动次数」递推
 *
 * 近似（都在 UI 里标注，不静默）：① 带几率的修正按几率折算强度；② 单体友军增益按全队计；
 * ③ 同队多个主动战法独立判定（准备占用不互相阻塞）；④ 敌方降谋略/降防按最负值作用于目标模板。
 * 单次伤害一律回到 L1 模型（web/damageModel.ts → 引擎 calcDamage），口径与战报同源。
 */
import { moraleRate, roundRate, scaledValue } from '../src/engine/formulas';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { CreateStatus, Skill, SkillOutput, SkillType, TroopType } from '../src/engine/types';
import { statsOf, type ModelParams } from './damageModel';

/** grant_damage_boost 段（大赏三军 / 神兵天降）：数值受施法者谋略缩放，此处只存原始基值与成长率 */
const GRANT_KEYS = new Set(['kind', 'rate', 'growthRate', 'duration', 'direction', 'stack']);

// ─────────────────────────── 解析层 ───────────────────────────

export type SkillSlot =
  | 'basic'
  | 'pursuit'
  | 'active'
  | 'prepared'
  | 'command-prep'
  | 'command-round'
  | 'passive';

export const SLOT_LABEL: Record<SkillSlot, string> = {
  basic: '普攻',
  pursuit: '追击',
  active: '主动',
  prepared: '准备',
  'command-prep': '一类指挥',
  'command-round': '二类指挥',
  passive: '被动',
};

export interface ParsedSegment {
  kind: 'physical' | 'strategy';
  /** 伤害率（区间取中值） */
  rate: number;
  scaled: boolean;
  growth: number;
  targets: number;
  repeats: number;
  ratePerRepeat: number;
  /** 每次发动后伤害率递增（段级 ratePerCast，缺省继承战法级） */
  ratePerCast: number;
  chance: number;
  startRound: number;
  endRound: number;
  ignoreDefense: boolean;
  ignoreTroopCounter: boolean;
  /** roundRepeat 类段的生效回合窗口（覆盖 startRound / endRound） */
  window?: RoundWindow;
  /** 近似处理说明（如区间取中值） */
  approx?: string[];
  /** 未建模的段级字段（该段只按基础部分计入） */
  unmodeled: string[];
}

export interface ParsedDot {
  label: string;
  rate: number;
  growth: number;
  /** 持续回合 = 跳数（≥999 视作打到结束） */
  ticks: number;
  chance: number;
  targets: number;
  /** 近似处理说明 */
  approx?: string[];
  unmodeled: string[];
}

export type EffectKind =
  | 'boostCaused'
  | 'boostTaken'
  | 'reduce'
  | 'attack'
  | 'strategy'
  | 'defense'
  | 'combo'
  | 'triggerBoost'
  | 'ignoreDef'
  | 'split';

export const EFFECT_LABEL: Record<EffectKind, string> = {
  boostCaused: '造成伤害提高',
  boostTaken: '目标受到伤害提高',
  reduce: '目标减伤',
  attack: '攻击',
  strategy: '谋略',
  defense: '目标防御下降',
  combo: '连击几率',
  triggerBoost: '发动率提升',
  ignoreDef: '无视目标防御',
  split: '分兵（普攻追加伤害）',
};

/** roundRepeat / roundStartRepeat 类效果的生效回合窗口 */
export interface RoundWindow {
  start: number;
  end: number;
  /** 只在列出的回合生效（雅虑适时第 3/5/7 回合） */
  only?: number[];
  /** 仅奇数回合（鱼鳞） */
  odd?: boolean;
  /** 与 start 之差的奇偶（桃园结义【追加】交替段） */
  parity?: 0 | 1;
}

/** 第 t 回合是否落在窗口内 */
export function inWindow(w: RoundWindow | undefined, t: number): boolean {
  if (!w) return false;
  if (t < w.start || t > w.end) return false;
  if (w.only && !w.only.includes(t)) return false;
  if (w.odd && t % 2 === 0) return false;
  if (w.parity !== undefined && (t - w.start) % 2 !== w.parity) return false;
  return true;
}

/**
 * 解析上下文：段级 / 技能级条件（典藏【追加】段、队伍构成门槛）求值所需。
 * 缺字段时对应条件按「满足」处理并记近似——不静默算错。
 */
export interface ParseContext {
  /** 施法者武将名（casterNames 条件） */
  casterName?: string;
  /** 施法者阵营（casterFactions 条件） */
  casterFaction?: string;
  /** 施法者站位（casterPositions 条件） */
  casterPosition?: string;
  /** 我方出战三人阵营 / 基础兵种 / 性别 */
  teamFactions?: string[];
  teamTroops?: TroopType[];
  teamGenders?: Array<'male' | 'female'>;
  /** 敌方士气（morale_branch 逐目标判定；缺省 = 我方士气） */
  enemyMorale?: number;
}
export interface ParsedEffect {
  kind: EffectKind;
  /** 状态被施加的概率（分兵/连击等状态类冲突判定用；缺省 1） */
  probability?: number;
  /** 未缩放基值：增减伤=分数（0.3）、属性=点数或百分数、连击/发动率=概率（带几率的已按几率折算） */
  value: number;
  duration: number;
  side: 'self' | 'enemy';
  scope: 'team' | 'caster';
  stack: boolean;
  maxStacks: number;
  /** grant_damage_boost：数值按施法者谋略缩放（基值 % + 成长率%/点），结算时才换算 */
  scaledBase?: number;
  scaledGrowth?: number;
  /**
   * 状态类数值按施法者属性缩放（引擎口径，见 action.ts 施加分支）：
   *  · mode 'rate'（增减伤/减伤，值为分数）：sign × roundRate(scaledValue(|rate|×100, growth, 属性)) / 100
   *  · mode 'amount'（属性 buff，值为点数/百分数）：sign × (percent ? roundRate : round)(scaledValue(|amount|, growth, 属性))
   */
  scaling?: {
    mode: 'rate' | 'amount';
    percent: boolean;
    attr: 'attack' | 'defense' | 'strategy' | 'speed';
    growth: number;
  };
  /** 作用范围过滤（只作用于匹配的伤害；按「独立叠加」近似，见 approx） */
  filters?: {
    damageType?: 'physical' | 'strategy';
    skillTypes?: SkillType[];
    source?: 'basic' | 'skill';
  };
  /**
   * 数值按份数衰减（虎豹督军 decayEighths / 谋议宏图 / 恃强淬锋 decayFifths / 抚民励德 decayOnDeal）：
   * 第 round 回合的系数 = max(0, parts − (round − 首回合)) / parts（受击/造成衰减按每回合近似）。
   */
  decay?: { parts: number; mode: 'round' | 'hit' };
  /** 近似处理说明（不算「未建模」，不影响严格池） */
  approx?: string[];
  /** 未建模字段 */
  unmodeled: string[];
  /** roundRepeat 类效果的生效回合窗口（覆盖 duration 口径） */
  window?: { start: number; end: number };
}

/** 单位属性（缩放用；缺省 80 = 率土基准） */
export interface ScalingAttrs {
  attack: number;
  strategy: number;
  defense?: number;
  speed?: number;
}

/** 效果的实际数值：受属性缩放时按引擎公式换算，否则原值 */
export function effectValue(e: ParsedEffect, attrs: ScalingAttrs): number {
  if (e.scaledBase !== undefined) {
    return roundRate(scaledValue(e.scaledBase, e.scaledGrowth ?? 0, attrs.strategy)) / 100;
  }
  if (!e.scaling) return e.value;
  const { mode, percent, attr, growth } = e.scaling;
  const attrValue =
    attr === 'attack' ? attrs.attack : attr === 'strategy' ? attrs.strategy : attr === 'defense' ? attrs.defense ?? 80 : attrs.speed ?? 80;
  const sign = Math.sign(e.value) || 1;
  const mag = Math.abs(e.value);
  if (mode === 'rate') return sign * (roundRate(scaledValue(mag * 100, growth, attrValue)) / 100);
  const scaled = scaledValue(mag, growth, attrValue);
  return sign * (percent ? roundRate(scaled) : Math.round(scaled));
}

export interface ParsedSkill {
  id: string;
  name: string;
  slot: SkillSlot;
  timing: string;
  /** 期望发动率（已含士气修正；被动 / 一类指挥 = 1） */
  rate: number;
  prepareTurns: number;
  decayPerCast: number;
  ratePerCast: number;
  /** 二类指挥动态发动率（base 已含士气修正） */
  dynamic?: { base: number; increment: number };
  segments: ParsedSegment[];
  dots: ParsedDot[];
  effects: ParsedEffect[];
  unmodeled: string[];
  /** 队伍构成 / 站位门槛不满足 → 整次不生效（已建模，不算未覆盖） */
  gated?: string;
}

const SKILL_KEYS = new Set([
  'id', 'name', 'type', 'range', 'triggerRate', 'tags', 'groupCount', 'targetMode', 'targetSide',
  'output', 'phase', 'prepare', 'prepareTurns', 'timing', 'damageRatePerCast', 'triggerRateDecayPerCast',
  'dynamicTriggerRate', 'roundRepeat', 'roundStartRepeat', 'initialOutput', 'retainAfterDeath', 'priorityRounds', 'casterPositions', 'delayedOutput', 'teamTroopFilter', 'teamFactionDistinct', 'teamGenderFilter', 'startRound', 'endRound', 'roundTrigger',
]);

const SEG_KEYS = new Set([
  'kind', 'rate', 'targetMode', 'groupCount', 'repeats', 'chance', 'startRound', 'endRound',
  'strategyScaled', 'growthRate', 'ratePerRepeat', 'ratePerCast', 'dotFormula',
  'ignoresEvasion', 'ignoresDefense', 'ignoresTroopCounter', 'targetSide', 'target', 'chain', 'rateBySelfTroopRatio', 'ratePerCast',
  // 选目标类字段：本模型只有「一个抽象的敌方模板」，选谁/距离不影响单次伤害 → 记近似而非未建模
  'range', 'ignoreRange', 'positions', 'targetPick', 'troopTypes',
]);

const STATUS_KEYS = new Set([
  'type', 'amount', 'rate', 'duration', 'direction', 'stack', 'maxStacks', 'growthRate',
  'strategyScaled', 'attackScaled', 'defenseScaled', 'speedScaled', 'percent',
  'damageType', 'skillTypes', 'damageSource', 'dotTypes',
  // 叠层标记（银龙冲阵 / 令明负榇）与 DoT 跳伤附加行为（移除buff/无视规避/普攻触发）不改变伤害期望
  'stacks', 'clearBuffsOnTick', 'ignoresEvasionOnTick', 'triggerOnBasic', 'undispellable',
  'decayFifths', 'decayEighths', 'decayRoundParts', 'decayOnDeal', 'selfPhysBoost', 'hurtStackPer',
  'targetFactionNotSelf', 'perTargetStatusCount',
]);

const DOT_TYPES = new Set(['sorcery', 'burning', 'panic', 'curse', 'ignite']);

/** 段级条件（OutputCondition 的模型子集） */
interface Cond {
  casterNames?: string[];
  casterFactions?: string[];
  teamFactionSame?: boolean;
  teamTroopSame?: boolean;
  startRound?: number;
  endRound?: number;
  rounds?: number[];
  parity?: 0 | 1;
}

/** 控制 / 护盾 / 回复类：与「我方输出」无关，无论施加给谁都不算未建模 */
const CONTROL_TYPES = new Set([
  'confusion', 'rampage', 'cowardice', 'hesitation', 'taunt', 'evasion', 'evade_chance', 'insight', 'siege',
  'control_immune', 'control_extend', 'no_retaliate', 'hurt_evade_once', 'damage_share', 'avoid_charge', 'cover',
  'heal_boost', 'heal_out_boost', 'heal_trigger_reduce', 'rest', 'first_aid', 'remove_buffs', 'remove_debuffs',
  'priority', 'hurt_stack', 'speed_buff', 'range_buff', 'skill_range_buff', 'attack_range_buff',
]);
const DOT_LABEL: Record<string, string> = {
  sorcery: '妖术',
  burning: '燃烧',
  panic: '恐慌',
  curse: '妖术诅咒',
  ignite: '引燃',
};

function mid(v: number | [number, number] | undefined, fallback = 1): number {
  if (v === undefined) return fallback;
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

function noneIfKnown(obj: Record<string, unknown>, keys: string[]): string[] {
  return extraKeys(obj, new Set(keys));
}

function extraKeys(obj: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k) && obj[k] !== undefined);
}

/** targetMode / groupCount → 目标数（'all' = 敌军 3 目标；'group' = groupCount 缺省 2） */
function targetCount(mode: string | undefined, groupCount: number | [number, number] | undefined): number {
  if (mode === 'all') return 3;
  if (mode === 'group') return mid(groupCount, 2);
  return 1;
}

/**
 * 状态 → 修正效果。
 * 返回 `skip: 'defensive'` 表示「与输出无关」（防御/控制/回复类，不算未建模）；
 * 返回 `skip: 'unmodeled'` 表示「可能影响输出但本模型没算」（会进未建模清单，卡严格池）。
 */
function effectFromStatus(
  type: string,
  value: number,
  duration: number,
  meta: {
    gate: number;
    stack: boolean;
    maxStacks: number;
    side: 'self' | 'enemy';
    scope: 'team' | 'caster';
    direction?: 'caused' | 'taken';
    percent?: boolean;
    growth?: number;
    attrScale?: 'attack' | 'defense' | 'strategy' | 'speed';
    filters?: ParsedEffect['filters'];
    decay?: ParsedEffect['decay'];
    approx?: string[];
    unmodeled: string[];
    /** roundRepeat 类效果的生效回合窗口（覆盖 duration 口径） */
    window?: RoundWindow;
  }
): { eff: ParsedEffect | null; skip?: 'defensive' | 'unmodeled' } {
  const notes = [...meta.unmodeled];
  const approx = [...(meta.approx ?? [])];
  if (meta.stack) approx.push('叠层按期望层数计（每回合重挂 +1 层 / 主动按期望发动次数）');
  const scaling =
    meta.growth !== undefined && meta.attrScale
      ? { mode: 'rate' as const, percent: false, attr: meta.attrScale, growth: meta.growth }
      : undefined;
  const mk = (kind: EffectKind, v: number, scalingOverride?: ParsedEffect['scaling']): ParsedEffect => ({
    kind,
    value: v * meta.gate,
    duration,
    side: meta.side,
    scope: meta.scope,
    stack: meta.stack,
    maxStacks: meta.maxStacks,
    scaling: scalingOverride ?? scaling,
    filters: meta.filters,
    decay: meta.decay,
    approx,
    unmodeled: notes,
    window: meta.window,
  });
  switch (type) {
    case 'damage_boost': {
      // direction：caused = 造成伤害提高/降低（自方才有意义）；taken（缺省）= 受到伤害提高/降低
      const dir = meta.direction ?? 'taken';
      if (dir === 'caused') {
        if (meta.side === 'self') return { eff: mk('boostCaused', value) };
        return { eff: null, skip: 'defensive' }; // 敌方造成伤害降低 = 防御类
      }
      if (meta.side === 'enemy') return { eff: mk('boostTaken', value) };
      return { eff: null, skip: 'defensive' }; // 我方受到伤害变化 = 防御类
    }
    case 'damage_reduce':
      return meta.side === 'enemy' ? { eff: mk('reduce', value) } : { eff: null, skip: 'defensive' };
    case 'ignore_def':
      // 击势：无视目标防御（结算攻防差前 目标防御 × (1 − rate)）
      return meta.side === 'self' ? { eff: mk('ignoreDef', Math.abs(value)) } : { eff: null, skip: 'defensive' };
    case 'attack_buff':
      return meta.side === 'self'
        ? { eff: mk('attack', value, { mode: 'amount', percent: Boolean(meta.percent), attr: 'attack', growth: meta.growth ?? 0 }) }
        : { eff: null, skip: 'defensive' }; // 敌方降攻不影响我方输出
    case 'strategy_buff':
      return {
        eff: mk('strategy', meta.side === 'self' ? value : -value, {
          mode: 'amount',
          percent: Boolean(meta.percent),
          attr: 'strategy',
          growth: meta.growth ?? 0,
        }),
      };
    case 'defense_buff':
      return meta.side === 'enemy' ? { eff: mk('defense', value) } : { eff: null, skip: 'defensive' };
    case 'combo':
      // 连击：状态类（本回合至多 2 次普攻），多来源按「至少一个生效」处理（先施加者生效，非叠加）
      return meta.side === 'self' ? { eff: { ...mk('combo', 1), probability: meta.gate } } : { eff: null, skip: 'unmodeled' };
    case 'trigger_boost':
      return { eff: mk('triggerBoost', value) };
    default:
      // 控制 / 护盾 / 回复类：与「我方输出」无关，无论施加给谁都算「不算未建模」
      if (CONTROL_TYPES.has(type)) return { eff: null, skip: 'defensive' };
      return { eff: null, skip: meta.side === 'self' ? 'unmodeled' : 'defensive' };
  }
}

/** 解析单个战法：出手位 + 发动率 + 伤害段 + DoT + 修正 + 未建模字段 */
export function parseSkill(skill: Skill, morale = 100, ctx: ParseContext = {}): ParsedSkill {
  const raw = skill as unknown as Record<string, unknown>;
  /** 技能级门槛（队伍构成 / 站位）：不满足 → 整次不生效（引擎口径，属「已建模」而非未建模） */
  const gateFailure = ((): string | undefined => {
    const troopFilter = (skill as { teamTroopFilter?: TroopType[] }).teamTroopFilter;
    if (troopFilter && ctx.teamTroops && !ctx.teamTroops.every((t) => troopFilter.includes(t))) {
      return `队伍兵种不满足（${ctx.teamTroops.join('/')} ⊄ ${troopFilter.join('/')}），本战法不生效`;
    }
    if ((skill as { teamFactionDistinct?: boolean }).teamFactionDistinct && ctx.teamFactions) {
      if (new Set(ctx.teamFactions).size !== 3) return '三方阵营未两两不同，本战法不生效';
    }
    const genderFilter = (skill as { teamGenderFilter?: string }).teamGenderFilter;
    if (genderFilter && ctx.teamGenders && !ctx.teamGenders.every((g) => g === genderFilter)) {
      return `队伍性别不满足（需全 ${genderFilter}），本战法不生效`;
    }
    const positions = (skill as { casterPositions?: string[] }).casterPositions;
    if (positions && ctx.casterPosition && !positions.includes(ctx.casterPosition)) {
      return `施法者站位不在 ${positions.join('/')}，本战法不生效`;
    }
    return undefined;
  })();
  const inert = Boolean(gateFailure);
  if (inert) {
    return {
      id: skill.id,
      name: skill.name,
      slot: 'passive',
      timing: 'round_start',
      rate: 0,
      prepareTurns: 1,
      decayPerCast: 0,
      ratePerCast: 0,
      segments: [],
      dots: [],
      effects: [],
      unmodeled: [],
      gated: gateFailure,
    };
  }
  const prepare = Boolean((skill as { prepare?: boolean }).prepare);
  const type = skill.type as string;
  const phase = (skill as { phase?: string }).phase;
  const timing = String((skill as { timing?: string }).timing ?? 'round_start');
  const slot: SkillSlot =
    type === 'pursuit'
      ? 'pursuit'
      : type === 'active'
        ? prepare
          ? 'prepared'
          : 'active'
        : type === 'command'
          ? phase === 'prep'
            ? 'command-prep'
            : 'command-round'
          : 'passive';

  const baseRate = mid(skill.triggerRate as number | [number, number] | undefined);
  const rated = slot !== 'passive' && slot !== 'command-prep';
  const rate = rated ? Math.min(1, baseRate * moraleRate(morale)) : 1;

  const outputs = ((skill as { output?: SkillOutput[] }).output ?? []) as SkillOutput[];
  /** 技能级回合窗口（如先声夺人「前 3 回合」）→ 作用到全部输出段 */
  const skillStart = Number((skill as { startRound?: number }).startRound ?? 1);
  const skillEnd = Number((skill as { endRound?: number }).endRound ?? 99);
  const skillGroup = (skill as { groupCount?: number | [number, number] }).groupCount;
  const skillMode = (skill as { targetMode?: string }).targetMode;
  const skillSide = (skill as { targetSide?: string }).targetSide;
  const skillRatePerCast = Number((skill as { damageRatePerCast?: number }).damageRatePerCast ?? 0);

  const segments: ParsedSegment[] = [];
  const dots: ParsedDot[] = [];
  const effects: ParsedEffect[] = [];
  const unsupportedOutputs: string[] = [];

  const walk = (outs: SkillOutput[], gate: number, window?: RoundWindow): void => {
    // 技能级窗口（startRound/endRound）与段级窗口取交集
    const sklWindow: RoundWindow | undefined =
      skillStart > 1 || skillEnd < 99 ? { start: Math.max(skillStart, window?.start ?? 1), end: Math.min(skillEnd, window?.end ?? 99) } : window;
    for (const out of outs) {
      const o = out as unknown as Record<string, unknown>;
      if (out.kind === 'physical_damage' || out.kind === 'strategy_damage') {
        const mode = (o.targetMode as string | undefined) ?? skillMode;
        const side = (o.targetSide as string | undefined) ?? skillSide;
        // 打友军 / 自身的伤害段不计入对敌输出
        if (side === 'ally' || side === 'self' || o.target === 'self') continue;
        segments.push({
          kind: out.kind === 'physical_damage' ? 'physical' : 'strategy',
          rate: mid(out.rate as number | [number, number]),
          scaled: out.kind === 'strategy_damage' && Boolean((out as { strategyScaled?: boolean }).strategyScaled),
          growth: Number((out as { growthRate?: number }).growthRate ?? 0),
          targets: Math.max(1, targetCount(mode, (o.groupCount as number | [number, number] | undefined) ?? skillGroup)),
          repeats: (() => {
            const base = Math.max(1, mid((o.repeats as number | [number, number] | undefined) ?? 1));
            const chain = o.chain as { chance?: number; decay?: number } | undefined;
            if (!chain || typeof chain.chance !== 'number') return base;
            return base * (1 + chainExtraRepeats(Math.min(1, chain.chance * moraleRate(morale)), Number(chain.decay ?? 0)));
          })(),
          ratePerRepeat: Number(o.ratePerRepeat ?? 0),
          ratePerCast: Number(o.ratePerCast ?? skillRatePerCast),
          chance: Math.min(1, gate * Number(o.chance ?? 1) * moraleRate(morale)),
          startRound: Number(o.startRound ?? 1),
          endRound: Number(o.endRound ?? 99),
          ignoreDefense: Boolean(o.ignoresDefense),
          ignoreTroopCounter: Boolean(o.ignoresTroopCounter),
          approx: [
            ...(String(out.kind) === 'physical_damage' || String(out.kind) === 'strategy_damage' ? [] : []),
            ...(o.troopTypes !== undefined ? ['按兵种过滤目标的段：按全部目标计'] : []),
            ...(o.targetPick !== undefined || o.positions !== undefined ? ['定向选敌段：按普通目标计'] : []),
            ...((o.repeats as unknown) !== undefined && Array.isArray(o.repeats) ? ['重复次数区间取中值'] : []),
            ...(Array.isArray(out.rate) ? ['伤害率区间取中值'] : []),
            ...(o.chain !== undefined ? ['连锁段按期望次数折算'] : []),
            ...(o.rateBySelfTroopRatio !== undefined ? ['兵力比例条件段按基础伤害率计'] : []),
          ],
          unmodeled: extraKeys(o, SEG_KEYS),
          window: sklWindow,
        });
        continue;
      }
      if (out.kind === 'chance_group') {
        const cg = out as { chance: number; outputs: SkillOutput[] };
        walk(cg.outputs, gate * cg.chance, sklWindow);
        continue;
      }
      if (out.kind === 'conditional') {
        // 典藏战法【追加】段：require / unless 条件满足才结算（回合类条件转成段窗口）
        const cond = out as { require?: Cond; unless?: Cond; outputs?: SkillOutput[] };
        const evalCond = (c: Cond): { ok: boolean; window?: RoundWindow } => {
          let ok = true;
          const win: RoundWindow = { start: Number(c.startRound ?? 1), end: Number(c.endRound ?? 99), only: c.rounds, parity: c.parity };
          if (c.casterNames && ctx.casterName) ok = ok && c.casterNames.includes(ctx.casterName);
          if (c.casterFactions && ctx.casterFaction) ok = ok && c.casterFactions.includes(ctx.casterFaction);
          if (c.teamFactionSame && ctx.teamFactions) ok = ok && new Set(ctx.teamFactions).size === 1;
          if (c.teamTroopSame && ctx.teamTroops) ok = ok && new Set(ctx.teamTroops).size === 1;
          const hasRoundCond =
            c.startRound !== undefined || c.endRound !== undefined || c.rounds !== undefined || c.parity !== undefined;
          return { ok, window: hasRoundCond ? win : undefined };
        };
        const req = cond.require ? evalCond(cond.require) : { ok: true as boolean, window: undefined };
        const unl = cond.unless ? evalCond(cond.unless) : { ok: false as boolean, window: undefined };
        // require 命中且 unless 未命中 → 结算；否则跳过（同一战法两段互斥）
        if (req.ok && !unl.ok) walk(cond.outputs ?? [], gate, req.window ?? sklWindow);
        continue;
      }
      if (out.kind === 'morale_branch') {
        // 士气分支：按目标（敌方）或施法者自身士气整体判定一次，执行 high / low 分支
        const mb = out as {
          threshold?: number;
          compareTo?: 'threshold' | 'caster';
          by?: 'caster' | 'target';
          high?: SkillOutput[];
          low?: SkillOutput[];
        };
        const judge = (targetMorale: number): boolean =>
          mb.compareTo === 'caster' ? targetMorale >= morale : targetMorale > (mb.threshold ?? 100);
        const useHigh = mb.by === 'caster' ? judge(morale) : judge(ctx.enemyMorale ?? morale);
        if (useHigh) walk(mb.high ?? [], gate, sklWindow);
        else walk(mb.low ?? [], gate, sklWindow);
        continue;
      }
      if (out.kind === 'grant_damage_boost') {
        // 大赏三军 / 神兵天降：增伤 = roundRate(scaledValue(rate, growthRate, 施法者谋略))/100
        const g = out as { rate: number; growthRate: number; duration: number; direction?: 'caused' | 'taken'; stack?: boolean };
        const direction = g.direction ?? 'taken';
        const side: 'self' | 'enemy' = skillSide === 'enemy' || direction === 'taken' ? 'enemy' : 'self';
        effects.push({
          kind: direction === 'caused' ? 'boostCaused' : 'boostTaken',
          value: 0,
          scaledBase: g.rate,
          scaledGrowth: g.growthRate,
          duration: g.duration,
          side,
          scope: 'team',
          stack: Boolean(g.stack),
          maxStacks: 1,
          unmodeled: extraKeys(o, GRANT_KEYS),
          window: sklWindow,
        });
        continue;
      }
      if (out.kind === 'inflict_status') {
        const ist = out as {
          status: CreateStatus | CreateStatus[];
          target?: string;
          targetSide?: string;
          targetMode?: string;
          groupCount?: number | [number, number];
          chance?: number;
        };
        const statuses = Array.isArray(ist.status) ? ist.status : [ist.status];
        const explicitSide = ist.targetSide ?? (ist.target === 'self' ? 'self' : undefined) ?? skillSide;
        const mode = ist.targetMode ?? skillMode;
        const segGate = Math.min(1, gate * Number(ist.chance ?? 1) * moraleRate(morale));
        for (const st of statuses) {
          const s = st as unknown as Record<string, unknown>;
          const unmodeled = extraKeys(s, STATUS_KEYS);
          const statusType = String(s.type);
          if (statusType === 'split') {
            // 分兵：普攻命中后对相邻单位追加 rate% 物理伤害（本模型只有一个抽象敌方 → 视作对同一目标）
            effects.push({
              kind: 'split',
              value: Number(s.rate ?? 0),
              probability: segGate,
              duration: Number(s.duration ?? 999),
              side: 'self',
              scope: 'caster',
              stack: false,
              maxStacks: 0,
              approx: [
                ...(s.charges !== undefined ? ['次数型分兵按整场有效计'] : []),
                ...(s.strategyScaled !== undefined ? ['分兵伤害率受属性缩放未建模（按基值）'] : []),
              ],
              unmodeled: noneIfKnown(s, ['type', 'rate', 'duration', 'charges', 'strategyScaled']),
              window: sklWindow,
            });
            continue;
          }
          if (DOT_TYPES.has(statusType)) {
            dots.push({
              label: DOT_LABEL[statusType] ?? statusType,
              rate: Number(s.rate ?? 0),
              growth: Number(s.growthRate ?? 0),
              ticks: Math.min(Number(s.duration ?? 1), Number(s.charges ?? Number.POSITIVE_INFINITY)),
              chance: segGate,
              targets: Math.max(1, targetCount(mode, ist.groupCount ?? skillGroup)),
              unmodeled,
            });
            continue;
          }
          // 作用对象：显式 targetSide 优先，否则按数值符号（负值 = 减益 → 敌方）
          const numeric = Number(s.rate ?? s.amount ?? 0);
          const side: 'self' | 'enemy' =
            explicitSide === 'enemy' ? 'enemy' : explicitSide === undefined && numeric < 0 ? 'enemy' : 'self';
          // 作用范围过滤：damageType / skillTypes / damageSource → 只作用于匹配的伤害
          const filters: NonNullable<ParsedEffect['filters']> = {};
          if (s.damageType === 'physical' || s.damageType === 'strategy') filters.damageType = s.damageType;
          if (Array.isArray(s.skillTypes)) filters.skillTypes = s.skillTypes as SkillType[];
          if (s.damageSource === 'basic' || s.damageSource === 'skill') filters.source = s.damageSource;
          const hasFilter = Object.keys(filters).length > 0;
          const approx: string[] = [];
          if (hasFilter) approx.push('过滤类增减伤按「独立叠加」近似（引擎冲突取较高不区分过滤维度）');
          const decayParts = Number(s.decayEighths ?? s.decayRoundParts ?? s.decayFifths ?? s.decayOnDeal ?? 0);
          const decay: ParsedEffect['decay'] | undefined =
            decayParts > 0
              ? { parts: decayParts, mode: s.decayEighths !== undefined || s.decayRoundParts !== undefined ? 'round' : 'hit' }
              : undefined;
          const ignoredFilters = [
            'troopTypes', 'requireGender', 'requirePositions', 'requireStatuses', 'requireSelfStatus',
            'firstHitPerRound', 'hurtStackPer',
            'expireAfterOwnAct', 'targetFactionNotSelf', 'enemyCostBelowSelf', 'perDistance', 'perTargetStatusCount',
            'skillIds', 'undispellable',
            // 次数型（charges）：只作用于接下来 N 次伤害，按整场有效会明显高估 → 一律按未建模处理
            'charges', 'chargesStack',
          ].filter((k) => s[k] !== undefined);
          if (ignoredFilters.length) unmodeled.push(`过滤条件未建模：${ignoredFilters.join('/')}`);
          const growth = s.growthRate === undefined ? undefined : Number(s.growthRate);
          const attrScale =
            growth === undefined
              ? undefined
              : s.attackScaled
                ? ('attack' as const)
                : s.defenseScaled
                  ? ('defense' as const)
                  : s.speedScaled
                    ? ('speed' as const)
                    : s.strategyScaled
                      ? ('strategy' as const)
                      : undefined;
          const effResult = effectFromStatus(statusType, numeric, Number(s.duration ?? 1), {
            gate: segGate,
            stack: Boolean(s.stack ?? s.stacks),
            maxStacks: s.maxStacks === undefined ? 0 : Number(s.maxStacks),
            side,
            direction: (s.direction as 'caused' | 'taken' | undefined) ?? undefined,
            percent: Boolean(s.percent),
            growth,
            attrScale,
            filters: hasFilter ? filters : undefined,
            decay,
            approx,
            scope: mode === 'all' || mode === 'group' ? 'team' : side === 'enemy' ? 'team' : 'caster',
            unmodeled,
            window: sklWindow,
          });
          const { eff, skip } = effResult;
          if (eff) effects.push(eff);
          else if (skip === 'unmodeled') unsupportedOutputs.push(`状态未计入输出：${statusType}`);
        }
        continue;
      }
      // 与输出无关的段（回复 / 移除 / 护盾 / 净化…）不计入未建模清单
      if (/^(heal|remove_|grant_(first_aid|evasion|cover|shield|insight|immune)|rest|cleanse|siege|dispel)/.test(out.kind)) {
        continue;
      }
      unsupportedOutputs.push(`未建模段：${out.kind}`);
    }
  };

  // 一类指挥延迟段（令明负榇 delayedOutput：第 4 回合起进入分兵）
  const delayed = (skill as { delayedOutput?: { atRound?: number; output?: SkillOutput[] } }).delayedOutput;
  if (delayed?.output) {
    const at = Number(delayed.atRound ?? 1);
    walk(delayed.output, 1, { start: at, end: 99 });
  }
  // 一类指挥的开场段（其疾如风 initialOutput：速度 +41）
  const initial = (skill as { initialOutput?: SkillOutput[] }).initialOutput;
  if (initial) walk(initial, 1);

  // 一类指挥 roundRepeat（战必/措手/白衣/其疾如风）：本战法的作用段按几率在窗口内每回合结算
  const rr = (skill as { roundRepeat?: { rate?: number; startRound?: number; endRound?: number; output?: SkillOutput[] } })
    .roundRepeat;
  if (rr) {
    const gate = Math.min(1, Number(rr.rate ?? 1) * moraleRate(morale));
    const window: RoundWindow = { start: Number(rr.startRound ?? 1), end: Number(rr.endRound ?? 99) };
    if (rr.output) walk(rr.output, gate, window);
    else walk(outputs, gate, window);
  } else {
    walk(outputs, 1);
  }

  // 每回合开始必执行段（roundStartRepeat：白刃 / 不攻 / 远攻之策 / 桃园结义）
  const rsr = (
    skill as {
      roundStartRepeat?: { output?: SkillOutput[]; startRound?: number; endRound?: number; oddRounds?: boolean; rounds?: number[] };
    }
  ).roundStartRepeat;
  if (rsr?.output) {
    walk(rsr.output, 1, {
      start: Number(rsr.startRound ?? 1),
      end: Number(rsr.endRound ?? 99),
      only: rsr.rounds,
      odd: rsr.oddRounds,
    });
  }

  const dynt = (skill as { dynamicTriggerRate?: { base?: number; increment?: number } }).dynamicTriggerRate;
  return {
    id: skill.id,
    name: skill.name,
    slot,
    timing,
    rate,
    prepareTurns: Math.max(1, Number((skill as { prepareTurns?: number }).prepareTurns ?? 1)),
    decayPerCast: Number((skill as { triggerRateDecayPerCast?: number }).triggerRateDecayPerCast ?? 0),
    ratePerCast: skillRatePerCast,
    dynamic:
      dynt && typeof dynt.base === 'number'
        ? { base: Math.min(1, dynt.base * moraleRate(morale)), increment: Number(dynt.increment ?? 0) }
        : undefined,
    segments,
    dots,
    effects,
    unmodeled: [...extraKeys(raw, SKILL_KEYS), ...unsupportedOutputs],
  };
}

// ─────────────────────────── 回合期望 ───────────────────────────

export interface RoundUnit {
  id: string;
  name: string;
  heroId: string;
  attack: number;
  strategy: number;
  troops: number;
  troopType: TroopType;
  /** 防御 / 速度（属性缩放用；缺省按 80 基准） */
  defense?: number;
  speed?: number;
  skills: ParsedSkill[];
}

export interface RoundModelInput {
  units: RoundUnit[];
  enemy: { defense: number; strategy: number; troopType: TroopType; /** 敌方士气（morale_branch 判定；缺省 = 我方士气） */ morale?: number };
  morale: number;
  rounds: number;
  manual?: { boostCaused?: number; boostTaken?: number; reduce?: number };
}

export interface RoundRow {
  round: number;
  total: number;
  cumulative: number;
  byUnit: number[];
  bySource: Record<string, number>;
}

export interface EffectLogRow {
  source: string;
  kind: EffectKind;
  value: number;
  from: number;
  to: number;
  side: 'self' | 'enemy';
}

export interface WarningRow {
  skill: string;
  detail: string;
}

export interface RoundModelResult {
  rows: RoundRow[];
  total: number;
  first3: number;
  first3ByUnit: number[];
  first3BySource: Record<string, number>;
  effectLog: EffectLogRow[];
  warnings: WarningRow[];
}

export const SOURCE_ORDER = ['普攻', '追击', '主动', '准备', '一类指挥', '二类指挥', '被动', '持续伤害'] as const;
type SourceName = (typeof SOURCE_ORDER)[number];

const SLOT_SOURCE: Record<SkillSlot, SourceName> = {
  basic: '普攻',
  pursuit: '追击',
  active: '主动',
  prepared: '准备',
  'command-prep': '一类指挥',
  'command-round': '二类指挥',
  passive: '被动',
};

/** 准备主动战法：第 t 回合释放的期望次数 = p(1−p)^(t−1−k)，k = prepareTurns */
export function preparedCastProb(rate: number, prepareTurns: number, round: number): number {
  const k = Math.max(1, prepareTurns);
  if (round < k + 1) return 0;
  return rate * Math.pow(1 - rate, round - k - 1);
}

/** 二类指挥动态发动率的期望递推：r₁ = base；未生效 +inc、生效重置 base */
export function dynamicRateSeries(base: number, increment: number, rounds: number): number[] {
  const out: number[] = [];
  let r = Math.max(0, Math.min(1, base));
  for (let t = 1; t <= rounds; t += 1) {
    out.push(r);
    r = Math.max(0, Math.min(1, r * r + (1 - r) * Math.min(1, r + increment)));
  }
  return out;
}

/**
 * 连锁段（乘胜追击）：期望额外次数 = Σ_k Π_{i≤k} pᵢ，其中 p₁ = chance、pᵢ₊₁ = max(0, pᵢ − decay)
 * （对应引擎 `chain`：成功后再打同一段并把概率减 decay，循环）。
 */
export function chainExtraRepeats(chance: number, decay: number): number {
  let extra = 0;
  let cumulative = 1;
  let p = Math.min(1, Math.max(0, chance));
  for (let i = 0; i < 20 && p > 0; i += 1) {
    cumulative *= p;
    extra += cumulative;
    p = Math.max(0, p - decay);
  }
  return extra;
}

/** 期望首次生效回合（带时长的修正用）：被动/指挥 = 第 1 回合；主动/追击按几何期望 ⌈1/p⌉ */
export function expectedFirstRound(skill: ParsedSkill, rounds: number): number {
  if (skill.slot === 'passive' || skill.slot === 'command-prep' || skill.slot === 'command-round') return 1;
  const p = Math.max(skill.rate, 0.01);
  return Math.min(rounds, Math.max(1, Math.ceil(1 / p)));
}

/**
 * 叠层类状态（`stack: true`）在第 round 回合的期望层数：
 *  · 每回合重挂的（被动 / 指挥 / roundStartRepeat）→ 每回合 +1 层
 *  · 每次发动才挂的（主动 / 追击）→ 按期望发动次数累加（p × 经过回合）
 * maxStacks ≤ 0 视为无上限；否则封顶。
 */
export function stackLayers(skill: ParsedSkill, first: number, round: number, maxStacks: number): number {
  const passed = Math.max(0, round - first);
  const perRound =
    skill.slot === 'passive' || skill.slot === 'command-prep' || skill.slot === 'command-round' ? 1 : skill.rate;
  const layers = 1 + passed * perRound;
  return maxStacks > 0 ? Math.min(maxStacks, layers) : layers;
}

/** 同类型修正聚合（引擎冲突口径）：
 *  · 不同战法（不同来源）→ 冲突，取绝对值较高者；
 *  · 同源显式叠层（stack）→ 累加（本模型按「实际叠到 1 层」计入，见 unmodeled 提示）。
 */
export function aggregateEffects(
  rows: Array<{ value: number; source: string; stack: boolean; maxStacks: number }>
): number {
  const perSource = new Map<string, number>();
  for (const r of rows) {
    const prev = perSource.get(r.source);
    if (prev === undefined) perSource.set(r.source, r.value);
    else perSource.set(r.source, r.stack ? prev + r.value : Math.abs(r.value) > Math.abs(prev) ? r.value : prev);
  }
  let best = 0;
  for (const v of perSource.values()) if (Math.abs(v) > Math.abs(best)) best = v;
  return best;
}

export interface FilteredRow {
  value: number;
  source: string;
  stack: boolean;
  maxStacks: number;
  kind: 'boostCaused' | 'boostTaken' | 'reduce';
  filters: NonNullable<ParsedEffect['filters']>;
  unitIdx: number;
}

interface AggregatedMods {
  boostCaused: number;
  boostTaken: number;
  reduce: number;
  unitAttack: number[];
  unitStrategy: number[];
  enemyDefense: number;
  enemyStrategy: number;
  /** 连击来源概率（状态类：取「至少一个生效」，非叠加） */
  comboSources: number[];
  triggerBoost: number;
  /** 无视目标防御（0~1，取最高） */
  ignoreDef: number;
  /** 分兵来源（状态类：同队同时只有一个生效，先施加者优先） */
  splitSources: Array<{ p: number; rate: number; from: number; order: number }>;
  /** 带作用范围过滤的增减伤（逐命中判匹配） */
  filtered: FilteredRow[];
}

/** 逐回合期望伤害 */
export function simulateRounds(input: RoundModelInput): RoundModelResult {
  const { units, enemy, rounds } = input;
  const manual = input.manual ?? {};
  const warnings: WarningRow[] = [];
  const effectLog: EffectLogRow[] = [];

  units.forEach((u) => {
    u.skills.forEach((s) => {
      const label = `${u.name}·${s.name}`;
      s.unmodeled.forEach((k) => warnings.push({ skill: label, detail: k }));
      s.dots.forEach((d) =>
        d.unmodeled.forEach((k) => warnings.push({ skill: label, detail: `${d.label} 状态字段未建模：${k}` }))
      );
      s.effects.forEach((e) => e.unmodeled.forEach((k) => warnings.push({ skill: label, detail: `状态字段未建模：${k}` })));
      s.effects.forEach((e) =>
        (e.approx ?? []).forEach((k) => warnings.push({ skill: label, detail: `≈ 近似：${k}` }))
      );
      const first = expectedFirstRound(s, rounds);
      s.effects
        .map((e) => ({ e, v: effectValue(e, u) }))
        .filter(({ e, v }) => v !== 0 || e.scaledBase !== undefined)
        .forEach(({ e, v }) =>
          effectLog.push({
            source: label,
            kind: e.kind,
            value: v,
            from: e.window?.start ?? first,
            to: e.window ? Math.min(rounds, e.window.end) : Math.min(rounds, first + Math.max(1, e.duration) - 1),
            side: e.side,
          })
        );
    });
  });

  /** 第 round 回合生效的修正快照 */
  const modsFor = (round: number): AggregatedMods => {
    type Row = { value: number; source: string; stack: boolean; maxStacks: number; probability?: number; from?: number };
    const buckets = {
      boostCaused: [] as Row[],
      boostTaken: [] as Row[],
      reduce: [] as Row[],
      combo: [] as Row[],
      triggerBoost: [] as Row[],
      ignoreDefRows: [] as Row[],
      splitRows: [] as Row[],
      attackSelf: [] as Row[],
      strategySelf: [] as Row[],
      strategyEnemy: [] as Row[],
      defenseEnemy: [] as Row[],
    };
    const filtered: FilteredRow[] = [];
    /** 本回合生效、由施法者属性缩放/带过滤的修正（逐命中判匹配） */
    type LiveEffect = { e: ParsedEffect; value: number; source: string; unitIdx: number };

    units.forEach((u, ui) => {
      u.skills.forEach((s) => {
        const first = expectedFirstRound(s, rounds);
        s.effects.forEach((e) => {
          const from = e.window?.start ?? first;
          const to = e.window ? Math.min(rounds, e.window.end) : Math.min(rounds, first + Math.max(1, e.duration) - 1);
          if (e.window ? !inWindow(e.window, round) : round < from || round > to) return;
          const base = effectValue(e, u);
          // 叠层类：按期望层数放大（每回合重挂的 +1 层/回合；主动/追击按期望发动次数）
          // 衰减类：第 round 回合系数 = max(0, parts − (round − 首回合)) / parts
          const decayFactor = e.decay ? Math.max(0, e.decay.parts - Math.max(0, round - from)) / e.decay.parts : 1;
          const value = (e.stack ? base * stackLayers(s, from, round, e.maxStacks) : base) * decayFactor;
          if (value === 0 && e.scaledBase === undefined) return;
          const row: Row = {
            value,
            source: `${u.name}·${s.name}`,
            stack: e.stack,
            maxStacks: e.maxStacks,
            probability: e.probability,
            from,
          };
          if (e.filters && (e.kind === 'boostCaused' || e.kind === 'boostTaken' || e.kind === 'reduce')) {
            filtered.push({ ...row, kind: e.kind, filters: e.filters, unitIdx: ui });
            return;
          }
          if (e.kind === 'attack') buckets.attackSelf.push(row);
          else if (e.kind === 'strategy') (e.side === 'self' ? buckets.strategySelf : buckets.strategyEnemy).push(row);
          else if (e.kind === 'defense') buckets.defenseEnemy.push(row);
          else if (e.kind === 'boostCaused') buckets.boostCaused.push(row);
          else if (e.kind === 'boostTaken') buckets.boostTaken.push(row);
          else if (e.kind === 'reduce') buckets.reduce.push(row);
          else if (e.kind === 'combo') buckets.combo.push(row);
          else if (e.kind === 'triggerBoost') buckets.triggerBoost.push(row);
          else if (e.kind === 'ignoreDef') buckets.ignoreDefRows.push(row);
          else if (e.kind === 'split') buckets.splitRows.push(row);
        });
      });
    });

    // 属性：正增益取最高、负增益取最低，异号共存后求和（引擎：属性类正负分桶不冲突）
    const split = (rows: Array<{ value: number }>): number => {
      const pos = rows.filter((r) => r.value > 0).map((r) => r.value);
      const neg = rows.filter((r) => r.value < 0).map((r) => r.value);
      return (pos.length ? Math.max(...pos) : 0) + (neg.length ? Math.min(...neg) : 0);
    };

    const attackValue = split(buckets.attackSelf);
    const strategyValue = split(buckets.strategySelf);
    return {
      boostCaused: (manual.boostCaused ?? 0) + aggregateEffects(buckets.boostCaused),
      boostTaken: (manual.boostTaken ?? 0) + aggregateEffects(buckets.boostTaken),
      reduce: (manual.reduce ?? 0) + aggregateEffects(buckets.reduce),
      unitAttack: units.map(() => attackValue),
      unitStrategy: units.map(() => strategyValue),
      enemyDefense: split(buckets.defenseEnemy),
      enemyStrategy: split(buckets.strategyEnemy),
      comboSources: buckets.combo.map((r) => Math.min(1, r.probability ?? r.value)),
      splitSources: buckets.splitRows.map((r, i) => ({ p: Math.min(1, r.probability ?? 1), rate: r.value, from: r.from ?? 1, order: i })),
      triggerBoost: buckets.triggerBoost.reduce((a, r) => Math.max(a, r.value), 0),
      ignoreDef: Math.min(1, buckets.ignoreDefRows.reduce((a, r) => Math.max(a, r.value), 0)),

      filtered,
    };
  };

  /** 带过滤的增减伤：只累加「与本次命中匹配」的行（近似：不与无过滤项做冲突取较高） */
  const filteredValue = (
    rows: FilteredRow[],
    kind: FilteredRow['kind'],
    ctx: { damageType?: 'physical' | 'strategy'; skillType?: SkillType; isBasic?: boolean }
  ): number => {
    const hit = rows.filter((r) => {
      if (r.kind !== kind) return false;
      const f = r.filters;
      if (f.damageType && ctx.damageType && f.damageType !== ctx.damageType) return false;
      if (f.skillTypes && ctx.skillType && !f.skillTypes.includes(ctx.skillType)) return false;
      if (f.source === 'basic' && !ctx.isBasic) return false;
      if (f.source === 'skill' && ctx.isBasic) return false;
      return true;
    });
    return aggregateEffects(hit);
  };

  const rows: RoundRow[] = [];
  let cumulative = 0;
  const first3ByUnit = units.map(() => 0);
  const first3BySource: Record<string, number> = {};

  // 每个战法的期望发动次数累计（供发动率递减 / 伤害率递增递推）
  const castState = new Map<string, { casts: number; rate: number }>();
  units.forEach((u) =>
    u.skills.forEach((s) => castState.set(s.id, { casts: 0, rate: s.dynamic ? s.dynamic.base : s.rate }))
  );

  for (let t = 1; t <= rounds; t += 1) {
    const mods = modsFor(t);
    const byUnit = units.map(() => 0);
    const bySource: Record<string, number> = {};

    units.forEach((u, ui) => {
      const attackEff = u.attack + mods.unitAttack[ui];
      const strategyEff = u.strategy + mods.unitStrategy[ui];
      const enemyDefense = Math.max(0, enemy.defense + mods.enemyDefense);
      const enemyStrategy = Math.max(0, enemy.strategy + mods.enemyStrategy);
      const add = (src: SourceName, v: number): void => {
        if (v === 0 || !Number.isFinite(v)) return;
        bySource[src] = (bySource[src] ?? 0) + v;
        byUnit[ui] += v;
      };

      const hitOf = (
        kind: 'physical' | 'strategy',
        rate: number,
        opts: {
          scaled?: boolean;
          growth?: number;
          targets?: number;
          dot?: boolean;
          ignoreDefense?: boolean;
          ignoreCounter?: boolean;
          /** 本次命中的来源上下文（用于过滤类增减伤：战法类型 / 普攻 or 战法） */
          skillType?: SkillType;
          isBasic?: boolean;
        } = {}
      ): number => {
        const ctx = { damageType: kind, skillType: opts.skillType, isBasic: opts.isBasic };
        // 无视防御：目标防御 × (1 − rate)（引擎 applyIgnoreDef 口径；段级 ignoresDefense = 100%）
        const ignoreRate = Math.min(1, mods.ignoreDef + (opts.ignoreDefense ? 1 : 0));
        const mp: ModelParams = {
          damageType: kind,
          troops: u.troops,
          attack: attackEff,
          defense: enemyDefense * (1 - ignoreRate),
          strategy: strategyEff,
          targetStrategy: enemyStrategy,
          rate,
          strategyScaled: Boolean(opts.scaled),
          growth: opts.growth ?? 0,
          boostCaused: mods.boostCaused + filteredValue(mods.filtered, 'boostCaused', ctx),
          boostTaken: mods.boostTaken + filteredValue(mods.filtered, 'boostTaken', ctx),
          reduce: mods.reduce + filteredValue(mods.filtered, 'reduce', ctx),
          dot: Boolean(opts.dot),
          targets: Math.max(1, opts.targets ?? 1),
          attackerTroop: opts.ignoreCounter ? enemy.troopType : u.troopType,
          targetTroop: enemy.troopType,
        };
        return statsOf(mp).expected;
      };

      // ① 普攻（连击 → 至多 2 次）：连击是状态类 → P(有连击) = 1 − Π(1−pᵢ)
      const pCombo = mods.comboSources.length ? 1 - mods.comboSources.reduce((acc, p) => acc * (1 - p), 1) : 0;
      const attacks = 1 + pCombo;
      let basic = attacks * hitOf('physical', 100, { isBasic: true });
      // 分兵：状态类，同队同时只有一个生效（先施加者优先）→ 按「首次成功者」求期望率
      if (mods.splitSources.length) {
        const sorted = [...mods.splitSources].sort((a, b) => a.from - b.from || a.order - b.order);
        let pActive = 0;
        let expectedRate = 0;
        let remaining = 1;
        for (const src of sorted) {
          pActive += remaining * src.p;
          expectedRate += remaining * src.p * src.rate;
          remaining *= 1 - src.p;
          if (remaining <= 0) break;
        }
        // hit(rate) = T + rate/100 × L（线性）→ 期望 = pActive×T + E[rate]/100×L
        const T = hitOf('physical', 0, { isBasic: true });
        const L = hitOf('physical', 100, { isBasic: true }) - T;
        basic += attacks * (pActive * T + (expectedRate / 100) * L);
      }
      add('普攻', basic);

      u.skills.forEach((s) => {
        const state = castState.get(s.id) ?? { casts: 0, rate: s.rate };
        const p = s.dynamic
          ? Math.max(0, Math.min(1, state.rate + mods.triggerBoost))
          : Math.max(0, Math.min(1, s.rate - s.decayPerCast * state.casts + mods.triggerBoost));
        const castsBefore = state.casts;

        const prepProb = preparedCastProb(p, s.prepareTurns, t);
        /** 本战法在该回合的「出手次数因子」（与段无关的部分） */
        const freqOf = (): number => {
          switch (s.slot) {
            case 'pursuit':
              return attacks * p;
            case 'active':
              return p;
            case 'prepared':
              return prepProb;
            case 'command-round':
              return p;
            case 'command-prep':
              return t === 1 ? 1 : 0; // roundRepeat 段由窗口另行判定
            case 'passive':
              return s.timing === 'battle_start' ? (t === 1 ? 1 : 0) : 1;
            default:
              return 0;
          }
        };

        const damage = s.segments.reduce((acc, seg) => {
          const inSegWindow = seg.window ? inWindow(seg.window, t) : t >= seg.startRound && t <= seg.endRound;
          if (!inSegWindow) return acc;
          // roundRepeat 段：窗口内每回合结算（几率已折算进 chance）
          const freq = seg.window ? 1 : freqOf();
          if (freq === 0) return acc;
          const rate = seg.rate + seg.ratePerCast * castsBefore;
          const perHit = hitOf(seg.kind, rate, {
            scaled: seg.scaled,
            growth: seg.growth,
            targets: seg.targets,
            ignoreDefense: seg.ignoreDefense,
            ignoreCounter: seg.ignoreTroopCounter,
            skillType: s.slot === 'pursuit' ? 'pursuit' : s.slot === 'passive' ? 'passive' : 'active',
          });
          return acc + perHit * seg.repeats * seg.chance * freq;
        }, 0);

        switch (s.slot) {
          case 'pursuit':
            add('追击', damage);
            state.casts += attacks * p;
            break;
          case 'active':
            add('主动', damage);
            state.casts += p;
            break;
          case 'prepared':
            add('准备', damage);
            state.casts += prepProb;
            break;
          case 'command-prep':
            add('一类指挥', damage);
            break;
          case 'command-round':
            add('二类指挥', damage);
            state.casts += p;
            break;
          case 'passive':
            add('被动', damage);
            break;
          default:
            break;
        }
        if (s.dynamic) {
          state.rate = Math.max(0, Math.min(1, p * p + (1 - p) * Math.min(1, p + s.dynamic.increment)));
        }

        // ② 持续伤害：期望首次发动回合之后，每回合跳一次
        s.dots.forEach((d) => {
          const first = expectedFirstRound(s, rounds);
          const ticks = d.ticks >= 999 ? rounds - first : d.ticks;
          if (t <= first || t > first + ticks) return;
          const perTick = hitOf('strategy', d.rate, { scaled: true, growth: d.growth, targets: d.targets, dot: true });
          add('持续伤害', perTick * d.chance);
        });
      });
    });

    const total = byUnit.reduce((a, b) => a + b, 0);
    cumulative += total;
    rows.push({ round: t, total, cumulative, byUnit, bySource });
    if (t <= 3) {
      byUnit.forEach((v, i) => (first3ByUnit[i] += v));
      Object.entries(bySource).forEach(([k, v]) => (first3BySource[k] = (first3BySource[k] ?? 0) + v));
    }
  }

  return {
    rows,
    total: cumulative,
    first3: rows.slice(0, 3).reduce((a, r) => a + r.total, 0),
    first3ByUnit,
    first3BySource,
    effectLog,
    warnings,
  };
}

/** 前 N 回合（口径窗口）的累计伤害与拆分——「前三回合」与「整局 8 回合」共用同一套口径函数 */
export function windowTotals(
  result: RoundModelResult,
  rounds: number
): { total: number; byUnit: number[]; bySource: Record<string, number> } {
  const rows = result.rows.slice(0, Math.max(0, Math.min(rounds, result.rows.length)));
  const byUnit = result.rows.length ? rows[0].byUnit.map(() => 0) : [];
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    total += r.total;
    r.byUnit.forEach((v, i) => (byUnit[i] += v));
    Object.entries(r.bySource).forEach(([k, v]) => (bySource[k] = (bySource[k] ?? 0) + v));
  }
  return { total, byUnit, bySource };
}

/** 便捷入口：战法 id → 解析结果 */
export function skillById(id: string, morale = 100, ctx: ParseContext = {}): ParsedSkill | undefined {
  const s = SKILL_REGISTRY[id];
  return s ? parseSkill(s, morale, ctx) : undefined;
}
