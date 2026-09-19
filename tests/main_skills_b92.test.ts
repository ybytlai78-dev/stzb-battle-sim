/**
 * 天子诏令（XP献帝·汉骑 h795 主战法）：指挥 S（一类指挥 prep，效果按「每回合开始时」逐回合展开），
 * 距离 5，敌军单体，发动率 --。
 * 满级：每回合开始时随机点名一名敌军单体，使其受到所有伤害提升 16.0%（受谋略属性影响）、可叠加、
 *   持续至战斗结束；同时使友军全体本回合内主动战法的首次伤害或首次普通攻击 100.0% 几率选中该目标、
 *   无视距离；若回合结束前该目标受到 3 次或以上伤害，则追加一层受伤提升 + 全属性下降 12.0（受谋略）、
 *   可叠加、持续至战斗结束。
 * 1 级：受伤提升 8.0% / 几率 50.0% / 全属性下降 6.0。
 * 官方：scripts/skill_extra.json id 200270。来源 https://stzb.163.com/m/skilllist/200270.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 官方两版拼接（前半「3 次」/ 后半「2 次」，其余文字相同）→ 按仓库清洗口径取**前半 3 次**；
 *   ② 「全属性下降 12.0」官方缺 % → 按**百分比**（同句式「举义诛暴」写 5.0%），推定；
 *   ③ 受伤提升 16% 与全属性下降 12% 的受谋略成长率未给 → 基值不缩放 → 下架；
 *   ④ 首击强制选靶 = 每「单位 × 回合」判定一次（首次伤害与首次普攻先到者，败亦消耗）；
 *   ⑤ 回合内受击计数（每次实际扣兵计 1 次，含多段战法/DoT）恰达 3 次时追加一次，每回合至多 1 次。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  applyDamage,
  triggerCommandSkills,
  triggerImperialDecrees,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  General,
  HeroRecord,
  Position,
  Skill,
  Status,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'tianzi_zhaoling';
const HERO_ID = 'h795';

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

function myTrio(): UnitState[] {
  return [
    heroUnit(HERO_ID, '中军'),
    makeUnit(dummy('mate-a', '前锋'), 'my', 9000),
    makeUnit(dummy('mate-b', '大营'), 'my', 9000),
  ];
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 准备阶段释放一类指挥（登记 lockedCommands），回合数由调用方指定 */
function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(myTrio(), enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const boostOf = (u: UnitState) =>
  u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID
  );
const attrOf = (u: UnitState, type: 'attack_buff' | 'defense_buff' | 'strategy_buff' | 'speed_buff') =>
  u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID);
const punishEvents = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_changed' }> =>
      e.type === 'status_changed' && e.detail.includes('回合内受到 3 次伤害')
  );
const decayTriggersOf = (ctx: CombatContext, unitId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === SKILL_ID && e.unitId === unitId
  );

describe('天子诏令（XP献帝 h795）', () => {
  it('装配：一类指挥 prep·距离 5·敌军单体·imperialDecree（16% / 100% / 3 次 / 12%）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP献帝');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('天子诏令');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual([
      'damage_boost',
      'debuff_attack',
      'debuff_defense',
      'debuff_strategy',
      'debuff_speed',
    ]);
    expect(s.output).toEqual([]);
    expect(s.imperialDecree).toEqual({
      takenBoostRate: 16,
      strategyScaled: true,
      forceTargetRate: 1,
      threshold: 3,
      punishAttrPercent: 12,
    });

    // 受伤提升 / 全属性下降「受谋略」成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·每回合开始点名：随机敌军单体得「受到所有伤害提升 16%」（可叠加、持续至战斗结束）', () => {
    const ctx = prepCtx(7);
    // 只留 1 名存活敌军 → 点名目标确定
    ctx.enemyTeam[1].alive = false;
    ctx.enemyTeam[2].alive = false;
    const foe = ctx.enemyTeam[0];
    const foeMate = ctx.enemyTeam[1];

    ctx.currentRound = 1;
    triggerImperialDecrees(ctx);
    expect(ctx.decrees).toHaveLength(1);
    expect(ctx.decrees![0]).toMatchObject({ round: 1, skillId: SKILL_ID, targetId: foe.general.id });
    const boost = boostOf(foe);
    if (boost?.type !== 'damage_boost') throw new Error('期望 damage_boost');
    expect(boost.direction).toBe('taken'); // 受到伤害提升（非造成）
    expect(boost.rate).toBeCloseTo(0.16, 6);
    expect(boost.remaining).toBeGreaterThanOrEqual(999); // 持续至战斗结束
    // 非点名者不吃
    expect(boostOf(foeMate)).toBeUndefined();
    // 点名事件（战报提示）
    expect(
      ctx.events.some((e) => e.type === 'status_changed' && e.detail.includes('点名为目标'))
    ).toBe(true);

    // 第 2 回合再点名同一目标（唯一存活者）→ 同源显式叠层：数值累加 16% → 32%，仍是同一实例
    ctx.currentRound = 2;
    triggerImperialDecrees(ctx);
    expect(ctx.decrees!.filter((d) => d.round === 2)).toHaveLength(1); // 每回合 1 条点名
    expect(ctx.decrees![ctx.decrees!.length - 1].round).toBe(2);
    expect(ctx.decrees![ctx.decrees!.length - 1].targetId).toBe(foe.general.id);
    expect(foe.statuses.filter((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)).toHaveLength(1);
    expect(boostOf(foe)!.rate).toBeCloseTo(0.32, 6);
  });

  it('机制·点名目标本回合首次普通攻击强制选中（无视距离）：100% 命中点名人', () => {
    const ctx = prepCtx(11);
    ctx.currentRound = 1;
    triggerImperialDecrees(ctx);
    const marked = ctx.decrees![0].targetId;
    const mateA = ctx.myTeam[1];

    actUnit(ctx, mateA);

    const hits = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
        e.type === 'attack_hit' && e.sourceId === mateA.general.id
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // 3 名敌军存活，普通选靶本来随机；首击被强制指向点名目标
    expect(hits[0].targetId).toBe(marked);
    // 判定事件：士气 100 → 100%×1.0，成功
    const triggers = decayTriggersOf(ctx, mateA.general.id);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].success).toBe(true);
    expect(triggers[0].rate).toBe(100);
    expect(triggers[0].targetId).toBe(marked);
  });

  it('机制·主动战法本回合首次伤害同样强制选中点名目标（无视距离）', () => {
    // 友军 mate-a 携带一个 100% 发动的物理主动战法（单体随机）——在构造时挂槽（general 只读）
    const my = [
      heroUnit(HERO_ID, '中军'),
      makeUnit(dummy('mate-a', '前锋', { activeSkillIds: ['test_active'] }), 'my', 9000),
      makeUnit(dummy('mate-b', '大营'), 'my', 9000),
    ];
    const ctx = makeCtx(my, enemyTrio(), 23);
    ctx.currentRound = 0;
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 1;
    triggerImperialDecrees(ctx);
    const marked = ctx.decrees![0].targetId;
    const mateA = ctx.myTeam[1];
    const testActive: Skill = {
      id: 'test_active',
      name: '测试主动',
      type: 'active',
      prepare: false,
      range: 5,
      triggerRate: 1,
      targetMode: 'random_single',
      tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 200 }],
    };
    ctx.skills.set('test_active', testActive);

    actUnit(ctx, mateA);

    const dmg = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === 'test_active'
    );
    expect(dmg).toHaveLength(1);
    expect(dmg[0].targetId).toBe(marked);
    expect(decayTriggersOf(ctx, mateA.general.id)).toHaveLength(1);
  });

  it('机制·「首次」只判定一次：同一单位同回合再次行动不再判定（不再强制选靶）', () => {
    const ctx = prepCtx(13);
    ctx.currentRound = 1;
    triggerImperialDecrees(ctx);
    const mateA = ctx.myTeam[1];

    actUnit(ctx, mateA);
    actUnit(ctx, mateA);

    const hits = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
        e.type === 'attack_hit' && e.sourceId === mateA.general.id
    );
    expect(hits).toHaveLength(2); // 两次普攻都打出
    expect(decayTriggersOf(ctx, mateA.general.id)).toHaveLength(1); // 但只判定一次
    // 第 2 回合重新可判定
    ctx.currentRound = 2;
    triggerImperialDecrees(ctx);
    actUnit(ctx, mateA);
    expect(decayTriggersOf(ctx, mateA.general.id)).toHaveLength(2);
  });

  it('机制·回合内累计受到 3 次伤害：追加一层受伤提升（16%→32%）+ 全属性下降 12%（可叠加）', () => {
    const ctx = prepCtx(17);
    // 只留 1 名存活敌军 → 两回合点名目标都是同一人（跨回合叠层可断言）
    ctx.enemyTeam[1].alive = false;
    ctx.enemyTeam[2].alive = false;
    ctx.currentRound = 1;
    triggerImperialDecrees(ctx);
    const foe = ctx.enemyTeam[0];
    expect(boostOf(foe)!.rate).toBeCloseTo(0.16, 6);

    applyDamage(ctx, foe, 100, undefined, 'physical', 'skill');
    applyDamage(ctx, foe, 100, undefined, 'physical', 'skill');
    expect(punishEvents(ctx)).toHaveLength(0); // 未达阈值
    applyDamage(ctx, foe, 100, undefined, 'physical', 'skill');
    expect(punishEvents(ctx)).toHaveLength(1); // 恰达 3 次触发
    expect(boostOf(foe)!.rate).toBeCloseTo(0.32, 6); // 受伤提升额外叠加一次（同源累加）
    for (const t of ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'] as const) {
      const st = attrOf(foe, t);
      if (!st || !('amount' in st)) throw new Error(`期望 ${t}`);
      expect(st.amount).toBe(-12); // 全属性下降 12%（按百分比，推定）
      expect((st as { percent?: boolean }).percent).toBe(true);
      expect(st.remaining).toBeGreaterThanOrEqual(999);
    }

    // 第 4 次伤害不重复触发（每回合至多 1 次）
    applyDamage(ctx, foe, 100, undefined, 'physical', 'skill');
    expect(punishEvents(ctx)).toHaveLength(1);
    expect(boostOf(foe)!.rate).toBeCloseTo(0.32, 6);

    // 第 2 回合重新计数（点名亦重挂 → 受伤提升 32%+16%=48%，再触发追加 → 64%；全属性再 −12%）
    ctx.currentRound = 2;
    triggerImperialDecrees(ctx);
    expect(boostOf(foe)!.rate).toBeCloseTo(0.48, 6);
    for (let i = 0; i < 3; i++) applyDamage(ctx, foe, 100, undefined, 'physical', 'skill');
    expect(punishEvents(ctx)).toHaveLength(2);
    expect(boostOf(foe)!.rate).toBeCloseTo(0.64, 6);
    const atk = attrOf(foe, 'attack_buff');
    if (!atk || !('amount' in atk)) throw new Error('期望 attack_buff');
    expect(atk.amount).toBe(-24); // 两次追加 → −12% × 2
  });

  it('机制·施法者阵亡后不再点名（一类指挥未标 retainAfterDeath）', () => {
    const ctx = prepCtx(19);
    ctx.currentRound = 1;
    triggerImperialDecrees(ctx);
    const markedId = ctx.decrees![0].targetId;
    const marked = ctx.enemyTeam.find((u) => u.general.id === markedId)!;
    const before = boostOf(marked)!.rate;

    const caster = ctx.myTeam[0];
    caster.alive = false;
    caster.troops = 0;
    ctx.currentRound = 2;
    triggerImperialDecrees(ctx);

    expect(ctx.decrees!.every((d) => d.round !== 2)).toBe(true); // 无新点名
    expect(boostOf(marked)!.rate).toBeCloseTo(before, 6); // 已挂层数不再增加
  });

  it('整场跑通（runBattle·8 回合）：出现点名与首击判定，battle_end 齐全', () => {
    const xianDi: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 909,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), xianDi, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'damage_boost')).toBe(true);
    // 首击强制选靶判定（满级 100%）
    expect(
      report.events.some(
        (e) => e.type === 'skill_trigger' && e.skillId === SKILL_ID && e.success === true
      )
    ).toBe(true);
    // 点名提示
    expect(
      report.events.some((e) => e.type === 'status_changed' && e.detail.includes('点名为目标'))
    ).toBe(true);
  });
});
