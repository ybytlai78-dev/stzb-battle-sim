/**
 * 武将数据：MySQL 数据库加载器
 * 引擎启动时 initHeroDB() 一次性从 MySQL 加载全部武将，构建内存 Map。
 * 战斗过程零 DB 调用（引擎保持同步纯函数）。
 * 站位（position）由用户装配阵容时决定，不属于武将固有数据。
 *
 * 纯函数工具（recordToGeneral / level40 / withSkills / validateMutualExclusion）
 * 已移至 hero-utils.ts（无 Node 依赖，浏览器可打包），此处 re-export 保持兼容。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import type { General, HeroRecord } from '../engine/types';
import { level40FromRecord, recordToGeneral, validateMutualExclusion } from './hero-utils';

export type { StatPatch } from './hero-utils';
export { recordToGeneral, withSkills, validateMutualExclusion, mainSkillSlot } from './hero-utils';

export interface HeroDBConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** 树根目录（本文件位于 <树根>/src/data/ 下） */
const TREE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 工作树标识（DSH 工作树取 hash；旧 `.wt-stzb/<name>` 兜底取 name），非工作树返回 null。
 * ⚠️ 本逻辑须与 `scripts/db-config.mjs` 保持一致（tsconfig 的 include 不含 scripts/，无法直接 import）。
 */
function worktreeName(): string | null {
  const dsh = /[\\/]\.dsh[\\/]worktrees[\\/]([^\\/]+)[\\/][^\\/]+$/.exec(TREE_ROOT);
  if (dsh) return `dsh_${dsh[1]}`;
  const legacy = /[\\/]\.wt-stzb[\\/]([^\\/]+)$/.exec(TREE_ROOT);
  return legacy ? `wt_${legacy[1]}` : null;
}

/**
 * 默认连接配置。**工作树自动隔离**：在 DSH 工作树（`.dsh/worktrees/<hash>/<dirname>`）下运行时
 * 自动改用独立库 `stzb战斗系统_dsh_<hash>`，避免多个工作区共用一库互相污染
 * （旧 `.wt-stzb/<name>` 布局仍按 `stzb战斗系统_wt_<name>` 兜底）。
 * 可用 `STZB_DB_HOST` / `STZB_DB_PORT` / `STZB_DB_USER` / `STZB_DB_PASSWORD` / `STZB_DB_NAME` 覆盖。
 */
const DEFAULT_DB_CONFIG: HeroDBConfig = {
  host: process.env.STZB_DB_HOST ?? 'localhost',
  port: Number(process.env.STZB_DB_PORT ?? 3306),
  user: process.env.STZB_DB_USER ?? 'ybyt',
  password: process.env.STZB_DB_PASSWORD ?? '123456',
  database: process.env.STZB_DB_NAME ?? (worktreeName() ? `stzb战斗系统_${worktreeName()}` : 'stzb战斗系统'),
};

/** 武将 ID → HeroRecord（DB 原始字段，含成长值） */
export const HERO_RECORDS: Record<string, HeroRecord> = {};
/** 武将 ID → General（level-1 快照，主战法已挂入对应槽位） */
export const HERO_REGISTRY: Record<string, General> = {};

let initialized = false;

/**
 * 从 `web/data/heroes.json` 灌入内存表（与 `export_web_data.mjs` 导出字段一致）。
 * MySQL 不可达时由 `initHeroDB` 回退调用，保证 golden / 全量测试可离线跑。
 */
function loadHeroesFromJson(): void {
  const jsonPath = join(dirname(fileURLToPath(import.meta.url)), '../../web/data/heroes.json');
  const rows = JSON.parse(readFileSync(jsonPath, 'utf8')) as HeroRecord[];
  for (const rec of rows) {
    HERO_RECORDS[rec.id] = rec;
    HERO_REGISTRY[rec.id] = recordToGeneral(rec);
  }
}

/**
 * 将 heroes 表一行转为 HeroRecord 并写入内存 Map。
 * @param row MySQL 查询行
 */
function ingestHeroRow(row: HeroRow): void {
  const rec: HeroRecord = {
    id: row.id,
    name: row.name,
    rarity: row.rarity,
    cost: Number(row.cost),
    faction: row.faction,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    mutualExclusionGroup: row.mutual_exclusion_group,
    troopType: row.troop_type as HeroRecord['troopType'],
    attackRange: row.attack_range,
    baseAttack: row.base_attack,
    baseDefense: row.base_defense,
    baseStrategy: row.base_strategy,
    baseSpeed: row.base_speed,
    growthAttack: Number(row.growth_attack),
    growthDefense: Number(row.growth_defense),
    growthStrategy: Number(row.growth_strategy),
    growthSpeed: Number(row.growth_speed),
    mainSkillId: row.main_skill_id,
    mainSkillName: row.main_skill_name,
    skillDesc: row.skill_desc ?? '',
  };
  HERO_RECORDS[rec.id] = rec;
  HERO_REGISTRY[rec.id] = recordToGeneral(rec);
}

/**
 * 连接 MySQL 并加载全部武将数据，构建 HERO_RECORDS / HERO_REGISTRY。可重复调用（幂等）。
 * 连不上 / 库不存在 / 无权限（DSH 工作树未建独立库）时回退到 `web/data/heroes.json`，
 * 保证测试在无库环境下也能全量跑（json 为 export_web_data 的导出版，字段一致）。
 */
export async function initHeroDB(config: HeroDBConfig = DEFAULT_DB_CONFIG): Promise<void> {
  if (initialized) return;
  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection(config);
    const [rows] = await conn.query(
      `SELECT id, name, rarity, cost, faction, tags, mutual_exclusion_group, troop_type,
              attack_range, base_attack, base_defense, base_strategy, base_speed,
              growth_attack, growth_defense, growth_strategy, growth_speed,
              main_skill_id, main_skill_name, skill_desc
       FROM heroes`
    );
    for (const row of rows as HeroRow[]) ingestHeroRow(row);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // 不可达 / 库不存在 / 无权限（工作树独立库尚未初始化）一律回退，避免忘建库把全部测试炸掉
    const FALLBACK_ERRORS = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ER_BAD_DB_ERROR',
      'ER_DBACCESS_DENIED_ERROR',
      'ER_ACCESS_DENIED_ERROR',
    ];
    if (!FALLBACK_ERRORS.includes(code ?? '')) throw err;
    console.warn(
      `[heroes] 库 \`${config.database}\` 不可用（${code}），回退到 web/data/heroes.json` +
        `（DSH 工作树未建独立库时属正常；见 AGENTS.md「工作树与提交」）`
    );
    loadHeroesFromJson();
  } finally {
    if (conn) await conn.end();
  }
  initialized = true;
}

/** heroes 表行（snake_case，直接对应 DB 列名） */
interface HeroRow {
  id: string;
  name: string;
  rarity: '4星' | '5星';
  cost: string | number;
  faction: string;
  tags: string;
  mutual_exclusion_group: string | null;
  troop_type: string;
  attack_range: number;
  base_attack: number;
  base_defense: number;
  base_strategy: number;
  base_speed: number;
  growth_attack: string | number;
  growth_defense: string | number;
  growth_strategy: string | number;
  growth_speed: string | number;
  main_skill_id: string;
  main_skill_name: string;
  skill_desc: string | null;
}

/** 按 ID 获取武将（level-1 快照）。未初始化或不存在时抛错。 */
export function getGeneral(id: string): General {
  const g = HERO_REGISTRY[id];
  if (!g) throw new Error(`武将不存在：${id}`);
  return g;
}

/** 获取武将成长值（由 HeroRecord 提供） */
export function getHeroGrowth(id: string): HeroRecord | null {
  return HERO_RECORDS[id] ?? null;
}

/**
 * 武将升至 40 级面板：属性 = 初始 + (40-1)×成长（四舍五入）+ 自由加点，兵力默认 9000。
 * 成长值从 MySQL 的 HeroRecord 读取。
 */
export function level40(g: General, free: Parameters<typeof level40FromRecord>[2] = {}, troops = 9000): General {
  const rec = HERO_RECORDS[g.id];
  if (!rec) throw new Error(`level40：缺少 ${g.id} 的成长数据（是否已 initHeroDB()？）`);
  return level40FromRecord(g, rec, free, troops);
}
