# 五星主战法第一刀 · Whole-branch Important 修复

## 状态

**DONE（Important #2 only）** — 未 git commit。未改 `luoshou_jian` / 落首箭 targetMode（Important #1 留给人拍板）。未重生 golden。

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/damage_lab_smoke.test.ts -t "skillMeta"` | **1 passed**（13 skipped） |
| `npx tsc --noEmit` | **PASS**（exit 0，仅 npm `devdir` warn） |

## 根因

`web/teamEditor.ts` 的 `skillMeta` 在 `s.prepare` 时硬编码「1回合准备」。长坂之吼 `prepareTurns: 2` 且不上下架表，Web 武将池可见张飞：正文「2回合准备」，摘要却写 1。同函数已为区间 `triggerRate` 做过 `Array.isArray` 收窄，未带上准备回合。

## 修复

`skillMeta`：`s.type === 'active' && s.prepare` 时推 `${s.prepareTurns ?? 1}回合准备`。区间发动率仍 `Array.isArray(s.triggerRate) ? s.triggerRate[0] : s.triggerRate`。

## 测试

`tests/damage_lab_smoke.test.ts` 已 import `teamEditor`，加一条廉价断言：

- `changban_zhihou` 含「2回合准备」、不含「1回合准备」
- 缺省 `prepareTurns` 的 `xuanwu_fuliu` 仍为「1回合准备」
