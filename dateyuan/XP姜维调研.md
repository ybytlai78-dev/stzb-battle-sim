# XP姜维调研（已入库 2026-09-16）

> 调研日期：2026-09-16 ｜ 目标武将：**姜维·蜀·骑（season=XP，hero_id 100806）**
> 一键数据源：官网 `hero_extra.json`（live）+ 官网移动版详情页 `/m/herolist/100806.html` + `scripts/skill_extra.json`(200290)
> 状态：**已按用户拍板入库**（2026-09-16）—— 面板 + 画像 + 互斥白名单制落地；主战法【九伐中原】仍空槽下架

## 一、池内现状

| 姜维版本 | 官方 hero_id | 池内 ID | 状态 | 主战法 |
|---|---|---|---|---|
| 姜维·蜀·步 | 100074 | — | **未入库** | 列营守险（`skill_init` 200072，旧数据） |
| SP姜维·蜀·弓 | 102012 | `sp_jiangwei` | 已入库，**主战法空槽 → 下架中** | 列营守险（`skill_extra` 无该条 → 下架清单标「无官方数据」） |
| **XP姜维·蜀·骑** | **100806** | — | **未入库（本次目标）** | **九伐中原（`skill_init` 200290）** |

池内三个同名卡互斥关系目前未建：`sp_jiangwei` 的 `mutualExclusionGroup` 为 `null`。
（关羽蜀/魏、司马懿魏/晋 用的是同名互斥组；若采纳，两张姜维卡都要补上组名 `姜维`。）

## 二、数据来源与可信度（本次已实证）

| 数据项 | 来源 | 状态 |
|---|---|---|
| 星级 / 势力 / 兵种 / COST / 攻击距离 / 初始四维 | 官网移动版详情页 [100806](https://stzb.163.com/m/herolist/100806.html)、官网 `hero_extra.json`、游戏端导出 `hero.json` | ✅ 三源一致 |
| **四维成长值** | 官网 `hero_extra.json` 的 `attGrow / defGrow / ruseGrow / speedGrow` | ✅ 见下方交叉校验 |
| 主战法满级 / 1 级文案 | 官网详情页 + `scripts/skill_extra.json` 200290 | ✅ 一致 |
| 画像 | 官方 CDN | ⚠️ **仅 240×348 档可用**（470×592 档 404） |

### 2.1 成长值可信度（⚠️ 本节原结论已于 2026-09-16 作废，见下方更正）

`scripts/hero_extra.json` 里的 `*Grow` 字段可直接采信 —— 与 `dateyuan/hero_growth_verified.json`（游戏内截图 OCR）做了全量比对：

```
OCR 表 121 条 → 官网可匹配 119 条 → 四维基础值 + 四维成长值 全部一致 = 119 条
                                      有差异 = 0 条
                                      官网无对应 = 2 条（冯嫽、裴秀，官网未收录/改名）
                                      同名多版本按 COST 择近 = 29 条
```

~~即：官网成长字段与游戏内面板零误差。~~
**⚠️ 上句已于 2026-09-16 作废**：该比对脚本把字段名写成了驼峰（`baseAttack`），而表里是下划线（`base_attack`）→ `r.get()` 全返回 `None`，被 `if ov is None: continue` 跳过，**实际比较字段数 0**，才误报"全一致"。
真结果（167 条表 / 1335 字段）：**一致 107 条、有差异 60 条**（防御↔速度对调 24、仅攻击成长 11、攻↔谋对调 5 等系统性列错位）。详见 `dateyuan/批量武将入库调研.md` §5.1/§5.2。
（此前「官网不公开成长值」的表述已过期；`武将数据调研.md` 第 13 行已同步更正。）
附带结论仍成立：`scripts/hero_extra.json` 快照 == 官网 live（`100806` 记录逐字段相等），本卡无需重新抓取。

### 2.2 画像可用性（实测 HTTP 码）

| 档位 | URL | 结果 |
|---|---|---|
| 卡面 470×592（仓库主用，`h101`/`h703` 这一档） | `…/data/watermark/card_100806.jpg` | ❌ **404** |
| 中图 240×348 | `https://g0.gph.netease.com/ngsocial/community/stzb/cn/cards/cut/card_medium_100806.jpg?gameid=g10` | ✅ 200 / 41941 B |
| 头像 98×98 | `https://g0.gph.netease.com/ngsocial/community/stzb/cn/cards/cut/card_small_100806.jpg?gameid=g10` | ✅ 200 / 6974 B |

官网详情页自身引用的也是 `card_medium` 档；仓库已有同档先例（`h807` 晋司马懿 = 240×348）。
→ 要么按 `h807` 先例用 240×348 入库，要么用游戏内截图另补高清卡面。

## 三、拟入库条目（`heroes.json` 格式）

```json
{
  "id": "h806",
  "name": "姜维",
  "rarity": "5星",
  "cost": 3,
  "faction": "蜀",
  "tags": [],
  "mutualExclusionGroup": "姜维",
  "troopType": "cavalry",
  "attackRange": 2,
  "baseAttack": 82,
  "baseDefense": 84,
  "baseStrategy": 89,
  "baseSpeed": 84,
  "growthAttack": 1.66,
  "growthDefense": 1.45,
  "growthStrategy": 1.97,
  "growthSpeed": 1.25,
  "mainSkillId": "",
  "mainSkillName": "九伐中原",
  "skillDesc": "自身发动主动战法后会对敌军群体发动一次攻击（伤害率90.0%）和策略攻击（伤害率90.0%，受谋略属性影响），本场战斗共计可发动九次；每回合开始时，自身造成所有伤害提升5.0%（受谋略属性影响），可叠加，持续至战斗结束"
}
```

原始字段对照（可回溯）：

| 官网字段 | 值 | 入库字段 |
|---|---|---|
| `id` / `iconId` | 100806 | `portrait_map.json` 用 `heroId: 100806`，`iconId: 100806` |
| `country` / `type` | 蜀 / 骑 | `faction: "蜀"` / `troopType: "cavalry"` |
| `cost` | 3.0 | `cost: 3` |
| `distance`（普攻距离） | 2 | `attackRange: 2` |
| `attack` / `def` / `ruse` / `speed` | 82 / 84 / 89 / 84 | `baseAttack/baseDefense/baseStrategy/baseSpeed` |
| `attGrow` / `defGrow` / `ruseGrow` / `speedGrow` | 1.66 / 1.45 / 1.97 / 1.25 | 同名转换 |
| 攻城 `siege` / `siegeGrow` | 4.0 / 0.45 | 引擎无攻城字段，仅备注 |
| `quality`（游戏端 `hero.json`） | 5 → 五星 | `rarity: "5星"` |
| 兵种适性 `type_availible` | 轻骑兵、木牛流马 | 引擎无适性字段，仅备注 |
| 内政 `policyName` / `policyDesc` | 倾财兴师：主城中每有一支部队不在所属城池内，主城部队使用铜钱征兵时间 -4.0%（铜钱消耗 +10.0%），至多叠 5 次 | 战斗模拟器不涉及，仅备注 |
| `share_desc` | 阴平穷寇非难御 如此江山空负人 | 可选文案 |

## 四、主战法【九伐中原】拆解与机制缺口

**官方元数据**（`scripts/skill_extra.json` id 200290）：类型 **被动** / 品质 **A** / 距离 **5** / 目标 **敌军群体**（引擎缺省 2 目标）/ 兵种适性 弓步骑 / 发动率 `--` / `effect` 标签：攻击伤害;策略攻击伤害;策略攻击伤害提高;攻击伤害提高

**满级（10 级）**：
> 自身发动主动战法后会对敌军群体发动一次攻击（伤害率90.0%）和策略攻击（伤害率90.0%，受谋略属性影响），本场战斗共计可发动九次；每回合开始时，自身造成所有伤害提升5.0%（受谋略属性影响），可叠加，持续至战斗结束

**1 级**：伤害率 45.0% / 45.0%，每回合增伤 2.5%，其余同（→ 数值随等级翻倍，非属性缩放差异）。

拆两段：

| 段 | 效果 | 引擎现状 | 需补 |
|---|---|---|---|
| ① 触发 | **每次**自身成功发动主动战法后 | 仅有**指挥**版的"本回合**首次**"钩子 `roundTrigger:'after_first_active'`（文德椒房，实现点 `src/engine/action.ts:3372 triggerAfterFirstActiveCommands`）。**被动无此钩子** | **新钩子**：被动·主动战法实际释放成功后触发（去掉"每回合首次"限制） |
| ① 输出 | 对敌军群体（2 目标）1 次攻击 90% + 1 次策略攻击 90%（受谋略） | ✅ 混伤同段有先例：`jijiao_zhishi` 掎角之势（同 `output` 数组 physical + strategy） | 仅需参数 |
| ① 上限 | 本场战斗**共计可发动九次** | 无战法级"触发次数上限"字段；同类计数先例：`selfPhysBoost.maxStacks`（恃强淬锋）、`ctx.firstAidCounters`（皇裔流离共享计数器） | **新计数器**（整场 9 次，触发后不再判定） |
| ② 叠层 | 每回合开始时，自身**造成所有伤害** +5%（受谋略），可叠加，持续到战斗结束 | ✅ 数值形态有先例：`mimou_dingshu`（密谋定蜀）`damage_boost rate 0.05 direction:'caused' strategyScaled` + `duration:999`；叠层触发点在 `tickRoundStartStatuses`（恃强淬锋 `onRoundStart`） | 需确认「所有伤害」不带 `damageType`/`damageSource` 过滤；⚠️ 别用 `roundStartRepeat` 硬套（该字段每回合重挂 output，语义与"叠层"相近但要按 §坑位 甄别） |
| ③ 缩放 | 90% 伤害率 / 5% 增伤**均受谋略属性影响** | — | **成长率未确认**（社区无公开数据；同类密谋定蜀为 0.15/点，不可直接套用） |

**入库结论（建议）**：照 SP姜维 / 司马氏先例 —— **先入库武将面板，`mainSkillId` 留空**（`listing.ts` 自动下架）。主战法要实装需先补 ①② 两个新机制，并按仓库规则把「受谋略成长率未确认」写进 `OFFLINE_MAIN_SKILLS`，成长率确认前不上架。

**定位旁证**（社区，供强度参考，非入库数据）：3C 单核输出向；被动战法**不吃反计之策**；需带双主动战法最大化触发 9 次；谋略成长 1.97 与官网一致。来源：[九游解析](https://www.9game.cn/news/11469295.html)、[17173](https://news.17173.com/content/10222025/150740790.shtml)。

## 五、可拆解战法【避锐治气】（本次不入库）

`skill_extra.json` id 200291：指挥 S / 距离 5 / 我军群体（有效距离内 2 个目标）。拆解来源含【蜀·姜维·骑】。
已在 `dateyuan/通用战法待添加名单.md` 第 49 行登记 —— 属通用战法线，**不在武将入库范围**。

## 六、拍板结果与落地（2026-09-16）

| 项 | 用户拍板 | 落地位置 |
|---|---|---|
| 命名 | **XP姜维** | `id: xp_jiangwei` / `name: "XP姜维"` / tags 空（`build_heroes_seed.mjs` 的 `idOf` 特例） |
| 互斥规则 | 只有特定组合互斥：**赵云↔SP赵云**、**姜维↔SP姜维**；其余（含 姜维↔XP姜维）可同队 | `build_heroes_seed.mjs` 改**白名单制**（原「同名自动成组」废止）→ 原 8 组（司马懿/吕布/曹操/荀彧/袁绍/关羽/董卓/貂蝉）全部放开，XP 卡不入组 |
| 画像 | 用官方可用档（240×348） | `public/portraits/xp_jiangwei.jpg` + `_s.jpg`，`portrait_map.json → heroId 100806` |
| 主战法成长率 | 留空、下架 | `mainSkillId: ""` → `isHeroListed=false`（`listing.ts`），实现前不上架 |

**实际改动清单**：`dateyuan/hero_growth_verified.json`（+XP姜维条目）、`scripts/build_heroes_seed.mjs`（互斥白名单 + id 特例）、`scripts/map_portraits.mjs`（XP 卡识别）、`web/heroes.ts`（**顺手修掉 `HeroJson` 的 JSON 推断脆弱点** —— `tags` 被推成 `never[] | string[]` 导致 `tags.includes('sp')` 三处 tsc 红）、`web/data/*.json`（生成物）、新建 `tests/heroes_panel_xp_jiangwei.test.ts`；测试同步：`tests/mutual_exclusion.test.ts`（重写为白名单口径）、`tests/heroes_panel_q7.test.ts`（荀彧不再互斥）、`web/smoke.test.ts`（关羽蜀/魏 不再被拒）。

**门禁**：`npx tsc --noEmit` clean ＋ `npm test` 82 文件 / 1050 用例全过。
**遗留**：主战法【九伐中原】需新机制（被动·主动战法成功后钩子 + 全场 9 次上限）＋ 受谋略成长率确认后才可上架 —— 见 §四。
