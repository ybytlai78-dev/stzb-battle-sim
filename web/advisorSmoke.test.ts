/**
 * AI 顾问抽屉（主站内嵌）端到端：点导航 → 开抽屉 → 干跑一问 → 出方案卡 → 三关通过 → 应用到配将区
 * ---------------------------------------------------------------------------
 * 这条测试就是"接入主站"的验收：**不 mock 抽屉**，走真实的 loop + 工具 + 校验门 + 关 3 复算，
 * 只把 LLM 传输层换成假脚本（脚本从工具返回里读真实 evidenceId，所以关 2 的溯源是真校验）。
 *
 * 末段是记忆层（`docs/AI配将顾问-设计.md` §14）的端到端：轮末落盘 → **重新挂载 = 刷新** → 续上；
 * 档案注入 + 自动整理；中断兜底；「新会话」清对话不清档案。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountAdvisor } from './advisor/view';
import { saveSettings, setDryRun, __resetSettings } from './settings';
import { createFakeTransport, type ChatRequest, type FakeStep } from './advisor/transport';
import { makeCtx } from './advisor/tools';
import { cfgOf } from './advisor/gate';
import { BOX_KEY } from './advisor/box';
import { PROFILE_KEY, SESSION_KEY } from './advisor/memory';
import { DEFAULT_DUMMY, type AdvisorMessage, type AdvisorPlan } from './advisor/types';
import { getHeroById, SLOTTED_HEROES, TROOP_CHAR } from './heroes';
import type { AdvisorHost } from './advisorHost';

const heroIds = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);

const planOf = (): AdvisorPlan => ({
  slots: heroIds.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
});

/** 假 LLM 的脚本：先 simulate，再用**真实 evidenceId** 出一个方案；顺带在正文里引用一次数字（关 2 要核） */
const scriptSteps = (plan: AdvisorPlan, opts: { badEvidence?: boolean } = {}): FakeStep[] => [
  { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
  { calls: [{ id: 'c2', name: 'simulate', args: { plan, runs: 20 } }] },
  {
    text: (req: ChatRequest) => {
      const toolMsgs = req.messages.filter((m) => m.role === 'tool');
      const last = toolMsgs[toolMsgs.length - 1];
      const parsed = JSON.parse(last.content) as { evidenceId: string; summary: string };
      const mean = /期望 (\d+)/.exec(parsed.summary)?.[1] ?? '0';
      const id = opts.badEvidence ? 'ev-999-simulate' : parsed.evidenceId;
      return [
        `按标准口径跑了 20 场，核心将伤害期望约 ${mean}[[${id}]]。`,
        '```json',
        JSON.stringify({ plans: [{ title: '当前配置（原样）', plan, evidenceIds: [id] }] }),
        '```',
      ].join('\n');
    },
  },
];

/** 一问到底的假传输（脚本给两轮，记忆层测试要用第二轮） */
function setup(opts: { badEvidence?: boolean; once?: (req: ChatRequest) => string } = {}) {
  document.body.innerHTML = '';
  const plan = planOf();
  const applied: AdvisorPlan[] = [];
  const host: AdvisorHost = {
    teamLabel: '红队（我方）',
    readTeam: () => plan,
    applyPlan: (p) => {
      applied.push(p);
      return { ok: true };
    },
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ctx = makeCtx({ fakeRuns: true, coreDamage: 7317, deps: { getConfig: () => cfgOf(plan) } });
  const transport = createFakeTransport([...scriptSteps(plan, opts), ...scriptSteps(plan, opts)], opts.once ? { onceReply: opts.once } : {});
  const view = mountAdvisor(root, { host, transport, ctx });
  return { view, applied, root, plan, transport };
}

/** 轮询等待条件成立（确认条是异步出现的，不能用固定 sleep） */
async function waitFor<T>(fn: () => T | null, timeoutMs = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('AI 顾问抽屉（主站内嵌）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSettings(); // 设置是模块单例：光清 localStorage 会把上一条用例的设置漏给下一条
  });

  it('独立页骨架（设计文档 §17）：挂载即显示；侧栏默认收起，开关切两态', () => {
    const { root } = setup();
    const page = root.querySelector('.advisor-page') as HTMLElement;
    expect(page).toBeTruthy();
    expect(page.classList.contains('open')).toBe(true); // 独立页没有"收起态"
    expect(page.querySelector('.advisor-title')?.textContent).toContain('红队');
    // 一个骨架两态：默认极简（无 rail-open），点顶栏最左的开关 → 工作台
    expect(page.classList.contains('rail-open')).toBe(false);
    (page.querySelector('.advisor-rail-toggle') as HTMLButtonElement).click();
    expect(page.classList.contains('rail-open')).toBe(true);
    expect(page.querySelector('#advisor-rail')).toBeTruthy();
    // 展开态：输入区工具行与顶栏阵容行交给 CSS 收掉（宽度断言在 Playwright 渲染验证里）
    expect(page.querySelector('.advisor-tools')).toBeTruthy();
  });

  it('一问到底：流式正文 + 工具调用轨迹 + 方案卡（三关通过、应用可点）', async () => {
    const { view, root, applied } = setup();
    view.open();
    await view.__send('这队现在打木桩能打多少？');

    // 工具调用**压成一行**（用户 2026-09-29 口径）：轨迹行两个工具、中文名、正文只放模型的话
    const trace = root.querySelector('.advisor-trace')?.textContent ?? '';
    expect(trace).toContain('读配置');
    expect(trace).toContain('试跑');
    expect(trace.split('·')).toHaveLength(2);
    expect(trace).not.toContain('get_config');
    const log = root.querySelector('.advisor-log')?.textContent ?? '';
    expect(log).toContain('【顾问】');
    expect(log).not.toContain('▶');

    const card = root.querySelector('.advisor-plan-card') as HTMLElement;
    expect(card).toBeTruthy();
    // 配置表：三个位置 + 三个武将名
    expect(card.querySelectorAll('.pc-config tr')).toHaveLength(3);
    const cardText = card.textContent ?? '';
    expect(cardText).toContain('大营');
    // 关 3：卡上必须出现「标准口径复算」的真实数字（来自 checks，不是模型写的）
    expect(cardText).toContain('标准口径复算');
    expect(cardText).toContain('7,317');
    expect(cardText).toContain('20260929');
    // 证据用中文短标，不再摆英文编号
    expect(cardText).toContain('试跑②');
    expect(cardText).not.toContain('ev-2-simulate');
    // 三关通过 → 应用可点
    const applyBtn = card.querySelector('.advisor-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    applyBtn.click();
    expect(applied).toHaveLength(1);
    expect(applied[0].slots.map((s) => s.heroId)).toEqual(heroIds);
    expect(root.querySelector('.advisor-log')?.textContent).toContain('【已应用】');
  });

  it('伪造 evidenceId → 关 2 不通过 → 应用按钮禁用并显示原因', async () => {
    const { view, root } = setup({ badEvidence: true });
    view.open();
    await view.__send('随便问问');
    const card = root.querySelector('.advisor-plan-card') as HTMLElement;
    const applyBtn = card.querySelector('.advisor-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(card.textContent).toContain('未验证');
  });

  it('报价 + 确认：长搜索先报场次/耗时，点「开始」才真跑', async () => {
    const { view, root, applied } = setup();
    view.open();
    // 把阈值调到 1 场，好让干跑脚本那次 20 场也走确认（设置真源在 web/settings.ts，不在页面上）
    saveSettings({ askFrom: 1 });
    const p = view.__send('这队现在打木桩能打多少？');
    const bar = await waitFor(() => {
      const b = root.querySelector('.advisor-confirm') as HTMLElement | null;
      return b && !b.hidden ? b : null;
    });
    expect(bar.textContent).toContain('即将执行');
    expect(bar.textContent).toContain('预计');
    expect(bar.textContent).toContain('试跑');
    expect(root.querySelector('.advisor-trace')?.textContent).toContain('等你确认');
    (bar.querySelector('.advisor-go') as HTMLButtonElement).click();
    await p;
    expect(root.querySelector('.advisor-plan-card')).toBeTruthy();
    const applyBtn = root.querySelector('.advisor-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    applyBtn.click();
    expect(applied).toHaveLength(1);
  });

  it('报价 + 确认：点「不跑」→ 该工具没真跑（0 场）并记成失败', async () => {
    const { view, root } = setup();
    view.open();
    saveSettings({ askFrom: 1 });
    const p = view.__send('这队现在打木桩能打多少？');
    const bar = await waitFor(() => {
      const b = root.querySelector('.advisor-confirm') as HTMLElement | null;
      return b && !b.hidden ? b : null;
    });
    (bar.querySelector('.advisor-skip') as HTMLButtonElement).click();
    await p;
    const trace = root.querySelector('.advisor-trace')?.textContent ?? '';
    expect(trace).toContain('✘');
    expect(trace).toContain('用户拒绝');
    expect(root.querySelector('.advisor-cost')?.textContent).toContain('0 场'); // 没跑就不算场次
  });

  it('没填 key 且非干跑：不发请求，直接提示', async () => {
    const { view, root } = setup();
    view.open();
    setDryRun(false);
    saveSettings({ key: '' });
    await view.__send('在吗');
    expect(root.querySelector('.advisor-log')?.textContent).toContain('需要 baseURL / model / key');
    expect(root.querySelector('.advisor-plan-card')).toBeNull();
  });
});

describe('AI 顾问记忆层（会话持久化 + 你的偏好）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSettings(); // 设置是模块单例：光清 localStorage 会把上一条用例的设置漏给下一条
  });

  const savedSession = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as { turns: Array<Record<string, unknown>> } | null;
  const savedProfile = () => JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as { items: Array<{ key: string; value: string; seen: number }> } | null;
  const reqOf = (transport: ReturnType<typeof createFakeTransport>, text: string): ChatRequest =>
    transport.requests.find((r) => r.messages.some((m) => m.role === 'user' && m.content === text)) as ChatRequest;

  it('① 轮末落盘：对话 + 证据清单进 localStorage（证据不带 data 明细）', async () => {
    const { view } = setup();
    view.open();
    await view.__send('这队现在打木桩能打多少？');
    const saved = savedSession();
    expect(saved?.turns).toHaveLength(1);
    const t = saved!.turns[0] as { userText: string; answer: string; evidence: Array<Record<string, unknown>>; mode?: string };
    expect(t.userText).toBe('这队现在打木桩能打多少？');
    expect(t.answer).toContain('按标准口径跑了 20 场');
    expect(t.mode).toBe('干跑（假传输）');
    expect(t.evidence.map((e) => e.evidenceId)).toEqual(['ev-1-get_config', 'ev-2-simulate']);
    expect(t.evidence[1].summary).toContain('期望');
    expect(t.evidence[1].stats).toMatchObject({ battles: 20 });
    expect(t.evidence[1].data).toBeUndefined(); // 几千行明细不进会话键（那是 cache.ts 的活）
  });

  it('② 刷新续接：重新挂载后对话/证据清单/方案卡都在，且「应用」仍可点', async () => {
    const first = setup();
    first.view.open();
    await first.view.__send('这队现在打木桩能打多少？');
    first.view.destroy();

    // = 刷新页面：同一个 localStorage、全新的 view
    const second = setup();
    second.view.open();
    const log = second.root.querySelector('.advisor-log')?.textContent ?? '';
    expect(log).toContain('这队现在打木桩能打多少？');
    expect(log).toContain('按标准口径跑了 20 场');
    expect(second.root.querySelector('.advisor-session-meta')?.textContent).toContain('刷新不丢');
    const ev = second.root.querySelector('.advisor-evidence')?.textContent ?? '';
    expect(ev).toContain('第 1 轮证据清单');
    expect(ev).toContain('试跑②');

    const card = second.root.querySelector('.advisor-plan-card') as HTMLElement;
    expect(card).toBeTruthy();
    const btn = card.querySelector('.advisor-apply') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(second.applied).toHaveLength(1);
    expect(second.applied[0].slots.map((s) => s.heroId)).toEqual(heroIds);
  });

  it('② 续接：第二轮把上一轮的对话与证据回灌给模型（紧凑转录，不是协议 trace）', async () => {
    const { view, transport } = setup();
    view.open();
    await view.__send('第一问');
    await view.__send('第二问');
    const second = reqOf(transport, '第二问');
    expect(second.messages.some((m) => m.role === 'user' && m.content === '第一问')).toBe(true);
    expect(second.messages.some((m) => m.role === 'assistant' && m.content.includes('标准口径跑了 20 场'))).toBe(true);
    const ev = second.messages.find((m) => m.content.includes('advisor_evidence'));
    expect(ev).toBeTruthy();
    expect(ev!.content).toContain('试跑②');
    // 历史里不该出现上一轮的协议 tool 消息 / 系统提示词原件
    expect(second.messages.some((m) => m.role === 'tool')).toBe(false);
    // 系统块 = SYSTEM_PROMPT + 预算 + 我的 box（空 box 也带一小段空态提示，见 box.renderBoxBlock）
    expect(second.messages.filter((m) => m.role === 'system')).toHaveLength(3);
  });

  it('④ 注入：空档案不注入；手填一条后，每轮都以 system 块带进上下文', async () => {
    const { view, root, transport } = setup();
    view.open();
    await view.__send('第一问');
    expect(reqOf(transport, '第一问').messages.some((m) => m.content.includes('<advisor_prefs>'))).toBe(false);

    (root.querySelector('#adv-pref-key') as HTMLInputElement).value = '口径';
    (root.querySelector('#adv-pref-val') as HTMLInputElement).value = '只看核心将伤害期望';
    (root.querySelector('.advisor-pref-add') as HTMLButtonElement).click();
    expect(savedProfile()?.items[0]).toMatchObject({ key: '口径', value: '只看核心将伤害期望' });
    expect(root.querySelector('.advisor-profile summary')?.textContent).toContain('你的偏好（1 条）');

    await view.__send('第二问');
    const injected = reqOf(transport, '第二问').messages.find((m) => m.content.includes('<advisor_prefs>'));
    expect(injected?.role).toBe('system');
    expect(injected?.content).toContain('只看核心将伤害期望');
    // 摆位：SYSTEM_PROMPT → 预算 → **我的 box** → 偏好档案 → 历史 → 本轮提问
    const msgs = reqOf(transport, '第二问').messages;
    expect(msgs[0].content).toContain('配将顾问');
    expect(msgs[1].content).toContain('本轮预算');
    expect(msgs[2].content).toContain('<advisor_box>');
    expect(msgs.indexOf(injected!)).toBe(3);
  });

  it('③ 自动整理：轮末一次 once 抽取 → 合并进档案 → 面板可见 → 写回本轮 note', async () => {
    const { view, root, transport } = setup({ once: () => '```json\n{"add":[{"key":"流程","value":"长搜索先问我"}]}\n```' });
    view.open();
    await view.__send('以后长搜索先问我一声');
    expect(transport.onceRequests).toHaveLength(1);
    expect(transport.onceRequests[0].messages[0].content).toContain('偏好档案');
    expect(savedProfile()?.items).toEqual([{ key: '流程', value: '长搜索先问我', at: expect.any(Number), seen: 1 }]);
    expect(root.querySelector('.advisor-pref-list')?.textContent).toContain('长搜索先问我');
    expect(root.querySelector('.advisor-log')?.textContent).toContain('【记忆】档案 +1');
    expect(savedSession()?.turns[0]).toMatchObject({ note: '档案 +1（共 1 条）' });
  });

  it('③ 自动整理可关：关掉开关后不再发抽取请求（对话照常）', async () => {
    const { view, root, transport } = setup({ once: () => '{"add":[{"key":"口径","value":"x"}]}' });
    view.open();
    saveSettings({ autoProfile: false });
    await view.__send('第一问');
    expect(transport.onceRequests).toHaveLength(0);
    expect(savedProfile()).toBeNull();
    expect(savedSession()?.turns).toHaveLength(1);
  });

  it('② 中断兜底：失败 / 取消也把已跑出来的证据与正文落盘（半成品，不编不补）', async () => {
    document.body.innerHTML = '';
    const plan = planOf();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const host: AdvisorHost = { teamLabel: '红队（我方）', readTeam: () => plan, applyPlan: () => ({ ok: true }) };
    const ctx = makeCtx({ fakeRuns: true, coreDamage: 7317, deps: { getConfig: () => cfgOf(plan) } });
    const transport = createFakeTransport([
      { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
      { texts: ['我先看看配置，'], calls: [{ id: 'c2', name: 'simulate', args: { plan, runs: 20 } }] },
      { error: 'network' },
    ]);
    const view = mountAdvisor(root, { host, transport, ctx });
    view.open();
    await view.__send('这队现在打木桩能打多少？');

    const saved = savedSession();
    expect(saved?.turns).toHaveLength(1);
    const t = saved!.turns[0] as { partial?: boolean; answer: string; evidence: unknown[] };
    expect(t.partial).toBe(true);
    expect(t.answer).toContain('我先看看配置');
    expect(t.evidence).toHaveLength(2); // 读配置 + 试跑：跑完的都留下了
    expect(root.querySelector('.advisor-log')?.textContent).toContain('【失败】');
    expect(root.querySelector('.advisor-evidence')?.textContent).toContain('中断');
  });

  it('②「新会话」：两下确认后清掉对话，但**保留**偏好档案', async () => {
    const { view, root } = setup({ once: () => '{"add":[{"key":"口径","value":"只看核心将"}]}' });
    view.open();
    await view.__send('第一问');
    expect(savedSession()?.turns).toHaveLength(1);

    const btn = root.querySelector('.advisor-new') as HTMLButtonElement;
    btn.click();
    expect(btn.textContent).toContain('确认');
    expect(savedSession()?.turns).toHaveLength(1); // 第一下只是待确认，不动数据
    btn.click();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(root.querySelector('.advisor-log')?.textContent).not.toContain('第一问');
    expect(savedProfile()?.items).toHaveLength(1);
    expect(root.querySelector('.advisor-profile summary')?.textContent).toContain('你的偏好（1 条）');
  });

  it('档案面板：删除单条 / 清空 / 写失败（localStorage 抛错）也不崩', async () => {
    const { view, root } = setup();
    view.open();
    (root.querySelector('#adv-pref-key') as HTMLInputElement).value = '忌讳';
    (root.querySelector('#adv-pref-val') as HTMLInputElement).value = '不要控制队';
    (root.querySelector('.advisor-pref-add') as HTMLButtonElement).click();
    expect(savedProfile()?.items).toHaveLength(1);
    expect(root.querySelector('.advisor-pref-list')?.textContent).toContain('不要控制队');

    // 配额满 / 隐私模式：写盘失败，但面板与本次会话照常（store 自己退到内存）
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    (root.querySelector('#adv-pref-key') as HTMLInputElement).value = '口径';
    (root.querySelector('#adv-pref-val') as HTMLInputElement).value = '只看核心将';
    (root.querySelector('.advisor-pref-add') as HTMLButtonElement).click();
    setItem.mockRestore();
    expect(root.querySelector('.advisor-pref-list')?.textContent).toContain('只看核心将');

    (root.querySelector('.advisor-pref-del') as HTMLButtonElement).click(); // 删掉最新那条
    expect(root.querySelector('.advisor-pref-list')?.textContent).not.toContain('只看核心将');

    (root.querySelector('.advisor-pref-clear') as HTMLButtonElement).click();
    expect(root.querySelector('.advisor-profile summary')?.textContent).toContain('你的偏好（0 条）');
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
  });
});

// ─────────────────────────── 我的 box：识图建档（设计文档 §15） ───────────────────────────

describe('AI 顾问 · 我的 box（识图建档）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSettings(); // 设置是模块单例：光清 localStorage 会把上一条用例的设置漏给下一条
  });

  interface SavedBox {
    activeId: string;
    profiles: Array<{ id: string; name: string; box: { heroIds: string[]; skillIds: string[]; unmatched: string[]; meta: { model: string } | null } }>;
  }
  const savedBox = (): SavedBox | null => JSON.parse(localStorage.getItem(BOX_KEY) ?? 'null') as SavedBox | null;

  /** 模型的识图回复：按「卡面信息」报（名字 + 阵营 + 兵种 → 库里能唯一对上，跟真截图一个口径） */
  const recogReply = (ids: string[], extra: { unknownHero?: string; skills?: string[] } = {}): string =>
    '```json\n' +
    JSON.stringify({
      heroes: [
        ...ids.map((id) => {
          const h = getHeroById(id)!;
          return { name: h.name, faction: h.faction, troopType: TROOP_CHAR[h.troopType] ?? '' };
        }),
        ...(extra.unknownHero ? [{ name: extra.unknownHero, faction: null, troopType: null }] : []),
      ],
      skills: (extra.skills ?? []).map((name) => ({ name })),
      unrecognized: [],
    }) +
    '\n```';

  /** `once()` 分流：识图请求（系统提示词是「读图员」）给识别结果；偏好抽取给空档案 */
  const onceSplit =
    (reply: string) =>
    (req: ChatRequest): string =>
      req.messages[0].content.includes('读图员') ? reply : '{"add":[]}';

  /** 走完「选截图 → 开始识别 → 落盘」 */
  async function uploadAndRecognize(root: HTMLElement, reply: string): Promise<void> {
    const input = root.querySelector('.advisor-box-file') as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'wujiang.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await waitFor(() => root.querySelector('.abr-thumb'));
    (root.querySelector('.advisor-box-run') as HTMLButtonElement).click();
    await waitFor(() => (savedBox()?.profiles[0].box.heroIds.length ? savedBox() : null));
  }

  /** 取本轮注入的 box 块（**必须是 `<advisor_box>` 开头**：系统提示词第 7 条也提到了这个标签名） */
  const boxMsgOf = (transport: ReturnType<typeof createFakeTransport>, text: string): AdvisorMessage => {
    const req = transport.requests.find((r) => r.messages.some((m) => m.role === 'user' && m.content === text)) as ChatRequest;
    return req.messages.find((m) => m.role === 'system' && m.content.startsWith('<advisor_box>')) as AdvisorMessage;
  };

  it('① 上传截图 → 识别 → 按档案落盘 + 复核表（含待确认 / 未对上）；截图进过请求体', async () => {
    const trio = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const reply = recogReply(trio, { unknownHero: '根本不存在的将', skills: [] });
    const { view, root, transport } = setup({ once: onceSplit(reply) });
    view.open();
    await uploadAndRecognize(root, reply);

    const saved = savedBox()!;
    expect([...saved.profiles[0].box.heroIds].sort()).toEqual([...trio].sort());
    expect(saved.profiles[0].box.meta?.model).toContain('干跑');
    expect(saved.profiles[0].name).toBe('我的号');

    // 识图请求确实带上了图片（data URL）——不是空跑一次
    const vision = transport.onceRequests.find((r) => r.messages[0].content.includes('读图员'))!;
    expect(vision.messages[1].images?.[0].startsWith('data:image/png;base64,')).toBe(true);

    const review = root.querySelector('.advisor-box-review')?.textContent ?? '';
    expect(review).toContain('五星武将（3）');
    expect(review).toContain('待你确认');
    expect(review).toContain('根本不存在的将');
    expect(root.querySelector('.advisor-box-sum')?.textContent).toContain('武将 3 · 战法 0');
    expect(root.querySelector('.advisor-box-status')?.textContent).toContain('识别完成');
  });

  it('② 识别后每轮注入 <advisor_box>；方案里出现 box 外的将 → 标出来 + 应用禁用（仍算合法）', async () => {
    const trio = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    // 故意只识别前两个：干跑脚本给出的三将方案里有一个「用户没有」
    const reply = recogReply(trio.slice(0, 2));
    const { view, root, transport } = setup({ once: onceSplit(reply) });
    view.open();
    await uploadAndRecognize(root, reply);

    await view.__send('这队现在打木桩能打多少？');
    const boxMsg = boxMsgOf(transport, '这队现在打木桩能打多少？');
    expect(boxMsg.role).toBe('system');
    expect(boxMsg.content).toContain('武将 2');
    expect(boxMsg.content).toContain(getHeroById(trio[0])!.name);
    expect(boxMsg.content).toContain('严格模式：开');
    // block 里写清"box 只是给自己配将时的范围"，不是"什么都别问"
    expect(boxMsg.content).toContain('当他明确要你给他自己配将');
    expect(boxMsg.content).toContain('不受这份清单限制');

    const card = root.querySelector('.advisor-plan-card') as HTMLElement;
    expect(card.textContent).toContain('hero_not_in_box');
    expect(card.textContent).toContain('含你 box 外的将法');
    expect(card.textContent).not.toContain('不合法');
    expect((card.querySelector('.advisor-apply') as HTMLButtonElement).disabled).toBe(true);
    // 卡上给出两个比较主数字（八回合总伤 / 前三回合爆发）
    expect(card.textContent).toContain('八回合全队总伤');
    expect(card.textContent).toContain('前三回合爆发');
  });

  it('③ 三将都在 box 里 → 方案照常可应用；关掉严格模式 → 注入变成「关」', async () => {
    const trio = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const reply = recogReply(trio);
    const { view, root, applied, transport } = setup({ once: onceSplit(reply) });
    view.open();
    await uploadAndRecognize(root, reply);

    await view.__send('这队现在打木桩能打多少？');
    const okBtn = root.querySelector('.advisor-apply') as HTMLButtonElement;
    expect(okBtn.disabled).toBe(false);
    okBtn.click();
    expect(applied).toHaveLength(1);

    // 关掉严格模式：box 只当事实注入，不再拦
    (root.querySelector('#adv-strict') as HTMLInputElement).checked = false;
    (root.querySelector('#adv-strict') as HTMLInputElement).dispatchEvent(new Event('change'));
    await view.__send('再问一次');
    expect(boxMsgOf(transport, '再问一次').content).toContain('严格模式：关');
  });

  it('④ 多档案：新建 = 空白 box（上下文提示先要截图），切回原档案清单还在', async () => {
    const trio = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const reply = recogReply(trio);
    const { view, root, transport } = setup({ once: onceSplit(reply) });
    view.open();
    await uploadAndRecognize(root, reply);
    expect(root.querySelectorAll('.advisor-box-profile option')).toHaveLength(1);

    (root.querySelector('.advisor-box-new') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.advisor-box-profile option')).toHaveLength(2);
    expect(savedBox()?.profiles).toHaveLength(2);
    expect(root.querySelector('.advisor-box-review')?.textContent).toContain('五星武将（0）');

    await view.__send('换个号问问');
    expect(boxMsgOf(transport, '换个号问问').content).toContain('还没有 box');

    // 切回第一档 → 清单与注入都回来了
    const sel = root.querySelector('.advisor-box-profile') as HTMLSelectElement;
    sel.value = savedBox()!.profiles[0].id;
    sel.dispatchEvent(new Event('change'));
    expect(root.querySelector('.advisor-box-review')?.textContent).toContain('五星武将（3）');
    await view.__send('切回来了');
    expect(boxMsgOf(transport, '切回来了').content).toContain('武将 3');
  });

  it('⑤ 复核：删一条 / 手动补一条 / 清空（两下确认）；坏图明确报错不静默', async () => {
    const trio = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
    const reply = recogReply(trio);
    const { view, root } = setup({ once: onceSplit(reply) });
    view.open();
    await uploadAndRecognize(root, reply);

    // 删一条（记下删的是谁，待会儿手动补回来）
    const delBtn = root.querySelector('.abr-del') as HTMLButtonElement;
    const removedId = delBtn.dataset.id as string;
    delBtn.click();
    expect(savedBox()?.profiles[0].box.heroIds).toHaveLength(2);

    // 手动补一条（按名字搜 → 点**那一个**候选：同名多版时列表里有 SP 版，不能瞎点第一个）
    const addInput = root.querySelector('.abr-add-hero') as HTMLInputElement;
    addInput.value = getHeroById(removedId)!.name;
    (root.querySelector('.abr-add-hero-btn') as HTMLButtonElement).click();
    const cand = root.querySelector(`.abr-cands-hero .abr-cand[data-id="${removedId}"]`) as HTMLButtonElement;
    expect(cand).toBeTruthy();
    cand.click();
    expect(savedBox()?.profiles[0].box.heroIds).toHaveLength(3);
    expect(savedBox()?.profiles[0].box.heroIds).toContain(removedId);

    // 非图片文件 → 明确报错（不静默吞）
    const input = root.querySelector('.advisor-box-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['hi'], 'a.txt', { type: 'text/plain' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    await waitFor(() => ((root.querySelector('.advisor-box-status')?.textContent ?? '').includes('图片') ? true : null));

    // 清空两下确认
    const clear = root.querySelector('.advisor-box-clear') as HTMLButtonElement;
    clear.click();
    expect(clear.textContent).toContain('确认');
    clear.click();
    expect(savedBox()?.profiles[0].box.heroIds).toHaveLength(0);
    expect(root.querySelector('.advisor-box-review')?.textContent).toContain('五星武将（0）');
  });
});
