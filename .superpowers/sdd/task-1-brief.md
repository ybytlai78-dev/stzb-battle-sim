### Task 1: CSS token 与全局皮肤

**Files:**
- Modify: `web/styles.css`（文件顶部 `:root` 与 `body` 背景）
- Test: `web/smoke.test.ts`（冒烟仍能 `initApp`；本任务不断言色值）

**Interfaces:**
- Consumes: 现有 `--bg` / `--gold` 等旧名（全文件仍大量引用）
- Produces: 新 token 与旧名并存一层 alias，避免一次改 2000 行

- [ ] **Step 1: 在 `:root` 增加套2 token，并把旧名指过去**

在 `web/styles.css` 现有 `:root` **追加**（不要先删旧名）：

```css
:root {
  /* 旧名保留，值改成套2 */
  --bg: #12100f;
  --panel: #1c1817;
  --panel-2: #241f1d;
  --text: #eeeae4;
  --text-dim: #8a827c;
  --gold: #c49a36;
  --red: #8f2c2c;
  --blue: #2a4a7c;
  --green: #3a6b4a;
  --color-bg: var(--bg);
  --color-surface: var(--panel);
  --color-surface-2: var(--panel-2);
  --color-text: var(--text);
  --color-text-muted: var(--text-dim);
  --color-crimson: var(--red);
  --color-gold: var(--gold);
  --color-green: var(--green);
  --color-blue: var(--blue);
  --color-grade-s: #d989a0;
  --color-grade-a: #4a7ab0;
  --color-grade-b: #4e8a62;
  --color-scroll: color-mix(in srgb, var(--text-dim) 28%, var(--bg));
  --card-accent: 2px solid var(--red);
  --radius: 8px;
}
```

卡片类（`.slot`、`.hero-card`、`.modal`）把「左侧粗色条」改成 `border-bottom: var(--card-accent)`。`.st-hero img` / `.tavatar` / `.act-avatar` 保持圆裁 + `object-position: 50% 18%`。

品级点：现有金/红/蓝改成 `.grade.s` / `.dot.s` 用 `--color-grade-*`。

细滚动条工具类：

```css
.scroll-quiet {
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-scroll) transparent;
}
.scroll-quiet::-webkit-scrollbar { width: 4px; }
.scroll-quiet::-webkit-scrollbar-track { background: transparent; }
.scroll-quiet::-webkit-scrollbar-thumb {
  background: var(--color-scroll);
  border-radius: 4px;
}
```

- [ ] **Step 2: 跑冒烟确认没把 DOM 测挂**

Run: `npx vitest run web/smoke.test.ts`

Expected: PASS（本任务不应改 DOM 结构）。

## Global Constraints（本任务同样遵守）

- 视觉真理：`design-demos/02-workbench.html`；spec：`docs/superpowers/specs/2026-09-09-战斗模拟器前端ui-design.md` 的「验收后锁定」。
- 不要实现套1 沙盘，不要读它当布局参考。
- 不要改 `src/engine/**`；禁止 `Math.random` 进引擎。
- 伤害实验室布局不重做；仅允许 CSS token 继承。
- 颜色一律 `var(--color-*)`，禁止组件里裸 hex（inline SVG 除外）。本任务只改 CSS token/皮肤，不要为了这条去改 TS。
- 品级：S `#d989a0` / A `#4a7ab0` / B `#4e8a62`。
- JSDoc 中文。
- **不要 git commit**（除非用户本会话明确要求）；跳过所有 Commit 步骤。本工作区不是 git 仓库。
- 不要改 `design-demos/02-workbench.html`。
