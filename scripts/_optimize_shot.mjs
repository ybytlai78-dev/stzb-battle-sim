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

// ⑥ 回归（用户 2026-09-28 第 1 问）：L2 槽位级参与匹配 —— 只勾两个队友的「槽 2」时，
//    结果里**只能出现这两个槽的战法**（此前勾「核心位」不影响搜索范围，六个空槽会被一起搜）。
await goto(url);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('[data-unit-hero="0"]', 'h704'); // 文鸯
  set('[data-unit-hero="1"]', 'h498'); // 曹纯
  set('[data-unit-hero="2"]', 'h27');  // 张辽
  return 'ok';
})()`);
await sleep(400);
await evaluate(`(() => {
  // 先清空所有槽位勾选，再只勾「中军·槽2」「前锋·槽2」
  document.querySelector('[data-sim-slots="none"]').click();
  for (const key of ['1-1', '2-1']) {
    const el = document.querySelector('[data-sim-slot="' + key + '"]');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('#rm-sim-coarse', '1'); set('#rm-sim-keep', '8'); set('#rm-sim-top', '8'); set('#rm-sim-final', '20'); set('#rm-sim-finalmax', '40');
  return 'ok';
})()`);
console.log('state-6-before', await evaluate(stateDump));
await evaluate(`document.querySelector('#rm-sim-run').click()`);
for (let i = 0; i < 600; i += 1) {
  const st = await evaluate(`document.querySelector('#op-panel').dataset.state`);
  if (st === 'done' || st === 'error') {
    console.log('l2 slot-level run state =', st, `(${i} polls)`);
    break;
  }
  await sleep(500);
}
await sleep(400);
const slotLevel = await evaluate(`(() => {
  const t = (document.querySelector('#op-result')?.textContent ?? '').replace(/\\s+/g, ' ');
  const finalsSection = Array.from(document.querySelectorAll('.rm-sim-section')).find((s) =>
    (s.querySelector('h3')?.textContent ?? '').includes('③ 决赛排行')
  );
  const labels = Array.from(finalsSection?.querySelectorAll('tbody tr') ?? []).map((tr) =>
    (tr.children[1]?.textContent ?? '').trim()
  );
  const slotBoxes = Array.from(document.querySelectorAll('[data-sim-slot]')).map((b) => (b.checked ? 1 : 0)).join('');
  return JSON.stringify({
    matchedSlots: slotBoxes,
    head: t.slice(0, 240),
    finalsRows: labels.length,
    finalsLabels: labels.slice(0, 3),
    adaptive: /自动加跑 (\\d+) 场/.exec(t)?.[1] ?? null,
    ties: /重叠的有 (\\d+) 个/.exec(t)?.[1] ?? null,
  });
})()`);
console.log('state-6-slot-level', slotLevel);
await shot('6-l2-slot-level.png');
await evaluate(`document.querySelector('.rm-sim-verdict')?.scrollIntoView({ block: 'start' })`);
await sleep(300);
await shot('6b-l2-notes.png');

// ⑥b 同一会话里 L2 已跑过 → L3 面板应出现「⇦ 填入 L2 榜首战法」（两步衔接的反向入口）
await evaluate(`document.querySelector('.op-mode[data-mode="l3"]').click()`);
await sleep(300);
const l2Bridge = await evaluate(`JSON.stringify({ useL2: Boolean(document.querySelector('#mt-usel2')) })`);
console.log('state-6b-l2-bridge', l2Bridge);

// ⑦ 顺带看一眼被改过的另一个页面（round-model.html）：槽位级勾选与「决赛上限」控件在，且不报错
await goto(url.replace(/optimize\.html.*$/, 'round-model.html'));
const roundModel = await evaluate(`JSON.stringify({
  slots: document.querySelectorAll('[data-sim-slot]').length,
  finalMax: Boolean(document.querySelector('#rm-sim-finalmax')),
  adaptive: Boolean(document.querySelector('#rm-sim-adaptive')),
  groupTitles: Array.from(document.querySelectorAll('.rm-group-title')).map((e) => e.textContent.trim().slice(0, 12)),
  est: (document.querySelector('#rm-sim-est')?.textContent ?? '').trim(),
})`);
console.log('state-7-round-model', roundModel);
await shot('7-round-model-slots.png');

// ⑧ 回归（用户 2026-09-29）：「候选带入战法」口径 —— 先给两个队友位配好战法，再跑 L3，
//    结果里要写明本次基准战法、① 表要有「主战法」列，并且给一个「⇦ 填入 L2 榜首战法」的入口。
await goto(url);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('[data-unit-hero="0"]', 'h704'); // 文鸯（核心）
  set('[data-unit-hero="1"]', 'h498'); // 曹纯
  set('[data-unit-hero="2"]', 'h27');  // 张辽
  return 'ok';
})()`);
await sleep(300);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  // 中军位：长兵方阵 + 疏数；前锋位：先声夺人 + 攻其不备（用户上一轮 L2 榜首那套）
  set('[data-unit-skill="1-0"]', 'changbing_fangzhen'); set('[data-unit-skill="1-1"]', 'shushu');
  set('[data-unit-skill="2-0"]', 'xiansheng_duoren'); set('[data-unit-skill="2-1"]', 'gongqi_bubei');
  return 'ok';
})()`);
await sleep(300);
await evaluate(`document.querySelector('.op-mode[data-mode="l3"]').click()`);
await sleep(300);
await evaluate(`(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('#mt-coarse', '1'); set('#mt-keep', '10'); set('#mt-top', '8');
  return 'ok';
})()`);
const slotSkillsBefore = await evaluate(`JSON.stringify({
  mode: document.querySelector('#mt-slotskills')?.value ?? null,
  note: (document.querySelector('.rm-note')?.textContent ?? '').includes('保留'),
})`);
console.log('state-8-before', slotSkillsBefore);
await evaluate(`document.querySelector('#mt-run').click()`);
for (let i = 0; i < 600; i += 1) {
  const st = await evaluate(`document.querySelector('#op-panel').dataset.state`);
  if (st === 'done' || st === 'error') {
    console.log('l3 slot-skills run state =', st, `(${i} polls)`);
    break;
  }
  await sleep(500);
}
await sleep(400);
const slotSkills = await evaluate(`(() => {
  const t = (document.querySelector('#op-result')?.textContent ?? '').replace(/\\s+/g, ' ');
  const heads = Array.from(document.querySelectorAll('#op-result table thead tr')).map((tr) => tr.textContent.replace(/\\s+/g, ''));
  return JSON.stringify({
    hasMainSkillCol: heads.some((h) => h.includes('主战法')),
    kitNote: t.includes('候选进场带什么战法') && t.includes('保留该位已配战法'),
    kitNames: /长兵方阵|疏数|先声夺人/.test(t),
    head: t.slice(0, 180),
  });
})()`);
console.log('state-8-slot-skills', slotSkills);
await shot('8-l3-slot-skills.png');
await evaluate(`document.querySelector('#op-result .rm-sim-section')?.scrollIntoView({ block: 'start' })`);
await sleep(300);
await shot('8b-l3-main-skill-col.png');

console.log(problems.length ? `PAGE PROBLEMS (${problems.length}):` : 'PAGE PROBLEMS: none');
problems.slice(0, 10).forEach((p) => console.log(' -', p.slice(0, 300)));

ws.close();
child.kill();
const s5 = JSON.parse(mutual);
const s6 = JSON.parse(slotLevel);
const s7 = JSON.parse(roundModel);
const s8 = JSON.parse(slotSkills);
const bad =
  problems.length > 0 ||
  s5.hasIllegalError ||
  !s5.mutualNote ||
  s6.matchedSlots !== '000101' || // 勾的正是「中军·槽2 + 前锋·槽2」（DOM 顺序 = 每个将两格）
  !/2 个槽位/.test(s6.head) ||
  s6.finalsRows === 0 ||
  s6.finalsLabels.some((r) => r.includes('文鸯·')) || // 没勾的槽（文鸯两格）不该出现在结果里
  s7.slots !== 6 ||
  !s7.finalMax ||
  !s7.adaptive ||
  !s7.groupTitles.some((t) => t.includes('排序口径')) ||
  JSON.parse(slotSkillsBefore).mode !== 'keep' ||
  !JSON.parse(l2Bridge).useL2 ||
  !s8.hasMainSkillCol ||
  !s8.kitNote ||
  !s8.kitNames;
process.exit(bad ? 1 : 0);
