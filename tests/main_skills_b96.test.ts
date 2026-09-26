/**
 * 锦车持节（冯嫽·汉骑 h812 主战法）：指挥 S（一类指挥 prep，效果按「每回合开始前」逐回合判定），
 * 距离 5，敌军单体，发动率 --。
 * 满级：每回合开始前有 50.0% 几率（受谋略属性影响）使敌军单体本回合内陷入以下两种状态之一：
 *   造成所有伤害大幅降低；陷入暴走状态，且攻击距离与主动战法距离 −2。以上效果触发后，
 *   在回合结束时额外恢复我军兵力最低单体一定兵力（恢复率 150.0%，受谋略属性影响）。1 级：25% / 75%。
 * 官方：scripts/skill_extra.json id 200295。来源 https://stzb.163.com/m/skilllist/200295.html
 * 口径（策略 A + 用户 2026-09-20 口径；推定处已标注）：
 *   ① 每回合开始前 50% = 新引擎件 `CommandSkill.roundStartChance`（士气修正 + 逐回合 skill_trigger）；
 *   ② 「两种状态之一」= `random_pick(count:1)` 50/50（三军夺帅先例，推定）；
 *   ③ 状态一「造成所有伤害大幅降低」= 极大值 → caused 侧 rate −99.99、duration 1（本回合内）；
 *   ④ 状态二 = 同目标三段（暴走 + 攻击距离 −2 + 主动战法距离 −2，applyAll）、duration 1（推定）；
 *   ⑤ 触发后回合末额外恢复我军兵力最低单体 150%（受谋略未确认 → 基值）→ 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { triggerCommandSkills, triggerRoundEndChanceOutputs, triggerRoundStartChance, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, SkillOutput, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jinche_chijie';
const HERO_ID = 'h812';

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

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 克隆定义并把「每回合开始前几率」钉成确定值（50% 掷骰会让机制断言不确定） */
function withChance(chance: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'command' || !s.roundStartChance) throw new Error('锦车持节应为带 roundStartChance 的指挥战法');
  s.roundStartChance.chance = chance;
  return s;
}

/** 冯嫽 + 前锋（兵力 1000，可被恢复）/ 大营 友军 + 3 名敌军；chance 给定时在**准备阶段之前**覆盖几率 */
function setup(seed = 1, chance?: number) {
  const fengLiao = heroUnit(HERO_ID, '中军');
  const front = makeUnit(dummy('ally-front', '前锋'), 'my', 1000);
  const back = makeUnit(dummy('ally-back', '大营'), 'my', 30000);
  const enemies = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
  const ctx = makeCtx([front, fengLiao, back], enemies, seed);
  // 覆盖必须发生在 triggerCommandSkills **之前**（一类指挥把 l.skill 对象锁进 lockedCommands）
  if (chance != null) ctx.skills.set(SKILL_ID, withChance(chance));
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, fengLiao);
  ctx.currentRound = 1;
  return { ctx, fengLiao, front, back, enemies };
}

/** 本回合被施加的状态落在哪个敌人身上（状态一 caused 减伤 / 状态二 暴走+距离） */
function gateStates(ctx: CombatContext) {
  return ctx.enemyTeam
    .filter((u) => u.statuses.some((s) => s.sourceSkillId === SKILL_ID))
    .map((u) => u.statuses.filter((s) => s.sourceSkillId === SKILL_ID));
}

describe('锦车持节（冯嫽 h812）', () => {
  it('装配：一类指挥 prep·距离 5·敌军单体·roundStartChance（50% / 两种状态 / 回合末恢复 150%）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('冯嫽');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('锦车持节');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command' || !s.roundStartChance) return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.output).toEqual([]);
    expect(s.roundStartChance.chance).toBe(50);
    expect(s.roundStartChance.strategyScaled).toBe(true);
    expect(s.roundStartChance.roundEndOutput).toEqual([
      { kind: 'heal', rate: 150, strategyScaled: true, growthRate: 0, targetPick: 'lowest_troops_ally' },
    ]);
    const pick = s.roundStartChance.output[0];
    if (pick.kind !== 'random_pick') throw new Error('应为 random_pick 二选一');
    expect(pick.count).toBe(1);
    expect(pick.options).toHaveLength(2);
    expect(pick.options[0]).toEqual([
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'random_single',
        status: { type: 'damage_boost', rate: -99.99, duration: 1, direction: 'caused' },
      },
    ]);
    expect(pick.options[1]).toEqual([
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'random_single',
        applyAll: true,
        status: [
          { type: 'rampage', duration: 1 },
          { type: 'range_buff', amount: -2, duration: 1 },
          { type: 'skill_range_buff', amount: -2, duration: 1 },
        ],
      },
    ]);

    // 两处「受谋略」成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·每回合开始前判定：命中后敌军单体陷入「两种状态之一」（同目标、duration 1）；未命中不发状态', () => {
    const hit = setup(4, 100);
    triggerRoundStartChance(hit.ctx);

    const rolls = eventsOf(hit.ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]?.baseRate).toBe(100);
    expect(rolls[0]?.success).toBe(true);

    const applied = gateStates(hit.ctx);
    expect(applied).toHaveLength(1); // 敌军单体：同一目标
    const [states] = applied;
    const types = states.map((s) => s.type).sort();
    if (states.length === 1) {
      // 状态一：造成所有伤害大幅降低（极大值 −9999%，本回合内）
      expect(states[0]).toMatchObject({ type: 'damage_boost', direction: 'caused', rate: -99.99, remaining: 1 });
    } else {
      // 状态二：暴走 + 攻击距离 −2 + 主动战法距离 −2（三段同目标）
      expect(types).toEqual(['rampage', 'range_buff', 'skill_range_buff']);
      const rangeBuff = states.find((s) => s.type === 'range_buff') as Extract<Status, { type: 'range_buff' }>;
      const skillRange = states.find((s) => s.type === 'skill_range_buff') as Extract<Status, { type: 'skill_range_buff' }>;
      expect(rangeBuff.amount).toBe(-2);
      expect(skillRange.amount).toBe(-2);
      expect(states.every((s) => (s as { remaining?: number }).remaining === 1)).toBe(true);
    }

    const miss = setup(4, 0);
    triggerRoundStartChance(miss.ctx);
    expect(eventsOf(miss.ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID)[0]?.success).toBe(false);
    expect(gateStates(miss.ctx)).toHaveLength(0);
  });

  it('机制·「两种状态之一」50/50：多种子下两支都会出现', () => {
    const seen = new Set<'reduce' | 'rampage'>();
    for (let seed = 1; seed <= 40; seed++) {
      const { ctx } = setup(seed, 100);
      triggerRoundStartChance(ctx);
      const states = gateStates(ctx)[0] ?? [];
      if (states.length === 0) continue;
      seen.add(states.length === 1 ? 'reduce' : 'rampage');
    }
    expect(seen.has('reduce')).toBe(true);
    expect(seen.has('rampage')).toBe(true);
  });

  it('机制·回合结束恢复：仅「本回合已触发」时恢复我军兵力最低单体（150%）', () => {
    const hit = setup(6, 100);
    triggerRoundStartChance(hit.ctx);
    triggerRoundEndChanceOutputs(hit.ctx);
    const heals = eventsOf(hit.ctx, 'heal').filter((e) => e.skillId === SKILL_ID);
    expect(heals).toHaveLength(1);
    expect(heals[0]?.targetId).toBe('ally-front'); // 兵力最低（1000）
    expect(heals[0]?.amount).toBeGreaterThan(0);
    expect(hit.front.troops).toBe(1000 + (heals[0]?.amount ?? 0));

    // 未触发 → 回合末不恢复
    const miss = setup(6, 0);
    triggerRoundStartChance(miss.ctx);
    triggerRoundEndChanceOutputs(miss.ctx);
    expect(eventsOf(miss.ctx, 'heal').filter((e) => e.skillId === SKILL_ID)).toHaveLength(0);
    expect(miss.front.troops).toBe(1000);
  });

  it('整场跑通（runBattle·8 回合）：每回合判定 + 触发回合的回合末恢复出现，battle_end 齐全', () => {
    const fengLiao: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 8080,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), fengLiao, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const rolls = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    expect(rolls.length).toBeGreaterThanOrEqual(1);
    expect(rolls.some((e) => e.success)).toBe(true);
    const heals = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === SKILL_ID
    );
    expect(heals.length).toBeGreaterThanOrEqual(1);
  });
});
