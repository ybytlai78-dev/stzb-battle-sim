### Task 5: 战法测试 + classified + 清点 + gen_skill_data

**Files:**
- Create: `tests/universal_b_plus_p3.test.ts`
- Modify: `scripts/_classified.json`
- Modify: `docs/待补充机制清点.md`
- Modify: `web/data/skill_grades.json` / `skill_desc.json`（跑生成脚本，不要手改）

**Interfaces:**
- Consumes: 四个 `SKILL_REGISTRY` id
- Produces: 每战法 3 测；清点 60→57；grades/desc 含四 id

- [ ] **Step 1: 写 `tests/universal_b_plus_p3.test.ts`**

木桩对齐 `tests/universal_b_plus_p2.test.ts`（完整拷贝 `dummy` / `enemyTeam` / `run` / `commandTeam` / `activeTeam` / `asCommand` / `asActive` / `inflictStatusOf`）。另加：

```ts
function asPursuit(id: string): Extract<Skill, { type: 'pursuit' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'pursuit') throw new Error(`${id} 不是追击`);
  return s;
}
function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
}
function pursuitTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.pursuitSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}
function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}
```

每战法 3 测：

**万箭齐发：** ① `asActive` `prepare:false` `triggerRate:0.35` `range:5` `groupCount:2` `targetMode:'group'`。② `output[0]` 物理 150；`output[1]` inflict `rate:-0.5` `duration:2` `direction:'caused'` `damageType:'strategy'` `attackScaled:true` 无 `growthRate`。③ 装配测不依赖发动；机制：用 `triggerActiveSkill`（morale 100、triggerRate 临时不改——改拷贝 skill 挂 ctx 或直接断言 registry 字段即可）。窗口测：registry `attackScaled:true` 且无 `growthRate`。

**文伐：** ① `asPursuit` `triggerRate` 为 `[0.2, 0.4]`。② `output[0]` strategy 228 `growthRate:2.1`；`output[1]` taken +0.2 `charges:1` `damageType:'strategy'`。③ 顺序：`output.map(o => o.kind)` 为 `['strategy_damage','inflict_status']`（228 先于挂状态）。

**不攻：** ① `asCommand` `phase:'prep'` `targetMode:'self'` `range:1`。② output 含怯战 999 与策略 caused +0.25 duration 999。③ `run(commandTeam('bugong'), 1, 2)`：carrier 有怯战；events 有 `bugong` 的 `strategy` `damage`；carrier 无 `attack_hit`（自身普攻被怯战拦截）。`commandTeam` 把指挥挂中军——不攻 `targetMode:'self'` 只作用于载体。断言 `events` 里 `sourceId` 为 `carrier` 的 `attack_hit` 长度为 0，且存在 `skillId==='bugong'` 的 strategy `damage`。

**恃强淬锋：** ① `asPassive` `timing:'battle_start'` `selfPhysBoost.maxStacks === 12` `perStack === 0.034`。② output taken −0.3 `decayFifths:5` `attackScaled` `damageType:'strategy'`。③ `run(passiveTeam('shiqiang_cuifeng'), 1, 1)`：载体有 taken fifths 5；有 caused physical stacks ≥ 1（回合开始叠层）。

主动装配测不依赖发动成功。

- [ ] **Step 2: 跑本批测试**

Run: `npx vitest run tests/universal_b_plus_p3.test.ts tests/attack_scale.test.ts`

Expected: PASS。失败则修战法字段或引擎，不改断言去就数据。

- [ ] **Step 3: classified + 清点 + gen_skill_data**

`scripts/_classified.json`：

- 「不攻」「万箭齐发」「文伐」：`status: "implemented"`，`missingMechanics: ""`，`note: "attack scale p3"`。万箭可把 `triggerRate`/`targetDesc`/`effectDesc` 改成 extra 口径（35%、群体 2、无准备 150%/−50%），与 note 一起改以免文档继续误导。
- 新增恃强淬锋对象（插在被动条目附近，字段对齐现有对象）：

```json
  {
    "name": "恃强淬锋",
    "quality": "A",
    "type": "passive",
    "range": 5,
    "triggerRate": null,
    "targetDesc": "自己",
    "effectDesc": "令自身受到策略伤害降低30.0%（受攻击属性影响），每次受到策略伤害时，降低1/5；每回合开始时或每次造成攻击伤害时，使自身造成的攻击伤害提高3.4%（受攻击属性影响），此效果最多叠加12次，持续到战斗结束",
    "sources": "【群·孟获·步】",
    "status": "implemented",
    "missingMechanics": "",
    "note": "attack scale p3"
  }
```

`docs/待补充机制清点.md`：

- 文首 **60→57**（恃强原不在 60 内，净减不攻+万箭+文伐 3 个）。
- 删 `no_basic` 整行；删 `per_round_strategy` 整行。
- `next_damage` 去掉文伐，留闪击，数量 **2→1**。
- `random_single` 去掉万箭齐发，留十面埋伏，数量 **2→1**。
- 「确认仍缺」去掉「禁普攻」；「下一次攻击增减伤」改为仅闪击。
- 引擎现状补一句：`attackScaled` / taken 受击消耗 charges / `decayFifths` / 被动 `selfPhysBoost` 已入库（2026-09-16 p3）。

Run: `node scripts/gen_skill_data.mjs`

Expected: `skill_grades` / `skill_desc` 含 `wanjian_qifa` / `wenfa` / `bugong` / `shiqiang_cuifeng`。不要手改这两个 JSON。

- [ ] **Step 4: 全量回归**

Run: `npx tsc --noEmit`  
Expected: PASS

Run: `npx vitest run`  
Expected: 全绿，0 failed。golden 2/2 且 **不要** 删 `tests/__snapshots__/golden.json`。若 golden 失败：先查是否误伤 T1～T9；仅当确认是本批必然副作用且用户同意才重生。默认修引擎而不是重生。

跳过 Commit。

---

## Self-Review

1. **Spec coverage:** `attackScaled` Task 1+2；taken charges 受击消耗 Task 2；`decayFifths` Task 3；`selfPhysBoost` Task 3；`strategy_damage.range` Task 3；发动率区间已有、文伐 Task 4 使用；不攻怯战+roundStartRepeat Task 4；四张数据 Task 4；每战法 3 测 + classified + 清点 + gen_skill_data Task 5。第四阶段不做。
2. **Placeholders:** 无 TBD。`fifthsBase` 在 Task 3 补齐分母，避免 `fifths/(fifths+1)` 公式错误。
3. **Types:** `selfPhysBoost` / `decayFifths` / `fifths` / `fifthsBase` / `attackScaled` / `strategy_damage.range` 前后一致。`consumeAttackCharges` 只扣 caused，taken 只在 `applyDamage` 扣。
