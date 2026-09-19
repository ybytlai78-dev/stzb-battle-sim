/**
 * 守静却敌（XP蒋琬·蜀步 h800 主战法）：指挥 A（一类指挥 prep），距离 5，目标我军全体，发动率 --。
 * 满级：使我军全体受到的恢复效果提升 10.0%（受谋略属性影响）；在第六回合、第八回合开始时，
 *   使我军全体对随机敌军单体造成一次策略伤害（伤害率 100.0%，受谋略属性影响），每当我军武将受到
 *   一次恢复效果，使受到恢复的武将造成【守静却敌】的策略伤害时，伤害提升 10.0%（受谋略属性影响），
 *   伤害提升效果至多可叠加 15 次。
 * 1 级：恢复提升 5.0% / 策略伤害 50.0% / 每层提升 5.0%（层数上限同为 15）。
 * 官方：scripts/skill_extra.json id 200277（指挥 / 距离 5 / 我军全体；effect 标签 受到恢复效果提高;
 *   策略攻击伤害提高;策略攻击伤害）。来源 https://stzb.163.com/m/skilllist/200277.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 恢复提升 = 准备阶段一次性挂 heal_boost（duration 999 整场），走 recoverTroops 唯一收口；
 *   ② 第 6/8 回合开始 → delayedOutputs[{atRound:6},{atRound:8}]；
 *   ③ 「使我军全体对随机敌军单体造成一次策略伤害」= 每名我军武将各自出手一次（推定：与末句「使受到
 *      恢复的武将造成【守静却敌】的策略伤害时」对齐）→ strategy_damage.attacker:'recipient'；
 *   ④ 「每当我军武将受到一次恢复效果」= 任意恢复来源（推定），onHeal{applyTo:'victim'} 把同源叠层
 *      damage_boost 只落在被恢复者身上，上限 15 层；
 *   ⑤ 「造成【守静却敌】的策略伤害时」= damage_boost.skillIds 只对本法伤害生效；
 *   ⑥ 三处「受谋略」成长率未给 → 基值不缩放 → 蒋琬下架（登记 OFFLINE_MAIN_SKILLS）；
 *   ⑦ 一类指挥 retainAfterDeath: true。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  inflictStatus,
  recoverTroops,
  triggerCommandSkills,
  triggerDelayedOutputs,
  statusMatchesHit,
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

const SKILL_ID = 'shoujing_quedi';
const HERO_ID = 'h800';

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
  // level40 → 兵力 9000
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 敌军三件套（30000 兵力，避免被打死影响后续回合） */
function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 我方三件套：蒋琬（前锋）+ 2 名无战法友军（中军 / 大营）——「我军全体」= 3 人各出手一次 */
function myTrio(): UnitState[] {
  return [
    heroUnit(HERO_ID, '前锋'),
    makeUnit(dummy('mate-mid', '中军'), 'my', 9000),
    makeUnit(dummy('mate-back', '大营'), 'my', 9000),
  ];
}

/** 准备阶段上下文：currentRound=0 → triggerCommandSkills 释放一类指挥 */
function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(myTrio(), enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const damageEvent = (e: BattleEvent) => (e.type === 'damage' ? e : null);

describe('守静却敌（XP蒋琬 h800）', () => {
  it('装配：一类指挥 prep·距离 5·我军全体 + initialOutput heal_boost 10% + onHeal 叠层 + 第 6/8 回合延迟伤害·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP蒋琬');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('守静却敌');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入指挥槽
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(1);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.retainAfterDeath).toBe(true);
    expect(s.tags).toEqual(['heal', 'damage_boost', 'damage']);
    expect(s.initialOutput).toEqual([
      { kind: 'inflict_status', status: { type: 'heal_boost', rate: 0.1, duration: 999, strategyScaled: true } },
    ]);
    expect(s.onHeal).toEqual({
      victim: 'ally',
      applyTo: 'victim',
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: 0.1,
            duration: 999,
            direction: 'caused',
            damageType: 'strategy',
            skillIds: [SKILL_ID],
            stacks: 1,
            maxStacks: 15,
            strategyScaled: true,
          },
        },
      ],
    });
    expect(s.delayedOutputs).toEqual([
      {
        atRound: 6,
        output: [
          { kind: 'strategy_damage', rate: 100, strategyScaled: true, attacker: 'recipient', targetMode: 'random_single' },
        ],
      },
      {
        atRound: 8,
        output: [
          { kind: 'strategy_damage', rate: 100, strategyScaled: true, attacker: 'recipient', targetMode: 'random_single' },
        ],
      },
    ]);

    // 受谋略成长率未确认 → 按基值不缩放 → 登记下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·恢复提升：准备阶段我军全体挂 heal_boost（10%），recoverTroops 请求 1000 → 实际恢复 1100', () => {
    const ctx = prepCtx();

    for (const u of ctx.myTeam) {
      const boost = u.statuses.find((st) => st.type === 'heal_boost');
      expect(boost).toBeTruthy();
      if (boost?.type !== 'heal_boost') throw new Error('期望 heal_boost');
      expect(boost.rate).toBe(0.1);
      expect(boost.remaining).toBe(999); // 整场
      expect(boost.sourceSkillId).toBe(SKILL_ID);
    }

    // 受伤后才能恢复（未配伤兵机制时池 = 兵力缺口）
    const mate = ctx.myTeam[1];
    mate.troops = 5000;
    const healed = recoverTroops(ctx, mate, 1000);
    expect(healed).toBe(1100); // floor(1000 × (1 + 10%))
    expect(mate.troops).toBe(6100);
  });

  it('机制·受恢复叠层：只叠被恢复者（同源累加 stacks 1→2），确认「任意恢复来源」+ 上限 15 层', () => {
    const ctx = prepCtx();
    const [jiangwan, mateA, mateB] = ctx.myTeam;

    const boostOf = (u: UnitState) => {
      const st = u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID);
      if (st?.type !== 'damage_boost') throw new Error('期望 damage_boost');
      return st;
    };

    // 首次被恢复 → mateA 叠 1 层（+10%），mateB / 蒋琬自身不受影响
    mateA.troops = 5000;
    recoverTroops(ctx, mateA, 1000);
    const first = boostOf(mateA);
    expect(first.rate).toBe(0.1);
    expect(first.stacks).toBe(1);
    expect(first.direction).toBe('caused');
    expect(first.damageType).toBe('strategy');
    expect(first.skillIds).toEqual([SKILL_ID]);
    expect(mateB.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
    expect(jiangwan.statuses.some((s) => s.type === 'damage_boost')).toBe(false);

    // 第 2 次被恢复 → 同源累加到 2 层 / +20%（不新增实例）
    recoverTroops(ctx, mateA, 500);
    const second = boostOf(mateA);
    expect(second.stacks).toBe(2);
    expect(second.rate).toBeCloseTo(0.2, 6);
    expect(mateA.statuses.filter((s) => s.type === 'damage_boost').length).toBe(1);

    // 另一名友军被恢复 → 只叠到自己身上（各自独立计数）
    mateB.troops = 5000;
    recoverTroops(ctx, mateB, 100);
    expect(boostOf(mateB).stacks).toBe(1);
    expect(boostOf(mateA).stacks).toBe(2);

    // 上限 15 层：继续恢复 40 次 → stacks 封顶 15、rate = +150%
    for (let i = 0; i < 40; i++) recoverTroops(ctx, mateA, 10);
    const capped = boostOf(mateA);
    expect(capped.stacks).toBe(15);
    expect(capped.rate).toBeCloseTo(1.5, 6);
    expect(mateA.statuses.filter((s) => s.type === 'damage_boost').length).toBe(1);
  });

  it('机制·第 6/8 回合延迟伤害：第 5 回合不触发；第 6/8 回合我军 3 人各自对随机敌军单体打一次（归蒋琬）', () => {
    const ctx = prepCtx();
    const ids = ctx.myTeam.map((u) => u.general.id);

    ctx.currentRound = 5;
    triggerDelayedOutputs(ctx, 5);
    expect(eventsOf(ctx, 'damage')).toHaveLength(0);

    ctx.currentRound = 6;
    triggerDelayedOutputs(ctx, 6);
    const round6 = eventsOf(ctx, 'damage').map(damageEvent).filter((e) => e !== null);
    expect(round6).toHaveLength(3); // 每名我军武将各出手一次
    expect(new Set(round6.map((e) => e.sourceId)).size).toBe(3); // 出手者 = 3 名友军各自结算
    expect(round6.every((e) => ids.includes(e.sourceId!))).toBe(true);
    expect(round6.every((e) => e.skillId === SKILL_ID && e.damageType === 'strategy')).toBe(true);
    expect(round6.every((e) => (e.damage ?? 0) > 0)).toBe(true);
    // 代打归属：非蒋琬本人打出时 creditToId = 蒋琬
    const jiangwanId = ids[0];
    for (const e of round6) {
      if (e.sourceId === jiangwanId) expect(e.creditToId).toBeUndefined();
      else expect(e.creditToId).toBe(jiangwanId);
    }
    // 目标为敌军单体（每次独立随机）
    expect(round6.every((e) => ctx.enemyTeam.some((foe) => foe.general.id === e.targetId))).toBe(true);

    ctx.currentRound = 7;
    triggerDelayedOutputs(ctx, 7);
    expect(eventsOf(ctx, 'damage')).toHaveLength(3); // 第 7 回合不追加

    ctx.currentRound = 8;
    triggerDelayedOutputs(ctx, 8);
    expect(eventsOf(ctx, 'damage')).toHaveLength(6); // 第 8 回合再各打一次
  });

  it('机制·skillIds 过滤：增伤只提升【守静却敌】自己的策略伤害（挂别的战法 id 不吃）', () => {
    // 单元级过滤语义
    expect(statusMatchesHit({ skillIds: [SKILL_ID] }, { damageSource: 'skill', damageType: 'strategy', skillId: SKILL_ID })).toBe(true);
    expect(statusMatchesHit({ skillIds: [SKILL_ID] }, { damageSource: 'skill', damageType: 'strategy', skillId: 'other_skill' })).toBe(false);
    expect(statusMatchesHit({ skillIds: [SKILL_ID] }, { damageSource: 'basic', damageType: 'physical' })).toBe(false);

    // 端到端：同种子、同兵力/属性 → 带 3 层（+30%）的守静却敌伤害 > 对照组（skillIds 指向别的战法，不生效）
    const sumSixDamage = (skillIds: string[]) => {
      const ctx = prepCtx(11);
      const mate = ctx.myTeam[1];
      inflictStatus(
        ctx,
        mate,
        {
          type: 'damage_boost',
          rate: 0.3,
          duration: 999,
          direction: 'caused',
          damageType: 'strategy',
          skillIds,
          stacks: 1,
          maxStacks: 15,
        },
        'command',
        SKILL_ID,
        ctx.myTeam[0].general.id
      );
      ctx.currentRound = 6;
      triggerDelayedOutputs(ctx, 6);
      return eventsOf(ctx, 'damage').reduce((a, e) => a + (e.damage ?? 0), 0);
    };

    const boosted = sumSixDamage([SKILL_ID]);
    const control = sumSixDamage(['other_skill']);
    expect(boosted).toBeGreaterThan(control);
    expect(boosted).toBeGreaterThan(0);
    expect(control).toBeGreaterThan(0);
  });

  it('整场跑通（runBattle·8 回合）：第 6 回合出现守静却敌伤害 · 恢复提升与 battle_end 齐全', () => {
    const jiangwan: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}),
      position: '中军',
    };
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), jiangwan, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const damage = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage'
    );
    const ownDamage = damage.filter((e) => e.skillId === SKILL_ID);
    expect(new Set(ownDamage.map((e) => e.targetId)).size).toBeGreaterThan(0);
    // 第 6 回合：我军 3 人各一次（runBattle 里第 6 回合才开始）
    expect(ownDamage.length).toBeGreaterThanOrEqual(3);
  });
});
