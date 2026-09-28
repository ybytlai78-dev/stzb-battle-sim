/**
 * AI 配将顾问 · 共享类型与纯函数（Task 1）
 * 锁：Plan 规范化（排序 / 补默认 / 去空）、缓存键稳定性、方案唯一出口 parsePlans。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DEFAULT_DUMMY, normalizePlan, parsePlans, planKey, type AdvisorPlan } from '../web/advisor/types';

const base: AdvisorPlan = {
  slots: [
    { position: '前锋', heroId: 'h574', level: 40, skillIds: [] },
    { position: '大营', heroId: 'h3', level: 0, skillIds: ['', 'jishi'] },
  ],
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
};

describe('advisor types', () => {
  it('normalizePlan 按 大营/中军/前锋 排序、补默认等级、去空战法', () => {
    const p = normalizePlan(base);
    expect(p.slots.map((s) => s.position)).toEqual(['大营', '前锋']);
    expect(p.slots[0].level).toBe(40); // level 0 → 40
    expect(p.slots[0].skillIds).toEqual(['jishi']); // 空串被去掉
  });

  it('normalizePlan 不动 dummy 的显式字段，只补缺省', () => {
    const p = normalizePlan({ ...base, dummy: { defense: 200, strategy: 100, troopType: 'archer', troops: 999 } });
    expect(p.dummy).toEqual({ defense: 200, strategy: 100, troopType: 'archer', troops: 999 });
  });

  it('planKey 与槽位顺序无关，与场次/种子有关', () => {
    const a = normalizePlan(base);
    const b = normalizePlan({ ...base, slots: [...base.slots].reverse() });
    expect(planKey(a, 20, 1)).toBe(planKey(b, 20, 1));
    expect(planKey(a, 20, 1)).not.toBe(planKey(a, 200, 1));
    expect(planKey(a, 20, 1)).not.toBe(planKey(a, 20, 2));
  });

  it('parsePlans 取出围栏 JSON 里的方案，正文去掉该块', () => {
    const answer =
      '结论：陆抗带危崖困军更好。\n```json\n{ "plans": [ { "title": "方案A", "plan": {"slots":[],"coreUnitIds":[],"dummy":{}}, "evidenceIds": ["ev-1"] } ] }\n```';
    const r = parsePlans(answer);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].title).toBe('方案A');
    expect(r.plans[0].evidenceIds).toEqual(['ev-1']);
    expect(r.text).not.toContain('```json');
    expect(r.text).toContain('结论');
  });

  it('parsePlans 遇到坏 JSON 不抛错：返回空方案 + 保留原文', () => {
    const bad = '看这个\n```json\n{ "plans": [ oops ] }\n```';
    const r = parsePlans(bad);
    expect(r.plans).toEqual([]);
    expect(r.text).toBe(bad);
  });

  it('parsePlans 遇到空 plans / 缺 plan 字段也返回空方案（不半信半疑地放行）', () => {
    expect(parsePlans('```json\n{ "plans": [] }\n```').plans).toEqual([]);
    expect(parsePlans('```json\n{ "plans": [ { "title": "x" } ] }\n```').plans).toEqual([]);
    expect(parsePlans('没有代码块的回答').plans).toEqual([]);
  });
});
