/**
 * 休整状态：挂上时冻结每次恢复值，行动时跳恢复。
 * 指挥型与主动型不同类型共存；同类型不同战法取每次恢复值较高者替换。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { calcHealAmount, roundRate, scaledValue } from '../src/engine/formulas';

function makeUnit(
  id: string,
  opts: { position?: Position; strategy?: number; troops?: number; maxTroops?: number } = {}
): UnitState {
  const max = opts.maxTroops ?? 10000;
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: 50,
      defense: 80,
      strategy: opts.strategy ?? 80,
      speed: 40,
      attackRange: 3,
      maxTroops: max,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: opts.troops ?? max,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(units: UnitState[]): CombatContext {
  return {
    rng: new Rng(1),
    myTeam: units,
    enemyTeam: [],
    events: [],
    skills: new Map(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('休整状态机制', () => {
  it('挂上时冻结恢复值：之后施法者兵力变化不影响跳恢复', () => {
    const caster = makeUnit('caster', { strategy: 80, troops: 10000 });
    const target = makeUnit('target', { troops: 5000 });
    const ctx = makeCtx([caster, target]);
    ctx.currentRound = 1;
    inflictStatus(ctx, target, { type: 'rest', rate: 100, growthRate: 0, duration: 2, strategyScaled: false }, 'active', 'xiuzheng', 'caster');
    const frozen = target.statuses.find((s) => s.type === 'rest');
    expect(frozen?.type === 'rest' && frozen.healAmount).toBe(calcHealAmount(10000, 100));
    caster.troops = 1;
    const before = target.troops;
    actUnit(ctx, target);
    const heal = ctx.events.find((e) => e.type === 'heal');
    expect(heal?.type === 'heal' && heal.amount).toBe(calcHealAmount(10000, 100));
    expect(target.troops).toBe(before + calcHealAmount(10000, 100));
  });

  it('startRound：第 5 回合起才跳恢复（重整旗鼓）', () => {
    const caster = makeUnit('caster');
    const target = makeUnit('target', { troops: 5000 });
    const ctx = makeCtx([caster, target]);
    ctx.currentRound = 0;
    inflictStatus(ctx, target, { type: 'rest', rate: 140, growthRate: 1.13, duration: 999, startRound: 5, strategyScaled: true }, 'command', 'chongzheng_qigu', 'caster');
    ctx.currentRound = 4;
    actUnit(ctx, target);
    expect(ctx.events.filter((e) => e.type === 'heal')).toHaveLength(0);
    ctx.events = [];
    ctx.currentRound = 5;
    actUnit(ctx, target);
    expect(ctx.events.some((e) => e.type === 'heal')).toBe(true);
  });

  it('指挥休整与主动休整共存（不同类型）', () => {
    const caster = makeUnit('caster');
    const target = makeUnit('target', { troops: 4000 });
    const ctx = makeCtx([caster, target]);
    ctx.currentRound = 1;
    inflictStatus(ctx, target, { type: 'rest', rate: 140, growthRate: 1.13, duration: 999, startRound: 1, strategyScaled: true }, 'command', 'chongzheng_qigu', 'caster');
    inflictStatus(ctx, target, { type: 'rest', rate: 122, growthRate: 1.15, duration: 2, strategyScaled: true }, 'active', 'yangjing_xurui', 'caster');
    const rests = target.statuses.filter((s) => s.type === 'rest');
    expect(rests).toHaveLength(2);
    expect(rests.map((s) => s.sourceSkillType).sort()).toEqual(['active', 'command']);
  });

  it('同类型不同战法取每次恢复值较高者替换', () => {
    const caster = makeUnit('caster', { strategy: 80 });
    const target = makeUnit('target', { troops: 4000 });
    const ctx = makeCtx([caster, target]);
    ctx.currentRound = 1;
    inflictStatus(ctx, target, { type: 'rest', rate: 87, growthRate: 1.15, duration: 2, strategyScaled: true }, 'active', 'xiuzheng', 'caster');
    inflictStatus(ctx, target, { type: 'rest', rate: 122, growthRate: 1.15, duration: 2, strategyScaled: true }, 'active', 'yangjing_xurui', 'caster');
    const rests = target.statuses.filter((s) => s.type === 'rest');
    expect(rests).toHaveLength(1);
    expect(rests[0]?.sourceSkillId).toBe('yangjing_xurui');
    expect(ctx.events.some((e) => e.type === 'status_conflict')).toBe(false);
    const high = calcHealAmount(10000, roundRate(scaledValue(122, 1.15, 80)));
    expect(rests[0]?.type === 'rest' && rests[0].healAmount).toBe(high);
  });
});
