/**
 * 胡笳离愁（SP蔡文姬·汉步 h102011 主战法）：主动 B，距离 2，发动率 40%，目标我军群体（有效距离内 2 个目标）。
 * 恢复我军群体较多兵力（恢复率 157.0%，受谋略属性影响），并使其进入休整状态，每回合再度恢复大量兵力
 * （恢复率 206.0%，受谋略属性影响），持续 1 回合。
 * 官方：scripts/skill_extra.json id 200004（主动 B / 距离 2 / 我军群体（有效距离内2个目标）/ 兵种步骑；
 *   1 级 恢复 78.5% / 休整 103.0%）。来源 https://stzb.163.com/m/skilllist/200004.html
 * 入档：**下架** —— 恢复 / 休整两段「受谋略属性影响」而官方未给成长系数（按基值不缩放）
 *   → 登记 OFFLINE_MAIN_SKILLS（上架池保持 77）。
 * 引擎配套（全部既有）：`heal.attachStatus`（15a54f1 知人待士新增，同一批目标续挂休整，不重选池）+
 *   `rest` 状态（挂上时冻结每次恢复值，携带者行动时跳恢复、remaining −1）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { calcHealAmount, roundRate, scaledValue } from '../src/engine/formulas';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'hujia_lichou';

/** 恢复率 157% 与休整 206% 均按官方基值（成长率 0 = 不缩放） */
const HEAL_RATE = 157;
const REST_RATE = 206;

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
  // level40 → 兵力 9000（不是 dummy 的 30000）；recoverTroops 受兵力缺口截断
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

/**
 * level40 武将（兵力上限 9000）并可指定当前兵力（缺省满兵）——
 * `recoverTroops` 受兵力缺口截断，施法者满兵时不会产生 heal 事件。
 */
function heroUnitAt(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  troops?: number,
): UnitState {
  const unit = makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
  if (troops != null) unit.troops = troops;
  return unit;
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function heals(ctx: CombatContext) {
  return eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID);
}

/** 携带本战法休整状态的单位（休整挂在同一批被恢复的友军上） */
function resting(units: UnitState[]): UnitState[] {
  return units.filter((u) => u.statuses.some((s) => s.type === 'rest' && s.sourceSkillId === SKILL_ID));
}

/**
 * 本战法**立即恢复**段产生的 heal 事件（每次施放 = 我军群体 2 目标 → 2 条）。
 * 标记＝该目标最早一次「挂上本战法休整」的事件序号晚于这条 heal（同一目标事件序为 heal → rest）。
 */
function immediateHeals(ctx: CombatContext): Extract<BattleEvent, { type: 'heal' }>[] {
  const restAt = new Map<string, number>();
  ctx.events.forEach((e, i) => {
    if (e.type === 'status_inflicted' && e.statusType === 'rest' && !restAt.has(e.unitId)) {
      restAt.set(e.unitId, i);
    }
  });
  return ctx.events.filter(
    (e, i): e is Extract<BattleEvent, { type: 'heal' }> =>
      e.type === 'heal' && e.skillId === SKILL_ID && (restAt.get(e.targetId) ?? Infinity) > i,
  );
}

/** 把发动率拉满（只改 ctx 内副本，不动注册表）——机制断言不依赖 RNG 点数 */
function forceCast(ctx: CombatContext): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'active') s.triggerRate = 1;
  ctx.skills.set(SKILL_ID, s);
}

/**
 * 蔡文姬（中军·9000 兵上限 / 当前 7000）+ 2 名受损友军（前锋/大营，dummy 上限 30000）。
 * 三名友军都有兵力缺口 → group 随机选中的 2 名休整携带者都能产生 heal 事件（不依赖选靶结果）。
 */
function setup(seed = 1) {
  const caster = heroUnitAt('h102011', '中军', { activeSkillIds: [SKILL_ID] }, 7000);
  const allyFront = makeUnit(dummy('ally-front', '前锋'), 'my', 5000);
  const allyBack = makeUnit(dummy('ally-back', '大营'), 'my', 6000);
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([allyFront, caster, allyBack], foes, seed);
  forceCast(ctx);
  return { ctx, caster, allies: [allyFront, caster, allyBack], allyFront, allyBack, foes };
}

describe('胡笳离愁（SP蔡文姬 h102011）', () => {
  it('装配：注册表定义（主动·40%·距离2·我军群体2 / heal 157 + rest 206 strategyScaled / growthRate 0）+ h102011 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h102011'];
    expect(hero.name).toBe('SP蔡文姬');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('infantry');
    expect(hero.attackRange).toBe(2);
    expect(hero.mainSkillName).toBe('胡笳离愁');
    expect(HERO_RECORDS['h102011'].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(2);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['heal', 'rest']);

    // 单段 heal：157% 受谋略（成长率未确认 → 0 = 基值不缩放）+ 同一批目标续挂休整 206% / duration 1
    expect(s.output).toHaveLength(1);
    expect(s.output[0]).toMatchObject({
      kind: 'heal',
      rate: HEAL_RATE,
      strategyScaled: true,
      growthRate: 0,
      targetSide: 'ally',
      targetMode: 'group',
      groupCount: 2,
      attachStatus: {
        type: 'rest',
        rate: REST_RATE,
        growthRate: 0,
        strategyScaled: true,
        duration: 1,
      },
    });

    // 两段受谋略成长率未确认 → 下架（等待 derive_growth_rate 反解；上架池保持 77）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('机制·同一批目标：释放后 2 条 heal（我军群体 2，归属蔡文姬）+ 被恢复的 2 名友军各带休整，第 3 名不沾', () => {
    const { ctx, caster, allies } = setup(1);
    const casterTroops = caster.troops; // 结算前快照（heal 会改变施法者兵力）
    const before = new Map(allies.map((u) => [u.general.id, u.troops]));

    actUnit(ctx, caster);

    // 释放 → 2 条 heal（我军群体 2 目标），均归属施法者蔡文姬
    const imm = immediateHeals(ctx);
    expect(imm).toHaveLength(2);
    expect(new Set(imm.map((e) => e.targetId)).size).toBe(2);
    let running = casterTroops;
    for (const e of imm) {
      expect(e.sourceId).toBe(caster.general.id);
      // 立即恢复逐目标结算：金额按该目标结算**当时**的施法者兵力
      expect(e.amount).toBe(calcHealAmount(running, HEAL_RATE));
      if (e.targetId === caster.general.id) running += e.amount;
    }
    // 命中施法者本人时，其增量恰好是那一条 heal 的金额（用总量核对，不依赖逐目标顺序）
    expect(caster.troops - casterTroops).toBe(
      imm.filter((e) => e.targetId === caster.general.id).reduce((n, e) => n + e.amount, 0),
    );
    expect(imm[0].amount).toBe(314); // 7000 兵力 × 157%：floor(round(300×7000/10500) × 1.57) = floor(200 × 1.57)

    // 休整落在**与恢复同一批**的 2 名友军上（不重选池），每次恢复值按挂上时兵力/谋略冻结、duration 1
    const resters = resting(allies);
    expect(resters).toHaveLength(2);
    expect(resters.map((u) => u.general.id).sort()).toEqual(imm.map((e) => e.targetId).sort());
    for (const u of resters) {
      expect(u.statuses.filter((s) => s.type === 'rest')).toHaveLength(1);
      const restStatus = u.statuses.find((s) => s.type === 'rest') as
        | { healAmount: number; remaining: number; sourceSkillId: string; sourceUnitId: string }
        | undefined;
      expect(restStatus).toMatchObject({
        remaining: 1,
        sourceSkillId: SKILL_ID,
        sourceUnitId: caster.general.id,
      });
      // 每次恢复值 = 该目标 heal 结算后、挂休整时的施法者兵力 × 206%（逐目标结算 → 施法者自身
      // 若先被奶，后续目标的冻结值略高；不写死单一数值，用区间锁定基值不缩放口径）
      expect(restStatus!.healAmount).toBeGreaterThanOrEqual(412); // 7000 兵 × 206% = floor(200 × 2.06)
      expect(restStatus!.healAmount).toBeLessThanOrEqual(
        calcHealAmount(caster.general.maxTroops, REST_RATE),
      );
      // 恢复只受兵力缺口截断 → 用相对起始值的差值断言（差值 = 该目标收到的立即恢复量）
      const healOf = imm
        .filter((e) => e.targetId === u.general.id)
        .reduce((n, e) => n + e.amount, 0);
      expect(u.troops - before.get(u.general.id)!).toBe(healOf);
    }
    // 未被选中的第 3 名友军既无恢复也无休整
    const untouched = allies.filter((u) => !resters.includes(u));
    expect(untouched).toHaveLength(1);
    expect(untouched[0].statuses).toHaveLength(0);
    expect(untouched[0].troops).toBe(before.get(untouched[0].general.id));
  });

  it('机制·休整在携带者行动时再跳恢复：按挂上时冻结值再跳一次，触发后该状态移除', () => {
    const { ctx, caster, allies } = setup(1);
    actUnit(ctx, caster);
    expect(immediateHeals(ctx)).toHaveLength(2);
    expect(heals(ctx)).toHaveLength(2); // 首次释放：2 条立即恢复
    const resters = resting(allies);
    expect(resters).toHaveLength(2);

    // 取挂上时冻结的每次恢复值（先快照：携带者行动可能再次发动本战法并刷新同源状态）
    const restAmounts = new Map(
      resters.map((u) => [
        u.general.id,
        (u.statuses.find((s) => s.type === 'rest') as { healAmount: number }).healAmount,
      ]),
    );

    for (const u of resters) {
      const before = u.troops;
      const healsBefore = heals(ctx).length;
      // 回合行动时 tickRests：按挂上时冻结值恢复一次，并把该状态 remaining 递减到 0 移除
      actUnit(ctx, u);
      // 本次行动新增的 heal 中，该单位的「休整跳恢复」金额恰为冻结值（携带者可能同时再次发动本战法）
      const newHeals = heals(ctx).slice(healsBefore).filter((e) => e.targetId === u.general.id);
      const restTickHeals = newHeals.filter((e) => e.amount === restAmounts.get(u.general.id));
      expect(restTickHeals).toHaveLength(1);
      expect(u.troops - before).toBe(newHeals.reduce((n, e) => n + e.amount, 0));
    }

    // 休整段各产生 1 条 heal（金额 = 挂上时冻结值）
    const restHeals = heals(ctx).filter((e) => e.amount === restAmounts.get(e.targetId));
    expect(restHeals).toHaveLength(2);
    expect(restHeals.map((e) => e.targetId).sort()).toEqual(resters.map((u) => u.general.id).sort());
    // duration 1 → 首次触发后该实例即移除（若携带者行动中再次发动本战法，则挂上的是全新实例）
    for (const u of resters) {
      const rests = u.statuses.filter((s) => s.type === 'rest');
      expect(rests.length).toBeLessThanOrEqual(1);
      if (rests.length === 1) expect(rests[0].remaining).toBe(1);
    }
  });

  it('数值·成长未确认：休整 healAmount 按基值 206%（growthRate 0 时 scaledValue 不变），其余数值仍与基值一致', () => {
    // 纯函数：growthRate 0 → 任意谋略下恢复率都不变（受谋略标记在、按基值不缩放）
    expect(scaledValue(REST_RATE, 0, 200)).toBe(REST_RATE);
    expect(roundRate(scaledValue(REST_RATE, 0, 200))).toBe(REST_RATE);
    expect(scaledValue(HEAL_RATE, 0, 150)).toBe(HEAL_RATE);

    const target = makeUnit(dummy('ally-low', '前锋'), 'my', 4000);
    // 施法者须可解析（源单位在队伍里）：休整恢复值按**施法者挂上时兵力**冻结
    const source = makeUnit(dummy('caster', '中军'), 'my', 9000);
    const ctx = makeCtx([source, target], [], 1);
    // 与注册表口径一致：growthRate 显式给 0（必填字段；注册表里两段也都是 0 = 基值不缩放）
    inflictStatus(
      ctx,
      target,
      { type: 'rest', rate: REST_RATE, growthRate: 0, duration: 1, strategyScaled: true },
      'active',
      SKILL_ID,
      'caster',
    );
    const rest = target.statuses.find((s) => s.type === 'rest');
    expect(rest).toMatchObject({ remaining: 1, healAmount: calcHealAmount(9000, REST_RATE) });
    // 9000 兵力 × 206% = floor(216 × 2.06) = 444；恢复 157% = 339
    expect(rest?.type === 'rest' && rest.healAmount).toBe(444);
    expect(calcHealAmount(9000, HEAL_RATE)).toBe(339);
  });

  it('整场跑通（runBattle·8 回合）：skill_cast / heal 事件齐全，主动判定 baseRate 40', () => {
    const caster: General = {
      ...withSkills(level40(HERO_REGISTRY['h102011']), { activeSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), caster, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    // 主动战法释放（40% × 士气 100 = 40% 判定）
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillId === SKILL_ID)).toBe(true);
    const trig = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === SKILL_ID,
    );
    expect(trig.length).toBeGreaterThan(0);
    expect(trig.every((e) => e.baseRate === 40 && e.unitId === 'h102011')).toBe(true);
    expect(trig.every((e) => e.rate === 40)).toBe(true); // 士气 100：生效几率 = 基础率

    // 恢复事件（主动恢复 / 休整跳恢复）在 8 回合内出现；均归属蔡文姬、打友军
    const h = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === SKILL_ID,
    );
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => e.sourceId === 'h102011')).toBe(true);
    expect(h.every((e) => e.targetId !== 'e-front' && e.targetId !== 'e-mid' && e.targetId !== 'e-back')).toBe(
      true,
    );
    // 休整状态确实挂上过（同一批目标续挂）
    expect(
      report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'rest'),
    ).toBe(true);
  });
});
