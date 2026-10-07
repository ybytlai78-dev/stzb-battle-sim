import { describe, expect, it } from 'vitest';
import grades from '../../web/data/skill_grades.json';
import {
  ECONOMY,
  canAfford,
  createWallet,
  gain,
  priceOf,
  skillsOfGrades,
  spend,
  targetWinRate,
} from '../../src/rogue/economy';

describe('玉符参数表', () => {
  it('开局 3000，五连抽 950，三次后余 150', () => {
    expect(ECONOMY.startingJade).toBe(3000);
    expect(ECONOMY.gachaCost).toBe(950);
    expect(ECONOMY.startingJade - ECONOMY.gachaCost * ECONOMY.openingPulls).toBe(150);
  });

  it('S 比 A 贵，通关玉符与关卡命数按表', () => {
    expect(priceOf('S')).toBeGreaterThan(priceOf('A'));
    expect(priceOf('A')).toBe(600);
    expect(priceOf('S')).toBe(1200);
    expect(ECONOMY.clearJade).toBe(500);
    expect(ECONOMY.levelCount).toBe(12);
    expect(ECONOMY.lives).toBe(3);
  });

  it('目标胜率从第 1 关 0.90 落到第 12 关 0.40', () => {
    expect(targetWinRate(1)).toBeCloseTo(0.9);
    expect(targetWinRate(12)).toBeCloseTo(0.4);
    expect(targetWinRate(12)).toBeLessThan(targetWinRate(1));
  });

  it('初始品级是 D/C/B，合计 166', () => {
    expect(skillsOfGrades(grades, ECONOMY.freeGrades)).toHaveLength(166);
  });

  it('扣费不足返回 null，成功不改原钱包', () => {
    const wallet = createWallet(100);
    expect(canAfford(wallet, 950)).toBe(false);
    expect(spend(wallet, 950)).toBeNull();
    expect(wallet.jade).toBe(100);
    expect(spend(wallet, 40)).toEqual({ jade: 60 });
    expect(gain(wallet, 5)).toEqual({ jade: 105 });
  });
});
