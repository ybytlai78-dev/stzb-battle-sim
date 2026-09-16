# Task 6 报告：六人机制 / 数值测（每战法补齐到 ≥3）

## 状态

**DONE_WITH_CONCERNS** — 未 git commit。未改引擎、未改 `SKILL_REGISTRY`、未删/重生 golden。

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/main_skills_b20.test.ts` | **31 passed**（原 19 + 本任务 12 机制测） |
| `npx tsc --noEmit` | **PASS** |
| `npx vitest run` | **1012 passed / 1 failed**（76 files）；golden **2/2** |
| 失败 | `tests/prepared_timing.test.ts` 长坂之吼：该文件按 **1 回合准备** 扫全部 `prepare:true`；`changban_zhihou` 的 `prepareTurns:2` 在第 3 回合释放，前一回合无 `prepare_start` |

## 实现摘要

只改 `tests/main_skills_b20.test.ts`。装配测保留。新增 `forceSkill`（structuredClone 后改 `triggerRate` / `chance_group` / `chain`）、`skillDamage`、`heroUnit`（`withSkills(level40(...))`）。

每战法 装配 + ② + ③：

| 战法 | ② | ③ |
|------|----|----|
| 落首箭 | 1 回合准备强制释放：300% 物理 + 大营物理 + 大营混乱 | 敌军只留大营 → ≥2 段 `physical` 且 `skillId==='luoshou_jian'` |
| 长坂之吼 | 真实 id 2 回合：prepare_start → 仍准备 → prepare_end + damage | 步打骑，`modifiers.reduce` 无 `troop_counter` |
| 烽火覆周 | `chain.chance=1, decay=0.5`，策略伤害 >1 段；无燃烧 | 谋略 80 vs 200 比 `breakdown.main`（无 growthRate） |
| 虎步关右 | 自身 `charges:1 / rate:0.7 / physical`；物理后 charges 消失 | 策略不消耗、`modifiers.caused` 无 0.7 |
| 火兽冲锋 | `battle_start` 后 `chance=1`：160% 物理；普攻 caused 同时 0.8 与 1.6 | `chance=0` 无 160%、无 charges；常驻 0.8 仍在 |
| 文德椒房 | 简单主动 triggerRate=1 后距离内 2 友军 strategy caused +0.1 | 第 2 回合可再叠；同人 `stacks<=3`；准备进入不叠、释放才叠 |

强制发动：`triggerRate=1`；准备战法 `actUnit` → `currentRound++`（1 回合一次 / 2 回合两次）再 `actUnit`。未编造 `growthRate`。

## 验收核对

| 标准 | 结果 |
|------|------|
| 每战法 ≥3 测（装配已有，补 ≥2 机制） | 通过 |
| `npx vitest run tests/main_skills_b20.test.ts` 全绿 | 通过 |
| 机制失败只修引擎缺口、不改 spec 数值 | 通过（b20 首跑即绿，未改引擎） |
| tsc + 全量 0 failed | 未通过：仅 `prepared_timing` 长坂之吼 1 条，非本任务 Files |
| golden 未删未重生 | 通过 |
| 不 git commit | 通过 |

## Concerns

`tests/prepared_timing.test.ts` 把所有 `prepare:true` 当成 1 回合准备（准备回合 r → r+1 释放）。长坂之吼 spec/`prepareTurns:2` 为 R1 进入、R2 仍准备、R3 释放，故「释放回合 3 前应已准备」失败。这是 Task 5 挂槽后已暴露的口径差，本任务卡未授权改该文件；引擎 2 回合准备路径与 b20 机制测一致。`tests/attack_scale.test.ts` 本跑 **12/12 通过**。

## 文件变更

| 文件 | 变更 |
|------|------|
| `tests/main_skills_b20.test.ts` | 追加 12 条机制/数值测 + 强制发动辅助函数 |
| `.tasks/task-6-mech-tests/status.json` | 任务状态 |
| `.superpowers/sdd/task-6-report.md` | 本报告 |

未改：`src/engine/**`、`src/data/skills.ts`、golden。

## Fix: prepared_timing

**PASS** — 未 git commit。未改引擎数值。只改 `tests/prepared_timing.test.ts`。

`assertPreparedTiming` 增加 `prepareTurns`（缺省 1）：释放在 `r + prepareTurns`；8 回合上限 `Math.floor(8 / (prepareTurns + 1))`（1→4，2→2）。遍历 `PREPARED_SKILLS` 传 `s.prepareTurns ?? 1`。樊渊泅囚仍走缺省 1 回合。

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/prepared_timing.test.ts tests/main_skills_b20.test.ts` | **66 passed**（prepared_timing 35 + b20 31） |

长坂之吼（`changban_zhihou`，`prepareTurns: 2`）时序断言已绿。
