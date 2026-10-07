import { describe, expect, it } from 'vitest';
import { addHero, addSkill, applyBattleResult, createPool } from '../../src/rogue/pool';

describe('卡池账本', () => {
  it('新武将满兵，战法去重', () => {
    const pool = createPool({ heroes: ['h479'], skills: ['tiebi', 'tiebi'] });
    expect(pool.heroes[0]).toMatchObject({ heroId: 'h479', redness: 0, level: 40, maxTroops: 9000, troops: 9000 });
    expect(pool.skills).toEqual(['tiebi']);
  });

  it('战报剩余兵力回写，伤兵并回，没上场的不动', () => {
    const pool = createPool({ heroes: ['h479', 'h29'] });
    const next = applyBattleResult(pool, [{ heroId: 'h479', troops: 3000, wounded: 200 }]);
    expect(next.heroes[0]!.troops).toBe(3200);
    expect(next.heroes[1]!.troops).toBe(9000);
  });

  it('兵力被夹在 [0, maxTroops]，陌生 id 忽略', () => {
    const pool = createPool({ heroes: ['h479'] });
    const next = applyBattleResult(pool, [
      { heroId: 'h479', troops: -5 },
      { heroId: 'nobody', troops: 1 },
    ]);
    expect(next.heroes).toHaveLength(1);
    expect(next.heroes[0]!.troops).toBe(0);
  });

  it('受伤后再升红，上限增量加到当前兵力上', () => {
    let pool = createPool({ heroes: ['h479'] });
    pool = applyBattleResult(pool, [{ heroId: 'h479', troops: 1000 }]);
    pool = addHero(pool, 'h479').pool;
    pool = addHero(pool, 'h479').pool;
    const fourth = addHero(pool, 'h479');
    expect(fourth.pool.heroes[0]!.maxTroops).toBe(11000);
    expect(fourth.pool.heroes[0]!.troops).toBe(3000);
  });

  it('不可变：不改原池', () => {
    const pool = createPool({ heroes: ['h479'], skills: ['tiebi'] });
    applyBattleResult(pool, [{ heroId: 'h479', troops: 1 }]);
    addSkill(pool, 'jifeng_ershi');
    expect(pool.heroes[0]!.troops).toBe(9000);
    expect(pool.skills).toEqual(['tiebi']);
  });
});
