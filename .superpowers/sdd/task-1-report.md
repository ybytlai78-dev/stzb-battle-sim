# Task 1 Report: 类型增量

## What you implemented

仅修改 `src/engine/types.ts`，按 brief 逐字段插入可选类型（未改 `action.ts` / `skills.ts` / 测试 / Web）：

1. **`CreateStatus.damage_reduce`**：在 `strategyScaled` 旁追加 `attackScaled?: boolean`（受攻击缩放对称字段）。
2. **`CreateStatus.damage_boost`**：
   - JSDoc 更新：`charges` 区分 caused/taken 消耗语义；补充 `attackScaled` / `decayFifths` 说明。
   - 字段：`speedScaled` 后加 `attackScaled?: boolean`；`chargesStack` 后加 `decayFifths?: number`。
3. **`Status.damage_boost`**：追加运行时衰减态 `fifths?: number`、`baseRate?: number`。  
   - 未加 `fifthsBase`（Task 3）。  
   - `Status.damage_reduce` 未加 `fifths`（本批恃强走 taken boost）。  
   - `Status` 未存 `attackScaled`（施加时写入已缩放 `rate`）。
4. **`strategy_damage`**：`chain` 后追加 `range?: number`、`ignoreRange?: boolean`。
5. **`PassiveSkill`**：`roundStartRepeat` 与 `output` 之间追加 `selfPhysBoost?`（perStack / maxStacks / duration / attackScaled / onRoundStart / onDealPhysical）。

`BaseSkill.triggerRate` 未改动（已是 `number | [number, number]`）。

## What you tested and test results

| 命令 | 结果 |
|------|------|
| `npx tsc --noEmit` | **PASS**（exit 0） |

无单元测试改动（任务卡规定 types-only，测试由测试子代理负责）。

## TDD Evidence

- Task 1 为纯类型增量，RED 不要求。
- 验证命令：`npx tsc --noEmit` → PASS（可选字段，现有调用方无需适配）。

## Files changed

- `src/engine/types.ts`

## Self-review findings

- 所有新增字段均为 optional，与「Expected: PASS」一致。
- JSDoc 为中文，字段文案与 brief 逐字对齐。
- 未触碰 `fifthsBase`、`action.ts`、`skills.ts`、测试、Web。
- `triggerRate` 保持不动。
- `Status.damage_boost` 已有 `fifths`/`baseRate`；`damage_reduce` 既有 `eighths`/`baseRate`（谋议）未误改。

## Issues or concerns

无阻塞项。后续 Task 2+ 需在 `action.ts` 落地 `attackScaled` / `decayFifths`→`fifths` 衰减 / `strategy_damage.range` / `selfPhysBoost` 结算逻辑；本任务仅提供类型契约。
