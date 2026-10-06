/**
 * 对话循环（精简版，web/advisor/loop.ts）
 * 锁：流式拼接 / 工具分支与回灌 / 工具报错如实回灌 / 取消 / 无工具降级 / 方案与证据的裁定。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { runAdvisorTurn } from '../web/advisor/loop';
import { createFakeTransport, type ChatRequest } from '../web/advisor/transport';
import { makeCtx } from '../web/advisor/tools';
import { DEFAULT_DUMMY, type AdvisorMessage, type AdvisorPlan } from '../web/advisor/types';
import type { BoxView } from '../web/advisor/box';
import { SLOTTED_HEROES } from '../web/heroes';

const turn = (
  script: Parameters<typeof createFakeTransport>[0],
  opts: {
    userText?: string;
    ctx?: ReturnType<typeof makeCtx>;
    maxToolCalls?: number;
    signal?: AbortSignal;
    rejectTools?: boolean;
    profileText?: string;
    boxText?: string;
    /** 与自纠无关的用例显式关掉它（自纠本身另有专测）——否则假传输脚本会被多要一轮 */
    noSelfCorrect?: boolean;
  } = {}
) =>
  runAdvisorTurn({
    userText: opts.userText ?? '帮我看看这队',
    ctx: opts.ctx ?? makeCtx({ fakeRuns: true }),
    transport: createFakeTransport(script, { rejectTools: opts.rejectTools }),
    ...(opts.maxToolCalls === undefined ? {} : { maxToolCalls: opts.maxToolCalls }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    ...(opts.profileText === undefined ? {} : { profileText: opts.profileText }),
    ...(opts.boxText === undefined ? {} : { boxText: opts.boxText }),
    ...(opts.noSelfCorrect === undefined ? {} : { noSelfCorrect: opts.noSelfCorrect }),
  });

describe('advisor loop（精简版）', () => {
  it('纯文本回答：无工具调用 → 一轮结束，answer 由流式增量拼成', async () => {
    const t = await turn([{ texts: ['先', '说', '结论'] }]);
    expect(t.answer).toBe('先说结论');
    expect(t.toolCalls).toHaveLength(0);
    expect(t.degraded).toBe(false);
  });

  it('工具分支：调用 → 真执行 → 结果回灌 → 出终答（trace 记下 evidenceId + 摘要）', async () => {
    const t = await turn([{ calls: [{ id: 'c1', name: 'get_config', args: {} }] }, { text: '收到了配置' }]);
    expect(t.toolCalls).toHaveLength(1);
    expect(t.toolCalls[0].name).toBe('get_config');
    expect(t.toolCalls[0].evidenceId).toMatch(/^ev-\d+-get_config$/);
    // 回灌的消息里带 evidenceId（模型据此写引用）且不含明细大对象
    const toolMsg = t.messages.find((m) => m.role === 'tool') as AdvisorMessage;
    expect(toolMsg.content).toContain('evidenceId');
    expect(toolMsg.content.length).toBeLessThan(600);
  });

  it('工具报错 → 如实回灌（带 error 文本），循环继续而不是崩掉', async () => {
    const t = await turn([
      { calls: [{ id: 'c1', name: 'validate_plan', args: { plan: { slots: 'bad' } } }] },
      { text: '我改用合法写法' },
    ]);
    const toolMsg = t.messages.find((m) => m.role === 'tool') as AdvisorMessage;
    expect(toolMsg.content).toContain('error');
    expect(toolMsg.content).toContain('plan 结构不对');
    expect(t.answer).toContain('合法');
  });

  it('单轮工具调用上限：超出的那次变成「已达上限」的 tool 消息', async () => {
    const t = await turn(
      [
        { calls: [
          { id: 'c1', name: 'get_config', args: {} },
          { id: 'c2', name: 'get_config', args: {} },
        ] },
        { text: '好' },
      ],
      { maxToolCalls: 1 }
    );
    expect(t.toolCalls).toHaveLength(1);
    const toolMsgs = t.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[1].content).toContain('上限');
  });

  it('次数上限的默认值来自预算（不再各自写死 8）：budget.maxCalls = 2 → 第 3 次被拦', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxCalls: 2 } });
    const t = await turn(
      [
        {
          calls: [
            { id: 'c1', name: 'get_config', args: {} },
            { id: 'c2', name: 'get_config', args: {} },
            { id: 'c3', name: 'get_config', args: {} },
          ],
        },
        { text: '收口' },
      ],
      { ctx }
    );
    expect(ctx.budget.maxCalls).toBe(2);
    expect(t.toolCalls).toHaveLength(2);
    expect(t.messages.filter((m) => m.role === 'tool')[2].content).toContain('上限');
  });

  it('token 记账与上限：usage 累加进 budget.tokens，超限则收口（默认 100 万够不着）', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxTokens: 100 } });
    const t = await turn(
      [
        { calls: [{ id: 'c1', name: 'get_config', args: {} }], usage: { promptTokens: 60, completionTokens: 60, totalTokens: 120 } },
        { text: '额度用完，先给已拿到的' },
      ],
      { ctx }
    );
    expect(ctx.budget.tokens).toBe(120);
    expect(t.answer).toContain('额度');
    // 超限后不再执行工具
    expect(t.toolCalls).toHaveLength(0);
  });

  it('工具明细以 brief 进上下文（模型看得到每将/每战法，而不是只有一句摘要）', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    const t = await turn(
      [{ calls: [{ id: 'c1', name: 'simulate', args: { plan: ctx.deps.__plan, runs: 20 } }] }, { text: '看完了' }],
      { ctx }
    );
    const toolMsg = t.messages.find((m) => m.role === 'tool') as AdvisorMessage;
    expect(toolMsg.content).toContain('brief');
    expect(toolMsg.content).toContain('每将（场均伤害）');
  });

  it('取消：abort 后抛 AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(turn([{ text: 'a' }], { signal: ac.signal })).rejects.toThrow(/取消|abort/i);
  });

  it('无工具模式降级：厂商拒绝 tools → 去掉 tools 重试，turn.degraded = true', async () => {
    const t = await turn([{ text: '我只能基于已有信息解释' }], { rejectTools: true });
    expect(t.degraded).toBe(true);
    expect(t.toolCalls).toHaveLength(0);
    expect(t.answer).toContain('解释');
  });

  it('方案 + 真证据 → 计划被解析、合法、可溯源，且**关 3 标准口径复算**跑过 → 应用可用', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    // 用**上架池**武将拼方案：合法方案才走得到「已验证」那一关
    const plan: AdvisorPlan = {
      slots: SLOTTED_HEROES.slice(0, 3).map((h, i) => ({
        position: (['大营', '中军', '前锋'] as const)[i],
        heroId: h.id,
        level: 40,
        skillIds: [],
      })),
      coreUnitIds: [],
      dummy: { ...DEFAULT_DUMMY },
    };
    const t = await turn(
      [
        { calls: [{ id: 'c1', name: 'simulate', args: { plan, runs: 20 } }] },
        {
          text: (req: ChatRequest) => {
            const last = [...req.messages].reverse().find((m) => m.role === 'tool')!;
            const evidenceId = /"evidenceId":"([^"]+)"/.exec(last.content)![1];
            const payload = JSON.stringify({ plans: [{ title: '方案A', plan, evidenceIds: [evidenceId] }] });
            return `建议如下\n\`\`\`json\n${payload}\n\`\`\``;
          },
        },
      ],
      { ctx }
    );
    expect(t.plans).toHaveLength(1);
    expect(t.plans[0].evidenceIds[0]).toBe(t.toolCalls[0].evidenceId);
    expect(t.verdict.legal).toBe(true);
    expect(t.verdict.verified).toBe(true);
    expect(t.verdict.recomputed).toBe(true);
    expect(t.verdict.apply.enabled).toBe(true);
    expect(t.checks[0].recompute?.seed).toBe(20260929);
    expect(t.checks[0].recompute?.runs).toBe(20);
    expect(t.checks[0].judge).toBe('consistent');
    expect(t.answer).not.toContain('```json');
  });

  it('方案引用不存在的证据 → 未验证（并给原因）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const plan = ctx.deps.__plan;
    const payload = JSON.stringify({ plans: [{ title: '方案A', plan, evidenceIds: ['ev-999-simulate'] }] });
    const t = await turn([{ text: `看这个\n\`\`\`json\n${payload}\n\`\`\`` }], { ctx });
    expect(t.plans).toHaveLength(1);
    expect(t.verdict.verified).toBe(false);
    expect(t.verdict.apply.enabled).toBe(false);
  });
});

// ─────────────────────────── 「我的 box」注入与拒收（设计文档 §15） ───────────────────────────

describe('advisor loop · 我的 box', () => {
  const heroIds = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
  const planOf = (ids: string[]): AdvisorPlan => ({
    slots: ids.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
    coreUnitIds: [],
    dummy: { ...DEFAULT_DUMMY },
  });
  const boxView = (ids: string[], strict = true): BoxView => ({
    profileId: 'p1',
    profileName: '我的号',
    heroIds: new Set(ids),
    skillIds: new Set(),
    strict,
    empty: false,
  });

  it('摆位：SYSTEM_PROMPT → 预算 → **box** → 偏好 → 历史 → 提问 → **近距离引导**（S2）', async () => {
    const transport = createFakeTransport([{ text: '好' }]);
    await runAdvisorTurn({
      userText: '这队怎么配',
      ctx: makeCtx({ fakeRuns: true }),
      transport,
      profileText: '<advisor_prefs>\n- 口径：只看核心将\n</advisor_prefs>',
      boxText: '<advisor_box>\n武将 1：曹操(h23·魏·骑)\n</advisor_box>',
    });
    const msgs = (transport.requests[0] as ChatRequest).messages;
    expect(msgs[0].content).toContain('配将顾问');
    expect(msgs[1].content).toContain('本轮预算');
    expect(msgs[2].content).toContain('<advisor_box>');
    expect(msgs[3].content).toContain('<advisor_prefs>');
    expect(msgs.at(-2)?.content).toBe('这队怎么配'); // 提问
    // 引导贴在提问**之后**（近距离），且不进 system 前缀：「这队怎么配」命中 search 档
    expect(msgs.at(-1)?.content).toContain('<advisor_route>');
    expect(msgs.at(-1)?.content).toContain('optimize_winrate');
    expect(msgs.at(-1)?.role).toBe('user');
  });

  it('提示词第 7 条：box 只是"给自己配将"的范围，其它问题照常；并有 get_my_box 与比较类口径', async () => {
    const transport = createFakeTransport([{ text: '好' }]);
    await runAdvisorTurn({ userText: '随便问问', ctx: makeCtx({ fakeRuns: true }), transport });
    const sys = (transport.requests[0] as ChatRequest).messages[0].content;
    expect(sys).toContain('box 只是');
    expect(sys).toContain('不受 box 限制');
    expect(sys).toContain('不要因为 box 是空的就拒绝回答');
    expect(sys).toContain('八回合全队总伤');
    expect(sys).toContain('前三回合爆发');
    expect(sys).toContain('get_my_box');
    expect(sys).toContain('共 19 个');
  });

  it('提示词补齐两处边界（2026-10-05 核查结论）：下架武将必须声明 + 控制/防御型在木桩口径量不出来', async () => {
    const transport = createFakeTransport([{ text: '好' }]);
    await runAdvisorTurn({ userText: '随便问问', ctx: makeCtx({ fakeRuns: true }), transport });
    const sys = (transport.requests[0] as ChatRequest).messages[0].content;
    // 依据：offline-hero 用例要求「下架/偏低」声明，但提示词里"下架"原本出现 0 次 → 模型无从知晓
    expect(sys).toContain('已下架');
    expect(sys).toContain('数值仅供看方向');
    // 依据：boundary-control 用例要求说清"控制型在木桩口径量不出"，模型换了个说法（判分没认）→ 提示词把它写白
    expect(sys).toContain('量不出来');
    // 依据：metric-ambiguity 用例要求先分清"木桩输出最强 vs 实战最强"
    expect(sys).toContain('木桩输出最强');
    expect(sys).toContain('实战最强');
    expect(sys).toContain('凑不齐三张同阵营照常配');
  });

  it('box 外的将法：方案**合法**（照常看数）但应用禁用 + boxIssues 有机器码', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView([heroIds[0]]) });
    const payload = JSON.stringify({ plans: [{ title: '方案A', plan: planOf(heroIds), evidenceIds: [] }] });
    const t = await turn([{ text: `看这个\n\`\`\`json\n${payload}\n\`\`\`` }], { ctx });
    expect(t.checks[0].legal).toBe(true);
    expect(t.checks[0].legalErrors).toEqual([]);
    expect(t.checks[0].boxIssues?.join(' ')).toContain('hero_not_in_box');
    expect(t.checks[0].recompute).not.toBeNull();
    expect(t.verdict.apply.enabled).toBe(false);
    expect(t.verdict.apply.reason).toContain('box 外');
  });

  it('把三将都放进 box → 同一份方案合法（box 不该误伤自己有的将）', async () => {
    const ctx = makeCtx({ fakeRuns: true, box: boxView(heroIds) });
    const payload = JSON.stringify({ plans: [{ title: '方案A', plan: planOf(heroIds), evidenceIds: [] }] });
    const t = await turn([{ text: `\`\`\`json\n${payload}\n\`\`\`` }], { ctx });
    expect(t.checks[0].legal).toBe(true);
  });
});

describe('交付前自检（§16.22：裸报 → 回灌一次、允许重答一轮）', () => {
  /** 让自检有东西可抓：≥10000 且没跟 `[[…]]` */
  const bad = '八回合全队总伤 106206，前三回合 3218。';
  const good = '八回合全队总伤 106206[[ev-1-simulate]]，前三回合 3218。';

  it('终稿有裸报 → 回灌一次（只说事实：哪几个数字没引用），自纠后的正文带引用', async () => {
    const transport = createFakeTransport([{ text: bad }, { text: good }]);
    const t = await runAdvisorTurn({ userText: '这队能打多少？', ctx: makeCtx({ fakeRuns: true }), transport });
    expect(transport.requests, '应该只多要了自纠那一轮').toHaveLength(2);
    const retry = transport.requests[1].messages.at(-1)!;
    expect(retry.role).toBe('user');
    expect(retry.content).toContain('交付前自检');
    expect(retry.content).toContain('106206'); // 点出是哪个数字
    expect(retry.content).not.toContain('3218'); // 四级数字不算裸报，不许连坐
    expect(retry.content).toContain('原样重发');
    expect(retry.content).toContain('数字与结论都不许改');
    expect(t.answer).toBe(good);
    expect(t.selfCorrect).toEqual(['106206']);
  });

  it('只自纠一轮：第二遍仍裸报就照发（不与模型的执拗死循环）', async () => {
    const transport = createFakeTransport([{ text: bad }, { text: bad }]);
    const t = await runAdvisorTurn({ userText: '这队能打多少？', ctx: makeCtx({ fakeRuns: true }), transport });
    expect(transport.requests).toHaveLength(2);
    expect(t.answer).toBe(bad);
    expect(t.selfCorrect).toEqual(['106206']);
  });

  it('规范回答不触发自检（没有裸报就一轮结束）', async () => {
    const transport = createFakeTransport([{ text: good }]);
    const t = await runAdvisorTurn({ userText: '这队能打多少？', ctx: makeCtx({ fakeRuns: true }), transport });
    expect(transport.requests).toHaveLength(1);
    expect(t.selfCorrect).toBeUndefined();
  });

  it('方案 JSON 围栏里的数字**不算**裸报（关 2/关 3 另行把关，别连坐）', async () => {
    // 案底：自检一开始跑在原文上 → 每个方案卡都被误判成裸报，4 个既有用例当场红。
    // 现在只查剥掉围栏后的正文，这里锁住它。
    const ctx = makeCtx({ fakeRuns: true });
    const payload = JSON.stringify({ plans: [{ title: '方案A', plan: ctx.deps.__plan, evidenceIds: [] }] });
    const transport = createFakeTransport([{ text: `正文里没有大数字。\n\`\`\`json\n${payload}\n\`\`\`` }]);
    const t = await runAdvisorTurn({ userText: '给个方案', ctx, transport });
    expect(transport.requests).toHaveLength(1);
    expect(t.selfCorrect).toBeUndefined();
  });

  it('noSelfCorrect 可关闭（评测 A/B 要量它的贡献就得能关）', async () => {
    const transport = createFakeTransport([{ text: bad }]);
    const t = await runAdvisorTurn({ userText: '这队能打多少？', ctx: makeCtx({ fakeRuns: true }), transport, noSelfCorrect: true });
    expect(transport.requests).toHaveLength(1);
    expect(t.selfCorrect).toBeUndefined();
  });
});
