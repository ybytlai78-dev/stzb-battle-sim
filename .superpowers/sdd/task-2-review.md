# Task 2 Review: attackScaled 结算 + taken 受击消耗 charges

**Reviewer check:** Diff package is a curated excerpt（`action.ts` 含并发/前序未提交编辑）。仅核对本任务 hunk：`consumeAttackCharges` skip taken（~2394）、`consumeTakenCharges`（~2409）、`executeSkillOutputs` `attackScaled`（~2975）、`applyDamage` 调用点（~3901），以及 `tests/attack_scale.test.ts`。未复跑 suite（采信实现者 7/7 + tsc PASS）。

## Spec Compliance

- ✅ **`attackScaled` 结算**（design §1 / brief Step 3A）— `executeSkillOutputs` 在 `speedScaled` 之后、属性 buff 之前；`damage_boost | damage_reduce` 且 `attackScaled`；`growthRate !== undefined` 才按 `effectiveStat(caster, 'attack')` + 绝对值 `scaledValue`/`roundRate` 再恢复符号；无 `growthRate` 原 `rate` 直写。与 `speedScaled` 同口径。
- ✅ **直调 `inflictStatus` 不缩放** — 与 brief / speedScaled 一致；测试锁无 growthRate 与有 growthRate 直调均写原 rate。
- ✅ **经 `triggerActiveSkill` → `executeSkillOutputs`** — 无 growthRate 保持 −0.5；有 growthRate（0.08 / 0.026 / 攻 180）→ `toBeCloseTo(0.1)`。
- ✅ **taken charges 受击消耗**（design §2 / brief Step 3C）— 新 `consumeTakenCharges`：`direction === 'taken'` + `charges` + `statusMatchesHit`；`actual > 0` 时在扣兵与伤兵拆分之后、`triggerIgniteOnHurt` 之前 −1，到 0 移除。规避提前 return 不走。当次伤害在入参已算完 → 当次仍计入。
- ✅ **物理不扣策略 taken** — `statusMatchesHit` 按 `damageType` 过滤；测试覆盖。
- ✅ **`consumeAttackCharges` 只扣 caused** — `if (s.direction === 'taken') continue;`；未导出。
- ✅ **未越界** — `action.ts` 无 `decayFifths` / `selfPhysBoost` / `strategy_damage.range` 实现；未改 `skills.ts` / Web；无 commit（报告 + package）。
- ✅ **约束** — JSDoc 中文；无 `Math.random`；测试侧 `troops` 不进 `Partial<General>` 的偏离合理（tsc）。

## Strengths

- 插入位置与 brief 伪代码一致，缩放公式对齐既有 `speedScaled`。
- taken / caused 消耗路径拆开清晰：攻击侧 `consumeAttackCharges`、受击侧 `consumeTakenCharges`，避免互相误扣。
- TDD 证据完整（RED 2 fail / GREEN 7 pass）；测试覆盖无 growthRate、有 growthRate、策略消耗、物理跳过、攻击者不经 `applyDamage` 扣 caused。
- 实现者自审注明「省略 `damageType` 时 `statusMatchesHit` 不限制该维」与并发 Task 3 边界，便于后续任务。

## Issues

#### Critical

（无）

#### Important

（无）

#### Minor

1. **「当次仍计入」断言偏弱** — 测例对 `applyDamage` 传入固定 100，只断言扣兵 100 且 charges 移除；未经 `damageBoosts` 锁「+20% 已进当次伤害」。行为上由「先算 boost 再 `applyDamage`、后扣 charges」保证，与 brief 原文一致，但测名略超断言。
2. **`consumeAttackCharges` skip taken 无直接测例** — brief 禁止导出该函数，第三测改写为 `applyDamage` 路径后，攻击者身上 taken 不会被 `consumeAttackCharges` 误扣这一点仅靠代码审查，无运行时覆盖。
3. **省略 `damageType` 的 latent 语义** — `statusMatchesHit` 在 `hit.damageType` 缺省时不限制 → 会消耗 strategy taken。现有引擎调用均传入类型；实现者已记录。非本任务引入的匹配规则，但新消费点放大了该脚注。

## Assessment

**Spec compliance:** ✅ Pass  
**Task quality:** Approved

Task 2 范围内 design §1–§2 与 brief Step 3 均已落地；质量可放行后续任务。Critical 0 / Important 0。
