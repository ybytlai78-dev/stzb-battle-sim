# Task 1: 类型增量

**Base:** working tree before this task (no commit; Global Constraints forbid git commit)
**Head:** working tree after Task 1
**Scope file:** `src/engine/types.ts` only

Working tree vs git HEAD also contains prior-phase uncommitted edits in the same file. This package quotes only the Task 1 insertions the implementer claims. Verify these exist and match the brief; do not treat other pre-existing types.ts content as this task's Extra.

## Commits

(none — plan forbids commit)

## Task 1 insertions (verbatim from working tree)

### strategy_damage.range / ignoreRange (`types.ts` ~158–164)

```ts
      /**
       * 本段选敌距离（不攻每回合策略 5）。缺省 `skill.range`。
       * 与 physical_damage.range 同口径。
       */
      range?: number;
      /** 选目标时无视战法距离（对称 physical_damage.ignoreRange） */
      ignoreRange?: boolean;
```

### CreateStatus.damage_reduce.attackScaled (`types.ts` ~307)

```ts
  | { type: 'damage_reduce'; ... strategyScaled?: boolean; /** 受攻击缩放（对称字段）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; ... }
```

### CreateStatus.damage_boost JSDoc + attackScaled + decayFifths (`types.ts` ~308–318)

JSDoc now includes charges caused/taken, attackScaled, decayFifths.
Fields: `attackScaled?: boolean` after `speedScaled`; `decayFifths?: number` after `chargesStack`.
No `fifthsBase` on CreateStatus.

### PassiveSkill.selfPhysBoost (`types.ts` ~651–664)

```ts
  selfPhysBoost?: {
    perStack: number;
    maxStacks: number;
    duration: number;
    attackScaled?: boolean;
    onRoundStart?: boolean;
    onDealPhysical?: boolean;
  };
```

Placed after `roundStartRepeat`, before `output`.

### Status.damage_boost fifths / baseRate (`types.ts` ~853)

```ts
    /** 当前剩余份数（恃强淬锋 5→4→…）；无此字段则不按 1/5 衰减 */
    fifths?: number;
    /** fifths 满额时的 rate，衰减时 rate = baseRate × fifths / 初始份数 */
    baseRate?: number;
```

No `fifthsBase` (Task 3). Status does not store `attackScaled`.
