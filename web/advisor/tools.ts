/**
 * AI 配将顾问 · 工具层
 * ---------------------------------------------------------------------------
 * 一期（本切片）六个**秒级以内**工具：`get_config` / `validate_plan` / `simulate` /
 * `search_hero` / `search_skill` / `skill_detail`。
 *
 * 三条设计约束（见 `docs/AI配将顾问-设计.md` §3）：
 *   ① `summary`（≤200 字）进 LLM 上下文，`data` 明细只挂 trace 给渲染层直读（跑批明细永不进上下文）；
 *   ② 每个结果带 `evidenceId`——LLM 引用数字必须带它（关 2 溯源用）；
 *   ③ 预算护栏：超限**拒绝执行**（抛 `BudgetExceeded`），由 loop 转成 tool_result 回灌让 AI 收口。
 *
 * 依赖注入：跑批 / 检索都由 `ToolCtx.deps` 传入 → 测试注入毫秒返回的假实现，全链路可离线测。
 */
import { SKILL_REGISTRY } from '../../src/data/skills';
import {
  baseStatsAt,
  getHeroById,
  HEROES,
  HERO_RECORDS,
  isMainSkill,
  offlineReason,
  skillDesc,
  SKILL_GRADES,
  SLOTTED_HEROES,
  TROOP_CHAR,
  type HeroJson,
} from '../heroes';
import { SLOT_LABEL } from '../roundModel';
import {
  estimateBattles as estimateSkillBattlesReal,
  evaluatePlan,
  runSimExpectationAsync,
  type PlanSummary,
  type SimExpectOptions,
  type SimExpectResult,
} from '../simExpectation';
import {
  clearSlotSkills,
  estimateMateBattles as estimateMateBattlesReal,
  heroName,
  runSimMateAsync,
  withSlotHero,
  type MateSimOptions,
  type MateSimResult,
} from '../simMate';
import { HERO_OPTIONS, LEARNABLE_SKILL_IDS, SKILL_OPTIONS, defaultCfg, generalsOf, type ViewCfg } from '../teamConfig';
/** 方案里的核心将 → `ViewCfg` 槽位下标（给 `evaluate` 当排序口径用）—— 实现见 `gate.ts`（与关 3 共用） */
import { cacheKey, hitToResult, type AdvisorCache } from './cache';
import { ALL_TIERS, renderCatalog, renderHelp, toolNamesFor, wireToolNames } from './router';
import { heroRows, skillRows, type BoxView } from './box';
import { DEFENSE_LABEL, MAX_DEFENSE_TEAMS, packDefenseSystems } from '../defenseSystems';
import { cfgOf, configToPlan, coreIndices, validateAdvisorPlan } from './gate';
import { toolZh } from './trace';
import { addPresetIdToPool, loadMergedPool, poolFingerprint, removeUserOpponent as removeUserOpponentEntry } from '../opponentPool';
import { COARSE_RUNS_DEFAULT, MATCHUP_RUNS_MIN, matchupPoolAsync, ratesIndistinguishable, type PoolMatchup } from '../poolMatchup';
import {
  FINALISTS_MAX,
  estimateWinRateBattles,
  heroUnitsOf,
  runWinRateSearch,
  singleChangeBetween,
  skillHoles,
} from '../winrateSearch';
import { fitTemplateBudget, runTemplateSearch, type TemplateChampion } from '../templateSearch';
import { TEMPLATE_LABEL, templatesForHero, type TeamTemplateId } from '../teamRoles';
import {
  BudgetExceeded,
  DEFAULT_BUDGET,
  DEFAULT_CONFIRM_BATTLES,
  DEFAULT_DUMMY,
  MS_PER_BATTLE,
  normalizePlan,
  type AdvisorPlan,
  type AdvisorTier,
  type Budget,
  type BudgetState,
  type ConfirmFn,
  type PlanSlot,
  type ToolResult,
  type ToolSpec,
} from './types';

/** `simulate` 的单次场次上限（防止一次工具调用把界面卡死） */
export const SIM_RUNS_MAX = 200;
/** `simulate` 缺省场次 */
export const SIM_RUNS_DEFAULT = 20;
/** `simulate_many` 一次最多对拍几套 */
export const SIM_MANY_MAX = 8;

// ─────────────────────────── 上下文 / 依赖 ───────────────────────────

export interface AdvisorDeps {
  /** 当前配将区配置（生产 = 主站面板；本切片 = 默认配置） */
  getConfig(): ViewCfg;
  /** 单方案测评（生产 = `web/simExpectation.ts` 的 `evaluatePlan`）；`baseSeed` 供关 3 的固定种子复算用 */
  evaluate(cfg: ViewCfg, runs: number, coreUnits?: number[], baseSeed?: number): PlanSummary;
  searchHeroes(q: string, limit: number): Array<{ id: string; name: string; label: string }>;
  searchSkills(q: string, limit: number): Array<{ id: string; name: string; label: string }>;
  skillDetail(id: string): unknown;
  /** 武将档案（主战法 / 兵种 / 阵营 / 四维成长）—— 2026-09-29 补：模型此前只能拿到 id */
  heroDetail(id: string): unknown;
  /** **L2 搜索**（生产 = `runSimExpectationAsync`）：把"配什么战法最强"一次搜完 */
  optimizeSkills(
    cfg: ViewCfg,
    options: Partial<SimExpectOptions>,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<SimExpectResult>;
  /** L2 开跑前的场次预估（用于预算预判与"点了要等多久"） */
  estimateSkillBattles(cfg: ViewCfg, options: Partial<SimExpectOptions>): number;
  /** **L3 搜索**（生产 = `runSimMateAsync`）：把"换哪个队友最强"一次搜完 */
  optimizeMates(
    cfg: ViewCfg,
    options: Partial<MateSimOptions>,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<MateSimResult>;
  /** L3 开跑前的场次预估 */
  estimateMateBattles(cfg: ViewCfg, options: Partial<MateSimOptions>): number;
  /** 把一套队友组合落到配置上（`clearSkills` = 清空这些位的可学战法，交给下一轮战法搜索去填） */
  applyCombo(cfg: ViewCfg, picks: Array<{ unit: number; heroId: string }>, clearSkills: boolean): ViewCfg;
  /** 合并后的对手池（固定测试集 + 用户从预设加入的） */
  listOpponentPool(): ReturnType<typeof loadMergedPool>;
  /** 把一条阵容预设加入对手池（用户添加，不动固定集） */
  addOpponentFromPreset(presetId: string): { ok: boolean; message: string };
  /** 移出用户自己加的对手。固定集 id 会失败。 */
  removeUserOpponent(id: string): { ok: boolean; message: string };
  /**
   * 一套方案打完整份对手池。
   * 胜负口径 = 统计胜率；伤害是同一批战斗的八回合总伤与前三回合。
   */
  matchup(
    plan: AdvisorPlan,
    runsPerOpponent: number,
    seed: number,
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void
  ): Promise<PoolMatchup>;
}

/**
 * 工具面分档的路由钩子（由 `loop.ts` 注入；不传 = 没启用分档，全部工具可调）。
 * 放在 ctx 上而不是模块级变量：一轮一个 ctx → 天然隔离，测试/多会话互不串档。
 */
export interface RouteHooks {
  /** 当前档位（会话内只增不减） */
  tiers(): AdvisorTier[];
  /** **首轮锚定**是否生效（会话还没跑过任何工具 = true；见 `router.ANCHOR_TOOL`） */
  anchor(): boolean;
  /** 模型用 `route_task` 主动开档：由 loop 校验理由并决定是否放行 */
  promote(tier: AdvisorTier, why: string): { ok: boolean; message: string };
}

export interface ToolCtx {
  deps: AdvisorDeps;
  budget: BudgetState;
  /** 分档路由钩子（见 `RouteHooks`；缺省 = 不分档） */
  route?: RouteHooks;
  /** 证据编号序列（每轮一个 ctx → 天然不冲突） */
  evidenceSeq: { n: number };
  /** 本轮基准种子（写进 stats，复算用同一把尺子） */
  seed: number;
  /** 本轮取消信号（长搜索在进度回调里检查它） */
  signal?: AbortSignal;
  /** 长任务的进度外抛（loop 转成事件、界面显示进度条） */
  onProgress?: (e: { name: string; done: number; total: number; label?: string }) => void;
  /** 跑批缓存（缺省不缓存；页面传 `createLocalCache()`） */
  cache?: AdvisorCache | null;
  /** 「报价 + 确认」钩子：长搜索开跑前问用户（返回 false = 不跑，原因回灌给模型） */
  confirm?: ConfirmFn;
  /** 超过这个场次才问（缺省 `DEFAULT_CONFIRM_BATTLES` = 2000 场 ≈ 12 秒） */
  confirmFrom?: number;
  /**
   * 这位用户的「我的 box」（识图建档，见 `box.ts` / 设计文档 §15）。
   * **严格模式**下：检索工具只在清单内找、L2/L3 候选池收窄、`validate_plan` 拒收清单外的将法。
   * 不传 / 空 box / 关掉严格模式 → 一切照旧（等于没有这个功能）。
   */
  box?: BoxView | null;
}

/** 缓存键：同一工具 + 同一方案 + 同一参数 + 同一种子（引擎确定性 → 同输入必同输出） */
function cacheKeyFor(name: string, payload: unknown, options: unknown, seed: number): string {
  return cacheKey(name, { payload, options, seed });
}

/** 命中就直接返回（**新 evidenceId**：证据编号是本轮的，不能复用旧编号） */
function cachedResult(ctx: ToolCtx, key: string, name: string): ToolResult | null {
  const hit = ctx.cache?.get(key);
  return hit ? hitToResult(hit, nextEvidenceId(ctx, name), ctx.seed) : null;
}

/** 跑完写缓存（只存 summary/brief/data 与真实代价） */
function remember(ctx: ToolCtx, key: string, r: ToolResult): ToolResult {
  ctx.cache?.set(key, { summary: r.summary, ...(r.brief ? { brief: r.brief } : {}), data: r.data, battles: r.stats.battles, ms: r.stats.ms });
  return r;
}

/** 长任务跑到一半检查取消：抛 AbortError，由 loop 如实上报 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('已取消');
    err.name = 'AbortError';
    throw err;
  }
}

export function nextEvidenceId(ctx: ToolCtx, name: string): string {
  ctx.evidenceSeq.n += 1;
  return `ev-${ctx.evidenceSeq.n}-${name}`;
}

/**
 * 预算护栏：超限**拒绝执行**（不是静默截断）。token 由 loop 记账，不在这里扣。
 * 毫秒只看已经累计的**工具执行时间**（`state.ms`），不看本轮墙钟——模型思考和确认等待不占这份额度。
 */
export function chargeBudget(state: BudgetState, cost: { battles?: number; ms?: number }, _now?: number): void {
  if (state.calls + 1 > state.maxCalls) throw new BudgetExceeded('calls');
  if (state.battles + (cost.battles ?? 0) > state.maxBattles) throw new BudgetExceeded('battles');
  if (state.ms + (cost.ms ?? 0) > state.maxMs) throw new BudgetExceeded('ms');
  state.calls += 1;
  state.battles += cost.battles ?? 0;
  state.ms += cost.ms ?? 0;
}

// ─────────────────────────── 检索口径 ───────────────────────────

const tokenize = (q: string): string[] => q.trim().toLowerCase().split(/\s+/).filter(Boolean);

/**
 * 检索匹配串（空白分词 AND）。
 * 2026-09-29 扩面：原来只有「名称 / id / 出手位 / 品级」——模型搜「骑兵」「攻击」直接 0 命中，
 * 白烧好几次调用（它自己在回答里点出了这个现象）。现在把**效果标签 + 官方描述 + 主战法名**并进来。
 */
export const SKILL_MATCH = SKILL_OPTIONS.map((o) => {
  const tags = (SKILL_REGISTRY[o.id]?.tags ?? []).join(' ');
  // `slot` 是英文枚举（active / passive …），面板用的是 `SLOT_LABEL` 的中文名 —— 两个都留，检索按中文、也认英文
  const slotKey = String(o.slot);
  const slot = SLOT_LABEL[o.slot] ?? slotKey;
  return {
    id: o.id,
    name: o.label.split('（')[0],
    slot,
    slotKey,
    grade: SKILL_GRADES[o.id] ?? '',
    match: `${o.match} ${slot} ${slotKey} ${tags} ${skillDesc(o.id)}`.toLowerCase(),
  };
});

export const HERO_MATCH = HERO_OPTIONS.map((o) => {
  const rec = getHeroById(o.id) as (HeroJson & { skillDesc?: string }) | undefined;
  const extra = `${rec?.mainSkillName ?? ''} ${rec?.skillDesc ?? ''}`;
  return { id: o.id, name: o.label.split('（')[0], label: o.label, match: `${o.match} ${extra}`.toLowerCase() };
});

/** 空白分词 AND 匹配 */
function matchRows<T extends { match: string }>(rows: T[], q: string, limit: number): T[] {
  const toks = tokenize(q);
  const hits = toks.length ? rows.filter((o) => toks.every((t) => o.match.includes(t))) : rows;
  return hits.slice(0, Math.max(1, limit));
}

/** 0 命中的提示（模型据此换词，而不是反复重试同一个词） */
const EMPTY_HINT =
  '检索提示：战法可按 出手位（主动 / 追击 / 被动 / 一类指挥 / 二类指挥 / 准备）、品级（S/A/B/C/D）、效果标签、官方描述关键词 或名字检索；武将可按 名字 / 势力 / 兵种 / 主战法名 检索。空结果只说明这个词没命中，不代表库里没有。';

// ─────────────────────────── box 标注 / 收窄（识图建档，见 `box.ts` / 设计文档 §15） ───────────────────────────
// 口径（用户 2026-09-29 修正）：box 只是「**给这位用户配将**」时的范围，不是"什么都得先传截图"——
//   · 检索 / 详情 / simulate 一律**不受 box 限制**（比较、测算、查资料照常）；
//   · 只有"配将类搜索"（optimize_*）把候选池收窄到 box，避免替他搜出他没有的将法；
//   · 方案里出现 box 外的将法**不算不合法**，只是不能一键应用到他的配将区（见 `gate.ts` 的 boxIssues）。

/** 严格模式且 box 非空时才生效；其余情况一律不标注、不收窄（空 box / 关掉严格模式 = 加这功能之前的行为） */
const boxOn = (ctx: ToolCtx): BoxView | null => (ctx.box?.strict ? ctx.box : null);

/** 结果行后缀：`·✓你有` / `·✗你没有`（**只标注，不过滤**） */
function boxMark(ctx: ToolCtx, kind: 'hero' | 'skill', id: string): string {
  const box = boxOn(ctx);
  if (!box) return '';
  return (kind === 'hero' ? box.heroIds : box.skillIds).has(id) ? '·✓你有' : '·✗你没有';
}

/** 一行说明：✓ / ✗ 是什么意思、什么时候才必须只用 ✓ 的 */
function boxNote(ctx: ToolCtx, kind: 'hero' | 'skill', outside: number): string {
  const box = boxOn(ctx);
  if (!box) return '';
  const n = kind === 'hero' ? box.heroIds.size : box.skillIds.size;
  const what = kind === 'hero' ? '武将' : '战法';
  return (
    `检索不受 box 限制：标 ✓ 的是你 box 里的 ${n} 个${what}${outside ? `（本次另有 ${outside} 个不在 box 里，标 ✗）` : ''}；` +
    '**只有「给你自己配将 / 出方案」时才要求只用 ✓ 的** —— 比较、测算、查资料照常用全部。'
  );
}

/** 能进模拟的 box 武将（主战法已实现）+ 如实报出跳过的那些 */
export function boxHeroCandidates(ctx: ToolCtx): { ids: string[]; skipped: string[]; note: string } | null {
  const box = boxOn(ctx);
  if (!box) return null;
  const sim = new Set(SLOTTED_HEROES.map((h) => h.id));
  const ids: string[] = [];
  const skipped: string[] = [];
  for (const id of box.heroIds) {
    if (!HERO_RECORDS[id]) continue; // 库里没有（改名 / 已删）→ 不当候选
    if (sim.has(id)) ids.push(id);
    else skipped.push(heroName(id));
  }
  const note = `候选武将已收窄到你的 box（档案「${ctx.box?.profileName}」，${ids.length} 个可进模拟${skipped.length ? `；另有 ${skipped.length} 个（${skipped.slice(0, 5).join('、')}${skipped.length > 5 ? '…' : ''}）主战法未实现，模拟里用不了，已跳过` : ''}）——**配将搜索只在你有的武将里选**；只想比较/测算某几个将，用 simulate / simulate_many（不受此限制）`;
  return { ids, skipped, note };
}

/** 能进模拟的 box 战法（库内有定义、且不是武将主战法） */
export function boxSkillCandidates(ctx: ToolCtx): string[] | null {
  const box = boxOn(ctx);
  if (!box) return null;
  return [...box.skillIds].filter((id) => Boolean(SKILL_REGISTRY[id]) && !isMainSkill(id));
}

/** box 收窄 → L2 选项；模型自己给了候选就求交（交集为空 → 明确报错，别白跑几千场） */
function applyBoxSkillOptions(options: Partial<SimExpectOptions>, ctx: ToolCtx): string | null {
  const cands = boxSkillCandidates(ctx);
  if (!cands) return null;
  const allowed = new Set(cands);
  const asked = options.candidateIds;
  const kept = asked?.length ? asked.filter((id) => allowed.has(id)) : cands;
  if (!kept.length)
    throw new Error(
      `你给的 candidateSkillIds 一个都不在用户 box 里（档案「${ctx.box?.profileName}」，box 内可学战法 ${allowed.size} 个）——` +
        '严格模式下不许用他没有的战法：调 get_my_box 或 list_skills 看清单，或去掉 candidateSkillIds 让它在 box 内全搜'
    );
  options.candidateIds = kept;
  return `候选战法已收窄到你的 box（${kept.length} 个）——**配将搜索只在你有的战法里选**；只想比较/测算某几个战法（哪怕你没有），用 simulate_many 对拍（不受此限制）`;
}

/** box 收窄 → L3 选项（同上口径） */
function applyBoxMateOptions(options: Partial<MateSimOptions>, ctx: ToolCtx): string | null {
  const cands = boxHeroCandidates(ctx);
  if (!cands) return null;
  const allowed = new Set(cands.ids);
  const asked = options.candidateIds;
  const kept = asked?.length ? asked.filter((id) => allowed.has(id)) : cands.ids;
  if (!kept.length)
    throw new Error(
      `你给的 candidateHeroIds 一个都不在用户 box 里（档案「${ctx.box?.profileName}」，box 内可进模拟的武将 ${allowed.size} 个）——` +
        '严格模式下不许用他没有的武将：调 get_my_box 看清单，或去掉 candidateHeroIds 让它在 box 内全搜'
    );
  options.candidateIds = kept;
  return cands.note;
}

// ─────────────────────────── 六个工具 ───────────────────────────

/** 给模型看的紧凑明细（≤15 行）：每将 / 每战法场均贡献 + **两个主数字**（八回合全队总伤 / 前三回合爆发） */
export function planBrief(s: PlanSummary): string {
  const units = s.byUnit
    .slice(0, 5)
    .map((u) => `${u.core ? '★' : '·'} ${u.name}${u.core ? '（排序口径）' : ''} 场均 ${Math.round(u.mean)}`)
    .join('\n');
  const skills = s.bySkill
    .slice(0, 6)
    .map((k) => `· ${k.name} 场均 ${Math.round(k.mean)}`)
    .join('\n');
  return [
    '每将（场均伤害）：',
    units,
    '每战法（场均贡献）：',
    skills || '· （本方案没有可学战法贡献）',
    `汇总：核心将伤害期望 mean ${Math.round(s.mean)} ±${Math.round(s.halfWidth)}（${s.runs} 场；样本标准差 ${Math.round(s.sd)}；单场 ${Math.round(s.min)}~${Math.round(s.max)}；中位 ${Math.round(s.median)}）`,
    `八回合全队总伤 meanTotal ${Math.round(s.meanTotal)}｜前三回合爆发 meanFirst3 ${Math.round(s.meanFirst3)}（都是每场平均）`,
  ].join('\n');
}

/** 从 `args.plan`（缺省 = 当前配将区）构造 cfg + L2 搜索选项 */
function skillSearchSetup(
  args: { plan?: unknown; coarseRuns?: number; finalRuns?: number; coarseTop?: number; candidateSkillIds?: string[]; matchSlotKeys?: string[] },
  ctx: ToolCtx
): { cfg: ViewCfg; options: Partial<SimExpectOptions>; plan: AdvisorPlan; boxLine?: string } {
  const plan = args?.plan === undefined ? configToPlan(ctx.deps.getConfig()) : assertPlanShape(args.plan);
  const cfg = cfgOf(plan);
  const options: Partial<SimExpectOptions> = {};
  if (Number(args?.coarseRuns) > 0) options.coarseRuns = Math.floor(Number(args.coarseRuns));
  if (Number(args?.finalRuns) > 0) options.finalRuns = Math.floor(Number(args.finalRuns));
  if (Number(args?.coarseTop) > 0) options.coarseTop = Math.floor(Number(args.coarseTop));
  if (Array.isArray(args?.candidateSkillIds) && args.candidateSkillIds.length) options.candidateIds = args.candidateSkillIds.map(String);
  if (Array.isArray(args?.matchSlotKeys) && args.matchSlotKeys.length) options.matchSlotKeys = args.matchSlotKeys.map(String);
  const core = coreIndices(plan, cfg);
  if (core) options.coreUnits = core;
  const boxLine = applyBoxSkillOptions(options, ctx);
  return { cfg, options, plan, ...(boxLine ? { boxLine } : {}) };
}

/** 从 `args.plan`（缺省 = 当前配将区）构造 cfg + L3 队友搜索选项 */
function mateSearchSetup(
  args: { plan?: unknown; coarseRuns?: number; finalRuns?: number; coarseTop?: number; candidateHeroIds?: string[]; matchUnits?: number[]; slotSkills?: string; includeOffline?: boolean },
  ctx: ToolCtx
): { cfg: ViewCfg; options: Partial<MateSimOptions>; boxLine?: string } {
  const plan = args?.plan === undefined ? configToPlan(ctx.deps.getConfig()) : assertPlanShape(args.plan);
  const cfg = cfgOf(plan);
  const options: Partial<MateSimOptions> = {};
  if (Number(args?.coarseRuns) > 0) options.coarseRuns = Math.floor(Number(args.coarseRuns));
  if (Number(args?.finalRuns) > 0) options.finalRuns = Math.floor(Number(args.finalRuns));
  if (Number(args?.coarseTop) > 0) options.coarseTop = Math.floor(Number(args.coarseTop));
  if (Array.isArray(args?.candidateHeroIds) && args.candidateHeroIds.length) options.candidateIds = args.candidateHeroIds.map(String);
  if (Array.isArray(args?.matchUnits) && args.matchUnits.length) options.matchUnits = args.matchUnits.map(Number);
  if (args?.slotSkills === 'keep' || args?.slotSkills === 'clear') options.slotSkills = args.slotSkills;
  if (typeof args?.includeOffline === 'boolean') options.includeOffline = args.includeOffline;
  const core = coreIndices(plan, cfg);
  if (core) options.coreUnits = core;
  const boxLine = applyBoxMateOptions(options, ctx);
  return { cfg, options, ...(boxLine ? { boxLine } : {}) };
}

/** 长搜索的进度外抛 + 取消检查 */
const forwardProgress =
  (ctx: ToolCtx, name: string) =>
  (done: number, total: number): void => {
    throwIfAborted(ctx.signal);
    ctx.onProgress?.({ name, done, total, label: `真跑 ${done}/${total} 场` });
  };

interface RankRow {
  label: string;
  mean: number;
  halfWidth: number;
  runs: number;
  meanTotal: number;
  tieWithBest?: boolean;
}

/** 搜索榜单的紧凑明细（进上下文）：名次 + 区间 + "分不分得出来" */
function searchBrief(inp: {
  title: string;
  rows: RankRow[];
  est: number;
  battles: number;
  ms: number;
  tiesWithBest: number;
  matchLabel: string;
  coreLabel: string;
  extraLines?: string[];
}): string {
  const lines = [
    `${inp.title}：真跑 ${inp.battles} 场（预估 ${inp.est}）/ ${Math.round(inp.ms / 1000)} 秒；参与匹配：${inp.matchLabel || '—'}；排序口径 = 核心将「${inp.coreLabel}」的伤害期望`,
    ...(inp.extraLines ?? []),
    ...inp.rows.map(
      (r, i) =>
        `${i + 1}. ${r.label} — mean ${Math.round(r.mean)} ±${Math.round(r.halfWidth)}（${r.runs} 场）｜全队总伤 ${Math.round(r.meanTotal)}${r.tieWithBest ? '｜**与第 1 名区间重叠（名次分不出来）**' : ''}`
    ),
  ];
  if (inp.rows.length > 1) {
    const gap = Math.abs(Math.round(inp.rows[0].mean - inp.rows[1].mean));
    const sum = Math.round(inp.rows[0].halfWidth + inp.rows[1].halfWidth);
    lines.push(`第 1 与第 2 差距 ${gap}，半宽之和 ${sum} → ${gap <= sum ? '**分不出来**（要更确定就加大 finalRuns 再跑一次）' : '分得开'}`);
  }
  lines.push(`并列行数：${inp.tiesWithBest}（与榜首 95% 区间重叠的都算并列，别把噪声级差距说成结论）`);
  return lines.join('\n');
}

/** 从 `args.plan`（缺省 = 当前配将区）构造 cfg + 「整体搜最优」的两套参数 */
function bothSetup(
  args: {
    plan?: unknown;
    rounds?: number;
    mateTop?: number;
    finalRuns?: number;
    coarseRuns?: number;
    coarseTop?: number;
    matchUnits?: number[];
    candidateHeroIds?: string[];
    candidateSkillIds?: string[];
  },
  ctx: ToolCtx
): {
  cfg: ViewCfg;
  mateOptions: Partial<MateSimOptions>;
  skillOptions: Partial<SimExpectOptions>;
  rounds: number;
  mateTop: number;
  boxLines: string[];
} {
  const plan = args?.plan === undefined ? configToPlan(ctx.deps.getConfig()) : assertPlanShape(args.plan);
  const cfg = cfgOf(plan);
  const finalRuns = Math.max(20, Math.floor(Number(args?.finalRuns) || 20));
  const coarseRuns = Math.max(1, Math.floor(Number(args?.coarseRuns) || 2));
  // 交替搜索里 L2 会跑好几遍 → 每遍收窄（进决赛的组合数少一点），总场次才压得住
  const coarseTop = Math.max(2, Math.min(64, Math.floor(Number(args?.coarseTop) || 8)));
  const mateOptions: Partial<MateSimOptions> = { finalRuns, coarseRuns, coarseTop: Math.max(4, coarseTop), slotSkills: 'keep' };
  const skillOptions: Partial<SimExpectOptions> = { finalRuns, coarseRuns, coarseTop };
  if (Array.isArray(args?.matchUnits) && args.matchUnits.length) mateOptions.matchUnits = args.matchUnits.map(Number);
  if (Array.isArray(args?.candidateHeroIds) && args.candidateHeroIds.length) mateOptions.candidateIds = args.candidateHeroIds.map(String);
  if (Array.isArray(args?.candidateSkillIds) && args.candidateSkillIds.length) skillOptions.candidateIds = args.candidateSkillIds.map(String);
  const core = coreIndices(plan, cfg);
  if (core) {
    mateOptions.coreUnits = core;
    skillOptions.coreUnits = core;
  }
  const boxLines = [applyBoxMateOptions(mateOptions, ctx), applyBoxSkillOptions(skillOptions, ctx)].filter((x): x is string => Boolean(x));
  return {
    cfg,
    mateOptions,
    skillOptions,
    rounds: Math.max(1, Math.min(3, Math.floor(Number(args?.rounds) || 2))),
    mateTop: Math.max(1, Math.min(4, Math.floor(Number(args?.mateTop) || 3))),
    boxLines,
  };
}

/** 预估总场次：队友一轮 + 每套队友一次战法搜索；要跑第 2 轮就再加「队友 + 战法」各一次 */
function estimateBoth(ctx: ToolCtx, s: ReturnType<typeof bothSetup>): number {
  const mate = ctx.deps.estimateMateBattles(s.cfg, s.mateOptions);
  const skill = ctx.deps.estimateSkillBattles(s.cfg, s.skillOptions);
  return mate + s.mateTop * skill + (s.rounds > 1 ? mate + skill : 0);
}

const PLAN_SCHEMA = {
  type: 'object',
  description: '方案：三个槽位（大营/中军/前锋）+ 排序口径核心将 + 靶子',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          position: { type: 'string', enum: ['大营', '中军', '前锋'] },
          heroId: { type: 'string' },
          level: { type: 'integer' },
          skillIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['position', 'heroId'],
      },
    },
    coreUnitIds: { type: 'array', items: { type: 'string' } },
    dummy: {
      type: 'object',
      properties: {
        defense: { type: 'integer' },
        strategy: { type: 'integer' },
        troopType: { type: 'string', enum: ['cavalry', 'infantry', 'archer'] },
        troops: { type: 'integer' },
      },
    },
  },
  required: ['slots'],
} as const;

/**
 * 方案结构校验：**错误信息必须能让模型一次改对**。
 * 2026-09-29 实跑教训：模型给的槽位缺 `skillIds` 时，原来只在深处抛 `Cannot read properties of undefined`，
 * 它看不懂就盲试了 4 次同样的错。现在每个字段单独报，并说明缺什么、期望什么。
 */
function assertPlanShape(plan: unknown): AdvisorPlan {
  const p = plan as Partial<AdvisorPlan> | undefined;
  if (!p || typeof p !== 'object' || !Array.isArray(p.slots)) {
    throw new Error('plan 结构不对：需要 { slots: [{ position, heroId, level?, skillIds? }], coreUnitIds?, dummy? }');
  }
  const slots = p.slots.map((raw, i) => {
    const s = raw as Partial<PlanSlot> | undefined;
    if (!s || typeof s !== 'object') throw new Error(`plan.slots[${i}] 不是对象`);
    if (!s.heroId) throw new Error(`plan.slots[${i}].heroId 缺失：要武将 id（如 h498），不确定就先 search_hero`);
    if (!s.position) throw new Error(`plan.slots[${i}].position 缺失：必须是 大营 / 中军 / 前锋`);
    if (s.skillIds !== undefined && !Array.isArray(s.skillIds)) {
      throw new Error(`plan.slots[${i}].skillIds 必须是字符串数组（可省略；最多 2 个可学战法，如 ["jishi","shenmou_yuanlv"]）`);
    }
    return {
      position: s.position,
      heroId: String(s.heroId),
      level: Number(s.level) > 0 ? Number(s.level) : 40,
      skillIds: (s.skillIds ?? []).filter(Boolean).map(String),
    };
  });
  return {
    slots,
    coreUnitIds: Array.isArray(p.coreUnitIds) ? p.coreUnitIds.filter(Boolean).map(String) : [],
    dummy: { ...DEFAULT_DUMMY, ...(p.dummy ?? {}) },
  };
}

const pct1 = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/** 把胜率收成模型能引用、卡片能直读的数字（百分比保留 1 位） */
function publishMatchup(m: PoolMatchup) {
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    ...m,
    winRatePct: round1(m.winRate * 100),
    meanTotal: Math.round(m.meanTotal),
    meanFirst3: Math.round(m.meanFirst3),
    controlMine: round1(m.controlMine),
    opponents: m.opponents.map((o) => ({
      ...o,
      winRatePct: round1(o.winRate * 100),
      meanTotal: Math.round(o.meanTotal),
      meanFirst3: Math.round(o.meanFirst3),
    })),
    worst: { ...m.worst, winRatePct: round1(m.worst.winRate * 100) },
  };
}

function matchupLines(m: ReturnType<typeof publishMatchup>): string {
  const rows = m.opponents
    .map((o) => `· ${o.note}（${o.source === 'benchmark' ? '固定' : '自加'}）胜率 ${pct1(o.winRate)}（胜 ${o.win} / 平 ${o.draw} / 负 ${o.loss}，${o.runs} 场）八回合总伤 ${Math.round(o.meanTotal)} 前三回合 ${Math.round(o.meanFirst3)}`)
    .join('\n');
  return [
    `综合胜率 ${pct1(m.winRate)} ±${pct1(m.halfWidth)}（胜 ${m.win} / 平 ${m.draw} / 负 ${m.loss}，共 ${m.runs} 场）`,
    `最差对手 ${m.worst.note} ${pct1(m.worst.winRate)}`,
    `八回合总伤 ${Math.round(m.meanTotal)}｜前三回合 ${Math.round(m.meanFirst3)}（同一批对打，辅助）`,
    `对手池 ${m.fingerprint} · 种子 ${m.baseSeed} · 每对手 ${m.runsPerOpponent} 场`,
    rows,
  ].join('\n');
}

/** 写操作：有确认钩子就先问。没有钩子（脚本 / 单测）直接执行。 */
async function confirmWrite(ctx: ToolCtx, tool: string, label: string): Promise<void> {
  if (!ctx.confirm) return;
  const ok = await ctx.confirm({ tool, battles: 0, estMs: 0, label });
  if (!ok) throw new Error(`用户没有确认（${label}）——没有改动`);
}

interface WinRateArgs {
  plan?: unknown;
  coarseRuns?: number;
  finalRuns?: number;
  finalists?: number;
  candidateSkillIds?: string[];
  candidateHeroIds?: string[];
  matchSlotKeys?: string[];
  matchPositions?: string[];
  /** 点名的核心站在哪。给出后按「队友 → 队友战法 → 核心战法」一次跑完 */
  coreUnit?: string;
  rankBy?: 'winRate' | 'worst';
}

function winrateSetup(args: WinRateArgs, ctx: ToolCtx): {
  plan: AdvisorPlan;
  mode: 'skill' | 'hero';
  holes: ReturnType<typeof skillHoles>;
  heroUnits: number[];
  candidateIds: string[];
  coarseRuns: number;
  finalRuns: number;
  finalists: number;
  rankBy: 'winRate' | 'worst';
  est: number;
  boxLine?: string;
  opponents: number;
} {
  const plan = args?.plan === undefined ? configToPlan(ctx.deps.getConfig()) : assertPlanShape(args.plan);
  const rankBy = args?.rankBy === 'worst' ? 'worst' : 'winRate';
  const mode = args?.matchPositions?.length ? 'hero' : 'skill';
  let candidateIds: string[] = [];
  let boxLine: string | undefined;
  if (mode === 'skill') {
    const asked = args?.candidateSkillIds?.filter(Boolean);
    const boxed = boxSkillCandidates(ctx);
    if (boxed) {
      const allowed = new Set(boxed);
      const kept = asked?.length ? asked.filter((id) => allowed.has(id)) : boxed;
      if (!kept.length) {
        throw new Error(
          `candidateSkillIds 不在用户 box 里（档案「${ctx.box?.profileName}」，可学战法 ${allowed.size} 个）。配将搜索只用清单内的战法；比较单个战法请用 compare_variants，不受 box 限制。`
        );
      }
      candidateIds = kept;
      boxLine = `候选战法已收窄到你的 box（${kept.length} 个）`;
    } else {
      candidateIds = asked?.length ? asked : [...LEARNABLE_SKILL_IDS];
    }
    candidateIds = candidateIds.filter((id) => Boolean(SKILL_REGISTRY[id]) && !isMainSkill(id));
  } else {
    const asked = args?.candidateHeroIds?.filter(Boolean);
    const boxed = boxHeroCandidates(ctx);
    if (boxed) {
      const allowed = new Set(boxed.ids);
      const kept = asked?.length ? asked.filter((id) => allowed.has(id)) : boxed.ids;
      if (!kept.length) {
        throw new Error(
          `candidateHeroIds 不在用户 box 里（档案「${ctx.box?.profileName}」）。配将搜索只用清单内、且能进模拟的武将；比较某个武将请用 compare_variants。`
        );
      }
      candidateIds = kept;
      boxLine = boxed.note;
    } else {
      candidateIds = asked?.length ? asked : SLOTTED_HEROES.map((h) => h.id);
    }
  }
  const holes = mode === 'skill' ? skillHoles(plan, args?.matchSlotKeys) : [];
  const heroUnits = mode === 'hero' ? heroUnitsOf(plan, args?.matchPositions) : [];
  const coarseRuns = Math.max(1, Math.floor(Number(args?.coarseRuns) || COARSE_RUNS_DEFAULT));
  const finalRuns = Math.max(MATCHUP_RUNS_MIN, Math.floor(Number(args?.finalRuns) || MATCHUP_RUNS_MIN));
  const finalists = Math.min(FINALISTS_MAX, Math.max(1, Math.floor(Number(args?.finalists) || FINALISTS_MAX)));
  const opponents = Math.max(1, ctx.deps.listOpponentPool().entries.length);
  const est = estimateWinRateBattles({
    opponents,
    candidates: candidateIds.length,
    holes: mode === 'skill' ? Math.max(1, holes.length) : Math.max(1, heroUnits.length),
    coarseRuns,
    finalRuns,
    finalists,
  });
  return { plan, mode, holes, heroUnits, candidateIds, coarseRuns, finalRuns, finalists, rankBy, est, ...(boxLine ? { boxLine } : {}), opponents };
}

const TEMPLATE_IDS: Record<string, TeamTemplateId> = {
  standard: 'standard',
  标准队: 'standard',
  counter: 'counter',
  半肉反击: 'counter',
  blade: 'blade',
  菜刀: 'blade',
  shenshang: 'shenshang',
  神赏法刀: 'shenshang',
  神赏: 'shenshang',
};

interface TemplateArgs {
  plan?: unknown;
  template?: string;
  heroId?: string;
  /** 点名武将必须带的战法，id 或中文名，最多 2 个 */
  lockSkillIds?: string[];
  /** 已经分给别的队伍的 A/S 战法，这一队不再用 */
  usedSkillIds?: string[];
  coarseRuns?: number;
  finalRuns?: number;
}

function templateIdOf(raw: unknown): TeamTemplateId | undefined {
  if (raw == null || raw === '') return undefined;
  const id = TEMPLATE_IDS[String(raw)];
  if (!id) throw new Error('template 只能是 standard / counter / blade / shenshang');
  return id;
}

function lockHeroId(raw: unknown, pool: string[]): string | undefined {
  if (raw == null || raw === '') return undefined;
  const key = String(raw);
  if (pool.includes(key)) return key;
  const named = pool.filter((id) => getHeroById(id)?.name === key);
  if (named.length === 1) return named[0];
  throw new Error(named.length > 1 ? `「${key}」有多张卡，请传 heroId` : '点名的武将不在候选里');
}

/** 残缺方案里能捞到的武将和战法。给我配不要求三个槽都填满。 */
function salvagePlan(raw: unknown, pool: string[]): { heroId?: string; skillIds: string[] } {
  const slots = (raw as { slots?: Array<{ heroId?: unknown; skillIds?: unknown }> } | null)?.slots;
  if (!Array.isArray(slots)) return { skillIds: [] };
  let heroId: string | undefined;
  const skillIds: string[] = [];
  for (const slot of slots) {
    if (!slot) continue;
    if (!heroId && slot.heroId) {
      const key = String(slot.heroId);
      if (pool.includes(key)) heroId = key;
      else {
        const named = pool.filter((id) => getHeroById(id)?.name === key);
        if (named.length === 1) heroId = named[0];
      }
    }
    if (Array.isArray(slot.skillIds)) {
      for (const id of slot.skillIds) if (id) skillIds.push(String(id));
    }
  }
  return { heroId, skillIds };
}

function resolveSkillId(raw: string, pool: string[]): string | undefined {
  if (pool.includes(raw)) return raw;
  const named = Object.values(SKILL_REGISTRY).find((s) => s.name === raw);
  return named && pool.includes(named.id) ? named.id : undefined;
}

/**
 * 「给我配」的候选池。开了 box 就只用 box；没开就用上架武将和可学战法。
 * 空 box 直接要求先传截图，不拿全库顶上。
 */
function templateSetup(args: TemplateArgs, ctx: ToolCtx): {
  plan: AdvisorPlan;
  heroIds: string[];
  skillIds: string[];
  templates?: TeamTemplateId[];
  lockHeroId?: string;
  coarseRuns: number;
  finalRuns: number;
  skillCap: number;
  est: number;
  opponents: number;
  boxLine?: string;
  fitNote?: string;
  lockSkillIds: string[];
} {
  const fallback = configToPlan(ctx.deps.getConfig());
  let plan = fallback;
  if (args?.plan !== undefined) {
    try {
      const shaped = assertPlanShape(args.plan);
      if (shaped.slots.length >= 3 && shaped.slots.every((s) => s.heroId && s.position)) plan = shaped;
    } catch {
      // 点名武将常被塞进缺 heroId 的 plan。靶子仍用当前配将区。
    }
  }
  let heroIds: string[];
  let skillIds: string[];
  let boxLine: string | undefined;
  if (ctx.box?.strict) {
    if (ctx.box.empty) {
      throw new Error('这位用户还没有 box（没上传过截图 / 还没识别）——先请他把「五星武将」与「五星战法」的截图发到「我的 box」里识别一次，再配将。');
    }
    const heroes = boxHeroCandidates(ctx);
    const skills = boxSkillCandidates(ctx) ?? [];
    if (!heroes?.ids.length) throw new Error(heroes?.note || 'box 里没有能进模拟的武将');
    if (!skills.length) throw new Error('box 里没有能进模拟的可学战法。先上传五星战法截图，再配将。');
    heroIds = heroes.ids;
    skillIds = skills;
    boxLine = heroes.note;
  } else {
    heroIds = HEROES.map((h) => h.id);
    skillIds = [...LEARNABLE_SKILL_IDS];
  }
  const used = new Set<string>();
  for (const raw of args?.usedSkillIds ?? []) {
    const id = resolveSkillId(String(raw), skillIds);
    if (!id) throw new Error(`「${raw}」不在这次配将的战法池里，不能记成已占用。`);
    used.add(id);
  }
  if (used.size) skillIds = skillIds.filter((id) => !used.has(id));
  const template = templateIdOf(args?.template);
  const salvaged = salvagePlan(args?.plan, heroIds);
  const locked = args?.heroId ? lockHeroId(args.heroId, heroIds) : salvaged.heroId;
  const askedSkills = (args?.lockSkillIds?.length ? args.lockSkillIds : locked ? salvaged.skillIds : []).map(String);
  const lockSkills: string[] = [];
  for (const raw of askedSkills) {
    const id = resolveSkillId(raw, skillIds);
    if (!id) throw new Error(`「${raw}」不在这次配将的战法池里。`);
    if (!lockSkills.includes(id)) lockSkills.push(id);
    if (lockSkills.length >= 2) break;
  }
  const coarseRuns = Math.max(1, Math.floor(Number(args?.coarseRuns) || COARSE_RUNS_DEFAULT));
  const finalRuns = Math.max(MATCHUP_RUNS_MIN, Math.floor(Number(args?.finalRuns) || MATCHUP_RUNS_MIN));
  const opponents = Math.max(1, ctx.deps.listOpponentPool().entries.length);
  const templateCount = template ? 1 : locked ? Math.max(1, templatesForHero(locked, heroIds, skillIds).length) : 4;
  const fit = fitTemplateBudget({
    templates: templateCount,
    opponents,
    candidates: skillIds.length,
    coarseRuns,
    finalRuns,
    remaining: Math.max(0, ctx.budget.maxBattles - ctx.budget.battles),
  });
  if (fit.est > ctx.budget.maxBattles - ctx.budget.battles) {
    throw new Error(
      `模板配将按现在的对手池（${opponents} 支、${templateCount} 套模板）至少要 ${fit.est.toLocaleString('en-US')} 场，本轮只剩 ${(ctx.budget.maxBattles - ctx.budget.battles).toLocaleString('en-US')} 场。点名一名武将或一套模板再跑，或先减少对手。`
    );
  }
  const fitNote = fit.shrunk
    ? `本轮场次不够默认规模，战法候选收到 ${fit.candidates} 个，粗筛改为每对手 ${fit.coarseRuns} 场。冠军仍打每对手 ${finalRuns} 场。`
    : undefined;
  return {
    plan,
    heroIds,
    skillIds,
    ...(template ? { templates: [template] } : {}),
    ...(locked ? { lockHeroId: locked } : {}),
    lockSkillIds: lockSkills,
    coarseRuns: fit.coarseRuns,
    finalRuns,
    skillCap: fit.candidates,
    est: fit.est,
    opponents,
    ...(boxLine ? { boxLine } : {}),
    ...(fitNote ? { fitNote } : {}),
  };
}

function championBrief(c: TemplateChampion): string {
  if (!c.plan) return `${c.label}：${c.reason ?? '没跑成'}`;
  const head = `${c.label}：${c.roleLine}`;
  if (c.passedGate === false) {
    return `${head}\n未过及格线。前三回合胜率 ${pct1(c.guardWinRate ?? 0)}，前三回合输出 ${Math.round(c.meanFirst3 ?? 0)}。`;
  }
  if (!c.matchup) return `${head}\n${c.reason ?? '没有对手池成绩'}`;
  const m = publishMatchup(c.matchup);
  const blade = c.guardWinRate == null ? '' : `三侍卫前三回合胜率 ${pct1(c.guardWinRate)}，前三回合输出 ${Math.round(c.meanFirst3 ?? m.meanFirst3)}。`;
  return `${head}\n综合胜率 ${pct1(m.winRate)} ±${pct1(m.halfWidth)}。八回合总伤 ${m.meanTotal}，前三回合 ${m.meanFirst3}。${blade}分对手 ${oppLine(m.opponents)}。`;
}

/** 分对手胜率压成一行，避免模型以为还得再跑一轮 matchup_pool */
function oppLine(opponents: Array<{ note: string; winRate: number }>): string {
  return opponents.map((o) => `${o.note} ${pct1(o.winRate)}`).join('、');
}

/**
 * 点名核心时的配将流水线报价。
 * 顺序固定：先换另外两名队友（全队可学战法清空）→ 逐个队友填两个战法 → 最后填核心的两个战法。
 */
function lineupQuote(args: WinRateArgs, ctx: ToolCtx): { bare: AdvisorPlan; core: number; others: number[]; est: number; boxLine?: string } {
  const seed = args.plan === undefined ? configToPlan(ctx.deps.getConfig()) : assertPlanShape(args.plan);
  const coreList = heroUnitsOf(seed, [String(args.coreUnit ?? '')]);
  if (coreList.length !== 1) throw new Error('coreUnit 要是大营、中军、前锋，或 0、1、2');
  const core = coreList[0];
  const bare: AdvisorPlan = { ...seed, slots: seed.slots.map((s) => ({ ...s, skillIds: [] })) };
  const others = bare.slots.map((_, i) => i).filter((i) => i !== core);
  const positions = others.map((i) => bare.slots[i].position);
  const shared: WinRateArgs = { ...args, coreUnit: undefined, plan: bare };
  const hero = winrateSetup({ ...shared, matchPositions: positions, matchSlotKeys: undefined }, ctx);
  const skill = winrateSetup({ ...shared, matchPositions: undefined, matchSlotKeys: [`${others[0]}-0`, `${others[0]}-1`] }, ctx);
  return { bare, core, others, est: hero.est + skill.est * (others.length + 1), ...(hero.boxLine || skill.boxLine ? { boxLine: hero.boxLine ?? skill.boxLine } : {}) };
}

/** 跑完配将流水线。每一段只取综合胜率第 1 名接着往下，队友选定后不回头换人。 */
async function runLineup(args: WinRateArgs, ctx: ToolCtx): Promise<ToolResult> {
  const quote = lineupQuote(args, ctx);
  const t0 = Date.now();
  let plan = quote.bare;
  let offset = 0;
  const stages: string[] = [];

  const runStage = async (name: string, stageArgs: WinRateArgs): Promise<{ label: string; matchup: ReturnType<typeof publishMatchup> }> => {
    const setup = winrateSetup(
      { ...args, matchSlotKeys: undefined, matchPositions: undefined, ...stageArgs, coreUnit: undefined, plan },
      ctx
    );
    const searched = await runWinRateSearch({
      base: setup.plan,
      mode: setup.mode,
      holes: setup.holes,
      heroUnits: setup.heroUnits,
      candidateIds: setup.candidateIds,
      coarseRuns: setup.coarseRuns,
      finalRuns: setup.finalRuns,
      finalists: setup.finalists,
      rankBy: setup.rankBy,
      signal: ctx.signal,
      totalBattles: setup.est,
      onProgress: (done, total) =>
        ctx.onProgress?.({ name: 'optimize_winrate', done: offset + done, total: offset + total, label: `${name} 真跑 ${done}/${total} 场` }),
      evalPlan: (p, runs) => ctx.deps.matchup(p, runs, ctx.seed, ctx.signal),
    });
    offset += searched.battles;
    const best = searched.rows[0];
    if (!best) throw new Error(`${name}没有可排的结果`);
    const m = publishMatchup(best.matchup);
    plan = best.plan;
    stages.push(`${name}：${best.label} 综合胜率 ${pct1(m.winRate)} ±${pct1(m.halfWidth)}。分对手 ${oppLine(m.opponents)}`);
    return { label: best.label, matchup: m };
  };

  const positions = quote.others.map((i) => quote.bare.slots[i].position);
  await runStage('队友', { matchPositions: positions });
  for (const u of quote.others) {
    await runStage(`${plan.slots[u].position}战法`, { matchSlotKeys: [`${u}-0`, `${u}-1`] });
  }
  const last = await runStage('核心战法', { matchSlotKeys: [`${quote.core}-0`, `${quote.core}-1`] });

  return {
    evidenceId: nextEvidenceId(ctx, 'optimize_winrate'),
    summary: `配将流水线完成（核心在${quote.bare.slots[quote.core].position}，先队友、再队友战法、最后核心战法）：${last.label} 综合胜率 ${pct1(last.matchup.winRate)} ±${pct1(last.matchup.halfWidth)}。分对手 ${oppLine(last.matchup.opponents)}。`,
    brief: [quote.boxLine ?? '', '顺序固定：队友 → 各队友战法 → 核心战法。核心的可学战法在前两步是空的。当前对手池一次算完。', ...stages]
      .filter(Boolean)
      .join('\n'),
    data: {
      lineup: true,
      coreUnit: quote.bare.slots[quote.core].position,
      plan,
      winRate: last.matchup.winRate,
      winRatePct: last.matchup.winRatePct,
      halfWidth: last.matchup.halfWidth,
      runs: last.matchup.runs,
      meanTotal: last.matchup.meanTotal,
      meanFirst3: last.matchup.meanFirst3,
      worst: last.matchup.worst,
      opponents: last.matchup.opponents,
    },
    stats: { battles: offset, ms: Date.now() - t0, seed: ctx.seed },
  };
}

export function createTools(): ToolSpec<never, ToolCtx>[] {
  const tools: ToolSpec<never, ToolCtx>[] = [
    {
      name: 'get_config',
      description: '读取当前配将区配置（三将 / 等级 / 战法 / 靶子）。任何分析开始前先调它，别凭记忆猜配置。',
      schema: { type: 'object', properties: {}, required: [] },
      cost: {},
      async run(_args, ctx) {
        const cfg = ctx.deps.getConfig();
        const plan = configToPlan(cfg);
        return {
          evidenceId: nextEvidenceId(ctx, 'get_config'),
          summary: `当前配置：${plan.slots.map((s) => `${s.position} ${s.heroId}（${s.skillIds.length} 个可学战法）`).join(' / ')}；靶子 防御 ${plan.dummy.defense} / 谋略 ${plan.dummy.strategy}；士气 ${cfg.morale}、${cfg.rounds} 回合`,
          data: { plan, morale: cfg.morale, rounds: cfg.rounds },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'validate_plan',
      description:
        '校验一个方案是否合法（武将/战法是否在库、每将 ≤2 个可学战法、全队战法唯一、同队互斥、位置齐全）。要提方案前先过这一关；不合法会返回带 code 的错误清单。**用户 box 外的将法不算不合法**（进 `boxIssues`：能看能算，只是「应用」按钮不给点）。',
      schema: { type: 'object', properties: { plan: PLAN_SCHEMA }, required: ['plan'] },
      cost: {},
      async run(args: { plan: unknown }, ctx) {
        const v = validateAdvisorPlan(assertPlanShape(args?.plan), ctx.box ?? null);
        return {
          evidenceId: nextEvidenceId(ctx, 'validate_plan'),
          summary: v.ok
            ? `方案合法（${v.normalized.slots.length} 位：${v.normalized.slots.map((s) => s.heroId).join(' / ')}）${
                v.boxIssues.length ? `；另有 ${v.boxIssues.length} 处 box 外的将法（不算不合法，但不能应用到他的配将区）` : ''
              }`
            : `方案不合法，${v.errors.length} 处问题；首个：${v.errors[0].code} —— ${v.errors[0].message}`,
          brief: v.ok && v.boxIssues.length ? v.boxIssues.map((e) => `${e.code}: ${e.message}`).join('\n') : undefined,
          data: { ok: v.ok, errors: v.errors, boxIssues: v.boxIssues, normalized: v.normalized },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'get_my_box',
      description:
        '读这位用户「我的 box」：他账号**实际拥有**的五星武将 / 战法清单（来自他上传的截图识别 + 复核），带 id 与库内可用性。上下文里那个 `<advisor_box>` 块就是它；这里能拿全量（块被字数截断时用它）。配任何队之前先确认清单。',
      schema: {
        type: 'object',
        properties: { all: { type: 'boolean', description: 'true = 连「库内暂时用不了」的条目一起列（默认只列能进模拟的）' } },
        required: [],
      },
      cost: {},
      async run(args: { all?: boolean }, ctx) {
        const box = ctx.box;
        if (!box || box.empty)
          return {
            evidenceId: nextEvidenceId(ctx, 'get_my_box'),
            summary: '这位用户**还没有 box**（没上传过截图 / 还没识别）——先请他把「五星武将」与「五星战法」的截图发到抽屉的「我的 box」面板里识别一次，再谈配将。',
            data: { empty: true, profile: box?.profileName ?? null },
            stats: { battles: 0, ms: 0, seed: ctx.seed },
          };
        const heroes = heroRows({ heroIds: [...box.heroIds] });
        const skills = skillRows({ skillIds: [...box.skillIds] });
        const showAll = Boolean(args?.all);
        const hOut = showAll ? heroes : heroes.filter((h) => !h.warn);
        const sOut = showAll ? skills : skills.filter((s) => !s.warn);
        const unusable = [...heroes, ...skills].filter((x) => x.warn);
        const line = (r: { id: string; name: string; sub: string; warn?: string }): string => `${r.name}(${r.id}·${r.sub})${r.warn ? `⚠️${r.warn}` : ''}`;
        const teams = packDefenseSystems(sOut.map((s) => s.id));
        const teamLine = `可出队伍 ${teams.length}（最多 ${MAX_DEFENSE_TEAMS}）：${teams.map((id) => DEFENSE_LABEL[id]).join('、') || '凑不齐体系'}`;
        return {
          evidenceId: nextEvidenceId(ctx, 'get_my_box'),
          summary: `box（档案「${box.profileName}」，严格模式${box.strict ? '开' : '关'}）：五星武将 ${heroes.length} 个 / 可学战法 ${skills.length} 个${unusable.length ? `；其中 ${unusable.length} 个库内暂时用不了` : ''}。${teamLine}`,
          brief: [
            teamLine,
            `武将 ${hOut.length}：${hOut.map(line).join(' ')}`,
            `战法 ${sOut.length}：${sOut.map(line).join(' ')}`,
            unusable.length && !showAll ? `（还有 ${unusable.length} 个库内暂时用不了的没列：${unusable.map((x) => x.name).join('、')}——要看就用 all:true）` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          data: {
            profile: box.profileName,
            strict: box.strict,
            heroes: hOut,
            skills: sOut,
            teams: teams.map((id) => DEFENSE_LABEL[id]),
            unusable: unusable.map((x) => ({ name: x.name, id: x.id, why: x.warn })),
          },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'simulate',
      description:
        '对「不还手的木桩」真跑 N 场，按**核心将伤害期望**汇总（默认 20 场，上限 200）。返回三个主数字：**八回合全队总伤 meanTotal**、**前三回合爆发 meanFirst3**（核心将前三回合）、核心将期望 mean（±95% 半宽 halfWidth），另带 byUnit / bySkill / wipedRuns。**比较"带 A 还是带 B"就用它（或 simulate_many）对拍**——两个数字直接比，区间重叠就说"分不出来"。数字只能来自这里，不许自己推算。',
      schema: {
        type: 'object',
        properties: { plan: PLAN_SCHEMA, runs: { type: 'integer', minimum: 1, maximum: SIM_RUNS_MAX } },
        required: ['plan'],
      },
      cost: {
        battles: SIM_RUNS_DEFAULT,
        battlesOf: (args: unknown, ctx: unknown) => {
          const c = ctx as ToolCtx;
          const a = args as { plan?: unknown; runs?: number };
          const runs = Math.max(1, Math.floor(a?.runs ?? SIM_RUNS_DEFAULT));
          try {
            const cfg = cfgOf(assertPlanShape(a?.plan));
            if (c.cache?.has(cacheKeyFor('simulate', cfg, { runs }, c.seed))) return 0;
          } catch {
            /* 方案不合法：让它照常走到工具里报可读的错 */
          }
          return runs;
        },
      },
      async run(args: { plan: unknown; runs?: number }, ctx) {
        const runs = Math.max(1, Math.floor(args?.runs ?? SIM_RUNS_DEFAULT));
        if (runs > SIM_RUNS_MAX) throw new Error(`runs 超上限 ${SIM_RUNS_MAX}（收到 ${runs}）`);
        const plan = assertPlanShape(args?.plan);
        const cfg = cfgOf(plan);
        const key = cacheKeyFor('simulate', cfg, { runs }, ctx.seed);
        const cached = cachedResult(ctx, key, 'simulate');
        if (cached) return cached;
        const t0 = Date.now();
        const s = ctx.deps.evaluate(cfg, runs, coreIndices(plan, cfg));
        const result: ToolResult = {
          evidenceId: nextEvidenceId(ctx, 'simulate'),
          summary: `真跑 ${s.runs} 场：**八回合全队总伤 ${Math.round(s.meanTotal)}**；**前三回合爆发 ${Math.round(s.meanFirst3)}**；核心将伤害期望 ${Math.round(s.mean)} ±${Math.round(s.halfWidth)}（95% 半宽）；木桩被打空 ${s.wipedRuns} 场`,
          brief: planBrief(s),
          data: { ...s, plan: normalizePlan(plan), runs: s.runs },
          stats: { battles: s.runs, ms: Date.now() - t0, seed: ctx.seed },
        };
        remember(ctx, key, result);
        return result;
      },
    },
    {
      name: 'simulate_many',
      description:
        '**一次对拍多套方案**（最多 8 套，每套 runs 场，默认 20），按核心将伤害期望排序返回对比表（每套都给**八回合全队总伤**与**前三回合爆发**）。比较几个搭配 / 「带 A 还是带 B」时用它，**不要一套一套地调 simulate**（省调用次数）。',
      schema: {
        type: 'object',
        properties: {
          plans: {
            type: 'array',
            description: '2~8 套方案；每套结构与 simulate 的 plan 相同',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, plan: PLAN_SCHEMA },
              required: ['plan'],
            },
          },
          runs: { type: 'integer', minimum: 1, maximum: SIM_RUNS_MAX },
        },
        required: ['plans'],
      },
      cost: {
        battles: SIM_RUNS_DEFAULT,
        battlesOf: (args: unknown, ctx: unknown) => {
          const c = ctx as ToolCtx;
          const a = args as { plans?: Array<{ plan?: unknown }>; runs?: number };
          const runs = Math.max(1, Math.floor(a?.runs ?? SIM_RUNS_DEFAULT));
          const n = Array.isArray(a?.plans) ? Math.max(1, a.plans.length) : 1;
          try {
            const cfgs = (a?.plans ?? []).map((x) => cfgOf(assertPlanShape(x?.plan ?? x)));
            if (c.cache?.has(cacheKeyFor('simulate_many', cfgs, { runs }, c.seed))) return 0;
          } catch {
            /* 结构不对：让它照常走到工具里报可读的错 */
          }
          return n * runs;
        },
      },
      async run(args: { plans?: Array<{ label?: string; plan: unknown }>; runs?: number }, ctx) {
        const list = Array.isArray(args?.plans) ? args.plans : [];
        if (!list.length) throw new Error('plans 不能为空：给 2~8 套方案（每套 { label?, plan }）');
        if (list.length > SIM_MANY_MAX) throw new Error(`plans 最多 ${SIM_MANY_MAX} 套（收到 ${list.length}）：先粗筛再精算`);
        const runs = Math.max(1, Math.floor(args?.runs ?? SIM_RUNS_DEFAULT));
        if (runs > SIM_RUNS_MAX) throw new Error(`runs 超上限 ${SIM_RUNS_MAX}（收到 ${runs}）`);
        const key = cacheKeyFor('simulate_many', list.map((x) => cfgOf(assertPlanShape(x?.plan ?? x))), { runs }, ctx.seed);
        const cached = cachedResult(ctx, key, 'simulate_many');
        if (cached) return cached;
        const t0 = Date.now();
        const rows = list.map((item, i) => {
          const plan = assertPlanShape(item?.plan ?? item);
          const cfg = cfgOf(plan);
          const s = ctx.deps.evaluate(cfg, runs, coreIndices(plan, cfg));
          return {
            index: i + 1,
            label: String(item?.label ?? `方案${i + 1}`),
            heroIds: plan.slots.map((x) => x.heroId),
            mean: s.mean,
            halfWidth: s.halfWidth,
            meanTotal: s.meanTotal,
            meanFirst3: s.meanFirst3,
            runs: s.runs,
            sd: s.sd,
            wipedRuns: s.wipedRuns,
            byUnit: s.byUnit,
            topSkills: s.bySkill.slice(0, 3),
            skillIds: plan.slots.flatMap((x) => x.skillIds),
          };
        });
        const ranked = [...rows].sort((a, b) => b.mean - a.mean);
        const brief = [
          `按核心将伤害期望排序（各 ${runs} 场）：`,
          ...ranked.map(
            (r, k) =>
              `${k + 1}. ${r.label} — mean ${Math.round(r.mean)} ±${Math.round(r.halfWidth)}｜**八回合总伤 ${Math.round(r.meanTotal)}**｜**前三回合爆发 ${Math.round(r.meanFirst3)}**｜${r.byUnit
                .slice(0, 3)
                .map((u) => `${u.name} ${Math.round(u.mean)}`)
                .join(' / ')}`
          ),
          ranked.length > 1
            ? `第 1 与第 2 的差距：核心将 ${Math.round(ranked[0].mean - ranked[1].mean)}（半宽之和 ${Math.round(ranked[0].halfWidth + ranked[1].halfWidth)}）、八回合总伤 ${Math.round(ranked[0].meanTotal - ranked[1].meanTotal)}、前三回合爆发 ${Math.round(ranked[0].meanFirst3 - ranked[1].meanFirst3)} —— 差距小于半宽之和就是「分不出来」`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
        return remember(ctx, key, {
          evidenceId: nextEvidenceId(ctx, 'simulate_many'),
          summary: `对拍 ${rows.length} 套 × ${runs} 场：第 1 名「${ranked[0].label}」八回合总伤 ${Math.round(ranked[0].meanTotal)}、前三回合爆发 ${Math.round(ranked[0].meanFirst3)}、核心将期望 ${Math.round(ranked[0].mean)} ±${Math.round(ranked[0].halfWidth)}`,
          brief,
          data: { runs, rows, rankedLabels: ranked.map((r) => r.label) },
          stats: { battles: runs * rows.length, ms: Date.now() - t0, seed: ctx.seed },
        });
      },
    },
    {
      name: 'optimize_skills',
      description:
        '**搜索「这套阵容带哪些战法伤害期望最高」（L2 三阶段真跑搜索）**：逐槽粗筛 → 组合粗筛 → 决赛（≥20 场、与榜首区间重叠会自动加跑），一次调用真跑几千~上万场、约 10~60 秒，返回排序榜单（每行含 95% 半宽、是否与第 1 名并列、每将贡献）。**凡"怎么配输出最高 / 最强"这类问题首选它**——不要自己逐个查战法再手搓几套候选（那样只能撞运气）。',
      schema: {
        type: 'object',
        properties: {
          plan: PLAN_SCHEMA,
          coarseRuns: { type: 'integer', minimum: 1, maximum: 10, description: '粗筛场次（默认 3；只用于淘汰）' },
          finalRuns: { type: 'integer', minimum: 20, maximum: 200, description: '决赛场次（默认 20，低于 20 一律抬回 20）' },
          coarseTop: { type: 'integer', minimum: 2, maximum: 64, description: '进决赛的组合数（默认 32）' },
          candidateSkillIds: { type: 'array', items: { type: 'string' }, description: '只在这些战法里搜（缺省 = 全部可学战法 − 队内已占用）；缩小范围能大幅省时间' },
          matchSlotKeys: { type: 'array', items: { type: 'string' }, description: '只搜这些槽位（"将下标-槽下标"，如 "0-1"）；缺省 = 全部空槽' },
          topN: { type: 'integer', minimum: 1, maximum: 10, description: '返回前几名（默认 5）' },
        },
        required: [],
      },
      cost: {
        long: true,
        battlesOf: (args, ctx) => {
          const c = ctx as ToolCtx;
          const { cfg, options } = skillSearchSetup(args as never, c);
          if (c.cache?.has(cacheKeyFor('optimize_skills', cfg, options, c.seed))) return 0; // 命中不花场次
          return c.deps.estimateSkillBattles(cfg, options);
        },
      },
      async run(args: { topN?: number } & Parameters<typeof skillSearchSetup>[0], ctx) {
        const { cfg, options, boxLine } = skillSearchSetup(args, ctx);
        const est = ctx.deps.estimateSkillBattles(cfg, options);
        const key = cacheKeyFor('optimize_skills', cfg, options, ctx.seed);
        const cached = cachedResult(ctx, key, 'optimize_skills');
        if (cached) return cached;
        const t0 = Date.now();
        const res = await ctx.deps.optimizeSkills(cfg, options, forwardProgress(ctx, 'optimize_skills'), ctx.signal);
        const topN = Math.min(10, Math.max(1, Math.floor(Number(args?.topN) || 5)));
        const rows = res.finals.slice(0, topN).map((f) => ({
          rank: f.rank,
          label: f.label,
          mean: f.mean,
          halfWidth: f.halfWidth,
          runs: f.runs,
          meanTotal: f.meanTotal,
          tieWithBest: f.tieWithBest,
          wipedRuns: f.wipedRuns,
          picks: f.picks.map((p) => ({ unit: p.unit, unitName: p.unitName, slot: p.slot, skillId: p.skillId, skillName: p.skillName })),
          byUnit: f.byUnit,
        }));
        return remember(ctx, key, {
          evidenceId: nextEvidenceId(ctx, 'optimize_skills'),
          summary: rows.length
            ? `搜索完成（真跑 ${res.battles} 场 / ${Math.round(res.ms / 1000)}s）：第 1 名「${rows[0].label}」核心将期望 ${Math.round(rows[0].mean)} ±${Math.round(rows[0].halfWidth)}（${rows[0].runs} 场）`
            : '搜索没有产出可排行的结果（检查参与匹配的槽位是否都已有战法）',
          brief: rows.length
            ? searchBrief({
                title: '战法搜索',
                rows,
                est,
                battles: res.battles,
                ms: res.ms,
                tiesWithBest: res.tiesWithBest,
                matchLabel: res.matchLabel,
                coreLabel: res.coreLabel,
                extraLines: [
                  ...(boxLine ? [boxLine] : []),
                  `候选战法 ${res.candidateCount} 个（被排除 ${res.candidateSkipped}）；进决赛 ${res.finals.length} 支；粗筛 vs 决赛排序一致率 ${(res.rankAgreement * 100).toFixed(0)}%${res.combosCapped ? '；**组合被上限截断**（有更靠后的没评估）' : ''}${res.wipedCombos ? '；**有组合把木桩打空**（期望偏低）' : ''}`,
                ],
              })
            : '没有可排行的结果',
          data: {
            rows,
            meta: {
              battles: res.battles,
              ms: res.ms,
              estimate: est,
              tiesWithBest: res.tiesWithBest,
              rankAgreement: res.rankAgreement,
              wipedCombos: res.wipedCombos,
              combosCapped: res.combosCapped,
              candidateCount: res.candidateCount,
              candidateSkipped: res.candidateSkipped,
              matchLabel: res.matchLabel,
              coreLabel: res.coreLabel,
              noEmptySlot: res.noEmptySlot,
            },
          },
          stats: { battles: res.battles, ms: Date.now() - t0, seed: ctx.seed },
        });
      },
    },
    {
      name: 'optimize_mates',
      description:
        '**搜索「围绕核心将，换哪个队友（或哪两个）最强」（L3 真跑搜索）**：队友位当空槽，逐位/成对粗筛 → 组合榜单 → 决赛（≥20 场），约 3~60 秒，返回排序榜单 + 与当前队友的对照基线。问"和谁搭最强"用它。',
      schema: {
        type: 'object',
        properties: {
          plan: PLAN_SCHEMA,
          matchUnits: { type: 'array', items: { type: 'integer' }, description: '参与匹配的队友位下标（最多 2 个；缺省 = 非核心将的全部位）' },
          coarseRuns: { type: 'integer', minimum: 1, maximum: 10 },
          finalRuns: { type: 'integer', minimum: 20, maximum: 200 },
          coarseTop: { type: 'integer', minimum: 2, maximum: 64 },
          candidateHeroIds: { type: 'array', items: { type: 'string' }, description: '只在这些武将里选（缺省 = 上架池 − 队内已上阵 − 互斥）' },
          slotSkills: { type: 'string', enum: ['keep', 'clear'], description: '候选进场带不带该位已配战法（默认 keep：带着当前战法评）' },
          includeOffline: { type: 'boolean', description: '候选池是否含下架武将（默认 false）' },
          topN: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: [],
      },
      cost: {
        long: true,
        battlesOf: (args, ctx) => {
          const c = ctx as ToolCtx;
          const { cfg, options } = mateSearchSetup(args as never, c);
          if (c.cache?.has(cacheKeyFor('optimize_mates', cfg, options, c.seed))) return 0;
          return c.deps.estimateMateBattles(cfg, options);
        },
      },
      async run(args: { topN?: number } & Parameters<typeof mateSearchSetup>[0], ctx) {
        const { cfg, options, boxLine } = mateSearchSetup(args, ctx);
        const est = ctx.deps.estimateMateBattles(cfg, options);
        const key = cacheKeyFor('optimize_mates', cfg, options, ctx.seed);
        const cached = cachedResult(ctx, key, 'optimize_mates');
        if (cached) return cached;
        const t0 = Date.now();
        const res = await ctx.deps.optimizeMates(cfg, options, forwardProgress(ctx, 'optimize_mates'), ctx.signal);
        const topN = Math.min(10, Math.max(1, Math.floor(Number(args?.topN) || 5)));
        const rows = res.finals.slice(0, topN).map((f) => ({
          rank: f.rank,
          label: f.label,
          mean: f.mean,
          halfWidth: f.halfWidth,
          runs: f.runs,
          meanTotal: f.meanTotal,
          wipedRuns: f.wipedRuns,
          picks: f.picks.map((p) => ({ unit: p.unit, unitName: p.unitName, heroId: p.heroId, heroName: p.heroName })),
          byUnit: f.byUnit,
        }));
        const gain = rows.length && res.baseline ? rows[0].mean - res.baseline.mean : 0;
        return remember(ctx, key, {
          evidenceId: nextEvidenceId(ctx, 'optimize_mates'),
          summary: rows.length
            ? `队友搜索完成（真跑 ${res.battles} 场 / ${Math.round(res.ms / 1000)}s）：第 1 名「${rows[0].label}」核心将期望 ${Math.round(rows[0].mean)} ±${Math.round(rows[0].halfWidth)}，比当前队友${gain >= 0 ? '高' : '低'} ${Math.abs(Math.round(gain))}`
            : '没有可排行的队友组合（当前配置可能已无队友位可换）',
          brief: rows.length
            ? searchBrief({
                title: '队友搜索',
                rows,
                est,
                battles: res.battles,
                ms: res.ms,
                tiesWithBest: 0,
                matchLabel: res.matchLabel,
                coreLabel: res.coreLabel,
                extraLines: [
                  ...(boxLine ? [boxLine] : []),
                  `对照基线 = 当前队友（匹配位战法${res.options?.slotSkills === 'clear' ? '已清空' : '保留'}）：mean ${Math.round(res.baseline.mean)} / 全队总伤 ${Math.round(res.baseline.meanTotal)}（${res.baseline.runs} 场）→ 榜首相对基线 ${gain >= 0 ? '+' : ''}${Math.round(gain)}`,
                  `候选武将 ${res.candidateCount} 个（队内已上阵剔除 ${res.candidateSkipped}；同队互斥剔除 ${res.poolSkippedMutual}）；口径：${res.poolLabel}`,
                  '注：**防御 / 控制型队友的价值在这套木桩口径里量不出来**（要看实战得走 L4 胜率）。',
                ],
              })
            : '没有可排行的队友组合',
          data: {
            rows,
            baseline: res.baseline,
            meta: {
              battles: res.battles,
              ms: res.ms,
              estimate: est,
              candidateCount: res.candidateCount,
              poolSkippedMutual: res.poolSkippedMutual,
              matchLabel: res.matchLabel,
              coreLabel: res.coreLabel,
              poolLabel: res.poolLabel,
              noMatchSlot: res.noMatchSlot,
              baselineIllegal: res.baselineIllegal,
            },
          },
          stats: { battles: res.battles, ms: Date.now() - t0, seed: ctx.seed },
        });
      },
    },
    {
      name: 'optimize_both',
      description:
        '**一次把「某将 + 配谁 + 带什么战法」搜完（队友搜索 ↔ 战法搜索交替两轮）**：先搜队友 → 对前几套各搜一次战法 → 拿最好的回头再搜一轮队友。约 30~120 秒、上万场。只有"完整最强配置/输出最大化"这类问题才用它；只想知道战法用 optimize_skills、只想知道队友用 optimize_mates。',
      schema: {
        type: 'object',
        properties: {
          plan: PLAN_SCHEMA,
          rounds: { type: 'integer', minimum: 1, maximum: 3, description: '交替轮数（默认 2）' },
          mateTop: { type: 'integer', minimum: 1, maximum: 4, description: '每轮取前几套队友进战法搜索（默认 3）' },
          finalRuns: { type: 'integer', minimum: 20, maximum: 200, description: '决赛场次（默认 20）' },
          coarseRuns: { type: 'integer', minimum: 1, maximum: 10, description: '粗筛场次（默认 2；只用于淘汰）' },
          coarseTop: { type: 'integer', minimum: 2, maximum: 64, description: '进决赛的战法组合数（默认 8）' },
          matchUnits: { type: 'array', items: { type: 'integer' }, description: '参与匹配的队友位下标（最多 2 个）' },
          candidateHeroIds: { type: 'array', items: { type: 'string' }, description: '队友只在这些武将里选（缩小范围能省很多时间）' },
          candidateSkillIds: { type: 'array', items: { type: 'string' }, description: '战法只在这些里搜' },
          topN: { type: 'integer', minimum: 1, maximum: 10, description: '返回前几名（默认 5）' },
        },
        required: [],
      },
      cost: {
        long: true,
        battlesOf: (args, ctx) => {
          const c = ctx as ToolCtx;
          const s = bothSetup(args as never, c);
          if (c.cache?.has(cacheKeyFor('optimize_both', s.cfg, { m: s.mateOptions, k: s.skillOptions, r: s.rounds, t: s.mateTop }, c.seed))) return 0;
          return estimateBoth(c, s);
        },
      },
      async run(args: { topN?: number } & Parameters<typeof bothSetup>[0], ctx) {
        const s = bothSetup(args, ctx);
        const est = estimateBoth(ctx, s);
        const key = cacheKeyFor('optimize_both', s.cfg, { m: s.mateOptions, k: s.skillOptions, r: s.rounds, t: s.mateTop }, ctx.seed);
        const cached = cachedResult(ctx, key, 'optimize_both');
        if (cached) return cached;
        const t0 = Date.now();
        const prog = (label: string) => (done: number, total: number) => {
          throwIfAborted(ctx.signal);
          ctx.onProgress?.({ name: 'optimize_both', done, total, label });
        };
        interface Cand {
          stage: string;
          label: string;
          heroIds: string[];
          cfg: ViewCfg;
          mean: number;
          halfWidth: number;
          runs: number;
          meanTotal: number;
          byUnit: Array<{ unit: number; name: string; mean: number; core: boolean }>;
          skillLabel: string;
        }
        const cands: Cand[] = [];
        let spent = 0; // 本工具自己真跑的场次（预算里记的是整轮累计，不能拿来当自己的代价）

        // ── 第 1 轮：队友 → 每套各搜一次战法 ──
        const mate1 = await ctx.deps.optimizeMates(s.cfg, s.mateOptions, prog('第 1 轮 · 搜队友'), ctx.signal);
        spent += mate1.battles;
        const combos = mate1.finals.slice(0, s.mateTop);
        for (let i = 0; i < combos.length; i += 1) {
          const c = combos[i];
          const cfg2 = ctx.deps.applyCombo(s.cfg, c.picks.map((p) => ({ unit: p.unit, heroId: p.heroId })), true);
          const sk = await ctx.deps.optimizeSkills(cfg2, s.skillOptions, prog(`第 1 轮 · 搜战法（${i + 1}/${combos.length}）`), ctx.signal);
          spent += sk.battles;
          const best = sk.finals[0];
          const cfgWithSkills = best ? withSkillPicks(cfg2, best.picks) : cfg2;
          cands.push({
            stage: '第 1 轮',
            label: `${c.label}${best ? ` + ${best.label}` : ''}`,
            heroIds: cfgWithSkills.slots.map((x) => x.heroId),
            cfg: cfgWithSkills,
            mean: best?.mean ?? 0,
            halfWidth: best?.halfWidth ?? 0,
            runs: best?.runs ?? 0,
            meanTotal: best?.meanTotal ?? 0,
            byUnit: (best?.byUnit ?? []) as Cand['byUnit'],
            skillLabel: best?.label ?? '（没搜到战法）',
          });
        }
        cands.sort((a, b) => b.mean - a.mean);

        // ── 第 2 轮：拿榜首（带战法）回头再搜一轮队友；更好就对它再搜一次战法 ──
        if (s.rounds > 1 && cands.length) {
          const top = cands[0];
          const mate2 = await ctx.deps.optimizeMates(
            top.cfg,
            { ...s.mateOptions, slotSkills: 'keep' },
            prog('第 2 轮 · 搜队友（固定战法）'),
            ctx.signal
          );
          spent += mate2.battles;
          const c2 = mate2.finals[0];
          if (c2) {
            const cfg3 = ctx.deps.applyCombo(top.cfg, c2.picks.map((p) => ({ unit: p.unit, heroId: p.heroId })), false);
            const sk2 = await ctx.deps.optimizeSkills(cfg3, s.skillOptions, prog('第 2 轮 · 搜战法'), ctx.signal);
            spent += sk2.battles;
            const best2 = sk2.finals[0];
            const cfg4 = best2 ? withSkillPicks(cfg3, best2.picks) : cfg3;
            cands.push({
              stage: '第 2 轮',
              label: `${c2.label}${best2 ? ` + ${best2.label}` : ''}`,
              heroIds: cfg4.slots.map((x) => x.heroId),
              cfg: cfg4,
              mean: best2?.mean ?? c2.mean,
              halfWidth: best2?.halfWidth ?? c2.halfWidth,
              runs: best2?.runs ?? c2.runs,
              meanTotal: best2?.meanTotal ?? c2.meanTotal,
              byUnit: (best2?.byUnit ?? c2.byUnit) as Cand['byUnit'],
              skillLabel: best2?.label ?? '（沿用上一轮战法）',
            });
          }
        }

        // 去重（同一套三将 + 同一套战法只留最好的一次），再排序
        const uniq = new Map<string, Cand>();
        for (const c of cands) {
          const sig = `${c.heroIds.join('|')}::${c.skillLabel}`;
          const old = uniq.get(sig);
          if (!old || c.stage === '第 2 轮') uniq.set(sig, c);
        }
        const ranked = [...uniq.values()].sort((a, b) => b.mean - a.mean);
        const topN = Math.min(10, Math.max(1, Math.floor(Number(args?.topN) || 5)));
        const rows = ranked.slice(0, topN);
        const first = rows[0];
        const plan6 = first ? configToPlan(first.cfg) : null;
        const line = (c: Cand, i: number): string =>
          `${i + 1}. [${c.stage}] ${c.label} — 核心将期望 ${Math.round(c.mean)} ±${Math.round(c.halfWidth)}（${c.runs} 场）｜全队总伤 ${Math.round(c.meanTotal)}`;
        const brief = [
          `整体搜索：${s.rounds} 轮交替（队友 → 战法${s.rounds > 1 ? ' → 队友 → 战法' : ''}）；真跑 ${rows.length} 套进榜`,
          ...s.boxLines,
          ...rows.map(line),
          rows.length > 1
            ? `第 1 与第 2 差距 ${Math.abs(Math.round(rows[0].mean - rows[1].mean))}，半宽之和 ${Math.round(rows[0].halfWidth + rows[1].halfWidth)} → ${
                Math.abs(rows[0].mean - rows[1].mean) <= rows[0].halfWidth + rows[1].halfWidth ? '**分不出来**' : '分得开'
              }`
            : '',
          `队伍：${first ? first.heroIds.join(' / ') : '—'}；战法：${first?.skillLabel ?? '—'}`,
        ]
          .filter(Boolean)
          .join('\n');
        return remember(ctx, key, {
          evidenceId: nextEvidenceId(ctx, 'optimize_both'),
          summary: first
            ? `整体搜索完成（${rows.length} 套进榜）：第 1 名「${first.label}」核心将期望 ${Math.round(first.mean)} ±${Math.round(first.halfWidth)}（${first.runs} 场）`
            : '整体搜索没有产出可排行的结果',
          brief,
          data: {
            rows,
            plan: plan6,
            meta: {
              rounds: s.rounds,
              mateTop: s.mateTop,
              estimate: est,
              mateLabel: mate1.matchLabel,
              coreLabel: mate1.coreLabel,
              candidates: mate1.candidateCount,
              stageCount: cands.length,
            },
          },
          stats: { battles: spent, ms: Date.now() - t0, seed: ctx.seed },
        });
      },
    },
    {
      name: 'search_hero',
      description:
        '按 名字 / 势力 / 兵种 / 主战法名 / id / 拼音 检索武将（空白分词 AND），返回候选与 id。拿不准 id 时先搜。**检索不受 box 限制**（标 `✓你有` / `✗你没有` 只作提示：只有"给你自己配将出方案"时才要求用 ✓ 的）。空结果会给换词提示，不要拿同一个词反复重试。',
      schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'] },
      cost: {},
      async run(args: { q: string; limit?: number }, ctx) {
        const hits = ctx.deps.searchHeroes(String(args?.q ?? ''), args?.limit ?? 12);
        const outside = hits.filter((h) => !(boxOn(ctx)?.heroIds.has(h.id) ?? true)).length;
        const note = boxNote(ctx, 'hero', outside);
        return {
          evidenceId: nextEvidenceId(ctx, 'search_hero'),
          summary: hits.length
            ? `命中 ${hits.length} 个武将：${hits.map((h) => `${h.name}(${h.id})${boxMark(ctx, 'hero', h.id)}`).join('、')}`
            : `没有匹配「${args?.q}」的武将`,
          brief: [note, hits.length ? '' : EMPTY_HINT].filter(Boolean).join('\n'),
          data: { q: args?.q ?? '', hits },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'hero_detail',
      description:
        '查一个武将的档案：阵营 / 兵种 / 攻击距离 / 40 级四维 / 成长率 / 主战法（名字 + 官方描述）/ 是否上架。**要给某个武将配队配战法之前必须先调它**——不看档案就配是猜。',
      schema: { type: 'object', properties: { id: { type: 'string', description: '武将 id，如 h498' } }, required: ['id'] },
      cost: {},
      async run(args: { id: string }, ctx) {
        const d = ctx.deps.heroDetail(String(args?.id ?? '')) as {
          found?: boolean;
          name?: string;
          troopType?: string;
          listed?: boolean;
          offlineReason?: string | null;
          mainSkillName?: string;
          mainSkillDesc?: string;
          stats40?: { attack: number; defense: number; strategy: number; speed: number };
        };
        const warn = d.found && d.listed === false ? `⚠️ 该武将**已下架**：${d.offlineReason ?? ''}——用它的模拟数值会系统性偏低，只能看方向，别当结论。` : '';
        return {
          evidenceId: nextEvidenceId(ctx, 'hero_detail'),
          summary: d.found
            ? `${d.name}（${d.troopType}${d.listed === false ? '·已下架' : ''}）：主战法「${d.mainSkillName}」；40 级 攻 ${d.stats40?.attack} / 防 ${d.stats40?.defense} / 谋 ${d.stats40?.strategy} / 速 ${d.stats40?.speed}`
            : `武将「${args?.id}」不在库`,
          brief: d.found
            ? [`主战法「${d.mainSkillName}」：${d.mainSkillDesc ?? ''}`, warn].filter(Boolean).join('\n')
            : EMPTY_HINT,
          data: d,
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'search_skill',
      description:
        '按 名字 / 出手位（主动/追击/被动/一类指挥/二类指挥/准备）/ 品级（S/A/B/C/D）/ 效果标签 / 官方描述关键词 检索可学习战法（不含武将主战法）。**检索不受 box 限制**（标 `✓你有` / `✗你没有` 只作提示）。空结果会给换词提示。',
      schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'] },
      cost: {},
      async run(args: { q: string; limit?: number }, ctx) {
        const hits = ctx.deps.searchSkills(String(args?.q ?? ''), args?.limit ?? 15);
        const outside = hits.filter((h) => !(boxOn(ctx)?.skillIds.has(h.id) ?? true)).length;
        const note = boxNote(ctx, 'skill', outside);
        return {
          evidenceId: nextEvidenceId(ctx, 'search_skill'),
          summary: hits.length
            ? `命中 ${hits.length} 个战法：${hits.map((h) => `${h.name}(${h.id})${boxMark(ctx, 'skill', h.id)}`).join('、')}`
            : `没有匹配「${args?.q}」的战法`,
          brief: [note, hits.length ? '' : EMPTY_HINT].filter(Boolean).join('\n'),
          data: { q: args?.q ?? '', hits },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'list_skills',
      description:
        '批量浏览可学习战法池（按出手位分页），用来「拉齐某一类池子」——比逐个词搜省调用次数。返回 id / 名字 / 出手位 / 品级。**不受 box 限制**（标 `✓你有` / `✗你没有` 只作提示）。',
      schema: {
        type: 'object',
        properties: {
          slot: { type: 'string', description: '出手位（主动 / 追击 / 被动 / 一类指挥 / 二类指挥 / 准备）；不传 = 全部' },
          offset: { type: 'integer' },
          limit: { type: 'integer', description: '缺省 30，上限 80' },
        },
        required: [],
      },
      cost: {},
      async run(args: { slot?: string; offset?: number; limit?: number }, ctx) {
        const slot = String(args?.slot ?? '').trim();
        const all = slot ? SKILL_MATCH.filter((s) => s.slot.includes(slot) || s.slotKey.includes(slot)) : SKILL_MATCH;
        const outside = all.filter((s) => !(boxOn(ctx)?.skillIds.has(s.id) ?? true)).length;
        const note = boxNote(ctx, 'skill', outside);
        const offset = Math.max(0, Math.floor(args?.offset ?? 0));
        const limit = Math.min(80, Math.max(1, Math.floor(args?.limit ?? 30)));
        const rows = all.slice(offset, offset + limit).map((s) => ({ id: s.id, name: s.name, slot: s.slot, grade: s.grade }));
        return {
          evidenceId: nextEvidenceId(ctx, 'list_skills'),
          summary: `战法池${slot ? `（${slot}）` : ''}共 ${all.length} 个，本次返回第 ${offset + 1}~${offset + rows.length} 个：${rows.map((r) => `${r.name}${boxMark(ctx, 'skill', r.id)}`).join('、') || '（空）'}`,
          brief: [
            note,
            all.length > offset + rows.length
              ? `还有 ${all.length - offset - rows.length} 个没返回 —— 需要就再调一次（offset=${offset + rows.length}）。`
              : '已到池底。',
          ]
            .filter(Boolean)
            .join('\n'),
          data: { slot: slot || null, total: all.length, offset, rows },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'skill_detail',
      description: '查一个战法的完整信息（品级 / 出手位 / 官方描述）。',
      schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      cost: {},
      async run(args: { id: string }, ctx) {
        const detail = ctx.deps.skillDetail(String(args?.id ?? ''));
        const found = Boolean((detail as { found?: boolean })?.found);
        return {
          evidenceId: nextEvidenceId(ctx, 'skill_detail'),
          summary: found ? `${args?.id}：${(detail as { name?: string }).name ?? ''}` : `战法「${args?.id}」不在库`,
          data: detail,
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'list_opponent_pool',
      description:
        '读合并后的对手池：制作人固定测试集（删不掉，但可逐条开关）+ 用户从阵容预设加进去的队伍。**只列参战中的**——被用户关掉的条目不参与胜率比较，会单独报出来。配将和比较之前先看池子里有谁。毫秒级，不跑战斗。',
      schema: { type: 'object', properties: {} },
      cost: {},
      async run(_args, ctx) {
        const pool = ctx.deps.listOpponentPool();
        const off = pool.entries.filter((e) => e.enabled === false);
        const rows = pool.entries
          .filter((e) => e.enabled !== false)
          .map((e) => ({ id: e.id, note: e.note, source: e.source, presetId: e.presetId ?? null }));
        const offNote = off.length ? `；另有 ${off.length} 支已被用户关闭、不参与比较：${off.map((e) => e.note).join('、')}` : '';
        return {
          evidenceId: nextEvidenceId(ctx, 'list_opponent_pool'),
          summary: `对手池 ${pool.version}：参战 ${rows.length} 支（固定 ${rows.filter((r) => r.source === 'benchmark').length}，自加 ${rows.filter((r) => r.source === 'user').length}）。${rows.map((r) => `${r.note}（${r.source === 'benchmark' ? '固定' : '自加'}）`).join('、') || '空'}${offNote}`,
          brief:
            rows.map((r) => `· ${r.id} ${r.note} ${r.source}${r.presetId ? ` 预设 ${r.presetId}` : ''}`).join('\n') +
            (off.length ? `\n${off.map((e) => `× ${e.id} ${e.note}（已关闭，不参与比较）`).join('\n')}` : ''),
          data: {
            version: pool.version,
            fingerprint: poolFingerprint(pool),
            rows,
            disabled: off.map((e) => ({ id: e.id, note: e.note })),
          },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'add_opponent_from_preset',
      description:
        '把一条阵容预设加入对手池（只进用户添加，不动固定测试集）。同预设再加一次会用当前配置覆盖。必须等用户确认后才写。',
      schema: { type: 'object', properties: { presetId: { type: 'string', description: '预设 id' } }, required: ['presetId'] },
      cost: {},
      async run(args: { presetId: string }, ctx) {
        const presetId = String(args?.presetId ?? '');
        await confirmWrite(ctx, 'add_opponent_from_preset', `把预设 ${presetId} 加入对手池`);
        const res = ctx.deps.addOpponentFromPreset(presetId);
        if (!res.ok) throw new Error(res.message);
        return {
          evidenceId: nextEvidenceId(ctx, 'add_opponent_from_preset'),
          summary: res.message,
          data: res,
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'remove_user_opponent',
      description: '从对手池移出用户自己加的一支。固定测试集没有删除入口，传固定集 id 会失败。必须等用户确认后才写。',
      schema: { type: 'object', properties: { id: { type: 'string', description: '对手条目 id（list_opponent_pool 返回的）' } }, required: ['id'] },
      cost: {},
      async run(args: { id: string }, ctx) {
        const id = String(args?.id ?? '');
        await confirmWrite(ctx, 'remove_user_opponent', `从对手池移出 ${id}`);
        const res = ctx.deps.removeUserOpponent(id);
        if (!res.ok) throw new Error(res.message);
        return {
          evidenceId: nextEvidenceId(ctx, 'remove_user_opponent'),
          summary: res.message,
          data: res,
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'matchup_pool',
      description:
        '**一套方案打完整份对手池**。主数字是综合胜率（胜场=斩首胜+优势平，平局=劣势平+完全平，败场=斩首负），并给出对每一支对手的胜/平/负。八回合总伤和前三回合伤害来自同一批对打，只作辅助。每个对手至少 100 场（正反场地）。低于 100 会抬回 100。',
      schema: {
        type: 'object',
        properties: {
          plan: PLAN_SCHEMA,
          runsPerOpponent: { type: 'integer', minimum: 100, maximum: 500, description: '每个对手的场次，默认 100，低于 100 一律抬回 100' },
        },
        required: [],
      },
      cost: {
        battlesOf: (args, ctx) => {
          const c = ctx as ToolCtx;
          const runs = Math.max(MATCHUP_RUNS_MIN, Math.floor(Number((args as { runsPerOpponent?: number })?.runsPerOpponent) || MATCHUP_RUNS_MIN));
          return runs * Math.max(1, c.deps.listOpponentPool().entries.length);
        },
      },
      async run(args: { plan?: unknown; runsPerOpponent?: number }, ctx) {
        const plan = args?.plan === undefined ? configToPlan(ctx.deps.getConfig()) : assertPlanShape(args.plan);
        const runs = Math.max(MATCHUP_RUNS_MIN, Math.floor(Number(args?.runsPerOpponent) || MATCHUP_RUNS_MIN));
        const t0 = Date.now();
        const raw = await ctx.deps.matchup(plan, runs, ctx.seed, ctx.signal, forwardProgress(ctx, 'matchup_pool'));
        const data = publishMatchup(raw);
        return {
          evidenceId: nextEvidenceId(ctx, 'matchup_pool'),
          summary: `综合胜率 ${pct1(data.winRate)} ±${pct1(data.halfWidth)}，最差 ${data.worst.note} ${pct1(data.worst.winRate)}；八回合总伤 ${data.meanTotal}，前三回合 ${data.meanFirst3}（${data.runs} 场）`,
          brief: matchupLines(data),
          data,
          stats: { battles: data.battles, ms: Date.now() - t0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'compare_variants',
      description:
        '**只换一处**的前后对比：同一套阵容只换一个武将或一个可学战法，两套都打完整份对手池（每对手至少 100 场）。返回综合胜率差（百分点）、八回合总伤差、前三回合差，以及 95% 区间是否分得出来。动了两处会直接拒绝。比较不受 box 限制。',
      schema: {
        type: 'object',
        properties: {
          before: PLAN_SCHEMA,
          after: PLAN_SCHEMA,
          runsPerOpponent: { type: 'integer', minimum: 100, maximum: 500 },
        },
        required: ['before', 'after'],
      },
      cost: {
        battlesOf: (args, ctx) => {
          const c = ctx as ToolCtx;
          const runs = Math.max(MATCHUP_RUNS_MIN, Math.floor(Number((args as { runsPerOpponent?: number })?.runsPerOpponent) || MATCHUP_RUNS_MIN));
          return runs * Math.max(1, c.deps.listOpponentPool().entries.length) * 2;
        },
      },
      async run(args: { before?: unknown; after?: unknown; runsPerOpponent?: number }, ctx) {
        const beforePlan = assertPlanShape(args?.before);
        const afterPlan = assertPlanShape(args?.after);
        const change = singleChangeBetween(beforePlan, afterPlan);
        if (!change.ok) throw new Error(change.reason);
        const runs = Math.max(MATCHUP_RUNS_MIN, Math.floor(Number(args?.runsPerOpponent) || MATCHUP_RUNS_MIN));
        const t0 = Date.now();
        const before = publishMatchup(await ctx.deps.matchup(beforePlan, runs, ctx.seed, ctx.signal, forwardProgress(ctx, 'compare_variants')));
        const after = publishMatchup(await ctx.deps.matchup(afterPlan, runs, ctx.seed, ctx.signal, forwardProgress(ctx, 'compare_variants')));
        const distinguishable = !ratesIndistinguishable(before, after);
        const delta = {
          winRate: after.winRate - before.winRate,
          winRatePct: Math.round((after.winRate - before.winRate) * 1000) / 10,
          meanTotal: after.meanTotal - before.meanTotal,
          meanFirst3: after.meanFirst3 - before.meanFirst3,
        };
        const verdict = distinguishable ? `分得出来：综合胜率 ${delta.winRatePct >= 0 ? '+' : ''}${delta.winRatePct} 个百分点` : '分不出来（95% 区间重叠）';
        return {
          evidenceId: nextEvidenceId(ctx, 'compare_variants'),
          summary: `只换了${change.label}。之前 ${pct1(before.winRate)} → 之后 ${pct1(after.winRate)}（${verdict}）。八回合总伤 ${delta.meanTotal >= 0 ? '+' : ''}${delta.meanTotal}，前三回合 ${delta.meanFirst3 >= 0 ? '+' : ''}${delta.meanFirst3}。`,
          brief: [`变化：${change.label}`, `之前\n${matchupLines(before)}`, `之后\n${matchupLines(after)}`, verdict].join('\n'),
          data: {
            change: change.label,
            distinguishable,
            delta,
            before,
            after,
            winRate: after.winRate,
            winRatePct: after.winRatePct,
            halfWidth: after.halfWidth,
            runs: after.runs,
            meanTotal: after.meanTotal,
            meanFirst3: after.meanFirst3,
            worst: after.worst,
            opponents: after.opponents,
            fingerprint: after.fingerprint,
            baseSeed: after.baseSeed,
          },
          stats: { battles: before.battles + after.battles, ms: Date.now() - t0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'optimize_template',
      description:
        '**给我配 / 最强阵容**。先按主战法结构套进标准队、半肉反击、菜刀、神赏法刀，并锁上一套防守体系（战磐 / 神赏 / 双减 / 百战 / 双封 / 垒石；速度快的辅助可再锁攻其不备），每套先配将再搜该角色的战法，再用对手池综合胜率在过线的冠军里选一支。没点名就跑能凑齐的模板。点名武将只传 heroId（不要传 plan，也不要自己拼三个槽）。他指定携带的战法传 lockSkillIds（id 或中文名，最多 2 个），该格锁死不再搜。box 写了可出几队就出几队（最多 5），每队一套；下一队把前面占用的 A/S 放进 usedSkillIds。法刀要在会还手的三侍卫上、前三回合胜率达到 90% 才参加最后比较；没过线的简报写「未过及格线」，不要当成推荐。返回里的胜率、前三回合输出和防守体系说明是唯一可引用的说法。已经定好的队伍只换一两个槽用 optimize_winrate。',
      schema: {
        type: 'object',
        properties: {
          template: { type: 'string', enum: ['standard', 'counter', 'blade', 'shenshang'], description: '只跑这一套。缺省 = 能凑齐的都跑。standard 标准队 / counter 半肉反击 / blade 菜刀 / shenshang 神赏法刀' },
          heroId: { type: 'string', description: '点名的武将 id。只跑他能进的模板，并锁在对应格子上。不要把武将写进 plan' },
          lockSkillIds: { type: 'array', items: { type: 'string' }, description: '这名武将必须携带的可学战法，id 或中文名，最多 2 个。例：["一夫当关","百战无怯"]' },
          usedSkillIds: { type: 'array', items: { type: 'string' }, description: '已经分给别的队伍的 A/S 战法，id 或中文名。这一队的候选里去掉它们' },
          coarseRuns: { type: 'integer', minimum: 1, maximum: 100, description: '粗筛每个对手的场次，默认 20。预算不够时工具会自己收小' },
          finalRuns: { type: 'integer', minimum: 100, maximum: 500, description: '冠军打对手池时每个对手的场次，默认 100，低于 100 抬回 100' },
        },
        required: [],
      },
      cost: {
        long: true,
        battlesOf: (args, ctx) => templateSetup((args ?? {}) as TemplateArgs, ctx as ToolCtx).est,
      },
      async run(args: TemplateArgs, ctx) {
        const setup = templateSetup(args ?? {}, ctx);
        const gate = ctx.confirmFrom ?? DEFAULT_CONFIRM_BATTLES;
        if (ctx.confirm && setup.est < gate) {
          const ok = await ctx.confirm({
            tool: 'optimize_template',
            battles: setup.est,
            estMs: setup.est * MS_PER_BATTLE,
            label: `模板配将：${setup.opponents} 个对手，预计 ${setup.est.toLocaleString('en-US')} 场 / 约 ${Math.round((setup.est * MS_PER_BATTLE) / 1000)} 秒`,
          });
          if (!ok) throw new Error('用户拒绝了这次模板配将——不要用同样的规模重试');
        }
        const t0 = Date.now();
        const level = setup.plan.slots.find((s) => s.level > 0)?.level ?? 40;
        const result = await runTemplateSearch({
          heroIds: setup.heroIds,
          skillIds: setup.skillIds,
          ...(setup.templates ? { templates: setup.templates } : {}),
          ...(setup.lockHeroId ? { lockHeroId: setup.lockHeroId } : {}),
          ...(setup.lockSkillIds.length ? { lockSkillIds: setup.lockSkillIds } : {}),
          skillCap: setup.skillCap,
          totalBattles: setup.est,
          dummy: setup.plan.dummy,
          level,
          coarseRuns: setup.coarseRuns,
          finalRuns: setup.finalRuns,
          seed: ctx.seed,
          signal: ctx.signal,
          matchup: (plan, runs) => ctx.deps.matchup(plan, runs, ctx.seed, ctx.signal),
          onProgress: (done, total) => ctx.onProgress?.({ name: 'optimize_template', done, total, label: `模板配将 ${done}/${total} 场` }),
        });
        const lines = result.champions.map(championBrief);
        const recommended = result.recommended;
        const rec = result.note
          ? result.note
          : result.tied
            ? '这几支对手池胜率的 95% 区间重叠，分不出来，不硬排。'
            : recommended?.matchup
              ? `推荐 ${recommended.label}。综合胜率 ${pct1(recommended.matchup.winRate)}。`
              : '没有能推荐的队伍。';
        const win = recommended?.matchup;
        return {
          evidenceId: nextEvidenceId(ctx, 'optimize_template'),
          summary: `模板配将完成。${rec}`,
          brief: [setup.boxLine ?? '', setup.fitNote ?? '', ...lines, rec].filter(Boolean).join('\n'),
          data: {
            tied: result.tied,
            note: result.note ?? null,
            recommended: recommended?.template ?? null,
            recommendedLabel: recommended ? TEMPLATE_LABEL[recommended.template] : null,
            winRate: win?.winRate ?? null,
            winRatePct: win ? Math.round(win.winRate * 1000) / 10 : null,
            halfWidth: win?.halfWidth ?? null,
            meanTotal: win ? Math.round(win.meanTotal) : null,
            meanFirst3: win ? Math.round(win.meanFirst3) : null,
            opponents: win?.opponents ?? [],
            plan: recommended?.plan ?? null,
            champions: result.champions.map((c) => ({
              template: c.template,
              label: c.label,
              roleLine: c.roleLine,
              reason: c.reason ?? null,
              passedGate: c.passedGate,
              guardWinRate: c.guardWinRate ?? null,
              meanFirst3: c.meanFirst3 == null ? null : Math.round(c.meanFirst3),
              winRate: c.matchup?.winRate ?? null,
              plan: c.plan,
            })),
          },
          stats: { battles: result.battles, ms: Date.now() - t0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'optimize_winrate',
      description:
        '**在已经定好的队伍上换一两个战法槽或队友位**（两段：粗筛默认每对手 20 场，决赛每对手至少 100 场）。「给我配 / 最强阵容」不要用这个，用 optimize_template。排序键只有综合胜率；用户说要稳、别被克时把 rankBy 设为 worst（按最差对手胜率）。手动一次最多填两个空位。返回里带每一支对手的胜率，不要再为分对手另跑 matchup_pool。',
      schema: {
        type: 'object',
        properties: {
          plan: PLAN_SCHEMA,
          matchSlotKeys: { type: 'array', items: { type: 'string' }, description: '要替换的战法槽，"将下标-槽下标"，如 "0-1"。缺省 = 前两个空着的可学槽' },
          matchPositions: { type: 'array', items: { type: 'string' }, description: '要换的武将位（大营/中军/前锋或下标）。给出则搜武将，不搜战法。与 coreUnit 不要同时用' },
          coreUnit: { type: 'string', description: '点名的核心站在哪：大营 / 中军 / 前锋（或 0 / 1 / 2）。给出后忽略 matchSlotKeys 和 matchPositions，按队友 → 队友战法 → 核心战法一次跑完' },
          candidateSkillIds: { type: 'array', items: { type: 'string' } },
          candidateHeroIds: { type: 'array', items: { type: 'string' } },
          coarseRuns: { type: 'integer', minimum: 1, maximum: 100, description: '粗筛时每个对手的场次，默认 20' },
          finalRuns: { type: 'integer', minimum: 100, maximum: 500, description: '决赛每个对手的场次，默认 100，低于 100 抬回 100' },
          finalists: { type: 'integer', minimum: 1, maximum: 8, description: '决赛留下几套，默认 8' },
          rankBy: { type: 'string', enum: ['winRate', 'worst'], description: 'winRate=综合胜率（默认）；worst=最差对手胜率' },
          topN: { type: 'integer', minimum: 1, maximum: 8 },
        },
        required: [],
      },
      cost: {
        long: true,
        battlesOf: (args, ctx) => {
          const a = (args ?? {}) as WinRateArgs;
          return a.coreUnit ? lineupQuote(a, ctx as ToolCtx).est : winrateSetup(a, ctx as ToolCtx).est;
        },
      },
      async run(args: WinRateArgs & { topN?: number }, ctx) {
        if (args?.coreUnit) return runLineup(args, ctx);
        const setup = winrateSetup(args ?? {}, ctx);
        const gate = ctx.confirmFrom ?? DEFAULT_CONFIRM_BATTLES;
        if (ctx.confirm && setup.est < gate) {
          const ok = await ctx.confirm({
            tool: 'optimize_winrate',
            battles: setup.est,
            estMs: setup.est * MS_PER_BATTLE,
            label: `胜率搜索：${setup.opponents} 个对手，预计 ${setup.est.toLocaleString('en-US')} 场 / 约 ${Math.round((setup.est * MS_PER_BATTLE) / 1000)} 秒`,
          });
          if (!ok) throw new Error('用户拒绝了这次胜率搜索——不要用同样的规模重试');
        }
        const t0 = Date.now();
        const searched = await runWinRateSearch({
          base: setup.plan,
          mode: setup.mode,
          holes: setup.holes,
          heroUnits: setup.heroUnits,
          candidateIds: setup.candidateIds,
          coarseRuns: setup.coarseRuns,
          finalRuns: setup.finalRuns,
          finalists: setup.finalists,
          rankBy: setup.rankBy,
          signal: ctx.signal,
          totalBattles: setup.est,
          onProgress: (done, total) => ctx.onProgress?.({ name: 'optimize_winrate', done, total, label: `真跑 ${done}/${total} 场` }),
          evalPlan: (plan, runs) => ctx.deps.matchup(plan, runs, ctx.seed, ctx.signal),
        });
        const topN = Math.min(8, Math.max(1, Math.floor(Number(args?.topN) || 5)));
        const rows = searched.rows.slice(0, topN).map((row, i) => {
          const m = publishMatchup(row.matchup);
          return {
            rank: i + 1,
            label: row.label,
            tieWithBest: row.tieWithBest,
            plan: row.plan,
            winRate: m.winRate,
            winRatePct: m.winRatePct,
            halfWidth: m.halfWidth,
            runs: m.runs,
            meanTotal: m.meanTotal,
            meanFirst3: m.meanFirst3,
            worst: m.worst,
            opponents: m.opponents,
            fingerprint: m.fingerprint,
          };
        });
        const best = rows[0];
        const baseM = searched.baseline ? publishMatchup(searched.baseline.matchup) : null;
        const gain = best && baseM ? Math.round((best.winRate - baseM.winRate) * 1000) / 10 : 0;
        return {
          evidenceId: nextEvidenceId(ctx, 'optimize_winrate'),
          summary: best
            ? `胜率搜索完成（${searched.rankBy === 'worst' ? '按最差对手' : '按综合胜率'}）：第 1 名「${best.label}」${pct1(best.winRate)} ±${pct1(best.halfWidth)}，比当前 ${gain >= 0 ? '+' : ''}${gain} 个百分点。八回合总伤 ${best.meanTotal}，前三回合 ${best.meanFirst3}。`
            : '没有可排行的结果',
          brief: [
            setup.boxLine ?? '',
            `排序：${searched.rankBy === 'worst' ? '最差对手胜率' : '综合胜率'}。粗筛 ${setup.coarseRuns} 场/对手，决赛 ${setup.finalRuns} 场/对手。`,
            searched.capped ? '候选超过单侧上限，只评估了前 40 个。' : '',
            ...rows.map((r) => `${r.rank}. ${r.label} 胜率 ${pct1(r.winRate)} ±${pct1(r.halfWidth)}${r.tieWithBest ? '（与第 1 名分不出来）' : ''} 总伤 ${r.meanTotal} 前三 ${r.meanFirst3} 最差 ${r.worst.note} ${pct1(r.worst.winRate)}。分对手 ${oppLine(r.opponents)}`),
            baseM ? `当前配置综合胜率 ${pct1(baseM.winRate)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          data: {
            rows,
            baseline: baseM,
            rankBy: searched.rankBy,
            winRate: best?.winRate ?? 0,
            winRatePct: best?.winRatePct ?? 0,
            halfWidth: best?.halfWidth ?? 0,
            runs: best?.runs ?? 0,
            meanTotal: best?.meanTotal ?? 0,
            meanFirst3: best?.meanFirst3 ?? 0,
            worst: best?.worst ?? null,
            opponents: best?.opponents ?? [],
          },
          stats: { battles: searched.battles, ms: Date.now() - t0, seed: ctx.seed },
        };
      },
    },
    // ── 常驻层（二级披露：一级索引 / 二级 schema / 逃生门，见设计文档 §16）──────────
    // 与 router-standard 的 META_TOOLS 同构：这三个**任何档都可调**，且不碰引擎、毫秒返回。
    {
      name: 'tools_catalog',
      description:
        '一级索引：列出**本轮开放**的工具（含参数名）与还没开放的档。任何一轮都可以调。想知道某个工具怎么用查 tools_help；想开新档用 route_task。',
      schema: { type: 'object', properties: {}, required: [] },
      cost: {},
      async run(_args, ctx) {
        const tiers = ctx.route?.tiers() ?? ALL_TIERS;
        const anchor = ctx.route?.anchor() ?? false;
        return {
          evidenceId: nextEvidenceId(ctx, 'tools_catalog'),
          summary: `本轮工具面 ${wireToolNames(tiers, anchor).length} 个（${anchor ? '首轮锚定' : `档：${tiers.join(' + ')}`}）`,
          brief: renderCatalog(createTools(), tiers, anchor),
          data: { tiers, anchor, toolNames: wireToolNames(tiers, anchor) },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'tools_help',
      description:
        '二级索引：某个工具的完整说明与参数 schema，并标明它当前是否开放（没开放就先 route_task 开档再调）。',
      schema: {
        type: 'object',
        properties: { name: { type: 'string', description: '工具名，如 optimize_winrate' } },
        required: ['name'],
      },
      cost: {},
      async run(args: { name?: string }, ctx) {
        const tiers = ctx.route?.tiers() ?? ALL_TIERS;
        const anchor = ctx.route?.anchor() ?? false;
        const text = renderHelp(createTools(), tiers, String(args?.name ?? ''), anchor);
        return {
          evidenceId: nextEvidenceId(ctx, 'tools_help'),
          summary: text.split('\n').slice(0, 3).join('；'),
          brief: text,
          data: { tiers, anchor, name: String(args?.name ?? '') },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'route_task',
      description:
        '逃生门：这一轮确实需要某个**还没开放**的工具时，用它申请开档。tier="search"（大搜索 optimize_* / 胜率搜索）或 "write"（改对手池）。why 写清为什么需要——代码会校验（理由不能空、不能是空口开档），通过后本档当场开放。',
      schema: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['search', 'write'], description: '要开放的档' },
          why: { type: 'string', description: '为什么要开这一档（一句话；会记进本轮路由记录）' },
        },
        required: ['tier', 'why'],
      },
      cost: {},
      async run(args: { tier?: string; why?: string }, ctx) {
        const tier = String(args?.tier ?? '') as AdvisorTier;
        const why = String(args?.why ?? '').trim();
        const r = ctx.route?.promote(tier, why);
        return {
          evidenceId: nextEvidenceId(ctx, 'route_task'),
          summary: r?.message ?? '本轮没有启用分档（全部工具都已开放）——直接调就行。',
          data: { tier, why, ok: r?.ok ?? true, tiers: ctx.route?.tiers() ?? ALL_TIERS },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
  ];
  return tools;
}

/** 按名取工具（找不到就抛——AI 编工具名要暴露出来，不能静默） */
export function toolByName(name: string): ToolSpec<never, ToolCtx> {
  const hit = createTools().find((t) => t.name === name);
  if (!hit) throw new Error(`未知工具「${name}」`);
  return hit;
}

/** 执行一个工具：先过预算护栏（`cost.battlesOf` 按实参 + 真实 `estimateBattles` 预估场次），
 *  **长搜索再过一道「报价 + 确认」**（用户 2026-09-29 口径：开跑前先报场次/耗时，点「开始」才跑）。 */
export async function runTool(name: string, args: unknown, ctx: ToolCtx): Promise<ToolResult> {
  const tool = toolByName(name);
  const battles = tool.cost.battlesOf?.(args, ctx) ?? tool.cost.battles ?? 0;
  try {
    chargeBudget(ctx.budget, { battles }, Date.now());
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      // 拒绝执行，但**把账算给模型看**：它才知道怎么调小规模，而不是反复重试同一个大搜索
      throw new BudgetExceeded(
        e.why,
        `${e.message}（本次 ${name} 预计 ${battles} 场；本轮已用 ${ctx.budget.battles}/${ctx.budget.maxBattles} 场、${ctx.budget.calls}/${ctx.budget.maxCalls} 次调用）——` +
          '可调小 finalRuns / coarseRuns，或用 candidateSkillIds / candidateHeroIds 缩小搜索范围；也可以让用户在界面上提高上限'
      );
    }
    throw e;
  }
  // 报价 + 确认：只拦"贵"的（≥ 阈值且确实要真跑），检索类与 simulate 不打扰用户
  const gate = ctx.confirmFrom ?? DEFAULT_CONFIRM_BATTLES;
  if (ctx.confirm && battles >= gate) {
    const estMs = battles * MS_PER_BATTLE;
    const label = `${toolZh(name)}：预计 ${battles.toLocaleString('en-US')} 场 / 约 ${Math.max(1, Math.round(estMs / 1000))} 秒`;
    const ok = await ctx.confirm({ tool: name, battles, estMs, label });
    if (!ok) {
      // 退回额度（这一轮等于没跑）
      ctx.budget.battles -= battles;
      ctx.budget.calls -= 1;
      throw new Error(
        `用户拒绝了这次搜索（${label}）——不要重试同样的规模：改用更小的范围（candidateSkillIds / candidateHeroIds / 更小的 finalRuns）重试，或者只用已有结果作答，并把「要不要跑完整搜索」交给用户决定`
      );
    }
  }
  const t0 = Date.now();
  try {
    const result = await tool.run(args as never, ctx);
    ctx.budget.ms += Date.now() - t0;
    return result;
  } catch (e) {
    ctx.budget.ms += Date.now() - t0;
    throw e;
  }
}

// ─────────────────────────── 上下文工厂（生产 + 测试共用） ───────────────────────────

export interface MakeCtxOpts {
  /** 真跑换成毫秒返回的假实现（测试用） */
  fakeRuns?: boolean;
  /** 假跑批固定返回的核心将期望（默认 26500） */
  coreDamage?: number;
  budget?: Partial<Budget>;
  seed?: number;
  /** 跑批缓存（页面传 `createLocalCache()`；缺省不缓存） */
  cache?: AdvisorCache | null;
  /** 覆盖依赖（生产不传） */
  deps?: Partial<AdvisorDeps>;
  /** 这位用户的「我的 box」（识图建档）：生产由 `view.ts` 注入当前档案；测试直接给 */
  box?: BoxView | null;
}

/** 生产依赖：跑批走 `evaluatePlan`（与 L2 同口径），检索走扩面后的匹配串 */
function realDeps(): AdvisorDeps {
  return {
    getConfig: () => defaultCfg(),
    evaluate: (cfg, runs, coreUnits, baseSeed) => evaluatePlan(cfg, { runs, coreUnits, ...(baseSeed === undefined ? {} : { baseSeed }) }),
    searchHeroes: (q, limit) => matchRows(HERO_MATCH, q, limit).map((o) => ({ id: o.id, name: o.name, label: o.label })),
    searchSkills: (q, limit) => matchRows(SKILL_MATCH, q, limit).map((o) => ({ id: o.id, name: o.name, label: `${o.name}（${o.slot}·${o.grade}）` })),
    skillDetail: (id) => {
      const def = SKILL_REGISTRY[id];
      if (!def) return { found: false, id };
      return { found: true, id, name: def.name, grade: SKILL_GRADES[id] ?? null, type: def.type, tags: def.tags, desc: skillDesc(id) };
    },
    heroDetail: (id) => {
      const rec = getHeroById(id) as (HeroJson & { skillDesc?: string; attackRange?: number; rarity?: string }) | undefined;
      if (!rec) return { found: false, id };
      const st = baseStatsAt(rec as never, 40);
      const listed = HEROES.some((h) => h.id === id);
      return {
        found: true,
        id,
        name: rec.name,
        faction: rec.faction,
        troopType: TROOP_CHAR[rec.troopType] ?? rec.troopType,
        attackRange: rec.attackRange ?? null,
        rarity: rec.rarity ?? null,
        listed,
        /** 下架原因（主战法已实现但受属性缩放的成长率未确认 → 模拟数值偏低，只能看方向） */
        offlineReason: listed ? null : (rec.mainSkillId ? offlineReason({ mainSkillId: rec.mainSkillId }) ?? '未登记原因' : '未登记原因'),
        stats40: st,
        growth: {
          attack: (rec as unknown as { growthAttack?: number }).growthAttack ?? null,
          defense: (rec as unknown as { growthDefense?: number }).growthDefense ?? null,
          strategy: (rec as unknown as { growthStrategy?: number }).growthStrategy ?? null,
          speed: (rec as unknown as { growthSpeed?: number }).growthSpeed ?? null,
        },
        mainSkillId: rec.mainSkillId ?? null,
        mainSkillName: rec.mainSkillName ?? null,
        mainSkillDesc: rec.skillDesc ?? '',
        mutualExclusionGroup: rec.mutualExclusionGroup ?? null,
      };
    },
    optimizeSkills: (cfg, options, onProgress, signal) => {
      const est = estimateSkillBattlesReal(cfg, options);
      return runSimExpectationAsync(cfg, {
        ...options,
        onProgress: (p) => {
          throwIfAborted(signal);
          onProgress?.(p.battle, est);
        },
      });
    },
    estimateSkillBattles: (cfg, options) => estimateSkillBattlesReal(cfg, options),
    optimizeMates: (cfg, options, onProgress, signal) => {
      const est = estimateMateBattlesReal(cfg, options);
      return runSimMateAsync(cfg, {
        ...options,
        onProgress: (p) => {
          throwIfAborted(signal);
          onProgress?.(p.battle, est);
        },
      });
    },
    estimateMateBattles: (cfg, options) => estimateMateBattlesReal(cfg, options),
    applyCombo: (cfg, picks, clearSkills) => {
      let out = cfg;
      for (const p of picks) out = withSlotHero(out, p.unit, p.heroId, !clearSkills);
      return clearSkills ? clearSlotSkills(out, picks.map((p) => p.unit)) : out;
    },
    listOpponentPool: () => loadMergedPool(undefined, { includeDisabled: true }),
    addOpponentFromPreset: (presetId) => addPresetIdToPool(presetId),
    removeUserOpponent: (id) => removeUserOpponentEntry(id),
    matchup: async (plan, runsPerOpponent, seed, signal, onProgress) => {
      const cfg = cfgOf(plan);
      const mine = generalsOf(cfg, cfg.morale);
      return matchupPoolAsync(mine, loadMergedPool(), {
        runsPerOpponent,
        baseSeed: seed,
        signal,
        onProgress,
      });
    },
  };
}

/** 把一套战法选择落到配置上（`ComboPick.slot` = 该将的可学槽下标）
 *  空槽显式补 `''`（**不留稀疏洞**：洞在 JSON 里会变成 null，落盘/回灌都难看） */
function withSkillPicks(cfg: ViewCfg, picks: Array<{ unit: number; slot: number; skillId: string }>): ViewCfg {
  const out: ViewCfg = { ...cfg, slots: cfg.slots.map((s) => ({ ...s, skillIds: [...s.skillIds] })) };
  for (const p of picks) {
    const slot = out.slots[p.unit];
    if (!slot) continue;
    for (let k = 0; k <= p.slot; k += 1) if (slot.skillIds[k] === undefined) slot.skillIds[k] = '';
    slot.skillIds[p.slot] = p.skillId;
  }
  return out;
}

/** 假跑批：字段与 `PlanSummary` 对齐，毫秒返回 */
function fakeEvaluate(runs: number, coreDamage: number) {
  return (cfg: ViewCfg): PlanSummary => {
    const damages = Array.from({ length: runs }, () => coreDamage);
    return {
      runs,
      damages,
      mean: coreDamage,
      meanFirst3: coreDamage,
      meanTotal: Math.round(coreDamage * cfg.slots.length),
      sd: 0,
      halfWidth: 0,
      min: coreDamage,
      max: coreDamage,
      median: coreDamage,
      byUnit: cfg.slots.map((_, i) => ({ unit: i, name: `u${i}`, mean: coreDamage, core: true })),
      bySkill: [{ skillId: 'fake', name: '假战法', mean: coreDamage }],
      wipedRuns: 0,
    };
  };
}

export function makeCtx(opts: MakeCtxOpts = {}): ToolCtx & { deps: AdvisorDeps & { __plan: AdvisorPlan; __planWith(names: string[]): AdvisorPlan } } {
  const budget: Budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
  const seed = opts.seed ?? 20260929;
  const coreDamage = opts.coreDamage ?? 26500;
  const deps: AdvisorDeps = {
    ...realDeps(),
    ...(opts.fakeRuns ? { evaluate: (cfg: ViewCfg, runs: number) => fakeEvaluate(runs, coreDamage)(cfg) } : {}),
    ...(opts.deps ?? {}),
  };
  const plan = configToPlan(deps.getConfig());
  const byName = new Map(HERO_MATCH.map((o) => [o.name, o.id]));
  const ctx: ToolCtx = {
    deps,
    budget: { ...budget, battles: 0, ms: 0, calls: 0, tokens: 0, startedAt: Date.now() },
    evidenceSeq: { n: 0 },
    seed,
    cache: opts.cache ?? null,
    box: opts.box ?? null,
  };
  // 仅测试：默认合法方案 + 按武将名拼方案（`fakeRuns: false` 的生产路径不会用到）
  return Object.assign(ctx, {
    deps: Object.assign(deps, {
      __plan: plan,
      __planWith(names: string[]): AdvisorPlan {
        return {
          ...plan,
          slots: names.slice(0, 3).map((n, i) => ({
            position: (['大营', '中军', '前锋'] as const)[i],
            heroId: byName.get(n) ?? n,
            level: 40,
            skillIds: [],
          })),
        };
      },
    }),
  });
}
