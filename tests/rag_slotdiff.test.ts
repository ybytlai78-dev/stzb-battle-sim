import { describe, expect, it } from 'vitest';
import { SLOT_MAP, close, flattenOutputs } from '../scripts/rag/slotdiff.mts';

/** 槽位对拍的映射口径守卫：单位换算与机制码归属由真实行自证过，改动必须先跑 slotdiff 看差异数 */

describe('机制码 → 引擎字段', () => {
  it('301/302 走伤害主循环，取 rate', () => {
    expect(SLOT_MAP[301].pick({ kind: 'physical_damage', rate: 115 })).toBe(115);
    expect(SLOT_MAP[301].pick({ kind: 'strategy_damage', rate: 115 })).toBeNull();
    expect(SLOT_MAP[302].pick({ kind: 'strategy_damage', rate: 215 })).toBe(215);
    // 伤害率在两边都是「百分数」，不换算
    expect(SLOT_MAP[301].valueScale).toBe(1);
    expect(SLOT_MAP[302].valueScale).toBe(1);
  });

  it('304 恐慌只配 panic 状态，别把燃烧/妖术算进来', () => {
    const panic = { kind: 'inflict_status', status: { type: 'panic', rate: 127, growthRate: 1.275 } };
    expect(SLOT_MAP[304].pick(panic)).toBe(127);
    expect(SLOT_MAP[304].growth?.(panic)).toBe(1.275);
    expect(SLOT_MAP[304].pick({ kind: 'inflict_status', status: { type: 'burning', rate: 127 } })).toBeNull();
    expect(SLOT_MAP[305].pick({ kind: 'inflict_status', status: { type: 'burning', rate: 221 } })).toBe(221);
  });

  it('401 急救取 healRate，包内值已是百分点（金匮要略 80 = 引擎 80）', () => {
    const fa = { kind: 'grant_first_aid', healRate: 80, healGrowthRate: 0.75 };
    expect(SLOT_MAP[401].pick(fa)).toBe(80);
    expect(SLOT_MAP[401].growth?.(fa)).toBe(0.75);
    expect(SLOT_MAP[401].valueScale).toBe(1);
  });

  it('522/524 按 damageType 互斥：引擎一条通吃时两槽都能配上，分开写时各配各的', () => {
    const generic = { kind: 'inflict_status', status: { type: 'damage_reduce', rate: 0.204, growthRate: 0.18 } };
    expect(SLOT_MAP[522].pick(generic)).toBe(0.204);
    expect(SLOT_MAP[524].pick(generic)).toBe(0.204);

    const physical = { kind: 'inflict_status', status: { type: 'damage_reduce', damageType: 'physical', rate: 0.3 } };
    const strategy = { kind: 'inflict_status', status: { type: 'damage_reduce', damageType: 'strategy', rate: 0.2 } };
    expect(SLOT_MAP[522].pick(physical)).toBe(0.3);
    expect(SLOT_MAP[522].pick(strategy)).toBeNull();
    expect(SLOT_MAP[524].pick(strategy)).toBe(0.2);
    expect(SLOT_MAP[524].pick(physical)).toBeNull();
  });

  it('减伤在包内是百分点、引擎存小数 ⇒ 只对值乘 0.01，成长率不动', () => {
    expect(SLOT_MAP[522].valueScale).toBe(0.01);
    expect(SLOT_MAP[522].growthScale).toBe(1);
    expect(SLOT_MAP[524].valueScale).toBe(0.01);
  });
});

describe('结构展开与容差', () => {
  it('flattenOutputs 展开 conditional 的嵌套输出', () => {
    const out = [
      { kind: 'conditional', output: [{ kind: 'physical_damage', rate: 100 }, { kind: 'conditional', output: [{ kind: 'heal', rate: 50 }] }] },
      { kind: 'inflict_status', status: { type: 'panic', rate: 90 } },
    ];
    const flat = flattenOutputs(out as never);
    expect(flat.map((o) => o.kind)).toEqual(['conditional', 'physical_damage', 'conditional', 'heal', 'inflict_status']);
  });

  it('close 同时容忍绝对差与千分之一相对差', () => {
    expect(close(127, 127)).toBe(true);
    expect(close(127.0000001, 127)).toBe(true);
    expect(close(0.204, 0.204)).toBe(true);
    expect(close(190, 200)).toBe(false);
    expect(close(0.13, 0.18)).toBe(false);
  });
});
