/**
 * 公告栏视觉自检（可选工具，内部脚本 `_` 前缀）：
 * 用本机 headless Chrome/Edge + CDP 给主站公告栏拍四张图，并打印关键 DOM 状态，
 * 供"上线前 / 改完公告栏后"肉眼复核（配合 read_image 看 PNG）。
 *
 * 用法（先起服务：`npm run web` 或 `npx vite preview`）：
 *   node scripts/_announcement_shot.mjs http://localhost:5173/ ./shots
 *
 * 拍到的四张：
 *   1-fresh-dot.png   新装状态首页：顶栏「公告」带未读红点 + 底栏版本标记
 *   1b-nav-zoom.png   顶栏右侧放大（像素级确认红点）
 *   2-panel.png       点开公告栏：版本 → 更新改动 列表
 *   3-autopopup.png   模拟"新版本上线"（两个水位压到上一版后重载）→ 自动弹窗
 *   4-after-close.png 关闭后重载：不再自动弹
 *
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无需额外 npm 包。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const outDir = process.argv[3] ?? '.';
if (!url) {
  console.error('用法: node scripts/_announcement_shot.mjs <url> [outDir]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('没找到 Chrome / Edge，装一个再跑');

const W = 1440;
const H = 900;
const port = 9400 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-shot-'));
const child = spawn(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* devtools 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
async function waitEvent(method, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const i = events.findIndex((e) => e.method === method);
    if (i >= 0) return events.splice(i, 1)[0];
    await sleep(50);
  }
  throw new Error(`timeout waiting ${method}`);
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

async function shot(name, clip) {
  const res = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}
async function goto(target) {
  events.length = 0;
  await send('Page.navigate', { url: target }, sessionId);
  await waitEvent('Page.loadEventFired');
  await sleep(2500); // 等 Vite 模块 + 首屏渲染
}

// ① 新装状态（干净 profile，无 localStorage）：不弹窗 + 红点提示
await goto(url);
console.log(
  'state-1',
  await evaluate(`(() => {
    const nav = document.querySelector('[data-nav="notice"]');
    const tag = document.querySelector('.control-bar .build-tag');
    return JSON.stringify({
      navText: nav ? nav.textContent : null,
      navUnread: nav ? nav.classList.contains('has-unread') : null,
      navCount: document.querySelectorAll('.nav-link').length,
      buildTag: tag ? tag.textContent : null,
      buildTagIsButton: tag ? tag.tagName : null,
      hasPanel: Boolean(document.querySelector('.announcement-mask')),
      seen: localStorage.getItem('stzb_site_version_seen'),
      notified: localStorage.getItem('stzb_site_version_notified'),
    });
  })()`),
);
await shot('1-fresh-dot.png');
await shot('1b-nav-zoom.png', { x: 980, y: 0, width: 460, height: 64, scale: 3 });

// ② 点开公告栏
await evaluate(`document.querySelector('[data-nav="notice"]').click()`);
await sleep(600);
console.log(
  'state-2',
  await evaluate(`(() => {
    const m = document.querySelector('.announcement-mask .announcement-modal');
    return JSON.stringify({
      title: m ? m.querySelector('.m-head h3').textContent : null,
      versions: m ? Array.from(m.querySelectorAll('.an-ver')).map((e) => e.textContent) : null,
      items: m ? m.querySelectorAll('.an-list li').length : null,
      kinds: m ? Array.from(m.querySelectorAll('.an-kind')).map((e) => e.textContent) : null,
      seen: localStorage.getItem('stzb_site_version_seen'),
      navUnread: document.querySelector('[data-nav="notice"]').classList.contains('has-unread'),
    });
  })()`),
);
await shot('2-panel.png');

// ③ 模拟"新版本上线"：两个水位压到上一版 → 重载 → 自动弹窗
await evaluate(`(() => {
  localStorage.setItem('stzb_site_version_seen', '0.9');
  localStorage.setItem('stzb_site_version_notified', '0.9');
  return 'ok';
})()`);
await goto(url);
console.log(
  'state-3',
  await evaluate(`(() => {
    const m = document.querySelector('.announcement-mask .announcement-modal');
    return JSON.stringify({
      autoOpened: Boolean(m),
      title: m ? m.querySelector('.m-head h3').textContent : null,
      seen: localStorage.getItem('stzb_site_version_seen'),
      notified: localStorage.getItem('stzb_site_version_notified'),
    });
  })()`),
);
await shot('3-autopopup.png');

// ④ 关闭弹窗后再重载：不应再弹
await evaluate(`document.querySelector('.announcement-mask .m-close').click()`);
await goto(url);
console.log(
  'state-4',
  await evaluate(`JSON.stringify({
    reopened: Boolean(document.querySelector('.announcement-mask')),
    navUnread: document.querySelector('[data-nav="notice"]').classList.contains('has-unread'),
  })`),
);
await shot('4-after-close.png');

ws.close();
child.kill();
process.exit(0);
