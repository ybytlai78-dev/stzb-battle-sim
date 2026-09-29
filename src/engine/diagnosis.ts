/**
 * 战斗诊断（只读）：把「贡献排名」升级为「因果归因」。
 *
 * 设计约束（用户 2026-09-29 口径，勿破坏）：
 *  1. 数据来源 = 引擎既有事件流（`BattleReport.events`）——**不新增埋点、不改战斗逻辑、不重跑引擎**；
 *  2. 只做读取与聚合：本模块不被 `combat.ts` / `action.ts` 引用，线上战斗零开销（测试有守卫）；
 *  3. 输入支持单场或一批战报；批量模式自动分组（同阵容找共性问题 / 跨阵容找差异因子）；
 *  4. 所有反推量都标注口径：结构化实证（事件带 `modifiers`）记 `confirmed`，估算记 `estimated`。
 *
 * 核心思路（把「谁打了多少」变成「为什么是这个数」）：
 *  - 引擎在每条伤害事件上带 `modifiers`（caused/taken/reduce 三个方向 + 数值），
 *    且结算口径是单一总和模型 `m = clamp(1 + Σcaused + Σtaken − Σreduce, 0.1)`。
 *    于是可由事件**反解**出「无任何增减伤/克制时的基线伤害」：
 *        baseline = (base + main) / m
 *    每条来源的绝对贡献 = baseline × rate（正 = 提高伤害，负 = 降低伤害）。
 *    账本闭合：Σ贡献 = 实际 − 基线（触底/截断时按比例缩放，并标 `clamped` / `capped`）。
 *  - 覆盖率 / 被控回合：回放状态区间（`status_inflicted` → `status_expired`），
 *    在「该单位本回合行动开始」这一采样点判断是否生效，分母 = 该侧有行动窗口的单位回合数。
 *  - 主战法空转：释放次数 / 判定次数与失败数 / 被跳过 / 被控跳过 / 空放 / 有效生效回合 / 空转率。
 *  - 技能顺序缺口：同一行动窗口内，某条伤害之后才施加的增减伤 → 该伤害必然吃不到；
 *    来源用引擎自己的结构化归因（同窗口后续伤害事件的 `modifiers`）反查，避免猜测战法名。
 */
import type { BattleEvent, BattleReport, General, Side, StatusType } from './types';
import { computeContributionShares, computeDetailedStats } from './stats';
import { troopCounterReduceOf } from './secondaryTroop';
import { SKILL_REGISTRY } from '../data/skills';

export const DIAGNOSIS_VERSION = '1.0.0';

// ─── 阈值（全部可覆盖，并会写进输出，保证结论可审计）───

export interface DiagnosisThresholds {
  /** 主战法空转率 ≥ 该值（%）判为病灶 */
  mainSkillIdleRatePct: number;
  /** 主战法空转回合数 ≥ 该值判为病灶（与空转率取或） */
  mainSkillIdleRounds: number;
  /** 技能顺序缺口 ≥ 该次数判为病灶 */
  orderGapCount: number;
  /** 被克制损失占我方总伤害 ≥ 该值（%）判为病灶 */
  counterLossSharePct: number;
  /** 我方被控占比 ≥ 该值（%）判为病灶 */
  controlTakenPct: number;
  /** 我方施加控制覆盖率 ≤ 该值（%）且我方带控制类战法 → 判为控制覆盖率太低 */
  controlDealtLowPct: number;
  /** 增伤账本收益占总伤害 ≤ 该值（%）且我方带增伤类战法 → 判为增伤没吃到 */
  boostGainLowSharePct: number;
  /** 我方伤害低于敌方 ≥ 该值（%）判为伤害缺口 */
  damageGapPct: number;
  /** 批量：某病灶在组内 ≥ 该比例的战报出现 → 共性问题 */
  batchCommonSharePct: number;
  /** 批量：组内场次 ≥ 该值才做共性问题统计 */
  batchMinReports: number;
}

export const DIAGNOSIS_THRESHOLDS: DiagnosisThresholds = {
  mainSkillIdleRatePct: 50,
  mainSkillIdleRounds: 2,
  orderGapCount: 1,
  counterLossSharePct: 10,
  controlTakenPct: 30,
  controlDealtLowPct: 15,
  boostGainLowSharePct: 3,
  damageGapPct: 15,
  batchCommonSharePct: 60,
  batchMinReports: 3,
};

// ─── 状态元数据（覆盖率输出的可读性）───

export type EffectKind = '增益' | '减益' | '中性';

export const STATUS_META: Record<StatusType, { name: string; kind: EffectKind }> = {
  confusion: { name: '混乱', kind: '减益' },
  rampage: { name: '暴走', kind: '减益' },
  cowardice: { name: '怯战', kind: '减益' },
  hesitation: { name: '犹豫', kind: '减益' },
  evasion: { name: '规避（层数）', kind: '增益' },
  evade_chance: { name: '概率规避', kind: '增益' },
  combo: { name: '连击', kind: '增益' },
  attack_buff: { name: '攻击属性', kind: '增益' },
  defense_buff: { name: '防御属性', kind: '增益' },
  strategy_buff: { name: '谋略属性', kind: '增益' },
  speed_buff: { name: '速度属性', kind: '增益' },
  damage_reduce: { name: '受到伤害降低', kind: '增益' },
  damage_boost: { name: '伤害增减', kind: '中性' },
  avoid_charge: { name: '避锐（层数减伤）', kind: '增益' },
  strategy_flux: { name: '策略伤害浮动', kind: '中性' },
  damage_share: { name: '伤害分摊', kind: '增益' },
  heal_boost: { name: '受到恢复提高', kind: '增益' },
  trigger_boost: { name: '发动率提高', kind: '增益' },
  insight: { name: '洞察', kind: '增益' },
  control_extend: { name: '控制时长增加', kind: '增益' },
  control_immune: { name: '控制免疫', kind: '增益' },
  no_retaliate: { name: '不触发反击', kind: '增益' },
  hurt_stack: { name: '受击叠层', kind: '中性' },
  hurt_evade_once: { name: '受击后规避', kind: '增益' },
  treasure_basic_count: { name: '普攻计数（宝物）', kind: '中性' },
  treasure_basic_next: { name: '下次普攻强化', kind: '增益' },
  treasure_basic_purge: { name: '普攻清除（宝物）', kind: '中性' },
  heal_out_boost: { name: '造成恢复提高', kind: '增益' },
  heal_trigger_reduce: { name: '恢复触发减伤', kind: '增益' },
  treasure_after_main: { name: '主战法后增伤', kind: '增益' },
  treasure_ally_active_heal: { name: '友军主动后恢复', kind: '增益' },
  treasure_control_amplify: { name: '受控期间增伤', kind: '增益' },
  dot_tick_heal: { name: 'DoT 跳伤后恢复', kind: '增益' },
  treasure_prepare_skip: { name: '跳过准备', kind: '增益' },
  no_attack: { name: '无法普攻', kind: '减益' },
  heal_low_troops: { name: '低兵力恢复', kind: '增益' },
  treasure_extra_pursuit_target: { name: '追击额外目标', kind: '增益' },
  treasure_basic_sweep: { name: '普攻横扫', kind: '增益' },
  cowardice_immune: { name: '免疫怯战', kind: '增益' },
  siege: { name: '围困', kind: '减益' },
  sorcery: { name: '妖术', kind: '减益' },
  burning: { name: '燃烧', kind: '减益' },
  panic: { name: '恐慌', kind: '减益' },
  curse: { name: '妖术诅咒', kind: '减益' },
  ignite: { name: '引燃', kind: '减益' },
  split: { name: '分兵', kind: '增益' },
  jump_prep: { name: '跳过准备（状态）', kind: '增益' },
  taunt: { name: '挑衅', kind: '减益' },
  counter: { name: '反击', kind: '增益' },
  cover: { name: '援护', kind: '增益' },
  first_aid: { name: '持续型急救', kind: '增益' },
  rest: { name: '休整', kind: '增益' },
  morale_boost: { name: '士气', kind: '中性' },
  ignore_def: { name: '无视防御', kind: '增益' },
  range_buff: { name: '攻击距离', kind: '中性' },
  skill_range_buff: { name: '战法距离', kind: '中性' },
  priority: { name: '先手', kind: '增益' },
  retaliate: { name: '受击追加攻击', kind: '增益' },
  pending_stacks: { name: '叠层待发', kind: '增益' },
  ignore_evasion: { name: '无视规避', kind: '增益' },
  control_spread: { name: '控制扩散', kind: '增益' },
};

/** 控制类状态（与 `stats.ts` 的 CONTROL_STATUS 同口径） */
export const CONTROL_STATUS_TYPES: readonly StatusType[] = ['confusion', 'rampage', 'cowardice', 'hesitation', 'taunt'];
const CONTROL_SET = new Set<StatusType>(CONTROL_STATUS_TYPES);
/** 阻断「主动战法判定」的控制 */
const BLOCK_ACTIVE_SET = new Set<StatusType>(['confusion', 'hesitation']);
/** 阻断「普通攻击（含追击）」的控制 */
const BLOCK_ATTACK_SET = new Set<StatusType>(['confusion', 'cowardice']);

/** 会直接改变伤害数值、可作为「顺序缺口」判定的增减伤状态 */
const ORDER_BUFF_TYPES = new Set<StatusType>(['damage_boost']);

// ─── 输出类型 ───

export type Confidence = 'confirmed' | 'estimated';

export interface UnitDamageShare {
  unitId: string;
  name: string;
  position: string;
  /** 总伤害（口径同 computeContributionShares：damage/split 取 creditToId ?? sourceId，dot 取 casterId） */
  damage: number;
  attackDamage: number;
  skillDamage: number;
  dotDamage: number;
  splitDamage: number;
  damagePct: number;
  heal: number;
  healPct: number;
  control: number;
  controlPct: number;
}

/** 账本条目里按「施加者 / 受击方」拆分的明细 */
export interface LedgerUnitShare {
  unitId: string;
  name: string;
  amount: number;
  hits: number;
}

export interface LedgerEntry {
  /** 唯一定位键：direction:skillId（同一战法跨多个单位时合并，单位明细见 byUnit） */
  key: string;
  skillId: string;
  skillName: string;
  direction: 'caused' | 'taken' | 'reduce';
  /** 累计绝对贡献（正 = 提高伤害，负 = 降低伤害） */
  amount: number;
  /** 参与结算的伤害条数 */
  hits: number;
  /** 平均数值（rate） */
  avgRate: number;
  /** 克制来源（skillId === 'troop_counter'） */
  isCounter: boolean;
  /** 按施加者（造成侧 = 施法者；受到侧 / 减伤 = 受击方）拆分 */
  byUnit: LedgerUnitShare[];
}

export interface DamageLedger {
  /** 实际打出的伤害（事件 damage 求和，含截断） */
  actual: number;
  /** 反解基线：无增减伤/无克制时的应有伤害（可作用分量 = base + main 的还原值） */
  baseline: number;
  /** 无归因路径的伤害（一类指挥预存 delayedOutput 等：不吃增减伤，无法反解） */
  unattributed: number;
  /** 兵力基础分量（不参与增减伤，单列以便核对） */
  troopBase: number;
  /** 被 applyTroopCap / 取整截断掉的伤害（未进入账本的部分） */
  cappedLoss: number;
  /** 触底事件数（增减伤净额 ≤ −90%，实际按 10% 结算） */
  clampedHits: number;
  /** 带动增减伤归因的伤害条数 */
  attributedHits: number;
  /** 账本条目（按 |amount| 降序） */
  entries: LedgerEntry[];
  /** 分类小计 */
  byKind: { boost: number; reduce: number; counter: number; trait: number };
  /** 自检：Σentries.amount 与 (实际可作用分量 − 基线) 的差额（应为 0，除浮点误差） */
  closedCheck: number;
}

export interface EffectCoverage {
  statusType: StatusType;
  name: string;
  kind: EffectKind;
  /** 施加次数（status_inflicted 条数） */
  appliedCount: number;
  /** 覆盖到的单位数 / 该侧参战单位数 */
  coveredUnits: number;
  totalUnits: number;
  unitIds: string[];
  /** 覆盖单位回合（该单位本回合行动开始时刻效果生效中） */
  coveredUnitRounds: number;
  /** 分母：该侧有行动窗口的单位回合数 */
  eligibleUnitRounds: number;
  coveragePct: number;
  /** 平均持续回合（状态区间跨越的回合数，估算） */
  avgDurationRounds: number;
  firstRound: number;
  lastRound: number;
  /** 推定来源战法（近邻释放事件反查；可能为空） */
  sources: { skillId: string; skillName: string; count: number }[];
}

export interface EffectSourceCoverage {
  skillId: string;
  skillName: string;
  /** 该来源推出的状态类型 */
  statusTypes: StatusType[];
  name: string;
  kind: EffectKind;
  appliedCount: number;
  coveredUnitRounds: number;
  coveragePct: number;
}

export interface ControlUnitRow {
  unitId: string;
  name: string;
  position: string;
  /** 被控的回合数（行动开始时刻处于控制状态） */
  controlledRounds: number;
  /** 有行动窗口的回合数 */
  actedRounds: number;
  controlledPct: number;
  byType: Partial<Record<StatusType, number>>;
  /** 因控制而失去的主动战法判定机会（含主战法） */
  skippedActiveAttempts: number;
  /** 因混乱整段无法行动（no_attack_target 实证）次数 */
  blockedWholeAction: number;
}

export interface ControlReport {
  taken: ControlUnitRow[];
  /** 该侧全体被控回合数 / 行动回合数 */
  takenRounds: number;
  actedRounds: number;
  takenPct: number;
  /** 该侧施加给对面：对面行动回合中被本方控制覆盖的回合数 */
  dealtRounds: number;
  enemyActedRounds: number;
  dealtPct: number;
  /** 无法推定施加者的控制覆盖（未计入 dealtRounds） */
  unattributedDealtRounds: number;
  /** 交叉验证的事件证据（计数） */
  evidence: { reason: string; count: number }[];
}

export interface CounterPairRow {
  attackerUnitId: string;
  attackerName: string;
  attackerTroop: string;
  targetUnitId: string;
  targetName: string;
  targetTroop: string;
  /** 引擎口径的克制减伤率：>0 = 攻击方被克；<0 = 攻击方获反克增伤 */
  expectedReduce: number;
  hits: number;
  damage: number;
  /** 其中实际带「兵种克制」归因的条数 / 伤害 */
  confirmedHits: number;
  confirmedDamage: number;
  /** 克制造成的绝对影响（正 = 少打，负 = 多打） */
  impact: number;
  clampedHits: number;
}

export interface CounterReport {
  pairs: CounterPairRow[];
  /** 本侧作为攻击方「被克制」的条数与损失（正数） */
  counteredHits: number;
  counteredLoss: number;
  /** 本侧作为攻击方「反克增伤」的条数与收益（正数） */
  favoredHits: number;
  favoredGain: number;
  /** 一致性核验：应交条数 vs 实交条数 */
  expectedHits: number;
  confirmedHits: number;
  compliancePct: number;
  exceptions: { reason: string; count: number }[];
}

export interface MainSkillEvidence {
  round: number;
  kind: 'trigger_failed' | 'controlled_skip' | 'preparing' | 'cast_no_effect' | 'skipped';
  detail: string;
}

export interface MainSkillReport {
  unitId: string;
  name: string;
  position: string;
  skillId: string;
  skillName: string;
  skillType: string;
  /** 战斗开始一次性生效（一类指挥 prep / battle_start 被动）：不参与「每回合空转」口径 */
  oneTime: boolean;
  /** 释放次数的口径：skill_cast = 有释放事件；effect_rounds = 无释放事件（被动/指挥），按生效回合计 */
  castSemantics: 'skill_cast' | 'effect_rounds';
  /** 该将本场有行动窗口的回合数 */
  actedRounds: number;
  casts: number;
  /** 发动率判定次数 / 失败次数 */
  triggers: number;
  triggerFailures: number;
  /** 实际发动率（释放 ÷ 判定，%） */
  castRatePct: number;
  prepareStarts: number;
  /** 准备被跳过（宝物/状态 jump_prep） */
  prepareSkips: number;
  /** 准备失败/中断（prepare_end success=false） */
  prepareFailed: number;
  /** 被控跳过（不计入空转，单独归因到「控制」） */
  controlledSkips: number;
  /** 准备中（不计入空转） */
  preparingRounds: number;
  /** 释放了但零效果（空放） */
  noEffectCasts: number;
  /** 有效生效回合（该回合产生了伤害/恢复/状态） */
  effectiveRounds: number;
  /** 空转回合 = 行动回合 − 有效 − 被控 − 准备中（下限 0） */
  idleRounds: number;
  idleRatePct: number;
  /** 该战法产出 */
  damage: number;
  heal: number;
  statusApplied: number;
  /** 每有效回合平均伤害（空转损失的估算单价） */
  avgDamagePerEffectiveRound: number;
  evidence: MainSkillEvidence[];
}

export interface OrderGap {
  scope: 'self' | 'sameWindow';
  /** 谁打出的伤害吃不到 */
  unitId: string;
  unitName: string;
  /** 被打出的伤害来源（战法名 / 普通攻击） */
  skillId: string;
  skillName: string;
  /** 后施加、本可吃到却没吃到的增伤来源（推定） */
  buffSkillId: string;
  buffSkillName: string;
  buffStatusType: StatusType;
  direction: 'caused' | 'taken';
  /** 解析到的数值（未解析到 = undefined） */
  rate?: number;
  round: number;
  /** 该次伤害事件序号（可作为人工核对锚点） */
  eventIndex: number;
  damage: number;
  /** 可受益分量（base + main，已按截断缩放） */
  usable: number;
  /** 估算少打伤害（rate 未知时 undefined） */
  estimatedMissed?: number;
  confidence: Confidence;
}

export interface DamageRecordLight {
  eventIndex: number;
  round: number;
  kind: 'attack' | 'skill' | 'split' | 'dot';
  ownerId: string;
  targetId: string;
  skillId: string;
  skillName: string;
  damage: number;
  /** 该次伤害的净增减伤（%，正 = 提高） */
  netPct: number;
  clamped: boolean;
}

export interface SideDiagnosis {
  side: Side;
  label: string;
  totalDamage: number;
  damageBySource: UnitDamageShare[];
  ledger: DamageLedger;
  effects: EffectCoverage[];
  effectBySource: EffectSourceCoverage[];
  control: ControlReport;
  counters: CounterReport;
  mainSkills: MainSkillReport[];
  orderGaps: OrderGap[];
  /** 该侧全部伤害事件（供明细/核对） */
  damages: DamageRecordLight[];
}

export type CauseKind = 'counter' | 'control' | 'main_skill_idle' | 'skill_order' | 'none';

export interface CauseFinding {
  kind: CauseKind;
  label: string;
  /** 对「我方伤害缺口」的估算影响（正 = 拉低我方输出的量级） */
  impact: number;
  evidenceCount: number;
  confidence: Confidence;
  detail: string;
}

export interface Issue {
  kind: string;
  severity: 'high' | 'medium' | 'low';
  label: string;
  detail: string;
  evidence: string[];
  metrics: Record<string, number>;
}

export interface Verdict {
  myDamage: number;
  enemyDamage: number;
  /** 我方 − 敌方（负 = 我方伤害落后） */
  gap: number;
  gapPct: number;
  primary: CauseKind;
  findings: CauseFinding[];
  summary: string;
}

export interface BattleDiagnosis {
  version: string;
  label: string;
  seed: number;
  result: 'win' | 'loss' | 'draw';
  rounds: number;
  maxRounds: number;
  eventCount: number;
  /** 我方 / 敌方 */
  my: SideDiagnosis;
  enemy: SideDiagnosis;
  verdict: Verdict;
  issues: Issue[];
  thresholds: DiagnosisThresholds;
  /** 口径自检与提示（数据缺口 / 推定比例） */
  notes: string[];
}

export interface DiagnosisOptions {
  label?: string;
  thresholds?: Partial<DiagnosisThresholds>;
}

export interface BatchEntry {
  report: BattleReport;
  label?: string;
}

export interface GroupMetrics {
  damagePerRound: number;
  enemyDamagePerRound: number;
  counterLossPerReport: number;
  counterLossSharePct: number;
  orderGapCountPerReport: number;
  orderGapLossPerReport: number;
  mainSkillIdleRatePct: number;
  mainSkillIdleRoundsPerReport: number;
  controlTakenPct: number;
  controlDealtPct: number;
  boostGainPerReport: number;
  reduceLossPerReport: number;
}

export interface BatchGroup {
  fingerprint: string;
  label: string;
  team: string;
  reports: number;
  wins: number;
  winRatePct: number;
  avgDamage: number;
  avgEnemyDamage: number;
  metrics: GroupMetrics;
}

export interface CommonIssue {
  kind: string;
  label: string;
  reports: number;
  total: number;
  sharePct: number;
  detail: string;
  metrics: Record<string, number>;
}

export interface FactorDelta {
  metric: string;
  label: string;
  best: number;
  worst: number;
  delta: number;
  deltaPct: number;
  note: string;
  /** 该因子更有数值优势的一侧：best = 高分组占优 / worst = 低分组反而占优 / same = 相同 / neutral = 中性指标 */
  favors: 'best' | 'worst' | 'same' | 'neutral';
}

export interface BatchDiagnosis {
  version: string;
  total: number;
  groups: BatchGroup[];
  /** 同阵容共性问题（组内 ≥ batchMinReports 场才统计） */
  common: { group: BatchGroup; issues: CommonIssue[]; notes: string[] }[];
  /** 跨阵容差异因子（最高 vs 最低伤害组） */
  comparison: { best: BatchGroup; worst: BatchGroup; factors: FactorDelta[]; summary: string } | null;
  summary: string;
}

// ─── 事件回放（时间线）───

interface UnitInfo {
  id: string;
  name: string;
  side: Side;
  position: string;
  general: General;
}

interface ActWindow {
  unitId: string;
  side: Side;
  round: number;
  /** 窗口内容起点（含「行动开始前」由该单位打出的被动伤害：引擎的 unit_act_start 是惰性发出的） */
  startIdx: number;
  /** 行动起点（本行动内首个 unit_act_start / no_attack_target）：覆盖率与控制的采样点 */
  actStartIdx: number;
  endIdx: number;
}

interface StatusInstance {
  unitId: string;
  side: Side;
  statusType: StatusType;
  startIdx: number;
  endIdx: number | null;
  startRound: number;
  endRound: number | null;
  detail: string;
  /** 从 detail 解析到的百分数（小数，如 0.5） */
  rate?: number;
  /** 语义化方向（damage_boost 用） */
  direction?: 'caused' | 'taken';
  sourceUnitId?: string;
  sourceSkillId?: string;
  sourceSkillName?: string;
  /** 来源是否由「本窗口首个同参数归因」反查得到（推定） */
  attributed: boolean;
}

interface DamageRec {
  eventIndex: number;
  round: number;
  kind: 'attack' | 'skill' | 'split' | 'dot';
  ownerId: string;
  sourceId: string;
  targetId: string;
  skillId: string;
  skillName: string;
  damage: number;
  breakdown: { troopBase: number; base: number; main: number };
  modifiers?: { caused: ModEntry[]; taken: ModEntry[]; reduce: ModEntry[] };
}
interface ModEntry { skillId: string; skillName: string; rate: number; unitId: string }

interface CastRec { idx: number; unitId: string; skillId: string; skillName: string; round: number }
interface TrigRec { idx: number; unitId: string; skillId: string; success: boolean; rate?: number; round: number }
interface PrepRec { idx: number; unitId: string; skillId: string; skillName: string; round: number }
interface NoAttackRec { idx: number; unitId: string; reason: string; round: number }

interface Timeline {
  /** 原始事件流（只读引用，便于按事件取证） */
  events: BattleEvent[];
  /** 事件下标 → 回合号（准备阶段 = 0） */
  roundAt: number[];
  units: UnitInfo[];
  byId: Map<string, UnitInfo>;
  windows: ActWindow[];
  windowsByUnit: Map<string, ActWindow[]>;
  statuses: StatusInstance[];
  casts: CastRec[];
  triggers: TrigRec[];
  prepStarts: PrepRec[];
  prepSkips: PrepRec[];
  prepFailed: PrepRec[];
  noAttacks: NoAttackRec[];
  damages: DamageRec[];
  rounds: number;
  statusAttributed: number;
  statusUnattributed: number;
}

/** 取伤害事件的可作用分量（base + main）与截断系数 */
function usableOf(rec: { damage: number; breakdown: { troopBase: number; base: number; main: number } }): {
  usable: number;
  scale: number;
  rawTotal: number;
} {
  const b = rec.breakdown;
  const total = b.troopBase + b.base + b.main;
  const scale = total > 0 ? Math.min(1, rec.damage / total) : 1;
  return { usable: (b.base + b.main) * scale, scale, rawTotal: total };
}

/** 从 detail 解析百分数（八舍九入文案里的整数百分比）→ 小数 */
function parseRate(detail: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(detail);
  if (!m) return undefined;
  return Number(m[1]) / 100;
}

/** damage_boost 的方向语义（引擎 detail：「造成的伤害提高 50%」/「受到的伤害提高 20%」） */
function parseDirection(detail: string): 'caused' | 'taken' | undefined {
  if (detail.includes('造成的')) return 'caused';
  if (detail.includes('受到的')) return 'taken';
  return undefined;
}

/** 属性类状态按 detail 修正增益/减益方向（负值 = 降低） */
function resolveKind(statusType: StatusType, detail: string): EffectKind {
  const base = STATUS_META[statusType].kind;
  if (statusType === 'damage_boost') {
    const dir = parseDirection(detail);
    const rate = parseRate(detail);
    if (dir === 'caused') return '增益';
    if (dir === 'taken') return '减益';
    return rate !== undefined && detail.includes('降低') ? '减益' : '增益';
  }
  if (!['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff', 'morale_boost', 'range_buff', 'skill_range_buff'].includes(statusType)) {
    return base;
  }
  if (detail.includes('下降') || detail.includes('降低') || detail.includes('减少')) return '减益';
  if (detail.includes('提高') || detail.includes('提升')) return '增益';
  return base;
}

/** 技能是否自带「无视兵种相克」（辕门射戟等）——读只读战法表 */
function ignoresTroopCounter(skillId: string): boolean {
  const def = SKILL_REGISTRY[skillId] as { output?: { ignoresTroopCounter?: boolean }[] } | undefined;
  return !!def?.output?.some((o) => o.ignoresTroopCounter === true);
}

function skillNameOf(skillId: string): string {
  return (SKILL_REGISTRY[skillId] as { name?: string } | undefined)?.name ?? skillId;
}

function skillTypeOf(general: General, skillId: string): string {
  if (general.activeSkillIds.includes(skillId)) return 'active';
  if (general.pursuitSkillIds.includes(skillId)) return 'pursuit';
  if (general.commandSkillIds.includes(skillId)) return 'command';
  if (general.passiveSkillIds.includes(skillId)) return 'passive';
  return (SKILL_REGISTRY[skillId] as { type?: string } | undefined)?.type ?? 'unknown';
}

/** 单趟回放事件流：行动窗口 / 状态区间 / 释放与判定 / 伤害记录 */
function buildTimeline(report: BattleReport): Timeline {
  const units: UnitInfo[] = [
    ...report.myTeam.map((g) => ({ id: g.id, name: g.name, side: 'my' as Side, position: g.position, general: g })),
    ...report.enemyTeam.map((g) => ({ id: g.id, name: g.name, side: 'enemy' as Side, position: g.position, general: g })),
  ];
  const byId = new Map(units.map((u) => [u.id, u]));
  const sideOf = (id: string): Side => byId.get(id)?.side ?? 'my';

  const events = report.events;
  const windows: ActWindow[] = [];
  const statuses: StatusInstance[] = [];
  const openStatuses: StatusInstance[] = [];
  const casts: CastRec[] = [];
  const triggers: TrigRec[] = [];
  const prepStarts: PrepRec[] = [];
  const prepSkips: PrepRec[] = [];
  const prepFailed: PrepRec[] = [];
  const noAttacks: NoAttackRec[] = [];
  const damages: DamageRec[] = [];
  const roundAt: number[] = new Array(events.length).fill(0);
  let statusAttributed = 0;
  let statusUnattributed = 0;

  let round = 0;
  /** 上一个 unit_act_end 的下标（行动窗口的内容从它之后开始） */
  let prevEnd = -1;
  /** 当前回合 round_start 的下标（避免把上一回合的回合末事件算进本窗口） */
  let roundStartIdx = -1;
  /** 本行动内首个 unit_act_start / no_attack_target：引擎的 unit_act_start 是惰性发出的，只作采样点 */
  let openerIdx: number | null = null;
  let openUnit: string | null = null;
  /** 近邻释放上下文（状态来源推定；unit_act_end 时清空） */
  let recent: { unitId: string; skillId: string; skillName: string; idx: number } | null = null;

  const closeStatus = (unitId: string, statusType: StatusType, idx: number, roundNow: number): void => {
    // FIFO：同单位同类型多个实例时，先结算最早登记的那个
    const inst = openStatuses.find((s) => s.unitId === unitId && s.statusType === statusType);
    if (inst) {
      inst.endIdx = idx;
      inst.endRound = roundNow;
      openStatuses.splice(openStatuses.indexOf(inst), 1);
    }
  };

  for (let i = 0; i < events.length; i++) {
    const ev: BattleEvent = events[i];
    if (ev.type === 'round_start') {
      round = ev.round;
      roundStartIdx = i;
    }
    roundAt[i] = round;

    // 行动窗口的「行动起点」：本行动内首个 unit_act_start / no_attack_target
    if (ev.type === 'unit_act_start' || ev.type === 'no_attack_target') {
      if (openerIdx === null) {
        openerIdx = i;
        openUnit = ev.unitId;
      } else if (openUnit !== ev.unitId) {
        openerIdx = i;
        openUnit = ev.unitId;
      }
    }

    switch (ev.type) {
      case 'skill_cast': {
        casts.push({ idx: i, unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, round });
        recent = { unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, idx: i };
        break;
      }
      case 'skill_trigger': {
        triggers.push({ idx: i, unitId: ev.unitId, skillId: ev.skillId, success: ev.success, rate: ev.rate, round });
        if (ev.success) recent = { unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, idx: i };
        break;
      }
      case 'prepare_start': {
        prepStarts.push({ idx: i, unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, round });
        recent = { unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, idx: i };
        break;
      }
      case 'prepare_skip': {
        prepSkips.push({ idx: i, unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, round });
        recent = { unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, idx: i };
        break;
      }
      case 'prepare_end': {
        if (!ev.success) prepFailed.push({ idx: i, unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, round });
        recent = { unitId: ev.unitId, skillId: ev.skillId, skillName: ev.skillName, idx: i };
        break;
      }
      case 'no_attack_target': {
        noAttacks.push({ idx: i, unitId: ev.unitId, reason: ev.reason, round });
        break;
      }
      case 'status_inflicted': {
        // 来源推定：同一行动窗口内、或同一回合内的近邻释放/判定事件（被动挂的状态没有释放事件 → 留空）
        const fresh = recent !== null && i - recent.idx <= 8;
        const inSameWindow = recent !== null && openerIdx !== null && recent.idx >= openerIdx;
        const sameRound = recent !== null && roundAt[recent.idx] === round;
        const attributed = fresh && (inSameWindow || sameRound);
        if (attributed) statusAttributed += 1;
        else statusUnattributed += 1;
        const inst: StatusInstance = {
          unitId: ev.unitId,
          side: sideOf(ev.unitId),
          statusType: ev.statusType,
          startIdx: i,
          endIdx: null,
          startRound: round,
          endRound: null,
          detail: ev.detail,
          rate: parseRate(ev.detail),
          direction: parseDirection(ev.detail),
          sourceUnitId: attributed ? recent!.unitId : undefined,
          sourceSkillId: attributed ? recent!.skillId : undefined,
          sourceSkillName: attributed ? recent!.skillName : undefined,
          attributed,
        };
        statuses.push(inst);
        openStatuses.push(inst);
        break;
      }
      case 'status_expired': {
        closeStatus(ev.unitId, ev.statusType, i, round);
        break;
      }
      case 'attack_hit': {
        damages.push({
          eventIndex: i, round, kind: 'attack', ownerId: ev.sourceId, sourceId: ev.sourceId, targetId: ev.targetId,
          skillId: '', skillName: '普通攻击', damage: ev.damage, breakdown: ev.breakdown, modifiers: ev.modifiers,
        });
        break;
      }
      case 'damage': {
        damages.push({
          eventIndex: i, round, kind: 'skill', ownerId: ev.creditToId ?? ev.sourceId, sourceId: ev.sourceId, targetId: ev.targetId,
          skillId: ev.skillId, skillName: ev.skillName, damage: ev.damage, breakdown: ev.breakdown, modifiers: ev.modifiers,
        });
        break;
      }
      case 'split_damage': {
        damages.push({
          eventIndex: i, round, kind: 'split', ownerId: ev.creditToId ?? ev.sourceId, sourceId: ev.sourceId, targetId: ev.targetId,
          skillId: ev.skillId ?? '', skillName: ev.skillId ? skillNameOf(ev.skillId) : '分兵', damage: ev.damage,
          breakdown: ev.breakdown, modifiers: ev.modifiers,
        });
        break;
      }
      case 'dot_tick': {
        damages.push({
          eventIndex: i, round, kind: 'dot', ownerId: ev.casterId, sourceId: ev.sourceId, targetId: ev.targetId,
          skillId: ev.skillId, skillName: skillNameOf(ev.skillId), damage: ev.damage, breakdown: ev.breakdown, modifiers: ev.modifiers,
        });
        break;
      }
      case 'unit_act_end': {
        // 行动窗口 = [内容起点, unit_act_end]：
        //   内容起点 = max(上一窗口结束 + 1, 本回合 round_start)——引擎的 unit_act_start 是惰性发出的
        //   （被动 roundStartRepeat 的伤害早于任何 unit_act_start），只按 opener 切会漏掉行动开头的伤害；
        //   采样点 actStartIdx 仍取本行动首个 opener（覆盖率/控制的「行动开始时是否生效」口径）。
        const startIdx = Math.max(prevEnd + 1, roundStartIdx >= 0 ? roundStartIdx : 0);
        const actStartIdx = openerIdx !== null && openerIdx >= startIdx && openerIdx <= i ? openerIdx : startIdx;
        windows.push({
          unitId: ev.unitId,
          side: sideOf(ev.unitId),
          round: roundAt[startIdx] ?? round,
          startIdx,
          actStartIdx,
          endIdx: i,
        });
        prevEnd = i;
        openerIdx = null;
        openUnit = null;
        recent = null;
        break;
      }
      default:
        break;
    }
  }

  const windowsByUnit = new Map<string, ActWindow[]>();
  for (const w of windows) {
    const list = windowsByUnit.get(w.unitId) ?? [];
    list.push(w);
    windowsByUnit.set(w.unitId, list);
  }

  return {
    events,
    roundAt,
    units, byId, windows, windowsByUnit, statuses, casts, triggers, prepStarts, prepSkips, prepFailed, noAttacks, damages,
    rounds: report.rounds, statusAttributed, statusUnattributed,
  };
}

/** 某状态实例是否在指定行动窗口开始时生效 */
function activeAt(inst: StatusInstance, windowStartIdx: number): boolean {
  return inst.startIdx < windowStartIdx && (inst.endIdx === null || inst.endIdx >= windowStartIdx);
}

// ─── 账本（因果归因核心）───

interface LedgerAcc {
  key: string;
  skillId: string;
  skillName: string;
  direction: 'caused' | 'taken' | 'reduce';
  amount: number;
  rateSum: number;
  hits: number;
  /** 施加者（造成侧 = 施法者；受到侧 / 减伤 = 受击方）明细 */
  byUnit: Map<string, LedgerUnitShare>;
}

/**
 * 反解单条伤害事件的因果账本：基线 + 每条来源的绝对贡献。
 *  - `m = clamp(1 + Σcaused + Σtaken − Σreduce, 0.1)`（引擎单一总和模型，见 formulas.buffMult）
 *  - 触底（m 被 clamp）时按比例缩放各来源贡献，保证 Σ贡献 = 实际 − 基线（标 clamped）
 *  - `applyTroopCap` 截断/取整按比例折算（标 capped）
 */
function ledgerOf(rec: DamageRec): {
  usable: number;
  baseline: number;
  net: number;
  clamped: boolean;
  entries: { skillId: string; skillName: string; sourceUnitId: string; direction: 'caused' | 'taken' | 'reduce'; rate: number; amount: number }[];
} {
  const { usable } = usableOf(rec);
  const mods = rec.modifiers;
  const arr: { skillId: string; skillName: string; sourceUnitId: string; direction: 'caused' | 'taken' | 'reduce'; rate: number }[] = [];
  const push = (m: ModEntry, direction: 'caused' | 'taken' | 'reduce') =>
    arr.push({ skillId: m.skillId, skillName: m.skillName, sourceUnitId: m.unitId, direction, rate: m.rate });
  if (mods) {
    for (const m of mods.caused) push(m, 'caused');
    for (const m of mods.taken) push(m, 'taken');
    for (const m of mods.reduce) push(m, 'reduce');
  }
  const net = arr.reduce((a, x) => a + (x.direction === 'reduce' ? -x.rate : x.rate), 0);
  const m = Math.max(0.1, 1 + net);
  const clamped = 1 + net < 0.1 - 1e-9;
  const baseline = usable / m;
  const actualDelta = usable - baseline;
  const rawDelta = baseline * net;
  const k = Math.abs(rawDelta) > 1e-9 ? actualDelta / rawDelta : 0;
  return {
    usable,
    baseline,
    net,
    clamped,
    entries: arr.map((x) => ({ ...x, amount: baseline * x.rate * (x.direction === 'reduce' ? -1 : 1) * k })),
  };
}

// ─── 单侧分析 ───

function unitNameOf(tl: Timeline, id: string): string {
  return tl.byId.get(id)?.name ?? id;
}

function analyzeSide(tl: Timeline, report: BattleReport, side: Side, label: string): SideDiagnosis {
  const sideUnits = tl.units.filter((u) => u.side === side);
  const sideUnitIds = new Set(sideUnits.map((u) => u.id));
  const windows = tl.windows.filter((w) => w.side === side);
  const eligibleUnitRounds = windows.length;

  // ① 贡献排名（复用引擎既有口径：computeContributionShares / computeDetailedStats）
  const states = unitsAsStates(tl);
  const shares = computeContributionShares(report.events, states);
  const detailed = computeDetailedStats(report.events, states);
  const damageBySource: UnitDamageShare[] = sideUnits.map((u) => {
    const s = shares.find((x) => x.unitId === u.id);
    const d = detailed.find((x) => x.unitId === u.id);
    const myDamages = tl.damages.filter((x) => x.ownerId === u.id);
    const sumOf = (k: DamageRec['kind']) => myDamages.filter((x) => x.kind === k).reduce((a, x) => a + x.damage, 0);
    return {
      unitId: u.id,
      name: u.name,
      position: u.position,
      damage: s?.damage ?? 0,
      attackDamage: d?.attackDamage ?? 0,
      skillDamage: (d?.skills ?? []).reduce((a, x) => a + x.damage, 0),
      dotDamage: sumOf('dot'),
      splitDamage: sumOf('split'),
      damagePct: s?.damagePct ?? 0,
      heal: s?.heal ?? 0,
      healPct: s?.healPct ?? 0,
      control: s?.control ?? 0,
      controlPct: s?.controlPct ?? 0,
    };
  });

  // ② 账本
  const ledgerAcc = new Map<string, LedgerAcc>();
  const ledger: DamageLedger = {
    actual: 0, baseline: 0, unattributed: 0, troopBase: 0, cappedLoss: 0, clampedHits: 0,
    attributedHits: 0, entries: [], byKind: { boost: 0, reduce: 0, counter: 0, trait: 0 }, closedCheck: 0,
  };
  const damageLights: DamageRecordLight[] = [];
  let usableSum = 0;
  for (const rec of tl.damages) {
    if (!sideUnitIds.has(rec.ownerId)) continue;
    const { usable, rawTotal } = usableOf(rec);
    const total = rec.damage;
    ledger.actual += total;
    ledger.troopBase += rec.breakdown.troopBase;
    if (rawTotal > total) ledger.cappedLoss += rawTotal - total;
    // 「无归因路径」= 事件根本没带 modifiers 字段（一类指挥预存 delayedOutput 等，预先结算不吃增减伤）；
    // 带空 modifiers 数组的 = 该次伤害没有任何增减伤/克制（mult = 1），照常进入账本（基线 = 实际）
    const hasModsField = rec.modifiers !== undefined;
    const led = ledgerOf(rec);
    if (!hasModsField) {
      ledger.unattributed += usable;
      ledger.baseline += usable;
    } else {
      ledger.attributedHits += 1;
      ledger.baseline += led.baseline;
      if (led.clamped) ledger.clampedHits += 1;
      usableSum += usable;
      for (const e of led.entries) {
        const key = `${e.direction}:${e.skillId}`;
        let acc = ledgerAcc.get(key);
        if (!acc) {
          acc = {
            key, skillId: e.skillId, skillName: e.skillName, direction: e.direction,
            amount: 0, rateSum: 0, hits: 0, byUnit: new Map(),
          };
          ledgerAcc.set(key, acc);
        }
        acc.amount += e.amount;
        acc.rateSum += e.rate;
        acc.hits += 1;
        // 兵种克制的「归因单位」取**被克的攻击方**（引擎写入的 unitId 是受击方，对诊断没意义）
        const attrUnitId = e.skillId === 'troop_counter' ? rec.ownerId : e.sourceUnitId;
        const u = acc.byUnit.get(attrUnitId) ?? { unitId: attrUnitId, name: unitNameOf(tl, attrUnitId), amount: 0, hits: 0 };
        u.amount += e.amount;
        u.hits += 1;
        acc.byUnit.set(attrUnitId, u);
      }
    }
    damageLights.push({
      eventIndex: rec.eventIndex, round: rec.round, kind: rec.kind, ownerId: rec.ownerId, targetId: rec.targetId,
      skillId: rec.skillId, skillName: rec.skillName, damage: rec.damage,
      netPct: Math.round((Math.max(0.1, 1 + led.net) - 1) * 1000) / 10,
      clamped: led.clamped,
    });
  }
  ledger.entries = [...ledgerAcc.values()]
    .map((a) => ({
      key: a.key, skillId: a.skillId, skillName: a.skillName, direction: a.direction,
      amount: Math.round(a.amount), hits: a.hits, avgRate: a.hits ? a.rateSum / a.hits : 0,
      isCounter: a.skillId === 'troop_counter',
      byUnit: [...a.byUnit.values()]
        .map((u) => ({ ...u, amount: Math.round(u.amount) }))
        .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)),
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  for (const e of ledger.entries) {
    if (e.skillId === 'troop_counter') ledger.byKind.counter += e.amount;
    else if (e.skillId === 'troop_trait') ledger.byKind.trait += e.amount;
    else if (e.amount >= 0) ledger.byKind.boost += e.amount;
    else ledger.byKind.reduce += e.amount;
  }
  // 闭合自检：Σ条目贡献 应等于（有归因的可作用分量 − 有归因的基线）；无归因路径（预存伤害）不进入账本
  {
    const attributedBaseline = ledger.baseline - ledger.unattributed;
    ledger.closedCheck = Math.round((ledger.entries.reduce((a, x) => a + x.amount, 0) - (usableSum - attributedBaseline)) * 100) / 100;
  }

  // ③ 效果覆盖
  const effects = analyzeEffects(tl, side);
  const effectBySource = rollupBySource(effects, tl, side, eligibleUnitRounds);

  // ④ 控制
  const control = analyzeControl(tl, side);

  // ⑤ 克制
  const counters = analyzeCounters(tl, side);

  // ⑥ 主战法 & ⑦ 顺序缺口
  const mainSkills = sideUnits.map((u) => analyzeMainSkill(tl, u)).filter((x): x is MainSkillReport => x !== null);
  const orderGaps = analyzeOrderGaps(tl, side);

  return {
    side, label, totalDamage: ledger.actual, damageBySource, ledger, effects, effectBySource, control, counters,
    mainSkills, orderGaps, damages: damageLights,
  };
}

/** 把两个队的 General 还原成引擎 UnitState 形状（仅供 stats.ts 既有函数读取 basic 字段） */
function unitsAsStates(tl: Timeline) {
  return tl.units.map((u) => ({
    general: u.general,
    side: u.side,
    troops: 0,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  }));
}

function analyzeEffects(tl: Timeline, side: Side): EffectCoverage[] {
  const sideUnits = tl.units.filter((u) => u.side === side);
  const windows = tl.windows.filter((w) => w.side === side);
  const byType = new Map<StatusType, StatusInstance[]>();
  for (const inst of tl.statuses) {
    if (inst.side !== side) continue;
    const list = byType.get(inst.statusType) ?? [];
    list.push(inst);
    byType.set(inst.statusType, list);
  }
  const out: EffectCoverage[] = [];
  for (const [statusType, insts] of byType) {
    const coveredUnitIds = new Set<string>();
    let coveredUnitRounds = 0;
    for (const w of windows) {
      if (insts.some((s) => s.unitId === w.unitId && activeAt(s, w.actStartIdx))) {
        coveredUnitRounds += 1;
        coveredUnitIds.add(w.unitId);
      }
    }
    const durations = insts.map((s) => (s.endRound ?? tl.rounds) - s.startRound + 1);
    const srcMap = new Map<string, { skillId: string; skillName: string; count: number }>();
    for (const s of insts) {
      if (!s.sourceSkillId) continue;
      const key = s.sourceSkillId;
      const cur = srcMap.get(key) ?? { skillId: key, skillName: s.sourceSkillName ?? key, count: 0 };
      cur.count += 1;
      srcMap.set(key, cur);
    }
    const rounds = insts.map((s) => s.startRound);
    out.push({
      statusType,
      name: STATUS_META[statusType].name,
      kind: resolveKind(statusType, insts[0]?.detail ?? ''),
      appliedCount: insts.length,
      coveredUnits: coveredUnitIds.size,
      totalUnits: sideUnits.length,
      unitIds: [...coveredUnitIds],
      coveredUnitRounds,
      eligibleUnitRounds: windows.length,
      coveragePct: windows.length ? Math.round((coveredUnitRounds / windows.length) * 1000) / 10 : 0,
      avgDurationRounds: insts.length ? Math.round((durations.reduce((a, x) => a + x, 0) / insts.length) * 10) / 10 : 0,
      firstRound: rounds.length ? Math.min(...rounds) : 0,
      lastRound: rounds.length ? Math.max(...rounds) : 0,
      sources: [...srcMap.values()].sort((a, b) => b.count - a.count),
    });
  }
  return out.sort((a, b) => b.appliedCount - a.appliedCount);
}

function rollupBySource(
  effects: EffectCoverage[],
  tl: Timeline,
  side: Side,
  eligibleUnitRounds: number
): EffectSourceCoverage[] {
  const windows = tl.windows.filter((w) => w.side === side);
  const map = new Map<string, EffectSourceCoverage>();
  for (const eff of effects) {
    for (const src of eff.sources) {
      const insts = tl.statuses.filter(
        (s) => s.side === side && s.statusType === eff.statusType && s.sourceSkillId === src.skillId
      );
      if (insts.length === 0) continue;
      let covered = 0;
      for (const w of windows) {
        if (insts.some((s) => s.unitId === w.unitId && activeAt(s, w.actStartIdx))) covered += 1;
      }
      const cur = map.get(src.skillId) ?? {
        skillId: src.skillId, skillName: src.skillName, statusTypes: [], name: '', kind: eff.kind,
        appliedCount: 0, coveredUnitRounds: 0, coveragePct: 0,
      };
      cur.appliedCount += src.count;
      cur.coveredUnitRounds += covered;
      if (!cur.statusTypes.includes(eff.statusType)) cur.statusTypes.push(eff.statusType);
      cur.name = cur.statusTypes.map((t) => STATUS_META[t].name).join(' + ');
      map.set(src.skillId, cur);
    }
  }
  return [...map.values()]
    .map((x) => ({ ...x, coveragePct: eligibleUnitRounds ? Math.round((x.coveredUnitRounds / eligibleUnitRounds) * 1000) / 10 : 0 }))
    .sort((a, b) => b.coveredUnitRounds - a.coveredUnitRounds);
}

function analyzeControl(tl: Timeline, side: Side): ControlReport {
  const sideUnits = tl.units.filter((u) => u.side === side);
  const myWindows = tl.windows.filter((w) => w.side === side);
  const enemyWindows = tl.windows.filter((w) => w.side !== side);

  const taken: ControlUnitRow[] = sideUnits.map((u) => {
    const ws = tl.windowsByUnit.get(u.id) ?? [];
    const byType: Partial<Record<StatusType, number>> = {};
    let controlled = 0;
    let skipped = 0;
    for (const w of ws) {
      const hits = tl.statuses.filter((s) => s.unitId === u.id && CONTROL_SET.has(s.statusType) && activeAt(s, w.actStartIdx));
      if (hits.length === 0) continue;
      controlled += 1;
      for (const t of new Set(hits.map((s) => s.statusType))) byType[t] = (byType[t] ?? 0) + 1;
      const blocksActive =
        hits.some((s) => BLOCK_ACTIVE_SET.has(s.statusType)) ||
        (u.general.pursuitSkillIds.length > 0 && hits.some((s) => BLOCK_ATTACK_SET.has(s.statusType)));
      if (blocksActive) skipped += 1;
    }
    const blockedWholeAction = tl.noAttacks.filter((n) => n.unitId === u.id && n.reason.includes('混乱')).length;
    return {
      unitId: u.id, name: u.name, position: u.position, controlledRounds: controlled, actedRounds: ws.length,
      controlledPct: ws.length ? Math.round((controlled / ws.length) * 1000) / 10 : 0,
      byType, skippedActiveAttempts: skipped, blockedWholeAction,
    };
  });

  const actedRounds = myWindows.length;
  const takenRounds = taken.reduce((a, x) => a + x.controlledRounds, 0);
  let dealtRounds = 0;
  let unattributedDealtRounds = 0;
  for (const w of enemyWindows) {
    const hits = tl.statuses.filter((s) => s.unitId === w.unitId && CONTROL_SET.has(s.statusType) && activeAt(s, w.actStartIdx));
    if (hits.length === 0) continue;
    const fromUs = hits.filter((s) => s.sourceUnitId && tl.byId.get(s.sourceUnitId)?.side === side);
    const unknown = hits.filter((s) => !s.sourceUnitId);
    if (fromUs.length > 0) dealtRounds += 1;
    else if (unknown.length > 0) unattributedDealtRounds += 1;
  }

  const evidence: { reason: string; count: number }[] = [];
  const add = (reason: string, n: number) => {
    if (n > 0) evidence.push({ reason, count: n });
  };
  const sideSet = new Set(sideUnits.map((u) => u.id));
  add('混乱：无法行动（no_attack_target）', tl.noAttacks.filter((n) => sideSet.has(n.unitId) && n.reason.includes('混乱')).length);
  add('怯战：无法进行普通攻击', tl.noAttacks.filter((n) => sideSet.has(n.unitId) && n.reason.includes('怯战')).length);
  const evCount = (pred: (ev: BattleEvent) => boolean): number => {
    let n = 0;
    for (const ev of tl.events) if (pred(ev)) n += 1;
    return n;
  };
  add('洞察拦截（insight_blocked）', evCount((ev) => ev.type === 'insight_blocked' && sideSet.has(ev.unitId)));
  add('控制免疫拦截（control_immune_blocked）', evCount((ev) => ev.type === 'control_immune_blocked' && sideSet.has(ev.unitId)));
  add('免疫怯战拦截（cowardice_immune_blocked）', evCount((ev) => ev.type === 'cowardice_immune_blocked' && sideSet.has(ev.unitId)));
  add('抵御负面（status_resisted）', evCount((ev) => ev.type === 'status_resisted' && sideSet.has(ev.unitId)));

  return {
    taken,
    takenRounds,
    actedRounds,
    takenPct: actedRounds ? Math.round((takenRounds / actedRounds) * 1000) / 10 : 0,
    dealtRounds,
    enemyActedRounds: enemyWindows.length,
    dealtPct: enemyWindows.length ? Math.round((dealtRounds / enemyWindows.length) * 1000) / 10 : 0,
    unattributedDealtRounds,
    evidence,
  };
}

function analyzeCounters(tl: Timeline, side: Side): CounterReport {
  const sideUnitIds = new Set(tl.units.filter((u) => u.side === side).map((u) => u.id));
  const pairs = new Map<string, CounterPairRow>();
  const exceptions = new Map<string, number>();
  let expectedHits = 0;
  let confirmedHits = 0;

  for (const rec of tl.damages) {
    if (!sideUnitIds.has(rec.ownerId)) continue;
    const atk = tl.byId.get(rec.ownerId);
    const tgt = tl.byId.get(rec.targetId);
    if (!atk || !tgt) continue;
    const expectedReduce = troopCounterReduceOf({
      attackerTroop: atk.general.troopType,
      attackerSecondary: atk.general.secondaryTroop,
      targetTroop: tgt.general.troopType,
      targetSecondary: tgt.general.secondaryTroop,
    });
    if (expectedReduce === 0) continue;
    const key = `${atk.id}->${tgt.id}`;
    const row = pairs.get(key) ?? {
      attackerUnitId: atk.id, attackerName: atk.name, attackerTroop: troopLabel(atk.general),
      targetUnitId: tgt.id, targetName: tgt.name, targetTroop: troopLabel(tgt.general),
      expectedReduce, hits: 0, damage: 0, confirmedHits: 0, confirmedDamage: 0, impact: 0, clampedHits: 0,
    };
    const counterMod = rec.modifiers?.reduce.find((m) => m.skillId === 'troop_counter');
    const led = ledgerOf(rec);
    const counterEntry = led.entries.find((e) => e.skillId === 'troop_counter');
    row.hits += 1;
    row.damage += rec.damage;
    expectedHits += 1;
    if (led.clamped) row.clampedHits += 1;
    if (counterMod) {
      row.confirmedHits += 1;
      row.confirmedDamage += rec.damage;
      confirmedHits += 1;
    } else if (ignoresTroopCounter(rec.skillId)) {
      exceptions.set('战法自带无视兵种相克', (exceptions.get('战法自带无视兵种相克') ?? 0) + 1);
    } else {
      exceptions.set('未带克制归因（预存/特殊路径，待查）', (exceptions.get('未带克制归因（预存/特殊路径，待查）') ?? 0) + 1);
    }
    row.impact += counterEntry ? -counterEntry.amount : 0;
    pairs.set(key, row);
  }

  const rows = [...pairs.values()].map((r) => ({ ...r, impact: Math.round(r.impact) }));
  const countered = rows.filter((r) => r.expectedReduce > 0);
  const favored = rows.filter((r) => r.expectedReduce < 0);
  return {
    pairs: rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)),
    counteredHits: countered.reduce((a, x) => a + x.hits, 0),
    counteredLoss: countered.reduce((a, x) => a + x.impact, 0),
    favoredHits: favored.reduce((a, x) => a + x.hits, 0),
    favoredGain: -favored.reduce((a, x) => a + x.impact, 0),
    expectedHits,
    confirmedHits,
    compliancePct: expectedHits ? Math.round((confirmedHits / expectedHits) * 1000) / 10 : 0,
    exceptions: [...exceptions.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

function troopLabel(g: General): string {
  return g.secondaryTroop ? `${g.troopType}/${g.secondaryTroop}` : g.troopType;
}

function analyzeMainSkill(tl: Timeline, u: UnitInfo): MainSkillReport | null {
  const skillId = u.general.mainSkillId;
  if (!skillId) return null;
  const def = SKILL_REGISTRY[skillId] as
    | { name?: string; phase?: string; timing?: string; roundStartRepeat?: unknown }
    | undefined;
  const skillType = skillTypeOf(u.general, skillId);
  // 战斗开始只生效一次的战法（一类指挥 / 纯 battle_start 被动）：不适用「每回合空转」口径。
  // ⚠️ 混合型（如霸王渡江：battle_start 挂犹豫 + roundStartRepeat 每回合 40% 三连击）仍按每回合口径。
  const roundHooks = def as Record<string, unknown> | undefined;
  const hasRoundHook = !!roundHooks && ['roundStartRepeat', 'recoverEachRound', 'rangeDecayPerRound', 'lastActStrike', 'afterAct', 'allyActStacks', 'beforeActive'].some((k) => roundHooks[k] != null);
  const oneTime = (skillType === 'command' && def?.phase === 'prep') || (skillType === 'passive' && def?.timing === 'battle_start' && !hasRoundHook);
  const ws = tl.windowsByUnit.get(u.id) ?? [];
  const actedRounds = ws.length;
  const actedRoundSet = new Set(ws.map((w) => w.round));

  const casts = tl.casts.filter((c) => c.unitId === u.id && c.skillId === skillId);
  const triggers = tl.triggers.filter((t) => t.unitId === u.id && t.skillId === skillId);
  const prepStarts = tl.prepStarts.filter((p) => p.unitId === u.id && p.skillId === skillId);
  const prepSkips = tl.prepSkips.filter((p) => p.unitId === u.id && p.skillId === skillId);
  const prepFailed = tl.prepFailed.filter((p) => p.unitId === u.id && p.skillId === skillId);

  // 有效生效回合：该战法产生伤害 / 恢复 / 状态的回合（限制在该将确实行动的回合内，避免 DoT 滞后跳伤虚增）
  const effectRoundsAll = new Set<number>();
  let damage = 0;
  let heal = 0;
  for (const rec of tl.damages) {
    if (rec.skillId !== skillId || rec.ownerId !== u.id) continue;
    damage += rec.damage;
    effectRoundsAll.add(rec.round);
  }
  for (let i = 0; i < tl.events.length; i++) {
    const ev = tl.events[i];
    if (ev.type === 'heal' && ev.skillId === skillId && ev.sourceId === u.id) {
      heal += ev.amount;
      effectRoundsAll.add(tl.roundAt[i]);
    }
  }
  let statusApplied = 0;
  for (const s of tl.statuses) {
    if (s.sourceSkillId === skillId && s.sourceUnitId === u.id) {
      statusApplied += 1;
      effectRoundsAll.add(s.startRound);
    }
  }
  const effectiveRoundSet = oneTime ? effectRoundsAll : new Set([...effectRoundsAll].filter((r) => actedRoundSet.has(r)));

  // 控制 / 准备 分类
  const controlledRounds = new Set<number>();
  const preparingRounds = new Set<number>();
  for (const w of ws) {
    const hits = tl.statuses.filter((s) => s.unitId === u.id && CONTROL_SET.has(s.statusType) && activeAt(s, w.actStartIdx));
    const blocks =
      skillType === 'active'
        ? hits.some((s) => BLOCK_ACTIVE_SET.has(s.statusType))
        : skillType === 'pursuit'
          ? hits.some((s) => BLOCK_ATTACK_SET.has(s.statusType))
          : false;
    if (blocks) controlledRounds.add(w.round);
  }
  for (const p of prepStarts) {
    const castSameRound = casts.some((c) => c.round === p.round);
    const skippedSameRound = prepSkips.some((c) => c.round === p.round);
    if (!castSameRound && !skippedSameRound) preparingRounds.add(p.round);
  }
  for (const s of prepSkips) preparingRounds.add(s.round);

  const effectiveRounds = effectiveRoundSet.size;
  const castRounds = new Set(casts.map((c) => c.round));
  const noEffectCasts = [...castRounds].filter((r) => !effectiveRoundSet.has(r)).length;
  const idleRounds = oneTime ? 0 : Math.max(0, actedRounds - effectiveRounds - controlledRounds.size - preparingRounds.size);
  const castSemantics: 'skill_cast' | 'effect_rounds' = triggers.length > 0 || casts.length > 0 ? 'skill_cast' : 'effect_rounds';
  const castsReported = castSemantics === 'skill_cast' ? casts.length : effectiveRounds;

  const evidence: MainSkillEvidence[] = [];
  if (oneTime) {
    evidence.push({ round: 0, kind: 'preparing', detail: '战斗开始一次性生效（一类指挥 / battle_start 被动），不适用每回合空转口径' });
  }
  for (const t of triggers.filter((x) => !x.success)) {
    evidence.push({ round: t.round, kind: 'trigger_failed', detail: `第 ${t.round} 回合发动判定失败（生效几率 ${t.rate ?? '?'}%）` });
  }
  for (const r of [...controlledRounds].sort((a, b) => a - b)) {
    evidence.push({ round: r, kind: 'controlled_skip', detail: `第 ${r} 回合被控制跳过（主动/普攻被封）` });
  }
  for (const r of [...preparingRounds].sort((a, b) => a - b)) {
    evidence.push({ round: r, kind: 'preparing', detail: `第 ${r} 回合处于准备中（不计空转）` });
  }
  for (const r of [...castRounds].sort((a, b) => a - b)) {
    if (effectiveRoundSet.has(r)) continue;
    const cast = casts.find((c) => c.round === r);
    const w = cast ? tl.windows.find((x) => cast.idx >= x.startIdx && cast.idx <= x.endIdx) : undefined;
    const why = w && cast ? noEffectReason(tl, w, cast.idx) : '本回合无新增效果';
    evidence.push({ round: r, kind: 'cast_no_effect', detail: `第 ${r} 回合释放但${why}` });
  }
  for (const s of prepFailed) evidence.push({ round: s.round, kind: 'skipped', detail: `第 ${s.round} 回合准备失败/中断` });

  return {
    unitId: u.id,
    name: u.name,
    position: u.position,
    skillId,
    skillName: def?.name ?? u.general.mainSkillName ?? skillId,
    skillType,
    oneTime,
    castSemantics,
    actedRounds,
    casts: castsReported,
    triggers: triggers.length,
    triggerFailures: triggers.filter((t) => !t.success).length,
    castRatePct: triggers.length ? Math.round((casts.length / triggers.length) * 1000) / 10 : 0,
    prepareStarts: prepStarts.length,
    prepareSkips: prepSkips.length,
    prepareFailed: prepFailed.length,
    controlledSkips: controlledRounds.size,
    preparingRounds: preparingRounds.size,
    noEffectCasts,
    effectiveRounds,
    idleRounds,
    idleRatePct: oneTime || actedRounds === 0 ? 0 : Math.round((idleRounds / actedRounds) * 1000) / 10,
    damage,
    heal,
    statusApplied,
    avgDamagePerEffectiveRound: effectiveRounds ? Math.round(damage / effectiveRounds) : 0,
    evidence,
  };
}

/**
 * 「释放了但本回合没有该战法的产出」的原因取证：扫同一行动窗口里该次释放之后的事件，
 * 把可识别的拦截/冲突/抵御原因写进证据（识别不到就报「无新增效果」，不猜）。
 */
function noEffectReason(tl: Timeline, w: ActWindow, fromIdx: number): string {
  const reasons = new Set<string>();
  for (let i = fromIdx; i <= w.endIdx; i++) {
    const ev = tl.events[i];
    if (ev.type === 'evasion_blocked') reasons.add('被规避');
    else if (ev.type === 'status_conflict') reasons.add('效果冲突被拒（先施加者生效）');
    else if (ev.type === 'status_resisted') reasons.add('被抵御');
    else if (ev.type === 'siege_blocked') reasons.add('被围困拦截');
    else if (ev.type === 'insight_blocked' || ev.type === 'control_immune_blocked' || ev.type === 'cowardice_immune_blocked' || ev.type === 'command_immune_blocked') reasons.add('被免疫/拦截');
  }
  return reasons.size > 0
    ? `本回合没有该战法的产出（同行动内出现：${[...reasons].join('、')}）`
    : '本回合无新增效果（目标已有效果 / 无有效目标）';
}

/**
 * 技能顺序缺口：同一行动窗口内「先打伤害、后施加增伤」→ 该伤害必然吃不到。
 * 来源反查（避免猜战法名）：优先近邻释放事件；否则用**同窗口后续伤害事件自己的结构化归因**
 * （引擎写入的 modifiers 里同方向同数值的来源）反查。
 */
function analyzeOrderGaps(tl: Timeline, side: Side): OrderGap[] {
  const sideUnitIds = new Set(tl.units.filter((u) => u.side === side).map((u) => u.id));
  const gaps: OrderGap[] = [];

  for (const w of tl.windows.filter((x) => x.side === side)) {
    if (w.endIdx < w.startIdx) continue;

    // 本窗口内施加的增减伤（作用于施法者自身 = caused / 作用于敌方目标 = taken）
    const buffInsts = tl.statuses.filter(
      (s) =>
        s.startIdx >= w.startIdx &&
        s.startIdx <= w.endIdx &&
        ORDER_BUFF_TYPES.has(s.statusType) &&
        s.rate !== undefined &&
        (s.direction === 'caused' || s.direction === 'taken') &&
        ((s.unitId === w.unitId && s.direction === 'caused') || (s.unitId !== w.unitId && s.direction === 'taken'))
    );
    if (buffInsts.length === 0) continue;

    for (const st of buffInsts) {
      if (st.direction !== 'caused' && st.direction !== 'taken') continue;
      const rate = st.rate!;
      // 该增伤实际生效过的结构化归因（同窗口、后续伤害事件里查同方向同数值的来源）
      let srcSkillId = st.sourceSkillId;
      let srcSkillName = st.sourceSkillName;
      let srcUnitId = st.sourceUnitId;
      if (!srcSkillId) {
        for (const rec of tl.damages) {
          if (rec.round !== w.round || rec.eventIndex <= st.startIdx || rec.eventIndex > w.endIdx) continue;
          const list = st.direction === 'caused' ? rec.modifiers?.caused : rec.modifiers?.taken;
          const hit = list?.find((m) => Math.abs(m.rate - rate) < 1e-9);
          if (hit) {
            srcSkillId = hit.skillId;
            srcSkillName = hit.skillName;
            srcUnitId = hit.unitId;
            break;
          }
        }
      }
      if (!srcSkillId) continue; // 来源不可考：不产出结论（避免误判）

      for (const rec of tl.damages) {
        if (rec.eventIndex >= st.startIdx) continue;
        if (rec.eventIndex < w.startIdx) continue;
        if (rec.ownerId !== w.unitId) continue;
        if (rec.kind === 'dot') continue; // DoT 伤害在挂上时冻结，不参与顺序判定
        if (st.direction === 'taken' && rec.targetId !== st.unitId) continue;
        const mods = st.direction === 'caused' ? rec.modifiers?.caused : rec.modifiers?.taken;
        if (mods?.some((m) => m.skillId === srcSkillId)) continue; // 已吃到
        const { usable } = usableOf(rec);
        gaps.push({
          scope: srcUnitId === w.unitId ? 'self' : 'sameWindow',
          unitId: w.unitId,
          unitName: unitNameOf(tl, w.unitId),
          skillId: rec.skillId,
          skillName: rec.kind === 'attack' ? '普通攻击' : rec.skillName,
          buffSkillId: srcSkillId,
          buffSkillName: srcSkillName ?? srcSkillId,
          buffStatusType: st.statusType,
          direction: st.direction,
          rate,
          round: w.round,
          eventIndex: rec.eventIndex,
          damage: rec.damage,
          usable: Math.round(usable),
          estimatedMissed: Math.round(usable * rate),
          confidence: rate !== undefined ? 'confirmed' : 'estimated',
        });
      }
    }
  }

  // 去重：同一（窗口回合 + 伤害事件 + 增伤来源）只留一条
  const seen = new Set<string>();
  const out: OrderGap[] = [];
  for (const g of gaps) {
    if (!sideUnitIds.has(g.unitId)) continue;
    const key = `${g.eventIndex}:${g.buffSkillId}:${g.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out.sort((a, b) => a.round - b.round || a.eventIndex - b.eventIndex);
}

// ─── 结论与病灶 ───

function buildVerdict(my: SideDiagnosis, enemy: SideDiagnosis): Verdict {
  const myDamage = my.totalDamage;
  const enemyDamage = enemy.totalDamage;
  const gap = myDamage - enemyDamage;
  const gapPct = enemyDamage > 0 ? Math.round(((myDamage - enemyDamage) / enemyDamage) * 1000) / 10 : 0;

  const myIdle = my.mainSkills;
  const enIdle = enemy.mainSkills;
  const idleLoss = (rows: MainSkillReport[]) => rows.reduce((a, x) => a + x.idleRounds * x.avgDamagePerEffectiveRound, 0);
  const controlLoss = (rows: MainSkillReport[]) => rows.reduce((a, x) => a + x.controlledSkips * x.avgDamagePerEffectiveRound, 0);
  const orderLoss = (gaps: OrderGap[]) => gaps.reduce((a, x) => a + (x.estimatedMissed ?? 0), 0);

  const raw: CauseFinding[] = [
    {
      kind: 'counter',
      label: '兵种克制（被克 30% 实际生效）',
      impact: Math.round(my.counters.counteredLoss - enemy.counters.counteredLoss),
      evidenceCount: my.counters.counteredHits,
      confidence: 'confirmed',
      detail:
        `我方被克 ${my.counters.counteredHits} 条伤害，账本实证损失 ${Math.round(my.counters.counteredLoss).toLocaleString()}；` +
        `敌方被克 ${enemy.counters.counteredHits} 条损失 ${Math.round(enemy.counters.counteredLoss).toLocaleString()}（克制归因实交率 ${my.counters.compliancePct}%）`,
    },
    {
      kind: 'skill_order',
      label: '技能顺序：先打的伤害吃不到后施加的增伤',
      impact: Math.round(orderLoss(my.orderGaps) - orderLoss(enemy.orderGaps)),
      evidenceCount: my.orderGaps.length,
      confidence: 'confirmed',
      detail: `我方顺序缺口 ${my.orderGaps.length} 处，估算少打 ${Math.round(orderLoss(my.orderGaps)).toLocaleString()}；敌方 ${enemy.orderGaps.length} 处`,
    },
    {
      kind: 'main_skill_idle',
      label: '主战法空转（判定失败 / 空放 / 未判定）',
      impact: Math.round(idleLoss(myIdle) - idleLoss(enIdle)),
      evidenceCount: myIdle.reduce((a, x) => a + x.idleRounds, 0),
      confidence: 'estimated',
      detail:
        `我方主战法空转 ${myIdle.reduce((a, x) => a + x.idleRounds, 0)} 回合（估算少打 ${Math.round(idleLoss(myIdle)).toLocaleString()}）；` +
        `敌方 ${enIdle.reduce((a, x) => a + x.idleRounds, 0)} 回合`,
    },
    {
      kind: 'control',
      label: '控制覆盖率（被控导致判定机会流失）',
      impact: Math.round(controlLoss(myIdle) - controlLoss(enIdle)),
      evidenceCount: my.control.takenRounds,
      confidence: 'estimated',
      detail:
        `我方被控 ${my.control.takenRounds}/${my.control.actedRounds} 单位回合（${my.control.takenPct}%），` +
        `因控流失判定机会 ${myIdle.reduce((a, x) => a + x.controlledSkips, 0)} 次；` +
        `我方施加控制覆盖敌方 ${my.control.dealtPct}%`,
    },
  ];
  const findings = raw.sort((a, b) => b.impact - a.impact);

  const top = findings.find((f) => f.impact > 0);
  const primary: CauseKind = top ? top.kind : 'none';
  const summary =
    `我方伤害 ${myDamage.toLocaleString()} vs 敌方 ${enemyDamage.toLocaleString()}（${gap >= 0 ? '+' : ''}${gap.toLocaleString()}，${gapPct}%）；` +
    (top
      ? `主因 = ${top.label}（估算影响 ${top.impact.toLocaleString()}，置信度 ${top.confidence === 'confirmed' ? '实证' : '估算'}）`
      : '四类候选因子均无正影响（无被克损失 / 无顺序缺口 / 无空转 / 无被控流失）');

  return { myDamage, enemyDamage, gap, gapPct, primary, findings, summary };
}

function buildIssues(my: SideDiagnosis, enemy: SideDiagnosis, verdict: Verdict, th: DiagnosisThresholds, tl: Timeline): Issue[] {
  const issues: Issue[] = [];
  const idleRows = my.mainSkills.filter((m) => m.idleRatePct >= th.mainSkillIdleRatePct || m.idleRounds >= th.mainSkillIdleRounds);
  if (idleRows.length > 0) {
    issues.push({
      kind: 'main_skill_idle',
      severity: idleRows.some((m) => m.idleRatePct >= 75) ? 'high' : 'medium',
      label: '主战法空转',
      detail: idleRows
        .map((m) => `${m.name}【${m.skillName}】空转 ${m.idleRounds}/${m.actedRounds} 回合（${m.idleRatePct}%），释放 ${m.casts} 次 / 判定失败 ${m.triggerFailures} 次 / 空放 ${m.noEffectCasts} 次`)
        .join('；'),
      evidence: idleRows.flatMap((m) => m.evidence.filter((e) => e.kind !== 'preparing').map((e) => `${m.name}：${e.detail}`)),
      metrics: { idleRounds: idleRows.reduce((a, x) => a + x.idleRounds, 0), idleRatePct: Math.max(...idleRows.map((x) => x.idleRatePct)) },
    });
  }
  const gapLoss = my.orderGaps.reduce((a, x) => a + (x.estimatedMissed ?? 0), 0);
  if (my.orderGaps.length >= th.orderGapCount) {
    issues.push({
      kind: 'skill_order_gap',
      severity: gapLoss > my.totalDamage * 0.05 ? 'high' : 'medium',
      label: '技能顺序缺口（吃不到增伤）',
      detail: `${my.orderGaps.length} 处：` +
        summarizeGaps(my.orderGaps),
      evidence: my.orderGaps.slice(0, 8).map(
        (g) => `第 ${g.round} 回合 · ${g.unitName}【${g.skillName}】早于【${g.buffSkillName}】+${Math.round((g.rate ?? 0) * 100)}%（事件 #${g.eventIndex}，估算少打 ${g.estimatedMissed ?? 0}）`
      ),
      metrics: { gapCount: my.orderGaps.length, estimatedMissed: Math.round(gapLoss) },
    });
  }
  const counterShare = my.totalDamage > 0 ? (my.counters.counteredLoss / my.totalDamage) * 100 : 0;
  if (my.counters.counteredHits > 0 && counterShare >= th.counterLossSharePct) {
    issues.push({
      kind: 'countered',
      severity: counterShare >= 20 ? 'high' : 'medium',
      label: '兵种被克制',
      detail: `我方被克 ${my.counters.counteredHits} 条伤害，账本损失 ${Math.round(my.counters.counteredLoss).toLocaleString()}（占总伤害 ${Math.round(counterShare * 10) / 10}%）` +
        (my.counters.exceptions.length ? `；例外：${my.counters.exceptions.map((e) => `${e.reason}×${e.count}`).join('、')}` : ''),
      evidence: my.counters.pairs
        .filter((p) => p.expectedReduce > 0 && p.hits > 0)
        .slice(0, 6)
        .map((p) => `${p.attackerName}（${p.attackerTroop}）→ ${p.targetName}（${p.targetTroop}）：${p.hits} 条，克制影响 ${p.impact.toLocaleString()}，实交 ${p.confirmedHits}/${p.hits}`),
      metrics: { counteredHits: my.counters.counteredHits, counteredLoss: Math.round(my.counters.counteredLoss), sharePct: Math.round(counterShare * 10) / 10 },
    });
  }
  if (my.control.takenPct >= th.controlTakenPct && my.control.takenRounds > 0) {
    issues.push({
      kind: 'control_taken_high',
      severity: my.control.takenPct >= 50 ? 'high' : 'medium',
      label: '我方被控覆盖偏高',
      detail: `我方被控 ${my.control.takenRounds}/${my.control.actedRounds} 单位回合（${my.control.takenPct}%），最高：` +
        my.control.taken.filter((x) => x.controlledRounds > 0).sort((a, b) => b.controlledRounds - a.controlledRounds).slice(0, 3)
          .map((x) => `${x.name} ${x.controlledRounds}/${x.actedRounds}`).join('、'),
      evidence: my.control.evidence.map((e) => `${e.reason} ×${e.count}`),
      metrics: { takenPct: my.control.takenPct, takenRounds: my.control.takenRounds },
    });
  }
  const myControlSkills = countSkillsWithTag(my, tl, ['confusion', 'rampage', 'cowardice', 'hesitation', 'taunt']);
  if (my.control.dealtPct <= th.controlDealtLowPct && my.control.dealtPct < enemy.control.dealtPct && myControlSkills.count > 0) {
    issues.push({
      kind: 'control_dealt_low',
      severity: 'medium',
      label: '控制覆盖率偏低',
      detail: `我方带控制类战法 ${myControlSkills.count} 个（${myControlSkills.names.join('、')}），但施加控制只覆盖敌方 ${my.control.dealtPct}% 行动回合（敌方对我方 ${my.control.takenPct}%）` +
        (my.control.unattributedDealtRounds > 0 ? `；另有 ${my.control.unattributedDealtRounds} 个回合的控制无法推定施加者，未计入` : ''),
      evidence: my.effects.filter((e) => CONTROL_SET.has(e.statusType)).map((e) => `${e.name}：施加 ${e.appliedCount} 次，覆盖 ${e.coveredUnitRounds} 单位回合`),
      metrics: { dealtPct: my.control.dealtPct, controlSkills: myControlSkills.count },
    });
  }
  const boostGain = my.ledger.byKind.boost;
  const boostShare = my.totalDamage > 0 ? (boostGain / my.totalDamage) * 100 : 0;
  const myBoostSkills = countSkillsWithTag(my, tl, ['damage_boost']);
  if (myBoostSkills.count > 0 && boostShare <= th.boostGainLowSharePct) {
    issues.push({
      kind: 'boost_unused',
      severity: 'medium',
      label: '增伤没吃到',
      detail: `我方带增减伤类战法 ${myBoostSkills.count} 个（${myBoostSkills.names.join('、')}），但账本增伤收益仅 ${Math.round(boostGain).toLocaleString()}（占总伤害 ${Math.round(boostShare * 10) / 10}%）`,
      evidence: my.effects.filter((e) => e.statusType === 'damage_boost' || e.statusType === 'attack_buff').slice(0, 6)
        .map((e) => `${e.name}：施加 ${e.appliedCount} 次，覆盖 ${e.coveredUnitRounds} 单位回合（${e.coveragePct}%）`),
      metrics: { boostGain: Math.round(boostGain), boostSharePct: Math.round(boostShare * 10) / 10 },
    });
  }
  if (verdict.gapPct <= -th.damageGapPct) {
    issues.push({
      kind: 'damage_gap',
      severity: verdict.gapPct <= -30 ? 'high' : 'medium',
      label: '伤害缺口',
      detail: `我方伤害落后敌方 ${Math.abs(verdict.gapPct)}%（${verdict.gap.toLocaleString()}），归因见 verdict.findings`,
      evidence: verdict.findings.filter((f) => f.impact > 0).map((f) => `${f.label}：${f.impact.toLocaleString()}（${f.confidence === 'confirmed' ? '实证' : '估算'}）`),
      metrics: { gap: verdict.gap, gapPct: verdict.gapPct },
    });
  }
  return issues;
}

function summarizeGaps(gaps: OrderGap[]): string {
  const byBuff = new Map<string, number>();
  for (const g of gaps) byBuff.set(g.buffSkillName, (byBuff.get(g.buffSkillName) ?? 0) + 1);
  return [...byBuff.entries()].map(([k, v]) => `【${k}】×${v}`).join('、');
}

/** 该侧携带的、含指定标签的战法（读只读战法表，best-effort） */
function countSkillsWithTag(side: SideDiagnosis, tl: Timeline, tags: string[]): { count: number; names: string[] } {
  const units = tl.units.filter((u) => u.side === side.side);
  const names = new Set<string>();
  for (const u of units) {
    const ids = [...u.general.activeSkillIds, ...u.general.pursuitSkillIds, ...u.general.commandSkillIds, ...u.general.passiveSkillIds];
    for (const id of ids) {
      const def = SKILL_REGISTRY[id] as { tags?: string[]; name?: string } | undefined;
      if (def?.tags?.some((t) => tags.includes(t))) names.add(def.name ?? id);
    }
  }
  return { count: names.size, names: [...names] };
}

// ─── 对外入口：单场 ───

export function diagnoseBattle(report: BattleReport, opts: DiagnosisOptions = {}): BattleDiagnosis {
  if (!report || !Array.isArray(report.events)) {
    throw new Error('diagnoseBattle: 需要带 events 的 BattleReport（CLI 用 --json 导出的完整战报）');
  }
  const th: DiagnosisThresholds = { ...DIAGNOSIS_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const tl = buildTimeline(report);

  const my = analyzeSide(tl, report, 'my', '我方');
  const enemy = analyzeSide(tl, report, 'enemy', '敌方');
  const verdict = buildVerdict(my, enemy);
  const issues = buildIssues(my, enemy, verdict, th, tl);

  const notes: string[] = [];
  const totalStatuses = tl.statusAttributed + tl.statusUnattributed;
  if (totalStatuses > 0) {
    notes.push(
      `状态来源推定：${tl.statusAttributed}/${totalStatuses} 条状态由「近邻释放事件」反查到来源（其余为战斗开始/被动路径，无释放事件）；` +
        `账本与克制归因不受此影响（走伤害事件的 modifiers 结构化字段）`
    );
  }
  if (my.ledger.clampedHits + enemy.ledger.clampedHits > 0) {
    notes.push(`触底（增减伤净额 ≤ −90%，按 10% 结算）事件 ${my.ledger.clampedHits + enemy.ledger.clampedHits} 条：账本按比例分摊，单项占比为近似值`);
  }
  if (my.ledger.unattributed + enemy.ledger.unattributed > 0) {
    notes.push(`无增减伤归因的伤害 ${Math.round(my.ledger.unattributed + enemy.ledger.unattributed).toLocaleString()}（一类指挥预存 delayedOutput 等不吃增减伤，已单列）`);
  }

  return {
    version: DIAGNOSIS_VERSION,
    label: opts.label ?? `seed ${report.seed}`,
    seed: report.seed,
    result: report.result,
    rounds: report.rounds,
    maxRounds: report.maxRounds,
    eventCount: report.events.length,
    my,
    enemy,
    verdict,
    issues,
    thresholds: th,
    notes,
  };
}

// ─── 对外入口：批量 ───

function teamFingerprint(generals: General[]): string {
  return [...generals]
    .map((g) => [g.position, g.heroId ?? g.id, g.level ?? 0, g.mainSkillId ?? '', [...g.activeSkillIds, ...g.pursuitSkillIds, ...g.commandSkillIds, ...g.passiveSkillIds].join(',')].join(':'))
    .join('|');
}

function teamLabel(generals: General[]): string {
  return generals.map((g) => g.name).join(' / ');
}

function groupMetrics(diags: BattleDiagnosis[]): GroupMetrics {
  const n = Math.max(1, diags.length);
  const avg = (f: (d: BattleDiagnosis) => number) => diags.reduce((a, d) => a + f(d), 0) / n;
  const myDamage = avg((d) => d.my.totalDamage);
  const counterLoss = avg((d) => d.my.counters.counteredLoss);
  const orderGaps = avg((d) => d.my.orderGaps.length);
  const orderLoss = avg((d) => d.my.orderGaps.reduce((a, x) => a + (x.estimatedMissed ?? 0), 0));
  const idleRounds = avg((d) => d.my.mainSkills.reduce((a, x) => a + x.idleRounds, 0));
  const acted = avg((d) => d.my.mainSkills.reduce((a, x) => a + x.actedRounds, 0));
  return {
    damagePerRound: Math.round(avg((d) => d.my.totalDamage / Math.max(1, d.rounds))),
    enemyDamagePerRound: Math.round(avg((d) => d.enemy.totalDamage / Math.max(1, d.rounds))),
    counterLossPerReport: Math.round(counterLoss),
    counterLossSharePct: myDamage > 0 ? Math.round((counterLoss / myDamage) * 1000) / 10 : 0,
    orderGapCountPerReport: Math.round(orderGaps * 10) / 10,
    orderGapLossPerReport: Math.round(orderLoss),
    mainSkillIdleRatePct: acted > 0 ? Math.round((idleRounds / acted) * 1000) / 10 : 0,
    mainSkillIdleRoundsPerReport: Math.round(idleRounds * 10) / 10,
    controlTakenPct: Math.round(avg((d) => d.my.control.takenPct) * 10) / 10,
    controlDealtPct: Math.round(avg((d) => d.my.control.dealtPct) * 10) / 10,
    boostGainPerReport: Math.round(avg((d) => d.my.ledger.byKind.boost)),
    reduceLossPerReport: Math.round(avg((d) => d.my.ledger.byKind.reduce)),
  };
}

/**
 * 批量诊断：按队伍指纹自动分组——同组 ≥ batchMinReports 场找**共性问题**；
 * 组间取最高/最低伤害组做**差异因子**对照（明确标注为相关，不是因果）。
 */
export function diagnoseBatch(entries: BatchEntry[], opts: DiagnosisOptions = {}): BatchDiagnosis {
  if (entries.length === 0) throw new Error('diagnoseBatch: 至少需要一场战报');
  const th: DiagnosisThresholds = { ...DIAGNOSIS_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const diags = entries.map((e, i) => ({ diag: diagnoseBattle(e.report, { ...opts, label: e.label ?? opts.label ?? `#${i + 1}` }), report: e.report }));

  const groupsMap = new Map<string, { group: BatchGroup; diags: BattleDiagnosis[] }>();
  for (const { diag, report } of diags) {
    const fp = `${teamFingerprint(report.myTeam)}||${teamFingerprint(report.enemyTeam)}`;
    let g = groupsMap.get(fp);
    if (!g) {
      const group: BatchGroup = {
        fingerprint: fp,
        label: teamLabel(report.myTeam),
        team: report.myTeam.map((x) => x.name).join(' / '),
        reports: 0, wins: 0, winRatePct: 0, avgDamage: 0, avgEnemyDamage: 0,
        metrics: groupMetrics([]),
      };
      g = { group, diags: [] };
      groupsMap.set(fp, g);
    }
    g.diags.push(diag);
    g.group.reports += 1;
    if (diag.result === 'win') g.group.wins += 1;
  }

  const groups: BatchGroup[] = [];
  const commons: BatchDiagnosis['common'] = [];
  for (const { group, diags: gd } of groupsMap.values()) {
    group.winRatePct = Math.round((group.wins / group.reports) * 1000) / 10;
    group.avgDamage = Math.round(gd.reduce((a, d) => a + d.my.totalDamage, 0) / gd.length);
    group.avgEnemyDamage = Math.round(gd.reduce((a, d) => a + d.enemy.totalDamage, 0) / gd.length);
    group.metrics = groupMetrics(gd);
    groups.push(group);

    const notes: string[] = [];
    if (gd.length < th.batchMinReports) {
      notes.push(`场次 ${gd.length} < ${th.batchMinReports}，样本不足，未做共性问题统计`);
      commons.push({ group, issues: [], notes });
      continue;
    }
    const counter = new Map<string, { label: string; reports: number; metrics: Record<string, number>; details: string[] }>();
    for (const d of gd) {
      for (const issue of d.issues) {
        const cur = counter.get(issue.kind) ?? { label: issue.label, reports: 0, metrics: {}, details: [] };
        cur.reports += 1;
        for (const [k, v] of Object.entries(issue.metrics)) cur.metrics[k] = (cur.metrics[k] ?? 0) + v;
        cur.details.push(issue.detail);
        counter.set(issue.kind, cur);
      }
    }
    const issues: CommonIssue[] = [];
    for (const [kind, c] of counter) {
      const sharePct = Math.round((c.reports / gd.length) * 1000) / 10;
      if (sharePct < th.batchCommonSharePct) continue;
      const metrics: Record<string, number> = {};
      for (const [k, v] of Object.entries(c.metrics)) metrics[k] = Math.round((v / c.reports) * 10) / 10;
      issues.push({
        kind,
        label: c.label,
        reports: c.reports,
        total: gd.length,
        sharePct,
        detail: `${c.reports}/${gd.length} 场（${sharePct}%）出现：${c.details[0]}`,
        metrics,
      });
    }
    issues.sort((a, b) => b.sharePct - a.sharePct);
    if (issues.length === 0) notes.push('组内未发现达到共性阈值的病灶');
    commons.push({ group, issues, notes });
  }

  groups.sort((a, b) => b.metrics.damagePerRound - a.metrics.damagePerRound);
  let comparison: BatchDiagnosis['comparison'] = null;
  if (groups.length >= 2) {
    const best = groups[0];
    const worst = groups[groups.length - 1];
    const defs: { metric: keyof GroupMetrics; label: string; note: string; good: 'high' | 'low' | 'neutral' }[] = [
      { metric: 'counterLossSharePct', label: '被克损失占总伤害', note: '被克制吃掉的比例', good: 'low' },
      { metric: 'mainSkillIdleRatePct', label: '主战法空转率', note: '主战法没打出效果的回合占比', good: 'low' },
      { metric: 'orderGapCountPerReport', label: '顺序缺口次数/场', note: '吃不到增伤的频次', good: 'low' },
      { metric: 'controlTakenPct', label: '我方被控占比', note: '被控制覆盖', good: 'low' },
      { metric: 'controlDealtPct', label: '我方施加控制覆盖', note: '压制对面的能力', good: 'high' },
      { metric: 'boostGainPerReport', label: '增伤账本收益/场', note: '增益实际转化', good: 'high' },
      { metric: 'reduceLossPerReport', label: '减伤账本损失/场', note: '为负值，绝对值越大代表被打得越疼', good: 'low' },
      { metric: 'damagePerRound', label: '每回合伤害', note: '结果指标本身', good: 'neutral' },
    ];
    const factors: FactorDelta[] = defs.map((d) => {
      const a = best.metrics[d.metric];
      const b = worst.metrics[d.metric];
      const delta = Math.round((a - b) * 10) / 10;
      const base = Math.max(Math.abs(a), Math.abs(b), 1);
      // 该因子在「高分组」这一侧是否更有利（低=数值越低越好）
      const favors: FactorDelta['favors'] =
        delta === 0 ? 'same' : d.good === 'neutral' ? 'neutral' : (d.good === 'high') === delta > 0 ? 'best' : 'worst';
      return {
        metric: d.metric,
        label: d.label,
        best: a,
        worst: b,
        delta,
        deltaPct: Math.round((Math.abs(delta) / base) * 1000) / 10,
        note: d.note,
        favors,
      };
    });
    factors.sort((a, b) => b.deltaPct - a.deltaPct);
    const favoring = factors.filter((f) => f.favors === 'best');
    comparison = {
      best,
      worst,
      factors,
      summary:
        `最高伤害组「${best.label}」每回合 ${best.metrics.damagePerRound.toLocaleString()} vs 最低组「${worst.label}」${worst.metrics.damagePerRound.toLocaleString()}；` +
        (favoring.length > 0
          ? `高分组占优的因子：${favoring.slice(0, 3).map((f) => `${f.label}（${f.best} vs ${f.worst}）`).join('、')}`
          : '没有任何单因子呈现「高分组更有利」的方向（可能是样本太少或差异被抵消）') +
        '（相关对照，非因果证明）',
    };
  }

  const allCommon = commons.filter((c) => c.issues.length > 0);
  const summary =
    `共 ${diags.length} 场 / ${groups.length} 组；` +
    (allCommon.length > 0
      ? `共性问题：${allCommon.map((c) => `「${c.group.team}」${c.issues.map((i) => `${i.label}(${i.sharePct}%)`).join('、')}`).join('；')}`
      : '未发现达到阈值的共性问题') +
    (comparison ? `；组间差异见 comparison.factors` : '');

  return { version: DIAGNOSIS_VERSION, total: diags.length, groups, common: commons, comparison, summary };
}
