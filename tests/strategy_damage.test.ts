/**
 * 策略伤害公式校准测试（v0.10）：
 * 对照调研文档引用的参考模拟器（FlxSNX/stzbBattleSimulator，社区战报反推）：
 *   兵力基础伤害 = 178×兵/(6459+兵)
 *   谋略基础伤害 = 谋略 × 0.5（DoT ×0.25）× 目标谋略影响
 *   主要伤害     = 300×兵/(3500+兵) × 伤害率 × 目标谋略影响
 *   目标谋略影响 = inte≤50 → 1；否则 ceil(100-(75-9375/(75+inte)))/100
 * 手算基准：9000 兵、谋略 148、伤害率 218%（150% 受谋略 +1.0/点）、目标谋略 100 → 总伤 ≈ 534
 */
import { describe, it, expect } from 'vitest';
import { calcDamage, troopBaseDamage, unitDamage, targetStratMitigation, attrFactor } from '../src/engine/formulas';
import { Rng } from '../src/engine/rng';

const rng = new Rng(1);

describe('策略伤害公式（对照参考模拟器）', () => {
  it('基准：9000 兵 / 谋略 148 / 218% / 目标谋略 100 → ≈534', () => {
    const { damage, breakdown } = calcDamage(
      {
        damageType: 'strategy',
        rate: 218,
        attackerAttack: 100,
        attackerStrategy: 148,
        attackerTroops: 9000,
        targetDefense: 100,
        targetStrategy: 100,
        mult: 1,
      },
      rng
    );
    // 参考模拟器手算 ≈534（引擎中间分项取整，允许 ±6 误差）
    expect(damage).toBeGreaterThanOrEqual(528);
    expect(damage).toBeLessThanOrEqual(540);
    // 三部分各自量级：兵力基础 ~104、谋略基础 ~58、主要伤害 ~372
    expect(breakdown.troopBase).toBeGreaterThanOrEqual(100);
    expect(breakdown.troopBase).toBeLessThanOrEqual(108);
    expect(breakdown.base).toBeGreaterThanOrEqual(54);
    expect(breakdown.base).toBeLessThanOrEqual(62);
    expect(breakdown.main).toBeGreaterThanOrEqual(365);
    expect(breakdown.main).toBeLessThanOrEqual(379);
  });

  it('目标谋略 ≤50 无减伤（影响系数 = 1）', () => {
    expect(targetStratMitigation(50)).toBe(1);
    expect(targetStratMitigation(30)).toBe(1);
    const { damage } = calcDamage(
      {
        damageType: 'strategy', rate: 218, attackerAttack: 100, attackerStrategy: 148,
        attackerTroops: 9000, targetDefense: 100, targetStrategy: 50, mult: 1,
      },
      rng
    );
    // 无减伤：104 + 74 + 471 = 649
    expect(damage).toBeGreaterThanOrEqual(643);
    expect(damage).toBeLessThanOrEqual(655);
  });

  it('目标谋略 150 → 影响系数 0.67，总伤 ≈469', () => {
    expect(targetStratMitigation(150)).toBe(0.67);
    const { damage } = calcDamage(
      {
        damageType: 'strategy', rate: 218, attackerAttack: 100, attackerStrategy: 148,
        attackerTroops: 9000, targetDefense: 100, targetStrategy: 150, mult: 1,
      },
      rng
    );
    expect(damage).toBeGreaterThanOrEqual(463);
    expect(damage).toBeLessThanOrEqual(475);
  });

  it('DoT（妖术/燃烧/恐慌）：兵力基础 ×1/3、谋略基础 ×0.25', () => {
    const plain = calcDamage(
      {
        damageType: 'strategy', rate: 116, attackerAttack: 100, attackerStrategy: 148,
        attackerTroops: 9000, targetDefense: 100, targetStrategy: 100, mult: 1,
      },
      rng
    );
    const dot = calcDamage(
      {
        damageType: 'strategy', rate: 116, attackerAttack: 100, attackerStrategy: 148,
        attackerTroops: 9000, targetDefense: 100, targetStrategy: 100, mult: 1, isDot: true,
      },
      rng
    );
    // DoT 兵力基础 = 1/3、谋略基础 = 0.25/0.5；主要伤害相同
    expect(dot.breakdown.troopBase).toBe(Math.round(plain.breakdown.troopBase / 3));
    expect(dot.breakdown.base).toBe(Math.round(plain.breakdown.base / 2));
    expect(dot.breakdown.main).toBe(plain.breakdown.main);
  });

  it('单位伤害曲线：9000 兵 ≈216、10000 兵 ≈222（300×兵/(3500+兵)，物理/策略共用）', () => {
    expect(unitDamage(9000, 'strategy')).toBeCloseTo(216, 0);
    expect(unitDamage(10000, 'strategy')).toBeCloseTo(222.2, 0);
    expect(unitDamage(9000, 'physical')).toBeCloseTo(216, 0);
    expect(unitDamage(10000, 'physical')).toBeCloseTo(222.2, 0);
  });

  it('兵力基础伤害：9000 兵 ≈104、10000 兵 ≈108（178×兵/(6459+兵)）', () => {
    expect(troopBaseDamage(9000, 'strategy')).toBe(104);
    expect(troopBaseDamage(10000, 'strategy')).toBe(108);
  });
});

describe('物理伤害公式（参考模拟器校准）', () => {
  it('攻防差因子：diff=0→1.0、100→1.57、-70→0.59、-100→0.5', () => {
    expect(attrFactor(0)).toBe(1);
    expect(attrFactor(100)).toBe(1.57);
    expect(attrFactor(250)).toBe(2);
    expect(attrFactor(-70)).toBe(0.59);
    expect(attrFactor(-100)).toBe(0.5);
  });

  it('基准战例：9000 兵 / 攻击 150 / 普攻 100% / 目标防御 100 → 总伤 = 533（无宏观波动，种子 7 → 随机系数 0.3）', () => {
    const { damage, breakdown } = calcDamage(
      {
        damageType: 'physical',
        rate: 100,
        attackerAttack: 150,
        attackerStrategy: 100,
        attackerTroops: 9000,
        targetDefense: 100,
        targetStrategy: 100,
        mult: 1,
      },
      new Rng(7)
    );
    // 兵力基础 round(373×9000/16700)=201；主要 round(216×1.33)=287；攻击基础 = 150×0.3 = 45（种子 7 首个随机系数）
    expect(breakdown.troopBase).toBe(201);
    expect(breakdown.base).toBe(45);
    expect(breakdown.main).toBe(287);
    expect(damage).toBe(533);
  });
});
