/**
 * 批量4 主战法测试（v0.6.4）：巾帼战阵 / 白楼独舞 / 汉韵旷野 / 双艳 / 逆谋 / 宣威再战
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
    morale: 100,
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

/** 某状态下不同的目标数（去重） */
const distinctTargets = (report: ReturnType<typeof run>, statusType: string) =>
  new Set(inflicted(report, statusType).map((e) => e.unitId)).size;

describe('巾帼战阵（关银屏，主动：自身攻击增伤 40% + 群体攻击 120%）', () => {
  it('主战法挂入主动槽（关银屏），发动率 100%', () => {
    const g = hero('h72');
    expect(g.name).toBe('关银屏');
    expect(g.activeSkillIds).toContain('jinguo_zhanzhen');
    const s = SKILL_REGISTRY['jinguo_zhanzhen'];
    expect(s.type === 'active' && s.triggerRate === 1).toBe(true);
  });

  it('自身获得攻击增伤 40%（damage_boost，目标为自身）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h72'), { attack: 40 }), { activeSkillIds: ['jinguo_zhanzhen'] })), 1);
    expect(casts(report, '巾帼战阵').length).toBeGreaterThan(0);
    const selfBoost = inflicted(report, 'damage_boost').filter((e) => e.unitId === 'h72');
    expect(selfBoost.length).toBeGreaterThan(0);
    expect(selfBoost[0].detail).toContain('造成的伤害提高 40%');
  });

  it('对敌军群体造成攻击伤害（damage 事件）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h72'), { attack: 40 }), { activeSkillIds: ['jinguo_zhanzhen'] })), 1);
    const dmg = report.events.filter((e) => e.type === 'damage' && e.skillName === '巾帼战阵');
    expect(dmg.length).toBeGreaterThan(0);
    // 目标为敌军
    for (const d of dmg) {
      expect((d as { targetId: string }).targetId.startsWith('enemy')).toBe(true);
    }
  });
});

describe('白楼独舞（貂蝉·群，一类指挥：前 3 回合敌军群体攻击增伤 -26%）', () => {
  it('主战法挂入指挥槽（貂蝉·群）', () => {
    const g = hero('h337');
    expect(g.name).toBe('貂蝉');
    expect(g.commandSkillIds).toContain('bailou_duwu');
    const s = SKILL_REGISTRY['bailou_duwu'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect('targetSide' in s && s.targetSide === 'enemy').toBe(true);
  });

  it('准备阶段对敌军群体施加伤害降低（damage_boost 负值）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h337'), { strategy: 40 }), { commandSkillIds: ['bailou_duwu'] })), 1);
    const cast = casts(report, '白楼独舞');
    expect(cast.length).toBe(1);
    const boost = inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy'));
    expect(boost.length).toBeGreaterThan(0);
    expect(boost[0].detail).toContain('造成的伤害降低 26%');
  });

  it('目标为敌军群体（不含友军）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h337'), { strategy: 40 }), { commandSkillIds: ['bailou_duwu'] })), 1);
    const boost = inflicted(report, 'damage_boost');
    const unitIds = boost.map((e) => e.unitId);
    expect(unitIds.some((id) => id.startsWith('ally'))).toBe(false);
  });
});

describe('汉韵旷野（王昭君，一类指挥：敌军行动时 40% 几率减伤 30%）', () => {
  it('主战法挂入指挥槽（王昭君）', () => {
    const g = hero('h676');
    expect(g.name).toBe('王昭君');
    expect(g.commandSkillIds).toContain('hanyun_kuangye');
    const s = SKILL_REGISTRY['hanyun_kuangye'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect('roundRepeat' in s && s.roundRepeat).toBeDefined();
  });

  it('敌军行动时按概率施加伤害降低（damage_boost 负值）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h676'), { strategy: 40 }), { commandSkillIds: ['hanyun_kuangye'] })), 1);
    const boost = inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy'));
    expect(boost.length).toBeGreaterThan(0);
    expect(boost[0].detail).toContain('造成的伤害降低 30%');
  });

  it('减伤施加在敌军（不含友军）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h676'), { strategy: 40 }), { commandSkillIds: ['hanyun_kuangye'] })), 1);
    const unitIds = inflicted(report, 'damage_boost').map((e) => e.unitId);
    expect(unitIds.some((id) => id.startsWith('ally'))).toBe(false);
  });
});

describe('双艳（小乔＆大乔，主动：敌军群体暴走 2 回合）', () => {
  it('主战法挂入主动槽（小乔＆大乔）', () => {
    const g = hero('h424');
    expect(g.name).toBe('小乔＆大乔');
    expect(g.activeSkillIds).toContain('shuangyan');
    const s = SKILL_REGISTRY['shuangyan'];
    expect(s.type === 'active').toBe(true);
  });

  it('对敌军群体施加暴走（rampage 状态）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h424'), { strategy: 40 }), { activeSkillIds: ['shuangyan'] })), 1);
    expect(casts(report, '双艳').length).toBeGreaterThan(0);
    const ramp = inflicted(report, 'rampage');
    expect(ramp.length).toBeGreaterThan(0);
  });

  it('目标为敌军（不含友军）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h424'), { strategy: 40 }), { activeSkillIds: ['shuangyan'] })), 1);
    const unitIds = inflicted(report, 'rampage').map((e) => e.unitId);
    expect(unitIds.some((id) => id.startsWith('ally'))).toBe(false);
  });
});

describe('逆谋（董卓，二类指挥·战斗开始一次性：自身减伤 30%）', () => {
  it('主战法挂入指挥槽（董卓）', () => {
    const g = hero('h9');
    expect(g.name).toBe('董卓');
    expect(g.commandSkillIds).toContain('nimou');
    const s = SKILL_REGISTRY['nimou'];
    expect(s.type === 'command' && s.phase === 'round').toBe(true);
    expect('battleStartOnce' in s && s.battleStartOnce === true).toBe(true);
  });

  it('战斗开始即对自身施加减伤 30%', () => {
    const report = run(fullTeam(withSkills(level40(hero('h9'), { defense: 40 }), { commandSkillIds: ['nimou'] })), 1);
    const reduce = inflicted(report, 'damage_reduce').filter((e) => e.unitId === 'h9');
    expect(reduce.length).toBe(1);
    expect(reduce[0].detail).toContain('0.3');
  });

  it('董卓受到的攻击伤害显著低于无减伤对照', () => {
    const boosted = run(fullTeam(withSkills(level40(hero('h9'), { defense: 40 }), { commandSkillIds: ['nimou'] })), 42);
    const plain = run(fullTeam(withSkills(level40(hero('h9'), { defense: 40 }), { commandSkillIds: [] })), 42);
    const dmgTaken = (r: ReturnType<typeof run>) =>
      r.events
        .filter((e) => e.type === 'attack_hit' && (e as { targetId: string }).targetId === 'h9')
        .reduce((acc, e) => acc + (e as { damage: number }).damage, 0);
    expect(dmgTaken(boosted)).toBeLessThan(dmgTaken(plain));
  });
});

describe('宣威再战（张绣，追击：普攻后对目标再攻 150%）', () => {
  it('主战法挂入追击槽（张绣），发动率 100%', () => {
    const g = hero('h620');
    expect(g.name).toBe('张绣');
    expect(g.pursuitSkillIds).toContain('xuanwei_zaizhan');
    const s = SKILL_REGISTRY['xuanwei_zaizhan'];
    expect(s.type === 'pursuit' && s.triggerRate === 1).toBe(true);
  });

  it('普攻后触发追击（skill_cast 事件）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h620'), { attack: 40 }), { pursuitSkillIds: ['xuanwei_zaizhan'] })), 1);
    const cast = casts(report, '宣威再战');
    expect(cast.length).toBeGreaterThan(0);
  });

  it('追击对攻击目标造成兵刃伤害（damage 事件）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h620'), { attack: 40 }), { pursuitSkillIds: ['xuanwei_zaizhan'] })), 1);
    const dmg = report.events.filter((e) => e.type === 'damage' && e.skillName === '宣威再战');
    expect(dmg.length).toBeGreaterThan(0);
  });
});
