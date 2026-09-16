# Task 5 修复（评审 Important ×2）

Global Constraints：**不要 git commit**。不要改无关文件。不要实现周泰/羊祜等。不要给贾充编造谋略成长率。

不要剥离 `skills.ts` / `seed_heroes.sql` 里于禁、七将面板、其它通用战法的既有未提交改动——那些不属于本修复范围（评审第 3 条由 controller 否决）。

## 必须做

### 1. `src/data/listing.ts`

在 `OFFLINE_MAIN_SKILLS` 增加：

```ts
  shangshun_fani: '恢复 65% / 策略反击 180% 成长未确认（取基值）',
```

理由：`listing.ts` 注释写明「受谋略成长未确认（含取基值）→ 下架」。赏顺伐逆两段均 `strategyScaled:false`。

### 2. `tests/heroes_panel_q7.test.ts`

贾充用例从「空槽」改为「已挂槽但仍下架」：

- `expect(rec.mainSkillId).toBe('shangshun_fani');`
- `expect(rec.mainSkillName).toBe('赏顺伐逆');`（保留）
- `expect(isHeroListed(rec)).toBe(false);`（因 OFFLINE）
- 改 describe/it 标题：不要再写「赏顺伐逆空槽」；面板数值断言保持不变
- 文件头注释同步：贾充已挂主战法、因取基值仍下架；其余七将空槽表述照旧

### 3. 测试

Run:

```
npx vitest run tests/heroes_panel_q7.test.ts tests/listing.test.ts tests/main_skills_b19.test.ts
```

Expected: PASS

## 不要做

- 不要跑全量 vitest（那是 Task 6）
- 不要改 `shangshun_fani` 数值
- 不要 git commit
- 不要改 `web/data/skill_grades.json` / `skill_desc.json`（Task 6 跑 `gen_skill_data.mjs`）
