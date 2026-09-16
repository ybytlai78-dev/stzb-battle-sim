/**
 * 战斗引擎类型定义
 * v0.2：Skill 联合类型（主动/准备/追击）+ 状态系统（混乱/怯战/规避）
 * 全部为纯数据，无任何 UI 依赖。
 */

export type TroopType = 'cavalry' | 'infantry' | 'archer';

export type Position = '大营' | '中军' | '前锋';

export type SkillType = 'passive' | 'command' | 'active' | 'pursuit';

export type TargetMode = 'single' | 'random_single' | 'group' | 'all' | 'self';

export type DamageType = 'physical' | 'strategy';

export type Side = 'my' | 'enemy';

/** 战法效果标签（冲突判定用）：先判同类型，再判除「伤害」外标签冲突 */
export type EffectTag =
  | 'damage' // 造成一次伤害：永不冲突
  | 'confusion'
  | 'rampage' // 暴走：攻击与战法目标不分敌我
  | 'cowardice'
  | 'hesitation' // 犹豫：无法发动主动战法
  | 'evasion'
  | 'immunity' // 移除有害效果
  | 'combo'
  | 'heal'
  | 'attack_buff'
  | 'defense_buff'
  | 'strategy_buff'
  | 'speed_buff' // 提升目标速度属性
  | 'damage_reduce'
  | 'damage_boost' // 增减伤：造成伤害提高（大赏三军）/受到伤害提高（神兵天降）
  | 'insight' // 洞察：免疫混乱/怯战/暴走/犹豫
  | 'siege' // 围困：无法回复兵力
  | 'sorcery' // 妖术：有害DoT，行动时损失兵力
  | 'burning' // 燃烧：有害DoT，行动时损失兵力
  | 'panic' // 恐慌：有害DoT，行动时损失兵力
  | 'curse' // 妖术诅咒：试图发动追击战法时受到妖术伤害（密谋定蜀）
  | 'ignite' // 引燃：受到下一次伤害时额外引发一次燃烧（火势风威）
  | 'split' // 分兵：普攻后无视距离溅射相邻目标
  | 'buff_attack' // 提升目标攻击属性
  | 'buff_defense' // 提升目标防御属性
  | 'buff_strategy' // 提升目标谋略属性
  | 'buff_speed' // 提升目标速度属性
  | 'debuff_attack' // 降低目标攻击属性
  | 'debuff_defense' // 降低目标防御属性
  | 'debuff_strategy' // 降低目标谋略属性
  | 'debuff_speed' // 降低目标速度属性
  | 'taunt' // 挑衅：有害，使目标普攻挑衅者（无视距离）
  | 'cover' // 援護：有益，为我方抵挡普通攻击
  | 'first_aid' // 持续型急救：受击时按几率触发恢复（皇裔流离/金匮要略），同类指挥互相冲突
  | 'rest' // 休整：每回合行动时恢复（挂上时冻结），指挥与主动互不冲突
  | 'morale_boost' // 士气提高：指挥战法同号冲突取较高；同一战法重复触发累加（谋议宏图）
  | 'ignore_def'; // 无视防御：攻击时目标防御 × (1 − rate)，作用于攻防差（击势）

// ─── 战法输出效果（联合类型）───

/** 战法单个效果 */
export type SkillOutput =
  | {
      kind: 'physical_damage';
      /** 固定伤害率，或 [min, max] 区间每次随机（盛气横凌额外攻击 80%~160%） */
      rate: number | [number, number];
      ignoresEvasion?: boolean;
      target?: 'self';
      /** 单输出目标模式覆盖：重新按战法距离选目标（枭姬 全体160%+群体140%）。缺省沿用战法整体目标 */
      targetMode?: 'single' | 'random_single' | 'group' | 'all';
      /** 输出级 group 目标数（仅 targetMode:'group'，缺省沿用战法 groupCount 或 2）；`[2,3]` 50/50 随机（辕门射戟） */
      groupCount?: number | [number, number];
      /**
       * 首次攻击标记（辕门射戟）：伤害结算后对本次攻击的每个目标施加「造成攻击伤害降低」debuff
       * （damage_boost caused 方向，rate 为小数如 -99.99 = -9999%，配合 buffMult 10% 伤害下限
       * 强制目标造成伤害降为 min 10%），持续 duration 回合。第二次攻击目标独立选择、不受影响。
       */
      markCausedReduce?: {
        /** 造成伤害降低倍率（小数，如 -99.99 = -9999%） */
        rate: number;
        /** 持续回合数（行动中施加：duration 2 = 覆盖目标下一个行动回合，如辕门射戟「持续1回合」） */
        duration: number;
      };
      /**
       * 伤害结算后对目标施加「受到伤害提高」状态（银龙冲阵：首次攻击的目标）：
       *  rate 为施法者攻击属性 80 时的基础增伤（20 = 20%），受攻击属性缩放（每点 +growthRate%），
       *  持续 duration，同战法同目标最多叠加 maxStacks 层（层数计数存状态 stacks）。
       */
      markTakenBoost?: {
        rate: number;
        growthRate: number;
        duration: number;
        maxStacks: number;
      };
      /**
       * 借友军出手（怀德畏威）：用谋略最低友军的攻击/兵力/造成侧增伤结算攻击伤害。
       * 友军不耗行动、不受混乱拦截；杀伤统计 creditToId 归施法者。缺省为施法者自己。
       * `'recipient'` = 以每个通过兵种过滤的目标为攻击者，按其攻击/兵力/造成侧增减伤，
       * 对距离 `range`（缺省战法 range）内敌军单体打攻击；杀伤 sourceId 为该单位。
       */
      attacker?: 'lowest_strategy_ally' | 'recipient';
      /** 代打选敌距离（疏数骑兵 3）；缺省 skill.range */
      range?: number;
      /** 只对这些兵种的当前目标池结算 */
      troopTypes?: TroopType[];
      /** 当前回合 ≥ 此值才结算（宣威再战第 4 回合起） */
      startRound?: number;
      /** 当前回合 ≤ 此值才结算（宣威再战前 3 回合） */
      endRound?: number;
      /**
       * 选目标时无视战法距离，从全部存活敌军中取（宣威再战第 4 回合起随机单体）。
       * 需配合 targetMode 使用；缺省仍按 skill.range 筛选。
       */
      ignoreRange?: boolean;
      /**
       * 本段重复次数；`[1, 3]` = 均匀随机 1~3 次（宣威再战第 4 回合起）。
       * 每次独立重选目标（若带 targetMode）。
       */
      repeats?: number | [number, number];
      /** 独立发动率（先声夺人第三段 60%）；士气修正后判定，与 inflict_status.chance 同口径 */
      chance?: number;
      /**
       * 本段打出后连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气 `moraleTriggerRate(p)`，
       * 成功则在战法距离内独立 `random_single` 再打同一段（循环驱动，递归调用时去掉 chain），然后 `p -= decay`。
       */
      chain?: { chance: number; decay: number };
      /** 为 true 时本次结算不加算兵种克制 −30% */
      ignoresTroopCounter?: boolean;
    }
  | {
      kind: 'chance_group';
      /** 基础发动率 0~1，走施法者士气修正；成功才执行内层全部 output */
      chance: number;
      outputs: SkillOutput[];
    }
  | {
      kind: 'strategy_damage';
      rate: number;
      strategyScaled: boolean;
      /** strategyScaled 且 growthRate === undefined 时不缩放、用基值 */
      growthRate?: number;
      ignoresEvasion?: boolean;
      target?: 'self';
      targetMode?: 'single' | 'random_single' | 'group' | 'all';
      groupCount?: number | [number, number];
      /**
       * 独立发动率（运筹决胜策略攻击 50%），缺省必中。
       * 仅 `roundTrigger:'before_active'` 的二类指挥按此逐段判定。
       */
      chance?: number;
      /** 仅对带这些状态之一的目标生效（运筹决胜：混乱 / 暴走） */
      requireStatuses?: StatusType[];
      /**
       * 本段打出后连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气 `moraleTriggerRate(p)`，
       * 成功则在战法距离内独立 `random_single` 再打同一段（循环驱动，递归调用时去掉 chain），然后 `p -= decay`。
       */
      chain?: { chance: number; decay: number };
      /**
       * 本段选敌距离（不攻每回合策略 5）。缺省 `skill.range`。
       * 与 physical_damage.range 同口径。
       */
      range?: number;
      /** 选目标时无视战法距离（对称 physical_damage.ignoreRange） */
      ignoreRange?: boolean;
    }
  | {
      kind: 'positional_physical_damage';
      positions: Position[];
      /** 固定伤害率，或 [min, max] 区间每次随机（奇兵拒北 120~180%） */
      rate: number | [number, number];
      /** self=施法者；fastest_ally=速度最高的友军单体（不耗行动、不受混乱） */
      source: 'self' | 'fastest_ally';
      /** 为 true 时本次结算不加算兵种克制 −30% */
      ignoresTroopCounter?: boolean;
    }
  | {
      kind: 'inflict_status';
      /** 单个状态，或状态数组（随机选 1 个施加——奇佐鬼谋随机 1 种控制） */
      status: CreateStatus | CreateStatus[];
      target?: 'self';
      /** 单输出目标池覆盖：'enemy'=按战法距离重选敌军、'ally'=重选友军、'self'=施法者。
       *  用于属性吸取（黄天余音：敌单体 debuff + 自身/友军 buff），缺省沿用战法整体目标 */
      targetSide?: 'enemy' | 'ally' | 'self';
      /** 单输出目标模式覆盖：按战法距离重选目标（配合 targetSide 使用） */
      targetMode?: 'single' | 'random_single' | 'group' | 'all';
      /** 从友军池排除施法者（「自身 + 友军单体」的友军段：奇佐鬼谋 / 黄天余音） */
      excludeSelf?: boolean;
      /**
       * status 为数组时：true = 对同一目标施加全部状态（黄天余音友军四维）；
       * 缺省仍随机选 1 个（奇佐鬼谋控制）。
       */
      applyAll?: boolean;
      /**
       * 独立发动率（运筹决胜暴走 30%），缺省必中。
       * 仅 `roundTrigger:'before_active'` 的二类指挥按此逐段判定。
       */
      chance?: number;
      /**
       * 仅对「上两段伤害输出目标重合」的单位施加（怀德畏威：
       * 友军随机单体攻击 ∩ 自身群体策略 2 目标 → 重合者混乱）。
       * 为 true 时不再按战法整体目标/本段 targetSide 重选，直接取交集。
       */
      onlyIfOverlapPrevious?: boolean;
      /**
       * 引爆同类 DoT（烈火焚舟）：目标已存在「本战法」施加的同类 DoT 时，
       * 立即结算剩余 DoT 伤害（剩余回合数 × 每次伤害）并移除该 DoT，
       * 再对目标及其相邻单位施加更高倍率、更短持续的同类 DoT。
       * 引爆只针对本战法造成的同类 DoT（其他战法的 DoT 不引爆）。
       */
      detonate?: {
        /** 引爆后新施加 DoT 的基础伤害率（如 270，受谋略缩放） */
        rate: number;
        /**
         * 引爆段独立成长率（烈火焚舟二段 2.26）。
         * 缺省沿用 status.growthRate（一段与二段同率时不必写）。
         */
        growthRate?: number;
        /** 引爆后新施加 DoT 的持续回合数（如 1） */
        duration: number;
        /** 是否波及目标相邻单位 */
        adjacent: boolean;
      };
      /** 只对这些兵种的当前目标池结算 */
      troopTypes?: TroopType[];
      /** 施法者须处于这些站位之一，否则本段不结算（疮痍累身：仅前锋/中军时援护友军） */
      casterPositions?: Position[];
      /**
       * 有值时忽略战法整体目标，改为按站位筛选：缺省敌军（落首箭混乱打大营）；
       * 配合 targetSide:'ally' 时改筛友军（怀橘遗亲：大营 / 前锋中军）。缺员则跳过。
       */
      positions?: Position[];
    }
  | { kind: 'remove_debuffs'; target?: 'self'; troopTypes?: TroopType[] }
  | { kind: 'grant_evasion'; stacks: number; target?: 'self' }
  | {
      kind: 'heal';
      rate: number;
      strategyScaled: boolean;
      growthRate: number;
      target?: 'self';
      /**
       * 单输出目标池覆盖：缺省沿用战法整体目标。
       * 合流/利兵谋胜用 ally 另选友军；三军之众每次独立重选我军单体。
       */
      targetSide?: 'enemy' | 'ally' | 'self';
      /** 配合 targetSide 重选目标；random_single = 距离内均匀随机（三军之众每次独立判定） */
      targetMode?: 'single' | 'random_single' | 'group' | 'all';
      /** 从友军池排除施法者（「自身及友军单体」的友军段：合流 / 利兵谋胜） */
      excludeSelf?: boolean;
    }
  | {
      kind: 'grant_first_aid';
      target?: 'self';
      /** 受击时触发恢复的几率（如 50 = 50%，固定值不受谋略影响；皇裔流离/金匮要略均为 50%） */
      rate: number;
      /** 恢复率基础值（谋略 80 时，如 68 = 68%），受谋略缩放 */
      healRate: number;
      /** 恢复率成长率（每 +1 谋略恢复率 +N，如 0.6） */
      healGrowthRate: number;
      /** 持续回合数（缺省整场战斗；金匮要略前 3 回合 duration: 3） */
      duration?: number;
      /** 总生效次数每达到 every 次，触发几率 +increment 可叠加（皇裔流离：每 3 次 +5% → 50→55→60） */
      triggerUp?: { every: number; increment: number };
    }
  | {
      kind: 'grant_damage_boost';
      /** 基础增伤（谋略 80 时），受谋略影响：实际 = 基础 + 成长率×(谋略-80)（八舍九入） */
      rate: number;
      growthRate: number;
      duration: number;
      /**
       * 增减伤方向：'caused'=目标造成伤害提高/降低（大赏三军、未笄难言）；
       * 'taken'=目标受到伤害提高/降低（神兵天降、名士在野）。缺省 'taken'。
       */
      direction?: 'caused' | 'taken';
      target?: 'self';
      /** 只对这些兵种的当前目标池结算 */
      troopTypes?: TroopType[];
    }
  /**
   * 按目标生效士气分支（盛气横凌）：
   * 生效士气 > threshold（缺省 100，即高昂）走 high，否则（一般/低落）走 low。
   */
  | {
      kind: 'morale_branch';
      /** 高昂阈值，缺省 100（>100 为高昂） */
      threshold?: number;
      high: SkillOutput[];
      low: SkillOutput[];
    }
  /**
   * 从若干效果组中不放回随机抽取 count 组并全部结算（兵无常势：3 选 2）。
   * 每组是一组同时生效的输出（三维属性加成算一组）。
   */
  | {
      kind: 'random_pick';
      count: number;
      options: SkillOutput[][];
    };

/** 状态施加模板 */
export type CreateStatus =
  | { type: 'confusion'; duration: number | [number, number] }
  | { type: 'rampage'; duration: number; /** 待下次行动才生效（青丘媚祸），避免挂上即控、重复刷新永控 */ pendingNextAct?: boolean }
  | { type: 'cowardice'; duration: number }
  | { type: 'hesitation'; duration: number }
  | { type: 'evasion'; stacks: number }
  | { type: 'combo'; duration: number }
  /** amount 为谋略 80 时的基础值；strategyScaled=true 且给 growthRate 时，实际数值按 scaledValue 缩放。
   *  percent=true 时 amount 为百分比（如 15 = 15%），按目标当前生效属性（含点数增减后）结算 */
  | { type: 'attack_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
  | { type: 'defense_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
  | { type: 'strategy_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
  | { type: 'speed_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
  | { type: 'damage_reduce'; rate: number; duration: number; strategyScaled?: boolean; /** 受攻击缩放（对称字段）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; /** 按 8 份衰减（谋议宏图）：准备阶段 8/8，每回合开始 -1/8 */ decayEighths?: number; /** 按 N 份受击衰减（疮痍累身 12）：受匹配伤害且实际扣兵后 −1 份，rate = baseRate × 剩余/初始 */ decayFifths?: number; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy' }
  /** direction：'caused'=自身造成伤害提高/降低（血溅黄砂、强势）；'taken'=自身受到伤害提高/降低（神兵天降、名士在野）。缺省 'taken'。
   *  stacks：叠层计数（带上限的增减伤，银龙冲阵），同战法累加时 +1
   *  strategyScaled=true 且给 growthRate 时（密谋定蜀每次发动 +5% 受谋略）：rate 为谋略 80 时的基础值，实际数值按 scaledValue 缩放
   *  defenseScaled=true（当敌制决 +8%）：公式同受谋略，属性换生效防御
   *  speedScaled=true（攻其不备 +11.6%）：受速度缩放；growthRate === undefined 时不缩放、用基值
   *  charges：次数型。direction:'caused' 时按攻击者打出消耗（青丘媚祸）；
   *  direction:'taken' 时按受击方吃到匹配伤害后消耗（文伐下一次受到策略），不按回合递减
   *  attackScaled=true（万箭 −50% / 恃强 −30%）：受攻击缩放；growthRate === undefined 时不缩放、用基值
   *  decayFifths：按 N 份衰减（恃强 5）：挂上时满额，每次受到匹配伤害且实际扣兵 > 0 则 −1 份，rate = baseRate × fifths/N
   *  chargesStack：同战法重复施加时累加 rate（七步释嫌）；缺省不叠加（青丘媚祸） */
  | { type: 'damage_boost'; rate: number; duration: number; direction?: 'caused' | 'taken'; stacks?: number; /** 同战法同过滤维叠层达到此上限后不再加 rate；文德椒房 3 */ maxStacks?: number; /** 按 8 份衰减（虎豹督军）：每回合前 −1/8（同谋议宏图口径） */ decayEighths?: number; strategyScaled?: boolean; /** 受防御缩放（当敌制决 +8%，公式同受谋略，属性换生效防御） */ defenseScaled?: boolean; /** 受速度缩放（攻其不备 +11.6%）；growthRate === undefined 时不缩放、用基值 */ speedScaled?: boolean; /** 受攻击缩放（万箭齐发 −50%、恃强淬锋 −30% / +3.4%）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; charges?: number; chargesStack?: boolean; /** 按 N 份衰减（恃强淬锋 5）：挂上满额，每次匹配受击实际扣兵后 −1 份 */ decayFifths?: number; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy' }
  /**
   * 发动率提升。rate 为小数（1.2 = +120% / ×2.2）。
   * skillTypes：只对这些战法类型生效（动如雷震仅追击）；缺省主动+追击都吃（难知如阴）。
   * additive：true 时为基础率 + rate（动如雷震 +100 个百分点），超过 100% 由发动率判定封顶；
   * 缺省为乘算 基础率 × (1+rate)（难知如阴）。
   */
  | { type: 'trigger_boost'; rate: number; duration: number; skillTypes?: SkillType[]; additive?: boolean }
  | { type: 'insight'; duration: number }
  | { type: 'siege'; duration: number }
  | { type: 'sorcery'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  | { type: 'burning'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  | { type: 'panic'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  /** 妖术诅咒（密谋定蜀）：携带者试图发动追击战法时触发一次妖术伤害（rate% 受谋略），持续 2 回合 */
  | { type: 'curse'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  /** 引燃标记（火势风威）：携带者受到下一次伤害时额外引发一次燃烧（rate% 受谋略），触发后移除 */
  | { type: 'ignite'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  | { type: 'split'; duration: number; rate: number; /** 次数型分兵（鱼鳞）：有值时按攻击输出次数消耗，不按回合递减 */ charges?: number; /** 受谋略缩放（鱼鳞） */ strategyScaled?: boolean }
  | { type: 'jump_prep'; duration: number; rate: number }
  | { type: 'taunt'; duration: number; targetId: string }
  /** 反击资格（反击之策）：携带者被普攻实际扣兵后，对来源打 rate% 攻击。不消耗。rate 与 physical_damage 同口径（100=100%） */
  | { type: 'counter'; duration: number; rate: number }
  | { type: 'cover'; duration: number }
  /** 持续型急救（皇裔流离/金匮要略）：受击时按几率触发恢复。
   *  healRate 为谋略 80 时的恢复率（受谋略缩放）；触发率与总生效次数走战法级计数器（grant_first_aid）；
   *  duration 缺省整场战斗（皇裔流离），金匮要略 duration 3（前 3 回合）；
   *  healTroops 为施法者「挂上时」兵力——恢复值 = floor(round(300×兵/(3500+兵)) × 恢复率/100 × (1+恢复提高))，
   *  状态类恢复的变量取自状态被施加那一刻（十面埋伏《率土秘卷一：恢复效果》） */
  | { type: 'first_aid'; healRate: number; healGrowthRate: number; triggerUpEvery: number; triggerUpIncrement: number; duration?: number; healTroops?: number }
  /**
   * 休整：携带者每回合行动时恢复兵力（挂上时按施法者兵力/谋略冻结每次恢复值）。
   * 指挥型（重整旗鼓/援军秘策）与主动型（养精蓄锐/休整/收拢）不同类型共存；
   * 同类型不同战法取每次恢复值较高者替换（大明州：休整效果互相刷新）。
   * startRound：第 N 回合起才跳恢复（重整旗鼓/援军秘策 = 5）。
   */
  | { type: 'rest'; rate: number; growthRate: number; duration: number; startRound?: number; strategyScaled?: boolean }
  /** 士气提高（谋议宏图）：amount 为士气点数；同战法累加，不同指挥战法冲突取较高 */
  | { type: 'morale_boost'; amount: number; duration: number }
  /** 无视防御比例（0.6 = 60%），自身攻击时目标防御 × (1 − rate) */
  | { type: 'ignore_def'; rate: number; duration: number };

// ─── 战法（联合类型）───

interface BaseSkill {
  id: string;
  name: string;
  type: SkillType;
  /** 战法有效距离 */
  range: number;
  /** 发动率 0~1（指挥/被动为 1）；`[0.5, 1]` = 每次判定均匀随机 50%–100%（烽火覆周） */
  triggerRate: number | [number, number];
  /** 效果标签：冲突判定用（含伤害时永不与其他效果冲突） */
  tags: EffectTag[];
  /** group 模式目标数（仅 targetMode:'group' 有效，缺省 2）；`[2,3]` = 50% 概率 2 目标 / 50% 概率 3 目标（辕门射戟） */
  groupCount?: number | [number, number];
  /**
   * 开场上阵单位的 troopType 集合必须 ⊆ 此列表，否则本战法整次不生效（疏数弓+骑）。
   * 读部署名单（不论 alive）；战斗中不再复查。
   */
  teamTroopFilter?: TroopType[];
}

/** 普通主动战法 */
export interface SimpleActiveSkill extends BaseSkill {
  type: 'active';
  prepare: false;
  targetMode: TargetMode;
  /** 目标池覆盖：'enemy'=敌军（对敌施放减益类状态如闭月防御下降）、'ally'=友军。缺省按效果启发式推断 */
  targetSide?: 'enemy' | 'ally';
  output: SkillOutput[];
}

/** 准备主动战法 */
export interface PreparedActiveSkill extends BaseSkill {
  type: 'active';
  prepare: true;
  /**
   * 准备回合数。缺省 1（现有 1 回合准备战法零改动）。
   * 进入准备时 `prepareLeft = prepareTurns ?? 1`；下一行动 `prepareLeft > 1` 则再减 1 并继续准备。
   */
  prepareTurns?: number;
  /** 含 `random_single`：率土「敌军/友军单体」为距离内均匀随机，不是最近优先 */
  targetMode: 'all' | 'group' | 'single' | 'random_single';
  /** 目标池覆盖：'enemy'=敌军、'ally'=友军。缺省按效果启发式推断 */
  targetSide?: 'enemy' | 'ally';
  output: SkillOutput[];
}

/** 追击战法（普攻命中后触发） */
export interface PursuitSkill extends BaseSkill {
  type: 'pursuit';
  output: SkillOutput[];
}

/** 指挥战法 */
export interface CommandSkill extends BaseSkill {
  type: 'command';
  triggerRate: 1;
  targetMode: TargetMode;
  /** 指挥战法释放阶段：prep=一类（准备阶段释放一次，按准备时兵力/属性结算）；round=二类（正式回合武将行动时判定，看实时数据） */
  phase: 'prep' | 'round';
  /**
   * 二类指挥（phase='round'）的判定时机：
   * - on_act：武将行动时判定（奇兵拒北「每回合行动时」）
   * - before_active：每次试图发动主动战法前判定（运筹决胜）；准备完成释放 / 混乱 / 犹豫不触发
   * - ally_act：我军全体发动普攻 / 试图发动主动或追击时发动（七步释嫌）；施法者阵亡不触发
   * - after_first_active：本回合首次主动战法实际释放成功后判定（文德椒房）；进入准备不算，准备完成释放算；每次按战法距离 / groupCount 重选目标
   * 一类指挥无需此字段（准备阶段已释放一次）。
   */
  roundTrigger?: 'on_act' | 'before_active' | 'ally_act' | 'after_first_active';
  /**
   * 二类指挥·友军行动累计（七步释嫌）：每次 ally_act 发动后 +1，每达到 count 次再执行 output。
   * 恢复类 output 按施法者当前兵力实时结算（二类指挥）。
   */
  allyActEvery?: {
    count: number;
    output: SkillOutput[];
  };
  /**
   * 战斗开始一次性效果：类型标为二类指挥（入库类型），但实际在准备阶段只释放一次，不参与每回合 on_act 判定。
   * 用于「当敌制决」（用户确认：入库类型二类指挥，效果保持战斗开始一次性 50% 减伤不叠加）。
   */
  battleStartOnce?: boolean;
  /** 一类指挥延迟结算：第 atRound 回合自动对锁定目标结算一次（白衣渡江第3回合全体谋略）。
   *  targetMode 指定结算目标（默认 skill.targetMode）：白衣怯战为 2 目标群体、伤害为全体，故此处为 'all' */
  delayedOutput?: {
    atRound: number;
    output: SkillOutput[];
    targetMode?: 'single' | 'group' | 'all';
  };
  /**
   * 一类指挥准备阶段一次性效果（不参与 roundRepeat 每回合判定）：
   * 其疾如风「战斗开始后前3回合速度+41」在准备阶段无条件施加，连击则走 roundRepeat 每回合 70% 判定。
   * targetSide 沿用战法自身（其疾如风为 'ally' 全体）。
   */
  initialOutput?: SkillOutput[];
  /** 一类指挥：施法者兵力为 0 后持续效果仍生效（白衣/先驱/战必），默认 false */
  retainAfterDeath?: boolean;
  /** 每回合重复判定：战必断金（1-3回合 90%）、措手不及（4+回合 80%）。预备负面效果：准备阶段锁目标，目标行动时按概率判定生效 */
  roundRepeat?: {
    startRound: number;
    endRound: number;
    rate: number;
    /**
     * 预备负面目标选择覆盖：默认取战法锁定目标（targets）。
     * 白衣渡江怯战为 2 目标群体、伤害为全体，故设 'group' 与伤害目标分离。
     */
    targetMode?: 'single' | 'group' | 'all';
    /**
     * 预备判定目标侧覆盖：缺省沿用战法 targetSide。
     * 母仪浮梦：规避打友军（skill.targetSide='ally'），减伤在敌军行动时判定（targetSide:'enemy'）。
     */
    targetSide?: 'enemy' | 'ally';
  };
  /** 二类指挥动态发动率：初始 base，未生效每回合 +increment，生效后重置（奇兵拒北 30% 起始，未生效+5%） */
  dynamicTriggerRate?: { base: number; increment: number };
  /** 每 N 回合判定一次（难知如阴「每2回合」）：只在 currentRound % everyNRounds === 0 时判定。缺省每回合 */
  everyNRounds?: number;
  /** 先手：先驱突击前 3 回合先手。回合内先比「携带先手标签」单位的出手顺序，再比其余单位 */
  priorityRounds?: number;
  /**
   * 二类指挥·行动叠层（奋疾先登）：行动时获得 1 层增伤（perLayer%），
   * 并与场上所有存活单位（不含自己）速度对比：速度高于目标 → speedHigherChance 概率额外 +1 层；
   * 低于或等于目标 → speedLowerOrEqualChance 概率额外 +1 层。
   * **每叠 1 层后立即检查**：层数 × perLayer 达到 cap 时，立即对距离 range 内敌军群体（targetMode）
   * 发动一次攻击（skill.output 的 physical_damage，攻击时增伤层仍生效），发动后增伤层数清空，
   * 使攻击目标速度属性降低 speedReduce（可叠加、持续到战斗结束），随后继续剩余速度对比判定——
   * 一轮行动中可多次叠满、多次触发攻击。
   */
  actLayer?: {
    /** 每层增伤百分比（如 8 = 8%） */
    perLayer: number;
    /** 触发攻击的增伤百分比阈值（如 40 = 5 层） */
    cap: number;
    /** 速度高于目标时额外叠层概率（0~1，如 0.7） */
    speedHigherChance: number;
    /** 速度低于或等于目标时额外叠层概率（0~1，如 0.3） */
    speedLowerOrEqualChance: number;
    /** 触发攻击的距离范围（如 3） */
    range: number;
    /** 触发攻击后目标速度降低点数（如 20，可叠加） */
    speedReduce: number;
    /** 攻击目标模式（敌军群体 = 'group'） */
    targetMode: 'single' | 'group' | 'all';
  };
  /**
   * 目标侧（增减伤指挥战法）：'enemy'=敌军群体（神兵天降：受到伤害提高）、'ally'=我军群体（大赏三军：造成伤害提高）。
   * 仅一类指挥在准备阶段按战法距离选敌/友军目标；缺省按敌军（现有行为）。
   */
  targetSide?: 'ally' | 'enemy';
  /**
   * 常驻伤害前叠层（持节镇西）：准备阶段对友军全体注册，之后友军每次造成/受到伤害前按层叠属性。
   * 每层各自持续 1 回合（回合结束掉 1 层），至多 maxStacks 层；数值按持有者（卫瓘）自身对应属性缩放。
   */
  stackBuff?: {
    /** 友军造成攻击伤害前 → 攻击提高 perStack（受持有者攻击属性影响） */
    onAttack?: { maxStacks: number; perStack: number; growthRate: number };
    /** 友军造成策略伤害前 → 谋略提高 perStack（受持有者谋略属性影响） */
    onStrategy?: { maxStacks: number; perStack: number; growthRate: number };
    /** 友军受到伤害前 → 防御提高 perStack（受持有者防御属性影响） */
    onDefense?: { maxStacks: number; perStack: number; growthRate: number };
  };
  /**
   * 一类指挥·回合前再结算（谋议宏图士气叠层）：
   * 每回合 `round_start` 之后、单位行动之前，对锁定目标再执行 output（同战法累加）。
   * 与 roundRepeat（目标行动时概率判定）不同：无发动率、必定执行。
   */
  roundStartRepeat?: {
    output: SkillOutput[];
    startRound?: number;
    endRound?: number;
    /** 仅奇数回合执行（鱼鳞） */
    oddRounds?: boolean;
  };
  /**
   * 受击触发（盲侯奋勇/陷储立齐/缓师徐持）：准备阶段只登记，不立刻结算 output。
   * 目标受到伤害后由 applyDamage 判定。
   */
  onHurt?: OnHurtConfig | OnHurtConfig[];
  onHeal?: OnHealConfig;
  output: SkillOutput[];
}

/**
 * 受击触发配置（盲侯奋勇 / 陷储立齐 / 同仇敌忾 / 缓师徐持）。
 * 在 applyDamage 扣兵后、阵亡标记前判定；反击伤害不再递归触发（防循环）。
 */
export interface OnHurtConfig {
  /** 谁受伤时判定：self=施法者自身 / ally=同侧含自己 / enemy=对侧 / locked=一类指挥锁定目标 */
  victim: 'self' | 'ally' | 'enemy' | 'locked';
  /** 基础触发率 0~1，缺省 1（必中）。盲侯 0.4、缓师 0.5 */
  rate?: number;
  /** 触发率受谋略缩放（缓师 50%） */
  rateStrategyScaled?: boolean;
  /** 触发率成长率（缺省 0.15/点，增减伤百分比推定） */
  rateGrowthRate?: number;
  /** 每单位每回合只触发一次（陷储立齐） */
  oncePerRound?: boolean;
  /**
   * 该单位首次受击时必定触发，且额外触发 1 次（疮痍累身：「首次受到伤害时该效果必定触发且额外触发 1 次」）。
   * 首次按「战法 × 施法者 × 受击者」记录（ctx.hurtFirstKeys）。
   */
  firstGuaranteed?: boolean;
  /** 仅当受伤者本回合已行动完毕（缓师徐持） */
  onlyIfActed?: boolean;
  /** 独立判定次数（缓师 2），缺省 1 */
  rolls?: number;
  /**
   * 效果落点：
   * - skill_targets：按战法距离/目标模式重选敌军并结算 output（盲侯反击）
   * - allies_within：受伤者同侧距离 ≤ withinDistance 的友军含自己，结算 output（同仇）
   * - victim：对受伤者结算 output（缓师 debuff）
   * - steal：随机吸取伤害来源一维属性给受伤者（陷储立齐）
   * - source：对伤害来源结算 output（典韦反击）
   */
  applyTo: 'skill_targets' | 'allies_within' | 'victim' | 'steal' | 'source';
  /** applyTo='source'：仅当伤害来源为敌军且距离 ≤ 此值（典韦反击距离 2） */
  sourceMaxDistance?: number;
  /** applyTo='allies_within' 时的同侧距离上限（同仇 1；自身距离 0） */
  withinDistance?: number;
  /** 同战法叠层上限（同仇 8）；按目标身上本战法 damage_boost.stacks 计数 */
  maxStacks?: number;
  /** applyTo='steal'：从伤害来源吸取一维属性 */
  steal?: {
    amount: number;
    duration: number;
    stats: Array<'attack' | 'defense' | 'strategy'>;
  };
  /** 只匹配该类伤害；缺省两类都吃。赏顺伐逆只吃策略（含 DoT） */
  damageKind?: 'physical' | 'strategy';
  /** 缺省 `skill.output`（典韦/盲侯）。于禁反制 / 贾充反击自带这段，不覆盖准备阶段 output */
  output?: SkillOutput[];
  /** 伤害来源过滤。缺省 `any`。`basic` = 只吃 applyDamage 传入 damageSource:'basic' 的普攻 */
  damageSource?: 'basic' | 'any';
  /** 判定时机。缺省 after_damage（扣兵后）。空城/健卒减伤走 before_damage */
  timing?: 'before_damage' | 'after_damage';
  /** 钩子生效回合窗口（空城 endRound:2） */
  startRound?: number;
  endRound?: number;
  /** before_damage 判定成功后，本段伤害乘 (1 − rate)。健卒 0.5 */
  thisHitReduce?: number;
  /** 仅当 source 带 taunt 且 targetId 为受伤者（以诱待来回血） */
  onlyIfSourceTauntsVictim?: true;
}

/** 取战法第一条受击配置（单条或数组的 [0]） */
export function firstOnHurt(onHurt?: OnHurtConfig | OnHurtConfig[]): OnHurtConfig | undefined {
  if (!onHurt) return undefined;
  return Array.isArray(onHurt) ? onHurt[0] : onHurt;
}

/**
 * 受恢复触发（赏顺伐逆）：`recoverTroops` 实际恢复 > 0 后判定。
 * 处理期间 `resolvingHealHooks` 防重入，避免自己奶自己再套一层。
 */
export interface OnHealConfig {
  /** 谁被恢复时判定：self=施法者自身 / ally=同侧含自己 */
  victim: 'self' | 'ally';
  /** 基础触发率 0~1，缺省 1。赏顺伐逆 0.75 */
  rate?: number;
  /**
   * 效果落点：
   * - allies：友军全体（含自己）结算 output（赏顺伐逆群体恢复）
   * - self：只对施法者结算
   */
  applyTo: 'allies' | 'self';
  /** 缺省 `skill.output` */
  output?: SkillOutput[];
}

/** 被动战法（每回合开始触发） */
export interface PassiveSkill extends BaseSkill {
  type: 'passive';
  triggerRate: 1;
  timing: 'battle_start' | 'round_start';
  targetMode: 'self' | 'all';
  /** 施法者阵亡后受击效果仍生效（同仇敌忾全队光环），缺省 false */
  retainAfterDeath?: boolean;
  /** 被动生效回合窗口（先声夺人 endRound:3）；battle_start 型不受此字段影响 */
  startRound?: number;
  endRound?: number;
  /** 受击触发（同仇敌忾 / 舍身卫主）：战斗开始只登记，不立刻结算 output */
  onHurt?: OnHurtConfig | OnHurtConfig[];
  onHeal?: OnHealConfig;
  /**
   * 承担友军攻击伤害（舍身卫主）：前 rounds 回合、自身处于 positions 时，
   * 友军受到的攻击伤害在结算前将目标改为自己（伤害计算/规避/受击均视自己为受击者）。
   */
  redirectAllyPhysical?: { rounds: number; positions: Position[] };
  /**
   * 每回合行动阶段、在主动/普攻之前执行（火兽冲锋 50% 刀）。
   * `timing:'battle_start'` 的开战 `output` 仍只在准备阶段走一次；本字段不在 battle_start 触发。
   */
  roundStartRepeat?: {
    output: SkillOutput[];
    startRound?: number;
    endRound?: number;
    oddRounds?: boolean;
  };
  /**
   * 自身造成攻击伤害叠层（恃强淬锋 +3.4%/层）。
   * onRoundStart：tickRoundStartStatuses 给持有者 +1 层（不要走 roundStartRepeat，那是行动阶段）。
   * onDealPhysical：持有者造成普攻/战法攻击/分兵/反击且实际扣兵后 +1 层。
   * 层数走 damage_boost stacks + sameSource 累加，到 maxStacks 停止。
   */
  selfPhysBoost?: {
    perStack: number;
    maxStacks: number;
    duration: number;
    attackScaled?: boolean;
    onRoundStart?: boolean;
    onDealPhysical?: boolean;
  };
  output: SkillOutput[];
}

/** 战法（v0.3：含普通主动/准备主动/追击/指挥/被动） */
export type Skill = SimpleActiveSkill | PreparedActiveSkill | PursuitSkill | CommandSkill | PassiveSkill;

/** 四维部队加成（点数，已按面板换算，不写进 General 面板字段） */
export interface FormationBonus {
  attack: number;
  defense: number;
  strategy: number;
  speed: number;
}

/** 单条可展示来源（弹层与战报【阵容】共用） */
export interface FormationBonusLine {
  unitId: string;
  category: 'faction' | 'title' | 'troop';
  /** 称号 id，仅 category==='title' */
  titleId?: string;
  titleName?: string;
  bonuses: FormationBonus;
}

/** computeTroopBonuses 返回值 */
export interface TroopBonusResult {
  /** unitId → 合计点数（写入 UnitState.formationBonus） */
  byUnit: Map<string, FormationBonus>;
  /** 全 0 的 line 不输出 */
  lines: FormationBonusLine[];
}

// ─── 武将 ───

export interface General {
  id: string;
  name: string;
  /** 稀有度：4星 / 5星 */
  rarity: '4星' | '5星';
  /** COST（统率值） */
  cost: number;
  faction: string;
  /** 限定/赛季标签：sp / xp / s2 等，可多个 */
  tags: string[];
  /**
   * SP 互斥组 key：同组武将不可同队（如 SP赵云 与 赵云）。
   * null = 无限制，可任意共存。
   */
  mutualExclusionGroup: string | null;
  troopType: TroopType;
  position: Position;
  attack: number;
  defense: number;
  strategy: number;
  speed: number;
  /** 攻击距离 1~5 */
  attackRange: number;
  /** 初始兵力 */
  maxTroops: number;
  /** 主战法名称（展示用） */
  mainSkillName: string;
  /** 主战法描述（展示用） */
  skillDesc: string;
  /** 主动战法（可多个，按序判定） */
  activeSkillIds: string[];
  /** 被动战法（可多个，回合开始触发） */
  passiveSkillIds: string[];
  /** 指挥战法（可多个，战斗开始触发） */
  commandSkillIds: string[];
  /** 追击战法（可多个，普攻命中后触发） */
  pursuitSkillIds: string[];
  /** 士气，参与战法发动率（moraleRate，120 → 系数 1.12） */
  morale: number;
  /** 等级（40~50，Web 端可调；引擎不参与计算，仅数据透传供战报复用） */
  level?: number;
  /** 红度 0-5（Web 端兵力公式用；引擎不参与计算，仅数据透传供战报复用） */
  redness?: number;
}

/** 武将数据库记录（HeroRecord）：对应 heroes 表原始字段。
 *  站位（position）由用户装配阵容时决定，不属于武将固有数据，故不在库中。 */
export interface HeroRecord {
  id: string;
  name: string;
  rarity: '4星' | '5星';
  cost: number;
  faction: string;
  tags: string[];
  mutualExclusionGroup: string | null;
  troopType: TroopType;
  attackRange: number;
  baseAttack: number;
  baseDefense: number;
  baseStrategy: number;
  baseSpeed: number;
  growthAttack: number;
  growthDefense: number;
  growthStrategy: number;
  growthSpeed: number;
  mainSkillId: string;
  mainSkillName: string;
  skillDesc: string;
}

/** 伤兵死亡机制配置（v0.13）：
 *  每回合受到的伤害按「当回合死亡率」即时拆分为死亡（永久损失，不可恢复）与伤兵（入池，可恢复）。
 *  死亡率 = base + perRound×(回合-1)，封顶 100%（第 8 回合 = 103% → 100%）。
 *  死亡按受伤量结算，治疗不冲减死亡；恢复（heal/持续急救等）只能消耗伤兵池。 */
export interface WoundedMortalityConfig {
  /** 第 1 回合死亡率（%），如 5 */
  base: number;
  /** 每经过一回合死亡率增加（%），如 14（→ 第 2 回合 19%、第 3 回合 33%） */
  perRound: number;
}

/** 一场战斗的双方配置 */
export interface BattleConfig {
  myTeam: General[];
  enemyTeam: General[];
  /** 固定随机种子，保证可复现 */
  seed: number;
  /** 最大回合数，初版固定 8 */
  maxRounds: number;
  /** 伤兵死亡机制配置：缺省 { base: 5, perRound: 14 }（默认启用） */
  woundedMortality?: WoundedMortalityConfig;
}

// ─── 战斗中的武将运行时状态 ───

export type StatusType =
  | 'confusion'
  | 'rampage'
  | 'cowardice'
  | 'hesitation'
  | 'evasion'
  | 'combo'
  | 'attack_buff'
  | 'defense_buff'
  | 'strategy_buff'
  | 'speed_buff'
  | 'damage_reduce'
  | 'damage_boost'
  | 'trigger_boost'
  | 'insight'
  | 'siege'
  | 'sorcery'
  | 'burning'
  | 'panic'
  | 'curse'
  | 'ignite'
  | 'split'
  | 'jump_prep'
  | 'taunt'
  | 'counter'
  | 'cover'
  | 'first_aid'
  | 'rest'
  | 'morale_boost'
  | 'ignore_def';

/** DoT（妖术/燃烧/恐慌）挂上时冻结的每次伤害（滞后触发）：
 *  伤害在「挂上时」结算并冻结——按当时的增伤合计（造成侧 + 受到侧）、施法者兵力、
 *  目标防御/谋略、减伤预先计算；之后每次行动触发直接打出该值（仅按目标当前兵力截断）。
 *  无此字段（直接 inflictStatus 且施法者不可解析的单元测试）时，回退为行动时实时结算。 */
export interface DotStoredDamage {
  /** 每次跳伤（挂上时结算，含增伤/减伤），滞后触发时直接打出 */
  damage: number;
  breakdown: DamageBreakdown;
  /** 挂上时的增减伤归因（caused/taken/reduce，含兵种克制减伤，供战报「增减伤统计」） */
  modifiers: DamageModifiers;
}

/** 武将身上的状态（buff/debuff）。
 *  叠层属性 buff（持节镇西）：每层各自计 remaining（回合结束掉 1 层），数值 = stacks × perStack
 *  appliedRound：施加时的回合号。0 = 准备阶段（行动前施加，remaining=duration+1，回合末递减，「前N回合」生效至第N+1回合行动前）；
 *                >0 = 该回合行动中施加（remaining=duration，该单位下次行动开始前递减，若中途再次施加同标签则刷新/冲突） */
export type Status =
  | { type: 'confusion'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'rampage'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; pendingNextAct?: boolean }
  | { type: 'cowardice'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'hesitation'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'evasion'; stacks: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'combo'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'attack_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'defense_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'strategy_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'speed_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'damage_reduce'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 当前剩余份数（谋议宏图 8→7→…）；无此字段则不按 1/8 衰减 */ eighths?: number; /** 8/8 时的满额减伤率，衰减时 rate = baseRate × eighths/8 */ baseRate?: number; /** 受击剩余份数（疮痍累身 12→11→…）；无此字段则不按受击衰减 */ fifths?: number; /** 受击份数初始值（疮痍累身 12） */ fifthsBase?: number; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy' }
  | { type: 'damage_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; direction: 'caused' | 'taken'; sourceUnitId?: string; /** 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）；无上限时不设置 */ stacks?: number; /** 次数型下一次攻击（青丘媚祸） */ charges?: number; /** 当前剩余份数（恃强淬锋 5→4→…）；无此字段则不按 1/5 衰减 */ fifths?: number; /** fifths 满额时的 rate，衰减时 rate = baseRate × fifths / 初始份数 */ baseRate?: number; /** decayFifths 挂上时的满额份数（恃强 5），衰减公式分母 */ fifthsBase?: number; /** 当前剩余份数（虎豹督军 8→7→…，每回合前 −1；与 fifths 互斥） */ eighths?: number; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy' }
  | { type: 'trigger_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; skillTypes?: SkillType[]; additive?: boolean }
  | { type: 'insight'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'siege'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'sorcery'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
  | { type: 'burning'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
  | { type: 'panic'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
  /**
   * 妖术诅咒（密谋定蜀）：携带者「试图发动追击战法」时（进入追击判定，无论发动率结果），
   * 立即受到一次妖术诅咒伤害（rate% 受谋略，挂上时冻结 stored 滞后触发，同 DoT），
   * 每次判定追击都触发、不消耗；持续 remaining 回合（密谋定蜀 2 回合）。
   */
  | { type: 'curse'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
  /**
   * 引燃标记（火势风威）：携带者「受到下一次伤害」时，额外引发一次燃烧伤害
   * （rate% 受谋略，挂上时冻结 stored 滞后触发，同 DoT），随后标记移除（一次性）。
   * 未触发时持续到战斗结束（remaining 缺省 999）。
   */
  | { type: 'ignite'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
  | { type: 'split'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; /** 次数型分兵（鱼鳞）：有值时按攻击输出次数消耗，不按回合递减 */ charges?: number; /** 受谋略缩放（鱼鳞） */ strategyScaled?: boolean }
  | { type: 'jump_prep'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'taunt'; remaining: number; targetId: string; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'counter'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'cover'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  /**
   * 持续型急救（皇裔流离/金匮要略）：受击时按几率触发恢复。
   *  - remaining：持续回合计数——缺省 Infinity（整场战斗常驻，皇裔流离）；金匮要略 remaining=3（前 3 回合，回合末递减移除）
   *  - 触发率与计数按「战法级」共享：ctx.firstAidCounters（全队总生效次数每达到 triggerUpEvery 次 +triggerUpIncrement）
   *  - 恢复率 = roundRate(scaledValue(healRate, healGrowthRate, 施法者生效谋略))（挂上时冻结）
   *  - 恢复值 = floor(round(300×施法者挂上时兵力/(3500+兵力)) × 恢复率/100 × (1+恢复提高))（healTroops 挂上时冻结）
   *  - 冲突：同为指挥战法的持续型急救互斥（先施加者生效）；不同战法类型（被动/主动）各自共存
   */
  | { type: 'first_aid'; remaining: number; healRate: number; healGrowthRate: number; triggerUpEvery: number; triggerUpIncrement: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId: string; healTroops?: number }
  /**
   * 休整：每回合行动时按 healAmount 恢复（挂上时冻结）。
   * remaining = 剩余跳次数（只在跳恢复时递减，不走回合末/行动开始递减）。
   * startRound：当前回合 < 此值则本行动不跳。
   */
  | { type: 'rest'; remaining: number; healAmount: number; startRound: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'morale_boost'; amount: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'ignore_def'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string };

export interface UnitState {
  readonly general: General;
  side: Side;
  /** 当前兵力 */
  troops: number;
  /** 伤兵池：损失兵力中未死亡、可被恢复的部分（恢复只能消耗伤兵池，跨回合累计） */
  wounded: number;
  /** 累计死亡兵力（按受伤量 × 当回合死亡率结算，永久损失、不可恢复） */
  totalDead: number;
  alive: boolean;
  /** 身上状态（混乱/怯战/规避） */
  statuses: Status[];
  /** 是否处于准备阶段（1 回合准备战法） */
  isPreparing: boolean;
  /** 正在准备的战法 id */
  preparingSkillId: string | null;
  /** 本回合是否已行动完毕（缓师徐持「已行动的敌军」）。回合开始清 false，unit_act_end 置 true */
  hasActedThisRound?: boolean;
  /** 剩余准备行动次数。缺省 null / 未设 = 非准备。进入准备时 = prepareTurns??1 */
  prepareLeft?: number | null;
  /** 本回合是否已有一次主动战法实际释放成功。回合开始清 false */
  firstActiveSucceededThisRound?: boolean;
  /**
   * 部队加成合计点数（阵营/称号/兵种，准备阶段阵容步写入）。
   * 缺省视为四维 0；不走状态冲突。
   */
  formationBonus?: FormationBonus;
}

// ─── 战报事件类型 ───

export type BattleEvent =
  | { type: 'battle_start'; turnOrder: string[]; seed: number }
  | { type: 'prep_phase'; phase: 'formation' | 'troop' | 'skill' }
  | {
      type: 'formation_bonus';
      unitId: string;
      unitName: string;
      category: 'faction' | 'title' | 'troop';
      titleName?: string;
      bonuses: FormationBonus;
    }
  | { type: 'preparation_end' }
  | { type: 'round_start'; round: number; turnOrder?: string[] }
  | { type: 'unit_act_start'; unitId: string; name: string; position: Position; phase: string }
  | {
      type: 'skill_trigger';
      unitId: string;
      skillId: string;
      skillName: string;
      success: boolean;
      /** 被判定目标（缺省 = unitId 施法者自身判定；actLayer 速度对比 / roundRepeat 预备负面为目标行动时判定） */
      targetId?: string;
      /** 当前生效几率（%，含士气修正），如 78 = 78%（= 70% × 士气系数 1.12）。仅带发动率属性的判定携带 */
      rate?: number;
      /** 基础生效几率（%，士气修正前），如 70 */
      baseRate?: number;
      /** 判定方士气（施法者士气），如 120 */
      morale?: number;
    }
  /**
   * 援护代受（移花接木 / 疮痍累身）：unitId 为友军 targetId 抵挡了一次普通攻击。
   * 官方口径「为其抵挡普通攻击」——仅普攻转移，战法伤害不转移。
   */
  | {
      type: 'cover';
      unitId: string;
      targetId: string;
      skillId?: string;
    }
  | {
      type: 'skill_cast';
      unitId: string;
      skillId: string;
      skillName: string;
    }
  | {
      type: 'skill_target';
      unitId: string;
      skillId: string;
      targetIds: string[];
    }
  | {
      type: 'damage';
      sourceId: string;
      /** 杀伤统计归属单位（指挥队友攻击：奇兵拒北借速度最高友军打伤害，杀伤计入施法者战法）。
       *  缺省 = sourceId（实际造成伤害者）。 */
      creditToId?: string;
      targetId: string;
      skillId: string;
      skillName: string;
      damageType: DamageType;
      damage: number;
      breakdown: DamageBreakdown;
      /** 本次伤害的增减伤归因（神兵天降/大赏三军/减伤/兵种克制），无增减伤时为 undefined */
      modifiers?: DamageModifiers;
      /** 一类指挥 delayedOutput：预存伤害在 atRound 打出（白衣渡江/西乡武功）。详情用官方「效果使…损失兵力」口径 */
      delayedEffect?: boolean;
      /** delayedEffect 时：本次扣兵后的剩余兵力（官方括号内数字） */
      afterTroops?: number;
    }
  | {
      /** 一类指挥预存伤害打出后，目标身上该次策略/攻击伤害效果消失（官方第二行） */
      type: 'stored_effect_expired';
      unitId: string;
      sourceId: string;
      skillId: string;
      skillName: string;
      damageType: DamageType;
    }
  | {
      type: 'attack_hit';
      sourceId: string;
      targetId: string;
      distance: number;
      damage: number;
      breakdown: DamageBreakdown;
      /** 本次伤害的增减伤归因（神兵天降/大赏三军/减伤/兵种克制），无增减伤时为 undefined */
      modifiers?: DamageModifiers;
    }
  | {
      type: 'no_attack_target';
      unitId: string;
      name: string;
      reason: string;
    }
  | {
      type: 'status_inflicted';
      unitId: string;
      statusType: StatusType;
      detail: string;
    }
  /** 已有状态被就地改动（疮痍累身受击后减伤按 1/12 递减）：官方战报「【周泰】的受到攻击伤害降低效果下降了」 */
  | {
      type: 'status_changed';
      unitId: string;
      statusType: StatusType;
      detail: string;
    }
  /** 战法效果执行行（疮痍累身受击触发）：官方战报「【周泰】执行来自【周泰】的【疮痍累身】效果！」 */
  | {
      type: 'skill_exec';
      unitId: string;
      detail: string;
    }
  | {
      type: 'status_conflict';
      unitId: string;
      statusType: StatusType;
      sourceSkillType: SkillType;
      detail: string;
    }
  | {
      type: 'status_expired';
      unitId: string;
      statusType: StatusType;
    }
  | {
      type: 'heal';
      sourceId: string;
      targetId: string;
      skillId: string;
      skillName: string;
      amount: number;
      before: number;
      after: number;
    }
  | {
      type: 'evasion_blocked';
      unitId: string;
      sourceId: string;
      remainingStacks: number;
    }
  | {
      type: 'prepare_start';
      unitId: string;
      skillId: string;
      skillName: string;
    }
  | {
      type: 'prepare_skip';
      unitId: string;
      skillId: string;
      skillName: string;
    }
  | {
      type: 'prepare_end';
      unitId: string;
      skillId: string;
      skillName: string;
      success: boolean;
      reason?: string;
    }
  | { type: 'unit_act_end'; unitId: string }
  | { type: 'unit_dead'; unitId: string; name: string; side: Side }
  | {
      type: 'dot_tick';
      sourceId: string;
      targetId: string;
      dotType: 'sorcery' | 'burning' | 'panic' | 'curse' | 'ignite';
      /** 来源战法（DoT 伤害计入该战法杀伤统计） */
      skillId: string;
      /** 施法者（DoT 伤害归属） */
      casterId: string;
      damage: number;
      breakdown: DamageBreakdown;
      /** 本次伤害的增减伤归因（DoT 为挂上时冻结的归因：含增伤/减伤/兵种克制，滞后触发） */
      modifiers?: DamageModifiers;
    }
  | { type: 'siege_blocked'; unitId: string; skillId: string }
  | { type: 'insight_blocked'; unitId: string; statusType: StatusType }
  | {
      type: 'split_damage';
      sourceId: string;
      targetId: string;
      damage: number;
      breakdown: DamageBreakdown;
      /** 本次伤害的增减伤归因（神兵天降/大赏三军/减伤/兵种克制），无增减伤时为 undefined */
      modifiers?: DamageModifiers;
    }
  | {
      type: 'round_end';
      round: number;
      myTroops: number[];
      enemyTroops: number[];
      /** 各武将伤兵池（与 myTroops 同序；兵力条浅色段：可被恢复的损失） */
      myWounded: number[];
      enemyWounded: number[];
      /** 各武将累计死亡兵力（与 myTroops 同序；兵力条灰色段：永久损失、不可恢复） */
      myDead: number[];
      enemyDead: number[];
    }
  | {
      type: 'battle_end';
      result: 'win' | 'loss' | 'draw';
      rounds: number;
      myTroops: number[];
      enemyTroops: number[];
    };

/** 三部分伤害拆解 */
export interface DamageBreakdown {
  /** 兵力基础伤害 */
  troopBase: number;
  /** 攻击/谋略基础伤害 */
  base: number;
  /** 主要伤害 */
  main: number;
}

/** 单次伤害的增减伤来源条目（战报「增减伤统计」用） */
export interface DamageModifierSource {
  /** 施加者（战法施法者）单位 id */
  unitId: string;
  /** 来源战法 id */
  skillId: string;
  /** 来源战法名 */
  skillName: string;
  /** 增减伤数值（小数，如 0.76 = 76%） */
  rate: number;
  /** 'caused'=攻击方造成伤害提高（大赏三军）；'taken'=受击方受到伤害提高（神兵天降）；'reduce'=受击方减伤（步步为营） */
  direction: 'caused' | 'taken' | 'reduce';
}

/** 单次伤害的增减伤归因：伤害提升 = caused + taken；伤害降低 = reduce */
export interface DamageModifiers {
  caused: DamageModifierSource[];
  taken: DamageModifierSource[];
  reduce: DamageModifierSource[];
}

/** 战斗统计条目（由事件流汇总） */
export interface UnitStats {
  unitId: string;
  name: string;
  side: Side;
  /** 普通攻击命中次数 */
  attackCount: number;
  /** 普通攻击造成的总伤害 */
  attackDamage: number;
  /** 战法（含追击/准备）释放命中次数 */
  skillCount: number;
  /** 战法造成的总伤害 */
  skillDamage: number;
  /** 回复触发次数（heal 事件计数，归属施法者：持续型急救等恢复战法按此统计，而非战法释放次数/杀伤） */
  healCount: number;
  /** 回复兵力总量（heal 事件 amount 求和） */
  healAmount: number;
}

export interface BattleReport {
  schemaVersion: string;
  seed: number;
  maxRounds: number;
  result: 'win' | 'loss' | 'draw';
  rounds: number;
  myTeam: General[];
  enemyTeam: General[];
  finalMyTroops: number[];
  finalEnemyTroops: number[];
  /** 各武将最终伤兵池（与 finalMyTroops 同序） */
  finalMyWounded: number[];
  finalEnemyWounded: number[];
  /** 各武将最终累计死亡兵力（与 finalMyTroops 同序） */
  finalMyDead: number[];
  finalEnemyDead: number[];
  events: BattleEvent[];
  /** 战斗统计：每个武将的普攻/战法次数与伤害 */
  stats: UnitStats[];
}
