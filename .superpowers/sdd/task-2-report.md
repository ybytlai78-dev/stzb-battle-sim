# Task 2 Report: attackScaled 结算 + taken 受击消耗 charges

## What you implemented

在 `src/engine/action.ts` 落地 Task 1 已加的类型契约（不改 `skills.ts`、不实现 decayFifths / selfPhysBoost / strategy_damage.range）：

1. **`executeSkillOutputs` `inflict_status`**：在 `speedScaled` 之后、属性 buff 之前插入 `attackScaled` 分支。
   - `damage_boost` / `damage_reduce` 且 `attackScaled`。
   - `growthRate === undefined`：不缩放，原 `rate` 写入（万箭 −0.5）。
   - 有 `growthRate`：按绝对值 `scaledValue` + `roundRate` 再恢复符号，属性用 `effectiveStat(caster, 'attack')`（与 speedScaled 同口径）。
2. **`consumeAttackCharges`**：循环内 `if (s.direction === 'taken') continue;`，只扣 caused（青丘 / 全军突击）。taken 改由受击路径消耗。未导出。
3. **`consumeTakenCharges`**（新，未导出）：目标身上 `direction === 'taken'` 且带 `charges` 的 `damage_boost`，经 `statusMatchesHit` 匹配本次伤害后 −1，到 0 移除。
4. **`applyDamage`**：`target.troops -= actual` 与伤兵拆分之后、`triggerIgniteOnHurt` 之前，`actual > 0` 时调用 `consumeTakenCharges`。规避提前 return 不走这里；当次伤害已在 `applyDamage` 入参里算完，扣 charges 不影响当次。

测试 `tests/attack_scale.test.ts`：`dummyUnit` / `makeCtx` 拷自 `tests/troop_filter.test.ts`；经已导出的 `triggerActiveSkill` 覆盖 `executeSkillOutputs` 缩放。

## What you tested and test results

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/attack_scale.test.ts`（实现前 RED） | **FAIL** 2 failed / 5 passed |
| `npx vitest run tests/attack_scale.test.ts`（实现后 GREEN） | **PASS** 7 passed |
| `npx tsc --noEmit` | **PASS**（exit 0） |

未跑全量 / golden（任务卡未要求）。

## TDD Evidence

### RED

Command: `npx vitest run tests/attack_scale.test.ts`

Output (exit 1):

```
 ❯ tests/attack_scale.test.ts (7 tests | 2 failed) 17ms
   × taken charges 受击消耗 > 策略受击实际扣兵后 charges 到 0 移除；当次仍计入 9ms
     → expected [ { type: 'damage_boost', …(9) } ] to have a length of +0 but got 1
   × attackScaled 经 executeSkillOutputs > 无 growthRate 保持 −0.5；有 growthRate 按攻击缩放 3ms
     → expected 0.08 to be close to 0.1, received difference is 0.020000000000000004

 Test Files  1 failed (1)
      Tests  2 failed | 5 passed (7)
```

与 brief 预期一致：taken 策略受击后 charges 仍为 1；有 growthRate 的 attackScaled 未缩放（仍 0.08）。

直调 `inflictStatus` 的两条 attackScaled 测在 RED 阶段已过（缩放只走 `executeSkillOutputs`）。

### GREEN

Command: `npx vitest run tests/attack_scale.test.ts`

Output (exit 0):

```
 ✓ tests/attack_scale.test.ts (7 tests) 10ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Command: `npx tsc --noEmit`

Output: exit 0（无诊断）。

## Files changed

- `src/engine/action.ts`
- `tests/attack_scale.test.ts`
- `.tasks/task-2-attack-scale/status.json`（工作流状态）

未改 `src/data/skills.ts`、`src/engine/types.ts`。无 commit。

## Self-review findings

- 实现片段与 brief 对齐：attackScaled 插入位置、绝对值缩放、`consumeAttackCharges` skip taken、`consumeTakenCharges` 调用点均按原文。
- JSDoc 中文；无 `Math.random`；`consumeAttackCharges` / `consumeTakenCharges` 均未导出。
- 未实现 decayFifths、selfPhysBoost、`strategy_damage.range`（Task 3）。
- 未改 `inflictStatus` sameSource（brief Files 点到该行，Step 3 无改动要求）。
- 现有带 `charges` 的战法（扬威 / 全军突击 / 青丘等）均显式 `direction: 'caused'`，skip taken 不误伤。
- **测试与 brief 一处偏离（为 tsc）**：brief 写 `dummyUnit('def', '前锋', { troops: 10000 }, 'enemy')`，`troops` 不在 `Partial<General>` 上，`npx tsc --noEmit` 报 TS2353。改为 `dummyUnit('def', '前锋', {}, 'enemy')`，下一行 `def.troops = 10000` 保留。语义不变。
- 测试 import 未照抄 brief 第一段未使用的 `triggerCommandSkills` / `tickRoundStartStatuses`，补了 `triggerActiveSkill`（brief 后段要求）。

## Issues or concerns

无阻塞。

并发：实现期间 `action.ts` 上已有 Task 3 `chance_group` 处理；最终 `tsc` 绿，未改 chance_group 逻辑。

`applyDamage` 旧调用若省略 `damageType`，`statusMatchesHit` 该维不限制，strategy-taken charges 会被任意扣兵消耗。现有伤害路径均传入类型；文伐类战法尚未入库（本任务不改 skills.ts）。
