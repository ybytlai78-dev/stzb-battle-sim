import { describe, expect, it } from 'vitest';
import { bm25Search, buildIndex, tokenize, type IndexedDoc } from '../scripts/rag/search.mts';
import type { RagDoc } from '../scripts/rag/render.mts';

const doc = (docId: string, kind: 'hero' | 'skill' | 'mechanism', body: string): RagDoc => ({
  docId,
  kind,
  tier: 'package',
  source: `test/${docId}`,
  facets: { kind },
  body,
});

const docs: RagDoc[] = [
  doc('skill:200773', 'skill', '# 金匮要略（战法 id 200773）\n使我军全体受到的所有伤害降低 20.4%（受谋略属性影响）'),
  doc('skill:200228', 'skill', '# 战必断金（战法 id 200228）\n前3回合使敌军单体无法普通攻击'),
  doc('hero:100804', 'hero', '# 曹操（官方 id 100804）\n势力 汉｜5 星｜兵种 骑｜攻击距离 3\n| 攻击 | 76 | 1.48 |'),
  doc('mechanism:522', 'mechanism', '# 机制 522：受到攻击伤害降低\nreplace_type = 2（冲突分类）'),
];

describe('tokenize', () => {
  it('中文按 2-gram 切分', () => {
    expect(tokenize('金匮要略')).toEqual(['金匮', '匮要', '要略']);
  });

  it('英文与数字保持整词', () => {
    expect(tokenize('skill 200773')).toEqual(['skill', '200773']);
  });

  it('单字中文保留，标点被丢弃', () => {
    expect(tokenize('骑，')).toEqual(['骑']);
  });
});

describe('bm25Search', () => {
  const index = buildIndex(docs);

  it('按名称命中对应文档', () => {
    const hits = bm25Search(index, '金匮要略', { k: 1 });
    expect(hits[0].docId).toBe('skill:200773');
  });

  it('按机制描述也能命中（不是纯名称匹配）', () => {
    const hits = bm25Search(index, '无法普通攻击', { k: 1 });
    expect(hits[0].docId).toBe('skill:200228');
  });

  it('kind 过滤只在该类里检索', () => {
    const hits = bm25Search(index, '伤害降低', { k: 3, kinds: ['hero'] });
    expect(hits.every((h) => h.kind === 'hero')).toBe(true);
  });

  it('无命中返回空数组，不抛错', () => {
    expect(bm25Search(index, '完全不存在的词')).toEqual([]);
  });

  it('空查询返回空数组', () => {
    expect(bm25Search(index, '')).toEqual([]);
  });

  it('返回条数受 k 限制且按分数降序', () => {
    const hits = bm25Search(index, '伤害降低 攻击 五行', { k: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });

  it('索引记录文档长度均值，供 BM25 归一化', () => {
    expect(index.avgLen).toBeGreaterThan(0);
    expect(index.docLen.length).toBe(docs.length);
    expect(index.docs[0]).toHaveProperty('text');
    expect(index.docs[0]).toHaveProperty('body');
  });

  it('武将文档带「武将」分类词，可被类型词召回', () => {
    const hits = bm25Search(index, '武将 曹操', { k: 1 });
    expect(hits[0].kind).toBe('hero');
  });
});

describe('IndexedDoc 形状', () => {
  it('索引项保留 docId / kind / tier / source 供引用', () => {
    const index = buildIndex(docs);
    const d: IndexedDoc = index.docs[0];
    expect(d).toMatchObject({ docId: 'skill:200773', kind: 'skill', tier: 'package', source: 'test/skill:200773' });
  });
});
