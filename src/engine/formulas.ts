/**
 * 伤害公式（v0.2 严格拟合，v0.14 按权威调研复核修正）
 * 依据《战斗伤害公式调研.md》（十面埋伏 2022 系列原文 OCR 复核）三部分相加模型：
 *   兵刃伤害 = 兵力基础 + 攻击基础 + 主要伤害
 *   谋略伤害 = 兵力基础 + 谋略基础 + 主要伤害
 * 精确锚点全部按文档：兵力 10000 锚点、攻击基础随机 0.30~0.39、攻防差高收益区 [-70,130]、
 * 谋略减伤阶梯、有效伤害率 八舍九入、增减伤单一总和下限 -90% 保留 10%。
 * v0.14 修正：删除「物理宏观 ±5% 波动」（权威文章只承认攻击基础随机 0.3~0.39，模拟器无 ±5%）；
 * 增减伤因子改为单一总和模型 max(10%, 1+Σ增伤−Σ减伤)（物理/谋略统一，策略特殊减伤规则为官方历史缺陷，不建模）。
 * 兵种克制 -30% 并入该加算（不独立乘区），与其他增减伤一同受 10% 下限保护。
 */
import type { DamageBreakdown, DamageType, TroopType } from './types';
import type { Rng } from './rng';

// ─── 兵种相克（用户规则：骑克步、步克弓、弓克骑；被克制方攻击克制方时伤害 -30%，单向惩罚）───

/** 兵种克制链：克制对象（cavalry 克 infantry、infantry 克 archer、archer 克 cavalry） */
const COUNTERS: Record<TroopType, TroopType> = {
  cavalry: 'infantry',
  infantry: 'archer',
  archer: 'cavalry',
};

/**
 * 兵种相克因子：被克制方攻击克制方时造成的伤害降低 30%（单向——克制方攻击被克制方无影响）。
 *  - 步兵攻击骑兵、弓兵攻击步兵、骑兵攻击弓兵 → 0.7
 *  - 其余组合（含同兵种）→ 1
 *  实际结算不乘此因子，而是把 30% 并入增减伤加算（见 troopCounterReduce）。
 */
export function troopCounterFactor(attackerTroopType: TroopType, targetTroopType: TroopType): number {
  return COUNTERS[targetTroopType] === attackerTroopType ? 0.7 : 1;
}

/**
 * 兵种克制减伤率（加算进增减伤单一总和）：被克制方攻击克制方时 0.3，否则 0。
 */
export function troopCounterReduce(attackerTroopType: TroopType, targetTroopType: TroopType): number {
  return troopCounterFactor(attackerTroopType, targetTroopType) < 1 ? 0.3 : 0;
}

/**
 * 兵力基础伤害：仅与当前兵力有关，与伤害率无关
 * 物理：373×兵/(7700+兵)（参考模拟器拟合，10000兵≈211）
 * 策略：178×兵/(6459+兵)（参考模拟器拟合，10000兵≈108）
 */
export function troopBaseDamage(troops: number, damageType: DamageType): number {
  if (damageType === 'strategy') {
    return Math.round((178 * troops) / (6459 + troops));
  }
  return Math.round((373 * troops) / (7700 + troops));
}

/**
 * 单位伤害曲线（兵力 → 主要伤害的单位因子）
 * 参考模拟器（FlxSNX/stzbBattleSimulator，社区战报反推）：物理/策略共用
 *   unit = 300×兵/(3500+兵)，9000 兵 ≈216、10000 兵 ≈222
 * （引擎旧实现误用兵力基础伤害锚点，策略 108 / 物理 211，导致主要伤害偏低约 2 倍）
 */
export function unitDamage(troops: number, _damageType: DamageType): number {
  return (300 * troops) / (3500 + troops);
}

// ─── 属性影响曲线（调研 2.4 / 参考模拟器）───

/**
 * 兵刃攻防差属性曲线（攻防差 = 攻击 - 目标防御，参考模拟器拟合）：
 *   diff ≥ 0：3 - 500/(250+diff)（diff=0→1.0，diff=100→1.57，diff=250→2.0，趋近 3）
 *   diff < 0：100/(100-diff)（diff=-70→0.59，diff=-100→0.5，趋近 0）
 * 保留两位小数。
 */
export function attrFactor(diff: number): number {
  const v = diff >= 0 ? 3 - 500 / (250 + diff) : 100 / (100 - diff);
  return Math.round(v * 100) / 100;
}

/**
 * 目标谋略减伤（调研 3.4 / 参考模拟器）：与「双方谋略差」无关，只看目标谋略。
 *   inte ≤ 50：无减伤（=1）
 *   inte > 50：ceil(100 - (75 - 9375/(75+inte))) / 100
 *   目标谋略 52 起每档约 -1%，100 → 0.79、129 → 0.71、200 → 0.60（饱和递减，与文档「>129 后边际很小」一致）
 */
export function targetStratMitigation(targetStrategy: number): number {
  const inte = Math.floor(targetStrategy);
  if (inte <= 50) return 1;
  const pct = Math.ceil(100 - (75 - 9375 / (75 + inte)));
  return Math.max(0.1, pct / 100);
}

// ─── 随机系数（调研 2.3 / 4）───

const ATK_BASE_COEFFS = [0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39];

/** 攻击基础随机系数 ∈ {0.30 … 0.39}，可复现（调研 2.3：普通兵刃唯一的随机来源；无宏观 ±5% 波动） */
export function atkBaseRandomCoeff(rng: Rng): number {
  return ATK_BASE_COEFFS[rng.int(ATK_BASE_COEFFS.length)];
}

// ─── 增减伤因子（调研 2.4 / 3.4，单一总和模型）───

const MIN_DAMAGE_FACTOR = 0.1; // 增减伤总和 < -90% 时最低保留 10%

/**
 * 增减伤因子 = max(10%, 1 + Σ增伤 − Σ减伤)（单一总和模型，物理/谋略统一）。
 * 造成侧/受到侧增伤（causedMult/takenMult，各为 1+Σrate）与受击方减伤（reduce = Σdamage_reduce rate）
 * 全部数值相加：mult = 1 + Σ增伤 − Σ减伤。例：增 60% + 减 60% → 1.0（增伤与减伤相互抵消）。
 * 策略伤害的「造成侧增伤不被受到侧减伤抵消」特殊规则是官方承认的历史缺陷（2022-05-11 已部分修复，
 * 精确规则未公布），引擎不建模——见《战斗伤害公式调研.md》§3.4。
 */
export function buffMult(causedMult: number, takenMult: number, reduce: number): number {
  const total = causedMult + takenMult - 1 - reduce; // 1 + (caused-1) + (taken-1) − reduce
  return Math.max(total, MIN_DAMAGE_FACTOR);
}

/**
 * 读取某单位「造成伤害提高」与「受到伤害提高」的增减伤倍率（神兵天降/大赏三军等 damage_boost 状态）。
 * 同类效果数值相加（率土增减伤为加法），返回 1 + Σrate（无效果时为 1）。
 * 注意：按 v0.14 单一总和模型，两侧倍率不再相乘，而是连同减伤一起求和后 clamp（见 buffMult）。
 */
export function damageBoostMult(
  causedBoost: number,
  takenBoost: number
): { causedMult: number; takenMult: number } {
  return { causedMult: 1 + causedBoost, takenMult: 1 + takenBoost };
}

/**
 * 求和某类状态数值（damage_reduce / damage_boost 的 rate）。
 * direction 仅对 damage_boost 有意义：'caused' 只统计造成侧、'taken' 只统计受到侧；
 * 缺省统计全部（damage_reduce 等无方向状态）。
 */
export function sumRates(
  statuses: ReadonlyArray<{ type: string; rate?: number; direction?: 'caused' | 'taken' }>,
  type: string,
  direction?: 'caused' | 'taken'
): number {
  return statuses.reduce((acc, s) => {
    if (s.type !== type || !s.rate) return acc;
    if (direction && s.direction && s.direction !== direction) return acc;
    return acc + s.rate;
  }, 0);
}

// ─── 谋略战法有效伤害率（调研 3.4 / 谋略成长调研 1.2）───

/** 谋略成长：数值 = 基础值 + 成长率 × (谋略 - 80)，谋略<80 时线性回落 */
export function scaledValue(base: number, growthRate: number, strategy: number): number {
  if (strategy >= 80) return base + growthRate * (strategy - 80);
  return base * 0.4 + base * 0.6 * (strategy / 80);
}

/** 按 1% 粒度「八舍九入」取整：百分位 9 则进位，否则舍去 */
export function roundRate(value: number): number {
  const floor = Math.floor(value);
  const frac = value - floor;
  return frac >= 0.9 ? floor + 1 : floor;
}

/**
 * 士气对战法发动率的乘算系数：每点士气 +0.6%，提升百分比四舍五入取整。
 * 士气 100 → 系数 1（无变化）；120 → +12% → 1.12；80 → -12% → 0.88。
 * 作用于带发动率属性的所有战法：主动/追击 = 发动率，指挥（预备/二类动态）/被动 = 生效几率。
 */
export function moraleRate(morale: number): number {
  const boost = Math.round((morale - 100) * 0.6);
  return (100 + boost) / 100;
}

// ─── 三部分伤害计算 ───

export interface CalcInput {
  damageType: DamageType;
  /** 伤害率（已含有效伤害率换算），如 100 表示 100% */
  rate: number;
  attackerAttack: number;
  attackerStrategy: number;
  attackerTroops: number;
  targetDefense: number;
  targetStrategy: number;
  /** 增减伤因子（单一总和，含兵种克制减伤），占位恒 1.0 */
  mult: number;
  /** DoT（妖术/燃烧/恐慌）：兵力基础 ×1/3、谋略基础 ×0.25（调研 3.3 / 参考模拟器），主要伤害不变 */
  isDot?: boolean;
}

/**
 * 计算一次伤害，返回三部分拆解与总伤害。
 * 兵刃：三部分（随机仅存在于攻击基础系数 0.30~0.39，无宏观波动）；
 * 谋略：三部分，无随机。
 */
export function calcDamage(input: CalcInput, rng: Rng): { damage: number; breakdown: DamageBreakdown } {
  const isPhysical = input.damageType === 'physical';
  const isDot = input.isDot === true;
  const effMult = input.mult;

  const troopBase = troopBaseDamage(input.attackerTroops, input.damageType) * (isDot ? 1 / 3 : 1);

  let base: number;
  let main: number;
  if (isPhysical) {
    // 攻击基础：与兵力无关、无视目标防御，随伤害率线性放大
    base =
      input.attackerAttack *
      atkBaseRandomCoeff(rng) *
      (input.rate / 100) *
      effMult;
    // 主要伤害：单位伤害 × 伤害率 × 攻防差因子 × 增减伤
    main =
      unitDamage(input.attackerTroops, 'physical') *
      (input.rate / 100) *
      attrFactor(input.attackerAttack - input.targetDefense) *
      effMult;
  } else {
    // 谋略基础：与兵力/伤害率无关，受目标谋略减伤；DoT 系数 0.25（普通策略 0.5）
    base =
      input.attackerStrategy *
      (isDot ? 0.25 : 0.5) *
      targetStratMitigation(input.targetStrategy) *
      effMult;
    // 主要伤害：单位伤害 × 有效伤害率 × 目标谋略减伤 × 增减伤（DoT 与普通策略相同）
    main =
      unitDamage(input.attackerTroops, 'strategy') *
      (input.rate / 100) *
      targetStratMitigation(input.targetStrategy) *
      effMult;
  }

  // 三部分分别四舍五入后相加（无宏观波动：物理随机仅来自攻击基础系数）
  const breakdown: DamageBreakdown = {
    troopBase: Math.round(troopBase),
    base: Math.round(base),
    main: Math.round(main),
  };
  const damage = breakdown.troopBase + breakdown.base + breakdown.main;

  return { damage: Math.max(1, Math.round(damage)), breakdown };
}

/**
 * 恢复值（十面埋伏《率土秘卷一：恢复效果》公式，OCR 原文 + 实战战报验证）：
 *   恢复值 = floor( round(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100 × (1+恢复提高效果) )
 *  - 恢复率 = roundRate(基础恢复率 + 恢复率增长率×(谋略-80))（八舍九入，调用方传入已缩放取整值）
 *  - 单位伤害曲线与伤害公式共用（300×兵/(3500+兵)，先 round 再乘，同模拟器）
 *  - 状态类恢复（休整/持续急救）的施法者兵力取「状态被施加那一刻」（挂上时冻结）
 *  - 恢复提高效果极罕见（宝物博浪【抖擞】/锻造【仁心】），引擎未建模按 1
 *  - 实际恢复量还受伤兵池/兵力缺口截断（recoverTroops）
 */
export function calcHealAmount(troops: number, rate: number, healBoost = 0): number {
  return Math.floor(Math.round(unitDamage(troops, 'physical')) * (rate / 100) * (1 + healBoost));
}

/** 目标当前兵力截断（伤害先取整再截断，避免减伤比例产生浮点兵力） */
export function applyTroopCap(damage: number, targetTroops: number): number {
  return Math.min(Math.round(damage), targetTroops);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 无视防御作用于目标防御（击势）：结算攻防差前
 * `目标防御 = 目标防御 × (1 − 无视防御比例)`，比例钳制在 [0, 1]。
 */
export function applyIgnoreDef(targetDefense: number, ignoreRate: number): number {
  const rate = clamp(ignoreRate, 0, 1);
  return targetDefense * (1 - rate);
}
