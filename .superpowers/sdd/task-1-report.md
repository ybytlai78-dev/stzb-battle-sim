# Task 1 Report: CSS token 与全局皮肤

## What was implemented

仅改 `web/styles.css`：

1. **`:root` 套2 色值**
   - 旧名保留：`--bg` / `--panel` / `--panel-2` / `--text` / `--text-dim` / `--gold` / `--red` / `--blue` / `--green` 值改为套2
   - 未删未改的旧名：`--panel-3`、`--line`、`--line-strong`、`--gold-bright`、`--ink`、`--text-weak`、字体、spacing 等原样保留
   - 追加 `--color-*` 别名、`--color-grade-s|a|b`、`--color-scroll`、`--card-accent`、`--radius`

2. **`body` 背景**
   - 去掉旧鎏金/蓝光径向渐变，改为 `background: var(--color-surface)`（对齐 `02-workbench.html`）

3. **卡片底边强调**
   - `.slot` / `.hero-card` / `.modal` 增加 `border-bottom: var(--card-accent)`（未做左侧色条）

4. **品级**
   - `.grade.grade-s|a|b` 色值映射到 `--color-grade-*`（去掉旧粉/蓝裸 hex）
   - 新增 `.grade.s|a|b` 与 `.dot` / `.dot.s|a|b`

5. **`.scroll-quiet` 细滚动条工具类**（按 brief 原文）

6. **未改动**：`.st-hero img` / `.tavatar` / `.act-avatar` 圆裁 + `object-position: 50% 18%`；未改 TS / demo / engine

## What was tested

```
npx vitest run web/smoke.test.ts
```

结果：**20/20 PASS**（约 5.45s）

```
 ✓ web/smoke.test.ts (20 tests) 2928ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

本任务未改断言、不断言色值。

## Files changed

- `web/styles.css`
- `.tasks/task-1-css-token/status.json`（任务状态）
- `.superpowers/sdd/task-1-report.md`（本报告）

## Self-review findings

- 验收项均满足：旧名+别名并存、卡片底边、品级双类名、滚动条工具类、头像裁切未回退、smoke 绿。
- `.slot:hover` / `.slot.empty` / `.slot.drag-over` 会改写 `border-color` / `border-style`，空槽与 hover 时底边绯红强调可能被盖住；brief 只要求在基类加 `border-bottom`，未要求改派生状态。若视觉上不理想，后续切片可在派生规则里再次声明 `border-bottom: var(--card-accent)`。
- 全文件仍有大量组件级裸 hex（如 header 渐变）；按约束本任务只做 token/皮肤入口，不扫全文件。

## Issues / concerns

- 无阻断项。
- 上述 `.slot` 派生态底边可能被覆盖：轻微视觉 concern，不阻塞 Task 2+。
