/**
 * 明其虚实（诸葛亮·蜀弓 h496 主战法）：指挥 S（一类指挥 prep），距离 5，发动率 --。
 * 满级：战斗中，使敌军全体的谋略降低 6.0%，此效果每回合叠加一次；并在前 2 回合，
 *   使敌军群体陷入犹豫状态，无法发动主动战法。
 * 1 级：谋略降低 3.0%（叠层与犹豫窗口同）。
 * 官方：scripts/skill_extra.json id 200737（指挥 / 距离 5 / 敌军群体（有效距离内 2 个目标）/ 兵种弓；
 *   effect 标签 犹豫(预备);谋略属性降低）。
 *   来源 https://stzb.163.com/m/skilllist/200737.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 两版拼接 → 取前半（前 2 回合）；
 *   ② 谋略降低 6% = 百分比（percent:true，按目标当前生效谋略结算，魏武之世先例）；
 *   ③ 每回合叠加一次 → 同源显式叠层 stack:true 逐回合累加（−6% → −12% → …，官方未给上限，推定）；
 *   ④ 前 2 回合犹豫 → initialOutput + duration:2（准备阶段 appliedRound=0 → 回合末 tickStatuses 递减）；
 *   ⑤ 谋略段打敌军全体（战法 targetMode:'all' 锁 3 人）；犹豫段段级 targetSide+targetMode:'group'
 *      重选敌军群体 2 目标；
 *   ⑥ 无受属性缩放段、无数值缺口 → 上架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 * 释放链路：一类指挥，准备阶段（currentRound=0）triggerCommandSkills 释放；
 *   roundRepeat 由目标行动前 triggerPreparedEffectOnAct 判定（actUnit 内含）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  effectiveStat,
  tickStatuses,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'mingqi_xushi';
const HERO_ID = 'h496';

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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  // level40 → 兵力 9000
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 敌军三件套（前锋 / 中军 / 大营），每次新建避免跨用例状态污染 */
function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
}

/** 准备阶段上下文：currentRound=0（准备阶段施加 → appliedRound=0 → 回合末 tickStatuses 递减） */
function prepCtx(seed = 1): CombatContext {
  const me = heroUnit(HERO_ID, '前锋', {});
  const ctx = makeCtx([me], enemyTrio(), seed);
  ctx.currentRound = 0;
  return ctx;
}

describe('明其虚实（诸葛亮 h496）', () => {
  it('装配：一类指挥 prep·距离 5·全体敌军 + initialOutput 犹豫群体 2 + roundRepeat{1,8,1} + 谋略 −6% percent stack·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('诸葛亮');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('明其虚实');
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
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual(['strategy_buff', 'hesitation']);
    expect(s.initialOutput).toEqual([
      {
        kind: 'inflict_status',
        targetSide: 'enemy',
        targetMode: 'group',
        groupCount: 2,
        status: { type: 'hesitation', duration: 2 },
      },
    ]);
    expect(s.roundRepeat).toEqual({ startRound: 1, endRound: 8, rate: 1 });
    expect(s.output).toEqual([
      {
        kind: 'inflict_status',
        status: { type: 'strategy_buff', amount: -6, percent: true, duration: 999, stack: true },
      },
    ]);

    // 无「受属性影响」段、无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·犹豫：准备阶段恰好 2 个敌军带 hesitation（remaining 2）第 3 个不带；第 1~2 回合末递减后到期移除', () => {
    const ctx = prepCtx();
    triggerCommandSkills(ctx, ctx.myTeam[0]);

    const withH = ctx.enemyTeam.filter((u) => u.statuses.some((s) => s.type === 'hesitation'));
    const withoutH = ctx.enemyTeam.filter((u) => !u.statuses.some((s) => s.type === 'hesitation'));
    expect(withH).toHaveLength(2);
    expect(withoutH).toHaveLength(1);

    const hesitationOf = (u: UnitState) => {
      const st = u.statuses.find((s) => s.type === 'hesitation');
      if (st?.type !== 'hesitation') throw new Error('期望 hesitation');
      return st;
    };
    for (const u of withH) expect(hesitationOf(u).remaining).toBe(2);

    // 第 1 回合末 → remaining 1（第 1、2 回合仍生效）
    ctx.currentRound = 1;
    tickStatuses(ctx, ctx.enemyTeam);
    for (const u of withH) expect(hesitationOf(u).remaining).toBe(1);

    // 第 2 回合末 → 到期移除（覆盖第 1~2 回合）
    ctx.currentRound = 2;
    tickStatuses(ctx, ctx.enemyTeam);
    for (const u of withH) expect(u.statuses.some((s) => s.type === 'hesitation')).toBe(false);
    expect(eventsOf(ctx, 'status_expired').filter((e) => e.statusType === 'hesitation')).toHaveLength(2);
  });

  it('机制·谋略降低逐回合叠加：同一敌军行动 2 次 → 同源显式叠层 amount −6 → −12（单实例）', () => {
    const ctx = prepCtx();
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const foe = ctx.enemyTeam[0];
    ctx.currentRound = 1;

    actUnit(ctx, foe);
    const findBuff = () => {
      const st = foe.statuses.find((s) => s.type === 'strategy_buff' && s.sourceSkillId === SKILL_ID);
      if (st?.type !== 'strategy_buff') throw new Error('期望 strategy_buff');
      return st;
    };
    expect(findBuff().amount).toBe(-6);
    expect(findBuff().percent).toBe(true);

    actUnit(ctx, foe);
    expect(findBuff().amount).toBe(-12);
    expect(findBuff().percent).toBe(true);
    expect(findBuff().remaining).toBe(999); // 重挂 remaining = max(旧, 999)
    // 同源显式叠层 → 始终 1 个实例（不是新增层）
    expect(foe.statuses.filter((s) => s.type === 'strategy_buff')).toHaveLength(1);
  });

  it('数值·百分比语义：percent 按目标当前生效谋略的 6% 递减（strategy 200 → 188），非固定 −6 点', () => {
    const ctx = prepCtx();
    const foe = ctx.enemyTeam[0];
    foe.general.strategy = 200;
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 1;

    actUnit(ctx, foe);
    const eff = effectiveStat(foe, 'strategy');
    expect(Math.abs(eff - 188)).toBeLessThanOrEqual(1);
    expect(eff).toBeLessThan(194); // 固定 −6 点会得到 194；百分比随当前值缩放（200×6% = 12）
    expect((200 - eff) / 200).toBeCloseTo(0.06, 2);

    // 第 2 层 −12% → 176（仍按当前生效值 × 12%）
    actUnit(ctx, foe);
    expect(Math.abs(effectiveStat(foe, 'strategy') - 176)).toBeLessThanOrEqual(1);
  });

  it('整场跑通（runBattle·8 回合）：status_inflicted（hesitation / strategy_buff）与 battle_end 齐全', () => {
    const zhuge: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { commandSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), zhuge, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    const hesitation = inflicted.filter((e) => e.statusType === 'hesitation');
    expect(hesitation.length).toBeGreaterThan(0);
    // 犹豫恰好覆盖 2 个敌军（准备阶段一次性施加）
    expect(new Set(hesitation.map((e) => e.unitId)).size).toBe(2);
    expect(inflicted.some((e) => e.statusType === 'strategy_buff')).toBe(true);
  });
});
