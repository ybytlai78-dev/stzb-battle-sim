/**
 * 武将画像映射：将 web/data/heroes.json 的 103 个武将映射到网易官方武将库 ID
 * 输入：web/data/heroes.json + 官方 hero.json（本脚本运行前需先下载到 scripts/_official_hero.json）
 * 输出：web/data/portrait_map.json（ourId → { iconId, officialName, uniqueName }）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const ours = JSON.parse(fs.readFileSync(path.join(root, 'web/data/heroes.json'), 'utf8'));
const off = JSON.parse(fs.readFileSync(path.join(__dirname, '_official_hero.json'), 'utf8'));

const COUNTRY = { 1: '汉', 2: '魏', 3: '蜀', 4: '吴', 5: '群', 6: '晋' };
const TYPE = { 1: '弓', 2: '步', 3: '骑' };

const map = {};
const problems = [];

/** SP 卡：官方 JSON 中名为基础名（如 赵云），通过 is_sp_card=1 定位，画像用 SP 专属 hero_id（102xxx） */
const SP_BY_BASE = {};
for (const o of off) {
  if (o.is_sp_card === 1 && o.hero_id >= 102000 && o.hero_id < 103000) SP_BY_BASE[o.name] = o.hero_id;
}

for (const h of ours) {
  const isSp = (h.tags || []).includes('sp');
  const country = COUNTRY[h.faction] ?? h.faction;
  const type = TYPE[`${h.troopType === 'cavalry' ? 3 : h.troopType === 'infantry' ? 2 : 1}`];
  if (isSp && SP_BY_BASE[h.name.replace(/^SP/, '')]) {
    const sid = SP_BY_BASE[h.name.replace(/^SP/, '')];
    map[h.id] = {
      iconId: sid,
      heroId: sid,
      officialName: h.name,
      isSpCard: true,
      note: `q5 ${country}-${type} SP`,
    };
    continue;
  }
  let cands = off.filter((o) => o.name === h.name && o.quality === 5);
  if (cands.length === 0) {
    problems.push(`${h.id} ${h.name}: no q5 name match`);
    continue;
  }
  // SP 卡优先 is_sp_card=1，普卡优先 is_sp_card=0
  let pick = cands.find((o) => o.is_sp_card === (isSp ? 1 : 0) && COUNTRY[o.country] === country && TYPE[o.hero_type] === type);
  if (!pick) pick = cands.find((o) => o.is_sp_card === (isSp ? 1 : 0) && COUNTRY[o.country] === country);
  if (!pick) pick = cands.find((o) => o.is_sp_card === (isSp ? 1 : 0));
  if (!pick) pick = cands[0];
  // 100xxx 系列优先（102xxx 为 SP 专属、130xxx 为赛季复刻）
  const rank = (id) => (id >= 100000 && id < 101000 ? 0 : id >= 102000 && id < 103000 ? 1 : 2);
  const same = cands.filter((o) => o.is_sp_card === pick.is_sp_card && COUNTRY[o.country] === country && TYPE[o.hero_type] === type);
  if (same.length > 1) {
    same.sort((a, b) => rank(a.hero_id) - rank(b.hero_id) || (a.season === 'N' ? 0 : 1) - (b.season === 'N' ? 0 : 1));
    pick = same[0];
  }
  map[h.id] = {
    iconId: pick.icon_hero_id || pick.hero_id,
    heroId: pick.hero_id,
    officialName: pick.name,
    isSpCard: pick.is_sp_card === 1,
    note: `q${pick.quality} ${COUNTRY[pick.country]}-${TYPE[pick.hero_type]}${pick.is_sp_card ? ' SP' : ''}${pick.season !== 'N' ? ' 赛季' : ''}`,
  };
}

fs.writeFileSync(path.join(root, 'web/data/portrait_map.json'), JSON.stringify(map, null, 2));
console.log(`mapped: ${Object.keys(map).length} / ${ours.length}`);
for (const p of problems) console.log('PROBLEM:', p);
