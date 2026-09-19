/**
 * 安卓返回键 / 返回手势的接管。
 *
 * 优先级（与"页面"的层级一致）：
 *   ① 有覆盖层（弹窗 / 页面级面板）→ 关掉**最上面那一个**
 *   ② 其次关「伤害测试实验室」
 *   ③ 其次关「战报页」
 *   ④ 都没有 → 退出应用（保持安卓默认观感）
 *
 * 为什么必须自己接管：武将详情 / 战法背包 / 战报历史这些在手机上是"页面级视图"，
 * 但实现上仍是 DOM 覆盖层，**系统返回键不知道它们存在** —— 不接管的话，
 * 用户在页面里按返回会直接退到桌面，而不是退回上一页。
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export interface BackButtonHooks {
  /** 伤害测试实验室是否打开 */
  isLabOpen: () => boolean;
  closeLab: () => void;
  /** 战报页是否打开 */
  isReportOpen: () => boolean;
  closeReport: () => void;
  /** 覆盖层选择器（默认 .modal-mask, .bm-mask） */
  overlaySelector?: string;
}

/** 覆盖层自带的关闭键（优先点它，走面板原有的关闭路径；部队加成弹窗是 .bm-close） */
const CLOSE_SELECTORS = ['.m-close', '.bm-close'] as const;

/** 默认覆盖层选择器：.modal-mask（通用弹窗/页面） + .bm-mask（部队加成弹窗） */
export const DEFAULT_OVERLAY_SELECTOR = '.modal-mask, .bm-mask';

/**
 * 关掉最上层的覆盖层（DOM 里靠后的那个就是视觉上更上层的）。
 * @returns 是否关掉了一个覆盖层
 */
export function closeTopOverlay(selector: string = DEFAULT_OVERLAY_SELECTOR): boolean {
  if (typeof document === 'undefined') return false;
  const layers = document.body.querySelectorAll<HTMLElement>(selector);
  const top = layers[layers.length - 1];
  if (!top) return false;
  for (const sel of CLOSE_SELECTORS) {
    const btn = top.querySelector<HTMLElement>(sel);
    if (btn) {
      btn.click();
      return true;
    }
  }
  // 兜底：没有关闭键就直接摘掉（例如某些只挂 mask 的场景）
  top.remove();
  return true;
}

let installed = false;

/**
 * 注册返回键监听。仅在原生壳里生效 —— 浏览器（含 jsdom 测试）没有 backButton 事件，
 * 而且那里本来就有真正的浏览器返回。
 */
export function setupBackButton(hooks: BackButtonHooks): void {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;

  void App.addListener('backButton', () => {
    if (closeTopOverlay(hooks.overlaySelector ?? DEFAULT_OVERLAY_SELECTOR)) return;
    if (hooks.isLabOpen()) {
      hooks.closeLab();
      return;
    }
    if (hooks.isReportOpen()) {
      hooks.closeReport();
      return;
    }
    // 没有可关的：交回系统默认行为（退到桌面 / 上一个应用）
    void App.exitApp();
  });
}
