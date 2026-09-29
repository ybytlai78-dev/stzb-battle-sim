/**
 * AI 配将顾问 · 记忆层（会话持久化 +「你的偏好」档案）
 * ---------------------------------------------------------------------------
 * 口径来源：`docs/AI配将顾问-设计.md` §14（本文件是它的落地代码）。参考实现 = DSH 记忆插件
 * `@vectorize-io/hindsight-coding-agents` 的 `dist/dsh.js`，四条做法逐条映射到「纯前端、无后端」的顾问：
 *
 *  ① **存储位置**
 *     harness：记忆正文在远端 bank（按工作区 cwd 推导 bankId，配置 `~/.hindsight/coding-agent.json`），本地只放
 *     「注入复用状态」（每会话一个 `%TEMP%/hindsight-<harness>/<sessionId>.json`，tmp + rename 原子替换）与
 *     retain 游标（`{bank, turns, fingerprint}`，只读不写正文）。
 *     本项目无后端 → **两把 localStorage 键**：`dsh-advisor-session-v1`（对话 + 证据清单）/
 *     `dsh-advisor-profile-v1`（偏好档案）。体积纪律：证据只存 `evidenceId/name/args/summary/brief/stats`，
 *     **不存 `data`**（几千行跑批明细另有 `cache.ts` 按同一 planKey 持久化，抽屉本身也不读它）；
 *     写失败（配额满 / 隐私模式）自动降级为进程内内存（与 `cache.ts` / `presetStore.ts` 同款退让）。
 *
 *  ② **落盘时机**
 *     harness：`agent/turn-stopping` → **重新抓完整转录**（这样刚生成的回答才在里面）→ 与 `retainedTurns` 游标
 *     比对 → 只写增量、fire-and-forget；刻意不做客户端攒批（注释原话：nothing is ever held somewhere it can be lost）。
 *     本项目：一轮结束（成功 / 失败 / 取消）调 `toStoredTurn` + `appendTurn` + `saveSession`，**一次 JSON + 一次写**；
 *     流式途中再由 `view.ts` 在 `pagehide` 兜底一次。`appendTurn` 按 `turn.id` 幂等（= harness 的游标），
 *     重复保存不会翻倍。
 *
 *  ③ **偏好写入**：见 `prefs.ts`（抽取口径 + 合并规则），本文件只管档案的存取与渲染。
 *
 *  ④ **注入与防污染**
 *     harness：`onPrompt` 合成 `<hindsight_memory>…</hindsight_memory>`，由适配器作为**追加的一条 user 消息**
 *     塞进消息表；回读转录时用 `stripInjectedMemory`（按标签正则）剥掉，防止「注入内容被当成用户说过的话」
 *     再写回记忆（自我污染）。
 *     本项目：`renderProfileBlock()` 产出 `<advisor_prefs>…</advisor_prefs>`，由 `loop.ts` 作为 **system 块**
 *     注入（在 SYSTEM_PROMPT / budgetHint 之后、history 之前）；`historyFrom()` 回灌历史时用 `stripInjected()`
 *     剥掉本层所有注入标签块 —— 同款防污染。
 */
import { evidenceZh } from './trace';
import type { AdvisorMessage, AdvisorTurn, PlanCheck, ProposedPlan, ToolCallRecord, TurnVerdict } from './types';

// ─────────────────────────── 键名与上限（都是常量，测试直接锁） ───────────────────────────

export const SESSION_KEY = 'dsh-advisor-session-v1';
export const PROFILE_KEY = 'dsh-advisor-profile-v1';

/** 注入块的标签（= harness 的 `<hindsight_memory>`；回灌历史时按它剥离，见 `stripInjected`） */
export const PROFILE_TAG = 'advisor_prefs';
export const EVIDENCE_TAG = 'advisor_evidence';
/** 「我的 box」注入块（识图建档，见 `box.ts` / 设计文档 §15）——同样要能被 `stripInjected` 剥掉 */
export const BOX_TAG = 'advisor_box';

/** 会话里最多留几轮（超出的最旧的丢掉，只计数不静默：`session.dropped`） */
export const MAX_TURNS = 30;
/** 回灌给模型的最近轮数 / 总字数上限（harness 的注入也是定额的：reflect 结果 + 名册，不无限膨胀） */
export const REPLAY_TURNS = 6;
export const REPLAY_MAX_CHARS = 12000;
/** 单键写盘上限（localStorage 普遍 5MB，留足余量） */
export const SESSION_MAX_BYTES = 1500000;

export const PROFILE_MAX_ITEMS = 24;
export const PROFILE_KEY_MAX = 12;
export const PROFILE_VALUE_MAX = 80;
export const PROFILE_BLOCK_MAX_CHARS = 1000;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
/** 时间戳 → `09-29 14:03`（会话条 / 档案页脚共用的一份口径） */
export function stampText(t: number): string {
  const d = new Date(t);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const nowIso = stampText;

// ─────────────────────────── 存储（localStorage，失败自动降级内存） ───────────────────────────

export interface MemoryStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** 测试用：纯内存存储 */
export function createMemoryStore(init: Record<string, string> = {}): MemoryStore {
  const map = new Map(Object.entries(init));
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

let shared: MemoryStore | null = null;

/**
 * 造一个「localStorage 优先、写失败降级内存」的存储（**不碰全局**，方便单测：`createDefaultStore(null)` /
 * `createDefaultStore(会抛的假 Storage)`）。只有**这个键写失败过**才从内存副本读 —— 否则
 * `localStorage.clear()`（测试 / 用户清站点数据）之后旧值会从内存里"复活"，那是错的。
 */
export function createDefaultStore(ls: Storage | null): MemoryStore {
  const mem = new Map<string, string>();
  const dirty = new Set<string>();
  return {
    get(k) {
      if (dirty.has(k)) return mem.get(k) ?? null;
      try {
        return ls?.getItem(k) ?? null;
      } catch {
        return mem.get(k) ?? null;
      }
    },
    set(k, v) {
      // 压根没有 localStorage（node / 原生壳异常）→ 直接进内存；否则以写成功与否决定是否降级
      if (!ls) {
        dirty.add(k);
        mem.set(k, v);
        return;
      }
      try {
        ls.setItem(k, v);
        dirty.delete(k);
      } catch {
        dirty.add(k);
        mem.set(k, v);
      }
    },
    remove(k) {
      dirty.delete(k);
      mem.delete(k);
      try {
        ls?.removeItem(k);
      } catch {
        /* 删不掉也只影响下次打开 */
      }
    },
  };
}

/**
 * 默认存储：localStorage（隐私模式 / 配额满 / 原生壳异常都会自动退到内存，绝不抛），
 * 与 `cache.ts`、`presetStore.ts` 的退让口径一致。
 */
export function defaultStore(): MemoryStore {
  if (shared) return shared;
  let ls: Storage | null = null;
  try {
    ls = (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    ls = null;
  }
  shared = createDefaultStore(ls);
  return shared;
}

// ─────────────────────────── 会话 ───────────────────────────

/** 一条落盘的证据（= `ToolCallRecord` 去掉 `data`：抽屉只读摘要 / 场次，重明细在 cache.ts） */
export type StoredEvidence = Omit<ToolCallRecord, 'data'>;

export interface StoredTurn {
  /** 轮次 id：`appendTurn` 按它幂等（harness 的 retainedTurns 游标语义） */
  id: string;
  at: number;
  userText: string;
  answer: string;
  evidence: StoredEvidence[];
  plans: ProposedPlan[];
  checks: PlanCheck[];
  verdict: TurnVerdict;
  /** 厂商不支持工具调用 → 无工具模式跑出来的 */
  degraded?: boolean;
  /** 中断 / 失败留下的半成品（正文只到断点，证据只到已跑完的那几个） */
  partial?: boolean;
  /** 展示用：这一轮跑的模式（`干跑（假传输）` / `deepseek-chat @ …`） */
  mode?: string;
  /** 展示用：这一轮的记忆动作（例「档案 +2（共 5 条）」）——落盘后再回填，刷新也看得见 */
  note?: string;
}

export interface AdvisorSession {
  v: 1;
  id: string;
  startedAt: number;
  updatedAt: number;
  /** 已落盘的轮数（= `turns.length`；harness 的 retainedTurns 同款，读出来能判断"有没有新东西"） */
  retainedTurns: number;
  /** 因上限 / 体积被清掉的更早轮数（只计数，不静默丢） */
  dropped: number;
  turns: StoredTurn[];
}

export function newSessionId(now = Date.now(), rand = Math.random): string {
  return `s${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
}

export function newTurnId(now = Date.now(), rand = Math.random): string {
  return `r${now.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
}

export function emptySession(now = Date.now(), id = newSessionId(now)): AdvisorSession {
  return { v: 1, id, startedAt: now, updatedAt: now, retainedTurns: 0, dropped: 0, turns: [] };
}

/** 容错读：坏 JSON / 结构不对 / 版本不符 → null（当作"没有会话"，绝不抛） */
export function parseSession(raw: string | null): AdvisorSession | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<AdvisorSession>;
    if (!p || p.v !== 1 || !Array.isArray(p.turns)) return null;
    const turns = p.turns.filter((t): t is StoredTurn => Boolean(t) && typeof t === 'object' && typeof t.userText === 'string');
    return {
      v: 1,
      id: typeof p.id === 'string' && p.id ? p.id : newSessionId(),
      startedAt: Number(p.startedAt) || Date.now(),
      updatedAt: Number(p.updatedAt) || Date.now(),
      retainedTurns: turns.length,
      dropped: Math.max(0, Number(p.dropped) || 0),
      turns,
    };
  } catch {
    return null;
  }
}

export function loadSession(store: MemoryStore = defaultStore()): AdvisorSession | null {
  return parseSession(store.get(SESSION_KEY));
}

/** 体积兜底：超出 `maxBytes` 就从最旧的轮次开始丢（只丢轮次，档案不动） */
export function pruneToBytes(session: AdvisorSession, maxBytes = SESSION_MAX_BYTES): AdvisorSession {
  let s = session;
  while (s.turns.length > 1 && JSON.stringify(s).length > maxBytes) {
    s = { ...s, turns: s.turns.slice(1), dropped: s.dropped + 1, retainedTurns: s.turns.length - 1 };
  }
  s = { ...s, retainedTurns: s.turns.length };
  return s;
}

/** 写盘：`pruneToBytes` → 一次 `JSON.stringify` → 一次 `set`；返回真正写下去的那份（可能已裁剪） */
export function saveSession(session: AdvisorSession, store: MemoryStore = defaultStore(), maxBytes = SESSION_MAX_BYTES): AdvisorSession {
  const s = pruneToBytes({ ...session, retainedTurns: session.turns.length }, maxBytes);
  try {
    store.set(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* 序列化失败（不该发生）：忽略，不影响对话 */
  }
  return s;
}

export function clearSession(store: MemoryStore = defaultStore()): void {
  store.remove(SESSION_KEY);
}

/**
 * 追加一轮（**幂等**：同 id 再来一次直接返回原会话）+ 轮数上限淘汰。
 * 返回新对象（不改入参），`retainedTurns` 始终等于 `turns.length`。
 */
export function appendTurn(session: AdvisorSession, turn: StoredTurn, maxTurns = MAX_TURNS): AdvisorSession {
  if (session.turns.some((t) => t.id === turn.id)) return session;
  const all = [...session.turns, turn];
  const limit = Math.max(1, maxTurns);
  const turns = all.length > limit ? all.slice(all.length - limit) : all;
  return {
    ...session,
    turns,
    dropped: session.dropped + (all.length - turns.length),
    retainedTurns: turns.length,
    updatedAt: turn.at,
  };
}

/** 给某一轮打补丁（例：偏好整理完回填 `note`）——幂等，未命中 id 时原样返回 */
export function updateTurn(session: AdvisorSession, id: string, patch: Partial<StoredTurn>): AdvisorSession {
  if (!session.turns.some((t) => t.id === id)) return session;
  return { ...session, turns: session.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

/** 把一轮 `AdvisorTurn` 落成可存的形状（丢掉 `data`；`partial` / `answer` 覆盖用于中断兜底） */
export function toStoredTurn(
  turn: AdvisorTurn,
  userText: string,
  opts: { id?: string; at?: number; answer?: string; partial?: boolean; mode?: string } = {}
): StoredTurn {
  const at = opts.at ?? Date.now();
  return {
    id: opts.id ?? newTurnId(at),
    at,
    userText,
    answer: opts.answer ?? turn.answer,
    evidence: (turn.toolCalls ?? []).map((c) => ({
      evidenceId: c.evidenceId,
      name: c.name,
      args: c.args,
      summary: c.summary,
      ...(c.brief ? { brief: c.brief } : {}),
      stats: c.stats,
    })),
    plans: turn.plans ?? [],
    checks: turn.checks ?? [],
    verdict: turn.verdict,
    ...(turn.degraded ? { degraded: true } : {}),
    ...(opts.partial ? { partial: true } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
  };
}

// ─────────────────────────── 回灌给模型的历史（紧凑转录） ───────────────────────────

const argsBrief = (args: unknown): string => {
  if (args === undefined || args === null) return '';
  let s: string;
  try {
    s = typeof args === 'string' ? args : JSON.stringify(args);
  } catch {
    return '';
  }
  return clip(s.replace(/\s+/g, ' '), 160);
};

const evidenceLine = (e: StoredEvidence): string => {
  const cost = e.stats?.battles ? `${e.stats.battles} 场` : e.stats?.cached ? '用上次结果' : '查表';
  const a = argsBrief(e.args);
  return `- ${evidenceZh(e.evidenceId)}${e.name ? `(${e.name}${a ? ` ${a}` : ''})` : ''} → ${clip(e.summary ?? '', 220)}｜${cost}`;
};

/**
 * 回灌历史：**紧凑转录**（用户原话 + 顾问结论 + 上一轮证据一行行），不是把整条协议 trace 原样重放。
 * 理由与 harness 一致：它 retain / 注入的也是「user / assistant / action 行」而不是工具原文——
 * 既省 token，也不会让模型把旧轮的 tool 消息当成"现在还能引用"的证据（关 2 只认本轮 trace）。
 * 尾部再兜一道字数上限（从最新往回装，至少留 1 轮）。
 */
export function historyFrom(
  session: AdvisorSession,
  opts: { maxTurns?: number; maxChars?: number } = {}
): AdvisorMessage[] {
  const maxTurns = Math.max(1, opts.maxTurns ?? REPLAY_TURNS);
  const maxChars = Math.max(200, opts.maxChars ?? REPLAY_MAX_CHARS);
  const picked: AdvisorMessage[][] = [];
  let chars = 0;
  for (const t of [...session.turns].reverse()) {
    if (picked.length >= maxTurns) break;
    const block: AdvisorMessage[] = [];
    const ask = stripInjected(t.userText).trim();
    if (ask) block.push({ role: 'user', content: ask });
    const said = t.answer?.trim() ? stripInjected(t.answer).trim() : '';
    block.push({
      role: 'assistant',
      content: said || (t.partial ? '（这一轮中断了，没有结论）' : '（只跑了工具，没有正文）'),
    });
    const lines = (t.evidence ?? []).map(evidenceLine).filter(Boolean);
    if (lines.length) {
      block.push({
        role: 'user',
        content:
          `<${EVIDENCE_TAG}>\n（以下是上一轮的工具证据记录，来自工具返回、供你引用；不是用户的新发言，也不要当成刚跑出来的数字。）\n` +
          `${lines.join('\n')}\n</${EVIDENCE_TAG}>`,
      });
    }
    const size = block.reduce((n, m) => n + m.content.length, 0);
    if (picked.length && chars + size > maxChars) break;
    picked.push(block);
    chars += size;
  }
  return picked.reverse().flat();
}

/** 剥掉本层注入的标签块（= harness 的 `stripInjectedMemory`，防"注入内容再写回记忆"）；留下的空行收敛成一段 */
export function stripInjected(text: string): string {
  return text
    .replace(new RegExp(`<(${PROFILE_TAG}|${EVIDENCE_TAG}|${BOX_TAG})\\b[\\s\\S]*?<\\/\\1>`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ───────────────────────────「你的偏好」档案 ───────────────────────────

export interface PrefItem {
  /** 短标签，如「口径」「常用」「忌讳」 */
  key: string;
  value: string;
  /** 最后一次被确认的时间 */
  at: number;
  /** 被重复确认过几次（>1 = 反复出现，注入时带上，算一种置信度） */
  seen: number;
}

export interface PrefProfile {
  v: 1;
  items: PrefItem[];
  updatedAt: number;
}

export function emptyProfile(now = Date.now()): PrefProfile {
  return { v: 1, items: [], updatedAt: now };
}

export function parseProfile(raw: string | null): PrefProfile {
  if (!raw) return emptyProfile();
  try {
    const p = JSON.parse(raw) as Partial<PrefProfile>;
    if (!p || !Array.isArray(p.items)) return emptyProfile();
    const items = p.items
      .filter((it): it is PrefItem => Boolean(it) && typeof it?.key === 'string' && typeof it?.value === 'string')
      .map((it) => ({ key: it.key, value: it.value, at: Number(it.at) || 0, seen: Math.max(1, Number(it.seen) || 1) }))
      .slice(0, PROFILE_MAX_ITEMS);
    return { v: 1, items, updatedAt: Number(p.updatedAt) || Date.now() };
  } catch {
    return emptyProfile();
  }
}

export function loadProfile(store: MemoryStore = defaultStore()): PrefProfile {
  return parseProfile(store.get(PROFILE_KEY));
}

export function saveProfile(profile: PrefProfile, store: MemoryStore = defaultStore()): void {
  try {
    store.set(PROFILE_KEY, JSON.stringify({ ...profile, v: 1, items: profile.items.slice(0, PROFILE_MAX_ITEMS) }));
  } catch {
    /* 同 saveSession */
  }
}

export function clearProfile(store: MemoryStore = defaultStore()): void {
  store.remove(PROFILE_KEY);
}

/** 标签 / 取值整形：去空白、去掉包裹的引号与冒号、去掉句末标点；标签空则落「偏好」，取值空则丢弃（返回 null） */
export function normalizePref(key: string, value: string): { key: string; value: string } | null {
  const k = String(key ?? '')
    .replace(/^[\s：:「」"'【】]+|[\s：:「」"'【】]+$/g, '')
    .slice(0, PROFILE_KEY_MAX);
  const v = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s：:「」"'【】]+/, '')
    .replace(/[\s.。．!！?？;；:：]+$/, '')
    .slice(0, PROFILE_VALUE_MAX);
  if (!v) return null;
  return { key: k || '偏好', value: v };
}

/**
 * 合并（纯函数）：**同「标签 + 取值」= 重复 → seen+1**；新取值就新增一条（同标签多值允许，例如多个"常用"）。
 * 超过 `maxItems` 时按「最久没被确认」淘汰。`added` / `bumped` / `dropped` 给界面报数用。
 */
export function mergePreferences(
  profile: PrefProfile,
  add: Array<{ key?: string; value?: string }>,
  now = Date.now(),
  opts: { maxItems?: number } = {}
): { profile: PrefProfile; added: number; bumped: number; dropped: number } {
  const maxItems = Math.max(1, opts.maxItems ?? PROFILE_MAX_ITEMS);
  const items = profile.items.map((it) => ({ ...it }));
  let added = 0;
  let bumped = 0;
  for (const raw of add ?? []) {
    const norm = normalizePref(String(raw?.key ?? ''), String(raw?.value ?? ''));
    if (!norm) continue;
    const hit = items.find((it) => it.key === norm.key && it.value === norm.value);
    if (hit) {
      hit.seen += 1;
      hit.at = now;
      bumped += 1;
    } else {
      items.push({ key: norm.key, value: norm.value, at: now, seen: 1 });
      added += 1;
    }
  }
  let dropped = 0;
  while (items.length > maxItems) {
    let oldest = 0;
    for (let i = 1; i < items.length; i += 1) if (items[i].at < items[oldest].at) oldest = i;
    items.splice(oldest, 1);
    dropped += 1;
  }
  return { profile: { v: 1, items, updatedAt: now }, added, bumped, dropped };
}

/**
 * 删除：`needle` 命中「标签」/「取值」/「标签=取值」任一即删（界面上的 × 与抽取器给的 remove 共用）。
 * 返回删掉几条（0 = 没命中，界面照旧不报错）。
 */
export function removePreference(profile: PrefProfile, needle: string, now = Date.now()): { profile: PrefProfile; removed: number } {
  const t = String(needle ?? '').trim();
  if (!t) return { profile, removed: 0 };
  const [k, v] = t.includes('=') ? t.split('=').map((x) => x.trim()) : ['', ''];
  const items = profile.items.filter((it) => {
    if (v) return !(it.key === k && it.value === v);
    return !(it.value === t || it.key === t || it.value.includes(t));
  });
  return { profile: { v: 1, items, updatedAt: now }, removed: profile.items.length - items.length };
}

/**
 * 注入块（`<advisor_prefs>` 包裹，与 harness 的 `<hindsight_memory>` 同款）：
 * 空档案返回 `''`（**不注入空块**）；条目 / 总字数双上限，超出丢最旧。
 */
export function renderProfileBlock(
  profile: PrefProfile,
  opts: { maxItems?: number; maxChars?: number; now?: number } = {}
): string {
  const items = [...profile.items].sort((a, b) => b.at - a.at).slice(0, Math.max(1, opts.maxItems ?? PROFILE_MAX_ITEMS));
  if (!items.length) return '';
  const maxChars = Math.max(80, opts.maxChars ?? PROFILE_BLOCK_MAX_CHARS);
  const head = '（这是本机为这位用户维护的长期偏好档案：自动整理，可能不全或过时；默认按它来，与本轮明确要求冲突时以本轮为准。）';
  const kept: string[] = [];
  let len = head.length;
  for (const it of items) {
    const line = `- ${it.key}：${it.value}${it.seen > 1 ? `（已确认 ${it.seen} 次）` : ''}`;
    if (len + line.length + 1 > maxChars) break;
    kept.push(line);
    len += line.length + 1;
  }
  if (!kept.length) return '';
  const foot = `（共 ${profile.items.length} 条 · 更新 ${nowIso(opts.now ?? profile.updatedAt)}）`;
  return `<${PROFILE_TAG}>\n${head}\n${kept.join('\n')}\n${foot}\n</${PROFILE_TAG}>`;
}
