/**
 * 向量通道：本地二进制向量 + 暴力内积 + RRF 融合。
 *
 * 不引入向量数据库的理由（设计 §三）：8,855 × 1024 维 = 约 9.1e6 次乘加，
 * 单线程 JS 一遍 20~40ms，比任何外部服务的往返都便宜。容量再涨一个数量级前无需 ANN。
 */
import { readFileSync } from 'node:fs';
import type { Hit, IndexedDoc } from './search.mjs';

export interface VectorStore {
  docIds: string[];
  data: Float32Array;
  dim: number;
  count: number;
  model: string;
}

export function loadVectorStore(f32Path: string, metaPath: string): VectorStore {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    docIds: string[];
    dim: number;
    count: number;
    model: string;
  };
  const buf = readFileSync(f32Path);
  // 复制到独立 buffer：Buffer 池的 byteOffset 不保证 4 字节对齐，直接 view 会读到错位数据
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return {
    docIds: meta.docIds,
    data: new Float32Array(copy),
    dim: Number(meta.dim),
    count: Number(meta.count),
    model: String(meta.model),
  };
}

/** L2 归一化，返回新数组（余弦退化为点积，省掉每次范数计算） */
export function normalize(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  const inv = n > 0 ? 1 / Math.sqrt(n) : 0;
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

export interface VectorSearchOptions {
  k?: number;
  kinds?: string[];
}

/** 暴力余弦检索；`docById` 用来把向量行号还原成文档（body/kind 都在索引里） */
export function vectorSearch(
  store: VectorStore,
  query: ArrayLike<number>,
  docById: Map<string, IndexedDoc>,
  opts: VectorSearchOptions = {}
): Hit[] {
  const k = opts.k ?? 5;
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : undefined;
  const q = normalize(query);
  const { data, dim, docIds } = store;
  const n = Math.min(store.count, docIds.length);
  const scored: Array<{ i: number; s: number }> = [];

  for (let row = 0; row < n; row++) {
    const base = row * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += data[base + d] * q[d];
    scored.push({ i: row, s: dot });
  }
  scored.sort((a, b) => b.s - a.s);

  const hits: Hit[] = [];
  for (const { i, s } of scored) {
    const doc = docById.get(docIds[i]);
    if (!doc) continue;
    if (kinds && !kinds.has(doc.kind)) continue;
    hits.push({ docId: doc.docId, kind: doc.kind, tier: doc.tier, source: doc.source, score: s, body: doc.body, facets: doc.facets });
    if (hits.length >= k) break;
  }
  return hits;
}

/**
 * Reciprocal Rank Fusion：不依赖两路分数可比性，只看名次。
 * `k0` 取 60 是 Cormack 等人的经验值（单路第一名贡献 1/61，第 10 名 1/70）。
 */
export function rrfFuse(lists: Hit[][], opts: { k?: number; k0?: number } = {}): Hit[] {
  const k = opts.k ?? 5;
  const k0 = opts.k0 ?? 60;
  const agg = new Map<string, { hit: Hit; score: number }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const cur = agg.get(hit.docId);
      const gain = 1 / (k0 + rank + 1);
      if (cur) cur.score += gain;
      else agg.set(hit.docId, { hit, score: gain });
    });
  }
  return [...agg.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ hit, score }) => ({ ...hit, score }));
}
