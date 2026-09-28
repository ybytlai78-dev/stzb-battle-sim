/**
 * AI 配将顾问 · 离线评测（`web/advisor/evalCases.ts` 的用例目录 + 判分器）
 * ---------------------------------------------------------------------------
 * **这层能证明什么、不能证明什么**（别自欺）：
 *   ✅ 判分器本身可用（裸报数 / 幻觉词 / 该说的边界没说到 → 判失败）；
 *   ✅ 结构保证在"守规矩的模型"下成立（该调的工具调了、方案过三关、降级标出来、预算拦住）；
 *   ✅ **坏模型会被抓住**（编数字 → 关 2 不通过；不调工具就给方案 → 判失败）。
 *   ❌ 不能证明提示词的措辞质量——那要靠 `scripts/advisor_eval.mts` 拿真模型跑分（人看记分卡）。
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ADVISOR_EVAL_CASES, judgeTurn, reportOf, scorecard, uncitedBigNumbers, type AdvisorEvalCase } from '../web/advisor/evalCases';
import { runAdvisorTurn } from '../web/advisor/loop';
import { createFakeTransport, type ChatRequest } from '../web/advisor/transport';
import { makeCtx } from '../web/advisor/tools';
import { cfgOf } from '../web/advisor/gate';
import { DEFAULT_DUMMY, type AdvisorPlan, type AdvisorTurn } from '../web/advisor/types';
import { SLOTTED_HEROES } from '../web/heroes';

const caseOf = (id: string): AdvisorEvalCase => {
  const c = ADVISOR_EVAL_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`没有用例 ${id}`);
  return c;
};

const legalPlan = (): AdvisorPlan => ({
  slots: SLOTTED_HEROES.slice(0, 3).map((h, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId: h.id, level: 40, skillIds: [] })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
});

const ctxFor = (plan: AdvisorPlan, extra: NonNullable<Parameters<typeof makeCtx>[0]>['deps'] = {}) =>
  makeCtx({ fakeRuns: true, coreDamage: 7317, deps: { getConfig: () => cfgOf(plan), ...extra } });

/** 假搜索：毫秒返回一份带区间的榜单（离线评测用；真实搜索另有真接线测试） */
const fakeOptimizeSkills = async () =>
  ({
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
  }) as never;

/** 从最后一条 tool 消息里取真实 evidenceId（脚本据此写引用，关 2 才能核对） */
const lastEvidenceId = (req: ChatRequest): string => {
  const toolMsgs = req.messages.filter((m) => m.role === 'tool');
  return /"evidenceId":"([^"]+)"/.exec(toolMsgs[toolMsgs.length - 1]?.content ?? '')?.[1] ?? 'ev-unknown';
};

describe('评测集 · 走完整 loop 的用例（守规矩的模型）', () => {
  it('config-read：读配置优先，纯问答不给方案', async () => {
    const c = caseOf('config-read');
    const plan = legalPlan();
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(plan),
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
        { text: (req) => `现在是大营 / 中军 / 前锋三人在阵（见 [[${lastEvidenceId(req)}]]）。` },
      ]),
    });
    const r = reportOf(c, t);
    expect(r.checks.filter((x) => !x.ok)).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('diagnose-weak：真跑数据（simulate）且结论带证据、无裸报数', async () => {
    const c = caseOf('diagnose-weak');
    const plan = legalPlan();
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(plan),
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'simulate', args: { plan, runs: 20 } }] },
        { text: (req) => `真跑 20 场：核心将伤害期望 7317[[${lastEvidenceId(req)}]]。` },
      ]),
    });
    const r = reportOf(c, t);
    expect(r.checks.filter((x) => !x.ok)).toEqual([]);
  });

  it('optimize-skills：调 L2 搜索、出方案、三关通过（应用可用）、数字都带引用', async () => {
    const c = caseOf('optimize-skills');
    const plan = legalPlan();
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(plan, { optimizeSkills: fakeOptimizeSkills, estimateSkillBattles: () => 8062 }),
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'optimize_skills', args: { plan, finalRuns: 20 } }] },
        {
          text: (req) => {
            const id = lastEvidenceId(req);
            const payload = JSON.stringify({ plans: [{ title: '搜索榜第一', plan, evidenceIds: [id] }] });
            return [`搜完了：核心将伤害期望 7317 ±651（95% 半宽）[[${id}]]。`, '```json', payload, '```'].join('\n');
          },
        },
      ]),
    });
    const r = reportOf(c, t);
    expect(r.checks.filter((x) => !x.ok)).toEqual([]);
    expect(t.verdict.apply.enabled).toBe(true);
  });

  it('hero-unknown：库里没有就直说没有（不编造）', async () => {
    const c = caseOf('hero-unknown');
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(legalPlan()),
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'search_hero', args: { q: '赵子龙' } }] },
        { text: (req) => `没有匹配「赵子龙」的武将（[[${lastEvidenceId(req)}]] 是空结果）；库里的赵云叫「赵云」。` },
      ]),
    });
    const r = reportOf(c, t);
    expect(r.checks.filter((x) => !x.ok)).toEqual([]);
  });

  it('offline-hero：查档案 + 声明「已下架 / 数值偏低」', async () => {
    const c = caseOf('offline-hero');
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(legalPlan()),
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'hero_detail', args: { id: 'h704' } }] },
        { text: (req) => `文鸯目前是已下架状态，模拟数值会偏低，只能看方向（[[${lastEvidenceId(req)}]]）。` },
      ]),
    });
    const r = reportOf(c, t);
    expect(r.checks.filter((x) => !x.ok)).toEqual([]);
  });

  it('degraded-mode：模型不支持工具 → 标注降级，不许编数字', async () => {
    const c = caseOf('degraded-mode');
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(legalPlan()),
      transport: createFakeTransport([{ text: '这个我没有工具调用能力，跑不了模拟，只能讲方法：先看战法类型与出手位。' }], { rejectTools: true }),
    });
    expect(t.degraded).toBe(true);
    const r = reportOf(c, t);
    expect(r.checks.filter((x) => !x.ok)).toEqual([]);
  });
});

describe('评测集 · 坏模型会被抓住（系统防线）', () => {
  it('不调工具就报数字 → 关 2 不通过、应用禁用、裸报数被判失败', async () => {
    const c = caseOf('diagnose-weak');
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(legalPlan()),
      transport: createFakeTransport([{ text: '我估计核心将伤害期望在 26500 左右。' }]),
    });
    const checks = judgeTurn(c, t);
    expect(checks.find((x) => x.check.startsWith('调用了'))?.ok).toBe(false);
    expect(checks.find((x) => x.check.includes('大数字'))?.ok).toBe(false);
  });

  it('编证据编号 → 关 2 拦下 → 方案不可应用', async () => {
    const c = caseOf('optimize-skills');
    const plan = legalPlan();
    const t = await runAdvisorTurn({
      userText: c.ask,
      ctx: ctxFor(plan, { optimizeSkills: fakeOptimizeSkills, estimateSkillBattles: () => 8062 }),
      transport: createFakeTransport([
        { calls: [{ id: 'c1', name: 'optimize_skills', args: { plan } }] },
        {
          text: [
            '搜完了：核心将伤害期望 7317 ±651[[ev-999-optimize_skills]]。', // 伪造证据
            '```json',
            JSON.stringify({ plans: [{ title: '搜索榜第一', plan, evidenceIds: ['ev-999-optimize_skills'] }] }),
            '```',
          ].join('\n'),
        },
      ]),
    });
    expect(t.verdict.verified).toBe(false);
    expect(t.verdict.apply.enabled).toBe(false);
    // 判分器本身不看三关（那是另一组检查），这里断言系统确实拦住了
    const r = reportOf(c, t);
    expect(r.checks.find((x) => x.check.includes('「应用」可用'))?.ok).toBe(false);
  });
});

describe('评测集 · 判分器自检（口径级用例，构造 turn 判分）', () => {
  const emptyTurn = (answer: string, tools: string[] = []): AdvisorTurn => ({
    messages: [],
    toolCalls: tools.map((name, i) => ({
      evidenceId: `ev-${i + 1}-${name}`,
      name,
      args: {},
      summary: 's',
      data: {},
      stats: { battles: 0, ms: 0, seed: 1 },
    })),
    plans: [],
    checks: [],
    answer,
    verdict: { legal: true, verified: true, recomputed: true, apply: { enabled: false, reason: '没有方案' } },
  });

  it('optimize-mates：说了「基线/当前队友对照」才算过', () => {
    const c = caseOf('optimize-mates');
    expect(judgeTurn(c, emptyTurn('搜完了，榜首组合明显更强。', ['optimize_mates'])).find((x) => x.check.includes('基线'))?.ok).toBe(false);
    expect(judgeTurn(c, emptyTurn('比当前队友（基线）高 317。', ['optimize_mates'])).find((x) => x.check.includes('基线'))?.ok).toBe(true);
  });

  it('metric-ambiguity：必须区分木桩口径与实战口径', () => {
    const c = caseOf('metric-ambiguity');
    expect(judgeTurn(c, emptyTurn('最强就是这三个人。')).find((x) => x.check.includes('木桩'))?.ok).toBe(false);
    const good = judgeTurn(c, emptyTurn('打木桩的输出最强和实战最强是两回事，后者要跑 L4 胜率。'));
    expect(good.filter((x) => !x.ok)).toEqual([]);
  });

  it('boundary-control：必须声明控制型队友在木桩口径里量不出来', () => {
    const c = caseOf('boundary-control');
    expect(judgeTurn(c, emptyTurn('加控制型队友会更强。')).find((x) => x.check.includes('控制'))?.ok).toBe(true);
    expect(judgeTurn(c, emptyTurn('加控制型队友会更强。')).find((x) => x.check.includes('量不出'))?.ok).toBe(false);
  });

  it('budget-refuse：谎报「全部跑完」直接判失败', () => {
    const c = caseOf('budget-refuse');
    expect(judgeTurn(c, emptyTurn('已经跑完 100 万场，结论是最强搭配如下。')).find((x) => x.check.includes('没有幻觉'))?.ok).toBe(false);
    const good = judgeTurn(c, emptyTurn('这超了本轮场次上限（额度不够），我把搜索范围收窄到当前阵容再跑。'));
    expect(good.filter((x) => !x.ok)).toEqual([]);
  });

  it('裸报数检测：≥10000 且无 [[证据]] 才算裸报，种子/场次不算', () => {
    expect(uncitedBigNumbers('期望 26500，但没有引用')).toEqual(['26500']);
    expect(uncitedBigNumbers('期望 26500[[ev-1-simulate]]')).toEqual([]);
    expect(uncitedBigNumbers('种子 20260929、共 20 场、提升 12%')).toEqual([]);
  });

  it('用例目录本身自洽：id 唯一、都写了 note 与期望', () => {
    expect(new Set(ADVISOR_EVAL_CASES.map((c) => c.id)).size).toBe(ADVISOR_EVAL_CASES.length);
    for (const c of ADVISOR_EVAL_CASES) {
      expect(c.note.length, c.id).toBeGreaterThan(5);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
    }
    expect(ADVISOR_EVAL_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it('scorecard 汇总', () => {
    const c = caseOf('metric-ambiguity');
    const reports = [reportOf(c, emptyTurn('最强就是这三个人。')), reportOf(c, emptyTurn('木桩与实战 L4 是两回事。'))];
    const s = scorecard(reports);
    expect(s.cases).toBe(2);
    expect(s.passed).toBe(1);
    expect(s.failedChecks).toBeGreaterThan(0);
  });
});
