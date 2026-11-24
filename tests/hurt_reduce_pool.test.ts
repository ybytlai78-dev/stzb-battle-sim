/**
 * 用户 2026-11-23 报障回归（两条）：
 * ① 魏延【奇兵拒北】的站位伤害（`positional_physical_damage`）此前**完全穿透规避** ——
 *    该输出类型没有 `ignoresEvasion` / `ignoresEvasionFirstRepeat` 字段，一律走 `consumeEvasion`。
 *    吕蒙【白衣渡江】的无视规避来自一类指挥 `delayedOutput` 预结算路径，不经过本段（那条不改）。
 * ② 【健卒不殆】/【分险】的 `thisHitReduce` 此前是**独立乘区** `×(1 − rate)`，口径应为
 *    「和其他类型增减伤合计相加」—— 现由 `triggerBeforeDamageHooks` 在 `calcDamage` 之前取回，
 *    并进 `sumReduce + pre.reduce` 的同一求和池（`buffMult`）。
 * 测试战法只挂进 `ctx.skills`，不改 SKILL_REGISTRY。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit, triggerBeforeDamageHooks, sumReduce,
  type CombatContext, type DamageHitContext,
} from '../src/engine/action';
import type { General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 80, defense: 80, strategy: 80, speed: 50, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

/** 受击前减伤钩子（健卒不殆 / 分险同型：before_damage + thisHitReduce） */
function hitReduceSkill(id: string, reduce: number): Skill {
  return {
    id, name: id, type: 'passive', triggerRate: 1, timing: 'battle_start',
    range: 1, targetMode: 'self', tags: ['damage_reduce'],
    onHurt: { victim: 'self', timing: 'before_damage', rate: 1, thisHitReduce: reduce, applyTo: 'victim' },
    output: [],
  };
}

/** 站位伤害（奇兵拒北同型：指挥·二类·按站位挑目标） */
function positionalSkill(): Skill {
  return {
    id: 'test_positional', name: '站位伤害', type: 'command', phase: 'round', triggerRate: 1,
    roundTrigger: 'on_act',
    range: 5, targetMode: 'all', tags: ['damage'],
    output: [{ kind: 'positional_physical_damage', positions: ['前锋', '中军'], rate: 180, source: 'self' }],
  } as Skill;
}

function makeCtx(my: UnitState[], enemy: UnitState[], extraSkills: Skill[] = [], seed = 1): CombatContext {
  const skills = new Map<string, Skill>(Object.entries(SKILL_REGISTRY));
  for (const s of extraSkills) skills.set(s.id, s);
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills, lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

/** 普攻一次后受击者的扣兵（同一 seed，攻击者与受击者属性一致） */
function troopsLostToOneBasic(hurtSkills: Skill[], reduceStatusRate: number): number {
  const attacker = dummyUnit('atk', '前锋');
  const victim = dummyUnit('vic', '前锋', { passiveSkillIds: hurtSkills.map((s) => s.id) }, 'enemy');
  if (reduceStatusRate > 0) {
    victim.statuses.push({
      type: 'damage_reduce', rate: reduceStatusRate, remaining: 99, appliedRound: 1,
      sourceSkillType: 'passive', sourceSkillId: 'test_reduce',
    });
  }
  const ctx = makeCtx([attacker], [victim], hurtSkills);
  actUnit(ctx, attacker);
  return victim.general.maxTroops - victim.troops;
}

describe('thisHitReduce 与其他增减伤合计相加（用户 2026-11-23 口径）', () => {
  it('0.5（健卒）+ 0.2（减伤状态）与单条 0.7 减伤逐兵等价 ⇒ 是加算不是相乘', () => {
    // 加算：mult = 1 − (0.5 + 0.2) = 0.3；单条 0.7：mult = 0.3 —— 两者扣兵必须完全相同。
    // 旧乘算口径下前者 mult = 0.8 × 0.5 = 0.4，会比后者少扣兵（不等）。
    const combined = troopsLostToOneBasic([hitReduceSkill('jz05', 0.5)], 0.2);
    const single = troopsLostToOneBasic([hitReduceSkill('jz07', 0.7)], 0);
    expect(combined).toBeGreaterThan(0);
    expect(combined).toBe(single);
  });

  it('两条 thisHitReduce 同时命中时相加（0.5 + 0.32 = 0.82，旧口径为 1 − 0.5×0.68）', () => {
    const a = hitReduceSkill('jz05', 0.5);
    const b = hitReduceSkill('fx032', 0.32);
    const victim = dummyUnit('vic', '前锋', { passiveSkillIds: ['jz05', 'fx032'] }, 'enemy');
    const attacker = dummyUnit('atk', '前锋');
    const ctx = makeCtx([attacker], [victim], [a, b]);
    const hit: DamageHitContext = { damageSource: 'basic', damageType: 'physical' };
    const pre = triggerBeforeDamageHooks(ctx, victim, attacker, hit);
    expect(pre.evasionBlocked).toBe(false);
    expect(pre.reduce).toBeCloseTo(0.82, 10);
    // 同一次伤害只判定一次：再调用返回 0（标记 hurtHooksResolved）
    expect(triggerBeforeDamageHooks(ctx, victim, attacker, hit).reduce).toBe(0);
  });

  it('并入同一求和池：sumReduce + pre.reduce = 0.2 + 0.5', () => {
    const skill = hitReduceSkill('jz05', 0.5);
    const victim = dummyUnit('vic', '前锋', { passiveSkillIds: ['jz05'] }, 'enemy');
    victim.statuses.push({
      type: 'damage_reduce', rate: 0.2, remaining: 99, appliedRound: 1,
      sourceSkillType: 'passive', sourceSkillId: 'test_reduce',
    });
    const attacker = dummyUnit('atk', '前锋');
    const ctx = makeCtx([attacker], [victim], [skill]);
    const hit: DamageHitContext = { damageSource: 'basic', damageType: 'physical' };
    const pre = triggerBeforeDamageHooks(ctx, victim, attacker, hit);
    const pool = sumReduce(ctx, victim, hit, attacker) + pre.reduce;
    expect(pool).toBeCloseTo(0.7, 10);
  });
});

describe('站位伤害（positional_physical_damage）判定规避', () => {
  it('敌军带 evasion 时站位伤害被挡下：发 evasion_blocked、不推 damage、不扣兵', () => {
    const skill = positionalSkill();
    const caster = dummyUnit('caster', '大营', { commandSkillIds: ['test_positional'] });
    const front = dummyUnit('front', '前锋', {}, 'enemy');
    front.statuses.push({ type: 'evasion', stacks: 1, appliedRound: 1, sourceSkillType: 'passive', sourceSkillId: 'test_evasion' });
    const mid = dummyUnit('mid', '中军', {}, 'enemy');
    const ctx = makeCtx([caster], [front, mid], [skill]);
    actUnit(ctx, caster);

    // 站位伤害确实发动了（否则测试无意义）
    const triggered = ctx.events.some((e) => e.type === 'skill_trigger' && e.skillId === 'test_positional' && e.success);
    expect(triggered).toBe(true);
    // 前锋：规避挡下
    expect(ctx.events.some((e) => e.type === 'evasion_blocked' && e.unitId === 'front')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'damage' && e.targetId === 'front')).toBe(false);
    expect(front.troops).toBe(front.general.maxTroops);
    // 中军：没有规避，照常挨打
    expect(ctx.events.some((e) => e.type === 'damage' && e.targetId === 'mid')).toBe(true);
    expect(mid.troops).toBeLessThan(mid.general.maxTroops);
  });
});
