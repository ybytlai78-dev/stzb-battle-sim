/**
 * 伏波扬砂（马腾·群骑 h785 主战法）：指挥 S，距离 5，我军全体。
 * 使我军全体普通攻击伤害提升 25.0%（受攻击属性影响）。当友军全体发动普通攻击时，造成的伤害
 * 共计提升幅度每达到 40%，马腾获得 1 层【扬砂】效果，最多叠加 20 层；马腾发动普通攻击后，
 * 将消耗 4 层【扬砂】效果进入连击状态，额外发动一次普通攻击，此效果将重复触发直到不足 4 层。
 * 官方：scripts/skill_extra.json id 200255（指挥 S / 距离 5 / 我军全体 / 兵种骑；1 级 12.5%）。
 * 入档：25%「受攻击属性影响」官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 马腾**下架**。
 * 引擎配套：`CommandSkill.stacksConsume` + `ctx.stacksConsumeCounters`（普攻增减伤净幅度累计 →
 *   每满 40% 得 1 层 → 马腾普攻后每 4 层换 1 次额外普攻）。
 * 口径（用户 2026-09-19 口述）：「伤害共计提升幅度」= 该次普攻的**总增伤与总减伤净合计**（百分点，
 *   `buffMult(...) − 1`），用变量累计、每满 40% 扣 40% 得 1 层（余数保留）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  triggerActiveSkill,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'fuboyangsha';
const KEY = `h785:${SKILL_ID}`;

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

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
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
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function counter(ctx: CombatContext) {
  return ctx.stacksConsumeCounters?.get(KEY);
}

/** 直接播种【扬砂】计数器（层数由普攻累计驱动，测试里手工种入便于确定性断言） */
function seedCounter(ctx: CombatContext, acc: number, stacks: number) {
  ctx.stacksConsumeCounters ??= new Map();
  ctx.stacksConsumeCounters.set(KEY, { acc, stacks });
}

function attackHitsOf(ctx: CombatContext, unitId: string) {
  return eventsOf(ctx, 'attack_hit').filter((e) => e.sourceId === unitId);
}

/** 马腾（大营·带主战法，已施加普攻增伤）+ 1 友军（前锋）+ 3 敌军 */
function setup(seed = 1) {
  const mateng = heroUnit('h785', '大营', { commandSkillIds: [SKILL_ID] });
  const ally = makeUnit(dummy('ally', '前锋'));
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([mateng, ally], foes, seed);
  triggerCommandSkills(ctx, mateng); // 准备阶段：我军全体获得普攻伤害 +25%
  return { mateng, ally, foes, ctx, allies: [mateng, ally] };
}

describe('伏波扬砂（马腾 h785）', () => {
  it('装配：注册表定义（普攻增伤 + 扬砂层数消耗）+ h785 挂槽 + 受攻击成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h785'];
    expect(hero.name).toBe('马腾');
    expect(hero.mainSkillName).toBe('伏波扬砂');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('all');
    expect(s.output).toEqual([
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.25,
          duration: 999,
          direction: 'caused',
          attackScaled: true,
          damageSource: 'basic',
        },
      },
    ]);
    expect(s.stacksConsume).toEqual({ threshold: 40, maxStacks: 20, consumePerAttack: 4 });

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('普攻增伤只作用于普通攻击（damageSource:basic），主动战法吃不到', () => {
    const { mateng, ally, foes, ctx, allies } = setup();
    // 我军全体（含马腾自己）各一份普攻增伤
    for (const u of allies) {
      const boost = u.statuses.find((s) => s.type === 'damage_boost');
      expect(boost).toBeTruthy();
      if (boost && boost.type === 'damage_boost') {
        expect(boost.rate).toBeCloseTo(0.25, 5);
        expect(boost.direction).toBe('caused');
        expect(boost.damageSource).toBe('basic'); // 只吃普攻
      }
    }

    // 主动战法（迷阵·策略伤害）的增减伤归因里不含伏波扬砂
    const mizhen = structuredClone(SKILL_REGISTRY['mizhen']) as Skill;
    mizhen.triggerRate = 1;
    ctx.skills.set('mizhen', mizhen);
    triggerActiveSkill(ctx, ally, mizhen, foes, allies, [...foes, ...allies]);
    for (const ev of eventsOf(ctx, 'damage')) {
      const sources = [...(ev.modifiers?.caused ?? []), ...(ev.modifiers?.taken ?? []), ...(ev.modifiers?.reduce ?? [])];
      expect(sources.every((m) => m.skillId !== SKILL_ID)).toBe(true);
    }
  });

  it('层数累计：我军每次普攻把「增减伤净幅度」累入计数器，每满 40% 得 1 层（余数保留）', () => {
    const { ally, ctx } = setup(3);
    expect(counter(ctx)).toBeUndefined();

    // 第 1 次普攻：净 +25% → 累计 25、0 层
    actUnit(ctx, ally);
    expect(counter(ctx)).toEqual({ acc: 25, stacks: 0 });

    // 第 2 次普攻（下一回合）：累计 50 → 满 40 扣掉 → 1 层 + 余 10
    ctx.currentRound = 2;
    actUnit(ctx, ally);
    expect(counter(ctx)).toEqual({ acc: 10, stacks: 1 });
  });

  it('消耗触发：马腾普攻后每 4 层换 1 次额外普攻，可重复触发直到不足 4 层', () => {
    const { mateng, ctx } = setup(5);
    seedCounter(ctx, 0, 8);

    actUnit(ctx, mateng);

    // 本体 1 次 + 8 层换 2 次额外普攻 = 3 次（额外普攻继续累计：第 2 次后 50 → 5 层、再扣 4 → 1 层）
    expect(attackHitsOf(ctx, 'h785')).toHaveLength(3);
    expect(counter(ctx)).toEqual({ acc: 35, stacks: 1 });
  });

  it('层数上限：满 20 层后不再累计', () => {
    const { mateng, ally, ctx } = setup(7);
    seedCounter(ctx, 0, 20);
    actUnit(ctx, ally); // 友军普攻也不再累计（已达上限）
    expect(counter(ctx)).toEqual({ acc: 0, stacks: 20 });

    // 马腾自己行动：上限层数不会消耗（不足 4 层才停 → 20 层可换 5 次，此处只验证不再增长）
    const before = counter(ctx)!.stacks;
    actUnit(ctx, mateng);
    expect(counter(ctx)!.stacks).toBeLessThanOrEqual(before);
  });

  it('整场跑通（runBattle）：层数随普攻累计，马腾出现额外普攻', () => {
    const mateng: General = {
      ...withSkills(level40(HERO_REGISTRY['h785']), { commandSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 31,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), mateng, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    // 马腾单回合普攻次数出现过 >1（4 层点亮后的额外普攻）
    const byRound = new Map<number, number>();
    let round = 0;
    for (const ev of report.events) {
      if (ev.type === 'round_start') round = ev.round;
      if (ev.type === 'attack_hit' && ev.sourceId === 'h785') {
        byRound.set(round, (byRound.get(round) ?? 0) + 1);
      }
    }
    expect(Math.max(...byRound.values())).toBeGreaterThan(1);
  });
});
