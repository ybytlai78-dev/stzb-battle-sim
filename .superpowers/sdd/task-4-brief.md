### Task 4: 详情页（图三三栏 + 现有事件文案）

**Files:**
- Modify: `web/battleView.ts` 的外壳（`createBattleView` 前半：banner/nav/body），**不要重写** `renderEvents` / `renderPrepEvents` / `appendDamageModifierLine` 的字符串口径
- Modify: `web/styles.css`（`.dv` / `.dv-turns` / `.dv-log` / `.dv-rail`）
- Modify: `web/mobile.css`
- Test: `web/damageModifier.test.ts`；`web/smoke.test.ts` 若点「战报详情」

**Interfaces:**
- Consumes: 现有 `renderEvents(container, evs, nm, popupApi)`
- Produces: 详情根结构：

```
.dv
  aside.dv-turns      出手顺序头像 1..n（battle_start.turnOrder，缺则 my+enemy 配置序）
  section.dv-mid
    .dv-head          第 N 回合 | 回合前阶段
    .dv-log.scroll-quiet   现有 act-group 事件流
  aside.dv-rail       详/简、上/下、始/1/2…、播
```

`.dv-turns { overflow: hidden; padding-right: 8px; }` 禁止横向拖拽条。选中项箭头不得撑出横向滚动。

点左列头像：`dv-log.scrollTop` 滚到对应 `.act-group`（不要 `scrollIntoView`）。

「简」：`.dv.is-simple .act-body { display:none }`。

回合 0 = 准备阶段（现有 `renderPrepEvents`）。自动播放间隔保持 900ms。

增减伤弹层仍挂 `.ev.dmg-mod` 内，选择器 `.dmg-link` / `.dmg-popup` 不要改名。

- [ ] **Step 1: 跑现有增减伤测，记下基线**

Run: `npx vitest run web/damageModifier.test.ts`

Expected: PASS（改外壳前）。

- [ ] **Step 2: 改外壳布局**

把现在的「上 round-nav + troops-wrap 双列兵力 + 通栏 event-stream」换成三栏。兵力数字放到 `.act-head` 右侧（需要的话在 `unit_act_start` 组头补兵力，从该回合 `round_end` 快照或 `troopsAt` 按 unitId 查）。组头已有 `act-avatar`，继续 `avatarSrc`。

- [ ] **Step 3: 再跑增减伤 + smoke 详情切换**

Run:

```
npx vitest run web/damageModifier.test.ts
npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"
```

Expected: PASS。若 damageModifier 仍 `querySelector('.battle-view')` 则保持该根 class。

## Global Constraints

- 视觉真理：`design-demos/02-workbench.html` 图三三栏
- 不要实现套1 沙盘
- 不要改 `src/engine/**`
- 颜色一律 `var(--color-*)`
- 统计/详情头像：`avatarSrc`（`_s.jpg`）
- 不要重写 `renderEvents` / `renderPrepEvents` / `appendDamageModifierLine` 的字符串口径
- `.dmg-link` / `.dmg-popup` 不要改名
- JSDoc 中文
- **不要 git commit**
