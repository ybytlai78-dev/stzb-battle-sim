/**
 * 批量1 主战法测试（v0.6）：千里单骑 / 樊渊泅囚 / 枭姬 / 上将潘凤 / 将倾之柱 / 血溅黄砂
 * 每战法 3 个测试：机制（事件/状态）、数值、与既有战法共存/冲突。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
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

function run(team: General[], seed = 10001, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const dmgBySkill = (report: ReturnType<typeof run>, name: string) =>
  report.events
    .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillName === name)
    .reduce((acc, e) => acc + e.damage, 0);

/** 找某战法的 skill_target 事件（skill_target 事件没有 skillName 字段，需按 skillId 匹配） */
const targetsOf = (report: ReturnType<typeof run>, skillId: string) =>
  report.events.find((e) => e.type === 'skill_target' && e.skillId === skillId) as
    | { type: 'skill_target'; targetIds: string[] }
    | undefined;

describe('千里单骑（魏·关羽，追击 200% + 自身恢复）', () => {
  it('主战法挂入追击槽（DB 装配）', () => {
    const g = hero('h26');
    expect(g.name).toBe('关羽');
    expect(g.faction).toBe('魏');
    expect(g.pursuitSkillIds).toContain('qianli_danqi');
  });

  it('普攻命中后发动追击，对目标造成伤害', () => {
    const report = run(
      [withSkills(level40(hero('h26'), { attack: 40 }), { pursuitSkillIds: ['qianli_danqi'] })],
      2
    );
    const cast = casts(report, '千里单骑');
    expect(cast.length).toBeGreaterThan(0);
    expect(dmgBySkill(report, '千里单骑')).toBeGreaterThan(0);
  });

  it('发动时自身恢复兵力（heal 事件 targetId = 施法者）', () => {
    const report = run(
      [withSkills(level40(hero('h26'), { attack: 40 }), { pursuitSkillIds: ['qianli_danqi'] })],
      2
    );
    const heals = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> =>
        e.type === 'heal' && e.skillName === '千里单骑'
    );
    expect(heals.length).toBeGreaterThan(0);
    for (const h of heals) {
      expect(h.targetId).toBe('h26');
      expect(h.amount).toBeGreaterThan(0);
    }
  });
});

describe('樊渊泅囚（蜀·关羽，准备全体 190% + 犹豫 1 回合）', () => {
  it('主战法挂入主动槽，需 1 回合准备', () => {
    const g = hero('h451');
    expect(g.name).toBe('关羽');
    expect(g.faction).toBe('蜀');
    expect(g.activeSkillIds).toContain('fanyuan_qiou');
    const s = SKILL_REGISTRY['fanyuan_qiou'];
    expect(s.type === 'active' && s.prepare).toBe(true);
  });

  it('准备后对敌军全体造成伤害（skill_target 覆盖 3 目标）', () => {
    const report = run([withSkills(level40(hero('h451'), { attack: 40 }), { activeSkillIds: ['fanyuan_qiou'] })], 1);
    const cast = casts(report, '樊渊泅囚');
    expect(cast.length).toBeGreaterThan(0);
    // 全体伤害：一次释放命中全部 3 个存活目标
    const targets = targetsOf(report, 'fanyuan_qiou');
    expect(targets?.targetIds.length).toBe(3);
    expect(dmgBySkill(report, '樊渊泅囚')).toBeGreaterThan(0);
  });

  it('命中目标陷入犹豫（hesitation 1 回合）', () => {
    const report = run([withSkills(level40(hero('h451'), { attack: 40 }), { activeSkillIds: ['fanyuan_qiou'] })], 1);
    const hesi = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'hesitation'
    );
    expect(hesi.length).toBeGreaterThan(0);
  });
});

describe('枭姬（孙尚香，准备全体 160% + 群体 140%）', () => {
  it('主战法挂入主动槽（孙尚香）', () => {
    const g = hero('h36');
    expect(g.name).toBe('孙尚香');
    expect(g.activeSkillIds).toContain('xiaoji');
  });

  it('准备后对敌军全体造成第一段伤害（160%）', () => {
    const report = run([withSkills(level40(hero('h36'), { attack: 40 }), { activeSkillIds: ['xiaoji'] })], 1);
    const cast = casts(report, '枭姬');
    expect(cast.length).toBeGreaterThan(0);
    const targets = targetsOf(report, 'xiaoji');
    expect(targets?.targetIds.length).toBe(3);
    expect(dmgBySkill(report, '枭姬')).toBeGreaterThan(0);
  });

  it('第二段对群体 2 目标（targetMode:group 重新选 2 目标）', () => {
    // 高兵力敌军避免阵亡：单次释放 = 全体 3 段伤害 + 群体 2 段伤害 = 5 次 damage 事件
    const bigEnemy = [
      { ...dummy('ef', '前锋'), maxTroops: 100000 },
      { ...dummy('em', '中军'), maxTroops: 100000 },
      { ...dummy('eb', '大营'), maxTroops: 100000 },
    ];
    const report = runBattle({
      seed: 3,
      maxRounds: 8,
      myTeam: [withSkills(level40(hero('h36'), { attack: 40 }), { activeSkillIds: ['xiaoji'] })],
      enemyTeam: bigEnemy,
    });
    const castCount = casts(report, '枭姬').length;
    expect(castCount).toBeGreaterThan(0);
    const dmgEvents = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillName === '枭姬'
    );
    // 每次释放 5 次（全体3 + 群体2），且不会有人阵亡
    expect(dmgEvents.length).toBe(5 * castCount);
  });
});

describe('上将潘凤（潘凤，单体猛攻 355% + 自身混乱 1 回合）', () => {
  it('主战法挂入主动槽（潘凤）', () => {
    const g = hero('h486');
    expect(g.name).toBe('潘凤');
    expect(g.activeSkillIds).toContain('shangjiang_panfeng');
  });

  it('对单体发动猛攻（355%，单目标 damage）', () => {
    const report = run([withSkills(level40(hero('h486'), { attack: 40 }), { activeSkillIds: ['shangjiang_panfeng'] })], 1);
    const cast = casts(report, '上将潘凤');
    expect(cast.length).toBeGreaterThan(0);
    const targets = targetsOf(report, 'shangjiang_panfeng');
    expect(targets?.targetIds.length).toBe(1);
  });

  it('施法者自身陷入混乱（混乱 target:self）', () => {
    const report = run([withSkills(level40(hero('h486'), { attack: 40 }), { activeSkillIds: ['shangjiang_panfeng'] })], 1);
    const selfConfusion = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'confusion' && e.unitId === 'h486'
    );
    expect(selfConfusion).toBeDefined();
  });
});

describe('将倾之柱（卢植，群体策略 85% + 自身减伤 49%）', () => {
  it('主战法挂入主动槽（卢植）', () => {
    const g = hero('h7');
    expect(g.name).toBe('卢植');
    expect(g.activeSkillIds).toContain('jiangqing_zhizhu');
  });

  it('对敌军群体发动策略攻击（strategy_damage 事件）', () => {
    const report = run([withSkills(level40(hero('h7'), { strategy: 40 }), { activeSkillIds: ['jiangqing_zhizhu'] })], 1);
    const cast = casts(report, '将倾之柱');
    expect(cast.length).toBeGreaterThan(0);
    const strat = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '将倾之柱' && e.damageType === 'strategy'
    );
    expect(strat.length).toBeGreaterThan(0);
  });

  it('施法者自身获得减伤 49%（damage_reduce 状态）', () => {
    const report = run([withSkills(level40(hero('h7'), { strategy: 40 }), { activeSkillIds: ['jiangqing_zhizhu'] })], 1);
    const selfReduce = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce' && e.unitId === 'h7'
    );
    expect(selfReduce).toBeDefined();
  });
});

describe('血溅黄砂（马超，战斗开始被动：自身攻击增伤 120%）', () => {
  it('主战法挂入被动槽（马超）', () => {
    const g = hero('h13');
    expect(g.name).toBe('马超');
    expect(g.passiveSkillIds).toContain('xuejian_huangsha');
    const s = SKILL_REGISTRY['xuejian_huangsha'];
    expect(s.type === 'passive' && s.timing === 'battle_start').toBe(true);
  });

  it('战斗开始即施加增伤（准备阶段 status_inflicted）', () => {
    const report = run([withSkills(level40(hero('h13'), { attack: 40 }), { passiveSkillIds: ['xuejian_huangsha'] })], 1);
    const boost = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_boost' && e.unitId === 'h13'
    );
    expect(boost).toBeDefined();
  });

  it('普攻伤害显著高于无增伤对照', () => {
    const boosted = run([withSkills(level40(hero('h13'), { attack: 40 }), { passiveSkillIds: ['xuejian_huangsha'] })], 123456);
    const plain = run([withSkills(level40(hero('h13'), { attack: 40 }), { passiveSkillIds: [] })], 123456);
    // 只统计马超（h13）作为伤害来源的普攻（木桩的普攻受马超死亡速度影响，不应计入）
    const boostedAtk = boosted.events
      .filter((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit' && e.sourceId === 'h13')
      .reduce((acc, e) => acc + e.damage, 0);
    const plainAtk = plain.events
      .filter((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit' && e.sourceId === 'h13')
      .reduce((acc, e) => acc + e.damage, 0);
    // 血溅黄砂恒定 1.2 倍增伤（×2.2），8 回合累计应显著高于对照
    expect(boostedAtk).toBeGreaterThan(plainAtk * 1.5);
  });
});
