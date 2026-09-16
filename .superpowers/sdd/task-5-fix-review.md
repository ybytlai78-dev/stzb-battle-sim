# Task 5 Fix Review: q7 + OFFLINE（评审 Important ×2）

## Spec Compliance

✅ **Spec compliant**

对照 `task-5-fix-brief.md` + 磁盘原文（`task-5-fix-review-pkg.md` / 实文件）：

| 要求 | 结果 |
|------|------|
| `OFFLINE_MAIN_SKILLS` 增 `shangshun_fani: '恢复 65% / 策略反击 180% 成长未确认（取基值）'` | ✅ 文案与 brief 字面一致 |
| q7：`mainSkillId === 'shangshun_fani'` | ✅ |
| q7：`mainSkillName === '赏顺伐逆'`（保留） | ✅ |
| q7：`isHeroListed(rec) === false`（因 OFFLINE） | ✅ |
| describe/it 去掉「空槽」表述；标题改为已挂槽因取基值仍下架 | ✅ describe=`七将面板入库（空槽 / 取基值下架）`；贾充 it 标题正确 |
| 文件头注释：贾充已挂主战法、取基值仍下架；其余空槽表述照旧 | ✅ |
| 面板四维断言不变 | ✅ |
| 未改 `shangshun_fani` 数值 | ✅ 仍 65/180、`strategyScaled:false` |
| 未改 `skill_grades` / `skill_desc` | ✅ 无 `shangshun_fani` 条目（留给 Task 6） |
| 未剥离 `skills.ts` 其它未提交改动 | ✅ 本修复只动 listing + q7 |
| 未 git commit | ✅ 报告声明 none |
| 限定测：q7 + listing + b19 → 17 pass | ✅ 实现者报告（本门禁不复跑） |

原评审 Important ×2（q7 空槽契约、取基值未 OFFLINE）均已关闭。原 Important #3（skills 范围污染）由 controller 否决剥离，本修复正确未动。

## Strengths

- OFFLINE 理由与仓库惯例一致（取基值 → 下架），文案对齐同类条目（如 `zhuge_jinnang` / `hanyun_kuangye`）
- q7 贾充从「空槽」改为「挂槽 + 仍下架」，与 `isHeroListed` 语义闭环
- 严格遵守禁改：战法数值、品级/描述、无关 skills 改动均未触碰
- 自检范围与 brief 一致（17 tests / 3 files），未越权跑全量

## Issues

### Critical

（无）

### Important

（无）

### Minor

1. **dataIntegrity 仍缺** `skill_grades` / `skill_desc` 的 `shangshun_fani`——已标明 Task 6，本修复 brief 明确禁止改动，可接受。
2. 报告中「Task 5 评审修复」小节重复粘贴两次，无功能影响。

## Assessment

**Approved**

原 Important ×2 已按 brief 精确落地；约束（不 commit、不改数值/品级、不剥离其它改动）均遵守。Task quality: 合格，可放行至后续 Task 6。
