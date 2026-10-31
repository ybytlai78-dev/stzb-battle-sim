#!/usr/bin/env tsx
/**
 * 检索评测：对 `rag/eval/queries.jsonl` 逐条跑，报 top-1 / top-K 命中率。
 *
 * 判据：top-N 里任一文档**标题含期望名称**即算命中 —— 包内同名多版本极多
 * （皇裔流离 4 版、奇兵拒北 5 版），按 name 判而非按具体 docId 判，避免假失败。
 *
 * 用法：`npx tsx scripts/rag/eval.mts [--docs .rag/docs.jsonl] [--k 3] [--cases rag/eval/queries.jsonl]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bm25Search, buildIndex, loadDocs } from './search.mjs';

interface Case {
  query: string;
  expect: string;
  kind?: string;
}

const titleOf = (body: string): string => body.split('\n')[0] ?? '';

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const docsPath = resolve(flag('--docs', '.rag/docs.jsonl'));
  const topK = Number(flag('--k', '3'));
  const cases = readFileSync(resolve(flag('--cases', 'rag/eval/queries.jsonl')), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);

  const index = buildIndex(loadDocs(docsPath));
  let hit1 = 0;
  let hitK = 0;
  // 分组：query 里直接写了目标名 = 字面型；没写 = 语义型（这才考验召回是否理解机制描述）
  const group = { literal: { n: 0, hit1: 0 }, semantic: { n: 0, hit1: 0 } };
  const fails: string[] = [];

  for (const c of cases) {
    const g = c.query.includes(c.expect) ? group.literal : group.semantic;
    g.n++;
    const hits = bm25Search(index, c.query, { k: topK, kinds: c.kind ? [c.kind] : undefined });
    const rank = hits.findIndex((h) => titleOf(h.body).includes(c.expect));
    if (rank === 0) {
      hit1++;
      g.hit1++;
    }
    if (rank >= 0) hitK++;
    else fails.push(`✗ ${c.query}  → 期望「${c.expect}」，实得 ${hits.map((h) => titleOf(h.body).slice(0, 22)).join(' | ')}`);
    if (rank > 0) fails.push(`△ ${c.query}  → 「${c.expect}」排第 ${rank + 1}`);
  }

  const n = cases.length;
  const pct = (v: number): string => `${((v / n) * 100).toFixed(0)}%`;
  console.log(`用例 ${n} 条 | top-1 ${hit1}/${n} ${pct(hit1)} | top-${topK} ${hitK}/${n} ${pct(hitK)} | 索引 ${index.docs.length} 篇`);
  for (const f of fails) console.log('  ' + f);
  const seg = (label: string, v: { n: number; hit1: number }): string =>
    `${label} ${v.hit1}/${v.n} ${v.n ? ((v.hit1 / v.n) * 100).toFixed(0) + '%' : '-'}`;
  console.log(`  分层：${seg('字面型', group.literal)}｜${seg('语义型', group.semantic)}`);
  if (hit1 / n < 0.7) process.exitCode = 1;
}

main();
