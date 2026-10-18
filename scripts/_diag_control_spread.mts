/**
 * 端到端取证（2026-10-18）：鸾凤和鸣「控制效果 +1 目标」（control_spread）
 *
 * 用户报障（截图 + 原话）：「小乔给队友的状态没有正确生效，控制目标为加一」
 * 截图现场：第 7 回合【小乔&大乔】发动【双艳】，目标：贾诩、荀彧；紧接着「小乔&大乔 的 control_spread 状态解除」，
 *          两条暴走 War 报都没有 —— 状态被消耗了，玩家看不到任何「+1」。
 *
 * 构造：我方 = 小乔(h687, 主战法 鸾凤和鸣, 大营) + 小乔&大乔(h424, 主战法 双艳, 中军) + 裸将(前锋)；
 *       敌方 = 贾诩(h794, 大营) / 荀彧(h24, 中军) / 曹操(h23, 前锋)。本局唯一的控制来源 = 双艳的暴走。
 *
 * 用法：
 *   npx tsx scripts/_diag_control_spread.mts             # 10 局统计（+1 是否每次都到手）
 *   npx tsx scripts/_diag_control_spread.mts 30           # 30 局
 *   npx tsx scripts/_diag_control_spread.mts dump 1       # 打印第 1 局战报里所有双艳/暴走/扩散相关行
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { renderEventLines } from '../src/engine/report';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

function make(id: string, position: General['position']): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  return { ...base, position, morale: 120 } as General;
}

const red: General[] = [make('h687', '大营'), make('h424', '中军'), make('h799', '前锋')];
const blue: General[] = [make('h794', '大营'), make('h24', '中军'), make('h23', '前锋')];
const blueIds = new Set(blue.map((g) => g.id));
const CONTROL = new Set(['confusion', 'hesitation', 'rampage', 'cowardice']);

interface CastRec {
  round: number;
  hadSpread: boolean;
  pool: string[];
  extra?: string;
  extraKind?: 'new' | 'refresh';
  consumed: boolean;
  aliveEnemies: number;
}

function castsOf(seed: number): CastRec[] {
  const report = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });
  const events = report.events as any[];
  const out: CastRec[] = [];
  const holder = new Set<string>();
  let cur: CastRec | null = null;
  let round = 0;
  for (const ev of events) {
    if (ev.type === 'round_start') round = ev.round;
    if (ev.type === 'status_inflicted' && ev.statusType === 'control_spread') {
      holder.add(ev.unitId);
      continue;
    }
    if (ev.type === 'skill_target' && ev.skillId === 'shuangyan') {
      if (cur) cur.pool = ev.targetIds ?? [];
      continue;
    }
    if (ev.type === 'skill_cast' && ev.skillId === 'shuangyan') {
      if (cur) out.push(cur);
      cur = { round, hadSpread: holder.has(ev.unitId), pool: [], consumed: false, aliveEnemies: 3 };
      continue;
    }
    if (ev.type === 'status_changed' && cur) {
      cur.extra = ev.unitId;
      cur.extraKind = ev.detail.includes('刷新') ? 'refresh' : 'new';
      continue;
    }
    if (ev.type === 'status_expired' && ev.statusType === 'control_spread' && cur) {
      holder.delete(ev.unitId);
      cur.consumed = true;
      continue;
    }
    if (ev.type === 'unit_died' && blueIds.has(ev.unitId)) {
      if (cur) cur.aliveEnemies -= 1;
    }
  }
  if (cur) out.push(cur);
  return out;
}

if (process.argv[2] === 'dump') {
  const seed = Number(process.argv[3] ?? 1);
  const report = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });
  let round = 0;
  for (const ev of report.events as any[]) {
    if (ev.type === 'round_start') round = ev.round;
    const isSpreadish =
      ev.skillId === 'shuangyan' ||
      ev.skillId === 'luanfeng_heming' ||
      ev.type === 'status_changed' ||
      (ev.type === 'status_inflicted' && (CONTROL.has(ev.statusType) || ev.statusType === 'control_spread')) ||
      (ev.type === 'status_expired' && ev.statusType === 'control_spread');
    if (!isSpreadish) continue;
    for (const line of renderEventLines(ev)) console.log(`[R${round}] ${line}`);
  }
  process.exit(0);
}

const runs = Number(process.argv[2] ?? 10);
let spreadCasts = 0;
let plusOne = 0;
let wasted = 0;
let refreshed = 0;
for (let seed = 1; seed <= runs; seed++) {
  const recs = castsOf(seed);
  const lines: string[] = [];
  for (const c of recs) {
    const tags = [`R${c.round}`, c.hadSpread ? '标记' : '无标记', `本段${c.pool.length}目标`];
    if (c.extra) tags.push(`额外→${c.extra}(${c.extraKind === 'new' ? '新增' : '刷新'})`);
    tags.push(c.consumed ? '已消耗' : '保留');
    lines.push(tags.join(' '));
    if (!c.hadSpread) continue;
    spreadCasts += 1;
    if (c.extraKind === 'new') plusOne += 1;
    else if (c.extraKind === 'refresh') refreshed += 1;
    else if (c.aliveEnemies > c.pool.length) {
      wasted += 1;
      lines.push(`   ⚠ 有标记却未加目标（场上存活 ${c.aliveEnemies} > 本段 ${c.pool.length}）`);
    }
  }
  console.log(`seed ${String(seed).padStart(3)} · ${recs.length} 次双艳`);
  for (const l of lines) console.log(`   ${l}`);
}
console.log(
  `\n带标记的双艳发动 ${spreadCasts} 次：+1 新增目标 ${plusOne} 次、额外目标本已受控(刷新) ${refreshed} 次、` +
    `应当加却没加 ${wasted} 次`
);
process.exit(wasted === 0 ? 0 : 1);
