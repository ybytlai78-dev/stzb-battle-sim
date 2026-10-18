import { readFileSync } from 'node:fs';
import { buildAllFixtures } from '../tests/fixtures';
import { runBattle } from '../src/engine/combat';
import { initHeroDB } from '../src/data/heroes';

await initHeroDB();
const cases = buildAllFixtures();
const stored = JSON.parse(readFileSync('tests/__snapshots__/golden.json', 'utf8'));
const current = {
  generatedAt: 'seed-locked',
  suites: Object.entries(cases).map(([name, config]) => {
    const r = runBattle(config);
    return {
      name, seed: r.seed, result: r.result, rounds: r.rounds,
      finalMyTroops: r.finalMyTroops, finalEnemyTroops: r.finalEnemyTroops,
      eventCount: r.events.length, events: r.events,
    };
  }),
};
const diffs: string[] = [];
function walk(a: any, b: any, path: string) {
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { diffs.push(`${path}: ${JSON.stringify(b)?.slice(0,80)} → ${JSON.stringify(a)?.slice(0,80)}`); return; }
  if (Array.isArray(a) !== Array.isArray(b)) { diffs.push(`${path}: type change`); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) diffs.push(`${path}: length ${b.length} → ${a.length}`);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) walk(a[i], b[i], `${path}[${i}]`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) walk(a[k], b[k], `${path}.${k}`);
}
walk(current, stored, 'golden');
console.log(`diff 叶子数 ${diffs.length}`);
const byKind = new Map<string, number>();
for (const d of diffs) {
  const key = d.replace(/\[\d+\]/g, '[]').replace(/\.(detail|statusType|type|unitId|round|targetId|skillId)$/, '.$1');
  byKind.set(key, (byKind.get(key) ?? 0) + 1);
}
for (const [k, v] of [...byKind.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(v, k);
console.log('--- 前 10 条 ---');
for (const d of diffs.slice(0, 10)) console.log(d.slice(0, 200));
