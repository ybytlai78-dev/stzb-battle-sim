/**
 * DoT 挂上时结算（滞后触发）测试（v0.10.3）
 *  规则（用户补充）：DoT（妖术/燃烧/恐慌）伤害在「挂上时」结算，但滞后触发——
 *    挂上时计算【伤害提升合计】（造成侧 + 受到侧增伤）与施法者兵力、目标防御/谋略、减伤，
 *    冻结每次跳伤；之后每次行动触发直接打出冻结值（仅按目标当前兵力截断）。
 *  修复：原实现 DoT mult=1 吃不到增伤（且兵力按目标行动时实时取值）。
 *  数据：施法者兵力按调研公式 calcStrategyDamage 的 attacker.troops（dateyuan/战斗伤害公式调研.md 3.5）。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, opts: { position?: Position; speed?: number; strategy?: number; attack?: number; defense?: number; troops?: number } = {}): UnitState {
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
      defense: opts.defense ?? 100,
      strategy: opts.strategy ?? 80,
      speed: opts.speed ?? 50,
      attackRange: 3,
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
    troops: opts.troops ?? 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
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

/** 黄盖（施法者，谋略 100）+ 敌军 e1（前锋）/ e2（中军） */
function field(): { ctx: CombatContext; huanggai: UnitState; e1: UnitState; e2: UnitState } {
  const ctx = makeCtx();
  const huanggai = makeUnit('huanggai', { position: '前锋', strategy: 100 });
  ctx.myTeam = [huanggai];
  const e1 = makeUnit('e1', { position: '前锋', defense: 80 });
  const e2 = makeUnit('e2', { position: '中军' });
  for (const e of [e1, e2]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2];
  return { ctx, huanggai, e1, e2 };
}

type DotEvent = Extract<BattleEvent, { type: 'dot_tick' }>;
const e1Ticks = (ctx: CombatContext): DotEvent[] =>
  ctx.events.filter((e): e is DotEvent => e.type === 'dot_tick' && e.targetId === 'e1');

/** 标准流程：黄盖给 e1 挂 2 回合 100% 燃烧，然后 e1 行动触发第一跳 */
function applyBurnAndTick(f: ReturnType<typeof field>): DotEvent {
  const { ctx, e1 } = f;
  inflictStatus(ctx, e1, { type: 'burning', rate: 100, duration: 2, growthRate: 0.5, sourceStrategy: 100 }, 'active', 'test', 'huanggai');
  ctx.currentRound = 1;
  actUnit(ctx, e1);
  const tick = e1Ticks(ctx)[0];
  expect(tick, '应有 DoT 跳伤事件').toBeTruthy();
  return tick;
}

describe('DoT 挂上时结算（滞后触发）', () => {
  it('挂上时按增伤合计结算：造成侧 + 受到侧增伤均吃到，且每跳相同（滞后触发）', () => {
    const f = field();
    // 黄盖造成伤害提高 40%（巾帼战阵）、e1 受到伤害提高 30%（神兵天降）
    inflictStatus(f.ctx, f.huanggai, { type: 'damage_boost', rate: 0.4, duration: 3, direction: 'caused' }, 'active', 'jinguo_zhanzhen', 'guanyinping');
    inflictStatus(f.ctx, f.e1, { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'taken' }, 'command', 'shenbing_tianjiang', 'lvmeng');

    const tick = applyBurnAndTick(f);
    // 增伤归因在挂上时冻结：caused（巾帼战阵，施法者关银屏）+ taken（神兵天降，施法者吕蒙）
    expect(tick.modifiers!.caused).toEqual([
      { unitId: 'guanyinping', skillId: 'jinguo_zhanzhen', skillName: '巾帼战阵', rate: 0.4, direction: 'caused' },
    ]);
    expect(tick.modifiers!.taken).toEqual([
      { unitId: 'lvmeng', skillId: 'shenbing_tianjiang', skillName: '神兵天降', rate: 0.3, direction: 'taken' },
    ]);

    // 对照：无增伤 → 伤害更低（修复「DoT 吃不到增伤」）
    const ctrl = applyBurnAndTick(field());
    expect(tick.damage).toBeGreaterThan(ctrl.damage);

    // 滞后触发：第 2 回合再跳一次，伤害与第 1 跳相同（挂上时冻结，不再实时计算）
    f.ctx.currentRound = 2;
    actUnit(f.ctx, f.e1);
    const ticks = e1Ticks(f.ctx);
    expect(ticks.length).toBe(2);
    expect(ticks[1].damage).toBe(ticks[0].damage);
  });

  it('挂上后施加的增伤不影响已结算的 DoT（增伤冻结）', () => {
    const f = field();
    const tick = applyBurnAndTick(f);
    // 挂上后再给黄盖 40% 增伤：不影响已挂上的燃烧
    inflictStatus(f.ctx, f.huanggai, { type: 'damage_boost', rate: 0.4, duration: 3, direction: 'caused' }, 'active', 'jinguo_zhanzhen', 'guanyinping');
    f.ctx.currentRound = 2;
    actUnit(f.ctx, f.e1);
    const ticks = e1Ticks(f.ctx);
    expect(ticks.length).toBe(2);
    expect(ticks[1].damage).toBe(tick.damage);
  });

  it('挂上后施加的减伤不影响已结算的 DoT（减伤冻结）', () => {
    const f = field();
    const tick = applyBurnAndTick(f);
    // 挂上后再给 e1 减伤 30%（避其锋芒）：不影响已挂上的燃烧
    inflictStatus(f.ctx, f.e1, { type: 'damage_reduce', rate: 0.3, duration: 3 }, 'command', 'biqi_fengmang', 'e2');
    f.ctx.currentRound = 2;
    actUnit(f.ctx, f.e1);
    const ticks = e1Ticks(f.ctx);
    expect(ticks.length).toBe(2);
    expect(ticks[1].damage).toBe(tick.damage);
  });

  it('挂上后的兵力变化不影响已结算的 DoT（兵力冻结：按挂上时施法者兵力）', () => {
    const f = field();
    const tick = applyBurnAndTick(f);
    // 挂上后施法者（黄盖）兵力大幅下降：已结算的每跳伤害不变
    f.huanggai.troops = 3000;
    f.ctx.currentRound = 2;
    actUnit(f.ctx, f.e1);
    const ticks = e1Ticks(f.ctx);
    expect(ticks.length).toBe(2);
    expect(ticks[1].damage).toBe(tick.damage);
  });

  it('DoT 兵力基础按施法者（挂上时）兵力计算，与目标兵力无关', () => {
    // 施法者 10000 兵，目标 10000 兵 vs 目标 2000 兵 → 每跳伤害相同（调研公式 attacker.troops）
    const fA = field();
    const tickA = applyBurnAndTick(fA);

    const fB = field();
    fB.e1.troops = 2000;
    const tickB = applyBurnAndTick(fB);

    expect(tickB.damage).toBe(tickA.damage);
  });
});
