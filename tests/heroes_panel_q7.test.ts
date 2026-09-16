/**
 * 七将面板入库（2026-09-14）：只挂面板 / 成长 / 互斥。
 * 贾充已挂主战法赏顺伐逆，因策略反击成长未确认仍下架；
 * 曹纯 / 羊祜 / 马谡 / 汉荀彧 空槽；马岱保持空槽；于禁、魏荀彧修正成长。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, getGeneral, validateMutualExclusion } from '../src/data/heroes';
import { isHeroListed } from '../src/data/listing';

beforeAll(async () => {
  await initHeroDB();
});

describe('七将面板入库（空槽 / 取基值下架）', () => {
  it('曹纯 h498 魏骑面板对齐 extra，虎豹督军已挂槽上架', () => {
    const rec = HERO_RECORDS['h498'];
    const g = HERO_REGISTRY['h498'];
    expect(g.name).toBe('曹纯');
    expect(g.faction).toBe('魏');
    expect(g.troopType).toBe('cavalry');
    expect(g.cost).toBe(3);
    expect(g.attackRange).toBe(3);
    expect(rec.baseAttack).toBe(96);
    expect(rec.baseDefense).toBe(85);
    expect(rec.baseStrategy).toBe(68);
    expect(rec.baseSpeed).toBe(88);
    expect(rec.growthAttack).toBe(1.97);
    expect(rec.growthDefense).toBe(1.75);
    expect(rec.growthStrategy).toBe(0.99);
    expect(rec.growthSpeed).toBe(1.41);
    expect(rec.mainSkillId).toBe('hubao_dujun');
    expect(rec.mainSkillName).toBe('虎豹督军');
    expect(rec.skillDesc).toContain('50.0%');
    expect(rec.skillDesc).toContain('1/8');
    expect(isHeroListed(rec)).toBe(true); // 虎豹督军已实现 → 上架
  });

  it('贾充 h708 晋步面板对齐 extra，赏顺伐逆已挂槽因反击成长未确认仍下架', () => {
    const rec = HERO_RECORDS['h708'];
    const g = HERO_REGISTRY['h708'];
    expect(g.name).toBe('贾充');
    expect(g.faction).toBe('晋');
    expect(g.troopType).toBe('infantry');
    expect(g.cost).toBe(2.5);
    expect(g.attackRange).toBe(3);
    expect(rec.baseAttack).toBe(43);
    expect(rec.baseDefense).toBe(81);
    expect(rec.baseStrategy).toBe(97);
    expect(rec.baseSpeed).toBe(38);
    expect(rec.growthAttack).toBe(0.59);
    expect(rec.growthDefense).toBe(1.5);
    expect(rec.growthStrategy).toBe(2.1);
    expect(rec.growthSpeed).toBe(0.59);
    expect(rec.mainSkillId).toBe('shangshun_fani');
    expect(rec.mainSkillName).toBe('赏顺伐逆');
    expect(isHeroListed(rec)).toBe(false);
  });

  it('羊祜 h709 潜谋远计用战法库 60%/叠防/前中 文案，空槽', () => {
    const rec = HERO_RECORDS['h709'];
    const g = HERO_REGISTRY['h709'];
    expect(g.name).toBe('羊祜');
    expect(g.faction).toBe('晋');
    expect(g.troopType).toBe('infantry');
    expect(rec.growthStrategy).toBe(2.01);
    expect(rec.growthDefense).toBe(1.86);
    expect(rec.mainSkillId).toBe('');
    expect(rec.mainSkillName).toBe('潜谋远计');
    expect(rec.skillDesc).toContain('60.0%');
    expect(rec.skillDesc).toContain('谋略属性和防御属性提高15.0');
    expect(rec.skillDesc).toContain('前锋或中军');
    expect(rec.skillDesc).not.toContain('75.0%');
    expect(isHeroListed(rec)).toBe(false);
  });

  it('马谡 h799 蜀骑面板对齐 extra，心战为上空槽', () => {
    const rec = HERO_RECORDS['h799'];
    const g = HERO_REGISTRY['h799'];
    expect(g.name).toBe('马谡');
    expect(g.faction).toBe('蜀');
    expect(g.troopType).toBe('cavalry');
    expect(g.cost).toBe(3);
    expect(g.attackRange).toBe(2);
    expect(rec.baseStrategy).toBe(90);
    expect(rec.baseSpeed).toBe(92);
    expect(rec.growthStrategy).toBe(1.79);
    expect(rec.mainSkillId).toBe('');
    expect(rec.mainSkillName).toBe('心战为上');
    expect(isHeroListed(rec)).toBe(false);
  });

  it('汉荀彧 h794 举贤决机空槽；与魏荀彧**不再互斥**（2026-09-16 互斥改白名单制）', () => {
    const rec = HERO_RECORDS['h794'];
    const g = HERO_REGISTRY['h794'];
    expect(g.name).toBe('荀彧');
    expect(g.faction).toBe('汉');
    expect(g.troopType).toBe('infantry');
    expect(g.cost).toBe(3.5);
    expect(rec.baseStrategy).toBe(99);
    expect(rec.growthStrategy).toBe(2.55);
    expect(rec.mainSkillId).toBe('');
    expect(rec.mainSkillName).toBe('举贤决机');
    expect(rec.mutualExclusionGroup).toBeNull();
    expect(HERO_RECORDS['h24'].mutualExclusionGroup).toBeNull();
    expect(isHeroListed(rec)).toBe(false);
    const err = validateMutualExclusion([getGeneral('h24'), getGeneral('h794')]);
    expect(err).toBeNull();
  });

  it('马岱 h615 仍空槽（奉令护蜀不实现）', () => {
    const rec = HERO_RECORDS['h615'];
    expect(rec.name).toBe('马岱');
    expect(rec.mainSkillId).toBe('');
    expect(rec.mainSkillName).toBe('奉令护蜀');
    expect(isHeroListed(rec)).toBe(false);
  });
});

describe('已入库武将成长修正', () => {
  it('于禁 h796 防御成长 2.1、速度成长 0.58（不再对调）', () => {
    const rec = HERO_RECORDS['h796'];
    expect(rec.name).toBe('于禁');
    expect(rec.growthAttack).toBe(2);
    expect(rec.growthDefense).toBe(2.1);
    expect(rec.growthStrategy).toBe(0.8);
    expect(rec.growthSpeed).toBe(0.58);
    expect(rec.mainSkillId).toBe('dangdi_zhijue');
  });

  it('魏荀彧 h24 攻击 0.55 / 谋略 2.25（不再把攻城成长写入攻击）', () => {
    const rec = HERO_RECORDS['h24'];
    expect(rec.name).toBe('荀彧');
    expect(rec.faction).toBe('魏');
    expect(rec.growthAttack).toBe(0.55);
    expect(rec.growthDefense).toBe(1.56);
    expect(rec.growthStrategy).toBe(2.25);
    expect(rec.growthSpeed).toBe(1.49);
    expect(rec.mainSkillId).toBe('quhu_tunlang');
  });
});
