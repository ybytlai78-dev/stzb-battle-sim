/**
 * 受击链路第一阶段：damageSource 过滤 + victim locked。
 * 测试战法只挂进 ctx.skills，不改 SKILL_REGISTRY。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, applyDamage, consumeEvasion, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import type { CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
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
    alive: true, statuses: [], isPreparing: false, preparingSkillId: null, hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

function huimaSkill(): Skill {
  return {
    id: 'test_huima', name: '回马', type: 'passive', triggerRate: 1, timing: 'battle_start',
    range: 1, targetMode: 'self', tags: ['damage'],
    onHurt: { victim: 'self', damageSource: 'basic', applyTo: 'source', output: [{ kind: 'physical_damage', rate: 60 }] },
    output: [],
  };
}

describe('damageSource basic 只吃普攻', () => {
  it('applyDamage(..., physical, basic) 触发回马；同调用传 skill 不触发', () => {
    const me = dummyUnit('me', '前锋', { passiveSkillIds: ['test_huima'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_huima', huimaSkill());
    applyDamage(ctx, me, 100, foe, 'physical', 'basic');
    const dmg = ctx.events.filter((e) => e.type === 'damage' && e.skillName === '回马');
    expect(dmg.length).toBe(1);

    const ctx2 = makeCtx([me], [foe]);
    ctx2.skills.set('test_huima', huimaSkill());
    me.troops = 10000;
    applyDamage(ctx2, me, 100, foe, 'physical', 'skill');
    expect(ctx2.events.filter((e) => e.type === 'damage' && e.skillName === '回马')).toHaveLength(0);
  });

  it('缺省不传 damageSource 时 basic 钩子仍匹配（旧单元测试）', () => {
    const me = dummyUnit('me', '前锋', { passiveSkillIds: ['test_huima'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_huima', huimaSkill());
    applyDamage(ctx, me, 100, foe, 'physical');
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillName === '回马')).toBe(true);
  });
});

describe('victim locked 第三人不叠', () => {
  it('仅 lockedCommands 目标吃 taken 叠层', () => {
    const caster = dummyUnit('caster', '中军', { commandSkillIds: ['test_gq'] });
    const locked = dummyUnit('locked', '前锋', {}, 'enemy');
    const other = dummyUnit('other', '中军', {}, 'enemy');
    const src = dummyUnit('src', '前锋');
    const skill: Skill = {
      id: 'test_gq', name: '攻其不备', type: 'command', phase: 'prep', range: 5, triggerRate: 1,
      targetMode: 'group', groupCount: 2, targetSide: 'enemy', tags: ['damage_boost'],
      onHurt: {
        victim: 'locked', damageKind: 'physical', applyTo: 'victim', maxStacks: 5,
        output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.116, duration: 999, direction: 'taken', stacks: 1 } }],
      },
      output: [],
    };
    const ctx = makeCtx([caster, src], [locked, other]);
    ctx.skills.set('test_gq', skill);
    ctx.lockedCommands = [{ skill: skill as CommandSkill, casterId: 'caster', targets: [locked], currentRate: 1 }];
    applyDamage(ctx, locked, 50, src, 'physical', 'skill');
    applyDamage(ctx, other, 50, src, 'physical', 'skill');
    expect(locked.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(1);
    expect(other.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(0);
  });
});

describe('before_damage 免疫当次', () => {
  it('判定成功则本段不扣兵且发 evasion_blocked；失败则照扣', () => {
    const evadeSkill: Skill = {
      id: 'test_kc', name: '空城', type: 'command', phase: 'prep', range: 1, triggerRate: 1,
      targetMode: 'self', tags: ['evasion'],
      onHurt: {
        victim: 'self', timing: 'before_damage', endRound: 2, rate: 0.7, applyTo: 'victim',
        output: [{ kind: 'grant_evasion', stacks: 1, target: 'self' }],
      },
      output: [],
    };
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    let blocked = false;
    for (let seed = 1; seed <= 40 && !blocked; seed++) {
      const me = dummyUnit('me', '前锋', { commandSkillIds: ['test_kc'] });
      const ctx = makeCtx([me], [foe], seed);
      ctx.skills.set('test_kc', evadeSkill);
      ctx.currentRound = 1;
      applyDamage(ctx, me, 200, foe, 'physical', 'basic');
      blocked = ctx.events.some((e) => e.type === 'evasion_blocked') && me.troops === 10000;
    }
    expect(blocked).toBe(true);

    const me = dummyUnit('me', '前锋', { commandSkillIds: ['test_kc'] });
    const ctxFail = makeCtx([me], [foe], 1);
    ctxFail.skills.set('test_kc', evadeSkill);
    ctxFail.currentRound = 3;
    applyDamage(ctxFail, me, 200, foe, 'physical', 'basic');
    expect(me.troops).toBe(9800);
    expect(ctxFail.events.some((e) => e.type === 'evasion_blocked')).toBe(false);
  });

  it('成功免疫当次后立刻卸掉 0 层，同回合下一击不再白嫖残留规避', () => {
    const evadeSkill: Skill = {
      id: 'test_kc', name: '空城', type: 'command', phase: 'prep', range: 1, triggerRate: 1,
      targetMode: 'self', tags: ['evasion'],
      onHurt: {
        victim: 'self', timing: 'before_damage', endRound: 2, rate: 0.7, applyTo: 'victim',
        output: [{ kind: 'grant_evasion', stacks: 1, target: 'self' }],
      },
      output: [],
    };
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    let blockedMe: UnitState | undefined;
    let blockedCtx: CombatContext | undefined;
    for (let seed = 1; seed <= 40; seed++) {
      const me = dummyUnit('me', '前锋', { commandSkillIds: ['test_kc'] });
      const ctx = makeCtx([me], [foe], seed);
      ctx.skills.set('test_kc', evadeSkill);
      ctx.currentRound = 1;
      applyDamage(ctx, me, 200, foe, 'physical', 'basic');
      if (ctx.events.some((e) => e.type === 'evasion_blocked') && me.troops === 10000) {
        blockedMe = me;
        blockedCtx = ctx;
        break;
      }
    }
    expect(blockedMe).toBeDefined();
    expect(blockedCtx).toBeDefined();
    const me = blockedMe!;
    const ctx = blockedCtx!;
    expect(me.statuses.some((s) => s.type === 'evasion')).toBe(false);

    // 卸掉空城钩子，第二下只检验残留 0 层是否仍挡（70% 再判定成功则另算新 grant）
    me.general.commandSkillIds = [];
    ctx.skills.delete('test_kc');
    applyDamage(ctx, me, 200, foe, 'physical', 'basic');
    expect(me.troops).toBe(9800);
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked')).toHaveLength(1);
  });
});

describe('consumeEvasion 0 层残留', () => {
  it('stacks<=0 的残留规避不挡伤害、不发 evasion_blocked', () => {
    const me = dummyUnit('me', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([me], [foe]);
    me.statuses.push({
      type: 'evasion', stacks: 0, appliedRound: 1,
      sourceSkillType: 'command', sourceSkillId: 'leftover',
    });
    expect(consumeEvasion(ctx, me, foe.general.id)).toBe(false);
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked')).toHaveLength(0);
    expect(me.statuses.some((s) => s.type === 'evasion' && s.stacks === 0)).toBe(true);
  });
});

describe('thisHitReduce 改扣兵量', () => {
  it('before_damage 成功则本段伤害 ×0.5', () => {
    const skill: Skill = {
      id: 'test_jz', name: '健卒不殆', type: 'passive', triggerRate: 1, timing: 'battle_start',
      range: 1, targetMode: 'self', tags: ['damage_reduce'],
      onHurt: { victim: 'self', timing: 'before_damage', rate: 1, thisHitReduce: 0.5, applyTo: 'victim' },
      output: [],
    };
    const me = dummyUnit('me', '前锋', { passiveSkillIds: ['test_jz'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_jz', skill);
    applyDamage(ctx, me, 200, foe, 'physical', 'basic');
    expect(me.troops).toBe(9900);
  });

  it('thisHitReduce 0.3 扣兵取整为整数', () => {
    const skill: Skill = {
      id: 'test_reduce30', name: '减伤30', type: 'passive', triggerRate: 1, timing: 'battle_start',
      range: 1, targetMode: 'self', tags: ['damage_reduce'],
      onHurt: { victim: 'self', timing: 'before_damage', rate: 1, thisHitReduce: 0.3, applyTo: 'victim' },
      output: [],
    };
    const me = dummyUnit('me', '前锋', { passiveSkillIds: ['test_reduce30'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_reduce30', skill);
    applyDamage(ctx, me, 100, foe, 'physical', 'basic');
    expect(me.troops).toBe(10000 - Math.round(100 * 0.7));
  });
});

describe('counter 只吃普攻且二次不反击', () => {
  it('basic 扣兵后对来源打 100% 攻击；skill 不触发；反击段不再套 counter', () => {
    const me = dummyUnit('me', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    me.statuses.push({
      type: 'counter', remaining: 1, rate: 100, appliedRound: 1,
      sourceSkillType: 'command', sourceSkillId: 'test_fj', sourceUnitId: 'me',
    });
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_fj', {
      id: 'test_fj', name: '反击', type: 'command', phase: 'prep', range: 5, triggerRate: 1,
      targetMode: 'self', tags: ['damage'], output: [],
    });
    applyDamage(ctx, me, 100, foe, 'physical', 'basic');
    const hits = ctx.events.filter((e) => e.type === 'damage' && e.targetId === 'foe');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ creditToId: 'me', damageType: 'physical', skillId: 'test_fj' });

    const ctx2 = makeCtx([me], [foe]);
    me.troops = 10000;
    me.statuses = [{
      type: 'counter', remaining: 1, rate: 100, appliedRound: 1,
      sourceSkillType: 'command', sourceSkillId: 'test_fj', sourceUnitId: 'me',
    }];
    applyDamage(ctx2, me, 100, foe, 'physical', 'skill');
    expect(ctx2.events.filter((e) => e.type === 'damage' && e.targetId === 'foe')).toHaveLength(0);
  });
});

describe('speedScaled 无成长率用基值', () => {
  it('rate 0.116 不随速度变化', () => {
    const skill: Skill = {
      id: 'test_spd', name: '测速', type: 'command', phase: 'prep', range: 5, triggerRate: 1,
      targetMode: 'single', targetSide: 'enemy', tags: ['damage_boost'],
      output: [{
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: 0.116, duration: 999, direction: 'taken', speedScaled: true, stacks: 1 },
      }],
    };
    const rates: number[] = [];
    for (const speed of [50, 200]) {
      const caster = dummyUnit(`caster${speed}`, '前锋', { speed, commandSkillIds: ['test_spd'] });
      const foe = dummyUnit(`foe${speed}`, '前锋', {}, 'enemy');
      const ctx = makeCtx([caster], [foe]);
      ctx.currentRound = 0;
      ctx.skills.set('test_spd', skill);
      triggerCommandSkills(ctx, caster);
      const boost = foe.statuses.find((s) => s.type === 'damage_boost');
      expect(boost?.type).toBe('damage_boost');
      if (boost?.type === 'damage_boost') rates.push(boost.rate);
    }
    expect(rates).toHaveLength(2);
    expect(rates[0]).toBeCloseTo(0.116);
    expect(rates[1]).toBeCloseTo(0.116);
  });
});

describe('被动 round_start 窗口', () => {
  it('endRound:3 第 4 回合不再 skill_cast', () => {
    const skill: Skill = {
      id: 'test_xs', name: '先声', type: 'passive', triggerRate: 1, timing: 'round_start',
      range: 1, targetMode: 'self', tags: ['attack_buff'], endRound: 3,
      output: [{ kind: 'inflict_status', status: { type: 'attack_buff', amount: 10, duration: 1 } }],
    };
    const castsAt = (round: number) => {
      const me = dummyUnit('me', '前锋', { passiveSkillIds: ['test_xs'] });
      const foe = dummyUnit('foe', '前锋', {}, 'enemy');
      const ctx = makeCtx([me], [foe]);
      ctx.currentRound = round;
      ctx.skills.set('test_xs', skill);
      actUnit(ctx, me);
      return ctx.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'test_xs');
    };
    expect(castsAt(3).length).toBeGreaterThan(0);
    expect(castsAt(4)).toHaveLength(0);
  });
});

describe('指挥 chance 发 skill_trigger', () => {
  it('tickRoundStartStatuses 对 command 的 chance 输出发 skill_trigger', () => {
    const me = dummyUnit('me', '前锋', { commandSkillIds: ['test_ch'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const skill: CommandSkill = {
      id: 'test_ch', name: '测几率', type: 'command', phase: 'prep', range: 5, triggerRate: 1,
      targetMode: 'self', tags: ['damage'],
      roundStartRepeat: {
        output: [{
          kind: 'inflict_status',
          chance: 0.75,
          status: { type: 'counter', duration: 1, rate: 100 },
        }],
      },
      output: [],
    };
    const ctx = makeCtx([me], [foe]);
    ctx.currentRound = 1;
    ctx.skills.set('test_ch', skill);
    ctx.lockedCommands = [{ skill, casterId: 'me', targets: [me], currentRate: 1 }];
    tickRoundStartStatuses(ctx);
    const triggers = ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'test_ch');
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers[0]).toMatchObject({ baseRate: 75, success: expect.any(Boolean) });
  });
});

describe('counter sameSource 刷新 appliedRound', () => {
  it('第 2 回合 roundStartRepeat 重挂后行动不掉、仍能反击', () => {
    const skill: CommandSkill = {
      id: 'test_fj_refresh', name: '反击刷新', type: 'command', phase: 'prep', range: 5, triggerRate: 1,
      targetMode: 'self', tags: ['damage'],
      roundStartRepeat: {
        output: [{
          kind: 'inflict_status',
          chance: 1,
          status: { type: 'counter', duration: 1, rate: 100 },
        }],
      },
      output: [],
    };
    const me = dummyUnit('me', '前锋', { commandSkillIds: ['test_fj_refresh'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_fj_refresh', skill);
    ctx.lockedCommands = [{ skill, casterId: 'me', targets: [me], currentRate: 1 }];

    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const r1 = me.statuses.find((s) => s.type === 'counter');
    expect(r1).toBeDefined();
    expect(r1?.appliedRound).toBe(1);

    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    const r2 = me.statuses.find((s) => s.type === 'counter');
    expect(r2).toBeDefined();
    expect(r2?.appliedRound).toBe(2);

    actUnit(ctx, me);
    expect(me.statuses.some((s) => s.type === 'counter')).toBe(true);

    applyDamage(ctx, me, 100, foe, 'physical', 'basic');
    const hits = ctx.events.filter((e) => e.type === 'damage' && e.skillId === 'test_fj_refresh' && e.targetId === 'foe');
    expect(hits.length).toBeGreaterThan(0);
  });
});
