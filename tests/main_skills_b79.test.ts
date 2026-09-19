/**
 * 抚民励德（XP刘表·汉弓 h675 主战法）：指挥 S（二类指挥：第 2/4/6 回合自身行动时），距离 3，
 * 我军全体，发动率 --。
 * 满级：第 2、4、6 回合自身行动时，使我军全体谋略、防御属性提升 80.0，并且受到的所有伤害减少
 *   20.0%（受谋略属性影响），持续 2 回合。武将每次造成伤害时，自身该效果降低 1/4。
 *   每次施加可刷新由抚民励德带来的属性与减伤效果。1 级：属性 +40.0 / 减伤 10.0%。
 * 官方：scripts/skill_extra.json id 200952。来源 https://stzb.163.com/m/skilllist/200952.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 回合窗口 = 二类指挥 roundTrigger:'on_act' + 新引擎件 actRounds:[2,4,6]；
 *   ② 减伤段按 desc「受到的所有伤害减少 20%」单段（不限 damageType）；
 *   ③ 「每次造成伤害时自身该效果降低 1/4」= 新引擎件 decayOnDeal:4（携带者每次实际造成伤害后
 *      谋略/防御/减伤各 −1 份：80→60→40→20→0、20%→15%→10%→5%→0），按每次伤害事件计 1 份（推定）；
 *   ④ 「每次施加可刷新」= 同源默认刷新 + refreshDecayCounters 重置份数；
 *   ⑤ 减伤受谋略成长率未给 → 基值不缩放 → 刘表下架（OFFLINE_MAIN_SKILLS）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, effectiveStat, triggerRoundCommandOnAct, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'fumin_lide';
const HERO_ID = 'h675';

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

function myTrio(): UnitState[] {
  return [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-front', '前锋'), 'my', 9000), makeUnit(dummy('mate-back', '大营'), 'my', 9000)];
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

const buffOf = (u: UnitState, type: 'strategy_buff' | 'defense_buff') => {
  const st = u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID);
  if (st?.type !== 'strategy_buff' && st?.type !== 'defense_buff') throw new Error(`期望 ${type}`);
  return st;
};
const reduceOf = (u: UnitState) => {
  const st = u.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID);
  if (st?.type !== 'damage_reduce') throw new Error('期望 damage_reduce');
  return st;
};

describe('抚民励德（XP刘表 h675）', () => {
  it('装配：二类指挥 on_act·actRounds[2,4,6]·距离 3·我军全体·三件套 decayOnDeal 4·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP刘表');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('抚民励德');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.actRounds).toEqual([2, 4, 6]);
    expect(s.range).toBe(3);
    expect(s.triggerRate).toBe(1);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['strategy_buff', 'defense_buff', 'damage_reduce']);
    expect(s.output).toEqual([
      { kind: 'inflict_status', status: { type: 'strategy_buff', amount: 80, duration: 2, decayOnDeal: 4 } },
      { kind: 'inflict_status', status: { type: 'defense_buff', amount: 80, duration: 2, decayOnDeal: 4 } },
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.2, duration: 2, strategyScaled: true, decayOnDeal: 4 } },
    ]);

    // 减伤受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·回合窗口：只在第 2/4/6 回合自身行动时施加（第 1/3/5/7 回合不施加）', () => {
    const ctx = makeCtx(myTrio(), enemyTrio(), 5);
    const hero = ctx.myTeam[0];
    const firedRounds: number[] = [];
    for (let round = 1; round <= 7; round++) {
      ctx.currentRound = round;
      const before = ctx.events.length;
      actUnit(ctx, hero);
      const added = ctx.events.slice(before).filter((e) => e.type === 'skill_trigger' && e.skillId === SKILL_ID && e.success);
      if (added.length > 0) firedRounds.push(round);
    }
    expect(firedRounds).toEqual([2, 4, 6]);
  });

  it('机制·三件套与衰减：谋略/防御 +80 与减伤 20%；携带者每次造成伤害 → 各 −1/4（80→60→40→20→移除）', () => {
    const ctx = makeCtx(myTrio(), enemyTrio(), 7);
    const hero = ctx.myTeam[0];
    ctx.currentRound = 2;
    triggerRoundCommandOnAct(ctx, hero);

    // 我军全体（3 人）各得三件套
    for (const u of ctx.myTeam) {
      expect(buffOf(u, 'strategy_buff').amount).toBe(80);
      expect(buffOf(u, 'defense_buff').amount).toBe(80);
      expect(reduceOf(u).rate).toBeCloseTo(0.2, 6);
      expect(buffOf(u, 'strategy_buff').dealParts).toBe(4);
      expect(buffOf(u, 'strategy_buff').dealPartsBase).toBe(4);
      expect(buffOf(u, 'strategy_buff').baseAmount).toBe(80);
      expect(reduceOf(u).dealParts).toBe(4);
      expect(reduceOf(u).baseRate).toBeCloseTo(0.2, 6);
      // 属性确实生效（点数加成）
      expect(effectiveStat(u, 'strategy')).toBeGreaterThan(u.general.strategy);
    }

    // 携带者造成一次伤害（普攻，命中 1 个敌军）→ 该携带者自身三件套各 −1/4
    const mate = ctx.myTeam[1];
    const beforeDamage = ctx.events.length;
    ctx.currentRound = 3;
    actUnit(ctx, mate);
    expect(ctx.events.slice(beforeDamage).some((e) => e.type === 'attack_hit')).toBe(true);
    expect(buffOf(mate, 'strategy_buff').amount).toBe(60);
    expect(buffOf(mate, 'defense_buff').amount).toBe(60);
    expect(reduceOf(mate).rate).toBeCloseTo(0.15, 6);
    // 未造成伤害的其他人不受影响
    expect(buffOf(hero, 'strategy_buff').amount).toBe(80);
    expect(buffOf(ctx.myTeam[2], 'strategy_buff').amount).toBe(80);

    // 继续造成 3 次伤害 → 归 0 移除
    for (let i = 0; i < 3; i++) actUnit(ctx, mate);
    expect(mate.statuses.some((s) => s.sourceSkillId === SKILL_ID)).toBe(false);
  });

  it('机制·刷新重置份数：衰减到 2/4 后第 4 回合重新施加 → 份数与满额数值重置回 4/4 与 80/20%', () => {
    const ctx = makeCtx(myTrio(), enemyTrio(), 9);
    const hero = ctx.myTeam[0];
    const mate = ctx.myTeam[1];

    ctx.currentRound = 2;
    triggerRoundCommandOnAct(ctx, hero);
    ctx.currentRound = 3;
    actUnit(ctx, mate);
    actUnit(ctx, mate); // 2 次伤害 → 2/4 份
    expect(buffOf(mate, 'strategy_buff').amount).toBe(40);
    expect(reduceOf(mate).rate).toBeCloseTo(0.1, 6);
    expect(buffOf(mate, 'strategy_buff').dealParts).toBe(2);

    // 第 4 回合再次施加（同源刷新）
    ctx.currentRound = 4;
    triggerRoundCommandOnAct(ctx, hero);
    expect(buffOf(mate, 'strategy_buff').amount).toBe(80);
    expect(buffOf(mate, 'strategy_buff').dealParts).toBe(4);
    expect(reduceOf(mate).rate).toBeCloseTo(0.2, 6);
    expect(reduceOf(mate).dealParts).toBe(4);
    expect(mate.statuses.filter((s) => s.sourceSkillId === SKILL_ID)).toHaveLength(3); // 仍是 3 个实例（刷新不新增）
  });

  it('数值·减伤生效：同种子对照，挂减伤后受击伤害下降', () => {
    const measure = (withReduce: boolean) => {
      const attacker = makeUnit(dummy('atk', '前锋'), 'my');
      const victim = makeUnit(dummy('vic', '大营'), 'enemy');
      const ctx = makeCtx([attacker], [victim], 41);
      if (withReduce) {
        const cfg = SKILL_REGISTRY[SKILL_ID];
        if (cfg.type !== 'command') throw new Error('期望 command');
        const statuses = cfg.output;
        for (const seg of statuses) {
          if (seg.kind !== 'inflict_status' || Array.isArray(seg.status)) continue;
          if (seg.status.type !== 'damage_reduce') continue;
          // 直接按战法定义施加减伤段（等价走 executeSkillOutputs 的减伤分支）
          const created = seg.status;
          victim.statuses.push({
            type: 'damage_reduce',
            rate: created.rate,
            remaining: 999,
            appliedRound: 0,
            sourceSkillType: 'command',
            sourceSkillId: SKILL_ID,
          });
        }
      }
      actUnit(ctx, attacker);
      return victim.general.maxTroops - victim.troops;
    };
    const plain = measure(false);
    const reduced = measure(true);
    expect(plain).toBeGreaterThan(0);
    expect(reduced).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(plain);
  });

  it('整场跑通（runBattle·8 回合）：三件套状态与 battle_end 齐全', () => {
    const liubiao: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 21,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), liubiao, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    for (const t of ['strategy_buff', 'defense_buff', 'damage_reduce'] as const) {
      expect(inflicted.some((e) => e.statusType === t)).toBe(true);
    }
    // 第 2/4/6 回合各触发一次（skill_trigger 成功）
    const fired = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID && e.success
    );
    expect(fired.length).toBe(3);
  });
});
