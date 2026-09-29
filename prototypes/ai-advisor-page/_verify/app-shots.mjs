/**
 * 落地实现验证：真实跑起来的 `advisor.html`（vite dev server）+ 主站新入口
 * 跑法：先 `npm run web`（5173），再 `node prototypes/ai-advisor-page/_verify/app-shots.mjs [base]`
 * 产出：shots/app-*.png + 断言 + 控制台错误报告
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PW_CORE = process.env.PW_CORE ?? 'C:/Users/lai15/AppData/Local/hermes/hermes-agent/node_modules/playwright-core';
const { chromium } = require(PW_CORE);

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const OUT = resolve(fileURLToPath(new URL('./shots', import.meta.url)));
await mkdir(OUT, { recursive: true });

const errors = [];
const results = [];
const check = (label, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));

const shot = (n) => page.screenshot({ path: resolve(OUT, `${n}.png`) });
const railW = () => page.$eval('.advisor-rail', (e) => Math.round(e.getBoundingClientRect().width));
const convW = () => page.$eval('.advisor-main', (e) => Math.round(e.getBoundingClientRect().width));

/* ── 1. 主站：入口改名 + 设置齿轮（导航计数不变） ── */
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const navCount = await page.$$eval('.nav-link', (els) => els.length);
check('主站导航仍是 7 项（改名不增项）', navCount === 7, `实际 ${navCount}`);
const navText = await page.$eval('[data-nav="advisor"]', (e) => e.textContent?.trim() ?? '');
check('第 7 项文案 = AI配将', navText === 'AI配将', `实际「${navText}」`);
check('顶栏有设置齿轮（不是 .nav-link）', await page.$('.header-settings') !== null);
await page.click('#header-settings'); await page.waitForTimeout(300);
check('主站齿轮打开的是同一个设置弹窗', await page.$eval('#advisor-settings-modal', (e) => e.classList.contains('on')));
check('设置里有密钥字段（且只在弹窗里）', await page.$('#adv-key') !== null);
await shot('app-05-main-settings');
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await shot('app-06-main');

/* ── 2. 独立页：骨架两态（先塞一支真队伍，好验证侧栏画的是主站同款卡） ── */
await page.addInitScript(() => {
  const slot = (heroId, level, redness) => ({
    heroId,
    extraSkillIds: [],
    freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
    redness,
    level,
    treasure: null,
  });
  try {
    localStorage.setItem(
      'stzb_team_current',
      JSON.stringify({ red: [slot('h29', 45, 2), slot('weiyan', 45, 3), slot('taishici', 45, 0)], blue: [slot(null, 40, 0), slot(null, 40, 0), slot(null, 40, 0)] })
    );
  } catch {
    /* 忽略 */
  }
});
await page.goto(`${BASE}/advisor.html`, { waitUntil: 'load' });
await page.waitForTimeout(900);
check('advisor.html 挂载出独立页骨架', await page.$('.advisor-page.open') !== null);
const railCards = await page.$$eval('.advisor-team-list .slot', (els) => els.length);
check('侧栏阵容 = 主站同款槽位卡 ×3（复用 renderSlot）', railCards === 3, `实际 ${railCards}`);
check('槽位卡有立绘卡面（.slot-art）', (await page.$$('.advisor-team-list .slot .slot-art')).length === 3);
check('槽位卡有战法栏（.hero-skills）', (await page.$$('.advisor-team-list .slot .hero-skills')).length === 3);
const backIsBtn = await page.$eval('.advisor-goto-main', (e) => e.classList.contains('btn') && e.classList.contains('beige'));
check('「在主站编辑」是项目按键标准（.btn.beige）', backIsBtn === true);
const w0 = await railW();
check('默认极简：侧栏 0 宽（含边框）', w0 === 0, `${w0}px`);
const toolsShown = await page.$eval('.advisor-tools', (e) => getComputedStyle(e).display !== 'none');
check('默认极简：输入区工具行可见（功能唯一入口）', toolsShown === true);
await shot('app-01-min');

const c0 = await convW();
await page.click('.advisor-rail-toggle'); await page.waitForTimeout(400);
const w1 = await railW();
check('展开 = 工作台：侧栏 332px', w1 === 332, `${w1}px`);
check('推挤而非覆盖：对话区变窄', (await convW()) < c0, `${c0} → ${await convW()}px`);
check('展开态收掉工具行（不重复控件）', await page.$eval('.advisor-tools', (e) => getComputedStyle(e).display === 'none'));
await shot('app-02-work');

/* ── 3. 按需面板 + 设置 ── */
await page.click('.advisor-rail [data-sheet="box"]'); await page.waitForTimeout(350);
check('点「我的 box」→ 右侧面板打开', await page.$eval('.advisor-sheet[data-sheet-panel="box"]', (e) => e.classList.contains('on')));
check('同一时刻只有一个面板', (await page.$$eval('.advisor-sheet.on', (e) => e.length)) === 1);
await shot('app-03-box-sheet');
await page.click('.advisor-sheet.on [data-sheet-close]'); await page.waitForTimeout(300);
await page.click('.advisor-top [data-settings]'); await page.waitForTimeout(350);
check('页内齿轮打开设置弹窗', await page.$eval('#advisor-settings-modal', (e) => e.classList.contains('on')));
await shot('app-04-settings');
await page.keyboard.press('Escape'); await page.waitForTimeout(250);

/* ── 4. 窄屏：侧栏浮层 + 遮罩 ── */
await page.setViewportSize({ width: 900, height: 900 });
await page.waitForTimeout(300);
await page.click('.advisor-rail-toggle'); await page.waitForTimeout(400);
check('窄屏展开侧栏 = 浮层 + 遮罩', await page.$eval('.advisor-mask', (e) => !e.hidden));
await shot('app-07-narrow-overlay');
await page.click('.advisor-mask', { position: { x: 700, y: 500 } }); await page.waitForTimeout(350);
check('点遮罩收起窄屏侧栏', (await railW()) === 0);

await browser.close();
console.log('\n=== 断言 ===');
console.log(results.join('\n'));
console.log(`\n=== 控制台 / 页面错误（${errors.length}）===`);
console.log(errors.length ? errors.join('\n') : '（无）');
const failed = results.filter((r) => r.startsWith('FAIL')).length;
process.exit(failed || errors.length ? 1 : 0);
