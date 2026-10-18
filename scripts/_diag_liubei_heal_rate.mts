/**
 * 探针：刘备（皇裔流离=first_aid）对不同伤害类型的恢复触发率
 * 我方 = 黄盖（h783，普攻 + 追击 烈火焚舟），敌方 = 刘备（h16）+ 2 裸将
 * 统计：每次「伤害事件打到刘备」后，同一钩子里是否紧跟一条 first_aid 恢复
 */
import fs from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h: any) => [h.id, h]));

function make(id: string, position: General['position'], opts: { bare?: boolean } = {}): General {
  const rec = byId.get(id);
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  const g: General = { ...base, position } as General;
  if (opts.bare) {
    g.mainSkillId = '';
    g.mainSkillName = '';
    g.activeSkillIds = [];
    g.passiveSkillIds = [];
    g.commandSkillIds = [];
    g.pursuitSkillIds = [];
  }
  return g;
}

const N = Number(process.argv[2] ?? 60);
const DUMP = process.argv[3] === 'dump';

const my = [make('h783', '前锋'), make('h799', '中军', { bare: true }), make('h807', '大营', { bare: true })];
const enemy = [make('h16', '前锋'), make('h24', '中军', { bare: true }), make('h23', '大营', { bare: true })];

const buckets: Record<string, { hits: number; heals: number }> = {};
const bump = (k: string, hit: boolean, heal: boolean) => {
  buckets[k] ??= { hits: 0, heals: 0 };
  if (hit) buckets[k].hits++;
  if (heal) buckets[k].heals++;
};

for (let i = 1; i <= N; i++) {
  const report = runBattle({ seed: 1000 + i, maxRounds: 8, myTeam: my, enemyTeam: enemy });
  const ev = report.events as any[];
  if (DUMP && i === 1) {
    for (const e of ev) {
      if (e.type === 'damage' && e.targetId === 'h16') console.log(`[damage] ${e.skillName ?? e.skillId} type=${e.damageType} ${e.damage}`);
      else if (e.type === 'dot_tick' && e.targetId === 'h16') console.log(`[dot] ${e.skillName ?? e.skillId} ${e.damage}`);
      else if (e.type === 'heal' && e.targetId === 'h16') console.log(`[heal] ${e.skillName ?? e.skillId} +${e.amount}`);
    }
  }
  ev.forEach((e, idx) => {
    const isHit = (e.type === 'damage' || e.type === 'attack_hit' || e.type === 'dot_tick' || e.type === 'split_damage') && e.targetId === 'h16';
    if (!isHit) return;
    const kind = e.type === 'attack_hit' ? '普攻' : e.type === 'dot_tick' ? 'DoT·' + (e.skillName ?? e.skillId) : e.type === 'split_damage' ? '分兵' : '战法·' + (e.skillName ?? e.skillId);
    // 同一钩子内的恢复事件：紧邻的下一条 heal（中间允许夹 status 之类）
    let heal = false;
    for (let j = idx + 1; j < Math.min(idx + 4, ev.length); j++) {
      if (ev[j].type === 'heal' && ev[j].targetId === 'h16' && ev[j].skillId === 'huangyi_liuli') { heal = true; break; }
      if (['damage', 'attack_hit', 'dot_tick', 'split_damage'].includes(ev[j].type)) break;
    }
    bump(kind, true, heal);
  });
  const heals = ev.filter((e) => e.type === 'heal' && e.targetId === 'h16' && e.skillId === 'huangyi_liuli');
  bump('__total_heal_events', false, false);
  buckets.__total_heal_events.heals += heals.length;
}

console.log(`\n样本 ${N} 局（敌方刘备，士气/属性按 level40 默认）`);
console.log('来源'.padEnd(28), '打到刘备次数'.padEnd(12), '触发恢复', '触发率');
for (const [k, v] of Object.entries(buckets)) {
  if (!v.hits) continue;
  console.log(k.padEnd(28), String(v.hits).padEnd(12), String(v.heals).padEnd(8), (v.heals / v.hits).toFixed(3));
}
console.log('单局平均恢复次数 =', (buckets.__total_heal_events.heals / N).toFixed(2));
