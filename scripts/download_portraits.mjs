/**
 * 下载全部武将画像/头像（网易官方 CDN），输出到 public/portraits/
 * 画像：stzb.res.netease.com .../data/watermark/card_{heroId}.jpg（470×592 官方卡面）
 *       备用：g0.gph.netease.com .../cards/cut/card_medium_{heroId}.jpg
 * 头像：g0.gph.netease.com .../cards/cut/card_small_{heroId}.jpg（98×98 官方头图）
 * 输出：public/portraits/{ourId}.jpg + {ourId}_s.jpg，以及 web/data/portraits.json 清单
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const map = JSON.parse(fs.readFileSync(path.join(root, 'web/data/portrait_map.json'), 'utf8'));
const outDir = path.join(root, 'public/portraits');
fs.mkdirSync(outDir, { recursive: true });

const CDN = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/cards/cut';
const WM = 'https://stzb.res.netease.com/pc/qt/20170323200251/data/watermark';

async function tryGet(url, outPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  // JPEG/PNG magic 校验
  const magicOk =
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    (buf[0] === 0x89 && buf[1] === 0x50) ||
    (buf[0] === 0x47 && buf[1] === 0x49) ||
    (buf[0] === 0x52 && buf[1] === 0x49);
  if (!magicOk || buf.length < 1024) return false;
  fs.writeFileSync(outPath, buf);
  return true;
}

const manifest = {};
const failures = [];
const entries = Object.entries(map);

const poolSize = 8;
let idx = 0;
async function worker() {
  while (idx < entries.length) {
    const i = idx++;
    const [ourId, m] = entries[i];
    const heroId = m.heroId;
    const pPath = path.join(outDir, `${ourId}.jpg`);
    const aPath = path.join(outDir, `${ourId}_s.jpg`);
    const rec = { heroId, officialName: m.officialName, note: m.note };

    // 画像
    let ok = await tryGet(`${WM}/card_${heroId}.jpg`, pPath);
    if (!ok) ok = await tryGet(`${CDN}/card_medium_${heroId}.jpg?gameid=g10`, pPath);
    if (!ok) ok = await tryGet(`${CDN}/card_small_${heroId}.jpg?gameid=g10`, pPath);
    rec.portrait = ok ? `/portraits/${ourId}.jpg` : null;
    if (!ok) failures.push(`${ourId} ${m.officialName}: 画像获取失败`);

    // 头像（可选）
    const aOk = await tryGet(`${CDN}/card_small_${heroId}.jpg?gameid=g10`, aPath);
    rec.avatar = aOk ? `/portraits/${ourId}_s.jpg` : null;

    manifest[ourId] = rec;
    if (idx % 20 === 0) console.log(`progress ${idx}/${entries.length}`);
  }
}

await Promise.all(Array.from({ length: poolSize }, worker));

fs.writeFileSync(path.join(root, 'web/data/portraits.json'), JSON.stringify(manifest, null, 2));
console.log('done. failures:', failures.length);
for (const f of failures) console.log('FAIL:', f);
const noAvatar = Object.entries(manifest).filter(([, v]) => !v.avatar).map(([k]) => k);
console.log('no avatar (will CSS-crop):', noAvatar.join(', '));
