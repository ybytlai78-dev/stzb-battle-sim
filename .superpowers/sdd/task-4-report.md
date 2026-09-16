# Task 4 报告：四张战法入库

## 状态

**DONE** — 未 git commit。`npx tsc --noEmit` PASS。`npx vitest run tests/attack_scale.test.ts` 12/12 PASS。未跑 `build_heroes_seed.mjs`。

## 实现摘要

按 brief 字面量入库四张通用战法，并追加 `SKILL_ID_BY_NAME` 映射。因 `SKILL_REGISTRY` / 映射表在 `sata_ruxing` 之后已有五星战法（落首箭～文德椒房），四张新战法追加在**对象末尾**（`wende_jiaofang` 之后、闭合 `};` 之前），未插入五星条目之间、未改动既有五星定义。

| id | 中文名 | 类型要点 |
|----|--------|----------|
| `wanjian_qifa` | 万箭齐发 | A 主动；群体 2 物理 150% + 策略 caused −50% attackScaled duration 2 |
| `wenfa` | 文伐 | B 追击；策略 228%（2.1%/点）+ taken strategy +20% charges 1 |
| `bugong` | 不攻 | S 一类指挥；怯战 + 策略 caused +25%；`roundStartRepeat` 距离 5 单体策略 83% |
| `shiqiang_cuifeng` | 恃强淬锋 | A 被动 battle_start；taken strategy −30% attackScaled decayFifths 5 + `selfPhysBoost` 12 层 |

`scripts/build_heroes_seed.mjs` 在 `文德椒房` 后追加四行中文名→id，未执行种子脚本。

## 自检

- `npx tsc --noEmit` → PASS（exit 0）
- `npx vitest run tests/attack_scale.test.ts` → 12 passed

## 未做

- 未 git commit
- 未跑 `node scripts/build_heroes_seed.mjs` / `seed_db.mjs`
- 未改 Web 描述/品级 JSON（本任务卡未要求）

## Concerns

无。引擎字段（attackScaled / charges / decayFifths / selfPhysBoost / roundStartRepeat）由 Task 1–3 已落地；本任务仅数据入库。
