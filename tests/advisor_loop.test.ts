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
import { SLOTTED_HEROES } from '../web/heroes';

const turn = (script: Parameters<typeof createFakeTransport>[0], opts: { userText?: string; ctx?: ReturnType<typeof makeCtx>; maxToolCalls?: number; signal?: AbortSignal; rejectTools?: boolean } = {}) =>
  runAdvisorTurn({
    userText: opts.userText ?? '帮我看看这队',
    ctx: opts.ctx ?? makeCtx({ fakeRuns: true }),
    transport: createFakeTransport(script, { rejectTools: opts.rejectTools }),
    ...(opts.maxToolCalls === undefined ? {} : { maxToolCalls: opts.maxToolCalls }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
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

  it('方案 + 真证据 → 计划被解析出来、合法且可溯源；关 3 未接入 → 应用仍禁用', async () => {
    const ctx = makeCtx({ fakeRuns: true });
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
    expect(t.verdict.recomputed).toBe(false);
    expect(t.verdict.apply.enabled).toBe(false);
    expect(t.verdict.apply.reason).toContain('复算');
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
