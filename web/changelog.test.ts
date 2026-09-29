/**
 * 公告数据守门测试（`web/changelog.ts`）——
 * 把「每次部署上线都要在最前面写一条版本公告」变成会红的测试：
 * 版本号格式 / 倒序 / 去重 / 日期 / 分组与条目非空，以及
 * **当前主站版本必须等于最新一条公告的版本**（防止「发了新版忘了写公告」）。
 */
import { describe, it, expect } from 'vitest';
import {
  ANNOUNCEMENTS,
  ANNOUNCEMENT_NOTIFIED_KEY,
  ANNOUNCEMENT_SEEN_KEY,
  SITE_VERSION,
  announcementByVersion,
  changeCount,
  compareVersions,
  latestAnnouncement,
  versionParts,
} from './changelog';

const VERSION_RE = /^\d+\.\d+(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 约定的五种分组标签（写错会渲染成灰标签，这里直接拦下） */
const KINDS = ['新增', '优化', '修复', '调整', '说明'];

describe('公告数据（web/changelog.ts）', () => {
  it('有公告，且当前主站版本 = 最新一条公告的版本（防止「发了新版忘了写公告」）', () => {
    expect(ANNOUNCEMENTS.length).toBeGreaterThan(0);
    expect(SITE_VERSION).toMatch(VERSION_RE);
    expect(SITE_VERSION).toBe(ANNOUNCEMENTS[0].version);
    expect(latestAnnouncement()).toBe(ANNOUNCEMENTS[0]);
  });

  it('版本号唯一、严格倒序，日期不早于下一条（越靠前越新）', () => {
    const versions = ANNOUNCEMENTS.map((a) => a.version);
    expect(new Set(versions).size, '版本号不能重复').toBe(versions.length);
    ANNOUNCEMENTS.forEach((ann, i) => {
      expect(ann.version, `第 ${i + 1} 条版本号`).toMatch(VERSION_RE);
      expect(ann.date, `v${ann.version} 的日期`).toMatch(DATE_RE);
      expect(Number.isNaN(new Date(ann.date).getTime()), `v${ann.version} 的日期不是合法日期`).toBe(false);
      if (i === 0) return;
      const prev = ANNOUNCEMENTS[i - 1];
      expect(compareVersions(prev.version, ann.version), `v${prev.version} 应排在 v${ann.version} 之前（倒序）`).toBeGreaterThan(0);
      expect(prev.date >= ann.date, `v${prev.version}（${prev.date}）不能早于 v${ann.version}（${ann.date}）`).toBe(true);
    });
  });

  it('每条公告：标题非空、分组非空、每组至少 1 条不重复的有效条目', () => {
    for (const ann of ANNOUNCEMENTS) {
      const tag = `v${ann.version}`;
      expect(ann.title.trim().length, `${tag} 缺标题`).toBeGreaterThan(0);
      expect(ann.groups.length, `${tag} 至少要有一个分组`).toBeGreaterThan(0);
      for (const g of ann.groups) {
        expect(KINDS, `${tag} 的分组标签「${g.kind}」不在约定集合内`).toContain(g.kind);
        expect(g.items.length, `${tag}「${g.kind}」组必须有条目`).toBeGreaterThan(0);
        for (const item of g.items) expect(item.trim().length, `${tag}「${g.kind}」有空白条目`).toBeGreaterThan(4);
        expect(new Set(g.items).size, `${tag}「${g.kind}」组内有重复条目`).toBe(g.items.length);
      }
    }
  });

  it('v1.0 初始公告：首版内容齐备（含「新增」与「说明」，条目够看）', () => {
    const v10 = announcementByVersion('1.0');
    expect(v10, '应有 v1.0 初始公告').toBeTruthy();
    expect(v10!.title.length).toBeGreaterThan(0);
    expect((v10!.summary ?? '').length).toBeGreaterThan(10);
    const kinds = v10!.groups.map((g) => g.kind);
    expect(kinds).toContain('新增');
    expect(kinds).toContain('说明');
    expect(changeCount(v10!)).toBeGreaterThanOrEqual(10);
  });

  it('changeCount 统计该版本所有分组的条目', () => {
    const total = ANNOUNCEMENTS.reduce((n, a) => n + changeCount(a), 0);
    const manual = ANNOUNCEMENTS.reduce((n, a) => n + a.groups.reduce((m, g) => m + g.items.length, 0), 0);
    expect(total).toBe(manual);
    expect(total).toBeGreaterThan(0);
  });

  it('版本号解析与比较（1.1 > 1.0；1.1 与 1.1.0 等价）', () => {
    expect(versionParts('1.2.3')).toEqual([1, 2, 3]);
    expect(compareVersions('1.1', '1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.1')).toBeLessThan(0);
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('2.0', '10.0')).toBeLessThan(0);
  });

  it('两个存储 key 固定（改名会让玩家的已读/弹窗水位失效 → 老版本重新弹窗）', () => {
    expect(ANNOUNCEMENT_SEEN_KEY).toBe('stzb_site_version_seen');
    expect(ANNOUNCEMENT_NOTIFIED_KEY).toBe('stzb_site_version_notified');
  });
});
