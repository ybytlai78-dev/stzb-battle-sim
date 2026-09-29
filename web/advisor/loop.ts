/**
 * AI 配将顾问 · 对话循环（精简版：够跑通「提问 → 调工具 → 出方案」一轮）
 * ---------------------------------------------------------------------------
 * 与实施计划 Task 6 的差别（本切片有意不做，留给二期）：
 *   · 不做会话持久化（localStorage trace）——由页面自己存；**记忆（会话 + 偏好档案）已由 `memory.ts` / `prefs.ts`
 *     落地，但 loop 仍然无状态**：页面把 `history`（上一轮的紧凑转录）与 `profileText`（`<advisor_prefs>` 注入块）
 *     传进来，loop 只负责把它们摆到正确位置（= harness 的 pre-step 注入，见 `memory.ts` 头部 §④）；
 *   · 不做预算的完整三件套提示（预算仍由 `tools.ts` 的护栏拒绝执行，错误照样回灌）；
 *   · 不做「标准口径复算」（关 3），故 `verdict.recomputed` 恒为 false → 应用保持禁用。
 *
 * 保留的关键性质：
 *   · **数字只来自工具**：工具结果以 `summary + evidenceId` 回灌，回答里的数字必须写成 `数字[[evidenceId]]`；
 *   · 工具抛错**如实回灌**让模型自纠（不静默吞、不编结果）；
 *   · 取消（AbortSignal）在任何一次请求/工具执行前生效。
 */
import { checkPlan, verifyClaims, verifyPlanEvidence } from './gate';
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
3. 排序口径默认是**核心将的伤害期望**（simulate 的 mean）；比较两个配置时优先报**八回合全队总伤 meanTotal** 与**前三回合爆发 meanFirst3**这两个主数字。换口径必须明说。
4. 差距不显著时必须说「分不出来」：95% 区间重叠（半宽相加大于均值差）就不许说「第 1 名更强」。
5. 主动声明边界：木桩不还手 → 控制 / 防御型队友的价值量不出来（那是 L4 胜率的事）；解析口径不含控制 / 规避 / 兵力截断。
6. 工具报错就如实转述并改法，不许编一个结果圆过去。方案要先过 validate_plan 再报给用户。
7. **box 只是「给你自己配将」时的范围，不是"什么都得先传截图"**：上下文里的 <advisor_box> 是这位用户账号实际拥有的五星武将 / 战法清单（他自己上传截图识别的结果），**每个用户一份**。
   · **只有当他明确要「给他自己配将 / 出方案 / 我该带什么 / 帮我配」时**，才用清单限定：方案里的每个武将、每个战法都必须在清单里，配将类搜索（optimize_*）也已经只在他有的将法里选。清单为空时先请他上传截图识别一次，再配将。
   · **其它问题一律照常回答，不受 box 限制**：问"A 和 B 哪个好"、某个将/战法什么机制、这队为什么低、帮我算一下…… 直接查、直接跑（search_* / list_skills / hero_detail / skill_detail / simulate / simulate_many **都不受 box 限制**），把数字给他。**绝对不要因为 box 是空的就拒绝回答、或者反过来要求用户先传截图**——那是答非所问。
   · 方案里出现清单外的将法时，卡片上会标出来并禁用「应用」；这时照实说明"这是给你看的对比/参考，不是能直接用的配置"即可，不用改口说"不合法"。

**比较两个战法 / 两个搭配（"带 A 还是带 B 好"）的标准做法**：
- 同一套阵容**只换那一处**，其余槽位、等级、靶子、士气完全一致 → 调 simulate_many（≤8 套）一次对拍，runs 拉到 100 以上更稳；
- 报数就给这两个：**八回合全队总伤 meanTotal** 与 **前三回合爆发 meanFirst3**（另附核心将期望 mean ± 半宽）；差值一起给；
- 差距落在 95% 区间内（半宽之和 ≥ 均值差）→ 直接说**分不出来**，别硬排名；
- 顺手说清两者的差别（出手位 / 机制 / 吃不吃发动率），但**机制描述只按工具返回的官方描述说**，没查到就别替它脑补。

可用工具（共 13 个）：
**我的 box 与配置（毫秒级）**
- **get_my_box**：读这位用户的 box 全量清单（拥有哪些五星将 / 战法）。配队前先确认；上下文里的 <advisor_box> 块被截断时用它拿全量。
**搜索类（要"最强 / 最优"就用它们，一次跑完几千~上万场）**
- **optimize_both**：**一次把「某将 + 配谁 + 带什么战法」搜完**（队友搜索 ↔ 战法搜索交替两轮，约 30~120 秒）。问"某某怎么配输出最大化 / 完整最强配置"就调它一次，不要自己串好几步。
- **optimize_skills**：只搜战法（队友已定）——「这套阵容带哪些战法期望最高」。
- **optimize_mates**：只搜队友（战法已定）——「和谁搭最强」。
- simulate_many：**只在**你已经有几套确定想比的方案时用（≤8 套，一次对拍排序）。
- simulate：单套方案真跑 N 场（默认 20，上限 200）拿明细。
**信息类（毫秒级）**
- get_config：读当前配将区配置（先调它，别猜）。
- search_hero / hero_detail：找武将、读档案（阵营 / 兵种 / 攻击距离 / 40 级四维 / 成长率 / 主战法 + 官方描述 / 是否上架）。
- search_skill / list_skills / skill_detail：找战法、按出手位批量拉池、读单个战法详情。
- validate_plan：校验方案合法性（武将/战法在库、每将 ≤2 可学战法、全队战法唯一、同队互斥）。

工作方式（重要）：
- **"某武将怎么配输出最大化 / 最强配置"这种问题，正确姿势是**：先 search_hero + hero_detail 摸清这个将（吃物理还是谋略、兵种、主战法机制）→ 组 2~3 套候选阵容（他 + 两个合理队友）→ **对每套调一次 optimize_both**（让搜索去定队友与战法，不要自己一个个翻战法列表）→ 拿榜单里的数字下结论。
- 如果已经确定了队友（只想配战法）就用 optimize_skills；只想换队友就用 optimize_mates。**不要三个搜索全调一遍**，那是在重复劳动。
- **不要用"自己逐个 skill_detail + 手搓几套 simulate"代替搜索**：那是撞运气，而且烧调用次数。
- 搜索很贵（几千~上万场）：**一次就够，别反复调同一个搜索**；要更确定就在同一套上加大 finalRuns 复跑。

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
  | { type: 'tool_end'; name: string; ms: number; battles: number; cached?: boolean; error?: string }
  | { type: 'tool_progress'; name: string; done: number; total: number; label?: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'round'; index: number };

export interface TurnInput {
  userText: string;
  ctx: ToolCtx;
  transport: AdvisorTransport;
  /** 上一轮的紧凑转录（`memory.historyFrom()` 产物） */
  history?: AdvisorMessage[];
  /**
   * 记忆层注入块（`memory.renderProfileBlock()` 产物，`<advisor_prefs>…</advisor_prefs>`）。
   * 摆位与 harness 的 pre-step 注入一致：**每轮**都进上下文，且在历史之前（历史是"发生过什么"，
   * 档案是"这个人一贯要什么"——先给身份约束，再给经过）。
   */
  profileText?: string;
  /**
   * 「我的 box」注入块（`box.renderBoxBlock()` 产物，`<advisor_box>…</advisor_box>`）。
   * 与档案同为 **system 块**，但摆位更靠前：box 是**配将的前提条件**（能不能用某个将 / 某个战法），
   * 比"这个人偏好什么口径"更硬 —— 顺序：SYSTEM_PROMPT → budgetHint → box → prefs → history → 本轮提问。
   * 空 box 也有块（一小段空态提示：先要截图，别假设），见 `box.renderBoxBlock`。
   */
  boxText?: string;
  signal?: AbortSignal;
  onEvent?: (e: AdvisorEvent) => void;
  /**
   * 每个工具**跑完就回调**一次（成功才给）。
   * 记忆层用它收「这一轮已经跑出来的证据」——中途取消 / 关页面时也能把证据清单如实落盘（不丢半成品）。
   */
  onToolRecord?: (r: ToolCallRecord) => void;
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
    // 「我的 box」（配将前提条件：能用的将 / 战法范围）：空 box 也有块（提示先要截图）
    ...(input.boxText ? [{ role: 'system' as const, content: input.boxText }] : []),
    // 「你的偏好」档案：空档案不注入空块（memory.renderProfileBlock 已经保证空 → ''）
    ...(input.profileText ? [{ role: 'system' as const, content: input.profileText }] : []),
    ...(input.history ?? []),
    { role: 'user', content: userText },
  ];
  const toolCalls: ToolCallRecord[] = [];
  const toolSpecs = createTools().map((t) => ({ name: t.name, description: t.description, schema: t.schema }));
  let answer = '';
  let degraded = false;
  /** 超过 token 上限后置位：后续工具调用一律拒绝（但让模型把话说完） */
  let toolsDisabled = false;
  // 长搜索（L2/L3）需要：取消信号 + 进度外抛
  ctx.signal = signal;
  ctx.onProgress = (e) => onEvent?.({ type: 'tool_progress', name: e.name, done: e.done, total: e.total, label: e.label });

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
        toolCalls.push({
          evidenceId: r.evidenceId,
          name: c.name,
          args: c.args,
          summary: r.summary,
          ...(r.brief ? { brief: r.brief } : {}),
          data: r.data,
          stats: r.stats,
        });
        input.onToolRecord?.(toolCalls[toolCalls.length - 1]);
        onEvent?.({ type: 'tool_end', name: c.name, ms: Date.now() - t0, battles: r.stats.battles, cached: r.stats.cached });
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
  // 关 3：对每个方案用**标准口径**独立复算（固定种子 + 20 场），不采信 AI 那次的搜索数字
  // box 一并交给关 1：严格模式下方案里出现清单外的将法 → legal=false（应用禁用 + 显示原因）
  const checks = parsed.plans.map((p) => checkPlan(p, toolCalls, { evaluate: ctx.deps.evaluate, box: ctx.box ?? null }));
  const legal = checks.length ? checks.every((c) => c.legal) : true;
  const verified = claimCheck.ok && planChecks.every((c) => c.ok);
  const recomputed = checks.length ? checks.every((c) => c.recompute !== null) : false;
  const apply =
    checks.length > 0
      ? checks.every((c) => c.apply.enabled)
        ? { enabled: true }
        : { enabled: false, reason: checks.find((c) => !c.apply.enabled)?.apply.reason ?? '存在未通过的方案' }
      : { enabled: false, reason: '本轮没有给出方案（只有文字结论）' };
  const verdict: TurnVerdict = { legal, verified, recomputed, apply };
  return { messages, toolCalls, plans: parsed.plans, checks, answer: parsed.text, degraded, verdict };
}
