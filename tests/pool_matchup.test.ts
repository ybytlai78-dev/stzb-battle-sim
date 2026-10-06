/**
 * 对手池对打：胜平负与统计胜率同一条 playOne，同一批战斗带出八回合总伤和前三回合。
 */
import { describe, expect, it } from 'vitest';
import { ALL_HEROES, buildGeneral } from '../web/heroes';
import { loadMergedPool } from '../web/opponentPool';
import { binomialHalfWidth, matchupPool, ratesIndistinguishable } from '../web/poolMatchup';
import { simulateWinRate, simulateWinRateSample } from '../web/winRate';
import type { General } from '../src/engine/types';

const POSITIONS: General['position'][] = ['大营', '中军', '前锋'];

function team(names: string[]): General[] {
  return names.map((name, i) => {
    const hero = ALL_HEROES.find((h) => h.name === name);
    if (!hero) throw new Error(`测试武将不存在：${name}`);
    return buildGeneral(hero.id, [], {}, POSITIONS[i] ?? '前锋', 0, 40, 120);
  });
}

describe('对手池对打口径', () => {
  const mine = team(['孙权', '周瑜', '太史慈']);
  const enemy = team(['马云禄', '魏延', '张辽']);

  it('simulateWinRateSample 的胜平负与 simulateWinRate 相同，并且带出伤害', () => {
    const opts = { runs: 4, baseSeed: 7, swapSides: true as const };
    const stats = simulateWinRate(mine, enemy, opts);
    const sample = simulateWinRateSample(mine, enemy, opts);
    expect(sample.win).toBe(stats.win);
    expect(sample.draw).toBe(stats.draw);
    expect(sample.loss).toBe(stats.loss);
    expect(sample.win + sample.draw + sample.loss).toBe(4);
    expect(sample.meanTotal).toBeGreaterThan(0);
    expect(sample.meanFirst3).toBeGreaterThan(0);
    expect(sample.meanFirst3).toBeLessThanOrEqual(sample.meanTotal);
  });

  it('打固定池时综合胜率 = 胜场 / 场次，半宽按二项分布', () => {
    const pool = loadMergedPool(null);
    const result = matchupPool(mine, { version: pool.version, entries: pool.entries.slice(0, 1) }, { runsPerOpponent: 4, baseSeed: 11 });
    expect(result.runs).toBe(4);
    expect(result.win + result.draw + result.loss).toBe(result.runs);
    expect(result.winRate).toBeCloseTo(result.win / result.runs);
    expect(result.halfWidth).toBeCloseTo(binomialHalfWidth(result.winRate, result.runs));
    expect(result.meanTotal).toBeGreaterThan(0);
    expect(result.fingerprint.startsWith(pool.version)).toBe(true);
    expect(result.opponents[0]?.runs).toBe(4);
  });

  it('95% 半宽盖住差值就算分不出来', () => {
    expect(ratesIndistinguishable({ winRate: 0.5, halfWidth: 0.05 }, { winRate: 0.52, halfWidth: 0.05 })).toBe(true);
    expect(ratesIndistinguishable({ winRate: 0.8, halfWidth: 0.01 }, { winRate: 0.2, halfWidth: 0.01 })).toBe(false);
  });
});
