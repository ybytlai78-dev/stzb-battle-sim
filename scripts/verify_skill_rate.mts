/**
 * 伤害 → 倍率反推 CLI（只读分析工具）
 * ---------------------------------------------------------------------------
 * 用途：给定若干「代打者面板 + 增减伤/无视防御 + 实际观测到的一次伤害」，
 *   用引擎的权威公式（`src/engine/formulas.ts`）反推战法的**实际倍率区间**，
 *   并判定某个候选倍率（如加强后的 180%）是否落在区间内。
 *
 * 公式口径（与引擎逐字一致）：
 *   兵力基础 = round(373×兵力/(7700+兵力))                  —— 不吃伤害率 / 增减伤 / 目标防御
 *   攻击基础 = 攻击 × c × 倍率 × 增减伤                       —— c ∈ {0.30 … 0.39}（唯一随机源）
 *   主要伤害 = 300×兵力/(3500+兵力) × 倍率 × 攻防差因子 × 增减伤
 *   攻防差   = 攻击 − 目标防御 × (1 − 无视防御%)              —— 无视防御只作用在这里
 *   攻防差因子(差≥0) = 3 − 500/(250+差)，保留两位小数
 *   三部分各自四舍五入后相加
 *
 * 为什么必须给区间：观测伤害同时取决于**倍率 r** 与**目标防御 D** 两个未知量。
 *   单组数据只能给出一条 (r, D) 关系曲线 →
 *     · 固定 r：给出「要打出这个伤害，目标防御必须落在 [D_lo, D_hi]」；
 *     · 固定 D：给出能打出这个伤害的**倍率区间**（宽度来自随机系数 0.30~0.39）；
 *   两组数据若打**同一个目标**（D 相同），可联立消掉 D → 给出与防御无关的倍率区间。
 *
 * 用法：
 *   npx tsx scripts/verify_skill_rate.mts                    # 内置示例：陆抗【西陵克晋】180% 复核
 *   npx tsx scripts/verify_skill_rate.mts --rate 180 --joint \
 *     --obs "label=①,atk=231.7,troops=8702,boost=63,ignore=60,dmg=1510" \
 *     --obs "label=②,atk=232.7,troops=5396,boost=32,ignore=0,dmg=953"
 *   npx tsx scripts/verify_skill_rate.mts --def-step 5 --def-max 600
 *
 * 字段说明（--obs，"k=v" 逗号分隔）：
 *   atk    代打者攻击面板（可小数）        troops 代打者当前兵力
 *   boost  增减伤净值 %（造成侧增伤 − 受击方减伤；不含兵种克制）
 *   ignore 无视防御 %                      counter 兵种被克制减伤 %（缺省 0；被骑/步/弓克制填 30）
 *   dmg    观测到的最终伤害                label  备注名（缺省 #1/#2）
 *
 * 只读保证：不修改引擎、不参与战斗结算，只调用 formulas 的纯函数。
 */
import { applyIgnoreDef, calcDamage } from '../src/engine/formulas';
import type { Rng } from '../src/engine/rng';

// ─── 数据结构 ───

interface Obs {
  label: string;
  attack: number;
  troops: number;
  /** 增减伤净值 %（乘区 = 1 + boost/100） */
  boost: number;
  /** 无视防御 % */
  ignore: number;
  /** 兵种被克制减伤 %（与增减伤同一总和模型内相减） */
  counter: number;
  /** 观测到的最终伤害 */
  damage: number;
}

const COEFF_COUNT = 10; // 攻击基础随机系数 0.30 … 0.39
const RATE_MIN = 0;
const RATE_MAX = 600; // 倍率搜索上界 %
const DEF_MIN = 0;
const DEF_MAX = 4000; // 防御搜索上界（远超任何面板，用于取「理论下限」）

/** 用户本次给的两组数据（陆抗【西陵克晋】加强后 180% 复核） */
const DEFAULT_OBS: Obs[] = [
  { label: '① 63%增伤·60%无视', attack: 231.7, troops: 8702, boost: 63, ignore: 60, counter: 0, damage: 1510 },
  { label: '② 32%增伤·无无视', attack: 232.7, troops: 5396, boost: 32, ignore: 0, counter: 0, damage: 953 },
];

// ─── 引擎公式调用（随机系数用桩，其余完全走 calcDamage）───

/** calcDamage 只通过 rng.int(10) 取攻击基础系数 → 送一个固定档位的桩即可确定性复算 */
function stubRng(idx: number): Rng {
  return { int: () => idx } as unknown as Rng;
}

function predict(obs: Obs, rate: number, defense: number, coeffIdx: number): number {
  const { damage } = calcDamage(
    {
      damageType: 'physical',
      rate,
      attackerAttack: obs.attack,
      attackerStrategy: 0,
      attackerTroops: obs.troops,
      targetDefense: applyIgnoreDef(defense, obs.ignore / 100),
      targetStrategy: 0,
      mult: 1 + (obs.boost - obs.counter) / 100,
    },
    stubRng(coeffIdx)
  );
  return damage;
}

/** 10 个随机系数下的伤害区间（观测值落在区间内才可能有解） */
function damageRange(obs: Obs, rate: number, defense: number): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < COEFF_COUNT; i++) {
    const d = predict(obs, rate, defense, i);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

function bisect(lo: number, hi: number, pred: (x: number) => boolean): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 64; i++) {
    const m = (a + b) / 2;
    if (pred(m)) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** 固定目标防御 → 能打出该观测伤害的倍率区间（%）；每档随机系数各有一个区间，取并集 */
function rateInterval(obs: Obs, defense: number): { lo: number; hi: number } | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < COEFF_COUNT; i++) {
    const f = (r: number) => predict(obs, r, defense, i);
    if (f(RATE_MAX) < obs.damage) continue; // 倍率拉满也够不到
    if (f(RATE_MIN) > obs.damage) continue; // 倍率归零就超标（不该发生）
    const rLo = bisect(RATE_MIN, RATE_MAX, (r) => f(r) >= obs.damage);
    const rHi = bisect(RATE_MIN, RATE_MAX, (r) => f(r) > obs.damage);
    if (rLo > RATE_MAX) continue;
    lo = Math.min(lo, rLo);
    hi = Math.max(hi, rHi);
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}

/** 固定倍率 → 要打出该观测伤害，目标防御必须落在的区间；null = 该倍率无解 */
function defenseInterval(obs: Obs, rate: number): { lo: number; hi: number } | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < COEFF_COUNT; i++) {
    const f = (d: number) => predict(obs, rate, d, i);
    if (f(DEF_MIN) < obs.damage) continue; // 0 防御都打不到 → 该档无解
    if (f(DEF_MAX) > obs.damage) continue; // 防御拉满仍超标 → 该档无解
    const dHi = bisect(DEF_MIN, DEF_MAX, (d) => f(d) < obs.damage); // 仍 ≥ 观测的最大防御
    const dLo = bisect(DEF_MIN, DEF_MAX, (d) => f(d) <= obs.damage); // 已 ≤ 观测的最小防御
    lo = Math.min(lo, dLo);
    hi = Math.max(hi, dHi);
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}

/** 无解时给出方向性结论：是倍率被低估还是高估 */
function diagnose(obs: Obs, rate: number): string {
  const maxDamage = damageRange(obs, rate, DEF_MIN)[1]; // 0 防御 + 最高随机 = 该倍率理论上限
  const minDamage = predict(obs, rate, DEF_MAX, 0); // 极高防御 + 最低随机 ≈ 该倍率理论下限
  if (obs.damage > maxDamage) return `观测 ${obs.damage} > 该倍率理论上限 ${maxDamage}（0 防御+最高随机）→ 实际倍率高于 ${rate}%`;
  if (obs.damage < minDamage) return `观测 ${obs.damage} < 该倍率理论下限 ${minDamage}（拉满防御+最低随机）→ 实际倍率低于 ${rate}%`;
  return '';
}

// ─── CLI 解析 ───

const argv = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function argValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  }
  return out;
}

function parseObs(spec: string, idx: number): Obs {
  const rec: Record<string, string> = {};
  for (const part of spec.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    rec[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  const num = (k: string, dflt?: number): number => {
    const raw = rec[k];
    if (raw === undefined) {
      if (dflt !== undefined) return dflt;
      throw new Error(`--obs 缺少字段 ${k}：${spec}`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`--obs 字段 ${k} 不是数字：${raw}`);
    return n;
  };
  return {
    label: rec.label ?? `#${idx + 1}`,
    attack: num('atk'),
    troops: num('troops'),
    boost: num('boost', 0),
    ignore: num('ignore', 0),
    counter: num('counter', 0),
    damage: num('dmg'),
  };
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：npx tsx scripts/verify_skill_rate.mts [--rate 180] [--joint] [--def-step 5] [--def-max 600] \\');
  console.log('        --obs "label=①,atk=231.7,troops=8702,boost=63,ignore=60,dmg=1510" [--obs ...]');
  process.exit(0);
}

const rate = Number(argValue('--rate') ?? '180');
const joint = argv.includes('--joint') || argValues('--obs').length === 0; // 默认两组数据 → 顺带联立
const defStep = Number(argValue('--def-step') ?? '5');
const defSweepMax = Number(argValue('--def-max') ?? '600');
const parsed = argValues('--obs').map(parseObs);
const obsList = parsed.length > 0 ? parsed : DEFAULT_OBS;

// ─── 报告 ───

const fmt = (v: number, digits = 1): string => v.toFixed(digits);
const defSpan = (r: { lo: number; hi: number } | null): string =>
  r ? `${fmt(r.lo, 0)} ~ ${fmt(r.hi, 0)}` : '无解';

console.log('═'.repeat(78));
console.log('伤害 → 倍率反推（引擎公式：兵力基础 + 攻击基础 + 主要伤害；随机仅攻击基础系数 0.30~0.39）');
console.log('═'.repeat(78));
console.log(`候选倍率：${fmt(rate)}%    观测组数：${obsList.length}    联立（同目标）：${joint ? '是' : '否'}`);
console.log('');

console.log('── ① 输入 ──');
for (const o of obsList) {
  const [lo, hi] = damageRange(o, rate, DEF_MIN);
  console.log(
    `  ${o.label}：攻击 ${o.attack}｜兵力 ${o.troops}｜增减伤 ${o.boost}%` +
      `${o.counter ? `（含兵种克制 −${o.counter}%）` : ''}｜无视防御 ${o.ignore}%｜观测伤害 ${o.damage}`
  );
  console.log(`      该面板在 ${fmt(rate)}% 下的「0 防御」伤害区间 = ${lo} ~ ${hi}（随机系数两端）`);
}

console.log('');
console.log('── ② 单点：固定倍率 → 反推「目标防御必须是多少」 ──');
for (const o of obsList) {
  const di = defenseInterval(o, rate);
  if (di) {
    console.log(`  ${o.label}：目标防御（面板值）需落在 ${defSpan(di)} 才能打出 ${o.damage}`);
  } else {
    console.log(`  ${o.label}：${diagnose(o, rate)}`);
  }
}

console.log('');
console.log('── ③ 单点：固定目标防御 → 反推倍率区间 ──');
const defRows = [0, 50, 100, 150, 200, 250, 300, 400];
const header = ['目标防御', ...obsList.map((o) => o.label)];
console.log('  ' + header.map((h, i) => (i === 0 ? h.padEnd(10) : h.padEnd(26))).join(''));
for (const d of defRows) {
  const cells = obsList.map((o) => {
    const ri = rateInterval(o, d);
    if (!ri) return '无解'.padEnd(26);
    const hit = rate >= ri.lo && rate <= ri.hi ? '✓含候选' : '';
    return `${fmt(ri.lo)}% ~ ${fmt(ri.hi)}% ${hit}`.padEnd(26);
  });
  console.log('  ' + [String(d).padEnd(10), ...cells].join(''));
}

/** 联立得到的「共同解」防御窗口（供第 ⑥ 段取样） */
const jointRows: Array<{ def: number; lo: number; hi: number }> = [];

if (joint && obsList.length >= 2) {
  console.log('');
  console.log('── ④ 联立（假定两组打的是同一个目标 → 防御相同，可消掉防御）──');
  let unionLo = Number.POSITIVE_INFINITY;
  let unionHi = Number.NEGATIVE_INFINITY;
  let defLo = Number.POSITIVE_INFINITY;
  let defHi = Number.NEGATIVE_INFINITY;
  const rows = jointRows;
  for (let d = DEF_MIN; d <= defSweepMax; d += defStep) {
    const intervals = obsList.map((o) => rateInterval(o, d));
    if (intervals.some((r) => r === null)) continue;
    const lo = Math.max(...intervals.map((r) => r!.lo));
    const hi = Math.min(...intervals.map((r) => r!.hi));
    if (lo > hi) continue;
    rows.push({ def: d, lo, hi });
    unionLo = Math.min(unionLo, lo);
    unionHi = Math.max(unionHi, hi);
    defLo = Math.min(defLo, d);
    defHi = Math.max(defHi, d);
  }
  if (rows.length === 0) {
    console.log('  在防御 0 ~ ' + defSweepMax + ' 内**不存在**共同解 → 两组数据互相矛盾，可能并非同一目标/同一倍率口径。');
  } else {
    console.log(`  存在共同解的防御窗口：${fmt(defLo, 0)} ~ ${fmt(defHi, 0)}（步长 ${defStep}）`);
    console.log(`  **与防御无关的倍率区间 = ${fmt(unionLo)}% ~ ${fmt(unionHi)}%**`);
    console.log('');
    console.log('  共同解明细（每 25 点防御取样）：');
    const step = Math.max(1, Math.round(25 / defStep));
    rows.forEach((r, i) => {
      if (i % step === 0 || i === rows.length - 1) {
        const hit = rate >= r.lo && rate <= r.hi ? '  ← 含候选倍率' : '';
        console.log(`    防御 ${String(r.def).padStart(4)} → 倍率 ${fmt(r.lo)}% ~ ${fmt(r.hi)}%${hit}`);
      }
    });
  }
}

console.log('');
console.log('── ⑤ 候选倍率预测 vs 观测（把「倍率差几个点」换算成伤害偏差）──');
const probeDefs = jointRows.length > 0
  ? [jointRows[0].def, jointRows[Math.floor(jointRows.length / 2)].def, jointRows[jointRows.length - 1].def]
  : [100, 150, 200, 250];
for (const d of probeDefs) {
  console.log(`  目标防御 ${d}：`);
  for (const o of obsList) {
    const [lo, hi] = damageRange(o, rate, d);
    const devLo = ((lo - o.damage) / o.damage) * 100;
    const devHi = ((hi - o.damage) / o.damage) * 100;
    console.log(
      `    ${o.label}：${fmt(rate)}% 预测 ${lo} ~ ${hi}｜观测 ${o.damage}｜偏差 ${fmt(devLo)}% ~ ${fmt(devHi)}%`
    );
  }
}

console.log('');
console.log('── ⑥ 判定 ──');
const verdicts: string[] = [];
for (const o of obsList) {
  const di = defenseInterval(o, rate);
  verdicts.push(di ? `${o.label}：${fmt(rate)}% 可行（需目标防御 ${defSpan(di)}）` : `${o.label}：${diagnose(o, rate)}`);
}
for (const v of verdicts) console.log('  ' + v);
console.log('');
console.log(`  参考：同一面板若按 150% 计算，所需目标防御 =`);
for (const o of obsList) {
  const di = defenseInterval(o, 150);
  console.log(`    ${o.label}：${di ? defSpan(di) : diagnose(o, 150)}`);
}
