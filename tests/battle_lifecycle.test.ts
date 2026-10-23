import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBattle } from '../src/engine/combat';
import * as action from '../src/engine/action';
import type { BattleConfig, General } from '../src/engine/types';

// Synthetic units test lifecycle contracts, not any hero's panel or skill balance.
function unit(id: string, extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '5星', cost: 3, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position: '大营',
    attack: 150, defense: 100, strategy: 80, speed: 60, attackRange: 5,
    maxTroops: 9000, mainSkillName: '', skillDesc: '', morale: 100,
    activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [],
    ...extra,
  };
}

describe('battle lifecycle contracts', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['tickRoundStartStatuses', 'triggerImperialDecrees'],
    ['triggerDelayedOutputs', 'triggerPendingRoundOutputs'],
  ] as const)('stops later phases after a lethal %s', (lethalPhase, laterPhase) => {
    vi.spyOn(action, lethalPhase).mockImplementation((ctx, _round?: number) => {
      action.applyDamage(ctx, ctx.enemyTeam[0], 9000);
    });
    const later = vi.spyOn(action, laterPhase);
    const endCommands = vi.spyOn(action, 'triggerRoundEndCommands');
    const report = runBattle({
      myTeam: [unit('a')], enemyTeam: [unit('b')], seed: 42, maxRounds: 8,
    });
    expect(report.result).toBe('win');
    expect(report.rounds).toBe(1);
    expect(later).not.toHaveBeenCalled();
    expect(endCommands).not.toHaveBeenCalled();
    expect(report.events.filter(e => e.type === 'attack_hit')).toEqual([]);
  });

  it('does not mutate loadouts or accumulate cost changes across repeated simulations', () => {
    const config: BattleConfig = {
      myTeam: [unit('cost', { chenshou: { featureId: 'cs_106002', value: 0.5 } })],
      enemyTeam: [unit('faction', { chenshou: { featureId: 'cs_106003', value: 0, faction: '魏' } })],
      seed: 42, maxRounds: 2,
    };
    const before = structuredClone(config);
    const first = runBattle(config);
    const second = runBattle(config);
    expect(config).toEqual(before);
    expect(second).toEqual(first);
    expect(first.myTeam[0].cost).toBe(3);
    expect(first.enemyTeam[0].faction).toBe('汉');
  });

  it.each([true, false])('ends in the kill round even when killer acts last=%s', (last) => {
    const report = runBattle({
      myTeam: [unit('killer', { speed: last ? 10 : 100 })],
      enemyTeam: [unit('victim', { maxTroops: 1, speed: 50 })],
      inertSides: ['enemy'], seed: 42, maxRounds: 8,
    });
    expect(report.result).toBe('win');
    expect(report.rounds).toBe(1);
    expect(report.maxRounds).toBe(8);
    expect(report.events.filter(e => e.type === 'round_start')).toHaveLength(1);
    const end = report.events.find(e => e.type === 'battle_end');
    expect(end).toMatchObject({ rounds: 1, result: 'win' });
  });

  it('still reports every round when the battle reaches the configured limit', () => {
    const report = runBattle({
      myTeam: [unit('a')], enemyTeam: [unit('b')],
      inertSides: ['my', 'enemy'], seed: 42, maxRounds: 3,
    });
    expect(report.result).toBe('draw');
    expect(report.rounds).toBe(3);
    expect(report.events.filter(e => e.type === 'round_end')).toHaveLength(3);
  });
});
