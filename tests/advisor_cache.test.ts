/**
 * 跑批缓存（web/advisor/cache.ts + 工具接线）
 * 锁：键稳定性（键序无关 / 数组序有关）、持久化与淘汰、命中时 **0 场计费 + 新 evidenceId**、
 *     参数变了必须重跑（不能拿旧结果糊弄）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { cacheKey, createLocalCache, createMemoryCache, hitToResult, stableStringify } from '../web/advisor/cache';
import { makeCtx, runTool, SIM_RUNS_DEFAULT } from '../web/advisor/tools';
import { SLOTTED_HEROES } from '../web/heroes';
import { DEFAULT_DUMMY, type AdvisorPlan } from '../web/advisor/types';

const plan = (heroIds = SLOTTED_HEROES.slice(0, 3).map((h) => h.id)): AdvisorPlan => ({
  slots: heroIds.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
});

describe('advisor cache · 键与容器', () => {
  it('stableStringify：对象键序无关、数组序有关', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(cacheKey('simulate', { a: 1, b: [1, 2] })).toBe(cacheKey('simulate', { b: [1, 2], a: 1 }));
    expect(cacheKey('simulate', { runs: 20 })).not.toBe(cacheKey('simulate', { runs: 21 }));
    expect(cacheKey('simulate', { runs: 20 })).not.toBe(cacheKey('optimize_skills', { runs: 20 }));
  });

  it('内存缓存：get/set/has/stats/clear', () => {
    const c = createMemoryCache();
    expect(c.has('k')).toBe(false);
    expect(c.get('k')).toBeNull();
    c.set('k', { summary: 's', data: { mean: 1 }, battles: 20, ms: 100 });
    expect(c.has('k')).toBe(true);
    expect(c.get('k')?.data).toEqual({ mean: 1 });
    expect(c.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    c.clear();
    expect(c.stats().entries).toBe(0);
  });

  it('本地缓存：写进 localStorage、超限按最久未写入淘汰', () => {
    localStorage.clear();
    const c = createLocalCache({ storageKey: 'test-cache', limit: 4 });
    for (let i = 0; i < 6; i += 1) c.set(`k${i}`, { summary: `s${i}`, data: i, battles: 1, ms: 1 });
    expect(c.stats().entries).toBe(4);
    expect(JSON.parse(localStorage.getItem('test-cache')!).k0).toBeUndefined(); // 最早的被淘汰
    const again = createLocalCache({ storageKey: 'test-cache', limit: 4 });
    expect(again.has('k5')).toBe(true); // 重新打开还在（持久化）
  });

  it('hitToResult：新 evidenceId + cached 标记 + 0 场', () => {
    const r = hitToResult({ summary: '真跑 20 场：期望 7317', brief: 'b', data: { mean: 7317 }, battles: 8062, ms: 57000, at: Date.now() - 5000 }, 'ev-9-optimize_skills', 20260929);
    expect(r.evidenceId).toBe('ev-9-optimize_skills');
    expect(r.summary).toContain('缓存命中');
    expect(r.summary).toContain('8062');
    expect(r.stats).toMatchObject({ battles: 0, ms: 0, cached: true, seed: 20260929 });
    expect(r.data).toEqual({ mean: 7317 });
  });
});

describe('advisor cache · 工具接线（命中不花场次）', () => {
  beforeEach(() => localStorage.clear());

  it('simulate：同输入第二次命中缓存 → 0 场计费、新 evidenceId、结果一致', async () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 7317, cache: createMemoryCache() });
    const first = await runTool('simulate', { plan: plan(), runs: SIM_RUNS_DEFAULT }, ctx);
    expect(ctx.budget.battles).toBe(SIM_RUNS_DEFAULT);
    expect(first.stats.cached).toBeUndefined();

    const second = await runTool('simulate', { plan: plan(), runs: SIM_RUNS_DEFAULT }, ctx);
    expect(ctx.budget.battles).toBe(SIM_RUNS_DEFAULT); // 没有新增场次
    expect(second.stats.cached).toBe(true);
    expect(second.evidenceId).not.toBe(first.evidenceId); // 证据编号是本轮的
    expect(second.summary).toContain('缓存命中');
    expect((second.data as { mean: number }).mean).toBe((first.data as { mean: number }).mean);
  });

  it('simulate：参数变了必须重跑（runs 20 → 21 不许复用）', async () => {
    const ctx = makeCtx({ fakeRuns: true, cache: createMemoryCache() });
    await runTool('simulate', { plan: plan(), runs: 20 }, ctx);
    const r = await runTool('simulate', { plan: plan(), runs: 21 }, ctx);
    expect(r.stats.cached).toBeUndefined();
    expect(ctx.budget.battles).toBe(41);
  });

  it('simulate：方案变了必须重跑（换前锋）', async () => {
    const ctx = makeCtx({ fakeRuns: true, cache: createMemoryCache() });
    const ids = SLOTTED_HEROES.map((h) => h.id);
    await runTool('simulate', { plan: plan([ids[0], ids[1], ids[2]]), runs: 20 }, ctx);
    const r = await runTool('simulate', { plan: plan([ids[0], ids[1], ids[3]]), runs: 20 }, ctx);
    expect(r.stats.cached).toBeUndefined();
    expect(ctx.budget.battles).toBe(40);
  });

  it('optimize_skills：命中时预算不增加（battlesOf 先查缓存 → 记 0 场）', async () => {
    let runs = 0;
    const ctx = makeCtx({
      fakeRuns: true,
      cache: createMemoryCache(),
      deps: {
        estimateSkillBattles: () => 8000,
        optimizeSkills: async () => {
          runs += 1;
          return {
            battles: 8000,
            ms: 57000,
            tiesWithBest: 0,
            rankAgreement: 1,
            wipedCombos: 0,
            candidateCount: 10,
            candidateSkipped: 0,
            matchLabel: 'm',
            coreLabel: 'c',
            noEmptySlot: false,
            combosCapped: false,
            finals: [{ rank: 1, label: 'X', mean: 7317, halfWidth: 300, runs: 20, meanTotal: 15000, tieWithBest: false, wipedRuns: 0, picks: [], byUnit: [] }],
          } as never;
        },
      },
    });
    await runTool('optimize_skills', { plan: plan(), finalRuns: 20 }, ctx);
    expect(ctx.budget.battles).toBe(8000);
    const second = await runTool('optimize_skills', { plan: plan(), finalRuns: 20 }, ctx);
    expect(runs).toBe(1); // 搜索只真跑了一次
    expect(ctx.budget.battles).toBe(8000); // 第二次 0 场
    expect(second.stats.cached).toBe(true);
  });

  it('无缓存（缺省）时行为不变：每次都真跑', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    expect(ctx.cache).toBeNull();
    await runTool('simulate', { plan: plan(), runs: 20 }, ctx);
    await runTool('simulate', { plan: plan(), runs: 20 }, ctx);
    expect(ctx.budget.battles).toBe(40);
  });
});
