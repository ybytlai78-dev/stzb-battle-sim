/**
 * 导出 Web 端数据：MySQL heroes 表 → web/data/heroes.json
 * 用法：node scripts/export_web_data.mjs
 * 浏览器无法直连 MySQL，Web 端通过本脚本导出的 JSON 加载武将数据。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../web/data/heroes.json');

const conn = await mysql.createConnection({
  host: 'localhost',
  port: 3306,
  user: 'ybyt',
  password: '123456',
  database: 'stzb战斗系统',
});

const [rows] = await conn.query(
  `SELECT id, name, rarity, cost, faction, tags, mutual_exclusion_group, troop_type,
          attack_range, base_attack, base_defense, base_strategy, base_speed,
          growth_attack, growth_defense, growth_strategy, growth_speed,
          main_skill_id, main_skill_name, skill_desc
   FROM heroes
   ORDER BY rarity DESC, cost DESC, name`
);
await conn.end();

const heroes = rows.map((r) => ({
  id: r.id,
  name: r.name,
  rarity: r.rarity,
  cost: Number(r.cost),
  faction: r.faction,
  tags: r.tags ? String(r.tags).split(',').filter(Boolean) : [],
  mutualExclusionGroup: r.mutual_exclusion_group,
  troopType: r.troop_type,
  attackRange: r.attack_range,
  baseAttack: r.base_attack,
  baseDefense: r.base_defense,
  baseStrategy: r.base_strategy,
  baseSpeed: r.base_speed,
  growthAttack: Number(r.growth_attack),
  growthDefense: Number(r.growth_defense),
  growthStrategy: Number(r.growth_strategy),
  growthSpeed: Number(r.growth_speed),
  mainSkillId: r.main_skill_id,
  mainSkillName: r.main_skill_name,
  skillDesc: r.skill_desc ?? '',
}));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(heroes, null, 2), 'utf8');
console.log(`已导出 ${heroes.length} 个武将 → ${OUT}`);
