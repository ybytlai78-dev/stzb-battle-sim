import { describe, expect, it } from 'vitest';
import { freePointBudget, troopCapacity as heroTroops } from '../../web/heroes';
import { formatRecruit, growthForCopies, troopCapacity } from '../../src/rogue/recruit';
import { addHero, createPool } from '../../src/rogue/pool';

describe('红度阶梯', () => {
  it('第 1/2/3/4 次对应 0 红、2 红、4 红、满红 50 级', () => {
    expect(growthForCopies(1)).toEqual({ redness: 0, level: 40 });
    expect(growthForCopies(2)).toEqual({ redness: 2, level: 40 });
    expect(growthForCopies(3)).toEqual({ redness: 4, level: 40 });
    expect(growthForCopies(4)).toEqual({ redness: 5, level: 50 });
    expect(growthForCopies(9)).toEqual({ redness: 5, level: 50 });
  });

  it('兵力公式与现成 troopCapacity 一致', () => {
    expect(troopCapacity(40, 0)).toBe(heroTroops(40, 0));
    expect(troopCapacity(50, 5)).toBe(heroTroops(50, 5));
    expect(troopCapacity(40, 0)).toBe(9000);
    expect(troopCapacity(50, 5)).toBe(11000);
  });

  it('同一武将连得四次：红度递进，第 4 次兵力上限 +2000，第 5 次不再变', () => {
    let pool = createPool();
    const steps = [];
    for (let i = 0; i < 5; i += 1) {
      const next = addHero(pool, 'h479');
      steps.push(next.feedback);
      pool = next.pool;
    }
    expect(pool.heroes).toHaveLength(1);
    expect(pool.heroes[0]).toMatchObject({ copies: 5, redness: 5, level: 50, maxTroops: 11000, troops: 11000 });
    expect(steps[1]).toMatchObject({ rednessDelta: 2, levelUp: false, capped: false });
    expect(steps[3]).toMatchObject({ rednessDelta: 1, levelUp: true, capped: false });
    expect(steps[4]!.capped).toBe(true);
    expect(steps[4]!.after).toEqual({ redness: 5, level: 50 });
  });

  it('男将 2 红到 4 红的反馈是属性点 +20', () => {
    let pool = createPool();
    pool = addHero(pool, 'h479').pool;
    const second = addHero(pool, 'h479');
    pool = second.pool;
    const third = addHero(pool, 'h479');
    const text = formatRecruit('吕布', third.feedback, (redness, level) => freePointBudget('h479', redness, level));
    expect(text).toBe('吕布 2 红 → 4 红：属性点 +20');
  });

  it('第 4 次相对首次，男将自由属性点 +60', () => {
    const first = growthForCopies(1);
    const fourth = growthForCopies(4);
    const delta = freePointBudget('h479', fourth.redness, fourth.level) - freePointBudget('h479', first.redness, first.level);
    expect(delta).toBe(60);
  });
});
