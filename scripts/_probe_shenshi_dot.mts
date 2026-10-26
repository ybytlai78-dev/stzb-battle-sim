/**
 * 端到端取证（2026-10-26）：审时定计（XP程昱）对谋略 DoT 的施加前增伤
 *
 * 报障（用户原话）：「庞统 程昱组队时，庞统施加 dot 负面前没有正确施加程昱增伤，
 * 导致 dot 吃不到程昱审时定计的增伤」。
 *
 * 阵容（双方各 3 人，40 级 / 9000 兵）：
 *   A 臂：大营 庞统 h477（【密谋定蜀】）+ 中军 XP程昱 h787（【审时定计】）+ 前锋裸将 h24
 *   B 臂：把中军换成裸将 h24，其余完全不动（单变量对照）
 *   敌方：三名裸将（只留普攻）
 *
 * 断言：
 *   A1 程昱臂出现【审时定计】的 skill_trigger，且有 success = true
 *   A2 对照臂 0 条（不会凭空触发）
 *   A3 庞统的 DoT 跳伤里，`modifiers.taken` 归因点名 shenshi_dingji（真吃到了这层增伤）
 *   A4 程昱臂「每跳平均伤害」高于对照臂 —— +30% taken 落在冻结值里
 *
 * 用法：npx tsx scripts/_probe_shenshi_dot.mts [局数]
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

const RUNS = Number(process.argv[2] ?? 20);

function mk(id: string, position: General['position']): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const g = {
    ...leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000),
    position,
    morale: 100,
  } as General;
  g.activeSkillIds = [];
  g.passiveSkillIds = [];
  g.pursuitSkillIds = [];
  g.commandSkillIds = [];
  delete g.mainSkillId;
  return g;
}

function buildMy(withChengyu: boolean): General[] {
  const pangtong = mk('h477', '大营');
  pangtong.mainSkillId = 'mimou_dingshu';
  pangtong.activeSkillIds = ['mimou_dingshu'];

  const mid = withChengyu ? mk('h787', '中军') : mk('h24', '中军');
  if (withChengyu) {
    mid.mainSkillId = 'shenshi_dingji';
    mid.commandSkillIds = ['shenshi_dingji'];
  }

  const front = mk('h24', '前锋');
  return [pangtong, mid, front];
}

function buildEnemies(): General[] {
  return (['h23', 'h790', 'h769'] as const).map((id, i) => mk(id, (['大营', '中军', '前锋'] as const)[i]));
}

interface Tally {
  triggers: number;
  success: number;
  dotTicks: number;
  dotDamage: number;
  dotWithShenshi: number;
}

function runOne(withChengyu: boolean, seed: number): Tally {
  const myTeam = buildMy(withChengyu);
  const pangTongId = myTeam[0].id;
  const report = runBattle({ myTeam, enemyTeam: buildEnemies(), seed, maxRounds: 8 });
  const t: Tally = { triggers: 0, success: 0, dotTicks: 0, dotDamage: 0, dotWithShenshi: 0 };
  for (const ev of report.events as any[]) {
    if (ev.type === 'skill_trigger' && ev.skillId === 'shenshi_dingji') {
      t.triggers += 1;
      if (ev.success) t.success += 1;
    }
    if (ev.type === 'dot_tick' && (ev.casterId ?? ev.sourceId) === pangTongId) {
      t.dotTicks += 1;
      t.dotDamage += ev.damage;
      const taken = (ev.modifiers?.taken ?? []) as Array<{ skillId?: string }>;
      if (taken.some((m) => m.skillId === 'shenshi_dingji')) t.dotWithShenshi += 1;
    }
  }
  return t;
}

const acc = (): Tally => ({ triggers: 0, success: 0, dotTicks: 0, dotDamage: 0, dotWithShenshi: 0 });
const withT = acc();
const withoutT = acc();
for (let i = 0; i < RUNS; i += 1) {
  const seed = 2001 + i;
  for (const [target, flag] of [[withT, true], [withoutT, false]] as const) {
    const r = runOne(flag, seed);
    target.triggers += r.triggers;
    target.success += r.success;
    target.dotTicks += r.dotTicks;
    target.dotDamage += r.dotDamage;
    target.dotWithShenshi += r.dotWithShenshi;
  }
}

const avg = (t: Tally): number => (t.dotTicks ? t.dotDamage / t.dotTicks : 0);
const line = (label: string, t: Tally): string =>
  `${label}｜审时定计判定 ${t.triggers} 次（成功 ${t.success}）｜庞统 DoT 跳伤 ${t.dotTicks} 次 / 总伤 ${t.dotDamage}` +
  `｜每跳均值 ${avg(t).toFixed(1)}｜带 shenshi 归因 ${t.dotWithShenshi}`;

console.log(line('A 庞统 + 程昱', withT));
console.log(line('B 庞统 + 裸将（对照）', withoutT));
const ratio = avg(withoutT) > 0 ? avg(withT) / avg(withoutT) : 0;
console.log(`每跳伤害比 A/B = ${ratio.toFixed(3)}`);

const checks: [string, boolean, string][] = [
  ['A1 程昱臂确实掷了审时定计且有成功', withT.triggers > 0 && withT.success > 0, `${withT.triggers} 次 / 成功 ${withT.success}`],
  ['A2 对照臂零触发', withoutT.triggers === 0, `${withoutT.triggers} 次`],
  ['A3 DoT 冻结归因点名 shenshi_dingji', withT.dotWithShenshi > 0, `${withT.dotWithShenshi} 条跳伤`],
  ['A4 程昱臂每跳伤害高于对照', avg(withT) > avg(withoutT), `${avg(withT).toFixed(1)} vs ${avg(withoutT).toFixed(1)}`],
];

let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}（${detail}）`);
}
process.exit(failed === 0 ? 0 : 1);
