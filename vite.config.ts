import { defineConfig } from 'vite';

/**
 * Vite 配置：dev / preview 均监听 0.0.0.0，
 * 同一局域网内的手机等设备可通过 http://<本机局域网IP>:5173 访问（见 docs/移动端访问.md）。
 */
export default defineConfig({
  server: {
    host: true, // 允许局域网访问（手机连同一 Wi-Fi 后输入本机 IP）
    port: 5173,
  },
  preview: {
    host: true, // npm run preview:host / web:build 产物同样可被手机访问
    port: 4173,
  },
});
