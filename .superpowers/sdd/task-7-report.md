# Task 7 Report: golden 重录与全量测试

**Task ID:** task-7-golden  
**Status:** DONE  
**Date:** 2026-08-25  
**Commits:** none（仓库非 git）

## Summary

首次 `npx vitest run tests/golden.test.ts` **FAIL**，形态为预期的事件结构变更：`eventCount` 上升，`battle_start` 之后新增 `prep_phase formation` / `formation_bonus*` / `prep_phase troop` / `prep_phase skill`；同阵营木桩与 T10 等夹具的兵力数字因部队加成进入 `effectiveStat` 而变化。无 NaN、无缺字段、无类型错误。

删除 `tests/__snapshots__/golden.json` 后重跑写入快照；第二次 golden 仍 PASS。`npx tsc --noEmit` 无错误；`npm test` 全绿。

## Golden fail 是否为预期事件结构变更

**是。** 抽查 T1：`eventCount` 115 → 124；Received 侧出现 `prep_phase`（formation / troop / skill）与敌军三木桩的 `formation_bonus`（faction + troop）。T10 `finalMyTroops` / `finalEnemyTroops` 因加成后伤害变化。第二次比对无 `titleName` 键（夹具无称号加成，且引擎仅在有称号名时写入该字段）。

## Extra fixes

1. **`src/data/heroes.ts`**：本机 `127.0.0.1:3306` ECONNREFUSED，Docker daemon 未开。`initHeroDB` 在连接被拒绝时回退加载 `web/data/heroes.json`，否则 golden / `npm test` 无法跑。MySQL 可达时仍走原查询路径。
2. **`src/engine/combat.ts`**：`formation_bonus` 不再写入 `titleName: undefined`（`JSON.stringify` 会丢掉该键，二次 `toEqual` 会失败）。仅称号行带 `titleName`。

未改 fixtures；加成仍由 `runBattle` 自动生效。未改 `report.ts` / `battleView.ts`（穷尽 switch 已覆盖新事件，tsc 无 missing case）。

## Test Summary

| Command | Result |
|---------|--------|
| `npx vitest run tests/golden.test.ts`（旧快照） | FAIL — eventCount/events 不一致；T1 115→124；新增 prep_phase / formation_bonus |
| 删除快照后再跑 golden | PASS（写入新 `golden.json`） |
| 第二次 golden | PASS 2/2 |
| `npx tsc --noEmit` | PASS |
| `npm test` | **60 files / 748 tests PASS** |

## Acceptance Check

| 验收项 | 结果 |
|--------|------|
| 首次 golden FAIL 来自准备阶段结构而非随机/NaN | 通过 |
| 重录后 golden 字节一致、二次 PASS | 通过 |
| tsc 无错误 | 通过 |
| npm test 全绿 | 通过 |

## Concerns

- 本机无 MySQL 时依赖 `web/data/heroes.json`；若导出文件与库不同步，golden 会锁到 JSON 面板而非库内面板。有库时应走 MySQL。
- 夹具木桩同为「汉」步兵，敌军三人会吃阵营 10% + 步兵 10%，伤害数字相对旧快照有意变化。
