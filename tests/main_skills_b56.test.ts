/**
 * 心战为上（马谡·蜀骑 h799 主战法）：指挥 A，距离 5，我军全体。
 * 使我军全体每对敌军造成一次伤害时，伤害目标士气降低 5 点，我军全体累计可触发 9 次；
 * 使我军全体对敌军造成攻击伤害后，借此恢复相当于伤害值 50.0%（受谋略属性影响）的兵力。
 * 官方：scripts/skill_extra.json id 200275（指挥 A / 距离 5 / 我军全体 / 兵种弓步骑；1 级 25%）。
 * 入档：攻心恢复率 50%「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 马谡**下架**。
 * 引擎配套：`CommandSkill.healOnDamage` + `ctx.healOnDamageTriggers`（applyDamage 内对敌军造成实际伤害后：
 *   目标士气 −5（morale_boost 负值，整场、同战法累加、全队上限 9 次）+ 攻击伤害则按 50% 攻心恢复）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  applyDamage,
  effectiveMorale,
  inflictStatus,
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

const SKILL_ID = 'xinzhan_weishang';

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

/** 马谡（大营·带主战法）+ 1 友军（前锋）+ 3 敌军 */
function setup(seed = 1) {
  const masu = heroUnit('h799', '大营', { commandSkillIds: [SKILL_ID] });
  const ally = makeUnit(dummy('ally', '前锋', { attack: 200 }));
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([masu, ally], foes, seed);
  triggerCommandSkills(ctx, masu);
  return { masu, ally, foes, ctx, allies: [masu, ally] };
}

describe('心战为上（马谡 h799）', () => {
  it('装配：注册表定义（攻心 + 士气降低）+ h799 挂槽 + 受谋略成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h799'];
    expect(hero.name).toBe('马谡');
    expect(hero.mainSkillName).toBe('心战为上');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('all');
    expect(s.output).toEqual([]); // 效果全在伤害监听里
    expect(s.healOnDamage).toEqual({ moraleReduce: 5, maxTriggers: 9, healRate: 50 });

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('士气降低：我军每次对敌军造成伤害 → 目标士气 −5（可累加，全队累计 9 次封顶）', () => {
    const { ally, foes, ctx } = setup();
    const foe = foes[0];
    expect(effectiveMorale(foe)).toBe(100);

    applyDamage(ctx, foe, 500, ally, 'physical', 'skill');
    expect(effectiveMorale(foe)).toBe(95); // 100 − 5
    expect(ctx.healOnDamageTriggers?.get(`h799:${SKILL_ID}`)).toBe(1);

    // 同一战法重复施加 → 累加（−10）
    applyDamage(ctx, foe, 500, ally, 'physical', 'skill');
    expect(effectiveMorale(foe)).toBe(90);

    // 战报文案：士气降低而非「士气提高 -5」
    const details = eventsOf(ctx, 'status_inflicted').map((e) => e.detail);
    expect(details.some((d) => d?.includes('士气降低 5'))).toBe(true);
    expect(details.some((d) => d?.includes('-5'))).toBe(false);

    // 累计 9 次后不再降低（其他两次已用 2 次 → 再打 10 次）
    for (let i = 0; i < 10; i++) applyDamage(ctx, foe, 100, ally, 'strategy', 'skill');
    expect(ctx.healOnDamageTriggers?.get(`h799:${SKILL_ID}`)).toBe(9);
    expect(effectiveMorale(foe)).toBe(100 - 5 * 9); // 55

    // 超出上限：再打一次，计数与士气都不再变化（净士气锁在 55）
    applyDamage(ctx, foe, 100, ally, 'strategy', 'skill');
    expect(ctx.healOnDamageTriggers?.get(`h799:${SKILL_ID}`)).toBe(9);
    expect(effectiveMorale(foe)).toBe(55);
  });

  /**
   * 用户 2026-09-19 确认：心战为上·士气降低**显式可叠加**——同一战法重复施加 9 次 → 目标净士气 100 − 45 = 55；
   * 超过 9 次不再降低。对照组：同样数值的同类状态若**不带**显式叠层标记（其他战法）→ 刷新不叠加（恒 −5）。
   * （真实战法的刷新口径另有锁定：`repeat_inflict.test.ts` 列营守险四维 35→35 不翻倍 / 谋议宏图可叠加 8→16→24。）
   */
  it('显式可叠加（用户确认）：同一战法施加 9 次 → 目标净士气 55；对照同值未标 stack 的状态刷新不叠加', () => {
    // ① 真实路径：心战为上 同一战法重复施加 9 次 → 施加模板带 stack: true → 累加 −45
    const { ally, foes, ctx } = setup();
    const foe = foes[0];
    for (let i = 0; i < 9; i++) applyDamage(ctx, foe, 100, ally, 'strategy', 'skill');
    expect(ctx.healOnDamageTriggers?.get(`h799:${SKILL_ID}`)).toBe(9);
    expect(effectiveMorale(foe)).toBe(55); // 100 − 5×9 = 100 − 45
    // 第 10 次不再降低（全队累计上限 9 次，净士气锁在 55）
    applyDamage(ctx, foe, 100, ally, 'strategy', 'skill');
    expect(effectiveMorale(foe)).toBe(55);

    // ② 对照组：同数值 + 显式 stack: true → −45；**去掉 stack** → 刷新不叠加、恒 −5
    //    （证明 −45 来自「显式叠层标记」本身，而不是 morale_boost 的特判）
    const base = { type: 'morale_boost', amount: -5, duration: 999 } as const;
    const victim = makeUnit(dummy('victim', '前锋'));
    for (let i = 0; i < 9; i++) inflictStatus(ctx, victim, { ...base, stack: true }, 'command', SKILL_ID);
    expect(effectiveMorale(victim)).toBe(55); // 显式可叠加
    const control = makeUnit(dummy('control', '前锋'));
    for (let i = 0; i < 9; i++) inflictStatus(ctx, control, { ...base }, 'command', 'other_skill');
    expect(control.statuses.filter((s) => s.type === 'morale_boost')).toHaveLength(1); // 单实例
    expect(effectiveMorale(control)).toBe(95); // 刷新：恒 −5，绝不 −45
  });

  it('攻心：攻击伤害后按 50%（受谋略）恢复**造成伤害者**的兵力（策略伤害不恢复）', () => {
    const { ally, foes, ctx, allies } = setup(3);
    for (const u of allies) u.troops = 5000; // 先掉血，恢复可观测
    const foe = foes[0];
    const healBefore = ally.troops;

    applyDamage(ctx, foe, 1000, ally, 'physical', 'skill');
    const heals = eventsOf(ctx, 'heal');
    expect(heals).toHaveLength(1);
    expect(heals[0].targetId).toBe('ally');
    expect(heals[0].sourceId).toBe('h799'); // 归属施法者（战报统计口径）
    expect(heals[0].skillId).toBe(SKILL_ID);
    // 恢复量 ≈ 1000 × 50%（谋略 80 基值，成长率未确认 → 不缩放）
    expect(heals[0].amount).toBe(500);
    expect(ally.troops).toBe(healBefore + 500);

    // 策略伤害：只有士气降低，不触发攻心
    applyDamage(ctx, foe, 1000, ally, 'strategy', 'skill');
    expect(eventsOf(ctx, 'heal')).toHaveLength(1);
    expect(effectiveMorale(foe)).toBe(90); // 两次伤害各 −5
  });

  it('只算对敌军的伤害：友军（暴走）互相伤害不触发攻心/士气降低', () => {
    const { ally, ctx, allies } = setup(5);
    for (const u of allies) u.troops = 5000;
    const friend = allies[0];
    const other = allies[1];

    applyDamage(ctx, other, 1000, friend, 'physical', 'skill');
    expect(eventsOf(ctx, 'heal')).toHaveLength(0);
    expect(effectiveMorale(other)).toBe(100);
    expect(ctx.healOnDamageTriggers?.get(`h799:${SKILL_ID}`) ?? 0).toBe(0);
  });

  it('士气正负共存：士气提高（谋议宏图 +10）与士气降低（心战为上 −5）各自生效、净士气相加', () => {
    const { ally, foes, ctx } = setup(7);
    const target = foes[0];

    applyDamage(ctx, target, 100, ally, 'physical', 'skill'); // 心战为上：−5
    // 另一指挥战法施加 +10（同类型不同战法、正负相反 → 不冲突、各自共存）
    inflictStatus(ctx, target, { type: 'morale_boost', amount: 10, duration: 999 }, 'command', 'mouyi_hongtu');
    expect(target.statuses.filter((s) => s.type === 'morale_boost')).toHaveLength(2); // 一 + 一 −
    expect(effectiveMorale(target)).toBe(105); // 100 − 5 + 10
  });

  it('整场跑通（runBattle）：敌军士气被压低、我军出现攻心恢复事件', () => {
    const masu: General = {
      ...withSkills(level40(HERO_REGISTRY['h799']), { commandSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 29,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋', { attack: 200 }), dummy('a-mid', '中军'), masu],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    const heals = report.events.filter((e) => e.type === 'heal' && e.skillId === SKILL_ID);
    expect(heals.length).toBeGreaterThan(0);
    const moraleDrop = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'morale_boost' && e.detail?.includes('士气降低'),
    );
    expect(moraleDrop.length).toBeGreaterThan(0);
    expect(moraleDrop.length).toBeLessThanOrEqual(9); // 全队累计上限
  });
});
