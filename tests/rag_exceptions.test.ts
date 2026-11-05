import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_DIVERGENCES,
  IGNORE_RULES,
  checkDivergence,
  describeVerdicts,
  sameNumber,
} from '../scripts/rag/exceptions.mts';
import type { AcceptedDivergence } from '../scripts/rag/exceptions.mts';

/** 注入用的活动条目：验证 accepted / stale 语义，不依赖真实清单的退役状态 */
const ACTIVE: AcceptedDivergence[] = [
  {
    skillId: 'demo_skill',
    detailId: 99900101,
    field: 'value',
    engine: 200,
    pkg: 190,
    reason: '演示条目：官方文案优先于 detail 表',
    decided: '2026-10-24 用户拍板',
  },
];

describe('已裁定差异：命中且两侧未变 → 不计入差异', () => {
  it('两侧与登记值一致 → accepted', () => {
    const r = checkDivergence(
      { skillId: 'demo_skill', detailId: 99900101, field: 'value', engine: 200, pkg: 190 },
      ACTIVE
    );
    expect(r.verdict).toBe('accepted');
    expect((r.entry as AcceptedDivergence).decided).toContain('2026-10-24');
  });

  it('引擎侧被改动 → stale，并说明登记值与现值', () => {
    const r = checkDivergence(
      { skillId: 'demo_skill', detailId: 99900101, field: 'value', engine: 210, pkg: 190 },
      ACTIVE
    );
    expect(r.verdict).toBe('stale');
    expect(r.note).toContain('需重新裁定');
    expect(r.note).toContain('210');
  });

  it('包内侧被改动 → 同样 stale（不允许静默吞掉）', () => {
    const r = checkDivergence(
      { skillId: 'demo_skill', detailId: 99900101, field: 'value', engine: 200, pkg: 180 },
      ACTIVE
    );
    expect(r.verdict).toBe('stale');
    expect(r.note).toContain('180');
  });

  it('字段维度不同不算命中：growth 未登记就走 none', () => {
    const r = checkDivergence(
      { skillId: 'demo_skill', detailId: 99900101, field: 'growth', engine: 0, pkg: 0.1 },
      ACTIVE
    );
    expect(r.verdict).toBe('none');
  });
});

describe('退役条目：只留历史，不再吞掉差异', () => {
  const retired: AcceptedDivergence[] = [{ ...ACTIVE[0], retired: '2026-11-05：包内已修正' }];

  it('退役后同样的两侧值不再判 accepted', () => {
    const r = checkDivergence(
      { skillId: 'demo_skill', detailId: 99900101, field: 'value', engine: 200, pkg: 190 },
      retired
    );
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
  it('每条已裁定条目都必须给出理由、裁定依据与日期', () => {
    expect(ACCEPTED_DIVERGENCES.length).toBeGreaterThan(0);
    for (const d of ACCEPTED_DIVERGENCES) {
      expect(d.reason.length).toBeGreaterThan(10);
      expect(d.decided).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('真实清单里没有仍在生效的条目时，全部必须带退役说明', () => {
    const active = ACCEPTED_DIVERGENCES.filter((d) => !d.retired);
    if (active.length === 0) {
      expect(ACCEPTED_DIVERGENCES.every((d) => (d.retired ?? '').includes('2026-11-05'))).toBe(true);
    } else {
      expect(active.every((d) => !d.retired)).toBe(true);
    }
  });

  it('将门虎女两条已退役：2026-11-04 热更后包内改为 200 / 60', () => {
    for (const id of [20009401, 20009402]) {
      const entry = ACCEPTED_DIVERGENCES.find((d) => d.detailId === id);
      expect(entry?.retired).toContain('已改为');
    }
  });

  it('每条忽略规则都必须说明原因', () => {
    for (const r of IGNORE_RULES) expect(r.reason.length).toBeGreaterThan(10);
  });

  it('describeVerdicts 覆盖忽略规则与退役条目', () => {
    const lines = describeVerdicts();
    expect(lines.some((l) => l.startsWith('[ignored]'))).toBe(true);
    expect(lines.some((l) => l.startsWith('[retired]'))).toBe(true);
  });

  it('sameNumber 容差口径：绝对 1e-6 或相对 1e-3', () => {
    expect(sameNumber(0.204, 0.2040001)).toBe(true);
    expect(sameNumber(200, 190)).toBe(false);
    expect(sameNumber(null, null)).toBe(true);
    expect(sameNumber(null, 0)).toBe(false);
  });
});
