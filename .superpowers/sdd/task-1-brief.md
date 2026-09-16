### Task 1: 类型增量

**Files:**
- Modify: `src/engine/types.ts`

**Interfaces:**
- Consumes: `CreateStatus` 的 `damage_boost` / `damage_reduce`；`Status` 的同两项；`SkillOutput` 的 `strategy_damage`；`PassiveSkill`
- Produces: 下方字段。本任务不改 `action.ts`。`triggerRate` 已是区间，保持不动。

- [ ] **Step 1: `CreateStatus` 加 `attackScaled` / `decayFifths`**

`damage_reduce`（约 300 行）在 `speedScaled` 不存在于减伤、现有 `strategyScaled` 旁追加 `attackScaled?: boolean`：

```ts
  | { type: 'damage_reduce'; rate: number; duration: number; strategyScaled?: boolean; /** 受攻击缩放（对称字段）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; /** 按 8 份衰减（谋议宏图）：准备阶段 8/8，每回合开始 -1/8 */ decayEighths?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
```

`damage_boost`（约 308 行）在 `speedScaled` 后追加 `attackScaled`，在 `chargesStack` 语义旁注明 taken charges，并加 `decayFifths`：

把现有 JSDoc 里「charges：次数型「下一次攻击」」改成：

```
 *  charges：次数型。direction:'caused' 时按攻击者打出消耗（青丘媚祸）；
 *  direction:'taken' 时按受击方吃到匹配伤害后消耗（文伐下一次受到策略），不按回合递减
 *  attackScaled=true（万箭 −50% / 恃强 −30%）：受攻击缩放；growthRate === undefined 时不缩放、用基值
 *  decayFifths：按 N 份衰减（恃强 5）：挂上时满额，每次受到匹配伤害且实际扣兵 > 0 则 −1 份，rate = baseRate × fifths/N
```

字段本身在 `speedScaled?: boolean` 后插入：

```ts
    /** 受攻击缩放（万箭齐发 −50%、恃强淬锋 −30% / +3.4%）；growthRate === undefined 时不缩放、用基值 */
    attackScaled?: boolean;
```

在 `chargesStack?: boolean` 后插入：

```ts
    /** 按 N 份衰减（恃强淬锋 5）：挂上满额，每次匹配受击实际扣兵后 −1 份 */
    decayFifths?: number;
```

- [ ] **Step 2: `Status` 拷贝 `fifths` / `baseRate`（damage_boost）**

`Status` 的 `damage_boost`（约 829 行）追加：

```ts
    /** 当前剩余份数（恃强淬锋 5→4→…）；无此字段则不按 1/5 衰减 */
    fifths?: number;
    /** fifths 满额时的 rate，衰减时 rate = baseRate × fifths / 初始份数 */
    baseRate?: number;
```

`damage_reduce` 的 `Status` **不必**加 `fifths`（本批恃强走 taken `damage_boost`）。`CreateStatus.attackScaled` 施加时写入已缩放的 `rate`，`Status` **不必**存 `attackScaled`。

- [ ] **Step 3: `strategy_damage` 加 `range`；`PassiveSkill` 加 `selfPhysBoost`**

`strategy_damage`（约 137 行）在 `chain` 后追加：

```ts
      /**
       * 本段选敌距离（不攻每回合策略 5）。缺省 `skill.range`。
       * 与 physical_damage.range 同口径。
       */
      range?: number;
      /** 选目标时无视战法距离（对称 physical_damage.ignoreRange） */
      ignoreRange?: boolean;
```

`PassiveSkill`（约 641 行 `roundStartRepeat` 之后、`output` 之前）追加：

```ts
  /**
   * 自身造成物理伤害叠层（恃强淬锋 +3.4%/层）。
   * onRoundStart：tickRoundStartStatuses 给持有者 +1 层（不要走 roundStartRepeat，那是行动阶段）。
   * onDealPhysical：持有者造成普攻/战法物理/分兵/反击且实际扣兵后 +1 层。
   * 层数走 damage_boost stacks + sameSource 累加，到 maxStacks 停止。
   */
  selfPhysBoost?: {
    perStack: number;
    maxStacks: number;
    duration: number;
    attackScaled?: boolean;
    onRoundStart?: boolean;
    onDealPhysical?: boolean;
  };
```

- [ ] **Step 4: `npx tsc --noEmit`**

Expected: PASS（只加可选字段）。

跳过 Commit。

---
