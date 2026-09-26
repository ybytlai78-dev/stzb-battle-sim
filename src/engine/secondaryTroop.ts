/**
 * 二级兵种（高级兵种）系统 —— 数据与规则表
 *
 * 依据：`docs/兵种转换调研.md`（用户 2026-09-20 审定口径，全部按现版）。
 *  - 每个五星武将有两个二级兵种转换方向（数据源：官方武将表 hero_type_availible 解码，见调研文档 §三）；
 *  - 每个二级兵种 = 1 个**专属特性**（兵种自带、不可更换）+ 2 个**通用特性栏**（可自选）；
 *  - 通用特性**按兵系成池**（现版每系 5 个）：同兵系所有高级兵种共享同一池；
 *  - 官方 2025-06-25 移除的 6 个通用特性（固阵/近战/射马/伪装/乱阵/侧击）**不实现**。
 *
 * 本模块为纯数据 + 纯函数，无 RNG、无引擎状态依赖（可被任意客户端调用）。
 */
import type { Position, TroopType } from './types';

/** 二级兵种（13 个常规 + 5 个武将专属） */
export type SecondaryTroopType =
  // 弓兵系
  | '长弓兵'
  | '弩兵'
  | '死士'
  // 步兵系
  | '重步兵'
  | '长枪兵'
  | '禁卫'
  | '蛮兵'
  | '藤甲兵'
  // 骑兵系
  | '重骑兵'
  | '轻骑兵'
  | '铁骑兵'
  | '弓骑兵'
  | '象兵'
  // 武将专属（占位：转换关系入库，专属特性数值待补）
  | '解烦兵'
  | '白毦兵'
  | '西凉铁骑'
  | '白衣死士'
  | '木牛流马';

/** 兵系（通用特性池的归属维度） */
export type TroopFamily = '步兵系' | '弓兵系' | '骑兵系';

/**
 * 通用特性名（现版，每兵系 5 个）。
 *
 * 已移除（2025-06-25 官方公告，不再可用，故不在此列）：
 *   步兵 固阵 / 近战；骑兵 乱阵 / 侧击；弓兵 射马 / 伪装。
 */
export type GeneralTrait =
  // 步兵系
  | '守备'
  | '利刃'
  | '列阵'
  | '勇毅'
  | '文韬'
  // 弓兵系
  | '地利'
  | '齐射'
  | '直射'
  | '散射'
  | '迂回'
  // 骑兵系
  | '出奇'
  | '疾行'
  | '难测'
  | '扰后'
  | '挫锐';

/** 每个高级兵种的通用特性栏数量（4 星 / S1 赛季不可进阶 → 只有 1 栏；5 星进阶后 2 栏） */
export const TRAIT_SLOTS_MAX = 2;

/** 兵系 → 通用特性池（现版 5 个） */
export const FAMILY_TRAITS: Record<TroopFamily, GeneralTrait[]> = {
  步兵系: ['守备', '利刃', '列阵', '勇毅', '文韬'],
  弓兵系: ['地利', '齐射', '直射', '散射', '迂回'],
  骑兵系: ['出奇', '疾行', '难测', '扰后', '挫锐'],
};

/** 二级兵种静态定义 */
export interface SecondaryTroopDef {
  /** 官方武将表里的代码（`hero_type_availible` 的两位/三位代码） */
  code: string;
  family: TroopFamily;
  /** 专属特性（随兵种、不可更换）；空数组 = 占位待补（武将专属兵种） */
  exclusiveTrait: string[];
  /** 是否为武将专属（转换方向由个别武将独有） */
  exclusive: boolean;
  /**
   * **攻击距离**修正（死士 −1；其余 0）。
   * 官方：死士攻击距离固定 1 → 只影响普攻可达范围（target.ts `attackRangeOf`）。
   */
  rangeMod?: number;
  /**
   * **战法距离**修正（弓骑兵 +1；其余 0）。
   * 官方：弓骑兵「骑射」→ 战法距离 +1（target.ts `skillRangeOf`）。
   */
  skillRangeMod?: number;
  /** 永久四维加减（点数，直接并入 effectiveStat）：死士 攻/防/谋 +18、轻骑兵 速度 +15 */
  statMod?: Partial<Record<'attack' | 'defense' | 'strategy' | 'speed', number>>;
}

/** 二级兵种注册表（code 与中文名双向可查） */
export const SECONDARY_TROOPS: Record<SecondaryTroopType, SecondaryTroopDef> = {
  长弓兵: {
    code: '11',
    family: '弓兵系',
    exclusiveTrait: ['远离：前 4 回合造成所有伤害 +10%，第 1 回合进入洞察状态', '先发：作为防守方时前 2 回合优先行动'],
    exclusive: false,
    rangeMod: 1,
  },
  弩兵: {
    code: '21',
    family: '弓兵系',
    exclusiveTrait: ['弩弓：自身造成所有伤害 +8%'],
    exclusive: false,
  },
  死士: {
    code: '31',
    family: '弓兵系',
    exclusiveTrait: [
      '无畏 / 短兵：自身**攻击距离固定为 1**（−1），攻击、防御、谋略属性各 **+18**',
      '钢毅：怯战、犹豫状态下自身受到所有伤害 −20%',
    ],
    exclusive: false,
    rangeMod: -1,
    statMod: { attack: 18, defense: 18, strategy: 18 },
  },
  重步兵: {
    code: '12',
    family: '步兵系',
    exclusiveTrait: ['披甲：自身受到所有伤害 −8%', '以静制动：作为防守方时自身受到主动战法伤害 −12%'],
    exclusive: false,
  },
  长枪兵: {
    code: '22',
    family: '步兵系',
    exclusiveTrait: ['长武器：自身造成所有伤害 +8%', '阵型防守：受到骑兵伤害 −30%、对骑兵伤害 +30%', '弃盾：受到弓兵伤害 +30%、对弓兵伤害 −30%'],
    exclusive: false,
  },
  禁卫: {
    code: '32',
    family: '步兵系',
    exclusiveTrait: ['护主：受到追击战法伤害 −20%（现版，不再分站位）', '铁意：混乱、暴走状态下自身受到所有伤害 −30%'],
    exclusive: false,
  },
  蛮兵: {
    code: '52',
    family: '步兵系',
    exclusiveTrait: ['自身造成所有伤害 +18%（用户 2026-09-20：地形不建模，默认吃得到效果）'],
    exclusive: false,
  },
  藤甲兵: {
    code: '42',
    family: '步兵系',
    exclusiveTrait: ['除燃烧/火攻外，自身受到所有伤害 −30%', '被燃烧/火攻克制：受到火攻时陷入暴走'],
    exclusive: false,
  },
  重骑兵: {
    code: '13',
    family: '骑兵系',
    exclusiveTrait: [
      '披甲：自身受到所有伤害 −10%',
      '重骑冲阵：前 2 回合受到普通攻击时反击（伤害率 75%）——反击是**状态类**效果，与其它同类型反击冲突（先施加者生效，同分兵）',
    ],
    exclusive: false,
  },
  轻骑兵: {
    code: '23',
    family: '骑兵系',
    exclusiveTrait: [
      '速度属性提高 15 点（用户 2026-09-20 口径）',
      '轻骑冲阵：战斗开始后前 4 次攻击造成的伤害 +18%',
    ],
    exclusive: false,
    statMod: { speed: 15 },
  },
  铁骑兵: {
    code: '43',
    family: '骑兵系',
    exclusiveTrait: ['四类状态（混乱/暴走/怯战/犹豫）各自使自身受到所有伤害 −25%，不可叠加'],
    exclusive: false,
  },
  弓骑兵: {
    code: '33',
    family: '骑兵系',
    exclusiveTrait: ['行踪难测：受到追击战法伤害 −90%', '骑射：可学弓兵与骑兵战法，**战法距离 +1**'],
    exclusive: false,
    skillRangeMod: 1,
  },
  象兵: {
    code: '53',
    family: '骑兵系',
    exclusiveTrait: [
      '野性：不受任何指挥战法产生的效果影响（敌我双方、正面负面一视同仁）',
      '自身受到的所有伤害 −10%',
    ],
    exclusive: false,
  },
  // —— 武将专属（占位：专属特性数值待补，训练/转换关系已入库）——
  解烦兵: { code: '101', family: '弓兵系', exclusiveTrait: [], exclusive: true },
  白毦兵: { code: '102', family: '步兵系', exclusiveTrait: [], exclusive: true },
  西凉铁骑: { code: '153', family: '骑兵系', exclusiveTrait: [], exclusive: true },
  白衣死士: { code: '172', family: '骑兵系', exclusiveTrait: [], exclusive: true },
  木牛流马: { code: '173', family: '骑兵系', exclusiveTrait: [], exclusive: true },
};

/** 全部二级兵种名 */
export const ALL_SECONDARY_TROOPS = Object.keys(SECONDARY_TROOPS) as SecondaryTroopType[];

/** 代码 → 兵种名（`hero_type_availible` 解码用） */
export const CODE_TO_TROOP: Record<string, SecondaryTroopType> = Object.fromEntries(
  ALL_SECONDARY_TROOPS.map((t) => [SECONDARY_TROOPS[t].code, t])
) as Record<string, SecondaryTroopType>;

/** 兵种 → 通用特性池（同兵系共享） */
export function traitsFor(troop: SecondaryTroopType): GeneralTrait[] {
  return FAMILY_TRAITS[SECONDARY_TROOPS[troop].family];
}

/** 兵种是否属于某兵系 */
export function familyOf(troop: SecondaryTroopType): TroopFamily {
  return SECONDARY_TROOPS[troop].family;
}

/** 兵系 → 基础兵种类别（用于「骑兵 / 步兵 / 弓兵」类判定） */
const TROOP_OF_FAMILY: Record<TroopFamily, TroopType> = {
  骑兵系: 'cavalry',
  步兵系: 'infantry',
  弓兵系: 'archer',
};

/**
 * **有效兵系**（`TroopType` 视角）：二级兵种转换后按**该二级兵种的兵系**判定，未转换时取原兵种。
 *
 * 依据 `docs/兵种转换调研.md`：两个转换方向**可以跨兵系**（祝融夫人 群·骑 → 蛮兵，蛮兵属**步兵系**；
 * 郭嘉 骑 → 死士属弓兵系；太史慈 弓 → 弓骑兵属骑兵系），且「蛮兵/藤甲兵仍为步系、象兵为骑系」。
 * 战法文本里的「骑兵 / 步兵 / 弓兵」= 兵**系**，故转换后按新兵系判定
 * （用户 2026-09-22：衡轭的「步兵普攻增伤」必须给蛮兵祝融）。
 */
export function effectiveTroopLine(g: { troopType: TroopType; secondaryTroop?: SecondaryTroopType }): TroopType {
  return g.secondaryTroop ? TROOP_OF_FAMILY[SECONDARY_TROOPS[g.secondaryTroop].family] : g.troopType;
}

/** 攻击距离修正（长弓兵 +1 / 死士 −1 / 其余 0） */
export function rangeModOf(troop: SecondaryTroopType | undefined): number {
  return troop ? SECONDARY_TROOPS[troop].rangeMod ?? 0 : 0;
}

/** 战法距离修正（弓骑兵 +1 / 其余 0） */
export function skillRangeModOf(troop: SecondaryTroopType | undefined): number {
  return troop ? SECONDARY_TROOPS[troop].skillRangeMod ?? 0 : 0;
}

/** 二级兵种永久属性加减（点数）：死士 攻/防/谋 +18、轻骑兵 速度 +15 */
export function statModOf(
  troop: SecondaryTroopType | undefined,
  kind: 'attack' | 'defense' | 'strategy' | 'speed'
): number {
  return troop ? SECONDARY_TROOPS[troop].statMod?.[kind] ?? 0 : 0;
}

/**
 * 高级兵种改写后的「被克制减伤」：
 * 规则（调研 §四.6）：
 *  - **长枪兵**（仅长枪兵自身参战时）：
 *      · 长枪兵打骑兵 → 目标受击 **+30%**（返回 −0.3）
 *      · 长枪兵打弓兵 → 自身伤害 **−30%**（返回 0.3，被弓克制）
 *      · 骑兵打长枪兵 → 骑兵伤害 **−30%**（返回 0.3，枪克骑）
 *      · 弓兵打长枪兵 → 弓兵伤害 **+30%**（返回 −0.3）
 *    —— 注意「对骑兵伤害 +30%」是**长枪兵自己的攻击加成**，不会让别的兵种打骑兵也增伤。
 *  - 其余高级兵种按**基础兵系**相克：骑克步、步克弓、弓克骑；被克制方攻击克制方 → 伤害 −30%
 *    （用户口径：统一 −30%，不采用官方三档）。
 *
 * 返回值语义与 `troopCounterReduce` 一致：**加算进增减伤单一总和**的正数（减伤）；
 * 负数 = 该次伤害提高（如长枪兵打骑/弓打枪）。
 */
export function troopCounterReduceOf(params: {
  attackerTroop: TroopType;
  attackerSecondary?: SecondaryTroopType;
  targetTroop: TroopType;
  targetSecondary?: SecondaryTroopType;
}): number {
  const { attackerTroop, attackerSecondary, targetTroop, targetSecondary } = params;

  // —— 长枪兵自身作为攻击方：对骑 +30%、被弓克 −30% ——
  if (attackerSecondary === '长枪兵') {
    if (targetTroop === 'cavalry') return -0.3; // 枪打骑：目标受击 +30%
    if (targetTroop === 'archer') return 0.3; // 枪打弓：自身被克 −30%
    return 0;
  }
  // —— 长枪兵作为受击方：骑打枪 −30%、弓打枪 +30% ——
  if (targetSecondary === '长枪兵') {
    if (attackerTroop === 'cavalry') return 0.3; // 骑打枪：骑被克 −30%
    if (attackerTroop === 'archer') return -0.3; // 弓打枪：弓获增伤 +30%
    return 0;
  }

  return COUNTER_OF[targetTroop] === attackerTroop ? 0.3 : 0;
}

/** 基础相克链：克制对象（骑克步、步克弓、弓克骑） */
const COUNTER_OF: Record<TroopType, TroopType> = {
  cavalry: 'infantry',
  infantry: 'archer',
  archer: 'cavalry',
};

/** 位置权重（与 troopBonus 的排序口径一致：大营 0 / 中军 1 / 前锋 2） */
export const POSITION_ORDER: Record<Position, number> = { 大营: 0, 中军: 1, 前锋: 2 };

/**
 * 通用特性「利刃」的攻击加成：每学习 1 个非主动战法 +22 攻击（含自带主战法），上限 3 个 = +66。
 * @param nonActiveSkillCount 非主动战法数量（含主战法）
 */
export function liRenAttackBonus(nonActiveSkillCount: number): number {
  return Math.min(3, Math.max(0, nonActiveSkillCount)) * 22;
}

/**
 * 通用特性「地利」的四维加成（现版，2025-06-12 下调后）。
 * 官方原文：位于前锋时防御 +24；位于中军时防御、谋略 +10；位于大营时攻击、谋略、防御 +6。
 */
export function diLiBonus(pos: Position): Partial<Record<'attack' | 'defense' | 'strategy', number>> {
  if (pos === '前锋') return { defense: 24 };
  if (pos === '中军') return { defense: 10, strategy: 10 };
  return { attack: 6, defense: 6, strategy: 6 };
}

/** 通用特性附加属性（点数）：利刃（攻击）+ 地利（按站位）。其余特性是伤害/减伤型不在此。 */
export function traitStatBonus(
  general: { secondaryTraits?: GeneralTrait[]; position: Position; activeSkillIds: string[]; passiveSkillIds: string[]; commandSkillIds: string[]; pursuitSkillIds: string[]; mainSkillId?: string },
  kind: 'attack' | 'defense' | 'strategy' | 'speed'
): number {
  const traits = general.secondaryTraits;
  if (!traits || traits.length === 0) return 0;
  let bonus = 0;
  if (traits.includes('利刃') && kind === 'attack') {
    // 非主动战法数（含自带主战法）：主动 = activeSkillIds（主战法若为主动需排除，此处按「自带战法」口径）
    const nonActive = general.activeSkillIds.length + general.passiveSkillIds.length + general.commandSkillIds.length + general.pursuitSkillIds.length;
    bonus += liRenAttackBonus(nonActive);
  }
  const diLi = traits.includes('地利') ? diLiBonus(general.position) : {};
  if (kind !== 'speed') bonus += diLi[kind] ?? 0;
  return bonus;
}

/**
 * 战斗期特性上下文（由 action.ts 的伤害管线构造）。
 * `hit` 语义与 DamageHitContext 一致但更窄，避免类型环依赖。
 */
export interface TraitCombatContext {
  /** 施法者（伤害来源）已学通用特性 */
  attackerTraits?: GeneralTrait[];
  /** 施法者二级兵种（专属特性判定） */
  attackerTroop?: SecondaryTroopType;
  /** 受击者已学通用特性 */
  targetTraits?: GeneralTrait[];
  /** 受击者二级兵种 */
  targetTroop?: SecondaryTroopType;
  /** 受击者当前是否处于该状态（混乱/暴走/怯战/犹豫） */
  targetHasStatus: (type: 'confusion' | 'rampage' | 'cowardice' | 'hesitation') => boolean;
  /** 受击者的当前兵力（扰后/挫锐取「兵力最高」用） */
  targetTroops: number;
  /** 当前回合（1 起） */
  round: number;
  /** 受击者站位（扰后） */
  targetPosition: Position;
  /** 施法者到受击者的距离（直射） */
  distance: number;
  /** 防守方视角（守备/以静制动）：施法者处于防守方为 true */
  attackerIsDefender?: boolean;
  /** 受击者处于防守方（守备） */
  targetIsDefender?: boolean;
  /** 伤害类型 */
  damageType?: 'physical' | 'strategy';
  /** 战法类型（undefined = 普攻/分兵等非战法伤害） */
  skillType?: 'passive' | 'command' | 'active' | 'pursuit';
  /** 是否追击战法伤害 */
  isPursuit?: boolean;
  /** 是否燃烧/火攻类伤害（藤甲兵） */
  isBurning?: boolean;
  /** 是否 Dot 伤害（文韬不触发） */
  isDot?: boolean;
  /** 是否普攻或追击伤害（难测） */
  isBasicOrPursuit?: boolean;
  /** 施法者攻击是否为「进行攻击」（列阵只吃主动战法） */
  isActiveSkill?: boolean;
  /** 轻骑兵「前 4 次攻击」是否仍在次数内（由轻骑兵攻击计数器判定） */
  lightCavalryAttackLeft?: boolean;
}

/** 特性增减伤结算结果：caused = 造成侧加成（1 = 无），reduce = 受击侧减伤（加算） */
export interface TraitModifiers {
  caused: number;
  takeBoost: number;
  reduce: number;
}

/**
 * 计算通用特性 + 二级兵种专属特性带来的增减伤修正（与战法效果**可叠加**、不受冲突规则约束）。
 * 只覆盖「伤害/减伤」型特性；属性型（利刃/地利）见 traitStatBonus，
 * 行动序型（疾行）、规避型（死士/轻骑兵/弓骑兵首次规避）、反击型（重骑兵）见各自主流程。
 */
export function traitCombatModifiers(x: TraitCombatContext): TraitModifiers {
  let caused = 0; // 造成侧加成
  let takeBoost = 0; // 受击者「受到伤害提高」
  let reduce = 0; // 受击者减伤

  const at = x.attackerTraits ?? [];
  const tt = x.targetTraits ?? [];

  // ── 施法者通用特性（造成侧）──
  if (at.includes('列阵') && x.isActiveSkill) caused += 0.1;
  if (at.includes('齐射') && x.round <= 3) caused += 0.15;
  if (at.includes('勇毅')) {
    // 「受到弓兵和步兵的策略伤害降低 15%」= 受击者减伤，见下
  }
  if (at.includes('文韬') && x.damageType === 'strategy' && x.round >= 3 && !x.isDot) caused += 0.15;
  if (at.includes('直射') && !x.isDot) {
    const base = x.skillType === 'command' ? 0 : 0.1;
    if (base > 0) caused += base - 0.02 * Math.max(0, x.distance - 1);
  }
  if (at.includes('扰后') && (x.targetPosition === '中军' || x.targetPosition === '大营')) takeBoost += 0.1;
  if (at.includes('挫锐')) takeBoost += 0.18;
  if (at.includes('散射')) takeBoost += 0; // 分兵（首攻溅射）主流程单独处理

  // ── 施法者二级兵种专属特性（造成侧）──
  if (x.attackerTroop === '弩兵') caused += 0.08;
  if (x.attackerTroop === '长弓兵' && x.round <= 4) caused += 0.1;
  // 轻骑冲阵：战斗开始后前 4 次**攻击** +18%（次数由 action.ts 的轻骑兵计数器传入；缺省视为已用尽）
  if (x.attackerTroop === '轻骑兵' && x.lightCavalryAttackLeft === true) caused += 0.18;
  // 蛮兵：野地 +18%（用户 2026-09-20：地形不建模，默认吃得到效果）
  if (x.attackerTroop === '蛮兵') caused += 0.18;

  // ── 受击者通用特性（受击侧）──
  if (tt.includes('守备')) reduce += x.targetIsDefender ? 0.16 : 0.06;
  if (tt.includes('迂回')) reduce += 0.08;
  if (tt.includes('出奇') && x.round === 1) reduce += 0.6;
  if (tt.includes('难测') && x.isBasicOrPursuit) reduce += 0.25;
  if (tt.includes('勇毅') && x.damageType === 'strategy') reduce += 0.15;

  // ── 受击者二级兵种专属特性（受击侧）──
  const t = x.targetTroop;
  if (t === '重步兵') {
    reduce += 0.08;
    if (x.isActiveSkill) reduce += 0.12;
  }
  if (t === '禁卫') {
    if (x.isPursuit) reduce += 0.2;
    if (x.targetHasStatus('confusion') || x.targetHasStatus('rampage')) reduce += 0.3;
  }
  if (t === '死士') {
    if (x.targetHasStatus('cowardice') || x.targetHasStatus('hesitation')) reduce += 0.2;
  }
  if (t === '铁骑兵') {
    // 四类状态各自 −25%，**不可叠加**（用户 2026-09-20 确认）→ 最多 +0.25
    const any = x.targetHasStatus('confusion') || x.targetHasStatus('rampage') || x.targetHasStatus('cowardice') || x.targetHasStatus('hesitation');
    if (any) reduce += 0.25;
  }
  if (t === '重骑兵') reduce += 0.1;
  if (t === '象兵') reduce += 0.1;
  if (t === '藤甲兵') reduce += x.isBurning ? -0.15 : 0.3;
  if (t === '长弓兵') reduce -= 0.08; // 轻装：自身受到所有伤害 +8%
  if (t === '弓骑兵' && x.isPursuit) reduce += 0.9;

  return { caused, takeBoost, reduce };
}
