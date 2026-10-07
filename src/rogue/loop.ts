import { runBattle } from '../engine/combat';
import type { BattleReport, General, Position } from '../engine/types';
import { judgeOutcome } from '../../web/battleSim';
import { applyBattleResult } from './pool';
import { applyOutcome } from './run';
import type { Outcome, PoolState, RunState } from './types';

export interface TeamSlot {
  heroId: string;
  skillIds: string[];
  position: Position;
  /** 宝物 id 字符串；不佩戴则省略 */
  treasureId?: string;
}

export interface TeamChoice {
  slots: TeamSlot[];
}

export interface LoopDeps {
  /**
   * 由表现层注入的武将构建。玩法层不引用武将表。
   * @param heroId 武将 id
   * @param skillIds 已拥有且选中的战法
   * @param position 站位
   * @param redness 红度
   * @param level 等级
   * @param treasureId 宝物 id
   */
  buildGeneral: (
    heroId: string,
    skillIds: string[],
    position: Position,
    redness: number,
    level: number,
    treasureId?: string,
  ) => General;
}

export interface LevelResult {
  run: RunState;
  pool: PoolState;
  report: BattleReport;
  outcome: Outcome;
}

/**
 * 按组队选择构建我方。武将必须在卡池里，战法和宝物必须已拥有。
 * 红度、等级用卡池上的值，不听调用方另传。
 * @param pool 卡池
 * @param choice 本关阵容
 * @param deps 注入的构建函数
 */
export function buildMyTeam(pool: PoolState, choice: TeamChoice, deps: LoopDeps): General[] {
  return choice.slots.map((slot) => {
    const owned = pool.heroes.find((hero) => hero.heroId === slot.heroId);
    if (!owned) throw new Error(`卡池没有这名武将：${slot.heroId}`);
    for (const skillId of slot.skillIds) {
      if (!pool.skills.includes(skillId)) throw new Error(`未拥有战法：${skillId}`);
    }
    if (slot.treasureId && !pool.treasures.includes(slot.treasureId)) {
      throw new Error(`未拥有宝物：${slot.treasureId}`);
    }
    return deps.buildGeneral(slot.heroId, slot.skillIds, slot.position, owned.redness, owned.level, slot.treasureId);
  });
}

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

/**
 * 结算一关：跑战斗、判胜负、回写兵力、推进关卡。奖励由调用方在胜利后另发。
 * @param run 当前局
 * @param pool 当前卡池
 * @param myTeam 我方
 * @param enemyTeam 敌方
 * @param levelIndex 本关序号，用来错开种子
 */
export function settleLevel(
  run: RunState,
  pool: PoolState,
  myTeam: General[],
  enemyTeam: General[],
  levelIndex: number,
): LevelResult {
  const report = runBattle({
    myTeam,
    enemyTeam,
    seed: run.seed + levelIndex * 1000,
    maxRounds: 8,
  });
  const myCap = sum(myTeam.map((general) => general.maxTroops));
  const enemyCap = sum(enemyTeam.map((general) => general.maxTroops));
  const judged = judgeOutcome(
    report.result,
    myCap > 0 ? sum(report.finalMyTroops) / myCap : 0,
    enemyCap > 0 ? sum(report.finalEnemyTroops) / enemyCap : 0,
  );
  const outcome: Outcome = judged.draw ? 'draw' : judged.win ? 'win' : 'lose';
  const nextPool = applyBattleResult(
    pool,
    myTeam.map((general, index) => ({
      heroId: general.heroId ?? general.id,
      troops: report.finalMyTroops[index] ?? 0,
      wounded: report.finalMyWounded[index] ?? 0,
    })),
  );
  return { run: applyOutcome(run, outcome), pool: nextPool, report, outcome };
}
