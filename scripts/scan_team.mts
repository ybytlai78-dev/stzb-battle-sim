/**
 * 敌对队伍集：投放箱 → 库校验 → 归档 + 汇总
 * ---------------------------------------------------------------------------
 * 用法：`npx tsx scripts/scan_team.mts [--dry]`
 *
 * 投放箱 `敌对队伍集/`：AI 放「截图 + 同名 .json（识别结果）」；
 *   校验通过 → 图与 JSON 一起移动到 `已识别敌对队伍集/`（归档 JSON 带 `resolved` 解析结果）；
 *   校验失败 → 两者留在投放箱（你一眼看得出哪些没识别），原因写入 `_errors.json`。
 * `队伍集.json` 每次按归档目录重建（幂等），可直接导入 L4 对手池。
 *
 * 口径与规则：`docs/截图识别-敌对队伍集.md`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_REGISTRY } from '../src/data/skills';
import { AFFIXES, TREASURES } from '../src/data/treasures';
import { FAMILY_TRAITS } from '../src/engine/secondaryTroop';
import { buildTables, toOpponentEntries, validateScan, type ScanJson, type ResolvedSlot } from '../web/teamScan';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, '敌对队伍集');
const ARCHIVE = path.join(ROOT, '已识别敌对队伍集');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DRY = process.argv.includes('--dry');

const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/heroes.json'), 'utf8')) as Array<{
  id: string;
  name: string;
  mainSkillId?: string;
  mainSkillName?: string;
  troopType?: string;
}>;
const tables = buildTables({
  heroes: heroes.map((h) => ({
    id: h.id,
    name: h.name,
    mainSkillId: h.mainSkillId,
    mainSkillName: h.mainSkillName,
    troopType: h.troopType ?? 'infantry',
  })),
  skills: SKILL_REGISTRY,
  treasures: TREASURES,
  affixes: AFFIXES,
  traits: Object.values(FAMILY_TRAITS).flat(),
});

interface ErrorRow {
  file: string;
  slot?: number;
  rule: string;
  message: string;
}

fs.mkdirSync(ARCHIVE, { recursive: true });
const images = fs.readdirSync(INBOX).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
const errors: ErrorRow[] = [];
let moved = 0;

for (const img of images) {
  const base = path.basename(img, path.extname(img));
  const jsonPath = path.join(INBOX, `${base}.json`);
  if (!fs.existsSync(jsonPath)) {
    errors.push({ file: img, rule: 'missing-json', message: '没有同名识别结果 JSON' });
    continue;
  }
  let scan: ScanJson;
  try {
    scan = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ScanJson;
  } catch (err) {
    errors.push({ file: img, rule: 'json-parse', message: `JSON 解析失败：${String(err).slice(0, 120)}` });
    continue;
  }
  const res = validateScan(scan, tables);
  if (!res.ok) {
    const bad = res.issues.filter((x) => x.level === 'error');
    for (const i of bad) errors.push({ file: img, slot: i.slot, rule: i.rule, message: i.message });
    console.log(`✗ ${img}：${bad.map((x) => x.message).join('；')}`);
    continue;
  }
  if (!DRY) {
    fs.writeFileSync(
      path.join(ARCHIVE, `${base}.json`),
      `${JSON.stringify({ ...scan, resolved: { slots: res.slots, issues: res.issues } }, null, 2)}\n`,
      'utf8'
    );
    fs.renameSync(path.join(INBOX, img), path.join(ARCHIVE, img));
    fs.rmSync(jsonPath, { force: true });
  }
  moved += 1;
  const warns = res.issues.filter((x) => x.level === 'warn');
  console.log(
    `✓ ${img} → ${res.label}（${res.slots.map((s) => s.heroName).join(' / ')}）${warns.length ? `［${warns.length} 条提示］` : ''}`
  );
}

// 汇总（幂等重建）：扫归档目录里所有「带 resolved」的 JSON
const records = fs
  .readdirSync(ARCHIVE)
  .filter((f) => f.endsWith('.json') && f !== '队伍集.json' && f !== '_errors.json')
  .map((f) => JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), 'utf8')) as { label: string; resolved?: { slots: ResolvedSlot[] } })
  .filter((r) => Array.isArray(r.resolved?.slots));
const entries = toOpponentEntries(records.map((r) => ({ label: r.label, slots: r.resolved!.slots })));

if (!DRY) {
  fs.writeFileSync(path.join(ARCHIVE, '队伍集.json'), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(ARCHIVE, '_errors.json'), `${JSON.stringify(errors, null, 2)}\n`, 'utf8');
}
console.log(
  `\n归档 ${moved} 张，失败 ${errors.length} 条，队伍集共 ${entries.length} 队（${entries.map((e) => e.name).join(' / ') || '空'}）`
);
