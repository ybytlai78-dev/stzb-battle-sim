/**
 * 准备战法统计口径（用户口径 2026-09-18）：
 *  - **只有释放成功（skill_cast）才计 1 次发动**；
 *  - 发动率判定（skill_trigger success）与「准备完成」（prepare_end）都不计入次数；
 *  - 因此 8 回合内、1 回合准备战法最多 floor(8/(1+1)) = 4 次发动（落首箭实测常见 2–3 次）。
 *
 * 背景：用户看战报统计页时，把普攻那格的「次数 8」误读成了落首箭的次数（两格相邻、次数右对齐），
 * 以为准备战法被算了 8 次。本文件把「次数 = 释放次数」写成回归断言。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { computeDetailedStats, computeStats } from '../src/engine/stats';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, troops = 30000): General {
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
    attack: 40,
    defense: 40,
    strategy: 40,
    speed: 20,
    attackRange: 1,
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
  return [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')];
}

/** 沙摩柯（h524）：主战法落首箭 = 1 回合准备主动 */
function shaTeam(): General[] {
  const sha = withSkills(level40(hero('h524')), {});
  sha.position = '前锋';
  return [sha, dummy('a1', '中军'), dummy('a2', '大营')];
}

function unitsOf(report: ReturnType<typeof runBattle>): UnitState[] {
  const stub = (g: General, side: 'my' | 'enemy'): UnitState => ({
    general: g,
    side,
    troops: 0,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  });
  return [
    ...report.myTeam.map((g) => stub(g, 'my')),
    ...report.enemyTeam.map((g) => stub(g, 'enemy')),
  ];
}

type Ev<K extends BattleEvent['type']> = Extract<BattleEvent, { type: K }>;

describe('准备战法统计：只有释放成功计 1 次', () => {
  it('落首箭（1 回合准备）：次数 = skill_cast 数 = 成功 prepare_end 数，且 8 回合 ≤ 4', () => {
    // 多组种子覆盖 0~4 次释放的分布，任何一组都不得把判定/准备算进次数
    for (const seed of [1, 2, 3, 5, 7, 11, 13, 17, 19, 24, 31, 42, 99, 123, 777]) {
      const report = runBattle({ seed, maxRounds: 8, myTeam: shaTeam(), enemyTeam: enemyTeam() });
      const casts = report.events.filter(
        (e): e is Ev<'skill_cast'> => e.type === 'skill_cast' && e.skillId === 'luoshou_jian'
      ).length;
      const prepareEnds = report.events.filter(
        (e): e is Ev<'prepare_end'> =>
          e.type === 'prepare_end' && e.skillId === 'luoshou_jian' && e.success === true
      ).length;
      const triggerOk = report.events.filter(
        (e): e is Ev<'skill_trigger'> =>
          e.type === 'skill_trigger' && e.skillId === 'luoshou_jian' && e.success === true
      ).length;

      // 1 回合准备：每次释放前必有一次「准备完成」
      expect(casts).toBe(prepareEnds);
      // 8 回合上限：第 1/3/5/7 回合判定成功 → 第 2/4/6/8 回合释放
      expect(casts).toBeLessThanOrEqual(4);
      // 判定成功次数 ≥ 释放次数（准备被中断时判定更多），但判定绝不额外计入次数
      expect(triggerOk).toBeGreaterThanOrEqual(casts);

      // 统计出口与事件流一致：detail.castCount 只数 skill_cast
      const detailed = computeDetailedStats(report.events, unitsOf(report));
      const sha = detailed.find((d) => d.unitId === 'h524')!;
      const luoshou = sha.skills.find((s) => s.skillId === 'luoshou_jian');
      expect(luoshou?.castCount ?? 0).toBe(casts);

      // 武将级 skillCount = 该武将所有 skill_cast（这里只有落首箭）
      const summary = computeStats(report.events, unitsOf(report)).find((s) => s.unitId === 'h524')!;
      expect(summary.skillCount).toBe(casts);
    }
  });

  it('判定成功与准备完成事件存在，但不计入次数（单场逐事件核对）', () => {
    const report = runBattle({ seed: 24, maxRounds: 8, myTeam: shaTeam(), enemyTeam: enemyTeam() });
    const kinds = report.events.map((e) => e.type);
    expect(kinds).toContain('skill_trigger');
    expect(kinds).toContain('prepare_start');
    expect(kinds).toContain('prepare_end');

    const casts = report.events.filter(
      (e): e is Ev<'skill_cast'> => e.type === 'skill_cast' && e.skillId === 'luoshou_jian'
    ).length;
    const judgments = report.events.filter(
      (e): e is Ev<'skill_trigger'> => e.type === 'skill_trigger' && e.skillId === 'luoshou_jian'
    ).length;
    // 事件里有判定与准备，但次数只等于释放数（不是 判定+释放）
    expect(casts).toBeGreaterThan(0);
    expect(casts).toBeLessThanOrEqual(4);
    expect(judgments).toBeGreaterThanOrEqual(casts);
  });

  it('一类指挥（魏武之世）仍只计准备阶段释放的 1 次，不随回合增长', () => {
    const caocao = withSkills(level40(hero('h23'), { strategy: 90 }), { commandSkillIds: ['weiwu_zhishi'] });
    caocao.position = '前锋';
    const report = runBattle({ seed: 42, maxRounds: 8, myTeam: [caocao], enemyTeam: enemyTeam() });
    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const weiwu = detailed.find((d) => d.unitId === 'h23')?.skills.find((s) => s.skillId === 'weiwu_zhishi');
    expect(weiwu?.castCount).toBe(1);
  });
});
