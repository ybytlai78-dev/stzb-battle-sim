# Task 3 Report: decayFifths + selfPhysBoost + 输出级 range

## What you implemented

在 `src/engine/types.ts` / `src/engine/action.ts` 落地 Task 1 类型契约的结算（不改 `skills.ts`、不登录万箭/文伐/不攻/恃强）：

1. **`Status.damage_boost.fifthsBase`**：挂上时满额份数（分母冻结）。`fifths = fifthsBase = create.decayFifths`，`baseRate = create.rate`。
2. **`inflictStatus` 推状态**：`decayEighths` 旁拷贝 `fifths` / `fifthsBase` / `baseRate`。`damage_boost` detail 有 `decayFifths` 时覆盖为「剩余 N/N」。
3. **`decayFifthsOnHit`**（未导出）：`actual > 0` 时在 `consumeTakenCharges` 之后；`statusMatchesHit` 才 −1；`fifths <= 0` 移除并 `status_expired`；否则 `rate = baseRate * fifths / fifthsBase`。`tickRoundStartStatuses` **不对 fifths 做回合衰减**（仍只衰减 eighths）。
4. **`applySelfPhysBoost`**（未导出）：给持有者叠 1 层 caused physical `damage_boost`（`stacks:1` + `maxStacks`）。`tickRoundStartStatuses` 在 eighths 之后、`lockedCommands` 之前走 `onRoundStart`；`applyDamage` 在物理实际扣兵后走 `onDealPhysical`。
5. **`maxStacks` 封顶**：`inflictStatus` sameSource 已有文德椒房闸（`stacks >= create.maxStacks` 则 return），与 brief 等价，未重复插入。
6. **`outRange`**：`physical_damage` / `strategy_damage` 的 `ignoreRange` → Infinity，否则 `out.range ?? skill.range`。`physical_damage.attacker === 'recipient'` 仍用内部 `atkRange`（疏数未改）。

未用 `PassiveSkill.roundStartRepeat` 做恃强回合开始叠层。无 commit。

## What you tested and test results

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/attack_scale.test.ts`（实现前 RED） | **FAIL** 3 failed / 8 passed |
| `npx vitest run tests/attack_scale.test.ts tests/troop_filter.test.ts`（实现后 GREEN） | **PASS** 27 passed（11 + 16） |
| `npx tsc --noEmit` | **PASS**（exit 0） |

未跑全量 / golden（任务卡未要求）。

## TDD Evidence

### RED

Command: `npx vitest run tests/attack_scale.test.ts`

Output (exit 1):

```
 ❯ tests/attack_scale.test.ts (11 tests | 3 failed) 19ms
   × decayFifths > 五次匹配策略扣兵后移除：30→24→18→12→6→0 7ms
     → expected undefined to be 5 // Object.is equality
   × decayFifths > 物理受击不衰减策略 fifths 1ms
     → expected undefined to be 5 // Object.is equality
   × selfPhysBoost > 回合开始 +1 层；造成物理扣兵后再 +1；封顶 12 1ms
     → expected undefined to be 'damage_boost'

 Test Files  1 failed (1)
      Tests  3 failed | 8 passed (11)
```

与 brief 部分一致：fifths 未拷贝（undefined）；selfPhysBoost 回合开始未叠层。Task 2 的 7 测仍过。

**偏离：** `strategy_damage.range` 在 RED 已过。前锋↔前锋实时距离为 1，战法 `range: 1` 已能打中敌军前锋，无法用该用例证明输出级 `range: 5`。仍按 brief 改了 `outRange`。

### GREEN

Command: `npx vitest run tests/attack_scale.test.ts tests/troop_filter.test.ts`

Output (exit 0):

```
 ✓ tests/attack_scale.test.ts (11 tests) 14ms
 ✓ tests/troop_filter.test.ts (16 tests) 18ms

 Test Files  2 passed (2)
      Tests  27 passed (27)
```

Command: `npx tsc --noEmit`

Output: exit 0（无诊断）。

## Files changed

- `src/engine/types.ts`（`fifthsBase`）
- `src/engine/action.ts`
- `tests/attack_scale.test.ts`（追加 describe，未删 Task 2）
- `.tasks/task-3-decay-fifths/status.json`

未改 `src/data/skills.ts`。无 commit。

## Self-review findings

- 衰减分母用冻结的 `fifthsBase`，避免 `fifths/(fifths+1)` 二次衰减错误（5→4 用 4/5，再 3/5 而非 3/4）。
- JSDoc 中文；`decayFifthsOnHit` / `applySelfPhysBoost` 未导出；无 `Math.random`。
- 疏数 recipient `atkRange = out.range ?? skill.range` 未动。
- selfPhysBoost 测 brief 用 `layer()!` 二次调用无法收窄 `Status` 联合，tsc 失败。改为每次把 `layer()` 赋给局部变量再 `if (s?.type === 'damage_boost')`，断言不变。
- 输出级 range 缺「大营目标 / 距离>1」的 RED 用例；建议 Task 4 不攻测把敌军放中军或大营。

## Gap fix: strategy_damage.range��2026-09-16��

### Problem
ԭ����˫������ǰ�� �� ʵʱ���� 1��`skill.range: 1` ���ܴ��У�`range: 5` ������ RED �׶��Ѽ��̡�

### Fix�����⣬δ�����棩
- �о�Ŀ���Ϊ `��Ӫ`��
- �� 1v1 ʱ˫�� liveRank ��Ϊ 0��������ѹ�� 1�����ҷ���ǰ��+�о�ռλ��ʩ���߷� `��Ӫ`���Եо���Ӫʵʱ���� = 3��
- ���� `range: 5` �����в����˺������������ `range`������ `skill.range: 1`�������� `test_bg` �����˺���

### Results
| ���� | ��� |
|------|------|
| `npx vitest run tests/attack_scale.test.ts -t "strategy_damage.range"` | **PASS** 2 passed / 10 skipped |
| `npx vitest run tests/attack_scale.test.ts tests/troop_filter.test.ts` | **PASS** 28 passed��12 + 16�� |
| `npx tsc --noEmit` | **PASS**��exit 0�� |

Engine change: **��**��`outRange` ����ȷ���������Բ�಼�ã���
