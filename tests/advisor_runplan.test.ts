/**
 * Task 2：从 L2 抽出的「单方案测评」入口 `evaluatePlan`（web/simExpectation.ts）
 * 锁：场次口径、可复现（种子 = baseSeed + 场次 → 前缀性质）、统计公式、核心将口径、木桩不截断。
 * 「行为不变」由既有 tests/sim_expectation.test.ts（42 个用例）全绿共同证明。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { evaluatePlan } from '../web/simExpectation';
import { defaultCfg } from '../web/teamConfig';

const cfg = defaultCfg();

describe('evaluatePlan（AI 顾问的单方案测评入口）', () => {
  it('跑几场就返回几场，且 runs=3 是 runs=20 的前缀（配对种子）', () => {
    const a = evaluatePlan(cfg, { runs: 3 });
    const b = evaluatePlan(cfg, { runs: 20 });
    expect(a.runs).toBe(3);
    expect(b.runs).toBe(20);
    expect(a.damages).toEqual(b.damages.slice(0, 3));
  });

  it('两次同参数结果完全一致（可复现）', () => {
    const a = evaluatePlan(cfg, { runs: 5 });
    const b = evaluatePlan(cfg, { runs: 5 });
    expect(a).toEqual(b);
  });

  it('sd = 样本标准差（n−1，L2 既有口径）、halfWidth = 1.96 × sd / √n', () => {
    const s = evaluatePlan(cfg, { runs: 20 });
    const mean = s.damages.reduce((x, y) => x + y, 0) / s.damages.length;
    // 注意：不是总体标准差（÷n）—— L2 用的就是 n−1 这一支，顾问必须与它同口径
    const sd = Math.sqrt(s.damages.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (s.damages.length - 1));
    expect(s.sd).toBeCloseTo(sd, 6);
    expect(s.halfWidth).toBeCloseTo((1.96 * sd) / Math.sqrt(s.damages.length), 6);
  });

  it('排序口径 = 核心将伤害：coreUnits 指谁，mean 就是谁的（不是全队总伤）', () => {
    const all = evaluatePlan(cfg, { runs: 5 });
    const byUnit = new Map(all.byUnit.map((u) => [u.unit, u.mean]));
    const core0 = evaluatePlan(cfg, { runs: 5, coreUnits: [0] });
    expect(core0.mean).toBeCloseTo(byUnit.get(0)!, 6);
    expect(core0.mean).toBeLessThanOrEqual(all.meanTotal); // 单人 ≤ 全队总伤
  });

  it('木桩给足兵力时不截断（wipedRuns = 0）', () => {
    expect(evaluatePlan(cfg, { runs: 5 }).wipedRuns).toBe(0);
  });

  it('按将 / 按战法明细都有值（供方案卡直接读）', () => {
    const s = evaluatePlan(cfg, { runs: 5 });
    expect(s.byUnit).toHaveLength(cfg.slots.length);
    expect(s.byUnit.some((u) => u.mean > 0)).toBe(true);
    expect(s.bySkill.length).toBeGreaterThan(0);
  });
});
