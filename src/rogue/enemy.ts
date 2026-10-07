import { runBattle } from '../engine/combat';
import { Rng } from '../engine/rng';
import type { General, Position } from '../engine/types';
import { judgeOutcome } from '../../web/battleSim';
import { ECONOMY, targetWinRate } from './economy';
import type { EnemySlot } from './types';

export { targetWinRate };

const POSITIONS: readonly Position[] = ['前锋', '中军', '大营'];

/**
 * 敌军随关卡变强：红度与等级走参数，不在流程里写死。
 * @param level 关卡号
 * @param levelCount 总关数
 */
export function enemyGrowth(level: number, levelCount: number = ECONOMY.levelCount): { redness: number; level: number } {
  if (levelCount <= 1) return { redness: 5, level: 50 };
  const t = (Math.min(Math.max(level, 1), levelCount) - 1) / (levelCount - 1);
  if (t >= 1) return { redness: 5, level: 50 };
  if (t >= 0.66) return { redness: 4, level: 40 };
  if (t >= 0.33) return { redness: 2, level: 40 };
  return { redness: 0, level: 40 };
}

/**
 * 按种子和关卡抽出 3 名不重复的敌军。同一组参数结果稳定。
 * @param seed 本局种子
 * @param level 关卡号
 * @param heroIds 可上阵的武将 id
 * @param levelCount 总关数
 */
export function rollEnemySlots(
  seed: number,
  level: number,
  heroIds: readonly string[],
  levelCount: number = ECONOMY.levelCount,
): EnemySlot[] {
  if (heroIds.length < 3) throw new Error('敌方武将池不足 3 人');
  const rng = new Rng((seed + level * 10007) >>> 0);
  const growth = enemyGrowth(level, levelCount);
  const used = new Set<string>();
  const slots: EnemySlot[] = [];
  let guard = 0;
  while (slots.length < 3 && guard < 10000) {
    guard += 1;
    const heroId = heroIds[rng.int(heroIds.length)]!;
    if (used.has(heroId)) continue;
    used.add(heroId);
    slots.push({
      heroId,
      position: POSITIONS[slots.length]!,
      redness: growth.redness,
      level: growth.level,
      skillIds: [],
    });
  }
  if (slots.length < 3) throw new Error('无法抽出 3 名不同敌军');
  return slots;
}

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

/**
 * 我方对敌方的胜率。斩首优先，打满则比兵力，与生产判定一致。
 * @param myTeam 我方
 * @param enemyTeam 敌方
 * @param runs 场次
 * @param baseSeed 起始种子，第 i 场用 baseSeed + i
 */
export function winRateVs(myTeam: General[], enemyTeam: General[], runs: number, baseSeed: number): number {
  const myCap = sum(myTeam.map((general) => general.maxTroops));
  const enemyCap = sum(enemyTeam.map((general) => general.maxTroops));
  let wins = 0;
  for (let i = 0; i < runs; i += 1) {
    const report = runBattle({ myTeam, enemyTeam, seed: baseSeed + i, maxRounds: 8 });
    const judged = judgeOutcome(
      report.result,
      myCap > 0 ? sum(report.finalMyTroops) / myCap : 0,
      enemyCap > 0 ? sum(report.finalEnemyTroops) / enemyCap : 0,
    );
    if (judged.win) wins += 1;
  }
  return runs === 0 ? 0 : wins / runs;
}

/**
 * 从候选阵容里挑一支玩家胜率最接近目标的。候选为空时抛错。
 * @param playerTeam 玩家当前阵容
 * @param candidates 候选敌军
 * @param target 目标胜率
 * @param opts 抽样场次与种子
 */
export function pickEnemy(
  playerTeam: General[],
  candidates: General[][],
  target: number,
  opts: { runs?: number; baseSeed?: number } = {},
): { team: General[]; winRate: number } {
  if (candidates.length === 0) throw new Error('pickEnemy：候选阵容为空');
  const runs = opts.runs ?? 20;
  const baseSeed = opts.baseSeed ?? 20261007;
  let best = { team: candidates[0]!, winRate: winRateVs(playerTeam, candidates[0]!, runs, baseSeed) };
  for (const team of candidates.slice(1)) {
    const winRate = winRateVs(playerTeam, team, runs, baseSeed);
    if (Math.abs(winRate - target) < Math.abs(best.winRate - target)) best = { team, winRate };
  }
  return best;
}
