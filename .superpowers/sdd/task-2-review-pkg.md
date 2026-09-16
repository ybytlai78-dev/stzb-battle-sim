# Task 2: attackScaled 结算 + taken 受击消耗 charges

**Base:** after Task 1 (no commit)
**Head:** working tree
**Files:** `src/engine/action.ts`, `tests/attack_scale.test.ts`

## Commits
(none)

## Key hunks in action.ts

### consumeAttackCharges skips taken (~2394)
`if (s.direction === 'taken') continue;`

### consumeTakenCharges (~2409) — new
Filters damage_boost taken with charges, statusMatchesHit, then charges -= 1, remove at 0.

### executeSkillOutputs attackScaled (~2975)
After speedScaled, before attr buffs: damage_boost|damage_reduce + attackScaled; growthRate defined → scaledValue with effective attack; else original rate.

### applyDamage (~3901)
After wounded split, if actual > 0: hit = { damageSource, damageType }; consumeTakenCharges(target, hit).

Line ~2737 `direction === 'taken'` is pre-existing markTakenBoost, not this task.

## Tests
`tests/attack_scale.test.ts`: 7 cases — attackScaled direct inflict, taken strategy consume, physical skip, self physical skip taken, applyDamage skip caused, executeSkillOutputs with/without growthRate.

Implementer: vitest 7 pass, tsc PASS. Do not re-run unless a named doubt.
