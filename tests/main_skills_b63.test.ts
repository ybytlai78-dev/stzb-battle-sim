/**
 * 知人待士（汉·刘备 h803 主战法）：指挥 A·Ⅱ 类，距离 5，目标我军单体。
 * 每回合行动时，有 45.0% 几率触发以下两种效果，两者独立判断：
 *  ① 我军兵力最低单体恢复一定兵力（恢复率 120.0%，受谋略属性影响）并使其受到所有伤害减少 15.0%
 *     （受谋略属性影响），持续 1 回合；
 *  ② 自身对敌军兵力最低单体发动一次策略攻击（伤害率 120.0%，受谋略属性影响），
 *     并使我军攻击属性最高单体对敌军单体发动一次攻击（伤害率 100.0%）。
 * 官方：scripts/skill_extra.json id 200286（指挥 A / 距离 5 / 我军单体 / 兵种弓步骑；
 *   1 级 恢复 60% / 减伤 7.5% / 策略 60% / 代打 50%）。来源 https://stzb.163.com/m/skilllist/200286.html
 * 入档：**下架** —— 恢复 / 减伤 / 策略三段「受谋略属性影响」而官方未给成长系数（按基值不缩放）
 *   → 登记 OFFLINE_MAIN_SKILLS。
 * 引擎配套：`heal.targetPick:'lowest_troops_ally'` + `heal.attachStatus`（同一目标续挂减伤）+
 *   `DamageTargetPick` 新增 `'lowest_troops_in_range'`；「两者独立判断」= 两段各自 chance_group(0.45)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { triggerRoundCommandOnAct, type CombatContext } from '../src/engine/action';
import { calcHealAmount } from '../src/engine/formulas';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'zhiren_daishi';

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
    preparations: [],
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
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

/** 克隆注册表定义并把两段 chance_group 的判定率改成确定值（不动注册表，仅 ctx 内副本） */
function withGroupChances(c1: number, c2: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'command') throw new Error('知人待士应为指挥战法');
  const groups = s.output.filter(
    (o): o is Extract<SkillOutput, { kind: 'chance_group' }> => o.kind === 'chance_group',
  );
  groups[0].chance = c1;
  groups[1].chance = c2;
  return s;
}

function damages(ctx: CombatContext) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID,
  );
}

function heals(ctx: CombatContext) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === SKILL_ID,
  );
}

/**
 * 刘备（h803，中军，9000 兵）+ 兵力最低友军（3000）+ 攻击最高友军（12000/攻击 300）
 * + 三名兵力递减的敌军（30000 / 15000 / 4000）。
 */
function setup(seed = 3) {
  const liubei = heroUnit('h803', '中军', { commandSkillIds: [SKILL_ID] });
  const weakAlly = makeUnit(dummy('ally-weak', '前锋', { attack: 80, strategy: 60 }), 'my', 3000);
  const hitter = makeUnit(dummy('ally-hit', '大营', { attack: 300, strategy: 60 }), 'my', 12000);
  const foes = [
    makeUnit(dummy('foe-strong', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 15000),
    makeUnit(dummy('foe-weak', '大营'), 'enemy', 4000),
  ];
  const ctx = makeCtx([weakAlly, liubei, hitter], foes, seed);
  return { ctx, liubei, weakAlly, hitter, foes };
}

describe('知人待士（汉·刘备 h803）', () => {
  it('装配：注册表定义（Ⅱ 类指挥 on_act / 两段 45% 独立判定 / 恢复+减伤 / 策略+代打）+ h803 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h803'];
    expect(hero.name).toBe('刘备');
    expect(hero.mainSkillName).toBe('知人待士');
    expect(HERO_RECORDS['h803'].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(s.triggerRate).toBe(1); // 45% 由两段 chance_group 承载，指挥自身必然进入判定
    expect(s.dynamicTriggerRate).toBeUndefined();
    expect(s.tags).toEqual(['heal', 'damage_reduce', 'damage']);

    // 效果①：我军兵力最低单体恢复 120%（受谋略，成长未确认 → growthRate 0 = 基值）
    expect(s.output[0]).toMatchObject({
      kind: 'chance_group',
      chance: 0.45,
      outputs: [
        {
          kind: 'heal',
          rate: 120,
          strategyScaled: true,
          growthRate: 0,
          targetSide: 'ally',
          targetPick: 'lowest_troops_ally',
          attachStatus: { type: 'damage_reduce', rate: 0.15, duration: 1, strategyScaled: true },
        },
      ],
    });
    // 效果②：自身策略攻击敌军兵力最低单体 120%（受谋略）+ 我军攻击最高单体代打 100%
    expect(s.output[1]).toMatchObject({
      kind: 'chance_group',
      chance: 0.45,
      outputs: [
        { kind: 'strategy_damage', rate: 120, strategyScaled: true, targetPick: 'lowest_troops_in_range' },
        { kind: 'physical_damage', rate: 100, attacker: 'highest_attack_ally', targetMode: 'random_single' },
      ],
    });

    // 三段受谋略成长率未确认 → 下架（等待 derive_growth_rate 反解）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('机制·两段各自独立判定：只开①时只恢复+挂减伤；只开②时只打伤害（互不牵连）', () => {
    // ① 开、② 关
    const onlyHeal = setup(5);
    onlyHeal.ctx.skills.set(SKILL_ID, withGroupChances(1, 0));
    triggerRoundCommandOnAct(onlyHeal.ctx, onlyHeal.liubei);
    expect(heals(onlyHeal.ctx)).toHaveLength(1);
    expect(
      onlyHeal.ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'damage_reduce'),
    ).toBe(true);
    expect(damages(onlyHeal.ctx)).toHaveLength(0);

    // ① 关、② 开
    const onlyHit = setup(5);
    onlyHit.ctx.skills.set(SKILL_ID, withGroupChances(0, 1));
    triggerRoundCommandOnAct(onlyHit.ctx, onlyHit.liubei);
    expect(damages(onlyHit.ctx)).toHaveLength(2); // 效果②是「一次判定、两段同时结算」
    expect(heals(onlyHit.ctx)).toHaveLength(0);
    expect(
      onlyHit.ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'damage_reduce'),
    ).toBe(false);
  });

  it('机制·效果①选靶与数值：恢复打在**我军兵力最低**单体上，减伤挂**同一目标**，恢复率 120% 按施法者兵力', () => {
    const { ctx, liubei, weakAlly, hitter } = setup(7);
    ctx.skills.set(SKILL_ID, withGroupChances(1, 0));
    const before = weakAlly.troops;
    triggerRoundCommandOnAct(ctx, liubei);

    // 恢复：目标 = 兵力最低友军（3000），heal 归属施法者刘备
    const h = heals(ctx);
    expect(h).toHaveLength(1);
    expect(h[0].targetId).toBe(weakAlly.general.id);
    expect(h[0].sourceId).toBe(liubei.general.id);
    // 9000 兵力 × 120%：floor(round(300×9000/12500) × 1.2) = floor(216 × 1.2) = 259
    expect(h[0].amount).toBe(calcHealAmount(liubei.troops, 120));
    expect(h[0].amount).toBe(259);
    expect(weakAlly.troops).toBe(before + 259);

    // 减伤：**同一目标**（不是攻击最高的友军），15% 受谋略（成长未确认 → 基值 0.15 不缩放）、持续 1 回合
    const reduce = weakAlly.statuses.find((s) => s.type === 'damage_reduce');
    expect(reduce).toMatchObject({
      rate: 0.15,
      remaining: 1,
      sourceSkillId: SKILL_ID,
    });
    expect(hitter.statuses).toHaveLength(0);
    expect(liubei.statuses).toHaveLength(0);
  });

  it('机制·效果②选靶与代打：策略段打**敌军兵力最低**单体（刘备出手），代打段由攻击最高友军出手、杀伤归刘备', () => {
    const { ctx, liubei, hitter, foes } = setup(9);
    ctx.skills.set(SKILL_ID, withGroupChances(0, 1));
    triggerRoundCommandOnAct(ctx, liubei);

    const dmg = damages(ctx);
    expect(dmg).toHaveLength(2);
    const strat = dmg.find((d) => d.damageType === 'strategy')!;
    const phys = dmg.find((d) => d.damageType === 'physical')!;

    // 策略段：刘备自身出手，目标 = 敌军兵力最低的「敌弱」（4000，非 30000/15000 的两个）
    expect(strat.sourceId).toBe(liubei.general.id);
    expect(strat.targetId).toBe(foes[2].general.id);
    expect(strat.creditToId).toBeUndefined();
    // 代打段：我军攻击最高友军出手（刘备攻击约 124 < 300），随机单体，杀伤统计归刘备
    expect(phys.sourceId).toBe(hitter.general.id);
    expect(phys.creditToId).toBe(liubei.general.id);
    expect(foes.map((f) => f.general.id)).toContain(phys.targetId);
    expect(foes[2].troops).toBeLessThan(4000); // 兵力最低者确实挨打
  });

  it('整场跑通（runBattle）：每段 skill_trigger baseRate 45，恢复/减伤/伤害事件齐全', () => {
    const liubei: General = {
      ...withSkills(level40(HERO_REGISTRY['h803']), { commandSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('a-weak', '前锋'), liubei, dummy('a-hit', '大营', { attack: 300 })],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    // 两段各自 45% 独立判定（士气 100 → 生效几率 45%）；指挥自身 triggerRate 1 的 100% 事件另计
    const trig = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === SKILL_ID && e.unitId === 'h803',
    );
    const segTrig = trig.filter((e) => e.baseRate === 45);
    expect(segTrig.length).toBeGreaterThan(0);
    expect(segTrig.every((e) => e.rate === 45)).toBe(true); // 士气 100：生效几率 = 基础率
    expect(trig.every((e) => e.baseRate === 45 || e.baseRate === 100)).toBe(true);

    // 效果①（减伤状态必然随命中段落下）/ 效果②（两段伤害）在 8 回合内均出现过
    const reduceApplied = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce',
    );
    expect(reduceApplied.length).toBeGreaterThan(0);
    expect(reduceApplied.every((e) => e.detail.includes('0.15'))).toBe(true);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID,
    );
    expect(dmg.length).toBeGreaterThanOrEqual(2);
    expect(dmg.some((e) => e.damageType === 'strategy')).toBe(true);
    expect(dmg.some((e) => e.damageType === 'physical' && e.creditToId === 'h803')).toBe(true);
  });
});
