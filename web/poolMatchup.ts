/**
 * 一套阵容打整份对手池。
 * ---------------------------------------------------------------------------
 * 胜 / 平 / 负与主站「统计胜率」同一条（`playOne`）：
 * 胜场 = 斩首胜 + 优势平；平局场 = 劣势平 + 完全平；败场 = 斩首负。
 * 每个对手默认至少 100 场我方视角（50 颗种子 × 正反场地）。
 * 八回合总伤、前三回合伤害从同一批战斗汇总，只作辅助。
 */
import type { General } from '../src/engine/types';
import { generalsOf } from './teamConfig';
import { poolFingerprint, type MergedPool, type PoolEntry, type PoolSource } from './opponentPool';
import { simulateWinRateSample, WIN_RATE_BASE_SEED, WIN_RATE_MAX_ROUNDS, type WinRateSample } from './winRate';

/** 决赛每个对手的最少场次（我方视角，含正反场地） */
export const MATCHUP_RUNS_MIN = 100;
/** 粗筛每个对手的默认场次 */
export const COARSE_RUNS_DEFAULT = 20;

/** 正态近似的 95% 半宽（胜率是 0~1 的比例） */
export function binomialHalfWidth(winRate: number, runs: number): number {
  if (runs <= 0) return 0;
  const p = Math.min(1, Math.max(0, winRate));
  return 1.96 * Math.sqrt((p * (1 - p)) / runs);
}

/** 两套胜率的 95% 区间重叠 → 分不出来 */
export function ratesIndistinguishable(
  a: { winRate: number; halfWidth: number },
  b: { winRate: number; halfWidth: number }
): boolean {
  return Math.abs(a.winRate - b.winRate) <= a.halfWidth + b.halfWidth + 1e-12;
}

/** 对某一个对手的成绩 */
export interface OpponentScore {
  id: string;
  note: string;
  source: PoolSource;
  runs: number;
  win: number;
  draw: number;
  loss: number;
  winRate: number;
  halfWidth: number;
  meanTotal: number;
  meanFirst3: number;
  controlMine: number;
}

/** 打完整池后的汇总。综合胜率 = 全部胜场 / 全部场次（各对手场次相同即等权）。 */
export interface PoolMatchup {
  version: string;
  fingerprint: string;
  baseSeed: number;
  runsPerOpponent: number;
  opponents: OpponentScore[];
  runs: number;
  win: number;
  draw: number;
  loss: number;
  winRate: number;
  halfWidth: number;
  meanTotal: number;
  meanFirst3: number;
  controlMine: number;
  worst: { id: string; note: string; winRate: number };
  battles: number;
  ms: number;
}

export interface MatchupOptions {
  /** 每个对手的我方视角场次。工具层会把低于 {@link MATCHUP_RUNS_MIN} 的请求抬回去。 */
  runsPerOpponent: number;
  baseSeed?: number;
  maxRounds?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

function scoreOf(entry: PoolEntry, sample: WinRateSample): OpponentScore {
  return {
    id: entry.id,
    note: entry.note,
    source: entry.source,
    runs: sample.runs,
    win: sample.win,
    draw: sample.draw,
    loss: sample.loss,
    winRate: sample.winRate,
    halfWidth: binomialHalfWidth(sample.winRate, sample.runs),
    meanTotal: sample.meanTotal,
    meanFirst3: sample.meanFirst3,
    controlMine: sample.controlMine,
  };
}

function combine(pool: MergedPool, rows: OpponentScore[], baseSeed: number, runsPerOpponent: number, ms: number): PoolMatchup {
  const runs = rows.reduce((a, r) => a + r.runs, 0);
  const win = rows.reduce((a, r) => a + r.win, 0);
  const draw = rows.reduce((a, r) => a + r.draw, 0);
  const loss = rows.reduce((a, r) => a + r.loss, 0);
  const winRate = runs > 0 ? win / runs : 0;
  const meanTotal = runs > 0 ? rows.reduce((a, r) => a + r.meanTotal * r.runs, 0) / runs : 0;
  const meanFirst3 = runs > 0 ? rows.reduce((a, r) => a + r.meanFirst3 * r.runs, 0) / runs : 0;
  const controlMine = runs > 0 ? rows.reduce((a, r) => a + r.controlMine * r.runs, 0) / runs : 0;
  const worst = rows.reduce((w, r) => (r.winRate < w.winRate ? r : w), rows[0]);
  return {
    version: pool.version,
    fingerprint: poolFingerprint(pool),
    baseSeed,
    runsPerOpponent,
    opponents: rows,
    runs,
    win,
    draw,
    loss,
    winRate,
    halfWidth: binomialHalfWidth(winRate, runs),
    meanTotal,
    meanFirst3,
    controlMine,
    worst: { id: worst.id, note: worst.note, winRate: worst.winRate },
    battles: runs,
    ms,
  };
}

function enemyOf(entry: PoolEntry): General[] {
  const team = generalsOf(entry.cfg, entry.cfg.morale ?? 120);
  if (team.length < 3) throw new Error(`对手「${entry.note}」凑不满 3 名可战斗武将`);
  return team;
}

/**
 * 同步打完整池。每个对手一场接一场，种子规则与统计胜率相同（第 k 颗种子正反各一场）。
 */
export function matchupPool(myTeam: General[], pool: MergedPool, opts: MatchupOptions): PoolMatchup {
  if (!pool.entries.length) throw new Error('对手池是空的');
  if (myTeam.length < 3) throw new Error('我方不满 3 名武将');
  const runsPerOpponent = Math.max(1, Math.floor(opts.runsPerOpponent));
  const baseSeed = opts.baseSeed ?? WIN_RATE_BASE_SEED;
  const maxRounds = opts.maxRounds ?? WIN_RATE_MAX_ROUNDS;
  const t0 = Date.now();
  const rows: OpponentScore[] = [];
  let done = 0;
  const total = pool.entries.length * runsPerOpponent;
  for (const entry of pool.entries) {
    if (opts.signal?.aborted) {
      const err = new Error('已取消');
      err.name = 'AbortError';
      throw err;
    }
    const sample = simulateWinRateSample(myTeam, enemyOf(entry), {
      runs: runsPerOpponent,
      baseSeed,
      maxRounds,
      swapSides: true,
      onProgress: (n) => opts.onProgress?.(done + n, total),
    });
    done += sample.runs;
    rows.push(scoreOf(entry, sample));
  }
  return combine(pool, rows, baseSeed, runsPerOpponent, Date.now() - t0);
}

/** 异步打完整池：每打完一个对手让出一次主线程，便于刷新进度和取消。 */
export async function matchupPoolAsync(myTeam: General[], pool: MergedPool, opts: MatchupOptions): Promise<PoolMatchup> {
  if (!pool.entries.length) throw new Error('对手池是空的');
  if (myTeam.length < 3) throw new Error('我方不满 3 名武将');
  const runsPerOpponent = Math.max(1, Math.floor(opts.runsPerOpponent));
  const baseSeed = opts.baseSeed ?? WIN_RATE_BASE_SEED;
  const maxRounds = opts.maxRounds ?? WIN_RATE_MAX_ROUNDS;
  const t0 = Date.now();
  const rows: OpponentScore[] = [];
  let done = 0;
  const total = pool.entries.length * runsPerOpponent;
  for (const entry of pool.entries) {
    if (opts.signal?.aborted) {
      const err = new Error('已取消');
      err.name = 'AbortError';
      throw err;
    }
    const sample = simulateWinRateSample(myTeam, enemyOf(entry), {
      runs: runsPerOpponent,
      baseSeed,
      maxRounds,
      swapSides: true,
    });
    done += sample.runs;
    opts.onProgress?.(done, total);
    rows.push(scoreOf(entry, sample));
    await new Promise((res) => setTimeout(res, 0));
  }
  return combine(pool, rows, baseSeed, runsPerOpponent, Date.now() - t0);
}
