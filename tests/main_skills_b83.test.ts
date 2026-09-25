/**
 * 统军畏慎（徐晃·魏骑 h645 主战法）：指挥 S（一类指挥 prep），距离 2，我军全体，发动率 --。
 * 满级：战斗开始后，我军全体每回合有 80.0% 几率攻击或策略攻击造成的伤害提高 25.0%（受谋略属性影响），
 *   此几率每回合降低 10%；每回合有 30.0% 几率造成伤害时无视敌方 60.0% 防御或谋略属性，此几率每回合
 *   提升 10%。武将获得伤害提高效果与无视目标属性效果的类型由自身攻击与谋略中较高的属性决定。
 * 1 级：伤害提高 12.5% / 无视 30.0%（两条概率序列同）。
 * 官方：scripts/skill_extra.json id 200915。来源 https://stzb.163.com/m/skilllist/200915.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 两版拼接取前半 80% 版；
 *   ② 段级 roundRampingChance（80%−10%/回合、30%+10%/回合，clamp 0~1）；
 *   ③ byHigherStatStatus 逐目标按生效攻击 vs 谋略二选一；
 *   ④ A = damage_boost caused（physical/strategy，25% 基值）；B = ignore_def 60%
 *      （物理轨折减防御、策略轨折减策略伤害用的目标谋略：strategyTargetStrategy）；
 *   ⑤ duration 1（该回合）；⑥ 受谋略成长率未确认 → 徐晃下架。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CreateStatus, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'tongjun_weishen';
const HERO_ID = 'h645';

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

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 准备阶段（一类指挥锁定我军全体） */
function prepCtx(seed = 1, my?: UnitState[]): CombatContext {
  const ctx = makeCtx(
    my ?? [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-a', '前锋'), 'my', 9000), makeUnit(dummy('mate-b', '大营'), 'my', 9000)],
    enemyTrio(),
    seed
  );
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const trigs = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID);

describe('统军畏慎（徐晃 h645）', () => {
  it('装配：一类指挥 prep·距离 2·我军全体·两段 roundRampingChance + byHigherStatStatus·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('徐晃');
    expect(hero.faction).toBe('魏');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('统军畏慎');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.triggerRate).toBe(1);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_boost', 'ignore_def']);
    expect(s.output).toEqual([]);

    const segs = s.roundStartRepeat?.output ?? [];
    expect(segs).toHaveLength(2);
    for (const seg of segs) {
      if (seg.kind !== 'inflict_status') throw new Error('期望 inflict_status');
      expect(seg.byHigherStatStatus).toBeTruthy();
    }
    const [a, b] = segs as Array<Extract<typeof segs[number], { kind: 'inflict_status' }>>;
    expect(a.roundRampingChance).toEqual({ base: 0.8, increment: -0.1 });
    expect(a.byHigherStatStatus!.attack).toEqual({
      type: 'damage_boost',
      rate: 0.25,
      duration: 1,
      direction: 'caused',
      damageType: 'physical',
      strategyScaled: true,
    });
    expect((a.byHigherStatStatus!.strategy as Extract<CreateStatus, { type: 'damage_boost' }>).damageType).toBe('strategy');
    expect(b.roundRampingChance).toEqual({ base: 0.3, increment: 0.1 });
    expect(b.byHigherStatStatus!.attack).toEqual({ type: 'ignore_def', rate: 0.6, duration: 1, damageType: 'physical' });
    expect(b.byHigherStatStatus!.strategy).toEqual({ type: 'ignore_def', rate: 0.6, duration: 1, damageType: 'strategy' });

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·两段概率随回合递减/递增：80→70→60… 与 30→40→50…（baseRate 逐回合）', () => {
    const ctx = prepCtx(3);
    const byRound = new Map<number, number[]>();
    for (let round = 1; round <= 9; round++) {
      ctx.currentRound = round;
      const before = ctx.events.length;
      tickRoundStartStatuses(ctx);
      const rates = trigs(ctx)
        .slice(before === 0 ? 0 : ctx.events.slice(0, before).filter((e) => e.type === 'skill_trigger' && e.skillId === SKILL_ID).length)
        .map((t) => t.baseRate ?? -1);
      byRound.set(round, rates);
    }
    expect(byRound.get(1)).toEqual([80, 30]);
    expect(byRound.get(2)).toEqual([70, 40]);
    expect(byRound.get(5)).toEqual([40, 70]);
    expect(byRound.get(8)).toEqual([10, 100]);
    expect(byRound.get(9)).toEqual([0, 100]); // 递减段到 0 后恒不发动（clamp），递增段封顶 100
  });

  it('机制·攻/谋孰高分支：高攻击友军拿物理轨、高谋略友军拿策略轨（伤害提高 + 无视属性同轨）', () => {
    const highAtk = makeUnit(dummy('hi-atk', '前锋', { attack: 200, strategy: 60 }), 'my', 9000);
    const highStr = makeUnit(dummy('hi-str', '大营', { attack: 60, strategy: 200 }), 'my', 9000);
    const ctx = makeCtx([heroUnit(HERO_ID, '中军'), highAtk, highStr], enemyTrio(), 4);
    // 两段都改成必中，便于确定性断言（必须早于 triggerCommandSkills：lockedCommands 存的是注册时的实例）
    const def = ctx.skills.get(SKILL_ID);
    if (def?.type !== 'command') throw new Error('期望 command');
    ctx.skills.set(SKILL_ID, {
      ...def,
      roundStartRepeat: {
        output: (def.roundStartRepeat?.output ?? []).map((seg) =>
          seg.kind === 'inflict_status' ? { ...seg, roundRampingChance: { base: 1, increment: 0 } } : seg
        ),
      },
    });
    ctx.currentRound = 0;
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);

    const boostOf = (u: UnitState) => {
      const st = u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID);
      if (st?.type !== 'damage_boost') throw new Error('期望 damage_boost');
      return st;
    };
    const ignoreOf = (u: UnitState) => {
      const st = u.statuses.find((s) => s.type === 'ignore_def' && s.sourceSkillId === SKILL_ID);
      if (st?.type !== 'ignore_def') throw new Error('期望 ignore_def');
      return st;
    };

    expect(boostOf(highAtk).damageType).toBe('physical');
    expect(ignoreOf(highAtk).damageType).toBe('physical');
    expect(boostOf(highStr).damageType).toBe('strategy');
    expect(ignoreOf(highStr).damageType).toBe('strategy');
    expect(boostOf(highAtk).rate).toBeCloseTo(0.25, 6);
    expect(ignoreOf(highStr).rate).toBeCloseTo(0.6, 6);
  });

  it('数值·策略轨无视 60% 谋略生效：同种子对照，持标记的策略伤害更高；物理轨不串味', () => {
    /** 用李儒「计谕废立」的策略伤害段做靶：同一施法者，带/不带策略轨 ignore_def */
    const strategyDamage = (withIgnore: boolean) => {
      const liru = heroUnit('h604', '中军');
      const ctx = makeCtx([liru], enemyTrio(), 77);
      const skillDef = ctx.skills.get('jiyu_fuili');
      if (skillDef?.type !== 'active') throw new Error('期望 active');
      ctx.skills.set('jiyu_fuili', { ...skillDef, triggerRate: 1 });
      if (withIgnore) {
        inflictStatus(ctx, liru, { type: 'ignore_def', rate: 0.6, duration: 1, damageType: 'strategy' }, 'command', SKILL_ID);
      }
      ctx.currentRound = 1;
      actUnit(ctx, liru);
      return ctx.events
        .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'jiyu_fuili')
        .reduce((a, e) => a + (e.damage ?? 0), 0);
    };
    const plain = strategyDamage(false);
    const ignored = strategyDamage(true);
    expect(plain).toBeGreaterThan(0);
    expect(ignored).toBeGreaterThan(plain);
  });

  it('整场跑通（runBattle·8 回合）：两段判定逐回合出现且 battle_end 齐全', () => {
    const xuhuang: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 66,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), xuhuang, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const own = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    expect(own.length).toBeGreaterThan(0); // 每回合两段判定
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'damage_boost')).toBe(true);
    expect(inflicted.some((e) => e.statusType === 'ignore_def')).toBe(true);
  });
});
