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
import { checkPlan, uncitedBigNumbers, verifyClaims, verifyPlanEvidence } from './gate';
import {
  ALL_TIERS,
  ANCHOR_TOOL,
  classifyTiers,
  filterToolSpecs,
  PROMOTABLE,
  renderTurnGuide,
  TIER_HINT,
  TIER_TOOLS,
  tierOf,
  tiersAfterCalls,
  wireToolNames,
  wireUnlocked,
} from './router';
import { createTools, runTool, type ToolCtx } from './tools';
import { advisorErrorCode, type AdvisorTransport, type TokenUsage, type ToolCall } from './transport';
import {
  parsePlans,
  type AdvisorMessage,
  type AdvisorRoute,
  type AdvisorTier,
  type AdvisorTurn,
  type Budget,
  type ToolCallRecord,
  type TurnVerdict,
} from './types';

/** spec §4 的六条硬规则 + 两个格式约定（数字引用 / 方案出口） */
export const SYSTEM_PROMPT = `你是一个《率土之滨》战斗模拟器的配将顾问。你的职责是：把人话需求翻译成可验证的方案，并解释取舍。

硬规则（违反即视为错误回答）：
1. 数字只能来自工具返回。引用数字时必须紧跟证据编号，写成「26500[[ev-3-simulate]]」这种形式；**表格里的数字也要能对上引用——同一个数值在正文或表格里带过一次就算合规，但不能一次都不带**（2026-10-06 口径：要的是可溯源，不是每个格子都挂一遍；一次都没带的才算裸报）；没跑过就直说「这个我没跑过，要我跑一下吗」，绝不推算或估计。
2. 提方案必须走结构化出口：正文里放一个围栏 json 代码块，形如 {"plans":[{"title":"…","plan":{…},"evidenceIds":["ev-3-simulate"]}]}。plan 里三个槽位（大营/中军/前锋）、每个槽位 {position, heroId, level, skillIds}（skillIds 只放**可学习**战法，最多 2 个，主战法不用写）。
3. 排序口径默认是**对对手池的综合胜率**（matchup_pool / compare_variants / optimize_winrate 的 winRate）。同时报**对每一支对手**的胜率，以及同一批对打里的**八回合全队总伤 meanTotal** 与**前三回合爆发 meanFirst3**（这两项只作辅助，不许拿它们当排名）。用户说「要稳、别被克」时改按最差对手胜率排序，并明说。打木桩的伤害期望只有用户明确要「木桩 / 伤害期望」时才用 optimize_skills / optimize_both。
   **用户只说「最强」时先分清口径**：是**木桩输出最强**（optimize_skills / optimize_both 的伤害期望）还是**实战最强**（打对手池的 L4 胜率，optimize_winrate / matchup_pool）——两者常给出不同答案。**说清你按哪个排、另一个的数只作参考**，别用一句「最强」把两种口径混过去。
4. 差距不显著时必须说「分不出来」：两套综合胜率的 95% 半宽相加大于胜率差，就不许说谁更强。
5. 主动声明边界：胜场 = 斩首胜 + 优势平，平局场 = 劣势平 + 完全平，败场 = 斩首负；每个对手至少 100 场且正反场地。固定测试集删不掉。**另有两条边界必须当场说出来**：
   · **已下架的武将**（hero_detail 标了 offline / 未上架 / 暂不可用）：当场声明「已下架 / 数值仅供看方向」，**不许照常出方案**把它当能用的将（2026-10-05 评测：这条漏说是失分项）。
   · **控制型 / 防御型队友的价值**：在**木桩（不还手）**口径下**量不出来**——被问「加个控制将是不是更强」这类问题时，必须把这句话说明白（「这个口径测不出它的价值，要 L4 胜率才看得到」），不许含糊过去。
6. 工具报错就如实转述并改法，不许编一个结果圆过去。方案要先过 validate_plan 再报给用户。写对手池、应用到配将区都要等用户确认。
7. **box 只是「给你自己配将」时的范围，不是"什么都得先传截图"**：上下文里的 <advisor_box> 是这位用户账号实际拥有的五星武将 / 战法清单（他自己上传截图识别的结果），**每个用户一份**。
   · **只有当他明确要「给他自己配将 / 出方案 / 我该带什么 / 帮我配」时**，才用清单限定：方案里的每个武将、每个战法都必须在清单里，配将类搜索（optimize_winrate，以及木桩用的 optimize_*）也已经只在他有的将法里选。清单为空时先请他上传截图识别一次，再配将。
   · **其它问题一律照常回答，不受 box 限制**：问"A 和 B 哪个好"、某个将/战法什么机制、这队为什么低、帮我算一下…… 直接查、直接跑（search_* / list_skills / hero_detail / skill_detail / matchup_pool / compare_variants **都不受 box 限制**），把数字给他。**绝对不要因为 box 是空的就拒绝回答、或者反过来要求用户先传截图**——那是答非所问。
   · 方案里出现清单外的将法时，卡片上会标出来并禁用「应用」；这时照实说明"这是给你看的对比/参考，不是能直接用的配置"即可，不用改口说"不合法"。

**比较两个战法 / 两个武将（"带 A 还是带 B 好"）的标准做法**：
- 同一套阵容**只换那一处**，其余槽位、等级、对手池、种子完全一致 → 调 compare_variants 一次对拍（每对手至少 100 场）；
- 开口先报综合胜率和分对手胜率，再报前后差：胜率百分点、八回合全队总伤差、前三回合爆发差；
- 工具返回「分不出来」就照说，别硬排名；
- 顺手说清两者的差别（出手位 / 机制），但**机制描述只按工具返回的官方描述说**，没查到就别替它脑补。

**「给我配 / 这队怎么配最强」的标准做法**：
- 先 list_opponent_pool 看清当前对手池。用户没说加减对手，就用这一池打完，不要问要不要加或减。
- 用户点名了核心武将：调**一次** optimize_winrate，并传 coreUnit（他的站位，如「大营」）。工具按固定顺序跑完：先换另外两名队友（核心战法空着）→ 再填队友战法 → 最后填核心战法。不要自己拆成多轮，也不要先给核心填战法。
- 话里的阵营只用来认**是哪一张卡**（「群吕布」= 群·弓那张，不是汉·骑吕布），不是要求另外两名也同阵营。凑不齐三张同阵营照常配。队友从 box 全表里按胜率搜，不要先按阵营筛掉，也不要因为混阵营就说这套更弱。同阵营加成果真更高，胜率里已经算过了。
- 没点名核心、只补空着的战法槽：调 optimize_winrate（matchSlotKeys）。一次最多两个槽；还没填完且场次、调用次数还有剩余，就在这一轮继续调，不要停下来问用户下一轮跑不跑。
- 榜单按综合胜率，分对手胜率用这次返回里的「分对手」。同一批对手已经一起算过，不要再为了分对手单独跑 matchup_pool。
- 和当前配置的差距用工具返回的百分点，不要自己减。

可用工具（共 19 个；**当轮真正开放哪些**用 tools_catalog 查）：

**工具面按任务分档开放**（2026-10-05 起）：每轮只把当轮用得上的工具发给你，下面这份是全量索引。
· tools_catalog = 本轮开放清单（含参数名）；tools_help(name) = 某个工具的完整参数。
· 清单里但**当轮未开放**的工具，调了会被拒——确实需要就跑 route_task(tier, why) 说明理由：
  tier "search" 开放大搜索（optimize_winrate / optimize_skills / optimize_mates / optimize_both，用户要"最强 / 怎么配 / 搜一遍 / 伤害期望"时本来就该开）；
  tier "write" 开放改对手池。**别为了绕开分档去手搓**——分档要挡的正是"一个个翻战法"那条路。
**对手池（毫秒级；改池子要用户确认）**
- **list_opponent_pool**：固定测试集 + 用户从预设加进去的队伍。
- **add_opponent_from_preset** / **remove_user_opponent**：加入或移出用户自己的对手。固定集不能删。
**胜率（主指标，真打对手池）**
- **optimize_winrate**：「最强 / 怎么配」默认用它。粗筛后决赛每对手至少 100 场，按综合胜率排序。
- **compare_variants**：只换一处，给出前后差，并说明分不分得出来。
- **matchup_pool**：已经确定的一套方案，打完整池。
**木桩伤害（只有用户明确要伤害期望时）**
- **optimize_both** / **optimize_skills** / **optimize_mates**：打不还手木桩的伤害期望，不是胜率。
- simulate_many / simulate：木桩上的少数方案对拍或单套明细。
**我的 box 与信息（毫秒级）**
- **get_my_box**：读这位用户的 box。
- get_config：读当前配将区配置（先调它，别猜）。
- search_hero / hero_detail、search_skill / list_skills / skill_detail：查档案。机制解释只用这里的官方描述。
- validate_plan：校验方案合法性。box 外的将法不算不合法，只是不能应用。

工作方式（重要）：
- 数字只能来自上面这些工具。胜率、总伤、前三回合都要带证据编号。
- 搜索很贵：先让报价出现，用户确认后再跑。取消了就停，不要换个说法再跑同样的规模。
- 检索 0 命中时先换词，不要拿同一个词反复重试。
- 场次和调用次数还有剩余，就把这次配将做完。只有工具因为额度被拒绝之后，才说明还差哪一步。不要提前停下来问要不要继续。`;

/** 本轮预算的实参提示（数字来自 `BudgetState`，避免把上限写死在提示词里） */
export function budgetHint(b: Budget): string {
  return [
    `本轮预算：最多 ${b.maxCalls} 次工具调用 · 累计 ${b.maxBattles} 场真跑 · 工具耗时 ${Math.round(b.maxMs / 1000)} 秒 · ${b.maxTokens} token。`,
    '额度是给你用的，不是给你省的：该补的档案、该拉的池子、该跑的对拍，正常走完。工具耗时不含思考、也不含等人确认。',
    '场次、调用次数或工具耗时用尽、工具被拒绝之后，才说明还差哪一步。还有剩余就在这一轮做完，不要停下来问要不要继续。',
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
   * 比"这个人偏好什么口径"更硬 —— 顺序：SYSTEM_PROMPT → budgetHint → Task → box → prefs → history → 本轮提问 → 近距离引导。
   * 空 box 也有块（一小段空态提示：先要截图，别假设），见 `box.renderBoxBlock`。
   */
  boxText?: string;
  /**
   * 「本次会话的任务」回显块（`memory.renderTaskBlock()` 产物；空任务 = `''` 不注入）。
   * **静态 system 块**（会话内不变 → 不破坏前缀缓存）：把开头那句话摆在最前面，防跑题。
   */
  taskText?: string;
  /**
   * **首轮锚定**（S3，见设计文档 §16.3）：为 true 时，本轮的**第一个请求**只发
   * `get_config` + 三个常驻工具；任何一个工具调用成功后就放开。
   * 调用方（页面）传 `session.turns.every((t) => (t.evidence ?? []).length === 0)`
   * ——「这个会话还没跑过任何工具」，与套件 `promoted` 语义一致。
   */
  anchor?: boolean;
  /**
   * 关掉工具面分档 = 回到全量工具面（**只给评测 A/B 与排查用**，见设计文档 §16.6）：
   * 同一批用例开着 / 关着各跑一遍，才知道分档到底让模型变好了还是只是变便宜了。
   */
  noRouting?: boolean;
  /**
   * 关掉**近距离引导**（S2 那条贴在提问之后的 `<advisor_route>` 块）——只给评测 A/B 用：
   * `noRouting` 下 `tiers = ALL_TIERS`（含 search）→ 引导反而更偏搜索，于是"全量面"那一臂混着引导的效应。
   * 要分离工具面与引导，就得有这一档（2×2 对照）。
   */
  noGuide?: boolean;
  /**
   * 关掉**交付前自检**（§16.22：模型给出终稿时若有大数字没带 `[[ev-…]]`，回灌一次允许重答一轮）。
   * 只给评测 A/B 用——要量它值多少分，就得能把它关掉。
   */
  noSelfCorrect?: boolean;
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
  // 档位在拼消息之前就要定下来：**近距离引导的文案按档变化**（见设计文档 §16.5）。
  const initialTiers: AdvisorTier[] = input.noRouting ? [...ALL_TIERS] : classifyTiers(userText);
  // 首轮锚定（S3）：调用方说"这个会话还没跑过任何工具"时才生效；**noRouting 时也不锚定**（对照要干净）
  const initialAnchor = input.anchor === true && !input.noRouting;
  const messages: AdvisorMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: budgetHint(ctx.budget) },
    // 「本次会话的任务」回显（静态块，摆在最前面防跑题）
    ...(input.taskText ? [{ role: 'system' as const, content: input.taskText }] : []),
    // 「我的 box」（配将前提条件：能用的将 / 战法范围）：空 box 也有块（提示先要截图）
    ...(input.boxText ? [{ role: 'system' as const, content: input.boxText }] : []),
    // 「你的偏好」档案：空档案不注入空块（memory.renderProfileBlock 已经保证空 → ''）
    ...(input.profileText ? [{ role: 'system' as const, content: input.profileText }] : []),
    ...(input.history ?? []),
    { role: 'user', content: userText },
    // ── 近距离引导（S2）：贴在本轮提问**之后**，同一个请求、缓存中性 ──────────────────
    // 套件 P13/P14/P16/P20 实测：同一条指令放 system（远距离）会衰减甚至反向，放用户消息之后零衰减。
    // 用 **user 角色**而不是 system：用户自填 baseUrl，部分 OpenAI 兼容端点不接受"中途出现的 system"，
    // 不能赌；块自带 <advisor_route> 标签 + 【本轮路由】抬头，模型分得清这不是用户说的话。
    // （`noGuide` 只给评测 A/B 用：分离"引导"与"工具面"各自的贡献）
    ...(input.noGuide ? [] : [{ role: 'user' as const, content: renderTurnGuide(initialTiers, userText, { anchor: initialAnchor }) }]),
  ];
  const toolCalls: ToolCallRecord[] = [];
  const allTools = createTools();
  let answer = '';
  let degraded = false;
  /** 超过 token 上限后置位：后续工具调用一律拒绝（但让模型把话说完） */
  let toolsDisabled = false;
  /** 交付前自检（§16.22）：只自纠一轮，避免与模型的执拗死循环 */
  let selfCorrected = false;
  /** 触发自纠的裸报数字（给面板 / 记分卡看，也随 `turn` 返回） */
  let selfCorrectBare: string[] = [];

  // ── 工具面分档（「思考模式」路由，见设计文档 §16）──────────────────────────────
  // 档位由**代码**推进：起始档看用户消息，之后看**真实执行过**的工具——不问模型"你在哪个阶段"。
  // ctx 一轮一个（生产每次 send 新建 makeCtx），所以不还原也无害：下一轮开头必然重设。
  let tiers: AdvisorTier[] = [...initialTiers];
  /** 首轮锚定：会话还没跑过任何工具 → 本轮第一个请求保持窄面；跑成功一个就放开 */
  let anchor = initialAnchor;
  const promotions: AdvisorRoute['promotions'] = [];
  /** 本回合**已成功执行**的工具名（"不许空口开档"的判据之一） */
  const calledThisTurn: string[] = [];
  /** 最后一轮**实际发出去**的工具面（route 快照记它，保证与 wire 逐字一致） */
  let wiredNames: string[] = [];
  let currentRound = 0;
  ctx.route = {
    tiers: () => [...tiers],
    anchor: () => anchor,
    promote(tier, why) {
      if (!PROMOTABLE.includes(tier)) {
        return { ok: false, message: `没有「${String(tier)}」这一档可开；能开的只有 ${PROMOTABLE.join(' / ')}。` };
      }
      if (why.trim().length < 2) {
        return { ok: false, message: '理由不能为空：说清这一轮为什么需要它，再调一次 route_task。' };
      }
      if (tiers.includes(tier)) {
        return { ok: true, message: `${tier} 档本来就已开放（当前档：${tiers.join(' + ')}），直接调工具就行。` };
      }
      // 不许空口开档：要么用户消息本来就指向这一档，要么本回合已经先用开放工具查过东西
      if (!classifyTiers(userText).includes(tier) && calledThisTurn.length === 0) {
        return {
          ok: false,
          message: `还不能开 ${tier} 档：先用已开放的工具查清楚（至少成功跑一次），或者确认用户确实要「${TIER_HINT[tier]}」。`,
        };
      }
      tiers = [...tiers, tier];
      promotions.push({ tier, why: why.trim(), round: currentRound });
      return { ok: true, message: `${tier} 档已开放（${TIER_HINT[tier]}）：现在可以调 ${TIER_TOOLS[tier].join(' / ')}。` };
    },
  };

  // 长搜索（L2/L3）需要：取消信号 + 进度外抛
  ctx.signal = signal;
  ctx.onProgress = (e) => onEvent?.({ type: 'tool_progress', name: e.name, done: e.done, total: e.total, label: e.label });

  for (let round = 0; round < maxRounds; round += 1) {
    currentRound = round;
    throwIfAborted(signal);
    onEvent?.({ type: 'round', index: round });
    // 每轮重算工具面：档位可能在上一轮被 route_task 或真实调用推上去；锚定轮只发锚定面
    const toolSpecs = filterToolSpecs(allTools, wireToolNames(tiers, anchor)).map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
    }));
    /** 本轮成功执行的工具（用于代码侧推进） */
    const ranThisRound: string[] = [];
    wiredNames = toolSpecs.map((t) => t.name);
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
      // ── 交付前自检（§16.22）───────────────────────────────────────────────────
      // 真模型三次跑里，1~3 条用例都栽在"数字没带 [[ev-…]]"上，而关 2 会因此把方案卡的
      // 「应用」禁掉（安全闸生效，但用户拿到的是个不能用的方案）。调提示词没测出效果（§16.21），
      // 于是把这一步从"禁用按钮"升级为"纠正输出"：**只说事实**（哪几个数字没引用），
      // 明确要求"只补引用、数字与结论都不许改"，最多自纠一轮。
      // `noSelfCorrect` 给评测 A/B 用（要量它对通过率的贡献就得能关掉它）。
      // ⚠️ 只查**剥掉围栏 JSON 后的正文**（`parsePlans(...).text`）：方案卡 payload 里的数字
      // （mean / meanTotal / runs…）由关 2（evidenceIds）与关 3（复算）另行把关，不需要在正文里带引用。
      // 查原文会把每个方案卡都误判成裸报（2026-10-06 实现时踩过：4 个既有用例当场红）。
      const visible = parsePlans(text).text;
      const bare = selfCorrected || input.noSelfCorrect ? [] : uncitedBigNumbers(visible);
      if (bare.length) {
        selfCorrected = true;
        selfCorrectBare = bare;
        messages.push({ role: 'assistant', content: text });        messages.push({
          role: 'user',
          content:
            `【交付前自检】你上面这段里有 ${bare.length} 个数字一次都没跟证据编号：${bare.slice(0, 8).join('、')}` +
            `${bare.length > 8 ? ' 等' : ''}。请**原样重发一遍**，给这些数字各补上 \`[[ev-…]]\`` +
            '（表格里的也要能对上；同一数值带过一次即可）；**数字与结论都不许改**。' +
            '确实没有来源的，就删掉那句或改成"这个我没跑过"。',
        });
        continue;
      }
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
      // 分档门 / 锚定门：本轮没开放的工具**拒绝执行**，如实回灌并指向唯一的正路（逃生门）。
      // ⚠️ 被拒的调用**不进 `toolCalls`**：evidence 只记真跑过的，否则关 2 溯源会被空记录污染。
      if (!wireUnlocked(c.name, tiers, anchor)) {
        const msg = lockedToolMessage(c.name, tiers, anchor);
        onEvent?.({ type: 'tool_end', name: c.name, ms: 0, battles: 0, error: msg });
        messages.push({ role: 'tool', toolCallId: c.id, content: JSON.stringify({ error: msg }) });
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
        ranThisRound.push(c.name);
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
    // 代码侧推进：本轮**真跑过**的工具 → 它的档位并进会话档位（只增不减，避免"刚用过的工具下轮不见了"）
    if (ranThisRound.length) {
      tiers = tiersAfterCalls(tiers, ranThisRound);
      calledThisTurn.push(...ranThisRound);
      anchor = false; // 首轮锚定：跑成功一个工具就放开（与套件 promoted 语义一致）
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
  const route: AdvisorRoute = {
    tiers: [...tiers],
    // 快照记**实际发出去**的那份（与线上 payload 逐字同序）；一轮都没跑过（降级/无工具）才退回档表推导
    toolNames: wiredNames.length ? [...wiredNames] : wireToolNames(tiers, anchor),
    promotions,
    anchor,
  };
  return {
    messages,
    toolCalls,
    plans: parsed.plans,
    checks,
    answer: parsed.text,
    degraded,
    verdict,
    route,
    ...(selfCorrectBare.length ? { selfCorrect: selfCorrectBare } : {}),
  };
}

/**
 * 被分档 / 锚定挡住时的回灌文案——**要让模型自己走得出来**：说清它属于哪一档、当前开放什么、
 * 唯一的正路是什么（首轮锚定下就是"先调一次工具"；否则是 `route_task`），而不是换个说法重试。
 */
function lockedToolMessage(name: string, tiers: AdvisorTier[], anchor = false): string {
  const open = wireToolNames(tiers, anchor).join(', ');
  if (anchor) {
    return (
      `工具「${name}」本轮未开放：**这是本次会话的第一个请求**（首轮锚定，只开 ${ANCHOR_TOOL}，好让第一步就是"先看清当前配置"）。` +
      `当前开放：${open}。**调一次 ${ANCHOR_TOOL}（或任何已开放工具）就会放开默认档**，然后再调你要的；确实急着要也可以直接 route_task。`
    );
  }
  const tier = tierOf(name);
  if (tier && PROMOTABLE.includes(tier)) {
    return (
      `工具「${name}」本轮未开放（它属于 ${tier} 档：${TIER_HINT[tier]}）。当前开放：${open}。` +
      `确实需要它就跑 route_task({"tier":"${tier}","why":"…"}) 说明理由，通过后当场开放；否则请用已开放的工具。`
    );
  }
  return `工具「${name}」本轮未开放。当前开放：${open}；完整清单见 tools_catalog。`;
}
