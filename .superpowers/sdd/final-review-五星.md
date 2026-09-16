# 五星主战法第一刀 · Whole-feature Review

**Base:** e16ca80  
**Head:** working tree（无 commit）  
**对照：** `docs/superpowers/specs/2026-09-16-五星主战法第一刀-design.md` + plan Global Constraints + 六战法字面量  
**范围：** 只评本批（落首箭 / 长坂之吼 / 烽火覆周 / 虎步关右 / 火兽冲锋 / 文德椒房 + 必要引擎增量）。工作树里的兵种阵型、受攻击缩放、万箭齐发不评分。  
**测试：** 采信 Controller：`main_skills_b20` 31 + `prepared_timing` 35 + `listing` 6 + `dataIntegrity` 3 = 75 PASS。本审查未重跑套件、未跑 git。

---

### Strengths

- 六战法 `SKILL_REGISTRY` 字面量与 spec「战法」块逐字段一致：落首 300/180/`positions:['大营']`/`duration:[1,2]`；长坂 `prepareTurns:2`、`groupCount:[2,3]`、450、`ignoresTroopCounter`；烽火 `triggerRate:[0.5,1]`、chain 0.6/0.2、无 `growthRate`、无燃烧；虎步 1.2 / charges 1 / `speedScaled` / `damageType:'physical'`；火兽开战 +80% basic 与 `chance_group` 50%（160% + charges 1.6）；文德 `after_first_active`、`maxStacks:3`、`strategyScaled` 无成长。三人下架文案与 spec 一致，落首/长坂/火兽不上 `OFFLINE_MAIN_SKILLS`。
- 引擎按数据驱动增量，缺省保持旧行为：`prepareTurns??1`、数字发动率、无 chain / chance_group。2 回合准备口径正确（`prepare_start` 只赋值不递减；下一行动 `prepareLeft>1` 再减；`===1` 才 `prepare_end`）。`after_first_active` 在 `prepare_start` return 之前不置位，在 `executeSkillWithTargets` / `executePreparedSkill` 之后才钩；`triggerRoundCommandOnAct` 仍只认 `on_act`，准备阶段 `phase:'round'` 跳过。
- charges 维与常驻共存、`maxStacks` 封顶、`consumeAttackCharges` 走 `statusMatchesHit`：虎步 physical 不被策略消耗也不吃 70%；火兽 0.8 与 1.6 加算。`growthRate === undefined` 时策略伤害 / speedScaled / strategyScaled 增伤都走基值，六人无 `growthRate:0` 冒充。
- 无视克制按并行中的加算模型落地（`troop_counter` 不进 `modifiers.reduce`），与本批 plan Global Constraints 一致，而非旧 `counterFactor` 字段。连锁循环剥离 `chain` 再 `random_single`，有 `decay<=0` 刹车。
- 入库同步：`SKILL_ID_BY_NAME`、`heroes.json` / `seed_heroes.sql` 六人 `mainSkillId`、品级 A/A/B/B/A/C、描述为清洗后前半（张飞无 333%、沙摩柯无承伤、夏侯渊无叠 2）。`prepared_timing` 已按 `prepareTurns` 泛化。未挂 T1～T9、无 `Math.random`、无 commit。

---

### Issues

#### Critical (Must Fix)

无。

#### Important (Should Fix)

1. **落首箭第一段是「最近单体」，与已确认决策「随机单体」打架**
   - File: spec 决策 8 vs `src/data/skills.ts:3629`（`targetMode:'single'`）、`src/engine/types.ts:399`（`PreparedActiveSkill.targetMode` 不含 `random_single`）、`src/engine/target.ts:108-111`（`single`=距离最近，`random_single`=均匀随机）
   - What’s wrong: 实现严格抄了 spec「战法」字面量，所以不能算写错字段；但决策 8 写的是「第一段**随机单体** 300%……第一段打的就是大营时，大营吃两刀」。引擎里「随机单体」是专有词。三敌都存活时第一刀恒打前锋，大营双刀只在前排缺员时出现。测③用「敌军只留大营」钉双刀，钉不到随机。
   - Why it matters: 这是本批唯一会改变「谁吃 300%、何时大营吃两刀」的口径差。字面量与决策 8 谁赢，必须在合入前拍板，不能靠 per-task「字面量一致」混过去。
   - How to fix: 若以决策 8 为准：给 `PreparedActiveSkill.targetMode` 加上 `'random_single'`，落首箭改为 `random_single`，补三敌存活时第一目标不全是前锋、且可打到大营双刀的测。若以字面量为准：改 spec 决策 8 的「随机单体」为「单体（最近）」，并写明大营双刀仅缺员时发生。

2. **已上架的张飞，Web 摘要仍写「1回合准备」**
   - File: `web/teamEditor.ts:215-219`（`s.prepare` 则无条件 `parts.push('1回合准备')`；区间发动率已改成取 `[0]`）
   - What’s wrong: 长坂之吼 `prepareTurns:2` 且**不上**下架表，会进 Web 武将池。`skill_desc` 正文是「2回合准备」，摘要行却是「1回合准备 · 距离4 · 发动率75%」。本批为通过 tsc 已经改过同一函数的 `triggerRate` 区间分支，但没带上 `prepareTurns ?? 1`。
   - Why it matters: 这不是未上架战法的展示瑕疵；用户能配张飞，会看到互相矛盾的准备回合。引擎时序是对的，战报会按 2 回合走，摘要在说谎。
   - How to fix: `s.prepare` 时用 `` `${s.prepareTurns ?? 1}回合准备` ``。烽火覆周仍下架，区间取下界可留作 Minor。

#### Minor (Nice to Have)

进度里已记的 per-task Minor **合入前不必修**，此处只补交叉项：

1. **落首箭② 300/180 比值断言偏软**（`tests/main_skills_b20.test.ts` 落首②）  
   首目标恰为大营时走 `phys.some(main ≥ campHits[0].main)`，几乎恒真。

2. **文德椒房③「重选」证据弱**  
   叠层场景只有施法者+1 友军，`groupCount:2` 每回合必选满，未证明跨回合换人；`stacks≤3` 与进入准备不叠仍扎实。虎步/文德也没有「谋略/速度 80 vs 200 基值」对照（烽火有）。

3. **火兽②未在 `actUnit` 前显式断言 `charges===1`**  
   靠普攻 `caused` 同时出现 0.8 与 1.6 间接证明；机制测 `chance_group` 已直接查 charges。

4. **`listing.test.ts` 没有点名锁六人**  
   实现正确（褒姒/夏侯渊/郭皇后因 `OFFLINE_MAIN_SKILLS` 下架，沙摩柯/张飞/祝融不上该表故上架），但测试是「表里有的都下架」循环论证。误把落首/长坂/火兽写入下架表，现有 listing 测仍会绿。Plan Task 5 要求的「`isHeroListed` 对褒姒/夏侯渊/郭皇后为 false」未写成具名断言。

5. **`isPreparing` 注释仍写「1 回合准备战法」**（`types.ts:907`）  
   与 `prepareLeft` 新注释不一致，不影响行为。

6. **`prepared_timing` describe 仍写「27 个」**  
   本批至少新增长坂/落首两条准备战法，标题计数过时。

7. **Web 区间发动率取下界**（`teamEditor.ts:218`、`battleView.ts:475`）  
   烽火覆周已下架，Web 配将碰不到；战报 `skill_trigger` 有 `rate` 时走事件字段，不受此影响。

8. **`skill_desc.json` 长坂 `targetType` 仍是两段拼接**  
   `"敌军群体（有效距离内2-3个目标）敌军单体"`；`desc` 正文已是前半 450%。dataIntegrity 不挡。

---

### Recommendations

1. 先拍板 Important #1（决策 8 vs 字面量），再决定要不要改 `luoshou_jian`。不要只改 spec 注释却让测试继续用「只留大营」假装覆盖随机。
2. Important #2 是一行：`skillMeta` 已经为区间发动率动过刀，顺手带上 `prepareTurns`。
3. 有余力时给 listing 测加六人具名断言（三下架 + 三上架），避免下架表回写成循环。
4. 全量套件与 golden 本审查未复跑；本批约束是无误伤则不重生 golden。合入前在修复上述项后跑 `npx tsc --noEmit && npx vitest run`。

---

### Assessment

**Ready to merge?** With fixes

**Reasoning:** 六人机制、字面量、下架、charges/准备/首次主动钩子与「不编造成长、不挂燃烧」均对齐，75 项相关测试已绿，无 Critical。合入前需要拍板落首箭单体口径，并修正已上架张飞的 Web 准备回合文案；其余均为既有 Minor / 测试硬度问题。
