/**
 * 批量6 主战法测试（v0.8）：世仇（王异）/ 复誓业火（周姬）/ 名士在野（汉四星战法，不挂群司马徽）/ 未笄难言（董白）
 * 司马徽·群 h811 只入库面板，「徽言龙凤」暂不实装。
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, HERO_RECORDS, withSkills, level40 } from '../src/data/heroes';

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

const damages = (report: ReturnType<typeof run>, skillName: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillName === skillName
  );

describe('世仇（王异，追击：普攻后策略攻击 233% + 围困 2 回合）', () => {
  it('主战法挂入追击槽（王异），追击战法', () => {
    const g = hero('h28');
    expect(g.name).toBe('王异');
    expect(g.pursuitSkillIds).toContain('shichou');
    const s = SKILL_REGISTRY['shichou'];
    expect(s.type).toBe('pursuit');
  });

  it('普攻命中后触发策略攻击伤害（strategy_damage）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h28'), { strategy: 90 }), { pursuitSkillIds: ['shichou'] })), 2);
    const dmg = damages(report, '世仇').filter((e) => e.damageType === 'strategy');
    // 追击发动率 35%（士气 120 → 42%），seed 2 应至少触发一次
    expect(dmg.length).toBeGreaterThan(0);
  });

  it('命中目标陷入围困状态（siege）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h28'), { strategy: 90 }), { pursuitSkillIds: ['shichou'] })), 2);
    const siege = inflicted(report, 'siege');
    expect(siege.length).toBeGreaterThan(0);
    // 围困施加在敌军
    expect(siege[0].unitId.startsWith('enemy')).toBe(true);
  });
});

describe('复誓业火（周姬，主动：敌军群体策略伤害提高 16% + 火攻 114% + 燃烧 114%）', () => {
  it('主战法挂入主动槽（周姬），主动战法', () => {
    const g = hero('h32');
    expect(g.name).toBe('周姬');
    expect(g.activeSkillIds).toContain('fushi_yehuo');
    const s = SKILL_REGISTRY['fushi_yehuo'];
    expect(s.type).toBe('active');
  });

  it('发动后敌军群体受到策略攻击伤害提高（damage_boost）并陷入燃烧', () => {
    const report = run(fullTeam(withSkills(level40(hero('h32'), { strategy: 85 }), { activeSkillIds: ['fushi_yehuo'] })), 1);
    const burning = inflicted(report, 'burning');
    expect(burning.length).toBeGreaterThan(0);
    expect(burning[0].unitId.startsWith('enemy')).toBe(true);
  });

  it('造成策略攻击伤害（火攻 114%）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h32'), { strategy: 85 }), { activeSkillIds: ['fushi_yehuo'] })), 1);
    const dmg = damages(report, '复誓业火').filter((e) => e.damageType === 'strategy');
    expect(dmg.length).toBeGreaterThan(0);
  });
});

describe('司马徽·群（h811，徽言龙凤暂不实装）', () => {
  it('入库为 h811，阵营群，面板对齐官网 100811，主战法空槽', () => {
    expect(HERO_REGISTRY['h354']).toBeUndefined();
    const g = hero('h811');
    expect(g.name).toBe('司马徽');
    expect(g.faction).toBe('群');
    expect(g.cost).toBe(3);
    expect(g.attackRange).toBe(2);
    expect(g.troopType).toBe('infantry');
    expect(g.commandSkillIds).toEqual([]);
    expect(g.commandSkillIds).not.toContain('mingshi_zaiye');
    const rec = HERO_RECORDS['h811'];
    expect(rec.mainSkillId).toBe('');
    expect(rec.mainSkillName).toBe('徽言龙凤');
    expect(rec.skillDesc).toContain('友军全体共计造成6次伤害后');
    expect(rec.baseAttack).toBe(55);
    expect(rec.baseDefense).toBe(83);
    expect(rec.baseStrategy).toBe(93);
    expect(rec.baseSpeed).toBe(45);
    expect(rec.growthAttack).toBe(0.64);
    expect(rec.growthDefense).toBe(1.7);
    expect(rec.growthStrategy).toBe(2.25);
    expect(rec.growthSpeed).toBe(0.6);
  });
});

describe('名士在野（一类指挥：友军谋略+35 + 每回合 50% 减伤 22%；汉四星战法，不挂群司马徽）', () => {
  it('战法仍为一类指挥、友军全体', () => {
    const s = SKILL_REGISTRY['mingshi_zaiye'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect('targetSide' in s && s.targetSide === 'ally').toBe(true);
  });

  it('准备阶段使友军全体谋略属性提高（strategy_buff 35）', () => {
    const caster = withSkills({ ...dummy('caster', '中军'), strategy: 93 }, { commandSkillIds: ['mingshi_zaiye'] });
    const report = run(fullTeam(caster), 1);
    const buff = inflicted(report, 'strategy_buff').filter((e) => e.unitId !== undefined && !e.unitId.startsWith('enemy'));
    expect(buff.length).toBeGreaterThan(0);
    expect(buff[0].detail).toContain('35');
  });

  it('每回合按 50% 几率使友军受到攻击伤害下降（负增伤）', () => {
    const caster = withSkills({ ...dummy('caster', '中军'), strategy: 93 }, { commandSkillIds: ['mingshi_zaiye'] });
    const report = run(fullTeam(caster), 2);
    const dmgBoost = inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('ally') || e.unitId === 'caster');
    expect(dmgBoost.length).toBeGreaterThan(0);
  });
});

describe('未笄难言（董白，主动：妖术 108% 2 回合 + 敌军攻击/策略伤害降低 18% 可叠加）', () => {
  it('主战法挂入主动槽（董白），主动战法', () => {
    const g = hero('h592');
    expect(g.name).toBe('董白');
    expect(g.activeSkillIds).toContain('weiji_nanyan');
    const s = SKILL_REGISTRY['weiji_nanyan'];
    expect(s.type).toBe('active');
  });

  it('发动后敌军群体陷入妖术诅咒（sorcery DoT）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h592'), { strategy: 86 }), { activeSkillIds: ['weiji_nanyan'] })), 4);
    const sorcery = inflicted(report, 'sorcery');
    expect(sorcery.length).toBeGreaterThan(0);
    expect(sorcery[0].unitId.startsWith('enemy')).toBe(true);
  });

  it('使敌军攻击和策略伤害降低（负 damage_boost）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h592'), { strategy: 86 }), { activeSkillIds: ['weiji_nanyan'] })), 4);
    const dmgBoost = inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy'));
    expect(dmgBoost.length).toBeGreaterThan(0);
  });
});
