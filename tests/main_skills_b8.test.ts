/**
 * 批量8 主战法测试（v0.10）：夔吼象踏（木鹿大王）/ 烈火焚舟（黄盖）/
 * 将门虎女（张姬）/ 明慧通透（王元姬）/ 险途暗渡（邓艾）
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

describe('夔吼象踏（木鹿大王，二类指挥：自身分兵 + 每回合敌单体策略攻击）', () => {
  it('主战法挂入指挥槽（木鹿大王），二类指挥', () => {
    const g = hero('h452');
    expect(g.name).toBe('木鹿大王');
    expect(g.commandSkillIds).toContain('kui_xiangta');
    const s = SKILL_REGISTRY['kui_xiangta'];
    expect(s.type === 'command' && s.phase === 'round').toBe(true);
  });

  it('战斗开始使自身进入分兵状态（split）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h452'), { attack: 40 }), { commandSkillIds: ['kui_xiangta'] })), 1);
    const split = inflicted(report, 'split').filter((e) => e.unitId === 'h452');
    expect(split.length).toBeGreaterThan(0);
  });

  it('每回合对敌军单体发动策略攻击（目标为 1 个敌军）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h452'), { strategy: 83 }), { commandSkillIds: ['kui_xiangta'] })), 1);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '夔吼象踏' && e.damageType === 'strategy'
    );
    expect(dmg.length).toBeGreaterThan(0);
    const targetIds = new Set(dmg.map((e) => e.targetId));
    expect(targetIds.size).toBe(1);
  });
});

describe('烈火焚舟（黄盖，追击：普攻后目标燃烧）', () => {
  it('主战法挂入追击槽（黄盖），追击战法', () => {
    const g = hero('h783');
    expect(g.name).toBe('黄盖');
    expect(g.pursuitSkillIds).toContain('liehuo_fenzhou');
    const s = SKILL_REGISTRY['liehuo_fenzhou'];
    expect(s.type).toBe('pursuit');
  });

  it('普攻命中后使攻击目标陷入燃烧状态', () => {
    const report = run(fullTeam(withSkills(level40(hero('h783'), { strategy: 70 }), { pursuitSkillIds: ['liehuo_fenzhou'] })), 1);
    expect(casts(report, '烈火焚舟').length).toBeGreaterThan(0);
    const burning = inflicted(report, 'burning');
    expect(burning.length).toBeGreaterThan(0);
    // 燃烧施加在普攻命中的敌军（非友军）
    expect(burning.every((e) => e.unitId.startsWith('enemy'))).toBe(true);
  });

  it('燃烧每回合对目标造成兵力损失（dot_tick）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h783'), { strategy: 70 }), { pursuitSkillIds: ['liehuo_fenzhou'] })), 1);
    const ticks = dotTicks(report, 'burning');
    expect(ticks.length).toBeGreaterThan(0);
  });
});

describe('将门虎女（张姬，主动：敌军群体攻击 + 围困）', () => {
  it('主战法挂入主动槽（张姬），主动战法', () => {
    const g = hero('h358');
    expect(g.name).toBe('张姬');
    expect(g.activeSkillIds).toContain('jiangmen_hunv');
    const s = SKILL_REGISTRY['jiangmen_hunv'];
    expect(s.type).toBe('active');
  });

  it('发动后对敌军群体（2 目标）造成攻击伤害', () => {
    const report = run(fullTeam(withSkills(level40(hero('h358'), { attack: 94 }), { activeSkillIds: ['jiangmen_hunv'] })), 1);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '将门虎女' && e.damageType === 'physical'
    );
    expect(dmg.length).toBeGreaterThan(0);
    const targetIds = new Set(dmg.map((e) => e.targetId));
    expect(targetIds.size).toBe(2);
  });

  it('使敌军陷入围困状态（无法恢复兵力）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h358'), { attack: 94 }), { activeSkillIds: ['jiangmen_hunv'] })), 1);
    const siege = inflicted(report, 'siege').filter((e) => e.unitId.startsWith('enemy'));
    expect(siege.length).toBeGreaterThan(0);
  });
});

describe('明慧通透（王元姬，主动：友军单体移除有害 + 恢复兵力）', () => {
  it('主战法挂入主动槽（王元姬），主动战法', () => {
    const g = hero('h706');
    expect(g.name).toBe('王元姬');
    expect(g.activeSkillIds).toContain('minghui_tongtou');
    const s = SKILL_REGISTRY['minghui_tongtou'];
    expect(s.type).toBe('active');
  });

  it('目标为友军单体（非敌军）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h706'), { strategy: 89 }), { activeSkillIds: ['minghui_tongtou'] })), 1);
    const cast = casts(report, '明慧通透');
    expect(cast.length).toBeGreaterThan(0);
    const targets = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'skill_target' }> => e.type === 'skill_target' && e.skillId === 'minghui_tongtou'
    );
    expect(targets).toBeDefined();
    expect(targets!.targetIds.length).toBe(1);
    // 友军单体：目标为施法者自身或友军（非敌军）
    expect(targets!.targetIds[0].startsWith('enemy')).toBe(false);
  });

  it('对友军单体恢复兵力（heal 事件）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h706'), { strategy: 89 }), { activeSkillIds: ['minghui_tongtou'] })), 1);
    const heal = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillName === '明慧通透'
    );
    expect(heal.length).toBeGreaterThan(0);
    // 治疗对象为友军（施法者自身或友军，非敌军）
    expect(heal.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });
});

describe('险途暗渡（邓艾，主动：敌军群体攻击 + 动摇逃兵）', () => {
  it('主战法挂入主动槽（邓艾），主动战法', () => {
    const g = hero('h310');
    expect(g.name).toBe('邓艾');
    expect(g.activeSkillIds).toContain('xiantu_andu');
    const s = SKILL_REGISTRY['xiantu_andu'];
    expect(s.type).toBe('active');
  });

  it('发动后对敌军群体造成攻击伤害', () => {
    const report = run(fullTeam(withSkills(level40(hero('h310'), { attack: 88 }), { activeSkillIds: ['xiantu_andu'] })), 1);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '险途暗渡' && e.damageType === 'physical'
    );
    expect(dmg.length).toBeGreaterThan(0);
    const targetIds = new Set(dmg.map((e) => e.targetId));
    expect(targetIds.size).toBe(2);
  });

  it('使敌军陷入恐慌状态（动摇逃兵 DoT）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h310'), { attack: 88 }), { activeSkillIds: ['xiantu_andu'] })), 1);
    const panic = inflicted(report, 'panic');
    expect(panic.length).toBeGreaterThan(0);
    expect(panic[0].unitId.startsWith('enemy')).toBe(true);
  });

  it('恐慌每回合对敌军造成兵力损失（dot_tick）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h310'), { attack: 88 }), { activeSkillIds: ['xiantu_andu'] })), 1);
    const ticks = dotTicks(report, 'panic');
    expect(ticks.length).toBeGreaterThan(0);
  });
});
