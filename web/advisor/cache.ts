/**
 * AI 配将顾问 · 跑批缓存（实施计划 Task 7 的核心）
 * ---------------------------------------------------------------------------
 * 为什么值得做：一次 L2 搜索 ≈ 8,000 场 / 60 秒。下列三种情况会白烧时间——
 *   ① 用户换个说法再问同一件事；② 模型重试同一个搜索；③ 关 3 复算与搜索口径对不上时想再确认一次。
 * 缓存键 = `(工具, 方案, 参数, 种子)`：**同输入必同输出**（引擎确定性），所以缓存是安全的。
 *
 * 命中时：**计费 0 场**（`cost.battlesOf` 会先查缓存）、`stats.cached = true`、evidenceId 重新分配
 * （证据编号是本轮的，不能复用旧编号——否则关 2 溯源会指到不存在的 trace）。
 */
import type { ToolResult } from './types';

export interface CacheHit {
  summary: string;
  brief?: string;
  data: unknown;
  /** 当初真跑了多少场 / 多久（提示用户这是复用的旧结果） */
  battles: number;
  ms: number;
  at: number;
}

export interface AdvisorCache {
  get(key: string): CacheHit | null;
  /** 只看有没有（**不计命中数**：预算预估要用它，避免与 `get` 重复计数） */
  has(key: string): boolean;
  set(key: string, hit: Omit<CacheHit, 'at'>): void;
  stats(): { hits: number; misses: number; entries: number };
  clear(): void;
}

/**
 * 稳定序列化：**对象键排序**后再 JSON（否则 `{a,b}` 与 `{b,a}` 会算出两个键，缓存形同虚设）。
 * 数组顺序保留（槽位顺序有语义）。
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** 缓存键：`kind` + 载荷（稳定序列化 + 短哈希，避免键太长） */
export function cacheKey(kind: string, payload: unknown): string {
  const s = stableStringify(payload);
  let h = 2166136261; // FNV-1a 32bit
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${kind}:${(h >>> 0).toString(36)}:${s.length}`;
}

/** 内存缓存（测试 / 单轮内） */
export function createMemoryCache(): AdvisorCache {
  const map = new Map<string, CacheHit>();
  let hits = 0;
  let misses = 0;
  return {
    get(key) {
      const hit = map.get(key) ?? null;
      if (hit) hits += 1;
      else misses += 1;
      return hit;
    },
    has: (key) => map.has(key),
    set(key, hit) {
      map.set(key, { ...hit, at: Date.now() });
    },
    stats: () => ({ hits, misses, entries: map.size }),
    clear: () => map.clear(),
  };
}

export interface LocalCacheOpts {
  storageKey?: string;
  /** 最多留几条（超出按最久未写入淘汰） */
  limit?: number;
}

/** 本地持久缓存（页面用）：刷新后仍命中；存不进 localStorage 时自动降级为内存缓存 */
export function createLocalCache(opts: LocalCacheOpts = {}): AdvisorCache {
  const storageKey = opts.storageKey ?? 'dsh-advisor-cache-v1';
  const limit = Math.max(4, opts.limit ?? 40);
  let hits = 0;
  let misses = 0;
  let mem: Record<string, CacheHit> = {};
  try {
    mem = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, CacheHit>;
  } catch {
    mem = {};
  }
  const persist = (): void => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(mem));
    } catch {
      /* 配额满 / 隐私模式：本次会话内仍可用 */
    }
  };
  return {
    get(key) {
      const hit = mem[key] ?? null;
      if (hit) hits += 1;
      else misses += 1;
      return hit;
    },
    has: (key) => Boolean(mem[key]),
    set(key, hit) {
      mem[key] = { ...hit, at: Date.now() };
      const keys = Object.keys(mem);
      if (keys.length > limit) {
        keys
          .sort((a, b) => mem[a].at - mem[b].at)
          .slice(0, keys.length - limit)
          .forEach((k) => delete mem[k]);
      }
      persist();
    },
    stats: () => ({ hits, misses, entries: Object.keys(mem).length }),
    clear: () => {
      mem = {};
      persist();
    },
  };
}

/** 命中时把缓存内容变成这一轮的工具结果（**新 evidenceId** + `cached` 标记 + 0 场计费） */
export function hitToResult(hit: CacheHit, evidenceId: string, seed: number): ToolResult {
  const ago = Math.max(0, Math.round((Date.now() - hit.at) / 1000));
  return {
    evidenceId,
    summary: `${hit.summary}（缓存命中：复用 ${ago} 秒前真跑的 ${hit.battles} 场结果，本轮没再跑）`,
    ...(hit.brief ? { brief: hit.brief } : {}),
    data: hit.data,
    stats: { battles: 0, ms: 0, seed, cached: true },
  };
}
