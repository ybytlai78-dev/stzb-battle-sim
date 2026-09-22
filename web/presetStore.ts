/**
 * 阵容预设存档（单队）：把「红队或蓝队一边」的 3 个槽位（武将 + 战法 + 二级兵种/兵系特性 + 宝物
 * + 属性加点 + 红度 + 等级）整体存成一条带编号的预设，localStorage 持久化，退出浏览器也还在。
 *
 * 设计要点（用户 2026-09-21 口径）：
 * - 一条预设 = 一边队伍（3 槽，含空槽原样），上场时可落红/蓝任意一边（内容与边无关，边只记「保存时的边」作默认）；
 * - 编号 `no` 全局单调递增（存在文件头 `maxNo`）→ 删除预设后编号**不回填**，编号稳定可引用；
 * - 同边同名 = 覆盖（编号不变，只更新槽位与时间）；不同边同名 = 两条独立预设；
 * - 上限 `PRESET_MAX` 条（超出提示先删）；
 * - 搜索按预设名子串匹配（忽略大小写与空白），可额外匹配武将名与 `#编号`；
 * - 纯逻辑、无 DOM：存储用 `PresetStorage` 注入，便于单测用内存实现。
 */
import type { SlotState } from './teamEditor';

export type TeamSide = 'red' | 'blue';

/** 一条队伍预设 */
export interface TeamPreset {
  /** 稳定 id（删除/重命名按它定位） */
  id: string;
  /** 展示编号：全局递增，删除后不重号 */
  no: number;
  /** 预设名（用户取名，如「双减魏智」「战磐魏智」） */
  name: string;
  /** 保存时的边（= 上场默认落点，卡片上可改落另一边） */
  side: TeamSide;
  /** 三槽配置（大营/中军/前锋），与 `EditorState[side]` 同构 */
  slots: SlotState[];
  createdAt: number;
  updatedAt: number;
}

/** 存档文件（含编号水位，保证编号单调） */
export interface PresetFile {
  maxNo: number;
  list: TeamPreset[];
}

/** 只用 getItem/setItem，避免依赖完整 Storage（单测注入内存实现） */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PRESET_STORAGE_KEY = 'stzb_team_presets';
/** 预设条数上限（用户口径 50 条） */
export const PRESET_MAX = 50;
/** 预设名长度上限（UI 截断显示，存储侧防超长） */
export const PRESET_NAME_MAX = 20;

export const EMPTY_PRESET_FILE: PresetFile = { maxNo: 0, list: [] };

export const SIDE_LABEL: Record<TeamSide, string> = { red: '红队', blue: '蓝队' };

/** 取默认存储（localStorage 不可用时返回 null → 静默降级为「不持久化」） */
export function defaultStorage(): PresetStorage | null {
  try {
    const s = (globalThis as { localStorage?: PresetStorage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** 深拷贝槽位数组（避免存档与配将区共享引用：改配将区不该动到已存预设） */
export function cloneSlots(slots: SlotState[]): SlotState[] {
  const sc = (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone;
  return typeof sc === 'function' ? sc(slots) : (JSON.parse(JSON.stringify(slots)) as SlotState[]);
}

// ─── 读取 / 校验 ───

const isSide = (v: unknown): v is TeamSide => v === 'red' || v === 'blue';

/** 预设名规范化：去首尾空白、压缩中间空白、截断超长 */
export function normalizeName(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX);
}

/** 搜索词规范化：去空白 + 小写（中英混排均可子串命中） */
const fold = (raw: string): string => String(raw ?? '').toLowerCase().replace(/\s+/g, '');

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * 校正单个槽位（防手改 localStorage / 老版本数据）：
 * heroId 非法 → 视为空槽；战法最多 2 个；加点非负；红度 0~5；等级 40~50。
 * 空槽（heroId: null）合法 —— 允许只配置 2 人的队伍存预设。
 */
function normalizeSlot(raw: unknown): SlotState {
  const o = (raw ?? {}) as Partial<SlotState>;
  const fp = (o.freePoints ?? {}) as Partial<SlotState['freePoints']>;
  const heroId = typeof o.heroId === 'string' && o.heroId ? o.heroId : null;
  const secondaryTroop = typeof o.secondaryTroop === 'string' && o.secondaryTroop ? (o.secondaryTroop as SlotState['secondaryTroop']) : undefined;
  const traits = Array.isArray(o.secondaryTraits) ? (o.secondaryTraits.filter((t) => typeof t === 'string') as SlotState['secondaryTraits']) : undefined;
  return {
    heroId,
    extraSkillIds: Array.isArray(o.extraSkillIds) ? o.extraSkillIds.filter((s) => typeof s === 'string').slice(0, 2) : [],
    freePoints: {
      attack: num(fp.attack, 0, 0, 999),
      defense: num(fp.defense, 0, 0, 999),
      strategy: num(fp.strategy, 0, 0, 999),
      speed: num(fp.speed, 0, 0, 999),
    },
    redness: num(o.redness, 0, 0, 5),
    level: num(o.level, 40, 40, 50),
    ...(secondaryTroop ? { secondaryTroop } : {}),
    ...(traits && traits.length ? { secondaryTraits: traits } : {}),
    treasure: o.treasure && typeof o.treasure === 'object' ? (o.treasure as SlotState['treasure']) : null,
  };
}

/** 校正一条预设（字段非法 → 返回 null 丢弃该条） */
function normalizePreset(raw: unknown): TeamPreset | null {
  const o = (raw ?? {}) as Partial<TeamPreset>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const name = normalizeName(String(o.name ?? ''));
  if (!name) return null;
  const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
  const slots: SlotState[] = [];
  for (let i = 0; i < 3; i++) slots.push(normalizeSlot(slotsRaw[i]));
  const no = num(o.no, 0, 0, Number.MAX_SAFE_INTEGER);
  if (no <= 0) return null;
  const created = num(o.createdAt, 0, 0, Number.MAX_SAFE_INTEGER);
  return {
    id: o.id,
    no,
    name,
    side: isSide(o.side) ? o.side : 'red',
    slots,
    createdAt: created,
    updatedAt: num(o.updatedAt, created, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** 按编号升序（存档内顺序即展示顺序；读取时兜底排序） */
export function sortPresets(list: TeamPreset[]): TeamPreset[] {
  return [...list].sort((a, b) => a.no - b.no);
}

/**
 * 读存档：解析失败/结构损坏/存储不可用 → 空存档（静默降级，绝不抛）。
 * 逐条校验，丢弃坏条目；编号水位取 `maxNo` 与现存最大编号的较大者。
 */
export function readPresetFile(storage: PresetStorage | null = defaultStorage()): PresetFile {
  try {
    const raw = storage?.getItem(PRESET_STORAGE_KEY);
    if (!raw) return { ...EMPTY_PRESET_FILE, list: [] };
    const parsed = JSON.parse(raw) as Partial<PresetFile>;
    const list: TeamPreset[] = [];
    for (const item of Array.isArray(parsed?.list) ? parsed.list : []) {
      const p = normalizePreset(item);
      if (p) list.push(p);
    }
    const sorted = sortPresets(list).slice(0, PRESET_MAX);
    const maxNo = Math.max(num(parsed?.maxNo, 0, 0, Number.MAX_SAFE_INTEGER), ...sorted.map((p) => p.no), 0);
    return { maxNo, list: sorted };
  } catch {
    return { ...EMPTY_PRESET_FILE, list: [] };
  }
}

/** 写存档：存储不可用/超配额 → 返回 false（调用方决定是否提示） */
export function writePresetFile(file: PresetFile, storage: PresetStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const list = sortPresets(file.list).slice(0, PRESET_MAX);
    const payload: PresetFile = { maxNo: Math.max(file.maxNo, ...list.map((p) => p.no), 0), list };
    storage.setItem(PRESET_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// ─── 查询 ───

export function findPreset(file: PresetFile, id: string): TeamPreset | undefined {
  return file.list.find((p) => p.id === id);
}

/** 同边同名查找（覆盖判断用）；`excludeId` 用于重命名时排除自己 */
export function findSameName(file: PresetFile, name: string, side: TeamSide, excludeId?: string): TeamPreset | undefined {
  const key = fold(name);
  return file.list.find((p) => p.side === side && p.id !== excludeId && fold(p.name) === key);
}

/**
 * 预设名校验：返回错误文案（null = 合法）。
 * 空名 / 超长截断后为空 / 已存在（校验不通过时由调用方提示）。
 */
export function nameError(raw: string, file: PresetFile, side: TeamSide, excludeId?: string): string | null {
  const name = normalizeName(raw);
  if (!name) return '预设名不能为空';
  if (findSameName(file, name, side, excludeId)) {
    return `${SIDE_LABEL[side]}已有同名预设「${name}」，换个名字或直接覆盖`;
  }
  return null;
}

/**
 * 搜索预设：预设名子串命中（忽略大小写/空白）；额外支持
 * - `#3` / `3` 命中编号；
 * - 传入 `heroNameOf` 时按队内武将名命中（搜「吕布」找含吕布的预设）。
 * 空查询返回全部（按编号升序）。
 */
export function searchPresets(list: TeamPreset[], query: string, heroNameOf?: (heroId: string) => string): TeamPreset[] {
  const q = fold(query);
  const sorted = sortPresets(list);
  if (!q) return sorted;
  const noMatch = /^#?(\d+)$/.exec(q);
  return sorted.filter((p) => {
    if (noMatch && String(p.no) === noMatch[1]) return true;
    if (fold(p.name).includes(q)) return true;
    if (heroNameOf) {
      for (const s of p.slots) {
        if (s.heroId && fold(heroNameOf(s.heroId)).includes(q)) return true;
      }
    }
    return false;
  });
}

/** 队内非空武将数（保存/覆盖的前置条件） */
export function heroCount(slots: SlotState[]): number {
  return slots.filter((s) => s.heroId).length;
}

// ─── 变更（纯函数：返回新文件，不改入参） ───

let idSeq = 0;
/** 预设 id：时间戳 + 自增序号（同毫秒内连存也不会撞） */
function newId(now: number): string {
  idSeq += 1;
  return `p_${now.toString(36)}_${idSeq.toString(36)}`;
}

/** 该边当前配置是否至少有 1 名武将 */
export interface SaveResult {
  file: PresetFile;
  preset: TeamPreset;
  /** true = 同边同名，已覆盖旧预设（编号不变） */
  replaced: boolean;
}

/**
 * 保存预设（同边同名 → 覆盖）。调用方需先校验命名与上限；
 * 已满且是新增时不做任何变更（返回 `null`）。
 */
export function addPreset(
  file: PresetFile,
  input: { name: string; side: TeamSide; slots: SlotState[]; now?: number }
): SaveResult | null {
  const now = input.now ?? Date.now();
  const name = normalizeName(input.name);
  if (!name) return null;
  const slots = cloneSlots(input.slots).slice(0, 3);
  const existing = findSameName(file, name, input.side);
  if (existing) {
    const updated: TeamPreset = { ...existing, name, slots, updatedAt: now };
    return {
      file: { maxNo: file.maxNo, list: file.list.map((p) => (p.id === existing.id ? updated : p)) },
      preset: updated,
      replaced: true,
    };
  }
  if (file.list.length >= PRESET_MAX) return null;
  const preset: TeamPreset = {
    id: newId(now),
    no: file.maxNo + 1,
    name,
    side: input.side,
    slots,
    createdAt: now,
    updatedAt: now,
  };
  return { file: { maxNo: preset.no, list: [...file.list, preset] }, preset, replaced: false };
}

/** 删除预设（编号水位保留 → 后续新增不重号） */
export function removePreset(file: PresetFile, id: string): PresetFile {
  return { maxNo: file.maxNo, list: file.list.filter((p) => p.id !== id) };
}

/** 重命名（同名冲突由 `nameError` 先拦） */
export function renamePreset(file: PresetFile, id: string, name: string, now = Date.now()): PresetFile {
  const clean = normalizeName(name);
  if (!clean) return file;
  return {
    maxNo: file.maxNo,
    list: file.list.map((p) => (p.id === id ? { ...p, name: clean, updatedAt: now } : p)),
  };
}

/**
 * 用当前配将区的该边配置覆盖预设（编号/名字/创建时间不变）。
 *
 * 注意（用户 2026-09-22 口径）：面板上的「覆盖为当前配置」按钮已撤掉 ——「上场到红队」本身就是覆盖红队，
 * 那个按钮改成了「木桩队伍」占位。同边同名保存仍会走 `addPreset` 的覆盖分支，所以数据层保留这个能力。
 */
export function overwritePreset(file: PresetFile, id: string, slots: SlotState[], now = Date.now()): PresetFile {
  const slotsCopy = cloneSlots(slots).slice(0, 3);
  return {
    maxNo: file.maxNo,
    list: file.list.map((p) => (p.id === id ? { ...p, slots: slotsCopy, updatedAt: now } : p)),
  };
}
