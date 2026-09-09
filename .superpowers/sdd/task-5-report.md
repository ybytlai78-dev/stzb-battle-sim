# Task 5 Report: 配将台皮肤（不改操作模型）

## Status: done

## Commits: none

## Changes

- `web/styles.css`：`.slot` / `.hero-card` / `.modal` / `.team-panel` / `.hero-pool` 对齐套2——`border-radius: var(--radius)`、`border-bottom: var(--card-accent)`；hover/empty/drag-over/picked 重申底边绯红；底栏 `.control-bar` 扁平表面；`#start` / `.btn.primary` 背景 `var(--color-crimson)`；槽卡实线描边、去掉空槽鎏金渐变
- `web/mobile.css`：横屏底栏继承扁平表面 + `#start` 绯红；槽位显式 `border-radius`
- `web/teamEditor.ts`：未改（品级仍走既有 `.grade.grade-s`，CSS 已着色）

## Test Summary

| Command | Result |
|---------|--------|
| `npx vitest run web/smoke.test.ts web/damageModifier.test.ts tests/damage_lab_smoke.test.ts` | 3 files / 44 tests PASS |
| `nav-link` 数量 | 仍为 3（smoke 覆盖） |

## Concerns

- 顶栏 `header.app` 仍保留部分旧鎏金渐变/金线（brief 允许可选、非必须）
- 次要 `.btn`（非 primary）仍为金色，仅主 CTA 绯红——与原型 CTA/ghost 分工一致
- 部队加成弹窗内部仍有旧色裸 hex（Task 6 范围，本任务未动）
