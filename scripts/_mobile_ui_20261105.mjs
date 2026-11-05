/**
 * 移动端 UI 优化（2026-11-05）· 真机视觉自检（内部脚本，`_` 前缀）
 * ---------------------------------------------------------------------------
 * 验证四条改动（YG 2026-11-05 口径：只作用于移动端，桌面保持现状）：
 *   ① 首页：队头「部队加成 / 保存预设 / 清空本队」与「显示下架武将」在手机上不渲染；
 *   ② 战法背包：筛选栏随滚动收起、向上滚/回顶展开，收起态留摘要条；
 *   ③ 宝物选择：详情默认收起（贴底抽屉），点卡片展开、点把手收起；
 *   ④ 战报详情：结果顶栏（.result-banner）在手机上不显示。
 * 外加桌面 1440×900 反证：三键 / 下架开关 / 结果顶栏 / 详情块全部照旧。
 *
 * 用法（先起 dev server：`npm run web`，默认 http://localhost:5173）：
 *   node scripts/_mobile_ui_20261105.mjs [url] [outDir]
 * 依赖：本机 Chrome 或 Edge（自动探测），无额外 npm 包。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? join('verify-shots', 'mobile-ui-20261105');
mkdirSync(outDir, { recursive: true });

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('没找到 Chrome / Edge，装一个再跑');

const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-mobile-ui-1105-'));
const child = spawn(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--touch-events=enabled',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}

async function waitFor(selector, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting selector ${selector}`);
}

async function click(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`click target missing: ${selector}`);
  await sleep(400);
}

/** 首次进入会自动弹声明（公告首启只留红点）——截图前关掉 */
async function dismissFirstRunOverlays() {
  for (const sel of ['.disclaimer-mask .m-close', '.announcement-mask .m-close']) {
    const present = await evaluate(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
    if (present) await click(sel);
  }
}

async function goto(target) {
  events.length = 0;
  await send('Page.navigate', { url: target }, sessionId);
  await waitEvent('Page.loadEventFired');
  await sleep(1600);
  await waitFor('.hero-grid .hero-card');
  await dismissFirstRunOverlays();
}

async function setViewport(width, height, { mobile, touch, scale }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 }, sessionId);
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
}

/**
 * 用真实 UI 路径打开「战报详情」页（用户截图第 4 张）。
 *
 * 世界状态必须走 UI：`startBattle()` 的 `collectTeam()` 读 main.ts 闭包里的编辑器状态，
 * 脚本无法直接注入；而 `import('/src/engine/combat')` 在浏览器里会把 node 侧 mysql2 拉进
 * 依赖图（safer-buffer 炸 `Cannot read properties of undefined`），所以也不能在页面里造战报。
 * 这里照用户手速走一遍：点武将池卡片 → 详情「放入阵容」→ 选红队/蓝队大营 → 开始模拟 →
 * 战报页 → 底栏「详情」。
 */
async function placeHero(team, label) {
  const picked = await evaluate(`(() => {
    const card = document.querySelector('.hero-grid .hero-card:not(.picked):not(.offline)');
    if (!card) return null;
    card.click();
    return card.dataset.heroId ?? '';
  })()`);
  if (picked === null) throw new Error('武将池没有可上阵的卡');
  await waitFor('.hd-foot .btn-place');
  await click('.hd-foot .btn-place');
  await waitFor(`.place-btn[data-team="${team}"][data-label="${label}"]`);
  await click(`.place-btn[data-team="${team}"][data-label="${label}"]`);
  await sleep(500);
}

async function openReportDetail() {
  await placeHero('red', '大营');
  await placeHero('blue', '大营');
  const err = await evaluate(`document.querySelector('.err-box')?.textContent ?? ''`);
  await click('#start');
  await waitFor('.report-tabs', 20000);
  await click('.report-tabs [data-mode="detail"]');
  await waitFor('.battle-view');
  await sleep(600);
  console.log('report page ready, err =', JSON.stringify(err));
}

/** 以「已放入红队大营」的状态打开武将详情（走 Vite 开发模块，不依赖拖拽链） */
async function openPlacedDetail() {
  const opened = await evaluate(`(async () => {
    const heroId = document.querySelector('.hero-grid .hero-card:not(.offline)')?.dataset.heroId;
    if (!heroId) return { ok: false, reason: 'no hero card' };
    const { openHeroDetail, emptySlot } = await import('/web/teamEditor.ts');
    const slot = { ...emptySlot(), heroId };
    const noop = new Proxy({}, { get: () => () => {} });
    openHeroDetail(heroId, { placed: { team: 'red', idx: 0, slot }, handlers: noop });
    return { ok: true, heroId };
  })()`);
  if (!opened?.ok) throw new Error(`openPlacedDetail failed: ${JSON.stringify(opened)}`);
  await waitFor('.hero-detail-modal .hd-treasure-wrap');
  await sleep(300);
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail ?? '');
}

/** 元素 display / 高度 / 类名一次取全（断言与截图并存，避免"看着对但数值不对"） */
async function box(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return {
      display: cs.display,
      height: +b.height.toFixed(1),
      width: +b.width.toFixed(1),
      top: +b.top.toFixed(1),
      cls: el.className,
    };
  })()`);
}

// ── 手机横屏（844×390，触屏，DPR 2；比例 ≈ 用户截图 1178×543）──────────────
await setViewport(844, 390, { mobile: true, touch: true, scale: 2 });
await goto(url);

const phoneEnv = await evaluate(`({
  mobileQuery: matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 620px), (max-width: 720px) and (orientation: portrait)').matches,
  coarse: matchMedia('(pointer: coarse)').matches,
  innerWidth, innerHeight,
})`);
console.log('phone env', phoneEnv);
const phoneHead = await box('.team-editor .team-head');
const phoneActions = await box('.team-editor .team-head-actions');
const phoneOffline = await box('.team-editor .offline-toggle');
const phoneSlots = await box('.team-editor .team-panel.red .slots');
await shot('1-phone-home.png');
check('手机端命中 MOBILE_UI_QUERY', phoneEnv.mobileQuery, phoneEnv);
check('手机端不渲染队头三键容器', phoneActions.display === 'none', phoneActions);
check('手机端不渲染整行队头', phoneHead.display === 'none', phoneHead);
check('手机端不渲染「显示下架武将」', phoneOffline.missing || phoneOffline.display === 'none', phoneOffline);
check('手机端三槽仍占满面板高度', phoneSlots.height > 150, phoneSlots);

// ── B1：首页「势力 / 兵种」折叠成一行 + 已选摘要 ─────────────────────────────
const hfPeek = await box('.hero-pool .hero-filter .hf-peek');
const hfBodyClosed = await box('.hero-pool .hero-filter .hf-body');
const hfPeekText = await evaluate(`document.querySelector('.hero-pool .hf-peek-text')?.textContent ?? ''`);
await shot('9-phone-filter-collapsed.png');
check('首页筛选：手机端显示收起摘要条', hfPeek.display === 'flex' && /势力.*兵种/.test(hfPeekText), {
  peek: hfPeek.display,
  text: hfPeekText,
});
check('首页筛选：默认收起（body 高度归零）', hfBodyClosed.height <= 1, hfBodyClosed);

await click('.hero-pool .hero-filter .hf-peek');
await sleep(400);
const hfBodyOpen = await box('.hero-pool .hero-filter .hf-body');
await shot('9b-phone-filter-open.png');
check('首页筛选：点摘要条展开两行', hfBodyOpen.height > 40, hfBodyOpen);

// 展开态跨重渲染保持：选一个势力标签（会重建武将池）
await click('.hero-pool .hero-filter .filter-tag[data-dim="faction"]');
await sleep(500);
const hfAfterPick = await box('.hero-pool .hero-filter');
const hfPeekText2 = await evaluate(`document.querySelector('.hero-pool .hf-peek-text')?.textContent ?? ''`);
check('首页筛选：选中标签后不会自己塌回去', /is-open/.test(hfAfterPick.cls), hfAfterPick.cls);
check('首页筛选：摘要反映已选势力', !/势力 全部/.test(hfPeekText2), hfPeekText2);
// 复原（清筛选 + 收起），免得影响后面的放将流程
await click('.hero-pool .hero-filter .hf-reset');
await sleep(400);
await click('.hero-pool .hero-filter .hf-peek');
await sleep(200);

// ── B2：顶栏「更多」下拉 ────────────────────────────────────────────────────
const moreBtn = await box('.app-nav .nav-more-btn');
const moreMenuClosed = await box('.app-nav .nav-more-menu');
const labInMenu = await box('.app-nav .nav-more-menu [data-nav="lab"]');
await shot('10-phone-nav-more-closed.png');
check('顶栏：手机端显示「更多」按钮', moreBtn.display !== 'none' && moreBtn.height > 20, moreBtn);
check('顶栏：菜单默认收起（伤害测试不在视野内）', moreMenuClosed.display === 'none', {
  menu: moreMenuClosed.display,
  lab: labInMenu.missing ? 'absent' : labInMenu.display,
});
await click('.app-nav .nav-more-btn');
await sleep(300);
const moreMenuOpen = await box('.app-nav .nav-more-menu');
await shot('10b-phone-nav-more-open.png');
check('顶栏：点「更多」展开菜单', moreMenuOpen.display === 'flex' && moreMenuOpen.height > 40, moreMenuOpen);
// 宽度守卫：菜单项是中文，若容器被压成 shrink-to-fit 会变成「一字一行」（宽度 ~76px）
check('顶栏：菜单宽度足够，中文不竖排', moreMenuOpen.width > 100, { width: moreMenuOpen.width });
await click('.app-nav .nav-more-btn');
await sleep(200);

// ── 战法背包：筛选随滚动收放 ──────────────────────────────────────────────
await click('[data-nav="skills"]');
await waitFor('.bag-modal');
await sleep(500);
const bagOpen = await box('.bag-modal .bag-tools');
const peekHidden = await box('.bag-modal .bag-peek');
await shot('2a-phone-bag-open.png');
check('战法背包：展开时筛选栏可见', bagOpen.display !== 'none' && bagOpen.height > 40, bagOpen);
check('战法背包：展开时不显示摘要条', peekHidden.display === 'none', peekHidden);

// ── B3：战法卡说明改两行（原来一律截成「主动 · 距离1 · …」）─────────────────
const metaStyle = await evaluate(`(() => {
  const el = document.querySelector('.bag-modal .bag-item .bag-meta');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    clamp: cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp'),
    white: cs.whiteSpace,
    text: el.textContent,
    h: +el.getBoundingClientRect().height.toFixed(1),
  };
})()`);
check('战法卡：说明允许两行（line-clamp 2）', metaStyle && /2/.test(metaStyle.clamp ?? '') && metaStyle.white !== 'nowrap', metaStyle);

// 向下滚 → 应收起（scrollTop 直接赋值会派发 scroll，等于一次真实滚动）
const scrolled = await evaluate(`(() => {
  const g = document.querySelector('.bag-modal .bag-grid');
  g.scrollTop = Math.round(g.scrollHeight * 0.6);
  return { top: g.scrollTop, h: g.scrollHeight, client: g.clientHeight };
})()`);
console.log('bag scroll', scrolled);
await sleep(600);
const bagTucked = await box('.bag-modal .bag-tools');
const peekShown = await box('.bag-modal .bag-peek');
const peekText = await evaluate(`document.querySelector('.bag-modal .bag-peek-text')?.textContent ?? ''`);
await shot('2b-phone-bag-tucked.png');
check('战法背包：下滑后筛选栏收起（高度归零）', bagTucked.height <= 1, bagTucked);
check('战法背包：下滑后出现摘要条', peekShown.display === 'flex', peekShown);
check('战法背包：摘要条带当前筛选文案', /品级.*类别.*共 \d+ 种/.test(peekText), peekText);

// 向上滚 → 应展开
await evaluate(`(() => { const g = document.querySelector('.bag-modal .bag-grid'); g.scrollTop = Math.max(0, g.scrollTop - 220); })()`);
await sleep(600);
const bagUp = await box('.bag-modal .bag-tools');
await shot('2c-phone-bag-up.png');
check('战法背包：上滑后筛选栏重新展开', bagUp.height > 40 && !/is-tucked/.test(bagUp.cls), bagUp);

// 回顶 → 必展开（哪怕方向判定被惯性滚动吃掉）
await evaluate(`(() => { const g = document.querySelector('.bag-modal .bag-grid'); g.scrollTop = 0; })()`);
await sleep(500);
const bagTop = await box('.bag-modal .bag-tools');
check('战法背包：滚回顶部强制展开', bagTop.height > 40, bagTop);

// ── A1：搜索框聚焦期间不许收起（否则点开筛选再一滚就"像点坏了"）──────────────
await evaluate(`(() => {
  const input = document.querySelector('.bag-modal .pick-toolbar input');
  input.focus();
  const g = document.querySelector('.bag-modal .bag-grid');
  g.scrollTop = Math.round(g.scrollHeight * 0.6);
})()`);
await sleep(600);
const bagFocused = await box('.bag-modal .bag-tools');
const focusLocked = await evaluate(`document.activeElement?.tagName === 'INPUT'`);
await shot('2d-phone-bag-focus-lock.png');
check('战法背包：输入中滚动不会收起筛选栏', focusLocked && bagFocused.height > 40, {
  focused: focusLocked,
  height: bagFocused.height,
});
// 失焦后恢复「下滑即收起」
await evaluate(`(() => {
  document.activeElement?.blur();
  const g = document.querySelector('.bag-modal .bag-grid');
  g.scrollTop = Math.round(g.scrollHeight * 0.9);
})()`);
await sleep(600);
const bagAfterBlur = await box('.bag-modal .bag-tools');
check('战法背包：失焦后下滑恢复收起', bagAfterBlur.height <= 1, bagAfterBlur);
await evaluate(`document.querySelector('.bag-modal .m-close')?.click()`);
await sleep(300);

// ── 宝物选择：详情默认收起，点卡片展开、点把手收起 ──────────────────────────
await goto(url);
await openPlacedDetail();
await click('.hd-treasure[data-treasure-open]');
await waitFor('.treasure-modal');
await sleep(500);
const sheetClosed = await box('.treasure-modal .tp-sheet');
const gridBox = await box('.treasure-modal .tp-grid');
await shot('3a-phone-treasure-collapsed.png');
check('宝物：详情默认收起（抽屉只剩把手 44px）', sheetClosed.height <= 48, sheetClosed);
check('宝物：网格占满剩余高度（一屏多行）', gridBox.height > 150, gridBox);

await click('.treasure-modal .tp-card');
await sleep(600);
const sheetOpen = await box('.treasure-modal .tp-sheet');
const effVisible = await box('.treasure-modal .tp-sheet .tp-detail');
await shot('3b-phone-treasure-expanded.png');
check('宝物：点卡片后抽屉展开', sheetOpen.height > 120 && /is-open/.test(sheetOpen.cls), sheetOpen);
check('宝物：展开后能读到自带特效', effVisible.height > 40, effVisible);

await click('.treasure-modal .tp-sheet-handle');
await sleep(600);
const sheetAgain = await box('.treasure-modal .tp-sheet');
await shot('3c-phone-treasure-recollapsed.png');
check('宝物：点把手可再次收起', sheetAgain.height <= 48, sheetAgain);

// ── A2：收起态把手上直接有「下一步」（不必先展开抽屉）───────────────────────
const sheetNext = await box('.treasure-modal .tp-sheet-next');
await shot('3d-phone-treasure-next-btn.png');
check('宝物：收起态把手带「下一步」', sheetNext.missing !== true && sheetNext.height >= 26, sheetNext);
await click('.treasure-modal .tp-sheet-next');
await sleep(600);
const onStep2 = await evaluate(`({
  steps: document.querySelector('.treasure-modal .tp-steps')?.textContent ?? '',
  affixes: document.querySelectorAll('.treasure-modal .tp-affix').length,
})`);
check('宝物：点把手「下一步」直接进第②步', onStep2.affixes > 0, onStep2);

// ── 战报详情：结果顶栏不显示 ──────────────────────────────────────────────
await goto(url);
await openReportDetail();
const phoneBanner = await box('.battle-view > .result-banner');
const phoneLog = await box('.battle-view .dv');
await shot('4-phone-battle.png');
check('战报：手机端不显示结果顶栏', phoneBanner.display === 'none', phoneBanner);
check('战报：详情三栏照常铺开', phoneLog.height > 150, phoneLog);

// ── A3：结果落到底栏左侧 + 右侧竖排按钮放大到 32px ──────────────────────────
const dockResult = await box('.report-dock .dock-result');
const dockText = await evaluate(`document.querySelector('.report-dock .dock-result')?.textContent ?? ''`);
const railBtnBox = await evaluate(`(() => {
  const b = document.querySelector('.battle-view .dv-rail button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { h: +r.height.toFixed(1), w: +r.width.toFixed(1), text: b.textContent };
})()`);
await shot('4b-phone-battle-dock.png');
check('战报：底栏左侧显示胜负与回合', dockResult.display !== 'none' && /回合/.test(dockText), {
  display: dockResult.display,
  text: dockText,
});
check('战报：右侧竖排按钮 ≥32px 触控目标', railBtnBox && railBtnBox.h >= 31, railBtnBox);

// ── A5：回合号可滚（放大到 32px 后 8 回合会超出 390 屏高）────────────────────
const railScroll = await evaluate(`(() => {
  const box = document.querySelector('.battle-view .dv-rail .dv-rounds');
  if (!box) return null;
  const before = box.scrollTop;
  box.scrollTop = box.scrollHeight;
  const after = box.scrollTop;
  const tabs = [...box.querySelectorAll('.rtab')].map((t) => t.textContent);
  return { clientH: +box.clientHeight.toFixed(1), scrollH: +box.scrollHeight.toFixed(1), before, after, tabs };
})()`);
await shot('13-phone-rail-scroll.png');
check(
  '战报：回合号超出时可以滚到底',
  railScroll && railScroll.scrollH > railScroll.clientH && railScroll.after > 0,
  railScroll,
);
// 点最后一回合后，那个回合号要自动滚进可视区
await evaluate(`(() => {
  const box = document.querySelector('.battle-view .dv-rail .dv-rounds');
  const tabs = [...box.querySelectorAll('.rtab')];
  tabs[tabs.length - 1]?.click();
})()`);
await sleep(300);
const lastTabVisible = await evaluate(`(() => {
  const box = document.querySelector('.battle-view .dv-rail .dv-rounds');
  const tabs = [...box.querySelectorAll('.rtab')];
  const last = tabs[tabs.length - 1];
  const b = box.getBoundingClientRect();
  const r = last.getBoundingClientRect();
  return { inside: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, scrollTop: +box.scrollTop.toFixed(1) };
})()`);
check('战报：切到最后一回合时自动滚进视野', lastTabVisible.inside, lastTabVisible);

// ── A4：简略页立绘卡按高度缩放（单将时不再被撑大裁掉底部）──────────────────
await click('.report-tabs [data-mode="summary"]');
await waitFor('.report-view .sum-roster', 8000);
await sleep(400);
const summaryFit = await evaluate(`(() => {
  const card = document.querySelector('.report-view .sum-hero .sh-card');
  const roster = document.querySelector('.report-view .sum-roster');
  const view = document.querySelector('.report-view');
  if (!card || !roster || !view) return null;
  const c = card.getBoundingClientRect();
  const v = view.getBoundingClientRect();
  const bar = document.querySelector('.report-view .sum-hero .troopbar');
  const barR = bar ? bar.getBoundingClientRect() : null;
  const cards = [...document.querySelectorAll('.report-view .sum-hero .sh-card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(0), h: +r.height.toFixed(0), bottom: +r.bottom.toFixed(0) };
  });
  return {
    card: { w: +c.width.toFixed(0), h: +c.height.toFixed(0), bottom: +c.bottom.toFixed(0) },
    viewBottom: +v.bottom.toFixed(0),
    troopbarVisible: barR ? barR.bottom <= v.bottom + 1 && barR.height > 0 : null,
    cards,
  };
})()`);
await shot('12-phone-summary.png');
check(
  '简略页：单将立绘卡不超出可视区、卡内兵力条可见',
  summaryFit &&
    summaryFit.card.bottom <= summaryFit.viewBottom + 1 &&
    summaryFit.troopbarVisible === true &&
    summaryFit.card.h < 300,
  summaryFit,
);

// 三将反证：单将的修复不能把「本来正常的三将」压变形（克隆两张卡模拟满编）
const threeUp = await evaluate(`(() => {
  const side = document.querySelector('.report-view .sum-red') || document.querySelector('.report-view .sum-blue');
  if (!side) return null;
  const first = side.querySelector('.sum-hero');
  if (!first) return null;
  const clones = [first.cloneNode(true), first.cloneNode(true)];
  clones.forEach((c) => side.appendChild(c));
  const view = document.querySelector('.report-view').getBoundingClientRect();
  const cards = [...side.querySelectorAll('.sh-card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(0), h: +r.height.toFixed(0), ratio: +(r.width / r.height).toFixed(3), bottom: +r.bottom.toFixed(0) };
  });
  clones.forEach((c) => c.remove());
  return { cards, viewBottom: +view.bottom.toFixed(0) };
})()`);
await shot('14-phone-summary-three.png');
check(
  '简略页：三将满编时卡片仍按 242:350 等比、不溢出',
  threeUp &&
    threeUp.cards.length === 3 &&
    threeUp.cards.every((c) => Math.abs(c.ratio - 242 / 350) < 0.02 && c.bottom <= threeUp.viewBottom + 1),
  threeUp,
);

// ── 桌面 1440×900 反证：以上全部保持原样 ──────────────────────────────────
await setViewport(1440, 900, { mobile: false, touch: false, scale: 1 });
await goto(url);
const deskHead = await box('.team-editor .team-head');
const deskActions = await box('.team-editor .team-head-actions');
const deskOffline = await box('.team-editor .offline-toggle');
await shot('5-desktop-home.png');
check('桌面：队头仍显示', deskHead.display !== 'none' && deskActions.display !== 'none', {
  head: deskHead.display,
  actions: deskActions.display,
});
check('桌面：下架开关仍显示', deskOffline.display !== 'none', deskOffline);

// ── 桌面反证（A/B 新增件一律不出现 / 不改形）──────────────────────────────────
const deskHfPeek = await box('.hero-pool .hero-filter .hf-peek');
const deskHfBody = await box('.hero-pool .hero-filter .hf-body');
const deskMoreBtn = await box('.app-nav .nav-more-btn');
const deskMoreMenu = await box('.app-nav .nav-more-menu');
const deskNavCount = await evaluate(
  `document.querySelectorAll('.app-nav .nav-link:not(.nav-more-btn)').length`,
);
check('桌面：筛选摘要条不出现，两行原样平铺', deskHfPeek.display === 'none' && deskHfBody.display === 'contents', {
  peek: deskHfPeek.display,
  body: deskHfBody.display,
});
check('桌面：顶栏仍是 7 个入口平铺（「更多」隐藏）', deskMoreBtn.display === 'none' && deskMoreMenu.display === 'flex' && deskNavCount === 7, {
  btn: deskMoreBtn.display,
  menu: deskMoreMenu.display,
  navLinks: deskNavCount,
});

await click('[data-nav="skills"]');
await waitFor('.bag-modal');
await sleep(400);
const deskBag = await box('.bag-modal .bag-tools');
const deskPeek = await box('.bag-modal .bag-peek');
await evaluate(`(() => { const g = document.querySelector('.bag-modal .bag-grid'); g.scrollTop = 300; })()`);
await sleep(500);
const deskBagScrolled = await box('.bag-modal .bag-tools');
await shot('6-desktop-bag.png');
check('桌面：战法背包筛选栏常驻（滚动也不收）', deskBag.height > 40 && deskBagScrolled.height > 40, {
  open: deskBag.height,
  scrolled: deskBagScrolled.height,
});
check('桌面：摘要条不出现', deskPeek.display === 'none', deskPeek);
await evaluate(`document.querySelector('.bag-modal .m-close')?.click()`);
await sleep(300);

await goto(url);
await openReportDetail();
const deskBanner = await box('.battle-view > .result-banner');
await shot('7-desktop-battle.png');
check('桌面：战报结果顶栏照常显示', deskBanner.display !== 'none' && deskBanner.height > 10, deskBanner);
const deskDockResult = await box('.report-dock .dock-result');
const deskRailBtn = await evaluate(`(() => {
  const b = document.querySelector('.battle-view .dv-rail button');
  if (!b) return null;
  return +b.getBoundingClientRect().height.toFixed(1);
})()`);
check('桌面：底栏不出现结果行（顶栏已有）', deskDockResult.display === 'none', deskDockResult);
// 桌面在 ≥900px 时 `.dv-rail button` 本来就是 32px（styles.css 的既有媒体查询），
// 手机改成 32 只是把窄屏那一档补上；这条断言守的是"改动没有污染宽屏既有值"。
check('桌面：右侧竖排按钮维持 32px（既有≥900px 规则）', deskRailBtn === 32, { h: deskRailBtn });

// 桌面宝物详情仍是常驻块（没有抽屉）
await goto(url);
await openPlacedDetail();
await click('.hd-treasure[data-treasure-open]');
await waitFor('.treasure-modal');
await sleep(400);
const deskSheet = await box('.treasure-modal .tp-sheet');
const deskDetail = await box('.treasure-modal .tp-detail');
await shot('8-desktop-treasure.png');
check('桌面：宝物详情仍是常驻块（无抽屉）', deskSheet.missing && deskDetail.display !== 'none', {
  sheet: deskSheet.missing ? 'absent' : deskSheet.cls,
  detail: deskDetail.display,
});

// ── 窄桌面 800×600（非触屏）：证明移动端规则挂在 pointer:coarse 上，不是「窗口窄」────────
await setViewport(800, 600, { mobile: false, touch: false, scale: 1 });
await goto(url);
const narrowHfPeek = await box('.hero-pool .hero-filter .hf-peek');
const narrowMoreBtn = await box('.app-nav .nav-more-btn');
const narrowTeamHead = await box('.team-editor .team-head');
await click('[data-nav="skills"]');
await waitFor('.bag-modal');
await sleep(400);
const narrowMeta = await evaluate(`(() => {
  const el = document.querySelector('.bag-modal .bag-item .bag-meta');
  return el ? getComputedStyle(el).whiteSpace : null;
})()`);
await shot('11-narrow-desktop.png');
check('窄桌面：筛选/更多/队头全部照旧（不吃移动端规则）', narrowHfPeek.display === 'none' && narrowMoreBtn.display === 'none' && narrowTeamHead.display !== 'none', {
  peek: narrowHfPeek.display,
  moreBtn: narrowMoreBtn.display,
  teamHead: narrowTeamHead.display,
});
check('窄桌面：战法说明仍是单行截断', narrowMeta === 'nowrap', { whiteSpace: narrowMeta });
await evaluate(`document.querySelector('.bag-modal .m-close')?.click()`);
await sleep(200);

const failed = checks.filter((c) => !c.pass);
writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify({ url, checks, pageErrors, failed: failed.length }, null, 2),
);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5));
ws.close();
child.kill();
process.exit(failed.length === 0 && pageErrors.length === 0 ? 0 : 1);
