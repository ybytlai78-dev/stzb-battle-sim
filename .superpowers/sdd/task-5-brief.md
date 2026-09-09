### Task 5: 配将台皮肤（不改操作模型）

**Files:**
- Modify: `web/styles.css`、`web/mobile.css`
- Modify: `web/teamEditor.ts` 仅当品级 class 需要 `s|a|b` 字母
- Test: `web/smoke.test.ts` 拖拽 / 详情 / 部队加成各测

**Interfaces:**
- 槽位、池子、Drop-Zone、`onPickHero` / `onMoveSlot` 签名不变。
- 横屏槽：左画像右信息可继续现结构；不要改成沙盘。
- 主按钮 `#start` 用 `--color-crimson`。

- [ ] **Step 1: 对照原型微调槽卡与底栏**

对照 `02-workbench.html` 的 `.slot` / `.bench` / `.botbar`：圆角 8px、底边绯红、底栏士气+开始模拟。不要删部队加成按钮。

- [ ] **Step 2: 全量 web 测**

Run: `npx vitest run web/smoke.test.ts web/damageModifier.test.ts tests/damage_lab_smoke.test.ts`

Expected: PASS。`nav-link` 数量仍为 3。

## Global Constraints

- 视觉真理：`design-demos/02-workbench.html`
- 不要实现套1 沙盘，不要读它当布局参考。
- 不要改 `src/engine/**`
- 伤害实验室布局不重做；仅允许 CSS token 继承。
- 颜色一律 `var(--color-*)`，禁止组件里裸 hex（inline SVG 除外）。
- 品级：S `#d989a0` / A `#4a7ab0` / B `#4e8a62`（`--color-grade-*`）
- JSDoc 中文
- **不要 git commit**
- 三列配将、不开沙盘
