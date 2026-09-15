# SDD progress — 拆解通用 B 级以上 · 第一阶段受击链路

Workspace: `C:\Users\lai15\Desktop\战斗系统`（在 main 上就地实现；Global Constraints：**不要 git commit**）
Plan: `docs/superpowers/plans/2026-09-15-拆解通用B级以上-受击链路.md`
Spec: `docs/superpowers/specs/2026-09-15-拆解通用B级以上-受击链路-design.md`

（上一轮于禁/贾充受击受恢复钩子已完成，见 git working tree；本批依赖其 onHurt/onHeal。）

- Task 1: complete (working tree, review Approved after firstOnHurt + applyDamage 转发 damageSource)
- Task 2: complete (working tree, review Approved；Minor: 窗口/挑衅/maxStacks 无独立单测；maxStacks 达上限仍可能已发 skill_trigger)
- Task 3: complete (working tree, review Approved after Math.round incoming)
- Task 4: complete (working tree, review Approved after sameSource counter 刷新 appliedRound)
- Task 5: complete (working tree, review Approved；7 战法与 SKILL_ID_BY_NAME 与 brief 逐字段一致)
- Task 6: complete (working tree; 913/0 after consumeEvasion 0 层立即移除；golden 未重生)
- Final review Important（空城 0 层规避残留）已修；其余 Minor 记 later

**交接文（下一场先读）：** `.superpowers/sdd/handoff-2026-09-15-受击链路.md`

