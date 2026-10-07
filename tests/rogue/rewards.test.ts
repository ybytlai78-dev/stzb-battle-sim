import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { createWallet } from '../../src/rogue/economy';
import { createPool } from '../../src/rogue/pool';
import { applyClearReward, breakthroughReward, isEliteLevel, rollClearReward } from '../../src/rogue/rewards';

const catalogue = {
  skills: [
    { skillId: 'a1', grade: 'A' },
    { skillId: 's1', grade: 'S' },
    { skillId: 'b1', grade: 'B' },
  ],
  treasures: ['t1'],
};

describe('通关奖励', () => {
  it('固定 500 玉符，附赠是未拥有的 A/S 或宝物', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const reward = rollClearReward(new Rng(seed), catalogue, { skills: ['a1'], treasures: [] });
      expect(reward.jade).toBe(500);
      expect(reward.bonus).not.toBeNull();
      expect(reward.bonus!.id === 'a1').toBe(false);
      expect(reward.bonus!.id === 'b1').toBe(false);
    }
  });

  it('同一种子可复现，入账后背包和钱包都变', () => {
    const reward = rollClearReward(new Rng(4), catalogue, { skills: [], treasures: [] });
    expect(rollClearReward(new Rng(4), catalogue, { skills: [], treasures: [] })).toEqual(reward);
    const applied = applyClearReward(createWallet(150), createPool(), reward);
    expect(applied.wallet.jade).toBe(650);
    if (reward.bonus?.kind === 'skill') expect(applied.pool.skills).toContain(reward.bonus.id);
    if (reward.bonus?.kind === 'treasure') expect(applied.pool.treasures).toContain(reward.bonus.id);
  });

  it('幕末关只留空位，不发突破奖励', () => {
    expect(isEliteLevel(4)).toBe(true);
    expect(isEliteLevel(8)).toBe(true);
    expect(isEliteLevel(12)).toBe(true);
    expect(isEliteLevel(3)).toBe(false);
    expect(breakthroughReward(12)).toBeNull();
  });
});
