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
import { SKILL_GRADES, skillDesc } from '../heroes';
import { evaluatePlan, type PlanSummary } from '../simExpectation';
import { HERO_OPTIONS, SKILL_OPTIONS, defaultCfg, type ViewCfg } from '../teamConfig';
import { cfgOf, configToPlan, validateAdvisorPlan } from './gate';
import {
  BudgetExceeded,
  DEFAULT_BUDGET,
  DEFAULT_DUMMY,
  normalizePlan,
  type AdvisorPlan,
  type Budget,
  type BudgetState,
  type ToolResult,
  type ToolSpec,
} from './types';

/** `simulate` 的单次场次上限（防止一次工具调用把界面卡死） */
export const SIM_RUNS_MAX = 200;
/** `simulate` 缺省场次 */
export const SIM_RUNS_DEFAULT = 20;

// ─────────────────────────── 上下文 / 依赖 ───────────────────────────

export interface AdvisorDeps {
  /** 当前配将区配置（生产 = 主站面板；本切片 = 默认配置） */
  getConfig(): ViewCfg;
  /** 单方案测评（生产 = `web/simExpectation.ts` 的 `evaluatePlan`） */
  evaluate(cfg: ViewCfg, runs: number, coreUnits?: number[]): PlanSummary;
  searchHeroes(q: string, limit: number): Array<{ id: string; name: string; label: string }>;
  searchSkills(q: string, limit: number): Array<{ id: string; name: string; label: string }>;
  skillDetail(id: string): unknown;
}

export interface ToolCtx {
  deps: AdvisorDeps;
  budget: BudgetState;
  /** 证据编号序列（每轮一个 ctx → 天然不冲突） */
  evidenceSeq: { n: number };
  /** 本轮基准种子（写进 stats，复算用同一把尺子） */
  seed: number;
}

export function nextEvidenceId(ctx: ToolCtx, name: string): string {
  ctx.evidenceSeq.n += 1;
  return `ev-${ctx.evidenceSeq.n}-${name}`;
}

/** 预算三件套：超限**拒绝执行**（不是静默截断） */
export function chargeBudget(state: BudgetState, cost: { battles?: number; ms?: number }, now: number): void {
  const elapsed = now - state.startedAt;
  if (state.calls + 1 > state.maxCalls) throw new BudgetExceeded('calls');
  if (state.battles + (cost.battles ?? 0) > state.maxBattles) throw new BudgetExceeded('battles');
  if (elapsed + (cost.ms ?? 0) > state.maxMs) throw new BudgetExceeded('ms');
  state.calls += 1;
  state.battles += cost.battles ?? 0;
  state.ms = elapsed;
}

// ─────────────────────────── 检索口径（与面板搜索同一份匹配串） ───────────────────────────

const tokenize = (q: string): string[] => q.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** 空白分词 AND 匹配（与 `web/teamConfig.ts` 的面板搜索同口径：match 串含名字/势力/id/拼音） */
function matchOptions<T extends { match: string }>(options: T[], q: string, limit: number): T[] {
  const toks = tokenize(q);
  const hits = toks.length ? options.filter((o) => toks.every((t) => o.match.includes(t))) : options;
  return hits.slice(0, Math.max(1, limit));
}

// ─────────────────────────── 六个工具 ───────────────────────────

/** 方案里的核心将 → `ViewCfg` 槽位下标（给 `evaluate` 当排序口径用） */
function coreIndices(plan: AdvisorPlan, cfg: ViewCfg): number[] | undefined {
  const idx: number[] = [];
  for (const id of plan.coreUnitIds) {
    const i = cfg.slots.findIndex((s) => s.heroId === id);
    if (i >= 0) idx.push(i);
  }
  return idx.length ? idx : undefined;
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

function assertPlanShape(plan: unknown): AdvisorPlan {
  const p = plan as AdvisorPlan | undefined;
  if (!p || !Array.isArray(p.slots)) throw new Error('plan 结构不对：需要 { slots: [{ position, heroId, level, skillIds }], coreUnitIds, dummy }');
  return { slots: p.slots, coreUnitIds: p.coreUnitIds ?? [], dummy: { ...DEFAULT_DUMMY, ...(p.dummy ?? {}) } };
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
      cost: { battles: SIM_RUNS_DEFAULT, battlesOf: (args: unknown) => Math.max(1, Math.floor((args as { runs?: number })?.runs ?? SIM_RUNS_DEFAULT)) },
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
          data: { ...s, plan: normalizePlan(plan), runs: s.runs },
          stats: { battles: s.runs, ms: Date.now() - t0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'search_hero',
      description: '按名字 / 势力 / id / 拼音检索武将（空白分词 AND），返回候选与 id。拿不准 id 时先搜，不要凭记忆写 id。',
      schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'] },
      cost: {},
      async run(args: { q: string; limit?: number }, ctx) {
        const hits = ctx.deps.searchHeroes(String(args?.q ?? ''), args?.limit ?? 10);
        return {
          evidenceId: nextEvidenceId(ctx, 'search_hero'),
          summary: hits.length ? `命中 ${hits.length} 个武将：${hits.map((h) => `${h.name}(${h.id})`).join('、')}` : `没有匹配「${args?.q}」的武将`,
          data: { q: args?.q ?? '', hits },
          stats: { battles: 0, ms: 0, seed: ctx.seed },
        };
      },
    },
    {
      name: 'search_skill',
      description: '按名字 / id / 出手位 / 品级检索可学习战法（不含武将主战法），返回候选与 id。',
      schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'] },
      cost: {},
      async run(args: { q: string; limit?: number }, ctx) {
        const hits = ctx.deps.searchSkills(String(args?.q ?? ''), args?.limit ?? 10);
        return {
          evidenceId: nextEvidenceId(ctx, 'search_skill'),
          summary: hits.length ? `命中 ${hits.length} 个战法：${hits.map((h) => `${h.name}(${h.id})`).join('、')}` : `没有匹配「${args?.q}」的战法`,
          data: { q: args?.q ?? '', hits },
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

/** 执行一个工具：先过预算护栏（`cost.battlesOf` 按实参估算，缺省用 `cost.battles`） */
export async function runTool(name: string, args: unknown, ctx: ToolCtx): Promise<ToolResult> {
  const tool = toolByName(name);
  const battles = tool.cost.battlesOf?.(args) ?? tool.cost.battles ?? 0;
  chargeBudget(ctx.budget, { battles }, Date.now());
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

/** 生产依赖：跑批走 `evaluatePlan`（与 L2 同口径），检索走面板同一份候选表 */
function realDeps(): AdvisorDeps {
  return {
    getConfig: () => defaultCfg(),
    evaluate: (cfg, runs, coreUnits) => evaluatePlan(cfg, { runs, coreUnits }),
    searchHeroes: (q, limit) =>
      matchOptions(HERO_OPTIONS, q, limit).map((o) => ({ id: o.id, name: o.label.split('（')[0], label: o.label })),
    searchSkills: (q, limit) =>
      matchOptions(SKILL_OPTIONS, q, limit).map((o) => ({ id: o.id, name: o.label.split('（')[0], label: o.label })),
    skillDetail: (id) => {
      const def = SKILL_REGISTRY[id];
      if (!def) return { found: false, id };
      return { found: true, id, name: def.name, grade: SKILL_GRADES[id] ?? null, type: def.type, desc: skillDesc(id) };
    },
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
  const byName = new Map(HERO_OPTIONS.map((o) => [o.label.split('（')[0], o.id]));
  const ctx: ToolCtx = {
    deps,
    budget: { ...budget, battles: 0, ms: 0, calls: 0, startedAt: Date.now() },
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
