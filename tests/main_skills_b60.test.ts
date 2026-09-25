/**
 * 二夫之勇（颜良＆文丑·群骑 h495 主战法）：主动 B，距离 4，敌军群体（有效距离内 2 个目标），发动率 35%。
 * 对敌军群体发动一次攻击（伤害率 140.0%），并使其发动主动战法造成的伤害降低 50.0%、
 * 受到主动战法的伤害提高 25.0%，持续 2 回合。
 * 官方：scripts/skill_extra.json id 200736（主动 B / 距离 4 / 敌军群体（2 目标）/ 兵种骑；
 *   1 级 伤害 70% / 主动降伤 25% / 受主动增伤 12.5%）。来源 https://stzb.163.com/m/skilllist/200736.html
 * 入档：伤害率与两条增减伤均为确定值、无「受属性影响」段 → **上架**（不登记 OFFLINE_MAIN_SKILLS）。
 * 引擎配套（全部既有）：`damage_boost` + `skillTypes:['active']` 过滤（caused −50% / taken +25%）+
 *   `sameTargetsAsLastDamage`（两段打在攻击命中的同一批目标上）；异方向同过滤维**不冲突、各自共存**。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CreateStatus,
  General,
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

const SKILL_ID = 'erfu_zhiyong';
type DamageEvent = Extract<BattleEvent, { type: 'damage' }>;
type HitEvent = Extract<BattleEvent, { type: 'attack_hit' }>;

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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 把发动率拉满（只改 ctx 内副本，不动注册表） */
function forceCast(ctx: CombatContext): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'active') s.triggerRate = 1;
  ctx.skills.set(SKILL_ID, s);
}

/** 测试用纯攻击主动战法（100% 发动、单体、物理 200%）：与注册表无关，直接写入 ctx.skills */
function testActiveSkill(): Skill {
  return {
    id: 'test_active',
    name: '测试主动',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 200 }],
  };
}

/** 二夫之勇的两段增减伤（由同一战法施加，异方向） */
function debuffPair(target: UnitState): CreateStatus[] {
  return [
    {
      type: 'damage_boost',
      rate: -0.5,
      duration: 2,
      direction: 'caused',
      skillTypes: ['active'],
    },
    {
      type: 'damage_boost',
      rate: 0.25,
      duration: 2,
      direction: 'taken',
      skillTypes: ['active'],
    },
  ];
}

/** 颜良＆文丑（前锋）+ 3 敌军（前锋/中军/大营） */
function setup(seed = 1) {
  const caster = heroUnit('h495', '前锋', { activeSkillIds: [SKILL_ID] });
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([caster], foes, seed);
  forceCast(ctx);
  return { caster, foes, ctx };
}

describe('二夫之勇（颜良＆文丑 h495）', () => {
  it('装配：注册表定义（主动·距离4·群体2 + 攻击段 + 两段主动战法增减伤）+ h495 挂槽 + 上架', () => {
    const hero = HERO_REGISTRY['h495'];
    expect(hero.name).toBe('颜良＆文丑');
    expect(hero.mainSkillName).toBe('二夫之勇');
    expect(HERO_RECORDS['h495'].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.35);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.tags).toEqual(['damage', 'damage_boost']);
    expect(s.output).toHaveLength(3);
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 140 });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      sameTargetsAsLastDamage: true,
      status: {
        type: 'damage_boost',
        rate: -0.5,
        duration: 2,
        direction: 'caused',
        skillTypes: ['active'],
      },
    });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      sameTargetsAsLastDamage: true,
      status: {
        type: 'damage_boost',
        rate: 0.25,
        duration: 2,
        direction: 'taken',
        skillTypes: ['active'],
      },
    });

    // 数值均为官方确定值、无受属性缩放段 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(true);
  });

  it('机制：攻击命中有效距离内 2 个目标，两段增减伤打在同一批命中目标上（未命中者不沾）', () => {
    const { caster, foes, ctx } = setup(1);
    actUnit(ctx, caster);

    const hits = eventsOf(ctx, 'damage').filter(
      (e) => e.skillId === SKILL_ID && e.targetId !== caster.general.id,
    );
    expect(hits).toHaveLength(2); // groupCount 2：3 个敌军里取 2
    const hitIds = hits.map((e) => e.targetId).sort();
    expect(new Set(hitIds).size).toBe(2);

    const inflicted = eventsOf(ctx, 'status_inflicted').filter((e) => e.statusType === 'damage_boost');
    expect(inflicted).toHaveLength(4); // 2 目标 × 2 段
    expect([...new Set(inflicted.map((e) => e.unitId))].sort()).toEqual(hitIds);

    for (const id of hitIds) {
      const u = foes.find((f) => f.general.id === id)!;
      const boosts = u.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost',
      );
      expect(boosts).toHaveLength(2);
      // 同战法异方向各自共存；duration 2 = 官方「持续 2 回合」（行动中施加）
      expect(
        boosts
          .map((b) => [b.direction, b.rate, b.skillTypes, b.remaining].join('|'))
          .sort(),
      ).toEqual(
        [
          ['caused', -0.5, ['active'], 2].join('|'),
          ['taken', 0.25, ['active'], 2].join('|'),
        ].sort(),
      );
    }
    // 未被命中的第 3 个敌军不得带任何增减伤
    const untouched = foes.filter((f) => !hitIds.includes(f.general.id));
    expect(untouched).toHaveLength(1);
    expect(untouched[0].statuses.some((s) => s.type === 'damage_boost')).toBe(false);
  });

  it('数值/过滤：两段只在【主动战法】伤害结算时参与（普攻不吃），异方向共存不冲突', () => {
    const ctx = makeCtx([], [], 11);
    ctx.skills.set('test_active', testActiveSkill());
    const mine = makeUnit(dummy('mine', '前锋', { activeSkillIds: ['test_active'] }), 'my');
    const foe = makeUnit(dummy('foe', '前锋', { activeSkillIds: ['test_active'] }), 'enemy');
    ctx.myTeam = [mine];
    ctx.enemyTeam = [foe];
    // 直接挂上二夫之勇的两段（同源、异方向、同过滤维）
    for (const st of debuffPair(foe)) {
      inflictStatus(ctx, foe, st, 'active', SKILL_ID, 'caster');
    }
    expect(eventsOf(ctx, 'status_conflict')).toHaveLength(0); // 异方向不冲突
    expect(foe.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(2);

    // ① 我方主动战法命中敌军 → 敌军身上的 taken +25% 进入结算；我方普攻不吃该段
    actUnit(ctx, mine);
    const skillOnFoe = eventsOf(ctx, 'damage').find(
      (e) => e.skillId === 'test_active' && e.targetId === 'foe',
    );
    expect(skillOnFoe?.modifiers?.taken.map((m) => m.skillId)).toContain(SKILL_ID);
    const basicOnFoe = eventsOf(ctx, 'attack_hit').find((e) => e.targetId === 'foe');
    expect(basicOnFoe?.modifiers?.taken.map((m) => m.skillId) ?? []).not.toContain(SKILL_ID);

    // ② 敌军自身主动战法命中我方 → 敌军身上的 caused −50% 进入结算；其普攻不吃该段
    ctx.events = [];
    actUnit(ctx, foe);
    const skillByFoe = eventsOf(ctx, 'damage').find(
      (e) => e.skillId === 'test_active' && e.sourceId === 'foe',
    );
    expect(skillByFoe?.modifiers?.caused.map((m) => m.skillId)).toContain(SKILL_ID);
    const basicByFoe = eventsOf(ctx, 'attack_hit').find((e) => e.sourceId === 'foe');
    expect(basicByFoe?.modifiers?.caused.map((m) => m.skillId) ?? []).not.toContain(SKILL_ID);
  });

  it('整场跑通（runBattle）：8 回合内正常发动，攻击与两段增减伤事件齐全', () => {
    const hero: General = {
      ...withSkills(level40(HERO_REGISTRY['h495']), { activeSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 23,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), hero, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const casts = report.events.filter((e) => e.type === 'skill_cast' && e.skillId === SKILL_ID).length;
    expect(casts).toBeGreaterThanOrEqual(1);
    // 每次施放：1 次攻击命中 2 个目标 + 每目标 2 段增减伤（caused / taken）
    const dmg: DamageEvent[] = report.events.filter(
      (e): e is DamageEvent => e.type === 'damage' && e.skillId === SKILL_ID,
    );
    expect(dmg.length).toBe(casts * 2);
    const boosts = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost',
    );
    // ≥ 首次施放的 2 目标 × 2 段；同目标再次被施加走 sameSource 累加（既有口径），故不再产生事件
    expect(boosts.length).toBeGreaterThanOrEqual(4);
    expect(report.events.some((e: BattleEvent) => e.type === 'attack_hit')).toBe(true);
  });
});
