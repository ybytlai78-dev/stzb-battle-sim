/**
 * 陈寿特性系统 · 引擎侧（率土之滨）
 *
 * 口径（用户 2026-10-16 拍板）：
 *  1. 陈寿特性**与任何来源都不冲突**，纯提升 → 施加时跳过 `inflictStatus` 的冲突判定（同宝物）；
 *  2. 一名武将**仅能使用一种**特性（官方机制），故不存在同源叠加问题；
 *  3. 区间类数值（4%-10%）由玩家在 UI 滑杆自选，默认取官方「简单显示」值（5%）——引擎禁 `Math.random`；
 *  4. 数据来源见 `src/data/chenshouFeatures.ts` 顶部注释（包内 `tb_cfg_hero` heroid 106001~106017）。
 *
 * 与宝物的差别：陈寿特性除状态类效果外，还有两类**必须在准备阶段之前**落地的改动 ——
 *  - 「纵横」改写阵营（阵营加成计数在 `computeTroopBonuses` 里读 `faction`，晚了就读到旧值）
 *  - 「出师·持重 / 争先」改统率值
 * ⇒ 这两类走 `applyChenshouPrepass()`，由 `combat.ts` 在部队加成结算**之前**调用。
 */
import type { CreateStatus, General, SkillType, UnitState } from './types';
import type { CombatContext } from './action';
import { CHENSHOU_BY_ID, type ChenshouLoadout } from '../data/chenshouFeatures';
import { CHENSHOU_CHIZHONG, type ChenshouCostUp } from '../data/chenshouCost';
import { inflictStatus } from './action';
import { CHENSHOU_SOURCE_PREFIX } from './chenshou-source';

export { CHENSHOU_SOURCE_PREFIX, isChenshouSource, chenshouLabel } from './chenshou-source';

/** 陈寿特性状态登记的 `sourceSkillType`（常驻、不可被驱散类判定命中） */
export const CHENSHOU_SOURCE_TYPE: SkillType = 'passive';

/** 持续至战斗结束 */
const FOREVER = 999;

/** 特性来源 id：`chenshou:cs_106004` */
export const chenshouSourceId = (featureId: string): string => `${CHENSHOU_SOURCE_PREFIX}${featureId}`;

/** 「陈寿·出师·持重」的特性 id（唯一一条会改写统率 / 属性 / 成长率的特性） */
export const CHENSHOU_COST_FEATURE_ID = 'cs_106001';

/**
 * 持重的**属性补丁**查询（包内表 `tb_cfg_feature_hero_new_cost` skillId=280013）：
 * 统率提升后的新值 + 攻击/防御/谋略 的 base 与成长率增量（速度、攻城恒为 0）。
 *
 * 由**构造期**（`web/heroes.ts` 的 `buildGeneral` / `baseStatsAt`）应用到武将档案副本上；
 * 引擎内的 `applyChenshouPrepass` 只兜底统率（幂等，见下）。无数据 → `null`（引擎未收录该武将）。
 */
export function chenshouStatPatch(heroId: string, chenshou?: ChenshouLoadout | null): ChenshouCostUp | null {
  if (!chenshou || chenshou.featureId !== CHENSHOU_COST_FEATURE_ID) return null;
  return CHENSHOU_CHIZHONG[heroId] ?? null;
}

/** 四维 key（砥砺分配用） */
type StatKey = 'attack' | 'defense' | 'strategy' | 'speed';

const STAT_BUFF: Record<StatKey, 'attack_buff' | 'defense_buff' | 'strategy_buff' | 'speed_buff'> = {
  attack: 'attack_buff',
  defense: 'defense_buff',
  strategy: 'strategy_buff',
  speed: 'speed_buff',
};

/**
 * 准备阶段**之前**的一次性改动（阵营 / 统率）。
 * 必须在 `computeTroopBonuses` 之前调用 —— 否则阵营加成会按改写前的阵营计数。
 * 就地改 `General`；runBattle 必须传入每场独立的面板副本，不能传用户装配原对象。
 */
export function applyChenshouPrepass(generals: General[]): void {
  for (const g of generals) {
    const cs = g.chenshou;
    if (!cs) continue;
    const def = CHENSHOU_BY_ID[cs.featureId];
    if (!def) continue;
    if (def.kind === 'faction' && cs.faction) {
      g.faction = cs.faction;
    } else if (def.kind === 'cost_up' || def.kind === 'cost_down') {
      // 持重：包内表给的是**提升后的统率绝对值** → 取表值幂等设值
      // （构造期 `buildGeneral` 通常已应用过，这里只兜底，不能再 +0.5）
      const patch = chenshouStatPatch(g.heroId ?? g.id, cs);
      if (patch) {
        g.cost = patch.cost;
      } else {
        const delta = def.kind === 'cost_up' ? cs.value : -cs.value;
        // 统率保留 1 位小数（0.5 步进），避免浮点尾数污染展示
        g.cost = Math.round((g.cost + delta) * 10) / 10;
      }
    }
  }
}

/**
 * 单个特性 → 待挂状态模板列表。
 * 只处理 `combat: true` 的四类：stat_pct（精进）/ stat_point（砥砺）/ deal_boost（昂扬）/ take_reduce（审慎）。
 * 阵营 / 统率走 prepass；star_up / non_combat 不在战斗结算范围内。
 */
export function buildChenshouStatuses(loadout: ChenshouLoadout): CreateStatus[] {
  const def = CHENSHOU_BY_ID[loadout.featureId];
  if (!def || !def.combat) return [];
  const v = loadout.value;

  switch (def.kind) {
    case 'stat_pct':
      // 「提升武将 4%-10% 的攻击属性」→ 面板四维按百分比提升（treasure 同一机制）
      return def.stat
        ? ([{ type: STAT_BUFF[def.stat], amount: v, percent: true, duration: FOREVER } as CreateStatus])
        : [];

    case 'stat_point': {
      // 「总计 6-12 点属性，随机分配到攻击、防御、谋略、速度」→ 引擎禁随机，改为玩家自行分配
      const alloc = loadout.alloc;
      if (!alloc) return [];
      const out: CreateStatus[] = [];
      for (const k of ['attack', 'defense', 'strategy', 'speed'] as StatKey[]) {
        const n = alloc[k] ?? 0;
        if (n > 0) out.push({ type: STAT_BUFF[k], amount: n, duration: FOREVER } as CreateStatus);
      }
      return out;
    }

    case 'deal_boost':
      // 「战斗开始后，武将造成的攻击/策略伤害提升 4%-10%」
      return [
        {
          type: 'damage_boost',
          rate: v / 100,
          direction: 'caused',
          duration: FOREVER,
          ...(def.damageType ? { damageType: def.damageType } : {}),
        } as CreateStatus,
      ];

    case 'take_reduce':
      // 「战斗开始后，武将受到的攻击/策略伤害降低 4%-10%」
      return [
        {
          type: 'damage_reduce',
          rate: v / 100,
          duration: FOREVER,
          ...(def.damageType ? { damageType: def.damageType } : {}),
        } as CreateStatus,
      ];

    default:
      return [];
  }
}

/** 准备阶段挂载某单位的陈寿特性状态（由 `combat.ts` 在宝物之后、战法之前调用） */
export function applyChenshouEffects(ctx: CombatContext, unit: UnitState): void {
  const loadout = unit.general.chenshou;
  if (!loadout) return;
  const sourceId = chenshouSourceId(loadout.featureId);
  for (const create of buildChenshouStatuses(loadout)) {
    inflictStatus(ctx, unit, create, CHENSHOU_SOURCE_TYPE, sourceId, unit.general.id);
  }
}
