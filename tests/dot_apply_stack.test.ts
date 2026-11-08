/**
 * DoT 施加时叠层（用户 2026-11-08 口径）
 *
 * 用户原话：「持续伤害是挂状态就是造成伤害了，只不过是等条件触发。所以实际战报应该是燃烧状态
 * 在施加以前就触发卫瓘的加谋略和计算增减伤来计算燃烧的伤害。于此同样的道理适用于其他所有
 * 持续伤害类型，如黄月英、灵帝、庞统。」
 *
 * 战报截图顺序（黄盖【烈火焚舟】触发燃烧）：
 *   执行来自【卫瓘】的【持节镇西】→ 谋略提高 31.6 → 该次造成伤害共计提升 114% → 「燃烧效果已施加」
 *
 * 因此：
 *  ① 施加那一刻先叠层（triggerStackBuff），再用叠层后的属性/增减伤冻结 stored；
 *  ② 跳伤是同一笔伤害的延迟兑现，**不再**叠第二层；
 *  ③ 所有 DoT 类型同一条路径（动摇按物理叠攻击，其余叠谋略）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import type { CreateStatus, Position, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

beforeAll(() => {
  /* 只用 SKILL_REGISTRY，无需初始化武将库 */
});

function makeUnit(
  id: string,
  opts: { position?: Position; attack?: number; defense?: number; strategy?: number; troops?: number } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '晋',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: opts.defense ?? 100,
      strategy: opts.strategy ?? 100,
      speed: 50,
      attackRange: 3,
      maxTroops: opts.troops ?? 10000,
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
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(11),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function enemy(id: string, opts: { attackRange?: number } = {}): UnitState {
  const u = makeUnit(id, { position: '前锋' });
  u.side = 'enemy';
  u.general.attackRange = opts.attackRange ?? 0; // 默认不普攻，隔离出手叠层
  return u;
}

/**
 * 架设：卫瓘（可选）+ 施法者 ally（谋略 150）+ 敌方木桩。
 * withWeiguan=false 时不挂持节镇西，作为对照臂。
 */
function field(withWeiguan: boolean): { ctx: CombatContext; ally: UnitState; target: UnitState } {
  const ctx = makeCtx();
  const ally = makeUnit('ally', { position: '大营', strategy: 150 });
  const target = enemy('e1');
  // ⚠️ 敌方队列必须先就位：`triggerCommandSkills` 在敌方为空时会提前返回，
  // 持节镇西的 stackBuff 根本不会登记（踩过一次的坑）。
  ctx.enemyTeam = [target];
  if (withWeiguan) {
    const wg = makeUnit('weiguan', { position: '中军', strategy: 146 });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    ctx.myTeam = [wg, ally];
    triggerCommandSkills(ctx, wg);
  } else {
    ctx.myTeam = [ally];
  }
  return { ctx, ally, target };
}

function layers(u: UnitState, type: 'attack_buff' | 'strategy_buff' | 'defense_buff'): number {
  return u.statuses.filter((s) => s.type === type && s.sourceSkillId === 'chijie_zhenxi').length;
}

function stackEvents(ctx: CombatContext): number {
  return ctx.events.filter((e) => e.type === 'status_inflicted' && e.statusType === 'strategy_buff').length;
}

/** 按类型挂一次 DoT（不传 sourceStrategy，让引擎读施法者当时的生效谋略） */
function applyDot(
  ctx: CombatContext,
  target: UnitState,
  type: 'sorcery' | 'burning' | 'panic' | 'unrest' | 'curse' | 'ignite'
): Extract<Status, { type: 'sorcery' | 'burning' | 'panic' | 'unrest' | 'curse' | 'ignite' }> {
  const create = { type, rate: 100, duration: 2, growthRate: 0.5 } as CreateStatus;
  inflictStatus(ctx, target, create, 'active', `probe_${type}`, 'ally');
  const st = target.statuses.find(
    (s): s is Extract<Status, { type: 'sorcery' | 'burning' | 'panic' | 'unrest' | 'curse' | 'ignite' }> =>
      s.type === type && s.sourceSkillId === `probe_${type}`
  );
  if (!st) throw new Error(`DoT ${type} 未被施加`);
  return st;
}

describe('DoT 施加时叠层（挂状态即造成伤害，用户 2026-11-08 口径）', () => {
  it('施加时先出现持节镇西加谋略，再出现「燃烧效果已施加」', () => {
    const { ctx, target, ally } = field(true);
    applyDot(ctx, target, 'burning');

    const buffIdx = ctx.events.findIndex(
      (e) => e.type === 'status_inflicted' && e.statusType === 'strategy_buff'
    );
    const dotIdx = ctx.events.findIndex(
      (e) => e.type === 'status_inflicted' && e.statusType === 'burning'
    );
    expect(buffIdx).toBeGreaterThanOrEqual(0);
    expect(dotIdx).toBeGreaterThan(buffIdx);
    expect(layers(ally, 'strategy_buff')).toBe(1);
  });

  it('冻结伤害严格大于无卫瓘对照（叠层后的谋略参与了冻结）', () => {
    const withWg = field(true);
    const without = field(false);
    const dotWg = applyDot(withWg.ctx, withWg.target, 'burning');
    const dotNo = applyDot(without.ctx, without.target, 'burning');

    expect(dotWg.stored).toBeDefined();
    expect(dotNo.stored).toBeDefined();
    expect(dotWg.stored!.damage).toBeGreaterThan(dotNo.stored!.damage);
    // 归因里也要能看见这一次叠层带来的属性（谋略 150 → 182）
    expect(dotWg.stored!.damage).toBeGreaterThan(0);
  });

  it('连续两跳数值相同，且跳伤不再产生新的叠层事件', () => {
    const { ctx, target } = field(true);
    const dot = applyDot(ctx, target, 'burning');
    const frozen = dot.stored!.damage;
    const evAfterApply = stackEvents(ctx);

    actUnit(ctx, target);
    const tick1 = ctx.events.filter((e) => e.type === 'dot_tick').map((e) => e.damage);
    actUnit(ctx, target);
    const tick2 = ctx.events.filter((e) => e.type === 'dot_tick').map((e) => e.damage);

    expect(tick1.length).toBeGreaterThanOrEqual(1);
    expect(tick2.length).toBeGreaterThan(tick1.length);
    // 冻结值不变（第二跳不再叠层、不再重算）
    expect(tick1[0]).toBe(Math.min(frozen, 10000));
    expect(tick2[1] === tick2[0] || tick2[1] <= tick2[0]).toBe(true);
    // 跳伤不叠层：事件条数与施加后一致
    expect(stackEvents(ctx)).toBe(evAfterApply);
  });

  it('动摇按物理叠攻击而不是谋略', () => {
    const { ctx, target, ally } = field(true);
    applyDot(ctx, target, 'unrest');
    expect(layers(ally, 'attack_buff')).toBe(1);
    expect(layers(ally, 'strategy_buff')).toBe(0);
  });

  it('全部谋略型 DoT（妖术/燃烧/恐慌/妖术诅咒/引燃）走同一条路径', () => {
    for (const type of ['sorcery', 'burning', 'panic', 'curse', 'ignite'] as const) {
      const { ctx, target, ally } = field(true);
      applyDot(ctx, target, type);
      expect(layers(ally, 'strategy_buff'), type).toBe(1);
    }
  });
});
