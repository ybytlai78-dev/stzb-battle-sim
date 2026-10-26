/**
 * 将门虎女（张姬主战法）契约测试（2026-10-24）
 *  背景：用户报障「将门虎女后段『受到攻击伤害时 80% 几率引发一次动摇效果（伤害率 60%）』
 *  既不生效、详情战报也没有描述」——根因是数据层从未建模（`src/data/skills.ts` 原注释自认「暂未建模」），
 *  且引擎没有「受攻击伤害按几率触发动摇跳伤」的承载字段（`triggerOnBasic` 只吃普攻且无几率）。
 *
 *  口径（用户 2026-10-24 拍板）：
 *   ① 受击**立即结算一次动摇逃兵**（不是挂持续 DoT）——1 回合窗口内每次受到攻击伤害独立判 80%；
 *   ② 官方未写「最多生效 N 次」⇒ **不消耗次数**，只受 duration 窗口约束；
 *   ③ 「攻击伤害」= 物理伤害且非 DoT 逃兵（动摇跳伤自身不得回灌本钩子）。
 *  数值一并对齐包内 200094 满级：主伤害 200%、围困 2 回合、动摇 60%。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, applyDamage, inflictStatus, triggerActiveSkill, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import heroesJson from '../web/data/heroes.json';

function makeUnit(
  id: string,
  opts: {
    side?: 'my' | 'enemy';
    position?: Position;
    attack?: number;
    defense?: number;
    troops?: number;
    morale?: number;
  } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '蜀',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 200,
      defense: opts.defense ?? 80,
      strategy: 60,
      speed: 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: opts.morale ?? 100,
    },
    side: opts.side ?? 'my',
    troops: opts.troops ?? 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(seed = 7): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 施法者（我方前锋，攻击 200）+ 目标（敌方前锋，防御 80） */
function field(opts: { morale?: number } = {}) {
  const ctx = makeCtx();
  const caster = makeUnit('caster', { morale: opts.morale ?? 100 });
  const enemy = makeUnit('enemy', { side: 'enemy', defense: 80 });
  ctx.myTeam = [caster];
  ctx.enemyTeam = [enemy];
  return { ctx, caster, enemy };
}

type DotEvent = Extract<BattleEvent, { type: 'dot_tick' }>;
const dotTicks = (ctx: CombatContext): DotEvent[] =>
  ctx.events.filter((e): e is DotEvent => e.type === 'dot_tick');
const triggers = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'skill_trigger') as Extract<BattleEvent, { type: 'skill_trigger' }>[];

/** 挂一条受击触发动摇（对齐数据层：60% 逃兵 / 80% 触发 / 1 回合窗口） */
function inflictHurtUnrest(
  ctx: CombatContext,
  target: UnitState,
  override: { rate?: number; triggerRate?: number; duration?: number } = {}
) {
  inflictStatus(
    ctx,
    target,
    {
      type: 'unrest',
      duration: override.duration ?? 1,
      rate: override.rate ?? 60,
      onHurt: true,
      triggerRate: override.triggerRate ?? 1,
    },
    'active',
    'jiangmen_hunv',
    'caster'
  );
}

type ActiveSkillLike = Extract<Skill, { type: 'active' }>;

const skill = (id: string): ActiveSkillLike => {
  const s = SKILL_REGISTRY[id];
  expect(s, `战法 ${id} 应存在`).toBeTruthy();
  return s as ActiveSkillLike;
};

describe('将门虎女（张姬）', () => {
  it('数据层：主伤害 200% + 围困 2 回合 + 受击触发动摇 60% / 触发率 80% / 窗口 1 回合', () => {
    const s = skill('jiangmen_hunv');
    expect(s.type).toBe('active');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBeCloseTo(0.35, 5);
    expect(s.targetMode).toBe('group');
    expect(s.targetSide).toBe('enemy');
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'siege', 'unrest']));

    const output = s.output ?? [];
    const dmg = output.find((o) => o.kind === 'physical_damage');
    expect(dmg, '第一段应为攻击伤害').toBeTruthy();
    expect((dmg as { rate: number }).rate).toBeCloseTo(200, 5);

    const statuses = output
      .filter((o) => o.kind === 'inflict_status')
      .map((o) => (o as { status: Record<string, unknown> }).status);
    const siege = statuses.find((st) => st.type === 'siege');
    expect(siege, '第二段应为围困').toBeTruthy();
    expect(siege!.duration).toBe(2);

    const unrest = statuses.find((st) => st.type === 'unrest');
    expect(unrest, '第三段应为动摇（此前完全缺失）').toBeTruthy();
    expect(unrest!.rate).toBeCloseTo(60, 5);
    expect(unrest!.duration).toBe(1);
    expect(unrest!.onHurt, '必须是受击触发变体，否则不会在受击时结算').toBe(true);
    expect(unrest!.triggerRate).toBeCloseTo(0.8, 5);
  });

  it('数据层：武将库描述与包内 200094 同口径（防旧版 190%/75%/35% 回退）', () => {
    const hero = (heroesJson as { id: string; skillDesc: string }[]).find((h) => h.id === 'h358');
    expect(hero, 'h358 = 张姬').toBeTruthy();
    const desc = hero!.skillDesc;
    expect(desc).toContain('伤害率200.0%');
    expect(desc).toContain('80.0%的几率');
    expect(desc).toContain('伤害率60.0%');
    expect(desc).not.toContain('伤害率190.0%');
    expect(desc).not.toContain('75.0%的几率引发');
  });

  it('状态施加：detail 写明「受击触发（攻击伤害 80% 几率）」，且不按行动跳伤', () => {
    const { ctx, enemy } = field();
    inflictHurtUnrest(ctx, enemy, { triggerRate: 0.8 });
    const inflicted = ctx.events.find((e) => e.type === 'status_inflicted') as
      | Extract<BattleEvent, { type: 'status_inflicted' }>
      | undefined;
    expect(inflicted?.statusType).toBe('unrest');
    expect(inflicted?.detail).toContain('受击触发（攻击伤害 80% 几率）');
    expect(inflicted?.detail).toContain('持续 1 回合');

    // 携带者自己行动：受击触发变体绝不在行动时跳伤
    actUnit(ctx, enemy);
    expect(dotTicks(ctx), '行动阶段不应出现动摇跳伤').toHaveLength(0);
  });

  it('触发：受到攻击伤害（物理）即按几率结算一次动摇逃兵，伤害按物理口径', () => {
    const { ctx, caster, enemy } = field();
    inflictHurtUnrest(ctx, enemy);
    applyDamage(ctx, enemy, 500, caster, 'physical', 'skill');

    const ticks = dotTicks(ctx);
    expect(ticks, '应出现 1 次动摇跳伤').toHaveLength(1);
    expect(ticks[0].dotType).toBe('unrest');
    expect(ticks[0].targetId).toBe('enemy');
    expect(ticks[0].skillId).toBe('jiangmen_hunv');
    expect(ticks[0].casterId).toBe('caster');
    expect(ticks[0].damage).toBeGreaterThan(0);
    // 动摇 = 物理 DoT：三部分拆解自洽（兵力基础 ×1/3、攻击基础 攻击×0.4）
    expect(ticks[0].breakdown.troopBase).toBeGreaterThan(0);
    expect(ticks[0].damage).toBe(
      ticks[0].breakdown.troopBase + ticks[0].breakdown.base + ticks[0].breakdown.main
    );
  });

  it('触发边界：策略伤害与 DoT 逃兵都不触发（「攻击伤害」限定）', () => {
    const { ctx, caster, enemy } = field();
    inflictHurtUnrest(ctx, enemy);

    applyDamage(ctx, enemy, 400, caster, 'strategy', 'skill');
    expect(dotTicks(ctx), '策略伤害不触发').toHaveLength(0);

    // DoT 逃兵自身不得回灌本钩子（否则一次受击会把窗口内的判定全部吃掉）
    applyDamage(ctx, enemy, 400, caster, 'physical', 'skill', undefined, { dotType: 'unrest' });
    expect(dotTicks(ctx), 'DoT 跳伤不触发').toHaveLength(0);

    applyDamage(ctx, enemy, 400, caster, undefined, 'skill');
    expect(dotTicks(ctx), '缺省物理口径（damageType 未填）应触发').toHaveLength(1);
  });

  it('不消耗次数：窗口内每次受攻击伤害都独立判定，状态不因触发而递减', () => {
    const { ctx, caster, enemy } = field();
    inflictHurtUnrest(ctx, enemy);
    for (let i = 0; i < 3; i++) applyDamage(ctx, enemy, 300, caster, 'physical', 'skill');

    expect(dotTicks(ctx), '三次受击各跳 1 次').toHaveLength(3);
    const status = enemy.statuses.find((s) => s.type === 'unrest') as
      | Extract<UnitState['statuses'][number], { type: 'unrest' }>
      | undefined;
    expect(status, '标记应仍保留（官方未写「最多生效 N 次」）').toBeTruthy();
    expect(status!.remaining, 'remaining 只由窗口递减，不因触发扣减').toBe(1);
    expect(status!.onHurt).toBe(true);
  });

  it('触发率走施法者士气修正：80% × 1.12（120 士气）= 90%', () => {
    const { ctx, enemy } = field({ morale: 120 });
    inflictHurtUnrest(ctx, enemy, { triggerRate: 0.8 });
    applyDamage(ctx, enemy, 300, ctx.myTeam[0], 'physical', 'skill');

    const judged = triggers(ctx);
    expect(judged, '每次受击都应有判定事件').toHaveLength(1);
    expect(judged[0].skillId).toBe('jiangmen_hunv');
    expect(judged[0].targetId).toBe('enemy');
    expect(judged[0].baseRate).toBe(80);
    expect(judged[0].rate).toBe(90);
    expect(judged[0].morale).toBe(120);
  });

  it('窗口到期：duration 1 → 携带者本次行动结束后移除，之后受击不再触发', () => {
    const { ctx, caster, enemy } = field();
    inflictHurtUnrest(ctx, enemy);
    expect(enemy.statuses.some((s) => s.type === 'unrest')).toBe(true);

    actUnit(ctx, enemy);
    expect(enemy.statuses.some((s) => s.type === 'unrest'), '1 回合窗口应在行动结束时移除').toBe(false);

    const before = dotTicks(ctx).length;
    applyDamage(ctx, enemy, 300, caster, 'physical', 'skill');
    expect(dotTicks(ctx).length, '窗口过期后不再触发').toBe(before);
  });

  it('端到端：真实发动将门虎女 → 三段落齐备（伤害 / 围困 / 受击触发动摇）', () => {
    const { ctx, caster, enemy } = field();
    const s = skill('jiangmen_hunv');
    let cast = false;
    for (let i = 0; i < 80 && !cast; i++) {
      const before = ctx.events.length;
      triggerActiveSkill(ctx, caster, s, [enemy], [caster], [enemy]);
      cast = ctx.events
        .slice(before)
        .some((e) => e.type === 'skill_trigger' && e.skillId === 'jiangmen_hunv' && e.success);
    }
    expect(cast, '35% 发动率在 80 次内应至少成功一次').toBe(true);

    const inflicted = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    const types = inflicted.map((e) => e.statusType);
    expect(types, '围困与动摇都应落下').toEqual(expect.arrayContaining(['siege', 'unrest']));
    expect(JSON.stringify(inflicted), '动摇 detail 应可读').toContain('受击触发');
    expect(enemy.statuses.some((st) => st.type === 'unrest')).toBe(true);

    // 真实路径下受击也要能跳伤
    const before = dotTicks(ctx).length;
    applyDamage(ctx, enemy, 300, caster, 'physical', 'skill');
    expect(dotTicks(ctx).length).toBe(before + 1);
  });
});
