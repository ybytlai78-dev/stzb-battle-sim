/**
 * 批量16 主战法测试：运筹决胜（司马师）
 * 新机制：二类指挥 `roundTrigger:'before_active'`——每次试图发动主动战法前，
 * 独立判定暴走（30%）与对混乱/暴走全体的策略攻击（50%/220%）。
 * 每战法 3 个测试：装配挂槽、机制、数值或共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, hasStatus, inflictStatus, type CombatContext } from '../src/engine/action';
import type { CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
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

const MISS_ACTIVE: Skill = {
  id: 'test_miss_active',
  name: '测试必不中主动',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 0,
  targetMode: 'single',
  tags: ['damage'],
  output: [{ kind: 'physical_damage', rate: 100 }],
};

const MISS_ACTIVE_2: Skill = {
  ...MISS_ACTIVE,
  id: 'test_miss_active_2',
  name: '测试必不中主动2',
};

const PREP_ACTIVE: Skill = {
  id: 'test_prep_active',
  name: '测试准备主动',
  type: 'active',
  prepare: true,
  range: 5,
  triggerRate: 1,
  targetMode: 'single',
  tags: ['damage'],
  output: [{ kind: 'physical_damage', rate: 100 }],
};

/**
 * 将运筹决胜两段独立几率改为指定值，便于确定性机制断言。
 */
function forceYunchouRates(ctx: CombatContext, control: number, damage: number): void {
  const base = ctx.skills.get('yunchou_juesheng');
  if (!base || base.type !== 'command') {
    throw new Error('forceYunchouRates：运筹决胜未注册');
  }
  ctx.skills.set('yunchou_juesheng', {
    ...base,
    output: base.output.map((o) => {
      if (o.kind === 'inflict_status') return { ...o, chance: control };
      if (o.kind === 'strategy_damage') return { ...o, chance: damage };
      return o;
    }),
  });
}

function yunchouTriggers(ctx: CombatContext) {
  return ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'yunchou_juesheng');
}

function yunchouDamage(ctx: CombatContext) {
  return ctx.events.filter((e) => e.type === 'damage' && e.skillId === 'yunchou_juesheng');
}

describe('运筹决胜（司马师，二类指挥：试图发动主动战法前 30% 暴走 + 50% 对混乱/暴走策略攻击）', () => {
  it('主战法挂入指挥槽（司马师），二类指挥距离 5，主动判定前双独立几率', () => {
    const g = hero('h701');
    expect(g.name).toBe('司马师');
    expect(g.commandSkillIds).toContain('yunchou_juesheng');
    const s = SKILL_REGISTRY['yunchou_juesheng'] as CommandSkill;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('before_active');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('random_single');
    expect(s.tags).toEqual(['rampage', 'damage']);
    const control = s.output.find((o) => o.kind === 'inflict_status');
    const dmg = s.output.find((o) => o.kind === 'strategy_damage');
    expect(control && control.kind === 'inflict_status' && control.chance).toBe(0.3);
    expect(
      control &&
        control.kind === 'inflict_status' &&
        !Array.isArray(control.status) &&
        control.status.type === 'rampage' &&
        control.status.duration
    ).toBe(1);
    expect(dmg && dmg.kind === 'strategy_damage' && dmg.chance).toBe(0.5);
    expect(dmg && dmg.kind === 'strategy_damage' && dmg.rate).toBe(220);
    expect(dmg && dmg.kind === 'strategy_damage' && dmg.growthRate).toBe(1.585);
    expect(dmg && dmg.kind === 'strategy_damage' && dmg.requireStatuses).toEqual(['confusion', 'rampage']);
  });

  it('两个主动各触发一次判定；准备完成释放与混乱不触发', () => {
    const caster = makeUnit(
      withSkills(dummy('simashi', '中军', { strategy: 80 }), {
        commandSkillIds: ['yunchou_juesheng'],
        activeSkillIds: ['test_miss_active', 'test_miss_active_2'],
      })
    );
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([caster], [enemy]);
    ctx.skills.set('test_miss_active', MISS_ACTIVE);
    ctx.skills.set('test_miss_active_2', MISS_ACTIVE_2);
    forceYunchouRates(ctx, 1, 0);

    actUnit(ctx, caster);
    // 每次试图发动主动：暴走 + 伤害两段 skill_trigger；两个主动 = 4 次
    expect(yunchouTriggers(ctx).length).toBe(4);
    expect(hasStatus(enemy, 'rampage')).toBe(true);

    // 准备完成自动释放：不做主动发动率判定，不触发运筹决胜
    const prepCaster = makeUnit(
      withSkills(dummy('simashi2', '中军'), {
        commandSkillIds: ['yunchou_juesheng'],
        activeSkillIds: ['test_prep_active'],
      })
    );
    prepCaster.isPreparing = true;
    prepCaster.preparingSkillId = 'test_prep_active';
    const prepEnemy = makeUnit(dummy('e2', '前锋'), 'enemy');
    const prepCtx = makeCtx([prepCaster], [prepEnemy]);
    prepCtx.skills.set('test_prep_active', PREP_ACTIVE);
    forceYunchouRates(prepCtx, 1, 1);
    actUnit(prepCtx, prepCaster);
    expect(yunchouTriggers(prepCtx).length).toBe(0);

    // 混乱：无法试图发动主动，不触发
    const confused = makeUnit(
      withSkills(dummy('simashi3', '中军'), {
        commandSkillIds: ['yunchou_juesheng'],
        activeSkillIds: ['test_miss_active'],
      })
    );
    const confusedEnemy = makeUnit(dummy('e3', '前锋'), 'enemy');
    const confusedCtx = makeCtx([confused], [confusedEnemy]);
    confusedCtx.skills.set('test_miss_active', MISS_ACTIVE);
    forceYunchouRates(confusedCtx, 1, 1);
    inflictStatus(confusedCtx, confused, { type: 'confusion', duration: 2 }, 'active', 'test_confuse');
    actUnit(confusedCtx, confused);
    expect(yunchouTriggers(confusedCtx).length).toBe(0);
  });

  it('先挂暴走再打混乱/暴走目标；无状态不吃伤害；谋略 215 / 兵 5178 / 目标谋略 78 → 849', () => {
    const at80 = makeUnit(
      withSkills(dummy('s80', '中军', { strategy: 80 }), {
        commandSkillIds: ['yunchou_juesheng'],
        activeSkillIds: ['test_miss_active'],
      })
    );
    const confused = makeUnit(dummy('confused', '前锋'), 'enemy');
    const clean = makeUnit(dummy('clean', '中军'), 'enemy');
    const ctx80 = makeCtx([at80], [confused, clean]);
    ctx80.skills.set('test_miss_active', MISS_ACTIVE);
    forceYunchouRates(ctx80, 0, 1);
    inflictStatus(ctx80, confused, { type: 'confusion', duration: 2 }, 'active', 'test_confuse');
    actUnit(ctx80, at80);
    const hits80 = yunchouDamage(ctx80);
    expect(hits80.some((e) => e.type === 'damage' && e.targetId === 'confused')).toBe(true);
    expect(hits80.some((e) => e.type === 'damage' && e.targetId === 'clean')).toBe(false);

    // 控制命中后，当次伤害判定能打到刚挂上的暴走目标
    const seq = makeUnit(
      withSkills(dummy('seq', '中军', { strategy: 80 }), {
        commandSkillIds: ['yunchou_juesheng'],
        activeSkillIds: ['test_miss_active'],
      })
    );
    const seqEnemy = makeUnit(dummy('seqE', '前锋'), 'enemy');
    const seqCtx = makeCtx([seq], [seqEnemy]);
    seqCtx.skills.set('test_miss_active', MISS_ACTIVE);
    forceYunchouRates(seqCtx, 1, 1);
    actUnit(seqCtx, seq);
    expect(hasStatus(seqEnemy, 'rampage')).toBe(true);
    expect(yunchouDamage(seqCtx).some((e) => e.type === 'damage' && e.targetId === 'seqE')).toBe(true);

    // 用户战报：司马师 5178 兵 / 谋略 215 / 目标谋略 78 / 增减伤 0 → 849
    const at215 = makeUnit(
      withSkills(dummy('s215', '中军', { strategy: 215, maxTroops: 5178 }), {
        commandSkillIds: ['yunchou_juesheng'],
        activeSkillIds: ['test_miss_active'],
      })
    );
    const tgt78 = makeUnit(dummy('t78', '前锋', { strategy: 78 }), 'enemy');
    const ctx215 = makeCtx([at215], [tgt78]);
    ctx215.skills.set('test_miss_active', MISS_ACTIVE);
    forceYunchouRates(ctx215, 0, 1);
    inflictStatus(ctx215, tgt78, { type: 'confusion', duration: 2 }, 'active', 'test_confuse');
    actUnit(ctx215, at215);
    const d849 = yunchouDamage(ctx215).find((e) => e.type === 'damage' && e.targetId === 't78');
    expect(d849 && d849.type === 'damage' && d849.damage).toBe(849);
  });
});
