// 执行 scripts/seed_heroes.sql 建表 + 灌入种子数据
// 用法：node scripts/seed_db.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'seed_heroes.sql'), 'utf8');

const conn = await mysql.createConnection({
  host: 'localhost',
  port: 3306,
  user: 'ybyt',
  password: '123456',
  database: 'stzb战斗系统',
  multipleStatements: true,
});

try {
  await conn.query(sql);
  const [rows] = await conn.query('SELECT id, name, rarity, cost, faction, tags FROM heroes ORDER BY id');
  console.log(`建表完成，当前武将 ${rows.length} 条：`);
  for (const r of rows) console.log(`  - ${r.id}\t${r.name}\t${r.rarity}\tCOST${r.cost}\t${r.faction}\t[${r.tags}]`);
} catch (e) {
  console.error('执行失败：', e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
