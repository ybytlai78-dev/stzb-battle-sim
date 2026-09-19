/**
 * 配将池「显示下架武将」调试开关（jsdom）：
 * 下架 = 主战法已实现、但「受属性影响」的成长率未确认（`src/data/listing.ts` 的 `OFFLINE_MAIN_SKILLS`）
 * → 默认不进池（`web/heroes.ts` 的 `HEROES`）。勾选开关后并入下架武将（`SLOTTED_HEROES`），
 * 卡上带「下架」角标 + 原因 tooltip，且这些武将能正常配将上阵（`buildGeneral` 挂主战法）。
 *
 * 注意：开关状态是模块级的（跨重渲染保持），故每个用例先显式重置为「关」。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { emptyEditor, emptySlot, renderHeroPool, type EditorHandlers, type EditorState } from '../web/teamEditor';
import {
  ALL_HEROES,
  HEROES,
  SLOTTED_HEROES,
  OFFLINE_HEROES,
  offlineReason,
  getHeroById,
  buildGeneral,
} from '../web/heroes';

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
    onRemoveHero(team, idx) {
      state[team][idx] = emptySlot();
    },
    onClearTeam(team) {
      state[team] = [emptySlot(), emptySlot(), emptySlot()];
    },
  };
}

function mount(): { pool: HTMLElement; toggle: HTMLInputElement; state: EditorState } {
  document.body.innerHTML = '';
  const state = emptyEditor();
  const pool = renderHeroPool(state, makeHandlers(state));
  document.body.appendChild(pool);
  return { pool, toggle: pool.querySelector('.offline-toggle-input') as HTMLInputElement, state };
}

/** 勾选/取消「显示下架武将」并触发重画 */
function setOffline(toggle: HTMLInputElement, on: boolean): void {
  toggle.checked = on;
  toggle.dispatchEvent(new Event('change'));
}

function cards(pool: HTMLElement): HTMLElement[] {
  return Array.from(pool.querySelectorAll('.hero-card')) as HTMLElement[];
}

function cardOf(pool: HTMLElement, heroId: string): HTMLElement | undefined {
  return cards(pool).find((c) => c.dataset.heroId === heroId);
}

let ctx: ReturnType<typeof mount>;

beforeEach(() => {
  ctx = mount();
  setOffline(ctx.toggle, false);
});

describe('配将池「显示下架武将」开关', () => {
  it('默认只显示上架武将，下架将不进池', () => {
    // 基线口径：上架 78 / 下架 ≥37（全量 161，已挂主战法 = 上架 + 下架）
    expect(HEROES.length).toBe(78);
    expect(OFFLINE_HEROES.length).toBeGreaterThanOrEqual(37);
    expect(SLOTTED_HEROES.length).toBe(HEROES.length + OFFLINE_HEROES.length);
    expect(cards(ctx.pool).length).toBe(HEROES.length);
    // 本批新增的 7 将里，只有甘宁（侵掠如火）/吕姬（缚父临危）上架
    expect(cardOf(ctx.pool, 'h34')).toBeDefined();
    expect(cardOf(ctx.pool, 'h634')).toBeDefined();
    // 5 个下架将默认不可见（池子里连卡都没有）
    for (const id of ['h472', 'h705', 'h615', 'h562', 'h574']) {
      expect(cardOf(ctx.pool, id), `${id} 不该出现在默认池`).toBeUndefined();
    }
  });

  it('勾选后并入下架武将，带「下架」角标与原因 tooltip', () => {
    setOffline(ctx.toggle, true);
    expect(cards(ctx.pool).length).toBe(SLOTTED_HEROES.length);

    const card = cardOf(ctx.pool, 'h574'); // 陆抗 · 西陵克晋（下架）
    expect(card, '下架将勾选后应进池').toBeDefined();
    expect(card!.classList.contains('offline')).toBe(true);
    expect(card!.querySelector('.offline-tag')?.textContent).toBe('下架');
    const reason = offlineReason(getHeroById('h574')!);
    expect(reason).toBeTruthy();
    expect(card!.title).toContain('已下架');
    expect(card!.title).toContain(reason!);
    // 上架卡不受影响：无 offline 类、无角标
    const ganning = cardOf(ctx.pool, 'h34')!;
    expect(ganning.classList.contains('offline')).toBe(false);
    expect(ganning.querySelector('.offline-tag')).toBeNull();
  });

  it('下架将可配将上阵（主战法照常挂到对应战法槽）', () => {
    // 7 将（含 5 个下架）全部可构建，不抛错
    for (const id of ['h472', 'h34', 'h705', 'h615', 'h562', 'h574', 'h634']) {
      expect(() => buildGeneral(id, [], {}, '前锋'), `${id} 应可配将`).not.toThrow();
    }
    // 陆抗·西陵克晋是指挥主战法 → 挂 commandSkillIds
    const luhang = buildGeneral('h574', [], {}, '前锋');
    expect(luhang.commandSkillIds).toContain('xiling_kejin');
    // 甘宁·侵掠如火是被动主战法 → 挂 passiveSkillIds
    const ganning = buildGeneral('h34', [], {}, '前锋');
    expect(ganning.passiveSkillIds).toContain('qinlue_ruhuo');
  });

  it('开关只放行「已实现主战法」的武将，未实现将仍不可配将', () => {
    const empty = ALL_HEROES.find((h) => !h.mainSkillId);
    expect(empty, '应存在未实现主战法的武将').toBeDefined();
    setOffline(ctx.toggle, true);
    expect(cardOf(ctx.pool, empty!.id)).toBeUndefined();
    expect(() => buildGeneral(empty!.id, [], {})).toThrow();
  });

  it('开关状态跨重渲染保持（实验室/主站重画池子后仍生效）', () => {
    setOffline(ctx.toggle, true);
    const again = mount();
    expect(again.toggle.checked).toBe(true);
    expect(cards(again.pool).length).toBe(SLOTTED_HEROES.length);
    setOffline(again.toggle, false);
    expect(cards(again.pool).length).toBe(HEROES.length);
  });
});
