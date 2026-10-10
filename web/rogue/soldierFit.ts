import type { TroopType } from '../../src/engine/types';
import extra from '../../scripts/skill_extra.json';

interface ExtraRow {
  name?: string;
  soldierType?: string;
}

const BY_NAME = new Map<string, string>();
for (const row of extra as ExtraRow[]) {
  const name = row.name?.trim();
  const soldier = row.soldierType?.trim();
  if (name && soldier && !BY_NAME.has(name)) BY_NAME.set(name, soldier);
}

const NEED: Record<TroopType, string> = { cavalry: '骑', infantry: '步', archer: '弓' };

/**
 * 按战法名查官方可用兵种。同名只保留 skill_extra 里的第一条。
 * @param skillName 战法名
 * @returns 如 `弓`、`弓步骑`；没有记录时为 undefined
 */
export function soldierTypeOf(skillName: string): string | undefined {
  return BY_NAME.get(skillName);
}

/**
 * 官方兵种串是否包含该兵种。没有记录时视为可装配，避免把未收录战法整表藏掉。
 * @param soldierType 官方兵种串
 * @param troop 武将兵种
 */
export function fitsSoldier(soldierType: string | undefined, troop: TroopType): boolean {
  if (!soldierType) return true;
  return soldierType.includes(NEED[troop]);
}
