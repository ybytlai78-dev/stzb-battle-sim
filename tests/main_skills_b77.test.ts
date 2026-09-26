/**
 * 计谕废立（李儒·群弓 h604 主战法）：主动 A（无准备），距离 5，发动率 30%，目标随机敌军单体。
 * 满级：对敌方单体发动 2 次策略攻击（伤害率 140.0%，受谋略属性影响），并使其分别陷入恐慌和燃烧
 *   状态（伤害率 156.0%，受谋略属性影响），持续 2 回合，2 次目标独立判定。
 * 1 级：策略攻击 70.0% / 恐慌燃烧 78.0%。
 * 官方：scripts/skill_extra.json id 200857（主动 / 距离 5 / 敌军单体 / 兵种弓）。来源 200857 页。
 * 口径（策略 A，照 skills.ts 注释；推定处已标注；零引擎改动）：
 *   ① 两次策略攻击 = 两个独立伤害段（各自 random_single 重选目标）；
 *   ② 恐慌 / 燃烧各跟在对应伤害段之后，落点走 sameTargetsAsLastDamage（该段的命中目标）；
 *   ③ 156% = 每次跳伤率（DoT 口径）；duration 2 → 目标后两次行动各跳 1 次；
 *   ④ 两处「受谋略」成长率未给 → 基值不缩放 → 李儒下架（登记 OFFLINE_MAIN_SKILLS）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, SimpleActiveSkill, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jiyu_fuili';
const HERO_ID = 'h604';

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

function heroUnit(heroId: string, position: Position): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

const damageOf = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID);

/** 释放一次：把发动率临时改为 1 后走 actUnit（跳过 30% 判定，保证确定性；自带普攻不影响按 skillId 的过滤） */
function castOnce(ctx: CombatContext): void {
  const caster = ctx.myTeam[0];
  const def = ctx.skills.get(SKILL_ID) as SimpleActiveSkill;
  ctx.skills.set(SKILL_ID, { ...def, triggerRate: 1 });
  ctx.currentRound = 1;
  actUnit(ctx, caster);
}

describe('计谕废立（李儒 h604）', () => {
  it('装配：主动·无准备·距离 5·30%·两段独立策略攻击 + 各随恐慌/燃烧·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('李儒');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('计谕废立');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入主动槽
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.3);
    expect(s.targetMode).toBe('random_single');
    expect(s.tags).toEqual(['damage', 'panic', 'burning']);
    expect(s.output).toHaveLength(6);
    expect(s.output[0]).toEqual({ kind: 'strategy_damage', rate: 140, strategyScaled: true, targetMode: 'random_single' });
    expect(s.output[3]).toEqual({ kind: 'strategy_damage', rate: 140, strategyScaled: true, targetMode: 'random_single' });
    for (const i of [1, 2, 4, 5]) {
      const seg = s.output[i];
      expect(seg.kind).toBe('inflict_status');
      if (seg.kind !== 'inflict_status') continue;
      expect(seg.sameTargetsAsLastDamage).toBe(true);
      expect(seg.status).toEqual({
        type: i === 1 || i === 4 ? 'panic' : 'burning',
        duration: 2,
        rate: 156,
        growthRate: 0,
      });
    }

    // 两处「受谋略」成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·两段独立选靶 + 状态落点：每次攻击的命中目标各挂恐慌与燃烧（duration 2 / 156%）', () => {
    const ctx = makeCtx([heroUnit(HERO_ID, '中军')], enemyTrio(), 4);
    castOnce(ctx);

    const hits = damageOf(ctx);
    expect(hits).toHaveLength(2); // 「2 次策略攻击」
    expect(hits.every((h) => h.damageType === 'strategy')).toBe(true);
    for (const h of hits) expect(ctx.enemyTeam.some((e) => e.general.id === h.targetId)).toBe(true);

    // 每段命中目标各获得恐慌 + 燃烧（同一来源战法、duration 2、rate 156、growthRate 0）
    for (const h of hits) {
      const foe = ctx.enemyTeam.find((e) => e.general.id === h.targetId)!;
      for (const type of ['panic', 'burning'] as const) {
        const st = foe.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID);
        expect(st, `${h.targetId} 应有 ${type}`).toBeTruthy();
        if (st?.type !== 'panic' && st?.type !== 'burning') continue;
        expect(st.remaining).toBe(2);
        expect(st.rate).toBe(156);
      }
    }
    // 未被两段命中的敌军不带本战法状态
    for (const foe of ctx.enemyTeam) {
      const hit = hits.some((h) => h.targetId === foe.general.id);
      if (hit) continue;
      expect(foe.statuses.some((st) => st.sourceSkillId === SKILL_ID)).toBe(false);
    }
  });

  it('机制·DoT 跳伤：恐慌/燃烧在目标后两次行动各跳 1 次（duration 2），两次后到期移除', () => {
    const ctx = makeCtx([heroUnit(HERO_ID, '中军')], enemyTrio(), 6);
    castOnce(ctx);
    const hits = damageOf(ctx);
    const foe = ctx.enemyTeam.find((e) => e.general.id === hits[0].targetId)!;
    const dotTypes = foe.statuses
      .filter((s) => s.sourceSkillId === SKILL_ID)
      .map((s) => s.type)
      .sort();
    expect(dotTypes).toEqual(['burning', 'panic']);
    const before = foe.troops;

    // 第 1 次行动：两个 DoT 各跳一次
    ctx.currentRound = 1;
    actUnit(ctx, foe);
    const first = foe.statuses.filter((s) => s.sourceSkillId === SKILL_ID);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(foe.troops).toBeLessThan(before);
    expect(ctx.events.some((e) => e.type === 'dot_tick')).toBe(true);

    // 第 2 次行动：再跳一次后到期移除
    ctx.currentRound = 2;
    const afterFirst = foe.troops;
    actUnit(ctx, foe);
    if (foe.alive) {
      expect(foe.troops).toBeLessThan(afterFirst);
      expect(foe.statuses.some((s) => s.sourceSkillId === SKILL_ID)).toBe(false);
    }
  });

  it('数值·策略攻击 140% 按受谋略基值（未确认成长率 → 不缩放）：伤害 > 0 且三分量齐全', () => {
    const ctx = makeCtx([heroUnit(HERO_ID, '中军')], enemyTrio(), 8);
    castOnce(ctx);
    for (const h of damageOf(ctx)) {
      expect(h.damage).toBeGreaterThan(0);
      expect(h.breakdown.troopBase).toBeGreaterThan(0);
      // 谋略基础（受谋略、未确认成长率 → 基值 140%）应为正
      expect(h.breakdown.base).toBeGreaterThan(0);
    }
  });

  it('整场跑通（runBattle·8 回合）：计谕废立伤害/DoT 与 battle_end 齐全', () => {
    const liru: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 12,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), liru, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const hits = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(hits.length).toBeGreaterThan(0);
    const ticks = report.events.filter((e) => e.type === 'dot_tick');
    expect(ticks.length).toBeGreaterThan(0);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'panic')).toBe(true);
    expect(inflicted.some((e) => e.statusType === 'burning')).toBe(true);
  });
});
