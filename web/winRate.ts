/**
 * 战报页「统计胜率」：把**当前双方队伍**快速跑 N 场（默认 200）模拟，给出 胜 / 平 / 负 概率。
 * ---------------------------------------------------------------------------
 * · 判定口径（用户 2026-09-27 调整；兵力比较仍复用 L4 `judgeOutcome`，胜 / 平 / 负归并按本模块口径）：
 *   ① 一方大营阵亡 → 引擎直接给 win / loss（斩首场，计入胜 / 负场）；
 *   ② 打满 maxRounds 回合双方大营都活着 → 判**平局**，再按剩余兵力分：
 *      我方兵力占优 =「优势平」（计入胜场）、兵力劣势 =「劣势平」（计入平局场）、
 *      兵力完全相同 =「完全平」（计入平局场）。
 * · 固定红蓝站位、**每颗种子跑「正/反」两场**（其中一场把两队对调，`swapSides`，与 L4 同一口径）：
 *   消除先手 / 站位偏向，且「把红蓝两队对调后再统计」两次的胜率必然互补（和 = 100%）。
 * · 种子 = 基础种子 + 种子序号（默认取本场战报种子）→ 同一份战报重复统计结果一致、可复现。
 * · 只跑引擎、不渲染战报；浏览器里分片让出主线程，边跑边刷进度条。
 */
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import { collectRun, judgeOutcome } from './battleSim';

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
  /** 胜场 = 斩首胜 + 优势平（用户口径） */
  win: number;
  /** 败场 = 斩首负（用户口径：打满回合不计负） */
  loss: number;
  /** 平局场 = 劣势平 + 完全平（用户口径） */
  draw: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  /** 斩首（大营阵亡）决定的场次 */
  decapWin: number;
  decapLoss: number;
  /** 打满回合且我方剩余兵力占优（优势平）——计入胜场 */
  advDraw: number;
  /** 打满回合且我方剩余兵力劣势（劣势平）——计入平局场 */
  disadvDraw: number;
  /** 打满回合且剩余兵力完全相同（完全平）——计入平局场 */
  evenDraw: number;
  /** 打满回合（引擎原生平局）总场次 = advDraw + disadvDraw + evenDraw */
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
  advDraw: number;
  disadvDraw: number;
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
    advDraw: 0,
    disadvDraw: 0,
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

/** 单场归类（胜 / 平 / 负 + 我方伤害）。对手池对打与「统计胜率」共用这一条，避免两套口径。 */
export interface PlayedBattle {
  /** 胜场 = 斩首胜 + 优势平；平局场 = 劣势平 + 完全平；败场 = 斩首负 */
  bucket: 'win' | 'draw' | 'loss';
  decapWin: boolean;
  decapLoss: boolean;
  advDraw: boolean;
  disadvDraw: boolean;
  evenDraw: boolean;
  /** 我方本场八回合总伤害 */
  myDamage: number;
  /** 我方本场前三回合伤害 */
  first3: number;
  /** 我方本场控制人回合 */
  controlMine: number;
}

/**
 * 跑一场并按统计胜率口径归类（`myTeam` 恒为「我方」视角）。
 * `swap` = 本场把两队对调（我方临时放到右侧），胜负与伤害都还原成我方视角。
 * 伤害用战报上的实际单位 id（交换场地、同名将改写 id 之后仍然对得上我方）。
 */
export function playOne(
  myTeam: General[],
  enemyTeam: General[],
  seed: number,
  maxRounds: number,
  swap: boolean
): PlayedBattle {
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
  const result: 'win' | 'loss' | 'draw' = swap
    ? report.result === 'win'
      ? 'loss'
      : report.result === 'loss'
        ? 'win'
        : 'draw'
    : report.result;
  const judged = judgeOutcome(result, myTroops, enemyTroops);
  const capped = result === 'draw';
  const myIds = new Set((swap ? report.enemyTeam : report.myTeam).map((g) => g.id));
  const raw = collectRun(report, myIds);
  const first3 = (raw.myDamageByRound[0] ?? 0) + (raw.myDamageByRound[1] ?? 0) + (raw.myDamageByRound[2] ?? 0);
  const played: PlayedBattle = {
    bucket: 'loss',
    decapWin: false,
    decapLoss: false,
    advDraw: false,
    disadvDraw: false,
    evenDraw: false,
    myDamage: raw.myDamage,
    first3,
    controlMine: raw.controlMine,
  };
  if (!capped) {
    if (result === 'win') {
      played.bucket = 'win';
      played.decapWin = true;
    } else {
      played.decapLoss = true;
    }
  } else if (judged.win) {
    played.bucket = 'win';
    played.advDraw = true;
  } else if (judged.draw) {
    played.bucket = 'draw';
    played.evenDraw = true;
  } else {
    played.bucket = 'draw';
    played.disadvDraw = true;
  }
  return played;
}

/** 把一场归类累进 tally（与原先 `countOne` 的计数一致） */
function absorbPlay(t: Tally, p: PlayedBattle): void {
  t.runs += 1;
  if (p.advDraw || p.disadvDraw || p.evenDraw) t.capped += 1;
  if (p.bucket === 'win') t.win += 1;
  else if (p.bucket === 'draw') t.draw += 1;
  else t.loss += 1;
  if (p.decapWin) t.decapWin += 1;
  if (p.decapLoss) t.decapLoss += 1;
  if (p.advDraw) t.advDraw += 1;
  if (p.disadvDraw) t.disadvDraw += 1;
  if (p.evenDraw) t.evenDraw += 1;
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
    advDraw: t.advDraw,
    disadvDraw: t.disadvDraw,
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
    absorbPlay(t, playOne(myTeam, enemyTeam, baseSeed + Math.floor(i / 2), maxRounds, swapSides && i % 2 === 1));
    opts.onProgress?.(i + 1, runs);
  }
  return finalize(t, baseSeed, Date.now() - t0);
}

/** 与 `WinRateStats` 同一批战斗额外带出的伤害（对手池对打的辅助列） */
export interface WinRateSample extends WinRateStats {
  /** 八回合我方总伤害 / 场 */
  meanTotal: number;
  /** 前三回合我方伤害 / 场 */
  meanFirst3: number;
  /** 我方控制人回合 / 场 */
  controlMine: number;
}

/**
 * 同步跑批，并在同一批战斗里汇总八回合总伤与前三回合伤害。
 * 胜 / 平 / 负计数与 `simulateWinRate` 相同（同一 `playOne`）。
 */
export function simulateWinRateSample(myTeam: General[], enemyTeam: General[], opts: WinRateOptions = {}): WinRateSample {
  const runs = Math.max(1, Math.floor(opts.runs ?? WIN_RATE_RUNS));
  const baseSeed = opts.baseSeed ?? WIN_RATE_BASE_SEED;
  const maxRounds = opts.maxRounds ?? WIN_RATE_MAX_ROUNDS;
  const swapSides = opts.swapSides ?? true;
  const t = emptyTally();
  let damageSum = 0;
  let first3Sum = 0;
  let controlSum = 0;
  const t0 = Date.now();
  for (let i = 0; i < runs; i += 1) {
    const played = playOne(myTeam, enemyTeam, baseSeed + Math.floor(i / 2), maxRounds, swapSides && i % 2 === 1);
    absorbPlay(t, played);
    damageSum += played.myDamage;
    first3Sum += played.first3;
    controlSum += played.controlMine;
    opts.onProgress?.(i + 1, runs);
  }
  const stats = finalize(t, baseSeed, Date.now() - t0);
  const n = Math.max(1, stats.runs);
  return { ...stats, meanTotal: damageSum / n, meanFirst3: first3Sum / n, controlMine: controlSum / n };
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
    absorbPlay(t, playOne(myTeam, enemyTeam, baseSeed + Math.floor(i / 2), maxRounds, swapSides && i % 2 === 1));
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
    <p class="wr-note">判定口径：一方大营阵亡即斩首定胜负；打满 ${maxRounds} 回合双方大营存活时判平局，按剩余兵力分优势平（我方占优）/ 劣势平（我方劣势）/ 完全平（兵力相同）。</p>
    <p class="wr-note">统计口径：胜场 = 斩首胜 + 优势平；平局场 = 劣势平 + 完全平；败场 = 斩首负。</p>
    <p class="wr-note">每颗种子跑「正/反」两场（其中一场把两队对调，消除先手 / 站位偏向）——因此<b>把红蓝两队对调后再统计，两次胜率必然互补（和 = 100%）</b>。</p>
    <p class="wr-note">斩首：胜 ${s.decapWin} · 负 ${s.decapLoss}<br />打满 ${maxRounds} 回合（${s.capped} 场）：优势平 ${s.advDraw} · 劣势平 ${s.disadvDraw} · 完全平 ${s.evenDraw}</p>
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
