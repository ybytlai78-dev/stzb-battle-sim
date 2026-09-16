# Task 4: 四张战法入库

**Files:** `src/data/skills.ts` (append after wende_jiaofang), `scripts/build_heroes_seed.mjs`

## Commits
(none)

Skills at skills.ts ~3777–3899 match brief literals:
- wanjian_qifa: active prepare false 0.35 range 5 group 2 physical 150 + caused strategy -0.5 attackScaled duration 2
- wenfa: pursuit [0.2,0.4] strategy 228 growthRate 2.1 then taken +0.2 charges 1
- bugong: command prep self cowardice 999 + caused strategy 0.25; roundStartRepeat strategy 83 range 5
- shiqiang_cuifeng: passive battle_start taken -0.3 decayFifths 5 + selfPhysBoost 0.034/12

SKILL_ID_BY_NAME lines 116–119.

Implementer: tsc PASS, attack_scale 12/12. Do not re-run suite.
