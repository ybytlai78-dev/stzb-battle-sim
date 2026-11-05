#!/usr/bin/env tsx
/**
 * 一次性探针：属性增减类机制码（101-105 提高 / 201-204 降低）的单位判据自证。
 *
 * 问题：同一机制码下，包内 `constant_param/intel_param` 存在两种编码
 *  —— 「点数」（算无遗策：攻击、谋略 −22 点，c=1000/i=3000）
 *  —— 「全属性百分比」（魏武之世：四维 −15%，c=11,400,000/i=9,000,000）
 * 包内没有 unit / value_type 字段可区分，只能靠**引擎侧已实现的数值反证**。
 *
 * 做法：挑引擎里挂了 `*_buff` 状态、且按名能对齐到包内战法的样本，
 * 把同一个槽位按三条路径换算，看哪条与引擎的 `amount` / `growthRate` 吻合（容差同 diff）。
 * 三条路径：
 *  - statPoint：值 = (c+0.4i)/100        点、成长 = i/20000
 *  - percent  ：值 = (c+0.4i)/10⁴        百分点、成长 = i/20000
 *  - allAttr  ：值 = (c+0.4i)/10⁶ × 100  百分点（全属性百分比编码）、成长 = i/(2×10⁸)
 *
 * 判据只在「吻合率显著」时才敢写进 slotdiff —— 吻合率低说明还有别的编码，继续停在 unmapped。
 *
 * 用法：`npx tsx scripts/_probe_statpoint.mts [--src 解包目录] [--all]`
 */
import { readFileSync } from 'node:fs';
import { SKILL_REGISTRY } from '../src/data/skills.ts';

const DEFAULT_SRC = 'C:/Users/lai15/Desktop/rea_stzb/dec/json';
const STAT_CODES = new Set([101, 102, 103, 104, 105, 201, 202, 203, 204]);
const BUFF_TYPES = new Set(['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff']);
/** buff 类型 → 对应的属性机制码（提高 / 降低）。不按这张表配会造出大量假配对：
 *  一个战法同时挂 attack_buff 与 defense_buff，两个槽位各自对应一半。 */
const CODES_FOR_BUFF: Record<string, number[]> = {
  attack_buff: [101, 201],
  defense_buff: [102, 202],
  strategy_buff: [103, 203],
  speed_buff: [104, 204],
};

type Row = Record<string, unknown>;

function loadTable(src: string, table: string): Row[] {
  const parsed = JSON.parse(readFileSync(`${src}/${table}.json`, 'utf8')) as { rows?: Record<string, Row> };
  return Object.values(parsed.rows ?? {});
}

function flatten(out: Row[]): Row[] {
  const acc: Row[] = [];
  for (const o of out) {
    acc.push(o);
    if (o.kind === 'conditional' && Array.isArray(o.output)) acc.push(...flatten(o.output as Row[]));
  }
  return acc;
}

const close = (a: number, b: number): boolean =>
  Math.abs(a - b) < 1e-6 || Math.abs(a - b) / Math.max(1, Math.abs(b)) < 1e-3;

interface Paths {
  statPoint: { v: number; g: number };
  percent: { v: number; g: number };
  allAttr: { v: number; g: number };
}

function paths(c: number, i: number): Paths {
  const base = c + 0.4 * i;
  return {
    statPoint: { v: base / 100, g: i / 20000 },
    percent: { v: base / 1e4, g: i / 20000 },
    // 单属性 / 全属性百分比编码：base/10⁶ 出来的就是**百分点**（魏武之世 11,400,000+0.4×9,000,000 → 15.0 点 = 15%）。
    // 早先误当小数再 ×100，把 30% 读成 3000%。
    allAttr: { v: base / 1e6, g: i / 2e8 },
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: string): string => {
    const idx = argv.indexOf(n);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : d;
  };
  const src = flag('--src', DEFAULT_SRC);
  const showAll = argv.includes('--all');

  const details = loadTable(src, 'tb_cfg_skill_detail');
  const pkgSkills = loadTable(src, 'tb_cfg_skill');
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

  interface Sample {
    skillId: string;
    skillName: string;
    buffType: string;
    amount: number;
    percent: boolean;
    engineGrowth?: number;
    detailId: number;
    effectId: number;
    c: number;
    i: number;
    p: Paths;
  }
  const samples: Sample[] = [];

  for (const entry of Object.values(SKILL_REGISTRY) as unknown as Row[]) {
    const cands = byName.get(String(entry.name)) ?? [];
    if (cands.length !== 1) continue;
    const slots = slotsBySkill.get(Number(cands[0].skill_id)) ?? [];
    if (!slots.length) continue;
    const statSlots = slots.filter((s) => STAT_CODES.has(Number(s.effect_id)));
    if (!statSlots.length) continue;

    const outputs = flatten((Array.isArray(entry.output) ? entry.output : []) as Row[]);
    for (const o of outputs) {
      const st = o.status as Row | undefined;
      if (!st || !BUFF_TYPES.has(String(st.type))) continue;
      const codes = CODES_FOR_BUFF[String(st.type)] ?? [];
      const own = statSlots.filter((s2) => codes.includes(Number(s2.effect_id)));
      // 一个 buff 只配一条槽位：同一属性出现多条槽位（递增段 / 分层段）时无法自动判定是哪条，
      // 一律记为 ambiguous 跳过 —— 与 slotdiff 的 ambiguous 口径一致，宁可漏判不造假差异。
      if (own.length !== 1) continue;
      for (const slot of own) {
        const c = Number(slot.constant_param ?? 0);
        const i = Number(slot.intel_param ?? 0);
        samples.push({
          skillId: String(entry.id),
          skillName: String(entry.name),
          buffType: String(st.type),
          amount: Number(st.amount),
          percent: st.percent === true,
          engineGrowth: st.growthRate === undefined ? undefined : Number(st.growthRate),
          detailId: Number(slot.detail_id),
          effectId: Number(slot.effect_id),
          c,
          i,
          p: paths(c, i),
        });
      }
    }
  }

  console.log(`属性增减样本：${samples.length} 条（引擎 buff 状态 × 包内 101-105/201-204 槽位，按名唯一对齐）\n`);

  const names: Array<keyof Paths> = ['statPoint', 'percent', 'allAttr'];
  const hits: Record<string, number> = { statPoint: 0, percent: 0, allAttr: 0 };
  const rows: string[] = [];
  for (const s of samples) {
    // 机制码 201-204 是「降低」，包内与引擎两侧都是负值域；按绝对值比较，符号由机制码表达。
    const matched = names.filter((n) => close(Math.abs(s.p[n].v), Math.abs(s.amount)));
    const growthMatched = names.filter(
      (n) => s.engineGrowth !== undefined && close(s.p[n].g, s.engineGrowth)
    );
    for (const m of matched) hits[m]++;
    if (showAll || matched.length > 0 || s.engineGrowth !== undefined) {
      rows.push(
        `  ${s.skillName}（${s.skillId}）${s.buffType} amount=${s.amount}${s.percent ? ' percent' : ''}` +
          `${s.engineGrowth !== undefined ? ` g=${s.engineGrowth}` : ''}｜槽 ${s.detailId} 机制 ${s.effectId} c=${s.c} i=${s.i}\n` +
          `      点数 ${s.p.statPoint.v.toFixed(3)}/${s.p.statPoint.g.toFixed(4)}` +
          `｜百分比 ${s.p.percent.v.toFixed(3)}/${s.p.percent.g.toFixed(4)}` +
          `｜全属性 ${s.p.allAttr.v.toFixed(3)}/${s.p.allAttr.g.toFixed(4)}` +
          `  → 命中 [${matched.join(', ') || '无'}]` +
          `${growthMatched.length ? ` 成长命中 [${growthMatched.join(', ')}]` : ''}`
      );
    }
  }
  console.log(rows.join('\n'));

  const denom = Math.max(1, samples.length);
  console.log('\n按路径统计值命中：');
  for (const n of names) console.log(`  ${n}: ${hits[n]}/${samples.length}（${((hits[n] / denom) * 100).toFixed(1)}%）`);

  // 机制码 × 属性 的分布：确认 101-105 / 201-204 到底对应哪个属性
  const dist = new Map<string, number>();
  for (const s of samples) {
    const k = `${s.effectId}→${s.buffType}`;
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  console.log('\n机制码 → 引擎 buff 类型分布（用于确认码表）：');
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
}

main();
