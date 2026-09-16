# Task 5 报告：六个战法定义 + 挂槽 + 下架 + 品级描述

## 状态

**DONE** — 未 git commit。MySQL 已 `seed_db.mjs`（115 武将）。

## 实现摘要

TDD：先写 6 条装配测（RED 槽位空）→ 写入 `SKILL_REGISTRY` 字面量（与 spec 逐字一致，烽火覆周/虎步关右/文德椒房无 `growthRate`）→ `SKILL_ID_BY_NAME` 在飒沓如星后追加 6 条 → `OFFLINE_MAIN_SKILLS` 仅追加烽火覆周/虎步关右/文德椒房 → `build_heroes_seed.mjs` + `gen_skill_data.mjs` → 补 `heroes.json` 六人 `mainSkillId` → `seed_db.mjs`。

未写 Task 6 机制测。

## 品级（skill_extra.json → gen_skill_data）

| id | 品级 | 描述清洗 |
|----|------|----------|
| luoshou_jian | A | 前半（混乱，无受击增伤） |
| changban_zhihou | A | 前半（群体 450%） |
| fenghuo_fuzhou | B | 全文无拼接 |
| hubu_guanyou | B | 前半（首次攻击 +70%） |
| huoshou_chongfeng | A | 全文无拼接 |
| wende_jiaofang | C | 全文无拼接 |

## 下架

`OFFLINE_MAIN_SKILLS` 本批仅：`fenghuo_fuzhou` / `hubu_guanyou` / `wende_jiaofang`。落首箭 / 长坂之吼 / 火兽冲锋不上该表。

## 自检

| 命令 | 结果 |
|------|------|
| `vitest … -t "装配"` | **6 passed**（RED→GREEN） |
| `dataIntegrity` + `listing` | **9 passed** |
| `npx tsc --noEmit` | **PASS**（exit 0） |
| `seed_db.mjs` | **PASS** 115 行 |

## 文件变更

| 文件 | 变更 |
|------|------|
| `tests/main_skills_b20.test.ts` | 追加 6 条装配测 |
| `src/data/skills.ts` | registry 追加 6 战法 + 中文 JSDoc |
| `scripts/build_heroes_seed.mjs` | SKILL_ID_BY_NAME 6 条 |
| `src/data/listing.ts` | OFFLINE 3 条 |
| `web/data/heroes.json` | h524/h22/h376/h435/h494/h655 mainSkillId |
| `scripts/seed_heroes.sql` | 脚本生成 |
| `web/data/skill_grades.json` / `skill_desc.json` | 脚本生成 |

## 问题与关注点

无阻塞。本机 MySQL 可达并已重灌；JSON 回退亦已补 mainSkillId。registry 末尾另有并行会话的万箭齐发/文伐/不攻/恃强淬锋，未动。

## 给测试子代理的交接

- 六 id：`luoshou_jian` `changban_zhihou` `fenghuo_fuzhou` `hubu_guanyou` `huoshou_chongfeng` `wende_jiaofang`
- 挂槽：h524/h22/h376/h435 主动；h494 被动；h655 指挥
- 褒姒/夏侯渊/郭皇后 `isHeroListed` = false
- Task 6 才写机制测；本任务只有装配
