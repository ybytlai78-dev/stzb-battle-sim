#!/usr/bin/env tsx
/**
 * 槽位级对拍：把包内 `tb_cfg_skill_detail` 的每一条槽位，按机制码配到引擎 `SKILL_REGISTRY` 的对应字段。
 *
 * 为什么不比全文：一个战法有几条槽位、引擎有几种 output，两边结构不对等。
 * 只有**机制码 → 引擎字段**这条映射是确定的，其余一律落 uncovered —— 宁可不判，也不猜。
 *
 * 单位口径（用真实行自证过，别再改）：
 *  - 伤害率（301 攻击 / 302 策略 / 303 动摇 / 304 恐慌 / 305 燃烧 / 306 妖术）：包内值是**百分数**，
 *    引擎字段也是百分数（楚歌四起 304 c=25/i=255 → 127 = 引擎 panic.rate 127）；
 *  - 急救（401）：包内 (c+0.4i)/100 是**小数比例**，引擎 healRate 是百分数 ⇒ 比之前 ×100
 *    （金匮要略 20/150 → 0.8 → 引擎 80）；
 *  - 减伤（522 受攻击 / 524 受策略）：同上，包内是小数比例，引擎 rate 是小数 ⇒ ×100 后比
 *    （金匮要略 10/26 → 0.204 → 20.4%，引擎 rate 0.204 即 20.4%）。
 *
 * 用法：`npx tsx scripts/rag/slotdiff.mts [--src 解包目录] [--only-diff] [--json] [--verbose]`
 */
import { readFileSync } from 'node:fs';
import { SKILL_REGISTRY } from '../../src/data/skills.ts';
import { convertDetail } from './render.mjs';
import {
  checkDivergence,
  describeVerdicts,
  type AcceptedDivergence,
  type DivergenceField,
  type DivergenceResult,
} from './exceptions.mjs';

const DEFAULT_SRC = 'C:/Users/lai15/Desktop/rea_stzb/dec/json';

type Row = Record<string, unknown>;

function loadTable(src: string, table: string): Row[] {
  const parsed = JSON.parse(readFileSync(`${src}/${table}.json`, 'utf8')) as { rows?: Record<string, Row> };
  return Object.values(parsed.rows ?? {});
}

/** 槽位机制码 → 引擎字段。`scale` 是把包内换算值对齐到引擎单位要乘的系数 */
interface SlotMapping {
  label: string;
  /** 把包内换算值对齐到引擎单位：伤害率/急救两边都是百分点（×1），减伤引擎存小数（×0.01） */
  valueScale: number;
  /** 成长率两边都是「百分点/点」，不需要换算 */
  growthScale: number;
  /** 从一条引擎 output 里取值；返回 null 表示这条 output 不是本机制码对应的那条 */
  pick: (o: Row) => number | null;
  /** 同一条 output 上的成长率字段 */
  growth?: (o: Row) => number | undefined;
  /**
   * 属性增减类的状态类型。设置后该槽位走「成组对齐」：
   * 包内同一属性可能有多条槽位（递增段 / 分层段），引擎只写一条，
   * 槽位数与 output 数不等时一律 ambiguous —— 拿 8.4 去比 28 会造出假差异。
   */
  attrType?: string;
}

/** 属性 buff 类型 → 归属它的机制码（提高 / 降低）。不按这张表配会造出大量假配对。 */
export const ATTR_CODES: Record<string, number[]> = {
  attack_buff: [101, 201],
  defense_buff: [102, 202],
  strategy_buff: [103, 203],
  speed_buff: [104, 204],
};

const statBuff = (type: string) => (o: Row): number | null => {
  const s = status(o);
  return s?.type === type ? Number(s.amount) : null;
};
const statGrowth = (type: string) => (o: Row): number | undefined => {
  const s = status(o);
  return s?.type === type ? Number(s.growthRate ?? 0) : undefined;
};

const status = (o: Row): Row | undefined => o.status as Row | undefined;

export const SLOT_MAP: Record<number, SlotMapping> = {
  301: { label: '攻击伤害率', valueScale: 1,
    growthScale: 1, pick: (o) => (o.kind === 'physical_damage' ? Number(o.rate) : null) },
  302: { label: '策略伤害率', valueScale: 1,
    growthScale: 1, pick: (o) => (o.kind === 'strategy_damage' ? Number(o.rate) : null) },
  303: {
    label: '动摇伤害率',
    valueScale: 1,
    growthScale: 1,
    pick: (o) => (status(o)?.type === 'unrest' ? Number(status(o)!.rate) : null),
    growth: (o) => (status(o)?.type === 'unrest' ? Number(status(o)!.growthRate ?? 0) : undefined),
  },
  304: {
    label: '恐慌伤害率',
    valueScale: 1,
    growthScale: 1,
    pick: (o) => (status(o)?.type === 'panic' ? Number(status(o)!.rate) : null),
    growth: (o) => (status(o)?.type === 'panic' ? Number(status(o)!.growthRate ?? 0) : undefined),
  },
  305: {
    label: '燃烧伤害率',
    valueScale: 1,
    growthScale: 1,
    pick: (o) => (status(o)?.type === 'burning' ? Number(status(o)!.rate) : null),
    growth: (o) => (status(o)?.type === 'burning' ? Number(status(o)!.growthRate ?? 0) : undefined),
  },
  306: {
    label: '妖术伤害率',
    valueScale: 1,
    growthScale: 1,
    pick: (o) => {
      const t = status(o)?.type;
      return t === 'sorcery' || t === 'curse' ? Number(status(o)!.rate) : null;
    },
    growth: (o) => {
      const t = status(o)?.type;
      return t === 'sorcery' || t === 'curse' ? Number(status(o)!.growthRate ?? 0) : undefined;
    },
  },
  401: {
    label: '急救恢复率',
    valueScale: 1,
    growthScale: 1,
    pick: (o) => (o.kind === 'grant_first_aid' ? Number(o.healRate) : null),
    growth: (o) => (o.kind === 'grant_first_aid' ? Number(o.healGrowthRate ?? 0) : undefined),
  },
  // ── 属性增减（101-104 提高 / 201-204 降低）──
  // 判据由 `scripts/_probe_statpoint.mts` 反向自证：引擎已实现的 33 个属性 buff 样本，
  // 点数编码（c<10⁵ → (c+0.4i)/100）命中 31 条、单属性百分比编码（c≥10⁵ → (c+0.4i)/10⁶）命中 2 条，
  // 合计 33/33；其余两条路径命中 0 —— 判据成立（`convertDetail` 已按量级分域，这里 valueScale 只需处理符号）。
  // 符号：201-204 是「降低」，引擎 amount 为负，故包内正值 × (−1)。
  101: { label: '攻击属性提高', valueScale: 1, growthScale: 1, attrType: 'attack_buff',
    pick: statBuff('attack_buff'), growth: statGrowth('attack_buff') },
  102: { label: '防御属性提高', valueScale: 1, growthScale: 1, attrType: 'defense_buff',
    pick: statBuff('defense_buff'), growth: statGrowth('defense_buff') },
  103: { label: '谋略属性提高', valueScale: 1, growthScale: 1, attrType: 'strategy_buff',
    pick: statBuff('strategy_buff'), growth: statGrowth('strategy_buff') },
  104: { label: '速度属性提高', valueScale: 1, growthScale: 1, attrType: 'speed_buff',
    pick: statBuff('speed_buff'), growth: statGrowth('speed_buff') },
  201: { label: '攻击属性降低', valueScale: -1, growthScale: 1, attrType: 'attack_buff',
    pick: statBuff('attack_buff'), growth: statGrowth('attack_buff') },
  202: { label: '防御属性降低', valueScale: -1, growthScale: 1, attrType: 'defense_buff',
    pick: statBuff('defense_buff'), growth: statGrowth('defense_buff') },
  203: { label: '谋略属性降低', valueScale: -1, growthScale: 1, attrType: 'strategy_buff',
    pick: statBuff('strategy_buff'), growth: statGrowth('strategy_buff') },
  204: { label: '速度属性降低', valueScale: -1, growthScale: 1, attrType: 'speed_buff',
    pick: statBuff('speed_buff'), growth: statGrowth('speed_buff') },

  522: {
    label: '受到攻击伤害降低',
    valueScale: 0.01,
    growthScale: 1,
    pick: (o) => {
      const s = status(o);
      if (s?.type !== 'damage_reduce') return null;
      return s.damageType === 'strategy' ? null : Number(s.rate);
    },
    growth: (o) => (status(o)?.type === 'damage_reduce' ? Number(status(o)!.growthRate ?? 0) : undefined),
  },
  524: {
    label: '受到策略攻击伤害降低',
    valueScale: 0.01,
    growthScale: 1,
    pick: (o) => {
      const s = status(o);
      if (s?.type !== 'damage_reduce') return null;
      return s.damageType === 'physical' ? null : Number(s.rate);
    },
    growth: (o) => (status(o)?.type === 'damage_reduce' ? Number(status(o)!.growthRate ?? 0) : undefined),
  },
};

/**
 * diff 之外的三种「不报为差异」的去向：
 *  - accepted：已裁定（两侧确有分歧，人已拍板以哪侧为准）；
 *  - ignored：结构性不对等（百家变体 / 通用模板 vs 同名独立战法）；
 *  - stale：已裁定条目失效（任一侧数值后来变了），必须重新裁定。
 */
export type SlotStatus = 'match' | 'diff' | 'engine-missing' | 'ambiguous' | 'accepted' | 'ignored' | 'stale';

export interface SlotDiff {
  skillId: string;
  skillName: string;
  pkgSkillId: number;
  detailId: number;
  effectId: number;
  label: string;
  pkg: number;
  engine: number | null;
  pkgGrowth?: number;
  engineGrowth?: number;
  status: SlotStatus;
  /** accepted / ignored / stale 的去向说明 */
  verdictNote?: string;
}

/** 展开 conditional 分支，让嵌套的 output 也能被配到 */
export function flattenOutputs(out: Row[]): Row[] {
  const acc: Row[] = [];
  for (const o of out) {
    acc.push(o);
    if (o.kind === 'conditional' && Array.isArray(o.output)) acc.push(...flattenOutputs(o.output as Row[]));
  }
  return acc;
}

export const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6 || Math.abs(a - b) / Math.max(1, Math.abs(b)) < 1e-3;

export interface SlotDiffReport {
  rows: SlotDiff[];
  stats: {
    alignedSkills: number;
    slotsTotal: number;
    covered: number;
    match: number;
    diff: number;
    ambiguous: number;
    engineMissing: number;
    uncovered: number;
    accepted: number;
    ignored: number;
    stale: number;
    valuesCompared: number;
    growthCompared: number;
  };
}

export function diffSlots(src: string): SlotDiffReport {
  const details = loadTable(src, 'tb_cfg_skill_detail');
  const pkgSkills = loadTable(src, 'tb_cfg_skill');
  const effects = loadTable(src, 'tb_cfg_skill_effect');
  const effectName = new Map<number, string>();
  for (const e of effects) effectName.set(Number(e.effect_id), String(e.name ?? e.tips ?? ''));

  // 引擎战法名 → 包内 skill 行（只在按名唯一命中时配对，多候选留给 alignSkill 的收敛链，这里不猜）
  const byName = new Map<string, Row[]>();
  for (const s of pkgSkills) {
    const n = String(s.name ?? '');
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n)!.push(s);
  }
  const slotsBySkill = new Map<number, Row[]>();
  for (const d of details) {
    const sid = Math.floor(Number(d.detail_id) / 100);
    if (!slotsBySkill.has(sid)) slotsBySkill.set(sid, []);
    slotsBySkill.get(sid)!.push(d);
  }

  const rows: SlotDiff[] = [];
  const stats: SlotDiffReport['stats'] = {
    alignedSkills: 0,
    slotsTotal: 0,
    covered: 0,
    match: 0,
    diff: 0,
    ambiguous: 0,
    engineMissing: 0,
    uncovered: 0,
    accepted: 0,
    ignored: 0,
    stale: 0,
    valuesCompared: 0,
    growthCompared: 0,
  };

  for (const entry of Object.values(SKILL_REGISTRY) as unknown as Row[]) {
    const cands = byName.get(String(entry.name)) ?? [];
    if (cands.length !== 1) continue;
    const pkgSkill = cands[0];
    const pkgSkillId = Number(pkgSkill.skill_id);
    const slots = slotsBySkill.get(pkgSkillId) ?? [];
    if (!slots.length) continue;
    stats.alignedSkills++;
    const outputs = flattenOutputs((Array.isArray(entry.output) ? entry.output : []) as Row[]);
    const seen = new Set<string>();

    for (const slot of slots) {
      stats.slotsTotal++;
      const effectId = Number(slot.effect_id);
      const mapping = SLOT_MAP[effectId];
      if (!mapping) {
        stats.uncovered++;
        continue;
      }
      stats.covered++;
      const conv = convertDetail(Number(slot.constant_param ?? 0), Number(slot.intel_param ?? 0), effectId);
      const pkgValue = conv.value * mapping.valueScale;
      const pkgGrowth = conv.growth * mapping.growthScale;

      const base: Omit<SlotDiff, 'engine' | 'engineGrowth' | 'status'> = {
        skillId: String(entry.id),
        skillName: String(entry.name),
        pkgSkillId,
        detailId: Number(slot.detail_id),
        effectId,
        label: mapping.label,
        pkg: pkgValue,
        pkgGrowth,
      };

      // 属性增减类必须成组对齐：包内该属性的槽位数 ≠ 引擎同类 output 数时无从判定是哪条对哪条
      if (mapping.attrType) {
        const codes = ATTR_CODES[mapping.attrType] ?? [];
        const nSlot = slots.filter((x) => codes.includes(Number(x.effect_id))).length;
        const nOut = outputs.filter((o) => status(o)?.type === mapping.attrType).length;
        if (nSlot !== 1 || nOut !== 1) {
          stats.ambiguous++;
          rows.push({ ...base, engine: null, status: 'ambiguous' });
          continue;
        }
      }

      const hits = outputs
        .map((o) => ({ o, v: mapping.pick(o) }))
        .filter((x) => x.v !== null && Number.isFinite(x.v)) as Array<{ o: Row; v: number }>;

      if (hits.length === 0) {
        stats.engineMissing++;
        rows.push({ ...base, engine: null, status: 'engine-missing' });
        continue;
      }
      if (hits.length > 1) {
        // 能配到多条时，如果值全都相同就按一致处理（指挥类「受攻击/受策略」共用一条是常见形态）
        const vs = hits.map((h) => h.v);
        if (!vs.every((v) => close(v, vs[0]))) {
          stats.ambiguous++;
          rows.push({ ...base, engine: null, status: 'ambiguous' });
          continue;
        }
      }
      const { o, v } = hits[0];
      const engineGrowth = mapping.growth?.(o);
      const valueOk = close(pkgValue, v);
      const growthOk = engineGrowth === undefined || pkgGrowth === undefined ? true : close(pkgGrowth, engineGrowth);
      if (engineGrowth !== undefined) stats.growthCompared++;
      stats.valuesCompared++;

      const key = `${entry.id}#${mapping.label}`;
      let st: SlotStatus = valueOk && growthOk ? 'match' : 'diff';
      let verdictNote: string | undefined;
      if (st === 'diff') {
        // 差异逐项过一遍已裁定清单：value 与 growth 各自可能有独立结论
        const checks: Array<{ field: DivergenceField; r: DivergenceResult }> = [];
        if (!valueOk) {
          checks.push({
            field: 'value',
            r: checkDivergence({
              skillId: String(entry.id),
              detailId: Number(slot.detail_id),
              field: 'value',
              engine: v,
              pkg: pkgValue,
            }),
          });
        }
        if (!growthOk && engineGrowth !== undefined) {
          checks.push({
            field: 'growth',
            r: checkDivergence({
              skillId: String(entry.id),
              detailId: Number(slot.detail_id),
              field: 'growth',
              engine: engineGrowth,
              pkg: pkgGrowth,
            }),
          });
        }
        const stale = checks.find((c) => c.r.verdict === 'stale');
        if (stale) {
          st = 'stale';
          verdictNote = stale.r.note;
        } else if (checks.length > 0 && checks.every((c) => c.r.verdict !== 'none')) {
          const accepted = checks.filter((c) => c.r.verdict === 'accepted');
          st = accepted.length > 0 ? 'accepted' : 'ignored';
          verdictNote = accepted
            .map((c) => (c.r.entry as AcceptedDivergence).reason)
            .join('；') || (checks[0].r.entry as { reason?: string } | undefined)?.reason;
        }
      }
      if (st === 'diff' && seen.has(key)) continue; // 同字段只报一次（522/524 共用一条减伤时常见）
      seen.add(key);
      if (st === 'match') stats.match++;
      else if (st === 'diff') stats.diff++;
      else if (st === 'accepted') stats.accepted++;
      else if (st === 'ignored') stats.ignored++;
      else if (st === 'stale') stats.stale++;
      rows.push({ ...base, engine: v, engineGrowth, status: st, verdictNote });
    }
  }
  return { rows, stats };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const src = flag('--src', DEFAULT_SRC);
  const report = diffSlots(src);
  const s = report.stats;

  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`槽位级对拍：按名唯一对齐 ${s.alignedSkills} 个战法、${s.slotsTotal} 条槽位`);
  console.log(
    `可判 ${s.covered} 条（${((s.covered / Math.max(1, s.slotsTotal)) * 100).toFixed(1)}%）｜一致 ${s.match}｜` +
      `差异 ${s.diff}｜引擎无对应 ${s.engineMissing}｜多候选 ${s.ambiguous}｜未覆盖机制码 ${s.uncovered}`
  );
  if (s.accepted || s.ignored || s.stale) {
    console.log(
      `已裁定 ${s.accepted}｜结构性忽略 ${s.ignored}` +
        (s.stale ? `｜⚠️ 例外失效 ${s.stale}（需重新裁定）` : '')
    );
  }
  console.log(`比较了 ${s.valuesCompared} 个值、${s.growthCompared} 个成长率`);

  const diffs = report.rows.filter((r) => r.status === 'diff' || r.status === 'engine-missing');
  if (diffs.length) {
    console.log('\n差异 / 缺失：');
    for (const d of diffs) {
      const g =
        d.engineGrowth !== undefined && d.pkgGrowth !== undefined && Math.abs(d.engineGrowth - d.pkgGrowth) > 1e-9
          ? `｜成长 包内 ${Number(d.pkgGrowth.toFixed(4))} ≠ 引擎 ${Number(d.engineGrowth.toFixed(4))}`
          : '';
      const eng = '（引擎无对应输出）';
      const fmt = (v: number): string => String(Number(v.toFixed(4)));
      const valueDiff = d.engine === null || !close(d.pkg, d.engine);
      const head =
        `  ${d.skillName}（${d.skillId} / 槽 ${d.detailId} / 机制 ${d.effectId} ${d.label}）包内 ${fmt(d.pkg)}`;
      console.log(head + (valueDiff ? ` ≠ 引擎 ${d.engine === null ? '（引擎无对应输出）' : fmt(d.engine)}${g}` : `｜值一致${g}`));
    }
  }

  const staleRows = report.rows.filter((r) => r.status === 'stale');
  if (staleRows.length) {
    console.log('');
    console.log('⚠️ 例外失效（登记后数值已变，需重新裁定）：');
    for (const r of staleRows) console.log(`  ${r.skillName}（${r.skillId} / 槽 ${r.detailId}）${r.verdictNote ?? ''}`);
  }

  const verdicts = describeVerdicts();
  if (verdicts.length) {
    console.log('');
    console.log('已裁定 / 结构性忽略（不计入差异）：');
    for (const v of verdicts) console.log(`  ${v}`);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rag/slotdiff.mts')) main();
