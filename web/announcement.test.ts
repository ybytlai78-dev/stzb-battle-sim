// @vitest-environment jsdom
/**
 * 公告栏视图测试（`web/announcement.ts` + `web/main.ts` 接入）：
 * 弹窗渲染、未读红点、新版本自动弹一次、首次运行不弹但留红点、存储不可用降级。
 *
 * 两个水位（都在 localStorage）：
 *  - `stzb_site_version_seen`：已读版本 → 红点依据；
 *  - `stzb_site_version_notified`：弹窗提醒水位 → 还弹不弹。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ANNOUNCEMENTS,
  ANNOUNCEMENT_NOTIFIED_KEY,
  ANNOUNCEMENT_SEEN_KEY,
  ANNOUNCE_ON_FIRST_RUN,
  SITE_VERSION,
  changeCount,
} from './changelog';
import {
  hasUnreadAnnouncement,
  markVersionNotified,
  markVersionSeen,
  maybeAutoOpenAnnouncement,
  openAnnouncementPanel,
  readNotifiedVersion,
  readSeenVersion,
  renderAnnouncementBody,
  syncAnnouncementBadge,
} from './announcement';

/** 装一个假的顶栏「公告」按钮（红点断言用，不依赖主站整页） */
function mountNoticeButton(): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'nav-link';
  btn.dataset.nav = 'notice';
  document.body.appendChild(btn);
  return btn;
}

const hasMask = (): boolean => Boolean(document.querySelector('.announcement-mask'));

describe('公告栏 · 渲染', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('renderAnnouncementBody：版本倒序、首条标「最新」、条目数与数据一致', () => {
    const html = renderAnnouncementBody(ANNOUNCEMENTS);
    expect(html).toContain(`v${SITE_VERSION}`);
    expect(html).toContain('an-item latest');
    expect(html).toContain('>最新</span>');
    expect(html.match(/an-item/g)!.length).toBe(ANNOUNCEMENTS.length);
    const total = ANNOUNCEMENTS.reduce((n, a) => n + changeCount(a), 0);
    expect(html.match(/<li>/g)!.length).toBe(total);
    const kinds = new Set(ANNOUNCEMENTS.flatMap((a) => a.groups.map((g) => g.kind)));
    for (const kind of kinds) expect(html, `缺分组标签「${kind}」`).toContain(`>${kind}</span>`);
  });

  it('renderAnnouncementBody：文案里的 < > & 会被转义（不破坏结构）', () => {
    const html = renderAnnouncementBody([
      { version: '9.9', date: '2026-01-01', title: '<b>x</b>', groups: [{ kind: '新增', items: ['a & b < c'] }] },
    ]);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a &amp; b &lt; c');
    expect(html).not.toContain('<b>x</b>');
  });

  it('openAnnouncementPanel：复用 .modal 骨架（标题 / 当前版本 / 最新标记），× 与遮罩都能关', () => {
    openAnnouncementPanel();
    const mask = document.querySelector('.announcement-mask') as HTMLElement;
    expect(mask).toBeTruthy();
    const modal = mask.querySelector('.modal.announcement-modal') as HTMLElement;
    expect(modal.querySelector('.m-head h3')!.textContent).toContain('更新公告');
    expect(modal.querySelector('.an-cur')!.textContent).toContain(`v${SITE_VERSION}`);
    expect(modal.querySelector('.an-item.latest .an-ver')!.textContent).toBe(`v${SITE_VERSION}`);
    expect(modal.querySelectorAll('.an-item').length).toBe(ANNOUNCEMENTS.length);
    expect(modal.querySelectorAll('.an-kind').length).toBeGreaterThan(0);
    // × 关闭
    (modal.querySelector('.m-close') as HTMLElement).click();
    expect(hasMask()).toBe(false);
    // 再开 → 点遮罩空白处关闭
    openAnnouncementPanel();
    (document.querySelector('.announcement-mask') as HTMLElement).click();
    expect(hasMask()).toBe(false);
  });

  it('重复点「公告」不叠面板（同时只保留一个）', () => {
    openAnnouncementPanel();
    openAnnouncementPanel();
    expect(document.querySelectorAll('.announcement-mask').length).toBe(1);
  });

  it('主动打开即已读：记下当前版本并清掉红点', () => {
    const btn = mountNoticeButton();
    markVersionSeen('0.9');
    syncAnnouncementBadge();
    expect(btn.classList.contains('has-unread')).toBe(true);
    openAnnouncementPanel();
    expect(readSeenVersion()).toBe(SITE_VERSION);
    expect(btn.classList.contains('has-unread')).toBe(false);
  });
});

describe('公告栏 · 未读红点与自动弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('首次运行（本机没读过任何公告）：不弹窗，但红点亮着；点开后红点灭', () => {
    const btn = mountNoticeButton();
    maybeAutoOpenAnnouncement();
    if (ANNOUNCE_ON_FIRST_RUN) {
      expect(document.querySelector('.announcement-mask'), '开关打开时首启也弹一次').toBeTruthy();
      return;
    }
    expect(hasMask(), '本次交付不触发发布 → 首启不弹窗').toBe(false);
    expect(readSeenVersion(), '已读水位不写 → 红点留着').toBeNull();
    expect(readNotifiedVersion(), '弹窗水位推到当前版本 → 下次新版本照常弹').toBe(SITE_VERSION);
    syncAnnouncementBadge();
    expect(btn.classList.contains('has-unread')).toBe(true);
    // 点开公告栏 → 记账 → 红点灭
    openAnnouncementPanel();
    expect(hasMask()).toBe(true);
    expect(btn.classList.contains('has-unread')).toBe(false);
  });

  it('新版本上线（弹窗水位落后）：自动弹一次；打开即记账 → 红点灭；再进不弹', () => {
    markVersionSeen('0.9');
    markVersionNotified('0.9');
    const btn = mountNoticeButton();
    syncAnnouncementBadge();
    expect(btn.classList.contains('has-unread'), '已读版本更旧 → 红点').toBe(true);
    maybeAutoOpenAnnouncement();
    expect(hasMask()).toBe(true);
    expect(readSeenVersion()).toBe(SITE_VERSION);
    expect(btn.classList.contains('has-unread')).toBe(false);
    (document.querySelector('.announcement-mask .m-close') as HTMLElement).click();
    maybeAutoOpenAnnouncement();
    expect(hasMask(), '已提醒过 → 不再弹').toBe(false);
  });

  it('弹窗水位 = 当前版本：不弹窗（哪怕玩家没读过）', () => {
    markVersionNotified(SITE_VERSION);
    maybeAutoOpenAnnouncement();
    expect(hasMask()).toBe(false);
    expect(hasUnreadAnnouncement(), '没读过 → 红点仍在').toBe(true);
    expect(readSeenVersion()).toBeNull();
  });

  it('弹窗水位比当前版本新（部署回滚）：不弹旧公告，只把水位改回当前版本', () => {
    markVersionNotified('99.0');
    markVersionSeen('99.0');
    maybeAutoOpenAnnouncement();
    expect(hasMask()).toBe(false);
    expect(readNotifiedVersion()).toBe(SITE_VERSION);
    expect(hasUnreadAnnouncement()).toBe(false);
  });

  it('localStorage 不可用：读返回 null、写与自动弹窗都不抛错（退化为"只有红点、不弹窗"）', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(readSeenVersion()).toBeNull();
      expect(readNotifiedVersion()).toBeNull();
      expect(() => markVersionSeen('1.0')).not.toThrow();
      expect(() => markVersionNotified('1.0')).not.toThrow();
      expect(hasUnreadAnnouncement()).toBe(true);
      expect(() => maybeAutoOpenAnnouncement()).not.toThrow();
      expect(hasMask(), '存储不可用时不弹窗（也记不住水位，避免每次进来都弹）').toBe(false);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('公告栏 · 主站接入', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.resetModules();
  });

  /** 与 web/smoke.test.ts 同款启动：造 #app → 导入 main → initApp */
  async function boot(): Promise<void> {
    const el = document.createElement('div');
    el.id = 'app';
    document.body.appendChild(el);
    const mod = await import('./main');
    mod.initApp(el);
  }

  it('顶栏「公告」是第 7 个导航（AI 顾问插入后）；点它弹公告栏；底栏版本标记 = 公告当前版本且点得开', async () => {
    await boot();
    const navs = Array.from(document.querySelectorAll('.nav-link')) as HTMLElement[];
    expect(navs.length).toBe(7);
    expect(navs[6].getAttribute('data-nav')).toBe('notice');
    const notice = document.querySelector('[data-nav="notice"]') as HTMLElement;
    expect(notice.textContent).toBe('公告');
    const tag = document.querySelector('.control-bar .build-tag') as HTMLElement;
    expect(tag.tagName, '底栏版本标记改成按钮（可点开公告）').toBe('BUTTON');
    expect(tag.textContent).toBe(`v${SITE_VERSION}`);
    expect(tag.getAttribute('title')).toContain('公告');
    notice.click();
    expect(hasMask()).toBe(true);
    (document.querySelector('.announcement-mask .m-close') as HTMLElement).click();
    tag.click();
    expect(hasMask()).toBe(true);
  });

  it('新版本上线后的首次进入：自动弹公告并记账（老玩家第一时间看到改动）', async () => {
    localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, '0.9');
    localStorage.setItem(ANNOUNCEMENT_NOTIFIED_KEY, '0.9');
    await boot();
    expect(hasMask()).toBe(true);
    expect(readSeenVersion()).toBe(SITE_VERSION);
    expect((document.querySelector('[data-nav="notice"]') as HTMLElement).classList.contains('has-unread')).toBe(false);
  });

  it('首次运行启动：不弹窗，但「公告」按钮带未读红点（点开即清）', async () => {
    await boot();
    if (!ANNOUNCE_ON_FIRST_RUN) expect(hasMask()).toBe(false);
    const notice = document.querySelector('[data-nav="notice"]') as HTMLElement;
    if (!ANNOUNCE_ON_FIRST_RUN) {
      expect(notice.classList.contains('has-unread'), '新装用户：红点提示有公告可看').toBe(true);
      expect(readSeenVersion()).toBeNull();
      notice.click();
      expect(notice.classList.contains('has-unread')).toBe(false);
      expect(readSeenVersion()).toBe(SITE_VERSION);
    }
  });
});
