/**
 * 迟智难酬（陈宫·群弓 h443 主战法）：主动 S（无准备），距离 5，敌军群体（有效距离内 2 个目标），发动率 40%。
 * 满级：对敌军群体发动一次策略攻击（伤害率 240.0%，受谋略属性影响），并使友军群体受到下 1-2 次策略攻击的
 *   伤害大幅度降低。1 级：策略伤害 120.0%。
 * 官方：scripts/skill_extra.json id 200805。来源 https://stzb.163.com/m/skilllist/200805.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 官方现页 40%（本地旧数据 35% 按策略 A ① 弃用）；
 *   ② 友军段 = `targetSide:'ally'` + `targetMode:'group'`（2 目标，含施法者自身）；
 *   ③ 「大幅度降低」= 极大值 → taken 侧 rate −99.99（−9999%）→ buffMult 10% 下限；
 *   ④ 「下 1-2 次」= 施加时随机 1~2 次（`charges: [1,2]`）；只吃策略攻击（damageType 过滤）；
 *   ⑤ 策略伤害 240% 受谋略成长率未确认（按基值）→ 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'chizhi_nanchou';
const HERO_ID = 'h443';

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

const debuffOf = (u: UnitState) =>
  u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID
  );

/** 敌军被试战法：1 次策略攻击（100%） */
function testStratSkill(): Skill {
  return {
    id: 't_strat',
    name: '测试策略',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
  };
}

/** 敌军行动一次（先放策略战法、再普攻），返回策略伤害与普攻伤害；withDebuff 时先挂「受到下 N 次策略伤害大幅降低」 */
function foeBurst(withDebuff: boolean, charges = 1, seed = 33) {
  const ally = makeUnit(dummy('ally-front', '前锋'), 'my', 30000);
  const foe = makeUnit(dummy('foe', '前锋', { activeSkillIds: ['t_strat'] }), 'enemy', 30000);
  const ctx = makeCtx([ally], [foe], seed);
  ctx.skills.set('t_strat', testStratSkill());
  if (withDebuff) {
    inflictStatus(
      ctx,
      ally,
      { type: 'damage_boost', rate: -99.99, duration: 999, direction: 'taken', damageType: 'strategy', charges },
      'active',
      SKILL_ID,
      foe.general.id
    );
  }
  actUnit(ctx, foe);
  const strat = eventsOf(ctx, 'damage').find((e) => e.skillId === 't_strat')?.damage ?? 0;
  const phys = eventsOf(ctx, 'attack_hit').find((e) => e.sourceId === 'foe')?.damage ?? 0;
  return { ctx, ally, strat, phys };
}

describe('迟智难酬（陈宫 h443）', () => {
  it('装配：主动·距离 5·敌军群体 2·40%·策略 240% + 友军群体「下 1-2 次策略减伤」·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('陈宫');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('迟智难酬');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual(['damage', 'damage_boost']);
    expect(s.output).toEqual([
      { kind: 'strategy_damage', rate: 240, strategyScaled: true },
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
        status: {
          type: 'damage_boost',
          rate: -99.99,
          duration: 999,
          direction: 'taken',
          damageType: 'strategy',
          charges: [1, 2],
        },
      },
    ]);

    // 策略伤害受谋略成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·敌军群体 2 个策略伤害 + 友军群体 2 人得「受到策略伤害大幅降低」（随机 1~2 次）', () => {
    const chenGong = heroUnit(HERO_ID, '中军');
    const ctx = makeCtx(
      [makeUnit(dummy('ally-front', '前锋'), 'my', 9000), chenGong, makeUnit(dummy('ally-back', '大营'), 'my', 9000)],
      [
        makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
        makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
        makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
      ],
      9
    );
    ctx.skills.set(SKILL_ID, { ...(SKILL_REGISTRY[SKILL_ID] as Skill), triggerRate: 1 } as Skill);

    actUnit(ctx, chenGong);

    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    expect(dmg).toHaveLength(2); // 敌军群体（有效距离内 2 个目标）
    expect(dmg.every((e) => e.damageType === 'strategy')).toBe(true);
    expect(dmg.every((e) => e.sourceId === HERO_ID)).toBe(true);
    expect(new Set(dmg.map((e) => e.targetId)).size).toBe(2); // 两个不同目标

    const buffed = ctx.myTeam.filter((u) => debuffOf(u));
    expect(buffed).toHaveLength(2); // 友军群体 = 2 目标
    for (const u of buffed) {
      const st = debuffOf(u)!;
      expect(st.direction).toBe('taken');
      expect(st.rate).toBeCloseTo(-99.99, 6);
      expect(st.damageType).toBe('strategy');
      expect(st.charges).toBeGreaterThanOrEqual(1);
      expect(st.charges).toBeLessThanOrEqual(2);
    }
  });

  it('机制·减伤只吃策略攻击：策略伤害被压到下限，普通攻击不受影响（同种子双跑对比）', () => {
    const base = foeBurst(false);
    const debuffed = foeBurst(true, 1);
    expect(base.strat).toBeGreaterThan(0);
    expect(debuffed.strat).toBeLessThan(base.strat * 0.6);
    // 普攻不匹配 damageType:'strategy' → 伤害不受影响
    expect(debuffed.phys).toBe(base.phys);
  });

  it('机制·次数耗尽移除：charges 2 → 两次策略攻击后状态消失（每次只扣 1）', () => {
    const ally = makeUnit(dummy('ally-front', '前锋'), 'my', 30000);
    const foe = makeUnit(dummy('foe', '前锋', { activeSkillIds: ['t_strat'] }), 'enemy', 30000);
    const ctx = makeCtx([ally], [foe], 5);
    ctx.skills.set('t_strat', testStratSkill());
    inflictStatus(
      ctx,
      ally,
      { type: 'damage_boost', rate: -99.99, duration: 999, direction: 'taken', damageType: 'strategy', charges: 2 },
      'active',
      SKILL_ID,
      foe.general.id
    );
    expect(debuffOf(ally)?.charges).toBe(2);

    actUnit(ctx, foe);
    expect(debuffOf(ally)?.charges).toBe(1); // 每次策略攻击只扣 1 次
    actUnit(ctx, foe);
    expect(debuffOf(ally)).toBeUndefined(); // 次数用尽即移除
  });

  it('整场跑通（runBattle·8 回合）：策略杀伤与策略减伤状态均出现，battle_end 齐全', () => {
    const chenGong: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 777,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), chenGong, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(dmg.length).toBeGreaterThan(0);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_boost'
    );
    expect(inflicted.length).toBeGreaterThan(0);
  });
});
