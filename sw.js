/* 战斗模拟器 Service Worker
 * 策略：
 *  - 导航请求（HTML 壳）：network-first，网络挂了回退缓存 —— 保证每次部署后能拿到新壳
 *  - 其余同源 GET（assets/*.js.css 带 hash 永久不变 + portraits/stamps 图片）：cache-first，省流量
 *  - 跨域（Google Fonts 等）：不拦截，走默认网络
 * 缓存累积控制：带 hash 的 assets 每次部署新增几 KB~几百 KB，可接受；
 * 若想全量清缓存，把 CACHE_NAME 版本号 +1 再部署即可（activate 自动清旧）。
 */
const CACHE_NAME = 'stzb-battle-sim-v1';
const SHELL_KEY = './index.html';

self.addEventListener('install', () => {
  // 不等旧页面释放，立即接管（页面刷新一次即完成新旧切换）
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域不拦截

  // 导航：HTML 壳 network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(SHELL_KEY, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(SHELL_KEY))
    );
    return;
  }

  // 其余同源资源：cache-first，put 失败（配额满等）不影响返回
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
