import { describe, it, expect } from 'vitest';
import {
  troopBaseDamage,
  unitDamage,
  attrFactor,
  targetStratMitigation,
  atkBaseRandomCoeff,
  buffMult,
  scaledValue,
  roundRate,
  calcDamage,
  applyTroopCap,
  calcHealAmount,
  applyIgnoreDef,
} from '../src/engine/formulas';
import { Rng } from '../src/engine/rng';

describe('troopBaseDamage', () => {
  it('兵力 10000 时命中调研锚点（兵刃 211 / 谋略 108）', () => {
    expect(troopBaseDamage(10000, 'physical')).toBe(211);
    expect(troopBaseDamage(10000, 'strategy')).toBe(108);
  });
  it('兵力 0 时为 0', () => {
    expect(troopBaseDamage(0, 'physical')).toBe(0);
    expect(troopBaseDamage(0, 'strategy')).toBe(0);
  });
});

describe('unitDamage', () => {
  it('随兵力增长但慢于线性（5000 兵 > 半值）', () => {
    const full = unitDamage(10000, 'physical');
    const half = unitDamage(5000, 'physical');
    expect(half).toBeGreaterThan(full / 2);
    expect(half).toBeLessThan(full);
  });
  it('有上界趋势：20000 兵不翻倍', () => {
    const full = unitDamage(10000, 'physical');
    const double = unitDamage(20000, 'physical');
    expect(double).toBeLessThan(full * 2);
  });
});

describe('attrFactor（参考模拟器校准）', () => {
  it('攻防差 0 时 = 1', () => {
    expect(attrFactor(0)).toBe(1);
  });
  it('差值为正提升、为负下降', () => {
    expect(attrFactor(50)).toBeGreaterThan(attrFactor(0));
    expect(attrFactor(-50)).toBeLessThan(attrFactor(0));
  });
  it('正值段：3 - 500/(250+diff)，饱和趋近 3', () => {
    expect(attrFactor(100)).toBeCloseTo(1.57);
    expect(attrFactor(250)).toBe(2);
    expect(attrFactor(10000)).toBeCloseTo(2.98, 1);
    expect(attrFactor(10000)).toBeLessThan(3);
  });
  it('负值段：100/(100-diff)，趋近 0', () => {
    expect(attrFactor(-70)).toBeCloseTo(0.59);
    expect(attrFactor(-100)).toBe(0.5);
    expect(attrFactor(-10000)).toBeCloseTo(0.01, 1);
    expect(attrFactor(-10000)).toBeGreaterThan(0);
  });
});

describe('applyIgnoreDef（击势：无视防御作用于目标防御）', () => {
  it('目标防御 = 原防御 × (1 − 无视比例)', () => {
    expect(applyIgnoreDef(100, 0.6)).toBe(40);
    expect(applyIgnoreDef(200, 0)).toBe(200);
    expect(applyIgnoreDef(80, 1)).toBe(0);
  });

  it('只抬高主要伤害的攻防差，不改变兵力基础与攻击基础', () => {
    const base = {
      damageType: 'physical' as const,
      rate: 100,
      attackerAttack: 200,
      attackerStrategy: 80,
      attackerTroops: 9000,
      targetStrategy: 60,
      mult: 1,
    };
    const a = calcDamage({ ...base, targetDefense: 100 }, new Rng(7));
    const b = calcDamage({ ...base, targetDefense: applyIgnoreDef(100, 0.6) }, new Rng(7));
    expect(b.breakdown.troopBase).toBe(a.breakdown.troopBase);
    expect(b.breakdown.base).toBe(a.breakdown.base);
    expect(b.breakdown.main).toBeGreaterThan(a.breakdown.main);
    expect(b.damage).toBeGreaterThan(a.damage);
    expect(attrFactor(200 - applyIgnoreDef(100, 0.6))).toBeGreaterThan(attrFactor(200 - 100));
  });
});

describe('targetStratMitigation', () => {
  it('谋略 < 52 无减伤', () => {
    expect(targetStratMitigation(50)).toBe(1);
  });
  it('谋略越高减伤越强', () => {
    expect(targetStratMitigation(109)).toBeLessThan(targetStratMitigation(52));
  });
  it('有下限保护', () => {
    expect(targetStratMitigation(999)).toBeGreaterThanOrEqual(0.23);
  });
});

describe('atkBaseRandomCoeff', () => {
  it('随机系数落在 {0.30…0.39}', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const c = atkBaseRandomCoeff(rng);
      expect(c).toBeGreaterThanOrEqual(0.3);
      expect(c).toBeLessThanOrEqual(0.39);
      // 应为 0.01 步长
      expect((c * 100) % 1).toBeCloseTo(0);
    }
  });
  it('同一种子产生相同序列', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });
});

describe('buffMult（单一总和：max(10%, 1 + Σ增伤 − Σ减伤)）', () => {
  it('无增减伤时为 1', () => {
    expect(buffMult(1, 1, 0)).toBe(1);
  });
  it('增伤相加：造成侧 + 受到侧合并为单一总和（0.4 + 0.3 → 1.7）', () => {
    expect(buffMult(1.4, 1.3, 0)).toBeCloseTo(1.7);
  });
  it('增伤与减伤相互抵消：增 60% + 减 60% → 1.0（不再相乘 0.64）', () => {
    expect(buffMult(1.6, 1, 0.6)).toBeCloseTo(1.0);
  });
  it('总减伤超过 -90% 时最低保留 10%', () => {
    expect(buffMult(1, 1, 0.95)).toBeGreaterThanOrEqual(0.1);
    expect(buffMult(1, 1, 0.5)).toBeCloseTo(0.5);
    expect(buffMult(1.4, 1.3, 2.6)).toBe(0.1); // 1+0.7-2.6 < 0.1 → clamp
  });
});

describe('calcHealAmount（恢复值公式：floor(round(300×兵/(3500+兵)) × 恢复率/100 × (1+恢复提高))）', () => {
  it('实战验证锚点：9500 兵 × 181% → round(219.23)=219 × 1.81 = 396.39 → 396', () => {
    expect(calcHealAmount(9500, 181)).toBe(396);
  });
  it('10000 兵 × 100% → round(222.22)=222', () => {
    expect(calcHealAmount(10000, 100)).toBe(222);
  });
  it('兵力 0 时恢复 0', () => {
    expect(calcHealAmount(0, 100)).toBe(0);
  });
});

describe('scaledValue / roundRate', () => {
  it('谋略=80 时取基础值', () => {
    expect(scaledValue(89.6, 0.7, 80)).toBeCloseTo(89.6);
  });
  it('谋略>80 时线性增长', () => {
    expect(scaledValue(89.6, 0.7, 100)).toBeCloseTo(103.6);
  });
  it('谋略<80 时线性回落', () => {
    expect(scaledValue(89.6, 0.7, 40)).toBeCloseTo(89.6 * 0.7);
  });
  it('八舍九入：百分位 9 进位，否则舍去', () => {
    expect(roundRate(103.5)).toBe(103);
    expect(roundRate(103.9)).toBe(104);
  });
});

describe('calcDamage', () => {
  it('三部分之和 = 总伤害，且 > 0', () => {
    const rng = new Rng(1);
    const { damage, breakdown } = calcDamage(
      {
        damageType: 'physical',
        rate: 100,
        attackerAttack: 150,
        attackerStrategy: 80,
        attackerTroops: 10000,
        targetDefense: 80,
        targetStrategy: 60,
        mult: 1,
      },
      rng
    );
    expect(damage).toBe(breakdown.troopBase + breakdown.base + breakdown.main);
    expect(damage).toBeGreaterThan(0);
  });
  it('兵刃伤害命中兵力上限截断', () => {
    const rng = new Rng(2);
    const { damage } = calcDamage(
      {
        damageType: 'physical',
        rate: 300,
        attackerAttack: 300,
        attackerStrategy: 80,
        attackerTroops: 10000,
        targetDefense: 50,
        targetStrategy: 60,
        mult: 1,
      },
      rng
    );
    expect(applyTroopCap(damage, 100)).toBe(100);
  });
  it('谋略伤害无宏观随机：同配置同种子伤害一致', () => {
    const base = { damageType: 'strategy' as const, rate: 100, attackerAttack: 100, attackerStrategy: 150, attackerTroops: 10000, targetDefense: 80, targetStrategy: 60, mult: 1 };
    const a = calcDamage(base, new Rng(99)).damage;
    const b = calcDamage(base, new Rng(99)).damage;
    expect(a).toBe(b);
  });
});
