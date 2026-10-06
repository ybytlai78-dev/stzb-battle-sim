/**
 * AI 配将顾问 · 最小文本界面（独立页 advisor-lab.html，**不进主站**）
 * ---------------------------------------------------------------------------
 * 目的：用最小成本验证「AI 跑数据 → 分析 → 给配将建议」这条链到底成不成立。
 * 形态：纯文本（设置区 + 提问框 + 事件日志 + 裁定 + 证据清单），没有抽屉 / 没有样式工程。
 *
 * 两种模式：
 *   · 真模型：填 baseURL / model / key（只存本机 localStorage），走 `createBrowserTransport`；
 *   · 干跑（`?fake=1` 或没填 key 时勾选）：走 `createFakeTransport` 的演示脚本 —— **不联网也能看完整链路**
 *     （读配置 → 真跑 20 场 → 出方案卡），用于验证「数字确实来自工具、方案必须带证据」这两条规矩。
 *
 * 注意：工具层的跑批是**真的**（干跑模式只把跑批换成毫秒返回的假实现，`?runs=` 可控）。
 */
import { runAdvisorTurn, type AdvisorEvent } from './advisor/loop';
import { TraceLine } from './advisor/trace';
import { createLocalCache } from './advisor/cache';
import { createBrowserTransport, createFakeTransport, type AdvisorSettings, type TokenUsage } from './advisor/transport';
import { createTools, makeCtx, type ToolCtx } from './advisor/tools';
import { toolSurfaceChars } from './advisor/router';
import { emptySession, renderTaskBlock } from './advisor/memory';
import { DEFAULT_BUDGET, DEFAULT_DUMMY, type AdvisorPlan, type AdvisorTurn } from './advisor/types';
import { SLOTTED_HEROES } from './heroes';
import { defaultCfg, type ViewCfg } from './teamConfig';

const SETTINGS_KEY = 'dsh-advisor-settings-v1';
/** 干跑模式跑几场 */
const FAKE_RUNS = 20;
/** 演示用队伍：优先 L2 实跑基线那三将，库里没有就取上架池前三 */
const DEMO_HEROES = ['h102003', 'h672', 'h574'];

/** 界面上的额度设置（用户 2026-09-29：别为省 token 卡住模型；搜索是一等公民） */
interface LabSettings extends AdvisorSettings {
  maxCalls: number;
  maxBattles: number;
  maxTokens: number;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function loadSettings(): LabSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<LabSettings>;
      return {
        baseUrl: p.baseUrl ?? '',
        model: p.model ?? '',
        key: p.key ?? '',
        maxCalls: p.maxCalls ?? DEFAULT_BUDGET.maxCalls,
        maxBattles: p.maxBattles ?? DEFAULT_BUDGET.maxBattles,
        maxTokens: p.maxTokens ?? DEFAULT_BUDGET.maxTokens,
      };
    }
  } catch {
    /* localStorage 不可用 → 空设置 */
  }
  return {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    key: '',
    maxCalls: DEFAULT_BUDGET.maxCalls,
    maxBattles: DEFAULT_BUDGET.maxBattles,
    maxTokens: DEFAULT_BUDGET.maxTokens,
  };
}

function saveSettings(s: LabSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 存不了就只影响下次打开 */
  }
}

/** 演示队伍配置（合法：三名上架武将） */
export function demoCfg(): ViewCfg {
  const ids = DEMO_HEROES.filter((id) => SLOTTED_HEROES.some((h) => h.id === id));
  return defaultCfg(ids.length === 3 ? ids : SLOTTED_HEROES.slice(0, 3).map((h) => h.id));
}

function demoPlan(cfg: ViewCfg): AdvisorPlan {
  return {
    slots: cfg.slots.map((s, i) => ({
      position: (['大营', '中军', '前锋'] as const)[i],
      heroId: s.heroId,
      level: s.level,
      skillIds: [...s.skillIds],
    })),
    coreUnitIds: [],
    dummy: { ...DEFAULT_DUMMY },
  };
}

/** 干跑脚本：读配置 → 真跑 20 场 → 用**真实 evidenceId** 出一个方案（演示整条链） */
function fakeScript(plan: AdvisorPlan) {
  return createFakeTransport([
    { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
    { calls: [{ id: 'c2', name: 'simulate', args: { plan, runs: FAKE_RUNS } }] },
    {
      text: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'tool');
        const id = /"evidenceId":"([^"]+)"/.exec(last?.content ?? '')?.[1] ?? 'ev-unknown';
        const payload = JSON.stringify({
          plans: [{ title: '当前配置（原样，干跑演示）', plan, evidenceIds: [id] }],
        });
        return [
          '（干跑演示：没接真模型，只验证链路）',
          '',
          '我先读了当前配置，再对不还手的木桩真跑了 20 场，拿到核心将的伤害期望与 95% 半宽（见下方证据行）。',
          '这一步的意义是：**结论里的每个数字都能点回某一次工具返回**，而不是模型自己算的。',
          '',
          '```json',
          payload,
          '```',
        ].join('\n');
      },
    },
  ]);
}

export interface AdvisorLabHandle {
  destroy(): void;
}

export function mountAdvisorLab(root: HTMLElement): AdvisorLabHandle {
  const cfg = demoCfg();
  const params = new URLSearchParams(location.search);
  const settings = loadSettings();
  let fakeMode = params.get('fake') === '1' || !settings.key;
  let running = false;
  let controller: AbortController | null = null;
  let usage: TokenUsage | null = null;

  root.innerHTML = `
    <div class="lab">
      <h1>AI 顾问实验室 <span class="muted">（最小文本界面 · 未并入主站）</span></h1>
      <p class="muted">
        当前演示队伍：${cfg.slots.map((s) => s.heroId).join(' / ')}（士气 ${cfg.morale}、${cfg.rounds} 回合、木桩 防御 ${DEFAULT_DUMMY.defense} / 谋略 ${DEFAULT_DUMMY.strategy}）。
        <a href="/">← 返回主站</a>
      </p>

      <div class="row">
        <label>baseURL <input id="lab-base" value="${esc(settings.baseUrl)}" placeholder="https://api.deepseek.com/v1" /></label>
        <label>model <input id="lab-model" value="${esc(settings.model)}" placeholder="deepseek-chat" /></label>
        <label>key <input id="lab-key" type="password" value="${esc(settings.key)}" placeholder="sk-..." /></label>
        <label class="chk"><input id="lab-fake" type="checkbox" ${fakeMode ? 'checked' : ''} /> 干跑（假传输：不联网、不花 token）</label>
      </div>
      <div class="row">
        <label>单轮工具调用上限 <input id="lab-maxcalls" type="number" min="1" max="500" value="${settings.maxCalls}" style="min-width:90px" /></label>
        <label>单轮场次上限 <input id="lab-maxbattles" type="number" min="100" step="1000" value="${settings.maxBattles}" style="min-width:110px" /></label>
        <label>单轮 token 上限 <input id="lab-maxtokens" type="number" min="1000" step="10000" value="${settings.maxTokens}" style="min-width:120px" /></label>
        <span class="muted small">时间上限 ${Math.round(DEFAULT_BUDGET.maxMs / 1000)} 秒；超限 = 拒绝执行并把"预计多少场、已用多少"回灌给模型（不是静默截断）。</span>
      </div>
      <p class="muted small">key 只存在本机 localStorage（<code>${SETTINGS_KEY}</code>），直连厂商，不经过任何服务器。</p>

      <div class="row">
        <textarea id="lab-q" rows="3">这队现在的伤害期望是多少？先跑 20 场看看，再说有没有更值得换的战法。</textarea>
      </div>
      <div class="row">
        <button id="lab-send" class="btn primary">发送</button>
        <button id="lab-stop" class="btn" disabled>取消</button>
        <span id="lab-cost" class="muted small"></span>
      </div>
      <div id="lab-progress" class="progress"></div>

      <h2>事件日志</h2>
      <div id="lab-confirm" class="confirm-bar" hidden></div>
      <div id="lab-trace" class="trace-line"></div>
      <pre id="lab-log" class="log"></pre>
      <h2>本轮裁定</h2>
      <pre id="lab-verdict" class="log small">（还没跑）</pre>
      <h2>路由 <span class="muted small">（思考模式分档 —— 模型这一轮实际看到了什么，设计文档 §16）</span></h2>
      <pre id="lab-route" class="log small">（还没跑）</pre>
      <h2>证据清单（方案卡上的数字只从这里来）</h2>
      <div id="lab-trace" class="trace muted small">（空）</div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const log = $('lab-log');
  const cost = $('lab-cost');
  const verdictEl = $('lab-verdict');
  const routeEl = $('lab-route');
  const traceEl = $('lab-trace');
  const confirmEl = $('lab-confirm');
  const sendBtn = $<HTMLButtonElement>('lab-send');
  const stopBtn = $<HTMLButtonElement>('lab-stop');

  const append = (line: string): void => {
    log.textContent += `${line}\n`;
    log.scrollTop = log.scrollHeight;
  };

  let toolCount = 0;
  let battles = 0;
  let tokens = 0;
  let trace = new TraceLine();
  /** 会话状态（实验页没有记忆层，就按"这一页里跑过没有"算）：跑成功过工具 → 首轮锚定失效 */
  let sessionHadToolCall = false;
  /** 会话首问（Task 回显的原料；与生产口径一致：只在为空时写一次） */
  let labTask = '';
  let caps = { maxCalls: settings.maxCalls, maxTokens: settings.maxTokens };
  const onEvent = (e: AdvisorEvent): void => {
    // 工具调用压成一行（与主站抽屉同口径）
    if (e.type === 'round') {
      /* 轮次不再单独占行 */
    } else if (e.type === 'delta') {
      log.textContent += e.text;
      log.scrollTop = log.scrollHeight;
    } else if (e.type === 'tool_start') {
      toolCount += 1;
      trace.start(e.name);
    } else if (e.type === 'tool_end') {
      battles += e.battles;
      trace.end(e.name, { battles: e.battles, ms: e.ms, cached: e.cached, ...(e.error ? { error: e.error } : {}) });
    } else if (e.type === 'tool_progress') {
      trace.progress(e.name, e.done, e.total, e.label);
    } else if (e.type === 'usage') {
      usage = e.usage;
      tokens += e.usage.totalTokens;
    }
    traceEl.textContent = trace.text();
    cost.textContent = `本轮：${toolCount}/${caps.maxCalls} 次工具调用 · ${battles} 场 · 词元 ${tokens} / ${caps.maxTokens}`;
  };

  const renderVerdict = (turn: AdvisorTurn): void => {
    const v = turn.verdict;
    verdictEl.textContent = [
      `合法（关 1）：${v.legal ? '通过' : '不通过'}`,
      `可溯源（关 2）：${v.verified ? '通过' : '不通过'}`,
      `标准口径复算（关 3）：${v.recomputed ? '通过' : '本轮没有方案（或方案未复算）'}`,
      `「应用」：${v.apply.enabled ? '可用' : `禁用 —— ${v.apply.reason ?? ''}`}`,
      `方案数：${turn.plans.length}${turn.degraded ? '（无工具模式：模型不支持工具调用）' : ''}`,
    ].join('\n');
    traceEl.innerHTML = turn.toolCalls.length
      ? turn.toolCalls
          .map(
            (t) =>
              `<div class="trace-row"><code>${esc(t.evidenceId)}</code> <b>${esc(t.name)}</b> · ${t.stats.battles} 场 / ${t.stats.ms}ms<br /><span>${esc(t.summary)}</span></div>`
          )
          .join('')
      : '（空）';
  };

  /**
   * 路由面板（S4）= 顾问自己的 `dev_router_status`：把**这一轮模型实际看到的东西**摊开——
   * 档位 / 工具面（名字 + 字符数 + 相对全量省了多少）/ 首轮锚定 / 主动开档记录 /
   * 以及原样贴出的 Task 块与本轮近场引导。全部来自 `turn.route` 与 `turn.messages`（**实际发出去的那份**），
   * 不是重新推导一遍——这样"面板说省了 44%"和线上 payload 不可能对不上。
   */
  const renderRoute = (turn: AdvisorTurn): void => {
    const route = turn.route;
    if (!route) {
      routeEl.textContent = '（本轮没有路由快照：走了降级路径（模型不支持工具调用）或旧入口）';
      return;
    }
    const all = createTools();
    const chars = toolSurfaceChars(all, route.toolNames);
    const full = toolSurfaceChars(all, all.map((t) => t.name));
    const save = full ? Math.round((1 - chars / full) * 100) : 0;
    const guide = [...turn.messages].reverse().find((m) => m.content.includes('<advisor_route>'));
    const task = turn.messages.find((m) => m.role === 'system' && m.content.startsWith('【本次会话的任务】'));
    routeEl.textContent = [
      `档位：${route.tiers.join(' + ')}${route.anchor ? '　★ 首轮锚定生效中（会话还没跑过工具）' : ''}`,
      `工具面：${route.toolNames.length} 个 / ${chars} 字符　（全量 ${all.length} 个 / ${full} 字符，省 ${save}%）`,
      `工具：${route.toolNames.join(', ')}`,
      route.promotions.length
        ? `主动开档：${route.promotions.map((p) => `${p.tier}（第 ${p.round} 轮开，理由：${p.why}）`).join('；')}`
        : '主动开档：无',
      turn.selfCorrect?.length
        ? `交付前自检（§16.22）：触发过 —— 回灌后补上引用的是这些数字：${turn.selfCorrect.join('、')}`
        : '交付前自检：未触发（正文里没有裸报的大数字）',
      '',
      task ? `【Task 块（静态 system，每轮都带）】\n${task.content}` : '【Task 块】未注入（会话首问尚未落盘）',
      '',
      guide ? `【本轮近场引导（贴在提问之后）】\n${guide.content}` : '（本轮没有引导块）',
    ].join('\n');
  };

  const send = async (): Promise<void> => {
    if (running) return;
    const s: LabSettings = {
      baseUrl: $<HTMLInputElement>('lab-base').value.trim(),
      model: $<HTMLInputElement>('lab-model').value.trim(),
      key: $<HTMLInputElement>('lab-key').value.trim(),
      maxCalls: Math.max(1, Math.floor(Number($<HTMLInputElement>('lab-maxcalls').value) || DEFAULT_BUDGET.maxCalls)),
      maxBattles: Math.max(100, Math.floor(Number($<HTMLInputElement>('lab-maxbattles').value) || DEFAULT_BUDGET.maxBattles)),
      maxTokens: Math.max(1000, Math.floor(Number($<HTMLInputElement>('lab-maxtokens').value) || DEFAULT_BUDGET.maxTokens)),
    };
    const useFake = $<HTMLInputElement>('lab-fake').checked;
    // 前置校验：真模型模式缺设置就别发请求（否则只会得到一句 401，白等）
    if (!useFake && (!s.key || !s.baseUrl || !s.model)) {
      log.textContent = '';
      append('【提示】真模型模式需要 baseURL / model / key 三者齐全（key 只存本机 localStorage）。');
      append('想先看链路演示，就勾上「干跑（假传输）」。');
      verdictEl.textContent = '未发出请求：设置不全';
      traceEl.textContent = '（空）';
      return;
    }
    running = true;
    log.textContent = '';
    verdictEl.textContent = '（跑着呢…）';
    routeEl.textContent = '（跑着呢…）';
    traceEl.textContent = '';
    toolCount = 0;
    battles = 0;
    tokens = 0;
    usage = null;
    trace = new TraceLine();
    caps = { maxCalls: s.maxCalls, maxTokens: s.maxTokens };
    cost.textContent = '';
    sendBtn.disabled = true;
    stopBtn.disabled = false;
    controller = new AbortController();

    saveSettings(s);
    fakeMode = useFake;
    const plan = demoPlan(cfg);
    const ctx: ToolCtx = makeCtx({
      fakeRuns: false,
      deps: { getConfig: () => cfg },
      budget: { maxCalls: s.maxCalls, maxBattles: s.maxBattles, maxTokens: s.maxTokens },
      cache: createLocalCache(),
    });
    // 报价 + 确认（实验页用固定阈值：超过 2000 场先问）
    ctx.confirm = (q) =>
      new Promise<boolean>((resolve) => {
        const bar = confirmEl;
        bar.hidden = false;
        bar.innerHTML = `<span>即将执行 —— ${esc(q.label)}</span><button type="button" class="btn primary lab-go">开始</button><button type="button" class="btn lab-skip">不跑</button>`;
        const finish = (v: boolean): void => {
          bar.hidden = true;
          bar.innerHTML = '';
          resolve(v);
        };
        bar.querySelector('.lab-go')!.addEventListener('click', () => finish(true));
        bar.querySelector('.lab-skip')!.addEventListener('click', () => finish(false));
        controller?.signal.addEventListener('abort', () => finish(false), { once: true });
      });
    const transport = fakeMode ? fakeScript(plan) : createBrowserTransport(s);

    append(`【你】${$<HTMLTextAreaElement>('lab-q').value.trim()}`);
    append(`【模式】${fakeMode ? '干跑（假传输）' : `${s.model} @ ${s.baseUrl}`}`);
    append('');
    try {
      const q = $<HTMLTextAreaElement>('lab-q').value.trim();
      if (!labTask) labTask = q; // 会话首问 = Task（与生产 `memory.ensureTask` 同口径）
      const turn = await runAdvisorTurn({
        userText: q,
        ctx,
        transport,
        signal: controller.signal,
        onEvent,
        // 与生产同款的三个注入（S2/S3）：任务回显、首轮锚定、近距离引导由 loop 自动贴
        taskText: renderTaskBlock({ ...emptySession(), task: labTask }),
        anchor: !sessionHadToolCall,
      });
      if (turn.toolCalls.length) sessionHadToolCall = true;
      append('');
      append('【顾问】');
      append(turn.answer || '（空回答）');
      renderVerdict(turn);
      renderRoute(turn);
    } catch (e) {
      append('');
      append(`【失败】${(e as Error)?.message ?? String(e)}`);
      verdictEl.textContent = `本轮失败：${(e as Error)?.message ?? String(e)}`;
      routeEl.textContent = '本轮失败：没有路由快照';
    } finally {
      running = false;
      sendBtn.disabled = false;
      stopBtn.disabled = true;
      controller = null;
    }
  };

  sendBtn.addEventListener('click', () => void send());
  stopBtn.addEventListener('click', () => controller?.abort());

  return {
    destroy() {
      controller?.abort();
      root.innerHTML = '';
    },
  };
}
