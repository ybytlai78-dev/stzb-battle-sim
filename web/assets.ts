/// <reference types="vite/client" />
/**
 * 静态资源 URL 统一入口。
 * 数据层（portraits.json 等）存根绝对路径（/portraits/x.jpg），dev 模式（BASE_URL=/）直接可用；
 * GitHub Pages 子路径部署（BASE_URL=/stzb-battle-sim/）必须加前缀，否则运行时拼的 img src 全 404。
 */
export function asset(src: string): string {
  if (!src || src.startsWith('http') || src.startsWith('data:')) return src;
  // `import.meta.env` 是 Vite 注入的：浏览器页面走 BASE_URL；离线脚本（tsx/node）下不存在，
  // 此时退化成 '/'——否则脚本一 import web/heroes.ts 就会在模块初始化时抛
  // `Cannot read properties of undefined (reading 'BASE_URL')`（L2 模拟测评脚本要复用这些模块）。
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return src.startsWith('/') ? `${base}${src.slice(1)}` : src;
}
