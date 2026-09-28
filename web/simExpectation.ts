/**
 * L2 伤害期望模型 · 模拟测评（两阶段真引擎）
 * ---------------------------------------------------------------------------
 * 目的（用户 2026-09-28 口径）：**算出「这支队伍带哪些战法伤害期望最高」**。
 * 这里是**伤害期望**模型，不碰胜负——胜率 / 平局 / 兵力优势是 L4（`web/battleSim.ts` + `battle-sim.html`）的事。
 *
 * 靶子（要求 1）：敌方只有**不还手的木桩**——不放战法、不普攻（引擎侧 `BattleConfig.inertSides = ['enemy']`），
 * 只挨打；面板的「目标防御 / 目标谋略 / 目标兵种」+ 木桩兵力决定靶子属性。
 * 我方打在木桩身上的 DoT 与「目标下次行动前」延迟伤害照常结算（引擎出口放在 DoT 之后）。
 *
 * 匹配（要求 2）：只填空槽——**用户已指定战法的槽位原样保留**（可以先把空槽改成自定义防御体系战法再评测），
 * 候选池 = 全部可学战法 − 队内已占用（守全队战法唯一）。三阶段：
 *   ① 逐槽粗筛：每个空槽位 × 每个候选战法，在「基线配置 + 该槽位放该战法」上真跑 `coarseRuns`（默认 **3**）场
 *      → 每槽位保留前 `slotKeep`（默认 10）个战法；
 *   ② 组合粗筛榜单：保留战法拼成整队组合（守唯一）后，每个组合真跑 `coarseRuns` 场 → 按伤害排**榜单**
 *      → 前 `coarseTop`（默认 **10**）个组合进决赛；
 *   ③ 决赛：每个入决赛组合真跑 `finalRuns`（默认 **20**，**低于 20 一律抬回 20**）场 → 汇总出伤害期望并排行。
 *
 * 输出与自检：
 *   · 每套配置：场均期望 / 标准差 / 95% 半宽 / 单场区间 / 前三回合 / 每将 / 每战法；
 *   · 「3 场粗筛 vs 20 场决赛」偏差 + 排序成对一致率（`rankAgreement`）→ 3 场只能粗筛淘汰，不能定名次；
 *   · 木桩被打空的场次（`wipedRuns`）——被截断就说明木桩兵力给小了，期望会偏低；
 *   · 旧解析值对照（`analyticTotal` / `deltaTotal`）：解析模型按抽象目标模板算且不含控制 / 规避 / 兵力截断。
 *
 * 复现：种子 = `baseSeed + 场次`（同一场次对所有候选一致 → 配对比较），奇数场交换场地。页面走
 * `runSimExpectationAsync`（分片让出主线程），脚本 / 测试走同步版。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { ensureUniqueUnitIds } from '../src/engine/combat';
import type { General, Position, TroopType } from '../src/engine/types';
import { DEFAULT_ENV, runOne, type RunRaw } from './battleSim';
import { HERO_RECORDS, baseStatsAt } from './heroes';
import { windowTotals, parseSkill } from './roundModel';
import { computeResult, generalsOf, LEARNABLE_SKILL_IDS, SKILL_SLOTS, type ViewCfg } from './teamConfig';

// ─────────────────────────── 参数 ───────────────────────────

export interface SimExpectOptions {
  /** 粗筛场次（默认 3）：每个「空槽位 × 候选战法」与每个「组合」各跑几场 */
  coarseRuns: number;
  /** 决赛场次（默认 20，**下限 20**）：每个入决赛组合跑几场 */
  finalRuns: number;
  /**
   * 每个将粗筛后保留的选项数（默认 10；双槽将的选项 = 成对组合）→ 进入组合粗筛。
   */
  unitKeep: number;
  /**
   * 双槽将的配对基准数（默认 10）：双槽将按**成对**评估，但全量 P² 对太贵，
   * 故取「单槽成绩前 N 名」当搭子基准，与**全部候选**各配一次（N × P 对）。
   * 这样任何候选（含击势这类「必须带满槽才见效」的增伤战法）都有机会以「搭档」身份被组合评估，
   * 不会被单挂成绩误杀。调小更快、调大更全。
   */
  pairCarriers: number;
  /** 组合粗筛榜单前 N 名进决赛（默认 **32**：用户 2026-09-28 口径） */
  coarseTop: number;
  /** 组合粗筛最多评估多少个组合（默认 1000；组合太多时按各槽位粗筛名次优先展开） */
  maxCombos: number;
  /** 排序口径的时间窗（默认整局；可切前三回合） */
  rankBy: 'total' | 'first3';
  /**
   * **排序目标 = 核心将的伤害期望**（用户 2026-09-28 定的口径）：只统计这些将打出的伤害，可多选（求和）。
   * 不给（或空数组）时自动识别核心将（主战法带对敌伤害段且属性最高者）。
   * 为什么不用「全队总伤」：辅助战法的强度不随施法者变（实测计险远近放谁都是 44,699），
   * 总伤口径对「辅助战法放谁」完全无感 → 大量并列 → 搜索随手挑一个，于是出现「主C带辅助、辅助带输出」。
   */
  coreUnits?: number[];
  /** 参与匹配的将（缺省 = 所有带空槽的将）；其余将的战法原样保留、不参与搜索（对齐 L3 的 `unitIdxs`） */
  matchUnits?: number[];
  /**
   * **参与匹配的槽位**（`"${unit}-${slot}"`；缺省 = 上面 `matchUnits` 范围内的全部空槽）。
   * 用户 2026-09-28 口径：勾选要搜的具体槽位——「我只想搜两个队友的槽 2」这种要求，
   * 按将过滤做不到（勾了将 = 它的**所有**空槽都进搜索）。给了 `matchSlotKeys` 就以它为准，
   * `matchUnits` 退化为「这些槽位所属的将」（标签用）。
   */
  matchSlotKeys?: string[];
  /** 决赛场次上限（自适应加跑用；默认 200）。决赛低于 `FINAL_RUNS_MIN` 仍一律抬回 20 */
  finalRunsMax: number;
  /**
   * **区间重叠时自动加跑**（默认开）：初赛 `finalRuns` 场后，与榜首 95% 区间重叠的组合
   * （含榜首自己）每次加 `adaptiveStep` 场继续跑，直到区间分开或到达 `finalRunsMax`。
   * 为什么需要：3 场粗筛 + 20 场决赛的半宽常有 ±2~5%，而榜首与第二名的真实差距可能只有 1~2%
   * —— 不精算就会把「噪声第一」当结论（用户 2026-09-28 报的「掠敌之利排第一」就是这个）。
   */
  adaptiveFinals: boolean;
  /** 自适应加跑的步长（默认 20 场/次） */
  adaptiveStep: number;
  /** 木桩单只兵力（默认 150000）：太小会把我们的伤害截断，期望偏低 */
  dummyTroops: number;
  /** 候选战法池覆盖（缺省 = 全部可学战法）；测试 / 脚本收窄用 */
  candidateIds?: string[];
  /** 回合数（默认 8；页面跟随面板「回合数」） */
  maxRounds: number;
  baseSeed: number;
  swapSides: boolean;
}

/** 决赛场次下限（用户口径：决赛「至少 20 场」） */
export const FINAL_RUNS_MIN = 20;
/** 粗筛场次缺省（用户口径：粗筛 3 场） */
export const COARSE_RUNS_DEFAULT = 3;
/** 木桩单只兵力缺省：伤害公式不看目标兵力（只有 `Math.min(伤害, 剩余兵力)` 的截断），
 *  所以给足兵力只是为了「8 回合打不完」——实测本库强队 8 回合可打 8~9 万，3 只 ×15 万足够不截断。 */
export const DUMMY_TROOPS_DEFAULT = 150000;
/** 进决赛的组合数缺省（用户 2026-09-28：**32 支**） */
export const COARSE_TOP_DEFAULT = 32;
/** 决赛场次上限缺省（自适应加跑最多跑到这里；用户 2026-09-28：默认 200） */
export const FINAL_RUNS_MAX = 200;
/** 自适应加跑步长（场/次） */
export const ADAPTIVE_STEP = 20;

export const SIM_EXPECT_DEFAULTS: SimExpectOptions = {
  coarseRuns: COARSE_RUNS_DEFAULT,
  finalRuns: FINAL_RUNS_MIN,
  unitKeep: COARSE_TOP_DEFAULT,
  pairCarriers: 10,
  coarseTop: COARSE_TOP_DEFAULT,
  maxCombos: 1000,
  rankBy: 'total',
  dummyTroops: DUMMY_TROOPS_DEFAULT,
  maxRounds: DEFAULT_ENV.maxRounds,
  baseSeed: DEFAULT_ENV.baseSeed,
  swapSides: DEFAULT_ENV.swapSides,
  finalRunsMax: FINAL_RUNS_MAX,
  adaptiveFinals: true,
  adaptiveStep: ADAPTIVE_STEP,
};

/** 木桩基准（面板给防御 / 谋略 / 兵种，其余取基准值） */
export const DUMMY_SPEC = { attack: 100, speed: 50, name: '木桩' } as const;

const CFG_POSITIONS: Position[] = ['大营', '中军', '前锋'];

function resolveOptions(opts: Partial<SimExpectOptions> = {}): SimExpectOptions {
  // 显式传 undefined 的键当作「没传」（否则 Math.floor(undefined) = NaN 会把整批参数毒掉）
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) clean[k] = v;
  const merged = { ...SIM_EXPECT_DEFAULTS, ...(clean as Partial<SimExpectOptions>) };
  return {
    ...merged,
    coarseRuns: Math.max(1, Math.floor(merged.coarseRuns)),
    // 决赛「至少 20 场」：低配值一律抬回下限，不静默降标准
    finalRuns: Math.max(FINAL_RUNS_MIN, Math.floor(merged.finalRuns)),
    unitKeep: Math.max(1, Math.floor(merged.unitKeep ?? 10)),
    pairCarriers: Math.max(1, Math.floor(merged.pairCarriers ?? 10)),
    coarseTop: Math.max(1, Math.floor(merged.coarseTop)),
    maxCombos: Math.max(1, Math.floor(merged.maxCombos)),
    dummyTroops: Math.max(1, Math.floor(merged.dummyTroops)),
    maxRounds: Math.max(1, Math.floor(merged.maxRounds)),
    finalRunsMax: Math.max(
      Math.max(FINAL_RUNS_MIN, Math.floor(merged.finalRuns)),
      Math.floor(merged.finalRunsMax ?? FINAL_RUNS_MAX)
    ),
    adaptiveStep: Math.max(1, Math.floor(merged.adaptiveStep ?? ADAPTIVE_STEP)),
    adaptiveFinals: merged.adaptiveFinals !== false,
  };
}

// ─────────────────────── 槽位与候选 ───────────────────────

export interface SimSlot {
  unit: number;
  slot: number;
  unitName: string;
}

/** 槽位所属武将名（取不到记录时回退 id） */
function heroNameOf(cfg: ViewCfg, unit: number): string {
  const heroId = cfg.slots[unit]?.heroId ?? '';
  return HERO_RECORDS[heroId]?.name ?? heroId ?? `#${unit}`;
}

/**
 * 参与匹配的空槽位：`skillIds[k]` 为空的位置。
 * 宽度取 `max(SKILL_SLOTS, skillIds.length)`：面板配置是「主战法 + 2 个可学战法」（长度 ≤ 2），
 * 而截图识别的配置把主战法也记在 `skillIds[0]`（长度 3）——只按 `SKILL_SLOTS` 扫会漏掉最后一格。
 * `matchUnits` 给了就只算这些将的空槽（其余将的战法原样保留、不参与搜索，对齐 L3 的 `unitIdxs`）；
 * `matchSlotKeys` 给了就再收窄到这些**具体槽位**（用户 2026-09-28 口径：勾哪个槽就只搜哪个槽）——
 * 注意 `[]`（显式给空数组）表示**一个槽都不搜**（页面「清空」= 只测评当前配置），与 `undefined`（不限）不同。
 */
export function simSlots(cfg: ViewCfg, matchUnits?: number[], matchSlotKeys?: string[]): SimSlot[] {
  const allowed = matchUnits?.length ? new Set(matchUnits) : undefined;
  const slotKeys = matchSlotKeys === undefined ? undefined : new Set(matchSlotKeys);
  const out: SimSlot[] = [];
  cfg.slots.forEach((s, unit) => {
    if (allowed && !allowed.has(unit)) return;
    const width = Math.max(SKILL_SLOTS, s.skillIds.length);
    for (let slot = 0; slot < width; slot += 1) {
      if (s.skillIds[slot]) continue;
      if (slotKeys && !slotKeys.has(slotKey(unit, slot))) continue;
      out.push({ unit, slot, unitName: heroNameOf(cfg, unit) });
    }
  });
  return out;
}

/** 槽位指纹：页面勾选项与 `matchSlotKeys` 共用（`"${unit}-${slot}"`） */
export function slotKey(unit: number, slot: number): string {
  return `${unit}-${slot}`;
}

/** 解析槽位指纹；格式不对返回 null */
export function parseSlotKey(key: string): { unit: number; slot: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(key);
  if (!m) return null;
  return { unit: Number(m[1]), slot: Number(m[2]) };
}

/** 槽位指纹列表 → 所属将的下标（升序、去重）——参与匹配的将标签用 */
export function unitsOfSlotKeys(keys: string[]): number[] {
  const units = keys.map((k) => parseSlotKey(k)?.unit).filter((u): u is number => u !== undefined);
  return [...new Set(units)].sort((a, b) => a - b);
}

/**
 * 自动识别核心将：**主战法带对敌伤害段或 DoT** 的将里，取「攻击 + 谋略」最高者；都没有则取 0 号位。
 * 用户可在页面上按槽位勾「核心位」覆盖这个默认。
 */
export function autoCoreUnits(cfg: ViewCfg): number[] {
  const damageMains: number[] = [];
  cfg.slots.forEach((s, unit) => {
    const mainId = HERO_RECORDS[s.heroId]?.mainSkillId;
    const skill = mainId ? SKILL_REGISTRY[mainId] : undefined;
    if (!skill) return;
    const parsed = parseSkill(skill, cfg.morale);
    if (parsed.segments.length || parsed.dots.length) damageMains.push(unit);
  });
  const pool = damageMains.length ? damageMains : cfg.slots.map((_, i) => i);
  const stats = (unit: number): number => {
    const rec = HERO_RECORDS[cfg.slots[unit]?.heroId ?? ''];
    if (!rec) return 0;
    const base = baseStatsAt(rec, cfg.slots[unit]?.level ?? 40);
    return base.attack + base.strategy;
  };
  const best = pool.reduce((a, u) => (stats(u) > stats(a) ? u : a), pool[0] ?? 0);
  return pool.length ? [best] : [];
}

/** 核心将显示名（「陆抗」或「陆抗 / 曹植」；空 = 全队） */
export function coreLabelOf(cfg: ViewCfg, coreUnits: number[]): string {
  if (!coreUnits.length) return '全队';
  return coreUnits.map((u) => heroNameOf(cfg, u)).join(' / ');
}

/** 队内已占用的战法（含主战法、含 `SKILL_SLOTS` 之外的多余槽位）→ 候选池要排除 */
export function usedSkillIds(cfg: ViewCfg): Set<string> {
  const used = new Set<string>();
  cfg.slots.forEach((s) => {
    s.skillIds.forEach((id) => {
      if (id) used.add(id);
    });
    const main = HERO_RECORDS[s.heroId]?.mainSkillId;
    if (main) used.add(main);
  });
  return used;
}

/** 候选战法池：全部可学战法 − 队内已占用；`candidateIds` 可覆盖底座（测试 / 脚本） */
export function candidateSkills(cfg: ViewCfg, opts: Partial<SimExpectOptions> = {}): string[] {
  const used = usedSkillIds(cfg);
  const base = opts.candidateIds ?? LEARNABLE_SKILL_IDS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of base) {
    if (used.has(id) || seen.has(id) || !SKILL_REGISTRY[id]) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 战法名（缺注册表回退 id） */
export function skillName(id: string): string {
  return SKILL_REGISTRY[id]?.name ?? id;
}

/** 把某个空槽位填上战法（返回新 cfg；其余槽位原样保留） */
export function withSlotSkill(cfg: ViewCfg, unit: number, slot: number, skillId: string): ViewCfg {
  return {
    ...cfg,
    enemy: { ...cfg.enemy },
    manual: { ...cfg.manual },
    slots: cfg.slots.map((s, i) => {
      if (i !== unit) return { ...s, skillIds: [...s.skillIds] };
      const skillIds = [...s.skillIds];
      while (skillIds.length < slot) skillIds.push('');
      skillIds[slot] = skillId;
      return { ...s, skillIds };
    }),
  };
}

/** 一次填多个槽位（组合用） */
export function withPicks(cfg: ViewCfg, picks: Array<{ unit: number; slot: number; skillId: string }>): ViewCfg {
  return picks.reduce((acc, p) => withSlotSkill(acc, p.unit, p.slot, p.skillId), cfg);
}

// ─────────────────────── 木桩（不还手靶子）───────────────────────

/**
 * 木桩对手：三只同模板单位（防御 / 谋略 / 兵种取面板「目标」栏），**无战法、不还手**。
 * 「不还手」由 `runBattleSteps` 传 `inertSides: ['enemy']` 落实（引擎视角随交换场地翻转，见 `runOne`）。
 */
export function dummyTeamFromEnemy(
  enemy: ViewCfg['enemy'],
  morale: number,
  troops: number = DUMMY_TROOPS_DEFAULT
): General[] {
  return CFG_POSITIONS.map((position, i) => ({
    id: `dummy-${i}`,
    name: DUMMY_SPEC.name,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: enemy.troopType as TroopType,
    position,
    attack: DUMMY_SPEC.attack,
    defense: enemy.defense,
    strategy: enemy.strategy,
    speed: DUMMY_SPEC.speed,
    attackRange: enemy.troopType === 'archer' ? 3 : 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: enemy.morale ?? morale,
  }));
}

/** 木桩标签（页面 / 报告共用一套文案） */
export function dummyLabel(enemy: ViewCfg['enemy'], troops: number): string {
  return `不还手木桩 ×3（防 ${enemy.defense} / 谋 ${enemy.strategy} / 兵力 ${troops}）`;
}

// ─────────────────────── 统计 ───────────────────────

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

/** 我方前 3 回合总伤（逐回合拆分，见 `RunRaw.myDamageByRound`） */
export const first3Damage = (raw: RunRaw): number => raw.myDamageByRound.slice(0, 3).reduce((a, b) => a + b, 0);

/** 核心将伤害（排序目标）：给定核心将的 unitId 列表，累加这些将打出的伤害 */
export const coreDamageOf = (raw: RunRaw, coreIds: string[]): number =>
  coreIds.reduce((a, id) => a + (raw.perUnit.get(id)?.damage ?? 0), 0);

/** 核心将前三回合伤害（同一排序目标的前 3 回合口径） */
export const coreFirst3Of = (raw: RunRaw, coreIds: string[]): number =>
  coreIds.reduce((a, id) => a + (raw.perUnitDamageByRound.get(id) ?? []).slice(0, 3).reduce((x, y) => x + y, 0), 0);

export interface UnitOptionRow {
  /** 该将这一套选择：槽 → 战法（双槽将 = 两个槽一起，槽位可能只填一个 = 单挂） */
  picks: Array<{ slot: number; skillId: string; skillName: string }>;
  /** 展示名：「击势 + 一骑当千」/「突进」 */
  label: string;
  runs: number;
  /** 逐场**排序口径值**（核心将伤害；配对种子：第 i 场的种子对所有选项相同） */
  damages: number[];
  /** 排序依据值（rankBy = total → 口径场均；first3 → 口径前三回合场均） */
  score: number;
  /** 排序口径的整局 / 前三回合场均（核心将伤害） */
  meanCore: number;
  meanCoreFirst3: number;
  /** 全队总伤场均（参考列） */
  meanTotal: number;
  meanFirst3: number;
  /** 该将选项名次（1 起） */
  rank: number;
  kept: boolean;
  /** 来源：单挂（只填一个槽）/ 成对（双槽一起填） */
  from: 'single' | 'pair';
}

/** 逐将粗筛结果：单槽将的选项是单战法，双槽将的选项是**成对组合**（可含单挂） */
export interface UnitCoarse {
  unit: number;
  unitName: string;
  /** 该将参与匹配的空槽（1 个或 2 个） */
  slots: number[];
  /** single = 只有 1 个空槽；pair = 2 个空槽，选项按对评估 */
  mode: 'single' | 'pair';
  rows: UnitOptionRow[];
  /** 保留选项的指纹（战法 id 排序拼接），供组合枚举使用 */
  keptKeys: string[];
}

export interface ComboPick {
  unit: number;
  slot: number;
  unitName: string;
  skillId: string;
  skillName: string;
}

/** 组合粗筛榜单的一行（整队战法组合 + 3 场伤害） */
export interface ComboRow {
  picks: ComboPick[];
  /** 展示名：「SP太史慈·突进 + 曹植·浑水摸鱼」 */
  label: string;
  runs: number;
  /** 逐场**排序口径值**（核心将伤害） */
  damages: number[];
  /** 排序依据值（rankBy = total → 口径场均；first3 → 口径前三回合场均） */
  score: number;
  /** 口径：核心将伤害（整局 / 前三回合） */
  meanCore: number;
  meanCoreFirst3: number;
  /** 全队总伤场均（参考列） */
  meanTotal: number;
  meanFirst3: number;
  /** 榜单名次（1 起） */
  rank: number;
  /** 是否进决赛（前 `coarseTop` 个**不同战法套**） */
  advanced: boolean;
  /** 战法套指纹（把所选战法排序后拼接）：换将 / 换槽的排列算同一套 */
  skillKey: string;
  /** 与第 N 名是同一套战法（排列等价，只保留成绩最好的一种进决赛）；不是重复则为 null */
  duplicateOf: number | null;
}

/** 决赛排行的一行（每套配置的伤害期望） */
export interface FinalRow {
  picks: ComboPick[];
  label: string;
  runs: number;
  /** 逐场排序口径值（核心将伤害） */
  damages: number[];
  /** **排序口径**：核心将伤害期望（核心 = 全队时即全队总伤） */
  mean: number;
  /** 同口径的前三回合均值 */
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
  /** 旧解析 L2 值（同一配置）：整局 / 前三回合 */
  analyticTotal: number;
  analyticFirst3: number;
  /** 模拟期望 vs 解析偏差（比例） */
  deltaTotal: number;
  deltaFirst3: number;
  /** 决赛排行名次（按场均期望，1 起） */
  rank: number;
  /** 与榜首的 95% 区间是否重叠（true = 与第一名「并列」，名次不可当结论） */
  tieWithBest: boolean;
}

export interface SimExpectResult {
  slots: SimSlot[];
  /** 无空槽时 true：直接对当前配置跑粗筛 + 决赛（退化用法） */
  noEmptySlot: boolean;
  candidateCount: number;
  /** 候选池里被排除的战法数（队内已占用 / 未上架） */
  candidateSkipped: number;
  dummyLabel: string;
  /** 参与匹配的将（空 = 所有带空槽的将） */
  matchUnits: number[];
  /** 参与匹配的槽位指纹（`"${unit}-${slot}"`；勾哪个槽就只搜哪个槽） */
  matchSlotKeys: string[];
  /** 排序目标的核心将（unit 下标 + 名字）；自动识别结果也落在这里 */
  coreUnits: number[];
  coreLabel: string;
  /** 参与匹配的将名（「陆抗」/「陆抗 / 曹植」），页面与报告共用 */
  matchLabel: string;
  options: SimExpectOptions;
  /** 逐将粗筛（双槽将 = 成对组合榜） */
  coarse: UnitCoarse[];
  /** 组合粗筛榜单（含未进决赛的） */
  combos: ComboRow[];
  /** 评估过的组合里有多少**不同战法套**（换将 / 换槽的排列算同一套） */
  distinctCombos: number;
  /** 组合是否被 `maxCombos` 截断（true = 还有更靠后的组合没评估） */
  combosCapped: boolean;
  /** 保留名单拼不出合法组合、已放开到全量候选（组合可能含未进保留名单的战法） */
  comboFallback: boolean;
  finals: FinalRow[];
  /** 真跑场次合计 */
  battles: number;
  /** 自适应加跑额外跑的场次（0 = 榜首与后续名次一开始就分得开） */
  adaptiveExtra: number;
  /** 决赛里与榜首区间重叠（并列）的组合数 */
  tiesWithBest: number;
  /** 粗筛榜单排序与决赛排序的成对一致率（1 = 完全一致） */
  rankAgreement: number;
  /** 决赛里有几个组合出现「木桩被打空」（>0 → 提示加大木桩兵力） */
  wipedCombos: number;
  ms: number;
}

export interface SimExpectProgress {
  phase: 'slot' | 'combo' | 'final';
  /** 本阶段已完成场次 / 本阶段总场次 */
  phaseDone: number;
  phaseTotal: number;
  /** 累计场次 */
  battle: number;
  label: string;
}

// ─────────────────────── 主流程 ───────────────────────

interface RunSample {
  total: number;
  first3: number;
  raw: RunRaw;
}

const envOf = (opts: SimExpectOptions) => ({
  maxRounds: opts.maxRounds,
  swapSides: opts.swapSides,
  baseSeed: opts.baseSeed,
  /** 木桩：不还手（不放战法、不普攻）——runOne 会随交换场地翻转这个视角 */
  inertSides: ['enemy' as const],
});

/**
 * 跑 n 场（配对种子 = baseSeed + 场次；木桩方不还手），**每场 yield 一次** ——
 * 三个阶段都用它，进度粒度统一为「场」。`ViewCfg` 的槽位组合由调用方先定好。
 */
function* runBattleSteps(
  cfg: ViewCfg,
  enemyTeam: General[],
  n: number,
  opts: SimExpectOptions
): Generator<RunSample, void, void> {
  // 先固定全局唯一 id（红蓝同将时敌方副本改名），我方 id 集合才稳定 → 逐将 / 逐战法归属可信
  const teams = ensureUniqueUnitIds(generalsOf(cfg, cfg.morale), enemyTeam);
  for (let i = 0; i < n; i += 1) {
    const raw = runOne(teams.myTeam, teams.enemyTeam, i, envOf(opts));
    yield { total: raw.myDamage, first3: first3Damage(raw), raw };
  }
}

/** 组合是否合法（全队战法唯一：同一战法不得出现在两个槽位） */
export function comboLegal(picks: Array<{ skillId: string }>): boolean {
  const seen = new Set<string>();
  for (const p of picks) {
    if (!p.skillId) continue;
    if (seen.has(p.skillId)) return false;
    seen.add(p.skillId);
  }
  return true;
}

/**
 * 枚举合法组合（全队战法唯一）：DFS 按「各将粗筛名次」优先展开 → 先展开的组合就是各将名次更靠前的，
 * 故被 `cap` 截断时留下的也是更有希望的一批。`keptOnly = false` 时放开到全量选项（保留名单拼不出组合时兜底）。
 * 每个「将选项」可以含 1~2 个战法（双槽将 = 成对），组合 = 各将选项的并集。
 */
export function legalCombos(
  units: UnitCoarse[],
  cap: number,
  keptOnly = true
): Array<Array<{ unit: number; slot: number; skillId: string }>> {
  if (!units.length) return [[]];
  const lists = units.map((u) =>
    (keptOnly ? u.rows.filter((r) => r.kept) : u.rows).map((r) =>
      r.picks.map((p) => ({ unit: u.unit, slot: p.slot, skillId: p.skillId }))
    )
  );
  const out: Array<Array<{ unit: number; slot: number; skillId: string }>> = [];
  const cur: Array<{ unit: number; slot: number; skillId: string }> = [];
  const used = new Set<string>();
  const dfs = (i: number): void => {
    if (out.length >= cap) return;
    if (i === units.length) {
      out.push([...cur]);
      return;
    }
    for (const option of lists[i]) {
      // 将内选项本身已守唯一（成对不会重复），这里只要与已选战法不撞
      if (option.some((p) => used.has(p.skillId))) continue;
      for (const p of option) used.add(p.skillId);
      cur.push(...option);
      dfs(i + 1);
      cur.splice(cur.length - option.length, option.length);
      for (const p of option) used.delete(p.skillId);
      if (out.length >= cap) return;
    }
  };
  dfs(0);
  return out;
}

/** 成对一致率：两组同长度序列里相对顺序一致的配对数占比（1 = 排序完全相同） */
export function pairAgreement(a: number[], b: number[]): number {
  if (a.length < 2) return 1;
  let ok = 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) {
      total += 1;
      if (Math.sign(a[i] - a[j]) === Math.sign(b[i] - b[j])) ok += 1;
    }
  }
  return total ? ok / total : 1;
}

const scoreOf = (opts: SimExpectOptions, core: number, coreFirst3: number): number =>
  opts.rankBy === 'first3' ? coreFirst3 : core;

/**
 * 决赛每套配置的累计状态：自适应加跑要在**原样本**上继续跑（不是重跑），
 * 所以把队伍 / 样本留在状态里，`finalRowOf` 只做纯汇总。
 */
interface FinalSampleState {
  combo: ComboRow;
  variant: ViewCfg;
  teams: ReturnType<typeof ensureUniqueUnitIds>;
  myIds: string[];
  nameById: Map<string, string>;
  raws: RunRaw[];
  damages: number[];
  first3s: number[];
}

/** 由累计样本汇总出决赛排行的一行（纯函数；加跑后重算同一行） */
function finalRowOf(st: FinalSampleState, coreIds: string[]): FinalRow {
  const runs = st.raws.length;
  const unitAcc = new Map<string, number>();
  const skillAcc = new Map<string, number>();
  for (const raw of st.raws) {
    for (const [id, v] of raw.perUnit) if (st.myIds.includes(id)) unitAcc.set(id, (unitAcc.get(id) ?? 0) + v.damage);
    for (const [sid, v] of raw.perSkillMine) skillAcc.set(sid, (skillAcc.get(sid) ?? 0) + v);
  }
  const coreIdSet = new Set(coreIds);
  const byUnit = st.myIds
    .map((id) => ({
      unit: st.teams.myTeam.findIndex((g) => g.id === id),
      name: st.nameById.get(id) ?? id,
      mean: (unitAcc.get(id) ?? 0) / (runs || 1),
      core: coreIdSet.has(id),
    }))
    .sort((a, b) => b.mean - a.mean);
  const bySkill = [...skillAcc.entries()]
    .map(([skillId, sum]) => ({ skillId, name: skillName(skillId), mean: sum / (runs || 1) }))
    .sort((a, b) => b.mean - a.mean);

  // 与旧解析模型对照（同一配置、同一回合口径）；解析值是**全队总伤**，故用全队均值比
  const analytic = computeResult(st.variant);
  const analyticTotal = analytic.total;
  const analyticFirst3 = windowTotals(analytic, 3).total;
  const m = mean(st.damages);
  const m3 = mean(st.first3s);
  const totalMean = mean(st.raws.map((r) => r.myDamage));
  return {
    picks: st.combo.picks,
    label: st.combo.label,
    runs,
    damages: st.damages,
    mean: m,
    meanFirst3: m3,
    meanTotal: totalMean,
    sd: sd(st.damages),
    halfWidth: st.damages.length > 1 ? (1.96 * sd(st.damages)) / Math.sqrt(st.damages.length) : 0,
    min: st.damages.length ? Math.min(...st.damages) : 0,
    max: st.damages.length ? Math.max(...st.damages) : 0,
    median: median(st.damages),
    byUnit,
    bySkill,
    // 木桩被打空 = 伤害被兵力截断（期望偏低），如实上报
    wipedRuns: st.raws.filter((r) => r.enemyFinalTroops.some((t) => t <= 0)).length,
    coarseMean: st.combo.meanCore,
    coarseRank: st.combo.rank,
    coarseBias: st.combo.meanCore ? (m - st.combo.meanCore) / st.combo.meanCore : 0,
    analyticTotal,
    analyticFirst3,
    deltaTotal: analyticTotal ? (totalMean - analyticTotal) / analyticTotal : 0,
    deltaFirst3: analyticFirst3 ? (m3 - analyticFirst3) / analyticFirst3 : 0,
    rank: 0,
    /** 与榜首的 95% 区间是否重叠（同一次运行内、排完名后统一回填） */
    tieWithBest: false,
  };
}

/**
 * 三阶段模拟测评（生成器版）：每真跑一场就 `yield` 一次进度 ——
 * 同步版一次跑完（脚本），异步版按步让出主线程（页面进度条）。手法同仓库既有 `searchLoadoutSteps`。
 * **排序口径 = 核心将伤害期望**（`coreUnits`；缺省自动识别）——见 `SimExpectOptions.coreUnits` 的说明。
 */
export function* simExpectationSteps(
  cfg: ViewCfg,
  options: Partial<SimExpectOptions> = {}
): Generator<SimExpectProgress, SimExpectResult, void> {
  const opts = resolveOptions({ maxRounds: cfg.rounds, ...options });
  const t0 = Date.now();
  const slotsAll = simSlots(cfg);
  // 参与匹配的槽位：`matchSlotKeys` 优先（勾哪个槽就只搜哪个槽；显式 `[]` = 一个都不搜），否则按 `matchUnits` 的全部空槽
  const keysGiven = opts.matchSlotKeys !== undefined;
  const matchSlotKeys = (opts.matchSlotKeys ?? []).filter((k) => {
    const p = parseSlotKey(k);
    return Boolean(p) && p!.unit >= 0 && p!.unit < cfg.slots.length;
  });
  const matchUnits = keysGiven
    ? unitsOfSlotKeys(matchSlotKeys)
    : opts.matchUnits?.length
      ? [...new Set(opts.matchUnits)].filter((u) => u >= 0 && u < cfg.slots.length)
      : [...new Set(slotsAll.map((s) => s.unit))];
  const slots = simSlots(cfg, matchUnits.length ? matchUnits : undefined, keysGiven ? matchSlotKeys : undefined);
  const coreUnits = opts.coreUnits?.length
    ? [...new Set(opts.coreUnits)].filter((u) => u >= 0 && u < cfg.slots.length)
    : autoCoreUnits(cfg);
  // 核心将的 unitId（用于从 RunRaw 里取该将伤害）；与我方队伍同序，木桩不会撞 id
  const myGenerals = generalsOf(cfg, cfg.morale);
  const coreIds = coreUnits.map((u) => myGenerals[u]?.id).filter((id): id is string => Boolean(id));
  const coreLabel = coreLabelOf(cfg, coreUnits);
  const pool = candidateSkills(cfg, opts);
  const basePool = (opts.candidateIds ?? LEARNABLE_SKILL_IDS).filter((id) => SKILL_REGISTRY[id]).length;
  const enemyTeam = dummyTeamFromEnemy(cfg.enemy, cfg.morale, opts.dummyTroops);
  let battle = 0;

  // ① 逐将粗筛：
  //    单槽将 = 每个候选战法各跑 coarseRuns 场；
  //    双槽将 = **成对组合**（搭子基准 × 全部候选）各跑 coarseRuns 场 —— 带满槽才见得着收益的战法
  //    （击势这类增伤）如果只按单挂成绩筛，会在这一关被误杀。
  const coarse: UnitCoarse[] = [];
  if (slots.length) {
    const plans = matchUnits
      .map((unit) => ({ unit, slots: slots.filter((s) => s.unit === unit).map((s) => s.slot) }))
      .filter((p) => p.slots.length > 0);

    /** 由逐场样本汇总出该「将选项」的成绩行（纯函数，跑批在外面逐场 yield） */
    const rowFromSamples = (
      picks: Array<{ slot: number; skillId: string }>,
      samples: RunSample[],
      from: 'single' | 'pair'
    ): UnitOptionRow => {
      const raws = samples.map((x) => x.raw);
      const damages = raws.map((raw) => coreDamageOf(raw, coreIds));
      const first3s = raws.map((raw) => coreFirst3Of(raw, coreIds));
      return {
        picks: picks.map((p) => ({ slot: p.slot, skillId: p.skillId, skillName: skillName(p.skillId) })),
        label: picks.map((p) => skillName(p.skillId)).join(' + '),
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

    for (const plan of plans) {
      const unitName = heroNameOf(cfg, plan.unit);
      const mode: 'single' | 'pair' = plan.slots.length >= 2 ? 'pair' : 'single';
      const rows: UnitOptionRow[] = [];
      const pairPhase = mode === 'pair' ? Math.min(opts.pairCarriers, pool.length) * pool.length * opts.coarseRuns : 0;
      const phaseTotal = pool.length * opts.coarseRuns + pairPhase;

      // ①a 单挂一圈：既当单槽将的正榜，也给双槽将挑「搭子基准」（双槽将只把前几名留作单挂备选）
      let done = 0;
      const singleRows: UnitOptionRow[] = [];
      for (const skillId of pool) {
        const variant = withSlotSkill(cfg, plan.unit, plan.slots[0], skillId);
        const samples: RunSample[] = [];
        for (const sample of runBattleSteps(variant, enemyTeam, opts.coarseRuns, opts)) {
          samples.push(sample);
          done += 1;
          battle += 1;
          yield {
            phase: 'slot',
            phaseDone: done,
            phaseTotal,
            battle,
            label: `逐将粗筛 ${unitName}·槽${plan.slots[0] + 1}：${skillName(skillId)}（${samples.length}/${opts.coarseRuns} 场）`,
          };
        }
        singleRows.push(rowFromSamples([{ slot: plan.slots[0], skillId }], samples, 'single'));
      }
      singleRows.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
      singleRows.forEach((r, i) => {
        r.rank = i + 1;
      });

      if (mode === 'single') {
        singleRows.forEach((r, i) => {
          r.kept = i < opts.unitKeep;
        });
        rows.push(...singleRows);
      } else {
        // ①b 成对粗筛：搭子基准 = 单挂前 pairCarriers 名；与**全部候选**各配一次（守将内唯一）。
        //    成对评估才看得见「击势」这类必须带满槽才见效的增伤战法。
        const carriers = singleRows.slice(0, opts.pairCarriers);
        const seenPair = new Set<string>();
        const pairRows: UnitOptionRow[] = [];
        for (const carrier of carriers) {
          const carrierSkill = carrier.picks[0].skillId;
          for (const partnerId of pool) {
            // 自己配自己 / 已经配过的同一对（A+B 与 B+A）：只推进度，不记真跑场次
            const key = [carrierSkill, partnerId].sort().join('+');
            if (partnerId === carrierSkill || seenPair.has(key)) {
              done += opts.coarseRuns;
              continue;
            }
            seenPair.add(key);
            const variant = withPicks(cfg, [
              { unit: plan.unit, slot: plan.slots[0], skillId: carrierSkill },
              { unit: plan.unit, slot: plan.slots[1], skillId: partnerId },
            ]);
            const samples: RunSample[] = [];
            for (const sample of runBattleSteps(variant, enemyTeam, opts.coarseRuns, opts)) {
              samples.push(sample);
              done += 1;
              battle += 1;
              yield {
                phase: 'slot',
                phaseDone: done,
                phaseTotal,
                battle,
                label: `逐将粗筛 ${unitName}·配对 ${skillName(carrierSkill)}+${skillName(partnerId)}（${samples.length}/${opts.coarseRuns} 场）`,
              };
            }
            pairRows.push(
              rowFromSamples(
                [
                  { slot: plan.slots[0], skillId: carrierSkill },
                  { slot: plan.slots[1], skillId: partnerId },
                ],
                samples,
                'pair'
              )
            );
          }
        }
        // 双槽将的选项 = 成对组合 + 单挂前几名（留个「单挂更优」的出口）
        const singlesToKeep = Math.max(0, Math.min(3, opts.unitKeep - 1));
        const merged = [...pairRows, ...singleRows.slice(0, singlesToKeep)];
        merged.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
        merged.forEach((r, i) => {
          r.rank = i + 1;
          r.kept = i < opts.unitKeep;
        });
        rows.push(...merged);
      }

      coarse.push({
        unit: plan.unit,
        unitName,
        slots: [...plan.slots],
        mode,
        rows,
        keptKeys: rows.filter((r) => r.kept).map((r) => r.picks.map((p) => p.skillId).sort().join('+')),
      });
    }
  }

  // ② 组合粗筛榜单：保留战法拼成整队组合（守唯一）→ 每个组合 coarseRuns 场 → 排榜单
  //    保留名单拼不出合法组合时（例如同一将的两个空槽都只留下同一个战法）放开到全量候选，并如实标记
  let comboPicks = slots.length ? legalCombos(coarse, opts.maxCombos, true) : [[]];
  let comboFallback = false;
  if (slots.length && comboPicks.length === 0) {
    comboPicks = legalCombos(coarse, opts.maxCombos, false);
    comboFallback = comboPicks.length > 0;
  }
  const combosCapped = slots.length > 0 && comboPicks.length >= opts.maxCombos;
  const combos: ComboRow[] = [];
  const comboPhaseTotal = comboPicks.length * opts.coarseRuns;
  let comboDone = 0;
  for (const picks of comboPicks) {
    const variant = picks.length ? withPicks(cfg, picks) : cfg;
    const samples: RunSample[] = [];
    for (const sample of runBattleSteps(variant, enemyTeam, opts.coarseRuns, opts)) {
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
    const picksInfo: ComboPick[] = picks.map((p) => ({
      unit: p.unit,
      slot: p.slot,
      unitName: heroNameOf(cfg, p.unit),
      skillId: p.skillId,
      skillName: skillName(p.skillId),
    }));
    combos.push({
      picks: picksInfo,
      label: picksInfo.length ? picksInfo.map((p) => `${p.unitName}·${p.skillName}`).join(' + ') : '（当前配置）',
      runs: opts.coarseRuns,
      damages,
      score: scoreOf(opts, mean(damages), mean(first3s)),
      meanCore: mean(damages),
      meanCoreFirst3: mean(first3s),
      meanTotal: mean(samples.map((x) => x.total)),
      meanFirst3: mean(samples.map((x) => x.first3)),
      rank: 0,
      advanced: false,
      skillKey: picksInfo
        .map((p) => p.skillId)
        .sort()
        .join('+'),
      duplicateOf: null,
    });
  }
  combos.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  // 进决赛按「不同战法套」取前 coarseTop：换将 / 换槽的排列常打出完全一样的结果（实测本库如此），
  // 若按名次取会把决赛名额浪费在排列重复上 → 同一套战法只留成绩最好的一种，其余标注 duplicateOf。
  const firstRankByKey = new Map<string, number>();
  let advancedCount = 0;
  combos.forEach((row, i) => {
    row.rank = i + 1;
    const seen = firstRankByKey.get(row.skillKey);
    if (seen !== undefined) {
      row.duplicateOf = seen;
      row.advanced = false;
      return;
    }
    firstRankByKey.set(row.skillKey, row.rank);
    if (advancedCount < opts.coarseTop) {
      row.advanced = true;
      advancedCount += 1;
    }
  });
  const distinctCombos = firstRankByKey.size;
  const advancing = combos.filter((c) => c.advanced);

  // ③ 决赛：榜单前 coarseTop 个组合 × finalRuns 场 → 伤害期望排行
  const finals: FinalRow[] = [];
  const finalPhaseTotal = advancing.length * opts.finalRuns;
  let finalDone = 0;
  const states: FinalSampleState[] = [];
  for (const combo of advancing) {
    const picks = combo.picks;
    const variant = picks.length ? withPicks(cfg, picks) : cfg;
    const teams = ensureUniqueUnitIds(generalsOf(variant, cfg.morale), enemyTeam);
    const st: FinalSampleState = {
      combo,
      variant,
      teams,
      myIds: teams.myTeam.map((g) => g.id),
      nameById: new Map(teams.myTeam.map((g) => [g.id, g.name])),
      raws: [],
      damages: [],
      first3s: [],
    };
    for (let i = 0; i < opts.finalRuns; i += 1) {
      const raw = runOne(st.teams.myTeam, st.teams.enemyTeam, i, envOf(opts));
      st.raws.push(raw);
      st.damages.push(coreDamageOf(raw, coreIds));
      st.first3s.push(coreFirst3Of(raw, coreIds));
      finalDone += 1;
      battle += 1;
      yield {
        phase: 'final',
        phaseDone: finalDone,
        phaseTotal: finalPhaseTotal,
        battle,
        label: `决赛 ${states.length + 1}/${advancing.length} 第 ${i + 1}/${opts.finalRuns} 场：${combo.label}`,
      };
    }
    states.push(st);
    finals.push(finalRowOf(st, coreIds));
  }

  /**
   * 自适应加跑（用户 2026-09-28 口径）：与榜首 95% 区间重叠的组合（含榜首）每次 +`adaptiveStep` 场，
   * 直到区间两两分开或到 `finalRunsMax`。3 场粗筛 + 20 场决赛的半宽常有 ±2~5%，
   * 而真实差距可能只有 1~2% —— 不精算就会把「噪声第一」当成结论。
   */
  let adaptiveExtra = 0;
  const tiesWith = (row: FinalRow, other: FinalRow): boolean =>
    row !== other && Math.abs(row.mean - other.mean) < row.halfWidth + other.halfWidth;
  if (opts.adaptiveFinals && finals.length > 1) {
    for (;;) {
      const room = opts.finalRunsMax - (opts.finalRuns + adaptiveExtra);
      if (room <= 0) break;
      const best = finals.reduce((a, b) => (b.mean > a.mean ? b : a), finals[0]);
      const contenders = finals.filter((f) => f === best || tiesWith(f, best));
      if (contenders.length < 2) break; // 只有榜首自己 → 没有需要分开的名次
      const batch = Math.min(opts.adaptiveStep, room);
      for (const row of contenders) {
        const st = states[finals.indexOf(row)];
        const from = st.raws.length;
        for (let i = from; i < from + batch; i += 1) {
          const raw = runOne(st.teams.myTeam, st.teams.enemyTeam, i, envOf(opts));
          st.raws.push(raw);
          st.damages.push(coreDamageOf(raw, coreIds));
          st.first3s.push(coreFirst3Of(raw, coreIds));
          battle += 1;
          yield {
            phase: 'final',
            phaseDone: finalPhaseTotal,
            phaseTotal: finalPhaseTotal,
            battle,
            label: `精算（区间重叠，自动加跑到 ${opts.finalRunsMax} 场）第 ${i + 1} 场：${st.combo.label}`,
          };
        }
        finals[finals.indexOf(row)] = finalRowOf(st, coreIds);
      }
      adaptiveExtra += batch;
      finals.sort((a, b) => b.mean - a.mean);
    }
  }
  finals.sort((a, b) => b.mean - a.mean);
  finals.forEach((row, i) => {
    row.rank = i + 1;
  });
  // 与榜首的区间是否重叠（页面标「并列」用：差多少算数，看区间不看名次）
  const top = finals[0];
  finals.forEach((row) => {
    row.tieWithBest = Boolean(top) && tiesWith(row, top);
  });

  return {
    slots,
    noEmptySlot: slots.length === 0,
    candidateCount: slots.length ? pool.length : 0,
    candidateSkipped: Math.max(0, basePool - pool.length),
    dummyLabel: dummyLabel(cfg.enemy, opts.dummyTroops),
    matchUnits,
    matchSlotKeys: slots.map((s) => slotKey(s.unit, s.slot)),
    coreUnits,
    coreLabel,
    matchLabel: coreLabelOf(cfg, matchUnits),
    options: opts,
    coarse,
    combos,
    distinctCombos,
    combosCapped,
    comboFallback,
    finals,
    battles: battle,
    adaptiveExtra,
    tiesWithBest: finals.filter((f) => f.tieWithBest).length,
    rankAgreement: pairAgreement(
      finals.map((f) => f.coarseMean),
      finals.map((f) => f.mean)
    ),
    wipedCombos: finals.filter((f) => f.wipedRuns > 0).length,
    ms: Date.now() - t0,
  };
}

/** 同步跑完（脚本 / 测试） */
export function runSimExpectation(cfg: ViewCfg, options: Partial<SimExpectOptions> = {}): SimExpectResult {
  const gen = simExpectationSteps(cfg, options);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

export interface SimExpectAsyncOptions extends Partial<SimExpectOptions> {
  /** 每 N 个进度事件让出一次主线程（页面用） */
  yieldEvery?: number;
  onProgress?: (p: SimExpectProgress) => void;
}

/** 异步跑完（页面：分片让出主线程 + 进度条） */
export async function runSimExpectationAsync(
  cfg: ViewCfg,
  options: SimExpectAsyncOptions = {}
): Promise<SimExpectResult> {
  const gen = simExpectationSteps(cfg, options);
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

/** 预计真跑场次（页面开跑前显示，避免「点了才发现要跑十分钟」） */
export function estimateBattles(cfg: ViewCfg, options: Partial<SimExpectOptions> = {}): number {
  const opts = resolveOptions({ maxRounds: cfg.rounds, ...options });
  const slotsAll = simSlots(cfg);
  if (!slotsAll.length) return opts.coarseRuns + opts.finalRuns;
  const keysGiven = opts.matchSlotKeys !== undefined;
  const matchSlotKeys = opts.matchSlotKeys ?? [];
  const matchUnits = keysGiven
    ? unitsOfSlotKeys(matchSlotKeys)
    : opts.matchUnits?.length
      ? [...new Set(opts.matchUnits)].filter((u) => u >= 0 && u < cfg.slots.length)
      : [...new Set(slotsAll.map((s) => s.unit))];
  const slots = simSlots(cfg, matchUnits.length ? matchUnits : undefined, keysGiven ? matchSlotKeys : undefined);
  const pool = candidateSkills(cfg, opts).length;
  // ① 逐将粗筛：单挂一圈人人有份；双槽将再加一圈「搭子基准 × 全部候选」的配对
  const plans = matchUnits
    .map((unit) => ({ unit, count: slots.filter((s) => s.unit === unit).length }))
    .filter((p) => p.count > 0);
  const singlePhase = plans.length * pool * opts.coarseRuns;
  const pairPlans = plans.filter((p) => p.count >= 2).length;
  const pairPhase = pairPlans * Math.min(opts.pairCarriers, pool) * pool * opts.coarseRuns;
  // ② 组合数上界 = unitKeep^参与匹配的将数（守唯一会略少），再用 maxCombos 截断
  const comboUpper = Math.min(opts.maxCombos, Math.pow(opts.unitKeep, plans.length));
  const comboPhase = comboUpper * opts.coarseRuns;
  // ③ 决赛：按**上限** `finalRunsMax` 估（区间重叠会自适应加跑，实际多在 finalRuns 附近）
  const finalPhase = Math.min(opts.coarseTop, comboUpper) * opts.finalRunsMax;
  return singlePhase + pairPhase + comboPhase + finalPhase;
}
