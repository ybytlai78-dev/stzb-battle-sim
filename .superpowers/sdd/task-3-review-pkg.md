# Task 3: decayFifths + selfPhysBoost + 输出级 range

**Files:** `src/engine/types.ts` (fifthsBase), `src/engine/action.ts`, `tests/attack_scale.test.ts`

## Commits
(none)

## Engine hunks

- Status.damage_boost `fifthsBase?: number` (types.ts ~853)
- inflictStatus copies fifths / fifthsBase / baseRate when decayFifths (~1861)
- decayFifthsOnHit after consumeTakenCharges in applyDamage (~4029–4040)
- applySelfPhysBoost; tickRoundStartStatuses onRoundStart (~2159); applyDamage physical onDealPhysical
- maxStacks gate in inflictStatus sameSource (~1599)
- outRange: ignoreRange / explicit range for physical+strategy (~2623–2629)
- Do NOT decay fifths in tickRoundStartStatuses

## Tests

attack_scale.test.ts appended: decayFifths 30→24→…→0; physical skip; selfPhysBoost stacks/cap 12; strategy_damage.range with foe at 大营 + my-team placeholders so live distance is 3; negative case without output range misses.

Fix after implementer concern: range test was 前锋 vs 前锋 (distance 1). Now 2 tests, 28 total with troop_filter.

Implementer+fixer: 28 pass, tsc PASS. Do not re-run suite unless named doubt.
