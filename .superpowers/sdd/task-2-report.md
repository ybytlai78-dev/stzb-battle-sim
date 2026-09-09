# Task 2 报告：战报页铬架（去顶栏、页签进底栏）

**状态：** DONE  
**Commits：** none（按要求未 git commit）

## 做了什么

将生产 `web/` 战报页从顶部 `.report-nav` 改成套2 底栏 `.report-dock`：

- 战报根结构：`.report-view` → `.report-body`（简略/统计/详情）+ `footer.report-dock`
- 底栏单行：`← 返回配将` | 居中页签「简略 / 统计 / 详情」| `复用队伍` | `再打一场`
- `#app.report-open` 隐藏 `header.app` 与配将 `.control-bar`，只留 `.report-dock`
- 页签激活态沿用现有 `.btn.on` 金线下划线
- 「复用队伍」走既有 `reuseTeamFromReport`；「再打一场」清空战报 DOM 后调既有 `startBattle()`（新种子、阵容保留）
- 未改 `createStatsView` / `createBattleView` 内部、`src/engine/**`、`design-demos/02-workbench.html`

## TDD 证据

### RED（先改断言，实现前）

命令：

```bash
npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"
```

输出（节选）：

```
 ❯ web/smoke.test.ts (20 tests | 1 failed | 19 skipped) 945ms
   × Web 战斗模拟器冒烟 > 选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情 944ms
     → 战报底栏应出现: expected null to be truthy

 FAIL  web/smoke.test.ts > Web 战斗模拟器冒烟 > 选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情
AssertionError: 战报底栏应出现: expected null to be truthy
 ❯ web/smoke.test.ts:249:29
    248|     const dock = document.querySelector('.report-dock') as HTMLElement;
    249|     expect(dock, '战报底栏应出现').toBeTruthy();

 Test Files  1 failed (1)
      Tests  1 failed | 19 skipped (20)
```

符合预期：当时 DOM 仍是 `.report-nav`，没有 `.report-dock`。

### GREEN（实现后）

命令：

```bash
npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"
```

输出（节选）：

```
 ✓ web/smoke.test.ts (20 tests | 19 skipped) 986ms
   ✓ Web 战斗模拟器冒烟 > 选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情 984ms

 Test Files  1 passed (1)
      Tests  1 passed | 19 skipped (20)
```

全文件：

```bash
npx vitest run web/smoke.test.ts
```

```
 ✓ web/smoke.test.ts (20 tests) 2814ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

## 改动文件

| 文件 | 变更 |
|------|------|
| `web/smoke.test.ts` | 该测改查 `.report-dock`；`navBtn('简略战报')`→`简略`、`战报详情`→`详情`；统计表 / `.st-detail-btn` / `.result-banner` / `.troop-row` / `.event-stream` 未动 |
| `web/main.ts` | `renderBattleView` 重排；`closeReportView` 去掉 `report-open`；复用队伍 / 返回配将走关闭；再打一场清 DOM 后 `startBattle()` |
| `web/styles.css` | `.report-nav` → `.report-dock` / `.report-tabs` / `.report-body`；`#app.report-open` 藏顶栏与配将底栏；Task 1 token 未回退 |
| `web/mobile.css` | 横屏底栏 `.report-dock` min-height 42px、按钮字号压缩 |

## 验收对照

| 标准 | 结果 |
|------|------|
| 无顶部 `.report-nav` | 通过（断言 `toBeFalsy`） |
| 底栏含 返回配将 / 简略 / 统计 / 详情 | 通过 |
| `#app.report-open header.app { display: none }` | 通过 |
| `#app.report-open .control-bar { display: none }` | 通过 |
| 复用队伍 → `reuseTeamFromReport` | 通过 |
| 再打一场 → 清 DOM + `startBattle()` | 通过 |
| `.report-body` flex 1 + min-height 0 + overflow hidden；dock flex-shrink 0 单行页签居中 | 通过 |
| 激活态 `.on` 金线下划线 | 通过 |
| `initApp` 仍 `app.className = 'app-shell'`（重boot 清掉 report-open） | 通过 |
| 未改 engine / demo / stats·详情内部 | 通过 |

## 自检备注

- 历史测「顶栏战报」在战报页仍 `click` 隐藏的 `.nav-link`，jsdom 程序点击不受 `display:none` 影响，故 20/20 仍绿。真实用户在战报页看不到品牌顶栏，与套2 原型一致。
- `.report-dock` 按 brief 放在 `.report-view` 内（`main` 有 max-width 1380），不是 `#app` 全宽 botbar；结构以任务卡 HTML 为准。
- 统计表与详情事件流仍为旧实现，留给 Task 3 / Task 4。
