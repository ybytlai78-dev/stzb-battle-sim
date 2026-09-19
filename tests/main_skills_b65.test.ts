/**
 * 断首何怒（严颜·蜀骑 h631 主战法）：被动 S，距离 1，目标自己。
 * 满级：战斗中，自身受到伤害后有 60.0% 的几率使伤害来源的下一次攻击和策略攻击伤害下降
 *   42.0%（受防御属性影响）。同时每回合行动时使自身受到的所有伤害降低 80.0%，
 *   每当受到攻击或策略攻击伤害后，减伤效果将降低 1/5。
 * 1 级：受击后 60% / 21.0%；每回合 40.0% 全伤害降低（衰减同为 1/5）。
 * 官方：scripts/skill_extra.json id 200899（被动 S / 距离 1 / 目标自己 / 兵种骑；
 *   effect 标签 受到攻击伤害降低;受到策略攻击伤害降低;攻击伤害降低;策略攻击伤害降低）。
 *   来源 https://stzb.163.com/m/skilllist/200899.html
 * 入档：**下架** —— 42%「受防御属性影响」而官方未给成长系数（`defenseScaled` 标记在、`growthRate` 缺
 *   → 按基值不缩放）→ 登记 OFFLINE_MAIN_SKILLS（上架池保持 77）。
 * 引擎配套（本提交新增，`src/engine/action.ts` `refreshDecayCounters`）：衰减类状态同源重挂 = 刷新
 *   （份数与满额率一并重置）——否则「每回合行动时使自身受到的所有伤害降低 80%」会被残留份数打回。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, applyDamage, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'duanshou_henu';
const HERO_ID = 'h631';

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 30000,
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

function makeUnit(g: General, side: 'my' | 'enemy' = 'my', troops?: number): UnitState {
  return {
    general: g,
    side,
    troops: troops ?? g.maxTroops,
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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  // level40 → 兵力 9000（不是 dummy 的 30000）
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/**
 * 把 ctx 内本战法副本的 `onHurt` 触发率置为指定值（机制断言不依赖 RNG）：
 * 1 = 受击必定反伤；0 = 关闭反伤（隔离减伤轨 / 做同种子对照）。
 */
function forceOnHurtRate(ctx: CombatContext, rate: number): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'passive' && s.onHurt) {
    const cfg = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    cfg.rate = rate;
  }
  ctx.skills.set(SKILL_ID, s);
}

/** 严颜（前锋·9000 兵·被动挂本战法）+ 一名敌人 */
function setup(seed = 1) {
  const yan = heroUnit(HERO_ID, '前锋', { passiveSkillIds: [SKILL_ID] });
  const foe = makeUnit(dummy('foe', '中军'), 'enemy');
  const ctx = makeCtx([yan], [foe], seed);
  return { ctx, yan, foe };
}

/** 自身身上本战法的减伤状态 */
function reduceOf(u: UnitState) {
  return u.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID);
}

/** 来源身上本战法的「下一次造成伤害降低」状态 */
function boostOf(u: UnitState) {
  return u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID);
}

describe('断首何怒（严颜 h631）', () => {
  it('装配：被动·battle_start·距离1·自己 / onHurt 60%→source / roundStartRepeat damage_reduce 0.8 decayFifths 5 / output[] · h631 挂槽 · 下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('严颜');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('断首何怒');
    expect(HERO_RECORDS[HERO_ID].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
    expect(s.targetMode).toBe('self');
    expect(s.triggerRate).toBe(1);
    expect(s.tags).toEqual(['damage_boost', 'damage_reduce']);
    expect(s.output).toEqual([]);

    // ① 受击后 60%：对来源挂「下一次造成的伤害 −42%（受防御，成长未确认 → 基值）、charges 1」
    const onHurt = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    expect(onHurt).toMatchObject({ victim: 'self', rate: 0.6, applyTo: 'source' });
    expect(onHurt?.output).toEqual([
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -0.42,
          duration: 999,
          direction: 'caused',
          defenseScaled: true,
          charges: 1,
        },
      },
    ]);

    // ② 每回合行动时刷新自身「受到所有伤害 −80%」，受击按 1/5 衰减（decayFifths 5）
    expect(s.roundStartRepeat?.output).toEqual([
      {
        kind: 'inflict_status',
        target: 'self',
        status: { type: 'damage_reduce', rate: 0.8, duration: 999, decayFifths: 5 },
      },
    ]);

    // 42% 受防御成长未确认 → 下架（上架池保持 77）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('机制①：自身受击后对来源挂 damage_boost（−42% / charges 1 / caused）；来源下一次伤害即消耗且该次 modifiers.caused 含本战法', () => {
    const { ctx, yan, foe } = setup(1);
    forceOnHurtRate(ctx, 1);

    // 严颜受到一次伤害 → 来源（foe）身上出现本战法的「下一次造成伤害 −42%」
    applyDamage(ctx, yan, 100, foe, 'physical', 'skill');
    const boost = boostOf(foe);
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') {
      expect(boost.rate).toBeCloseTo(-0.42, 5); // defenseScaled 无 growthRate → 基值不缩放
      expect(boost.charges).toBe(1);
      expect(boost.direction).toBe('caused');
      expect(boost.baseRate).toBeUndefined();
    }

    // foe 打出一次普通攻击 → 该次伤害事件带本战法（caused），随后 charges 用尽移除
    actUnit(ctx, foe);
    const hits = eventsOf(ctx, 'attack_hit').filter((e) => e.sourceId === foe.general.id);
    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0];
    if (!first) return;
    const caused = (first.modifiers?.caused ?? []).find((m) => m.skillId === SKILL_ID);
    expect(caused).toBeTruthy();
    expect(caused?.rate).toBeCloseTo(-0.42, 5);
    expect(caused?.unitId).toBe(yan.general.id);
    expect(boostOf(foe)).toBeUndefined();

    // 同种子对照：带 debuff 的那记普攻伤害低于无 debuff 基线
    const attackDamage = (withDebuff: boolean): number => {
      const s = setup(7);
      forceOnHurtRate(s.ctx, 0); // 隔离反伤，只比较本 debuff
      if (withDebuff) {
        inflictStatus(
          s.ctx,
          s.foe,
          { type: 'damage_boost', rate: -0.42, duration: 999, direction: 'caused', defenseScaled: true, charges: 1 },
          'passive',
          SKILL_ID,
          s.yan.general.id,
        );
      }
      actUnit(s.ctx, s.foe);
      const hit = eventsOf(s.ctx, 'attack_hit').find((e) => e.sourceId === s.foe.general.id);
      return hit?.damage ?? 0;
    };
    const debuffed = attackDamage(true);
    const baseline = attackDamage(false);
    expect(debuffed).toBeGreaterThan(0);
    expect(debuffed).toBeLessThan(baseline);
  });

  it('机制②：roundStartRepeat 挂 damage_reduce 0.8 / fifths 5；受击实际扣兵后按 1/5 衰减 0.64→0.48→0.32→0.16→移除', () => {
    const { ctx, yan, foe } = setup(1);
    forceOnHurtRate(ctx, 0); // 隔离减伤轨

    actUnit(ctx, yan); // 第 1 回合行动 → roundStartRepeat 施加
    const s0 = reduceOf(yan);
    expect(s0?.type).toBe('damage_reduce');
    if (s0?.type === 'damage_reduce') {
      expect(s0.rate).toBeCloseTo(0.8, 5);
      expect(s0.fifths).toBe(5);
      expect(s0.fifthsBase).toBe(5);
      expect(s0.baseRate).toBeCloseTo(0.8, 5);
    }

    const rates: Array<number | null> = [s0?.type === 'damage_reduce' ? s0.rate : null];
    for (let i = 0; i < 5; i++) {
      applyDamage(ctx, yan, 50, foe, 'physical', 'skill');
      const s = reduceOf(yan);
      rates.push(s?.type === 'damage_reduce' ? s.rate : null);
    }
    expect(rates.map((r) => (r == null ? null : Math.round(r * 1000) / 1000))).toEqual([
      0.8, 0.64, 0.48, 0.32, 0.16, null,
    ]);
    expect(reduceOf(yan)).toBeUndefined();

    // 受击实际扣兵后有 status_changed（受攻击伤害降低效果下降 → 递减后的新值）
    const dropped = eventsOf(ctx, 'status_changed').filter(
      (e) => e.statusType === 'damage_reduce' && e.detail.includes('下降'),
    );
    expect(dropped).toHaveLength(4);
    const shown = eventsOf(ctx, 'status_changed').map((e) => e.detail);
    expect(shown).toContain('【断首何怒】使【严颜】受到伤害降低64%');
    expect(shown).toContain('【断首何怒】使【严颜】受到伤害降低48%');
    expect(shown).toContain('【断首何怒】使【严颜】受到伤害降低32%');
    expect(shown).toContain('【断首何怒】使【严颜】受到伤害降低16%');
    // 第 5 次受击份数归零 → 状态移除
    expect(eventsOf(ctx, 'status_expired').some((e) => e.statusType === 'damage_reduce')).toBe(true);
  });

  it('引擎·衰减类状态同源重挂 = 刷新：受击 2 次（0.48）后再触发 roundStartRepeat → fifths / rate 重置回 5 / 0.8', () => {
    const { ctx, yan, foe } = setup(1);
    forceOnHurtRate(ctx, 0);

    actUnit(ctx, yan); // 回合 1：挂 0.8 / fifths 5
    applyDamage(ctx, yan, 50, foe, 'physical', 'skill');
    applyDamage(ctx, yan, 50, foe, 'physical', 'skill');
    const battered = reduceOf(yan);
    expect(battered?.type).toBe('damage_reduce');
    if (battered?.type === 'damage_reduce') {
      expect(battered.fifths).toBe(3);
      expect(battered.rate).toBeCloseTo(0.48, 5);
    }

    ctx.currentRound = 2;
    actUnit(ctx, yan); // 回合 2 行动 → roundStartRepeat 重挂同源状态 → 刷新回满额
    const refreshed = reduceOf(yan);
    expect(refreshed?.type).toBe('damage_reduce');
    if (refreshed?.type === 'damage_reduce') {
      expect(refreshed.fifths).toBe(5);
      expect(refreshed.fifthsBase).toBe(5);
      expect(refreshed.rate).toBeCloseTo(0.8, 5);
      expect(refreshed.baseRate).toBeCloseTo(0.8, 5);
    }
  });

  it('整场跑通（runBattle·8 回合）：status_inflicted（damage_reduce / damage_boost）与战斗结束事件齐全', () => {
    const yan: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { passiveSkillIds: [SKILL_ID] }),
      position: '前锋',
    };
    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      myTeam: [yan, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted',
    );
    // 每回合行动时刷新自身减伤
    expect(inflicted.some((e) => e.statusType === 'damage_reduce')).toBe(true);
    // 受击反伤挂给伤害来源
    expect(inflicted.some((e) => e.statusType === 'damage_boost')).toBe(true);
  });
});
