/**
 * 「仅攻击伤害」的增减伤口径（`attackOnly`，2026-10-17 辕门射戟报障后钉死）：
 * 官方【辕门射戟】「使其进行攻击的伤害大幅度降低」（包内机制码 532）只作用于**攻击**
 * ——普攻 / 物理主动 / 追击（`isAttackHitForProc`），策略战法伤害与 DoT / 分兵 / 反击不受影响。
 * 数据侧落成 `markCausedReduce.attackOnly: true` → 目标身上 `damage_boost { direction:'caused', attackOnly:true }`。
 * 与闪击的 `CreateStatus.attackOnly` 同一口径，只是换到「已存在的 damage_boost 状态」上。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { HUGE_MODIFIER_RATE } from '../src/engine/formulas';

function makeUnit(id: string, position: Position, side: 'my' | 'enemy', extra: Partial<General> = {}): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 100, defense: 80, strategy: 100, speed: 60, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

function physicalSkill(): Skill {
  return {
    id: 'test_attack_only_phys', name: '测试攻击战法', type: 'active', prepare: false,
    triggerRate: 1, range: 5, targetMode: 'single', targetSide: 'enemy', tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 200 }],
  };
}

function strategySkill(): Skill {
  return {
    id: 'test_attack_only_strat', name: '测试策略战法', type: 'active', prepare: false,
    triggerRate: 1, range: 5, targetMode: 'single', targetSide: 'enemy', tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 200, strategyScaled: false }],
  };
}

/** 辕门射戟 debuff：目标「进行攻击的伤害」降到引擎下限（10%），attackOnly 让它不吃策略伤害 */
function yuanmenDebuff(): Status {
  return {
    type: 'damage_boost', direction: 'caused', rate: -HUGE_MODIFIER_RATE, remaining: 1, appliedRound: 0,
    sourceSkillType: 'active', sourceSkillId: 'yuanmen_sheji', attackOnly: true,
  };
}

interface Run {
  damage: number;
  troopBase: number;
  other: number;
}

function run(skill: Skill, withDebuff: boolean): Run {
  const attacker = makeUnit('attacker', '前锋', 'my', { activeSkillIds: [skill.id] });
  if (withDebuff) attacker.statuses.push(yuanmenDebuff());
  const target = makeUnit('target', '前锋', 'enemy', { maxTroops: 10000 });
  const ctx: CombatContext = {
    rng: new Rng(7), myTeam: [attacker], enemyTeam: [target], events: [],
    skills: new Map<string, Skill>([[skill.id, skill]]), lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
  // 只切战法：速度/站位固定，同一 seed 下伤害差异只来自 debuff
  actUnit(ctx, attacker);
  const hit = ctx.events.find((e) => e.type === 'damage' && e.skillId === skill.id);
  if (!hit || hit.type !== 'damage') throw new Error('未产生战法伤害事件');
  const { troopBase, base, main } = hit.breakdown;
  return { damage: hit.damage, troopBase, other: base + main };
}

describe('attackOnly：只降攻击伤害，不吃策略伤害', () => {
  it('物理主动：debuff 生效，且兵力基础段不乘乘区', () => {
    const plain = run(physicalSkill(), false);
    const debuffed = run(physicalSkill(), true);
    expect(debuffed.damage).toBeLessThan(plain.damage * 0.5);
    // breakdown 的 base/main 已是乘区后值，troopBase 不乘乘区 → damage 恒等于三者相加
    expect(debuffed.damage).toBe(debuffed.troopBase + debuffed.other);
    // 属性段/主要段被压到 10% 下限（plain.other 571 → debuffed.other 57）
    expect(debuffed.other).toBeGreaterThanOrEqual(Math.round(plain.other * 0.09));
    expect(debuffed.other).toBeLessThanOrEqual(Math.round(plain.other * 0.11));
  });

  it('策略主动：同一 seed 下伤害完全一致（attackOnly 不吃策略）', () => {
    const plain = run(strategySkill(), false);
    const debuffed = run(strategySkill(), true);
    expect(debuffed.damage).toBe(plain.damage);
  });

  it('无 attackOnly 的同额 debuff 会压策略伤害（对照组，确保上面的「一致」不是假绿）', () => {
    const plain = run(strategySkill(), false);
    const attacker = makeUnit('attacker', '前锋', 'my', { activeSkillIds: ['test_attack_only_strat'] });
    attacker.statuses.push({ ...yuanmenDebuff(), attackOnly: false } as Status);
    const target = makeUnit('target', '前锋', 'enemy', { maxTroops: 10000 });
    const skill = strategySkill();
    const ctx: CombatContext = {
      rng: new Rng(7), myTeam: [attacker], enemyTeam: [target], events: [],
      skills: new Map<string, Skill>([[skill.id, skill]]), lockedCommands: [], stackBuffs: [], currentRound: 1,
    };
    actUnit(ctx, attacker);
    const hit = ctx.events.find((e) => e.type === 'damage' && e.skillId === skill.id);
    if (!hit || hit.type !== 'damage') throw new Error('未产生战法伤害事件');
    expect(hit.damage).toBeLessThan(plain.damage * 0.5);
  });
});
