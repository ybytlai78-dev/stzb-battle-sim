#!/usr/bin/env tsx
/**
 * 率土包内 RAG：把五张 tb_cfg_* 表渲染成 `.rag/docs.jsonl` + `.rag/manifest.json`。
 *
 * 口径（spec `docs/superpowers/specs/2026-10-31-率土包内RAG-design.md` §五）：
 * - 产物落 `.rag/`，已进 .gitignore —— 原始数据表不随仓库分发（NOTICE.md §五）
 * - manifest 记录源表行数与 sha256，任何一次 index 都能追溯到具体包版本
 * - 槽位不单独成篇：全部拼进所属战法文档
 *
 * 用法：`npx tsx scripts/rag/ingest.mts [--out .rag] [--limit 200]`
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DIV_UNRESOLVED,
  convertDetail,
  renderHeroDoc,
  renderMechanismDoc,
  renderSkillDoc,
  toJsonl,
  type RagDoc,
  type Row,
} from './render.mjs';

const SRC_DEFAULT = 'C:/Users/lai15/Desktop/rea_stzb/dec/json';
const TABLES = [
  'tb_cfg_hero',
  'tb_cfg_skill',
  'tb_cfg_skill_detail',
  'tb_cfg_skill_effect',
  'tb_cfg_skill_effect_map',
] as const;

interface Args {
  src: string;
  out: string;
  limit: number;
  calibers: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, dflt: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  return {
    src: get('--src', SRC_DEFAULT),
    out: get('--out', '.rag'),
    limit: Number(get('--limit', '0')) || 0,
    calibers: get('--calibers', 'rag/calibers'),
  };
}

const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

function loadTable(src: string, table: string): { rows: Array<[string, Row]>; hash: string; bytes: number } {
  const path = join(src, `${table}.json`);
  const raw = readFileSync(path);
  const parsed = JSON.parse(raw.toString('utf8')) as { rows?: Record<string, Row> };
  const rows = Object.entries(parsed.rows ?? {});
  return { rows, hash: sha256(raw), bytes: raw.byteLength };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const tables: Record<string, { rows: Array<[string, Row]>; hash: string; bytes: number }> = {};
  for (const t of TABLES) tables[t] = loadTable(args.src, t);

  const heroRows = tables.tb_cfg_hero.rows;
  const skillRows = tables.tb_cfg_skill.rows;
  const detailRows = tables.tb_cfg_skill_detail.rows;
  const effectRows = tables.tb_cfg_skill_effect.rows;
  const mapRows = tables.tb_cfg_skill_effect_map.rows;

  const effectById = new Map<number, Row>();
  for (const [, r] of effectRows) effectById.set(Number(r.effect_id), r);
  const effectName = (id: number): string => String(effectById.get(id)?.name ?? `effect-${id}`);

  /** skill_id → 机制码列表（`effect` 字段是 "101;402" 形式） */
  const codesBySkill = new Map<number, number[]>();
  for (const [, r] of mapRows) {
    const codes = String(r.effect ?? '')
      .split(';')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (codes.length) codesBySkill.set(Number(r.skill_id), codes);
  }

  /** detail_id = skill_id × 100 + 槽序（20077301 → 200773） */
  const detailsBySkill = new Map<number, Row[]>();
  const orphanDetails: number[] = [];
  const skillIds = new Set(skillRows.map(([, r]) => Number(r.skill_id)));
  for (const [, d] of detailRows) {
    const sid = Math.floor(Number(d.detail_id) / 100);
    if (!skillIds.has(sid)) orphanDetails.push(Number(d.detail_id));
    const list = detailsBySkill.get(sid);
    if (list) list.push(d);
    else detailsBySkill.set(sid, [d]);
  }

  /** 机制 → 引用它的战法名（取前若干，供 mechanism 文档正文） */
  const skillsByEffect = new Map<number, string[]>();
  for (const [sid, codes] of codesBySkill) {
    const name = String(skillRows.find(([, r]) => Number(r.skill_id) === sid)?.[1]?.name ?? '');
    if (!name) continue;
    for (const c of codes) {
      const arr = skillsByEffect.get(c);
      if (arr) arr.push(name);
      else skillsByEffect.set(c, [name]);
    }
  }

  const docs: RagDoc[] = [];
  const divisions: Record<string, number> = {};
  const bump = (k: string): void => {
    divisions[k] = (divisions[k] ?? 0) + 1;
  };

  // 分域统计：与 render 用同一函数，避免两套口径
  for (const [, d] of detailRows) {
    const conv = convertDetail(Number(d.constant_param ?? 0), Number(d.intel_param ?? 0), Number(d.effect_id ?? 0));
    bump(conv.division);
  }

  const limit = args.limit;
  const take = <T,>(arr: T[]): T[] => (limit > 0 ? arr.slice(0, limit) : arr);

  for (const [, h] of take(heroRows)) docs.push(renderHeroDoc(h));
  for (const [, s] of take(skillRows)) {
    const sid = Number(s.skill_id);
    docs.push(renderSkillDoc(s, detailsBySkill.get(sid) ?? [], effectName, codesBySkill.get(sid) ?? []));
  }
  for (const [, e] of take(effectRows)) {
    const id = Number(e.effect_id);
    docs.push(renderMechanismDoc(e, skillsByEffect.get(id) ?? []));
  }

  // caliber：人工挑选的调研结论（tier=inferred，spec §三）
  let caliberCount = 0;
  const calDir = resolve(args.calibers);
  if (existsSync(calDir)) {
    for (const f of readdirSync(calDir).filter((n) => n.endsWith('.md')).sort()) {
      const text = readFileSync(join(calDir, f), 'utf8');
      docs.push({
        docId: `caliber:${f.replace(/\.md$/, '')}`,
        kind: 'caliber',
        tier: 'inferred',
        source: `rag/calibers/${f}`,
        facets: { kind: 'caliber' },
        body: text,
      });
      caliberCount++;
    }
  }

  const jsonl = docs.map(toJsonl).join('\n') + '\n';
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'docs.jsonl'), jsonl, 'utf8');

  const byKind: Record<string, number> = {};
  for (const d of docs) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDir: args.src,
    tables: Object.fromEntries(
      TABLES.map((t) => [t, { rows: tables[t].rows.length, sha256: tables[t].hash, bytes: tables[t].bytes }])
    ),
    docs: byKind,
    totalDocs: docs.length,
    corpusBytes: Buffer.byteLength(jsonl),
    corpusSha256: sha256(jsonl),
    divisions,
    orphanDetails: orphanDetails.length,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('docs →', join(outDir, 'docs.jsonl'));
  console.log('  kinds:', JSON.stringify(byKind), '| total', docs.length);
  console.log('  calibers:', caliberCount);
  console.log('  槽位分域:', JSON.stringify(divisions));
  console.log('  无主槽位（skill 表里没有）:', orphanDetails.length);
  console.log('  语料', (manifest.corpusBytes / 1024).toFixed(0), 'KB | sha256', manifest.corpusSha256.slice(0, 12));
  const unresolved = divisions[DIV_UNRESOLVED] ?? 0;
  console.log('  未定分域占比:', ((unresolved / detailRows.length) * 100).toFixed(1) + '%');
}

main();
