/**
 * 烈火焚舟（黄盖·追击）完整机制测试（v0.10.2）
 *  1. 追击穿插：连击状态下 普攻→追击→普攻→追击（追击在每次普攻命中后立即判定）
 *  2. 普通施加：普攻后使目标陷入燃烧（伤害率 150%，受谋略），持续 2 回合
 *  3. 引爆剩余燃烧：目标已处于「烈火焚舟」的燃烧状态时——
 *     剩余 N 回合 → 立即结算 N 次燃烧伤害并移除该燃烧；
 *     随后使目标及其相邻单位陷入更高倍率（270%，受谋略）、持续 1 回合的燃烧状态
 *  4. 引爆只针对烈火焚舟造成的燃烧（其他战法的燃烧不引爆）
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, opts: { position?: Position; speed?: number; strategy?: number; attackRange?: number; attack?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: 100,
      strategy: opts.strategy ?? 80,
      speed: opts.speed ?? 50,
      attackRange: opts.attackRange ?? 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 黄盖（前锋，攻击距离 1 → 只够到敌方前锋，目标选择确定）+ 敌军三人 */
function field(): { ctx: CombatContext; huanggai: UnitState; e1: UnitState; e2: UnitState; e3: UnitState } {
  const ctx = makeCtx();
  const huanggai = makeUnit('huanggai', { position: '前锋', attackRange: 1, attack: 100 });
  huanggai.general.pursuitSkillIds = ['liehuo_fenzhou'];
  ctx.myTeam = [huanggai];
  const e1 = makeUnit('e1', { position: '前锋' });
  const e2 = makeUnit('e2', { position: '中军' });
  const e3 = makeUnit('e3', { position: '大营' });
  for (const e of [e1, e2, e3]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, huanggai, e1, e2, e3 };
}

const liehuoCasts = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'liehuo_fenzhou');
const liehuoDotTicks = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'dot_tick' }> =>
      e.type === 'dot_tick' && e.skillId === 'liehuo_fenzhou' && e.casterId === 'huanggai'
  );
const liehuoBurn = (u: UnitState) =>
  u.statuses.find((s) => s.type === 'burning' && s.sourceSkillId === 'liehuo_fenzhou') as
    | Extract<Status, { type: 'burning' }>
    | undefined;

/** 预挂烈火焚舟燃烧（黄盖造成）：remaining 回合、伤害率 rate（百分比整数，如 150 = 150%） */
function preApplyBurn(u: UnitState, remaining: number, rate = 150): void {
  u.statuses.push({
    type: 'burning',
    remaining,
    rate,
    sourceStrategy: 80,
    appliedRound: 0,
    sourceSkillType: 'pursuit',
    sourceSkillId: 'liehuo_fenzhou',
    sourceUnitId: 'huanggai',
  });
}

describe('追击穿插：连击状态普攻 → 追击 → 普攻 → 追击', () => {
  it('连击 2 次普攻各触发一次追击，顺序为 普攻→追击→普攻→追击', () => {
    const { ctx, huanggai, e1 } = field();
    inflictStatus(ctx, huanggai, { type: 'combo', duration: 1 }, 'command', 'xianqu_tuji');

    actUnit(ctx, huanggai);

    const hits = ctx.events
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.type === 'attack_hit' && x.e.sourceId === 'huanggai')
      .map((x) => x.i);
    const casts = ctx.events
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.type === 'skill_cast' && x.e.skillId === 'liehuo_fenzhou')
      .map((x) => x.i);
    expect(hits.length).toBe(2);
    expect(casts.length).toBe(2);
    expect(hits[0]).toBeLessThan(casts[0]);
    expect(casts[0]).toBeLessThan(hits[1]);
    expect(hits[1]).toBeLessThan(casts[1]);
    // 两次普攻都命中同一目标（攻击距离 1 只有前锋可打）
    expect(ctx.events.filter((e) => e.type === 'attack_hit' && e.targetId === e1.general.id).length).toBe(2);
  });
});

describe('烈火焚舟（黄盖·追击：燃烧 + 引爆剩余燃烧）', () => {
  it('首次施加：普攻后使目标陷入 2 回合燃烧（伤害率 150%，谋略 80 → 150%）', () => {
    const { ctx, huanggai, e1 } = field();
    actUnit(ctx, huanggai);

    expect(liehuoCasts(ctx).length).toBe(1);
    const burn = liehuoBurn(e1);
    expect(burn).toBeTruthy();
    expect(burn!.remaining).toBe(2);
    expect(burn!.rate).toBe(150); // 150%（引擎 DoT rate 为百分比整数）
    expect(burn!.sourceUnitId).toBe('huanggai');
  });

  it('连击第二刀引爆第一刀燃烧：剩余 2 回合 → 立即结算 2 次燃烧伤害并移除，目标及相邻单位挂 270% 1 回合燃烧', () => {
    const { ctx, huanggai, e1, e2, e3 } = field();
    inflictStatus(ctx, huanggai, { type: 'combo', duration: 1 }, 'command', 'xianqu_tuji');

    actUnit(ctx, huanggai);

    // 第一刀施加 2 回合燃烧，第二刀引爆：共 2 次引爆燃烧伤害
    expect(liehuoCasts(ctx).length).toBe(2);
    const ticks = liehuoDotTicks(ctx);
    expect(ticks.length).toBe(2);
    expect(ticks.every((t) => t.targetId === e1.general.id)).toBe(true);

    // 原燃烧已移除，目标挂上新燃烧：270%（谋略 80 → 270%）、持续 1 回合
    const burn = liehuoBurn(e1);
    expect(burn).toBeTruthy();
    expect(burn!.remaining).toBe(1);
    expect(burn!.rate).toBe(270);
    // 相邻单位（中军 e2）同样挂上 270% 1 回合燃烧；非相邻大营 e3 没有
    const burn2 = liehuoBurn(e2);
    expect(burn2).toBeTruthy();
    expect(burn2!.remaining).toBe(1);
    expect(burn2!.rate).toBe(270);
    expect(liehuoBurn(e3)).toBeUndefined();
  });

  it('引爆剩余 1 回合燃烧：只结算 1 次燃烧伤害', () => {
    const { ctx, huanggai, e1 } = field();
    preApplyBurn(e1, 1);
    actUnit(ctx, huanggai);

    expect(liehuoDotTicks(ctx).length).toBe(1);
    const burn = liehuoBurn(e1);
    expect(burn).toBeTruthy();
    expect(burn!.remaining).toBe(1);
    expect(burn!.rate).toBe(270);
  });

  it('引爆只针对烈火焚舟造成的燃烧：其他战法的燃烧不引爆，正常挂 2 回合燃烧', () => {
    const { ctx, huanggai, e1 } = field();
    // 其他战法（如火光蹀影）给 e1 挂的燃烧
    e1.statuses.push({
      type: 'burning',
      remaining: 2,
      rate: 1.0,
      sourceStrategy: 80,
      appliedRound: 0,
      sourceSkillType: 'active',
      sourceSkillId: 'other_burn',
      sourceUnitId: 'someone',
    });

    actUnit(ctx, huanggai);

    // 无引爆伤害（没有来自烈火焚舟的 dot_tick）
    expect(liehuoDotTicks(ctx).length).toBe(0);
    // e1 上两个燃烧共存：烈火焚舟的正常 2 回合 150% 燃烧 + 其他战法的燃烧
    const others = e1.statuses.filter((s) => s.type === 'burning');
    expect(others.length).toBe(2);
    const own = liehuoBurn(e1);
    expect(own).toBeTruthy();
    expect(own!.remaining).toBe(2);
    expect(own!.rate).toBe(150);
  });

  it('引爆结算的燃烧伤害计入黄盖烈火焚舟战法杀伤（dot_tick 归因施法者）', () => {
    const { ctx, huanggai, e1 } = field();
    preApplyBurn(e1, 2);
    actUnit(ctx, huanggai);

    const ticks = liehuoDotTicks(ctx);
    expect(ticks.length).toBe(2);
    for (const t of ticks) {
      expect(t.casterId).toBe('huanggai');
      expect(t.dotType).toBe('burning');
      expect(t.damage).toBeGreaterThan(0);
    }
  });

  it('燃烧伤害吃到挂上时的增伤（挂上时结算【伤害提升合计】）：黄盖带造成侧增伤 → 每跳更高', () => {
    // 对照：黄盖无增伤
    const ctrlCtx = field().ctx;
    const ctrlHuanggai = ctrlCtx.myTeam[0];
    actUnit(ctrlCtx, ctrlHuanggai);
    const ctrlE1 = ctrlCtx.enemyTeam[0];
    actUnit(ctrlCtx, ctrlE1);
    const ctrlTick = liehuoDotTicks(ctrlCtx)[0];
    expect(ctrlTick, '应有燃烧跳伤').toBeTruthy();

    // 黄盖带造成伤害提高 40%（巾帼战阵）后再普攻挂燃烧：挂上时结算吃到增伤
    const { ctx, huanggai, e1 } = field();
    inflictStatus(ctx, huanggai, { type: 'damage_boost', rate: 0.4, duration: 3, direction: 'caused' }, 'active', 'jinguo_zhanzhen', 'guanyinping');
    actUnit(ctx, huanggai); // 普攻 → 烈火焚舟挂 2 回合燃烧（挂上时结算）
    expect(liehuoBurn(e1)).toBeTruthy();
    actUnit(ctx, e1); // e1 行动触发第一跳
    const tick = liehuoDotTicks(ctx)[0];
    expect(tick, '应有燃烧跳伤').toBeTruthy();
    // 归因携带挂上时的造成侧增伤来源（施法者 = 巾帼战阵的施法者关银屏）
    expect(tick!.modifiers!.caused).toEqual([
      { unitId: 'guanyinping', skillId: 'jinguo_zhanzhen', skillName: '巾帼战阵', rate: 0.4, direction: 'caused' },
    ]);
    expect(tick!.damage).toBeGreaterThan(ctrlTick!.damage);
  });
});
