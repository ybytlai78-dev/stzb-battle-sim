### Task 2: attackScaled 结算 + taken 受击消耗 charges

**Files:**
- Modify: `src/engine/action.ts`（`executeSkillOutputs` 的 `inflict_status` 缩放分支约 2872 行；`consumeAttackCharges` 约 2388 行；`applyDamage` 约 3718 行；`inflictStatus` sameSource 约 1578 行）
- Create: `tests/attack_scale.test.ts`

**Interfaces:**
- Consumes: `CreateStatus.attackScaled`；`damage_boost.charges` + `direction:'taken'`
- Produces: 无 `growthRate` 的 `attackScaled` 用原 rate；taken charges 在策略受击实际扣兵后消耗、当次仍计入；`consumeAttackCharges` **只扣** `direction === 'caused'`

- [ ] **Step 1: 写失败测试**

`tests/attack_scale.test.ts` 完整拷贝 `tests/troop_filter.test.ts` 的 `dummyUnit` / `makeCtx`（含 `hasActedThisRound`）。再写：

```ts
import { describe, it, expect } from 'vitest';
import {
  applyDamage,
  inflictStatus,
  triggerCommandSkills,
  tickRoundStartStatuses,
  type CombatContext,
} from '../src/engine/action';
import type { General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

// … dummyUnit / makeCtx 同 troop_filter.test.ts …

describe('attackScaled', () => {
  it('无 growthRate 用原 rate（万箭 −0.5）', () => {
    const caster = dummyUnit('caster', '前锋', { attack: 200 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    inflictStatus(
      ctx,
      foe,
      {
        type: 'damage_boost',
        rate: -0.5,
        duration: 2,
        direction: 'caused',
        damageType: 'strategy',
        attackScaled: true,
      },
      'active',
      'wanjian_qifa',
      caster.general.id
    );
    const st = foe.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.rate).toBe(-0.5);
  });

  it('有 growthRate 才按生效攻击缩放', () => {
    const caster = dummyUnit('caster', '前锋', { attack: 180 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    inflictStatus(
      ctx,
      foe,
      {
        type: 'damage_boost',
        rate: -0.5,
        duration: 2,
        direction: 'caused',
        attackScaled: true,
        growthRate: 0.15,
      },
      'active',
      'test_as',
      caster.general.id
    );
    // 本任务：executeSkillOutputs 才缩放；直接 inflictStatus 仍写原 rate（与 speedScaled 直调路径一致）
    const st = foe.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.rate).toBe(-0.5);
  });
});

describe('taken charges 受击消耗', () => {
  it('策略受击实际扣兵后 charges 到 0 移除；当次仍计入', () => {
    const atk = dummyUnit('atk', '前锋', { strategy: 200 });
    const def = dummyUnit('def', '前锋', { troops: 10000 }, 'enemy');
    def.troops = 10000;
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: 0.2,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        charges: 1,
      },
      'pursuit',
      'wenfa',
      atk.general.id
    );
    expect(def.statuses.some((s) => s.type === 'damage_boost' && s.charges === 1)).toBe(true);
    applyDamage(ctx, def, 100, atk, 'strategy', 'skill');
    expect(def.statuses.filter((s) => s.type === 'damage_boost' && s.charges != null)).toHaveLength(0);
    expect(def.troops).toBe(9900);
  });

  it('物理受击不扣策略 taken charges', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      def,
      {
        type: 'damage_boost',
        rate: 0.2,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        charges: 1,
      },
      'pursuit',
      'wenfa',
      atk.general.id
    );
    applyDamage(ctx, def, 100, atk, 'physical', 'basic');
    const st = def.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.charges).toBe(1);
  });

  it('目标自己打出物理不消耗身上的 taken charges', () => {
    const unit = dummyUnit('u', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([unit], [foe]);
    inflictStatus(
      ctx,
      unit,
      {
        type: 'damage_boost',
        rate: 0.2,
        duration: 999,
        direction: 'taken',
        damageType: 'strategy',
        charges: 1,
      },
      'pursuit',
      'wenfa',
      unit.general.id
    );
    applyDamage(ctx, foe, 100, unit, 'physical', 'basic');
    const st = unit.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.charges).toBe(1);
  });
});
```

第三测依赖 `consumeAttackCharges` 不再误扣 taken：该测通过 `applyDamage` 源为单位自身、目标为敌军。`consumeAttackCharges` 在 `applyDamage` **之外**（普攻/战法输出后）调用，本测不经过它；另加一测用导出函数。`consumeAttackCharges` 未导出——不要导出。第三测改为：单位身上同时有 caused charges 与 taken charges 时，只通过 `applyDamage` 打物理给敌人，taken 仍在；caused 仍在（因为 `applyDamage` 不扣 caused）。再加：

```ts
  it('applyDamage 不扣攻击者 caused charges', () => {
    const atk = dummyUnit('atk', '前锋');
    const def = dummyUnit('def', '前锋', {}, 'enemy');
    const ctx = makeCtx([atk], [def]);
    inflictStatus(
      ctx,
      atk,
      { type: 'damage_boost', rate: 0.28, duration: 999, direction: 'caused', charges: 2 },
      'active',
      'quanjun_tuji',
      atk.general.id
    );
    applyDamage(ctx, def, 100, atk, 'physical', 'basic');
    const st = atk.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.charges).toBe(2);
  });
```

`executeSkillOutputs` 缩放测：构造最小主动战法挂进 `ctx.skills`，用已导出的 `triggerActiveSkill`（若测试文件现有 import 没有则加上）：

```ts
import { triggerActiveSkill } from '../src/engine/action';

describe('attackScaled 经 executeSkillOutputs', () => {
  it('无 growthRate 保持 −0.5；有 growthRate 按攻击缩放', () => {
    const skill: Skill = {
      id: 'test_as',
      name: '测缩放',
      type: 'active',
      prepare: false,
      range: 5,
      triggerRate: 1,
      targetMode: 'single',
      tags: ['damage_boost'],
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: -0.5,
            duration: 2,
            direction: 'caused',
            damageType: 'strategy',
            attackScaled: true,
          },
        },
      ],
    };
    const caster = dummyUnit('caster', '前锋', { attack: 80, activeSkillIds: ['test_as'], morale: 100 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    ctx.skills.set('test_as', skill);
    triggerActiveSkill(ctx, caster, skill, [foe], [caster], [foe]);
    const st = foe.statuses.find((s) => s.type === 'damage_boost');
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') expect(st.rate).toBe(-0.5);

    const skill2: Skill = {
      ...skill,
      id: 'test_as2',
      output: [
        {
          kind: 'inflict_status',
          status: {
            type: 'damage_boost',
            rate: 0.08,
            duration: 2,
            direction: 'caused',
            attackScaled: true,
            growthRate: 0.026,
          },
        },
      ],
    };
    const caster2 = dummyUnit('c2', '前锋', { attack: 180, activeSkillIds: ['test_as2'], morale: 100 });
    const foe2 = dummyUnit('f2', '前锋', {}, 'enemy');
    const ctx2 = makeCtx([caster2], [foe2]);
    ctx2.skills.set('test_as2', skill2);
    triggerActiveSkill(ctx2, caster2, skill2, [foe2], [caster2], [foe2]);
    const st2 = foe2.statuses.find((s) => s.type === 'damage_boost');
    expect(st2?.type).toBe('damage_boost');
    if (st2?.type === 'damage_boost') {
      // scaledValue(8, 0.026, 180) = 8 + 0.026*100 = 10.6 → roundRate 10 → /100 = 0.10
      expect(st2.rate).toBeCloseTo(0.1, 5);
    }
  });
});
```

`triggerActiveSkill` 若未导出：不要改成导出。改为对友军 `inflict_status` 走 `executeSkillOutputs`——检查 `action.ts`：`triggerActiveSkill` **已 export**（约 2944 行）。用它。

- [ ] **Step 2: 跑测确认失败**

Run: `npx vitest run tests/attack_scale.test.ts`

Expected: FAIL（taken 策略受击后 charges 仍为 1，或 attackScaled 有 growthRate 未缩放）。

- [ ] **Step 3: 实现**

**A. `executeSkillOutputs` `inflict_status`：** 在 `speedScaled` 分支之后、属性 buff 分支之前插入：

```ts
          } else if (
            (create.type === 'damage_boost' || create.type === 'damage_reduce') &&
            create.attackScaled
          ) {
            /** 增减伤受攻击影响（万箭 −50%、恃强 −30%）；growthRate 缺省时不缩放、用基值 */
            if (create.growthRate !== undefined) {
              const sign = Math.sign(create.rate) || 1;
              const scaled =
                (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'attack'))) /
                  100) *
                sign;
              inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
            } else {
              inflictStatus(ctx, t, create, skill.type, skill.id, caster.general.id);
            }
```

对齐 `speedScaled`：百分比按绝对值缩放再恢复符号。

**B. `consumeAttackCharges`：** 循环内加：

```ts
    if (s.direction === 'taken') continue;
```

只扣 caused（青丘 / 全军突击）。缺省 direction 在 Status 上是施加时写入的 `'taken'` 或 `'caused'`；`inflictStatus` 已写 `direction = create.direction ?? 'taken'`。

**C. `applyDamage`：** 在 `target.troops -= actual` 与伤兵拆分之后、`triggerIgniteOnHurt` 之前（`actual > 0` 时）调用新函数：

```ts
/**
 * 受击次数型 taken charges（文伐：下一次受到策略攻击）：
 * 本次伤害已计入该层（damageBoosts 在 applyDamage 之前算完），扣兵后再 −1，到 0 移除。
 * 物理受击不匹配 strategy taken，不消耗。
 */
function consumeTakenCharges(target: UnitState, hit: DamageHitContext): void {
  for (const s of [...target.statuses]) {
    if (s.type !== 'damage_boost' || s.direction !== 'taken' || s.charges == null) continue;
    if (!statusMatchesHit(s, hit)) continue;
    s.charges -= 1;
    if (s.charges <= 0) target.statuses = target.statuses.filter((x) => x !== s);
  }
}
```

`applyDamage` 内：

```ts
  if (actual > 0) {
    const hit: DamageHitContext = { damageSource, damageType };
    consumeTakenCharges(target, hit);
  }
```

`damageType` / `damageSource` 为 `applyDamage` 已有参数。规避导致提前 `return` 时不走这里。

- [ ] **Step 4: 跑测确认通过**

Run: `npx vitest run tests/attack_scale.test.ts`

Expected: PASS。

Run: `npx tsc --noEmit`

Expected: PASS。

跳过 Commit。

---
