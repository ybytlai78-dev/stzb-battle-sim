/**
 * 实时距离测试（v0.10）：攻击/战法距离不固定——
 * 每方存活单位按原站位（前锋→中军→大营）压缩重编号，阵亡单位跳过、后排前移，
 * 再按压缩后的相对位次查距离矩阵。
 * 例：双方只剩大营 → 双方大营都压到己方 0 位 → 距离 1。
 */
import { describe, it, expect } from 'vitest';
import { distanceBetween, nearestEnemy, skillTargets } from '../src/engine/target';
import type { CombatContext } from '../src/engine/action';
import type { General, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string, position: General['position'], alive = true, attackRange = 3): UnitState {
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
      attackRange,
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
    troops: alive ? 10000 : 0,
    wounded: 0,
    totalDead: 0,
    alive,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(myTeam: UnitState[], enemyTeam: UnitState[]): CombatContext {
  return {
    rng: new Rng(1),
    myTeam,
    enemyTeam,
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 满员三将 */
function fullTeam(side: 'my' | 'enemy'): UnitState[] {
  return ['前锋', '中军', '大营'].map((p, i) => {
    const u = makeUnit(`${side}_${p}`, p as General['position']);
    u.side = side;
    return u;
  });
}

describe('实时距离（存活压缩）', () => {
  it('满员：大营↔大营距离 5，前锋↔前锋距离 1', () => {
    const my = fullTeam('my');
    const en = fullTeam('enemy');
    const ctx = makeCtx(my, en);
    expect(distanceBetween(ctx, my[2], en[2])).toBe(5); // 大营↔大营
    expect(distanceBetween(ctx, my[0], en[0])).toBe(1); // 前锋↔前锋
  });

  it('双方都只剩大营：距离为 1（阵亡者跳过，大营压到 0 位）', () => {
    const my = fullTeam('my');
    const en = fullTeam('enemy');
    // 红方前锋/中军阵亡，蓝方前锋/中军阵亡
    my[0].alive = false; my[0].troops = 0;
    my[1].alive = false; my[1].troops = 0;
    en[0].alive = false; en[0].troops = 0;
    en[1].alive = false; en[1].troops = 0;
    const ctx = makeCtx(my, en);
    // 红大营压到 0 位，蓝大营压到 0 位 → 距离 1
    expect(distanceBetween(ctx, my[2], en[2])).toBe(1);
    // 反向亦然
    expect(distanceBetween(ctx, en[2], my[2])).toBe(1);
  });

  it('红方前锋阵亡后：红大营(压到1位) ↔ 蓝大营(2位) 距离 4（原固定 5 缩短）', () => {
    const my = fullTeam('my');
    const en = fullTeam('enemy');
    my[0].alive = false; my[0].troops = 0; // 红前锋阵亡
    const ctx = makeCtx(my, en);
    expect(distanceBetween(ctx, my[2], en[2])).toBe(4); // 红大营压到 1 位
  });

  it('双方只剩大营时，攻击距离 1 的武将也能普攻到大营（实时寻敌）', () => {
    const my = fullTeam('my');
    const en = fullTeam('enemy');
    my[0].alive = false; my[0].troops = 0;
    my[1].alive = false; my[1].troops = 0;
    en[0].alive = false; en[0].troops = 0;
    en[1].alive = false; en[1].troops = 0;
    const ctx = makeCtx(my, en);
    // 红大营攻击距离 1（原定 3）：实时距离 1 → 可命中蓝大营
    my[2].general.attackRange = 1;
    const target = nearestEnemy(ctx, my[2], en);
    expect(target?.general.id).toBe('enemy_大营');
  });
});

describe('同侧战法距离（我军群体）', () => {
  it('中军施法距离 3：同侧前锋/自身/大营均在范围内，groupCount [2,3] 能抽到 3 人', () => {
    const my = fullTeam('my');
    const en = fullTeam('enemy');
    const ctx = makeCtx(my, en);
    const mid = my[1]; // 中军
    const seen = new Set<number>();
    for (let k = 0; k < 16; k++) {
      seen.add(skillTargets(ctx, mid, my, 3, 'group', [2, 3]).length);
    }
    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });
});
