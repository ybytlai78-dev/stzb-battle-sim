/**
 * 雅虑适时（XP马良·蜀步 h792 主战法）：指挥 A（一类指挥 prep + roundStartRepeat 回合窗口），距离 5，
 * 我军全体，发动率 --。
 * 满级：第 3、5、7 回合开始时，令我军全体受到所有伤害降低 24.0%（受谋略属性影响）并进入同心状态，
 *   同心状态下任一武将受到伤害时，其余处于同心状态下武将为其分摊 15% 受到的伤害，持续 1 回合。
 * 1 级：减伤 12.0%（分摊 15% 同）。
 * 官方：scripts/skill_extra.json id 200265。来源 https://stzb.163.com/m/skilllist/200265.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 回合窗口 = roundStartRepeat.rounds [3,5,7]（一类指挥回合前结算）；
 *   ② 目标按**描述**「我军全体」（官方目标栏「自己」为冲突项，策略 A ③）；
 *   ③ 减伤 24% 全伤害类型（受谋略未确认 → 基值）、duration 1；
 *   ④ 同心 = damage_share rate 0.15（每名其余持有者各分摊一次，3 人队共 30%；按原始伤害计，推定）；
 *   ⑤ 受谋略成长率未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { applyDamage, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'yalv_shishi';
const HERO_ID = 'h792';

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

function myTrio(): UnitState[] {
  return [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-a', '前锋'), 'my', 9000), makeUnit(dummy('mate-b', '大营'), 'my', 9000)];
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(myTrio(), enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const shareEvents = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'share_damage' }> => e.type === 'share_damage');
const hasOf = (u: UnitState, type: 'damage_reduce' | 'damage_share') =>
  u.statuses.some((s) => s.type === type && s.sourceSkillId === SKILL_ID);

describe('雅虑适时（XP马良 h792）', () => {
  it('装配：一类指挥 prep·距离 5·我军全体（按描述）·roundStartRepeat.rounds[3,5,7]（减伤 24% + 同心 15%）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP马良');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('雅虑适时');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_reduce']);
    expect(s.output).toEqual([]);
    expect(s.roundStartRepeat).toEqual({
      rounds: [3, 5, 7],
      output: [
        { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.24, duration: 1, strategyScaled: true } },
        { kind: 'inflict_status', status: { type: 'damage_share', rate: 0.15, duration: 1 } },
      ],
    });

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·只在第 3/5/7 回合开始时生效：我军全体各得减伤 24% 与同心 15%（其他回合无状态）', () => {
    const ctx = prepCtx(3);
    for (let round = 1; round <= 7; round++) {
      ctx.currentRound = round;
      tickRoundStartStatuses(ctx);
      const expectOn = round === 3 || round === 5 || round === 7;
      for (const u of ctx.myTeam) {
        expect(hasOf(u, 'damage_reduce'), `第 ${round} 回合 damage_reduce`).toBe(expectOn);
        expect(hasOf(u, 'damage_share'), `第 ${round} 回合 damage_share`).toBe(expectOn);
        if (!expectOn) continue;
        const dr = u.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID);
        if (dr?.type !== 'damage_reduce') throw new Error('期望 damage_reduce');
        expect(dr.rate).toBeCloseTo(0.24, 6);
        expect(dr.damageType).toBeUndefined(); // 全伤害类型
        const ds = u.statuses.find((s) => s.type === 'damage_share' && s.sourceSkillId === SKILL_ID);
        if (ds?.type !== 'damage_share') throw new Error('期望 damage_share');
        expect(ds.rate).toBeCloseTo(0.15, 6);
      }
      // 模拟回合结束：duration 1 的状态到期移除（本测试不跑 actUnit）
      for (const u of ctx.myTeam) u.statuses = u.statuses.filter((s) => s.sourceSkillId !== SKILL_ID);
    }
  });

  it('机制·同心分摊：受击者承担 70%，其余两名同心者各承担 15%（按原始伤害计）', () => {
    const ctx = prepCtx(5);
    ctx.currentRound = 3;
    tickRoundStartStatuses(ctx);
    const [victim, mateA, mateB] = ctx.myTeam;
    const before = ctx.myTeam.map((u) => u.troops);

    applyDamage(ctx, victim, 1000, undefined, 'physical', 'skill');
    const events = shareEvents(ctx);
    expect(events).toHaveLength(2); // 其余两名同心者各分摊一次
    expect(events.every((e) => e.targetId === victim.general.id)).toBe(true);
    expect(events.every((e) => e.amount === 150)).toBe(true);
    expect(new Set(events.map((e) => e.unitId))).toEqual(new Set([mateA.general.id, mateB.general.id]));
    // 受击主体承担剩余 70%（「分摊」字面解读）
    expect(before[0] - victim.troops).toBe(700);
    expect(before[1] - mateA.troops).toBe(150);
    expect(before[2] - mateB.troops).toBe(150);
  });

  it('整场跑通（runBattle·8 回合）：第 3/5/7 回合出现减伤与同心状态且 battle_end 齐全', () => {
    const maliang: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 555,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), maliang, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'damage_reduce')).toBe(true);
    expect(inflicted.some((e) => e.statusType === 'damage_share')).toBe(true);
  });
});
