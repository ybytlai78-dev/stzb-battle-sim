/**
 * 京观垒冢（皇甫嵩·汉步 h630 主战法）：被动 S（battle_start 登记），距离 1，目标自己。
 * 满级：自身造成伤害时，有 70.0% 几率对目标额外发动一次攻击（伤害率 200.0%）或策略攻击（伤害率 200.0%）。
 * 1 级：伤害率 100.0%（概率 70% 不变）。
 * 官方：scripts/skill_extra.json id 200898。来源 https://stzb.163.com/m/skilllist/200898.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 新引擎件 PassiveSkill.dealExtraStrike：造成伤害（实际扣兵 > 0）后按 chance 判定（走士气修正），
 *      命中则对**同一目标**（原伤害目标，不重选）结算 output；追加打击自身不回灌（resolvingDealStrike）；
 *   ② 「攻击…或策略攻击」= 每次触发 50/50 随机（random_pick count 1，三军夺帅先例，推定）；
 *   ③ 两段 200% 均固定不缩放（策略段 strategyScaled:false）→ 上架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, PassiveSkill, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jingguan_leizhong';
const HERO_ID = 'h630';

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

function heroUnit(heroId: string, position: Position): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

/** 皇甫嵩（前锋）对单个敌军（前锋）：距离 1，普攻必中 */
function duel(seed = 1): CombatContext {
  return makeCtx([heroUnit(HERO_ID, '前锋')], [makeUnit(dummy('foe-front', '前锋'), 'enemy')], seed);
}

/** 覆盖触发率（0 = 必不触发、1 = 必触发；确定性断言用） */
function setChance(ctx: CombatContext, chance: number): void {
  const def = ctx.skills.get(SKILL_ID) as PassiveSkill;
  ctx.skills.set(SKILL_ID, { ...def, dealExtraStrike: { ...def.dealExtraStrike!, chance } });
}

const strikeHits = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID);
const attackHit = (ctx: CombatContext) =>
  ctx.events.find((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');

describe('京观垒冢（皇甫嵩 h630）', () => {
  it('装配：被动 battle_start·距离 1·自己·dealExtraStrike{70%·200% 攻击/策略 50-50}·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('皇甫嵩');
    expect(hero.faction).toBe('汉');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('京观垒冢');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.passiveSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
    expect(s.triggerRate).toBe(1);
    expect(s.targetMode).toBe('self');
    expect(s.tags).toEqual(['damage']);
    expect(s.output).toEqual([]);
    expect(s.dealExtraStrike).toEqual({
      chance: 0.7,
      output: [
        {
          kind: 'random_pick',
          count: 1,
          options: [
            [{ kind: 'physical_damage', rate: 200 }],
            [{ kind: 'strategy_damage', rate: 200, strategyScaled: false }],
          ],
        },
      ],
    });

    // 两段固定 200%、无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·造成伤害后追加一次打击：落在同一目标上（skillId = 京观垒冢），且不递归连锁', () => {
    const ctx = duel(5);
    setChance(ctx, 1);
    actUnit(ctx, ctx.myTeam[0]);

    const hit = attackHit(ctx);
    expect(hit).toBeTruthy();
    const strikes = strikeHits(ctx);
    expect(strikes).toHaveLength(1); // 追加打击只有 1 次（追加段自身不回灌）
    expect(strikes[0].targetId).toBe(hit!.targetId); // 同一目标
    expect(['physical', 'strategy']).toContain(strikes[0].damageType);
    // 伤害率固定 200%（无受属性缩放）：伤害 > 0
    expect(strikes[0].damage).toBeGreaterThan(0);
    // 触发事件（70% → 士气 100 → 70%）
    const trig = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    expect(trig).toHaveLength(1);
    expect(trig[0].baseRate).toBe(100); // 本用例把触发率覆盖为 1
    expect(trig[0].targetId).toBe(hit!.targetId);
  });

  it('机制·触发率覆盖为 0 → 不追加打击（无 skill_trigger / 无技能伤害）', () => {
    const ctx = duel(7);
    setChance(ctx, 0);
    actUnit(ctx, ctx.myTeam[0]);
    expect(strikeHits(ctx)).toHaveLength(0);
  });

  it('机制·「攻击或策略攻击」= 50/50 随机：跨多个种子两种伤害类型都出现', () => {
    const types = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const ctx = duel(seed);
      setChance(ctx, 1);
      actUnit(ctx, ctx.myTeam[0]);
      for (const h of strikeHits(ctx)) types.add(h.damageType ?? '');
    }
    expect(types.has('physical')).toBe(true);
    expect(types.has('strategy')).toBe(true);
  });

  it('整场跑通（runBattle·8 回合）：京观垒冢追加打击与 battle_end 齐全', () => {
    const huangfusong: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '前锋' };
    const report = runBattle({
      seed: 55,
      maxRounds: 8,
      myTeam: [huangfusong, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const strikes = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(strikes.length).toBeGreaterThan(0);
    const trigs = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === SKILL_ID
    );
    expect(trigs.length).toBeGreaterThanOrEqual(strikes.length); // 判定次数 ≥ 命中次数
    expect(trigs.every((t) => t.baseRate === 70)).toBe(true); // 真实配置：70%
  });
});
