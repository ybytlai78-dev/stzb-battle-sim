import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_DIVERGENCES,
  IGNORE_RULES,
  checkDivergence,
  describeVerdicts,
  sameNumber,
} from '../scripts/rag/exceptions.mts';

describe('已裁定差异：命中即不再计入差异', () => {
  it('将门虎女 20009401 值 200 / 190 是已裁定的（官方文案优先于 detail 表）', () => {
    const r = checkDivergence({
      skillId: 'jiangmen_hunv',
      detailId: 20009401,
      field: 'value',
      engine: 200,
      pkg: 190,
    });
    expect(r.verdict).toBe('accepted');
    expect((r.entry as { decided: string }).decided).toContain('2026-10-24');
  });

  it('动摇伤害率 60 / 35 同样是已裁定条目', () => {
    const r = checkDivergence({
      skillId: 'jiangmen_hunv',
      detailId: 20009402,
      field: 'value',
      engine: 60,
      pkg: 35,
    });
    expect(r.verdict).toBe('accepted');
  });
});

describe('例外失效检测：数值变了必须重新报警', () => {
  it('引擎侧被改动 → stale，并说明登记值与现值', () => {
    const r = checkDivergence({
      skillId: 'jiangmen_hunv',
      detailId: 20009401,
      field: 'value',
      engine: 210,
      pkg: 190,
    });
    expect(r.verdict).toBe('stale');
    expect(r.note).toContain('需重新裁定');
    expect(r.note).toContain('210');
  });

  it('包内侧被改动 → 同样 stale（不允许静默吞掉）', () => {
    const r = checkDivergence({
      skillId: 'jiangmen_hunv',
      detailId: 20009402,
      field: 'value',
      engine: 60,
      pkg: 40,
    });
    expect(r.verdict).toBe('stale');
  });

  it('字段维度不同不算命中：growth 未登记就走 none', () => {
    const r = checkDivergence({
      skillId: 'jiangmen_hunv',
      detailId: 20009401,
      field: 'growth',
      engine: 0,
      pkg: 0.1,
    });
    expect(r.verdict).toBe('none');
  });
});

describe('结构性不对等：本来就不是同一实体', () => {
  it('百家变体 bj_ 前缀整类忽略', () => {
    const r = checkDivergence({ skillId: 'bj_550010', detailId: 55000701, field: 'value', engine: 80, pkg: 10 });
    expect(r.verdict).toBe('ignored');
    expect((r.entry as { reason: string }).reason).toContain('百家变体');
  });

  it('引擎 zhuiji 通用模板 vs 包内 200206 同名独立战法', () => {
    const r = checkDivergence({ skillId: 'zhuiji', detailId: 20020601, field: 'value', engine: 50, pkg: 80 });
    expect(r.verdict).toBe('ignored');
  });

  it('未登记的战法照常按真实差异处理', () => {
    const r = checkDivergence({ skillId: 'jinkui_yaolue', detailId: 20077301, field: 'growth', engine: 0.18, pkg: 0.13 });
    expect(r.verdict).toBe('none');
  });
});

describe('清单自身的完整性', () => {
  it('每条已裁定条目都必须给出理由与裁定依据', () => {
    expect(ACCEPTED_DIVERGENCES.length).toBeGreaterThan(0);
    for (const d of ACCEPTED_DIVERGENCES) {
      expect(d.reason.length).toBeGreaterThan(10);
      expect(d.decided).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('每条忽略规则都必须说明原因', () => {
    for (const r of IGNORE_RULES) expect(r.reason.length).toBeGreaterThan(10);
  });

  it('describeVerdicts 同时覆盖两类条目', () => {
    const lines = describeVerdicts();
    expect(lines.some((l) => l.startsWith('[accepted]'))).toBe(true);
    expect(lines.some((l) => l.startsWith('[ignored]'))).toBe(true);
  });

  it('sameNumber 容差口径：绝对 1e-6 或相对 1e-3', () => {
    expect(sameNumber(0.204, 0.2040001)).toBe(true);
    expect(sameNumber(200, 190)).toBe(false);
    expect(sameNumber(null, null)).toBe(true);
    expect(sameNumber(null, 0)).toBe(false);
  });
});
