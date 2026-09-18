/**
 * 数据库连接配置（DSH 工作树自动隔离）
 *
 * 库名解析优先级：
 *   1. 环境变量 `STZB_DB_NAME`（显式指定）
 *   2. 工作树自动推导：本文件位于 `<树根>/scripts/`，
 *      - DSH 工作树 `<...>/.dsh/worktrees/<hash>/<dirname>` → 库名 `stzb战斗系统_dsh_<hash>`
 *      - 旧布局 `.wt-stzb/<name>`（仅兜底，防止遗留工作区写坏主库）→ `stzb战斗系统_wt_<name>`
 *   3. 回落到主库 `stzb战斗系统`
 *
 * 宿主/端口/账号同样支持 `STZB_DB_HOST` / `STZB_DB_PORT` / `STZB_DB_USER` / `STZB_DB_PASSWORD`，
 * 未设置时保持原硬编码默认值（向后兼容）。
 *
 * ⚠️ 本逻辑与 `src/data/heroes.ts` 里的 `DEFAULT_DB_CONFIG` 必须保持一致
 *    （TS 侧因 tsconfig `include` 不含 scripts/ 无法 import 本文件，故各写一份）。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 树根目录（本文件在 <树根>/scripts/ 下） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 工作树标识（DSH 取 hash；旧 `.wt-stzb/<name>` 取 name），非工作树返回 null */
export function worktreeName() {
  const dsh = /[\\/]\.dsh[\\/]worktrees[\\/]([^\\/]+)[\\/][^\\/]+$/.exec(ROOT);
  if (dsh) return `dsh_${dsh[1]}`;
  const legacy = /[\\/]\.wt-stzb[\\/]([^\\/]+)$/.exec(ROOT);
  return legacy ? `wt_${legacy[1]}` : null;
}

/** 解析目标库名 */
export function databaseName() {
  if (process.env.STZB_DB_NAME) return process.env.STZB_DB_NAME;
  const wt = worktreeName();
  return wt ? `stzb战斗系统_${wt}` : 'stzb战斗系统';
}

/** 连接配置（含库名） */
export const DB_CONFIG = {
  host: process.env.STZB_DB_HOST ?? 'localhost',
  port: Number(process.env.STZB_DB_PORT ?? 3306),
  user: process.env.STZB_DB_USER ?? 'ybyt',
  password: process.env.STZB_DB_PASSWORD ?? '123456',
  database: databaseName(),
};

/** 不含库名的连接配置（用于 CREATE DATABASE 等库级操作） */
export const DB_SERVER = {
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  user: DB_CONFIG.user,
  password: DB_CONFIG.password,
};
