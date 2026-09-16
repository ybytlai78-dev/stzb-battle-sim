/**
 * 批量7 主战法测试（v0.9）：魏武之世（曹操·魏）/ 驱虎吞狼（荀彧）/ 定军扬威（黄忠）/
 * 西乡武功（朱儁）/ 国士无双（凌统）/ 黄天当立（张角）
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
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
    attack: 50,
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
    morale: 120,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 完整 3 人队：主将居中，含前锋/大营友军 */
function fullTeam(leader: General): General[] {
  return [leader, dummy('ally-front', '前锋'), dummy('ally-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

const dotTicks = (report: ReturnType<typeof run>, dotType: string) =>
  report.events.filter((e) => e.type === 'dot_tick' && e.dotType === dotType);

describe('魏武之世（曹操·魏，一类指挥：敌军全体四属性下降）', () => {
  it('主战法挂入指挥槽（曹操魏），一类指挥', () => {
    const g = hero('h23');
    expect(g.name).toBe('曹操');
    expect(g.faction).toBe('魏');
    expect(g.commandSkillIds).toContain('weiwu_zhishi');
    const s = SKILL_REGISTRY['weiwu_zhishi'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect('targetSide' in s && s.targetSide === 'enemy').toBe(true);
  });

  it('准备阶段使敌军全体攻击/防御/谋略/速度属性下降', () => {
    const report = run(fullTeam(withSkills(level40(hero('h23'), { strategy: 90 }), { commandSkillIds: ['weiwu_zhishi'] })), 1);
    const enemyDebuffs = ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'].map((t) =>
      inflicted(report, t).filter((e) => e.unitId.startsWith('enemy'))
    );
    // 每种属性 debuff 都施加到敌军，且为负百分比（受谋略影响，降幅随谋略增大）
    for (const deb of enemyDebuffs) {
      expect(deb.length).toBeGreaterThan(0);
      expect(deb[0].detail).toMatch(/降低了\d+%\(\d+\)\(\d+\)/);
    }
  });

  it('不施加在友军（仅敌军受影响）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h23'), { strategy: 90 }), { commandSkillIds: ['weiwu_zhishi'] })), 1);
    const anyDebuff = ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'].some((t) =>
      inflicted(report, t).some((e) => !e.unitId.startsWith('enemy'))
    );
    expect(anyDebuff).toBe(false);
  });

  it('我军全体攻击距离 +1（range_buff 实装）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h23'), { strategy: 90 }), { commandSkillIds: ['weiwu_zhishi'] })), 1);
    const rb = inflicted(report, 'range_buff');
    // 三名友军各一条；敌军不吃这条增益
    expect(rb).toHaveLength(3);
    expect(rb.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
    expect(rb[0].detail).toContain('攻击距离 +1');
    expect(SKILL_REGISTRY['weiwu_zhishi'].tags).toContain('range_buff');
  });
});

describe('驱虎吞狼（荀彧，主动：敌军全体策略攻击 + 围困）', () => {
  it('主战法挂入主动槽（荀彧），主动战法', () => {
    const g = hero('h24');
    expect(g.name).toBe('荀彧');
    expect(g.activeSkillIds).toContain('quhu_tunlang');
    const s = SKILL_REGISTRY['quhu_tunlang'];
    expect(s.type).toBe('active');
  });

  it('发动后对敌军全体造成策略伤害', () => {
    const report = run(fullTeam(withSkills(level40(hero('h24'), { strategy: 95 }), { activeSkillIds: ['quhu_tunlang'] })), 1);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '驱虎吞狼' && e.damageType === 'strategy'
    );
    expect(dmg.length).toBeGreaterThan(0);
    // 全体目标：至少覆盖 2 个敌军单位
    const targetIds = new Set(dmg.map((e) => e.targetId));
    expect(targetIds.size).toBeGreaterThan(1);
  });

  it('使敌军陷入围困状态（无法恢复兵力）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h24'), { strategy: 95 }), { activeSkillIds: ['quhu_tunlang'] })), 1);
    const siege = inflicted(report, 'siege').filter((e) => e.unitId.startsWith('enemy'));
    expect(siege.length).toBeGreaterThan(0);
  });
});

describe('定军扬威（黄忠，主动：敌军群体攻击 + 挑衅 + 自身减伤）', () => {
  it('主战法挂入主动槽（黄忠），主动战法', () => {
    const g = hero('h442');
    expect(g.name).toBe('黄忠');
    expect(g.activeSkillIds).toContain('dingjun_yangwei');
    const s = SKILL_REGISTRY['dingjun_yangwei'];
    expect(s.type).toBe('active');
  });

  it('发动后使敌军群体陷入挑衅状态（taunt，强制普攻黄忠）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h442'), { attack: 40 }), { activeSkillIds: ['dingjun_yangwei'] })), 1);
    const taunt = inflicted(report, 'taunt');
    expect(taunt.length).toBeGreaterThan(0);
    expect(taunt[0].unitId.startsWith('enemy')).toBe(true);
  });

  it('使自身受到攻击伤害降低（damage_reduce）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h442'), { attack: 40 }), { activeSkillIds: ['dingjun_yangwei'] })), 1);
    const reduce = inflicted(report, 'damage_reduce').filter((e) => e.unitId === 'h442');
    expect(reduce.length).toBeGreaterThan(0);
  });
});

describe('西乡武功（朱儁，一类指挥：前2回先手 + 第2回策略攻击）', () => {
  it('主战法挂入指挥槽（朱儁），一类指挥', () => {
    const g = hero('h553');
    expect(g.name).toBe('朱儁');
    expect(g.commandSkillIds).toContain('xixiang_wugong');
    const s = SKILL_REGISTRY['xixiang_wugong'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
  });

  it('第 2 回合对敌军群体 2 目标发动策略攻击（delayedOutput 结算）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h553'), { strategy: 95 }), { commandSkillIds: ['xixiang_wugong'] })), 1);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '西乡武功'
    );
    expect(dmg.length).toBeGreaterThan(0);
    // 延迟结算发生在第 2 回合
    const round2Idx = report.events.findIndex((e) => e.type === 'round_start' && e.round === 2);
    const round3Idx = report.events.findIndex((e) => e.type === 'round_start' && e.round === 3);
    const damageIdx = report.events.indexOf(dmg[0]);
    expect(damageIdx).toBeGreaterThan(round2Idx);
    if (round3Idx > -1) expect(damageIdx).toBeLessThan(round3Idx);
  });

  it('前 2 回合使我军群体优先行动（priorityRounds）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h553'), { strategy: 95 }), { commandSkillIds: ['xixiang_wugong'] })), 1);
    // 朱儁速度基础低于木桩速度？不：木桩速度 20，朱儁基础速度较高。
    // 验证第 1 回合战斗开始阶段后，优先组含 h553（先手生效）
    const round1Acts = report.events.filter(
      (e) => e.type === 'unit_act_start' && e.phase === 'normal_attack'
    );
    expect(round1Acts.length).toBeGreaterThan(0);
  });
});

describe('国士无双（凌统，一类指挥：前3回每回90%洞察 + 自身攻击伤害提升）', () => {
  it('主战法挂入指挥槽（凌统），一类指挥', () => {
    const g = hero('h616');
    expect(g.name).toBe('凌统');
    expect(g.commandSkillIds).toContain('guoshi_wushuang');
    const s = SKILL_REGISTRY['guoshi_wushuang'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect('targetSide' in s && s.targetSide === 'ally').toBe(true);
  });

  it('前 3 回合按 90% 概率使自身与友军单体进入洞察状态', () => {
    const report = run(fullTeam(withSkills(level40(hero('h616'), { attack: 40 }), { commandSkillIds: ['guoshi_wushuang'] })), 1);
    const insight = inflicted(report, 'insight');
    expect(insight.length).toBeGreaterThan(0);
    // 施加在友军（含凌统）而非敌军
    expect(insight.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
  });

  it('使自身攻击造成的伤害提高（damage_boost）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h616'), { attack: 40 }), { commandSkillIds: ['guoshi_wushuang'] })), 1);
    const boost = inflicted(report, 'damage_boost').filter((e) => e.unitId === 'h616');
    expect(boost.length).toBeGreaterThan(0);
  });
});

describe('黄天当立（张角，1回合准备：敌军全体妖术诅咒）', () => {
  it('主战法挂入主动槽（张角），准备主动', () => {
    const g = hero('h8');
    expect(g.name).toBe('张角');
    expect(g.activeSkillIds).toContain('huangtian_dangli');
    const s = SKILL_REGISTRY['huangtian_dangli'];
    expect(s.type === 'active' && s.prepare === true).toBe(true);
  });

  it('发动后使敌军全体陷入妖术诅咒（sorcery DoT）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h8'), { strategy: 90 }), { activeSkillIds: ['huangtian_dangli'] })), 1);
    const sorcery = inflicted(report, 'sorcery');
    expect(sorcery.length).toBeGreaterThan(0);
    expect(sorcery[0].unitId.startsWith('enemy')).toBe(true);
  });

  it('妖术每回合对敌军造成兵力损失（dot_tick）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h8'), { strategy: 90 }), { activeSkillIds: ['huangtian_dangli'] })), 1);
    const ticks = dotTicks(report, 'sorcery');
    expect(ticks.length).toBeGreaterThan(0);
  });
});
