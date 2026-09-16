# Task 6 Review：六人机制 / 数值测（五星主战法第一刀）

**Reviewer check:** 对照 `.superpowers/sdd/task-6-brief-五星.md` + Controller 闸门（六战法各 ≥3；落首/长坂/烽火/虎步/火兽/文德事件口径；无编造 `growthRate`；不删 golden；不 commit；`prepared_timing` 修 `prepareTurns` 在本闸范围内）。采信报告：b20 31 + prepared_timing 35 = 66 PASS；未复跑 vitest。Diff 以 `task-6-review-pkg.md` 为准（b20 全文件 untracked + `prepared_timing.test.ts` tracked）。

## Spec Compliance

| 要求 | 判定 |
|------|------|
| 每战法 ≥3（装配已有 + ②③） | ✅ 落首/长坂/烽火/虎步/火兽/文德各 3 |
| 落首箭②：300 + 大营物理 + 大营混乱 | ✅ 强制 1 回合准备释放；`phys≥2`、大营命中、混乱；300/180 用 `breakdown.main` 比（首目标非大营时） |
| 落首箭③：第一目标大营 → ≥2 段 physical + `luoshou_jian` | ✅ 敌军只留大营 |
| 长坂之吼②：真实 id 2 回合准备时序 | ✅ `prepare_start` → 仍准备 → `prepare_end` + damage；`prepareLeft` 2→1 |
| 长坂之吼③：`ignoresTroopCounter`，无 `troop_counter` | ✅ 步打骑，`modifiers.reduce` 断言 |
| 烽火覆周②：chain>1 strategy；无 burning | ✅ `chance=1/decay=0.5`；无 `burning` status |
| 烽火覆周③：谋略 80 vs 200 同 `breakdown.main`；无 growthRate | ✅ `chain.chance=0` 取首段；未断言编造成长率 |
| 虎步关右②：charges 1 / 0.7 / physical；物理后消失 | ✅ 强制发动后查 status；`actUnit` 后 charges 空 |
| 虎步关右③：策略不消耗、不吃 0.7 | ✅ 另挂策略刀；charges 仍在；`caused` 无 0.7 |
| 火兽冲锋②：chance=1 → 160 物理 + 普攻 caused 含 0.8 与 1.6 | ✅ `battle_start` + `forceSkill` chance=1 + `actUnit` |
| 火兽冲锋③：chance=0 无 160/无 charges；常驻 0.8 | ✅ |
| 文德椒房②：首次主动后距离内 2 友军 strategy caused +0.1 | ✅ 真实 `wende_jiaofang` + 简单主动 `triggerRate:1` |
| 文德椒房③：可再叠；同人 `stacks≤3`；准备进入不叠、释放才叠 | ✅ 准备路径 + 多回合叠满 |
| `prepared_timing` 尊重 `prepareTurns`（长坂 2） | ✅ 缺省 1；释放在 `r+prepareTurns`；上限 `floor(8/(n+1))` |
| 强制发动：`triggerRate`/`chance_group`/`chain` 改 ctx 拷贝 | ✅ `forceSkill` + `structuredClone` |
| 无生产代码必改、不改 spec 数值、不删 golden、不 commit | ✅ 仅测；引擎/`skills.ts`/golden 未动 |

**Spec verdict:** ✅ Pass

## Strengths

- `forceSkill` / `skillDamage` / `heroUnit` 把强制发动与真实挂槽测写清楚，且不污染 `SKILL_REGISTRY` 单例。
- 六战法口径与 brief 一一对应；烽火无成长、无燃烧、虎步物理/策略分流、火兽 chance 双分支都钉在事件或 status 上。
- `prepared_timing` 修法最小：参数化 `prepareTurns`，樊渊泅囚与其余 1 回合准备行为不变，长坂 2 回合纳入同一不变量。

## Issues

#### Critical

（无）

#### Important

（无）

#### Minor

1. **落首箭② 对「300%」的钉法偏软** — 首目标恰为大营时走 `phys.some(main ≥ campHits[0].main)`，几乎恒真，未强制拆出 300 vs 180 两段。三敌同防时首目标非大营分支的比值断言足够；若要更硬可固定比两段 `main` 或按目标分桶。
2. **文德椒房③「可重选」证据弱** — 叠层场景只有施法者+1 友军，`groupCount:2` 含自身后每回合必选满 2，未证明跨回合目标池重抽；`stacks≤3` 与准备不叠仍扎实。
3. **火兽②未显式断言 charges 状态** — 靠普攻 `caused` 同时出现 0.8/1.6 间接证明；与 brief「charges basic +1.6」等价，但缺一行 `charges===1` 更直观。
4. **`prepared_timing` describe 仍写「27 个」** — 标题计数可能过时，不影响断言正确性。

## Assessment

**Spec compliance:** ✅ Pass  
**Task quality:** Approved  
**Critical:** 0  
**Important:** 0  

机制/数值测与 brief 对齐；`prepared_timing` 的 `prepareTurns` 修复在范围内且正确。可收口。
