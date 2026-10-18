/**
 * 探针：控制类「同源重挂 = 刷新 remaining」到底有多大影响（2026-10-19）
 *
 * 背景：公告 v1.12 里写了「控制类重复施加时，战报会显示『暴走持续 2 回合（刷新）』」，
 * 用户追问「包内状态类不是不可叠加吗，也就是冲突无法生效」——即按 replace_type=3
 * （不叠加 · 先施加者生效），同一控制的第二次施加应当**完全无效**（连时长都不该延长）。
 *
 * 本脚本量化「同源刷新」的规模：同一战法连续命中同一目标时，有多少次是**刷新**而非**新增**。
 * 用法：npx tsx scripts/_diag_control_refresh.mts [局数]
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
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

const CONTROL = new Set(['confusion', 'hesitation', 'rampage', 'cowardice']);

const runs = Number(process.argv[2] ?? 20);
let casts = 0;
let fresh = 0;
let refresh = 0;
let conflict = 0;
const perRound = new Map<number, number>();

for (let seed = 1; seed <= runs; seed++) {
  const red: General[] = [make('h424', '中军'), make('h799', '大营'), make('h807', '前锋')];
  const blue: General[] = [make('h794', '大营'), make('h24', '中军'), make('h23', '前锋')];
  const report = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });
  let round = 0;
  for (const ev of report.events) {
    if (ev.type === 'round_start') round = ev.round;
    if (ev.type === 'skill_cast' && ev.skillId === 'shuangyan') casts++;
    if (ev.type === 'status_inflicted' && CONTROL.has(ev.statusType as string)) {
      const isRefresh = /（刷新）/.test(ev.detail);
      if (isRefresh) {
        refresh++;
        perRound.set(round, (perRound.get(round) ?? 0) + 1);
      } else fresh++;
    }
    if (ev.type === 'status_conflict') conflict++;
  }
}

console.log(`局数=${runs}`);
console.log(`双艳发动=${casts}  控制·新增=${fresh}  控制·刷新(同源重挂)=${refresh}  冲突拒绝(异源)=${conflict}`);
console.log(`刷新占控制施加的比例=${refresh + fresh > 0 ? ((refresh / (refresh + fresh)) * 100).toFixed(1) : '0.0'}%`);
const rounds = [...perRound.entries()].sort((a, b) => a[0] - b[0]);
console.log('刷新按回合分布：', rounds.map(([r, n]) => `R${r}:${n}`).join(' ') || '（无）');
