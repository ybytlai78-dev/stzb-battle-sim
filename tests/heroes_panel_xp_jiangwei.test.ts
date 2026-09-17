/**
 * XP姜维入库（2026-09-16）：姜维·蜀·骑（官方 hero_id 100806，season=XP）
 * 数据源：官网 hero_extra.json + 移动版详情页 /m/herolist/100806.html（四维/成长经全量交叉校验可信）
 * 本次口径（用户拍板）：
 *  - 命名 xp_jiangwei /「XP姜维」
 *  - 互斥：XP 卡不入互斥组（姜维 ↔ XP姜维 可同队）
 *  - 画像：官方 470×592 水印档缺失 → 用 card_medium 240×348（同 h807 先例）
 *  - 主战法【九伐中原】已实现（jiufa_zhongyuan）→ 挂槽上架；「受谋略」成长率仍未确认 → 数值留空用基值
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY } from '../src/data/heroes';
import { isHeroListed } from '../src/data/listing';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

beforeAll(async () => {
  await initHeroDB();
});

describe('XP姜维（姜维·蜀·骑 · hero_id 100806）入库', () => {
  it('面板对齐官网：蜀 / 骑 / COST 3 / 攻击距离 2 / 初始四维 82-84-89-84', () => {
    const rec = HERO_RECORDS['xp_jiangwei'];
    const g = HERO_REGISTRY['xp_jiangwei'];
    expect(rec).toBeTruthy();
    expect(rec.name).toBe('XP姜维');
    expect(g.faction).toBe('蜀');
    expect(g.troopType).toBe('cavalry');
    expect(g.cost).toBe(3);
    expect(g.attackRange).toBe(2);
    expect(rec.baseAttack).toBe(82);
    expect(rec.baseDefense).toBe(84);
    expect(rec.baseStrategy).toBe(89);
    expect(rec.baseSpeed).toBe(84);
  });

  it('四维成长对齐官网 grow 字段：1.66 / 1.45 / 1.97 / 1.25', () => {
    const rec = HERO_RECORDS['xp_jiangwei'];
    expect(rec.growthAttack).toBe(1.66);
    expect(rec.growthDefense).toBe(1.45);
    expect(rec.growthStrategy).toBe(1.97);
    expect(rec.growthSpeed).toBe(1.25);
  });

  it('主战法九伐中原：已实现（挂槽 + 上架）+ 官方文案入库', () => {
    const rec = HERO_RECORDS['xp_jiangwei'];
    expect(rec.mainSkillId).toBe('jiufa_zhongyuan');
    expect(rec.mainSkillName).toBe('九伐中原');
    expect(rec.skillDesc).toContain('伤害率90.0%');
    expect(rec.skillDesc).toContain('受谋略属性影响');
    expect(rec.skillDesc).toContain('共计可发动九次');
    expect(rec.skillDesc).toContain('提升5.0%');
    expect(isHeroListed(rec)).toBe(true); // 主战法已实现 → 入池（受谋略成长率未确认 → 数值留空用基值）
  });

  it('XP 卡不入互斥组（姜维 ↔ XP姜维 可同队）', () => {
    expect(HERO_RECORDS['xp_jiangwei'].mutualExclusionGroup).toBeNull();
  });

  it('画像映射到官方 100806，且立绘/头像文件已就位（medium 240×348 档）', () => {
    const map = JSON.parse(readFileSync(join(root, 'web/data/portrait_map.json'), 'utf8'));
    expect(map['xp_jiangwei'].heroId).toBe(100806);
    expect(map['xp_jiangwei'].officialName).toBe('姜维');
    const portraits = JSON.parse(readFileSync(join(root, 'web/data/portraits.json'), 'utf8'));
    expect(portraits['xp_jiangwei'].portrait).toBe('/portraits/xp_jiangwei.jpg');
    expect(portraits['xp_jiangwei'].avatar).toBe('/portraits/xp_jiangwei_s.jpg');
  });
});
