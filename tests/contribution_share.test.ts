/**
 * 战报「详情」贡献占比（demo）：本队伤害 / 恢复 / 控制折成百分比。
 * 控制归属最近一次 skill_cast / 成功 skill_trigger 的施法者（细项后续再拆）。
 */
import { describe, it, expect } from 'vitest';
import { computeContributionShares } from '../src/engine/stats';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';

const BKD = { troopBase: 0, base: 0, main: 0 };

function dummy(id: string, name: string, position: Position): General {
  return {
    id,
    name,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 50,
    strategy: 50,
    speed: 20,
    attackRange: 1,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return {
    general: g,
    side,
    troops: 0,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

describe('贡献占比 computeContributionShares', () => {
  it('本队伤害折成百分比：70 + 30 → 70% / 30%', () => {
    const a = dummy('a', '甲', '前锋');
    const b = dummy('b', '乙', '中军');
    const e = dummy('e', '敌', '前锋');
    const events: BattleEvent[] = [
      { type: 'attack_hit', sourceId: 'a', targetId: 'e', distance: 1, damage: 70, breakdown: BKD },
      {
        type: 'damage',
        sourceId: 'b',
        targetId: 'e',
        skillId: 'x',
        skillName: 'x',
        damageType: 'physical',
        damage: 30,
        breakdown: BKD,
      },
    ];
    const shares = computeContributionShares(events, [unit(a, 'my'), unit(b, 'my'), unit(e, 'enemy')]);
    const sa = shares.find((s) => s.unitId === 'a')!;
    const sb = shares.find((s) => s.unitId === 'b')!;
    expect(sa.damagePct).toBe(70);
    expect(sb.damagePct).toBe(30);
    expect(sa.damagePct + sb.damagePct).toBe(100);
  });

  it('恢复占比按 heal 归属施法者；队内无恢复则全员 0%', () => {
    const a = dummy('a', '甲', '前锋');
    const b = dummy('b', '乙', '中军');
    const events: BattleEvent[] = [
      {
        type: 'heal',
        sourceId: 'b',
        targetId: 'a',
        skillId: 'h',
        skillName: '急救',
        amount: 100,
        before: 0,
        after: 100,
      },
    ];
    const shares = computeContributionShares(events, [unit(a, 'my'), unit(b, 'my')]);
    expect(shares.find((s) => s.unitId === 'b')!.healPct).toBe(100);
    expect(shares.find((s) => s.unitId === 'a')!.healPct).toBe(0);
  });

  it('控制次数归属最近 skill_cast 施法者', () => {
    const a = dummy('a', '甲', '前锋');
    const e = dummy('e', '敌', '前锋');
    const events: BattleEvent[] = [
      { type: 'skill_cast', unitId: 'a', skillId: 'ctrl', skillName: '混乱' },
      { type: 'status_inflicted', unitId: 'e', statusType: 'confusion', detail: '混乱' },
      { type: 'status_inflicted', unitId: 'e', statusType: 'cowardice', detail: '怯战' },
    ];
    const shares = computeContributionShares(events, [unit(a, 'my'), unit(e, 'enemy')]);
    expect(shares.find((s) => s.unitId === 'a')!.control).toBe(2);
    expect(shares.find((s) => s.unitId === 'a')!.controlPct).toBe(100);
    expect(shares.find((s) => s.unitId === 'e')!.control).toBe(0);
  });
});
