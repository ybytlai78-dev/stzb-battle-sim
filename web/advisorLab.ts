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
import { createBrowserTransport, createFakeTransport, type AdvisorSettings, type TokenUsage } from './advisor/transport';
import { makeCtx, type ToolCtx } from './advisor/tools';
import { DEFAULT_DUMMY, type AdvisorPlan, type AdvisorTurn } from './advisor/types';
import { SLOTTED_HEROES } from './heroes';
import { defaultCfg, type ViewCfg } from './teamConfig';

const SETTINGS_KEY = 'dsh-advisor-settings-v1';
/** 干跑模式跑几场（真跑；干跑模式下由假跑批即时返回） */
const FAKE_RUNS = 20;
/** 演示用队伍：优先 L2 实跑基线那三将，库里没有就取上架池前三 */
const DEMO_HEROES = ['h102003', 'h672', 'h574'];

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function loadSettings(): AdvisorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AdvisorSettings>;
      return { baseUrl: p.baseUrl ?? '', model: p.model ?? '', key: p.key ?? '' };
    }
  } catch {
    /* localStorage 不可用 → 空设置 */
  }
  return { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: '' };
}

function saveSettings(s: AdvisorSettings): void {
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
      <p class="muted small">key 只存在本机 localStorage（<code>${SETTINGS_KEY}</code>），直连厂商，不经过任何服务器。</p>

      <div class="row">
        <textarea id="lab-q" rows="3">这队现在的伤害期望是多少？先跑 20 场看看，再说有没有更值得换的战法。</textarea>
      </div>
      <div class="row">
        <button id="lab-send" class="btn primary">发送</button>
        <button id="lab-stop" class="btn" disabled>取消</button>
        <span id="lab-cost" class="muted small"></span>
      </div>

      <h2>事件日志</h2>
      <pre id="lab-log" class="log"></pre>
      <h2>本轮裁定</h2>
      <pre id="lab-verdict" class="log small">（还没跑）</pre>
      <h2>证据清单（方案卡上的数字只从这里来）</h2>
      <div id="lab-trace" class="trace muted small">（空）</div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const log = $('lab-log');
  const cost = $('lab-cost');
  const verdictEl = $('lab-verdict');
  const traceEl = $('lab-trace');
  const sendBtn = $<HTMLButtonElement>('lab-send');
  const stopBtn = $<HTMLButtonElement>('lab-stop');

  const append = (line: string): void => {
    log.textContent += `${line}\n`;
    log.scrollTop = log.scrollHeight;
  };

  let toolCount = 0;
  let battles = 0;
  const onEvent = (e: AdvisorEvent): void => {
    if (e.type === 'round') append(`— 第 ${e.index + 1} 轮 —`);
    else if (e.type === 'delta') {
      log.textContent += e.text;
      log.scrollTop = log.scrollHeight;
    } else if (e.type === 'tool_start') {
      toolCount += 1;
      append(`▶ 调用 ${e.name}`);
    } else if (e.type === 'tool_end') {
      battles += e.battles;
      append(e.error ? `✘ ${e.name} 报错：${e.error}` : `✔ ${e.name}（${e.battles} 场 / ${e.ms}ms）`);
    } else if (e.type === 'usage') {
      usage = e.usage;
    }
    cost.textContent = `本轮：${toolCount} 次工具调用 · ${battles} 场${usage ? ` · token ${usage.totalTokens}` : ''}`;
  };

  const renderVerdict = (turn: AdvisorTurn): void => {
    const v = turn.verdict;
    verdictEl.textContent = [
      `合法（关 1）：${v.legal ? '通过' : '不通过'}`,
      `可溯源（关 2）：${v.verified ? '通过' : '不通过'}`,
      `标准口径复算（关 3）：${v.recomputed ? '通过' : '未接入（实施计划 Task 5）'}`,
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

  const send = async (): Promise<void> => {
    if (running) return;
    const s: AdvisorSettings = {
      baseUrl: $<HTMLInputElement>('lab-base').value.trim(),
      model: $<HTMLInputElement>('lab-model').value.trim(),
      key: $<HTMLInputElement>('lab-key').value.trim(),
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
    traceEl.textContent = '（空）';
    toolCount = 0;
    battles = 0;
    usage = null;
    cost.textContent = '';
    sendBtn.disabled = true;
    stopBtn.disabled = false;
    controller = new AbortController();

    saveSettings(s);
    fakeMode = useFake;
    const plan = demoPlan(cfg);
    const ctx: ToolCtx = makeCtx({ fakeRuns: false, deps: { getConfig: () => cfg } });
    const transport = fakeMode ? fakeScript(plan) : createBrowserTransport(s);

    append(`【你】${$<HTMLTextAreaElement>('lab-q').value.trim()}`);
    append(`【模式】${fakeMode ? '干跑（假传输）' : `${s.model} @ ${s.baseUrl}`}`);
    append('');
    try {
      const turn = await runAdvisorTurn({
        userText: $<HTMLTextAreaElement>('lab-q').value.trim(),
        ctx,
        transport,
        signal: controller.signal,
        onEvent,
      });
      append('');
      append('【顾问】');
      append(turn.answer || '（空回答）');
      renderVerdict(turn);
    } catch (e) {
      append('');
      append(`【失败】${(e as Error)?.message ?? String(e)}`);
      verdictEl.textContent = `本轮失败：${(e as Error)?.message ?? String(e)}`;
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
