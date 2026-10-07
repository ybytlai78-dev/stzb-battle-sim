import { describe, expect, it } from 'vitest';
import { buildGeneral, defaultFreePoints } from '../../web/heroes';
import { enemyGrowth, pickEnemy, rollEnemySlots, winRateVs } from '../../src/rogue/enemy';
import type { Position } from '../../src/engine/types';

const at = (id: string, skills: string[] = [], position: Position = '前锋') =>
  buildGeneral(id, skills, defaultFreePoints(id, 0, 40), position, 0, 40);

describe('敌军', () => {
  it('同一组种子和关卡抽出的阵容稳定，末关更红', () => {
    const ids = ['h479', 'h29', 'h16', 'h3', 'h27'];
    expect(rollEnemySlots(7, 1, ids)).toEqual(rollEnemySlots(7, 1, ids));
    expect(enemyGrowth(1)).toEqual({ redness: 0, level: 40 });
    expect(enemyGrowth(12)).toEqual({ redness: 5, level: 50 });
    expect(rollEnemySlots(7, 12, ids).every((slot) => slot.redness === 5 && slot.level === 50)).toBe(true);
  });

  it('镜像对局的胜率不会贴边', () => {
    const team = [at('h479', ['jifeng_ershi'])];
    const rate = winRateVs(team, team, 20, 1);
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.9);
  });

  it('三将打单将的胜率高于反过来', () => {
    const three = [at('h479'), at('h29', [], '中军'), at('h16', [], '大营')];
    const one = [at('h3')];
    expect(winRateVs(three, one, 20, 1)).toBeGreaterThan(winRateVs(one, three, 20, 1));
  });

  it('pickEnemy 选得不比第一个候选更远离目标', () => {
    const player = [at('h479', ['jifeng_ershi'])];
    const candidates = [[at('h3')], [at('h29')], [at('h479', ['jifeng_ershi'])]];
    const picked = pickEnemy(player, candidates, 0.5, { runs: 8, baseSeed: 3 });
    const first = winRateVs(player, candidates[0]!, 8, 3);
    expect(picked.team).toHaveLength(1);
    expect(Math.abs(picked.winRate - 0.5)).toBeLessThanOrEqual(Math.abs(first - 0.5) + 1e-9);
  });

  it('候选为空时抛错', () => {
    expect(() => pickEnemy([at('h479')], [], 0.5)).toThrow();
  });
});
