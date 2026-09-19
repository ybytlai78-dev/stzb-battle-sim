/**
 * 将门有将（XP关兴＆张苞·蜀步 h653 主战法）：被动 A，距离 1，目标自己。
 * 每回合自身行动时有 30.0% 的概率获得以下效果（每个效果独立判断）：
 *  ① 获得连击效果，持续 1 回合；② 获得分兵效果（伤害率 100.0%），持续 1 回合；
 *  此概率每回合结束时提高 10.0%（可累加，官方未给上限）。
 * 官方：scripts/skill_extra.json id 200933（被动 A / 距离 1 / 自己 / 兵种步；1 级 15% / 分兵 50% / 每回合 +5%）。
 * 来源：https://stzb.163.com/m/skilllist/200933.html
 * 入档：三个数值（30% / 每回合 +10% / 分兵 100%）官方均给确定值，且无「受属性影响」段 → **上架**
 *   （不登记 OFFLINE_MAIN_SKILLS）。
 * 引擎配套：新机制 `BaseSkill.roundRampingChance` —— 输出段未显式给 `chance` 时，基础率改为
 *   `min(1, base + increment × (当前回合 − 1))`（再走士气修正），逐段独立判定、各自发 `skill_trigger`。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jiangmen_youjiang';

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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 覆盖递增几率配置（只改 ctx 内副本，不动注册表）；actUnit 每次从 ctx.skills 解析战法 */
function forceRamp(ctx: CombatContext, base: number, increment = 0): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'passive') s.roundRampingChance = { base, increment };
  ctx.skills.set(SKILL_ID, s);
}

/** 关兴＆张苞（大营）+ 1 个不还手的敌军（前锋） */
function setup(seed = 1) {
  const hero = heroUnit('h653', '大营', { passiveSkillIds: [SKILL_ID] });
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
  const ctx = makeCtx([hero], [foe], seed);
  return { hero, foe, ctx };
}

/** 本战法的全部发动率判定事件（每回合两段：连击 / 分兵） */
function triggersOf(ctx: CombatContext) {
  return eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
}

describe('将门有将（XP关兴＆张苞 h653）', () => {
  it('装配：注册表定义（被动·自身·连击+分兵两段 + 递增几率）+ h653 挂槽 + 上架', () => {
    const hero = HERO_REGISTRY['h653'];
    expect(hero.name).toBe('XP关兴＆张苞');
    expect(hero.mainSkillName).toBe('将门有将');
    expect(HERO_RECORDS['h653'].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('round_start'); // 每回合自身行动时判定
    expect(s.range).toBe(1);
    expect(s.targetMode).toBe('self');
    expect(s.tags).toEqual(['combo', 'split']);
    expect(s.roundRampingChance).toEqual({ base: 0.3, increment: 0.1 });
    expect(s.output).toHaveLength(2);
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'combo', duration: 1 },
    });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'split', rate: 100, duration: 1 },
    });

    // 三数值官方均给确定值、无受属性缩放段 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(true);
  });

  it('递增几率：每回合两段独立判定，baseRate 逐回合 30 → 40 → 50', () => {
    const { hero, ctx } = setup(1);
    const rates: number[] = [];
    for (let round = 1; round <= 3; round++) {
      ctx.currentRound = round;
      ctx.events = [];
      actUnit(ctx, hero);
      const ts = triggersOf(ctx);
      expect(ts).toHaveLength(2); // 连击 / 分兵 各判一次（与是否命中无关）
      expect(ts[0].baseRate).toBe(ts[1].baseRate); // 同回合两段共用同一（递增后）基础率
      expect(ts[0].morale).toBe(100);
      rates.push(ts[0].baseRate!);
    }
    expect(rates).toEqual([30, 40, 50]);
  });

  it('每个效果独立判断：各自掷点（出现「只中一个」），命中时连击/分兵状态落地正确', () => {
    let sawExactlyOne = false;
    let sawBoth = false;
    let sawNone = false;
    for (let seed = 1; seed <= 20; seed++) {
      const { hero, ctx } = setup(seed);
      forceRamp(ctx, 0.5); // 每段 50%，独立判定
      actUnit(ctx, hero);
      const ts = triggersOf(ctx);
      expect(ts).toHaveLength(2);
      const combo = hero.statuses.find((s) => s.type === 'combo');
      const split = hero.statuses.find((s) => s.type === 'split');
      // 两段各自的判定结果与各自的状态一一对应（不是一次判定决定两段）
      expect(Boolean(combo)).toBe(ts[0].success);
      expect(Boolean(split)).toBe(ts[1].success);
      if (combo && split) {
        expect((combo as { remaining: number }).remaining).toBe(1);
        expect((split as { rate: number }).rate).toBe(100);
      }
      const n = Number(Boolean(combo)) + Number(Boolean(split));
      if (n === 1) sawExactlyOne = true;
      if (n === 2) sawBoth = true;
      if (n === 0) sawNone = true;
    }
    expect(sawExactlyOne).toBe(true); // 独立判定才会出现「只中一个」
    expect(sawBoth).toBe(true);
    expect(sawNone).toBe(true);
  });

  it('几率置零 / 拉满：不命中无状态、命中两段全中', () => {
    const zero = setup(3);
    forceRamp(zero.ctx, 0);
    actUnit(zero.ctx, zero.hero);
    expect(zero.hero.statuses.some((s) => s.type === 'combo' || s.type === 'split')).toBe(false);

    const one = setup(3);
    forceRamp(one.ctx, 1);
    actUnit(one.ctx, one.hero);
    expect(one.hero.statuses.some((s) => s.type === 'combo')).toBe(true);
    expect(one.hero.statuses.some((s) => s.type === 'split')).toBe(true);
  });

  it('整场跑通（runBattle）：每回合行动均判定，baseRate 逐回合 30→40→…（封顶 100）', () => {
    const hero: General = {
      ...withSkills(level40(HERO_REGISTRY['h653']), { passiveSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), hero],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const ts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === SKILL_ID,
    );
    expect(ts.length % 2).toBe(0); // 每回合恒有 2 段
    const rates = ts.filter((_, i) => i % 2 === 0).map((e) => e.baseRate);
    expect(rates.length).toBeGreaterThanOrEqual(3);
    expect(rates).toEqual([30, 40, 50, 60, 70, 80, 90, 100].slice(0, rates.length));
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillId === SKILL_ID)).toBe(true);
  });
});
