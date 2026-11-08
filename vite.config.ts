import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Vite 配置：dev / preview 均监听 0.0.0.0，
 * 同一局域网内的手机等设备可通过 http://<本机局域网IP>:5173 访问（见 docs/移动端访问.md）。
 *
 * 多页入口：`index.html`（主站配将台） + `advisor.html` + `rogue.html`。
 */
/** 每次构建前重算素材指纹（web/data/asset_ver.json）——
 *  立绘等文件名不带 hash，换图后靠 `?v=<指纹>` 让 URL 变化，避免 Service Worker 长缓存给旧图。 */
const genAssetVer = {
  name: 'gen-asset-ver',
  buildStart() {
    execFileSync(process.execPath, ['scripts/gen_asset_ver.mjs'], { stdio: 'inherit' });
  },
};

export default defineConfig({
  plugins: [genAssetVer],
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        advisor: resolve(process.cwd(), 'advisor.html'),
        rogue: resolve(process.cwd(), 'rogue.html'),
      },
    },
  },
  server: {
    host: true, // 允许局域网访问（手机连同一 Wi-Fi 后输入本机 IP）
    port: 5173,
  },
  preview: {
    host: true, // npm run preview:host / web:build 产物同样可被手机访问
    port: 4173,
  },
});
