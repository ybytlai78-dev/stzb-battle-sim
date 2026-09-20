/**
 * 尽言直谏（田丰·群骑 h692 主战法）：指挥 S（二类指挥：自身每回合行动时判定），距离 3，友军群体，发动率 --。
 * 满级：自身每回合行动时，随机令友方群体 2 个主动战法在下次行动阶段发动率提升 10.0% 且造成的伤害增加 30.0%，
 *   若持续时间内任一战法发动，则下回合可选择 3 个主动战法。1 级：5.0% / 15.0%。
 * 官方：scripts/skill_extra.json id 200966。来源 https://stzb.163.com/m/skilllist/200966.html
 * 口径（策略 A + 用户 2026-09-20 口径；推定处已标注）：
 *   ① 触发 = 二类指挥 on_act（自身行动时）；
 *   ② **持续到目标本次行动结束就消失**（用户口径，非常规「下次行动前递减」）→ 新引擎件
 *      `expireAfterOwnAct` 扩到 damage_boost，由 endUnitAct 在目标行动末清除；
 *   ③ 作用对象「主动战法槽」→ 引擎无槽位机制 → 按**友军单位**施加（随机 2 名其他友军，推定）；
 *   ④ 窗口内任一战法发动 → 下回合取 3 名（`allySlotBoost.firedCount`，窗口监视器）。
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

const SKILL_ID = 'jinyan_zhijian';
const HERO_ID = 'h692';

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

/** 覆盖 allySlotBoost 的取人数（默认 2 在 3 人队里已覆盖全部其他友军，升级到 3 不可观测 → 用 1→3 观测） */
function withCounts(baseCount: number, firedCount: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'command' || !s.allySlotBoost) throw new Error('尽言直谏应为带 allySlotBoost 的指挥战法');
  s.allySlotBoost.baseCount = baseCount;
  s.allySlotBoost.firedCount = firedCount;
  return s;
}

function testActiveSkill(): Skill {
  return {
    id: 't_active',
    name: '测试主动',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
  };
}

const boostOf = (u: UnitState, type: 'trigger_boost' | 'damage_boost') =>
  u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID);

function setup(seed = 1) {
  const tianFeng = heroUnit(HERO_ID, '中军');
  const front = makeUnit(dummy('ally-front', '前锋', { activeSkillIds: ['t_active'] }), 'my', 9000);
  const back = makeUnit(dummy('ally-back', '大营'), 'my', 9000);
  const enemies = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
  const ctx = makeCtx([front, tianFeng, back], enemies, seed);
  ctx.skills.set('t_active', testActiveSkill());
  return { ctx, tianFeng, front, back, enemies };
}

describe('尽言直谏（田丰 h692）', () => {
  it('装配：二类指挥 on_act·距离 3·友军群体·allySlotBoost（2→3 名 / 发动率 +10% / 伤害 +30%）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('田丰');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('尽言直谏');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.range).toBe(3);
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['trigger_boost', 'damage_boost']);
    expect(s.output).toEqual([]);
    expect(s.allySlotBoost).toEqual({ baseCount: 2, firedCount: 3, triggerRate: 0.1, damageRate: 0.3 });

    // 受谋略成长系数未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·自身行动时：随机 2 名**其他**友军各得「主动战法发动率 +10% / 伤害 +30%」（施法者自身不得）', () => {
    const { ctx, tianFeng, front, back } = setup(3);

    actUnit(ctx, tianFeng);

    const buffed = [front, back].filter((u) => boostOf(u, 'trigger_boost'));
    expect(buffed).toHaveLength(2); // 3 人队里「其他友军」正好 2 名
    for (const u of buffed) {
      const tb = boostOf(u, 'trigger_boost');
      if (tb?.type !== 'trigger_boost') throw new Error('期望 trigger_boost');
      expect(tb.rate).toBeCloseTo(0.1, 6);
      expect(tb.skillTypes).toEqual(['active']);
      expect(tb.expireAfterOwnAct).toBe(true);
      const db = boostOf(u, 'damage_boost');
      if (db?.type !== 'damage_boost') throw new Error('期望 damage_boost');
      expect(db.rate).toBeCloseTo(0.3, 6);
      expect(db.direction).toBe('caused');
      expect(db.skillTypes).toEqual(['active']);
      expect(db.expireAfterOwnAct).toBe(true);
    }
    // 施法者自身不在加持名单（其本回合已在行动 → 行动末即失效）
    expect(boostOf(tianFeng, 'trigger_boost')).toBeUndefined();
    expect(ctx.allySlotBoostWatch?.unitIds.sort()).toEqual([front.general.id, back.general.id].sort());
  });

  it('机制·持续到目标行动结束就消失：被加持友军行动末清除（未行动者仍保留）', () => {
    const { ctx, tianFeng, front, back } = setup(7);
    actUnit(ctx, tianFeng);
    expect(boostOf(front, 'trigger_boost')).toBeTruthy();

    actUnit(ctx, front); // 前排友军行动（发动主动战法 + 普攻）→ 行动末清除
    expect(boostOf(front, 'trigger_boost')).toBeUndefined();
    expect(boostOf(front, 'damage_boost')).toBeUndefined();
    expect(eventsOf(ctx, 'status_expired').some((e) => e.unitId === front.general.id)).toBe(true);
    // 尚未行动的友军仍保留（下次行动时才生效、行动末才消失）
    expect(boostOf(back, 'trigger_boost')).toBeTruthy();
    actUnit(ctx, back);
    expect(boostOf(back, 'trigger_boost')).toBeUndefined();
  });

  it('机制·窗口内任一战法发动 → 下回合取 3 名（用 1→3 观测；无发动则维持 1）', () => {
    // ① 有发动：第 1 回合取 1 名，该友军发动主动战法 → 第 2 回合取 min(3, 可用) = 2 名
    const fired = setup(9);
    fired.ctx.skills.set(SKILL_ID, withCounts(1, 3));
    fired.ctx.currentRound = 1;
    actUnit(fired.ctx, fired.tianFeng);
    expect(fired.ctx.allySlotBoostWatch?.unitIds).toHaveLength(1);
    const firstId = fired.ctx.allySlotBoostWatch!.unitIds[0];
    const first = fired.ctx.myTeam.find((u) => u.general.id === firstId)!;
    actUnit(fired.ctx, first); // 被加持者发动主动战法 → 置位
    expect(fired.ctx.allySlotBoostFired).toBe(true);
    fired.ctx.currentRound = 2;
    fired.ctx.myTeam.forEach((u) => (u.hasActedThisRound = false));
    actUnit(fired.ctx, fired.tianFeng);
    // 3 名受「其他友军」只有 2 名限制 → 取满 2 名（相对第 1 回合的 1 名已升级）
    expect(fired.ctx.allySlotBoostWatch?.unitIds).toHaveLength(2);
    expect(fired.ctx.allySlotBoostFired).toBe(false); // 新窗口标记重置

    // ② 无发动：第 2 回合仍取 1 名
    const quiet = setup(9);
    quiet.ctx.skills.set(SKILL_ID, withCounts(1, 3));
    quiet.ctx.currentRound = 1;
    actUnit(quiet.ctx, quiet.tianFeng);
    expect(quiet.ctx.allySlotBoostWatch?.unitIds).toHaveLength(1);
    expect(quiet.ctx.allySlotBoostFired).toBe(false);
    quiet.ctx.currentRound = 2;
    quiet.ctx.myTeam.forEach((u) => (u.hasActedThisRound = false));
    actUnit(quiet.ctx, quiet.tianFeng);
    expect(quiet.ctx.allySlotBoostWatch?.unitIds).toHaveLength(1);
  });

  it('整场跑通（runBattle·8 回合）：每回合行动加持友军、行动末清除，battle_end 齐全', () => {
    const tianFeng: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 1414,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), tianFeng, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const tips = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_changed' }> =>
        e.type === 'status_changed' && e.detail.includes('尽言直谏')
    );
    expect(tips.length).toBeGreaterThanOrEqual(1);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'trigger_boost')).toBe(true);
    expect(report.events.some((e) => e.type === 'status_expired' && e.statusType === 'trigger_boost')).toBe(true);
  });
});
