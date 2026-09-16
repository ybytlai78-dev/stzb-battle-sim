# Task 3 Review: decayFifths + selfPhysBoost + 输出级 range

**Reviewer check:** Diff package 为 curated excerpt。仅核对本任务 hunk：`types.ts` `fifthsBase`（~853）、`inflictStatus` 拷贝/detail（~1861）、sameSource `maxStacks`（~1599）、`decayFifthsOnHit` / `applySelfPhysBoost`（~2462）、`tickRoundStartStatuses` onRoundStart（~2154）、`applyDamage` 物理叠层（~4029）、`outRange`（~2623）、`tests/attack_scale.test.ts` 追加 describe（含 range 补洞）。同文件兵种阵型 / Task 1–2 未计入 Extra。未复跑 suite（采信 28 pass + tsc PASS）。

## Spec Compliance

对照 `docs/superpowers/specs/2026-09-16-拆解通用B级以上-受攻击缩放-design.md` §3–§4 / 不攻距离注，以及 `task-3-brief.md`（任务范围：引擎结算，**不**登录四张战法）：

| 要求 | 判定 |
|------|------|
| `fifthsBase` 冻结分母；挂上 `fifths = fifthsBase = decayFifths`，`baseRate = rate` | ✅ |
| 受匹配伤且 `actual > 0` 后 `fifths -= 1`；`rate = baseRate * fifths / fifthsBase`；`fifths <= 0` 移除 | ✅（`decayFifthsOnHit` 在 `consumeTakenCharges` 之后） |
| **不要**在 `tickRoundStartStatuses` 对 fifths 做回合衰减（仍只衰减 eighths） | ✅（JSDoc 写明） |
| `selfPhysBoost`：`onRoundStart` 在 eighths 后、`lockedCommands` 前；`onDealPhysical` 物理实际扣兵后；勿走被动 `roundStartRepeat` | ✅ |
| `maxStacks` 封顶停叠 | ✅（复用既有文德椒房 sameSource 闸，与 brief 等价） |
| `strategy_damage` / `physical_damage`：`ignoreRange` → ∞，否则 `out.range ?? skill.range`；疏数 recipient `atkRange` 未改坏 | ✅ |
| 中文 JSDoc；无 `Math.random`；未改 `skills.ts`；无 commit | ✅ |
| Gap fix：大营目标 + 友军占位使 live distance=3；无输出 `range` 的 miss 用例 | ✅（引擎未再改，测补洞） |

**Spec 全文四张入库 / p3 集成**属后续 Task，本闸按 brief 排除。

## Strengths

- 分母用冻结 `fifthsBase`，避免 `fifths/(fifths+1)` 二次衰减错误（brief 明确要求）。
- 衰减触发与 taken charges 同属「扣兵后消费」路径；物理不匹配策略 `damageType` 有测。
- `selfPhysBoost` 与火兽式 `roundStartRepeat`（行动阶段）切开，符合 design §4。
- 实现者自报 RED 阶段 `strategy_damage.range` 假绿，后续用阵型距离 + 负例补上——质量补救到位。

## Issues

#### Critical

（无）

#### Important

（无）

#### Minor

1. **fifths 衰减不发 `status_inflicted` 更新「剩余 N/5」** — 谋议 `eighths` 回合衰减会推新 detail；fifths 只静默改 `rate` / 到期 `status_expired`。brief 只要求挂上时 detail，行为正确；Task 4 入库恃强后战报可读性略逊。
2. **未断言 `fifthsBase`** — 首测只锁 `fifths===5` 与 rate 序列；分母冻结靠代码审查与序列间接证明。
3. **未单测 `actual === 0` 不衰减** — 实现有 `actual > 0` 闸；缺零伤用例。

## Assessment

**Spec compliance:** ✅ Pass  
**Task quality:** Approved

Task 3 范围内 design §3–§4 与输出级 range 已落地；range 假绿已用距离场景 + miss 用例修好。Critical 0 / Important 0。
