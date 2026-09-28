/**
 * L3「优化武将（队友）」页面视觉自检（内部脚本 `_` 前缀）：
 * 用本机 headless Chrome/Edge + CDP 给 `optimize.html` 拍四张图，并打印关键 DOM 状态，
 * 供「改完 L2/L3 双模式页后」肉眼复核（配合 read_image 看 PNG）。
 *
 * 用法（先起服务：`npm run web`，默认 http://localhost:5173）：
 *   node scripts/_optimize_shot.mjs http://localhost:5173/optimize.html ./shots
 *
 * 拍到的四张：
 *   1-l2-mode.png    默认进 L2（优化战法）模式：左栏配置 + 右栏战法筛选栏
 *   2-l3-result.png  L3（优化武将）跑完：成对粗筛 / 组合榜单 / 决赛排行 + 应用按钮
 *   2b-l3-pair.png   ① 队友位粗筛区放大（确认「双位·成对评估」与有序对）
 *   3-l3-applied.png 点「应用」后：左栏同步换将 + 该位战法槽清空 + 摘要卡提示
 *   4-handoff-l2.png 点「→ 去 L2 优化战法」后：同一份左栏 + L2 筛选栏（两步衔接）
 *
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无需额外 npm 包。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/optimize.html';
const outDir = process.argv[3] ?? './shots';
mkdirSync(outDir, { recursive: true });

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('没找到 Chrome / Edge，装一个再跑');

const W = 1600;
const H = 1000;
const port = 9500 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'dsh-optimize-shot-'));
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
  { stdio: 'ignore' }
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
  if (!msg.method) return;
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`[exception] ${msg.params?.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params)}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    problems.push(`[console.error] ${msg.params.entry.text}`);
  }
  events.push(msg);
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
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

async function shot(name, clip) {
  const res = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
  return r.result.value;
}
async function goto(target) {
  events.length = 0;
  await send('Page.navigate', { url: target }, sessionId);
  await waitEvent('Page.loadEventFired');
  await sleep(3000); // 等 Vite 模块 + 首屏渲染
}

const stateDump = `JSON.stringify({
  modes: Array.from(document.querySelectorAll('.op-mode')).map((b) => b.textContent.trim() + (b.classList.contains('on') ? '(on)' : '')),
  unitCards: document.querySelectorAll('#op-config .rm-unit').length,
  l2Controls: Boolean(document.querySelector('#rm-sim-coarse')),
  l3Controls: Boolean(document.querySelector('#mt-coarse')),
  l3Matches: Array.from(document.querySelectorAll('[data-mt-match]')).map((b) => (b.checked ? 1 : 0)).join(''),
  l3Core: Array.from(document.querySelectorAll('[data-mt-core]')).map((b) => (b.checked ? 1 : 0)).join(''),
  resultHead: (document.querySelector('#op-result')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 260),
  applyButtons: document.querySelectorAll('#op-result [data-mate-apply], #op-result [data-sim-apply]').length,
  heroes: Array.from(document.querySelectorAll('[data-unit-hero]')).map((s) => s.options[s.selectedIndex]?.textContent ?? ''),
  skills: Array.from(document.querySelectorAll('[data-unit-skill]')).map((s) => s.value),
  note: (document.querySelector('#op-summary')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 200),
})`;

// ① 默认进入 L2 模式
await goto(url);
console.log('state-1-l2', await evaluate(stateDump));
await shot('1-l2-mode.png');

// ② 切 L3，把参数收小（真跑场次 ~900，约 3~5 s），跑成对评估
await evaluate(`document.querySelector('.op-mode[data-mode="l3"]').click()`);
await sleep(300);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('#mt-coarse', '1'); set('#mt-paircars', '3'); set('#mt-keep', '10'); set('#mt-top', '8');
  return 'ok';
})()`);
console.log('state-2-before', await evaluate(stateDump));
await evaluate(`document.querySelector('#mt-run').click()`);
for (let i = 0; i < 240; i += 1) {
  const st = await evaluate(`document.querySelector('#op-panel').dataset.state`);
  if (st === 'done' || st === 'error') {
    console.log('l3 run state =', st, `(${i} polls)`);
    break;
  }
  await sleep(500);
}
await sleep(400);
console.log('state-2-after', await evaluate(stateDump));
await shot('2-l3-result.png');
await shot('2b-l3-pair.png', { x: 396, y: 250, width: 1180, height: 520, scale: 1.4 });

// ③ 应用榜首队友 → 左栏同步换将 + 该位战法槽清空
await evaluate(`document.querySelector('#op-result [data-mate-apply]').click()`);
await sleep(500);
console.log('state-3-applied', await evaluate(stateDump));
await shot('3-l3-applied.png');

// ④ 两步衔接：切到 L2（同一份左栏配置）
await evaluate(`document.querySelector('#op-go-l2').click()`);
await sleep(400);
console.log('state-4-handoff', await evaluate(stateDump));
await shot('4-handoff-l2.png');

// ⑤ 回归：队里有赵云（互斥组「赵云」）→ 候选池含 SP赵云，跑批不能抛「配队非法」（用户 2026-09-28 卡点）
await goto(url);
await evaluate(`(() => {
  const sel = document.querySelector('[data-unit-hero="0"]');
  sel.value = 'zhaoyun';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await sleep(400);
await evaluate(`document.querySelector('.op-mode[data-mode="l3"]').click()`);
await sleep(300);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('#mt-coarse', '1'); set('#mt-paircars', '3'); set('#mt-keep', '10'); set('#mt-top', '8');
  return 'ok';
})()`);
console.log('state-5-before', await evaluate(stateDump));
await evaluate(`document.querySelector('#mt-run').click()`);
for (let i = 0; i < 240; i += 1) {
  const st = await evaluate(`document.querySelector('#op-panel').dataset.state`);
  if (st === 'done' || st === 'error') {
    console.log('l3 mutual-case run state =', st, `(${i} polls)`);
    break;
  }
  await sleep(500);
}
await sleep(400);
const mutual = await evaluate(`(() => {
  const t = document.querySelector('#op-result').textContent.replace(/\\s+/g, ' ');
  // 注意：口径提示里本身有「配队非法」四个字（解释互斥已被剔除）→ 只认真正的报错文案
  return JSON.stringify({
    hasIllegalError: t.includes('配队非法：') || t.includes('队友匹配失败') || t.includes('模拟测评失败'),
    mutualNote: t.includes('同队互斥已剔掉'),
    poolMutual: /互斥剔除 (\\d+)/.exec(document.querySelector('#op-result').textContent)?.[1] ?? null,
    head: t.slice(0, 200),
  });
})()`);
console.log('state-5-mutual', mutual);
await shot('5-mutual-exclusion.png');
// 口径提示在页面底部 → 滚到 ④ 段再拍一张，肉眼复核「互斥已剔除」那几条
await evaluate(`document.querySelector('.rm-sim-verdict').scrollIntoView({ block: 'start' })`);
await sleep(300);
await shot('5b-mutual-notes.png');

console.log(problems.length ? `PAGE PROBLEMS (${problems.length}):` : 'PAGE PROBLEMS: none');
problems.slice(0, 10).forEach((p) => console.log(' -', p.slice(0, 300)));

ws.close();
child.kill();
const bad = problems.length > 0 || JSON.parse(mutual).hasIllegalError || !JSON.parse(mutual).mutualNote;
process.exit(bad ? 1 : 0);
