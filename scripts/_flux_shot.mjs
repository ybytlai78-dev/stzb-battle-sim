/**
 * 敛微穷极 ·「伤害率 + 浮动区间」视觉自检（内部脚本 `_` 前缀）
 * ---------------------------------------------------------------------------
 * 验证 2026-10-23 改动在**详情战报**里的可读性：
 *   ① 每条谋略伤害行尾带「伤害率 X%（浮动 a%~b% → c%）」，且 X = 战法基础率 × c%;
 *   ② 浮动区间逐回合收敛（第 1 回合宽 → 第 3 回合更窄）；
 *   ③ 状态行不再是写死的「80%~150%（收敛至 115%）」，而是当前回合的真实区间。
 *
 * 用法（先起服务：`npm run web`，默认 http://localhost:5173）：
 *   node scripts/_flux_shot.mjs [http://127.0.0.1:5173] [输出目录]
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无额外 npm 包。
 * 产物：输出目录下 2 张 PNG + summary.json（逐条伤害率取证 + 断言 + 页面错误）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const outDir = process.argv[3] ?? join('verify-shots', 'flux-rate-20261023');
mkdirSync(outDir, { recursive: true });

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('没找到 Chrome / Edge，装一个再跑');

const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-flux-shot-'));
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
    '--window-size=1440,1100',
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
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params?.exceptionDetails?.exception?.description ?? 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      pageErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

const url = `${base.replace(/\/$/, '')}/scripts/_flux_shot.html`;
await send('Page.navigate', { url }, sessionId);

let ready = false;
for (let i = 0; i < 200; i += 1) {
  try {
    ready = await evaluate('Boolean(window.__READY)');
  } catch {
    ready = false;
  }
  if (ready) break;
  await sleep(150);
}
if (!ready) throw new Error(`页面未就绪（${url}）: ${pageErrors.join(' | ')}`);

const flux = await evaluate('window.__FLUX');
const report = {
  url,
  rounds: flux.rounds,
  hits: flux.hits,
  applied: flux.applied,
  converged: flux.converged,
  shots: [],
  assertions: [],
  pageErrors,
};

// 断言 ①：每条谋略伤害都有 damageRate；有浮动的 factor 落在区间内
const bad = flux.hits.filter((h) => !(h.damageRate > 0));
report.assertions.push({ name: '每条谋略伤害都带 damageRate', ok: bad.length === 0, detail: `缺 ${bad.length} 条` });
const outOfRange = flux.hits.filter(
  (h) => h.rateFlux && (h.rateFlux.factor < h.rateFlux.low || h.rateFlux.factor > h.rateFlux.high)
);
report.assertions.push({ name: '浮动系数落在本回合区间内', ok: outOfRange.length === 0, detail: `越界 ${outOfRange.length} 条` });

// 断言 ②：区间逐回合收敛（事件顺序即时间顺序）——下限不降、上限不升
const fluxed = flux.hits.filter((h) => h.rateFlux);
let mono = true;
for (let i = 1; i < fluxed.length; i += 1) {
  if (fluxed[i].rateFlux.low < fluxed[i - 1].rateFlux.low) mono = false;
  if (fluxed[i].rateFlux.high > fluxed[i - 1].rateFlux.high) mono = false;
}
report.assertions.push({ name: '区间随时间单调收敛', ok: mono, detail: `${fluxed.length} 条浮动伤害` });

// 断言 ③：状态行文案是真实区间，不再写死 115%
const stale = [...flux.applied, ...flux.converged].filter((t) => t.includes('115%'));
report.assertions.push({ name: '状态行不再写死「收敛至 115%」', ok: stale.length === 0, detail: `残留 ${stale.length} 条` });

// 截图：第 1 回合（最宽区间）与第 3 回合（已收敛）
for (const [round, name] of [
  [1, 'round1-wide-range'],
  [3, 'round3-converged'],
]) {
  const ok = await evaluate(`window.__focus(${round})`);
  await sleep(400);
  const file = await shot(name);
  report.shots.push({ round, file, found: ok });
}

// 界面文本取证：实际渲染出来的那一行小字
report.rendered = await evaluate(`Array.from(document.querySelectorAll('.dmg-rate')).slice(0, 6).map((el) => el.textContent)`);
report.viewportText = await evaluate(
  `(() => { const el = document.querySelector('.battle-view'); return el ? el.innerText.slice(0, 1500) : ''; })()`
);

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outDir, assertions: report.assertions, shots: report.shots, rendered: report.rendered }, null, 2));

ws.close();
child.kill();
process.exit(0);
