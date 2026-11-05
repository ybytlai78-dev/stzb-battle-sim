/**
 * 1.21 赛季下拉 + 北伐副将 UI 自检（内部脚本 `_` 前缀）
 * 用法：先 `npm run web -- --port 5183 --strictPort`，再 node scripts/_verify_deputy_ui.mjs
 * 产出：输出/verify-1.21-deputy/*.png + 控制台 JSON（含断言结果）
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:5183/';
const OUT = 'C:/Users/lai15/Desktop/战斗系统/输出/verify-1.21-deputy';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = async (name, clip) => page.screenshot({ path: `${OUT}/${name}.png`, clip });
const checks = [];

await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1200);

// 首访声明弹窗（真实用户路径：先关掉）
if (await page.locator('.disclaimer-mask').count()) {
  await page.locator('.disclaimer-mask button').last().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
}
// 公告弹窗（若有）
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));

const header = page.locator('header.app');
checks.push({ step: '顶栏赛季下拉存在', ok: (await page.locator('#season-mode').count()) === 1 });
checks.push({ step: '默认＝常规赛季', ok: (await page.locator('#season-mode').inputValue()) === 'classic' });
await shot('01-topbar-classic', await header.boundingBox());

// 切到北伐副本
await page.selectOption('#season-mode', 'beifa');
await page.waitForTimeout(600);
checks.push({ step: '切北伐后写入 localStorage', ok: (await page.evaluate(() => localStorage.getItem('stzb_season_mode'))) === 'beifa' });
await shot('02-topbar-beifa', await header.boundingBox());

// 一键上一支热门预设（红队三将）
await page.locator('[data-nav="presets"]').click();
await page.waitForTimeout(700);
await page.locator('.preset-item').first().click();
await page.waitForTimeout(500);
await page.locator('[data-act="apply-red"]').click();
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));

// 蓝队也上一支预设（另一支），否则开战会被拦下
await page.locator('[data-nav="presets"]').click();
await page.waitForTimeout(600);
await page.locator('.preset-item').nth(1).click();
await page.waitForTimeout(400);
await page.locator('[data-act="apply-blue"]').click();
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));

const filled = await page.locator('.slot[data-team="red"]:not(.empty)').count();
checks.push({ step: '红队已放入 3 将', ok: filled === 3, actual: filled });
const slotBox = await page.locator('.slot[data-team="red"]').first().boundingBox();
await shot('03-slots-classic', { x: 0, y: 0, width: 1600, height: Math.min(1000, (slotBox?.y ?? 200) + 320) });

// 点主将 → 详情（未戴副将：第二格是普通装配位 + 「佩戴副将」按钮）
await page.locator('.slot[data-team="red"]:not(.empty)').first().click();
await page.waitForTimeout(700);
const modal = page.locator('.hero-detail-modal');
checks.push({ step: '主将详情打开', ok: (await modal.count()) === 1 });
checks.push({ step: '有「佩戴副将」入口', ok: (await modal.locator('[data-deputy-pick]').count()) === 1 });
checks.push({ step: '未戴副将时第二格不是副将格', ok: (await modal.locator('[data-deputy-open]').count()) === 0 });
await page.screenshot({ path: `${OUT}/04-detail-before.png` });

// 佩戴副将
await modal.locator('[data-deputy-pick]').click();
await page.waitForTimeout(600);
const picker = page.locator('.deputy-picker-modal');
checks.push({ step: '副将选择器打开', ok: (await picker.count()) === 1 });
const cardCount = await picker.locator('.deputy-grid .hero-card').count();
checks.push({ step: '选择器有同阵营候选', ok: cardCount > 0, actual: cardCount });
await page.screenshot({ path: `${OUT}/05-deputy-picker.png` });
await picker.locator('.deputy-grid .hero-card').first().click();
await page.waitForTimeout(700);

// 详情仍在，且第二格变成副将主战法
checks.push({ step: '佩戴后详情仍在', ok: (await modal.count()) === 1 });
const depSlot = modal.locator('[data-deputy-open]');
checks.push({ step: '第二格变为副将主战法（只读）', ok: (await depSlot.count()) === 1 });
const depText = (await depSlot.count()) ? (await depSlot.innerText()).replace(/\s+/g, ' ').trim() : '';
checks.push({ step: '第二格文案含副将战法名', ok: depText.length > 0, actual: depText });
const tagText = (await modal.locator('.hd-deputy-tag').count()) ? await modal.locator('.hd-deputy-tag').innerText() : '';
checks.push({ step: '战法区出现北伐说明', ok: tagText.includes('北伐'), actual: tagText });
await page.screenshot({ path: `${OUT}/06-detail-with-deputy.png` });

// 点第二格 → 副将详情（含 70/30 合成与独立加点）
await depSlot.click();
await page.waitForTimeout(600);
const depDetail = page.locator('.deputy-detail-modal');
checks.push({ step: '副将详情打开', ok: (await depDetail.count()) === 1 });
const mixCount = await depDetail.locator('.pt-mix').count();
checks.push({ step: '四维都标注 70/30 合成', ok: mixCount === 4, actual: mixCount });
const before = (await depDetail.locator('.pt-row').first().innerText()).replace(/\s+/g, ' ');
await depDetail.locator('[data-dinc="attack"]').first().click();
await page.waitForTimeout(300);
await depDetail.locator('[data-dinc="attack"]').first().click();
await page.waitForTimeout(400);
const after = (await depDetail.locator('.pt-row').first().innerText()).replace(/\s+/g, ' ');
checks.push({ step: '＋加点生效（+2）', ok: after.includes('+2'), actual: { before, after } });
await page.screenshot({ path: `${OUT}/07-deputy-detail.png` });

// 关闭全部弹窗，看槽位卡的「副将 X」标记
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));
await page.waitForTimeout(300);
const smDeputy = await page.locator('.slot[data-team="red"] .sm-deputy').count();
checks.push({ step: '槽位卡标出副将', ok: smDeputy === 1, actual: smDeputy });
const slotSkillDeputy = await page.locator('.slot[data-team="red"] .slot-skill.deputy').count();
checks.push({ step: '槽位战法条含副将战法', ok: slotSkillDeputy === 1, actual: slotSkillDeputy });
await page.screenshot({ path: `${OUT}/08-slots-beifa.png` });

// 打一场，确认北伐队伍能进战斗（合成后的 General 无异常）
await page.locator('#start').click();
await page.waitForTimeout(4000);
const reportOk = await page.locator('.battle-summary, .battle-view').count();
const bodyText = await page.evaluate(() => document.body.innerText);
checks.push({ step: '北伐队伍能开战（战报页出现）', ok: reportOk > 0, actual: reportOk });
checks.push({ step: '战报里没有「至少需要 1 名武将」拦截', ok: !bodyText.includes('至少需要 1 名武将') });
await page.screenshot({ path: `${OUT}/09-battle.png` });

// 切回常规赛季：第二格恢复为普通装配位（先点战报页的「← 返回配将」回到配将台）
await page.locator('.btn-back').click();
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));
await page.selectOption('#season-mode', 'classic');
await page.waitForTimeout(700);
checks.push({ step: '切回常规赛季写入 localStorage', ok: (await page.evaluate(() => localStorage.getItem('stzb_season_mode'))) === 'classic' });
const smDeputyClassic = await page.locator('.slot[data-team="red"] .sm-deputy').count();
checks.push({ step: '常规赛季不显示副将标记', ok: smDeputyClassic === 0, actual: smDeputyClassic });
await page.locator('.slot[data-team="red"]:not(.empty)').first().click();
await page.waitForTimeout(600);
const classicDetail = page.locator('.hero-detail-modal');
checks.push({ step: '常规赛季第二格不是副将格（配置保留但不生效）', ok: (await classicDetail.locator('[data-deputy-open]').count()) === 0 });
await page.screenshot({ path: `${OUT}/10-detail-classic-again.png` });

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ out: OUT, total: checks.length, failed: failed.length, failedItems: failed, errors, checks }, null, 1));
await browser.close();
