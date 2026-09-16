### Task 4: 四张战法入库

**Files:**
- Modify: `src/data/skills.ts`（在 `sata_ruxing` 之后、对象闭合 `};` 之前追加）
- Modify: `scripts/build_heroes_seed.mjs`（`SKILL_ID_BY_NAME` 在 `飒沓如星` 后追加四行）

**Interfaces:**
- Consumes: Task 1–3 字段
- Produces: `wanjian_qifa` / `wenfa` / `bugong` / `shiqiang_cuifeng`

- [ ] **Step 1: 写入 `SKILL_REGISTRY`**

```ts
  /**
   * 万箭齐发（A 主动 35% 距离 5）：敌军群体 2 物理 150%；目标策略造成伤害 −50%（受攻击，无成长率）持续 1 回合（行动中施加 duration 2）。
   */
  wanjian_qifa: {
    id: 'wanjian_qifa',
    name: '万箭齐发',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 0.35,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'physical_damage', rate: 150 },
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
  },
  /**
   * 文伐（B 追击 20%–40%）：对攻击目标策略 228%（受谋略 2.1%/点），再使其下一次受到策略攻击伤害 +20%（taken charges 1，无成长率）。
   */
  wenfa: {
    id: 'wenfa',
    name: '文伐',
    type: 'pursuit',
    range: 0,
    triggerRate: [0.2, 0.4],
    tags: ['damage', 'damage_boost'],
    output: [
      { kind: 'strategy_damage', rate: 228, strategyScaled: true, growthRate: 2.1 },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.2,
          duration: 999,
          direction: 'taken',
          damageType: 'strategy',
          charges: 1,
        },
      },
    ],
  },
  /**
   * 不攻（S 一类指挥）：自身整场怯战 + 策略造成 +25%；每回合开始后对距离 5 敌军单体策略 83%（满级基值，无成长率）。
   */
  bugong: {
    id: 'bugong',
    name: '不攻',
    type: 'command',
    phase: 'prep',
    range: 1,
    triggerRate: 1,
    targetMode: 'self',
    tags: ['cowardice', 'damage_boost', 'damage'],
    output: [
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 999 } },
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: 0.25,
          duration: 999,
          direction: 'caused',
          damageType: 'strategy',
        },
      },
    ],
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
  },
  /**
   * 恃强淬锋（A 被动）：受策略伤害 −30%（受攻击，无成长率）五份衰减；回合开始或每次造成物理伤害 +3.4%/层（受攻击，无成长率），最多 12 层至战斗结束。
   */
  shiqiang_cuifeng: {
    id: 'shiqiang_cuifeng',
    name: '恃强淬锋',
    type: 'passive',
    triggerRate: 1,
    timing: 'battle_start',
    range: 1,
    targetMode: 'self',
    tags: ['damage_boost'],
    output: [
      {
        kind: 'inflict_status',
        status: {
          type: 'damage_boost',
          rate: -0.3,
          duration: 999,
          direction: 'taken',
          damageType: 'strategy',
          attackScaled: true,
          decayFifths: 5,
        },
      },
    ],
    selfPhysBoost: {
      perStack: 0.034,
      maxStacks: 12,
      duration: 999,
      attackScaled: true,
      onRoundStart: true,
      onDealPhysical: true,
    },
  },
```

`scripts/build_heroes_seed.mjs` 在 `飒沓如星: 'sata_ruxing',` 后：

```js
  万箭齐发: 'wanjian_qifa',
  文伐: 'wenfa',
  不攻: 'bugong',
  恃强淬锋: 'shiqiang_cuifeng',
```

不跑 `build_heroes_seed.mjs`。

- [ ] **Step 2: `npx tsc --noEmit`**

Expected: PASS。

- [ ] **Step 3: smoke**

Run: `npx vitest run tests/attack_scale.test.ts`

Expected: PASS。

跳过 Commit。

---
