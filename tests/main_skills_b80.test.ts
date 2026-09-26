/**
 * 疲兵沮意（XP陆逊·吴弓 h791 主战法）：指挥 S（一类指挥 prep），距离 5，我军群体，发动率 --。
 * 满级：每回合开始时，为我军群体叠加 2 层避锐效果，在其受到伤害前，消耗 1 层避锐效果令该次伤害
 *   降低 10.0%（受谋略属性影响），避锐效果生效后有 50% 几率令敌军单体陷入燃烧状态（伤害率 150.0%，
 *   受谋略属性影响），持续 1 回合，并使其后续受到疲兵沮意的燃烧伤害伤害率提升 80.0%，可叠加至战斗结束。
 * 1 级：避锐 5.0% / 燃烧 75.0% / 递增 40.0%。
 * 官方：scripts/skill_extra.json id 200264。来源 https://stzb.163.com/m/skilllist/200264.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 「我军群体」未写 N → 取 2 目标（推定）；
 *   ② 每回合 +2 层避锐 → roundStartRepeat + 新状态 avoid_charge（层数型吸收）；
 *   ③ 受击前消耗 1 层 → 该次伤害 −10%（受谋略，施加时冻结）；
 *   ④ 消耗后 50%（走士气，推定）→ 随机敌军单体燃烧 150% + 该目标「受到本战法燃烧伤害 +80%」
 *      （damage_boost taken + dotTypes burning + skillIds 过滤 + stack 可叠加至战斗结束）；
 *   ⑤ 三处「受谋略」成长率未给 → 基值不缩放 → 陆逊下架（OFFLINE_MAIN_SKILLS）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  statusMatchesHit,
  tickRoundStartStatuses,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'pibing_juyi';
const HERO_ID = 'h791';

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
  return [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-front', '前锋'), 'my', 9000), makeUnit(dummy('mate-back', '大营'), 'my', 9000)];
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 一类指挥：准备阶段释放（锁定我军群体 2 目标） */
function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(myTrio(), enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const avoidOf = (u: UnitState) => {
  const st = u.statuses.find((s): s is Extract<Status, { type: 'avoid_charge' }> => s.type === 'avoid_charge');
  if (!st) throw new Error('期望 avoid_charge');
  return st;
};

/** 把避锐消耗后的 50% 判定改成必中（确定性断言用；覆盖须早于受击） */
function forceConsume(ctx: CombatContext): void {
  const def = ctx.skills.get(SKILL_ID);
  if (def?.type !== 'command' || !def.avoidOnConsume) throw new Error('期望 command+avoidOnConsume');
  ctx.skills.set(SKILL_ID, { ...def, avoidOnConsume: { ...def.avoidOnConsume, chance: 1 } });
}

describe('疲兵沮意（XP陆逊 h791）', () => {
  it('装配：一类指挥 prep·距离 5·我军群体 2 目标·roundStartRepeat 叠锐 + avoidOnConsume·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP陆逊');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('疲兵沮意');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(1);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_reduce', 'burning']);
    expect(s.roundStartRepeat).toEqual({
      output: [
        { kind: 'inflict_status', status: { type: 'avoid_charge', stacks: 2, perStackRate: 0.1, duration: 999, strategyScaled: true } },
      ],
    });
    expect(s.avoidOnConsume?.chance).toBe(0.5);
    expect(s.avoidOnConsume?.output).toEqual([
      { kind: 'inflict_status', status: { type: 'burning', duration: 1, rate: 150, growthRate: 0 } },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.8,
          duration: 999,
          direction: 'taken',
          dotTypes: ['burning'],
          skillIds: [SKILL_ID],
          stack: true,
        },
      },
    ]);

    // 三处「受谋略」成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·每回合开始叠 2 层避锐（我军群体 2 目标）：2 → 4 → 6 层', () => {
    const ctx = prepCtx();
    // 准备阶段只锁定目标（我军群体 2 目标），不叠层
    const locked = ctx.lockedCommands.find((l) => l.skill.id === SKILL_ID)?.targets ?? [];
    expect(locked).toHaveLength(2); // 我军群体 = 2 目标（推定）
    expect(ctx.myTeam.every((u) => !u.statuses.some((s) => s.type === 'avoid_charge'))).toBe(true);

    for (const round of [1, 2, 3]) {
      ctx.currentRound = round;
      tickRoundStartStatuses(ctx);
      for (const u of locked) {
        // 每回合 +2：第 1 回合 2、第 2 回合 4、第 3 回合 6
        expect(avoidOf(u).stacks).toBe(round * 2);
        expect(avoidOf(u).perStackRate).toBe(0.1);
      }
    }
    // 未被锁定的第 3 名友军不带避锐
    const untargeted = ctx.myTeam.find((u) => !locked.includes(u))!;
    expect(untargeted.statuses.some((s) => s.type === 'avoid_charge')).toBe(false);
  });

  it('机制·受击前消耗 1 层：该次伤害降低 10%（1000 → 900），层数 −1', () => {
    const ctx = prepCtx();
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const holder = ctx.myTeam.find((u) => u.statuses.some((s) => s.type === 'avoid_charge'))!;
    expect(avoidOf(holder).stacks).toBe(2);

    const attacker = makeUnit(dummy('atk', '前锋'), 'enemy');
    const before = holder.troops;
    applyDamage(ctx, holder, 1000, attacker, 'physical', 'skill');
    expect(avoidOf(holder).stacks).toBe(1);
    expect(before - holder.troops).toBe(900); // round(1000 × (1 − 10%))
    expect(ctx.events.some((e) => e.type === 'status_changed' && e.statusType === 'avoid_charge')).toBe(true);
  });

  it('机制·避锐生效后（必中覆盖）点燃随机敌军单体：燃烧 150%/1 回合 + 同目标「受到本战法燃烧伤害 +80%」可叠加', () => {
    const ctx = makeCtx(myTrio(), [makeUnit(dummy('foe-only', '大营'), 'enemy')], 3);
    forceConsume(ctx);
    ctx.currentRound = 0;
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const holder = ctx.myTeam.find((u) => u.statuses.some((s) => s.type === 'avoid_charge'))!;
    const attacker = makeUnit(dummy('atk', '前锋'), 'enemy');
    const burn = ctx.enemyTeam[0]; // 仅 1 名敌军 → 随机单体必为其本人

    applyDamage(ctx, holder, 500, attacker, 'physical', 'skill');
    const burning = burn.statuses.find((s) => s.type === 'burning' && s.sourceSkillId === SKILL_ID);
    if (burning?.type !== 'burning') throw new Error('期望 burning');
    expect(burning.rate).toBe(150);
    expect(burning.remaining).toBe(1);
    // 同一目标身上带「受到本战法燃烧伤害提升 80%」
    const boost = burn.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID);
    if (boost?.type !== 'damage_boost') throw new Error('期望 damage_boost');
    expect(boost.rate).toBeCloseTo(0.8, 6);
    expect(boost.direction).toBe('taken');
    expect(boost.dotTypes).toEqual(['burning']);
    expect(boost.skillIds).toEqual([SKILL_ID]);

    // 第二次消耗 → 同源叠层（+80% → +160%，可叠加至战斗结束）
    applyDamage(ctx, holder, 500, attacker, 'physical', 'skill');
    const boost2 = burn.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID);
    if (boost2?.type !== 'damage_boost') throw new Error('期望 damage_boost');
    expect(boost2.rate).toBeCloseTo(1.6, 6);
  });

  it('数值·递增只对【疲兵沮意】的燃烧生效：skillIds + dotTypes 过滤（同种子对照跳伤更高）', () => {
    const match = { damageSource: 'skill' as const, damageType: 'strategy' as const, dotType: 'burning' as const, skillId: SKILL_ID };
    expect(statusMatchesHit({ dotTypes: ['burning'], skillIds: [SKILL_ID] }, match)).toBe(true);
    expect(statusMatchesHit({ dotTypes: ['burning'], skillIds: [SKILL_ID] }, { ...match, skillId: 'other_skill' })).toBe(false);
    expect(statusMatchesHit({ dotTypes: ['burning'], skillIds: [SKILL_ID] }, { ...match, dotType: 'panic' })).toBe(false);

    const burnTick = (withBoost: boolean) => {
      const ctx = prepCtx(51);
      const caster = ctx.myTeam[0];
      const foe = ctx.enemyTeam[0];
      if (withBoost) {
        inflictStatus(
          ctx,
          foe,
          { type: 'damage_boost', rate: 0.8, duration: 999, direction: 'taken', dotTypes: ['burning'], skillIds: [SKILL_ID], stack: true },
          'command',
          SKILL_ID,
          caster.general.id
        );
      }
      // 挂燃烧（挂上时按当时的增伤冻结每次跳伤）
      inflictStatus(ctx, foe, { type: 'burning', duration: 1, rate: 150, growthRate: 0 }, 'command', SKILL_ID, caster.general.id);
      const before = foe.troops;
      ctx.currentRound = 1;
      actUnit(ctx, foe);
      return before - foe.troops;
    };
    const plain = burnTick(false);
    const boosted = burnTick(true);
    expect(plain).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(plain);
  });

  it('整场跑通（runBattle·8 回合）：避锐层数、燃烧与 battle_end 齐全', () => {
    const luxun: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 33,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), luxun, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'avoid_charge')).toBe(true);
    const changed = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_changed' }> => e.type === 'status_changed'
    );
    expect(changed.some((e) => e.statusType === 'avoid_charge')).toBe(true);
    expect(inflicted.some((e) => e.statusType === 'burning')).toBe(true);
  });
});
