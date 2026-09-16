import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const plan = readFileSync(process.argv[2], 'utf8');
const n = process.argv[3];
const lines = plan.split(/\n/);
let infence = false;
let intask = false;
const out = [];
const heading = new RegExp(`^#+\\s+Task\\s+${n}([^0-9]|$)`);
for (const line of lines) {
  if (line.startsWith('```')) infence = !infence;
  if (!infence && /^#+\s+Task\s+\d+/.test(line)) intask = heading.test(line);
  if (intask) out.push(line);
}
mkdirSync('.superpowers/sdd', { recursive: true });
const dest = `.superpowers/sdd/task-${n}-brief.md`;
writeFileSync(dest, out.join('\n'));
console.log(`wrote ${dest}: ${out.length} lines`);
