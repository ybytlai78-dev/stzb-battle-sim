# AI 配将顾问（一期）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 按任务顺序逐条执行，每个任务自带「写测试 → 跑失败 → 实现 → 跑通过 → 提交」五步；不要跳步、不要合并提交。
> 设计口径**全部来自** `docs/AI配将顾问-设计.md`（下称 spec）——本计划只做拆解，不新增口径；两者冲突时以 spec 为准。

**目标**：在主站加一个右侧对话抽屉，LLM 用自然语言理解需求并调用确定性工具（一期为秒级快工具），产出**带实测数据**的配将方案卡，校验门通过后可一键应用到配将区。

**架构**：新增 `web/advisor/`（transport / tools / gate / loop / cache / view 六个文件，各一个职责，依赖注入）。LLM 只做理解与叙述，**数字路径完全不经过 LLM**（方案卡数字由 `view.ts` 从 `ToolResult.data` 直读）；`gate.ts` 负责合法性、`evidenceId` 溯源、标准口径复算三道关。引擎（`src/engine/*`）**零改动**。

**技术栈**：TypeScript（strict）+ vitest（jsdom）+ vite + node；复用 `web/teamConfig.ts` / `web/simExpectation.ts` / `web/teamScan.ts` / `web/heroes.ts` 既有导出；LLM 走 OpenAI 兼容 `/chat/completions` 流式接口。

**Spec**：`docs/AI配将顾问-设计.md`

## 全局约束

- **落点**：建议在当前工作区开分支 `dsh/ai-advisor`（若要按仓库惯例走 DSH 工作树，见 `docs/工作树落地流程.md`）。提交一律**显式列路径**，禁止 `git add -A`。
- **引擎零改动**：不动 `src/engine/*`、不动 `src/data/*`；`tests/__snapshots__/golden.json` 必须**字节一致**。
- **门禁**：每个任务结束跑 `npx tsc --noEmit` 与 `npx tsc --noEmit -p web/tsconfig.json` 两份 clean；任务 8 之前每个任务只跑本任务的测试文件，任务 8/9 跑全量 `npm test`。
- **基线**：开工第一步先跑一次 `npm test` 记录当前基线（files / tests 两个数字），后续任务以它为准（本计划纯新增，除 `web/smoke.test.ts` 的 `nav-link` 数量 6→7 外不应有任何既有断言变化）。
- **测试约定**：DOM 测试文件头写 `// @vitest-environment jsdom`；用到 `initHeroDB` / `getGeneral` 的测试在 `beforeAll(async () => { await initHeroDB(); })`（本机 MySQL 不可达时回退 `web/data/heroes.json`）。
- **AI 不下场算数**：任何 LLM 输出里的数字都必须带 `evidenceId`；渲染层的数字一律来自 `ToolResult.data`。
- **预算三件套**（默认，可配置）：累计 20,000 场 / 累计 120 秒 / 单轮 ≤8 次工具调用；超限 = **拒绝执行 + 回灌原因**。
- **复算常量**：`ADVISOR_VERIFY_SEED = 20260929`、`ADVISOR_VERIFY_RUNS = 20`、木桩模板取 spec §3 `Plan` 示例默认值。禁止用时间/随机种子复算。
- **容差公式**：`|claimed - actual| <= max(0.005 * |actual|, 1)`。
- **localStorage 键**：`dsh-advisor-settings-v1` / `dsh-advisor-turns-v1` / `dsh-advisor-cache-v1`。
- **多行源码编辑**用 `str_replace_editor` / `write` / node 脚本，**不要**用 PowerShell 双引号字符串（`\n` / `${}` 会被吃掉）。
- 测试文件比 spec §9 多 2 个（`tests/advisor_types.test.ts` / `tests/advisor_runplan.test.ts`），系把「Plan 规范化」与「单场执行抽取等价性」从 tools 任务里拆出来单独锁，其余一致。

## 文件结构（先定边界，再拆任务）

| 文件 | 职责 | 依赖 |
|---|---|---|
| `web/advisor/types.ts` | 共享类型 + `Plan` 规范化 / 缓存键（纯函数，无 IO） | 无 |
| `web/advisor/transport.ts` | OpenAI 兼容流式调用、SSE 解析、`tool_calls` 拼装、错误分类、假 transport | 无（不 import 业务） |
| `web/advisor/gate.ts` | 三关：`validateAdvisorPlan` / `verifyClaims` / `recomputePlan` | `web/teamScan.ts` + 注入的跑批 |
| `web/advisor/tools.ts` | 工具注册表 + 一期六个工具 + 预算护栏 + `aggregate` | `types` / `gate` / 注入的既有实现 |
| `web/advisor/loop.ts` | 对话循环、`SYSTEM_PROMPT`、trace 组装、取消 | `transport` / `tools` / `gate` |
| `web/advisor/cache.ts` | 跑批缓存 + 会话/设置持久化（localStorage） | `types` |
| `web/advisor/view.ts` + `web/advisor.css` | 抽屉、方案卡、进度、成本行、设置区 | `loop` / `cache`（**不 import 引擎**） |
| `web/main.ts` | 只加：第 7 个 nav 入口 + `mountAdvisor` 调用 | `view` |

---

### Task 1: 共享类型 + Plan 规范化

**Files:**
- Create: `web/advisor/types.ts`
- Create: `tests/advisor_types.test.ts`

**Interfaces:**
- Produces：
  - `PLAN_POSITIONS: readonly ['大营', '中军', '前锋']`
  - `interface PlanSlot { position: PlanPosition; heroId: string; level: number; skillIds: string[] }`
  - `interface DummySpec { defense: number; strategy: number; troopType: TroopType; troops: number }`
  - `interface AdvisorPlan { slots: PlanSlot[]; coreUnitIds: string[]; dummy: DummySpec }`
  - `const DEFAULT_DUMMY: DummySpec`（防御 150 / 谋略 100 / 步 / 150000）
  - `normalizePlan(plan: AdvisorPlan): AdvisorPlan`（按 `PLAN_POSITIONS` 排序、补 `level` 缺省 40、`skillIds` 去空、`dummy` 缺省合并）
  - `planKey(plan: AdvisorPlan, runs: number, seed: number): string`（稳定 JSON，槽位顺序无关）
  - `parsePlans(answer: string): { plans: ProposedPlan[]; text: string }` —— 从终答里取出围栏 ```json 块 `{ "plans": [...] }`（**这是 LLM 唯一的方案出口**，spec §4 硬规则 2），坏 JSON / 缺字段 → 返回 `{ plans: [], text: answer }` 并把整段原文保留在 `text`（不静默丢弃）
  - `interface ToolSpec<A = unknown> { name: string; description: string; schema: unknown; cost: { battles?: number; battlesOf?: (args: unknown) => number; long?: boolean }; run(args: A, ctx: unknown): Promise<ToolResult> }`（`battlesOf` 为落地补充：`simulate` 花多少取决于 `runs`，预算按实参计费）
  - `interface ToolResult { summary: string; data: unknown; evidenceId: string; stats: { battles: number; ms: number; seed: number } }`
  - `interface Budget { maxBattles: number; maxMs: number; maxCalls: number }`、`interface BudgetState extends Budget { battles: number; ms: number; calls: number; startedAt: number }`
  - `class BudgetExceeded extends Error { constructor(public readonly why: 'battles' | 'ms' | 'calls') }`
  - `interface ToolCallRecord { evidenceId: string; name: string; args: unknown; summary: string; stats: { battles: number; ms: number; seed: number } }`
  - `interface AdvisorMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: Array<{ id: string; name: string; args: unknown }> }`
  - `interface TurnVerdict { legal: boolean; verified: boolean; recomputed: boolean; apply: { enabled: boolean; reason?: string } }`
  - `interface AdvisorTurn { messages: AdvisorMessage[]; toolCalls: ToolCallRecord[]; plans: ProposedPlan[]; answer: string; degraded?: boolean; verdict: TurnVerdict }`

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DEFAULT_DUMMY, normalizePlan, planKey, type AdvisorPlan } from '../web/advisor/types';

const base: AdvisorPlan = {
  slots: [
    { position: '前锋', heroId: 'h574', level: 40, skillIds: [] },
    { position: '大营', heroId: 'h3', level: 0, skillIds: ['', 'jishi'] },
  ],
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
};

describe('advisor types', () => {
  it('normalizePlan 按 大营/中军/前锋 排序、补默认等级、去空战法', () => {
    const p = normalizePlan(base);
    expect(p.slots.map((s) => s.position)).toEqual(['大营', '前锋']);
    expect(p.slots[0].level).toBe(40);                 // level 0 → 40
    expect(p.slots[0].skillIds).toEqual(['jishi']);     // 空串被去掉
  });

  it('planKey 与槽位顺序无关，与场次/种子有关', () => {
    const a = normalizePlan(base);
    const b = normalizePlan({ ...base, slots: [...base.slots].reverse() });
    expect(planKey(a, 20, 1)).toBe(planKey(b, 20, 1));
    expect(planKey(a, 20, 1)).not.toBe(planKey(a, 200, 1));
    expect(planKey(a, 20, 1)).not.toBe(planKey(a, 20, 2));
  });

  it('parsePlans 取出围栏 JSON 里的方案，正文去掉该块', () => {
    const answer = '结论：陆抗带危崖困军更好。\n```json\n{ "plans": [ { "title": "方案A", "plan": {"slots":[],"coreUnitIds":[],"dummy":{}}, "evidenceIds": ["ev-1"] } ] }\n```';
    const r = parsePlans(answer);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].title).toBe('方案A');
    expect(r.text).not.toContain('```json');
  });

  it('parsePlans 遇到坏 JSON 不抛错：返回空方案 + 保留原文', () => {
    const bad = '看这个\n```json\n{ "plans": [ oops ] }\n```';
    const r = parsePlans(bad);
    expect(r.plans).toEqual([]);
    expect(r.text).toBe(bad);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/advisor_types.test.ts`
Expected: FAIL —— `Failed to resolve import "../web/advisor/types"`。

- [ ] **Step 3: 实现**

```ts
// web/advisor/types.ts
import type { TroopType } from '../teamConfig';

export const PLAN_POSITIONS = ['大营', '中军', '前锋'] as const;
export type PlanPosition = (typeof PLAN_POSITIONS)[number];

export interface PlanSlot { position: PlanPosition; heroId: string; level: number; skillIds: string[] }
export interface DummySpec { defense: number; strategy: number; troopType: TroopType; troops: number }
export interface AdvisorPlan { slots: PlanSlot[]; coreUnitIds: string[]; dummy: DummySpec }
export interface ProposedPlan { title: string; plan: AdvisorPlan; evidenceIds: string[] }

export const DEFAULT_DUMMY: DummySpec = { defense: 150, strategy: 100, troopType: 'infantry', troops: 150000 };

export function normalizePlan(plan: AdvisorPlan): AdvisorPlan {
  const slots = [...plan.slots]
    .map((s) => ({ ...s, level: s.level > 0 ? s.level : 40, skillIds: s.skillIds.filter((x) => Boolean(x)) }))
    .sort((a, b) => PLAN_POSITIONS.indexOf(a.position) - PLAN_POSITIONS.indexOf(b.position));
  return { slots, coreUnitIds: [...plan.coreUnitIds], dummy: { ...DEFAULT_DUMMY, ...plan.dummy } };
}

export function planKey(plan: AdvisorPlan, runs: number, seed: number): string {
  const p = normalizePlan(plan);
  const canonical = p.slots.map((s) => `${s.position}:${s.heroId}:${s.level}:${s.skillIds.join(',')}`).join('|');
  return `${canonical}#${p.coreUnitIds.join(',')}#${JSON.stringify(p.dummy)}#${runs}#${seed}`;
}
```

> `TroopType` 的实际字面量以 `web/teamConfig.ts:16` 的 `TROOP_OPTIONS` 为准（骑/步/弓）；若它是中文枚举，把 `infantry` 换成实际值。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/advisor_types.test.ts` → PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add web/advisor/types.ts tests/advisor_types.test.ts
git commit -m "feat(advisor): Plan 共享类型与规范化"
```

---

### Task 2: 从 L2 抽出「单方案跑 N 场」的入口（口径单源，行为不变）

**背景**：spec §11 要求 `simulate` 与 L2 用**同一套**靶子/种子/取和口径。现在 L2 只有一个「搜索」入口（`simExpectationSteps`，`web/simExpectation.ts:710`），没有「给定一个方案跑 N 场」的导出。**抽出来复用，不要另写一套。**

**Files:**
- Modify: `web/simExpectation.ts`（在 `simExpectationSteps` 附近新增导出；**只提取、不改行为**）
- Create: `tests/advisor_runplan.test.ts`

**Interfaces:**
- **落地偏差（2026-09-29）**：实际实现为 **`evaluatePlan`（跑 N 场 + 汇总）**，不导出单场函数 —— 顾问只需要「一套方案的汇总」，拆到单场是多余接口；汇总逻辑抽成 `aggregateSamples`，与决赛 `finalRowOf` 共用同一份（口径单源的地基）。本节下方的 `runOnePlanBattle` 写法**作废**，以 `docs/AI配将顾问-设计.md` 文末的落地记录为准。
- Consumes：`simExpectationSteps`（生成器）内部单场执行段、`coreDamageOf` / `first3Damage`（`web/simExpectation.ts:355-363`）
- Produces：
  - `interface PlanSummary { runs; damages; mean; meanFirst3; meanTotal; sd; halfWidth; min; max; median; byUnit; bySkill; wipedRuns }`
  - `evaluatePlan(cfg: ViewCfg, options?: Partial<SimExpectOptions> & { runs?: number }): PlanSummary`
  - （内部共用）`aggregateSamples(inp): PlanSummary` —— 决赛排行与单方案测评走同一份汇总，禁止两套期望/半宽算法

- [ ] **Step 1: 写失败测试（等价性 + 确定性）**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { initHeroDB } from '../src/data/heroes';
import { defaultCfg } from '../web/teamConfig';
import { SIM_EXPECT_DEFAULTS, runOnePlanBattle } from '../web/simExpectation';

beforeAll(async () => { await initHeroDB(); });

describe('runOnePlanBattle（从 L2 生成器抽出）', () => {
  const cfg = defaultCfg();
  const opts = { ...SIM_EXPECT_DEFAULTS };

  it('同 index 两次结果完全一致（种子 = baseSeed + index）', () => {
    const a = runOnePlanBattle(cfg, opts, 7);
    const b = runOnePlanBattle(cfg, opts, 7);
    expect(a.coreDamage).toBe(b.coreDamage);
    expect(a.totalDamage).toBe(b.totalDamage);
  });

  it('奇数场交换场地 → index 0 与 1 的 byUnit 归属不同', () => {
    const even = runOnePlanBattle(cfg, opts, 0);
    const odd = runOnePlanBattle(cfg, opts, 1);
    expect(JSON.stringify(even.byUnit)).not.toBe(JSON.stringify(odd.byUnit));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/advisor_runplan.test.ts`
Expected: FAIL —— `runOnePlanBattle is not a function`。

- [ ] **Step 3: 实现（纯提取）**

打开 `web/simExpectation.ts`，在 `simExpectationSteps` 内部找到「按 index 跑一场并取和」的那一段（含 `baseSeed + index` 种子、奇数场交换场地、`coreDamageOf` / `first3Damage` 取和、木桩 `inertSides` 配置），**原样**提成模块级函数并在生成器里改调它；字段与生成器构造 `FinalRow` 时所用的一致，**不要裁剪**。

```ts
// web/simExpectation.ts（新增导出；函数体 = 从生成器里搬出来的那一段，逐行照搬）
export interface PlanBattleRaw {
  coreDamage: number; coreFirst3: number; totalDamage: number;
  byUnit: unknown; bySkill: unknown; wiped: boolean;
}

export function runOnePlanBattle(cfg: ViewCfg, opts: SimExpectOptions, index: number): PlanBattleRaw {
  // ← 这里放生成器里搬出来的那段（不改任何常量、不改种子写法、不改交换场地条件）
}
```

- [ ] **Step 4: 跑 L2 全量 + 新测试，确认行为不变**

Run: `npx vitest run tests/sim_expectation.test.ts tests/advisor_runplan.test.ts`
Expected: `sim_expectation.test.ts` **42 passed**（一个不许变），新文件 2 passed。

- [ ] **Step 5: 提交**

```bash
git add web/simExpectation.ts tests/advisor_runplan.test.ts
git commit -m "refactor(simExpectation): 抽出 runOnePlanBattle（口径单源，行为不变）"
```

---

### Task 3: 工具注册表 + 一期六个工具 + 预算护栏

> **2026-09-29 修订**：工具数已从 6 扩到 **11**（`hero_detail` / `list_skills` / `simulate_many` / **`optimize_skills`** / **`optimize_mates`**），
> 其中 L2/L3 两个搜索**提前到一期**（用户拍板："AI 就该调 L2/L3，不该自己一个个翻战法"）。
> 落地实况与验证见 `docs/AI配将顾问-设计.md` 文末的「切片一补丁 1/2/3」；本节下面的六个工具是**初始形态**。

**Files:**
- Create: `web/advisor/tools.ts`
- Create: `tests/advisor_tools.test.ts`

**Interfaces:**
- Consumes：`gate.validateAdvisorPlan`（Task 5 提供；**本任务先按签名调用并提供一个临时 imp 断言占位不可行 → 故本任务先行实现 `validateAdvisorPlan` 的最小版**，Task 5 再补齐三关的另两关）

> 顺序修正：`validate_plan` 工具依赖合法性校验，所以把 `gate.ts` 的**关 1** 提前到本任务实现（文件同时创建），Task 5 只补关 2 / 关 3 —— 避免出现"引用了还没写的函数"。

- Produces：
  - `interface ToolCtx { deps: AdvisorDeps; budget: BudgetState; simulateRun: typeof runOnePlanBattle; tables: ScanTables }`
  - `interface AdvisorDeps { getConfig(): ViewCfg; runPlan(plan: AdvisorPlan, runs: number, seed: number): ToolResultData; searchHeroes(q: string): Array<{ id: string; name: string }>; searchSkills(q: string): Array<{ id: string; name: string }>; skillDetail(id: string): unknown }`
  - `estimatePlanBattles(runs: number): number`、`chargeBudget(state, cost, now): void`（超限抛 `BudgetExceeded`）
  - `createTools(): ToolSpec[]`、`runTool(name, args, ctx): Promise<ToolResult>`
  - `makeCtx(opts: { fakeRuns?: boolean; coreDamage?: number; budget?: Partial<Budget> }): ToolCtx` —— **生产与测试共用**；仅当 `fakeRuns: true` 时额外挂上测试专用字段 `ctx.deps.__plan`（一份默认合法方案）/ `__planWith(names: string[])`（按武将名拼方案），代码里以 `// 仅测试：` 注释标明
  - `aggregate(values: number[]): { mean: number; sd: number; halfWidth: number; min: number; max: number; median: number }`

- [ ] **Step 1: 写失败测试（工具契约 + 预算 + 拒收）**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { initHeroDB } from '../src/data/heroes';
import { MAIN_SKILL_IDS, SLOTTED_HEROES } from '../web/heroes';
import { LEARNABLE_SKILL_IDS } from '../web/teamConfig';
import { createTools, makeCtx, runTool } from '../web/advisor/tools';
import { DEFAULT_DUMMY, BudgetExceeded, type AdvisorPlan } from '../web/advisor/types';

beforeAll(async () => { await initHeroDB(); });

/** 按名/按 id 拼一个 AdvisorPlan（三名武将，缺位留空） */
function planWith(heroIds: string[], skills: string[][] = []): AdvisorPlan {
  const positions = ['大营', '中军', '前锋'] as const;
  return {
    slots: heroIds.map((heroId, i) => ({ position: positions[i], heroId, level: 40, skillIds: skills[i] ?? [] })),
    coreUnitIds: [],
    dummy: { ...DEFAULT_DUMMY },
  };
}

/** 从库里找一对「同 mutualExclusionGroup」的武将（如 赵云 / SP赵云） */
function findMutualPair(): [string, string] {
  const byGroup = new Map<string, string[]>();
  for (const h of SLOTTED_HEROES) {
    const g = (h as { mutualExclusionGroup?: string }).mutualExclusionGroup;
    if (!g) continue;
    byGroup.set(g, [...(byGroup.get(g) ?? []), h.id]);
  }
  const first = [...byGroup.values()].find((ids) => ids.length >= 2);
  if (!first) throw new Error('库里没有互斥组（测试前置不成立）');
  return [first[0], first[1]];
}

describe('advisor tools', () => {
  it('六个一期工具都在注册表里', () => {
    expect(createTools().map((t) => t.name).sort()).toEqual(
      ['get_config', 'search_hero', 'search_skill', 'simulate', 'skill_detail', 'validate_plan']);
  });

  it('每个工具都有 name/description/schema/cost', () => {
    for (const t of createTools()) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.schema).toBeTruthy();
      expect(typeof t.run).toBe('function');
    }
  });

  it('simulate 的 runs 超上限 200 直接拒绝', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    await expect(runTool('simulate', { plan: ctx.deps.__plan, runs: 9999 }, ctx)).rejects.toThrow(/runs/);
  });

  it('预算超限抛 BudgetExceeded（拒绝执行，不是静默截断）', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxBattles: 10, maxMs: 10_000, maxCalls: 8 } });
    await expect(runTool('simulate', { plan: ctx.deps.__plan, runs: 20 }, ctx)).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it('validate_plan 拒收：同队互斥（赵云 + SP赵云）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const r = await runTool('validate_plan', { plan: ctx.deps.__planWith(['赵云', 'SP赵云']) }, ctx);
    expect(r.data).toMatchObject({ ok: false });
    expect(JSON.stringify(r.data)).toContain('mutual');
  });

  it('validate_plan 拒收：同队互斥（同 mutualExclusionGroup 的两将同队）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const pair = findMutualPair();                       // 见下方测试工具：从 SLOTTED_HEROES 里找同组两将
    const r = await runTool('validate_plan', { plan: planWith([pair[0], pair[1]]) }, ctx);
    expect(r.data).toMatchObject({ ok: false });
    expect(r.data.errors.map((e: any) => e.code)).toContain('mutual_exclusion');
  });

  it('validate_plan 拒收：全队战法重复（两将带同一可学战法）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const skill = LEARNABLE_SKILL_IDS[0];
    const r = await runTool('validate_plan', {
      plan: planWith([SLOTTED_HEROES[0].id, SLOTTED_HEROES[1].id], [[skill], [skill]]),
    }, ctx);
    expect(r.data.errors.map((e: any) => e.code)).toContain('duplicate_skill');
  });

  it('validate_plan 拒收：主战法放进可学槽', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const mainSkill = [...MAIN_SKILL_IDS][0];
    const r = await runTool('validate_plan', { plan: planWith([SLOTTED_HEROES[0].id], [[mainSkill]]) }, ctx);
    expect(r.data.errors.map((e: any) => e.code)).toContain('main_skill_in_slot');
  });
});
```

> `makeCtx({ fakeRuns: true })` 是**测试专用工厂**（写在 `web/advisor/tools.ts` 里并导出）：注入毫秒返回的假跑批 + 真 `web/data/heroes.json` 表；`deps.__plan` / `__planWith(names)` 是它的测试辅助字段（仅测试用，生产 `makeCtx` 不传这些）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/advisor_tools.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 tools.ts（注册表 + 六个工具 + 预算）**

要点（逐条落实，不许多做）：

1. `get_config`：`deps.getConfig()` → `{ plan: configToPlan(cfg), morale, seed }`；`summary` 一句话（例：`当前配置：大营 h574 / 中军 h672 / 前锋 h102003`）。
2. `validate_plan`：调 `gate.validateAdvisorPlan`（本任务实现关 1；见下），返回 `{ ok, errors, normalized }` + `summary`（`合法 / N 处问题：<首个 code>`）。
3. `simulate`：`runs` 默认 20、上限 200；循环 `i = 0..runs-1` 调 `ctx.simulateRun(cfgOf(plan), opts, i)` 取 `coreDamage`；`aggregate` 出统计。
   - `halfWidth` **照抄** `web/simExpectation.ts` 里算 `FinalRow.halfWidth` 的那行公式（实现前先在文件里搜 `halfWidth` 确认，禁止另立公式）。
   - 单方案没有榜首 → `tieWithBest: false`（写进 `summary`：`单方案无榜首，名次可信度见对比`）。
4. `search_hero` / `search_skill`：走 `deps.searchHeroes/searchSkills`；空结果如实返回 `[]`（**不许编造**）。
5. `skill_detail`：`deps.skillDetail(id)`；库里没有 → `{ found: false }`。
6. 预算：每次 `runTool` 前 `chargeBudget(ctx.budget, tool.cost, Date.now())`；超限抛 `BudgetExceeded`（loop 会把它转成 tool_result 回灌，见 Task 6）。
7. 每个 `ToolResult` 都带 `evidenceId`（`ev-${counter}-${name}`）与 `stats`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/advisor_tools.test.ts` → PASS。

- [ ] **Step 5: 提交**

```bash
git add web/advisor/tools.ts web/advisor/gate.ts tests/advisor_tools.test.ts
git commit -m "feat(advisor): 工具注册表与一期六个工具（含预算护栏）"
```

---

### Task 4: transport（OpenAI 兼容流式 + tool_calls 拼装 + 假 transport）

**Files:**
- Create: `web/advisor/transport.ts`
- Create: `tests/advisor_transport.test.ts`

**Interfaces:**
- Produces：
  - `type StreamEvent = { type: 'text'; delta: string } | { type: 'tool_calls'; calls: ToolCall[] } | { type: 'usage'; usage: TokenUsage } | { type: 'done' }`
  - `interface AdvisorTransport { chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> }`
  - `createBrowserTransport(settings: AdvisorSettings): AdvisorTransport`
  - `createFakeTransport(script: FakeStep[], opts?: { rejectTools?: boolean }): AdvisorTransport`（测试用；`rejectTools: true` 时：请求带 `tools` → 抛 `AdvisorError('format')`，不带 `tools` → 正常按脚本产出，用于测「无工具模式降级」）
  - `parseSSELine(line: string): unknown | null`
  - `assembleToolCalls(deltas: ToolCallDelta[]): ToolCall[]`
  - `class AdvisorError extends Error { code: 'auth' | 'network' | 'cors' | 'format'; }`

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { assembleToolCalls, createFakeTransport, parseSSELine } from '../web/advisor/transport';

describe('advisor transport', () => {
  it('parseSSELine 认 data: 行、忽略 [DONE] 与空行', () => {
    expect(parseSSELine('data: {"a":1}')).toEqual({ a: 1 });
    expect(parseSSELine('data: [DONE]')).toBeNull();
    expect(parseSSELine(': keep-alive')).toBeNull();
    expect(parseSSELine('')).toBeNull();
  });

  it('assembleToolCalls 按 index 拼接分片 arguments', () => {
    const calls = assembleToolCalls([
      { index: 0, id: 'c1', function: { name: 'simulate', arguments: '{"pl' } },
      { index: 0, function: { arguments: 'an":1}' } },
      { index: 1, id: 'c2', function: { name: 'get_config', arguments: '{}' } },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ id: 'c1', name: 'simulate', args: { plan: 1 } });
    expect(calls[1].name).toBe('get_config');
  });

  it('assembleToolCalls 遇到坏 JSON 抛 format 类错误（不静默吞）', () => {
    expect(() => assembleToolCalls([{ index: 0, id: 'c1', function: { name: 'x', arguments: '{oops' } }]))
      .toThrowError(/format|JSON/);
  });

  it('createFakeTransport 按脚本产出事件（供 loop 测试用）', async () => {
    const t = createFakeTransport([{ text: '你好' }, { calls: [{ id: 'c1', name: 'get_config', args: {} }] }]);
    const out = [];
    for await (const e of t.chat({ messages: [], tools: [] })) out.push(e.type);
    expect(out).toContain('text');
    expect(out).toContain('tool_calls');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `npx vitest run tests/advisor_transport.test.ts` FAIL。

- [ ] **Step 3: 实现**

要点：

1. `createBrowserTransport`：`POST ${baseUrl}/chat/completions`，body `{ model, messages, tools, stream: true }`，`Authorization: Bearer ${key}`；用 `fetch` + `response.body.getReader()` 读流，按 `\n` 切行 → `parseSSELine` → 把 `choices[0].delta.content` 转 `text` 事件、`delta.tool_calls` 累积后转 `tool_calls` 事件、`usage` 转 `usage` 事件。
2. **错误分类**：HTTP 401/403 → `AdvisorError('auth')`；`TypeError: Failed to fetch` → `AdvisorError('cors')`（文案提示可能是 CORS，给本地代理方案）；其它非 2xx → `network`；SSE/JSON 解析失败 → `format`。
3. `createFakeTransport(script)`：脚本元素 `{ text?: string | ((req: ChatRequest) => string); texts?: string[]; calls?: ToolCall[]; usage?: TokenUsage; error?: string }`，逐个 yield（`texts` 为落地补充：同一次响应里吐多段，用于测流式增量拼接）；`error` 元素抛 `AdvisorError('network')`（供 loop 测重试/收口）。**`text` 支持函数**：测试里据此从最后一条 tool 消息里读出真实 `evidenceId` 再拼终答（否则方案无法引用真实证据）。
4. 不做重试（重试由 loop 决定）；不做 tool 执行（loop 的事）。

- [ ] **Step 4: 跑测试确认通过** → PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add web/advisor/transport.ts tests/advisor_transport.test.ts
git commit -m "feat(advisor): OpenAI 兼容流式 transport 与假 transport"
```

---

### Task 5: 校验门关 2 / 关 3（数字溯源 + 标准口径复算）

**Files:**
- Modify: `web/advisor/gate.ts`（Task 3 已创建并实现关 1）
- Create: `tests/advisor_gate.test.ts`

**Interfaces:**
- Consumes：`ToolCallRecord`（Task 1）、`runOnePlanBattle`（Task 2，经 `ctx.simulateRun` 注入）
- Produces：
  - `const TOLERANCE_REL = 0.005`、`const TOLERANCE_ABS = 1`
  - `withinTolerance(claimed: number, actual: number): boolean`
  - `verifyClaims(answer: string, trace: ToolCallRecord[]): { ok: boolean; failures: Array<{ value: number; evidenceId: string; reason: string }> }`
  - `verifyPlanEvidence(plan: ProposedPlan, trace: ToolCallRecord[]): { ok: boolean; reason?: string }` —— **一个证据都不带的方案 = 未验证**（`evidenceIds` 为空 → `ok: false`）
  - `const ADVISOR_VERIFY_SEED = 20260929`、`const ADVISOR_VERIFY_RUNS = 20`
  - `recomputePlan(plan: AdvisorPlan, ctx: ToolCtx): { mean: number; halfWidth: number; runs: number; seed: number }`
  - `judgeRecompute(search: { mean: number; halfWidth: number }, verify: { mean: number; halfWidth: number }): 'consistent' | 'sensitive'`
  - `decideApply(v: { legal: boolean; verified: boolean; recomputed: boolean }): { enabled: boolean; reason?: string }`

- [ ] **Step 1: 写失败测试（spec §9 的四条，逐条一个用例）**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { decideApply, judgeRecompute, recomputePlan, verifyClaims, verifyPlanEvidence, withinTolerance } from '../web/advisor/gate';
import { makeCtx } from '../web/advisor/tools';

const rec = (evidenceId: string, coreDamage: number) => ({
  evidenceId, name: 'simulate', args: {}, summary: 's', stats: { battles: 20, ms: 100, seed: 20260929 },
  data: { mean: coreDamage, halfWidth: 100 },
});

describe('advisor gate', () => {
  it('① 伪造 evidenceId → 未验证 + 禁用应用', () => {
    const r = verifyClaims('该方案期望 26500[[ev-9]]', [rec('ev-1', 26500)]);
    expect(r.ok).toBe(false);
    expect(decideApply({ legal: true, verified: r.ok, recomputed: true }).enabled).toBe(false);
  });

  it('② 数字对不上 → 未验证（26,500 vs 31,000）', () => {
    expect(verifyClaims('期望 31000[[ev-1]]', [rec('ev-1', 26500)]).ok).toBe(false);
  });

  it('③ 容差边界：26,500 写成 2.65 万通过；差 0.5% 内通过；超出不通过', () => {
    expect(withinTolerance(26500, 26500)).toBe(true);
    expect(withinTolerance(Math.round(26500 * 1.004), 26500)).toBe(true);
    expect(withinTolerance(Math.round(26500 * 1.02), 26500)).toBe(false);
    expect(verifyClaims('期望 26500[[ev-1]]', [rec('ev-1', 26500)]).ok).toBe(true);
  });

  it('④ 合法但未验证 → 仍不给应用（三条缺一不可）', () => {
    expect(decideApply({ legal: true, verified: false, recomputed: true })).toMatchObject({ enabled: false });
    expect(decideApply({ legal: false, verified: true, recomputed: true })).toMatchObject({ enabled: false });
    expect(decideApply({ legal: true, verified: true, recomputed: false })).toMatchObject({ enabled: false });
    expect(decideApply({ legal: true, verified: true, recomputed: true }).enabled).toBe(true);
  });

  it('方案不带证据 → 未验证；带不存在的证据 → 未验证；带真证据 → 通过', () => {
    const trace = [rec('ev-1', 26500)];
    const mk = (ids: string[]) => ({ title: 'A', plan: {} as any, evidenceIds: ids });
    expect(verifyPlanEvidence(mk([]), trace)).toMatchObject({ ok: false });
    expect(verifyPlanEvidence(mk(['ev-nope']), trace)).toMatchObject({ ok: false });
    expect(verifyPlanEvidence(mk(['ev-1']), trace)).toMatchObject({ ok: true });
  });

  it('关 3：搜索用 5 场造的漂亮结果 vs 标准口径复算 → 标 sensitive', () => {
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 30000 });          // 复算得 30000
    const v = recomputePlan(ctx.deps.__plan, ctx);
    expect(v).toMatchObject({ runs: 20, seed: 20260929 });
    expect(judgeRecompute({ mean: 60000, halfWidth: 500 }, v)).toBe('sensitive');   // 差一倍 → 对口径敏感
    expect(judgeRecompute({ mean: 30100, halfWidth: 2000 }, v)).toBe('consistent'); // 区间重叠 → 一致
  });

  it('collectNumbers 深度遍历 data 取全部数字（含嵌套与数组）', () => {
    expect(collectNumbers({ a: 1, b: { c: [2, '3', 'x'] }, d: null })).toEqual([1, 2, 3]);
  });

  it('cfgOf 把 AdvisorPlan 映射成 ViewCfg，三名武将落在对应站位', () => {
    const ctx = makeCtx({ fakeRuns: true });
    const cfg = cfgOf(ctx.deps.__plan);
    expect(cfg.slots).toHaveLength(3);
    expect(cfg.slots.map((s: any) => s.position)).toEqual(['大营', '中军', '前锋']);
    expect(cfg.slots[0].heroId).toBe(ctx.deps.__plan.slots[0].heroId);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `npx vitest run tests/advisor_gate.test.ts` FAIL。

- [ ] **Step 3: 实现**

```ts
// web/advisor/gate.ts（新增部分）
export const TOLERANCE_REL = 0.005;
export const TOLERANCE_ABS = 1;
export const ADVISOR_VERIFY_SEED = 20260929;
export const ADVISOR_VERIFY_RUNS = 20;

export function withinTolerance(claimed: number, actual: number): boolean {
  return Math.abs(claimed - actual) <= Math.max(TOLERANCE_REL * Math.abs(actual), TOLERANCE_ABS);
}

/** 回答里的数字引用格式：值 + [[evidenceId]]（系统提示词里写死，见 loop.ts） */
export function verifyClaims(answer: string, trace: ToolCallRecord[]) {
  const failures: Array<{ value: number; evidenceId: string; reason: string }> = [];
  const re = /(-?\d[\d,]*(?:\.\d+)?)\s*\[\[([^\]]+)\]\]/g;
  for (const m of answer.matchAll(re)) {
    const value = Number(m[1].replace(/,/g, ''));
    const id = m[2];
    const hit = trace.find((t) => t.evidenceId === id);
    if (!hit) { failures.push({ value, evidenceId: id, reason: 'evidenceId 不存在于本轮 trace' }); continue; }
    const nums = collectNumbers(hit.data);       // 深度遍历 data 取全部数字
    if (!nums.some((n) => withinTolerance(value, n))) {
      failures.push({ value, evidenceId: id, reason: '该次工具结果里找不到这个数字' });
    }
  }
  return { ok: failures.length === 0, failures };
}

export function recomputePlan(plan: AdvisorPlan, ctx: ToolCtx) {
  const runs = ADVISOR_VERIFY_RUNS;
  const values = Array.from({ length: runs }, (_, i) => ctx.simulateRun(cfgOf(plan), simOpts(ctx), i).coreDamage);
  const a = aggregate(values);
  return { mean: a.mean, halfWidth: a.halfWidth, runs, seed: ADVISOR_VERIFY_SEED };
}

export function judgeRecompute(search: { mean: number; halfWidth: number }, verify: { mean: number; halfWidth: number }) {
  const overlap = Math.abs(search.mean - verify.mean) <= search.halfWidth + verify.halfWidth;
  return overlap ? 'consistent' as const : 'sensitive' as const;
}

export function decideApply(v: { legal: boolean; verified: boolean; recomputed: boolean }) {
  if (!v.legal) return { enabled: false, reason: '方案不合法（见错误清单）' };
  if (!v.verified) return { enabled: false, reason: '有数字无法追溯（标「未验证」）' };
  if (!v.recomputed) return { enabled: false, reason: '标准口径复算未完成' };
  return { enabled: true };
}
```

> `cfgOf(plan)`（`AdvisorPlan → ViewCfg`）与 `simOpts(ctx)` 写在 `gate.ts` 内部：前者把 3 个槽位映射到 `ViewCfg`（**站位映射照 `web/teamConfig.ts:42` 的 `ViewCfg` 字段**，实现前先读该接口；`cfgOf` 与 `collectNumbers` 均导出以便上面的直接用例调用），后者固定 `baseSeed = ADVISOR_VERIFY_SEED`、木桩取 `DEFAULT_DUMMY`。

- [ ] **Step 4: 跑测试确认通过** → PASS（5 passed）。

- [ ] **Step 5: 提交**

```bash
git add web/advisor/gate.ts tests/advisor_gate.test.ts
git commit -m "feat(advisor): 校验门关 2/关 3（数字溯源 + 标准口径复算）"
```

---

### Task 6: 对话循环 loop（含系统提示词、trace、取消、错误回灌）

**Files:**
- Create: `web/advisor/loop.ts`
- Create: `tests/advisor_loop.test.ts`

**Interfaces:**
- Consumes：`AdvisorTransport`（Task 4）、`runTool` / `makeCtx`（Task 3）、`verifyClaims` / `decideApply`（Task 5）
- Produces：
  - `const SYSTEM_PROMPT: string`（spec §4 六条硬规则逐条落成文本）
  - `interface TurnInput { userText: string; ctx: ToolCtx; transport: AdvisorTransport; budget?: Budget; signal?: AbortSignal; onEvent?(e: AdvisorEvent): void }`
  - `runAdvisorTurn(input: TurnInput): Promise<AdvisorTurn>`
  - `type AdvisorEvent = { type: 'delta'; text: string } | { type: 'tool_start'; name: string } | { type: 'tool_end'; name: string; ms: number; battles: number } | { type: 'done' }`

- [ ] **Step 1: 写失败测试（假 transport 喂脚本）**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { runAdvisorTurn } from '../web/advisor/loop';
import { createFakeTransport } from '../web/advisor/transport';
import { makeCtx } from '../web/advisor/tools';

const turn = (script: any[], userText = '帮我看看这队') =>
  runAdvisorTurn({ userText, ctx: makeCtx({ fakeRuns: true }), transport: createFakeTransport(script) });

describe('advisor loop', () => {
  it('纯文本回答：无工具调用 → 一轮结束，answer 拼接流式增量', async () => {
    const t = await turn([{ text: '先' }, { text: '说结论' }]);
    expect(t.answer).toBe('先说结论');
    expect(t.toolCalls).toHaveLength(0);
  });

  it('工具分支：调用 → 执行 → 结果回灌 → 出终答（trace 记下 evidenceId）', async () => {
    const t = await turn([
      { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
      { text: '收到了配置' },
    ]);
    expect(t.toolCalls).toHaveLength(1);
    expect(t.toolCalls[0].name).toBe('get_config');
    expect(t.toolCalls[0].evidenceId).toMatch(/^ev-/);
  });

  it('工具报错 → 作为 tool_result 回灌（最多 2 次自纠）', async () => {
    const t = await turn([
      { calls: [{ id: 'c1', name: 'validate_plan', args: { plan: { slots: 'bad' } } }] },
      { calls: [{ id: 'c2', name: 'validate_plan', args: { plan: { slots: 'bad' } } }] },
      { calls: [{ id: 'c3', name: 'validate_plan', args: { plan: { slots: 'bad' } } }] },
      { text: '我改用合法方案' },
    ]);
    expect(t.toolCalls.filter((c) => c.name === 'validate_plan').length).toBeLessThanOrEqual(3);
    expect(t.answer).toContain('合法');
  });

  it('超预算 → 不再执行工具，把拒绝原因回灌并收口', async () => {
    const ctx = makeCtx({ fakeRuns: true, budget: { maxBattles: 0, maxMs: 1000, maxCalls: 8 } });
    const t = await runAdvisorTurn({
      userText: 'x', ctx, transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'simulate', args: { plan: ctx.deps.__plan, runs: 20 } }] },
        { text: '预算不够，先不跑' },
      ]),
    });
    expect(t.answer).toContain('预算');
  });

  it('取消：abort 后 turn 抛出 AbortError 且不再执行工具', async () => {
    const ac = new AbortController();
    const p = runAdvisorTurn({ userText: 'x', ctx: makeCtx({ fakeRuns: true }), transport: createFakeTransport([{ text: 'a' }, { text: 'b' }]), signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });

  it('无工具模式降级：厂商拒绝 tools → 去掉 tools 重试一次，turn.degraded = true', async () => {
    const t = await runAdvisorTurn({
      userText: '这队为什么弱',
      ctx: makeCtx({ fakeRuns: true }),
      transport: createFakeTransport([{ text: '我只能基于已有结果解释' }], { rejectTools: true }),
    });
    expect(t.degraded).toBe(true);
    expect(t.toolCalls).toHaveLength(0);
    expect(t.answer).toContain('解释');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

要点：

1. `SYSTEM_PROMPT` 逐条落 spec §4（六条），并额外写明两件事：① **数字引用格式** `数字紧跟 [[evidenceId]]`（`verifyClaims` 的正则依赖它），不得复述工具未返回的数字；② **方案输出格式** —— 结论用自然语言，方案必须放进一个围栏 ```json 块 `{ "plans": [ { "title": "...", "plan": {...}, "evidenceIds": ["ev-..."] } ] }`（`parsePlans` 唯一认这个口）。
2. 循环：`messages = [system, ...history, user]` → `transport.chat` 流式消费 → 若本轮出现 `tool_calls`：逐个 `runTool`（try/catch；`BudgetExceeded` / 工具错误都转成 `{ role: 'tool', content: JSON.stringify({ error }) }` 回灌）→ 再请求一次；**最多 8 次工具调用 / 6 轮**，超限即要求收口（追加一条 user 消息「已达本轮上限，请基于已有结果作答」）。
3. 每次成功工具执行 → push `ToolCallRecord`（含 `evidenceId` / `stats`）。
4. 终答后：`parsePlans(answer)` → `turn.plans` 与显示用 `turn.answer`；`verdict.verified` = `verifyClaims(answer, trace).ok` **且** 每个方案的 `verifyPlanEvidence(plan, trace).ok`；有方案时 `verdict.legal` = `validateAdvisorPlan(...).ok`、`verdict.recomputed` = `recomputePlan(...)` 已执行；无方案时 `legal`/`recomputed` 记 true，但 `apply` 因"没有方案"仍然禁用（`decideApply` 之外由 `view.ts` 判空）。
5. `signal` 在每轮请求与每次工具执行前检查 `throwIfAborted()`。
6. **无工具模式降级**（spec §8）：若 `transport.chat` 抛 `AdvisorError('format')` **且本次请求带了 `tools`** → 去掉 `tools` 重试一次并置 `turn.degraded = true`（UI 显示「该模型不支持工具调用，只能解释已有结果」）；重试仍失败 → 原样抛出，由 Task 8 的 UI 显示错误。

- [ ] **Step 4: 跑测试确认通过** → PASS（5 passed）。

- [ ] **Step 5: 提交**

```bash
git add web/advisor/loop.ts tests/advisor_loop.test.ts
git commit -m "feat(advisor): 对话循环（系统提示词 / trace / 预算 / 取消）"
```

---

### Task 7: 跑批缓存 + 会话与设置持久化

**Files:**
- Create: `web/advisor/cache.ts`
- Create: `tests/advisor_cache.test.ts`

**Interfaces:**
- Consumes：`planKey`（Task 1）
- Produces：
  - `const SETTINGS_KEY = 'dsh-advisor-settings-v1'`、`TURNS_KEY = 'dsh-advisor-turns-v1'`、`CACHE_KEY = 'dsh-advisor-cache-v1'`
  - `interface AdvisorSettings { baseUrl: string; model: string; key: string }`
  - `loadSettings(): AdvisorSettings` / `saveSettings(s): void`
  - `loadTurns(): AdvisorTurn[]` / `saveTurns(list): void`（上限 20 轮，先进先出）
  - `getCached(key: string): ToolResult | null` / `putCached(key: string, r: ToolResult): void`（上限 200 条，超限丢最旧）

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_DUMMY, planKey, type AdvisorPlan } from '../web/advisor/types';
import { CACHE_KEY, getCached, loadSettings, loadTurns, putCached, saveSettings, saveTurns } from '../web/advisor/cache';

const plan: AdvisorPlan = { slots: [{ position: '大营', heroId: 'h574', level: 40, skillIds: [] }], coreUnitIds: [], dummy: DEFAULT_DUMMY };
const key = planKey(plan, 20, 20260929);

beforeEach(() => localStorage.clear());

describe('advisor cache', () => {
  it('命中缓存返回同一条（含 evidenceId），未命中返回 null', () => {
    putCached(key, { summary: 's', data: { mean: 1 }, evidenceId: 'ev-1', stats: { battles: 20, ms: 1, seed: 1 } });
    expect(getCached(key)?.evidenceId).toBe('ev-1');
    expect(getCached('nope')).toBeNull();
  });

  it('换场次 / 换种子 → 不同键（不误命中）', () => {
    putCached(key, { summary: 's', data: {}, evidenceId: 'ev-1', stats: { battles: 20, ms: 1, seed: 1 } });
    expect(getCached(planKey(plan, 200, 20260929))).toBeNull();
    expect(getCached(planKey(plan, 20, 1))).toBeNull();
  });

  it('设置读写往返（本机 key 明文，符合 spec §6）', () => {
    saveSettings({ baseUrl: 'https://api.example.com/v1', model: 'm', key: 'sk-x' });
    expect(loadSettings()).toMatchObject({ model: 'm', key: 'sk-x' });
    expect(localStorage.getItem(CACHE_KEY.replace('cache', 'settings'))).toBeTruthy();
  });

  it('轮次列表上限 20，超出丢最旧', () => {
    saveTurns(Array.from({ length: 25 }, (_, i) => ({ answer: `a${i}` } as any)));
    const list = loadTurns();
    expect(list).toHaveLength(20);
    expect(list[list.length - 1].answer).toBe('a24');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**：三把键的读写 + 上限裁剪（`Array.prototype.slice(-20)` 等），全部 try/catch（localStorage 满/被禁用时不炸，返回空）。

- [ ] **Step 4: 跑测试确认通过** → PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add web/advisor/cache.ts tests/advisor_cache.test.ts
git commit -m "feat(advisor): 跑批缓存与会话/设置持久化"
```

---

### Task 8: 抽屉 UI + 主站接线 + 端到端冒烟

**Files:**
- Create: `web/advisor/view.ts`
- Create: `web/advisor.css`
- Modify: `web/main.ts`（第 7 个 nav 入口 + `mountAdvisor`；**只加不改**）
- Modify: `web/smoke.test.ts`（`nav-link` 数量 6 → 7，含注释说明）
- Create: `web/advisorSmoke.test.ts`

**Interfaces:**
- Consumes：`runAdvisorTurn`（Task 6）、`cache`（Task 7）、`createBrowserTransport`（Task 4）
- Produces：`mountAdvisor(root: HTMLElement, opts?: { transport?: AdvisorTransport; ctx?: ToolCtx }): { open(): void; close(): void; destroy(): void; isOpen(): boolean; __send(text: string): Promise<void> }`（`opts` 仅在测试传入；生产走真实 transport + `makeCtx()`；`__send` 是测试专用入口，生产点「发送」按钮）

- [ ] **Step 1: 写失败测试（jsdom 端到端）**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeTransport } from './advisor/transport';

async function boot() {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
  const mod = await import('./main');
  mod.initApp(el);
  return mod;
}

describe('AI 顾问抽屉（端到端，假 transport）', () => {
  beforeEach(() => localStorage.clear());

  it('第 7 个入口存在，点击打开抽屉；ESC / 收起按钮可关闭', async () => {
    await boot();
    const nav = Array.from(document.querySelectorAll('.nav-link')) as HTMLElement[];
    expect(nav).toHaveLength(7);
    const entry = nav.find((n) => n.textContent === 'AI 顾问')!;
    entry.click();
    expect(document.querySelector('.advisor-drawer')).toBeTruthy();
    (document.querySelector('.advisor-close') as HTMLElement).click();
    expect(document.querySelector('.advisor-drawer.open')).toBeFalsy();
  });

  it('走一轮：出方案卡 → 卡上数字取自 tool.data（不是 LLM 复述）', async () => {
    await boot();
    const { mountAdvisor } = await import('./advisor/view');
    const { makeCtx } = await import('./advisor/tools');
    const view = mountAdvisor(document.getElementById('app')!, { transport: createFakeTransport([
      { calls: [{ id: 'c1', name: 'simulate', args: { plan: {}, runs: 20 } }] },
      { text: '方案：陆抗带危崖困军，期望 26500[[ev-1]]' },
    ]), ctx: makeCtx({ fakeRuns: true, coreDamage: 26500 }) });
    view.open();
    await view.__send('帮我配一队');                     // 测试专用入口（生产走输入框）
    const card = document.querySelector('.advisor-plan-card')!;
    expect(card.textContent).toContain('26,500');        // 来自 data
  });

  it('「应用」在未验证时禁用，并显示原因', async () => {
    await boot();
    const { mountAdvisor } = await import('./advisor/view');
    const { makeCtx } = await import('./advisor/tools');
    const view = mountAdvisor(document.getElementById('app')!, {
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'simulate', args: { plan: {}, runs: 20 } }] },
        { text: '该方案期望 99999[[ev-不存在]]' },          // 伪造 evidenceId
      ]),
      ctx: makeCtx({ fakeRuns: true, coreDamage: 26500 }),
    });
    view.open();
    await view.__send('帮我配一队');
    const btn = document.querySelector('.advisor-apply') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(document.querySelector('.advisor-verify-note')!.textContent).toContain('未验证');
  });

  it('合法 + 已验证 + 已复算 → 点「应用」写回配将区（槽位武将真的变了）', async () => {
    await boot();
    const { mountAdvisor } = await import('./advisor/view');
    const { makeCtx } = await import('./advisor/tools');
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 26500 });
    const plan = ctx.deps.__plan;
    const view = mountAdvisor(document.getElementById('app')!, {
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'simulate', args: { plan, runs: 20 } }] },
        {
          // 关键：从最后一条 tool 消息里读出**真实** evidenceId 再拼终答
          text: (req) => {
            const last = [...req.messages].reverse().find((m) => m.role === 'tool')!;
            const evidenceId = /"evidenceId":"([^"]+)"/.exec(last.content)![1];
            const payload = JSON.stringify({ plans: [{ title: '方案A', plan, evidenceIds: [evidenceId] }] });
            return `建议如下\n\`\`\`json\n${payload}\n\`\`\``;
          },
        },
      ]),
      ctx,
    });
    view.open();
    await view.__send('帮我配一队');
    const before = document.querySelector('.team-panel.red')!.textContent;
    (document.querySelector('.advisor-apply') as HTMLButtonElement).click();
    expect(document.querySelector('.team-panel.red')!.textContent).not.toBe(before);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `npx vitest run web/advisorSmoke.test.ts` FAIL。

- [ ] **Step 3: 实现**

1. `web/advisor.css`：抽屉 `position: absolute; right: 0; top: 0; bottom: 0; width: 400px; z-index: 40;`（**不重排三列**）；`.advisor-drawer.open` 显示；`<1100px` 媒体查询改全屏覆盖 + 顶部「对话 / 配将」tab；方案卡、进度条、错误态、设置区样式（配色只用主站既有 `--color-*` / `--gold*` 变量，与 `announcement.ts` 同一套）。
2. `view.ts`：`open/close/destroy/isOpen` + 输入框 + 发送 + 「取消」+ 成本行（工具调用次数 / 场次 / 秒 / token，token 取厂商 `usage` 累计，缺则显示「—」）+ 设置区（baseUrl/model/key 存 `cache.ts`）+ 方案卡渲染（**数字从 `ToolResult.data` 直读**）+ `应用` 按钮（`decideApply` 为 false 时 disabled 并显示 reason）+ `对比当前配置` 按钮（对现状跑一次同口径 `simulate`，与卡片并排显示差值与区间，只展示不改配置）+ 错误态（401 → 设置引导；`cors` → 代理脚本提示；`turn.degraded` → 顶部提示条「该模型不支持工具调用，只能解释已有结果」；数字核验失败 → 卡上红字「未验证」+ 失败原因）。
3. `web/main.ts`：顶栏 nav 列表加 `{ key: 'advisor', label: 'AI 顾问' }`；点击 → `mountAdvisor(app)`（若已挂载则 `open()`）；**不动其它任何逻辑**。
4. `web/smoke.test.ts`：`expect(document.querySelectorAll('.nav-link').length).toBe(7)`。

- [ ] **Step 4: 跑端到端 + 全量回归**

```bash
npx vitest run web/advisorSmoke.test.ts web/smoke.test.ts
npm test                      # 全量；golden 必须字节一致
npx tsc --noEmit && npx tsc --noEmit -p web/tsconfig.json
```

Expected：新测试全绿；`npm test` 与开工基线相比**只多不少**（新增用例）；两份 tsc clean。

- [ ] **Step 5: 真机自检（无头浏览器截图，照 `scripts/_optimize_shot.mjs` 的模式）**

新建 `scripts/_advisor_shot.mjs`：打开 `http://127.0.0.1:5173/` → 点「AI 顾问」→ 注入假 transport（`page.evaluate` 设置测试钩子）→ 截图三张（收起态 / 对话中 / 方案卡）+ 收集控制台报错，落 `./shots-advisor`。

Run: `node scripts/_advisor_shot.mjs http://127.0.0.1:5173/ ./shots-advisor`
Expected：三张图 + `PAGE PROBLEMS: none`；**用 `read_image` 逐张人眼复核**（抽屉不遮挡关键操作、1366×768 下不拥挤）。

- [ ] **Step 6: 提交**

```bash
git add web/advisor/view.ts web/advisor.css web/main.ts web/smoke.test.ts web/advisorSmoke.test.ts scripts/_advisor_shot.mjs
git commit -m "feat(advisor): 主站抽屉 UI 与入口（nav 6→7）"
```

---

### Task 9: CORS 兜底代理 + 文档收尾

**Files:**
- Create: `scripts/advisor_proxy.mjs`
- Modify: `AGENTS.md`（顶部活跃工具线加一行指向 `docs/AI配将顾问-设计.md`）
- Modify: `docs/AI配将顾问-设计.md`（文末补「一期落地记录」：实际文件、测试基线、已知偏差）

**Interfaces:**
- Produces：`node scripts/advisor_proxy.mjs --port 8787 --upstream https://api.deepseek.com/v1`（本地 CORS 代理；设置区 baseUrl 填 `http://127.0.0.1:8787/v1`）

- [ ] **Step 1: 写代理脚本**（几十行：`node:http` 起服务，转发 `POST /v1/chat/completions` 到 upstream，透传 `Authorization` 与流式响应，`Access-Control-Allow-Origin: *` + `OPTIONS` 预检）

- [ ] **Step 2: 手工验证（兜底脚本，不做自动化测试，如实记录）**

```bash
node scripts/advisor_proxy.mjs --port 8787 --upstream https://api.deepseek.com/v1 &
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS http://127.0.0.1:8787/v1/chat/completions   # 期望 204
```

- [ ] **Step 3: 文档收尾**：`AGENTS.md` 加一行；设计文档补落地记录（文件清单 / 测试基线 / 与设计的偏差，例如 `byUnit`/`bySkill` 一期是否已接）。

- [ ] **Step 4: 全量门禁 + 提交**

```bash
npm test && npx tsc --noEmit && npx tsc --noEmit -p web/tsconfig.json
git add scripts/advisor_proxy.mjs AGENTS.md docs/AI配将顾问-设计.md
git commit -m "docs(advisor): 一期落地记录与 CORS 兜底代理"
```

> 一期不部署主站 → **不写 `ANNOUNCEMENTS` 公告**；若日后随主站上线，按 `docs/公告栏维护.md` 补一条（版本号 +0.1）。

---

## 完成定义（一期 DoD）

1. `web/advisor/` 六个文件 + `advisor.css` 就位，主站只多一个入口（nav 7 个）。
2. spec §10 四条验收逐条有对应测试：数字逐字段一致 / 伪造 `evidenceId` 禁用应用 / 赵云+SP赵云被拦且可自纠 / 全量门禁绿。
3. `npm test` 全绿（相对开工基线只增不减）、`tsc` 两份 clean、`golden.json` 字节一致。
4. `scripts/_advisor_shot.mjs` 三张截图 + 控制台零报错，并已 `read_image` 人工复核。
5. 无任何 `src/engine/*`、`src/data/*` 改动。
