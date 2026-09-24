/**
 * 浏览器侧：识别结果 → 对手池条目
 * ---------------------------------------------------------------------------
 * 复用 `web/teamScan.ts` 的校验（一份实现三处调用），表来自前端数据。
 * 支持三种输入：
 *   ① `队伍集.json`：`[{ name, cfg }]`（脚本产出，直接入池）
 *   ② 归档 JSON：`{ label, resolved: { slots } }`
 *   ③ AI 原始识别 JSON：`{ label, slots: [{ heroName, skillNames, … }] }`（前端即时校验）
 */
import { AFFIXES, TREASURES } from '../src/data/treasures';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { GeneralTrait } from '../src/engine/secondaryTroop';
import { FAMILY_TRAITS } from '../src/engine/secondaryTroop';
import { SLOTTED_HEROES } from './heroes';
import {
  buildTables,
  toOpponentEntries,
  validateScan,
  type ResolvedSlot,
  type ScanJson,
  type ScanTables,
  type ScanViewCfg,
} from './teamScan';

/** 兵系通用特性池并集（步/弓/骑 各 5 个 = 15） */
export const TRAIT_POOL: GeneralTrait[] = Array.from(new Set(Object.values(FAMILY_TRAITS).flat()));

export function browserTables(): ScanTables {
  return buildTables({
    heroes: SLOTTED_HEROES.map((h) => ({
      id: h.id,
      name: h.name,
      mainSkillId: h.mainSkillId,
      mainSkillName: h.mainSkillName,
      troopType: h.troopType,
    })),
    skills: SKILL_REGISTRY,
    treasures: TREASURES,
    affixes: AFFIXES,
    traits: TRAIT_POOL,
  });
}

export interface ImportedEntry {
  name: string;
  cfg: ScanViewCfg;
}
export interface ImportOutcome {
  entries: ImportedEntry[];
  /** 被跳过/拒收的原因 */
  problems: string[];
  /** 已导入但需知会的（如「你方阵容」） */
  notices: string[];
}

export function importScanEntries(raw: unknown): ImportOutcome {
  const items = Array.isArray(raw) ? raw : [raw];
  const tables = browserTables();
  const entries: ImportedEntry[] = [];
  const problems: string[] = [];
  const notices: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      problems.push('不是对象');
      continue;
    }
    const rec = item as Partial<ScanJson> & {
      name?: string;
      cfg?: ScanViewCfg;
      resolved?: { slots: ResolvedSlot[] };
    };
    const label = rec.label ?? rec.name ?? '导入队伍';
    if (rec.side === 'ally') notices.push(`${label} 是你方阵容，已按对手导入`);

    // ① 脚本产出的 队伍集.json
    if (rec.cfg) {
      entries.push({ name: label, cfg: rec.cfg });
      continue;
    }
    // ② 归档 JSON（已解析槽位）
    if (Array.isArray(rec.resolved?.slots)) {
      entries.push(...toOpponentEntries([{ label, slots: rec.resolved.slots }]));
      continue;
    }
    // ③ AI 原始识别 JSON（现场校验）
    const first = Array.isArray(rec.slots)
      ? (rec.slots[0] as unknown as Record<string, unknown> | undefined)
      : undefined;
    if (first && 'skillNames' in first) {
      const res = validateScan(rec as ScanJson, tables);
      if (!res.ok) {
        problems.push(`${label}：${res.issues.find((i) => i.level === 'error')?.message ?? '校验失败'}`);
        continue;
      }
      entries.push(...toOpponentEntries([{ label, slots: res.slots }]));
      continue;
    }
    problems.push(`${label}：格式不认识（需要 队伍集.json / 归档 JSON / 原始识别 JSON）`);
  }

  return { entries, problems, notices };
}
