/**
 * 反向审计：官方文案声明「受X属性影响」，但数据里没有任何缩放标记（xxxScaled / growthRate）。
 *
 * 前向审计（`_audit_scaled_no_growth.mts`）只查「有 Scaled 缺 growthRate」；
 * 本脚本查另一种缺口：文案说受属性影响、数据却整段没挂 → 引擎按固定值算（用户报障同型）。
 *
 * 跑法：npx tsx scripts/_audit_desc_vs_growth.mts
 */
import { readFileSync } from 'node:fs';
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

const desc: Record<string, { name: string; desc: string; desc1: string }> = JSON.parse(
  readFileSync('web/data/skill_desc.json', 'utf8')
);

const CLAIM = /受(攻击|谋略|防御|速度)属性影响/;

function hasScaled(node: unknown, depth = 0): boolean {
  if (depth > 8 || node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((v) => hasScaled(v, depth + 1));
  const obj = node as Record<string, unknown>;
  if (SCALED_KEYS.some((k) => obj[k] === true)) return true;
  // 缩放可能是「另一套字段名」：healGrowthRate（皇裔流离）/ ignoreStrategyGrowthRate（未雨绸缪）
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && /Growth(Rate)?$/i.test(k)) return true;
  }
  return Object.values(obj).some((v) => hasScaled(v, depth + 1));
}

const byName = new Map<string, Skill>();
for (const skill of Object.values(SKILL_REGISTRY)) byName.set(skill.name, skill);

type Row = { id: string; where: string; claimed: string; skillId: string };
const missing: Row[] = [];
const ok: string[] = [];
const noSkill: string[] = [];

for (const [id, entry] of Object.entries(desc)) {
  const text = `${entry.desc ?? ''} ${entry.desc1 ?? ''}`;
  const m = CLAIM.exec(text);
  if (!m) continue;
  const skill = byName.get(entry.name);
  if (!skill) {
    noSkill.push(`${entry.name}(${id})`);
    continue;
  }
  if (hasScaled(skill)) ok.push(entry.name);
  else missing.push({ id, where: entry.name, claimed: m[1], skillId: skill.id });
}

console.log(`\n=== 文案声称受属性影响、但数据无任何缩放 ===`);
if (missing.length === 0) console.log('（无缺口）');
for (const r of missing) console.log(`  ${r.where}（${r.skillId} / descId ${r.id}）声称受${r.claimed}影响，但无 Scaled/growthRate`);
console.log(`\n已正确挂载：${ok.length} 个`);
console.log(`未在 SKILL_REGISTRY（多为未实现/下架）：${noSkill.length} 个`);
if (noSkill.length) console.log(`  ${noSkill.join('、')}`);
