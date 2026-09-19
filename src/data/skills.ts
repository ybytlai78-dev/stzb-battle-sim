/**
 * 内置战法数据（v0.4：主动/准备/追击/指挥/被动）
 * 全部数值严格按《通用战法调研.md》描述（满级效果）。
 * 治疗战法恢复率成长率以《谋略战法受谋略成长调研.md》§七为准，不得用 0.7 惯例估。
 */
import type { CreateStatus, Skill, SkillOutput } from '../engine/types';

/**
 * 举抑臧否（许劭）单属性效果组：随机选取属性后一次性结算的四段 ——
 * ① 该属性最低的敌军单体 −20（受谋略）；② 60% 概率 犹豫/怯战/围困 之一；
 * ③ 该属性最高的友军单体 +20（受谋略）；④ 60% 概率 先手/洞察/无视规避 之一。
 * 持续时间口径（官方「持续 1 回合」）：
 *  - 控制 / 属性 / 洞察：行动中施加 → duration 2（覆盖目标下一个行动回合，沿用辕门射戟用户口径）；
 *  - 先手（priority）：duration 1（只影响下一回合出手顺序；duration 2 会连吃两次排序）；
 *  - 无视规避：消耗制（由下一次造成伤害消耗，tick 不递减）→ duration 999 占位。
 */
function juyizangfouOption(attr: 'attack' | 'defense' | 'strategy'): SkillOutput[] {
  const statStatus = (amount: number): CreateStatus => {
    switch (attr) {
      case 'attack':
        return { type: 'attack_buff', amount, duration: 2, strategyScaled: true, growthRate: 0 };
      case 'defense':
        return { type: 'defense_buff', amount, duration: 2, strategyScaled: true, growthRate: 0 };
      case 'strategy':
        return { type: 'strategy_buff', amount, duration: 2, strategyScaled: true, growthRate: 0 };
    }
  };
  return [
    { kind: 'inflict_status', targetPick: `lowest_${attr}_enemy`, status: statStatus(-20) },
    {
      kind: 'inflict_status',
      targetPick: `lowest_${attr}_enemy`,
      chance: 0.6,
      status: [
        { type: 'hesitation', duration: 2 },
        { type: 'cowardice', duration: 2 },
        { type: 'siege', duration: 2 },
      ],
    },
    { kind: 'inflict_status', targetPick: `highest_${attr}_ally`, status: statStatus(20) },
    {
      kind: 'inflict_status',
      targetPick: `highest_${attr}_ally`,
      chance: 0.6,
      status: [
        { type: 'priority', duration: 1 },
        { type: 'insight', duration: 2 },
        { type: 'ignore_evasion', duration: 999 },
      ],
    },
  ];
}

export const SKILL_REGISTRY: Record<string, Skill> = {
  /** 突进（D 主动）：距离1，25%，敌军单体，攻击伤害 115% */
  tujin: {
    id: 'tujin',
    name: '突进',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.25,
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 115 }],
  },
  /** 凿穿（C 主动）：距离2，25%，敌军单体，攻击伤害 135% */
  zaochuan: {
    id: 'zaochuan',
    name: '凿穿',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.25,
    targetMode: 'random_single',
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

  /** 方阵突击（太史慈主战法）：追击，普攻后对目标再攻 200% 攻击伤害 + 混乱 1 回合 */
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
    targetMode: 'random_single',
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
  /** 持节镇西（卫瓘主战法·一类指挥·常驻伤害前叠层）：友军每次造成攻击伤害前攻击+（受卫瓘攻击影响）、策略伤害前谋略+（受卫瓘谋略影响）、受到伤害前防御+（受卫瓘防御影响），各可叠4层，每层持续1回合（回合结束掉1层）；每层基值 22、成长率 0.15/点 */
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
      onAttack: { maxStacks: 4, perStack: 22, growthRate: 0.15 },
      onStrategy: { maxStacks: 4, perStack: 22, growthRate: 0.15 },
      onDefense: { maxStacks: 4, perStack: 22, growthRate: 0.15 },
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
  /** 温酒斩将（A 追击）：普攻后对攻击目标再次发动猛攻（攻击伤害 200%） */
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
  /** 疮痍累身（周泰主战法·被动）：战斗开始后使自身受到的所有伤害降低 84.0%（受攻击伤害 / 受策略伤害
   *  两条各自独立的衰减轨），每当受到该类型伤害后，此类型减伤降低 1/12（12 份受击衰减，decayFifths）；
   *  位于前锋及中军时，前 2 回合援护友军全体——官方口径「为其抵挡普通攻击」，故仅普攻转移（cover 状态挂
   *  在施法者自身，由他代为承受，applyDamage 的 basic 分支判定）；同时每次受到伤害后有 50.0% 几率使
   *  攻击属性、防御属性、谋略属性提高 20.0，可叠加、持续直到战斗结束，且首次受到伤害时该效果必定触发
   *  并额外触发 1 次（onHurt.firstGuaranteed）。 */
  chuangyi_leishen: {
    id: 'chuangyi_leishen',
    name: '疮痍累身',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['damage_reduce', 'buff_attack', 'buff_defense', 'buff_strategy', 'cover'],
    output: [
      // ① 受攻击伤害降低 84%，每受该类型伤害 −1/12
      { kind: 'inflict_status', target: 'self', status: { type: 'damage_reduce', rate: 0.84, duration: 999, decayFifths: 12, damageType: 'physical' } },
      // ② 受策略伤害降低 84%，与①各自独立衰减
      { kind: 'inflict_status', target: 'self', status: { type: 'damage_reduce', rate: 0.84, duration: 999, decayFifths: 12, damageType: 'strategy' } },
      // ③ 位于前锋及中军时前 2 回合援护友军全体（施法者站位条件；cover 挂自身 = 自己代为承受）
      { kind: 'inflict_status', target: 'self', casterPositions: ['前锋', '中军'], status: { type: 'cover', duration: 2 } },
    ],
    onHurt: {
      victim: 'self',
      rate: 0.5,
      firstGuaranteed: true,
      applyTo: 'victim',
      output: [
        { kind: 'inflict_status', status: { type: 'attack_buff', amount: 20, duration: 999 } },
        { kind: 'inflict_status', status: { type: 'defense_buff', amount: 20, duration: 999 } },
        { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 20, duration: 999 } },
      ],
    },
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
    targetMode: 'random_single',
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

  /**
   * 当敌制决（于禁主战法·二类指挥·战斗开始一次性）：
   * 自身受到伤害降低 50%；受到伤害后使伤害来源受到的伤害提升 8%（受防御，成长 0.026/点），可叠加至战斗结束。
   * 反制走 onHurt.applyTo:'source'；准备阶段只跑减伤（battleStartOnce）。
   */
  dangdi_zhijue: {
    id: 'dangdi_zhijue',
    name: '当敌制决',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    battleStartOnce: true,
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_reduce', 'damage_boost'],
    onHurt: {
      victim: 'self',
      applyTo: 'source',
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: 0.08,
            duration: 999,
            direction: 'taken',
            defenseScaled: true,
            growthRate: 0.026,
          },
        },
      ],
    },
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
    targetMode: 'random_single',
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
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 22, duration: 2 }, targetSide: 'ally', targetMode: 'random_single', excludeSelf: true },
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
   *  （受谋略影响，成长率 0.18/点），同时使我军全体受到伤害时有 50% 几率恢复一定兵力
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
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.204, duration: 3, strategyScaled: true, growthRate: 0.18 } },
      { kind: 'grant_first_aid', rate: 50, healRate: 80, healGrowthRate: 0.75, duration: 3 },
    ],
  },
  /**
   * 谋议宏图（司马炎主战法·一类指挥）：官方口径「战斗开始后**首回合**」。
   * 准备阶段只释放并锁定我军全体（不结算）；效果在第 1 回合 `round_start` 后结算一次：
   *  - 减伤 30%（受谋略，成长率 0.175/点）按 8/8 挂上；第 1 回合 8/8，第 2 回合起每回合回合前 −1/8（第 8 回合 1/8）。
   *  - 士气每回合开始 +8（`roundStartRepeat`，同战法累加）：第 1 回合 +8、第 2 回合 +16、第 3 回合 +24。
   * 基准时点（用户口径 2026-09-18）：`settleOnFirstRound`——准备阶段不计数，第 1 回合才开始计数 8/8。
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
    settleOnFirstRound: true,
    tags: ['damage_reduce', 'morale_boost'],
    roundStartRepeat: {
      output: [{ kind: 'inflict_status', status: { type: 'morale_boost', amount: 8, duration: 999 } }],
    },
    output: [
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.3, duration: 999, strategyScaled: true, growthRate: 0.175, decayEighths: 8 } },
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
    targetMode: 'random_single',
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
   * 追击战法发动率 +100 个百分点（上限 100%）、追击战法伤害提升 40%（受速度属性影响），持续 1 回合。
   * 官方有效距离 3（网易技能库 200955）。
   * 受速度成长率 = **0.2532 / 点**（2026-09-16 三点实测反解，用户提供）：
   *   速度 208.8 → 72%、256.9 → 84%、281.4 → 91%（游戏内实读）。
   *   在「基值 40 @ 速度 80 + 1% 粒度八舍九入」口径下三点自洽，反解区间 [0.25273, 0.25382)，
   *   取中点附近 0.2532（≈ 40/158，即 +158 速度使该效果翻倍）。
   * 伤害口径为「追击战法伤害」→ damage_boost 加 skillTypes: ['pursuit']（与发动率过滤一致）。
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
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.4,
          duration: 1,
          direction: 'caused',
          speedScaled: true,
          growthRate: 0.2532,
          skillTypes: ['pursuit'],
        },
      },
    ],
  },
  /**
   * 虎豹督军（曹纯主战法·一类指挥）：官方口径「战斗开始后**首回合**」。
   * 准备阶段只释放并锁定我军群体（有效距离内 2–3 目标，各 50%，不结算）；
   * 效果在第 1 回合 `round_start` 后结算：进行攻击的伤害提高 50%，该效果每回合开始时减少 1/8。
   * 8 份衰减时点（用户口径 2026-09-18）：**第 1 回合开始才挂上并计数 8/8** → 第 2 回合 7/8 → … → 第 8 回合 1/8。
   * 官方：指挥 A，有效距离 3（网易技能库 200739；来源 dateyuan/七将主战法调研.md §3.1）。
   * 「受攻击属性影响」成长率 = **0.25/点**（用户实测 2026-09-17：攻击 277.8 → 满层 99%、攻击 266 → 96%；
   * 反解区间 [0.24722, 0.25215)，0.25 = 基值/200 即 +200 攻击翻倍）。
   * 「进行攻击的伤害」沿用既有口径（大赏三军 / 强势 / 冲锋同为不过滤伤害类型）。
   */
  hubao_dujun: {
    id: 'hubao_dujun',
    name: '虎豹督军',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    groupCount: [2, 3],
    retainAfterDeath: true,
    settleOnFirstRound: true,
    tags: ['damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: 0.5, duration: 999, direction: 'caused', attackScaled: true, growthRate: 0.25, decayEighths: 8 },
      },
    ],
  },
  /**
   * 令明负榇（庞德主战法·一类指挥）：战斗开始后前 3 回合，每回合使我军群体（有效距离内 2 目标）
   * 骑兵及步兵攻击造成的伤害提高 6%（同战法累加，满 3 层 18% 停止），持续直到战斗结束；
   * 第 4 回合起进入分兵状态（伤害率 50%），持续直到战斗结束。
   * 官方：指挥 A，有效距离 4（来源 scripts/skill_extra.json + dateyuan 调研）。
   * 「受速度属性影响」成长率未确认 → 留空（split 不给缩放，按基值）。
   * 引擎配套：delayedOutput 新增「非伤害输出」分支（此前只能打伤害），本战法为首个用例。
   */
  lingming_fuchen: {
    id: 'lingming_fuchen',
    name: '令明负榇',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    retainAfterDeath: true,
    tags: ['damage_boost', 'split'],
    roundRepeat: { startRound: 1, endRound: 3, rate: 1 },
    delayedOutput: {
      atRound: 4,
      targetMode: 'group',
      output: [{ kind: 'inflict_status', status: { type: 'split', duration: 999, rate: 50 } }],
    },
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry', 'infantry'],
        status: {
          type: 'damage_boost',
          rate: 0.06,
          duration: 999,
          direction: 'caused',
          stacks: 1,
          maxStacks: 3,
        },
      },
    ],
  },
  /**
   * 怀橘遗亲（陆绩主战法·一类指挥）：每回合开始时，降低自身与我军除大营外友军单体 10 点攻击/防御/谋略，
   * 并提升我军大营 20 点攻击/防御/谋略，均持续至该回合结束。
   * 官方：指挥 C，有效距离 2，目标「我军群体（有效距离内 5 个目标）」——来源 scripts/skill_extra.json。
   * 引擎配套：「按站位筛友军」= positions + targetSide:'ally'（本轮扩展；此前 positions 仅用于敌军落首箭）。
   */
  huai_ju_yiqin: {
    id: 'huai_ju_yiqin',
    name: '怀橘遗亲',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['attack_buff', 'defense_buff', 'strategy_buff'],
    roundStartRepeat: {
      output: [
        {
          kind: 'inflict_status',
          target: 'self',
          applyAll: true,
          status: [
            { type: 'attack_buff', amount: -10, duration: 1 },
            { type: 'defense_buff', amount: -10, duration: 1 },
            { type: 'strategy_buff', amount: -10, duration: 1 },
          ],
        },
        {
          kind: 'inflict_status',
          targetSide: 'ally',
          targetMode: 'random_single',
          positions: ['前锋', '中军'],
          excludeSelf: true,
          applyAll: true,
          status: [
            { type: 'attack_buff', amount: -10, duration: 1 },
            { type: 'defense_buff', amount: -10, duration: 1 },
            { type: 'strategy_buff', amount: -10, duration: 1 },
          ],
        },
        {
          kind: 'inflict_status',
          targetSide: 'ally',
          targetMode: 'all',
          positions: ['大营'],
          applyAll: true,
          status: [
            { type: 'attack_buff', amount: 20, duration: 1 },
            { type: 'defense_buff', amount: 20, duration: 1 },
            { type: 'strategy_buff', amount: 20, duration: 1 },
          ],
        },
      ],
    },
    output: [],
  },
  /**
   * 帝临回光（灵帝主战法·一类指挥）：战斗开始后第 3 回合起，以无法恢复兵力（围困）为代价，
   * 使自身攻击距离 +1、进入分兵状态（伤害率 50%，受谋略属性影响），同时令敌军群体陷入恐慌
   * （每回合损失兵力，伤害率 69%，受谋略属性影响），持续直到战斗结束；恐慌伤害无视规避。
   * 官方：指挥 A，有效距离 5，目标「自己」（来源 scripts/skill_extra.json）。
   * 「受谋略属性影响」的分兵 50% / 恐慌 69% 成长率未确认 → 留空（分兵不给缩放字段、
   * 恐慌 growthRate: 0 = 不缩放按基值）。恐慌为 DoT（行动时跳伤，不经规避判定，与官方「无视规避」一致）。
   * 引擎配套：新增「攻击距离提高」机制（range_buff 状态 + target.ts attackRangeOf，只放大普攻可达距离，
   * 不影响战法有效距离）。
   */
  diling_huiguang: {
    id: 'diling_huiguang',
    name: '帝临回光',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    retainAfterDeath: true,
    tags: ['siege', 'split', 'panic', 'damage', 'range_buff'],
    delayedOutput: {
      atRound: 3,
      output: [
        // ① 无法恢复兵力（围困）
        { kind: 'inflict_status', target: 'self', status: { type: 'siege', duration: 999 } },
        // ② 攻击距离 +1
        { kind: 'inflict_status', target: 'self', status: { type: 'range_buff', amount: 1, duration: 999 } },
        // ③ 分兵 50%（受谋略，成长率未确认 → 留空）
        { kind: 'inflict_status', target: 'self', status: { type: 'split', duration: 999, rate: 50 } },
        // ④ 敌军群体恐慌 69%（受谋略，成长率未确认 → 留空）
        {
          kind: 'inflict_status',
          targetSide: 'enemy',
          targetMode: 'all',
          status: { type: 'panic', duration: 999, rate: 69, growthRate: 0 },
        },
      ],
    },
    output: [],
  },
  /**
   * 列营守险（SP姜维主战法·主动）：使我军全体攻击、防御、速度、谋略属性提高 29.2（受谋略属性影响），
   * 持续 2 回合；同时友军全体受到下 3 次伤害时有 50% 几率进入规避状态，免疫该次伤害；
   * 若自身士气高昂时，规避状态的目标变为我军全体。
   * 官方：主动 A，有效距离 4，发动率 40%，目标「我军群体（有效距离内 3 个目标）」、可用兵种弓/步
   * （scripts/skill_extra.json id 200072；挂槽依据 scripts/hero_extra.json「SP姜维 methodName 列营守险」）。
   * 「受谋略属性影响」的四维 29.2 成长率未确认 → 留空（strategyScaled: true 但不给 growthRate → 引擎不缩放、用基值）。
   * 引擎配套：① 概率规避 evade_chance（受击消耗 1 次机会并掷率，命中完全免疫；并入 consumeEvasion 统一入口）
   *           ② morale_branch.by:'caster'（按施法者自身士气整体判定一次，此前仅逐目标判目标士气）
   * 目标口径（用户 2026-09-16 确认）：「友军全体」= **不含施法者自身**（非高昂分支走 excludeSelf: true）；
   * 士气高昂（>100）时目标变为「我军全体」= **含自身**（high 分支不带 excludeSelf）。
   */
  lieying_shouxian: {
    id: 'lieying_shouxian',
    name: '列营守险',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff', 'evasion'],
    output: [
      // ① 我军全体四维 +29.2（受谋略，成长率 0.115/点；用户实测：谋略 195 → +42.4）
      {
        kind: 'inflict_status',
        applyAll: true,
        status: [
          { type: 'attack_buff', amount: 29.2, duration: 2, strategyScaled: true, growthRate: 0.115 },
          { type: 'defense_buff', amount: 29.2, duration: 2, strategyScaled: true, growthRate: 0.115 },
          { type: 'strategy_buff', amount: 29.2, duration: 2, strategyScaled: true, growthRate: 0.115 },
          { type: 'speed_buff', amount: 29.2, duration: 2, strategyScaled: true, growthRate: 0.115 },
        ],
      },
      // ② 士气分支（按施法者自身）：高昂 → 规避给我军全体；否则友军全体（不含自身）
      {
        kind: 'morale_branch',
        by: 'caster',
        high: [
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            targetMode: 'all',
            status: { type: 'evade_chance', rate: 0.5, charges: 3, duration: 2 },
          },
        ],
        low: [
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            targetMode: 'all',
            excludeSelf: true,
            status: { type: 'evade_chance', rate: 0.5, charges: 3, duration: 2 },
          },
        ],
      },
    ],
  },
  /**
   * 九伐中原（XP姜维主战法·被动）：自身每次发动主动战法后，对敌军群体发动一次攻击（伤害率 90%）
   * 和一次策略攻击（伤害率 90%，受谋略属性影响），本场战斗共计可发动九次；
   * 每回合开始时，自身造成所有伤害提升 5%（受谋略属性影响），可叠加，持续至战斗结束。
   * 官方：被动 A，有效距离 5，目标「敌军群体」，可用兵种弓/步/骑（scripts/skill_extra.json id 200290）。
   * 挂槽依据 dateyuan/hero_growth_verified.json「XP姜维（蜀·骑，hero_id 100806）→ 九伐中原」。
   * 「受谋略属性影响」的策略伤害 90% 与每回合增伤 5% 成长率未确认 → 留空
   * （strategyScaled 标记在、不给 growthRate → 引擎按基值不缩放）。
   * 引擎配套：新增被动 `afterActive` 钩子（每次主动战法成功后触发 + maxTriggers 整场次数上限，
   * 计数走 ctx.afterActiveCounters），与二类指挥 after_first_active（仅本回合首次）区分。
   * ⚠️ 「敌军群体」官方未写目标数 → 按惯例取 2 目标（groupCount: 2）。
   */
  jiufa_zhongyuan: {
    id: 'jiufa_zhongyuan',
    name: '九伐中原',
    type: 'passive',
    range: 5,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['damage', 'damage_boost'],
    afterActive: {
      maxTriggers: 9,
      output: [
        { kind: 'physical_damage', rate: 90, targetMode: 'group', groupCount: 2 },
        { kind: 'strategy_damage', rate: 90, strategyScaled: true, targetMode: 'group', groupCount: 2 },
      ],
    },
    output: [
      // 每回合开始：自身造成所有伤害 +5%（受谋略，成长率未确认 → 留空），可叠加、持续至战斗结束
      {
        kind: 'inflict_status',
        target: 'self',
        status: {
          type: 'damage_boost',
          rate: 0.05,
          duration: 999,
          direction: 'caused',
          stacks: 1,
          strategyScaled: true,
        },
      },
    ],
  },
  /**
   * 巧音唤蝶（大乔主战法·主动）：对敌军群体发动一次策略攻击（伤害率 176%，受谋略属性影响），
   * 并使其陷入燃烧状态——当目标兵力高于初始兵力 50% 时受到一次策略伤害（伤害率 86%，受谋略属性影响），
   * 持续 1 回合；同时使我军群体恢复一定兵力（恢复率 161%，受谋略属性影响），并使其进入休整状态——
   * 当目标兵力低于初始兵力 50% 时恢复一定兵力（恢复率 82%，受谋略属性影响），持续 1 回合。
   * 官方：主动 S，有效距离 5，发动率 35%，目标「敌军群体（有效距离内 2 个目标）」，可用兵种步
   * （scripts/skill_extra.json）。「受谋略属性影响」各项成长率未确认 → 留空
   * （strategyScaled 标记在、不给 growthRate → 引擎按基值不缩放）。
   * 引擎配套：兵力阈值条件 troopRatio —— 段级（`heal.troopRatio`）与状态级（`burning` / `rest` 的 troopRatio，
   * 在 tickDots / tickRests 跳结算时按携带者当前兵力判定）。
   */
  qiaoyin_huandie: {
    id: 'qiaoyin_huandie',
    name: '巧音唤蝶',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'burning', 'heal', 'rest'],
    output: [
      // ① 敌军群体策略攻击 176%（受谋略，成长率未确认 → 留空）
      { kind: 'strategy_damage', rate: 176, strategyScaled: true },
      // ② 燃烧状态（1 回合）：兵力高于初始 50% 时才跳伤 86%（受谋略，成长率留空）
      {
        kind: 'inflict_status',
        status: { type: 'burning', duration: 1, rate: 86, growthRate: 0, troopRatio: { above: 50 } },
      },
      // ③ 我军群体恢复 161%（受谋略，成长率留空）
      {
        kind: 'heal',
        rate: 161,
        strategyScaled: true,
        growthRate: 0,
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
      },
      // ④ 休整状态（1 回合）：兵力低于初始 50% 时才跳恢复 82%（受谋略，成长率留空）
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
        status: { type: 'rest', duration: 1, rate: 82, growthRate: 0, strategyScaled: true, troopRatio: { below: 50 } },
      },
    ],
  },
  /**
   * 魏武之泽（曹丕主战法）：主动战法，40%，我军群体免疫怯战（cowardice_immune，持续期间无法被施加怯战），
   * 普通攻击与追击战法造成的伤害提高 15%（受谋略，成长率 0.08/点），每回合可两次普攻，持续 2 回合。
   * 官方措辞「普通攻击和追击战法」→ 按 damageClassKey 拆**两条**分类键：
   *   `全域|普通`（damageSource basic）与 `全域|追击`（skillTypes ['pursuit']）——分类键不同 → 各自共存、进同一加算池。
   * 成长率 0.08 = 用户实测反解（谋略 197.6 → 24%；区间 [0.0757, 0.0842)，取窗口内较整值 0.08）。
   * 免疫怯战已建模（cowardice 施加前判定 hasStatus(target,'cowardice_immune') → 拦截并推
   * `cowardice_immune_blocked` 事件；只挡怯战，不动混乱/暴走/犹豫——那是洞察的口径）。
   */
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
      { kind: 'inflict_status', status: { type: 'cowardice_immune', duration: 2 } },
      { kind: 'inflict_status', status: { type: 'combo', duration: 2 } },
      {
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: 0.15, duration: 2, direction: 'caused', damageSource: 'basic', strategyScaled: true, growthRate: 0.08 },
      },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.15,
          duration: 2,
          direction: 'caused',
          skillTypes: ['pursuit'],
          strategyScaled: true,
          growthRate: 0.08,
        },
      },
    ],
  },
  /** 强势（张春华主战法）：主动战法，40%，使敌军群体进行攻击时的伤害降低 48%（受谋略，成长率 0.225/点），并使其陷入犹豫状态，无法发动主动战法，持续 2 回合 */
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
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: -0.48, duration: 2, direction: 'caused', strategyScaled: true, growthRate: 0.225 } },
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
  /**
   * 诸葛锦囊（诸葛亮主战法·主动 35%）：我军全体减伤 35%（受谋略，成长率 0.25/点）、
   * 增伤 14%（受谋略但**实测不随谋略变** → growthRate 0），持续 2 回合。
   * 成长率来源：用户实测（谋略 373.1 → 减伤 108%、增伤 14%）——
   * 减伤反解区间 [0.24872, 0.25213)，取整候选 0.25（翻倍阈值 140 谋略）。
   * ⚠️ 官方描述另有「自身获得先手」「目标已有该效果时额外恢复 150%」两条，引擎未建模。
   */
  zhuge_jinnang: {
    id: 'zhuge_jinnang',
    name: '诸葛锦囊',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.4,
    targetMode: 'group',
    targetSide: 'ally',
    groupCount: 3,
    tags: ['damage_reduce', 'damage_boost', 'heal'],
    output: [
      // ① 受策略攻击伤害降低 35%（受谋略，成长率 0.25）——版本 A 口径：仅策略轨
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.35, duration: 2, strategyScaled: true, growthRate: 0.25, damageType: 'strategy' } },
      // ② 造成攻击/策略伤害提高 14%（实测不随谋略变 → growthRate 0）
      { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.14, duration: 2, direction: 'caused', strategyScaled: true, growthRate: 0 } },
      // ③ 自身获得先手 2 回合（priority 状态；主动战法授予型，区别于先驱突击的指挥 priorityRounds）
      { kind: 'inflict_status', target: 'self', status: { type: 'priority', duration: 2 } },
    ],
    // ④ 发动时目标已有诸葛锦囊效果 → 额外恢复该目标兵力（恢复率 150%，固定）
    repeatBonus: { output: [{ kind: 'heal', rate: 150, strategyScaled: false, growthRate: 0 }] },
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
  /**
   * 宣威再战（张绣主战法·追击）：发动率 100%。
   * 前 3 回合：普攻后对攻击目标发动一次攻击（伤害率 150%）。
   * 第 4 回合起：普攻后对敌军单体随机发动 1–3 次攻击（伤害率 150%），
   * 每次目标独立判定、无视距离。
   */
  xuanwei_zaizhan: {
    id: 'xuanwei_zaizhan',
    name: '宣威再战',
    type: 'pursuit',
    range: 5,
    triggerRate: 1,
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: 150, endRound: 3 },
      {
        kind: 'physical_damage',
        rate: 150,
        startRound: 4,
        targetMode: 'random_single',
        ignoreRange: true,
        repeats: [1, 3],
      },
    ],
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
      // 速度 +41（受谋略，成长率 0.075/点；用户实测：谋略 153.5 → 46.5、158.4 → 46.9）
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: 41, duration: 3, strategyScaled: true, growthRate: 0.075 } },
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
  /** 名士在野（汉·四星司马徽主战法·一类指挥，不挂群五星）：友军全体谋略 +35；每回合 50% 几率受到攻击伤害下降 22%（受谋略，负增伤实现），持续 1 回合 */
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

  /** 魏武之世（曹操·魏主战法·一类指挥）：本场战斗中，使敌军全体攻击/防御/谋略/速度属性下降 15%（受谋略影响，基础值锚定谋略 80，成长率 0.045/点），
   *  按目标当前生效属性（含点数增减后）结算百分比；同时使我军全体攻击距离 +1（range_buff，只放大普攻可达距离）。
   *  官方 desc 为两版本拼接（「攻击距离+1」/「主动战法距离+1」，effect 标签同时含「攻击距离提高;战法有效距离提高」），
   *  按 gen_skill_data 的 dedupeDesc 清洗口径取前半 → 攻击距离。 */
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
    tags: ['debuff_attack', 'debuff_defense', 'debuff_strategy', 'debuff_speed', 'range_buff'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.045 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.045 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.045 } },
      { kind: 'inflict_status', status: { type: 'speed_buff', amount: -15, percent: true, duration: 999, strategyScaled: true, growthRate: 0.045 } },
      // 我军全体攻击距离 +1（官方 effect 标签「攻击距离提高」）
      { kind: 'inflict_status', targetSide: 'ally', targetMode: 'all', status: { type: 'range_buff', amount: 1, duration: 999 } },
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
    targetMode: 'random_single',
    tags: ['damage', 'split'],
    output: [
      { kind: 'inflict_status', status: { type: 'split', duration: 1, rate: 60 }, target: 'self' },
      { kind: 'strategy_damage', rate: 70.2, strategyScaled: true, growthRate: 0.69 },
    ],
  },
  /**
   * 烈火焚舟（黄盖主战法·追击）：普通攻击后，使攻击目标陷入燃烧状态（伤害率 150%，受谋略，成长 1.35），持续 2 回合。
   * 目标已处于烈火焚舟的燃烧状态时：立即引爆剩余燃烧伤害（剩余回合数 × 每次燃烧伤害）并移除该燃烧，
   * 再使目标及其相邻敌军陷入伤害率 270%（受谋略，成长 2.26）、持续 1 回合的燃烧状态。士气降低暂未建模。
   */
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
        status: { type: 'burning', duration: 2, rate: 150, growthRate: 1.35 },
        detonate: { rate: 270, growthRate: 2.26, duration: 1, adjacent: true },
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
    targetMode: 'random_single',
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

  /** 怯心夺志（A 追击 30%）：普攻后对攻击目标再次猛攻 200%，并使其犹豫（无法发动主动战法）1 回合 */
  qiexin_duozhi: {
    id: 'qiexin_duozhi',
    name: '怯心夺志',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.3,
    tags: ['damage', 'hesitation'],
    output: [
      { kind: 'physical_damage', rate: 200 },
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 1 } },
    ],
  },
  /** 钝兵挫锐（A 追击 30%）：普攻后对攻击目标再次猛攻 200%，并使其怯战 1 回合 */
  dunbing_cuorui: {
    id: 'dunbing_cuorui',
    name: '钝兵挫锐',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.3,
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

  /** 一骑当千（S 主动）：1 回合准备，对敌军全体发动一次猛烈攻击（攻击伤害 280%） */
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
    targetMode: 'random_single',
    tags: ['damage', 'debuff_attack', 'debuff_defense', 'debuff_strategy'],
    output: [
      { kind: 'strategy_damage', rate: 178, strategyScaled: true, growthRate: 1.85, targetMode: 'random_single' },
      { kind: 'strategy_damage', rate: 178, strategyScaled: true, growthRate: 1.85, targetMode: 'random_single' },
      { kind: 'strategy_damage', rate: 178, strategyScaled: true, growthRate: 1.85, targetMode: 'random_single' },
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: -18, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -18, duration: 2 } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -18, duration: 2 } },
    ],
  },
  /** 妖术（S 主动 50%）：1 回合准备，使敌军群体陷入暴走状态（无差别攻击），持续 2 回合 */
  yaoshu: {
    id: 'yaoshu',
    name: '妖术',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.5,
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: 180, targetMode: 'random_single' },
      { kind: 'strategy_damage', rate: 143, strategyScaled: true, growthRate: 1.0, targetMode: 'random_single' },
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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
    targetMode: 'random_single',
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

  /** 难知如阴（法正主战法·二类指挥）：每 2 回合使友军单体在 1 回合内主动主战法发动率提高 120%（trigger_boost，
   *  与基础发动率**直接相加**：35% + 120% → 封顶 100%，即必定发动——用户确认口径，见 boostedBaseRate），
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
      { kind: 'inflict_status', status: { type: 'trigger_boost', rate: 1.2, duration: 1, additive: true } },
      { kind: 'inflict_status', status: { type: 'jump_prep', rate: 0.6, duration: 1 } },
    ],
  },
  /** 黄天余音（张宁主战法·主动）：吸取敌军单体 26 全属性（受谋略，成长率 0.20/点）并附加于自身与友军单体，持续 1 回合。
   *  先按当前谋略结算吸取/自身，再按补给后的谋略结算队友（输出顺序：敌 → 自身 → 友军）。
   *  敌军随机单体吸四维、友军随机单体加四维（各只选 1 人，applyAll）。 */
  huangtian_yuyin: {
    id: 'huangtian_yuyin',
    name: '黄天余音',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'],
    output: [
      {
        kind: 'inflict_status',
        applyAll: true,
        status: [
          { type: 'attack_buff', amount: -26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'defense_buff', amount: -26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'strategy_buff', amount: -26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'speed_buff', amount: -26, duration: 1, strategyScaled: true, growthRate: 0.2 },
        ],
      },
      {
        kind: 'inflict_status',
        target: 'self',
        applyAll: true,
        status: [
          { type: 'attack_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'defense_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'speed_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'strategy_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
        ],
      },
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'random_single',
        excludeSelf: true,
        applyAll: true,
        status: [
          { type: 'attack_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'defense_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'strategy_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
          { type: 'speed_buff', amount: 26, duration: 1, strategyScaled: true, growthRate: 0.2 },
        ],
      },
    ],
  },
  /** 母仪浮梦（何太后主战法·一类指挥）：战斗开始后使我军全体首次受击规避（1 层）；
   *  前 4 回合敌军全体进行攻击/策略攻击时 60% 使本次伤害降低 40%（受谋略，成长率 0.20/点，造成侧负增伤）。
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
        status: { type: 'damage_boost', rate: -0.4, duration: 1, direction: 'caused', strategyScaled: true, growthRate: 0.2 },
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
    targetMode: 'random_single',
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
        targetMode: 'random_single',
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
    targetMode: 'random_single',
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
   * 利兵谋胜（S 准备主动，距离 4）：敌军群体策略 200%（伤害成长 2.250）+ 自身及友军单体恢复 149%（成长 1.175）。
   */
  libing_mousheng: {
    id: 'libing_mousheng',
    name: '利兵谋胜',
    type: 'active',
    prepare: true,
    range: 4,
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
        targetMode: 'random_single',
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
  /**
   * 赏顺伐逆（贾充主战法·被动）：受到恢复效果时 75% 为友军全体恢复 65%（受谋略，成长 0.325）；
   * 受到策略伤害时 75% 对伤害来源策略攻击 180%（受谋略，成长率未知取基值）。
   */
  shangshun_fani: {
    id: 'shangshun_fani',
    name: '赏顺伐逆',
    type: 'passive',
    timing: 'battle_start',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['heal', 'damage'],
    onHeal: {
      victim: 'self',
      rate: 0.75,
      applyTo: 'allies',
      output: [{ kind: 'heal', rate: 65, strategyScaled: true, growthRate: 0.325 }],
    },
    onHurt: {
      victim: 'self',
      rate: 0.75,
      damageKind: 'strategy',
      applyTo: 'source',
      sourceMaxDistance: 5,
      output: [{ kind: 'strategy_damage', rate: 180, strategyScaled: false, growthRate: 0 }],
    },
    output: [],
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
   * 对随机敌军单体施加「下一次造成的伤害降低 6%」（受谋略，成长率 0.008/点），可叠加，
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
          strategyScaled: true,
          growthRate: 0.008,
        },
        targetSide: 'enemy',
        targetMode: 'random_single',
      },
    ],
  },

  // ─── 批量19：谋谟帷幄（贾诩）／持玺兴兵（卫子夫）───

  /**
   * 谋谟帷幄（贾诩主战法·二类指挥 S）：我军全体（含施法者自己）每次试图发动主动战法前，
   * 由施法者按 60% 判定，命中则对敌军单体发动一次策略攻击（171%，受谋略，**成长率 1.825/点** 已实测确认）。
   * 同时当**本次发动者**兵力低于其初始兵力 60% 时，其每回合首次试图发动主动时会额外发动一次
   * 策略攻击（76%，受谋略）——追加段独立判定，沿用同一 60%。
   * 「每回合首次」按「回合 × 战法 × 施法者 × 发动者」去重（oncePerRoundPerTarget）。
   * 引擎配套机制：roundTrigger 'ally_before_active' + extraByTroopRatio。
   * 成长率来源：用户实测 4 点（330 谋略/7228 兵/+42%/目标 302.1 → 1111 等）反解区间 [1.819, 1.826)，
   * 与《谋略战法受谋略成长调研.md》§6.2 大明州表「谋谟帷幄 171 / 1.825」逐位一致。
   * ⚠️ 未确认：①追加 76% 段受谋略成长率（暂 0，取基值）；②伤害按**触发者自身**谋略缩放
   *   （实测：330 谋略的队友触发按 330 算、贾诩自身按 319.7 算），引擎现按施法者缩放 → 待 mechanic 树改。
   */
  moumou_weiwo: {
    id: 'moumou_weiwo',
    name: '谋谟帷幄',
    type: 'command',
    phase: 'round',
    roundTrigger: 'ally_before_active',
    oncePerRoundPerTarget: true,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    extraByTroopRatio: {
      cond: { below: 60 },
      output: [
        { kind: 'strategy_damage', rate: 76, strategyScaled: true, growthRate: 0, targetMode: 'random_single', chance: 0.6 },
      ],
    },
    output: [
      { kind: 'strategy_damage', rate: 171, strategyScaled: true, growthRate: 1.825, targetMode: 'random_single', chance: 0.6 },
    ],
  },

  /**
   * 持玺兴兵（卫子夫主战法·指挥 A）：友军全体（含自己）受到伤害后，若其兵力低于初始兵力 50%，
   * 为其恢复兵力（200%，受谋略）并提升其攻击、谋略属性 30 点，同时**施法者自身**攻击、谋略各下降 30 点，
   * 持续至战斗结束（duration 999）；该效果整场共可触发 3 次。
   * 官方未写「受谋略属性影响」的具体成长率 → 留空（strategyScaled 标记在、growthRate 取 0，按基值不缩放）。
   * 引擎配套机制：onHurt.troopRatio（受伤者兵力阈值）+ onHurt.maxTriggers（整场次数上限）+ onHurt.selfOutput（施法者自身落点）。
   */
  chixi_xingbing: {
    id: 'chixi_xingbing',
    name: '持玺兴兵',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal', 'buff_attack', 'buff_strategy', 'debuff_attack', 'debuff_strategy'],
    onHurt: {
      victim: 'ally',
      troopRatio: { below: 50 },
      maxTriggers: 3,
      applyTo: 'victim',
      output: [
        { kind: 'heal', rate: 200, strategyScaled: true, growthRate: 0 },
        { kind: 'inflict_status', status: { type: 'attack_buff', amount: 30, duration: 999 } },
        { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 30, duration: 999 } },
      ],
      selfOutput: [
        { kind: 'inflict_status', status: { type: 'attack_buff', amount: -30, duration: 999 } },
        { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -30, duration: 999 } },
      ],
    },
    output: [],
  },

  // ─── 批量18：怀德畏威（司马昭）───

  /**
   * 怀德畏威（司马昭主战法·主动 S）：40% / 距离 5。
   * 令谋略最低的友军单体对敌军随机单体发动一次攻击 160%（借友军面板兵力与增伤，creditToId 归司马昭）；
   * 自身对敌军群体 2 目标策略攻击 160%（受谋略，成长率 1.75：战报 兵力5905/谋略222/目标谋略78 → 有效率408%，引擎 851 / 战报 850）；
   * 两段目标重合则该敌军混乱 1 回合。无存活友军时跳过攻击段，策略照打。
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

  // ─── 拆解通用补录（现有机制可做，不含受谋略缩放）───

  /**
   * 穷追猛打（B 一类指挥）：第 4 回合起共 4 回合，我军群体（距离 3 内 2 目标）
   * 每回合 60% 获得连击（持续本回合）。窗口与措手不及同为 roundRepeat.startRound。
   */
  qiongzui_mengda: {
    id: 'qiongzui_mengda',
    name: '穷追猛打',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    targetSide: 'ally',
    retainAfterDeath: true,
    roundRepeat: { startRound: 4, endRound: 7, rate: 0.6 },
    tags: ['combo'],
    output: [{ kind: 'inflict_status', status: { type: 'combo', duration: 1 } }],
  },
  /**
   * 激昂（C 被动·round_start）：每回合 30% 使自身造成的攻击和策略伤害提高 60%，持续 1 回合。
   * 输出级 chance 与击势相同，士气修正后判定。
   */
  ji_ang: {
    id: 'ji_ang',
    name: '激昂',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'round_start',
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        chance: 0.3,
        status: { type: 'damage_boost', rate: 0.6, duration: 1, direction: 'caused' },
        target: 'self',
      },
    ],
  },
  /**
   * 疾击其后（A 追击 35%）：普攻后随机对敌军单体发动 2 次攻击（80%~140%），
   * 每次目标与伤害率独立判定。两段各带 targetMode:'random_single'，避免 repeats 首段打普攻目标。
   */
  jiji_qihou: {
    id: 'jiji_qihou',
    name: '疾击其后',
    type: 'pursuit',
    range: 5,
    triggerRate: 0.35,
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: [80, 140], targetMode: 'random_single', ignoreRange: true },
      { kind: 'physical_damage', rate: [80, 140], targetMode: 'random_single', ignoreRange: true },
    ],
  },
  /**
   * 扬威（B 追击 35%）：对普攻目标猛攻 160%，并使自身下一次攻击伤害提高 20%（charges:1）。
   */
  yangwei: {
    id: 'yangwei',
    name: '扬威',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.35,
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'physical_damage', rate: 160 },
      {
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused', charges: 1 },
        target: 'self',
      },
    ],
  },

  // ─── 拆解通用 B+ 第一阶段受击链路 ───

  /** 回马（B 被动）：自身受到普通攻击时反击（伤害率 60%）。必中、不限距离。只吃普攻。 */
  huima: {
    id: 'huima',
    name: '回马',
    type: 'passive',
    triggerRate: 1,
    timing: 'battle_start',
    range: 1,
    targetMode: 'self',
    tags: ['damage'],
    onHurt: { victim: 'self', damageSource: 'basic', applyTo: 'source', output: [{ kind: 'physical_damage', rate: 60 }] },
    output: [],
  },

  /** 空城（B 一类指挥）：前 2 回合受击 70% 当场规避免疫当次。第 3 回合起钩子不跑。 */
  kongcheng: {
    id: 'kongcheng',
    name: '空城',
    type: 'command',
    phase: 'prep',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['evasion'],
    onHurt: {
      victim: 'self',
      timing: 'before_damage',
      endRound: 2,
      rate: 0.7,
      applyTo: 'victim',
      output: [{ kind: 'grant_evasion', stacks: 1, target: 'self' }],
    },
    output: [],
  },

  /**
   * 攻其不备（S 一类指挥）：锁敌军 2 目标；其每次受到攻击伤害后 taken +11.6%，最多 5 层。策略/DoT 不叠。
   * 受速度影响：基值 11.6%（速度 80）、成长 0.02/点 —— 等价官方客户端配置 `10% + 0.02×速度`。
   * 依据（2026-09-18 反解，见《速度战法受速度成长调研.md》）：官方描述 11.6%@速80 +
   * 2024-06-19 调整（100 速单层 6%→12%、200 速前后差 4%）+ 客户端配置表
   * `intel_param=4 / constant_param=10 / attri_type=4(速度) / value_add_max=5`。
   */
  gongqi_bubei: {
    id: 'gongqi_bubei',
    name: '攻其不备',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage_boost'],
    onHurt: {
      victim: 'locked',
      damageKind: 'physical',
      applyTo: 'victim',
      maxStacks: 5,
      output: [{
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.116,
          duration: 999,
          direction: 'taken',
          speedScaled: true,
          growthRate: 0.02,
          stacks: 1,
        },
      }],
    },
    output: [],
  },

  /** 健卒不殆（A 被动）：受普攻反击 40%；受所有伤害 50% 使本次伤害降低 50%（独立判定，走士气）。 */
  jianzu_budai: {
    id: 'jianzu_budai',
    name: '健卒不殆',
    type: 'passive',
    triggerRate: 1,
    timing: 'battle_start',
    range: 1,
    targetMode: 'self',
    tags: ['damage', 'damage_reduce'],
    onHurt: [
      { victim: 'self', damageSource: 'basic', applyTo: 'source', output: [{ kind: 'physical_damage', rate: 40 }] },
      { victim: 'self', timing: 'before_damage', rate: 0.5, thisHitReduce: 0.5, applyTo: 'victim' },
    ],
    output: [],
  },

  /** 反击之策（B 一类指挥）：前 3 回合 round_start 对锁定友军逐个 75% 挂本回合反击（伤害率 100%）。 */
  fanji_zhice: {
    id: 'fanji_zhice',
    name: '反击之策',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage'],
    roundStartRepeat: {
      startRound: 1,
      endRound: 3,
      output: [{ kind: 'inflict_status', chance: 0.75, status: { type: 'counter', rate: 100, duration: 1 } }],
    },
    output: [],
  },

  /** 以诱待来（A 被动）：受击 50% 挑衅来源 1 回合（duration 2 覆盖下次行动）；来源挑衅自己时恢复 150%（不受谋略）。 */
  yiyou_dailai: {
    id: 'yiyou_dailai',
    name: '以诱待来',
    type: 'passive',
    triggerRate: 1,
    timing: 'battle_start',
    range: 5,
    targetMode: 'self',
    tags: ['taunt', 'heal'],
    onHurt: [
      {
        victim: 'self',
        rate: 0.5,
        applyTo: 'source',
        output: [{ kind: 'inflict_status', status: { type: 'taunt', duration: 2, targetId: '' } }],
      },
      {
        victim: 'self',
        onlyIfSourceTauntsVictim: true,
        applyTo: 'victim',
        output: [{ kind: 'heal', rate: 150, strategyScaled: false, growthRate: 0, target: 'self' }],
      },
    ],
    output: [],
  },

  /** 先声夺人（A 被动）：前 3 回合行动时三段各 60% 独立判定：连击、分兵 70%、敌军单体攻击 110%。 */
  xiansheng_duoren: {
    id: 'xiansheng_duoren',
    name: '先声夺人',
    type: 'passive',
    triggerRate: 1,
    timing: 'round_start',
    range: 5,
    targetMode: 'self',
    endRound: 3,
    tags: ['combo', 'split', 'damage'],
    output: [
      { kind: 'inflict_status', chance: 0.6, status: { type: 'combo', duration: 1 }, target: 'self' },
      { kind: 'inflict_status', chance: 0.6, status: { type: 'split', rate: 70, duration: 1 }, target: 'self' },
      { kind: 'physical_damage', chance: 0.6, rate: 110, targetMode: 'random_single' },
    ],
  },

  // ─── 拆解通用 B+ 第二阶段兵种阵型 ───

  /**
   * 方圆（B 一类指挥）：战斗中使我军全体步兵普攻造成伤害降低 20%，主动、追击战法伤害提高 16.8%（受防御基值，无成长率）。
   */
  fangyuan: {
    id: 'fangyuan',
    name: '方圆',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['infantry'],
        status: { type: 'damage_boost', rate: -0.2, duration: 999, direction: 'caused', damageSource: 'basic' },
      },
      {
        kind: 'inflict_status',
        troopTypes: ['infantry'],
        status: {
          type: 'damage_boost',
          rate: 0.168,
          duration: 999,
          direction: 'caused',
          damageSource: 'skill',
          skillTypes: ['active', 'pursuit'],
          defenseScaled: true,
        },
      },
    ],
  },
  /**
   * 疏数（B 一类指挥）：仅弓+骑阵容生效。弓兵防御 +50，骑兵每回合 40% 对距离 3 敌军单体代打攻击 100%。基值无成长率。
   */
  shushu: {
    id: 'shushu',
    name: '疏数',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['buff_defense', 'damage'],
    teamTroopFilter: ['archer', 'cavalry'],
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['archer'],
        status: { type: 'defense_buff', amount: 50, duration: 999 },
      },
    ],
    roundStartRepeat: {
      output: [
        {
          kind: 'physical_damage',
          rate: 100,
          attacker: 'recipient',
          troopTypes: ['cavalry'],
          chance: 0.4,
          range: 3,
          targetMode: 'random_single',
        },
      ],
    },
  },
  /**
   * 衡轭（B 一类指挥）：仅骑+步阵容生效。骑兵谋略 +50，步兵普攻造成伤害提升 50%。基值无成长率。
   */
  henge: {
    id: 'henge',
    name: '衡轭',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['buff_strategy', 'damage_boost'],
    teamTroopFilter: ['cavalry', 'infantry'],
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry'],
        status: { type: 'strategy_buff', amount: 50, duration: 999 },
      },
      {
        kind: 'inflict_status',
        troopTypes: ['infantry'],
        status: { type: 'damage_boost', rate: 0.5, duration: 999, direction: 'caused', damageSource: 'basic' },
      },
    ],
  },
  /**
   * 锋矢（B 一类指挥）：我军全体骑兵普攻造成伤害降低 25%，发动主动战法伤害提高 18%（受速度基值，无成长率；不含追击）。
   */
  fengshi: {
    id: 'fengshi',
    name: '锋矢',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry'],
        status: { type: 'damage_boost', rate: -0.25, duration: 999, direction: 'caused', damageSource: 'basic' },
      },
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry'],
        status: {
          type: 'damage_boost',
          rate: 0.18,
          duration: 999,
          direction: 'caused',
          damageSource: 'skill',
          skillTypes: ['active'],
          speedScaled: true,
        },
      },
    ],
  },
  /**
   * 鱼鳞（B 一类指挥）：仅步+弓阵容生效。步兵防御 +50，弓兵受策略伤害降低 35%。基值无成长率。
   */
  yulin: {
    id: 'yulin',
    name: '鱼鳞',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['buff_defense', 'damage_boost'],
    teamTroopFilter: ['infantry', 'archer'],
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['infantry'],
        status: { type: 'defense_buff', amount: 50, duration: 999 },
      },
      {
        kind: 'inflict_status',
        troopTypes: ['archer'],
        status: { type: 'damage_boost', rate: -0.35, duration: 999, direction: 'taken', damageType: 'strategy' },
      },
    ],
  },
  /**
   * 鹤翼（B 一类指挥）：第 1/3/5/7 回合弓兵分兵 49%（受谋略基值，无成长率），同时普攻造成伤害降低 20%，持续 1 回合。
   */
  heyi: {
    id: 'heyi',
    name: '鹤翼',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['split', 'damage_boost'],
    output: [],
    roundStartRepeat: {
      oddRounds: true,
      output: [
        {
          kind: 'inflict_status',
          troopTypes: ['archer'],
          status: { type: 'split', rate: 49, duration: 1, strategyScaled: true },
        },
        {
          kind: 'inflict_status',
          troopTypes: ['archer'],
          status: { type: 'damage_boost', rate: -0.2, duration: 1, direction: 'caused', damageSource: 'basic' },
        },
      ],
    },
  },
  /**
   * 白刃（A 一类指挥）：前 3 回合敌我全体策略造成伤害降低 35%；我军骑/步防御 +45；第 4 回合起骑/步攻击 +45 持续 3 回合。基值无成长率。
   */
  bairen: {
    id: 'bairen',
    name: '白刃',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['damage_boost', 'buff_defense', 'buff_attack'],
    output: [
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'all',
        status: { type: 'damage_boost', rate: -0.35, duration: 3, direction: 'caused', damageType: 'strategy' },
      },
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'all',
        status: { type: 'damage_boost', rate: -0.35, duration: 3, direction: 'caused', damageType: 'strategy' },
      },
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry', 'infantry'],
        status: { type: 'defense_buff', amount: 45, duration: 3 },
      },
    ],
    roundStartRepeat: {
      startRound: 4,
      endRound: 4,
      output: [
        {
          kind: 'inflict_status',
          troopTypes: ['cavalry', 'infantry'],
          status: { type: 'attack_buff', amount: 45, duration: 3 },
        },
      ],
    },
  },
  /**
   * 全军突击（A 主动 35% 距离 4）：移除我军骑/步有害效果，对敌军单体攻击 145%，并使骑/步接下来 2 次攻击伤害提高 28%（受谋略基值，无成长率）。
   */
  quanjun_tuji: {
    id: 'quanjun_tuji',
    name: '全军突击',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 3,
    targetSide: 'ally',
    tags: ['immunity', 'damage', 'damage_boost'],
    output: [
      { kind: 'remove_debuffs', troopTypes: ['cavalry', 'infantry'] },
      { kind: 'physical_damage', rate: 145, targetMode: 'random_single' },
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry', 'infantry'],
        status: { type: 'damage_boost', rate: 0.28, duration: 999, direction: 'caused', charges: 2, strategyScaled: true },
      },
    ],
  },
  /**
   * 飒沓如星（B 主动 40% 距离 2）：友军群体 2 中骑兵普攻造成伤害提升 36%（受谋略基值，无成长率）持续 2 回合，下 2 次普攻分兵 55%（不受谋略）。
   */
  sata_ruxing: {
    id: 'sata_ruxing',
    name: '飒沓如星',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_boost', 'split'],
    output: [
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry'],
        status: {
          type: 'damage_boost',
          rate: 0.36,
          duration: 2,
          direction: 'caused',
          damageSource: 'basic',
          strategyScaled: true,
        },
      },
      {
        kind: 'inflict_status',
        troopTypes: ['cavalry'],
        status: { type: 'split', rate: 55, duration: 999, charges: 2 },
      },
    ],
  },
  /**
   * 落首箭（沙摩柯 h524·准备主动 40% 距离 5）：前半口径。对敌军随机单体攻击 300%，并对大营再攻 180% + 混乱 1–2 回合（无受击增伤）。
   */
  luoshou_jian: {
    id: 'luoshou_jian',
    name: '落首箭',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage', 'confusion'],
    output: [
      { kind: 'physical_damage', rate: 300 },
      { kind: 'positional_physical_damage', positions: ['大营'], rate: 180, source: 'self' },
      { kind: 'inflict_status', positions: ['大营'], status: { type: 'confusion', duration: [1, 2] } },
    ],
  },
  /**
   * 长坂之吼（张飞 h22·准备主动 75% 距离 4）：前半口径。2 回合准备，敌军群体 2–3 目标攻击 450%，无视兵种相克（非三次单体）。
   */
  changban_zhihou: {
    id: 'changban_zhihou',
    name: '长坂之吼',
    type: 'active',
    prepare: true,
    prepareTurns: 2,
    range: 4,
    triggerRate: 0.75,
    targetMode: 'group',
    groupCount: [2, 3],
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 450, ignoresTroopCounter: true }],
  },
  /**
   * 烽火覆周（褒姒 h376·主动 50%–100% 距离 5）：火攻 95% 受谋略但无 growthRate（取基值）；连锁 60% 每次 −20%。
   */
  fenghuo_fuzhou: {
    id: 'fenghuo_fuzhou',
    name: '烽火覆周',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: [0.5, 1],
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{
      kind: 'strategy_damage',
      rate: 95,
      strategyScaled: true,
      chain: { chance: 0.6, decay: 0.2 },
    }],
  },
  /**
   * 虎步关右（夏侯渊 h435·主动 120% 距离 1）：前半口径。自身首次攻击伤害 +70% 受速度但无 growthRate（取基值），charges 1（无主动战法叠层）。
   */
  hubu_guanyou: {
    id: 'hubu_guanyou',
    name: '虎步关右',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 1.2,
    targetMode: 'self',
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [{
      kind: 'inflict_status',
      target: 'self',
      status: {
        type: 'damage_boost',
        rate: 0.7,
        duration: 999,
        direction: 'caused',
        charges: 1,
        speedScaled: true,
        damageType: 'physical',
      },
    }],
  },
  /**
   * 火兽冲锋（祝融夫人 h494·被动）：开战普攻造成伤害 +80%；每回合行动阶段 50% 对敌军单体攻击 160% 且下一次普攻 +160%（charges 1）。
   */
  huoshou_chongfeng: {
    id: 'huoshou_chongfeng',
    name: '火兽冲锋',
    type: 'passive',
    timing: 'battle_start',
    range: 4,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage', 'damage_boost'],
    output: [{
      kind: 'inflict_status',
      target: 'self',
      status: {
        type: 'damage_boost',
        rate: 0.8,
        duration: 999,
        direction: 'caused',
        damageSource: 'basic',
      },
    }],
    roundStartRepeat: {
      output: [{
        kind: 'chance_group',
        chance: 0.5,
        outputs: [
          { kind: 'physical_damage', rate: 160, targetMode: 'random_single' },
          {
            kind: 'inflict_status',
            target: 'self',
            status: {
              type: 'damage_boost',
              rate: 1.6,
              duration: 999,
              direction: 'caused',
              charges: 1,
              damageSource: 'basic',
            },
          },
        ],
      }],
    },
  },
  /**
   * 文德椒房（郭皇后 h655·二类指挥）：每回合首次主动实际释放后，我军群体 2 策略造成伤害 +10% 受谋略但无 growthRate（取基值），最多 3 层。
   */
  wende_jiaofang: {
    id: 'wende_jiaofang',
    name: '文德椒房',
    type: 'command',
    phase: 'round',
    roundTrigger: 'after_first_active',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [{
      kind: 'inflict_status',
      status: {
        type: 'damage_boost',
        rate: 0.1,
        duration: 999,
        direction: 'caused',
        damageType: 'strategy',
        strategyScaled: true,
        stacks: 1,
        maxStacks: 3,
      },
    }],
  },
  /**
   * 万箭齐发（A 主动 35% 距离 5）：敌军群体 2 攻击 150%；目标策略造成伤害 −50%（受攻击，无成长率）持续 1 回合（行动中施加 duration 2）。
   */
  wanjian_qifa: {
    id: 'wanjian_qifa',
    name: '万箭齐发',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'physical_damage', rate: 150 },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -0.5,
          duration: 2,
          direction: 'caused',
          damageType: 'strategy',
          attackScaled: true,
        },
      },
    ],
  },
  /**
   * 文伐（B 追击 20%–40%）：对攻击目标策略 228%（受谋略 2.1%/点），再使其下一次受到策略攻击伤害 +20%（taken charges 1，无成长率）。
   */
  wenfa: {
    id: 'wenfa',
    name: '文伐',
    type: 'pursuit',
    range: 0,
    triggerRate: [0.2, 0.4],
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'strategy_damage', rate: 228, strategyScaled: true, growthRate: 2.1 },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.2,
          duration: 999,
          direction: 'taken',
          damageType: 'strategy',
          charges: 1,
        },
      },
    ],
  },
  /**
   * 不攻（S 一类指挥）：自身整场怯战 + 策略造成 +25%；每回合开始后对距离 5 敌军单体策略 83%（满级基值，无成长率）。
   */
  bugong: {
    id: 'bugong',
    name: '不攻',
    type: 'command',
    phase: 'prep',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['cowardice', 'damage_boost', 'damage'],
    output: [
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 999 } },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.25,
          duration: 999,
          direction: 'caused',
          damageType: 'strategy',
        },
      },
    ],
    roundStartRepeat: {
      output: [
        {
          kind: 'strategy_damage',
          rate: 83,
          strategyScaled: true,
          targetMode: 'random_single',
          range: 5,
        },
      ],
    },
  },
  /**
   * 恃强淬锋（A 被动）：受策略伤害 −30%（受攻击，无成长率）五份衰减；回合开始或每次造成攻击伤害 +3.4%/层（受攻击，无成长率），最多 12 层至战斗结束。
   */
  shiqiang_cuifeng: {
    id: 'shiqiang_cuifeng',
    name: '恃强淬锋',
    type: 'passive',
    triggerRate: 1,
    timing: 'battle_start',
    range: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -0.3,
          duration: 999,
          direction: 'taken',
          damageType: 'strategy',
          attackScaled: true,
          decayFifths: 5,
        },
      },
    ],
    selfPhysBoost: {
      perStack: 0.034,
      maxStacks: 12,
      duration: 999,
      attackScaled: true,
      onRoundStart: true,
      onDealPhysical: true,
    },
  },

  // ─── 拆解通用 B+ 第四阶段：距离 +1 与特殊目标选择（10 个）───

  /**
   * 远攻秘策（B 一类指挥·距离 3·目标自己）：
   * ① 自身攻击 +20、谋略 +20、**攻击距离 +1**（整场常驻）；
   * ② 友军全体在战斗开始后前 3 回合也获得同样增益（**不含自身**——描述「也获得」，
   *    自身已由 ① 常驻；用户 2026-09-19 确认友军段 excludeSelf）。
   * 引擎配套：**无需新机制**（`range_buff` = 攻击距离 buff，`attackRangeOf` 已读；
   *   attack_buff / strategy_buff 点数额已有）。
   * 数值为官方满级点数（skill_extra 200210：攻击 20 / 谋略 20 / 距离 +1），无「受属性影响」→ 不缩放。
   */
  yuangong_mice: {
    id: 'yuangong_mice',
    name: '远攻秘策',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['attack_buff', 'strategy_buff', 'range_buff'],
    output: [
      { kind: 'inflict_status', target: 'self', status: { type: 'attack_buff', amount: 20, duration: 999 } },
      { kind: 'inflict_status', target: 'self', status: { type: 'strategy_buff', amount: 20, duration: 999 } },
      { kind: 'inflict_status', target: 'self', status: { type: 'range_buff', amount: 1, duration: 999 } },
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'all',
        excludeSelf: true,
        applyAll: true,
        status: [
          { type: 'attack_buff', amount: 20, duration: 3 },
          { type: 'strategy_buff', amount: 20, duration: 3 },
          { type: 'range_buff', amount: 1, duration: 3 },
        ],
      },
    ],
  },
  /**
   * 远攻之策（C 一类指挥·距离 2·我军群体 2 目标）：
   * 前 3 回合我军群体攻击 +20；每回合有几率**攻击距离 +1**（满级 100% → 必定，1 级 50%）持续本回合。
   * 实现：攻击 +20 准备阶段 duration 3；距离 +1 走 `roundStartRepeat`（第 1~3 回合回合开始必定施加
   *   `range_buff` duration 1——回合末 tick 掉，下回合重新刷，不叠层）。
   * 引擎配套：**无需新机制**（roundStartRepeat + range_buff 已有，同其疾如风/鱼鳞口径）。
   */
  yuangong_zhiche: {
    id: 'yuangong_zhiche',
    name: '远攻之策',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['attack_buff', 'range_buff'],
    output: [
      { kind: 'inflict_status', status: { type: 'attack_buff', amount: 20, duration: 3 } },
    ],
    roundStartRepeat: {
      startRound: 1,
      endRound: 3,
      output: [
        { kind: 'inflict_status', status: { type: 'range_buff', amount: 1, duration: 1 } },
      ],
    },
  },
  /**
   * 远攻奇略（C 被动·距离 1·目标自己）：
   * 自身攻击距离 +1（整场常驻）+ 进行策略攻击时伤害 +15%（固定值，无「受属性影响」→ 不缩放）。
   * 引擎配套：**无需新机制**（battle_start 被动 output + range_buff + damage_boost caused/strategy）。
   */
  yuangong_qilue: {
    id: 'yuangong_qilue',
    name: '远攻奇略',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['range_buff', 'damage_boost'],
    output: [
      { kind: 'inflict_status', target: 'self', status: { type: 'range_buff', amount: 1, duration: 999 } },
      {
        kind: 'inflict_status',
        target: 'self',
        status: { type: 'damage_boost', rate: 0.15, duration: 999, direction: 'caused', damageType: 'strategy' },
      },
    ],
  },
  /**
   * 远攻强化（C 被动·距离 1·目标自己）：
   * 自身攻击距离 +1（整场常驻）+ 攻击属性 +15 点。
   * 引擎配套：**无需新机制**（range_buff + attack_buff）。
   */
  yuangong_qianghua: {
    id: 'yuangong_qianghua',
    name: '远攻强化',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['range_buff', 'attack_buff'],
    output: [
      { kind: 'inflict_status', target: 'self', status: { type: 'range_buff', amount: 1, duration: 999 } },
      { kind: 'inflict_status', target: 'self', status: { type: 'attack_buff', amount: 15, duration: 999 } },
    ],
  },
  /**
   * 近攻（C 主动·距离 3·30%·敌军单体）：对战法有效距离内**最近**的敌军攻击 200%（固定率，不缩放）。
   * 引擎配套：**无需新机制**——`skillTargets` 新增显式 `nearest` 模式 = 有效距离内最近
   *   （inRange 按距离升序取 [0]）。注意：旧 `targetMode:'single'` 是「最近优先」退役名，
   *   `tests/listing.test.ts` 明文禁止登记表再出现；「最近」必须显式写 `nearest`。
   */
  jingong: {
    id: 'jingong',
    name: '近攻',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.3,
    targetMode: 'nearest',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 200 }],
  },
  /**
   * 远射（C 准备主动·距离 3·35%·敌军单体）：对战法有效距离内**最远**的敌军攻击 255%。
   * 引擎配套：**新增 `farthest` 目标模式**（target.ts：inRange 升序取末位；远射 / 连环段1 共用）。
   */
  yuanshe: {
    id: 'yuanshe',
    name: '远射',
    type: 'active',
    prepare: true,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'farthest',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 255 }],
  },
  /**
   * 连环（B 准备主动·距离 4·45%·敌军单体）：
   * 段1：对战法有效距离内**最远**敌军单体策略攻击 132%（受谋略）；
   * 段2：**再度**对有效距离内随机敌军单体策略攻击 198%（受谋略）——独立重选、可与段1 同目标（用户确认）。
   * 成长率：两段官方均未给 → `strategyScaled` 标记在、`growthRate` 留空（按基值），
   *   已登记 `docs/成长率待补名单.md` §三，待 `derive_growth_rate.mjs` 反解后统一补。
   */
  lianhuan: {
    id: 'lianhuan',
    name: '连环',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.45,
    targetMode: 'farthest',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [
      { kind: 'strategy_damage', rate: 132, strategyScaled: true },
      { kind: 'strategy_damage', rate: 198, strategyScaled: true, targetMode: 'random_single' },
    ],
  },
  /**
   * 兼弱攻昧（A 主动·距离 4·35%·敌军单体）：
   * 段1：对**有效距离内**生效防御最低的敌军攻击 200%；
   * 段2：对**有效距离内**生效谋略最低的敌军策略攻击 159%（受谋略，成长率未确认 → 留空按基值）。
   * 用户 2026-09-19 确认：两段都只在战法有效距离内选人；各自独立选取、可命中同一目标。
   * 引擎配套：**新增伤害段 `targetPick: '*_in_range'`**（`DamageTargetPick`；
   *   `physical_damage` / `strategy_damage` 共用，按 `unitsInSkillRange` + effectiveStat 取最低）。
   */
  jianruo_gongmei: {
    id: 'jianruo_gongmei',
    name: '兼弱攻昧',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    // 外层 targetMode 仅占位（官方目标「敌军单体」= 距离内随机）；两段的实际目标由各自 targetPick 覆盖
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: 200, targetPick: 'lowest_defense_in_range' },
      { kind: 'strategy_damage', rate: 159, strategyScaled: true, targetPick: 'lowest_strategy_in_range' },
    ],
  },
  /**
   * 始计（S 二类指挥·距离 5·目标自己）：
   * 战斗前 4 回合、**自身行动时**（用户确认走 `roundTrigger:'on_act'`，非回合开始）：
   *  ① 我军大营 下一次攻击或策略攻击伤害 +20%（受谋略，成长率未确认 → 留空按基值）；
   *  ② 敌方**兵力最多**单体 下一次攻击或策略攻击伤害 −30%（受谋略，同上）；
   *  ③ 自身受到攻击或策略攻击伤害后，于本回合内进入**洞察**（免疫混乱/犹豫/怯战/暴走/挑衅）。
   * 实现：前 4 回合窗口走 `onActSegments(startRound:1,endRound:4)`（主 `output` 为空——
   *   二类指挥 on_act 仍会锁 [自身] 目标并触发本段）；① 用 `positions:['大营']` + targetSide:'ally' 选我方大营；
   *   ② 用 `targetPick:'highest_troops_enemy'`（**新增**，按当前兵力取最高，无视距离）+ charges:1（用后即消）；
   *   ③ 用 `onHurt{ victim:'self', applyTo:'victim' }` → insight duration 1（回合末 tick 掉 = 本回合内）。
   * 注：`charges` 次数型 damage_boost 同源重复施加是**不刷新不叠加**（inflictStatus 2124 行），
   *   故每回合重挂安全。
   */
  shiji: {
    id: 'shiji',
    name: '始计',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost', 'insight'],
    output: [],
    onActSegments: [
      {
        startRound: 1,
        endRound: 4,
        output: [
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            positions: ['大营'],
            status: {
              type: 'damage_boost',
              rate: 0.2,
              duration: 999,
              direction: 'caused',
              charges: 1,
              strategyScaled: true,
            },
          },
          {
            kind: 'inflict_status',
            targetSide: 'enemy',
            targetMode: 'all',
            targetPick: 'highest_troops_enemy',
            status: {
              type: 'damage_boost',
              rate: -0.3,
              duration: 999,
              direction: 'taken',
              charges: 1,
              strategyScaled: true,
            },
          },
        ],
      },
    ],
    onHurt: {
      victim: 'self',
      applyTo: 'victim',
      output: [
        { kind: 'inflict_status', target: 'self', status: { type: 'insight', duration: 1 } },
      ],
    },
  },
  /**
   * 铁戟金戈（B 准备主动·距离 4·35%·敌军群体 2-3 目标）：
   * 每次释放 **50/50 随机**：2 目标 330% 或 3 目标 225%（用户 2026-09-19 口径，非「按存活数自动选」）。
   * 实现：`random_pick count:1` 两组互斥输出（各带 `targetMode:'group'` + groupCount 2/3 独立重选目标）；
   *   外层 `targetMode:'all'` 仅占位（不消耗 RNG，实际目标与目标数由内层段重选）。
   *   （不用 `groupCount:[2,3]`：那会随机目标数但伤害率固定，无法「2目标配 330% / 3目标配 225%」。）
   * 边界：有效距离内不足 3 人时，3 目标组按实际人数取满（skillTargets 截断）。
   * 引擎配套：**无需新机制**（random_pick + 段级 targetMode/groupCount 已有）。
   */
  tieji_jinge: {
    id: 'tieji_jinge',
    name: '铁戟金戈',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.35,
    // 外层仅占位（敌军群体候选）；实际 2/3 目标由内层 random_pick 段重选
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [
      {
        kind: 'random_pick',
        count: 1,
        options: [
          [{ kind: 'physical_damage', rate: 330, targetMode: 'group', groupCount: 2 }],
          [{ kind: 'physical_damage', rate: 225, targetMode: 'group', groupCount: 3 }],
        ],
      },
    ],
  },

  // ─── 拆解通用 B+ 第五阶段：士气组（5 个）───

  /**
   * 望风而降（A 主动·距离 5·40%·敌军单体）：
   * ① 对敌军单体发动 **2 次**策略攻击（伤害率 108%，受谋略，成长率未确认 → 留空按基值）；
   * ② 50% 几率使其陷入恐慌（伤害率 98%，受谋略，成长率未确认 → 0 = 不缩放），持续 1 回合；
   *    **若目标士气低于自身，则此几率提升至 100%**。
   * 官方：scripts/skill_extra.json id 200982（1 级 54% / 49%）。
   * 注：`scripts/_classified.json` 里本战法的 effectDesc 是旧版（漏了「并有 50% 几率…提升至 100%」），
   *   本次已按 extra 满级原文同步。
   * 引擎配套：
   *   ①「2 次」= 两段相同 `strategy_damage`（strategy_damage 无 repeats，两段各自独立结算，语义等价）；
   *   ② `morale_branch.compareTo:'caster'`（**本次新增**）：逐目标与施法者当前生效士气比较——
   *      目标士气**严格低于**自身走 low（必定恐慌），**不低于**（含相等）走 high（50% 几率）；
   *   ③ 主动战法的输出级 `chance`（**本次扩展**：原仅被动/指挥生效）——士气修正，失败跳过本段；
   *      用户 2026-09-19 口径：「凡是几率类的基本都吃士气加成」。
   * 用户确认：「低于自身」= 严格小于（相等走 50% 分支）；恐慌「持续 1 回合」= DoT duration 1（焰焚箕轸口径）。
   */
  wangfeng_erjiang: {
    id: 'wangfeng_erjiang',
    name: '望风而降',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage', 'panic'],
    output: [
      { kind: 'strategy_damage', rate: 108, strategyScaled: true },
      { kind: 'strategy_damage', rate: 108, strategyScaled: true },
      {
        kind: 'morale_branch',
        compareTo: 'caster',
        by: 'target',
        // 目标士气 ≥ 自身：50% 几率恐慌（士气修正后判定）；目标士气 < 自身：必定恐慌
        high: [
          { kind: 'inflict_status', chance: 0.5, status: { type: 'panic', duration: 1, rate: 98, growthRate: 0 } },
        ],
        low: [{ kind: 'inflict_status', status: { type: 'panic', duration: 1, rate: 98, growthRate: 0 } }],
      },
    ],
  },
  /**
   * 激水之疾（A 主动·距离 4·35%·敌军群体 2 目标）：
   * 对敌军群体发动一次策略攻击（伤害率 180%，受谋略，成长率未确认 → 留空按基值）；
   * **若目标士气低于自身**，则使其谋略属性降低 20（受谋略，成长率未确认 → 留空按基值），持续 1 回合。
   * 官方 id 200992（1 级 90% / −10）。
   * 引擎配套：`morale_branch.compareTo:'caster'` 逐目标判定；high 段为空数组（不低于自身则不打 debuff）。
   * 用户确认：「持续 1 回合」= duration 2（辕门射戟 / 举抑臧否口径，覆盖目标下一个行动回合）。
   */
  jishui_zhiji: {
    id: 'jishui_zhiji',
    name: '激水之疾',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'debuff_strategy'],
    output: [
      { kind: 'strategy_damage', rate: 180, strategyScaled: true },
      {
        kind: 'morale_branch',
        compareTo: 'caster',
        by: 'target',
        high: [],
        low: [
          {
            kind: 'inflict_status',
            status: { type: 'strategy_buff', amount: -20, duration: 2, strategyScaled: true },
          },
        ],
      },
    ],
  },
  /**
   * 蓄盈待竭（B 主动·距离 4·35%·敌军单体）：
   * 随机选择敌军单体：其士气**低于**自身 → 对该敌军发动一次攻击（伤害率 200%）；
   * **否则**（不低于，含相等）→ 提升自身攻击、防御、谋略属性 60，持续 2 回合。
   * 官方 id 200995（1 级 100% / +30）；无「受属性影响」→ 固定值不缩放。
   * 引擎配套：`morale_branch.compareTo:'caster'`
   *   （low = 目标士气 < 自身 → 攻击；high = 不低于 → 自身三维修正，段内 `target:'self'` 落回施法者）。
   * 用户确认：随机敌军单体按战法有效距离 4 内均匀随机（`targetMode:'random_single'`）。
   */
  xuying_daijie: {
    id: 'xuying_daijie',
    name: '蓄盈待竭',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage', 'attack_buff', 'defense_buff', 'strategy_buff'],
    output: [
      {
        kind: 'morale_branch',
        compareTo: 'caster',
        by: 'target',
        high: [
          { kind: 'inflict_status', target: 'self', status: { type: 'attack_buff', amount: 60, duration: 2 } },
          { kind: 'inflict_status', target: 'self', status: { type: 'defense_buff', amount: 60, duration: 2 } },
          { kind: 'inflict_status', target: 'self', status: { type: 'strategy_buff', amount: 60, duration: 2 } },
        ],
        low: [{ kind: 'physical_damage', rate: 200 }],
      },
    ],
  },
  /**
   * 胜负先征（A 被动·距离 1·目标自己）：
   * 每回合自身行动时按**自身士气**分支（用户确认档位：>100 高昂 / =100 一般 / <100 低落）：
   *  - 高昂 → 自身造成的主动、追击战法伤害 +40%，持续 1 回合；
   *  - 一般/低落 → 自身受到伤害时恢复一定兵力（恢复率 75%，受谋略，成长率未确认 → 0 = 不缩放），持续 1 回合。
   * 官方 id 200981（1 级 20% / 37.5%）。
   * 引擎配套：**无需新机制**——被动 `timing:'round_start'`（每回合行动阶段、主动/普攻之前）
   *   + `morale_branch`（compareTo 缺省 'threshold'、by:'caster'、threshold 100）
   *   + `grant_first_aid`（受击触发恢复：触发率 100%、duration 1）。
   * 时序：本段在自身行动**前**施加 → 「持续 1 回合」= duration 1 恰好覆盖本回合（回合末 tick 掉），
   *   与「行动中施加给他人」的 duration 2 口径（辕门射戟）不同。
   */
  shengfu_xianzheng: {
    id: 'shengfu_xianzheng',
    name: '胜负先征',
    type: 'passive',
    timing: 'round_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost', 'first_aid', 'heal'],
    output: [
      {
        kind: 'morale_branch',
        by: 'caster',
        threshold: 100,
        high: [
          {
            kind: 'inflict_status',
            status: {
              type: 'damage_boost',
              rate: 0.4,
              duration: 1,
              direction: 'caused',
              skillTypes: ['active', 'pursuit'],
            },
          },
        ],
        low: [
          { kind: 'grant_first_aid', target: 'self', rate: 100, healRate: 75, healGrowthRate: 0, duration: 1 },
        ],
      },
    ],
  },
  /**
   * 及锋而试（S 主动·距离 5·35%·敌军群体 2 目标）：
   * 对敌军群体发动一次攻击（伤害率 120%）并使其士气降低 10（整场常驻、同战法累加）；
   * **每次发动后伤害率增加 40.0%**，不封顶、整场累计。
   * 官方 id 200979（1 级 60% / −5）。
   * 引擎配套：**新增 `BaseSkill.damageRatePerCast`**（本次成功发动后计数 +1，结算时
   *   实际率 = 输出段 rate + 40 × 此前发动次数；计数走既有 `ctx.skillCastCounters`）。
   * 士气降低复用 `morale_boost` 负值状态（心战为上先例：整场常驻、同战法累加、正负相反共存）。
   * 用户确认：不封顶（第 N 次发动 = 120 + 40×(N-1)）。
   */
  jifeng_ershi: {
    id: 'jifeng_ershi',
    name: '及锋而试',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    damageRatePerCast: 40,
    tags: ['damage', 'morale_boost'],
    output: [
      { kind: 'physical_damage', rate: 120 },
      { kind: 'inflict_status', status: { type: 'morale_boost', amount: -10, duration: 999 } },
    ],
  },

  // ─── 拆解通用 B+ 第六阶段：受击链路收尾（5 个）───

  /**
   * 垒实迎击（S 被动·距离 1·目标自己）：
   * ① 受到**普通攻击**伤害时，50% 使自身恢复兵力（恢复率 200%，受谋略，成长率未确认 → 0 = 不缩放）；
   * ② 50% 移除自身**由主动及追击战法带来的负面**效果；
   * ③ 50% 使自身进入规避状态（免疫下 1 次受到的伤害）；
   * ④ 同时当自身位于中军及前锋时，每回合开始 50% **援护友军全体**，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200900（1 级 25% / 100%）。
   * 用户 2026-09-19 确认：①②③ 三个 50% **各自独立判定**（同一场受击可同时奶 + 解负面 + 规避）。
   * 引擎配套：
   *   - ①②③ 走 `onHurt` 数组（三段各自独立判定；`damageSource:'basic'` 只吃普攻）；
   *   - ② 复用 `remove_by_source_skill_type` + **新增 `debuffsOnly`**（辞后定朝口径是有害+有益都移除，
   *     垒实迎击只要移除负面）；
   *   - ③ 复用 `grant_evasion`；④ 复用 `cover` 状态（普攻改由 cover 持有者承受）+ 段级 `casterPositions`；
   *   - ④ 的 50% 走输出级 `chance`（士气修正）；
   *   - ④ 每回合开始走被动 `roundStartRepeat`（行动阶段、主动/普攻之前），duration 1 恰覆盖本回合。
   */
  leishi_yingji: {
    id: 'leishi_yingji',
    name: '垒实迎击',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['heal', 'evasion', 'immunity', 'cover'],
    output: [],
    onHurt: [
      {
        victim: 'self',
        rate: 0.5,
        damageSource: 'basic',
        applyTo: 'victim',
        output: [{ kind: 'heal', rate: 200, strategyScaled: true, growthRate: 0, target: 'self' }],
      },
      {
        victim: 'self',
        rate: 0.5,
        damageSource: 'basic',
        applyTo: 'victim',
        output: [
          {
            kind: 'remove_by_source_skill_type',
            target: 'self',
            skillTypes: ['active', 'pursuit'],
            debuffsOnly: true,
          },
        ],
      },
      {
        victim: 'self',
        rate: 0.5,
        damageSource: 'basic',
        applyTo: 'victim',
        output: [{ kind: 'grant_evasion', stacks: 1, target: 'self' }],
      },
    ],
    roundStartRepeat: {
      output: [
        {
          kind: 'inflict_status',
          target: 'self',
          casterPositions: ['中军', '前锋'],
          chance: 0.5,
          status: { type: 'cover', duration: 1 },
        },
      ],
    },
  },
  /**
   * 百战无怯（S 被动·距离 1·目标自己）：
   * 自身位于中军或前锋时，战斗开始即获得 3 层「受到的攻击伤害与策略伤害降低 20%/层」（最多 3 层）；
   * 造成伤害后 +1 层；**每回合开始**、以及**受到攻击或策略攻击伤害后**，失去 1 层并恢复兵力（恢复率 200%，
   * 受谋略，成长率未确认 → 0 = 不缩放）。
   * 官方：scripts/skill_extra.json id 200252（1 级 10% / 100%）。
   * 用户 2026-09-19 确认：**0 层时既不掉层也不回血**（掉层与恢复绑定）。
   * 引擎配套：**新增 `PassiveSkill.stacksReduceHeal`**（层数体系）——
   *   开局满层挂一个 `damage_reduce`（rate = perStack × 层数）；
   *   `applyDamage` 内：造成方 +1 层、受击方 −1 层（掉层才走 `heal`）；
   *   `tickRoundStartStatuses` 每回合开始对所有单位 −1 层（掉层才回血）。
   * 位置条件走 `BaseSkill.casterPositions`（整次生效；含开局挂层与所有钩子）。
   * 注：DoT 跳伤也走 `applyDamage(strategy)` → 同样触发掉层回血（「受到策略攻击伤害」口径内）。
   */
  baizhan_wuqie: {
    id: 'baizhan_wuqie',
    name: '百战无怯',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    casterPositions: ['中军', '前锋'],
    tags: ['damage_reduce', 'heal'],
    output: [],
    stacksReduceHeal: {
      perStack: 0.2,
      maxStacks: 3,
      healRate: 200,
      healGrowthRate: 0,
    },
  },
  /**
   * 疾风迅雷（B 一类指挥·距离 1·目标自己）：
   * 战斗中能够**优先行动**；第 3 回合起，当**自身普通攻击命中目标后**有 40% 几率使其混乱，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200646（1 级 20%）。
   * 用户 2026-09-19 确认：「普通攻击命中后」仅指**携带者自身**的普攻（非我军全体）。
   * 引擎配套：
   *   - 全程先手复用 `CommandSkill.priorityRounds: 999`（先驱突击同字段）；
   *   - **新增 `BaseSkill.onBasicHit`**：`dealAttack` 命中并实际结算后（被规避不触发）按 rate 经士气修正判定，
   *     命中则对**该普攻目标**执行 output；
   *   - 「持续 1 回合」按行动中施加给他人口径 → duration 2（辕门射戟 / 举抑臧否）。
   *   - 注：EffectTag 无「先手」项（同举抑臧否），故 tags 只标混乱。
   */
  jifeng_xunlei: {
    id: 'jifeng_xunlei',
    name: '疾风迅雷',
    type: 'command',
    phase: 'prep',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    priorityRounds: 999,
    tags: ['confusion'],
    output: [],
    onBasicHit: {
      rate: 0.4,
      startRound: 3,
      output: [{ kind: 'inflict_status', status: { type: 'confusion', duration: 2 } }],
    },
  },
  /**
   * 反击（D 主动·距离 1·发动 25%–30%·目标自己）：使自身受到普通攻击时能进行反击（伤害率 75%），持续 2 回合。
   * 官方：scripts/skill_extra.json id 200221（1 级 37.5%）；发动率区间按仓库口径取**上界 30%**。
   * 引擎配套：**无需新机制** —— `counter` 状态已实现（反击之策 / 一夫当关；`settleCounterOnHurt`）。
   * 「持续 2 回合」按用户 2026-09-19 确认取 **duration 3**（行动中给自身施加，覆盖后续两个完整行动回合）。
   */
  fanji_counter: {
    id: 'fanji_counter',
    name: '反击',
    type: 'active',
    prepare: false,
    range: 1,
    triggerRate: 0.3,
    targetMode: 'self',
    tags: ['counter'],
    output: [{ kind: 'inflict_status', status: { type: 'counter', duration: 3, rate: 75 } }],
  },
  /**
   * 诱敌深入（A 一类指挥·距离 5·目标自己）：
   * 战斗开始后第 3 回合起，自身在我军全体每回合首次受到伤害后，有 50% 几率对**伤害来源**
   * 造成一次策略攻击（伤害率 136%，受谋略，成长率未确认 → 留空按基值）。
   * 官方：scripts/skill_extra.json id 201008（1 级 68%）。
   * 用户 2026-09-19 确认：「每回合首次」= **每名友军各自每回合首次**（复用 `onHurt.oncePerRound` 语义）。
   * 引擎配套：**无需新机制** —— `onHurt`（`victim:'ally'` 含施法者自身 / `startRound:3` / `oncePerRound` /
   *   `applyTo:'source'`）+ 既有 `strategy_damage`。
   * 注：按一类指挥默认口径，施法者阵亡后本效果停止（未写 `retainAfterDeath`）。
   */
  youdi_shenru: {
    id: 'youdi_shenru',
    name: '诱敌深入',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage'],
    output: [],
    onHurt: {
      victim: 'ally',
      rate: 0.5,
      startRound: 3,
      oncePerRound: true,
      applyTo: 'source',
      output: [{ kind: 'strategy_damage', rate: 136, strategyScaled: true }],
    },
  },

  // ─── 拆解通用 B+ 第七阶段：移除敌军有益（4）+ 援护（3）───

  /**
   * 看破（D 主动·距离 3·发动 30%–40%·敌军单体）：
   * 移除敌军单体的**有益效果**，并使其防御属性下降 10，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200218（1 级 5%）；发动率区间按仓库口径取**上界 40%**。
   * 引擎配套：**新增输出 `remove_buffs`**——移除**有益**状态（`isBeneficialStatus` 判定），
   *   且按用户 2026-09-19 口径做**来源优先级过滤**（被动 > 指挥 > 主动 = 追击）：
   *   看破是主动，只能清「主动/追击」带来的有益效果（大赏三军等指挥光环、被动增益清不掉）。
   * 防御 −10 无「受属性影响」→ 固定；「持续 1 回合」按行动中施加口径 duration 2。
   */
  kanpo: {
    id: 'kanpo',
    name: '看破',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.4,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['debuff_defense'],
    output: [
      { kind: 'remove_buffs' },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -10, duration: 2 } },
    ],
  },
  /**
   * 索敌（D 主动·距离 3·35%·敌军群体 2 目标）：
   * 移除敌军群体的有益效果，并对其发动一次攻击（伤害率 75%）。
   * 官方 id 200735（1 级 37.5%）。
   * 官方文本顺序「先移除、后攻击」→ output 顺序一致（移除后本次攻击不再吃到目标增益）。
   */
  suodi: {
    id: 'suodi',
    name: '索敌',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'remove_buffs' }, { kind: 'physical_damage', rate: 75 }],
  },
  /**
   * 驱逐（D 追击·40%·攻击目标）：
   * 普通攻击后，对攻击目标再次发动策略攻击（伤害率 110%，受谋略，成长率未确认 → 留空按基值），
   * 并移除其有益效果。
   * 官方 id 200131（1 级 55%）；官方文本顺序「先伤害、后移除」→ output 顺序一致。
   */
  quzhu: {
    id: 'quzhu',
    name: '驱逐',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.4,
    tags: ['damage'],
    output: [
      { kind: 'strategy_damage', rate: 110, strategyScaled: true },
      { kind: 'remove_buffs' },
    ],
  },
  /**
   * 火积（B 追击·45%·攻击目标·弓）：
   * 普通攻击后，使攻击目标**立即受到燃烧伤害**（伤害率 192%，受谋略，成长率未确认 → 留空按基值），
   * 并移除其有益效果。
   * 官方 id 200722（1 级 96%）。
   * 用户 2026-09-19 确认：「立即受到」= **当场结算、不挂状态**，但走**燃烧（DoT）公式**
   *   （新增 `strategy_damage.dotFormula`：兵力基础 ×1/3、谋略基础 ×0.25，并以 `dotType:'burning'`
   *   参与「被施加的燃烧伤害提升」等过滤）。
   */
  huoji: {
    id: 'huoji',
    name: '火积',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.45,
    tags: ['damage', 'burning'],
    output: [
      { kind: 'strategy_damage', rate: 192, strategyScaled: true, dotFormula: true },
      { kind: 'remove_buffs' },
    ],
  },
  /**
   * 援护（D 主动·距离 2·发动 30%–45%·友军单体）：
   * 援护友军单体，为其抵挡普通攻击，持续 2 回合。
   * 官方 id 200238；发动率区间按仓库口径取**上界 45%**。
   * 引擎配套：**新增输出 `grant_cover`** —— `cover` 挂在施法者自身（保护者），
   *   `protectId` 记录被保护的友军（战法有效距离内随机 1 名、不含自身）；
   *   `findCoverGuard` 据此只代受该友军的普攻（「援护友军全体」仍不填 protectId，走既有口径）。
   * 「持续 2 回合」按行动中施加口径 duration 3（同反击）。
   */
  yuanhu: {
    id: 'yuanhu',
    name: '援护',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.45,
    targetMode: 'self',
    tags: ['cover'],
    output: [{ kind: 'grant_cover', duration: 3 }],
  },
  /**
   * 移花接木（C 主动·距离 2·发动 30%–40%·目标自己）：
   * 移除自身有害效果，防御属性提升 50，并援护友军全体（为其抵挡普通攻击），持续 2 回合。
   * 官方 id 200239（1 级 防御 +25）；发动率区间按仓库口径取**上界 40%**。
   * 引擎配套：**无需新机制** —— `remove_debuffs` + `defense_buff` + 既有 `cover`（挂自身 = 保护者，
   *   不填 protectId = 援护友军全体）。
   * 「持续 2 回合」按行动中施加口径 duration 3（防御提升同）。
   */
  yihuajiemu: {
    id: 'yihuajiemu',
    name: '移花接木',
    type: 'active',
    prepare: false,
    range: 2,
    triggerRate: 0.4,
    targetMode: 'self',
    tags: ['immunity', 'defense_buff', 'cover'],
    output: [
      { kind: 'remove_debuffs', target: 'self' },
      { kind: 'inflict_status', target: 'self', status: { type: 'defense_buff', amount: 50, duration: 3 } },
      { kind: 'inflict_status', target: 'self', status: { type: 'cover', duration: 3 } },
    ],
  },
  /**
   * 一夫当关（A 一类指挥·距离 3·目标自己）：
   * 战斗开始后前 2 回合，援护友军全体，使自身受到**攻击**伤害降低 50%（受防御属性影响）；
   * **仅对自身处于前锋位置时生效**。
   * 官方 id 200674（1 级 25%）。
   * 引擎配套：**新增 `damage_reduce.defenseScaled`**（受防御缩放；成长率未确认 → 留空按基值 0.5）；
   *   援护友军全体复用既有 `cover` 口径（挂自身）；站位条件走 skill 级 `casterPositions:['前锋']`。
   * 「前 2 回合」= 准备阶段施加 duration 2（appliedRound 0，回合末递减）。
   */
  yifudangguan: {
    id: 'yifudangguan',
    name: '一夫当关',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'self',
    casterPositions: ['前锋'],
    tags: ['cover', 'damage_reduce'],
    output: [
      { kind: 'inflict_status', target: 'self', status: { type: 'cover', duration: 2 } },
      {
        kind: 'inflict_status',
        target: 'self',
        status: {
          type: 'damage_reduce',
          rate: 0.5,
          duration: 2,
          defenseScaled: true,
          damageType: 'physical',
        },
      },
    ],
  },

  // ─── 拆解通用 B+ 第八阶段：兵力比例 / 闪击（B 级 2 个）───

  /**
   * 亡命一搏（B 主动·距离 3·25%·敌军群体 2 目标）：
   * 对敌军群体发动一次猛击（伤害率 160%）；当**自身兵力低于初始兵力 25%** 时，伤害率变为 460%。
   * 官方：scripts/skill_extra.json id 200996（1 级 80% / 230%）。
   * 引擎配套：**新增 `physical_damage.rateBySelfTroopRatio`**（按施法者当前兵力比例替换本段伤害率；
   *   `troopRatioMatches` 口径：`below` = 比例**低于**该值才满足）。
   * 无「受属性影响」→ 两档伤害率均固定，不缩放。
   */
  wangming_yibo: {
    id: 'wangming_yibo',
    name: '亡命一搏',
    type: 'active',
    prepare: false,
    range: 3,
    triggerRate: 0.25,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage'],
    output: [
      {
        kind: 'physical_damage',
        rate: 160,
        rateBySelfTroopRatio: { cond: { below: 25 }, rate: 460 },
      },
    ],
  },
  /**
   * 闪击（B 主动·距离 4·50%·敌军群体 2 目标）：
   * 对敌军群体发动一次攻击（伤害率 50%），并使**敌军单体**进行下一次攻击的伤害大幅度降低。
   * 官方 id 200690（1 级 25%）；「大幅度降低」官方未给数值 → 用户 2026-09-19 口径：
   *   按辕门射戟同款「伤害降至引擎下限 10%」建模（`damage_boost caused -99.99` → buffMult 下限 10%）。
   * 引擎配套：**无需新机制** —— 既有 `damage_boost` + `attackOnly`（仅「进行攻击」：普攻/物理主动/追击）
   *   + `charges: 1`（下次攻击打出后消耗）；debuff 目标为敌军单体（`targetSide:'enemy'` + `random_single`，
   *   独立于本次攻击的 2 个目标）。
   */
  shanji: {
    id: 'shanji',
    name: '闪击',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.5,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'physical_damage', rate: 50 },
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'random_single',
        status: {
          type: 'damage_boost',
          rate: -99.99,
          duration: 999,
          direction: 'caused',
          attackOnly: true,
          charges: 1,
        },
      },
    ],
  },

  // ─── 拆解通用 B+ 第九阶段：兵力阈值 / 恢复次数（A 级 2 个）───

  /**
   * 甚陷不惧（A 被动·距离 1·目标自己）：
   * 当自身兵力**首次**低于初始兵力的 90%、70%、50%、30% 时，使自身**下次行动时**武将主战法发动率
   * 提高 50%（仅对可造成攻击伤害或策略伤害的战法生效）。
   * 官方：scripts/skill_extra.json id 200941（1 级 25%）。
   * 用户 2026-09-19 确认：该效果**消耗于自身下次行动**（行动结束清除，不按回合递减）。
   * 引擎配套：① **新增 `PassiveSkill.troopThresholdBuff`**（受击实际扣兵后逐档检查、每档去重；
   *   同一次结算跨越多档只结算一次）；② `trigger_boost` 新增 `mainSkillOnly`（只对携带者主战法）、
   *   `damageSkillsOnly`（输出含物理/策略伤害段）、`expireAfterOwnAct`（行动末清除）；
   *   ③ `General.mainSkillId`（原先只有 mainSkillName，无法按 id 过滤，本次补上并由 hero-utils 注入）。
   */
  shenxian_bujv: {
    id: 'shenxian_bujv',
    name: '甚陷不惧',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [],
    troopThresholdBuff: {
      thresholds: [90, 70, 50, 30],
      output: [
        {
          kind: 'inflict_status',
          target: 'self',
          status: {
            type: 'trigger_boost',
            rate: 0.5,
            duration: 999,
            mainSkillOnly: true,
            damageSkillsOnly: true,
            expireAfterOwnAct: true,
          },
        },
      ],
    },
  },
  /**
   * 胜敌益强（A 被动·距离 1·目标自己）：
   * 每回合行动时使自身恢复 1 次兵力（恢复率 120%，受防御属性影响）；
   * 第 2、4、6 回合起恢复次数提升至 2、3、4 次，持续到战斗结束。
   * 官方 id 200261（1 级 60%）。
   * 引擎配套：① **新增 `PassiveSkill.recoverEachRound`**（按回合取次数、逐次结算；围困拦截）；
   *   ② `heal` 新增 `defenseScaled`（受防御缩放；成长率未确认 → 留空按基值 120%，必填字段给 0）。
   */
  shengdi_yiqiang: {
    id: 'shengdi_yiqiang',
    name: '胜敌益强',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['heal'],
    output: [],
    recoverEachRound: {
      tiers: [
        { startRound: 1, times: 1 },
        { startRound: 2, times: 2 },
        { startRound: 4, times: 3 },
        { startRound: 6, times: 4 },
      ],
      rate: 120,
      growthRate: 0,
      defenseScaled: true,
    },
  },

  // ─── 拆解通用 B+ 第十阶段：追击链路（S/A 2 个）───

  /**
   * 乘胜追击（S 追击·发动 25%–35%·攻击目标）：
   * 普通攻击后对攻击目标发动一次攻击（伤害率 150%）；每次发动攻击后有 **60% 概率**对攻击目标再次发动攻击
   * （伤害率 100%），此概率每次降低 20%（60→40→20→0），战法结束后概率重置。
   * 官方：scripts/skill_extra.json id 200980（1 级 75% / 50%）；发动率区间按仓库口径取**上界 35%**
   * （与「温酒斩将 20–35 → 0.35」同口径）。
   * 引擎配套：① 复用既有 `physical_damage.chain`（`chance` + `decay`，按士气修正逐次判定、成功重打同一段）；
   *   **新增 `chain.sameTarget`**（乘胜追击是「对攻击目标」，既有连锁默认按战法距离随机单体）；
   *   ② 首次额外攻击（60%）用输出级 `chance: 0.6`（**本次把输出级 chance 扩展到追击战法**），
   *   连锁从 40% 起递减（60 → 40 → 20 → 0），与原描述「每次发动攻击后有 60% 概率…每次降低 20%」一致。
   * 无「受属性影响」→ 150% / 100% 均固定，不缩放。
   */
  chengsheng_zhuiji: {
    id: 'chengsheng_zhuiji',
    name: '乘胜追击',
    type: 'pursuit',
    range: 0,
    triggerRate: 0.35,
    tags: ['damage'],
    output: [
      { kind: 'physical_damage', rate: 150 },
      {
        kind: 'physical_damage',
        rate: 100,
        chance: 0.6,
        chain: { chance: 0.4, decay: 0.2, sameTarget: true },
      },
    ],
  },
  /**
   * 势无虚动（A 被动·距离 1·目标自己）：
   * 自身**每次试图发动追击战法时**：① 使下一次造成伤害无视规避；② 下一次发动追击战法造成伤害提升 40%，
   * 最多叠加 3 次（伤害提升效果在下一次追击打出后清空）。
   * 官方 id 200949（1 级 20%）。
   * 用户 2026-09-19 确认：② 为**消耗制**——层数累加（最多 3 层），下一次追击实际打出后清空全部层数。
   * 引擎配套：**新增 `BaseSkill.onPursuitAttempt`**（进入追击发动率判定前，无论结果，逐战法执行 output）。
   *   ① 复用既有 `ignore_evasion`（消耗制：下次造成伤害时移除）；
   *   ② 复用 `damage_boost`（`direction:'caused'` + `skillTypes:['pursuit']` + `stacks/maxStacks:3`
   *   + `charges:1` + `chargesStack:true`）：每次试图发动 +1 层并累加 rate，追击打出消耗 charges 即整条移除。
   */
  shiwu_xudong: {
    id: 'shiwu_xudong',
    name: '势无虚动',
    type: 'passive',
    timing: 'battle_start',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [],
    onPursuitAttempt: {
      output: [
        { kind: 'inflict_status', target: 'self', status: { type: 'ignore_evasion', duration: 999 } },
        {
          kind: 'inflict_status',
          target: 'self',
          status: {
            type: 'damage_boost',
            rate: 0.4,
            duration: 999,
            direction: 'caused',
            skillTypes: ['pursuit'],
            stacks: 1,
            maxStacks: 3,
            charges: 1,
            chargesStack: true,
          },
        },
      ],
    },
  },

  // ─── 拆解通用 B+ 第十一阶段：叠层钩子（B/A 2 个）───

  /**
   * 以直报怨（B 一类指挥·距离 5·目标自己）：
   * ① 每回合自身首次造成伤害后，使**目标单体**造成的所有伤害降低 10%；
   * ② 自身首次受到伤害后，使**我军单体**受到的所有伤害降低 10%；
   * 以上效果可叠加 6 次，持续直到战斗结束。
   * 官方：scripts/skill_extra.json id 200935（1 级 5%）。
   * 引擎配套：① **新增 `BaseSkill.dealFirstPerRound`**（每回合首次造成伤害后钩子，按「回合×战法×施法者」
   *   去重，对**本次伤害目标**结算 output）；② 受伤侧复用既有 `onHurt{ victim:'self', oncePerRound:true }`
   *   + 输出段 `targetSide:'ally', targetMode:'random_single'`（「我军单体」= 随机友军，含自身）。
   * 数值为固定 10%、无「受属性影响」→ 不缩放；叠加用 `stacks/maxStacks:6`（同源重复施加累加）。
   */
  yizhibaoyuan: {
    id: 'yizhibaoyuan',
    name: '以直报怨',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [],
    dealFirstPerRound: {
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: -0.1,
            duration: 999,
            direction: 'caused',
            stacks: 1,
            maxStacks: 6,
          },
        },
      ],
    },
    onHurt: {
      victim: 'self',
      oncePerRound: true,
      applyTo: 'victim',
      output: [
        {
          kind: 'inflict_status',
          targetSide: 'ally',
          targetMode: 'random_single',
          status: {
            type: 'damage_boost',
            rate: -0.1,
            duration: 999,
            direction: 'taken',
            stacks: 1,
            maxStacks: 6,
          },
        },
      ],
    },
  },
  /**
   * 久战熟谋（A 一类指挥·距离 3·友军群体 2 目标）：
   * 使友军群体**每造成一次策略伤害后**，其策略伤害提高 5%（受谋略属性影响），最多叠加 5 次。
   * 官方 id 200959（1 级 2.5%）。
   * 引擎配套：**新增 `BaseSkill.allyDealStack`** —— 准备阶段把状态挂到锁定友军身上，
   *   此后该单位每次造成匹配伤害（`damageType:'strategy'`）时同源再施加一次（叠层/上限由 `maxStacks:5` 控制）。
   * 受谋略缩放但成长率未确认 → `growthRate` 留空（基值 5%；初始施加与叠层都按基值，待成长率确认后统一补）。
   */
  jiuzhan_shumou: {
    id: 'jiuzhan_shumou',
    name: '久战熟谋',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [],
    allyDealStack: {
      damageType: 'strategy',
      status: {
        type: 'damage_boost',
        rate: 0.05,
        duration: 999,
        direction: 'caused',
        damageType: 'strategy',
        strategyScaled: true,
        stacks: 1,
        maxStacks: 5,
      },
    },
  },

  // ─── 拆解通用 B+ 第十二阶段：行动后叠层（A 级 2 个）───

  /**
   * 乘间击隙（A 一类指挥·距离 4·目标自己）：
   * 自身每发动**主动主战法**后，使自身造成的**攻击伤害提升 15%**，最多叠加 3 次；
   * 该效果每叠加 3 次后，对敌军群体发动 1 次攻击（伤害率 240%），发动后攻击伤害提升效果消失。
   * 官方：scripts/skill_extra.json id 200259（1 级 7.5% / 120%）。
   * 引擎配套：**新增 `CommandSkill.afterMainActiveStacks`** —— 携带者主动主战法发动后同源叠层
   *   （`status` + `maxStacks`），满层执行 `triggerOutput`（段内自带 `targetMode` 重选敌军群体）后清空状态。
   * 无「受属性影响」→ 15% / 240% 固定，不缩放。
   */
  chengjian_jixi: {
    id: 'chengjian_jixi',
    name: '乘间击隙',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost', 'damage'],
    output: [],
    afterMainActiveStacks: {
      maxStacks: 3,
      status: {
        type: 'damage_boost',
        rate: 0.15,
        duration: 999,
        direction: 'caused',
        attackOnly: true,
        stacks: 1,
        maxStacks: 3,
      },
      triggerOutput: [{ kind: 'physical_damage', rate: 240, targetMode: 'group', groupCount: 3 }],
    },
  },
  /**
   * 勠力同心（A 一类指挥·距离 2·我军全体）：
   * 我方**大营**每次发动主动战法或追击战法后，**前锋和中军**下次行动阶段主动和追击战法造成的伤害
   * 提升 40%，此效果可额外叠加 1 次（最多 2 层）。
   * 官方 id 200967（1 级 20%）。
   * 引擎配套：**新增 `CommandSkill.dapingCastBuff`** —— 「成功发动主动/追击战法后」钩子里判定
   *   `actorPositions:['大营']`，给 `targetPositions:['前锋','中军']` 的友军同源叠层（`maxStacks:2`）。
   *   「下次行动阶段」按行动中施加给他人口径取 duration 2（覆盖其下一次行动；辕门射戟/反击同口径）。
   * 无「受属性影响」→ 40% 固定，不缩放。
   */
  luli_tongxin: {
    id: 'luli_tongxin',
    name: '勠力同心',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [],
    dapingCastBuff: {
      actorPositions: ['大营'],
      targetPositions: ['前锋', '中军'],
      status: {
        type: 'damage_boost',
        rate: 0.4,
        duration: 2,
        direction: 'caused',
        skillTypes: ['active', 'pursuit'],
        stacks: 1,
        maxStacks: 2,
      },
    },
  },

  // ─── 拆解通用 B+ 第十三阶段：准备战法时机（B 级 2 个）───

  /**
   * 谋定后动（B 被动·距离 2·目标自己）：
   * ① 每当发动**需要准备的主战法**时，100% 使自身进入洞察状态（免疫混乱/犹豫/怯战/暴走/挑衅），持续 2 回合；
   * ② 当自身发动主动战法后，100% 使我军群体攻击、防御、谋略属性提高 55，持续 2 回合。
   * 官方：scripts/skill_extra.json id 200767（1 级 50% / +27.5）。
   * 引擎配套：① **新增 `BaseSkill.onPrepareStart`**（进入准备时判定/生效——用户 2026-09-19 确认时点；
   *   `mainSkillOnly` 只对主战法生效）；② 「发动主动战法后」部分复用既有 `PassiveSkill.afterActive`
   *   （每次成功发动主动战法后触发，准备战法释放也算；输出段 `targetSide:'ally'` 覆盖我军群体）。
   * 无「受属性影响」→ 洞察 2 回合 / +55 固定，不缩放。
   */
  mouding_houdong: {
    id: 'mouding_houdong',
    name: '谋定后动',
    type: 'passive',
    timing: 'battle_start',
    range: 2,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['insight', 'buff_attack', 'buff_defense', 'buff_strategy'],
    output: [],
    onPrepareStart: {
      mainSkillOnly: true,
      output: [
        { kind: 'inflict_status', target: 'self', status: { type: 'insight', duration: 2 } },
      ],
    },
    afterActive: {
      output: [
        { kind: 'inflict_status', targetSide: 'ally', targetMode: 'all', status: { type: 'attack_buff', amount: 55, duration: 2 } },
        { kind: 'inflict_status', targetSide: 'ally', targetMode: 'all', status: { type: 'defense_buff', amount: 55, duration: 2 } },
        { kind: 'inflict_status', targetSide: 'ally', targetMode: 'all', status: { type: 'strategy_buff', amount: 55, duration: 2 } },
      ],
    },
  },
  /**
   * 胜兵求战（B 一类指挥·距离 2·目标自己）：
   * ① 战斗中每当自身发动**需要准备的主战法**时，有 80% 几率跳过 1 回合准备时间；
   * ② 任意友军发动主动战法后，自身下一个主动战法造成的伤害提高 15%，此效果最多叠加 3 次。
   * 官方 id 200754（1 级 40% / 7.5%）。
   * 引擎配套：① 准备阶段给自身挂 `jump_prep`（准备跳过；`triggerActiveSkill` 每次发动准备战法时按 rate 掷骰，
   *   与「每当」语义一致；注：该状态对所有准备战法生效，不区分主战法）；
   *   ② **新增 `BaseSkill.allyActiveCastStack`**（任意友军成功发动主动战法后给携带者自身同源叠层；
   *   「任意友军」按仓库口径**含自己**——自己发动主动时先消耗旧层、随后本次发动又叠 1 层）。
   * ② 的「下一个主动战法」为消耗制：`charges:1` + `chargesStack:true` + `maxStacks:3`（同势无虚动的追击版）。
   */
  shengbing_qiuzhan: {
    id: 'shengbing_qiuzhan',
    name: '胜兵求战',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [
      { kind: 'inflict_status', target: 'self', status: { type: 'jump_prep', duration: 999, rate: 0.8 } },
    ],
    allyActiveCastStack: {
      status: {
        type: 'damage_boost',
        rate: 0.15,
        duration: 999,
        direction: 'caused',
        skillTypes: ['active'],
        stacks: 1,
        maxStacks: 3,
        charges: 1,
        chargesStack: true,
      },
    },
  },

  // ─── 拆解通用 B+ 第十四阶段：指挥时机（S 级 2 个）───

  /**
   * 众谋不懈（S 二类指挥·距离 5·敌军单体）：
   * 战斗中，每当自身**试图发动主动及追击战法前**，有 40% 几率对距离 5 以内的敌军单体发动一次策略攻击
   * （伤害率 194%，受谋略属性影响）。
   * 官方：scripts/skill_extra.json id 200800（1 级 97%；官方文本两处条件几率均为 40%）。
   * 引擎配套：① 主动侧复用既有 `roundTrigger:'before_active'`（每次试图发动主动战法前逐段按 `chance`
   *   判定，运筹决胜同链路）；② 追击侧复用 p10 新增的 `BaseSkill.onPursuitAttempt`，段内用
   *   `chance_group{chance:0.4}` 承载「40% 几率」（before_active 走独立链路、不走通用 chance 闸门）。
   * 受谋略缩放但成长率未确认 → `growthRate` 留空（基值 194%），登记《成长率待补名单》§三。
   */
  zhongmou_buxie: {
    id: 'zhongmou_buxie',
    name: '众谋不懈',
    type: 'command',
    phase: 'round',
    roundTrigger: 'before_active',
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [
      { kind: 'strategy_damage', rate: 194, strategyScaled: true, chance: 0.4, targetMode: 'random_single' },
    ],
    onPursuitAttempt: {
      output: [
        {
          kind: 'chance_group',
          chance: 0.4,
          outputs: [{ kind: 'strategy_damage', rate: 194, strategyScaled: true, targetMode: 'random_single' }],
        },
      ],
    },
  },
  /**
   * 反计之策（S 一类指挥·距离 4·敌军群体 2 目标）：
   * 战斗开始后前 3 回合，使敌军群体**发动主动战法时造成的伤害大幅下降**；
   * 并在**首回合**有 100% 几率使其陷入犹豫状态，无法发动主动战法。
   * 官方 id 200220（1 级 50%；「大幅下降」官方未给数值）。
   * 引擎配套：**无需新机制** —— ① 主动伤害大幅下降按用户 2026-09-19 口径取辕门射戟同款
   *   「伤害降至引擎下限 10%」（`damage_boost caused -99.99` + `skillTypes:['active']`，duration 3 = 前 3 回合）；
   *   ② 首回合犹豫（满级 100%）= `hesitation` duration 1（准备阶段施加、回合末递减掉）。
   */
  fanji_zhence: {
    id: 'fanji_zhence',
    name: '反计之策',
    type: 'command',
    phase: 'prep',
    range: 4,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage_boost', 'hesitation'],
    output: [
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -99.99,
          duration: 3,
          direction: 'caused',
          skillTypes: ['active'],
        },
      },
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 1 } },
    ],
  },

  // ─── 拆解通用 B+ 第十五阶段：延迟结算（A 级 1 个）───

  /**
   * 翕处还张（A 准备主动·距离 5·40%·敌军群体 2-3 目标）：
   * 1 回合准备，对敌军群体发动一次策略攻击（伤害率 132%，受谋略，成长率未确认 → 留空按基值），
   * 并使敌军群体 **1-2 目标**「**下一次造成伤害后**，再受到一次策略伤害」（伤害率 165%，受谋略，同上）。
   * 官方：scripts/skill_extra.json id 200917（1 级 66% / 82.5%）。
   * 引擎配套：**新增输出 `mark_deal_punish`** —— 给 1~2 名敌军挂「出手反噬」标记（目标独立于主段攻击，
   *   `groupCount:[1,2]`），标记持有者**下一次造成伤害**（实际扣兵 > 0，任意来源）时由本战法施法者
   *   对其打出一次策略伤害（按触发时双方生效属性/增减伤实时计算），随后标记消耗；
   *   标记队列走 `ctx.dealPunishMarks`（不新增状态类型，避免状态冲突/驱散口径牵连）。
   */
  xichu_haizhang: {
    id: 'xichu_haizhang',
    name: '翕处还张',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: [2, 3],
    targetSide: 'enemy',
    tags: ['damage'],
    output: [
      { kind: 'strategy_damage', rate: 132, strategyScaled: true },
      { kind: 'mark_deal_punish', rate: 165, strategyScaled: true, groupCount: [1, 2] },
    ],
  },

  // ─── 拆解通用 B+ 第十六阶段：延迟结算（A 级 1 个 · 道行险阻）───

  /**
   * 道行险阻（A 主动·距离 4·40%·敌军单体）：
   * 使敌军单体防御属性降低 50（**受攻击属性影响**）、谋略属性降低 50（**受谋略属性影响**），持续 1 回合；
   * 同时在**目标下一次行动前**对其发动一次策略攻击（伤害率 150%，受谋略）和一次攻击（伤害率 150%）。
   * 官方：scripts/skill_extra.json id 200684（1 级 25% / 75%）。
   * 引擎配套：① **新增输出 `schedule_strike`** —— 把后续段排入 `ctx.pendingStrikes`，
   *   目标下次行动开始前由原施法者结算（`triggerPendingStrikes` 接在 `tickStatusesOnActStart` 之后）；
   *   ② 属性 buff 新增 **`attackScaled`**（受攻击缩放；原先只有 strategyScaled），
   *   `inflict_status` 缩放分支按 `attackScaled ? 生效攻击 : 生效谋略` 取属性。
   * 「持续 1 回合」按行动中施加给他人口径 duration 2（辕门射戟）。两段「受属性影响」的成长率均未确认
   * → `growthRate` 留空（基值 50 / 150%），登记《成长率待补名单》§三。
   */
  daoxing_xianzu: {
    id: 'daoxing_xianzu',
    name: '道行险阻',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['debuff_defense', 'debuff_strategy', 'damage'],
    output: [
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: -50, duration: 2, attackScaled: true } },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: -50, duration: 2, strategyScaled: true } },
      {
        kind: 'schedule_strike',
        output: [
          { kind: 'strategy_damage', rate: 150, strategyScaled: true },
          { kind: 'physical_damage', rate: 150 },
        ],
      },
    ],
  },

  // ─── 拆解通用 B+ 第十七阶段：每回合递增几率 / 逐段独立判定 / 全体+S 级准备（2 个）───

  /**
   * 鸟云山兵（A 指挥·距离 2·一类指挥·我军群体〔有效距离内 2 个目标〕）：
   * 战斗开始后，我军群体每回合行动时有 30% 几率使自身受到的攻击和策略攻击降低 60%，
   * 持续 1 回合，**两个效果独立判断**，该效果生效几率每回合提升 10%。
   * 官方：scripts/skill_extra.json id 200883（1 级 30% / 30%，满级 30% / 60%）。
   * 引擎配套：`roundRepeat` 新增 ①`rateIncrementPerRound`（每回合几率递增，先加算再走士气，封顶 100%）；
   *   ②`independentRolls`（对 `skill.output` 每段各掷一次、命中段单独结算 = 「两个效果独立判断」）。
   * 生效对象为**携带者自身**（我军群体 2 目标各自行动时独立判定）→ roundRepeat 沿用战法目标池
   * （准备阶段锁定的 2 名友军，`targetSide:'ally'` + `targetMode:'group'`）。
   * 「持续 1 回合」按**自身行动时施加**口径 duration 1（覆盖其下一次行动之前，即整段被攻击窗口）。
   */
  niaoyun_shanbing: {
    id: 'niaoyun_shanbing',
    name: '鸟云山兵',
    type: 'command',
    phase: 'prep',
    range: 2,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'ally',
    tags: ['damage_reduce'],
    roundRepeat: {
      startRound: 1,
      endRound: 8, // 第 1 回合 30% → 每回合 +10% → 第 8 回合 100%（封顶 100%）
      rate: 0.3,
      rateIncrementPerRound: 0.1,
      independentRolls: true,
    },
    output: [
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.6, duration: 1, damageType: 'physical' } },
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.6, duration: 1, damageType: 'strategy' } },
    ],
  },

  /**
   * 十面埋伏（S 主动·1 回合准备·距离 5·40%）：对敌军全体发动一次策略攻击（伤害率 130%，受谋略属性影响），
   * 并随机使敌军群体 1-2 目标**造成的所有伤害大幅度降低**，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200715（1 级 65%，满级 130%）；
   * targetShow 写「敌军群体（有效距离内 3 个目标）」，但满级 desc 明确伤害段为**敌军全体**（距离 5 已覆盖全场）
   * → 战法目标取 `'all'`，减伤段用输出级 `targetMode:'group'` + `groupCount:[1,2]` 另选 1-2 目标
   * （全主诿异既有先例）。
   * 「大幅度降低」无官方数值 → 沿用用户口径 `caused -99.99`（`buffMult` 下限 10%，Web 显示「造成的伤害大幅降低」）；
   * 减伤对象为敌军、在自身行动中施加 → 「持续 1 回合」按 duration 2（辕门射戟口径）。
   * 策略伤害 130% 受谋略缩放，官方未给成长率 → `growthRate` 留空（登记《成长率待补名单》§三）。
   */
  shimian_maifu: {
    id: 'shimian_maifu',
    name: '十面埋伏',
    type: 'active',
    prepare: true,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'strategy_damage', rate: 130, strategyScaled: true },
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'group',
        groupCount: [1, 2],
        status: { type: 'damage_boost', rate: -99.99, duration: 2, direction: 'caused' },
      },
    ],
  },

  // ─── 拆解通用 B+ 第十八阶段：阵营条件 / 战法距离 / 普攻后围困（A 级 1 个 · 合纵连横）───

  /**
   * 合纵连横（A 指挥·距离 3·一类指挥·我军全体）：我方出战 3 名武将**阵营均不相同**时——
   * ① 我军全体武将**战法距离 +1**；② 对**非自身阵营**的武将造成攻击与策略伤害提升 10%；
   * ③ 对非自身阵营的武将**普通攻击后** 40% 几率使目标陷入围困，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200964（1 级 5% / 20%，满级 10% / 40%）。
   * 引擎配套（4 项）：
   *   ① `BaseSkill.teamFactionDistinct` —— 阵营条件整次开关（与 `teamTroopFilter` 同判定点）；
   *   ② 新状态 `skill_range_buff` + `target.ts skillRangeOf` —— 战法选目标距离上限加算
   *      （`skillTargets` / `unitsInSkillRange` 均生效；普攻距离仍走 `range_buff` / `attackRangeOf`，互不影响）；
   *   ③ `damage_boost.targetFactionNotSelf` —— 增伤过滤维，按**携带者阵营 vs 受击者阵营**实时判定
   *      （同阵营则该增伤不生效；与全域增伤是同名不同轨，不判同源累加）；
   *   ④ `inflict_status.targetFactionNotSelf`（段级阵营过滤）+ `BaseSkill.basicHitProc`
   *      —— 第三个效果作用于**我军全体**（非携带者本人），故不能用只认携带者自身的 `onBasicHit`：
   *      准备阶段按锁定友军逐单位注册到 `ctx.basicHitProcs`，任一被注册友军普攻命中后按 40% 判定。
   * 「持续 1 回合」的围困在自身行动中施加给他人口径 → duration 2（辕门射戟 / 举抑臧否口径）；
   * 战法距离 +1 与增伤为「战斗中」常驻 → duration 999。
   * 阵营条件（3 将互不相同）读**部署名单**（不论 alive），战斗中不再复查。
   */
  hezong_lianheng: {
    id: 'hezong_lianheng',
    name: '合纵连横',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    teamFactionDistinct: true,
    tags: ['range_buff', 'damage_boost', 'siege'],
    output: [
      { kind: 'inflict_status', status: { type: 'skill_range_buff', amount: 1, duration: 999 } },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.1,
          duration: 999,
          direction: 'caused',
          targetFactionNotSelf: true,
        },
      },
    ],
    basicHitProc: {
      rate: 0.4,
      targetFactionNotSelf: true,
      output: [{ kind: 'inflict_status', targetFactionNotSelf: true, status: { type: 'siege', duration: 2 } }],
    },
  },

  // ─── 拆解通用 B+ 第十九阶段：女将组合 / 段级站位 / 受击规避（B 级 1 个 · 美人计）───

  /**
   * 美人计（B 指挥·距离 5·一类指挥·我军全体）：**正式回合开始后**，我方 3 名武将均为女武将时——
   * ① 大营造成的所有伤害提升 14%；② 中军每回合行动前随机使敌军单体**男武将**「下一次攻击或策略攻击
   * 造成的伤害降低 60%」；③ 前 4 回合前锋**首次**受到伤害时进入规避状态，免疫该次伤害。
   * 官方：scripts/skill_extra.json id 200853（1 级 7% / 30%）。
   * 引擎配套（4 项）：
   *   ① `BaseSkill.teamGenderFilter: 'female'` —— 我军出战 3 将全为女将，否则整次不生效
   *      （与 `teamFactionDistinct` 同判定点；无性别数据者不匹配）；
   *   ② `delayedOutputs: [{ atRound: 1 }]` —— 官方口径「**正式回合开始后**」（非准备阶段）：
   *      大营增伤在第 1 回合回合开始、单位行动之前对锁定友军结算（匠心不竭既有链路），
   *      段级新增 `inflict_status.requirePositions: ['大营']` 限定站位；
   *   ③ `roundRepeat` + `onlyPositions: ['中军']`（p17 既有）—— 「中军每回合行动前」判定：
   *      准备阶段锁定我军全体，判定只落在中军身上；`requireGender:'male'` 段在**随机选人之前**
   *      预过滤敌军（否则会先随机到女将再被过滤掉而整段落空）；
   *      减伤为「**下一次**攻击或策略攻击」→ `damage_boost caused −60%` + `charges:1`（青丘媚祸先例）；
   *   ④ `onHurt{ timing:'before_damage', victim:'locked', victimPositions:['前锋'] }` + `grant_evasion`：
   *      「首次受到伤害时进入规避状态，免疫该次伤害」＝ 受击前授予 1 层规避并当场消耗（applyDamage 既有链路），
   *      `startRound:1 / endRound:4` ＝ 前 4 回合，`maxTriggers:1` ＝ 仅首次。
   */
  meiren_ji: {
    id: 'meiren_ji',
    name: '美人计',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    retainAfterDeath: true,
    teamGenderFilter: 'female',
    tags: ['damage_boost', 'evasion'],
    // ③ 中军每回合行动前：随机敌军单体男将「下一次攻击或策略攻击造成伤害降低 60%」
    output: [
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'random_single',
        requireGender: 'male',
        status: { type: 'damage_boost', rate: -0.6, duration: 999, direction: 'caused', charges: 1 },
      },
    ],
    roundRepeat: { startRound: 1, endRound: 8, rate: 1, onlyPositions: ['中军'] },
    // ② 正式回合开始后（第 1 回合开始、单位行动前）：大营造成的所有伤害提升 14%（整场）
    delayedOutputs: [
      {
        atRound: 1,
        output: [
          {
            kind: 'inflict_status',
            requirePositions: ['大营'],
            status: { type: 'damage_boost', rate: 0.14, duration: 999, direction: 'caused' },
          },
        ],
      },
    ],
    // ④ 前 4 回合前锋首次受到伤害 → 进入规避状态并免疫该次伤害
    onHurt: {
      victim: 'locked',
      victimPositions: ['前锋'],
      timing: 'before_damage',
      startRound: 1,
      endRound: 4,
      maxTriggers: 1,
      applyTo: 'victim',
      output: [{ kind: 'grant_evasion', stacks: 1, target: 'self' }],
    },
  },

  // ─── 批量31：下架武将清单 §1.2「补 1 个机制」逐个实现 ───

  /**
   * 计定山越（诸葛恪 h522·吴弓·主动 B）：1 回合准备，发动率 40%，距离 4，敌军群体 2 目标。
   * ① 使敌军群体陷入恐慌状态（伤害率 134%，受谋略属性影响），每回合损失兵力，持续 2 回合；
   * ② 若敌军群体士气一般或低落，额外使其陷入围困状态（无法恢复兵力）；
   * ③ 使自身和友军单体恢复一定兵力（恢复率 98%，受谋略属性影响）。
   * 官方：主动 B、发动率 40%、距离 4、目标「敌军群体（有效距离内 2 个目标）」、可用兵种弓
   * （scripts/skill_extra.json id 200762；满级 / 1 级描述：恐慌 134%/67%、恢复 98%/49%）。
   * 「受谋略属性影响」的恐慌 134% 与恢复 98% 成长率未确认 → 留空
   *   （strategyScaled 标记在；DoT / heal 的 growthRate 是**必填字段**，给 0 = 不缩放、用基值）。
   * 目标口径：「自身和友军单体」= 自身 + 1 名友军单体（不含自身），与奇佐鬼谋 / 合流同口径
   *   （self 段 + targetSide:'ally' + random_single + excludeSelf）。
   * 引擎配套：**无需新机制** —— ② 走既有 `morale_branch`（by:'target'、threshold 100：
   *   士气 >100 高昂走 high（本战法为空），一般（=100）/ 低落（<100）走 low），
   *   「士气一般或低落」即「非高昂」，故以 100 为阈值逐目标判定；③ 走既有 heal。
   */
  jiding_shanyue: {
    id: 'jiding_shanyue',
    name: '计定山越',
    type: 'active',
    prepare: true,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['panic', 'siege', 'heal'],
    output: [
      // ① 恐慌 DoT：134%（受谋略，成长率留空），持续 2 回合
      { kind: 'inflict_status', status: { type: 'panic', duration: 2, rate: 134, growthRate: 0 } },
      // ② 士气一般或低落（≤100）→ 追加围困 2 回合（恐慌 / 围困共用官方那句「持续 2 回合」）
      {
        kind: 'morale_branch',
        threshold: 100,
        by: 'target',
        high: [],
        low: [{ kind: 'inflict_status', status: { type: 'siege', duration: 2 } }],
      },
      // ③ 自身恢复 98%（受谋略，成长率留空）
      { kind: 'heal', rate: 98, strategyScaled: true, growthRate: 0, target: 'self' },
      // ④ 友军单体恢复 98%（不含自身；单体 = 距离内均匀随机）
      {
        kind: 'heal',
        rate: 98,
        strategyScaled: true,
        growthRate: 0,
        targetSide: 'ally',
        targetMode: 'random_single',
        excludeSelf: true,
      },
    ],
  },

  /**
   * 威震河朔（袁绍·群弓 h670·主动 A）：发动率 70%，距离 5，敌军群体（有效距离内 2 个目标）。
   * ① 对敌军群体发动一次攻击（伤害率 200%）；
   * ② 使自身与友军单体的主动战法伤害提升 20%（受攻击属性影响），持续 2 回合；
   * ③ 此战法每发动一次，其发动率降低 10%。
   * 官方：主动 A / 70% / 距离 5 / 敌军群体 2 / 弓（scripts/skill_extra.json id 200947）。
   * 官网该条为「攻击版 + 策略版」两段拼接，按仓库口径**只用前半**（攻击 200% + 受**攻击** 20%），
   * 与 web/data/heroes.json h670 清洗后描述一致（策略版 240% / 受谋略 24% 不实现）。
   * 受攻击的 20% 成长率未确认 → 留空（attackScaled: true 且不给 growthRate → 不缩放、用基值）。
   * 引擎配套：**新增 `triggerRateDecayPerCast`（主动战法发动率递减）** —— 每次成功发动后基础发动率
   * −0.1（可叠、最低 0），结算顺序 = 基础率 − 递减 + trigger_boost → × 士气；计数走 ctx.skillCastCounters。
   * 其余（群体攻击 / 「自身 + 友军单体」/ damage_boost 的 skillTypes 过滤）均为既有能力。
   */
  weizhen_heshuo: {
    id: 'weizhen_heshuo',
    name: '威震河朔',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.7,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    triggerRateDecayPerCast: 0.1,
    output: [
      // ① 敌军群体 2 目标：攻击 200%
      { kind: 'physical_damage', rate: 200 },
      // ② 自身：造成主动战法伤害 +20%（受攻击，成长率留空），2 回合
      {
        kind: 'inflict_status',
        targetSide: 'self',
        status: {
          type: 'damage_boost',
          rate: 0.2,
          duration: 2,
          direction: 'caused',
          skillTypes: ['active'],
          attackScaled: true,
        },
      },
      // ③ 友军单体（不含自身）：同款 +20%
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'random_single',
        excludeSelf: true,
        status: {
          type: 'damage_boost',
          rate: 0.2,
          duration: 2,
          direction: 'caused',
          skillTypes: ['active'],
          attackScaled: true,
        },
      },
    ],
  },

  /**
   * 匠心不竭（黄月英·蜀步 h20·指挥 A）：距离 6，敌军全体。
   * 战斗开始后，使敌军全体从第 1、3、5 回合开始，逐渐陷入恐慌（伤害率 34%）、燃烧（41%）、妖术（44%）
   * （均受谋略属性影响），每回合开始时损失一定兵力，持续直到战斗结束；所造成的伤害无视规避。
   * 官方：scripts/skill_extra.json id 200020（满级 34%/41%/44%，1 级 17%/20.5%/22%）；
   * targetShow「敌军群体（有效距离内 3 个目标）」——率土一队 3 人，与描述「敌军全体」等价，按 `all` 取目标
   * （同黄天当立 / 白衣渡江的全体口径）。
   * 成长率：「受谋略属性影响」三段均未确认 → 留空（DoT 的 growthRate 为必填字段，给 0 = 不缩放、用基值）。
   * 引擎配套：**新增 `CommandSkill.delayedOutputs`（一类指挥多次分段延迟施加）** ——
   *   第 atRound 回合开始、单位行动前，对准备阶段锁定的目标（存活者）执行该条目 output。
   * 无视规避：引擎 DoT 伤害不走规避判定（规避只作用于攻击伤害），自动满足。
   */
  jiangxin_bujie: {
    id: 'jiangxin_bujie',
    name: '匠心不竭',
    type: 'command',
    phase: 'prep',
    range: 6,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['panic', 'burning', 'sorcery'],
    output: [],
    delayedOutputs: [
      // 第 1 回合起：恐慌 34%（受谋略，成长率留空），至战斗结束
      {
        atRound: 1,
        output: [{ kind: 'inflict_status', status: { type: 'panic', duration: 999, rate: 34, growthRate: 0 } }],
      },
      // 第 3 回合起：燃烧 41%
      {
        atRound: 3,
        output: [{ kind: 'inflict_status', status: { type: 'burning', duration: 999, rate: 41, growthRate: 0 } }],
      },
      // 第 5 回合起：妖术 44%
      {
        atRound: 5,
        output: [{ kind: 'inflict_status', status: { type: 'sorcery', duration: 999, rate: 44, growthRate: 0 } }],
      },
    ],
  },

  /**
   * 全主诿异（孙鲁班·吴弓 h654·主动 B）：发动率 40%，距离 5。
   * ① 使敌军全体被施加的燃烧、恐慌和妖术诅咒伤害提升 20%（受谋略属性影响），持续 3 回合；
   * ② 同时对敌军群体 1-2 目标额外发动 1 次策略攻击（伤害率 197%，受谋略属性影响）。
   * 官方：scripts/skill_extra.json id 200937（满级 20% / 197%，1 级 10% / 98.5%）；
   * 「敌军全体」与「敌军群体 1-2 目标」是两个不同目标池 → 战法目标取伤害段的 groupCount [1,2]，
   * ① 用输出级 targetSide:'enemy' + targetMode:'all' 重选全体。
   * 成长率：两处「受谋略属性影响」均未确认 → 留空（strategyScaled 在、不给 growthRate → 按基值不缩放）。
   * 引擎配套：**新增 `damage_boost.dotTypes` 过滤维**（DoT 类型 = 燃烧 / 恐慌 / 妖术诅咒 / 妖术 / 引燃）——
   *   DoT 挂上时结算把 `dotType` 写进 DamageHitContext，`statusMatchesHit` 据此过滤；
   *   其余（输出级重选目标 / groupCount 区间 [1,2]）均既有（辕门射戟先例）。
   */
  quanzhu_weiyi: {
    id: 'quanzhu_weiyi',
    name: '全主诿异',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: [1, 2],
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      // ① 敌军全体：被施加的燃烧 / 恐慌 / 妖术诅咒伤害 +20%（受谋略，成长率留空），3 回合
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'all',
        status: {
          type: 'damage_boost',
          rate: 0.2,
          duration: 3,
          direction: 'taken',
          dotTypes: ['burning', 'panic', 'curse'],
          strategyScaled: true,
        },
      },
      // ② 敌军群体 1-2 目标：额外策略攻击 197%（受谋略，成长率留空）
      { kind: 'strategy_damage', rate: 197, strategyScaled: true },
    ],
  },

  /**
   * 举贤决机（荀彧·魏步 h794·指挥 S）：距离 5，敌我全体。
   * 首回合起，我军全体在被成功施加属性**提升**效果前，有 40% 几率使其恢复一定兵力（恢复率 60%，受谋略）；
   * 敌军全体在被成功施加属性**下降**效果前，有 40% 几率对其造成一次策略伤害（伤害率 100%，受谋略）；
   * 每种属性单独计算。
   * 官方：scripts/skill_extra.json id 200269（满级 60% / 100%，1 级 30% / 50%）。
   * 成长率：两处「受谋略属性影响」均未确认 → 留空（heal 的 growthRate 为必填 → 给 0；策略伤害不给 growthRate）。
   * 引擎配套：**新增 `CommandSkill.onAttrChange`（属性升降「之前」判定）** —— inflictStatus 内、属性状态
   *   成功施加之前（冲突判定之前）对「侧别 + 升降方向」匹配的规则各判一次，命中则对**被施加者**结算 output；
   *   每条属性（攻/防/谋/速）各自独立判定（一维一个状态）+ 士气修正（一类指挥生效几率）。
   * targetSide 取 'ally'：官方 targetShow 为「敌我全体」，引擎 targetSide 只能单侧，取友军侧用于目标登记与战报展示；
   * 实际两条规则覆盖双向（我军提升 → 恢复；敌军下降 → 策略伤害）。
   */
  juxian_jueji: {
    id: 'juxian_jueji',
    name: '举贤决机',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal', 'damage'],
    output: [],
    onAttrChange: [
      // 我军全体被施加属性提升（攻/防/谋/速各判一次）→ 40% 恢复 60%（受谋略，成长率留空）
      {
        victim: 'ally',
        sign: 'up',
        rate: 0.4,
        output: [{ kind: 'heal', rate: 60, strategyScaled: true, growthRate: 0 }],
      },
      // 敌军全体被施加属性下降 → 40% 一次策略伤害 100%（受谋略，成长率留空）
      {
        victim: 'enemy',
        sign: 'down',
        rate: 0.4,
        output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
      },
    ],
  },

  /**
   * 忠克猛烈（陈到·蜀步 h793·主动 S）：发动率 50%，距离 5，敌军单体。
   * 本战法造成的伤害无视兵种相克及目标的防御属性；对敌军单体发动 1 次攻击（伤害率 300%），
   * 并使其陷入犹豫状态（无法发动主动战法）持续 1 回合；直到陈到下回合行动前，目标每受到 1 次
   * 攻击伤害，陈到对其发动 1 次攻击（伤害率 120%），期间最多可触发 2 次。
   * 官方：scripts/skill_extra.json id 200268（1 级 150% / 60%）。
   * 全文无「受 XX 属性影响」→ **无成长率留空问题，不需要下架登记**（本批首个可上架武将）。
   * 引擎配套（2 项）：
   *  ① `physical_damage.ignoresDefense`（无视目标防御属性，防御按 0 计）；
   *  ② 新状态 `retaliate`（受击追加攻击标记）：携带者每受 1 次攻击伤害 → 标记施法者追加 1 次攻击
   *     （同口径：无视兵种相克 + 无视防御），最多 maxTriggers 次；窗口「直到施法者下回合行动前」
   *     由施法者行动时 `expireRetaliateOnCasterAct` 清除。
   * 口径：犹豫「持续1回合」按仓库同措辞先例（樊渊泅囚 / 怯心夺志「犹豫 1 回合」）取 duration 1
   *   ——即本回合内尚未行动的目标会被封住（若目标本回合已行动，则其下回合行动前到期）。
   */
  zhongke_menglie: {
    id: 'zhongke_menglie',
    name: '忠克猛烈',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.5,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage', 'hesitation', 'retaliate'],
    output: [
      // ① 无视兵种相克 + 无视目标防御的 300% 攻击
      { kind: 'physical_damage', rate: 300, ignoresTroopCounter: true, ignoresDefense: true },
      // ② 犹豫 1 回合
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 1 } },
      // ③ 受击追加攻击标记：每受 1 次攻击伤害 → 追加 1 次 120%，最多 2 次（窗口由施法者行动清除）
      { kind: 'inflict_status', status: { type: 'retaliate', duration: 999, rate: 120, maxTriggers: 2 } },
    ],
  },

  /**
   * 霸王渡江（孙策·吴骑 h450·被动 A）：距离 5，敌军单体。
   * 每回合有 40% 的几率对有效距离 5 以内的敌军单体发动三次猛烈攻击（伤害率 150%），每次攻击目标独立判定；
   * 本场战斗中自身无法发动主动战法；每次攻击造成伤害后可使霸王渡江发动率提升 3%，该效果可叠加 5 次。
   * 官方：scripts/skill_extra.json id 200771（官网两版本拼接 → 按仓库口径**只用前半**：3%/层；
   * 后半的 5%/层 不实现，与 web/data/heroes.json h450 清洗后描述一致）。
   * 全文无「受 XX 属性影响」→ 无成长率留空问题、不登记下架（**孙策上架**）。
   * 引擎配套：**新增 `chanceBoostPerDamage`（按造成伤害次数递增 chance_group 基础率）** ——
   *   每造成 1 次伤害（实际扣兵 > 0）计 1 层（上限 maxStacks），chance_group 基础率 = chance + increment×层数
   *   （再走士气）；计数走 ctx.skillDamageCounters（整场累计）。其余（被动 roundStartRepeat 每回合判定 /
   *   chance_group / repeats 多段独立选目标 / 自身犹豫）均既有（火兽冲锋 + 宣威再战先例）。
   */
  bawang_dujiang: {
    id: 'bawang_dujiang',
    name: '霸王渡江',
    type: 'passive',
    triggerRate: 1,
    timing: 'battle_start',
    range: 5,
    targetMode: 'self',
    tags: ['damage', 'hesitation'],
    chanceBoostPerDamage: { increment: 0.03, maxStacks: 5 },
    output: [
      // 本场战斗中自身无法发动主动战法（犹豫；被动/指挥不受影响）
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 999 } },
    ],
    roundStartRepeat: {
      output: [
        {
          kind: 'chance_group',
          chance: 0.4,
          outputs: [{ kind: 'physical_damage', rate: 150, targetMode: 'random_single', repeats: 3 }],
        },
      ],
    },
  },

  /**
   * 人公将军（张梁·群步 h557·指挥 B）：距离 3，我军全体 / 我军群体（官方 targetShow「我军群体（有效距离内 3 个目标）」）。
   * 战斗前 4 回合：使我军全体防御属性提高 60；使我军前锋、中军受到普通攻击时会进行反击（伤害率 75%）；
   * 在此期间，敌方武将存在妖术效果时造成的攻击伤害降低 20%。
   * 官方：scripts/skill_extra.json id 200795（指挥 B / 距离 3 / 我军群体 3 目标 / 步；
   * 满级 60 防御 + 反击 75% + 减伤 20%，1 级 30 / 37.5% / 10%）。
   * 全文无「受 XX 属性影响」→ 无成长率留空问题、不登记下架（**张梁上架**）。
   * 引擎配套：**新增 `damage_reduce.requireSelfStatus`（条件减伤）** —— 仅当携带者自身带该状态时本减伤才生效，
   *   在 sumReduce / collectDamageModifiers 按携带者**当前**状态实时判定（人公将军：仅对带「妖术」的敌军生效）。
   * 其余全部既有：一类指挥（准备阶段施加一次）/ 防御属性点数 buff / `counter` 反击资格（受普攻实际扣兵后反击来源）/
   *   inflict_status 的 positions 站位筛选（怀橘遗亲先例）。
   */
  rengong_jiangjun: {
    id: 'rengong_jiangjun',
    name: '人公将军',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['defense_buff', 'counter', 'damage_reduce'],
    output: [
      // ① 前 4 回合：我军全体防御 +60
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 60, duration: 4 } },
      // ② 前 4 回合：我军前锋 / 中军 受普攻时反击 75%
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        positions: ['前锋', '中军'],
        status: { type: 'counter', duration: 4, rate: 75 },
      },
      // ③ 前 4 回合：带「妖术」效果的敌军造成的攻击伤害 −20%（条件减伤，按携带者当前状态实时判定）
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'all',
        status: {
          type: 'damage_reduce',
          rate: 0.2,
          duration: 4,
          damageType: 'physical',
          requireSelfStatus: 'sorcery',
        },
      },
    ],
  },

  /**
   * 四世三公（袁绍·汉步 h6·主动 B）：发动率 35%，距离 5，敌军单体。
   * ① 使我军全体分别对距离 5 以内的敌军单体发动一次攻击（伤害率 150%），每次目标独立判定；
   * ② 额外使我军攻击属性最高单体，对敌军防御最低单体发动一次攻击（伤害率 160%）。
   * 官方：scripts/skill_extra.json id 200006（主动 B / 35% / 距离 5 / 敌军单体 / 步；1 级 75% / 80%）；
   * 官网描述为两段拼接（前半重复两次）→ 清洗后取前半 + 额外段，与 web/data/heroes.json h6 一致。
   * 全文无「受 XX 属性影响」→ 无成长率留空问题、不登记下架（**袁绍·汉上架**）。
   * 引擎配套（2 个选目标/选代打者开关，均挂在既有 `attacker:'recipient'` 代打路径上）：
   *  ① `physical_damage.attackerPick: 'highest_attack'`（只由我军攻击属性最高者出手）；
   *  ② `physical_damage.targetPick: 'lowest_defense'`（直接取存活敌军中防御最低者，无视距离）。
   * ① 段用 `attacker:'recipient'` + `targetMode:'random_single'`（我军全体各打一次、各自独立选目标）。
   */
  sishisan_gong: {
    id: 'sishisan_gong',
    name: '四世三公',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage'],
    output: [
      // ① 我军全体各自对距离 5 内敌军单体发动一次攻击 150%（每次独立选目标）
      {
        kind: 'physical_damage',
        rate: 150,
        attacker: 'recipient',
        targetMode: 'random_single',
        range: 5,
      },
      // ② 我军攻击属性最高单体 → 敌军防御最低单体，攻击 160%
      {
        kind: 'physical_damage',
        rate: 160,
        attacker: 'recipient',
        attackerPick: 'highest_attack',
        targetPick: 'lowest_defense',
      },
    ],
  },

  /**
   * 其徐如林（司马懿·晋步 h807·指挥 S）：距离 5，我军全体。
   * 我军全体在正式回合后施加的策略伤害，在生效时会对目标相邻的敌军额外造成一次策略伤害
   * （伤害率为原伤害率的 15%），此比例每回合结束时额外提升 5%，可叠加，持续至战斗结束。
   * 官方：scripts/skill_extra.json id 200282（指挥 S / 距离 5 / 我军全体 / 弓步骑；1 级 7.5% / 2.5%）。
   * 成长率：两处「受谋略属性影响」均未确认 → 留空（strategyScaled 在、不给 growthRate → 按基值不缩放）；
   * 登记 OFFLINE_MAIN_SKILLS（武将暂下架）。
   * 引擎配套：**新增 `CommandSkill.strategyAdjacentBonus`（策略伤害相邻跳伤光环）** ——
   *   本侧单位造成**策略伤害输出段**生效后，对目标同侧相邻单位额外结算一次策略伤害
   *   （伤害率 = 原伤害率 × (baseRate + perRound × (当前回合 − 1))）；额外伤害沿用原伤害造成者的
   *   攻击/兵力/增减伤口径，事件 skillId 记为其徐如林，直接构造 damage 事件（不递归触发本光环）。
   *   覆盖范围：策略伤害输出段；DoT 跳伤 / 分兵 / 引燃暂不触发（如需再补）。
   */
  qixu_rulin: {
    id: 'qixu_rulin',
    name: '其徐如林',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage'],
    output: [],
    strategyAdjacentBonus: { baseRate: 15, perRound: 5, strategyScaled: true },
  },

  /**
   * 徽言龙凤（司马徽·群步 h811·指挥 S）：距离 5，友军全体。
   * 友军全体共计造成 6 次伤害后，使友军全体获得：士气提升 10（受谋略属性影响）；
   * 每回合行动时造成的所有伤害提升 7%（受谋略属性影响），可叠加；
   * 每回合行动时有 60% 的几率对随机敌军单体造成 1 次攻击伤害（伤害率 150%）或策略攻击伤害
   * （伤害率 120%，受谋略属性影响），由攻击或谋略属性中较高的属性决定。
   * 官方：scripts/skill_extra.json id 200294（指挥 S / 距离 5 / 友军全体 / 弓步骑；
   * 1 级 士气 5 / 增伤 3.5% / 攻击 100% / 策略 60%）。
   * 成长率：士气、增伤、策略伤害三处「受谋略属性影响」均未确认 → 留空（增伤 strategyScaled 在、
   * 不给 growthRate = 基值；策略伤害率按下表基值直接用）→ 登记 OFFLINE_MAIN_SKILLS（司马徽下架）。
   * 引擎配套：
   *  ① **新增 `CommandSkill.teamDamageThreshold`（全队累计伤害门槛）** —— 本侧累计造成 N 次伤害后激活，
   *     立即结算激活段 output，并**启用**该战法的 roundStartRepeat（激活前不执行）；
   *  ② **新增 `physical_damage.recipientDamageByHigherStat`（代打伤害按代打者属性孰高定轨）** ——
   *     配合既有 `attacker:'recipient'` + `chance`（逐代打者各判一次）实现「每回合每个友军各 60% 一次，
   *     由该友军自己攻击/谋略孰高决定打攻击还是策略」。
   * 口径：③ 的 60% 由 recipient 路径**逐友军**各判一次（每回合每人一次）；伤害取该友军自己的面板。
   */
  huiyan_longfeng: {
    id: 'huiyan_longfeng',
    name: '徽言龙凤',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['morale_boost', 'damage_boost', 'damage'],
    output: [],
    teamDamageThreshold: {
      count: 6,
      // 激活瞬间：友军全体士气 +10（受谋略未确认 → 基值 10）
      output: [{ kind: 'inflict_status', status: { type: 'morale_boost', amount: 10, duration: 999 } }],
    },
    roundStartRepeat: {
      output: [
        // 每回合行动时：造成所有伤害 +7%（受谋略，成长率留空），可叠加
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: 0.07,
            duration: 1,
            direction: 'caused',
            strategyScaled: true,
            stacks: 1,
          },
        },
        // 每回合行动时：每名友军各 60% → 随机敌军单体，按自身攻击/谋略孰高打攻击 150% 或策略 120%
        {
          kind: 'physical_damage',
          rate: 0,
          attacker: 'recipient',
          recipientDamageByHigherStat: { attackRate: 150, strategyRate: 120 },
          chance: 0.6,
          targetMode: 'random_single',
          range: 5,
        },
      ],
    },
  },

  // ─── 批量32：下架武将清单 §1.2「补 1 个机制」（7 处歧义已由用户逐条确认）───
  /**
   * 破凰（司马懿·魏步 h472·主动 A·距离 5·45%·敌军单体）：
   * ① 立即引发**敌军全体**由破凰带来的剩余妖术效果（受击触发妖术的剩余次数逐次打出后移除）；
   * ② 对敌军单体发动一次策略攻击（155%，受谋略属性影响）；
   * ③ 使其每受到伤害时额外引发一次妖术伤害（130%，受谋略属性影响），最多生效 3 次，持续 3 回合。
   * 官方：scripts/skill_extra.json id 200080（满级 155%/130%，1 级 77.5%/65%）。
   * 描述为两版拼接：第一版目标「敌军单体」/ 第二版「敌军兵力最低的单体」
   *   → 用户确认取**第一版**（「兵力最低」需特殊目标选择机制，本战法不引入）。
   * 口径确认（用户）：「剩余妖术」= **本战法自身**此前施加的条件妖术的剩余次数——
   *   第 1 回合无存量 → ① 空转，直接 ②③；之后每次发动先引爆上一轮留下的剩余次数
   *   （例：剩余 3 次 → 连打 3 次妖术伤害并移除），再 ②③ 施加新的条件妖术。
   * 成长率：155% 与 130% 两段「受谋略属性影响」均未确认 → 155% 留空（基值不缩放）、
   *   130% 给 0（DoT growthRate 为必填字段）→ 登记 OFFLINE_MAIN_SKILLS（司马懿下架）。
   * 引擎配套：**`sorcery` 状态新增 `onHurt` / `charges`（受击触发妖术 + 次数上限）**，
   *   **新增输出段 `detonate_sorcery_marks`（引爆敌军全体由本战法施加的受击触发妖术剩余次数）**。
   */
  po_huang: {
    id: 'po_huang',
    name: '破凰',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.45,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage', 'sorcery'],
    output: [
      // ① 引爆敌军全体上由本战法留下的条件妖术（无存量时空转）
      { kind: 'detonate_sorcery_marks' },
      // ② 策略攻击 155%（受谋略未确认 → 基值不缩放）
      { kind: 'strategy_damage', rate: 155, strategyScaled: true },
      // ③ 条件妖术：受击触发一次妖术伤害 130%（受谋略未确认 → 基值），最多 3 次、持续 3 回合
      {
        kind: 'inflict_status',
        status: { type: 'sorcery', duration: 3, rate: 130, growthRate: 0, onHurt: true, charges: 3 },
      },
    ],
  },
  /**
   * 侵掠如火（甘宁·吴步 h34·被动 A）：距离 1，目标自己。
   * ① 在战斗中可以优先行动；
   * ② 攻击类主动战法发动率提升 20.0%；
   * ③ 进行攻击时有 30.0% 的几率使本次攻击伤害提高 50.0%。
   * 官方：scripts/skill_extra.json id 200034（被动 A / 距离 1 / 自己 / 兵种步；1 级 10% / 25%）。
   * 成长率：三段均无「受…属性影响」→ 无待确认成长率，**甘宁上架**（不登记 OFFLINE_MAIN_SKILLS）。
   * 口径（用户确认）：
   *  - ③「进行攻击」= 普通攻击 / 物理主动战法 / 追击战法；不含分兵溅射、反击、指挥代打（奇兵拒北）与 DoT；
   *  - ③ 按「每个伤害对象各掷一次」，官方未写受士气影响（属效果几率、非战法发动率）→ 固定 30%，不走 moraleTriggerRate。
   * 引擎配套：
   *  ① `PassiveSkill.priorityRounds`（被动先手，原 `priorityRounds` 仅指挥战法支持），combat.buildPriorityOrder 同步识别；
   *  ② `trigger_boost.attackSkillsOnly`（只提升「攻击类」战法发动率 = 输出段含物理伤害，含 chance_group / random_pick 内层）；
   *  ③ `PassiveSkill.attackProcBoost`（进行攻击时概率增伤，见 action.attackProcBoostOf / isAttackHitForProc）。
   */
  qinlue_ruhuo: {
    id: 'qinlue_ruhuo',
    name: '侵掠如火',
    type: 'passive',
    range: 1,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['damage_boost'],
    // ① 全程先手（duration ≥ 999 / priorityRounds 999 = 战斗结束约定）
    priorityRounds: 999,
    // ③ 进行攻击时 30% 几率本次攻击伤害 +50%
    attackProcBoost: { chance: 0.3, rate: 0.5 },
    output: [
      // ② 攻击类主动战法发动率 +20%（全程；只对输出含物理伤害的主动战法生效）
      {
        kind: 'inflict_status',
        target: 'self',
        status: {
          type: 'trigger_boost',
          rate: 0.2,
          duration: 999,
          skillTypes: ['active'],
          attackSkillsOnly: true,
        },
      },
    ],
  },
  /**
   * 三军夺帅（杜预·晋弓 h705·被动 S）：距离 5，目标自己。
   * 自身每成功发动普通攻击、主动及追击战法后，随机二选一（用户确认「或」= 每次触发 50/50）：
   *  ① 对距离 5 以内敌军单体发动一次攻击（180%）并使自身攻击属性提高 10；
   *  ② 对敌军群体 2 目标发动一次策略攻击（100%，受谋略属性影响）并使目标谋略属性降低 5；
   * 属性变化可叠加，持续到战斗结束。
   * 官方：scripts/skill_extra.json id 200987（被动 S / 距离 5 / 自己 / 兵种弓；1 级 90% / 10 / 50% / 5）。
   * 成长率：仅 ②「受谋略属性影响」→ 未确认，按基值（strategyScaled 在、growthRate 缺）→ 登记 OFFLINE_MAIN_SKILLS（杜预下架）。
   * 引擎配套：
   *  ① `PassiveSkill.afterAct`（成功发动普攻 / 主动 / 追击后触发，三种来源统一钩子）；
   *  ② 复用既有 `random_pick`（count:1 + 两组 options）= 50/50 随机二选一；
   *  ③ `inflict_status.sameTargetsAsLastDamage`（谋略 −5 打在 ② 策略段的同一批目标上，不重选）。
   */
  sanjun_duoshuai: {
    id: 'sanjun_duoshuai',
    name: '三军夺帅',
    type: 'passive',
    range: 5,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['damage', 'attack_buff', 'debuff_strategy'],
    output: [],
    afterAct: {
      output: [
        {
          kind: 'random_pick',
          count: 1,
          options: [
            // ① 距离 5 以内敌军单体攻击 180% + 自身攻击 +10（同战法重复触发累加、持续到战斗结束）
            [
              { kind: 'physical_damage', rate: 180, targetMode: 'random_single' },
              {
                kind: 'inflict_status',
                target: 'self',
                status: { type: 'attack_buff', amount: 10, duration: 999 },
              },
            ],
            // ② 敌军群体 2 目标策略攻击 100%（受谋略）+ 目标谋略 −5（同一批目标）
            [
              {
                kind: 'strategy_damage',
                rate: 100,
                strategyScaled: true,
                targetMode: 'group',
                groupCount: 2,
              },
              {
                kind: 'inflict_status',
                sameTargetsAsLastDamage: true,
                status: { type: 'strategy_buff', amount: -5, duration: 999 },
              },
            ],
          ],
        },
      ],
    },
  },
  /**
   * 奉令护蜀（马岱·蜀骑 h615·被动 A）：距离 2，目标自己。
   * 战斗中，任意友军发动普通攻击、主动战法、追击战法后，马岱的下 1 次普通攻击造成的伤害提升 35.0%
   * （受攻击属性影响），下 1 次受到的所有伤害降低 20.0%（受防御属性影响），以上效果可叠加 5 次。
   * 官方：scripts/skill_extra.json id 200865（被动 A / 距离 2 / 自己 / 兵种骑；1 级 17.5% / 10.0%）。
   * 口径（用户确认）：层数上限 5；攻击段与减伤段**共用同一层数**、都 = 基值 × 层数，
   *   各自在对应时机（普攻打出后 / 首次受击实际扣兵后）**清空全部层数**（先到先清）。
   * 口径（本次推定，待复核）：「任意友军」**不含马岱自身**——官方对含己场景用「我军全体」
   *   （皇裔流离），此处措辞刻意区分；若按含己实现，马岱每次普攻会「先清空再被自己补 1 层」。
   *   切换成本：`triggerAllyActStacks` 里去掉 `if (holder === actor) continue;` 一行。
   * 成长率：35% 受攻击、20% 受防御 两段成长率未确认 → 按基值（`boostAttackScaled` / `reduceDefenseScaled`
   *   标记在、growthRate 缺）→ 登记 OFFLINE_MAIN_SKILLS（马岱下架）。
   * 引擎配套：`PassiveSkill.allyActStacks`（友军成功发动后叠层）+ 新状态 `pending_stacks`
   *   （下次普攻增伤 / 下次受击减伤，触发后清空全部层数；不按回合递减，两个 tick 函数显式跳过）。
   */
  fengling_hushu: {
    id: 'fengling_hushu',
    name: '奉令护蜀',
    type: 'passive',
    range: 2,
    triggerRate: 1,
    timing: 'battle_start',
    targetMode: 'self',
    tags: ['damage_boost', 'damage_reduce'],
    output: [],
    allyActStacks: {
      maxStacks: 5,
      boostRate: 0.35,
      boostAttackScaled: true,
      reduceRate: 0.2,
      reduceDefenseScaled: true,
    },
  },
  /**
   * 地公将军（张宝·群弓 h562·主动 B）：距离 4，40%，敌军群体（有效距离内 2 个目标）。
   * 对敌军群体发动策略攻击（136%，受谋略属性影响），并吸取其 24.0 的防御、谋略属性并附加于友军群体
   * （受谋略属性影响），若有目标存在妖术效果，则额外附加属性至自身，持续 2 回合。
   * 官方：scripts/skill_extra.json id 200796（主动 B / 距离 4 / 敌军群体2 / 兵种弓；1 级 68% / 12）。
   * 口径（用户确认）：
   *  - 「友军群体」= 有效距离内 2 个目标（与敌方目标数同口径）；
   *  - 「妖术效果」= sorcery（妖术）| curse（妖术诅咒）。
   * 口径（本次推定，待复核）：友军段 `excludeSelf`——原文「**额外**附加属性至自身」表明自身不在
   *   「友军群体」之内（否则第 ④ 段无从「额外」）。
   * 成长率：136% 与 24.0 两处「受谋略属性影响」均未确认 → 按基值（strategyScaled 在、growthRate 缺）
   *   → 登记 OFFLINE_MAIN_SKILLS（张宝下架）。
   * 引擎配套：**新增 `inflict_status.requireAnyPrevDamageTargetStatus`**（整段开关：上一段伤害的命中目标中
   *   存在带指定状态之一者才结算）——承载「若有目标存在妖术效果」条件分支；
   *   敌军段复用 `sameTargetsAsLastDamage`（吸取打在本段策略伤害的同一批目标上）。
   */
  digong_jiangjun: {
    id: 'digong_jiangjun',
    name: '地公将军',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'defense_buff', 'strategy_buff', 'debuff_defense', 'debuff_strategy'],
    output: [
      // ① 策略攻击 136%（受谋略未确认 → 基值）
      { kind: 'strategy_damage', rate: 136, strategyScaled: true, targetMode: 'group', groupCount: 2 },
      // ② 吸取：敌军**同一批目标** −24 防御 / −24 谋略（applyAll = 同目标同时施加两条）
      {
        kind: 'inflict_status',
        sameTargetsAsLastDamage: true,
        applyAll: true,
        status: [
          { type: 'defense_buff', amount: -24, duration: 2, strategyScaled: true },
          { type: 'strategy_buff', amount: -24, duration: 2, strategyScaled: true },
        ],
      },
      // ③ 附加于友军群体（有效距离内 2 目标，不含自身）＋24 防御 / ＋24 谋略
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
        excludeSelf: true,
        applyAll: true,
        status: [
          { type: 'defense_buff', amount: 24, duration: 2, strategyScaled: true },
          { type: 'strategy_buff', amount: 24, duration: 2, strategyScaled: true },
        ],
      },
      // ④ 若有目标存在妖术效果 → 额外附加属性至自身
      {
        kind: 'inflict_status',
        target: 'self',
        applyAll: true,
        requireAnyPrevDamageTargetStatus: ['sorcery', 'curse'],
        status: [
          { type: 'defense_buff', amount: 24, duration: 2, strategyScaled: true },
          { type: 'strategy_buff', amount: 24, duration: 2, strategyScaled: true },
        ],
      },
    ],
  },
  /**
   * 西陵克晋（陆抗·吴步 h574·指挥 S）：距离 4，目标自己，每回合 50% 几率。
   * 战斗中，每回合有 50.0% 的几率使我军当前攻击属性最高的武将对距离 4 以内的敌军发动一次攻击（150%），
   * 我军当前谋略属性最高的武将对距离 4 以内的敌军发动一次策略攻击（150%，受谋略属性影响），并各自恢复一定兵力。
   * 官方：scripts/skill_extra.json id 200824（指挥 S / 距离 4 / 自己 / 兵种步；1 级 75%）。
   * 官方攻略（stzb.163.com/strategy/zfxq/2019/10/09/21006_836478.html，17173 转载同文）补充口径：
   *  - 属于 **Ⅱ 类指挥战法**、「战斗中执行效果类」→ 每回合行动时判定（混乱/犹豫不阻止执行）→ `phase:'round'`；
   *  - 伤害由**被施加效果的友军（代打者）自身属性**决定，并吃代打者自己的增伤（如马超【血溅黄沙】+120%）；
   *  - 恢复为**立即型急救**：与任何恢复类战法不冲突，「恢复量与任何属性无关，仅由武将执行时的自身兵力决定，
   *    9000 兵力时单口最大恢复量在 300 左右」。
   * 口径（本次认定，待复核）：官方技能文本只有**一处**「每回合有 50.0% 的几率使 …，…」（攻略分列 1./2. 只是列举）
   *   → 50% 由二类指挥自身 `triggerRate` 承载（走士气），两段同时结算，**不再叠 chance_group**；
   *   若实际为两段各自独立 50%，改动 = 把两段包进 chance_group(chance .5)。
   * 恢复率：官方技能文本**未给**恢复率 → 取基值 100%（无缩放），恢复量 = calcHealAmount(代打者当前兵力, 100)；
   *   9000 兵力 = 216。⚠️ 与攻略「9000 兵力约 300」有差距，已记入 OFFLINE 说明待复核。
   * 成长率：谋略攻击 150% 段「受谋略属性影响」成长未确认 → 按基值（strategyScaled 在、growthRate 缺）
   *   → 登记 OFFLINE_MAIN_SKILLS（陆抗下架）。
   * 引擎配套：`physical_damage.attacker` 新增 `'highest_attack_ally'`、`strategy_damage.attacker` 新增
   *   `'highest_strategy_ally'`（我军当前攻击 / 谋略最高者代打，**含施法者自身**——官方「也有可能施加给陆抗自己」），
   *   两段新增 `healSource`（代打者按自身当前兵力立即恢复，heal 事件归属施法者）。
   */
  xiling_kejin: {
    id: 'xiling_kejin',
    name: '西陵克晋',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 4,
    triggerRate: 1,
    // 二类指挥的固定 50% 发动率走 dynamicTriggerRate（CommandSkill.triggerRate 定型为 1；increment 0 = 恒定）
    dynamicTriggerRate: { base: 0.5, increment: 0 },
    targetMode: 'self',
    tags: ['damage', 'heal'],
    output: [
      // ① 攻击最高友军（含自身）代打 150% + 按自身当前兵力恢复
      {
        kind: 'physical_damage',
        rate: 150,
        attacker: 'highest_attack_ally',
        targetMode: 'random_single',
        healSource: { rate: 100 },
      },
      // ② 谋略最高友军（含自身）代打策略 150%（受谋略未确认 → 基值）+ 按自身当前兵力恢复
      {
        kind: 'strategy_damage',
        rate: 150,
        strategyScaled: true,
        attacker: 'highest_strategy_ally',
        targetMode: 'random_single',
        healSource: { rate: 100 },
      },
    ],
  },
  /**
   * 缚父临危（吕姬·群步 h634·主动 B）：距离 4，35%，敌军群体（有效距离内 2 个目标）。
   * 对敌军群体发动一次攻击（210%），并使自身及友军攻击属性最高的单体下两次攻击造成的伤害提升 30.0%。
   * 同时使友军中吕布下一次造成的伤害无视规避。
   * 官方：scripts/skill_extra.json id 200902（主动 B / 距离 4 / 敌军群体2 / 兵种步；1 级 105% / 15%）。
   * 口径（用户确认）：
   *  - 「攻击」= 普通攻击 / 物理主动战法 / 追击战法（同侵掠如火，不含分兵溅射 / 反击 / 指挥代打 / DoT）；
   *  - 「无视规避」覆盖**任意伤害类型**（攻击与策略都算）；
   *  - 「友军中吕布」按**武将名**匹配，两张卡（h3 汉骑 / h479 群弓 SP 吕布）都算；队里无吕布则该句空转。
   * 成长率：210% 与 30% 两段均无「受…属性影响」→ 无待确认成长率，**吕姬上架**（不登记 OFFLINE）。
   * 引擎配套：
   *  ① `inflict_status.targetPick`：`'highest_attack_ally'`（我军攻击最高单体，含施法者自身）/
   *     `'ally_named'`（配合 targetPickName 按武将名匹配）；
   *  ② `damage_boost.attackOnly`（仅「进行攻击」，复用侵掠如火建立的 isAttackHitForProc 口径）
   *     + `charges: 2`（下**两**次攻击，由既有 consumeAttackCharges 逐次消耗）；
   *  ③ 新状态 `ignore_evasion`：下一次造成伤害无视规避，在所有伤害路径的统一入口 consumeEvasion 内消耗。
   */
  fufu_linwei: {
    id: 'fufu_linwei',
    name: '缚父临危',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      // ① 对敌军群体（有效距离内 2 目标）发动一次攻击 210%
      { kind: 'physical_damage', rate: 210, targetMode: 'group', groupCount: 2 },
      // ② 自身及友军攻击属性最高的单体：下两次「进行攻击」造成的伤害 +30%
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetPick: 'highest_attack_ally',
        status: {
          type: 'damage_boost',
          rate: 0.3,
          duration: 999,
          direction: 'caused',
          charges: 2,
          attackOnly: true,
        },
      },
      // ③ 友军中吕布：下一次造成的伤害无视规避（按名匹配，两张吕布卡都算）
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetPick: 'ally_named',
        targetPickName: '吕布',
        status: { type: 'ignore_evasion', duration: 999 },
      },
    ],
  },
  /**
   * 连环计（王允·汉弓 h693·主动 A）：距离 4，敌军单体，官方发动率 20%-30%（**取上界 30% = 满级口径**，
   * 同浑水摸鱼 25-35→35 / 妖术 30-50→50 / 九锡黄龙 25-35→35 的既有惯例）。
   * 对敌军单体施加连环计，**依次发动**下列战法：对连环计目标发动一次「伐谋」；
   * 若连环计目标谋略低于自身，则对随机敌军单体发动一次「迷阵」；
   * 若连环计目标处于暴走状态，则对随机敌军单体发动一次「落雷」。每个战法的效果与原战法在同等级下效果相同。
   * 官方：scripts/skill_extra.json id 200714（主动 A / 距离 4 / 敌军单体 / 兵种弓）。
   * 入档判断：**上架**——三段效果全部借用已注册战法（伐谋 209%/2.175、迷阵 155%/1.5、落雷 148%/1.35，
   *   成长率均已确认），本战法自身无数值待定。
   * 引擎配套：**新增 `BaseSkill.chainSkills`（战法链）** —— 依序执行其他已注册战法的 `output`，
   *   每步条件在**该步执行时**求值（伐谋先降主目标谋略 → 影响迷阵判定；迷阵命中主目标时挂暴走 → 影响落雷判定）；
   *   被引用战法的 triggerRate 不参与判定（本战法已掷过发动率）。
   */
  lianhuanji: {
    id: 'lianhuanji',
    name: '连环计',
    type: 'active',
    prepare: false,
    range: 4,
    triggerRate: 0.3,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage', 'rampage', 'confusion', 'debuff_attack', 'debuff_strategy'],
    output: [],
    chainSkills: [
      // ① 对连环计目标发动一次「伐谋」（策略 209% 受谋略 + 攻/谋 −45 两回合）
      { skillId: 'famou' },
      // ② 若连环计目标谋略低于自身 → 对随机敌军单体发动「迷阵」（策略 155% + 暴走 1 回合）
      { skillId: 'mizhen', targetMode: 'random_single', requireTargetStrategyBelowSelf: true },
      // ③ 若连环计目标处于暴走状态 → 对随机敌军单体发动「落雷」（策略 148% + 混乱 1 回合）
      { skillId: 'luolei', targetMode: 'random_single', requireTargetStatus: 'rampage' },
    ],
  },
  /**
   * 率尔方雅（胡芳·晋步 h797·主动 A）：距离 5，发动率 40%，敌我群体（有效距离内 3 个目标）。
   * 对自身以外的随机 3 名武将造成一次攻击伤害（伤害率 10.0%）；若目标为友军，则使其造成的所有伤害
   * 提升 22.0%（受谋略属性影响）持续 1 回合，并使其立即对敌军群体发动一次攻击（伤害率 180.0%）或
   * 策略攻击（伤害率 180.0%，受谋略属性影响），伤害类型由该武将自身攻击和谋略较高值决定；
   * 若目标为敌军，则使其随机陷入犹豫、混乱、暴走、怯战状态中的一种，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200273（主动 A / 距离 5 / 敌我群体3 / 兵种弓步骑 / 发动率 40%；
   *   1 级 10% / 增伤 11% / 90%）。
   * 入档判断：**下架** —— 22% 增伤与 180% 策略段均「受谋略属性影响」而官方未给成长系数，
   *   按本批口径留空 `growthRate`（按基值不缩放）+ 登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套：
   *   ① `BaseSkill.targetPool:'mixed'`（敌我同池随机 N，排除施法者自身）；
   *   ② `SkillOutput.lockedSide`（段级按阵营过滤**锁定目标**，不重选池）——同一批 3 个目标里，
   *      友军走「增伤 + 代打」、敌军走「随机控制」；
   *   ③ 友军代打复用 `attacker:'recipient'` + `recipientDamageByHigherStat`（徽言龙凤口径：
   *      攻击 > 谋略 → 攻击伤害，否则策略伤害），选敌复用 `targetMode:'group'`（敌军群体 2 目标）。
   */
  lv_er_fang_ya: {
    id: 'lv_er_fang_ya',
    name: '率尔方雅',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.4,
    targetMode: 'group',
    groupCount: 3,
    targetPool: 'mixed',
    tags: ['damage', 'damage_boost', 'hesitation', 'confusion', 'rampage', 'cowardice'],
    output: [
      // ① 对自身以外随机 3 名武将（敌我同池）各造成一次攻击伤害 10%
      { kind: 'physical_damage', rate: 10 },
      // ② 友军：造成的所有伤害 +22%（受谋略）1 回合（成长率未确认 → 按基值 22% 不缩放）
      {
        kind: 'inflict_status',
        lockedSide: 'ally',
        status: {
          type: 'damage_boost',
          rate: 0.22,
          direction: 'caused',
          strategyScaled: true,
          duration: 1,
        },
      },
      // ③ 友军：立即对敌军群体（有效距离内 2 目标）发动一次攻击 / 策略攻击 180%，
      //    伤害类型由该武将自身攻击与谋略孰高决定（代打者属性、吃代打者自身增减伤）
      {
        kind: 'physical_damage',
        rate: 0, // 由 recipientDamageByHigherStat 定轨（攻击 180% / 策略 180%），本字段忽略
        attacker: 'recipient',
        lockedSide: 'ally',
        recipientDamageByHigherStat: { attackRate: 180, strategyRate: 180 },
        targetMode: 'group',
        groupCount: 2,
      },
      // ④ 敌军：随机陷入犹豫 / 混乱 / 暴走 / 怯战之一，持续 1 回合
      {
        kind: 'inflict_status',
        lockedSide: 'enemy',
        status: [
          { type: 'hesitation', duration: 1 },
          { type: 'confusion', duration: 1 },
          { type: 'rampage', duration: 1 },
          { type: 'cowardice', duration: 1 },
        ],
      },
    ],
  },
  /**
   * 鸾凤和鸣（小乔·吴弓 h687·指挥 A）：距离 3，我军全体。
   * 战斗中，自身每回合首次发动主动战法后，使我军群体 2 目标恢复一定兵力（恢复率 85.0%，受谋略属性影响）；
   * 每回合自身行动时，使我军全体 3 目标造成的下一次随机目标的控制效果（混乱、犹豫、暴走、怯战）额外对一个目标生效。
   * 官方：scripts/skill_extra.json id 200960（指挥 A / 距离 3 / 我军全体 / 兵种弓；1 级 42.5%）。
   * 入档判断：**下架** —— 85% 恢复率「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套：
   *   ① 新状态 `control_spread`（控制效果 +1 目标）：消耗制标记，携带者打出控制（混乱/犹豫/暴走/怯战）时
   *      额外对 1 个「距离内、未在本段目标池内」的随机敌军生效（段级在 executeSkillOutputs 的 inflict_status
   *      分支统一处理，覆盖主动/追击/指挥各来源的控制段），随后消耗；
   *   ② `CommandSkill.afterFirstActiveOutput`：与 `roundTrigger` 解耦的「本回合首次主动战法成功释放后」附加段
   *      —— 本战法主判定走 on_act（②「每回合自身行动时」），① 的恢复段走该附加钩子。
   */
  luanfeng_heming: {
    id: 'luanfeng_heming',
    name: '鸾凤和鸣',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 3,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [
      // ② 每回合自身行动时：我军全体获得「下一次造成的控制效果额外 +1 目标」（消耗制）
      { kind: 'inflict_status', status: { type: 'control_spread', duration: 999 } },
    ],
    afterFirstActiveOutput: [
      // ① 自身每回合首次发动主动战法后：我军群体 2 目标恢复 85%（受谋略；成长率未确认 → 0 基值不缩放）
      {
        kind: 'heal',
        rate: 85,
        strategyScaled: true,
        growthRate: 0,
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
      },
    ],
  },
  /**
   * 赐剑长驱（刘禅·蜀步 h689·指挥 A）：距离 3，官方目标「友军全体」。
   * 战斗中自身无法释放主动战法或进行普通攻击，令友军全体每回合首次成功释放主动战法后，
   * 有 40.0% 几率（受谋略属性影响）再次发动（跳过所有准备回合），造成原战法 50.0% 的伤害和恢复效果。
   * 官方：scripts/skill_extra.json id 200962（指挥 A / 距离 3 / 友军全体 / 兵种步；1 级 发动率 20% / 效果 25%）。
   * 入档判断：**下架** —— 再次发动几率 40%「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套：
   *   ① 自身封禁用既有控制状态（犹豫 = 无法主动、怯战 = 无法普攻），准备阶段对自身施加 duration 999
   *      （与官方效果标签「犹豫(自身);怯战(自身)」一致；可被移除有害效果类战法净化）；
   *   ② `CommandSkill.allyRecast`（友军每回合首次成功主动后按几率再次发动同一战法、跳过准备、按 factor 缩放
   *      伤害与恢复）——监听入口 triggerAllyRecastCommands，由主动战法成功释放点调用（含准备战法释放）。
   * 口径说明（本次新机制）：官方目标列写的「友军全体」是**监听范围**，本战法自身 output 只作用于自身，
   *   故 targetMode:'self'；再次发动的 50% 只缩放「战法自身 output 的伤害/恢复段」（战法链等元机制段不缩放）。
   */
  cijian_changqu: {
    id: 'cijian_changqu',
    name: '赐剑长驱',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['hesitation', 'cowardice'],
    output: [
      // 自身无法释放主动战法（犹豫）/ 无法进行普通攻击（怯战）：整场常驻
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 999 } },
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 999 } },
    ],
    // 友军全体每回合首次成功释放主动战法后：40%（受谋略，成长率未确认 → 基值）再次发动，伤害/恢复 ×50%
    allyRecast: { rate: 40, factor: 0.5 },
  },
  /**
   * 僭号天子（袁术·群步 h790·指挥 S）：距离 3，我军全体。
   * 战斗开始后获得玉玺：我军全体受到的所有伤害的 32.0%（受防御属性影响）由玉玺承担；
   * 第二回合起，每回合开始时玉玺对袁术造成其上一回合承担的所有伤害，袁术仅受到来自玉玺伤害的 50%，
   * 该比例每回合上升 10%。
   * 官方：scripts/skill_extra.json id 200262（指挥 S / 距离 3 / 我军全体 / 兵种步；1 级 16%）。
   * 入档判断：**下架** —— 32%「受防御属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套（新机制「伤害承担/转移（玉玺）」）：
   *   ① `CommandSkill.sealTransfer` + `ctx.sealLedgers`：准备阶段注册账本；`applyDamage` 里我军受击时
   *      按「32% 受持有者生效防御缩放」把伤害转入账本（本回合不从受击者扣兵）；
   *   ② `tickRoundStartStatuses` 每回合开始时（第 2 回合起）对持有者结算
   *      「上一回合承担量 × 本回合承担比例」，比例 50% 起每回合 +10%（封顶 100%），账本清零；
   *      结算伤害走 `applyDamage`（策略、无视规避的定值伤害），但置 `ctx.sealResolving`
   *      使玉玺伤害不再被玉玺自己转移（防自循环）；
   *   ③ 结转走独立事件 `seal_settle`（不计入杀伤统计——这是玉玺对自己人的结转，不是施法者的杀伤），
   *      report.ts 单独渲染。
   * 口径推定（本次新机制，待用户复核）：
   *   - 「该比例每回合上升 10%」= 袁术**承担比例** 50% → 60% → … 每回合 +10%，**封顶 100%**（不会超过结转量）；
   *   - 「我军全体受到的所有伤害」含袁术自身受到的伤害，但**不含玉玺结转给他自己的那一次**；
   *   - 「受防御属性影响」取袁术（施法者）当期生效防御；成长率未确认 → 基值 32%。
   */
  jianhao_tianzi: {
    id: 'jianhao_tianzi',
    name: '僭号天子',
    type: 'command',
    phase: 'prep',
    range: 3,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage'],
    output: [],
    // 玉玺：我方全体受击的 32%（受防御，成长率未确认 → 基值）转入账本，每回合开始结转给自身
    sealTransfer: { rate: 32 },
  },
  /**
   * 伏波扬砂（马腾·群骑 h785·指挥 S）：距离 5，我军全体。
   * 使我军全体普通攻击伤害提升 25.0%（受攻击属性影响）。当友军全体发动普通攻击时，造成的伤害
   * 共计提升幅度每达到 40%，马腾获得 1 层【扬砂】效果，最多叠加 20 层；马腾发动普通攻击后，
   * 将消耗 4 层【扬砂】效果进入连击状态，额外发动一次普通攻击，此效果将重复触发直到不足 4 层。
   * 官方：scripts/skill_extra.json id 200255（指挥 S / 距离 5 / 我军全体 / 兵种骑；1 级 12.5%）。
   * 入档判断：**下架** —— 25%「受攻击属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套（新机制「层数累计 + 消耗触发」`stacksConsume`）：
   *   ① 普攻增伤段：`damage_boost` direction:'caused' + `damageSource:'basic'`（只作用于普通攻击）
   *      + `attackScaled`（受攻击，成长率未确认 → 基值 25%），整场常驻施加给我军全体；
   *   ② 层数累计：`dealAttack` 命中后把该次普攻的**增减伤净幅度**（`buffMult(...) − 1` ×100 个百分点，
   *      总增伤 − 总减伤，含兵种克制）累入 `ctx.stacksConsumeCounters`；每满 40 扣 40 并 +1 层（上限 20）；
   *   ③ 消耗触发：`actUnit` 普攻阶段后，马腾每 4 层换一次额外普通攻击，重复触发至不足 4 层
   *      （额外普攻同样累计层数；单次行动上限 20 次防失控）。
   * 口径（**用户 2026-09-19 口述**）：「伤害共计提升幅度」= 该次普攻的**总增伤与总减伤净合计**（百分点），
   *   用变量累计、每满 40% 扣 40% 得 1 层（余数保留）。
   */
  fuboyangsha: {
    id: 'fuboyangsha',
    name: '伏波扬砂',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_boost', 'combo'],
    output: [
      // 我军全体：普通攻击伤害 +25%（受攻击，成长率未确认 → 基值），整场常驻
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.25,
          duration: 999,
          direction: 'caused',
          attackScaled: true,
          damageSource: 'basic',
        },
      },
    ],
    // 【扬砂】：每次普攻按「增减伤净幅度」累计，每满 40% 得 1 层（上限 20）；普攻后每 4 层换 1 次额外普攻
    stacksConsume: { threshold: 40, maxStacks: 20, consumePerAttack: 4 },
  },
  /**
   * 潜谋远计（羊祜·晋步 h709·指挥 S）：距离 5，官方目标「自己」。
   * 战斗中前 4 回合自身受到伤害时，有 60.0% 几率使自身恢复一定兵力（恢复率 100.0%，受谋略属性影响）
   * 并使谋略属性和防御属性提高 15.0，可叠加，持续至战斗结束；第 5 回合起，每回合行动时，
   * 对谋略低于自身的敌军全体有 60.0% 几率造成一次策略攻击（伤害率 140.0%，受谋略属性影响）。
   * 仅对自身处于前锋或中军位置时生效。
   * 官方：scripts/skill_extra.json id 200991（指挥 S / 距离 5 / 自己 / 兵种步；1 级 恢复 50% / 属性 7.5 / 伤害 70%）。
   * 入档判断：**下架** —— 恢复率 100% / 策略伤害 140% / 属性 +15 均「受谋略属性影响」而官方未给成长系数 →
   *   按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套：
   *   ① `BaseSkill.casterPositions`（整次生效的站位条件：仅前锋/中军；准备阶段与受击监听/被动入口统一判定）；
   *   ② `strategy_damage.requireTargetStrategyBelowSelf`（「谋略低于自身」逐目标过滤，按**生效谋略**比较）；
   *   ③ 前 4 回合受击段复用既有 `onHurt`（victim:'self' + endRound:4 + applyTo:'victim' + output）——
   *      60% 受击判定、恢复（受谋略）+ 谋略/防御各 +15（可叠加至战斗结束）；
   *   ④ 第 5 回合起「每回合行动时」段走 `roundStartRepeat`（startRound:5）——沿用徽言龙凤既有口径
   *      （官方「每回合行动时」在引擎里以回合前结算实现）；60% 走输出级 `chance`（士气修正后逐段判定）。
   */
  qianmou_yuanji: {
    id: 'qianmou_yuanji',
    name: '潜谋远计',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'enemy',
    casterPositions: ['前锋', '中军'],
    tags: ['heal', 'strategy_buff', 'defense_buff', 'damage'],
    // 前 4 回合自身受击 60%：恢复 + 谋略/防御 +15（可叠加，持续至战斗结束）
    onHurt: {
      victim: 'self',
      rate: 0.6,
      endRound: 4,
      applyTo: 'victim',
      output: [
        { kind: 'heal', rate: 100, strategyScaled: true, growthRate: 0, target: 'self' },
        {
          kind: 'inflict_status',
          status: { type: 'strategy_buff', amount: 15, duration: 999, strategyScaled: true, growthRate: 0 },
        },
        {
          kind: 'inflict_status',
          status: { type: 'defense_buff', amount: 15, duration: 999, strategyScaled: true, growthRate: 0 },
        },
      ],
    },
    output: [],
    // 第 5 回合起每回合行动时：对谋略低于自身的敌军全体 60% 造成策略攻击 140%（受谋略）
    roundStartRepeat: {
      startRound: 5,
      output: [
        {
          kind: 'strategy_damage',
          rate: 140,
          strategyScaled: true,
          growthRate: 0,
          chance: 0.6,
          requireTargetStrategyBelowSelf: true,
        },
      ],
    },
  },
  /**
   * 心战为上（马谡·蜀骑 h799·指挥 A）：距离 5，我军全体。
   * 使我军全体每对敌军造成一次伤害时，伤害目标士气降低 5 点，我军全体累计可触发 9 次；
   * 使我军全体对敌军造成攻击伤害后，借此恢复相当于伤害值 50.0%（受谋略属性影响）的兵力。
   * 官方：scripts/skill_extra.json id 200275（指挥 A / 距离 5 / 我军全体 / 兵种弓步骑；1 级 25%）。
   * 入档判断：**下架** —— 攻心恢复率 50%「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套（新机制「攻心 + 士气降低」）：
   *   ① `CommandSkill.healOnDamage` + `ctx.healOnDamageTriggers`：`applyDamage` 内我军对敌军造成实际伤害后，
   *      使伤害目标士气 −5（走 `morale_boost` **负值**状态，整场常驻、同战法累加），全队累计最多 9 次；
   *   ② 同一次伤害若为**攻击伤害**（physical），造成伤害者按 50%（受施法者谋略缩放）恢复本次伤害值对应的兵力
   *      （heal 事件归属施法者，计入战报恢复统计）；
   *   ③ 士气正负共存：`morale_boost` 纳入「正负相反不冲突、各自共存」口径（士气提高 vs 士气降低由
   *      effectiveMorale 相加得净士气）。
   */
  xinzhan_weishang: {
    id: 'xinzhan_weishang',
    name: '心战为上',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['heal'],
    output: [],
    // 攻心（攻击伤害后按 50% 恢复，受谋略）+ 士气降低（每次伤害使目标 −5，全队累计 9 次）
    healOnDamage: { moraleReduce: 5, maxTriggers: 9, healRate: 50 },
  },
  /**
   * 举抑臧否（许劭·汉弓 h770·指挥 A）：距离 5，官方目标「敌友单体」。
   * 每回合自身行动时随机选取攻击、防御、谋略三种属性之一：使该属性最低的敌军单体对应属性降低 20.0
   * （受谋略属性影响），并有 60.0% 几率获得犹豫、怯战、围困中的 1 种效果，持续 1 回合；
   * 使该属性最高的友军单体对应属性提升 20.0（受谋略属性影响），并有 60.0% 几率获得先手、洞察、
   * 无视规避中的 1 种效果，持续 1 回合。
   * 官方：scripts/skill_extra.json id 200242（指挥 A / 距离 5 / 敌友单体 / 兵种弓；1 级 属性 10 / 30%）。
   * 入档判断：**下架** —— 属性 ±20「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套：
   *   ① 随机属性选取复用 `random_pick`（3 组各 1 注，逐组结算）；
   *   ② `inflict_status.targetPick` 扩展 `'highest_{attack|defense|strategy}_ally'` /
   *      `'lowest_{attack|defense|strategy}_enemy'`（按生效属性取最高 / 最低单体，敌侧**无视距离**）；
   *   ③ 两处 60% 走输出级 `chance`（逐段士气修正判定），控制/先手/洞察/无视规避均为既有状态。
   */
  juyizangfou: {
    id: 'juyizangfou',
    name: '举抑臧否',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 5,
    triggerRate: 1,
    targetMode: 'self', // 目标由各段 targetPick 指定（敌军最低 / 友军最高）
    // 注：官方效果列还有「先手(预备)」「无视规避」，EffectTag 无对应项故不进 tags（效果本身已建模）
    tags: ['debuff_attack', 'debuff_defense', 'debuff_strategy', 'buff_attack', 'buff_defense', 'buff_strategy', 'hesitation', 'cowardice', 'siege', 'insight'],
    output: [
      {
        kind: 'random_pick',
        count: 1,
        options: [juyizangfouOption('attack'), juyizangfouOption('defense'), juyizangfouOption('strategy')],
      },
    ],
  },
  /**
   * 辞后定朝（阴丽华·汉弓 h742·指挥 A）：距离 3，我军全体。
   * 战斗前 3 回合，自身行动时有 90.0% 几率移除自身受到的由指挥、主动、追击战法带来的有害和有益效果；
   * 第 4 回合开始，使友军全体中男性武将攻击和防御属性提升 40.0（受谋略属性影响），
   * 女性武将谋略和防御属性提升 40.0（受谋略属性影响）。
   * 官方：scripts/skill_extra.json id 201007（指挥 A / 距离 3 / 我军全体 / 兵种弓步；1 级 45% / 属性 20）。
   * 入档判断：**下架** —— 属性 +40「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 +
   *   登记 OFFLINE_MAIN_SKILLS，待反解确认后移出。
   * 引擎配套：
   *   ① `CommandSkill.onActSegments`（行动时分段：窗口 + 独立几率 + once）承载「前 3 回合」与「第 4 回合起」两段；
   *   ② 新输出段 `remove_by_source_skill_type`（移除指定来源战法类型施加的状态，有害+有益都移除）；
   *   ③ 新过滤 `inflict_status.requireGender`（男性 / 女性分支）；
   *   ④ 性别数据：`General.gender` ← `web/data/hero_meta.json`（`scripts/sync_hero_meta.mjs` 按官方 sex 补全 161 条）。
   * 口径：②「第 4 回合开始」= 整场一次的光环（`once: true`）——逐回合重复会把同源属性 buff 累加，与官方「提升 40」不符。
   */
  cihou_dingchao: {
    id: 'cihou_dingchao',
    name: '辞后定朝',
    type: 'command',
    phase: 'round',
    roundTrigger: 'on_act',
    range: 3,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['immunity', 'buff_attack', 'buff_defense', 'buff_strategy'],
    output: [],
    onActSegments: [
      // ① 前 3 回合自身行动时 90%：移除自身受到的（指挥 / 主动 / 追击来源）有害与有益效果
      {
        startRound: 1,
        endRound: 3,
        rate: 0.9,
        output: [
          {
            kind: 'remove_by_source_skill_type',
            target: 'self',
            skillTypes: ['command', 'active', 'pursuit'],
          },
        ],
      },
      // ② 第 4 回合开始（整场一次）：男性 攻击/防御 +40；女性 谋略/防御 +40（受谋略，成长率未确认 → 0）
      {
        startRound: 4,
        once: true,
        output: [
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            targetMode: 'all',
            requireGender: 'male',
            status: { type: 'attack_buff', amount: 40, duration: 999, strategyScaled: true, growthRate: 0 },
          },
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            targetMode: 'all',
            requireGender: 'male',
            status: { type: 'defense_buff', amount: 40, duration: 999, strategyScaled: true, growthRate: 0 },
          },
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            targetMode: 'all',
            requireGender: 'female',
            status: { type: 'strategy_buff', amount: 40, duration: 999, strategyScaled: true, growthRate: 0 },
          },
          {
            kind: 'inflict_status',
            targetSide: 'ally',
            targetMode: 'all',
            requireGender: 'female',
            status: { type: 'defense_buff', amount: 40, duration: 999, strategyScaled: true, growthRate: 0 },
          },
        ],
      },
    ],
  },
};
