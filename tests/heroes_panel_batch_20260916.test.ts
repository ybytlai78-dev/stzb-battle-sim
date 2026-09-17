/**
 * 批量武将入库（2026-09-16）：从官网武将库（hero_extra.json，quality '4-SR' = 五星）
 * 补入引擎缺失的武将面板（四维/成长/主战法文案/画像），主战法一律空槽下架。
 *
 * 口径（本次）：
 *  - 判星：官网 extra `quality === '4-SR'` → 五星（3-R=四星 / 2-UC=三星）
 *  - 判重：官方 hero_id ∈ 现有池，或 (名, 阵营, 兵种) 已在 hero_growth_verified 候选表
 *  - 版本消歧：同 icon 多版本用 official.skill_init → skill_extra 的当前主战法名定位；
 *    排除 130xxx/132xxx 赛季复刻段
 *  - 命名：SP 卡 → "SP<名>"；XP 卡（season=XP）→ "XP<名>"；其余用官网名
 *  - cost < 2.5 视为四星（仓库 build 规则）→ 只进候选表、不入引擎
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initHeroDB, HERO_RECORDS } from '../src/data/heroes';
import { isHeroListed } from '../src/data/listing';

beforeAll(async () => {
  await initHeroDB();
});

describe('批量补入 · 普通卡（按官网面板）', () => {
  it('十常侍 h2：汉弓 COST5.5 / 攻4 / 面板与成长对齐官网', () => {
    const r = HERO_RECORDS['h2'];
    expect(r.name).toBe('十常侍');
    expect(r.faction).toBe('汉');
    expect(r.troopType).toBe('archer');
    expect(r.cost).toBe(5.5);
    expect(r.attackRange).toBe(4);
    expect([r.baseAttack, r.baseDefense, r.baseStrategy, r.baseSpeed]).toEqual([73, 74, 82, 78]);
    expect([r.growthAttack, r.growthDefense, r.growthStrategy, r.growthSpeed]).toEqual([1.84, 1.86, 2.05, 1.03]);
    expect(r.mainSkillName).toBe('乱政');
    expect(r.mainSkillId).toBe('');
    expect(isHeroListed(r)).toBe(false);
  });

  it('姜维·蜀·步 h74：与 XP姜维 并存（面板各自独立）', () => {
    const r = HERO_RECORDS['h74'];
    expect(r.name).toBe('姜维');
    expect(r.faction).toBe('蜀');
    expect(r.troopType).toBe('infantry');
    expect(r.cost).toBe(2.5);
    expect(r.mainSkillName).toBe('列营守险');
    // 列营守险已实现（feat/mechanic-and-skills），但其「四维 +29.2」的受谋略成长率未确认
    // → 按 listing.ts 口径仍下架（登记于 OFFLINE_MAIN_SKILLS），待反解确认后上架
    expect(isHeroListed(r)).toBe(false);
  });

  it('冯嫽 h812（原被 SKIP 的空数据条目）已从官网补齐', () => {
    const r = HERO_RECORDS['h812'];
    expect(r.name).toBe('冯嫽');
    expect(r.faction).toBe('汉');
    expect(r.troopType).toBe('cavalry');
    expect(r.growthStrategy).toBe(1.72);
    expect(r.mainSkillName).toBe('锦车持节');
  });

  it('裴秀 h801（原被 SKIP）已从官网补齐，晋步', () => {
    const r = HERO_RECORDS['h801'];
    expect(r.name).toBe('裴秀');
    expect(r.faction).toBe('晋');
    expect(r.troopType).toBe('infantry');
    expect(r.mainSkillName).toBe('佐命晋武');
  });

  it('刘徽 h814 / 严颜 h631：面板抽样核对', () => {
    const liu = HERO_RECORDS['h814'];
    expect([liu.baseStrategy, liu.growthStrategy]).toEqual([95, 2.18]);
    expect(liu.mainSkillName).toBe('敛微穷极');
    const yan = HERO_RECORDS['h631'];
    expect(yan.name).toBe('严颜');
    expect(yan.growthDefense).toBe(2.14);
    expect(yan.mainSkillName).toBe('断首何怒');
  });
});

describe('批量补入 · SP 卡（102xxx 段）', () => {
  it('SP徐庶 h534：SP 前缀命名 + sp 标签 + 空槽', () => {
    const r = HERO_RECORDS['h534'];
    expect(r.name).toBe('SP徐庶');
    expect(r.faction).toBe('蜀');
    expect(r.troopType).toBe('cavalry');
    expect(r.attackRange).toBe(1);
    expect(r.mainSkillName).toBe('破阵强袭');
    expect(r.mainSkillId).toBe('');
  });

  it('SP蔡文姬 h102011：与普通蔡文姬（未入库 · cost 2.0）区分', () => {
    const r = HERO_RECORDS['h102011'];
    expect(r.name).toBe('SP蔡文姬');
    expect(r.cost).toBe(2.5);
    expect(r.mainSkillName).toBe('胡笳离愁');
    expect(HERO_RECORDS['h102011'].mutualExclusionGroup).toBeNull();
  });

  it('SP张角 h102014：主战法黄天当立已实现 → 挂槽但成长率未确认 → 仍下架', () => {
    const r = HERO_RECORDS['h102014'];
    expect(r.name).toBe('SP张角');
    expect(r.mainSkillName).toBe('黄天当立');
    expect(r.mainSkillId).toBe('huangtian_dangli');
    expect(isHeroListed(r)).toBe(false); // OFFLINE_MAIN_SKILLS 命中
  });

  it('SP孙尚香 h102015 / SP祝融夫人 h102016：同名主战法已实现 → 上架', () => {
    const sx = HERO_RECORDS['h102015'];
    expect(sx.mainSkillId).toBe('xiaoji');
    expect(isHeroListed(sx)).toBe(true);
    const zr = HERO_RECORDS['h102016'];
    expect(zr.mainSkillId).toBe('huoshou_chongfeng');
    expect(isHeroListed(zr)).toBe(true);
  });
});

describe('批量补入 · XP 卡（season=XP，100xxx 段）', () => {
  it('XP孙权 h808：与普通孙权（sunquan，吴弓 COST3.0）区分且不互斥', () => {
    const r = HERO_RECORDS['h808'];
    expect(r.name).toBe('XP孙权');
    expect(r.cost).toBe(3.5);
    expect(r.mainSkillName).toBe('自擅江表');
    expect(r.mutualExclusionGroup).toBeNull();
    expect(HERO_RECORDS['sunquan'].mutualExclusionGroup).toBeNull();
    expect(isHeroListed(r)).toBe(false);
  });

  it('XP黄忠 h810 / XP陆逊 h791：面板抽样', () => {
    expect(HERO_RECORDS['h810'].growthAttack).toBe(2.51);
    expect(HERO_RECORDS['h810'].mainSkillName).toBe('万军取首');
    expect(HERO_RECORDS['h791'].faction).toBe('吴');
    expect(HERO_RECORDS['h791'].mainSkillName).toBe('疲兵沮意');
  });

  it('XP 卡一律空槽下架（主战法未实现）', () => {
    for (const id of ['h652', 'h653', 'h675', 'h684', 'h691', 'h784', 'h787', 'h788', 'h791', 'h792', 'h795', 'h800', 'h802', 'h808', 'h810', 'h815']) {
      const r = HERO_RECORDS[id];
      expect(r, `${id} 应已入库`).toBeTruthy();
      expect(r.name.startsWith('XP'), `${id} 应以 XP 前缀命名`).toBe(true);
      expect(r.mainSkillId, `${id} 应为空槽`).toBe('');
      expect(isHeroListed(r), `${id} 应下架`).toBe(false);
    }
  });
});

describe('批量补入 · 边界', () => {
  it('cost < 2.5 的官网五星只进候选表、不入引擎（SP甄洛 2.0 / SP周姬 2.0）', () => {
    expect(HERO_RECORDS['h102005']).toBeUndefined();
    expect(HERO_RECORDS['h102017']).toBeUndefined();
  });

  it('池内规模：入库后 ≥160 个武将', () => {
    expect(Object.keys(HERO_RECORDS).length).toBeGreaterThanOrEqual(160);
  });
});
