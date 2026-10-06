/**
 * AI 配将顾问 · 思考模式路由（工具面分档）测试
 * ---------------------------------------------------------------------------
 * 对应设计文档 §16 的 S1 切片：**二级目录 + 分档工具面 + 分档门**。
 * 纪律：
 *   · 纯函数与线上工具面**同源**——分档表与注册表必须不重不漏（这条是 §16.9 探针的常驻版）；
 *   · 被拒的调用**不进 evidence**（否则关 2 溯源会被空记录污染）；
 *   · 档位由代码推进，不问模型自报。
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_TIERS,
  anchorToolNames,
  META_TOOLS,
  TIER_TOOLS,
  classifyTiers,
  filterToolSpecs,
  isUnlocked,
  renderCatalog,
  renderHelp,
  renderTurnGuide,
  routeBadge,
  tierOf,
  tiersAfterCalls,
  toolNamesFor,
  toolSurfaceChars,
} from '../web/advisor/router';
import { createTools, makeCtx, runTool } from '../web/advisor/tools';
import { runAdvisorTurn } from '../web/advisor/loop';
import { createFakeTransport } from '../web/advisor/transport';
import { ADVISOR_EVAL_CASES } from '../web/advisor/evalCases';

const registry = createTools().map((t) => t.name);

/** 线上 payload 形状的字符数——**与面板共用同一个口径**（`router.toolSurfaceChars`） */
const wireChars = (names: string[]): number => toolSurfaceChars(createTools(), names);

describe('思考模式路由 · 档位判定（纯函数）', () => {
  it('默认档 = base；评测集里要跑 L2 搜索的提问必须开 search 档', () => {
    // 这是评测集 optimize-skills 用例的原话——它脚本里调 optimize_skills，档位判定必须放行
    expect(classifyTiers('帮我把当前这队的战法搜一遍，看输出最高的搭配')).toContain('search');
    expect(classifyTiers('围绕核心将，换哪个队友最强？')).toContain('search');
    expect(classifyTiers('给我一套最强的队伍。')).toContain('search');
    expect(classifyTiers('帮我看下伤害期望')).toContain('search');
  });

  it('查档案 / 读配置 / 打木桩这类问题只开默认档（不误开搜索）', () => {
    for (const ask of ['我现在配将区里是哪三个人？', '这队现在打木桩能打多少？', '库里有「赵子龙」这个武将吗？', '随便问问']) {
      expect(classifyTiers(ask)).toEqual(['base']);
    }
  });

  it('写回档只在提到对手池时才开', () => {
    expect(classifyTiers('把「刘备队」加进对手池')).toEqual(['base', 'write']);
    expect(classifyTiers('删掉那个用户对手')).toEqual(['base', 'write']);
    expect(classifyTiers('这队怎么配')).not.toContain('write');
  });

  it('每个工具最多属于一个档；档位并集不重不漏（注册表 19 个业务工具）', () => {
    const union = ALL_TIERS.flatMap((t) => TIER_TOOLS[t]);
    expect(new Set(union).size).toBe(union.length); // 不重
    const business = registry.filter((n) => !META_TOOLS.includes(n));
    expect(business.filter((n) => !union.includes(n))).toEqual([]); // 不漏
    expect(union.filter((n) => !registry.includes(n))).toEqual([]); // 不多
    expect(business.length).toBe(19);
    for (const n of business) expect(tierOf(n)).not.toBeNull();
    for (const n of META_TOOLS) expect(tierOf(n)).toBeNull();
  });

  it('评测集守卫：expect.toolsAll 点了 optimize_* 的用例，其提问必须能开 search 档', () => {
    const hits = ADVISOR_EVAL_CASES.filter((c) => (c.expect.toolsAll ?? []).some((n) => TIER_TOOLS.search.includes(n)));
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) expect(classifyTiers(c.ask), `${c.id}：${c.ask}`).toContain('search');
  });

  it('tiersAfterCalls 只升不降（跑过哪个档的工具就并进哪个档）', () => {
    expect(tiersAfterCalls(['base'], ['simulate', 'hero_detail'])).toEqual(['base']);
    expect(tiersAfterCalls(['base'], ['optimize_mates'])).toEqual(['base', 'search']);
    expect(tiersAfterCalls(['base', 'search'], ['simulate'])).toEqual(['base', 'search']);
  });
});

describe('思考模式路由 · 工具面与二级目录', () => {
  it('meta 常驻：任何档都可调，且不进任何档', () => {
    for (const tier of ALL_TIERS) for (const m of META_TOOLS) expect(isUnlocked(m, [tier])).toBe(true);
    expect(toolNamesFor(['base'])).toEqual(expect.arrayContaining([...META_TOOLS]));
  });

  it('默认档看不见 optimize_*，开 search 档后才有', () => {
    for (const n of TIER_TOOLS.search) {
      expect(isUnlocked(n, ['base'])).toBe(false);
      expect(isUnlocked(n, ['base', 'search'])).toBe(true);
    }
    expect(toolNamesFor(['base'])).not.toContain('optimize_winrate');
    expect(toolNamesFor(['base', 'search'])).toContain('optimize_winrate');
  });

  it('工具面字符数：默认档显著小于全量（基线：全量 15995 / 默认档 8757；工具或描述改动时同步更新）', () => {
    const full = wireChars(registry);
    const base = wireChars(toolNamesFor(['base']));
    expect({ full, base }).toEqual({ full: 15995, base: 8757 });
    expect(base / full).toBeLessThan(0.6);
  });

  it('tools_catalog 只列本轮开放的，并给出未开放档的提示（不点名未开放工具）', () => {
    const text = renderCatalog(createTools(), ['base']);
    expect(text).toContain('get_config');
    expect(text).toContain('simulate(plan, runs)'); // 参数名一并给出
    expect(text).not.toContain('optimize_winrate');
    expect(text).toContain('未开放的档');
    expect(text).toContain('route_task');
    expect(renderCatalog(createTools(), ALL_TIERS)).toContain('所有档都已开放');
  });

  it('tools_help 标明开放状态与参数 schema；未开放时指向逃生门', () => {
    const locked = renderHelp(createTools(), ['base'], 'optimize_winrate');
    expect(locked).toContain('optimize_winrate');
    expect(locked).toContain('当前**未开放**');
    expect(locked).toContain('route_task');
    expect(locked).toContain('参数 schema');
    expect(renderHelp(createTools(), ['base', 'search'], 'optimize_winrate')).toContain('当前**开放**');
    expect(renderHelp(createTools(), ['base'], '不存在的工具')).toContain('没有叫');
  });

  it('三个 meta 工具本身可执行（没启用分档时 = 全量开放）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const catalog = await runTool('tools_catalog', {}, ctx);
    expect(catalog.brief ?? '').toContain('get_config');
    expect(catalog.brief ?? '').toContain('optimize_winrate');
    const help = await runTool('tools_help', { name: 'optimize_skills' }, ctx);
    expect(help.brief ?? '').toContain('optimize_skills');
    const route = await runTool('route_task', { tier: 'search', why: '要搜索' }, ctx);
    expect(route.summary).toContain('没有启用分档');
  });
});

describe('思考模式路由 · loop 里真的挡住了', () => {
  it('默认档调 optimize_winrate → 拒绝回灌、不进 evidence、工具面里也没有它', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([
      { calls: [{ id: 'c1', name: 'optimize_winrate', args: {} }] },
      { text: '那我换个办法。' },
    ]);
    const t = await runAdvisorTurn({ userText: '这队现在打木桩能打多少？', ctx, transport });

    expect(t.toolCalls).toEqual([]); // 没跑 → 不留 evidence
    expect(ctx.budget.calls).toBe(0); // 也没扣预算
    expect(t.route?.tiers).toEqual(['base']);
    expect(transport.requests[0].tools.map((x) => x.name)).not.toContain('optimize_winrate');
    expect(transport.requests[0].tools.map((x) => x.name)).toEqual(expect.arrayContaining([...META_TOOLS]));
    const toolMsg = t.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    expect(toolMsg).toContain('未开放');
    expect(toolMsg).toContain('route_task');
    expect(transport.requests.length).toBe(2); // 拒绝之后模型还能继续说
  });

  it('route_task 开档 → 下一轮工具面里就出现该档工具，并记进 route.promotions', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([
      { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
      { calls: [{ id: 'c2', name: 'route_task', args: { tier: 'search', why: '用户要看输出最高的搭配' } }] },
      { text: '好，我按搜索档来。' },
    ]);
    const t = await runAdvisorTurn({ userText: '随便问问', ctx, transport });

    expect(t.route?.tiers).toEqual(['base', 'search']);
    expect(t.route?.promotions).toEqual([{ tier: 'search', why: '用户要看输出最高的搭配', round: 1 }]);
    // 开档后的那一轮请求，工具面已经带上 search 档（open → wire 已兑现）
    const later = transport.requests[transport.requests.length - 1].tools.map((x) => x.name);
    expect(later).toContain('optimize_skills');
    expect(t.route?.toolNames).toContain('optimize_skills');
    const msg = t.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    expect(msg).toContain('已开放');
  });

  it('不许空口开档：没理由 / 没前置调用 / 非法档名，一律拒绝且不推进档位', async () => {
    const cases: Array<{ args: unknown; needle: string }> = [
      { args: { tier: 'search', why: '' }, needle: '理由不能为空' },
      { args: { tier: 'search', why: '要搜' }, needle: '还不能开' },
      { args: { tier: 'anchor', why: '想锚定' }, needle: '没有「anchor」这一档' },
    ];
    for (const c of cases) {
      const ctx = makeCtx({ fakeRuns: true });
      const transport = createFakeTransport([{ calls: [{ id: 'c1', name: 'route_task', args: c.args }] }, { text: '好' }]);
      const t = await runAdvisorTurn({ userText: '随便问问', ctx, transport });
      expect(t.route?.tiers, JSON.stringify(c.args)).toEqual(['base']);
      expect(t.route?.promotions).toEqual([]);
      expect(t.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n')).toContain(c.needle);
    }
  });

  it('用户消息本身就指向该档时，route_task 不必先跑别的工具', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([
      { calls: [{ id: 'c1', name: 'route_task', args: { tier: 'search', why: '用户要最强配置' } }] },
      { text: '好' },
    ]);
    const t = await runAdvisorTurn({ userText: '给我一套最强的队伍', ctx, transport });
    expect(t.route?.tiers).toEqual(['base', 'search']);
  });

  it('走完一轮：档位快照 toolNames 与线上工具面一致（同源）', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([{ calls: [{ id: 'c1', name: 'get_config', args: {} }] }, { text: '好了' }]);
    const t = await runAdvisorTurn({ userText: '在吗', ctx, transport });
    expect(t.route?.toolNames).toEqual(transport.requests[0].tools.map((x) => x.name));
    // 集合与档表推导一致（顺序以实际 wire 为准：filterToolSpecs 保持注册顺序）
    expect([...(t.route?.toolNames ?? [])].sort()).toEqual([...toolNamesFor(['base'])].sort());
  });
});

describe('思考模式路由 · 近距离引导与 Task 回显（S2）', () => {
  it('引导贴在**本轮提问之后**（同一请求），且 system 前缀在一轮内逐字不变', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([{ calls: [{ id: 'c1', name: 'get_config', args: {} }] }, { text: '好' }]);
    await runAdvisorTurn({ userText: '帮我看看这队', ctx, transport, taskText: '【本次会话的任务】看这队' });

    const first = transport.requests[0].messages;
    expect(first[first.length - 1].content).toContain('<advisor_route>');
    expect(first[first.length - 1].content).toContain('【本轮路由】');
    expect(first[first.length - 2].content).toBe('帮我看看这队'); // 紧跟在用户消息之后
    expect(first[first.length - 1].role).toBe('user'); // 不用 system：部分兼容端点不接受中途 system

    // 动态引导**没有**进 system 前缀（否则整段前缀缓存全量失效）
    const sysOf = (msgs: Array<{ role: string; content: string }>): string =>
      msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\u0000');
    expect(sysOf(transport.requests[1].messages)).toBe(sysOf(first));
    expect(sysOf(first)).not.toContain('<advisor_route>');
  });

  it('引导按档变化：search 档点破"别自己翻战法"，默认档给 route_task 出口', () => {
    const search = renderTurnGuide(['base', 'search']);
    expect(search).toContain('optimize_winrate');
    expect(search).toContain('不要逐个 skill_detail 翻战法');
    expect(search).toContain('coreUnit');
    expect(search).toContain('不要为凑同阵营三人去筛队友');
    const base = renderTurnGuide(['base']);
    expect(base).toContain('route_task');
    expect(base).not.toContain('不要逐个 skill_detail 翻战法');
    const write = renderTurnGuide(['base', 'write']);
    expect(write).toContain('对手池');
    // 铁律每条都带（近距离复述关键约束，就是它存在的理由）
    for (const g of [search, base, write]) {
      expect(g).toContain('evidenceId');
      expect(g).toContain('validate_plan');
      // 2026-10-05 真模型对照的最大一类失分：正文带了引用、表格里省掉 → 引导必须点名"表格里也要、每次都要"
      // 2026-10-06 改口径：同一数值带过一次即可，不再是"每次出现都要带"（§16.23）
      expect(g).toContain('表格里的数字也要能对上引用');
      // 同日核查出的两条提示词缺口（判分要、模型没说过）：下架声明 + 控制/防御型在木桩口径量不出来
      expect(g).toContain('已下架');
      expect(g).toContain('量不出来');
    }
  });

  it('Task 回显：静态 system 块，摆在预算之后、box 之前；空任务不注入', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([{ text: '好' }]);
    await runAdvisorTurn({ userText: '第二问', ctx, transport, taskText: '【本次会话的任务】看这队', boxText: '<advisor_box>空的</advisor_box>' });
    const msgs = transport.requests[0].messages;
    expect(msgs[0].content).toContain('配将顾问'); // SYSTEM_PROMPT
    expect(msgs[1].content).toContain('本轮预算'); // budgetHint
    expect(msgs[2].content).toContain('本次会话的任务'); // Task 块
    expect(msgs[3].content).toContain('<advisor_box>'); // box 仍在 Task 之后
    // 不传 taskText = 不注入空块：此时 system 块只剩 SYSTEM_PROMPT + 预算两条
    // （页面里是 3 条 —— 多出来的是**始终注入**的 box 块，见 web/advisorSmoke.test.ts）
    const bare = createFakeTransport([{ text: '好' }]);
    await runAdvisorTurn({ userText: '第二问', ctx: makeCtx({ fakeRuns: true }), transport: bare });
    expect(bare.requests[0].messages.filter((m) => m.role === 'system')).toHaveLength(2);
    expect(bare.requests[0].messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')).not.toContain('本次会话的任务');
  });

  it('noRouting：关掉分档回到全量工具面（A/B 对照用），档位快照如实标全量', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    // ⚠️ 关掉分档后 optimize_* 是**真的可调**的（跑一次真搜索会很久）——所以脚本只调 get_config，
    //    这里断言的是**工具面回到了全量**，不是"它能跑完"
    const transport = createFakeTransport([{ calls: [{ id: 'c1', name: 'get_config', args: {} }] }, { text: '好' }]);
    const t = await runAdvisorTurn({ userText: '这队现在打木桩能打多少？', ctx, transport, noRouting: true });
    const wired = transport.requests[0].tools.map((x) => x.name);
    expect(wired).toContain('optimize_winrate'); // 全量面（默认档下它是不可见的）
    expect(wired.sort()).toEqual([...registry].sort());
    expect(t.route?.tiers).toEqual(['base', 'search', 'write']);
  });
});

describe('思考模式路由 · 首轮锚定（S3）', () => {
  it('锚定轮只发 get_config + 常驻三件；跑成功一个工具后当场放开默认档', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([{ calls: [{ id: 'c1', name: 'get_config', args: {} }] }, { text: '好' }]);
    const t = await runAdvisorTurn({ userText: '在吗', ctx, transport, anchor: true });

    expect(transport.requests[0].tools.map((x) => x.name)).toEqual(['get_config', 'tools_catalog', 'tools_help', 'route_task']);
    // 第二轮请求（get_config 已成功）→ 锚定放开，回到默认档（顺序以注册表为准，集合与档表一致）
    const second = transport.requests[1].tools.map((x) => x.name);
    expect(second).toContain('simulate');
    expect([...second].sort()).toEqual([...toolNamesFor(['base'])].sort());
    // 引导里写明锚定，模型才知道为什么这么窄
    expect(transport.requests[0].messages.at(-1)?.content).toContain('首轮锚定');
    expect(t.route?.anchor).toBe(false); // 本轮结束时已放开
  });

  it('锚定轮调别的工具 → 拒绝回灌（文案指向"先调一次工具"），且**被拒不算跑过**、锚定仍在', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([{ calls: [{ id: 'c1', name: 'search_hero', args: { q: '曹操' } }] }, { text: '好' }]);
    const t = await runAdvisorTurn({ userText: '在吗', ctx, transport, anchor: true });

    expect(t.toolCalls).toEqual([]);
    expect(ctx.budget.calls).toBe(0);
    const msg = t.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    expect(msg).toContain('首轮锚定');
    expect(msg).toContain('get_config');
    expect(t.route?.anchor).toBe(true); // 没跑成功 → 下一轮仍然窄
    expect(transport.requests[1].tools.map((x) => x.name)).toEqual(['get_config', 'tools_catalog', 'tools_help', 'route_task']);
  });

  it('锚定轮照样能用 route_task（用户消息指向该档时），且它也算"跑过一次"', async () => {
    const ctx = makeCtx({ fakeRuns: true });
    const transport = createFakeTransport([
      { calls: [{ id: 'c1', name: 'route_task', args: { tier: 'search', why: '用户要最强配置' } }] },
      { text: '好' },
    ]);
    const t = await runAdvisorTurn({ userText: '给我一套最强的队伍', ctx, transport, anchor: true });
    expect(t.route?.tiers).toEqual(['base', 'search']);
    expect(t.route?.anchor).toBe(false);
    expect(transport.requests[1].tools.map((x) => x.name)).toContain('optimize_winrate');
  });

  it('不传 anchor / 传 noRouting 时不锚定（评测与库调用方不受影响）', async () => {
    for (const opts of [{}, { noRouting: true }, { anchor: true, noRouting: true }]) {
      const transport = createFakeTransport([{ text: '好' }]);
      const t = await runAdvisorTurn({ userText: '在吗', ctx: makeCtx({ fakeRuns: true }), transport, ...opts });
      const wired = transport.requests[0].tools.map((x) => x.name);
      expect(wired, JSON.stringify(opts)).toContain('simulate');
      expect(t.route?.anchor, JSON.stringify(opts)).toBe(false);
    }
  });

  it('锚定面字符数（基线 1066 = 全量的 6.8%）：首轮 prefill 最便宜的那一次', () => {
    expect(wireChars(anchorToolNames())).toBe(1066);
    expect(wireChars(anchorToolNames()) / wireChars(registry)).toBeLessThan(0.07);
    expect(anchorToolNames()).toEqual(['get_config', ...META_TOOLS]);
  });
});

describe('档位徽标（§16.26：生产页轨迹行那一行）', () => {
  it('档位 + 工具数；锚定与自检各自追加一段', () => {
    expect(routeBadge({ tiers: ['base'], toolNames: toolNamesFor(['base']) })).toBe('档位 基础 · 16 个工具');
    expect(routeBadge({ tiers: ['base', 'search'], toolNames: toolNamesFor(['base', 'search']) })).toBe('档位 基础+大搜索 · 20 个工具');
    expect(routeBadge({ tiers: ['base'], toolNames: anchorToolNames(), anchor: true })).toBe('档位 基础 · 4 个工具 · 首轮锚定');
    expect(routeBadge({ tiers: ['base'], toolNames: toolNamesFor(['base']) }, ['106206'])).toBe('档位 基础 · 16 个工具 · 自检补引用 1 个');
    // 写回档也要有短标签（别漏一个档就 undefined）
    expect(routeBadge({ tiers: ['write'], toolNames: toolNamesFor(['write']) })).toContain('档位 写回');
  });
});
