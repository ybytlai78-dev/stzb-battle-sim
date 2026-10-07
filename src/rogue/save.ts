import type { Wallet } from './economy';
import type { EnemySlot, PendingPull, PoolState, RunState } from './types';

/** 调用方实现的存储。玩法层不碰具体介质。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveData {
  run: RunState;
  pool: PoolState;
  wallet: Wallet;
  gacha: PendingPull | null;
  enemy: EnemySlot[] | null;
  enemyLevel: number | null;
  /** 已经用掉的随机序号。刷新后下一次抽卡不会重复上一抽。 */
  nonce: number;
}

export const SAVE_KEY = 'rogue.run.v1';

const POSITIONS = new Set(['前锋', '中军', '大营']);

/**
 * 内存存储，测试和无浏览器环境用。
 */
export function memoryStorage(): StorageLike {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => void bag.set(key, value),
    removeItem: (key) => void bag.delete(key),
  };
}

/**
 * 写入一局。调用方负责只在状态完整时调用。
 * @param storage 存储
 * @param data 整局存档
 */
export function saveRun(storage: StorageLike, data: SaveData): void {
  storage.setItem(SAVE_KEY, JSON.stringify(data));
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function validRun(value: unknown): value is RunState {
  if (!isObj(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isFiniteNumber(value.seed) &&
    isFiniteNumber(value.level) &&
    isFiniteNumber(value.levelCount) &&
    isFiniteNumber(value.lives) &&
    (value.status === 'playing' || value.status === 'cleared' || value.status === 'dead')
  );
}

function validPool(value: unknown): value is PoolState {
  if (!isObj(value)) return false;
  if (!Array.isArray(value.heroes) || !Array.isArray(value.skills) || !Array.isArray(value.treasures)) return false;
  if (!value.skills.every((id) => typeof id === 'string')) return false;
  if (!value.treasures.every((id) => typeof id === 'string')) return false;
  return value.heroes.every(
    (hero) =>
      isObj(hero) &&
      typeof hero.heroId === 'string' &&
      isFiniteNumber(hero.copies) &&
      isFiniteNumber(hero.redness) &&
      isFiniteNumber(hero.level) &&
      isFiniteNumber(hero.maxTroops) &&
      isFiniteNumber(hero.troops),
  );
}

function validPull(value: unknown): value is PendingPull {
  if (!isObj(value) || !Array.isArray(value.shown) || value.shown.length !== 5) return false;
  if (!value.shown.every((id) => typeof id === 'string')) return false;
  if (!(value.picked === null || typeof value.picked === 'string')) return false;
  return typeof value.bonus === 'string';
}

function validEnemy(value: unknown): value is EnemySlot[] {
  if (!Array.isArray(value) || value.length !== 3) return false;
  return value.every(
    (slot) =>
      isObj(slot) &&
      typeof slot.heroId === 'string' &&
      typeof slot.position === 'string' &&
      POSITIONS.has(slot.position) &&
      isFiniteNumber(slot.redness) &&
      isFiniteNumber(slot.level) &&
      Array.isArray(slot.skillIds) &&
      slot.skillIds.every((id) => typeof id === 'string'),
  );
}

/**
 * 读档。坏 JSON、缺字段、不认识的版本一律返回 null，不抛。
 * @param storage 存储
 */
export function loadRun(storage: StorageLike): SaveData | null {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(parsed)) return null;
  if (!validRun(parsed.run) || !validPool(parsed.pool)) return null;
  if (!isObj(parsed.wallet) || !isFiniteNumber(parsed.wallet.jade)) return null;
  if (!(parsed.gacha === null || validPull(parsed.gacha))) return null;
  if (!(parsed.enemy === null || validEnemy(parsed.enemy))) return null;
  if (!(parsed.enemyLevel === null || isFiniteNumber(parsed.enemyLevel))) return null;
  if (!isFiniteNumber(parsed.nonce)) return null;
  return {
    run: parsed.run,
    pool: parsed.pool,
    wallet: { jade: parsed.wallet.jade },
    gacha: parsed.gacha,
    enemy: parsed.enemy,
    enemyLevel: parsed.enemyLevel,
    nonce: parsed.nonce,
  };
}
