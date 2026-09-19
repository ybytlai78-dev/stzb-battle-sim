/**
 * 勇挚刚毅（孙坚·汉弓 h805 主战法）：被动 S，距离 5，目标自己。
 * 满级：自身受到攻击伤害后，有 60.0% 几率对敌军单体发动一次攻击（伤害率 100.0%）；
 *   自身受到策略攻击伤害后，有 40.0% 几率对敌军群体发动一次攻击（伤害率 80.0%）；
 *   当自身兵力首次低于初始兵力的 90%、80%、70% 和 60% 时，造成的攻击伤害提升 5.0%（受攻击属性影响）、
 *   受到恢复效果提升 5.0%（受防御属性影响），此效果最多叠加 4 次。
 * 1 级：受击反伤 60% / 50%、40% / 40%；每档提升 2.5%（1 级同为 4 档）。
 * 官方：scripts/skill_extra.json id 200288（被动 S / 距离 5 / 目标自己 / 兵种弓；
 *   effect 标签 攻击伤害;攻击伤害提高;受到恢复效果提高）。
 *   来源 https://stzb.163.com/m/skilllist/200288.html
 * 入档：**下架** —— ①② 两段「受属性影响」而官方未给成长系数（`attackScaled` / `defenseScaled` 标记在、
 *   `growthRate` 缺 → 按基值不缩放）→ 登记 OFFLINE_MAIN_SKILLS（上架池保持 77）。
 * 引擎配套（本提交新增状态 `heal_boost`，收口点 `recoverTroops`）：主动 heal / 休整 rest /
 *   持续急救 first_aid / 每回合恢复 recoverEachRound / 代打 healSource 全部经 `recoverTroops`，
 *   恢复提高在这里统一结算，所有恢复途径一次受益。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { applyDamage, inflictStatus, recoverTroops, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import { calcHealAmount } from '../src/engine/formulas';
import type { BattleEvent, General, OnHurtConfig, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'yongzhi_gangyi';
const HERO_ID = 'h805';

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
  // level40 → 兵力 9000（不是 dummy 的 30000）
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 把 ctx 内本战法副本的 onHurt 各段触发率置为指定值（机制断言不依赖 RNG） */
function forceOnHurtRates(ctx: CombatContext, rates: number[]): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type === 'passive' && s.onHurt) {
    const cfgs = Array.isArray(s.onHurt) ? s.onHurt : [s.onHurt];
    cfgs.forEach((cfg, i) => {
      cfg.rate = rates[i] ?? 0;
    });
  }
  ctx.skills.set(SKILL_ID, s);
}

/** 孙坚（前锋·9000 兵·被动挂本战法）+ 指定数量敌人 */
function setup(seed = 1, enemyCount = 1) {
  const sun = heroUnit(HERO_ID, '前锋', { passiveSkillIds: [SKILL_ID] });
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ].slice(0, enemyCount);
  const ctx = makeCtx([sun], foes, seed);
  return { ctx, sun, foes };
}

/** 孙坚身上本战法施加的状态 */
function statusOf(u: UnitState, type: 'damage_boost' | 'heal_boost') {
  return u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID);
}

/** 状态的 rate（不存在时 undefined） */
function rateOf(u: UnitState, type: 'damage_boost' | 'heal_boost'): number | undefined {
  const s = statusOf(u, type);
  return s && 'rate' in s ? s.rate : undefined;
}

describe('勇挚刚毅（孙坚 h805）', () => {
  it('装配：被动·battle_start·距离5·自己 / onHurt 两段（60% 攻击→敌军单体 100%；40% 策略→群体2 80%）/ troopThresholdBuff 4 档 / output[] · h805 挂槽 · 下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('孙坚');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('勇挚刚毅');
    expect(HERO_RECORDS[HERO_ID].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(s.triggerRate).toBe(1);
    expect(s.tags).toEqual(['damage', 'damage_boost', 'heal']);
    expect(s.output).toEqual([]);

    // ① 受攻击伤害后 60% → 对敌军单体发动一次攻击 100%（自带 targetMode 重选敌军单体）
    // ② 受策略攻击伤害后 40% → 对敌军群体（2 目标，推定）各一次攻击 80%
    expect(Array.isArray(s.onHurt)).toBe(true);
    const segs = (Array.isArray(s.onHurt) ? s.onHurt : [s.onHurt]) as OnHurtConfig[];
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ victim: 'self', rate: 0.6, damageKind: 'physical', applyTo: 'skill_targets' });
    expect(segs[0]?.output).toEqual([{ kind: 'physical_damage', rate: 100, targetMode: 'random_single' }]);
    expect(segs[1]).toMatchObject({ victim: 'self', rate: 0.4, damageKind: 'strategy', applyTo: 'skill_targets' });
    expect(segs[1]?.output).toEqual([
      { kind: 'physical_damage', rate: 80, targetMode: 'group', groupCount: 2 },
    ]);

    // ③ 兵力首次低于 90/80/70/60% 逐档触发：damage_boost（造成/攻击/受攻击，可叠加）+ heal_boost（受防御，可叠加）
    // thresholds 为百分数（引擎按 兵力/初始兵力×100 比较，先例甚陷不惧 [90,70,50,30]）
    expect(s.troopThresholdBuff?.thresholds).toEqual([90, 80, 70, 60]);
    expect(s.troopThresholdBuff?.output).toEqual([
      {
        kind: 'inflict_status',
        target: 'self',
        status: {
          type: 'damage_boost',
          rate: 0.05,
          duration: 999,
          direction: 'caused',
          damageType: 'physical',
          attackScaled: true,
          stack: true,
        },
      },
      {
        kind: 'inflict_status',
        target: 'self',
        status: { type: 'heal_boost', rate: 0.05, duration: 999, defenseScaled: true, stack: true },
      },
    ]);

    // ①② 受属性成长未确认 → 下架（上架池保持 77）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('引擎·heal_boost 数值：同一恢复途径下 0 层 / 1 层 5% / 4 层 20% —— 恢复量 259 → 271 → 310', () => {
    // 恢复基线：9000 兵施法者、恢复率 120% → calcHealAmount(9000, 120) = floor(216 × 1.2) = 259
    // （216 = 300×9000/(3500+9000)；本仓库恢复公式见 formulas.calcHealAmount）
    const base = calcHealAmount(9000, 120);
    expect(base).toBe(259);

    const healWith = (layers: number): { healed: number; troops: number } => {
      const { ctx, sun } = setup(1);
      sun.troops = 5000; // 留足兵力缺口，避免 recoverTroops 被 maxTroops − troops 截断
      for (let i = 0; i < layers; i++) {
        inflictStatus(
          ctx,
          sun,
          { type: 'heal_boost', rate: 0.05, duration: 999, defenseScaled: true, stack: true },
          'passive',
          SKILL_ID,
          sun.general.id,
        );
      }
      // defenseScaled 但 growthRate 缺 → 按基值不缩放（5%）
      const boost = statusOf(sun, 'heal_boost');
      if (layers > 0 && boost?.type === 'heal_boost') {
        expect(boost.rate).toBeCloseTo(0.05 * layers, 6);
      }
      const healed = recoverTroops(ctx, sun, base);
      return { healed, troops: sun.troops };
    };

    const none = healWith(0);
    const one = healWith(1);
    const four = healWith(4);
    expect(none.healed).toBe(259);
    expect(one.healed).toBe(Math.floor(base * 1.05));
    expect(one.healed).toBe(271);
    expect(four.healed).toBe(Math.floor(base * 1.2));
    expect(four.healed).toBe(310);
    // 差值：+12 / +51（统一收口在 recoverTroops，请求量 floor(amount × (1+Σrate))）
    expect(one.healed - none.healed).toBe(12);
    expect(four.healed - none.healed).toBe(51);
    expect(none.troops).toBe(5259);
    expect(four.troops).toBe(5310);
  });

  it('机制·两段受击反伤：受攻击伤害 → 1 次敌军单体攻击；受策略攻击伤害 → 1 次敌军群体 2 目标攻击（伤害归属孙坚）', () => {
    const { ctx, sun, foes } = setup(1, 2);
    forceOnHurtRates(ctx, [1, 1]); // 两段触发率置 1，机制断言不依赖 RNG

    // ① 受「攻击」伤害 → 60% 段：对敌军单体发动一次攻击（rate 100%）
    applyDamage(ctx, sun, 100, foes[0]!, 'physical', 'skill');
    const physicalHits = eventsOf(ctx, 'damage').filter((e) => e.sourceId === HERO_ID);
    expect(physicalHits).toHaveLength(1);
    expect(foes.some((f) => f.general.id === physicalHits[0]?.targetId)).toBe(true);
    expect(physicalHits[0]?.damageType).toBe('physical');

    // ② 受「策略攻击」伤害 → 40% 段：对敌军群体（2 目标）各发动一次攻击（rate 80%）
    applyDamage(ctx, sun, 100, foes[0]!, 'strategy', 'skill');
    const groupHits = eventsOf(ctx, 'damage').filter(
      (e) => e.sourceId === HERO_ID && !physicalHits.includes(e),
    );
    expect(groupHits).toHaveLength(2);
    expect(new Set(groupHits.map((e) => e.targetId)).size).toBe(2);
    expect(groupHits.every((e) => e.damageType === 'physical')).toBe(true);

    // 「攻击伤害」反伤源为孙坚本人；技能段自带 targetMode，不依赖战法整体（self）目标
    expect(physicalHits[0]?.skillId).toBe(SKILL_ID);
    expect(groupHits.every((e) => e.skillId === SKILL_ID)).toBe(true);
  });

  it('机制·兵力阈值：89/79/69/59% 逐档触发 → damage_boost + heal_boost 各叠 4 层（rate 0.20）；同档重复受击不重复触发', () => {
    const { ctx, sun, foes } = setup(1);
    forceOnHurtRates(ctx, [0, 0]); // 隔离反伤轨

    const thresholds = [0.89, 0.79, 0.69, 0.59];
    thresholds.forEach((p, i) => {
      sun.troops = Math.floor(sun.general.maxTroops * p);
      applyDamage(ctx, sun, 1, foes[0]!, 'physical', 'skill');

      const boost = statusOf(sun, 'damage_boost');
      expect(boost?.type).toBe('damage_boost');
      if (boost?.type === 'damage_boost') {
        expect(boost.rate).toBeCloseTo(0.05 * (i + 1), 6);
        expect(boost.direction).toBe('caused');
        expect(boost.damageType).toBe('physical');
        expect(boost.remaining).toBe(999);
      }
      const heal = statusOf(sun, 'heal_boost');
      expect(heal?.type).toBe('heal_boost');
      if (heal?.type === 'heal_boost') {
        expect(heal.rate).toBeCloseTo(0.05 * (i + 1), 6);
        expect(heal.remaining).toBe(999);
      }
      // stack: true → 同源重挂累加，仍是单实例
      expect(sun.statuses.filter((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)).toHaveLength(1);
      expect(sun.statuses.filter((s) => s.type === 'heal_boost' && s.sourceSkillId === SKILL_ID)).toHaveLength(1);
    });

    expect(rateOf(sun, 'damage_boost')).toBeCloseTo(0.2, 6);
    expect(rateOf(sun, 'heal_boost')).toBeCloseTo(0.2, 6);

    // 同一档（59%）重复受击：troopThresholdBuff 逐档去重，不再叠层
    applyDamage(ctx, sun, 1, foes[0]!, 'physical', 'skill');
    expect(rateOf(sun, 'damage_boost')).toBeCloseTo(0.2, 6);
    expect(rateOf(sun, 'heal_boost')).toBeCloseTo(0.2, 6);

    // 战报 detail：百分数化 + 战斗结束文案（不输出原始小数）
    expect(eventsOf(ctx, 'status_inflicted').map((e) => e.detail)).toContain(
      '造成的伤害提高 5% 持续至战斗结束',
    );
    expect(eventsOf(ctx, 'status_inflicted').map((e) => e.detail)).toContain(
      '受到恢复效果提升 5% 持续至战斗结束',
    );
  });

  it('整场跑通（runBattle·8 回合）：onHurt 反伤 damage / status_inflicted（damage_boost / heal_boost）/ battle_end 齐全', () => {
    const sun: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { passiveSkillIds: [SKILL_ID] }),
      position: '前锋',
    };
    const report = runBattle({
      seed: 3,
      maxRounds: 8,
      myTeam: [sun, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    // 受击反伤：伤害事件归属孙坚（技能段自带 targetMode 重选敌军）
    const reverse = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.sourceId === HERO_ID,
    );
    expect(reverse.length).toBeGreaterThan(0);

    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted',
    );
    expect(inflicted.some((e) => e.statusType === 'damage_boost')).toBe(true);
    expect(inflicted.some((e) => e.statusType === 'heal_boost')).toBe(true);
  });
});
