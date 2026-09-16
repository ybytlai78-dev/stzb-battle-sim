/**
 * attackScaled 结算（无 growthRate 用基值；有则按生效攻击缩放）
 * 与 taken charges 受击消耗（文伐：下一次受到策略攻击）。
 * dummyUnit / makeCtx 拷自 troop_filter.test.ts。
 */
import { describe, it, expect } from 'vitest';
import {
  applyDamage,
  inflictStatus,
  tickRoundStartStatuses,
  triggerActiveSkill,
  triggerCommandSkills,
  type CombatContext,
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

describe('attackScaled', () => {
  it('无 growthRate 用原 rate（万箭 −0.5）', () => {
    const caster = dummyUnit('caster', '前锋', { attack: 200 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    inflictStatus(
      ctx,
      foe,
      {
        type: 'damage_boost',
        rate: -0.5,
        duration: 2,
        direction: 'caused',
        damageType: 'strategy',
        attackScaled: true,
      },
      'active',
      'wanjian_qifa',
      caster.general.id
    );
    const st = foe.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.rate).toBe(-0.5);
  });

  it('有 growthRate 才按生效攻击缩放', () => {
    const caster = dummyUnit('caster', '前锋', { attack: 180 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    inflictStatus(
      ctx,
      foe,
      {
        type: 'damage_boost',
        rate: -0.5,
        duration: 2,
        direction: 'caused',
        attackScaled: true,
        growthRate: 0.15,
      },
      'active',
      'test_as',
      caster.general.id
    );
    // 本任务：executeSkillOutputs 才缩放；直接 inflictStatus 仍写原 rate（与 speedScaled 直调路径一致）
    const st = foe.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.rate).toBe(-0.5);
  });
});

describe('taken charges 受击消耗', () => {
  it('策略受击实际扣兵后 charges 到 0 移除；当次仍计入', () => {
    const atk = dummyUnit('atk', '前锋', { strategy: 200 });
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    def.troops = 10000;
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: 0.2,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        charges: 1,
      },
      'pursuit',
      'wenfa',
      atk.general.id
    );
    expect(def.statuses.some((s) => s.type === 'damage_boost' && s.charges === 1)).toBe(true);
    applyDamage(ctx, def, 100, atk, 'strategy', 'skill');
    expect(def.statuses.filter((s) => s.type === 'damage_boost' && s.charges != null)).toHaveLength(0);
    expect(def.troops).toBe(9900);
  });

  it('攻击受击不扣策略 taken charges', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: 0.2,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        charges: 1,
      },
      'pursuit',
      'wenfa',
      atk.general.id
    );
    applyDamage(ctx, def, 100, atk, 'physical', 'basic');
    const st = def.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.charges).toBe(1);
  });

  it('目标自己打出攻击不消耗身上的 taken charges', () => {
    const unit = dummyUnit('u', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([unit], [foe]);
    inflictStatus(
      ctx,
      unit,
      {
        type: 'damage_boost',
        rate: 0.2,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        charges: 1,
      },
      'pursuit',
      'wenfa',
      unit.general.id
    );
    applyDamage(ctx, foe, 100, unit, 'physical', 'basic');
    const st = unit.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.charges).toBe(1);
  });

  it('applyDamage 不扣攻击者 caused charges', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      atk,
      { type: 'damage_boost', rate: 0.28, duration: 999, direction: 'caused', charges: 2 },
      'active',
      'quanjun_tuji',
      atk.general.id
    );
    applyDamage(ctx, def, 100, atk, 'physical', 'basic');
    const st = atk.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.charges).toBe(2);
  });
});

describe('attackScaled 经 executeSkillOutputs', () => {
  it('无 growthRate 保持 −0.5；有 growthRate 按攻击缩放', () => {
    const skill: Skill = {
      id: 'test_as',
      name: '测缩放',
      type: 'active',
      prepare: false,
      range: 5,
      triggerRate: 1,
      targetMode: 'single',
      tags: ['damage_boost'],
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: -0.5,
            duration: 2,
            direction: 'caused',
            damageType: 'strategy',
            attackScaled: true,
          },
        },
      ],
    };
    const caster = dummyUnit('caster', '前锋', { attack: 80, activeSkillIds: ['test_as'], morale: 100 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    ctx.skills.set('test_as', skill);
    triggerActiveSkill(ctx, caster, skill, [foe], [caster], [foe]);
    const st = foe.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.rate).toBe(-0.5);

    const skill2: Skill = {
      ...skill,
      id: 'test_as2',
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: 0.08,
            duration: 2,
            direction: 'caused',
            attackScaled: true,
            growthRate: 0.026,
          },
        },
      ],
    };
    const caster2 = dummyUnit('c2', '前锋', { attack: 180, activeSkillIds: ['test_as2'], morale: 100 });
    const foe2 = dummyUnit('f2', '前锋', {}, 'enemy');
    const ctx2 = makeCtx([caster2], [foe2]);
    ctx2.skills.set('test_as2', skill2);
    triggerActiveSkill(ctx2, caster2, skill2, [foe2], [caster2], [foe2]);
    const st2 = foe2.statuses.find((s) => s.type === 'damage_boost');
    expect(st2?.type).toBe('damage_boost');
    if (st2?.type === 'damage_boost') {
      // scaledValue(8, 0.026, 180) = 8 + 0.026*100 = 10.6 → roundRate 10 → /100 = 0.10
      expect(st2.rate).toBeCloseTo(0.1, 5);
    }
  });
});

describe('decayFifths', () => {
  it('五次匹配策略扣兵后移除：30→24→18→12→6→0', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: -0.3,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        attackScaled: true,
        decayFifths: 5,
      },
      'passive',
      'shiqiang_cuifeng',
      def.general.id
    );
    const rates: number[] = [];
    const boost = () => def.statuses.find((s) => s.type === 'damage_boost' && s.direction === 'taken');
    const first = boost();
    expect(first?.type).toBe('damage_boost');
    if (first?.type === 'damage_boost') {
      expect(first.rate).toBeCloseTo(-0.3, 5);
      expect(first.fifths).toBe(5);
    }
    for (let i = 0; i < 5; i++) {
      applyDamage(ctx, def, 10, atk, 'strategy', 'skill');
      const s = boost();
      rates.push(s && s.type === 'damage_boost' ? s.rate : 0);
    }
    expect(rates.map((r) => Math.round(r * 1000) / 1000)).toEqual([-0.24, -0.18, -0.12, -0.06, 0]);
    expect(boost()).toBeUndefined();
  });

  it('攻击受击不衰减策略 fifths', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: -0.3,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        decayFifths: 5,
      },
      'passive',
      'shiqiang_cuifeng',
      def.general.id
    );
    applyDamage(ctx, def, 10, atk, 'physical', 'basic');
    const s = def.statuses.find((s) => s.type === 'damage_boost');
    expect(s?.type).toBe('damage_boost');
    if (s?.type === 'damage_boost') {
      expect(s.fifths).toBe(5);
      expect(s.rate).toBeCloseTo(-0.3, 5);
    }
  });
});

describe('selfPhysBoost', () => {
  it('回合开始 +1 层；造成攻击扣兵后再 +1；封顶 12', () => {
    const skill: Skill = {
      id: 'test_sq',
      name: '测叠层',
      type: 'passive',
      triggerRate: 1,
      timing: 'battle_start',
      range: 1,
      targetMode: 'self',
      tags: ['damage_boost'],
      selfPhysBoost: {
        perStack: 0.034,
        maxStacks: 12,
        duration: 999,
        attackScaled: true,
        onRoundStart: true,
        onDealPhysical: true,
      },
      output: [],
    };
    const u = dummyUnit('u', '前锋', { attack: 80, passiveSkillIds: ['test_sq'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([u], [foe]);
    ctx.skills.set('test_sq', skill);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const layer = () => u.statuses.find((s) => s.type === 'damage_boost' && s.direction === 'caused');
    const first = layer();
    expect(first?.type).toBe('damage_boost');
    if (first?.type === 'damage_boost') {
      expect(first.stacks).toBe(1);
      expect(first.rate).toBeCloseTo(0.034, 5);
      expect(first.damageType).toBe('physical');
    }
    applyDamage(ctx, foe, 10, u, 'physical', 'basic');
    const afterPhys = layer();
    if (afterPhys?.type === 'damage_boost') {
      expect(afterPhys.stacks).toBe(2);
      expect(afterPhys.rate).toBeCloseTo(0.068, 5);
    }
    applyDamage(ctx, foe, 10, u, 'strategy', 'skill');
    const afterStrat = layer();
    if (afterStrat?.type === 'damage_boost') expect(afterStrat.stacks).toBe(2);
    for (let i = 0; i < 20; i++) applyDamage(ctx, foe, 10, u, 'physical', 'basic');
    const capped = layer();
    if (capped?.type === 'damage_boost') {
      expect(capped.stacks).toBe(12);
      expect(capped.rate).toBeCloseTo(0.034 * 12, 5);
    }
  });
});

describe('strategy_damage.range', () => {
  /**
   * 敌军仅大营时，若我方也是单人，实时距离会压成 1（双方均 liveRank0）。
   * 我方前锋+中军占位、施法者大营 → 对敌军大营距离 3，才能区分 skill.range1 vs 输出 range5。
   */
  function rangeCtx(skill: Skill): CombatContext {
    const front = dummyUnit('front', '前锋');
    const mid = dummyUnit('mid', '中军');
    const caster = dummyUnit('caster', '大营', { strategy: 80, commandSkillIds: ['test_bg'] });
    const foe = dummyUnit('foe', '大营', {}, 'enemy');
    const ctx = makeCtx([front, mid, caster], [foe]);
    ctx.skills.set('test_bg', skill);
    triggerCommandSkills(ctx, caster);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    return ctx;
  }

  it('战法 range 1 时 roundStartRepeat 用输出 range 5 打到敌军', () => {
    const skill: Skill = {
      id: 'test_bg',
      name: '测不攻距离',
      type: 'command',
      phase: 'prep',
      range: 1,
      triggerRate: 1,
      targetMode: 'self',
      tags: ['damage'],
      output: [],
      roundStartRepeat: {
        output: [
          {
            kind: 'strategy_damage',
            rate: 83,
            strategyScaled: true,
            targetMode: 'single',
            range: 5,
          },
        ],
      },
    };
    const ctx = rangeCtx(skill);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_bg' && e.damageType === 'strategy')).toBe(
      true
    );
  });

  it('战法 range 1 且输出无 range 时打不到远距敌军', () => {
    const skill: Skill = {
      id: 'test_bg',
      name: '测不攻距离',
      type: 'command',
      phase: 'prep',
      range: 1,
      triggerRate: 1,
      targetMode: 'self',
      tags: ['damage'],
      output: [],
      roundStartRepeat: {
        output: [
          {
            kind: 'strategy_damage',
            rate: 83,
            strategyScaled: true,
            targetMode: 'single',
          },
        ],
      },
    };
    const ctx = rangeCtx(skill);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_bg' && e.damageType === 'strategy')).toBe(
      false
    );
  });
});
