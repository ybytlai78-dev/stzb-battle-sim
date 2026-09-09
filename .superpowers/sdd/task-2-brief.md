### Task 2: 战报页铬架（去顶栏、页签进底栏）

**Files:**
- Modify: `web/main.ts` 的 `renderBattleView`
- Modify: `web/styles.css`（`.report-nav` → 底栏）
- Modify: `web/mobile.css`（横屏底栏高度）
- Test: `web/smoke.test.ts` 中「选将 → 开始模拟 → 默认简略战报」

**Interfaces:**
- Consumes: `createBattleSummary` / `createStatsView` / `createBattleView`
- Produces: 战报根节点结构：

```html
<div class="report-view">
  <div class="report-body"><!-- 简略 | 统计 | 详情 --></div>
  <footer class="report-dock">
    <button class="btn ghost btn-back">← 返回配将</button>
    <nav class="report-tabs">
      <button data-mode="summary">简略</button>
      <button data-mode="stats">统计</button>
      <button data-mode="detail">详情</button>
    </nav>
    <button class="btn ghost">复用队伍</button>
    <button class="btn primary">再打一场</button>
  </footer>
</div>
```

不要再渲染 `.report-nav` 在顶部。`header.app`（配将顶栏：战报/战法/伤害测试）在战报页可选择隐藏标题行，但顶栏三个 `nav-link` 仍要能用——若横屏高度紧，用 CSS 把 `header.app` 在 `.report-view` 出现时 `display:none`，历史入口改走底栏不需要；**保留 `header.app` 可见会再吃 34px**。套2 原型战报页是整页无品牌顶栏。落地时：`#app.report-open header.app { display: none }`，在 `renderBattleView` 给 `#app` 加 class `report-open`，返回配将时去掉。

- [ ] **Step 1: 改失败断言（导航从 `.report-nav` 改到底栏）**

把 `web/smoke.test.ts` 该测里：

```ts
expect(document.querySelector('.report-nav')!.textContent).toContain('返回配将');
const navBtn = (label: string) =>
  Array.from(document.querySelectorAll('.report-nav .btn')).find((b) => b.textContent!.includes(label)) as HTMLElement;
```

改成：

```ts
const dock = document.querySelector('.report-dock') as HTMLElement;
expect(dock, '战报底栏应出现').toBeTruthy();
expect(dock.textContent).toContain('返回配将');
expect(dock.textContent).toContain('简略');
expect(dock.textContent).toContain('统计');
expect(dock.textContent).toContain('详情');
expect(document.querySelector('.report-nav')).toBeFalsy();
const navBtn = (label: string) =>
  Array.from(dock.querySelectorAll('button')).find((b) => b.textContent!.includes(label)) as HTMLElement;
```

- [ ] **Step 2: 跑该测，确认 FAIL**

Run: `npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"`

Expected: FAIL（找不到 `.report-dock`）。

- [ ] **Step 3: 改 `renderBattleView` 与 CSS**

`web/main.ts`：按上面 HTML 重排；`startBattle` 时 `app.classList.add('report-open')`；返回配将 / 复用队伍时 `remove`。

「再打一场」= 清战报 DOM 后立刻再调现有 `startBattle()`（新种子，阵容保留）。

- [ ] **Step 4: 再跑该测**

Run: `npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"`

Expected: PASS（统计断言仍是旧表格，Task 3 再改）。

## Global Constraints

- 视觉真理：`design-demos/02-workbench.html`；spec：`docs/superpowers/specs/2026-09-09-战斗模拟器前端ui-design.md` 的「验收后锁定」。
- 不要实现套1 沙盘，不要读它当布局参考。
- 不要改 `src/engine/**`；禁止 `Math.random` 进引擎。
- 伤害实验室布局不重做；仅允许 CSS token 继承。
- 颜色一律 `var(--color-*)`，禁止组件里裸 hex（inline SVG 除外）。
- 战报页无「战斗模拟器」顶栏；简略/统计/详情在底栏中段。
- JSDoc 中文。
- **不要 git commit**；本工作区不是 git 仓库。
- 不要改 `design-demos/02-workbench.html`。
