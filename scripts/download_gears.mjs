/**
 * 下载《率土之滨》官网宝物图片（网易官方 CDN），输出到 public/gears/
 *   立绘（150×240）：.../gears/watermark/gear_watermark_{id}.jpg?gameid=g10 → public/gears/gear_{id}.jpg
 *   图标（100×100）：.../gears/gear_icon/gear_icon_{id}.jpg?gameid=g10      → public/gears/gear_{id}_s.jpg
 *
 * 数据来源：dateyuan/宝物数据.json（由 scripts/fetch_gear_data.mjs 抓取）
 * 默认只下【稀世】38 件；`node scripts/download_gears.mjs --all` 下全部 114 件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'dateyuan/宝物数据.json'), 'utf8'));
const outDir = path.join(root, 'public/gears');
fs.mkdirSync(outDir, { recursive: true });

const all = process.argv.includes('--all');
const targets = data.treasures.filter((t) => all || t.quality === '稀世');

async function tryGet(url, outPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  // JPEG/PNG magic 校验
  const magicOk = (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50);
  if (!magicOk || buf.length < 1024) return false;
  fs.writeFileSync(outPath, buf);
  return true;
}

const failures = [];
let idx = 0;
async function worker() {
  while (idx < targets.length) {
    const t = targets[idx++];
    const okImg = await tryGet(t.imageUrl, path.join(outDir, `gear_${t.id}.jpg`));
    const okIcon = await tryGet(t.iconUrl, path.join(outDir, `gear_${t.id}_s.jpg`));
    if (!okImg) failures.push(`${t.id} ${t.name}: 立绘获取失败`);
    if (!okIcon) failures.push(`${t.id} ${t.name}: 图标获取失败`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

console.log(`done. ${targets.length} 件（${all ? '全部' : '稀世'}）→ public/gears/`);
console.log('failures:', failures.length);
for (const f of failures) console.log('FAIL:', f);
