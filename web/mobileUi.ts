/**
 * 移动端 UI 判定 + 滚动收放辅助（2026-11-05，YG 口径：本次改造只作用于移动端，桌面保持原样）
 *
 * 为什么 JS 侧也要判一次：CSS 可以「藏起来」，但「要不要绑滚动收放」「点卡片要不要展开抽屉」
 * 这些是交互行为，桌面端必须保持旧手感 —— 只在 CSS 里藏等于把交互一并砍掉。
 *
 * 断点与 `web/mobile.css`（历史文件，GBK 编码，勿手改）/ `web/mobile-ui.css`（本次新增）同源：
 *  · 手机横屏：`(pointer: coarse) and (orientation: landscape) and (max-height: 620px)`
 *    —— mobile.css 第 2 段（阈值 620 的来历见该文件注释：1080p@2x 横屏 CSS 高约 540）；
 *  · 手机竖屏：`(max-width: 720px) and (orientation: portrait)` —— mobile.css 第 3 段单列规则。
 * 两者用逗号并列（任一命中即移动端）。**平板横屏（≥768 高）不在其中**：它仍走桌面版交互。
 * ⚠️ 三处（mobile.css / mobile-ui.css / 本文件）改断点必须一起改，否则会出现
 *    "CSS 已收起但 JS 还在绑手势" 或反过来的半死状态。
 */

export const MOBILE_UI_QUERY =
  '(pointer: coarse) and (orientation: landscape) and (max-height: 620px), (max-width: 720px) and (orientation: portrait)';

/** 当前是否走移动端 UI（手机横屏 / 手机竖屏；平板与桌面一律 false） */
export function isMobileUI(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MOBILE_UI_QUERY).matches;
}

/** 监听移动端判定变化（横竖屏切换），返回解绑函数 */
export function onMobileUIChange(cb: (mobile: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(MOBILE_UI_QUERY);
  const handler = (): void => cb(mq.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export interface ScrollCollapseOptions {
  /** 监听宿主（弹窗根节点即可）：用捕获阶段收后代滚动，弹窗里哪层在滚都能拿到 */
  root: HTMLElement;
  /** 要被收起的目标（通常是顶部工具条） */
  target: HTMLElement;
  /** 收起时加在 target 上的类名，缺省 `is-tucked` */
  collapsedClass?: string;
  /** 单次滚动的判定阈值（px），太小会被惯性滚动抖成来回翻，缺省 8 */
  threshold?: number;
  /** 距顶部多少像素内强制展开（滚回顶时筛选栏一定在），缺省 24 */
  topSlack?: number;
  /** 收起 / 展开后的回调（收起态摘要条之类） */
  onChange?: (collapsed: boolean) => void;
  /**
   * 此刻是否允许收起（缺省恒 true）。返回 false 时**仍允许展开**：
   * 战场是搜索框聚焦 —— 用户正在输入，筛选栏被滚走会让人以为「筛选没了」，
   * 但反方向（滚回顶部自动展开）必须照常生效。
   */
  canCollapse?: () => boolean;
}

/**
 * 滚动方向收放：**向下滚收起、向上滚展开、回到顶部必展开**（YG 2026-11-05 第 2 条）。
 *
 * · 只判 `scrollTop` 的方向，不挂 touchmove —— 惯性滚动里 touchmove 早已结束，
 *   靠 scroll 事件才能在减速阶段也跟手；
 * · `scroll` 不冒泡，所以监听器挂在宿主上并开 **capture**（非冒泡事件仍走捕获路径）；
 *   每个滚动元素各自记 lastY（WeakMap），切着滚也不会误判方向；
 * · rAF 合帧，一次滚动只算一次。
 * 返回解绑函数（弹窗关闭时调用）。
 */
export function bindScrollCollapse(opts: ScrollCollapseOptions): () => void {
  const { root, target } = opts;
  const collapsedClass = opts.collapsedClass ?? 'is-tucked';
  const threshold = opts.threshold ?? 8;
  const topSlack = opts.topSlack ?? 24;

  const lastY = new WeakMap<Element, number>();
  let raf = 0;
  let pending: Element | null = null;
  let collapsed = target.classList.contains(collapsedClass);

  const setCollapsed = (next: boolean): void => {
    if (next === collapsed) return;
    collapsed = next;
    target.classList.toggle(collapsedClass, next);
    opts.onChange?.(next);
  };

  const measure = (): void => {
    raf = 0;
    const el = pending;
    pending = null;
    if (!el) return;
    const y = Math.max(0, (el as HTMLElement).scrollTop ?? 0);
    // 首次见到该滚动容器时基线取 0（而不是当前位置）：否则「一次跳转到深处」
    // （滚动条拖动 / 锚点 / 程序的 scrollTop 赋值）会被算成 dy=0，永远收不起来。
    const prev = lastY.get(el) ?? 0;
    lastY.set(el, y);
    const dy = y - prev;
    if (y <= topSlack) {
      setCollapsed(false);
      return;
    }
    if (dy > threshold) {
      // 锁定期间只许展开不许收起：输入中滚走筛选栏会被当成「筛选没了」
      if (opts.canCollapse?.() ?? true) setCollapsed(true);
    } else if (dy < -threshold) setCollapsed(false);
  };

  const onScroll = (e: Event): void => {
    const el = e.target as Element | null;
    if (!el || !(el instanceof HTMLElement)) return;
    pending = el;
    if (raf) return;
    raf = requestAnimationFrame(measure);
  };

  root.addEventListener('scroll', onScroll, { passive: true, capture: true } as AddEventListenerOptions);
  return () => {
    root.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    if (raf) cancelAnimationFrame(raf);
  };
}
