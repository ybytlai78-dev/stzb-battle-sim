/**
 * 方阵掩杀（SP太史慈·吴弓 h102003 主战法）：追击 A，官方有效距离栏「--」（追击战法不适用），发动率 40%。
 * 满级：普通攻击后，对攻击目标再次发动猛攻（伤害率 235.0%），并使其进行下一次攻击的伤害大幅度降低。
 * 1 级：伤害率 117.5%（「大幅度降低」同）。
 * 官方：scripts/skill_extra.json id 200706（追击 / 距离 -- / 攻击目标 / 兵种弓；effect 标签 攻击伤害;攻击伤害降低）。
 *   来源 https://stzb.163.com/m/skilllist/200706.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 追击主段沿用**普攻目标**（`triggerPursuitSkill` 以 `[hitTarget]` 为整体目标），不受距离约束 → `range: 0`（扬威先例）；
 *   ② 「大幅度」= **极大值**（用户 2026-09-20 口径）→ rate **−99.99（−9999%）**，配合 buffMult 的 10% 伤害下限把
 *      该次攻击压到最低，战报显示「造成的伤害大幅降低」；
 *   ③ 「下一次攻击」= `charges: 1` 次数型造成侧减伤（美人计先例：下一次造成伤害即消耗，不加伤害来源过滤），**推定**；
 *   ④ 无受属性段、无数值缺口 → **上架**（不登记 OFFLINE_MAIN_SKILLS）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'fangzhen_yansha';
const HERO_ID = 'h102003';

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

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

const debuffOf = (u: UnitState) =>
  u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID);

/** 敌军单体两次普攻的伤害（withDebuff 时先挂上「下一次攻击伤害大幅降低」） */
function foeAttackDamages(withDebuff: boolean): { damages: number[]; consumed: boolean } {
  const me = heroUnit(HERO_ID, '中军');
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
  const ctx = makeCtx([makeUnit(dummy('ally-front', '前锋'), 'my', 9000), me], [foe], 21);
  if (withDebuff) {
    inflictStatus(
      ctx,
      foe,
      { type: 'damage_boost', rate: -99.99, duration: 999, direction: 'caused', charges: 1 },
      'pursuit',
      SKILL_ID,
      me.general.id
    );
  }
  actUnit(ctx, foe);
  actUnit(ctx, foe);
  const damages = eventsOf(ctx, 'attack_hit')
    .filter((e) => e.sourceId === 'foe')
    .map((e) => e.damage);
  return { damages, consumed: debuffOf(foe) === undefined };
}

/** 克隆注册表定义并把发动率改成 1（40% 掷骰会让机制断言不确定；不动注册表，仅 ctx 内副本） */
function forcedPursuit(): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'pursuit') throw new Error('方阵掩杀应为追击战法');
  return { ...s, triggerRate: 1 };
}

describe('方阵掩杀（SP太史慈 h102003）', () => {
  it('装配：追击·range 0（官方 --）·40%·猛攻 235% +「下一次攻击」极大值减伤·追击槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('SP太史慈');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('方阵掩杀');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入追击槽（mainSkillSlot 依战法类型）
    expect(hero.pursuitSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('pursuit');
    if (s.type !== 'pursuit') return;
    expect(s.range).toBe(0); // 官方「--」：追击主段不受距离约束
    expect(s.triggerRate).toBe(0.4);
    expect(s.tags).toEqual(['damage', 'damage_boost']);
    expect(s.output).toEqual([
      { kind: 'physical_damage', rate: 235 },
      {
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: -99.99, duration: 999, direction: 'caused', charges: 1 },
      },
    ]);

    // 无受属性段、无数值缺口（「大幅度」= 极大值）→ 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(true);
  });

  it('机制·追击链路：普攻后追加 1 条攻击伤害（skillId=本战法 / 目标=普攻目标）并挂「下一次攻击」减伤', () => {
    const me = heroUnit(HERO_ID, '前锋');
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
    const ctx = makeCtx([me], [foe], 7);
    ctx.skills.set(SKILL_ID, forcedPursuit()); // 发动率 40% → 1 求确定

    actUnit(ctx, me);

    const casts = eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID);
    expect(casts).toHaveLength(1);
    expect(casts[0]?.unitId).toBe(HERO_ID);
    const trig = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
    expect(trig).toHaveLength(1);
    expect(trig[0]?.baseRate).toBe(100);
    expect(trig[0]?.success).toBe(true);

    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.damageType).toBe('physical');
    expect(dmg[0]?.sourceId).toBe(HERO_ID);
    expect(dmg[0]?.targetId).toBe('foe');

    // 减伤挂在**攻击目标**身上：造成侧（caused）、极大值 −9999%、一次性 charges 1
    const st = debuffOf(foe);
    expect(st).toBeTruthy();
    if (st?.type !== 'damage_boost') throw new Error('期望 damage_boost');
    expect(st.direction).toBe('caused');
    expect(st.rate).toBeCloseTo(-99.99, 6);
    expect(st.charges).toBe(1);
    expect(st.remaining).toBeGreaterThanOrEqual(999);
  });

  it('机制·「下一次攻击」伤害被压到下限且只吃一次（第二次攻击恢复正常）', () => {
    const base = foeAttackDamages(false);
    const debuffed = foeAttackDamages(true);
    expect(base.damages).toHaveLength(2);
    expect(debuffed.damages).toHaveLength(2);
    // 同种子双跑：唯一差异是减伤状态 → 第一次攻击被压到接近下限
    expect(debuffed.damages[0]).toBeLessThan(base.damages[0] * 0.6);
    // charges 1 → 第一次攻击后消耗，第二次攻击不再减伤
    expect(debuffed.consumed).toBe(true);
    expect(debuffed.damages[1]).toBeGreaterThan(base.damages[1] * 0.6);
  });

  it('整场跑通（runBattle·8 回合）：追击杀伤与减伤状态均出现，battle_end 齐全', () => {
    const taishiCi: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 4242,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), taishiCi, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(dmg.length).toBeGreaterThan(0);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_boost'
    );
    expect(inflicted.length).toBeGreaterThan(0);
  });
});
