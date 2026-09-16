# Phase 2 兵种阵型 · Whole-branch Review

**Base:** e16ca80  
**Head:** working tree（无 commit）  
**对照：** `docs/superpowers/specs/2026-09-15-拆解通用B级以上-兵种阵型-design.md` + plan Tasks 1–6 + Global Constraints  
**范围：** types / action / skills / SKILL_ID_BY_NAME / troop_filter + p2 测试 / 清点 / classified；全量 954/0 与 golden 2/2 以实现者报告为准（本审查未重跑套件、未跑 git）。

---

### Strengths

- 架构按 spec 方案 A：不抽 `FormationSkill`、不按战法名特判；可选字段缺省保持旧行为。`teamTroopFilter` 读部署名单（含阵亡）、失败不发 `skill_cast` 且不登记 `lockedCommands`；`troopTypes` 在 `onlyIfOverlapPrevious` 之后滤池。
- 增减伤分流完整接到 spec 表内 calc 路径：普攻 / 分兵 `basic+physical`，主动·追击·指挥物理 / 策略 / DoT / positional / 反击 `skill` + 对应 `skillType`。分兵 `applyDamage` 第 6 参仍为 `'skill'`，增减伤上下文为 `damageSource:'basic'`，满足 Global Constraints。
- `sameDamageBoostFilter` 正确拆开方圆/锋矢同源两条 caused（避免 −0.2+0.168 合成 −0.032）；冲突替换用 `applyDamageFilterFromWinner` 写入或 delete 过滤维，避免残留。
- 疏数 `attacker:'recipient'`：跳过整段 `chance`、逐骑兵士气判定、从锁定友军滤兵种再对敌军 `single`，`sourceId` 为骑兵、不把 `creditToId` 改成施法者。鹤翼 `oddRounds`、飒沓 `split.charges` 跳回合递减均按计划落地。
- 九战法字段与 extra 满级基值一致：无编造 `growthRate`；锋矢仅 `active`、方圆含 `pursuit`；白刃策略段拆 ally/enemy `all`；全军突击 `physical_damage` 省略非法 `targetSide`、靠 `targetMode:'single'` 从敌军重选（controller 决议）。
- 入库同步干净：`SKILL_ID_BY_NAME`、classified 九条 `implemented` + `note: "troop filter p2"`、清点 69→60 并删 `troop_type`/`troop_next`、`gen_skill_data` 写入 grades/desc。未改 Web UI 逻辑、未挂 T1～T9、未碰 golden、无 `Math.random`、无 commit。
- 测试面：`statusMatchesHit` 五条 + 冲突拷贝两向；指挥机制多用 `prepCommand` 钉 statuses，避开发动率噪声。

---

### Issues

#### Critical (Must Fix)

无。

#### Important (Should Fix)

1. **`sameType` 冲突对「一法两条 caused」顺序依赖，方圆/锋矢 + 大赏会叠错**
   - File: `src/engine/action.ts:1536-1544`（`sameType` find 不看过滤维）、`1630-1633`（正负相反则直接 `pushStatus` 返回）
   - What’s wrong: `sameSource` 已按 `damageSource`/`skillTypes`/`damageType` 拆条，但 **不同战法、同指挥类型** 的 `sameType` 仍 `find` 第一条同方向 `damage_boost`。方圆准备阶段顺序是 caused −20% `basic` → caused +16.8% `skill`。大赏三军 +30%（无过滤）进来时 `find` 命中 −20%，被当成「正负相反、共存」，+16.8% 段从未参与取较高。结果三条同时在：普攻 −20%+30%，主动/追击 **16.8%+30% 叠加**。
   - 若大赏先挂、方圆后挂：+16.8% 会与 +30% 同号冲突被拒。同一配队因准备阶段速度/站位不同，主动增伤差约 17 个百分点。锋矢同构（−25% basic + 18% active）。
   - Why it matters: 阵法 + 大赏是真实配队；这是本批引入「一法多条 caused」后 **sameType 未同步** 的新 bug，会直接进战斗数值。孤立九战法测试覆盖不到。
   - How to fix: `sameType` 对 `damage_boost` 找 **同号** 的第一条（跳过正负相反），再走取较高替换。最小补测：先挂方圆再挂大赏，断言主动 hit 只吃 30%、不叠 16.8%；对调施加顺序结果相同。
   - 过滤维 vs 无过滤的「取较高」仍然粗糙（衡轭 +50% basic 可能整段挡住大赏的战法增伤）——那是旧「每类型每方向一条」模型的极限，可另开口径；**本条顺序依赖必须先修**。

#### Minor (Nice to Have)

既有 per-task Minor 分诊：**合入前不必修**。新发现的文档/死字段一并记下。

1. **主动路径 `teamTroopFilter` 失败仍发 `skill_target`**（`action.ts:3032-3044`）  
   与指挥门闩不对称。本批带 `teamTroopFilter` 的只有疏数/衡轭/鱼鳞（一类指挥），两条主动无阵容门闩。不挡合并。

2. **`groupCount` 仅友军指挥分支透传**  
   本批指挥全是 `targetSide:'ally'` `groupCount:3`；敌军/lockMode 缺省 2 不影响这 9 个。

3. **OnHurt `damageSource: 'basic'|'any'` vs 本批 `'basic'|'skill'`**（`types.ts`）  
   两套语义、符合 brief；后续实现过滤时勿混用。非本批行为 bug。

4. **`damage_reduce` 冲突拷贝未单测**  
   与 `damage_boost` 共用 `applyDamageFilterFromWinner`；本批鱼鳞走的是 taken `damage_boost` 而非 `damage_reduce`。风险低。

5. **`split charges` 测 `remaining:999` 偏弱；连击多 hit 可能超额分兵**（`action.ts:1381-1387`）  
   `splitStatus` 循环外取一次，charges 到 0 后仍可能对下一 hit 再 `executeSplitAttack`。本批飒沓 `charges:2`、连击至多 2 次，打满正好耗尽，不触发超额。可后续用 `remaining:1` 证明 skip，耗尽后 `break`。

6. **方圆②主断言走 `prepCommand` 而非 `run` 终态 `damageSource`**  
   与 brief 字面略偏，语义等价且更稳。spec「普攻减伤不吃主动物理 / 锋矢不吃追击」靠 `statusMatchesHit` 单测 + 字段断言，没有 `calcDamage` 集成对比。

7. **`fireActive` 最多 80 seed**  
   装配测不依赖发动；morale 140 下失败概率可忽略。失败时 `ctx` 为 `undefined` 的报错不够直观。

8. **生成 JSON 缺末尾换行**  
   `skill_grades.json` / `skill_desc.json` 脚本产物格式瑕疵，不影响 dataIntegrity。

9. **JSDoc 战法名写错**  
   `types.ts:487` `oddRounds` 写「鱼鳞」，应为鹤翼；`types.ts:300` / `action.ts:1385` 次数型分兵写「鱼鳞」，应为飒沓如星。鱼鳞无分兵。

10. **`split.strategyScaled` 已进类型，`pushStatus` 未拷贝、结算未缩放**（`action.ts:1916+`）  
    鹤翼无 `growthRate`、用满级 49% 基值，本批数值正确。字段目前是死的，第三阶段若补成长率会漏。

---

### Recommendations

1. **先修 Important #1**，再补「方圆/锋矢 × 大赏」双向施加顺序的 `inflictStatus` 单测（不要只靠 `statusMatchesHit`）。
2. 有余力时加一条集成测：同种子、同面板，方圆步兵普攻伤害 < 无方圆；主动物理伤害 > 无方圆；追击吃方圆、不吃锋矢。这是 spec Testing Strategy 原话，当前仍是字段级近似。
3. 后续若要让「无过滤指挥增伤」与「仅普攻 +50%」共存，需要改冲突模型（按 hit 上下文重叠判断），不要在本批用 `sameDamageBoostFilter` 直接套到 `sameType`——无过滤与 basic 过滤维不同，会变成大赏与衡轭整段叠加。
4. 修正 oddRounds / split.charges 的 JSDoc 战法名，避免下一阶段抄错鱼鳞。
5. 全量 954 与 golden 2/2 未在本审查复跑；合入前建议在修复冲突后跑 `npx tsc --noEmit && npx vitest run`，确认无误伤再保持 golden 不重生。

---

### Assessment

**Ready to merge?** With fixes

**Reasoning:** 九战法、兵种门闩、增减伤分流、recipient/oddRounds/charges 与入库清点均对齐 spec 与 Global Constraints，孤立行为可测。合入前必须修 `sameType` 对负向 basic 的误匹配，否则方圆/锋矢与大赏等指挥增伤会按准备阶段顺序错误叠加；其余已记录 Minor 不阻塞。
