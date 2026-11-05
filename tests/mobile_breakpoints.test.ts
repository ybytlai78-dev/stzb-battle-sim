/**
 * 移动端断点同源守卫（2026-11-05）
 *
 * 三处必须表达**同一个**移动端判定，改一处漏两处就会出现「CSS 已收起但 JS 还在绑手势」
 * 或「JS 判定是手机、样式却没生效」的半死状态：
 *   · `web/mobileUi.ts` 的 `MOBILE_UI_QUERY`（JS 侧判定，决定绑不绑滚动收放 / 走哪套模板）
 *   · `web/mobile-ui.css` 的 `@media`（本次新规则的唯一入口）
 *   · `web/mobile.css` 的 `@media`（GBK 历史文件，横屏 / 竖屏两段各自独立）
 *
 * 断言口径 = **规范化后集合相等**：条件的书写顺序不算差异
 * （mobile.css 写的是 `(orientation: landscape) and (pointer: coarse) and (max-height: 620px)`，
 *  MOBILE_UI_QUERY 把 pointer 写在前面 —— 两者等价）。
 * 只比 ASCII 片段，所以 mobile.css 即便按 UTF-8 读进来中文乱码也不影响判定。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOBILE_UI_QUERY } from '../web/mobileUi';

/** 把一条查询规范成「条件集合」，顺序无关 */
function normalizeOne(query: string): string {
  return query
    .split(/\band\b/)
    .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean)
    .sort()
    .join(' && ');
}

/** 把整串（可能是逗号并列的多段）规范成排序后的集合 */
function normalize(query: string): string {
  return query
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeOne)
    .sort()
    .join(' , ');
}

/** 抽出 CSS 里所有 `@media` 前置条件（只管到第一个 `{`，够用且不会被声明块干扰） */
function mediaQueries(cssText: string): string[] {
  const out: string[] = [];
  const re = /@media([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) out.push(m[1].trim());
  return out;
}

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

describe('移动端断点三处同源', () => {
  it('MOBILE_UI_QUERY 由「手机横屏 + 手机竖屏」两段并列组成', () => {
    expect(normalize(MOBILE_UI_QUERY)).toBe(
      normalize(
        '(pointer: coarse) and (orientation: landscape) and (max-height: 620px), ' +
          '(max-width: 720px) and (orientation: portrait)',
      ),
    );
  });

  it('mobile-ui.css 的媒体块与 MOBILE_UI_QUERY 等价', () => {
    const target = normalize(MOBILE_UI_QUERY);
    const matched = mediaQueries(read('web/mobile-ui.css')).filter(
      (q) => normalize(q) === target,
    );
    expect(matched.length).toBeGreaterThan(0);
  });

  it('mobile.css 里的横屏段与竖屏段分别与 MOBILE_UI_QUERY 的两段等价', () => {
    const [landscape, portrait] = MOBILE_UI_QUERY.split(',').map(normalizeOne);
    const all = mediaQueries(read('web/mobile.css')).map(normalizeOne);
    expect(all).toContain(landscape);
    expect(all).toContain(portrait);
  });

  it('手机横屏阈值仍是 620（1080p@2x 横屏 CSS 高 ≈ 540）', () => {
    expect(MOBILE_UI_QUERY).toContain('max-height: 620px');
  });
});
