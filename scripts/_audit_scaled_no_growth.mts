/**
 * 审计：所有「声明了受属性缩放」但**缺 growthRate** 的状态模板。
 *
 * 缩放分支（action.ts `inflictStatus` 内）普遍要求三条件齐备：
 *   type 匹配 + `xxxScaled === true` + `growthRate !== undefined`
 * 缺 growthRate → 落 else 用基值 ⇒ 数值恒定、不随属性增长（始计报障同型）。
 *
 * 跑法：npx tsx scripts/_audit_scaled_no_growth.mts
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import type { Skill } from '../src/engine/types';

const SCALED_KEYS = [
  'strategyScaled',
  'speedScaled',
  'defenseScaled',
  'attackScaled',
  'rateStrategyScaled',
  'rateAttackScaled',
  'chainScaled',
  'reduceDefenseScaled',
  'boostAttackScaled',
];

type Row = { skill: string; id: string; where: string; scaled: string[]; type: string; value: unknown };

const rows: Row[] = [];
const ok: Row[] = [];

function scanStatus(skill: Skill, where: string, st: Record<string, unknown>) {
  const scaled = SCALED_KEYS.filter((k) => st[k] === true);
  if (scaled.length === 0) return;
  const row: Row = {
    skill: skill.name,
    id: skill.id,
    where,
    scaled,
    type: String(st.type),
    value: st.rate ?? st.amount ?? st.value ?? st.perStack,
  };
  if (st.growthRate === undefined) rows.push(row);
  else ok.push(row);
}

/** 在任意嵌套结构里找形如 `{ type: <statusType>, ... }` 的字面量 */
function walk(skill: Skill, where: string, node: unknown, depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(skill, `${where}[${i}]`, v, depth + 1));
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string' && SCALED_KEYS.some((k) => obj[k] === true)) {
    scanStatus(skill, where, obj);
  }
  for (const [k, v] of Object.entries(obj)) {
    walk(skill, `${where}.${k}`, v, depth + 1);
  }
}

for (const skill of Object.values(SKILL_REGISTRY)) {
  walk(skill, 'skill', skill);
}

console.log(`\n=== 缺 growthRate（数值恒定，报障同型）共 ${rows.length} 条 ===`);
for (const r of rows) {
  console.log(`- ${r.skill} (${r.id}) | ${r.type} | 基值 ${r.value} | 缩放 ${r.scaled.join('+')} | ${r.where}`);
}
console.log(`\n=== 已带 growthRate 共 ${ok.length} 条 ===`);
for (const r of ok) {
  console.log(`- ${r.skill} (${r.id}) | ${r.type} | ${r.value} | ${r.scaled.join('+')}`);
}
