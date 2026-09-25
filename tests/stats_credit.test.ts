/**
 * 统计归属测试（v0.13）：
 *  1. 指挥队友攻击的杀伤归属（creditToId）：奇兵拒北（魏延·二类指挥）借速度最高友军攻击，
 *     造成的杀伤计入施法者战法（魏延的奇兵拒北），而非实际打人的友军。
 *  2. 恢复战法统计：张机金匮要略（一类指挥）「次数 1 ｜ 杀伤 0 ｜ 恢复 x」——heal 事件归属施法者。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { computeStats, computeDetailedStats } from '../src/engine/stats';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, opts: { attack?: number; speed?: number } = {}): General {
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
    attack: opts.attack ?? 80,
    defense: 80,
    strategy: 60,
    speed: opts.speed ?? 20,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

/** 从 report 构造 UnitState（computeStats/computeDetailedStats 需要） */
function unitsOf(report: ReturnType<typeof runBattle>): UnitState[] {
  return [
    ...report.myTeam.map((g) => ({ general: g, side: 'my' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] })),
    ...report.enemyTeam.map((g) => ({ general: g, side: 'enemy' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] })),
  ];
}

type DamageEvent = Extract<BattleEvent, { type: 'damage' }>;

describe('指挥队友攻击的杀伤归属（creditToId）', () => {
  it('奇兵拒北借速度最高友军攻击：damage 事件 creditToId=施法者，杀伤计入魏延的奇兵拒北而非友军', () => {
    const weiyan = level40(hero('weiyan'), { attack: 40 });
    weiyan.position = '中军';
    const fastAlly = dummy('fast-ally', '大营', { speed: 150, attack: 90 }); // 速度最高友军（被借力打人）
    const report = runBattle({
      seed: 5,
      maxRounds: 8,
      myTeam: [weiyan, dummy('front', '前锋'), fastAlly],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    // 借友军的伤害事件：sourceId = 友军（实际打人者），creditToId = 魏延（施法者）
    const borrowed = report.events.filter(
      (e): e is DamageEvent => e.type === 'damage' && e.creditToId === 'weiyan' && e.skillId === 'qibing_jubei'
    );
    expect(borrowed.length).toBeGreaterThan(0);
    expect(borrowed.every((e) => e.sourceId === 'fast-ally')).toBe(true);
    // 自身（source='self' 借力）路径不带 creditToId
    const selfHits = report.events.filter(
      (e): e is DamageEvent => e.type === 'damage' && e.skillId === 'qibing_jubei' && e.sourceId === 'weiyan'
    );
    expect(selfHits.every((e) => e.creditToId === undefined)).toBe(true);

    // 统计：奇兵拒北杀伤归属魏延；友军名下无奇兵拒北
    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const wy = detailed.find((d) => d.unitId === 'weiyan')!;
    const qb = wy.skills.find((s) => s.skillId === 'qibing_jubei');
    expect(qb?.damage ?? 0).toBeGreaterThan(0);
    const ally = detailed.find((d) => d.unitId === 'fast-ally')!;
    expect(ally.skills.some((s) => s.skillId === 'qibing_jubei')).toBe(false);
    // 武将级统计同样归属魏延
    const summary = computeStats(report.events, unitsOf(report));
    const wySum = summary.find((s) => s.unitId === 'weiyan')!;
    expect(wySum.skillDamage).toBeGreaterThan(0);
  });
});

describe('恢复战法统计（次数 ｜ 杀伤 ｜ 恢复）', () => {
  it('金匮要略（张机·一类指挥）：次数 1 ｜ 杀伤 0 ｜ 恢复 x（heal 事件归属施法者）', () => {
    const zhangji = level40(hero('h526'), { strategy: 40 });
    zhangji.position = '大营';
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [zhangji, dummy('front', '前锋'), dummy('mid', '中军')],
      enemyTeam: [dummy('e1', '前锋', { attack: 120 }), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const zj = detailed.find((d) => d.unitId === 'h526')!;
    const sk = zj.skills.find((s) => s.skillId === 'jinkui_yaolue')!;
    expect(sk.castCount).toBe(1); // 一类指挥准备阶段释放 1 次
    expect(sk.damage).toBe(0); // 无杀伤
    expect(sk.healCount).toBeGreaterThan(0); // 受击急救触发多次
    expect(sk.healAmount).toBeGreaterThan(0); // 恢复量 = heal 事件求和

    // 武将级统计（computeStats）：恢复次数/恢复兵力与战法级一致
    const summary = computeStats(report.events, unitsOf(report));
    const zjSum = summary.find((s) => s.unitId === 'h526')!;
    expect(zjSum.healCount).toBe(sk.healCount);
    expect(zjSum.healAmount).toBe(sk.healAmount);
    expect(zjSum.skillDamage).toBe(0);
  });
});
