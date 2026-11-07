/**
 * 群体目标数在区间内的取值权重（2026-11-06 用户实测口径）。
 *
 * 包内只给区间：`tb_cfg_skill_detail.select_type = 32 + 下限`（33→1、34→2）、`attack_max` = 上限
 * （取证：`docs/逆向对拍/目标数语义-取证-2026-11-06.md`）。区间内的权重包内无字段承载，实测值为
 * **`select_type=34`「2-3 个目标」：2 目标 2/3、3 目标 1/3** → `GROUP_COUNT_WEIGHTS = { '2,3': [2,1] }`。
 * 未登记的区间（`[1,2]` / `[1,3]`）保持闭区间均匀，本文件同时守这两条。
 */
import { describe, it, expect } from 'vitest';
import {
  expectedGroupCount,
  groupCountWeights,
  rollGroupCount,
  skillTargets,
} from '../src/engine/target';
import type { CombatContext } from '../src/engine/action';
import type { General, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string, position: General['position']): UnitState {
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
      position,
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
    side: 'enemy',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(seed: number): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('groupCount 区间权重（select_type=34 → 2:1）', () => {
  it('权重表登记 [2,3] = [2,1]，未登记区间返回 null（= 均匀）', () => {
    expect(groupCountWeights(2, 3)).toEqual([2, 1]);
    expect(groupCountWeights(1, 2)).toBeNull();
    expect(groupCountWeights(1, 3)).toBeNull();
  });

  it('[2,3] 实测分布：2 目标 ≈ 2/3、3 目标 ≈ 1/3', () => {
    const rng = new Rng(20261106);
    const n = 12000;
    let two = 0;
    for (let i = 0; i < n; i++) {
      const v = rollGroupCount(rng, 2, 3);
      expect(v === 2 || v === 3).toBe(true);
      if (v === 2) two++;
    }
    const rate = two / n;
    expect(rate).toBeGreaterThan(0.64);
    expect(rate).toBeLessThan(0.69);
  });

  it('[1,2] / [1,3] 仍按闭区间均匀（未被 34 的口径污染）', () => {
    const n = 12000;
    const rng12 = new Rng(7);
    const c12 = [0, 0];
    for (let i = 0; i < n; i++) c12[rollGroupCount(rng12, 1, 2) - 1]++;
    expect(c12[0] / n).toBeGreaterThan(0.47);
    expect(c12[0] / n).toBeLessThan(0.53);

    const rng13 = new Rng(11);
    const c13 = [0, 0, 0];
    for (let i = 0; i < n; i++) c13[rollGroupCount(rng13, 1, 3) - 1]++;
    for (const c of c13) {
      expect(c / n).toBeGreaterThan(0.30);
      expect(c / n).toBeLessThan(0.37);
    }
  });

  it('每次取值恰好消耗一次 rng.next()（可复现序列不被权重分支打乱）', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    rollGroupCount(a, 2, 3);
    rollGroupCount(a, 1, 2);
    b.next();
    b.next();
    expect(a.next()).toBe(b.next());
  });

  it('期望值：[2,3] = 2.333（不再是中点 2.5），[1,2] = 1.5，标量原样', () => {
    expect(expectedGroupCount([2, 3])).toBeCloseTo(2 + 1 / 3, 10);
    expect(expectedGroupCount([1, 2])).toBe(1.5);
    expect(expectedGroupCount([1, 3])).toBe(2);
    expect(expectedGroupCount(3)).toBe(3);
    expect(expectedGroupCount(undefined)).toBe(2);
  });

  it('端到端：distance=5 的群体战法打在 3 名敌将上，目标数只出现 2 / 3 且偏向 2', () => {
    const enemies = [makeUnit('e1', '前锋'), makeUnit('e2', '中军'), makeUnit('e3', '大营')];
    const caster = { ...makeUnit('c', '前锋'), side: 'my' as const };
    const ctx = makeCtx(4242);
    ctx.myTeam = [caster];
    ctx.enemyTeam = enemies;
    const n = 4000;
    let two = 0;
    for (let i = 0; i < n; i++) {
      const targets = skillTargets(ctx, caster, enemies, 5, 'group', [2, 3]);
      expect(targets.length === 2 || targets.length === 3).toBe(true);
      expect(new Set(targets.map((t) => t.general.id)).size).toBe(targets.length);
      if (targets.length === 2) two++;
    }
    const rate = two / n;
    expect(rate).toBeGreaterThan(0.63);
    expect(rate).toBeLessThan(0.70);
  });
});
