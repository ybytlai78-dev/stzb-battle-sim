/**
 * AI 顾问 · 路由 A/B（**行为化 mock 模型**，内部脚本 `_` 前缀，S4）
 * ---------------------------------------------------------------------------
 * 为什么要有它：真模型对照要 `ADVISOR_KEY`（用户的额度），而"分档/锚定到底改不改变模型的工具选择"
 * 这件事可以先用**确定的假模型**走**真 loop** 量出来 —— 同一批评测用例、三种开关、两个性格：
 *
 *   persona=hand       「手搓型」：只要能拿到便宜的 `skill_detail` 就一个个翻（§3 记录的那条退化路）
 *   persona=obedient   「听话型」：近场引导说"要真跑搜索"且 `optimize_skills` 在手上 → 就用它
 *
 *   arm=full           全量工具面（= S1 之前的行为，`noRouting`）
 *   arm=tiered         分档（S1+S2 引导）
 *   arm=tiered+anchor  分档 + 首轮锚定（S3）
 *
 * 量的是**机制**：工具调用数 / `skill_detail` 次数（人肉搜索信号）/ `optimize_*` 次数 / 被分档门拒了几次 / 轮数。
 * ⚠️ 它**不能**替代真模型记分卡：假模型的行为是脚本写死的，只证明"门与引导真的改变了可走的路"，
 *    不证明 DeepSeek 在真实条件下会怎么选。真模型那一跑见设计文档 §16.13。
 *
 * 用法：npx tsx scripts/_advisor_route_ab.mts [--json 输出路径]
 */
import fs from 'node:fs';
import { ADVISOR_EVAL_CASES } from '../web/advisor/evalCases';
import { runAdvisorTurn, type AdvisorEvent } from '../web/advisor/loop';
import { makeCtx } from '../web/advisor/tools';
import type { AdvisorTransport, ChatRequest, StreamEvent } from '../web/advisor/transport';
import { cfgOf } from '../web/advisor/gate';
import { DEFAULT_DUMMY, type AdvisorPlan } from '../web/advisor/types';
import { SLOTTED_HEROES } from '../web/heroes';

const plan: AdvisorPlan = {
  slots: SLOTTED_HEROES.slice(0, 3).map((h, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId: h.id, level: 40, skillIds: [] })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
};

/** 假搜索（毫秒返回）：**绝不能让真搜索跑起来**（一次 L2 ≈ 8,000 场 / 60 秒） */
const fakeOptimizeSkills = async () => ({
  battles: 8062,
  ms: 57000,
  tiesWithBest: 0,
  rankAgreement: 0.8,
  wipedCombos: 0,
  candidateCount: 92,
  candidateSkipped: 3,
  matchLabel: '核心将',
  coreLabel: '核心将',
  noEmptySlot: false,
  combosCapped: false,
  finals: [
    {
      rank: 1,
      label: '危崖困军 + 计险远近',
      mean: 7317,
      halfWidth: 651,
      runs: 20,
      meanTotal: 15503,
      tieWithBest: false,
      wipedRuns: 0,
      picks: [],
      byUnit: [{ unit: 0, name: '核心将', mean: 7317, core: true }],
    },
  ],
});

type Persona = 'hand' | 'obedient';

interface MockState {
  firstTools: number;
  firstHadAnchorGuide: boolean;
}

/** 行为化 mock 传输：每次请求按"手上有什么工具 + 近场引导说了什么"决定下一步 */
function behavioural(persona: Persona, state: MockState): AdvisorTransport {
  let seq = 0;
  return {
    async *chat(req: ChatRequest): AsyncIterable<StreamEvent> {
      const names = req.tools.map((t) => t.name);
      const has = (n: string): boolean => names.includes(n);
      const guide = [...req.messages].reverse().find((m) => m.content.includes('<advisor_route>'))?.content ?? '';
      /** 已**成功**跑过的工具数（被拒的 role=tool 没有 evidenceId，不算） */
      const done = req.messages.filter((m) => m.role === 'tool' && m.content.includes('"evidenceId"')).length;
      if (state.firstTools === 0) {
        state.firstTools = names.length;
        state.firstHadAnchorGuide = guide.includes('首轮锚定');
      }
      const wantsSearch = /optimize_(winrate|skills|mates|both)/.test(guide);
      let pick: { name: string; args: unknown } | null = null;
      if (persona === 'obedient' && wantsSearch && has('optimize_skills') && done < 1) {
        pick = { name: 'optimize_skills', args: { plan } };
      } else if (persona === 'hand' && has('skill_detail') && done < 3) {
        pick = { name: 'skill_detail', args: { id: 'dashang_sanjun' } }; // 便宜路：一个个翻战法
      } else if (has('get_config') && done === 0) {
        pick = { name: 'get_config', args: {} };
      } else if (has('optimize_skills') && done < 2) {
        pick = { name: 'optimize_skills', args: { plan } };
      } else if (has('skill_detail') && done < 5) {
        pick = { name: 'skill_detail', args: { id: 'dashang_sanjun' } };
      }
      if (!pick) {
        yield { type: 'text', delta: '（mock）按现有信息作答。' };
        yield { type: 'done' };
        return;
      }
      seq += 1;
      yield { type: 'tool_calls', calls: [{ id: `c${seq}`, name: pick.name, args: pick.args }] };
      yield { type: 'done' };
    },
  };
}

const ARMS = [
  { key: 'full', opts: { noRouting: true } },
  { key: 'tiered', opts: {} },
  { key: 'tiered+anchor', opts: { anchor: true } },
] as const;

interface Stat {
  arm: string;
  persona: Persona;
  tools: number;
  skillDetail: number;
  optimize: number;
  rejected: number;
  rounds: number;
  firstTools: number;
  firstToolsMin: number;
  firstToolsMax: number;
}
const stats: Stat[] = [];

for (const arm of ARMS) {
  for (const persona of ['hand', 'obedient'] as Persona[]) {
    const acc: Stat = { arm: arm.key, persona, tools: 0, skillDetail: 0, optimize: 0, rejected: 0, rounds: 0, firstTools: 0, firstToolsMin: 0, firstToolsMax: 0 };
    for (const c of ADVISOR_EVAL_CASES) {
      const ctx = makeCtx({
        fakeRuns: true,
        deps: {
          getConfig: () => cfgOf(plan),
          optimizeSkills: fakeOptimizeSkills as never,
          optimizeMates: fakeOptimizeSkills as never,
        },
      });
      const events: AdvisorEvent[] = [];
      const state: MockState = { firstTools: 0, firstHadAnchorGuide: false };
      const t = await runAdvisorTurn({
        userText: c.ask,
        ctx,
        transport: behavioural(persona, state),
        taskText: `【本次会话的任务】${c.ask}`,
        onEvent: (e) => events.push(e),
        ...arm.opts,
      });
      acc.tools += t.toolCalls.length;
      acc.skillDetail += t.toolCalls.filter((x) => x.name === 'skill_detail').length;
      acc.optimize += t.toolCalls.filter((x) => x.name.startsWith('optimize_')).length;
      acc.rejected += events.filter((e) => e.type === 'tool_end' && Boolean((e as { error?: string }).error?.includes('未开放'))).length;
      acc.rounds += events.filter((e) => e.type === 'round').length;
      acc.firstTools += state.firstTools;
      acc.firstToolsMin = acc.firstToolsMin ? Math.min(acc.firstToolsMin, state.firstTools) : state.firstTools;
      acc.firstToolsMax = Math.max(acc.firstToolsMax, state.firstTools);
    }
    stats.push(acc);
  }
}

const n = ADVISOR_EVAL_CASES.length;
const pad = (s: string | number, w: number): string => {
  const str = String(s);
  let len = 0;
  for (const ch of str) len += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, w - len));
};
console.log(`评测用例 ${n} 条 × 2 种假模型 × 3 种开关（每格是该组合的**合计**）\n`);
console.log(`${pad('开关', 16)}${pad('假模型', 12)}${pad('工具调用', 10)}${pad('skill_detail', 13)}${pad('optimize_*', 12)}${pad('被门拒', 9)}${pad('轮数', 7)}${pad('首轮工具数', 13)}`);
console.log('-'.repeat(90));
for (const s of stats) {
  console.log(
    `${pad(s.arm, 16)}${pad(s.persona === 'hand' ? '手搓型' : '听话型', 12)}${pad(s.tools, 10)}${pad(s.skillDetail, 13)}${pad(s.optimize, 12)}${pad(s.rejected, 9)}${pad(s.rounds, 7)}${pad(`${s.firstToolsMin}~${s.firstToolsMax}`, 13)}`
  );
}

// 逐用例明细（分档臂）：档位与首轮工具数必须能逐条对上，否则"平均 18"这种数字没法解释
console.log('\n=== 逐用例（分档臂） ===');
console.log(`${pad('用例', 18)}${pad('档位', 20)}${pad('首轮工具数', 11)}${pad('手搓型 skill_detail', 20)}`);
console.log('-'.repeat(70));
for (const c of ADVISOR_EVAL_CASES) {
  const ctx = makeCtx({
    fakeRuns: true,
    deps: { getConfig: () => cfgOf(plan), optimizeSkills: fakeOptimizeSkills as never, optimizeMates: fakeOptimizeSkills as never },
  });
  const state: MockState = { firstTools: 0, firstHadAnchorGuide: false };
  const t = await runAdvisorTurn({ userText: c.ask, ctx, transport: behavioural('hand', state), taskText: `【本次会话的任务】${c.ask}` });
  console.log(
    `${pad(c.id, 18)}${pad((t.route?.tiers ?? []).join('+'), 20)}${pad(state.firstTools, 11)}${pad(t.toolCalls.filter((x) => x.name === 'skill_detail').length, 20)}`
  );
}

const outIdx = process.argv.indexOf('--json');
if (outIdx >= 0 && process.argv[outIdx + 1]) {
  fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify({ cases: n, stats }, null, 2), 'utf8');
  console.log(`\n写入：${process.argv[outIdx + 1]}`);
}
