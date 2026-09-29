/**
 * AI 顾问 ·「我的 box（识图）」真机自检（内部脚本 `_` 前缀）
 * ---------------------------------------------------------------------------
 * 无头 Chrome/Edge + CDP 直驱 vite dev server，走完**两条识图链路**并留图给人眼复核：
 *   ① 干跑（假传输）：空态面板 → 选图 → 识别 → 复核表（含"待确认""还没对上"）→ 发一问 → 方案卡被关 1 拒收（应用禁用）；
 *   ② 真传输 + 本机 mock 端点：把设置指到本脚本起的 OpenAI 兼容服务，**验证请求体里真的带 `image_url` + data URL**
 *      （即"用用户当前接入的模型识图"这条链在真浏览器里成立），再核对面板拿到识别结果。
 *
 * 用法（先起服务：`npm run web`，默认 http://localhost:5173）：
 *   node scripts/_advisor_box_shot.mjs http://localhost:5173 [输出目录]
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无需额外 npm 包。
 * 产物：输出目录下 4 张 PNG + `summary.json`（DOM 状态、mock 收到的请求形状、pageerror/console error 清单）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.argv[3] ?? join(tmpdir(), 'advisor-box-verify');
mkdirSync(outDir, { recursive: true });

// ─────────────────────────── ① mock 识图端点（OpenAI 兼容，带 CORS） ───────────────────────────

const VISION_REPLY = [
  '```json',
  JSON.stringify({
    heroes: [
      { name: '曹操', faction: '魏', troopType: '骑' },
      { name: '刘备', faction: '蜀', troopType: '步' },
      { name: '吕布', faction: '群', troopType: '弓' },
      { name: '根本不存在的将', faction: '群', troopType: '骑' },
    ],
    skills: [{ name: '大赏三军', grade: 'S' }, { name: '不存在战法', grade: 'A' }],
    unrecognized: ['右下角那个模糊头像'],
  }),
  '```',
].join('\n');

const mockRequests = [];
const mock = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
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
    const flat = JSON.stringify(json.messages ?? []);
    const images = (json.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url') : []));
    mockRequests.push({
      path: req.url,
      model: json.model ?? null,
      stream: json.stream ?? null,
      tools: Array.isArray(json.tools) ? json.tools.length : 0,
      imageParts: images.length,
      imagePrefix: images[0]?.image_url?.url?.slice(0, 32) ?? null,
      imageBytes: images[0]?.image_url?.url?.length ?? 0,
      systemHasVisionPrompt: flat.includes('读图员'),
    });
    const content = images.length ? VISION_REPLY : '（mock）我只回答问题。';
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      })
    );
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;
const mockBase = `http://127.0.0.1:${mockPort}/v1`;
console.log('mock endpoint:', mockBase);

// ─────────────────────────── ② 无头浏览器（与 `_optimize_shot.mjs` 同款探测） ───────────────────────────

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('没找到 Chrome / Edge，装一个再跑');

const W = 1500;
const H = 1000;
const port = 9500 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'dsh-advisor-box-shot-'));
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

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
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
  await sleep(3000);
}
/** 轮询等待页面里的条件成立（返回其值） */
async function until(expr, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`until timeout: ${expr.slice(0, 120)}`);
    await sleep(300);
  }
}

/** 在页面里合成一张"截图"（真 canvas → PNG blob → File），挂到文件输入上并触发 change（走的是生产那条压缩链）
 *  尺寸故意开到 2600×1800：**逼出"长边压到 1600 + 转 JPEG"那条路**（小图会原样返回，验证不到压缩）。 */
const ATTACH = `(async () => {
  const c = document.createElement('canvas');
  c.width = 2600; c.height = 1800;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, 2600, 1800);
  ctx.fillStyle = '#e8d9a8'; ctx.font = '96px sans-serif';
  ctx.fillText('五星武将 / 五星战法（自检合成图）', 120, 210);
  ctx.fillStyle = '#cfcfcf'; ctx.font = '72px sans-serif';
  ['曹操 魏 骑', '刘备 蜀 步', '吕布 群 弓', '大赏三军 S'].forEach((t, i) => ctx.fillText(t, 180, 430 + i * 130));
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'box-shot.png', { type: 'image/png' });
  const input = document.querySelector('.advisor-box-file');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return file.size;
})()`;

const boxState = `JSON.stringify({
  mounted: document.querySelector('.advisor-box-file') !== null,
  sheetOpen: document.querySelector('.advisor-sheet[data-sheet-panel="box"]')?.classList.contains('on') ?? false,
  sum: (document.querySelector('.advisor-box-sum')?.textContent ?? '').trim(),
  status: (document.querySelector('.advisor-box-status')?.textContent ?? '').trim(),
  thumbs: document.querySelectorAll('.abr-thumb').length,
  heroes: document.querySelectorAll('.abr-col:nth-child(1) .abr-item').length,
  skills: document.querySelectorAll('.abr-col:nth-child(2) .abr-item').length,
  pending: document.querySelectorAll('.abr-pending-row').length,
  unmatched: (document.querySelector('.abr-unmatched')?.textContent ?? '').trim().slice(0, 120),
  review: (document.querySelector('.advisor-box-review')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 400),
  plan: (document.querySelector('.advisor-plan-card')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 400),
  applyDisabled: document.querySelector('.advisor-apply') ? document.querySelector('.advisor-apply').disabled : null,
  cardRect: (() => { const r = document.querySelector('.advisor-plan-card')?.getBoundingClientRect(); return r ? [Math.round(r.top), Math.round(r.bottom)] : null; })(),
  winH: window.innerHeight,
  stored: (localStorage.getItem('dsh-advisor-box-v1') ?? '').slice(0, 400)
})`;

const summary = { url, mockBase, steps: [] };
const record = async (label) => {
  const state = JSON.parse(await evaluate(boxState));
  summary.steps.push({ label, ...state });
  console.log(`\n[${label}]`, JSON.stringify(state, null, 1).slice(0, 1200));
  return state;
};

// ─────────────────────────── ③ 走流程（AI配将独立页 advisor.html，2026-09-29 页面改版后） ───────────────────────────

const pageUrl = /advisor\.html/.test(url) ? url : `${url.replace(/\/+$/, '')}/advisor.html`;
await goto(pageUrl);
await until(`document.querySelector('.advisor-box-file') !== null`, 40000);
// 打开「我的 box」面板（顶部 chip 与左栏按钮都是 [data-sheet="box"]）
await evaluate(`document.querySelector('[data-sheet="box"]').click()`);
await until(`document.querySelector('.advisor-sheet[data-sheet-panel="box"]')?.classList.contains('on')`);
await sleep(300);
await record('1-空 box 面板');
await shot('1-box-empty.png');

// ① 干跑（没配 key → 自动干跑）：选图 → 识别 → 复核表
await evaluate(ATTACH);
await until(`document.querySelector('.abr-thumb') !== null`);
await evaluate(`document.querySelector('.advisor-box-run').click()`);
await until(`(document.querySelector('.advisor-box-status')?.textContent ?? '').includes('识别完成')`);
await sleep(300);
const recognized = await record('2-识别完成（干跑示例）');
await shot('2-box-recognized.png');

// ② 发一问：干跑脚本给的三将方案（≠ 上面识别出的 box）→ 标出 box 外 + 应用禁用（**不算不合法**）
await evaluate(`(() => {
  const ta = document.querySelector('.advisor-input');
  ta.value = '这队现在打木桩能打多少？';
  document.querySelector('.advisor-send').click();
  return true;
})()`);
await until(`document.querySelector('.advisor-plan-card') !== null`, 60000);
await evaluate(`document.querySelector('.advisor-plan-card')?.scrollIntoView({ block: 'center' })`);
await sleep(400);
const blocked = await record('3-方案含 box 外的将法（应用禁用）');
// 方案卡应完整可见（真机曾抓到被 overflow:hidden 裁掉）
const planVisible = await evaluate(`(() => {
  const r = document.querySelector('.advisor-plan-card')?.getBoundingClientRect();
  return r ? r.top >= 0 && r.bottom <= window.innerHeight + 1 : false;
})()`);
summary.planVisibleAfterScroll = planVisible;
await shot('3-plan-blocked.png');

// ③ 真传输 + mock 端点：走设置弹窗（新页面把模型接入放在 ⚙ 设置里）→ 清空 box → 再识别一次（这次真的发 HTTP）
await evaluate(`document.querySelector('[data-settings]').click()`);
await until(`document.querySelector('#advisor-settings-modal')?.classList.contains('on')`, 20000);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const fake = document.querySelector('#set-fake');
  if (fake) { fake.checked = false; fake.dispatchEvent(new Event('change', { bubbles: true })); }
  set('#adv-base', ${JSON.stringify(mockBase)});
  set('#adv-model', 'ds-flash-mock');
  set('#adv-key', 'sk-mock');
  return true;
})()`);
await evaluate(`document.querySelector('#advisor-settings-modal [data-set-close]').click()`);
await sleep(200);
await evaluate(`document.querySelector('.advisor-box-clear').click()`);
await evaluate(`document.querySelector('.advisor-box-clear').click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-sheet="box"]').click()`);
await sleep(200);
await evaluate(ATTACH);
await until(`document.querySelector('.abr-thumb') !== null`);
await evaluate(`document.querySelector('.advisor-box-run').click()`);
await until(`(document.querySelector('.advisor-box-status')?.textContent ?? '').includes('识别完成')`, 60000);
await sleep(300);
const real = await record('4-真传输识别（mock 端点）');
await evaluate(`document.querySelector('.advisor-sheet[data-sheet-panel="box"]')?.scrollIntoView({ block: 'start' })`);
await sleep(300);
await shot('4-box-vision-real.png');

summary.mockRequests = mockRequests;
summary.problems = problems;
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

// ─────────────────────────── ④ 断言 + 收尾 ───────────────────────────

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
ok(recognized.heroes === 3, `干跑识别应得 3 个武将，实际 ${recognized.heroes}`);
ok(recognized.pending >= 1, '应有"待确认"条目（同名多版 / 库里没有）');
ok(/还没对上/.test(recognized.unmatched), '应把没对上的原始名字记下来');
ok(blocked.applyDisabled === true, 'box 外的方案应禁用「应用」');
// 口径（用户 2026-09-29 修正）：box 外的将法**不算不合法** —— 卡上要标出来，但不能写「不合法」
ok(/含你 box 外的将法/.test(blocked.plan), `方案卡应标出"含 box 外的将法"，实际：${blocked.plan.slice(0, 160)}`);
ok(!/不合法/.test(blocked.plan), `box 外的将法不该被写成"不合法"，实际：${blocked.plan.slice(0, 160)}`);
ok(/八回合全队总伤/.test(blocked.plan) && /前三回合爆发/.test(blocked.plan), `方案卡应给出八回合总伤 / 前三回合爆发，实际：${blocked.plan.slice(0, 200)}`);
ok(planVisible, '方案卡应完整可见（不能被 overflow:hidden 裁掉）');
const visionReq = mockRequests.find((r) => r.imageParts > 0);
ok(Boolean(visionReq), 'mock 端点应收到带图片的请求');
if (visionReq) {
  ok(visionReq.imageParts >= 1, '请求体应含 image_url 段');
  ok(String(visionReq.imagePrefix).startsWith('data:image/'), `图片应是 data URL，实际 ${visionReq.imagePrefix}`);
  // 大图（2600×1800 PNG，原图约 MB 级）必须走压缩：长边 1600 + JPEG → 体积明显下降
  ok(String(visionReq.imagePrefix).startsWith('data:image/jpeg'), `大图应被压成 JPEG，实际 ${visionReq.imagePrefix}`);
  ok(visionReq.imageBytes > 0 && visionReq.imageBytes < 1_500_000, `压缩后不该超过 1.5MB，实际 ${visionReq.imageBytes}`);
  ok(visionReq.systemHasVisionPrompt, '应带读图系统提示词');
  ok(visionReq.tools === 0, '识图请求不该带 tools');
}
ok(real.heroes === 3, `真传输识别应得 3 个武将，实际 ${real.heroes}`);
ok(problems.length === 0, `页面不该有 pageerror / console.error：${problems.join(' | ')}`);

console.log('\n=== mock 收到的请求 ===');
console.log(JSON.stringify(mockRequests, null, 1));
console.log('\n=== 结果 ===');
console.log(fails.length ? `FAIL\n- ${fails.join('\n- ')}` : 'PASS（全部断言通过）');
console.log('截图与 summary.json 在', outDir);

child.kill();
mock.close();
process.exit(fails.length ? 1 : 0);
