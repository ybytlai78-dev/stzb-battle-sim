/**
 * 持刀从武（XP周仓·蜀步 h691 主战法）：被动 A（round_start：自身每回合行动时），距离 5，敌军单体。
 * 满级：自身每回合行动时，每次有 75.0% 概率对友军大营上次行动阶段造成伤害的目标发动一次攻击
 *   （伤害率 100.0%），重复三次，每次目标独立判定。当该攻击目标处于控制状态时，对同一目标的
 *   伤害率每次递增 20.0%。
 * 1 级：伤害率 50.0%（概率 75% 与递增 20% 同值）。
 * 官方：scripts/skill_extra.json id 200965（被动 / 距离 5 / 敌军单体 / 兵种步；effect 攻击伤害）。
 *   来源 https://stzb.163.com/m/skilllist/200965.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 新引擎件 `PassiveSkill.lastActStrike`：3 次独立 75% 判定（士气修正）+ 100% 攻击；
 *   ② 记忆池 = `ctx.lastActDamageTargets`（actUnit 记账 / endUnitAct 落账，只记本人行动阶段内实际扣兵目标）；
 *      池空 → 整段空转（官方未写兜底，推定）；
 *   ③ 每次判定成功后从记忆池独立随机抽 1 人（「每次目标独立判定」）；
 *   ④ 目标处于控制状态（混乱/暴走/怯战/犹豫）时，按本次行动内对同一目标已打出次数递增 20%
 *      （100 → 120 → 140；计数不跨回合、不跨行动，推定）。
 * 测试用 ctx.skills 覆盖把 chance 置 1（确定性断言用；覆盖须早于 actUnit——resolveSkill 每次读表）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, PassiveSkill, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'chidao_congwu';
const HERO_ID = 'h691';

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

/** 敌军三件套（30000 兵力，避免被打死影响后续行动） */
function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 我方三件套：周仓（前锋）+ 中军友军 + 大营（记忆来源） */
function myTrio(): UnitState[] {
  return [heroUnit(HERO_ID, '前锋'), makeUnit(dummy('mate-mid', '中军'), 'my', 9000), makeUnit(dummy('back-hill', '大营'), 'my', 9000)];
}

const ownDamage = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID);
const ownTriggers = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID);

/** 把持刀从武改成必中（3 次全中）——确定性断言用 */
function forceHit(ctx: CombatContext): void {
  const def = ctx.skills.get(SKILL_ID) as PassiveSkill;
  ctx.skills.set(SKILL_ID, {
    ...def,
    lastActStrike: { ...def.lastActStrike!, chance: 1 },
  } as PassiveSkill);
}

describe('持刀从武（XP周仓 h691）', () => {
  it('装配：被动 round_start·距离 5·lastActStrike{3×75%·100%·递增20}·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP周仓');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('持刀从武');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入被动槽
    expect(hero.passiveSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('round_start');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(1);
    expect(s.tags).toEqual(['damage']);
    expect(s.output).toEqual([]);
    expect(s.lastActStrike).toEqual({ attempts: 3, chance: 0.75, rate: 100, ratePerRepeatOnControl: 20 });

    // 无「受属性影响」段、无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·记忆池空转：大营本局尚未造成伤害时，3 次攻击完全不发动（无 skill_trigger / 无 damage）', () => {
    const ctx = makeCtx(myTrio(), enemyTrio(), 3);
    actUnit(ctx, ctx.myTeam[0]); // 周仓先行动：大营还没出手
    expect(ownTriggers(ctx)).toHaveLength(0);
    expect(ownDamage(ctx)).toHaveLength(0);
  });

  it('机制·记忆池 = 大营上次行动阶段造成伤害的目标：3 次独立判定，命中只落在记忆目标上', () => {
    const ctx = makeCtx(myTrio(), enemyTrio(), 5);
    const back = ctx.myTeam[2];
    actUnit(ctx, back); // 大营行动：普攻命中 1 个敌军 → 落账记忆

    const memory = ctx.lastActDamageTargets?.get(back.general.id) ?? [];
    expect(memory).toHaveLength(1); // 普攻单体
    const foe = ctx.enemyTeam.find((e) => e.general.id === memory[0]);
    expect(foe).toBeTruthy();

    actUnit(ctx, ctx.myTeam[0]); // 周仓行动 → 被动 round_start 判定
    const triggers = ownTriggers(ctx);
    expect(triggers).toHaveLength(3); // 「重复三次」
    expect(triggers.every((t) => t.baseRate === 75 && t.rate === 75 && t.morale === 100)).toBe(true);

    const hits = ownDamage(ctx);
    expect(hits.length).toBe(triggers.filter((t) => t.success).length); // 每次成功打一次
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(3);
    // 每次目标独立判定，但都在记忆池内（此处记忆池只有 1 人）
    for (const h of hits) expect(h.targetId).toBe(memory[0]);
    expect(hits.every((h) => h.sourceId === ctx.myTeam[0].general.id)).toBe(true);
  });

  it('机制·控制状态递增：目标带混乱 → 同一目标 100%/120%/140%；不带控制 → 三次同为 100%（main 线性）', () => {
    const strike = (withControl: boolean) => {
      const ctx = makeCtx(myTrio(), enemyTrio(), 17);
      forceHit(ctx); // chance 1 → 三次全中（确定性）
      const back = ctx.myTeam[2];
      actUnit(ctx, back);
      const memory = ctx.lastActDamageTargets?.get(back.general.id) ?? [];
      const foe = ctx.enemyTeam.find((e) => e.general.id === memory[0])!;
      if (withControl) {
        inflictStatus(ctx, foe, { type: 'confusion', duration: 3 }, 'active', 'mock_control');
        expect(foe.statuses.some((st) => st.type === 'confusion')).toBe(true);
      }
      actUnit(ctx, ctx.myTeam[0]);
      const hits = ownDamage(ctx);
      expect(hits).toHaveLength(3);
      return hits.map((h) => h.breakdown.main);
    };

    const plain = strike(false);
    // 无控制：三次伤害率都是 100% → main 完全相同（main 不消耗 RNG、只随伤害率线性）
    expect(plain[0]).toBe(plain[1]);
    expect(plain[1]).toBe(plain[2]);

    const controlled = strike(true);
    // 有控制：第 2/3 次对同一目标 +20/+40 → main ×1.2 / ×1.4
    expect(Math.abs(controlled[0] - plain[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(controlled[1] - plain[0] * 1.2)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlled[2] - plain[0] * 1.4)).toBeLessThanOrEqual(1);
  });

  it('机制·落账口径：记忆只记该单位本人行动阶段内实际造成伤害的目标（他人行动不落账）', () => {
    const ctx = makeCtx(myTrio(), enemyTrio(), 23);
    const [zhouchang, mate] = ctx.myTeam;
    // 中军友军行动 → 落账到中军自己名下，而不是大营
    actUnit(ctx, mate);
    const mateMemory = ctx.lastActDamageTargets?.get(mate.general.id) ?? [];
    expect(mateMemory.length).toBeGreaterThan(0);
    expect(ctx.lastActDamageTargets?.get('back-hill')).toBeUndefined();

    // 周仓行动：大营尚无记忆 → 空转；随后周仓自己的普攻会被记到周仓名下（不影响本次判定顺序）
    actUnit(ctx, zhouchang);
    expect(ownDamage(ctx)).toHaveLength(0);
    expect(ctx.lastActDamageTargets?.get(zhouchang.general.id)?.length ?? 0).toBeGreaterThan(0);
  });

  it('整场跑通（runBattle·8 回合）：第 2 回合起大营有记忆 → 出现持刀从武攻击与判定事件', () => {
    const zhouchang: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '前锋' };
    const report = runBattle({
      seed: 9,
      maxRounds: 8,
      myTeam: [zhouchang, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const triggers = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    const ownHits = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(triggers.length).toBeGreaterThan(0);
    expect(ownHits.length).toBeGreaterThan(0);
    // 3 次一组：每组判定数必为 3 的倍数
    expect(triggers.length % 3).toBe(0);
  });
});
