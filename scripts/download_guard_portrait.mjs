/**
 * 下载官方「汉·侍卫」卡面/头像，供伤害测试实验室靶子使用。
 * 画像：stzb.res.netease.com .../watermark/card_110311.jpg
 * 头像：g0.gph.netease.com .../card_small_110311.jpg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public/portraits');
fs.mkdirSync(outDir, { recursive: true });

const CDN = 'https://g0.gph.netease.com/ngsocial/community/stzb/cn/cards/cut';
const WM = 'https://stzb.res.netease.com/pc/qt/20170323200251/data/watermark';
const HERO_ID = 110311; // 官方汉·侍卫 icon_hero_id / hero_id

/**
 * @param {string} url
 * @param {string} outPath
 */
async function tryGet(url, outPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  const magicOk =
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    (buf[0] === 0x89 && buf[1] === 0x50);
  if (!magicOk || buf.length < 1024) return false;
  fs.writeFileSync(outPath, buf);
  return true;
}

const pPath = path.join(outDir, 'guard.jpg');
const aPath = path.join(outDir, 'guard_s.jpg');

let ok = await tryGet(`${WM}/card_${HERO_ID}.jpg`, pPath);
if (!ok) ok = await tryGet(`${CDN}/card_medium_${HERO_ID}.jpg?gameid=g10`, pPath);
if (!ok) ok = await tryGet(`${CDN}/card_small_${HERO_ID}.jpg?gameid=g10`, pPath);
const aOk = await tryGet(`${CDN}/card_small_${HERO_ID}.jpg?gameid=g10`, aPath);

console.log(`guard portrait=${ok ? 'OK' : 'FAIL'} avatar=${aOk ? 'OK' : 'FAIL'}`);
if (!ok) process.exit(1);
