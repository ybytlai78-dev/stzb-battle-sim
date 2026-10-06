/**
 * 对手池 = 制作人固定测试集 ∪ 用户从阵容预设（或实战胜率页）加进去的队伍。
 * ---------------------------------------------------------------------------
 * 固定集随站发布（`web/data/opponent_benchmark.json`），用户和模型都删不掉。
 * 用户添加落在另一把 localStorage 键里，和固定集合并后给顾问与 L4 实战胜率页共用。
 */
import type { TroopType } from '../src/engine/types';
import { HERO_RECORDS } from './heroes';
import { readPresetFile, type PresetStorage, type TeamPreset } from './presetStore';
import type { SlotState } from './teamEditor';
import type { SlotCfg, ViewCfg } from './teamConfig';
import benchmarkJson from './data/opponent_benchmark.json';

/** 用户添加的对手（不含固定集） */
export const EXTRA_POOL_KEY = 'dsh-advisor-opponents-extra-v1';
/** 旧版 L4 对手池。第一次读取时迁进用户添加，之后以新键为准。 */
export const LEGACY_POOL_KEY = 'dsh-battle-sim-opponents-v1';

export type PoolSource = 'benchmark' | 'user';

/** 对手池里的一队 */
export interface PoolEntry {
  id: string;
  /** 展示名 */
  note: string;
  cfg: ViewCfg;
  source: PoolSource;
  /** 从哪条预设加进来的（手存 / 导入则没有） */
  presetId?: string;
}

/** 合并后的池子（固定集版本号写进证据，便于复现） */
export interface MergedPool {
  version: string;
  entries: PoolEntry[];
}

interface BenchmarkFile {
  version: string;
  entries: Array<{ id: string; note: string; cfg: ViewCfg }>;
}

const BENCHMARK = benchmarkJson as BenchmarkFile;

/** 只读写两把方法，方便单测注入内存存储 */
export interface PoolStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ENV: Pick<ViewCfg, 'morale' | 'enemy' | 'rounds' | 'manual'> = {
  morale: 120,
  enemy: { defense: 150, strategy: 100, troopType: 'infantry' },
  rounds: 8,
  manual: { boostCaused: 0, boostTaken: 0, reduce: 0 },
};

/** 深拷贝（固定集不能被页面上的编辑改掉内存里的原件） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 浏览器存储；不可用时返回 null（只剩固定集，不抛） */
export function defaultPoolStorage(): PoolStorage | null {
  try {
    const s = (globalThis as { localStorage?: PoolStorage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** 固定测试集（每次返回新拷贝） */
export function loadBenchmark(): PoolEntry[] {
  return (BENCHMARK.entries ?? [])
    .map((e) => ({
      id: String(e.id),
      note: String(e.note || e.id),
      cfg: clone(e.cfg),
      source: 'benchmark' as const,
    }))
    .filter((e) => e.id && Array.isArray(e.cfg?.slots) && e.cfg.slots.length >= 3);
}

/** 固定集版本号（证据与缓存键用） */
export function benchmarkVersion(): string {
  return String(BENCHMARK.version ?? '0');
}

/** 这个 id 是不是固定集 */
export function isBenchmarkId(id: string): boolean {
  return loadBenchmark().some((e) => e.id === id);
}

function readRawExtras(storage: PoolStorage | null): PoolEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(EXTRA_POOL_KEY);
    if (raw === null) return migrateLegacy(storage);
    const parsed = JSON.parse(raw) as PoolEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.id === 'string' && e.cfg && Array.isArray(e.cfg.slots))
      .map((e) => ({ ...clone(e), source: 'user' as const }));
  } catch {
    return [];
  }
}

/** 旧 L4 池子迁到用户添加。备注与固定集相同的不重复迁。 */
function migrateLegacy(storage: PoolStorage): PoolEntry[] {
  let legacy: Array<{ id?: string; note?: string; cfg?: ViewCfg }> = [];
  try {
    const raw = storage.getItem(LEGACY_POOL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<{ id?: string; note?: string; cfg?: ViewCfg }>;
      if (Array.isArray(parsed)) legacy = parsed;
    }
  } catch {
    legacy = [];
  }
  const benchNotes = new Set(loadBenchmark().map((e) => e.note));
  const extras: PoolEntry[] = [];
  legacy.forEach((e, i) => {
    if (!e?.cfg || !Array.isArray(e.cfg.slots) || e.cfg.slots.length < 3) return;
    const note = String(e.note || `对手 ${i + 1}`);
    if (benchNotes.has(note)) return;
    extras.push({
      id: e.id && !isBenchmarkId(e.id) ? e.id : `user-legacy-${i}`,
      note,
      cfg: clone(e.cfg),
      source: 'user',
    });
  });
  writeExtras(extras, storage);
  return extras;
}

function writeExtras(entries: PoolEntry[], storage: PoolStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(EXTRA_POOL_KEY, JSON.stringify(entries.map((e) => ({ ...e, source: 'user' }))));
  } catch {
    /* 配额满 / 隐私模式：这一次不持久化 */
  }
}

/** 用户添加的队伍（不含固定集） */
export function loadExtras(storage: PoolStorage | null = defaultPoolStorage()): PoolEntry[] {
  return readRawExtras(storage);
}

/** 覆盖写入用户添加。固定集条目会被丢掉，避免写进用户键。 */
export function saveExtras(entries: PoolEntry[], storage: PoolStorage | null = defaultPoolStorage()): void {
  writeExtras(entries.filter((e) => e.source !== 'benchmark' && !isBenchmarkId(e.id)), storage);
}

/**
 * 合并：固定集在前，用户添加在后。
 * 用户条目若 id 撞上固定集，丢掉（固定集优先）。
 */
export function mergePool(benchmark: PoolEntry[], extras: PoolEntry[]): MergedPool {
  const benchIds = new Set(benchmark.map((e) => e.id));
  const users = extras.filter((e) => e.source !== 'benchmark' && !benchIds.has(e.id));
  return { version: benchmarkVersion(), entries: [...benchmark.map(clone), ...users.map(clone)] };
}

/** 读合并后的对手池 */
export function loadMergedPool(storage: PoolStorage | null = defaultPoolStorage()): MergedPool {
  return mergePool(loadBenchmark(), loadExtras(storage));
}

/** 证据用的池子指纹：固定集版本 + 用户条目 id */
export function poolFingerprint(pool: MergedPool = loadMergedPool()): string {
  const extras = pool.entries.filter((e) => e.source === 'user').map((e) => e.id);
  return `${pool.version}|${extras.join(',')}`;
}

/** 阵容预设 → 可进引擎的 ViewCfg。空槽 / 不足 3 将返回 null。 */
export function presetToViewCfg(preset: TeamPreset): ViewCfg | null {
  const slots = preset.slots.slice(0, 3);
  if (slots.length < 3 || slots.some((s) => !s.heroId)) return null;
  return {
    slots: slots.map((s) => slotFromPreset(s)),
    ...clone(ENV),
  };
}

function slotFromPreset(s: SlotState): SlotCfg {
  const rec = s.heroId ? HERO_RECORDS[s.heroId] : undefined;
  const troop = (rec?.troopType ?? 'infantry') as TroopType;
  return {
    heroId: s.heroId ?? '',
    level: s.level,
    addAttack: s.freePoints?.attack ?? 0,
    addStrategy: s.freePoints?.strategy ?? 0,
    troopType: troop === 'cavalry' || troop === 'archer' || troop === 'infantry' ? troop : 'infantry',
    skillIds: [...(s.extraSkillIds ?? [])],
    ...(s.secondaryTraits?.length ? { traits: [...s.secondaryTraits] } : {}),
    treasure: s.treasure ?? null,
  };
}

export interface PoolWriteResult {
  ok: boolean;
  message: string;
  entry?: PoolEntry;
}

/**
 * 把一条预设加入用户对手池。同预设 id 再加一次 = 用预设的当前配置覆盖那条。
 * 不满 3 将的预设拒绝。
 */
export function addPresetToPool(preset: TeamPreset, storage: PoolStorage | null = defaultPoolStorage()): PoolWriteResult {
  const cfg = presetToViewCfg(preset);
  if (!cfg) return { ok: false, message: `预设「${preset.name}」不满 3 名武将，不能加入对手池` };
  const extras = loadExtras(storage);
  const exist = extras.find((e) => e.presetId === preset.id);
  const entry: PoolEntry = {
    id: exist?.id ?? `user-preset-${preset.id}`,
    note: preset.name || `预设 #${preset.no}`,
    cfg,
    source: 'user',
    presetId: preset.id,
  };
  const next = exist ? extras.map((e) => (e.presetId === preset.id ? entry : e)) : [...extras, entry];
  saveExtras(next, storage);
  return { ok: true, message: exist ? `已用预设「${entry.note}」更新对手池里的同名条目` : `已把预设「${entry.note}」加入对手池`, entry };
}

/** 按预设 id 查找并加入（预设不存在则失败） */
export function addPresetIdToPool(presetId: string, storage: PoolStorage | null = defaultPoolStorage()): PoolWriteResult {
  const file = readPresetFile(storage as PresetStorage | null);
  const preset = file.list.find((p) => p.id === presetId);
  if (!preset) return { ok: false, message: `找不到预设 ${presetId}` };
  return addPresetToPool(preset, storage);
}

/** 手存 / 导入一条用户队伍（id 已存在则覆盖配置与备注） */
export function upsertUserEntry(entry: PoolEntry, storage: PoolStorage | null = defaultPoolStorage()): PoolWriteResult {
  if (entry.source === 'benchmark' || isBenchmarkId(entry.id)) {
    return { ok: false, message: '固定测试集不能修改' };
  }
  const extras = loadExtras(storage);
  const nextEntry: PoolEntry = { ...clone(entry), source: 'user' };
  const i = extras.findIndex((e) => e.id === nextEntry.id);
  const next = i >= 0 ? extras.map((e, idx) => (idx === i ? nextEntry : e)) : [...extras, nextEntry];
  saveExtras(next, storage);
  return { ok: true, message: `已保存「${nextEntry.note}」`, entry: nextEntry };
}

/** 移出用户自己加的条目。固定集 id 一律拒绝，池子内容不变。 */
export function removeUserOpponent(id: string, storage: PoolStorage | null = defaultPoolStorage()): PoolWriteResult {
  if (isBenchmarkId(id)) return { ok: false, message: '固定测试集不能删除' };
  const extras = loadExtras(storage);
  if (!extras.some((e) => e.id === id)) return { ok: false, message: `对手池里没有可删除的条目 ${id}` };
  saveExtras(extras.filter((e) => e.id !== id), storage);
  return { ok: true, message: '已从对手池移出' };
}
