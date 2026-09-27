/**
 * 五兵之烈（魏·曹彰 h683 主战法）：主动 S·距离 5·发动 35%·敌军群体（有效距离内 2 个目标）。
 * 满级：对敌军群体发动一次猛烈的攻击（伤害率 300.0%）。当授予曹彰不同种类宝物时，将额外获得以下效果：
 *   剑：先移除目标的有益效果再发动攻击；刀：使自身造成的攻击伤害提升 15.0%，可叠加并持续直至战斗结束；
 *   长兵：使目标攻击距离 -1，持续 2 回合；弓：有 60.0% 几率该战法目标数 +1；
 *   其余宝物或未授予：使目标防御属性降低 36.0%（受攻击属性影响），持续 2 回合。
 * 官方：scripts/skill_extra.json id 200957；来源 https://stzb.163.com/m/skilllist/200957.html
 * 入档：**上架** —— 默认段「防御 −36 受攻击属性影响」的成长率由用户 2026-09-27 实测点锁定
 *   （攻击 200.6 → 减防 49.6% ⇒ `growthRate: 0.1125`/点，百分比按 0.1% 粒度显示），四分支为官方原文 → 可玩。
 * 引擎配套（本批新增，见 `src/engine/types.ts`）：
 *   ① `OutputCondition.casterTreasureKinds` —— 段级宝物分支条件（未佩戴宝物 = '其他'）；
 *   ② `BaseSkill.bonusGroupTargets` —— 选目标阶段的「目标数 +1」（60% 士气修正 + skill_trigger 事件）。
 * 宝物口径：宝物效果与任何来源都不冲突、准备阶段挂载（`treasureId` 走 `src/data/treasures.ts`）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { inflictStatus, triggerActiveSkill, type CombatContext } from '../src/engine/action';
import { scaledValue } from '../src/engine/formulas';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'wubing_zhilie';
const HERO_ID = 'h683';
/** 官方战法等级 1 级伤害率 150%、满级 300%（引擎按满级录入） */
const FULL_RATE = 300;

/** 宝物 id（按种类）：剑 1042 旌阳万仞 / 刀 1027 别鸣 / 长兵 1009 狰角枪 / 弓 1003 彤素 / 其他 1024 戚 / 扇 1054 仁风 */
const SWORD = 1042;
const BLADE = 1027;
const SPEAR = 1009;
const BOW = 1003;
const OTHER = 1024;
const FAN = 1054;

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

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 五兵之烈段级状态（只认本战法来源） */
const statusOf = <T extends Status['type']>(u: UnitState, type: T) =>
  u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID) as
    | Extract<Status, { type: T }>
    | undefined;

/** 曹彰（40 级 + 兵力 9000，宝物由 `treasure` 指定；freeAttack 用于对齐实测点的攻击值） */
function caozhang(treasureId?: number, freeAttack = 0): UnitState {
  const base = level40(HERO_REGISTRY[HERO_ID], { attack: freeAttack });
  const g: General = {
    ...withSkills(base, {}),
    position: '中军',
    ...(treasureId == null ? {} : { treasure: { treasureId, level: 10 } }),
  };
  return makeUnit(g);
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

function setup(treasureId?: number, seed = 1, freeAttack = 0) {
  const cz = caozhang(treasureId, freeAttack);
  const foes = enemyTrio();
  const ctx = makeCtx([cz], foes, seed);
  return { ctx, cz, foes };
}

const cast = (ctx: CombatContext, cz: UnitState, foes: UnitState[]) =>
  triggerActiveSkill(ctx, cz, SKILL_REGISTRY[SKILL_ID], foes, ctx.myTeam, foes);

/** 本次战法打出的伤害目标（damage 事件的 targetId） */
const damageTargetIds = (ctx: CombatContext) =>
  new Set(eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID).map((e) => e.targetId));

describe('五兵之烈（曹彰 h683）', () => {
  it('装配：主动·距离 5·35%·敌军群体 2 目标·挂槽 main_skill_id·成长率锁定后上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('曹彰');
    expect(hero.faction).toBe('魏');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('五兵之烈');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.35);
    expect(s.targetMode).toBe('group');
    expect(s.tags).toEqual(['damage', 'debuff_defense', 'damage_boost']);
    // 【弓】+1 目标：条件 = 佩戴弓类宝物
    expect(s.bonusGroupTargets).toEqual({ rate: 0.6, condition: { casterTreasureKinds: ['弓'] } });

    // 五分支结构：剑（移除+攻击）/ 刀 / 长兵 / 默认 / 主体攻击（unless 剑）
    const kinds = (s.output as { kind: string }[]).map((o) => o.kind);
    expect(kinds).toEqual(['conditional', 'conditional', 'conditional', 'conditional', 'conditional']);
    const main = s.output[4] as { outputs: { kind: string; rate?: number }[] };
    expect(main.outputs[0]).toEqual({ kind: 'physical_damage', rate: FULL_RATE });

    // 默认段成长率已由用户实测点锁定（攻击 200.6 → 49.6% ⇒ 0.1125/点）→ **上架**
    expect(isHeroListed(HERO_RECORDS[HERO_ID])).toBe(true);
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
  });

  it('剑分支：先移除目标有益效果，再发动 300% 攻击（减益不受影响）', () => {
    const { ctx, cz, foes } = setup(SWORD, 7);
    const foe = foes[0];
    // 目标身上的增益（主动来源，可被移除）+ 减益（不应被移除）
    inflictStatus(ctx, foe, { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused' }, 'active', 'test_buff');
    inflictStatus(ctx, foe, { type: 'attack_buff', amount: 50, duration: 999 }, 'active', 'test_buff');
    inflictStatus(ctx, foe, { type: 'defense_buff', amount: -20, duration: 999 }, 'active', 'test_debuff');

    cast(ctx, cz, foes);

    const removed = eventsOf(ctx, 'status_changed').filter((e) => e.unitId === foe.general.id && e.detail?.includes('移除'));
    expect(removed.length).toBeGreaterThan(0);
    expect(removed[0].detail).toContain('移除 2 个有益效果');
    expect(foe.statuses.some((s) => s.sourceSkillId === 'test_buff')).toBe(false);
    // 减益保留
    expect(foe.statuses.some((s) => s.sourceSkillId === 'test_debuff')).toBe(true);

    // 剑分支的攻击段：伤害打出（官方满级 300% 攻击；引擎不把伤害率写进事件，故按伤害构成断言）
    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      expect(d.damage).toBeGreaterThan(0);
      expect(d.breakdown.main).toBeGreaterThan(0);
    }
    // 剑分支不追加默认段的防御降低
    expect(foe.statuses.some((s) => s.type === 'defense_buff' && s.sourceSkillId === SKILL_ID)).toBe(false);
  });

  it('刀分支：自身造成的攻击伤害 +15%（damage_boost caused/physical/常驻）', () => {
    const { ctx, cz, foes } = setup(BLADE, 7);
    cast(ctx, cz, foes);
    const boost = statusOf(cz, 'damage_boost');
    expect(boost).toBeTruthy();
    if (boost?.type === 'damage_boost') {
      expect(boost.rate).toBeCloseTo(0.15, 6);
      expect(boost.direction).toBe('caused');
      expect(boost.damageType).toBe('physical');
      expect(boost.remaining).toBe(999); // 持续直至战斗结束
    }
    // 非剑分支：无有益效果移除事件
    expect(eventsOf(ctx, 'status_changed').some((e) => e.detail?.includes('移除'))).toBe(false);
  });

  it('长兵分支：目标攻击距离 −1、持续 2 回合', () => {
    const { ctx, cz, foes } = setup(SPEAR, 7);
    cast(ctx, cz, foes);
    const hit = damageTargetIds(ctx);
    expect(hit.size).toBeGreaterThan(0);
    for (const id of hit) {
      const foe = foes.find((f) => f.general.id === id)!;
      const range = statusOf(foe, 'range_buff');
      expect(range).toBeTruthy();
      if (range?.type === 'range_buff') {
        expect(range.amount).toBe(-1);
        expect(range.remaining).toBe(2);
      }
    }
    // 距离降低只打敌人：施法者与未被命中的敌人都不受影响
    expect(statusOf(cz, 'range_buff')).toBeUndefined();
    for (const foe of foes.filter((f) => !hit.has(f.general.id))) {
      expect(statusOf(foe, 'range_buff')).toBeUndefined();
    }
  });

  it('弓分支：60% 几率目标数 +1（成功多打 1 人；失败仍 2 人）', () => {
    // 目标池 3 人、groupCount 2 → 命中 +1 时 3 个目标
    let hitCase: CombatContext | undefined;
    let missCase: CombatContext | undefined;
    for (let seed = 1; seed <= 60 && (!hitCase || !missCase); seed++) {
      const { ctx, cz, foes } = setup(BOW, seed);
      cast(ctx, cz, foes);
      const roll = eventsOf(ctx, 'skill_trigger').find((e) => e.skillId === SKILL_ID && e.baseRate === 60);
      if (!roll) continue;
      if (roll.success && !hitCase) hitCase = ctx;
      if (!roll.success && !missCase) missCase = ctx;
    }
    expect(hitCase, '需要找到 +1 目标判定成功的种子').toBeTruthy();
    expect(missCase, '需要找到 +1 目标判定失败的种子').toBeTruthy();
    // 成功：3 个伤害目标；失败：2 个
    expect(damageTargetIds(hitCase!).size).toBe(3);
    expect(damageTargetIds(missCase!).size).toBe(2);
    // 判定事件字段口径（与其它发动率判定一致：baseRate 60 / rate 经士气修正 / morale）
    const roll = eventsOf(hitCase!, 'skill_trigger').find((e) => e.skillId === SKILL_ID && e.baseRate === 60)!;
    expect(roll.rate).toBe(60); // 士气 100 → 系数 1.0
    expect(roll.morale).toBe(100);
    // 弓分支无属性/距离附加段
    expect(eventsOf(hitCase!, 'status_changed').some((e) => e.detail?.includes('距离'))).toBe(false);
  });

  it('其余宝物 / 未授予：目标防御 −36 受攻击缩放（成长率 0.1125/点）、持续 2 回合', () => {
    for (const treasureId of [FAN, OTHER, undefined]) {
      const { ctx, cz, foes } = setup(treasureId, 7);
      cast(ctx, cz, foes);
      const hit = damageTargetIds(ctx);
      expect(hit.size).toBeGreaterThan(0);
      for (const id of hit) {
        const foe = foes.find((f) => f.general.id === id)!;
        const debuff = statusOf(foe, 'defense_buff');
        expect(debuff, `宝物 ${treasureId}：应挂防御降低`).toBeTruthy();
        if (debuff?.type === 'defense_buff') {
          // 曹彰 40 级白板攻击 182（98 + 39×2.16 四舍五入）→ 36 + 0.1125×102 = 47.475 → 0.1% 粒度 47.5
          expect(debuff.amount).toBeCloseTo(-47.5, 6);
          expect(debuff.remaining).toBe(2);
        }
      }
      // 默认分支没有刀的自增伤
      expect(statusOf(cz, 'damage_boost')).toBeUndefined();
    }
  });

  it('默认段「受攻击属性影响」缩放口径：实测点 攻击 200.6 → 减防 49.6%（用户 2026-09-27）', () => {
    // 曹彰 40 级攻击 = 98 + 39×2.16 = 182 → +18.6 自由点 = 200.6（对齐实测点）
    const { ctx, cz, foes } = setup(undefined, 7, 18.6);
    expect(cz.general.attack).toBe(200.6);
    cast(ctx, cz, foes);
    const hit = damageTargetIds(ctx);
    expect(hit.size).toBeGreaterThan(0);
    for (const id of hit) {
      const foe = foes.find((f) => f.general.id === id)!;
      const debuff = statusOf(foe, 'defense_buff');
      expect(debuff?.type).toBe('defense_buff');
      if (debuff?.type === 'defense_buff') expect(debuff.amount).toBeCloseTo(-49.6, 6);
      const detail = eventsOf(ctx, 'status_inflicted').find(
        (e) => e.unitId === id && e.statusType === 'defense_buff'
      )?.detail;
      expect(detail).toContain('49.6%');
    }
    // 反推公式：36 + 0.1125×(200.6−80) = 49.5575 → 0.1% 粒度四舍五入 = 49.6
    expect(Math.round(scaledValue(36, 0.1125, 200.6) * 10) / 10).toBeCloseTo(49.6, 6);
    // 相邻候选在该点会显示别的值（0.115 → 49.9、0.12 → 50.5），故实测 49.6 支持 0.1125
    expect(Math.round(scaledValue(36, 0.115, 200.6) * 10) / 10).toBeCloseTo(49.9, 6);
  });

  it('分支互斥：同一次发动只吃佩戴宝物对应的那一条分支', () => {
    // 长兵 → 只有 range_buff，无防御降低 / 无自增伤
    const spear = setup(SPEAR, 7);
    cast(spear.ctx, spear.cz, spear.foes);
    expect(spear.foes.some((f) => statusOf(f, 'defense_buff'))).toBe(false);
    expect(statusOf(spear.cz, 'damage_boost')).toBeUndefined();
    expect(spear.foes.some((f) => statusOf(f, 'range_buff'))).toBe(true);

    // 剑 → 只有移除 + 攻击，无控制类/属性类附加
    const sword = setup(SWORD, 7);
    cast(sword.ctx, sword.cz, sword.foes);
    expect(statusOf(sword.cz, 'damage_boost')).toBeUndefined();
    expect(sword.foes.some((f) => statusOf(f, 'defense_buff'))).toBe(false);
    expect(sword.foes.some((f) => statusOf(f, 'range_buff'))).toBe(false);
  });

  it('刀分支叠层：同战法重复施加按「可叠加」累加（官方未写层数上限）', () => {
    // 找连续两次发动都成功的种子，断言两次伤害事件的增伤来源为 15% → 30%
    let found: { rates: number[] } | undefined;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const { ctx, cz, foes } = setup(BLADE, seed);
      cast(ctx, cz, foes);
      cast(ctx, cz, foes);
      const rolls = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
      if (rolls.filter((r) => r.success).length < 2) continue;
      const boostSources = eventsOf(ctx, 'damage')
        .filter((e) => e.skillId === SKILL_ID)
        .map((d) => d.modifiers?.caused.find((c) => c.skillId === SKILL_ID)?.rate ?? 0);
      const rates = boostSources.filter((r) => r > 0);
      if (rates.length >= 2) found = { rates };
    }
    expect(found, '需要找到两次发动均成功的种子').toBeTruthy();
    const unique = [...new Set(found!.rates)].sort((a, b) => a - b);
    expect(unique[0]).toBeCloseTo(0.15, 6);
    expect(unique[1]).toBeCloseTo(0.3, 6);
    expect(new Set(unique).size).toBeGreaterThanOrEqual(2);
  });
});
