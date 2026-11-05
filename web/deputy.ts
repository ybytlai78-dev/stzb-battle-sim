/**
 * 北伐副本 · 副将机制（赛季模式扩展，2026-11-05）
 * ---------------------------------------------------------------------------
 * 口径（用户指定，与官方《北伐兴汉》剧本对齐的两条核心规则）：
 *   1. 主将四维 = 主将面板 × 70% + 副将面板 × 30%（逐项四舍五入）；
 *   2. 副将的**主战法**占主将的**第二战法格** —— 主将只剩第一格可自由装配，
 *      战斗内顺序是「主将主战法 → 副将主战法 → 主将装配战法」。
 * 补充口径（用户同批）：副将等级**跟随主将**，加点独立自定义。
 *
 * 不生效项（官方）：副将的拆解战法 / 兵种 / 宝物 / 陈寿特性一律不带，
 * 所以本模块只合成「四维 + 主战法」两件事，其余字段沿用主将。
 *
 * 架构：赛季差异**全部落在 web 层** —— 合成结果就是一个普通 `General`，
 * `src/engine` 零改动、golden 快照不受影响；常规赛季走 `classic` 分支即原路径。
 */
import { HERO_RECORDS, attachSkills, baseStatsAt, buildGeneral, freePointBudget, getHeroById } from './heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { General } from '../src/engine/types';

/** 赛季模式：常规赛季（引擎现状） / 北伐副本（启用副将） */
export type SeasonMode = 'classic' | 'beifa';

/** 赛季模式的 localStorage 键（与版本号 / 队伍 / 预设互不影响） */
export const SEASON_KEY = 'stzb_season_mode';

/** 副将权重：主将 70% + 副将 30% */
export const DEPUTY_STAT_SHARE = 0.3;

export interface StatPoints {
  attack: number;
  defense: number;
  strategy: number;
  speed: number;
}

/** 副将配置：只存武将 id 与自己的加点（等级跟随主将，红度固定 0） */
export interface DeputyState {
  heroId: string;
  freePoints: StatPoints;
}

/** 配将槽位的结构子集（避免与 teamEditor 循环依赖） */
export interface DeputySlotLike {
  heroId: string | null;
  extraSkillIds: string[];
  freePoints: StatPoints;
  redness: number;
  level: number;
  deputy?: DeputyState;
  secondaryTroop?: General['secondaryTroop'];
  secondaryTraits?: General['secondaryTraits'];
  treasure?: General['treasure'] | null;
  chenshou?: General['chenshou'];
}

export const zeroPoints = (): StatPoints => ({ attack: 0, defense: 0, strategy: 0, speed: 0 });

/** 读赛季模式（坏值 / 未设置 → 常规赛季） */
export function readSeasonMode(): SeasonMode {
  try {
    return localStorage.getItem(SEASON_KEY) === 'beifa' ? 'beifa' : 'classic';
  } catch {
    return 'classic';
  }
}

export function writeSeasonMode(mode: SeasonMode): void {
  try {
    localStorage.setItem(SEASON_KEY, mode);
  } catch {
    /* 隐私模式 / 配额满：记忆失败不影响本局 */
  }
}

export function emptyDeputy(heroId: string): DeputyState {
  return { heroId, freePoints: zeroPoints() };
}

/** 副将自由点预算：等级跟主将、红度按 0（官方副将不进阶） */
export function deputyBudget(deputy: DeputyState, mainLevel: number): number {
  return freePointBudget(deputy.heroId, 0, mainLevel);
}

/** 副将面板（基础 + 成长×等级 + 自己的加点，不含主将加权） */
export function deputyStatsAt(deputy: DeputyState, level: number): StatPoints {
  const rec = HERO_RECORDS[deputy.heroId];
  if (!rec) return zeroPoints();
  const base = baseStatsAt(rec, level);
  return {
    attack: base.attack + (deputy.freePoints.attack ?? 0),
    defense: base.defense + (deputy.freePoints.defense ?? 0),
    strategy: base.strategy + (deputy.freePoints.strategy ?? 0),
    speed: base.speed + (deputy.freePoints.speed ?? 0),
  };
}

/** 副将主战法 id（未实装 / 无主战法 → null，此时第二格只占位不生效） */
export function deputySkillId(deputy: DeputyState): string | null {
  const hero = getHeroById(deputy.heroId);
  const sid = hero?.mainSkillId;
  return sid && SKILL_REGISTRY[sid] ? sid : null;
}

/** 主将装配战法上限：常规 2；北伐带副将时第二格被副将主战法占用 → 只剩 1 */
export function equipLimit(slot: DeputySlotLike, season: SeasonMode): number {
  return season === 'beifa' && slot.deputy ? 1 : 2;
}

/**
 * 副将合法性：返回人话原因（null = 合法）。
 * 官方口径：副将须与主将**同阵营**、不能是同一张卡、不能与主将同名/SP 互斥。
 */
export function deputyRejectReason(mainHeroId: string | null | undefined, deputyHeroId: string): string | null {
  const main = mainHeroId ? getHeroById(mainHeroId) : undefined;
  const dep = getHeroById(deputyHeroId);
  if (!main) return '请先放入主将';
  if (!dep) return '武将不存在';
  if (dep.id === main.id) return '主将与副将不能是同一张卡';
  if (dep.faction !== main.faction) return `副将需与主将同阵营（主将属「${main.faction}」）`;
  if (dep.mutualExclusionGroup && dep.mutualExclusionGroup === main.mutualExclusionGroup) {
    return `「${dep.name}」与主将同名/SP 互斥，不能当副将`;
  }
  return null;
}

/** 加权：主将 × 70% + 副将 × 30%（逐项四舍五入） */
export function mixStats(main: StatPoints, deputy: StatPoints): StatPoints {
  const mix = (a: number, b: number): number => Math.round(a * (1 - DEPUTY_STAT_SHARE) + b * DEPUTY_STAT_SHARE);
  return {
    attack: mix(main.attack, deputy.attack),
    defense: mix(main.defense, deputy.defense),
    strategy: mix(main.strategy, deputy.strategy),
    speed: mix(main.speed, deputy.speed),
  };
}

/** 把副将主战法挂进对应类型槽（不改原对象） */
function withDeputySkill(g: General, deputy: DeputyState): General {
  const sid = deputySkillId(deputy);
  if (!sid) return g;
  return attachSkills(g, [sid]);
}

/**
 * 配将槽位 → 可战斗武将（赛季模式唯一入口）。
 * 常规赛季 = `buildGeneral(...)` + attachSkills，与历史行为逐字段一致；
 * 北伐副本且挂了副将 = 主将面板与副将面板加权 + 副将主战法插到装配战法之前。
 */
export function buildGeneralForSlot(
  slot: DeputySlotLike,
  position: General['position'],
  morale: number,
  season: SeasonMode
): General | null {
  if (!slot.heroId) return null;
  // 先只出主将本体（不带装配），这样副将主战法能排在装配战法之前
  const base = buildGeneral(
    slot.heroId,
    [],
    slot.freePoints,
    position,
    slot.redness,
    slot.level,
    morale,
    slot.secondaryTroop,
    slot.secondaryTraits,
    slot.treasure ?? undefined,
    slot.chenshou
  );
  if (season !== 'beifa' || !slot.deputy) return attachSkills(base, slot.extraSkillIds);

  const deputy = slot.deputy;
  const merged = withDeputySkill(base, deputy);
  // 副将主战法占第二格 → 装配战法只取第一格（防老存档 / 预设带 2 个装配战法）
  const withEquips = attachSkills(merged, slot.extraSkillIds.slice(0, equipLimit(slot, season)));
  const stats = mixStats(
    { attack: withEquips.attack, defense: withEquips.defense, strategy: withEquips.strategy, speed: withEquips.speed },
    deputyStatsAt(deputy, slot.level)
  );
  return { ...withEquips, ...stats };
}

/** 存档校正（预设 / 跨页写回）：heroId 非法或不合法的副将 → undefined */
export function normalizeDeputy(raw: unknown, mainHeroId: string | null | undefined, level: number): DeputyState | undefined {
  const o = (raw ?? {}) as Partial<DeputyState>;
  if (typeof o.heroId !== 'string' || !o.heroId) return undefined;
  if (deputyRejectReason(mainHeroId, o.heroId)) return undefined;
  const fp = (o.freePoints ?? {}) as Partial<StatPoints>;
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  };
  const budget = deputyBudget({ heroId: o.heroId, freePoints: zeroPoints() }, level);
  const points: StatPoints = { attack: num(fp.attack), defense: num(fp.defense), strategy: num(fp.strategy), speed: num(fp.speed) };
  // 预算收缩：超出的部分按 攻击→防御→谋略→速度 顺序扣减（与主将等级下调同口径）
  let used = points.attack + points.defense + points.strategy + points.speed;
  for (const k of ['attack', 'defense', 'strategy', 'speed'] as const) {
    if (used <= budget) break;
    const cut = Math.min(points[k], used - budget);
    points[k] -= cut;
    used -= cut;
  }
  return { heroId: o.heroId, freePoints: points };
}
