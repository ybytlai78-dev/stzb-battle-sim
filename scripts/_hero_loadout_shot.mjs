/**
 * 自检脚本（可复跑）：无头 Chrome 直驱主站，验证「武将配置回池保留 + 详情页方案」。
 * 断言：① 详情页有「方案」页签；② 空档给空态；③ 保存后出现「方案一」+ 摘要（战法/加点/宝物/红度）；
 *       ④ 改红度再存 → 两条；⑤ 套用方案一把配置写回槽位；⑥ 卸下回池再从池里放入 → 配置仍是方案一的那套；
 *       ⑦ 全程无 pageerror / console.error。
 * 用法：node scripts/_hero_loadout_shot.mjs [url] [outDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.argv[3] ?? join(tmpdir(), 'hero-loadout-verify');
mkdirSync(outDir, { recursive: true });

const HERO_ID = 'h704'; // 文鸯（用户例子）
const SKILLS = ['jishi', 'xiaoxiong']; // 击势 / 枭雄
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
const profile = mkdtempSync(join(tmpdir(), 'dsh-hero-loadout-'));
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'log') {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (text.includes('[pick]') || text.includes('[refresh]') || text.includes('[pick-err]') || text.includes('[pick-after]')) {
      console.log('[page]', text);
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

/** 预置：一条「我的预设」（文鸯 击势+枭雄 · 全攻 40 · 满红），随后从预设面板上场到红队 */
const seed = () => `(() => {
  const slot = {
    heroId: ${JSON.stringify(HERO_ID)},
    extraSkillIds: ${JSON.stringify(SKILLS)},
    freePoints: { attack: 40, defense: 0, strategy: 0, speed: 0 },
    redness: 5,
    level: 40,
    treasure: null,
  };
  const empty = () => ({ heroId: null, extraSkillIds: [], freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 }, redness: 0, level: 40, treasure: null });
  const now = Date.now();
  localStorage.setItem('stzb_team_presets', JSON.stringify({
    maxNo: 1,
    list: [{ id: 'preset_selfcheck', no: 1, name: '自检·文鸯', side: 'red', slots: [slot, empty(), empty()], createdAt: now, updatedAt: now }],
  }));
  localStorage.setItem('stzb_hero_config_v1', JSON.stringify({
    last: { ${JSON.stringify(HERO_ID)}: { extraSkillIds: ${JSON.stringify(SKILLS)}, freePoints: { attack: 40, defense: 0, strategy: 0, speed: 0 }, redness: 5, level: 40, treasure: null } },
    plans: {},
  }));
  localStorage.setItem('stzb_site_version_seen', '1.22');
  localStorage.setItem('stzb_site_version_notified', '1.22');
  localStorage.setItem('stzb_disclaimer_seen', '1');
  return true;
})()`;

const teamSlot = () =>
  evaluate(`(() => {
    const raw = localStorage.getItem('stzb_team_current');
    if (!raw) return null;
    const s = JSON.parse(raw).red[0];
    return { heroId: s.heroId, skills: s.extraSkillIds, points: s.freePoints, redness: s.redness };
  })()`);

const snap = () =>
  evaluate(`(() => ({
    tabs: [...document.querySelectorAll('.hd-tab')].map((t) => t.textContent.trim()),
    panel: !!document.querySelector('.hd-plans'),
    empty: document.querySelector('.hd-plan-empty')?.textContent.trim() ?? '',
    count: document.querySelector('.hp-count')?.textContent.trim() ?? '',
    cur: document.querySelector('.hp-cur')?.textContent.trim() ?? '',
    plans: [...document.querySelectorAll('.hd-plan')].map((p) => ({
      name: p.querySelector('.hp-name')?.textContent.trim() ?? '',
      sum: p.querySelector('.hp-sum')?.textContent.trim() ?? '',
      applyDisabled: !!p.querySelector('[data-plan-apply]')?.disabled,
    })),
  }))()`);

const log = (tag, s) =>
  console.log(
    `\n[${tag}]\n  页签：${s.tabs.join(' / ')}｜方案面板：${s.panel ? '有' : '无'}｜计数：${s.count}\n` +
      `  当前：${s.cur}\n  空态：${s.empty || '（无）'}\n  方案：${s.plans.map((p) => `${p.name}「${p.sum}」`).join(' | ') || '（无）'}`
  );

// ── 1. 打开主站并预置队伍 ──
const home = `${url}/`;
await send('Page.navigate', { url: home }, sessionId);
await until(`location.href === ${JSON.stringify(home)}`, 60000);
await evaluate(seed());
await send('Page.reload', {}, sessionId);
await until(`!!document.querySelector('[data-nav="presets"]')`, 60000);
await sleep(500);

// 从「预设」面板把预置队伍上场到红队（主站不读 stzb_team_current，只能走 UI）
await evaluate(`document.querySelector('[data-nav="presets"]').click(); true`);
await until(`!!document.querySelector('.preset-tab[data-tab="mine"]')`, 20000);
await evaluate(`document.querySelector('.preset-tab[data-tab="mine"]').click(); true`);
await sleep(300);
await evaluate(`(document.querySelector('.preset-item') || { click() {} }).click(); true`);
await sleep(300);
await evaluate(`document.querySelector('[data-act="apply-red"]').click(); true`);
await sleep(600);
await evaluate(`(() => { const b = [...document.querySelectorAll('.preset-panel .btn, modal .btn')].find((x) => x.textContent.trim() === '完成'); (b || document.querySelector('.m-close'))?.click(); return true; })()`);
await sleep(500);
if (problems.length) console.log('页面报错：', problems.join(' | ').slice(0, 600));
await until(`!!document.querySelector('.slot[data-team="red"][data-slot-index="0"][data-hero-id="${HERO_ID}"]')`, 30000);
await sleep(400);
console.log('队伍预置完成：红队前锋 = 文鸯（击势 + 枭雄 · 全攻 40 · 满红）');

// ── 2. 打开武将详情 → 方案页签 ──
await evaluate(`document.querySelector('.slot[data-team="red"][data-slot-index="0"]').click(); true`);
await until(`!!document.querySelector('.hd-tab[data-tab="plans"]')`, 20000);
await sleep(300);
await evaluate(`document.querySelector('.hd-tab[data-tab="plans"]').click(); true`);
await sleep(300);
const s1 = await snap();
log('方案页 · 空档', s1);
await shot('1-plans-empty.png');

// ── 3. 保存当前配置 ──
await evaluate(`document.querySelector('[data-plan-save]').click(); true`);
await sleep(500);
const s2 = await snap();
log('保存方案一', s2);
await shot('2-plan-saved.png');

// ── 4. 改红度（5 → 2）再存一套 ──
await evaluate(`document.querySelector('.hd-tab[data-tab="detail"]').click(); true`);
await sleep(250);
await evaluate(`(document.querySelector('.redness-pick i[data-r="2"]') || { click() {} }).click(); true`);
await sleep(300);
await evaluate(`document.querySelector('.hd-tab[data-tab="plans"]').click(); true`);
await sleep(250);
await evaluate(`document.querySelector('[data-plan-save]').click(); true`);
await sleep(500);
const s3 = await snap();
log('改红度后再存', s3);
await shot('3-two-plans.png');

// ── 5. 套用方案一（满红那套）──
const beforeApply = await teamSlot();
await evaluate(`document.querySelector('[data-plan-apply]').click(); true`);
await sleep(600);
const afterApply = await teamSlot();
console.log(`\n[套用方案一] 红度 ${beforeApply?.redness} → ${afterApply?.redness}｜战法 ${JSON.stringify(afterApply?.skills)}｜加点 ${JSON.stringify(afterApply?.points)}`);
await shot('4-applied.png');

// ── 6. 卸下回池 → 从池里重新放入红队前锋 → 配置应保持方案一 ──
await evaluate(`document.querySelector('.btn.done').click(); true`);
await sleep(400);
await evaluate(`document.querySelector('.slot[data-team="red"][data-slot-index="0"]').click(); true`);
await until(`!!document.querySelector('.rm-hero')`, 20000);
await evaluate(`document.querySelector('.rm-hero').click(); true`);
await sleep(600);
const afterRemove = await teamSlot();
const cfgAfterRemove = await evaluate(`localStorage.getItem('stzb_hero_config_v1')`);
console.log(`\n[卸下后档案] ${String(cfgAfterRemove).slice(0, 400)}`);
await until(`!!document.querySelector('.hero-card[data-hero-id="${HERO_ID}"]')`, 20000);
await evaluate(`document.querySelector('.hero-card[data-hero-id="${HERO_ID}"]').click(); true`);
await until(`!!document.querySelector('.btn-place')`, 20000);
await sleep(250);
await evaluate(`document.querySelector('.btn-place').click(); true`);
await until(`!!document.querySelector('.place-btn[data-team="red"][data-label="大营"]')`, 20000);
await evaluate(`document.querySelector('.place-btn[data-team="red"][data-label="大营"]').click(); true`);
await sleep(700);
const afterRefill = await teamSlot();
console.log(`\n[回池再上阵] 移除后 ${afterRemove?.heroId ?? '空'} → 重新放入：战法 ${JSON.stringify(afterRefill?.skills)}｜加点 ${JSON.stringify(afterRefill?.points)}｜红度 ${afterRefill?.redness}`);
await shot('5-restored.png');

const checks = {
  plansTabListed: s1.tabs.includes('方案'),
  emptyState: s1.empty.includes('还没有保存的方案') && s1.count === '0 / 6',
  firstSaved: s2.plans.length === 1 && s2.plans[0].name === '方案一',
  summaryRich: /击势 \+ 枭雄/.test(s2.plans[0]?.sum ?? '') && /全攻 \+40/.test(s2.plans[0]?.sum ?? '') && /满红/.test(s2.plans[0]?.sum ?? ''),
  twoPlans: s3.plans.length === 2 && s3.count === '2 / 6',
  applyWritesSlot: afterApply?.redness === 5 && JSON.stringify(afterApply?.skills) === JSON.stringify(SKILLS),
  removedToPool: afterRemove?.heroId === null,
  refillKeepsLoadout:
    afterRefill?.heroId === HERO_ID &&
    JSON.stringify(afterRefill?.skills) === JSON.stringify(SKILLS) &&
    afterRefill?.points?.attack === 40 &&
    afterRefill?.redness === 5,
  noPageProblems: problems.length === 0,
};

writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ s1, s2, s3, beforeApply, afterApply, afterRemove, afterRefill, problems, checks }, null, 2));
console.log('\n=== checks ===');
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
console.log(`  pageerror/console.error: ${problems.length ? problems.join(' | ') : '无'}`);
console.log(`  outDir: ${outDir}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
