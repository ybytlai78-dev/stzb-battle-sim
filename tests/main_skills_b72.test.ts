/**
 * 竭忠尽智（张昭·吴弓 h648 主战法）：主动 B，距离 2，发动率 45%，目标我军群体（有效距离内 2-3 个目标）。
 * 满级：以自身与友军攻击属性最低的武将下一次行动时进入怯战状态为代价，使我军群体受到的攻击伤害
 *   降低 20.0%（受谋略属性影响），该效果可以叠加 1 次，持续 2 回合；并使我军群体下 2 次造成的
 *   策略伤害提高 30.0%（受谋略属性影响）。
 * 1 级：减伤 10.0% / 增伤 15.0%（同为可叠加 1 次 / 下 2 次）。
 * 官方：scripts/skill_extra.json id 200928（主动 / 距离 2 / 我军群体（有效距离内 2-3 个目标）/ 兵种弓；
 *   effect 标签 怯战(预备);受到攻击伤害降低;策略攻击伤害提高）。
 *   来源 https://stzb.163.com/m/skilllist/200928.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 「自身与友军攻击属性最低的武将」= 自身 + 友军全体里攻击最低者 → `targetPick:'lowest_attack_ally'`（推定）；
 *   ② 「该效果可以叠加 1 次」= 最多 2 层（20% → 40%，推定）；③ 「下 2 次」按每个目标各自 2 次（charges 2，推定）；
 *   ④ 减伤段 `duration:2`；增伤段按次数（duration 999 + charges 2）；⑤ 我军群体 = group + groupCount [2,3]；
 *   ⑥ 两段「受谋略」官方未给成长率 → 基值不缩放 → 登记 OFFLINE_MAIN_SKILLS（武将下架）；
 *   ⑦ 「怯战(预备)」→ 引擎件 `cowardice.pendingNextAct`。
 * 引擎配套两件：① `damage_reduce.maxStacks`；② `cowardice.pendingNextAct`。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 * 未导出 `executeSkillOutputs` → 战法段用 `triggerActiveSkill`（克隆 triggerRate 1 求确定）/
 *   `actUnit`（真实主动链路，验证 pendingNextAct 的「本次行动不封普攻、下次行动封」时序）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  inflictStatus,
  triggerActiveSkill,
  hasStatus,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CreateStatus,
  General,
  HeroRecord,
  Position,
  Skill,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jiezhong_jinzhi';
const HERO_ID = 'h648';

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

/** 克隆注册表定义：triggerRate 改 1 求确定（段目标数/随机仍按真实 RNG） */
function castClone(): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'active') throw new Error('竭忠尽智应为主动战法');
  s.triggerRate = 1;
  return s;
}

/** 只打一次策略伤害的测试战法（用于消耗 damage_boost.charges） */
const STRATEGY_HIT: Skill = {
  id: 'test_strategy_hit',
  name: '测试策略攻击',
  type: 'active',
  prepare: false,
  range: 3,
  triggerRate: 1,
  targetMode: 'random_single',
  targetSide: 'enemy',
  tags: ['damage'],
  output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
};

describe('竭忠尽智（张昭 h648）', () => {
  it('装配：主动·45%·距离2·group[2,3]·targetSide ally·三段 output · h648 挂槽 · 下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('张昭');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('竭忠尽智');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入主动槽（mainSkillSlot 依战法类型）
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(2);
    expect(s.triggerRate).toBe(0.45);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toEqual([2, 3]);
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_reduce', 'damage_boost', 'cowardice']);
    expect(s.output).toEqual([
      // 代价段：自身+友军攻击最低者 下一次行动时进入怯战
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetPick: 'lowest_attack_ally',
        status: { type: 'cowardice', duration: 1, pendingNextAct: true },
      },
      // 我群体受到攻击伤害 −20%（受谋略）可叠 1 次（2 层），持续 2 回合
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: [2, 3],
        status: {
          type: 'damage_reduce',
          rate: 0.2,
          duration: 2,
          damageType: 'physical',
          strategyScaled: true,
          stack: true,
          maxStacks: 2,
        },
      },
      // 我群体下 2 次造成策略伤害 +30%（受谋略）
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: [2, 3],
        status: {
          type: 'damage_boost',
          rate: 0.3,
          duration: 999,
          direction: 'caused',
          damageType: 'strategy',
          charges: 2,
          strategyScaled: true,
        },
      },
    ]);

    // 受谋略成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('引擎件①·damage_reduce.maxStacks：连续施加 3 次 → rate 0.2 → 0.4 → 仍 0.4（stacks 封顶 2）', () => {
    const u = makeUnit(dummy('u1', '前锋'), 'my', 9000);
    const ctx = makeCtx([u], [], 1);
    const create: CreateStatus = {
      type: 'damage_reduce',
      rate: 0.2,
      duration: 2,
      damageType: 'physical',
      strategyScaled: true,
      stack: true,
      maxStacks: 2,
    };

    const reduceOf = () => {
      const s = u.statuses.find((x) => x.type === 'damage_reduce');
      expect(s).toBeTruthy();
      return s as Extract<typeof s, { type: 'damage_reduce' }>;
    };

    inflictStatus(ctx, u, create, 'active', SKILL_ID, 'u1');
    expect(reduceOf().rate).toBeCloseTo(0.2);
    expect(reduceOf().stacks).toBe(1);
    expect(reduceOf().maxStacks).toBe(2);

    inflictStatus(ctx, u, create, 'active', SKILL_ID, 'u1');
    expect(reduceOf().rate).toBeCloseTo(0.4);
    expect(reduceOf().stacks).toBe(2);

    // 第 3 次：同战法同过滤维已满 2 层 → 守卫拒绝，不再累加 rate
    inflictStatus(ctx, u, create, 'active', SKILL_ID, 'u1');
    expect(reduceOf().rate).toBeCloseTo(0.4);
    expect(reduceOf().stacks).toBe(2);
    expect(u.statuses.filter((x) => x.type === 'damage_reduce')).toHaveLength(1);
  });

  it('引擎件②·cowardice.pendingNextAct：本次行动普攻照打，下次行动开始才封普攻，随后到期移除', () => {
    // 张昭攻击最低 → 代价段怯战挂到自己身上（施法同行动内即被施加）
    const me = heroUnit(HERO_ID, '前锋', { activeSkillIds: [SKILL_ID] });
    const buddy = makeUnit(dummy('ally-hi', '中军', { attack: 200 }), 'my', 9000);
    const ctx = makeCtx([me, buddy], enemyTrio(), 13);
    ctx.skills.set(SKILL_ID, castClone());

    // 回合 1：行动中释放 → 挂上 pendingNextAct 怯战 → 本次行动普攻仍可打出
    actUnit(ctx, me);
    expect(eventsOf(ctx, 'attack_hit').filter((e) => e.sourceId === HERO_ID).length).toBeGreaterThan(0);
    const pending = me.statuses.find((s) => s.type === 'cowardice');
    expect(pending && 'pendingNextAct' in pending && pending.pendingNextAct).toBe(true);

    // 回合 2：行动开始时 pending 激活 → 普攻被封（无 attack_hit，给出怯战原因）
    const mark = ctx.events.length;
    ctx.currentRound = 2;
    actUnit(ctx, me);
    const round2 = ctx.events.slice(mark);
    expect(round2.filter((e) => e.type === 'attack_hit' && e.sourceId === HERO_ID)).toHaveLength(0);
    expect(
      round2.some((e) => e.type === 'no_attack_target' && e.unitId === HERO_ID && e.reason.includes('怯战'))
    ).toBe(true);
    const active = me.statuses.find((s) => s.type === 'cowardice');
    expect(active && 'pendingNextAct' in active && active.pendingNextAct).toBe(false);

    // 回合 3：到期移除（清空主动槽避免再次挂上 pending 怯战，验证纯移除）
    me.general.activeSkillIds = [];
    ctx.currentRound = 3;
    actUnit(ctx, me);
    expect(me.statuses.some((s) => s.type === 'cowardice')).toBe(false);
    expect(hasStatus(me, 'cowardice')).toBe(false);
  });

  it('战法·代价段：一次释放后「自身+友军里攻击最低者」带 pending 怯战，其余友军不带', () => {
    const me = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID] });
    const low = makeUnit(dummy('ally-low', '前锋', { attack: 30 }), 'my', 9000);
    const mid = makeUnit(dummy('ally-mid', '大营', { attack: 60 }), 'my', 9000);
    const ctx = makeCtx([low, me, mid], enemyTrio(), 11);
    const skill = castClone();
    ctx.skills.set(SKILL_ID, skill);

    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);

    const cw = low.statuses.find((s) => s.type === 'cowardice');
    expect(cw && 'pendingNextAct' in cw && cw.pendingNextAct).toBe(true);
    expect(me.statuses.some((s) => s.type === 'cowardice')).toBe(false);
    expect(mid.statuses.some((s) => s.type === 'cowardice')).toBe(false);

    const inflicts = eventsOf(ctx, 'status_inflicted').filter((e) => e.statusType === 'cowardice');
    expect(inflicts).toHaveLength(1);
    expect(inflicts[0]?.unitId).toBe('ally-low');
    expect(inflicts[0]?.detail).toContain('下一次行动时进入怯战状态');
  });

  it('战法·减伤与增伤：2 层减伤（0.4 / physical）+ damage_boost（caused/strategy/charges 2）；charges 打 2 次耗尽移除', () => {
    const me = heroUnit(HERO_ID, '前锋', { activeSkillIds: [SKILL_ID] });
    const ctx = makeCtx([me], enemyTrio(), 7);
    const skill = castClone();
    ctx.skills.set(SKILL_ID, skill);

    // 释放 2 次 → 减伤同源叠到 2 层（0.2 → 0.4）
    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);

    const reduce = me.statuses.find((s) => s.type === 'damage_reduce');
    expect(reduce && 'rate' in reduce && reduce.rate).toBeCloseTo(0.4);
    expect(reduce && 'damageType' in reduce && reduce.damageType).toBe('physical');
    expect(reduce && 'stacks' in reduce && reduce.stacks).toBe(2);

    const boost = me.statuses.find((s) => s.type === 'damage_boost');
    expect(boost && 'rate' in boost && boost.rate).toBeCloseTo(0.3);
    expect(boost && 'direction' in boost && boost.direction).toBe('caused');
    expect(boost && 'damageType' in boost && boost.damageType).toBe('strategy');
    expect(boost && 'charges' in boost && boost.charges).toBe(2);

    // 打出 2 次策略伤害 → charges 逐次 −1，耗尽即移除
    ctx.skills.set(STRATEGY_HIT.id, STRATEGY_HIT);
    triggerActiveSkill(ctx, me, STRATEGY_HIT, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const after1 = me.statuses.find((s) => s.type === 'damage_boost');
    expect(after1 && 'charges' in after1 && after1.charges).toBe(1);

    triggerActiveSkill(ctx, me, STRATEGY_HIT, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    expect(me.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
  });

  it('整场跑通（runBattle·8 回合）：skill_cast / status_inflicted / battle_end 齐全', () => {
    const zhangzhao: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { activeSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), zhangzhao, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
        e.type === 'skill_cast' && e.skillId === SKILL_ID
    );
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((e) => e.unitId === HERO_ID)).toBe(true);

    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.length).toBeGreaterThan(0);
  });
});
