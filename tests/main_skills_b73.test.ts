/**
 * 银龙孤胆（SP赵云·蜀步 h102001/sp_zhaoyun 主战法）：主动 A（1 回合准备），距离 5，发动率 40%。
 * 满级：1 回合准备，对随机敌军单体发动 7 次攻击（首次伤害率 80.0%），每次目标独立判定，
 *   每次伤害率都递增 7%。
 * 1 级：首次伤害率 40.0%（递增仍写 7%，官方未给递增公式）。
 * 官方：scripts/skill_extra.json id 200704（主动 / 距离 5 / 敌军单体 / 兵种步；effect 标签 攻击伤害）。
 *   来源 https://stzb.163.com/m/skilllist/200704.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 「每次伤害率都递增 7%」= 每次 +7 个百分点（80/87/94/101/108/115/122）；1 级 40% 与之差半
 *      → 支持绝对递增而非乘算（推定，官方未给递增公式）；
 *   ② 「每次目标独立判定」= repeats:7 + targetMode:'random_single'（既有语义：每次独立重选目标）；
 *   ③ 无「受属性影响」段、无数值缺口 → 上架；
 *   ④ 兵种按官方口径 = 步（旧 heroes.json cavalry 为本地旧数据）→ 数据源头同步 infantry。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 * 释放链路：本战法为 1 回合准备，故用 actUnit：第 1 次进入准备，第 2 回合释放。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'yinlong_gudan';
const HERO_ID = 'sp_zhaoyun';

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

/** 敌军三件套（前锋 / 中军 / 大营），每次新建避免跨用例状态污染；同防御便于数值递增对比 */
function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
}

/** 克隆注册表定义：triggerRate 改 1 求确定（目标独立判定仍按真实 RNG） */
function castClone(): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'active') throw new Error('银龙孤胆应为主动战法');
  s.triggerRate = 1;
  return s;
}

/** 第 1 回合进入准备，第 2 回合释放（1 回合准备链路） */
function cast(seed: number, enemies = enemyTrio()): { ctx: CombatContext; me: UnitState } {
  const me = heroUnit(HERO_ID, '前锋', { activeSkillIds: [SKILL_ID] });
  const ctx = makeCtx([me], enemies, seed);
  ctx.skills.set(SKILL_ID, castClone());
  actUnit(ctx, me); // prepare_start
  ctx.currentRound = 2;
  actUnit(ctx, me); // prepare_end + 释放
  return { ctx, me };
}

/** 本战法伤害事件 */
function skillDamage(ctx: CombatContext) {
  return eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
}

describe('银龙孤胆（SP赵云 sp_zhaoyun）', () => {
  it('装配：主动·1 回合准备·40%·距离 5·repeats 7 + ratePerRepeat 7 + random_single·sp_zhaoyun 挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('SP赵云');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('银龙孤胆');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入主动槽（mainSkillSlot 依战法类型）
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(true);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual(['damage']);
    expect(s.output).toEqual([
      { kind: 'physical_damage', rate: 80, repeats: 7, targetMode: 'random_single', ratePerRepeat: 7 },
    ]);

    // 无「受属性影响」段、无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·7 次攻击：释放一次产生 7 条同 skillId 的 physical damage，目标均在存活敌军中', () => {
    const { ctx } = cast(1);
    const dmg = skillDamage(ctx);
    expect(dmg).toHaveLength(7);
    expect(dmg.every((e) => e.damageType === 'physical')).toBe(true);
    expect(dmg.every((e) => e.damage > 0)).toBe(true);
    const enemyIds = new Set(['foe-front', 'foe-mid', 'foe-back']);
    for (const e of dmg) expect(enemyIds.has(e.targetId)).toBe(true);
    // 准备链路确实走 prepare_start → prepare_end
    expect(eventsOf(ctx, 'prepare_start').some((e) => e.skillId === SKILL_ID)).toBe(true);
    expect(eventsOf(ctx, 'prepare_end').some((e) => e.skillId === SKILL_ID)).toBe(true);
  });

  it('数值·递增：7 条 breakdown.main 严格递增，首尾 main 之比 ≈ 122/80（±5%）', () => {
    const { ctx } = cast(7);
    const mains = skillDamage(ctx).map((e) => e.breakdown.main);
    expect(mains).toHaveLength(7);
    for (let i = 1; i < mains.length; i++) {
      expect(mains[i]!, `第 ${i + 1} 次 main 应大于第 ${i} 次`).toBeGreaterThan(mains[i - 1]!);
    }
    const ratio = mains[6]! / mains[0]!;
    expect(Math.abs(ratio - 122 / 80), `首尾 main 比值 ${ratio}`).toBeLessThan(0.05);
  });

  it('机制·独立选靶：同一段 7 次的目标序列可出现 >1 个不同 targetId（多跑几个种子）', () => {
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const { ctx } = cast(seed);
      const ids = new Set(skillDamage(ctx).map((e) => e.targetId));
      if (ids.size >= 2) found = true;
    }
    expect(found).toBe(true);
  });

  it('整场跑通（runBattle·8 回合）：skill_cast / damage / battle_end 齐全', () => {
    const zhaoyun: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { activeSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), zhaoyun, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
        e.type === 'skill_cast' && e.skillId === SKILL_ID
    );
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((e) => e.unitId === HERO_ID)).toBe(true);

    const damage = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(damage.length).toBeGreaterThanOrEqual(7);
  });
});
