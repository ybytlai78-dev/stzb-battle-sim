# Phase 2 兵种阵型 · Whole-branch Important 修复

## 状态

**DONE** — 未 git commit。未重生 golden。未改 `applyDamage` 第 6 参。未弱化既有测试。

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/troop_filter.test.ts tests/conflict.test.ts tests/universal_b_plus_p2.test.ts` | **51 passed**（troop_filter **16/16** 含新增 2；conflict **8/8**；p2 **27/27**） |
| `npx tsc --noEmit` | **PASS**（exit 0，仅 npm `devdir` warn） |

## 根因

`inflictStatus` 的 `sameType` 对同方向 `damage_boost` 做 `find` 时**不跳过反号**。方圆先挂 caused −20% `basic` 再挂 caused +16.8% `skill`；大赏 +30% 无过滤进来时命中 −20%，走正负相反 `pushStatus` 共存，+16.8% 从未进入取较高。终态三条叠加：普攻 −20%+30%，主动/追击 **16.8%+30%**。大赏先挂则同号冲突，终态正确——顺序依赖。

未把 `sameDamageBoostFilter` 套到 `sameType`（那会让无过滤大赏与衡轭 +50% basic 整段叠加）。只修反号 `find`。

## 修复

`src/engine/action.ts`：`sameType` 对 `damage_boost` 与属性类（既有正负共存规则）找**第一条同号**，跳过反号。随后仍走取较高 + `applyDamageFilterFromWinner`。反号无同号对手时 `sameType` 为空，走既有 `pushStatus` 共存。抽出 `conflictSign`。

## 测试

`tests/troop_filter.test.ts` 两条 `inflictStatus` 单测（真实 id `fangyuan` / `dashang_sanjun`，`sourceSkillType: 'command'`）：

1. 方圆对（−0.2 basic → +0.168 active+pursuit）再挂大赏 +0.3
2. 大赏先挂再挂方圆对

共同终态：−0.2 basic 仍在；同号胜者 0.3 无过滤；**不同时保留 0.168 与 0.3**；`statusMatchesHit` 对主动物理只匹配一条正 caused，rate 0.3。

既有「衡轭式 basic 高率替换无过滤」「无心恋战 −30% 与奋疾 +32% 共存」未改断言，随跑仍绿。
