/**
 * 伤害数学模型 · 参数敏感性曲线（浏览器端）
 * ---------------------------------------------------------------------------
 * 目的：把「某输出武将换战法 / 换队友 / 换兵种后伤害怎么变」变成可以直接读的解析曲线，
 *      并为后续「前三回合总伤最大化 / 防御体系选择」提供可微的模型底座。
 *
 * 三条铁律：
 *  ① 模型不是模拟采样，而是**引擎解析公式本身**——直接 import src/engine/formulas.ts 的
 *     calcDamage / buffMult / troopCounterReduce / scaledValue / roundRate / targetStratMitigation，
 *     页面上每个数字与真实战报同源（引擎公式改动自动同步，不存在复制粘贴走样）。
 *  ② 伤害 = 兵力基础 + 属性基础 + 主要伤害；唯一随机项是攻击基础系数 {0.30…0.39}（10 档等概率），
 *     故用「系数索引桩 Rng」把 10 档全部枚举 → 期望 / 最低 / 最高 三个口径都是精确定值，不是抽样。
 *  ③ 自变量 x 可切换（兵力·攻击·攻防差·谋略·目标谋略·伤害率·增伤·减伤·目标数）；
 *     每条曲线 = 一组参数覆盖 →「换战法 / 换队友 / 换兵种」统一表达为「覆盖某几个参数」。
 *
 * 模型（引擎口径，逐项对应 formulas.ts）：
 *   兵刃 y = round(373·兵/(7700+兵)) + round(攻 × c × 率/100 × M) + round(unit(兵) × 率/100 × 攻防差(攻−防) × M)
 *   谋略 y = round(178·兵/(6459+兵)) + round(谋 × 0.5 × 减伤(目标谋略) × M) + round(unit(兵) × 率/100 × 减伤(目标谋略) × M)
 *   其中 unit(兵) = 300·兵/(3500+兵)；c ∈ {0.30…0.39} 仅兵刃有；M = 增减伤单一总和 = max(10%, 1+Σ增伤−Σ减伤)（含兵种克制 −30%）
 *   多目标：单次伤害 × 目标数（不含每个目标各自的兵力截断）
 */
import {
  attrFactor,
  buffMult,
  calcDamage,
  roundRate,
  scaledValue,
  targetStratMitigation,
  troopBaseDamage,
  troopCounterReduce,
  unitDamage,
} from '../src/engine/formulas';
import type { Rng } from '../src/engine/rng';
import type { DamageType, TroopType } from '../src/engine/types';

// ─────────────────────────────── 模型层 ───────────────────────────────

/** 引擎攻击基础随机系数档数（formulas.ts ATK_BASE_COEFFS 长 10：0.30…0.39） */
export const COEFF_STEPS = 10;

/** 系数索引桩：calcDamage 只在兵刃分支调用 rng.int(10) → 精确取第 index 档系数 */
function stubRng(index: number): Rng {
  return { int: () => index } as unknown as Rng;
}

export interface ModelParams {
  damageType: DamageType;
  /** 我方当前兵力 */
  troops: number;
  attack: number;
  /** 目标防御（兵刃用） */
  defense: number;
  strategy: number;
  /** 目标谋略（谋略减伤用） */
  targetStrategy: number;
  /** 伤害率 %（谋略段可被谋略缩放） */
  rate: number;
  /** 伤害率是否受谋略缩放（roundRate(scaledValue(rate, growth, 谋略))） */
  strategyScaled: boolean;
  /** 每点谋略增加的伤害率百分点 */
  growth: number;
  /** 造成侧增伤合计（分数，0.3 = +30%） */
  boostCaused: number;
  /** 受到侧增伤合计（分数） */
  boostTaken: number;
  /** 目标减伤合计（分数） */
  reduce: number;
  /** DoT（妖术/燃烧/恐慌）：兵力基础 ×1/3、谋略基础 ×0.25 */
  dot: boolean;
  /** 目标数（等比放大，不含逐目标兵力截断） */
  targets: number;
  attackerTroop: TroopType;
  targetTroop: TroopType;
}

export const DEFAULT_PARAMS: ModelParams = {
  damageType: 'physical',
  troops: 9000,
  attack: 200,
  defense: 150,
  strategy: 200,
  targetStrategy: 100,
  rate: 100,
  strategyScaled: false,
  growth: 0,
  boostCaused: 0,
  boostTaken: 0,
  reduce: 0,
  dot: false,
  targets: 1,
  attackerTroop: 'infantry',
  targetTroop: 'infantry',
};

/** 有效伤害率：谋略段受谋略缩放后按 1% 粒度「八舍九入」（同 action.ts:1882） */
export function effectiveRate(p: ModelParams): number {
  if (p.damageType === 'strategy' && p.strategyScaled) {
    return roundRate(scaledValue(p.rate, p.growth, p.strategy));
  }
  return p.rate;
}

/** 增减伤因子 M：单一总和 max(10%, 1+Σ增伤−Σ减伤)，兵种克制 −30% 并入 Σ减伤 */
export function damageMult(p: ModelParams): number {
  const reduce = p.reduce + troopCounterReduce(p.attackerTroop, p.targetTroop);
  return buffMult(1 + p.boostCaused, 1 + p.boostTaken, reduce);
}

export interface HitParts {
  troopBase: number;
  base: number;
  main: number;
}

export interface HitStats {
  /** 期望总伤害（10 档系数均值 × 目标数） */
  expected: number;
  min: number;
  max: number;
  /** 单目标期望三部分 */
  parts: HitParts;
}

/** 结算一次伤害（给定系数档位）：直接调用引擎 calcDamage */
export function hitAt(p: ModelParams, coeffIndex: number): { damage: number; parts: HitParts } {
  const targets = Math.max(1, p.targets);
  const { damage, breakdown } = calcDamage(
    {
      damageType: p.damageType,
      rate: effectiveRate(p),
      attackerAttack: p.attack,
      attackerStrategy: p.strategy,
      attackerTroops: p.troops,
      targetDefense: p.defense,
      targetStrategy: p.targetStrategy,
      mult: damageMult(p),
      isDot: p.dot,
    },
    stubRng(coeffIndex)
  );
  return { damage: damage * targets, parts: breakdown };
}

/**
 * 10 档系数全枚举 → 期望 / 最低 / 最高 / 平均三部分。
 * 兵刃伤害随系数单调（每档四舍五入后仍单调不减），故 min/max 即系数 0/9 档；
 * 这里仍全枚举以免将来公式改动破坏该假设。
 */
export function statsOf(p: ModelParams): HitStats {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let troopBase = 0;
  let base = 0;
  let main = 0;
  const targets = Math.max(1, p.targets);
  for (let i = 0; i < COEFF_STEPS; i += 1) {
    const hit = hitAt(p, i);
    sum += hit.damage;
    if (hit.damage < min) min = hit.damage;
    if (hit.damage > max) max = hit.damage;
    troopBase += hit.parts.troopBase;
    base += hit.parts.base;
    main += hit.parts.main;
  }
  return {
    expected: sum / COEFF_STEPS,
    min,
    max,
    parts: { troopBase: troopBase / COEFF_STEPS, base: base / COEFF_STEPS, main: main / COEFF_STEPS },
  };
}

// ─────────────────────────── 自变量（x 轴）───────────────────────────

export interface XAxisDef {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** 读数锚点（表格默认取该 x） */
  anchor: number;
  /** 该轴上 x 值的展示格式 */
  format: (v: number) => string;
  /** 把 x 值写进参数集 */
  apply: (p: ModelParams, v: number) => ModelParams;
}

const plain = (v: number): string => String(Math.round(v));

export const X_AXES: XAxisDef[] = [
  {
    key: 'troops',
    label: '兵力（当前兵力）',
    unit: '兵',
    min: 0,
    max: 12000,
    step: 200,
    anchor: 9000,
    format: plain,
    apply: (p, v) => ({ ...p, troops: v }),
  },
  {
    key: 'attack',
    label: '攻击属性',
    unit: '',
    min: 0,
    max: 600,
    step: 10,
    anchor: 200,
    format: plain,
    apply: (p, v) => ({ ...p, attack: v }),
  },
  {
    key: 'attackDiff',
    label: '攻防差（攻击 − 目标防御）',
    unit: '',
    min: -200,
    max: 400,
    step: 10,
    anchor: 50,
    format: plain,
    apply: (p, v) => ({ ...p, attack: p.defense + v }),
  },
  {
    key: 'defense',
    label: '目标防御',
    unit: '',
    min: 0,
    max: 600,
    step: 10,
    anchor: 150,
    format: plain,
    apply: (p, v) => ({ ...p, defense: v }),
  },
  {
    key: 'strategy',
    label: '谋略属性',
    unit: '',
    min: 0,
    max: 500,
    step: 10,
    anchor: 200,
    format: plain,
    apply: (p, v) => ({ ...p, strategy: v }),
  },
  {
    key: 'targetStrategy',
    label: '目标谋略（谋略减伤）',
    unit: '',
    min: 0,
    max: 400,
    step: 10,
    anchor: 100,
    format: plain,
    apply: (p, v) => ({ ...p, targetStrategy: v }),
  },
  {
    key: 'rate',
    label: '伤害率',
    unit: '%',
    min: 0,
    max: 600,
    step: 10,
    anchor: 100,
    format: (v) => `${Math.round(v)}%`,
    apply: (p, v) => ({ ...p, rate: v }),
  },
  {
    key: 'boostCaused',
    label: '造成侧增伤（我方 Σ增伤）',
    unit: '%',
    min: -90,
    max: 300,
    step: 5,
    anchor: 0,
    format: (v) => `${Math.round(v)}%`,
    apply: (p, v) => ({ ...p, boostCaused: v / 100 }),
  },
  {
    key: 'reduce',
    label: '目标减伤（Σ减伤）',
    unit: '%',
    min: 0,
    max: 95,
    step: 5,
    anchor: 0,
    format: (v) => `${Math.round(v)}%`,
    apply: (p, v) => ({ ...p, reduce: v / 100 }),
  },
  {
    key: 'targets',
    label: '目标数',
    unit: '个',
    min: 1,
    max: 5,
    step: 1,
    anchor: 1,
    format: (v) => `${Math.round(v)} 个`,
    apply: (p, v) => ({ ...p, targets: v }),
  },
];

export function axisByKey(key: string): XAxisDef {
  return X_AXES.find((a) => a.key === key) ?? X_AXES[0];
}

/** 采样点（60 段，含两端） */
export function axisSamples(axis: XAxisDef, segments = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    out.push(axis.min + ((axis.max - axis.min) * i) / segments);
  }
  return out;
}

// ─────────────────────────── 曲线（方案）───────────────────────────

export interface CurveDef {
  id: string;
  name: string;
  color: string;
  /** 相对基准参数的覆盖值（换战法/换队友/换兵种都落在这里） */
  overrides: Partial<ModelParams>;
}

export const CURVE_COLORS = ['#4da3ff', '#3ddc97', '#ffce67', '#ff6b6b', '#b48cff', '#5ad0e6'];

export const DEFAULT_CURVES: CurveDef[] = [
  { id: 'base', name: '基准', color: CURVE_COLORS[0], overrides: {} },
  { id: 'ally-boost', name: '队友增伤 +30%', color: CURVE_COLORS[1], overrides: { boostCaused: 0.3 } },
  { id: 'enemy-reduce', name: '目标减伤 30%', color: CURVE_COLORS[2], overrides: { reduce: 0.3 } },
];

/** 曲线可覆盖的字段（每条曲线只允许覆盖一个字段——单变量对比才读得清） */
export interface OverrideFieldDef {
  key: keyof ModelParams;
  label: string;
  kind: 'number' | 'select';
  step?: number;
  options?: Array<[string, string]>;
  /** UI 值 = 参数值 × 该系数（百分比字段 UI 用 %） */
  uiScale?: number;
}

export const TROOP_OPTIONS: Array<[string, string]> = [
  ['cavalry', '骑兵'],
  ['infantry', '步兵'],
  ['archer', '弓兵'],
];

export const OVERRIDE_FIELDS: OverrideFieldDef[] = [
  { key: 'boostCaused', label: '造成侧增伤 %', kind: 'number', step: 5, uiScale: 100 },
  { key: 'reduce', label: '目标减伤 %', kind: 'number', step: 5, uiScale: 100 },
  { key: 'boostTaken', label: '目标受到侧增伤 %', kind: 'number', step: 5, uiScale: 100 },
  { key: 'troops', label: '兵力', kind: 'number', step: 100 },
  { key: 'attack', label: '攻击属性', kind: 'number', step: 10 },
  { key: 'strategy', label: '谋略属性', kind: 'number', step: 10 },
  { key: 'defense', label: '目标防御', kind: 'number', step: 10 },
  { key: 'targetStrategy', label: '目标谋略', kind: 'number', step: 10 },
  { key: 'rate', label: '伤害率 %', kind: 'number', step: 10 },
  { key: 'targets', label: '目标数', kind: 'number', step: 1 },
  { key: 'attackerTroop', label: '我方兵种', kind: 'select', options: TROOP_OPTIONS },
  { key: 'targetTroop', label: '目标兵种', kind: 'select', options: TROOP_OPTIONS },
  {
    key: 'damageType',
    label: '伤害类型',
    kind: 'select',
    options: [
      ['physical', '兵刃'],
      ['strategy', '谋略'],
    ],
  },
];

export function overrideFieldByKey(key: string): OverrideFieldDef {
  return OVERRIDE_FIELDS.find((f) => f.key === key) ?? OVERRIDE_FIELDS[0];
}

/** 覆盖值 → 参数值（UI 单位换算：百分比字段 UI 是 %，模型里是分数） */
export function overrideValue(field: OverrideFieldDef, raw: number): number | TroopType | DamageType {
  if (field.uiScale) return raw / field.uiScale;
  return raw;
}

// ─────────────────────────── 指标（y 口径）───────────────────────────

export type YMetric = 'expected' | 'band' | 'parts' | 'delta' | 'marginal';

export const Y_METRICS: Array<{ key: YMetric; label: string; hint: string }> = [
  { key: 'expected', label: '期望伤害', hint: '10 档系数均值：单次伤害的期望值' },
  { key: 'band', label: '期望 + 波动区间', hint: '期望线 + 最低（系数 0.30）/ 最高（0.39）虚线' },
  { key: 'parts', label: '三部分拆解', hint: '兵力基础 / 属性基础 / 主要伤害 各自随 x 变化' },
  { key: 'delta', label: '相对基准增幅 %', hint: '以第 1 条曲线为基准，各曲线相对它的伤害变化百分比' },
  { key: 'marginal', label: '边际收益 Δy/Δx', hint: '每增加 1 单位 x 带来多少伤害——用来找拐点/最优加点' },
];

export interface ChartSeries {
  name: string;
  color: string;
  dash?: string;
  /** 是否绘制波动带（基准曲线） */
  band?: Array<{ x: number; min: number; max: number }>;
  points: Array<{ x: number; y: number; expected: number; min: number; max: number; parts: HitParts }>;
}

interface SamplePoint {
  x: number;
  expected: number;
  min: number;
  max: number;
  parts: HitParts;
}

/** 逐曲线采样（先用参数集采样，再按指标变换） */
export function buildSeries(
  params: ModelParams,
  curves: CurveDef[],
  axis: XAxisDef,
  metric: YMetric,
  segments = 60
): ChartSeries[] {
  const xs = axisSamples(axis, segments);
  const raw: SamplePoint[][] = curves.map((c) => {
    const p: ModelParams = { ...params, ...c.overrides };
    return xs.map((xv) => {
      const st = statsOf(axis.apply(p, xv));
      return { x: xv, expected: st.expected, min: st.min, max: st.max, parts: st.parts };
    });
  });

  const baseSeries = raw[0] ?? [];

  const toSeries = (
    i: number,
    name: string,
    color: string,
    pick: (pt: SamplePoint, idx: number) => number,
    dash?: string
  ): ChartSeries => ({
    name,
    color,
    dash,
    points: raw[i].map((pt, idx) => ({
      x: pt.x,
      y: pick(pt, idx),
      expected: pt.expected,
      min: pt.min,
      max: pt.max,
      parts: pt.parts,
    })),
  });

  if (metric === 'parts') {
    const out: ChartSeries[] = [];
    const parts: Array<{ key: keyof HitParts; label: string; dash: string }> = [
      { key: 'troopBase', label: '兵力基础', dash: '' },
      { key: 'base', label: '属性基础', dash: '7 4' },
      { key: 'main', label: '主要伤害', dash: '2 3' },
    ];
    curves.forEach((c, i) => {
      parts.forEach((pt) => {
        out.push(toSeries(i, `${c.name} · ${pt.label}`, c.color, (s) => s.parts[pt.key], pt.dash));
      });
    });
    return out;
  }

  if (metric === 'delta') {
    return curves.map((c, i) =>
      toSeries(i, c.name, c.color, (pt, idx) => {
        const b = baseSeries[idx]?.expected ?? 0;
        return b === 0 ? 0 : ((pt.expected - b) / b) * 100;
      })
    );
  }

  if (metric === 'marginal') {
    return curves.map((c, i) =>
      toSeries(i, c.name, c.color, (_pt, idx) => {
        const arr = raw[i];
        const prev = arr[Math.max(0, idx - 1)];
        const next = arr[Math.min(arr.length - 1, idx + 1)];
        const dx = next.x - prev.x;
        return dx === 0 ? 0 : (next.expected - prev.expected) / dx;
      })
    );
  }

  const withBand = metric === 'band';
  return curves.map((c, i) => {
    const s = toSeries(i, c.name, c.color, (pt) => pt.expected, '');
    if (withBand) s.band = raw[i].map((pt) => ({ x: pt.x, min: pt.min, max: pt.max }));
    return s;
  });
}

// ─────────────────────────────── 页面 ───────────────────────────────

interface ViewState {
  params: ModelParams;
  curves: CurveDef[];
  axisKey: string;
  metric: YMetric;
}

const fmt = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtSigned = (n: number, digits = 1): string => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), digits)}`;

/** 参数面板字段 */
interface ParamFieldDef {
  key: keyof ModelParams;
  label: string;
  kind: 'number' | 'toggle' | 'select';
  min?: number;
  max?: number;
  step?: number;
  /** UI 值 = 参数值 × uiScale */
  uiScale?: number;
  options?: Array<[string, string]>;
  hint?: string;
}

const PARAM_GROUPS: Array<{ title: string; fields: ParamFieldDef[] }> = [
  {
    title: '谁打谁',
    fields: [
      {
        key: 'damageType',
        label: '伤害类型',
        kind: 'select',
        options: [
          ['physical', '兵刃（攻击）'],
          ['strategy', '谋略（策略）'],
        ],
      },
      { key: 'troops', label: '我方兵力', kind: 'number', min: 0, max: 20000, step: 100 },
      { key: 'attackerTroop', label: '我方兵种', kind: 'select', options: TROOP_OPTIONS },
      { key: 'targetTroop', label: '目标兵种', kind: 'select', options: TROOP_OPTIONS, hint: '步兵→骑兵 / 弓兵→步兵 / 骑兵→弓兵 触发克制 −30%' },
      { key: 'targets', label: '目标数', kind: 'number', min: 1, max: 5, step: 1 },
    ],
  },
  {
    title: '属性',
    fields: [
      { key: 'attack', label: '攻击属性（兵刃用）', kind: 'number', min: 0, max: 800, step: 5 },
      { key: 'defense', label: '目标防御', kind: 'number', min: 0, max: 800, step: 5 },
      { key: 'strategy', label: '谋略属性', kind: 'number', min: 0, max: 800, step: 5 },
      { key: 'targetStrategy', label: '目标谋略（谋略减伤）', kind: 'number', min: 0, max: 800, step: 5 },
    ],
  },
  {
    title: '战法 / 伤害率',
    fields: [
      { key: 'rate', label: '伤害率 %', kind: 'number', min: 0, max: 1000, step: 5 },
      { key: 'strategyScaled', label: '伤害率受谋略缩放', kind: 'toggle' },
      { key: 'growth', label: '成长率（%/点谋略）', kind: 'number', min: 0, max: 3, step: 0.05 },
      { key: 'dot', label: 'DoT（妖术 / 燃烧 / 恐慌）', kind: 'toggle', hint: '兵力基础 ×1/3、谋略基础 ×0.25' },
    ],
  },
  {
    title: '增减伤（战法 / 队友 / 兵种）',
    fields: [
      { key: 'boostCaused', label: '造成侧增伤 %', kind: 'number', uiScale: 100, step: 5 },
      { key: 'boostTaken', label: '目标受到侧增伤 %', kind: 'number', uiScale: 100, step: 5 },
      { key: 'reduce', label: '目标减伤 %', kind: 'number', uiScale: 100, min: 0, max: 100, step: 5 },
    ],
  },
];

const CHART = { w: 980, h: 470, ml: 68, mr: 22, mt: 20, mb: 48 };

export function mountDamageModel(root: HTMLElement): void {
  const state: ViewState = {
    params: { ...DEFAULT_PARAMS },
    curves: DEFAULT_CURVES.map((c) => ({ ...c, overrides: { ...c.overrides } })),
    axisKey: X_AXES[0].key,
    metric: 'expected',
  };

  root.innerHTML = `
    <div class="dm-wrap">
      <header class="dm-head">
        <div>
          <h1>伤害数学模型 · 参数敏感性曲线</h1>
          <p class="dm-sub">
            曲线由引擎解析公式直采（<code>src/engine/formulas.ts</code> 的 <code>calcDamage</code>），
            非模拟近似；唯一随机项是攻击基础系数 <code>{0.30…0.39}</code>，10 档全枚举 → 期望 / 最低 / 最高 均为定值。
          </p>
        </div>
        <a class="dm-back" href="/index.html">← 返回配将</a>
      </header>
      <div class="dm-grid">
        <aside class="dm-card dm-params" id="dm-params"></aside>
        <main class="dm-main">
          <section class="dm-card">
            <div class="dm-controls">
              <label class="dm-ctl"><span>横轴 x</span><select id="dm-axis"></select></label>
              <label class="dm-ctl"><span>纵轴 y</span><select id="dm-metric"></select></label>
              <div class="dm-metric-hint" id="dm-metric-hint"></div>
            </div>
            <div class="dm-legend" id="dm-legend"></div>
            <div class="dm-chart" id="dm-chart"></div>
          </section>
          <section class="dm-card">
            <h2>曲线（方案对比）</h2>
            <p class="dm-note">每条曲线 = 基准参数 + 一处覆盖 → 回答「换一个战法 / 一个队友 / 一个兵种，伤害差多少」。</p>
            <div class="dm-curves" id="dm-curves"></div>
            <button class="dm-btn" id="dm-add-curve" type="button">＋ 加一条曲线</button>
          </section>
          <section class="dm-card">
            <h2>读数 <span class="dm-anchor" id="dm-anchor"></span></h2>
            <div id="dm-readout"></div>
          </section>
          <section class="dm-card">
            <h2>模型展开（把当前基准参数代进公式）</h2>
            <div id="dm-explain"></div>
          </section>
        </main>
      </div>
      <div class="dm-tooltip" id="dm-tooltip"></div>
    </div>
  `;

  const paramsEl = root.querySelector<HTMLElement>('#dm-params')!;
  const axisEl = root.querySelector<HTMLSelectElement>('#dm-axis')!;
  const metricEl = root.querySelector<HTMLSelectElement>('#dm-metric')!;
  const hintEl = root.querySelector<HTMLElement>('#dm-metric-hint')!;
  const chartEl = root.querySelector<HTMLElement>('#dm-chart')!;
  const legendEl = root.querySelector<HTMLElement>('#dm-legend')!;
  const curvesEl = root.querySelector<HTMLElement>('#dm-curves')!;
  const readoutEl = root.querySelector<HTMLElement>('#dm-readout')!;
  const explainEl = root.querySelector<HTMLElement>('#dm-explain')!;
  const anchorEl = root.querySelector<HTMLElement>('#dm-anchor')!;
  const tooltipEl = root.querySelector<HTMLElement>('#dm-tooltip')!;

  axisEl.innerHTML = X_AXES.map((a) => `<option value="${a.key}">${a.label}</option>`).join('');
  axisEl.value = state.axisKey;
  metricEl.innerHTML = Y_METRICS.map((m) => `<option value="${m.key}">${m.label}</option>`).join('');
  metricEl.value = state.metric;

  // ── 参数面板（只渲染一次；输入 → 更新模型 → 重绘图表）──
  function renderParams(): void {
    paramsEl.innerHTML = PARAM_GROUPS.map(
      (g) => `
      <div class="dm-group">
        <div class="dm-group-title">${g.title}</div>
        ${g.fields
          .map((f) => {
            const raw = state.params[f.key];
            if (f.kind === 'select') {
              return `<label class="dm-field" title="${f.hint ?? ''}"><span>${f.label}</span>
                <select data-param="${String(f.key)}">${(f.options ?? [])
                  .map(([v, t]) => `<option value="${v}" ${raw === v ? 'selected' : ''}>${t}</option>`)
                  .join('')}</select></label>`;
            }
            if (f.kind === 'toggle') {
              return `<label class="dm-field dm-field-toggle" title="${f.hint ?? ''}">
                <span>${f.label}</span>
                <input type="checkbox" data-param="${String(f.key)}" ${raw ? 'checked' : ''} /></label>`;
            }
            const ui = typeof raw === 'number' ? raw * (f.uiScale ?? 1) : Number(raw);
            return `<label class="dm-field" title="${f.hint ?? ''}"><span>${f.label}</span>
              <input type="number" data-param="${String(f.key)}" value="${ui}" step="${f.step ?? 1}"
                ${f.min === undefined ? '' : `min="${f.min}"`} ${f.max === undefined ? '' : `max="${f.max}"`} /></label>`;
          })
          .join('')}
      </div>`
    ).join('');

    paramsEl.querySelectorAll<HTMLElement>('[data-param]').forEach((el) => {
      const key = el.dataset.param as keyof ModelParams;
      const field = PARAM_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key);
      const handler = (): void => {
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          (state.params as unknown as Record<string, unknown>)[key] = el.checked;
        } else if (el instanceof HTMLSelectElement) {
          (state.params as unknown as Record<string, unknown>)[key] = el.value;
        } else if (el instanceof HTMLInputElement) {
          const v = Number(el.value);
          if (!Number.isFinite(v)) return;
          (state.params as unknown as Record<string, unknown>)[key] = field?.uiScale ? v / field.uiScale : v;
        }
        draw();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  }

  // ── 曲线列表 ──
  function renderCurves(): void {
    curvesEl.innerHTML = state.curves
      .map((c, i) => {
        const [fieldKey, fieldValue] = firstOverride(c);
        const field = overrideFieldByKey(fieldKey);
        const valueControl =
          field.kind === 'select'
            ? `<select data-curve-field-value="${i}">${(field.options ?? [])
                .map(([v, t]) => `<option value="${v}" ${String(fieldValue) === v ? 'selected' : ''}>${t}</option>`)
                .join('')}</select>`
            : `<input type="number" data-curve-field-value="${i}" step="${field.step ?? 1}" value="${Number(fieldValue)}" />`;
        return `
        <div class="dm-curve" data-curve="${i}">
          <span class="dm-dot" style="background:${c.color}"></span>
          <input class="dm-curve-name" data-curve-name="${i}" value="${escapeAttr(c.name)}" />
          <select data-curve-field="${i}">
            <option value="" ${fieldKey === '' ? 'selected' : ''}>（无覆盖 · 基准）</option>
            ${OVERRIDE_FIELDS.map(
              (f) => `<option value="${String(f.key)}" ${String(f.key) === fieldKey ? 'selected' : ''}>${f.label}</option>`
            ).join('')}
          </select>
          ${fieldKey === '' ? '<span class="dm-ph">—</span>' : valueControl}
          <button class="dm-del" type="button" data-curve-del="${i}" title="删除">×</button>
        </div>`;
      })
      .join('');

    curvesEl.querySelectorAll<HTMLInputElement>('[data-curve-name]').forEach((el) => {
      el.addEventListener('input', () => {
        state.curves[Number(el.dataset.curveName)].name = el.value;
        draw();
      });
    });
    curvesEl.querySelectorAll<HTMLSelectElement>('[data-curve-field]').forEach((el) => {
      el.addEventListener('change', () => {
        const i = Number(el.dataset.curveField);
        const key = el.value as keyof ModelParams;
        if (!key) {
          state.curves[i].overrides = {};
        } else {
          state.curves[i].overrides = { [key]: defaultValueOf(overrideFieldByKey(String(key)), state.params) } as Partial<ModelParams>;
        }
        renderCurves();
        draw();
      });
    });
    curvesEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-curve-field-value]').forEach((el) => {
      const handler = (): void => {
        const i = Number(el.dataset.curveFieldValue);
        const key = firstOverride(state.curves[i])[0] as keyof ModelParams;
        if (!key) return;
        const field = overrideFieldByKey(String(key));
        if (field.kind === 'select') {
          state.curves[i].overrides = { [key]: (el as HTMLSelectElement).value } as Partial<ModelParams>;
        } else {
          const f = overrideFieldByKey(String(key));
          const v = Number((el as HTMLInputElement).value);
          if (!Number.isFinite(v)) return;
          state.curves[i].overrides = { [key]: overrideValue(f, v) } as Partial<ModelParams>;
        }
        draw();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    curvesEl.querySelectorAll<HTMLButtonElement>('[data-curve-del]').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.curveDel);
        if (state.curves.length <= 1) return;
        state.curves.splice(i, 1);
        state.curves.forEach((c, idx) => {
          c.color = CURVE_COLORS[idx % CURVE_COLORS.length];
        });
        renderCurves();
        draw();
      });
    });
  }

  function firstOverride(c: CurveDef): [string, number | string] {
    const key = Object.keys(c.overrides)[0] ?? '';
    if (!key) return ['', ''];
    const field = overrideFieldByKey(key);
    const raw = (c.overrides as unknown as Record<string, number | string>)[key];
    if (field.uiScale && typeof raw === 'number') return [key, raw * field.uiScale];
    return [key, raw];
  }

  function defaultValueOf(field: OverrideFieldDef, base: ModelParams): number | string {
    const raw = (base as unknown as Record<string, number | string>)[String(field.key)];
    if (field.kind === 'select') return String(raw);
    if (field.uiScale) return Number(raw) * field.uiScale;
    return Number(raw);
  }

  // ── 绘制 ──
  function draw(): void {
    const axis = axisByKey(state.axisKey);
    const metric = state.metric;
    const series = buildSeries(state.params, state.curves, axis, metric);
    hintEl.textContent = Y_METRICS.find((m) => m.key === metric)?.hint ?? '';
    renderChart(series, axis, metric);
    renderLegend(series, axis, metric);
    renderReadout(axis);
    renderExplain(axis);
  }

  function renderLegend(series: ChartSeries[], axis: XAxisDef, metric: YMetric): void {
    const rows = series
      .filter((s) => metric !== 'parts' || s.dash === '')
      .map(
        (s) =>
          `<span><i class="dm-line" style="background:${s.color}"></i>${
            metric === 'parts' ? s.name.replace(/ · 兵力基础$/, '') : s.name
          }</span>`
      );
    const band = series.some((s) => s.band);
    legendEl.innerHTML =
      rows.join('') +
      (band ? `<span><i class="dm-line dm-line-band"></i>波动区间（最低~最高）</span>` : '') +
      (metric === 'parts'
        ? `<span class="dm-legend-note">同色三线：实线=兵力基础 · 长虚线=属性基础 · 短虚线=主要伤害</span>`
        : '');
  }

  function renderChart(series: ChartSeries[], axis: XAxisDef, metric: YMetric): void {
    const { w, h, ml, mr, mt, mb } = CHART;
    const xs = series[0]?.points.map((p) => p.x) ?? [axis.min, axis.max];
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    series.forEach((s) => {
      s.points.forEach((p) => {
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
      });
      s.band?.forEach((b) => {
        yMin = Math.min(yMin, b.min);
        yMax = Math.max(yMax, b.max);
      });
    });
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    if (metric !== 'delta' && metric !== 'marginal') yMin = Math.min(yMin, 0);
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;

    const xTo = (v: number): number => ml + ((v - axis.min) / (axis.max - axis.min || 1)) * (w - ml - mr);
    const yTo = (v: number): number => mt + (1 - (v - yMin) / (yMax - yMin || 1)) * (h - mt - mb);

    let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="伤害曲线">`;
    // y 网格
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i += 1) {
      const v = yMin + ((yMax - yMin) * i) / ySteps;
      const y = yTo(v);
      svg += `<line class="dm-grid" x1="${ml}" y1="${y}" x2="${w - mr}" y2="${y}" />`;
      svg += `<text class="dm-axis" x="${ml - 8}" y="${y + 4}" text-anchor="end">${fmt(v, Math.abs(yMax - yMin) < 20 ? 1 : 0)}${
        metric === 'delta' ? '%' : ''
      }</text>`;
    }
    // x 网格
    const xSteps = 6;
    for (let i = 0; i <= xSteps; i += 1) {
      const v = axis.min + ((axis.max - axis.min) * i) / xSteps;
      const x = xTo(v);
      svg += `<line class="dm-grid" x1="${x}" y1="${mt}" x2="${x}" y2="${h - mb}" />`;
      svg += `<text class="dm-axis" x="${x}" y="${h - mb + 18}" text-anchor="middle">${axis.format(v)}</text>`;
    }
    svg += `<text class="dm-lbl" x="${(ml + w - mr) / 2}" y="${h - mb + 38}" text-anchor="middle">${axis.label}${
      axis.unit ? `（${axis.unit}）` : ''
    }</text>`;
    svg += `<text class="dm-lbl" x="${ml - 8}" y="${mt - 6}" text-anchor="end">${
      metric === 'delta' ? '伤害变化 %' : metric === 'marginal' ? 'Δ伤害 / Δx' : '伤害'
    }</text>`;

    // 零线（delta）
    if (metric === 'delta' && yMin < 0 && yMax > 0) {
      svg += `<line class="dm-zero" x1="${ml}" y1="${yTo(0)}" x2="${w - mr}" y2="${yTo(0)}" />`;
    }

    // 波动带
    series.forEach((s) => {
      if (!s.band) return;
      const top = s.band.map((b) => `${xTo(b.x)} ${yTo(b.max)}`).join(' ');
      const bottom = s.band
        .slice()
        .reverse()
        .map((b) => `${xTo(b.x)} ${yTo(b.min)}`)
        .join(' ');
      svg += `<polygon points="${top} ${bottom}" fill="${s.color}" opacity="0.12" />`;
    });

    // 曲线
    series.forEach((s) => {
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${xTo(p.x)} ${yTo(p.y)}`).join(' ');
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 1.6 : 2.6}"${
        s.dash ? ` stroke-dasharray="${s.dash}"` : ''
      } stroke-linecap="round" />`;
    });

    // 悬停层
    svg += `<line class="dm-hover" id="dm-hoverline" x1="0" y1="${mt}" x2="0" y2="${h - mb}" opacity="0" />`;
    svg += `<rect id="dm-hoverRect" x="${ml}" y="${mt}" width="${w - ml - mr}" height="${h - mt - mb}" fill="transparent" />`;
    svg += '</svg>';
    chartEl.innerHTML = svg;

    const rect = chartEl.querySelector<SVGRectElement>('#dm-hoverRect');
    const line = chartEl.querySelector<SVGLineElement>('#dm-hoverline');
    if (!rect || !line) return;
    rect.addEventListener('mousemove', (ev) => {
      const box = chartEl.getBoundingClientRect();
      if (box.width === 0) return;
      const scale = CHART.w / box.width;
      const mx = (ev.clientX - box.left) * scale;
      const ratio = Math.min(1, Math.max(0, (mx - ml) / (w - ml - mr)));
      const xv = axis.min + ratio * (axis.max - axis.min);
      const xx = xTo(xv);
      line.setAttribute('x1', String(xx));
      line.setAttribute('x2', String(xx));
      line.setAttribute('opacity', '1');
      const rows = series
        .map((s) => {
          const near = s.points.reduce((a, b) => (Math.abs(b.x - xv) < Math.abs(a.x - xv) ? b : a), s.points[0]);
          const val = metric === 'delta' ? `${fmtSigned(near.y, 1)}%` : fmt(near.y, metric === 'marginal' ? 2 : 1);
          return `<div class="dm-tt-row"><i style="background:${s.color}"></i><span>${s.name}</span><b>${val}</b></div>`;
        })
        .join('');
      tooltipEl.innerHTML = `<div class="dm-tt-head">${axis.label} = ${axis.format(xv)}</div>${rows}`;
      tooltipEl.style.display = 'block';
      let px = ev.clientX + 16;
      let py = ev.clientY + 16;
      const tw = tooltipEl.offsetWidth;
      const th = tooltipEl.offsetHeight;
      if (px + tw > window.innerWidth - 8) px = ev.clientX - tw - 14;
      if (py + th > window.innerHeight - 8) py = ev.clientY - th - 14;
      tooltipEl.style.left = `${px}px`;
      tooltipEl.style.top = `${py}px`;
    });
    rect.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
      line.setAttribute('opacity', '0');
    });
  }

  /** 读数：把每条曲线在锚点 x 上的值列出来（含相对基准差值） */
  function renderReadout(axis: XAxisDef): void {
    const anchor = axis.anchor;
    const evaluated = state.curves.map((c) => {
      const p: ModelParams = { ...state.params, ...c.overrides };
      return statsOf(axis.apply(p, anchor));
    });
    const base = evaluated[0]?.expected ?? 0;
    anchorEl.textContent = `— ${axis.label} = ${axis.format(anchor)}`;
    const rows = state.curves
      .map((c, i) => {
        const st = evaluated[i];
        const delta = base === 0 ? 0 : ((st.expected - base) / base) * 100;
        const deltaCell =
          i === 0
            ? '<td class="dm-dim">基准</td>'
            : `<td class="${delta >= 0 ? 'dm-up' : 'dm-down'}">${fmtSigned(delta, 1)}%</td>`;
        return `<tr>
          <td><i class="dm-dot" style="background:${c.color}"></i>${escapeHtml(c.name)}</td>
          <td class="dm-num">${fmt(st.expected, 1)}</td>
          <td class="dm-num dm-dim">${fmt(st.min)} ~ ${fmt(st.max)}</td>
          ${deltaCell}
        </tr>`;
      })
      .join('');
    readoutEl.innerHTML = `<table class="dm-table">
      <thead><tr><th>方案</th><th>期望伤害</th><th>波动区间</th><th>vs 基准</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  /** 模型展开：把基准参数代进引擎公式，逐项显示数值 */
  function renderExplain(axis: XAxisDef): void {
    const p: ModelParams = { ...state.params, ...state.curves[0]?.overrides };
    const q = axis.apply(p, axis.anchor);
    const rate = effectiveRate(q);
    const mult = damageMult(q);
    const counter = troopCounterReduce(q.attackerTroop, q.targetTroop);
    const unit = Math.round(unitDamage(q.troops, q.damageType));
    const st = statsOf(q);
    const isPhysical = q.damageType === 'physical';

    const lines = isPhysical
      ? [
          `兵力基础 = round(373 × ${fmt(q.troops)} / (7700 + ${fmt(q.troops)})) = <b>${fmt(st.parts.troopBase, 1)}</b>`,
          `属性基础 = 攻击 ${fmt(q.attack)} × 系数 0.34 × 伤害率 ${fmt(rate)}% × 增减伤 ${mult.toFixed(2)} = <b>${fmt(
            st.parts.base,
            1
          )}</b>`,
          `主要伤害 = unit(${fmt(q.troops)}) ${fmt(unit)} × ${fmt(rate)}% × 攻防差因子 ${attrFactor(
            q.attack - q.defense
          ).toFixed(2)}（攻防差 ${fmt(q.attack - q.defense)}） × 增减伤 ${mult.toFixed(2)} = <b>${fmt(st.parts.main, 1)}</b>`,
        ]
      : [
          `兵力基础 = round(178 × ${fmt(q.troops)} / (6459 + ${fmt(q.troops)}))${q.dot ? ' × 1/3（DoT）' : ''} = <b>${fmt(
            st.parts.troopBase,
            1
          )}</b>`,
          `属性基础 = 谋略 ${fmt(q.strategy)} × ${q.dot ? '0.25（DoT）' : '0.5'} × 目标谋略减伤 ${targetStratMitigation(
            q.targetStrategy
          ).toFixed(2)} × 增减伤 ${mult.toFixed(2)} = <b>${fmt(st.parts.base, 1)}</b>`,
          `主要伤害 = unit(${fmt(q.troops)}) ${fmt(unit)} × 有效伤害率 ${fmt(rate)}% × 目标谋略减伤 ${targetStratMitigation(
            q.targetStrategy
          ).toFixed(2)} × 增减伤 ${mult.toFixed(2)} = <b>${fmt(st.parts.main, 1)}</b>`,
        ];

    const scaledNote = q.strategyScaled
      ? `<div class="dm-note-line">有效伤害率 = 八舍九入(${fmt(q.rate)}% + (谋略 ${fmt(q.strategy)} − 80) × ${q.growth}%) = <b>${fmt(
          rate
        )}%</b></div>`
      : '';

    const targets = Math.max(1, q.targets);
    explainEl.innerHTML = `
      <div class="dm-formula">${lines.map((l) => `<div class="dm-note-line">${l}</div>`).join('')}</div>
      ${scaledNote}
      <div class="dm-note-line">增减伤 M = max(10%, 1 + 增伤 ${fmt(q.boostCaused * 100)}% + 受到增伤 ${fmt(
        q.boostTaken * 100
      )}% − 减伤 ${fmt(q.reduce * 100)}%${counter ? ' − 兵种克制 30%' : ''}) = <b>${mult.toFixed(2)}</b></div>
      <div class="dm-note-line dm-sum">单目标三部分合计（期望档）≈ <b>${fmt(st.expected / targets, 1)}</b>
        ${targets > 1 ? ` × 目标 ${targets} = <b>${fmt(st.expected, 1)}</b>` : ''}
        （10 档系数均值；波动区间 ${fmt(st.min)} ~ ${fmt(st.max)}）</div>
      <div class="dm-note">口径与引擎一致：三部分各自四舍五入后相加，最后与 1 取 max；兵力截断按目标当前兵力另算。</div>
    `;
  }

  axisEl.addEventListener('change', () => {
    state.axisKey = axisEl.value;
    draw();
  });
  metricEl.addEventListener('change', () => {
    state.metric = metricEl.value as YMetric;
    draw();
  });
  root.querySelector<HTMLButtonElement>('#dm-add-curve')?.addEventListener('click', () => {
    if (state.curves.length >= CURVE_COLORS.length) return;
    const i = state.curves.length;
    state.curves.push({
      id: `curve-${Date.now()}`,
      name: `方案 ${i + 1}`,
      color: CURVE_COLORS[i % CURVE_COLORS.length],
      overrides: { boostCaused: 0.3 },
    });
    renderCurves();
    draw();
  });

  renderParams();
  renderCurves();
  draw();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] ?? m));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
