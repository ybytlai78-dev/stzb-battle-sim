# AGENTS.md

本文件为 Claude Code 在本仓库工作时提供指引。

## 项目性质

《率土之滨》式 SLG 回合制战斗模拟的**纯逻辑 TypeScript 引擎**。无任何 UI / Unity 依赖（本项目的 UI 设计由其他专用 agent 负责，Claude 只做逻辑/系统层）。目标是可单测、可 golden test、可被任意客户端调用。

工作流：先读调研文档 → 与用户确认细节 → 确认后实现。战法/武将数据一律**严格按仓库根目录的调研文档**，不得编造。

## 常用命令

```bash
npm run dev -- T7_LOADOUT          # 跑指定内置测试集，输出文本战报（默认 T1_PURE_ATTACK）
npm run dev -- --json T7_LOADOUT   # 同时输出 JSON 战报
npm test                            # 全部测试
npx vitest run tests/conflict.test.ts   # 跑单个测试文件
npx vitest run -t "连击"           # 按测试名过滤
npx tsc --noEmit                    # 类型检查（strict）
```

**golden 快照**：`tests/__snapshots__/golden.json` 锁定全部固定测试集的输出。引擎行为的有意变更会令其失败——确认变更是预期后，删除该文件再跑一次即可重新生成。任何让 `Math.random` 进入引擎的改动都是错误（见下）。

## 工作树与提交（DSH，2026-09-18 起）

开发在 **DSH 工作树**（`.dsh/worktrees/<hash>/战斗系统`）内进行；旧的《多工作树开发公约》（engine / mechanic / growth 三棵树、生成物不进分支）**已废止并删除**，其合并流程不再适用。

- **一个工作区一个分支**：当前分支 `feat/hero-mechanics`（从 `main` 起）。每完成一个武将 = 一次提交 + `git push origin`。
- **当前主线**：按 `docs/下架武将清单.md` §1.2「补 1 个机制」的武将逐个实现主战法（用户 2026-09-18 口径）。
- **任务承接**：新增武将主战法 = `src/data/skills.ts` 定义 + `scripts/build_heroes_seed.mjs` 的 `SKILL_ID_BY_NAME` 挂槽 + `tests/main_skills_bN.test.ts`（每战法 ≥3 测试）。受属性缩放（受谋略/受攻击/受速度）的段**成长率留空**：`strategyScaled` 等标记在，`growthRate` 不写（可选字段）或用 `0`（必填字段：DoT / heal / grant_*），并登记 `src/data/listing.ts` 的 `OFFLINE_MAIN_SKILLS` → 武将暂下架，等成长率补齐再移出。
- **生成物随提交入库**（`web/data/*.json`、`scripts/seed_heroes.sql`）：保证每个提交自洽、`npm test` 全绿。生成脚本已幂等——无源改动时重跑无 diff（仅行尾漂移），误跑可直接 `git checkout` 丢弃。
- **数据链**（本机 MySQL 不可达时自动回退 `web/data/heroes.json`，是当前状态）：

  ```bash
  node scripts/build_heroes_seed.mjs        # SKILL_ID_BY_NAME → scripts/seed_heroes.sql
  node scripts/gen_skill_data.mjs           # → web/data/skill_grades.json / skill_desc.json
  node scripts/seed_db.mjs                  # MySQL 可用时灌库
  node scripts/export_web_data.mjs          # MySQL 可用时导出 web/data/heroes.json
  node scripts/sync_hero_mainskill.mjs <heroId> <skillId>   # MySQL 不可用时等效写 heroes.json
  ```

- **工作树 DB 隔离**按 DSH 路径推导：`.dsh/worktrees/<hash>/...` → 库名 `stzb战斗系统_dsh_<hash>`；库不存在时自动回退 JSON。`src/data/heroes.ts` 与 `scripts/db-config.mjs` 两处逻辑须同步改。

## 数据权威来源

| 数据 | 文件 | 权威文档 |
|------|------|----------|
| 可学习战法（数值/类型/距离/发动率/目标） | `src/data/skills.ts` | `dateyuan/通用战法调研.md` |
| 武将面板值 / 攻击距离 | `src/data/heroes.ts` | `dateyuan/武将数据调研.md` |
| 伤害公式 | `src/engine/formulas.ts` | `dateyuan/战斗伤害公式调研.md` + `dateyuan/谋略战法受谋略成长调研.md` |
| **兵力恢复公式（§四：恢复率 + 恢复值，含 `calcHealAmount`）** | `src/engine/formulas.ts` | `dateyuan/战斗伤害公式调研.md` §四 |
| **待补充机制清点（`_classified.json` 200 条通用战法 = 原始调研 199 + 后补「恃强淬锋」；现 190 已实现 / 10 skipped 全为 C/D；另有 4 个 A/S 清单外未实现见其 §五）** | `docs/待补充机制清点.md` | 由 `scripts/seed_universal_skills.mjs` 的 `mechanism_key` 联动 DB `skills.mechanism_key` 列（⚠️ 勿重跑 `scripts/_classify.mjs`，会覆盖清单） |
| **下架武将 / 战法清单（58 个下架武将 + 31 个下架战法的卡点、缺失机制分布）** | `docs/下架武将清单.md` | 由 `npx tsx scripts/gen_offline_report.mts` 按 `listing.ts` 口径生成 |

`dateyuan/战斗系统设计文档.md` 是决策记录与整体设计（v0.1 起步，现引擎已超出其范围：指挥/被动/追击/状态/冲突已实现）。

## 引擎架构（读多个文件才能拼出全貌）

核心数据流：`combat.ts`（主循环，生成事件流）→ `report.ts`（渲染 JSON/文本）→ `stats.ts`（从事件流汇总普攻/战法统计）。引擎内一切确定性输入来自配置，随机只经 `rng.ts`（mulberry32，种子可复现）。

### 战斗流程（率土标准流程）

```
准备阶段：速度排序 → 一类指挥战法（释放一次，按准备时兵力/属性结算）
每回合：先比「带 priorityRounds 的单位」再比其余（均按速度/站位排序）→ 逐个行动
单将行动：被动 → 指挥预备判定（战必/措手/白衣 目标行动时）→ 二类指挥判定（奇兵拒北）→ 混乱检查 → 怯战检查 → 准备战法检查 → 主动战法 → 普通攻击（连击至多 2 次）→ 追击战法
回合结束：tickStatuses 状态递减/移除
```

同速站位先手：前锋 > 中军 > 大营。带 `priorityRounds`（先驱突击）的单位优先行动：回合内先分组按速度排序（优先组先、其余组后）。

### 战法系统（`src/engine/types.ts` 的 discriminated union）

- **Skill** = SimpleActive / PreparedActive（1回合准备）/ Pursuit / Command / Passive，均带 `tags: EffectTag[]`
- **CommandSkill 特殊字段**：
  - `phase`：`prep`（一类指挥，准备阶段释放一次）或 `round`（二类指挥，正式回合武将行动时判定）
  - `roundRepeat`：一类指挥的预备负面（战必前3回合90%、措手第4回合起80%、白衣前2回合）。准备阶段锁目标存入 `ctx.lockedCommands`，目标行动时按概率判定
  - `delayedOutput`：一类指挥延迟结算（白衣第3回合），准备阶段按当时兵力/属性预存伤害（`storedDamage`），到回合直接打出
  - `retainAfterDeath`：一类指挥施法者阵亡后效果仍生效（白衣/先驱/战必）
  - `dynamicTriggerRate`：二类指挥动态发动率，未生效 +increment、生效重置 base（奇兵拒北 30% 起步 +5%）
  - `priorityRounds`：前 N 回合优先行动
  - `positional_physical_damage` 输出：按位置选目标（`positions: ['大营','中军']`），`source: 'self' | 'fastest_ally'`（借速度最高友军，不耗行动、不受混乱），`rate` 可为区间每次随机
- **状态系统**：每个 Status 实例都携带 `sourceSkillType` + `sourceSkillId`

**指挥战法分类（务必遵守）**：
- **一类指挥**（`phase:'prep'`）：只在准备阶段释放一次。按准备阶段的兵力/属性结算伤害（一次性），施法者兵力为 0 后效果仍存在。典型：先驱突击、战必断金、白衣渡江
- **二类指挥**（`phase:'round'`）：正式回合也会判定。看局内实时数据，施法者兵力为 0 后无法生效。典型：奇兵拒北

### 重复施加 / 冲突规则（`action.ts` 的 `inflictStatus`）

**同源（同一战法）重复施加**——先判状态类型：

| 类别 | 同源重挂 | 说明 |
|------|----------|------|
| 数值型（属性 buff / 减伤 / 增伤 / 发动率 / 士气 / 攻击距离） | **默认刷新**：数值替换为本次的 `amount`/`rate`（不回加），`remaining = max(旧, 新)` | 官方文案**没写**「可叠加 / 层数」的走刷新（如 列营守险 四维）；**唯一例外 = 心战为上·士气降低**（用户确认可叠加，见下方特例框） |
| 同上，但带**显式叠层标记** | **累加** | `CreateStatus.stack: true`（疮痍累身 / 步步为营 / 谋议宏图 / 未笄难言 / 三军夺帅 / 潜谋远计 / 心战为上…）或既有 `damage_boost.stacks`+`maxStacks`（银龙冲阵 / 令明负榇 / 文德椒房 / 攻其不备 / 恃强淬锋 / 九伐中原 / 徽言龙凤 / 同仇敌忾）、`chargesStack`（七步释嫌） |
| 控制（混乱/暴走/怯战/犹豫/连击） | 刷新 `remaining`（不新增实例、不叠加） | — |
| 概率规避 `evade_chance`（列营守险 预备规避） | **同源也冲突被拒**：push `status_conflict`（「规避效果冲突…先施加者生效」）并 return，不施加、不刷新、不补 `charges` | 状态类口径 |
| 规避 `evasion`（层数式必挡，雪奋短兵） | 同源加层（官方「层数」口径） | 不按回合递减 |
| DoT（sorcery/burning/panic/curse/ignite）、`first_aid`、`rest` | **本次不动**（各自专门逻辑：挂上时结算 / 指挥急救互斥 / 刷新或取较高） | — |
| 消耗制（`ignore_evasion`/`control_spread`） | 只刷新、不叠加（不按回合递减） | — |

**同类型不同战法** → 冲突：控制 / 概率规避**先施加者生效**（`status_conflict`）；增益数值取较高替换（分正负号：属性类/增减伤/士气反号共存）。
**不同类型** → 各自独立计数共存。
僵尸清理 hack（施加前清 `remaining ≤ 0` 的同名状态）已删除：默认刷新会把僵尸实例数值替换、`remaining` 取 max，怀橘遗亲等每回合重挂仍是原值。

> **唯一特例 —— 心战为上·士气降低 = 显式可叠加（用户确认）**：官方原文「士气降低 5 点…累计可触发 9 次」
> **未写**「可叠加 / 层数」，按上表本应走刷新；但**用户 2026-09-19 确认可叠加**（最多 9 次 → 净士气 −45）。
> 该效果按显式标记落库：施加模板带 `CreateStatus.stack: true`（`action.ts` `triggerHealOnDamageCommands`），
> 走「显式叠层 → 数值累加」分支，**不是靠特判**保留。除本条外任何未标 stack 的战法一律刷新不叠加。

### 状态语义（容易写错，务必遵守）

| 状态 | 含义 |
|------|------|
| 混乱 | 无法释放主动战法 + 普通攻击（+追击）；**被动/指挥仍正常判定**（孙权被混乱仍可青囊回血、步步叠加） |
| 暴走 | 攻击与战法目标**不分敌我**（目标池 = 友军+敌军，不含自己） |
| 怯战 | 无法普通攻击 |
| 犹豫 | 无法发动主动战法 |
| 连击 | 本回合**至多两次**普通攻击（非乘算） |

## 约定

- `[SerializeField]` 等 Unity 规则不适用；本项目是纯 TS
- 新增战法必须同时加 `tags`（冲突判定用）
- 固定测试集集中在 `tests/fixtures.ts`（T1~T9），CLI 与 golden test 共用；新机制测试写在独立测试文件（如 `conflict.test.ts` / `status.test.ts` / `mechanisms.test.ts`）
- **武将测试统一 40 级面板 + 兵力 9000 + 自由加点**：用 `level40(hero, { attack: 40 })` 生成（成长值来源 `dateyuan/hero_growth_verified.json`），避免手写面板。属性 = 初始 + (L-1)×成长（四舍五入）+ 加点
- 冲突/状态机制测试直接用 `inflictStatus` 等单元函数做确定性断言，不依赖战法发动率 RNG

---

## 会话交接（2026-08-04 会话）

### 当前进度

- 入库 **103 个五星**（初版只做五星，四星不入库）；已实现主战法 **32 个**，未实现 **70 个**（含 SP赵云占位）。
- 测试 **479 通过**，tsc clean，golden snapshot 字节一致。批量 1-5 完成。
- **批量 5（v0.6.5）只留 2 个**：红颜铁骑（马云禄）、其疾如风（张辽）。
- **用户中途撤回 3 个**：王异世仇 / 黄忠定军扬威 / 文鸯盛气横凌 —— 机制不全**暂不录入**（DB main_skill_id 已清空、SKILL_ID_BY_NAME 已移除、b5 测试已删）。

### 本会话新增机制（v0.10，用户确认）

1. **实时距离**（`target.ts`）：攻击/战法距离不固定——每方**存活**单位按原站位（前锋→中军→大营）压缩重编号，阵亡跳过、后排前移，再查原距离矩阵。双方只剩大营 → 距离 1。`distanceBetween(ctx, a, b)` / `nearestEnemy(ctx, …)` / `skillTargets(ctx, …)` 签名已带 ctx。
2. **百分比属性增减**（`types.ts` buff 加 `percent?: boolean`，如 `amount:-15, percent:true`）：按**目标当前生效属性**（点数增减后）结算：`eff + round(│eff×Σpct/100│)×符号`；受谋略缩放按**绝对值**计算再恢复符号（魏武之世 -15% 谋略216 → -35%，降幅随谋略增大）；百分比按 1% 粒度八舍九入（`roundRate`）。
3. **属性类正负分桶**（`inflictStatus`）：attack/defense/strategy/speed_buff 一减一增互不冲突（各自共存），同号才冲突取较高；点数/百分比异维比较时后施加者替换。
4. **魏武之世**（曹操·魏，`weiwu_zhishi`）：四维 -15%（percent，strategyScaled，growthRate 0.15/点）接入上述机制；「我军全体攻击距离+1」未建模。
5. **描述清洗**：官方数据多处「两版本拼接」（29 个战法），`gen_skill_data.mjs` / `build_heroes_seed.mjs` / `scripts/clean_hero_descs.mjs` 统一去重（前6字二次出现：后半是前半超集取后半，否则取前半）；`web/data/heroes.json` 已清洗。

### 本会话新增规则（DoT 挂上时结算，用户确认）

- **DoT（妖术/燃烧/恐慌）伤害在「挂上时」结算、滞后触发**：`inflictStatus` 施加 DoT 时（施法者可解析），按**挂上时**的增伤合计（造成侧 caused × 受到侧 taken，修复原 mult=1 吃不到增伤）、**施法者挂上时兵力**（调研公式 attacker.troops，原实现误用目标行动时兵力）、目标当前防御/谋略、目标减伤预先计算每次跳伤，冻结为 `Status.stored: DotStoredDamage`（damage/breakdown/modifiers）；之后每次行动触发直接打出冻结值（仅按目标当前兵力截断），挂上后增伤/减伤/兵力变化不影响。施法者不可解析（单元测试直接 `inflictStatus`）时回退行动时实时结算（mult=1）。
- 引爆（烈火焚舟）：引爆结算剩余回合 × 各自挂上时冻结的每次伤害；引爆后新挂的燃烧按新挂上时重新结算。
- 关键文件：`src/engine/types.ts`（`DotStoredDamage`）、`src/engine/action.ts`（`computeDotTickDamage` / `dealDotDamage` / `inflictStatus` / `pushStatus`）；测试 `tests/dot_settle.test.ts`（新规则）+ `tests/damage_modifiers.test.ts` / `tests/liehuo_fenzhou.test.ts`（更新）。

### 本会话新增机制（持续型急救 + 皇裔流离，用户确认）

- **持续型急救（first_aid）**：一类指挥对友军挂「受击触发恢复」状态。**remaining 支持时限**：缺省 Infinity（整场常驻，皇裔流离）；金匮要略 duration 3（前 3 回合，回合末递减到期移除，与减伤同步）。受击（`applyDamage` 内，含 DoT，可救回致死伤害）时按触发率判定，成功则恢复兵力（受围困拦截 siege_blocked）；**恢复率挂载时按施法者生效谋略缩放冻结**（`roundRate(scaledValue(healRate, healGrowthRate, 谋略))`，与伤害率同公式）。触发率与总生效次数走**战法级共享计数器**（`ctx.firstAidCounters`，全队合计）——每达到 `triggerUpEvery` 次触发率 +`triggerUpIncrement` 可叠加（皇裔流离 50%→55%→60%）。
- **冲突**：同为**指挥战法**的持续型急救互斥（先施加者生效，后施加者 `status_conflict` 被拒——刘备皇裔流离 vs 张机金匮要略）；不同战法类型（被动/主动）各自共存。
- **皇裔流离**（刘备 h16·一类指挥 prep·友军全体）：恢复率 68% 成长率 0.6/点（谋略 80→68%、200→140%），触发率 50%，每 3 次生效 +5%。已入库（`main_skill_id=huangyi_liuli`）。
- **战报统计口径**：`UnitStats` / `SkillStat` 新增 `healCount`（回复触发次数）/ `healAmount`（回复兵力），heal 事件归属施法者、按 skillId 拆分——急救类战法按此统计而非战法释放次数/杀伤（`report.ts` 文本渲染未动，golden 不受影响）。
- **恢复率调研比对结论**（联网：大明州 4470 / 知乎 377462754 / 模拟器 skills.js 交叉验证）：本地调研公式（基础=谋略80值 + 成长率×(谋略-80)，1% 八舍九入）**无误差**；三军之众 151/1.575 一致；**补全缺口**：皇裔流离 0.6、金匮要略 0.75（本地原标「—」待补）。模拟器 `calcRecoverRate` 用 floor 截断且谋略<80 无 0.4/0.6 折减——属社区简化，引擎按大明州/本地文档实现。
- **金匮要略**（张机 h526·一类指挥 prep·友军全体·前 3 回合）：减伤 20.4% 成长率 0.13/点（受谋略，1% 八舍九入，`damage_reduce` 新增 `strategyScaled` 支持）+ 受击急救恢复率 80% 成长率 0.75/点、触发率 50% 固定（无递增）、`duration: 3` 前 3 回合（到期与减伤同步移除）；tags `['damage_reduce','first_aid','heal']`。已修正其误挂的 `priorityRounds: 3`（金匮要略无先手效果，仅先驱突击有）。
- 关键文件：`src/engine/types.ts`（first_aid 状态/`grant_first_aid` 输出）、`src/engine/action.ts`（`triggerFirstAidOnHurt` / `applyDamage` / `inflictStatus`）、`src/engine/stats.ts`；测试 `tests/first_aid.test.ts`（机制 8 个，含时限到期）+ `tests/main_skills_b11.test.ts`（皇裔流离 3 个）+ `tests/main_skills_b2.test.ts`（金匮要略 5 个，含谋略缩放/到期移除）。

### 本会话新增机制（伤兵死亡，v0.13，用户确认）

- **伤兵死亡**：每回合损失按「当回合死亡率」**即时**拆分为死亡（永久损失，不可恢复）+ 伤兵（入池，可恢复）。死亡率 = `base + perRound×(回合-1)`，封顶 100%（默认 5/14：第 1 回合 5%、第 2 回合 19%、第 3 回合 33%…第 8 回合 100%）。例：第 1 回合受伤 100 → 死 5 伤 95；第 2 回合再受伤 100 → 死 19 伤 81。
- **死亡按受伤量（cap 后实际扣减）即时结算，治疗不冲减死亡**（用户确认，避免高恢复队伍太逆天）；恢复（`case 'heal'` 主动恢复 + `triggerFirstAidOnHurt` 持续急救统一走 `recoverTroops(ctx, unit, amount)`）只能从伤兵池扣除，池跨回合累计；恒等式 `troops + wounded + totalDead = maxTroops` 恒成立。
- **配置**：`BattleConfig.woundedMortality?: { base, perRound }` 缺省 `{ base: 5, perRound: 14 }`（runBattle 默认启用；`{0,0}` = 无死亡、损失全部入池）。`CombatContext.woundedMortality` 可选：**直接构造 ctx 的单元测试缺省不启用**（旧行为、恢复不受池限制），现有测试零影响。
- **数据出口**：`UnitState` 新增 `wounded`（伤兵池）/ `totalDead`（累计死亡）；`round_end` 事件新增 `myWounded/enemyWounded/myDead/enemyDead`（与 troops 同序，每回合兵力条三段：主色=当前兵力、浅色=伤兵、灰/黑=死亡，供 Web 兵力条渲染）；`BattleReport` 新增 `finalMyWounded/finalEnemyWounded/finalMyDead/finalEnemyDead`；`report.ts` 回合末文本行补「伤兵 X 阵亡 Y」。
- 关键文件：`src/engine/types.ts`（`WoundedMortalityConfig`/UnitState/round_end）、`src/engine/action.ts`（`mortalityRate`/`recoverTroops`/`applyDamage`，后两者已导出供确定性断言）、`src/engine/combat.ts`（默认注入 + 输出）；测试 `tests/wounded.test.ts`（12 个：死亡率/封顶/池累计/恢复限制/恒等式/配置）。
- **golden 已重新生成**（round_end 结构变化为预期变更；无治疗战斗数值不变，仅事件增字段）。

### 本会话新增机制（S2 三将战法 + 新 hook，v0.13，用户确认）

- **奇佐鬼谋**（郭嘉 h476·主动 S·距离5·35%·敌军群体2）：自身+友军单体谋略+22（2回合，`targetSide:'self'` + `targetSide:'ally', targetMode:'single'` 双输出）+ 敌军群体随机 1 种控制。**新机制：`inflict_status` 的 `status` 支持 `CreateStatus[]` 数组**（施加时对每个目标独立 rng 随机选 1 个）。
- **密谋定蜀**（庞统 h477·主动 S·距离5·35%·敌军群体2）：减伤 30% 受谋略（growthRate 0.13，同金匮先例）+ 恐慌 143%（0.7）+ **新状态 `curse` 妖术诅咒** 133%（0.7，持续 2 回合）+ 自身造成策略伤害 +5% 受谋略可叠加（damage_boost caused，**新增 CreateStatus `strategyScaled` 支持**，growthRate 0.15 同增伤先例）。**新机制：`curse` 携带者「试图发动追击战法」时（`triggerPursuitSkill` 开头，无论发动率结果）触发一次妖术伤害**（挂上时冻结 stored 滞后触发，同 DoT；每次判定触发、不消耗；诅咒致死终止追击判定）。
- **火势风威**（陆逊 h478·准备主动 S·距离5·40%·敌军全体3）：全体策略攻击 111%（0.7）+ **新状态 `ignite` 引燃标记** 221%（0.7）：携带者「受到下一次伤害」时（`applyDamage` 内 `triggerIgniteOnHurt`，先于 first_aid）额外引发一次燃烧伤害（挂上时冻结），**触发后标记移除（一次性）**；未触发持续至战斗结束（duration 999）。
- **受谋略成长率推定**（官方不公开，按仓库先例推定，用户可调）：策略伤害/DoT/诅咒/引燃 0.7/点、减伤 0.13/点、增伤 0.15/点（密谋定蜀减伤/增伤/恐慌/诅咒与火势风威两率均按此）。
- **战法参数官方来源**：网易技能库移动版 `https://stzb.163.com/m/skilllist/{id}.html`（奇佐鬼谋 200692 / 密谋定蜀 200693 / 火势风威 200694 / 辕门射戟 200012），桌面版 JS 渲染抓不到正文。
- 挂槽与数据流：`SKILL_ID_BY_NAME` + `build_heroes_seed.mjs` → `seed_db.mjs`（MySQL 重灌）→ `export_web_data.mjs`；`skill_grades.json`/`skill_desc.json` 手动补品级与满级/1级描述（dataIntegrity 测试把关）。
- **辕门射戟（h479 群弓 SP 吕布）**：见下一小节「本会话新增机制（辕门射戟）」。

### 本会话新增机制（辕门射戟，v0.13，用户确认）

- **辕门射戟**（h479 群弓 SP 吕布·主动 S·距离5·35%）：对敌军群体发动二次攻击（140%，每次攻击目标独立选择），第一次攻击命中后对目标施加「造成攻击伤害降低 9999%」debuff（持续 1 回合），第二次攻击独立选目标不受影响。
  - **新机制 1：`groupCount?: number | [number, number]`**（BaseSkill + physical/strategy_damage 输出）：`[2,3]` = 50% 概率 2 目标 / 50% 概率 3 目标（`skillTargets` 第 6 参）。
  - **新机制 2：`markCausedReduce?: { rate, duration }`**（physical_damage 输出）：伤害结算后对本次攻击每个目标施加 `damage_boost` caused 负值（-99.99 = -9999%）；`buffMult` 既有 `MIN_DAMAGE_FACTOR = 0.1`（v0.14 单一总和模型，增减伤总和 < -90% 最低保留 10%）→ 强制目标造成伤害 min 10%。**注意**：`calcDamage` 的 `troopBase`（兵力基础）不乘 mult，故实际伤害 = 兵力基础 + 其余 ×10%。
  - **debuff 持续时间语义**：`damage_boost` 属第 2 组 → 行动中施加（appliedRound>0）按「下次行动前递减」结算，
    「持续 1 回合」= duration **1**（目标未出手 → 生效本次行动；已出手 → 生效下一次行动；2026-09-20 口径）。
- 「无视兵种相克」：引擎无兵种相克系统，自动满足（无需建模）。
- 测试 `tests/main_skills_s2.test.ts` 辕门射戟 4 个：装配 / 二次独立攻击（每次施放 4~6 条 damage）/ groupCount [2,3] 50-50（skillTargets 单元）/ debuff 伤害下限（同种子双跑对比，buffed = troopBase + (基线-troopBase)×0.1 ±1）。

### 本会话新增（统计归属 + 战报统计展示，v0.13，用户确认）

- **指挥队友攻击杀伤归属**：`damage` 事件新增可选 `creditToId`（杀伤统计归属单位，缺省 sourceId）。奇兵拒北（`positional_physical_damage` source:'fastest_ally' 借速度最高友军）的伤害事件带 `creditToId: 施法者`——stats 中战法杀伤计入施法者（魏延的奇兵拒北）而非实际打人的友军；未来陆抗/司马昭类战法复用该字段。
- **恢复统计展示**：`computeStats`（武将级 healCount/healAmount）与 `computeDetailedStats`（战法级 castCount/damage/healCount/healAmount）**数据早已存在**（v0.12 皇裔流离时加入）；本次补展示——`report.ts` 武将统计表加「恢复次数/恢复兵力」两列 + 新增「战法统计（次数 ｜ 杀伤 ｜ 恢复）」明细表（张机金匮要略 = 次数 1 ｜ 杀伤 0 ｜ 恢复 x）；Web `createStatsView` 战法格改「次数 · 杀伤 · 恢复」。
- **Web 主页【战报】增强**（`teamEditor.ts` openHistoryPanel）：历史详情加「统计」按钮（createStatsView 视图）+「复用队伍」按钮——把战报红/蓝双方复制到配将区。**反推公式**（与 buildGeneral 互逆）：`freePoint = 面板 - round(基础 + 39×成长)`（红度只影响自由点预算不影响面板 → 复用按 0 红 + 精确反推加点）；extraSkillIds = 四槽战法排除主战法。
- 测试 `tests/stats_credit.test.ts`（2 个：奇兵拒北 creditToId 归属 / 金匮要略 次数1·杀伤0·恢复x）。
- **golden 已重新生成**（奇兵拒北 damage 事件新增 creditToId 字段为预期变更）。

### 本会话新增（战报士气几率显示，v0.14，用户确认）

- **skill_trigger 事件新增 `rate`（当前生效几率 %，含士气修正）/ `baseRate`（基础 %）/ `morale`（判定方士气）/ `targetId?`（被判定目标，缺省=施法者自身）**——所有带发动率属性的判定（主动/追击/二类指挥/预备负面 roundRepeat/行动叠层 actLayer）携带；渲染显示「当前生效几率 78% = 70% × 士气系数 1.12，士气 120」。
- **Web 战报详情格式（用户指定）**：「【目标】来自【施法者】的【战法】当前生效几率为78%（70%*1.12 120士气对应增幅12%）（判定成功）」——士气增幅 = round((士气-100)×0.6)%。
- **修复两个未走士气的判定**：①奋疾先登 actLayer 速度对比判定（70%/30%）原直接 `rng.chance(cfg)`——现走 `moraleTriggerRate`（70%×1.12=78%，用户示例）并逐目标发 skill_trigger（targetId=速度对比目标）；②持续型急救 first_aid 触发率原 `chance(counter.rate/100)`——现按施法者士气修正（50%×1.12=56%，一类指挥生效几率，AGENTS.md 规则补全）。
- **roundRepeat（战必/措手/白衣）新增 skill_trigger 事件**（原只发 unit_act_start；90%×1.12 封顶 100%）。
- 士气 100 → 系数 1 也携带字段（渲染显示 ×1）；`moraleTriggerRate` 公式不变。
- 测试 `tests/morale.test.ts` 追加 4 个（追击 34%/actLayer 78% 用户示例/战必 100% 封顶+targetId/first_aid 120 士气触发次数 > 100）。
- **golden 已重新生成**（skill_trigger 字段 + roundRepeat 新事件 + first_aid 士气化均为预期变更）。

### 本会话新增（战报展示精简，v0.14，用户确认）

- **Web 详细战报（battleView）小字精简**：①skill_trigger 只显示主干「【目标】来自【施法者】的【战法】当前生效几率为78%」（去掉括号内 35%*1.12 士气增幅与判定字样，成功/失败由颜色区分）；②damage/attack_hit/dot_tick/split_damage 不再输出 breakdown 括号「（兵力基础219 + 属性基础198 + 主要676）」（bkd 函数删除）。
- **增伤显示百分数化（引擎 detail，pushStatus）**：damage_boost 由「增伤 0.08」改为「造成的伤害提高8%」（caused→造成的/受到侧→受到的伤害，正负→提高/降低）；**≤ -90% 的负增伤（如辕门射戟 -99.99）显示「造成的伤害大幅降低」**（不显示 9999%）。
- **伤害下限保护的显示**（buffMult min 10%）：Web 增减伤净合计行净降低 >90% 显示 90%（实际增减伤）；弹窗「伤害降低合计」clamp 90；弹窗来源条目 pct>90 且负 → 「伤害大幅降低」。
- **duration ≥ 999（战斗结束约定）统一显示「持续至战斗结束」**（属性类/damage_boost/damage_reduce/DoT/split/jump_prep/taunt 全部 detail）。
- 测试更新：`tests/main_skills_b3.test.ts` / `b4.test.ts` 的 detail 断言改为百分数格式（「造成的伤害提高 40%」等）；golden 重新生成（detail 文案变化为预期）。
- 关键文件：`src/engine/types.ts`（curse/ignite 状态与 CreateStatus、status 数组）、`src/engine/action.ts`（`triggerCurseOnPursuit` / `triggerIgniteOnHurt` / 数组随机 / damage_boost strategyScaled）、`src/data/skills.ts`（三战法）；测试 `tests/main_skills_s2.test.ts`（11 个，含单元级 ignite 一次性/curse 不消耗断言）。

### 录入规则（用户明确强调）

1. **只实现现有引擎机制能做的**；要新增机制的先跳过（不算遗漏，算待机制）。
2. 每战法 3 个测试（装配挂槽 / 机制事件状态 / 数值或共存）。
3. **机制没完全实现的战法一律不录入**，不做"部分实现"（王异围困、黄忠挑衅、文鸯士气分支即因此被撤）。
4. 初版只做五星；保留 `scripts/_list_types.mjs` 查询脚本。
5. 等添加一半后做统一类型修正（尚未触发）。

### 引擎缺失机制（战法涉及即跳过 / 暂不录入）

**统一清点文档**：`docs/待补充机制清点.md`（199 个通用战法中的 88 个 skipped 按缺失机制分组，含机制键、建议实现顺序）。DB `skills.mechanism_key` 列联动（`scripts/seed_universal_skills.mjs` 填充）——机制实现后 `SELECT * FROM skills WHERE status='skipped' AND FIND_IN_SET('<键>', mechanism_key)` 立即取出该机制全部战法。

士气发动率系数已实现（v0.7，`moraleRate`/`moraleTriggerRate`，士气 120→系数1.12）；**士气比较**（目标士气 vs 自身）与**士气降低**（及锋而试 目标士气-10）仍缺。洞察 / 围困 / 妖术 / 燃烧 / 恐慌 DoT / 分兵 / 挑衅 / 先手（priorityRounds 仅指挥战法）已有状态与测试；仍缺：禁普攻 / 反击 / 援护 / 受击触发 / 属性吸取 / 主动战法发动率提升 / 距离+1 / 兵力比例 / 特殊目标选择 / 混合目标池 / 持续恢复 / 特定回合起 hook / 恢复次数递增 / 下一次攻击增减伤 / 追击多段 / 攻城属性 / 移除敌军有益 / 兵种限定 / 女武将组合 / 准备跳过 等（完整清单见 `docs/待补充机制清点.md`）。

### 本会话已验证可用机制

- 追击可带 `strategy_damage`（受谋略，王异世仇本可，但围困缺失被撤）。
- 二类指挥 `actLayer`（奋疾先登）：**每叠 1 层后立即检查阈值**，层数 × perLayer 达到 cap（40%=5 层）立即触发攻击（攻击时当前层增伤生效）→ 清空层数（计数器归零 + 移除增伤状态）→ 目标降速（同战法累加）→ **继续**剩余速度对比判定（剩余层数保留供下回合累计）。修正确认（用户）：原实现全部判定完才检查，导致增伤攒超 5 层（如 6 层 48% 才触发）且清空后次数比预期少。
- **damage_boost 冲突语义（v0.14 两次确认，最终规则）**：同类型不同战法的增减伤（damage_boost）同方向**冲突、数值取较高替换**（大赏三军 30% vs 奋疾先登 8% → 大赏三军生效，奋疾先登层增伤被压制；奋疾先登 40% > 30% → 替换大赏三军）。**奋疾先登的层数计数与满 5 层砍刀独立于增伤状态冲突**（actLayerCounters 战法级计数器，inflictStatus 被拒不影响计数）——大赏三军在场时层照叠、满 5 层照砍（砍刀增伤来源为大赏三军）。同战法重复触发仍 sameSource 累加；带 stacks 上限的（银龙冲阵 markTakenBoost）各自独立计数、施加方自行封顶。**damage_reduce 同规则（取较高替换）**（避其锋芒 vs 共饮避世，conflict.test.ts 锁定）。注：曾误改"共存叠加"（第一版修复），用户澄清应为冲突替换——已回滚。
- **Web 增减伤统计行覆盖（v0.14 补全）**：`battleView.ts` `appendDamageModifierLine` 净值 >0 显示「共计提升 x%」、净值 <0 显示「共计降低 x%」（原实现净负不显示，纯减伤/减伤占优的伤害缺失"降低"行）；**dot_tick 分支补渲染**（原缺失——DoT/诅咒/引燃跳伤无行，归属施法者 casterId，modifiers 挂上时冻结）。引擎侧除白衣 delayedOutput（预先结算不吃增减伤，modifiers 恒缺、合理）外所有伤害事件均带 modifiers。
- 被动 `round_start`：每回合行动阶段触发，每次施加的连击覆盖全回合（连击按回合结算、回合结束掉）。
- 一类指挥 `roundRepeat` 可做"每回合概率施加 buff"（其疾如风：第 1~3 回合每回合 70% 判定连击，`startRound:1, endRound:3`，连击 `duration:1` 持续本回合；速度+41 走 `initialOutput` duration 3）。
- `targetSide:'ally'` 主动/指挥：目标池为友军。

### 数据待办

- **曹操·汉 growth_speed=1.0**（构建脚本唯一 warn，待补真实速度成长）。
- 剩余 70 个未实现战法逐个按"能做的做、机制不全的跳过"推进。

### 下一批候选（本会话已预筛，现有机制可做）

- **明慧通透**（王元姬 h706·主动·友军单体）：remove_debuffs + heal 168% 受谋略。洞察机制缺失 → 若做，只做移除有害+恢复。
- **名士在野**（汉四星司马徽专属，一类指挥·友军全体）：strategy_buff 35 每回合 + roundRepeat 减伤 22% 受谋略。群五星司马徽是 `h811`，主战法「徽言龙凤」暂不实装。
- **母仪浮梦**（何太后 h37·一类指挥）：规避（"首次受击规避"现有 `grant_evasion`）+ 敌军前4回合 60% 减伤 40%（roundRepeat，类似汉韵旷野）。
- **鸾凤和鸣**（小乔 h687·主动）：heal 85% 受谋略 + 控制附加（后者缺失）——部分实现需先问用户。

### 关键文件

| 文件 | 用途 |
|------|------|
| `src/data/skills.ts` | SKILL_REGISTRY（战法定义） |
| `scripts/build_heroes_seed.mjs` | SKILL_ID_BY_NAME 中文名→ID 映射 + 生成种子 |
| `scripts/seed_db.mjs` | DELETE+INSERT 重灌 DB |
| `scripts/_list_types.mjs` | 保留的查询脚本（解析 SKILL_REGISTRY 类型→查 DB） |
| `tests/main_skills_bN.test.ts` | 每批战法测试（每战法 3 测试） |
| `dateyuan/hero_growth_verified.json` | 武将成长值唯一权威来源 |
| `scripts/gen_offline_report.mts` | 生成 `docs/下架武将清单.md`（下架武将 / 战法卡点与缺失机制分布） |

### 常用流程

1. 改 `src/data/skills.ts` 加 SKILL_REGISTRY 定义
2. 改 `scripts/build_heroes_seed.mjs` 的 SKILL_ID_BY_NAME 加映射
3. `node scripts/build_heroes_seed.mjs` → `node scripts/seed_db.mjs`
4. 写 `tests/main_skills_bN.test.ts`
5. `npx tsc --noEmit` + `npx vitest run`（golden snapshot 须字节一致）

---

## 会话交接（Web 模拟参数调整会话）

### Web 端模拟参数规则（`web/main.ts` 底栏）

- **随机种子**：用户不可调整。每次点击「开始模拟」由系统内部自动生成新种子（`Math.random()`），底栏只读展示当前/上次种子（`#seed-info`）。
- **最大回合**：固定 8，不可调整（`MAX_ROUNDS = 8` 常量，不再有下拉框）。
- **兵力**：不再全局可调。按公式自动计算并展示：`携带兵力 = 等级×100 + 5000 + 红度×200`（`web/heroes.ts` `troopCapacity`；40 级白板 = 9000，50 级满红 = 11000）。
- **士气**：默认 120，红蓝双方各自可调（底栏 `#morale-red` / `#morale-blue`，80~140）。士气影响战法发动率（引擎既有 `moraleRate`，120 → 系数 1.12），经 `buildGeneral(..., morale)` 写入 `General.morale`。

### Web 端武将等级（`web/teamEditor.ts` 详情页）

- 每名武将等级可调 **40~50**（`SlotState.level`，详情页 `.hd-level-row` 输入框）。等级变化 → 四维属性按成长率更新（`statsAt`：初始 + (L-1)×成长，四舍五入）、携带兵力按公式重算、自由属性预算随等级变化（男性 10 点/10 级、女性 15 点/10 级 + 红度×10；`freePointBudget(heroId, redness, level)`）。
- 等级下调导致加点超预算时，从攻击→防御→谋略→速度依次扣减（`main.ts` `onSetLevel`）。

### 引擎改动（最小侵入）

- `src/engine/types.ts`：`General` 新增**可选** `level?` / `redness?`（仅 Web 数据透传，引擎不参与计算；Node/CLI 构建的武将无此字段 → golden 不受影响）。
- `src/data/hero-utils.ts`：新增 `leveledFromRecord(g, rec, level, free, troops)`，`level40FromRecord` 委托之（行为不变）。
- `web/heroes.ts` `buildGeneral(heroId, extraSkillIds, freePoints, position, redness, level, morale)`：兵力由公式内部计算（删除了外部 troops 参数）。
- 战报「复用队伍」按战报内 `level/redness` 精确还原（`main.ts` `generalToSlot`）。
- 清理：删除遗留调试文件 `tests/_tmp_repro.test.ts` / `tests/_tmp_repro2.test.ts`（奋疾先登调试遗留，`_tmp_` 前缀、打印 console 噪音、依赖 MySQL，前者还阻塞 tsc）。

### 本会话后续修复（乐进奋疾先登增减伤战报，用户确认）

- **引擎（`action.ts` inflictStatus）**：damage_boost 同类型不同战法**正负号相反不冲突、各自共存**（无心恋战 -30% 与奋疾先登叠层 +32%：增伤与减伤由 buffMult 单一总和模型互相抵消，避免「增伤冲突，数值取较高 0.08」误报与减伤被替换吞掉）；**同号仍冲突取较高**（大赏三军 30% vs 奋疾先登 8%，conflict.test.ts 锁定不变）。
- **Web（`battleView.ts`）**：伤害数字前只插入一行净合计「此次伤害共计提升/降低 z%」（z 可点击，正→提升、负→降低；无增减伤/净 0 不显示）；**点击 z 才弹出**「增减伤统计」面板——「伤害提升合计」栏（正增伤：受到侧在前、造成侧在后）＋「伤害降低合计」栏（受击方减伤 + **负增伤绝对值**，如无心恋战 30%），各带【武将】【战法】来源明细。例：奋疾先登 32% + 愈战愈勇 10% = 提升 42%；无心恋战 30% + 避其锋芒 30% = 降低 60%；净降低 18%。
- 测试：`tests/conflict.test.ts`（正负相反共存 1 个）+ `web/damageModifier.test.ts`（9 个，含用户场景 42%/60%/净 18%）。

---

## 会话交接（伤害测试实验室 + 兵种相克会话）

### 引擎新增机制：兵种相克（用户规则，非调研）

- **规则**：骑克步、步克弓、弓克骑；**被克制方攻击克制方时造成的伤害降低 30%**（单向惩罚——克制方攻击被克制方无影响，同兵种无影响）。例：步兵攻骑兵 -30%，骑兵攻步兵无影响。
- **实现**：`src/engine/formulas.ts` `troopCounterFactor(attackerTroopType, targetTroopType)`（COUNTERS 链查表，返回 0.7 或 1）；`CalcInput` 新增 `counterFactor?`，`calcDamage` 内 `effMult = mult × counterFactor` **独立乘算**（不参与增减伤单一总和 clamp，不被增伤抵消；与 mult 同路径只作用于 base/main，troopBase 兵力基础不乘）。
- **覆盖全部伤害路径**（`action.ts` 8 个 calcDamage 调用点）：普攻 dealAttack / physical_damage / strategy_damage / positional_physical_damage（奇兵拒北）/ 分兵 split / DoT 挂上时冻结（computeDotTickDamage，`DotStoredDamage.counterFactor` 冻结、dot_tick 滞后触发沿用）/ delayedOutput 预存（computeStoredDamage）。回退路径（直接 inflictStatus 无施法者）不传。
- **事件字段**：`damage` / `attack_hit` / `dot_tick` / `split_damage` 新增可选 `counterFactor?`——**仅被克制方攻击克制方时携带 0.7**（无克制不携带，golden 差异最小）。
- 测试 `tests/troop_counter.test.ts`（7 个：9 组合单元 / calcDamage 确定性 / 普攻与战法事件字段 / 总伤害对比 <85%）。**golden 已重新生成**（伤害数值变化 + 新字段为预期）。
- 修复既有类型缺口：`web/battleSummary.ts` createStatsView 构造 UnitState 缺 `wounded/totalDead`（web/ 本不在 tsc include 内，被 damageLab 测试链暴露）。

### Web 新功能：伤害测试实验室（`web/damageLab.ts`，v2 按用户反馈重构）

- **入口**：主站顶栏「伤害测试」导航（`web/main.ts` `enterLab/exitLab`，每次进入重新 mountDamageLab；lab 内「← 返回配将」调用 onExit 恢复）。`web/lab.css` 由 main.ts import（vite 打包）。
- **布局（v2 三栏分割、单屏不整页滚动）**：左栏「我方测试队伍」（**不分红蓝**，槽位卡复用主站 `renderSlot`：左画像右信息，点击进详情弹窗）；中栏武将池（复用 `renderHeroPool`，内部 `.hero-grid` 滚动，仅此区域滚动）；右栏侍卫面板。池子与侍卫栏间距由 `grid-template-columns: 300px 1fr 330px` 固定。
- **侍卫**：四维/兵力/兵种（骑步弓，弓距离 3、骑步 2）可自由调整；默认画像按亲卫 NPC 模板放大（攻 82/防 92/谋 78/速 58/兵 9000/步，来源 3DM 亲卫图鉴 + ali213 镜像，页面标注可调）；每侍卫随机 **3 个 D 级战法**（29 个 D 级全部已实现，`SKILL_GRADES[id]==='D'` 过滤，锁定后多次模拟不重随，「重新随机」按钮刷新）。
- **交互（v2 分离）**：底部「模拟一次/十次」→ 模拟后进入**独立伤害分析页**（`.lab-analysis`，与实验室分离；顶部「← 返回实验室」+ tabs：伤害分析｜简略战报｜统计｜战报详情；十次时战报类 tab 可下拉选场）。
  - **伤害分析 tab**：队伍统计（场次/胜/负/平/胜率/平均回合）+ 每将卡片（头像 + 场均伤害 + SVG 饼图四类占比 + **数学统计表**：总伤害/单场最高/最低/标准差（总体）/变异系数/中位数/场均承伤/场均治疗，`mathStats`）+ 敌方侍卫场均造成/受到（折叠）。饼图占比 `computeShare` 按事件流分类（damage 归属 creditToId??sourceId、DoT 归属施法者）。
  - **战报**：简略战报 `createBattleSummary(report, { myLeft: true, myLabel: '我方', enemyLabel: '侍卫', resultLabels })`——**我方在左、侍卫在右，带画像**；详情 `createBattleView(report, { myLabel, enemyLabel, resultWin/resultLoss })`。
- **共享组件参数化（默认行为不变，主站不受影响）**：`battleSummary.ts` `SummaryOpts`（myLeft/myLabel/enemyLabel/resultLabels，默认仍蓝左红右、红队胜利）；`battleView.ts` `BattleViewOpts`（myLabel/enemyLabel/resultWin/resultLoss，默认红队/蓝队）。`teamEditor.ts` 新增导出 `renderHeroPool`/`openHeroPicker`（实验室三栏复用）；实验室 handlers 包装（wrappedHandlers）在调用后刷新左栏与武将池。
- **拖拽配将（Drop-Zone，主站 + 实验室共用）**：武将池卡牌 `draggable` + `dragstart` 携带 `dataTransfer text/plain = heroId`（`teamEditor.ts` renderHeroPool，卡带 `data-hero-id`）；**Drop-Zone 逻辑内建于共享 `renderSlot`**（已导出）——主站红/蓝配将区与实验室左栏槽位（空槽=放入、已选槽=替换）均支持拖拽投放：`dragover`（preventDefault + `.drag-over` 高亮，styles.css `.slot.drag-over`）+ `drop` → `handlers.onPickHero(team, idx, heroId)`（互斥/全局唯一，主站 refresh 或实验室 wrappedHandlers 刷新）；投放成功武将出现在对应位置、**武将池保留原卡**（不删除）。**实验室左栏槽位卡 = 主站 `renderSlot`（左画像右信息，视觉一致）**，`.lab-slots` 容器 grid 三行；旧竖排 `.lab-slot` 样式已删除。
- **测试**：`tests/damage_lab_smoke.test.ts`（11 个，模块 import 版：三栏布局/分析页饼图+数学统计/战报左我右侍卫/返回实验室/**拖拽空槽投放+已选槽替换+池子保留**）+ `web/smoke.test.ts` 导航切换 1 个（nav-link 数量断言为 3）。
- **部队加成弹窗（率土手游复刻，`teamEditor.ts` `openTroopBonusPanel` 已导出）**：深色古风 UI——红棕磨砂暗纹背景（多层渐变 + 135° 细纹纹理 + 径向高光）、暗金古风边框（含四角纹饰）、顶部标题栏（古楷暗金标题 + 右上**红色圆形 ×**关闭）、暗色蒙层（backdrop blur）。**三栏并列卡片**（无 tab、无底部按钮）：①阵营加成（圆形阵营徽章 + 「阵营加成-{阵营}」+「战斗中生效」橙标签 + 武将头像与四维加成格：攻击/谋略/防御/速度 **内联 SVG 线条图标 + 绿色数字 +N**）；②称号加成（「全局生效」青标签；激活 → 称号 chip + 武将行，未激活 → 「配置指定武将组合可激活 前往查看>>」）；③兵种加成（**马头剪影 SVG 徽章** + 「兵种加成-{骑兵/步兵/弓兵系}」+「战斗中生效」+ 武将行）。阵营/兵种按上阵多数取；空态「未激活」。主站红/蓝与实验室左栏「部队加成」按钮共用（实验室 `renderLabTeam` 头部已加）。旧 `.tb-*` tab 弹窗样式已删；smoke 断言更新（`.bonus-modal`/`.bm-card`/`.bm-stat.on`）。
- 原型历程：`prototypes/damage-lab/`（独立 HTML + esbuild IIFE 验证版）**验证通过后已删除**，逻辑并入 `web/damageLab.ts`；构建脚本 `scripts/build_damage_lab.mjs` 已删。

---

## 会话交接（武将机制批次 · 2026-09-18，分支 `feat/hero-mechanics`）

> 口径：**一个武将 = 一个提交 + push**；每将 ≥3 测试；`tsc` clean + 全量 `npm test` 全绿才提交；
> 生成物（`web/data/*.json`、`scripts/seed_heroes.sql`）随提交入库；受属性缩放的段成长率留空
> （`strategyScaled`/`attackScaled` 标记在，可选字段不写、必填字段给 0）并登记 `OFFLINE_MAIN_SKILLS`。

### 已完成 28 个（§1.2 10 个 + §1.3 1 个 + 歧义澄清后 7 个 + §1.2 收官 5 个〔率尔方雅～伏波扬砂〕+ §1.3 收官 4 个〔潜谋远计～辞后定朝〕）

| 武将 | 战法 | 新机制（引擎字段） | 上线 |
|---|---|---|---|
| 诸葛恪 h522 | 计定山越 | —（复用 `morale_branch` 逐目标士气） | 下架 |
| 袁绍 h670 | 威震河朔 | `triggerRateDecayPerCast` | 下架 |
| 黄月英 h20 | 匠心不竭 | `delayedOutputs`（一类指挥分段延迟） | 下架 |
| 孙鲁班 h654 | 全主诿异 | `damage_boost.dotTypes` | 下架 |
| 荀彧 h794 | 举贤决机 | `onAttrChange`（属性升降「之前」判定） | 下架 |
| 陈到 h793 | 忠克猛烈 | `retaliate` 状态 + `physical_damage.ignoresDefense` | **上架** |
| 孙策 h450 | 霸王渡江 | `chanceBoostPerDamage` | **上架** |
| 张梁 h557（§1.3） | 人公将军 | `damage_reduce.requireSelfStatus` | **上架** |
| 袁绍·汉 h6 | 四世三公 | `attackerPick` / `targetPick` | **上架** |
| 司马懿·晋 h807 | 其徐如林 | `strategyAdjacentBonus` | 下架 |
| 司马徽 h811 | 徽言龙凤 | `teamDamageThreshold` + `recipientDamageByHigherStat` | 下架 |
| 司马懿·魏 h472 | 破凰 | `sorcery.onHurt`/`charges`（受击触发妖术 + 次数上限）+ 输出段 `detonate_sorcery_marks`（自引用引爆） | 下架 |
| 甘宁 h34 | 侵掠如火 | `PassiveSkill.priorityRounds`（被动先手）/ `trigger_boost.attackSkillsOnly` / `attackProcBoost`（进行攻击概率增伤） | **上架** |
| 杜预 h705 | 三军夺帅 | `PassiveSkill.afterAct`（普攻/主动/追击后钩子）+ `inflict_status.sameTargetsAsLastDamage` | 下架 |
| 马岱 h615 | 奉令护蜀 | `PassiveSkill.allyActStacks` + 状态 `pending_stacks`（下次普攻增伤 / 下次受击减伤，触发即清空全部层数） | 下架 |
| 张宝 h562 | 地公将军 | `inflict_status.requireAnyPrevDamageTargetStatus`（整段条件开关）+ 复用 `sameTargetsAsLastDamage` | 下架 |
| 陆抗 h574 | 西陵克晋 | `physical_damage.attacker:'highest_attack_ally'` / `strategy_damage.attacker:'highest_strategy_ally'` + `healSource`（代打者按自身兵力立即恢复） | 下架 |
| 吕姬 h634 | 缚父临危 | `inflict_status.targetPick`（`highest_attack_ally` / `ally_named` 按名匹配）+ `damage_boost.attackOnly` + 状态 `ignore_evasion` | **上架** |
| 王允 h693 | 连环计 | `BaseSkill.chainSkills`（战法链：依次执行其他已注册战法的 output，条件在该步执行时求值） | **上架** |
| 胡芳 h797 | 率尔方雅 | `BaseSkill.targetPool:'mixed'`（敌我同池随机 N、排除自身）+ `SkillOutput.lockedSide`（段级按阵营过滤**锁定目标**，不重选池） | 下架 |
| 小乔 h687 | 鸾凤和鸣 | 状态 `control_spread`（控制效果 +1 目标，消耗制）+ `CommandSkill.afterFirstActiveOutput`（与 roundTrigger 解耦的「首次主动成功后」附加段） | 下架 |
| 刘禅 h689 | 赐剑长驱 | `CommandSkill.allyRecast`（友军每回合首次主动成功后按几率**再次发动**：跳准备 + 伤害/恢复 ×factor）+ 准备阶段自身犹豫/怯战封禁 | 下架 |
| 袁术 h790 | 僭号天子 | `CommandSkill.sealTransfer` + `ctx.sealLedgers`（玉玺按比例承担我方受击伤害）+ 回合结转（`tickRoundStartStatuses`）+ 独立事件 `seal_settle` | 下架 |
| 马腾 h785 | 伏波扬砂 | `CommandSkill.stacksConsume` + `ctx.stacksConsumeCounters`（普攻**增减伤净幅度**累计 → 每满 40% 得 1 层【扬砂】→ 普攻后每 4 层换 1 次额外普攻） | 下架 |
| 羊祜 h709 | 潜谋远计 | `BaseSkill.casterPositions`（整次生效的**站位条件**）+ `strategy_damage.requireTargetStrategyBelowSelf`（「谋略低于自身」过滤） | 下架 |
| 马谡 h799 | 心战为上 | `CommandSkill.healOnDamage` + `ctx.healOnDamageTriggers`（**攻心**：攻击伤害后按伤害值恢复 + **士气降低**：目标 −5、全队上限 9 次） | 下架 |
| 许劭 h770 | 举抑臧否 | `inflict_status.targetPick` 扩展（`highest_*_ally` / `lowest_*_enemy` 按属性选人）+ 复用 `random_pick`（随机属性选取） | 下架 |
| 阴丽华 h742 | 辞后定朝 | `CommandSkill.onActSegments`（**行动时分段**：窗口 + 几率 + once）/ `remove_by_source_skill_type`（移除指定来源战法的效果）/ `inflict_status.requireGender` + `General.gender` | 下架 |

计数：已实现主战法 **116**（基线 88）；上架池 67 → **75**（`docs/下架武将清单.md` 重生成口径：
未实现 **45** / 卡成长率下架 **41** / 上架 **75**；待实现分档「补 1 个」**0** / 「需多个」**0** / 「需调研」45；缺失机制 2 类）；
测试 91 files/1121 → **123 files/1319**（main 合入后口径；分支侧为 120/1297）。本批提交：`e919d1b`(破凰) `a5c1dfe`(侵掠如火) `b0a9896`(三军夺帅)
`b6f555f`(奉令护蜀) `2e3f495`(地公将军) `f791b8c`(西陵克晋) `bbba8df`(缚父临危) `2ca1a61`(4 处复核收敛) `5d57689`(连环计)
`83874d7`(率尔方雅) `321fdd7`(鸾凤和鸣) `edcfa71`(赐剑长驱) `a1611a4`(僭号天子) `5c6a1c5`(批次文档收尾) `be00c55`(伏波扬砂)；
落地追加：`537aa2b`(潜谋远计) `1cbf7d9`(心战为上) `7a26f76`(举抑臧否) `0a6b18a`(辞后定朝) `ac8c702`(§1.3 收官文档)
+ Web 侧 `501d4e3`(配将池「显示下架武将」开关) `aa88231`(AGENTS.md 修正)；主仓库合并提交 `587d738` / `2fd6e39`(versionCode 19)。

### 7 处歧义已全部澄清（2026-09-18 用户逐条确认，勿再重复询问）

- **破凰**：「由破凰带来的剩余妖术」= **本战法自身**此前施加的条件妖术剩余次数（先引爆剩余次数，再挂新的 3 次）；主目标取两版拼接描述的**第一版**「敌军单体」。
- **侵掠如火**：「进行攻击」= 普通攻击 / 物理主动战法 / 追击战法。
- **三军夺帅**：两句之间的「或」= 每次触发 **50/50 随机**（复用 `random_pick`）。
- **奉令护蜀**：层数上限 5；伤害段与减伤段**各自**在对应时机（普攻打出后 / 首次受击实际扣兵后）**清空全部层数**，减伤也 ×层数。
- **地公将军**：「友军群体」= 有效距离内 **2 个目标**；「妖术效果」= `sorcery`（妖术）| `curse`（妖术诅咒）。
- **西陵克晋**：见下方联网查证结论。
- **缚父临危**：「友军中吕布」按**武将名**匹配（h3 汉骑 / h479 群弓 SP 两张都算，队里没有则空转）；「无视规避」覆盖**任意伤害类型**。

### 本批 4 处口径的复核结论（2026-09-18 复核，代码**无需改动**）

1. **奉令护蜀「任意友军」不含施法者自身** —— **已论证（设计反证）**：若含自身，马岱每回合「普攻先被自己清空层数、再被自己补 1 层」，
   永远停在 1 层，「以上效果**可叠加 5 次**」对伤害段失去意义；不含自身时两名友军每回合贡献 2~4 层，5 层可达 ✓。
   → 若要改：`triggerAllyActStacks` 去掉 `if (holder === actor) continue;`
2. **地公将军友军段 `excludeSelf`** —— **已论证（文本反证）**：原文「若有目标存在妖术效果，则**额外**附加属性至自身」——
   若自身已属「友军群体」，第 ④ 段无从「额外」；且 `excludeSelf` 使「友军群体（有效距离内 2 目标）」在 3 人队中恰好 2 人 ✓。
   → 若要改：删掉该段 `excludeSelf: true`
3. **西陵克晋恢复率 = 基值 100%**（9000 兵力 = **216**）—— **已查证（取基值，不编造）**：官方技能库全文**未给恢复率**
   （官方库 46 个「恢复一定兵力」战法中 42 个写明「恢复率X%」，其余 4 个是「借此恢复」（按伤害）或数字写在括号里（预识））。
   官方攻略「9000 兵力时单口**最大**奶量在 300 左右」——`300×兵/(3500+兵)` 的**饱和上限正是 300**（9000 兵 = 216），
   故该句应读作「该曲线的上限」；该曲线已被皇裔流离实战战报（9500 兵 181% → 396 分毫不差）验证。
   → **若你的真实战报显示 9000 兵 ≈ 300**：把两处 `healSource.rate` 由 `100` 改为 `139`（216×1.39≈300），仅此一处。
4. **西陵克晋 50% = 一次判定、两段同时结算** —— **已查证（确认当前实现）**：[17173 陆抗详解](https://news.17173.com/z/stzb/content/08292021/111510246.shtml)
   原文「『西陵克晋』的**发动率是 50%**，会使我军中谋略和攻击最高的单位对敌军发动一次攻击，**且各自恢复一定兵力**」——
   单次发动率、两段同发（攻略里的「1./2.」只是效果列举）。
   → 若实际为两段各自独立 50%：把两段包进 `chance_group(chance: 0.5)`

### 本次 5 将（20~24）的口径推定 · 待复核（2026-09-19）

> 均已写入对应 `skills.ts` 注释；改动成本都极低，用户确认后按「若要改」一键切换。

1. **鸾凤和鸣「控制 +1 目标」的作用范围** —— 按「携带者打出的**任意控制段**（含群体控制）额外 +1 个目标」实现；
   额外目标 = 施法者**距离内、未在本段目标池内**的随机敌军（`pickExtraControlTarget`）；未打出控制则不消耗标记。
   → 若只对「随机单体控制」生效：在 `executeSkillOutputs` 的 inflict_status 分支加 `out.targetMode === 'random_single'` 门槛。
2. **赐剑长驱「再次发动」的 50% 范围** —— 只缩放**战法自身 output 的伤害/恢复段**（`scaleDamageHealOutputs`：
   物理/策略/位置伤害 rate、代打两率、DoT rate、heal、grant_first_aid；`chance_group`/`random_pick`/`morale_branch` 递归）；
   属性/控制/增减伤段不缩放，**战法链（连环计）等元机制段不缩放**。
   → 若要连战法链一起缩放：在 `runChainSkills` 里对 `ref.output` 也过一遍 `scaleDamageHealOutputs`。
3. **赐剑长驱「友军全体」= 监听范围**（本战法自身 output 只作用于自身 → `targetMode:'self'`）；
   再次发动时机 = 友军**每回合首次成功释放主动战法后**（含准备战法释放；`triggerAllyRecastCommands`）。
4. **僭号天子（袁术）玉玺 3 条推定**（见 `skills.ts` `jianhao_tianzi` 注释）：
   ① 「该比例每回合上升 10%」= 袁术**承担比例** 50% → 60% → … 每回合 +10%、**封顶 100%**；
   ② 「我军全体受到的所有伤害」含袁术自身，但**不含玉玺结转给他自己的那一次**（`ctx.sealResolving` 防自循环）；
   ③ 「受防御属性影响」取袁术当期**生效防御**（成长率未确认 → 基值 32%）。
   → 若 ① 实为「每回合**降低** 10%（50%→40%→…）或降到某下限」：只改 `tickRoundStartStatuses` 里
   `ratio = Math.min(1, 0.5 + 0.1 * (ctx.currentRound - 2))` 这一处。
5. **4 将的成长率**（率尔方雅增伤 22% / 策略 180%、鸾凤和鸣恢复 85%、赐剑长驱几率 40%、玉玺 32%）
   官方均未给系数 → 一律**按基值不缩放** + 登记 `OFFLINE_MAIN_SKILLS`（4 将**全部下架**，待 `derive_growth_rate.mjs` 反解）。

### 伏波扬砂口径（2026-09-19 用户口述确认，勿再询问）

- **「伤害共计提升幅度」= 该次普通攻击的「总增伤与总减伤**净合计**」（百分点）**：引擎实现为
  `buffMult(causedMult, takenMult, reduce) − 1` ×100（含兵种克制减伤），由 `dealAttack` 在**命中后**累入
  `ctx.stacksConsumeCounters`。
- **层数**：变量累计，**每当变量 ≥ 40% 就 −40% 并让马腾获得 1 层【扬砂】**（余数保留、跨次累计）；
  上限 20 层（满层后不再累计）。
- **消耗**：马腾普攻后每 4 层换 1 次额外普通攻击，重复触发至不足 4 层（额外普攻继续累计层数；
  单次行动上限 20 次防失控）。
- 25% 普攻增伤段「受攻击属性影响」官方未给系数 → 基值 25% + 登记 `OFFLINE_MAIN_SKILLS`（马腾下架）。

### UI 里看不到新武将？先查这几条（2026-09-19 排查结论）

1. **「下架」武将在配将池里默认不显示**：`web/heroes.ts` 的
   `export const HEROES: HeroJson[] = heroesJson.filter(isHeroListed)` ——
   进池条件 = 「主战法已实现 **且** 不在 `OFFLINE_MAIN_SKILLS`」（全量在 `ALL_HEROES`）。
   故若某批某将「实现了但池里找不到」，先查 `listing.ts` 有没有登记下架；
   受属性缩放段成长率未确认的将**默认不显示**，不是 bug。
   - **想看/想配这些将**：配将池（与「选择武将」弹窗）有「**显示下架武将（N）**」开关
     （`renderHeroPool` / `openHeroPicker` 共用，状态跨重渲染保持；打开后用 `SLOTTED_HEROES`，
     卡上带 `.offline` + 「下架」角标 + 原因 tooltip）。
     `HERO_RECORDS` 覆盖全部已挂主战法的武将、`getHeroById` 查 `ALL_HEROES`，故下架将可正常配将/进战报。
2. **搜索框只搜武将名 / 拼音 / 势力 / SP**，搜**战法名**找不到（战法名只在卡 `title` 提示里）。
3. **确认起服务/打包的是哪一棵树**：`web/data/heroes.json` 由 Vite **编译期内联**进产物，
   在旧树起 `npm run web`（或旧树里执行 APK 打包）时，池里一个新将都不会有。
   - 本地端口：`npm run web` 必须在**含本批提交的树**里跑；曾有 vite 从
     `.dsh/worktrees/075773c90805`（停在 main `a924e55`，`heroes.json` 命中 0/7）起来的先例。
   - APK：`android/`（**Capacitor**）打包 Vite 产物 → `android/app/src/main/assets/public/`，
     产物落 `android/app/build/outputs/apk/release/app-release.apk`。验证某份产物是否含目标武将：
     ```powershell
     # ① 战法定义是否在产物里（内联的 SKILL_REGISTRY）
     Select-String -Path "<产物>/assets/index-*.js" -Pattern "xiling_kejin" -SimpleMatch
     # ② 武将挂槽是否连上（内联的 heroes.json，形如 {id:"h574",…,mainSkillId:"xiling_kejin"}）
     Select-String -Path "<产物>/assets/index-*.js" -Pattern 'mainSkillId:"xiling_kejin"' -SimpleMatch
     ```
     两条都命中 = 数据没问题，剩下只需确认「手机里装的是不是这份新包」。
4. **主仓库里看不到**：合并回 main 后必须在**主仓库**重灌主库（见「下一次接续」的 ⚠️）。

### 下一次接续（2026-09-20 批次 · 策略 A 推进 §1.4）

- **工作树/分支**：`.dsh/worktrees/c00d4f51acc5/战斗系统`（本会话 DSH 工作区，**detached HEAD**，起点 `main` `19fb1a7`）；
  武将 33~40 逐个提交在**未命名分支的 detached HEAD** 上（**未 push、未合并**；落地方式待用户定，
  合并前先看 `docs/工作树落地流程.md`，且合并回主仓库后必须重灌主库——见下）。
  提交一律**显式列路径**（`git add src/... tests/... web/data/...`），不要 `git add -A` / `git add web`。
- **已验证基线**：`npx tsc --noEmit` clean；`npm test` **152 files / 1575 passed**（武将 40 后）；golden 字节一致。
- **策略 A（用户已确认，勿再逐条询问）**：① 官方现页 > 本地旧数据；② 两版拼接描述取**前半**（仓库 dedupe 口径）；
  ③ `targetShow` 与描述冲突以**描述**为准；④ 官方未给数值的段**不实现**（整将缺关键数值则跳过并说明）；
  ⑤ SP 卡 `iconId` 沿用 `portrait_map.json`。另：「两者 / 每个效果独立判断」= **各段各自 roll**
  （鸟云山兵 `independentRolls` / 将门有将逐段独立先例）；含糊表述按最可辩护解读实现 + 注释标「推定」。
- **§1.4「需先调研」45 位进度**（总表 `docs/research/README.md` + `heroes-research-merged.json`）：
  - 已完成 **12 位**：h653 将门有将 / h495 二夫之勇 / h788 雪奋短兵 / h815 蛮王御众（武将 29~32，已在 main）
    + **h803 知人待士（33）** / **h102011 胡笳离愁（34）** / **h631 断首何怒（35）** / **h805 勇挚刚毅（36）**
    + **h802 奇门遁甲（37，上架）** / h102002 定军绝战（38，上架）/ h534 破阵强袭（39）/
    **h810 万军取首（40，上架）**；剩余 **33 位**（口径见重生成的 `docs/下架武将清单.md`）。
  - 下一步优先（缺口 0、机制可补）：h800 守静却敌（`heal_boost` 已就位）/ h675 抚民励德 / h691 持刀从武 /
    h787 审时定计 / h791 疲兵沮意 / h814 敛微穷极 / h648 竭忠尽智 / h593 兵行巧变 / h645 统军畏慎 /
    h519 藤甲突击 / h534 破阵强袭 / h810 万军取首 / h102002 定军绝战 / sp_zhaoyun 银龙孤胆 …
  - 需「官方无数值」跳过或后置：h2 乱政 / h33 遗志 / h684 鏖兵卫主 / h812 锦车持节 / h480 酒池肉林 /
    h443 迟智难酬 / h795 天子诏令（两版取前半）/ SP卢植 中郎尽瘁 / SP太史慈 方阵掩杀；分摊类（h652 / h792）待机制。
- **本批（33~37）新增引擎件**：
  - `heal.targetPick:'lowest_troops_ally'` + `heal.attachStatus`（恢复与「并使其…」**同一目标**）——`15a54f1`；
  - `DamageTargetPick 'lowest_troops_in_range'`（战法距离内**当前兵力最低**敌军）——`15a54f1`；
  - **衰减类状态刷新重置**（`refreshDecayCounters`：`decayFifths` / `decayEighths` 同源重挂 = 份数与满额率重置）——`7669bff`；
  - **`heal_boost` 状态**（受到恢复效果提升）：`recoverTroops` 唯一收口 `demand = floor(amount × (1 + Σrate))`，
    主动 heal / rest / first_aid / recoverEachRound / healSource 统一受益 ——`55c225b`；
  - **`copyRandomActive`**（随机复制发动主动战法：除自身外敌我存活单位 `activeSkillIds` 去重抽 1、
    跳过准备直接执行 output、事件归属被复制战法）——武将 37；
  - **`positions?: Position[]`（伤害段站位定向）**：`physical_damage` / `strategy_damage` 直接锁定该站位存活敌军
    （万军取首「敌方大营」），不按 targetMode 重选——武将 40。
- **坑（本批踩过）**：`damage_boost.maxStacks` 必须**同时给 `stacks: 1`**（层计数初值），只给 `stack: true` 时
  计数不递增、封顶失效（破阵强袭第 7 次仍 +5%）——文德椒房同款写法。
- **每将流程**（沿用）：`skills.ts` 定义 → `build_heroes_seed.mjs` 挂槽 → 数据链三条命令
  （`build_heroes_seed` / `gen_skill_data` / `sync_hero_mainskill`，性别表变更再加 `sync_hero_meta`）
  → `tests/main_skills_bN.test.ts`（≥3 个，b63 起）→ `tsc` + 全量 `npm test` → 1 将 1 提交。
  **上架将**（无受属性段且无数值缺口）还须同步：`tests/offline_pool.test.ts` 的 `HEROES.length`（现 80）+1、
  `tests/heroes_panel_batch_20260916.test.ts` 的 XP 空槽表移除该将。
- **⚠️ 合并回主仓库后必须重灌主库**：主仓库路径推导出**主库 `stzb战斗系统`**，MySQL 可达时**不会回退 JSON**，
  于是「工作树里全绿、合回主仓库就红」（`main_skill_id` 为空）。修法 = 在**主仓库**跑数据链四条命令
  （`build_heroes_seed` → `seed_db` → `gen_skill_data` → `export_web_data`，性别表变更再加 `sync_hero_meta`），
  详见 `docs/工作树落地流程.md` §二.2（2026-09-19 两次合并各踩了一次）。
- **发动率区间口径**（已查证确认，勿动）：官方库 `probability` 为区间时**取上界 = 满级值**
  （浑水摸鱼 25-35→0.35 / 妖术 30-50→0.5 / 九锡黄龙 25-35→0.35 / 温酒斩将 20-35→0.35）；
  例外：`烽火覆周` 用 `[0.5, 1]`（既有实现）。
- **环境注意**：本机 MySQL 不可达（测试 stderr 的 `[heroes] 库 … 不可用` 属正常，走 JSON 回退）；
  `web/smoke.test.ts` 首个用例偶发超时 flake（并发跑全量时更易触发，复跑即绿）；
  生成《下架武将清单》用 `.\node_modules\.bin\tsx scripts/gen_offline_report.mts`
  （`npx tsx` 在本机会解析到 Desktop 仓库的 tsx，勿用）。


### 西陵克晋（陆抗 h574）联网查证结论 — 2026-09-18

来源：[官方技能库 200824](https://stzb.163.com/m/skilllist/200824.html)（原文**未给恢复率**）·
[官方攻略「西陵克晋加持马超」](https://stzb.163.com/strategy/zfxq/2019/10/09/21006_836478.html)（[17173 转载同文](https://news.17173.com/z/stzb/content/12302019/113840864.shtml)）·
[知乎《率土秘卷一：恢复效果》](https://zhuanlan.zhihu.com/p/454193204) · 仓库权威文档 `dateyuan/战斗伤害公式调研.md` §四。

- 属于 **Ⅱ 类指挥**（每回合行动判定；被混乱/犹豫仍执行）→ `phase:'round'` + `roundTrigger:'on_act'`；
- 伤害由**代打者（被施加效果的友军，可能是陆抗自己）自身属性**决定，并吃该友军自己的增伤（如马超【血溅黄沙】+120%）；
- 恢复为**立即型急救**：与任何恢复类战法不冲突，「恢复量与任何属性无关，仅由武将执行时的自身兵力决定」→
  走既有 `calcHealAmount(代打者当前兵力, rate)`；官方未给恢复率 → 取基值 100%（见上「复核结论」第 3 条）；
- 目标为距离 4 以内敌军**单体**（攻略明确，官方技能文本未写「单体」）。

### 剩余可做（§1.2 / §1.3 已收官）

| 战法（武将） | 官方要点 | 所需新机制 | 状态 |
|---|---|---|---|
| — | §1.2「补 1 个机制」+ §1.3「需补多个机制」全部完成（19 → 28 将，最后一将是 `辞后定朝`） | — | ✅ |

其余 **45** 个未实现战法全在 §1.4「需先调研」（缺失机制 2 类：多数需先抓官方数据，少数需官方数值）。

### 已踩过的坑

- **行动中施加的状态（`appliedRound>0`）按递减时点分两组 + 例外**（用户口径 2026-09-20，承接 8032010；
  `duration` 一律 = 官方字面回合数 N = 目标接下来 N 次行动都生效，与双方出手先后无关）：
  - **第 2 组 = 控制（犹豫/怯战/混乱/暴走）+ 属性（攻击/防御/谋略/速度）+ 增减伤（damage_boost/damage_reduce）
    → 「下次行动前递减」**：携带者**行动开始时**（effect 检查之前）先清掉上一轮到期项，再 `remaining -= 1`；
    减到 ≤0 **只打「下次行动开始时移除」标记、本次行动不移除**（`markStatusesOnActStart` 第 0 步清标记）。
    时序：**A = 持续到下一次行动前**（生效目标本次行动）、**B = 持续到 N+2 次行动前**（生效目标下一次行动，
    再下一次行动开始前移除）；`appliedRound === currentRound`（本回合刚施加、携带者还没行动）**也照此递减**
    （旧「同一回合刚施加不递减」跳过已取消）。在携带者**本次行动之内**施加的（行动开始后才挂上）由
    `tickStatusesOnActEnd` 补一次递减 —— 「之内施加的持续 1 回合」同样只生效本次行动。
  - **第 1 组 = DoT（妖术/燃烧/恐慌/妖术诅咒/引燃）+ 治愈（持续型急救 first_aid / 休整 rest）
    → 行动「结束后」递减**（`tickStatusesOnActEnd` 在 `actUnit` 三出口统一减；rest 仍只在跳恢复时减）。
  - **例外**：`priority`（作用在回合初排序，改时点会被吃掉）/`counter`（窗口「直到携带者下回合行动前」）
    保持「行动开始前递减 + 即时移除」，实测 A=1/B=1。
  - 准备阶段施加（`appliedRound === 0`）仍由回合末 `tickStatuses` 递减。
  - 已到期待移除（`remaining ≤ 0`）的第 2 组状态，同类型新状态施加时先清掉（`inflictStatus` 开头）——
    否则同源重挂会累加到僵尸状态上（怀橘遗亲每回合重挂 −10 → −20 → −30）。
  - 数据层同步回归（保留 8032010）：辕门射戟 `markCausedReduce.duration`、举抑臧否 属性/控制/洞察、
    以诱待来 taunt、万箭齐发 `damage_boost` 均为官方字面「1 回合」。
- 生成器幂等但**行尾**会漂移（CRLF/LF）：`git diff --numstat` 为 0 时属行尾噪声，`git checkout` 即可丢；
  `heroes.json` 末尾换行已在 `export_web_data` / `sync_hero_mainskill` 统一补 `\n`。
- 一类指挥若 `output: []` 且走「普通一类指挥直接执行」分支，须在条件里追加自己的新字段
  （已加：`delayedOutputs` / `onAttrChange` / `strategyAdjacentBonus`）——否则监听型指挥会误走通用分支。
- 单测替换 `ctx.skills` 里的战法定义**必须早于** `triggerCommandSkills`（锁定的是注册时的实例）。
- 新增 effect/status 标签：`EffectTag` 补了 `'retaliate'`、`'counter'`；`DotType` 独立成类型；
  本批又补 `StatusType`：`'pending_stacks'`、`'ignore_evasion'`（两者都**不按回合递减**，两个 tick 函数须显式跳过）。
  2026-09-19 批又补 `'control_spread'`（控制效果 +1 目标，消耗制，同样两个 tick 函数显式跳过）。
- **`runBattle` 收的是 `General[]`，不是 `UnitState[]`**——传错时报的是 `troopBonus.ts: keys is not iterable`（极具误导性）。
- **伤害断言必须扣掉 `troopBase`**：`calcDamage` 的兵力基础**不乘 mult**；且 `base` 含 `atkBaseRandomCoeff(rng)`，
  所以「同种子跑两次比大小」只在**两次 RNG 消耗完全一致**时成立（掷点类效果会破坏它——用「rate 0 的同消耗对照」）。
- **兵种相克 −30% 会污染伤害倍数断言**（步兵攻骑兵）；对照实验用同兵种消除该维。
- 新增机制若只加进 `types.ts` 而漏了 `pushStatus` 的字段拷贝，会被**静默忽略**（本批 `attackOnly` 就踩过一次，
  策略伤害被误增伤 30% 才发现）——`CreateStatus` 加字段后务必同步 `pushStatus` + `sameDamageBoostFilter`。
- 工作树里 **`.git` 是指针文件**（不是目录），临时提交信息文件要写到仓库根目录再删。
- **提交信息文件别被一起提交**：`git add -A` 会把临时提交信息文件一起提交（本批踩过，已 amend 修掉）——
  用 `git add src scripts tests web` 后再 `git commit -F <file>`。
- PowerShell `Get-Content`/`Set-Content` 往返改文件会吃掉相邻行的换行（本批两次踩中：
  `if (type === 'evade_chance') {` / `if (!skill.roundStartRepeat) continue;` 被并到下一行）——
  改文件优先用 edit 工具做最小上下文替换，改完立刻 `npx tsc --noEmit` 复核。
- 英雄测试里 `heroUnit()` 走 `level40()` → **兵力是 9000**（不是 dummy 的 30000）；绝对兵力断言会踩坑，
  用「相对起始值的差值」断言（本批 b53 踩过）。
- PowerShell 传中文 + 嵌套引号的 `node -e` 脚本会被转义破坏（本批踩了两次）——改用 edit 工具或按行号精确改写。

