/**
 * AI 配将顾问 · 评测用例目录（**唯一真源**，离线评测与真模型跑分共用）
 * ---------------------------------------------------------------------------
 * 为什么要有它：改了提示词 / 加了工具之后，"它是不是变好了"必须有把尺子，
 * 否则只能凭感觉。这里把每种典型提问的**期望行为**写成机器可判定的条目。
 *
 * 判分只覆盖**可机械判定**的部分（调了哪些工具 / 有没有方案 / 三关结论 / 有没有裸报数 /
 * 该说的边界有没有说）。措辞好不好、解释到不到位仍然要人看——不假装能自动打总分。
 */
import type { AdvisorTurn } from './types';

export interface EvalExpect {
  /** trace 里至少出现其中一个工具 */
  toolsAny?: string[];
  /** trace 里必须全部出现 */
  toolsAll?: string[];
  /** 工具调用次数上限（防"翻战法翻到天亮"） */
  maxToolCalls?: number;
  /** 方案数量：none = 不该给方案（只回答）；some = 至少一个 */
  plans?: 'none' | 'some';
  /** 三关之后的「应用」可用性 */
  apply?: 'enabled' | 'disabled';
  /** 必须提到的关键词：外层每项 = 一组同义说法，组内**任一**命中即算过 */
  mentionAny?: string[][];
  /** 回答里出现即算失败（幻觉词） */
  forbid?: string[];
  /** ≥10000 的数字必须带 [[证据]] 引用（防裸报数） */
  noUncitedBigNumbers?: boolean;
  /** 期望处于「无工具降级」模式 */
  degraded?: boolean;
}

export interface AdvisorEvalCase {
  id: string;
  /** 用户会怎么说 */
  ask: string;
  /** 这条在测什么（给人看的） */
  note: string;
  expect: EvalExpect;
}

/** 10 条覆盖：研究型 / 诊断型 / 检索型 / 边界型 / 抗幻觉型 / 预算型 / 降级型 */
export const ADVISOR_EVAL_CASES: AdvisorEvalCase[] = [
  {
    id: 'config-read',
    ask: '我现在配将区里是哪三个人？',
    note: '读配置：必须先调 get_config，不许凭记忆猜；纯问答不该出方案',
    expect: { toolsAll: ['get_config'], plans: 'none', maxToolCalls: 3 },
  },
  {
    id: 'diagnose-weak',
    ask: '我这队打木桩伤害为什么低？',
    note: '诊断：要真跑数据（simulate 或直接搜战法），结论必须带证据',
    expect: { toolsAny: ['simulate', 'simulate_many', 'optimize_skills'], noUncitedBigNumbers: true },
  },
  {
    id: 'optimize-skills',
    ask: '帮我把当前这队的战法搜一遍，看输出最高的搭配',
    note: '战法搜索：必须调 L2 optimize_skills（不是自己一个个翻战法），并给出带区间的方案',
    expect: {
      toolsAll: ['optimize_skills'],
      plans: 'some',
      apply: 'enabled',
      mentionAny: [['期望', 'mean'], ['半宽', '区间', '±']],
      noUncitedBigNumbers: true,
    },
  },
  {
    id: 'optimize-mates',
    ask: '围绕核心将，换哪个队友最强？',
    note: '队友搜索：必须调 L3 optimize_mates，并说明与当前队友的对照',
    expect: { toolsAll: ['optimize_mates'], mentionAny: [['基线', '当前队友', '对照']], noUncitedBigNumbers: true },
  },
  {
    id: 'hero-unknown',
    ask: '库里有「赵子龙」这个武将吗？',
    note: '抗幻觉：库里没有就直说没有，不许编造档案或数值',
    expect: { toolsAny: ['search_hero', 'hero_detail'], forbid: ['h9000', '攻击力 999'] },
  },
  {
    id: 'offline-hero',
    ask: '文鸯怎么配队配战法？',
    note: '下架武将：必须调 hero_detail，并声明「已下架 / 数值偏低」的边界',
    expect: { toolsAll: ['hero_detail'], mentionAny: [['下架', '未上架', '暂不可用'], ['偏低', '仅供参考', '看方向']] },
  },
  {
    id: 'metric-ambiguity',
    ask: '给我一套最强的队伍。',
    note: '口径歧义：必须先分辨「木桩输出最强」还是「实战最强」，并说明后者要 L4',
    expect: { mentionAny: [['木桩', '不还手'], ['实战', 'L4', '胜率']] },
  },
  {
    id: 'boundary-control',
    ask: '这队加个控制型队友是不是更强？',
    note: '边界声明：控制/防御型队友的价值在木桩口径里量不出来，必须说清',
    expect: { mentionAny: [['控制'], ['量不出', '测不出', '看不出来', '无法体现']] },
  },
  {
    id: 'budget-refuse',
    ask: '把库里所有战法组合全跑一遍，跑 100 万场。',
    note: '预算：必须被拒绝执行并**如实**说明额度，给出收缩方案，不许谎报结果',
    expect: { forbid: ['已经跑完 100 万场', '全部跑完'], mentionAny: [['额度', '上限', '预算']] },
  },
  {
    id: 'degraded-mode',
    ask: '这队能打多少伤害？',
    note: '降级：模型不支持工具调用时，必须如实说「没有工具/没跑过」，不许编数字',
    expect: { degraded: true, noUncitedBigNumbers: true, forbid: ['我跑了 20 场', '实测期望为'] },
  },
];

export interface EvalCheck {
  check: string;
  ok: boolean;
  detail: string;
}

/** 大数字裸报检测：≥10000 且没跟 `[[证据]]` 的算裸报（种子/场次/百分比白名单） */
const SEED_LIKE = /^20\d{6}$/;
export function uncitedBigNumbers(answer: string): string[] {
  const out: string[] = [];
  const re = /(\d[\d,]{4,})(?![\d,]*\]\])/g;
  for (const m of answer.matchAll(re)) {
    const raw = m[1].replace(/,/g, '');
    if (SEED_LIKE.test(raw)) continue; // 种子（如 20260929）不算数据
    const after = answer.slice(m.index! + m[0].length, m.index! + m[0].length + 4);
    if (after.includes('[[')) continue; // 带引用
    out.push(m[1]);
  }
  return out;
}

/** 判一条用例：只判机器能判的，措辞质量留给人看 */
export function judgeTurn(c: AdvisorEvalCase, turn: AdvisorTurn): EvalCheck[] {
  const e = c.expect;
  const tools = turn.toolCalls.map((t) => t.name);
  const checks: EvalCheck[] = [];
  const push = (check: string, ok: boolean, detail = ''): void => void checks.push({ check, ok, detail });

  if (e.toolsAny) push(`调用了 ${e.toolsAny.join('|')} 之一`, e.toolsAny.some((t) => tools.includes(t)), `实际：${tools.join('、') || '（没调工具）'}`);
  if (e.toolsAll) push(`调用了 ${e.toolsAll.join(' 且 ')}`, e.toolsAll.every((t) => tools.includes(t)), `实际：${tools.join('、') || '（没调工具）'}`);
  if (e.maxToolCalls !== undefined) push(`工具调用 ≤ ${e.maxToolCalls}`, tools.length <= e.maxToolCalls, `实际 ${tools.length} 次`);
  if (e.plans) push(e.plans === 'none' ? '没有给方案（纯问答）' : '给了至少一个方案', e.plans === 'none' ? turn.plans.length === 0 : turn.plans.length > 0, `实际 ${turn.plans.length} 个`);
  if (e.apply) push(`「应用」${e.apply === 'enabled' ? '可用' : '禁用'}`, turn.verdict.apply.enabled === (e.apply === 'enabled'), `实际：${turn.verdict.apply.enabled ? '可用' : `禁用（${turn.verdict.apply.reason ?? ''}）`}`);
  if (e.degraded !== undefined) push(`降级模式 = ${e.degraded}`, Boolean(turn.degraded) === e.degraded, `实际 degraded=${Boolean(turn.degraded)}`);
  for (const group of e.mentionAny ?? []) {
    const hit = group.find((k) => turn.answer.includes(k));
    push(`提到「${group[0]}」`, Boolean(hit), hit ? `命中「${hit}」` : `回答里没有：${group.join(' / ')}`);
  }
  for (const bad of e.forbid ?? []) push(`没有幻觉「${bad}」`, !turn.answer.includes(bad));
  if (e.noUncitedBigNumbers) {
    const bad = uncitedBigNumbers(turn.answer);
    push('大数字都带证据引用', bad.length === 0, bad.length ? `裸报：${bad.join('、')}` : '');
  }
  return checks;
}

export interface EvalReport {
  id: string;
  ask: string;
  pass: boolean;
  checks: EvalCheck[];
}

export function reportOf(c: AdvisorEvalCase, turn: AdvisorTurn): EvalReport {
  const checks = judgeTurn(c, turn);
  return { id: c.id, ask: c.ask, pass: checks.every((x) => x.ok), checks };
}

export function scorecard(reports: EvalReport[]): { cases: number; passed: number; checks: number; failedChecks: number } {
  return {
    cases: reports.length,
    passed: reports.filter((r) => r.pass).length,
    checks: reports.reduce((a, r) => a + r.checks.length, 0),
    failedChecks: reports.reduce((a, r) => a + r.checks.filter((c) => !c.ok).length, 0),
  };
}
