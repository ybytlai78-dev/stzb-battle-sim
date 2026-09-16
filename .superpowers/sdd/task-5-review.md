# Task 5 Review：六个战法定义 + 挂槽 + 下架 + 品级描述

**Reviewer check:** 本闸对照「五星主战法第一刀」计划 Task 5（`docs/superpowers/plans/2026-09-16-五星主战法第一刀.md` §Task 5）与 design 字面量，以及用户闸门约束（六 id；OFFLINE 仅三；无编造 `growthRate`；装配测在 b20；无 commit）。**不采信**磁盘上被覆盖成「受攻击缩放 p3」的 `.superpowers/sdd/task-5-brief.md`。只评六新条目 + `listing` 三行 + `SKILL_ID_BY_NAME` 六行 + b20 装配；`skills.ts`/`SKILL_ID_BY_NAME` 中并存的兵种阵型 / 万箭齐发等并行会话内容不计本闸 Extra/Missing。未复跑 vitest（采信报告 装配 6 PASS / listing+dataIntegrity / tsc）。

## Spec Compliance

| 要求 | 判定 |
|------|------|
| `luoshou_jian`：准备主动；300 + 大营 `positional` 180 + 大营混乱 `duration:[1,2]` | ✅ 与 plan/design 逐字一致 |
| `changban_zhihou`：`prepareTurns:2`、`groupCount:[2,3]`、rate 450、`ignoresTroopCounter` | ✅ |
| `fenghuo_fuzhou`：`triggerRate:[0.5,1]`、策略 95、`strategyScaled`、无 `growthRate`、`chain:{0.6,0.2}` | ✅ |
| `hubu_guanyou`：`triggerRate:1.2`、`charges:1`、`damageType:'physical'`、`speedScaled`、无 `growthRate` | ✅ |
| `huoshou_chongfeng`：`battle_start` +0.8 basic；`roundStartRepeat` `chance_group` 0.5 → 160 + charges 1.6 basic | ✅ |
| `wende_jiaofang`：二类 `round` + `after_first_active`；group 2 ally；策略 +0.1、`maxStacks:3`、`strategyScaled`、无 `growthRate` | ✅ |
| `OFFLINE_MAIN_SKILLS` 本批仅烽火覆周 / 虎步关右 / 文德椒房（文案与 plan 一致）；落首箭/长坂/火兽不上表 | ✅ |
| `SKILL_ID_BY_NAME` 六中文名→id（落在飒沓如星之后） | ✅ |
| b20 六条装配测（h524/h22/h376/h435/h494/h655）断言与 plan Step 1 一致 | ✅ |
| 中文 JSDoc；烽火/虎步/文德无编造 `growthRate`；无 git commit | ✅ |
| 报告声称的 `heroes.json` 六 `mainSkillId`、grades A/A/B/B/A/C、desc 六键 | ✅（工作树抽查存在；非 review-pkg tracked diff） |

**Spec verdict:** ✅ Pass

## Strengths

- 六战法字面量与 design/plan 伪代码对齐；三张受成长未确认战法仅标 `*Scaled`、不写 `growthRate:0`。
- 下架集合正确收窄；装配测覆盖挂槽类型与关键字段门禁，机制测明确留给 Task 6。
- JSDoc 点明英雄、前半口径与「无成长/取基值」。

## Issues

#### Critical

（无）

#### Important

（无）

#### Minor

1. **磁盘 `task-5-brief.md` 内容错位** — 当前 brief 是另一计划（受攻击缩放 p3），与本报告/本 diff 无关。本闸按 plan/design + 用户闸门审；controller 应恢复正确 brief 以免后续闸误读。
2. **同 diff 夹带并行会话条目** — `skills.ts` / `SKILL_ID_BY_NAME` 另含兵种阵型与万箭等；本闸按指示不评。六新条目本身未被改写。
3. **装配测未锁全字面量** — 如烽火未断言 `rate:95`/`strategyScaled`，虎步未断言 `charges`/`speedScaled`；与 plan「可先只写装配」一致，由 Task 6 补齐。

## Assessment

**Spec compliance:** ✅ Pass  
**Task quality:** Approved  
**Critical:** 0  
**Important:** 0  

六战法字面量、三下架、映射与 b20 装配满足 Task 5；机制深度测属 Task 6。
