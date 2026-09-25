/**
 * 潜谋远计（羊祜·晋步 h709 主战法）：指挥 S，距离 5，官方目标「自己」。
 * 战斗中前 4 回合自身受到伤害时，有 60.0% 几率使自身恢复一定兵力（恢复率 100.0%，受谋略属性影响）
 * 并使谋略属性和防御属性提高 15.0，可叠加，持续至战斗结束；第 5 回合起，每回合行动时，
 * 对谋略低于自身的敌军全体有 60.0% 几率造成一次策略攻击（伤害率 140.0%，受谋略属性影响）。
 * 仅对自身处于前锋或中军位置时生效。
 * 官方：scripts/skill_extra.json id 200991（指挥 S / 距离 5 / 自己 / 兵种步；1 级 恢复 50% / 属性 7.5 / 伤害 70%）。
 * 入档：三段数值均「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 羊祜**下架**。
 * 引擎配套：`BaseSkill.casterPositions`（整次生效的站位条件）+ `strategy_damage.requireTargetStrategyBelowSelf`
 *   （「谋略低于自身」逐目标过滤），另复用 onHurt（前 4 回合受击）与 roundStartRepeat（第 5 回合起）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { applyDamage, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'qianmou_yuanji';

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

/** 把受击判定率 / 回合段几率拉满（只考察机制语义，不掺 RNG） */
function forceProcs(ctx: CombatContext, hurtRate = 1, roundChance = 1): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'command') return;
  if (s.onHurt && !Array.isArray(s.onHurt)) s.onHurt.rate = hurtRate;
  const rsOut = s.roundStartRepeat?.output[0];
  if (rsOut && 'chance' in rsOut) rsOut.chance = roundChance;
  ctx.skills.set(SKILL_ID, s);
}

/** 羊祜（默认前锋）+ 3 敌军（默认谋略 80 < 羊祜） */
function setup(seed = 1, position: Position = '前锋', enemyStrategy: number[] = [80, 80, 80]) {
  const yanghu = heroUnit('h709', position, { commandSkillIds: [SKILL_ID] });
  const foes = enemyStrategy.map((st, i) =>
    makeUnit(dummy(`foe-${i + 1}`, (['前锋', '中军', '大营'] as Position[])[i], { strategy: st }), 'enemy'),
  );
  const ctx = makeCtx([yanghu], foes, seed);
  forceProcs(ctx); // 必须在 triggerCommandSkills 之前替换（回合段锁的是注册时的实例）
  return { yanghu, foes, ctx };
}

describe('潜谋远计（羊祜 h709）', () => {
  it('装配：注册表定义（站位条件 + 受击段 + 第 5 回合段）+ h709 挂槽 + 受谋略成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h709'];
    expect(hero.name).toBe('羊祜');
    expect(hero.mainSkillName).toBe('潜谋远计');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetSide).toBe('enemy');
    expect(s.targetMode).toBe('all');
    expect(s.casterPositions).toEqual(['前锋', '中军']);
    expect(s.output).toEqual([]);

    // 前 4 回合受击段
    expect(s.onHurt).toMatchObject({ victim: 'self', rate: 0.6, endRound: 4, applyTo: 'victim' });
    const hurtOut = Array.isArray(s.onHurt) ? s.onHurt[0].output : s.onHurt?.output;
    expect(hurtOut).toMatchObject([
      { kind: 'heal', rate: 100, strategyScaled: true, target: 'self' },
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 15, duration: 999, strategyScaled: true } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 15, duration: 999, strategyScaled: true } },
    ]);

    // 第 5 回合起每回合行动时段
    expect(s.roundStartRepeat?.startRound).toBe(5);
    expect(s.roundStartRepeat?.output[0]).toMatchObject({
      kind: 'strategy_damage',
      rate: 140,
      strategyScaled: true,
      chance: 0.6,
      requireTargetStrategyBelowSelf: true,
    });

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('站位条件：前锋/中军生效；大营时整次不生效（无锁定目标、受击也不触发）', () => {
    // 前锋：正常注册
    const front = setup(1, '前锋');
    triggerCommandSkills(front.ctx, front.yanghu);
    expect(front.ctx.lockedCommands).toHaveLength(1);

    // 大营：整次不生效
    const back = setup(1, '大营');
    triggerCommandSkills(back.ctx, back.yanghu);
    expect(back.ctx.lockedCommands).toHaveLength(0);

    const before = back.yanghu.troops;
    applyDamage(back.ctx, back.yanghu, 1000, back.foes[0], 'physical', 'skill');
    expect(back.yanghu.troops).toBe(before - 1000); // 只吃伤害，不触发恢复/属性
    expect(eventsOf(back.ctx, 'heal')).toHaveLength(0);
    expect(back.yanghu.statuses.filter((s) => s.type === 'strategy_buff')).toHaveLength(0);
  });

  it('前 4 回合受击：60% 判定成功后恢复自身兵力 + 谋略/防御 +15（可叠加至战斗结束）', () => {
    const { yanghu, foes, ctx } = setup(3, '前锋');
    triggerCommandSkills(ctx, yanghu);
    expect(yanghu.troops).toBe(9000);

    applyDamage(ctx, yanghu, 1200, foes[0], 'physical', 'skill');
    const heals = eventsOf(ctx, 'heal');
    expect(heals).toHaveLength(1);
    expect(heals[0].targetId).toBe('h709');
    expect(heals[0].amount).toBeGreaterThan(0);

    const strategyBuff = yanghu.statuses.find((s) => s.type === 'strategy_buff');
    const defenseBuff = yanghu.statuses.find((s) => s.type === 'defense_buff');
    expect(strategyBuff && 'amount' in strategyBuff ? strategyBuff.amount : 0).toBe(15);
    expect(defenseBuff && 'amount' in defenseBuff ? defenseBuff.amount : 0).toBe(15);
    expect(strategyBuff && 'remaining' in strategyBuff ? strategyBuff.remaining : 0).toBe(999);

    // 同一战法重复触发：数值累加（可叠加）→ 30
    applyDamage(ctx, yanghu, 1200, foes[0], 'physical', 'skill');
    const strategyBuffs = yanghu.statuses.filter((s) => s.type === 'strategy_buff');
    expect(strategyBuffs).toHaveLength(1);
    expect(strategyBuffs[0] && 'amount' in strategyBuffs[0] ? strategyBuffs[0].amount : 0).toBe(30);
    expect(eventsOf(ctx, 'heal')).toHaveLength(2);
  });

  it('受击只在第 1~4 回合生效：第 5 回合起受击不再触发恢复/叠加', () => {
    const { yanghu, foes, ctx } = setup(5, '前锋');
    triggerCommandSkills(ctx, yanghu);
    ctx.currentRound = 5;
    applyDamage(ctx, yanghu, 1200, foes[0], 'physical', 'skill');
    expect(eventsOf(ctx, 'heal')).toHaveLength(0);
    expect(yanghu.statuses.filter((s) => s.type === 'strategy_buff')).toHaveLength(0);
  });

  it('第 5 回合起每回合行动时：只对**谋略低于自身**的敌军全体造成策略攻击', () => {
    // 敌军谋略：80、300（高于羊祜）、100
    const { yanghu, foes, ctx } = setup(7, '中军', [80, 300, 100]);
    triggerCommandSkills(ctx, yanghu);
    expect(foes.map((f) => f.general.strategy)).toEqual([80, 300, 100]);
    const selfStrategy = yanghu.general.strategy;
    expect(selfStrategy).toBeGreaterThan(100); // 40 级羊祜谋略 ≈159

    // 第 4 回合及以前：不结算
    ctx.currentRound = 4;
    tickRoundStartStatuses(ctx);
    expect(eventsOf(ctx, 'damage')).toHaveLength(0);

    // 第 5 回合：对谋略低于自身的两名敌军造成策略伤害（300 那名跳过）
    ctx.currentRound = 5;
    tickRoundStartStatuses(ctx);
    const dmg = eventsOf(ctx, 'damage');
    expect(dmg.map((d) => d.targetId).sort()).toEqual(['foe-1', 'foe-3']);
    expect(dmg.every((d) => d.damageType === 'strategy' && d.skillId === SKILL_ID)).toBe(true);
    expect(foes[1].troops).toBe(30000); // 谋略高于自身 → 未被打

    // 第 6 回合再来一次
    ctx.currentRound = 6;
    tickRoundStartStatuses(ctx);
    expect(eventsOf(ctx, 'damage')).toHaveLength(4);
  });

  it('整场跑通（runBattle）：前锋位羊祜第 5 回合起产生策略伤害', () => {
    const yanghu: General = {
      ...withSkills(level40(HERO_REGISTRY['h709']), { commandSkillIds: [SKILL_ID] }),
      position: '前锋',
    };
    const report = runBattle({
      seed: 13,
      maxRounds: 8,
      myTeam: [yanghu, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    const byRound = new Map<number, number>();
    let round = 0;
    for (const ev of report.events) {
      if (ev.type === 'round_start') round = ev.round;
      if (ev.type === 'damage' && ev.skillId === SKILL_ID) byRound.set(round, (byRound.get(round) ?? 0) + 1);
    }
    expect(byRound.size).toBeGreaterThan(0);
    expect(Math.min(...byRound.keys())).toBeGreaterThanOrEqual(5); // 第 5 回合起
  });
});
