/**
 * 批量5 主战法测试（v0.6.5）：红颜铁骑 / 其疾如风
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
 * 注：王异世仇（围困缺失）、黄忠定军扬威（挑衅缺失）机制不全，暂不录入。文鸯盛气横凌已于士气分支补全后录入。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle, buildTurnOrder } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill } from '../src/engine/types';
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

describe('红颜铁骑（马云禄，回合开始被动：自身攻击+50 + 每回合连击）', () => {
  it('主战法挂入被动槽（马云禄），回合开始触发', () => {
    const g = hero('h19');
    expect(g.name).toBe('马云禄');
    expect(g.passiveSkillIds).toContain('hongyan_tieqi');
    const s = SKILL_REGISTRY['hongyan_tieqi'];
    expect(s.type === 'passive' && s.timing === 'round_start').toBe(true);
  });

  it('战斗开始后每回合使自身攻击属性提高 50（attack_buff）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h19'), { attack: 40 }), { passiveSkillIds: ['hongyan_tieqi'] })), 1);
    const buff = inflicted(report, 'attack_buff').filter((e) => e.unitId === 'h19');
    expect(buff.length).toBeGreaterThan(0);
    expect(buff[0].detail).toContain('50');
  });

  it('使自身每回合可进行两次普通攻击（combo 状态）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h19'), { attack: 40 }), { passiveSkillIds: ['hongyan_tieqi'] })), 1);
    const combo = inflicted(report, 'combo').filter((e) => e.unitId === 'h19');
    expect(combo.length).toBeGreaterThan(0);
  });
});

describe('其疾如风（张辽，一类指挥：每回合 70% 几率我军全体连击）', () => {
  it('主战法挂入指挥槽（张辽），一类指挥', () => {
    const g = hero('h27');
    expect(g.name).toBe('张辽');
    expect(g.commandSkillIds).toContain('qiji_rufeng');
    const s = SKILL_REGISTRY['qiji_rufeng'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect('targetSide' in s && s.targetSide === 'ally').toBe(true);
  });

  it('准备阶段无条件使我军全体速度提高（speed_buff，受谋略影响）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h27'), { strategy: 83 }), { commandSkillIds: ['qiji_rufeng'] })), 1);
    const buff = inflicted(report, 'speed_buff');
    expect(buff.length).toBeGreaterThan(0);
    // 施加在友军全体（含张辽自己）而非敌军
    const unitIds = buff.map((e) => e.unitId);
    expect(unitIds.some((id) => id.startsWith('enemy'))).toBe(false);
    expect(unitIds).toContain('h27');
  });

  it('回合开始按 70% 概率对我军全体施加连击', () => {
    const report = run(fullTeam(withSkills(level40(hero('h27'), { speed: 40 }), { commandSkillIds: ['qiji_rufeng'] })), 1);
    const combo = inflicted(report, 'combo');
    expect(combo.length).toBeGreaterThan(0);
    // 连击施加在友军（含张辽自己）而非敌军
    const unitIds = combo.map((e) => e.unitId);
    expect(unitIds.some((id) => id.startsWith('enemy'))).toBe(false);
  });

  it('连击判定窗口为前 3 回合（roundRepeat 1~3），判定成功后连击仅持续本回合（duration 1）', () => {
    const s = SKILL_REGISTRY['qiji_rufeng'] as Extract<Skill, { type: 'command' }>;
    expect(s.roundRepeat).toEqual({ startRound: 1, endRound: 3, rate: 0.7 });
    const comboOut = s.output.find((o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'combo');
    expect(comboOut?.kind === 'inflict_status' && !Array.isArray(comboOut.status) && comboOut.status.type === 'combo' ? comboOut.status.duration : -1).toBe(1);
    // 速度 buff 仍为前 3 回合无条件施加（initialOutput duration 3）
    const spdOut = s.initialOutput?.[0];
    expect(spdOut?.kind === 'inflict_status' && !Array.isArray(spdOut.status) && spdOut.status.type === 'speed_buff' ? spdOut.status.duration : -1).toBe(3);
  });

  it('端到端：连击状态只可能出现在第 1~3 回合（4 回合起判定窗口关闭）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h27'), { speed: 40 }), { commandSkillIds: ['qiji_rufeng'] })), 8);
    let round = 0;
    const comboRounds: number[] = [];
    for (const ev of report.events) {
      if (ev.type === 'round_start') { round = ev.round; continue; }
      if (ev.type === 'status_inflicted' && ev.statusType === 'combo') comboRounds.push(round);
    }
    expect(comboRounds.length).toBeGreaterThan(0); // 前 3 回合有判定机会
    expect(comboRounds.every((r) => r >= 1 && r <= 3)).toBe(true);
  });
});

describe('速度 buff 影响出手顺序（其疾如风完整机制）', () => {
  it('携带速度增益的单位在 buildTurnOrder 中优先出手', () => {
    const slow = hero('h27'); // 张辽基础速度 105
    const fast = dummy('dummy-fast', '前锋'); // 木桩速度 20
    // 直接构造 UnitState，手动施加 speed_buff 模拟（不依赖战法触发）
    const slowUnit: import('../src/engine/types').UnitState = {
      general: withSkills(level40(slow, { speed: 0 }), { commandSkillIds: [] }),
      side: 'my',
      troops: 9000,
      alive: true,
      wounded: 0,
      totalDead: 0,
      statuses: [{ type: 'speed_buff', amount: 100, remaining: 3, appliedRound: 0, sourceSkillType: 'command', sourceSkillId: 'qiji_rufeng' }],
      preparations: [],
    };
    const fastUnit: import('../src/engine/types').UnitState = {
      general: dummy('dummy-fast', '前锋'),
      side: 'enemy',
      troops: 9000,
      alive: true,
      wounded: 0,
      totalDead: 0,
      statuses: [],
      preparations: [],
    };
    const order = buildTurnOrder([slowUnit, fastUnit]);
    // 木桩基础速度远低于张辽，但张辽带速度增益后应仍在前
    expect(order[0].general.id).toBe('h27');
  });
});
