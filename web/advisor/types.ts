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

/** 规范化：按 大营→中军→前锋 排序、level 缺省补 40、去掉空战法、dummy 缺省合并 */
export function normalizePlan(plan: AdvisorPlan): AdvisorPlan {
  const slots = [...plan.slots]
    .map((s) => ({
      position: s.position,
      heroId: s.heroId,
      level: s.level > 0 ? s.level : 40,
      skillIds: s.skillIds.filter((x) => Boolean(x)),
    }))
    .sort((a, b) => PLAN_POSITIONS.indexOf(a.position) - PLAN_POSITIONS.indexOf(b.position));
  return { slots, coreUnitIds: [...plan.coreUnitIds], dummy: { ...DEFAULT_DUMMY, ...plan.dummy } };
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
  /** 真跑场次（0 = 纯查表工具） */
  battles: number;
  ms: number;
  seed: number;
}

export interface ToolResult {
  /** ≤200 字摘要：**唯一**进 LLM 上下文的部分（明细不进上下文，防止撑爆） */
  summary: string;
  /** 结构化明细：只挂本轮 trace，渲染层直读（LLM 不参与数字路径） */
  data: unknown;
  /** 数字溯源锚：LLM 引用数字必须带它（`编号[[evidenceId]]`） */
  evidenceId: string;
  stats: ToolStats;
}

export interface ToolCost {
  battles?: number;
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
  maxBattles: number;
  maxMs: number;
  maxCalls: number;
}

export interface BudgetState extends Budget {
  battles: number;
  ms: number;
  calls: number;
  startedAt: number;
}

/** 一轮对话的默认预算三件套（spec §3：20,000 场 / 120 秒 / 单轮 ≤8 次工具调用） */
export const DEFAULT_BUDGET: Budget = { maxBattles: 20000, maxMs: 120000, maxCalls: 8 };

export class BudgetExceeded extends Error {
  constructor(public readonly why: 'battles' | 'ms' | 'calls') {
    super(`已达本轮预算（${why}）——拒绝执行该工具`);
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

export interface AdvisorTurn {
  messages: AdvisorMessage[];
  toolCalls: ToolCallRecord[];
  plans: ProposedPlan[];
  /** 展示用正文（已剥掉围栏 JSON 块） */
  answer: string;
  /** 厂商不支持工具调用 → 去掉 tools 重试过（无工具模式） */
  degraded?: boolean;
  verdict: TurnVerdict;
}
