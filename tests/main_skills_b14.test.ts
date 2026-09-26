/**
 * 批量14 主战法测试：受击触发（onHurt）
 * 盲侯奋勇（夏侯惇）/ 陷储立齐（骊姬）/ 同仇敌忾（鲁肃）/ 缓师徐持（沮授）
 * 每战法 3 个测试：装配挂槽、机制、数值或共存。
 * 同仇敌忾增减伤成长率：调研无条目，按用户确认暂用 0.01/点（谋略 80→2%、180→3%/层）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { applyDamage, triggerCommandSkills, triggerPassiveSkills, type CombatContext } from '../src/engine/action';
import { firstOnHurt, type BattleEvent, type CommandSkill, type General, type PassiveSkill, type Position, type Skill, type UnitState } from '../src/engine/types';
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
    attackRange: 2,
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
    preparations: [],
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

const inflicted = (ctx: CombatContext, statusType: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

describe('盲侯奋勇（夏侯惇，一类指挥：自身受伤后 40% 对距离 4 内敌军群体攻击 60%）', () => {
  it('主战法挂入指挥槽（夏侯惇），一类指挥距离 4 群体 2，发动率 40%', () => {
    const g = hero('h449');
    expect(g.name).toBe('夏侯惇');
    expect(g.commandSkillIds).toContain('manghou_fenyong');
    const s = SKILL_REGISTRY['manghou_fenyong'];
    expect(s.type).toBe('command');
    if (s.type === 'command') {
      expect(s.phase).toBe('prep');
      expect(s.range).toBe(4);
      expect(s.targetMode).toBe('group');
      expect(s.groupCount ?? 2).toBe(2);
      expect(firstOnHurt(s.onHurt)?.victim).toBe('self');
      expect(firstOnHurt(s.onHurt)?.rate).toBe(0.4);
      expect(firstOnHurt(s.onHurt)?.applyTo).toBe('skill_targets');
    }
    expect(s.tags).toEqual(['damage']);
    const dmg = s.output.find((o) => o.kind === 'physical_damage');
    expect(dmg && dmg.kind === 'physical_damage' && dmg.rate).toBe(60);
  });

  it('自身受伤后对距离 4 内敌军群体发动一次攻击（伤害率 60%）', () => {
    const xiah = makeUnit(withSkills(dummy('xiah', '前锋', { attack: 120 }), { commandSkillIds: ['manghou_fenyong'] }));
    const ally = makeUnit(dummy('ally', '中军'));
    const e1 = makeUnit(dummy('e1', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e2', '中军'), 'enemy');
    const e3 = makeUnit(dummy('e3', '大营'), 'enemy');
    const ctx = makeCtx([xiah, ally], [e1, e2, e3]);
    forceOnHurtRate(ctx, 'manghou_fenyong');
    triggerCommandSkills(ctx, xiah);

    applyDamage(ctx, xiah, 100, e1);

    const dmg = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '盲侯奋勇');
    expect(dmg.length).toBe(2);
    for (const d of dmg) {
      expect(d.type === 'damage' && d.damageType === 'physical').toBe(true);
      expect(d.type === 'damage' && d.sourceId).toBe('xiah');
      expect(d.type === 'damage' && (d.targetId === 'e1' || d.targetId === 'e2' || d.targetId === 'e3')).toBe(true);
    }
  });

  it('反击造成的伤害不再触发受击（防循环）：一次受伤只反击一次', () => {
    const xiah = makeUnit(withSkills(dummy('xiah', '前锋', { attack: 120 }), { commandSkillIds: ['manghou_fenyong'] }));
    const e1 = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([xiah], [e1]);
    forceOnHurtRate(ctx, 'manghou_fenyong');
    triggerCommandSkills(ctx, xiah);

    applyDamage(ctx, xiah, 50, e1);
    const dmg = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '盲侯奋勇');
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.length).toBeLessThanOrEqual(2);
  });
});

describe('陷储立齐（骊姬，一类指挥：我军每单位每回合首次受伤，随机吸取来源攻/防/谋 70 持续 2 回合）', () => {
  it('主战法挂入指挥槽（骊姬），一类指挥友军全体距离 5', () => {
    const g = hero('h377');
    expect(g.name).toBe('骊姬');
    expect(g.commandSkillIds).toContain('xianchu_liqi');
    const s = SKILL_REGISTRY['xianchu_liqi'] as CommandSkill;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('all');
    expect(firstOnHurt(s.onHurt)?.victim).toBe('ally');
    expect(firstOnHurt(s.onHurt)?.oncePerRound).toBe(true);
    expect(firstOnHurt(s.onHurt)?.applyTo).toBe('steal');
    expect(firstOnHurt(s.onHurt)?.steal?.amount).toBe(70);
    expect(firstOnHurt(s.onHurt)?.steal?.duration).toBe(2);
    expect(s.tags).toEqual(['attack_buff', 'defense_buff', 'strategy_buff', 'debuff_attack', 'debuff_defense', 'debuff_strategy']);
  });

  it('友军首次受伤后，随机一维：来源 -70、受伤者 +70，持续 2 回合', () => {
    const li = makeUnit(withSkills(dummy('liji', '中军'), { commandSkillIds: ['xianchu_liqi'] }));
    const ally = makeUnit(dummy('ally', '前锋'));
    const src = makeUnit(dummy('src', '前锋', { attack: 100, defense: 100, strategy: 100 }), 'enemy');
    const ctx = makeCtx([li, ally], [src]);
    triggerCommandSkills(ctx, li);

    applyDamage(ctx, ally, 80, src);

    const STATS = ['attack_buff', 'defense_buff', 'strategy_buff'] as const;
    const plus = ally.statuses.filter((s) => STATS.includes(s.type as (typeof STATS)[number]) && 'amount' in s && s.amount > 0);
    const minus = src.statuses.filter((s) => STATS.includes(s.type as (typeof STATS)[number]) && 'amount' in s && s.amount < 0);
    expect(plus.length).toBe(1);
    expect(minus.length).toBe(1);
    expect(plus[0].type).toBe(minus[0].type);
    expect('amount' in plus[0] && plus[0].amount).toBe(70);
    expect('amount' in minus[0] && minus[0].amount).toBe(-70);
    expect('remaining' in plus[0] && plus[0].remaining).toBe(2);
  });

  it('同一单位同一回合第二次受伤不再吸取', () => {
    const li = makeUnit(withSkills(dummy('liji', '中军'), { commandSkillIds: ['xianchu_liqi'] }));
    const ally = makeUnit(dummy('ally', '前锋'));
    const src = makeUnit(dummy('src', '前锋'), 'enemy');
    const ctx = makeCtx([li, ally], [src]);
    triggerCommandSkills(ctx, li);

    applyDamage(ctx, ally, 50, src);
    applyDamage(ctx, ally, 50, src);

    const STATS = ['attack_buff', 'defense_buff', 'strategy_buff'] as const;
    const plus = ally.statuses.filter((s) => STATS.includes(s.type as (typeof STATS)[number]) && 'amount' in s && s.amount > 0);
    expect(plus).toHaveLength(1);
    expect('amount' in plus[0] && plus[0].amount).toBe(70);
  });
});

describe('同仇敌忾（鲁肃，被动：友军受伤后距离≤1 友军含自己 +2%造成/−2%受到，最多 8 层；成长率 0.01）', () => {
  it('主战法挂入被动槽（鲁肃），被动距离 3，成长率 0.01，最多 8 层', () => {
    const g = hero('h741');
    expect(g.name).toBe('鲁肃');
    expect(g.passiveSkillIds).toContain('tongchou_dikai');
    const s = SKILL_REGISTRY['tongchou_dikai'] as PassiveSkill;
    expect(s.type).toBe('passive');
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(3);
    expect(firstOnHurt(s.onHurt)?.victim).toBe('ally');
    expect(firstOnHurt(s.onHurt)?.applyTo).toBe('allies_within');
    expect(firstOnHurt(s.onHurt)?.withinDistance).toBe(1);
    expect(firstOnHurt(s.onHurt)?.maxStacks).toBe(8);
    expect(s.tags).toEqual(['damage_boost', 'damage_reduce']);
    const boost = s.output.find((o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'damage_boost');
    const reduce = s.output.find((o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'damage_reduce');
    expect(boost && boost.kind === 'inflict_status' && !Array.isArray(boost.status) && boost.status.type === 'damage_boost' && boost.status.rate).toBe(0.02);
    expect(boost && boost.kind === 'inflict_status' && !Array.isArray(boost.status) && boost.status.type === 'damage_boost' && boost.status.growthRate).toBe(0.01);
    expect(reduce && reduce.kind === 'inflict_status' && !Array.isArray(reduce.status) && reduce.status.type === 'damage_reduce' && reduce.status.rate).toBe(0.02);
    expect(reduce && reduce.kind === 'inflict_status' && !Array.isArray(reduce.status) && reduce.status.type === 'damage_reduce' && reduce.status.growthRate).toBe(0.01);
  });

  it('前锋受伤：自身与中军叠层，大营距离 2 不叠', () => {
    const lu = makeUnit(withSkills(dummy('lusu', '中军', { strategy: 80 }), { passiveSkillIds: ['tongchou_dikai'] }));
    const front = makeUnit(dummy('front', '前锋'));
    const back = makeUnit(dummy('back', '大营'));
    const src = makeUnit(dummy('src', '前锋'), 'enemy');
    const ctx = makeCtx([front, lu, back], [src]);
    triggerPassiveSkills(ctx, lu, 'battle_start');

    applyDamage(ctx, front, 80, src);

    const boostOf = (u: UnitState) =>
      u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'tongchou_dikai');
    const stacksOf = (u: UnitState) => {
      const s = boostOf(u);
      return s && 'stacks' in s ? s.stacks : undefined;
    };
    expect(stacksOf(front)).toBe(1);
    expect(stacksOf(lu)).toBe(1);
    expect(boostOf(back)).toBeUndefined();
    expect(front.statuses.some((s) => s.type === 'damage_reduce' && s.sourceSkillId === 'tongchou_dikai')).toBe(true);
  });

  it('谋略 80 每层 2%；最多 8 层后不再叠加', () => {
    const lu = makeUnit(withSkills(dummy('lusu', '前锋', { strategy: 80 }), { passiveSkillIds: ['tongchou_dikai'] }));
    const src = makeUnit(dummy('src', '前锋'), 'enemy');
    const ctx = makeCtx([lu], [src]);
    triggerPassiveSkills(ctx, lu, 'battle_start');

    for (let i = 0; i < 9; i++) applyDamage(ctx, lu, 10, src);

    const boost = lu.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'tongchou_dikai');
    expect(boost && 'stacks' in boost && boost.stacks).toBe(8);
    expect(boost && 'rate' in boost && Math.abs(boost.rate - 0.16) < 1e-9).toBe(true);
    const reduce = lu.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === 'tongchou_dikai');
    expect(reduce && 'rate' in reduce && Math.abs(reduce.rate - 0.16) < 1e-9).toBe(true);
  });
});

describe('缓师徐持（沮授，一类指挥：已行动敌军受伤后 50% 受谋略，四维 -20，独立两次，可叠到结束）', () => {
  it('主战法挂入指挥槽（沮授），一类指挥自己距离 5，触发率 50% 受谋略', () => {
    const g = hero('h771');
    expect(g.name).toBe('沮授');
    expect(g.commandSkillIds).toContain('huanshi_xuchi');
    const s = SKILL_REGISTRY['huanshi_xuchi'] as CommandSkill;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(firstOnHurt(s.onHurt)?.victim).toBe('enemy');
    expect(firstOnHurt(s.onHurt)?.rate).toBe(0.5);
    expect(firstOnHurt(s.onHurt)?.rateStrategyScaled).toBe(true);
    expect(firstOnHurt(s.onHurt)?.onlyIfActed).toBe(true);
    expect(firstOnHurt(s.onHurt)?.rolls).toBe(2);
    expect(firstOnHurt(s.onHurt)?.applyTo).toBe('victim');
    expect(s.tags).toEqual(['debuff_attack', 'debuff_defense', 'debuff_strategy', 'debuff_speed']);
  });

  it('已行动敌军受伤后独立判定两次，成功则攻防谋速 -20，可叠加', () => {
    const ju = makeUnit(withSkills(dummy('jushou', '中军', { strategy: 80 }), { commandSkillIds: ['huanshi_xuchi'] }));
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    enemy.hasActedThisRound = true;
    const src = makeUnit(dummy('src', '前锋'));
    const ctx = makeCtx([ju, src], [enemy]);
    forceOnHurtRate(ctx, 'huanshi_xuchi');
    triggerCommandSkills(ctx, ju);

    applyDamage(ctx, enemy, 80, src);

    const amt = (type: string) => {
      const s = enemy.statuses.find((st) => st.type === type && st.sourceSkillId === 'huanshi_xuchi');
      return s && 'amount' in s ? s.amount : 0;
    };
    // rate=1 两次均成功 → 各维 -40
    expect(amt('attack_buff')).toBe(-40);
    expect(amt('defense_buff')).toBe(-40);
    expect(amt('strategy_buff')).toBe(-40);
    expect(amt('speed_buff')).toBe(-40);
    expect(inflicted(ctx, 'attack_buff').length).toBeGreaterThan(0);
  });

  it('本回合尚未行动的敌军受伤不触发', () => {
    const ju = makeUnit(withSkills(dummy('jushou', '中军'), { commandSkillIds: ['huanshi_xuchi'] }));
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    enemy.hasActedThisRound = false;
    const src = makeUnit(dummy('src', '前锋'));
    const ctx = makeCtx([ju, src], [enemy]);
    forceOnHurtRate(ctx, 'huanshi_xuchi');
    triggerCommandSkills(ctx, ju);

    applyDamage(ctx, enemy, 80, src);

    expect(enemy.statuses.filter((s) => s.sourceSkillId === 'huanshi_xuchi')).toHaveLength(0);
  });
});

describe('同仇敌忾成长率 0.01（谋略 180 → 每层 3%）', () => {
  it('谋略 180 时一层造成伤害提高 3%、受到伤害降低 3%', () => {
    const lu = makeUnit(withSkills(dummy('lusu', '前锋', { strategy: 180 }), { passiveSkillIds: ['tongchou_dikai'] }));
    const src = makeUnit(dummy('src', '前锋'), 'enemy');
    const ctx = makeCtx([lu], [src]);
    triggerPassiveSkills(ctx, lu, 'battle_start');
    applyDamage(ctx, lu, 10, src);

    const boost = lu.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'tongchou_dikai');
    const reduce = lu.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === 'tongchou_dikai');
    expect(boost && 'rate' in boost && Math.abs(boost.rate - 0.03) < 1e-9).toBe(true);
    expect(reduce && 'rate' in reduce && Math.abs(reduce.rate - 0.03) < 1e-9).toBe(true);
  });
});
