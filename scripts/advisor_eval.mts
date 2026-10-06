/**
 * AI 配将顾问 · 真模型评测跑分（离线评测在 `tests/advisor_eval.test.ts`）
 * ---------------------------------------------------------------------------
 * 用途：把 `web/advisor/evalCases.ts` 的用例逐条丢给**真模型**，按机器可判定的条目出记分卡。
 *     改提示词 / 加工具之后跑一遍，就知道是变好了还是变吵了（离线那层只证明系统防线，证明不了措辞质量）。
 *
 * 用法：
 *   ADVISOR_KEY=sk-xxx npx tsx scripts/advisor_eval.mts                      # 默认 deepseek + 快跑搜索
 *   ADVISOR_KEY=... ADVISOR_MODEL=deepseek-chat npx tsx scripts/advisor_eval.mts
 *   ADVISOR_KEY=... npx tsx scripts/advisor_eval.mts --full                  # 搜索用完整参数（慢，每例数十秒）
 *   npx tsx scripts/advisor_eval.mts --dry                                   # 不联网：只验证脚本与记分卡管线
 *   npx tsx scripts/advisor_eval.mts --only=offline-hero,degraded-mode       # 只跑指定用例
 *   ADVISOR_KEY=... npx tsx scripts/advisor_eval.mts --no-routing            # A/B 另一半：关掉工具面分档
 *
 * **A/B 口径（设计文档 §16.6）**：同一批用例跑两遍——开着分档一遍、加 `--no-routing` 一遍，
 * 比三件事：通过率 / 工具调用次数 / **「人肉搜索」占比**（逐个 skill_detail 的调用数）。
 * 产物文件名带 `-norouting` 后缀，两份不会互相覆盖。
 *
 * 产物：`docs/顾问评测记分卡-<时间戳>.md`（人看）+ 同名 `.json`（机器比对）
 * 注意：**key 只从环境变量读，不落盘、不进日志**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADVISOR_EVAL_CASES, reportOf, scorecard } from '../web/advisor/evalCases';
import { runAdvisorTurn } from '../web/advisor/loop';
import { createBrowserTransport, createFakeTransport, type AdvisorTransport } from '../web/advisor/transport';
import { makeCtx } from '../web/advisor/tools';
import { cfgOf } from '../web/advisor/gate';
import { DEFAULT_DUMMY, type AdvisorPlan, type AdvisorTurn } from '../web/advisor/types';
import { SLOTTED_HEROES } from '../web/heroes';

const argv = process.argv.slice(2);
const has = (f: string): boolean => argv.includes(f);
const valueOf = (f: string): string | undefined => argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);

const KEY = process.env.ADVISOR_KEY?.trim() ?? '';
const BASE_URL = process.env.ADVISOR_BASE_URL?.trim() || 'https://api.deepseek.com/v1';
const MODEL = process.env.ADVISOR_MODEL?.trim() || 'deepseek-chat';
const DRY = has('--dry');
const FULL = has('--full');
const NO_ROUTING = has('--no-routing') || process.env.ADVISOR_ROUTING === 'off';
/** 首轮锚定（S3）：默认**不开**——A/B 要测的是分档与引导本身；要连锚定一起测就加 --anchor */
const ANCHOR = has('--anchor');
/** 近距离引导（S2）：默认**开**；要分离"引导 vs 工具面"的贡献就加 --no-guide（2×2 对照） */
const NO_GUIDE = has('--no-guide') || process.env.ADVISOR_GUIDE === 'off';
/** 交付前自检（§16.22）：默认**开**；要量它值多少分就加 --no-selfcorrect 关掉 */
const NO_SELF_CORRECT = has('--no-selfcorrect') || process.env.ADVISOR_SELF_CORRECT === 'off';
const only = valueOf('--only')?.split(',').map((s) => s.trim());

if (!DRY && !KEY) {
  console.error('缺少 ADVISOR_KEY。用法：ADVISOR_KEY=sk-xxx npx tsx scripts/advisor_eval.mts（或加 --dry 只验证管线）');
  process.exit(2);
}

/** 评测用的基准队伍：上架池前三（合法、可复算） */
const plan: AdvisorPlan = {
  slots: SLOTTED_HEROES.slice(0, 3).map((h, i) => ({
    position: (['大营', '中军', '前锋'] as const)[i],
    heroId: h.id,
    level: 40,
    skillIds: [],
  })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
};

const cases = ADVISOR_EVAL_CASES.filter((c) => !only || only.includes(c.id));
if (!cases.length) {
  console.error(`--only=${only?.join(',')} 没有匹配到任何用例`);
  process.exit(2);
}
/**
 * 仅假传输用例（`fakeOnly`，如 `degraded-mode`）：它期望 `degraded: true`，而真模型**必然**支持工具调用
 * → 真跑必挂（2026-10-05 三条臂实测全挂）。真模型跑分跳过它，并把跳过如实写进记分卡头部，
 * 免得分母被一条永远不可能通过的用例污染（满分实际是 9/10，不是 10/10）。
 */
const skipped = DRY ? [] : cases.filter((c) => c.fakeOnly).map((c) => c.id);
const runCases = cases.filter((c) => DRY || !c.fakeOnly);
if (!runCases.length) {
  console.log(`没有可跑的用例：${skipped.join(', ')} 是**仅假传输用例**（真模型跑分跳过；加 --dry 可以看它们的判定）。`);
  process.exit(0);
}

const reports: Array<{ id: string; ask: string; pass: boolean; checks: Array<{ check: string; ok: boolean; detail: string }>; answer: string; tools: string[]; battles: number; tokens: number; ms: number }> = [];

console.log(`评测：${runCases.length} 条用例 · ${DRY ? '干跑（不联网）' : `${MODEL} @ ${BASE_URL}`} · 搜索${FULL ? '完整参数' : '快跑参数'} · 工具面分档${NO_ROUTING ? '关（A/B 对照）' : '开'} · 首轮锚定${ANCHOR ? '开' : '关'} · 近场引导${NO_GUIDE ? '关（A/B 对照）' : '开'} · 交付前自检${NO_SELF_CORRECT ? '关（A/B 对照）' : '开'}${skipped.length ? ` · 跳过仅假传输用例 ${skipped.join(',')}` : ''}\n`);

for (const c of runCases) {
  const ctx = makeCtx({
    deps: { getConfig: () => cfgOf(plan) },
    budget: { maxCalls: 20, maxBattles: 60000, maxTokens: 1000000 },
  });
  const transport: AdvisorTransport = DRY
    ? createFakeTransport([{ text: `（dry 干跑，未调用模型）这一条会被判失败，只用于验证记分卡管线：${c.id}` }])
    : createBrowserTransport({ baseUrl: BASE_URL, model: MODEL, key: KEY });

  const started = Date.now();
  let turn: AdvisorTurn | null = null;
  let failure = '';
  try {
    turn = await runAdvisorTurn({
      userText: c.ask,
      ctx,
      transport,
      ...(NO_ROUTING ? { noRouting: true } : {}),
      ...(ANCHOR ? { anchor: true } : {}),
      ...(NO_GUIDE ? { noGuide: true } : {}),
      ...(NO_SELF_CORRECT ? { noSelfCorrect: true } : {}),
    });
  } catch (e) {
    failure = (e as Error)?.message ?? String(e);
  }
  const ms = Date.now() - started;
  const tools = turn?.toolCalls.map((t) => t.name) ?? [];
  const toolsLine = tools.length ? tools.join(' → ') : '（没调工具）';
  const battles = ctx.budget.battles;
  const tokens = ctx.budget.tokens;

  if (!turn) {
    console.log(`✘ ${c.id}：调用失败 —— ${failure}`);
    reports.push({ id: c.id, ask: c.ask, pass: false, checks: [{ check: '跑通', ok: false, detail: failure }], answer: '', tools, battles, tokens, ms });
    continue;
  }
  const r = reportOf(c, turn);
  const failed = r.checks.filter((x) => !x.ok);
  console.log(
    `${r.pass ? '✔' : '✘'} ${c.id}（${tools.length} 次工具 / ${battles} 场 / ${tokens} token / ${(ms / 1000).toFixed(1)}s）${failed.length ? `\n    ✗ ${failed.map((f) => `${f.check}${f.detail ? ` —— ${f.detail}` : ''}`).join('\n    ✗ ')}` : ''}\n    工具：${toolsLine}`
  );
  reports.push({ id: c.id, ask: c.ask, pass: r.pass, checks: r.checks, answer: turn.answer, tools, battles, tokens, ms, ...(turn.selfCorrect?.length ? { selfCorrect: turn.selfCorrect } : {}) });
}

const s = scorecard(reports);
/** 「人肉搜索」信号（A/B 的关键指标之一）：逐个翻战法 = 应该去调 optimize_skills 的那种退化解 */
const skillDetailCalls = reports.reduce((n, r) => n + r.tools.filter((t) => t === 'skill_detail').length, 0);
const totalToolCalls = reports.reduce((n, r) => n + r.tools.length, 0);
/** 交付前自检（§16.22）触发了几个用例、一共补了几个数字——它是"行为开关"，要能从记分卡看出来 */
const selfCorrectCalls = reports.filter((r) => (r.selfCorrect?.length ?? 0) > 0).length;
const selfCorrectNumbers = reports.reduce((n, r) => n + (r.selfCorrect?.length ?? 0), 0);
const d = new Date();
const p2 = (n: number): string => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
// 干跑是管线自检，产物丢临时目录，别污染 docs/（真跑才写 docs/，可用 --out= 覆盖）
const outDir = valueOf('--out') ?? (DRY ? os.tmpdir() : 'docs');
fs.mkdirSync(outDir, { recursive: true });
/** 开关组合各写各的文件名，A/B/C 对照不会互相覆盖 */
const variant = `${DRY ? '-dry' : ''}${NO_ROUTING ? '-norouting' : ''}${ANCHOR ? '-anchor' : ''}${NO_GUIDE ? '-noguide' : ''}${NO_SELF_CORRECT ? '-noselfcorrect' : ''}`;
const mdPath = path.join(outDir, `顾问评测记分卡-${stamp}${variant}.md`);
const jsonPath = path.join(outDir, `顾问评测记分卡-${stamp}${variant}.json`);

const md = [
  `# AI 顾问评测记分卡（${stamp}）`,
  '',
  `- 模型：${DRY ? '（干跑，未调用模型）' : `${MODEL} @ ${BASE_URL}`}`,
  `- 搜索参数：${FULL ? '完整' : '快跑（coarseRuns=1 / finalRuns=20 / coarseTop=4）'}`,
  `- 工具面分档：**${NO_ROUTING ? '关（A/B 对照）' : '开'}**（设计文档 §16；另一半用 ${NO_ROUTING ? '去掉 --no-routing' : '--no-routing'} 跑）`,
  `- 首轮锚定（S3）：**${ANCHOR ? '开' : '关'}**（要测就加 --anchor；关着测的是分档与引导本身）`,
  `- 近场引导（S2）：**${NO_GUIDE ? '关（A/B 对照）' : '开'}**（要分离"引导 vs 工具面"就加 --no-guide）`,
  `- 交付前自检（§16.22）：**${NO_SELF_CORRECT ? '关（A/B 对照）' : '开'}**（裸报大数字 → 回灌一次、允许重答一轮）`,
  `- 自检触发：**${selfCorrectCalls}** 次${selfCorrectCalls ? `（补引用的数字共 ${selfCorrectNumbers} 个）` : ''}`,
  ...(skipped.length ? [`- 跳过仅假传输用例：${skipped.join(', ')}（真模型必然支持工具调用 → 期望的 degraded 拿不到；分母已扣除）`] : []),
  `- 结果：**${s.passed}/${s.cases} 用例通过**；检查项 ${s.checks - s.failedChecks}/${s.checks} 通过`,
  `- 工具调用：共 ${totalToolCalls} 次；其中「人肉搜索」信号（skill_detail）**${skillDetailCalls}** 次`,
  `- 基准队伍：${plan.slots.map((x) => x.heroId).join(' / ')}（木桩 防御 ${DEFAULT_DUMMY.defense} / 谋略 ${DEFAULT_DUMMY.strategy}）`,
  '- 口径：判分只覆盖机器可判定的条目（调了哪些工具 / 有没有方案 / 三关结论 / 裸报数 / 该说的边界）；**措辞质量仍要人看**。',
  '',
  '| 用例 | 通过 | 工具调用 | 场次 | token | 耗时 | 失败项 |',
  '|---|---|---|---|---|---|---|',
  ...reports.map(
    (r) =>
      `| ${r.id} | ${r.pass ? '✅' : '❌'} | ${r.tools.join(' → ') || '—'} | ${r.battles} | ${r.tokens} | ${(r.ms / 1000).toFixed(1)}s | ${
        r.checks.filter((c) => !c.ok).map((c) => c.check).join('；') || '—'
      } |`
  ),
  '',
  '## 逐条明细',
  ...reports.flatMap((r) => [
    `### ${r.id} ${r.pass ? '✅' : '❌'}`,
    `> 提问：${r.ask}`,
    '',
    ...r.checks.map((c) => `- ${c.ok ? '☑' : '☐'} ${c.check}${c.detail ? `（${c.detail}）` : ''}`),
    '',
    '**模型回答（节选 1200 字）**：',
    '',
    '```',
    r.answer.slice(0, 1200),
    '```',
    '',
  ]),
].join('\n');

fs.writeFileSync(mdPath, md, 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify({ when: stamp, model: MODEL, dry: DRY, full: FULL, noRouting: NO_ROUTING, anchor: ANCHOR, noGuide: NO_GUIDE, noSelfCorrect: NO_SELF_CORRECT, score: s, skillDetailCalls, totalToolCalls, selfCorrectCalls, selfCorrectNumbers, reports }, null, 2), 'utf8');

console.log(`\n记分卡：${s.passed}/${s.cases} 用例通过（检查项 ${s.checks - s.failedChecks}/${s.checks}）· 工具 ${totalToolCalls} 次 · skill_detail ${skillDetailCalls} 次 · 自检触发 ${selfCorrectCalls} 次`);
console.log(`写入：${mdPath} 与 ${jsonPath}`);
