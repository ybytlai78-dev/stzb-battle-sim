import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVectorStore, normalize, rrfFuse, vectorSearch, type VectorStore } from '../scripts/rag/vector.mts';
import { buildIndex, search, type IndexedDoc, type Hit } from '../scripts/rag/search.mts';

/** 构造一个可信的最小向量库：三篇文档、二维向量 */
function tinyStore(): VectorStore {
  return {
    docIds: ['a', 'b', 'c'],
    // a=(1,0) b=(0.7,0.7) c=(0,1)
    data: new Float32Array([1, 0, 0.7, 0.7, 0, 1]),
    dim: 2,
    count: 3,
    model: 'test',
  };
}

function tinyDocs(): Map<string, IndexedDoc> {
  const mk = (docId: string, kind: string) =>
    ({ docId, kind, tier: 'package', source: 'x', body: `# ${docId}`, facets: {}, text: '' }) as unknown as IndexedDoc;
  return new Map([
    ['a', mk('a', 'skill')],
    ['b', mk('b', 'hero')],
    ['c', mk('c', 'skill')],
  ]);
}

const hit = (docId: string, kind = 'skill'): Hit => ({ docId, kind, tier: 'package', source: 'x', score: 0, body: '', facets: {} });

describe('向量通道', () => {
  it('normalize 归一化到单位长度，零向量不产生 NaN', () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    const zero = normalize([0, 0]);
    expect(zero[0]).toBe(0);
    expect(Number.isNaN(zero[1])).toBe(false);
  });

  it('vectorSearch 按余弦排序，且能按 kind 过滤', () => {
    const docs = tinyDocs();
    expect(vectorSearch(tinyStore(), [1, 0], docs, { k: 3 }).map((h) => h.docId)).toEqual(['a', 'b', 'c']);
    expect(vectorSearch(tinyStore(), [0, 1], docs, { k: 3 }).map((h) => h.docId)).toEqual(['c', 'b', 'a']);
    expect(vectorSearch(tinyStore(), [1, 0], docs, { k: 3, kinds: ['skill'] }).map((h) => h.docId)).toEqual(['a', 'c']);
  });

  it('vectorSearch 跳过向量库里没有对应文档的行，不返回空壳', () => {
    const store = tinyStore();
    store.docIds = ['a', 'ghost', 'c'];
    const hits = vectorSearch(store, [1, 0], tinyDocs(), { k: 3 });
    expect(hits.map((h) => h.docId)).toEqual(['a', 'c']);
  });

  it('rrfFuse 只看名次：两路都上榜的排在只上一路的前面', () => {
    const fused = rrfFuse([[hit('x'), hit('y')], [hit('y'), hit('z')]], { k: 3 });
    expect(fused.map((h) => h.docId)).toEqual(['y', 'x', 'z']);
    // y 两路各第 2 名 = 2/(60+2)，x 单路第 1 名 = 1/61 —— 融合后 y 必须更高
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it('rrfFuse 同一个 docId 只出现一次，分数累加', () => {
    const fused = rrfFuse([[hit('x')], [hit('x')]], { k: 5 });
    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(2 / 61, 6);
  });

  it('loadVectorStore 从 f32 + meta 还原，尺寸对得上', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-vec-'));
    try {
      const f32 = new Float32Array([1, 0, 0, 1]);
      writeFileSync(join(dir, 'v.f32'), Buffer.from(f32.buffer));
      writeFileSync(
        join(dir, 'v.meta.json'),
        JSON.stringify({ docIds: ['a', 'b'], dim: 2, count: 2, model: 'test', total: 2 })
      );
      const store = loadVectorStore(join(dir, 'v.f32'), join(dir, 'v.meta.json'));
      expect(store.dim).toBe(2);
      expect(store.count).toBe(2);
      expect(store.docIds).toEqual(['a', 'b']);
      expect(Array.from(store.data)).toEqual([1, 0, 0, 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('检索入口的降级', () => {
  const saved = process.env.EMBED_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.EMBED_KEY;
    else process.env.EMBED_KEY = saved;
  });

  it('没有 EMBED_KEY 时 hybrid 自动降级 BM25 并给出原因', async () => {
    delete process.env.EMBED_KEY;
    const index = buildIndex([
      { docId: 'skill:1', kind: 'skill', tier: 'package', source: 's', facets: {}, body: '# 金匮要略（战法 id 1）\n减伤 20.4%' },
      { docId: 'skill:2', kind: 'skill', tier: 'package', source: 's', facets: {}, body: '# 别的战法（战法 id 2）\n无关' },
    ] as never);
    const out = await search(index, '金匮要略', { mode: 'hybrid', k: 2 });
    expect(out.mode).toBe('bm25');
    expect(out.degraded).toContain('EMBED_KEY');
    expect(out.hits[0].docId).toBe('skill:1');
  });

  it('bm25 模式不读密钥、不发网络请求', async () => {
    process.env.EMBED_KEY = 'should-not-be-used';
    const index = buildIndex([
      { docId: 'skill:1', kind: 'skill', tier: 'package', source: 's', facets: {}, body: '# 金匮要略（战法 id 1）' },
    ] as never);
    const out = await search(index, '金匮要略', { mode: 'bm25', k: 1 });
    expect(out.mode).toBe('bm25');
    expect(out.degraded).toBeUndefined();
  });
});
