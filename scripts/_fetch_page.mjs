// 一次性抓取工具（兵种调研用）：抓取 GBK/UTF-8 页面并解码输出。
// 用法: node scripts/_fetch_page.mjs <url> [--out <file>] [--text]
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';

const [url, ...rest] = process.argv.slice(2);
if (!url) {
  console.error('usage: node scripts/_fetch_page.mjs <url> [--out <file>] [--text]');
  process.exit(1);
}
const outIdx = rest.indexOf('--out');
const outFile = outIdx >= 0 ? rest[outIdx + 1] : null;
const asText = rest.includes('--text');

const res = await fetch(url, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
});
const buf = Buffer.from(await res.arrayBuffer());
const head = buf.subarray(0, 2000).toString('latin1');
let enc = 'utf-8';
if (/charset=["']?gb2312/i.test(head)) enc = 'gbk';
if (/charset=["']?gbk/i.test(head)) enc = 'gbk';
let html = iconv.decode(buf, enc);

let out = html;
if (asText) {
  out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|td)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out, 'utf8');
  console.log(`OK status=${res.status} enc=${enc} bytes=${buf.length} -> ${outFile}`);
} else {
  console.log(out);
}
