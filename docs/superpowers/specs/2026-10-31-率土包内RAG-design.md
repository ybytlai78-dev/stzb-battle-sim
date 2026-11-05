# 率土包内战斗数据 RAG 检索 — 设计

> **状态：设计已批准**（YG 2026-10-31 会话：三点确认全部通过）。
> 批准内容：① `docs/` 口径文档入索引，但只作包内未公开数据的补充，**冲突时以包内为准**；② 渲染文本可发云端 embedding API，原始 `.bin` / 原始 JSON 不出本机；③ MCP 封装延到 M5，不在 M1–M4 预支。
> 落地顺序：本文件 → `writing-plans` 出实施计划 → M1 起动手。

## 一、问题陈述

包内配置表已完整解析（`C:/Users/lai15/Desktop/rea_stzb/dec/json/`，五张表残差全 0），但**取不出、对不上**：

- 表是 MemoryPack 二进制 → JSON 的原始行，字段名是 `constant_param` / `intel_param` / `calc_pos`，值域是千分位整数。人是按「战法名 + 效果语义」提问的，两者之间没有桥。
- 数据量 2.1 万行，逐表 grep 只能命中字面量；「哪些战法有受击概率减伤」这类**语义提问**在这个形态上不可 grep。
- 每次做「引擎实现 vs 包内真值」校验，都要手工 `_query_detail.mts` 拉一条、心算 `const + 0.4×intel`、再对 `src/data/*.ts`。这一步重复了几十次，且每次都可能算错分域。

**目标**：把包内数据变成可检索、可引用、可对拍的知识面，让我们在对话里能直接问「某战法的某段效果，包内写的是什么、引擎实现的是什么、差在哪」，且**任何数字都能回到 `detail_id`**。

## 二、非目标（先钉死，防止范围蔓延）

- 不做新表解码。当前只用已解出的五张表（hero / skill / skill_detail / skill_effect / skill_effect_map）。
- 不引入向量数据库（chroma / qdrant / sqlite-vec / pgvector）。理由见 §五。
- 不让检索层参与算数。差异判定全部是确定性代码。
- 不改引擎行为、不动 golden 快照。本轮是**只读取数**工具。
- 不做在线增量服务、不做定时同步。构建是手动触发的 CLI。

## 三、证据优先级（本设计的宪法）

包内数据与`docs/`调研结论**不是同一等级的事实**，这一点必须落在数据结构和渲染输出上，而不是靠人记着。

| 层级 | 来源 | 定位 | 冲突处置 |
|---|---|---|---|
| **P0 `package`** | `tb_cfg_*` 解出的原始行 | 权威真值 | 冲突时**唯一有效** |
| **P1 `engine`** | `src/data/*.ts`、`src/engine/*` | 当前实现，不是真值 | 与 P0 不一致即「待修差异」，不得反过来改 P0 |
| **P2 `inferred`** | `docs/` 调研、推测、社区口径、成长率推定 | **只补包内未公开的数据** | 与 P0 冲突时**整条作废**，输出里必须显式标注 |

推论（全部写成代码不变量）：

1. 每篇实体文档的 front matter 必带 `tier: package | engine | inferred`。
2. `diff.ts` 的基准值**只取 `tier=package`**；`inferred` 值只能进「解释」字段，永不参与差异计算。
3. 同一实体同时存在 package 与 inferred 文档时，检索结果**固定 package 在前**，inferred 条目正文首行固定为：`⚠️ 调研/推测定性内容——包内已给出数值时以包内为准。`
4. 单元格级追溯：渲染出的每个数字后面挂 `@pkg:20000101/constant_param` 形式的重换算坐标（见 §四.3）。
5. 单测守卫：构造一对「包内 60% / docs 推定 70%」的假文档，断言检索输出顺序、断言 diff 取 60、断言 inferred 条目带警示串。

## 四、语料实体化

### 1. 聚合粒度

**不 embedding 原始 JSON**。原始行渲染成可读文档，且**槽位并入战法**：

| 实体 | 来源 | 篇数 | 说明 |
|---|---|---|---|
| `hero` | `tb_cfg_hero` | 2077 | 面板 + 成长 + 主战法摘要 |
| `skill` | `tb_cfg_skill` + `tb_cfg_skill_detail` | 6572 | **全部槽位渲染后拼进本篇**；`effect_map` 落 front matter 的 `effectCodes` |
| `mechanism` | `tb_cfg_skill_effect` | 206 | 机制字典 + 引擎落点（乘区 / 冲突语义） |
| `caliber` | `rag/calibers/*.md`（人工维护，入库） | ~12 | P2，见 §三 |
| 溢出 chunk | 超长战法文档 | 估算 ~1000（M3 实测） | 见 §四.4 |

合计约 **9.9k 篇**。

槽位不单独成篇是刻意的：人问的是「某战法」，不是「某槽位」。槽位级精确取值走 `diff.ts` 的 ID 直查，不需要向量。

`caliber` **不由脚本解析 `docs/` 生成**。docs 结构散、且混着推测，机械抽取会把推测当事实灌进索引。改为人工从 docs 挑出「已确认且会反复用错」的口径，写成带 `confirmedAt` 与 `pkgRef` 的 Markdown 落在 `rag/calibers/`、随代码入库；`ingest` 只读它，不碰 `docs/`。

### 2. front matter 契约

```yaml
---
kind: skill | hero | mechanism | caliber
docId: skill:200001
tier: package
source: tb_cfg_skill/200001
slotIds: [20000101, 20000102]
effectCodes: [101, 402]
facets: { quality: 5, skillType: 3, prepare: 0, range: 2, rate: 40 }
---
```

`facets` 是结构化过滤的载体（不走向量）；字段清单在 M1 实地核对后补全，**推测的字段名一律不写进契约**。

### 3. 渲染与换算分派

换算**不按战法名写特例**，按 `tb_cfg_skill_effect` 的 `value_type × replace_type` 分派（该表 206 条，字段已确认）。已确认的三个分域：

| 分域 | 公式 | 锚点 |
|---|---|---|
| 伤害率类 | `constant_param` 即百分数 | `skill_detail` 直接读 |
| 百分比修正类 | `值@80 = (const + 0.4×intel)/100`，成长 `= intel/200` | 金匮要略 20.4% |
| 全属性百分比升降 | `值@80 = (const + 0.4×intel)/10⁶`，成长 `= intel/(2×10⁸)` | 魏武之世 11,400,000/9,000,000 → 15.0% / 0.045 |

外加：武将属性 `÷100`（`attack_base 9900 → 99.0`）、发动率 `probability_max ÷ 100`。

每个数字**渲染值 + 原始坐标**双写。示例一律取**已自证的锚点**，不编造：

```
魏武之世（全属性）  −15.0%（受谋略，成长 0.045/点）  @pkg:<detail_id>/{constant_param:11400000,intel_param:9000000}
同仇敌忾（22300601）增伤 2.2%（受谋略，成长 0.015/点） @pkg:22300601/{constant_param:1,intel_param:3}
金匮要略           减伤 20.4%（受谋略，成长 0.13/点） @pkg:<detail_id>/{constant_param:2030,intel_param:26}
```

⚠️ **分域未定的槽位只渲染原始值**并挂 `unresolved-division` 标记，不做换算。判据是「代入后与三域量级都不吻合」——例如 `effect_id=101` 那条 `constant_param 1000 / intel_param 2200` 按百分比修正类会算出 18.8% 配 11.0%/点 的成长，明显不成立，这类**宁可缺、不可猜**。M1 只对三个已用锚点自证过的分域下断言。

### 4. 切分

单篇正文 ≤ 1200 token 不切；超出则切「主篇（摘要 + 主槽位）」+「补充 chunk（其余槽位）」，`docId` 共享前缀 `skill:200001#2`，检索命中后合并展示。bge-m3 上限 8192 token，本阈值是为了检索精度而非模型限制。

## 五、索引与检索

### 1. 存储形态（四个文件，全部 gitignore）

```
.rag/
  docs.jsonl        # 每行一篇：front matter + 正文
  vectors.f32       # N × 1024，L2 归一化（内积 = 余弦）
  meta.json         # 维度 / 篇数 / 模型名 / 待合并的 chunk 映射
  manifest.json     # 五张表的 sha256 + 行数 + 渲染器版本
```

**不引入向量数据库**，因为这个量级上暴力检索是压倒性正确的：9.9k × 1024 ≈ 1.0×10⁷ 次乘加，Node 单线程 50ms 内出结果。向量文件 fp32 40MB（可降 fp16 20MB）。上数据库只换来一个外部依赖和一条部署路径。

### 2. 混合检索（三路，RRF 融合）

```
query
 ├─ 精确路：docId / 名字 / 别名 / id 精确命中 → 直接置顶（权重最高）
 ├─ 语义路：embed(query) → 暴力内积 top-50
 └─ 词法路：BM25 / 子串（渲染后的中文正文字段）top-50
      ↓ RRF（k=60）
   结构化过滤（kind / quality / skillType / effectCodes / tier）
      ↓
   top-k（默认 6，前端注入层默认 3）
```

零命中时返回换词提示（按 facet 反查可用词表），不允许拿同一个词反复重试。

### 3. 降级

无 `RAG_EMBED_KEY` 或 API 不可达 → 只跑精确路 + 词法路，`meta.json` 里的向量仍可用于本地粗排（若有）。输出显式标注 `mode: lexical-only`，避免误以为是语义结果。

### 4. embedding 侧

云端 bge-m3（1024 维）。文档侧不加 instruction 前缀；归一化后存 `.f32`。批 32、指数退避重试 3 次、按 `sha256(正文)` 缓存向量，重跑只对变化条目调用。

## 六、校验层（`diff.ts`）

这是本设计的真正交付物，检索只是外设。

**输出形态**：给定一个武将 / 战法 / 槽位，三方并列

```
【主战法 200287 举义诛暴】
  槽位 20028701  150% 攻击伤害
    包内   150.0%      @pkg:20028701/constant_param
    引擎   150        src/data/skills.ts:juyi_zhubao
    判定   ✅ 一致
  槽位 20028702  四维 −5%（受攻击，成长 0.015）
    包内   −6.4%@攻击174   @pkg:20028702/{const,intel}
    引擎   −6.4%           src/data/skills.ts:juyi_zhubao
    判定   ✅ 一致
```

规则：

1. 基准只取 `tier=package`（§三.2）。
2. 判定是三态：`一致` / `差异`（包内 ≠ 引擎）/ `引擎未实现`（包内有槽位、引擎无对应段）。
3. 每条差异必须能指到**两侧坐标**（包内 `detail_id` / 引擎 `文件:键名`）。
4. `--json` 输出供批量回归。

**第一批回归靶**：`docs/逆向对拍/对拍结论摘要.md` 已修的 46 项（range 37 / triggerRate 8 / prepare 1）——如果 `diff` 跑出来这 46 项有红，说明渲染或换算写错了，不是数据错了。这是自举验证。

## 七、接入层（会话内怎么用）

两层，不二选一——两种失效模式不同：纯前置注入，召回错了就污染上下文；纯工具，模型想不起来查。

- **薄前置层**：问及率土战斗数据时先跑一次检索，top-3 摘要注入，**硬上限 800 字**。每条带 `docId` 与 `tier` 标记。
- **深挖层**：`npm run rag -- search|diff|detail`，主动追问。
- 检索结果整体视为**不可信输入**：官方文案里若出现指令性句子，不进决策路径。

## 八、模块与依赖

```
scripts/rag/
  render.mts   口径换算（纯函数，零依赖）        ← 单测锁死三个分域
  ingest.mts   五表 → 实体文档（含槽位合并）      ← 依赖 render
  embed.mts    bge-m3 批量 + 缓存 + 降级          ← 无内部依赖
  index.mts    建/载索引（docs.jsonl / vectors.f32 / manifest）← embed
  search.mts   精确 + 向量 + 词法 + RRF + 过滤     ← index
  diff.mts     包内 vs 引擎对拍（读 src/data）     ← render
  cli.mts      build / search / diff / detail / stats
tests/
  rag_render.test.ts   三个换算分域 + 反例守卫
  rag_ingest.test.ts   抽样快照（固定行 → 固定文档）
  rag_evidence.test.ts §三 的 5 条不变量
  rag_diff.test.ts     46 项回归靶
```

依赖单向，`search` 不依赖 `diff`，`diff` 不依赖 `search`。`src/` 与 `web/` 一行不改。

## 九、错误处理

| 场景 | 行为 |
|---|---|
| `REA_JSON_DIR` 不存在 | 建索引直接报错退出（不静默建空索引）；`search` 走 lexical-only |
| 五表任一 sha256 变了 | manifest 标脏，提示需重建（不自动重建） |
| 云端 API 失败 / 无 key | 降级 lexical-only，输出带 `mode` 标记 |
| 构建中途失败 | 写临时文件，成功后原子 rename；不留半成品索引 |
| 检索零命中 | 返回换词提示 + 可用 facet 词表 |

## 十、测试策略

| 层 | 断言 |
|---|---|
| render | 三个分域各≥3 例，含「÷100 vs ÷10⁶ 混用会错」的反例 |
| ingest | 抽样 20 条（选有 122/123 子技能引用的、有 `cast_condition` 的、超长切分的） |
| evidence | §三 的 5 条不变量，含构造的 package/inferred 冲突对 |
| search | 20 条手写评测问句（语义型 / 精确型 / facet 型各若干），top-1 ≥ 14、top-3 ≥ 18 |
| diff | 46 项回归靶全绿 |

## 十一、实施阶段

| 阶段 | 交付 | 验收判据 |
|---|---|---|
| **M1** | `render` + `ingest` + 两份单测 | 抽样 20 条人工复核逐位一致；三个分域反例守卫全绿；不调 API |
| **M2** | `embed` + `index` + `search`，先跑 200 条小样 | 10 条语义问句 top-1 ≥ 6；向量文件可加载、内积与余弦一致 |
| **M3** | 全量构建 + 20 条评测集 | top-1 ≥ 14/20、top-3 ≥ 18/20；错例逐条归因（渲染表达 / 切分 / facet 缺失） |
| **M4** | `diff` + 46 项回归 | 46 项全绿；差异项两侧坐标可点 |
| **M5** | CLI 收口 + AGENTS.md 纪律段 + 可选 MCP | 会话里跑通一次真实校验问答；AGENTS.md 写清「问包内数据先跑 rag search」 |

## 十二、风险与已知边界

1. **`docs/` 入索引会带来陈旧风险**。缓解：`caliber` 篇数刻意压到 ~12，只收「已确认且会反复用错」的口径（如大幅减伤 = `HUGE_MODIFIER_RATE` 哨兵、伤兵 5%/14%），front matter 带 `confirmedAt`，与包内冲突时按 §三 作废。
2. **换算分派依赖 `value_type × replace_type` 的正确性**。`docs/包内冲突分类-审计.md` 已说明「数值到规则名的映射含推断」。缓解：M1 阶段只对**三个已用锚点自证过的分域**下断言，其余先渲染原始值 + 标注 `unresolved-division`，不猜。
3. **hero 表的势力/兵种字段名尚未核实**（只确认了 `heroid / cost / hero_type / hit_range / 五维 base+grow / skill_init`）。M1 实地核对后再补 `facets`，契约里不写推测字段。
4. **云端 embedding 使渲染文本出本机**（含官方数值，已获 YG 确认）。原始 `.bin` / 原始 JSON 不出。
5. **索引不入库**：`.rag/` 进 `.gitignore`。与 `docs/逆向对拍/对拍结论摘要.md`「原始数据表不随仓库分发」、`NOTICE.md` §五 素材登记口径一致；管线代码入库，产物不入库。

## 十三、后续（不在本轮）

- M5 之后的 MCP 封装（把 search/diff 暴露成工具，~80 行）。
- 口径卡的版本化维护流程。
- 若日后要扩到非战斗表（内政 / 赛季 / 活动），先另起 spec，不在本设计里开洞。
