/**
 * 设施加成（四大营）回归测试。
 *
 * 覆盖用户 2026-11-08 口径：
 *  - 准备阶段顺序 battle_start → facility → formation；
 *  - 每名武将四维 +20 走 effectiveStat（但不进战报）；
 *  - 疾风营首回合全体 speed +10；
 *  - 军机营/尚武营/铁壁营各随机 1 名单体，同 seed 可复现、不同 seed 会换人；
 *  - facilities:false 时完全不产生设施事件。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { effectiveStat, type CombatContext } from '../src/engine/action';
import {
  applyFacilityBonuses,
  makeFacilityRng,
  FACILITY_STAT_BONUS,
  FACILITIES,
} from '../src/engine/facility';
import type { BattleConfig, BattleEvent, General, Side, UnitState } from '../src/engine/types';

function general(id: string, over: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position: '前锋',
    attack: 100,
    defense: 80,
    strategy: 70,
    speed: 50,
    attackRange: 5,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    morale: 100,
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    ...over,
  };
}

function unitState(g: General, side: Side = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

const facilityEvents = (events: BattleEvent[]) =>
  events.filter((e): e is Extract<BattleEvent, { type: 'facility_bonus' }> => e.type === 'facility_bonus');

const isBattleStart = (e: BattleEvent): e is Extract<BattleEvent, { type: 'battle_start' }> =>
  e.type === 'battle_start';
const isRoundStart = (e: BattleEvent): e is Extract<BattleEvent, { type: 'round_start' }> =>
  e.type === 'round_start';

describe('设施加成：单元口径（applyFacilityBonuses）', () => {
  it('四维 +20 并进 formationBonus；疾风营 +10 只覆盖首回合', () => {
    const team = [unitState(general('a')), unitState(general('b')), unitState(general('c'))];
    const ctx = { events: [] as BattleEvent[], currentRound: 0 } as unknown as CombatContext;

    applyFacilityBonuses(ctx, team, 'my', makeFacilityRng(123));

    for (const u of team) {
      expect(u.formationBonus).toEqual({
        attack: FACILITY_STAT_BONUS,
        defense: FACILITY_STAT_BONUS,
        strategy: FACILITY_STAT_BONUS,
        speed: FACILITY_STAT_BONUS,
      });
      // 三项四维 = 面板 +20；速度额外有疾风营首回合 +10
      expect(effectiveStat(u, 'attack')).toBe(u.general.attack + 20);
      expect(effectiveStat(u, 'defense')).toBe(u.general.defense + 20);
      expect(effectiveStat(u, 'strategy')).toBe(u.general.strategy + 20);
      expect(effectiveStat(u, 'speed')).toBe(u.general.speed + 30);
      expect(u.statuses.filter((s) => s.type === 'speed_buff' && s.amount === 10)).toHaveLength(1);
    }
  });

  it('三条单体效果各只落 1 人；状态来源带 facility: 前缀', () => {
    const team = [unitState(general('a')), unitState(general('b')), unitState(general('c'))];
    const ctx = { events: [] as BattleEvent[], currentRound: 0 } as unknown as CombatContext;

    applyFacilityBonuses(ctx, team, 'my', makeFacilityRng(123));

    const insight = team.filter((u) => u.statuses.some((s) => s.type === 'insight'));
    const evasion = team.filter((u) => u.statuses.some((s) => s.type === 'evasion' && s.stacks === 1));
    const ignore = team.filter((u) => u.facilityIgnoreTroopCounter);
    expect(insight).toHaveLength(1);
    expect(evasion).toHaveLength(1);
    expect(ignore).toHaveLength(1);

    const insightStatus = insight[0].statuses.find((s) => s.type === 'insight')!;
    const evasionStatus = evasion[0].statuses.find((s) => s.type === 'evasion')!;
    expect(insightStatus.sourceSkillId).toBe('facility:junji');
    expect(evasionStatus.sourceSkillId).toBe('facility:tiebi');
    expect(insightStatus.remaining).toBe(1);

    // 事件顺序 = 用户截图顺序：军机营 → 疾风营 → 尚武营 → 铁壁营
    const order = [...new Set(facilityEvents(ctx.events).map((e) => e.facilityName))];
    expect(order).toEqual(['军机营', '疾风营', '尚武营', '铁壁营']);
  });

  it('同 seed 选人一致；不同 seed 会换人（三条单体效果各自独立抽签）', () => {
    const build = () => [unitState(general('a')), unitState(general('b')), unitState(general('c'))];
    const picks = (seed: number) => {
      const team = build();
      const ctx = { events: [] as BattleEvent[], currentRound: 0 } as unknown as CombatContext;
      applyFacilityBonuses(ctx, team, 'my', makeFacilityRng(seed));
      return facilityEvents(ctx.events)
        .filter((e) => e.facilityId !== 'jifeng')
        .map((e) => `${e.facilityId}:${e.unitId}`);
    };

    expect(picks(123)).toEqual(picks(123));
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => picks(i + 1).join('|')));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('设施加成：整场战斗（准备阶段 + 事件顺序）', () => {
  const config = (over: Partial<BattleConfig> = {}): BattleConfig => ({
    myTeam: [general('a'), general('b'), general('c')],
    enemyTeam: [general('e1'), general('e2'), general('e3')],
    seed: 7,
    maxRounds: 1,
    ...over,
  });

  it('准备阶段顺序 battle_start → facility → formation → troop → skill', () => {
    const rep = runBattle(config());
    const phases = rep.events
      .filter((e) => e.type === 'battle_start' || e.type === 'prep_phase')
      .map((e) => (e.type === 'battle_start' ? 'battle_start' : e.phase));
    expect(phases.slice(0, 5)).toEqual(['battle_start', 'facility', 'formation', 'troop', 'skill']);
  });

  it('红蓝各自生效：每侧四条设施事件，单体效果每侧各只 1 人', () => {
    const rep = runBattle(config());
    for (const side of ['my', 'enemy'] as const) {
      const evs = facilityEvents(rep.events).filter((e) => e.side === side);
      const byFacility = new Map<string, string[]>();
      for (const e of evs) {
        byFacility.set(e.facilityId, [...(byFacility.get(e.facilityId) ?? []), e.unitId]);
      }
      expect([...byFacility.keys()]).toEqual(FACILITIES.map((f) => f.id));
      expect(new Set(byFacility.get('junji')).size).toBe(1);
      expect(new Set(byFacility.get('shangwu')).size).toBe(1);
      expect(new Set(byFacility.get('tiebi')).size).toBe(1);
      expect(new Set(byFacility.get('jifeng')).size).toBe(3);
    }
  });

  it('同 seed 可复现、不同 seed 会换人', () => {
    const assignment = (seed: number) =>
      facilityEvents(runBattle(config({ seed })).events)
        .filter((e) => e.facilityId !== 'jifeng')
        .map((e) => `${e.side}:${e.facilityId}:${e.unitId}`)
        .join('|');
    expect(assignment(7)).toBe(assignment(7));
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => assignment(i + 1)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('facilities:false 时没有 facility 阶段与 facility_bonus 事件', () => {
    const rep = runBattle(config({ facilities: false }));
    const phases = rep.events
      .filter((e) => e.type === 'battle_start' || e.type === 'prep_phase')
      .map((e) => (e.type === 'battle_start' ? 'battle_start' : e.phase));
    expect(phases).not.toContain('facility');
    expect(facilityEvents(rep.events)).toHaveLength(0);
    // 设施关闭 = 改动前口径：出手顺序只由基础属性 + 既有 tie-break 决定
    const start = rep.events.find(isBattleStart)!;
    expect([...start.turnOrder].sort()).toEqual(['a', 'b', 'c', 'e1', 'e2', 'e3']);
    const withFacility = runBattle(config());
    expect(withFacility.events.find(isBattleStart)?.turnOrder).toEqual(start.turnOrder);
  });

  it('首回合出手顺序与 battle_start 顺序一致（疾风营 +10 已并入速度）', () => {
    const rep = runBattle(config());
    const start = rep.events.find(isBattleStart);
    const round1 = rep.events.find(isRoundStart);
    expect(round1?.round).toBe(1);
    expect(start?.turnOrder).toBeDefined();
    expect(round1?.turnOrder).toEqual(start?.turnOrder);
    // 速度行 = 面板 + 既有阵营/兵种加成 + 20（设施） +10（疾风营）；
    // 集成里阵营加成可能非 0，只验「+10」与加后值大于面板 +20。
    const speedLine = facilityEvents(rep.events).find(
      (e) => e.side === 'my' && e.facilityId === 'jifeng' && e.unitId === 'a'
    );
    expect(speedLine?.detail).toMatch(/速度属性提高了10\(\d+\)/);
    const after = Number(speedLine?.detail.match(/\((\d+)\)$/)?.[1]);
    expect(after).toBeGreaterThanOrEqual(50 + 20 + 10);
  });
});
