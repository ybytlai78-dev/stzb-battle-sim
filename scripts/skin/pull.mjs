#!/usr/bin/env node
/**
 * 武将皮肤提取流水线：设备 → public/skins/ + skins.json 片段
 *
 * 一条命令跑完「拉资源 → 解密 → 解 nbs → 转 webm/webp → 打印 json 条目」。
 *
 * 前置：
 *   1. 大神模拟器开着，游戏已登录并进入主城（nbs 解码要 attach 到它的 libclient.so）
 *   2. frida-server 已起：adb shell "nohup /data/local/tmp/frida-server -D >/dev/null 2>&1 &"
 *                       adb forward tcp:27042 tcp:27042
 *   3. 该皮肤在游戏「武将外观」页里点开过一次（客户端才会把资源下到本地）
 *
 * 用法：
 *   node scripts/skin/pull.mjs --hero 100035 --key hxxx --slug default --name "默认"
 *   node scripts/skin/pull.mjs --hero 110245 --key h479 --slug longpan --name "甲辰新春·龙蟠虎踞" --cost 600
 *
 * 参数：
 *   --hero  <number>  客户端 heroid（tb_cfg_hero 的 heroid，等同 big_card_<hero>.jpg 里的数字）
 *   --key   <string>  skins.json 里的武将键（h479 / h100035 之类，与 web/data/skins.json 对应）
 *   --slug  <string>  皮肤 id（default / chengjiu / guishen / longpan …）
 *   --name  <string>  展示名
 *   --cost  <number>  风尚值（可选）
 *   --out   <dir>     public/skins 目录（默认自动定位到仓库 public/skins）
 *   --keep            保留中间 mp4（默认删）
 *
 * 环境变量：ADB（默认 MuMu 的 adb）、FFMPEG（默认 PATH 里的 ffmpeg）、PYTHON（默认 python）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ADB = process.env.ADB || 'C:/Program Files/Netease/MuMu/nx_main/adb.exe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const PYTHON = process.env.PYTHON || 'python';
const DEV = '/sdcard/Android/data/com.netease.stzb.netease/files/netease/stzb/Documents/mini_client_res/card';
const XOR_KEY = Buffer.from('8e509fe8596791fb', 'hex');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'keep') { out.keep = true; continue; }
    if (k === 'intro') { out.intro = 'on'; continue; }
    if (k === 'no-intro') { out.intro = 'off'; continue; }
    out[k] = argv[++i];
  }
  return out;
}

const opt = parseArgs(process.argv.slice(2));
for (const need of ['hero', 'key', 'slug', 'name']) {
  if (!opt[need]) {
    console.error(`缺少 --${need}\n\n${fs.readFileSync(import.meta.filename, 'utf8').split('*/')[0]}`);
    process.exit(1);
  }
}
const OUT = path.resolve(opt.out || path.join(ROOT, 'public', 'skins'));
fs.mkdirSync(OUT, { recursive: true });

const adb = (args, encoding = 'utf8') => execFileSync(ADB, args, { encoding, maxBuffer: 1 << 28 });
const shell = (cmd) => adb(['shell', cmd]);
const note = (msg) => console.log(`· ${msg}`);

// ---------- 1. 找资源 ----------
const hero = String(opt.hero);
const devices = adb(['devices']).split('\n').slice(1).filter((l) => l.trim()).length;
note(`adb 在线设备 ${devices} 个`);

const ls = (dir) => {
  try {
    return shell(`ls ${DEV}/${dir} 2>/dev/null`).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

const pick = (files, re) => files.map((f) => [f, f.match(re)]).filter(([, m]) => m).map(([f, m]) => ({ f, n: Number(m[1]) }));

const big = pick(ls('card_2d_videos'), new RegExp(`^big_${hero}_(\\d+)\\.nbs$`)).sort((a, b) => a.n - b.n);
const mid = pick(ls('card_2d_videos'), new RegExp(`^mid_${hero}_(\\d+)\\.nbs$`)).sort((a, b) => a.n - b.n);
const facade = pick(ls('card_2d_videos/facade_videos'), new RegExp(`^${hero}_(\\d+)\\.nbs$`)).sort((a, b) => a.n - b.n);
const cg = pick(ls('card_videos_new'), new RegExp(`^new_video_${hero}_(\\d+)\\.nbs$`)).sort((a, b) => a.n - b.n);
const cardBig = ls('card_big').includes(`big_card_${hero}.jpg`) ? `card_big/big_card_${hero}.jpg` : null;

note(`发现 big=${big.length} mid=${mid.length} facade=${facade.length} cg=${cg.length} 立绘=${cardBig ? '有' : '无'}`);
if (!big.length && !mid.length && !facade.length) {
  console.error(`\n设备上没有 heroid=${hero} 的外观资源。先在游戏里「武将 → 外观」把该皮肤点开一次，客户端才会下载。`);
  process.exit(2);
}

// ---------- 2. 解码 nbs（attach 到运行中的游戏） ----------
const pid = shell('pidof com.netease.stzb.netease').trim();
if (!pid) {
  console.error('游戏没在运行 —— nbs 解码要借它的 libvpx，先启动游戏。');
  process.exit(3);
}
note(`游戏 pid=${pid}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-'));
const rels = [
  ...big.map((x) => `card/card_2d_videos/${x.f}`),
  ...mid.map((x) => `card/card_2d_videos/${x.f}`),
  ...facade.map((x) => `card/card_2d_videos/facade_videos/${x.f}`),
  ...cg.map((x) => `card/card_videos_new/${x.f}`),
];
note(`解码 ${rels.length} 个 nbs → ${tmp}`);
execFileSync(PYTHON, [path.join(ROOT, 'scripts', 'skin', 'nbs_decode.py'), pid, tmp, ...rels], {
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});

const mp4 = (name) => {
  const p = path.join(tmp, `${name}.mp4`);
  return fs.existsSync(p) ? p : null;
};

// ---------- 3. 静态立绘（XOR 还原） ----------
let posterSrc = null;
if (cardBig) {
  const raw = path.join(tmp, 'card.jpg');
  adb(['pull', `${DEV}/${cardBig}`, raw]);
  try {
    if (!fs.existsSync(raw)) throw new Error('pull 未产出文件');
    const buf = fs.readFileSync(raw);
    const plain = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? buf
      : Buffer.from(buf.map((b, i) => b ^ XOR_KEY[i & 7]));
    posterSrc = path.join(tmp, 'card_plain.jpg');
    fs.writeFileSync(posterSrc, plain);
    note(`立绘 ${cardBig} → ${plain.length} 字节（${buf[0] === 0xff ? '明文' : 'XOR 还原'}）`);
  } catch (e) {
    note(`立绘读取失败：${e.message}`);
  }
}

// ---------- 4. 转 web ----------
const ff = (args) => execFileSync(FFMPEG, ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
const slug = opt.slug;
const made = [];

function toWebm(src, name, w, h, crf, cap = false) {
  if (!src) return null;
  const dst = path.join(OUT, `${opt.key}_${slug}_${name}.webm`);
  // cap=true：只缩不放（源比上限小就保持原尺寸，避免把小素材拉糊）
  const vf = cap
    ? `scale='min(${w},iw)':'min(${h},ih)':flags=lanczos`
    : `scale=${w}:${h}:flags=lanczos`;
  ff(['-i', src, '-vf', vf, '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-an', '-row-mt', '1', dst]);
  made.push([`${name}.webm`, dst]);
  return dst;
}

// 大图动态：有 2 段时 _1=入场、_2=循环；只有 1 段就当循环。
// 但 _1 未必真能接上 _2（吕蒙的 _1 收在远景、_2 是近景，直接切会「突然放大」），
// 所以先用 PSNR 量一下「入场末帧 vs 循环首帧」，差太多就不产出 intro，让 video 直接循环。
const big1 = big.find((x) => x.n === 1), big2 = big.find((x) => x.n === 2);
const facade1 = facade.find((x) => x.n === 1), facade2 = facade.find((x) => x.n === 2);

const introSrc = big1 && mp4(big1.f.replace('.nbs', ''));
const loopSrc =
  (facade2 && mp4(facade2.f.replace('.nbs', ''))) ||
  (big2 && mp4(big2.f.replace('.nbs', ''))) ||
  (big1 && mp4(big1.f.replace('.nbs', '')));

/** 抽一帧到 png：t = 'last' | 'first' */
function grab(src, t, dst) {
  const args = ['-y', '-v', 'error', '-i', src];
  if (t === 'last') args.push('-sseof', '-0.12');
  else args.push('-ss', '0');
  args.push('-frames:v', '1', dst);
  ff(args);
  return fs.existsSync(dst) ? dst : null;
}

/** 两张同尺寸图相似度（dB，越高越像）；失败返回 -1 */
function psnrOf(a, b) {
  const r = spawnSync(
    FFMPEG,
    ['-y', '-i', a, '-i', b, '-lavfi', '[0:v]scale=96:96[x];[1:v]scale=96:96[y];[x][y]psnr', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const m = /average:([\d.]+)/.exec(`${r.stderr || ''}${r.stdout || ''}`);
  return m ? Number(m[1]) : -1;
}

let useIntro = false;
if (introSrc && loopSrc && introSrc !== loopSrc) {
  const fa = grab(introSrc, 'last', path.join(tmp, '_intro_last.png'));
  const fb = grab(loopSrc, 'first', path.join(tmp, '_loop_first.png'));
  const db = fa && fb ? psnrOf(fa, fb) : -1;
  // 34 dB 是实测定出来的分界：吕布成就 37.6 dB（特写拉远 → 全景，接得上），
  // 吕蒙 27.9 dB（远景收手 → 近景抚颌，切过去等于突然放大）。--intro / --no-intro 可强行覆盖。
  useIntro = opt.intro === 'on' ? true : opt.intro === 'off' ? false : db >= 34;
  console.log(
    `  [intro] 末帧 vs 循环首帧 PSNR ${db >= 0 ? db.toFixed(1) : 'n/a'} dB → ${useIntro ? '衔接正常，保留入场段' : '构图跳变，丢弃入场段'}`,
  );
}
if (useIntro) toWebm(introSrc, 'intro', 768, 768, 40, true);
if (loopSrc) toWebm(loopSrc, 'loop', 1008, 1008, 42, true);

const mid2 = mid.find((x) => x.n === 2), mid1 = mid.find((x) => x.n === 1);
const smallSrc = (mid2 && mp4(mid2.f.replace('.nbs', ''))) || (mid1 && mp4(mid1.f.replace('.nbs', '')));
if (smallSrc) toWebm(smallSrc, 'small', 216, 314, 42);

const cg1 = cg[0] && mp4(cg[0].f.replace('.nbs', ''));
if (cg1) toWebm(cg1, 'cg', 1024, 576, 40);

// 封面：优先静态立绘（质量最高），否则用循环视频首帧
const posterOut = path.join(OUT, `${opt.key}_${slug}_poster.webp`);
if (posterSrc) {
  ff(['-i', posterSrc, '-vf', 'scale=768:-2:flags=lanczos', '-quality', '86', posterOut]);
  made.push(['poster.webp', posterOut]);
} else if (loopSrc) {
  ff(['-i', loopSrc, '-frames:v', '1', '-vf', 'scale=768:-2:flags=lanczos', '-quality', '86', posterOut]);
  made.push(['poster.webp', posterOut]);
}

// ---------- 5. 收尾 ----------
if (!opt.keep) fs.rmSync(tmp, { recursive: true, force: true });

const rel = (p) => '/' + path.relative(path.join(ROOT, 'public'), p).replace(/\\/g, '/');
const entry = { id: slug, name: opt.name };
if (opt.cost) entry.cost = Number(opt.cost);
for (const [name, p] of made) {
  const k = name.replace('.webm', '').replace('.webp', '');
  entry[k] = rel(p);
}

console.log('\n=== 产物 ===');
for (const [name, p] of made) console.log(`  ${name.padEnd(12)} ${(fs.statSync(p).size / 1024).toFixed(0).padStart(5)} KB  ${rel(p)}`);
console.log('\n=== skins.json 条目（贴到 web/data/skins.json 的 heroes.<key>.skins 数组里）===');
console.log(JSON.stringify(entry, null, 2));
console.log('\n记得跑：node scripts/gen_asset_ver.mjs');
