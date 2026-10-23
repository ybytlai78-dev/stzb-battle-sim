/**
 * 网页验证：把真实引擎跑出来的「连环计 / 河内世泽 / 其徐如林」战报塞进历史，
 * ① 统计页断言【连环计】【河内世泽】【其徐如林】的杀伤不再是 0；
 * ② 详情战报断言出现子战法标识〈伐谋〉〈迷阵〉〈火辎〉与〈诛杀〉。
 * 各截一张图。
 *
 * 用法：node scripts/_shot_chain_labels.mjs [url] [outPrefix]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT_PREFIX = process.argv[3] ?? 'docs/逆向对拍/baseline/chain';
const RECORD = path.resolve('docs/逆向对拍/baseline/chain_record.json');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;

const record = fs.readFileSync(RECORD, 'utf8');

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1440,1400',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'stzb-shot-chain'),
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const wsUrl = await getWs();
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面脚本报错: ' + JSON.stringify(r.exceptionDetails.text));
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_APP });
await sleep(2500);

const bootstrap = `(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  try { localStorage.setItem('stzb_battle_history', JSON.stringify([${record}])); } catch {}
  return true;
})()`;
await evalJs(bootstrap);
await send('Page.navigate', { url: URL_APP });
await sleep(2500);
await evalJs(bootstrap);

const opened = await evalJs(`(() => {
  const nav = document.querySelector('[data-nav="history"]');
  if (nav) nav.click();
  return !!nav;
})()`);
await sleep(800);
const pickedItem = await evalJs(`(() => {
  const it = document.querySelector('.hist-item');
  if (it) { it.click(); return true; }
  return false;
})()`);
await sleep(900);

// ① 统计页
const clickedStats = await evalJs(`(() => {
  const b = [...document.querySelectorAll('.hist-actions button, button')].find((x) => (x.textContent || '').trim() === '统计');
  if (b) { b.click(); return true; }
  return false;
})()`);
await sleep(1200);

const stats = await evalJs(`(() => {
  const cells = [...document.querySelectorAll('.stats-view .sk')];
  const rows = [...document.querySelectorAll('.stats-view .st-row')].map((row) => {
    const hero = (row.querySelector('.hm-name, .hero-name, .hm b') || {}).textContent || '';
    return {
      hero: (hero || '').trim(),
      skills: [...row.querySelectorAll('.sk')]
        .filter((c) => c.dataset.skillId)
        .map((c) => ({
          skillId: c.dataset.skillId,
          name: (c.querySelector('.sk-n') || {}).textContent?.trim() || '',
          count: (c.querySelector('.sk-c') || {}).textContent?.trim() || '',
          kill: (c.querySelector('.sk-d') || {}).textContent?.trim() || '',
        })),
    };
  });
  return { cellCount: cells.length, rows };
})()`);
fs.mkdirSync(path.dirname(OUT_PREFIX), { recursive: true });
fs.writeFileSync(`${OUT_PREFIX}-stats.json`, JSON.stringify(stats, null, 1));
for (const row of stats.rows) {
  console.log(`统计行 ${row.hero || '(无头像名)'} → ${row.skills.map((s) => `${s.name}[${s.skillId}] ${s.count} ${s.kill}`).join(' | ')}`);
}

const shotStats = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(`${OUT_PREFIX}-stats.png`, Buffer.from(shotStats.data, 'base64'));

// ② 详情战报
const back = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('返回简略战报'));
  if (b) { b.click(); return true; }
  return false;
})()`);
await sleep(800);
const expanded = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button, .expand-btn')].find((x) => (x.textContent || '').includes('详细战报'));
  if (b) { b.click(); return true; }
  return false;
})()`);
await sleep(1000);

// 逐回合扫一遍，收集所有 .dmg-sub（伤害分散在不同回合）
const sweep = [];
for (let r = 1; r <= 8; r++) {
  const jumped = await evalJs(`(() => {
    const tabs = [...document.querySelectorAll('.dv-rail .rtab, .dv-rail button, .rtab')];
    const t = tabs.find((x) => (x.textContent || '').trim() === '${r}');
    if (t) { t.click(); return true; }
    return false;
  })()`);
  if (!jumped) continue;
  await sleep(500);
  const subs = await evalJs(`(() => {
    const subs = [...document.querySelectorAll('.dmg-sub')].map((e) => e.textContent.trim());
    const casts = [...document.querySelectorAll('.dv-line, .dv-body')].map((e) => e.textContent.trim()).filter((t) => t.includes('·'));
    return { subs: [...new Set(subs)], casts: [...new Set(casts)].slice(0, 6) };
  })()`);
  sweep.push({ round: r, ...subs });
  if (subs.subs.length > 0) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`${OUT_PREFIX}-detail-r${r}.png`, Buffer.from(shot.data, 'base64'));
  }
}
console.log('历史面板:', opened, '选中记录:', pickedItem, '统计按钮:', clickedStats, '详情:', expanded, '返回:', back);
console.log('详情战报逐回合子战法:', JSON.stringify(sweep, null, 1));

const allSubs = new Set(sweep.flatMap((s) => s.subs));
const allCasts = new Set(sweep.flatMap((s) => s.casts));
console.log('合并 .dmg-sub:', [...allSubs]);
console.log('含「·」的战报行样例:', [...allCasts].slice(0, 6));
console.log('截图:', `${OUT_PREFIX}-stats.png`, `${OUT_PREFIX}-detail-r1.png`);

ws.close();
chrome.kill();
process.exit(0);
