# Task 6 Report: 横屏密度与验收

## Status: done

## Commits: none

## Changes

仅改 `web/mobile.css` 的 `@media (orientation: landscape) and (max-height: 520px)`：

- `.report-dock` 补 `flex-wrap: nowrap; white-space: nowrap;`（单行不换行）
- `.report-tabs` 补 `flex-wrap: nowrap`
- 页签 `.report-dock .btn` / `.report-tabs .btn` 保持 `font-size: 12px`
- 既有 `.st-row { min-height: 50px }`、`.dv { grid-template-columns: 48px minmax(0,1fr) 32px }` 未动

确认：`web/styles.css` 已有 `#app.report-open header.app { display: none }`（L85），未重复写入 `mobile.css`。未改 `src/engine/**`、未改 golden、未实现套1、未重做伤害实验室。

## Test Summary

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | **PASS**（exit 0；仅 npm `devdir` warn） |
| `npx vitest run` | 产品测 **820 passed**；`tests/golden.test.ts` **2/2 PASS**。裸命令 exit 1：7 个 **failed suites** 全部是 `.superpowers/sdd/snapshots/task-*-before/*.test.ts`（归档副本相对路径 `./main` 解析失败），**不是 golden、不是本任务 CSS** |
| `npx vitest run tests web` | **65 files / 820 tests PASS**（排除 SDD 归档后的产品套件） |

裸 `npx vitest run` 末行：

```
 Test Files  7 failed | 65 passed (72)
      Tests  820 passed (820)
 Duration  12.19s
```

产品套件末行：

```
 Test Files  65 passed (65)
      Tests  820 passed (820)
 Duration  9.88s
```

golden 未因 CSS 变化而失败，未重新生成快照。

## Step 2 手测清单 — UNVERIFIED visually (no browser)

本环境无 browser MCP，未目视 844×390，未启动长驻 `vite --host`。请 controller/人工对照 `design-demos/02-workbench.html` 走：

1. **UNVERIFIED visually (no browser)** — 配将：红左池中蓝右，拖拽仍可用。
2. **UNVERIFIED visually (no browser)** — 开战 → 无品牌顶栏；底栏能切简略/统计/详情。
3. **UNVERIFIED visually (no browser)** — 统计：行序红大营中军前锋、蓝前锋中军大营；S 粉 A 蓝 B 绿。
4. **UNVERIFIED visually (no browser)** — 详情：左头像无横条；右滚动条细且暗；点头像跳行动组；发动率主干；增减伤可点。
5. **UNVERIFIED visually (no browser)** — 返回配将后 `header.app` 回来。
6. **UNVERIFIED visually (no browser)** — 伤害实验室仍能进、能模拟。

CSS 侧可静态核对：战报开页隐藏顶栏已在 `styles.css` L85；横屏底栏 nowrap + 12px、统计行 50px、详情三栏 48/1fr/32 已在 `mobile.css` landscape 块。

## Concerns

- 裸 `npx vitest run` 会扫到 `.superpowers/sdd/snapshots/**/*.test.ts`，exit 1。修复需改 vitest exclude 或挪走归档测试——超出本任务文件边界（只许动 `web/mobile.css`），留给 controller。
- 844×390 / 桌面手测未做，需人工验收。
