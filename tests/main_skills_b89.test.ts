/**
 * 衔命建功（XP周瑜·吴步 h784 主战法）：指挥 S（一类指挥 prep），距离 5，敌军全体，发动率 --。
 * 满级：敌军全体每回合首次受到持续性伤害时，周瑜有 50.0% 几率对其发动一次策略攻击（伤害率 140.0%，
 *   受谋略属性影响）；第 3 回合起，敌军武将陷入持续性伤害时，立即额外引发一次该持续性伤害。
 * 1 级：策略攻击 70.0%。
 * 官方：scripts/skill_extra.json id 200254。来源 https://stzb.163.com/m/skilllist/200254.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① onDotReceived：敌方本回合首次吃 DoT 伤害（跳伤/引燃/引爆）后 50% 判定 → 对该敌军策略攻击 140%
 *      （去重键 `${回合}:${战法}:${单位}`，按目标、跨来源不重置，推定）；
 *   ② extraTickOnDotApply{startRound:3}：DoT 挂上后立即额外跳 1 次（= 原 DoT 一次跳伤，推定）；
 *   ③ 受谋略成长率未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CommandSkill, General, HeroRecord, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'xianming_jiangong';
const HERO_ID = 'h784';

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

function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx([heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-a', '前锋'), 'my', 9000)], enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

/** 覆盖 onDotReceived 判定率（1 = 必中 / 0 = 必不中） */
function setDotRate(ctx: CombatContext, rate: number): void {
  const def = ctx.skills.get(SKILL_ID) as CommandSkill;
  ctx.skills.set(SKILL_ID, { ...def, onDotReceived: { ...def.onDotReceived!, rate } });
}

const dotTicks = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'dot_tick' }> => e.type === 'dot_tick');
const punishHits = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
  );

describe('衔命建功（XP周瑜 h784）', () => {
  it('装配：一类指挥 prep·距离 5·敌军全体·onDotReceived + extraTickOnDotApply{startRound 3}·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP周瑜');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('衔命建功');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual(['damage']);
    expect(s.output).toEqual([]);
    expect(s.onDotReceived).toEqual({
      rate: 0.5,
      output: [{ kind: 'strategy_damage', rate: 140, strategyScaled: true }],
    });
    expect(s.extraTickOnDotApply).toEqual({ startRound: 3 });

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制①·敌军每回合首次吃 DoT（必中）→ 对其发动一次策略攻击；同回合第二次 DoT 不再判定；下回合恢复', () => {
    const ctx = prepCtx(3);
    setDotRate(ctx, 1);
    const foe = ctx.enemyTeam[0];
    const caster = ctx.myTeam[1];
    // 同一回合挂两个 DoT（燃烧 + 恐慌）：目标行动时各跳一次
    inflictStatus(ctx, foe, { type: 'burning', duration: 2, rate: 100, growthRate: 0 }, 'active', 'mock_dot', caster.general.id);
    inflictStatus(ctx, foe, { type: 'panic', duration: 2, rate: 100, growthRate: 0 }, 'active', 'mock_dot', caster.general.id);
    ctx.currentRound = 1;
    actUnit(ctx, foe);

    expect(dotTicks(ctx).length).toBeGreaterThanOrEqual(2); // 两个 DoT 各跳一次
    const hits = punishHits(ctx);
    expect(hits).toHaveLength(1); // 「每回合首次」只判定一次
    expect(hits[0].targetId).toBe(foe.general.id);
    expect(hits[0].damageType).toBe('strategy');
    const trigs = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    expect(trigs).toHaveLength(1);
    expect(trigs[0].targetId).toBe(foe.general.id);

    // 下一回合再吃 DoT → 重新判定
    ctx.currentRound = 2;
    actUnit(ctx, foe);
    expect(punishHits(ctx)).toHaveLength(2);
  });

  it('机制①·判定失败（覆盖 0）→ 有 DoT 跳伤但无策略攻击', () => {
    const ctx = prepCtx(5);
    setDotRate(ctx, 0);
    const foe = ctx.enemyTeam[0];
    const caster = ctx.myTeam[1];
    inflictStatus(ctx, foe, { type: 'burning', duration: 2, rate: 100, growthRate: 0 }, 'active', 'mock_dot', caster.general.id);
    ctx.currentRound = 1;
    actUnit(ctx, foe);
    expect(dotTicks(ctx).length).toBeGreaterThanOrEqual(1);
    expect(punishHits(ctx)).toHaveLength(0);
  });

  it('机制②·第 3 回合起陷入 DoT 立即额外引发一次；第 2 回合不触发', () => {
    const ctxEarly = prepCtx(7);
    const foeEarly = ctxEarly.enemyTeam[0];
    ctxEarly.currentRound = 2;
    inflictStatus(ctxEarly, foeEarly, { type: 'burning', duration: 2, rate: 100, growthRate: 0 }, 'active', 'mock_dot', ctxEarly.myTeam[1].general.id);
    expect(dotTicks(ctxEarly)).toHaveLength(0); // 第 2 回合：只挂上，不额外跳

    const ctxLate = prepCtx(8);
    const foeLate = ctxLate.enemyTeam[0];
    ctxLate.currentRound = 3;
    inflictStatus(ctxLate, foeLate, { type: 'burning', duration: 2, rate: 100, growthRate: 0 }, 'active', 'mock_dot', ctxLate.myTeam[1].general.id);
    expect(dotTicks(ctxLate)).toHaveLength(1); // 立即额外引发一次
    expect(dotTicks(ctxLate)[0].targetId).toBe(foeLate.general.id);
  });

  it('整场跑通（runBattle·8 回合）：友军李儒上 DoT → 周瑜判定出现且 battle_end 齐全', () => {
    const zhouyu: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const liru: General = { ...withSkills(level40(HERO_REGISTRY['h604']), {}), position: '前锋' };
    const report = runBattle({
      seed: 333,
      maxRounds: 8,
      myTeam: [liru, zhouyu, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const trigs = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    expect(trigs.length).toBeGreaterThan(0);
    const dotTicks = report.events.filter((e) => e.type === 'dot_tick');
    expect(dotTicks.length).toBeGreaterThan(0);
  });
});
