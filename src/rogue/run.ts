import { ECONOMY } from './economy';
import type { Outcome, RunState } from './types';

/**
 * 新开一局。
 * @param seed 本局随机种子
 * @param levelCount 关卡总数，缺省 12
 * @param lives 命数，缺省 3
 */
export function createRun(
  seed: number,
  levelCount: number = ECONOMY.levelCount,
  lives: number = ECONOMY.lives,
): RunState {
  return { schemaVersion: 1, seed, level: 1, levelCount, lives, status: 'playing' };
}

/**
 * 把一场胜负写进关卡状态。终局之后原样返回（同一引用）。
 * 胜：关卡 +1，超过总数则通关，关号停在最后一关。
 * 败：命数 -1，关号不变，命数归零则结束。
 * 平：什么都不改。
 * @param state 当前局
 * @param outcome 本场胜负
 */
export function applyOutcome(state: RunState, outcome: Outcome): RunState {
  if (state.status !== 'playing') return state;
  if (outcome === 'draw') return state;
  if (outcome === 'lose') {
    const lives = state.lives - 1;
    return { ...state, lives: Math.max(0, lives), status: lives <= 0 ? 'dead' : 'playing' };
  }
  const level = state.level + 1;
  return level > state.levelCount
    ? { ...state, level: state.levelCount, status: 'cleared' }
    : { ...state, level };
}
