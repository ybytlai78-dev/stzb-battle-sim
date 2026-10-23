/** @vitest-environment jsdom */
/**
 * 热门预设面板（jsdom）：内置固定层与「我的预设」分区渲染、内置条目**不可改名 / 删除**、
 * 「另存为我的预设」把内置条目交给用户层、老调用方（不注入内置层）向后兼容。
 * 数据层用例见 `tests/hot_presets.test.ts`；内置层本体见 `web/hotPresets.ts`。
 *
 * 用户口径 2026-10-16：「预设」改名「热门预设」+ 固定一批热门队伍；自己加预设的功能保持不变。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPresetPanel, type PresetActionResult, type PresetPanelDeps } from '../web/presetPanel';
import { HERO_RECORDS } from '../web/heroes';
import { hotVersion } from '../web/hotPresets';
import { PRESET_MAX, type TeamPreset } from '../web/presetStore';
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

const team = (id: string, name: string, no: number): TeamPreset => ({
  id,
  no,
  name,
  side: 'red',
  slots: HERO_IDS.map((h) => slot(h)),
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

const HOT = team('hot-a', '内置热门队', 0);
const MINE = team('p_mine_1', '我的队伍', 1);

function mount(opts: { hot?: TeamPreset[]; mine?: TeamPreset[]; saveAsMine?: PresetPanelDeps['saveAsMine'] } = {}): void {
  const ok = (): PresetActionResult => ({ presetId: 'p_new_1' });
  openPresetPanel({
    getPresets: () => opts.mine ?? [],
    getHotPresets: () => opts.hot ?? [],
    saveCurrent: vi.fn(ok),
    saveAsMine: opts.saveAsMine ?? vi.fn(ok),
    apply: vi.fn(),
    rename: vi.fn(ok),
    remove: vi.fn(),
  });
}

const texts = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').trim());
const actions = (): string[] => texts('.pd-actions .btn');
/** 选左列表第 `i` 条（0 = 第一条热门） */
const pick = (i: number): void => (document.querySelectorAll<HTMLElement>('.preset-item')[i] as HTMLElement).click();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('热门预设面板', () => {
  it('分两组渲染：内置层在前、带「热门」标签且不编号', () => {
    mount({ hot: [HOT], mine: [MINE] });
    expect(texts('.preset-group')).toEqual(['热门预设 · 1', '我的预设 · 1']);
    expect(texts('.preset-item .pi-tag')).toEqual(['热门']);
    expect(texts('.preset-item .pi-no')).toEqual(['#1']);
    expect(texts('.preset-count')).toEqual([`热门 1 条 · 我的 1 / ${PRESET_MAX} 条`]);
  });

  it('默认选中第一条热门，动作只有上场 / 另存为——没有改名与删除', () => {
    mount({ hot: [HOT], mine: [MINE] });
    expect(texts('.preset-detail .pd-title')).toEqual([HOT.name]);
    expect(texts('.preset-detail .pd-time')).toEqual([`内置热门预设 · 版本 ${hotVersion()}`]);
    expect(actions()).toEqual(['上场到红队', '上场到蓝队', '另存为我的预设']);
  });

  it('用户预设的动作与时间戳照旧（内置层不影响用户层）', () => {
    mount({ hot: [HOT], mine: [MINE] });
    pick(1);
    expect(actions()).toEqual(['上场到红队', '上场到蓝队', '重命名', '删除']);
    expect(texts('.preset-detail .pd-time')[0]).toMatch(/^保存 \d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('「另存为我的预设」把内置条目交给 saveAsMine（名字可改）', () => {
    const saveAsMine = vi.fn((_preset: TeamPreset, _name: string): PresetActionResult => ({ presetId: 'p_new_1' }));
    mount({ hot: [HOT], saveAsMine });
    (document.querySelector('[data-act="copy"]') as HTMLElement).click();
    const input = document.querySelector<HTMLInputElement>('.preset-name-modal .pn-input') as HTMLInputElement;
    expect(input.value).toBe(HOT.name);
    input.value = '我的热门副本';
    (document.querySelector('.preset-name-modal .pn-ok') as HTMLElement).click();
    expect(saveAsMine).toHaveBeenCalledTimes(1);
    expect(saveAsMine.mock.calls[0][0]).toBe(HOT);
    expect(saveAsMine.mock.calls[0][1]).toBe('我的热门副本');
    expect(document.querySelector('.preset-name-modal')).toBeNull();
  });

  it('不注入内置层时只剩「我的预设」分组（老调用方向后兼容）', () => {
    openPresetPanel({
      getPresets: () => [MINE],
      saveCurrent: vi.fn(() => ({ presetId: 'x' })),
      apply: vi.fn(),
      rename: vi.fn(() => ({ presetId: 'x' })),
      remove: vi.fn(),
    });
    expect(texts('.preset-group')).toEqual(['我的预设 · 1']);
    expect(actions()).toEqual(['上场到红队', '上场到蓝队', '重命名', '删除']);
  });
});
