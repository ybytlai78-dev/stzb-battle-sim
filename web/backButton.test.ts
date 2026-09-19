/**
 * 安卓返回键接管的单元测试。
 *
 * 用 vi.hoisted + vi.mock 把 @capacitor/app 换成一个"把回调收集起来"的假插件，
 * 这样不用真机就能验证优先级：覆盖层 → 实验室 → 战报页 → 退出应用。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  listeners: [] as Array<() => void>,
  exitApp: vi.fn(),
  isNative: true,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, cb: () => void) => {
      if (event === 'backButton') h.listeners.push(cb);
      return Promise.resolve({ remove: () => {} });
    },
    exitApp: h.exitApp,
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.isNative },
}));

import { closeTopOverlay, setupBackButton } from './backButton';

const isLabOpen = vi.fn(() => false);
const closeLab = vi.fn();
const isReportOpen = vi.fn(() => false);
const closeReport = vi.fn();

// 只注册一次（setupBackButton 内部有 installed 闸门，重复调用应当被忽略）
setupBackButton({ isLabOpen, closeLab, isReportOpen, closeReport });

/** 模拟按一次安卓返回键 */
const pressBack = (): void => h.listeners.forEach((cb) => cb());

/** 造一个带关闭键的覆盖层；点关闭键会真的把它从 DOM 摘掉 */
function mountOverlay(className: string, closeClass: string): { el: HTMLElement; closed: () => boolean } {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = `<span class="${closeClass}">×</span>`;
  document.body.appendChild(el);
  const btn = el.querySelector(`.${closeClass}`)!;
  btn.addEventListener('click', () => el.remove());
  return { el, closed: () => !el.isConnected };
}

beforeEach(() => {
  document.body.innerHTML = '';
  h.exitApp.mockClear();
  closeLab.mockClear();
  closeReport.mockClear();
  isLabOpen.mockReturnValue(false);
  isReportOpen.mockReturnValue(false);
});

describe('安卓返回键接管', () => {
  it('已注册监听（原生平台）', () => {
    expect(h.listeners.length).toBe(1);
  });

  it('有覆盖层：关掉最上层那个（DOM 靠后的那个），不退出应用', () => {
    const bag = mountOverlay('modal-mask', 'm-close');
    const detail = mountOverlay('modal-mask', 'm-close');

    pressBack();

    expect(detail.closed()).toBe(true); // 后挂的 = 更上层，先关它
    expect(bag.closed()).toBe(false);
    expect(document.querySelectorAll('.modal-mask').length).toBe(1);
    expect(h.exitApp).not.toHaveBeenCalled();
  });

  it('部队加成弹窗（.bm-mask / .bm-close）同样能被返回键关掉', () => {
    const bm = mountOverlay('bm-mask', 'bm-close');

    pressBack();

    expect(bm.closed()).toBe(true);
    expect(h.exitApp).not.toHaveBeenCalled();
  });

  it('没有覆盖层但实验室开着 → 关实验室（不退应用）', () => {
    isLabOpen.mockReturnValue(true);

    pressBack();

    expect(closeLab).toHaveBeenCalledTimes(1);
    expect(closeReport).not.toHaveBeenCalled();
    expect(h.exitApp).not.toHaveBeenCalled();
  });

  it('没有覆盖层、实验室也关着，但战报页开着 → 关战报页', () => {
    isReportOpen.mockReturnValue(true);

    pressBack();

    expect(closeLab).not.toHaveBeenCalled();
    expect(closeReport).toHaveBeenCalledTimes(1);
    expect(h.exitApp).not.toHaveBeenCalled();
  });

  it('都没有可关的 → 退出应用（保持安卓默认观感）', () => {
    pressBack();

    expect(closeLab).not.toHaveBeenCalled();
    expect(closeReport).not.toHaveBeenCalled();
    expect(h.exitApp).toHaveBeenCalledTimes(1);
  });

  it('closeTopOverlay：覆盖层没有关闭键时兜底直接摘掉', () => {
    const bare = document.createElement('div');
    bare.className = 'modal-mask';
    document.body.appendChild(bare);

    expect(closeTopOverlay()).toBe(true);
    expect(bare.isConnected).toBe(false);
    expect(closeTopOverlay()).toBe(false); // 没有覆盖层了
  });

  it('浏览器（非原生平台）不注册返回键监听', async () => {
    vi.resetModules();
    h.isNative = false;
    h.listeners.length = 0;

    const mod = await import('./backButton');
    mod.setupBackButton({ isLabOpen, closeLab, isReportOpen, closeReport });

    expect(h.listeners.length).toBe(0);
    h.isNative = true;
  });
});
