# Task 4 Review：四张战法入库

**Reviewer check:** 只核对本任务：`src/data/skills.ts` 末尾四键（`wanjian_qifa` / `wenfa` / `bugong` / `shiqiang_cuifeng`，~3774–3899）与 `scripts/build_heroes_seed.mjs` `SKILL_ID_BY_NAME` 四行（~116–119）。对照 `task-4-brief.md` 字面量、`docs/superpowers/specs/2026-09-16-拆解通用B级以上-受攻击缩放-design.md` §「四张数据」及全局约束（extra 文案为准；文伐 `growthRate` 2.1；其余无 `growthRate`；不攻怯战；不删五星；无 commit）。未复跑 suite（采信 tsc PASS + `attack_scale` 12/12）。

## Spec Compliance

| 要求 | 判定 |
|------|------|
| 万箭齐发：无准备、35%、range 5、群体 2、物理 150%、策略 caused −0.5 `attackScaled` duration 2、无 `growthRate` | ✅ 与 brief / design / extra 200714 一致 |
| 文伐：追击 `[0.2,0.4]`、策略 228 `strategyScaled` `growthRate:2.1`、再挂 taken +0.2 charges 1 duration 999、无成长率 | ✅ 输出顺序先伤后状态；2.1 唯一成长率 |
| 不攻：一类 prep self；怯战 999 + 策略 caused +0.25；`roundStartRepeat` 距离 5 单体策略 83 `strategyScaled` 无 `growthRate` | ✅ 禁普攻复用怯战，未新开状态 |
| 恃强淬锋：battle_start self；taken −0.3 `attackScaled` `decayFifths:5`；`selfPhysBoost` 0.034/12/`onRoundStart`+`onDealPhysical`；无 `growthRate` | ✅ 与 brief / design 字面量一致 |
| `SKILL_ID_BY_NAME` 四行中文名→id；未跑 `build_heroes_seed.mjs`；无 git commit | ✅ |
| 不删/不改既有五星（落首箭～文德椒房仍在；四张追加在对象末尾） | ✅ |
| tags / id / name / type 与 brief 一致 | ✅ |

**本闸范围外（brief 未要求，不计 Spec 失败）：** `universal_b_plus_p3` 每战法 3 测、`_classified.json` / 清点同步、seed/DB/Web JSON。

## Strengths

- 四键与 brief 伪代码逐字段对齐；文伐唯一写 `growthRate:2.1`，万箭/不攻 83%/恃强减伤与叠层均无编造成长率。
- 五星已占 `sata_ruxing` 之后槽位时，改在 `wende_jiaofang` /「文德椒房」后追加，报告写明动机，符合「不要删五星」约束。
- 不攻怯战 + `roundStartRepeat` + 输出级 `range:5` 与 design §6 / Task 3 引擎约定一致。

## Issues

#### Critical

（无）

#### Important

（无）

#### Minor

1. **Brief 写「`sata_ruxing` / 飒沓如星后追加」，实现落在五星末尾** — 为保五星条目正确；报告已说明。后续若有人按 brief 字面重排，需注意勿插入五星之间。
2. **恃强 extra `distance:5`，引擎 `range:1`** — 跟随 brief/design 的 self 被动口径；展示距离与引擎自目标 range 差属既有约定，非本任务编造。
3. **本任务无装配/机制测** — 由后续 p3 集成任务覆盖；本闸仅数据入库，可接受。

## Assessment

**Spec compliance:** ✅ Pass  
**Task quality:** Approved

四张 `SKILL_REGISTRY` + 映射与 brief/extra/design 对齐；全局约束满足。Critical 0 / Important 0。
