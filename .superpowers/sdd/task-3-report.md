# Task 3 报告：统计页（图二骨架 + 行序）

**状态：** DONE  
**Commits：** none（按要求未 git commit）

## 做了什么

将 `createStatsView` 从 HTML `<table>` +「详情」弹窗改成套2 `.st-page` 骨架：

- 根仍是 `.stats-view`，内嵌 `.st-page`：左轨竖排「武将统计 / 战法统计」（默认 `data-stats="skill"` `.is-on`）
- 行序：红 大营→中军→前锋，再蓝 前锋→中军→大营（缺槽过滤）
- 每行 `.st-row`（`min-height: 50px`，头像列 44px）：`.pos-tag` + `.hcard`（`avatarSrc`）+ `.sk-row` 四列或 `.sh-row` 三占比
- 四列：普攻 `attackCount`/`attackDamage`；主战法与两携带走既有 `columnOrder` + `SkillStat`；恢复与杀伤同行，恢复 `var(--color-green)`；空携带 — / 0；品级 `grade s|a|b`
- 点击「武将统计」用 `computeContributionShares` 画 `.sh-row`（伤害/恢复/控制），删除 `openSharePanel` / `.st-detail-btn`
- 口径注释改 JSDoc（次数 = skill_cast，杀伤 `creditToId`，恢复归属施法者）
- 未改 `src/engine/**`、demo HTML、`createBattleView`

## TDD 证据

### RED（先改断言，实现前）

命令：

```bash
npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"
```

输出（节选）：

```
 ❯ web/smoke.test.ts (20 tests | 1 failed | 19 skipped) 987ms
   × Web 战斗模拟器冒烟 > 选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情 985ms
     → expected <table><thead>…(1)</thead>
…(1)</table> to be falsy

 FAIL  web/smoke.test.ts > Web 战斗模拟器冒烟 > 选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情
AssertionError: expected <table>…</table> to be falsy
 ❯ web/smoke.test.ts:260:42
    260|     expect(stats.querySelector('table')).toBeFalsy();
```

符合预期：当时 DOM 仍是 `<table>`。

### GREEN（实现后）

实现后第一次跑：行序已是红三站位 + 蓝缺槽，但 `pickHeroIntoSlot('blue', 0)` 实际是**大营**（注释写「前锋」）。为对齐任务卡 verbatim 标签 `['大营', '中军', '前锋', '前锋']`，该测蓝魏延改为 slot 2（前锋）。

命令：

```bash
npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"
```

```
 ✓ web/smoke.test.ts (20 tests | 19 skipped) 932ms
   ✓ Web 战斗模拟器冒烟 > 选将 → 开始模拟 → 默认简略战报，可切换统计/战报详情 930ms

 Test Files  1 passed (1)
      Tests  1 passed | 19 skipped (20)
```

全文件 + 实验室：

```bash
npx vitest run web/smoke.test.ts tests/damage_lab_smoke.test.ts
npx tsc --noEmit
```

```
 ✓ tests/damage_lab_smoke.test.ts (13 tests) 1171ms
 ✓ web/smoke.test.ts (20 tests) 3312ms
 Test Files  2 passed (2)
      Tests  33 passed (33)
```

tsc clean。

## 改动文件

| 文件 | 变更 |
|------|------|
| `web/smoke.test.ts` | 统计段改查 `.st-row` / `.pos-tag` / rail；普攻+次数改 `.sk-row`；魏延放入蓝前锋；详情 tab 断言未动 |
| `tests/damage_lab_smoke.test.ts` | 统计段改新骨架（无 modal）；未重做三栏布局 |
| `web/battleSummary.ts` | 重写 `createStatsView`；删除 `openSharePanel` |
| `web/styles.css` | 移植 `.st-page`/`.st-row`/`.sk-row`/`.sh-row`/`.pos-tag`/`.hcard`；`--color-line` 别名 |
| `web/mobile.css` | 横屏 `.st-row { min-height: 50px; }` + 44px 头像列 |

## 验收核对

- [x] `.stats-view` 内无 `<table>`，有 `.st-page`
- [x] 默认 skill；点击 hero 出 `.sh-row`（伤害/恢复/控制，非弹窗）
- [x] 行序红大营→中军→前锋，蓝前锋→中军→大营
- [x] `.st-row { min-height: 50px; }`，未对行设 `min-height: 0`
- [x] 品级 `grade s/a/b`；普攻无品级；空槽 — / 0
- [x] 恢复与杀伤同行，绿色 `--color-green`
- [x] 口径 JSDoc 保留
- [x] TDD RED 后 GREEN
- [x] 未改 engine / demo / `createBattleView`

## 给测试子代理

跑 `npx vitest run web/smoke.test.ts tests/damage_lab_smoke.test.ts`。目视统计页：左轨竖排、六行（或缺槽后更少）不压叠、默认战法四列、点「武将统计」换占比条。详情页 `.stats-table` 仍在 `createBattleView` 内，不要当回归失败。
