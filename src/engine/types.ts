/**
 * 战斗引擎类型定义
 * v0.2：Skill 联合类型（主动/准备/追击）+ 状态系统（混乱/怯战/规避）
 * 全部为纯数据，无任何 UI 依赖。
 */

export type TroopType = 'cavalry' | 'infantry' | 'archer';

export type Position = '大营' | '中军' | '前锋';

export type SkillType = 'passive' | 'command' | 'active' | 'pursuit';

/**
 * 目标模式：`random_single` = 距离内均匀随机（率土「敌军/友军单体」口径）；
 * `nearest` = 距离内**最近**（仅当描述明确写「最近」，如近攻）；
 * `farthest` = 距离内**最远**（远射 / 连环段1）；
 * `single` = 旧「最近优先」模式，已退役、登记表不得再出现（tests/listing.test.ts 把关）。
 */
export type TargetMode = 'single' | 'random_single' | 'group' | 'all' | 'self' | 'farthest' | 'nearest';

export type DamageType = 'physical' | 'strategy';

/**
 * 伤害段选敌覆盖（`physical_damage` / `strategy_damage`）：
 * - `'lowest_defense'`：当前存活敌军中防御属性最低者（**无视距离**，四世三公「对敌军防御最低单体」）；
 * - `'lowest_defense_in_range'` / `'lowest_strategy_in_range'`：只在**本段有效距离内**取防御 / 谋略最低者
 *   （兼弱攻昧「对敌军防御属性最低的武将发动一次攻击，同时对敌军谋略属性最低的武将发动一次策略攻击」
 *    —— 用户确认：按战法有效距离内选人，取**生效属性**最低）。
 * 设置后覆盖本段 targetMode 的目标池，只结算这 1 个目标。
 */
export type DamageTargetPick =
  | 'lowest_defense'
  | 'lowest_defense_in_range'
  | 'lowest_strategy_in_range'
  /** 战法有效距离内**当前兵力最低**的存活敌军（知人待士「对敌军兵力最低单体发动一次策略攻击」） */
  | 'lowest_troops_in_range';

/** DoT 类型（妖术 / 燃烧 / 恐慌 / 妖术诅咒 / 引燃）——「被施加的 DoT 伤害提升」按此维度过滤 */
export type DotType = 'sorcery' | 'burning' | 'panic' | 'curse' | 'ignite';

/**
 * 兵力阈值条件（troopRatio）：按「当前兵力 / 初始兵力（maxTroops）× 100」判定。
 *  - below：兵力百分比**低于**此值才满足（持玺兴兵「若其兵力低于初始兵力的 50%」）
 *  - above：**高于**此值才满足（巧音唤蝶「当目标兵力高于初始兵力 50% 时」）
 * 两者同时给出时须同时满足。段级用于一次性输出（heal / strategy_damage），
 * 状态级用于持续效果（燃烧 DoT / 休整跳恢复）——见 action.ts troopRatioMatches。
 */
export type TroopRatioCond = { below?: number; above?: number };

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
  | 'cowardice_immune' // 免疫怯战（魏武之泽：我军群体免疫怯战）
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
  | 'ignore_def' // 无视防御：攻击时目标防御 × (1 − rate)，作用于攻防差（击势）
  | 'range_buff' // 攻击距离提高：普攻可达的敌军距离上限 +amount（帝临回光）
  | 'skill_range_buff' // 战法有效距离提高：战法选目标的距离上限 +amount（合纵连横「我军全体战法距离+1」）
  | 'retaliate' // 受击追加攻击标记（忠克猛烈）：携带者受攻击伤害时施法者追加 1 次攻击，最多 N 次
  | 'trigger_boost' // 发动率提高（登锋陷阵「攻击类主动战法发动率提高 120%」）
  | 'counter'; // 反击：携带者受普通攻击实际扣兵后对来源反击（反击之策 / 人公将军）

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
       * 段级按阵营过滤**本战法整体（锁定）目标**（率尔方雅）：
       * 只结算锁定目标中与施法者**同侧**（'ally'）/ **对侧**（'enemy'）/ **自身**（'self'）者，
       * 不重选池、不按战法距离重新抽取。用于「同一批随机目标按阵营分派不同效果」——
       * 先由 `BaseSkill.targetPool:'mixed'` 抽出 N 个敌我混合目标，再各段按锁定目标分阵营。
       */
      lockedSide?: 'ally' | 'enemy' | 'self';
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
      attacker?: 'lowest_strategy_ally' | 'recipient' | 'highest_attack_ally';
      /**
       * 代打者结算后按**代打者自身当前兵力**恢复（西陵克晋「并各自恢复一定兵力」）：
       * 立即型急救（非状态，与恢复类战法不冲突），恢复量 = calcHealAmount(代打者当前兵力, rate)。
       * 官方口径：恢复量与任何属性无关、仅由执行时自身兵力决定。
       */
      healSource?: { rate: number };
      /**
       * 代打者挑选（配合 `attacker:'recipient'`）：`'highest_attack'` = 只取**我军攻击属性最高**的单体作为代打者
       * （四世三公「额外使我军攻击属性最高单体…发动一次攻击」）；缺省 = 池内每名友军各打一次。
       */
      attackerPick?: 'highest_attack';
      /**
       * 选敌覆盖（见 `DamageTargetPick`）：`'lowest_defense'` = 取当前存活敌军中**防御属性最低**的单体
       * （**无视距离**，四世三公「对敌军防御最低单体发动一次攻击」）；`'*_in_range'` = 战法有效距离内最低。
       * 缺省按 targetMode + 战法距离选。
       */
      targetPick?: DamageTargetPick;
      /**
       * 站位定向（万军取首「额外对敌方大营再发动一次猛烈攻击」）：设置后**直接取该站位的存活敌军**，
       * 不按 targetMode 重选（与 inflict_status.positions 同口径，但用于伤害段）。缺省 undefined = 不限制。
       */
      positions?: Position[];
      /**
       * 代打伤害按代打者自身属性孰高定轨（徽言龙凤「每回合行动时有 60% 几率对随机敌军单体造成 1 次
       * 攻击伤害（伤害率 150%）或策略攻击伤害（伤害率 120%），由攻击或谋略属性中较高的属性决定」）：
       * 设置后**忽略 `rate`**，逐代打者判断其生效攻击 > 生效谋略 → 用 attackRate（攻击伤害），
       * 否则用 strategyRate（策略伤害）；配合 `attacker:'recipient'` + `chance`（逐代打者各判一次）。
       */
      recipientDamageByHigherStat?: { attackRate: number; strategyRate: number };
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
      /**
       * 仅**首次 repeats 攻击**无视规避（华雄「首次攻击造成的伤害无视规避」）：
       * 第 1 次攻击不判定/不消耗目标规避，第 2 次起照常判定（与整段 `ignoresEvasion` 区分）。
       */
      ignoresEvasionFirstRepeat?: boolean;
      /** 每次 repeats 递增的伤害率（百分点）：第 i 次（i 从 0 起）= rate + i × ratePerRepeat（银龙孤胆 7 次 80→87→…→122）。缺省 0 = 不递增 */
      ratePerRepeat?: number;
      /** 独立发动率（先声夺人第三段 60%）；士气修正后判定，与 inflict_status.chance 同口径 */
      chance?: number;
      /**
       * 按**施法者自身兵力比例**替换本段伤害率（亡命一搏「当自身兵力低于初始兵力 25% 时，伤害率变为 460%」）：
       * 施法者当前兵力 / 初始兵力满足 `cond` 时用 `rate`，否则用本段 `rate`。
       */
      rateBySelfTroopRatio?: { cond: TroopRatioCond; rate: number };
      /**
       * 本段打出后连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气 `moraleTriggerRate(p)`，
       * 成功则在战法距离内独立 `random_single` 再打同一段（循环驱动，递归调用时去掉 chain），然后 `p -= decay`。
       */
      chain?: { chance: number; decay: number; /** 连锁重打**同一目标**（乘胜追击「对攻击目标再次发动攻击」）；缺省按战法距离随机单体 */ sameTarget?: boolean };
      /** 为 true 时本次结算不加算兵种克制 −30% */
      ignoresTroopCounter?: boolean;
      /**
       * 无视目标防御属性（忠克猛烈「本战法造成的伤害无视目标的防御属性」）：
       * 为 true 时本段攻击伤害的目标防御按 0 计算（等价 ignore_def 100%）。
       */
      ignoresDefense?: boolean;
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
      /**
       * 按 DoT（燃烧/妖术）公式结算但**立即触发**（火积「立即受到燃烧伤害」）：
       * 兵力基础 ×1/3、谋略基础 ×0.25；同时以 `dotType:'burning'` 参与
       * 「被施加的燃烧/恐慌伤害提升」（全主诿异 dotTypes）等过滤。
       */
      dotFormula?: boolean;
      /** strategyScaled 且 growthRate === undefined 时不缩放、用基值 */
      growthRate?: number;
      ignoresEvasion?: boolean;
      target?: 'self';
      targetMode?: 'single' | 'random_single' | 'group' | 'all';
      groupCount?: number | [number, number];
      /**
       * 独立发动率（运筹决胜策略攻击 50%），缺省必中。
       * 支持：被动 / 主动 / 指挥（非 `before_active`）在输出执行处逐段判定（士气修正，失败跳过本段）；
       * `roundTrigger:'before_active'` 的二类指挥走 `triggerBeforeActiveCommands` 逐段判定。
       */
      chance?: number;
      /** 仅对带这些状态之一的目标生效（运筹决胜：混乱 / 暴走） */
      requireStatuses?: StatusType[];
      /**
       * 本段打出后连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气 `moraleTriggerRate(p)`，
       * 成功则在战法距离内独立 `random_single` 再打同一段（循环驱动，递归调用时去掉 chain），然后 `p -= decay`。
       */
      chain?: { chance: number; decay: number; /** 连锁重打**同一目标**（乘胜追击「对攻击目标再次发动攻击」）；缺省按战法距离随机单体 */ sameTarget?: boolean };
      /**
       * 本段选敌距离（不攻每回合策略 5）。缺省 `skill.range`。
       * 与 physical_damage.range 同口径。
       */
      range?: number;
      /** 选目标时无视战法距离（对称 physical_damage.ignoreRange） */
      ignoreRange?: boolean;
      /**
       * 选敌覆盖（见 `DamageTargetPick`）：兼弱攻昧「对敌军谋略属性最低的武将发动一次策略攻击」
       * —— `'lowest_strategy_in_range'` 在战法有效距离内取生效谋略最低者（用户确认口径）。
       */
      targetPick?: DamageTargetPick;
      /**
       * 站位定向（万军取首「额外对敌方大营再发动一次猛烈攻击」）：设置后**直接取该站位的存活敌军**，
       * 不按 targetMode 重选（与 inflict_status.positions 同口径，但用于伤害段）。缺省 undefined = 不限制。
       */
      positions?: Position[];
      /** 兵力阈值条件：不满足的目标不结算本段（持玺兴兵「兵力低于 50% 才恢复」） */
      troopRatio?: TroopRatioCond;
      /**
       * 仅对**生效谋略低于施法者**的目标结算（潜谋远计「对谋略低于自身的敌军全体」）：
       * 按 `effectiveStat(target,'strategy') < effectiveStat(caster,'strategy')` 逐目标过滤。
       */
      requireTargetStrategyBelowSelf?: boolean;
      /**
       * 代打者：`'highest_strategy_ally'` = 由我**当前谋略属性最高**的存活武将出手结算本段
       * （西陵克晋「我军当前谋略属性最高的武将对距离 4 以内的敌军发动一次策略攻击」；
       * 含施法者自身，官方「也有可能施加给陆抗自己」）。缺省 = 施法者自身（statSource 口径不变）。
       * `'recipient'` = **本战法锁定的每名友军各自出手一次**（守静却敌「使我军全体对随机敌军单体造成
       * 一次策略伤害」，每名武将按**自身**属性/增减伤结算、目标逐人独立重选；不耗行动、不受混乱）。
       */
      attacker?: 'highest_strategy_ally' | 'recipient';
      /** 代打者结算后按**代打者自身当前兵力**恢复（西陵克晋「并各自恢复一定兵力」），同 physical_damage.healSource */
      healSource?: { rate: number };
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
      kind: 'detonate_sorcery_marks';
      /**
       * 引爆「受击触发妖术」剩余次数（破凰「立即引发敌军全体由破凰带来的剩余妖术效果」）：
       * 遍历**敌军全体**，把由本战法施加的受击触发妖术（sorcery + onHurt）的剩余 charges 次
       * 逐次立即打出（挂上时冻结值），随后移除该状态；目标无存量则本段跳过（首次发动空转，
       * 由后续段施加新的条件妖术）。
       */
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
      /** 输出级 group 目标数（仅 targetMode:'group'，缺省 2）——巧音唤蝶「我军群体」 */
      groupCount?: number | [number, number];
      /** 从友军池排除施法者（「自身 + 友军单体」的友军段：奇佐鬼谋 / 黄天余音） */
      excludeSelf?: boolean;
      /**
       * 只对**非施法者阵营**的目标结算（合纵连横「对非自身阵营的武将普通攻击后…使目标陷入围困」）：
       * 目标与施法者**阵营相同则跳过本段**（按 `General.faction` 比较）。
       */
      targetFactionNotSelf?: boolean;
      /** 只对指定性别的目标结算（辞后定朝：男性 / 女性武将各自一段）；无性别数据的单位不匹配 */
      requireGender?: 'male' | 'female';
      /**
       * 只对指定站位的目标结算（美人计「大营造成的所有伤害提升 14%」：仅大营段）：
       * 目标站位不在此列表内则跳过本段。
       */
      requirePositions?: Position[];
      /**
       * 段级按阵营过滤**本战法整体（锁定）目标**（率尔方雅）：
       * 只结算锁定目标中与施法者**同侧**（'ally'）/ **对侧**（'enemy'）/ **自身**（'self'）者，
       * 不重选池、不按战法距离重新抽取（与 `targetSide` 的「重选池」语义不同）。
       */
      lockedSide?: 'ally' | 'enemy' | 'self';
      /**
       * status 为数组时：true = 对同一目标施加全部状态（黄天余音友军四维）；
       * 缺省仍随机选 1 个（奇佐鬼谋控制）。
       */
      applyAll?: boolean;
      /**
       * 独立发动率（运筹决胜暴走 30%；望风而降「50% 几率使其陷入恐慌」），缺省必中。
       * 支持：被动 / 主动 / 指挥（非 `before_active`）在输出执行处逐段判定（士气修正，失败跳过本段）；
       * `roundTrigger:'before_active'` 的二类指挥走 `triggerBeforeActiveCommands` 逐段判定。
       */
      chance?: number;
      /**
       * 段级「随回合递增/递减几率」覆盖（统军畏慎：两段各自 80%−10%/回合 与 30%+10%/回合）：
       * 未显式给 `chance` 时优先用本字段，缺省退回战法级 `roundRampingChance`；结果 clamp 到 0~1。
       */
      roundRampingChance?: { base: number; increment: number };
      /**
       * 按目标「攻击 vs 谋略」孰高在两条状态模板中二选一（统军畏慎「武将获得伤害提高效果与
       * 无视目标属性效果的类型由自身攻击与谋略中较高的属性决定」）：目标**攻击 > 谋略**用 `attack`，
       * 否则（谋略 ≥ 攻击）用 `strategy`；按**生效属性**逐目标比较。给本字段时不看 `status`。
       */
      byHigherStatStatus?: { attack: CreateStatus; strategy: CreateStatus };
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
      /**
       * 沿用**上一段伤害输出**的实际命中目标（三军夺帅「并使目标谋略属性降低 5」；地公将军「吸取其属性」）：
       * 为 true 时不再按本段 targetSide/targetMode 重选，直接取本战法上一段伤害的命中集
       * （见 action.executeSkillOutputs 的 lastDamageTargetIds）。
       */
      sameTargetsAsLastDamage?: boolean;
      /**
       * 仅对「**攻击距离外**」的敌军结算（雪奋短兵「使攻击距离外的敌军群体进入动摇状态」）：
       * 为 true 时忽略本段 targetSide/targetMode，池 = 存活敌军中 `distanceBetween(施法者, 目标) >
       * attackRangeOf(施法者)` 者（与普攻可达范围同一口径，含 range_buff 递减）。攻击距离内的目标不吃。
       */
      targetOutsideAttackRange?: boolean;
      /**
       * 本段友军目标选取覆盖（缚父临危 / 举抑臧否）：
       *  - `'highest_attack_ally'` = 我军当前**攻击属性最高**单体（含施法者自身，「自身及友军攻击属性最高的单体」）；
       *  - `'ally_named'` = 按武将名匹配（配合 `targetPickName`，如「吕布」——同名多张卡都算，用户确认）；
       *  - `'highest_{attack|defense|strategy}_ally'` = 我军该属性**最高**单体（含施法者自身）；
       *  - `'lowest_{attack|defense|strategy}_enemy'` = 敌军该属性**最低**单体（**无视距离**）。
       *    （举抑臧否「该属性最低的敌军单体对应属性降低…该属性最高的友军单体对应属性提升…」）
       * 设置后覆盖本段 targetSide / targetMode 的目标池；按**生效属性**（effectiveStat）比较。
       */
      targetPick?:
        | 'highest_attack_ally'
        | 'ally_named'
        /** 我军（**自身 + 友军全体**）攻击属性**最低**单体（张昭 竭忠尽智「自身与友军攻击属性最低的
         *  武将下一次行动时进入怯战状态」——可能选中施法者自己；含施法者，**推定**）。 */
        | 'lowest_attack_ally'
        | 'highest_defense_ally'
        | 'highest_strategy_ally'
        | 'lowest_attack_enemy'
        | 'lowest_defense_enemy'
        | 'lowest_strategy_enemy'
        /** 敌军**当前兵力最多**的单体（始计「敌方兵力最多单体下一次攻击或策略攻击的伤害降低 30%」），无视距离 */
        | 'highest_troops_enemy';
      /** `targetPick:'ally_named'` 时的武将名（如 '吕布'） */
      targetPickName?: string;
      /**
       * 整段开关：仅当**上一段伤害输出的命中目标**中存在带这些状态之一者才结算本段
       * （地公将军「若有目标存在妖术效果，则额外附加属性至自身」；sorcery = 妖术 / curse = 妖术诅咒）。
       * 与 `requireStatuses`（逐目标过滤伤害段）不同：这里是整段结算与否的门槛。
       */
      requireAnyPrevDamageTargetStatus?: StatusType[];
    }
  | { kind: 'remove_debuffs'; target?: 'self'; troopTypes?: TroopType[] }
  /**
   * 移除目标的**有益**状态（看破 / 索敌 / 驱逐 / 火积「移除其有益效果」）：
   * 判定走 `isBeneficialStatus`（属性 buff 看 amount 正负、增减伤看 direction 正负…），
   * 并按**来源优先级**过滤（用户 2026-09-19 口径）：被动 > 指挥 > 主动 = 追击——
   * 施法战法只能移除「来源战法类型优先级 ≤ 自身」的有益状态。
   * 例：火积（追击）无法移除大赏三军（指挥）的增伤，只能清主动/追击带来的规避、属性提升等。
   */
  | { kind: 'remove_buffs'; target?: 'self' }
  /**
   * 援护友军单体（援护 D）：把 `cover` 挂在**施法者自身**（保护者），`protectId` 记录被保护的友军——
   * 只有该友军受普攻时由施法者代受（「援护友军全体」不填 protectId，走既有 `inflict_status` cover 口径）。
   * 被保护友军由本输出在战法有效距离内随机选（不含施法者自身）。
   */
  | { kind: 'grant_cover'; duration: number }
  /**
   * 「下一次**造成伤害后**再受到一次策略伤害」标记（翕处还张「使敌军群体 1-2 目标下一次造成伤害后，
   * 再受到一次策略伤害（165%，受谋略）」）：对标记目标的**下一次造成伤害**（实际扣兵 > 0，任意来源）
   * 结算一次策略伤害（由本战法施法者打出，伤害按**触发时**双方生效属性/增减伤实时计算），随后标记消耗。
   * 目标另选（`groupCount` 缺省 2，可 `[1,2]` 随机 1~2 个），与主段攻击目标独立。
   */
  | { kind: 'mark_deal_punish'; rate: number; strategyScaled?: boolean; growthRate?: number; groupCount?: number | [number, number] }
  /**
   * 「在目标**下一次行动前**」结算（道行险阻「同时在目标下一次行动前对其发动一次策略攻击和一次攻击」）：
   * 把后续 `output` 排入 `ctx.pendingStrikes` 延迟队列，目标下次行动**开始前**（行动阶段之前）
   * 由**原施法者**对其结算这些段；目标或施法者已阵亡则跳过。
   */
  | { kind: 'schedule_strike'; output: SkillOutput[] }
  /**
   * 移除目标身上**由指定来源战法类型施加**的状态（辞后定朝「移除自身受到的由指挥、主动、追击战法
   * 带来的有害和有益效果」）：有害与有益都移除、被动/战法自带（准备阶段）的不动；逐条记 status_expired。
   */
  | {
      kind: 'remove_by_source_skill_type';
      /** 只移除这些来源战法类型施加的状态（指挥 / 主动 / 追击 / 被动） */
      skillTypes: SkillType[];
      target?: 'self';
      /**
       * 只移除**有害**状态（垒实迎击「移除自身由主动及追击战法带来的负面效果」）。
       * 缺省 false = 有害 + 有益都移除（辞后定朝口径）。
       */
      debuffsOnly?: boolean;
    }
  | { kind: 'grant_evasion'; stacks: number; target?: 'self' }
  | {
      kind: 'heal';
      rate: number;
      strategyScaled: boolean;
      growthRate: number;
      /** 受防御缩放（胜敌益强「恢复率受防御属性影响」）；growthRate 缺省时不缩放、用基值 */
      defenseScaled?: boolean;
      target?: 'self';
      /**
       * 单输出目标池覆盖：缺省沿用战法整体目标。
       * 合流/利兵谋胜用 ally 另选友军；三军之众每次独立重选我军单体。
       */
      targetSide?: 'enemy' | 'ally' | 'self';
      /** 配合 targetSide 重选目标；random_single = 距离内均匀随机（三军之众每次独立判定） */
      targetMode?: 'single' | 'random_single' | 'group' | 'all';
      /** 输出级 group 目标数（仅 targetMode:'group'，缺省 2）——巧音唤蝶「我军群体」 */
      groupCount?: number | [number, number];
      /** 从友军池排除施法者（「自身及友军单体」的友军段：合流 / 利兵谋胜） */
      excludeSelf?: boolean;
      /** 兵力阈值条件：不满足的目标不结算本段（巧音唤蝶「兵力低于 50% 时恢复 82%」） */
      troopRatio?: TroopRatioCond;
      /**
       * 恢复目标选取覆盖：`'lowest_troops_ally'` = 我军**当前兵力最低**的存活单体
       * （知人待士「我军兵力最低单体恢复一定兵力」，含施法者自身；按当前兵力比较）。
       */
      targetPick?: 'lowest_troops_ally';
      /**
       * 恢复的同时对**同一目标**追加一条状态（知人待士「并使其受到所有伤害减少 15.0%」）：
       * 逐恢复目标在 heal 事件之后施加（走 `inflictStatus`，来源 = 本战法），
       * 因此不受「恢复改变了兵力排序」影响（与「并使其」的同一性语义一致）。
       */
      attachStatus?: CreateStatus;
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
      /** 透传给 damage_boost 的显式「可叠加」标记（未笄难言 −18% 可叠加至战斗结束）；缺省刷新 */
      stack?: true;
    }
  /**
   * 士气分支：按生效士气选 high / low 执行。
   * - `compareTo:'threshold'`（缺省）：生效士气 **> threshold**（缺省 100，即高昂）走 high，
   *   否则（一般/低落）走 low（盛气横凌 / 列营守险 / 胜负先征口径）。
   * - `compareTo:'caster'`：与**施法者**当前生效士气比较——目标士气 **严格低于** 施法者走 low
   *   （描述「若目标士气低于自身」的成立分支），**不低于（含相等）** 走 high
   *   （望风而降 / 激水之疾 / 蓄盈待竭；用户 2026-09-19 确认「低于」= 严格小于）。
   */
  | {
      kind: 'morale_branch';
      /** 高昂阈值，缺省 100（仅 compareTo:'threshold' 使用） */
      threshold?: number;
      /** 比较基准：缺省 'threshold'；'caster' = 与施法者当前生效士气相对比较 */
      compareTo?: 'threshold' | 'caster';
      /** 士气判定对象：缺省 'target'（逐目标按各自士气分支，盛气横凌 / 望风而降 / 激水之疾 / 蓄盈待竭）；
       *  'caster' = 按施法者自身士气**整体判定一次**并对整个目标池执行选中分支
       *  （列营守险「若自身士气高昂时，规避状态的目标变为我军全体」；胜负先征） */
      by?: 'caster' | 'target';
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

/**
 * 状态施加模板。
 *
 * **重复施加口径（用户确认）**：同源（同一战法）重复施加同一数值型效果
 * **默认刷新**——数值替换为本次的 amount / rate（不回加），`remaining = max(旧, 新)`；
 * 只有带**显式叠层标记**的才累加：
 *  - 通用 `stack: true`（属性类 / 减伤 / 士气 / 范围 / 增伤等官方明确写「可叠加」的）；
 *  - `damage_boost` 既有语义：`stacks`（带上限的层数计数，银龙冲阵/攻其不备/文德椒房…）
 *    或 `chargesStack`（七步释嫌：带 charges 仍累加）。
 * 官方未写「可叠加」/「层数」的（如 列营守险 四维增益）不写 stack，走刷新。
 * 控制 / 概率规避等状态类仍走冲突规则（先施加者生效）。
 */
export type CreateStatus =
  | { type: 'confusion'; duration: number | [number, number] }
  | { type: 'rampage'; duration: number; /** 待下次行动才生效（青丘媚祸），避免挂上即控、重复刷新永控 */ pendingNextAct?: boolean }
  | { type: 'cowardice'; duration: number; /** 下一次行动时才生效（张昭 竭忠尽智：以「下一次行动时进入怯战」为代价，避免当次行动即被封普攻） */ pendingNextAct?: boolean }
  | { type: 'hesitation'; duration: number }
  | { type: 'evasion'; stacks: number }
  /** 概率规避（列营守险）：受到下 charges 次伤害时各掷一次 rate，命中则完全免疫该次伤害。
   *  与 evasion 的「层数式必挡」不同：判定失败也消耗 1 次机会。 */
  | { type: 'evade_chance'; rate: number; charges: number; duration: number }
  | { type: 'combo'; duration: number }
  /**
   * 伤害分摊（言出必克 / 雅虑适时）：**携带者**替同侧友军承担一部分受到的伤害——同侧任一符合条件者
   * 受伤时，携带者按 `rate` 立即分担（自身扣兵、受击者少扣），`charges` 为剩余分摊次数（王朗「分摊一次」；
   * 缺省无限）。
   * `scope:'heart_sync'` = 只对**同为该状态携带者**的其它友军生效（雅虑适时 同心）；
   * 缺省 `'all_allies'` = 同侧全体友军（言出必克）。
   * `damageKind` 限定只分摊该类型伤害（王朗 策略）；缺省全部。
   */
  | { type: 'damage_share'; rate: number; duration: number; damageKind?: 'physical' | 'strategy'; charges?: number; scope?: 'heart_sync' | 'all_allies' }
  /**
   * 策略伤害浮动（敛微穷极，刘徽）：携带者造成策略伤害时，伤害率 × 当前浮动系数——系数在
   * `[low, high]`（百分点）内均匀随机，区间随回合线性收敛到 `mid`（`convergeRounds` 回合起恒为 mid）；
   * 上限/中点「受谋略属性影响」→ `strategyScaled + growthRate` 给定时按施法者谋略缩放（未确认 → 基值）。
   */
  | { type: 'strategy_flux'; low: number; high: number; mid: number; convergeRounds: number; duration: number; strategyScaled?: boolean; growthRate?: number }
  /**
   * 避锐（疲兵沮意，XP陆逊）：层数式「受到伤害前消耗 1 层」减伤 —— 携带者每次受到伤害（伤害结算前）
   * 消耗 1 层，令**该次**伤害降低 `perStackRate`（受谋略缩放：strategyScaled + growthRate 给定时按
   * 施法者谋略缩放并冻结，growthRate 缺省 = 基值）；消耗时按 `CommandSkill.avoidOnConsume` 结算附加效果。
   * duration：状态存续回合（整场 = 999）；层数只在受击时消耗，不按回合递减。
   */
  | { type: 'avoid_charge'; stacks: number; perStackRate: number; duration: number; strategyScaled?: boolean; growthRate?: number }
  /** amount 为谋略 80 时的基础值；strategyScaled=true 且给 growthRate 时，实际数值按 scaledValue 缩放。
   *  percent=true 时 amount 为百分比（如 15 = 15%），按目标当前生效属性（含点数增减后）结算。
   *  decayOnDeal：按 N 份「造成伤害」衰减（抚民励德 4）——携带者每次造成伤害（实际扣兵 > 0）后 −1 份。 */
  | { type: 'attack_buff'; amount: number; duration: number; strategyScaled?: boolean; /** 受攻击缩放（道行险阻防御 −50）；growthRate 缺省时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; percent?: boolean; /** 按 N 份「造成伤害」衰减（抚民励德 4）：amount = baseAmount × 剩余份数 / N */ decayOnDeal?: number; /** 显式「可叠加」（官方文案写「可叠加」/「层数」）：同源重复施加时数值累加；缺省刷新 */ stack?: true }
  | { type: 'defense_buff'; amount: number; duration: number; strategyScaled?: boolean; attackScaled?: boolean; growthRate?: number; percent?: boolean; /** 按 N 份「造成伤害」衰减（抚民励德 4） */ decayOnDeal?: number; /** 显式「可叠加」：同源重复施加时数值累加；缺省刷新 */ stack?: true }
  | { type: 'strategy_buff'; amount: number; duration: number; strategyScaled?: boolean; attackScaled?: boolean; growthRate?: number; percent?: boolean; /** 按 N 份「造成伤害」衰减（抚民励德 4） */ decayOnDeal?: number; stack?: true }
  | { type: 'speed_buff'; amount: number; duration: number; strategyScaled?: boolean; attackScaled?: boolean; growthRate?: number; percent?: boolean; /** 按 N 份「造成伤害」衰减（抚民励德 4） */ decayOnDeal?: number; stack?: true }
  /** 受到恢复效果提升（勇挚刚毅 / 守静却敌）：rate 为 80 属性基准值（0.05 = +5%）；
   *  strategyScaled / defenseScaled + growthRate 给定时按属性缩放（公式同 damage_reduce），growthRate 缺省用基值；
   *  `stack: true` = 显式可叠加（同源重复施加累加 rate）。 */
  | { type: 'heal_boost'; rate: number; duration: number; strategyScaled?: boolean; defenseScaled?: boolean; growthRate?: number; stack?: true }
  | { type: 'damage_reduce'; rate: number; duration: number; strategyScaled?: boolean; /** 受防御缩放（一夫当关 −50%，公式同受谋略，属性换生效防御）；growthRate === undefined 时不缩放、用基值 */ defenseScaled?: boolean; /** 受攻击缩放（对称字段）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; /** 按 8 份衰减（谋议宏图）：第 1 回合 8/8，第 2 回合起每回合回合前 −1/8（第 8 回合 1/8） */ decayEighths?: number; /** 按 N 份受击衰减（疮痍累身 12）：受匹配伤害且实际扣兵后 −1 份，rate = baseRate × 剩余/初始 */ decayFifths?: number; /** 按 N 份「造成伤害」衰减（抚民励德 4）：携带者每次造成伤害（实际扣兵 > 0）后 −1 份，rate = baseRate × 剩余/初始；与 decayFifths（受击衰减）独立 */ decayOnDeal?: number; /** 显式「可叠加」（同仇敌忾等官方写「可叠加」/「层数」）：同源重复施加累加；缺省刷新 */ stack?: true; /** 同战法同过滤维叠层上限（张昭 竭忠尽智「该效果可以叠加 1 次」= 2 层）；达到后不再加 rate */ maxStacks?: number; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy'; /** 只对这些 DoT 类型生效（全主诿异：被施加的燃烧/恐慌/妖术诅咒伤害提升 20%）；缺省不限（非 DoT 伤害也吃） */ dotTypes?: DotType[]; /** 条件减伤（人公将军「敌方武将存在妖术效果时造成的攻击伤害降低 20%」）：仅当**携带者自身**带该状态时本减伤才生效 */ requireSelfStatus?: StatusType }
  /** direction：'caused'=自身造成伤害提高/降低（血溅黄砂、强势）；'taken'=自身受到伤害提高/降低（神兵天降、名士在野）。缺省 'taken'。
   *  stacks：叠层计数（带上限的增减伤，银龙冲阵），同战法累加时 +1
   *  strategyScaled=true 且给 growthRate 时（密谋定蜀每次发动 +5% 受谋略）：rate 为谋略 80 时的基础值，实际数值按 scaledValue 缩放
   *  defenseScaled=true（当敌制决 +8%）：公式同受谋略，属性换生效防御
   *  speedScaled=true（攻其不备 11.6% / 成长 0.02 受速度）：受速度缩放；growthRate === undefined 时不缩放、用基值
   *  charges：次数型。direction:'caused' 时按攻击者打出消耗（青丘媚祸）；
   *  direction:'taken' 时按受击方吃到匹配伤害后消耗（文伐下一次受到策略），不按回合递减
   *  attackScaled=true（万箭 −50% / 恃强 −30%）：受攻击缩放；growthRate === undefined 时不缩放、用基值
   *  decayFifths：按 N 份衰减（恃强 5）：挂上时满额，每次受到匹配伤害且实际扣兵 > 0 则 −1 份，rate = baseRate × fifths/N
   *  chargesStack：同战法重复施加时累加 rate（七步释嫌）；缺省不叠加（青丘媚祸） */
  | { type: 'damage_boost'; rate: number; duration: number; direction?: 'caused' | 'taken'; stacks?: number; /** 同战法同过滤维叠层达到此上限后不再加 rate；文德椒房 3 */ maxStacks?: number; /** 按 8 份衰减（虎豹督军）：第 1 回合 8/8，第 2 回合起每回合回合前 −1/8（同谋议宏图口径） */ decayEighths?: number; strategyScaled?: boolean; /** 受防御缩放（当敌制决 +8%，公式同受谋略，属性换生效防御） */ defenseScaled?: boolean; /** 受速度缩放（攻其不备 +11.6%）；growthRate === undefined 时不缩放、用基值 */ speedScaled?: boolean; /** 受攻击缩放（万箭齐发 −50%、恃强淬锋 −30% / +3.4%）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; charges?: number | [number, number]; chargesStack?: boolean; /** 显式「可叠加」标记：同源重复施加累加 rate（与 stacks / chargesStack 等价；官方写「可叠加」的非层数增减伤用） */ stack?: true; /** 按 N 份**每回合结束**衰减（敛微穷极 6）：每回合结束 −1 份，rate = baseRate × 剩余/初始 */ decayRoundParts?: number; /** 只对**非自身阵营**的伤害目标生效（合纵连横「对非自身阵营的武将造成攻击与策略伤害提升 10%」：按携带者与受击者阵营比较） */ targetFactionNotSelf?: boolean; /** 按 N 份衰减（恃强淬锋 5）：挂上满额，每次匹配受击实际扣兵后 −1 份 */ decayFifths?: number; /** 只对**指定战法**造成的伤害生效（守静却敌「造成【守静却敌】的策略伤害时」）：按伤害事件的 skillId 过滤（DamageHitContext.skillId）；缺省不限 */ skillIds?: string[]; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy'; /** 只对这些 DoT 类型生效（全主诿异：被施加的燃烧/恐慌/妖术诅咒伤害提升 20%）；缺省不限（非 DoT 伤害也吃） */ dotTypes?: DotType[]; /** 仅「进行攻击」（普攻/物理主动/追击，口径见 action.isAttackHitForProc；不含分兵溅射/反击/指挥代打/DoT）——缚父临危「下两次攻击造成的伤害提升 30%」 */ attackOnly?: boolean }
  /**
   * 发动率提升。rate 为小数（1.2 = +120% / ×2.2）。
   * skillTypes：只对这些战法类型生效（动如雷震仅追击）；缺省主动+追击都吃（难知如阴）。
   * **缺省即为基础率 + rate（直接相加，率土口径）**：追击 30% 受 +100% → 130%，
   * 超过 100% 由发动率判定封顶为必定发动。
   * additive：仅 `false` 有意义——显式退回乘算 基础率 × (1+rate)。
   */
  | { type: 'trigger_boost'; rate: number; duration: number; skillTypes?: SkillType[]; /** 仅 false 生效：退回乘算；缺省加法 */ additive?: boolean; /** 只对「攻击类」战法生效（输出段含物理伤害）——侵掠如火「攻击类主动战法发动率提升 20%」 */ attackSkillsOnly?: boolean; /** 显式「可叠加」：同源重复施加累加 rate；缺省刷新 */ stack?: true; /** 只对**携带者的主战法**生效（甚陷不惧「武将主战法发动率提高」） */ mainSkillOnly?: boolean; /** 只对「可造成攻击伤害或策略伤害的战法」生效（甚陷不惧；物理/策略输出段任一即可） */ damageSkillsOnly?: boolean; /** 消耗于携带者**本次行动结束**（甚陷不惧「下次行动时」）——行动末清除，不按回合递减 */ expireAfterOwnAct?: boolean }
  | { type: 'insight'; duration: number }
  /** 免疫怯战（魏武之泽）：持续期间无法被施加怯战 */
  | { type: 'cowardice_immune'; duration: number }
  | { type: 'siege'; duration: number }
  /** onHurt=true：受击触发妖术（破凰「条件妖术」）——行动时不跳伤，携带者每受到 1 次伤害
   *  额外引发 1 次妖术伤害，charges 次用尽即移除（与 remaining 持续回合两者先到先失效） */
  | { type: 'sorcery'; duration: number; rate: number; growthRate: number; sourceStrategy?: number; troopRatio?: TroopRatioCond; onHurt?: boolean; charges?: number }
  | { type: 'burning'; duration: number; rate: number; growthRate: number; sourceStrategy?: number; troopRatio?: TroopRatioCond }
  | { type: 'panic'; duration: number; rate: number; growthRate: number; sourceStrategy?: number; troopRatio?: TroopRatioCond }
  /** 妖术诅咒（密谋定蜀）：携带者试图发动追击战法时触发一次妖术伤害（rate% 受谋略），持续 2 回合 */
  | { type: 'curse'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  /** 引燃标记（火势风威）：携带者受到下一次伤害时额外引发一次燃烧（rate% 受谋略），触发后移除 */
  | { type: 'ignite'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
  | { type: 'split'; duration: number; rate: number; /** 次数型分兵（鱼鳞）：有值时按攻击输出次数消耗，不按回合递减 */ charges?: number; /** 受谋略缩放（鱼鳞） */ strategyScaled?: boolean }
  | { type: 'jump_prep'; duration: number; rate: number }
  /** 下一次造成伤害无视规避（缚父临危）：无 duration——消耗制，不按回合递减 */
  /** 下一次造成伤害无视规避（缚父临危）：duration 仅占位——消耗制，不按回合递减（两个 tick 函数显式跳过） */
  | { type: 'ignore_evasion'; duration: number }
  /**
   * 控制效果额外 +1 目标（鸾凤和鸣）：携带者「下一次造成的控制效果（混乱/犹豫/暴走/怯战）
   * 额外对一个目标生效」。消耗制（duration 仅占位，不按回合递减），由携带者打出控制时消耗并移除。
   */
  | { type: 'control_spread'; duration: number }
  | { type: 'taunt'; duration: number; targetId: string }
  /** 反击资格（反击之策）：携带者被普攻实际扣兵后，对来源打 rate% 攻击。不消耗。rate 与 physical_damage 同口径（100=100%） */
  | { type: 'counter'; duration: number; rate: number }
  | { type: 'cover'; duration: number; /** 只保护该友军（援护单体「为其抵挡普通攻击」）；缺省 = 援护友军全体 */ protectId?: string }
  /** 先手（诸葛锦囊）：授予后 N 回合内该单位优先行动 */
  | { type: 'priority'; duration: number }
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
  | { type: 'rest'; rate: number; growthRate: number; duration: number; startRound?: number; strategyScaled?: boolean; troopRatio?: TroopRatioCond }
  /** 士气提高（谋议宏图）：amount 为士气点数；同战法累加，不同指挥战法冲突取较高。
   *  **amount 为负 = 士气降低**（心战为上：每次伤害使目标 −5，整场常驻、同战法累加）；
   *  正负相反（士气提高 vs 士气降低）不冲突、各自共存，由 `effectiveMorale` 相加得净士气 */
  | { type: 'morale_boost'; amount: number; duration: number; /** 显式「可叠加」（谋议宏图 每回合 +8 / 心战为上 每次 −5）：同源重复施加累加；缺省刷新 */ stack?: true }
  /** 无视防御比例（0.6 = 60%），自身攻击时目标防御 × (1 − rate) */
  /**
   * 无视目标属性比例（0.6 = 60%）：`damageType:'physical'`（缺省）= 攻击伤害时目标防御 × (1 − rate)；
   * `damageType:'strategy'`（统军畏慎「造成伤害时无视敌方 60% 谋略属性」）= 策略伤害时目标谋略 × (1 − rate)
   * （仅作用于该次伤害结算用的谋略，不改面板）。
   */
  | { type: 'ignore_def'; rate: number; duration: number; damageType?: 'physical' | 'strategy' }
  /** 攻击距离提高（帝临回光「攻击距离 +1」）：普攻可达距离上限 +amount，见 target.ts attackRangeOf */
  | { type: 'range_buff'; amount: number; duration: number; /** 显式「可叠加」（雪奋短兵 每回合攻击距离 −1）：同源重复施加累加；缺省刷新 */ stack?: true }
  /** 战法有效距离提高（合纵连横「我军全体武将战法距离+1」）：战法选目标距离上限 +amount，见 target.ts skillRangeOf */
  | { type: 'skill_range_buff'; amount: number; duration: number }
  /**
   * 受击追加攻击标记（忠克猛烈）：携带者每受到 1 次**攻击伤害**（普攻/战法/反击均可），
   * 由标记施法者对其追加 1 次攻击（伤害率 rate，无视兵种相克与目标防御 —— 与该战法主动段同口径），
   * 期间最多触发 maxTriggers 次；窗口「直到施法者下回合行动前」由施法者行动时清除。
   */
  | { type: 'retaliate'; duration: number; rate: number; maxTriggers: number };

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
   * 目标池覆盖：`'mixed'` = **敌我同池**（双方存活单位，**不含施法者自身**）随机抽取
   * （率尔方雅「对自身以外的随机 3 名武将」；与暴走目标池同口径，但无需暴走状态）。
   * 缺省按输出启发式选池（敌军 / 友军 / 暴走时混合）。
   */
  targetPool?: 'mixed';
  /**
   * 开场上阵单位的 troopType 集合必须 ⊆ 此列表，否则本战法整次不生效（疏数弓+骑）。
   * 读部署名单（不论 alive）；战斗中不再复查。
   */
  teamTroopFilter?: TroopType[];
  /**
   * 我军**出战**的 3 名武将阵营必须**两两不同**，否则本战法整次不生效
   * （合纵连横「我方出战的 3 名武将阵营均不相同时」）。读部署名单（不论 alive）；战斗中不再复查。
   */
  teamFactionDistinct?: boolean;
  /**
   * 我军**出战**的 3 名武将必须**全部为该性别**，否则本战法整次不生效
   * （美人计「我方 3 名武将均为女武将时」）。读部署名单（不论 alive）；无性别数据者视为不匹配。
   */
  teamGenderFilter?: 'male' | 'female';
  /**
   * 施法者站位条件（潜谋远计「仅对自身处于前锋或中军位置时生效」）：
   * 施法者（开战时）站位不在此列表内 → **本战法整次不生效**（含受击监听、每回合段、准备阶段 output）。
   * 站位战斗中不变，故只在准备阶段 / 监听入口判定一次。
   */
  casterPositions?: Position[];
  /**
   * 重复施加奖励（诸葛锦囊「若发动时目标已有诸葛锦囊效果，则额外恢复目标一定兵力」）：
   * 战法每次发动时逐目标判定，目标身上已带**本战法**施加的状态则追加结算这段 output；
   * 该段内部结算不再触发 repeatBonus（执行路径带 skipRepeat 保护，防自递归）。
   */
  repeatBonus?: { output: SkillOutput[] };
  /**
   * 主动战法发动率递减（威震河朔「此战法每发动一次，其发动率降低 10.0%」）：
   * 每次**成功发动**后，本战法基础发动率 −N（小数，0.1 = −10%），可叠加、最低 0；
   * 结算顺序 = 基础率（区间先抽）− 递减 + trigger_boost 加算 → × 士气系数。
   * 计数走 `ctx.skillCastCounters`（键 `${casterId}:${skillId}`，整场累计不随回合重置）。
   * 仅主动战法有意义；准备主动按「释放」计一次（进入准备不计）。
   */
  triggerRateDecayPerCast?: number;
  /**
   * 每次**成功发动**后本战法伤害率递增（及锋而试「每次发动后伤害率增加 40.0%」）：
   * 第 N 次发动时输出段实际伤害率 = 输出段 rate + damageRatePerCast × (N-1)，**不封顶、整场累计**；
   * 计数走 `ctx.skillCastCounters`（键 `${casterId}:${skillId}`），在**本次结算完成后** +1，
   * 因此结算中读到的是「此前发动次数」。加算在受谋略缩放**之前**（先加后缩放）。
   */
  damageRatePerCast?: number;
  /**
   * 普通攻击**命中并实际结算后**的钩子（疾风迅雷「第 3 回合起，当普通攻击命中目标后将有 40% 的几率使其混乱」）：
   * 仅**携带者自身**的普攻触发（用户 2026-09-19 确认；被规避时不触发）；按 `rate` 经士气修正掷一次，
   * 命中则对**该普攻目标**执行 `output`（段内缺省目标池 = 该目标）。
   * `startRound`：第 N 回合起才生效（疾风迅雷 3）。
   */
  onBasicHit?: { rate: number; startRound?: number; output: SkillOutput[] };
  /**
   * 我军**全体**普通攻击命中后的钩子（合纵连横「对非自身阵营的武将普通攻击后有 40% 几率使目标陷入围困」）：
   * 与 `onBasicHit` 的区别——后者只对**战法携带者自身**的普攻生效，本钩子在准备阶段按战法锁定目标
   * （我军全体）**逐单位注册**到 `ctx.basicHitProcs`，因此**任意被注册的友军**普攻命中后都会判定；
   * 战报归属仍是本战法（`skill_trigger` 的判定方 = 实际普攻者，战法名 = 本战法）。
   * `targetFactionNotSelf`：只对该普攻目标**阵营与普攻者不同**时生效（同阵营跳过）。
   */
  basicHitProc?: { rate: number; targetFactionNotSelf?: boolean; output: SkillOutput[] };
  /**
   * 「**试图发动追击战法时**」钩子（势无虚动 / 众谋不懈）：进入追击发动率判定前（无论判定结果）
   * 对携带者执行 `output`；段内缺省目标池 = 本次追击的攻击目标。
   */
  onPursuitAttempt?: { output: SkillOutput[] };
  /**
   * 「每回合自身**首次造成伤害**后」钩子（以直报怨「每回合自身首次造成伤害后，使目标单体造成的所有伤害降低」）：
   * 按 `${回合}:${战法}:${施法者}` 整场去重（每回合一次），命中则对**本次伤害目标**执行 output。
   */
  dealFirstPerRound?: { output: SkillOutput[] };
  /**
   * 友军「造成匹配伤害后叠层」（久战熟谋「使友军群体每造成一次策略伤害后，其策略伤害就提高 5%，最多叠加 5 次」）：
   * 准备阶段把 `status` 挂到本战法锁定目标（友军）身上；此后该目标每次造成匹配伤害（实际扣兵 > 0）时
   * 把同一状态**同源再施加一次**——叠层/上限由状态自身 `maxStacks` 控制。
   */
  allyDealStack?: { damageType?: DamageType; skillTypes?: SkillType[]; status: CreateStatus };
  /**
   * 自身**主动主战法**发动后叠层，满层触发一次攻击并清空（乘间击隙「自身每发动主动主战法后，使自身造成的
   * 攻击伤害提升 15%，最多叠加 3 次。该效果每叠加 3 次后，对敌军群体发动 1 次攻击（240%），发动后攻击伤害
   * 提升效果消失」）：每次发动携带者主战法（且为主动型）后 `status` 同源 +1 层（`maxStacks` 上限），
   * 达到上限时执行 `triggerOutput`（段内自带 targetMode 重选敌军群体）随后移除该状态。
   */
  afterMainActiveStacks?: { maxStacks: number; status: CreateStatus; triggerOutput: SkillOutput[] };
  /**
   * 大营发动主动/追击后给指定站位友军叠层（勠力同心「我方大营每次发动主动战法或追击战法后，前锋和中军
   * 下次行动阶段主动和追击战法造成的伤害提升 40%，此效果可额外叠加 1 次」）：
   * `actorPositions` 判定**发动者站位**、`targetPositions` 为受益友军站位；叠层由 `status.maxStacks` 控制。
   */
  dapingCastBuff?: { actorPositions: Position[]; targetPositions: Position[]; status: CreateStatus };
  /**
   * 「发动**需要准备的主战法**时」钩子（谋定后动「每当发动需要准备的主战法时…进入洞察状态，持续 2 回合」）：
   * **进入准备时**判定（用户 2026-09-19 确认：时点为进入准备，洞察在准备期间即生效以防被打断）；
   * `mainSkillOnly` = 仅携带者主战法生效（缺省 false = 任意准备战法）。
   */
  onPrepareStart?: { mainSkillOnly?: boolean; rate?: number; output: SkillOutput[] };
  /**
   * 「任意友军成功发动主动战法后」给携带者自身叠层（胜兵求战「任意友军发动主动战法后，自身下一个主动战法
   * 造成的伤害提高 15%，此效果最多叠加 3 次」）：每次任意友军（含自己）成功发动主动战法后，
   * 把 `status` 同源施加到携带者自身一次（叠层与消耗由状态自身 `maxStacks` / `charges` 控制）。
   */
  allyActiveCastStack?: { status: CreateStatus };
  /**
   * 战法链（连环计「依次发动下列战法…每个战法的效果与原战法在同等级下效果相同」）：
   * 最外层发动时按顺序把**其他已注册战法**（`SKILL_REGISTRY`）的 `output` 当作本战法效果执行，
   * 事件 / 统计归属**被引用战法**（战报显示「发动了一次伐谋」）。
   * 每步前置条件在**该步执行时**求值——前一步的效果（如降谋略、施加暴走）可影响后一步判定。
   * 被引用战法自身的 `triggerRate` 不参与判定（本战法已掷过发动率）。
   */
  chainSkills?: Array<{
    /** 被发动战法 id（须已在 SKILL_REGISTRY 注册） */
    skillId: string;
    /** 目标池覆盖：`'random_single'` = 在本战法距离内随机敌军单体（迷阵 / 落雷段）；缺省 = 本战法主目标 */
    targetMode?: 'random_single';
    /** 仅当本战法**主目标**的生效谋略 **低于** 施法者生效谋略时结算（迷阵段） */
    requireTargetStrategyBelowSelf?: boolean;
    /** 仅当本战法**主目标**带此状态时结算（落雷段 `'rampage'`；迷阵命中主目标时可在其后满足） */
    requireTargetStatus?: StatusType;
  }>;
  /**
   * 随机复制发动（奇门遁甲「使自身随机发动除自身外的敌我全体所有主动战法中的1个，跳过全部准备回合」）：
   * 最外层发动时收集**除施法者自身外**敌我全体存活单位的 `activeSkillIds`（去重，仅注册表里 type='active' 者），
   * 随机取 1 个，直接执行其 `output`（跳过准备段与发动率判定）——事件/战报归属**被复制战法**
   * （skill_target + skill_cast，同 chainSkills 口径）；无候选则空转。
   */
  copyRandomActive?: true;
  /**
   * 按「造成伤害次数」递增本战法 `chance_group` 的基础发动率（霸王渡江「每次攻击造成伤害后可使
   * 霸王渡江发动率提升 3.0%，该效果可叠加 5 次」）：
   * 本战法每造成 1 次伤害（实际扣兵 > 0）计 1 层（上限 maxStacks），
   * chance_group 的实际基础率 = chance + increment × 层数（再走士气）；
   * 计数走 `ctx.skillDamageCounters`（键 `${casterId}:${skillId}`，整场累计不重置）。
   */
  chanceBoostPerDamage?: { increment: number; maxStacks: number };
  /**
   * 行动时判定几率**随回合递增**（将门有将「每回合自身行动时有 30.0% 的概率获得以下效果…
   * 此概率每回合结束时提高 10.0%，每个效果独立判断」）：
   * 本战法输出段**未显式给 `chance`** 时，改用 `min(1, base + increment × (当前回合 − 1))` 作为基础率，
   * 再走士气修正（`moraleTriggerRate`）——逐段**独立**判定、各自发 `skill_trigger`（baseRate = 递增后的基础率）。
   * 递增在回合结束时发生但与触发结果无关：第 1 回合 base、第 2 回合 base+increment…整场累加不重置；
   * 官方未给上限 → 概率封顶 100%。仅被动 / 非 before_active 指挥的输出段走此口径（同 `chance`）。
   */
  roundRampingChance?: { base: number; increment: number };
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
  /** 含 `random_single`：率土「敌军/友军单体」为距离内均匀随机，不是最近优先；
   * `nearest` / `farthest` = 距离内最近 / 最远（仅描述明确写最近或最远时使用，如近攻 / 远射） */
  targetMode: 'all' | 'group' | 'single' | 'random_single' | 'farthest' | 'nearest';
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
  roundTrigger?: 'on_act' | 'before_active' | 'ally_before_active' | 'ally_act' | 'after_first_active';
  /**
   * 二类指挥·友军监听试图发动主动（谋谟帷幄）：
   * 我军全体**每次试图发动主动战法前**，由存活施法者按 triggerRate 判定一次（含施法者自己发动时）。
   * 与 before_active（只看携带者自己）区分；准备完成释放 / 混乱 / 犹豫不进入判定。
   * 配合 oncePerRoundPerTarget 实现「其每回合首次试图发动主动战法时」。
   */
  oncePerRoundPerTarget?: boolean;
  /**
   * 发动者兵力阈值追加段（谋谟帷幄）：
   * 当**本次试图发动主动的单位**兵力满足 cond 时，额外再按 chance 判定一次并结算 output
   * （官方面板：「我军全体各自低于初始兵力 60% 时，其每回合首次试图发动主动战法时会额外发动一次策略攻击」）。
   */
  extraByTroopRatio?: {
    cond: TroopRatioCond;
    /** 追加段：逐 output 按各自 `chance` 独立判定，缺省 1（必发） */
    output: SkillOutput[];
  };
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
   * 一类指挥**多次分段延迟施加**（匠心不竭「使敌军全体从第 1、3、5 回合开始，逐渐陷入恐慌/燃烧/妖术」）：
   * 每个条目在**第 atRound 回合开始、单位行动之前**，对准备阶段锁定的目标（存活者）执行一次该条目 output。
   * 与 `delayedOutput` 的分工：后者单次且伤害预存（白衣/西乡/令明负榇），本字段用于多次、分段挂状态/施加效果。
   * 目标不重选（沿用准备阶段锁定名单）——锁定者已阵亡则跳过该目标。
   */
  delayedOutputs?: Array<{ atRound: number; output: SkillOutput[] }>;
  /**
   * 一类指挥准备阶段一次性效果（不参与 roundRepeat 每回合判定）：
   * 其疾如风「战斗开始后前3回合速度+41」在准备阶段无条件施加，连击则走 roundRepeat 每回合 70% 判定。
   * targetSide 沿用战法自身（其疾如风为 'ally' 全体）。
   */
  initialOutput?: SkillOutput[];
  /**
   * 一类指挥·首回合开始结算（虎豹督军 / 谋议宏图）：
   * 官方口径为「战斗开始后**首回合**」——`output` 不在准备阶段结算，
   * 改在第 1 回合 `round_start` 之后、单位行动之前，对准备阶段锁定的目标结算一次。
   * 效果自第 1 回合起算：第 1 回合满额 8/8，第 2 回合起每回合回合前 −1/8（见 tickRoundStartStatuses）。
   * 数值按第 1 回合的生效属性缩放（准备阶段只释放/锁目标，不生效）。
   */
  settleOnFirstRound?: boolean;
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
    /** 每回合生效几率递增（鸟云山兵「该效果生效几率每回合提升 10%」）：实际基础率 = rate + increment×(当前回合−startRound) */
    rateIncrementPerRound?: number;
    /** 逐段独立判定（鸟云山兵「两个效果独立判断」）：对 skill.output 每段各掷一次，命中段单独结算 */
    independentRolls?: boolean;
    /** 只在锁定目标处于这些站位时判定（美人计「中军每回合行动前」） */
    onlyPositions?: Position[];
  };
  /** 二类指挥动态发动率：初始 base，未生效每回合 +increment，生效后重置（奇兵拒北 30% 起始，未生效+5%） */
  dynamicTriggerRate?: { base: number; increment: number };
  /**
   * 二类指挥·**行动时分段**（辞后定朝）：携带者行动时（`triggerRoundCommandOnAct` 主段之后）按
   * `startRound`/`endRound` 窗口逐段执行，与主段并列、各自独立判定：
   * 每段按 `rate`（缺省必发）经士气修正掷一次，命中则结算 `output`；
   * 段内可用 `targetSide`/`targetMode`/`targetPick`/`requireGender` 覆盖目标池（缺省沿用锁定目标）。
   * `once: true` = 整场只执行一次（第 4 回合起的一次性光环，避免逐回合重复施加同源累加）。
   */
  onActSegments?: Array<{
    startRound?: number;
    endRound?: number;
    rate?: number;
    once?: boolean;
    output: SkillOutput[];
  }>;
  /**
   * 攻心 + 士气降低（心战为上）：我军每次**对敌军造成伤害**后 ——
   * ① `moraleReduce` > 0 时使伤害目标士气 −该值（走 `morale_boost` 负值状态，整场常驻；
   *    重复触发**显式累加**——施加模板带 `CreateStatus.stack: true`，用户 2026-09-19 确认可叠加
   *    （官方原文未写「可叠加」，是全仓唯一按用户确认显式标注的特例；9 次 → −45），
   *    全队累计最多 `maxTriggers` 次；
   * ② 本次为**攻击伤害**（`damageType:'physical'`）时，造成伤害者按 `healRate`%（受施法者谋略缩放，
   *    `growthRate` 缺省 = 按基值）恢复兵力，恢复量 = 本次实际扣兵 × 恢复率。
   * 计数走 `ctx.healOnDamageTriggers`（键 `${casterId}:${skillId}`，整场累计不重置）。
   */
  healOnDamage?: {
    /** 每次伤害使目标士气降低点数（心战为上 5） */
    moraleReduce?: number;
    /** 全队累计触发上限（心战为上 9） */
    maxTriggers?: number;
    /** 攻心恢复率（心战为上 50，受施法者谋略缩放） */
    healRate: number;
    growthRate?: number;
  };
  /**
   * 【扬砂】层数累计 + 消耗触发（伏波扬砂，马腾）：我军（含携带者）每次**普通攻击命中**后，把该次普攻的
   * **增减伤净幅度**（总增伤 − 总减伤，百分点，即 `buffMult(...) − 1`）×100 累入计数器；
   * 每满 `threshold`（40）个百分点扣掉阈值并 +1 层，层数上限 `maxStacks`（20）；
   * 携带者发动普通攻击**后**，每 `consumePerAttack`（4）层换一次额外普通攻击，重复触发至不足 4 层。
   * 计数走 `ctx.stacksConsumeCounters`（键 `${casterId}:${skillId}`，整场累计不重置）。
   */
  stacksConsume?: {
    /** 每满多少个百分点得 1 层（40） */
    threshold: number;
    /** 层数上限（20） */
    maxStacks: number;
    /** 每次额外普通攻击消耗的层数（4） */
    consumePerAttack: number;
  };
  /**
   * 玉玺·伤害转移（僭号天子）：我军全体受到伤害的 `rate`%（受施法者**生效防御**缩放）由玉玺承担，
   * 计入账本本回合不从受击者扣兵；第二回合起每回合开始时，玉玺对施法者造成
   * 「上一回合承担量 × 本回合承担比例」的兵力损失（比例 50% 起、每回合 +10%，封顶 100%）。
   * `growthRate` 缺省 = 不缩放（按基值，待反解）。
   */
  sealTransfer?: { rate: number; growthRate?: number };
  /**
   * 友军「再次发动」监听（赐剑长驱）：令友军全体**每回合首次成功释放主动战法后**，有 `rate`% 几率
   * 再次发动同一战法（**跳过所有准备回合**），但只造成原战法 `factor` 倍的伤害与恢复效果。
   * 逐「友军 × 每回合首次成功主动」判定一次（同回合内每名友军最多 1 次）；`rate` 为谋略 80 时的
   * 基础几率（%），`growthRate` 缺省 = 不缩放（按基值，待反解）；施法者阵亡后不再生效。
   */
  allyRecast?: { rate: number; growthRate?: number; factor: number };
  /**
   * 二类指挥·附加「本回合首次主动战法实际释放成功后」段（鸾凤和鸣）：
   * 与 `roundTrigger` 解耦——主判定时机走 on_act / after_first_active 时，本段仍会在携带者本回合
   * **首次成功释放主动战法后**执行一次（目标池按段内 targetSide/targetMode/groupCount 覆盖）。
   * 用于「同一指挥战法兼具『每回合行动时』与『每回合首次主动后』两个时机」的场景。
   */
  afterFirstActiveOutput?: SkillOutput[];
  /** 每 N 回合判定一次（难知如阴「每2回合」）：只在 currentRound % everyNRounds === 0 时判定。缺省每回合 */
  everyNRounds?: number;
  /**
   * 一类指挥·「敌方被施加特殊负面效果前」判定（审时定计，XP程昱）：
   * 敌方单位被施加**特殊负面效果**（`StatusType` ∈ taunt/siege/控制四类，见实现常量）**之前**，
   * 由存活携带者按 `rate` 判定（士气修正，逐次发 skill_trigger）；命中则对该敌方单位结算 `output`
   * （典型：本回合受到伤害提升 + 恢复我军单体）。「特殊负面效果」清单官方未定义 → 取本法自身列举的
   * 挑衅/围困/控制四类（**推定**）。
   */
  specialDebuffBefore?: { rate: number; output: SkillOutput[] };
  /**
   * 「我军全体被施加挑衅/围困/控制效果时」抵御（审时定计，XP程昱）：
   * 本侧单位被施加 `statuses` 中的状态时，由存活携带者按 `rate` 判定（士气修正）；命中则该次施加
   * **整段取消**（不落状态、不刷新、不叠加），并推 `status_resisted` 战报事件。
   */
  debuffResist?: { rate: number; statuses: StatusType[] };
  /**
   * 避锐消耗后的附加效果（疲兵沮意「避锐效果生效后有 50% 几率令敌军单体陷入燃烧状态（伤害率 150%，
   * 受到疲兵沮意的燃烧伤害伤害率提升 80%，可叠加至战斗结束」）：携带者的 `avoid_charge` 状态
   * 消耗 1 层时，由施法者按 `chance` 判定（走士气修正，同 actLayer 口径）；命中则对**战法距离内
   * 随机敌军单体**结算 `output`（燃烧 + 「受到本战法燃烧伤害提升」同源叠层，同一目标）。
   */
  avoidOnConsume?: { chance: number; output: SkillOutput[] };
  /**
   * 「敌军每回合首次受到持续性伤害时」判定（衔命建功，XP周瑜）：敌方单位本回合**首次**吃到 DoT 伤害
   * （含 DoT 跳伤 / 引燃 / 引爆，推定）后，由存活携带者按 `rate` 判定（士气修正，发 skill_trigger）；
   * 命中则对该敌方单位结算 `output`（典型：对其发动一次策略攻击）。每「单位 × 回合 × 战法」只判定一次
   * （`ctx.dotReceivedKeys` 去重）。
   */
  onDotReceived?: { rate: number; output: SkillOutput[] };
  /**
   * 「第 N 回合起，敌军陷入持续性伤害时立即额外引发一次该持续伤害」（衔命建功）：DoT 状态**挂上后**
   * 立即对该目标额外跳 1 次该 DoT（`dealDotDamage`，即原 DoT 的一次跳伤）。
   */
  extraTickOnDotApply?: { startRound: number };
  /**
   * 「天子诏令」（XP献帝）：① 每回合开始随机点名一名**敌军单体**，使其「受到所有伤害提升」按份叠加
   * （`takenBoostRate`%，受谋略缩放，持续至战斗结束）；② 本侧每个单位**本回合首次伤害/首次普攻**
   * 按 `forceTargetRate` 判定，命中则强制选中点名目标（无视距离）；③ 回合内该目标累计受到 `threshold` 次
   * 伤害时追加一层受伤提升 + 全属性下降 `punishAttrPercent`%（受谋略、可叠加、持续至战斗结束）。
   */
  imperialDecree?: {
    /** 每回合点名：受到所有伤害提升（百分点，1 级减半）；strategyScaled + growthRate 给定时按施法者谋略缩放 */
    takenBoostRate: number;
    strategyScaled?: boolean;
    growthRate?: number;
    /** 友军本回合首次伤害/普攻强制选中点名目标的概率（0~1，士气修正） */
    forceTargetRate: number;
    /** 回合内点名目标累计受击次数阈值（3） */
    threshold: number;
    /** 阈值追加：全属性下降（百分点，受谋略，可叠加） */
    punishAttrPercent: number;
  };
  /**
   * 我军全体士气提升时触发（佐命晋武，裴秀）：**本侧任意单位**被施加正士气提升（morale_boost
   * amount > 0）后，由存活携带者对**我军全体存活单位**结算 `output`。
   * 每次触发叠 1 层（同源叠层与上限由状态自身 `maxStacks` 控制）；`ctx.resolvingMoraleRaise` 防递归。
   */
  onMoraleRaise?: { output: SkillOutput[] };
  /**
   * 一类指挥·每回合结束结算（佐命晋武「每回合结束时，为我军兵力最低单体恢复 2 次兵力，每次目标独立判定」）：
   * 回合结束（攻击距离递减 / 状态 tick 之前）对**锁定目标**执行 output；段内可带
   * `targetPick:'lowest_troops_ally'` 等覆盖（每次独立重选）。
   */
  roundEndOutput?: SkillOutput[];
  /**
   * 只在列出的回合**自身行动时**判定（抚民励德「第 2、4、6 回合自身行动时」）：
   * `currentRound ∉ actRounds` 时整次跳过；缺省不限（每回合）。
   */
  actRounds?: number[];
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
    /** 只在列出的回合执行（雅虑适时「第 3、5、7 回合开始时」）；缺省不限 */
    rounds?: number[];
  };
  /**
   * 受击触发（盲侯奋勇/陷储立齐/缓师徐持）：准备阶段只登记，不立刻结算 output。
   * 目标受到伤害后由 applyDamage 判定。
   */
  onHurt?: OnHurtConfig | OnHurtConfig[];
  onHeal?: OnHealConfig;
  /**
   * 属性升降「之前」判定（举贤决机：「我军全体在被成功施加属性提升效果前，有 40% 几率使其恢复一定兵力；
   * 敌军全体在被成功施加属性下降效果前，有 40% 几率对其造成一次策略伤害」）。
   * 在 `inflictStatus` 内、属性状态**成功施加之前**（冲突判定之前）由存活施法者按 rate 判定一次，
   * 命中则对**被施加者**结算该条 output（发 skill_trigger，targetId = 被施加者）。
   * victim：施法者**同侧** = 'ally'，异侧 = 'enemy'；sign：'up' = 属性提升、'down' = 属性下降。
   * 「每种属性单独计算」——攻击/防御/谋略/速度各是一个状态、各自独立判定一次。
   */
  onAttrChange?: Array<{ victim: 'ally' | 'enemy'; sign: 'up' | 'down'; rate: number; output: SkillOutput[] }>;
  /**
   * 策略伤害相邻跳伤（其徐如林「我军全体在正式回合后施加的策略伤害，在生效时会对目标相邻的敌军
   * 额外造成一次策略伤害（伤害率为原伤害率的 15.0%），此比例每回合结束时额外提升 5.0%，可叠加，
   * 持续至战斗结束」）：**本侧**单位造成**策略伤害输出段**生效后，对目标**同侧相邻**
   * 单位额外结算一次策略伤害，伤害率 = 原伤害率 × 当前比例。
   * 覆盖范围：`strategy_damage` 输出段（DoT 跳伤 / 分兵 / 引燃暂不触发）。
   * 当前比例（百分点）= baseRate + perRound × (当前回合 - 1)；两者均「受谋略属性影响」——
   * 给了 strategyScaled + growthRate 时按**光环施法者**谋略缩放（未确认 → 不给 growthRate，按基值）。
   */
  strategyAdjacentBonus?: {
    /** 基础比例（百分点）：15 = 原伤害率的 15% */
    baseRate: number;
    /** 每回合结束时额外提升（百分点）：5（可叠加） */
    perRound: number;
    strategyScaled?: boolean;
    growthRate?: number;
  };
  /**
   * 全队累计伤害门槛（徽言龙凤「友军全体共计造成 6 次伤害后，使友军全体获得以下效果」）：
   * 与施法者同侧单位累计造成 `count` 次伤害（实际扣兵 > 0）后**激活**本战法 ——
   * 立即对锁定目标结算 `output`，并**启用**本战法的 `roundStartRepeat`（激活前不执行）。
   * 计数走 `ctx.teamDamageCounters`（键 `${casterId}:${skillId}`），激活标记走 `ctx.teamThresholdActive`。
   */
  teamDamageThreshold?: {
    count: number;
    output: SkillOutput[];
  };
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
  /** 整场战斗该战法累计触发上限（持玺兴兵 3 次）；按「战法 × 施法者」计（ctx.hurtTriggerCounters） */
  maxTriggers?: number;
  /** 受伤者兵力阈值条件（持玺兴兵：「若其兵力低于初始兵力 50%」） */
  troopRatio?: TroopRatioCond;
  /** 触发成功时额外对**施法者自身**结算的 output（持玺兴兵：自身攻击 / 谋略属性下降 30） */
  selfOutput?: SkillOutput[];
  /**
   * 该单位首次受击时必定触发，且额外触发 1 次（疮痍累身：「首次受到伤害时该效果必定触发且额外触发 1 次」）。
   * 首次按「战法 × 施法者 × 受击者」记录（ctx.hurtFirstKeys）。
   */
  firstGuaranteed?: boolean;
  /** 仅当受伤者本回合已行动完毕（缓师徐持） */
  onlyIfActed?: boolean;
  /**
   * 仅当施法者（战法携带者）**当前攻击距离 > 此值**时才判定（雪奋短兵「攻击距离小于等于 1 时，
   * 不再触发…规避效果」）：攻击距离走 `target.attackRangeOf`（含 range_buff 状态，即逐回合递减后的值）。
   */
  casterAttackRangeAbove?: number;
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
  /** 只对这些站位的受伤者触发（美人计「前 4 回合**前锋**首次受到伤害时进入规避状态」） */
  victimPositions?: Position[];
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
   * - victim：只对**本次被恢复的武将**结算（守静却敌「使受到恢复的武将造成【守静却敌】的策略伤害时
   *   伤害提升」——层数只叠在被恢复者自己身上）
   */
  applyTo: 'allies' | 'self' | 'victim';
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
  /**
   * 不受敌方指挥战法的影响（藤甲突击「不受敌方指挥战法的影响」）：携带者免疫**敌方指挥战法**
   * 施加的状态（inflictStatus 拦截，发 `command_immune_blocked`）与指挥战法的伤害段
   * （物理/策略/位置伤害段逐目标跳过）；友方指挥与主动/追击/被动战法不受影响。
   */
  commandImmune?: true;
  /**
   * 被动先手（侵掠如火「在战斗中可以优先行动」）：前 N 回合优先行动，999 = 全程
   * （与指挥 `priorityRounds` 同口径，见 combat.buildPriorityOrder）。
   */
  priorityRounds?: number;
  /**
   * 进行攻击时概率增伤（侵掠如火「进行攻击时有 30.0% 的几率使本次攻击伤害提高 50.0%」）：
   * 每次「进行攻击」的**每个伤害对象**结算前掷一次 chance（消耗 RNG），命中则本次伤害 rate 提高；
   * 不落状态、不参与增减伤冲突（数值体现在伤害本身，不进战报增减伤明细）。
   * 口径（用户确认）：「进行攻击」= 普通攻击 / 物理主动战法 / 追击战法；
   * 不含分兵溅射、反击、指挥代打（奇兵拒北）与 DoT。
   */
  attackProcBoost?: { chance: number; rate: number };
  /** 被动生效回合窗口（先声夺人 endRound:3）；battle_start 型不受此字段影响 */
  startRound?: number;
  endRound?: number;
  /**
   * 回合结束时攻击距离递减（雪奋短兵「每回合结束时使自身攻击距离 −1。攻击距离小于等于 1 时，
   * 不再触发攻击距离下降」）：每回合结束若 `attackRangeOf(携带者) > min`，则按 `perRound` 施加一条
   * `range_buff`（负值、持续至战斗结束、同战法累加）；到 `≤ min` 停止下降。
   * 递减在 `combat.runBattle` 回合末调用 `triggerRangeDecayPassives` 结算（普攻可达范围随之变化，
   * 战法有效距离 skill.range 不变）。
   */
  rangeDecayPerRound?: { perRound: number; min: number };
  /** 受击触发（同仇敌忾 / 舍身卫主）：战斗开始只登记，不立刻结算 output */
  onHurt?: OnHurtConfig | OnHurtConfig[];
  /**
   * 自身造成伤害后追加打击（京观垒冢，皇甫嵩「自身造成伤害时，有 70.0% 几率对目标额外发动一次攻击
   * （伤害率 200.0%）或策略攻击（伤害率 200.0%）」）：携带者每次造成伤害（实际扣兵 > 0）后按
   * `chance` 判定（士气修正，同 actLayer/first_aid 口径），命中则对**同一目标**结算 `output`
   * （「或」用 `random_pick` 50/50，三军夺帅先例）；追加打击自身不再回灌本钩子（`ctx.resolvingDealStrike` 防递归）。
   */
  dealExtraStrike?: { chance: number; output: SkillOutput[] };
  onHeal?: OnHealConfig;
  /**
   * 「友军大营上次行动阶段造成伤害的目标」独立重复攻击（持刀从武，XP周仓）：
   * 携带者每回合行动阶段开始时（被动 `round_start`），按 `chance` **独立判定** `attempts` 次；
   * 每次从「友军大营（`allyPosition`，缺省大营）**上一次行动阶段实际造成伤害**的敌军」池中独立随机抽 1 人，
   * 按其攻击属性打出 `rate`（百分点）攻击伤害；抽中目标**当前处于控制状态**（混乱/暴走/怯战/犹豫）时，
   * 本次伤害率再按「本次行动内对该**同一目标**已打出的次数」递增 `ratePerRepeatOnControl`（100→120→140）。
   * 池为空（大营尚未行动/其上次行动未造成伤害/记忆目标已阵亡）时本次攻击跳过。
   * 记忆走 `ctx.lastActDamageTargets`（actUnit 记账、endUnitAct 落账），本次行动内计数为调用局部变量。
   */
  lastActStrike?: {
    attempts: number;
    chance: number;
    /** 攻击伤害率（百分点）：100 */
    rate: number;
    /** 控制状态下对同一目标的每次递增（百分点）：20 */
    ratePerRepeatOnControl: number;
    /** 记忆来源站位：缺省 '大营' */
    allyPosition?: Position;
  };
  /**
   * 每受到 N 次伤害触发一次（蛮王御众「自身每受到 5 次伤害，则使友军攻击最高单体…发动一次攻击」）：
   * 受伤者自己的累计受击次数走 `ctx.hurtEveryCounters`（键 `${victimId}:${skillId}`，整场累计、不随回合重置），
   * 每满 `hits` 次即对携带者结算一次 `output`（典型：`physical_damage.attacker:'highest_attack_ally'`
   * 借我军攻击最高单体出手，段级 `chance` 走士气修正）。触发期间 `ctx.resolvingHurtHooks` 置位，
   * 触发段自身的伤害不再回灌本计数器（防递归）。
   */
  hurtEvery?: { hits: number; output: SkillOutput[] };
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
    /** 只在列出的回合执行（雅虑适时「第 3、5、7 回合开始时」）；缺省不限 */
    rounds?: number[];
    /**
     * 仅当携带者**当前攻击距离 ≤ 此值**时才结算（雪奋短兵「攻击距离小于等于 1 时，不再触发攻击距离
     * 下降及规避效果，同时每回合自身行动时…」）：与 `rangeDecayPerRound` 配套，把「攻击距离门槛」
     * 做成运行时条件，而不是写死回合窗口（攻击距离经 `target.attackRangeOf` 求和后再判）。
     */
    requireAttackRangeAtMost?: number;
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
  /**
   * 每次成功发动主动战法后触发（九伐中原「自身发动主动战法后…本场战斗共计可发动九次」）。
   * 与二类指挥 `roundTrigger:'after_first_active'` 的区别：后者只在本回合**首次**主动成功后触发，
   * 本钩子**每次**主动战法成功都触发；maxTriggers 为整场战斗的发动次数上限
   * （计数走 `ctx.afterActiveCounters`，键 `${casterId}:${skillId}`，整场累计不随回合重置）。
   * output 段建议带 targetMode（如 'group'）按战法距离重选目标。
   */
  afterActive?: { output: SkillOutput[]; maxTriggers?: number; /** 每回合只触发一次（藤甲突击「每回合首次发动主动战法后」） */ oncePerRound?: boolean };
  /**
   * 「成功发动普通攻击 / 主动战法 / 追击战法后」触发（三军夺帅）：三种来源每次成功后各结算一次 output
   * （与 `afterActive` 仅覆盖主动战法区分；无次数上限）。
   * 目标池：交给 output 段的 targetMode 重选（缺省传入对侧全体存活作为兜底）。
   */
  afterAct?: { output: SkillOutput[] };
  /**
   * 层数型受伤减免 + 掉层回血（百战无怯）：
   * ① 战斗开始即 `maxStacks` 层，每层使**受到的所有伤害**降低 `perStack`（进 sumReduce 单一总和）；
   * ② 携带者**造成伤害**（实际扣兵 > 0）后 +1 层（封顶 maxStacks）；
   * ③ **每回合开始**、以及**受到伤害**（实际扣兵 > 0）后 −1 层；
   * ④ 每次**实际掉 1 层**时按 `healRate`%（受施法者谋略缩放；`healGrowthRate` 未确认 → 0）恢复自身；
   *    0 层时既不掉层也不回血（用户 2026-09-19 确认）。
   * 计数走 `ctx.stacksReduceCounters`（键 `${casterId}:${skillId}`），状态表现为一个
   * `damage_reduce`（rate = perStack × 当前层数，随层数同步刷新）。
   */
  stacksReduceHeal?: {
    /** 每层减伤比例（0.2 = 20%） */
    perStack: number;
    /** 层数上限 / 开局层数（3） */
    maxStacks: number;
    /** 掉 1 层时的恢复率（谋略 80 基准，受谋略缩放） */
    healRate: number;
    /** 恢复率成长率（未确认 → 0 = 不缩放） */
    healGrowthRate: number;
  };
  /**
   * 兵力阈值首次跨越触发（甚陷不惧「当自身兵力首次低于初始兵力的 90%、70%、50% 和 30% 时」）：
   * 持有者受击**实际扣兵后**逐档检查（未触发过的档位按 `${skillId}:${单位}:${阈值}` 去重），
   * 命中则对持有者自身结算 `output`；同一次结算跨越多档时只结算一次（避免同源发动率提升叠加）。
   */
  troopThresholdBuff?: { thresholds: number[]; output: SkillOutput[] };
  /**
   * 每回合自身行动时恢复 N 次（胜敌益强「每回合行动时使自身恢复 1 次兵力…第 2、4、6 回合起
   * 恢复次数提升至 2、3、4 次，持续到战斗结束」）：按当前回合取 `tiers` 中 `startRound ≤ 回合` 的最后一项，
   * 逐次按恢复公式结算（围困拦截）；恢复率 `rate` 为防御 80 时的基值，`defenseScaled` 时按生效防御缩放。
   */
  recoverEachRound?: {
    tiers: Array<{ startRound: number; times: number }>;
    rate: number;
    growthRate: number;
    defenseScaled?: boolean;
  };
  /**
   * 「任意友军成功发动普攻 / 主动 / 追击后」叠层（奉令护蜀）：本侧每次成功发动
   * （**含自身**，沿用徽言龙凤「友军全体」含己的口径）→ 给持有者挂 / 叠加 `pending_stacks`（上限 maxStacks）。
   * boostRate / reduceRate 为**每层**数值（基值 = 属性 80 时的值）；
   * boostAttackScaled / reduceDefenseScaled 标记在、growthRate 未确认时按基值不缩放
   * （登记 listing.OFFLINE_MAIN_SKILLS，待成长率确认后补 growthRate）。
   */
  allyActStacks?: {
    maxStacks: number;
    boostRate: number;
    boostAttackScaled?: boolean;
    boostGrowthRate?: number;
    reduceRate: number;
    reduceDefenseScaled?: boolean;
    reduceGrowthRate?: number;
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
  /**
   * 性别（辞后定朝「男性武将…女性武将…」等按性别分支的战法用）：
   * 由 `web/data/hero_meta.json`（`scripts/sync_hero_meta.mjs` 按官方 sex 补齐）注入；
   * 缺省 undefined = 数据缺失 → 不匹配任何性别分支。
   */
  gender?: 'male' | 'female';
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
  /**
   * 主战法 id（供「仅武将主战法生效」类效果过滤，如甚陷不惧「武将主战法发动率提高」）。
   * 缺省 undefined = 数据缺失 → 相关过滤不命中。
   */
  mainSkillId?: string;
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
  /** 性别（由 `web/data/hero_meta.json` 注入；详见 General.gender） */
  gender?: 'male' | 'female';
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
  | 'confusion'  | 'rampage'
  | 'cowardice'
  | 'hesitation'
  | 'evasion'
  | 'evade_chance'
  | 'combo'
  | 'attack_buff'
  | 'defense_buff'
  | 'strategy_buff'
  | 'speed_buff'
  | 'damage_reduce'
  | 'damage_boost'
  /** 避锐（疲兵沮意）：层数式「受到伤害前消耗 1 层」减伤，消耗时结算附加效果（燃烧 + 递增） */
  | 'avoid_charge'
  /** 策略伤害浮动（敛微穷极，刘徽）：携带者策略伤害率在收敛区间内随机 */
  | 'strategy_flux'
  /** 伤害分摊（言出必克 / 雅虑适时）：携带者替同侧友军分担伤害 */
  | 'damage_share'
  /** 受到恢复效果提升（勇挚刚毅）：rate 为恢复量加成比例，recoverTroops 统一收口 */
  | 'heal_boost'
  | 'trigger_boost'
  | 'insight'
  | 'cowardice_immune'
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
  | 'ignore_def'
  | 'range_buff'
  | 'skill_range_buff'
  /** 先手（诸葛锦囊）：行动排序时该单位优先出手 */
  | 'priority'
  /** 受击追加攻击标记（忠克猛烈）：携带者受攻击伤害时施法者追加 1 次攻击，最多 N 次 */
  | 'retaliate'
  /** 叠层待发（奉令护蜀）：友军每次成功发动叠 1 层（上限 5），下次普攻增伤 / 下次受击减伤后清空全部层数 */
  | 'pending_stacks'
  /** 下一次伤害无视规避（缚父临危：友军中吕布下一次造成的伤害无视规避；覆盖任意伤害类型，由该单位下次造成伤害时消耗） */
  | 'ignore_evasion'
  /** 下一次造成的控制效果额外 +1 目标（鸾凤和鸣）：消耗制，由携带者打出控制时消耗 */
  | 'control_spread';

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
 *  appliedRound：施加时的回合号。0 = 准备阶段（行动前施加，remaining=duration，回合末递减，「前N回合」生效至第N+1回合行动前）；
 *                >0 = 该回合行动中施加（remaining=duration）——第 2 组（控制/属性/增减伤）在携带者下次行动
 *                开始时递减、再下一次行动开始时移除（duration N = 生效接下来 N 次行动）；其余（DoT/治愈等）
 *                在携带者行动结束后递减、到 0 移除 */
export type Status =
  | { type: 'confusion'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'rampage'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; pendingNextAct?: boolean }
  | { type: 'cowardice'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; /** 下一次行动时才生效（张昭 竭忠尽智）：行动开始时激活并转入「生效中」 */ pendingNextAct?: boolean }
  | { type: 'hesitation'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'evasion'; stacks: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  /** 概率规避（列营守险）：charges = 剩余机会；每次受击消耗 1，命中则免疫该次伤害，用尽即移除 */
  | { type: 'evade_chance'; rate: number; charges: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'combo'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  /** 伤害分摊（言出必克 / 雅虑适时）：携带者替同侧友军按 rate 分担（charges 用完移除，缺省无限） */
  | { type: 'damage_share'; rate: number; damageKind?: 'physical' | 'strategy'; charges?: number; scope?: 'heart_sync' | 'all_allies'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  /** 避锐（疲兵沮意）：吸收层数（每回合 +2）；受击前消耗 1 层令该次伤害降低 perStackRate，不按回合递减 */
  | { type: 'avoid_charge'; stacks: number; perStackRate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  /**
   * 策略伤害浮动（敛微穷极，刘徽）：携带者造成**策略伤害**时，其伤害率 × 当前浮动系数——
   * 系数在 [low, high]（百分点）内均匀随机，区间随回合**线性收敛**到 `mid`（第 `convergeRounds` 回合起
   * 恒为 mid）。`low/high/mid` 均为百分点（80/150/115），上限/中点「受谋略属性影响」时在施加阶段
   * 由 `strategyScaled + growthRate` 统一缩放（未确认 → 基值）。不按回合递减（remaining 仅占位）。
   */
  | { type: 'strategy_flux'; low: number; high: number; mid: number; convergeRounds: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'attack_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 造成伤害衰减：满额数值（抚民励德 80） */ baseAmount?: number; /** 剩余份数（抚民励德 4→3→…） */ dealParts?: number; /** 份数初始值（4） */ dealPartsBase?: number }
  | { type: 'defense_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; baseAmount?: number; dealParts?: number; dealPartsBase?: number }
  | { type: 'strategy_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 造成伤害衰减：满额数值（抚民励德 80） */ baseAmount?: number; /** 剩余份数（抚民励德 4→3→…）；无此字段则不按造成伤害衰减 */ dealParts?: number; /** 份数初始值（4），衰减公式分母 */ dealPartsBase?: number }
  | { type: 'speed_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; baseAmount?: number; dealParts?: number; dealPartsBase?: number }
  | { type: 'damage_reduce'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 每回合结束剩余份数（敛微穷极）；无此字段则不按回合衰减 */ roundParts?: number; /** 每回合份数初始值，衰减公式分母 */ roundPartsBase?: number; /** 当前剩余份数（谋议宏图 8→7→…）；无此字段则不按 1/8 衰减 */ eighths?: number; /** 8/8 时的满额减伤率，衰减时 rate = baseRate × eighths/8 */ baseRate?: number; /** 叠层计数（张昭 竭忠尽智「该效果可以叠加 1 次」= 2 层）：首层 1，同源重复施加累加 +1 */ stacks?: number; /** 同战法同过滤维叠层上限（2）：达到后同源重复施加被守卫拒绝，不再加 rate */ maxStacks?: number; /** 受击剩余份数（疮痍累身 12→11→…）；无此字段则不按受击衰减 */ fifths?: number; /** 受击份数初始值（疮痍累身 12） */ fifthsBase?: number; /** 造成伤害剩余份数（抚民励德 4→3→…）；无此字段则不按造成伤害衰减 */ dealParts?: number; /** 份数初始值（4） */ dealPartsBase?: number; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy'; /** 只对这些 DoT 类型生效（全主诿异：被施加的燃烧/恐慌/妖术诅咒伤害提升 20%）；缺省不限（非 DoT 伤害也吃） */ dotTypes?: DotType[]; /** 条件减伤（人公将军「敌方武将存在妖术效果时造成的攻击伤害降低 20%」）：仅当**携带者自身**带该状态时本减伤才生效 */ requireSelfStatus?: StatusType }
  /**
   * 受到恢复效果提升（勇挚刚毅）：携带者受到的任何恢复（主动 heal / 休整 rest / 持续急救 first_aid /
   * 每回合恢复 recoverEachRound / 代打 healSource）统一提升 rate 比例——加成在 `recoverTroops` 唯一收口处结算。
   * rate<0 时为「受到恢复效果降低」（isBeneficialStatus 据此分正负）。
   */
  | { type: 'heal_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'damage_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; direction: 'caused' | 'taken'; sourceUnitId?: string; /** 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）；无上限时不设置 */ stacks?: number; /** 次数型下一次攻击（青丘媚祸） */ charges?: number; /** 每回合结束剩余份数（敛微穷极 6→5→…）；无此字段则不按回合衰减 */ roundParts?: number; /** 每回合份数初始值（6），衰减公式分母 */ roundPartsBase?: number; /** 当前剩余份数（恃强淬锋 5→4→…）；无此字段则不按 1/5 衰减 */ fifths?: number; /** fifths 满额时的 rate，衰减时 rate = baseRate × fifths / 初始份数 */ baseRate?: number; /** decayFifths 挂上时的满额份数（恃强 5），衰减公式分母 */ fifthsBase?: number; /** 当前剩余份数（虎豹督军 8→7→…，每回合前 −1；与 fifths 互斥） */ eighths?: number; /** 只对**指定战法**造成的伤害生效（守静却敌「造成【守静却敌】的策略伤害时」）：按伤害事件的 skillId 过滤；缺省不限 */ skillIds?: string[]; /** 只对**非自身阵营**的伤害目标生效（合纵连横）：按携带者与受击者阵营比较 */ targetFactionNotSelf?: boolean; /** 伤害来源过滤：basic=普攻（分类键小类「普通」）/ skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效（分类键小类「主动/追击/指挥」）；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省攻击+策略都吃（分类键「大类」，见 action.ts damageClassKey） */ damageType?: 'physical' | 'strategy'; /** 只对这些 DoT 类型生效（全主诿异：被施加的燃烧/恐慌/妖术诅咒伤害提升 20%）；缺省不限（非 DoT 伤害也吃） */ dotTypes?: DotType[]; /** 仅「进行攻击」（普攻/物理主动/追击，口径见 action.isAttackHitForProc；不含分兵溅射/反击/指挥代打/DoT）——缚父临危「下两次攻击造成的伤害提升 30%」 */ attackOnly?: boolean }
  | { type: 'trigger_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; skillTypes?: SkillType[]; additive?: boolean; attackSkillsOnly?: boolean; mainSkillOnly?: boolean; damageSkillsOnly?: boolean; expireAfterOwnAct?: boolean }
  | { type: 'insight'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'cowardice_immune'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  | { type: 'siege'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
  /**
   * 妖术（受击触发变体 = 破凰「条件妖术」）：onHurt 为 true 时**不在行动时跳伤**，
   * 改为携带者每受到 1 次伤害额外引发 1 次妖术伤害（挂上时冻结 stored，滞后触发），
   * charges 为剩余触发次数，用尽即移除；remaining 仍按回合递减（持续 3 回合，两者先到先失效）。
   * 引爆（破凰第一段「引发敌军全体由破凰带来的剩余妖术效果」）：剩余 charges 次一次性逐次打出后移除。
   */
  | { type: 'sorcery'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage; troopRatio?: TroopRatioCond; onHurt?: boolean; charges?: number }
  | { type: 'burning'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage; troopRatio?: TroopRatioCond }
  | { type: 'panic'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage; troopRatio?: TroopRatioCond }
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
  | { type: 'cover'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; /** 只保护该友军（援护单体）；缺省 = 援护友军全体 */ protectId?: string }
  | { type: 'priority'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
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
  | { type: 'rest'; remaining: number; healAmount: number; startRound: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; troopRatio?: TroopRatioCond }
  | { type: 'morale_boost'; amount: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  | { type: 'ignore_def'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 'strategy' = 作用于策略伤害的目标谋略折减（缺省/`'physical'` = 攻击伤害的目标防御折减） */ damageType?: 'physical' | 'strategy' }
  /** 攻击距离提高（帝临回光）：普攻可达距离上限 +amount（target.ts attackRangeOf 求和） */
  | { type: 'range_buff'; amount: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  /** 战法有效距离提高（合纵连横）：战法选目标距离上限 +amount（target.ts skillRangeOf 求和） */
  | { type: 'skill_range_buff'; amount: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  /**
   * 受击追加攻击标记（忠克猛烈）：携带者每受到 1 次攻击伤害 → 施法者对其追加 1 次攻击（rate%），
   * 最多 triggers 达到 maxTriggers 次后移除；窗口「直到施法者下回合行动前」由施法者行动时统一清除
   * （remaining 仅作占位，不参与递减）。
   */
  | { type: 'retaliate'; rate: number; maxTriggers: number; triggers: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId: string }
  /**
   * 叠层待发（奉令护蜀）：友军（含自身）每次成功发动普攻 / 主动 / 追击后 +1 层（上限 maxStacks）。
   *  - 携带者下 1 次**普通攻击**：造成伤害 + perLayerBoost × 层数，攻击打出后清空全部层数；
   *  - 携带者下 1 次**受到伤害**：受到伤害 − perLayerReduce × 层数，实际扣兵后清空全部层数。
   * 两段共用同一层数计数器（先触发者清空，另一段随之失效）；
   * perLayer* 在首次叠层时按「生效攻击 / 生效防御」缩放后冻结（受攻击 / 受防御，成长率未确认时按基值）。
   * 无 remaining：不按回合递减，只由上述两个时机清空（两个 tick 函数均显式跳过）。
   */
  | { type: 'pending_stacks'; stacks: number; maxStacks: number; perLayerBoost: number; perLayerReduce: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  /**
   * 下一次造成伤害时无视目标规避（缚父临危「同时使友军中吕布下一次造成的伤害无视规避」）。
   * 覆盖**任意伤害类型**（攻击/策略），由携带者下一次造成伤害时消耗（consumeEvasion 内统一处理，
   * 携带者自己带此标记则跳过规避判定）；不按回合递减（两个 tick 函数显式跳过）。
   */
  | { type: 'ignore_evasion'; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
  /** 控制效果额外 +1 目标（鸾凤和鸣）：消耗制，不按回合递减（两个 tick 函数显式跳过） */
  | { type: 'control_spread'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string };

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
  /**
   * 玉玺结转（僭号天子）：每回合开始时玉玺对持有者造成「上一回合承担量 × 本回合承担比例」的兵力损失。
   * 独立事件（不走 damage / 杀伤统计）：这是玉玺对自己人的结转，不是施法者的杀伤。
   */
  | {
      type: 'seal_settle';
      /** 玉玺持有者（袁术） */
      unitId: string;
      skillId: string;
      skillName: string;
      /** 上一回合玉玺承担量 */
      carried: number;
      /** 本回合承担比例（0.5 起每回合 +0.1，封顶 1） */
      ratio: number;
      /** 实际扣减兵力 */
      damage: number;
      afterTroops: number;
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
  /** 不受敌方指挥战法影响（藤甲突击）：敌方指挥战法的状态/伤害被整段拦截 */
  | { type: 'command_immune_blocked'; unitId: string; skillId: string; statusType?: StatusType }
  /** 抵御负面效果（审时定计，XP程昱）：该次施加被取消 */
  | { type: 'status_resisted'; unitId: string; skillId: string; statusType: StatusType }
  /** 伤害分摊（言出必克 / 雅虑适时）：unitId = 代为承担者，targetId = 原受击者 */
  | { type: 'share_damage'; unitId: string; targetId: string; skillId: string; amount: number }
  | { type: 'cowardice_immune_blocked'; unitId: string; statusType: StatusType }
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

