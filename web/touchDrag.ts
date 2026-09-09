/**
 * 触屏拖拽（长按激活）：弥补 HTML5 drag 在触屏不可用。
 * 交互：池内武将卡 / 已入队槽卡 → 长按 ~260ms 进入拖动（跟手浮层、原卡半透明）
 *      → 拖到目标槽位松手 = 放入/替换/换位；拖到武将池松手 = 卸下；松手无目标 = 取消。
 * 与桌面鼠标拖拽共用 EditorHandlers（onPickHero / onMoveSlot / onRemoveHero），
 * 不感知拖动过程中的滚动（长按激活前手指位移 > 阈值自动取消，视为滚动意图）。
 */
import type { EditorHandlers } from './teamEditor';

const LONG_PRESS_MS = 260;
const CANCEL_DIST = 12;

interface TouchDragState {
  /** pick = 源是武将池卡；move/remove = 源是已入队槽卡 */
  kind: 'pick' | 'slot';
  heroId: string;
  team?: 'red' | 'blue';
  idx?: number;
  orig: HTMLElement;
  ghost: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  active: boolean;
  startX: number;
  startY: number;
}

let drag: TouchDragState | null = null;
let suppressClickUntil = 0;

/** 拖拽结束后吞掉浏览器自动补发的 click（避免误开详情/误触发槽位选择） */
function swallowNextClick(): void {
  suppressClickUntil = Date.now() + 400;
}

function cleanup(restoreClick: boolean): void {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag.orig.classList.remove('dragging');
  drag.ghost.remove();
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  if (restoreClick) swallowNextClick();
  drag = null;
}

/** 槽位高亮：命中 .slot 或 .hero-pool 时加 .drag-over */
function highlightAt(x: number, y: number): void {
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  const hit = document.elementFromPoint(x, y)?.closest?.('.slot[data-team], .hero-pool');
  if (hit) hit.classList.add('drag-over');
}

function placeAt(x: number, y: number, h: EditorHandlers): void {
  if (!drag) return;
  const hit = document.elementFromPoint(x, y)?.closest?.('.slot[data-team][data-slot-index]');
  if (hit) {
    const team = (hit as HTMLElement).dataset.team as 'red' | 'blue';
    const idx = Number((hit as HTMLElement).dataset.slotIndex);
    if (drag.kind === 'pick') {
      h.onPickHero(team, idx, drag.heroId); // 空槽放入 / 有武将槽替换
    } else if (drag.team && drag.idx !== undefined) {
      h.onMoveSlot(drag.team, drag.idx, team, idx); // 队内换位 / 跨队移动
    }
    cleanup(true);
    return;
  }
  const pool = document.elementFromPoint(x, y)?.closest?.('.hero-pool');
  if (pool && drag.kind === 'slot' && drag.team && drag.idx !== undefined) {
    h.onRemoveHero(drag.team, drag.idx); // 拖回武将池 = 卸下
    cleanup(true);
    return;
  }
  cleanup(true); // 无目标 = 取消
}

export function setupTouchDrag(h: EditorHandlers): void {
  if (typeof window === 'undefined' || !('ontouchstart' in window)) return;

  document.addEventListener('touchstart', (e) => {
    if (drag || e.touches.length !== 1) return;
    const t = e.touches[0];
    // 源：武将池卡 或 已入队槽卡；弹窗内（.modal-mask 后代）不响应
    const card = (t.target as Element).closest?.('.hero-card[data-hero-id], .slot[data-team][data-hero-id]') as HTMLElement | null;
    if (!card || card.closest('.modal-mask')) return;
    const isSlot = card.classList.contains('slot');
    const heroId = card.dataset.heroId as string;
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${card.getBoundingClientRect().width}px`;
    document.body.appendChild(ghost);
    ghost.style.display = 'none';

    const state: TouchDragState = {
      kind: isSlot ? 'slot' : 'pick',
      heroId,
      team: isSlot ? (card.dataset.team as 'red' | 'blue') : undefined,
      idx: isSlot ? Number(card.dataset.slotIndex) : undefined,
      orig: card,
      ghost,
      timer: setTimeout(() => {
        // 长按激活（回调执行时 drag 已指向本 state）
        if (!drag) return;
        drag.active = true;
        drag.orig.classList.add('dragging');
        drag.ghost.style.display = '';
        positionGhost(t.clientX, t.clientY);
      }, LONG_PRESS_MS),
      active: false,
      startX: t.clientX,
      startY: t.clientY,
    };
    drag = state;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const t = e.touches[0];
    if (!drag.active) {
      // 未激活前位移超阈值 = 用户想滚动，取消长按
      if (Math.hypot(t.clientX - drag.startX, t.clientY - drag.startY) > CANCEL_DIST) {
        clearTimeout(drag.timer);
        drag = null;
      }
      return;
    }
    e.preventDefault(); // 激活后禁止页面滚动
    positionGhost(t.clientX, t.clientY);
    highlightAt(t.clientX, t.clientY);
  }, { passive: false });

  const end = (e: TouchEvent): void => {
    if (!drag) return;
    if (!drag.active) {
      clearTimeout(drag.timer);
      drag = null;
      return; // 未激活 = 普通点击，交给 click 流
    }
    const t = e.changedTouches[0];
    placeAt(t.clientX, t.clientY, h);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { if (drag) cleanup(false); });

  // 拖拽松手后浏览器会补发 click（手指未位移时）→ capture 阶段吞掉，防止误开详情
  document.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

function positionGhost(x: number, y: number): void {
  if (!drag) return;
  const r = drag.orig.getBoundingClientRect();
  drag.ghost.style.left = `${x - r.width / 2}px`;
  drag.ghost.style.top = `${y - r.height / 2}px`;
}
