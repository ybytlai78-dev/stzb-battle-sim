#!/usr/bin/env node
/**
 * 打安卓 Release APK（带 base 口径自检）。
 *
 * ⚠️ 2026-11-08 事故：先跑 `scripts/deploy-gh-pages.sh`（它用 `--base=/stzb-battle-sim/` 构建 dist），
 *    紧接着 `npx cap sync android` 会把这份 GitHub Pages 口径的产物塞进 APK →
 *    WebView 里 `https://localhost/stzb-battle-sim/assets/*.js` 全部 404 → 启动纯黑屏。
 *    因此打包必须**自己重新构建一次**（base 默认 `/`），不能复用部署脚本留下的 dist。
 *
 * 用法：node scripts/pack-apk.mjs [--version 2.13]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const args = process.argv.slice(2);
const versionArg = args.includes('--version') ? args[args.indexOf('--version') + 1] : null;

const run = (cmd, argv, cwd = root) =>
  execFileSync(cmd, argv, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

// 1) 用默认 base 重新构建（绝不能复用部署脚本的 dist）
console.log('==> 1/4 vite build（base 默认 /）');
rmSync(join(root, 'dist'), { recursive: true, force: true });
run('npx', ['vite', 'build']);

const distIndex = readFileSync(join(root, 'dist/index.html'), 'utf8');
if (distIndex.includes('stzb-battle-sim')) {
  fail('dist/index.html 里出现了 GitHub Pages 的 base 前缀，APK 里会 404（见脚本头注释）');
}
if (!/src="\/assets\//.test(distIndex)) {
  fail(`dist/index.html 未引用 /assets/ 绝对路径：${distIndex.match(/src="[^"]*"/)?.[0] ?? '(无 script)'}`);
}
console.log('    ✓ dist 口径正确');

// 2) 同步到 android
console.log('==> 2/4 cap sync android');
run('npx', ['cap', 'sync', 'android']);

// 3) 组包
console.log('==> 3/4 gradlew assembleRelease');
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradle, ['--no-daemon', 'assembleRelease'], join(root, 'android'));

const apk = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) fail(`未找到产物：${apk}`);

// 4) 校验 APK 内嵌 index.html 的口径 + 落一份带版本号的副本
console.log('==> 4/4 校验 APK 内嵌产物');
const zipList = execFileSync('python', [
  '-c',
  [
    'import sys,zipfile',
    `z=zipfile.ZipFile(sys.argv[1])`,
    `sys.stdout.write(z.read("assets/public/index.html").decode("utf-8"))`,
  ].join(';'),
  apk,
]).toString('utf8');
if (zipList.includes('stzb-battle-sim')) fail('APK 内嵌 index.html 带 Pages 前缀，装上必黑屏');
if (!zipList.includes('/assets/main-')) fail('APK 内嵌 index.html 未引用 /assets/main-*');

const gradleText = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
const versionName = gradleText.match(/versionName "([^"]+)"/)?.[1] ?? '0.0';
const versionCode = gradleText.match(/versionCode (\d+)/)?.[1] ?? '0';
if (versionArg && versionArg !== versionName) {
  fail(`build.gradle 的 versionName=${versionName} 与 --version ${versionArg} 不一致，先改再打包`);
}

mkdirSync(join(root, 'dist-apk'), { recursive: true });
const out = join(root, `dist-apk/stzb-battle-sim-${versionName}.apk`);
copyFileSync(apk, out);
const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
const size = readFileSync(out).length;

// 顺手确认新素材确实进包（场景大卡/大图/立绘三族）
const names = execFileSync('python', [
  '-c',
  'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(len([n for n in z.namelist() if "portraits_scene" in n]), len([n for n in z.namelist() if "portraits_big" in n]), len([n for n in z.namelist() if n.startswith("assets/public/portraits/")]))',
  out,
]).toString().trim();

console.log(`\n✓ APK ok：${out}`);
console.log(`  versionCode=${versionCode} versionName=${versionName} size=${(size / 1048576).toFixed(1)} MB`);
console.log(`  sha256=${sha}`);
console.log(`  素材族计数（scene / big / portraits）：${names}`);
