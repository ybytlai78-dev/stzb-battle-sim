# Final review package — 受攻击缩放 p3

Plan: docs/superpowers/plans/2026-09-16-拆解通用B级以上-受攻击缩放.md
Spec: docs/superpowers/specs/2026-09-16-拆解通用B级以上-受攻击缩放-design.md
No commits (Global Constraints). Working tree mixed with parallel 五星主战法 — review ONLY this plan's deliverables.

## This plan's files
- src/engine/types.ts: attackScaled, decayFifths, fifths/fifthsBase/baseRate, strategy_damage.range, selfPhysBoost
- src/engine/action.ts: attackScaled inflict, consumeTakenCharges, consumeAttackCharges skip taken, decayFifthsOnHit, applySelfPhysBoost, outRange
- src/data/skills.ts: wanjian_qifa, wenfa, bugong, shiqiang_cuifeng (end of registry)
- scripts/build_heroes_seed.mjs: four SKILL_ID_BY_NAME
- tests/attack_scale.test.ts, tests/universal_b_plus_p3.test.ts
- scripts/_classified.json, docs/待补充机制清点.md (60→57)
- web/data/skill_grades.json, skill_desc.json via gen_skill_data

## Per-task reviews
All 5 Approved, 0 Critical, 0 Important.

## Known workspace noise
Full vitest 7 fails: main_skills_b20 unwired + 长坂之吼 prepareTurns. Not this plan. golden 2/2. p3+attack_scale 24/24.

## Minor roll-up
Task 3 range test initially 前锋 vs 前锋 (distance 1); fixed to 大营 + placeholders.
