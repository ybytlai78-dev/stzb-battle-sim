/**
 * 1.14 上线自检（线上站点视觉证据）：底栏版本号 + 公告栏有一条 1.14
 * 用法：node scripts/_shot_live_114.mjs [url] [outDir]
 * 产物：notice-114.png（公告弹窗）/ footer-114.png（底栏版本标记）/ summary.json（DOM 文本 + 控制台报错）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'https://ybytlai78-dev.github.io/stzb-battle-sim/';
const outDir = process.argv[3] ?? join(process.cwd(), '.verify-live-114');
mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 900;
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) throw new Error('本机没找到 Chrome / Edge');
const port = 9800 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), 'dsh-live114-shot-'));
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

// 模拟「老用户」：公告水位停在 1.13 → 新版本上线后首次进入应自动弹一次公告
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try {
    localStorage.setItem('stzb_disclaimer_seen', '1');
    localStorage.setItem('stzb_site_version_seen', '1.13');
    localStorage.setItem('stzb_site_version_notified', '1.13');
  } catch (e) {}`,
}, sessionId);
await send('Page.navigate', { url }, sessionId);
await until(`document.readyState === 'complete'`, 60000);
await until(`!!document.querySelector('[data-nav="notice"]')`, 40000);
// 声明弹窗（首访）若还在，先关掉，避免遮挡公告
await evaluate(`(() => {
  for (const m of document.querySelectorAll('.modal-mask')) {
    const t = m.innerText || '';
    if (t.includes('声明')) {
      const btn = m.querySelector('.m-close, .close, [data-close], button');
      if (btn) btn.click(); else m.remove();
    }
  }
  return true;
})()`);
await sleep(600);
summary.text.footerVersion = await evaluate(
  `(document.querySelector('.site-version, .build-tag, footer')?.innerText || '').trim()`
);
summary.text.footerHtml = await evaluate(`(document.querySelector('footer')?.innerHTML || '').slice(0, 600)`);

// ① 公告弹窗
await evaluate(`document.querySelector('[data-nav="notice"]').click(); true`);
await until(`!!document.querySelector('.modal-mask')`, 15000);
await sleep(600);
summary.text.notice = await evaluate(
  `[...document.querySelectorAll('.modal-mask')].map(m => m.innerText).join('\\n=====\\n').slice(0, 3000)`
);
await shot('notice-114.png');
summary.shots.push('notice-114.png');

// ② 关公告 → 底栏版本标记
await evaluate(`(() => {
  const m = [...document.querySelectorAll('.modal-mask')].pop();
  const btn = m?.querySelector('.m-close, .close, [data-close], button');
  if (btn) btn.click(); else m?.remove();
  return true;
})()`);
await sleep(400);
await evaluate(`window.scrollTo(0, document.body.scrollHeight); true`);
await sleep(400);
summary.text.footer = await evaluate(`(document.querySelector('footer')?.innerText || '').trim()`);
await shot('footer-114.png');
summary.shots.push('footer-114.png');

// ③ 直接读公告数据（不依赖 DOM 选择器）
summary.text.versionInPage = await evaluate(`(() => {
  const hits = [];
  for (const el of document.querySelectorAll('body *')) {
    const t = (el.childNodes.length === 1 && el.firstChild?.nodeType === 3) ? el.textContent.trim() : '';
    if (t && /^v?1\\.1\\d/.test(t)) hits.push(t);
  }
  return [...new Set(hits)].slice(0, 10);
})()`);

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('problems:', problems);
console.log('versionInPage:', summary.text.versionInPage);
console.log('summary written');
ws.close();
process.exit(0);
