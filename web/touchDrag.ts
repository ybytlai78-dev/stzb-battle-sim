/**
 * 拖拽（Pointer/Touch 统一实现）：弥补 HTML5 drag 在 WebView / 触屏不可用。
 *
 * 两条事件路径，互不干扰：
 *   ① 触摸 / 触控笔 —— `touch*` 事件 + 长按 ~260ms 激活（手指滑动留给页面滚动，不抢手势）
 *   ② 鼠标 / 触控板 —— `pointer*` 事件 + 位移 >6px 激活（无需长按，符合桌面直觉）
 *
 * ⚠️ 为什么鼠标也必须自己实现（2026-09-18 实测）：
 *   Android WebView（Capacitor 原生壳）里 HTML5 `dragstart`/`drop` **不会触发**，
 *   而 ① 只监听 touch 事件 ⇒ 用鼠标（模拟器、平板接鼠标、桌面 WebView）时两条路全断，
 *   武将卡完全拖不动。真机手指走 ① 正常。
 *
 * 桌面浏览器里原生 HTML5 DnD 是好的，因此鼠标路径一旦收到原生 `dragstart` 就**让位**
 * （cleanup 掉自实现拖拽），浏览器行为与改动前完全一致。
 *
 * 交互：池内武将卡 / 已入队槽卡 → 激活后跟手浮层（原卡半透明）
 *      → 拖到目标槽位松手 = 放入/替换/换位；拖到武将池松手 = 卸下；松手无目标 = 取消。
 * 与桌面鼠标拖拽共用 EditorHandlers（onPickHero / onMoveSlot / onRemoveHero）。
 */
import type { EditorHandlers } from './teamEditor';

const LONG_PRESS_MS = 90; // 触摸/触控笔：长按激活时长（260 → 130 → 90ms，一降再降：手感要"按下即持起"）
const MOUSE_MOVE_PX = 6; // 鼠标：位移超过此值即激活
const CANCEL_DIST = 18; // 触摸：未激活前位移超过此值 = 想滚动，取消（12 → 16 → 18，随长按时间一起放宽）

interface DragState {
  /** pick = 源是武将池卡；slot = 源是已入队槽卡 */
  kind: 'pick' | 'slot';
  heroId: string;
  team?: 'red' | 'blue';
  idx?: number;
  orig: HTMLElement;
  ghost: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  path: 'touch' | 'mouse';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /**
   * 激活之后手指/鼠标是否真的移动过。
   * 用来区分「真拖拽」与「按久了一点的点击」：长按激活后原地松手（位移≈0）不能吞掉 click，
   * 否则缩短长按时间后，点武将卡会打不开详情（长按 130ms 太容易被触发）。
   */
  moved: boolean;
  /** 鼠标路径：激活时临时关掉原生 DnD 用，记原值以便恢复 */
  origDraggable: boolean | null;
}

let drag: DragState | null = null;
let suppressClickUntil = 0;

/** 拖拽结束后吞掉浏览器自动补发的 click（避免误开详情/误触发槽位选择） */
function swallowNextClick(): void {
  suppressClickUntil = Date.now() + 400;
}

/** 命中可拖拽源：武将池卡 或 已入队槽卡（弹窗内不响应） */
function findCard(target: EventTarget | null): HTMLElement | null {
  const el = (target as Element | null)?.closest?.(
    '.hero-card[data-hero-id], .slot[data-team][data-hero-id]',
  ) as HTMLElement | null;
  if (!el || el.closest('.modal-mask')) return null;
  return el;
}

function beginDrag(card: HTMLElement, x: number, y: number, path: 'touch' | 'mouse'): DragState {
  const isSlot = card.classList.contains('slot');
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.add('drag-ghost');
  // 宽高都要显式带上：手机端槽位是「立绘铺满 + 图标绝对定位」，没有内在高度，
  // 只给宽度会让浮层塌成一条线（桌面端带高度也能更贴近原卡尺寸）
  const rect = card.getBoundingClientRect();
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.display = 'none';
  document.body.appendChild(ghost);

  const state: DragState = {
    kind: isSlot ? 'slot' : 'pick',
    heroId: card.dataset.heroId as string,
    team: isSlot ? (card.dataset.team as 'red' | 'blue') : undefined,
    idx: isSlot ? Number(card.dataset.slotIndex) : undefined,
    orig: card,
    ghost,
    timer: null,
    active: false,
    path,
    startX: x,
    startY: y,
    lastX: x,
    lastY: y,
    moved: false,
    origDraggable: null,
  };
  drag = state;
  return state;
}

function activateDrag(): void {
  if (!drag) return;
  // 「武装」而不是直接显形：浮层等第一次真实移动才出现。
  // 好处：点一下（按到 90ms 但没动）不会在松手前闪出一张跟着手指的卡；
  // 而一旦手指移动，卡片瞬间跟手 —— 既没有停顿感也没有闪烁。
  drag.active = true;
  if (drag.timer !== null) {
    clearTimeout(drag.timer);
    drag.timer = null;
  }
  drag.orig.classList.add('dragging');
  if (drag.path === 'mouse') {
    // 关掉原生 DnD，避免与自实现拖拽同时生效（cleanup 恢复）
    drag.origDraggable = drag.orig.draggable;
    drag.orig.draggable = false;
  }
  moveTo(drag.lastX, drag.lastY);
}

function moveTo(x: number, y: number): void {
  if (!drag) return;
  drag.lastX = x;
  drag.lastY = y;
  // 位移超过 4px 才算"真的在拖"，而不是按久了 —
  // 第一次真实移动时才把浮层显出来（见 activateDrag 注释）
  if (drag.active && !drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > 4) {
    drag.moved = true;
    drag.ghost.style.display = '';
  }
  positionGhost(x, y);
  highlightAt(x, y);
}

function cleanup(restoreClick: boolean): void {
  if (!drag) return;
  const wasActive = drag.active;
  const wasMoved = drag.moved;
  if (drag.timer !== null) clearTimeout(drag.timer);
  drag.orig.classList.remove('dragging');
  if (drag.origDraggable !== null) drag.orig.draggable = drag.origDraggable;
  drag.ghost.remove();
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  // 只有"真的拖动过"才吞 click；原地按久了松手仍按普通点击处理
  if (restoreClick && wasActive && wasMoved) swallowNextClick();
  drag = null;
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

/** 槽位高亮：命中 .slot 或 .hero-pool 时加 .drag-over */
function highlightAt(x: number, y: number): void {
  document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  const hit = document.elementFromPoint(x, y)?.closest?.('.slot[data-team], .hero-pool');
  if (hit) hit.classList.add('drag-over');
}

export function setupTouchDrag(h: EditorHandlers): void {
  if (typeof window === 'undefined') return;

  // ───────────── ① 触摸 / 触控笔：touch 事件 + 长按激活 ─────────────
  if ('ontouchstart' in window) {
    document.addEventListener(
      'touchstart',
      (e) => {
        if (drag || e.touches.length !== 1) return;
        const t = e.touches[0];
        const card = findCard(t.target);
        if (!card) return;
        const state = beginDrag(card, t.clientX, t.clientY, 'touch');
        state.timer = setTimeout(activateDrag, LONG_PRESS_MS);
      },
      { passive: true },
    );

    document.addEventListener(
      'touchmove',
      (e) => {
        if (!drag || drag.path !== 'touch') return;
        const t = e.touches[0];
        if (!drag.active) {
          if (Math.hypot(t.clientX - drag.startX, t.clientY - drag.startY) > CANCEL_DIST) {
            cleanup(false); // 视为滚动意图
          }
          return;
        }
        e.preventDefault(); // 激活后禁止页面滚动
        moveTo(t.clientX, t.clientY);
      },
      { passive: false },
    );

    document.addEventListener('touchend', (e) => {
      if (!drag || drag.path !== 'touch') return;
      if (!drag.active) {
        cleanup(false);
        return; // 未激活 = 普通点击，交给 click 流
      }
      const t = e.changedTouches[0];
      placeAt(t.clientX, t.clientY, h);
    });

    document.addEventListener('touchcancel', () => {
      if (drag && drag.path === 'touch') cleanup(false);
    });
  }

  // ───────────── ② 鼠标 / 触控板：pointer 事件 + 位移激活 ─────────────
  if ('PointerEvent' in window) {
    document.addEventListener('pointerdown', (e) => {
      if (drag || e.pointerType !== 'mouse' || e.button !== 0) return;
      const card = findCard(e.target);
      if (!card) return;
      beginDrag(card, e.clientX, e.clientY, 'mouse');
    });

    document.addEventListener('pointermove', (e) => {
      if (!drag || drag.path !== 'mouse') return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= MOUSE_MOVE_PX) return;
        activateDrag();
        if (!drag) return;
      }
      e.preventDefault();
      moveTo(e.clientX, e.clientY);
    });

    document.addEventListener('pointerup', (e) => {
      if (!drag || drag.path !== 'mouse') return;
      if (!drag.active) {
        cleanup(false);
        return; // 未激活 = 点击，交给 click 流
      }
      placeAt(e.clientX, e.clientY, h);
    });

    document.addEventListener('pointercancel', () => {
      if (drag && drag.path === 'mouse') cleanup(false);
    });

    // 桌面浏览器里原生 HTML5 DnD 更完整 → 它一启动就让位，保持原行为不变
    document.addEventListener(
      'dragstart',
      () => {
        if (drag && drag.path === 'mouse') cleanup(false);
      },
      true,
    );
  }

  // 拖拽松手后浏览器会补发 click（指针未位移时）→ capture 阶段吞掉，防止误开详情
  document.addEventListener(
    'click',
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

function positionGhost(x: number, y: number): void {
  if (!drag) return;
  const r = drag.orig.getBoundingClientRect();
  drag.ghost.style.left = `${x - r.width / 2}px`;
  drag.ghost.style.top = `${y - r.height / 2}px`;
}
