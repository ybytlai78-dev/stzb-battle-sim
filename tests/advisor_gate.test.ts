/**
 * 关 2 · 数字溯源（web/advisor/gate.ts）
 * 锁：容差公式、深度取数、伪造证据 / 对不上的数字 → 未验证、三关缺一不可。
 * （关 3「标准口径独立复算」属实施计划 Task 5，本切片未接入 → `recomputed` 保持 false。）
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { collectNumbers, decideApply, verifyClaims, verifyPlanEvidence, withinTolerance } from '../web/advisor/gate';
import type { ProposedPlan, ToolCallRecord } from '../web/advisor/types';

const rec = (evidenceId: string, mean: number): ToolCallRecord => ({
  evidenceId,
  name: 'simulate',
  args: {},
  summary: `真跑 20 场：核心将伤害期望 ${mean}`,
  data: { mean, halfWidth: 100, runs: 20 },
  stats: { battles: 20, ms: 100, seed: 20260929 },
});

const planOf = (evidenceIds: string[]): ProposedPlan => ({
  title: '方案A',
  plan: { slots: [], coreUnitIds: [], dummy: { defense: 150, strategy: 100, troopType: 'infantry', troops: 150000 } },
  evidenceIds,
});

describe('advisor gate · 关 2（数字溯源）', () => {
  it('容差公式：|claimed − actual| ≤ max(0.005 × |actual|, 1)', () => {
    expect(withinTolerance(26500, 26500)).toBe(true);
    expect(withinTolerance(Math.round(26500 * 1.004), 26500)).toBe(true); // 0.4% 内
    expect(withinTolerance(Math.round(26500 * 1.02), 26500)).toBe(false); // 2% 外
    expect(withinTolerance(1.4, 1)).toBe(true); // 绝对容差兜底
    expect(withinTolerance(3, 1)).toBe(false);
  });

  it('collectNumbers 深度遍历（含纯数字字符串，跳过非数字串与 null）', () => {
    expect(collectNumbers({ a: 1, b: { c: [2, '3', 'x'] }, d: null })).toEqual([1, 2, 3]);
    expect(collectNumbers('没有数字')).toEqual([]);
  });

  it('① 伪造 evidenceId → 未验证（并说明原因）', () => {
    const r = verifyClaims('该方案期望 26500[[ev-9-simulate]]', [rec('ev-1-simulate', 26500)]);
    expect(r.ok).toBe(false);
    expect(r.failures[0].reason).toContain('不存在');
  });

  it('② 数字对不上 → 未验证（26,500 说成 31,000 混不过去）', () => {
    const r = verifyClaims('该方案期望 31000[[ev-1-simulate]]', [rec('ev-1-simulate', 26500)]);
    expect(r.ok).toBe(false);
    expect(r.failures[0].reason).toContain('找不到');
  });

  it('③ 26,500 与「26,500 写成 2.65 万」都视为一致；带千分位也认', () => {
    expect(verifyClaims('期望 26500[[ev-1-simulate]]', [rec('ev-1-simulate', 26500)]).ok).toBe(true);
    expect(verifyClaims('期望 26,500[[ev-1-simulate]]', [rec('ev-1-simulate', 26500)]).ok).toBe(true);
  });

  it('④ 没有引用格式的叙述数字不参与核对（不误伤「打了 8 回合」这类话）', () => {
    expect(verifyClaims('打满 8 回合、共 3 名武将', []).ok).toBe(true);
  });

  it('方案不带证据 / 带不存在的证据 → 未验证；带真证据 → 通过', () => {
    const trace = [rec('ev-1-simulate', 26500)];
    expect(verifyPlanEvidence(planOf([]), trace)).toMatchObject({ ok: false });
    expect(verifyPlanEvidence(planOf(['ev-nope']), trace)).toMatchObject({ ok: false });
    expect(verifyPlanEvidence(planOf(['ev-1-simulate']), trace)).toMatchObject({ ok: true });
  });

  it('决定「应用」：合法性 / 可溯源 / 已复算 三条缺一不可', () => {
    expect(decideApply({ legal: false, verified: true, recomputed: true }).enabled).toBe(false);
    expect(decideApply({ legal: true, verified: false, recomputed: true }).enabled).toBe(false);
    expect(decideApply({ legal: true, verified: true, recomputed: false })).toMatchObject({ enabled: false });
    expect(decideApply({ legal: true, verified: true, recomputed: true }).enabled).toBe(true);
  });
});
