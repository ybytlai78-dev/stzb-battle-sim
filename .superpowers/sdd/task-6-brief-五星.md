### Task 6: 六人机制 / 数值测（每战法补齐到 ≥3）

**Files:**
- Modify: `tests/main_skills_b20.test.ts`

**Interfaces:**
- Consumes: 六个真实战法 id；`withSkills` / `level40` / 强制改 `ctx.skills` 的 `triggerRate` / `chance`
- Produces: 无生产代码。禁止编造成长率断言。

强制发动：把 `ctx.skills` 里该战法 `triggerRate` 改成 `1`（区间则改成 `1` 或 `[1,1]`）；`chance_group.chance` 改成 `1` 或 `0`。

准备战法强制释放：`triggerRate: 1` 后 `actUnit` 进入准备，再把 `currentRound` +1（1 回合）或 +1 两次（2 回合）再 `actUnit`。

- [ ] **Step 1: 写失败测试（此时战法已在 registry，测的是事件口径）**

**落首箭** ②：强制释放后至少一段 rate 300 的物理（任意单体）+ 一段打大营的物理 + 大营有混乱。可用 `dummy` 三敌（前锋/中军/大营），`withSkills` 把沙摩柯挂 `luoshou_jian` 并改 triggerRate=1。③：把第一目标钉成大营（敌军只留大营，或前锋中军阵亡）→ 大营至少两段 `damageType:'physical'` 且 `skillId === 'luoshou_jian'`。

**长坂之吼** ②：真实 `changban_zhihou` 走 2 回合准备时序（可复用 Task 2 的 round 递增）。③：步兵载体打骑兵目标，伤害事件 `modifiers.reduce` 无 `troop_counter`。

**烽火覆周** ②：把 `chain.chance` 改成 `1`、`decay` 改成 `0.5`（或 0.2 但 chance=1 会打 60/40/20 三段），`triggerRate` 改成 `1`；断言 `strategy` damage > 1 段。③：谋略 80 vs 200 的 **伤害率**相同（无 growthRate）。比较 `breakdown.main`，不要比整份 breakdown（谋略基础仍随施法者谋略变）。

**虎步关右** ②：强制发动后自身有 `charges:1`、`rate:0.7`、`damageType:'physical'`；打出一次物理（普攻或物理战法）后 charges 消失。③：策略伤害不消耗、也不吃这 70%（`modifiers.caused` 无 0.7）。

**火兽冲锋** ②：`roundStartRepeat` 里 `chance_group.chance=1`；`actUnit` 后有 160% 物理 + charges basic +1.6；再打普攻，`modifiers.caused` 同时含 0.8 与 1.6。③：`chance=0` 时无 160% 刀、无 charges 层；常驻 0.8 仍在。开战用 `triggerPassiveSkills(..., 'battle_start')`。

**文德椒房** ②：郭皇后 `withSkills` 带一个 `triggerRate:1` 的简单主动；`actUnit` 后距离内 2 友军有 strategy caused +0.1。③：第二回合再成功可重选；同一人 `stacks <= 3`；准备主动进入准备的那一回合不叠，释放回合叠（可复用 Task 4 口径，改用真实 id `wende_jiaofang`）。

- [ ] **Step 2: 跑测试确认失败或补实现缺口**

Run: `npx vitest run tests/main_skills_b20.test.ts`
Expected: 装配已过；机制测若失败，只允许修引擎缺口，禁止改 spec 数值。

- [ ] **Step 3: 修到全绿**

Run: `npx tsc --noEmit && npx vitest run tests/main_skills_b20.test.ts`
Expected: 每战法 ≥3 条全绿。

- [ ] **Step 4: 回归**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿。golden 无误伤则不要删 `tests/__snapshots__/golden.json`。

若全量 suite 只因并行会话的 `tests/attack_scale.test.ts` 失败，标 DONE_WITH_CONCERNS；**b20 必须全绿**。

跳过 Commit。
