#!/usr/bin/env tsx
/**
 * 引擎 ↔ 包内 数值对拍（只读，不改任何数据）。
 *
 * 两个数据源：
 * - 引擎：`web/data/heroes.json`（170 条，`src/data/heroes.ts` 在 MySQL 不可达时也回退它）
 * - 包内：`tb_cfg_hero.json` + `tb_cfg_skill.json`
 *
 * 对齐方式：引擎没有官方 heroid 字段，只能靠**数值指纹**（四维初始 + 四维成长）join。
 * 指纹唯一命中 154/170；多候选按同名优先、再按 heroid 升序 tie-break（确定性，且不影响数值判定：
 * 同指纹的记录数值本就相同）；指纹无命中 = 引擎值不在包内，直接记为差异。
 *
 * 用法：`npx tsx scripts/rag/diff.mts [--json out.json] [--only-diff]`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { COUNTRY, TROOP, heroCost, heroStar } from './render.mjs';
import type { Row } from './render.mjs';

const SRC_DEFAULT = 'C:/Users/lai15/Desktop/rea_stzb/dec/json';

export type Status = 'match' | 'diff' | 'engine-only' | 'pkg-only' | 'missing';

export interface FieldDiff {
  field: string;
  engine: string | number | null;
  pkg: string | number | null;
  /** 差异两侧的原始坐标 */
  engineAt: string;
  pkgAt: string;
}

export interface HeroDiff {
  engineId: string;
  name: string;
  pkgId: number | null;
  status: Status;
  diffs: FieldDiff[];
}

const TROOP_TO_ENGINE: Record<number, string> = { 1: 'archer', 2: 'infantry', 3: 'cavalry' };

const fixed2 = (v: unknown): string => Number(v ?? 0).toFixed(2);

/** 数值指纹：四维初始 + 四维成长，统一乘 100 取整后拼接（引擎侧是小数，包内侧是 ×100 整数） */
export function fingerprint(values: number[]): string {
  return values.map((v) => Math.round(Number(v) * 100)).join(',');
}

export function engineFingerprint(h: Row): string {
  return fingerprint([h.baseAttack, h.baseDefense, h.baseStrategy, h.baseSpeed, h.growthAttack, h.growthDefense, h.growthStrategy, h.growthSpeed]);
}

export function pkgFingerprint(r: Row): string {
  return fingerprint([
    Number(r.attack_base) / 100,
    Number(r.defence_base) / 100,
    Number(r.intel_base) / 100,
    Number(r.speed_base) / 100,
    Number(r.attack_grow) / 100,
    Number(r.defence_grow) / 100,
    Number(r.intel_grow) / 100,
    Number(r.speed_grow) / 100,
  ]);
}

/**
 * 对齐：先试「引擎 id 与包内 heroid 同号」直配，再靠数值指纹取候选集并按「主战法名 → 武将名 → heroid 升序」定序。
 *
 * 为什么需要 id 直配：包内同一武将有多个版本共用同一套面板 —— 普通版 100xxx、SP 版 102xxx、
 * 重复段 130xxx/132xxx。例如赵云四条同指纹记录：100021(银龙冲阵) / 102001(银龙孤胆) / 130021 / 132001。
 * 引擎 id `h102015`／`h102001` 这类带 6 位数字的，正是包内 heroid 加 `h` 前缀 ⇒ 同号即同一张卡。
 * 仅靠指纹会因为「SP 版与普通版同名同战法同名面板」而错配到普通版（SP 孙尚香 102015 是蜀，
 * 错配 100036 会假报一条「势力 蜀≠吴」）。
 *
 * id 直配仍要求至少一项旁证（名字/主战法/四维之一相同）成立，避免 heroid 被复用时误配。
 */
export function alignHeroes(
  engineHeroes: Row[],
  pkgHeroes: Row[],
  skillNameById: Map<number, string> = new Map()
): Map<string, number | null> {
  const byFp = new Map<string, Row[]>();
  const byId = new Map<number, Row>();
  for (const r of pkgHeroes) {
    byId.set(Number(r.heroid), r);
    const fp = pkgFingerprint(r);
    const list = byFp.get(fp);
    if (list) list.push(r);
    else byFp.set(fp, [r]);
  }
  const out = new Map<string, number | null>();
  for (const h of engineHeroes) {
    const samePkg = (c: Row): boolean =>
      String(c.name) === String(h.name) ||
      (skillNameById.size && String(skillNameById.get(Number(c.skill_init)) ?? '') === String(h.mainSkillName ?? '')) ||
      pkgFingerprint(c) === engineFingerprint(h);

    const idMatch = /^h(\d{4,6})$/.exec(String(h.id));
    if (idMatch) {
      const hit = byId.get(Number(idMatch[1]));
      if (hit && samePkg(hit)) {
        out.set(String(h.id), Number(hit.heroid));
        continue;
      }
    }

    const cands = byFp.get(engineFingerprint(h)) ?? [];
    if (!cands.length) {
      out.set(String(h.id), null);
      continue;
    }
    const score = (c: Row): number => {
      let s = 0;
      if (skillNameById.size && String(skillNameById.get(Number(c.skill_init)) ?? '') === String(h.mainSkillName ?? '')) s += 4;
      if (String(c.name) === String(h.name)) s += 2;
      // 重复段 13xxxx 与 100xxx/102xxx 同面板同战法，属同一条数据的副本 —— 定序时降权，避免抢到主记录
      if (String(c.heroid).startsWith('13')) s -= 1;
      return s;
    };
    const pool = cands.slice().sort((a, b) => score(b) - score(a) || Number(a.heroid) - Number(b.heroid));
    out.set(String(h.id), Number(pool[0].heroid));
  }
  return out;
}

/** 字段对拍：只比双方都有明确口径的字段 */
export function diffHero(h: Row, pkg: Row, skillNameById: Map<number, string>): FieldDiff[] {
  const out: FieldDiff[] = [];
  const cmp = (field: string, engine: string | number | null, pkgv: string | number | null, pkgField: string): void => {
    if (String(engine ?? '') !== String(pkgv ?? '')) {
      out.push({
        field,
        engine,
        pkg: pkgv,
        engineAt: `web/data/heroes.json/${h.id}/${field}`,
        pkgAt: `@pkg:tb_cfg_hero/${pkg.heroid}/${pkgField}`,
      });
    }
  };

  cmp('攻击', fixed2(h.baseAttack), fixed2(Number(pkg.attack_base) / 100), 'attack_base');
  cmp('防御', fixed2(h.baseDefense), fixed2(Number(pkg.defence_base) / 100), 'defence_base');
  cmp('谋略', fixed2(h.baseStrategy), fixed2(Number(pkg.intel_base) / 100), 'intel_base');
  cmp('速度', fixed2(h.baseSpeed), fixed2(Number(pkg.speed_base) / 100), 'speed_base');
  cmp('攻击成长', fixed2(h.growthAttack), fixed2(Number(pkg.attack_grow) / 100), 'attack_grow');
  cmp('防御成长', fixed2(h.growthDefense), fixed2(Number(pkg.defence_grow) / 100), 'defence_grow');
  cmp('谋略成长', fixed2(h.growthStrategy), fixed2(Number(pkg.intel_grow) / 100), 'intel_grow');
  cmp('速度成长', fixed2(h.growthSpeed), fixed2(Number(pkg.speed_grow) / 100), 'speed_grow');

  const cost = heroCost(pkg.cost);
  cmp('统率', fixed2(h.cost), cost.placeholder ? `未设置(${cost.value})` : cost.value.toFixed(2), 'cost');
  cmp('势力', String(h.faction ?? ''), COUNTRY[Number(pkg.country)] ?? `unknown(${pkg.country})`, 'country');
  cmp('兵种', String(h.troopType ?? ''), TROOP_TO_ENGINE[Number(pkg.hero_type)] ?? `unknown(${pkg.hero_type})`, 'hero_type');
  cmp('攻击距离', Number(h.attackRange ?? 0), Number(pkg.hit_range ?? 0), 'hit_range');
  cmp('星级', String(h.rarity ?? ''), `${heroStar(pkg.quality)}星`, 'quality');

  const pkgSkillName = skillNameById.get(Number(pkg.skill_init)) ?? null;
  cmp('主战法', String(h.mainSkillName ?? ''), pkgSkillName, 'skill_init');

  return out;
}

function loadJsonRows(path: string): Record<string, Row> {
  return (JSON.parse(readFileSync(path, 'utf8')) as { rows?: Record<string, Row> }).rows ?? {};
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const src = flag('--src', SRC_DEFAULT);
  const enginePath = flag('--engine', 'web/data/heroes.json');
  const jsonOut = flag('--json', '');
  const onlyDiff = argv.includes('--only-diff');

  const engineHeroes: Row[] = JSON.parse(readFileSync(enginePath, 'utf8')) as Row[];
  const pkgHeroes = Object.values(loadJsonRows(`${src}/tb_cfg_hero.json`));
  const skillRows = loadJsonRows(`${src}/tb_cfg_skill.json`);
  const skillNameById = new Map<number, string>();
  for (const s of Object.values(skillRows)) skillNameById.set(Number(s.skill_id), String(s.name ?? ''));

  const pkgById = new Map<number, Row>();
  for (const r of pkgHeroes) pkgById.set(Number(r.heroid), r);

  const align = alignHeroes(engineHeroes, pkgHeroes, skillNameById);
  const results: HeroDiff[] = [];
  const usedPkg = new Set<number>();

  for (const h of engineHeroes) {
    const pkgId = align.get(String(h.id)) ?? null;
    if (pkgId === null) {
      results.push({ engineId: String(h.id), name: String(h.name), pkgId: null, status: 'engine-only', diffs: [] });
      continue;
    }
    usedPkg.add(pkgId);
    const pkg = pkgById.get(pkgId);
    if (!pkg) {
      results.push({ engineId: String(h.id), name: String(h.name), pkgId, status: 'missing', diffs: [] });
      continue;
    }
    const diffs = diffHero(h, pkg, skillNameById);
    results.push({ engineId: String(h.id), name: String(h.name), pkgId, status: diffs.length ? 'diff' : 'match', diffs });
  }

  for (const r of pkgHeroes) {
    const id = Number(r.heroid);
    if (!usedPkg.has(id)) results.push({ engineId: '', name: String(r.name), pkgId: id, status: 'pkg-only', diffs: [] });
  }

  const count = (s: Status): number => results.filter((r) => r.status === s).length;
  const fieldTally = new Map<string, number>();
  for (const r of results) for (const d of r.diffs) fieldTally.set(d.field, (fieldTally.get(d.field) ?? 0) + 1);

  console.log(`引擎武将 ${engineHeroes.length} 条 | 包内 ${pkgHeroes.length} 条 | 包内未被引擎使用 ${count('pkg-only')} 条`);
  console.log(
    `对齐结果：一致 ${count('match')} | 有差异 ${count('diff')} | 引擎独有(包内无此数值) ${count('engine-only')} | 对齐失效 ${count('missing')}`
  );
  if (fieldTally.size) {
    console.log('差异按字段：' + [...fieldTally.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(' · '));
  }

  const shown = onlyDiff ? results.filter((r) => r.status === 'diff' || r.status === 'engine-only') : results;
  for (const r of shown) {
    if (r.status === 'match' || r.status === 'pkg-only') continue;
    if (r.status === 'engine-only') {
      console.log(`\n✗ ${r.engineId} ${r.name} — 包内没有同数值武将（引擎独有，来源需登记）`);
      continue;
    }
    console.log(`\n△ ${r.engineId} ${r.name} ↔ 包内 ${r.pkgId}`);
    for (const d of r.diffs) console.log(`   ${d.field}: 引擎 ${d.engine} ≠ 包内 ${d.pkg}   [${d.pkgAt}]`);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), summary: { total: results.length }, results }, null, 2));
    console.log(`\nJSON → ${jsonOut}`);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/rag/diff.mts')) main();
