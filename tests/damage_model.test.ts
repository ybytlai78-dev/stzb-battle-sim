/**
 * 伤害数学模型（web/damageModel.ts）测试
 * ① 模型与引擎同源：三部分逐项等于 formulas.ts 的组合（含系数档位映射）；
 * ② 增减伤单一总和 / 兵种克制 / 有效伤害率八舍九入；
 * ③ 10 档系数枚举 → 期望 / 最低 / 最高；谋略伤害无随机（min = max）；
 * ④ 单调性（攻击↑、兵力↑、目标谋略↑、减伤↑）；
 * ⑤ x 轴 apply（攻防差轴）、副轴采样端点；
 * ⑥ 指标变换（delta 基准恒 0、marginal 为数值差分）；
 * ⑦ jsdom 挂载：曲线数 / svg 渲染 / 切轴重绘 / 加曲线。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  COEFF_STEPS,
  DEFAULT_PARAMS,
  X_AXES,
  axisByKey,
  axisSamples,
  buildSeries,
  damageMult,
  effectiveRate,
  hitAt,
  mountDamageModel,
  overrideFieldByKey,
  overrideValue,
  statsOf,
  type ModelParams,
} from '../web/damageModel';
import {
  attrFactor,
  targetStratMitigation,
  troopBaseDamage,
  unitDamage,
} from '../src/engine/formulas';

const p = (over: Partial<ModelParams> = {}): ModelParams => ({ ...DEFAULT_PARAMS, ...over });

describe('模型层：与引擎公式同源', () => {
  it('兵刃三部分 = 兵力基础 + 攻击基础 + 主要伤害（系数档位 0/4/9 = 0.30/0.34/0.39）', () => {
    const q = p();
    const mult = damageMult(q);
    const troopBase = Math.round(troopBaseDamage(q.troops, 'physical'));
    const rateFrac = q.rate / 100;
    const main = Math.round(
      unitDamage(q.troops, 'physical') * rateFrac * attrFactor(q.attack - q.defense) * mult
    );

    const at030 = hitAt(q, 0);
    const at034 = hitAt(q, 4);
    const at039 = hitAt(q, 9);

    expect(at030.parts.troopBase).toBe(troopBase);
    expect(at034.parts.troopBase).toBe(troopBase);
    expect(at030.parts.base).toBe(Math.round(q.attack * 0.3 * rateFrac * mult));
    expect(at034.parts.base).toBe(Math.round(q.attack * 0.34 * rateFrac * mult));
    expect(at039.parts.base).toBe(Math.round(q.attack * 0.39 * rateFrac * mult));
    expect(at034.parts.main).toBe(main);
    expect(at034.damage).toBe(troopBase + at034.parts.base + main);
  });

  it('谋略三部分 = 兵力基础 + 谋略基础(×0.5×减伤) + 主要伤害(×减伤)，且无随机', () => {
    const q = p({ damageType: 'strategy', strategy: 216, targetStrategy: 129, rate: 111 });
    const mult = damageMult(q);
    const mit = targetStratMitigation(q.targetStrategy);
    const troopBase = Math.round(troopBaseDamage(q.troops, 'strategy'));

    const hit = hitAt(q, 4);
    expect(hit.parts.troopBase).toBe(troopBase);
    expect(hit.parts.base).toBe(Math.round(q.strategy * 0.5 * mit * mult));
    expect(hit.parts.main).toBe(Math.round(unitDamage(q.troops, 'strategy') * (q.rate / 100) * mit * mult));
    expect(hit.damage).toBe(troopBase + hit.parts.base + hit.parts.main);

    // 谋略伤害不含攻击基础随机 → 10 档同值
    expect(statsOf(q).min).toBe(statsOf(q).max);
  });

  it('DoT：兵力基础 ×1/3、谋略基础 ×0.25（主要伤害不变）', () => {
    const dot = p({ damageType: 'strategy', dot: true });
    const plain = p({ damageType: 'strategy', dot: false });
    const mult = damageMult(dot);
    const mit = targetStratMitigation(dot.targetStrategy);

    expect(hitAt(dot, 4).parts.troopBase).toBe(Math.round(troopBaseDamage(dot.troops, 'strategy') / 3));
    expect(hitAt(dot, 4).parts.base).toBe(Math.round(dot.strategy * 0.25 * mit * mult));
    // 主要伤害与普通策略一致
    expect(hitAt(dot, 4).parts.main).toBe(hitAt(plain, 4).parts.main);
  });
});

describe('模型层：增减伤 / 兵种克制 / 有效伤害率', () => {
  it('单一总和：增 30% 与减 30% 抵消为 1.0；减伤 95% 触发 10% 下限', () => {
    expect(damageMult(p({ boostCaused: 0.3, reduce: 0.3 }))).toBeCloseTo(1, 10);
    expect(damageMult(p({ reduce: 0.95 }))).toBeCloseTo(0.1, 10);
    expect(damageMult(p({ boostCaused: 0.6, boostTaken: 0.2, reduce: 0.3 }))).toBeCloseTo(1.5, 10);
  });

  it('兵种克制 −30%（步兵打骑兵）并入单一总和', () => {
    expect(damageMult(p({ attackerTroop: 'infantry', targetTroop: 'cavalry' }))).toBeCloseTo(0.7, 10);
    expect(damageMult(p({ attackerTroop: 'cavalry', targetTroop: 'infantry' }))).toBeCloseTo(1, 10);
    expect(damageMult(p({ attackerTroop: 'cavalry', targetTroop: 'archer' }))).toBeCloseTo(0.7, 10);
  });

  it('受谋略缩放的有效伤害率：八舍九入 + 谋略<80 线性回落', () => {
    const q = p({ damageType: 'strategy', strategyScaled: true, growth: 0.7, rate: 100 });
    expect(effectiveRate({ ...q, strategy: 200 })).toBe(184); // 100 + 0.7×120
    expect(effectiveRate({ ...q, strategy: 199 })).toBe(183); // 183.3 → 八舍九入 183
    expect(effectiveRate({ ...q, strategy: 40 })).toBe(70); // 回落：base×0.4 + base×0.6×(40/80) = 40+30
    // 未勾选缩放则原样使用
    expect(effectiveRate({ ...q, strategyScaled: false, strategy: 200 })).toBe(100);
    // 兵刃不受谋略缩放
    expect(effectiveRate({ ...q, damageType: 'physical', strategy: 200 })).toBe(100);
  });
});

describe('模型层：期望与区间', () => {
  it('期望 = 10 档系数均值，且 min ≤ 期望 ≤ max', () => {
    const q = p();
    const st = statsOf(q);
    let sum = 0;
    for (let i = 0; i < COEFF_STEPS; i += 1) sum += hitAt(q, i).damage;
    expect(st.expected).toBeCloseTo(sum / COEFF_STEPS, 10);
    expect(st.min).toBeLessThanOrEqual(st.expected);
    expect(st.expected).toBeLessThanOrEqual(st.max);
    expect(st.max).toBeGreaterThan(st.min); // 兵刃有随机带宽
  });

  it('目标数等比放大（不含逐目标兵力截断）', () => {
    const one = statsOf(p({ targets: 1 }));
    const three = statsOf(p({ targets: 3 }));
    expect(three.expected).toBeCloseTo(one.expected * 3, 6);
    expect(three.min).toBe(one.min * 3);
  });
});

describe('模型层：单调性（自变量方向）', () => {
  const series = (over: Partial<ModelParams>, axisKey: string): number[] => {
    const axis = axisByKey(axisKey);
    const q = p(over);
    return axisSamples(axis).map((v) => statsOf(axis.apply(q, v)).expected);
  };
  const nonDecreasing = (arr: number[]): boolean => arr.every((v, i) => i === 0 || v >= arr[i - 1] - 1e-9);
  const nonIncreasing = (arr: number[]): boolean => arr.every((v, i) => i === 0 || v <= arr[i - 1] + 1e-9);

  it('攻击↑ → 兵刃伤害不减；攻防差↑ 同理', () => {
    expect(nonDecreasing(series({}, 'attack'))).toBe(true);
    expect(nonDecreasing(series({}, 'attackDiff'))).toBe(true);
  });

  it('目标防御↑ → 兵刃伤害不增', () => {
    expect(nonIncreasing(series({}, 'defense'))).toBe(true);
  });

  it('兵力↑ → 伤害不减（兵刃 / 谋略同）', () => {
    expect(nonDecreasing(series({}, 'troops'))).toBe(true);
    expect(nonDecreasing(series({ damageType: 'strategy' }, 'troops'))).toBe(true);
  });

  it('目标谋略↑ → 谋略伤害不增；减伤↑ → 伤害不增', () => {
    expect(nonIncreasing(series({ damageType: 'strategy' }, 'targetStrategy'))).toBe(true);
    expect(nonIncreasing(series({}, 'reduce'))).toBe(true);
  });

  it('增伤↑ → 伤害不减', () => {
    expect(nonDecreasing(series({}, 'boostCaused'))).toBe(true);
  });
});

describe('自变量轴与指标变换', () => {
  it('攻防差轴 = 攻击 − 目标防御（保持目标防御不变）', () => {
    const axis = axisByKey('attackDiff');
    const q = axis.apply(p({ defense: 180 }), 50);
    expect(q.attack - q.defense).toBe(50);
    expect(q.defense).toBe(180);
    expect(axisSamples(axis)).toHaveLength(61);
    expect(axisSamples(axis)[0]).toBe(axis.min);
    expect(axisSamples(axis)[60]).toBe(axis.max);
  });

  it('每条轴都能独立改一个参数（不污染其他参数）', () => {
    const q = p();
    X_AXES.forEach((axis) => {
      const r = axis.apply(q, axis.anchor);
      expect(r).not.toBe(q); // 返回新对象
      const changed = (Object.keys(r) as Array<keyof ModelParams>).filter((k) => r[k] !== q[k]);
      expect(changed.length).toBeLessThanOrEqual(1);
    });
  });

  it('delta 指标：基准曲线恒 0、增伤方案 > 0；marginal 为数值差分', () => {
    const axis = axisByKey('boostCaused');
    const curves = [
      { id: 'a', name: '基准', color: '#fff', overrides: {} },
      { id: 'b', name: '+30%', color: '#000', overrides: { boostCaused: 0.3 } },
    ];
    const delta = buildSeries(p(), curves, axis, 'delta');
    expect(delta.every((s) => s.points.every((pt) => pt.y === 0))).toBe(true);

    const axis2 = axisByKey('attack');
    const marginal = buildSeries(p(), curves, axis2, 'marginal', 10);
    expect(marginal[0].points.every((pt) => pt.y >= 0)).toBe(true);
    const base = buildSeries(p(), curves, axis2, 'expected', 10);
    const mid = 5;
    const dy = base[0].points[mid + 1].y - base[0].points[mid - 1].y;
    const dx = base[0].points[mid + 1].x - base[0].points[mid - 1].x;
    expect(marginal[0].points[mid].y).toBeCloseTo(dy / dx, 10);
  });

  it('parts 指标：每条曲线拆成三部分', () => {
    const axis = axisByKey('troops');
    const curves = [{ id: 'a', name: '基准', color: '#fff', overrides: {} }];
    const s = buildSeries(p(), curves, axis, 'parts');
    expect(s).toHaveLength(3);
    expect(s.map((x) => x.dash)).toEqual(['', '7 4', '2 3']);
  });

  it('覆盖字段：UI 百分比 ↔ 模型分数', () => {
    const f = overrideFieldByKey('boostCaused');
    expect(overrideValue(f, 30)).toBeCloseTo(0.3, 10);
    expect(overrideValue(overrideFieldByKey('troops'), 9000)).toBe(9000);
  });
});

describe('页面挂载（jsdom）', () => {
  it('渲染曲线 / 图表 / 读数，切轴与加曲线都能重绘', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountDamageModel(root);

    expect(root.querySelectorAll('.dm-curve')).toHaveLength(3);
    const chart = root.querySelector<HTMLElement>('.dm-chart')!;
    expect(chart.querySelector('svg')).toBeTruthy();
    expect(chart.querySelectorAll('path')).toHaveLength(3); // 三条期望曲线
    expect(root.querySelectorAll('#dm-readout tbody tr')).toHaveLength(3);
    expect(root.querySelector('#dm-explain')!.textContent).toContain('兵力基础');
    // 渲染数值健全：任何 NaN 都说明轴映射/刻度算错
    expect(chart.innerHTML).not.toContain('NaN');
    expect(root.querySelector('#dm-explain')!.innerHTML).not.toContain('NaN');
    expect(root.querySelector('#dm-readout')!.innerHTML).not.toContain('NaN');

    // 切横轴 → 重绘（图表内容变化）
    const before = chart.innerHTML;
    const axisSel = root.querySelector<HTMLSelectElement>('#dm-axis')!;
    axisSel.value = 'reduce';
    axisSel.dispatchEvent(new Event('change'));
    expect(chart.innerHTML).not.toBe(before);
    expect(root.querySelector('#dm-explain')!.textContent).toContain('减伤');

    // 切纵轴 → 波动区间指标画出 min/max 多边形
    const metricSel = root.querySelector<HTMLSelectElement>('#dm-metric')!;
    metricSel.value = 'band';
    metricSel.dispatchEvent(new Event('change'));
    expect(chart.querySelectorAll('polygon').length).toBeGreaterThan(0);

    // 加一条曲线
    root.querySelector<HTMLButtonElement>('#dm-add-curve')!.click();
    expect(root.querySelectorAll('.dm-curve')).toHaveLength(4);

    // 改基准参数 → 读数变化
    const readoutBefore = root.querySelector('#dm-readout')!.textContent;
    const attackInput = root.querySelector<HTMLInputElement>('[data-param="attack"]')!;
    attackInput.value = '400';
    attackInput.dispatchEvent(new Event('input'));
    expect(root.querySelector('#dm-readout')!.textContent).not.toBe(readoutBefore);

    root.remove();
  });
});
