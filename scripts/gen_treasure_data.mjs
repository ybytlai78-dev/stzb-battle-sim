/**
 * 生成 `src/data/treasures.ts`（率土之滨·稀世宝物 + 锻造词条）
 *
 * 输入：dateyuan/宝物数据.json（由 `node scripts/fetch_gear_data.mjs` 抓网易官网宝物库 JSON）
 * 输出：src/data/treasures.ts —— 36 件战斗类稀世（内政类「大吉/天禄」与 G12 内政词条按口径剔除）
 *
 * 数值口径（用户 2026-09-21 确认，见 dateyuan/宝物系统方案.md §0）：
 *  - 自带特效 slot1/2 的 value = 「每次强化增量」（官方库数值即增量，见调研 §8.2）
 *  - slot3 = 固定值
 *  - 默认 10 级：slot1 = value×5、slot2 = value×5、slot3 = value×1
 *  - 锻造词条数值玩家在 [min,max] 内任选（滑杆），hint 仅作蓝/粉/红颜色提示（社区档位表，调研 §8.3）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = JSON.parse(fs.readFileSync(path.join(root, 'dateyuan/宝物数据.json'), 'utf8'));

/** 内政类（不做）：词条组 12 与自带 policy 的宝物 */
const POLICY_GROUP = 12;

/**
 * 蓝/粉/红档位提示（社区档位表，调研 §8.3）。
 * 仅用于 UI 颜色刻度，不限制玩家取值；「-」表示社区表未给出。
 */
const HINTS = {
  // 灵动·艮止：10/12/14/16/18/20/22/24/26/30
  灵动: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  艮止: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  // 筹算·英勇·骁锐·天资·仁心·强韧·蓄锐·济世：5/6/7/8/9/10/10/10/13/15
  筹算: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  英勇: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  骁锐: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  天资: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  仁心: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  // ⚠️ 社区档位表把「强韧」列在 5%~15% 那一栏，但官方文案是 10%~20% → 以官方区间为准，归入 10~20 族
  强韧: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  蓄锐: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  济世: { blueMax: 10, pinkMin: 10, pinkMax: 13, red: 15 },
  // 至策·颖悟·坚忍·破敌·稳固·沉稳·威势：10..18/20
  至策: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  颖悟: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  坚忍: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  破敌: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  稳固: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  沉稳: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  威势: { blueMax: 16, pinkMin: 17, pinkMax: 18, red: 20 },
  // 眩惑(炫惑)·亢厉·善谋·陷阵·驱火·无畏·选锋·戒备：10/12/.../26/30
  炫惑: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  亢厉: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  善谋: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  陷阵: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  驱火: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  无畏: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  选锋: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  戒备: { blueMax: 22, pinkMin: 24, pinkMax: 26, red: 30 },
  // 机敏·奔袭·击虚·不懈：3/4/5/6/7/8/9
  机敏: { blueMax: 6, pinkMin: 7, pinkMax: 8, red: 9 },
  奔袭: { blueMax: 6, pinkMin: 7, pinkMax: 8, red: 9 },
  击虚: { blueMax: 6, pinkMin: 7, pinkMax: 8, red: 9 },
  不懈: { blueMax: 6, pinkMin: 7, pinkMax: 8, red: 9 },
  // 不屈：官方区间 3%~9%，社区档位表未单列 → 按同区间的「机敏」族提示
  不屈: { blueMax: 6, pinkMin: 7, pinkMax: 8, red: 9 },
  // 熟虑：6/8/10/12/14/16/18/20
  熟虑: { blueMax: 14, pinkMin: 16, pinkMax: 18, red: 20 },
  // 清毅：第 5/6/7/8 回合
  清毅: { blueMax: 6, pinkMin: 7, pinkMax: 7, red: 8 },
  // 强击：前 1/2/3/4/5 回合
  强击: { blueMax: 3, pinkMin: 4, pinkMax: 4, red: 5 },
  // 坚毅：前 2/3/4/5/6 回合
  坚毅: { blueMax: 4, pinkMin: 5, pinkMax: 5, red: 6 },
  // 惑言·识破：前 1/2/3 个（回合）
  惑言: { blueMax: 2, pinkMin: 3, pinkMax: 3, red: null },
  识破: { blueMax: 2, pinkMin: 3, pinkMax: 3, red: null },
};

const nums = (s) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
/** 主数值：优先取「带 % 的数字」里的最后一个，否则取最后一个数字 */
function mainValue(desc, numbers) {
  const pct = [];
  const re = /(\d+(?:\.\d+)?)\s*%/g;
  let m;
  while ((m = re.exec(desc))) pct.push(Number(m[1]));
  if (pct.length) return pct[pct.length - 1];
  return numbers[numbers.length - 1] ?? 0;
}
const unitOf = (desc) => (desc.includes('%') ? 'percent' : 'point');

/** 解析官方区间标记 `#a~b#` / `#a-b#` */
function parseRange(desc) {
  const m = /#([^#]+)#/.exec(desc);
  if (!m) return null;
  const parts = m[1].split(/[~-]/).map((s) => Number(s.replace(/[^\d.]/g, '')));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) };
}
const affixUnit = (desc) => (desc.includes('%') ? 'percent' : /个控制效果|前\d/.test(desc) && !desc.includes('回合') ? 'count' : desc.includes('回合') ? 'round' : 'point');

const combat = src.treasures.filter((t) => t.quality === '稀世' && t.skillName && t.featureGroup !== POLICY_GROUP);

const treasures = combat.map((t) => {
  const names = t.skillName.split('／').join('；').split('；').map((s) => s.trim()).filter(Boolean);
  const descs = t.skillDesc.split('；').map((s) => s.trim());
  const effects = names.map((name, i) => {
    const desc = descs[i] ?? '';
    const numbers = nums(desc);
    return { slot: i + 1, name, desc, value: mainValue(desc, numbers), unit: unitOf(desc), numbers };
  });
  if (names.length !== descs.length) {
    throw new Error(`${t.name} 特效名/描述条数不一致：${names.length} vs ${descs.length}`);
  }
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    image: `/gears/gear_${t.id}.jpg`,
    icon: `/gears/gear_${t.id}_s.jpg`,
    affixGroup: t.featureGroup,
    affixPool: t.affixPool,
    effects,
  };
});

/** 全部锻造词条（12 组去重；剔除 G12 内政） */
const affixMap = new Map();
for (const g of src.affixGroups) {
  if (g.groupId === POLICY_GROUP) continue;
  for (const a of g.affixes) {
    if (affixMap.has(a.name)) continue;
    const range = parseRange(a.desc);
    if (!range) throw new Error(`词条 ${a.name} 无可解析区间：${a.desc}`);
    affixMap.set(a.name, {
      name: a.name,
      desc: a.desc,
      min: range.min,
      max: range.max,
      unit: affixUnit(a.desc),
      hint: HINTS[a.name] ?? null,
    });
  }
}
const affixes = [...affixMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
const groups = src.affixGroups.filter((g) => g.groupId !== POLICY_GROUP).map((g) => ({
  groupId: g.groupId,
  affixes: g.affixes.map((a) => a.name),
}));

const missingHint = affixes.filter((a) => !a.hint).map((a) => a.name);
if (missingHint.length) console.warn('⚠️ 缺少档位提示的词条：', missingHint.join('、'));

const j = (v) => JSON.stringify(v);
const lit = (v, indent = 2) => JSON.stringify(v, null, indent).replace(/\n/g, '\n  ');

// ── 生成 TS ────────────────────────────────────────────────
const lines = [];
lines.push(`/**
 * 率土之滨【稀世】宝物数据（战斗类 ${treasures.length} 件 + 锻造词条 ${affixes.length} 条 / ${groups.length} 组）
 *
 * ⚠️ 自动生成，请勿手改 —— 重新生成：\`node scripts/gen_treasure_data.mjs\`
 *    数据源：\`dateyuan/宝物数据.json\` ← \`node scripts/fetch_gear_data.mjs\`（网易官网宝物库服务端 JSON）
 *    背景与口径：\`dateyuan/宝物系统调研.md\`、\`dateyuan/宝物系统方案.md\`
 *
 * 数值口径（用户确认）：
 *  - 自带特效 slot1 / slot2 的 \`value\` = **每次强化的增量**（官方库数值即增量）；slot3 = **固定值**
 *  - 默认 10 级：slot1 = value × 5、slot2 = value × 5、slot3 = value × 1
 *  - 锻造词条数值由玩家在 [min, max] 内任选（滑杆）；\`hint\` 只作蓝/粉/红**颜色提示**，不限制取值
 *  - 内政类（大吉 / 天禄 与第 12 组词条）不在战斗引擎范围内，已剔除
 */

export type TreasureType = '刀' | '剑' | '长兵' | '弓' | '扇' | '其他';

/** 宝物自带特效（一阶 / 二阶 / 三阶） */
export interface TreasureEffectDef {
  slot: 1 | 2 | 3;
  /** 官方词条名 */
  name: string;
  /** 官方文案（原样，供 UI tooltip） */
  desc: string;
  /** 官方数值：slot1/2 = 每次强化增量，slot3 = 固定值 */
  value: number;
  unit: 'percent' | 'point';
  /** desc 中出现的全部数字（按出现顺序），特殊效果（回合数 / 次数 / 距离）按需取用 */
  numbers: number[];
}

export interface TreasureDef {
  id: number;
  name: string;
  type: TreasureType;
  /** 立绘 / 图标（public/gears） */
  image: string;
  icon: string;
  /** 锻造词条组（1~11；12 = 内政，已剔除） */
  affixGroup: number;
  /** 本宝物**可锻造出**的词条名（6~7 条，官方数据） */
  affixPool: string[];
  /** 自带特效（1~3 条，slot 升序） */
  effects: TreasureEffectDef[];
}

/** 锻造词条（跨宝物按名去重） */
export interface AffixDef {
  name: string;
  /** 官方文案（含 \`#min~max#\` 区间标记） */
  desc: string;
  /** 官方区间：玩家可选数值范围 */
  min: number;
  max: number;
  unit: 'percent' | 'point' | 'round' | 'count';
  /** 蓝/粉/红颜色提示（社区档位表；仅 UI，不限制取值） */
  hint: { blueMax: number; pinkMin: number; pinkMax: number; red: number | null } | null;
}

/** 宝物默认等级（用户口径：默认按 10 级满强化） */
export const TREASURE_LEVEL_DEFAULT = 10;
/** 默认 10 级下各阶特效的强化次数：一阶 5 次（1→5 级）、二阶 5 次（5→10 级）、三阶固定 */
export const TREASURE_SLOT_STEPS: Record<1 | 2 | 3, number> = { 1: 5, 2: 5, 3: 0 };

export const TREASURES: TreasureDef[] = ${lit(treasures)};

export const TREASURES_BY_ID: Record<number, TreasureDef> = Object.fromEntries(
  TREASURES.map((t) => [t.id, t]),
);

/** 锻造词条表（按名索引） */
export const AFFIXES: Record<string, AffixDef> = ${lit(Object.fromEntries(affixes.map((a) => [a.name, a])))};

/** 12 组词条池（组号 → 词条名） */
export const AFFIX_GROUPS: Record<number, string[]> = ${lit(Object.fromEntries(groups.map((g) => [g.groupId, g.affixes])))};

/** 该宝物在当前等级下每条自带特效的最终数值（slot1/2 随强化次数线性增长，slot3 固定） */
export function treasureEffectValue(effect: TreasureEffectDef, level: number = TREASURE_LEVEL_DEFAULT): number {
  const step = Math.min(TREASURE_SLOT_STEPS[effect.slot], Math.max(0, level - (effect.slot === 1 ? 0 : 5)));
  const n = effect.slot === 3 ? 1 : Math.min(step, TREASURE_SLOT_STEPS[effect.slot]);
  return Number((effect.value * n).toFixed(4));
}

/** 按 id 取宝物（未知 id 返回 undefined） */
export function getTreasure(id: number): TreasureDef | undefined {
  return TREASURES_BY_ID[id];
}
`);

const out = path.join(root, 'src/data/treasures.ts');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n'));
console.log(
  `wrote src/data/treasures.ts：宝物 ${treasures.length} 件，词条 ${affixes.length} 条，组 ${groups.length} 个` +
    (missingHint.length ? `（无色提示 ${missingHint.length}）` : ''),
);
