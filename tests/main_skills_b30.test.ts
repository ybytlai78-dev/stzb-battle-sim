/**
 * 诸葛锦囊（诸葛亮·蜀·步 h17 主战法）：主动 A、距离 2、发动率 40%，我军群体（有效距离内 3 个目标）。
 *  - 使我军受策略攻击伤害降低 35%（受谋略，成长率 0.25）
 *  - 使我军进行攻击和策略攻击时的伤害提高 14%（固定，实测不随谋略变）
 *  - 自身获得先手，持续 2 回合
 *  - 若发动时目标已有诸葛锦囊效果，则额外恢复目标一定兵力（恢复率 150%）
 *
 * 本轮新增的两项引擎能力：
 *   ① priority 状态 + buildPriorityOrder 优先出手 —— 主动战法的「授予型」先手。
 *      区别于先驱突击的「指挥常驻」priorityRounds：后者按战法字段判定（前 N 回合），
 *      前者按单位状态判定（发动后授予 2 回合，可重复刷新）。
 *   ② repeatBonus 钩子（BaseSkill.repeatBonus）—— 战法发动时逐目标判定
 *      「目标是否已带本战法施加的状态」，命中则追加结算这段 output；
 *      入口处按「每次发动」结算一次，skipRepeat 防自递归。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

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
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
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

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 诸葛亮（h17）坐大营并挂上主战法，前锋/中军放木桩 */
function teamWithZhuge(): General[] {
  const zg = withSkills(level40({ ...HERO_REGISTRY['h17'] }), { activeSkillIds: ['zhuge_jinnang'] });
  return [dummy('ally-front', '前锋'), dummy('ally-mid', '中军'), { ...zg, position: '大营' }];
}

function run(team: General[], seed = 3, maxRounds = 4) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
const inflicts = (events: BattleEvent[], t: string): Inflicted[] =>
  events.filter((e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === t);

describe('诸葛锦囊（诸葛亮，主动：两轨增益 + 先手 + 重复触发额外恢复）', () => {
  it('元数据：主动 / 距离 2 / 发动率 40% / 我军群体 3 目标 / 带 repeatBonus', () => {
    const s = SKILL_REGISTRY['zhuge_jinnang'];
    expect(s.name).toBe('诸葛锦囊');
    expect(s.type).toBe('active');
    expect(s.range).toBe(2);
    expect(s.triggerRate).toBe(0.4);
    expect(s.type === 'active' && s.targetMode).toBe('group');
    expect(s.groupCount).toBe(3);
    expect(s.tags).toEqual(expect.arrayContaining(['damage_reduce', 'damage_boost', 'heal']));
    // repeatBonus 指向 heal（额外恢复）
    expect(s.repeatBonus?.output[0].kind).toBe('heal');

    const g = HERO_REGISTRY['h17'];
    expect(g.name).toBe('诸葛亮');
    expect(g.activeSkillIds).toContain('zhuge_jinnang');
  });

  it('先手：发动后自身获得 priority 状态（授予型先手，非指挥 priorityRounds）', () => {
    const report = run(teamWithZhuge(), 3, 4);
    const pri = inflicts(report.events, 'priority');
    expect(pri.length).toBeGreaterThan(0);
    expect(pri[0].unitId).toBe('h17');
    expect(pri[0].detail).toContain('先手');
  });

  it('两轨增益：受策略攻击伤害降低 + 造成伤害提高，均落在我军（含自身）', () => {
    const report = run(teamWithZhuge(), 3, 4);
    const reduce = inflicts(report.events, 'damage_reduce');
    const boost = inflicts(report.events, 'damage_boost');
    expect(reduce.length).toBeGreaterThan(0);
    expect(boost.length).toBeGreaterThan(0);
    // 增益目标为我军三将（含诸葛亮自己）
    expect(reduce.some((e) => e.unitId === 'h17')).toBe(true);
    expect(boost.some((e) => e.unitId === 'h17')).toBe(true);
  });

  it('重复触发额外恢复：第二次发动时对已有诸葛锦囊效果的目标追加治疗', () => {
    const report = run(teamWithZhuge(), 3, 4);
    const casts = report.events.filter(
      (e) => e.type === 'skill_cast' && e.skillId === 'zhuge_jinnang'
    ).length;
    const heals = report.events.filter((e) => e.type === 'heal');

    // 至少发动两次（40% 发动率 × 4 回合，seed=3）
    expect(casts).toBeGreaterThanOrEqual(2);
    // 第二次及以后的发动才会带上额外恢复
    expect(heals.length).toBeGreaterThan(0);
    // 恢复落在被援护的我军身上（目标已带诸葛锦囊效果）
    const targets = new Set(heals.map((h) => ('targetId' in h ? h.targetId : '')));
    expect([...targets].some((t) => ['h17', 'ally-front', 'ally-mid'].includes(t))).toBe(true);
  });

  it('零副作用：只在发动时判定一次，未发动则不产生额外恢复', () => {
    // 单回合、发动率窗口内若不发动，则不应有任何 heal
    const report = run(teamWithZhuge(), 7, 1);
    const casts = report.events.filter(
      (e) => e.type === 'skill_cast' && e.skillId === 'zhuge_jinnang'
    ).length;
    const heals = report.events.filter((e) => e.type === 'heal');
    if (casts === 0) expect(heals).toHaveLength(0);
    else expect(casts).toBe(1);
  });
});
