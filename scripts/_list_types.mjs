import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 从 SKILL_REGISTRY 源码提取 技能id → 类型标签
const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsSrc = readFileSync(join(__dirname, '../src/data/skills.ts'), 'utf8');

function skillTypesFromSource(src) {
  const map = {};
  const blockRe = /^\s{2}(\w+):\s*\{([\s\S]*?)^\s{2}\},/gm;
  let m;
  while ((m = blockRe.exec(src))) {
    const id = m[1];
    const body = m[2];
    const type = body.match(/type:\s*'(\w+)'/)?.[1];
    const prepare = body.match(/prepare:\s*(true|false)/)?.[1];
    const phase = body.match(/phase:\s*'(\w+)'/)?.[1];
    const timing = body.match(/timing:\s*'(\w+)'/)?.[1];
    if (type) {
      let label = '';
      if (type === 'active') label = prepare === 'true' ? '主动·准备' : '主动';
      else if (type === 'pursuit') label = '追击';
      else if (type === 'command') label = phase === 'round' ? '指挥·二类' : '指挥·一类';
      else if (type === 'passive') label = timing === 'round_start' ? '被动·回合开始' : '被动·战斗开始';
      map[id] = { type, label };
    }
  }
  return map;
}

const TYPES = skillTypesFromSource(skillsSrc);

const conn = await mysql.createConnection({
  host: 'localhost',
  port: 3306,
  user: 'ybyt',
  password: '123456',
  database: 'stzb战斗系统',
});

const [rows] = await conn.execute(
  `SELECT name, faction, rarity, main_skill_id, main_skill_name FROM heroes WHERE main_skill_id != '' ORDER BY name`
);
await conn.end();

const lines = rows.map((r) => {
  const t = TYPES[r.main_skill_id];
  const label = t ? t.label : '???';
  return `${r.name}\t${r.faction}\t${r.rarity}\t${r.main_skill_name}\t${label}\t(${r.main_skill_id})`;
});
console.log('武将名\t势力\t稀有度\t战法名\t入库类型\t(技能id)');
console.log(lines.join('\n'));
console.log(`\n共 ${rows.length} 个已入库主战法武将`);
