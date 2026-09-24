/**
 * 截图识别 · 敌对队伍集：识别 JSON → 库校验 → 对手配置
 * ---------------------------------------------------------------------------
 * spec：`docs/截图识别-敌对队伍集.md` §三/§四/§五。
 * **纯逻辑**：本文件不 import 任何武将/宝物数据文件，数据表由调用方注入
 * （浏览器用 `web/teamScanBrowser.ts`；node 脚本用 `web/data/heroes.json` + `src/data/*.ts`），
 * 保证「一份实现三处调用」，校验口径不会漂移。
 */
import type { GeneralTrait, TreasureLoadout, TroopType } from '../src/engine/types';

export const SCAN_POSITIONS = ['大营', '中军', '前锋'] as const;
export type ScanPosition = (typeof SCAN_POSITIONS)[number];

/** 识别到的宝物（截图上的样子） */
export interface ScanTreasure {
  name: string;
  /** 品质：精品 / 罕俦 / 稀世（只认稀世） */
  quality: string;
  /** 锻造词条名（仅稀世读） */
  affix?: string | null;
  /** 宝物等级（截图上角汉字数字 `玖` = 9，缺省 10） */
  level?: number;
}

/** 识别到的一个槽位 */
export interface ScanSlot {
  position: string;
  heroName: string;
  heroId?: string;
  level: number;
  troopTrait?: string | null;
  /** 第 1 个必须是该武将的主战法 */
  skillNames: string[];
  treasure?: ScanTreasure | null;
  /** 观察值留痕（不参与模拟：非稀世/名字不在库时写这里） */
  treasureSeen?: (ScanTreasure & { dropped?: string }) | null;
}

/** AI 产出的识别结果（固定 schema） */
export interface ScanJson {
  source: { file: string; sha256?: string; at?: string };
  label: string;
  side?: 'enemy' | 'ally';
  slots: ScanSlot[];
  unrecognized?: string[];
}

export interface HeroLite {
  id: string;
  name: string;
  mainSkillId?: string;
  mainSkillName?: string;
  troopType: string;
}
export interface TreasureLite {
  id: number;
  name: string;
  affixPool: string[];
}

/** 校验用数据表（调用方注入） */
export interface ScanTables {
  heroes: HeroLite[];
  /** 战法名 → id */
  skillIdByName: Map<string, string>;
  /** 引擎稀世宝物库（36 件，本就只含稀世） */
  treasures: TreasureLite[];
  /** 锻造词条 → 官方区间（玩家可选范围） */
  affixRange: Map<string, { min: number; max: number }>;
  /** 兵系通用特性池并集（步/弓/骑） */
  traits: Set<string>;
}

export interface ScanTableData {
  heroes: HeroLite[];
  skills: Record<string, { name: string }>;
  treasures: TreasureLite[];
  affixes: Record<string, { min: number; max: number }>;
  traits: string[];
}

export function buildTables(data: ScanTableData): ScanTables {
  return {
    heroes: data.heroes,
    skillIdByName: new Map(Object.entries(data.skills).map(([id, s]) => [s.name, id])),
    treasures: data.treasures,
    affixRange: new Map(Object.entries(data.affixes).map(([name, a]) => [name, { min: a.min, max: a.max }])),
    traits: new Set(data.traits),
  };
}

export interface ScanIssue {
  level: 'error' | 'warn';
  rule: string;
  message: string;
  slot?: number;
}

/** 校验 + 解析后的槽位（可安全入库/入模拟） */
export interface ResolvedSlot {
  position: ScanPosition;
  heroId: string;
  heroName: string;
  troopType: TroopType;
  /** 原图等级（照录） */
  rawLevel: number;
  /** 入库等级（<40 夹到 40，用户口径） */
  level: number;
  levelClampedTo40: boolean;
  troopTrait: string | null;
  skillNames: string[];
  skillIds: string[];
  treasure: TreasureLoadout | null;
  treasureSeen: (ScanTreasure & { dropped?: string }) | null;
}

export interface ScanResult {
  ok: boolean;
  label: string;
  side: 'enemy' | 'ally';
  source: ScanJson['source'];
  slots: ResolvedSlot[];
  issues: ScanIssue[];
}

/** L4 配置槽（结构上是 `web/teamConfig.ts` 的 `SlotCfg`） */
export interface ScanSlotCfg {
  heroId: string;
  level: number;
  addAttack: number;
  addStrategy: number;
  troopType: TroopType;
  skillIds: string[];
  traits?: GeneralTrait[];
  treasure?: TreasureLoadout | null;
}
export interface ScanViewCfg {
  slots: ScanSlotCfg[];
  morale: number;
  enemy: { defense: number; strategy: number; troopType: TroopType };
  rounds: number;
  manual: { boostCaused: number; boostTaken: number; reduce: number };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * 校验识别结果（规则见 spec §四）。
 * `error` 级问题 → `ok = false`（图留在投放箱，不归档）；`warn` 只是记账。
 */
export function validateScan(scan: ScanJson, tables: ScanTables): ScanResult {
  const issues: ScanIssue[] = [];
  const err = (rule: string, message: string, slot?: number): void => {
    issues.push({ level: 'error', rule, message, slot });
  };
  const warn = (rule: string, message: string, slot?: number): void => {
    issues.push({ level: 'warn', rule, message, slot });
  };

  // 规则 1：位置恰好 大营/中军/前锋 各一个
  const raw = Array.isArray(scan?.slots) ? scan.slots : [];
  const counts = new Map<string, number>();
  for (const s of raw) counts.set(s.position, (counts.get(s.position) ?? 0) + 1);
  for (const [pos, n] of counts) {
    if (!(SCAN_POSITIONS as readonly string[]).includes(pos)) err('slot-position', `未知位置「${pos}」`);
    else if (n > 1) err('slot-position', `位置「${pos}」出现 ${n} 次`);
  }
  const ordered = SCAN_POSITIONS.map((pos, i) => {
    const hit = raw.find((s) => s.position === pos);
    if (!hit) err('slot-position', `缺少「${pos}」`, i);
    return hit;
  });

  const slots: ResolvedSlot[] = [];
  ordered.forEach((s, i) => {
    if (!s) return;

    // 规则 2：武将名唯一命中
    const hits = tables.heroes.filter((h) => h.name === s.heroName);
    if (hits.length === 0) err('hero-name', `武将「${s.heroName}」不在库`, i);
    else if (hits.length > 1) {
      err('hero-name', `武将「${s.heroName}」有 ${hits.length} 个版本：${hits.map((h) => h.id).join(' / ')}`, i);
    }
    const hero = hits[0];

    // 规则 3 / 5：战法名在库 + 第 1 个 = 主战法
    const names = (s.skillNames ?? []).map((n) => String(n).trim()).filter(Boolean);
    const skillIds: string[] = [];
    names.forEach((n, k) => {
      const id = tables.skillIdByName.get(n);
      if (!id) err('skill-name', `战法「${n}」不在库`, i);
      else skillIds.push(id);
      if (k === 0 && hero?.mainSkillName && n !== hero.mainSkillName) {
        err('main-skill', `${hero.name} 第 1 个战法应是主战法「${hero.mainSkillName}」，识别为「${n}」`, i);
      }
    });
    if (names.length !== 3) warn('skill-count', `应为 3 个战法（主战法 + 2 携带），识别到 ${names.length}`, i);

    // 规则 6：兵系通用特性池
    const trait = s.troopTrait ?? null;
    if (trait && !tables.traits.has(trait)) err('trait', `特性「${trait}」不在兵系通用特性池`, i);

    // 规则 7：等级照录；< 40 夹到 40（用户口径）
    const rawLevel = Math.round(Number(s.level) || 0);
    const level = Math.max(40, Math.min(50, rawLevel));
    const levelClampedTo40 = rawLevel < 40;
    if (levelClampedTo40) warn('level', `原图 Lv${rawLevel} → 入库按 Lv40 跑（用户口径）`, i);

    // 规则 8：宝物只认稀世 + 名字在稀世库 + 词条在该宝物可锻造池内
    let treasure: TreasureLoadout | null = null;
    const t = s.treasure ?? null;
    const seen = s.treasureSeen ?? null;
    if (t) {
      const lib = tables.treasures.find((x) => x.name === t.name);
      if (t.quality !== '稀世') warn('treasure-quality', `宝物「${t.name}·${t.quality}」非稀世 → 不识别`, i);
      else if (!lib) warn('treasure-name', `宝物「${t.name}」不在稀世宝物库 → 不识别`, i);
      else {
        const affixName = t.affix?.trim() || null;
        if (!affixName) treasure = { treasureId: lib.id, level: t.level ?? 10 };
        else {
          const range = tables.affixRange.get(affixName);
          if (!range || !lib.affixPool.includes(affixName)) {
            err('treasure-affix', `词条「${affixName}」不属于「${lib.name}」可锻造池`, i);
          } else {
            treasure = {
              treasureId: lib.id,
              level: t.level ?? 10,
              affix: { name: affixName, value: round1((range.min + range.max) / 2) },
            };
          }
        }
      }
    } else if (seen) {
      // 按口径只认稀世：非稀世/不在库的观察值只记账（treasureSeen 留痕，可审计）
      const lib = tables.treasures.find((x) => x.name === seen.name);
      if (seen.quality !== '稀世') {
        warn('treasure-quality', `宝物「${seen.name}${seen.quality ? `·${seen.quality}` : ''}」非稀世 → 不识别（留痕）`, i);
      } else if (!lib) {
        warn('treasure-name', `宝物「${seen.name}」不在稀世宝物库 → 不识别（留痕）`, i);
      }
    }

    slots.push({
      position: s.position as ScanPosition,
      heroId: hero?.id ?? '',
      heroName: s.heroName,
      troopType: (hero?.troopType ?? 'infantry') as TroopType,
      rawLevel,
      level,
      levelClampedTo40,
      troopTrait: trait,
      skillNames: names,
      skillIds,
      treasure,
      treasureSeen: s.treasureSeen ?? t ?? null,
    });
  });

  // 规则 4：同队战法唯一（含各将主战法）
  const used = new Map<string, string>();
  slots.forEach((r, i) => {
    const hero = tables.heroes.find((h) => h.id === r.heroId);
    const ids = [hero?.mainSkillId, ...r.skillIds.slice(1)].filter((v): v is string => Boolean(v));
    for (const id of ids) {
      const owner = used.get(id);
      if (owner && owner !== r.heroName) {
        err('skill-duplicate', `战法「${id}」在队内重复（${owner} / ${r.heroName}）`, i);
      } else {
        used.set(id, r.heroName);
      }
    }
  });

  return {
    ok: !issues.some((i) => i.level === 'error'),
    label: scan?.label ?? '未命名队伍',
    side: scan?.side === 'ally' ? 'ally' : 'enemy',
    source: scan?.source ?? { file: '' },
    slots,
    issues,
  };
}

/** 校验结果 → L4 对手池配置（加点一律 0：由用户在配将面板上分配） */
export function toOpponentEntries(
  records: Array<{ label: string; slots: ResolvedSlot[] }>
): Array<{ name: string; cfg: ScanViewCfg }> {
  return records.map((rec) => ({
    name: rec.label,
    cfg: {
      slots: rec.slots.map((s) => ({
        heroId: s.heroId,
        level: s.level,
        addAttack: 0,
        addStrategy: 0,
        troopType: s.troopType,
        skillIds: [...s.skillIds],
        ...(s.troopTrait ? { traits: [s.troopTrait as GeneralTrait] } : {}),
        treasure: s.treasure,
      })),
      morale: 120,
      enemy: { defense: 150, strategy: 100, troopType: 'infantry' as TroopType },
      rounds: 8,
      manual: { boostCaused: 0, boostTaken: 0, reduce: 0 },
    },
  }));
}
