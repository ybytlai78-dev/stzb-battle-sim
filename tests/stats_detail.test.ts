/**
 * 按战法拆分的战斗统计测试（v0.10）：computeDetailedStats
 * 口径：释放次数 = skill_cast 计数（指挥战法准备阶段算 1 次，如魏武之世 释放1 杀伤0）；
 * 杀伤 = 该战法造成的 damage 事件伤害合计（不含普攻/DoT/分兵溅射）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { General, Position } from '../src/engine/types';
import { computeDetailedStats } from '../src/engine/stats';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position): General {
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
    attack: 50,
    defense: 50,
    strategy: 50,
    speed: 20,
    attackRange: 1,
    maxTroops: 30000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function statsOf(report: ReturnType<typeof runBattle>) {
  const units = [
    ...report.myTeam.map((g) => ({ general: g, side: 'my' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], isPreparing: false, preparingSkillId: null })),
    ...report.enemyTeam.map((g) => ({ general: g, side: 'enemy' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], isPreparing: false, preparingSkillId: null })),
  ];
  return computeDetailedStats(report.events, units);
}

describe('按战法拆分统计（computeDetailedStats）', () => {
  it('曹操·魏武之世：释放 1 次、杀伤 0（指挥战法不造成直接伤害）', () => {
    const caocao = withSkills(level40(hero('h23'), { strategy: 90 }), { commandSkillIds: ['weiwu_zhishi'] });
    caocao.position = '前锋';
    const enemy: General[] = ['e1', 'e2', 'e3'].map((id, i) =>
      dummy(id, (['前锋', '中军', '大营'] as Position[])[i])
    );
    const report = runBattle({ myTeam: [caocao], enemyTeam: enemy, seed: 42, maxRounds: 8 });
    const stats = statsOf(report);
    const caocaoStats = stats.find((s) => s.unitId === 'h23')!;
    const weiwu = caocaoStats.skills.find((s) => s.skillId === 'weiwu_zhishi');
    expect(weiwu).toBeTruthy();
    expect(weiwu!.castCount).toBe(1); // 准备阶段释放一次
    expect(weiwu!.damage).toBe(0);
  });

  it('太史慈·方阵突击（追击）：释放次数 = skill_cast 数，杀伤 = damage 事件和', () => {
    const taishi = withSkills(level40(hero('taishici'), { attack: 40 }), { pursuitSkillIds: ['fangzhen_tuji'] });
    taishi.position = '前锋';
    const enemy: General[] = ['e1', 'e2', 'e3'].map((id, i) =>
      dummy(id, (['前锋', '中军', '大营'] as Position[])[i])
    );
    const report = runBattle({ myTeam: [taishi], enemyTeam: enemy, seed: 42, maxRounds: 8 });
    const stats = statsOf(report);
    const taishiStats = stats.find((s) => s.unitId === 'taishici')!;
    const fangzhen = taishiStats.skills.find((s) => s.skillId === 'fangzhen_tuji');

    // 与事件流直接核对：skill_cast 计数 与 damage 求和
    const castCount = report.events.filter(
      (e) => e.type === 'skill_cast' && e.skillId === 'fangzhen_tuji' && e.unitId === 'taishici'
    ).length;
    const damage = report.events
      .filter((e): e is Extract<typeof e, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === 'fangzhen_tuji' && e.sourceId === 'taishici'
      )
      .reduce((a, e) => a + e.damage, 0);

    expect(fangzhen).toBeTruthy();
    expect(fangzhen!.castCount).toBe(castCount);
    expect(fangzhen!.damage).toBe(damage);
    // 普攻统计独立（attack_hit 不进战法杀伤）
    expect(taishiStats.attackCount).toBeGreaterThanOrEqual(0);
  });

  it('黄盖·烈火焚舟（纯 DoT 追击）：燃烧伤害计入战法杀伤', () => {
    const huanggai = withSkills(level40(hero('h783'), { attack: 40 }), { pursuitSkillIds: ['liehuo_fenzhou'] });
    huanggai.position = '前锋';
    const enemy: General[] = ['e1', 'e2', 'e3'].map((id, i) =>
      dummy(id, (['前锋', '中军', '大营'] as Position[])[i])
    );
    const report = runBattle({ myTeam: [huanggai], enemyTeam: enemy, seed: 42, maxRounds: 8 });
    const stats = statsOf(report);
    const huanggaiStats = stats.find((s) => s.unitId === 'h783')!;
    const liehuo = huanggaiStats.skills.find((s) => s.skillId === 'liehuo_fenzhou');

    // 事件流核对：dot_tick（来源战法 = 烈火焚舟，施法者 = 黄盖）伤害和
    const dotDamage = report.events
      .filter(
        (e): e is Extract<typeof e, { type: 'dot_tick' }> =>
          e.type === 'dot_tick' && e.skillId === 'liehuo_fenzhou' && e.casterId === 'h783'
      )
      .reduce((a, e) => a + e.damage, 0);
    expect(dotDamage).toBeGreaterThan(0); // 100% 追击必触发燃烧
    expect(liehuo).toBeTruthy();
    expect(liehuo!.damage).toBe(dotDamage);
    // 汇总统计（详情视图 skillDamage）同样计入
    const summary = report.stats.find((s) => s.unitId === 'h783')!;
    expect(summary.skillDamage).toBeGreaterThanOrEqual(dotDamage);
  });
});
