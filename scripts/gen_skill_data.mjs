/**
 * 生成 web/data/skill_grades.json + web/data/skill_desc.json
 * skill_grades：SKILL_REGISTRY 每个战法 id → 官方品级（S/A/B/C/D）
 * skill_desc：战法 id → 官方描述（1级/满级，网易战法库 skill_extra.json，与 _classified.json 校验一致）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const official = JSON.parse(fs.readFileSync(path.join(__dirname, 'skill_extra.json'), 'utf8'));
const byName = {};
for (const s of official) byName[s.name] = s;

/** 官方数据描述清洗：多处存在「两个版本描述拼接」瑕疵（如魏武之世）。
 *  检测前 6 字第二次出现：若后半是前半的完整超集 → 取后半；否则取前半（第一个完整效果，与引擎实现一致）。 */
function dedupeDesc(d) {
  if (!d) return d;
  const head = d.slice(0, 6);
  const idx = d.indexOf(head, 2);
  if (idx <= 0 || idx >= d.length - 6) return d;
  const a = d.slice(0, idx);
  const b = d.slice(idx);
  return b.startsWith(a) ? b : a;
}

const src = fs.readFileSync(path.join(root, 'src/data/skills.ts'), 'utf8');
// 解析 SKILL_REGISTRY 条目：key: { id: 'x', name: 'y', ... }
const re = /^\s{2}([A-Za-z0-9_]+):\s*\{\n([\s\S]*?)\n\s{2}\},/gm;
const grades = {};
const descs = {};
const problems = [];
let m;
while ((m = re.exec(src)) !== null) {
  const key = m[1];
  const body = m[2];
  const idM = body.match(/id:\s*'([^']+)'/);
  const nameM = body.match(/name:\s*'([^']+)'/);
  if (!idM || !nameM) continue;
  const id = idM[1];
  const name = nameM[1];
  const s = byName[name];
  if (!s) { problems.push(`${id} ${name}: 官方无此战法`); continue; }
  grades[id] = s.zfQuality;
  descs[id] = {
    name,
    desc: dedupeDesc(s.desc ?? ''),
    desc1: dedupeDesc(s['desc(level1)'] ?? ''),
    targetType: s.targetShow ?? '',
    quality: s.zfQuality,
  };
}
fs.writeFileSync(path.join(root, 'web/data/skill_grades.json'), JSON.stringify(grades, null, 1));
fs.writeFileSync(path.join(root, 'web/data/skill_desc.json'), JSON.stringify(descs, null, 1));
console.log(`grades: ${Object.keys(grades).length} / descs: ${Object.keys(descs).length} / registry entries`);
for (const p of problems) console.log('PROBLEM:', p);
