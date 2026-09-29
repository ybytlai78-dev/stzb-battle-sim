/**
 * 被动战法判定顺序（用户口径）：同优先级（同为被动）看**战法顺序** —— 槽 1（主战法）先判定，
 * 装配战法按添加顺序（与 `web/teamEditor.ts`「同类型内主战法先判定、装配战法按添加顺序」一致）。
 *
 * 用户场景：孙策【主·霸王渡江】（槽 1·被动·`roundStartRepeat` 三连击）+【击势】（槽 2·被动·`round_start` 挂增伤）
 *   → 主战法先判定、击势后判定，且击势增伤「持续到下回合孙策行动前」——
 *   所以孙策主战法吃不到击势的增伤（击势只惠及同一行动内其后的普攻 / 主动 / 追击）。
 *   修复前引擎按「全部 round_start 段 → 全部 roundStartRepeat 段」两趟跑，击势抢在主战法之前生效。
 *
 * 附：击势的「无视防御 60%」与「增伤 50%」同寿（同属「下次行动前递减」第 2 组，`NEXT_ACT_TICK_TYPES`）——
 *   行动中给自己挂的 duration 1 只覆盖本次行动，不会多留一次行动。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '吴',
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
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
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

function forceSkill(ctx: CombatContext, id: string, patch: (s: Skill) => void): void {
  const cloned = structuredClone(SKILL_REGISTRY[id]) as Skill;
  patch(cloned);
  ctx.skills.set(id, cloned);
}

/**
 * 孙策（前锋）+ 3 个同质木桩；霸王渡江的 40% 判定与击势的两个 65% 判定都强制必中，便于观察顺序。
 * `slotOrder` 决定槽位排列：'main-first' = [霸王渡江(槽1), 击势(槽2)]（真实配装，主战法在槽 1）；
 * 'jishi-first' = 人为把击势放到槽 1，用于验证「规则只看槽位顺序、不是对主战法特判」。
 */
function setup(slotOrder: 'main-first' | 'jishi-first' = 'main-first', seed = 1) {
  const passives = slotOrder === 'main-first' ? ['bawang_dujiang', 'jishi'] : ['jishi', 'bawang_dujiang'];
  const me = makeUnit({
    ...withSkills(level40(HERO_REGISTRY['h450']), { passiveSkillIds: passives }),
    position: '前锋',
  });
  const foes = [
    makeUnit(dummy('e-front', '前锋'), 'enemy'),
    makeUnit(dummy('e-mid', '中军'), 'enemy'),
    makeUnit(dummy('e-camp', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([me], foes, seed);
  forceSkill(ctx, 'bawang_dujiang', (s) => {
    if (s.type === 'passive' && s.roundStartRepeat) {
      const group = s.roundStartRepeat.output[0];
      if (group.kind === 'chance_group') group.chance = 1;
    }
  });
  forceSkill(ctx, 'jishi', (s) => {
    if (s.type !== 'passive') return;
    for (const out of s.output) if (out.kind === 'inflict_status') out.chance = 1;
  });
  return { me, foes, ctx };
}

type DamageEvent = Extract<BattleEvent, { type: 'damage' }>;
type HitEvent = Extract<BattleEvent, { type: 'damage' | 'attack_hit' }>;

function damages(ctx: CombatContext, skillId = 'bawang_dujiang'): DamageEvent[] {
  return ctx.events.filter((e): e is DamageEvent => e.type === 'damage' && e.skillId === skillId);
}

/** 该次伤害/普攻命中的增减伤归因里是否有【击势】的增伤 */
function boostedByJishi(e: HitEvent): boolean {
  return (e.modifiers?.caused ?? []).some((s) => s.skillId === 'jishi');
}

/** 事件流里第一条「击势增伤」施加的位置 */
function firstJishiBoostIndex(ctx: CombatContext): number {
  return ctx.events.findIndex((e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost');
}

describe('被动判定顺序：同优先级看战法槽位顺序（孙策主战法 vs 击势）', () => {
  it('主战法（槽 1）先判定 → 霸王渡江的三次伤害全部早于击势的增伤施加', () => {
    const { me, ctx } = setup('main-first');
    actUnit(ctx, me);

    const hits = damages(ctx);
    expect(hits).toHaveLength(3);
    const boostIdx = firstJishiBoostIndex(ctx);
    expect(boostIdx).toBeGreaterThan(-1);
    // 每条伤害事件的位置都排在击势增伤之前（位置按事件对象反查，避免同类事件下标混淆）
    for (const hit of hits) {
      expect(ctx.events.indexOf(hit)).toBeLessThan(boostIdx);
    }
  });

  it('主战法吃不到击势增伤（归因里没有击势）；同一行动的普攻吃得到', () => {
    const { me, ctx } = setup('main-first');
    actUnit(ctx, me);

    // ① 霸王渡江的三次伤害：增减伤归因里没有【击势】
    for (const hit of damages(ctx)) {
      expect(boostedByJishi(hit)).toBe(false);
    }
    // ② 普攻在该行动内排在击势之后 → 正常吃到击势增伤 50%（证明击势本身照常生效）
    const basic = ctx.events.filter((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');
    expect(basic.length).toBeGreaterThan(0);
    expect(boostedByJishi(basic[0])).toBe(true);
    expect((basic[0].modifiers?.caused ?? []).find((s) => s.skillId === 'jishi')?.rate).toBeCloseTo(0.5, 5);
  });

  it('规则只看槽位顺序（非主战法特判）：击势排到槽 1 时，霸王渡江就吃得到增伤', () => {
    const { me, ctx } = setup('jishi-first');
    actUnit(ctx, me);

    const hits = damages(ctx);
    expect(hits).toHaveLength(3);
    // 槽 1（击势）先判定 → 槽 2（霸王渡江）的伤害归因里带【击势】增伤
    expect(hits.every((h) => boostedByJishi(h))).toBe(true);
    const boostIdx = firstJishiBoostIndex(ctx);
    for (const hit of hits) {
      expect(ctx.events.indexOf(hit)).toBeGreaterThan(boostIdx);
    }
  });
});

describe('击势的无视防御与增伤同寿（第 2 组：下次行动前递减）', () => {
  it('第 1 回合行动中挂上的 ignore_def duration 1 只覆盖本次行动：第 2 回合的残留不影响主战法伤害', () => {
    /** 第 1 回合行动后（击势已挂增伤 + 无视防御），第 2 回合霸王渡江的伤害合计。
     *  stripLeftover = 手动剥掉第 1 回合残留的 ignore_def，作为「残留不生效」的基准；
     *  第 2 回合起 patched 掉击势自身的判定（endRound 1），让唯一变量就是「第 1 回合的残留」。 */
    const round2Damage = (stripLeftover: boolean): number => {
      const { me, ctx } = setup('main-first', 7);
      ctx.currentRound = 1;
      actUnit(ctx, me);
      expect(me.statuses.some((s) => s.type === 'ignore_def')).toBe(true); // 第 1 回合确实挂上了

      forceSkill(ctx, 'jishi', (s) => {
        if (s.type === 'passive') s.endRound = 1; // 第 2 回合起击势不再判定，只剩残留这一个变量
      });
      if (stripLeftover) me.statuses = me.statuses.filter((s) => s.type !== 'ignore_def');
      ctx.events = [];
      ctx.currentRound = 2;
      actUnit(ctx, me);
      return damages(ctx).reduce((sum, d) => sum + d.damage, 0);
    };

    // 残留若仍生效 → 第 2 回合霸王渡江无视 60% 防御 → 伤害更高（修复前即如此）
    expect(round2Damage(false)).toBe(round2Damage(true));
  });

  it('回归护栏：回合开始前挂上的 ignore_def duration 1 仍覆盖本次行动（不能被提前清掉）', () => {
    const run = (withIgnoreDef: boolean): number => {
      const { me, ctx } = setup('main-first', 3);
      // 只留主战法，排除击势本轮自身的施加干扰（UnitState.general 只读 → 重建同面板单位）
      const solo = makeUnit({ ...me.general, passiveSkillIds: ['bawang_dujiang'] });
      ctx.myTeam[0] = solo;
      if (withIgnoreDef) {
        inflictStatus(ctx, solo, { type: 'ignore_def', rate: 0.6, duration: 1 }, 'passive', 'jishi');
      }
      actUnit(ctx, solo);
      return damages(ctx).reduce((sum, d) => sum + d.damage, 0);
    };

    // 双方 RNG 流一致（inflictStatus 不掷随机）→ 伤害差异只来自目标防御 80 → 32
    expect(run(true)).toBeGreaterThan(run(false));
  });
});
