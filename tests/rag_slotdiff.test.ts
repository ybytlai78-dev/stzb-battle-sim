import { describe, expect, it } from 'vitest';
import { ATTR_CODES, SLOT_MAP, close, flattenOutputs } from '../scripts/rag/slotdiff.mts';

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

describe('属性增减（101-104 / 201-204）：判据由引擎侧数据反向自证', () => {
  const buff = (type: string, amount: number, growthRate?: number) => ({
    kind: 'inflict_status',
    status: { type, amount, ...(growthRate === undefined ? {} : { growthRate }) },
  });

  it('机制码与属性一一对应，提高 / 降低各占一端', () => {
    expect(ATTR_CODES.attack_buff).toEqual([101, 201]);
    expect(ATTR_CODES.defense_buff).toEqual([102, 202]);
    expect(ATTR_CODES.strategy_buff).toEqual([103, 203]);
    expect(ATTR_CODES.speed_buff).toEqual([104, 204]);
    // 每个属性都必须在 SLOT_MAP 里落到具体条目，否则码表与映射会脱节
    for (const codes of Object.values(ATTR_CODES)) {
      for (const c of codes) expect(SLOT_MAP[c]).toBeDefined();
    }
  });

  it('提高类不翻符号，降低类翻号 —— 包内两侧都是正值域，方向由机制码表达', () => {
    expect(SLOT_MAP[101].valueScale).toBe(1);
    expect(SLOT_MAP[104].valueScale).toBe(1);
    expect(SLOT_MAP[201].valueScale).toBe(-1);
    expect(SLOT_MAP[204].valueScale).toBe(-1);
    // 成长率不跟着翻号：引擎侧 growthRate 恒为正
    expect(SLOT_MAP[201].growthScale).toBe(1);
    expect(SLOT_MAP[204].growthScale).toBe(1);
  });

  it('取 amount 而非其他字段，且只认自己的属性类型', () => {
    const atk = buff('attack_buff', -28, 0.1);
    expect(SLOT_MAP[201].pick(atk)).toBe(-28);
    expect(SLOT_MAP[201].growth?.(atk)).toBe(0.1);
    // 防御槽位不能拿攻击的 buff 当命中
    expect(SLOT_MAP[202].pick(atk)).toBeNull();
    expect(SLOT_MAP[203].pick(atk)).toBeNull();
  });

  it('缺 growthRate 视为不缩放（引擎侧常态），不是 undefined', () => {
    expect(SLOT_MAP[101].growth?.(buff('attack_buff', 24))).toBe(0);
  });

  it('属性类必须成组对齐：attrType 标记存在，防止一槽多段被逐条硬比', () => {
    for (const c of [101, 102, 103, 104, 201, 202, 203, 204]) {
      expect(SLOT_MAP[c].attrType).toBeDefined();
    }
    // 伤害率 / 急救 / 减伤不走成组逻辑
    expect(SLOT_MAP[301].attrType).toBeUndefined();
    expect(SLOT_MAP[401].attrType).toBeUndefined();
    expect(SLOT_MAP[522].attrType).toBeUndefined();
  });
});
