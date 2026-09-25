/**
 * 拆解通用 B+ 第十八阶段 · 合纵连横（A 指挥·距离 3·我军全体）：
 * 我方出战 3 名武将阵营均不相同时——
 * ① 我军全体武将战法距离 +1；② 对非自身阵营的武将造成攻击与策略伤害提升 10%；
 * ③ 对非自身阵营的武将普通攻击后 40% 几率使目标陷入围困（持续 1 回合）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  actUnit,
  inflictStatus,
  teamFactionsDistinct,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import { skillRangeOf, skillTargets, unitsInSkillRange } from '../src/engine/target';
import { Rng } from '../src/engine/rng';

function dummy(id: string, position: Position, faction = '汉', troops = 10000): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction,
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function unitFrom(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

/** 我方三将阵营互不相同（汉/魏/吴） → 满足合纵连横阵营条件 */
function distinctTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', '汉');
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', '魏'), dummy('ally-back', '大营', '吴')];
}

function makeCtx(my: General[], enemies: General[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemies.map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function enemyTeam(faction = '魏'): General[] {
  return [
    dummy('enemy-front', '前锋', faction),
    dummy('enemy-mid', '中军', faction),
    dummy('enemy-back', '大营', faction),
  ];
}

function commandSkill(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);

const attackHits = (ctx: CombatContext, unitId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
      e.type === 'attack_hit' && e.sourceId === unitId
  );

describe('合纵连横（A 指挥：阵营互不相同 → 战法距离+1 / 非自身阵营增伤 10% / 普攻后 40% 围困）', () => {
  it('装配：一类指挥 prep、距离 3、我军全体、阵营条件开关；三段机制字段齐备', () => {
    const s = commandSkill('hezong_lianheng');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.teamFactionDistinct).toBe(true);
    expect(s.retainAfterDeath).toBe(true);
    expect(s.tags).toEqual(expect.arrayContaining(['range_buff', 'damage_boost', 'siege']));

    expect(s.output.map((o) => o.kind)).toEqual(['inflict_status', 'inflict_status']);
    const rangeOut = s.output[0];
    if (rangeOut.kind !== 'inflict_status' || Array.isArray(rangeOut.status)) throw new Error('期望单个状态');
    expect(rangeOut.status.type).toBe('skill_range_buff');
    if (rangeOut.status.type === 'skill_range_buff') {
      expect(rangeOut.status.amount).toBe(1);
      expect(rangeOut.status.duration).toBe(999);
    }
    const boostOut = s.output[1];
    if (boostOut.kind !== 'inflict_status' || Array.isArray(boostOut.status)) throw new Error('期望单个状态');
    expect(boostOut.status.type).toBe('damage_boost');
    if (boostOut.status.type === 'damage_boost') {
      expect(boostOut.status.rate).toBe(0.1);
      expect(boostOut.status.direction).toBe('caused');
      expect(boostOut.status.targetFactionNotSelf).toBe(true);
      expect(boostOut.status.duration).toBe(999);
    }

    const proc = s.basicHitProc;
    expect(proc?.rate).toBe(0.4);
    expect(proc?.targetFactionNotSelf).toBe(true);
    const siegeOut = proc?.output[0];
    if (siegeOut?.kind !== 'inflict_status' || Array.isArray(siegeOut.status)) throw new Error('期望围困段');
    expect(siegeOut.targetFactionNotSelf).toBe(true);
    expect(siegeOut.status.type).toBe('siege');
    if (siegeOut.status.type !== 'siege') throw new Error('期望围困状态');
    expect(siegeOut.status.duration).toBe(2); // 「持续 1 回合」行动中施加给他人口径
  });

  it('阵营条件：3 将阵营互不相同 → 我军全体获得战法距离 +1 与非自身阵营增伤；同阵营则不生效', () => {
    const ok = makeCtx(distinctTeam('hezong_lianheng'), enemyTeam());
    triggerCommandSkills(ok, ok.myTeam[0]);
    expect(ok.myTeam.every((u) => statusOf(u, 'skill_range_buff'))).toBe(true);
    expect(ok.myTeam.every((u) => statusOf(u, 'damage_boost'))).toBe(true);
    expect(ok.events.some((e) => e.type === 'skill_cast' && e.skillId === 'hezong_lianheng')).toBe(true);

    // 重复阵营（汉/汉/吴）→ 整次不生效
    const dupTeam = distinctTeam('hezong_lianheng');
    dupTeam[1].faction = '汉';
    const bad = makeCtx(dupTeam, enemyTeam());
    triggerCommandSkills(bad, bad.myTeam[0]);
    expect(bad.myTeam.every((u) => u.statuses.length === 0)).toBe(true);
    expect(bad.events.some((e) => e.type === 'skill_cast' && e.skillId === 'hezong_lianheng')).toBe(false);

    // 单元口径：部署名单 3 将阵营两两不同
    expect(teamFactionsDistinct(ok.myTeam)).toBe(true);
    expect(teamFactionsDistinct(bad.myTeam)).toBe(false);
  });

  it('战法距离 +1：距离 2 的战法原本够不到敌军大营（距离 3），加成后可选到', () => {
    const ctx = makeCtx(distinctTeam('hezong_lianheng'), enemyTeam());
    const caster = ctx.myTeam[0]; // 前锋 → 敌军前锋 1 / 中军 2 / 大营 3
    expect(unitsInSkillRange(ctx, caster, ctx.enemyTeam, 2).map((u) => u.general.id)).toEqual([
      'enemy-front',
      'enemy-mid',
    ]);
    expect(skillRangeOf(caster, 2)).toBe(2);

    inflictStatus(
      ctx,
      caster,
      { type: 'skill_range_buff', amount: 1, duration: 999 },
      'command',
      'hezong_lianheng',
      caster.general.id
    );
    expect(skillRangeOf(caster, 2)).toBe(3);
    expect(unitsInSkillRange(ctx, caster, ctx.enemyTeam, 2).map((u) => u.general.id)).toEqual([
      'enemy-front',
      'enemy-mid',
      'enemy-back',
    ]);
    // skillTargets 同样吃加成（距离 3 的大营现在可被选中）
    expect(skillTargets(ctx, caster, ctx.enemyTeam, 2, 'random_single')).toHaveLength(1);
  });

  it('增伤阵营过滤：同阵营目标不加成，非自身阵营目标 +10%', () => {
    const run = (targetFaction: string, withBoost: boolean) => {
      const ctx = makeCtx(distinctTeam('hezong_lianheng'), enemyTeam(targetFaction));
      const attacker = ctx.myTeam[0]; // 阵营「汉」
      // 只留 1 个敌军，保证普攻目标确定
      ctx.enemyTeam[1].alive = false;
      ctx.enemyTeam[2].alive = false;
      if (withBoost) {
        inflictStatus(
          ctx,
          attacker,
          {
            type: 'damage_boost',
            rate: 0.1,
            duration: 999,
            direction: 'caused',
            targetFactionNotSelf: true,
          },
          'command',
          'hezong_lianheng',
          attacker.general.id
        );
      }
      actUnit(ctx, attacker);
      const hits = attackHits(ctx, attacker.general.id);
      expect(hits).toHaveLength(1);
      return hits[0].damage;
    };

    const baseline = run('魏', false);
    const sameFaction = run('汉', true); // 目标阵营 = 自身阵营「汉」→ 增伤不生效
    const otherFaction = run('魏', true); // 目标阵营「魏」→ 增伤生效
    expect(sameFaction).toBe(baseline);
    expect(otherFaction).toBeGreaterThan(baseline);
    // 兵力基础（troopBase）不乘增伤系数，故比值 < 1.1
    expect(otherFaction / baseline).toBeLessThanOrEqual(1.1);
    expect(otherFaction / baseline).toBeGreaterThan(1.02);
  });

  it('普攻后围困：任意被注册的我军（非战法携带者）普攻命中非自身阵营目标 → 围困 2 回合（覆盖下一次行动）', () => {
    const ctx = makeCtx(distinctTeam('hezong_lianheng'), enemyTeam('魏'));
    // 测试用：把 40% 改为必中（注册时读取的是 ctx.skills 里的实例）
    const def = commandSkill('hezong_lianheng');
    ctx.skills.set('hezong_lianheng', {
      ...def,
      basicHitProc: { ...def.basicHitProc!, rate: 1 },
    } as CommandSkill);
    triggerCommandSkills(ctx, ctx.myTeam[0]); // 战法携带者 = 前锋（汉）
    expect(ctx.basicHitProcs ?? []).toHaveLength(3); // 我军全体逐单位注册

    // 由**中军**（魏，非携带者）出手 → 目标为敌军（魏）…同阵营不触发，改打汉阵营目标
    const mid = ctx.myTeam[1];
    ctx.enemyTeam.forEach((e, i) => (e.general.faction = i === 0 ? '汉' : '魏'));
    ctx.enemyTeam.forEach((e, i) => (e.alive = i === 0)); // 只留敌军前锋（汉）
    actUnit(ctx, mid);

    const target = ctx.enemyTeam[0];
    const siege = statusOf(target, 'siege');
    expect(siege).toBeDefined();
    expect(siege?.sourceSkillId).toBe('hezong_lianheng');
    if (siege?.type === 'siege') expect(siege.remaining).toBe(2);
    const trig = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'hezong_lianheng'
    );
    expect(trig?.unitId).toBe('ally-mid'); // 判定方 = 实际普攻者
    expect(trig?.skillName).toBe('合纵连横');
    expect(trig?.success).toBe(true);
  });

  it('普攻后围困：目标与普攻者**同阵营**时不触发（40% 判定都不掷）', () => {
    const ctx = makeCtx(distinctTeam('hezong_lianheng'), enemyTeam('魏'));
    const def = commandSkill('hezong_lianheng');
    ctx.skills.set('hezong_lianheng', {
      ...def,
      basicHitProc: { ...def.basicHitProc!, rate: 1 },
    } as CommandSkill);
    triggerCommandSkills(ctx, ctx.myTeam[0]);

    const mid = ctx.myTeam[1]; // 阵营「魏」
    ctx.enemyTeam.forEach((e, i) => {
      e.general.faction = '魏'; // 与中军同阵营
      e.alive = i === 0;
    });
    actUnit(ctx, mid);

    expect(ctx.enemyTeam[0].statuses.some((s) => s.type === 'siege')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'skill_trigger' && e.skillId === 'hezong_lianheng')).toBe(false);
  });
});
