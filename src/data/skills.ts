/**
 * 内置战法数据（v0.4：主动/准备/追击/指挥/被动）
 * 全部数值严格按《通用战法调研.md》描述（满级效果）。
 * 治疗战法恢复率成长率以《谋略战法受谋略成长调研.md》§七为准，不得用 0.7 惯例估。
 */
import type { Skill } from '../engine/types';

export const SKILL_REGISTRY: Record<string, Skill> = {
  /** 突进（D 主动）：距离1，25%，敌军单体，兵刃 115% */
  tujin: {
    id: 'tujin',
    name: '突进',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 115 }],
  },
  /** 凿穿（C 主动）：距离2，25%，敌军单体，兵刃 135% */
  zaochuan: {
    id: 'zaochuan',
    name: '凿穿',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 135 }],
  },
  /** 夹攻（C 主动）：距离4，45%，敌军群体1-2目标，谋略 89.6%（受谋略，成长率 0.945/点） */
  jiagong: {
    id: 'jiagong',
    name: '夹攻',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'group',
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 89.6, strategyScaled: true, growthRate: 0.945 }],
  },

  // ─── 三将主战法 ───

  /** 方阵突击（太史慈主战法）：追击，普攻后对目标再攻 200% 兵刃 + 混乱 1 回合 */
  fangzhen_tuji: {
    id: 'fangzhen_tuji',
    name: '方阵突击',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.3,
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'physical_damage', rate: 200 },
      { kind: 'inflict_status', status: { type: 'confusion', duration: 1 } },
    ],
  },
  /**
   * 盛气横凌（文鸯主战法·追击）：普通攻击后对攻击目标猛攻 260%。
   * 再按目标生效士气分支：高昂（>100）陷入混乱 1 回合；一般或低落（≤100）额外攻击 80%~160%。
   */
  shengqi_hengling: {
    id: 'shengqi_hengling',
    name: '盛气横凌',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.5,
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'physical_damage', rate: 260 },
      {
        kind: 'morale_branch',
        high: [{ kind: 'inflict_status', status: { type: 'confusion', duration: 1 } }],
        low: [{ kind: 'physical_damage', rate: [80, 160] }],
      },
    ],
  },
  /** 玄武洰流（周瑜主战法）：1 回合准备，全体 150% 谋略（受谋略）+ 怯战 2 回合 */
  xuanwu_fuliu: {
    id: 'xuanwu_fuliu',
    name: '玄武洰流',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'all',
    tags: ['damage', 'cowardice'],
    output: [
      { kind: 'strategy_damage', rate: 150, strategyScaled: true, growthRate: 1.5 },
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 2 } },
    ],
  },
  /** 九锡黄龙（孙权主战法）：主动，移除我军全体有害效果 + 2 层规避 */
  jiuxi_huanglong: {
    id: 'jiuxi_huanglong',
    name: '九锡黄龙',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'all',
    tags: ['immunity', 'evasion'],
    output: [
      { kind: 'remove_debuffs' },
      { kind: 'grant_evasion', stacks: 2 },
    ],
  },

  // ─── 装配战法（T7 实验）───

  /** 先驱突击（A 一类指挥）：战斗开始后前3回合，先手、每回合两次普攻、攻击属性+30。准备阶段释放一次，效果由 buff 延续 */
  xianqu_tuji: {
    id: 'xianqu_tuji',
    name: '先驱突击',
    type: 'command',
    phase: 'prep',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    priorityRounds: 3,
    retainAfterDeath: true,
    tags: ['combo', 'attack_buff'],
    output: [
      { kind: 'inflict_status', status: { type: 'combo', duration: 3 } },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 30, duration: 3 } },
    ],
  },
  /** 战必断金（S 一类指挥·预备负面）：准备阶段锁定敌军群体2目标为怯战预备，前3回合目标行动时 90% 判定怯战（持续1回合）。战法只释放一次 */
  zhanbi_duanjin: {
    id: 'zhanbi_duanjin',
    name: '战必断金',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    roundRepeat: { startRound: 1, endRound: 3, rate: 0.9 },
    retainAfterDeath: true,
    tags: ['cowardice'],
    output: [{ kind: 'inflict_status', status: { type: 'cowardice', duration: 1 } }],
  },
  /** 白衣渡江（吕蒙主战法·一类指挥）：前2回合怯战预备（2目标群体）+ 第3回合对敌军全体发动 215% 无视规避谋略攻击。伤害按准备时兵力/属性结算 */
  baiyi_dujiang: {
    id: 'baiyi_dujiang',
    name: '白衣渡江',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    roundRepeat: { startRound: 1, endRound: 2, rate: 1, targetMode: 'group' },
    delayedOutput: { atRound: 3, targetMode: 'all', output: [{ kind: 'strategy_damage', rate: 215, strategyScaled: true, growthRate: 2.25, ignoresEvasion: true }] },
    retainAfterDeath: true,
    tags: ['cowardice', 'damage'],
    output: [{ kind: 'inflict_status', status: { type: 'cowardice', duration: 1 } }],
  },
  /** 奋疾先登（乐进主战法·二类指挥·行动叠层）：每回合行动时使自身攻击伤害提升 8%，
   *  与场上所有存活单位速度对比：速度高于目标 70% 几率额外 +8%，低于或等于目标 30% 几率额外 +8%；
   *  本战法增伤达到 40%（5 层）时，对距离 3 以内敌军群体发动一次攻击（伤害率 190%），
   *  发动后增伤层数清空，并使攻击目标速度属性降低 20（可叠加、持续到战斗结束） */
  fenji_xiandeng: {
    id: 'fenji_xiandeng',
    name: '奋疾先登',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    tags: ['damage_boost', 'speed_buff', 'damage'],
    actLayer: {
      perLayer: 8,
      cap: 40,
      speedHigherChance: 0.7,
      speedLowerOrEqualChance: 0.3,
      range: 3,
      speedReduce: 20,
      targetMode: 'group',
    },
    output: [{ kind: 'physical_damage', rate: 190 }],
  },
  /** 银龙冲阵（赵云主战法·主动）：随机对敌军单体发动 2 次攻击（伤害率 150%），每次目标独立判断；
   *  并使首次攻击的目标受到的攻击和策略攻击伤害提高 20%（受攻击属性影响，每点 +0.1%），
   *  持续至战斗结束，最多可叠加 3 次 */
  yinlong_chongzhen: {
    id: 'yinlong_chongzhen',
    name: '银龙冲阵',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.5,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      {
        kind: 'physical_damage',
        rate: 150,
        targetMode: 'random_single',
        markTakenBoost: { rate: 20, growthRate: 0.1, duration: 999, maxStacks: 3 },
      },
      { kind: 'physical_damage', rate: 150, targetMode: 'random_single' },
    ],
  },
  /** 奇兵拒北（魏延主战法·二类指挥）：每回合行动时判定，30% 起始发动率（未生效+5%）。生效：对敌军大营+中军各打一次 180%，并借速度最高友军对二者各打一次 120~180%。伤害率每次随机。按位置选目标 → 锁定全体敌军，执行时过滤大营/中军 */
  qibing_jubei: {
    id: 'qibing_jubei',
    name: '奇兵拒北',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 2,
    triggerRate: 1,
    targetMode: 'all',
    dynamicTriggerRate: { base: 0.3, increment: 0.05 },
    tags: ['damage'],
    output: [
      { kind: 'positional_physical_damage', positions: ['大营', '中军'], rate: 180, source: 'self' },
      { kind: 'positional_physical_damage', positions: ['大营', '中军'], rate: [120, 180], source: 'fastest_ally' },
    ],
  },
  /** 持节镇西（卫瓘主战法·一类指挥·常驻伤害前叠层）：友军每次造成攻击伤害前攻击+（受卫瓘攻击影响）、策略伤害前谋略+（受卫瓘谋略影响）、受到伤害前防御+（受卫瓘防御影响），各可叠4层，每层持续1回合（回合结束掉1层） */
  chijie_zhenxi: {
    id: 'chijie_zhenxi',
    name: '持节镇西',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'all',
    retainAfterDeath: true,
    tags: ['attack_buff', 'defense_buff', 'strategy_buff'],
    stackBuff: {
      onAttack: { maxStacks: 4, perStack: 22, growthRate: 0.1 },
      onStrategy: { maxStacks: 4, perStack: 22, growthRate: 0.1 },
      onDefense: { maxStacks: 4, perStack: 22, growthRate: 0.1 },
    },
    output: [],
  },
  /** 神兵天降（S 一类指挥·增减伤）：战斗开始后前3回合，使敌军群体受到攻击和策略攻击时的伤害提高30%（受谋略影响，成长率0.15/点） */
  shenbing_tianjiang: {
    id: 'shenbing_tianjiang',
    name: '神兵天降',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage_boost'],
    output: [{ kind: 'grant_damage_boost', rate: 30, growthRate: 0.15, duration: 3 }],
  },
  /** 大赏三军（S 一类指挥·增减伤）：战斗开始后前3回合，使我军群体进行攻击和策略攻击时的伤害提高30%（受谋略影响，成长率0.15/点） */
  dashang_sanjun: {
    id: 'dashang_sanjun',
    name: '大赏三军',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [{ kind: 'grant_damage_boost', rate: 30, growthRate: 0.15, duration: 3, direction: 'caused' }],
  },
  /** 温酒斩将（A 追击）：普攻后对攻击目标再次发动猛攻（兵刃 200%） */
  wenjiu_zhanjiang: {
    id: 'wenjiu_zhanjiang',
    name: '温酒斩将',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.35,
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 200 }],
  },
  /** 浑水摸鱼（S 主动）：1 回合准备，使敌军群体陷入混乱状态，持续 2 回合 */
  hunshui_moyu: {
    id: 'hunshui_moyu',
    name: '浑水摸鱼',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['confusion'],
    output: [{ kind: 'inflict_status', status: { type: 'confusion', duration: 2 } }],
  },
  /** 步步为营（A 被动）：使自身受到的所有伤害降低 11%，每回合开始额外叠加一次，持续直到战斗结束 */
  bubu_weiyin: {
    id: 'bubu_weiyin',
    name: '步步为营',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.11, duration: 999 } }],
  },
  /** 青囊秘要（B 被动）：战斗中每回合都会恢复一定兵力（恢复率 150%，固定倍率，不受谋略） */
  qingnang_miyao: {
    id: 'qingnang_miyao',
    name: '青囊秘要',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['heal'],
    output: [{ kind: 'heal', rate: 150, strategyScaled: false, growthRate: 0 }],
  },

  // ─── 冲突规则对照战法（v0.4）───

  /** 措手不及（B 一类指挥·预备负面）：准备阶段锁定敌军群体，战斗开始后第 4 回合起目标行动时每回合 80% 几率怯战（持续3回合）。战法只释放一次 */
  cuoshou_buji: {
    id: 'cuoshou_buji',
    name: '措手不及',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    roundRepeat: { startRound: 4, endRound: 8, rate: 0.8 },
    retainAfterDeath: true,
    tags: ['cowardice'],
    output: [{ kind: 'inflict_status', status: { type: 'cowardice', duration: 3 } }],
  },
  /** 避其锋芒（S 一类指挥）：战斗开始后前 3 回合，使我军群体受到攻击和策略攻击的伤害降低 30%（受谋略，成长率 0.15/点） */
  biqi_fengmang: {
    id: 'biqi_fengmang',
    name: '避其锋芒',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.3, duration: 3, strategyScaled: true, growthRate: 0.15 } }],
  },
  /** 共饮避世（A 一类指挥）：使我军群体受到的伤害降低 28%（每次造成伤害时该效果降低 1/7，暂未建模） */
  gongyin_bishi: {
    id: 'gongyin_bishi',
    name: '共饮避世',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.28, duration: 999 } }],
  },

  // ─── 数据库武将主战法（v0.6，逐个实现）───

  /** 千里单骑（魏·关羽主战法）：追击，普攻后对攻击目标再次发动攻击 200%，并借此恢复一定兵力（30%） */
  qianli_danqi: {
    id: 'qianli_danqi',
    name: '千里单骑',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.5,
    tags: ['damage', 'heal'],
    output: [
      { kind: 'physical_damage', rate: 200 },
      { kind: 'heal', rate: 30, strategyScaled: false, growthRate: 0, target: 'self' },
    ],
  },
  /** 樊渊泅囚（蜀·关羽主战法）：1 回合准备，对敌军全体发动一次猛攻 190% + 犹豫 1 回合 */
  fanyuan_qiou: {
    id: 'fanyuan_qiou',
    name: '樊渊泅囚',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'all',
    tags: ['damage', 'hesitation'],
    output: [
      { kind: 'physical_damage', rate: 190 },
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 1 } },
    ],
  },
  /** 枭姬（孙尚香主战法）：1 回合准备，对敌军全体发动一次攻击 160%，并随机对敌军群体 2 目标再度发动一次攻击 140% */
  xiaoji: {
    id: 'xiaoji',
    name: '枭姬',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'all',
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: 160 },
      { kind: 'physical_damage', rate: 140, targetMode: 'group' },
    ],
  },
  /** 上将潘凤（潘凤主战法）：对敌军单体发动一次猛攻 355%，下一回合内自身陷入混乱 */
  shangjiang_panfeng: {
    id: 'shangjiang_panfeng',
    name: '上将潘凤',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.4,
    targetMode: 'single',
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'physical_damage', rate: 355 },
      { kind: 'inflict_status', status: { type: 'confusion', duration: 1 }, target: 'self' },
    ],
  },
  /** 将倾之柱（卢植主战法）：对敌军群体发动一次策略攻击 85%，使自身受到攻击与策略攻击的伤害下降 49%，持续 2 回合 */
  jiangqing_zhizhu: {
    id: 'jiangqing_zhizhu',
    name: '将倾之柱',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage', 'damage_reduce'],
    output: [
      { kind: 'strategy_damage', rate: 85, strategyScaled: true, growthRate: 0.625 },
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.49, duration: 2 }, target: 'self' },
    ],
  },
  /** 血溅黄砂（马超主战法·战斗开始被动）：以无法发动主动战法为代价，使自身进行攻击时的伤害提高 120%（以全局增伤近似） */
  xuejian_huangsha: {
    id: 'xuejian_huangsha',
    name: '血溅黄砂',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 1.2, duration: 999, direction: 'caused' }, target: 'self' }],
  },

  // ─── 批量2（v0.6.2）───

  /** 当敌制决（于禁主战法·二类指挥·战斗开始一次性）：战斗开始后使自身受到的伤害降低 50%（受击后对伤害来源的增伤反制暂未建模） */
  dangdi_zhijue: {
    id: 'dangdi_zhijue',
    name: '当敌制决',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    battleStartOnce: true,
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.5, duration: 999 }, target: 'self' }],
  },
  /** 闭月（貂蝉主战法）：1 回合准备，使敌军群体陷入暴走状态（进行无差别攻击），并使其防御属性降低 29，持续 3 回合 */
  biyue: {
    id: 'biyue',
    name: '闭月',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['rampage', 'defense_buff'],
    output: [
      { kind: 'inflict_status', status: { type: 'rampage', duration: 3 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -29, duration: 3 } },
    ],
  },
  /** 金吾飞将（吕布主战法）：对敌军单体发动一次猛攻 275%，并使其陷入混乱状态，持续 2 回合（「对混乱/暴走目标优先」条件简化） */
  jinwu_feijiang: {
    id: 'jinwu_feijiang',
    name: '金吾飞将',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'physical_damage', rate: 275 },
      { kind: 'inflict_status', status: { type: 'confusion', duration: 2 } },
    ],
  },
  /** 奇佐鬼谋（郭嘉主战法，S2）：自身+友军单体谋略 +22（2 回合），敌军群体 2 目标随机陷入混乱/暴走/怯战/犹豫 1 种（2 回合） */
  qizuo_guimou: {
    id: 'qizuo_guimou',
    name: '奇佐鬼谋',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['strategy_buff', 'confusion', 'rampage', 'cowardice', 'hesitation'],
    output: [
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 22, duration: 2 }, targetSide: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 22, duration: 2 }, targetSide: 'ally', targetMode: 'single', excludeSelf: true },
      { kind: 'inflict_status', status: [
        { type: 'confusion', duration: 2 },
        { type: 'rampage', duration: 2 },
        { type: 'cowardice', duration: 2 },
        { type: 'hesitation', duration: 2 },
      ] },
    ],
  },
  /** 密谋定蜀（庞统主战法，S2）：敌军群体 2 目标减伤 30%（受谋略，减伤成长待确认）+ 恐慌 143%（官方现行，受谋略，成长率 1.125/点）
   *  + 妖术诅咒 133%（受谋略，成长率 1.225/点：试图发动追击战法时触发）；每次发动后自身造成策略伤害 +5%（受谋略，成长待确认）可叠加至战斗结束 */
  mimou_dingshu: {
    id: 'mimou_dingshu',
    name: '密谋定蜀',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage_reduce', 'panic', 'curse', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.3, duration: 2, strategyScaled: true, growthRate: 0.13 } },
      { kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 143, growthRate: 1.125 } },
      { kind: 'inflict_status', status: { type: 'curse', duration: 2, rate: 133, growthRate: 1.225 } },
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.05, duration: 999, direction: 'caused', strategyScaled: true, growthRate: 0.15 }, targetSide: 'self' },
    ],
  },
  /** 火势风威（陆逊主战法，S2）：1 回合准备，敌军全体策略攻击 111%（受谋略，成长率 0.95/点）+ 引燃标记 221%（受谋略，成长率 2.45/点：
   *  受到下一次伤害时额外引发一次燃烧，触发后移除） */
  huoshi_fengwei: {
    id: 'huoshi_fengwei',
    name: '火势风威',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['damage', 'burning', 'ignite'],
    output: [
      { kind: 'strategy_damage', rate: 111, strategyScaled: true, growthRate: 0.95 },
      { kind: 'inflict_status', status: { type: 'ignite', duration: 999, rate: 221, growthRate: 2.45 } },
    ],
  },
  /** 辕门射戟（群弓吕布 SP 主战法）：对敌军群体发动二次无视兵种相克的攻击（140%，每次攻击目标独立选择，
   *  目标数 50% 概率 2 个 / 50% 概率 3 个）；第一次攻击命中后对目标施加「造成攻击伤害降低 9999%」debuff
   *  （buffMult 10% 伤害下限 → 强制造成伤害 min 10%，持续 1 回合——duration 2 覆盖目标下一个行动回合）；
   *  「无视兵种相克」引擎无相克系统自动满足 */
  yuanmen_sheji: {
    id: 'yuanmen_sheji',
    name: '辕门射戟',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'enemy',
    groupCount: [2, 3],
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'physical_damage', rate: 140, targetMode: 'group', groupCount: [2, 3], markCausedReduce: { rate: -99.99, duration: 2 } },
      { kind: 'physical_damage', rate: 140, targetMode: 'group', groupCount: [2, 3] },
    ],
  },
  /** 平壑拒吴（曹仁主战法）：对敌军群体发动一次攻击 210%，并使敌军群体陷入怯战状态，无法进行普通攻击，持续 2 回合（「防御/兵力最低单体各一击」简化） */
  pinghe_juwu: {
    id: 'pinghe_juwu',
    name: '平壑拒吴',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage', 'cowardice'],
    output: [
      { kind: 'physical_damage', rate: 210 },
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 2 } },
    ],
  },
  /** 金匮要略（张机主战法·一类指挥）：战斗开始后前 3 回合，使我军全体受到的所有伤害降低 20.4%
   *  （受谋略影响，成长率 0.13/点），同时使我军全体受到伤害时有 50% 几率恢复一定兵力
   *  （恢复率 80%，受谋略影响，成长率 0.75/点）。
   *  战法词条：受到的攻击伤害降低 + 受到的谋略伤害降低 +（持续型急救）满足条件后执行效果恢复兵力——
   *  同为指挥战法的持续型急救冲突，先施加者生效（张机 vs 刘备皇裔流离）。前 3 回合到期后急救与减伤一并移除 */
  jinkui_yaolue: {
    id: 'jinkui_yaolue',
    name: '金匮要略',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    tags: ['damage_reduce', 'first_aid', 'heal'],
    output: [
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.204, duration: 3, strategyScaled: true, growthRate: 0.13 } },
      { kind: 'grant_first_aid', rate: 50, healRate: 80, healGrowthRate: 0.75, duration: 3 },
    ],
  },
  /**
   * 谋议宏图（司马炎主战法·一类指挥）：准备阶段对我军全体挂减伤 30%（受谋略，成长率 0.13/点）与士气 +8。
   * 减伤按 8/8 计，每回合开始（含第 1 回合回合前）衰减 1/8；士气每回合开始再 +8（同战法累加）。
   * 因准备阶段已释放：第 1 回合行动时减伤剩余 7/8、士气 +16；第 3 回合行动时减伤剩余 5/8、士气 +32。
   * 不同指挥战法的士气提高冲突、数值取较高。
   */
  mouyi_hongtu: {
    id: 'mouyi_hongtu',
    name: '谋议宏图',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    tags: ['damage_reduce', 'morale_boost'],
    roundStartRepeat: {
      output: [{ kind: 'inflict_status', status: { type: 'morale_boost', amount: 8, duration: 999 } }],
    },
    output: [
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.3, duration: 999, strategyScaled: true, growthRate: 0.13, decayEighths: 8 } },
      { kind: 'inflict_status', status: { type: 'morale_boost', amount: 8, duration: 999 } },
    ],
  },
  /** 皇裔流离（刘备主战法·一类指挥）：开始前准备回合阶段释放一次，使我军全体（三目标）受到伤害时有 50% 几率恢复一定兵力
   *  （恢复率 68%，受谋略属性影响，成长率 0.6/点：谋略 80 → 68%、谋略 200 → 140%）。该效果总生效次数每达到 3 次，
   *  生效几率提升 5% 可叠加（50% → 55% → 60%…）。战法词条：持续型急救（受击触发恢复）——
   *  同为指挥战法的持续型急救冲突，先施加者生效（典型：刘备皇裔流离 vs 张机金匮要略）。战报统计为回复触发次数/回复兵力 */
  huangyi_liuli: {
    id: 'huangyi_liuli',
    name: '皇裔流离',
    type: 'command',
    phase: 'prep',
    range: 0,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['first_aid', 'heal'],
    output: [
      {
        kind: 'grant_first_aid',
        rate: 50,
        healRate: 68,
        healGrowthRate: 0.6,
        triggerUp: { every: 3, increment: 5 },
      },
    ],
  },
  /** 献刀七星（曹操·汉主战法·主动）：对敌军单体发动一次猛攻 275%，并使其速度属性降低 28，持续 2 回合 */
  xiandao_qixing: {
    id: 'xiandao_qixing',
    name: '献刀七星',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.3,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['damage', 'debuff_speed'],
    output: [
      { kind: 'physical_damage', rate: 275 },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: -28, duration: 2 } },
    ],
  },

  // ─── 批量3（v0.6.3）───

  /**
   * 动如雷震（公孙瓒主战法）：主动战法，35%，我军群体（有效距离内 2–3 个目标，各 50%）
   * 追击战法发动率 +100 个百分点（上限 100%）、追击伤害提升 40%，持续 1 回合。
   * 官方有效距离 3（网易技能库 200955）。伤害「受速度影响」成长率暂空。
   */
  dongru_leizhen: {
    id: 'dongru_leizhen',
    name: '动如雷震',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'ally',
    groupCount: [2, 3],
    tags: ['damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'trigger_boost', rate: 1, duration: 1, skillTypes: ['pursuit'], additive: true } },
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.4, duration: 1, direction: 'caused' } },
    ],
  },
  /** 魏武之泽（曹丕主战法）：主动战法，40%，我军群体免疫怯战，普通攻击与追击伤害提高 15%（受谋略影响），每回合可两次普攻，持续 2 回合。免疫怯战暂未建模 */
  weiwu_zhi_ze: {
    id: 'weiwu_zhi_ze',
    name: '魏武之泽',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.4,
    targetMode: 'group',
    targetSide: 'ally',
    tags: ['combo', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'combo', duration: 2 } },
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.15, duration: 2, direction: 'caused' } },
    ],
  },
  /** 强势（张春华主战法）：主动战法，40%，使敌军群体进行攻击时的伤害降低 48%（受谋略影响），并使其陷入犹豫状态，无法发动主动战法，持续 2 回合（受谋略影响取基值） */
  qiangshi: {
    id: 'qiangshi',
    name: '强势',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage_boost', 'hesitation'],
    output: [
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.48, duration: 2, direction: 'caused' } },
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 2 } },
    ],
  },
  /** 怒浪伐敌（蒋钦主战法）：普通攻击后，对攻击目标发动一次袭击 240%（每发动一次发动率提高 10%，可叠加——发动率递增暂未建模） */
  nulang_fadi: {
    id: 'nulang_fadi',
    name: '怒浪伐敌',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.35,
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 240 }],
  },
  /** 诸葛锦囊（诸葛亮主战法）：使我军全体受到攻击和策略攻击的伤害降低 35%（受谋略影响），并使其进行攻击和策略攻击时的伤害提高 14%（受谋略影响），持续 2 回合（受谋略影响取基值）。自身先手暂未建模 */
  zhuge_jinnang: {
    id: 'zhuge_jinnang',
    name: '诸葛锦囊',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_reduce', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.35, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.14, duration: 2, direction: 'caused' } },
    ],
  },
  /** 不动如山（郝昭主战法·回合开始被动）：战斗中，每回合行动阶段移除自身所有有害效果，并使自身防御提高 100、谋略提高 25 */
  budong_rushan: {
    id: 'budong_rushan',
    name: '不动如山',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['defense_buff', 'strategy_buff'],
    output: [
      { kind: 'remove_debuffs', target: 'self' },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 100, duration: 1 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 25, duration: 1 } },
    ],
  },

  // ─── 批量4（v0.6.4）───

  /** 巾帼战阵（关银屏主战法）：主动，使自身造成的攻击伤害提高 40%，并对敌军群体发动一次攻击（伤害率 120%），但无法进行普通攻击（无法普攻暂未建模）。发动率 100% */
  jinguo_zhanzhen: {
    id: 'jinguo_zhanzhen',
    name: '巾帼战阵',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage_boost', 'damage'],
    output: [
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.4, duration: 1, direction: 'caused' }, target: 'self' },
      { kind: 'physical_damage', rate: 120 },
    ],
  },
  /** 白楼独舞（貂蝉·群主战法·一类指挥）：战斗开始后前 3 回合，使敌军群体进行攻击和策略攻击时的伤害降低 26%（受谋略影响）。效果结束后暴走（延迟暴走暂未建模） */
  bailou_duwu: {
    id: 'bailou_duwu',
    name: '白楼独舞',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'enemy',
    priorityRounds: 3,
    retainAfterDeath: true,
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.26, duration: 3, direction: 'caused' } }],
  },
  /** 汉韵旷野（王昭君主战法·一类指挥）：战斗开始后，使敌军全体进行攻击或策略攻击时，有 40% 几率使伤害降低 30%（受谋略影响）。每回合王昭君行动时几率 +3%（叠加率暂未建模，取基值 40%） */
  hanyun_kuangye: {
    id: 'hanyun_kuangye',
    name: '汉韵旷野',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'enemy',
    retainAfterDeath: true,
    roundRepeat: { startRound: 1, endRound: 8, rate: 0.4 },
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.3, duration: 1, direction: 'caused' } }],
  },
  /** 双艳（小乔＆大乔主战法）：主动，使敌军群体陷入暴走状态（无差别攻击），攻击距离 -1（攻击距离暂未建模），持续 2 回合 */
  shuangyan: {
    id: 'shuangyan',
    name: '双艳',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['rampage'],
    output: [{ kind: 'inflict_status', status: { type: 'rampage', duration: 2 } }],
  },
  /** 逆谋（董卓主战法·二类指挥·战斗开始一次性）：使自身受到攻击与策略攻击的伤害降低 30%（受攻击影响）。造成攻击伤害时恢复伤害值 50% 兵力（吸血暂未建模） */
  nimou: {
    id: 'nimou',
    name: '逆谋',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    battleStartOnce: true,
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.3, duration: 999 }, target: 'self' }],
  },
  /** 宣威再战（张绣主战法）：追击，普通攻击后对攻击目标发动一次攻击（伤害率 150%）。发动率 100% */
  xuanwei_zaizhan: {
    id: 'xuanwei_zaizhan',
    name: '宣威再战',
    type: 'pursuit',
    range: 0,
    triggerRate: 1,
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 150 }],
  },

  // ─── 批量5（v0.6.5）───

  /** 红颜铁骑（马云禄主战法·回合开始被动）：战斗开始后，使自身攻击属性提高 50，每回合可进行两次普通攻击 */
  hongyan_tieqi: {
    id: 'hongyan_tieqi',
    name: '红颜铁骑',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['combo', 'attack_buff'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 50, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'combo', duration: 1 }, target: 'self' },
    ],
  },
  /** 其疾如风（张辽主战法·一类指挥）：准备阶段释放一次。
   *  两个效果：① 前 3 回合无条件使我军全体速度+41（受谋略，initialOutput）；
   *  ② 第 1~3 回合每回合 70% 判定我军全体是否获得连击（roundRepeat 窗口 1~3，连击持续本回合 duration 1） */
  qiji_rufeng: {
    id: 'qiji_rufeng',
    name: '其疾如风',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    roundRepeat: { startRound: 1, endRound: 3, rate: 0.7 },
    initialOutput: [
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 41, duration: 3, strategyScaled: true, growthRate: 0.1 } },
    ],
    tags: ['combo', 'speed_buff'],
    output: [{ kind: 'inflict_status', status: { type: 'combo', duration: 1 } }],
  },

  // ─── 批量 6（v0.8）───

  /** 世仇（王异主战法·追击）：普通攻击后，对攻击目标再次发动策略攻击 233%（受谋略），并使其陷入围困状态 2 回合 */
  shichou: {
    id: 'shichou',
    name: '世仇',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.6,
    tags: ['damage', 'siege'],
    output: [
      { kind: 'strategy_damage', rate: 233, strategyScaled: true, growthRate: 2.1 },
      { kind: 'inflict_status', status: { type: 'siege', duration: 2 } },
    ],
  },
  /** 复誓业火（周姬主战法·主动）：使敌军群体受到策略攻击时的伤害提高 16%（受谋略），并对其发动一次火攻 114%（受谋略），同时使其陷入燃烧 114%（受谋略），持续 2 回合/1 回合 */
  fushi_yehuo: {
    id: 'fushi_yehuo',
    name: '复誓业火',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.40,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage', 'burning', 'damage_boost'],
    output: [
      { kind: 'grant_damage_boost', rate: 16, growthRate: 0.1, duration: 2 },
      { kind: 'strategy_damage', rate: 114, strategyScaled: true, growthRate: 0.95 },
      { kind: 'inflict_status', status: { type: 'burning', duration: 1, rate: 114, growthRate: 0.95 } },
    ],
  },
  /** 名士在野（司马徽主战法·一类指挥）：战斗中，使友军全体谋略属性提高 35；每回合 50% 几率使其受到攻击的伤害下降 22%（受谋略，负增伤实现），持续 1 回合 */
  mingshi_zaiye: {
    id: 'mingshi_zaiye',
    name: '名士在野',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    roundRepeat: { startRound: 1, endRound: 8, rate: 0.5 },
    initialOutput: [
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 35, duration: 999 } },
    ],
    tags: ['strategy_buff', 'damage_reduce'],
    output: [{ kind: 'grant_damage_boost', rate: -22, growthRate: 0.1, duration: 1 }],
  },
  /** 未笄难言（董白主战法·主动）：使敌军群体陷入妖术诅咒，每回合损失兵力 108%（受谋略），持续 2 回合；并使敌军群体攻击和策略攻击伤害降低 18%，可叠加至战斗结束 */
  weiji_nanyan: {
    id: 'weiji_nanyan',
    name: '未笄难言',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['sorcery', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'sorcery', duration: 2, rate: 108, growthRate: 1.075 } },
      { kind: 'grant_damage_boost', rate: -18, growthRate: 0, duration: 999, direction: 'caused' },
    ],
  },

  // ─── 新机制示例战法（v0.7）───

  /** 洞察（C 主动·示例）：使自身进入洞察状态，免疫混乱/犹豫/怯战/暴走，持续 2 回合 */
  insight_skill: {
    id: 'insight_skill',
    name: '洞察',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.30,
    targetMode: 'self',
    tags: ['insight'],
    output: [{ kind: 'inflict_status', status: { type: 'insight', duration: 2 }, target: 'self' }],
  },
  /** 了如指掌（C 主动）：移除敌军群体的有益效果，并使其无法恢复兵力，持续 1 回合 */
  liaoru_zhizhang: {
    id: 'liaoru_zhizhang',
    name: '了如指掌',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.30,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['siege'],
    output: [{ kind: 'inflict_status', status: { type: 'siege', duration: 1 } }],
  },
  /** 楚歌四起（A 主动）：1 回合准备，使敌军群体陷入恐慌状态，每回合损失较多兵力（127% 受谋略），持续 2 回合 */
  chuge_siqi: {
    id: 'chuge_siqi',
    name: '楚歌四起',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.50,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['panic'],
    output: [{ kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 127, growthRate: 1.275 } }],
  },
  /** 焰焚箕轸（A 主动）：1 回合准备，对敌军群体策略攻击 119%（受谋略）+ 燃烧 119%（受谋略），持续 1 回合 */
  yanfen_jizhen: {
    id: 'yanfen_jizhen',
    name: '焰焚箕轸',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.50,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage', 'burning'],
    output: [
      { kind: 'strategy_damage', rate: 119, strategyScaled: true, growthRate: 1.3 },
      { kind: 'inflict_status', status: { type: 'burning', duration: 1, rate: 119, growthRate: 1.3 } },
    ],
  },
  /** 长兵方阵（B 指挥）：前 3 回合使我军群体 75% 几率分兵（伤害率 60%），持续 3 回合 */
  changbing_fangzhen: {
    id: 'changbing_fangzhen',
    name: '长兵方阵',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    retainAfterDeath: true,
    roundRepeat: { startRound: 1, endRound: 3, rate: 0.75 },
    tags: ['split'],
    output: [{ kind: 'inflict_status', status: { type: 'split', duration: 3, rate: 60 } }],
  },
  /** 奇术折冲（A 主动·示例）：使敌军群体陷入妖术状态（116% 受谋略），持续 2 回合 */
  qishu_zhechong: {
    id: 'qishu_zhechong',
    name: '奇术折冲',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.40,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['sorcery'],
    output: [{ kind: 'inflict_status', status: { type: 'sorcery', duration: 2, rate: 116, growthRate: 1.0 } }],
  },

  // ─── 批量 7（v0.9）───

  /** 魏武之世（曹操·魏主战法·一类指挥）：本场战斗中，使敌军全体攻击/防御/谋略/速度属性下降 15%（受谋略影响，基础值锚定谋略 80，成长率 0.15/点），
   *  按目标当前生效属性（含点数增减后）结算百分比；我军全体攻击距离+1 暂未建模 */
  weiwu_zhishi: {
    id: 'weiwu_zhishi',
    name: '魏武之世',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'enemy',
    retainAfterDeath: true,
    tags: ['debuff_attack', 'debuff_defense', 'debuff_strategy', 'debuff_speed'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.15 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.15 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.15 } },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.15 } },
    ],
  },
  /** 驱虎吞狼（荀彧主战法）：对敌军全体发动策略攻击 153%（受谋略），并使其陷入围困状态，持续 2 回合 */
  quhu_tunlang: {
    id: 'quhu_tunlang',
    name: '驱虎吞狼',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['damage', 'siege'],
    output: [
      { kind: 'strategy_damage', rate: 153, strategyScaled: true, growthRate: 1.85 },
      { kind: 'inflict_status', status: { type: 'siege', duration: 2 } },
    ],
  },
  /** 定军扬威（黄忠主战法）：对敌军群体发动一次攻击 120% 并进行挑衅，同时使自身受到攻击伤害降低 25%（受防御影响取基值） */
  dingjun_yangwei: {
    id: 'dingjun_yangwei',
    name: '定军扬威',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage', 'taunt', 'damage_reduce'],
    output: [
      { kind: 'physical_damage', rate: 120 },
      { kind: 'inflict_status', status: { type: 'taunt', duration: 2, targetId: '' } },
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.25, duration: 2 }, target: 'self' },
    ],
  },
  /** 西乡武功（朱儁主战法·一类指挥）：战斗前 2 回合，使我军群体每回合优先行动，并在第 2 回合行动前对敌军群体 2 目标发动一次策略攻击 191%（受谋略）。「下一次受到的伤害大幅降低」暂未建模 */
  xixiang_wugong: {
    id: 'xixiang_wugong',
    name: '西乡武功',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    retainAfterDeath: true,
    priorityRounds: 2,
    delayedOutput: {
      atRound: 2,
      targetMode: 'group',
      output: [{ kind: 'strategy_damage', rate: 191, strategyScaled: true, growthRate: 2.075 }],
    },
    tags: ['damage'],
    output: [],
  },
  /** 国士无双（凌统主战法·一类指挥）：战斗开始后前 3 回合，使自身与友军单体每回合有 90% 几率进入洞察状态（免疫混乱/犹豫/怯战/暴走），同时自身攻击造成的伤害提升 25%（受攻击影响取基值，准备阶段一次性施加） */
  guoshi_wushuang: {
    id: 'guoshi_wushuang',
    name: '国士无双',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    retainAfterDeath: true,
    roundRepeat: { startRound: 1, endRound: 3, rate: 0.9 },
    initialOutput: [
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.25, duration: 3, direction: 'caused' }, target: 'self' },
    ],
    tags: ['insight', 'damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'insight', duration: 1 } }],
  },
  /** 黄天当立（张角主战法）：1 回合准备，使敌军全体陷入妖术诅咒，每回合损失兵力 180%（受谋略），持续 2 回合 */
  huangtian_dangli: {
    id: 'huangtian_dangli',
    name: '黄天当立',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['sorcery'],
    output: [{ kind: 'inflict_status', status: { type: 'sorcery', duration: 2, rate: 180, growthRate: 1.0 } }],
  },

  // ─── 批量 8（v0.10）───

  /** 夔吼象踏（木鹿大王主战法·二类指挥）：战斗中使自身进入分兵状态（伤害率 60%），同时每回合对有效距离 4 以内敌军单体发动一次策略攻击 70.2%（受谋略） */
  kui_xiangta: {
    id: 'kui_xiangta',
    name: '夔吼象踏',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 4,
    triggerRate: 1,
    targetMode: 'single',
    tags: ['damage', 'split'],
    output: [
      { kind: 'inflict_status', status: { type: 'split', duration: 1, rate: 60 }, target: 'self' },
      { kind: 'strategy_damage', rate: 70.2, strategyScaled: true, growthRate: 0.69 },
    ],
  },
  /** 烈火焚舟（黄盖主战法·追击）：普通攻击后，使攻击目标陷入燃烧状态（伤害率 150%，受谋略），持续 2 回合。
   *  目标已处于烈火焚舟的燃烧状态时：立即引爆剩余燃烧伤害（剩余回合数 × 每次燃烧伤害）并移除该燃烧，
   *  再使目标及其相邻敌军陷入伤害率 270%（受谋略）、持续 1 回合的燃烧状态。士气降低暂未建模 */
  liehuo_fenzhou: {
    id: 'liehuo_fenzhou',
    name: '烈火焚舟',
    type: 'pursuit',
    range: 0,
    triggerRate: 1,
    tags: ['burning'],
    output: [
      {
        kind: 'inflict_status',
        status: { type: 'burning', duration: 2, rate: 150, growthRate: 1.0 },
        detonate: { rate: 270, duration: 1, adjacent: true },
      },
    ],
  },
  /** 将门虎女（张姬主战法·主动）：对敌军群体发动一次攻击（伤害率 190%），并使其无法恢复兵力（围困），持续 2 回合。「受攻击伤害时 75% 几率引发动摇」暂未建模 */
  jiangmen_hunv: {
    id: 'jiangmen_hunv',
    name: '将门虎女',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage', 'siege'],
    output: [
      { kind: 'physical_damage', rate: 190 },
      { kind: 'inflict_status', status: { type: 'siege', duration: 2 } },
    ],
  },
  /** 明慧通透（王元姬主战法·主动）：移除友军单体有害效果，并恢复大量兵力（恢复率 168%，受谋略）。「下回合 50% 几率进入洞察」暂未建模 */
  minghui_tongtou: {
    id: 'minghui_tongtou',
    name: '明慧通透',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'single',
    targetSide: 'ally',
    tags: ['immunity', 'heal'],
    output: [
      { kind: 'remove_debuffs' },
      { kind: 'heal', rate: 168, strategyScaled: true, growthRate: 1.0 },
    ],
  },
  /** 险途暗渡（邓艾主战法·主动）：对敌军群体发动一次攻击（伤害率 160%），并使其陷入动摇状态，每回合产生逃兵（恐慌 DoT，伤害率 80%），持续 1 回合。士气降低/提升分支暂未建模 */
  xiantu_andu: {
    id: 'xiantu_andu',
    name: '险途暗渡',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage', 'panic'],
    output: [
      { kind: 'physical_damage', rate: 160 },
      { kind: 'inflict_status', status: { type: 'panic', duration: 1, rate: 80, growthRate: 1.0 } },
    ],
  },

  // ─── 通用追击战法（批量 u1）───

  /** 怯心夺志（A 追击）：普攻后对攻击目标再次猛攻 200%，并使其犹豫（无法发动主动战法）1 回合 */
  qiexin_duozhi: {
    id: 'qiexin_duozhi',
    name: '怯心夺志',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.28,
    tags: ['damage', 'hesitation'],
    output: [
      { kind: 'physical_damage', rate: 200 },
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 1 } },
    ],
  },
  /** 钝兵挫锐（A 追击）：普攻后对攻击目标再次猛攻 200%，并使其怯战 1 回合 */
  dunbing_cuorui: {
    id: 'dunbing_cuorui',
    name: '钝兵挫锐',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.28,
    tags: ['damage', 'cowardice'],
    output: [
      { kind: 'physical_damage', rate: 200 },
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 1 } },
    ],
  },
  /** 攻心（B 追击）：普攻后对攻击目标再次发动策略攻击 106%，并恢复自身一定兵力（恢复成长 0.75/点） */
  gongxin: {
    id: 'gongxin',
    name: '攻心',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.4,
    tags: ['damage', 'heal'],
    output: [
      { kind: 'strategy_damage', rate: 106, strategyScaled: true, growthRate: 1.075 },
      { kind: 'heal', rate: 60, strategyScaled: true, growthRate: 0.75, target: 'self' },
    ],
  },
  /** 破甲（B 追击）：普攻后对攻击目标再次攻击 165%，并使其防御属性降低 25，持续 2 回合 */
  pojia: {
    id: 'pojia',
    name: '破甲',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.3,
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'physical_damage', rate: 165 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -25, duration: 2 } },
    ],
  },
  /** 攻其要害（C 追击）：普攻后对攻击目标再次攻击 125% */
  gongqi_yaohai: {
    id: 'gongqi_yaohai',
    name: '攻其要害',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.28,
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 125 }],
  },
  /** 追击（C 追击）：普攻后对攻击目标再次攻击 50% */
  zhuiji: {
    id: 'zhuiji',
    name: '追击',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.6,
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 50 }],
  },
  /** 奇袭（D 追击）：普攻后对攻击目标再次发动策略攻击 121%（受谋略） */
  qixi: {
    id: 'qixi',
    name: '奇袭',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.3,
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 121, strategyScaled: true, growthRate: 0.7 }],
  },
  /** 浴血（D 追击）：普攻后使攻击目标陷入动摇（恐慌 DoT，伤害率 75%），持续 2 回合 */
  yuxue: {
    id: 'yuxue',
    name: '浴血',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.4,
    tags: ['panic'],
    output: [{ kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 75, growthRate: 1.0 } }],
  },
  /** 重伤（D 追击）：普攻后对攻击目标再次攻击 115%，并使其攻击属性降低 15，持续 2 回合 */
  zhongshang: {
    id: 'zhongshang',
    name: '重伤',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.3,
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'physical_damage', rate: 115 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -15, duration: 2 } },
    ],
  },

  // ─── 通用被动战法（批量 u2）───

  /** 三军齐出（A 被动·round_start）：每回合使自身进入分兵状态（伤害率 70%，90% 几率近似为必中） */
  sanjun_qichu: {
    id: 'sanjun_qichu',
    name: '三军齐出',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['split'],
    output: [{ kind: 'inflict_status', status: { type: 'split', duration: 1, rate: 70 }, target: 'self' }],
  },
  /** 愈战愈勇（A 被动·round_start）：每回合开始时自身攻击伤害提高 10%，可叠加，持续到战斗结束 */
  yuzhan_yuyong: {
    id: 'yuzhan_yuyong',
    name: '愈战愈勇',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.1, duration: 999, direction: 'caused' }, target: 'self' }],
  },
  /** 擅兵不寡（A 被动·round_start）：每回合恢复兵力（180%，30% 额外 300% 近似为必恢复） */
  shanbing_bugua: {
    id: 'shanbing_bugua',
    name: '擅兵不寡',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['heal'],
    output: [{ kind: 'heal', rate: 180, strategyScaled: false, growthRate: 0, target: 'self' }],
  },
  /** 深谋远虑（A 被动·round_start）：每回合开始时自身策略伤害提高 11%，可叠加，持续到战斗结束 */
  shenmou_yuanlv: {
    id: 'shenmou_yuanlv',
    name: '深谋远虑',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.11, duration: 999, direction: 'caused' }, target: 'self' }],
  },
  /** 百战精兵（B 被动·battle_start）：使自身攻击、防御、谋略、速度属性全部提高 32 */
  baizhan_jingbing: {
    id: 'baizhan_jingbing',
    name: '百战精兵',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_attack', 'buff_defense', 'buff_strategy', 'buff_speed'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 32, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 32, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 32, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 32, duration: 999 }, target: 'self' },
    ],
  },
  /** 坚守兵法（C 被动·battle_start）：使自身防御属性提高 28（受谋略影响，取基值） */
  jianshou_bingfa: {
    id: 'jianshou_bingfa',
    name: '坚守兵法',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_defense'],
    output: [{ kind: 'inflict_status', status: { type: 'defense_buff', amount: 28, duration: 999 }, target: 'self' }],
  },
  /** 强攻兵法（C 被动·battle_start）：使自身攻击属性提高 28（受谋略影响，取基值） */
  qianggong_bingfa: {
    id: 'qianggong_bingfa',
    name: '强攻兵法',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_attack'],
    output: [{ kind: 'inflict_status', status: { type: 'attack_buff', amount: 28, duration: 999 }, target: 'self' }],
  },
  /** 速战兵法（C 被动·battle_start）：使自身速度属性提高 28（受谋略影响，取基值） */
  suzhan_bingfa: {
    id: 'suzhan_bingfa',
    name: '速战兵法',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_speed'],
    output: [{ kind: 'inflict_status', status: { type: 'speed_buff', amount: 28, duration: 999 }, target: 'self' }],
  },
  /** 坚守突击（D 被动·battle_start）：使自身攻击、防御属性提高 24 */
  jianshou_tuji: {
    id: 'jianshou_tuji',
    name: '坚守突击',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_attack', 'buff_defense'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 24, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 24, duration: 999 }, target: 'self' },
    ],
  },
  /** 成竹在胸（D 被动·battle_start）：使自身防御、谋略属性提高 24 */
  chengzhu_zaixiong: {
    id: 'chengzhu_zaixiong',
    name: '成竹在胸',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_defense', 'buff_strategy'],
    output: [
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 24, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 24, duration: 999 }, target: 'self' },
    ],
  },
  /** 文韬武略（D 被动·battle_start）：使自身攻击、谋略属性提高 24 */
  wentao_wulue: {
    id: 'wentao_wulue',
    name: '文韬武略',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_attack', 'buff_strategy'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 24, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 24, duration: 999 }, target: 'self' },
    ],
  },
  /** 疾风突击（D 被动·battle_start）：使自身攻击、速度属性提高 24 */
  jifeng_tuji: {
    id: 'jifeng_tuji',
    name: '疾风突击',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_attack', 'buff_speed'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 24, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 24, duration: 999 }, target: 'self' },
    ],
  },
  /** 运筹帷幄（D 被动·battle_start）：使自身谋略、速度属性提高 24 */
  yunchou_weiwo: {
    id: 'yunchou_weiwo',
    name: '运筹帷幄',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_strategy', 'buff_speed'],
    output: [
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 24, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 24, duration: 999 }, target: 'self' },
    ],
  },
  /** 速战坚守（D 被动·battle_start）：使自身防御、速度属性提高 24 */
  suzhan_jianshou: {
    id: 'suzhan_jianshou',
    name: '速战坚守',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['buff_defense', 'buff_speed'],
    output: [
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 24, duration: 999 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 24, duration: 999 }, target: 'self' },
    ],
  },
  /** 铁壁（D 被动·battle_start）：使自身受到攻击和策略攻击的伤害降低 18% */
  tiebi: {
    id: 'tiebi',
    name: '铁壁',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.18, duration: 999 }, target: 'self' }],
  },

  /**
   * 击势（S 被动·round_start）：每回合行动时两个效果各 65% 独立判定（士气修正）。
   * 攻击伤害提高 50% 持续 1 回合；无视敌方 60% 防御持续 1 回合。
   */
  jishi: {
    id: 'jishi',
    name: '击势',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['damage_boost', 'ignore_def'],
    output: [
      {
        kind: 'inflict_status',
        chance: 0.65,
        status: { type: 'damage_boost', rate: 0.5, duration: 1, direction: 'caused' },
        target: 'self',
      },
      {
        kind: 'inflict_status',
        chance: 0.65,
        status: { type: 'ignore_def', rate: 0.6, duration: 1 },
        target: 'self',
      },
    ],
  },
  /**
   * 兵无常势（A 被动·round_start）：每回合行动时从三组效果中随机获得两种。
   * 恢复 250%；攻/防/谋 +50 持续 1 回合；受到所有伤害降低 40% 持续 1 回合。
   */
  bingwu_changshi: {
    id: 'bingwu_changshi',
    name: '兵无常势',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['heal', 'buff_attack', 'buff_defense', 'buff_strategy', 'damage_reduce'],
    output: [
      {
        kind: 'random_pick',
        count: 2,
        options: [
          [{ kind: 'heal', rate: 250, strategyScaled: false, growthRate: 0, target: 'self' }],
          [
            { kind: 'inflict_status', status: { type: 'attack_buff', amount: 50, duration: 1 }, target: 'self' },
            { kind: 'inflict_status', status: { type: 'defense_buff', amount: 50, duration: 1 }, target: 'self' },
            { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 50, duration: 1 }, target: 'self' },
          ],
          [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.4, duration: 1 }, target: 'self' }],
        ],
      },
    ],
  },

  // ─── 通用主动战法·S/A 级（批量 u3a）───

  /** 一骑当千（S 主动）：1 回合准备，对敌军全体发动一次猛烈攻击（兵刃 280%） */
  yiji_dangqian: {
    id: 'yiji_dangqian',
    name: '一骑当千',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.3,
    targetMode: 'all',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 280 }],
  },
  /** 三术奇谋（S 主动）：1 回合准备，对敌军单体发动 3 次策略攻击 178%，并依次使目标攻击/防御/谋略下降 18，持续 2 回合，每次目标独立判定 */
  sanshu_qimou: {
    id: 'sanshu_qimou',
    name: '三术奇谋',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.5,
    targetMode: 'single',
    tags: ['damage', 'debuff_attack', 'debuff_defense', 'debuff_strategy'],
    output: [
      { kind: 'strategy_damage', rate: 178, strategyScaled: true, growthRate: 1.85, targetMode: 'single' },
      { kind: 'strategy_damage', rate: 178, strategyScaled: true, growthRate: 1.85, targetMode: 'single' },
      { kind: 'strategy_damage', rate: 178, strategyScaled: true, growthRate: 1.85, targetMode: 'single' },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -18, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -18, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -18, duration: 2 } },
    ],
  },
  /** 妖术（S 主动）：1 回合准备，使敌军群体陷入暴走状态（无差别攻击），持续 2 回合 */
  yaoshu: {
    id: 'yaoshu',
    name: '妖术',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    tags: ['rampage'],
    output: [{ kind: 'inflict_status', status: { type: 'rampage', duration: 2 } }],
  },
  /** 伐谋（A 主动）：对敌军单体发动一次猛烈的策略攻击 209%，并使其攻击、谋略属性下降 45，持续 2 回合 */
  famou: {
    id: 'famou',
    name: '伐谋',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.4,
    targetMode: 'single',
    tags: ['damage', 'debuff_attack', 'debuff_strategy'],
    output: [
      { kind: 'strategy_damage', rate: 209, strategyScaled: true, growthRate: 2.175 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -45, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -45, duration: 2 } },
    ],
  },
  /** 折戟强攻（A 主动）：对敌军群体发动一次猛攻 225%，但此后使自身攻击属性降低 50，持续 1 回合 */
  zheji_qianggong: {
    id: 'zheji_qianggong',
    name: '折戟强攻',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'group',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'physical_damage', rate: 225 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -50, duration: 1 }, target: 'self' },
    ],
  },
  /** 掎角之势（A 主动）：对敌军单体发动一次攻击 180% 和一次策略攻击 143%，每次攻击目标独立判定 */
  jijiao_zhishi: {
    id: 'jijiao_zhishi',
    name: '掎角之势',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.4,
    targetMode: 'single',
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: 180, targetMode: 'single' },
      { kind: 'strategy_damage', rate: 143, strategyScaled: true, growthRate: 1.0, targetMode: 'single' },
    ],
  },
  /** 敛众定气（A 主动）：移除我军全体的有害效果，立即恢复一定兵力（85%）。50% 几率免疫围困未建模 */
  lianzhong_dingqi: {
    id: 'lianzhong_dingqi',
    name: '敛众定气',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.4,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['immunity', 'heal'],
    output: [
      { kind: 'remove_debuffs' },
      { kind: 'heal', rate: 85, strategyScaled: true, growthRate: 0.7 },
    ],
  },
  /** 筹策绝道（A 主动）：1 回合准备，对敌军群体发动一次策略攻击 250%，并使其谋略、速度属性下降 25，持续 2 回合 */
  chouce_juedao: {
    id: 'chouce_juedao',
    name: '筹策绝道',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['damage', 'debuff_strategy', 'debuff_speed'],
    output: [
      { kind: 'strategy_damage', rate: 250, strategyScaled: true, growthRate: 1.0 },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -25, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: -25, duration: 2 } },
    ],
  },
  /** 落雷（A 主动）：对敌军单体发动策略攻击 148%，并使其陷入混乱状态，持续 1 回合 */
  luolei: {
    id: 'luolei',
    name: '落雷',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'single',
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'strategy_damage', rate: 148, strategyScaled: true, growthRate: 1.35 },
      { kind: 'inflict_status', status: { type: 'confusion', duration: 1 } },
    ],
  },
  /** 迷阵（A 主动）：对敌军单体发动策略攻击 155%，并使其陷入暴走状态，持续 1 回合 */
  mizhen: {
    id: 'mizhen',
    name: '迷阵',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'single',
    tags: ['damage', 'rampage'],
    output: [
      { kind: 'strategy_damage', rate: 155, strategyScaled: true, growthRate: 1.5 },
      { kind: 'inflict_status', status: { type: 'rampage', duration: 1 } },
    ],
  },
  /** 雄兵破敌（A 主动）：1 回合准备，对敌军群体发动一次攻击 210%，并使其防御、谋略属性降低 65，持续 2 回合 */
  xiongbing_podi: {
    id: 'xiongbing_podi',
    name: '雄兵破敌',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage', 'debuff_defense', 'debuff_strategy'],
    output: [
      { kind: 'physical_damage', rate: 210 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -65, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -65, duration: 2 } },
    ],
  },
  /** 风声鹤唳（A 主动）：1 回合准备，使敌军群体陷入恐慌（130%），并使其受到策略攻击时的伤害提高 12%，持续 2 回合 */
  fengsheng_heli: {
    id: 'fengsheng_heli',
    name: '风声鹤唳',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    tags: ['panic', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 130, growthRate: 1.3 } },
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.12, duration: 2 } },
    ],
  },
  /** 危崖困军（B 主动）：1 回合准备，对敌军群体发动一次强力策略攻击 210%，并使其防御属性降低 7.2，持续 2 回合 */
  weiya_kunjun: {
    id: 'weiya_kunjun',
    name: '危崖困军',
    type: 'active',
    prepare: true,
    range: 2,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'strategy_damage', rate: 210, strategyScaled: true, growthRate: 2.25 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -7.2, duration: 2 } },
    ],
  },
  /** 叫阵（B 主动）：挑衅敌军单体使其攻击自身，同时自身防御属性提高 80，谋略属性提高 40，持续 2 回合 */
  jiaozhen: {
    id: 'jiaozhen',
    name: '叫阵',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['taunt', 'buff_defense', 'buff_strategy'],
    output: [
      { kind: 'inflict_status', status: { type: 'taunt', duration: 2, targetId: '' } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 80, duration: 2 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 40, duration: 2 }, target: 'self' },
    ],
  },
  /** 增援（B 主动）：1 回合准备，恢复我军群体较多兵力（恢复率 198%，成长率 2.1/点） */
  zengyuan: {
    id: 'zengyuan',
    name: '增援',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.45,
    targetMode: 'group',
    targetSide: 'ally',
    tags: ['heal'],
    output: [{ kind: 'heal', rate: 198, strategyScaled: true, growthRate: 2.1 }],
  },
  /** 声东击西（B 主动）：1 回合准备，对敌军群体发动一次强力策略攻击 231% */
  shengdong_jixi: {
    id: 'shengdong_jixi',
    name: '声东击西',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 231, strategyScaled: true, growthRate: 2.45 }],
  },
  /** 安抚军心（B 主动）：移除我军群体的有害效果，并立即恢复其一定兵力（恢复率 108%，成长率 0.975/点） */
  anfu_junxin: {
    id: 'anfu_junxin',
    name: '安抚军心',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'group',
    targetSide: 'ally',
    tags: ['immunity', 'heal'],
    output: [
      { kind: 'remove_debuffs' },
      { kind: 'heal', rate: 108, strategyScaled: true, growthRate: 0.975 },
    ],
  },
  /** 斩铁（B 主动）：对敌军单体发动一次攻击 170%，并使其陷入混乱状态，持续 1 回合 */
  zhantie: {
    id: 'zhantie',
    name: '斩铁',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'physical_damage', rate: 170 },
      { kind: 'inflict_status', status: { type: 'confusion', duration: 1 } },
    ],
  },
  /** 枪阵（B 主动）：1 回合准备，对敌军群体发动一次猛攻 175%，并使其防御属性降低 30，持续 2 回合 */
  qiangzhen: {
    id: 'qiangzhen',
    name: '枪阵',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'physical_damage', rate: 175 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -30, duration: 2 } },
    ],
  },
  /** 水淹七军（B 主动）：1 回合准备，对敌军群体发动一次强力策略攻击 205%，并使其攻击属性降低 10，持续 2 回合 */
  shuiyan_qijun: {
    id: 'shuiyan_qijun',
    name: '水淹七军',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'strategy_damage', rate: 205, strategyScaled: true, growthRate: 2.25 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -10, duration: 2 } },
    ],
  },
  /** 破胆（B 主动）：对敌军单体发动一次猛攻 214%，并使其攻击属性降低 30，持续 2 回合 */
  podan: {
    id: 'podan',
    name: '破胆',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'single',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'physical_damage', rate: 214 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -30, duration: 2 } },
    ],
  },
  /** 破魂（B 主动）：对敌军单体发动一次攻击 180%，并使其陷入暴走状态，持续 1 回合 */
  pohun: {
    id: 'pohun',
    name: '破魂',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage', 'rampage'],
    output: [
      { kind: 'physical_damage', rate: 180 },
      { kind: 'inflict_status', status: { type: 'rampage', duration: 1 } },
    ],
  },
  /** 箭岚（B 主动）：1 回合准备，对敌军群体发动一次猛攻 170%，并使其攻击属性降低 45，持续 2 回合 */
  jianlan: {
    id: 'jianlan',
    name: '箭岚',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'physical_damage', rate: 170 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -45, duration: 2 } },
    ],
  },
  /** 车悬（B 主动）：1 回合准备，对敌军单体发动一次猛攻 355% */
  chexuan: {
    id: 'chexuan',
    name: '车悬',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.4,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 355 }],
  },
  /** 连战（B 主动）：使自身可以进行两次普通攻击，持续 1 回合 */
  lianzhan: {
    id: 'lianzhan',
    name: '连战',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.3,
    targetMode: 'self',
    tags: ['combo'],
    output: [{ kind: 'inflict_status', status: { type: 'combo', duration: 1 }, target: 'self' }],
  },

  // ─── 通用主动战法·C/D 级（批量 u3b）───

  /** 伏兵（C 主动）：对敌军单体发动策略攻击 105.2% */
  fubing: {
    id: 'fubing',
    name: '伏兵',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 105.2, strategyScaled: true, growthRate: 0.7 }],
  },
  /** 佯攻（C 主动）：使敌军单体陷入怯战状态，无法进行普通攻击，持续 2 回合 */
  yanggong: {
    id: 'yanggong',
    name: '佯攻',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['cowardice'],
    output: [{ kind: 'inflict_status', status: { type: 'cowardice', duration: 2 } }],
  },
  /** 冲锋（C 主动）：使自身进行攻击时的伤害提高 30%，持续 1 回合，并对敌军单体发动一次攻击 180% */
  chongfeng: {
    id: 'chongfeng',
    name: '冲锋',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.3, duration: 1, direction: 'caused' }, target: 'self' },
      { kind: 'physical_damage', rate: 180 },
    ],
  },
  /** 包扎（C 主动）：恢复我军群体一定兵力（恢复率 98%） */
  baozha: {
    id: 'baozha',
    name: '包扎',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'ally',
    tags: ['heal'],
    output: [{ kind: 'heal', rate: 98, strategyScaled: true, growthRate: 0.7 }],
  },
  /** 反计（C 主动）：使敌军单体陷入犹豫状态，无法发动主动战法，持续 2 回合 */
  fanji: {
    id: 'fanji',
    name: '反计',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['hesitation'],
    output: [{ kind: 'inflict_status', status: { type: 'hesitation', duration: 2 } }],
  },
  /** 奔袭（C 主动）：对敌军单体发动一次攻击 225% */
  benxi: {
    id: 'benxi',
    name: '奔袭',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 225 }],
  },
  /** 截断（C 主动）：使敌军群体受到攻击的伤害提高 13%（受速度影响，取基值），持续 2 回合 */
  jieduan: {
    id: 'jieduan',
    name: '截断',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.13, duration: 2 } }],
  },
  /** 拒盾（C 主动）：使自身受到攻击和策略攻击的伤害降低 15%（受防御影响，取基值），持续 2 回合 */
  judun: {
    id: 'judun',
    name: '拒盾',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.35,
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.15, duration: 2 }, target: 'self' }],
  },
  /** 毒泉（C 主动）：1 回合准备，使敌军群体陷入恐慌状态（85%），持续 2 回合 */
  duquan: {
    id: 'duquan',
    name: '毒泉',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['panic'],
    output: [{ kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 85, growthRate: 0.875 } }],
  },
  /** 游击（C 主动）：使敌军单体陷入动摇（恐慌 DoT 125%），持续 2 回合 */
  youji: {
    id: 'youji',
    name: '游击',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['panic'],
    output: [{ kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 125, growthRate: 1.0 } }],
  },
  /** 溃堤（C 主动）：对敌军群体发动策略攻击 79.8%，并使其攻击属性降低 10，持续 2 回合 */
  kuidi: {
    id: 'kuidi',
    name: '溃堤',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.45,
    targetMode: 'group',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'strategy_damage', rate: 79.8, strategyScaled: true, growthRate: 0.785 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -10, duration: 2 } },
    ],
  },
  /** 火箭（C 主动）：1 回合准备，对敌军群体发动策略攻击 69%，并使其陷入燃烧状态（69%），持续 1 回合 */
  huojian: {
    id: 'huojian',
    name: '火箭',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'group',
    tags: ['damage', 'burning'],
    output: [
      { kind: 'strategy_damage', rate: 69, strategyScaled: true, growthRate: 0.7 },
      { kind: 'inflict_status', status: { type: 'burning', duration: 1, rate: 69, growthRate: 0.7 } },
    ],
  },
  /** 火辎（C 主动）：1 回合准备，对敌军群体发动策略攻击 75%，并使其陷入燃烧状态（75%），持续 1 回合 */
  huoozi: {
    id: 'huoozi',
    name: '火辎',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['damage', 'burning'],
    output: [
      { kind: 'strategy_damage', rate: 75, strategyScaled: true, growthRate: 0.75 },
      { kind: 'inflict_status', status: { type: 'burning', duration: 1, rate: 75, growthRate: 0.75 } },
    ],
  },
  /** 狼烟（C 主动）：使敌军群体陷入恐慌状态（47.6%），持续 2 回合 */
  langyan: {
    id: 'langyan',
    name: '狼烟',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'group',
    tags: ['panic'],
    output: [{ kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 47.6, growthRate: 0.7 } }],
  },
  /** 疑兵（C 主动）：使敌军单体陷入暴走状态，进行无差别攻击，持续 1 回合 */
  yibing: {
    id: 'yibing',
    name: '疑兵',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['rampage'],
    output: [{ kind: 'inflict_status', status: { type: 'rampage', duration: 1 } }],
  },
  /** 窃兵（C 主动）：对敌军单体发动一次攻击 170%，并借此恢复自身少量兵力（30%） */
  qiebing: {
    id: 'qiebing',
    name: '窃兵',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage', 'heal'],
    output: [
      { kind: 'physical_damage', rate: 170 },
      { kind: 'heal', rate: 30, strategyScaled: false, growthRate: 0, target: 'self' },
    ],
  },
  /** 绝道（C 主动）：对敌军群体发动策略攻击 105%，并使其防御属性降低 6，持续 2 回合 */
  juedao: {
    id: 'juedao',
    name: '绝道',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.45,
    targetMode: 'group',
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'strategy_damage', rate: 105, strategyScaled: true, growthRate: 0.7 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -6, duration: 2 } },
    ],
  },
  /** 落石（C 主动）：对敌军群体发动策略攻击 92.2%，并使其防御属性降低 5.2，持续 1 回合 */
  luoshi: {
    id: 'luoshi',
    name: '落石',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.45,
    targetMode: 'group',
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'strategy_damage', rate: 92.2, strategyScaled: true, growthRate: 0.7 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -5.2, duration: 1 } },
    ],
  },
  /** 规避（C 主动）：使自身进入规避状态，免疫接下来受到的 1 次攻击的伤害 */
  guibi: {
    id: 'guibi',
    name: '规避',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.36,
    targetMode: 'self',
    tags: ['evasion'],
    output: [{ kind: 'grant_evasion', stacks: 1, target: 'self' }],
  },
  /** 设伏（C 主动）：对敌军群体发动一次攻击 145% */
  shefu: {
    id: 'shefu',
    name: '设伏',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'group',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 145 }],
  },
  /** 迫近（C 主动）：使敌军群体进行攻击的伤害降低 15%（受防御影响，取基值），持续 2 回合 */
  pojin: {
    id: 'pojin',
    name: '迫近',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.15, duration: 2, direction: 'caused' } }],
  },
  /** 退避（C 主动）：使自身受到攻击和策略攻击的伤害降低 18%（受速度影响，取基值），持续 2 回合 */
  tuibi: {
    id: 'tuibi',
    name: '退避',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.35,
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.18, duration: 2 }, target: 'self' }],
  },
  /** 陷阱（C 主动）：使敌军单体陷入混乱状态，持续 1 回合 */
  xianjing: {
    id: 'xianjing',
    name: '陷阱',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.3,
    targetMode: 'single',
    tags: ['confusion'],
    output: [{ kind: 'inflict_status', status: { type: 'confusion', duration: 1 } }],
  },
  /** 雀伏（C 主动）：对敌军单体发动一次策略攻击 165% */
  quefu: {
    id: 'quefu',
    name: '雀伏',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 165, strategyScaled: true, growthRate: 1.75 }],
  },
  /** 齐射（C 主动）：对敌军群体发动一次攻击 90%，并使其攻击属性降低 16，持续 2 回合 */
  qishe: {
    id: 'qishe',
    name: '齐射',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.25,
    targetMode: 'group',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'physical_damage', rate: 90 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -16, duration: 2 } },
    ],
  },
  /** 乱击（D 主动）：1 回合准备，对敌军群体发动一次攻击 120%，并使其防御属性降低 15，持续 2 回合 */
  luanji: {
    id: 'luanji',
    name: '乱击',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'physical_damage', rate: 120 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -15, duration: 2 } },
    ],
  },
  /** 乱阵（D 主动）：使敌军群体进行策略攻击时的伤害降低 15%（受谋略影响，取基值），持续 2 回合 */
  luanzhen: {
    id: 'luanzhen',
    name: '乱阵',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'group',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.15, duration: 2, direction: 'caused' } }],
  },
  /** 假途（D 主动）：使敌军群体受到攻击时的伤害提高 13%（取基值），持续 2 回合 */
  jiatu: {
    id: 'jiatu',
    name: '假途',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'group',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.13, duration: 2 } }],
  },
  /** 劫粮（D 主动）：使敌军群体受到策略攻击时的伤害提高 13%（取基值），持续 2 回合 */
  jieliang: {
    id: 'jieliang',
    name: '劫粮',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'group',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.13, duration: 2 } }],
  },
  /** 固阵（D 主动）：使自身受到策略攻击的伤害降低 35%，持续 2 回合 */
  guzhen: {
    id: 'guzhen',
    name: '固阵',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.3,
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.35, duration: 2 }, target: 'self' }],
  },
  /** 坚守（D 主动）：使自身受到攻击的伤害降低 35%，持续 2 回合 */
  jianshou: {
    id: 'jianshou',
    name: '坚守',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.3,
    targetMode: 'self',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.35, duration: 2 }, target: 'self' }],
  },
  /** 奋起（D 主动）：使自身进行攻击时的伤害提高 35%，持续 2 回合 */
  fenqi: {
    id: 'fenqi',
    name: '奋起',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.3,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.35, duration: 2, direction: 'caused' }, target: 'self' }],
  },
  /** 威压（D 主动）：使敌军群体进行攻击时的伤害降低 15%（取基值），持续 2 回合 */
  weiya: {
    id: 'weiya',
    name: '威压',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'group',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.15, duration: 2, direction: 'caused' } }],
  },
  /** 强攻（D 主动）：对敌军单体发动一次攻击 105%，并使其防御属性降低 15，持续 2 回合 */
  qianggong: {
    id: 'qianggong',
    name: '强攻',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage', 'debuff_defense'],
    output: [
      { kind: 'physical_damage', rate: 105 },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -15, duration: 2 } },
    ],
  },
  /** 急救（D 主动）：恢复友军单体一定兵力（恢复率 108%） */
  jijiu: {
    id: 'jijiu',
    name: '急救',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'single',
    targetSide: 'ally',
    tags: ['heal'],
    output: [{ kind: 'heal', rate: 108, strategyScaled: true, growthRate: 0.7 }],
  },
  /** 横扫（D 主动）：使自身进入分兵状态（伤害率 75%），持续 1 回合 */
  hengsao: {
    id: 'hengsao',
    name: '横扫',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.28,
    targetMode: 'self',
    tags: ['split'],
    output: [{ kind: 'inflict_status', status: { type: 'split', duration: 1, rate: 75 }, target: 'self' }],
  },
  /** 犒劳（D 主动）：使自身进行策略攻击时的伤害提高 35%，持续 2 回合 */
  kaolao: {
    id: 'kaolao',
    name: '犒劳',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.3,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.35, duration: 2, direction: 'caused' }, target: 'self' }],
  },
  /** 诱敌（D 主动）：挑衅敌军单体使其攻击自身，并使之攻击属性降低 39，持续 2 回合 */
  youdi: {
    id: 'youdi',
    name: '诱敌',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.3,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['taunt', 'debuff_attack'],
    output: [
      { kind: 'inflict_status', status: { type: 'taunt', duration: 2, targetId: '' } },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -39, duration: 2 } },
    ],
  },
  /** 谨言（D 主动）：使友军全体受到策略攻击的伤害降低 16%（取基值），持续 2 回合 */
  jinyan: {
    id: 'jinyan',
    name: '谨言',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_reduce'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.16, duration: 2 } }],
  },
  /** 顽抗（D 主动）：移除自身有害效果，并对敌军单体发动一次攻击 80% */
  wankang: {
    id: 'wankang',
    name: '顽抗',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.35,
    targetMode: 'single',
    tags: ['immunity', 'damage'],
    output: [
      { kind: 'remove_debuffs', target: 'self' },
      { kind: 'physical_damage', rate: 80 },
    ],
  },
  /** 飞虹（D 主动）：对敌军单体发动一次攻击 110%，并使其攻击属性降低 15，持续 2 回合 */
  feihong: {
    id: 'feihong',
    name: '飞虹',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.25,
    targetMode: 'single',
    tags: ['damage', 'debuff_attack'],
    output: [
      { kind: 'physical_damage', rate: 110 },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -15, duration: 2 } },
    ],
  },

  // ─── 通用指挥战法（批量 u4）───

  /** 无心恋战（S 一类指挥）：战斗开始后前 3 回合，使敌军群体进行攻击和策略攻击时的伤害降低 30%（受谋略，成长率 0.15/点）。进行伤害降低 = 造成侧增伤负值 */
  wuxin_lianzhan: {
    id: 'wuxin_lianzhan',
    name: '无心恋战',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'enemy',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.3, duration: 3, direction: 'caused', strategyScaled: true, growthRate: 0.15 } }],
  },

  // ─── 批量 9（v0.11）：主动发动率提升 + 属性吸取 ───

  /** 难知如阴（法正主战法·二类指挥）：每 2 回合使友军单体在 1 回合内主动主战法发动率提高 120%（trigger_boost），
   *  并使其主动战法有 60% 几率跳过准备（jump_prep）。第 3 回合起目标调整为友军全体（近似：始终友军全体） */
  nanzhi_ruyin: {
    id: 'nanzhi_ruyin',
    name: '难知如阴',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    everyNRounds: 2,
    range: 4,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: [],
    output: [
      { kind: 'inflict_status', status: { type: 'trigger_boost', rate: 1.2, duration: 1 } },
      { kind: 'inflict_status', status: { type: 'jump_prep', rate: 0.6, duration: 1 } },
    ],
  },
  /** 黄天余音（张宁主战法·主动）：吸取敌军单体 26 全属性（受谋略影响，取基值）并附加于自身与友军单体，持续 1 回合。
   *  引擎属性吸取：敌单体 debuff + 自身/友军单体 buff（inflict_status output targetSide/targetMode 覆盖） */
  huangtian_yuyin: {
    id: 'huangtian_yuyin',
    name: '黄天余音',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 1,
    targetMode: 'single',
    targetSide: 'enemy',
    tags: ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -26, duration: 1 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -26, duration: 1 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -26, duration: 1 } },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: -26, duration: 1 } },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 26, duration: 1 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 26, duration: 1 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 26, duration: 1 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 26, duration: 1 }, target: 'self' },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 26, duration: 1 }, targetSide: 'ally', targetMode: 'single', excludeSelf: true },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 26, duration: 1 }, targetSide: 'ally', targetMode: 'single', excludeSelf: true },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 26, duration: 1 }, targetSide: 'ally', targetMode: 'single', excludeSelf: true },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 26, duration: 1 }, targetSide: 'ally', targetMode: 'single', excludeSelf: true },
    ],
  },
  /** 母仪浮梦（何太后主战法·一类指挥）：战斗开始后使我军全体首次受击规避（1 层）；
   *  前 4 回合敌军全体进行攻击/策略攻击时 60% 使本次伤害降低 40%（受谋略，成长率 0.15/点，造成侧负增伤）。
   *  roundRepeat.targetSide='enemy' 与战法 targetSide='ally' 分离锁定目标。 */
  muyi_fumeng: {
    id: 'muyi_fumeng',
    name: '母仪浮梦',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    roundRepeat: { startRound: 1, endRound: 4, rate: 0.6, targetMode: 'all', targetSide: 'enemy' },
    initialOutput: [{ kind: 'grant_evasion', stacks: 1 }],
    tags: ['evasion', 'damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: -0.4, duration: 1, direction: 'caused', strategyScaled: true, growthRate: 0.15 },
      },
    ],
  },
  /** 盲侯奋勇（夏侯惇主战法·一类指挥）：自身受到伤害后 40% 对有效距离 4 以内敌军群体发动一次攻击（伤害率 60%）。
   *  「攻击无视兵种相克」：引擎无兵种相克，自动满足。受击反击走 onHurt，准备阶段不结算 output。 */
  manghou_fenyong: {
    id: 'manghou_fenyong',
    name: '盲侯奋勇',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    onHurt: { victim: 'self', rate: 0.4, applyTo: 'skill_targets' },
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 60 }],
  },
  /** 陷储立齐（骊姬主战法·一类指挥）：我军全体每回合首次受到伤害后，随机吸取伤害来源的攻击/防御/谋略一种 70 点并附加于自身，持续 2 回合。
   *  70 点不受谋略；施法者阵亡后全队效果仍在（retainAfterDeath）。 */
  xianchu_liqi: {
    id: 'xianchu_liqi',
    name: '陷储立齐',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    onHurt: {
      victim: 'ally',
      oncePerRound: true,
      applyTo: 'steal',
      steal: { amount: 70, duration: 2, stats: ['attack', 'defense', 'strategy'] },
    },
    tags: ['attack_buff', 'defense_buff', 'strategy_buff', 'debuff_attack', 'debuff_defense', 'debuff_strategy'],
    output: [],
  },
  /** 同仇敌忾（鲁肃主战法·被动）：我军全体每次受到伤害后，其距离 1 以内的友军全体（含自己）
   *  受到伤害降低 2%、造成所有伤害提升 2%（均受谋略）。调研无成长率条目，按用户确认暂用 0.01/点
   *  （谋略 80→2%、180→3%/层）。最多 8 层，持续至战斗结束。施法者阵亡后仍生效。 */
  tongchou_dikai: {
    id: 'tongchou_dikai',
    name: '同仇敌忾',
    type: 'passive',
    timing: 'battle_start',
    range: 3,
    triggerRate: 1,
    targetMode: 'all',
    retainAfterDeath: true,
    onHurt: { victim: 'ally', applyTo: 'allies_within', withinDistance: 1, maxStacks: 8 },
    tags: ['damage_boost', 'damage_reduce'],
    output: [
      {
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: 0.02, duration: 999, direction: 'caused', strategyScaled: true, growthRate: 0.01, stacks: 1 },
      },
      {
        kind: 'inflict_status',
        status: { type: 'damage_reduce', rate: 0.02, duration: 999, strategyScaled: true, growthRate: 0.01 },
      },
    ],
  },
  /** 缓师徐持（沮授主战法·一类指挥）：已行动的敌军受到伤害后，50%（受谋略，成长率按增减伤推定 0.15/点）
   *  令目标攻/防/谋/速 -20 点，独立判定两次，可叠加至战斗结束。-20 点数不受谋略。 */
  huanshi_xuchi: {
    id: 'huanshi_xuchi',
    name: '缓师徐持',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    onHurt: {
      victim: 'enemy',
      rate: 0.5,
      rateStrategyScaled: true,
      rateGrowthRate: 0.15,
      onlyIfActed: true,
      rolls: 2,
      applyTo: 'victim',
    },
    tags: ['debuff_attack', 'debuff_defense', 'debuff_strategy', 'debuff_speed'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -20, duration: 999 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -20, duration: 999 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -20, duration: 999 } },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: -20, duration: 999 } },
    ],
  },

  // ─── 休整状态（指挥 / 主动，不同类型共存）───

  /**
   * 重整旗鼓（S 一类指挥）：准备阶段对我军群体 2 目标施加休整，第 5 回合起每回合恢复（140%，成长 1.13）。
   * 挂上时按准备阶段兵力/谋略冻结；施法者阵亡后状态仍在目标身上。
   */
  chongzheng_qigu: {
    id: 'chongzheng_qigu',
    name: '重整旗鼓',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    retainAfterDeath: true,
    tags: ['heal'],
    output: [
      { kind: 'inflict_status', status: { type: 'rest', rate: 140, growthRate: 1.13, duration: 999, startRound: 5, strategyScaled: true } },
    ],
  },
  /**
   * 援军秘策（B 一类指挥）：同重整旗鼓窗口，恢复率 103%、成长 0.850。
   */
  yuanjun_mice: {
    id: 'yuanjun_mice',
    name: '援军秘策',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    retainAfterDeath: true,
    tags: ['heal'],
    output: [
      { kind: 'inflict_status', status: { type: 'rest', rate: 103, growthRate: 0.85, duration: 999, startRound: 5, strategyScaled: true } },
    ],
  },
  /**
   * 养精蓄锐（B 准备主动）：友军全体休整 2 回合，122%，成长 1.15。
   * 目标栏写「群体 2」、效果写「全体」——按效果全文军。
   */
  yangjing_xurui: {
    id: 'yangjing_xurui',
    name: '养精蓄锐',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.45,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [
      { kind: 'inflict_status', status: { type: 'rest', rate: 122, growthRate: 1.15, duration: 2, strategyScaled: true } },
    ],
  },
  /**
   * 休整（D 主动）：友军群体 1–2 目标休整 2 回合，87%。
   * 成长率 §七未列，暂不编造——先按 1.15 占位，与养精蓄锐同量级，待用户改。
   */
  xiuzheng: {
    id: 'xiuzheng',
    name: '休整',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    targetSide: 'ally',
    groupCount: [1, 2],
    tags: ['heal'],
    output: [
      { kind: 'inflict_status', status: { type: 'rest', rate: 87, growthRate: 1.15, duration: 2, strategyScaled: true } },
    ],
  },
  /**
   * 收拢（D 主动）：友军单体休整 2 回合，82%。成长率同休整，§七未列暂 1.15 占位。
   */
  shoulong: {
    id: 'shoulong',
    name: '收拢',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'single',
    targetSide: 'ally',
    tags: ['heal'],
    output: [
      { kind: 'inflict_status', status: { type: 'rest', rate: 82, growthRate: 1.15, duration: 2, strategyScaled: true } },
    ],
  },
  /**
   * 合流（B 主动）：自身 + 友军单体各恢复 131%（成长 1.375/点）。友军段 excludeSelf，避免再打到自己。
   */
  heliu: {
    id: 'heliu',
    name: '合流',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.4,
    targetMode: 'self',
    tags: ['heal'],
    output: [
      { kind: 'heal', rate: 131, strategyScaled: true, growthRate: 1.375, target: 'self' },
      {
        kind: 'heal',
        rate: 131,
        strategyScaled: true,
        growthRate: 1.375,
        targetSide: 'ally',
        targetMode: 'single',
        excludeSelf: true,
      },
    ],
  },
  /**
   * 三军之众（S 准备主动）：我军单体恢复 4 次（151%，成长 1.575/点），每次独立随机选目标。
   */
  sanjun_zhizhong: {
    id: 'sanjun_zhizhong',
    name: '三军之众',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.45,
    targetMode: 'single',
    targetSide: 'ally',
    tags: ['heal'],
    output: [
      { kind: 'heal', rate: 151, strategyScaled: true, growthRate: 1.575, targetSide: 'ally', targetMode: 'random_single' },
      { kind: 'heal', rate: 151, strategyScaled: true, growthRate: 1.575, targetSide: 'ally', targetMode: 'random_single' },
      { kind: 'heal', rate: 151, strategyScaled: true, growthRate: 1.575, targetSide: 'ally', targetMode: 'random_single' },
      { kind: 'heal', rate: 151, strategyScaled: true, growthRate: 1.575, targetSide: 'ally', targetMode: 'random_single' },
    ],
  },
  /**
   * 利兵谋胜（S 准备主动）：敌军群体策略 200%（伤害成长 2.250）+ 自身及友军单体恢复 149%（成长 1.175）。
   */
  libing_mousheng: {
    id: 'libing_mousheng',
    name: '利兵谋胜',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.5,
    targetMode: 'group',
    tags: ['damage', 'heal'],
    output: [
      { kind: 'strategy_damage', rate: 200, strategyScaled: true, growthRate: 2.25, targetMode: 'group' },
      { kind: 'heal', rate: 149, strategyScaled: true, growthRate: 1.175, target: 'self' },
      {
        kind: 'heal',
        rate: 149,
        strategyScaled: true,
        growthRate: 1.175,
        targetSide: 'ally',
        targetMode: 'single',
        excludeSelf: true,
      },
    ],
  },
  /** 青丘媚祸（妲己主战法·一类指挥）：自身受伤后 60% 使距离 4 内随机敌军单体
   *  下次行动陷入暴走（待下次行动再生效，持续到再下一次行动开始前消失，避免永控），
   *  并使其下一次攻击/策略攻击伤害降低 24%（受谋略，成长率 0.15/点；次数计数器，群体一次输出算 1 次）。 */
  qingqiu_meihuo: {
    id: 'qingqiu_meihuo',
    name: '青丘媚祸',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    onHurt: { victim: 'self', rate: 0.6, applyTo: 'skill_targets' },
    tags: ['rampage', 'damage_boost'],
    output: [
      { kind: 'inflict_status', status: { type: 'rampage', duration: 1, pendingNextAct: true } },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -0.24,
          duration: 999,
          direction: 'caused',
          strategyScaled: true,
          growthRate: 0.15,
          charges: 1,
        },
      },
    ],
  },
  /** 舍身卫主（典韦主战法·被动）：受到 2 距离内敌军伤害后 60% 对来源发动一次攻击 120%；
   *  位于前锋或中军时，前 3 回合友军受到的攻击伤害在结算前将目标改为典韦。 */
  sheshen_weizhu: {
    id: 'sheshen_weizhu',
    name: '舍身卫主',
    type: 'passive',
    timing: 'battle_start',
    range: 2,
    triggerRate: 1,
    targetMode: 'self',
    onHurt: { victim: 'self', rate: 0.6, applyTo: 'source', sourceMaxDistance: 2 },
    redirectAllyPhysical: { rounds: 3, positions: ['前锋', '中军'] },
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 120 }],
  },

  // ─── 批量16：运筹决胜（司马师）───

  /**
   * 运筹决胜（司马师主战法·二类指挥）：自身每次试图发动主动战法前判定。
   * 30% 令随机敌军单体暴走 1 回合；50% 对敌军全体处于混乱/暴走的目标发动一次策略攻击 220%（受谋略，成长率 1.585：用户战报 5178 兵 / 谋略 215 / 目标谋略 78 / 增减伤 0 → 849）。
   * 携带两个主动且本回合都进入发动率判定 = 触发两次；准备完成释放、混乱/犹豫无法判定主动、施法者阵亡均不触发。
   */
  yunchou_juesheng: {
    id: 'yunchou_juesheng',
    name: '运筹决胜',
    type: 'command',
    phase: 'round',
    roundTrigger: 'before_active',
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['rampage', 'damage'],
    output: [
      {
        kind: 'inflict_status',
        status: { type: 'rampage', duration: 1 },
        chance: 0.3,
        targetSide: 'enemy',
        targetMode: 'random_single',
      },
      {
        kind: 'strategy_damage',
        rate: 220,
        strategyScaled: true,
        growthRate: 1.585,
        chance: 0.5,
        targetMode: 'all',
        requireStatuses: ['confusion', 'rampage'],
      },
    ],
  },

  // ─── 批量17：七步释嫌（曹植）───

  /**
   * 七步释嫌（曹植主战法·二类指挥）：我军全体每次发动普攻、试图发动主动或追击时，
   * 对随机敌军单体施加「下一次造成的伤害降低 6%」（谋略成长率待补，先固定 6%），可叠加，
   * 目标造成伤害后清空层数。每累计 7 次对我军群体恢复（135%，成长 1.46/点；二类指挥按实时兵力结算）。
   * 成长率由战报反推：谋略 213 → 生效 329%；兵力 3263 → 477（3088 引擎公式 463，战报 464 差 1 为八舍九入后 floor）。
   */
  qibu_shixian: {
    id: 'qibu_shixian',
    name: '七步释嫌',
    type: 'command',
    phase: 'round',
    roundTrigger: 'ally_act',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_boost', 'heal'],
    allyActEvery: {
      count: 7,
      output: [{ kind: 'heal', rate: 135, strategyScaled: true, growthRate: 1.46, targetSide: 'ally', targetMode: 'group' }],
    },
    output: [
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -0.06,
          duration: 999,
          direction: 'caused',
          charges: 1,
          chargesStack: true,
          stacks: 1,
        },
        targetSide: 'enemy',
        targetMode: 'random_single',
      },
    ],
  },

  // ─── 批量18：怀德畏威（司马昭）───

  /**
   * 怀德畏威（司马昭主战法·主动 S）：40% / 距离 5。
   * 令谋略最低的友军单体对敌军随机单体发动一次攻击 160%（借友军面板兵力与增伤，creditToId 归司马昭）；
   * 自身对敌军群体 2 目标策略攻击 160%（受谋略，成长率 1.75：战报 兵力5905/谋略222/目标谋略78 → 有效率408%，引擎 851 / 战报 850）；
   * 两段目标重合则该敌军混乱 1 回合。无存活友军时跳过物理段，策略照打。
   */
  huaide_weiwei: {
    id: 'huaide_weiwei',
    name: '怀德畏威',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    targetSide: 'enemy',
    groupCount: 2,
    tags: ['damage', 'confusion'],
    output: [
      {
        kind: 'physical_damage',
        rate: 160,
        targetMode: 'random_single',
        attacker: 'lowest_strategy_ally',
      },
      {
        kind: 'strategy_damage',
        rate: 160,
        strategyScaled: true,
        growthRate: 1.75,
        targetMode: 'group',
        groupCount: 2,
      },
      {
        kind: 'inflict_status',
        status: { type: 'confusion', duration: 1 },
        onlyIfOverlapPrevious: true,
      },
    ],
  },
};
