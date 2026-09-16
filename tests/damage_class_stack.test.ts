/**
 * 增减伤「分类键」叠加/冲突测试（用户口径 2026-09-16）
 *
 * 口径：增伤/减伤按 `大类|小类` 分类（见 `action.ts` 的 `damageClassKey`）
 *   - 大类（伤害类型维）：全域（官方「造成的伤害提高」）/ 攻击（damageType physical）/ 谋略（strategy）
 *   - 小类（战法来源维）：普通（damageSource basic）/ 主动·追击·指挥（skillTypes）/ 无
 * **分类键不同 → 各自共存、进同一加算池直接相加**；
 * **分类键相同 且来源战法类型相同 → 冲突、数值取较高替换**（既有规则不变）。
 * 全域是独立一类，与攻击/谋略大类、与四个小类都能叠。
 *
 * 依据：官方战法库措辞分布（造成的伤害提高 21 / 造成的攻击伤害提高 5 / 造成的策略伤害提高 1 /
 * 主动战法伤害提高 23 / 追击战法伤害提高 8 / 指挥战法伤害提高 1 / 普通攻击伤害提高 10）。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  inflictStatus,
  damageClassKey,
  getStatus,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, CreateStatus, Position, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(
  id: string,
  opts: { position?: Position; attack?: number; defense?: number; strategy?: number; speed?: number } = {}
): UnitState {
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
      strategy: opts.strategy ?? 100,
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
    troops: 10000,
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

function countConflict(ctx: CombatContext): number {
  return ctx.events.filter((e) => e.type === 'status_conflict' && e.statusType === 'damage_boost').length;
}

const boosts = (u: UnitState, skillId: string) =>
  u.statuses.filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.sourceSkillId === skillId);

/** 预挂增伤（来源战法 id 用 cmd_<n>，来源类型可指定） */
function preBoost(ctx: CombatContext, u: UnitState, list: CreateStatus[], sourceType: 'command' | 'passive' = 'command'): void {
  list.forEach((s, i) => inflictStatus(ctx, u, s, sourceType, `${sourceType}_${i}`, 'lvmeng'));
}

type DmgEvent = Extract<BattleEvent, { type: 'damage' }>;
type HitEvent = Extract<BattleEvent, { type: 'attack_hit' }>;

/**
 * 关银屏（巾帼战阵：主动 100%、攻击伤害 120%、自身全域 +40% 造成增伤）打一次行动的标准战场。
 * 同一 seed、预挂状态不消耗 RNG → 同批次伤害数字严格可比（用于「同池加算」的精确断言）。
 */
function actGuanyinping(extra: CreateStatus[], targetReduces: CreateStatus[] = []) {
  const ctx = makeCtx();
  const u = makeUnit('guanyinping', { position: '前锋', attack: 150 });
  u.general.activeSkillIds = ['jinguo_zhanzhen'];
  ctx.myTeam = [u];
  const e1 = makeUnit('e1', { position: '前锋', defense: 80 });
  const e2 = makeUnit('e2', { position: '中军' });
  for (const e of [e1, e2]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2];

  preBoost(ctx, u, extra);
  targetReduces.forEach((s, i) => inflictStatus(ctx, e1, s, 'command', `reduce_${i}`, 'zhoutai'));

  actUnit(ctx, u);
  const dmg = ctx.events.find(
    (e): e is DmgEvent => e.type === 'damage' && e.sourceId === 'guanyinping' && e.targetId === 'e1'
  );
  const hit = ctx.events.find(
    (e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === 'guanyinping' && e.targetId === 'e1'
  );
  return { ctx, u, e1, dmg, hit };
}

describe('增减伤分类键（大类|小类）', () => {
  it('官方 7 种措辞 → 分类键映射（大类 | 小类）', () => {
    // 大类（伤害类型维）
    expect(damageClassKey({})).toBe('全域|无');
    expect(damageClassKey({ damageType: 'physical' })).toBe('攻击|无');
    expect(damageClassKey({ damageType: 'strategy' })).toBe('谋略|无');
    // 小类（战法来源维）
    expect(damageClassKey({ damageSource: 'basic' })).toBe('全域|普通');
    expect(damageClassKey({ damageSource: 'skill', skillTypes: ['active'] })).toBe('全域|主动');
    expect(damageClassKey({ damageSource: 'skill', skillTypes: ['pursuit'] })).toBe('全域|追击');
    expect(damageClassKey({ damageSource: 'skill', skillTypes: ['command'] })).toBe('全域|指挥');
    // 多维组合：大类 + 小类同一条状态
    expect(damageClassKey({ damageType: 'physical', damageSource: 'basic' })).toBe('攻击|普通');
    expect(damageClassKey({ damageType: 'strategy', damageSource: 'skill', skillTypes: ['active'] })).toBe('谋略|主动');
    // 三种来源维互不混淆：全伤害 ≠ 战法伤害 ≠ 普通攻击
    expect(damageClassKey({ damageSource: 'skill' })).toBe('全域|战法');
    expect(damageClassKey({ damageSource: 'skill', skillTypes: ['active', 'pursuit'] })).toBe('全域|主动/追击');
  });

  it('修复点：【攻击伤害提高】(大类) + 【主动战法伤害提高】(小类)，同来源战法类型 → 共存不冲突、数值相加', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused', damageType: 'physical' }, 'command', 'cmd_daxiao');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused', skillTypes: ['active'] }, 'command', 'cmd_wende');

    expect(countConflict(ctx)).toBe(0);
    expect(boosts(u, 'cmd_daxiao')).toHaveLength(1);
    expect(boosts(u, 'cmd_wende')).toHaveLength(1);
    expect(getStatus(u, 'damage_boost')!.rate).toBe(0.2);
  });

  it('数值：大类 0.2 + 小类 0.3 与单条全域 0.5 **完全同伤**（证明进同一加算池直接相加）', () => {
    const split = actGuanyinping([
      { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused', damageType: 'physical' },
      { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused', skillTypes: ['active'] },
    ]);
    const merged = actGuanyinping([{ type: 'damage_boost', rate: 0.5, duration: 999, direction: 'caused' }]);

    expect(split.dmg, '巾帼战阵应造成伤害').toBeTruthy();
    expect(merged.dmg).toBeTruthy();
    // 两条分类不同的增伤 → 与一条合计相同的全域增伤行为完全一致
    expect(split.dmg!.damage).toBe(merged.dmg!.damage);
    expect(split.dmg!.breakdown).toEqual(merged.dmg!.breakdown);
    // 战报归因：两条预挂增伤都在场（+ 巾帼战阵自身全域 0.4）
    expect(split.dmg!.modifiers!.caused.map((m) => m.rate)).toEqual([0.2, 0.3, 0.4]);
    expect(merged.dmg!.modifiers!.caused.map((m) => m.rate)).toEqual([0.5, 0.4]);
  });

  it('回归：分类键相同 + 同来源战法类型 → 仍冲突取较高（全域 vs 全域，同为指挥）', () => {
    const ctx = makeCtx();
    const u = makeUnit('b');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' }, 'command', 'dashang_sanjun');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused' }, 'command', 'fenji_xiandeng');

    expect(countConflict(ctx)).toBe(1);
    expect(u.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(1);
    expect(getStatus(u, 'damage_boost')!.rate).toBe(0.3);
  });

  it('来源战法类型不同 + 分类键相同 → 各自共存（既有「不同类型各自计数」规则不动）', () => {
    const ctx = makeCtx();
    const u = makeUnit('c');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused' }, 'command', 'cmd_x');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.25, duration: 999, direction: 'caused' }, 'passive', 'pas_x');

    expect(countConflict(ctx)).toBe(0);
    expect(u.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(2);
  });

  it('全域 × 大类：血溅黄砂(+120% 全域) 与 虎步关右(+70% 攻击) 叠加（官方「造成的伤害提高」是独立一类）', () => {
    const ctx = makeCtx();
    const u = makeUnit('machao');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 1.2, duration: 999, direction: 'caused' }, 'passive', 'xuejian_huangsha', 'machao');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.7, duration: 3, direction: 'caused', damageType: 'physical' }, 'passive', 'hubu_guanyou', 'guanyu');

    expect(countConflict(ctx)).toBe(0);
    const all = u.statuses.filter(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused'
    );
    expect(all).toHaveLength(2);
    expect(all.reduce((acc, s) => acc + s.rate, 0)).toBeCloseTo(1.9, 10);
  });

  it('小类按标签过滤：主动/追击增伤不进普攻，大类攻击增伤普攻照吃', () => {
    const { dmg, hit } = actGuanyinping([
      { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused', damageType: 'physical' },
      { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused', skillTypes: ['active'] },
      { type: 'damage_boost', rate: 0.5, duration: 999, direction: 'caused', skillTypes: ['pursuit'] },
    ]);

    // 主动战法伤害：大类攻击 + 小类主动（追击那条不匹配主动）＋ 巾帼自身全域
    expect(dmg!.modifiers!.caused.map((m) => m.skillId)).toEqual(['command_0', 'command_1', 'jinguo_zhanzhen']);
    // 普攻：只吃大类攻击与巾帼自身全域；小类主动/追击都不吃
    expect(hit, '应有普攻命中事件').toBeTruthy();
    expect(hit!.modifiers!.caused.map((m) => m.skillId)).toEqual(['command_0', 'jinguo_zhanzhen']);
  });

  it('减伤（damage_reduce）同规则：全域 0.11 + 攻击大类 0.2 共存并相加；单条全域 0.31 同伤', () => {
    const split = actGuanyinping(
      [],
      [
        { type: 'damage_reduce', rate: 0.11, duration: 999 },
        { type: 'damage_reduce', rate: 0.2, duration: 999, damageType: 'physical' },
      ]
    );
    const merged = actGuanyinping([], [{ type: 'damage_reduce', rate: 0.31, duration: 999 }]);

    expect(split.ctx.events.filter((e) => e.type === 'status_conflict').length).toBe(0);
    expect(split.e1.statuses.filter((s) => s.type === 'damage_reduce')).toHaveLength(2);
    expect(split.dmg!.modifiers!.reduce.map((m) => m.rate)).toEqual([0.11, 0.2]);
    expect(split.dmg!.damage).toBe(merged.dmg!.damage);
  });

  it('攻击/谋略大类互不干扰：攻击大类增伤不吃谋略伤害', () => {
    const { dmg } = actGuanyinping([
      { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused', damageType: 'physical' },
      { type: 'damage_boost', rate: 0.35, duration: 999, direction: 'caused', damageType: 'strategy' },
    ]);

    expect(dmg!.modifiers!.caused.map((m) => m.rate)).toEqual([0.2, 0.4]);
  });
});
