/**
 * 启动加载页：首屏水墨 KV + 进度条，边播边把武将画像拉进 HTTP 缓存。
 *
 * DOM 与样式都内联在 `index.html`（JS 包还没解析完就要先看到画面），这里只接管
 * 进度推进、跳过与退场。退场后回调 `onBootExit` 注册的收尾动作（公告 / 声明弹窗）——
 * 否则用户还没看见界面就被弹窗糊一脸。
 *
 * ⚠️ 预载 URL 必须走 `heroes.ts` 的 `portraitSrc` / `avatarSrc`：它们带 `?v=` 指纹。
 * 自己拼 `/portraits/x.jpg` 会得到另一个 URL，缓存不命中，等于白预载。
 */
import { PORTRAITS, avatarSrc, portraitSrc } from './heroes';

/** 缓存命中时也别让加载页一闪就没（否则比直接进还愣） */
const MIN_SHOW_MS = 900;
/** 慢网兜底：到点就放行，剩下的图在后台继续拉，不拦着用户进站 */
const HARD_TIMEOUT_MS = 20000;
/** 并发数：HTTP/1.1 下每域 6 条连接，再多只是排队 */
const CONCURRENCY = 6;

/**
 * 预载分组。
 *
 * 以后模拟器加新资源（战法图、宝物图、地形图…）往这里补一条就行：`urls()` 返回该组
 * 全部 URL（必须与运行时真正用的 URL 完全一致，含 `?v=` 指纹），加载页会把它们并进
 * 同一条进度条。分组用惰性函数，避免模块初始化时就把清单算出来。
 */
const PRELOAD_GROUPS: { id: string; label: string; urls: () => string[] }[] = [
  { id: 'portraits', label: '武将画像', urls: collectPortraits },
];

/** 武将画像 + 小头像（去重：部分武将该两档指向同一文件） */
function collectPortraits(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(PORTRAITS)) {
    for (const src of [portraitSrc(id), avatarSrc(id)]) {
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

/** 全部预载分组摊平后的 URL 清单（导出给测试守「URL 与运行时一致」这条） */
export function collectPreloadUrls(): string[] {
  return PRELOAD_GROUPS.flatMap((g) => g.urls());
}

/**
 * 并发预载图片。
 *
 * 单张失败（404 / 超时 / 解码失败）只计入进度、不中断整批 —— 少一张立绘不该把用户
 * 卡在加载页。全部结算后 resolve。
 */
function preloadImages(
  urls: readonly string[],
  concurrency: number,
  onTick: (done: number, total: number) => void
): Promise<void> {
  const total = urls.length;
  if (!total) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let next = 0;
    let done = 0;
    let active = 0;
    let resolved = false;
    const start = (): void => {
      while (active < concurrency && next < total && !resolved) {
        const img = new Image();
        let counted = false;
        const step = (): void => {
          if (counted) return;
          counted = true;
          active -= 1;
          done += 1;
          onTick(done, total);
          if (done === total) {
            resolved = true;
            resolve();
            return;
          }
          start();
        };
        img.decoding = 'async';
        // decode() 走完才算「能显示」：只 onload 就收工会让首屏换将时闪一下空白
        img.onload = () => {
          const decoded = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
          void decoded.catch(() => undefined).then(step);
        };
        img.onerror = step;
        img.src = urls[next];
        next += 1;
        active += 1;
      }
    };
    start();
  });
}

/** 加载页是否已经退场（退场后 onBootExit 立即执行） */
let exited = false;
const exitQueue: (() => void)[] = [];

/** 加载页退场后执行（没有加载页时立即执行） */
export function onBootExit(fn: () => void): void {
  if (exited) fn();
  else exitQueue.push(fn);
}

function finish(): void {
  if (exited) return;
  exited = true;
  const el = document.getElementById('boot-splash');
  if (el) {
    el.classList.add('is-out');
    // 摘 DOM 是为了不再挡点击；过渡 450ms，留 520ms 余量
    window.setTimeout(() => el.remove(), 520);
  }
  for (const fn of exitQueue.splice(0)) fn();
}

/**
 * 起播加载页并开始预载。没有 `#boot-splash`（非主站页面 / 单测环境）时直接放行。
 */
export function startBootSplash(): void {
  const el = document.getElementById('boot-splash');
  if (!el) {
    exited = true;
    return;
  }
  el.dataset.ready = '1';

  const t0 = performance.now();
  const fill = document.getElementById('boot-fill');
  const countEl = document.getElementById('boot-count');
  const seal = document.getElementById('boot-seal');

  const paint = (done: number, total: number): void => {
    const pct = total ? Math.round((done / total) * 100) : 100;
    if (fill) fill.style.width = `${pct}%`;
    if (seal) seal.style.left = `${pct}%`;
    if (countEl) countEl.textContent = total ? `${done} / ${total}` : '';
  };

  const urls = collectPreloadUrls();
  paint(0, urls.length);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    finish();
  };
  document.getElementById('boot-skip')?.addEventListener('click', close, { once: true });

  const loaded = preloadImages(urls, CONCURRENCY, paint);
  const cutoff = new Promise<void>((resolve) => window.setTimeout(resolve, HARD_TIMEOUT_MS));
  const minShow = (): Promise<void> =>
    new Promise<void>((resolve) =>
      window.setTimeout(resolve, Math.max(0, MIN_SHOW_MS - (performance.now() - t0)))
    );

  void Promise.race([loaded, cutoff])
    .then(minShow)
    .then(() => close());
}
