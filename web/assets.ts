/// <reference types="vite/client" />
/**
 * 静态资源 URL 统一入口。
 * 数据层（portraits.json 等）存根绝对路径（/portraits/x.jpg），dev 模式（BASE_URL=/）直接可用；
 * GitHub Pages 子路径部署（BASE_URL=/stzb-battle-sim/）必须加前缀，否则运行时拼的 img src 全 404。
 */
export function asset(src: string): string {
  if (!src || src.startsWith('http') || src.startsWith('data:')) return src;
  return src.startsWith('/') ? `${import.meta.env.BASE_URL}${src.slice(1)}` : src;
}
