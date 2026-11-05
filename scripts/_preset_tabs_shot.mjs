/**
 * 自检脚本（可复跑）：无头 Chrome 直驱主站，验证「预设」面板的「热门预设 / 我的预设」切换。
 * 断言：① 顶栏入口文案 = 预设；② 面板标题 = 预设；③ 默认看热门组（切换器两组带条数、列表全是热门）；
 *       ④ 点「另存为我的预设」→ 存进我的组并自动切过去、选中新条目；
 *       ⑤ 点回热门页签 → 列表回到热门组；⑥ 全程无 pageerror / console.error。
 * 用法：node scripts/_preset_tabs_shot.mjs [url] [outDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.argv[3] ?? join(tmpdir(), 'preset-tabs-verify');
mkdirSync(outDir, { recursive: true });

const W = 1180;
const H = 920;
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) throw new Error('本机没找到 Chrome / Edge');
const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-preset-tabs-'));
spawn(
  exe,
  [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`, 'about:blank',
  ],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* devtools 还没起来 */ }
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`[exception] ${msg.params?.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params)}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    problems.push(`[console.error] ${msg.params.entry.text}`);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false }, sessionId);

const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(outDir, name), Buffer.from(res.data, 'base64'));
  console.log('saved', join(outDir, name));
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
  return r.result.value;
};
const until = async (expr, timeout = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`until timeout: ${expr.slice(0, 120)}`);
    await sleep(200);
  }
};

/** 导航并等主站就绪；先压掉公告/声明弹窗水位，免得遮住面板 */
const gotoHome = async () => {
  const target = `${url}/`;
  await send('Page.navigate', { url: target }, sessionId);
  await until(`location.href === ${JSON.stringify(target)}`, 60000);
  await evaluate(`(() => {
    localStorage.setItem('stzb_site_version_seen', '1.20');
    localStorage.setItem('stzb_site_version_notified', '1.20');
    localStorage.setItem('stzb_disclaimer_seen', '1');
    return true;
  })()`);
  await send('Page.reload', {}, sessionId);
  await until(`!!document.querySelector('[data-nav="presets"]')`, 60000);
  await sleep(400);
};

const snap = () =>
  evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.preset-tab')].map((t) => ({
      tab: t.dataset.tab,
      text: t.textContent.trim(),
      on: t.classList.contains('on'),
    }));
    const items = [...document.querySelectorAll('.preset-item')].map((i) => ({
      name: i.querySelector('.pi-name')?.textContent.trim() ?? '',
      tag: i.querySelector('.pi-tag')?.textContent.trim() ?? null,
      no: i.querySelector('.pi-no')?.textContent.trim() ?? null,
    }));
    return {
      entry: document.querySelector('[data-nav="presets"]')?.textContent.trim() ?? '',
      modalTitle: document.querySelector('.modal h3')?.textContent.trim() ?? '',
      tabs,
      tabsHidden: document.querySelector('.preset-tabs')?.hidden ?? null,
      items,
      count: document.querySelector('.preset-count')?.textContent.trim() ?? '',
      detailTitle: document.querySelector('.preset-detail .pd-title')?.textContent.trim() ?? '',
      actions: [...document.querySelectorAll('.pd-actions .btn')].map((b) => b.textContent.trim()),
      empty: document.querySelector('.preset-empty')?.textContent.trim() ?? '',
      saving: !!document.querySelector('.preset-name-modal'),
    };
  })()`);

const log = (tag, s) =>
  console.log(
    `\n[${tag}]\n  入口：${s.entry}｜面板标题：${s.modalTitle}\n` +
      `  页签：${s.tabs.map((t) => `${t.text}${t.on ? '（选中）' : ''}`).join(' / ') || '（隐藏）'}\n` +
      `  计数：${s.count}\n  列表 ${s.items.length} 条：${s.items.map((i) => `[${i.tag ?? i.no}]${i.name}`).join('、') || '（空）'}\n` +
      `  空态：${s.empty || '（无）'}\n  详情：${s.detailTitle}｜动作：${s.actions.join(' / ')}`
  );

await gotoHome();

const pre = await snap();
log('主站就绪', pre);

await evaluate(`document.querySelector('[data-nav="presets"]').click(); true`);
await until(`!!document.querySelector('.preset-tabs')`, 20000);
await sleep(300);

const s1 = await snap();
log('默认（热门组）', s1);
await shot('1-hot.png');

await evaluate(`(document.querySelector('.preset-item') || { click() {} }).click(); true`);
await sleep(250);
const s2 = await snap();
log('选中第一条热门', s2);
await shot('2-hot-detail.png');

// 另存为我的预设 → 命名弹窗 → 确定
await evaluate(`document.querySelector('[data-act="copy"]').click(); true`);
await until(`!!document.querySelector('.preset-name-modal')`, 10000);
await shot('3-name-modal.png');
await evaluate(`(() => {
  const input = document.querySelector('.preset-name-modal .pn-input');
  input.value = '自检副本';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.preset-name-modal .pn-ok').click();
  return true;
})()`);
await sleep(500);
const s3 = await snap();
log('另存为我的预设之后', s3);
await shot('4-mine.png');

await evaluate(`document.querySelector('.preset-tab[data-tab="hot"]').click(); true`);
await sleep(300);
const s4 = await snap();
log('切回热门组', s4);
await shot('5-back-hot.png');

const checks = {
  entryRenamed: pre.entry === '预设',
  modalTitleRenamed: s1.modalTitle === '预设',
  twoTabsListed: s1.tabs.length === 2 && s1.tabs.map((t) => t.tab).join(',') === 'hot,mine',
  tabsShowCounts: s1.tabs.every((t) => /\d/.test(t.text)),
  defaultHot: s1.tabs.find((t) => t.on)?.tab === 'hot',
  hotListOnlyHot: s1.items.length > 0 && s1.items.every((i) => i.tag === '热门'),
  hotCountLine: /^热门预设 \d+ 条$/.test(s1.count),
  hotDetailHasNoRename: s2.actions.length > 0 && !s2.actions.includes('重命名') && !s2.actions.includes('删除'),
  copySwitchesToMine: s3.tabs.find((t) => t.on)?.tab === 'mine',
  copySelected: s3.detailTitle === '自检副本' && s3.actions.includes('重命名'),
  mineCountLine: /^我的预设 \d+ \/ \d+ 条$/.test(s3.count),
  backToHot: s4.tabs.find((t) => t.on)?.tab === 'hot' && s4.items.every((i) => i.tag === '热门'),
  noPageProblems: problems.length === 0,
};

writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ pre, s1, s2, s3, s4, problems, checks }, null, 2));
console.log('\n=== checks ===');
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
console.log(`  pageerror/console.error: ${problems.length ? problems.join(' | ') : '无'}`);
console.log(`  outDir: ${outDir}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
