/**
 * 批量18 主战法测试：怀德畏威（司马昭）
 * 新机制：
 *  - physical_damage.attacker:'lowest_strategy_ally'——借谋略最低友军打随机敌军单体
 *    （用友军攻击/兵力/造成侧增伤，creditToId 归施法者，不耗友军行动、不受混乱拦截）
 *  - inflict_status.onlyIfOverlapPrevious——仅对「上两段伤害目标重合」的敌军上混乱
 * 每战法 3 个测试：装配挂槽、机制、数值或共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, hasStatus, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, SimpleActiveSkill, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';
import { calcDamage, roundRate, scaledValue } from '../src/engine/formulas';

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

/**
 * 将怀德畏威发动率改为指定值，便于确定性机制断言。
 */
function forceHuaideRate(ctx: CombatContext, rate: number): SimpleActiveSkill {
  const base = ctx.skills.get('huaide_weiwei');
  if (!base || base.type !== 'active' || base.prepare !== false) {
    throw new Error('forceHuaideRate：怀德畏威未注册');
  }
  const forced: SimpleActiveSkill = { ...base, triggerRate: rate };
  ctx.skills.set('huaide_weiwei', forced);
  return forced;
}

function huaideDamage(ctx: CombatContext) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'huaide_weiwei'
  );
}

describe('怀德畏威（司马昭，主动：借谋略最低友军攻击 + 自身群体策略 + 重合混乱）', () => {
  it('主战法挂入主动槽（司马昭），距离 5，40% 发动，友军借出手 + 群体策略 2 + 重合混乱', () => {
    const g = hero('h702');
    expect(g.name).toBe('司马昭');
    expect(g.activeSkillIds).toContain('huaide_weiwei');
    const s = SKILL_REGISTRY['huaide_weiwei'] as SimpleActiveSkill;
    expect(s.type).toBe('active');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetMode).toBe('group');
    expect(s.targetSide).toBe('enemy');
    expect(s.groupCount).toBe(2);
    expect(s.tags).toEqual(['damage', 'confusion']);
    const phys = s.output.find((o) => o.kind === 'physical_damage');
    const strat = s.output.find((o) => o.kind === 'strategy_damage');
    const ctrl = s.output.find((o) => o.kind === 'inflict_status');
    expect(phys && phys.kind === 'physical_damage' && phys.rate).toBe(160);
    expect(phys && phys.kind === 'physical_damage' && phys.attacker).toBe('lowest_strategy_ally');
    expect(phys && phys.kind === 'physical_damage' && phys.targetMode).toBe('random_single');
    expect(strat && strat.kind === 'strategy_damage' && strat.rate).toBe(160);
    expect(strat && strat.kind === 'strategy_damage' && strat.strategyScaled).toBe(true);
    expect(strat && strat.kind === 'strategy_damage' && strat.growthRate).toBe(1.75);
    expect(strat && strat.kind === 'strategy_damage' && strat.groupCount).toBe(2);
    expect(
      ctrl &&
        ctrl.kind === 'inflict_status' &&
        !Array.isArray(ctrl.status) &&
        ctrl.status.type === 'confusion' &&
        ctrl.status.duration
    ).toBe(1);
    expect(ctrl && ctrl.kind === 'inflict_status' && ctrl.onlyIfOverlapPrevious).toBe(true);
  });

  it('谋略最低友军出手（混乱不拦截），杀伤归属司马昭；单敌军时两段重合上混乱', () => {
    const caster = makeUnit(
      withSkills(dummy('simazhao', '中军', { strategy: 200, attack: 40, speed: 30 }), {
        activeSkillIds: ['huaide_weiwei'],
      })
    );
    const low = makeUnit(dummy('ally-low', '前锋', { strategy: 40, attack: 200, speed: 80 }));
    const high = makeUnit(dummy('ally-high', '大营', { strategy: 120, attack: 300, speed: 90 }));
    const enemy = makeUnit(dummy('e1', '前锋'), 'enemy');
    const ctx = makeCtx([caster, low, high], [enemy]);
    inflictStatus(ctx, low, { type: 'confusion', duration: 2 }, 'active', 'test_confuse');
    forceHuaideRate(ctx, 1);

    actUnit(ctx, caster);

    const phys = huaideDamage(ctx).filter((e) => e.damageType === 'physical');
    expect(phys.length).toBe(1);
    expect(phys[0].sourceId).toBe('ally-low');
    expect(phys[0].creditToId).toBe('simazhao');
    expect(phys[0].targetId).toBe('e1');
    expect(huaideDamage(ctx).some((e) => e.damageType === 'strategy' && e.sourceId === 'simazhao')).toBe(true);
    expect(hasStatus(enemy, 'confusion')).toBe(true);
  });

  it('无存活友军时跳过攻击段、策略照打、不上混乱；谋略 180 策略伤害高于 80', () => {
    const at80 = makeUnit(
      withSkills(dummy('s80', '中军', { strategy: 80, attack: 40 }), {
        activeSkillIds: ['huaide_weiwei'],
      })
    );
    const e80 = makeUnit(dummy('e80', '前锋'), 'enemy');
    const ctx80 = makeCtx([at80], [e80]);
    forceHuaideRate(ctx80, 1);
    actUnit(ctx80, at80);
    const hits80 = huaideDamage(ctx80);
    expect(hits80.filter((e) => e.damageType === 'physical').length).toBe(0);
    const strat80 = hits80.find((e) => e.damageType === 'strategy');
    expect(strat80?.sourceId).toBe('s80');
    expect(hasStatus(e80, 'confusion')).toBe(false);

    const at180 = makeUnit(
      withSkills(dummy('s180', '中军', { strategy: 180, attack: 40 }), {
        activeSkillIds: ['huaide_weiwei'],
      })
    );
    const e180 = makeUnit(dummy('e180', '前锋'), 'enemy');
    const ctx180 = makeCtx([at180], [e180], 1);
    forceHuaideRate(ctx180, 1);
    actUnit(ctx180, at180);
    const strat180 = huaideDamage(ctx180).find((e) => e.damageType === 'strategy');
    expect(strat80 && strat180 && strat180.damage > strat80.damage).toBe(true);
    expect(hasStatus(e180, 'confusion')).toBe(false);

    // 战报反推：兵力 5905 / 谋略 222 / 目标谋略 78 → 有效率 408%（160+1.75×142 八舍九入）
    // 引擎三部分分别取整 = 851（战报 850，差 1）
    const rate = roundRate(scaledValue(160, 1.75, 222));
    expect(rate).toBe(408);
    const { damage } = calcDamage(
      {
        damageType: 'strategy',
        rate,
        attackerAttack: 80,
        attackerStrategy: 222,
        attackerTroops: 5905,
        targetDefense: 80,
        targetStrategy: 78,
        mult: 1,
      },
      new Rng(1)
    );
    expect(damage).toBe(851);
  });
});
