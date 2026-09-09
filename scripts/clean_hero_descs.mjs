/**
 * 清洗 web/data/heroes.json 的 skillDesc（官方数据两版本拼接瑕疵，与 gen_skill_data/build_heroes_seed 同规则）
 * 运行：node scripts/clean_hero_descs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'web/data/heroes.json');

const dedupeDesc = (d) => {
  if (!d) return d;
  const head = d.slice(0, 6);
  const idx = d.indexOf(head, 2);
  if (idx <= 0 || idx >= d.length - 6) return d;
  const a = d.slice(0, idx);
  const b = d.slice(idx);
  return b.startsWith(a) ? b : a;
};

const heroes = JSON.parse(fs.readFileSync(file, 'utf8'));
let cleaned = 0;
for (const h of heroes) {
  const before = h.skillDesc ?? '';
  const after = dedupeDesc(before);
  if (after !== before) {
    console.log(`- ${h.name}(${h.faction}): ${before.length} -> ${after.length}`);
    h.skillDesc = after;
    cleaned++;
  }
}
fs.writeFileSync(file, JSON.stringify(heroes, null, 2) + '\n');
console.log(`cleaned ${cleaned} / ${heroes.length}`);
