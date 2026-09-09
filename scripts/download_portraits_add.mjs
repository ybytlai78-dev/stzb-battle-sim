/**
 * 增量下载 S2 新武将画像/头像（网易官方 CDN），并入 web/data/portraits.json
 * 画像：stzb.res.netease.com .../data/watermark/card_{heroId}.jpg（470×592 官方卡面）
 *       备用：g0.gph.netease.com .../cards/cut/card_medium_{heroId}.jpg
 * 头像：g0.gph.netease.com .../cards/cut/card_small_{heroId}.jpg（98×98 官方头图）
 * 用法：node scripts/download_portraits_add.mjs h479 h477 h480 h476 h478
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const addIds = process.argv.slice(2);
if (addIds.length === 0) {
  console.error('用法：node scripts/download_portraits_add.mjs <ourId...>');
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(path.join(root, 'web/data/portrait_map.json'), 'utf8'));
const manifestPath = path.join(root, 'web/data/portraits.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const outDir = path.join(root, 'public/portraits');
fs.mkdirSync(outDir, { recursive: true });

const CDN = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/cards/cut';
const WM = 'https://stzb.res.netease.com/pc/qt/20170323200251/data/watermark';

async function tryGet(url, outPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  const magicOk =
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    (buf[0] === 0x89 && buf[1] === 0x50) ||
    (buf[0] === 0x47 && buf[1] === 0x49) ||
    (buf[0] === 0x52 && buf[1] === 0x49);
  if (!magicOk || buf.length < 1024) return false;
  fs.writeFileSync(outPath, buf);
  return true;
}

const failures = [];
for (const ourId of addIds) {
  const m = map[ourId];
  if (!m) {
    failures.push(`${ourId}: 无 portrait_map 映射`);
    continue;
  }
  const heroId = m.heroId;
  const pPath = path.join(outDir, `${ourId}.jpg`);
  const aPath = path.join(outDir, `${ourId}_s.jpg`);

  let ok = await tryGet(`${WM}/card_${heroId}.jpg`, pPath);
  if (!ok) ok = await tryGet(`${CDN}/card_medium_${heroId}.jpg?gameid=g10`, pPath);
  if (!ok) ok = await tryGet(`${CDN}/card_small_${heroId}.jpg?gameid=g10`, pPath);

  const aOk = await tryGet(`${CDN}/card_small_${heroId}.jpg?gameid=g10`, aPath);

  manifest[ourId] = {
    heroId,
    officialName: m.officialName,
    note: m.note,
    portrait: ok ? `/portraits/${ourId}.jpg` : null,
    avatar: aOk ? `/portraits/${ourId}_s.jpg` : null,
  };
  console.log(`${ourId} ${m.officialName}: portrait=${ok ? 'OK' : 'FAIL'} avatar=${aOk ? 'OK' : 'FAIL'}`);
  if (!ok) failures.push(`${ourId} ${m.officialName}: 画像获取失败`);
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`done. manifest keys: ${Object.keys(manifest).length}`);
if (failures.length) for (const f of failures) console.log('FAIL:', f);
