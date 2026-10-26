/**
 * 谋略 DoT 的「策略伤害认定」两处缺口（用户 2026-10 报障 ①③）。
 *
 * 报障原文：
 *  ①「部分谋略 dot 战法无直接造成谋略伤害的 tag，导致无法触发『造成谋略伤害的战法……』的效果，
 *     如庞统无法生效宝物词条筹算的效果」；
 *  ③「谋略 dot 出伤害时却没有触发 xp 司马懿的诛杀效果」。
 *
 * 口径（用户 2026-10 拍板，勿再动摇）：**DoT 数值仍按施加那一刻冻结** —— 施法者当时的兵力/谋略、
 * 目标当时的防御/谋略、双方当时的增减伤，后续兵力与 buff 变化不影响这条已存在的 DoT。
 * 本文件只补「算不算策略伤害」的认定，且**不动**冻结口径。
 *
 * 守住四件事：
 *  ① 宝物【筹算】（`trigger_boost` + `strategySkillsOnly`）对**纯 DoT 谋略主战法**（庞统【密谋定蜀】）生效；
 *  ② 同一 boost 对**攻击类**主战法仍不生效（口径没被放宽成「所有战法」）；
 *  ③ 未雨绸缪「造成策略伤害的主动战法」判定下钻到 `random_pick` 内层的谋略 DoT；
 *  ④ 谋略 DoT 每一次跳伤都触发晋·司马懿【其徐如林】的〈诛杀〉相邻溅射，动摇（物理 DoT）不触发，
 *     施加者阵亡后不再溅射，统计计入【其徐如林】。
 */
import { describe, it, expect } from 'vitest';
import {
  dealDotDamage,
  inflictStatus,
  triggerActiveSkill,
  type CombatContext,
  type LockedCommand,
} from '../src/engine/action';
import { computeDetailedStats } from '../src/engine/stats';
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  General,
  Position,
  Skill,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function general(id: string, position: Position, patch: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 90,
    defense: 80,
    strategy: 95,
    speed: 90,
    attackRange: 5,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 11): CombatContext {
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

/** 宝物【筹算】：造成策略伤害的武将主战法发动率提高 X%（红筹算 15%） */
function chousuan(rate = 0.15): UnitState['statuses'][number] {
  return {
    type: 'trigger_boost',
    rate,
    duration: 999,
    remaining: 999,
    appliedRound: 0,
    mainSkillOnly: true,
    strategySkillsOnly: true,
    sourceSkillType: 'treasure',
    sourceSkillId: 'treasure:chousuan',
  } as unknown as UnitState['statuses'][number];
}

const triggers = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'skill_trigger') as Array<{
    skillId: string;
    baseRate: number;
    rate: number;
  }>;

const casts = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'skill_cast') as Array<{ skillId: string; recastBy?: string }>;

type DamageEv = Extract<BattleEvent, { type: 'damage' }>;
const damages = (ctx: CombatContext): DamageEv[] =>
  ctx.events.filter((e): e is DamageEv => e.type === 'damage');

/** 其徐如林光环：一类指挥按准备阶段锁定；单元级直接塞进 lockedCommands */
function qixuAura(ctx: CombatContext, casterId: string): void {
  ctx.lockedCommands.push({
    skill: SKILL_REGISTRY.qixu_rulin as CommandSkill,
    casterId,
    targets: [],
    currentRate: 1,
  } satisfies LockedCommand);
}

describe('报障 ① · 宝物【筹算】对纯 DoT 谋略主战法生效', () => {
  it('数据前提：庞统【密谋定蜀】整条战法没有 strategy_damage 段，谋略伤害全在恐慌 + 妖术诅咒里', () => {
    const s = SKILL_REGISTRY.mimou_dingshu as Extract<Skill, { type: 'active' }>;
    expect(s.output.some((o) => o.kind === 'strategy_damage')).toBe(false);
    const dots = s.output
      .filter((o) => o.kind === 'inflict_status')
      .map((o) => (o as { status: CreateStatus | CreateStatus[] }).status);
    expect(dots.some((st) => !Array.isArray(st) && st.type === 'panic')).toBe(true);
    expect(dots.some((st) => !Array.isArray(st) && st.type === 'curse')).toBe(true);
  });

  it('带筹算：密谋定蜀的判定基础率 35% → 50%（+15 个百分点）', () => {
    const caster = unit(
      general('pangtong', '中军', { mainSkillId: 'mimou_dingshu', mainSkillName: '密谋定蜀' }),
      'my'
    );
    const ctx = makeCtx([caster], [unit(general('e1', '中军'), 'enemy')]);
    caster.statuses.push(chousuan(0.15));
    triggerActiveSkill(
      ctx,
      caster,
      SKILL_REGISTRY.mimou_dingshu as Skill,
      ctx.enemyTeam,
      ctx.myTeam,
      [...ctx.myTeam, ...ctx.enemyTeam]
    );
    const t = triggers(ctx).find((e) => e.skillId === 'mimou_dingshu')!;
    expect(t.baseRate).toBe(50);
  });

  it('对照组：不带筹算仍是 35%；换成攻击类主战法时筹算不生效（口径没被放宽）', () => {
    const bare = unit(general('pangtong', '中军', { mainSkillId: 'mimou_dingshu' }), 'my');
    const ctxA = makeCtx([bare], [unit(general('e1', '中军'), 'enemy')]);
    triggerActiveSkill(
      ctxA,
      bare,
      SKILL_REGISTRY.mimou_dingshu as Skill,
      ctxA.enemyTeam,
      ctxA.myTeam,
      [...ctxA.myTeam, ...ctxA.enemyTeam]
    );
    expect(triggers(ctxA).find((e) => e.skillId === 'mimou_dingshu')!.baseRate).toBe(35);

    // 平壑拒吴 = 纯物理（攻击类）主动 35%，筹算限定「造成策略伤害的战法」→ 不得提升
    const physical = unit(general('caoren', '中军', { mainSkillId: 'pinghe_juwu' }), 'my');
    const ctxB = makeCtx([physical], [unit(general('e1', '中军'), 'enemy')]);
    physical.statuses.push(chousuan(0.15));
    triggerActiveSkill(
      ctxB,
      physical,
      SKILL_REGISTRY.pinghe_juwu as Skill,
      ctxB.enemyTeam,
      ctxB.myTeam,
      [...ctxB.myTeam, ...ctxB.enemyTeam]
    );
    expect(triggers(ctxB).find((e) => e.skillId === 'pinghe_juwu')!.baseRate).toBe(35);
  });
});

/** 未雨绸缪认得嵌在随机分支里的谋略 DoT */
describe('报障 ①附 · 未雨绸缪认得嵌在随机分支里的谋略 DoT', () => {
  it('random_pick 内层只挂燃烧（无 strategy_damage 段）→ 仍触发再发动', () => {
    const caster = unit(general('c1', '中军'), 'my');
    const foe = unit(general('e1', '中军'), 'enemy');
    const ctx = makeCtx([caster], [foe]);
    caster.statuses.push({
      type: 'repeat_strategy',
      duration: 2,
      remaining: 2,
      appliedRound: 0,
      sourceSkillType: 'active',
      sourceSkillId: 'weiyu_choumou',
    } as unknown as UnitState['statuses'][number]);

    const synthetic = {
      id: 'syn_nested_burn',
      name: '合成·嵌套燃烧',
      type: 'active',
      prepare: false,
      range: 5,
      triggerRate: 1,
      targetMode: 'group',
      targetSide: 'enemy',
      tags: ['burning'],
      output: [
        {
          kind: 'random_pick',
          count: 1,
          options: [
            [{ kind: 'inflict_status', status: { type: 'burning', duration: 1, rate: 100, growthRate: 1 } }],
          ],
        },
      ],
    } as unknown as Skill;

    triggerActiveSkill(ctx, caster, synthetic, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(casts(ctx).some((e) => e.recastBy === '未雨绸缪')).toBe(true);
  });
});

describe('报障 ③ · 谋略 DoT 跳伤触发〈诛杀〉', () => {
  function setup(seed = 5) {
    const sima = unit(general('simayi', '大营', { strategy: 150 }), 'my');
    const ally = unit(general('a1', '中军', { strategy: 120 }), 'my');
    const foes = [
      unit(general('e1', '前锋'), 'enemy'),
      unit(general('e2', '中军'), 'enemy'),
      unit(general('e3', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([sima, ally], foes, seed);
    qixuAura(ctx, 'simayi');
    // 友军给敌方中军挂恐慌（纯 DoT 谋略战法口径）
    inflictStatus(
      ctx,
      foes[1],
      { type: 'panic', duration: 2, rate: 143, growthRate: 1.5 },
      'active',
      'mimou_dingshu',
      ally.general.id
    );
    const dot = foes[1].statuses.find((s) => s.type === 'panic')! as Extract<
      UnitState['statuses'][number],
      { type: 'panic' }
    >;
    return { ctx, sima, ally, foes, dot };
  }

  it('每一跳都溅射一次：恐慌 2 回合 → 2 次〈诛杀〉，伤害事件带 subSkill 且 skillId = 其徐如林', () => {
    const { ctx, foes, dot } = setup();
    dealDotDamage(ctx, foes[1], dot);
    dealDotDamage(ctx, foes[1], dot);

    const splash = damages(ctx).filter((d) => d.skillId === 'qixu_rulin');
    expect(splash.length).toBe(2 * 2); // 2 跳 × 中军相邻 2 人
    for (const s of splash) {
      expect(s.skillName).toBe('其徐如林');
      expect(s.subSkill).toBe('诛杀');
      expect(s.damageType).toBe('strategy');
    }
  });

  it('统计计入【其徐如林】：该栏杀伤 == 溅射伤害之和（归光环施法者）', () => {
    const { ctx, sima, ally, foes, dot } = setup(9);
    dealDotDamage(ctx, foes[1], dot);
    const splash = damages(ctx).filter((d) => d.skillId === 'qixu_rulin');
    const stats = computeDetailedStats(ctx.events, [sima, ally, ...foes]);
    const row = stats.find((s) => s.unitId === 'simayi')!;
    const main = row.skills.find((s) => s.skillId === 'qixu_rulin')!;
    expect(main.damage).toBe(splash.reduce((a, d) => a + d.damage, 0));
    expect(main.damage).toBeGreaterThan(0);
  });

  it('动摇（物理 DoT）不触发〈诛杀〉', () => {
    const { ctx, foes } = setup();
    inflictStatus(
      ctx,
      foes[1],
      { type: 'unrest', duration: 2, rate: 100, sourceAttack: 100 },
      'active',
      'yaodong_src',
      'a1'
    );
    const unrest = foes[1].statuses.find((s) => s.type === 'unrest')! as Extract<
      UnitState['statuses'][number],
      { type: 'unrest' }
    >;
    dealDotDamage(ctx, foes[1], unrest);
    expect(damages(ctx).filter((d) => d.skillId === 'qixu_rulin').length).toBe(0);
  });

  it('施加者阵亡后不再溅射（DoT 本身仍走完冻结值）', () => {
    const { ctx, ally, foes, dot } = setup(13);
    const before = foes[1].troops;
    ally.alive = false;
    dealDotDamage(ctx, foes[1], dot);
    expect(damages(ctx).filter((d) => d.skillId === 'qixu_rulin').length).toBe(0);
    // 恐慌本体照常扣兵 —— 冻结值不受施加者阵亡影响
    expect(foes[1].troops).toBeLessThan(before);
  });

  it('对照：没有其徐如林光环时完全零影响', () => {
    const ally = unit(general('a1', '中军', { strategy: 120 }), 'my');
    const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '中军'), 'enemy')];
    const ctx = makeCtx([ally], foes, 21);
    inflictStatus(
      ctx,
      foes[1],
      { type: 'panic', duration: 1, rate: 143, growthRate: 1.5 },
      'active',
      'mimou_dingshu',
      ally.general.id
    );
    const dot = foes[1].statuses.find((s) => s.type === 'panic')! as Extract<
      UnitState['statuses'][number],
      { type: 'panic' }
    >;
    dealDotDamage(ctx, foes[1], dot);
    expect(damages(ctx).filter((d) => d.skillId === 'qixu_rulin').length).toBe(0);
    expect(damages(ctx).length).toBe(0);
  });
});
