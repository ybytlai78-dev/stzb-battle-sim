// 兵种调研产物生成 v4（最终口径）——一次性脚本
// 口径：官方 hero_type 是旋转占位（真实兵种 = 单字代码），二级兵种名由 hero_extra 4 星中文名自举的解码表给出。
// 输出：docs/兵种转换表-全五星.md、docs/兵种转换表-本库161将.md
import fs from 'node:fs';

const official = JSON.parse(fs.readFileSync('scripts/_official_hero.json', 'utf8'));
const extra = JSON.parse(fs.readFileSync('scripts/hero_extra.json', 'utf8'));
const localHeroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8'));

const oById = new Map(official.map((h) => [h.hero_id, h]));
const TRUE = { 1: '弓', 2: '步', 3: '骑' };
const FACTION = { 1: '汉', 2: '魏', 3: '蜀', 4: '吴', 5: '群', 6: '晋' };
const ORDER = { 汉: 0, 魏: 1, 蜀: 2, 吴: 3, 群: 4, 晋: 5 };

// —— 单个代码 → 二级兵种名（编号规律：十位=兵系 1弓/2步/3骑，个位=系内序号）——
// 由「4 星中文名表 × 官方代码表」交叉解码得到（30 组组合双向唯一、零冲突）
const CODE_NAME = {
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
const cn = (code) => CODE_NAME[code] ?? '?' + code;
const ORDER_IN_FAMILY = { 长弓兵: 1, 弩兵: 1, 死士: 1, 重步兵: 2, 长枪兵: 2, 禁卫: 2, 蛮兵: 5, 藤甲兵: 4, 重骑兵: 3, 轻骑兵: 3, 铁骑兵: 3, 弓骑兵: 3, 象兵: 5 };

// 一致性自检：单代码解码 vs 四星中文名组合（两者应完全等价）
let checked = 0;
const mismatched = [];
for (const x of extra) {
  const y = oById.get(x.id);
  if (!y) continue;
  const codes = String(y.hero_type_availible || '').split(',').filter((c) => c.length > 1);
  const nm = (x.type_availible || '').replace(/\s/g, '');
  if (codes.length !== 2 || !nm) continue;
  checked++;
  const mine = codes.map(cn).sort().join('、');
  const official = nm.split('、').sort().join('、');
  if (mine !== official) mismatched.push(`${x.name}(${x.id}) 官方4★=${nm} 单代码解码=${codes.map(cn).join('、')}`);
}
console.log('单代码解码自检：比对', checked, '组，不一致', mismatched.length);
mismatched.slice(0, 10).forEach((m) => console.log('  !', m));


// 解码表：真实基础兵种 + 代码对（去单字） → 中文名对
const legend = new Map();
const legendPair = new Map();
for (const x of extra) {
  const y = oById.get(x.id);
  if (!y) continue;
  const codes = String(y.hero_type_availible || '').split(',').filter(Boolean);
  const two = codes.filter((c) => c.length > 1).sort().join('+');
  const nm = (x.type_availible || '').replace(/\s/g, '');
  if (!two || !nm || !x.type) continue;
  const k = x.type + '|' + two;
  if (legend.has(k) && legend.get(k) !== nm) console.log('CONFLICT', k, legend.get(k), nm);
  legend.set(k, nm);
  if (!legendPair.has(two)) legendPair.set(two, nm);
}
// 解码表未覆盖的两组（推导，见文档）
legend.set('步|21+32', '弩兵、禁卫');
legend.set('弓|21+32', '弩兵、禁卫');
legend.set('骑|21+32', '弩兵、禁卫');
legendPair.set('21+32', '弩兵、禁卫');
legend.set('步|11+22', '长弓兵、蛮兵（待核实）');
legendPair.set('11+22', '长弓兵、蛮兵（待核实）');

// 全量（每个 名称+阵营+真实兵种 一条，合并同名同阵营同兵种的不同 id；变体单独记 season）
const variants = []; // 每个官方条目一条（含 season / 代码集 / 名称对）
for (const h of official) {
  if (h.quality < 5) continue;
  const codes = String(h.hero_type_availible || '').split(',').filter(Boolean);
  if (codes.length < 2) continue;
  const base = TRUE[h.hero_type];
  const toks = codes.filter((c) => c.length > 1);
  const two = toks.slice().sort().join('+');
  // 排序：同兵系内按系内序号，跨系按 步→骑→弓（与官方表书写顺序一致）
  const FAMILY = { 1: '步', 2: '骑', 3: '弓' };
  const names = toks.map(cn).join('、');
  variants.push({
    name: h.name,
    faction: FACTION[h.country] ?? '?' + h.country,
    base,
    season: h.season,
    names,
    codeSet: codes.join(','),
    officialId: h.hero_id,
    released: !!h.is_release,
  });
}
const all = new Map();
for (const v of variants) {
  const key = v.name + '|' + v.faction + '|' + v.base;
  const prev = all.get(key);
  if (!prev) {
    all.set(key, { ...v, seasons: [v.season], nameSets: [v.names], ids: [v.officialId], released: !!v.released });
    continue;
  }
  prev.ids.push(v.officialId);
  if (!prev.seasons.includes(v.season)) prev.seasons.push(v.season);
  if (v.released) prev.released = true;
  if (!prev.nameSets.includes(v.names)) {
    prev.nameSets.push(v.names);
    prev.codeSet += ' / ' + v.codeSet;
    prev.names += ' ／ ' + v.names;
  }
}
const list = [...all.values()].sort(
  (a, b) => (ORDER[a.faction] ?? 9) - (ORDER[b.faction] ?? 9) || a.base.localeCompare(b.base) || a.name.localeCompare(b.name, 'zh')
);
const undecoded = list.filter((r) => r.names.startsWith('??'));
console.log('rows', list.length, '| 未解码', undecoded.length, '| 变体条目', variants.length);

const md = [
  '# 全五星武将 → 二级兵种转换方向',
  '',
  `数据源：\`scripts/_official_hero.json\`（官方武将表，458 条五星条目 → 去重后 ${list.length} 个「武将×阵营×兵种」组合；同一组合的不同赛季版本已合并，赛季列列出全部）。`,
  '「可转二级兵种」两个方向为官方数据原文，非推测；代码→中文名的解码方式见 `docs/兵种转换调研.md`。',
  '',
  '| 武将 | 阵营 | 基础兵种 | 可转二级兵种 | 代码集 | 赛季 |',
  '|------|------|----------|--------------|--------|------|',
  ...list.map((r) => `| ${r.name} | ${r.faction} | ${r.base} | ${r.names} | ${r.codeSet} | ${r.seasons.join('/')} |`),
  '',
];
fs.writeFileSync('docs/兵种转换表-全五星.md', md.join('\n'), 'utf8');

// 本库 161（优先按赛季对齐 XP/SP 变体，避免同名不同版本串味）
const norm = (s) => s.replace(/^(XP|SP)/, '').replace(/[＆&]/g, '&').trim();
const BASE_CN = { infantry: '步', cavalry: '骑', archer: '弓' };
const local = [];
const miss = [];
const localBaseMismatch = [];
const seasonNote = [];
for (const lh of localHeroes) {
  const b = BASE_CN[lh.troopType];
  const tag = /^XP/.test(lh.name) || /^x?p/i.test(lh.id) || /^h8\d\d$/.test(lh.id) ? 'XP' : /^SP/.test(lh.name) ? 'SP' : null;
  const cands = [...new Set([norm(lh.name), norm(lh.name).replace(/&/g, '＆'), lh.name.replace(/^(XP|SP)/, '')])];
  let pool = [];
  for (const c of cands) {
    pool = variants.filter((v) => v.name === c && v.base === b);
    if (pool.length) break;
  }
  let hit = null;
  if (pool.length) {
    if (tag === 'XP') hit = pool.find((v) => v.season === 'XP') ?? null;
    if (!hit && tag === 'SP') hit = pool.find((v) => v.season === 'SP') ?? null;
    if (!hit) hit = pool.find((v) => v.season === 'N') ?? pool[0];
    if (tag && hit && hit.season !== tag) seasonNote.push(`${lh.id} ${lh.name}：本库为 ${tag} 卡，取了官方 season=${hit.season} 的条目`);
    if (!tag && new Set(pool.map((v) => v.names)).size > 1) seasonNote.push(`${lh.id} ${lh.name}：官方同名同兵种有 ${pool.length} 个版本，取 season=${hit.season}（${hit.names}）`);
  }
  if (!hit) {
    const anyBase = cands.map((c) => variants.find((v) => v.name === c)).find(Boolean);
    if (anyBase) localBaseMismatch.push(`${lh.id} ${lh.name}：本库记 ${b}，官方表记 ${anyBase.base}（${anyBase.names}）`);
    miss.push(`${lh.id} ${lh.name}（${lh.faction}${b}）`);
    continue;
  }
  local.push({ id: lh.id, name: lh.name, faction: lh.faction, base: b, names: hit.names, codeSet: hit.codeSet, season: hit.season });
}
const md2 = [
  '# 本仓库 161 将 → 二级兵种转换方向',
  '',
  `命中 ${local.length} / ${localHeroes.length}。`,
  '',
  '| 武将 id | 武将 | 阵营 | 基础兵种 | 可转二级兵种 | 代码集 | 官方赛季 |',
  '|---------|------|------|----------|--------------|--------|----------|',
  ...local.map((r) => `| ${r.id} | ${r.name} | ${r.faction} | ${r.base} | ${r.names} | ${r.codeSet} | ${r.season} |`),
  '',
];
if (miss.length) md2.push('## 未命中', '', ...miss.map((m) => `- ${m}`), '');
if (localBaseMismatch.length) md2.push('## 兵种口径差异（需确认）', '', ...localBaseMismatch.map((m) => `- ${m}`), '');
if (seasonNote.length) md2.push('## 版本对齐说明', '', ...seasonNote.map((m) => `- ${m}`), '');
fs.writeFileSync('docs/兵种转换表-本库161将.md', md2.join('\n'), 'utf8');
console.log('local hit', local.length, '/', localHeroes.length, '| 兵种口径差异', localBaseMismatch.length, '| 版本说明', seasonNote.length);
console.log('undecoded rows:', undecoded.map((r) => r.name + '(' + r.faction + r.base + ') ' + r.codeSet).join(' | '));
