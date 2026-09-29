/**
 * AI配将原型 · 渲染验证（Playwright）
 * 跑法：node prototypes/ai-advisor-page/_verify/shots.mjs [baseUrl]
 * 产出：同目录 shots/*.png + 控制台/页面错误报告 + 关键断言
 * 骨架口径：极简（侧栏收起）= 默认；顶栏左侧开关展开 = 工作台（左栏常驻）
 * 依赖：playwright-core（本机 hermes-agent 自带；浏览器已在 %LOCALAPPDATA%\ms-playwright）
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PW_CORE = process.env.PW_CORE ?? 'C:/Users/lai15/AppData/Local/hermes/hermes-agent/node_modules/playwright-core';
const { chromium } = require(PW_CORE);

const BASE = process.argv[2] ?? 'http://127.0.0.1:8123/prototypes/ai-advisor-page/index.html';
const OUT = resolve(fileURLToPath(new URL('./shots', import.meta.url)));
await mkdir(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));

const shot = async (name) => { await page.screenshot({ path: resolve(OUT, `${name}.png`) }); };
const setState = (s) => page.click(`#grp-state button[data-state="${s}"]`);
const setRail = (open) => page.click(`#grp-variant button[data-rail="${open ? 'open' : 'closed'}"]`);
const railW = () => page.$eval('#rail', (e) => Math.round(e.getBoundingClientRect().width));
const convW = () => page.$eval('#p3', (e) => Math.round(e.getBoundingClientRect().width));

const results = [];
const check = (label, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`); };

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(200);

/* ── 静态断言（逻辑不变量） ── */
const railKeys = await page.$$eval('.rail .act', (els) => els.length);
check('侧栏内 4 个功能按键（我的 box / 偏好档案 / 历史 / 新会话）', railKeys === 4, `实际 ${railKeys}`);
const inputsInChrome = await page.$$eval('.p0, .rail, .p3, .p4', (els) =>
  els.reduce((n, e) => n + e.querySelectorAll('input, select').length, 0));
check('页面骨架（顶栏/侧栏/对话/输入）零输入控件 → key 只能在设置弹窗与面板里', inputsInChrome === 0, `实际 ${inputsInChrome} 个`);
const guideOk = await page.$eval('#guide', (e) => /设置/.test(e.textContent) && e.querySelectorAll('input').length === 0);
check('未配模型引导条不含表单，只指向「设置」', guideOk === true);
const logoOk = await page.$eval('#logo', (img) => img.complete && img.naturalWidth > 0);
check('率 logo 加载成功（与主站同一资产）', logoOk);
const mdLeak = await page.evaluate(() => /\*\*/.test(document.body.innerText));
check('页面正文无 markdown 星号泄漏', mdLeak === false);
const tinyFonts = await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('.p0 *, .rail *, .p3 *, .p4 *, .plan *, .sheet *, .modal *').forEach((el) => {
    if (!el.textContent.trim() || el.children.length) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) bad.push(`${el.className || el.tagName}:${fs}px`);
  });
  return bad;
});
check('无 <11px 文本（原型控制条已虚线隔离，不参与）', tinyFonts.length === 0, tinyFonts.join(','));
const meta11 = await page.evaluate(() => {
  const set = new Set();
  document.querySelectorAll('.p0 *, .rail *, .p3 *, .p4 *').forEach((el) => {
    if (!el.textContent.trim() || el.children.length) return;
    if (parseFloat(getComputedStyle(el).fontSize) === 11) set.add(el.className || el.tagName);
  });
  return [...set];
});
check('11px 仅限元数据层（沿用主站 .advisor-cost / .advisor-note 口径）', meta11.every((c) => /^(meta|m|src|SPAN|BUTTON|costline|note|hd)$/.test(c)), meta11.join(','));
const thumbFont = await page.$eval('.thumb', (e) => parseFloat(getComputedStyle(e).fontSize));
check('缩略图占位说明 ≥12px', thumbFont >= 12, `${thumbFont}px`);

/* ── 骨架两态：收起 = 极简 / 展开 = 工作台 ── */
await setRail(false); await page.waitForTimeout(300);
const wClosed = await railW();
check('默认收起：侧栏宽度 0（页面上没有常驻信息）', wClosed === 0, `${wClosed}px`);
const toolsVisibleClosed = await page.$eval('.composer-tools', (e) => getComputedStyle(e).display !== 'none');
check('收起态：输入区工具行可见（功能的唯一入口）', toolsVisibleClosed === true);
const teamLineClosed = await page.$eval('#team-inline', (e) => getComputedStyle(e).display !== 'none');
check('收起态：顶栏那一行阵容可见', teamLineClosed === true);
await shot('min-01-empty');
await setState('running'); await page.waitForTimeout(150); await shot('min-02-running');
await setState('card'); await page.waitForTimeout(150); await shot('min-03-card');

const convWClosed = await convW();
await page.click('#rail-toggle'); await page.waitForTimeout(350);
const wOpen = await railW();
check('点顶栏开关 → 展开为工作台（侧栏 332px）', wOpen === 332, `${wOpen}px`);
const convWOpen = await convW();
check('展开是推挤而非覆盖：对话区变窄', convWOpen < convWClosed, `${convWClosed} → ${convWOpen}px`);
const toolsHiddenOpen = await page.$eval('.composer-tools', (e) => getComputedStyle(e).display === 'none');
check('展开态：输入区工具行收掉（不与侧栏重复同一套控件）', toolsHiddenOpen === true);
const teamLineOpen = await page.$eval('#team-inline', (e) => getComputedStyle(e).display === 'none');
check('展开态：顶栏阵容行收掉（阵容在侧栏里，不重复）', teamLineOpen === true);
const ariaOpen = await page.$eval('#rail-toggle', (e) => e.getAttribute('aria-expanded'));
check('开关 aria-expanded 同步', ariaOpen === 'true');
await shot('work-01-card');
await page.click('#st-card .proc .proc-head'); await page.waitForTimeout(220); await shot('work-02-proc-open');
await page.click('.rail .act[data-open="box"]'); await page.waitForTimeout(300); await shot('work-03-panel-box');
const sheetOpen = await page.$$eval('.sheet.on', (e) => e.length);
check('工作台态：侧栏与面板可并存（互斥只作用于面板之间）', sheetOpen === 1, `sheet=${sheetOpen}`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
check('Esc 关面板后侧栏仍在（宽屏推挤栏不受面板影响）', (await railW()) === 332);

const cfgName = await page.$eval('.cfg .gname', (el) => { const cs = getComputedStyle(el); return { display: cs.display, padTop: parseFloat(cs.paddingTop) }; });
check('方案卡配置表：武将名是行内文本（空态 .hero 样式未污染卡片）', cfgName.display === 'inline' && cfgName.padTop === 0, JSON.stringify(cfgName));
const cfgRowH = await page.$eval('.cfg tr', (el) => el.getBoundingClientRect().height);
check('方案卡配置表行高正常（< 48px）', cfgRowH < 48, `${Math.round(cfgRowH)}px`);

const cfgParas = await page.$eval('.msg-ai .body', (e) => { const ps = [...e.querySelectorAll('p')]; return { display: getComputedStyle(e).display, sameRow: ps.length > 1 ? Math.abs(ps[0].getBoundingClientRect().top - ps[1].getBoundingClientRect().top) < 4 : false }; });
check('助手正文段落纵向排列（骨架类名未污染 .msg-ai .body）', cfgParas.display === 'block' && cfgParas.sameRow === false, JSON.stringify(cfgParas));

/* ── 刷新后侧栏状态仍在（落 dsh-advisor-rail-v1） ── */
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);
check('刷新后侧栏仍展开（布局偏好落盘）', (await railW()) === 332);
/* 侧栏完整内容存档：收起原型控制条（别挡设计稿）+ 把侧栏滚到底 */
await page.click('#proto-toggle');
await page.$eval('.rail-inner', (e) => { e.scrollTop = e.scrollHeight; });
await page.waitForTimeout(250); await shot('work-04-rail-full');
await page.click('#proto-toggle'); await page.waitForTimeout(150);
await setRail(false); await page.waitForTimeout(250);

/* ── 面板与弹窗（收起态） ── */
await page.click('.composer-tools button[data-open="box"]'); await page.waitForTimeout(300); await shot('min-04-panel-box');
check('box 面板按需打开（收起态从输入区工具行进）', (await page.$$eval('.sheet.on', (e) => e.length)) === 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(250);
check('Esc 关闭面板', (await page.$$eval('.sheet.on', (e) => e.length)) === 0);
await page.click('.p0 [data-open="settings"]'); await page.waitForTimeout(250); await shot('min-05-settings-modal');
check('顶栏齿轮打开设置弹窗（API key 唯一落点）', (await page.$$eval('#modal-mask.on', (e) => e.length)) === 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await setState('nokey'); await page.waitForTimeout(120); await shot('min-06-nokey-guide');
await setState('card');

/* ── 窄屏：侧栏改浮层 + 遮罩 ── */
await page.setViewportSize({ width: 860, height: 900 });
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);
const dockCollapsed = await page.$eval('#proto-body', (e) => e.hidden);
check('窄屏默认收起原型控制条（不遮挡设计稿）', dockCollapsed === true);
await page.click('#proto-toggle'); await page.click('#grp-state button[data-state="card"]'); await page.click('#grp-variant button[data-rail="open"]');
await page.waitForTimeout(350);
const maskOn = await page.$eval('#mask', (e) => e.classList.contains('on'));
check('窄屏展开侧栏 = 浮层 + 遮罩（不推挤对话）', maskOn === true);
const closeBtnShown = await page.$eval('.rail-close', (e) => getComputedStyle(e).display !== 'none');
check('窄屏侧栏自带关闭钮（顶栏开关被浮层盖住）', closeBtnShown === true);
await page.click('#proto-toggle'); await page.waitForTimeout(200); await shot('narrow-01-rail-overlay');
await page.click('#mask', { position: { x: 700, y: 500 } }); await page.waitForTimeout(300);
const hit = await page.evaluate(() => { const el = document.elementFromPoint(700, 500); return el ? (el.id || el.className || el.tagName) : 'null'; });
const railCls = await page.evaluate(() => document.body.className);
const railProbe = await page.$eval('#rail', (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return `rect=${r.width.toFixed(1)} css=${cs.width} pos=${cs.position} br=${cs.borderRightWidth}`; });
check('点遮罩收起窄屏侧栏', (await railW()) === 0, `hit=${hit} body="${railCls}" ${railProbe}`);
await shot('narrow-02-min');
await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);

/* ── 交互 ── */
await setRail(false); await setState('empty');
await page.fill('#input', '换一个前锋');
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
check('Enter 发送 → 进入对话中', (await page.$eval('#st-running', (e) => !e.hidden)) === true);
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
check('Esc Esc 停止 → 出方案卡', (await page.$eval('#st-card', (e) => !e.hidden)) === true);

await browser.close();

console.log('\n=== 断言 ===');
console.log(results.join('\n'));
console.log(`\n=== 控制台 / 页面错误（${errors.length}）===`);
console.log(errors.length ? errors.join('\n') : '（无）');
console.log(`\n截图目录：${OUT}`);
const failed = results.filter((r) => r.startsWith('FAIL')).length;
process.exit(failed || errors.length ? 1 : 0);
