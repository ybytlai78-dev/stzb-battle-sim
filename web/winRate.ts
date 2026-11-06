/**
 * 战报页「统计胜率」：把**当前双方队伍**快速跑 N 场（默认 200）模拟，给出 四档判定 + 战损比。
 * ---------------------------------------------------------------------------
 * · 判定口径（用户 2026-11-06 口径；兵力比较仍复用 L4 `judgeOutcome`，四档归并按本模块口径）：
 *   ① 一方大营阵亡 → 引擎直接给 win / loss = **胜利 / 失败**（斩首场）；
 *   ② 打满 maxRounds 回合双方大营都活着 → 引擎判 draw，再按剩余兵力分：
 *      我方兵力占优 =「优势平」、兵力劣势 =「劣势平」、
 *      兵力完全相同 =「完全平」—— **完全平并入优势平**（用户明确选择）。
 *   ③ 四档**互斥**，场次之和恒等于总场次、百分比之和恒等于 100%；斩首胜 / 负与打满场次另作脚注保留。
 * · 战损比（2026-11-06 新增）：单场 = **我方阵亡 ÷ 敌方阵亡**（只算 `totalDead`，伤兵 wounded 与
 *   残兵 troops 都不计入）；N 场取**每场比值的算术平均**（不是总量比）；分母为 0 的场次跳过、
 *   不参与均值并记 `deathRatioSkipped`；全部跳过时 `deathRatio = null`（展示 —，不给 NaN / Infinity）。
 *   `swap` 场的 `final*Dead` 同样是「左/右」视角，必须按 swap 还原成我方视角，否则一半场次分子分母算反。
 * · 固定红蓝站位、**每颗种子跑「正/反」两场**（其中一场把两队对调，`swapSides`，与 L4 同一口径）：
 *   消除先手 / 站位偏向，且「把红蓝两队对调后再统计」两次的胜率必然互补（和 = 100%）。
 * · 种子 = 基础种子 + 种子序号（默认取本场战报种子）→ 同一份战报重复统计结果一致、可复现。
 * · 只跑引擎、不渲染战报；浏览器里分片让出主线程，边跑边刷进度条。
 * · ⚠️ `PlayedBattle.bucket` 仍是三值 `win | draw | loss`（对手池 `poolMatchup` / 模板搜索 / 顾问共用），
 *   四档只在**本模块的统计与展示层**做，不改三值语义。
 */
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import { collectRun, judgeOutcome } from './battleSim';
import { isMobileUI } from './mobileUi';

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
  /** 旧三桶 · 胜场 = 斩首胜 + 优势平（对手池 / 顾问的排序口径，**语义不变**） */
  win: number;
  /** 旧三桶 · 败场 = 斩首负（用户口径：打满回合不计负） */
  loss: number;
  /** 旧三桶 · 平局场 = 劣势平 + 完全平 */
  draw: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  /** 四档 · 胜利 = 斩首胜 */
  victory: number;
  /** 四档 · 优势平 = 打满回合我方兵力占优 **+ 完全平**（用户 2026-11-06 口径） */
  edgeDraw: number;
  /** 四档 · 劣势平 = 打满回合我方兵力劣势 */
  deficitDraw: number;
  /** 四档 · 失败 = 斩首负 */
  defeat: number;
  /** 四档占比：victoryRate + edgeDrawRate + deficitDrawRate + defeatRate = 1 */
  victoryRate: number;
  edgeDrawRate: number;
  deficitDrawRate: number;
  defeatRate: number;
  /**
   * 战损比 = 每场「我方阵亡 ÷ 敌方阵亡」的算术平均（不是总量比）。
   * 分母为 0 的场次跳过；全部跳过时为 `null`（展示 —，绝不出现 NaN / Infinity）。
   */
  deathRatio: number | null;
  /** 未参与战损比的场次（该场敌方阵亡 = 0） */
  deathRatioSkipped: number;
  /** 参与战损比均值的场次 */
  deathRatioSamples: number;
  /** 参与均值场次的场均阵亡（卡片旁注用，不参与战损比计算） */
  meanMyDead: number;
  meanEnemyDead: number;
  /** 斩首（大营阵亡）决定的场次 */
  decapWin: number;
  decapLoss: number;
  /** 打满回合且我方剩余兵力占优（优势平，不含完全平） */
  advDraw: number;
  /** 打满回合且我方剩余兵力劣势（劣势平） */
  disadvDraw: number;
  /** 打满回合且剩余兵力完全相同（完全平）——四档里并入优势平 */
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
  /** 逐场「我方阵亡 ÷ 敌方阵亡」的累加（分母为 0 的场次不入账） */
  deathRatioSum: number;
  deathRatioSamples: number;
  deathRatioSkipped: number;
  /** 参与战损比的那些场次的阵亡合计（旁注） */
  myDeadSum: number;
  enemyDeadSum: number;
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
    deathRatioSum: 0,
    deathRatioSamples: 0,
    deathRatioSkipped: 0,
    myDeadSum: 0,
    enemyDeadSum: 0,
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

/**
 * 单场归类（胜 / 平 / 负 + 阵亡 + 我方伤害）。对手池对打与「统计胜率」共用这一条，避免两套口径。
 * ⚠️ `bucket` 保持三值：它被 `poolMatchup` / `templateSearch` / `advisor/*` 共用；
 *    四档（胜利 / 优势平 / 劣势平 / 失败）只在 `WinRateStats` 的统计与展示层做。
 */
export interface PlayedBattle {
  /** 胜场 = 斩首胜 + 优势平；平局场 = 劣势平 + 完全平；败场 = 斩首负 */
  bucket: 'win' | 'draw' | 'loss';
  decapWin: boolean;
  decapLoss: boolean;
  advDraw: boolean;
  disadvDraw: boolean;
  evenDraw: boolean;
  /** 我方本场阵亡兵力（已按 `swap` 还原成我方视角；只算 totalDead，伤兵 / 残兵不计） */
  myDead: number;
  /** 敌方本场阵亡兵力（同上） */
  enemyDead: number;
  /** 我方本场八回合总伤害 */
  myDamage: number;
  /** 我方本场前三回合伤害 */
  first3: number;
  /** 我方本场控制人回合 */
  controlMine: number;
}

/**
 * 阵亡数按视角还原：战报的 `finalMyDead` / `finalEnemyDead` 是「左 / 右」视角，
 * `swap` 场我方被放到右侧 → 必须像 `leftTroops/rightTroops` 那样翻回来。
 * 漏这一步 = 一半场次的战损比分子分母算反（且不会被总量校验发现）。
 */
export function mapDeaths(leftDead: number, rightDead: number, swap: boolean): { my: number; enemy: number } {
  return swap ? { my: rightDead, enemy: leftDead } : { my: leftDead, enemy: rightDead };
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
  const dead = mapDeaths(
    report.finalMyDead.reduce((a, b) => a + b, 0),
    report.finalEnemyDead.reduce((a, b) => a + b, 0),
    swap
  );
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
    myDead: dead.my,
    enemyDead: dead.enemy,
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

/** 把一场归类累进 tally */
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
  // 战损比：分母为 0 的场次跳过（不参与均值，也不计入旁注的场均阵亡）
  if (p.enemyDead > 0) {
    t.deathRatioSum += p.myDead / p.enemyDead;
    t.deathRatioSamples += 1;
    t.myDeadSum += p.myDead;
    t.enemyDeadSum += p.enemyDead;
  } else {
    t.deathRatioSkipped += 1;
  }
}

function finalize(t: Tally, baseSeed: number, ms: number): WinRateStats {
  const n = Math.max(1, t.runs);
  // 四档：完全平并入优势平（用户 2026-11-06 口径），四者互斥、和 = runs
  const victory = t.decapWin;
  const edgeDraw = t.advDraw + t.evenDraw;
  const deficitDraw = t.disadvDraw;
  const defeat = t.decapLoss;
  const samples = t.deathRatioSamples;
  return {
    runs: t.runs,
    win: t.win,
    loss: t.loss,
    draw: t.draw,
    winRate: t.win / n,
    lossRate: t.loss / n,
    drawRate: t.draw / n,
    victory,
    edgeDraw,
    deficitDraw,
    defeat,
    victoryRate: victory / n,
    edgeDrawRate: edgeDraw / n,
    deficitDrawRate: deficitDraw / n,
    defeatRate: defeat / n,
    deathRatio: samples > 0 && Number.isFinite(t.deathRatioSum / samples) ? t.deathRatioSum / samples : null,
    deathRatioSkipped: t.deathRatioSkipped,
    deathRatioSamples: samples,
    meanMyDead: samples > 0 ? t.myDeadSum / samples : 0,
    meanEnemyDead: samples > 0 ? t.enemyDeadSum / samples : 0,
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

/**
 * 把已经归好类的场次汇总成统计（测试 / 脚本用）。
 * 与 `simulateWinRate` 走同一套 `absorbPlay` + `finalize`，因此口径绝不会两套。
 */
export function summarizePlays(plays: PlayedBattle[], baseSeed: number = WIN_RATE_BASE_SEED): WinRateStats {
  const t = emptyTally();
  for (const p of plays) absorbPlay(t, p);
  return finalize(t, baseSeed, 0);
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

/** 四档的样式键（只影响配色，不影响口径）：胜利 / 优势平走暖金系，劣势平 / 失败走暗红系 */
export type TierKind = 'victory' | 'edge' | 'deficit' | 'defeat';

/** 一行：档位名 + 百分比 + 横条 + 场次（条宽 = 该档占总场次的百分比） */
function tierRowHtml(kind: TierKind, label: string, count: number, rate: number): string {
  const w = Math.max(0, Math.min(100, rate * 100));
  return `<div class="wr-row wr-${kind}">
    <span class="wr-label">${label}</span>
    <span class="wr-pct">${pct(rate)}</span>
    <span class="wr-track"><i style="width:${w.toFixed(1)}%"></i></span>
    <span class="wr-n">${count} 场</span>
  </div>`;
}

/** 战损比主数字：全跳过时给 —，不把 NaN / Infinity 递到界面上 */
export function deathRatioText(s: Pick<WinRateStats, 'deathRatio'>): string {
  return s.deathRatio == null || !Number.isFinite(s.deathRatio) ? '—' : s.deathRatio.toFixed(2);
}

/** 场均阵亡是兵数，带小数反而像精度错觉——取整并按千分位写 */
function fmtTroops(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 战损比块：主数字 + 口径说明 + 场均阵亡旁注（跳过场次要写明，避免被误读成总量比） */
function ratioHtml(s: WinRateStats): string {
  const skip = s.deathRatioSkipped;
  const detail =
    s.deathRatio == null
      ? `${s.runs} 场全部是敌方零阵亡，战损比无从计算`
      : `场均 我死 ${fmtTroops(s.meanMyDead)} · 敌死 ${fmtTroops(s.meanEnemyDead)}（计入 ${s.deathRatioSamples} 场${
          skip > 0 ? `，跳过 ${skip} 场敌方零阵亡` : ''
        }）`;
  return `<div class="wr-ratio">
      <div class="wr-ratio-head">
        <span class="wr-ratio-label">战损比</span>
        <span class="wr-ratio-value">${deathRatioText(s)}</span>
        <span class="wr-ratio-hint">我方阵亡 ÷ 敌方阵亡 · 越小越好</span>
      </div>
      <p class="wr-ratio-note">逐场求比值再取算术平均（不是总量比）；只算阵亡，伤兵 / 残兵不计。</p>
      <p class="wr-ratio-note">${detail}</p>
    </div>`;
}

/** 结果区 HTML（导出仅为测试断言口径：四档四行 + 战损比块 + 口径说明） */
export function resultHtml(s: WinRateStats, maxRounds: number): string {
  const seedSpan = Math.max(1, Math.ceil(s.runs / 2));
  return `<div class="wr-rows">
      ${tierRowHtml('victory', '胜利', s.victory, s.victoryRate)}
      ${tierRowHtml('edge', '优势平', s.edgeDraw, s.edgeDrawRate)}
      ${tierRowHtml('deficit', '劣势平', s.deficitDraw, s.deficitDrawRate)}
      ${tierRowHtml('defeat', '失败', s.defeat, s.defeatRate)}
    </div>
    <p class="wr-rule">胜利 = 斩首胜 · 优势平 = 打满占优 / 完全平 · 劣势平 = 打满劣势 · 失败 = 斩首负</p>
    ${ratioHtml(s)}
    <details class="wr-notes"${isMobileUI() ? '' : ' open'}>
      <summary>判定与统计口径</summary>
      <p class="wr-note">判定：一方大营阵亡即斩首定胜负；打满 ${maxRounds} 回合双方大营存活时判平局，按剩余兵力分优势平（我方占优）/ 劣势平（我方劣势）/ 完全平（双方兵力完全相同）。</p>
      <p class="wr-note">四档（2026-11-06 口径）：胜利 = 斩首胜；优势平 = 打满占优 <b>+ 完全平</b>（完全平并入优势平）；劣势平 = 打满劣势；失败 = 斩首负。四档互斥，场次之和 = 总场次 ${s.runs}，百分比之和 = 100%。</p>
      <p class="wr-note">战损比：单场 = 我方阵亡 ÷ 敌方阵亡，只算累计阵亡（伤兵 / 残兵不计）；${s.runs} 场取每场比值的算术平均，分母为 0 的场次跳过；全部跳过时显示 —。</p>
      <p class="wr-note">每颗种子跑「正/反」两场（其中一场把两队对调，消除先手 / 站位偏向）——因此<b>把红蓝两队对调后再统计，两次胜率必然互补（和 = 100%）</b>。</p>
      <p class="wr-note">细分：斩首胜 ${s.decapWin} · 斩首负 ${s.decapLoss}；打满 ${maxRounds} 回合 ${s.capped} 场 = 优势平 ${s.advDraw} + 完全平 ${s.evenDraw} + 劣势平 ${s.disadvDraw}。</p>
      <p class="wr-meta">基础种子 ${s.baseSeed} · 种子 ${s.baseSeed}~${s.baseSeed + seedSpan - 1} · ${s.runs} 场 · 耗时 ${(s.ms / 1000).toFixed(1)}s</p>
    </details>`;
}

/**
 * 打开「统计胜率」弹窗：立即开跑 N 场，先显示进度，跑完换成 四档占比 + 战损比。
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
