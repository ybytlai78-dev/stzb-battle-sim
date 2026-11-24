/**
 * 减伤「受到的所有伤害降低」与限定伤害类型的冲突口径（用户 2026-11-24 报障）。
 *
 * 现场：于禁【当敌制决】是「受到的所有伤害降低 50%」（`damage_reduce` 不限定 `damageType`），
 * 【一夫当关】是「受到的攻击伤害降低」（`damageType: 'physical'`）—— 模拟器里两者被当成两条
 * 不同分类直接相加（物理伤害吃 100%，`buffMult` 被压到下限）。
 *
 * 口径（用户原话）：「描述为受到的所有伤害降低的语句其实是受到的攻击伤害降低 + 受到的谋略伤害
 * 降低，所以应该冲突」。实现 = `classKeysConflict` 把「全域」与限定类型按同类处理，
 * `inflictStatus` 里再按**伤害类型维拆分**（交集维取较高、另一维保留全域原值），
 * 不整条替换，否则被顶掉一侧的另一维减伤会一起消失。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, statusMatchesHit } from '../src/engine/action';
import type { CombatContext, DamageHitContext } from '../src/engine/action';
import type { CreateStatus, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '魏',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
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
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const PHYS: DamageHitContext = { damageSource: 'skill', damageType: 'physical' };
const STRAT: DamageHitContext = { damageSource: 'skill', damageType: 'strategy' };

/** 按 hit 过滤后该单位吃到多少减伤（等价于 sumReduce 的 damage_reduce 部分） */
function reduceFor(u: UnitState, hit: DamageHitContext): number {
  return u.statuses
    .filter((s) => s.type === 'damage_reduce')
    .filter((s) => statusMatchesHit(s, hit))
    .reduce((sum, s) => sum + (s.type === 'damage_reduce' ? s.rate : 0), 0);
}

const allReduce = (rate: number): CreateStatus => ({ type: 'damage_reduce', rate, duration: 3 });
const physReduce = (rate: number): CreateStatus => ({ type: 'damage_reduce', rate, duration: 3, damageType: 'physical' });
const stratReduce = (rate: number): CreateStatus => ({ type: 'damage_reduce', rate, duration: 3, damageType: 'strategy' });

describe('「受到的所有伤害降低」与限定伤害类型的减伤冲突', () => {
  it('于禁全域 50% + 一夫当关受攻击 50%：不再叠加，物理/策略各 50%', () => {
    const ctx = makeCtx();
    const u = makeUnit('yu_jin');
    inflictStatus(ctx, u, allReduce(0.5), 'command', 'dangdi_zhijue');
    inflictStatus(ctx, u, physReduce(0.5), 'command', 'yifudangguan');

    // 两条实例：攻击维 + 策略维，各 0.5（不再是「全域 0.5 与攻击 0.5 相加 = 1.0」）
    expect(u.statuses.filter((s) => s.type === 'damage_reduce')).toHaveLength(2);
    expect(reduceFor(u, PHYS)).toBeCloseTo(0.5, 10);
    expect(reduceFor(u, STRAT)).toBeCloseTo(0.5, 10);
    expect(ctx.events.some((e) => e.type === 'status_conflict' && 'statusType' in e && e.statusType === 'damage_reduce')).toBe(true);
  });

  it('顺序反转（先一夫当关、后于禁）：结果相同，策略维不会丢', () => {
    const ctx = makeCtx();
    const u = makeUnit('yu_jin_2');
    inflictStatus(ctx, u, physReduce(0.5), 'command', 'yifudangguan');
    inflictStatus(ctx, u, allReduce(0.5), 'command', 'dangdi_zhijue');

    expect(reduceFor(u, PHYS)).toBeCloseTo(0.5, 10);
    expect(reduceFor(u, STRAT)).toBeCloseTo(0.5, 10);
  });

  it('交集维取较高，另一维保留全域原值（全域 50% + 受攻击 95% → 物理 95% / 策略 50%）', () => {
    const ctx = makeCtx();
    const u = makeUnit('mix');
    inflictStatus(ctx, u, allReduce(0.5), 'command', 'dangdi_zhijue');
    inflictStatus(ctx, u, physReduce(0.95), 'command', 'yifudangguan');
    expect(reduceFor(u, PHYS)).toBeCloseTo(0.95, 10);
    expect(reduceFor(u, STRAT)).toBeCloseTo(0.5, 10);

    // 反向：先高值限定、后全域 50% —— 物理仍 95%，策略 50%
    const ctx2 = makeCtx();
    const u2 = makeUnit('mix2');
    inflictStatus(ctx2, u2, physReduce(0.95), 'command', 'yifudangguan');
    inflictStatus(ctx2, u2, allReduce(0.5), 'command', 'dangdi_zhijue');
    expect(reduceFor(u2, PHYS)).toBeCloseTo(0.95, 10);
    expect(reduceFor(u2, STRAT)).toBeCloseTo(0.5, 10);
  });

  it('攻击减伤与策略减伤本身仍各自共存（不能因为本改动被判同类）', () => {
    const ctx = makeCtx();
    const u = makeUnit('two_dims');
    inflictStatus(ctx, u, physReduce(0.5), 'command', 'a_skill');
    inflictStatus(ctx, u, stratReduce(0.3), 'command', 'b_skill');
    expect(reduceFor(u, PHYS)).toBeCloseTo(0.5, 10);
    expect(reduceFor(u, STRAT)).toBeCloseTo(0.3, 10);
    expect(ctx.events.some((e) => e.type === 'status_conflict')).toBe(false);
  });

  it('小类不同仍不冲突（受普攻减伤 vs 受所有伤害降低）', () => {
    const ctx = makeCtx();
    const u = makeUnit('minor');
    inflictStatus(ctx, u, allReduce(0.5), 'command', 'dangdi_zhijue');
    inflictStatus(ctx, u, { type: 'damage_reduce', rate: 0.2, duration: 3, damageSource: 'basic' }, 'command', 'basic_reduce');
    // 两条独立：没有 status_conflict；受普通攻击伤害吃 0.5 + 0.2
    expect(ctx.events.some((e) => e.type === 'status_conflict')).toBe(false);
    expect(reduceFor(u, { damageSource: 'basic', damageType: 'physical' })).toBeCloseTo(0.7, 10);
  });

  it('增伤侧不受影响：全域增伤与攻击增伤仍并存（用户 2026-09-16 口径）', () => {
    const ctx = makeCtx();
    const u = makeUnit('boost');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 1.2, duration: 3, direction: 'caused' }, 'passive', 'xuejian_huangsha');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.7, duration: 3, direction: 'caused', damageType: 'physical' }, 'passive', 'hubu_guanyou');
    expect(ctx.events.some((e) => e.type === 'status_conflict')).toBe(false);
    expect(u.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(2);
  });

  it('真实数据：于禁【当敌制决】与【一夫当关】的减伤段冲突（不是叠加）', () => {
    // 数据守卫：两条战法都是指挥、减伤段一个小类（无 damageSource/skillTypes 限定）、
    // 于禁不限定伤害类型（= 官方「受到的所有伤害降低」）、一夫当关限定攻击伤害
    const reduceOf = (id: string): CreateStatus => {
      const skill: Skill | undefined = SKILL_REGISTRY[id];
      const out = (skill?.output ?? []).find(
        (o): o is Extract<SkillOutput, { kind: 'inflict_status' }> =>
          o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'damage_reduce'
      );
      if (!out || Array.isArray(out.status)) throw new Error(`${id} 没有单条减伤段`);
      return out.status;
    };
    const yuJin = reduceOf('dangdi_zhijue');
    const yifu = reduceOf('yifudangguan');
    expect(SKILL_REGISTRY['dangdi_zhijue']!.type).toBe('command');
    expect(SKILL_REGISTRY['yifudangguan']!.type).toBe('command');
    expect(yuJin.type === 'damage_reduce' && yuJin.damageType).toBeUndefined();
    expect(yifu.type === 'damage_reduce' && yifu.damageType).toBe('physical');

    const ctx = makeCtx();
    const u = makeUnit('yu_jin_real');
    inflictStatus(ctx, u, yuJin, 'command', 'dangdi_zhijue');
    inflictStatus(ctx, u, yifu, 'command', 'yifudangguan');
    // 一夫当关本身 50%（受防御缩放要真实属性，这里只验证「同维取较高、不叠加」）
    expect(reduceFor(u, PHYS)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(reduceFor(u, STRAT)).toBeCloseTo(0.5, 10);
    expect(ctx.events.some((e) => e.type === 'status_conflict' && 'statusType' in e && e.statusType === 'damage_reduce')).toBe(true);
  });
});
