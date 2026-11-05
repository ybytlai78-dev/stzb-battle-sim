/**
 * 四件新宝物（1126 山君 / 1129 天问 / 1132 镂影 / 1135 奋髯）+ 曹仁加强的无头自检。
 * 产出截图到 `输出/verify-1126-treasure/`，断言失败即非零退出。
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/lai15/Desktop/战斗系统/输出/verify-1126-treasure';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const checks = [];
const ok = (label, cond, extra = '') => {
  checks.push({ label, pass: !!cond, ...(extra ? { extra } : {}) });
  if (!cond) console.log(`FAIL ${label} ${extra}`);
};

await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
// 关掉首访声明
await page.evaluate(() => document.querySelectorAll('.disclaimer-mask, .modal-mask').forEach((m) => m.remove()));

// 上一队热门预设，拿到可编辑的主将
await page.locator('[data-nav="presets"]').click();
await page.waitForTimeout(500);
await page.locator('.preset-item').first().click();
await page.waitForTimeout(400);
await page.locator('[data-act="apply-red"]').click();
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));

// 打开主将详情 → 宝物格 → 三步弹窗
await page.locator('.slot[data-team="red"]:not(.empty)').first().click();
await page.waitForTimeout(500);
await page.locator('.hero-detail-modal [data-treasure-open]').first().click();
await page.waitForTimeout(600);
// 预设自带宝物时弹窗直接从第 2 步开始 → 回到第 1 步看网格
if (await page.locator('.treasure-modal .tp-back').count()) {
  await page.locator('.treasure-modal .tp-back').click();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/01-treasure-grid.png` });

const cards = await page.locator('.treasure-modal .tp-card').count();
ok('宝物网格 40 件', cards === 40, `count=${cards}`);
const ids = await page.locator('.treasure-modal .tp-card').evaluateAll((els) =>
  els.map((e) => Number(e.dataset.tid)),
);
for (const id of [1126, 1129, 1132, 1135]) ok(`网格含 ${id}`, ids.includes(id));

// 新宝物的画像必须真的加载出来（naturalWidth > 0）
const imgOk = await page.evaluate(() => {
  const out = {};
  for (const [id, path] of [
    [1126, '/gears/gear_1126_s.jpg'],
    [1129, '/gears/gear_1129_s.jpg'],
    [1132, '/gears/gear_1132_s.jpg'],
    [1135, '/gears/gear_1135_s.jpg'],
  ]) {
    const el = document.querySelector(`.tp-card[data-tid="${id}"] img`);
    out[id] = el ? { src: el.getAttribute('src'), w: el.naturalWidth } : null;
  }
  return out;
});
for (const id of [1126, 1129, 1132, 1135]) {
  ok(`画像 ${id} 加载`, imgOk[id] && imgOk[id].w > 0, JSON.stringify(imgOk[id]));
}

// 山君：自带特效文案
await page.locator('.treasure-modal .tp-card[data-tid="1126"]').click();
await page.waitForTimeout(300);
const detail = await page.locator('.treasure-modal .tp-detail').innerText();
ok('山君特效含破敌/骁锐/虎啸', /破敌/.test(detail) && /骁锐/.test(detail) && /虎啸/.test(detail));
await page.screenshot({ path: `${OUT}/02-shanjun-detail.png` });

// 下一步 → 词条池为空要给出补录提示，且能「不锻造」直接佩戴
await page.locator('.treasure-modal .tp-next').click();
await page.waitForTimeout(300);
const step2 = await page.locator('.treasure-modal .tp-body').innerText();
ok('空词条池提示', /锻造词条池尚未解出/.test(step2), step2.slice(0, 80));
await page.screenshot({ path: `${OUT}/03-shanjun-affix-empty.png` });
await page.locator('.treasure-modal .tp-skip').click();
await page.waitForTimeout(500);
const treasureChip = await page.locator('.hero-detail-modal .hd-treasure').first().innerText();
ok('佩戴成功（山君）', /山君/.test(treasureChip), treasureChip.replace(/\s+/g, ' '));
await page.screenshot({ path: `${OUT}/04-slot-with-shanjun.png` });

// 曹仁：发动率 40%（点武将池卡片会直接打开主将详情）
await page.evaluate(() => document.querySelectorAll('.modal-mask').forEach((m) => m.remove()));
await page.fill('.pool-search input', '曹仁');
await page.waitForTimeout(500);
await page.locator('.hero-grid .hero-card').first().click();
await page.waitForTimeout(600);
const modalText = await page.locator('.hero-detail-modal').innerText();
ok('曹仁详情出现', /曹仁/.test(modalText), modalText.slice(0, 40));
await page.locator('.hero-detail-modal .skill-slot-row.main').first().click();
await page.waitForTimeout(500);
const sdMeta = await page.locator('.skill-detail-modal .sd-meta').innerText();
const sdDesc = await page.locator('.skill-detail-modal .sd-desc').innerText();
ok('平壑拒吴 发动率 40%', /40%/.test(sdMeta), sdMeta.replace(/[\s]+/g, ' '));
ok('伤害率 210% / 怯战 2 回合未动', /210/.test(sdDesc) && /2/.test(sdDesc), sdDesc.replace(/[\s]+/g, ' ').slice(0, 120));
await page.screenshot({ path: `${OUT}/05-caoren-40.png` });

ok('无控制台错误', errors.length === 0, errors.join(' | '));

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ total: checks.length, failed: failed.length, checks, errors }, null, 1));
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
