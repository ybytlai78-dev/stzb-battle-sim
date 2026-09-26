/**
 * 审时定计（XP程昱·魏弓 h787 主战法）：指挥 S（一类指挥 prep），距离 5，敌军全体，发动率 --。
 * 满级：战斗开始后，敌军全体被施加特殊负面效果前，程昱有 50.0% 概率使其本回合受到所有伤害提升 30.0%
 *   （受谋略属性影响）并恢复我军单体一定兵力（恢复率 65.0%，受谋略属性影响）；战斗开始后，我军全体
 *   被施加挑衅、围困以及控制效果时，有 50.0% 概率抵御该负面效果，使其无法施加。1 级：25% / 15% / 32.5%。
 * 官方：scripts/skill_extra.json id 200257。来源 https://stzb.163.com/m/skilllist/200257.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 「特殊负面效果」未定义 → 取本法自身列举（挑衅/围困/控制四类）；
 *   ② 段一输出 = damage_boost taken 30%（本回合 duration 1，受谋略基值）+ 恢复我军**随机**单体（65%）；
 *   ③ 段二 = `CommandSkill.debuffResist`（50% 整段取消，推 status_resisted）；
 *   ④ 两段 50% 均走士气修正；
 *   ⑤ 受谋略成长率未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { inflictStatus, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CommandSkill, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'shenshi_dingji';
const HERO_ID = 'h787';

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
  const ctx = makeCtx(
    [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-a', '前锋'), 'my', 9000), makeUnit(dummy('mate-b', '大营'), 'my', 9000)],
    enemyTrio(),
    seed
  );
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

/** 覆盖两段判定率（1 = 必中 / 0 = 必不中；确定性断言用） */
function setRates(ctx: CombatContext, before?: number, resist?: number): void {
  const def = ctx.skills.get(SKILL_ID) as CommandSkill;
  ctx.skills.set(SKILL_ID, {
    ...def,
    ...(before != null ? { specialDebuffBefore: { ...def.specialDebuffBefore!, rate: before } } : {}),
    ...(resist != null ? { debuffResist: { ...def.debuffResist!, rate: resist } } : {}),
  });
}

const trigs = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID);

describe('审时定计（XP程昱 h787）', () => {
  it('装配：一类指挥 prep·距离 5·敌军全体·specialDebuffBefore + debuffResist·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP程昱');
    expect(hero.faction).toBe('魏');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('审时定计');
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
    expect(s.tags).toEqual(['damage_boost', 'heal']);
    expect(s.output).toEqual([]);
    expect(s.specialDebuffBefore).toEqual({
      rate: 0.5,
      output: [
        { kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.3, duration: 1, direction: 'taken', strategyScaled: true } },
        { kind: 'heal', rate: 65, strategyScaled: true, growthRate: 0, targetSide: 'ally', targetMode: 'random_single' },
      ],
    });
    expect(s.debuffResist).toEqual({
      rate: 0.5,
      statuses: ['taunt', 'siege', 'confusion', 'rampage', 'cowardice', 'hesitation'],
    });

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制①·敌方被施加特殊负面（怯战）前：必中时该敌军 +30% 受伤（本回合）且我军单体被恢复', () => {
    const ctx = prepCtx(3);
    setRates(ctx, 1);
    const foe = ctx.enemyTeam[0];
    // 「我军单体」官方未指定 → 取随机单体：三名友军都制造兵力缺口，保证必被选中
    for (const u of ctx.myTeam) u.troops = 5000;
    const troopsBefore = ctx.myTeam.map((u) => u.troops);

    inflictStatus(ctx, foe, { type: 'cowardice', duration: 2 }, 'active', 'mock_control');
    // 敌军自身负面照常落上（判定在「施加前」）
    expect(foe.statuses.some((s) => s.type === 'cowardice')).toBe(true);
    // ① 受伤提升 30%（本回合）
    const boost = foe.statuses.find(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID
    );
    expect(boost).toBeTruthy();
    expect(boost!.direction).toBe('taken');
    expect(boost!.rate).toBeCloseTo(0.3, 6);
    expect(boost!.remaining).toBe(1);
    // ② 恢复我军随机单体（恰好 1 人、从缺口恢复）
    const heals = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === SKILL_ID
    );
    expect(heals).toHaveLength(1);
    expect(heals[0].amount).toBeGreaterThan(0);
    expect(ctx.myTeam.some((u, i) => u.troops > troopsBefore[i])).toBe(true);
    // ③ 判定走士气修正并逐次发 skill_trigger
    expect(trigs(ctx)).toHaveLength(1);
    expect(trigs(ctx)[0].baseRate).toBe(100); // 本用例覆盖为必中
  });

  it('机制①·判定失败（覆盖 0）与非特殊负面（恐慌）都不触发', () => {
    const ctxFail = prepCtx(5);
    setRates(ctxFail, 0);
    for (const u of ctxFail.myTeam) u.troops = 5000;
    inflictStatus(ctxFail, ctxFail.enemyTeam[0], { type: 'cowardice', duration: 2 }, 'active', 'mock_control');
    expect(
      ctxFail.enemyTeam[0].statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)
    ).toBe(false);
    expect(ctxFail.events.some((e) => e.type === 'heal' && e.skillId === SKILL_ID)).toBe(false);

    const ctxPlain = prepCtx(6);
    setRates(ctxPlain, 1);
    ctxPlain.myTeam[1].troops = 5000;
    // 恐慌（DoT）不在特殊负面清单内
    inflictStatus(ctxPlain, ctxPlain.enemyTeam[0], { type: 'panic', duration: 1, rate: 50, growthRate: 0 }, 'active', 'mock_dot');
    expect(
      ctxPlain.enemyTeam[0].statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)
    ).toBe(false);
    expect(trigs(ctxPlain)).toHaveLength(0);
  });

  it('机制②·抵御：必中时我军受到的挑衅/围困/控制整段取消（status_resisted）；非清单负面照常落上', () => {
    const ctx = prepCtx(7);
    setRates(ctx, undefined, 1);
    const me = ctx.myTeam[1];

    const creates = [
      { type: 'taunt', duration: 2, targetId: me.general.id },
      { type: 'siege', duration: 2 },
      { type: 'cowardice', duration: 2 },
      { type: 'hesitation', duration: 2 },
    ] as const;
    for (const create of creates) {
      inflictStatus(ctx, me, create, 'active', 'mock_debuff');
      expect(me.statuses.some((s) => s.type === create.type), `${create.type} 应被抵御`).toBe(false);
    }
    expect(ctx.events.filter((e) => e.type === 'status_resisted')).toHaveLength(4);

    // 非清单负面（攻击降低）照常生效
    inflictStatus(ctx, me, { type: 'attack_buff', amount: -20, duration: 2 }, 'active', 'mock_debuff');
    expect(me.statuses.some((s) => s.type === 'attack_buff')).toBe(true);
  });

  it('机制②·对照组（覆盖 0）：同样负面正常落上，无 status_resisted', () => {
    const ctx = prepCtx(8);
    setRates(ctx, undefined, 0);
    const me = ctx.myTeam[1];
    inflictStatus(ctx, me, { type: 'cowardice', duration: 2 }, 'active', 'mock_debuff');
    expect(me.statuses.some((s) => s.type === 'cowardice')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'status_resisted')).toBe(false);
  });

  it('整场跑通（runBattle·8 回合）：敌方指挥施加控制时抵御判定出现且 battle_end 齐全', () => {
    const chengYu: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const zhuge: General = { ...withSkills(level40(HERO_REGISTRY['h496']), {}), position: '前锋' };
    const report = runBattle({
      seed: 123,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), chengYu, dummy('a-back', '大营')],
      enemyTeam: [zhuge, dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const own = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    // 敌方【明其虚实】前 2 回合给我军挂犹豫 → 抵御判定必然出现（50% × 3 人 × 2 回合）
    expect(own.length).toBeGreaterThan(0);
  });
});
