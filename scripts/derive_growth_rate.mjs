#!/usr/bin/env node
/**
 * 成长率反解器（受属性影响的战法数值 → 反解 growthRate）
 *
 * 口径（与 dateyuan/谋略战法受谋略成长调研.md 1.2、速度战法受速度成长调研.md 一致）：
 *   属性 ≥ 锚点：实际值 = roundRate( 基值 + 成长率 × (属性 − 锚点) )
 *   属性 < 锚点：实际值 = roundRate( 基值 × 0.4 + 基值 × 0.6 × 属性/锚点 )   ← 本工具会告警
 *   roundRate = 1% 粒度「八舍九入」（小数 ≥ .9 才进位），引擎 src/engine/formulas.ts 同源。
 *
 * 用法：
 *   node scripts/derive_growth_rate.mjs --base 40 --points 208.8:72,256.9:84,281.4:91
 *   node scripts/derive_growth_rate.mjs --base 40 --anchor 100 --points 256.9:84,281.4:91
 *   node scripts/derive_growth_rate.mjs --base 40 --points 208.8:72,256.9:84 --check 0.2532
 *   node scripts/derive_growth_rate.mjs --base 40 --points 208.8:72 --round round   # 四舍五入 / floor
 *
 * 输出：逐点反解区间 → 交集 → 候选成长率（含「翻倍阈值 = 基值/成长率」）→ 复算校验表。
 */

const ROUNDERS = {
  roundRate: (v) => (v - Math.floor(v) >= 0.9 ? Math.floor(v) + 1 : Math.floor(v)), // 八舍九入（默认，引擎口径）
  round: (v) => Math.round(v), // 四舍五入
  floor: (v) => Math.floor(v), // 截断
};

function parseArgs(argv) {
  const out = { base: null, anchor: 80, points: null, check: null, round: 'roundRate', tol: 0 };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, '');
    const v = argv[i + 1];
    if (k) out[k] = v;
  }
  out.base = Number(out.base);
  out.anchor = Number(out.anchor);
  out.tol = Number(out.tol ?? 0);
  out.points = String(out.points ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [attr, value] = s.split(':').map((x) => Number(x.trim()));
      return { attr, value };
    });
  if (out.check != null) out.check = Number(out.check);
  return out;
}

/** 单个实数区间求交（半开区间 [lo, hi)） */
function intersect(a, b) {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return hi > lo ? [lo, hi] : null;
}

/** 某一点在给定取整方式下，能取到 value 的「实际值」范围 */
function valueRange(value, rounder, tol) {
  const t = tol || 0;
  if (rounder === 'roundRate') return [value - 0.1 - t, value + 0.9 + t];
  if (rounder === 'round') return [value - 0.5 - t, value + 0.5 + t];
  return [value - t, value + 1 + t]; // floor
}

function solve({ base, anchor, points, round, tol }) {
  const rounder = ROUNDERS[round];
  if (!rounder) throw new Error(`未知取整方式：${round}（可选 roundRate / round / floor）`);
  const rows = [];
  let acc = null;
  let first = true;
  for (const p of points) {
    const d = p.attr - anchor;
    if (d <= 0) {
      rows.push({ ...p, d, span: null, warn: '属性 ≤ 锚点：走 0.4/0.6 回落段，本工具不反解' });
      continue;
    }
    const [vLo, vHi] = valueRange(p.value, round, tol);
    // base + g×d ∈ [vLo, vHi)  →  g ∈ [(vLo−base)/d, (vHi−base)/d)
    const span = [(vLo - base) / d, (vHi - base) / d];
    rows.push({ ...p, d, span });
    if (first) {
      acc = span;
      first = false;
    } else {
      acc = acc ? intersect(acc, span) : null; // 交集变空后必须保持空，不得重置
    }
  }
  return { rows, span: acc };
}

/** 区间内的候选「好看数」：0.0005 / 0.001 / 0.0025 / 0.005 / 0.01 步长，外加 基值/整数 那类翻倍阈值 */
function candidates(span, base) {
  if (!span) return [];
  const [lo, hi] = span;
  const out = new Map();
  for (const step of [0.0005, 0.001, 0.0025, 0.005, 0.01]) {
    const first = Math.ceil(lo / step) * step;
    for (let v = first; v < hi; v += step) {
      out.set(+v.toFixed(4), `步长 ${step}`);
    }
  }
  for (let n = 20; n <= 400; n++) {
    const v = base / n; // 翻倍阈值 = n 点属性
    if (v >= lo && v < hi) out.set(+v.toFixed(4), `基值/${n}（+${n} 属性翻倍）`);
  }
  return [...out.entries()].map(([value, why]) => ({ value, why })).sort((a, b) => a.value - b.value);
}

function verify({ base, anchor, round }, g) {
  const rounder = ROUNDERS[round];
  return (p) => {
    const raw = base + g * (p.attr - anchor);
    const got = rounder(raw);
    return { raw: +raw.toFixed(4), got, ok: got === p.value };
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.base) || args.points.length === 0) {
    console.error(
      '用法：node scripts/derive_growth_rate.mjs --base <基值@锚点> --points <属性:实读值,属性:实读值> [--anchor 80] [--round roundRate|round|floor] [--check <成长率>]'
    );
    process.exit(2);
  }
  console.log(`基值 ${args.base} @ 属性 ${args.anchor} ｜ 取整 ${args.round} ｜ ${args.points.length} 个实测点\n`);

  const { rows, span } = solve(args);
  console.log('逐点反解（成立的成长率区间）：');
  for (const r of rows) {
    if (!r.span) {
      console.log(`  属性 ${r.attr} → ${r.value}　⚠️ ${r.warn}`);
      continue;
    }
    console.log(
      `  属性 ${r.attr} → ${r.value}　Δ=${r.d.toFixed(1)}　[${r.span[0].toFixed(5)}, ${r.span[1].toFixed(5)})`
    );
  }

  if (!span) {
    console.log('\n❌ 交集为空：这些点在「基值/锚点/取整」口径下互相矛盾。');
    console.log('   排查顺序：① 锚点是否选错 ② 基值是否取自官方描述 ③ 实读值是否含其它叠加来源');
    console.log('   参考：锚点 100 与锚点 80 往往只差一个低速点就能区分开。');
    process.exit(1);
  }

  const mid = (span[0] + span[1]) / 2;
  console.log(`\n✅ 交集：[${span[0].toFixed(5)}, ${span[1].toFixed(5)})　宽度 ${(span[1] - span[0]).toFixed(5)}`);
  console.log(`   中点　${mid.toFixed(4)}　${mid > 0 ? `（翻倍阈值 ≈ ${(args.base / mid).toFixed(1)} 点属性）` : ''}`);

  const cands = candidates(span, args.base);
  if (cands.length) {
    console.log('\n候选成长率（区间内）：');
    for (const c of cands.slice(0, 40)) console.log(`  ${c.value}\t${c.why}`);
    if (cands.length > 40) console.log(`  …共 ${cands.length} 个，未全列`);
  }

  const g = args.check ?? mid;
  console.log(`\n复算校验（成长率 = ${g}）：`);
  const v = verify(args, g);
  let allOk = true;
  for (const p of args.points) {
    const r = v(p);
    allOk = allOk && r.ok;
    console.log(`  属性 ${p.attr}　原始值 ${r.raw}　取整后 ${r.got}%　实读 ${p.value}%　${r.ok ? '✅' : '❌'}`);
  }
  console.log(allOk ? '\n全部命中 —— 该成长率可用于入库。' : '\n⚠️ 有未命中项，换候选值或补点。');
  process.exit(allOk ? 0 : 1);
}

main();
