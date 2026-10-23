/**
 * 未雨绸缪「无视 X% 谋略」两趟注入的端到端验证（真实 runBattle，40 局）。
 *
 * 断言：
 *  ① **本次发动**（skill_cast 无 recastBy）那一组策略伤害也带 `ignoreStrategy`；
 *  ② **再次发动**（skill_cast 带 recastBy）那一组同样带；
 *  ③ 比例只取一份（同局内出现的 pct 值不做加算，不会出现 32+32=64）；
 *  ④ ignoreStrategy 的来源恒为未雨绸缪（不串到别的战法）。
 *
 * 用法：npx tsx scripts/_verify_weiyu_ignore.mts
 */
import { runBattle } from '../src/engine/combat';
import { reportToText } from '../src/engine/report';
import type { General } from '../src/engine/types';
import { readFileSync } from 'node:fs';

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

type Bucket = { dmg: number; ign: number };
const first: Bucket = { dmg: 0, ign: 0 };
const recast: Bucket = { dmg: 0, ign: 0 };
const pcts = new Set<number>();
const sources = new Set<string>();
const noIgnore = new Map<string, number>();
let sample = '';
let recastSample = '';

const runs = 40;
for (let seed = 1; seed <= runs; seed++) {
  const my = [
    heroById('h841', '大营', ['weiyu_choumou']),
    heroById('h742', '中军', []),
    heroById('h16', '前锋', []),
  ];
  const enemy = [heroById('h815', '大营', []), heroById('h34', '中军', []), heroById('h634', '前锋', [])];
  const report = runBattle({ myTeam: my, enemyTeam: enemy, maxRounds: 8, seed });

  // 事件流按「最近一次同战法 skill_cast」分组：cast → damages → cast(recast) → damages
  const isRecastOf = new Map<string, boolean>();
  let hasFirstIgnoreThisRun = false;
  let hasRecastIgnoreThisRun = false;
  for (const ev of report.events) {
    if (ev.type === 'skill_cast') {
      isRecastOf.set(ev.skillId, !!ev.recastBy);
      continue;
    }
    if (ev.type !== 'damage') continue;
    if (ev.damageType !== 'strategy') continue;
    const inRecast = !!isRecastOf.get(ev.skillId);
    const bucket = inRecast ? recast : first;
    bucket.dmg++;
    if (!ev.ignoreStrategy) {
      const key = `${inRecast ? 'recast' : 'first'}:${ev.skillName}${ev.subSkill ? '/' + ev.subSkill : ''}`;
      noIgnore.set(key, (noIgnore.get(key) ?? 0) + 1);
    }
    if (ev.ignoreStrategy) {
      bucket.ign++;
      pcts.add(ev.ignoreStrategy.pct);
      sources.add(ev.ignoreStrategy.skillId);
      if (isRecastOf.get(ev.skillId)) hasRecastIgnoreThisRun = true;
      else hasFirstIgnoreThisRun = true;
    }
  }
  if (!sample && hasFirstIgnoreThisRun) sample = reportToText(report);
  if (!recastSample && hasRecastIgnoreThisRun) recastSample = reportToText(report);
}

const out = {
  runs,
  first: { ...first, rate: first.dmg ? +(first.ign / first.dmg).toFixed(3) : 0 },
  recast: { ...recast, rate: recast.dmg ? +(recast.ign / recast.dmg).toFixed(3) : 0 },
  pcts: [...pcts].sort((a, b) => a - b),
  sources: [...sources],
  noIgnoreTop: Object.fromEntries([...noIgnore].sort((a, b) => b[1] - a[1]).slice(0, 10)),
};
console.log(JSON.stringify(out, null, 1));

const fail: string[] = [];
if (first.ign <= 0) fail.push('本次发动的策略伤害没有一条带 ignoreStrategy');
if (recast.ign <= 0) fail.push('再次发动的策略伤害没有一条带 ignoreStrategy');
if (sources.size !== 1 || !sources.has('weiyu_choumou')) fail.push('ignoreStrategy 来源串到了别的战法: ' + [...sources]);
// 同一武将同一时刻只该有一份比例；加算会产出 64 这类值（32×2），也绝不出现被缩放的 15/16
if ([...pcts].some((p) => p > 60)) fail.push('出现疑似叠加的比例: ' + [...pcts].join(','));

console.log(fail.length ? '❌ FAIL\n- ' + fail.join('\n- ') : '✅ PASS：本次发动与再次发动都带无视谋略，且比例单一来源');

for (const [label, text] of [
  ['本次发动', sample],
  ['再次发动', recastSample],
] as const) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes('无视目标'));
  if (idx >= 0) {
    console.log(`\n── ${label}片段 ──`);
    console.log(lines.slice(Math.max(0, idx - 2), idx + 2).join('\n'));
  }
}
if (fail.length) process.exitCode = 1;
