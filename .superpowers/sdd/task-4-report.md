# Task 4 报告：详情页（图三三栏 + 现有事件文案）

**状态：** DONE  
**Commits：** none（按要求未 git commit）

## 做了什么

把 `createBattleView` 外壳从「round-nav + 双列兵力 + 通栏 event-stream + 底表」换成图三三栏，**事件字符串口径未改**：

- 根仍是 `.battle-view`；其上保留紧凑 `.result-banner`（smoke / 历史详情）
- `.dv`：`aside.dv-turns`（`battle_start.turnOrder`，缺则 my+enemy 配置序，`avatarSrc`）+ `section.dv-mid`（`.dv-head` 第 N 回合 / 回合前阶段 + `.dv-log.scroll-quiet.event-stream`）+ `aside.dv-rail`（详/简、上/下、始/1…N `.rtab`、播）
- 去掉顶栏 `.round-nav`、`.troops-wrap`、底栏 `.stats-table`（统计已有独立 tab）
- `unit_act_start`：`.act-group[data-unit-id]` + 组头右侧兵力（`troopsAt` 按 unitId）+ `.act-body` 包事件行；「简」= `.dv.is-simple .act-body { display:none }`
- 点左列头像：`dv-log.scrollTop` 对齐对应组（不用 `scrollIntoView`）；无组则 no-op
- 播/停间隔仍 900ms；`.dmg-link` / `.dmg-popup` 仍挂 `.ev.dmg-mod`
- smoke 详情段改为断言 `.dv` / `.dv-turns` / `.dv-rail`，去掉 `.troop-row` / `.stats-table`

未改 `src/engine/**`、demo HTML。

## TDD 证据

### 基线（改外壳前）

命令：

```bash
npx vitest run web/damageModifier.test.ts
```

输出：

```
 ✓ web/damageModifier.test.ts (11 tests) 306ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  19:15:44
   Duration  2.89s
```

符合预期：改前 PASS。

### GREEN（实现后）

```bash
npx vitest run web/damageModifier.test.ts
npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"
npx vitest run web/smoke.test.ts
npx vitest run tests/damage_lab_smoke.test.ts
npx tsc --noEmit
```

```
 ✓ web/damageModifier.test.ts (11 tests) 249ms
 ✓ web/smoke.test.ts 选将 → 开始模拟 914ms
 ✓ web/smoke.test.ts (20 tests) 3631ms
 ✓ tests/damage_lab_smoke.test.ts (13 tests) 816ms
 tsc --noEmit → clean
```

增减伤选择器 `.ev.dmg-mod` / `.dmg-link` / `.dmg-popup` / `.act-group .ev` 与文案均仍匹配。历史 `.hist-detail .event-stream` 靠 `dv-log` 的 `event-stream` 别名通过。

## 改动文件

| 文件 | 变更 |
|------|------|
| `web/battleView.ts` | 三栏外壳；组头兵力 / `data-unit-id` / `.act-body`；删兵力列与底表 |
| `web/styles.css` | `.dv` 网格 `48px minmax(0,1fr) 32px`；`.dv-turns` overflow hidden + padding-right 8px |
| `web/mobile.css` | 横屏三栏压缩；竖屏 `.dv` min-height |
| `web/smoke.test.ts` | 详情段断言 `.dv` / `.dv-turns` / `.dv-rail` |

## 关注点

- 旧 `.round-nav` / `.troops-wrap` / `.stats-table` CSS 仍留在 `styles.css`（无 DOM 再引用）
- jsdom 下 `getBoundingClientRect` 多为 0，左列滚动对齐未做像素级断言
- 组头去掉 `.dot`（与品级圆点 class 冲突）；事件行文案未动
