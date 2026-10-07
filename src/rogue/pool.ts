import {
  copiesUntilMax,
  growthForCopies,
  troopCapacity,
  type RecruitFeedback,
} from './recruit';
import type { HeroSlot, PoolState } from './types';

export type { RecruitFeedback };

export interface PoolInit {
  heroes?: readonly string[];
  skills?: readonly string[];
  treasures?: readonly string[];
}

/**
 * 空卡池，或带上初始战法与已有武将。武将按红度阶梯从第 1 次开始。
 * @param init 初始 id 列表
 */
export function createPool(init: PoolInit = {}): PoolState {
  let pool: PoolState = {
    heroes: [],
    skills: [...new Set(init.skills ?? [])],
    treasures: [...new Set(init.treasures ?? [])],
  };
  for (const heroId of init.heroes ?? []) pool = addHero(pool, heroId).pool;
  return pool;
}

/**
 * 获得一名武将。新将入池；重复则按阶梯升红，兵力上限的增量加到当前兵力上。
 * 已满红后再获得只增加次数，数值不变。
 * @param pool 当前卡池
 * @param heroId 武将 id
 */
export function addHero(pool: PoolState, heroId: string): { pool: PoolState; feedback: RecruitFeedback } {
  const index = pool.heroes.findIndex((hero) => hero.heroId === heroId);
  if (index < 0) {
    const after = growthForCopies(1);
    const maxTroops = troopCapacity(after.level, after.redness);
    const slot: HeroSlot = { heroId, copies: 1, redness: after.redness, level: after.level, maxTroops, troops: maxTroops };
    return {
      pool: { ...pool, heroes: [...pool.heroes, slot] },
      feedback: {
        heroId,
        copies: 1,
        before: null,
        after,
        rednessDelta: 0,
        levelUp: false,
        capped: false,
      },
    };
  }

  const prev = pool.heroes[index]!;
  const copies = prev.copies + 1;
  const after = growthForCopies(Math.min(copies, 4));
  const capped = prev.copies >= 4;
  const growth = capped ? { redness: prev.redness, level: prev.level } : after;
  const maxTroops = troopCapacity(growth.level, growth.redness);
  const delta = maxTroops - prev.maxTroops;
  const slot: HeroSlot = {
    ...prev,
    copies,
    redness: growth.redness,
    level: growth.level,
    maxTroops,
    troops: Math.max(0, Math.min(maxTroops, prev.troops + Math.max(0, delta))),
  };
  const heroes = pool.heroes.slice();
  heroes[index] = slot;
  return {
    pool: { ...pool, heroes },
    feedback: {
      heroId,
      copies,
      before: { redness: prev.redness, level: prev.level },
      after: { redness: slot.redness, level: slot.level },
      rednessDelta: slot.redness - prev.redness,
      levelUp: slot.level > prev.level,
      capped,
    },
  };
}

/**
 * 战法入背包。已有则返回原引用。
 * @param pool 当前卡池
 * @param skillId 战法 id
 */
export function addSkill(pool: PoolState, skillId: string): PoolState {
  if (pool.skills.includes(skillId)) return pool;
  return { ...pool, skills: [...pool.skills, skillId] };
}

/**
 * 宝物入背包。已有则返回原引用。
 * @param pool 当前卡池
 * @param treasureId 宝物 id（字符串）
 */
export function addTreasure(pool: PoolState, treasureId: string): PoolState {
  if (pool.treasures.includes(treasureId)) return pool;
  return { ...pool, treasures: [...pool.treasures, treasureId] };
}

/**
 * 战后回写兵力。伤兵并回当前兵力，死兵不在这两项里，所以不会回来。
 * 没上场的武将不动；战报里不认识的 id 忽略。
 * @param pool 当前卡池
 * @param remaining 出战武将的存活兵力与伤兵
 */
export function applyBattleResult(
  pool: PoolState,
  remaining: ReadonlyArray<{ heroId: string; troops: number; wounded?: number }>,
): PoolState {
  const byId = new Map(remaining.map((row) => [row.heroId, row]));
  return {
    ...pool,
    heroes: pool.heroes.map((hero) => {
      const row = byId.get(hero.heroId);
      if (!row) return hero;
      const total = row.troops + (row.wounded ?? 0);
      const troops = Math.max(0, Math.min(hero.maxTroops, Math.round(total)));
      return { ...hero, troops };
    }),
  };
}

/**
 * 卡面用的「还差几次满红」。
 * @param copies 获得次数
 */
export function remainingToMax(copies: number): number {
  return copiesUntilMax(copies);
}
