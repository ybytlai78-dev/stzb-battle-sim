/**
 * 启动加载页的预载清单（纯逻辑，不需要 DOM）。
 *
 * 守的是「白预载」这个坑：加载页辛苦拉的图，如果 URL 与运行时真正用的差一个 `?v=` 指纹，
 * 浏览器就当两份资源，缓存不命中，用户进去照样一张张现拉 —— 加载页等于白等。
 * 所以清单必须直接由 `portraitSrc` / `avatarSrc` 派生，而不是自己拼路径。
 */
import { describe, expect, it } from 'vitest';
import { collectPreloadUrls } from '../web/splash';
import { PORTRAITS, avatarSrc, portraitSrc } from '../web/heroes';

describe('启动加载页预载清单', () => {
  it('覆盖每个武将的立绘与小头像', () => {
    const urls = new Set(collectPreloadUrls());
    expect(urls.size).toBeGreaterThan(0);
    for (const id of Object.keys(PORTRAITS)) {
      for (const src of [portraitSrc(id), avatarSrc(id)]) {
        if (!src) continue;
        expect(urls.has(src), `${id} 的 ${src} 没进预载清单`).toBe(true);
      }
    }
  });

  it('没有重复项（同图两档只拉一次），且全部指向 portraits 目录', () => {
    const urls = collectPreloadUrls();
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).toContain('/portraits/');
  });

  it('带缓存指纹：换图后预载不会命中旧缓存', () => {
    for (const url of collectPreloadUrls()) expect(url).toMatch(/\?v=/);
  });
});
