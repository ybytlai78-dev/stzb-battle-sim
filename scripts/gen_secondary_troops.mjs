// 生成 src/data/secondaryTroops.ts —— 武将 → 两个二级兵种转换方向（官方数据）
//
// 数据源：
//   scripts/_official_hero.json  官方武将表（hero_type_availible 代码）
//   web/data/heroes.json         本仓库武将（id → 名称/阵营/兵种）
// 口径（见 docs/兵种转换调研.md）：
//   单字代码 = 基础兵种（1=弓 2=步 3=骑）；两位/三位代码 = 二级兵种，逐位查 CODE_TO_TROOP
//   XP/SP 变体按「名称 + 基础兵种 + 赛季」对齐，避免同名不同版本串味
import fs from 'node:fs';
import path from 'node:path';

const official = JSON.parse(fs.readFileSync('scripts/_official_hero.json', 'utf8'));
const localHeroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8'));

const TRUE_TYPE = { 1: '弓', 2: '步', 3: '骑' };
/** 单字代码 → 基础兵种（官方 hero_type 是旋转占位，不能直接用；与引擎 CODE_TO_TROOP 同源） */
const SINGLE_TO_BASE = { 1: '弓', 2: '步', 3: '骑' };
const CODE_TO_TROOP = {
  '11': '长弓兵',
  '21': '弩兵',
  '31': '死士',
  '12': '重步兵',
  '22': '长枪兵',
  '32': '禁卫',
  '42': '藤甲兵',
  '52': '蛮兵',
  '13': '重骑兵',
  '23': '轻骑兵',
  '33': '弓骑兵',
  '43': '铁骑兵',
  '53': '象兵',
  '101': '解烦兵',
  '102': '白毦兵',
  '153': '西凉铁骑',
  '172': '白衣死士',
  '173': '木牛流马',
};

// 官方条目 → 变体
const variants = [];
for (const h of official) {
  if (h.quality < 5) continue;
  const codes = String(h.hero_type_availible || '').split(',').filter(Boolean);
  const single = codes.find((c) => c.length === 1);
  const toks = codes.filter((c) => c.length > 1);
  if (!single || toks.length !== 2) continue;
  if (toks.some((c) => !CODE_TO_TROOP[c])) {
    throw new Error(`未知代码 ${toks.join(',')} @ ${h.name}`);
  }
  variants.push({
    name: h.name,
    base: SINGLE_TO_BASE[single],
    season: h.season,
    troops: toks.map((c) => CODE_TO_TROOP[c]),
  });
}

// 本仓库武将 → 匹配变体
const BASE_CN = { infantry: '步', cavalry: '骑', archer: '弓' };
const norm = (s) => s.replace(/^(XP|SP)/, '').replace(/[＆&]/g, '&').trim();
const rows = [];
const misses = [];
for (const lh of localHeroes) {
  const base = BASE_CN[lh.troopType];
  const tag = /^XP/.test(lh.name) || /^h8\d\d$/.test(lh.id) ? 'XP' : /^SP/.test(lh.name) ? 'SP' : null;
  const names = [...new Set([norm(lh.name), norm(lh.name).replace(/&/g, '＆'), lh.name.replace(/^(XP|SP)/, '')])];
  let pool = [];
  for (const n of names) {
    pool = variants.filter((v) => v.name === n && v.base === base);
    if (pool.length) break;
  }
  let hit = null;
  if (pool.length) {
    if (tag === 'XP') hit = pool.find((v) => v.season === 'XP') ?? null;
    if (!hit && tag === 'SP') hit = pool.find((v) => v.season === 'SP') ?? null;
    if (!hit) hit = pool.find((v) => v.season === 'N') ?? pool[0];
  }
  if (!hit) {
    misses.push(`${lh.id} ${lh.name}(${lh.faction}${base})`);
    continue;
  }
  rows.push({ id: lh.id, name: lh.name, troops: hit.troops, season: hit.season });
}

// 未上线五星（官方表内 is_release=0、本仓库暂未收录）—— 用户已定一并入库。
// 只收「真正有两个人形转换方向的武将条目」：排除 NPC「侍卫」与活动/纪念卡（率土X载、百家纵横…）。
// 「名将」是用户点名的条目，虽为占位名也一并收。
const NON_HERO = new Set(['侍卫']);
const PLACEHOLDER_HEROES = new Set(['名将']);
const localNames = new Set(localHeroes.map((h) => norm(h.name)));
const unreleased = [];
const seenUnreleased = new Set();
for (const v of variants) {
  if (localNames.has(norm(v.name)) || NON_HERO.has(v.name)) continue;
  if (!PLACEHOLDER_HEROES.has(v.name) && !/^[\u4e00-\u9fa5]{2,4}$/.test(v.name)) continue;
  const h = official.find((x) => x.name === v.name && TRUE_TYPE[x.hero_type] === v.base && x.quality >= 5);
  if (!h || h.is_release) continue;
  const key = v.name + '|' + v.base;
  if (seenUnreleased.has(key)) continue;
  seenUnreleased.add(key);
  unreleased.push({ id: `pending_${v.name}_${v.base}`, name: v.name, faction: h.country, base: v.base, troops: v.troops });
}
unreleased.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

// 官方表内「二级兵种数据不完整」的五星条目（只有 1 个方向）：仅登记，不入转换表
const incomplete = [];
const seenInc = new Set();
for (const h of official) {
  if (h.quality < 5) continue;
  const codes = String(h.hero_type_availible || '').split(',').filter(Boolean);
  const toks = codes.filter((c) => c.length > 1);
  if (toks.length !== 1) continue;
  if (localNames.has(norm(h.name)) || NON_HERO.has(h.name)) continue;
  if (seenInc.has(h.name)) continue;
  seenInc.add(h.name);
  incomplete.push({ name: h.name, troops: [CODE_TO_TROOP[toks[0]] ?? toks[0]] });
}

if (misses.length) {
  console.error('未匹配：\n' + misses.join('\n'));
  process.exit(1);
}

const lines = [];
lines.push('/**');
lines.push(' * 武将 → 两个二级兵种转换方向（官方武将表数据，自动生成，勿手改）');
lines.push(' *');
lines.push(' * 生成：`node scripts/gen_secondary_troops.mjs`');
lines.push(' * 依据：`docs/兵种转换调研.md` §三（官方 hero_type_availible 解码，161/161 对齐）');
lines.push(' * 每个五星武将恰好两个方向；同一武将其本体 / SP / XP 卡的方向可能不同（已按赛季对齐）。');
lines.push(' */');
lines.push("import type { SecondaryTroopType } from '../engine/secondaryTroop';");
lines.push('');
lines.push('/** 武将 id → [二级兵种 A, 二级兵种 B] */');
lines.push('export const HERO_SECONDARY_TROOPS: Record<string, [SecondaryTroopType, SecondaryTroopType]> = {');
for (const r of rows) {
  lines.push(`  ${r.id}: ['${r.troops[0]}', '${r.troops[1]}'], // ${r.name}`);
}
lines.push('};');
lines.push('');
lines.push('/** 官方表内尚未上线的五星（用户 2026-09-20 决定一并入库；本仓库暂无面板数据） */');
lines.push('export const PENDING_SECONDARY_TROOPS: Array<{ name: string; faction: string; base: string; troops: [SecondaryTroopType, SecondaryTroopType] }> = [');
for (const r of unreleased) {
  lines.push(`  { name: '${r.name}', faction: '${r.faction}', base: '${r.base}', troops: ['${r.troops[0]}', '${r.troops[1]}'] },`);
}
lines.push('];');
lines.push('');
lines.push('/**');
lines.push(' * 官方表内「二级兵种数据不完整」（只有 1 个方向）的五星条目 —— 仅登记，不入转换表。');
lines.push(' * 实现说明：一个武将必须有**两个**转换方向才能进兵种选择界面，故这些条目等官方补数据。');
lines.push(' */');
lines.push('export const INCOMPLETE_SECONDARY_TROOPS: Array<{ name: string; knownTroops: string[] }> = [');
for (const r of incomplete) {
  lines.push(`  { name: '${r.name}', knownTroops: [${r.troops.map((t) => `'${t}'`).join(', ')}] },`);
}
lines.push('];');
lines.push('');

const out = path.join('src', 'data', 'secondaryTroops.ts');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`写入 ${out}：${rows.length} 个武将 + ${unreleased.length} 个未上线五星`);
