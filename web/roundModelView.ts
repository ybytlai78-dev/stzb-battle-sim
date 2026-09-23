/**
 * 回合期望模型页面（L2 视图）：配置队伍 → 每回合期望伤害 / 前三回合总伤 / 来源拆解。
 * 独立页 round-model.html，不并入主站（用户 2026-09-22 口径）。
 */
import type { TroopType } from '../src/engine/types';
import { HERO_RECORDS, TROOP_CHAR } from './heroes';
import { renderRoundChart, renderRoundLegend, SOURCE_COLOR, fmt } from './roundChart';
import { EFFECT_LABEL, SOURCE_ORDER, windowTotals, type RoundModelResult } from './roundModel';
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
            解析式期望（非模拟）：<code>Σ 出手位 × 期望发动次数 × 单次伤害</code>。单次伤害回到引擎 <code>calcDamage</code>。
            口径：<b>不含控制 / 规避 / 兵力截断 / 目标阵亡</b>（输出上界）。
          </p>
        </div>
        <div class="rm-head-links">
          <a class="rm-back" href="/damage-model.html">单次伤害模型 →</a>
          <a class="rm-back" href="/index.html">返回配将</a>
        </div>
      </header>
      <div class="rm-grid">
        <aside class="rm-card rm-side" id="rm-config"></aside>
        <main class="rm-main">
          <section class="rm-card rm-hero" id="rm-summary"></section>
          <section class="rm-card">
            <h2>每回合期望伤害（按来源堆叠）</h2>
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
  }

  renderConfig();
  draw();
}
