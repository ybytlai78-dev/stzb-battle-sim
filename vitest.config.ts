import { defineConfig } from 'vitest/config';

/**
 * Vitest 配置（此前无此文件，走 vitest 默认 include）。
 *
 * 唯一目的：把**会话自检副本目录** `.verify-<topic>/` 排除出测试收集。
 * 那些目录是本机会话为了真机截图/回归把整仓（含 `tests/`）拷过去的快照
 * （`docs/…` 里提到过的验证流程），未被 .gitignore 覆盖时会令
 * `npx vitest run` 把同一批用例**重复跑两遍**（实测 108 → 210 文件、
 * 978 → 1928 例），既慢又掩盖真实用例数。
 *
 * exclude 会覆盖 vitest 默认列表，故这里把默认项原样保留。
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // 会话自检副本（不是仓库内容）
      '**/.verify-*/**',
    ],
  },
});
