/**
 * 临时自检（跑完即删）：无头 Chrome 直驱 advisor.html，验证「对手池参战开关」。
 * 断言：① 固定集 8 支全部列出；② 点开关 → 该条变「已关」、计数器变；③ 刷新后仍关着（持久化）；
 *       ④ 再点回来 → 恢复；⑤ 全程无 pageerror / console.error。
 * 用法：node scripts/_pool_toggle_shot.mjs [url] [outDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.argv[3] ?? join(tmpdir(), 'pool-toggle-verify');
mkdirSync(outDir, { recursive: true });

const W = 900;
const H = 1000;
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) throw new Error('本机没找到 Chrome / Edge');
const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-pool-toggle-'));
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
const until = async (expr, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`until timeout: ${expr.slice(0, 120)}`);
    await sleep(200);
  }
};

const openPool = async () => {
  await until(`!!document.querySelector('[data-sheet="pool"]')`, 45000);
  await evaluate(`document.querySelector('[data-sheet="pool"]').click(); true`);
  await until(`document.querySelectorAll('.advisor-pool-row').length > 0`, 45000);
};

/** 导航并等 URL 落地（readyState 在 about:blank 上也是 complete，不能拿它当就绪判据） */
const gotoAdvisor = async () => {
  const target = `${url}/advisor.html`;
  await send('Page.navigate', { url: target }, sessionId);
  await until(`location.href === ${JSON.stringify(target)}`, 60000);
  await openPool();
};

const snapshot = () =>
  evaluate(`(() => {
    const rows = [...document.querySelectorAll('.advisor-pool-row')];
    const head = document.querySelector('.advisor-pool-list .advisor-note')?.textContent ?? '';
    const off = JSON.parse(localStorage.getItem('dsh-advisor-opponents-off-v1') || '[]');
    return {
      head,
      count: rows.length,
      notes: rows.map((r) => r.querySelector('.advisor-pool-note').textContent),
      badges: rows.map((r) => r.querySelector('.advisor-pool-badge').textContent),
      switchLabels: rows.map((r) => r.querySelector('.advisor-pool-switch').textContent),
      offRows: rows.filter((r) => r.classList.contains('off')).map((r) => r.querySelector('.advisor-pool-note').textContent),
      onClasses: rows.map((r) => r.querySelector('.advisor-pool-switch').classList.contains('on')),
      storageOff: off,
    };
  })()`);

const log = (tag, s) =>
  console.log(`\n[${tag}]\n  标题：${s.head}\n  条数 ${s.count}｜开 ${s.onClasses.filter(Boolean).length}｜关 ${s.offRows.length}\n  已关：${s.offRows.join('、') || '（无）'}\n  存储：${JSON.stringify(s.storageOff)}`);

await gotoAdvisor();

const s1 = await snapshot();
log('初始', s1);
await shot('1-initial.png');

// 关掉第 1 条固定对手
await evaluate(`document.querySelectorAll('.advisor-pool-switch')[0].click(); true`);
await sleep(200);
const s2 = await snapshot();
log('关掉第 1 条后', s2);
await shot('2-one-off.png');

// 刷新 → 应仍然关着（持久化）
await gotoAdvisor();
const s3 = await snapshot();
log('刷新后', s3);
await shot('3-after-reload.png');

// 再关一条（第 5 条，固定集扩出来的那批里的一条），然后点回来
await evaluate(`document.querySelectorAll('.advisor-pool-switch')[4].click(); true`);
await sleep(150);
const s4 = await snapshot();
log('再关第 5 条', s4);
await shot('4-two-off.png');
await evaluate(`document.querySelectorAll('.advisor-pool-switch')[4].click(); true`);
await sleep(150);
const s5 = await snapshot();
log('第 5 条点回来', s5);
await shot('5-toggled-back.png');

const summary = {
  initial: s1,
  oneOff: s2,
  afterReload: s3,
  twoOff: s4,
  toggledBack: s5,
  pageProblems: problems,
  checks: {
    eightFixedListed: s1.count === 8 && s1.badges.every((b) => b === '固定'),
    toggleMarksOff: s2.offRows.length === 1 && s2.head.includes('已关 1'),
    persistedAfterReload: s3.offRows.length === 1 && s3.storageOff.length === 1,
    secondToggleCounts: s4.offRows.length === 2 && s4.head.includes('已关 2'),
    toggleBackRestores: s5.offRows.length === 1 && s5.storageOff.length === 1,
    noPageProblems: problems.length === 0,
  },
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\n=== checks ===');
for (const [k, v] of Object.entries(summary.checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
console.log(`  pageerror/console.error: ${problems.length ? problems.join(' | ') : '无'}`);
process.exit(Object.values(summary.checks).every(Boolean) ? 0 : 1);
