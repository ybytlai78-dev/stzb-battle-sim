/**
 * 导出**真实引擎**的一条战报（含「首次发动也带无视谋略」与「再次发动也带」两种伤害行），
 * 供 `_shot_weiyu.mjs` 注入页面做视觉复核（区别于合成事件：这条完全来自 runBattle）。
 *
 * 用法：npx tsx scripts/_dump_weiyu_report.mts [out.json]
 */
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? path.resolve('docs/逆向对拍/baseline/weiyu-real.json');
const HEROES = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as any[];

function heroById(id: string, position: General['position'], skills: string[]): General {
  const h = HEROES.find((x) => x.id === id);
  if (!h) throw new Error('hero not found: ' + id);
  return {
    id: h.id,
    name: h.name,
    rarity: h.rarity,
    cost: h.cost,
    faction: h.faction,
    tags: h.tags ?? [],
    mutualExclusionGroup: h.mutualExclusionGroup ?? null,
    troopType: h.troopType,
    position,
    attack: Math.round(h.baseAttack + 39 * h.growthAttack),
    defense: Math.round(h.baseDefense + 39 * h.growthDefense),
    strategy: Math.round(h.baseStrategy + 39 * h.growthStrategy),
    speed: Math.round(h.baseSpeed + 39 * h.growthSpeed),
    attackRange: h.attackRange,
    maxTroops: 9000,
    mainSkillId: h.mainSkillId,
    mainSkillName: h.mainSkillName ?? '',
    skillDesc: '',
    activeSkillIds: h.mainSkillId ? [h.mainSkillId, ...skills] : skills,
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  } as General;
}

let picked: { report: any; seed: number } | null = null;
for (let seed = 1; seed <= 40 && !picked; seed++) {
  const my = [
    heroById('h841', '大营', ['weiyu_choumou']),
    heroById('h742', '中军', []),
    heroById('h16', '前锋', []),
  ];
  const enemy = [heroById('h815', '大营', []), heroById('h34', '中军', []), heroById('h634', '前锋', [])];
  const report = runBattle({ myTeam: my, enemyTeam: enemy, maxRounds: 8, seed });
  const isRecast = new Map<string, boolean>();
  let firstIgnore = false;
  let recastIgnore = false;
  for (const ev of report.events) {
    if (ev.type === 'skill_cast') {
      isRecast.set(ev.skillId, !!ev.recastBy);
      continue;
    }
    if (ev.type !== 'damage' || ev.damageType !== 'strategy' || !ev.ignoreStrategy) continue;
    if (isRecast.get(ev.skillId)) recastIgnore = true;
    else firstIgnore = true;
  }
  if (firstIgnore && recastIgnore) picked = { report: report as any, seed };
}
if (!picked) throw new Error('40 局里没有同时出现「首次带 ignore」与「再发动带 ignore」的战报');

const r = picked.report;
const record = {
  id: 'real_weiyu_' + picked.seed,
  ts: Date.now(),
  label: '未雨绸缪 · 真实引擎（seed ' + picked.seed + '）',
  result: r.result,
  rounds: r.rounds,
  seed: picked.seed,
  myTeam: (r.myTeam as General[]).map((g) => g.name),
  enemyTeam: (r.enemyTeam as General[]).map((g) => g.name),
  report: r,
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ record }, null, 1), 'utf8');
console.log('real report →', OUT, '| seed', picked.seed, '| events', r.events.length);
