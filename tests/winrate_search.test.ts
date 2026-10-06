/**
 * 胜率搜索：粗筛丢掉明显更差的，决赛才用满场次；只换一处才允许对比。
 */
import { describe, expect, it } from 'vitest';
import { SLOTTED_HEROES } from '../web/heroes';
import { LEARNABLE_SKILL_IDS } from '../web/teamConfig';
import { DEFAULT_DUMMY, type AdvisorPlan } from '../web/advisor/types';
import type { PoolMatchup } from '../web/poolMatchup';
import { fillSkill, runWinRateSearch, singleChangeBetween } from '../web/winrateSearch';

function plan(): AdvisorPlan {
  const ids = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
  return {
    slots: ids.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] as string[] })),
    coreUnitIds: [],
    dummy: { ...DEFAULT_DUMMY },
  };
}

function match(winRate: number, halfWidth: number): PoolMatchup {
  return {
    version: 'test',
    fingerprint: 'test|',
    baseSeed: 1,
    runsPerOpponent: 1,
    opponents: [
      {
        id: 'o1',
        note: '甲',
        source: 'benchmark',
        runs: 1,
        win: 1,
        draw: 0,
        loss: 0,
        winRate,
        halfWidth,
        meanTotal: 1,
        meanFirst3: 1,
        controlMine: 0,
      },
    ],
    runs: 1,
    win: 1,
    draw: 0,
    loss: 0,
    winRate,
    halfWidth,
    meanTotal: 1,
    meanFirst3: 1,
    controlMine: 0,
    worst: { id: 'o1', note: '甲', winRate },
    battles: 1,
    ms: 1,
  };
}

describe('胜率搜索', () => {
  const [better, close] = LEARNABLE_SKILL_IDS;

  it('按综合胜率排序；与第一名区间重叠的标成分不出来；决赛才用满场次', async () => {
    const runs: number[] = [];
    const result = await runWinRateSearch({
      base: plan(),
      mode: 'skill',
      holes: [{ unit: 0, index: 0 }],
      candidateIds: [better, close],
      coarseRuns: 4,
      finalRuns: 100,
      finalists: 8,
      rankBy: 'winRate',
      evalPlan: async (p, n) => {
        runs.push(n);
        const id = p.slots[0].skillIds[0];
        const winRate = id === better ? 0.7 : id === close ? 0.69 : 0.2;
        return match(winRate, 0.05);
      },
    });
    expect(result.rows[0]?.plan.slots[0].skillIds[0]).toBe(better);
    expect(result.rows[1]?.tieWithBest).toBe(true);
    expect(result.rankBy).toBe('winRate');
    expect(runs.some((n) => n === 4)).toBe(true);
    expect(runs.filter((n) => n === 100).length).toBeGreaterThanOrEqual(3);
    expect(runs.every((n) => n === 4 || n === 100)).toBe(true);
  });

  it('singleChangeBetween：换一个战法可以，再动第二处不行', () => {
    const base = plan();
    const one = fillSkill(base, { unit: 0, index: 0 }, better);
    const two = fillSkill(one, { unit: 1, index: 0 }, close);
    const first = singleChangeBetween(base, one);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.label).toContain('战法');
    const second = singleChangeBetween(base, two);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('一处');
  });
});
