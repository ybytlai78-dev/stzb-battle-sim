// 生成武将名拼音检索表 → web/data/pinyin.json
// 用法：node scripts/gen_pinyin.mjs
//
// 为什么单独生成一份静态表：
//   pinyin-pro 只作为 **devDependency**，不进 App 包；运行时只带这份小 JSON
//   （161 将 ≈ 每将 15 字节，比打包整个拼音库小三个数量级）。
//   ⚠️ 新增武将后要重跑本脚本，否则新将搜不到拼音。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const heroes = JSON.parse(readFileSync(join(ROOT, 'web/data/heroes.json'), 'utf8'));

/** 取名字里的汉字（SP赵云 → 赵云；小乔&大乔 → 小乔大乔） */
const hanzi = (s) => (s.match(/[\u4e00-\u9fa5]/g) ?? []).join('');

const out = {};
for (const h of heroes) {
  const hz = hanzi(h.name);
  if (!hz) continue;
  const f = pinyin(hz, { toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
    .replace(/ü/g, 'v'); // ü → v，便于键盘输入（查询侧同时兼容 u 写法）
  const i = pinyin(hz, { pattern: 'first', type: 'array' }).join('').toLowerCase();
  out[h.id] = { i, f };
}

// 稳定输出（按 id 排序），便于 diff 审查
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(ROOT, 'web/data/pinyin.json'), JSON.stringify(sorted, null, 0) + '\n', 'utf8');
console.log(`已生成 web/data/pinyin.json：${Object.keys(sorted).length} 个武将`);
console.log(`样例：${JSON.stringify(sorted.h101 ?? {})} / h3=${JSON.stringify(sorted.h3 ?? {})}`);
