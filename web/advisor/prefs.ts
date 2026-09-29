/**
 * AI 配将顾问 ·「你的偏好」抽取器
 * ---------------------------------------------------------------------------
 * 参考 harness 的**第 ③ 点**：它写入的不是一张「偏好表」，而是把**转录 + 抽取口径**
 * （bank manifest 的 `retain_mission` / `retain_extraction_mode` / `retain_custom_instructions`）交给抽取器，
 * 由抽取器（服务端）决定从对话里抽出哪些长期事实。
 *
 * 本项目没有服务端 → 这一趟抽取由**同一条厂商 API 的一次非流式小请求**完成（`transport.once()`，temperature 0）：
 *   · 每轮结束调用一次（写不写由 `view.ts` 的开关决定，见 `ViewSettings.autoProfile`）；
 *   · **永不抛错**：拿不到答案就当"这轮没有可记的"，绝不影响对话本身；
 *   · 只增/删档案条目，数字与临时方案一律不记（那些随时会变，且会污染口径）。
 */
import type { PrefProfile } from './memory';
import type { AdvisorTransport } from './transport';

export interface PrefAdd {
  key: string;
  value: string;
}
export interface PrefExtractResult {
  add: PrefAdd[];
  remove: string[];
}

export interface PrefExtractInput {
  userText: string;
  answer: string;
  profile: PrefProfile;
}

/** 一次最多接受几条（模型偶尔会一次吐一堆，多余的丢掉，保持档案紧凑） */
export const MAX_EXTRACT_ITEMS = 5;
/** 送进去的顾问回答截断（抽取只需要语气与结论，不需要整篇） */
export const EXTRACT_ANSWER_MAX = 1500;

export const EXTRACT_SYSTEM_PROMPT = `你是「配将偏好档案」整理员。给你某位用户与配将顾问的一轮对话，以及他的现有档案。

只抽**跨轮长期有效**的偏好，判据：
- 口径 / 排序偏好：例「只看核心将伤害期望」「不看全队总伤」「别拿胜率说事」；
- 常用或明确偏爱的武将 / 兵种 / 队伍类型：例「常用文鸯」「只要输出向」「不要控制队」；
- 忌讳与硬约束：例「不要下架武将」「木桩不还手就该说明」；
- 流程与表达偏好：例「长搜索先问我」「结论要短」。

不要记：
- 一次性的具体问题（"这队打多少"）、临时数值、临时方案；
- 档案里已有且这轮没再强调的条目；
- 任何工具返回的数字（那些随时会变，记了就是错的）。

输出**只有一个 JSON 对象**，不要解释、不要多余文字：
{"add":[{"key":"口径","value":"只看核心将伤害期望"}],"remove":["旧条目取值原文"]}
- key ≤ 6 字（口径 / 常用 / 忌讳 / 流程 / 风格…），value ≤ 40 字、写成人话；
- 没有可记的就输出 {"add":[],"remove":[]}；
- remove 只在用户**明确否定或更正**了某条旧偏好时使用：填旧条目的 value 原文（或「标签=取值」）。`;

/** 抽取请求的 user 内容：本轮对话 + 现有档案（档案带上才能去重、才能判断该不该 remove） */
export function buildExtractInput(input: PrefExtractInput, answerMax = EXTRACT_ANSWER_MAX): string {
  const answer = (input.answer ?? '').trim();
  const existing = input.profile.items.length
    ? input.profile.items.map((it) => `- ${it.key}：${it.value}${it.seen > 1 ? `（已确认 ${it.seen} 次）` : ''}`).join('\n')
    : '（空）';
  return [
    `【本轮用户】\n${(input.userText ?? '').trim() || '（空）'}`,
    `【本轮顾问回答】\n${answer.length > answerMax ? `${answer.slice(0, answerMax)}…` : answer || '（空）'}`,
    `【现有档案】\n${existing}`,
  ].join('\n\n');
}

/** 容错解析：围栏 / 裸 JSON 都认；坏 JSON、结构不对 → 空结果（**不抛错**，与 `parsePlans` 同款脾气） */
export function parsePrefReply(text: string): PrefExtractResult {
  const empty: PrefExtractResult = { add: [], remove: [] };
  if (!text) return empty;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    const braced = /\{[\s\S]*\}/.exec(body);
    if (!braced) return empty;
    try {
      parsed = JSON.parse(braced[0]);
    } catch {
      return empty;
    }
  }
  const obj = parsed as { add?: unknown; remove?: unknown };
  const addRaw = Array.isArray(obj?.add) ? obj.add : [];
  const add: PrefAdd[] = [];
  for (const raw of addRaw) {
    const r = raw as { key?: unknown; value?: unknown };
    const value = typeof r?.value === 'string' ? r.value.trim() : '';
    if (!value) continue;
    add.push({ key: typeof r?.key === 'string' ? r.key.trim() : '', value });
    if (add.length >= MAX_EXTRACT_ITEMS) break;
  }
  const remove = (Array.isArray(obj?.remove) ? obj.remove : [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim())
    .slice(0, MAX_EXTRACT_ITEMS);
  return { add, remove };
}

/**
 * 造一个抽取器：走 `transport.once()`（非流式、不带 tools）。
 * `transport.once` 缺省（假传输没给脚本）→ 直接返回空结果，等于"这轮没得记"。
 */
export function createProfileExtractor(
  transport: AdvisorTransport,
  opts: { temperature?: number; signal?: () => AbortSignal | undefined } = {}
): (input: PrefExtractInput) => Promise<PrefExtractResult> {
  return async (input) => {
    if (typeof transport.once !== 'function') return { add: [], remove: [] };
    try {
      const text = await transport.once(
        {
          messages: [
            { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
            { role: 'user', content: buildExtractInput(input) },
          ],
          tools: [],
          temperature: opts.temperature ?? 0,
        },
        opts.signal?.()
      );
      return parsePrefReply(text);
    } catch {
      return { add: [], remove: [] };
    }
  };
}
