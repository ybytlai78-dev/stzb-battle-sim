/**
 * 攻击距离寻敌 / 目标选择（v0.1+）
 * 站位距离表（我方 ↔ 敌方）：
 *   前锋↔前锋 1，前锋↔中军 2，前锋↔大营 3
 *   中军↔前锋 2，中军↔中军 3，中军↔大营 4
 *   大营↔前锋 3，大营↔中军 4，大营↔大营 5
 *
 * 实时距离（v0.10）：距离不固定。每方**存活**单位按原站位（前锋→中军→大营）重新编号，
 * 阵亡单位跳过、后排前移（前锋阵亡 → 中军压到 0 位 → 大营压到 1 位），再按压缩后的
 * 相对位次查距离矩阵。例：双方只剩大营 → 双方大营都压到己方 0 位 → 距离 1。
 */
import type { UnitState } from './types';
import type { CombatContext } from './action';

const POSITION_INDEX: Record<string, number> = { 前锋: 0, 中军: 1, 大营: 2 };

export { POSITION_INDEX };

/** 我方站位行号 → 敌方站位列号 的距离 */
const DISTANCE_MATRIX: number[][] = [
  [1, 2, 3], // 敌方前锋
  [2, 3, 4], // 敌方中军
  [3, 4, 5], // 敌方大营
];

/** 存活单位压缩位次：按原站位序（前锋→中军→大营）取存活单位重新编号 0..n-1 */
function liveRank(team: UnitState[]): Map<string, number> {
  const alive = team
    .filter((u) => u.alive)
    .sort((a, b) => POSITION_INDEX[a.general.position] - POSITION_INDEX[b.general.position]);
  const map = new Map<string, number>();
  alive.forEach((u, i) => map.set(u.general.id, i));
  return map;
}

/**
 * 同侧存活距离：压缩位次差（前锋↔中军=1，前锋↔大营=2；自身=0）。
 * 同仇敌忾「距离 1 以内的友军」用此，不走敌对站位矩阵（同侧前锋-中军在敌对矩阵上是 2）。
 */
export function sameSideDistance(ctx: CombatContext, a: UnitState, b: UnitState): number {
  if (a.general.id === b.general.id) return 0;
  const team = a.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const ranks = liveRank(team);
  const ai = ranks.get(a.general.id);
  const bi = ranks.get(b.general.id);
  if (ai === undefined || bi === undefined) return Number.POSITIVE_INFINITY;
  return Math.abs(ai - bi);
}

/** 实时距离：双方存活单位压缩重编号后查矩阵（阵亡单位不计位次） */
export function distanceBetween(ctx: CombatContext, attacker: UnitState, defender: UnitState): number {
  const aTeam = attacker.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const dTeam = defender.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const ai = liveRank(aTeam).get(attacker.general.id) ?? 0;
  const di = liveRank(dTeam).get(defender.general.id) ?? 0;
  return DISTANCE_MATRIX[di][ai];
}

function sortByPosition(a: UnitState, b: UnitState): number {
  const ai = POSITION_INDEX[a.general.position];
  const bi = POSITION_INDEX[b.general.position];
  return ai - bi; // 前锋(0) 先于 中军(1) 先于 大营(2)
}

/** 攻击范围内随机一个存活敌军（率土普攻目标选取：距离内均匀随机，非最近优先）。距离实时计算 */
export function nearestEnemy(ctx: CombatContext, attacker: UnitState, enemies: UnitState[]): UnitState | null {
  const inRange = enemies.filter(
    (e) => e.alive && distanceBetween(ctx, attacker, e) <= attacker.general.attackRange
  );
  if (inRange.length === 0) return null;
  return inRange[ctx.rng.int(inRange.length)];
}

/**
 * 战法选目标用的距离：同侧走压缩位次差（前锋↔中军=1，前锋↔大营=2，自身=0），
 * 对侧走敌对站位矩阵。我军群体若误用敌对矩阵，中军施法者到己方大营会变成 4，距离 3 的战法永远打不满 3 人。
 */
function skillDistance(ctx: CombatContext, caster: UnitState, target: UnitState): number {
  if (caster.side === target.side) return sameSideDistance(ctx, caster, target);
  return distanceBetween(ctx, caster, target);
}

/**
 * 战法目标选择：按战法有效距离（实时）+ 目标模式。
 * groupCount：仅 group 模式有效——目标数（缺省 2）；`[2,3]` = 50% 概率 2 目标 / 50% 概率 3 目标（辕门射戟 / 动如雷震）。
 * 群体在有效距离内存活单位中均匀随机抽取（率土「三选二」），不是最近优先。
 */
export function skillTargets(
  ctx: CombatContext,
  caster: UnitState,
  enemies: UnitState[],
  range: number,
  mode: 'single' | 'random_single' | 'group' | 'all',
  groupCount: number | [number, number] = 2
): UnitState[] {
  const alive = enemies.filter((e) => e.alive);
  if (alive.length === 0) return [];

  if (mode === 'all') return alive;

  const inRange = alive
    .filter((e) => skillDistance(ctx, caster, e) <= range)
    .sort((a, b) => skillDistance(ctx, caster, a) - skillDistance(ctx, caster, b) || sortByPosition(a, b));

  if (inRange.length === 0) return [];

  // 随机单体（银龙冲阵）：有效距离内均匀随机选 1 个，多次调用各自独立判断
  if (mode === 'random_single') {
    return [inRange[ctx.rng.int(inRange.length)]];
  }
  if (mode === 'single') return [inRange[0]];

  // group：有效距离内不放回均匀抽取 want 个（大赏三军「我军群体 2 目标」= 三选二，含自身但不强制选自己）
  const want = Array.isArray(groupCount) ? (ctx.rng.chance(0.5) ? groupCount[0] : groupCount[1]) : groupCount;
  return pickRandom(ctx, inRange, want);
}

/**
 * 从候选中不放回均匀抽取 n 个。优先走 Rng.pickN；测试 stub 只有 int() 时用 splice 回退。
 */
function pickRandom(ctx: CombatContext, items: UnitState[], n: number): UnitState[] {
  if (typeof ctx.rng.pickN === 'function') return ctx.rng.pickN(items, n);
  const pool = items.slice();
  const group: UnitState[] = [];
  const count = Math.min(Math.max(n, 0), pool.length);
  for (let i = 0; i < count; i++) {
    const idx = ctx.rng.int(pool.length);
    group.push(pool.splice(idx, 1)[0]);
  }
  return group;
}

/** 分兵相邻目标：同队中与目标站位相邻的存活单位（前锋↔中军，中军↔前锋+大营，大营↔中军） */
export function adjacentUnits(target: UnitState, team: UnitState[]): UnitState[] {
  const idx = POSITION_INDEX[target.general.position];
  return team.filter((u) => {
    if (!u.alive || u.general.id === target.general.id) return false;
    return Math.abs(POSITION_INDEX[u.general.position] - idx) === 1;
  });
}
