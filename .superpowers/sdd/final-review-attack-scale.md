# 第三阶段受攻击缩放 · Whole-branch Review

**Base:** working tree（无 commit；未 `git diff HEAD`）  
**Head:** 本计划交付文件（工作树与并行五星主战法混杂，只评 package 列出的路径与四张新战法）  
**对照：** `docs/superpowers/specs/2026-09-16-拆解通用B级以上-受攻击缩放-design.md` + `docs/superpowers/plans/2026-09-16-拆解通用B级以上-受攻击缩放.md` Tasks 1–5 + Global Constraints  
**范围：** `types.ts` 新字段、`action.ts` 钩子、四张 `SKILL_REGISTRY`、`SKILL_ID_BY_NAME`、`attack_scale` / `universal_b_plus_p3`、classified / 清点 / `gen_skill_data` 产物  
**证据：** 各 task 报告 + package（p3+attack_scale 24/24，golden 2/2）。本审查只读、未复跑全量 vitest。

Task reviews 分诊：Task 1–5 均为 Approved，Critical 0 / Important 0。Task 3 range 假绿已用大营+占位距离 3 + 负例修好，不再开放。全量 7 fail 属并行五星（b20 未挂槽 + 长坂之吼 `prepareTurns:2`），**不要求本计划收口五星**。

---

### Strengths

- 架构按 spec 方案 A：只加可选字段，不按 `skill.id` 特判、不抽新战法类型。`attackScaled` 对齐 `speedScaled`（`growthRate !== undefined` 才按生效攻击缩放，无成长率用基值）；taken charges 与 caused charges 拆成两条消耗路径，避免文伐被 `consumeAttackCharges` 误扣。
- `decayFifths` 用冻结 `fifthsBase` 做分母（`rate = baseRate × fifths / fifthsBase`），避免 `fifths/(fifths+1)` 二次衰减错误。触发点是受匹配伤且 `actual > 0`，**不**走谋议宏图的回合开始 eighths 衰减。
- `selfPhysBoost` 与被动 `roundStartRepeat`（行动阶段、火兽冲锋）切开：`onRoundStart` 挂在 `tickRoundStartStatuses`（eighths 之后、`lockedCommands` 之前），`onDealPhysical` 挂在 `applyDamage` 物理实际扣兵后。普攻 / 战法物理 / 分兵 / 反击都走 `applyDamage(..., 'physical')`，无需再挂钩子。`maxStacks` 复用既有 sameSource 闸。
- `strategy_damage.range` / `ignoreRange` 与 `physical_damage` 同口径；疏数 `attacker === 'recipient'` 仍用内部 `atkRange`。range 测已从「前锋对前锋距离 1 假绿」改为大营目标 + 友军占位（live distance=3），并有无输出 `range` 的 miss 负例。
- 四张与 extra 满级口径一致：万箭无准备 / 35% / 群体 2 / 物理 150% / 策略造成 −50% `attackScaled` duration 2；文伐 `[0.2, 0.4]`、228% 受谋略 **2.1%/点**、打完再挂 taken +20% charges 1；不攻复用整场怯战 + 策略 caused +25% + `roundStartRepeat` 距离 5 单体 83%（无成长率）；恃强 taken −30% 五份 + 物理叠层 3.4%/12。未编造受攻击成长率。未登录百战无怯。
- 入库同步：`SKILL_ID_BY_NAME` 四行；classified 不攻/万箭/文伐 → `implemented` + 新增恃强；清点 60→57，删 `no_basic` / `per_round_strategy`，`next_damage` 仅闪击、`random_single` 仅十面埋伏；grades/desc 含四 id（A/B/S/A）。未改 Web UI 逻辑、未挂 T1～T9、未重生 golden、无 `Math.random`、无 commit。
- 测试钉真实行为而非 mock：`attackScaled` 经 `triggerActiveSkill`（无成长率 −0.5；攻 180 / 0.026 → 0.10）；taken 策略扣兵后移除、物理不扣、applyDamage 不扣 caused；decayFifths 30→24→18→12→6→0；selfPhysBoost 回合开始 + 物理叠层封顶 12；不攻 `run` 2 回合有怯战、有 `bugong` 策略伤害、载体无 `attack_hit`。

---

### Issues

#### Critical (Must Fix)

无。

#### Important (Should Fix)

无。四张字段、引擎钩子与 spec §1–§6 / Success Criteria 对齐。全量 7 fail 不计入本计划。

#### Minor (Nice to Have)

既有 per-task Minor 分诊：**合入前不必修**。

1. **fifths 衰减不发 `status_inflicted` 更新「剩余 N/5」**（`action.ts` `decayFifthsOnHit` ~2466）  
   谋议 `eighths` 回合衰减会推新 detail；fifths 只改 `rate`，到期 `status_expired`。挂上时 detail 正确。战报可读性略逊，行为正确。

2. **「当次仍计入」断言偏弱**（`tests/attack_scale.test.ts` ~93）  
   `applyDamage` 传入固定 100，只锁扣兵 100 + charges 移除，未经 `damageBoosts` 证明 +20% 已进当次伤害。行为由「先算 boost 再 `applyDamage`、后扣 charges」保证。文伐 228% 不吃当次 +20% 由输出顺序 `['strategy_damage','inflict_status']` 锁定，与 Task 5 brief 一致。

3. **`consumeAttackCharges` skip taken 无直接测例**  
   函数未导出（brief 禁止）。第三测改写为 applyDamage 路径后，攻击者身上 taken 不被误扣仅靠代码审查。

4. **未断言 `fifthsBase`；未单测 `actual === 0` 不衰减**  
   五次序列间接证明分母冻结；零伤闸在实现里有 `actual > 0`。

5. **恃强 p3 窗口未直接断言 `runBattle` 终态 fifths/stacks**（`tests/universal_b_plus_p3.test.ts` ~309）  
   brief 写 `run(...,1,1)` 后读载体；实现先 `run` 查 `status_inflicted`，再 `makeCtx` + `triggerPassiveSkills` / `tickRoundStartStatuses`。机制覆盖仍充分。引擎单测已锁五份衰减与 12 层封顶。

6. **恃强 extra `distance:5`，引擎 `range:1`**  
   跟随 spec/brief 的 self 被动口径；展示距离与自目标 range 差属既有约定，非编造。

7. **`selfPhysBoost.attackScaled` 不经 `executeSkillOutputs`**（`action.ts` `applySelfPhysBoost` ~2488）  
   叠层走直调 `inflictStatus`，与 `speedScaled` 直调路径一致：无 `growthRate` 用基值 0.034。本批正确。类型上 `selfPhysBoost` 也没有 `growthRate` 字段，后续若要受攻击缩放需在叠层函数里补缩放，而不是指望 inflict 分支。

8. **生成 JSON 缺末尾换行**  
   `skill_grades.json` / `skill_desc.json` 脚本产物格式瑕疵，不影响四 id 存在与文案口径。

---

### Recommendations

1. 本计划范围内可视为完成。合入本批时不要把五星 `main_skills_b20` / 长坂之吼失败算作回归债；那条线单独收口。
2. 有余力时给文伐补一条集成测：同目标先挂 taken +20%，下一次 `strategy_damage` 的 `modifiers` 含该层，且 charges 随后为 0。给 fifths 补 `actual===0` 与 `fifthsBase===5` 断言。
3. 若战报要显示恃强「剩余 4/5」，对齐谋议 eighths：在 `decayFifthsOnHit` 衰减后推 `status_inflicted` detail。
4. 本审查未复跑套件。若与五星拆开合入，建议只跑 `npx vitest run tests/attack_scale.test.ts tests/universal_b_plus_p3.test.ts` + golden；不要为这四张重生 golden。

---

### Assessment

**Ready to merge?** Yes（对本计划交付）

**Reasoning:** spec 四张与五项引擎钩子均已落地且有行为测；未知成长率未编造；清点/classified/grades 同步。无 Critical / Important。全量 7 fail 与 golden 2/2 的裁决按用户指示：不要求本计划完成五星。

**Overall verdict:** ready  
**Critical:** 0  
**Important:** 0
