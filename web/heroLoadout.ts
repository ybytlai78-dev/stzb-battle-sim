/**
 * 武将配置档案 —— 解决「武将回池再上阵，战法/加点/宝物全被重置」的痛点（用户 2026-11-05）。
 * ---------------------------------------------------------------------------
 * 两层：
 *  - `last`（自动记忆）：任何武将入队后，槽位配置变化即写档；从武将池拖回阵容时按档恢复。
 *    **只记一份/每将**，红蓝两队同时上阵同一武将时以「最后编辑的那份」为准。
 *  - `plans`（用户方案）：在武将详情页手动保存的多套配置（战法 / 加点 / 红度 / 宝物 / 兵种 / 陈寿），
 *    一键切换 —— 例：文鸯「方案一 击势+枭雄·全攻·元戎·满红」「方案二 势无虚动+枭雄·全攻·元戎·白板」。
 *
 * 口径：
 *  - 只存**配置**不存武将：应用时以当前槽位的 heroId 为准，越界值一律按现规则裁剪（见 `normalizeLoadout`）。
 *  - 存 localStorage 一把键；坏档/私隐模式读不到时退化为「没有档案」（不抛错、不静默丢用户已有数据 —— 写失败返回 false）。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID } from '../src/data/treasures';
import { CHENSHOU_BY_ID, type ChenshouLoadout } from '../src/data/chenshouFeatures';
import { HERO_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { TRAIT_SLOTS_MAX, traitsFor, type GeneralTrait, type SecondaryTroopType } from '../src/engine/secondaryTroop';
import type { TreasureLoadout } from '../src/engine/types';
import { freePointBudget } from './heroes';
import type { SlotState } from './teamEditor';

export const HERO_CONFIG_KEY = 'stzb_hero_config_v1';
/** 每名武将最多保存几套方案（用户口径「1 2 3…」，6 套够日常轮换，也压得住面板高度） */
export const PLAN_MAX = 6;
/** 方案显示名（按保存顺序即编号；删中间项后后面的前移） */
export const PLAN_NAMES = ['方案一', '方案二', '方案三', '方案四', '方案五', '方案六'] as const;

export type FreePoints = SlotState['freePoints'];

/** 一份可套用的武将配置（不含 heroId） */
export interface Loadout {
  extraSkillIds: string[];
  freePoints: FreePoints;
  redness: number;
  level: number;
  secondaryTroop?: SecondaryTroopType;
  secondaryTraits?: GeneralTrait[];
  treasure: TreasureLoadout | null;
  chenshou?: ChenshouLoadout;
}

export interface HeroPlan {
  id: string;
  loadout: Loadout;
  savedAt: number;
}

interface ConfigFile {
  last: Record<string, Loadout>;
  plans: Record<string, HeroPlan[]>;
}

const EMPTY: ConfigFile = { last: {}, plans: {} };
const zeroPoints = (): FreePoints => ({ attack: 0, defense: 0, strategy: 0, speed: 0 });
const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** 槽位 → 配置（只抽配置字段，不含 heroId） */
export function loadoutOf(slot: SlotState): Loadout {
  return {
    extraSkillIds: [...slot.extraSkillIds],
    freePoints: { ...slot.freePoints },
    redness: slot.redness,
    level: slot.level,
    secondaryTroop: slot.secondaryTroop,
    secondaryTraits: slot.secondaryTraits ? [...slot.secondaryTraits] : undefined,
    treasure: slot.treasure ? { ...slot.treasure, ...(slot.treasure.affix ? { affix: { ...slot.treasure.affix } } : {}) } : null,
    chenshou: slot.chenshou ? { ...slot.chenshou, ...(slot.chenshou.alloc ? { alloc: { ...slot.chenshou.alloc } } : {}) } : undefined,
  };
}

/**
 * 按**当前规则**裁剪一份配置：等级 40~50、红度 0~5、装配战法最多 2 且须存在、
 * 加点不超预算（超了先砍速度、再谋略、防御，最后才动攻击）、兵种须在该武将的可转列表、
 * 特性须属于该兵种且最多 2 个、宝物/陈寿须在库里。
 * 存档可能来自旧版本或被手改，应用前一律过这道。
 */
export function normalizeLoadout(heroId: string, raw: Partial<Loadout> | null | undefined): Loadout {
  const src = raw ?? {};
  const level = clampInt(src.level, 40, 50, 40);
  const redness = clampInt(src.redness, 0, 5, 0);

  const extraSkillIds = [...new Set(Array.isArray(src.extraSkillIds) ? src.extraSkillIds : [])]
    .filter((id): id is string => typeof id === 'string' && !!SKILL_REGISTRY[id])
    .slice(0, 2);

  const freePoints = zeroPoints();
  const given = (src.freePoints ?? {}) as Partial<FreePoints>;
  for (const k of ['attack', 'defense', 'strategy', 'speed'] as const) {
    const v = Math.floor(Number(given[k]));
    freePoints[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  let used = freePoints.attack + freePoints.defense + freePoints.strategy + freePoints.speed;
  const budget0 = freePointBudget(heroId, redness, level);
  // 超预算时从**末项往前**砍：速度 → 谋略 → 防御 → 攻击（攻击优先保留，与加点面板的直觉一致）
  for (const k of ['speed', 'strategy', 'defense', 'attack'] as const) {
    if (used <= budget0) break;
    const cut = Math.min(freePoints[k], used - budget0);
    freePoints[k] -= cut;
    used -= cut;
  }

  const allowed = HERO_SECONDARY_TROOPS[heroId] ?? [];
  const secondaryTroop = src.secondaryTroop && allowed.includes(src.secondaryTroop) ? src.secondaryTroop : undefined;
  const secondaryTraits = secondaryTroop
    ? [...new Set(Array.isArray(src.secondaryTraits) ? src.secondaryTraits : [])]
        .filter((t) => traitsFor(secondaryTroop).includes(t))
        .slice(0, TRAIT_SLOTS_MAX)
    : undefined;

  const t = src.treasure;
  const treasure: TreasureLoadout | null =
    t && typeof t.treasureId === 'number' && TREASURES_BY_ID[t.treasureId]
      ? {
          treasureId: t.treasureId,
          level: clampInt(t.level, 1, 10, 10),
          ...(t.affix && typeof t.affix.name === 'string' && Number.isFinite(Number(t.affix.value))
            ? { affix: { name: t.affix.name, value: Number(t.affix.value) } }
            : {}),
        }
      : null;

  const cs = src.chenshou;
  const chenshou: ChenshouLoadout | undefined =
    cs && typeof cs.featureId === 'string' && CHENSHOU_BY_ID[cs.featureId]
      ? {
          featureId: cs.featureId,
          value: Number.isFinite(Number(cs.value)) ? Number(cs.value) : CHENSHOU_BY_ID[cs.featureId].defaultValue ?? 0,
          ...(cs.faction ? { faction: cs.faction } : {}),
          ...(cs.alloc ? { alloc: { ...cs.alloc } } : {}),
        }
      : undefined;

  return { extraSkillIds, freePoints, redness, level, secondaryTroop, secondaryTraits, treasure, chenshou };
}

/** 配置 → 一个新槽位（heroId 由调用方给，其余取配置） */
export function applyLoadoutToSlot(heroId: string, raw: Loadout | null | undefined): SlotState {
  const n = normalizeLoadout(heroId, raw);
  return {
    heroId,
    extraSkillIds: [...n.extraSkillIds],
    freePoints: { ...n.freePoints },
    redness: n.redness,
    level: n.level,
    secondaryTroop: n.secondaryTroop,
    secondaryTraits: n.secondaryTraits ? [...n.secondaryTraits] : undefined,
    treasure: n.treasure ? { ...n.treasure } : null,
    chenshou: n.chenshou ? { ...n.chenshou } : undefined,
  };
}

// ── 存储（惰性缓存 + 每次写盘） ──

let cache: ConfigFile | null = null;

function readFile(): ConfigFile {
  if (cache) return cache;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(HERO_CONFIG_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ConfigFile>) : null;
    cache = {
      last: parsed && typeof parsed.last === 'object' && parsed.last ? parsed.last : {},
      plans: parsed && typeof parsed.plans === 'object' && parsed.plans ? parsed.plans : {},
    };
  } catch {
    cache = { ...EMPTY, last: {}, plans: {} };
  }
  return cache;
}

function writeFile(next: ConfigFile): boolean {
  cache = next;
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(HERO_CONFIG_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** 测试用：丢掉内存缓存，下次从 localStorage 重读 */
export function resetHeroConfig(): void {
  cache = null;
}

/** 该武将上次进队伍的配置（没有 = null） */
export function rememberedLoadout(heroId: string): Loadout | null {
  const raw = readFile().last[heroId];
  return raw ? normalizeLoadout(heroId, raw) : null;
}

/** 记住一个已入队槽位的配置（内容没变就不写盘；返回是否真的写了） */
export function rememberSlot(slot: SlotState): boolean {
  if (!slot.heroId) return false;
  const next = normalizeLoadout(slot.heroId, loadoutOf(slot));
  const file = readFile();
  const old = file.last[slot.heroId];
  if (old && JSON.stringify(old) === JSON.stringify(next)) return false;
  return writeFile({ ...file, last: { ...file.last, [slot.heroId]: next } });
}

/** 记一批槽位（refresh 时调用；空槽忽略） */
export function rememberSlots(slots: SlotState[]): void {
  for (const s of slots) if (s.heroId) rememberSlot(s);
}

/** 某武将保存的方案（按保存顺序） */
export function listPlans(heroId: string): HeroPlan[] {
  return [...(readFile().plans[heroId] ?? [])];
}

/** 保存一套方案；同一套配置不重复存；超过 PLAN_MAX 拒绝 */
export function savePlan(heroId: string, raw: Loadout): { ok: true; plan: HeroPlan } | { ok: false; error: string } {
  const loadout = normalizeLoadout(heroId, raw);
  const file = readFile();
  const list = file.plans[heroId] ?? [];
  if (list.length >= PLAN_MAX) return { ok: false, error: `最多保存 ${PLAN_MAX} 套方案，先删掉不用的再存` };
  if (list.some((p) => JSON.stringify(p.loadout) === JSON.stringify(loadout))) {
    return { ok: false, error: '这套配置已经存过了，改点东西再存新的' };
  }
  const plan: HeroPlan = { id: `plan_${Date.now()}_${Math.floor(Math.random() * 1000)}`, loadout, savedAt: Date.now() };
  const ok = writeFile({ ...file, plans: { ...file.plans, [heroId]: [...list, plan] } });
  if (!ok) return { ok: false, error: '本机存储不可用，方案只在本次会话内有效' };
  return { ok: true, plan };
}

/** 删除一套方案（按 id）；返回到删除为止的列表 */
export function deletePlan(heroId: string, planId: string): HeroPlan[] {
  const file = readFile();
  const next = (file.plans[heroId] ?? []).filter((p) => p.id !== planId);
  writeFile({ ...file, plans: { ...file.plans, [heroId]: next } });
  return next;
}

// ── 摘要文案（详情页方案行 / 提示） ──

const STAT_SHORT: Array<[keyof FreePoints, string]> = [
  ['attack', '攻'],
  ['defense', '防'],
  ['strategy', '谋'],
  ['speed', '速'],
];

/** 加点摘要：集中在一项 →「全攻 +40」，分散 →「攻20 谋10」，全 0 →「无加点」 */
export function describePoints(p: FreePoints): string {
  const entries = STAT_SHORT.filter(([k]) => (p[k] ?? 0) > 0);
  const total = entries.reduce((a, [k]) => a + p[k], 0);
  if (total === 0) return '无加点';
  const [k0, name0] = entries[0];
  if (entries.length === 1) return `全${name0} +${p[k0]}`;
  return entries.map(([k, name]) => `${name}${p[k]}`).join(' ');
}

/** 红度摘要：满红 / 白板 / N 红 */
export function describeRedness(redness: number): string {
  if (redness >= 5) return '满红';
  if (redness <= 0) return '白板';
  return `${redness}红`;
}

/** 宝物摘要：元戎·长驱（满级）/ 元戎 / 未佩戴宝物 */
export function describeTreasure(t: TreasureLoadout | null): string {
  if (!t) return '未佩戴宝物';
  const name = TREASURES_BY_ID[t.treasureId]?.name ?? `宝物#${t.treasureId}`;
  return t.affix ? `${name}·${t.affix.name}` : name;
}

/** 一行摘要（列表行用）：战法 · 加点 · 宝物 · 红度 */
export function describeLoadout(l: Loadout): string {
  const skills = l.extraSkillIds.map((id) => SKILL_REGISTRY[id]?.name ?? id).join(' + ') || '无装配战法';
  return [skills, describePoints(l.freePoints), describeTreasure(l.treasure), describeRedness(l.redness)].join(' · ');
}
