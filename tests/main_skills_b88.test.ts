/**
 * 敛微穷极（刘徽·晋弓 h814 主战法）：指挥 S（一类指挥 prep），距离 5，友军全体，发动率 --。
 * 满级：战斗开始后，令友军全体造成的策略伤害提升 40.0%（受谋略属性影响），每回合结束时降低 1/6。
 *   同时友军全体造成策略伤害时，令其伤害率在原基础的 80.0%-150.0%（上限受谋略属性影响）范围随机浮动，
 *   浮动范围每回合收敛 1/6，最终第六回合收敛至 115.0%（受谋略属性影响），持续到战斗结束。
 * 1 级：提升 20.0% / 区间 40.0%-75.0% / 收敛至 57.5%。
 * 官方：scripts/skill_extra.json id 200296。来源 https://stzb.163.com/m/skilllist/200296.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 增伤 = damage_boost caused + damageType strategy + decayRoundParts 6（每回合 −1 份，按初始值线性
 *      40→33.3→26.7→20→13.3→6.7→0；实现挂在 tickRoundStartStatuses（第 2 回合起），与「回合结束时 −1/6」等价）；
 *   ② 浮动 = 新状态 strategy_flux（80/150/115/6 回合），区间随回合线性收敛、第 6 回合恰好 = 115%；
 *      第 1 回合为满区间；
 *   ③ 浮动只作用于 strategy_damage 段（DoT 挂上时冻结不浮动）；
 *   ④ 受谋略成长率未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'lianwei_qiongji';
const HERO_ID = 'h814';

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

function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(myTrio(), enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const boostOf = (u: UnitState) => {
  const st = u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID
  );
  if (!st) throw new Error('期望 damage_boost');
  return st;
};
const fluxOf = (u: UnitState) => {
  const st = u.statuses.find((s): s is Extract<Status, { type: 'strategy_flux' }> => s.type === 'strategy_flux');
  if (!st) throw new Error('期望 strategy_flux');
  return st;
};

describe('敛微穷极（刘徽 h814）', () => {
  it('装配：一类指挥 prep·距离 5·友军全体·策略增伤（decayRoundParts 6）+ strategy_flux（80/150/115/6）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('刘徽');
    expect(hero.faction).toBe('晋');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('敛微穷极');
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
    expect(s.tags).toEqual(['damage_boost']);
    expect(s.output).toEqual([]);
    expect(s.initialOutput).toEqual([
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.4,
          duration: 999,
          direction: 'caused',
          damageType: 'strategy',
          strategyScaled: true,
          decayRoundParts: 6,
        },
      },
      {
        kind: 'inflict_status',
        status: {
          type: 'strategy_flux',
          low: 80,
          high: 150,
          mid: 115,
          convergeRounds: 6,
          duration: 999,
          strategyScaled: true,
        },
      },
    ]);

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·准备阶段友军全体各得增伤与浮动；增伤每回合 −1/6（40→33.3→26.7→20→13.3→6.7→移除）', () => {
    const ctx = prepCtx(3);
    for (const u of ctx.myTeam) {
      const b = boostOf(u);
      expect(b.rate).toBeCloseTo(0.4, 6);
      expect(b.roundParts).toBe(6);
      expect(b.roundPartsBase).toBe(6);
      expect(b.damageType).toBe('strategy');
      const f = fluxOf(u);
      expect([f.low, f.high, f.mid, f.convergeRounds]).toEqual([80, 150, 115, 6]);
    }

    const u = ctx.myTeam[0];
    const expected = [0.4, 0.4 * 5 / 6, 0.4 * 4 / 6, 0.4 * 3 / 6, 0.4 * 2 / 6, 0.4 * 1 / 6];
    for (let round = 1; round <= 6; round++) {
      ctx.currentRound = round;
      tickRoundStartStatuses(ctx);
      expect(boostOf(u).rate).toBeCloseTo(expected[round - 1], 6);
    }
    // 第 7 回合起移除
    ctx.currentRound = 7;
    tickRoundStartStatuses(ctx);
    expect(u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)).toBe(false);
  });

  it('机制·浮动区间随回合收敛：第 1 回合落在 [0.8,1.5]×基础，第 6 回合恰好 = 1.15×基础', () => {
    /** 让李儒（策略伤害）带/不带浮动状态，在第 n 回合施放一次，取首个策略伤害段的 main */
    const run = (round: number, withFlux: boolean) => {
      const liru = heroUnit('h604', '中军');
      const ctx = makeCtx([liru], enemyTrio(), 42);
      const def = ctx.skills.get('jiyu_fuili');
      if (def?.type !== 'active') throw new Error('期望 active');
      ctx.skills.set('jiyu_fuili', { ...def, triggerRate: 1 });
      if (withFlux) {
        const luHui = ctx.skills.get(SKILL_ID);
        if (luHui?.type !== 'command') throw new Error('期望 command');
        // 直接挂上与战法定义一致的浮动状态（相当于准备阶段已施加）
        const cfg = (luHui.initialOutput ?? []).find(
          (o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'strategy_flux'
        );
        const st = cfg && cfg.kind === 'inflict_status' && !Array.isArray(cfg.status) ? cfg.status : undefined;
        if (st?.type !== 'strategy_flux') throw new Error('期望 strategy_flux 模板');
        liru.statuses.push({
          type: 'strategy_flux',
          low: st.low,
          high: st.high,
          mid: st.mid,
          convergeRounds: st.convergeRounds,
          remaining: 999,
          appliedRound: 0,
          sourceSkillType: 'command',
          sourceSkillId: SKILL_ID,
        });
      }
      ctx.currentRound = round;
      actUnit(ctx, liru);
      const hit = ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'jiyu_fuili'
      );
      if (!hit) throw new Error('期望策略伤害');
      return hit.breakdown.main;
    };

    const base1 = run(1, false);
    const flux1 = run(1, true);
    expect(flux1).toBeGreaterThanOrEqual(Math.floor(base1 * 0.8) - 1);
    expect(flux1).toBeLessThanOrEqual(Math.ceil(base1 * 1.5) + 1);

    const base6 = run(6, false);
    const flux6 = run(6, true);
    // 第 6 回合区间收敛到单点 115% → 恰好 1.15 倍（main 只随伤害率线性）
    expect(Math.abs(flux6 - Math.round(base6 * 1.15))).toBeLessThanOrEqual(1);
  });

  it('机制·浮动只作用于策略伤害：物理段同种子对照不受影响', () => {
    const run = (withFlux: boolean) => {
      const huaxiong = heroUnit('h647', '前锋');
      const ctx = makeCtx([huaxiong], enemyTrio(), 44);
      const def = ctx.skills.get('jiangchu_guanxi');
      if (def?.type !== 'active') throw new Error('期望 active');
      ctx.skills.set('jiangchu_guanxi', { ...def, triggerRate: 1, output: def.output.map((o) => (o.kind === 'physical_damage' ? { ...o, repeats: 2 } : o)) });
      if (withFlux) {
        huaxiong.statuses.push({
          type: 'strategy_flux',
          low: 80,
          high: 150,
          mid: 115,
          convergeRounds: 6,
          remaining: 999,
          appliedRound: 0,
          sourceSkillType: 'command',
          sourceSkillId: SKILL_ID,
        });
      }
      ctx.currentRound = 1;
      actUnit(ctx, huaxiong);
      return ctx.events
        .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'jiangchu_guanxi')
        .reduce((a, e) => a + (e.damage ?? 0), 0);
    };
    const plain = run(false);
    const withFlux = run(true);
    expect(plain).toBeGreaterThan(0);
    expect(withFlux).toBe(plain); // 物理段完全不消耗浮动随机数、数值一致
  });

  it('整场跑通（runBattle·8 回合）：浮动/增伤状态与 battle_end 齐全', () => {
    const liuhui: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 222,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), liuhui, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'strategy_flux')).toBe(true);
    expect(inflicted.some((e) => e.statusType === 'damage_boost')).toBe(true);
    // 每回合 −1/6 的衰减事件
    const changed = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_changed' }> => e.type === 'status_changed'
    );
    expect(changed.length).toBeGreaterThan(0);
  });
});
