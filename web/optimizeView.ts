/**
 * 组合优化页（`optimize.html`）：**L2 优化战法 / L3 优化武将** 两个模式共用一栏左侧配置。
 * ---------------------------------------------------------------------------
 * 用户 2026-09-28 口径：
 *   · **左栏唯一实例**（`web/teamConfig.ts` 的配置面板）——L2 / L3 **共用并同步**，切模式只换右侧那块；
 *   · L2 = 把「空战法槽」当搜索维度（`web/simExpectation.ts`）；L3 = 把「队友位」当那个空槽
 *     （`web/simMate.ts`），对队友组合做粗筛。两层的靶子（不还手木桩）与排序口径（核心将伤害期望）完全一致。
 *   · **两步衔接**：先用 L3 匹配最佳队友（点「应用」→ 武将写进左栏、该位战法槽清空）→ 再切 L2
 *     匹配全队战法（点「应用」→ 战法写进对应槽位）。两个模式各自保留自己的结果与参数（切来切去不丢）。
 */
import { HERO_RECORDS, TROOP_CHAR } from './heroes';
import {
  autoCoreUnits,
  estimateBattles,
  FINAL_RUNS_MIN,
  runSimExpectationAsync,
  simSlots,
  type SimExpectAsyncOptions,
  type SimExpectResult,
} from './simExpectation';
import { simControlsHtml, simProgressHtml, simResultHtml } from './simExpectView';
import {
  estimateMateBattles,
  heroPoolBase,
  MAX_MATCH_UNITS,
  mateSlots,
  runSimMateAsync,
  slotForHero,
  type MateSimAsyncOptions,
  type MateSimResult,
} from './simMate';
import { mateControlsHtml, mateProgressHtml, mateResultHtml } from './simMateView';
import { defaultCfg, renderConfigPanel, type ViewCfg } from './teamConfig';

type Mode = 'l2' | 'l3';

const POSITIONS = ['大营', '中军', '前锋'] as const;

/** 挂载页面（出错时把报错画进页面，避免只看到空白/半边 UI） */
export function mountOptimize(root: HTMLElement): void {
  try {
    mountOptimizeInner(root);
  } catch (err) {
    root.innerHTML = `
      <div style="max-width:900px;margin:40px auto;padding:20px;border:1px solid #6b3b3b;border-radius:12px;background:#1b1418;color:#ffb4b4;font:14px/1.7 'Microsoft YaHei',sans-serif">
        <h2 style="margin:0 0 10px;color:#ff6b6b">组合优化页出错</h2>
        <pre style="white-space:pre-wrap;color:#ffd8d8">${String(err && (err as Error).stack ? (err as Error).stack : err)}</pre>
        <p style="color:#c99">把这段报错发我即可定位。</p>
      </div>`;
  }
}

function mountOptimizeInner(root: HTMLElement): void {
  const cfg: ViewCfg = defaultCfg();
  let mode: Mode = 'l2';

  /** 配置指纹：判断已有结果是否还对得上当前配置（同 `roundModelView.ts` 口径） */
  function cfgSignature(c: ViewCfg): string {
    return JSON.stringify([
      c.slots.map((s) => [s.heroId, s.level, s.addAttack, s.addStrategy, s.troopType, s.skillIds.join(',')]),
      c.morale,
      c.enemy,
      c.rounds,
    ]);
  }

  /* ── 每模式的参数 + 勾选状态 + 结果（切模式不丢；配置改了只标「过期」）── */
  const l2 = {
    result: null as SimExpectResult | null,
    signature: '',
    running: false,
    /** 上一次跑的报错（有值就在结果区显示，不静默） */
    error: '',
    coarseRuns: 3,
    finalRuns: FINAL_RUNS_MIN,
    unitKeep: 32,
    pairCarriers: 10,
    coarseTop: 32,
    maxCombos: 1000,
    rankBy: 'total' as 'total' | 'first3',
    dummyTroops: 150000,
    seed: 20260922,
    swapSides: true,
    /** 勾选状态（空 = 用默认：参与匹配 = 自动识别的核心将；核心位 = 核心将的空槽） */
    uiMatchUnits: [] as number[],
    uiCoreSlotKeys: [] as string[],
    slotSig: '',
    note: '',
  };
  const l3 = {
    result: null as MateSimResult | null,
    signature: '',
    running: false,
    /** 上一次跑的报错（有值就在结果区显示，不静默） */
    error: '',
    coarseRuns: 3,
    finalRuns: FINAL_RUNS_MIN,
    unitKeep: 32,
    pairCarriers: 10,
    coarseTop: 32,
    maxCombos: 1000,
    rankBy: 'total' as 'total' | 'first3',
    dummyTroops: 150000,
    seed: 20260922,
    swapSides: true,
    includeOffline: false,
    /** 勾选状态（空 = 用默认：参与匹配 = 非核心将的全部位，最多 2 个；核心位 = 自动识别） */
    uiMatchUnits: [] as number[],
    uiCoreUnits: [] as number[],
    note: '',
  };

  root.innerHTML = `
    <div class="rm-wrap">
      <header class="rm-head">
        <div>
          <h1>组合优化 · L2 优化战法 / L3 优化武将</h1>
          <p class="rm-sub">
            一层一个搜索维度：<b>L2 把「空战法槽」当那个空槽</b>（回答「带哪些战法伤害期望最高」），
            <b>L3 把「队友位」当那个空槽</b>（对队友组合做粗筛，回答「围绕核心将配哪两个队友」）。
            两层都是<b>真引擎模拟测评</b>：靶子 = <b>不还手的木桩</b>、排序口径 = <b>核心将的伤害期望</b>、
            三阶段阈值同一套（粗筛 3 场 → 决赛 ≥20 场）。<b>左栏配置两个模式共用并同步</b>，切模式只换右侧这一块。
            推荐流程：先用 L3 选队友（应用）→ 再切 L2 配全队战法（应用）。
          </p>
        </div>
        <div class="rm-head-links">
          <a class="rm-back" href="/round-model.html">回合期望模型（解析口径）→</a>
          <a class="rm-back" href="/optimizer.html">旧组合优化器（解析）→</a>
          <a class="rm-back" href="/battle-sim.html">实战胜率（L4）→</a>
          <a class="rm-back" href="/index.html">返回配将</a>
        </div>
      </header>
      <div class="rm-grid">
        <aside class="rm-card rm-side" id="op-config"></aside>
        <main class="rm-main">
          <section class="rm-card rm-hero" id="op-summary"></section>
          <section class="rm-card rm-sim-card" id="op-panel" data-state="idle">
            <div class="op-modes" id="op-modes">
              <button class="op-mode" type="button" data-mode="l2">L2 · 优化战法</button>
              <button class="op-mode" type="button" data-mode="l3">L3 · 优化武将（队友）</button>
              <span class="op-mode-hint" id="op-mode-hint"></span>
            </div>
            <div id="op-controls"></div>
            <div id="op-progress"></div>
            <div id="op-result"></div>
          </section>
        </main>
      </div>
    </div>
  `;

  const configEl = root.querySelector<HTMLElement>('#op-config')!;
  const summaryEl = root.querySelector<HTMLElement>('#op-summary')!;
  const panelEl = root.querySelector<HTMLElement>('#op-panel')!;
  const modesEl = root.querySelector<HTMLElement>('#op-modes')!;
  const modeHintEl = root.querySelector<HTMLElement>('#op-mode-hint')!;
  const controlsEl = root.querySelector<HTMLElement>('#op-controls')!;
  const progressEl = root.querySelector<HTMLElement>('#op-progress')!;
  const resultEl = root.querySelector<HTMLElement>('#op-result')!;

  // ─────────────────────── 勾选状态的读 / 写 ───────────────────────

  /** 空槽位（L2 的「核心位」勾选用）：与模块 `simSlots` 同口径 */
  function emptySlotsOf(): Array<{ key: string; unit: number; slot: number; unitName: string }> {
    return simSlots(cfg).map((s) => ({ key: `${s.unit}-${s.slot}`, unit: s.unit, slot: s.slot, unitName: s.unitName }));
  }

  function autoCoreName(): string {
    return HERO_RECORDS[cfg.slots[autoCoreUnits(cfg)[0] ?? 0]?.heroId ?? '']?.name ?? '—';
  }

  /** L2 参与匹配的将（空 = 默认自动识别的核心将） */
  const l2MatchUnits = (): number[] => (l2.uiMatchUnits.length ? l2.uiMatchUnits : autoCoreUnits(cfg));
  /** L2 核心位（空 = 默认核心将的空槽） */
  const l2CoreUnits = (): number[] => {
    if (l2.uiCoreSlotKeys.length) {
      return [...new Set(l2.uiCoreSlotKeys.map((k) => Number(k.split('-')[0])).filter((u) => Number.isFinite(u)))];
    }
    return autoCoreUnits(cfg);
  };
  /** L3 核心位（空 = 默认自动识别） */
  const l3CoreUnits = (): number[] => (l3.uiCoreUnits.length ? l3.uiCoreUnits : autoCoreUnits(cfg));
  /** L3 参与匹配的队友位（空 = 默认非核心将的全部位，最多 MAX_MATCH_UNITS 个） */
  const l3MatchUnits = (): number[] => {
    const core = new Set(l3CoreUnits());
    const eligible = cfg.slots.map((_, i) => i).filter((i) => !core.has(i));
    const wanted = l3.uiMatchUnits.length ? l3.uiMatchUnits.filter((u) => eligible.includes(u)) : eligible;
    return wanted.slice().sort((a, b) => a - b).slice(0, MAX_MATCH_UNITS);
  };

  /** 勾选变化 → 存进模式状态（面板重建后不丢） */
  function syncUiFromDom(): void {
    if (mode === 'l2') {
      l2.uiMatchUnits = [...controlsEl.querySelectorAll<HTMLInputElement>('[data-sim-match]')]
        .filter((el) => el.checked)
        .map((el) => Number(el.dataset.simMatch));
      l2.uiCoreSlotKeys = [...controlsEl.querySelectorAll<HTMLInputElement>('[data-sim-core]')]
        .filter((el) => el.checked)
        .map((el) => el.dataset.simCore ?? '');
    } else {
      l3.uiMatchUnits = [...controlsEl.querySelectorAll<HTMLInputElement>('[data-mt-match]')]
        .filter((el) => el.checked)
        .map((el) => Number(el.dataset.mtMatch));
      l3.uiCoreUnits = [...controlsEl.querySelectorAll<HTMLInputElement>('[data-mt-core]')]
        .filter((el) => el.checked)
        .map((el) => Number(el.dataset.mtCore));
    }
  }

  // ─────────────────────── L2：参数与结果 ───────────────────────

  function l2ControlsInit(): Parameters<typeof simControlsHtml>[0] {
    const emptySlots = emptySlotsOf();
    return {
      coarseRuns: l2.coarseRuns,
      finalRuns: l2.finalRuns,
      unitKeep: l2.unitKeep,
      pairCarriers: l2.pairCarriers,
      coarseTop: l2.coarseTop,
      maxCombos: l2.maxCombos,
      rankBy: l2.rankBy,
      dummyTroops: l2.dummyTroops,
      seed: l2.seed,
      swapSides: l2.swapSides,
      units: cfg.slots.map((s, unit) => ({
        unit,
        name: HERO_RECORDS[s.heroId]?.name ?? s.heroId,
        hasEmptySlot: emptySlots.some((e) => e.unit === unit),
      })),
      matchUnits: l2MatchUnits(),
      emptySlots,
      coreSlotKeys: l2.uiCoreSlotKeys.length
        ? l2.uiCoreSlotKeys
        : emptySlots.filter((s) => autoCoreUnits(cfg).includes(s.unit)).map((s) => s.key),
      autoCoreName: autoCoreName(),
      estimate: estimateBattles(cfg, l2OptionsForEstimate()),
    };
  }

  /** 估算用（读控件现值，不改状态） */
  function l2OptionsForEstimate(): SimExpectAsyncOptions {
    const q = <T extends HTMLElement>(sel: string): T | null => controlsEl.querySelector<T>(sel);
    return {
      coarseRuns: Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-coarse')?.value) || l2.coarseRuns)),
      finalRuns: Math.max(FINAL_RUNS_MIN, Math.floor(Number(q<HTMLInputElement>('#rm-sim-final')?.value) || l2.finalRuns)),
      unitKeep: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-keep')?.value) || l2.unitKeep)),
      pairCarriers: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-paircars')?.value) || l2.pairCarriers)),
      coarseTop: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-top')?.value) || l2.coarseTop)),
      maxCombos: Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-maxcombo')?.value) || l2.maxCombos)),
      dummyTroops: Math.max(500, Math.floor(Number(q<HTMLInputElement>('#rm-sim-troops')?.value) || l2.dummyTroops)),
      matchUnits: l2MatchUnits(),
    };
  }

  /** 从控件读参数（决赛场次下限由模块再兜一层；这里同步回写，避免界面显示与实跑不一致） */
  function l2ReadControls(): SimExpectAsyncOptions {
    const q = <T extends HTMLElement>(sel: string): T | null => controlsEl.querySelector<T>(sel);
    const coarseRuns = Math.max(1, Math.min(20, Math.floor(Number(q<HTMLInputElement>('#rm-sim-coarse')?.value) || 3)));
    const finalRuns = Math.max(FINAL_RUNS_MIN, Math.floor(Number(q<HTMLInputElement>('#rm-sim-final')?.value) || FINAL_RUNS_MIN));
    const unitKeep = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-keep')?.value) || 32));
    const pairCarriers = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-paircars')?.value) || 10));
    const coarseTop = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#rm-sim-top')?.value) || 32));
    const maxCombos = Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-maxcombo')?.value) || 1000));
    const rankBy = (q<HTMLSelectElement>('#rm-sim-rank')?.value === 'first3' ? 'first3' : 'total') as 'total' | 'first3';
    const dummyTroops = Math.max(500, Math.floor(Number(q<HTMLInputElement>('#rm-sim-troops')?.value) || 150000));
    const seed = Math.max(1, Math.floor(Number(q<HTMLInputElement>('#rm-sim-seed')?.value) || 20260922));
    const swapSides = Boolean(q<HTMLInputElement>('#rm-sim-swap')?.checked);
    const finalInput = q<HTMLInputElement>('#rm-sim-final');
    if (finalInput) finalInput.value = String(finalRuns);
    Object.assign(l2, { coarseRuns, finalRuns, unitKeep, pairCarriers, coarseTop, maxCombos, rankBy, dummyTroops, seed, swapSides });
    return {
      coarseRuns,
      finalRuns,
      unitKeep,
      pairCarriers,
      coarseTop,
      maxCombos,
      rankBy,
      dummyTroops,
      matchUnits: l2MatchUnits(),
      coreUnits: l2CoreUnits(),
      baseSeed: seed,
      swapSides,
      yieldEvery: 25,
    };
  }

  function l2RenderControls(): void {
    controlsEl.innerHTML = simControlsHtml(l2ControlsInit());
  }

  async function runL2(): Promise<void> {
    if (l2.running) return;
    l2.running = true;
    l2.error = '';
    const btn = controlsEl.querySelector<HTMLButtonElement>('#rm-sim-run');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '模拟中…';
    }
    panelEl.dataset.state = 'running';
    const opts = l2ReadControls();
    const signature = cfgSignature(cfg);
    let ticks = 0;
    try {
      const result = await runSimExpectationAsync(cfg, {
        ...opts,
        onProgress: (p) => {
          ticks += 1;
          if (ticks % 3 === 0 || p.phaseDone === p.phaseTotal) progressEl.innerHTML = simProgressHtml(p);
        },
      });
      l2.result = result;
      l2.signature = signature;
      progressEl.innerHTML = '';
      panelEl.dataset.state = 'done';
    } catch (err) {
      l2.error = String((err as Error)?.message ?? err);
      panelEl.dataset.state = 'error';
    } finally {
      l2.running = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '开始模拟测评';
      }
      showIfCurrent('l2', l2ResultHtml()); // running 已归位，这里才会渲染真结果（而不是「进行中」占位）
      renderSummary();
      renderStaleHint();
    }
  }

  /** L2 结果：决算排行每行带「应用」（把战法写进左栏对应槽位） */
  function l2ResultHtml(): string {
    if (l2.error) return `<div class="rm-note rm-down">模拟测评失败：${l2.error}</div>`;
    if (l2.running) return '<div class="rm-note">模拟测评进行中…</div>';
    if (!l2.result) {
      return `<div class="rm-note">点上方「开始模拟测评」：L2 只填空战法槽（其余槽位原样保留），
        逐槽粗筛 ${l2.coarseRuns} 场 → 组合榜单 → 决赛 ≥${l2.finalRuns} 场，按<b>核心将伤害期望</b>排行。</div>`;
    }
    return simResultHtml(l2.result, { applyButtons: true });
  }

  // ─────────────────────── L3：参数与结果 ───────────────────────

  function l3ControlsInit(): Parameters<typeof mateControlsHtml>[0] {
    const core = new Set(l3CoreUnits());
    const matched = l3MatchUnits();
    const poolSizes = { listed: heroPoolBase({}).length, all: heroPoolBase({ includeOffline: true }).length };
    return {
      coarseRuns: l3.coarseRuns,
      finalRuns: l3.finalRuns,
      unitKeep: l3.unitKeep,
      pairCarriers: l3.pairCarriers,
      coarseTop: l3.coarseTop,
      maxCombos: l3.maxCombos,
      rankBy: l3.rankBy,
      dummyTroops: l3.dummyTroops,
      seed: l3.seed,
      swapSides: l3.swapSides,
      includeOffline: l3.includeOffline,
      poolSizes,
      units: cfg.slots.map((s, unit) => {
        const isCore = core.has(unit);
        return {
          unit,
          name: HERO_RECORDS[s.heroId]?.name ?? s.heroId,
          position: POSITIONS[unit] ?? '中军',
          isCore,
          canMatch: !isCore && (matched.includes(unit) || matched.length < MAX_MATCH_UNITS),
        };
      }),
      matchUnits: matched,
      coreUnitIdx: l3.uiCoreUnits.length ? l3.uiCoreUnits : autoCoreUnits(cfg),
      autoCoreName: autoCoreName(),
      estimate: estimateMateBattles(cfg, l3OptionsForEstimate()),
    };
  }

  function l3OptionsForEstimate(): MateSimAsyncOptions {
    const q = <T extends HTMLElement>(sel: string): T | null => controlsEl.querySelector<T>(sel);
    return {
      coarseRuns: Math.max(1, Math.floor(Number(q<HTMLInputElement>('#mt-coarse')?.value) || l3.coarseRuns)),
      finalRuns: Math.max(FINAL_RUNS_MIN, Math.floor(Number(q<HTMLInputElement>('#mt-final')?.value) || l3.finalRuns)),
      unitKeep: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#mt-keep')?.value) || l3.unitKeep)),
      pairCarriers: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#mt-paircars')?.value) || l3.pairCarriers)),
      coarseTop: Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#mt-top')?.value) || l3.coarseTop)),
      maxCombos: Math.max(1, Math.floor(Number(q<HTMLInputElement>('#mt-maxcombo')?.value) || l3.maxCombos)),
      dummyTroops: Math.max(500, Math.floor(Number(q<HTMLInputElement>('#mt-troops')?.value) || l3.dummyTroops)),
      includeOffline: q<HTMLSelectElement>('#mt-pool')?.value === 'all',
      matchUnits: l3MatchUnits(),
      coreUnits: l3CoreUnits(),
    };
  }

  function l3ReadControls(): MateSimAsyncOptions {
    const q = <T extends HTMLElement>(sel: string): T | null => controlsEl.querySelector<T>(sel);
    const coarseRuns = Math.max(1, Math.min(20, Math.floor(Number(q<HTMLInputElement>('#mt-coarse')?.value) || 3)));
    const finalRuns = Math.max(FINAL_RUNS_MIN, Math.floor(Number(q<HTMLInputElement>('#mt-final')?.value) || FINAL_RUNS_MIN));
    const unitKeep = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#mt-keep')?.value) || 32));
    const pairCarriers = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#mt-paircars')?.value) || 10));
    const coarseTop = Math.max(1, Math.floor(Number(q<HTMLSelectElement>('#mt-top')?.value) || 32));
    const maxCombos = Math.max(1, Math.floor(Number(q<HTMLInputElement>('#mt-maxcombo')?.value) || 1000));
    const rankBy = (q<HTMLSelectElement>('#mt-rank')?.value === 'first3' ? 'first3' : 'total') as 'total' | 'first3';
    const dummyTroops = Math.max(500, Math.floor(Number(q<HTMLInputElement>('#mt-troops')?.value) || 150000));
    const seed = Math.max(1, Math.floor(Number(q<HTMLInputElement>('#mt-seed')?.value) || 20260922));
    const swapSides = Boolean(q<HTMLInputElement>('#mt-swap')?.checked);
    const includeOffline = q<HTMLSelectElement>('#mt-pool')?.value === 'all';
    const finalInput = q<HTMLInputElement>('#mt-final');
    if (finalInput) finalInput.value = String(finalRuns);
    Object.assign(l3, { coarseRuns, finalRuns, unitKeep, pairCarriers, coarseTop, maxCombos, rankBy, dummyTroops, seed, swapSides, includeOffline });
    return {
      coarseRuns,
      finalRuns,
      unitKeep,
      pairCarriers,
      coarseTop,
      maxCombos,
      rankBy,
      dummyTroops,
      includeOffline,
      matchUnits: l3MatchUnits(),
      coreUnits: l3CoreUnits(),
      baseSeed: seed,
      swapSides,
      yieldEvery: 25,
    };
  }

  function l3RenderControls(): void {
    controlsEl.innerHTML = mateControlsHtml(l3ControlsInit());
  }

  async function runL3(): Promise<void> {
    if (l3.running) return;
    l3.running = true;
    l3.error = '';
    const btn = controlsEl.querySelector<HTMLButtonElement>('#mt-run');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '匹配中…';
    }
    panelEl.dataset.state = 'running';
    const opts = l3ReadControls();
    const signature = cfgSignature(cfg);
    let ticks = 0;
    try {
      const result = await runSimMateAsync(cfg, {
        ...opts,
        onProgress: (p) => {
          ticks += 1;
          if (ticks % 3 === 0 || p.phaseDone === p.phaseTotal) progressEl.innerHTML = mateProgressHtml(p);
        },
      });
      l3.result = result;
      l3.signature = signature;
      progressEl.innerHTML = '';
      panelEl.dataset.state = 'done';
    } catch (err) {
      l3.error = String((err as Error)?.message ?? err);
      panelEl.dataset.state = 'error';
    } finally {
      l3.running = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '开始匹配队友';
      }
      showIfCurrent('l3', l3ResultHtml());
      renderSummary();
      renderStaleHint();
    }
  }

  function l3ResultHtml(): string {
    if (l3.error) return `<div class="rm-note rm-down">队友匹配失败：${l3.error}</div>`;
    if (l3.running) return '<div class="rm-note">队友匹配进行中…</div>';
    if (!l3.result) {
      return `<div class="rm-note">点上方「开始匹配队友」：L3 把<b>队友位</b>当那个空槽——勾 1 个位 = 单槽粗筛，
        勾 2 个位 = <b>成对评估</b>（先跑单挂拿搭子基准，再用基准 × 全部候选配对）；
        匹配位的战法槽会被清空（战法留给 L2 那一步配），未勾选的将原样保留。</div>`;
    }
    return mateResultHtml(l3.result);
  }

  // ─────────────────────── 概览 / 过期提示 / 应用 ───────────────────────

  function renderSummary(): void {
    const core = mode === 'l2' ? l2CoreUnits() : l3CoreUnits();
    const coreLabel = core.map((u) => HERO_RECORDS[cfg.slots[u]?.heroId ?? '']?.name ?? '?').join(' / ') || autoCoreName();
    const emptySlots = emptySlotsOf();
    const matchSlots = mateSlots(cfg, l3MatchUnits(), l3CoreUnits());
    const team = cfg.slots
      .map((s, i) => {
        const rec = HERO_RECORDS[s.heroId];
        return `<b>${POSITIONS[i] ?? '?'}·${rec?.name ?? s.heroId}</b><span class="rm-dim">（${TROOP_CHAR[s.troopType] ?? ''}${
          rec?.mainSkillName ? `·${rec.mainSkillName}` : ''
        }）</span>`;
      })
      .join(' ｜ ');
    const l2State = l2.result ? (l2.signature === cfgSignature(cfg) ? '结果对应当前配置' : '结果为修改前的配置（配置已变，请重跑）') : '还没跑';
    const l3State = l3.result ? (l3.signature === cfgSignature(cfg) ? '结果对应当前配置' : '结果为修改前的配置（配置已变，请重跑）') : '还没跑';
    summaryEl.innerHTML = `
      <div class="rm-hero-main">
        <div class="rm-hero-num">
          <span class="rm-hero-label">当前配置（两个模式共用同一份）</span>
          <span class="rm-hero-value" style="font-size:15px">${team}</span>
        </div>
        <div class="rm-hero-side">
          <div><span>核心将</span><b>${coreLabel}</b></div>
          <div><span>L2 空战法槽</span><b>${emptySlots.length}</b> 个<span class="rm-dim"> · ${l2State}</span></div>
          <div><span>L3 队友位</span><b>${matchSlots.map((s) => `${s.position}·${s.unitName}`).join(' / ') || '（无）'}</b><span class="rm-dim"> · ${l3State}</span></div>
          ${l2.note ? `<div class="rm-up">${l2.note}</div>` : ''}
          ${l3.note ? `<div class="rm-up">${l3.note}<button class="rm-btn rm-btn-ghost" type="button" id="op-go-l2">→ 去 L2 优化战法</button></div>` : ''}
        </div>
      </div>
    `;
    summaryEl.querySelector<HTMLButtonElement>('#op-go-l2')?.addEventListener('click', () => {
      setMode('l2');
    });
  }

  function renderStaleHint(): void {
    const st = mode === 'l2' ? l2 : l3;
    const stale = Boolean(st.result) && st.signature !== cfgSignature(cfg);
    modeHintEl.textContent = st.result ? (stale ? '· 结果为修改前的配置（配置已变，请重跑）' : '· 结果对应当前配置') : '';
    modeHintEl.className = stale ? 'rm-down' : 'rm-dim';
  }

  /** 应用 L2 的战法组合：把战法**写进对应槽位**（其余槽位、其余将原样保留） */
  function applyL2Picks(index: number): void {
    const row = l2.result?.finals[index];
    if (!row) return;
    const perUnit = new Map<number, Array<{ slot: number; skillId: string }>>();
    for (const p of row.picks) {
      const arr = perUnit.get(p.unit) ?? [];
      arr.push({ slot: p.slot, skillId: p.skillId });
      perUnit.set(p.unit, arr);
    }
    for (const [unit, picks] of perUnit) {
      const skills = [...cfg.slots[unit].skillIds];
      for (const p of picks) {
        while (skills.length <= p.slot) skills.push('');
        skills[p.slot] = p.skillId;
      }
      cfg.slots[unit].skillIds = skills.filter((v) => v !== '');
    }
    l2.note = `已应用「${row.label}」的战法（核心将期望 ${row.mean.toFixed(0)}）`;
    l3.note = '';
    refreshAfterApply();
  }

  /** 应用 L3 的队友：武将写进对应位 + **该位战法槽清空**（战法留给 L2 配） */
  function applyL3Picks(index: number): void {
    const row = l3.result?.finals[index];
    if (!row) return;
    for (const p of row.picks) {
      cfg.slots[p.unit] = slotForHero(cfg, p.unit, p.heroId);
    }
    l3.note = `已应用队友「${row.label}」（该位战法槽已清空，接着去 L2 配战法）`;
    l2.note = '';
    refreshAfterApply();
  }

  /** 应用后：配置已变 → 两个模式的结果都标「过期」（不静默拿旧数字当新配置的结论），但不丢榜单 */
  function refreshAfterApply(): void {
    renderConfig();
    renderAll();
  }

  // ─────────────────────── 渲染 / 事件 ───────────────────────

  /** 只在当前模式仍是发起者时写结果区（切了模式就别覆盖别人那块） */
  function showIfCurrent(m: Mode, html: string): void {
    if (mode === m) resultEl.innerHTML = html;
  }

  function renderResult(): void {
    resultEl.innerHTML = mode === 'l2' ? l2ResultHtml() : l3ResultHtml();
  }

  function renderAll(): void {
    modesEl.querySelectorAll<HTMLButtonElement>('.op-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    controlsEl.innerHTML = mode === 'l2' ? simControlsHtml(l2ControlsInit()) : mateControlsHtml(l3ControlsInit());
    bindControlChanges();
    renderResult();
    renderSummary();
    renderStaleHint();
  }

  /** 刷新「预计真跑 N 场」文案（参数改动后） */
  function refreshEstimateText(): void {
    const est = controlsEl.querySelector<HTMLElement>(mode === 'l2' ? '#rm-sim-est' : '#mt-est');
    if (!est) return;
    const n = mode === 'l2' ? estimateBattles(cfg, l2OptionsForEstimate()) : estimateMateBattles(cfg, l3OptionsForEstimate());
    est.innerHTML = `预计真跑 <b>${n}</b> 场`;
  }

  /**
   * 控件 change：**逐个绑在元素上**（与 `roundModelView.ts` 同手法——参数区会整体重建，
   * 委托依赖 change 冒泡，而单测里常用 `new Event('change')` 这种不冒泡的事件，逐个绑定两者都稳）。
   * 勾选框变化 → 存进模式状态并重建（队友位勾选会改变其余框的可勾状态）；其余只刷新预计场次。
   */
  function bindControlChanges(): void {
    controlsEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((node) => {
      node.addEventListener('change', () => {
        if (node.matches('[data-sim-match],[data-sim-core],[data-mt-match],[data-mt-core]')) {
          syncUiFromDom();
          renderAll();
          return;
        }
        refreshEstimateText();
      });
    });
  }

  function setMode(next: Mode): void {
    if (mode === next) return;
    mode = next;
    progressEl.innerHTML = '';
    panelEl.dataset.state = (mode === 'l2' ? l2.result : l3.result) ? 'done' : 'idle';
    renderAll();
  }

  // 按钮走事件委托：参数区会整体重建，绑在容器上才不会随按钮一起被换掉
  controlsEl.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement | null)?.id;
    if (id === 'rm-sim-run') void runL2();
    else if (id === 'mt-run') void runL3();
  });

  modesEl.addEventListener('click', (e) => {
    const next = (e.target as HTMLElement | null)?.dataset?.mode;
    if (next === 'l2' || next === 'l3') setMode(next);
  });

  // 结果区：决赛排行的「应用」
  resultEl.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    const simIdx = el.dataset?.simApply;
    if (simIdx !== undefined) {
      applyL2Picks(Number(simIdx));
      return;
    }
    const mateIdx = el.dataset?.mateApply;
    if (mateIdx !== undefined) applyL3Picks(Number(mateIdx));
  });

  // ── 左栏：配置面板（两个模式共用的唯一实例）──
  function renderConfig(): void {
    renderConfigPanel(configEl, cfg, {
      unitBadge: (i) => {
        if (mode === 'l2') {
          const core = l2CoreUnits().includes(i);
          const matched = l2MatchUnits().includes(i);
          return `${core ? '核心将·排序口径' : '队友'}${matched ? ' · L2 参与匹配' : ' · 不参与匹配'}`;
        }
        if (l3CoreUnits().includes(i)) return '核心将·排序口径（固定不动）';
        return l3MatchUnits().includes(i) ? `队友位 ${POSITIONS[i] ?? ''} · L3 参与匹配` : '队友 · 不参与匹配';
      },
      onChange: () => {
        l2.note = '';
        l3.note = '';
        // 空槽位变了（填 / 清战法）→ L2 的「核心位」勾选项按新空槽重建（旧 key 已失效）
        const slotSig = emptySlotsOf()
          .map((s) => s.key)
          .join(',');
        if (slotSig !== l2.slotSig) {
          l2.slotSig = slotSig;
          l2.uiCoreSlotKeys = [];
        }
        renderAll();
      },
    });
  }

  renderConfig();
  renderAll();
}
