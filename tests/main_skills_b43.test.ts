/**
 * 侵掠如火（甘宁·吴步 h34 主战法）：被动 A，距离 1，目标自己。
 * ① 在战斗中可以优先行动；
 * ② 攻击类主动战法发动率提升 20.0%；
 * ③ 进行攻击时有 30.0% 的几率使本次攻击伤害提高 50.0%。
 * 官方：scripts/skill_extra.json id 200034（被动 A / 距离 1 / 自己 / 兵种步；1 级 10% / 25%）。
 * 三段均无「受…属性影响」→ 无待确认成长率，甘宁**上架**。
 * 口径（用户确认）：
 *  - ③「进行攻击」= 普通攻击 / 物理主动战法 / 追击战法；不含分兵溅射、反击、指挥代打与 DoT；
 *  - ③ 每个伤害对象各掷一次，官方未写受士气影响（属效果几率）→ 固定 30%，不走 moraleTriggerRate。
 * 引擎配套：① PassiveSkill.priorityRounds ② trigger_boost.attackSkillsOnly ③ PassiveSkill.attackProcBoost。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  inflictStatus,
  triggerActiveSkill,
  type CombatContext,
} from '../src/engine/action';
import { buildPriorityOrder, runBattle } from '../src/engine/combat';
import type { BattleEvent, CreateStatus, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 30000,
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

function heroGeneral(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): General {
  return { ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position };
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): UnitState {
  return makeUnit(heroGeneral(heroId, position, skills));
}

/** 侵掠如火 ② 的发动率状态（攻击类主动 +20%） */
const boostStatus: CreateStatus = {
  type: 'trigger_boost',
  rate: 0.2,
  duration: 999,
  skillTypes: ['active'],
  attackSkillsOnly: true,
};

/** 自造战法（走真实输出管线，避免依赖注册表里某个具体战法的数值） */
function activeSkill(id: string, output: Skill['output'], name = id): Skill {
  return {
    id,
    name,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.25,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output,
  } as Skill;
}

const PHYS_SKILL = activeSkill('test_phys', [{ kind: 'physical_damage', rate: 100 }], '测试攻击');
const STRAT_SKILL = activeSkill(
  'test_strat',
  [{ kind: 'strategy_damage', rate: 100, strategyScaled: false }],
  '测试策略',
);

/** 概率增伤被动（chance=1 必中，便于确定性断言） */
const PROC_PASSIVE: Skill = {
  id: 'test_proc',
  name: '测试概率增伤',
  type: 'passive',
  range: 1,
  triggerRate: 1,
  timing: 'battle_start',
  targetMode: 'self',
  tags: ['damage_boost'],
  output: [],
  attackProcBoost: { chance: 1, rate: 0.5 },
} as Skill;

describe('侵掠如火（甘宁 h34）', () => {
  it('装配：注册表定义 + h34 挂槽 + 三段无成长率待确认（甘宁上架）', () => {
    const hero = HERO_REGISTRY['h34'];
    expect(hero.name).toBe('甘宁');
    expect(hero.mainSkillName).toBe('侵掠如火');

    const s = SKILL_REGISTRY['qinlue_ruhuo'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
    expect(s.targetMode).toBe('self');
    expect(s.priorityRounds).toBe(999); // ① 全程先手
    expect(s.attackProcBoost).toEqual({ chance: 0.3, rate: 0.5 }); // ③ 30% → 本次 +50%
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: {
        type: 'trigger_boost',
        rate: 0.2,
        duration: 999,
        skillTypes: ['active'],
        attackSkillsOnly: true,
      },
    });

    // 无「受…属性影响」段 → 不登记下架
    expect(OFFLINE_MAIN_SKILLS['qinlue_ruhuo']).toBeUndefined();
    expect(isHeroListed({ mainSkillId: 'qinlue_ruhuo' })).toBe(true);
  });

  it('① 被动先手：先手组优先（速度更慢也先出手），超出 priorityRounds 后回归速度序', () => {
    const ganning = heroUnit('h34', '大营', { passiveSkillIds: ['qinlue_ruhuo'] });
    // 对手速度远高于甘宁，无先手时必然先动
    const fastFoe = makeUnit(dummy('fast-foe', '前锋', { speed: 300 }), 'enemy');
    const skills = new Map<string, Skill>(Object.entries(SKILL_REGISTRY));

    const round1 = buildPriorityOrder([ganning, fastFoe], 1, skills);
    expect(round1[0].general.id).toBe('h34');

    // priorityRounds 999 = 全程；第 1000 回合（理论外）不再先手
    const roundLate = buildPriorityOrder([ganning, fastFoe], 1000, skills);
    expect(roundLate[0].general.id).toBe('fast-foe');
  });

  it('② 攻击类主动战法发动率 +20%：攻击类生效、策略类不受影响', () => {
    const attacker = heroUnit('h34', '前锋', { passiveSkillIds: ['qinlue_ruhuo'] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([attacker], [foe], 3);
    inflictStatus(ctx, attacker, boostStatus, 'passive', 'qinlue_ruhuo', attacker.general.id);

    // 攻击类（物理）主动：25% → 45%
    triggerActiveSkill(ctx, attacker, PHYS_SKILL, [foe], [attacker], [foe]);
    const physTrigger = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger',
    );
    expect(physTrigger?.rate).toBe(45);

    // 策略类主动：25% 不变（attackSkillsOnly 过滤）
    const ctx2 = makeCtx([attacker], [foe], 3);
    inflictStatus(ctx2, attacker, boostStatus, 'passive', 'qinlue_ruhuo', attacker.general.id);
    triggerActiveSkill(ctx2, attacker, STRAT_SKILL, [foe], [attacker], [foe]);
    const stratTrigger = ctx2.events.find(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger',
    );
    expect(stratTrigger?.rate).toBe(25);
  });

  it('③ 进行攻击概率增伤：物理攻击 ×1.5，策略伤害不受影响', () => {
    // mode：none = 不带被动；zero = 带被动但 rate 0（同样掷点、同 RNG 消耗，作对照）；
    //       proc = 带被动 rate 0.5。zero 与 proc 的 atkBaseRandomCoeff 抽取序列一致，可精确对比。
    const run = (skill: Skill, mode: 'none' | 'zero' | 'proc') => {
      const s = structuredClone(skill) as Skill;
      s.triggerRate = 1; // 只考察伤害倍率，不掺发动率 RNG
      const withPassive = mode !== 'none';
      const atk = makeUnit(
        dummy('atk', '前锋', withPassive ? { passiveSkillIds: ['test_proc'] } : {}),
      );
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([atk], [foe], 42);
      ctx.skills.set(s.id, s);
      ctx.skills.set('test_proc', {
        ...(PROC_PASSIVE as Extract<Skill, { type: 'passive' }>),
        attackProcBoost: { chance: 1, rate: mode === 'proc' ? 0.5 : 0 },
      } as Skill);
      triggerActiveSkill(ctx, atk, s, [foe], [atk], [foe]);
      return ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage',
      );
    };

    const ctrl = run(PHYS_SKILL, 'zero');
    const proc = run(PHYS_SKILL, 'proc');
    expect(ctrl?.damage ?? 0).toBeGreaterThan(0);
    // troopBase（兵力基础）不乘 mult，只有 base + main 吃增减伤：
    // 预期增量 = (对照伤害 − troopBase) × 50%
    const expectedDelta = ((ctrl!.damage - ctrl!.breakdown.troopBase) * 0.5);
    expect(Math.abs((proc!.damage - ctrl!.damage) - expectedDelta)).toBeLessThanOrEqual(2);

    // 策略伤害不吃（isAttackHitForProc 要求 physical）
    const stratNone = run(STRAT_SKILL, 'none');
    const stratProc = run(STRAT_SKILL, 'proc');
    expect(stratProc!.damage).toBe(stratNone!.damage);
  });

  it('整场战斗：战斗开始挂上发动率状态，且甘宁凭先手在首回合第一个行动', () => {
    const ganning = heroGeneral('h34', '大营', { passiveSkillIds: ['qinlue_ruhuo'] });
    const report = runBattle({
      seed: 11,
      maxRounds: 8,
      myTeam: [dummy('ally-a', '前锋'), dummy('ally-b', '中军'), ganning],
      // 敌方速度拉满：若无被动先手，甘宁不可能是第一个行动的
      enemyTeam: [
        dummy('foe-a', '前锋', { speed: 300 }),
        dummy('foe-b', '中军', { speed: 300 }),
        dummy('foe-c', '大营', { speed: 300 }),
      ],
    });

    // ② 战斗开始（准备阶段）挂上「发动率提升 20%」
    const boosts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.unitId === 'h34',
    );
    expect(boosts.some((e) => (e.detail ?? '').includes('发动率提升 20%'))).toBe(true);

    // ① 先手：全场第一个行动的武将是甘宁
    const firstAct = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'unit_act_start' }> => e.type === 'unit_act_start',
    );
    expect(firstAct?.unitId).toBe('h34');
  });
});
