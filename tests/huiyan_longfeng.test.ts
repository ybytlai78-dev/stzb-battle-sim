/**
 * 徽言龙凤（司马徽·群步 h811·指挥 S）——士气 / 策略伤害成长率 + 友军目标不含自身
 *
 * 包内 tb_cfg_skill_detail：
 *  · 21229401（effect 113 士气提升）intel_param = 10 / constant_param = 6 / init_effect_ratio = 50
 *    → 值@80 = 6 + 0.4×10 = 10、成长率 = 10/200 = 0.05/点谋略；
 *  · 21229402（effect 531 造成伤害提高）intel 10 / const 3 → 7%、成长 0.05/点（已接线）；
 *  · 21329402（effect 302 策略伤害）intel 100 / const 80 → 120%、成长 0.5/点
 *    （已接线到 `recipientDamageByHigherStat.strategyGrowthRate`）。
 *
 * 本测试锁三段：
 *  · 士气：阈值激活后按施法者生效谋略缩放，80 → 10、200 → 16（Math.round 点数取整）；
 *  · 策略伤害：代打者谋略 80 → 120%、200 → 180%，按 1% 八舍九入；
 *  · 目标：所有「友军全体」段都不含施法者自身（士气 / 增伤 / 代打伤害）。
 */
import { describe, it, expect } from 'vitest';
import {
  applyDamage,
  effectiveMorale,
  getStatus,
  inflictStatus,
  tickRoundStartStatuses,
} from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';
import { calcDamage } from '../src/engine/formulas';

type CommandSkill = Extract<(typeof SKILL_REGISTRY)[string], { type: 'command' }>;

function dummy(
  id: string,
  position: Position,
  strategy: number,
  overrides: Partial<General> = {}
): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...overrides,
  };
}

function makeUnit(id: string, side: 'my' | 'enemy', strategy: number, position: Position): UnitState {
  return {
    general: dummy(id, position, strategy),
    side,
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(caster: UnitState, ally: UnitState, enemy: UnitState): CombatContext {
  const ctx: CombatContext = {
    rng: new Rng(1),
    myTeam: [caster, ally],
    enemyTeam: [enemy],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  ctx.lockedCommands.push({
    skill: SKILL_REGISTRY['huiyan_longfeng'] as CommandSkill,
    casterId: caster.general.id,
    targets: [caster, ally],
    currentRate: 1,
  });
  return ctx;
}

/**
 * 触发 6 次实际扣兵 → 全队累计伤害门槛激活 → 结算士气段。
 * 计数按「友军全体」口径，不含施法者自身，因此伤害来源必须是友军。
 */
function triggerThreshold(ctx: CombatContext, ally: UnitState, enemy: UnitState): void {
  for (let i = 0; i < 6; i++) applyDamage(ctx, enemy, 100, ally);
}

function moraleDetail(ctx: CombatContext, unitId: string): string {
  return ctx.events.find(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === 'morale_boost' && e.unitId === unitId
  )?.detail ?? '';
}

/**
 * 只打策略伤害轨：去掉增伤段、把 60% 改成 100%，且只让友军代打一次，
 * 这样事件伤害可直接与 `calcDamage({ damageType:'strategy', rate })` 对拍。
 * 施法者自身被 `excludeSelf` 排除，代打者是 ally。
 */
function strategyHitDamage(strategy: number): number {
  const caster = makeUnit('caster', 'my', 60, '大营');
  const ally = makeUnit('ally', 'my', strategy, '前锋');
  const enemy = makeUnit('enemy', 'enemy', 60, '前锋');
  const ctx = makeCtx(caster, ally, enemy);
  const skill = structuredClone(ctx.lockedCommands[0].skill) as CommandSkill;
  const dmg = skill.roundStartRepeat!.output[1];
  if (dmg.kind !== 'physical_damage') throw new Error('unreachable');
  dmg.chance = 1;
  skill.roundStartRepeat!.output = [dmg];
  ctx.lockedCommands[0].skill = skill;
  ctx.lockedCommands[0].targets = [caster, ally];
  triggerThreshold(ctx, ally, enemy);
  tickRoundStartStatuses(ctx);
  const ev = ctx.events.find(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.skillId === 'huiyan_longfeng' && e.sourceId === 'ally'
  );
  if (!ev) throw new Error('徽言龙凤策略伤害未结算');
  return ev.damage;
}

function expectedStrategyDamage(strategy: number, rate: number): number {
  return calcDamage(
    {
      damageType: 'strategy',
      rate,
      attackerAttack: 80,
      attackerStrategy: strategy,
      attackerTroops: 10000,
      targetDefense: 80,
      targetStrategy: 60,
      mult: 1,
    },
    new Rng(1)
  ).damage;
}

describe('徽言龙凤·成长率（包内 21229401 / 21329402）', () => {
  it('数据：士气段带 strategyScaled + growthRate 0.05（值@80 = 10），且友军全体排除自身', () => {
    const skill = SKILL_REGISTRY['huiyan_longfeng'] as CommandSkill;
    const status = skill.teamDamageThreshold!.output[0];
    expect(status.kind).toBe('inflict_status');
    if (status.kind !== 'inflict_status') throw new Error('unreachable');
    expect(status).toMatchObject({
      targetSide: 'ally',
      targetMode: 'all',
      excludeSelf: true,
    });
    expect(status.status).toMatchObject({
      type: 'morale_boost',
      amount: 10,
      strategyScaled: true,
      growthRate: 0.05,
    });
  });

  it('数据：策略伤害轨带 strategyGrowthRate 0.5（值@80 = 120），代打池排除自身', () => {
    const skill = SKILL_REGISTRY['huiyan_longfeng'] as CommandSkill;
    const out = skill.roundStartRepeat!.output[1];
    expect(out.kind).toBe('physical_damage');
    if (out.kind !== 'physical_damage') throw new Error('unreachable');
    expect(out.excludeSelf).toBe(true);
    expect(out.recipientDamageByHigherStat).toMatchObject({
      attackRate: 150,
      strategyRate: 120,
      strategyGrowthRate: 0.5,
    });
  });

  it('谋略 80：只给友军挂士气 +10，施法者自身不获得（effectiveMorale 100）', () => {
    const caster = makeUnit('caster', 'my', 80, '大营');
    const ally = makeUnit('ally', 'my', 60, '前锋');
    const enemy = makeUnit('enemy', 'enemy', 60, '前锋');
    const ctx = makeCtx(caster, ally, enemy);

    triggerThreshold(ctx, ally, enemy);

    expect(getStatus(caster, 'morale_boost')).toBeUndefined();
    expect(getStatus(ally, 'morale_boost')!.amount).toBe(10);
    expect(effectiveMorale(caster)).toBe(100);
    expect(effectiveMorale(ally)).toBe(110);
    expect(moraleDetail(ctx, 'caster')).toBe('');
    expect(moraleDetail(ctx, 'ally')).toContain('士气 +10（110）');
  });

  it('谋略 200：只给友军士气 +16（10 + 0.05×(200−80)），施法者自身不获得', () => {
    const caster = makeUnit('caster', 'my', 200, '大营');
    const ally = makeUnit('ally', 'my', 60, '前锋');
    const enemy = makeUnit('enemy', 'enemy', 60, '前锋');
    const ctx = makeCtx(caster, ally, enemy);

    triggerThreshold(ctx, ally, enemy);

    expect(getStatus(caster, 'morale_boost')).toBeUndefined();
    expect(getStatus(ally, 'morale_boost')!.amount).toBe(16);
    expect(effectiveMorale(caster)).toBe(100);
    expect(effectiveMorale(ally)).toBe(116);
    expect(moraleDetail(ctx, 'ally')).toContain('士气 +16（116）');
  });

  it('缩放不影响共存口径：徽言龙凤（受谋略）+ 谋议宏图（固定 8）在友军身上相加', () => {
    const caster = makeUnit('caster', 'my', 200, '大营');
    const ally = makeUnit('ally', 'my', 60, '前锋');
    const enemy = makeUnit('enemy', 'enemy', 60, '前锋');
    const ctx = makeCtx(caster, ally, enemy);

    triggerThreshold(ctx, ally, enemy);
    inflictStatus(
      ctx,
      ally,
      { type: 'morale_boost', amount: 8, duration: 999, stack: true },
      'command',
      'mouyi_hongtu'
    );

    expect(ally.statuses.filter((s) => s.type === 'morale_boost')).toHaveLength(2);
    expect(effectiveMorale(ally)).toBe(124); // 100 + 16（徽言龙凤）+ 8（谋议宏图）
    expect(effectiveMorale(caster)).toBe(100);
  });

  it('增加伤害 / 代打伤害都不作用于施法者自身', () => {
    const caster = makeUnit('caster', 'my', 80, '大营');
    const ally = makeUnit('ally', 'my', 60, '前锋');
    const enemy = makeUnit('enemy', 'enemy', 60, '前锋');
    const ctx = makeCtx(caster, ally, enemy);
    const skill = structuredClone(ctx.lockedCommands[0].skill) as CommandSkill;
    const dmg = skill.roundStartRepeat!.output[1];
    if (dmg.kind !== 'physical_damage') throw new Error('unreachable');
    dmg.chance = 1;
    skill.roundStartRepeat!.output = [skill.roundStartRepeat!.output[0], dmg];
    ctx.lockedCommands[0].skill = skill;

    triggerThreshold(ctx, ally, enemy);
    tickRoundStartStatuses(ctx);

    expect(getStatus(caster, 'damage_boost')).toBeUndefined();
    expect(getStatus(ally, 'damage_boost')).not.toBeNull();
    expect(
      ctx.events.some(
        (e) => e.type === 'damage' && e.skillId === 'huiyan_longfeng' && e.sourceId === 'caster'
      )
    ).toBe(false);
    expect(
      ctx.events.some(
        (e) => e.type === 'damage' && e.skillId === 'huiyan_longfeng' && e.sourceId === 'ally'
      )
    ).toBe(true);
  });

  it('施法者自身造成的伤害不计入「友军全体共计 6 次伤害」门槛', () => {
    const caster = makeUnit('caster', 'my', 80, '大营');
    const ally = makeUnit('ally', 'my', 60, '前锋');
    const enemy = makeUnit('enemy', 'enemy', 60, '前锋');
    const ctx = makeCtx(caster, ally, enemy);

    for (let i = 0; i < 6; i++) applyDamage(ctx, enemy, 100, caster);
    expect(getStatus(ally, 'morale_boost')).toBeUndefined();

    for (let i = 0; i < 6; i++) applyDamage(ctx, enemy, 100, ally);
    expect(getStatus(ally, 'morale_boost')!.amount).toBe(10);
  });

  it('策略伤害：谋略 80 → 120%；200 → 180%（0.5/点，按代打者谋略）', () => {
    expect(strategyHitDamage(80)).toBe(expectedStrategyDamage(80, 120));
    expect(strategyHitDamage(200)).toBe(expectedStrategyDamage(200, 180));
  });
});
