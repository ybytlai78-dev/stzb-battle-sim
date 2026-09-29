/**
 * 公告栏：把 `web/changelog.ts` 的「版本 → 更新改动」渲染成弹窗。
 *
 * 三处入口都走这里（`web/main.ts` 接入）：
 *  - 顶栏「公告」按钮（有未读时带红点）
 *  - 底栏版本标记（点它也能看公告）
 *  - 新版本上线后首次进入的自动弹窗（见 `maybeAutoOpenAnnouncement`）
 *
 * 两个 localStorage 水位（分开记的原因见 `web/changelog.ts` 的注释）：
 *  - `stzb_site_version_seen`：玩家**已读**到的版本 → 决定红点亮不亮；
 *  - `stzb_site_version_notified`：已经**弹窗提醒**过的版本 → 决定还弹不弹。
 *
 * 视觉全部复用主站既有骨架与变量：`.modal-mask / .modal / .m-head / .m-close / .m-body`
 * （与武将详情、教程、预设同一套），配色只用 `--color-*` / `--gold*` / `--green` / `--blue` / `--red` / `--orange`。
 */
import {
  ANNOUNCEMENTS,
  ANNOUNCEMENT_NOTIFIED_KEY,
  ANNOUNCEMENT_SEEN_KEY,
  ANNOUNCE_ON_FIRST_RUN,
  SITE_VERSION,
  changeCount,
  compareVersions,
  type Announcement,
  type ChangeKind,
} from './changelog';

/** 分组标签的配色档（对应 styles.css 里的 .an-kind.<cls>） */
const KIND_CLS: Record<ChangeKind, string> = {
  新增: 'add',
  优化: 'polish',
  修复: 'fix',
  调整: 'tune',
  说明: 'note',
};

/** 文案转义：公告是我们自己写的，但允许文案里出现 < > & 而不破坏结构 */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 公告正文 HTML（版本倒序；第一条标「最新」）—— 纯函数，便于直接断言 */
export function renderAnnouncementBody(list: Announcement[]): string {
  return list
    .map((ann, i) => {
      const groups = ann.groups
        .map(
          (g) => `
        <div class="an-group">
          <span class="an-kind ${KIND_CLS[g.kind] ?? 'note'}">${esc(g.kind)}</span>
          <ul class="an-list">
            ${g.items.map((it) => `<li>${esc(it)}</li>`).join('')}
          </ul>
        </div>`,
        )
        .join('');
      return `
      <article class="an-item${i === 0 ? ' latest' : ''}">
        <header class="an-head">
          <span class="an-ver">v${esc(ann.version)}</span>
          <span class="an-title">${esc(ann.title)}</span>
          ${i === 0 ? '<span class="an-flag">最新</span>' : ''}
          <time class="an-date">${esc(ann.date)}</time>
        </header>
        ${ann.summary ? `<p class="an-summary">${esc(ann.summary)}</p>` : ''}
        ${groups}
        <div class="an-count">共 ${changeCount(ann)} 条改动</div>
      </article>`;
    })
    .join('');
}

/** 读 localStorage 里的版本水位；存储不可用（隐私模式 / 原生壳异常）时返回 null，不抛错 */
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 写版本水位；写不进去（存储不可用）时静默降级为「本次会话内有效」 */
function writeKey(key: string, version: string): void {
  try {
    localStorage.setItem(key, version);
  } catch {
    /* 存储不可用：不影响本次会话浏览公告 */
  }
}

/** 本机**已读**到的版本号（打开公告栏即写入；红点依据） */
export function readSeenVersion(): string | null {
  return readKey(ANNOUNCEMENT_SEEN_KEY);
}

/** 记下「已读到哪个版本」（打开公告栏时调用） */
export function markVersionSeen(version: string = SITE_VERSION): void {
  writeKey(ANNOUNCEMENT_SEEN_KEY, version);
}

/** 本机已经**弹窗提醒**过的版本号（防重复弹窗的水位） */
export function readNotifiedVersion(): string | null {
  return readKey(ANNOUNCEMENT_NOTIFIED_KEY);
}

/** 记下「已经弹窗提醒过哪个版本」 */
export function markVersionNotified(version: string = SITE_VERSION): void {
  writeKey(ANNOUNCEMENT_NOTIFIED_KEY, version);
}

/**
 * 是否有未读公告：**从没读过任何公告**（新装 / 清了存储），或**已读版本比当前版本旧**。
 * 也就是"顶栏「公告」按钮该不该亮红点"。
 */
export function hasUnreadAnnouncement(): boolean {
  const seen = readSeenVersion();
  return seen === null || compareVersions(SITE_VERSION, seen) > 0;
}

/** 顶栏「公告」按钮的红点与未读状态同步（按钮不存在时静默跳过） */
export function syncAnnouncementBadge(): void {
  const btn = document.querySelector<HTMLElement>('[data-nav="notice"]');
  if (btn) btn.classList.toggle('has-unread', hasUnreadAnnouncement());
}

/**
 * 打开公告栏弹窗（× 或点遮罩空白处关闭，与主站其它弹窗同款）。
 * **打开即视为已读** → 两个水位一起推到当前版本（红点灭、不再自动弹），并顺手同步红点。
 */
export function openAnnouncementPanel(): void {
  document.querySelector('.announcement-mask')?.remove(); // 重复点不叠面板
  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask announcement-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal announcement-modal';
  modal.innerHTML = `
    <div class="m-head">
      <h3>更新公告<span class="an-cur">当前版本 v${esc(SITE_VERSION)}</span></h3>
      <span class="m-close">×</span>
    </div>
    <div class="m-body an-body">${renderAnnouncementBody(ANNOUNCEMENTS)}</div>
  `;
  mask.appendChild(modal);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  markVersionSeen(SITE_VERSION);
  markVersionNotified(SITE_VERSION);
  syncAnnouncementBadge();
}

/**
 * 版本号变化后，首次进入自动弹一次公告；**首次运行只把弹窗水位推到当前版本、不弹**（本次不触发发布）。
 *
 * 规则（`web/announcement.test.ts` 锁定）：
 *  - 弹窗水位 = 当前版本 → 什么都不做（已经提醒过）；
 *  - 本机没有水位记录（新玩家 / 清了存储）→ 记下当前版本后返回：**不弹窗，但红点亮着**
 *    （已读水位不写 → 玩家点一次「公告」就清）；除非 `ANNOUNCE_ON_FIRST_RUN` 为 true；
 *  - 水位落后于当前版本（新版本上线）→ 弹一次；打开即记账，红点随之灭；
 *  - 水位比当前版本新（部署回滚）→ 只把水位改回当前版本，不弹旧公告。
 */
export function maybeAutoOpenAnnouncement(): void {
  const notified = readNotifiedVersion();
  if (notified === SITE_VERSION) return;
  if (notified === null) {
    markVersionNotified(SITE_VERSION);
    if (ANNOUNCE_ON_FIRST_RUN) openAnnouncementPanel();
    return;
  }
  if (compareVersions(notified, SITE_VERSION) > 0) {
    markVersionNotified(SITE_VERSION);
    return;
  }
  openAnnouncementPanel();
}
