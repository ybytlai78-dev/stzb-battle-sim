/**
 * AI 配将顾问 · 共享类型与纯函数
 * ---------------------------------------------------------------------------
 * 口径来源：`docs/AI配将顾问-设计.md`（唯一口径）。本文件只放**类型 + 纯函数**，不做 IO、不 import 引擎。
 *
 * 两条硬规则（整条线的地基）：
 *  1. **AI 不下场算数** —— LLM 只能给结构化方案 + 引用 `evidenceId`，数字一律以工具返回为准；
 *  2. 方案出口只有一个 —— 终答里围栏 ```json 块 `{ "plans": [...] }`（`parsePlans` 唯一认这个口）。
 */
import type { TroopType } from '../../src/engine/types';

// ─────────────────────────── 方案 ───────────────────────────

export const PLAN_POSITIONS = ['大营', '中军', '前锋'] as const;
export type PlanPosition = (typeof PLAN_POSITIONS)[number];

/** 一个槽位：哪张武将、几级、带哪两个可学战法（主战法不进方案，由武将自带） */
export interface PlanSlot {
  position: PlanPosition;
  heroId: string;
  level: number;
  skillIds: string[];
}

/** 靶子（不还手的木桩）：面板给防御 / 谋略 / 兵种，兵力给足只为「打不完」 */
export interface DummySpec {
  defense: number;
  strategy: number;
  troopType: TroopType;
  troops: number;
}

/** 一套完整方案：三个槽位 + 排序口径（核心将）+ 靶子 */
export interface AdvisorPlan {
  slots: PlanSlot[];
  coreUnitIds: string[];
  dummy: DummySpec;
}

/** LLM 提出的方案（含它引用的工具证据 id） */
export interface ProposedPlan {
  title: string;
  plan: AdvisorPlan;
  evidenceIds: string[];
}

export const DEFAULT_DUMMY: DummySpec = { defense: 150, strategy: 100, troopType: 'infantry', troops: 150000 };

/** 规范化：按 大营→中军→前锋 排序、level 缺省补 40、去掉空战法、dummy 缺省合并。
 *  **容错**（2026-09-29 实跑教训：模型给的槽位常缺 `skillIds`）：字段缺失一律按空/默认处理，
 *  结构性问题由 `validateAdvisorPlan` 报出来，**不要在这里抛异常**——一个 undefined 就能让整条链崩。 */
export function normalizePlan(plan: AdvisorPlan): AdvisorPlan {
  const rawSlots = Array.isArray(plan?.slots) ? plan.slots : [];
  const slots = rawSlots
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      position: s.position,
      heroId: String(s.heroId ?? ''),
      level: Number(s.level) > 0 ? Number(s.level) : 40,
      skillIds: (Array.isArray(s.skillIds) ? s.skillIds : []).filter((x) => Boolean(x)).map(String),
    }))
    .sort((a, b) => PLAN_POSITIONS.indexOf(a.position) - PLAN_POSITIONS.indexOf(b.position));
  return {
    slots,
    coreUnitIds: (Array.isArray(plan?.coreUnitIds) ? plan.coreUnitIds : []).filter(Boolean).map(String),
    dummy: { ...DEFAULT_DUMMY, ...(plan?.dummy ?? {}) },
  };
}

/** 缓存键：与槽位顺序无关（规范化后拼），与场次 / 种子有关 */
export function planKey(plan: AdvisorPlan, runs: number, seed: number): string {
  const p = normalizePlan(plan);
  const canonical = p.slots.map((s) => `${s.position}:${s.heroId}:${s.level}:${s.skillIds.join(',')}`).join('|');
  return `${canonical}#${p.coreUnitIds.join(',')}#${JSON.stringify(p.dummy)}#${runs}#${seed}`;
}

/**
 * 从终答里取出方案：**唯一出口** = 一个围栏 ```json 块 `{ "plans": [...] }`。
 * 坏 JSON / 结构不对 → 返回空方案**并把原文整段保留在 `text`**（不静默丢弃，用户与日志都看得见）。
 */
export function parsePlans(answer: string): { plans: ProposedPlan[]; text: string } {
  const m = /```json\s*([\s\S]*?)```/.exec(answer);
  if (!m) return { plans: [], text: answer };
  try {
    const parsed = JSON.parse(m[1]) as { plans?: unknown };
    if (!Array.isArray(parsed?.plans) || parsed.plans.length === 0) return { plans: [], text: answer };
    const plans: ProposedPlan[] = [];
    for (const raw of parsed.plans as Array<Record<string, unknown>>) {
      const plan = raw?.plan as AdvisorPlan | undefined;
      if (!plan || !Array.isArray(plan.slots)) return { plans: [], text: answer };
      plans.push({
        title: typeof raw.title === 'string' && raw.title ? raw.title : '方案',
        plan: normalizePlan(plan),
        evidenceIds: Array.isArray(raw.evidenceIds) ? (raw.evidenceIds as string[]).filter((x) => typeof x === 'string') : [],
      });
    }
    return { plans, text: answer.replace(m[0], '').trim() };
  } catch {
    return { plans: [], text: answer };
  }
}

// ─────────────────────────── 工具协议 ───────────────────────────

export interface ToolStats {
  /** 真跑场次（0 = 纯查表工具，或结果来自缓存） */
  battles: number;
  ms: number;
  seed: number;
  /** 结果来自缓存（本轮没有真跑） */
  cached?: boolean;
}

export interface ToolResult {
  /** ≤200 字摘要：进 LLM 上下文 */
  summary: string;
  /**
   * 紧凑明细（≤15 行，**也进上下文**）：给模型的"看得见的数"。
   * 用户 2026-09-29 口径：要它能做实事，不为了省 token 把明细全砍掉——
   * 但完整跑批明细（几千行）仍然只走 `data`（渲染层直读），不塞进上下文。
   */
  brief?: string;
  /** 结构化明细：只挂本轮 trace，渲染层直读（LLM 不参与数字路径） */
  data: unknown;
  /** 数字溯源锚：LLM 引用数字必须带它（`编号[[evidenceId]]`） */
  evidenceId: string;
  stats: ToolStats;
}

export interface ToolCost {
  /** 固定场次代价（纯查表工具不填） */
  battles?: number;
  /** 按实参估算场次（`simulate` 用 `runs`；`optimize_*` 用 `estimateBattles` 预判）——优先于 `battles` */
  battlesOf?: (args: unknown, ctx: unknown) => number;
  long?: boolean;
}

export interface ToolSpec<A = unknown, C = unknown> {
  name: string;
  /** 给 LLM 看：什么时候用、边界、代价 */
  description: string;
  /** 参数 schema（JSON Schema，object 根） */
  schema: unknown;
  cost: ToolCost;
  run(args: A, ctx: C): Promise<ToolResult>;
}

// ─────────────────────────── 预算护栏（spec §3） ───────────────────────────

export interface Budget {
  /** 单轮累计真跑场次上限 */
  maxBattles: number;
  /** 单轮累计墙上时间上限（毫秒） */
  maxMs: number;
  /**
   * 单轮工具调用次数上限（**不是** token 上限）。
   * 2026-09-29 用户口径：模型在"曹纯最强队"这类研究型问题上被 8 次掐死 → 抬到 40，
   * 额度对得起"先补档 → 拉池子 → 逐套 simulate"的节奏。
   */
  maxCalls: number;
  /** 单轮累计 token 上限（用户 2026-09-29 指定 100 万）：只记账与兜底，正常一轮远够不着 */
  maxTokens: number;
}

export interface BudgetState extends Budget {
  battles: number;
  ms: number;
  calls: number;
  tokens: number;
  startedAt: number;
}

/** 一轮对话的默认预算（2026-09-29 按用户口径抬额：**搜索是一等公民**，不再为省额度卡住模型）
 *  —— L2 一次默认搜索约 8,000 场 / 约 60 秒，故场次与时间都要按"跑得起一次真搜索"来给。 */
export const DEFAULT_BUDGET: Budget = {
  maxBattles: 200000,
  maxMs: 900000,
  maxCalls: 40,
  maxTokens: 1000000,
};

export class BudgetExceeded extends Error {
  constructor(
    public readonly why: 'battles' | 'ms' | 'calls',
    message?: string
  ) {
    super(message ?? `已达本轮预算（${why}）——拒绝执行该工具`);
    this.name = 'BudgetExceeded';
  }
}

// ─────────────────────────── 对话与轮次 ───────────────────────────

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface AdvisorMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息里请求的工具调用（tool 消息则不带） */
  toolCalls?: ToolCallRequest[];
  /** role = 'tool' 时对应哪次调用（OpenAI 协议的 tool_call_id） */
  toolCallId?: string;
}

export interface ToolCallRecord {
  evidenceId: string;
  name: string;
  args: unknown;
  summary: string;
  /** 明细（渲染层直读；`verifyClaims` 也在这里找数字） */
  data: unknown;
  stats: ToolStats;
}

export interface TurnVerdict {
  /** 关 1：方案合法 */
  legal: boolean;
  /** 关 2：回答里的数字与方案引用的证据都能追溯到本轮 trace */
  verified: boolean;
  /** 关 3：已按标准口径独立复算 */
  recomputed: boolean;
  /** 综合结论（三道关缺一不可） */
  apply: { enabled: boolean; reason?: string };
}

/** 关 3 的复算结果（固定种子 + 20 场 + 标准木桩） */
export interface RecomputeResult {
  mean: number;
  halfWidth: number;
  runs: number;
  seed: number;
}

/** 单个方案过完三关的结论（渲染层据此决定「应用」能不能点、卡上显示什么） */
export interface PlanCheck {
  title: string;
  plan: AdvisorPlan;
  legal: boolean;
  legalErrors: string[];
  evidenceOk: boolean;
  evidenceReason?: string;
  recompute: RecomputeResult | null;
  /** 搜索口径值（来自方案引用的那份证据） */
  search: { mean: number; halfWidth: number; runs: number; evidenceId: string } | null;
  /** 搜索口径 vs 标准口径：区间重叠 = consistent；明显更低 = sensitive */
  judge: 'consistent' | 'sensitive' | null;
  apply: { enabled: boolean; reason?: string };
}

export interface AdvisorTurn {
  messages: AdvisorMessage[];
  toolCalls: ToolCallRecord[];
  plans: ProposedPlan[];
  /** 每个方案的三关结论（与 plans 同序） */
  checks: PlanCheck[];
  /** 展示用正文（已剥掉围栏 JSON 块） */
  answer: string;
  /** 厂商不支持工具调用 → 去掉 tools 重试过（无工具模式） */
  degraded?: boolean;
  verdict: TurnVerdict;
}
