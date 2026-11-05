/** @vitest-environment jsdom */
/**
 * 预设面板（jsdom）：左列「热门预设 / 我的预设」**切换**（一次只看一组、切换器带条数）、
 * 内置条目**不可改名 / 删除**、保存 / 另存为之后自动切到「我的预设」并选中新条目、
 * 老调用方（不注入内置层）向后兼容。数据层用例见 `tests/hot_presets.test.ts`；内置层本体见 `web/hotPresets.ts`。
 *
 * 用户口径：2026-10-16「预设」改名「热门预设」+ 固定一批热门队伍；
 * 2026-11-05 再改回「预设」，两组改成可切换（默认热门，搜索只作用于当前这一组）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPresetPanel, type PresetActionResult, type PresetPanelDeps } from '../web/presetPanel';
import { HERO_RECORDS } from '../web/heroes';
import { hotVersion } from '../web/hotPresets';
import { PRESET_MAX, type TeamPreset, type TeamSide } from '../web/presetStore';
import type { SlotState } from '../web/teamEditor';

/** 真实武将 id（面板详情要用真实档案渲染） */
const HERO_IDS = Object.keys(HERO_RECORDS).slice(0, 3);

const slot = (heroId: string | null): SlotState => ({
  heroId,
  extraSkillIds: [],
  freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
  redness: 0,
  level: 40,
  treasure: null,
});

const team = (id: string, name: string, no: number, side: TeamSide = 'red'): TeamPreset => ({
  id,
  no,
  name,
  side,
  slots: HERO_IDS.map((h) => slot(h)),
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

const HOT = team('hot-a', '内置热门队', 0);
const MINE = team('p_mine_1', '我的队伍', 1);

/** 挂面板：只覆盖用例关心的依赖，其余给空实现 */
function mount(opts: Partial<PresetPanelDeps> = {}): void {
  const ok = (): PresetActionResult => ({ presetId: 'p_new_1' });
  openPresetPanel({
    getPresets: () => [],
    saveCurrent: vi.fn(ok),
    saveAsMine: vi.fn(ok),
    apply: vi.fn(),
    rename: vi.fn(ok),
    remove: vi.fn(),
    ...opts,
  });
}

const texts = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').trim());
const actions = (): string[] => texts('.pd-actions .btn');
const itemNames = (): string[] => texts('.preset-item .pi-name');
const itemCount = (): number => document.querySelectorAll('.preset-item').length;
/** 当前看的是哪一组（切换器上的 .on） */
const tabOf = (): string | undefined => (document.querySelector('.preset-tab.on') as HTMLElement | null)?.dataset.tab;
const switchTo = (tab: 'hot' | 'mine'): void => (document.querySelector(`.preset-tab[data-tab="${tab}"]`) as HTMLElement).click();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('预设面板 · 来源切换', () => {
  it('默认看「热门预设」：切换器带两组条数，列表只列热门那一条', () => {
    mount({ getHotPresets: () => [HOT], getPresets: () => [MINE] });
    expect(texts('.preset-tab')).toEqual(['热门预设1', '我的预设1']);
    expect(tabOf()).toBe('hot');
    expect(itemNames()).toEqual([HOT.name]);
    expect(texts('.preset-item .pi-tag')).toEqual(['热门']);
    expect(texts('.preset-item .pi-no')).toEqual([]);
    expect(texts('.preset-count')).toEqual(['热门预设 1 条']);
  });

  it('切到「我的预设」→ 列表与详情都跟着换，动作为重命名 / 删除', () => {
    mount({ getHotPresets: () => [HOT], getPresets: () => [MINE] });
    switchTo('mine');
    expect(tabOf()).toBe('mine');
    expect(itemNames()).toEqual([MINE.name]);
    expect(texts('.preset-item .pi-no')).toEqual(['#1']);
    expect(texts('.preset-count')).toEqual([`我的预设 1 / ${PRESET_MAX} 条`]);
    expect(texts('.preset-detail .pd-title')).toEqual([MINE.name]);
    expect(actions()).toEqual(['上场到红队', '上场到蓝队', '重命名', '删除']);
  });

  it('搜索只作用于当前这一组（热门搜不到，切过去才命中）', () => {
    mount({ getHotPresets: () => [HOT], getPresets: () => [MINE] });
    const search = document.querySelector('.preset-search') as HTMLInputElement;
    search.value = '我的队伍';
    search.dispatchEvent(new Event('input'));
    expect(itemCount()).toBe(0);
    expect(texts('.preset-count')).toEqual(['筛选出 0 / 1 条']);
    expect(tabOf()).toBe('hot');
    switchTo('mine');
    expect(itemNames()).toEqual([MINE.name]);
    expect(texts('.preset-detail .pd-title')).toEqual([MINE.name]);
  });

  it('「保存红队」存成功后自动切到「我的预设」并选中新条目', () => {
    const store: TeamPreset[] = [];
    const saveCurrent = vi.fn((_side: TeamSide, name: string): PresetActionResult => {
      const created = team('p_new_1', name, 1);
      store.push(created);
      return { presetId: created.id };
    });
    mount({ getHotPresets: () => [HOT], getPresets: () => store, saveCurrent });
    (document.querySelector('.preset-save[data-side="red"]') as HTMLElement).click();
    const input = document.querySelector<HTMLInputElement>('.preset-name-modal .pn-input') as HTMLInputElement;
    input.value = '新存的队';
    (document.querySelector('.preset-name-modal .pn-ok') as HTMLElement).click();
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(tabOf()).toBe('mine');
    expect(itemNames()).toEqual(['新存的队']);
    expect(texts('.preset-detail .pd-title')).toEqual(['新存的队']);
  });

  it('内置条目只能上场 / 另存为——没有改名与删除', () => {
    mount({ getHotPresets: () => [HOT], getPresets: () => [MINE] });
    expect(texts('.preset-detail .pd-title')).toEqual([HOT.name]);
    expect(texts('.preset-detail .pd-time')).toEqual([`内置热门预设 · 版本 ${hotVersion()}`]);
    expect(actions()).toEqual(['上场到红队', '上场到蓝队', '另存为我的预设']);
  });

  it('「另存为我的预设」写进用户层，并把面板切到「我的预设」', () => {
    const store: TeamPreset[] = [];
    const saveAsMine = vi.fn((_preset: TeamPreset, name: string): PresetActionResult => {
      const created = team('p_new_1', name, 1);
      store.push(created);
      return { presetId: created.id };
    });
    mount({ getHotPresets: () => [HOT], getPresets: () => store, saveAsMine });
    (document.querySelector('[data-act="copy"]') as HTMLElement).click();
    const input = document.querySelector<HTMLInputElement>('.preset-name-modal .pn-input') as HTMLInputElement;
    expect(input.value).toBe(HOT.name);
    input.value = '我的热门副本';
    (document.querySelector('.preset-name-modal .pn-ok') as HTMLElement).click();
    expect(saveAsMine).toHaveBeenCalledTimes(1);
    expect(saveAsMine.mock.calls[0][0]).toBe(HOT);
    expect(saveAsMine.mock.calls[0][1]).toBe('我的热门副本');
    expect(document.querySelector('.preset-name-modal')).toBeNull();
    expect(tabOf()).toBe('mine');
    expect(texts('.preset-detail .pd-title')).toEqual(['我的热门副本']);
  });

  it('不注入内置层（老调用方）→ 切换器隐藏，只剩「我的预设」', () => {
    mount({ getPresets: () => [MINE] });
    expect((document.querySelector('.preset-tabs') as HTMLElement).hidden).toBe(true);
    expect(itemNames()).toEqual([MINE.name]);
    expect(texts('.preset-count')).toEqual([`我的预设 1 / ${PRESET_MAX} 条`]);
    expect(actions()).toEqual(['上场到红队', '上场到蓝队', '重命名', '删除']);
  });
});
