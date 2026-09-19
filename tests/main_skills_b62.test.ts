/**
 * 蛮王御众（XP孟获·群步 h815 主战法）：被动 A，距离 5，目标自己。
 * 令自身受到的所有伤害降低 30.0%（受防御属性影响），前 2 回合援护友军全体；自身每受到 5 次伤害，
 * 则使友军攻击最高单体有 60.0% 几率对敌军群体发动一次攻击（伤害率 120.0%）。
 * 官方：scripts/skill_extra.json id 200297（被动 A / 距离 5 / 自己 / 兵种弓步骑；
 *   1 级 减伤 15% / 攻击 30%・60%）。来源 https://stzb.163.com/m/skilllist/200297.html
 * 入档：**下架** —— 减伤段「受防御属性影响」官方未给成长系数（按基值不缩放）→ 登记 OFFLINE_MAIN_SKILLS。
 * 引擎配套：`damage_reduce.defenseScaled`（受防御缩放，growthRate 缺省时用基值）+ 既有 cover（援护，官方口径
 *   「为其抵挡普通攻击」，与疮痍累身同）+ 新机制 `PassiveSkill.hurtEvery`（每受 N 次伤害触发一段 output）。
 * 未实现：官方兵种分支（蛮兵/藤甲兵/象兵）—— 引擎 TroopType 仅 cavalry/infantry/archer，特殊兵种未建模。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, applyDamage, tickStatuses, triggerPassiveSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'manwang_yuzhong';

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

/** 把「每 5 次受击」的代打几率拉满（只改 ctx 内副本，不动注册表）——机制断言不依赖 RNG 点数 */
function forceCertain(ctx: CombatContext): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'passive' || !s.hurtEvery) return;
  for (const out of s.hurtEvery.output) {
    if (out.kind === 'physical_damage') out.chance = 1;
  }
  ctx.skills.set(SKILL_ID, s);
}

/** 孟获（被动注册） + 敌对出手者（测试主动战法：物理 200%、100% 发动） */
function testActiveSkill(): Skill {
  return {
    id: 'test_active',
    name: '测试主动',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 200 }],
  };
}

/** 敌方主动战法打孟获一次，返回该次伤害事件；withReduce 时先走战斗开始被动（挂 30% 减伤） */
function runIncoming(withReduce: boolean) {
  const meng = heroUnit('h815', '前锋', { passiveSkillIds: [SKILL_ID] });
  const foe = makeUnit(dummy('foe', '前锋', { activeSkillIds: ['test_active'] }), 'enemy');
  const ctx = makeCtx([meng], [foe], 11);
  ctx.skills.set('test_active', testActiveSkill());
  if (withReduce) triggerPassiveSkills(ctx, meng, 'battle_start');
  ctx.events = [];
  actUnit(ctx, foe);
  const dmg = eventsOf(ctx, 'damage').find((e) => e.skillId === 'test_active');
  return { ctx, meng, dmg };
}

describe('蛮王御众（XP孟获 h815）', () => {
  it('装配：注册表定义（被动·距离5·自己 + 30% 减伤 / 援护 2 回合 / 每 5 次受击代打）+ h815 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h815'];
    expect(hero.name).toBe('XP孟获');
    expect(hero.mainSkillName).toBe('蛮王御众');
    expect(HERO_RECORDS['h815'].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(s.tags).toEqual(['damage_reduce', 'cover', 'damage']);

    // ① 全伤害降低 30%（受防御，成长率未确认 → 基值）
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'damage_reduce', rate: 0.3, duration: 999, defenseScaled: true },
    });
    // ② 前 2 回合援护友军全体（cover 挂自身 = 自己代为承受普攻）
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'cover', duration: 2 },
    });
    // ③ 自身每受到 5 次伤害：友军攻击最高单体 60% 几率对敌军群体（2 目标）攻击 120%
    expect(s.hurtEvery).toEqual({
      hits: 5,
      output: [
        {
          kind: 'physical_damage',
          attacker: 'highest_attack_ally',
          rate: 120,
          targetMode: 'group',
          groupCount: 2,
          chance: 0.6,
        },
      ],
    });

    // 减伤成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('数值·减伤段：战斗开始挂上 30% 全伤害减伤（duration 999），实际把来伤压到 70%（兵力基础不减）', () => {
    const plain = runIncoming(false);
    const reduced = runIncoming(true);

    // 战斗开始被动：自身挂 damage_reduce 30%
    const status = reduced.meng.statuses.find((s) => s.type === 'damage_reduce') as
      | { rate: number; remaining: number }
      | undefined;
    expect(status).toMatchObject({ rate: 0.3, remaining: 999 });
    // 援护（cover）同时挂上，持续 2 回合
    expect(reduced.meng.statuses.some((s) => s.type === 'cover')).toBe(true);

    // 减伤进入结算（战报增减伤归因），且同种子两跑只差这一条状态：
    // calcDamage 的 troopBase 不乘 mult，故 reduced = troopBase + (plain − troopBase) × 0.7
    expect(reduced.dmg?.modifiers?.reduce.map((m) => m.skillId)).toContain(SKILL_ID);
    expect(plain.dmg?.modifiers?.reduce ?? []).toHaveLength(0);
    const troopBase = plain.dmg?.breakdown.troopBase ?? 0;
    const expected = Math.round(troopBase + ((plain.dmg?.damage ?? 0) - troopBase) * 0.7);
    expect(Math.abs((reduced.dmg?.damage ?? 0) - expected)).toBeLessThanOrEqual(1);
    expect(reduced.dmg!.damage).toBeLessThan(plain.dmg!.damage);
  });

  it('机制·援护：前 2 回合友军受到的普攻改由孟获承受（战法伤害不转移），2 回合末到期移除', () => {
    const ally = makeUnit(dummy('ally-front', '前锋'));
    const meng = heroUnit('h815', '中军', { passiveSkillIds: [SKILL_ID] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([ally, meng], [foe], 3);
    ctx.currentRound = 0; // 准备阶段：appliedRound=0 → 由回合末 tickStatuses 递减到期
    triggerPassiveSkills(ctx, meng, 'battle_start');

    const allyBefore = ally.troops;
    const mengBefore = meng.troops;
    // 普攻 → 转移到持 cover 的孟获
    applyDamage(ctx, ally, 500, foe, 'physical', 'basic');
    expect(eventsOf(ctx, 'cover')).toHaveLength(1);
    expect(ally.troops).toBe(allyBefore);
    expect(meng.troops).toBe(mengBefore - 500);

    // 战法伤害（damageSource:'skill'）不转移，仍打在友军身上
    const allyAfter = ally.troops;
    applyDamage(ctx, ally, 300, foe, 'physical', 'skill');
    expect(ally.troops).toBe(allyAfter - 300);

    // 前 2 回合：两次回合末递减后 cover 到期移除
    tickStatuses(ctx, [ally, meng]);
    expect(meng.statuses.some((s) => s.type === 'cover')).toBe(true);
    tickStatuses(ctx, [ally, meng]);
    expect(meng.statuses.some((s) => s.type === 'cover')).toBe(false);
    expect(
      eventsOf(ctx, 'status_expired').some((e) => e.statusType === 'cover' && e.unitId === meng.general.id),
    ).toBe(true);
  });

  it('机制·每受 5 次伤害：4 次不触发、第 5 次由攻击最高友军代打敌军群体 2 目标（杀伤归孟获），第 10 次再触发', () => {
    const strong = makeUnit(dummy('ally-strong', '前锋', { attack: 300 }));
    const meng = heroUnit('h815', '大营', { passiveSkillIds: [SKILL_ID] });
    const foes = [
      makeUnit(dummy('foe-front', '前锋'), 'enemy'),
      makeUnit(dummy('foe-mid', '中军'), 'enemy'),
      makeUnit(dummy('foe-back', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([strong, meng], foes, 7);
    forceCertain(ctx);
    triggerPassiveSkills(ctx, meng, 'battle_start');
    ctx.events = [];

    const skillDamage = () => eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    for (let i = 0; i < 4; i++) applyDamage(ctx, meng, 100, foes[0], 'physical', 'skill');
    expect(skillDamage()).toHaveLength(0); // 未满 5 次不触发
    expect(ctx.hurtEveryCounters?.get(`${meng.general.id}:${SKILL_ID}`)).toBe(4);

    // 第 5 次：触发「友军攻击最高单体对敌军群体发动一次攻击」
    applyDamage(ctx, meng, 100, foes[0], 'physical', 'skill');
    const hits = skillDamage();
    expect(hits).toHaveLength(2); // 敌军群体 2 目标
    expect(new Set(hits.map((e) => e.targetId)).size).toBe(2);
    for (const h of hits) {
      expect(h.sourceId).toBe('ally-strong'); // 借攻击最高友军出手
      expect(h.creditToId).toBe(meng.general.id); // 杀伤统计归属战法携带者（孟获）
      expect(h.damage).toBeGreaterThan(0);
    }
    expect(
      eventsOf(ctx, 'skill_exec').some(
        (e) => e.unitId === meng.general.id && e.detail.includes('蛮王御众'),
      ),
    ).toBe(true);

    // 再受 5 次 → 第 10 次再次触发
    for (let i = 0; i < 5; i++) applyDamage(ctx, meng, 100, foes[0], 'physical', 'skill');
    expect(skillDamage()).toHaveLength(4);
    expect(ctx.hurtEveryCounters?.get(`${meng.general.id}:${SKILL_ID}`)).toBe(10);
  });

  it('整场跑通（runBattle）：8 回合内减伤/援护在准备阶段生效，受击满 5 次后代打事件齐全', () => {
    const hero: General = {
      ...withSkills(level40(HERO_REGISTRY['h815']), { passiveSkillIds: [SKILL_ID] }),
      position: '前锋',
      maxTroops: 30000, // 给「每受 5 次伤害」留出足够触发窗口（援护代受让孟获承伤最重）
    };
    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      // 中军攻击 300 = 我军攻击最高单体（代打者），杀伤统计应归属战法携带者孟获
      myTeam: [hero, dummy('a-mid', '中军', { attack: 300 }), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    // 准备阶段：减伤 + 援护（cover）事件
    const prepStatuses = report.events.filter((e) => e.type === 'status_inflicted');
    expect(
      prepStatuses.some((e) => e.statusType === 'damage_reduce' && e.unitId === 'h815'),
    ).toBe(true);
    expect(prepStatuses.some((e) => e.statusType === 'cover' && e.unitId === 'h815')).toBe(true);
    expect(report.events.some((e) => e.type === 'cover')).toBe(true); // 援护代受发生过
    // 受击满 5 次 → 触发「友军攻击最高单体代打」（60% 士气修正判定；本种子两次均命中）
    const exec = report.events.filter(
      (e) => e.type === 'skill_exec' && e.detail.includes('蛮王御众'),
    );
    expect(exec.length).toBeGreaterThanOrEqual(1);
    const trig = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === SKILL_ID && e.unitId === 'h815',
    );
    expect(trig.length).toBe(exec.length);
    expect(trig.every((e) => e.baseRate === 60 && e.success)).toBe(true);
    const skillDmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === SKILL_ID,
    );
    expect(skillDmg.length).toBeGreaterThanOrEqual(2);
    expect(skillDmg.every((e) => e.sourceId === 'a-mid' && e.creditToId === 'h815')).toBe(true);
  });
});
