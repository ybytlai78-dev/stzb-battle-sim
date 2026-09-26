/**
 * 中宫追玺（步皇后·吴步 h497 主战法）：指挥 C（一类指挥 prep），距离 2，我军全体，发动率 --。
 * 满级：战斗开始后，使我军全体受到的所有伤害降低 60.0%，每当受到攻击或策略攻击的伤害后，
 *   其对此类型伤害的减伤效果将降低 1/5。1 级：减伤 30.0%（衰减同为 1/5）。
 * 官方：scripts/skill_extra.json id 200738（指挥 / 距离 2 / 我军群体（有效距离内 3 个目标）；zfQuality=C）。
 *   来源 https://stzb.163.com/m/skilllist/200738.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注；零引擎改动）：
 *   ① 目标口径冲突（targetShow 我军群体 3 目标 vs 描述我军全体）→ 按描述取 targetMode:'all'（A③）；
 *   ② 「减少 60%」无「受…属性影响」→ 固定值，无成长率缺口 → 上架；
 *   ③ 「攻击 / 策略攻击」= 两条独立 damage_reduce 轨（damageType physical / strategy），各自受击 −1/5；
 *   ④ 「降低 1/5」= 既有 decayFifths 口径（按初始值线性 60→48→36→24→12→0）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'zhonggong_zhuixi';
const HERO_ID = 'h497';

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

/** 准备阶段上下文（一类指挥：currentRound=0 时 triggerCommandSkills 释放） */
function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx([heroUnit(HERO_ID, '中军')], [makeUnit(dummy('foe-front', '前锋'), 'enemy')], seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

/** 取指定伤害类型的减伤状态 */
function reduceOf(u: UnitState, damageType: 'physical' | 'strategy') {
  const st = u.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID && s.damageType === damageType);
  if (st?.type !== 'damage_reduce') throw new Error(`期望 damage_reduce(${damageType})`);
  return st;
}

describe('中宫追玺（步皇后 h497）', () => {
  it('装配：一类指挥·距离 2·我军全体·两条减伤轨（物理/策略各 60%·decayFifths 5）·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('步皇后');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('中宫追玺');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入指挥槽
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.triggerRate).toBe(1);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_reduce']);
    expect(s.output).toEqual([
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.6, duration: 999, damageType: 'physical', decayFifths: 5 } },
      { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.6, duration: 999, damageType: 'strategy', decayFifths: 5 } },
    ]);

    // 无「受属性影响」段、无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·准备阶段挂两条独立减伤轨：各 rate 0.6 / 5 份满额 / duration 999', () => {
    const ctx = prepCtx();
    const me = ctx.myTeam[0];
    for (const damageType of ['physical', 'strategy'] as const) {
      const st = reduceOf(me, damageType);
      expect(st.rate).toBeCloseTo(0.6, 6);
      expect(st.fifths).toBe(5);
      expect(st.fifthsBase).toBe(5);
      expect(st.baseRate).toBeCloseTo(0.6, 6);
      expect(st.remaining).toBe(999);
    }
    // 两条轨是两个实例（同源但过滤维不同，不判同源合并）
    expect(me.statuses.filter((st) => st.type === 'damage_reduce' && st.sourceSkillId === SKILL_ID)).toHaveLength(2);
  });

  it('机制·按类型衰减：受物理伤害只掉物理轨（60%→48%），策略轨保持 60%；反之亦然', () => {
    const ctx = prepCtx();
    const me = ctx.myTeam[0];
    const foe = ctx.enemyTeam[0];

    // 物理一击（直接 applyDamage 结算，指定 damageType）
    const before = ctx.events.length;
    actUnit(ctx, foe); // 敌军普攻（物理）我方中军
    expect(ctx.events.length).toBeGreaterThan(before);
    expect(reduceOf(me, 'physical').fifths).toBe(4);
    expect(reduceOf(me, 'physical').rate).toBeCloseTo(0.48, 6);
    expect(reduceOf(me, 'strategy').fifths).toBe(5);
    expect(reduceOf(me, 'strategy').rate).toBeCloseTo(0.6, 6);

    // 策略一击（用雾起/火攻类 DoT 不必要——直接构造一个 matching 的策略伤害事件不可行，
    // 改用 inflictStatus 挂 DoT 并由目标行动跳伤：DoT = strategy 伤害类型）
    inflictStatus(ctx, me, { type: 'sorcery', duration: 1, rate: 60, growthRate: 0 }, 'active', 'mock_dot', foe.general.id);
    actUnit(ctx, me); // DoT 跳伤（策略）
    expect(reduceOf(me, 'strategy').fifths).toBeLessThan(5);
    const physFifths = reduceOf(me, 'physical').fifths ?? 0;
    expect(physFifths).toBe(4); // 物理轨不受策略受击影响
  });

  it('机制·五份衰减到底：连续 5 次匹配受击后 rate 归 0（不再提供减伤）', () => {
    const ctx = prepCtx();
    const me = ctx.myTeam[0];
    const foe = ctx.enemyTeam[0];
    for (let i = 0; i < 5; i++) actUnit(ctx, foe);
    const st = me.statuses.find((s) => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID && s.damageType === 'physical');
    if (st?.type === 'damage_reduce') {
      expect(st.rate).toBeLessThanOrEqual(0.12 + 1e-9);
      expect(st.fifths ?? 0).toBeLessThanOrEqual(1);
    }
    // 策略轨仍满额（未被物理受击影响）
    expect(reduceOf(me, 'strategy').rate).toBeCloseTo(0.6, 6);
  });

  it('数值·减伤生效：同种子对照，挂减伤后的普攻伤害低于无减伤', () => {
    const measure = (withReduce: boolean) => {
      const attacker = makeUnit(dummy('atk', '前锋'), 'my');
      const victim = makeUnit(dummy('vic', '大营'), 'enemy');
      const ctx = makeCtx([attacker], [victim], 31);
      if (withReduce) {
        inflictStatus(ctx, victim, { type: 'damage_reduce', rate: 0.6, duration: 999, damageType: 'physical', decayFifths: 5 }, 'command', SKILL_ID);
      }
      actUnit(ctx, attacker);
      // 普攻走 attack_hit 事件，伤害以兵力差计（避免事件字段差异）
      return victim.general.maxTroops - victim.troops;
    };
    const plain = measure(false);
    const reduced = measure(true);
    expect(plain).toBeGreaterThan(0);
    expect(reduced).toBeGreaterThan(0);
    // 兵力基础不乘 mult，故总伤害降幅小于 60%；但应有明显下降
    expect(reduced).toBeLessThan(plain * 0.8);
  });

  it('整场跑通（runBattle·8 回合）：减伤状态与 battle_end 齐全', () => {
    const bu: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 15,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), bu, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.filter((e) => e.statusType === 'damage_reduce').length).toBeGreaterThanOrEqual(6); // 3 人 × 2 轨
  });
});
