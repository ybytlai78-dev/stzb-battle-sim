import type { Rng } from '../engine/rng';
import { ECONOMY, gain, type Wallet } from './economy';
import { addSkill, addTreasure } from './pool';
import type { PoolState } from './types';

export type ClearBonus =
  | { kind: 'skill'; id: string; grade: 'A' | 'S' }
  | { kind: 'treasure'; id: string };

export interface ClearReward {
  jade: number;
  bonus: ClearBonus | null;
}

export interface RewardCatalogue {
  skills: ReadonlyArray<{ skillId: string; grade: string }>;
  treasures: readonly string[];
}

/**
 * 幕末关：每 4 关一次。v1 不发突破奖励，调用方只用来显示空位。
 * @param level 刚打完的关卡号
 */
export function isEliteLevel(level: number): boolean {
  return level > 0 && level % 4 === 0;
}

/**
 * 突破机制奖励。v1 固定为 null。
 * @param _level 关卡号
 */
export function breakthroughReward(_level: number): null {
  return null;
}

/**
 * 通关奖励：固定玉符，再从「未拥有的 A/S 战法 + 未拥有的宝物」里随机一件。
 * 池子空了就只给玉符。
 * @param rng 随机源
 * @param catalogue 可掉落目录
 * @param owned 已经拥有的战法与宝物
 */
export function rollClearReward(
  rng: Rng,
  catalogue: RewardCatalogue,
  owned: { skills: readonly string[]; treasures: readonly string[] },
): ClearReward {
  const ownedSkills = new Set(owned.skills);
  const ownedTreasures = new Set(owned.treasures);
  const bag: ClearBonus[] = [];
  for (const skill of catalogue.skills) {
    if (skill.grade !== 'A' && skill.grade !== 'S') continue;
    if (ownedSkills.has(skill.skillId)) continue;
    bag.push({ kind: 'skill', id: skill.skillId, grade: skill.grade });
  }
  for (const id of catalogue.treasures) {
    if (ownedTreasures.has(id)) continue;
    bag.push({ kind: 'treasure', id });
  }
  const bonus = bag.length === 0 ? null : bag[rng.int(bag.length)]!;
  return { jade: ECONOMY.clearJade, bonus };
}

/**
 * 把通关奖励写入钱包和卡池。
 * @param wallet 当前钱包
 * @param pool 当前卡池
 * @param reward 已经摇出的奖励
 */
export function applyClearReward(
  wallet: Wallet,
  pool: PoolState,
  reward: ClearReward,
): { wallet: Wallet; pool: PoolState } {
  let next = pool;
  if (reward.bonus?.kind === 'skill') next = addSkill(next, reward.bonus.id);
  if (reward.bonus?.kind === 'treasure') next = addTreasure(next, reward.bonus.id);
  return { wallet: gain(wallet, reward.jade), pool: next };
}
