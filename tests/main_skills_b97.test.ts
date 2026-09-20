/**
 * 自擅江表（XP孙权·吴弓 h808 主战法）：主动 S（无准备），距离 5，敌我群体，发动率 50%。
 * 满级：对友军群体发动一次攻击（伤害率 60.0%）并恢复自身一定兵力（恢复率 120.0%，受谋略属性影响），
 *   随后对敌军群体发动一次猛烈的策略攻击（伤害率 160.0%，受谋略属性影响），每次发动后，
 *   此策略攻击的伤害率增加 30.0%（受谋略属性影响），可叠加，持续至战斗结束。1 级：30/60/80/15。
 * 官方：scripts/skill_extra.json id 200283。来源 https://stzb.163.com/m/skilllist/200283.html
 * 口径（策略 A + 用户 2026-09-20 口径；推定处已标注）：
 *   ① 「对友军群体发动一次攻击」= **官方原文、非笔误**（用户 2026-09-20 确认）→ 段级 targetSide:'ally' + group 2 目标
 *      （按仓库 allies 口径含施法者自身，**推定**）；
 *   ② 恢复自身 120%（受谋略未确认 → growthRate 0 基值）；
 *   ③ 敌人段策略攻击 160%（受谋略未确认 → 基值）+ ④ **段级** ratePerCast: 30（只作用于策略段，友军段不涨）；
 *   ⑤ 三处受谋略成长系数未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'zishan_jiangbiao';
const HERO_ID = 'h808';

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

function heroUnit(heroId: string, position: Position): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 克隆定义并覆盖发动率 / 策略段递增（50% 掷骰与递增对比都要确定） */
function withTweaks(opts: { triggerRate?: number; ratePerCast?: number }): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'active') throw new Error('自擅江表应为主动战法');
  if (opts.triggerRate != null) s.triggerRate = opts.triggerRate;
  if (opts.ratePerCast != null) {
    const seg = s.output.find((o) => o.kind === 'strategy_damage');
    if (!seg || seg.kind !== 'strategy_damage') throw new Error('缺少策略段');
    seg.ratePerCast = opts.ratePerCast;
  }
  return s;
}

function setup(seed = 1) {
  const sunQuan = heroUnit(HERO_ID, '中军');
  const front = makeUnit(dummy('ally-front', '前锋'), 'my', 9000);
  const back = makeUnit(dummy('ally-back', '大营'), 'my', 9000);
  const enemies = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
  const ctx = makeCtx([front, sunQuan, back], enemies, seed);
  return { ctx, sunQuan, front, back, enemies };
}

describe('自擅江表（XP孙权 h808）', () => {
  it('装配：主动·距离 5·50%·三段（友军群体攻击 60 / 恢复自身 120 / 敌军群体策略 160 递增 30）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP孙权');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('自擅江表');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.5);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.tags).toEqual(['damage', 'heal', 'damage_boost']);
    expect(s.output).toEqual([
      { kind: 'physical_damage', rate: 60, targetSide: 'ally', targetMode: 'group', groupCount: 2 },
      { kind: 'heal', target: 'self', rate: 120, strategyScaled: true, growthRate: 0 },
      {
        kind: 'strategy_damage',
        rate: 160,
        strategyScaled: true,
        targetSide: 'enemy',
        targetMode: 'group',
        groupCount: 2,
        ratePerCast: 30,
      },
    ]);

    // 三处受谋略成长系数未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·三段结算：先打友军群体（2 目标），再恢复自身，最后对敌军群体策略攻击（2 目标）', () => {
    const { ctx, sunQuan, front, back } = setup(5);
    ctx.skills.set(SKILL_ID, withTweaks({ triggerRate: 1 }));

    actUnit(ctx, sunQuan);

    const myIds = new Set([sunQuan.general.id, front.general.id, back.general.id]);
    // ① 友军段：物理伤害，目标是**我方**单位（官方「对友军群体发动一次攻击」）
    const phys = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID && e.damageType === 'physical');
    expect(phys).toHaveLength(2);
    expect(phys.every((e) => myIds.has(e.targetId))).toBe(true);
    expect(phys[0]?.breakdown.troopBase).toBeGreaterThan(0);
    // ② 恢复自身
    const heals = eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID);
    expect(heals).toHaveLength(1);
    expect(heals[0]?.targetId).toBe(HERO_ID);
    // ③ 敌军段：策略伤害 2 目标
    const strat = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID && e.damageType === 'strategy');
    expect(strat).toHaveLength(2);
    expect(strat.every((e) => !myIds.has(e.targetId))).toBe(true);
    // 段序：友军伤害 → 恢复 → 策略伤害
    const order = eventsOf(ctx, 'damage')
      .filter((e) => e.skillId === SKILL_ID)
      .map((e) => e.damageType);
    expect(order).toEqual(['physical', 'physical', 'strategy', 'strategy']);
  });

  it('机制·「每次发动后此策略攻击伤害率 +30%」：第二发策略伤害高于无递增对照，第一发一致', () => {
    const run = (ratePerCast: number) => {
      const { ctx, sunQuan } = setup(11);
      ctx.skills.set(SKILL_ID, withTweaks({ triggerRate: 1, ratePerCast }));
      actUnit(ctx, sunQuan); // 第 1 次发动
      actUnit(ctx, sunQuan); // 第 2 次发动
      return eventsOf(ctx, 'damage')
        .filter((e) => e.skillId === SKILL_ID && e.damageType === 'strategy')
        .map((e) => e.damage);
    };
    const inc = run(30);
    const flat = run(0);
    expect(inc).toHaveLength(4); // 两发 × 2 目标
    expect(flat).toHaveLength(4);
    // 第 1 发：递增段未积累 → 与对照一致
    expect(inc[0]).toBe(flat[0]);
    expect(inc[1]).toBe(flat[1]);
    // 第 2 发：伤害率 160 → 190（+30 个百分点）→ 伤害显著更高
    expect(inc[2]).toBeGreaterThan(flat[2]);
    expect(inc[3]).toBeGreaterThan(flat[3]);
  });

  it('整场跑通（runBattle·8 回合）：友军段/恢复/敌军段均出现，battle_end 齐全', () => {
    const sunQuan: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 518,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), sunQuan, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const mine = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(mine.some((e) => e.damageType === 'physical')).toBe(true);
    expect(mine.some((e) => e.damageType === 'strategy')).toBe(true);
    expect(
      report.events.some((e) => e.type === 'heal' && e.skillId === SKILL_ID)
    ).toBe(true);
  });
});
