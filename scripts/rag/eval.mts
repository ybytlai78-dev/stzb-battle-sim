#!/usr/bin/env tsx
/**
 * 检索评测：26 条人工用例，按「query 里是否写了目标名」分层。
 *
 * 分层比总分重要 —— 字面型（写了战法名）考验关键词索引，语义型（只描述机制）才考验召回是否理解内容。
 * 判据：top-N 里任一文档**标题含期望名称**即算命中 —— 包内同名多版本极多
 * （皇裔流离 4 版、奇兵拒北 5 版），按 name 判而非按 docId 判，避免假失败。
 *
 * 没有 EMBED_KEY 时只跑 BM25；有 key 时三路一起报，便于看向量通道到底补上了多少。
 *
 * 用法：EMBED_KEY=sk-xxx npx tsx scripts/rag/eval.mts [--k 30] [--fails]
 */
import { existsSync, readFileSync } from 'node:fs';
import { bm25Search, buildIndex, loadDocs } from './search.mjs';
import { loadVectorStore, rrfFuse, vectorSearch } from './vector.mjs';
import { embedDocs, readConfig } from './embed.mjs';

interface Case {
  query: string;
  expect: string;
  kind?: string;
}

const titleOf = (body: string): string => (body.match(/^# (.+?)（/) ?? [, ''])[1];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const docsPath = flag('--docs', '.rag/docs.jsonl');
  const casesPath = flag('--cases', 'rag/eval/queries.jsonl');
  const topK = Number(flag('--k', '30'));

  const docs = loadDocs(docsPath);
  const cases = readFileSync(casesPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);
  const index = buildIndex(docs);
  const docById = new Map(index.docs.map((d) => [d.docId, d]));

  // 一次嵌入全部 query，三种模式共用
  const cfg = readConfig();
  let qVecs: Map<string, Float32Array> | null = null;
  if (cfg.key && existsSync('.rag/vectors.f32') && existsSync('.rag/vectors.meta.json')) {
    const res = await embedDocs(
      cases.map((c) => ({ docId: c.query, body: c.query })),
      cfg,
      { batch: 8 }
    );
    if (res.failed.length) console.log(`⚠️ query 嵌入失败 ${res.failed.length} 条，向量通道将不完整`);
    qVecs = new Map(res.index.map((idx, n) => [cases[idx].query, res.vectors[n]]));
  }
  const store = qVecs ? loadVectorStore('.rag/vectors.f32', '.rag/vectors.meta.json') : null;

  const rankOf = (hits: Array<{ docId: string; body: string }>, expect: string): number => {
    for (let i = 0; i < hits.length; i++) if (titleOf(hits[i].body).includes(expect)) return i;
    return -1;
  };

  type Group = { n: number; hit1: number };
  const modes: Array<{ name: string; run: (c: Case) => Array<{ docId: string; body: string }> }> = [
    { name: 'BM25', run: (c) => bm25Search(index, c.query, { k: topK }) },
  ];
  if (store && qVecs) {
    modes.push({
      name: '向量',
      run: (c) => {
        const q = qVecs!.get(c.query);
        return q ? vectorSearch(store, q, docById, { k: topK }) : [];
      },
    });
    modes.push({
      name: '混合',
      run: (c) =>
        rrfFuse(
          [
            bm25Search(index, c.query, { k: topK }),
            vectorSearch(store, qVecs!.get(c.query) ?? new Float32Array(store.dim), docById, { k: topK }),
          ],
          { k: topK }
        ),
    });
  }

  console.log(
    `用例 ${cases.length} 条 | 索引 ${docs.length} 篇${store ? ` | 向量 ${store.count}×${store.dim}（${store.model}）` : ' | 未加载向量（无 EMBED_KEY 或无 .rag/vectors.f32）'}\n`
  );

  for (const mode of modes) {
    let hit1 = 0;
    let hitK = 0;
    const group: { literal: Group; semantic: Group } = { literal: { n: 0, hit1: 0 }, semantic: { n: 0, hit1: 0 } };
    const fails: string[] = [];
    for (const c of cases) {
      const g = c.query.includes(c.expect) ? group.literal : group.semantic;
      g.n++;
      const hits = mode.run(c);
      const rank = rankOf(hits, c.expect);
      if (rank === 0) {
        hit1++;
        g.hit1++;
      }
      if (rank >= 0) hitK++;
      else fails.push(`${c.query} → 期望「${c.expect}」，实得 ${hits.slice(0, 3).map((h) => titleOf(h.body) || h.docId).join(' | ')}`);
    }
    const pct = (a: number, b: number): string => (b ? `${((a / b) * 100).toFixed(0)}%` : '-');
    console.log(
      `${mode.name.padEnd(4)} top-1 ${hit1}/${cases.length} ${pct(hit1, cases.length)} | top-${topK} ${hitK}/${cases.length} | ` +
        `字面型 ${group.literal.hit1}/${group.literal.n} ${pct(group.literal.hit1, group.literal.n)} | ` +
        `语义型 ${group.semantic.hit1}/${group.semantic.n} ${pct(group.semantic.hit1, group.semantic.n)}`
    );
    if (argv.includes('--fails')) for (const f of fails) console.log('   ✗ ' + f);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rag/eval.mts')) void main();
