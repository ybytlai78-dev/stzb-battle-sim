#!/usr/bin/env node
/**
 * 生成 web/data/asset_ver.json：素材目录内容指纹。
 *
 * 为什么需要：public/portraits/ 等目录的文件名**不带 hash**，而 public/sw.js 对同源 GET 是
 * cache-first、HTTP 层也可能长缓存 —— 换图后 URL 不变，老访客会一直看到旧图
 * （2026-11-08 「立绘还是有水印」就是这个）。
 * 这里给每类素材算一个内容指纹，前端拼成 `?v=<指纹>`，一改图 URL 就变，缓存必然失效。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dirs = {
  portraits: 'public/portraits',
  portraitsBig: 'public/portraits_big',
  portraitsScene: 'public/portraits_scene',
  skills: 'public/skills',
};

const out = {};
for (const [key, rel] of Object.entries(dirs)) {
  const dir = join(root, rel);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f)).sort();
  } catch {
    out[key] = '0';
    continue;
  }
  // 路径 + 字节数 + 内容 sha1 前 12 位：改名/换图/加删都会变，mtime 不参与（checkout 会变）
  const h = createHash('sha1');
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    h.update(f);
    h.update(String(statSync(join(dir, f)).size));
    h.update(createHash('sha1').update(buf).digest('hex').slice(0, 12));
  }
  out[key] = h.digest('hex').slice(0, 10) + '-' + files.length;
}

const dest = join(root, 'web/data/asset_ver.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log('[asset-ver]', JSON.stringify(out));
