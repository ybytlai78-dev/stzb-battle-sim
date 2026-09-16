import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const dest = process.argv[2];
const title = process.argv[3];
const files = process.argv.slice(4);
const tracked = [];
const untracked = [];
for (const f of files) {
  try {
    execSync(`git ls-files --error-unmatch -- ${f}`, { stdio: 'ignore' });
    tracked.push(f);
  } catch {
    untracked.push(f);
  }
}
const stat = tracked.length
  ? execSync(`git diff --stat HEAD -- ${tracked.join(' ')}`, { encoding: 'utf8' })
  : '';
const diff = tracked.length
  ? execSync(`git diff -U10 HEAD -- ${tracked.join(' ')}`, { encoding: 'utf8' })
  : '';
const parts = [
  `# ${title}`,
  '**Base:** e16ca80 (working tree; no commit)',
  '**Head:** working tree',
  '',
  '## Commits',
  '(none)',
  '',
  '## Diff stat',
  '',
  stat || '(no tracked-file diff)',
];
if (untracked.length) {
  parts.push('', '## Untracked files', '');
  for (const f of untracked) {
    parts.push(`### ${f}`, '', '```', readFileSync(f, 'utf8'), '```', '');
  }
}
parts.push('## Full diff (tracked)', '', '```diff', diff, '```', '');
writeFileSync(dest, parts.join('\n'));
console.log('wrote', dest);
