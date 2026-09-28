/**
 * L3 组合优化 · 优化武将（队友）—— 真引擎模拟测评（用户 2026-09-28 口径）
 * ---------------------------------------------------------------------------
 * **L2 与 L3 的分工（同一把尺子，两步衔接）**
 *   · L2（`web/simExpectation.ts`）= **优化战法**：把「空战法槽」当搜索维度，回答「这支队伍带哪些战法伤害期望最高」；
 *   · L3（本文件）= **优化武将**：把「队友位」当那个空槽，对**队友组合**做粗筛，回答「围绕核心将配哪两个队友」。
 *   靶子（不还手木桩）、排序口径（核心将伤害期望）、三阶段阈值（粗筛 3 场 → 决赛 ≥20 场）三层与 L2 完全一致，
 *   所以 L3 选完队友直接切 L2 配全队战法时，两步结论可以叠加——不换尺子。
 *
 * **搜索维度 = 队友位（把队友视为那个空槽）**
 *   · 勾 1 个队友位 → 单槽粗筛：每个候选武将在该位真跑 `coarseRuns` 场；
 *   · 勾 2 个队友位 → **成对评估**（用户 2026-09-28 口径，同 L2 双槽成对）：先跑一圈单挂拿「搭子基准」
 *     （每个位各取前 `pairCarriers` 名），再用「基准 × 全部候选」两两配对真跑——两个位**各作一次基准方向**，
 *     所以「谁站大营 / 谁站前锋」两种排法都会被评到，不会被系统性地偏袒。另留最多 3 个「单挂」选项
 *     （只换一个位、另一位保持当前武将）当出口。
 *     为什么要成对：队友是**互相成就**的（辅助要配得上输出将、双辅助会互相挤占、双坦会一起打不出伤害），
 *     只按单挂成绩独立筛，会把「只有搭在一起才强」的组合在粗筛这一关误杀。
 *
 * **候选武将口径**
 *   · 池 = 上架武将池（缺省；可切「含下架」）− 队内已上阵武将（含核心与未参与匹配的队友）；
 *   · 候选进场时：**等级沿用被替换的槽位**（同水平比较）、加点清零、兵种取武将本体、
 *     不带宝物 / 兵系特性、**战法槽清空** —— 战法归 L2 那一步配（L2 只填空槽），
 *     故 L3 的所有试跑都在「匹配位战法槽已清空」的基线上进行，交给 L2 的就是它的起始状态。
 *
 * **三阶段（阈值均可配，与 L2 同一套缺省值）**
 *   ① 队友位粗筛（单挂 / 成对）→ ② 组合粗筛榜单（按「不同武将套」去重）→ ③ 决赛排行（伤害期望）。
 *   复现：种子 = `baseSeed + 场次`（同一场次对所有候选一致 → 配对比较），奇数场交换场地。
 *   排序口径 = **核心将伤害期望**（`coreUnits`，缺省自动识别；全队总伤只作参考列）。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { ensureUniqueUnitIds } from '../src/engine/combat';
import type { General, TroopType } from '../src/engine/types';
import { DEFAULT_ENV, runOne, type RunRaw } from './battleSim';
import { HERO_RECORDS, HEROES, SLOTTED_HEROES } from './heroes';
import {
  autoCoreUnits,
  COARSE_RUNS_DEFAULT,
  COARSE_TOP_DEFAULT,
  coreDamageOf,
  coreFirst3Of,
  coreLabelOf,
  DUMMY_TROOPS_DEFAULT,
  dummyLabel,
  dummyTeamFromEnemy,
  FINAL_RUNS_MIN,
  first3Damage,
  pairAgreement,
} from './simExpectation';
import { generalsOf, type ViewCfg } from './teamConfig';

// ─────────────────────────── 参数 ───────────────────────────

/** L3 最多同时匹配的队友位（勾 2 个 = 成对评估；第 3 位只在没被勾时才是「队友」） */
export const MAX_MATCH_UNITS = 2;

/** 成对模式里保留的「单挂」出口选项数（只换一个位、另一位保持当前武将） */
export const PAIR_SINGLE_EXITS = 3;

export interface MateSimOptions {
  /** 粗筛场次（默认 3）：每个「队友位 × 候选武将」与每个「配对」各跑几场 */
  coarseRuns: number;
  /** 决赛场次（默认 20，**下限 20**）：每个入决赛组合跑几场 */
  finalRuns: number;
  /** 粗筛后保留的选项数（默认 32；成对模式下选项 = 有序武将对） */
  unitKeep: number;
  /**
   * 成对模式的搭子基准数（默认 10）：全量 P² 对太贵，取「单挂成绩前 N 名」当基准，
   * 与**全部候选**各配一次（两个位各作一次基准方向 → 2 × N × P 对）。
   * 调小更快、调大更全。
   */
  pairCarriers: number;
  /** 组合粗筛榜单前 N 名进决赛（默认 32，同 L2） */
  coarseTop: number;
  /** 组合粗筛最多评估多少个组合（默认 1000） */
  maxCombos: number;
  /** 排序口径的时间窗（默认整局；可切前三回合） */
  rankBy: 'total' | 'first3';
  /** **排序目标 = 核心将的伤害期望**（同 L2；不给 = 自动识别核心将） */
  coreUnits?: number[];
  /** 参与匹配的队友位（缺省 = 非核心将的全部位；最多 2 个） */
  matchUnits?: number[];
  /** 候选武将池覆盖（缺省 = 上架 / 含下架池）；测试与脚本收窄用 */
  candidateIds?: string[];
  /** 候选池是否含「下架武将」（主战法已实现但成长率未确认；缺省 false） */
  includeOffline: boolean;
  /** 木桩单只兵力（默认 150000，同 L2） */
  dummyTroops: number;
  /** 回合数（默认 8；页面跟随面板「回合数」） */
  maxRounds: number;
  baseSeed: number;
  swapSides: boolean;
}

export const MATE_SIM_DEFAULTS: MateSimOptions = {
  coarseRuns: COARSE_RUNS_DEFAULT,
  finalRuns: FINAL_RUNS_MIN,
  unitKeep: COARSE_TOP_DEFAULT,
  pairCarriers: 10,
  coarseTop: COARSE_TOP_DEFAULT,
  maxCombos: 1000,
  rankBy: 'total',
  includeOffline: false,
  dummyTroops: DUMMY_TROOPS_DEFAULT,
  maxRounds: DEFAULT_ENV.maxRounds,
  baseSeed: DEFAULT_ENV.baseSeed,
  swapSides: DEFAULT_ENV.swapSides,
};

function resolveOptions(opts: Partial<MateSimOptions> = {}): MateSimOptions {
  // 显式传 undefined 的键当作「没传」（否则 Math.floor(undefined) = NaN 会把整批参数毒掉）
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) clean[k] = v;
  const merged = { ...MATE_SIM_DEFAULTS, ...(clean as Partial<MateSimOptions>) };
  return {
    ...merged,
    coarseRuns: Math.max(1, Math.floor(merged.coarseRuns)),
    // 决赛「至少 20 场」：低配值一律抬回下限，不静默降标准（与 L2 同一口径）
    finalRuns: Math.max(FINAL_RUNS_MIN, Math.floor(merged.finalRuns)),
    unitKeep: Math.max(1, Math.floor(merged.unitKeep)),
    pairCarriers: Math.max(1, Math.floor(merged.pairCarriers)),
    coarseTop: Math.max(1, Math.floor(merged.coarseTop)),
    maxCombos: Math.max(1, Math.floor(merged.maxCombos)),
    dummyTroops: Math.max(1, Math.floor(merged.dummyTroops)),
    maxRounds: Math.max(1, Math.floor(merged.maxRounds)),
    includeOffline: Boolean(merged.includeOffline),
  };
}

// ─────────────────────── 队友位与候选武将 ───────────────────────

const CFG_POSITIONS = ['大营', '中军', '前锋'] as const;

/** 队友位显示名（取不到记录时回退 id） */
export function mateHeroName(cfg: ViewCfg, unit: number): string {
  const heroId = cfg.slots[unit]?.heroId ?? '';
  return HERO_RECORDS[heroId]?.name ?? heroId ?? `#${unit}`;
}

export interface MateSlot {
  unit: number;
  unitName: string;
  /** 站位：0=大营 1=中军 2=前锋（站位决定攻击距离与先手，成对评估要把两种排法都跑到） */
  position: string;
  /** 该位当前武将（未参与匹配时保持不动） */
  currentHeroId: string;
}

/**
 * 参与匹配的队友位：**排除核心将**（核心是将要围绕的锚，不该被搜掉），最多 `MAX_MATCH_UNITS` 个。
 * `matchUnits` 给了就只取其中「非核心」的那几位（顺序按槽位下标升序，保证可复现）。
 */
export function mateSlots(cfg: ViewCfg, matchUnits?: number[], coreUnits?: number[]): MateSlot[] {
  const core = new Set(coreUnits?.length ? coreUnits : autoCoreUnits(cfg));
  const eligible = cfg.slots.map((_, i) => i).filter((i) => !core.has(i));
  const wanted = matchUnits?.length ? [...new Set(matchUnits)].filter((u) => eligible.includes(u)) : eligible;
  return wanted
    .sort((a, b) => a - b)
    .slice(0, MAX_MATCH_UNITS)
    .map((unit) => ({
      unit,
      unitName: mateHeroName(cfg, unit),
      position: CFG_POSITIONS[unit] ?? '中军',
      currentHeroId: cfg.slots[unit]?.heroId ?? '',
    }));
}

/** 候选武将底座池：上架池（缺省，主战法 + 成长率都已确认）/ 含下架池 */
export function heroPoolBase(opts: Partial<MateSimOptions> = {}): string[] {
  const list = opts.includeOffline ? SLOTTED_HEROES : HEROES;
  return list.map((h) => h.id);
}

/**
 * 候选武将池 = 底座池 − 队内已上阵武将（含核心与非匹配队友）。
 * 队内武将不能重复上阵（配将面板同款规则），故已上阵者一律不进候选。
 */
export function candidateHeroes(cfg: ViewCfg, opts: Partial<MateSimOptions> = {}): string[] {
  const used = new Set(cfg.slots.map((s) => s.heroId).filter(Boolean));
  const base = opts.candidateIds ?? heroPoolBase(opts);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of base) {
    if (used.has(id) || seen.has(id) || !HERO_RECORDS[id]) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 武将名（缺记录回退 id） */
export function heroName(id: string): string {
  return HERO_RECORDS[id]?.name ?? id;
}

/** 候选武将进场时的槽位状态：等级沿用原槽位、加点清零、兵种取本体、战法槽清空（战法归 L2 配） */
export function slotForHero(cfg: ViewCfg, unit: number, heroId: string): ViewCfg['slots'][number] {
  const prev = cfg.slots[unit];
  const rec = HERO_RECORDS[heroId];
  return {
    heroId,
    level: prev?.level ?? 40,
    addAttack: 0,
    addStrategy: 0,
    troopType: (rec?.troopType ?? prev?.troopType ?? 'infantry') as TroopType,
    skillIds: [],
    // 宝物 / 兵系特性是上一位武将的配置，换将后不带过去（面板里可另配）
    traits: undefined,
    treasure: null,
  };
}

/** 换将（返回新 cfg；其余槽位原样保留，含未参与匹配的将的战法） */
export function withSlotHero(cfg: ViewCfg, unit: number, heroId: string): ViewCfg {
  return {
    ...cfg,
    enemy: { ...cfg.enemy },
    manual: { ...cfg.manual },
    slots: cfg.slots.map((s, i) => (i === unit ? slotForHero(cfg, unit, heroId) : { ...s, skillIds: [...s.skillIds] })),
  };
}

/** 一次换多个位（成对 / 组合用） */
export function withHeroPicks(cfg: ViewCfg, picks: Array<{ unit: number; heroId: string }>): ViewCfg {
  return picks.reduce((acc, p) => withSlotHero(acc, p.unit, p.heroId), cfg);
}

/** 清空若干位（队友位）的战法槽：L3 的试跑基线（战法留给 L2 那一步配） */
export function clearSlotSkills(cfg: ViewCfg, units: number[]): ViewCfg {
  const set = new Set(units);
  return {
    ...cfg,
    enemy: { ...cfg.enemy },
    manual: { ...cfg.manual },
    slots: cfg.slots.map((s, i) => (set.has(i) ? { ...s, skillIds: [] } : { ...s, skillIds: [...s.skillIds] })),
  };
}

/** 队内武将唯一（同一武将不得占两个位）；空位不计 */
export function picksLegal(picks: Array<{ heroId: string }>): boolean {
  const seen = new Set<string>();
  for (const p of picks) {
    if (!p.heroId) continue;
    if (seen.has(p.heroId)) return false;
    seen.add(p.heroId);
  }
  return true;
}

/* ─────────────────── 同队互斥（引擎配队规则，缺了会让整轮跑批抛错） ───────────────────
 * 引擎 `runBattle` 会先做互斥校验，同 `mutualExclusionGroup` 的武将同队直接抛「配队非法：互斥冲突」——
 * 现只有两组：**赵云 ↔ SP赵云**、**姜维 ↔ SP姜维**（其余同名武将如关羽蜀/魏可同队，见 src/data/hero-utils.ts）。
 * L3 的候选池与成对组合必须自己先排除这些组合：否则一遇到「核心将带赵云 + 候选 SP赵云」，
 * 整轮跑批会在跑到那一项时抛出，前面的场次全白跑（用户 2026-09-28 实测就是这么卡住的）。
 */

/** 互斥组名（无组 = null） */
export function mutualGroupOf(heroId: string): string | null {
  return HERO_RECORDS[heroId]?.mutualExclusionGroup ?? null;
}

/** 两个武将是否互斥（同组不可同队） */
export function heroesMutuallyExclusive(a: string, b: string): boolean {
  const g = mutualGroupOf(a);
  return Boolean(g) && g === mutualGroupOf(b);
}

/** 队内武将组合是否合法：不重复 + 无互斥（与引擎 `validateMutualExclusion` 同一口径） */
export function teamHeroesLegal(heroIds: Array<string | undefined | null>): boolean {
  const ids = heroIds.filter((v): v is string => Boolean(v));
  if (new Set(ids).size !== ids.length) return false;
  const seen = new Set<string>();
  for (const id of ids) {
    const g = mutualGroupOf(id);
    if (!g) continue;
    if (seen.has(g)) return false;
    seen.add(g);
  }
  return true;
}

/** 当前配置的武将组合是否合法 */
export function cfgHeroesLegal(cfg: ViewCfg): boolean {
  return teamHeroesLegal(cfg.slots.map((s) => s.heroId));
}

/** 候选与给定武将列表是否互斥（返回冲突武将名；没有则 null） */
export function mutualConflictIn(heroId: string, others: Array<string | undefined>): string | null {
  const g = mutualGroupOf(heroId);
  if (!g) return null;
  for (const o of others) {
    if (o && mutualGroupOf(o) === g) return heroName(o);
  }
  return null;
}

// ─────────────────────── 结果结构 ───────────────────────

export interface MatePick {
  unit: number;
  unitName: string;
  heroId: string;
  heroName: string;
}

export interface MateOptionRow {
  /** 该「队友位组合」的一套选择：1 个位 = 单挂；2 个位 = 有序对（位 → 武将） */
  picks: MatePick[];
  /** 展示名：「陆抗 → 大营 ｜ 张机 → 前锋」（按槽位升序） */
  label: string;
  runs: number;
  /** 逐场**排序口径值**（核心将伤害；配对种子：第 i 场的种子对所有选项相同） */
  damages: number[];
  /** 排序依据值（rankBy = total → 口径场均；first3 → 口径前三回合场均） */
  score: number;
  meanCore: number;
  meanCoreFirst3: number;
  meanTotal: number;
  meanFirst3: number;
  rank: number;
  kept: boolean;
  /** 来源：单挂（只换一个位）/ 成对（两个位一起换） */
  from: 'single' | 'pair';
}

/** 队友位粗筛结果（只有一个「组」：勾了 1 个位 = 单槽组；勾了 2 个位 = 成对组） */
export interface MateGroupCoarse {
  units: number[];
  unitNames: string[];
  positions: string[];
  /** single = 只有 1 个队友位；pair = 2 个位，选项按有序对评估 */
  mode: 'single' | 'pair';
  rows: MateOptionRow[];
  /** 保留选项的指纹（武将 id 排序拼接），供组合枚举使用 */
  keptKeys: string[];
}

/** 组合粗筛榜单的一行（整队武将组合 + 3 场伤害） */
export interface MateComboRow {
  picks: MatePick[];
  label: string;
  runs: number;
  damages: number[];
  score: number;
  meanCore: number;
  meanCoreFirst3: number;
  meanTotal: number;
  meanFirst3: number;
  rank: number;
  advanced: boolean;
  /** 武将套指纹（所选武将排序后拼接）：同两位武将换个站位算同一套 */
  heroKey: string;
  /** 与第 N 名是同一套武将（换位排列，只保留成绩最好的一种进决赛）；不是重复则为 null */
  duplicateOf: number | null;
}

/** 决赛排行的一行（每套队友配置的伤害期望） */
export interface MateFinalRow {
  picks: MatePick[];
  label: string;
  runs: number;
  /** 逐场排序口径值（核心将伤害） */
  damages: number[];
  /** **排序口径**：核心将伤害期望（核心 = 全队时即全队总伤） */
  mean: number;
  meanFirst3: number;
  sd: number;
  /** 95% 置信半宽（正态近似） */
  halfWidth: number;
  min: number;
  max: number;
  median: number;
  /** 全队总伤均值（参考列，不参与排名） */
  meanTotal: number;
  /** 每将场均伤害（按伤害降序；`core` = 是否计入排序目标） */
  byUnit: Array<{ unit: number; name: string; mean: number; core: boolean }>;
  /** 该配置内各战法场均伤害（按伤害降序；只含我方造成的部分） */
  bySkill: Array<{ skillId: string; name: string; mean: number }>;
  /** 本组合决赛场次里木桩被打空（伤害被兵力截断）的场次 */
  wipedRuns: number;
  /** 粗筛榜单成绩（同组合 3 场；与决赛前 3 场同种子，可直接比） */
  coarseMean: number;
  coarseRank: number;
  /** 决赛均值相对粗筛均值的变化（比例）：3 场有多不可信 */
  coarseBias: number;
  rank: number;
}

/** 对照基线：当前队友 + **匹配位战法槽清空**（= L3 交给 L2 的起始状态） */
export interface MateBaseline {
  runs: number;
  mean: number;
  meanTotal: number;
  /** 逐场口径值（与决赛同种子，可直接比） */
  damages: number[];
}

export interface MateSimResult {
  /** 参与匹配的队友位（勾 1 个 = 单槽；勾 2 个 = 成对） */
  matchSlots: MateSlot[];
  /** 没有可匹配的队友位（核心将占满 / 队伍不足 2 人）时 true：退化为直接测评当前配置 */
  noMatchSlot: boolean;
  /** 候选武将数（已排除队内已上阵、以及与「不参与匹配的将」互斥的武将） */
  candidateCount: number;
  /** 底座池里被排除的武将数（队内已上阵） */
  candidateSkipped: number;
  /** 候选池里因**同队互斥**被剔除的武将数（赵云 ↔ SP赵云、姜维 ↔ SP姜维） */
  poolSkippedMutual: number;
  /** 粗筛 / 组合 / 决赛里因「互斥或重复上阵」被跳过的选项与组合数 */
  skippedIllegal: number;
  /** 当前配置本身就违反互斥规则（基线没跑，先让用户在左栏改掉） */
  baselineIllegal: boolean;
  /** 真跑里出现过的异常消息（前置校验之外的引擎规则；有值页面会提示） */
  errors: string[];
  /** 候选池口径文案：「上架武将」/「含下架武将」 */
  poolLabel: string;
  dummyLabel: string;
  coreUnits: number[];
  coreLabel: string;
  /** 参与匹配的队友位名（「曹植 / 陆抗」） */
  matchLabel: string;
  options: MateSimOptions;
  /** 队友位粗筛（成对模式下选项 = 有序武将对） */
  groups: MateGroupCoarse[];
  combos: MateComboRow[];
  /** 评估过的组合里有多少**不同武将套**（换位排列算同一套） */
  distinctCombos: number;
  combosCapped: boolean;
  /** 保留名单拼不出合法组合、已放开到全量候选 */
  comboFallback: boolean;
  finals: MateFinalRow[];
  baseline: MateBaseline;
  battles: number;
  /** 粗筛榜单排序与决赛排序的成对一致率（1 = 完全一致） */
  rankAgreement: number;
  wipedCombos: number;
  ms: number;
}

export interface MateProgress {
  phase: 'slot' | 'combo' | 'final';
  phaseDone: number;
  phaseTotal: number;
  battle: number;
  label: string;
}

// ─────────────────────── 主流程 ───────────────────────

interface RunSample {
  total: number;
  first3: number;
  raw: RunRaw;
}

const envOf = (opts: MateSimOptions) => ({
  maxRounds: opts.maxRounds,
  swapSides: opts.swapSides,
  baseSeed: opts.baseSeed,
  /** 木桩不还手（不放战法、不普攻）——与 L2 同一靶子 */
  inertSides: ['enemy' as const],
});

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const scoreOf = (opts: MateSimOptions, core: number, coreFirst3: number): number =>
  opts.rankBy === 'first3' ? coreFirst3 : core;

/** 跑 n 场（配对种子 = baseSeed + 场次），**每场 yield 一次**（页面进度条用）。
 *  `onError`：单场抛错时记一笔并停掉这一项（互斥之类的引擎规则已被前置校验挡住，
 *  这里只是不让「跑到一半抛错」把整轮几十分钟的跑批作废）。 */
function* runBattleSteps(
  cfg: ViewCfg,
  enemyTeam: General[],
  n: number,
  opts: MateSimOptions,
  onError?: (e: unknown) => void
): Generator<RunSample, void, void> {
  try {
    const teams = ensureUniqueUnitIds(generalsOf(cfg, cfg.morale), enemyTeam);
    for (let i = 0; i < n; i += 1) {
      try {
        const raw = runOne(teams.myTeam, teams.enemyTeam, i, envOf(opts));
        yield { total: raw.myDamage, first3: first3Damage(raw), raw };
      } catch (e) {
        onError?.(e);
        return;
      }
    }
  } catch (e) {
    onError?.(e);
  }
}

/** 有序对的指纹：位 → 武将（同一位换人算不同对；两位互换也是不同对，因为站位不同） */
const pairKeyOf = (a: { unit: number; heroId: string }, b: { unit: number; heroId: string }): string =>
  [a, b].sort((x, y) => x.unit - y.unit).map((p) => `${p.unit}:${p.heroId}`).join('|');

/**
 * 枚举合法组合（守队内武将唯一）：只有一个「组」时就是保留名单本身；
 * 结构上仍按组做 DFS（与 L2 的 `legalCombos` 同构），便于以后放开多组。
 */
export function legalHeroCombos(
  groups: MateGroupCoarse[],
  cap: number,
  keptOnly = true
): Array<Array<{ unit: number; heroId: string }>> {
  if (!groups.length) return [[]];
  const lists = groups.map((g) =>
    (keptOnly ? g.rows.filter((r) => r.kept) : g.rows).map((r) => r.picks.map((p) => ({ unit: p.unit, heroId: p.heroId })))
  );
  const out: Array<Array<{ unit: number; heroId: string }>> = [];
  const cur: Array<{ unit: number; heroId: string }> = [];
  const used = new Set<string>();
  const dfs = (i: number): void => {
    if (out.length >= cap) return;
    if (i === groups.length) {
      out.push([...cur]);
      return;
    }
    for (const option of lists[i]) {
      if (option.some((p) => used.has(p.heroId))) continue;
      for (const p of option) used.add(p.heroId);
      cur.push(...option);
      dfs(i + 1);
      cur.splice(cur.length - option.length, option.length);
      for (const p of option) used.delete(p.heroId);
      if (out.length >= cap) return;
    }
  };
  dfs(0);
  return out;
}

/**
 * L3 三阶段模拟测评（生成器版）：每真跑一场就 `yield` 一次进度 ——
 * 同步版一次跑完（脚本 / 测试），异步版按步让出主线程（页面进度条）。手法同 `simExpectationSteps`。
 */
export function* simMateSteps(cfg: ViewCfg, options: Partial<MateSimOptions> = {}): Generator<MateProgress, MateSimResult, void> {
  const opts = resolveOptions({ maxRounds: cfg.rounds, ...options });
  const t0 = Date.now();
  const coreUnits = opts.coreUnits?.length
    ? [...new Set(opts.coreUnits)].filter((u) => u >= 0 && u < cfg.slots.length)
    : autoCoreUnits(cfg);
  const matchSlots = mateSlots(cfg, opts.matchUnits, coreUnits);
  const matchedUnits = matchSlots.map((s) => s.unit);
  // L3 的试跑基线：匹配位的战法槽清空（战法留 L2 配），未参与匹配的将原样保留
  const l3Base = clearSlotSkills(cfg, matchedUnits);
  // 核心将的 unitId（用于从 RunRaw 里取该将伤害）；与我方队伍同序，木桩不会撞 id
  const myGenerals = generalsOf(cfg, cfg.morale);
  const coreIds = coreUnits.map((u) => myGenerals[u]?.id).filter((id): id is string => Boolean(id));
  const coreLabel = coreLabelOf(cfg, coreUnits);
  const matchLabel = matchSlots.map((s) => s.unitName).join(' / ');
  /*
   * 候选池：底座池 − 队内已上阵 − **与「不参与匹配的将」互斥的武将**。
   * 后者是引擎的配队规则（赵云 ↔ SP赵云、姜维 ↔ SP姜维）：不先剔掉，跑到那一项就会抛「配队非法」，
   * 整轮跑批作废（用户 2026-09-28 实测卡点）。
   */
  const fixedHeroIds = cfg.slots
    .map((s, i) => (matchedUnits.includes(i) ? '' : s.heroId))
    .filter((id): id is string => Boolean(id));
  const poolAll = candidateHeroes(cfg, opts);
  const pool = poolAll.filter((id) => !mutualConflictIn(id, fixedHeroIds));
  const poolSkippedMutual = poolAll.length - pool.length;
  const basePoolSize = heroPoolBase(opts).filter((id) => HERO_RECORDS[id]).length;
  const enemyTeam = dummyTeamFromEnemy(cfg.enemy, cfg.morale, opts.dummyTroops);
  const poolLabel = opts.includeOffline ? '上架 + 下架武将' : '上架武将';
  let battle = 0;
  /** 因「同队互斥 / 重复上阵」被跳过的选项与组合数（如实上报，不是静默漏跑） */
  let skippedIllegal = 0;
  /** 真跑里出现的异常（理论上被前置校验挡住；有值就说明引擎又多了一条规则，页面上会提示） */
  const errors: string[] = [];
  const noteError = (e: unknown): void => {
    const msg = String((e as Error)?.message ?? e);
    if (!errors.includes(msg) && errors.length < 5) errors.push(msg);
  };

  /** 由逐场样本汇总出「队友位选项」的成绩行（纯函数，跑批在外面逐场 yield） */
  const rowFromSamples = (
    picks: Array<{ unit: number; heroId: string }>,
    samples: RunSample[],
    from: 'single' | 'pair'
  ): MateOptionRow => {
    const raws = samples.map((x) => x.raw);
    const damages = raws.map((raw) => coreDamageOf(raw, coreIds));
    const first3s = raws.map((raw) => coreFirst3Of(raw, coreIds));
    const info: MatePick[] = picks
      .slice()
      .sort((a, b) => a.unit - b.unit)
      .map((p) => ({ unit: p.unit, unitName: mateHeroName(cfg, p.unit), heroId: p.heroId, heroName: heroName(p.heroId) }));
    return {
      picks: info,
      label: info.map((p) => `${p.unitName} → ${p.heroName}`).join(' ｜ '),
      runs: opts.coarseRuns,
      damages,
      score: scoreOf(opts, mean(damages), mean(first3s)),
      meanCore: mean(damages),
      meanCoreFirst3: mean(first3s),
      meanTotal: mean(samples.map((x) => x.total)),
      meanFirst3: mean(samples.map((x) => x.first3)),
      rank: 0,
      kept: false,
      from,
    };
  };

  // ① 队友位粗筛的阶段场次（含 ⓪ 对照基线）：进度条按「场」推进
  const mode: 'single' | 'pair' = matchSlots.length >= 2 ? 'pair' : 'single';
  const singlePhase = matchSlots.length * pool.length * opts.coarseRuns;
  const pairPhase = mode === 'pair' ? 2 * Math.min(opts.pairCarriers, pool.length) * pool.length * opts.coarseRuns : 0;
  const slotPhaseTotal = opts.finalRuns + singlePhase + pairPhase;
  let slotDone = 0;

  // ⓪ 对照基线：当前队友 + 匹配位战法槽清空（= L3 交给 L2 的起始状态）
  //   当前配置本身就违反互斥规则时不跑（引擎会抛错），改为如实标记 baselineIllegal
  const baselineLegal = cfgHeroesLegal(l3Base);
  const baselineSamples: RunSample[] = [];
  if (baselineLegal) {
    for (const sample of runBattleSteps(l3Base, enemyTeam, opts.finalRuns, opts, noteError)) {
      baselineSamples.push(sample);
      slotDone += 1;
      battle += 1;
      yield {
        phase: 'slot',
        phaseDone: slotDone,
        phaseTotal: slotPhaseTotal,
        battle,
        label: `对照基线（当前队友 · 匹配位战法槽已清空）第 ${baselineSamples.length}/${opts.finalRuns} 场`,
      };
    }
  } else {
    slotDone += opts.finalRuns;
  }
  const baselineDamages = baselineSamples.map((x) => coreDamageOf(x.raw, coreIds));
  const baseline: MateBaseline = {
    runs: baselineLegal ? opts.finalRuns : 0,
    mean: mean(baselineDamages),
    meanTotal: mean(baselineSamples.map((x) => x.total)),
    damages: baselineDamages,
  };

  // ② 队友位粗筛（单挂一圈 / 成对评估）
  const groups: MateGroupCoarse[] = [];
  if (matchSlots.length) {

    // ①a 单挂一圈：单槽模式的正榜；成对模式里给每个位挑「搭子基准」+ 留单挂出口
    const singleRowsByUnit = new Map<number, MateOptionRow[]>();
    for (const ms of matchSlots) {
      const rows: MateOptionRow[] = [];
      for (const heroId of pool) {
        const variant = withSlotHero(l3Base, ms.unit, heroId);
        // 该候选与「留在队里的将」（含另一个队友位的当前武将）互斥 / 重复 → 跳过（只推进度）
        if (!cfgHeroesLegal(variant)) {
          slotDone += opts.coarseRuns;
          skippedIllegal += 1;
          continue;
        }
        const samples: RunSample[] = [];
        for (const sample of runBattleSteps(variant, enemyTeam, opts.coarseRuns, opts, noteError)) {
          samples.push(sample);
          slotDone += 1;
          battle += 1;
          yield {
            phase: 'slot',
            phaseDone: slotDone,
            phaseTotal: slotPhaseTotal,
            battle,
            label: `队友粗筛 ${ms.unitName}（${ms.position}）：${heroName(heroId)}（${samples.length}/${opts.coarseRuns} 场）`,
          };
        }
        rows.push(rowFromSamples([{ unit: ms.unit, heroId }], samples, 'single'));
      }
      rows.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
      rows.forEach((r, i) => {
        r.rank = i + 1;
      });
      singleRowsByUnit.set(ms.unit, rows);
    }

    let rows: MateOptionRow[];
    if (mode === 'single') {
      const only = singleRowsByUnit.get(matchSlots[0].unit) ?? [];
      only.forEach((r, i) => {
        r.kept = i < opts.unitKeep;
      });
      rows = only;
    } else {
      // ①b 成对粗筛：两个位各作一次「基准方向」
      //    位A 基准 × 全部候选（候选落位B） + 位B 基准 × 全部候选（候选落位A）
      //    → 「谁站大营 / 谁站前锋」两种排法都被评到；同一位换人 / 两个位互换都是不同的对（站位不同）。
      const [slotA, slotB] = matchSlots;
      const seenPair = new Set<string>();
      const pairRows: MateOptionRow[] = [];
      for (const carrierSlot of [slotA, slotB]) {
        const otherSlot = carrierSlot.unit === slotA.unit ? slotB : slotA;
        const carriers = (singleRowsByUnit.get(carrierSlot.unit) ?? []).slice(0, opts.pairCarriers);
        for (const carrier of carriers) {
          const carrierHero = carrier.picks[0].heroId;
          for (const cand of pool) {
            // 自己配自己：不合法（队内武将唯一）→ 只推进度
            if (cand === carrierHero) {
              slotDone += opts.coarseRuns;
              continue;
            }
            const key = pairKeyOf({ unit: carrierSlot.unit, heroId: carrierHero }, { unit: otherSlot.unit, heroId: cand });
            if (seenPair.has(key)) {
              slotDone += opts.coarseRuns;
              continue;
            }
            seenPair.add(key);
            const variant = withHeroPicks(l3Base, [
              { unit: carrierSlot.unit, heroId: carrierHero },
              { unit: otherSlot.unit, heroId: cand },
            ]);
            // 互斥（赵云 ↔ SP赵云：基准与候选撞组）→ 跳过这一对，只推进度
            if (!cfgHeroesLegal(variant)) {
              slotDone += opts.coarseRuns;
              skippedIllegal += 1;
              continue;
            }
            const samples: RunSample[] = [];
            for (const sample of runBattleSteps(variant, enemyTeam, opts.coarseRuns, opts, noteError)) {
              samples.push(sample);
              slotDone += 1;
              battle += 1;
              yield {
                phase: 'slot',
                phaseDone: slotDone,
                phaseTotal: slotPhaseTotal,
                battle,
                label: `队友配对 ${carrierSlot.position} ${heroName(carrierHero)} + ${otherSlot.position} ${heroName(cand)}（${
                  samples.length
                }/${opts.coarseRuns} 场）`,
              };
            }
            pairRows.push(
              rowFromSamples(
                [
                  { unit: carrierSlot.unit, heroId: carrierHero },
                  { unit: otherSlot.unit, heroId: cand },
                ],
                samples,
                'pair'
              )
            );
          }
        }
      }
      // 单挂出口：只换一个位、另一位保持当前武将（各取前列，总数 ≤ PAIR_SINGLE_EXITS）
      const singlePool = [...(singleRowsByUnit.get(slotA.unit) ?? []), ...(singleRowsByUnit.get(slotB.unit) ?? [])];
      singlePool.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
      const singlesToKeep = Math.max(0, Math.min(PAIR_SINGLE_EXITS, opts.unitKeep - 1));
      const merged = [...pairRows, ...singlePool.slice(0, singlesToKeep)];
      merged.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
      merged.forEach((r, i) => {
        r.rank = i + 1;
        r.kept = i < opts.unitKeep;
      });
      rows = merged;
    }

    groups.push({
      units: matchedUnits,
      unitNames: matchSlots.map((s) => s.unitName),
      positions: matchSlots.map((s) => s.position),
      mode,
      rows,
      keptKeys: rows.filter((r) => r.kept).map((r) => r.picks.map((p) => p.heroId).sort().join('+')),
    });
  }

  // ② 组合粗筛榜单：保留选项拼成整队武将组合（守队内唯一）→ 每个组合 coarseRuns 场 → 排榜单
  let comboPicks = matchSlots.length ? legalHeroCombos(groups, opts.maxCombos, true) : [[]];
  let comboFallback = false;
  if (matchSlots.length && comboPicks.length === 0) {
    comboPicks = legalHeroCombos(groups, opts.maxCombos, false);
    comboFallback = comboPicks.length > 0;
  }
  const combosCapped = matchSlots.length > 0 && comboPicks.length >= opts.maxCombos;
  const combos: MateComboRow[] = [];
  const comboPhaseTotal = comboPicks.length * opts.coarseRuns;
  let comboDone = 0;
  for (const picks of comboPicks) {
    const variant = picks.length ? withHeroPicks(l3Base, picks) : l3Base;
    // 保留名单理论上已合法；这里再兜一层（例如以后叠了新的配队规则）
    if (!cfgHeroesLegal(variant)) {
      comboDone += opts.coarseRuns;
      skippedIllegal += 1;
      continue;
    }
    const samples: RunSample[] = [];
    for (const sample of runBattleSteps(variant, enemyTeam, opts.coarseRuns, opts, noteError)) {
      samples.push(sample);
      comboDone += 1;
      battle += 1;
      yield {
        phase: 'combo',
        phaseDone: comboDone,
        phaseTotal: comboPhaseTotal,
        battle,
        label: `组合粗筛 ${combos.length + 1}/${comboPicks.length} 第 ${samples.length}/${opts.coarseRuns} 场`,
      };
    }
    const raws = samples.map((x) => x.raw);
    const damages = raws.map((raw) => coreDamageOf(raw, coreIds));
    const first3s = raws.map((raw) => coreFirst3Of(raw, coreIds));
    const picksInfo: MatePick[] = picks
      .slice()
      .sort((a, b) => a.unit - b.unit)
      .map((p) => ({ unit: p.unit, unitName: mateHeroName(cfg, p.unit), heroId: p.heroId, heroName: heroName(p.heroId) }));
    combos.push({
      picks: picksInfo,
      label: picksInfo.length ? picksInfo.map((p) => `${p.unitName}·${p.heroName}`).join(' + ') : '（当前配置）',
      runs: opts.coarseRuns,
      damages,
      score: scoreOf(opts, mean(damages), mean(first3s)),
      meanCore: mean(damages),
      meanCoreFirst3: mean(first3s),
      meanTotal: mean(samples.map((x) => x.total)),
      meanFirst3: mean(samples.map((x) => x.first3)),
      rank: 0,
      advanced: false,
      heroKey: picksInfo.map((p) => p.heroId).sort().join('+'),
      duplicateOf: null,
    });
  }
  combos.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  // 进决赛按「不同武将套」取前 coarseTop：同两位武将换个站位常打出接近的结果，
  // 同一套武将只留成绩最好的一种排法（站位），其余标注 duplicateOf（与 L2 的技能套去重同构）。
  const firstRankByKey = new Map<string, number>();
  let advancedCount = 0;
  combos.forEach((row, i) => {
    row.rank = i + 1;
    const seen = firstRankByKey.get(row.heroKey);
    if (seen !== undefined) {
      row.duplicateOf = seen;
      row.advanced = false;
      return;
    }
    firstRankByKey.set(row.heroKey, row.rank);
    if (advancedCount < opts.coarseTop) {
      row.advanced = true;
      advancedCount += 1;
    }
  });
  const distinctCombos = firstRankByKey.size;
  const advancing = combos.filter((c) => c.advanced);

  // ③ 决赛：榜单前 coarseTop 套 × finalRuns 场 → 伤害期望排行
  const finals: MateFinalRow[] = [];
  const finalPhaseTotal = advancing.length * opts.finalRuns;
  let finalDone = 0;
  for (const combo of advancing) {
    const picks = combo.picks.map((p) => ({ unit: p.unit, heroId: p.heroId }));
    const variant = picks.length ? withHeroPicks(l3Base, picks) : l3Base;
    if (!cfgHeroesLegal(variant)) {
      finalDone += opts.finalRuns;
      skippedIllegal += 1;
      continue;
    }
    const teams = ensureUniqueUnitIds(generalsOf(variant, cfg.morale), enemyTeam);
    const myIds = teams.myTeam.map((g) => g.id);
    const nameById = new Map(teams.myTeam.map((g) => [g.id, g.name]));
    const damages: number[] = [];
    const first3s: number[] = [];
    const raws: RunRaw[] = [];
    for (let i = 0; i < opts.finalRuns; i += 1) {
      let raw: RunRaw;
      try {
        raw = runOne(teams.myTeam, teams.enemyTeam, i, envOf(opts));
      } catch (e) {
        noteError(e);
        finalDone += opts.finalRuns - i;
        break;
      }
      raws.push(raw);
      damages.push(coreDamageOf(raw, coreIds));
      first3s.push(coreFirst3Of(raw, coreIds));
      finalDone += 1;
      battle += 1;
      yield {
        phase: 'final',
        phaseDone: finalDone,
        phaseTotal: finalPhaseTotal,
        battle,
        label: `决赛 ${finals.length + 1}/${advancing.length} 第 ${i + 1}/${opts.finalRuns} 场：${combo.label}`,
      };
    }
    if (!damages.length) continue; // 整项都跑不出来（异常）→ 不进排行

    const unitAcc = new Map<string, number>();
    const skillAcc = new Map<string, number>();
    for (const raw of raws) {
      for (const [id, v] of raw.perUnit) if (myIds.includes(id)) unitAcc.set(id, (unitAcc.get(id) ?? 0) + v.damage);
      for (const [sid, v] of raw.perSkillMine) skillAcc.set(sid, (skillAcc.get(sid) ?? 0) + v);
    }
    const coreIdSet = new Set(coreIds);
    const byUnit = myIds
      .map((id) => ({
        unit: teams.myTeam.findIndex((g) => g.id === id),
        name: nameById.get(id) ?? id,
        mean: (unitAcc.get(id) ?? 0) / opts.finalRuns,
        core: coreIdSet.has(id),
      }))
      .sort((a, b) => b.mean - a.mean);
    const bySkill = [...skillAcc.entries()]
      .map(([skillId, sum]) => ({ skillId, name: skillName(skillId), mean: sum / opts.finalRuns }))
      .sort((a, b) => b.mean - a.mean);

    const m = mean(damages);
    finals.push({
      picks: combo.picks,
      label: combo.label,
      runs: opts.finalRuns,
      damages,
      mean: m,
      meanFirst3: mean(first3s),
      meanTotal: mean(raws.map((r) => r.myDamage)),
      sd: sd(damages),
      halfWidth: damages.length > 1 ? (1.96 * sd(damages)) / Math.sqrt(damages.length) : 0,
      min: damages.length ? Math.min(...damages) : 0,
      max: damages.length ? Math.max(...damages) : 0,
      median: median(damages),
      byUnit,
      bySkill,
      wipedRuns: raws.filter((r) => r.enemyFinalTroops.some((t) => t <= 0)).length,
      coarseMean: combo.meanCore,
      coarseRank: combo.rank,
      coarseBias: combo.meanCore ? (m - combo.meanCore) / combo.meanCore : 0,
      rank: 0,
    });
  }
  finals.sort((a, b) => b.mean - a.mean);
  finals.forEach((row, i) => {
    row.rank = i + 1;
  });

  return {
    matchSlots,
    noMatchSlot: matchSlots.length === 0,
    candidateCount: matchSlots.length ? pool.length : 0,
    candidateSkipped: Math.max(0, basePoolSize - poolAll.length),
    poolSkippedMutual,
    skippedIllegal,
    baselineIllegal: !baselineLegal,
    errors,
    poolLabel,
    dummyLabel: dummyLabel(cfg.enemy, opts.dummyTroops),
    coreUnits,
    coreLabel,
    matchLabel,
    options: opts,
    groups,
    combos,
    distinctCombos,
    combosCapped,
    comboFallback,
    finals,
    baseline,
    battles: battle,
    rankAgreement: pairAgreement(
      finals.map((f) => f.coarseMean),
      finals.map((f) => f.mean)
    ),
    wipedCombos: finals.filter((f) => f.wipedRuns > 0).length,
    ms: Date.now() - t0,
  };
}

/** 战法名（缺注册表回退 id） */
export function skillName(skillId: string): string {
  return SKILL_REGISTRY[skillId]?.name ?? skillId;
}

/** 同步跑完（脚本 / 测试） */
export function runSimMate(cfg: ViewCfg, options: Partial<MateSimOptions> = {}): MateSimResult {
  const gen = simMateSteps(cfg, options);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

export interface MateSimAsyncOptions extends Partial<MateSimOptions> {
  /** 每 N 个进度事件让出一次主线程（页面用） */
  yieldEvery?: number;
  onProgress?: (p: MateProgress) => void;
}

/** 异步跑完（页面：分片让出主线程 + 进度条） */
export async function runSimMateAsync(cfg: ViewCfg, options: MateSimAsyncOptions = {}): Promise<MateSimResult> {
  const gen = simMateSteps(cfg, options);
  const every = Math.max(1, Math.floor(options.yieldEvery ?? 25));
  let n = 0;
  let step = gen.next();
  while (!step.done) {
    options.onProgress?.(step.value);
    n += 1;
    if (n % every === 0) await new Promise((res) => setTimeout(res, 0));
    step = gen.next();
  }
  return step.value;
}

/** 预计真跑场次（页面开跑前显示）：上界（自己配自己 / 重复对会被跳过，实际只会更少） */
export function estimateMateBattles(cfg: ViewCfg, options: Partial<MateSimOptions> = {}): number {
  const opts = resolveOptions({ maxRounds: cfg.rounds, ...options });
  const coreUnits = opts.coreUnits?.length
    ? [...new Set(opts.coreUnits)].filter((u) => u >= 0 && u < cfg.slots.length)
    : autoCoreUnits(cfg);
  const slots = mateSlots(cfg, opts.matchUnits, coreUnits);
  const matchedUnits = slots.map((s) => s.unit);
  // 与跑批同一口径：先剔掉与「不参与匹配的将」互斥的候选（赵云 ↔ SP赵云），再估场次
  const fixedHeroIds = cfg.slots
    .map((s, i) => (matchedUnits.includes(i) ? '' : s.heroId))
    .filter((id): id is string => Boolean(id));
  const pool = candidateHeroes(cfg, opts).filter((id) => !mutualConflictIn(id, fixedHeroIds)).length;
  const baselinePhase = opts.finalRuns;
  if (!slots.length) return baselinePhase + opts.coarseRuns + opts.finalRuns;
  const singlePhase = slots.length * pool * opts.coarseRuns;
  const pairPhase =
    slots.length >= 2 ? 2 * Math.min(opts.pairCarriers, pool) * pool * opts.coarseRuns : 0;
  // 组合数上界：一个「组」的保留名单最多 unitKeep 条（自己配自己 / 重复对只会让实际更少）→ 再被 maxCombos 截断
  const comboUpper = Math.min(opts.maxCombos, opts.unitKeep);
  const comboPhase = comboUpper * opts.coarseRuns;
  const finalPhase = Math.min(opts.coarseTop, comboUpper) * opts.finalRuns;
  return baselinePhase + singlePhase + pairPhase + comboPhase + finalPhase;
}
