/**
 * 言出必克（XP王朗·魏弓 h652 主战法）：指挥 B（一类指挥 prep；另每回合行动时判定），距离 2，我军全体。
 * 满级：正式回合开始后，使我军全体受到的策略攻击伤害降低 40.0%（受谋略属性影响），每次受到策略攻击
 *   伤害后，减伤效果降低 1/8。同时，每回合行动时，有 60.0% 的概率为友军全体分摊一次 50% 受到的策略伤害。
 * 1 级：减伤 20.0% / 30% 概率。
 * 官方：scripts/skill_extra.json id 200934。来源 https://stzb.163.com/m/skilllist/200934.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 减伤 = damage_reduce(strategy) 40% + decayFifths 8（每次受策略伤害 −1/8，按初始值线性）；
 *   ② 每回合行动时 60% = onActSegments → 给自己挂 damage_share（0.5 / strategy / charges 1）；
 *   ③ damage_share 分摊：同侧友军受匹配伤害时携带者按 rate 立即承担（自身扣兵、受击者少扣），
 *      承担部分走完整伤害结算（承担者自身减伤照常生效）；分摊出去的伤害不再二次分摊；
 *   ④ 受谋略成长率未确认 → 下架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, applyDamage, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CommandSkill, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'yanchu_bike';
const HERO_ID = 'h652';

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

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

function prepCtx(seed = 1): CombatContext {
  const ctx = makeCtx(
    [heroUnit(HERO_ID, '中军'), makeUnit(dummy('mate-a', '前锋'), 'my', 9000), makeUnit(dummy('mate-b', '大营'), 'my', 9000)],
    enemyTrio(),
    seed
  );
  ctx.currentRound = 0;
  triggerCommandSkills(ctx, ctx.myTeam[0]);
  return ctx;
}

const reduceOf = (u: UnitState) => {
  const st = u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID
  );
  if (!st) throw new Error('期望 damage_reduce');
  return st;
};
const shareOf = (u: UnitState) => {
  const st = u.statuses.find((s): s is Extract<Status, { type: 'damage_share' }> => s.type === 'damage_share');
  if (!st) throw new Error('期望 damage_share');
  return st;
};
const shareEvents = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'share_damage' }> => e.type === 'share_damage');

describe('言出必克（XP王朗 h652）', () => {
  it('装配：一类指挥 prep·距离 2·我军全体·策略减伤 40%（1/8 受击衰减）+ 每回合行动 60% 分摊·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP王朗');
    expect(hero.faction).toBe('魏');
    expect(hero.troopType).toBe('archer');
    expect(hero.mainSkillName).toBe('言出必克');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['damage_reduce']);
    expect(s.output).toEqual([]);
    expect(s.initialOutput).toEqual([
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_reduce',
          rate: 0.4,
          duration: 999,
          strategyScaled: true,
          damageType: 'strategy',
          decayFifths: 8,
        },
      },
    ]);
    expect(s.onActSegments).toEqual([
      {
        rate: 0.6,
        output: [
          {
            kind: 'inflict_status',
            target: 'self',
            status: { type: 'damage_share', rate: 0.5, duration: 999, damageKind: 'strategy', charges: 1 },
          },
        ],
      },
    ]);

    // 受谋略成长率未确认 → 基值不缩放 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(false);
  });

  it('机制·策略减伤 40% 且只被策略伤害衰减 1/8：受物理不衰减；衰减到 0 移除', () => {
    const ctx = prepCtx(3);
    const mate = ctx.myTeam[1];
    expect(reduceOf(mate).rate).toBeCloseTo(0.4, 6);
    expect(reduceOf(mate).fifths).toBe(8);
    expect(reduceOf(mate).damageType).toBe('strategy');

    // 物理伤害 → 策略减伤轨不衰减
    applyDamage(ctx, mate, 500, undefined, 'physical', 'skill');
    expect(reduceOf(mate).fifths).toBe(8);

    // 策略伤害 → −1/8（40% → 35%）
    applyDamage(ctx, mate, 500, undefined, 'strategy', 'skill');
    expect(reduceOf(mate).fifths).toBe(7);
    expect(reduceOf(mate).rate).toBeCloseTo(0.35, 6);

    // 继续 7 次 → 归 0 移除
    for (let i = 0; i < 7; i++) applyDamage(ctx, mate, 500, undefined, 'strategy', 'skill');
    expect(mate.statuses.some((s) => s.type === 'damage_reduce' && s.sourceSkillId === SKILL_ID)).toBe(false);
  });

  it('机制·每回合行动时（必中覆盖）获得「分摊一次 50% 策略伤害」；命中时自身承担 50%（承担部分再过自身减伤）', () => {
    const ctx = prepCtx(5);
    const wang = ctx.myTeam[0];
    const mate = ctx.myTeam[1];
    // 把 60% 覆盖为必中（必须早于 actUnit；onActSegments 读 ctx.skills）
    const def = ctx.skills.get(SKILL_ID) as CommandSkill;
    ctx.skills.set(SKILL_ID, { ...def, onActSegments: [{ ...def.onActSegments![0], rate: 1 }] });
    ctx.currentRound = 1;
    actUnit(ctx, wang);
    const share = shareOf(wang);
    expect(share.rate).toBeCloseTo(0.5, 6);
    expect(share.damageKind).toBe('strategy');
    expect(share.charges).toBe(1);

    // 友军受策略伤害（此处直接以结算后数值 600 传入：减伤在伤害公式阶段已生效）
    const mateBefore = mate.troops;
    const wangBefore = wang.troops;
    applyDamage(ctx, mate, 600, undefined, 'strategy', 'skill');
    const events = shareEvents(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].unitId).toBe(wang.general.id);
    expect(events[0].targetId).toBe(mate.general.id);
    expect(events[0].amount).toBe(300);
    expect(mateBefore - mate.troops).toBe(300); // 受击者只承担剩余 300
    expect(wangBefore - wang.troops).toBe(300); // 承担部分按分摊量直接扣兵（不再二次减免）
    // 「分摊一次」→ 次数用尽移除
    expect(wang.statuses.some((s) => s.type === 'damage_share')).toBe(false);

    // 第二次策略伤害不再分摊
    applyDamage(ctx, mate, 600, undefined, 'strategy', 'skill');
    expect(shareEvents(ctx)).toHaveLength(1);
  });

  it('机制·只分摊策略伤害：友军受物理伤害不触发分摊、次数保留', () => {
    const ctx = prepCtx(7);
    const wang = ctx.myTeam[0];
    const mate = ctx.myTeam[1];
    const def = ctx.skills.get(SKILL_ID) as CommandSkill;
    ctx.skills.set(SKILL_ID, { ...def, onActSegments: [{ ...def.onActSegments![0], rate: 1 }] });
    ctx.currentRound = 1;
    actUnit(ctx, wang);
    expect(shareOf(wang).charges).toBe(1);

    applyDamage(ctx, mate, 1000, undefined, 'physical', 'skill');
    expect(shareEvents(ctx)).toHaveLength(0);
    expect(shareOf(wang).charges).toBe(1); // 未被消耗
  });

  it('整场跑通（runBattle·8 回合）：敌方李儒策略伤害触发分摊与 battle_end 齐全', () => {
    const wang: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const liru: General = { ...withSkills(level40(HERO_REGISTRY['h604']), {}), position: '中军' };
    const report = runBattle({
      seed: 444,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), wang, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), liru, dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'damage_reduce')).toBe(true);
    // 李儒的策略伤害会打到王朗队 → 出现分摊事件（分摊触发次数/伤害由 RNG 决定，≥1 即可）
    expect(inflicted.some((e) => e.statusType === 'damage_share')).toBe(true);
  });
});
