/**
 * 奇门遁甲（XP左慈·群骑 h802 主战法）：主动 A，距离 5，目标自己，发动率 65%。
 * 满级 = 1 级（无等级数值差）：「使自身随机发动除自身外的敌我全体所有主动战法中的 1 个，跳过全部准备回合」。
 * 官方：scripts/skill_extra.json id 200279（主动 A / 距离 5 / 目标自己；`effect` 标签为空字符串，
 *   发动几率区间 30%-65% → 仓库口径取上界 = 65%）。
 *   来源 https://stzb.163.com/m/skilllist/200279.html
 * 入档：**上架** —— 无「受属性影响」段、无数值缺口（不登记 OFFLINE_MAIN_SKILLS，上架池 77 → 78）。
 * 引擎配套（本提交新增 `BaseSkill.copyRandomActive`）：最外层发动时收集**除施法者自身外**敌我全体存活单位的
 *   `activeSkillIds`（去重，仅注册表里 type='active' 者，含准备型主动），`ctx.rng` 随机取 1 个，
 *   直接执行其 `output`（跳过准备段与发动率判定）——事件/战报归属**被复制战法**（skill_target + skill_cast，
 *   同连环计 chainSkills 口径）；目标池按被复制战法自身的 targetMode/targetSide/range/groupCount 现算；
 *   无候选 / 空目标池则空转（不抛错、不发事件）。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, triggerActiveSkill, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'qimen_dunjia';
const HERO_ID = 'h802';

/** 测试注入的「被复制战法」id（敌方携带，ctx.skills.set 注入） */
const COPIED_ID = 'test_copied_active';
const COPIED_PREPARE_ID = 'test_copied_prepared';
/** 自身槽位里的主动战法（仅用于证明「除自身外」——永远不该被复制） */
const SELF_ID = 'test_self_active';
/** 敌我重复的同一战法 / 另一不同战法（用于去重断言） */
const COPIED_A = 'test_copied_a';
const COPIED_B = 'test_copied_b';
/** runBattle 用真实注册的主动战法（落雷：主动·距离 4·随机敌军单体·策略伤害 148 + 混乱） */
const REAL_COPIED_ID = 'luolei';

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

/** 把 ctx 内奇门遁甲副本的发动率拉满（机制断言不依赖 RNG 点数；只改副本不动注册表） */
function forceCast(ctx: CombatContext): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'active') s.triggerRate = 1;
  ctx.skills.set(SKILL_ID, s);
}

/** 被复制战法：随机敌军单体 + 物理伤害 200%（prepare=false / true 两种） */
function copiedDamageSkill(id: string, prepare = false): Skill {
  if (prepare) {
    return {
      id,
      name: id,
      type: 'active',
      prepare: true,
      prepareTurns: 1,
      range: 5,
      triggerRate: 1,
      targetMode: 'random_single',
      tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 200 }],
    };
  }
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 200 }],
  };
}

/** 被复制战法：目标自己 + 无输出（仅用于候选计数 / 空转断言，不产生目标随机） */
function copiedSelfSkill(id: string): Skill {
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'self',
    tags: [],
    output: [],
  };
}

describe('奇门遁甲（XP左慈 h802）', () => {
  it('装配：主动·65%·距离5·自己 / tags[] + copyRandomActive + output[] · h802 挂槽 · 上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP左慈');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('奇门遁甲');
    expect(HERO_RECORDS[HERO_ID].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.65);
    expect(s.targetMode).toBe('self');
    // 官方 effect 为空 → 无固有 effect 标签（被复制战法的效果不参与本战法的冲突判定）
    expect(s.tags).toEqual([]);
    expect(s.copyRandomActive).toBe(true);
    expect(s.output).toEqual([]);

    // 无「受属性影响」段、无数值缺口 → 上架（不登记 OFFLINE_MAIN_SKILLS）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID])).toBe(true);
  });

  it('机制·复制发动：敌方带 1 个主动战法 → skill_cast / damage 归属被复制战法（不是奇门遁甲）', () => {
    const zuoci = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID] });
    const foe = makeUnit(dummy('foe-front', '前锋', { activeSkillIds: [COPIED_ID] }), 'enemy');
    const ctx = makeCtx([zuoci], [foe], 1);
    ctx.skills.set(COPIED_ID, copiedDamageSkill(COPIED_ID));
    forceCast(ctx);

    actUnit(ctx, zuoci);

    const casts = eventsOf(ctx, 'skill_cast');
    expect(casts.some((e) => e.skillId === SKILL_ID)).toBe(true);
    expect(casts.some((e) => e.skillId === COPIED_ID)).toBe(true);

    // 伤害事件归属被复制战法（skillId = 被复制战法），来源仍是左慈，目标为敌军
    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === COPIED_ID);
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.sourceId === HERO_ID)).toBe(true);
    expect(dmg.every((e) => e.targetId === 'foe-front')).toBe(true);
    expect(eventsOf(ctx, 'damage').some((e) => e.skillId === SKILL_ID)).toBe(false);

    // skill_target / skill_cast 与 chainSkills 同款：skillId = 被复制战法
    const st = eventsOf(ctx, 'skill_target').filter((e) => e.skillId === COPIED_ID);
    expect(st).toHaveLength(1);
    expect(st[0]?.targetIds).toEqual(['foe-front']);
  });

  it('机制·跳过准备：候选为准备型主动 → 左慈当回合直接打出其伤害，无准备事件 / isPreparing 不置位', () => {
    const zuoci = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID] });
    const foe = makeUnit(dummy('foe-front', '前锋', { activeSkillIds: [COPIED_PREPARE_ID] }), 'enemy');
    const ctx = makeCtx([zuoci], [foe], 1);
    ctx.skills.set(COPIED_PREPARE_ID, copiedDamageSkill(COPIED_PREPARE_ID, true));
    forceCast(ctx);

    actUnit(ctx, zuoci);

    // 准备型战法被直接执行 → 本回合就出伤害（若走准备则本回合无伤害、下回合才释放）
    expect(eventsOf(ctx, 'damage').some((e) => e.skillId === COPIED_PREPARE_ID)).toBe(true);
    expect(eventsOf(ctx, 'skill_cast').some((e) => e.skillId === COPIED_PREPARE_ID)).toBe(true);
    // 跳过全部准备回合：不进入准备、无 prepare_* 事件
    expect(zuoci.isPreparing).toBe(false);
    expect(zuoci.preparingSkillId).toBeNull();
    expect(eventsOf(ctx, 'prepare_start')).toHaveLength(0);
    expect(eventsOf(ctx, 'prepare_end')).toHaveLength(0);
  });

  it('机制·除自身外 + 去重 + 空转：自身主动不被选中；敌我同战法按 1 个候选计；无候选空转', () => {
    // ① 只有自身带主动战法（奇门 + 自身战法）→ 候选 0 → 空转：无被复制事件、连候选随机都不掷
    const selfOnly = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID, SELF_ID] });
    const foeSolo = makeUnit(dummy('foe-front', '前锋'), 'enemy');
    const ctx1 = makeCtx([selfOnly], [foeSolo], 1);
    ctx1.skills.set(SELF_ID, copiedSelfSkill(SELF_ID));
    forceCast(ctx1);
    const intArgs1: number[] = [];
    const origInt1 = ctx1.rng.int.bind(ctx1.rng);
    ctx1.rng.int = (n: number) => {
      intArgs1.push(n);
      return origInt1(n);
    };
    triggerActiveSkill(ctx1, selfOnly, ctx1.skills.get(SKILL_ID)!, ctx1.enemyTeam, ctx1.myTeam, ctx1.enemyTeam);
    expect(eventsOf(ctx1, 'skill_cast').filter((e) => e.skillId !== SKILL_ID)).toHaveLength(0);
    expect(eventsOf(ctx1, 'damage')).toHaveLength(0);
    expect(intArgs1).toEqual([]); // 无候选 → return，不调用 ctx.rng.int

    // ② 敌我各 1 个单位带同一战法 A（重复）+ 另 1 个不同战法 B → 去重后候选 = 2（[A,B]）而非 3
    const caster2 = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID] });
    const ally2 = makeUnit(dummy('ally-front', '前锋', { activeSkillIds: [COPIED_A] }), 'my');
    const foeA = makeUnit(dummy('foe-a', '前锋', { activeSkillIds: [COPIED_A] }), 'enemy');
    const foeB = makeUnit(dummy('foe-b', '中军', { activeSkillIds: [COPIED_B] }), 'enemy');
    const ctx2 = makeCtx([caster2, ally2], [foeA, foeB], 7);
    ctx2.skills.set(COPIED_A, copiedSelfSkill(COPIED_A));
    ctx2.skills.set(COPIED_B, copiedSelfSkill(COPIED_B));
    forceCast(ctx2);
    const intArgs2: number[] = [];
    const origInt2 = ctx2.rng.int.bind(ctx2.rng);
    ctx2.rng.int = (n: number) => {
      intArgs2.push(n);
      return origInt2(n);
    };
    triggerActiveSkill(ctx2, caster2, ctx2.skills.get(SKILL_ID)!, ctx2.enemyTeam, ctx2.myTeam, ctx2.enemyTeam);
    // 同一战法去重后候选 2 个（未去重会是 3）；被复制战法 targetMode:'self' → 无其它 int 调用
    expect(intArgs2).toEqual([2]);
    const copied2 = eventsOf(ctx2, 'skill_cast').filter((e) => e.skillId !== SKILL_ID);
    expect(copied2).toHaveLength(1);
    expect([COPIED_A, COPIED_B]).toContain(copied2[0]?.skillId);
    // 自身槽位里的奇门遁甲（以及自身其它主动）不参与候选；被复制目标 = 施法者自身
    expect(eventsOf(ctx2, 'skill_target').filter((e) => e.skillId !== SKILL_ID)[0]?.targetIds).toEqual([HERO_ID]);
  });

  it('整场跑通（runBattle·8 回合）：奇门遁甲 + 被复制战法（落雷）skill_cast 与 battle_end 齐全', () => {
    const zuoci: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { activeSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 3,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), zuoci, dummy('a-back', '大营')],
      enemyTeam: [
        dummy('e-front', '前锋'),
        dummy('e-mid', '中军', { activeSkillIds: [REAL_COPIED_ID] }),
        dummy('e-back', '大营'),
      ],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast',
    );
    expect(casts.some((e) => e.skillId === SKILL_ID)).toBe(true);
    // 被复制战法归属施法者左慈（场上亦有敌方单位自己发动落雷 → 必须按 unitId 锁定是复制段）
    expect(casts.some((e) => e.skillId === REAL_COPIED_ID && e.unitId === HERO_ID)).toBe(true);
  });
});
