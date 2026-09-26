/**
 * 破阵强袭（SP徐庶·蜀骑 h534 主战法）：追击 A，官方有效距离栏「--」（追击战法不适用），官方发动几率栏 120%。
 * 满级：普通攻击后，对攻击目标再次发动策略攻击（伤害率 130.0%，受谋略属性影响），并有 50.0% 的几率使
 *   距离 3 以内随机敌军单体陷入暴走状态，持续 1 回合，此战法首次发动后，每次造成伤害时都使自身策略攻击
 *   的伤害提高 5.0%，可叠加 6 次。
 * 1 级：策略伤害 65.0% / 暴走 50.0% / 增伤 2.5%（同为可叠 6 次）。
 * 官方：scripts/skill_extra.json id 200785（追击 A / 距离 -- / 攻击目标 / 兵种骑；
 *   effect 标签 策略攻击伤害;策略攻击伤害提高;暴走）。来源 https://stzb.163.com/m/skilllist/200785.html
 * 口径（策略 A，照仓库既有先例；推定处见 skills.ts 注释）：
 *   ① 官方距离「--」→ 追击主段目标仍是普攻目标（`triggerPursuitSkill` 以 `[hitTarget]` 为整体目标），
 *      战法级 `range: 3` 只用于暴走段「距离 3 以内随机敌军单体」选池；
 *   ② 120% → `triggerRate: 1.2`（同虎步关右 / 定军绝战，判定走 moraleTriggerRate 封顶 100% 必定发动）；
 *   ③ 策略伤害 130% 受谋略但官方未给成长率 → 按基值不缩放 → 登记 OFFLINE_MAIN_SKILLS（武将下架）；
 *   ④ 暴走 `duration: 1` 按**行动中施加**通用口径（第 2 组：目标下一次行动期内生效；不加青丘媚祸
 *      的 `pendingNextAct`）；⑤ 增伤段为本战法 output 最后一段，每次发动即同源叠层 +5%、满 6 层封顶
 *      （段序保证首次那一击不吃加成）。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 * 注：选池 >3 的用例——双方都有存活单位时「最近敌军」距离上限是「我方位次 +1」（≤3），故不存在
 *   「敌军全部在距离 3 外」的构造；本文件用「距离 4 的大营敌军从不进选池」锁定 `range: 3` 约束。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'pozhen_qiangxi';
const HERO_ID = 'h534';

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

/** 克隆注册表定义并把暴走段的段级 chance 改成确定值（不动注册表，仅 ctx 内副本） */
function withRampageChance(chance: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'pursuit') throw new Error('破阵强袭应为追击战法');
  const seg = s.output.find(
    (o): o is Extract<SkillOutput, { kind: 'inflict_status' }> =>
      o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'rampage',
  );
  if (!seg) throw new Error('破阵强袭缺少暴走段');
  seg.chance = chance;
  return s;
}

describe('破阵强袭（SP徐庶 h534）', () => {
  it('装配：追击·range 3·120%·三段 output（策略 130 / 暴走 50% / 增伤 5%×6）· h534 追击槽 · 下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('SP徐庶');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('破阵强袭');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入追击槽（mainSkillSlot 依战法类型）
    expect(hero.pursuitSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('pursuit');
    if (s.type !== 'pursuit') return;
    // 官方距离「--」→ 追击主段不受 range 约束；战法级 range 3 供暴走段选池
    expect(s.range).toBe(3);
    // 官方发动几率栏 120%（>100%）→ 照虎步关右 / 定军绝战先例按 1.2 实装（判定封顶 100%）
    expect(s.triggerRate).toBe(1.2);
    expect(s.tags).toEqual(['damage', 'rampage', 'damage_boost']);
    expect(s.output).toHaveLength(3);
    // ① 追击主段：策略攻击 130%，受谋略（growthRate 缺 → 按基值）
    expect(s.output[0]).toEqual({ kind: 'strategy_damage', rate: 130, strategyScaled: true });
    // ② 暴走段：段级 50% + 距离 3 内随机敌军 + duration 1（无 pendingNextAct）
    expect(s.output[1]).toEqual({
      kind: 'inflict_status',
      chance: 0.5,
      targetSide: 'enemy',
      targetMode: 'random_single',
      status: { type: 'rampage', duration: 1 },
    });
    // ③ 增伤段：自身策略伤害 +5% 同源叠层，满 6 层封顶（stacks 计数字段 + maxStacks）
    expect(s.output[2]).toEqual({
      kind: 'inflict_status',
      target: 'self',
      status: {
        type: 'damage_boost',
        rate: 0.05,
        duration: 999,
        direction: 'caused',
        damageType: 'strategy',
        stack: true,
        stacks: 1,
        maxStacks: 6,
      },
    });

    // 策略伤害成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·追击主段：普攻后链路触发 → 1 条 strategy_damage（skillId=本战法 / 目标=普攻目标）', () => {
    const me = heroUnit(HERO_ID, '前锋', { pursuitSkillIds: [SKILL_ID] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
    const ctx = makeCtx([me], [foe], 7);

    actUnit(ctx, me);

    const casts = eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID);
    expect(casts).toHaveLength(1);
    expect(casts[0]?.unitId).toBe(HERO_ID);

    // 发动率 120% → moraleTriggerRate 封顶 100% 必定发动，baseRate 仍记官方 120
    // （本战法还有 1 条暴走段的段级 50% 判定，同为本战法 skillId）
    const allRolls = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
    const trig = allRolls.filter((e) => e.baseRate === 120);
    expect(trig).toHaveLength(1);
    expect(trig[0]?.success).toBe(true);
    expect(trig[0]?.rate).toBe(100);
    expect(allRolls.filter((e) => e.baseRate === 50)).toHaveLength(1); // 暴走段段级 50% 判定

    // 主段：只 1 条策略伤害，目标是本次普攻目标（唯一敌军 'foe'）
    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.damageType).toBe('strategy');
    expect(dmg[0]?.sourceId).toBe(HERO_ID);
    expect(dmg[0]?.targetId).toBe('foe');
  });

  it('机制·暴走段：距离 3 内命中并挂 rampage（duration 1）；距离 3 外敌军不进选池', () => {
    // ① 命中：SP徐庶前锋（我方位次 0）vs 敌军 前锋/中军/大营 → 距离 1/2/3 全在 range 3 内
    const me = heroUnit(HERO_ID, '前锋', { pursuitSkillIds: [SKILL_ID] });
    const e1 = makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000);
    const e2 = makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000);
    const e3 = makeUnit(dummy('foe-back', '大营'), 'enemy', 30000);
    const ctx = makeCtx([me], [e1, e2, e3], 5);
    ctx.skills.set(SKILL_ID, withRampageChance(1)); // 段级 chance 克隆为 1 求确定

    actUnit(ctx, me);

    const hits = eventsOf(ctx, 'status_inflicted').filter((e) => e.statusType === 'rampage');
    expect(hits).toHaveLength(1);
    const victim = [e1, e2, e3].find((u) => u.general.id === hits[0]?.unitId);
    expect(victim).toBeTruthy();
    const st = victim!.statuses.find((s) => s.type === 'rampage');
    expect(st).toBeTruthy();
    // 行动中施加（第 2 组）：duration 1 → remaining 1 = 目标下一次行动期内生效；非 pendingNextAct
    if (st?.type === 'rampage') {
      expect(st.remaining).toBe(1);
      expect(st.pendingNextAct).toBeUndefined();
    }

    // ② 选池受 range 3 约束：SP徐庶中军（我方前锋有友军占位 → 位次 1），敌军位次 0/1/2 → 距离 2/3/4；
    //    「大营」敌军距离 4 > range 3 → 多轮独立采样下从不被随机选中
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const hero = heroUnit(HERO_ID, '中军', { pursuitSkillIds: [SKILL_ID] });
      hero.general.attackRange = 5; // 构造：仅让普攻够得着（暴露选池范围），不改战法定义
      const ally = makeUnit(dummy('ally-front', '前锋'), 'my', 30000);
      const f1 = makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000);
      const f2 = makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000);
      const f3 = makeUnit(dummy('foe-back', '大营'), 'enemy', 30000);
      const c = makeCtx([ally, hero], [f1, f2, f3], seed);
      c.skills.set(SKILL_ID, withRampageChance(1));

      actUnit(c, hero);

      const rm = eventsOf(c, 'status_inflicted').filter((e) => e.statusType === 'rampage');
      expect(rm).toHaveLength(1);
      seen.add(rm[0]!.unitId);
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.has('foe-back')).toBe(false); // 距离 4 > range 3 → 从不进选池
    expect([...seen].every((id) => id === 'foe-front' || id === 'foe-mid')).toBe(true);
  });

  it('机制·增伤叠层：连续 3 次触发 rate 0.05→0.10→0.15（同源显式累加），6 层封顶（第 7 次仍 0.30）', () => {
    const me = heroUnit(HERO_ID, '前锋', { pursuitSkillIds: [SKILL_ID] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 300000);
    const ctx = makeCtx([me], [foe], 13);

    const rates: number[] = [];
    for (let i = 0; i < 7; i++) {
      actUnit(ctx, me);
      const b = me.statuses.find((s) => s.type === 'damage_boost');
      rates.push(b && b.type === 'damage_boost' ? b.rate : Number.NaN);
    }

    expect(rates[0]).toBeCloseTo(0.05, 6);
    expect(rates[1]).toBeCloseTo(0.1, 6);
    expect(rates[2]).toBeCloseTo(0.15, 6);
    expect(rates[5]).toBeCloseTo(0.3, 6);
    expect(rates[6]).toBeCloseTo(0.3, 6); // 已满 6 层：第 7 次不再加 rate

    // 同源显式叠层：只有 1 个 damage_boost 实例，带策略过滤 + 层数计数
    const boosts = me.statuses.filter((s) => s.type === 'damage_boost');
    expect(boosts).toHaveLength(1);
    const b = boosts[0];
    if (b?.type === 'damage_boost') {
      expect(b.direction).toBe('caused');
      expect(b.damageType).toBe('strategy');
      expect(b.stacks).toBe(6);
    }

    // 每次追击都实际打出策略伤害（伤害段先于增伤段 → 首次那一击不吃加成）
    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID && e.damageType === 'strategy');
    expect(dmg).toHaveLength(7);
  });

  it('整场跑通（runBattle·8 回合）：skill_cast / damage / status_inflicted（rampage 或 damage_boost）/ battle_end 齐全', () => {
    const xushu: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { pursuitSkillIds: [SKILL_ID] }),
      position: '前锋',
    };
    const report = runBattle({
      seed: 5,
      maxRounds: 8,
      myTeam: [xushu, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast' && e.skillId === SKILL_ID,
    );
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((e) => e.unitId === HERO_ID)).toBe(true);

    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === SKILL_ID && e.damageType === 'strategy',
    );
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.sourceId === HERO_ID)).toBe(true);

    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && (e.statusType === 'rampage' || e.statusType === 'damage_boost'),
    );
    expect(inflicted.length).toBeGreaterThan(0);
    // 增伤段每次发动必挂（本战法）→ 至少 1 条 damage_boost
    expect(inflicted.some((e) => e.statusType === 'damage_boost')).toBe(true);
    // 暴走段 50%：8 回合多次追击 → 至少命中一次
    expect(inflicted.some((e) => e.statusType === 'rampage')).toBe(true);
  });
});
