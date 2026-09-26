/**
 * 战报页「统计胜率」：把**当前双方队伍**快速跑 N 场（默认 200）模拟，给出 胜 / 平 / 负 概率。
 * ---------------------------------------------------------------------------
 * · 判定口径沿用 L4「实战胜率批量模拟」（`judgeOutcome`，用户 2026-09-22 定稿，见 web/battleSim.ts）：
 *   ① 一方大营阵亡 → 引擎直接给 win / loss（斩首）；
 *   ② 打满 maxRounds 回合双方大营都活着 → 比剩余兵力，高者胜；只有完全相同才算平。
 * · 固定红蓝站位、**每颗种子跑「正/反」两场**（其中一场把两队对调，`swapSides`，与 L4 同一口径）：
 *   消除先手 / 站位偏向，且「把红蓝两队对调后再统计」两次结果必然互补（和 = 100%）。
 * · 种子 = 基础种子 + 种子序号（默认取本场战报种子）→ 同一份战报重复统计结果一致、可复现。
 * · 只跑引擎、不渲染战报；浏览器里分片让出主线程，边跑边刷进度条。
 */
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import { judgeOutcome } from './battleSim';

/** 一次统计的场次（用户口径：点击「统计胜率」= 200 场快速模拟） */
export const WIN_RATE_RUNS = 200;
/** 与主站「开始模拟」一致的最大回合 */
export const WIN_RATE_MAX_ROUNDS = 8;
/** 缺省基础种子（与 L4 DEFAULT_ENV.baseSeed 同值，仅在没有战报种子时兜底） */
export const WIN_RATE_BASE_SEED = 20260922;
/** 浏览器里每 N 场让出一次主线程（刷新进度、避免长卡顿） */
export const WIN_RATE_YIELD_EVERY = 25;

export interface WinRateStats {
  runs: number;
  win: number;
  loss: number;
  draw: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  /** 斩首（大营阵亡）决定的场次 */
  decapWin: number;
  decapLoss: number;
  /** 打满回合后按剩余兵力判定的场次 */
  troopWin: number;
  troopLoss: number;
  /** 打满回合且剩余兵力完全相同（真正的平局） */
  evenDraw: number;
  /** 打满回合（引擎原生平局）总场次 = troopWin + troopLoss + evenDraw */
  capped: number;
  baseSeed: number;
  /** 实际耗时（毫秒） */
  ms: number;
}

export interface WinRateOptions {
  runs?: number;
  /** 基础种子：第 k 颗种子跑「正/反」两场（swapSides 时） */
  baseSeed?: number;
  maxRounds?: number;
  /** 每颗种子跑正/反两场（对调红蓝，消除先手/站位偏向；缺省 true） */
  swapSides?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** 异步版：每 N 场 `await` 一次（让出主线程） */
  yieldEvery?: number;
}

interface Tally {
  runs: number;
  win: number;
  loss: number;
  draw: number;
  decapWin: number;
  decapLoss: number;
  troopWin: number;
  troopLoss: number;
  evenDraw: number;
  capped: number;
}

function emptyTally(): Tally {
  return {
    runs: 0,
    win: 0,
    loss: 0,
    draw: 0,
    decapWin: 0,
    decapLoss: 0,
    troopWin: 0,
    troopLoss: 0,
    evenDraw: 0,
    capped: 0,
  };
}

/** 每场用一份浅拷贝：战报里的 General 会被后续渲染/复用读取，不让 200 场互相串数据 */
function cloneTeam(team: General[]): General[] {
  return team.map((g) => ({
    ...g,
    activeSkillIds: [...g.activeSkillIds],
    passiveSkillIds: [...g.passiveSkillIds],
    commandSkillIds: [...g.commandSkillIds],
    pursuitSkillIds: [...g.pursuitSkillIds],
  }));
}

/** 跑一场并按实战口径计入 tally（`myTeam` 恒为「我方」视角）。
 *  `swap` = 本场把两队对调（我方临时放到右侧），结果再还原成我方视角：
 *  每颗种子跑「正/反」两场，消除先手 / 站位偏向（L4 口径）；
 *  由此「两队对调后再统计」两次结果必然互补（和 = 100%）。 */
function countOne(
  myTeam: General[],
  enemyTeam: General[],
  seed: number,
  maxRounds: number,
  swap: boolean,
  t: Tally
): void {
  const left = swap ? enemyTeam : myTeam;
  const right = swap ? myTeam : enemyTeam;
  const report = runBattle({
    myTeam: cloneTeam(left),
    enemyTeam: cloneTeam(right),
    seed,
    maxRounds,
  });
  const leftTroops = report.finalMyTroops.reduce((a, b) => a + b, 0);
  const rightTroops = report.finalEnemyTroops.reduce((a, b) => a + b, 0);
  const myTroops = swap ? rightTroops : leftTroops;
  const enemyTroops = swap ? leftTroops : rightTroops;
  // 引擎结果是「左侧视角」→ 对调场次先还原成我方视角
  const result: 'win' | 'loss' | 'draw' = swap
    ? report.result === 'win'
      ? 'loss'
      : report.result === 'loss'
        ? 'win'
        : 'draw'
    : report.result;
  // 打满回合（引擎原生 draw）时，judgeOutcome 用剩余兵力分胜负；兵力相同才是平局
  const judged = judgeOutcome(result, myTroops, enemyTroops);
  const capped = result === 'draw';
  t.runs += 1;
  if (capped) t.capped += 1;
  if (judged.win) {
    t.win += 1;
    if (capped) t.troopWin += 1;
    else t.decapWin += 1;
  } else if (judged.draw) {
    t.draw += 1;
    t.evenDraw += 1;
  } else {
    t.loss += 1;
    if (capped) t.troopLoss += 1;
    else t.decapLoss += 1;
  }
}

function finalize(t: Tally, baseSeed: number, ms: number): WinRateStats {
  const n = Math.max(1, t.runs);
  return {
    runs: t.runs,
    win: t.win,
    loss: t.loss,
    draw: t.draw,
    winRate: t.win / n,
    lossRate: t.loss / n,
    drawRate: t.draw / n,
    decapWin: t.decapWin,
    decapLoss: t.decapLoss,
    troopWin: t.troopWin,
    troopLoss: t.troopLoss,
    evenDraw: t.evenDraw,
    capped: t.capped,
    baseSeed,
    ms,
  };
}

/** 同步跑批（脚本 / 测试）；页面用 `simulateWinRateAsync` 免得卡界面 */
export function simulateWinRate(myTeam: General[], enemyTeam: General[], opts: WinRateOptions = {}): WinRateStats {
  const runs = Math.max(1, Math.floor(opts.runs ?? WIN_RATE_RUNS));
  const baseSeed = opts.baseSeed ?? WIN_RATE_BASE_SEED;
  const maxRounds = opts.maxRounds ?? WIN_RATE_MAX_ROUNDS;
  const swapSides = opts.swapSides ?? true;
  const t = emptyTally();
  const t0 = Date.now();
  for (let i = 0; i < runs; i += 1) {
    countOne(myTeam, enemyTeam, baseSeed + Math.floor(i / 2), maxRounds, swapSides && i % 2 === 1, t);
    opts.onProgress?.(i + 1, runs);
  }
  return finalize(t, baseSeed, Date.now() - t0);
}

/** 异步跑批：分片让出主线程，可边跑边显示进度（页面用） */
export async function simulateWinRateAsync(
  myTeam: General[],
  enemyTeam: General[],
  opts: WinRateOptions = {}
): Promise<WinRateStats> {
  const runs = Math.max(1, Math.floor(opts.runs ?? WIN_RATE_RUNS));
  const baseSeed = opts.baseSeed ?? WIN_RATE_BASE_SEED;
  const maxRounds = opts.maxRounds ?? WIN_RATE_MAX_ROUNDS;
  const swapSides = opts.swapSides ?? true;
  const every = Math.max(1, Math.floor(opts.yieldEvery ?? WIN_RATE_YIELD_EVERY));
  const t = emptyTally();
  const t0 = Date.now();
  for (let i = 0; i < runs; i += 1) {
    countOne(myTeam, enemyTeam, baseSeed + Math.floor(i / 2), maxRounds, swapSides && i % 2 === 1, t);
    if ((i + 1) % every === 0) {
      opts.onProgress?.(i + 1, runs);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  opts.onProgress?.(runs, runs);
  return finalize(t, baseSeed, Date.now() - t0);
}

export interface WinRatePanelOptions extends WinRateOptions {
  myTeam: General[];
  enemyTeam: General[];
  /** 视角标签（默认红队=我方） */
  myLabel?: string;
  enemyLabel?: string;
}

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/** 一行：胜利 / 平局 / 失败（标签 + 百分比 + 条形 + 场次） */
function rowHtml(kind: 'win' | 'draw' | 'loss', label: string, count: number, rate: number): string {
  const w = Math.max(0, Math.min(100, rate * 100));
  return `<div class="wr-row ${kind}">
    <span class="wr-label">${label}</span>
    <span class="wr-pct">${pct(rate)}</span>
    <span class="wr-track"><i style="width:${w.toFixed(1)}%"></i></span>
    <span class="wr-n">${count} 场</span>
  </div>`;
}

function resultHtml(s: WinRateStats, maxRounds: number): string {
  const seedSpan = Math.max(1, Math.ceil(s.runs / 2));
  return `<div class="wr-rows">
      ${rowHtml('win', '胜利', s.win, s.winRate)}
      ${rowHtml('draw', '平局', s.draw, s.drawRate)}
      ${rowHtml('loss', '失败', s.loss, s.lossRate)}
    </div>
    <p class="wr-note">判定口径：一方大营阵亡即斩首定胜负；打满 ${maxRounds} 回合双方大营存活时，按剩余兵力判定，高者胜（兵力完全相同才算平）。</p>
    <p class="wr-note">每颗种子跑「正/反」两场（其中一场把两队对调，消除先手 / 站位偏向）——因此<b>把红蓝两队对调后再统计，两次结果必然互补（和 = 100%）</b>。</p>
    <p class="wr-note">斩首：胜 ${s.decapWin} · 负 ${s.decapLoss}<br />打满 ${maxRounds} 回合（${s.capped} 场）：兵力判定胜 ${s.troopWin} · 负 ${s.troopLoss} · 完全平 ${s.evenDraw}</p>
    <p class="wr-meta">基础种子 ${s.baseSeed} · 种子 ${s.baseSeed}~${s.baseSeed + seedSpan - 1} · ${s.runs} 场 · 耗时 ${(s.ms / 1000).toFixed(1)}s</p>`;
}

/**
 * 打开「统计胜率」弹窗：立即开跑 N 场，先显示进度，跑完换成 胜 / 平 / 负 概率。
 * 关闭方式与其余弹窗一致（× / 关闭 / 点蒙层 / 安卓返回键）。
 * @returns 蒙层元素（测试用；跑完时 `dataset.state = 'done' | 'error'`）
 */
export function openWinRatePanel(opts: WinRatePanelOptions): HTMLElement {
  // 连点两次不叠两层：先撤下已在的统计弹窗
  document.querySelectorAll('.wr-mask').forEach((el) => el.remove());

  const runs = Math.max(1, Math.floor(opts.runs ?? WIN_RATE_RUNS));
  const baseSeed = opts.baseSeed ?? WIN_RATE_BASE_SEED;
  const maxRounds = opts.maxRounds ?? WIN_RATE_MAX_ROUNDS;
  const myLabel = opts.myLabel ?? '红队（我方）';
  const enemyLabel = opts.enemyLabel ?? '蓝队（敌方）';

  const mask = document.createElement('div');
  mask.className = 'modal-mask wr-mask';
  mask.dataset.state = 'running';
  mask.innerHTML = `
    <div class="modal wr-modal">
      <div class="m-head"><h3>胜率统计 · ${runs} 场模拟</h3><span class="m-close">×</span></div>
      <div class="m-body wr-body">
        <p class="wr-sub">${myLabel} vs ${enemyLabel} · 阵容/加点/站位取当前战报；每颗种子跑「正/反」两场（对调红蓝，消除先手偏向）</p>
        <div class="wr-live">
          <div class="wr-track"><i style="width:0%"></i></div>
          <p class="wr-note wr-status">模拟中 0 / ${runs}…</p>
        </div>
        <div class="wr-result" hidden></div>
      </div>
      <div class="m-foot"><button type="button" class="btn wr-done">关闭</button></div>
    </div>`;

  const close = (): void => {
    mask.remove();
  };
  mask.querySelector('.m-close')!.addEventListener('click', close);
  (mask.querySelector('.wr-done') as HTMLElement).addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });

  const live = mask.querySelector('.wr-live') as HTMLElement;
  const bar = mask.querySelector('.wr-live .wr-track i') as HTMLElement;
  const status = mask.querySelector('.wr-status') as HTMLElement;
  const result = mask.querySelector('.wr-result') as HTMLElement;

  const finish = (stats: WinRateStats): void => {
    live.hidden = true;
    result.innerHTML = resultHtml(stats, maxRounds);
    result.hidden = false;
    mask.dataset.state = 'done';
  };

  document.body.appendChild(mask);

  void simulateWinRateAsync(opts.myTeam, opts.enemyTeam, {
    runs,
    baseSeed,
    maxRounds,
    yieldEvery: opts.yieldEvery,
    onProgress: (done, total) => {
      bar.style.width = `${((done / total) * 100).toFixed(1)}%`;
      status.textContent = `模拟中 ${done} / ${total}…`;
      opts.onProgress?.(done, total);
    },
  })
    .then(finish)
    .catch((err: unknown) => {
      live.hidden = true;
      result.innerHTML = `<p class="wr-note">模拟失败：${String((err as Error)?.message ?? err)}</p>`;
      result.hidden = false;
      mask.dataset.state = 'error';
    });

  return mask;
}
