/**
 * 批量11 主战法测试（v0.12）：皇裔流离（刘备）
 * 新增引擎机制：持续型急救（受击触发恢复，同类指挥冲突先施加者生效，每 3 次生效触发率 +5%）
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值与统计。
 * 战报统计口径：回复触发次数 / 回复兵力（而非战法释放次数/战法杀伤）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { computeDetailedStats } from '../src/engine/stats';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

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

/** 刘备（大营）+ 前锋/中军友军 3 人队 */
function liubeiTeam(strategyFree = 40): General[] {
  const liubei = level40(hero('h16'), { strategy: strategyFree });
  return [liubei, dummy('ally-front', '前锋'), dummy('ally-mid', '中军')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const firstAidInflicted = (report: ReturnType<typeof run>) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === 'first_aid' && !e.detail.includes('提升至') // 排除触发率提升事件
  );

const healEvents = (report: ReturnType<typeof run>) =>
  report.events.filter((e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === 'huangyi_liuli');

describe('皇裔流离（刘备·一类指挥：持续型急救受击触发恢复）', () => {
  it('装配挂槽：40 级刘备主战法自动挂入指挥槽', () => {
    const liubei = level40(hero('h16'), {});
    expect(liubei.commandSkillIds).toContain('huangyi_liuli');
    expect(liubei.mainSkillName).toBe('皇裔流离');
  });

  it('机制：准备阶段释放一次，对我军全体（三目标）施加持续型急救；受击时触发恢复（heal 事件归属刘备）', () => {
    const team = liubeiTeam();
    const report = run(team, 7, 8);

    // 一类指挥准备阶段释放一次（施法者 = 刘备 h16）
    const casts = report.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'huangyi_liuli');
    expect(casts.length).toBe(1);

    // 我军全体 3 目标（刘备 + 前锋 + 中军）都挂上持续型急救
    const inflicted = firstAidInflicted(report);
    expect(inflicted.length).toBe(3);
    const targets = new Set(inflicted.map((e) => e.unitId));
    expect(targets.has('h16')).toBe(true);
    expect(targets.has('ally-front')).toBe(true);
    expect(targets.has('ally-mid')).toBe(true);
    // 不作用于敌军
    expect([...targets].some((id) => id.startsWith('enemy-'))).toBe(false);

    // 我军受击后触发急救恢复（刘备 40 级谋略较高 → 恢复率 > 68%）
    expect(healEvents(report).length).toBeGreaterThan(0);
    for (const h of healEvents(report)) {
      expect(h.sourceId).toBe('h16'); // 回复归属施法者（刘备）
      expect(h.amount).toBeGreaterThan(0);
    }
  });

  it('数值与统计：战报统计为回复触发次数 / 回复兵力（归属刘备），非战法杀伤', () => {
    const team = liubeiTeam(40);
    const report = run(team, 7, 8);

    // 刘备（h16）回复统计：触发次数 = heal 事件数，回复兵力 = amount 求和
    const liubeiStats = report.stats.find((s) => s.unitId === 'h16')!;
    const heals = healEvents(report);
    expect(liubeiStats.healCount).toBe(heals.length);
    expect(liubeiStats.healCount).toBeGreaterThan(0);
    expect(liubeiStats.healAmount).toBe(heals.reduce((a, h) => a + h.amount, 0));
    expect(liubeiStats.healAmount).toBeGreaterThan(0);
    // 急救触发不产生战法伤害（皇裔流离非杀伤战法）
    expect(liubeiStats.skillDamage).toBe(0);

    // 按战法拆分统计：皇裔流离 = 释放 1 次 + 回复触发次数/回复兵力
    const units = report.myTeam.concat(report.enemyTeam).map(toState(report));
    const detailed = computeDetailedStats(report.events, units);
    const huangyi = detailed.find((s) => s.unitId === 'h16')?.skills.find((sk) => sk.skillId === 'huangyi_liuli');
    expect(huangyi).toBeTruthy();
    expect(huangyi!.castCount).toBe(1);
    expect(huangyi!.damage).toBe(0);
    expect(huangyi!.healCount).toBe(heals.length);
    expect(huangyi!.healAmount).toBe(liubeiStats.healAmount);
  });
});

/** report 内武将 → UnitState 辅助（computeDetailedStats 需要 units 提供名字/阵营） */
function toState(report: ReturnType<typeof run>) {
  return (g: General): UnitState => {
    const isEnemy = report.enemyTeam.some((e) => e.id === g.id);
    return {
      general: g,
      side: isEnemy ? 'enemy' : 'my',
      troops: 9000,
      alive: true,
      wounded: 0,
      totalDead: 0,
      statuses: [],
      preparations: [],
    };
  };
}
