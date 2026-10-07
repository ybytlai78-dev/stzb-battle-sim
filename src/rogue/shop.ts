import { priceOf, type ShopGrade, type Wallet } from './economy';
import { addSkill } from './pool';
import type { PoolState } from './types';

export interface ShopEntry {
  skillId: string;
  grade: string;
}

export interface ShopListing {
  skillId: string;
  grade: ShopGrade;
  price: number;
}

export type BuyFailure = 'not_for_sale' | 'owned' | 'broke';

export type BuyResult =
  | { ok: true; wallet: Wallet; pool: PoolState }
  | { ok: false; reason: BuyFailure };

/**
 * 商店货架：只留 A/S，已拥有的不上架。
 * @param owned 已有战法
 * @param catalogue 全部候选（含品级）
 */
export function shopListings(owned: readonly string[], catalogue: readonly ShopEntry[]): ShopListing[] {
  const have = new Set(owned);
  const listings: ShopListing[] = [];
  for (const row of catalogue) {
    if (row.grade !== 'A' && row.grade !== 'S') continue;
    if (have.has(row.skillId)) continue;
    const grade = row.grade as ShopGrade;
    listings.push({ skillId: row.skillId, grade, price: priceOf(grade) });
  }
  return listings;
}

/**
 * 指定购买一张战法。失败时不改钱包和背包。
 * @param wallet 当前钱包
 * @param pool 当前卡池
 * @param skillId 要买的战法
 * @param catalogue 商店目录
 */
export function buySkill(
  wallet: Wallet,
  pool: PoolState,
  skillId: string,
  catalogue: readonly ShopEntry[],
): BuyResult {
  const row = catalogue.find((item) => item.skillId === skillId);
  if (!row || (row.grade !== 'A' && row.grade !== 'S')) return { ok: false, reason: 'not_for_sale' };
  if (pool.skills.includes(skillId)) return { ok: false, reason: 'owned' };
  const price = priceOf(row.grade);
  if (wallet.jade < price) return { ok: false, reason: 'broke' };
  return { ok: true, wallet: { jade: wallet.jade - price }, pool: addSkill(pool, skillId) };
}
