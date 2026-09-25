/**
 * 连环计（王允·汉弓 h693 主战法）：主动 A，距离 4，敌军单体，官方发动率 20%-30%（取上界 30%）。
 * 对敌军单体施加连环计，依次发动下列战法：对连环计目标发动一次「伐谋」；
 * 若连环计目标谋略低于自身，则对随机敌军单体发动一次「迷阵」；
 * 若连环计目标处于暴走状态，则对随机敌军单体发动一次「落雷」。每个战法的效果与原战法在同等级下效果相同。
 * 官方：scripts/skill_extra.json id 200714（主动 A / 距离 4 / 敌军单体 / 弓）。
 * 三段全部借用已注册战法（伐谋/迷阵/落雷），自身无数值待定 → 王允**上架**。
 * 引擎配套：新增 `BaseSkill.chainSkills`（战法链）；每步条件在**该步执行时**求值。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { inflictStatus, triggerActiveSkill, hasStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

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

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

/** 发动率拉满的连环计（只考察战法链语义，不掺发动率 RNG） */
function forcedSkill(): Skill {
  const s = structuredClone(SKILL_REGISTRY['lianhuanji']) as Skill;
  s.triggerRate = 1;
  return s;
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function castsOf(ctx: CombatContext) {
  return eventsOf(ctx, 'skill_cast').map((e) => e.skillId);
}

function damagesOf(ctx: CombatContext) {
  return eventsOf(ctx, 'damage');
}

/** 一敌（保证迷阵/落雷的随机目标 = 连环计目标） */
function setup(seed = 3, foeStrategy = 80) {
  const wangyun = heroUnit('h693', '大营', { activeSkillIds: ['lianhuanji'] });
  const foe = makeUnit(dummy('foe', '前锋', { strategy: foeStrategy, troopType: 'archer' }), 'enemy');
  const ctx = makeCtx([wangyun], [foe], seed);
  return { wangyun, foe, ctx };
}

describe('连环计（王允 h693）', () => {
  it('装配：注册表定义（战法链三段）+ h693 挂槽 + 三段全借用已注册战法（上架）', () => {
    const hero = HERO_REGISTRY['h693'];
    expect(hero.name).toBe('王允');
    expect(hero.mainSkillName).toBe('连环计');

    const s = SKILL_REGISTRY['lianhuanji'];
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    // 官方 20%-30% 取上界（满级口径，同 浑水摸鱼/妖术/九锡黄龙 惯例）
    expect(s.triggerRate).toBe(0.3);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.output).toEqual([]); // 本身无输出，全部走战法链
    expect(s.chainSkills).toEqual([
      { skillId: 'famou' },
      { skillId: 'mizhen', targetMode: 'random_single', requireTargetStrategyBelowSelf: true },
      { skillId: 'luolei', targetMode: 'random_single', requireTargetStatus: 'rampage' },
    ]);
    // 被引用的三个战法必须已注册
    for (const id of ['famou', 'mizhen', 'luolei']) expect(SKILL_REGISTRY[id]).toBeTruthy();

    // 无数值待定 → 上架
    expect(OFFLINE_MAIN_SKILLS['lianhuanji']).toBeUndefined();
    expect(isHeroListed({ mainSkillId: 'lianhuanji' })).toBe(true);
  });

  it('第一段：必然对连环计目标发动「伐谋」（策略伤害 + 攻/谋 −45 两回合），事件归属伐谋', () => {
    const { wangyun, foe, ctx } = setup(5, 300); // 目标谋略远高于王允 → ② 不触发
    const before = foe.troops;
    triggerActiveSkill(ctx, wangyun, forcedSkill(), [foe], [wangyun], [foe]);

    const casts = castsOf(ctx);
    expect(casts).toContain('famou');
    const dmg = damagesOf(ctx).filter((d) => d.skillId === 'famou');
    expect(dmg).toHaveLength(1);
    expect(dmg[0].targetId).toBe(foe.general.id);
    expect(foe.troops).toBeLessThan(before);
    // 伐谋的攻/谋 −45 落在连环计目标
    const debuffs = foe.statuses.filter(
      (st): st is Extract<UnitState['statuses'][number], { type: 'attack_buff' }> =>
        st.type === 'attack_buff',
    );
    expect(debuffs[0]?.amount).toBe(-45);
    expect(foe.statuses.some((st) => st.type === 'strategy_buff')).toBe(true);
    // 谋略远高于自身 → 第二段跳过、且无暴走 → 第三段跳过
    expect(casts).not.toContain('mizhen');
    expect(casts).not.toContain('luolei');
  });

  it('第二段条件「谋略低于自身」在**该步执行时**求值：伐谋先降 45 谋略，使略高于自身的目标也满足', () => {
    const { wangyun, foe, ctx } = setup(7, 0);
    // 目标谋略 = 王允谋略 + 30：单看初始不满足，但 ① 伐谋先降 45 → 满足
    foe.general.strategy = wangyun.general.strategy + 30;

    triggerActiveSkill(ctx, wangyun, forcedSkill(), [foe], [wangyun], [foe]);
    const casts = castsOf(ctx);
    expect(casts).toContain('famou');
    expect(casts).toContain('mizhen'); // ← 依赖「伐谋先执行并降谋略」
  });

  it('第三段条件「处于暴走状态」：② 迷阵命中主目标挂暴走 → ③ 落雷随后触发（单敌场景）', () => {
    const { wangyun, foe, ctx } = setup(9, 0);
    // 单敌 + 目标谋略低于王允 → ② 迷阵的随机目标只能是主目标 → 挂暴走 → ③ 满足
    triggerActiveSkill(ctx, wangyun, forcedSkill(), [foe], [wangyun], [foe]);
    const casts = castsOf(ctx);
    // 本体 skill_cast 由 executeSkillWithTargets 发；其后依次为战法链三段
    expect(casts.filter((id) => id !== 'lianhuanji')).toEqual(['famou', 'mizhen', 'luolei']);
    // 暴走（迷阵）+ 混乱（落雷）都在目标身上
    expect(hasStatus(foe, 'rampage')).toBe(true);
    expect(hasStatus(foe, 'confusion')).toBe(true);
    // 三段各有自己的伤害事件（归属各自战法）
    const ids = damagesOf(ctx).map((d) => d.skillId);
    expect(ids).toContain('famou');
    expect(ids).toContain('mizhen');
    expect(ids).toContain('luolei');
  });

  it('第三段可独立满足：预先给连环计目标挂暴走 → 即使 ② 因谋略条件跳过，③ 仍结算', () => {
    const { wangyun, foe, ctx } = setup(11, 300); // 谋略远高于自身 → ② 跳过
    inflictStatus(
      ctx,
      foe,
      { type: 'rampage', duration: 2 },
      'active',
      'test_rampage',
      wangyun.general.id,
    );
    triggerActiveSkill(ctx, wangyun, forcedSkill(), [foe], [wangyun], [foe]);
    const casts = castsOf(ctx);
    expect(casts).toContain('famou');
    expect(casts).not.toContain('mizhen'); // ② 条件不满足
    expect(casts).toContain('luolei'); // ③ 条件由预挂暴走满足
  });

  it('整场战斗：连环计多次发动，三段事件按被引用战法归属', () => {
    const wangyun = {
      ...withSkills(level40(HERO_REGISTRY['h693']), { activeSkillIds: ['lianhuanji'] }),
      position: '大营' as Position,
    };
    const report = runBattle({
      seed: 71,
      maxRounds: 8,
      myTeam: [dummy('ally-a', '前锋'), dummy('ally-b', '中军'), wangyun],
      enemyTeam: [dummy('foe-a', '前锋'), dummy('foe-b', '中军'), dummy('foe-c', '大营')],
    });

    const chainCasts = report.events.filter(
      (e) =>
        e.type === 'skill_cast' &&
        ['famou', 'mizhen', 'luolei'].includes((e as { skillId: string }).skillId),
    );
    expect(chainCasts.length).toBeGreaterThan(0);
    // 连环计本体发动（skill_cast 归属 lianhuanji —— runChainSkills 只发被引用战法的事件，
    // 本体 skill_cast 由 executeSkillWithTargets 发）
    const own = report.events.filter(
      (e) => e.type === 'skill_cast' && (e as { skillId: string }).skillId === 'lianhuanji',
    );
    expect(own.length).toBeGreaterThan(0);
  });
});
