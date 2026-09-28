/**
 * AI 顾问 · 主站抽屉（view 层）
 * ---------------------------------------------------------------------------
 * 纪律（见 `docs/AI配将顾问-设计.md` §2/§7）：
 *   · **不认识引擎**——数字一律从 `AdvisorTurn.checks` / `ToolResult.data` 直读，不自己算；
 *   · LLM 也不参与数字路径——方案卡上的每个数都能点回某次工具返回或标准口径复算；
 *   · 三道关（合法 / 可溯源 / 已复算）缺一不可，`check.apply.enabled` 为 false 时「应用」禁用并显示原因。
 */
import { SKILL_REGISTRY } from '../../src/data/skills';
import { getHeroById, SLOTTED_HEROES } from '../heroes';
import { cfgOf } from './gate';
import { createLocalCache } from './cache';
import { runAdvisorTurn, type AdvisorEvent } from './loop';
import { evidenceZh, TraceLine } from './trace';
import { createBrowserTransport, createFakeTransport, type AdvisorSettings, type TokenUsage } from './transport';
import { makeCtx, type ToolCtx } from './tools';
import { DEFAULT_BUDGET, DEFAULT_CONFIRM_BATTLES, DEFAULT_DUMMY, PLAN_POSITIONS, type AdvisorPlan, type AdvisorTurn, type PlanCheck, type SearchQuote } from './types';
import type { AdvisorHost } from '../advisorHost';

const SETTINGS_KEY = 'dsh-advisor-settings-v1';
const FAKE_RUNS = 20;

interface ViewSettings extends AdvisorSettings {
  maxCalls: number;
  maxBattles: number;
  maxTokens: number;
  /** 长搜索前先问（用户 2026-09-29 口径：报价 + 确认） */
  askBeforeSearch: boolean;
  /** 超过多少场才问 */
  askFrom: number;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const heroName = (id: string): string => getHeroById(id)?.name ?? id;
const skillName = (id: string): string => SKILL_REGISTRY[id]?.name ?? id;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');

function loadSettings(): ViewSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ViewSettings>;
      return {
        baseUrl: p.baseUrl ?? 'https://api.deepseek.com/v1',
        model: p.model ?? 'deepseek-chat',
        key: p.key ?? '',
        maxCalls: p.maxCalls ?? DEFAULT_BUDGET.maxCalls,
        maxBattles: p.maxBattles ?? DEFAULT_BUDGET.maxBattles,
        maxTokens: p.maxTokens ?? DEFAULT_BUDGET.maxTokens,
        askBeforeSearch: p.askBeforeSearch ?? true,
        askFrom: p.askFrom ?? DEFAULT_CONFIRM_BATTLES,
      };
    }
  } catch {
    /* 忽略：localStorage 不可用时用默认值 */
  }
  return {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    key: '',
    maxCalls: DEFAULT_BUDGET.maxCalls,
    maxBattles: DEFAULT_BUDGET.maxBattles,
    maxTokens: DEFAULT_BUDGET.maxTokens,
    askBeforeSearch: true,
    askFrom: DEFAULT_CONFIRM_BATTLES,
  };
}

function saveSettings(s: ViewSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 存不了只影响下次打开 */
  }
}

/** 干跑演示用的方案：优先用面板当前队伍；**面板为空时**退回库里示例三人（正文里会说明） */
function fakePlanFor(hostPlan: AdvisorPlan): { plan: AdvisorPlan; demo: boolean } {
  if (hostPlan.slots.length >= 1) return { plan: hostPlan, demo: false };
  const ids = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
  return {
    plan: {
      slots: ids.map((heroId, i) => ({ position: PLAN_POSITIONS[i] ?? '中军', heroId, level: 40, skillIds: [] })),
      coreUnitIds: [],
      dummy: { ...DEFAULT_DUMMY },
    },
    demo: true,
  };
}

/** 干跑脚本（没配 key 时用）：读配置 → 真跑 20 场 → 用真实 evidenceId 出方案，链路完全一样 */
function fakeScript(plan: AdvisorPlan, demo: boolean) {
  return createFakeTransport([
    { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
    { calls: [{ id: 'c2', name: 'simulate', args: { plan, runs: FAKE_RUNS } }] },
    {
      text: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'tool');
        const id = /"evidenceId":"([^"]+)"/.exec(last?.content ?? '')?.[1] ?? 'ev-unknown';
        return [
          '（干跑演示：没接真模型，只验证链路与校验门）',
          demo ? '（你的配将区还是空的，这里用库里的示例三人演示一遍完整流程）' : '',
          '',
          '我先读了当前配将区，再对标准木桩真跑 20 场，拿到核心将伤害期望与 95% 半宽（见方案卡上的证据行）。',
          '方案卡上的数字来自「标准口径复算」（固定种子 20 场），不是模型写的。',
          '',
          '```json',
          JSON.stringify({ plans: [{ title: demo ? '示例三人（面板为空）' : '当前配置（原样）', plan, evidenceIds: [id] }] }),
          '```',
        ]
          .filter((x) => x !== '')
          .join('\n');
      },
    },
  ]);
}

export interface AdvisorViewOpts {
  host: AdvisorHost;
  /** 测试注入：假 transport（生产走 `createBrowserTransport`） */
  transport?: ReturnType<typeof createFakeTransport>;
  /** 测试注入：完整 ctx（生产按设置构造） */
  ctx?: ToolCtx;
  /** 强制干跑（无 key 时自动干跑） */
  fake?: boolean;
}

export interface AdvisorView {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
  /** 测试专用：等价于输入并点「发送」 */
  __send(text: string): Promise<void>;
}

export function mountAdvisor(root: HTMLElement, opts: AdvisorViewOpts): AdvisorView {
  let settings = loadSettings();
  let built = false;
  let running = false;
  let controller: AbortController | null = null;
  let usage: TokenUsage | null = null;
  let lastTurn: AdvisorTurn | null = null;
  let battles = 0;
  let tokens = 0;
  let trace = new TraceLine();

  const wrap = document.createElement('div');
  wrap.className = 'advisor-drawer';
  root.appendChild(wrap);

  const el = <T extends HTMLElement>(sel: string): T => wrap.querySelector(sel) as T;

  function build(): void {
    built = true;
    wrap.innerHTML = `
      <div class="advisor-head">
        <span class="advisor-title">AI 顾问 · ${esc(opts.host.teamLabel)}</span>
        <button type="button" class="advisor-close" title="收起">×</button>
      </div>
      <div class="advisor-body">
        <details class="advisor-settings">
          <summary>设置（模型 / 额度）</summary>
          <div class="advisor-row">
            <label>接口地址 <input id="adv-base" value="${esc(settings.baseUrl)}" /></label>
            <label>模型 <input id="adv-model" value="${esc(settings.model)}" /></label>
            <label>密钥 <input id="adv-key" type="password" value="${esc(settings.key)}" placeholder="sk-..." /></label>
          </div>
          <div class="advisor-row">
            <label class="advisor-chk"><input id="adv-fake" type="checkbox" /> 干跑（不联网）</label>
            <label class="advisor-chk"><input id="adv-ask" type="checkbox" ${settings.askBeforeSearch ? 'checked' : ''} /> 长搜索先问我</label>
            <label>超过 <input id="adv-askfrom" type="number" min="1" step="500" value="${settings.askFrom}" style="min-width:80px" /> 场先问</label>
          </div>
          <div class="advisor-row">
            <label>调用次数上限 <input id="adv-maxcalls" type="number" min="1" max="500" value="${settings.maxCalls}" /></label>
            <label>场次上限 <input id="adv-maxbattles" type="number" min="100" step="1000" value="${settings.maxBattles}" /></label>
            <label>词元上限 <input id="adv-maxtokens" type="number" min="1000" step="10000" value="${settings.maxTokens}" /></label>
          </div>
          <p class="advisor-note">密钥只存在本机浏览器里，直连厂商。口径：对**标准木桩**（防御 ${DEFAULT_DUMMY.defense} / 谋略 ${DEFAULT_DUMMY.strategy} / 步 / ${DEFAULT_DUMMY.troops}）的伤害期望——不是打你对面那队。</p>
        </details>
        <div class="advisor-trace"></div>
        <div class="advisor-confirm" hidden></div>
        <pre class="advisor-log"></pre>
        <div class="advisor-plans"></div>
        <div class="advisor-cost"></div>
        <div class="advisor-input-row">
          <textarea class="advisor-input" rows="2" placeholder="例：这队为什么伤害低？/ 文鸯怎么配输出最大化？/ 把它换成张辽试试"></textarea>
          <div class="advisor-buttons">
            <button type="button" class="btn primary advisor-send">发送</button>
            <button type="button" class="btn advisor-stop" disabled>取消</button>
          </div>
        </div>
      </div>`;

    if (!settings.key) (el<HTMLInputElement>('#adv-fake')).checked = true;
    el('.advisor-close').addEventListener('click', () => close());
    el('.advisor-send').addEventListener('click', () => void send(el<HTMLTextAreaElement>('.advisor-input').value));
    el('.advisor-stop').addEventListener('click', () => controller?.abort());
    el<HTMLTextAreaElement>('.advisor-input').addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && (ke.ctrlKey || ke.metaKey)) {
        ke.preventDefault();
        void send(el<HTMLTextAreaElement>('.advisor-input').value);
      }
    });
  }

  function readSettings(): ViewSettings {
    const s: ViewSettings = {
      baseUrl: el<HTMLInputElement>('#adv-base').value.trim(),
      model: el<HTMLInputElement>('#adv-model').value.trim(),
      key: el<HTMLInputElement>('#adv-key').value.trim(),
      maxCalls: Math.max(1, Math.floor(Number(el<HTMLInputElement>('#adv-maxcalls').value) || DEFAULT_BUDGET.maxCalls)),
      maxBattles: Math.max(100, Math.floor(Number(el<HTMLInputElement>('#adv-maxbattles').value) || DEFAULT_BUDGET.maxBattles)),
      maxTokens: Math.max(1000, Math.floor(Number(el<HTMLInputElement>('#adv-maxtokens').value) || DEFAULT_BUDGET.maxTokens)),
      askBeforeSearch: el<HTMLInputElement>('#adv-ask').checked,
      askFrom: Math.max(1, Math.floor(Number(el<HTMLInputElement>('#adv-askfrom').value) || DEFAULT_CONFIRM_BATTLES)),
    };
    return s;
  }

  /** 报价 + 确认：挂一个气条，点「开始」才返回 true（取消/中断按不跑处理，避免挂住） */
  function askConfirm(q: SearchQuote): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const bar = el('.advisor-confirm');
      bar.hidden = false;
      bar.innerHTML = `<span>即将执行 —— ${esc(q.label)}</span><button type="button" class="btn primary advisor-go">开始</button><button type="button" class="btn advisor-skip">不跑</button>`;
      el('.advisor-trace').textContent = `${trace.text()} · ⏳ 等你确认`;
      const finish = (v: boolean): void => {
        bar.hidden = true;
        bar.innerHTML = '';
        el('.advisor-trace').textContent = trace.text();
        resolve(v);
      };
      bar.querySelector('.advisor-go')!.addEventListener('click', () => finish(true));
      bar.querySelector('.advisor-skip')!.addEventListener('click', () => finish(false));
      controller?.signal.addEventListener('abort', () => finish(false), { once: true });
    });
  }

  function append(line: string): void {
    const log = el('.advisor-log');
    log.textContent += line;
    log.scrollTop = log.scrollHeight;
  }

  function renderPlanCard(check: PlanCheck, index: number): string {
    const rows = (['大营', '中军', '前锋'] as const)
      .map((pos) => {
        const slot = check.plan.slots.find((s) => s.position === pos);
        if (!slot) return `<tr><td>${pos}</td><td class="dim">（空）</td><td class="dim">—</td></tr>`;
        const skills = slot.skillIds.length ? slot.skillIds.map(skillName).join(' + ') : '<span class="dim">（未配可学战法）</span>';
        return `<tr><td>${pos}</td><td>${esc(heroName(slot.heroId))}<span class="dim"> Lv${slot.level}</span></td><td>${skills}</td></tr>`;
      })
      .join('');
    const rc = check.recompute;
    const search = check.search;
    const metrics = rc
      ? `<div class="pc-metric"><b>标准口径复算</b>（${rc.runs} 场 / 种子 ${rc.seed}）：核心将期望 <b>${num(rc.mean)}</b> ±${num(rc.halfWidth)}</div>`
      : '<div class="pc-metric bad">标准口径复算未完成</div>';
    const compare = search
      ? `<div class="pc-metric">搜索口径（来自「${evidenceZh(search.evidenceId)}」，${search.runs} 场）：${num(search.mean)} ±${num(search.halfWidth)} → ${
          check.judge === 'consistent' ? '区间重叠，<b>一致</b>' : '复算明显更低，<b>对口径敏感，谨慎采纳</b>'
        }</div>`
      : '<div class="pc-metric bad">方案没引用任何实测证据（未验证）</div>';
    const notes = [
      check.legal ? '' : `<div class="pc-metric bad">不合法：${esc(check.legalErrors.join('；'))}</div>`,
      check.evidenceOk ? '' : `<div class="pc-metric bad">证据核验失败：${esc(check.evidenceReason ?? '')}</div>`,
    ].join('');
    return `
      <div class="advisor-plan-card" data-plan="${index}">
        <div class="pc-title">${esc(check.title)}</div>
        <table class="pc-config"><tbody>${rows}</tbody></table>
        ${metrics}${compare}${notes}
        <div class="pc-actions">
          <button type="button" class="btn primary advisor-apply" data-plan="${index}" ${check.apply.enabled ? '' : 'disabled'}>应用到配将区</button>
          <span class="advisor-verify-note">${check.apply.enabled ? '三关通过（合法 / 可溯源 / 已复算）' : esc(check.apply.reason ?? '')}</span>
        </div>
      </div>`;
  }

  function renderTurn(turn: AdvisorTurn): void {
    lastTurn = turn;
    append(`\n【顾问】\n${turn.answer || '（空回答）'}\n`);
    el('.advisor-plans').innerHTML = turn.checks.map((c, i) => renderPlanCard(c, i)).join('');
    wrap.querySelectorAll('.advisor-apply').forEach((btn) =>
      btn.addEventListener('click', () => {
        const i = Number((btn as HTMLElement).dataset.plan);
        const check = lastTurn?.checks[i];
        if (!check?.apply.enabled) return;
        const r = opts.host.applyPlan(check.plan);
        append(r.ok ? '\n【已应用】方案写入配将区。\n' : `\n【应用失败】${r.message ?? ''}\n`);
      })
    );
  }

  function onEvent(e: AdvisorEvent): void {
    // 工具调用**压成一行**：轨迹行原地刷新，正文只写模型的话
    if (e.type === 'tool_start') trace.start(e.name);
    else if (e.type === 'tool_end') {
      battles += e.battles;
      trace.end(e.name, { battles: e.battles, ms: e.ms, cached: e.cached, ...(e.error ? { error: e.error } : {}) });
    } else if (e.type === 'tool_progress') trace.progress(e.name, e.done, e.total, e.label);
    else if (e.type === 'delta') {
      const log = el('.advisor-log');
      log.textContent += e.text;
      log.scrollTop = log.scrollHeight;
    } else if (e.type === 'usage') {
      usage = e.usage;
      tokens += e.usage.totalTokens;
    }
    if (trace.text()) el('.advisor-trace').textContent = trace.text();
    el('.advisor-cost').textContent = `本轮：${trace.count} 次工具调用 · ${num(battles)} 场 · 词元 ${num(tokens)}`;
    void usage;
  }

  async function send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || running) return;
    if (!built) build();
    const s = readSettings();
    const fake = el<HTMLInputElement>('#adv-fake').checked;
    if (!fake && (!s.key || !s.baseUrl || !s.model)) {
      append('\n【提示】真模型模式需要 baseURL / model / key（或勾上「干跑」看链路演示）。\n');
      return;
    }
    saveSettings(s);
    running = true;
    tokens = 0;
    trace = new TraceLine();
    el('.advisor-log').textContent = '';
    el('.advisor-trace').textContent = '';
    el('.advisor-plans').innerHTML = '';
    el<HTMLTextAreaElement>('.advisor-input').value = '';
    el<HTMLButtonElement>('.advisor-send').disabled = true;
    el<HTMLButtonElement>('.advisor-stop').disabled = false;
    controller = new AbortController();
    append(`【你】${q}\n【模式】${fake ? '干跑（假传输）' : `${s.model} @ ${s.baseUrl}`}\n`);

    const hostPlan = opts.host.readTeam();
    const fakePick = fakePlanFor(hostPlan);
    const ctx =
      opts.ctx ??
      makeCtx({
        fakeRuns: false,
        // 每次工具调用都重新读面板（`get_config` 要拿"此刻"的配置，不是开局快照）
        deps: { getConfig: () => cfgOf(opts.host.readTeam()) },
        budget: { maxCalls: s.maxCalls, maxBattles: s.maxBattles, maxTokens: s.maxTokens },
        // 跑批缓存：一次 L2 搜索 ≈8,000 场 / 60 秒，重复问不该重跑（刷新页面也还在）
        cache: createLocalCache(),
      });
    const transport = opts.transport ?? (fake ? fakeScript(fakePick.plan, fakePick.demo) : createBrowserTransport(s));
    // 报价 + 确认：长搜索开跑前问一句（用户可在设置里关掉或改阈值）
    if (s.askBeforeSearch) {
      ctx.confirm = opts.ctx?.confirm ?? askConfirm;
      ctx.confirmFrom = s.askFrom;
    }
    try {
      const turn = await runAdvisorTurn({ userText: q, ctx, transport, signal: controller.signal, onEvent });
      renderTurn(turn);
    } catch (e) {
      append(`\n【失败】${(e as Error)?.message ?? String(e)}\n`);
    } finally {
      running = false;
      el<HTMLButtonElement>('.advisor-send').disabled = false;
      el<HTMLButtonElement>('.advisor-stop').disabled = true;
      controller = null;
    }
  }

  function open(): void {
    if (!built) build();
    wrap.classList.add('open');
  }
  function close(): void {
    controller?.abort();
    wrap.classList.remove('open');
  }

  return {
    open,
    close,
    isOpen: () => wrap.classList.contains('open'),
    destroy() {
      controller?.abort();
      wrap.remove();
    },
    __send: send,
  };
}
