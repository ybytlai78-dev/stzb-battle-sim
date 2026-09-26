/**
 * 辞后定朝（阴丽华·汉弓 h742 主战法）：指挥 A，距离 3，我军全体。
 * 战斗前 3 回合，自身行动时有 90.0% 几率移除自身受到的由指挥、主动、追击战法带来的有害和有益效果；
 * 第 4 回合开始，使友军全体中男性武将攻击和防御属性提升 40.0（受谋略属性影响），
 * 女性武将谋略和防御属性提升 40.0（受谋略属性影响）。
 * 官方：scripts/skill_extra.json id 201007（指挥 A / 距离 3 / 我军全体 / 兵种弓步；1 级 45% / 属性 20）。
 * 入档：属性 +40「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 阴丽华**下架**。
 * 引擎配套：`CommandSkill.onActSegments`（行动时分段：窗口 + 几率 + once）/ `remove_by_source_skill_type` /
 *   `inflict_status.requireGender` / `General.gender`（← web/data/hero_meta.json）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { inflictStatus, triggerRoundCommandOnAct, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'cihou_dingchao';

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

/** 把第 ① 段几率拉满（缺省 90% 会掺 RNG） */
function forceRemoveSegment(ctx: CombatContext, rate = 1): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'command' && s.onActSegments) s.onActSegments[0].rate = rate;
  ctx.skills.set(SKILL_ID, s);
}

/** 阴丽华（大营）+ 男性友军（前锋）+ 女性友军（中军）+ 1 敌军 */
function setup(seed = 1) {
  const yin = heroUnit('h742', '大营', { commandSkillIds: [SKILL_ID] });
  const male = makeUnit(dummy('ally-male', '前锋', { gender: 'male' }));
  const female = makeUnit(dummy('ally-female', '中军', { gender: 'female' }));
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
  const ctx = makeCtx([yin, male, female], [foe], seed);
  forceRemoveSegment(ctx);
  return { yin, male, female, foe, ctx, allies: [yin, male, female] };
}

describe('辞后定朝（阴丽华 h742）', () => {
  it('装配：注册表定义（行动时分段两段）+ h742 挂槽 + 性别数据已注入 + 下架', () => {
    const hero = HERO_REGISTRY['h742'];
    expect(hero.name).toBe('阴丽华');
    expect(hero.gender).toBe('female'); // 官方 sex=女（web/data/hero_meta.json）
    expect(hero.mainSkillName).toBe('辞后定朝');
    expect(HERO_REGISTRY['h709'].gender).toBe('male');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.range).toBe(3);
    expect(s.output).toEqual([]);
    const segs = s.onActSegments ?? [];
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ startRound: 1, endRound: 3, rate: 0.9 });
    expect(segs[0].output[0]).toMatchObject({
      kind: 'remove_by_source_skill_type',
      target: 'self',
      skillTypes: ['command', 'active', 'pursuit'],
    });
    expect(segs[1]).toMatchObject({ startRound: 4, once: true });
    expect(segs[1].output).toHaveLength(4);
    expect(segs[1].output[0]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      requireGender: 'male',
      status: { type: 'attack_buff', amount: 40, strategyScaled: true, growthRate: 0 },
    });

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('第 ① 段（前 3 回合自身行动时）：移除自身受到的指挥/主动/追击来源效果（有害+有益），被动来源不动', () => {
    const { yin, foe, ctx } = setup();
    // 自身身上的四类状态：主动（有害 犹豫）、指挥（有益 攻击+）、追击（有益 防御+）、被动（有益 谋略+）
    inflictStatus(ctx, yin, { type: 'hesitation', duration: 999 }, 'active', 'mizhen');
    inflictStatus(ctx, yin, { type: 'attack_buff', amount: 30, duration: 999 }, 'command', 'dasahng');
    inflictStatus(ctx, yin, { type: 'defense_buff', amount: 30, duration: 999 }, 'pursuit', 'test_pursuit');
    inflictStatus(ctx, yin, { type: 'strategy_buff', amount: 30, duration: 999 }, 'passive', 'test_passive');
    expect(yin.statuses).toHaveLength(4);

    triggerRoundCommandOnAct(ctx, yin);
    // 指挥 / 主动 / 追击 三条被移除，被动那条保留
    const left = yin.statuses.map((s) => s.type);
    expect(left).toEqual(['strategy_buff']);
    expect(eventsOf(ctx, 'status_expired')).toHaveLength(3);
  });

  it('第 ① 段只在第 1~3 回合生效（第 4 回合起不再移除）', () => {
    const { yin, ctx } = setup();
    ctx.currentRound = 4;
    inflictStatus(ctx, yin, { type: 'hesitation', duration: 999 }, 'active', 'mizhen');
    triggerRoundCommandOnAct(ctx, yin);
    expect(yin.statuses.some((s) => s.type === 'hesitation')).toBe(true);
  });

  it('第 ② 段（第 4 回合起，整场一次）：男性 攻/防 +40、女性 谋/防 +40，且不重复叠加', () => {
    const { yin, male, female, ctx, allies } = setup(3);
    ctx.currentRound = 4;
    triggerRoundCommandOnAct(ctx, yin);

    const amounts = (u: UnitState, type: string) => {
      const st = u.statuses.find((s) => s.type === type);
      return st && 'amount' in st ? st.amount : 0;
    };
    expect(amounts(male, 'attack_buff')).toBe(40);
    expect(amounts(male, 'defense_buff')).toBe(40);
    expect(amounts(male, 'strategy_buff')).toBe(0); // 男性不加谋略
    expect(amounts(female, 'strategy_buff')).toBe(40);
    expect(amounts(female, 'defense_buff')).toBe(40);
    expect(amounts(female, 'attack_buff')).toBe(0); // 女性不加攻击
    expect(amounts(yin, 'strategy_buff')).toBe(40); // 阴丽华自身为女性，含在「友军全体」内

    // 第 5 回合再次行动：once → 不重复施加（否则同源累加成 80）
    ctx.currentRound = 5;
    triggerRoundCommandOnAct(ctx, yin);
    expect(amounts(male, 'attack_buff')).toBe(40);
    expect(allies.every((u) => u.statuses.filter((s) => s.type.endsWith('_buff')).length <= 2)).toBe(true);
  });

  it('第 4 回合前不施加性别光环', () => {
    const { yin, male, female, ctx } = setup(5);
    ctx.currentRound = 3;
    triggerRoundCommandOnAct(ctx, yin);
    expect(male.statuses.some((s) => s.type === 'attack_buff')).toBe(false);
    expect(female.statuses.some((s) => s.type === 'strategy_buff')).toBe(false);
  });

  it('整场跑通（runBattle）：第 4 回合起我方男性/女性各自获得对应属性', () => {
    const yin: General = {
      ...withSkills(level40(HERO_REGISTRY['h742']), { commandSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 41,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋', { gender: 'male' }), dummy('a-mid', '中军', { gender: 'female' }), yin],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const applied = report.events.filter(
      (e) => e.type === 'status_inflicted' && (e.statusType === 'attack_buff' || e.statusType === 'strategy_buff'),
    );
    expect(applied.length).toBeGreaterThan(0);
  });
});
