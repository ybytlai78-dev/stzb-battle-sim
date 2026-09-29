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

  it('box 块摆位：SYSTEM_PROMPT → 预算 → **box** → 偏好 → 历史 → 提问', async () => {
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
    expect(msgs.at(-1)?.content).toBe('这队怎么配');
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
    expect(sys).toContain('共 13 个');
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
