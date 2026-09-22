/**
 * 武将池视图状态跨重渲染保持（jsdom）。
 *
 * 拖拽入队 / 队内换位 / 卸下都会 `refresh()` 重建整个配将区（主站 `renderTeamEditor`、
 * 实验室 `refreshPool` 同理），池子节点连同筛选栏、搜索框一起换新。
 * 因此筛选（势力/兵种）与搜索词是**模块级**状态，重建后必须原样恢复——
 * 用户场景：筛出「魏 + 骑」拖张辽入队，回来还得是「魏 + 骑」（用户 2026-09-22）。
 * 池内「重置」一次性清空两者。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyEditor,
  emptySlot,
  renderHeroPool,
  resetHeroPoolView,
  type EditorHandlers,
  type EditorState,
} from '../web/teamEditor';
import { HEROES } from '../web/heroes';

/** 池子最简 handlers：只实现放将/移除，其余空转 */
function makeHandlers(state: EditorState): EditorHandlers {
  return {
    onPickHero(team, idx, heroId) {
      state[team][idx] = { ...emptySlot(), heroId };
    },
    onMoveSlot() {},
    onAddSkill() {},
    onRemoveSkill() {},
    onSetFreePoints() {},
    onSetRedness() {},
    onSetLevel() {},
    onSetSecondaryTroop() {},
    onSetSecondaryTrait() {},
    onSetTreasure() {},
    onRemoveHero(team, idx) {
      state[team][idx] = emptySlot();
    },
    onClearTeam(team) {
      state[team] = [emptySlot(), emptySlot(), emptySlot()];
    },
  };
}

/** 挂载池子＝模拟一次重渲染（每次 refresh 都是新建节点，模块级状态应当活下来） */
function mount(): { pool: HTMLElement; input: HTMLInputElement } {
  document.body.innerHTML = '';
  const state = emptyEditor();
  const pool = renderHeroPool(state, makeHandlers(state));
  document.body.appendChild(pool);
  return { pool, input: pool.querySelector('.toolbar input') as HTMLInputElement };
}

function cards(pool: HTMLElement): HTMLElement[] {
  return Array.from(pool.querySelectorAll('.hero-card')) as HTMLElement[];
}

function tag(pool: HTMLElement, v: string): HTMLElement {
  const el = Array.from(pool.querySelectorAll('.filter-tag')).find(
    (t) => (t as HTMLElement).dataset.v === v
  ) as HTMLElement | undefined;
  expect(el, `筛选 tag「${v}」应存在`).toBeTruthy();
  return el!;
}

/** 当前高亮的筛选 tag 值（按 DOM 顺序） */
function onTags(pool: HTMLElement): string[] {
  return Array.from(pool.querySelectorAll('.filter-tag.on')).map((t) => (t as HTMLElement).dataset.v!);
}

/** 势力图标（img.fac 的 data-faction）+ 兵种小字 */
function factionOf(c: HTMLElement): string {
  return (c.querySelector('img.fac') as HTMLElement).dataset.faction!;
}
function troopOf(c: HTMLElement): string {
  return c.querySelector('.bar .troop')!.textContent!;
}
function nameOf(c: HTMLElement): string {
  return c.querySelector('.n')!.textContent!.trim();
}

function typeQuery(input: HTMLInputElement, v: string): void {
  input.value = v;
  input.dispatchEvent(new Event('input'));
}

beforeEach(() => {
  resetHeroPoolView();
});

describe('武将池筛选/搜索跨重渲染保持', () => {
  it('筛「魏 + 骑」→ 重建池子后仍是魏骑（拖张辽入队后不用重筛）', () => {
    const first = mount();
    expect(cards(first.pool).length).toBe(HEROES.length);

    tag(first.pool, '魏').click();
    tag(first.pool, '骑').click();
    const weiCav = cards(first.pool);
    expect(weiCav.length).toBeGreaterThan(0);
    expect(weiCav.every((c) => factionOf(c) === '魏' && troopOf(c) === '骑')).toBe(true);
    expect(weiCav.some((c) => nameOf(c).includes('张辽'))).toBe(true); // 魏骑代表

    // 拖拽入队 → refresh 重建池子
    const again = mount();
    expect(onTags(again.pool).sort()).toEqual(['骑', '魏']); // 高亮恢复
    expect(cards(again.pool).length).toBe(weiCav.length);
    expect(cards(again.pool).every((c) => factionOf(c) === '魏' && troopOf(c) === '骑')).toBe(true);
  });

  it('搜索词跨重渲染保持（并继续与筛选取交集）', () => {
    const first = mount();
    typeQuery(first.input, '张');
    const zhang = cards(first.pool);
    expect(zhang.length).toBeGreaterThan(0);
    expect(zhang.length).toBeLessThan(HEROES.length);
    expect(zhang.every((c) => nameOf(c).includes('张'))).toBe(true);

    const again = mount();
    expect(again.input.value).toBe('张'); // 搜索框内容不回退成空
    expect(cards(again.pool).length).toBe(zhang.length);

    // 再叠一个势力筛选：两维同时生效，且照样跨重渲染保持
    tag(again.pool, '魏').click();
    const weiZhang = cards(again.pool);
    expect(weiZhang.length).toBeGreaterThan(0);
    expect(weiZhang.every((c) => nameOf(c).includes('张') && factionOf(c) === '魏')).toBe(true);

    const third = mount();
    expect(third.input.value).toBe('张');
    expect(onTags(third.pool)).toEqual(['魏']);
    expect(cards(third.pool).length).toBe(weiZhang.length);
  });

  it('「重置」清空筛选与搜索词，且不留残留（重建后仍是干净池子）', () => {
    const { pool, input } = mount();
    tag(pool, '魏').click();
    tag(pool, '骑').click();
    typeQuery(input, '张');
    expect(cards(pool).length).toBeLessThan(HEROES.length);

    (pool.querySelector('.hf-reset') as HTMLElement).click();
    expect(onTags(pool)).toEqual([]);
    expect(input.value).toBe('');
    expect(cards(pool).length).toBe(HEROES.length);

    const again = mount();
    expect(onTags(again.pool)).toEqual([]);
    expect(again.input.value).toBe('');
    expect(cards(again.pool).length).toBe(HEROES.length);
  });
});
