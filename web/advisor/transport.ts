/**
 * AI 配将顾问 · LLM 传输层（OpenAI 兼容 / 流式）
 * ---------------------------------------------------------------------------
 * 只干一件事：把消息发出去、把流式增量收回来、把 `tool_calls` 分片拼装完整。
 * **不认识配将、不认识引擎、不认识 DOM** —— 所以可以整体替换（例如日后换成自建后端代理）。
 *
 * 错误分类（`AdvisorError.code`）用于给用户可操作的提示：auth=key 问题 / cors=可能被 CORS 拦 / network=网络或服务端 / format=返回格式不认识。
 */
import type { AdvisorMessage } from './types';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** OpenAI 流式里的 tool_calls 分片（`arguments` 是逐段拼的字符串） */
export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done' };

export interface ChatToolSpec {
  name: string;
  description: string;
  schema: unknown;
}

export interface ChatRequest {
  messages: AdvisorMessage[];
  tools: ChatToolSpec[];
  temperature?: number;
}

export interface AdvisorTransport {
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface AdvisorSettings {
  /** 例：`https://api.deepseek.com/v1`（末尾斜杠可省） */
  baseUrl: string;
  model: string;
  key: string;
}

export type AdvisorErrorCode = 'auth' | 'cors' | 'network' | 'format';

export class AdvisorError extends Error {
  constructor(
    public readonly code: AdvisorErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AdvisorError';
  }
}

/** 取错误码（不是 AdvisorError 就返回 null）——loop 据此决定是否降级 */
export function advisorErrorCode(e: unknown): AdvisorErrorCode | null {
  return e instanceof AdvisorError ? e.code : null;
}

// ─────────────────────────── 纯函数（可单测） ───────────────────────────

/** 解析一行 SSE：`data: {...}` → 对象；空行 / 注释 / `[DONE]` → null；坏 JSON → format 错 */
export function parseSSELine(line: string): unknown | null {
  const t = line.trim();
  if (!t || t.startsWith(':')) return null;
  if (!t.startsWith('data:')) return null;
  const payload = t.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch {
    throw new AdvisorError('format', `SSE 数据不是合法 JSON：${payload.slice(0, 120)}`);
  }
}

/** 把流式分片按 `index` 拼成完整工具调用；参数不是合法 JSON → format 错（不静默吞） */
export function assembleToolCalls(deltas: ToolCallDelta[]): ToolCall[] {
  const byIndex = new Map<number, { id: string; name: string; argsText: string }>();
  for (const d of deltas) {
    const cur = byIndex.get(d.index) ?? { id: '', name: '', argsText: '' };
    if (d.id) cur.id = d.id;
    if (d.function?.name) cur.name = d.function.name;
    if (d.function?.arguments) cur.argsText += d.function.arguments;
    byIndex.set(d.index, cur);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, c]) => {
      const text = c.argsText.trim();
      let args: unknown = {};
      if (text) {
        try {
          args = JSON.parse(text);
        } catch {
          throw new AdvisorError('format', `工具参数不是合法 JSON：${text.slice(0, 120)}`);
        }
      }
      return { id: c.id || `call_${index}`, name: c.name, args };
    });
}

/** 顾问消息 → OpenAI 兼容负载 */
export function toApiMessages(messages: AdvisorMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
    return { role: m.role, content: m.content };
  });
}

// ─────────────────────────── 真实传输（浏览器 / Node 22 都可以） ───────────────────────────

export function createBrowserTransport(settings: AdvisorSettings): AdvisorTransport {
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    async *chat(req, signal) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.key}` },
          body: JSON.stringify({
            model: settings.model,
            messages: toApiMessages(req.messages),
            ...(req.tools.length
              ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) }
              : {}),
            stream: true,
            stream_options: { include_usage: true },
            ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
          }),
          signal,
        });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        throw new AdvisorError('cors', `请求没能发出去（可能是 CORS 或网络问题）：${(e as Error)?.message ?? String(e)}`);
      }
      if (res.status === 401 || res.status === 403) throw new AdvisorError('auth', `${res.status}：key 无效或没有权限`);
      if (!res.ok) throw new AdvisorError('network', `服务端返回 ${res.status} ${res.statusText}`);
      const reader = res.body?.getReader();
      if (!reader) throw new AdvisorError('format', '响应没有可读流（该厂商可能不支持 stream）');

      const dec = new TextDecoder();
      const deltas: ToolCallDelta[] = [];
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const chunk = parseSSELine(line) as {
            choices?: Array<{ delta?: { content?: string; tool_calls?: ToolCallDelta[] } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          } | null;
          if (!chunk) continue;
          const delta = chunk.choices?.[0]?.delta;
          if (typeof delta?.content === 'string' && delta.content) yield { type: 'text', delta: delta.content };
          if (Array.isArray(delta?.tool_calls)) deltas.push(...delta.tool_calls);
          if (chunk.usage)
            yield {
              type: 'usage',
              usage: {
                promptTokens: chunk.usage.prompt_tokens ?? 0,
                completionTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
              },
            };
        }
      }
      if (deltas.length) yield { type: 'tool_calls', calls: assembleToolCalls(deltas) };
      yield { type: 'done' };
    },
  };
}

// ─────────────────────────── 假传输（测试 / 无 key 的干跑） ───────────────────────────

export interface FakeStep {
  /** 文本（字符串，或按请求计算的函数——测试里用它从工具消息里取真实 evidenceId） */
  text?: string | ((req: ChatRequest) => string);
  /** 同一次响应里吐多段文本（测流式增量拼接） */
  texts?: string[];
  calls?: ToolCall[];
  usage?: TokenUsage;
  error?: AdvisorErrorCode;
}

export interface FakeTransportOpts {
  /** 模拟「厂商不支持工具调用」：请求带 tools 就抛 format 错 */
  rejectTools?: boolean;
}

export function createFakeTransport(script: FakeStep[], opts: FakeTransportOpts = {}): AdvisorTransport {
  let i = 0;
  return {
    async *chat(req) {
      if (opts.rejectTools && req.tools.length) throw new AdvisorError('format', '该模型不支持 tools（假传输层模拟）');
      const step = script[i];
      i += 1;
      if (!step) {
        yield { type: 'done' };
        return;
      }
      if (step.error) throw new AdvisorError(step.error, `假传输层错误：${step.error}`);
      if (step.usage) yield { type: 'usage', usage: step.usage };
      if (step.texts?.length) for (const t of step.texts) yield { type: 'text', delta: t };
      else if (typeof step.text === 'function') yield { type: 'text', delta: step.text(req) };
      else if (typeof step.text === 'string') yield { type: 'text', delta: step.text };
      if (step.calls?.length) yield { type: 'tool_calls', calls: step.calls };
      yield { type: 'done' };
    },
  };
}
