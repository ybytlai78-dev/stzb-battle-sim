# Final Review：拆解通用 B 级以上 · 第一阶段受击链路

范围：仅本功能（spec `docs/superpowers/specs/2026-09-15-拆解通用B级以上-受击链路-design.md` + plan `docs/superpowers/plans/2026-09-15-拆解通用B级以上-受击链路.md`）。工作树含未提交的于禁/贾充改动，**不计入本评**。只读；未复跑全量（采信 controller：`npx tsc --noEmit` PASS，`npx vitest run` 911 passed / 0 failed，golden 未重生）。

## Strengths

- 引擎增量贴合「不抽总线」：`applyDamage` 第 6 参 `damageSource` 在全部生产调用点贯通（普攻 `'basic'`；物理/分兵/positional/策略/delayedOutput/DoT 两路/反击二次 `'skill'`）。缺省不传仍匹配 `basic` 钩子，旧直构 ctx 契约保留，且 `on_hurt_p1` 有锁定。
- `triggerOnHurt` 数组遍历 + `timing` 分流清楚：before 与 after 共用 `resolvingHurtHooks`，二次伤害两条都不跑；`grant_evasion` 成功路径 `try/finally` 不泄漏 flag；纯 `thisHitReduce` 不发 `skill_cast`、`rate<1` 仍发 `skill_trigger`。
- Task 3/4 评审阻塞项已落地：`incoming` 走 `Math.round`（含 0.3 非整除单测）；`counter` sameSource 刷新 `appliedRound`（第 2 回合重挂后 `actUnit` 仍能反击，有单测）。
- `speedScaled` 无 `growthRate` 用基值 0.116，与 `defenseScaled` 并列；被动 `endRound` 在 `actUnit` 跳过整次结算（含不发 `skill_cast`）；`roundStartRepeat` 窗口对称。
- 指挥 `chance` 放开后正确切开 `roundTrigger==='before_active'`（运筹决胜已在 `triggerBeforeActiveCommands` 逐段判定，避免双 roll），`fanji_zhice` 的 roundStartRepeat 仍走门控。
- 7 个战法与 plan 字面一致（含 `yiyou_dailai` `strategyScaled:false`/`growthRate:0`、挑衅 `duration:2`、空城 `endRound:2`）。`SKILL_ID_BY_NAME` 七条齐全。`firstOnHurt` 让联合类型测试可编译。
- `_classified.json` 五条 → `implemented` / `missingMechanics` 空 / `note: onHurt p1`；以诱待来/先声夺人未强补 classified。清点文首 **69**，`on_attacked=3`、`counter=2`、`attacked_boost` 已删，onHurt p1 能力说明与入库名单对齐。无 Web UI、未挂 T1～T9、未擅自重生 golden。

## Issues

### Critical（Must Fix）

（无）

### Important（Should Fix）

1. **空城「免疫当次」会被同回合后续攻击白嫖**
   - File: `src/engine/action.ts` `consumeEvasion`（约 L2030–2040）、`triggerOnHurt` before 分支（约 L3253–3256）、`dealAttack`/`physical_damage`/`split` 命中前 `consumeEvasion`
   - 空城成功路径：`grant_evasion` 加 1 层 → 当场 `consumeEvasion` 把 `stacks` 减到 **0** → `applyDamage` return。`tickStatuses` 只在**回合末**清掉 `stacks<=0` 的规避，状态会留在身上直到回合结束。
   - 同回合下一击（连击第二下、另一名敌军普攻/攻击战法）会在进入 `applyDamage` **之前**被 `consumeEvasion` 当成有效规避：`getStatus` 不看层数，`stacks:0` 仍返回 true，再减成 -1，发 `evasion_blocked`，**不再走 70% 判定**。
   - Spec 成功标准与已确认决策 4：70% 只免疫「打出这次判定的那一下」。当前实现是：第一次成功后，本回合剩余伤害近似全免。
   - 空城窗口测只锁 `evasion_blocked` 的回合 `<=2`，盖不住「当次」vs「本回合剩余」。
   - 修复：`consumeEvasion` 在 `!ev || ev.stacks <= 0` 时返回 false，并在减到 0 时立刻移除状态（这也会修掉旧规避「耗尽后同回合多挡一下」的既有漏洞）。空城 before 路径在 consume 成功后同样应卸掉 0 层。若因此碰到 golden：**先问用户**，不要自行重生。

### Minor（Nice to Have）

**先前 task-review 分流（不重开健卒第三条）：**

| 来源 | 现状 | 合并前？ |
|------|------|----------|
| T2 额外过滤无单测 | `endRound` 已被空城引擎测 + 战法窗口测覆盖；`onlyIfSourceTauntsVictim` / `maxStacks` 达上限不发 `skill_cast` / `startRound` 仍无引擎单测 | **later**（引擎实现正确） |
| T2 `maxStacks` 先发 `skill_trigger` 再跳过 `skill_cast` | 代码仍如此（`rollOnHurt` 在 `applyOnHurtEffect` 之前）。本批攻其不备默认 `rate=1` 不发 trigger，无战报噪音 | **later**（潜伏，带发动率的叠层钩子才会暴露） |
| T6 以诱待来 heal 只锁事件序 | 仍只断言「某次 taunt 下标早于某次 heal」，不锁 `taunt.targetId===carrier`、也不锁同一来源。引擎 `onlyIfSourceTauntsVictim` 实现正确 | **later** |
| T6 攻其不备 stacks 用 `skill_cast` 计数 | 仍用 round>0 的 `skill_cast` + `pendingVictim` 代理层数；`sameSource` 累加后多数不再发 `status_inflicted`。引擎 `maxStacks` 在 `applyOnHurtEffect` 提前 return | **later** |
| T6 健卒第三条与机制条重复 | **按指令不重开**。plan 已改成「同场可同时出现 damage + skill_trigger」 | — |

其余本评新账：

1. **反击之策「逐个 75%」走输出级一次判定**  
   Spec 战法节写「对锁定友军逐个 75%」；实现按 plan 把 `chance` 放在 `executeSkillOutputs` 整段输出上，两名锁定友军同成同败。成功标准强调的是「非每击 75%」（round_start 一次），与「每人独立 roll」不是同一句话。若产品要独立判定，需把 chance 下放到 per-target。

2. **反击之策窗口测 `triggerRounds.every(r<=3)` 在空数组恒真**  
   `tests/universal_b_plus_p1.test.ts` 约 L338。已有 `infRounds.length > 0` 兜底，建议再加 `triggerRounds.length > 0`。

3. **`triggerOnHurt` 顶注仍写「扣兵后」**  
   `action.ts` 约 L3180。`@param timing` 已补 before；首句过时，非行为问题。

4. **`applyTo:'source'` 要求来源必须是敌军**  
   `triggerOnHurt` 约 L3221–3223。回马/健卒反击/以诱待来挑衅在暴走友军普攻时不会打回去。沿用典韦距离过滤的旧形状，本批成功标准未写暴走。

## Plan alignment

| 计划项 | 判定 |
|--------|------|
| Task 1 类型：`counter` / `speedScaled` / `OnHurtConfig` 增量 / `onHurt` 数组 / 被动窗口 / `roundStartRepeat` 窗口 / `physical_damage.chance` / `firstOnHurt` / `statusName` | ✅ |
| Task 2：`damageSource` 传值、数组、locked、窗口、`onlyIfSourceTauntsVictim`、`maxStacks` on victim | ✅ |
| Task 3：before_damage / 当场规避 / `thisHitReduce` 乘算 + `Math.round` | ✅ 行为落地；空城 0 层残留见 Important |
| Task 4：`settleCounterOnHurt`、sameSource `appliedRound`、`speedScaled` 基值、被动/`roundStartRepeat` 窗口、指挥 chance | ✅ |
| Task 5：七战法 verbatim + `SKILL_ID_BY_NAME` | ✅ |
| Task 6：每战法 3 测、classified 5 条、清点 69、tsc/vitest/golden 门禁 | ✅ 交付物齐全；断言强度见 Minor triage |
| 指挥 chance **例外** `roundTrigger==='before_active'` | ✅ 相对原 plan 的有意偏离，Task 6 blocker 修复，避免运筹双 roll；符合本评 scope |
| 不改 Web、不挂 T1～T9、不 commit、成长率不编造 | ✅ |

无范围蔓延到第二阶段（兵种过滤等）或大幅度三张。

## Recommendations

- 先修 `consumeEvasion` 对 `stacks<=0` 的处理，并补：空城第一次成功后，同回合第二次普攻仍应走 70%（失败则照扣）。这是本批评审唯一建议合并前改的行为。
- 其余 Minor 可进下一阶段受击战法（垒实/诱敌）前再补引擎单测，不阻塞理解本批数据面。

## Assessment

**Ready / Needs fixes: Needs fixes**

**Reasoning:** 七战法、类型增量、classified/清点与计划对齐，controller 报告 tsc + 911 全绿、golden 未误伤。没有 Critical。但空城核心「70% 免疫当次」会被 0 层规避残留放大成同回合后续全免，属于应修的行为偏差；先前测试弱锁项仍在、引擎侧已实现，标 Minor 即可。

---

## Post-review fix（2026-09-15）

**Important #1 已修：** `consumeEvasion` 在 `stacks<=0` 时返回 false，减到 0 立刻卸状态。空城成功免疫当次后身上不再留 0 层规避；同回合第二击不会白嫖。`on_hurt_p1` 补 2 测（成功后无 evasion + 第二下扣兵；stacks:0 残留 `consumeEvasion` 返回 false）。全量 **913 passed / 0 failed**；golden 2/2 PASS，未重生。

**Assessment after fix: Ready**（其余仍为 Minor，不阻塞合并。）
