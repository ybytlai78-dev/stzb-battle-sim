/**
 * AI 配将顾问 · 对话循环（精简版：够跑通「提问 → 调工具 → 出方案」一轮）
 * ---------------------------------------------------------------------------
 * 与实施计划 Task 6 的差别（本切片有意不做，留给二期）：
 *   · 不做会话持久化（localStorage trace）——由页面自己存；
 *   · 不做预算的完整三件套提示（预算仍由 `tools.ts` 的护栏拒绝执行，错误照样回灌）；
 *   · 不做「标准口径复算」（关 3），故 `verdict.recomputed` 恒为 false → 应用保持禁用。
 *
 * 保留的关键性质：
 *   · **数字只来自工具**：工具结果以 `summary + evidenceId` 回灌，回答里的数字必须写成 `数字[[evidenceId]]`；
 *   · 工具抛错**如实回灌**让模型自纠（不静默吞、不编结果）；
 *   · 取消（AbortSignal）在任何一次请求/工具执行前生效。
 */
import { decideApply, validateAdvisorPlan, verifyClaims, verifyPlanEvidence } from './gate';
import { createTools, runTool, type ToolCtx } from './tools';
import { advisorErrorCode, type AdvisorTransport, type TokenUsage, type ToolCall } from './transport';
import {
  parsePlans,
  type AdvisorMessage,
  type AdvisorTurn,
  type Budget,
  type ToolCallRecord,
  type TurnVerdict,
} from './types';

/** spec §4 的六条硬规则 + 两个格式约定（数字引用 / 方案出口） */
export const SYSTEM_PROMPT = `你是一个《率土之滨》战斗模拟器的配将顾问。你的职责是：把人话需求翻译成可验证的方案，并解释取舍。

硬规则（违反即视为错误回答）：
1. 数字只能来自工具返回。引用数字时必须紧跟证据编号，写成「26500[[ev-3-simulate]]」这种形式；没跑过就直说「这个我没跑过，要我跑一下吗」，绝不推算或估计。
2. 提方案必须走结构化出口：正文里放一个围栏 json 代码块，形如 {"plans":[{"title":"…","plan":{…},"evidenceIds":["ev-3-simulate"]}]}。plan 里三个槽位（大营/中军/前锋）、每个槽位 {position, heroId, level, skillIds}（skillIds 只放**可学习**战法，最多 2 个，主战法不用写）。
3. 排序口径默认是**核心将的伤害期望**（simulate 的 mean）；全队总伤 meanTotal 只作参考列。换口径必须明说。
4. 差距不显著时必须说「分不出来」：95% 区间重叠（半宽相加大于均值差）就不许说「第 1 名更强」。
5. 主动声明边界：木桩不还手 → 控制 / 防御型队友的价值量不出来（那是 L4 胜率的事）；解析口径不含控制 / 规避 / 兵力截断。
6. 工具报错就如实转述并改法，不许编一个结果圆过去。方案要先过 validate_plan 再报给用户。

可用工具（共 9 个，检索类 0 场、simulate 每 20 场约 0.1 秒）：
- get_config：读当前配将区配置（先调它，别猜）。
- search_hero：按 名字 / 势力 / 兵种 / 主战法名 / 拼音 找武将，拿 id。
- hero_detail：**武将档案**（阵营 / 兵种 / 攻击距离 / 40 级四维 / 成长率 / 主战法 + 官方描述 / 是否上架）。要给某个武将配队配战法，先调它。
- search_skill：按 名字 / 出手位（主动/追击/被动/一类指挥/二类指挥/准备）/ 品级 / 效果标签 / **官方描述关键词** 搜战法。
- list_skills：按出手位**批量拉池子**（分页）——比逐个词搜省调用次数。
- skill_detail：一个战法的完整信息（含官方描述全文）。
- validate_plan：校验方案合法性（武将/战法在库、每将 ≤2 可学战法、全队战法唯一、同队互斥）。
- simulate：对不还手的木桩真跑 N 场（默认 20，单次上限 200），给核心将伤害期望 / 95% 半宽 / 每将 / 每战法明细。
- **simulate_many**：**一次对拍最多 8 套方案**并按期望排序（含每套的每将贡献与"第 1 与第 2 是否真分得开"）——要比较多个搭配时用它，**不要一套一套地调 simulate**。

预算与节奏（**不要为了省额度而跳过该做的步骤**）：
- 研究型问题（"某武将最强怎么配"）：先把档案（hero_detail）与候选池（list_skills / search_skill）补齐，再逐套 validate_plan → simulate 对比，把额度用在该用的地方。
- 检索 0 命中时先换词（出手位 / 品级 / 描述关键词），不要拿同一个词反复重试。
- 需要多轮也可以：这一轮没跑完，就直接告诉用户"还差哪一步、下一轮怎么跑"，而不是硬凑一个结论。`;

/** 本轮预算的实参提示（数字来自 `BudgetState`，避免把上限写死在提示词里） */
export function budgetHint(b: Budget): string {
  return [
    `本轮预算：最多 ${b.maxCalls} 次工具调用 · 累计 ${b.maxBattles} 场真跑 · ${Math.round(b.maxMs / 1000)} 秒 · ${b.maxTokens} token。`,
    '额度是给你用的，不是给你省的：该补的档案、该拉的池子、该跑的对拍，正常走完。',
    '真的用完额度时，如实说明"还差哪一步、下一轮怎么跑"，不要拿没跑过的数字凑结论。',
  ].join('\n');
}

export type AdvisorEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; ms: number; battles: number; error?: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'round'; index: number };

export interface TurnInput {
  userText: string;
  ctx: ToolCtx;
  transport: AdvisorTransport;
  history?: AdvisorMessage[];
  signal?: AbortSignal;
  onEvent?: (e: AdvisorEvent) => void;
  /** 单轮最多几次工具调用（缺省 8，spec §3 预算三件套之一） */
  maxToolCalls?: number;
  /** 最多几轮模型往返（缺省 6） */
  maxRounds?: number;
}

const isAbort = (e: unknown): boolean => (e as Error)?.name === 'AbortError';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('已取消');
    err.name = 'AbortError';
    throw err;
  }
}

/** 消费一次流式响应，返回文本、工具调用与 token 用量（usage 同时通过事件外抛） */
async function collect(
  transport: AdvisorTransport,
  req: { messages: AdvisorMessage[]; tools: Array<{ name: string; description: string; schema: unknown }> },
  signal: AbortSignal | undefined,
  onEvent?: (e: AdvisorEvent) => void
): Promise<{ text: string; calls: ToolCall[]; usage: TokenUsage | null }> {
  let text = '';
  let calls: ToolCall[] = [];
  let usage: TokenUsage | null = null;
  for await (const ev of transport.chat(req, signal)) {
    if (ev.type === 'text') {
      text += ev.delta;
      onEvent?.({ type: 'delta', text: ev.delta });
    } else if (ev.type === 'tool_calls') {
      calls = ev.calls;
    } else if (ev.type === 'usage') {
      usage = ev.usage;
      onEvent?.({ type: 'usage', usage: ev.usage });
    }
  }
  return { text, calls, usage };
}

export async function runAdvisorTurn(input: TurnInput): Promise<AdvisorTurn> {
  const { userText, ctx, transport, signal, onEvent } = input;
  // 次数上限的**唯一真源** = 预算（不再各自写死一个 8）
  const maxToolCalls = input.maxToolCalls ?? ctx.budget.maxCalls;
  const maxRounds = input.maxRounds ?? 12;
  const messages: AdvisorMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: budgetHint(ctx.budget) },
    ...(input.history ?? []),
    { role: 'user', content: userText },
  ];
  const toolCalls: ToolCallRecord[] = [];
  const toolSpecs = createTools().map((t) => ({ name: t.name, description: t.description, schema: t.schema }));
  let answer = '';
  let degraded = false;
  /** 超过 token 上限后置位：后续工具调用一律拒绝（但让模型把话说完） */
  let toolsDisabled = false;

  for (let round = 0; round < maxRounds; round += 1) {
    throwIfAborted(signal);
    onEvent?.({ type: 'round', index: round });
    let text = '';
    let calls: ToolCall[] = [];
    let usage: TokenUsage | null = null;
    try {
      ({ text, calls, usage } = await collect(transport, { messages, tools: toolSpecs }, signal, onEvent));
      ctx.budget.tokens += usage?.totalTokens ?? 0;
    } catch (e) {
      if (isAbort(e)) throw e;
      // 厂商不支持工具调用 → 去掉 tools 重试一次（无工具模式），并把降级如实标出来
      if (!degraded && advisorErrorCode(e) === 'format' && toolSpecs.length) {
        degraded = true;
        messages.push({ role: 'user', content: '（本模型不支持工具调用：请只用已有信息回答，不要编造任何数字）' });
        const retry = await collect(transport, { messages, tools: [] }, signal, onEvent);
        ctx.budget.tokens += retry.usage?.totalTokens ?? 0;
        answer = retry.text;
        break;
      }
      throw e;
    }

    // token 上限：只兜底，不拦正常研究（默认 100 万，正常一轮万级）。
    // 超限后**不再执行工具**，但继续让模型把已有结果说完（不是直接掐掉这一轮）。
    if (ctx.budget.tokens > ctx.budget.maxTokens && !toolsDisabled) {
      toolsDisabled = true;
      messages.push({
        role: 'user',
        content: `已达本轮 token 上限（${ctx.budget.maxTokens}），请基于已拿到的结果作答，并说明还差哪些没跑。`,
      });
    }

    if (!calls.length) {
      answer = text;
      break;
    }

    messages.push({ role: 'assistant', content: text, toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })) });
    for (const c of calls) {
      throwIfAborted(signal);
      if (toolsDisabled || toolCalls.length >= maxToolCalls) {
        messages.push({
          role: 'tool',
          toolCallId: c.id,
          content: JSON.stringify({
            error: toolsDisabled
              ? `已达本轮 token 上限（${ctx.budget.maxTokens}），请基于已有结果作答`
              : `已达单轮工具调用上限 ${maxToolCalls}，请基于已有结果作答`,
          }),
        });
        continue;
      }
      onEvent?.({ type: 'tool_start', name: c.name });
      const t0 = Date.now();
      try {
        const r = await runTool(c.name, c.args, ctx);
        toolCalls.push({ evidenceId: r.evidenceId, name: c.name, args: c.args, summary: r.summary, data: r.data, stats: r.stats });
        onEvent?.({ type: 'tool_end', name: c.name, ms: Date.now() - t0, battles: r.stats.battles });
        messages.push({
          role: 'tool',
          toolCallId: c.id,
          content: JSON.stringify({
            evidenceId: r.evidenceId,
            summary: r.summary,
            ...(r.brief ? { brief: r.brief } : {}),
            stats: r.stats,
          }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onEvent?.({ type: 'tool_end', name: c.name, ms: Date.now() - t0, battles: 0, error: msg });
        messages.push({ role: 'tool', toolCallId: c.id, content: JSON.stringify({ error: msg }) });
      }
    }
    if (toolCalls.length >= maxToolCalls) {
      messages.push({ role: 'user', content: '已达本轮工具调用上限，请基于已有结果作答。' });
    }
  }

  const parsed = parsePlans(answer);
  const claimCheck = verifyClaims(parsed.text, toolCalls);
  const planChecks = parsed.plans.map((p) => verifyPlanEvidence(p, toolCalls));
  const legal = parsed.plans.length ? parsed.plans.every((p) => validateAdvisorPlan(p.plan).ok) : true;
  const verified = claimCheck.ok && planChecks.every((c) => c.ok);
  const verdict: TurnVerdict = {
    legal,
    verified,
    // 关 3（标准口径独立复算）属实施计划 Task 5；未接入前不给「应用」开口子
    recomputed: false,
    apply: decideApply({ legal, verified, recomputed: false }),
  };
  return { messages, toolCalls, plans: parsed.plans, answer: parsed.text, degraded, verdict };
}
