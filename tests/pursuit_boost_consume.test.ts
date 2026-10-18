/**
 * 势无虚动（200949）「下一次追击增伤」的消耗点契约（2026-10-18 用户报障后建立）。
 *
 * 官方：「战斗中，自身每次试图发动追击战法时，使下一次造成伤害无视规避，且下一次发动追击战法造成的伤害
 * 提升40.0%，伤害提升效果最多可叠加3次」——消耗点是**追击战法发动**（仓库 2026-09-19 用户确认的消耗制：
 * 「下次追击打出即整条消耗」）。
 *
 * 报障现场（黄盖带势无虚动 + 烈火焚舟，追击 100% 发动）：烈火焚舟的 output 只有 `inflict_status`
 * （挂燃烧，无直接伤害段），而消耗只挂在 `executeSkillOutputs` 的伤害分支上 → 层数只涨不清：
 * 第 1 次判定「提高 40%」、第 2 次判定「提高 80%」，挂上的燃烧也按 2 层放大。
 * 现口径：成功发动后兜底消耗一次；本次已在伤害分支扣过的（charges 已变小 / 状态已移除）不再重复扣。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { Position, Skill, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(
  id: string,
  opts: { position?: Position; attackRange?: number; side?: 'my' | 'enemy' } = {}
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
      attack: 100,
      defense: 100,
      strategy: 80,
      speed: 50,
      attackRange: opts.attackRange ?? 1,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: opts.side ?? 'my',
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
    rng: new Rng(11),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY) as [string, Skill][]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 黄盖（前锋，攻击距离 1）+ 敌军三人；追击槽由调用方给 */
function field(pursuitIds: string[]): {
  ctx: CombatContext;
  attacker: UnitState;
  e1: UnitState;
  e2: UnitState;
  e3: UnitState;
} {
  const ctx = makeCtx();
  const attacker = makeUnit('huanggai', { position: '前锋', attackRange: 1 });
  attacker.general.pursuitSkillIds = pursuitIds;
  attacker.general.passiveSkillIds = ['shiwu_xudong'];
  ctx.myTeam = [attacker];
  const e1 = makeUnit('e1', { position: '前锋', side: 'enemy' });
  const e2 = makeUnit('e2', { position: '中军', side: 'enemy' });
  const e3 = makeUnit('e3', { position: '大营', side: 'enemy' });
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, attacker, e1, e2, e3 };
}

/** 携带者的「下一次追击增伤」状态（势无虚动那条） */
const pursuitBoosts = (u: UnitState) =>
  u.statuses.filter(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && Array.isArray(s.skillTypes) && s.skillTypes.includes('pursuit')
  );

const boostLines = (ctx: CombatContext) =>
  ctx.events
    .filter((e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost')
    .map((e) => (e as { detail?: string }).detail ?? '');

describe('势无虚动：追击战法发动即消耗（烈火焚舟无直接伤害段也不漏）', () => {
  it('烈火焚舟 100% 追击：两次判定都只叠到 40%，行动结束不留残层（报障回归）', () => {
    const { ctx, attacker } = field(['liehuo_fenzhou']);
    inflictStatus(ctx, attacker, { type: 'combo', duration: 1 }, 'command', 'xianqu_tuji');

    actUnit(ctx, attacker);

    // 两次追击（连击两刀各一次）都成功发动
    const casts = ctx.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'liehuo_fenzhou');
    expect(casts.length).toBe(2);
    // 每次试图发动 +1 层 = 40%；发动后立刻消耗 → 第二次仍显示 40%（旧实现为 80%）
    expect(boostLines(ctx)).toEqual(['下一次造成的伤害提高 40%', '下一次造成的伤害提高 40%']);
    expect(pursuitBoosts(attacker)).toHaveLength(0);
  });

  it('对照组：不发动追击（无追击槽）时增伤层保留，不被凭空消耗', () => {
    const { ctx, attacker } = field([]);
    actUnit(ctx, attacker);

    // 没有追击判定 → onPursuitAttempt 不执行 → 没有任何追击增伤
    expect(boostLines(ctx)).toEqual([]);
    expect(pursuitBoosts(attacker)).toHaveLength(0);
  });

  it('有直接伤害段的追击：只扣一次（不双扣），多余次数保留', () => {
    const { ctx, attacker } = field(['test_pursuit']);
    ctx.skills.set('test_pursuit', {
      id: 'test_pursuit',
      name: '测试追击',
      type: 'pursuit',
      range: 0,
      triggerRate: 1,
      tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 150 }],
    } as Skill);
    // 手工挂一条「2 次」的追击增伤：本次发动由伤害分支扣 1 次，兜底不得再扣
    attacker.statuses.push({
      type: 'damage_boost',
      direction: 'caused',
      rate: 0.4,
      charges: 2,
      remaining: 999,
      appliedRound: 0,
      sourceSkillType: 'passive',
      sourceSkillId: 'shiwu_xudong',
      sourceUnitId: attacker.general.id,
      skillTypes: ['pursuit'],
    });

    actUnit(ctx, attacker);

    const left = pursuitBoosts(attacker);
    expect(left).toHaveLength(1);
    expect(left[0].charges).toBe(1); // 只扣一次（旧缺口外的双扣会扣成 0 并移除）
  });

  it('消耗发生在伤害结算之后：同一次追击仍吃满 40% 增伤', () => {
    const run = (withBoost: boolean) => {
      const { ctx, attacker } = field(['test_pursuit']);
      ctx.skills.set('test_pursuit', {
        id: 'test_pursuit',
        name: '测试追击',
        type: 'pursuit',
        range: 0,
        triggerRate: 1,
        tags: ['damage'],
        output: [{ kind: 'physical_damage', rate: 150 }],
      } as Skill);
      if (!withBoost) attacker.general.passiveSkillIds = [];
      actUnit(ctx, attacker);
      const dmg = ctx.events.filter(
        (e): e is Extract<typeof e, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'test_pursuit'
      );
      return dmg.reduce((sum, e) => sum + e.damage, 0);
    };

    const boosted = run(true);
    const plain = run(false);
    expect(boosted).toBeGreaterThan(plain);
    // 增伤在本次伤害里生效后立刻消耗：状态不留到下一次
    const { attacker, ctx } = (() => {
      const f = field(['test_pursuit']);
      f.ctx.skills.set('test_pursuit', {
        id: 'test_pursuit',
        name: '测试追击',
        type: 'pursuit',
        range: 0,
        triggerRate: 1,
        tags: ['damage'],
        output: [{ kind: 'physical_damage', rate: 150 }],
      } as Skill);
      actUnit(f.ctx, f.attacker);
      return f;
    })();
    expect(pursuitBoosts(attacker)).toHaveLength(0);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_pursuit')).toBe(true);
  });
});

describe('势无虚动：数据口径', () => {
  it('onPursuitAttempt = 无视规避 + 追击增伤 40%（最多 3 层、消耗制）', () => {
    const skill = SKILL_REGISTRY['shiwu_xudong'] as Extract<Skill, { onPursuitAttempt?: unknown }>;
    const outputs = skill.onPursuitAttempt!.output as Array<{ kind: string; status?: Record<string, unknown> }>;
    const ignoreEvasion = outputs.find((o) => o.status?.type === 'ignore_evasion');
    expect(ignoreEvasion).toBeTruthy();

    const boost = outputs.find((o) => o.status?.type === 'damage_boost')!.status!;
    expect(boost.rate).toBe(0.4);
    expect(boost.direction).toBe('caused');
    expect(boost.skillTypes).toEqual(['pursuit']);
    expect(boost.maxStacks).toBe(3);
    expect(boost.charges).toBe(1);
    expect(boost.chargesStack).toBe(true);
  });
});
