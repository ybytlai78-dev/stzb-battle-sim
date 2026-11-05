import { describe, expect, it } from 'vitest';
import {
  COUNTRY,
  DIV_ALL_ATTR,
  DIV_PERCENT_FIX,
  DIV_SKILL_REF,
  DIV_DAMAGE_RATE,
  DIV_STAT_POINT,
  DIV_FLAG,
  DIV_HUGE,
  DIV_UNRESOLVED,
  TROOP,
  convertDetail,
  heroCost,
  heroStar,
  pkgRef,
  rate,
  renderHeroDoc,
  renderMechanismDoc,
  renderSkillDoc,
  renderSlot,
  stat,
} from '../scripts/rag/render.mts';

/**
 * 换算分域的锚点全部来自仓库已自证口径
 * （`docs/逆向对拍/对拍结论摘要.md` + AGENTS.md「举义诛暴」小节）。
 * 这些数字一旦漂移，diff 的每一行差异都不可信 —— 故逐条锁死。
 */
describe('convertDetail：三个已自证分域', () => {
  it('全属性百分比（魏武之世 四维 −15%，成长 0.045/点）', () => {
    const c = convertDetail(11_400_000, 9_000_000);
    expect(c.division).toBe(DIV_ALL_ATTR);
    expect(c.value).toBeCloseTo(15.0, 6);
    expect(c.growth).toBeCloseTo(0.045, 6);
  });

  it('百分点域（同仇敌忾 子技能 22300601 = 1/3 → 2.2%，成长 0.015/点）', () => {
    const c = convertDetail(1, 3, 531);
    expect(c.division).toBe(DIV_PERCENT_FIX);
    expect(c.value).toBeCloseTo(2.2, 6);
    expect(c.growth).toBeCloseTo(0.015, 6);
  });

  it('百分点域（金匮要略 减伤槽 20077301 = 10/26 → 20.4%，成长 0.13/点）', () => {
    const c = convertDetail(10, 26, 522);
    expect(c.division).toBe(DIV_PERCENT_FIX);
    expect(c.value).toBeCloseTo(20.4, 6);
    expect(c.growth).toBeCloseTo(0.13, 6);
  });

  it('百分点域（金匮要略 急救槽 20077303 = 20/150 → 恢复率 80%，成长 0.75/点，与引擎 healRate/healGrowthRate 逐位吻合）', () => {
    const c = convertDetail(20, 150, 401);
    expect(c.division).toBe(DIV_PERCENT_FIX);
    expect(c.value).toBeCloseTo(80, 6);
    expect(c.growth).toBeCloseTo(0.75, 6);
  });

  it('属性点域（衣带密诏 20000101 = 1000/2200 → 攻击 +18.8 点，文案无 %）', () => {
    const c = convertDetail(1000, 2200, 101);
    expect(c.division).toBe(DIV_STAT_POINT);
    expect(c.value).toBeCloseTo(18.8, 6);
    expect(c.growth).toBeCloseTo(0.11, 6);
  });

  it('属性点域（算无遗策 20001101 = 1000/3000 → 攻谋 −22 点）', () => {
    const c = convertDetail(1000, 3000, 201);
    expect(c.division).toBe(DIV_STAT_POINT);
    expect(c.value).toBeCloseTo(22, 6);
    expect(c.growth).toBeCloseTo(0.15, 6);
  });

  it('全属性百分比（魏武之世 20002301 = 11,400,000/9,000,000 → 15.0%，成长 0.045/点）', () => {
    const c = convertDetail(11_400_000, 9_000_000, 201);
    expect(c.division).toBe(DIV_ALL_ATTR);
    expect(c.value).toBeCloseTo(15.0, 6);
    expect(c.growth).toBeCloseTo(0.045, 6);
  });

  it('未登记机制一律 unresolved，不猜（哪怕数值看起来正常）', () => {
    const c = convertDetail(30, 0, 9999);
    expect(c.division).toBe(DIV_UNRESOLVED);
    expect(c.value).toBe(30);
  });
});

describe('包内已钉死口径的端到端回归（参数取自 tb_cfg_skill_detail 真实行）', () => {
  it('举义诛暴 20028701 = damage-rate 150%（c=150/i=0，文案「伤害率#effect_01#%」）', () => {
    const c = convertDetail(150, 0, 301);
    expect(c.division).toBe(DIV_DAMAGE_RATE);
    expect(c.value).toBe(150);
  });

  it('带 intel 的伤害率按 c+0.4i 算：楚歌四起 20013001（304，25/255）= 127%，不是 25%', () => {
    // 这条守的是分域口径的坑：301 的 intel 恒 0（480 条全查过），302/304/305/306 则几乎全带 intel，
    // 早前一刀切「伤害率 = constant_param」会把妖术/恐慌/燃烧/策略伤害全部低估。
    const chuge = convertDetail(25, 255, 304);
    expect(chuge.division).toBe(DIV_DAMAGE_RATE);
    expect(chuge.value).toBeCloseTo(127, 6);
    expect(chuge.growth).toBeCloseTo(1.275, 6);

    const celue = convertDetail(35, 125, 302);
    expect(celue.value).toBeCloseTo(85, 6);
    expect(celue.growth).toBeCloseTo(0.625, 6);

    // 攻击伤害 301 的 intel 恒 0，公式退化成 constant_param 本身
    expect(convertDetail(115, 0, 301).value).toBe(115);
  });

  it('举义诛暴 20028702-05 = 四维各 −5.0%，成长 0.015/点（AGENTS.md「举义诛暴」小节逐位一致）', () => {
    for (const effectId of [201, 202, 203, 204]) {
      const c = convertDetail(3_800_000, 3_000_000, effectId);
      expect(c.division).toBe(DIV_ALL_ATTR);
      expect(c.value).toBeCloseTo(5.0, 6);
      expect(c.growth).toBeCloseTo(0.015, 6);
    }
  });

  it('举义诛暴 20028706 = skill-ref 210287（子技能引用，不是数值）', () => {
    const c = convertDetail(210287, 0, 123);
    expect(c.division).toBe(DIV_SKILL_REF);
    expect(c.value).toBe(210287);
  });

  it('开关型机制（152 移除效果 / 515 无视规避 / 713 预备镇静）不产生数字', () => {
    for (const effectId of [152, 515, 713]) {
      const c = convertDetail(0, 0, effectId);
      expect(c.division).toBe(DIV_FLAG);
      expect(c.value).toBe(0);
    }
  });
});

describe('枚举与单位换算（由 154/170 数值指纹对齐反推，0 冲突）', () => {
  it('星级 = quality + 1（锚点：100042 曹操四星·献刀七星 quality=3）', () => {
    expect(heroStar(3)).toBe(4);
    expect(heroStar(4)).toBe(5);
  });

  it('势力 / 兵种枚举', () => {
    expect(COUNTRY).toEqual({ 1: '汉', 2: '魏', 3: '蜀', 4: '吴', 5: '群', 6: '晋' });
    expect(TROOP).toEqual({ 1: '弓', 2: '步', 3: '骑' });
  });

  it('面板值 ÷100（包内 9900 → 99.0）', () => {
    expect(stat(9900)).toBe(99);
    expect(stat(148)).toBe(1.48);
    // 发动率字段本身就是百分数：举义诛暴 probability_max=40 → 40%
    expect(rate(40)).toBe(40);
    // 统率 ×10：曹操 100804 cost=25 → 2.5；≥100 是占位
    expect(heroCost(25)).toEqual({ value: 2.5, placeholder: false });
    expect(heroCost(200)).toEqual({ value: 200, placeholder: true });
  });
});

describe('renderSlot：每个数字带回原始坐标', () => {
  const effectName = (id: number) => (id === 101 ? '休整' : `effect-${id}`);

  it('可换算槽位给出百分比 + 分域 + @pkg 坐标', () => {
    const line = renderSlot(
      { detail_id: 20077301, effect_id: 522, constant_param: 10, intel_param: 26, available_round: 3 },
      effectName(522)
    );
    expect(line).toContain('槽 20077301');
    expect(line).toContain('机制 522 effect-522');
    expect(line).toContain('值 20.4%');
    expect(line).toContain('成长 0.130%/点');
    expect(line).toContain(DIV_PERCENT_FIX);
    expect(line).toContain('持续 3 回合');
    expect(line).toContain('@pkg:tb_cfg_skill_detail/20077301');
  });

  it('「大幅度」哨兵值（const=9000）标 huge-modifier，不谎称 9000%', () => {
    const line = renderSlot(
      { detail_id: 21081601, effect_id: 522, constant_param: 9000, intel_param: 0 },
      effectName(522)
    );
    expect(line).toContain(DIV_HUGE);
    expect(line).toContain('大幅');
    expect(line).not.toContain('9000.0%');
  });

  it('未定分域显式标注原始值，不输出换算结果', () => {
    const line = renderSlot(
      { detail_id: 20000901, effect_id: 9999, constant_param: 30, intel_param: 0 },
      effectName(9999)
    );
    expect(line).toContain(DIV_UNRESOLVED);
    expect(line).toContain('constant_param=30');
    expect(line).not.toContain('成长');
  });
});

describe('文档渲染', () => {
  it('武将文档带势力 / 星级 / 兵种 / 面板 / 主战法指针', () => {
    const doc = renderHeroDoc({
      heroid: 100804,
      name: '汉·曹操',
      country: 1,
      quality: 4,
      hero_type: 3,
      hit_range: 3,
      cost: 25,
      skill_init: 200287,
      attack_base: 7600,
      defence_base: 8800,
      intel_base: 7200,
      speed_base: 7800,
      destroy_base: 1000,
      attack_grow: 148,
      defence_grow: 232,
      intel_grow: 138,
      speed_grow: 116,
      destroy_grow: 50,
      hero_type_availible: [3, 2],
    });
    expect(doc.docId).toBe('hero:100804');
    expect(doc.kind).toBe('hero');
    expect(doc.tier).toBe('package');
    expect(doc.body).toContain('势力 汉｜5 星｜兵种 骑｜攻击距离 3');
    expect(doc.body).toContain('统率消耗 2.5');
    expect(doc.body).toContain('| 攻击 | 76 | 1.48 |');
    expect(doc.body).toContain('skill:200287');
    expect(doc.body).toContain(pkgRef('tb_cfg_hero', '100804'));
    expect(doc.facets).toMatchObject({ star: 5, country: 1, troop: 3, mainSkillId: 200287 });
  });

  it('战法文档把槽位拼进正文，且槽位 id 进 facets 供 diff 直查', () => {
    const doc = renderSkillDoc(
      {
        skill_id: 200287,
        name: '举义诛暴',
        skill_quality_level: 'A',
        hit_range: 5,
        prepare: 0,
        probability_max: 40,
        skill_type: 3,
        description: '对敌军群体发动150.0%攻击伤害',
        brief_description: '',
      },
      [
        { detail_id: 20028701, effect_id: 522, constant_param: 9000, intel_param: 0 },
        { detail_id: 20028702, effect_id: 501, constant_param: 150, intel_param: 0 },
      ],
      (id) => `effect-${id}`,
      [522, 501]
    );
    expect(doc.docId).toBe('skill:200287');
    expect(doc.body).toContain('战法类型 主动');
    expect(doc.body).toContain('瞬发');
    expect(doc.body).toContain('发动率 40%');
    expect(doc.body).toContain('槽 20028701');
    expect(doc.body).toContain('槽 20028702');
    expect(doc.body).toContain('机制码（tb_cfg_skill_effect_map）：522;501');
    expect(doc.facets).toMatchObject({ quality: 'A', range: 5, prepare: false, effectCodes: [522, 501] });
    expect(doc.facets.slotIds).toEqual([20028701, 20028702]);
  });

  it('机制文档带 replace_type 冲突分类', () => {
    const doc = renderMechanismDoc(
      { effect_id: 522, name: '受攻击伤害降低', tips: '受到攻击伤害降低', replace_type: 2, value_type: 1, buff_type: 2, virtual: 0, show_priority: 0 },
      ['举义诛暴', '磐阵善守']
    );
    expect(doc.docId).toBe('mechanism:522');
    expect(doc.body).toContain('replace_type = 2');
    expect(doc.body).toContain('磐阵善守');
    expect(doc.facets).toMatchObject({ replaceType: 2 });
  });
});
