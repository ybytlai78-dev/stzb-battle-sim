/**
 * 上架自检：十常侍 / 乱政 的页面视觉证据（内部脚本 `_` 前缀）
 * 用法：先 `npm run web`（默认 http://localhost:5173），再 `node scripts/_shot_luanzheng.mjs [url] [outDir]`
 * 产物：hero-pool.png（搜索「十常侍」后的武将池）/ hero-detail.png（武将详情，含主战法「乱政」）/
 *       skill-bag.png（战法背包搜「乱政」）/ summary.json（关键 DOM 文本 + 控制台报错）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.argv[3] ?? join(process.cwd(), '.verify-luanzheng');
mkdirSync(outDir, { recursive: true });

const W = 1440;
const H = 1200;
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) throw new Error('本机没找到 Chrome / Edge');
const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-luanzheng-shot-'));
spawn(exe, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* devtools 未就绪 */ }
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
    if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') problems.push(`[exception] ${msg.params?.exceptionDetails?.exception?.description ?? ''}`);
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') problems.push(`[console.error] ${msg.params.entry.text}`);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

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
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
};

const summary = { url, shots: [], text: {}, problems };

// ① 首页 + 搜「十常侍」
// 预置水位：跳过首次访问的「声明」弹窗与公告弹窗，避免遮挡页面截图
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try {
    localStorage.setItem('stzb_disclaimer_seen', '1');
    localStorage.setItem('stzb_site_version_seen', '${'1.12'}');
    localStorage.setItem('stzb_site_version_notified', '${'1.12'}');
  } catch (e) {}`,
}, sessionId);
await send('Page.navigate', { url }, sessionId);
// 兜底：若仍有遮罩弹窗，点掉关闭按钮
await evaluate(`(() => {
  for (const m of document.querySelectorAll('.modal-mask, .page-mask')) {
    const btn = m.querySelector('.m-close, .close, [data-close]');
    if (btn) btn.click(); else m.remove();
  }
  return true;
})()`);
await until(`!!document.querySelector('.hero-card')`, 40000);
await evaluate(`(() => {
  const inp = document.querySelector('input[placeholder^="搜索武将名"]');
  inp.value = '十常侍';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await until(`document.querySelectorAll('.hero-card').length === 1 && document.querySelector('.hero-card[data-hero-id="h2"]')`, 15000);
summary.text.poolCard = await evaluate(`document.querySelector('.hero-card[data-hero-id="h2"]').innerText.split(String.fromCharCode(10)).join(' | ')`);
summary.text.poolCardTitle = await evaluate(`document.querySelector('.hero-card[data-hero-id="h2"]').title`);
summary.text.poolOffline = await evaluate(`document.querySelector('.hero-card[data-hero-id="h2"]').classList.contains('offline')`);
await evaluate(`document.querySelector('.hero-card[data-hero-id="h2"]').scrollIntoView({block:'center'})`);
await sleep(300);
await shot('hero-pool.png');
summary.shots.push('hero-pool.png');

// ② 点开武将详情
await evaluate(`document.querySelector('.hero-card[data-hero-id="h2"]').click()`);
await until(`!!document.querySelector('.hero-detail-modal')`, 15000);
await sleep(500);
summary.text.detail = await evaluate(`document.querySelector('.hero-detail-modal').innerText`);
await shot('hero-detail.png');
summary.shots.push('hero-detail.png');

// ③ 主战法「乱政」详情弹窗（战法背包只列可装配战法、不含主战法，故从武将详情的主战法条进入）
await evaluate(`document.querySelector('.hero-detail-modal .skill-slot-row.main')?.click(); true`);
await until(`!!document.querySelector('.skill-detail-modal')`, 15000);
await sleep(400);
summary.text.skillDetail = await evaluate(`document.querySelector('.skill-detail-modal').innerText`);
await shot('skill-detail.png');
summary.shots.push('skill-detail.png');

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('problems:', problems);
console.log('summary written');
ws.close();
process.exit(0);
