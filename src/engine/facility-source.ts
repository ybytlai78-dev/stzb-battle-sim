/**
 * 设施来源标识（四大营）。
 *
 * 单独成文件与 `treasure-source.ts` / `chenshou-source.ts` 同构：
 * `action.ts` 需要在状态冲突判定里识别「这条状态是设施给的」，而 `facility.ts` 又要
 * 反向 import `action.ts` 的 `effectiveStat` / `formatAttrChangeDetail` —— 若前缀常量
 * 放进 `facility.ts` 就会形成 `action ↔ facility` 循环 import。这里不依赖任何引擎模块。
 */

export const FACILITY_SOURCE_PREFIX = 'facility:';

/** 设施状态 / 一次性标记的统一来源 id，如 `facility:junji` */
export function facilitySourceId(facilityId: string): string {
  return `${FACILITY_SOURCE_PREFIX}${facilityId}`;
}

export function isFacilitySource(sourceSkillId: string): boolean {
  return sourceSkillId.startsWith(FACILITY_SOURCE_PREFIX);
}

/** 从 `facility:junji` 取回 `junji`；非设施来源返回 undefined */
export function facilityIdOf(sourceSkillId: string): string | undefined {
  return isFacilitySource(sourceSkillId) ? sourceSkillId.slice(FACILITY_SOURCE_PREFIX.length) : undefined;
}
