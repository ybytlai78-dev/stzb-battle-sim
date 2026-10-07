import { describe, expect, it } from 'vitest';
import { buildGeneral, defaultFreePoints } from '../../web/heroes';
import type { Position } from '../../src/engine/types';
import { buildMyTeam, settleLevel } from '../../src/rogue/loop';
import { createPool } from '../../src/rogue/pool';
import { createRun } from '../../src/rogue/run';

const deps = {
  buildGeneral: (id: string, skills: string[], position: Position, redness: number, level: number) =>
    buildGeneral(id, skills, defaultFreePoints(id, redness, level), position, redness, level),
};

describe('关卡结算', () => {
  const pool = () => createPool({ heroes: ['h479', 'h29'], skills: ['jifeng_ershi'] });

  it('红度传给构建函数，没拥有的战法会拒绝', () => {
    let seen = { redness: -1, level: -1 };
    const mine = createPool({ heroes: ['h479'], skills: ['jifeng_ershi'] });
    const team = buildMyTeam(mine, { slots: [{ heroId: 'h479', skillIds: ['jifeng_ershi'], position: '前锋' }] }, {
      buildGeneral: (id, skills, position, redness, level) => {
        seen = { redness, level };
        return deps.buildGeneral(id, skills, position, redness, level);
      },
    });
    expect(seen).toEqual({ redness: 0, level: 40 });
    expect(team[0]!.redness).toBe(0);
    expect(() => buildMyTeam(mine, { slots: [{ heroId: 'h479', skillIds: ['not_owned'], position: '前锋' }] }, deps)).toThrow();
  });

  it('结算后兵力落在上限内，原局对象不变', () => {
    const run = createRun(3, 12, 3);
    const mine = pool();
    const my = [deps.buildGeneral('h479', ['jifeng_ershi'], '前锋', 0, 40)];
    const enemy = [deps.buildGeneral('h3', [], '前锋', 0, 40)];
    const result = settleLevel(run, mine, my, enemy, 1);
    expect(['win', 'lose', 'draw']).toContain(result.outcome);
    expect(run.level).toBe(1);
    expect(result.pool.heroes[0]!.troops).toBeGreaterThanOrEqual(0);
    expect(result.pool.heroes[0]!.troops).toBeLessThanOrEqual(result.pool.heroes[0]!.maxTroops);
    expect(result.pool.heroes[1]!.troops).toBe(9000);
    expect(result.report.rounds).toBeGreaterThan(0);
  });
});
