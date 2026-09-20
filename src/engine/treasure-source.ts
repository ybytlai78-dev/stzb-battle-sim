/**
 * 宝物状态来源标识（独立小模块，避免 `action.ts ⇄ treasure.ts` 循环引用）。
 *
 * 口径：宝物效果**与任何来源都不冲突**（用户 2026-09-21）——`inflictStatusCore` 见到本前缀
 * 直接入栈、跳过全部冲突判定。
 */
import { TREASURES_BY_ID } from '../data/treasures';

export const TREASURE_SOURCE_PREFIX = 'treasure:';

/** 该 `sourceSkillId` 是否为宝物来源 */
export const isTreasureSource = (sourceSkillId: string): boolean =>
  sourceSkillId.startsWith(TREASURE_SOURCE_PREFIX);

/**
 * 宝物来源 id → 展示名（战报用）：
 * `treasure:1012:1` → 「屈卢」；`treasure:affix:骁锐` → 「骁锐」。
 */
export function treasureLabel(sourceSkillId: string): string {
  if (!isTreasureSource(sourceSkillId)) return '';
  const rest = sourceSkillId.slice(TREASURE_SOURCE_PREFIX.length);
  const [head, tail] = rest.split(':');
  if (head === 'affix') return tail ?? '';
  const treasure = TREASURES_BY_ID[Number(head)];
  return treasure ? treasure.name : '';
}
