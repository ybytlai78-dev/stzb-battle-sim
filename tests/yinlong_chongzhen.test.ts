/**
 * 银龙冲阵（赵云·主动）机制测试（v0.11）
 *  1. 随机对敌军单体发动 2 次攻击（伤害率 150%），每次目标独立判断（random_single 均匀随机）
 *  2. 使首次攻击的目标受到的攻击和谋略伤害提高（受攻击属性影响：20% 基础 + 0.1%/点攻击）
 *  3. 持续至战斗结束（duration 999），最多叠加 3 次（stacks 层数封顶）
 * 用 stub rng 精确控制目标随机与发动率判定。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

/** stub rng：chance 完全由实现控制；int 按队列依次返回（耗尽后返回 0），用于控制随机单体目标 */
function stubRng(opts: { chance?: (p: number) => boolean; intSeq?: number[] } = {}): Rng {
  const seq = [...(opts.intSeq ?? [])];
  return {
    next: () => 0.5,
    int: (n: number) => {
      const v = seq.length > 0 ? seq.shift()! : 0;
      return Math.min(Math.max(0, v), n - 1);
    },
    intInclusive: () => 0,
    chance: opts.chance ?? (() => true),
  } as unknown as Rng;
}

function makeUnit(id: string, opts: { position?: Position; attack?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '蜀',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: 100,
      strategy: 80,
      speed: 80,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: ['yinlong_chongzhen'],
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
    isPreparing: false,
    preparingSkillId: null,
  };
}

/** 战场：赵云（前锋）+ 敌军 3 人（前锋/中军/大营，均距离 5 内） */
function field(rng: Rng): { ctx: CombatContext; zhaoyun: UnitState } {
  const ctx: CombatContext = {
    rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  const zhaoyun = makeUnit('zhaoyun', { position: '前锋', attack: 180 });
  ctx.myTeam = [zhaoyun];
  const e1 = makeUnit('e1', { position: '前锋' });
  const e2 = makeUnit('e2', { position: '中军' });
  const e3 = makeUnit('e3', { position: '大营' });
  for (const e of [e1, e2, e3]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, zhaoyun };
}

const zyDamage = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'yinlong_chongzhen');
const takenBoost = (u: UnitState) =>
  u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.direction === 'taken' && s.sourceSkillId === 'yinlong_chongzhen'
  );

describe('银龙冲阵（赵云·主动：随机两次攻击 + 首次目标受击增伤）', () => {
  it('战法定义：主动 50%、有效距离 5、两次 150% 攻击（random_single）、词条标签', () => {
    const s = SKILL_REGISTRY['yinlong_chongzhen'] as Extract<import('../src/engine/types').Skill, { type: 'active' }>;
    expect(s.type).toBe('active');
    expect(s.triggerRate).toBe(0.5);
    expect(s.range).toBe(5);
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'damage_boost']));
    expect(s.output.length).toBe(2);
    for (const o of s.output) {
      expect(o.kind).toBe('physical_damage');
      if (o.kind === 'physical_damage') {
        expect(o.rate).toBe(150);
        expect(o.targetMode).toBe('random_single');
      }
    }
    const first = s.output[0];
    if (first.kind === 'physical_damage') {
      expect(first.markTakenBoost).toEqual({ rate: 20, growthRate: 0.1, duration: 999, maxStacks: 3 });
    }
  });

  it('随机单体两次攻击（每次独立判断）：可打中不同目标；首次攻击的目标挂受击增伤（受攻击缩放）', () => {
    // int 序列：战法层 skill_target 消耗首位；第一刀选 e2(下标1)+伤害系数；第二刀选 e3(下标2)+伤害系数
    const { ctx, zhaoyun } = field(stubRng({ intSeq: [0, 1, 0, 2, 0] }));
    actUnit(ctx, zhaoyun);

    const dmg = zyDamage(ctx);
    expect(dmg.length).toBe(2);
    expect(dmg[0].targetId).toBe('e2');
    expect(dmg[1].targetId).toBe('e3');
    // 首次攻击的目标（e2）挂受击增伤：攻击 180 → 20 + 0.1×(180-80) = 30 → 30%
    const boost = takenBoost(ctx.enemyTeam[1]);
    expect(boost).toBeTruthy();
    expect(boost!.rate).toBe(0.3);
    expect(boost!.remaining).toBe(999);
    expect(boost!.stacks).toBe(1);
    expect(boost!.sourceUnitId).toBe('zhaoyun');
    // 第二次攻击的目标（e3）不挂
    expect(takenBoost(ctx.enemyTeam[2])).toBeUndefined();
  });

  it('两次攻击打中同一目标时：受击增伤只挂 1 层（本次释放 1 次），第二次攻击享受增伤', () => {
    const { ctx } = field(stubRng({ intSeq: [0, 0, 0, 0] }));
    actUnit(ctx, zhaoyunOf(ctx));
    const dmg = zyDamage(ctx);
    expect(dmg.length).toBe(2);
    expect(dmg.every((e) => e.targetId === 'e1')).toBe(true);
    const boost = takenBoost(ctx.enemyTeam[0]);
    expect(boost).toBeTruthy();
    expect(boost!.stacks).toBe(1);
    expect(boost!.rate).toBe(0.3);
    // 第二段伤害（同目标）享受首段挂上的增伤：modifiers.taken 含银龙冲阵
    const takenSrc = dmg[1].modifiers?.taken.find((s) => s.skillId === 'yinlong_chongzhen');
    expect(takenSrc).toBeTruthy();
    expect(takenSrc!.rate).toBe(0.3);
  });

  it('攻击属性 80 时受击增伤为基础 20%', () => {
    const { ctx } = field(stubRng({ intSeq: [0, 0, 0, 0] }));
    const z = ctx.myTeam[0];
    z.general.attack = 80;
    actUnit(ctx, z);
    const boost = takenBoost(ctx.enemyTeam[0]);
    expect(boost!.rate).toBe(0.2);
  });

  it('最多叠加 3 次：第 4 次释放不再叠加（层数/数值封顶）', () => {
    const { ctx, zhaoyun } = field(stubRng({ intSeq: [0, 0, 0, 0] }));
    for (let i = 0; i < 4; i++) actUnit(ctx, zhaoyun);
    const boost = takenBoost(ctx.enemyTeam[0]);
    expect(boost).toBeTruthy();
    expect(boost!.stacks).toBe(3);
    expect(boost!.rate).toBeCloseTo(0.9, 10); // 3 × 30%
    // 第 5 次释放：仍为 3 层
    actUnit(ctx, zhaoyun);
    expect(takenBoost(ctx.enemyTeam[0])!.stacks).toBe(3);
    expect(takenBoost(ctx.enemyTeam[0])!.rate).toBeCloseTo(0.9, 10);
  });

  it('发动率判定失败时不造成攻击也不挂增伤', () => {
    const { ctx, zhaoyun } = field(stubRng({ chance: () => false }));
    actUnit(ctx, zhaoyun);
    expect(zyDamage(ctx).length).toBe(0);
    expect(takenBoost(ctx.enemyTeam[0])).toBeUndefined();
  });
});

function zhaoyunOf(ctx: CombatContext): UnitState {
  return ctx.myTeam[0];
}
