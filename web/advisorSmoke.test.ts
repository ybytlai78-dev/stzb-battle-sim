/**
 * AI 顾问抽屉（主站内嵌）端到端：点导航 → 开抽屉 → 干跑一问 → 出方案卡 → 三关通过 → 应用到配将区
 * ---------------------------------------------------------------------------
 * 这条测试就是"接入主站"的验收：**不 mock 抽屉**，走真实的 loop + 工具 + 校验门 + 关 3 复算，
 * 只把 LLM 传输层换成假脚本（脚本从工具返回里读真实 evidenceId，所以关 2 的溯源是真校验）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountAdvisor } from './advisor/view';
import { createFakeTransport, type ChatRequest } from './advisor/transport';
import { makeCtx } from './advisor/tools';
import { cfgOf } from './advisor/gate';
import { DEFAULT_DUMMY, type AdvisorPlan } from './advisor/types';
import { SLOTTED_HEROES } from './heroes';
import type { AdvisorHost } from './advisorHost';

const heroIds = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);

const planOf = (): AdvisorPlan => ({
  slots: heroIds.map((heroId, i) => ({ position: (['大营', '中军', '前锋'] as const)[i], heroId, level: 40, skillIds: [] })),
  coreUnitIds: [],
  dummy: { ...DEFAULT_DUMMY },
});

/** 假 LLM：先 simulate，再用**真实 evidenceId** 出一个方案；顺带在正文里引用一次数字（关 2 要核） */
const script = (plan: AdvisorPlan, opts: { badEvidence?: boolean } = {}) =>
  createFakeTransport([
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
  ]);

function setup(opts: { badEvidence?: boolean } = {}) {
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
  const view = mountAdvisor(root, { host, transport: script(plan, opts), ctx });
  return { view, applied, root, plan };
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
  });

  it('挂载后默认收起，open() 才显示', () => {
    const { view, root } = setup();
    const drawer = root.querySelector('.advisor-drawer') as HTMLElement;
    expect(drawer.classList.contains('open')).toBe(false);
    view.open();
    expect(drawer.classList.contains('open')).toBe(true);
    expect(drawer.querySelector('.advisor-title')?.textContent).toContain('红队');
    view.close();
    expect(drawer.classList.contains('open')).toBe(false);
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
    // 把阈值调到 1 场，好让干跑脚本那次 20 场也走确认
    (root.querySelector('#adv-askfrom') as HTMLInputElement).value = '1';
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
    (root.querySelector('#adv-askfrom') as HTMLInputElement).value = '1';
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
    (root.querySelector('#adv-fake') as HTMLInputElement).checked = false;
    (root.querySelector('#adv-key') as HTMLInputElement).value = '';
    await view.__send('在吗');
    expect(root.querySelector('.advisor-log')?.textContent).toContain('需要 baseURL / model / key');
    expect(root.querySelector('.advisor-plan-card')).toBeNull();
  });
});
