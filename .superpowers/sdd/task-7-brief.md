### Task 7: golden 重录与全量测试

**Files:**
- Delete then regenerate: `tests/__snapshots__/golden.json`
- 不改 fixtures 逻辑（加成由 `runBattle` 自动生效）

**Interfaces:**
- Consumes: 新准备事件与可能变化的伤害数字
- Produces: 与当前引擎字节一致的 golden

- [ ] **Step 1: Run golden to see expected fail**

Run: `npx vitest run tests/golden.test.ts`

Expected: FAIL，`eventCount` / `events` 与快照不一致。

- [ ] **Step 2: 确认失败来自准备阶段结构（阵容事件），而非随机**

抽查 diff：应出现 `prep_phase`、`formation_bonus`；同阵营/同兵种夹具的兵力数字可能变。若出现 `NaN` 或缺字段，回到 Task 3 修，不要重录。

- [ ] **Step 3: 重录快照**

删除 `tests/__snapshots__/golden.json`，再跑：

Run: `npx vitest run tests/golden.test.ts`

Expected: 首次无文件时写入快照并 PASS。再跑第二次仍 PASS。

- [ ] **Step 4: 全量**

Run:

```
npx tsc --noEmit
npm test
```

Expected: `tsc` 无错误；vitest 全绿。

若 `report.ts` 或 `battleView.ts` 对 `BattleEvent` 未穷尽，`tsc` 会报 missing case，补上。

---

## Spec coverage

| Spec 项 | Task |
|---------|------|
| computeTroopBonuses 判定与 205→42 | 1 |
| 魏之智 id 匹配、缺人无称号 | 1 |
| formationBonus + effectiveStat + 魏武之世 | 2 |
| 准备三阶段、加成后 turnOrder | 3 |
| 文本【阵容】【兵种】【战法】 | 4 |
| Web「始」三段 + 出手顺序 | 5 |
| 红蓝弹层、不改面板 | 6 |
| golden | 7 |
| 兵种阶段留空 | 3–5 |
| 不走 inflictStatus | 2–3 |

无「TBD」步骤。`unitName` 在 `formation_bonus` 上是为 CLI 显示中文名（spec 示例用「太史慈」），与 `unitId` 并存。
