/**
 * 组合优化器页面（L3）：① 战法最优解（束搜索） ② 队友最佳搭配（两阶段枚举）。
 * 目标函数 = 前三回合总伤（口径同 L2）。独立页 optimizer.html，不并入主站。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { HERO_RECORDS, SLOTTED_HEROES, TROOP_CHAR } from './heroes';
import { fmt, renderRoundChart, renderRoundLegend } from './roundChart';
import { windowTotals } from './roundModel';
import { EFFECT_LABEL, type RoundModelResult } from './roundModel';
import {
  candidatePool,
  makeEvaluator,
  searchLoadoutsSteps,
  searchTeammates,
  type Progress,
  type SearchReport,
  type TeammateResult,
} from './optimizer';
import { defaultCfg, renderConfigPanel, unitTemplates, type ViewCfg } from './teamConfig';

type TabKey = 'skills' | 'mates';

interface SkillSearchCfg {
  mode: 'output' | 'all';
  slots: number;
  beam: number;
  /** 候选池档位：strict=只搜模型完整的战法（默认）；contributing=有贡献但部分建模；all=全量 */
  poolTier: 'strict' | 'contributing' | 'all';
  /** 目标口径回合数：3 = 前三回合；cfg.rounds = 整局 */
  objective: number;
}

interface MateSearchCfg {
  keep: number;
  poolSize: number;
}

const SKILL_NAME = (id: string): string => SKILL_REGISTRY[id]?.name ?? id;
const HERO_NAME = (id: string): string => HERO_RECORDS[id]?.name ?? id;

/** 目标口径标签（3 = 前三回合，达到 cfg.rounds = 整局） */
const objectiveLabel = (rounds: number, cfgRounds = 8): string =>
  rounds >= cfgRounds ? `整局（${cfgRounds} 回合）` : `前 ${rounds} 回合`;

/** 单次评估耗时（3 回合 ≈ 0.2ms，整局 8 回合 ≈ 0.55ms）——用于预估搜索时间 */
const evalCostMs = (rounds: number): number => 0.07 * rounds;

export function mountOptimizer(root: HTMLElement): void {
  try {
    mountOptimizerInner(root);
  } catch (err) {
    // 出错也要可见：否则页面只剩半边（用户只会看到「选项没了」）
    root.innerHTML = `
      <div style="max-width:900px;margin:40px auto;padding:20px;border:1px solid #6b3b3b;border-radius:12px;background:#1b1418;color:#ffb4b4;font:14px/1.7 'Microsoft YaHei',sans-serif">
        <h2 style="margin:0 0 10px;color:#ff6b6b">优化器页面出错</h2>
        <pre style="white-space:pre-wrap;color:#ffd8d8">${String(err && (err as Error).stack ? (err as Error).stack : err)}</pre>
        <p style="color:#c99">把这段报错发我即可定位。</p>
      </div>`;
  }
}

function mountOptimizerInner(root: HTMLElement): void {
  const cfg: ViewCfg = defaultCfg();
  const skillSearch: SkillSearchCfg = { mode: 'output', slots: 2, beam: 16, poolTier: 'strict', objective: 3 };
  const mateSearch: MateSearchCfg = { keep: 18, poolSize: 60 };

  let tab: TabKey = 'skills';
  let report: SearchReport | null = null;
  let selected = 0;
  let mates: TeammateResult[] = [];
  let progress: Progress | null = null;
  let running = false;

  root.innerHTML = `
    <div class="rm-wrap">
      <header class="rm-head">
        <div>
          <h1>组合优化器 · 前三回合总伤最大化</h1>
          <p class="rm-sub">
            代价函数 = L2 回合期望模型（引擎 <code>calcDamage</code> 直采）。搜的是<b>输出上界口径</b>下的最优解：
            不含控制 / 规避 / 兵力截断。每步束搜索保留前 N 个中间态，避免贪心掉进局部最优。
          </p>
        </div>
        <div class="rm-head-links">
          <a class="rm-back" href="/round-model.html">回合模型 →</a>
          <a class="rm-back" href="/damage-model.html">单次伤害模型 →</a>
          <a class="rm-back" href="/index.html">返回配将</a>
        </div>
      </header>
      <div class="rm-grid">
        <aside class="rm-card rm-side" id="op-config"></aside>
        <main class="rm-main">
          <section class="rm-card">
            <div class="op-tabs">
              <button type="button" class="op-tab" data-tab="skills">① 战法最优解</button>
              <button type="button" class="op-tab" data-tab="mates">② 队友最佳搭配</button>
            </div>
            <div id="op-settings"></div>
            <div class="op-runbar">
              <button class="rm-btn op-run" type="button" id="op-run">开始搜索</button>
              <span class="op-status" id="op-status"></span>
            </div>
            <div class="op-progress"><span id="op-progress-bar"></span></div>
          </section>
          <section class="rm-card rm-hero" id="op-baseline"></section>
          <section class="rm-card">
            <h2 id="op-results-title">搜索结果</h2>
            <div id="op-results"></div>
          </section>
          <section class="rm-card" id="op-detail-card">
            <h2>选中方案：每回合期望伤害</h2>
            <div class="rm-legend" id="op-legend"></div>
            <div class="rm-chart" id="op-chart"></div>
            <div id="op-detail"></div>
          </section>
        </main>
      </div>
    </div>
  `;

  const configEl = root.querySelector<HTMLElement>('#op-config')!;
  const settingsEl = root.querySelector<HTMLElement>('#op-settings')!;
  const statusEl = root.querySelector<HTMLElement>('#op-status')!;
  const progressEl = root.querySelector<HTMLElement>('#op-progress-bar')!;
  const baselineEl = root.querySelector<HTMLElement>('#op-baseline')!;
  const resultsEl = root.querySelector<HTMLElement>('#op-results')!;
  const resultsTitleEl = root.querySelector<HTMLElement>('#op-results-title')!;
  const detailEl = root.querySelector<HTMLElement>('#op-detail')!;
  const chartEl = root.querySelector<HTMLElement>('#op-chart')!;
  const legendEl = root.querySelector<HTMLElement>('#op-legend')!;
  const runBtn = root.querySelector<HTMLButtonElement>('#op-run')!;

  /** 当前配置（三将手选战法）下的前三回合总伤 */
  function baselineScore(): number {
    return makeEvaluator(cfg, skillSearch.objective).score({
      0: cfg.slots[0].skillIds,
      1: cfg.slots[1].skillIds,
      2: cfg.slots[2].skillIds,
    });
  }

  function renderConfig(): void {
    renderConfigPanel(configEl, cfg, {
      unitBadge: (i) => (i === 0 ? '输出将' : `队友 ${i}`),
      onChange: () => {
        report = null;
        mates = [];
        selected = 0;
        renderAll();
      },
    });
  }

  function renderSettings(): void {
    root.querySelectorAll<HTMLButtonElement>('.op-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tab);
    });
    if (tab === 'skills') {
      const pool = candidatePool(cfg.morale);
      const poolSize = skillSearch.poolTier === 'all' ? pool.all.length : skillSearch.poolTier === 'contributing' ? pool.contributing.length : pool.strict.length;
      const unitCount = skillSearch.mode === 'all' ? 3 : 1;
      const est = skillSearch.slots * unitCount * skillSearch.beam * poolSize;
      const excludedSample = pool.excluded.slice(0, 8).map((e) => e.name).join('、');
      const objectiveOptions = [3, 5, cfg.rounds].filter((v, i, a) => v <= cfg.rounds && a.indexOf(v) === i);
      settingsEl.innerHTML = `
        <div class="op-settings">
          <label>目标口径
            <select data-set="objective">
              ${objectiveOptions
                .map(
                  (v) =>
                    `<option value="${v}" ${skillSearch.objective === v ? 'selected' : ''}>${
                      v >= cfg.rounds ? `整局 ${cfg.rounds} 回合总伤` : `前 ${v} 回合总伤`
                    }</option>`
                )
                .join('')}
            </select></label>
          <label>搜索范围
            <select data-set="mode">
              <option value="output" ${skillSearch.mode === 'output' ? 'selected' : ''}>只优化 1 号位（输出将）</option>
              <option value="all" ${skillSearch.mode === 'all' ? 'selected' : ''}>三将一起优化（慢 3 倍）</option>
            </select></label>
          <label>每将槽位
            <select data-set="slots">
              ${[1, 2].map((n) => `<option value="${n}" ${skillSearch.slots === n ? 'selected' : ''}>${n} 槽（主战法外）</option>`).join('')}
            </select></label>
          <label>束宽
            <select data-set="beam">
              ${[8, 16, 32, 64].map((n) => `<option value="${n}" ${skillSearch.beam === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select></label>
          <label>候选池
            <select data-set="poolTier">
              <option value="strict" ${skillSearch.poolTier === 'strict' ? 'selected' : ''}>严格·模型完整（${pool.strict.length}）</option>
              <option value="contributing" ${skillSearch.poolTier === 'contributing' ? 'selected' : ''}>有贡献·含部分建模（${pool.contributing.length}）</option>
              <option value="all" ${skillSearch.poolTier === 'all' ? 'selected' : ''}>全部战法（${pool.all.length}）</option>
            </select></label>
        </div>
        <div class="rm-note">目标 = <b>${objectiveLabel(skillSearch.objective, cfg.rounds)}总伤</b>（口径与 L2 回合模型一致）。
          预计评估 ≈ ${est.toLocaleString('en-US')} 次 × ${evalCostMs(skillSearch.objective).toFixed(2)}ms ≈ ${(
            (est * evalCostMs(skillSearch.objective)) /
            1000
          ).toFixed(1)} 秒。严格池只含「有输出贡献且没有未建模字段」的战法，另有 ${pool.excluded.length} 个因部分建模被排除${
            excludedSample ? `（如 ${excludedSample}…）` : ''
          }。</div>
      `;
    } else {
      settingsEl.innerHTML = `
        <div class="op-settings">
          <label>候选队友池
            <select data-set="poolSize">
              ${[30, 60, 157].map((n) => `<option value="${n}" ${mateSearch.poolSize === n ? 'selected' : ''}>前 ${n} 名（按战力序）</option>`).join('')}
            </select></label>
          <label>进两两枚举
            <select data-set="keep">
              ${[12, 18, 30].map((n) => `<option value="${n}" ${mateSearch.keep === n ? 'selected' : ''}>前 ${n} 名</option>`).join('')}
            </select></label>
        </div>
        <div class="rm-note">两阶段：① 单队友扫描（队友只带自身主战法）→ ② 取前 K 名两两组合精算队伍总伤。
          评估次数 ≈ ${mateSearch.poolSize} + C(${mateSearch.keep},2) = ${(mateSearch.poolSize + (mateSearch.keep * (mateSearch.keep - 1)) / 2).toLocaleString('en-US')} 次。</div>
      `;
    }
    settingsEl.querySelectorAll<HTMLSelectElement>('[data-set]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.set!;
        if (key === 'mode') skillSearch.mode = el.value as SkillSearchCfg['mode'];
        else if (key === 'objective') skillSearch.objective = Number(el.value) || 3;
        else if (key === 'poolTier') skillSearch.poolTier = el.value as SkillSearchCfg['poolTier'];
        else if (key === 'slots') skillSearch.slots = Number(el.value);
        else if (key === 'beam') skillSearch.beam = Number(el.value);
        else if (key === 'poolSize') mateSearch.poolSize = Number(el.value);
        else if (key === 'keep') mateSearch.keep = Number(el.value);
        report = null;
        mates = [];
        renderAll();
      });
    });
    runBtn.textContent = tab === 'skills' ? '开始搜索战法' : '开始搜索队友';
  }

  function renderBaseline(): void {
    const base = baselineScore();
    const units = unitTemplates(cfg);
    const best = report?.results[0];
    const bestMates = mates[0];
    baselineEl.innerHTML = `
      <div class="rm-hero-main">
        <div class="rm-hero-num">
          <span class="rm-hero-label">当前配置 · 前三回合总伤</span>
          <span class="rm-hero-value">${fmt(base)}</span>
        </div>
        <div class="rm-hero-side">
          <div><span>队伍</span><b>${units.map((u) => `${u.name}（${TROOP_CHAR[u.troopType] ?? ''}）`).join(' ｜ ')}</b></div>
          ${
            best
              ? `<div><span>搜索最优</span><b class="rm-up">${fmt(best.score)}（${
                  base ? (((best.score - base) / base) * 100 >= 0 ? '+' : '') + (((best.score - base) / base) * 100).toFixed(1) : '—'
                }%）</b></div>`
              : ''
          }
          ${bestMates ? `<div><span>最佳队友</span><b class="rm-up">${fmt(bestMates.score)}</b></div>` : ''}
        </div>
      </div>
    `;
  }

  /** 应用一组战法选择到配置（写入对应单位的槽位） */
  function applyPicks(picks: Record<number, string[]>): void {
    cfg.slots.forEach((s, i) => {
      s.skillIds = [...(picks[i] ?? [])];
    });
    report = null;
    mates = [];
    renderConfig();
    renderAll();
  }

  function renderSkillsResults(): void {
    if (!report) {
      resultsEl.innerHTML = '<div class="rm-note">还没有结果——点上方「开始搜索战法」。</div>';
      return;
    }
    const base = baselineScore();
    const units = unitTemplates(cfg);
    const obj = objectiveLabel(skillSearch.objective, cfg.rounds);
    resultsTitleEl.textContent = `搜索结果 · 前 ${report.results.length} 名（目标：${obj}总伤，评估 ${report.evaluated.toLocaleString('en-US')} 次）`;
    resultsEl.innerHTML = `
      <table class="rm-table op-table">
        <thead><tr><th>#</th><th>战法组合</th><th>${obj}</th><th>前三回合</th><th>整局</th><th>相对当前</th><th></th></tr></thead>
        <tbody>
          ${report.results
            .map((r, i) => {
              const delta = base ? ((r.score - base) / base) * 100 : 0;
              const combo = units
                .map((u, ui) => `<div class="op-combo"><span class="rm-dim">${u.name}</span> ${(r.picks[ui] ?? []).map(SKILL_NAME).join(' + ') || '—'}</div>`)
                .join('');
              const full = makeEvaluator(cfg).full(r.picks);
              return `<tr class="${i === selected ? 'on' : ''}" data-result="${i}">
                <td class="rm-num">${i + 1}</td>
                <td>${combo}</td>
                <td class="rm-num rm-strong">${fmt(r.score)}</td>
                <td class="rm-num rm-dim">${fmt(windowTotals(full, 3).total)}</td>
                <td class="rm-num rm-dim">${fmt(full.total)}</td>
                <td class="${delta >= 0 ? 'rm-up' : 'rm-down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</td>
                <td><button class="rm-btn rm-btn-ghost" type="button" data-apply="${i}">应用</button></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      ${
        report.alternatives.length
          ? `<div class="rm-group-title" style="margin-top:14px">最优解的单槽替换建议（差多少）</div>
             <table class="rm-table">
               <thead><tr><th>位置</th><th>换成</th><th>${obj}</th><th>差</th></tr></thead>
               <tbody>${report.alternatives
                 .map(
                   (a) => `<tr><td>${units[a.unitIdx]?.name ?? '?'} 槽${a.slot + 1}</td>
                     <td>${SKILL_NAME(a.skillId)}</td>
                     <td class="rm-num">${fmt(a.score)}</td>
                     <td class="rm-down">${(a.delta / (base || 1) * 100).toFixed(1)}%</td></tr>`
                 )
                 .join('')}</tbody>
             </table>`
          : ''
      }
    `;
    resultsEl.querySelectorAll<HTMLTableRowElement>('[data-result]').forEach((row) => {
      row.addEventListener('click', () => {
        selected = Number(row.dataset.result);
        renderSkillsResults();
        renderDetail();
      });
    });
    resultsEl.querySelectorAll<HTMLButtonElement>('[data-apply]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const r = report!.results[Number(btn.dataset.apply)];
        applyPicks(r.picks);
      });
    });
  }

  function renderMatesResults(): void {
    if (!mates.length) {
      resultsEl.innerHTML = '<div class="rm-note">还没有结果——点上方「开始搜索队友」。</div>';
      return;
    }
    const base = baselineScore();
    const obj = objectiveLabel(skillSearch.objective, cfg.rounds);
    resultsTitleEl.textContent = `队友搭配 · 前 ${mates.length} 名（目标：${obj}总伤）`;
    resultsEl.innerHTML = `
      <table class="rm-table op-table">
        <thead><tr><th>#</th><th>队友组合</th><th>主战法</th><th>${obj}</th><th>相对当前</th><th></th></tr></thead>
        <tbody>
          ${mates
            .map((m, i) => {
              const delta = base ? ((m.score - base) / base) * 100 : 0;
              return `<tr class="${i === 0 ? 'on' : ''}">
                <td class="rm-num">${i + 1}</td>
                <td>${m.heroIds.map((id) => `${HERO_NAME(id)}<span class="rm-dim">（${TROOP_CHAR[HERO_RECORDS[id]?.troopType ?? ''] ?? ''}）</span>`).join(' + ')}</td>
                <td class="rm-skills">${m.heroIds.map((id) => SKILL_NAME(HERO_RECORDS[id]?.mainSkillId ?? '')).join(' / ')}</td>
                <td class="rm-num rm-strong">${fmt(m.score)}</td>
                <td class="${delta >= 0 ? 'rm-up' : 'rm-down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%</td>
                <td><button class="rm-btn rm-btn-ghost" type="button" data-mates="${i}">应用</button></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <div class="rm-note">队友只带自身主战法（不带额外槽）。行内「相对当前」= 与左栏当前三将配置相比。</div>
    `;
    resultsEl.querySelectorAll<HTMLButtonElement>('[data-mates]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = mates[Number(btn.dataset.mates)];
        cfg.slots[1].heroId = m.heroIds[0];
        cfg.slots[2].heroId = m.heroIds[1];
        cfg.slots[1].skillIds = [];
        cfg.slots[2].skillIds = [];
        mates = [];
        renderConfig();
        renderAll();
      });
    });
  }

  /** 选中方案的明细：每回合图 + 生效修正 + 未覆盖 */
  function renderDetail(): void {
    if (tab !== 'skills' || !report?.results[selected]) {
      chartEl.innerHTML = '<div class="rm-note">切换到「战法最优解」并选中一行，这里显示该组合的每回合期望伤害。</div>';
      legendEl.innerHTML = '';
      detailEl.innerHTML = '';
      return;
    }
    const picks = report.results[selected].picks;
    const result: RoundModelResult = makeEvaluator(cfg, skillSearch.objective).full(picks);
    renderRoundChart(chartEl, result, { highlight: skillSearch.objective });
    renderRoundLegend(legendEl);
    const top = result.effectLog
      .slice()
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8);
    const win = windowTotals(result, skillSearch.objective);
    const warnCount = new Set(result.warnings.map((w) => `${w.skill}|${w.detail}`)).size;
    detailEl.innerHTML = `
      <div class="rm-note">目标口径（${objectiveLabel(skillSearch.objective)}）<b class="rm-strong">${fmt(win.total)}</b>
        ｜ 前三回合 ${fmt(windowTotals(result, 3).total)} ｜ 整局 ${cfg.rounds} 回合 ${fmt(result.total)}
        ｜ 模型未覆盖 ${warnCount} 项</div>
      ${
        top.length
          ? `<table class="rm-table">
              <thead><tr><th>生效修正</th><th>来源</th><th>数值</th><th>回合</th></tr></thead>
              <tbody>${top
                .map((e) => {
                  const pct = e.kind === 'boostCaused' || e.kind === 'boostTaken' || e.kind === 'reduce' || e.kind === 'combo' || e.kind === 'triggerBoost';
                  return `<tr><td>${EFFECT_LABEL[e.kind]}</td><td class="rm-dim">${e.source}</td>
                    <td class="rm-num">${pct ? `${(e.value * 100).toFixed(1)}%` : e.value.toFixed(1)}</td>
                    <td class="rm-dim">${e.from === e.to ? `第 ${e.from}` : `${e.from}~${e.to}`}</td></tr>`;
                })
                .join('')}</tbody>
            </table>`
          : '<div class="rm-note">该组合没有可抽取的增减伤 / 属性修正。</div>'
      }
    `;
  }

  function renderAll(): void {
    renderSettings();
    renderBaseline();
    if (tab === 'skills') renderSkillsResults();
    else renderMatesResults();
    renderDetail();
  }

  root.querySelectorAll<HTMLButtonElement>('.op-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab as TabKey;
      selected = 0;
      renderAll();
    });
  });

  // ── 运行搜索（生成器逐让出主线程，避免长任务冻界面）──
  async function run(): Promise<void> {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    statusEl.textContent = '计算中…';
    progressEl.style.width = '0%';
    try {
      if (tab === 'skills') {
        const pool = candidatePool(cfg.morale);
        const candidates =
          skillSearch.poolTier === 'all' ? pool.all : skillSearch.poolTier === 'contributing' ? pool.contributing : pool.strict;
        const unitIdxs = skillSearch.mode === 'output' ? [0] : [0, 1, 2];
        const iterator = searchLoadoutsSteps(cfg, {
          unitIdxs,
          slots: skillSearch.slots,
          candidates,
          beam: skillSearch.beam,
          top: 20,
          rounds: skillSearch.objective,
        });
        let step = iterator.next();
        while (!step.done) {
          progress = step.value;
          progressEl.style.width = `${(progress.step / progress.steps) * 100}%`;
          statusEl.textContent = `第 ${progress.step}/${progress.steps} 步 · 已评估 ${progress.evaluated.toLocaleString('en-US')} 次 · 当前最好 ${fmt(progress.bestSoFar)}（${objectiveLabel(skillSearch.objective, cfg.rounds)}）`;
          await new Promise((res) => setTimeout(res, 0));
          step = iterator.next();
        }
        report = step.value;
        selected = 0;
        statusEl.textContent = `完成：评估 ${report.evaluated.toLocaleString('en-US')} 次，${objectiveLabel(skillSearch.objective, cfg.rounds)}最优 ${fmt(report.results[0]?.score ?? 0)}`;
      } else {
        const pool = SLOTTED_HEROES.slice(0, mateSearch.poolSize).map((h) => h.id);
        statusEl.textContent = '扫描候选队友…';
        await new Promise((res) => setTimeout(res, 0));
        const out = searchTeammates(
          cfg,
          { pool, keep: mateSearch.keep, top: 20, rounds: skillSearch.objective },
          (p) => {
            progressEl.style.width = `${(p.step / p.steps) * 100}%`;
            statusEl.textContent = `第 ${p.step}/${p.steps} 阶段 · 已评估 ${p.evaluated.toLocaleString('en-US')} 次 · 当前最好 ${fmt(p.bestSoFar)}`;
          }
        );
        mates = out.results;
        statusEl.textContent = `完成：评估 ${out.evaluated.toLocaleString('en-US')} 次，最优 ${fmt(mates[0]?.score ?? 0)}`;
      }
    } finally {
      progressEl.style.width = '100%';
      running = false;
      runBtn.disabled = false;
      progress = null;
      renderAll();
    }
  }

  runBtn.addEventListener('click', () => {
    void run();
  });

  renderConfig();
  renderAll();
}
