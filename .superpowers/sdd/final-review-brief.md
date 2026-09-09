# Final whole-branch review inputs (no git)

Plan: `docs/superpowers/plans/2026-09-09-套2前端落地.md`
Visual: `design-demos/02-workbench.html` (read-only)
Spec: `docs/superpowers/specs/2026-09-09-战斗模拟器前端ui-design.md` 「验收后锁定」

This workspace is not a git repository. Review the current production files against the plan. Do not mutate the tree. Do not re-run the full suite (controller will).

## Production files to read

- `web/styles.css` (`:root`, `#app.report-open`, `.slot`, `.report-dock`, `.st-page`/`.st-row`, `.dv`/`.dv-turns`)
- `web/mobile.css` landscape `@media (orientation: landscape) and (max-height: 520px)`
- `web/main.ts` `renderBattleView` / `report-open` / dock
- `web/battleSummary.ts` `createStatsView`
- `web/battleView.ts` `createBattleView` shell (first ~220 lines) + `unit_act_start` / `.act-body`
- `web/smoke.test.ts` 选将→开始模拟 段
- Confirm `src/engine/**` was not part of this landing (spot-check no recent engine intent)

## Known ledger minors (triage which must fix before “done”)

- `.slot` hover/empty/drag-over 已在 Task 5 重申底边绯红
- header / 部队加成弹窗仍有裸 hex
- `.stats-share-modal` / `.round-nav` / `.troops-wrap` 死 CSS 未清
- 桌面统计头像列未跟 demo 扩到 72px（任务卡横屏锁定 44px）
- `#start` 未加 `.primary` class（靠 `#start` 选择器上绯红）
- 844×390 手测 UNVERIFIED（无 browser MCP）

## Must still hold

- 三列配将，不是套1沙盘
- 不改引擎；golden 不应变
- 战报无品牌顶栏；页签在底栏
- 统计行序红大营→中军→前锋，蓝前锋→中军→大营；无 table
- 详情三栏；事件文案口径未改；`.dmg-link` 仍在
- 品级 S `#d989a0` / A `#4a7ab0` / B `#4e8a62`
- 实验室布局未重做
