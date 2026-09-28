/**
 * 伤害期望模型页面（L2 视图）：配置队伍 → **模拟测评（真引擎）**：木桩不还手，粗筛 3 场 → 组合榜单前十
 * → 决赛 ≥20 场 → 每套配置的伤害期望排行；下方解析式回合期望保留作对照。
 * 独立页 round-model.html，不并入主站（用户 2026-09-22 口径）。
 */
import type { TroopType } from '../src/engine/types';
import { HERO_RECORDS, TROOP_CHAR } from './heroes';
import { renderRoundChart, renderRoundLegend, SOURCE_COLOR, fmt } from './roundChart';
import { EFFECT_LABEL, SOURCE_ORDER, windowTotals, type RoundModelResult } from './roundModel';
import {
  autoCoreUnits,
  estimateBattles,
  runSimExpectationAsync,
  simSlots,
  slotKey,
  FINAL_RUNS_MIN,
  FINAL_RUNS_MAX,
  type SimExpectAsyncOptions,
  type SimExpectResult,
} from './simExpectation';
import { simControlsHtml, simProgressHtml, simResultHtml } from './simExpectView';
import { buildUnits, computeResult, defaultCfg, renderConfigPanel, type ViewCfg } from './teamConfig';

/** 挂载页面（出错时把报错画进页面，避免只看到空白/半边 UI） */
export function mountRoundModel(root: HTMLElement): void {
  try {
    mountRoundModelInner(root);
  } catch (err) {
    root.innerHTML = `
      <div style="max-width:900px;margin:40px auto;padding:20px;border:1px solid #6b3b3b;border-radius:12px;background:#1b1418;color:#ffb4b4;font:14px/1.7 'Microsoft YaHei',sans-serif">
        <h2 style="margin:0 0 10px;color:#ff6b6b">回合模型页面出错</h2>
        <pre style="white-space:pre-wrap;color:#ffd8d8">${String(err && (err as Error).stack ? (err as Error).stack : err)}</pre>
      </div>`;
  }
}

function mountRoundModelInner(root: HTMLElement): void {
  const cfg = defaultCfg();
  const snapshots: Array<{ name: string; score: number; total: number; rounds: number }> = [];
  /** 口径回合数：3 = 前三回合，cfg.rounds = 整局 */
  let objectiveRounds = 3;

  root.innerHTML = `
    <div class="rm-wrap">
      <header class="rm-head">
        <div>
          <h1>回合期望模型 · 前三回合总伤</h1>
          <p class="rm-sub">
            <b>主口径 = 真引擎模拟测评</b>：靶子是<b>不还手的木桩 ×3</b>（不放战法、不普攻），
            逐槽粗筛 3 场 → 组合榜单前十 → 决赛 ≥20 场，汇总出<b>每套配置的伤害期望排行</b>。
            这里只算伤害期望——胜负判定是 L4 的事。下方解析式期望保留作对照（口径不含控制 / 规避 / 兵力截断）。
          </p>
        </div>
        <div class="rm-head-links">
          <a class="rm-back" href="/optimize.html">组合优化（L2/L3）→</a>
          <a class="rm-back" href="/damage-model.html">单次伤害模型 →</a>
          <a class="rm-back" href="/index.html">返回配将</a>
        </div>
      </header>
      <div class="rm-grid">
        <aside class="rm-card rm-side" id="rm-config"></aside>
        <main class="rm-main">
          <section class="rm-card rm-hero" id="rm-summary"></section>
          <section class="rm-card rm-sim-card" id="rm-sim" data-state="idle">
            <h2>模拟测评 · 伤害期望排行 <span class="rm-dim" id="rm-sim-hint"></span></h2>
            <div id="rm-sim-controls"></div>
            <div id="rm-sim-progress"></div>
            <div id="rm-sim-result">
              <div class="rm-note">点「开始模拟测评」：靶子是不还手的木桩（不放战法、不普攻）；
              先逐槽粗筛（默认每个候选战法 3 场），再把整队组合排榜单（前 10 名）进决赛（默认每套 20 场），
              最后按伤害期望排行。</div>
            </div>
          </section>
          <section class="rm-card">
            <h2>每回合期望伤害（解析口径 · 按来源堆叠）</h2>
            <div class="rm-legend" id="rm-legend"></div>
            <div class="rm-chart" id="rm-chart"></div>
          </section>
          <section class="rm-card">
            <h2>来源拆解</h2>
            <div id="rm-sources"></div>
          </section>
          <section class="rm-card">
            <h2>生效修正（自动从战法抽取）</h2>
            <div id="rm-effects"></div>
          </section>
          <section class="rm-card rm-warn-card">
            <h2>模型未覆盖 <span class="rm-dim" id="rm-warn-count"></span></h2>
            <div id="rm-warnings"></div>
          </section>
        </main>
      </div>
    </div>
  `;

  const configEl = root.querySelector<HTMLElement>('#rm-config')!;
  const summaryEl = root.querySelector<HTMLElement>('#rm-summary')!;
  const chartEl = root.querySelector<HTMLElement>('#rm-chart')!;
  const legendEl = root.querySelector<HTMLElement>('#rm-legend')!;
  const sourcesEl = root.querySelector<HTMLElement>('#rm-sources')!;
  const effectsEl = root.querySelector<HTMLElement>('#rm-effects')!;
  const warningsEl = root.querySelector<HTMLElement>('#rm-warnings')!;
  const warnCountEl = root.querySelector<HTMLElement>('#rm-warn-count')!;
  const simEl = root.querySelector<HTMLElement>('#rm-sim')!;
  const simControlsEl = root.querySelector<HTMLElement>('#rm-sim-controls')!;
  const simProgressEl = root.querySelector<HTMLElement>('#rm-sim-progress')!;
  const simResultEl = root.querySelector<HTMLElement>('#rm-sim-result')!;
  const simHintEl = root.querySelector<HTMLElement>('#rm-sim-hint')!;

  /* ──────────────────── 模拟测评（真引擎 · 伤害期望排行） ────────────────────
   * 状态留在闭包里：改配置只重画解析口径那几张卡，模拟结果不丢；
   * 配置与「跑结果时的配置」不一致时给一条「已过期」提示（不静默拿旧数字当新配置的结论）。 */
  const simState: {
    result: SimExpectResult | null;
    signature: string;
    running: boolean;
    coarseRuns: number;
    finalRuns: number;
    /** 决赛上限（与榜首 95% 区间重叠时自适应加跑到这里） */
    finalRunsMax: number;
    /** 区间重叠是否自动加跑 */
    adaptiveFinals: boolean;
    unitKeep: number;
    pairCarriers: number;
    coarseTop: number;
    maxCombos: number;
    rankBy: 'total' | 'first3';
    dummyTroops: number;
    seed: number;
    swapSides: boolean;
    /** 上次渲染控件时的空槽位指纹（空槽变化才重建参与匹配 / 排序口径勾选） */
    slotSig: string;
    /** 「参与匹配的槽位」是否被人动过（没动过 = 默认全部空槽；动过且勾空 = 只测评不搜索） */
    matchSlotTouched: boolean;
  } = {
    result: null,
    signature: '',
    running: false,
    coarseRuns: 3,
    finalRuns: FINAL_RUNS_MIN,
    finalRunsMax: FINAL_RUNS_MAX,
    adaptiveFinals: true,
    unitKeep: 32,
    pairCarriers: 10,
    coarseTop: 32,
    maxCombos: 1000,
    rankBy: 'total',
    dummyTroops: 150000,
    seed: 20260922,
    swapSides: true,
    slotSig: '',
    matchSlotTouched: false,
  };

  /** 配置指纹：判断已有模拟结果是否还对得上当前配置 */
  function cfgSignature(c: ViewCfg): string {
    return JSON.stringify([
      c.slots.map((s) => [s.heroId, s.level, s.addAttack, s.addStrategy, s.troopType, s.skillIds.join(',')]),
      c.morale,
      c.enemy,
      c.rounds,
    ]);
  }

  /** 空槽位（渲染「参与匹配的槽位 / 排序口径」勾选用）：与模块 `simSlots` 同口径 */
  function emptySlotsOf(): Array<{ key: string; unit: number; slot: number; unitName: string; position: string }> {
    return simSlots(cfg).map((s) => ({
      key: slotKey(s.unit, s.slot),
      unit: s.unit,
      slot: s.slot,
      unitName: s.unitName,
      position: (['大营', '中军', '前锋'] as const)[s.unit] ?? '中军',
    }));
  }

  /** 自动识别的核心将（未勾任何核心位时生效） */
  function autoCoreName(): string {
    return cfg.slots[autoCoreUnits(cfg)[0] ?? 0]
      ? (HERO_RECORDS[cfg.slots[autoCoreUnits(cfg)[0] ?? 0].heroId]?.name ?? '—')
      : '—';
  }

  /** 「参与匹配的槽位」默认 = 全部空槽（用户可改勾选） */
  function defaultMatchSlotKeys(): string[] {
    return emptySlotsOf().map((s) => s.key);
  }

  /** 「排序口径」默认 = 自动识别核心将的空槽 */
  function defaultCoreSlotKeys(): string[] {
    const core = new Set(autoCoreUnits(cfg));
    return emptySlotsOf()
      .filter((s) => core.has(s.unit))
      .map((s) => s.key);
  }

  function simControlsInit(): Parameters<typeof simControlsHtml>[0] {
    const emptySlots = emptySlotsOf();
    const checkedSlotKeys = Array.from(simEl.querySelectorAll<HTMLInputElement>('[data-sim-slot]'))
      .filter((el) => el.checked)
      .map((el) => el.dataset.simSlot ?? '');
    const checkedCore = Array.from(simEl.querySelectorAll<HTMLInputElement>('[data-sim-core]'))
      .filter((el) => el.checked)
      .map((el) => el.dataset.simCore ?? '');
    return {
      coarseRuns: simState.coarseRuns,
      finalRuns: simState.finalRuns,
      finalRunsMax: simState.finalRunsMax,
      adaptiveFinals: simState.adaptiveFinals,
      unitKeep: simState.unitKeep,
      pairCarriers: simState.pairCarriers,
      coarseTop: simState.coarseTop,
      maxCombos: simState.maxCombos,
      rankBy: simState.rankBy,
      dummyTroops: simState.dummyTroops,
      seed: simState.seed,
      swapSides: simState.swapSides,
      slots: emptySlots,
      matchSlotKeys: checkedSlotKeys.length ? checkedSlotKeys : defaultMatchSlotKeys(),
      coreSlotKeys: checkedCore.length ? checkedCore : defaultCoreSlotKeys(),
      autoCoreName: autoCoreName(),
      estimate: estimateBattles(cfg, simOptionsForEstimate()),
    };
  }

  /** 只用于估算的选项（读当前控件，不改状态） */
  function simOptionsForEstimate(): SimExpectAsyncOptions {
    const q = <T extends HTMLElement>(sel: string): T | null => simEl.querySelector<T>(sel);
    return {
      coarseRuns: Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-coarse')?.value) || simState.coarseRuns)),
      finalRuns: Math.max(
        FINAL_RUNS_MIN,
        Math.floor(Number(q<HTMLInputElement>('#rm-sim-final')?.value) || simState.finalRuns)
      ),
      finalRunsMax: Math.max(
        FINAL_RUNS_MIN,
        Math.floor(Number(q<HTMLInputElement>('#rm-sim-finalmax')?.value) || simState.finalRunsMax)
      ),
      adaptiveFinals: q<HTMLInputElement>('#rm-sim-adaptive')?.checked !== false,
      unitKeep: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-keep')?.value) || simState.unitKeep)),
      pairCarriers: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-paircars')?.value) || simState.pairCarriers)),
      coarseTop: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-top')?.value) || simState.coarseTop)),
      maxCombos: Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-maxcombo')?.value) || simState.maxCombos)),
      dummyTroops: Math.max(500, Math.floor(Number(q<HTMLInputElement>('#rm-sim-troops')?.value) || simState.dummyTroops)),
      matchSlotKeys: checkedMatchSlotKeys(),
    };
  }

  /** 勾选的「参与匹配的槽位」（没动过勾选 = 全部空槽；勾空 = 一个都不搜，只测评当前配置） */
  function checkedMatchSlotKeys(): string[] {
    if (!simState.matchSlotTouched) return defaultMatchSlotKeys();
    const all = new Set(defaultMatchSlotKeys());
    return Array.from(simEl.querySelectorAll<HTMLInputElement>('[data-sim-slot]'))
      .filter((el) => el.checked)
      .map((el) => el.dataset.simSlot ?? '')
      .filter((k) => all.has(k));
  }

  /** 「核心位」勾选的槽位 → 去重后的 unit 列表（同一将两个槽都勾也只算一次；未勾 = 自动识别） */
  function checkedCoreUnits(): number[] {
    const keys = Array.from(simEl.querySelectorAll<HTMLInputElement>('[data-sim-core]'))
      .filter((el) => el.checked)
      .map((el) => el.dataset.simCore ?? '');
    if (!keys.length) return autoCoreUnits(cfg);
    return [...new Set(keys.map((k) => Number(k.split('-')[0])).filter((u) => Number.isFinite(u)))];
  }

  /** 从控件读参数（决赛场次下限 20 由模块再兜一层；这里同步回写，避免界面显示与实跑不一致） */
  function simReadControls(): SimExpectAsyncOptions {
    const q = <T extends HTMLElement>(sel: string): T | null => simEl.querySelector<T>(sel);
    const coarseRuns = Math.max(1, Math.min(20, Math.floor(Number(q<HTMLInputElement>('#rm-sim-coarse')?.value) || 3)));
    const finalRuns = Math.max(FINAL_RUNS_MIN, Math.floor(Number(q<HTMLInputElement>('#rm-sim-final')?.value) || FINAL_RUNS_MIN));
    const finalRunsMax = Math.max(
      finalRuns,
      Math.floor(Number(q<HTMLInputElement>('#rm-sim-finalmax')?.value) || FINAL_RUNS_MAX)
    );
    const adaptiveFinals = q<HTMLInputElement>('#rm-sim-adaptive')?.checked !== false;
    const unitKeep = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-keep')?.value) || 32));
    const pairCarriers = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-paircars')?.value) || 10));
    const coarseTop = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-top')?.value) || 10));
    const maxCombos = Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-maxcombo')?.value) || 1000));
    const rankBy = (q<HTMLSelectElement>('#rm-sim-rank')?.value === 'first3' ? 'first3' : 'total') as 'total' | 'first3';
    const dummyTroops = Math.max(500, Math.floor(Number(q<HTMLInputElement>('#rm-sim-troops')?.value) || 150000));
    const seed = Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-seed')?.value) || 20260922));
    const swapSides = Boolean(q<HTMLInputElement>('#rm-sim-swap')?.checked);
    const matchSlotKeys = checkedMatchSlotKeys();
    const coreUnits = checkedCoreUnits();
    // 回写：决赛场次被抬到下限时，输入框也要显示真实值
    const finalInput = q<HTMLInputElement>('#rm-sim-final');
    if (finalInput) finalInput.value = String(finalRuns);
    const finalMaxInput = q<HTMLInputElement>('#rm-sim-finalmax');
    if (finalMaxInput) finalMaxInput.value = String(finalRunsMax);
    Object.assign(simState, {
      coarseRuns,
      finalRuns,
      finalRunsMax,
      adaptiveFinals,
      unitKeep,
      pairCarriers,
      coarseTop,
      maxCombos,
      rankBy,
      dummyTroops,
      seed,
      swapSides,
    });
    return {
      coarseRuns,
      finalRuns,
      finalRunsMax,
      adaptiveFinals,
      unitKeep,
      pairCarriers,
      coarseTop,
      maxCombos,
      rankBy,
      dummyTroops,
      matchSlotKeys,
      coreUnits,
      baseSeed: seed,
      swapSides,
      yieldEvery: 25,
    };
  }

  function updateStaleHint(): void {
    if (!simState.result) {
      simHintEl.textContent = '';
      return;
    }
    const stale = simState.signature !== cfgSignature(cfg);
    simHintEl.textContent = stale ? '· 结果为修改前的配置（配置已变，请重跑）' : '· 结果对应当前配置';
    simHintEl.className = stale ? 'rm-down' : 'rm-dim';
  }

  /** 控件一改就刷新「预计最多真跑 N 场」（避免点了才发现要跑十分钟） */
  function refreshEstimate(): void {
    const el = simEl.querySelector<HTMLElement>('#rm-sim-est');
    if (!el) return;
    el.innerHTML = `预计最多真跑 <b>${estimateBattles(cfg, simOptionsForEstimate())}</b> 场（含加跑上限）`;
  }

  function renderSimControls(): void {
    simControlsEl.innerHTML = simControlsHtml(simControlsInit());
    simControlsEl.querySelectorAll('input, select').forEach((node) =>
      node.addEventListener('change', () => {
        if ((node as HTMLElement).matches?.('[data-sim-slot]')) simState.matchSlotTouched = true;
        refreshEstimate();
      })
    );
    // 「参与匹配的槽位」全选 / 清空（清空 = 一个都不搜，只测评当前配置）
    simControlsEl.querySelectorAll<HTMLButtonElement>('[data-sim-slots]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const all = btn.dataset.simSlots === 'all';
        simControlsEl.querySelectorAll<HTMLInputElement>('[data-sim-slot]').forEach((el) => {
          el.checked = all;
        });
        simState.matchSlotTouched = true;
        // 勾选状态变了要重画（清空时给「只测评当前配置」的提示）
        renderSimControls();
        refreshEstimate();
      })
    );
  }

  /** 跑一批：逐槽粗筛 → 组合榜单 → 决赛排行 */
  async function runSim(): Promise<void> {
    if (simState.running) return;
    simState.running = true;
    const btn = simEl.querySelector<HTMLButtonElement>('#rm-sim-run');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '模拟中…';
    }
    simEl.dataset.state = 'running';
    const opts = simReadControls();
    const signature = cfgSignature(cfg);
    let ticks = 0;
    try {
      const result = await runSimExpectationAsync(cfg, {
        ...opts,
        onProgress: (p) => {
          ticks += 1;
          if (ticks % 3 === 0 || p.phaseDone === p.phaseTotal) simProgressEl.innerHTML = simProgressHtml(p);
        },
      });
      simState.result = result;
      simState.signature = signature;
      simResultEl.innerHTML = simResultHtml(result);
      simProgressEl.innerHTML = '';
      simEl.dataset.state = 'done';
      updateStaleHint();
    } catch (err) {
      simResultEl.innerHTML = `<div class="rm-note rm-down">模拟测评失败：${String((err as Error)?.message ?? err)}</div>`;
      simEl.dataset.state = 'error';
    } finally {
      simState.running = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '开始模拟测评';
      }
    }
  }

  renderSimControls();
  // 事件委托：参数区会随空槽位变化整体重建（renderSimControls），绑在容器上才不会随按钮一起被换掉
  simControlsEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.id === 'rm-sim-run') void runSim();
  });

  // ── 左栏：配置面板（共用模块 web/teamConfig.ts）──
  function renderConfig(): void {
    renderConfigPanel(configEl, cfg, {
      footerHtml: `<button class="rm-btn" type="button" id="rm-snapshot">存为方案（对比当前口径总伤）</button>`,
      bindFooter: (el) => {
        el.querySelector<HTMLButtonElement>('#rm-snapshot')?.addEventListener('click', () => {
          const r = computeResult(cfg);
          snapshots.push({
            name: `方案${snapshots.length + 1}（${cfg.slots.map((s) => HERO_RECORDS[s.heroId]?.name ?? '?').join('·')}）`,
            score: windowTotals(r, objectiveRounds).total,
            total: r.total,
            rounds: objectiveRounds,
          });
          draw();
        });
      },
      onChange: () => {
        if (objectiveRounds > cfg.rounds) objectiveRounds = cfg.rounds;
        draw();
      },
    });
  }

  // ── 图表：堆叠柱 + 累计线（共用模块 web/roundChart.ts）──
  function renderChart(result: RoundModelResult): void {
    renderRoundChart(chartEl, result, { highlight: objectiveRounds });
    renderRoundLegend(legendEl);
  }

  function renderSummary(result: RoundModelResult): void {
    const units = buildUnits(cfg);
    const best = result.rows.reduce((a, r) => (a.total > r.total ? a : r), result.rows[0]);
    const byRound = result.rows.map((r) => fmt(r.total)).join(' / ');
    const win = windowTotals(result, objectiveRounds);
    const win3 = windowTotals(result, 3);
    const winAll = windowTotals(result, cfg.rounds);
    const label = objectiveRounds >= cfg.rounds ? `整局（${cfg.rounds} 回合）总伤` : `前 ${objectiveRounds} 回合总伤`;
    summaryEl.innerHTML = `
      <div class="rm-hero-main">
        <div class="rm-hero-num">
          <span class="rm-hero-label">${label}</span>
          <span class="rm-hero-value">${fmt(win.total)}</span>
          <div class="rm-obj-row">
            <span class="rm-dim">口径</span>
            <select id="rm-objective">
              ${[3, 5, cfg.rounds]
                .filter((v, i, a) => v <= cfg.rounds && a.indexOf(v) === i)
                .map(
                  (v) =>
                    `<option value="${v}" ${v === objectiveRounds ? 'selected' : ''}>${v >= cfg.rounds ? `整局（${cfg.rounds} 回合）` : `前 ${v} 回合`}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="rm-hero-side">
          <div><span>前三回合</span><b>${fmt(win3.total)}</b></div>
          <div><span>整局 ${cfg.rounds} 回合</span><b>${fmt(result.total)}</b></div>
          <div><span>峰值回合</span><b>第 ${best?.round ?? 0} 回合 · ${fmt(best?.total ?? 0)}</b></div>
          <div><span>每回合</span><b>${byRound}</b></div>
        </div>
      </div>
      <table class="rm-table rm-unit-table">
        <thead><tr><th>武将</th><th>攻击</th><th>谋略</th><th>兵力</th><th>兵种</th><th>主战法 + 携带</th><th>${objectiveRounds >= cfg.rounds ? '整局' : `前 ${objectiveRounds} 回合`}</th><th>整局</th></tr></thead>
        <tbody>
          ${units
            .map(
              (u, i) => `<tr>
              <td>${u.name}</td>
              <td class="rm-num">${fmt(u.attack)}</td>
              <td class="rm-num">${fmt(u.strategy)}</td>
              <td class="rm-num">${fmt(u.troops)}</td>
              <td>${TROOP_CHAR[u.troopType] ?? ''}</td>
              <td class="rm-skills">${u.skills.map((s) => s.name).join(' · ') || '—'}</td>
              <td class="rm-num rm-strong">${fmt(win.byUnit[i] ?? 0)}</td>
              <td class="rm-num rm-dim">${fmt(winAll.byUnit[i] ?? 0)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      ${
        snapshots.length
          ? `<div class="rm-snaps">
              <div class="rm-group-title">方案对比（各自口径下的总伤）</div>
              <table class="rm-table">
                <thead><tr><th>方案</th><th>口径</th><th>口径总伤</th><th>整局</th><th>相对</th></tr></thead>
                <tbody>${snapshots
                  .map((s, i) => {
                    const base = snapshots[0].score || 1;
                    const delta = ((s.score - base) / base) * 100;
                    return `<tr><td>${s.name}</td><td class="rm-dim">${s.rounds >= cfg.rounds ? '整局' : `前 ${s.rounds} 回合`}</td><td class="rm-num">${fmt(
                      s.score
                    )}</td><td class="rm-num rm-dim">${fmt(s.total)}</td><td class="${delta >= 0 ? 'rm-up' : 'rm-down'}">${
                      i === 0 ? '基准' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`
                    }</td></tr>`;
                  })
                  .join('')}</tbody>
              </table>
              <button class="rm-btn rm-btn-ghost" type="button" id="rm-clear-snaps">清空对比</button>
            </div>`
          : ''
      }
    `;
    summaryEl.querySelector<HTMLSelectElement>('#rm-objective')?.addEventListener('change', (ev) => {
      objectiveRounds = Number((ev.target as HTMLSelectElement).value) || 3;
      draw();
    });
    summaryEl.querySelector<HTMLButtonElement>('#rm-clear-snaps')?.addEventListener('click', () => {
      snapshots.length = 0;
      draw();
    });
  }

  function renderSources(result: RoundModelResult): void {
    const units = buildUnits(cfg);
    const win = windowTotals(result, objectiveRounds);
    const total = win.total || 1;
    const label = objectiveRounds >= cfg.rounds ? `整局（${cfg.rounds} 回合）` : `前 ${objectiveRounds} 回合`;
    const rows = SOURCE_ORDER.filter((s) => (win.bySource[s] ?? 0) > 0).map((s) => {
      const v = win.bySource[s] ?? 0;
      const pct = (v / total) * 100;
      return `<tr>
        <td><i class="rm-dot" style="background:${SOURCE_COLOR[s]}"></i>${s}</td>
        <td class="rm-num">${fmt(v)}</td>
        <td class="rm-bar-cell"><span class="rm-bar" style="width:${pct.toFixed(1)}%;background:${SOURCE_COLOR[s]}"></span></td>
        <td class="rm-num rm-dim">${pct.toFixed(1)}%</td>
      </tr>`;
    });
    sourcesEl.innerHTML = `<table class="rm-table">
      <thead><tr><th>来源（${label}）</th><th>伤害</th><th></th><th>占比</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="4" class="rm-dim">没有伤害来源</td></tr>'}</tbody>
    </table>
    <div class="rm-note">分单位：${units.map((u, i) => `${u.name} ${fmt(windowTotals(result, cfg.rounds).byUnit[i] ?? 0)}`).join(' ｜ ')}</div>`;
  }

  function renderEffects(result: RoundModelResult): void {
    if (!result.effectLog.length) {
      effectsEl.innerHTML = '<div class="rm-note">当前配置没有可抽取的增减伤 / 属性修正（或全部为防御类效果）。</div>';
      return;
    }
    const kindOrder = Object.keys(EFFECT_LABEL);
    const sorted = [...result.effectLog].sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
    effectsEl.innerHTML = `<table class="rm-table">
      <thead><tr><th>来源</th><th>效果</th><th>数值</th><th>生效回合</th><th>作用</th></tr></thead>
      <tbody>${sorted
        .map((e) => {
          const isPct = e.kind === 'boostCaused' || e.kind === 'boostTaken' || e.kind === 'reduce' || e.kind === 'combo';
          const isRate = e.kind === 'triggerBoost';
          const value = isPct || isRate ? `${(e.value * 100).toFixed(1)}%` : `${e.value >= 0 ? '+' : ''}${e.value.toFixed(1)}`;
          return `<tr>
            <td>${e.source}</td>
            <td>${EFFECT_LABEL[e.kind]}</td>
            <td class="rm-num rm-strong">${value}</td>
            <td class="rm-dim">${e.from === e.to ? `第 ${e.from} 回合` : `第 ${e.from}~${e.to} 回合`}</td>
            <td class="rm-dim">${e.side === 'self' ? '我方' : '敌方目标'}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>
    <div class="rm-note">抽取规则：同类型不同战法取较高、同源显式叠层累加、属性正负分桶共存（与引擎冲突口径一致）；
      带几率的修正按几率折算强度；生效回合 = 期望首次发动回合起算 duration 回合。</div>`;
  }

  function renderWarnings(result: RoundModelResult): void {
    const uniq = new Map<string, string>();
    result.warnings.forEach((w) => {
      const key = `${w.skill}｜${w.detail}`;
      if (!uniq.has(key)) uniq.set(key, `${w.skill}：${w.detail}`);
    });
    warnCountEl.textContent = uniq.size ? `（${uniq.size} 项）` : '（无）';
    warningsEl.innerHTML = uniq.size
      ? `<ul class="rm-warn-list">${[...uniq.values()].map((t) => `<li>${t}</li>`).join('')}</ul>
         <div class="rm-note">这些字段/段在本模型里没有计入（例如战法链、代打、连锁、位置伤害、回复、控制等），
         所以相关战法的结果会偏低——对比时请把它们视作「未打折的下界」。</div>`
      : '<div class="rm-note">当前配置用到的战法全部在模型覆盖范围内。</div>';
  }

  function draw(): void {
    const result = computeResult(cfg);
    renderSummary(result);
    renderChart(result);
    renderSources(result);
    renderEffects(result);
    renderWarnings(result);
    // 空槽位变了（填/清战法）→ 参与匹配 / 核心位的勾选项跟着重建，避免留下已失效的槽位
    const slotSig = emptySlotsOf()
      .map((s) => s.key)
      .join(',');
    if (slotSig !== simState.slotSig) {
      simState.slotSig = slotSig;
      renderSimControls();
    }
    updateStaleHint(); // 配置一改，模拟结果就标「过期」，不拿旧数字当新配置的结论
  }

  renderConfig();
  draw();
}
