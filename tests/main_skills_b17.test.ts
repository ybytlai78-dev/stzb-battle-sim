/**
 * 批量17 主战法测试：七步释嫌（曹植）
 * 新机制：二类指挥 `roundTrigger:'ally_act'`——我军全体发动普攻 / 试图发动主动或追击时
 * 对随机敌军单体叠「下一次造成伤害降低」（charges 可叠加，打出后清空）；
 * 每累计 7 次对我军群体恢复（135%，成长 1.46/点）。
 * 每战法 3 个测试：装配挂槽、机制、数值或共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, hasStatus, inflictStatus, type CombatContext } from '../src/engine/action';
import type { CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';
import { calcHealAmount, roundRate, scaledValue } from '../src/engine/formulas';

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

const MISS_PURSUIT: Skill = {
  id: 'test_miss_pursuit',
  name: '测试必不中追击',
  type: 'pursuit',
  range: 5,
  triggerRate: 0,
  tags: ['damage'],
  output: [{ kind: 'physical_damage', rate: 100 }],
};

/** 读取七步释嫌对目标造成的下一次伤害降低状态 */
function qibuBoost(unit: UnitState) {
  return unit.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'qibu_shixian');
}

/** 七步释嫌减伤率；无状态时为 undefined */
function qibuRate(unit: UnitState): number | undefined {
  const s = qibuBoost(unit);
  return s && s.type === 'damage_boost' ? s.rate : undefined;
}

function qibuTriggers(ctx: CombatContext) {
  return ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'qibu_shixian');
}

/**
 * 测试用：覆盖恢复率（生产数据暂为 0，待验证后回填）。
 */
function forceQibuHeal(ctx: CombatContext, rate: number): void {
  const base = ctx.skills.get('qibu_shixian');
  if (!base || base.type !== 'command') {
    throw new Error('forceQibuHeal：七步释嫌未注册');
  }
  ctx.skills.set('qibu_shixian', {
    ...base,
    allyActEvery: {
      count: 7,
      output: [{ kind: 'heal', rate, strategyScaled: false, growthRate: 0, targetSide: 'ally', targetMode: 'group' }],
    },
  });
}

describe('七步释嫌（曹植，二类指挥：友军普攻/试图主动或追击叠下一次伤害降低，每 7 次恢复）', () => {
  it('主战法挂入指挥槽（曹植），二类指挥距离 5 我军全体，固定 -6%，charges 可叠加，恢复率 135% 成长 1.46', () => {
    const g = hero('h672');
    expect(g.name).toBe('曹植');
    expect(g.commandSkillIds).toContain('qibu_shixian');
    const s = SKILL_REGISTRY['qibu_shixian'] as CommandSkill;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('ally_act');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_boost', 'heal']);
    expect(s.allyActEvery?.count).toBe(7);
    const heal = s.allyActEvery?.output.find((o) => o.kind === 'heal');
    expect(heal && heal.kind === 'heal' && heal.rate).toBe(135);
    expect(heal && heal.kind === 'heal' && heal.growthRate).toBe(1.46);
    expect(heal && heal.kind === 'heal' && heal.strategyScaled).toBe(true);
    expect(heal && heal.kind === 'heal' && heal.targetMode).toBe('group');
    const boost = s.output.find((o) => o.kind === 'inflict_status');
    expect(
      boost &&
        boost.kind === 'inflict_status' &&
        !Array.isArray(boost.status) &&
        boost.status.type === 'damage_boost' &&
        boost.status.rate
    ).toBe(-0.06);
    expect(
      boost &&
        boost.kind === 'inflict_status' &&
        !Array.isArray(boost.status) &&
        boost.status.type === 'damage_boost' &&
        boost.status.charges
    ).toBe(1);
    expect(
      boost &&
        boost.kind === 'inflict_status' &&
        !Array.isArray(boost.status) &&
        boost.status.type === 'damage_boost' &&
        boost.status.chargesStack
    ).toBe(true);
    expect(boost && boost.kind === 'inflict_status' && boost.targetMode).toBe('random_single');
    expect(boost && boost.kind === 'inflict_status' && boost.targetSide).toBe('enemy');
  });

  it('普攻发动、试图主动、试图追击各触发一次；准备完成释放与施法者阵亡不触发', () => {
    const caozhi = makeUnit(withSkills(dummy('caozhi', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    const attacker = makeUnit(dummy('atk', '前锋', { attack: 200 }));
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([caozhi, attacker], [enemy]);

    actUnit(ctx, attacker);
    expect(qibuTriggers(ctx).length).toBe(1);
    const first = qibuBoost(enemy);
    expect(first && 'rate' in first && Math.abs(first.rate - -0.06) < 1e-9).toBe(true);
    expect(first && 'charges' in first && first.charges).toBe(1);

    // 怯战：无法普攻，但试图发动主动仍触发
    const caster2 = makeUnit(withSkills(dummy('caozhi2', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    const activeAtk = makeUnit(
      withSkills(dummy('atk2', '前锋'), { activeSkillIds: ['test_miss_active'] })
    );
    const enemy2 = makeUnit(dummy('e2', '前锋'), 'enemy');
    const ctx2 = makeCtx([caster2, activeAtk], [enemy2]);
    ctx2.skills.set('test_miss_active', MISS_ACTIVE);
    inflictStatus(ctx2, activeAtk, { type: 'cowardice', duration: 2 }, 'command', 'test_cowardice');
    actUnit(ctx2, activeAtk);
    expect(qibuTriggers(ctx2).length).toBe(1);
    expect(qibuRate(enemy2)).toBe(-0.06);

    // 普攻命中后试图追击：普攻 + 追击判定 = 2 次
    const caster3 = makeUnit(withSkills(dummy('caozhi3', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    const pursuer = makeUnit(withSkills(dummy('atk3', '前锋', { attack: 200 }), { pursuitSkillIds: ['test_miss_pursuit'] }));
    const enemy3 = makeUnit(dummy('e3', '前锋'), 'enemy');
    const ctx3 = makeCtx([caster3, pursuer], [enemy3]);
    ctx3.skills.set('test_miss_pursuit', MISS_PURSUIT);
    actUnit(ctx3, pursuer);
    expect(qibuTriggers(ctx3).length).toBe(2);
    expect(qibuRate(enemy3)).toBeCloseTo(-0.12);

    // 准备完成自动释放：不做主动发动率判定，不触发
    const prepCaster = makeUnit(withSkills(dummy('caozhi4', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    const prepAtk = makeUnit(withSkills(dummy('atk4', '前锋'), { activeSkillIds: ['test_prep_active'] }));
    prepAtk.isPreparing = true;
    prepAtk.preparingSkillId = 'test_prep_active';
    const prepEnemy = makeUnit(dummy('e4', '前锋'), 'enemy');
    const prepCtx = makeCtx([prepCaster, prepAtk], [prepEnemy]);
    prepCtx.skills.set('test_prep_active', PREP_ACTIVE);
    inflictStatus(prepCtx, prepAtk, { type: 'cowardice', duration: 2 }, 'command', 'test_cowardice');
    actUnit(prepCtx, prepAtk);
    expect(qibuTriggers(prepCtx).length).toBe(0);

    // 施法者阵亡：二类指挥失效
    const dead = makeUnit(withSkills(dummy('caozhi5', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    dead.alive = false;
    dead.troops = 0;
    const deadAtk = makeUnit(dummy('atk5', '前锋', { attack: 200 }));
    const deadEnemy = makeUnit(dummy('e5', '前锋'), 'enemy');
    const deadCtx = makeCtx([dead, deadAtk], [deadEnemy]);
    actUnit(deadCtx, deadAtk);
    expect(qibuTriggers(deadCtx).length).toBe(0);
  });

  it('同目标叠层累加、打出后清空；每 7 次进入恢复且恢复量随施法者实时兵力变化', () => {
    // 曹植独自上场：普攻由自己发动，敌军反击目标唯一，避免范围内随机打到其他友军
    const caozhi = makeUnit(
      withSkills(dummy('caozhi', '前锋', { strategy: 80, attack: 80 }), { commandSkillIds: ['qibu_shixian'] })
    );
    const enemy = makeUnit(dummy('e1', '前锋', { attack: 200 }), 'enemy');
    const ctx = makeCtx([caozhi], [enemy]);

    actUnit(ctx, caozhi);
    expect(qibuRate(enemy)).toBe(-0.06);
    caozhi.hasActedThisRound = false;
    ctx.currentRound = 2;
    actUnit(ctx, caozhi);
    const stacked = qibuBoost(enemy);
    expect(qibuRate(enemy)).toBeCloseTo(-0.12);
    expect(stacked && stacked.type === 'damage_boost' && stacked.stacks).toBe(2);

    const troopsBefore = caozhi.troops;
    enemy.hasActedThisRound = false;
    actUnit(ctx, enemy);
    expect(qibuBoost(enemy)).toBeUndefined();
    expect(caozhi.troops).toBeLessThan(troopsBefore);

    // 再打一次不再吃层数（与叠层后第一次伤害对比：第二次应更高）
    const afterClear = caozhi.troops;
    enemy.hasActedThisRound = false;
    ctx.currentRound = 3;
    actUnit(ctx, enemy);
    const dmg1 = troopsBefore - afterClear;
    const dmg2 = afterClear - caozhi.troops;
    expect(dmg2).toBeGreaterThan(dmg1);

    // 每 7 次恢复：覆盖恢复率锁定实时兵力公式（与谋略缩放解耦，只比兵力）
    const h1 = makeUnit(withSkills(dummy('c1', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    const a1 = makeUnit(dummy('a1', '前锋', { attack: 80 }));
    const eA = makeUnit(dummy('ea', '前锋'), 'enemy');
    h1.troops = 5000;
    a1.troops = 5000;
    const ctxA = makeCtx([h1, a1], [eA], 2);
    forceQibuHeal(ctxA, 135);
    for (let i = 0; i < 7; i++) {
      a1.hasActedThisRound = false;
      ctxA.currentRound = i + 1;
      actUnit(ctxA, a1);
    }
    const healsA = ctxA.events.filter((e) => e.type === 'heal' && e.skillId === 'qibu_shixian');
    expect(healsA.length).toBe(2);
    expect(ctxA.allyActCounters?.get('c1:qibu_shixian')).toBe(7);

    const h2 = makeUnit(withSkills(dummy('c2', '大营'), { commandSkillIds: ['qibu_shixian'] }));
    const a2 = makeUnit(dummy('a2', '前锋', { attack: 80 }));
    const eB = makeUnit(dummy('eb', '前锋'), 'enemy');
    h2.troops = 2000;
    a2.troops = 5000;
    const ctxB = makeCtx([h2, a2], [eB], 2);
    forceQibuHeal(ctxB, 135);
    for (let i = 0; i < 7; i++) {
      a2.hasActedThisRound = false;
      ctxB.currentRound = i + 1;
      actUnit(ctxB, a2);
    }
    const healsB = ctxB.events.filter((e) => e.type === 'heal' && e.skillId === 'qibu_shixian');
    expect(healsB.length).toBe(2);
    const sum = (evts: typeof healsA) => evts.reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0);
    expect(sum(healsA)).toBeGreaterThan(sum(healsB));
    // 同侧距离：自身最近，群体先治施法者再治友军；第二段按治疗后的实时兵力结算
    const sequentialHeal = (troops: number) => {
      const first = calcHealAmount(troops, 135);
      return first + calcHealAmount(troops + first, 135);
    };
    expect(sum(healsA)).toBe(sequentialHeal(5000));
    expect(sum(healsB)).toBe(sequentialHeal(2000));

    // 战报样本：谋略 213 → 329%；3263 兵 → 477（3088 兵引擎 463）
    const rate213 = roundRate(scaledValue(135, 1.46, 213));
    expect(rate213).toBe(329);
    expect(calcHealAmount(3263, rate213)).toBe(477);
    expect(calcHealAmount(3088, rate213)).toBe(463);
  });
});
