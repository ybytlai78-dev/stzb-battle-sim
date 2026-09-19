/**
 * 补齐 web/data/hero_meta.json 的性别表（武将 id → '男' / '女'）。
 *
 * 数据来源：scripts/hero_extra.json 的官方 `sex` 字段。
 *  - 常规武将：hero_extra.id = 100000 + hero_id → 对应 `h<hero_id>`（如 100742 → h742）
 *  - 固定 id 武将（lvmeng / sp_zhaoyun / xp_jiangwei …）：按武将名匹配（含去掉 SP/XP 前缀再匹配）
 *
 * 幂等：**只补缺失项、不覆盖已有值**（已有项来自 Web 侧资产，已与官方 sex 全量比对一致）；
 * 输出顺序跟随 web/data/heroes.json（避免无谓 diff）。
 * 用途：引擎 `src/data/heroes.ts` 与 Web `web/heroes.ts` 共用该表取性别（辞后定朝等按性别分支的战法）。
 *
 * 运行：node scripts/sync_hero_meta.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const META_PATH = join(__dirname, '../web/data/hero_meta.json');

const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
const heroes = JSON.parse(readFileSync(join(__dirname, '../web/data/heroes.json'), 'utf8'));
const extra = JSON.parse(readFileSync(join(__dirname, 'hero_extra.json'), 'utf8'));

const byHeroId = new Map();
const byName = new Map();
for (const e of extra) {
  if (e.sex !== '男' && e.sex !== '女') continue;
  if (e.id != null) byHeroId.set(Number(e.id), e.sex);
  if (e.name) {
    byName.set(e.name, e.sex);
    byName.set(e.name.replace(/^(XP|SP)/, ''), e.sex);
  }
}

/** 取官方 sex：先按 hero_id 三种 id 形态匹配（100000+/1000000+/直接），再按武将名（含去 SP/XP 前缀） */
function sexOf(h) {
  const idNum = Number(String(h.id).replace(/^h/, ''));
  if (Number.isFinite(idNum)) {
    for (const cand of [100000 + idNum, 1000000 + idNum, idNum]) {
      const hit = byHeroId.get(cand);
      if (hit) return hit;
    }
  }
  return byName.get(h.name) ?? byName.get(h.name.replace(/^(SP|XP)/, ''));
}

const next = {};
let filled = 0;
const unfilled = [];
for (const h of heroes) {
  if (meta[h.id]) {
    next[h.id] = meta[h.id]; // 已有值不动
    continue;
  }
  const sex = sexOf(h);
  if (sex) {
    next[h.id] = sex;
    filled += 1;
  } else {
    unfilled.push(h.id);
  }
}
// 兜底：heroes.json 里没有、但 meta 里已有的键照原样保留
for (const [k, v] of Object.entries(meta)) if (!(k in next)) next[k] = v;

writeFileSync(META_PATH, JSON.stringify(next, null, 1) + '\n', 'utf8');
console.log(
  `hero_meta.json：补 ${filled} 条 → 共 ${Object.keys(next).length} 条` +
    (unfilled.length ? `；未能判定性别：${unfilled.join(', ')}` : '')
);
