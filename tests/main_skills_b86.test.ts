/**
 * 佐命晋武（裴秀·晋步 h801 主战法）：指挥 A（一类指挥 prep），距离 5，我军全体，发动率 --。
 * 满级：战斗开始后，我军全体士气提升时，造成的所有伤害提升 4.8%（受谋略属性影响），持续至战斗结束，
 *   此效果最多叠加 8 次；每回合结束时，为我军兵力最低单体恢复 2 次兵力（恢复率 100.0%，受谋略属性影响），
 *   每次目标独立判定。1 级：2.4% / 50.0%。
 * 官方：scripts/skill_extra.json id 200278。来源 https://stzb.163.com/m/skilllist/200278.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① CommandSkill.onMoraleRaise（本侧任意单位被施加正士气提升 → 我军全体结算 output，每次 1 层，上限 8）；
 *   ② damage_boost caused 全伤害类型 + strategyScaled（基值 4.8%）；
 *   ③ CommandSkill.roundEndOutput（回合结束、状态 tick 之前）；
 *   ④ 两条 heal 段各带 targetPick:'lowest_troops_ally'（每次独立重选）；
 *   ⑤ 受谋略成长率未确认 → 下架（OFFLINE_MAIN_SKILLS）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  inflictStatus,
  triggerCommandSkills,
  triggerRoundEndCommands,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'zuoming_jinwu';
const HERO_ID = 'h801';

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

function heroUnit(heroId: string, position: Position): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

function myTrio(): UnitState[] {
  return [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-front', '前锋'), 'my', 9000), makeUnit(dummy('mate-back', '大营'), 'my', 9000)];
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 一类指挥：准备阶段释放并锁定我军全体 */
function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(myTrio(), enemyTrio(), seed);
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const boostOf = (u: UnitState) => {
  const st = u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID
  );
  if (!st) throw new Error('期望 damage_boost');
  return st;
};

describe('佐命晋武（裴秀 h801）', () => {
  it('装配：一类指挥 prep·距离 5·我军全体·onMoraleRaise + roundEndOutput·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('裴秀');
    expect(hero.faction).toBe('晋');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('佐命晋武');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_boost', 'heal']);
    expect(s.onMoraleRaise).toEqual({
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: 0.048,
            duration: 999,
            direction: 'caused',
            strategyScaled: true,
            stacks: 1,
            maxStacks: 8,
          },
        },
      ],
    });
    expect(s.roundEndOutput).toEqual([
      { kind: 'heal', rate: 100, strategyScaled: true, growthRate: 0, targetPick: 'lowest_troops_ally' },
      { kind: 'heal', rate: 100, strategyScaled: true, growthRate: 0, targetPick: 'lowest_troops_ally' },
    ]);
    expect(s.output).toEqual([]);

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·我军全体士气提升时叠层：一次提升全体 +4.8%（各 1 层），累计封顶 8 层', () => {
    const ctx = prepCtx(3);
    const [pei, mateA, mateB] = ctx.myTeam;

    // 我方 1 名单位被施加正士气提升 → 我军全体获得增伤
    inflictStatus(ctx, mateA, { type: 'morale_boost', amount: 8, duration: 999 }, 'command', 'mock_morale', pei.general.id);
    for (const u of [pei, mateA, mateB]) {
      expect(boostOf(u).rate).toBeCloseTo(0.048, 6);
      expect(boostOf(u).stacks).toBe(1);
      expect(boostOf(u).direction).toBe('caused');
    }

    // 再来一次 → 同源叠层 2 层 / +9.6%
    inflictStatus(ctx, mateB, { type: 'morale_boost', amount: 8, duration: 999 }, 'command', 'mock_morale', pei.general.id);
    expect(boostOf(pei).stacks).toBe(2);
    expect(boostOf(pei).rate).toBeCloseTo(0.096, 6);

    // 触发 20 次 → 封顶 8 层 / +38.4%
    for (let i = 0; i < 20; i++) {
      inflictStatus(ctx, mateA, { type: 'morale_boost', amount: 5, duration: 999 }, 'command', 'mock_morale', pei.general.id);
    }
    expect(boostOf(pei).stacks).toBe(8);
    expect(boostOf(pei).rate).toBeCloseTo(0.384, 6);
    expect(boostOf(mateB).stacks).toBe(8);
  });

  it('机制·每回合结束恢复 2 次（每次独立选靶）：先恢复兵力最低者，再恢复此时最低的另一人', () => {
    const ctx = prepCtx(5);
    const [pei, mateA, mateB] = ctx.myTeam;
    // 兵力：mateA 4100（次低）、mateB 4000（最低）
    mateA.troops = 4100;
    mateB.troops = 4000;
    const eventsBefore = ctx.events.length;

    triggerRoundEndCommands(ctx);
    const heals = ctx.events.slice(eventsBefore).filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === SKILL_ID
    );
    expect(heals).toHaveLength(2); // 「恢复 2 次」
    // 第 1 次：兵力最低的 mateB（4000 → 4216）；此后 mateA（4100）成为最低 → 第 2 次打 mateA
    expect(heals[0].targetId).toBe(mateB.general.id);
    expect(heals[1].targetId).toBe(mateA.general.id);
    expect(mateB.troops).toBeGreaterThan(4000);
    expect(mateA.troops).toBeGreaterThan(4100);
    // 裴秀自身未受伤 → 未被恢复
    expect(heals.every((h) => h.targetId !== pei.general.id)).toBe(true);
  });

  it('数值·增伤生效：同种子对照，带 4.8% 增伤的一方普攻伤害更高', () => {
    const loss = (withBoost: boolean) => {
      const attacker = makeUnit(dummy('atk', '前锋'), 'my');
      const victim = makeUnit(dummy('vic', '大营'), 'enemy');
      const ctx = makeCtx([attacker], [victim], 31);
      if (withBoost) {
        inflictStatus(
          ctx,
          attacker,
          { type: 'damage_boost', rate: 0.048, duration: 999, direction: 'caused' },
          'command',
          SKILL_ID,
          attacker.general.id
        );
      }
      actUnit(ctx, attacker);
      return victim.general.maxTroops - victim.troops;
    };
    const plain = loss(false);
    const boosted = loss(true);
    expect(plain).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(plain);
  });

  it('整场跑通（runBattle·8 回合）：回合末恢复与 battle_end 齐全', () => {
    const pei: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 111,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), pei, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const heals = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === SKILL_ID
    );
    expect(heals.length).toBeGreaterThan(0);
  });
});
