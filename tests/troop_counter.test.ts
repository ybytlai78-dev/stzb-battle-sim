/**
 * 兵种相克测试（用户规则：骑克步、步克弓、弓克骑；被克制方攻击克制方时造成的伤害降低 30%，单向惩罚）
 *  克制减伤与其他增减伤加算（单一总和），不是独立乘区。
 *  1. troopCounterFactor 全 9 组合（单元）
 *  2. 普攻/战法事件 modifiers.reduce 带「兵种克制」30%
 *  3. +30% 增伤与 -30% 克制加算抵消（mult=1），而非独立乘算 1.3×0.7=0.91
 *  4. 同配置对比——被克制方总普攻伤害显著低于克制方
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { troopCounterFactor, calcDamage, buffMult } from '../src/engine/formulas';
import type { BattleEvent, General, TroopType, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { initHeroDB } from '../src/data/heroes';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';

type HitEvent = Extract<BattleEvent, { type: 'attack_hit' }>;
type DmgEvent = Extract<BattleEvent, { type: 'damage' }>;

beforeAll(async () => {
  await initHeroDB();
});

function makeGeneral(id: string, troopType: TroopType, attack = 220, defense = 60, strategy = 100, speed = 100): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType,
    position: '大营',
    attack,
    defense,
    strategy,
    speed,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

/** 跑 1v1（双方大营，距离 1，打满 8 回合 draw），返回事件 */
function runDuel(my: General, enemy: General, seed = 12345) {
  return runBattle({ myTeam: [my], enemyTeam: [enemy], seed, maxRounds: 8 });
}

describe('兵种相克规则（单元：troopCounterFactor 全组合）', () => {
  it('被克制方攻击克制方 → 0.7（步攻骑、弓攻步、骑攻弓）', () => {
    expect(troopCounterFactor('infantry', 'cavalry')).toBe(0.7); // 步兵攻骑兵（骑克步）
    expect(troopCounterFactor('archer', 'infantry')).toBe(0.7); // 弓兵攻步兵（步克弓）
    expect(troopCounterFactor('cavalry', 'archer')).toBe(0.7); // 骑兵攻弓兵（弓克骑）
  });

  it('克制方攻击被克制方 → 1（骑攻步、步攻弓、弓攻骑，单向惩罚）', () => {
    expect(troopCounterFactor('cavalry', 'infantry')).toBe(1);
    expect(troopCounterFactor('infantry', 'archer')).toBe(1);
    expect(troopCounterFactor('archer', 'cavalry')).toBe(1);
  });

  it('同兵种 → 1', () => {
    expect(troopCounterFactor('cavalry', 'cavalry')).toBe(1);
    expect(troopCounterFactor('infantry', 'infantry')).toBe(1);
    expect(troopCounterFactor('archer', 'archer')).toBe(1);
  });
});

describe('兵种相克（单元：与增减伤加算）', () => {
  it('克制 -30% 并入 buffMult：与 +30% 增伤加算抵消为 1，而非独立乘算 0.91', () => {
    expect(buffMult(1, 1, 0.3)).toBe(0.7);
    expect(buffMult(1.3, 1, 0.3)).toBeCloseTo(1);
    expect(buffMult(1.3, 1, 0) * 0.7).toBeCloseTo(0.91);
    // 辕门射戟下限：克制再叠加仍受 10% 伤害下限保护
    expect(buffMult(1, 1, 99.99 + 0.3)).toBe(0.1);
  });

  it('同 rng 种子下 mult=0.7（加算后的克制）→ 伤害降低（base/main ×0.7，troopBase 不变）', () => {
    const base = {
      damageType: 'physical' as const,
      rate: 100,
      attackerAttack: 220,
      attackerStrategy: 100,
      attackerTroops: 9000,
      targetDefense: 60,
      targetStrategy: 100,
      mult: 1,
    };
    const normal = calcDamage({ ...base }, new Rng(42));
    const countered = calcDamage({ ...base, mult: 0.7 }, new Rng(42));
    expect(countered.breakdown.troopBase).toBe(normal.breakdown.troopBase);
    expect(Math.round(countered.breakdown.base * 10) / 0.7 / 10).toBeCloseTo(normal.breakdown.base, 0);
    expect(countered.damage).toBeLessThan(normal.damage);
  });
});

describe('兵种相克（集成：普攻与战法事件）', () => {
  it('步兵打骑兵：attack_hit.modifiers 带兵种克制 30%，克制方打被克制方不带', () => {
    // 我方步兵攻敌方骑兵 → 每击 -30%（加算）
    const rep = runDuel(makeGeneral('inf', 'infantry'), makeGeneral('cav', 'cavalry'), 777);
    const hits = rep.events.filter((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'inf');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.modifiers?.reduce.some((s) => s.skillId === 'troop_counter' && s.rate === 0.3)).toBe(true);
    }

    // 我方骑兵攻敌方步兵（克制方）→ 无兵种克制减伤
    const rep2 = runDuel(makeGeneral('cav2', 'cavalry'), makeGeneral('inf2', 'infantry'), 777);
    const hits2 = rep2.events.filter((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'cav2');
    expect(hits2.length).toBeGreaterThan(0);
    for (const h of hits2) {
      expect(h.modifiers?.reduce.some((s) => s.skillId === 'troop_counter') ?? false).toBe(false);
    }
  });

  it('战法伤害同样受克制：突进（D 主动攻击）damage.modifiers 带兵种克制 30%', () => {
    const inf = makeGeneral('inf', 'infantry');
    inf.activeSkillIds = ['tujin']; // 突进：距离1，25%，单体攻击 115%
    const rep = runDuel(inf, makeGeneral('cav', 'cavalry'), 888);
    const dmg = rep.events.filter((e): e is DmgEvent => e.type === 'damage' && e.skillId === 'tujin' && e.sourceId === 'inf');
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      expect(d.modifiers?.reduce.some((s) => s.skillId === 'troop_counter' && s.rate === 0.3)).toBe(true);
    }
  });

  it('被克制方总普攻伤害显著低于克制方（同配置对比）', () => {
    const seeds = [11, 22, 33, 44, 55];
    let counteredTotal = 0;
    let normalTotal = 0;
    for (const s of seeds) {
      // 场景 A：我方步兵（被克制）打敌方骑兵
      const a = runDuel(makeGeneral('infA', 'infantry'), makeGeneral('cavA', 'cavalry'), s);
      counteredTotal += a.events
        .filter((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'infA')
        .reduce((sum, e) => sum + e.damage, 0);
      // 场景 B：我方骑兵（克制方）打敌方步兵
      const b = runDuel(makeGeneral('cavB', 'cavalry'), makeGeneral('infB', 'infantry'), s);
      normalTotal += b.events
        .filter((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'cavB')
        .reduce((sum, e) => sum + e.damage, 0);
    }
    // 步兵被骑克后每击约 -30%（兵力基础部分不变，实际降幅略小于 30%）
    expect(counteredTotal).toBeLessThan(normalTotal * 0.85);
  });
});

/** 构造可 actUnit 的单将（不含阵容加成，便于对比克制加算） */
function makeActUnit(id: string, troopType: TroopType, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType,
      position: '前锋',
      attack: 220,
      defense: 60,
      strategy: 100,
      speed: 100,
      attackRange: 2,
      maxTroops: 9000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side,
    troops: 9000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeActCtx(attacker: UnitState, defender: UnitState, seed = 42): CombatContext {
  defender.side = 'enemy';
  return {
    rng: new Rng(seed),
    myTeam: [attacker],
    enemyTeam: [defender],
    events: [],
    skills: new Map(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('兵种相克（集成：加算进增减伤 + 战报归因）', () => {
  it('骑兵攻弓兵：attack_hit.modifiers.reduce 带兵种克制 30%', () => {
    const atk = makeActUnit('cav', 'cavalry');
    const def = makeActUnit('arch', 'archer', 'enemy');
    const ctx = makeActCtx(atk, def);
    actUnit(ctx, atk);
    const hit = ctx.events.find((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'cav');
    expect(hit).toBeTruthy();
    expect(hit!.modifiers?.reduce).toEqual([
      { unitId: 'arch', skillId: 'troop_counter', skillName: '兵种克制', rate: 0.3, direction: 'reduce' },
    ]);
  });

  it('+30% 造成增伤与弓克骑 -30% 加算抵消（攻击基础比 = 1/1.3，不是独立乘算 0.7）', () => {
    const boost = (unit: UnitState, ctx: CombatContext) =>
      inflictStatus(
        ctx,
        unit,
        { type: 'damage_boost', rate: 0.3, duration: 8, direction: 'caused' },
        'command',
        'dashang_sanjun',
        unit.general.id
      );

    const atkA = makeActUnit('cavA', 'cavalry');
    const defA = makeActUnit('arch', 'archer', 'enemy');
    const ctxA = makeActCtx(atkA, defA, 99);
    boost(atkA, ctxA);
    actUnit(ctxA, atkA);
    const hitA = ctxA.events.find((e): e is HitEvent => e.type === 'attack_hit')!;

    const atkB = makeActUnit('cavB', 'cavalry');
    const defB = makeActUnit('cavT', 'cavalry', 'enemy');
    const ctxB = makeActCtx(atkB, defB, 99);
    boost(atkB, ctxB);
    actUnit(ctxB, atkB);
    const hitB = ctxB.events.find((e): e is HitEvent => e.type === 'attack_hit')!;

    expect(hitA).toBeTruthy();
    expect(hitB).toBeTruthy();
    // 加算：克制后净倍率 1.0 / 无克制 1.3 → 攻击基础比 ≈ 1/1.3
    // 旧独立乘算：1.3×0.7 / 1.3 = 0.7
    const ratio = hitA.breakdown.base / hitB.breakdown.base;
    expect(ratio).toBeCloseTo(1 / 1.3, 2);
    expect(ratio).toBeGreaterThan(0.72);
  });

  it('克制方打被克制方（骑攻步）不带兵种克制减伤', () => {
    const atk = makeActUnit('cav', 'cavalry');
    const def = makeActUnit('inf', 'infantry', 'enemy');
    const ctx = makeActCtx(atk, def);
    actUnit(ctx, atk);
    const hit = ctx.events.find((e): e is HitEvent => e.type === 'attack_hit')!;
    expect(hit.modifiers?.reduce ?? []).toEqual([]);
  });
});
