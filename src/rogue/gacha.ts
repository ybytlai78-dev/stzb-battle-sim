import type { Rng } from '../engine/rng';
import { ECONOMY, spend, type Wallet } from './economy';
import type { PendingPull } from './types';

/**
 * 从目录里有放回地抽 5 个 id。目录为空时抛错。
 * @param rng 随机源
 * @param catalogue 可抽的武将 id
 */
export function drawFive(rng: Rng, catalogue: readonly string[]): string[] {
  if (catalogue.length === 0) throw new Error('抽卡池为空');
  return Array.from({ length: 5 }, () => catalogue[rng.int(catalogue.length)]!);
}

/**
 * 从目录里抽 1 个 id。
 * @param rng 随机源
 * @param catalogue 可抽的武将 id
 */
export function drawOne(rng: Rng, catalogue: readonly string[]): string {
  if (catalogue.length === 0) throw new Error('抽卡池为空');
  return catalogue[rng.int(catalogue.length)]!;
}

/**
 * 支付一次五连抽，并同时摇出五张展示和爽玩结果。
 * 玉符不够时返回 null，不消耗随机源。
 * @param wallet 当前钱包
 * @param rng 随机源
 * @param catalogue 可抽的武将 id
 */
export function beginPull(
  wallet: Wallet,
  rng: Rng,
  catalogue: readonly string[],
): { wallet: Wallet; pull: PendingPull } | null {
  const next = spend(wallet, ECONOMY.gachaCost);
  if (!next) return null;
  return {
    wallet: next,
    pull: { shown: drawFive(rng, catalogue), picked: null, bonus: drawOne(rng, catalogue) },
  };
}

/**
 * 五选一。选中的 id 必须出现在本次展示里。重复选择同一张返回原引用。
 * @param pull 进行中的五连抽
 * @param heroId 玩家选中的武将
 */
export function pickFromPull(pull: PendingPull, heroId: string): PendingPull {
  if (pull.picked === heroId) return pull;
  if (pull.picked) throw new Error('这次五连抽已经选过了');
  if (!pull.shown.includes(heroId)) throw new Error('这张不在本次五连抽里');
  return { ...pull, picked: heroId };
}

/**
 * 取出已经摇定的爽玩武将。还没五选一时抛错。
 * @param pull 进行中的五连抽
 */
export function claimBonus(pull: PendingPull): string {
  if (!pull.picked) throw new Error('先完成五选一');
  return pull.bonus;
}
