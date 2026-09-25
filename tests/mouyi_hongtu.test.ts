/**
 * 谋议宏图（司马炎·一类指挥）
 * 官方口径「战斗开始后首回合」：准备阶段只释放+锁目标，不结算；
 *  - 减伤在第 1 回合开始结算并按 8/8 挂上；**第 1 回合 8/8**，第 2 回合起每回合回合前衰减 1/8（第 8 回合 1/8、第 9 回合移除）
 *    （用户口径 2026-09-18：第一回合开始才计数 8/8，而不是准备阶段开始计数）
 *  - 士气 `roundStartRepeat` 每回合开始 +8（同战法累加）：第 1 回合 +8 → 第 2 回合 +16 → 第 3 回合 +24
 *  - 不同指挥战法的士气提高冲突，数值取较高
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { inflictStatus, getStatus, effectiveMorale, tickRoundStartStatuses } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, troops = 10000): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function simayanTeam(strategyFree = 40): General[] {
  const yan = withSkills(level40(hero('h703'), { strategy: strategyFree }), {
    commandSkillIds: ['mouyi_hongtu'],
  });
  return [yan, dummy('ally-front', '前锋'), dummy('ally-mid', '中军')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

function makeUnit(id: string): UnitState {
  return {
    general: dummy(id, '前锋'),
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(units: UnitState[] = []): CombatContext {
  return {
    rng: new Rng(1),
    myTeam: units,
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

describe('谋议宏图（司马炎，一类指挥：全军减伤 8/8 衰减 + 士气叠层）', () => {
  it('装配挂槽：司马炎主战法挂入指挥槽，一类指挥对我军全体', () => {
    const g = hero('h703');
    expect(g.name).toBe('司马炎');
    expect(g.commandSkillIds).toContain('mouyi_hongtu');
    const s = SKILL_REGISTRY['mouyi_hongtu'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect(s.type === 'command' && s.targetSide === 'ally' && s.targetMode === 'all').toBe(true);
    expect(s.tags).toEqual(expect.arrayContaining(['damage_reduce', 'morale_boost']));
  });

  it('机制：准备阶段只释放不结算；第 1 回合开始挂减伤 8/8、士气 +8；第 2 回合减伤 7/8、士气 +16', () => {
    const report = run(simayanTeam(), 1, 2);
    expect(report.events.filter((e) => e.type === 'skill_cast' && e.skillName === '谋议宏图')).toHaveLength(1);

    const prepEnd = report.events.findIndex((e) => e.type === 'preparation_end');
    const r1 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 1);
    const r2 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 2);
    // 准备阶段：只释放（skill_cast/skill_target），不挂任何状态
    const prepStatuses = report.events.filter(
      (e, i) => i < prepEnd && e.type === 'status_inflicted'
    );
    expect(prepStatuses).toHaveLength(0);
    expect(report.events.some((e, i) => i < prepEnd && e.type === 'skill_cast')).toBe(true);

    // 第 1 回合开始才结算：减伤 8/8、士气 +8（不再叠加准备阶段那一次）
    const r1Reduces = report.events.filter(
      (e, i): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        i > r1 && i < r2 && e.type === 'status_inflicted' && e.statusType === 'damage_reduce'
    );
    const r1Morale = report.events.filter(
      (e, i): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        i > r1 && i < r2 && e.type === 'status_inflicted' && e.statusType === 'morale_boost'
    );
    expect(r1Reduces).toHaveLength(3);
    expect(r1Morale).toHaveLength(3);
    expect(r1Reduces.every((e) => e.detail.includes('剩余 8/8'))).toBe(true);
    expect(r1Morale.every((e) => e.detail.includes('士气提高 8'))).toBe(true);

    const r2Reduces = report.events.filter(
      (e, i): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        i > r2 && e.type === 'status_inflicted' && e.statusType === 'damage_reduce' && e.detail.includes('剩余 7/8')
    );
    const r2Morale = report.events.filter(
      (e, i): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        i > r2 && e.type === 'status_inflicted' && e.statusType === 'morale_boost' && e.detail.includes('16')
    );
    expect(r2Reduces).toHaveLength(3);
    expect(r2Morale).toHaveLength(3);
  });

  it('数值：第 3 回合减伤剩余 6/8、士气 +24；同战法士气可叠、不同指挥取较高；减伤受谋略缩放', () => {
    const report = run(simayanTeam(), 1, 3);
    const r3 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 3);
    const r3Reduces = report.events.filter(
      (e, i): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        i > r3 && e.type === 'status_inflicted' && e.statusType === 'damage_reduce' && e.detail.includes('剩余 6/8')
    );
    const r3Morale = report.events.filter(
      (e, i): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        i > r3 && e.type === 'status_inflicted' && e.statusType === 'morale_boost' && e.detail.includes('24')
    );
    expect(r3Reduces).toHaveLength(3);
    expect(r3Morale).toHaveLength(3);

    const r1Reduce = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce' && e.detail.includes('剩余 8/8')
    )!;
    const baseRate = parseFloat(r1Reduce.detail.match(/减伤 ([\d.]+)/)![1]);
    expect(baseRate).toBeGreaterThan(0.3);

    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, { type: 'morale_boost', amount: 8, duration: 999, stack: true }, 'command', 'mouyi_hongtu');
    inflictStatus(ctx, u, { type: 'morale_boost', amount: 8, duration: 999, stack: true }, 'command', 'mouyi_hongtu');
    expect(getStatus(u, 'morale_boost')!.amount).toBe(16);
    expect(effectiveMorale(u)).toBe(116);

    inflictStatus(ctx, u, { type: 'morale_boost', amount: 10, duration: 999 }, 'command', 'other_morale');
    expect(getStatus(u, 'morale_boost')!.amount).toBe(16);
    expect(getStatus(u, 'morale_boost')!.sourceSkillId).toBe('mouyi_hongtu');

    const u2 = makeUnit('b');
    inflictStatus(ctx, u2, { type: 'morale_boost', amount: 8, duration: 999, stack: true }, 'command', 'mouyi_hongtu');
    inflictStatus(ctx, u2, { type: 'morale_boost', amount: 20, duration: 999 }, 'command', 'other_morale');
    expect(getStatus(u2, 'morale_boost')!.amount).toBe(20);
    expect(getStatus(u2, 'morale_boost')!.sourceSkillId).toBe('other_morale');
  });
});

describe('谋议宏图首回合结算（单元）', () => {
  it('settleOnFirstRound：准备阶段不结算；第 1 回合开始挂减伤 8/8 + 士气 +8；第 2 回合 7/8 + 士气 +16', () => {
    const u = makeUnit('a');
    const ctx = makeCtx([u]);
    ctx.currentRound = 0;
    ctx.lockedCommands.push({
      skill: SKILL_REGISTRY['mouyi_hongtu'] as Extract<(typeof SKILL_REGISTRY)[string], { type: 'command' }>,
      casterId: 'a',
      targets: [u],
      currentRate: 1,
    });
    // 准备阶段（战斗开始）不结算任何效果
    expect(getStatus(u, 'damage_reduce')).toBeUndefined();
    expect(getStatus(u, 'morale_boost')).toBeUndefined();

    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const reduce = getStatus(u, 'damage_reduce')!;
    expect(reduce.eighths).toBe(8);
    expect(reduce.rate).toBeCloseTo(reduce.baseRate!, 8);
    expect(getStatus(u, 'morale_boost')!.amount).toBe(8);

    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    expect(reduce.eighths).toBe(7);
    expect(reduce.rate).toBeCloseTo(reduce.baseRate! * (7 / 8), 8);
    expect(getStatus(u, 'morale_boost')!.amount).toBe(16);
  });
});
