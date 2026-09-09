/**
 * Web 战法数据完整性测试：
 *  1. SKILL_REGISTRY 每个战法都应有官方品级（web/data/skill_grades.json）与描述（web/data/skill_desc.json）——
 *     防止新战法入库后忘记重跑 scripts/gen_skill_data.mjs（曾导致奋疾先登显示 B 级图标 + 描述无法加载，
 *     悬停 tooltip 正常因为 tooltip 用 heroes.json 的 skillDesc）
 *  2. 品级回归：奋疾先登（乐进·S 级）等主战法品级正确
 */
import { describe, it, expect } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import { SKILL_GRADES, SKILL_DESCS, skillGrade, skillDesc } from './heroes';

describe('Web 战法数据完整性（scripts/gen_skill_data.mjs 生成物）', () => {
  it('SKILL_REGISTRY 全部战法都有品级与描述（新增战法后须重跑生成脚本）', () => {
    const ids = Object.keys(SKILL_REGISTRY);
    expect(ids.length).toBeGreaterThan(0);
    const missingGrades = ids.filter((id) => !SKILL_GRADES[id]);
    const missingDescs = ids.filter((id) => !SKILL_DESCS[id]);
    expect(missingGrades, '缺品级的战法（skill_grades.json）').toEqual([]);
    expect(missingDescs, '缺描述的战法（skill_desc.json）').toEqual([]);
  });

  it('奋疾先登（乐进主战法）：S 级品级 + 描述可加载（回归：曾缺失导致 B 级图标/描述空白）', () => {
    expect(skillGrade('fenji_xiandeng')).toBe('S');
    const entry = SKILL_DESCS['fenji_xiandeng'];
    expect(entry).toBeTruthy();
    expect(entry.quality).toBe('S');
    expect(skillDesc('fenji_xiandeng')).toContain('攻击伤害提升8.0%'); // 满级描述
    expect(entry.desc1.length).toBeGreaterThan(0); // 1 级描述
    expect(entry.targetType).toBeTruthy();
  });

  it('品级回退兜底不掩盖缺失：skill_grades 覆盖全部注册战法时品级均来自官方数据', () => {
    // 若 SKILL_GRADES 有缺口，skillGrade() 会回退 'B'——上一条已保证无缺口，此处校验典型主战法
    expect(skillGrade('liehuo_fenzhou')).toBe('S'); // 黄盖·烈火焚舟
    expect(skillGrade('huangyi_liuli')).toBe('S'); // 刘备·皇裔流离
    expect(skillGrade('jinkui_yaolue')).toBe('S'); // 张机·金匮要略
  });
});
