/**
 * Task 4：传输层（web/advisor/transport.ts）
 * 锁：SSE 行解析、tool_calls 分片拼装（含坏 JSON 暴露）、假传输脚本（文本函数 / 拒绝 tools）。
 * 真实调用不打网络——本文件只测纯函数与假传输；真实链路由界面（advisor-lab.html）人工验证。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  AdvisorError,
  assembleToolCalls,
  createFakeTransport,
  parseSSELine,
  toApiMessages,
  type ChatRequest,
} from '../web/advisor/transport';
import type { AdvisorMessage } from '../web/advisor/types';

describe('advisor transport', () => {
  it('parseSSELine 认 data: 行、忽略 [DONE] / 注释 / 空行', () => {
    expect(parseSSELine('data: {"a":1}')).toEqual({ a: 1 });
    expect(parseSSELine('data: [DONE]')).toBeNull();
    expect(parseSSELine(': keep-alive')).toBeNull();
    expect(parseSSELine('')).toBeNull();
    expect(parseSSELine('event: ping')).toBeNull();
  });

  it('parseSSELine 坏 JSON → format 错（不静默吞）', () => {
    expect(() => parseSSELine('data: {oops')).toThrowError(AdvisorError);
    try {
      parseSSELine('data: {oops');
    } catch (e) {
      expect((e as AdvisorError).code).toBe('format');
    }
  });

  it('assembleToolCalls 按 index 拼接分片 arguments', () => {
    const calls = assembleToolCalls([
      { index: 0, id: 'c1', function: { name: 'simulate', arguments: '{"pl' } },
      { index: 0, function: { arguments: 'an":1}' } },
      { index: 1, id: 'c2', function: { name: 'get_config', arguments: '{}' } },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ id: 'c1', name: 'simulate', args: { plan: 1 } });
    expect(calls[1].name).toBe('get_config');
  });

  it('assembleToolCalls：参数为空 → {}（合法），坏 JSON → format 错', () => {
    expect(assembleToolCalls([{ index: 0, id: 'c', function: { name: 'x' } }])[0].args).toEqual({});
    expect(() => assembleToolCalls([{ index: 0, id: 'c', function: { name: 'x', arguments: '{oops' } }])).toThrowError(/JSON/);
  });

  it('toApiMessages：assistant 带 tool_calls、tool 带 tool_call_id', () => {
    const messages: AdvisorMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_config', args: {} }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1' },
    ];
    const out = toApiMessages(messages) as Array<Record<string, unknown>>;
    expect(out[1].tool_calls).toHaveLength(1);
    expect((out[1].tool_calls as Array<{ function: { arguments: string } }>)[0].function.arguments).toBe('{}');
    expect(out[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });

  it('假传输：按脚本产出 text / tool_calls / usage / done（每次 chat 消费一步）', async () => {
    const t = createFakeTransport([
      { text: '你好', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
      { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
      { text: '结束' },
    ]);
    const types: string[] = [];
    const texts: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      for await (const e of t.chat({ messages: [], tools: [] })) {
        types.push(e.type);
        if (e.type === 'text') texts.push(e.delta);
      }
    }
    expect(types).toContain('usage');
    expect(types).toContain('tool_calls');
    expect(types.filter((x) => x === 'done')).toHaveLength(3); // 每次 chat 一个 done
    expect(texts).toEqual(['你好', '结束']);
  });

  it('假传输：text 支持函数（测试里据此从工具消息取真实 evidenceId）', async () => {
    const t = createFakeTransport([{ text: (req: ChatRequest) => `收到 ${req.messages.length} 条消息` }]);
    const out: string[] = [];
    for await (const e of t.chat({ messages: [{ role: 'user', content: 'x' }], tools: [] })) if (e.type === 'text') out.push(e.delta);
    expect(out[0]).toBe('收到 1 条消息');
  });

  it('假传输：rejectTools 模拟厂商不支持工具调用（带 tools 即抛 format）', async () => {
    const t = createFakeTransport([{ text: 'ok' }], { rejectTools: true });
    const run = async (tools: ChatRequest['tools']) => {
      for await (const _ of t.chat({ messages: [], tools })) void _;
    };
    await expect(run([{ name: 'get_config', description: 'x', schema: {} }])).rejects.toMatchObject({ code: 'format' });
    await expect(run([])).resolves.toBeUndefined();
  });
});
