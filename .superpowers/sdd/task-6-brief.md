### Task 6: 横屏密度与验收

**Files:**
- Modify: `web/mobile.css`
- Manual: 浏览器打开 `npm run web:host`，844×390 与桌面各走一遍

**Interfaces:** 无新 API。

- [ ] **Step 1: 横屏规则**

`@media (orientation: landscape) and (max-height: 520px)`：

- `header.app` 在 `.report-open` 时已隐藏。
- `.st-row { min-height: 50px; }` 头像与恢复不被裁。
- `.dv` 三栏：`48px minmax(0,1fr) 32px`。
- `.report-dock` 单行不换行，页签字号 12px。

- [ ] **Step 2: 手测清单（对照原型）**

1. 配将：红左池中蓝右，拖拽仍可用。
2. 开战 → 无品牌顶栏；底栏能切简略/统计/详情。
3. 统计：行序红大营中军前锋、蓝前锋中军大营；S 粉 A 蓝 B 绿。
4. 详情：左头像无横条；右滚动条细且暗；点头像跳行动组；发动率主干；增减伤可点。
5. 返回配将后 `header.app` 回来。
6. 伤害实验室仍能进、能模拟。

- [ ] **Step 3: 类型与全测**

Run:

```
npx tsc --noEmit
npx vitest run
```

Expected: tsc clean；golden **不应**因纯 CSS/DOM 战报外壳而变（不改事件字段）。若误改 `report.ts` 文本渲染导致 golden 失败，回滚引擎侧。

## Global Constraints

- 视觉真理：`design-demos/02-workbench.html`
- 不要实现套1 沙盘
- 不要改 `src/engine/**`；禁止 `Math.random` 进引擎
- 伤害实验室布局不重做
- 横屏手机为主，桌面加宽同一骨架；竖屏沿用 `mobile.css` 可滚动降级，不精修
- JSDoc 中文
- **不要 git commit**
