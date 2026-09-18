/**
 * 把已实现主战法挂入 `web/data/heroes.json`（MySQL 不可用时的等效同步）。
 *
 * 正常流程：src/data/skills.ts 定义 → scripts/build_heroes_seed.mjs（SKILL_ID_BY_NAME）
 *          → node scripts/seed_db.mjs → node scripts/export_web_data.mjs → web/data/heroes.json
 * 本脚本用于 MySQL 服务缺失/不可达时，等价地写入导出产物，保证测试与站点拿到新挂槽。
 * 幂等：与 build_heroes_seed.mjs 的 SKILL_ID_BY_NAME 保持一致，DB 恢复后重跑正向流程即覆盖。
 *
 * 用法：node scripts/sync_hero_mainskill.mjs <heroId> <skillId>
 * 例：  node scripts/sync_hero_mainskill.mjs h498 hubao_dujun
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const P = join(__dirname, '../web/data/heroes.json');

const [heroId, skillId] = process.argv.slice(2);
if (!heroId || !skillId) {
  console.error('用法: node scripts/sync_hero_mainskill.mjs <heroId> <skillId>');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(P, 'utf8'));
const hero = rows.find((r) => r.id === heroId);
if (!hero) {
  console.error(`未找到武将 ${heroId}`);
  process.exit(1);
}
const before = hero.mainSkillId;
hero.mainSkillId = skillId;
// 末尾补换行，与 web/data/heroes.json 既有格式（export_web_data 产物 + 88e13ea 对齐）一致，避免每次重跑多出「末行换行」噪声 diff
writeFileSync(P, JSON.stringify(rows, null, 2) + '\n', 'utf8');
console.log(`${heroId} ${hero.name}：mainSkillId "${before}" → "${hero.mainSkillId}"（共 ${rows.length} 条）`);
