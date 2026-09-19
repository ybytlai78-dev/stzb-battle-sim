/**
 * 定军绝战（SP夏侯渊·魏骑 h102002 主战法）：主动 B，距离 3，目标敌军单体，官方发动几率栏 120%。
 * 满级：对敌军单体发动一次攻击（伤害率 140.0%）；1 级：伤害率 70.0%。
 * 官方：scripts/skill_extra.json id 200705（主动 B / 距离 3 / 敌军单体 / 兵种骑；effect 标签 攻击伤害）。
 *   来源 https://stzb.163.com/m/skilllist/200705.html
 * 口径（策略 A，照仓库既有先例）：
 *   ① 发动率 120%（>100%）→ 照**虎步关右（h435，同为官方 120%）**先例按 `triggerRate: 1.2` 实装；
 *      判定走 `moraleTriggerRate` 封顶 100%（实际必定发动），`skill_trigger` 事件仍带 baseRate 120。
 *   ② 「敌军单体」= `targetSide:'enemy'` + `targetMode:'random_single'`（率土「敌军单体」为距离内均匀随机）。
 *   ③ 无「受属性影响」段、无数值缺口 → **上架**（不登记 OFFLINE_MAIN_SKILLS，上架池 78 → 79）。
 *   ④ SP 卡 iconId 冲突按策略 A ⑤：沿用 web/data/portrait_map.json 口径（= 102002），不改画像数据。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'dingjun_juezhan';
const HERO_ID = 'h102002';

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
  // level40 → 兵力 9000
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

describe('定军绝战（SP夏侯渊 h102002）', () => {
  it('装配：主动·120%·距离3·敌军单体 / physical 140 / tags[damage] · h102002 挂槽 · 上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('SP夏侯渊');
    expect(hero.faction).toBe('魏');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('定军绝战');
    expect(HERO_RECORDS[HERO_ID].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(3);
    // 官方发动几率栏 120%（>100%）→ 照虎步关右先例按 1.2 实装（判定封顶 100%）
    expect(s.triggerRate).toBe(1.2);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual(['damage']);
    expect(s.output).toEqual([{ kind: 'physical_damage', rate: 140 }]);

    // 无「受属性影响」段、无数值缺口 → 上架（不登记 OFFLINE_MAIN_SKILLS）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID])).toBe(true);
  });

  it('机制·释放一次：skill_cast + 1 条 damage（physical / 本战法 / 敌军单体）', () => {
    const me = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID] });
    const front = makeUnit(dummy('foe-front', '前锋'), 'enemy');
    const back = makeUnit(dummy('foe-back', '大营'), 'enemy');
    const ctx = makeCtx([me], [front, back], 3);

    triggerActiveSkill(ctx, me, ctx.skills.get(SKILL_ID)!, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);

    const casts = eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID);
    expect(casts).toHaveLength(1);
    expect(casts[0]?.unitId).toBe(HERO_ID);

    // 敌军单体：只选 1 个目标（距离 3 内两支敌军都可能被选中）
    const targets = eventsOf(ctx, 'skill_target').filter((e) => e.skillId === SKILL_ID);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.targetIds).toHaveLength(1);

    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.damageType).toBe('physical');
    expect(dmg[0]?.sourceId).toBe(HERO_ID);
    expect(['foe-front', 'foe-back']).toContain(dmg[0]?.targetId);
  });

  it('发动率·120% 封顶：士气 100 下必定发动（多次释放 0 次失败），skill_trigger 带 baseRate 120', () => {
    const me = heroUnit(HERO_ID, '中军', { activeSkillIds: [SKILL_ID] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
    const ctx = makeCtx([me], [foe], 5);

    // moraleTriggerRate(100, 1.2) = min(1, round(1.2 × 士气系数 1.0)) = 1 → 必定发动
    const casts = 20;
    for (let i = 0; i < casts; i++) {
      triggerActiveSkill(ctx, me, ctx.skills.get(SKILL_ID)!, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    }

    const trig = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
    expect(trig).toHaveLength(casts);
    expect(trig.every((e) => e.success)).toBe(true); // 0 次失败
    expect(trig.every((e) => e.baseRate === 120)).toBe(true); // 基础率仍记官方 120%
    expect(trig.every((e) => e.rate === 100)).toBe(true); // 生效几率封顶 100%
    expect(trig.every((e) => e.morale === 100)).toBe(true);
  });

  it('数值·伤害率 140%：同种子 100% 基线的 breakdown.main 成 1.4 倍（troopBase 不乘倍率）', () => {
    const run = (rate: number) => {
      const me = heroUnit(HERO_ID, '前锋', { activeSkillIds: [SKILL_ID] });
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
      const ctx = makeCtx([me], [foe], 11);
      // 只换伤害率、同种子单目标：rng 调用序一致 → attack 基础系数也一致
      const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
      if (s.type !== 'active') throw new Error('定军绝战应为主动战法');
      s.triggerRate = 1;
      s.output = [{ kind: 'physical_damage', rate }];
      ctx.skills.set(SKILL_ID, s);

      triggerActiveSkill(ctx, me, s, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
      expect(dmg).toHaveLength(1);
      return dmg[0]!;
    };

    const low = run(100);
    const high = run(140);

    // 兵力基础与伤害率无关 → 两跑相同（troopBase 不乘倍率）
    expect(high.breakdown.troopBase).toBe(low.breakdown.troopBase);
    // 主要伤害随伤害率线性：140% / 100% = 1.4
    expect(high.breakdown.main / low.breakdown.main).toBeCloseTo(1.4, 1);
    expect(high.damage).toBeGreaterThan(low.damage);
  });

  it('整场跑通（runBattle·8 回合）：skill_cast（定军绝战）+ damage + battle_end 齐全', () => {
    const xiahou: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { activeSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 3,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), xiahou, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast',
    );
    expect(casts.some((e) => e.skillId === SKILL_ID && e.unitId === HERO_ID)).toBe(true);

    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID,
    );
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.damageType === 'physical')).toBe(true);
    expect(dmg.every((e) => e.sourceId === HERO_ID)).toBe(true);
  });
});
