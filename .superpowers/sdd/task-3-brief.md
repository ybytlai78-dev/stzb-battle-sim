### Task 3: 统计页（图二骨架 + 行序）

**Files:**
- Modify: `web/battleSummary.ts` 的 `createStatsView` / `openSharePanel`
- Modify: `web/styles.css`、`web/mobile.css`
- Test: `web/smoke.test.ts` 同一测的统计段

**Interfaces:**
- Consumes: `computeDetailedStats`、`computeContributionShares`、`avatarSrc`、`skillGrade`
- Produces: `.stats-view` 内不再有 `<table>`；改为 `.st-page`：

```
.st-rail: 武将统计 | 战法统计（默认 skill）
.st-main:
  红 大营、中军、前锋
  蓝 前锋、中军、大营
每行 .st-row: .pos-tag + .hcard(img avatarSrc) + (.sk-row 四列 | .sh-row 三占比)
```

四列数据：普攻 `attackCount`/`attackDamage`；主战法与两携带用现有 `columnOrder(g)` + `SkillStat` 的 `castCount` / `damage` / `healAmount`。恢复与杀伤同一行，恢复用 `--color-green`。

武将统计：不要再弹 `.stats-share-modal` 当主路径；占比条直接画在 `.sh-row`。可删「详情」按钮。

行序实现：

```ts
const POS = ['大营', '中军', '前锋'] as const;
const redRows = POS.map((p) => report.myTeam.find((g) => g.position === p)).filter(Boolean);
const blueRows = (['前锋', '中军', '大营'] as const)
  .map((p) => report.enemyTeam.find((g) => g.position === p))
  .filter(Boolean);
```

横屏 `.st-row { min-height: 50px; }`，头像列约 44px，禁止 `min-height:0` 把六行压叠。

对照：`design-demos/02-workbench.html` 里 `.st-page` / `.st-row` / `.grade.s|a|b`。

- [ ] **Step 1: 改统计断言**

替换 smoke 里：

```ts
expect(stats.querySelectorAll('tbody tr').length).toBe(4);
stats.querySelectorAll('tbody tr').forEach((tr) => {
  expect(tr.querySelectorAll('td').length).toBe(5);
});
expect(stats.querySelectorAll('.st-detail-btn').length).toBe(1);
(stats.querySelector('.st-detail-btn') as HTMLButtonElement).click();
const sharePanel = document.querySelector('.stats-share-modal') as HTMLElement;
```

为：

```ts
expect(stats.querySelector('table')).toBeFalsy();
expect(stats.querySelectorAll('.st-row').length).toBe(4); // 3 红 + 1 蓝
const labels = Array.from(stats.querySelectorAll('.pos-tag')).map((el) => el.textContent);
expect(labels).toEqual(['大营', '中军', '前锋', '前锋']); // 红三站位后接蓝前锋
expect(stats.querySelector('[data-stats="skill"]')).toBeTruthy();
(stats.querySelector('[data-stats="hero"]') as HTMLButtonElement).click();
expect(stats.querySelector('.sh-row')).toBeTruthy();
expect(stats.textContent).toContain('伤害');
```

（该测红 3 蓝 1，蓝只有前锋一行。）

- [ ] **Step 2: 跑测 FAIL**

Run: `npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"`

Expected: FAIL（仍是 table）。

- [ ] **Step 3: 重写 `createStatsView`**

保留 `computeDetailedStats` 口径注释（次数 = skill_cast，杀伤归属 creditToId，恢复归属施法者）。品级字母来自 `skillGrade(skillId)`。

- [ ] **Step 4: 跑测 PASS**

Run: `npx vitest run web/smoke.test.ts -t "选将 → 开始模拟"`

## Global Constraints

- 视觉真理：`design-demos/02-workbench.html`；spec 的「验收后锁定」。
- 不要实现套1 沙盘，不要读它当布局参考。
- 不要改 `src/engine/**`；禁止 `Math.random` 进引擎。
- 伤害实验室布局不重做；仅允许 CSS token 继承。实验室统计 tab 共用 `createStatsView`，骨架会跟着变。
- 颜色一律 `var(--color-*)`，禁止组件里裸 hex（inline SVG 除外）。
- 品级：S `#d989a0` / A `#4a7ab0` / B `#4e8a62`（用 `--color-grade-*`）。
- 统计行序：红大营→中军→前锋，再蓝前锋→中军→大营。
- 统计/详情头像：`avatarSrc`（`_s.jpg`）。
- JSDoc 中文。
- **不要 git commit**。不要改 demo HTML。
