### Task 3: decayFifths + selfPhysBoost + 输出级 range

**Files:**
- Modify: `src/engine/action.ts`（`inflictStatus` 推状态约 1833 行；`applyDamage`；`tickRoundStartStatuses` 约 2092 行；`executeSkillOutputs` 的 `outRange` 约 2460 行；`inflictStatus` sameSource 叠层约 1578 行）
- Modify: `tests/attack_scale.test.ts`（追加 describe，不要删 Task 2 的测）

**Interfaces:**
- Consumes: `CreateStatus.decayFifths`；`PassiveSkill.selfPhysBoost`；`strategy_damage.range` / `ignoreRange`
- Produces: 受匹配策略伤且 `actual > 0` 后 `fifths -= 1`，`rate = baseRate * fifths / 初始份数`（本批初始=5；用 `s.fifths` 衰减前的分母——**分母冻结为挂上时的 `decayFifths`**）。`selfPhysBoost` 两路叠层，`maxStacks` 停。

分母实现：`Status` 已有 `baseRate`。再在 `Status.damage_boost` 用现有 `fifths` 表示剩余份数。挂上时 `fifths = create.decayFifths`。衰减公式：`rate = baseRate * fifths / create.decayFifths`。`Status` **没有**存初始份数——把初始份数写入 `baseRate` 旁。为避免再加字段：衰减时用

```ts
s.rate = s.baseRate * (s.fifths / (s.fifths + 1))
```

这在连续衰减时是错的（5→4 时 4/5 对，再 3/5 不能用 3/4）。**必须存初始份数。** Task 1 的 `Status.damage_boost` 若还没有 `fifthsBase`，本任务在 `types.ts` 追加：

```ts
    /** decayFifths 挂上时的满额份数（恃强 5），衰减公式分母 */
    fifthsBase?: number;
```

挂上：`fifths = fifthsBase = create.decayFifths`，`baseRate = create.rate`。衰减：`s.fifths -= 1`；`fifths <= 0` 移除；否则 `s.rate = s.baseRate * s.fifths / s.fifthsBase`。

- [ ] **Step 1: 写失败测试（追加到 `tests/attack_scale.test.ts`）**

```ts
describe('decayFifths', () => {
  it('五次匹配策略扣兵后移除：30→24→18→12→6→0', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: -0.3,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        attackScaled: true,
        decayFifths: 5,
      },
      'passive',
      'shiqiang_cuifeng',
      def.general.id
    );
    const rates: number[] = [];
    const boost = () => def.statuses.find((s) => s.type === 'damage_boost' && s.direction === 'taken');
    const first = boost();
    expect(first?.type).toBe('damage_boost');
    if (first?.type === 'damage_boost') {
      expect(first.rate).toBeCloseTo(-0.3, 5);
      expect(first.fifths).toBe(5);
    }
    for (let i = 0; i < 5; i++) {
      applyDamage(ctx, def, 10, atk, 'strategy', 'skill');
      const s = boost();
      rates.push(s && s.type === 'damage_boost' ? s.rate : 0);
    }
    expect(rates.map((r) => Math.round(r * 1000) / 1000)).toEqual([-0.24, -0.18, -0.12, -0.06, 0]);
    expect(boost()).toBeUndefined();
  });

  it('物理受击不衰减策略 fifths', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: -0.3,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        decayFifths: 5,
      },
      'passive',
      'shiqiang_cuifeng',
      def.general.id
    );
    applyDamage(ctx, def, 10, atk, 'physical', 'basic');
    const s = def.statuses.find((s) => s.type === 'damage_boost');
    expect(s?.type).toBe('damage_boost');
    if (s?.type === 'damage_boost') {
      expect(s.fifths).toBe(5);
      expect(s.rate).toBeCloseTo(-0.3, 5);
    }
  });
});

describe('selfPhysBoost', () => {
  it('回合开始 +1 层；造成物理扣兵后再 +1；封顶 12', () => {
    const skill: Skill = {
      id: 'test_sq',
      name: '测叠层',
      type: 'passive',
      triggerRate: 1,
      timing: 'battle_start',
      range: 1,
      targetMode: 'self',
      tags: ['damage_boost'],
      selfPhysBoost: {
        perStack: 0.034,
        maxStacks: 12,
        duration: 999,
        attackScaled: true,
        onRoundStart: true,
        onDealPhysical: true,
      },
      output: [],
    };
    const u = dummyUnit('u', '前锋', { attack: 80, passiveSkillIds: ['test_sq'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([u], [foe]);
    ctx.skills.set('test_sq', skill);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const layer = () => u.statuses.find((s) => s.type === 'damage_boost' && s.direction === 'caused');
    expect(layer()?.type).toBe('damage_boost');
    if (layer()?.type === 'damage_boost') {
      expect(layer()!.stacks).toBe(1);
      expect(layer()!.rate).toBeCloseTo(0.034, 5);
      expect(layer()!.damageType).toBe('physical');
    }
    applyDamage(ctx, foe, 10, u, 'physical', 'basic');
    if (layer()?.type === 'damage_boost') {
      expect(layer()!.stacks).toBe(2);
      expect(layer()!.rate).toBeCloseTo(0.068, 5);
    }
    applyDamage(ctx, foe, 10, u, 'strategy', 'skill');
    if (layer()?.type === 'damage_boost') expect(layer()!.stacks).toBe(2);
    for (let i = 0; i < 20; i++) applyDamage(ctx, foe, 10, u, 'physical', 'basic');
    if (layer()?.type === 'damage_boost') {
      expect(layer()!.stacks).toBe(12);
      expect(layer()!.rate).toBeCloseTo(0.034 * 12, 5);
    }
  });
});

describe('strategy_damage.range', () => {
  it('战法 range 1 时 roundStartRepeat 用输出 range 5 打到敌军', () => {
    const skill: Skill = {
      id: 'test_bg',
      name: '测不攻距离',
      type: 'command',
      phase: 'prep',
      range: 1,
      triggerRate: 1,
      targetMode: 'self',
      tags: ['damage'],
      output: [],
      roundStartRepeat: {
        output: [
          {
            kind: 'strategy_damage',
            rate: 83,
            strategyScaled: true,
            targetMode: 'single',
            range: 5,
          },
        ],
      },
    };
    const caster = dummyUnit('caster', '前锋', { strategy: 80, commandSkillIds: ['test_bg'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    ctx.skills.set('test_bg', skill);
    triggerCommandSkills(ctx, caster);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_bg' && e.damageType === 'strategy')).toBe(
      true
    );
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `npx vitest run tests/attack_scale.test.ts`

Expected: FAIL（fifths 未衰减 / 叠层未出现 / 策略打不中）。

- [ ] **Step 3: 实现**

**A. `types.ts`：** `Status.damage_boost` 加 `fifthsBase?: number`（若 Task 1 已加 `fifths`/`baseRate` 则只补 `fifthsBase`）。

**B. `inflictStatus` 推 `damage_boost`：** 在 `decayEighths` 拷贝旁：

```ts
    if (type === 'damage_boost' && 'decayFifths' in create && create.decayFifths) {
      (push as { fifths?: number }).fifths = create.decayFifths;
      (push as { fifthsBase?: number }).fifthsBase = create.decayFifths;
      (push as { baseRate?: number }).baseRate = create.rate;
    }
```

detail 可加「剩余 N/5」，与 eighths 文案对齐：

```ts
    } else if (type === 'damage_boost' && 'decayFifths' in create && create.decayFifths) {
      const pct = Math.round(Math.abs(create.rate) * 100);
      const dirName = (create.direction ?? 'taken') === 'caused' ? '造成的' : '受到的';
      detail = `${dirName}伤害${create.rate >= 0 ? '提高' : '降低'} ${pct}% 剩余 ${create.decayFifths}/${create.decayFifths} ${durText}`;
    }
```

把这段放进现有 `if (type === 'damage_boost')` 分支：有 `decayFifths` 时覆盖普通百分数 detail。

**C. `applyDamage`：** 在 `consumeTakenCharges` 之后：

```ts
function decayFifthsOnHit(ctx: CombatContext, target: UnitState, hit: DamageHitContext): void {
  for (const s of [...target.statuses]) {
    if (s.type !== 'damage_boost' || s.fifths === undefined || s.baseRate === undefined || s.fifthsBase === undefined) {
      continue;
    }
    if (!statusMatchesHit(s, hit)) continue;
    s.fifths -= 1;
    if (s.fifths <= 0) {
      target.statuses = target.statuses.filter((x) => x !== s);
      ctx.events.push({ type: 'status_expired', unitId: target.general.id, statusType: s.type });
      continue;
    }
    s.rate = s.baseRate * (s.fifths / s.fifthsBase);
  }
}
```

`actual > 0` 时：`consumeTakenCharges` 然后 `decayFifthsOnHit`。**不要**在 `tickRoundStartStatuses` 里对 fifths 做回合衰减。

**D. `inflictStatus` sameSource 叠层封顶：** 在 `if (sameSource) {` 之后、累加 `rate` 之前：

```ts
    if (
      type === 'damage_boost' &&
      create.type === 'damage_boost' &&
      create.maxStacks != null &&
      (sameSource.stacks ?? 1) >= create.maxStacks
    ) {
      return;
    }
```

**E. `selfPhysBoost`：** 新函数（不要 export，测试走 `tickRoundStartStatuses` / `applyDamage`）：

```ts
/**
 * 恃强淬锋：给持有者叠 1 层造成物理伤害提高（sameSource 累加，maxStacks 封顶）。
 */
function applySelfPhysBoost(ctx: CombatContext, unit: UnitState, skill: Extract<Skill, { type: 'passive' }>): void {
  const cfg = skill.selfPhysBoost;
  if (!cfg) return;
  inflictStatus(
    ctx,
    unit,
    {
      type: 'damage_boost',
      rate: cfg.perStack,
      duration: cfg.duration,
      direction: 'caused',
      damageType: 'physical',
      stacks: 1,
      maxStacks: cfg.maxStacks,
      attackScaled: cfg.attackScaled,
    },
    skill.type,
    skill.id,
    unit.general.id
  );
}
```

`tickRoundStartStatuses` 在 eighths 循环之后、`lockedCommands` 循环之前：

```ts
  for (const unit of units) {
    if (!unit.alive) continue;
    for (const id of unit.general.passiveSkillIds) {
      const skill = resolveSkill(ctx, id);
      if (skill?.type !== 'passive' || !skill.selfPhysBoost?.onRoundStart) continue;
      applySelfPhysBoost(ctx, unit, skill);
    }
  }
```

`applyDamage` 在 `actual > 0` 且 `source` 存在且 `damageType === 'physical'` 时：

```ts
    for (const id of source.general.passiveSkillIds) {
      const skill = resolveSkill(ctx, id);
      if (skill?.type === 'passive' && skill.selfPhysBoost?.onDealPhysical) {
        applySelfPhysBoost(ctx, source, skill);
      }
    }
```

普攻 / 战法物理 / 分兵 / 反击都走 `applyDamage(..., 'physical', ...)`，不必再挂钩子。

**F. `outRange`：** 把约 2460 行

```ts
    const outRange =
      out.kind === 'physical_damage' && out.ignoreRange ? Number.POSITIVE_INFINITY : skill.range;
```

换成：

```ts
    const outIgnoreRange =
      (out.kind === 'physical_damage' || out.kind === 'strategy_damage') && 'ignoreRange' in out && out.ignoreRange;
    const outExplicitRange =
      (out.kind === 'physical_damage' || out.kind === 'strategy_damage') && 'range' in out && out.range != null
        ? out.range
        : undefined;
    const outRange = outIgnoreRange ? Number.POSITIVE_INFINITY : (outExplicitRange ?? skill.range);
```

`physical_damage.attacker === 'recipient'` 内部仍用自己的 `atkRange`（已有），不要改坏疏数。

- [ ] **Step 4: 跑测确认通过**

Run: `npx vitest run tests/attack_scale.test.ts tests/troop_filter.test.ts`

Expected: PASS。

Run: `npx tsc --noEmit`

Expected: PASS。

跳过 Commit。

---
