import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const n = process.argv[2];
if (!n) {
  console.error('usage: extract-brief.mjs TASK_NUMBER');
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const plan = readFileSync(join(root, 'docs/superpowers/plans/2026-08-25-部队加成.md'), 'utf8');
const fence = '```';
let infence = false;
let intask = false;
const out = [];
const startRe = new RegExp(`^#+\\s+Task\\s+${n}([^0-9]|$)`);
const anyTask = /^#+\s+Task\s+\d+/;
for (const line of plan.split(/\n/)) {
  if (line.startsWith(fence)) infence = !infence;
  if (!infence && anyTask.test(line)) intask = startRe.test(line);
  if (intask) out.push(line);
}
const dest = join(dirname(fileURLToPath(import.meta.url)), `task-${n}-brief.md`);
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, out.join('\n'));
console.log(`wrote ${dest}: ${out.length} lines`);
