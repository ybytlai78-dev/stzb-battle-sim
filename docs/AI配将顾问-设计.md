# AI 配将顾问 · 设计（一期：快工具闭环）

> 状态：**设计定稿，待实施**（2026-09-29 会话定稿）。
> 上位线：伤害分析工具 L1~L4（口径见 `docs/会话交接-伤害分析工具.md`，本文件不重复其口径，只引用）。
> **本文件 = AI 顾问这条线的唯一口径来源**；实施时在 `AGENTS.md` 顶部活跃工具线处加一行指向本文件。
> 第一版形态（用户 2026-09-29 选定）：**自己用 · 主站内嵌抽屉 · API key 存本机 localStorage**。

## 0. 一句话

给主站加一个右侧对话抽屉：用户说人话提需求 → LLM 追问约束 → **自己调用 L1~L4 已有的确定性跑批能力** → 产出**带实测数据**的配将方案卡 → 一键应用到配将区。

**核心口径：AI 不下场算数。** 引擎（`src/engine/*` + `web/simExpectation.ts` / `web/simMate.ts` / `web/battleSim.ts`）是唯一数字来源；LLM 只做"理解人话 / 追问约束 / 取舍叙述"。

## 1. 分工与理由

| 谁 | 干什么 | 为什么 |
|---|---|---|
| 引擎 + 既有跑批 | 跑数、出期望值 / 置信区间 / 并列标记 / 胜率 | 可复现（种子 = `baseSeed + 场次`）、快（L2 8062 场 57s；L3 889 场 2.7s；L4 3.2ms/场）、不含幻觉 |
| LLM | 意图理解、缺约束时追问、把工具结果翻译成取舍建议、声明不确定性 | 这些正是确定性代码做不好的部分 |
| 校验门（本设计新增） | 合法性裁决、数字溯源、标准口径复算 | 决定"能不能给用户看 / 能不能应用" |

**已被否决的做法**（勿再提）：让 LLM 直接推算伤害数值；让 LLM 输出的自然语言建议不经校验直接展示；AI 只做"翻译 + 预填 `optimize.html`"（对话与跑批割裂）；离线方案库 + 在线检索（覆盖不了用户自己的将池与截图识别回来的对手）。

## 2. 架构与模块边界

新增目录 `web/advisor/`，五个模块各一个职责，逐个可单测：

| 模块 | 唯一职责 | 认识 | 不认识 |
|---|---|---|---|
| `transport.ts` | 发消息、收流式增量、拼装完整 `tool_calls` | OpenAI 兼容协议、本机 localStorage 里的 key | 配将、引擎、DOM |
| `tools.ts` | 工具注册表 `{ name, description, schema, cost, run(args, ctx) }` | 既有导出（`teamConfig` / `simExpectation` / `simMate` / `teamScan` / `heroes`） | LLM、DOM |
| `loop.ts` | 对话循环：历史 → transport → 有 `tool_calls` 就执行 → 回灌 → 直到终答；管预算、取消、进度 | transport + tools | DOM |
| `gate.ts` | 校验门：合法性 + 数字溯源 + 标准口径复算 | `teamScan` 口径 + 引擎跑批 | LLM 的措辞 |
| `cache.ts` | 跑批结果缓存 + 会话/设置持久化（localStorage 三把键） | `types` 的 `planKey` | LLM、DOM |
| `view.ts` + `advisor.css` | 对话流、方案卡、进度条、成本行、设置区、`应用` 按钮 | `loop` 产出的 `AdvisorTurn` | 引擎内部 |

**依赖注入**：`tools.ts` 不直接 `import` 跑批实现，跑批函数由 `ToolCtx` 注入 → 测试里注入"毫秒返回的假跑批"，全链路可离线测。

### 边界纪律（防烂尾）

1. **引擎侧一期零改动**：`web/advisor/*` 只使用 `web/*` 既有导出，不改 `src/engine/*`。
2. **三层互不认识**（传输层不认识配将、工具层不认识 LLM、循环层不认识 DOM）。
3. **主站只加一个入口 + 一次视图挂载**，现有配将 / 战报 / 模拟逻辑一行不动。
4. **数字不经过 LLM**：方案卡上的数字由 `view.ts` 从 `ToolResult.data` 直读。

## 3. 工具协议

```ts
type ToolSpec<A> = {
  name: string;
  description: string;                                  // 给 LLM：何时用、边界、代价
  schema: JSONSchema;                                   // 参数（object 根）
  cost: { battles?: number; long?: boolean };           // 预算护栏据此预判
  run(args: A, ctx: ToolCtx): Promise<ToolResult>;
};

type ToolResult = {
  summary: string;                                      // ≤200 字，唯一进 LLM 上下文的部分
  data: unknown;                                        // 明细，只挂本轮 trace，渲染层直读
  evidenceId: string;                                   // 数字溯源锚
  stats: { battles: number; ms: number; seed: number }; // 卡上「实测 N 场」取自这里
};
```

- **`summary` / `brief` / `data` 三段**：`summary`（≤200 字）+ `brief`（≤15 行紧凑明细）进 LLM 上下文；完整跑批明细（可能几万行）只走 `data`，由渲染层直读。用户 2026-09-29 口径：**要它能做实事，不为了省 token 把明细全砍掉**——所以 `simulate` 的 `brief` 带上「每将场均贡献 + 每战法场均贡献」。
- **`evidenceId`**：LLM 引用数字必须写成 `{ value, evidenceId }`（输出 schema 强制），由 `gate` 回 trace 核对。
- **`cost`**：预算四件套（默认值，可配置；**2026-09-29 按用户口径抬额**——不再为省 token 卡住模型）——**单轮 40 次工具调用 / 累计 200,000 场 / 900 秒 / 100 万 token**；任一超限即**拒绝执行**该工具，并把拒绝原因作为 `tool_result` 回灌（**带上"本次预计多少场、本轮已用多少"**，让模型知道该调小规模，而不是反复重试同一个大搜索）。
  - 首跑实测（2026-09-29）：8 次上限把"曹纯最强怎么配"这类**研究型问题**掐死在检索阶段（模型自己如实报告"检索额度用完、曹纯本人还没打开看过"）→ 抬到 40 次；随后"文鸯"那次又证明 40 次会被"手搓对拍"烧光 → 因此把 L2/L3 搜索提前到一期（见工具清单下的口径框）。

### 共用类型 `Plan`

`validate_plan` / `simulate` / `apply` 共用同一类型，避免三套口径漂移：

```jsonc
{
  "slots": [
    { "position": "大营", "heroId": "h574", "level": 40, "skillIds": ["weiyakunJun", "jixian_yuanjin"] },
    { "position": "中军", "heroId": "h672", "level": 40, "skillIds": [] },
    { "position": "前锋", "heroId": "h102003", "level": 40, "skillIds": [] }
  ],
  "coreUnitIds": ["h574"],                                                     // 排序口径；缺省 = 自动识别核心将
  "dummy": { "defense": 150, "strategy": 100, "troopType": "步", "troops": 150000 }
}
```

`simulate` 的返回字段**直接复用 `web/simExpectation.ts` 的 `FinalRow`**：`mean`（口径值 = 核心将伤害期望）/ `meanTotal`（全队总伤，参考）/ `sd` / `halfWidth` / `runs` / `tieWithBest` / `byUnit` / `bySkill` / `wipedRuns`。

### 工具清单与分期

| 工具 | 背后是谁 | 代价 | 期 |
|---|---|---|---|
| `get_config` | 主站配将区当前配置快照（`teamConfig` 口径） | 毫秒 | 一期 |
| `validate_plan` | `web/teamScan.ts` 校验口径 + 互斥规则 | 毫秒 | 一期 |
| `simulate(plan, runs≤200)` | `generalsOf` + 引擎 `runBattle`（L2 木桩口径） | 20 场 ≈ 0.1s | 一期 |
| **`simulate_many(plans≤8, runs)`** | 一次对拍多套方案并按期望排序（含"分不分得出来"） | 套数 × 场次 | **2026-09-29 补**（实跑暴露：模型一套一套手搓 `simulate`，9 次调用才比 9 套） |
| `search_hero(q)` / `search_skill(q)` | 既有数据表 + 拼音搜索 | 毫秒 | 一期 |
| `skill_detail(id)` | `SKILL_REGISTRY` + 品级/描述表 | 毫秒 | 一期 |
| **`hero_detail(id)`** | 武将档案：阵营 / 兵种 / 攻击距离 / 40 级四维 / 成长 / 主战法 + 官方描述 | 毫秒 | **2026-09-29 补**（首跑暴露：模型此前只能拿到 id，配不了队） |
| **`list_skills(slot, offset, limit)`** | 按出手位批量拉池子（分页） | 毫秒 | **2026-09-29 补**（省调用次数：模型此前靠逐个词搜） |
| `optimize_skills(plan, slots)` | `web/simExpectation.ts` 三阶段搜索 | 千~万场，秒~分钟 | **2026-09-29 提前到一期** |
| `optimize_mates(plan, positions)` | `web/simMate.ts`（L3） | ≈900 场 / 3s | **2026-09-29 提前到一期** |
| `matchup(planA, planB, runs)` | `web/battleSim.ts`（L4 胜率） | 500 场 ≈ 1.6s | 二期 |

> **2026-09-29 用户拍板（口径，勿再动摇）**：**AI 就该调 L2/L3，不该自己一个个翻战法**。
> 原计划把这两个搜索放在二期（一期只做"快工具"），结果是模型退化成"人肉搜索器"——用 28 次调用逐个 `skill_detail`，再手搓 9 套候选做对拍。
> 现在 `optimize_skills` / `optimize_mates` 是**一等工具**：一次调用真跑几千~上万场，返回带区间的排序榜单；系统提示词也改成"凡'最强/输出最大化'首选搜索，不要自己翻战法"。手搓对拍（`simulate_many`）只保留给"已经确定要比的少数方案"。

**检索口径（2026-09-29 扩面）**：原匹配串只有「名称 / id / 出手位 / 品级」，模型搜「骑兵」「攻击」直接 0 命中、白烧调用次数（它自己在回答里点出了这个现象）。现并入 **效果标签 + 官方描述全文 + 主战法名**，并统一用**中文出手位**（`SLOT_LABEL`，同时认英文键）。0 命中时 `brief` 直接给换词提示。

## 4. 系统提示词硬规则

1. 数字只能来自工具返回，且必须带 `evidenceId`；没跑过就说"没跑过，要我跑一下吗"。
2. 提方案必须走 `ProposedPlan` 结构，不许只给一段自然语言。
3. 默认排序口径 = **核心将伤害期望**；换口径必须明说（全队总伤只作参考列）。
4. **区间重叠 / `tieWithBest` 必须说"分不出来"**，不许说"第 1 名更强"。
5. 边界主动声明：木桩不还手 → 控制 / 防御型队友的价值量不出来（那是 L4 胜率的事）；解析口径不含控制 / 规避 / 兵力截断。
6. 工具报错如实转述并改法，不许编一个结果圆过去。

## 5. 校验门三道关（`gate.ts`）

**关 1 · 合法性**
`validatePlan(plan)`：武将存在（含 SP / 同名多版区分）、战法可学且非主战法、每将 ≤2 槽（`SKILL_SLOTS`）、全队战法唯一（`LEARNABLE_SKILL_IDS`）、同队互斥（`mutualExclusionGroup`：赵云↔SP赵云、姜维↔SP姜维）。
返回 `{ ok, errors: [{ code, message, slotIndex? }], normalized }`；**错误带 `code` 回灌让 AI 自纠**（上限 2 次），不静默丢弃。

**关 2 · 数字溯源**
逐条核对回答里的 `{ value, evidenceId }`：`evidenceId` 必须存在于本轮 trace，且 `value` 与该次 `data` 中的数字满足

```
|claimed - actual| ≤ max(0.005 × |actual|, 1)      // 相对 0.5% 与绝对 1，取宽者
```

（防止"26,500 写成 2.65 万"被误杀；也防止把 26,500 说成 31,000 混过去。）
**方案自带的 `evidenceIds` 同样要核**：一个都不带的方案（`evidenceIds: []`）视为「未验证」——没跑过的方案不许应用。
对不上 → 该条降级标「未验证」+ **禁用「应用」按钮** + 把失败原因显示给用户。

**关 3 · 防"自己验自己"**
① 方案卡数字**由 `view.ts` 从 `tool.data` 直读**，LLM 完全不参与数字路径；
② `gate` 另用**标准口径独立复算一次**：固定常量 `ADVISOR_VERIFY_SEED = 20260929`、`runs = 20`、木桩模板取 §3 `Plan` 示例的默认值（防御 150 / 谋略 100 / 步 / 150,000 兵）；卡上并排显示「AI 搜索用 X 场」与「标准口径复算 20 场」：
- 两者 95% 区间重叠 → 标「一致」；
- 复算明显更差 → 标「该结果对口径敏感，谨慎采纳」。

（种子与场次是写死的常量，测试可直接锁定；不要用"当前时间/随机种子"做复算，否则不可复现。）

这样既堵住"AI 挑好种子 / 调小场次造优势"，又不会退化成拿 AI 那次结果自己验自己。

## 6. trace、缓存与 localStorage

```ts
type AdvisorTurn = {
  messages: AdvisorMessage[];
  toolCalls: { evidenceId: string; name: string; args: unknown; summary: string; stats: {...} }[];
  plans: ProposedPlan[];
  verdict: { legal: boolean; verified: boolean; recomputed: boolean };
};
```

- 整轮存 localStorage（沿用既有 `dsh-*-v1` 命名：`dsh-advisor-turns-v1` / `dsh-advisor-settings-v1`）；对话可复盘、方案可回填。
- **跑批结果缓存**：key = `(plan 规范化 JSON, runs, baseSeed, dummy 模板)`；命中直接复用 `evidenceId`，卡上标「复用同日缓存」（避免同一天反复问同一件事重跑几千场）。
- **key 只存本机**：`dsh-advisor-settings-v1` 明文存 baseURL / model / key；设置区写明「仅存本机 localStorage，直连厂商，不经过任何服务器」。

## 7. 交互与落点

**入口**：主站顶栏新增第 7 个入口「AI 顾问」→ 打开**右侧浮层抽屉**（`position: absolute` 右贴边，宽 ~400px，可收起），**不重排三列布局**；收起后与现状完全一致。窄屏（<1100px，含手机横屏）切成**全屏覆盖 + 顶部「对话 / 配将」tab**。

> 回归点：`web/smoke.test.ts` 断言 `.nav-link` 数量 = 6，加第 7 个入口时同步改 7（该数字历史上 3 → 5 → 6 改过，属预期更新）。

**抽屉三态**：收起 / 对话中（流式 + 工具进度）/ 出方案卡。

**方案卡**：一句话结论 ｜ 配置表（3 将 × 位置 × 战法）｜ 实测行（口径值 ± 半宽 · N 场 · 是否「与第 1 名并列」）｜ 两行对照（AI 搜索场次 vs 标准口径复算）｜ 按钮 `应用`（过 gate 才可点）/ `再跑 200 场精算`（二期）/ `对比当前配置`。

**成本可见**：抽屉底部常驻「本轮：3 次工具调用 · 8,062 场 · 57s · token 12,480（厂商 `usage` 累计；厂商不支持该选项时显示「—」）」。

**应用口径**：写回配将区走既有 `teamConfig` 配置写入路径。与 `optimize.html` 的「应用队友」**不同**：那边是"换将 + 清空该位战法槽"（战法交给 L2 另配），**顾问方案卡是完整方案（武将 + 位置 + 战法一起给）**，故应用时按方案写入战法槽；换将时等级沿用被替换槽位、加点清零、兵种取本体。

**`对比当前配置`**：对配将区现状跑一次同口径 `simulate`（同样 20 场 / 同种子），与方案卡并排显示差值与各自区间；只做展示，不改配置。

## 8. 错误处理

| 故障 | 处理 |
|---|---|
| 没配 key / 401 | 显示设置引导，不进循环，不吞错 |
| 流式 / 网络中断 | 保留已收内容 + 「重试这一轮」；**已执行的 tool 结果留在 trace，不重跑跑批** |
| 厂商不支持 tool-calling / 返回格式坏 | transport 层校验后降级「无工具模式」（只解释既有结果），明确告知用户 |
| CORS 被拦 | 提示改用本地小代理 `scripts/advisor_proxy.mjs`（几十行 node 脚本）+ 一键复制启动命令 |
| 工具抛错（非法配置 / 互斥 / 跑批异常） | 错误文本回灌让 AI 自纠（上限 2 次），仍失败 → 原样展示 |
| 超预算 | 拒绝执行 + 回灌原因 + 卡上提示「已达本轮预算」 |
| 数字核验失败 | 标「未验证」+ 禁用「应用」+ 显示失败原因（不静默修） |

## 9. 测试策略

| 文件 | 锁什么 |
|---|---|
| `tests/advisor_tools.test.ts` | 各工具 schema 与返回字段（`simulate` 对齐 `FinalRow`）；`validate_plan` 拒收：互斥 / 主战法占槽 / 全队重复战法 / 越界槽位；预算拦截 |
| `tests/advisor_gate.test.ts`（最关键） | ① 伪造 `evidenceId` → 标未验证 + 禁用应用；② `runs=5` 造的优势 vs 标准口径复算 → 标「对口径敏感」；③ 容差边界（26,500 vs "2.65 万" 通过；26,500 vs 31,000 不通过）；④ 非法方案即便数字对得上也不给应用 |
| `tests/advisor_loop.test.ts` | 假 transport 喂录制脚本：追问分支 / 工具分支 / 报错自纠（2 次上限）/ 超预算收口 / 取消中断 / 流式增量拼装 |
| `tests/advisor_cache.test.ts` | 同 key 命中不重跑并标「复用缓存」；换 seed / 场次不命中 |
| `web/advisorSmoke.test.ts` | 端到端 jsdom：入口 → 假 transport 走一轮 → 方案卡 → 点应用 → **主站配将区确实变了** → 收起抽屉不影响原有 nav / 三列 |
| 回归 | `web/smoke.test.ts` nav 6→7；全量 `npm test` 全绿；`tsc --noEmit` 与 `npx tsc --noEmit -p web/tsconfig.json` 两份 clean |

约定照旧：用到 `getGeneral` 的测试在 `beforeAll` 里 `await initHeroDB()`（本机 MySQL 不可达时回退 `web/data/heroes.json`）。

## 10. 分期与验收

### 一期（快工具闭环，可独立交付）

**交付**：`web/advisor/{transport,tools,gate,loop,view}.ts` + `web/advisor.css` + 主站入口与挂载 + 上述 5 个测试文件 + 设置区（baseURL / model / key）+ `AGENTS.md` 一行指向本文件。

**工具**：`get_config` / `validate_plan` / `simulate` / `search_hero` / `search_skill` / `skill_detail`。

**验收（逐条可测）**
1. 抽屉里问「这队为什么弱」→ AI 调 `simulate` 拿真数字 → 方案卡上的数字与 `simulate` 返回**逐字段一致**（测试锁定）。
2. 伪造 `evidenceId` 的回答 → 标「未验证」且「应用」禁用。
3. 非法方案（赵云 + SP赵云同队）→ 被关 1 拦下，AI 收到 `code` 并能自纠。
4. 全量 `npm test` 全绿、`tsc` 两份配置 clean、主站原有功能零变化（只多一个入口）。

**明确不做**：对手池匹配（`matchup` / L4）、跨设备同步、自主研究代理。

> **2026-09-29 修订（用户拍板，勿再动摇）**：原"一期不做大搜索（L2/L3 跑批）"**作废** —— `optimize_skills` / `optimize_mates` 已提前到一期并落地（见文末「切片一补丁 3」）。理由：AI 就该调 L2/L3，让它自己一个个翻战法是设计偏差。

### 二期（长任务）

接 `optimize_skills` / `optimize_mates` / `matchup`；进度条 + 取消 + 预算 + 缓存全量生效；「再跑 200 场精算」。

**验收**：抽屉里跑完一次「围绕核心将搜队友」（≈900 场 / 3s 量级）并出带区间的方案卡；取消 1s 内停下；同一问题第二次问命中缓存不重跑。

### 三期（可选）

对手池联动（截图识别回来的对手 → `matchup` 批量胜率）、方案历史与导出。

## 11. 与既有资产的复用关系

| 复用对象 | 用来做什么 | 一致性要求 |
|---|---|---|
| `web/teamConfig.ts` | 配置读写、`generalsOf` 构造引擎单位、候选搜索 | 应用方案走同一写入路径；`SKILL_SLOTS = 2` |
| `web/simExpectation.ts` | L2 木桩伤害期望（`simulate` / 二期 `optimize_skills`） | 返回字段直接用 `FinalRow`；排序口径 = 核心将伤害期望 |
| `web/simMate.ts` | L3 队友优化（二期） | 同靶子、同口径、同三阶段阈值 |
| `web/battleSim.ts` | L4 胜率（二期 `matchup`） | 胜负判定 / 样本 / 交换场地口径照旧 |
| `web/teamScan.ts` | `validate_plan` 的校验口径 | 一份实现两处调用，禁止另写一套校验 |
| `web/heroes.ts` / `src/data/skills.ts` / `skill_grades.json` / `skill_desc.json` | 检索与详情 | 不编造，缺失就报缺失 |

## 12. 已知风险与开放问题

1. **浏览器直连的可用性**：各家对浏览器侧调用的 CORS / 安全策略不一致 → baseURL 可配置；被拦时走本地代理脚本兜底。实施第一步先用真实厂商 key 做一次连通性验证（**不写进测试**，测试一律用假 transport）。
   → **2026-09-29 实测（预检 `OPTIONS`，不带 key）**：DeepSeek 与 OpenAI 均回 `access-control-allow-origin` 且**回显 Origin**（`http://localhost:5173` 与 `http://127.0.0.1:5173` 都通）。**本地直连可行 → Task 9 的本地代理暂时不需要**；只有换域名部署、或厂商日后收紧策略时才要做。
2. **工具调用能力**：国产模型对 function calling 的支持参差 → 降级「无工具模式」必须实现且被测到。
3. **预算默认值**（20,000 场 / 120 秒 / 单轮最多 8 次工具调用）是初始值，跑几次真实对话后按体感调。
4. **上下文长度**：`summary` 限 200 字是为了控 context，若发现 AI 因摘要过短答不准，先扩到 400 字再考虑分层摘要。
5. **主站单屏布局**：抽屉在 1366×768 这类小屏上是否拥挤，实施时用无头浏览器截图逐一确认（沿用 `scripts/_optimize_shot.mjs` 那套自检脚本模式）。

## 13. 落地记录 · 切片一（2026-09-29）

> 用户口径：**先不进主站**，只做实施计划的 Task 1~3 ＋ 一个最小文本界面验证成果。
> 分支 `dsh/ai-advisor`。计划文档：`docs/AI配将顾问-实施计划.md`。

**已交付文件**

| 文件 | 状态 |
|---|---|
| `web/advisor/types.ts` | ✅ Plan 共享类型 / `normalizePlan` / `planKey` / `parsePlans` / 工具协议 / 预算三件套 |
| `web/advisor/gate.ts` | ✅ **关 1**（`validateAdvisorPlan`：复用截图识别的 `validateScan` ＋ 跨槽规则）＋ **关 2**（`withinTolerance` / `collectNumbers` / `verifyClaims` / `verifyPlanEvidence` / `decideApply`）。**关 3 未接入** |
| `web/advisor/tools.ts` | ✅ 六个工具（`get_config` / `validate_plan` / `simulate` / `search_hero` / `search_skill` / `skill_detail`）＋ 预算护栏（`budget.battlesOf` 按实参计费）＋ `makeCtx`（生产/测试共用，测试可注入假跑批） |
| `web/advisor/transport.ts` | ✅ OpenAI 兼容流式 + SSE 解析 + `tool_calls` 分片拼装 + 错误分类（auth/cors/network/format）＋ 假传输（`text` 支持函数、`texts` 多段、`rejectTools`） |
| `web/advisor/loop.ts` | ✅ 精简版对话循环（`SYSTEM_PROMPT` 六条硬规则 + 两个格式约定、工具回灌、错误自纠、工具次数上限、取消、无工具降级） |
| `web/simExpectation.ts` | ✅ 新增 `evaluatePlan` ＋ 抽出 `aggregateSamples`（决赛 `finalRowOf` 与顾问共用同一份汇总；L2 既有 42 用例全绿证明行为不变） |
| `advisor-lab.html` + `web/advisorLab.ts` + `web/advisorLab.css` | ✅ 最小文本界面（**独立页，未并入主站**）：设置区 / 提问 / 事件日志 / 裁定 / 证据清单；`?fake=1` 干跑不联网 |
| `web/advisor/view.ts` + `web/advisor.css` | ✅ **主站右侧抽屉**（2026-09-29 接入，仅本地不部署）：流式日志 / 进度 / 方案卡（配置表 + 标准口径复算 + 搜索口径对照 + judge）/「应用到配将区」 |
| `web/advisorHost.ts` | ✅ 主站侧胶水：读 `state.red` → 方案；方案 → `onPickHero`/`onSetLevel`/`onAddSkill` 写回配将区（失败如实回报） |

**测试**：新增 6 个文件 51 个用例（types 6 / runplan 6 / tools 15 / transport 8 / gate 8 / loop 8），全绿；`tsc` 两份配置 clean；`golden.json` 未受影响。

**与设计的偏差（都是有意收窄，不是漏做）**

1. **关 3（标准口径独立复算）未接入** → `verdict.recomputed` 恒 false，`decideApply` 因此**不给「应用」开口子**（宁可不给，也不假装通过）。
2. **loop 为精简版**：不做会话持久化（`cache.ts` 未创建）、不做预算的完整提示链路（预算仍由工具层拒绝执行）。
3. **Task 2 换形态**：抽的是 `evaluatePlan`（跑 N 场 + 汇总）而不是单场函数 —— 顾问只需要整套汇总，单场接口是多余的（`aggregateSamples` 让汇总口径与 L2 单源）。
4. **`ToolCost` 增加 `battlesOf`**：`simulate` 的场次代价取决于实参 `runs`，否则预算只能按上限粗算。

**真机自检**（`node <temp>/lab-check.mjs ...`，无头 Chromium + jsdom 之外的**真浏览器**）：

- `http://127.0.0.1:5173/advisor-lab.html?fake=1` → 点「发送」→ 事件日志：`get_config`（0 场 / 1ms）→ `simulate`（**20 场 / 112ms**）；
- 证据清单：`ev-2-simulate` → 「真跑 20 场：核心将伤害期望 **7317 ±651**（95% 半宽）；全队总伤 15503；木桩被打空 0 场」；
- 裁定：关 1 通过 / 关 2 通过 / 关 3 未接入 / 应用禁用；
- `pageerror = 0`；唯一 console 提示是 `/favicon.ico` 404（仓库无 favicon.ico，独立页未声明 icon —— 与其他独立页同一既有噪音）。

**怎么用**

```bash
npm run web                     # 起服务后打开 http://localhost:5173/advisor-lab.html
# 干跑（不联网、不花 token，链路完全一样）：.../advisor-lab.html?fake=1
# 真模型：在页面上填 baseURL / model / key（只存本机 localStorage）
```

**2026-09-29 追加（用户首跑后）**

- 用户在浏览器里跑通干跑链路（截图留档）：`get_config` 0 场 → `simulate` 20 场 / 71ms → 关 1 / 关 2 通过、关 3 未接入、「应用」禁用。**注意：干跑模式不调用模型**，所以"AI 能不能把数据讲清楚"这一半仍待用户用真 key 验证。
- **CORS 风险已探明**：DeepSeek / OpenAI 预检都对本地两个 Origin 回显 `access-control-allow-origin` → 本地直连可行，代理脚本暂不需要（见 §12 风险 1）。
- 补了**前置校验**：真模型模式缺 baseURL / model / key 时不发请求，直接在页面上说明（否则只会白等一句 401）。无头自检复跑：护栏文案正确、干跑链路结果不变、`pageerror = 0`。

**下一步（按计划继续时）**：Task 5 关 3（标准口径复算 `ADVISOR_VERIFY_SEED = 20260929` / 20 场）→ Task 6 完整 loop（持久化、预算提示）→ Task 7 `cache.ts` → Task 8 主站抽屉（含 `web/smoke.test.ts` 的 nav 6→7）。

### 落地记录 · 切片一补丁（2026-09-29，用户首跑真模型之后）

**用户实测（真模型 deepseek-flash）**：问"曹纯的最强队伍和战法搭配"。模型的**行为是达标的**——拒绝编造（"这个我还没跑过，现在给不出最强"）、每条结论带证据编号、主动声明木桩/解析口径边界、把"最强"的口径问题推回给用户。
**但它被护栏掐死了**：跑到第 3、4 次调用就被拒（"检索额度用完了"），连曹纯的档案都没打开过。

**诊断（重要，别再误判）**：拦住它的**不是 token**——那一轮 token 才千级，本轮**根本没有 token 上限**。真正的三处瓶颈：

1. **单轮 8 次工具调用**（`loop.ts` 写死的 `maxToolCalls = 8`）→ 研究型问题必然不够；
2. **没有 `hero_detail`**：模型只能拿到武将 id，主战法/兵种/属性一律看不到 → 配不了队；
3. **检索面太窄**：「骑兵」「攻击」这类**描述性词** 0 命中（原匹配串只有 名称/id/出手位/品级）→ 模型反复换词试错，白烧次数。

**本补丁做的四件事**

| 改动 | 内容 |
|---|---|
| 额度抬升 | `DEFAULT_BUDGET` → **单轮 40 次调用 / 50,000 场 / 300 秒 / 1,000,000 token**（用户指定 100 万）；**次数上限的唯一真源改为预算**（loop 不再自写一个 8）；界面新增「单轮工具调用上限 / token 上限」两个输入框（持久化） |
| 新工具 `hero_detail` | 阵营 / 兵种 / 攻击距离 / 40 级四维 / 成长率 / 主战法 + 官方描述 / 是否上架 |
| 新工具 `list_skills` | 按出手位批量拉池子（分页 + "还剩多少、下次 offset"提示）——省调用次数 |
| 检索扩面 + `brief` | 匹配串并入 效果标签 + 官方描述全文 + 主战法名，出手位改**中文**（`SLOT_LABEL`，同时认英文键）；0 命中给换词提示；`ToolResult.brief`（≤15 行）随工具结果一起进上下文，`simulate` 的 brief 含**每将 / 每战法场均贡献** |

**验证**：顾问测试 51 → **59**（新增 hero_detail / list_skills / 检索扩面 / 0 命中提示 / brief / 次数上限来自预算 / token 记账与上限）；全量 `npm test` **224 files / 2406 tests 全绿**；`tsc` 两份 clean；无头浏览器复跑 advisor-lab：护栏与干跑链路均正常、`pageerror = 0`，成本行现在长这样：`本轮：2/40 次工具调用 · 20 场 · token 0 / 1000000`。

**仍未做（决定"最强"这类问题能不能真答出来）**：`optimize_skills` / `optimize_mates`（二期）——**没有搜索工具，模型只能"试几套手搓方案做对比"，给不出穷举意义的最优**。这是下一步最该做的。

### 落地记录 · 切片二（2026-09-29，接入主站，仅本地不部署）

**用户口径**："先接入主站，只接到本地端口的主站不部署到网站。"

**做了两件事**

| 改动 | 内容 |
|---|---|
| **关 3 · 标准口径独立复算**（实施计划 Task 5） | `gate.ts` 新增 `ADVISOR_VERIFY_SEED = 20260929` / `ADVISOR_VERIFY_RUNS = 20` / `recomputePlan`（**固定种子 + 20 场 + 标准木桩**，不采信 AI 那次搜索的数字）/ `judgeRecompute`（搜索口径 vs 复算口径：区间重叠 = `consistent`，复算明显更低 = `sensitive`）/ `searchHintFromTrace`（从方案引用的证据里取搜索口径值）/ `checkPlan`（一个方案跑完三关 → `apply.enabled`）。loop 据此产出 `AdvisorTurn.checks`（与 `plans` 同序），`decideApply` 的第三个条件从此有真值 |
| **主站抽屉**（实施计划 Task 8） | `web/advisor/view.ts` + `web/advisor.css`：顶栏第 7 个入口「AI 顾问」→ 右侧抽屉（流式正文 / 工具轨迹 / 长搜索进度 / 成本行 / 设置折叠区）。**方案卡**：三将配置表 + 关 3 复算值（带种子）+ 搜索口径对照 + judge + 「应用到配将区」（三关不过则禁用并显示原因）。`web/advisorHost.ts` 承担主站胶水：`readTeam()` 读 `state.red`，`applyPlan()` 走 `onPickHero`/`onSetLevel`/`onAddSkill` 写回并 `refresh()`，被互斥/重复拦下时**如实回报"部分未应用"而不是假装成功** |

**真机验收**（无头 Chromium，`http://127.0.0.1:5173/`）：导航 7 项 ✓ → 点「AI 顾问」开抽屉 ✓（无 key 自动勾干跑）→ 提问 → `get_config`（0 场）→ `simulate`（20 场 / 99ms）→ 方案卡出现「**标准口径复算（20 场 / 种子 20260929）：核心将期望 14,024 ±1,590**」与「搜索口径（ev-2-simulate，20 场）：14,124 ±1,855 → 区间重叠，**一致**」→ 点「应用到配将区」→ **左侧红队三槽由空变为 XP关兴＆张苞 / 颜良＆文丑 / SP赵云**，顶部提示「已把方案写入配将区（红队）」；`pageerror = 0`、console 报错 0。

**验收口径**：`web/advisorSmoke.test.ts`（4 个：抽屉开合 / 一问到底三关通过且应用可点 / 伪造 evidenceId → 关 2 不通过 → 按钮禁用 / 缺 key 不发请求）+ `tests/advisor_host.test.ts`（5 个：读配将区 / 换将改等级重设战法 / 同将换战法先删后加 / 主站拦下时如实回报 / 空方案不改动）+ `tests/advisor_gate.test.ts` 关 3 五个新用例；`web/smoke.test.ts` 导航断言 6 → **7**。

**未做（有意）**：**不部署**（用户口径）→ 因此 `web/changelog.ts` 的 `ANNOUNCEMENTS` **不加条目**、`SITE_VERSION` **不动**（公告 = 版本真源，没上线就不该动）；`cache.ts` 会话持久化、`optimize_both` 联动搜索、评测集仍在待办。

### 落地记录 · 切片三（2026-09-29，评测集 + 跑批缓存）

**① 评测集（先把尺子立起来）**

| 文件 | 作用 |
|---|---|
| `web/advisor/evalCases.ts` | **用例目录唯一真源**：10 条覆盖 研究型 / 诊断型 / 检索型 / 边界型 / 抗幻觉型 / 预算型 / 降级型；每条写清 `expect`（该调哪些工具 / 方案数 / 应用可用性 / 必须提到的边界 / 禁止的幻觉词 / 裸报数检查 / 降级标记）。另有判分器 `judgeTurn` / `reportOf` / `scorecard` 与 `uncitedBigNumbers`（≥10000 且无 `[[证据]]` 才算裸报；种子与场次白名单） |
| `tests/advisor_eval.test.ts` | **离线确定性评测**（进 `npm test`）：6 条走完整 loop（守规矩的模型 → 全项通过）+ 2 条坏模型（不调工具就报数、伪造证据 → 系统确实拦住）+ 7 条判分器自检（含口径级用例：队友基线 / 口径歧义 / 控制型队友边界 / 预算谎报） |
| `scripts/advisor_eval.mts` | **真模型跑分**：`ADVISOR_KEY=sk-xxx npx tsx scripts/advisor_eval.mts` → 逐条跑真模型、出记分卡（`docs/顾问评测记分卡-<时间戳>.md` + `.json`）。`--dry` 只验管线（产物落临时目录）、`--only=` 挑用例、`--full` 用完整搜索参数；**key 只从环境变量读，不落盘** |

> **这层能证明什么、不能证明什么**（写在测试文件顶部，别自欺）：能证明判分器可用、结构保证成立（该调的工具调了、方案过三关、预算拦住、降级标出来）、坏模型会被抓住；**不能证明提示词的措辞质量**——那要靠真模型记分卡人看。

### 落地记录 · 切片四（2026-09-29，整体搜最优 + 界面口径）

**用户口径**："先 1（整体搜最优）；并且将工具调用等压缩成一行；尽量用中文回答，不要附带一堆英文命名。"

**① `optimize_both`：队友搜索 ↔ 战法搜索交替（工具数 11 → 12）**

一次调用回答「某将 + 配谁 + 带什么战法」：

```
第 1 轮：搜队友（L3）→ 取前 mateTop(默认 3) 套
         └ 每套清空匹配位战法 → 各搜一次战法（L2，coarseTop 收窄到 8）
第 2 轮：拿第 1 轮榜首（**带着战法**）再搜一轮队友（L3, slotSkills:'keep'）
         └ 新组合再用它的战法搜一次（L2）→ 结果并入榜单
收口：按 三将 + 战法套 去重 → 按核心将期望排序 → 返回可**直接应用**的 plan（关 1/2/3 照常过）
```
- 代价与护栏：`battlesOf` 用 `estimateMateBattles + mateTop × estimateSkillBattles`（+ 第 2 轮的队友与战法各一次）预估计费，超预算即拒绝并给调小建议；耗时约 30~120 秒，进度按阶段外抛（`第 1 轮 · 搜战法（2/3）`）；结果整体进缓存。
- 提示词同步改口径：**「完整最强配置」调它一次**；只定战法用 `optimize_skills`、只换队友用 `optimize_mates`，**不要把三个搜索都调一遍**。

**② 界面口径：工具调用压成一行 + 中文**

| 改动 | 内容 |
|---|---|
| 新模块 `web/advisor/trace.ts` | `TOOL_ZH`（工具→中文名：读配置 / 校验方案 / 试跑 / 批量对拍 / 搜战法 / 搜队友 / 整体搜最优 / 查武将 / 武将档案 / 查战法 / 战法清单 / 战法详情）+ `TraceLine`（一行轨迹，原地刷新）+ `evidenceZh`（`ev-2-simulate` →「试跑②」） |
| 抽屉（`view.ts`） | 日志只写模型的话；工具调用/进度全部收进顶部**一行**：`✔ 读配置 · ✔ 试跑 20 场`，长搜索显示 `⏳ 整体搜最优 3,200/8,062（40%）`；方案卡上的证据改用中文短标（不再出现 `ev-…`）；设置项改中文（接口地址 / 模型 / 密钥 / 调用次数上限 / 场次上限 / 词元上限）；成本行「token」→「词元」 |
| 实验页（`advisorLab.ts`） | 同一套一行轨迹（`TraceLine` 复用），去掉轮次分隔与逐步行 |

**真机验收**（无头 Chromium 跑本地主站）：轨迹 `✔ 读配置 · ✔ 试跑 20 场`（**单行**）、成本行 `本轮：2 次工具调用 · 20 场 · 词元 0`、方案卡显示「搜索口径（来自「**试跑②**」，20 场）」、设置项标签 `接口地址|模型|密钥|干跑（不联网）|调用次数上限|场次上限|词元上限`、日志不再含 `▶`；`pageerror = 0`、console 报错 0。

**测试**：顾问测试 106 → **109**（新增 `optimize_both` 三个：交替顺序与收窄参数 / 预算拒绝 / **真接线**极小范围真跑一轮；工具数 12；抽屉冒烟改为断言一行轨迹与中文短标）；全量 **229 files / 2461 tests 全绿**；`tsc` 两份 clean。

### 落地记录 · 切片五（2026-09-29，搜索前的「报价 + 确认」）

**用户口径**：长搜索开跑前先报账，**点确认才跑**（不是只显示）。

| 改动 | 内容 |
|---|---|
| 协议（`types.ts`） | `SearchQuote { tool, battles, estMs, label }` + `ConfirmFn`；`DEFAULT_CONFIRM_BATTLES = 2000`（≈12 秒，低于它不打扰用户）、`MS_PER_BATTLE = 6`（实测 L2 默认 8,062 场 / 57 秒 ≈ 7ms，取 6 略保守） |
| 工具层（`tools.ts` 的 `runTool`） | 预算护栏之后、真跑之前插一道门：`battles ≥ confirmFrom` 且 `ctx.confirm` 存在 → `await ctx.confirm(报价)`；**拒绝则额度原路退回**（`budget.battles/calls` 各减回）并抛错，错文写死"不要重试同样规模"：改用 `candidateSkillIds`/`candidateHeroIds`/更小 `finalRuns`，或只用已有结果作答 |
| 界面（抽屉 + 实验页） | 报价条：`即将执行 —— 搜战法：预计 8,062 场 / 约 48 秒　[开始] [不跑]`；等待期间一行轨迹显示 `⏳ 搜战法 · ⏳ 等你确认`；**取消（中断）按「不跑」处理**，不会挂住。设置里可关（「长搜索先问我」）或改阈值（「超过 N 场先问」，默认 2000） |

**真机验收**（无头 Chromium，阈值改 1 场好让干跑那次 20 场也走确认）：报价文本 `即将执行 —— 试跑：预计 20 场 / 约 1 秒`；等待时轨迹 `✔ 读配置 · ⏳ 试跑 · ⏳ 等你确认`；点「开始」→ 方案卡出现、轨迹 `✔ 读配置 · ✔ 试跑 20 场`、成本行 `2 次工具调用 · 20 场`；`pageerror = 0`。

**测试**：顾问测试 109 → **114**（工具层三个：拒绝即不跑且额度退回 / 同意照常跑且报价正确 / 低于阈值不打扰、阈值可调；抽屉两个：报价条出现→点开始→出卡并应用、点不跑→轨迹标 ✘「用户拒绝」且场次为 0）；全量 **229 files / 2466 tests 全绿**。

**② 跑批缓存（`web/advisor/cache.ts`，实施计划 Task 7 的核心）**

- 键 = `(工具, 方案, 参数, 种子)`，稳定序列化（**对象键序无关**、数组序有关）+ FNV 短哈希；
- **命中即 0 场计费**：`cost.battlesOf` 先 `cache.has()`（不计命中数，避免与 `get` 重复计数）→ 命中返回 0 场；
- **命中时重新分配 evidenceId**：证据编号是本轮的，复用旧编号会让关 2 溯源指到不存在的 trace；
- 结果保留 `summary / brief / data`（关 2 的数字核对仍能过），`stats.cached = true`，界面上显示「✔（缓存命中，本轮没再跑）」；
- `createLocalCache()` 落 localStorage（刷新页面仍在，超限按最久未写入淘汰，存不进时自动降级内存）；抽屉与实验页都已接上；**参数或方案一变必然重跑**（测试锁定）。

**验证**：顾问测试 82 → **106**（评测 15 + 缓存 9）；全量见提交说明；`tsc` 两份 clean。

### 落地记录 · 切片一补丁 2（2026-09-29，文鸯那次实跑）

**用户实测**："文鸯的如何搭配队伍和战法输出最大化？" —— 研究流程走通了（`get_config` → `search_hero` → `hero_detail` → `list_skills` → `skill_detail` → 组方案 → `validate_plan` → `simulate`），但暴露两个真问题：

1. **`simulate` 崩溃**：`Cannot read properties of undefined (reading 'filter')`。根因 = 模型给的槽位缺 `skillIds`，`normalizePlan` 直接 `.filter` 炸掉；而且报错文本对模型毫无价值 → 它盲试了 **4 次同样的错**才改对。
2. **40 次调用依然不够**：28 次花在逐个查战法，剩下 12 次**一套一套手搓对拍**（9 次单独的 `simulate`）→ 最后撞上 `已达本轮预算（calls）`。

**本补丁**

| 改动 | 内容 |
|---|---|
| 崩溃修复 + 报错可用 | `normalizePlan` 全字段容错（缺 `skillIds` / `level` / `coreUnitIds` 一律按空或默认处理，**不在深处抛异常**）；`assertPlanShape` 改成**逐字段点名报错**（"plan.slots[1].skillIds 必须是字符串数组…"、"plan.slots[0].heroId 缺失：不确定就先 search_hero"）——让模型一次改对 |
| 新工具 `simulate_many` | **一次对拍最多 8 套**方案并按核心将期望排序，返回对比表 + 每套的每将贡献 + **"第 1 与第 2 差多少、半宽之和多少、是否分得出来"**；预算按 `套数 × 场次` 计费（9 次调用压成 1 次） |
| 提示词 | 工具清单 8 → 9；写明"要比较多个搭配用 `simulate_many`，**不要一套一套地调 simulate**" |
| 下架武将告警 | `hero_detail` 返回 `listed` 与 **`offlineReason`**，并在 summary/brief 里写明「⚠️ 该武将**已下架**：<原因>——模拟数值会系统性偏低，只能看方向」。触发原因：用户问的文鸯 `h704` 正是下架武将（主战法「盛气横凌」已实现、受属性缩放的成长率未确认），模型此前不知道这件事，会把偏低的数当结论 |

**验证**：顾问测试 59 → **63**（缺字段不崩 / 字段错点名报错 / simulate_many 排序与计费 / 下架告警）；`tsc` 两份 clean；全量 `npm test` **224 files / 2409 tests 全绿**（下架告警那次 +1 后为 2410，见提交说明）。

### 落地记录 · 切片一补丁 3（2026-09-29，用户指出设计偏差之后）

**用户原话**："AI 应该是调用已有的 L2/L3，将他们当成工具来帮忙，为什么要 AI 自己来一个个战法看？"
—— 这条批评是对的，而且指出的是**设计偏差不是实现 bug**：一期只做"快工具"是我的范围决定，代价就是模型退化成"人肉搜索器"（28 次调用逐个查战法 + 9 次手搓对拍）。

**本补丁：把 L2/L3 提为一等工具**

| 改动 | 内容 |
|---|---|
| 新工具 `optimize_skills` | 包 `runSimExpectationAsync`（L2 三阶段：逐槽粗筛 → 组合粗筛 → 决赛 ≥20 场 + 自适应加跑）；参数 `plan / coarseRuns / finalRuns / coarseTop / candidateSkillIds / matchSlotKeys / topN`；返回带区间的排序榜单 + 「第 1 与第 2 差多少、半宽之和多少、分不分得出来」+ 每将贡献 |
| 新工具 `optimize_mates` | 包 `runSimMateAsync`（L3）；额外给**与当前队友的对照基线**（榜首比基线高多少）+ 候选池剔除情况 + "防御/控制型队友价值量不出来"的边界声明 |
| 预算按**真实预估**计费 | `cost.battlesOf` 改为 `(args, ctx)`，用 `estimateBattles` / `estimateMateBattles` 预判；上限抬到 **200,000 场 / 900 秒**（一次 L2 默认约 8,000 场 / 60 秒，跑得起） |
| 超限报错可执行 | 预算拒绝时回灌：`（本次 optimize_skills 预计 8062 场；本轮已用 X/200000 场、Y/40 次调用）——可调小 finalRuns / coarseRuns，或用 candidateSkillIds 缩小范围…` |
| 长任务可观测 | `ToolCtx.signal` + `onProgress`：搜索期间界面原地刷 `⏳ optimize_skills：真跑 4000/8062 场（50%）`，**取消按钮真的能中断**（进度回调里检查 abort） |
| 提示词改向 | "凡'最强 / 输出最大化'**首选 optimize_skills / optimize_mates**；不要用逐个 skill_detail + 手搓几套 simulate 代替搜索——那是撞运气" |
| 界面 | 新增「单轮场次上限」输入框（默认 200000），与调用/token 上限并列 |

**验证**：顾问测试 63 → **68**（假搜索注入验榜单/预算/进度 3 个 + 预算拒绝带账 1 个 + 计费口径 1 个 + **真接线小范围 L2 搜索 1 个** + 工具数 11）；`tsc` 两份 clean；全量 `npm test` **224 files / 2415 tests 全绿**；无头浏览器复跑界面（三个上限输入框 + 进度行）正常、`pageerror = 0`。

## 14. 记忆层（会话持久化 + 「你的偏好」档案）

**用户需求（2026-09-29）**：补齐两块记忆 —— ① 对话内容与证据清单落盘，刷新页面能续上而不是丢上下文；② 为每一位用户维护一份偏好档案，**每一轮自动带进上下文**。
**要求先看 DSH 记忆插件怎么做的**（存储位置 / 落盘时机 / 偏好如何写入 / 如何注入），再据此落地。

### 14.1 参考实现（harness）：`@vectorize-io/hindsight-coding-agents` v0.7.0

读的是本机 profile 里装的那份：`~/.dsh/profiles/web/node_modules/@vectorize-io/hindsight-coding-agents/`，DSH 侧入口 `dist/dsh.js`（`cordis.patch.yml` 把它作为一行 `hindsight` 挂到 **host plane**，所以 pre-step / session-start / turn-stopping 与工具注册对每个会话都生效）。

| 问题 | harness 的做法（源码位置） |
|---|---|
| **存储位置** | 记忆正文 → 远端 Hindsight 服务端的 **bank**（`bankId` 按工作区 cwd 推导，配置在 `~/.hindsight/coding-agent.json`，`HINDSIGHT_CONFIG` 可改）。本地只放三类状态：`~/.hindsight/coding-agents-logs/{diag,usage}.jsonl`、**每会话注入复用缓存** `<tmp>/hindsight-<harness>/<sessionId>.json`（`{turns, reflectAnswer, reflectAttempts, pages}`，`tmp` 写入 + `rename` 原子替换）、以及 retain 游标 `{bank, turns, fingerprint(sha1), pending 发件箱, dirty}`（`src/core/retain-cursor.ts`：`planRetain` 决定 skip / replace / append） |
| **落盘时机** | 四个钩子（`dist/dsh.js` 的 `apply()`）：`agent/session-start`（冷库才播种）→ `agent/pre-step`（**每轮**：`onPrompt` 算注入 + 写会话缓存 + 追加注入消息）→ **`agent/turn-stopping` = `onSessionIdle()`：重新从宿主抓完整转录**（`fetchTranscript`，因为 `messages.transform` 那种时机拿到的转录**不含刚生成的回答**）→ 与 `st.retainedTurns` 比对，只在变长时写，`retain()` fire-and-forget、**永不抛进宿主**。刻意**不做客户端攒批**：注释原话「nothing is ever held somewhere it can be lost」——重复提交交给服务端 fold（同一文档的多次 retain 合成一次抽取） |
| **偏好如何写入** | **没有独立的偏好表**：写进去的是**转录本身**，外加一份 bank manifest（`retain_mission` / `retain_extraction_mode` / `retain_custom_instructions` / `retain_chunk_size`）告诉抽取器「该抽什么」；抽取在服务端做。另有两条显式通道：`hindsight_ingest_document`（外部文档 / 更正）与 `hindsight_capture_initiative`（计划页），并带 `retainTags` / `retainMetadata` 作用域标记 |
| **如何注入** | `onPrompt` 合成一个文本块（**仅第 1 轮**带知识页名册；每轮带本轮 reflect / recall 结果，答案缓存在会话缓存里不重算）；`getInjection(sessionId)` 取回，DSH 适配器把它作为**追加的一条 user 消息**塞进 `decision.messages`（`source.kind='plugin:hindsight'`）。由于它进了会话本身，回读转录时用 `stripInjectedMemory`（标签正则 `<hindsight_memory>…</hindsight_memory>`）剥掉 → **防"注入内容被当成用户说过的话"再写回记忆**（自我污染） |

### 14.2 本项目的落法（无后端 → 两把 localStorage 键）

| 维度 | 落地 | 对应 harness |
|---|---|---|
| 存储位置 | `dsh-advisor-session-v1`（对话 + 证据清单 + 方案卡三关结论）/ `dsh-advisor-profile-v1`（偏好档案），与既有 `dsh-advisor-settings-v1` / `dsh-advisor-cache-v1` 同一套命名。**证据只存 `evidenceId / name / args / summary / brief / stats`，不存 `data`**（几千行跑批明细另有 `cache.ts` 按同一 planKey 持久化，抽屉也不读它）；写失败（配额满 / 隐私模式）→ 该键退到进程内内存（`createDefaultStore`，**只有写失败过的键**才从内存读，避免 `localStorage.clear()` 后旧值复活） | 远端 bank + 本地会话缓存 + 游标 → 简化为两把键（没有服务端可放正文） |
| 落盘时机 | **轮末一次写**：`runAdvisorTurn` 返回 → `toStoredTurn` → `appendTurn`（按 `turn.id` **幂等**，= `retainedTurns` 游标）→ `saveSession`（先按 1.5MB 裁剪再**一次** `JSON.stringify` + 一次 `set`）。超 30 轮丢最旧的并计数（`session.dropped`）。中途取消 / 失败：`loop.ts` 新回调 `onToolRecord` 逐个收已完成的证据 → `flush()` 落成 `partial` 轮（正文只到断点、证据只到跑完的那几个，**不编不补**）；`pagehide` / `visibilitychange` 再兜一次 | `turn-stopping` 抓完整转录 + 游标比对 + fire-and-forget；"不攒批、不丢" |
| 偏好写入 | 轮末一次**非流式小请求**（`transport.once()`，temperature 0，不带 tools；提示词见 `prefs.ts` 的 `EXTRACT_SYSTEM_PROMPT`，就是 harness 的 `retain_mission` 那件事）：从「本轮用户 + 本轮回答 + 现有档案」抽出 `{"add":[{key,value}],"remove":[旧取值]}`；合并规则 = **同「标签 + 取值」→ `seen`+1**（重复出现算一种置信度），新取值新增一条，超 24 条淘汰最久未确认的。**旁路**：没 key / 关开关 / 传输层不支持 `once` / 请求失败 → 一律当"这轮没得记"，绝不影响对话 | bank manifest 的抽取口径 + 服务端抽取 |
| 注入 | `renderProfileBlock()` 产出 `<advisor_prefs>…</advisor_prefs>`（空档案返回 `''`，**不注入空块**；条目 / 字数双上限），由 `loop.ts` 作为 **system 块**摆在 `SYSTEM_PROMPT → budgetHint → 档案 → history → 本轮提问`；`historyFrom()` 的紧凑转录（用户原话 + 顾问结论 + 上一轮证据一行行）回灌，**回灌前 `stripInjected()` 剥掉所有本层标签块**（harness 的 `stripInjectedMemory` 同款） | `<hindsight_memory>` + pre-step 追加消息 + 回读剥离 |

**明确不做**（与一期口径一致）：远端 bank / 跨设备同步（`docs/…` §10「明确不做」）、多用户档案切换（"每一位用户"= 每台浏览器的这一位；键就是本机键）、把偏好写回服务端。

### 14.3 改动清单

| 文件 | 内容 |
|---|---|
| `web/advisor/memory.ts`（新） | 会话 / 档案的类型 + 纯函数：`parseSession`（坏 JSON / 版本不符 → null）、`appendTurn`（幂等 + 上限）、`updateTurn`（回填 note）、`pruneToBytes`、`saveSession`/`loadSession`、`historyFrom`（紧凑转录 + 字数上限）、`stripInjected`、`mergePreferences` / `removePreference` / `normalizePref`、`renderProfileBlock`、`createDefaultStore`（写失败退内存）、`stampText` |
| `web/advisor/prefs.ts`（新） | 抽取口径提示词、`buildExtractInput`、`parsePrefReply`（围栏 / 裸 JSON / 坏 JSON 全容错）、`createProfileExtractor`（走 `transport.once`，永不抛错） |
| `web/advisor/transport.ts` | `AdvisorTransport` 新增可选 `once()`（真传输 = `stream:false` 非流式）；假传输新增 `onceReply` 与 `requests` / `onceRequests` 记录（测试据此断言注入了什么） |
| `web/advisor/loop.ts` | `TurnInput` 新增 `profileText`（system 块注入）与 `onToolRecord`（中断时收证据）；**loop 仍然无状态**（历史与档案都由页面传进来） |
| `web/advisor/view.ts` | 挂载即 `renderAll()` 重放（正文 + 证据清单 + **最后一轮方案卡可继续点「应用」**）；轮末落盘 + 中断兜底；会话条（「继续上次会话：09-29 14:03 · 2 轮 · 刷新不丢」）+「新会话」（两下确认，**清对话不清档案**）；「你的偏好」面板（列表 / 手填 / 删除 / 清空 / 「每轮自动整理偏好」开关）；成本行显示 `档案 +N` |
| `web/advisor.css` | 会话条 / 偏好面板 / 证据清单样式（沿用主站 token，不动布局） |

### 14.4 测试与验收

- `tests/advisor_memory.test.ts`（新，纯函数 + 存储 + 抽取器，node 环境）：键名与往返（证据不带 `data`）、坏数据容错、**幂等**（同轮 id 两次仍 1 条）、轮数上限与 `dropped` 计数、体积裁剪、`partial` 兜底、紧凑转录与字数上限、`stripInjected` 剥两块标签、偏好合并（`seen`+1 / 同标签多值 / 淘汰最久未确认）、删除三种写法、注入块上限与空档案不注入、`parsePrefReply` 容错、抽取器「没有 once / 抛错 → 空结果」、存储降级（假 Storage 抛错仍可读写；无 localStorage 不崩）。
- `web/advisorSmoke.test.ts`（扩，jsdom 端到端）：① 轮末落盘（对话 + 两条证据 + `data` 不在）；② **重新挂载 = 刷新**后续上（正文 / 证据清单 / 方案卡与应用按钮仍可用）；② 第二轮请求里带上一轮对话与证据、且不含旧 `tool` 消息；④ 空档案不注入、手填后每轮以 system 块注入且**摆位在第 3 条**；③ 自动整理（一次 `once` → 档案 + 面板可见 + 写回本轮 `note`）与开关关闭后不再请求；② 中断兜底（半成品落盘、证据 2 条、日志有【失败】）；②「新会话」两下确认清对话留档案；档案面板删除 / 清空 / 写失败不崩。

### 14.5 验证记录（2026-09-29）

**测试**：`tests/advisor_memory.test.ts` **25 个**（新）+ `web/advisorSmoke.test.ts` 6 → **15 个**（+9）；全量 `npm test` **231 files / 2520 tests 全绿**；`npx tsc --noEmit` 与 `npx tsc --noEmit -p web/tsconfig.json` **两份 clean**。

**真机验证**（无头 Chromium 151 + CDP 直驱 vite dev server，1440×950，干跑模式；脚本 `%TEMP%/advisor-verify/drive.mjs`）：

| 步骤 | 实测 |
|---|---|
| 干净起点 | 两个键都为 null，会话条「新会话（还没聊过）」 |
| 一问落盘 | `dsh-advisor-session-v1` 有 1 轮；证据 `['ev-1-get_config','ev-2-simulate']`；**`evidence` 里没有 `data` 字段**；证据行 2 条；方案卡 1 张 |
| 手填偏好 | `dsh-advisor-profile-v1` 1 条（口径：只看核心将伤害期望）；面板 1 行；日志有【记忆】 |
| **刷新页面** | 提问与回答都在；证据行 2 条还原；方案卡还原且「应用」可点；会话条「继续上次会话：09-29 13:57 · 1 轮 · 刷新不丢」；档案仍在；**日志自动停在最新一屏** |
| 第二轮 | 会话 2 轮；两轮同框（`log` 同时含两个提问）；证据块 2 / 证据行 4（第二次「试跑」显示**用上次结果** = 跑批缓存命中） |
| 报错 | `pageerror` 与 console error 均为 **0** |

**真机抓到并修掉一个 bug**：`renderAll()` 在抽屉还是 `display:none` 时设 `log.scrollTop = log.scrollHeight`（那时 `scrollHeight` 是 0）→ 刷新恢复出来的历史停在**最旧一屏**。改为抽屉 `open()` 之后再滚到底（`scrollLogToEnd()`），并在真机断言 `scrollTop + clientHeight >= scrollHeight - 4`。

## 15. 识图建 box（2026-09-29）

**用户需求（2026-09-29 原话口径）**：
1. 用**用户当前接入的那个模型**（他的 ds flash，具备视图 / 识图能力）完成图片识别 —— **不换模型**；
2. 配将场景里支持上传截图：截图内容 = 他账号里**所有的五星武将 + 五星战法**；
3. 由 AI 识别这些截图，提取并汇总出这位用户 box 的完整范围（拥有哪些五星武将、拥有哪些战法）；
4. 后续配将**必须严格基于识别出的 box**：不得推荐用户没有的武将 / 战法；
5. **每个用户的 box 都不同** → 识别结果按用户区分，并作为那位用户配将的**前提条件**。

**两条用户拍板（2026-09-29，勿再动摇）**：

| 分歧 | 用户选择 | 落法 |
|---|---|---|
| 「按用户区分」落到哪一层 | **多档案可切换** | 面板里有档案下拉 + 新建 / 改名 / 删除；box 跟着当前档案走（默认只有一份「我的号」，不改变现状）。`dsh-advisor-box-v1` = `{v,activeId,profiles[]}` |
| box 硬约束收窄到哪一层 | **只收窄 AI 顾问** | 每轮注入 + 工具候选池 + 方案校验门（关 1）；**主站配将区武将池照旧全库**（不动 `teamEditor`） |

### 15.1 分工：识别靠 AI、对齐靠代码（与既有截图识别同一条纪律）

`docs/截图识别-敌对队伍集.md` §四 的规矩原样搬到 box 上：

```
截图（多张）──► 视觉模型：只把「名字 + 卡面阵营/兵种」抄成固定 JSON
                            │（不猜：看不清的进 unrecognized）
                            ▼
              box.matchRecognition()：名字 → 库内 id 的**确定性对齐**
                ├ 归一化后同名唯一 ────────────► 收进 box
                ├ 同名多版 + 卡面阵营/兵种能消歧 ─► 收进 box（记一行 note）
                ├ 同名多版、分不出 ────────────► **待确认**（列候选，人来点）
                ├ 库里没有 ──────────────────► **待确认**（`unmatched` 留原始名字，不静默丢）
                └ 武将主战法 ─────────────────► 跳过 + 一行说明（随武将自带，不进可学槽）
                            ▼
              写入当前档案（并集 + 去重）→ 复核面板可删 / 可搜名字补 / 可清空
```

要点：
- **模型只报名字**：id、阵营、兵种一律以库为准（`web/data/heroes.json` / `SKILL_REGISTRY`），识别错一个名字不会把别人的将写进 box；
- **同名多版是常态**（吕布 汉·骑 / 群·弓、关羽 蜀 / 魏、曹操 魏 / …、SP / XP 前缀版）：`normalizeName` 折全角、去空白与书名号、统一大小写；`SP赵云` 与 `赵云` **是两个将**，只在精确命中失败时才做近似匹配（含前缀差异），且近似匹配也会把候选摆出来让人确认；
- **战法只收可学习战法**：`SKILL_REGISTRY` 里非主战法（`MAIN_SKILL_IDS`）的条目；「五星战法」按截图照录，品级从 `skill_grades.json` 查补 —— 只截 S 级就等于 box 里只有 S 级（**更保守，不会推出你没有的**）。

### 15.2 改动清单

| 文件 | 内容 |
|---|---|
| `web/advisor/box.ts`（新） | box 类型 + **多档案存储**（`dsh-advisor-box-v1`，容错读 / 至少留一份 / 上限 12 档）+ **`matchRecognition` 确定性对齐**（同名多版消歧、未命中进待确认、主战法跳过）+ `mergeRecognition`（并集去重 + `unmatched` 累积 + meta）+ `boxViewOf`（严格模式只读视图）+ **`renderBoxBlock`**（`<advisor_box>` 注入块，空 box 也注入一段**短文**：先要截图，别假设）+ `heroRows` / `skillRows` / `searchHeroCandidates` / `searchSkillCandidates`（复核面板用） |
| `web/advisor/vision.ts`（新） | 识图那一步：**图片压缩**（长边 1600 / JPEG 0.85，没 canvas / 解码超时 → 退回原图，绝不丢图；>8MB / 非图片明确拒绝）+ 读图系统提示词（固定 JSON schema + 7 条"别猜"规矩）+ **容错解析**（围栏 / 裸 JSON / 夹在说明里；认不出 → 抛 format 错带原文，绝不当成"识别到 0 个"）+ `recognizeBox()`（分批 ≤6 张/请求、进度回调、多批合并去重）+ 干跑示例 `SAMPLE_BOX_REPLY` |
| `web/advisor/transport.ts` | 消息支持**多模态**（`AdvisorMessage.images` → OpenAI 兼容 `image_url` 段，data URL 直传）；非 2xx 把**服务端原文**带进错误（模型不支持图片时能看懂该换什么），"像是图片/多模态的问题"归类为 `format` |
| `web/advisor/tools.ts` | `ToolCtx.box`；`search_hero` / `search_skill` / `list_skills` **不受 box 限制**（只给 `✓你有` / `✗你没有` 标注 —— 用户 2026-09-29 修正）；`optimize_skills` / `optimize_mates` / `optimize_both` **候选池收窄**（配将类搜索；模型自己给的候选与 box 求交，交集为空 → 明确报错而不是空跑几千场）；新工具 **`get_my_box`**；`simulate` / `simulate_many` 的输出补上两个比较主数字（**八回合全队总伤 meanTotal** / **前三回合爆发 meanFirst3**） |
| `web/advisor/gate.ts` | 关 1 新增 `hero_not_in_box` / `skill_not_in_box` → 进 **`boxIssues`（不是 `errors`）**：方案**仍算合法**（照常看数），只是禁用「应用」并给出原因；`checkPlan` 的 ctx 带上 box，`RecomputeResult` 带上 meanTotal / meanFirst3 |
| `web/advisor/loop.ts` | 硬规则第 7 条（**box 只是"给自己配将"时的范围**，其它问题照常回答；空清单只在配将时先要截图）+ 工具清单加 `get_my_box`（12 → 13 个）+ **比较类问题的标准做法**（同一套只换一处 → simulate_many，报八回合总伤与前三回合爆发）+ `TurnInput.boxText` 注入，摆位 **SYSTEM_PROMPT → budgetHint → box → prefs → history → 本轮提问** |
| `web/advisor/memory.ts` | `BOX_TAG='advisor_box'` 并纳入 `stripInjected`（防注入块被当成"用户说过的话"回灌） |
| `web/advisor/view.ts` + `advisor.css` | 抽屉新增「我的 box（识图）」面板：档案下拉 + 新建 / 改名 / 删除、严格模式开关、**选图 / 拖拽 / Ctrl+V 粘贴**（多张、缩略图可删）、开始识别（进度 + 耗时）、**复核表**（武将 / 战法两栏：库内暂时用不了的标黄、可删、可搜名字补）、待确认区（点候选定下来 / 跳过）、清空（两下确认）；`send()` 注入 `boxText` 并把 box 塞进 `ctx` |

### 15.3 box 约束的边界（**2026-09-29 晚按用户口径修正，以此为准**）

> 用户原话：「添加 box 配将只是其中之一，并不是只能从里面配将，**在用户明说帮"我"配将时才需要限定范围**。正常情况下，按用户的问题去找答案就好，比较哪个战法好直接比较携带两战法时打桩数据，给出八回合总伤和前三回合爆发分别是多少。」

| 场景 | 约束 |
|---|---|
| **"帮我的号配将 / 出方案 / 我该带什么"** | 用 box 限定：配将类搜索（`optimize_*`）的候选池 = box ∩ 能进模拟；提示词要求方案里只用清单内的将法；清单为空 → 先请他上传截图识别一次 |
| **其它一切问题**（"A 和 B 哪个好" / 某将什么机制 / 这队为什么低 / 帮我算一算） | **不受 box 限制**：`search_*` / `list_skills` / `hero_detail` / `skill_detail` / `simulate` / `simulate_many` 全量可用；模型**不许**因为 box 是空的就拒绝回答、也不许反过来要求先传截图 |
| 方案里出现了 box 外的将法 | **合法**（`legal=true`，照常复算、照常看数）→ 进 `PlanCheck.boxIssues`，卡片上一行金色提醒「含你 box 外的将法 N 处」，**「应用」禁用**（"能看能算，不能一键用"）；**不写成"不合法"** |
| 关掉「严格按我的 box」 | 连 `boxIssues` 都不产生（清单只作事实注入） |

落地：
1. **注入**（每轮、system 块）：清单 + 「**当他明确要你给他自己配将时**才必须只用清单里的；比较 / 测算 / 查资料不受限」+ 严格模式状态；清单过长截断并提示 `get_my_box`；空 box 也注入一小段（只在配将时先要截图）。
2. **工具**：检索类**只标注不拦**（`✓你有` / `✗你没有`）；配将类搜索（`optimize_*`）候选池收窄到 box。
3. **校验门**：box 外 ⇒ `boxIssues`（**不是错误**）⇒ 只禁「应用」。
4. **比较类问题的口径**（用户明确要的两个数）：同一套阵容只换那一处 → `simulate_many` 对拍 → 报 **八回合全队总伤 `meanTotal`** 与 **前三回合爆发 `meanFirst3`**（+ 核心将期望 ± 半宽 + 差值）；区间重叠就说"分不出来"。这两个数已进 `simulate` / `simulate_many` 的 summary/brief **与方案卡**（`RecomputeResult.meanTotal / meanFirst3`）。

### 15.4 明确不做 / 未覆盖

- **只识别"有没有"**：红度 / 等级 / 宝物不进 box（截图里字太小，错一格就把兵力算错；红度仍由配将区现状决定，`ConfigSlot` 里本来就有）。
- 不识别二级兵种 / 兵系特性（与 `docs/截图识别-敌对队伍集.md` §一 同一口径）。
- 不做模板匹配 / OCR 图标识别：识别质量依赖模型看图能力 —— 所以**复核面板是必读的一步**，识别错了当场改。
- 截图**不落盘、不上传第三方**：只在本机压成 data URL 直发用户自己配置的模型端点，识别完即丢（`localStorage` 只存 id 清单 + 张数 / 模型名）。
- 不做自动识别触发（不会在背后偷偷读图）、不做跨设备同步（与 §14 一致：本机键）。
- **不写公告**：与顾问本体一致（仅本地不部署，`web/changelog.ts` 不动）。

### 15.5 测试与验收

- `tests/advisor_box.test.ts`（新，18 个）：多档案（默认一份 / 新建切换改名删除 / 删到只剩一份自动重置 / 两档互不影响）、容错读（坏 JSON / 结构不对 / 条目去重）、增删去重、**对齐**（唯一名 / 同名多版 → ambiguous + 阵营兵种消歧 / 近似名带 note / 未命中 unknown / 空名）、**战法**（可学习唯一命中 / 主战法跳过 / 未命中）、`matchRecognition` 分流与去重、`mergeRecognition` 并集 + `unmatched`、`boxViewOf`（空 box 不算严格）、`renderBoxBlock`（空态 / 计数与 id / 严格开关 / 超长截断提示 `get_my_box`）、`stripInjected` 剥 box 块、`heroRows` / `skillRows` 的"库内暂时用不了"标注、候选检索排除主战法、`normalizeName` 归一。
- `tests/advisor_vision.test.ts`（新，12 个）：围栏 / 裸 JSON / 夹在说明里都能认、字符串数组也认、**不是 JSON → format 错**（不当成 0 个）、脏字段清洗、多批合并补字段、图片压缩退让路径（jsdom 无 canvas → 原图）、非图片 / 超大图拒绝、单批与多批识图（带 `image_url` 段与进度）、没有 `once()` → 退回 `chat()`、空图 / 超量拒绝、干跑示例可解析。
- `tests/advisor_tools.test.ts`（44 个，+10）：**检索不受 box 限制**（全库都回、只标 `✓你有` / `✗你没有`；关掉严格模式连标注都没有）、`optimize_skills` / `optimize_mates` 候选池收窄（预估与真跑同一份 options）、模型给的候选全在 box 外 → 明确报错、`get_my_box`（空 / 有内容 / 严格状态）、`validate_plan` 的 `hero_not_in_box` / `skill_not_in_box` **进 boxIssues 且 ok 仍为 true**、真正的非法仍进 errors、空 box 不拦。
- `tests/advisor_gate.test.ts`（17 个，+4）与 `tests/advisor_loop.test.ts`（15 个，+4）：box 外的将法「**合法但不可应用**」+ `boxIssues` 机器码 + 复算照跑、复算带 `meanTotal` / `meanFirst3`、摆位断言（box 在预算之后、偏好之前）、系统提示词第 7 条（"box 只是给自己配将时的范围" + 比较类口径）与 13 个工具。
- `web/advisorSmoke.test.ts`（20 个，+5）：端到端 jsdom —— ① 上传截图 → 识别 → 按档案落盘（识别请求确实带 data URL）；② 下一轮注入 box 块（写清"只在给他配将时限定"）+ 方案里有 box 外的将 → 卡上「含你 box 外的将法」+ **不写"不合法"** + 应用禁用 + 给出八回合总伤 / 前三回合爆发；③ 三将都在 box → 应用可点，关掉严格模式 → 块变「关」；④ 多档案（新建 = 空白并提示先要截图，切回原档清单与注入都回来）；⑤ 复核（删一条 / 按 id 手动补回 / 非图片文件明确报错 / 清空两下确认）。
- `web/settings.test.ts`（+2）：设置弹窗里「干跑」开关**真的能拨**（原来没绑事件）、填上 key 后自动切回真模型（用户显式拨过就尊重他的选择）。
- **回归**：既有断言按新口径更新（系统块 2 → 3 条、偏好块摆位 2 → 3、box 相关断言改为"标注 / 不可应用"）。

### 15.6 验证记录（2026-09-29）

**测试**：新增 `tests/advisor_box.test.ts`（18）+ `tests/advisor_vision.test.ts`（12）；扩 `tests/advisor_tools.test.ts` 34 → **44**、`tests/advisor_gate.test.ts` 13 → **16**、`tests/advisor_loop.test.ts` 11 → **15**、`web/advisorSmoke.test.ts` 15 → **20**。
全量 `npm test` = **233 files / 2571 tests 全绿**；`npx tsc --noEmit` 与 `npx tsc --noEmit -p web/tsconfig.json` **两份 clean**；`golden.json` 不受影响（引擎未动）。

**真机验证**（无头 Chrome + CDP 直驱 vite dev server，1500×1000；脚本 **`scripts/_advisor_box_shot.mjs`**：自带 OpenAI 兼容 mock 端点 + 页面内合成"截图"，一条命令跑完两条链路并留图）：

| 步骤 | 实测 |
|---|---|
| ① 空 box 面板 | 摘要「武将 0 · 战法 0」；档案下拉「我的号（空）」；严格模式默认勾选；拖拽/粘贴提示、开始识别、两栏复核表都在（图 1） |
| ② 干跑识别 | 页面内合成 2600×1800 截图 → 选图 → 识别：落盘 `dsh-advisor-box-v1` = `heroIds:["h23","h16","h479"]`（曹操/刘备/吕布）+ `skillIds:["dashang_sanjun","hunshui_moyu"]`；面板「识别完成：武将 +3 / 战法 +2；1 条要你确认」；**待确认**区列出「不存在的将」（库里没有）+ **还没对上**留住原始名字；日志有【识图】模型说看不清这几处（图 2） |
| ③ **约束生效（修正后口径）** | 发一问 → 干跑脚本给的三将方案（XP关兴＆张苞 / 颜良＆文丑 / SP赵云）全不在 box 里 → 方案卡给「标准口径复算 14,024 ±1,590」+「**八回合全队总伤 35,951｜前三回合爆发 4,787**」（用户要的两个数）+ 金色一行「含你 box 外的将法 3 处：`hero_not_in_box`…能看到、能测算，但不能应用到你的配将区」+ **「应用到配将区」按钮禁用**；**通篇没有"不合法"**（图 3） |
| ④ **真传输识图** | 设置弹窗指向 mock 端点（model `ds-flash-mock`）→ 清空 box → 再识别：mock 收到 `POST /v1/chat/completions`，`stream:false`、`tools:0`、**1 个 `image_url` 段**、`data:image/jpeg;base64,…`（2600×1800 PNG 原图 → **压缩到 58KB**）、带读图系统提示词；面板落盘 3 将 / 1 法 + 2 条待确认（图 4） |
| ⑤ 报错 | `pageerror` 与 `console.error` 均为 **0** |

**真机抓到并修掉四个问题（都不是单测能发现的）**：
1. **抽屉正文被裁**（旧抽屉形态）：面板多了一个之后总高度超过一屏，而 `.advisor-body` 是 `overflow: hidden` → **方案卡与「应用」按钮被裁到够不着**。改为正文可滚 + 输入行钉底，`.advisor-plans` 去掉 `max-height:45%`（在可滚父容器里会被压成 0 高度）。自检脚本加了「方案卡必须完整可见」的断言。
2. **严格模式开关没生效**（旧抽屉形态）：勾选框的 `change` 只写了 localStorage，`send()` 读的是挂载时那份闭包 → 关掉也照拦。改为 `change` 时刷新闭包 + `send()` 用刚读到的值。
3. **设置弹窗里的「干跑」开关是死的**（2026-09-29 晚页面改版后）：`#set-fake` 没有任何事件绑定 → 用户填了 key 也永远走干跑、真模型一次都调不到。修：绑定 `change → setDryRun`（**必须注册在 `read()` 之前** —— `read()` 会 `saveSettings` → 广播 → `paint()` 把勾选框刷回旧值，后注册读到的 `t.checked` 已经是旧值，先跑才发现这个坑）；另外「刚填上 key」时自动切回真模型（用户显式拨过干跑开关就尊重他的选择）。
4. **口径本身错了**（用户指出）：见 §15.3 —— box 只在"给我配将"时限定范围，检索 / 测算 / 比较一律不受限；box 外的将法**不算不合法**，只是不能一键应用；比较类问题要直接给八回合总伤与前三回合爆发。

**页面形态变更说明**：2026-09-29 晚顾问从"主站内嵌抽屉"改成**独立页 `advisor.html`**（左栏 + 主区 + 面板 sheet，设置收进共用弹窗 `web/settings.ts`），布局口径见 `docs/AI配将-页面布局设计.md`；本文 §15 只管 box 那部分，自检脚本已改为直驱 `advisor.html` + 走设置弹窗切换模型。

