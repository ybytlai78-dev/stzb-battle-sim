#!/usr/bin/env tsx
/**
 * 率土包内 RAG 检索：BM25 基线（零依赖、离线可验证）+ 可选向量通道。
 *
 * 为什么先做 BM25：现有 advisor 的关键词检索只覆盖已入库 170 将（`web/advisor/tools.ts`），
 * 而包内是 2,077 将 / 6,572 战法全集 —— 先把「能搜到全量」这件事做对、量化出基线，
 * 再让向量通道在中文字面召回之外补语义（配置了 RAG_EMBED_* 才启用，见 embed.mts）。
 *
 * 用法：
 *   npx tsx scripts/rag/search.mts "金匮要略 减伤" --k 5
 *   npx tsx scripts/rag/search.mts "受击触发动摇" --kind skill
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RagDoc } from './render.mjs';
import { embedDocs, readConfig } from './embed.mjs';
import { loadVectorStore, rrfFuse, vectorSearch } from './vector.mjs';

/** 中文按 2-gram、英文数字按词切；剔除标点与空白 */
export function tokenize(text: string): string[] {
  const s = text.toLowerCase().replace(/[\s]+/g, ' ');
  const tokens: string[] = [];
  const runs = s.match(/[\u4e00-\u9fa5]+|[a-z0-9_.]+/g) ?? [];
  for (const run of runs) {
    if (/^[\u4e00-\u9fa5]+$/.test(run)) {
      if (run.length === 1) tokens.push(run);
      for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2));
    } else {
      tokens.push(run);
    }
  }
  return tokens;
}

export interface IndexedDoc {
  docId: string;
  kind: string;
  tier: string;
  source: string;
  /** 参与打分的文本：正文 + 标题行 + 分类词，让「战法/武将」这类词也能命中 */
  text: string;
  /** 命中后展示的正文 */
  body: string;
  facets: Record<string, unknown>;
}

export interface SearchIndex {
  docs: IndexedDoc[];
  postings: Map<string, Map<number, number>>;
  docLen: number[];
  avgLen: number;
}

const K1 = 1.2;
const B = 0.75;

/** facets 里的枚举值转成可检索词（势力 / 星级 / 兵种 / 战法类型） */
function facetWords(doc: RagDoc): string {
  const f = doc.facets;
  const words: string[] = [doc.kind];
  if (doc.kind === 'hero') {
    words.push('武将');
    if (typeof f.star === 'number') words.push(`${f.star}星`);
  }
  if (doc.kind === 'skill') words.push('战法');
  if (doc.kind === 'mechanism') words.push('机制');
  if (doc.kind === 'caliber') words.push('调研', '推定');
  return words.join(' ');
}

export function buildIndex(docs: RagDoc[]): SearchIndex {
  const indexed: IndexedDoc[] = [];
  const postings = new Map<string, Map<number, number>>();
  const docLen: number[] = [];

  docs.forEach((doc, idx) => {
    const title = doc.body.split('\n')[0] ?? '';
    const text = `${title} ${facetWords(doc)} ${doc.body}`;
    indexed.push({
      docId: doc.docId,
      kind: doc.kind,
      tier: doc.tier,
      source: doc.source,
      text,
      body: doc.body,
      facets: doc.facets,
    });
    const toks = tokenize(text);
    docLen.push(toks.length);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      const list = postings.get(t);
      if (list) list.set(idx, n);
      else postings.set(t, new Map([[idx, n]]));
    }
  });

  const total = docLen.reduce((a, b) => a + b, 0);
  return { docs: indexed, postings, docLen, avgLen: indexed.length ? total / indexed.length : 0 };
}

export interface Hit {
  docId: string;
  kind: string;
  tier: string;
  source: string;
  score: number;
  body: string;
  facets: Record<string, unknown>;
}

export interface SearchOptions {
  k?: number;
  /** 只在这些 kind 里检索（hero / skill / mechanism / caliber） */
  kinds?: string[];
}

export function bm25Search(index: SearchIndex, query: string, opts: SearchOptions = {}): Hit[] {
  const k = opts.k ?? 5;
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : undefined;
  const qToks = tokenize(query);
  const scores = new Map<number, number>();
  const N = index.docs.length;

  for (const t of qToks) {
    const list = index.postings.get(t);
    if (!list) continue;
    const df = list.size;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [idx, tf] of list) {
      if (kinds && !kinds.has(index.docs[idx].kind)) continue;
      const dl = index.docLen[idx] || 1;
      const denom = tf + K1 * (1 - B + (B * dl) / (index.avgLen || 1));
      const gain = (idf * tf * (K1 + 1)) / (denom || 1);
      scores.set(idx, (scores.get(idx) ?? 0) + gain);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([idx, score]) => {
      const d = index.docs[idx];
      return { docId: d.docId, kind: d.kind, tier: d.tier, source: d.source, score, body: d.body, facets: d.facets };
    });
}

export function loadDocs(path: string): RagDoc[] {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map((l) => JSON.parse(l) as RagDoc);
}

export type SearchMode = 'bm25' | 'vector' | 'hybrid';

/** 三路检索的统一入口：无 EMBED_KEY 或缺向量文件时自动降级 BM25 */
export async function search(
  index: SearchIndex,
  query: string,
  opts: { mode?: SearchMode; k?: number; kinds?: string[] } = {}
): Promise<{ hits: Hit[]; mode: SearchMode; degraded?: string }> {
  const k = opts.k ?? 5;
  const mode = opts.mode ?? 'hybrid';
  const pool = mode === 'hybrid' ? Math.max(k * 4, 40) : k;
  const bm25 = (): Hit[] => bm25Search(index, query, { k: pool, kinds: opts.kinds });
  if (mode === 'bm25') return { hits: bm25(), mode };

  const cfg = readConfig();
  if (!cfg.key) return { hits: bm25(), mode: 'bm25', degraded: '无 EMBED_KEY' };
  if (!existsSync('.rag/vectors.f32') || !existsSync('.rag/vectors.meta.json')) {
    return { hits: bm25(), mode: 'bm25', degraded: '缺 .rag/vectors.*（先 npm run rag:build 再 embed）' };
  }
  const store = loadVectorStore('.rag/vectors.f32', '.rag/vectors.meta.json');
  const docById = new Map(index.docs.map((d) => [d.docId, d]));
  const res = await embedDocs([{ docId: query, body: query }], cfg, { batch: 1 });
  const qv = res.vectors[0];
  if (!qv) return { hits: bm25(), mode: 'bm25', degraded: `query 嵌入失败：${res.failed[0]?.error ?? '未知'}` };
  const vec = vectorSearch(store, qv, docById, { k: pool, kinds: opts.kinds });
  if (mode === 'vector') return { hits: vec, mode };
  return { hits: rrfFuse([bm25(), vec], { k }), mode };
}

/**
 * 把文档压成能塞进上下文的精要：数值行优先。
 * 顺序 = 标题行 → 槽位数值行 → 其余（官方描述 / 机制码 / 坐标）。
 * 截断时明确报告丢了多少行，避免"看起来完整其实被切了"。
 */
export function condense(body: string, budget = 600): string {
  const lines = body.split('\n').filter((l) => l.trim().length > 0);
  if (budget <= 0) return lines.join('\n');
  // 标题行 + 紧随其后的属性行（品级/类型/距离），这两行决定「这是谁」
  const head = lines.filter((l, i) => i < 2 && !l.startsWith('## '));
  const slots = lines.filter((l) => /^-\s*槽/.test(l));
  const rest = lines.filter((l) => !head.includes(l) && !slots.includes(l));
  const out: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const line of [...head, ...slots, ...rest]) {
    if (used + line.length + 1 <= budget) {
      out.push(line);
      used += line.length + 1;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) out.push(`…（省略 ${dropped} 行，--full 看全文）`);
  return out.join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string, dflt: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const skip = new Set();
  for (const name of ['--kind', '--docs', '--mode', '--k', '--budget']) {
    const i = argv.indexOf(name);
    if (i >= 0 && argv[i + 1]) skip.add(argv[i + 1]);
  }
  const query = argv
    .filter((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !skip.has(a))
    .join(' ')
    .trim();
  if (!query) {
    console.error(
      '用法：npx tsx scripts/rag/search.mts "查询词" [--k 5] [--kind skill] [--mode hybrid|bm25|vector] [--budget 600] [--full] [--docs .rag/docs.jsonl]'
    );
    process.exit(1);
  }
  const k = Number(flag('--k', '5'));
  const kind = flag('--kind', '');
  const mode = flag('--mode', 'hybrid') as SearchMode;
  const budget = argv.includes('--full') ? 0 : Number(flag('--budget', '600'));
  const index = buildIndex(loadDocs(resolve(flag('--docs', '.rag/docs.jsonl'))));
  const out = await search(index, query, { mode, k, kinds: kind ? [kind] : undefined });

  const label = out.mode === 'hybrid' ? 'BM25 + 向量（RRF 融合）' : out.mode === 'vector' ? '向量（bge-m3）' : 'BM25';
  console.log(
    `查询「${query}」→ ${out.hits.length} 条（索引 ${index.docs.length} 篇，${label}${out.degraded ? `，已降级：${out.degraded}` : ''}）`
  );
  for (const h of out.hits) {
    console.log('\n[' + h.score.toFixed(3) + '] ' + h.docId + '  (' + h.kind + '/' + h.tier + ')  ' + h.source);
    console.log(condense(h.body, budget));
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rag/search.mts')) void main();
