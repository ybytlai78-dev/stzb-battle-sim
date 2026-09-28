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
import { baseStatsAt, getHeroById, HEROES, offlineReason, skillDesc, SKILL_GRADES, TROOP_CHAR, type HeroJson } from '../heroes';
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
  estimateMateBattles as estimateMateBattlesReal,
  runSimMateAsync,
  type MateSimOptions,
  type MateSimResult,
} from '../simMate';
import { HERO_OPTIONS, SKILL_OPTIONS, defaultCfg, type ViewCfg } from '../teamConfig';
/** 方案里的核心将 → `ViewCfg` 槽位下标（给 `evaluate` 当排序口径用）—— 实现见 `gate.ts`（与关 3 共用） */
import { cfgOf, configToPlan, coreIndices, validateAdvisorPlan } from './gate';
import {
  BudgetExceeded,
  DEFAULT_BUDGET,
  DEFAULT_DUMMY,
  normalizePlan,
  type AdvisorPlan,
  type Budget,
  type BudgetState,
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
}

export interface ToolCtx {
  deps: AdvisorDeps;
  budget: BudgetState;
  /** 证据编号序列（每轮一个 ctx → 天然不冲突） */
  evidenceSeq: { n: number };
  /** 本轮基准种子（写进 stats，复算用同一把尺子） */
  seed: number;
  /** 本轮取消信号（长搜索在进度回调里检查它） */
  signal?: AbortSignal;
  /** 长任务的进度外抛（loop 转成事件、界面显示进度条） */
  onProgress?: (e: { name: string; done: number; total: number; label?: string }) => void;
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

/** 预算护栏：超限**拒绝执行**（不是静默截断）。token 由 loop 记账，不在这里扣。 */
export function chargeBudget(state: BudgetState, cost: { battles?: number; ms?: number }, now: number): void {
  const elapsed = now - state.startedAt;
  if (state.calls + 1 > state.maxCalls) throw new BudgetExceeded('calls');
  if (state.battles + (cost.battles ?? 0) > state.maxBattles) throw new BudgetExceeded('battles');
  if (elapsed + (cost.ms ?? 0) > state.maxMs) throw new BudgetExceeded('ms');
  state.calls += 1;
  state.battles += cost.battles ?? 0;
  state.ms = elapsed;
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

// ─────────────────────────── 六个工具 ───────────────────────────

/** 给模型看的紧凑明细（≤15 行）：每将 / 每战法场均贡献 —— 完整样本仍在 `data` 里给渲染层 */
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
    `汇总：mean ${Math.round(s.mean)} ±${Math.round(s.halfWidth)}（${s.runs} 场；样本标准差 ${Math.round(s.sd)}；单场 ${Math.round(s.min)}~${Math.round(s.max)}；中位 ${Math.round(s.median)}）`,
  ].join('\n');
}

/** 从 `args.plan`（缺省 = 当前配将区）构造 cfg + L2 搜索选项 */
function skillSearchSetup(
  args: { plan?: unknown; coarseRuns?: number; finalRuns?: number; coarseTop?: number; candidateSkillIds?: string[]; matchSlotKeys?: string[] },
  ctx: ToolCtx
): { cfg: ViewCfg; options: Partial<SimExpectOptions>; plan: AdvisorPlan } {
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
  return { cfg, options, plan };
}

/** 从 `args.plan`（缺省 = 当前配将区）构造 cfg + L3 队友搜索选项 */
function mateSearchSetup(
  args: { plan?: unknown; coarseRuns?: number; finalRuns?: number; coarseTop?: number; candidateHeroIds?: string[]; matchUnits?: number[]; slotSkills?: string; includeOffline?: boolean },
  ctx: ToolCtx
): { cfg: ViewCfg; options: Partial<MateSimOptions> } {
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
  return { cfg, options };
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
        '校验一个方案是否合法（武将/战法是否在库、每将 ≤2 个可学战法、全队战法唯一、同队互斥、位置齐全）。要提方案前先过这一关；不合法会返回带 code 的错误清单。',
      schema: { type: 'object', properties: { plan: PLAN_SCHEMA }, required: ['plan'] },
      cost: {},
      async run(args: { plan: unknown }, ctx) {
        const v = validateAdvisorPlan(assertPlanShape(args?.plan));
        return {
          evidenceId: nextEvidenceId(ctx, 'validate_plan'),
          summary: v.ok
            ? `方案合法（${v.normalized.slots.length} 位：${v.normalized.slots.map((s) => s.heroId).join(' / ')}）`
            : `方案不合法，${v.errors.length} 处问题；首个：${v.errors[0].code} —— ${v.errors[0].message}`,
          data: { ok: v.ok, errors: v.errors, normalized: v.normalized },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'simulate',
      description:
        '对「不还手的木桩」真跑 N 场，按**核心将伤害期望**汇总（默认 20 场，上限 200）。返回 mean（期望）/ halfWidth（95% 半宽）/ meanTotal（全队总伤，参考）/ byUnit / bySkill / wipedRuns（木桩被打空的场次）。数字只能来自这里，不许自己推算。',
      schema: {
        type: 'object',
        properties: { plan: PLAN_SCHEMA, runs: { type: 'integer', minimum: 1, maximum: SIM_RUNS_MAX } },
        required: ['plan'],
      },
      cost: {
        battles: SIM_RUNS_DEFAULT,
        battlesOf: (args: unknown) =>
          Math.max(1, Math.floor((args as { runs?: number })?.runs ?? SIM_RUNS_DEFAULT)),
      },
      async run(args: { plan: unknown; runs?: number }, ctx) {
        const runs = Math.max(1, Math.floor(args?.runs ?? SIM_RUNS_DEFAULT));
        if (runs > SIM_RUNS_MAX) throw new Error(`runs 超上限 ${SIM_RUNS_MAX}（收到 ${runs}）`);
        const plan = assertPlanShape(args?.plan);
        const cfg = cfgOf(plan);
        const t0 = Date.now();
        const s = ctx.deps.evaluate(cfg, runs, coreIndices(plan, cfg));
        return {
          evidenceId: nextEvidenceId(ctx, 'simulate'),
          summary: `真跑 ${s.runs} 场：核心将伤害期望 ${Math.round(s.mean)} ±${Math.round(s.halfWidth)}（95% 半宽）；全队总伤 ${Math.round(s.meanTotal)}；木桩被打空 ${s.wipedRuns} 场`,
          brief: planBrief(s),
          data: { ...s, plan: normalizePlan(plan), runs: s.runs },
          stats: { battles: s.runs, ms: Date.now() - t0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'simulate_many',
      description:
        '**一次对拍多套方案**（最多 8 套，每套 runs 场，默认 20），按核心将伤害期望排序返回对比表（含每套的每将贡献）。想比较几个搭配时用它，**不要一套一套地调 simulate**（省调用次数）。',
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
        battlesOf: (args: unknown) => {
          const a = args as { plans?: unknown[]; runs?: number };
          const n = Array.isArray(a?.plans) ? Math.max(1, a.plans.length) : 1;
          return n * Math.max(1, Math.floor(a?.runs ?? SIM_RUNS_DEFAULT));
        },
      },
      async run(args: { plans?: Array<{ label?: string; plan: unknown }>; runs?: number }, ctx) {
        const list = Array.isArray(args?.plans) ? args.plans : [];
        if (!list.length) throw new Error('plans 不能为空：给 2~8 套方案（每套 { label?, plan }）');
        if (list.length > SIM_MANY_MAX) throw new Error(`plans 最多 ${SIM_MANY_MAX} 套（收到 ${list.length}）：先粗筛再精算`);
        const runs = Math.max(1, Math.floor(args?.runs ?? SIM_RUNS_DEFAULT));
        if (runs > SIM_RUNS_MAX) throw new Error(`runs 超上限 ${SIM_RUNS_MAX}（收到 ${runs}）`);
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
              `${k + 1}. ${r.label} — mean ${Math.round(r.mean)} ±${Math.round(r.halfWidth)}｜总伤 ${Math.round(r.meanTotal)}｜${r.byUnit
                .slice(0, 3)
                .map((u) => `${u.name} ${Math.round(u.mean)}`)
                .join(' / ')}`
          ),
          ranked.length > 1
            ? `第 1 与第 2 的差距：${Math.round(ranked[0].mean - ranked[1].mean)}（两者半宽之和 ${Math.round(ranked[0].halfWidth + ranked[1].halfWidth)} —— 差距小于半宽之和就是「分不出来」）`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
        return {
          evidenceId: nextEvidenceId(ctx, 'simulate_many'),
          summary: `对拍 ${rows.length} 套 × ${runs} 场：第 1 名「${ranked[0].label}」核心将期望 ${Math.round(ranked[0].mean)} ±${Math.round(ranked[0].halfWidth)}（总伤 ${Math.round(ranked[0].meanTotal)}）`,
          brief,
          data: { runs, rows, rankedLabels: ranked.map((r) => r.label) },
          stats: { battles: runs * rows.length, ms: Date.now() - t0, seed: ctx.seed },
        };
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
          return c.deps.estimateSkillBattles(cfg, options);
        },
      },
      async run(args: { topN?: number } & Parameters<typeof skillSearchSetup>[0], ctx) {
        const { cfg, options } = skillSearchSetup(args, ctx);
        const est = ctx.deps.estimateSkillBattles(cfg, options);
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
        return {
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
        };
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
          return c.deps.estimateMateBattles(cfg, options);
        },
      },
      async run(args: { topN?: number } & Parameters<typeof mateSearchSetup>[0], ctx) {
        const { cfg, options } = mateSearchSetup(args, ctx);
        const est = ctx.deps.estimateMateBattles(cfg, options);
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
        return {
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
        };
      },
    },
    {
      name: 'search_hero',
      description:
        '按 名字 / 势力 / 兵种 / 主战法名 / id / 拼音 检索武将（空白分词 AND），返回候选与 id。拿不准 id 时先搜。空结果会给换词提示，不要拿同一个词反复重试。',
      schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'] },
      cost: {},
      async run(args: { q: string; limit?: number }, ctx) {
        const hits = ctx.deps.searchHeroes(String(args?.q ?? ''), args?.limit ?? 12);
        return {
          evidenceId: nextEvidenceId(ctx, 'search_hero'),
          summary: hits.length ? `命中 ${hits.length} 个武将：${hits.map((h) => `${h.name}(${h.id})`).join('、')}` : `没有匹配「${args?.q}」的武将`,
          brief: hits.length ? '' : EMPTY_HINT,
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
        '按 名字 / 出手位（主动/追击/被动/一类指挥/二类指挥/准备）/ 品级（S/A/B/C/D）/ 效果标签 / 官方描述关键词 检索可学习战法（不含武将主战法）。空结果会给换词提示。',
      schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'] },
      cost: {},
      async run(args: { q: string; limit?: number }, ctx) {
        const hits = ctx.deps.searchSkills(String(args?.q ?? ''), args?.limit ?? 15);
        return {
          evidenceId: nextEvidenceId(ctx, 'search_skill'),
          summary: hits.length ? `命中 ${hits.length} 个战法：${hits.map((h) => `${h.name}(${h.id})`).join('、')}` : `没有匹配「${args?.q}」的战法`,
          brief: hits.length ? '' : EMPTY_HINT,
          data: { q: args?.q ?? '', hits },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'list_skills',
      description:
        '批量浏览可学习战法池（按出手位分页），用来「拉齐某一类池子」——比逐个词搜省调用次数。返回 id / 名字 / 出手位 / 品级。',
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
        const offset = Math.max(0, Math.floor(args?.offset ?? 0));
        const limit = Math.min(80, Math.max(1, Math.floor(args?.limit ?? 30)));
        const rows = all.slice(offset, offset + limit).map((s) => ({ id: s.id, name: s.name, slot: s.slot, grade: s.grade }));
        return {
          evidenceId: nextEvidenceId(ctx, 'list_skills'),
          summary: `战法池${slot ? `（${slot}）` : ''}共 ${all.length} 个，本次返回第 ${offset + 1}~${offset + rows.length} 个：${rows.map((r) => r.name).join('、') || '（空）'}`,
          brief:
            all.length > offset + rows.length
              ? `还有 ${all.length - offset - rows.length} 个没返回 —— 需要就再调一次（offset=${offset + rows.length}）。`
              : '已到池底。',
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
  ];
  return tools;
}

/** 按名取工具（找不到就抛——AI 编工具名要暴露出来，不能静默） */
export function toolByName(name: string): ToolSpec<never, ToolCtx> {
  const hit = createTools().find((t) => t.name === name);
  if (!hit) throw new Error(`未知工具「${name}」`);
  return hit;
}

/** 执行一个工具：先过预算护栏（`cost.battlesOf` 按实参 + 真实 `estimateBattles` 预估场次） */
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
  return tool.run(args as never, ctx);
}

// ─────────────────────────── 上下文工厂（生产 + 测试共用） ───────────────────────────

export interface MakeCtxOpts {
  /** 真跑换成毫秒返回的假实现（测试用） */
  fakeRuns?: boolean;
  /** 假跑批固定返回的核心将期望（默认 26500） */
  coreDamage?: number;
  budget?: Partial<Budget>;
  seed?: number;
  /** 覆盖依赖（生产不传） */
  deps?: Partial<AdvisorDeps>;
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
  };
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
