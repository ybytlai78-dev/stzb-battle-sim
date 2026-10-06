/**
 * AI 顾问 ·「思考模式路由」真机自检（内部脚本 `_` 前缀，S4）
 * ---------------------------------------------------------------------------
 * 无头 Chrome + CDP 直驱 **advisor-lab.html 的真传输链路**（不是干跑）：把设置指到脚本自起的
 * OpenAI 兼容 mock 端点，于是页面里每一次 `fetch` 都落在本脚本手里 —— 于是可以**从出站请求体**
 * 证明三件事（这才是"模型实际看到了什么"的硬证据）：
 *   ① 首轮锚定：会话第一个请求只带 4 个工具（get_config + 三个常驻）；
 *   ② 放开：跑成功一个工具后，下一个请求回到默认档（16 个工具）；
 *   ③ 注入：每个请求都带 Task 块（静态 system）与近场引导（贴在本轮提问之后）。
 * 再把 lab 的**路由面板**（S4 面板）截图留档给人眼复核。
 *
 * 用法（先起服务：`npm run web`，默认 http://localhost:5173）：
 *   node scripts/_advisor_routing_shot.mjs [http://localhost:5173] [输出目录]
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无额外 npm 包。
 * 产物：输出目录下 2 张 PNG + `summary.json`（逐请求工具面/注入块、面板文本、pageerror 清单）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.argv[3] ?? join(tmpdir(), 'advisor-routing-verify');
mkdirSync(outDir, { recursive: true });

// ─────────────────────────── ① mock 模型端点（OpenAI 兼容 + SSE + CORS） ───────────────────────────
// 行为：`mockMode='tools'` 时，若这一轮还没跑过工具且 get_config 在工具面里 → 回一个 get_config 调用；
// 否则回一段文本。两次提问之间由脚本切模式，用于观察"锚定 → 放开"。
let mockMode = 'text';
const mockRequests = [];
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const sse = (res, chunks) => {
  res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};
const mock = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let json = {};
    try {
      json = JSON.parse(body || '{}');
    } catch {
      /* 记原文 */
    }
    const messages = Array.isArray(json.messages) ? json.messages : [];
    const names = (Array.isArray(json.tools) ? json.tools : []).map((t) => t?.function?.name ?? t?.name ?? '?');
    const flat = JSON.stringify(messages);
    const afterTool = messages.some((m) => m.role === 'tool');
    mockRequests.push({
      n: mockRequests.length + 1,
      path: req.url,
      model: json.model ?? null,
      stream: json.stream === true,
      toolCount: names.length,
      tools: names,
      hasTask: flat.includes('本次会话的任务'),
      hasGuide: flat.includes('<advisor_route>'),
      afterTool,
    });
    if (mockMode === 'tools' && !afterTool && names.includes('get_config')) {
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_config', arguments: '{}' } }] } }] },
        { usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 } },
      ]);
    }
    return sse(res, [
      { choices: [{ delta: { content: '（mock 模型）看完了，这一问按当前工具面给结论。' } }] },
      { usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 } },
    ]);
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockBase = `http://127.0.0.1:${mock.address().port}`;

// ─────────────────────────── ② 无头 Chrome + CDP ───────────────────────────

const W = 1280;
const H = 1400;
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) throw new Error('本机没找到 Chrome / Edge');
const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-advisor-routing-shot-'));
spawn(
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
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
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
/** 4xx/5xx 的实际 URL（404 判定要**指出是谁**，不能只看一句 "Failed to load resource"） */
const httpErrors = [];
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
  if (msg.method === 'Network.responseReceived' && Number(msg.params?.response?.status) >= 400) {
    httpErrors.push(`${msg.params.response.status} ${msg.params.response.url}`);
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
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
  return r.result.value;
};
const until = async (expr, timeout = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`until timeout: ${expr.slice(0, 100)}`);
    await sleep(250);
  }
};

// ─────────────────────────── ③ 走流程 ───────────────────────────

const summary = { url, mockBase, steps: [], requests: mockRequests, problems };
const panel = `(document.querySelector('#lab-route')?.textContent ?? '')`;
const ask = async (q) => {
  await evaluate(`(() => { document.querySelector('#lab-q').value = ${JSON.stringify(q)}; document.querySelector('#lab-send').click(); return true; })()`);
};

const pageUrl = `${url.replace(/\/+$/, '')}/advisor-lab.html`;
events.length = 0;
await send('Page.navigate', { url: pageUrl }, sessionId);
await waitEvent('Page.loadEventFired');
await until(`document.querySelector('#lab-send') !== null`, 40000);

// 指到 mock 端点 + 关掉干跑（页面里 key 非空即走真传输；这里显式取消勾选）
await evaluate(`(() => {
  document.querySelector('#lab-base').value = ${JSON.stringify(`${mockBase}/v1`)};
  document.querySelector('#lab-model').value = 'ds-flash-mock';
  document.querySelector('#lab-key').value = 'sk-mock';
  document.querySelector('#lab-fake').checked = false;
  return true;
})()`);

// ① 第一问：mock 只回文本（不调工具）→ 锚定仍在，面板应显示"首轮锚定生效中 / 4 个工具"
mockMode = 'text';
await ask('帮我看下这队');
await until(`${panel}.includes('档位：')`, 40000);
await sleep(300);
summary.steps.push({ label: '1-首轮锚定（面板）', route: await evaluate(panel) });
await shot('1-anchor-first-request.png');

// ② 第二问：mock 回一个 get_config 调用 → 锚定放开 → 第二个请求回到默认档
mockMode = 'tools';
await ask('这队打木桩能打多少？');
await until(`${panel}.includes('档位：') && !${panel}.includes('首轮锚定生效中')`, 40000);
await sleep(300);
summary.steps.push({ label: '2-放开后（面板）', route: await evaluate(panel) });
await shot('2-anchor-released.png');

summary.toolSurfaces = mockRequests.map((r) => ({ n: r.n, tools: r.toolCount, first: r.tools.slice(0, 6), hasTask: r.hasTask, hasGuide: r.hasGuide }));
summary.httpErrors = httpErrors;
summary.problems = problems;
/** favicon 404 是这两个页面既有的（都没声明 favicon），不算本次改动的问题；其余 4xx/5xx 一律算 */
const realHttpErrors = httpErrors.filter((u) => !u.endsWith('/favicon.ico'));
const jsExceptions = problems.filter((p) => p.startsWith('[exception]'));
summary.pass = {
  首个请求只有4个工具: mockRequests[0]?.toolCount === 4,
  首请求含get_config与三常驻: ['get_config', 'tools_catalog', 'tools_help', 'route_task'].every((n) => mockRequests[0]?.tools.includes(n)),
  放开后回到默认档16个: mockRequests[2]?.toolCount === 16 && mockRequests[2]?.tools.includes('simulate'),
  每个请求都带Task块: mockRequests.every((r) => r.hasTask),
  每个请求都带近场引导: mockRequests.every((r) => r.hasGuide),
  JS异常0: jsExceptions.length === 0,
  HTTP错误0_favicon除外: realHttpErrors.length === 0,
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log('\n=== 逐请求工具面 ===');
for (const r of summary.toolSurfaces) console.log(`#${r.n} tools=${r.tools} task=${r.hasTask} guide=${r.hasGuide} | ${r.first.join(', ')}`);
console.log('\n=== 判定 ===');
for (const [k, v] of Object.entries(summary.pass)) console.log(`${v ? '✔' : '✘'} ${k}`);
console.log(`\nHTTP 4xx/5xx：${httpErrors.length ? httpErrors.join(' | ') : '0 条'}`);
console.log(`JS 异常 / console.error：${problems.length ? problems.join(' | ') : '0 条'}`);
console.log(`写入：${join(outDir, 'summary.json')}`);

mock.close();
ws.close();
process.exit(Object.values(summary.pass).every(Boolean) ? 0 : 1);
