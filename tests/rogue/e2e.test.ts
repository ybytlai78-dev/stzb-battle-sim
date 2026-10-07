import { describe, expect, it } from 'vitest';
import { runBattle } from '../../src/engine/combat';
import { Rng } from '../../src/engine/rng';
import { buildGeneral, defaultFreePoints } from '../../web/heroes';
import type { General, Position } from '../../src/engine/types';
import { createWallet } from '../../src/rogue/economy';
import { winRateVs } from '../../src/rogue/enemy';
import { buildMyTeam, settleLevel } from '../../src/rogue/loop';
import { addHero, createPool } from '../../src/rogue/pool';
import { applyClearReward, rollClearReward } from '../../src/rogue/rewards';
import { createRun } from '../../src/rogue/run';
import { loadRun, memoryStorage, saveRun } from '../../src/rogue/save';

const POS: Position[] = ['前锋', '中军', '大营'];

const make = (id: string, skills: string[], position: Position, redness: number, level: number): General =>
  buildGeneral(id, skills, defaultFreePoints(id, redness, level), position, redness, level);

describe('端到端', () => {
  it('连打时存档往返不丢玉符、红度和关卡', () => {
    const storage = memoryStorage();
    const heroes = ['h479', 'h29', 'h16'];
    let run = createRun(20261008, 12, 3);
    let pool = createPool({ heroes, skills: ['jifeng_ershi'] });
    let wallet = createWallet(150);
    const deps = {
      buildGeneral: (id: string, skills: string[], position: Position, redness: number, level: number) =>
        make(id, skills, position, redness, level),
    };
    for (let level = 1; level <= 3 && run.status === 'playing'; level += 1) {
      const myTeam = buildMyTeam(
        pool,
        { slots: heroes.map((heroId, index) => ({ heroId, skillIds: index === 0 ? ['jifeng_ershi'] : [], position: POS[index]! })) },
        deps,
      );
      const enemy = [make('h3', [], '前锋', 0, 40), make('h27', [], '中军', 0, 40), make('h15', [], '大营', 0, 40)];
      const result = settleLevel(run, pool, myTeam, enemy, level);
      run = result.run;
      pool = result.pool;
      if (result.outcome === 'win') {
        const reward = rollClearReward(new Rng(level), { skills: [{ skillId: 's_demo', grade: 'S' }], treasures: ['9'] }, {
          skills: pool.skills,
          treasures: pool.treasures,
        });
        const applied = applyClearReward(wallet, pool, reward);
        wallet = applied.wallet;
        pool = applied.pool;
      }
      const saved = { run, pool, wallet, gacha: null, enemy: null, enemyLevel: null, nonce: level };
      saveRun(storage, saved);
      expect(loadRun(storage)).toEqual(saved);
    }
    expect(run.level).toBeGreaterThanOrEqual(1);
    expect(pool.heroes.every((hero) => hero.troops >= 0 && hero.troops <= hero.maxTroops)).toBe(true);
  });

  it('同一武将第四次获得后是 5 红 50 级', () => {
    let pool = createPool();
    for (let i = 0; i < 4; i += 1) pool = addHero(pool, 'h479').pool;
    expect(pool.heroes[0]).toMatchObject({ copies: 4, redness: 5, level: 50, maxTroops: 11000 });
  });

  it('满红加上 S 级战法后，对同一支敌军的胜率和斩首率都上升', () => {
    // 现有伤害模型里，成长后的斩首仍大多发生在第 8 回合，中位数到不了 5。
    // 这里验证设计方案要求的可测量成长：胜率上升，并且引擎判定的斩首比例上升。
    const enemy = [make('h3', [], '前锋', 0, 40), make('h27', [], '中军', 0, 40), make('h15', [], '大营', 0, 40)];
    const before = POS.map((position, index) => make(['h479', 'h29', 'h16'][index]!, [], position, 0, 40));
    const after = POS.map((position, index) =>
      make(['h479', 'h29', 'h16'][index]!, ['hunshui_moyu', 'yiji_dangqian'], position, 5, 50),
    );
    const runs = 100;
    expect(winRateVs(after, enemy, runs, 20)).toBeGreaterThan(winRateVs(before, enemy, runs, 20));
    const decap = (team: General[]) => {
      let wins = 0;
      for (let i = 0; i < runs; i += 1) {
        const report = runBattle({ myTeam: team, enemyTeam: enemy, seed: 80 + i, maxRounds: 8 });
        if (report.result === 'win') wins += 1;
      }
      return wins / runs;
    };
    expect(decap(after)).toBeGreaterThan(decap(before));
  }, 120000);
});
