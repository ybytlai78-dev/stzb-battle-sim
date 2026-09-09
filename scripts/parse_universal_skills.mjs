/**
 * 解析 dateyuan/通用战法调研.md 战法总表 → scripts/_universal_skills.json
 * 运行：node scripts/parse_universal_skills.mjs
 * 输出：{ name, quality, type, range, triggerRate, targetDesc, effectDesc, sources }
 * 用于：机制匹配判断 + skills 表灌入
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(__dirname, '../dateyuan/通用战法调研.md'), 'utf8');

const TYPE_MAP = { 指挥: 'command', 主动: 'active', 被动: 'passive', 追击: 'pursuit' };

const skills = [];
for (const line of md.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cols = line.split('|').map((s) => s.trim());
  // 格式：| 名称 | 级别 | 类型 | 距离 | 发动率 | 目标 | 满级效果 | 拆解来源 |
  const name = cols[1];
  const quality = cols[2];
  const type = cols[3];
  const range = cols[4];
  const rate = cols[5];
  const target = cols[6];
  const effect = cols[7];
  const source = cols[8] ?? '';
  if (!name || !TYPE_MAP[type]) continue;
  skills.push({
    name,
    quality,
    type: TYPE_MAP[type],
    range: range === '—' ? null : Number(range),
    triggerRate: rate === '—' ? null : rate,
    targetDesc: target,
    effectDesc: effect,
    sources: source,
  });
}

writeFileSync(join(__dirname, '_universal_skills.json'), JSON.stringify(skills, null, 2), 'utf8');
console.log(`已解析 ${skills.length} 个通用战法 → scripts/_universal_skills.json`);
console.log('类型分布:', Object.entries(
  skills.reduce((a, s) => ((a[s.type] = (a[s.type] ?? 0) + 1), a), {})
).map(([k, v]) => `${k}:${v}`).join('  '));
