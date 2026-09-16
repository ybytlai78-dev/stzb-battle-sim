/**
 * 批量13 主战法测试：献刀七星（汉·曹操）/ 母仪浮梦（何太后）
 * 新增引擎字段：roundRepeat.targetSide（预备判定目标侧覆盖，友军规避 + 敌军减伤分离）
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CommandSkill, General, Position } from '../src/engine/types';
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

describe('献刀七星（汉·曹操，主动 30%：单体猛攻 275% + 速度 -28 持续 2 回合）', () => {
  it('主战法挂入主动槽（曹操·汉），主动非准备，发动率 30% 距离 2', () => {
    const g = hero('h42');
    expect(g.name).toBe('曹操');
    expect(g.activeSkillIds).toContain('xiandao_qixing');
    const s = SKILL_REGISTRY['xiandao_qixing'];
    expect(s.type).toBe('active');
    if (s.type === 'active') {
      expect(s.prepare).toBe(false);
      expect(s.triggerRate).toBe(0.3);
      expect(s.range).toBe(2);
      expect(s.targetMode).toBe('random_single');
    }
    expect(s.tags).toEqual(['damage', 'debuff_speed']);
  });

  it('发动后对敌军单体造成攻击伤害', () => {
    const report = run(fullTeam(withSkills(level40(hero('h42'), { attack: 40 }), { activeSkillIds: ['xiandao_qixing'] })), 1);
    expect(casts(report, '献刀七星').length).toBeGreaterThan(0);
    const dmg = report.events.filter((e) => e.type === 'damage' && e.skillName === '献刀七星');
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      expect(d.type === 'damage' && d.damageType === 'physical').toBe(true);
      expect(d.type === 'damage' && d.targetId.startsWith('enemy')).toBe(true);
    }
  });

  it('命中目标速度属性降低 28，持续 2 回合', () => {
    const report = run(fullTeam(withSkills(level40(hero('h42'), { attack: 40 }), { activeSkillIds: ['xiandao_qixing'] })), 1);
    const speedDown = inflicted(report, 'speed_buff').filter((e) => e.unitId.startsWith('enemy'));
    expect(speedDown.length).toBeGreaterThan(0);
    expect(speedDown[0].detail).toMatch(/速度属性降低了28\(-?\d+\)/);
  });
});

describe('母仪浮梦（何太后，一类指挥：友军全体首次规避 + 前 4 回合敌军 60% 造成伤害降低 40%）', () => {
  it('主战法挂入指挥槽（何太后），一类指挥距离 5，roundRepeat 覆盖敌军', () => {
    const g = hero('h37');
    expect(g.name).toBe('何太后');
    expect(g.commandSkillIds).toContain('muyi_fumeng');
    const s = SKILL_REGISTRY['muyi_fumeng'];
    expect(s.type).toBe('command');
    if (s.type === 'command') {
      expect(s.phase).toBe('prep');
      expect(s.range).toBe(5);
      expect(s.targetSide).toBe('ally');
      expect(s.targetMode).toBe('all');
      expect(s.roundRepeat?.startRound).toBe(1);
      expect(s.roundRepeat?.endRound).toBe(4);
      expect(s.roundRepeat?.rate).toBe(0.6);
      expect(s.roundRepeat?.targetSide).toBe('enemy');
    }
    expect(s.tags).toEqual(['evasion', 'damage_boost']);
  });

  it('准备阶段对我军全体（3 目标）施加 1 层规避，不施加给敌军', () => {
    const report = run(fullTeam(withSkills(level40(hero('h37'), { strategy: 40 }), { commandSkillIds: ['muyi_fumeng'] })), 1);
    expect(casts(report, '母仪浮梦').length).toBe(1);
    const evasions = inflicted(report, 'evasion');
    expect(evasions.length).toBe(3);
    expect(evasions.every((e) => e.detail.includes('+1 层'))).toBe(true);
    expect(evasions.some((e) => e.unitId.startsWith('enemy'))).toBe(false);
  });

  it('前 4 回合敌军行动时按概率施加造成伤害降低（受谋略），第 5 回合起不再判定', () => {
    const report = run(fullTeam(withSkills(level40(hero('h37'), { strategy: 40 }), { commandSkillIds: ['muyi_fumeng'] })), 1, 8);
    const boosts = inflicted(report, 'damage_boost');
    const enemyBoosts = boosts.filter((e) => e.unitId.startsWith('enemy'));
    expect(enemyBoosts.length).toBeGreaterThan(0);
    expect(enemyBoosts[0].detail).toContain('造成的伤害降低');
    expect(boosts.some((e) => e.unitId.startsWith('ally'))).toBe(false);

    const end4 = report.events.findIndex((e) => e.type === 'round_end' && e.round === 4);
    expect(end4).toBeGreaterThan(0);
    const triggersAfter = report.events
      .slice(end4)
      .filter((e) => e.type === 'skill_trigger' && e.skillId === 'muyi_fumeng');
    expect(triggersAfter.length).toBe(0);

    const cmd = SKILL_REGISTRY['muyi_fumeng'] as CommandSkill;
    expect(cmd.roundRepeat?.targetSide).toBe('enemy');
  });
});
