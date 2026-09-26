import type { FormationBonus, FormationBonusLine, General, TroopBonusResult, TroopType } from './types';
import { effectiveTroopLine } from './secondaryTroop';
import { TITLE_REGISTRY } from '../data/titles';

const POS_ORDER: Record<string, number> = { 大营: 0, 中军: 1, 前锋: 2 };

/** 四维全 0 */
export const ZERO_BONUS: FormationBonus = { attack: 0, defense: 0, strategy: 0, speed: 0 };

function cloneBonus(b: FormationBonus = ZERO_BONUS): FormationBonus {
  return { attack: b.attack, defense: b.defense, strategy: b.strategy, speed: b.speed };
}

function addBonus(a: FormationBonus, b: FormationBonus): FormationBonus {
  return {
    attack: a.attack + b.attack,
    defense: a.defense + b.defense,
    strategy: a.strategy + b.strategy,
    speed: a.speed + b.speed,
  };
}

function isZero(b: FormationBonus): boolean {
  return b.attack === 0 && b.defense === 0 && b.strategy === 0 && b.speed === 0;
}

function pct(panel: number, rate: number): number {
  return Math.round((panel * rate) / 100);
}

function percentOn(
  g: General,
  rate: number,
  keys: Array<keyof FormationBonus>
): FormationBonus {
  const out = cloneBonus();
  for (const k of keys) out[k] = pct(g[k], rate);
  return out;
}

const TROOP_KEYS: Record<TroopType, Array<keyof FormationBonus>> = {
  cavalry: ['attack', 'speed'],
  infantry: ['attack', 'defense'],
  archer: ['speed', 'defense'],
};

/**
 * 将非 0 维格式化为「攻击+21 谋略+18」；全 0 返回空串。
 */
export function formatBonusText(b: FormationBonus): string {
  const parts: string[] = [];
  if (b.attack) parts.push(`攻击+${b.attack}`);
  if (b.strategy) parts.push(`谋略+${b.strategy}`);
  if (b.defense) parts.push(`防御+${b.defense}`);
  if (b.speed) parts.push(`速度+${b.speed}`);
  return parts.join('  ');
}

/**
 * 按本队上阵武将计算部队加成（阵营 / 称号 / 兵种）。
 * 百分比对面板四维各自 Math.round；空槽忽略。无 RNG。
 */
export function computeTroopBonuses(generals: General[]): TroopBonusResult {
  const byUnit = new Map<string, FormationBonus>();
  const lines: FormationBonusLine[] = [];
  if (generals.length === 0) return { byUnit, lines };

  const sorted = [...generals].sort(
    (a, b) => (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9)
  );

  const facCount = new Map<string, number>();
  const troopCount = new Map<TroopType, number>();
  for (const g of sorted) {
    facCount.set(g.faction, (facCount.get(g.faction) ?? 0) + 1);
    // 兵种加成按**有效兵系**计数（二级兵种转换：蛮兵计入步兵系；用户 2026-09-22）
    const line = effectiveTroopLine(g);
    troopCount.set(line, (troopCount.get(line) ?? 0) + 1);
  }

  const addLine = (g: General, line: FormationBonusLine) => {
    if (isZero(line.bonuses)) return;
    lines.push(line);
    byUnit.set(g.id, addBonus(byUnit.get(g.id) ?? ZERO_BONUS, line.bonuses));
  };

  for (const g of sorted) {
    const nFac = facCount.get(g.faction) ?? 0;
    const facRate = nFac >= 3 ? 10 : nFac === 2 ? 8 : 0;
    if (facRate > 0) {
      addLine(g, {
        unitId: g.id,
        category: 'faction',
        bonuses: percentOn(g, facRate, ['attack', 'defense', 'strategy', 'speed']),
      });
    }

    const present = new Set(sorted.map((x) => x.id));
    for (const title of TITLE_REGISTRY) {
      if (!title.memberIds.every((id) => present.has(id))) continue;
      const bonuses = cloneBonus();
      for (const e of title.effects) bonuses[e.stat] += e.amount;
      addLine(g, {
        unitId: g.id,
        category: 'title',
        titleId: title.id,
        titleName: title.name,
        bonuses,
      });
    }

    const line = effectiveTroopLine(g);
    const nTroop = troopCount.get(line) ?? 0;
    const troopRate = nTroop >= 3 ? 10 : nTroop === 2 ? 5 : 0;
    if (troopRate > 0) {
      addLine(g, {
        unitId: g.id,
        category: 'troop',
        bonuses: percentOn(g, troopRate, TROOP_KEYS[line]),
      });
    }
  }

  return { byUnit, lines };
}
