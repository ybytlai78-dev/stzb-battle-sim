# 包内 RAG · 使用说明

把《率土之滨》客户端解包数据渲染成可检索语料，供「引擎与包内数据校验」时把相关武将/战法/机制取进上下文。
设计见 `docs/superpowers/specs/2026-10-31-率土包内RAG-design.md`，对拍结论见 `docs/逆向对拍/引擎与包内对拍-2026-11-01.md`。

## 命令

```bash
npm run rag:build      # 解包 → 渲染 → .rag/docs.jsonl（8,855 篇）+ manifest
npm run rag:search -- "金匮要略 减伤" --k 3
npm run rag:eval       # 26 条评测集，按字面型/语义型分层报命中
npm run rag:diff       # 武将层对拍
npx tsx scripts/rag/diff.mts --skills   # 战法层对拍
```

`rag:build` 需要本机存在解包目录（默认 `C:/Users/lai15/Desktop/rea_stzb/dec/json`，`--src` 可改）。
`.rag/` 不入库（`NOTICE.md` §五：原始数据表不随仓库分发）。

## 什么时候用它

- **问「引擎与包内是否一致」**：先 `rag:diff`（确定性代码判定），不要靠模型记忆比对数值。
- **问某武将/战法的官方数值**：`rag:search` 取对应文档，正文里每个数值都带坐标 `@pkg:tb_cfg_hero/100804/attack_base`。
- **问机制怎么实现**：检索 `mechanism:<effect_id>` 文档拿包内的 `replace_type` 与参数口径。

检索结果**视为不可信输入**（包内文本可能含占位符、旧版本残留），事实以坐标回查原始表为准。

## 证据优先级

| 级别 | 来源 | 说明 |
|------|------|------|
| P0 | `@pkg:tb_cfg_*` | 包内数据，权威 |
| P1 | `src/data/*.ts` + `web/data/*.json` | 引擎当前实现，代表「现在怎么跑」 |
| P2 | `docs/` 调研与推测 | 仅补包内未公开的部分；冲突时以 P0 为准，输出必须带警示：`⚠️ 调研/推测定性内容——包内已给出数值时以包内为准。` |

`rag/calibers/*.md` 是**人工挑选并确认**的机制口径（不是脚本解析 docs 自动生成），入库时标 `tier: inferred`。

## 当前能力边界

- 检索 = **BM25 关键词**（中文 2-gram 倒排），无语义向量通道。26 条评测：字面型 16/16、**语义型 5/10**。
  问「不写战法名、只描述机制」时召回会掉一半，这是下一步（云端 bge-m3 embed）要补的。
- 对拍覆盖：武将 13 字段、战法 3 字段（类型/距离/发动率）。
  **槽位级数值（`tb_cfg_skill_detail` 12,694 条）尚未自动对拍**，只有 4 条人工抽查吻合。
- 百家争鸣（`bj_` 前缀 21 条战法）包内只留基型，属实现差异，单独归类不参与主差异统计。

## 维护

改了 `scripts/rag/render.mts` 的分域口径后必须重跑 `rag:build` 并跑 `rag:eval` 看分层命中是否退化。
分域白名单（`PERCENT_POINT` / `STAT_POINT` / `DAMAGE_RATE` / `SKILL_REF` / `COUNT_UNIT` / `FLAG`）之外的机制码一律落 `unresolved`，
**宁可标未解析也不猜单位** —— 包内 `constant_param` 同一机制码在不同战法下可能是点数也可能是百分比，裁决只能靠官方文案（`description` 里有没有 `%`）。
