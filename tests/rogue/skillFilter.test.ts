import { describe, expect, it } from 'vitest';
import { filterSkills, type SkillRow } from '../../web/rogue/skillFilter';

const rows: SkillRow[] = Array.from({ length: 166 }, (_, index) => ({
  id: `s${index}`,
  name: `战法${index}`,
  grade: index % 2 === 0 ? 'B' : 'A',
  type: index % 3 === 0 ? 'active' : 'command',
}));

describe('战法筛选', () => {
  it('不把整个背包一次铺开', () => {
    expect(filterSkills(rows, '', 'ALL', 'ALL').length).toBeLessThanOrEqual(24);
    expect(rows.length).toBe(166);
  });

  it('按名称和品级过滤', () => {
    const found = filterSkills(rows, '战法12', 'ALL', 'ALL');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((row) => row.name.includes('战法12'))).toBe(true);
    expect(filterSkills(rows, '', 'S', 'ALL')).toEqual([]);
  });
});
