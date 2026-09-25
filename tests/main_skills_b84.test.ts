/**
 * 登锋陷阵（高顺·群骑 h656 主战法）：被动 A（battle_start 登记型），距离 1，目标自己。
 * 满级：战斗中使自身处于洞察状态，当自身兵力首次低于初始兵力的 90%、70%、50% 和 30% 时，
 *   进入规避状态，免疫下 1 次伤害，使自身下次行动时所有攻击类主动战法发动率提高 120.0%。
 * 1 级：发动率提高 60.0%。
 * 官方：scripts/skill_extra.json id 200939。来源 https://stzb.163.com/m/skilllist/200939.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 官方原文两版拼接，后段为**前半的超集**（多「进入规避状态，免疫下 1 次伤害」）→ 按仓库 dedupe 口径
 *      「后半是前半超集取后半」实现**含规避**版（与官方 effect 标签「规避(预备)」一致）；
 *   ② 洞察 duration 999（官方未写回合，推定）；
 *   ③ 「免疫下 1 次伤害」= 层数式必挡 grant_evasion 1 层；
 *   ④ 四档兵力阈值 = troopThresholdBuff [90,70,50,30]（每档去重）；
 *   ⑤ 「下次行动时攻击类主动战法发动率 +120%」= trigger_boost 1.2 + skillTypes ['active'] +
 *      attackSkillsOnly + expireAfterOwnAct（下次行动末清除，甚陷不惧用户确认口径）；
 *   ⑥ 无数值缺口 → 上架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, applyDamage, inflictStatus, triggerPassiveSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'dengfeng_xianzhen';
const HERO_ID = 'h656';

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

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 准备阶段：battle_start 被动登记（洞察） */
function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerPassiveSkills(ctx, ctx.myTeam[0], 'battle_start');
  return ctx;
}

const evasionLayers = (u: UnitState) =>
  u.statuses.filter((s): s is Extract<Status, { type: 'evasion' }> => s.type === 'evasion').reduce((a, s) => a + s.stacks, 0);
const boostOf = (u: UnitState) => {
  const st = u.statuses.find((s): s is Extract<Status, { type: 'trigger_boost' }> => s.type === 'trigger_boost');
  if (!st) throw new Error('期望 trigger_boost');
  return st;
};

describe('登锋陷阵（高顺 h656）', () => {
  it('装配：被动 battle_start·距离 1·自己·洞察 999 + 四档阈值（规避 1 层 + 发动率 +120%）·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('高顺');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('登锋陷阵');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.passiveSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
    expect(s.targetMode).toBe('self');
    expect(s.tags).toEqual(['insight', 'evasion', 'trigger_boost']);
    expect(s.output).toEqual([{ kind: 'inflict_status', status: { type: 'insight', duration: 999 } }]);
    expect(s.troopThresholdBuff).toEqual({
      thresholds: [90, 70, 50, 30],
      output: [
        { kind: 'grant_evasion', stacks: 1, target: 'self' },
        {
          kind: 'inflict_status',
          target: 'self',
          status: {
            type: 'trigger_boost',
            rate: 1.2,
            duration: 999,
            skillTypes: ['active'],
            attackSkillsOnly: true,
            expireAfterOwnAct: true,
          },
        },
      ],
    });

    // 无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·洞察：战斗开始即带洞察（整场），控制类负面被阻断（insight_blocked）', () => {
    const ctx = prepCtx();
    const hero = ctx.myTeam[0];
    const insight = hero.statuses.find((s) => s.type === 'insight');
    expect(insight).toBeTruthy();
    if (insight?.type !== 'insight') throw new Error('期望 insight');
    expect(insight.remaining).toBe(999);

    inflictStatus(ctx, hero, { type: 'hesitation', duration: 2 }, 'active', 'mock_control');
    expect(hero.statuses.some((s) => s.type === 'hesitation')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'insight_blocked' && e.unitId === hero.general.id)).toBe(true);
  });

  it('机制·四档兵力阈值：逐档进规避 1 层 + 发动率 +120%（每档一次，重复打不叠加）', () => {
    const ctx = prepCtx();
    const hero = ctx.myTeam[0];
    const attacker = makeUnit(dummy('atk', '前锋'), 'enemy');

    expect(evasionLayers(hero)).toBe(0);
    // 90% 档：9000 → 8000（88.9%）
    applyDamage(ctx, hero, 1000, attacker, 'physical', 'skill');
    expect(evasionLayers(hero)).toBe(1);
    expect(boostOf(hero).rate).toBeCloseTo(1.2, 6);
    expect(boostOf(hero).attackSkillsOnly).toBe(true);
    expect(boostOf(hero).expireAfterOwnAct).toBe(true);
    expect(boostOf(hero).skillTypes).toEqual(['active']);

    // 继续掉血跨 70% 档：8000 → 6000（66.7%）
    applyDamage(ctx, hero, 2000, attacker, 'physical', 'skill');
    expect(evasionLayers(hero)).toBe(2);
    // 同档内继续掉血（61.1%）不新增
    applyDamage(ctx, hero, 500, attacker, 'physical', 'skill');
    expect(evasionLayers(hero)).toBe(2);

    // 跨 50% 档：5500 → 4300（47.8%）
    applyDamage(ctx, hero, 1200, attacker, 'physical', 'skill');
    expect(evasionLayers(hero)).toBe(3);
    // 跨 30% 档：4300 → 2500（27.8%）
    applyDamage(ctx, hero, 1800, attacker, 'physical', 'skill');
    expect(evasionLayers(hero)).toBe(4);

    // 四档用尽后不再增加
    applyDamage(ctx, hero, 500, attacker, 'physical', 'skill');
    expect(evasionLayers(hero)).toBe(4);
  });

  it('数值·发动率提高 120% 生效：攻击类主动战法 35% → 封顶必发；无增伤时同种子可能不发动', () => {
    const castHappened = (withBoost: boolean, seed: number) => {
      const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), seed);
      const hero = ctx.myTeam[0];
      hero.general.activeSkillIds = ['jiangchu_guanxi']; // 主动 35%（华雄战法，攻击类）
      if (withBoost) {
        inflictStatus(
          ctx,
          hero,
          { type: 'trigger_boost', rate: 1.2, duration: 999, skillTypes: ['active'], attackSkillsOnly: true, expireAfterOwnAct: true },
          'passive',
          SKILL_ID,
          hero.general.id
        );
      }
      ctx.currentRound = 1;
      actUnit(ctx, hero);
      return ctx.events.some(
        (e) => e.type === 'skill_cast' && e.unitId === hero.general.id && e.skillId === 'jiangchu_guanxi'
      );
    };

    // +120% → 35% + 120% = 155% → 封顶 100%：任何种子都必发
    for (const seed of [1, 2, 3, 4]) expect(castHappened(true, seed)).toBe(true);
    // 无增伤：35% 基础率，5 个种子里至少有一个不发动（0.65^5 ≈ 11.6% 全中，用 8 个种子进一步收窄）
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seeds.some((s) => !castHappened(false, s))).toBe(true);
  });

  it('整场跑通（runBattle·8 回合）：洞察 / 规避 / 发动率提升与 battle_end 齐全', () => {
    const gaoshun: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '前锋' };
    const report = runBattle({
      seed: 88,
      maxRounds: 8,
      myTeam: [gaoshun, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'insight')).toBe(true);
    // 8 回合内兵力大概率跌破至少一档 → 出现规避层或发动率提升其一
    expect(
      inflicted.some((e) => e.statusType === 'evasion') || inflicted.some((e) => e.statusType === 'trigger_boost')
    ).toBe(true);
  });
});
