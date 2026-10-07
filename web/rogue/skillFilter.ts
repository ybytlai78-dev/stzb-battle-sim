export interface SkillRow {
  id: string;
  name: string;
  grade: string;
  type: string;
}

/**
 * 战法筛选。默认最多 24 条，避免把上百个战法一次铺开。
 * @param rows 候选
 * @param query 名称片段，空串表示不过滤
 * @param grade 品级；`ALL` 表示全部
 * @param type 战法类型；`ALL` 表示全部
 * @param limit 返回条数上限
 */
export function filterSkills(
  rows: readonly SkillRow[],
  query: string,
  grade: string,
  type: string,
  limit = 24,
): SkillRow[] {
  const q = query.trim();
  const matched = rows.filter((row) => {
    if (grade !== 'ALL' && row.grade !== grade) return false;
    if (type !== 'ALL' && row.type !== type) return false;
    if (q && !row.name.includes(q) && !row.id.includes(q)) return false;
    return true;
  });
  return matched.slice(0, limit);
}
