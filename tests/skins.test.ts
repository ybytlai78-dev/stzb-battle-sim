import { describe, it, expect } from 'vitest';
import { skinsOf, hasSkins, activeSkinId, setActiveSkin, currentSkin, skinPosterSrc } from '../web/skins';

describe('武将皮肤外观（web/skins.ts）', () => {
  it('群吕布有四项：默认 + 成就·吕布 / 鬼神无双 / 甲辰新春·龙蟠虎踞', () => {
    const list = skinsOf('h479');
    expect(list.length).toBe(4);
    expect(list[0].id).toBe('default');
    expect(list.map((s) => s.id)).toEqual(['default', 'chengjiu', 'guishen', 'longpan']);
    expect(list[1]).toMatchObject({ id: 'chengjiu', name: '成就·吕布', cost: 1000 });
    expect(list[2]).toMatchObject({ id: 'guishen', name: '鬼神无双', cost: 900 });
    expect(list[3]).toMatchObject({ id: 'longpan', name: '甲辰新春·龙蟠虎踞', cost: 600 });
  });

  it('三套皮肤都有动态段；鬼神无双另有独立 CG', () => {
    const [, cj, gs, lp] = skinsOf('h479');
    expect(cj.loop).toContain('/skins/h479_1_loop.webm');
    expect(cj.small).toContain('/skins/h479_1_small.webm');
    expect(lp.loop).toContain('/skins/h479_2_loop.webm');
    expect(lp.small).toContain('/skins/h479_2_small.webm');
    expect(gs.poster).toContain('/skins/h479_3_poster.webp');
    expect(gs.loop).toContain('/skins/h479_3_loop.webm');
    expect(gs.small).toContain('/skins/h479_3_small.webm');
    expect(gs.cg).toContain('/skins/h479_3_cg.webm');
    // 只有鬼神无双带 CG，另两套不该凭空多出文件
    expect(cj.cg).toBe('');
    expect(lp.cg).toBe('');
  });

  it('皮肤素材必须带 ?v= 指纹（否则换素材后老访客看旧图）', () => {
    const s = skinsOf('h479')[1];
    expect(s.poster).toContain('/skins/h479_1_poster.webp');
    expect(s.loop).toContain('/skins/h479_1_loop.webm');
    expect(s.poster).toContain('v=');
    expect(s.loop).toContain('v=');
  });

  it('默认项是静态立绘，不带视频', () => {
    const def = skinsOf('h479')[0];
    expect(def.loop).toBe('');
    expect(def.intro).toBe('');
    expect(def.poster).toContain('/portraits/');
  });

  it('没有皮肤的武将只有「默认」一项，入口仍可打开', () => {
    expect(hasSkins('h3')).toBe(false);
    expect(skinsOf('h3').length).toBe(1);
    expect(currentSkin('h3').id).toBe('default');
  });

  it('无 localStorage（node 环境）时退回默认，不抛错', () => {
    expect(activeSkinId('h479')).toBe('default');
    expect(skinPosterSrc('h479')).toBe('');
    expect(() => setActiveSkin('h479', 'chengjiu')).not.toThrow();
  });
});
