/**
 * 子站配将面板（`round-model.html` / `optimizer.html` / `battle-sim.html` 共用的
 * `teamConfig.renderConfigPanel`）——「武将选取 / 战法选取」下拉框的候选搜索。
 *
 * 口径（用户 2026-09-28）：候选太长（武将 158、可学战法 240+），靠滚动找一条很费劲 → 就地搜索过滤。
 *   · 搜索只作用于**当前下拉框自己的候选列表**；
 *   · 不改变原有的选取逻辑与已选值（不发 change、不回调 onChange、不改 cfg）；
 *   · 武将框与战法框行为一致（同一套分词 / 匹配 / 保留规则）。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCfg, HERO_OPTIONS, renderConfigPanel, SKILL_OPTIONS, SKILL_SLOTS, type ViewCfg } from '../web/teamConfig';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mount(cfg: ViewCfg, onChange?: () => void): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  renderConfigPanel(root, cfg, onChange ? { onChange } : {});
  return root;
}

function inputOf(root: HTMLElement, key: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(`[data-pick-input="${key}"]`);
  expect(el, `搜索框 ${key} 应存在`).toBeTruthy();
  return el!;
}

function selectOf(root: HTMLElement, key: string): HTMLSelectElement {
  const el = root.querySelector<HTMLSelectElement>(`[data-pick-select="${key}"]`);
  expect(el, `下拉框 ${key} 应存在`).toBeTruthy();
  return el!;
}

function labels(sel: HTMLSelectElement): string[] {
  return Array.from(sel.options).map((o) => o.textContent ?? '');
}

function selectedLabel(sel: HTMLSelectElement): string {
  return sel.selectedOptions[0]?.textContent ?? '';
}

/** 真正命中的候选（剔除「始终保留的已选项」） */
function hits(sel: HTMLSelectElement, keep: string): string[] {
  return labels(sel).filter((t) => t !== keep);
}

function hintOf(root: HTMLElement, key: string): string {
  return root.querySelector<HTMLElement>(`[data-pick-hint="${key}"]`)?.textContent ?? '';
}

function search(root: HTMLElement, key: string, v: string): void {
  const input = inputOf(root, key);
  input.value = v;
  input.dispatchEvent(new Event('input'));
}

describe('子站配将面板：武将 / 战法选取下拉框的候选搜索', () => {
  it('每个「武将选取 / 战法选取」下拉框都配了搜索框（两套一致）', () => {
    const root = mount(defaultCfg());
    const selects = Array.from(root.querySelectorAll<HTMLElement>('[data-pick-select]'));
    expect(selects).toHaveLength(3 * (1 + SKILL_SLOTS)); // 3 将 ×（武将 + 2 战法槽）
    for (const sel of selects) {
      const key = sel.dataset.pickSelect!;
      expect(inputOf(root, key), `${key} 应有搜索框`).toBeTruthy();
      expect(hintOf(root, key)).toBe(''); // 未搜索时不显示提示
    }
  });

  it('武将搜索只收窄候选：已选值与 cfg 不变，不触发 onChange', () => {
    const cfg = defaultCfg();
    cfg.slots[0].heroId = HERO_OPTIONS.find((o) => !o.label.includes('吕'))!.id;
    const onChange = vi.fn();
    const root = mount(cfg, onChange);
    const sel = selectOf(root, 'hero:0');
    const keep = selectedLabel(sel);
    expect(sel.value).toBe(cfg.slots[0].heroId);
    expect(labels(sel)).toHaveLength(HERO_OPTIONS.length);

    const heroIdBefore = cfg.slots[0].heroId;
    search(root, 'hero:0', '吕');

    const matched = hits(sel, keep);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThan(HERO_OPTIONS.length);
    expect(matched.every((t) => t.includes('吕'))).toBe(true);
    expect(labels(sel)).toContain(keep); // 已选项留在候选里（用户看得到当前是谁）
    expect(sel.value).toBe(heroIdBefore); // 已选值没被搜索改掉
    expect(cfg.slots[0].heroId).toBe(heroIdBefore);
    expect(onChange).not.toHaveBeenCalled();
    expect(hintOf(root, 'hero:0')).toBe(`${matched.length} 项匹配`);
  });

  it('武将搜索：拼音（lb → 刘备 / 吕布）、势力 + 兵种多关键词取交集、无命中给提示', () => {
    const root = mount(defaultCfg());
    const sel = selectOf(root, 'hero:0');
    const keep = selectedLabel(sel);

    search(root, 'hero:0', 'lb'); // 首字母串（主站武将池同口径）
    const py = hits(sel, keep);
    expect(py.length).toBeGreaterThan(0);
    expect(py.some((t) => t.includes('吕布') || t.includes('刘备'))).toBe(true);

    search(root, 'hero:0', '魏 骑'); // 空白分词 = AND
    const weiQi = hits(sel, keep);
    expect(weiQi.length).toBeGreaterThan(0);
    expect(weiQi.every((t) => t.includes('魏') && t.includes('骑'))).toBe(true);

    search(root, 'hero:0', '没有这个武将');
    expect(hits(sel, keep)).toHaveLength(0);
    expect(hintOf(root, 'hero:0')).toBe('无匹配');
    expect(sel.value).toBe(cfgHeroId(root)); // 无命中也不动已选值
  });

  it('战法搜索同样生效：「（空槽）」与已选战法始终保留（已选值不变）', () => {
    const cfg = defaultCfg();
    const root = mount(cfg);
    const sel = selectOf(root, 'skill:0-0');
    expect(sel.value).toBe('');
    expect(labels(sel)).toHaveLength(SKILL_OPTIONS.length + 1); // + 空槽项

    const sample = SKILL_OPTIONS.find((o) => o.label.includes('浑水'));
    expect(sample, '浑水摸鱼 应在可学战法池内').toBeTruthy();

    search(root, 'skill:0-0', '浑水');
    const shown = labels(sel);
    expect(shown).toContain('（空槽 1）'); // 空槽项不会因为搜索消失
    expect(shown).toContain(sample!.label);
    expect(shown.length).toBeLessThan(SKILL_OPTIONS.length + 1);
    expect(hits(sel, '（空槽 1）').every((t) => t.includes('浑水'))).toBe(true);
    expect(sel.value).toBe(''); // 已选值不变
    expect(cfg.slots[0].skillIds).toEqual([]);
  });

  it('清空关键词即恢复完整候选（顺序与原列表一字不差）', () => {
    const root = mount(defaultCfg());
    const sel = selectOf(root, 'skill:0-0');
    const full = labels(sel);
    search(root, 'skill:0-0', '准备');
    expect(labels(sel).length).toBeLessThan(full.length);
    search(root, 'skill:0-0', '');
    expect(labels(sel)).toEqual(full);
    expect(hintOf(root, 'skill:0-0')).toBe('');
  });

  it('带搜索词时选取照旧生效（走原来的 change 路径写回 cfg）', () => {
    const cfg = defaultCfg();
    const onChange = vi.fn();
    const root = mount(cfg, onChange);
    search(root, 'skill:0-0', '浑水');

    const sel = selectOf(root, 'skill:0-0');
    const pick = Array.from(sel.options).find((o) => o.value !== '')!;
    expect(pick.textContent).toContain('浑水');
    sel.value = pick.value;
    sel.dispatchEvent(new Event('change'));

    expect(cfg.slots[0].skillIds).toEqual([pick.value]);
    expect(onChange).toHaveBeenCalled();
  });

  it('面板重渲染（改等级 / 换将）后搜索词与过滤保持；换 cfg（L4 切对手）则清零', () => {
    const cfg = defaultCfg();
    const root = mount(cfg);
    const sel = selectOf(root, 'hero:0');
    const keep = selectedLabel(sel);
    search(root, 'hero:0', '吕');
    const filtered = hits(sel, keep).length;

    // 改等级 → 面板内部重渲染（同一个 cfg 对象）
    const level = root.querySelector<HTMLInputElement>('[data-unit-level="0"]')!;
    level.value = '45';
    level.dispatchEvent(new Event('change'));

    expect(inputOf(root, 'hero:0').value).toBe('吕'); // 搜索词不丢
    expect(hits(selectOf(root, 'hero:0'), keep).length).toBe(filtered); // 过滤状态恢复

    // 换 cfg = 换逻辑面板（battle-sim 切对手）→ 搜索词清零、候选回到全量
    renderConfigPanel(root, defaultCfg());
    expect(inputOf(root, 'hero:0').value).toBe('');
    expect(labels(selectOf(root, 'hero:0'))).toHaveLength(HERO_OPTIONS.length);
  });

  it('Esc 清空搜索词并恢复候选，已选值不变', () => {
    const cfg = defaultCfg();
    const root = mount(cfg);
    const sel = selectOf(root, 'hero:0');
    const before = sel.value;
    search(root, 'hero:0', '吕');

    const input = inputOf(root, 'hero:0');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(input.value).toBe('');
    expect(labels(sel)).toHaveLength(HERO_OPTIONS.length);
    expect(sel.value).toBe(before);
  });

  it('同页两个面板（battle-sim 我方 / 对手）的搜索互不影响', () => {
    const mine = document.createElement('div');
    const opp = document.createElement('div');
    document.body.append(mine, opp);
    renderConfigPanel(mine, defaultCfg());
    renderConfigPanel(opp, defaultCfg());

    search(mine, 'hero:0', '吕');
    expect(inputOf(opp, 'hero:0').value).toBe('');
    expect(labels(selectOf(opp, 'hero:0'))).toHaveLength(HERO_OPTIONS.length);
  });
});

/** 面板第一个下拉框的当前选中武将 id（无命中断言用） */
function cfgHeroId(root: HTMLElement): string {
  return selectOf(root, 'hero:0').value;
}
