/**
 * 万军取首（XP黄忠·蜀弓 h810 主战法）：追击 S，官方有效距离栏「--」（追击战法不适用），发动率 40%。
 * 满级：普通攻击后，对攻击目标再次发动猛烈攻击（伤害率 160.0%），第四回合起，会额外对 5 距离内敌军
 *   单体发动一次攻击（伤害率 100.0%），同时有 50.0% 几率额外对敌方大营再发动一次猛烈攻击（伤害率 160.0%）。
 * 1 级：160% → 80% / 100% → 50% / 160% → 80%。
 * 官方：scripts/skill_extra.json id 200292（追击 S / 距离 -- / 攻击目标 / 兵种弓步骑；
 *   effect 标签 攻击伤害）。来源 https://stzb.163.com/m/skilllist/200292.html
 * 口径（策略 A，照仓库既有先例；推定处见 skills.ts 注释）：
 *   ① 追击主段沿用本战法整体目标 `[hitTarget]`（普攻目标），不受距离约束；战法级 `range: 5` 与第二段
 *      段级 `range: 5` 一致；
 *   ② 「第四回合起…额外对 5 距离内敌军单体发动一次攻击（100%）」→ 每次追击触发都追加
 *      （段级 `startRound: 4` + `targetMode:'random_single'` + 段级 `range: 5`），**推定**非「每回合一次」；
 *   ③ 「同时有 50.0% 几率额外对敌方大营再发动一次猛烈攻击（160%）」→ 独立段 `chance: 0.5` +
 *      `positions:['大营']`（新引擎件「伤害段站位定向」）；敌方大营阵亡 → 该段空转；
 *   ④ 三段均无「受属性影响」→ 不缩放、无数值缺口 → 上架（不登记 OFFLINE_MAIN_SKILLS）。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 * 选靶确定性：普攻目标是「攻击距离内**随机**存活敌军」，故用例把 h810 攻击距离压到 1（只够得着前锋）
 *   以锁定主段目标；追加段用段级 `range: 5`（不受攻击距离影响），故仍可命中任意敌军。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'wanjun_qushou';
const HERO_ID = 'h810';

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

function skillDamage(ctx: CombatContext) {
  return eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
}

/** 敌军三件套（前锋 / 中军 / 大营），每次新建避免跨用例状态污染 */
function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
}

/** 克隆注册表定义：追击发动率改 1 求确定，并把第三段（大营段）段级 chance 改成给定值 */
function withThirdChance(chance: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'pursuit') throw new Error('万军取首应为追击战法');
  s.triggerRate = 1;
  const seg = s.output[2];
  if (!seg || seg.kind !== 'physical_damage') throw new Error('万军取首第三段应为 physical_damage');
  seg.chance = chance;
  return s;
}

/** 单段 100% 基线（同种子比对主段 160% 的 breakdown.main 倍数） */
function mainOnly(rate: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'pursuit') throw new Error('万军取首应为追击战法');
  s.triggerRate = 1;
  s.output = [{ kind: 'physical_damage', rate }];
  return s;
}

/** 追击链路：h810 普攻一次（攻击距离可压到 1 锁定主段目标）→ 追击战法结算 */
function pursuitRun(
  skill: Skill,
  cfg: { seed: number; enemies: UnitState[]; currentRound?: number; attackRange?: number },
): CombatContext {
  const me = heroUnit(HERO_ID, '前锋', { pursuitSkillIds: [SKILL_ID] });
  if (cfg.attackRange != null) me.general.attackRange = cfg.attackRange; // 构造：锁定普攻目标
  const ctx = makeCtx([me], cfg.enemies, cfg.seed);
  ctx.currentRound = cfg.currentRound ?? 1;
  ctx.skills.set(SKILL_ID, skill);
  actUnit(ctx, me);
  return ctx;
}

describe('万军取首（XP黄忠 h810）', () => {
  it('装配：追击·range 5·40%·三段 output（160 主段 / 100+startRound4+random_single+range5 / 160+chance50%+大营）· h810 追击槽 · 上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP黄忠');
    expect(hero.faction).toBe('蜀');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('万军取首');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入追击槽（mainSkillSlot 依战法类型）
    expect(hero.pursuitSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('pursuit');
    if (s.type !== 'pursuit') return;
    // 官方有效距离栏「--」→ 追击主段不受约束；战法级 range 5 与追加段段级 range 一致
    expect(s.range).toBe(5);
    // 官方发动几率栏 40%
    expect(s.triggerRate).toBe(0.4);
    expect(s.tags).toEqual(['damage']);
    expect(s.output).toHaveLength(3);
    // ① 主段：普攻目标 160%
    expect(s.output[0]).toEqual({ kind: 'physical_damage', rate: 160 });
    // ② 第 4 回合起每次触发追加：5 距离内随机敌军单体 100%
    expect(s.output[1]).toEqual({
      kind: 'physical_damage',
      rate: 100,
      startRound: 4,
      targetMode: 'random_single',
      range: 5,
    });
    // ③ 50% 额外对敌方大营再发动一次猛烈攻击 160%（站位定向）
    expect(s.output[2]).toEqual({ kind: 'physical_damage', rate: 160, chance: 0.5, positions: ['大营'] });

    // 三段均无「受属性影响」→ 上架（不登记 OFFLINE_MAIN_SKILLS）
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(true);
  });

  it('机制·主段：追击触发 → 1 条 damage（本战法 / 普攻目标 / 160%）', () => {
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
    const ctx = pursuitRun(withThirdChance(0), { seed: 7, enemies: [foe] });

    const casts = eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID);
    expect(casts).toHaveLength(1);
    expect(casts[0]?.unitId).toBe(HERO_ID);

    // 克隆 triggerRate 1 → skill_trigger 基础率 100% 必定发动
    // （第三段段级 chance 0 也会发一条 baseRate 0 的 skill_trigger，故按 baseRate 100 过滤）
    const trig = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID && e.baseRate === 100);
    expect(trig).toHaveLength(1);
    expect(trig[0]?.success).toBe(true);
    expect(trig[0]?.baseRate).toBe(100);

    // 唯一敌军为前锋：① 主段命中普攻目标；② 追加段第 1 回合不生效；③ 大营段（chance 克隆为 0）不触发
    const dmg = skillDamage(ctx);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.damageType).toBe('physical');
    expect(dmg[0]?.sourceId).toBe(HERO_ID);
    expect(dmg[0]?.targetId).toBe('foe');

    // 160%：同种子 100% 单段基线的 breakdown.main × 1.6（兵力基础不乘倍率，主要伤害与伤害率线性）
    const base = pursuitRun(mainOnly(100), { seed: 7, enemies: [makeUnit(dummy('foe', '前锋'), 'enemy', 30000)] });
    const baseDmg = skillDamage(base);
    expect(baseDmg).toHaveLength(1);
    expect(dmg[0]!.breakdown.troopBase).toBe(baseDmg[0]!.breakdown.troopBase);
    expect(dmg[0]!.breakdown.main / baseDmg[0]!.breakdown.main).toBeCloseTo(1.6, 2);
  });

  it('机制·第 4 回合起：round 3 只有主段；round 4 主段 + 追加段（1 条 100% / 目标为 5 距离内随机敌军）', () => {
    const skill = withThirdChance(0); // 隔离大营段，只看主段与追加段

    // round 3：追加段（startRound 4）不结算
    const ctx3 = pursuitRun(skill, { seed: 3, enemies: enemyTrio(), currentRound: 3, attackRange: 1 });
    const dmg3 = skillDamage(ctx3);
    expect(dmg3).toHaveLength(1);
    expect(dmg3[0]?.targetId).toBe('foe-front'); // 攻击距离压到 1 → 主段 = 普攻目标

    // round 4：主段（160%，普攻目标）+ 追加段（100%，5 距离内随机敌军）
    const ctx4 = pursuitRun(skill, { seed: 3, enemies: enemyTrio(), currentRound: 4, attackRange: 1 });
    const dmg4 = skillDamage(ctx4);
    expect(dmg4).toHaveLength(2);
    expect(dmg4[0]?.targetId).toBe('foe-front');
    expect(['foe-front', 'foe-mid', 'foe-back']).toContain(dmg4[1]?.targetId);
    // 主段 160% vs 追加段 100%：同一次发动内 breakdown.main 比 1.6
    expect(dmg4[0]!.breakdown.main / dmg4[1]!.breakdown.main).toBeCloseTo(1.6, 2);
  });

  it('机制·50% 大营段：chance 1 命中敌方大营；chance 0 不出现；大营阵亡则该段空转（主段/追加段照发）', () => {
    // ① chance 1 → 额外命中敌方大营 targetId（攻击距离 1 使主段锁定前锋，大营伤害只能来自本段）
    const ctx1 = pursuitRun(withThirdChance(1), { seed: 5, enemies: enemyTrio(), attackRange: 1 });
    const dmg1 = skillDamage(ctx1);
    expect(dmg1).toHaveLength(2);
    expect(dmg1.map((d) => d.targetId).sort()).toEqual(['foe-back', 'foe-front']);
    expect(dmg1.every((d) => d.sourceId === HERO_ID && d.damageType === 'physical')).toBe(true);

    // ② chance 0 → 该段不出现
    const ctx0 = pursuitRun(withThirdChance(0), { seed: 5, enemies: enemyTrio(), attackRange: 1 });
    const dmg0 = skillDamage(ctx0);
    expect(dmg0).toHaveLength(1);
    expect(dmg0[0]?.targetId).toBe('foe-front');

    // ③ 敌方大营阵亡 → 站位定向池为空、该段空转；第 4 回合主段 + 追加段仍结算
    const trio = enemyTrio();
    trio[2]!.alive = false; // foe-back 阵亡
    const ctxDead = pursuitRun(withThirdChance(1), { seed: 5, enemies: trio, currentRound: 4, attackRange: 1 });
    const dmgDead = skillDamage(ctxDead);
    expect(dmgDead).toHaveLength(2); // 主段 + 追加段
    expect(dmgDead.every((d) => d.targetId !== 'foe-back')).toBe(true);
    expect(dmgDead[0]?.targetId).toBe('foe-front');
    expect(['foe-front', 'foe-mid']).toContain(dmgDead[1]?.targetId);
  });

  it('整场跑通（runBattle·8 回合）：第 4 回合起可见追加伤害（同一次发动内 100% 段），battle_end 齐全', () => {
    const huangzhong: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { pursuitSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 5,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), huangzhong],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    // 按回合 + 单次发动分组（skill_cast 到下一个 skill_cast 之间的本战法伤害）
    type Group = { round: number; mains: number[]; targets: string[] };
    let round = 0;
    let cur: Group | null = null;
    const groups: Group[] = [];
    for (const e of report.events) {
      if (e.type === 'round_start') {
        round = e.round;
        cur = null;
      } else if (e.type === 'skill_cast' && e.skillId === SKILL_ID && e.unitId === HERO_ID) {
        cur = { round, mains: [], targets: [] };
        groups.push(cur);
      } else if (e.type === 'damage' && e.skillId === SKILL_ID && cur) {
        cur.mains.push(e.breakdown.main);
        cur.targets.push(e.targetId);
      }
    }

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.targets.every((t) => t.startsWith('e-')))).toBe(true);

    // 第 4 回合起：单次发动内出现主段 160% 与追加段 100%（breakdown.main 比 1.6）
    const late = groups.filter((g) => g.round >= 4 && g.mains.length >= 2);
    expect(late.length).toBeGreaterThan(0);
    const g = late[0]!;
    const hi = Math.max(...g.mains);
    const lo = Math.min(...g.mains);
    expect(hi / lo).toBeCloseTo(1.6, 1);
  });
});
