/**
 * 批量15 主战法测试：青丘媚祸（妲己）/ 舍身卫主（典韦）
 * 新机制：下一次攻击次数计数器（charges）+ 待下次行动再生效的暴走；
 * 攻击伤害转嫁（友军受物理伤害前目标改为典韦）。
 * 每战法 3 个测试：装配挂槽、机制、数值或共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  applyDamage,
  hasStatus,
  inflictStatus,
  triggerActiveSkill,
  triggerCommandSkills,
  triggerPassiveSkills,
  type CombatContext,
} from '../src/engine/action';
import { firstOnHurt, type CommandSkill, type General, type PassiveSkill, type Position, type Skill, type UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
    hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 将受击触发率改为 100%，便于确定性机制断言 */
function forceOnHurtRate(ctx: CombatContext, skillId: string, rate = 1): void {
  const base = ctx.skills.get(skillId);
  if (!base || (base.type !== 'command' && base.type !== 'passive') || !base.onHurt) {
    throw new Error(`forceOnHurtRate：${skillId} 无 onHurt`);
  }
  ctx.skills.set(skillId, { ...base, onHurt: { ...firstOnHurt(base.onHurt)!, rate } } as Skill);
}

const TWO_HIT: Skill = {
  id: 'test_two_hit',
  name: '测试二次攻击',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'single',
  tags: ['damage'],
  output: [
    { kind: 'physical_damage', rate: 100, targetMode: 'single' },
    { kind: 'physical_damage', rate: 100, targetMode: 'single' },
  ],
};

const AOE_PHYS: Skill = {
  id: 'test_aoe_phys',
  name: '测试全体物理',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'all',
  tags: ['damage'],
  output: [{ kind: 'physical_damage', rate: 100 }],
};

const AOE_STRAT: Skill = {
  id: 'test_aoe_strat',
  name: '测试全体策略',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'all',
  tags: ['damage'],
  output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: false, growthRate: 0 }],
};

describe('青丘媚祸（妲己，一类指挥：受击 60% 随机敌军下次行动暴走 + 下一次攻击/策略伤害 -24%）', () => {
  it('主战法挂入指挥槽（妲己），一类指挥距离 4 随机单体，成长率 0.15', () => {
    const g = hero('h372');
    expect(g.name).toBe('妲己');
    expect(g.commandSkillIds).toContain('qingqiu_meihuo');
    const s = SKILL_REGISTRY['qingqiu_meihuo'] as CommandSkill;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('random_single');
    expect(firstOnHurt(s.onHurt)?.victim).toBe('self');
    expect(firstOnHurt(s.onHurt)?.rate).toBe(0.6);
    expect(firstOnHurt(s.onHurt)?.applyTo).toBe('skill_targets');
    expect(s.tags).toEqual(['rampage', 'damage_boost']);
    const boost = s.output.find((o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'damage_boost');
    const rampage = s.output.find((o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'rampage');
    expect(
      boost &&
        boost.kind === 'inflict_status' &&
        !Array.isArray(boost.status) &&
        boost.status.type === 'damage_boost' &&
        boost.status.rate
    ).toBe(-0.24);
    expect(
      boost &&
        boost.kind === 'inflict_status' &&
        !Array.isArray(boost.status) &&
        boost.status.type === 'damage_boost' &&
        boost.status.growthRate
    ).toBe(0.15);
    expect(
      boost &&
        boost.kind === 'inflict_status' &&
        !Array.isArray(boost.status) &&
        boost.status.type === 'damage_boost' &&
        boost.status.charges
    ).toBe(1);
    expect(
      rampage &&
        rampage.kind === 'inflict_status' &&
        !Array.isArray(rampage.status) &&
        rampage.status.type === 'rampage' &&
        rampage.status.pendingNextAct
    ).toBe(true);
  });

  it('受击后目标挂待生效暴走 + 下一次造成伤害降低；二次攻击只压第一次', () => {
    const daji = makeUnit(withSkills(dummy('daji', '中军', { strategy: 80 }), { commandSkillIds: ['qingqiu_meihuo'] }));
    const enemy = makeUnit(withSkills(dummy('e1', '前锋', { attack: 200 }), { activeSkillIds: ['test_two_hit'] }), 'enemy');
    const ctx = makeCtx([daji], [enemy]);
    ctx.skills.set('test_two_hit', TWO_HIT);
    forceOnHurtRate(ctx, 'qingqiu_meihuo');
    triggerCommandSkills(ctx, daji);

    applyDamage(ctx, daji, 50, enemy);

    const rampage = enemy.statuses.find((s) => s.type === 'rampage');
    expect(rampage).toBeTruthy();
    expect(rampage && 'pendingNextAct' in rampage && rampage.pendingNextAct).toBe(true);
    const boost = enemy.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'qingqiu_meihuo');
    expect(boost && 'charges' in boost && boost.charges).toBe(1);
    expect(boost && 'rate' in boost && Math.abs(boost.rate - -0.24) < 1e-9).toBe(true);

    const troopsBefore = daji.troops;
    triggerActiveSkill(ctx, enemy, TWO_HIT, ctx.myTeam, ctx.enemyTeam, ctx.myTeam);
    const hits = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '测试二次攻击');
    expect(hits.length).toBe(2);
    expect(hits[0].type === 'damage' && hits[1].type === 'damage' && hits[0].damage < hits[1].damage).toBe(true);
    expect(daji.troops).toBeLessThan(troopsBefore);
    expect(enemy.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'qingqiu_meihuo')).toBe(false);
  });

  it('暴走下次行动才生效，持续到再下一次行动开始前消失；谋略 180 → 降低 39%', () => {
    const daji = makeUnit(withSkills(dummy('daji', '中军', { strategy: 180 }), { commandSkillIds: ['qingqiu_meihuo'] }));
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([daji], [enemy]);
    forceOnHurtRate(ctx, 'qingqiu_meihuo');
    triggerCommandSkills(ctx, daji);
    applyDamage(ctx, daji, 50, enemy);

    const boost = enemy.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'qingqiu_meihuo');
    // 24 + 0.15×100 = 39%
    expect(boost && 'rate' in boost && Math.abs(boost.rate - -0.39) < 1e-9).toBe(true);

    expect(hasStatus(enemy, 'rampage')).toBe(true);
    const pending = enemy.statuses.find((s) => s.type === 'rampage');
    expect(pending && 'pendingNextAct' in pending && pending.pendingNextAct).toBe(true);

    // 禁止普攻，避免行动中再次打到妲己把暴走挂回去
    inflictStatus(ctx, enemy, { type: 'cowardice', duration: 99 }, 'command', 'test_cowardice');

    actUnit(ctx, enemy);
    expect(hasStatus(enemy, 'rampage')).toBe(true);
    const active = enemy.statuses.find((s) => s.type === 'rampage');
    expect(active && 'pendingNextAct' in active && active.pendingNextAct).toBe(false);

    ctx.currentRound = 2;
    actUnit(ctx, enemy);
    expect(hasStatus(enemy, 'rampage')).toBe(false);
  });
});

describe('舍身卫主（典韦，被动：距离 2 内受伤 60% 反击来源；前锋/中军前 3 回合承担友军攻击伤害）', () => {
  it('主战法挂入被动槽（典韦），被动距离 2，反击来源，前 3 回合前锋/中军转嫁', () => {
    const g = hero('h769');
    expect(g.name).toBe('典韦');
    expect(g.passiveSkillIds).toContain('sheshen_weizhu');
    const s = SKILL_REGISTRY['sheshen_weizhu'] as PassiveSkill;
    expect(s.type).toBe('passive');
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(2);
    expect(firstOnHurt(s.onHurt)?.victim).toBe('self');
    expect(firstOnHurt(s.onHurt)?.rate).toBe(0.6);
    expect(firstOnHurt(s.onHurt)?.applyTo).toBe('source');
    expect(firstOnHurt(s.onHurt)?.sourceMaxDistance).toBe(2);
    expect(s.redirectAllyPhysical?.rounds).toBe(3);
    expect(s.redirectAllyPhysical?.positions).toEqual(['前锋', '中军']);
    expect(s.tags).toEqual(['damage']);
    const dmg = s.output.find((o) => o.kind === 'physical_damage');
    expect(dmg && dmg.kind === 'physical_damage' && dmg.rate).toBe(120);
  });

  it('群体物理：典韦与友军同时受击 → 典韦挨两刀、友军不受伤；策略伤害不转嫁', () => {
    const dian = makeUnit(withSkills(dummy('dianwei', '前锋', { defense: 80 }), { passiveSkillIds: ['sheshen_weizhu'] }));
    const ally = makeUnit(dummy('ally', '中军', { defense: 80 }));
    const foe = makeUnit(withSkills(dummy('foe', '前锋', { attack: 200, strategy: 200 }), { activeSkillIds: ['test_aoe_phys'] }), 'enemy');
    const ctx = makeCtx([dian, ally], [foe]);
    ctx.skills.set('test_aoe_phys', AOE_PHYS);
    ctx.skills.set('test_aoe_strat', AOE_STRAT);
    triggerPassiveSkills(ctx, dian, 'battle_start');

    const dianBefore = dian.troops;
    const allyBefore = ally.troops;
    triggerActiveSkill(ctx, foe, AOE_PHYS, ctx.myTeam, ctx.enemyTeam, ctx.myTeam);
    const physHits = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '测试全体物理');
    expect(physHits.length).toBe(2);
    expect(physHits.every((e) => e.type === 'damage' && e.targetId === 'dianwei')).toBe(true);
    expect(dian.troops).toBeLessThan(dianBefore);
    expect(ally.troops).toBe(allyBefore);

    foe.general.activeSkillIds = ['test_aoe_strat'];
    const allyMid = ally.troops;
    const dianMid = dian.troops;
    triggerActiveSkill(ctx, foe, AOE_STRAT, ctx.myTeam, ctx.enemyTeam, ctx.myTeam);
    const stratHits = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '测试全体策略');
    expect(stratHits.some((e) => e.type === 'damage' && e.targetId === 'ally')).toBe(true);
    expect(ally.troops).toBeLessThan(allyMid);
    expect(dian.troops).toBeLessThan(dianMid);
  });

  it('距离 2 内反击伤害来源；距离外不反击；大营不承担友军伤害', () => {
    const dian = makeUnit(withSkills(dummy('dianwei', '前锋', { attack: 200 }), { passiveSkillIds: ['sheshen_weizhu'] }));
    const near = makeUnit(dummy('near', '前锋'), 'enemy');
    const ctx = makeCtx([dian], [near]);
    forceOnHurtRate(ctx, 'sheshen_weizhu');
    triggerPassiveSkills(ctx, dian, 'battle_start');

    const nearBefore = near.troops;
    applyDamage(ctx, dian, 40, near);
    const counter = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '舍身卫主');
    expect(counter.length).toBe(1);
    expect(counter[0].type === 'damage' && counter[0].targetId).toBe('near');
    expect(near.troops).toBeLessThan(nearBefore);

    const dianBack = makeUnit(withSkills(dummy('dianwei', '大营', { attack: 200 }), { passiveSkillIds: ['sheshen_weizhu'] }));
    const ally = makeUnit(dummy('ally', '前锋'));
    const foe = makeUnit(withSkills(dummy('foe', '前锋', { attack: 200 }), { activeSkillIds: ['test_aoe_phys'] }), 'enemy');
    const ctx2 = makeCtx([ally, dianBack], [foe]);
    ctx2.skills.set('test_aoe_phys', AOE_PHYS);
    triggerPassiveSkills(ctx2, dianBack, 'battle_start');
    const allyBefore = ally.troops;
    triggerActiveSkill(ctx2, foe, AOE_PHYS, ctx2.myTeam, ctx2.enemyTeam, ctx2.myTeam);
    expect(ally.troops).toBeLessThan(allyBefore);
  });
});
