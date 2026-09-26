/**
 * 酒池肉林（董卓·汉步 h480 主战法）：指挥 S（一类指挥 prep，三段按回合窗口展开），距离 3，
 * 我军群体（有效距离内 3 个目标），发动率 --。
 * 满级：战斗开始后前 2 回合，使我军全体受到的所有伤害降低 32.0%（受防御属性影响），此效果结束后，
 *   将在 1 回合内使我军全体造成的所有伤害大幅度降低，第 4 回合开始，使自身造成攻击伤害时能够借此
 *   恢复相当于伤害值 35.0% 的兵力，持续直到战斗结束。1 级：减伤 16.0% / 恢复 17.5%。
 * 官方：scripts/skill_extra.json id 200014。来源 https://stzb.163.com/m/skilllist/200014.html
 * 口径（策略 A + 用户 2026-09-20 口径；推定处已标注）：
 *   ① 前 2 回合减伤 → initialOutput + damage_reduce duration 2（准备阶段施加按回合末递减 →
 *      覆盖第 1~2 回合、第 3 回合行动前失效，与用户「实则持续到第三回合行动前」一致）；受防御未确认 → 基值 32%；
 *   ② 目标行「我军群体3」与描述「我军全体」冲突 → 按描述取 all（策略 A ③）；
 *   ③ 第 3 回合我军全体造成伤害大幅降低 = caused 侧极大值 −9999%（用户「大幅度」= 极大值口径）、duration 1；
 *   ④ 第 4 回合起自身攻击伤害吸血 35%（官方现页数值；用户称比例未知 → 待复核）→ healOnDamage
 *      新增 selfOnly + startRound；
 *   ⑤ 减伤受防御成长未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, tickRoundStartStatuses, tickStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jiuchi_roulin';
const HERO_ID = 'h480';

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

function heroUnit(heroId: string, position: Position, patch: Parameters<typeof withSkills>[1] = {}): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), patch), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

const statusOf = <T extends Status['type']>(u: UnitState, type: T) =>
  u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID) as
    | Extract<Status, { type: T }>
    | undefined;

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
}

/** 董卓 + 前锋/大营友军；准备阶段注册一类指挥 */
function setup(seed = 1, patch: Parameters<typeof withSkills>[1] = {}) {
  const dongZhuo = heroUnit(HERO_ID, '中军', patch);
  const front = makeUnit(dummy('ally-front', '前锋', { activeSkillIds: ['t_phys'] }), 'my', 9000);
  const back = makeUnit(dummy('ally-back', '大营'), 'my', 9000);
  const ctx = makeCtx([front, dongZhuo, back], enemyTrio(), seed);
  ctx.skills.set('t_phys', testSkill('t_phys', 'physical'));
  ctx.skills.set('t_strat', testSkill('t_strat', 'strategy'));
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, dongZhuo);
  ctx.currentRound = 1;
  return { ctx, dongZhuo, front, back };
}

function testSkill(id: string, kind: 'physical' | 'strategy'): Skill {
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    tags: ['damage'],
    output:
      kind === 'physical'
        ? [{ kind: 'physical_damage', rate: 100 }]
        : [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
  };
}

describe('酒池肉林（董卓 h480）', () => {
  it('装配：一类指挥 prep·距离 3·我军全体·三段（减伤 32%×2 回合 / 第 3 回合造成伤害极大值 / 第 4 回合起吸血 35%）·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('董卓');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('酒池肉林');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('all');
    expect(s.tags).toEqual(['damage_reduce', 'damage_boost', 'heal']);
    expect(s.output).toEqual([]);
    expect(s.initialOutput).toEqual([
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'all',
        status: { type: 'damage_reduce', rate: 0.32, duration: 2, defenseScaled: true },
      },
    ]);
    expect(s.roundStartRepeat).toEqual({
      rounds: [3],
      output: [
        {
          kind: 'inflict_status',
          targetSide: 'ally',
          targetMode: 'all',
          status: { type: 'damage_boost', rate: -99.99, duration: 1, direction: 'caused' },
        },
      ],
    });
    expect(s.healOnDamage).toEqual({ healRate: 35, selfOnly: true, startRound: 4 });

    // 减伤受防御成长未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·前 2 回合我军全体受到所有伤害 −32%（受防御未确认 → 基值 32%），第 3 回合行动前失效', () => {
    const { ctx } = setup(2);
    for (const u of ctx.myTeam) {
      const st = statusOf(u, 'damage_reduce');
      if (st?.type !== 'damage_reduce') throw new Error('期望 damage_reduce');
      expect(st.rate).toBeCloseTo(0.32, 6);
      expect(st.remaining).toBe(2);
      expect(st.damageType).toBeUndefined(); // 所有伤害类型
    }

    // 回合末结算（与 combat.ts 一致）：第 1 回合末 2 → 1，第 2 回合末移除 → 第 3 回合行动前已失效
    ctx.currentRound = 1;
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(ctx.myTeam.every((u) => statusOf(u, 'damage_reduce')?.remaining === 1)).toBe(true);
    ctx.currentRound = 2;
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(ctx.myTeam.every((u) => statusOf(u, 'damage_reduce') === undefined)).toBe(true);
  });

  it('机制·第 3 回合：我军全体造成的所有伤害大幅降低（极大值 −9999%，仅第 3 回合）', () => {
    const { ctx } = setup(3);
    // 第 2 回合开始前：不施加
    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    expect(ctx.myTeam.every((u) => statusOf(u, 'damage_boost') === undefined)).toBe(true);

    ctx.currentRound = 3;
    tickRoundStartStatuses(ctx);
    for (const u of ctx.myTeam) {
      const st = statusOf(u, 'damage_boost');
      if (st?.type !== 'damage_boost') throw new Error('期望 damage_boost');
      expect(st.direction).toBe('caused');
      expect(st.rate).toBeCloseTo(-99.99, 6);
      expect(st.remaining).toBe(1);
    }
  });

  it('机制·第 4 回合起：仅自身**攻击伤害**按 35% 吸血（策略伤害/友军伤害/第 3 回合均不触发）', () => {
    const { ctx, dongZhuo, front } = setup(5, { activeSkillIds: ['t_phys', 't_strat'] });
    // 怯战封普攻：每次行动只留 1 条攻击伤害（战法），便于逐条核对吸血
    inflictStatus(ctx, dongZhuo, { type: 'cowardice', duration: 999 }, 'active', 'test_seal', dongZhuo.general.id);
    dongZhuo.troops = 5000; // 留出恢复空间

    // 第 3 回合：未到 startRound 4 → 无恢复
    ctx.currentRound = 3;
    actUnit(ctx, dongZhuo);
    expect(eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID)).toHaveLength(0);

    // 第 4 回合：攻击伤害触发吸血（恢复量 = 该次伤害 × 35%）；策略伤害不触发
    ctx.currentRound = 4;
    dongZhuo.troops = 5000;
    ctx.events = [];
    ctx.myTeam.forEach((u) => (u.hasActedThisRound = false));
    actUnit(ctx, dongZhuo);
    const phys = eventsOf(ctx, 'damage').filter((e) => e.skillId === 't_phys');
    const strat = eventsOf(ctx, 'damage').filter((e) => e.skillId === 't_strat');
    expect(phys).toHaveLength(1);
    expect(strat).toHaveLength(1);
    const heals = eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID);
    expect(heals).toHaveLength(1); // 只有攻击伤害那一跳吸血
    expect(heals[0]?.targetId).toBe(HERO_ID);
    expect(heals[0]?.amount).toBe(Math.round(phys[0]!.damage * 0.35));

    // 友军造成的攻击伤害不吸血（selfOnly：只对自身）
    const before = eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID).length;
    ctx.myTeam.forEach((u) => (u.hasActedThisRound = false));
    actUnit(ctx, front);
    expect(eventsOf(ctx, 'damage').some((e) => e.skillId === 't_phys')).toBe(true);
    expect(eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID)).toHaveLength(before);
  });

  it('整场跑通（runBattle·8 回合）：减伤/易伤/吸血三段均出现，battle_end 齐全', () => {
    const dongZhuo: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 2480,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dongZhuo, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const statuses = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(statuses.some((e) => e.statusType === 'damage_reduce')).toBe(true);
    expect(statuses.some((e) => e.statusType === 'damage_boost')).toBe(true);
    expect(
      report.events.some((e) => e.type === 'heal' && e.skillId === SKILL_ID)
    ).toBe(true);
  });
});
