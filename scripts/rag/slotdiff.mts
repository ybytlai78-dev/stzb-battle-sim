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
}

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

export type SlotStatus = 'match' | 'diff' | 'engine-missing' | 'ambiguous';

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

      const hits = outputs
        .map((o) => ({ o, v: mapping.pick(o) }))
        .filter((x) => x.v !== null && Number.isFinite(x.v)) as Array<{ o: Row; v: number }>;

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
      const st: SlotStatus = valueOk && growthOk ? 'match' : 'diff';
      if (st === 'diff' && seen.has(key)) continue; // 同字段只报一次（522/524 共用一条减伤时常见）
      seen.add(key);
      if (st === 'match') stats.match++;
      else stats.diff++;
      rows.push({ ...base, engine: v, engineGrowth, status: st });
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
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rag/slotdiff.mts')) main();
