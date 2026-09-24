/**
 * 实战胜率页（L4 · 阶段 1）：我方队 × 对手队（对手池）→ 批量跑 → 只看统计，不渲染战报。
 * 标准见 web/battleSim.ts 头部注释（用户 2026-09-22 定稿）。
 */
import type { General, Position } from '../src/engine/types';
import { buildGeneral, HERO_RECORDS, SLOTTED_HEROES, TROOP_CHAR } from './heroes';
import { DEFAULT_ENV, runBatchAsync, type BatchStats, type SimEnv } from './battleSim';
import { fmt } from './roundChart';
import { renderConfigPanel, unitTemplates, type ViewCfg } from './teamConfig';
import { importScanEntries } from './teamScanBrowser';

/** 对手池条目（可备注名） */
export interface OpponentEntry {
  id: string;
  /** 备注名（用户可改） */
  note: string;
  cfg: ViewCfg;
}

interface SimState {
  mine: ViewCfg;
  /** 当前对手（对手池里选中的） */
  current: OpponentEntry;
  pool: OpponentEntry[];
  runs: number;
  env: SimEnv;
}

const POS: Position[] = ['大营', '中军', '前锋'];

/** ViewCfg → 引擎 General[]（同队唯一：武将不重复、战法不重复已在配置层提示） */
export function generalsOf(cfg: ViewCfg, morale: number): General[] {
  return cfg.slots
    .map((s, i) => {
      const rec = HERO_RECORDS[s.heroId];
      if (!rec) return undefined;
      return buildGeneral(
        s.heroId,
        s.skillIds,
        { attack: s.addAttack, strategy: s.addStrategy },
        POS[i] ?? '中军',
        0,
        s.level,
        morale,
        undefined, // 二级兵种转换：截图暂不识别（见 docs/截图识别-敌对队伍集.md §八）
        s.traits, // 兵系通用特性（如 地利）
        s.treasure ?? null // 佩戴宝物（稀世 + 锻造词条）
      );
    })
    .filter((g): g is General => Boolean(g));
}

const POOL_KEY = 'dsh-battle-sim-opponents-v1';

function loadPool(): OpponentEntry[] {
  try {
    const raw = localStorage.getItem(POOL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpponentEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePool(pool: OpponentEntry[]): void {
  try {
    localStorage.setItem(POOL_KEY, JSON.stringify(pool));
  } catch {
    /* ignore */
  }
}

export function mountBattleSim(root: HTMLElement): void {
  const state: SimState = {
    mine: defaultMine(),
    current: { id: 'opp-0', note: '对手 1', cfg: defaultMine() },
    pool: [],
    runs: 500,
    env: { ...DEFAULT_ENV },
  };
  state.pool = loadPool();
  if (state.pool.length) state.current = state.pool[0];

  let result: BatchStats | null = null;
  let running = false;
  let pieUnit: string | null = null;

  root.innerHTML = `
    <div class="bs-wrap">
      <header class="rm-head">
        <div>
          <h1>实战胜率 · 批量模拟</h1>
          <p class="rm-sub">
            引擎真跑 8 回合战斗（含控制 / 规避 / 兵力截断 / 伤兵），<b>只看统计、不出战报</b>。
            判定 = 引擎原生；样本默认 <b>500 场</b>；奇数场交换场地以消除先手偏差；种子固定可复现。
          </p>
        </div>
        <div class="rm-head-links">
          <a class="rm-back" href="/optimizer.html">组合优化器 →</a>
          <a class="rm-back" href="/round-model.html">回合模型 →</a>
          <a class="rm-back" href="/index.html">返回配将</a>
        </div>
      </header>
      <div class="bs-grid">
        <aside class="rm-card bs-side" id="bs-mine"></aside>
        <main class="rm-main">
          <section class="rm-card">
            <div class="bs-runbar">
              <label class="bs-runs">场次
                <select id="bs-runs">
                  ${[100, 200, 500, 2000].map((n) => `<option value="${n}" ${n === 500 ? 'selected' : ''}>${n} 场</option>`).join('')}
                </select>
              </label>
              <label class="bs-swap"><input type="checkbox" id="bs-swap" checked /> 交换场地</label>
              <button class="rm-btn op-run" type="button" id="bs-run">开始模拟</button>
              <span class="op-status" id="bs-status"></span>
            </div>
            <div class="op-progress"><span id="bs-progress"></span></div>
          </section>
          <section class="rm-card" id="bs-opponent"></section>
          <section class="rm-card bs-result" id="bs-result"></section>
        </main>
      </div>
      <div class="rm-card bs-pool" id="bs-pool"></div>
    </div>
  `;

  const mineEl = root.querySelector<HTMLElement>('#bs-mine')!;
  const oppEl = root.querySelector<HTMLElement>('#bs-opponent')!;
  const poolEl = root.querySelector<HTMLElement>('#bs-pool')!;
  const resultEl = root.querySelector<HTMLElement>('#bs-result')!;
  const statusEl = root.querySelector<HTMLElement>('#bs-status')!;
  const progressEl = root.querySelector<HTMLElement>('#bs-progress')!;
  const runBtn = root.querySelector<HTMLButtonElement>('#bs-run')!;

  function defaultMine(): ViewCfg {
    const pick = ['h3', 'h5', 'h16'];
    return {
      slots: pick.map((heroId, i) => {
        const rec = HERO_RECORDS[heroId];
        return {
          heroId,
          level: 40,
          addAttack: 0,
          addStrategy: 0,
          troopType: (rec?.troopType ?? 'infantry') as ViewCfg['slots'][number]['troopType'],
          skillIds: [],
        };
      }),
      morale: 120,
      enemy: { defense: 150, strategy: 100, troopType: 'infantry' },
      rounds: 8,
      manual: { boostCaused: 0, boostTaken: 0, reduce: 0 },
    };
  }

  function renderPanels(): void {
    renderConfigPanel(mineEl, state.mine, {
      unitBadge: (i) => (i === 0 ? '我方 1' : `我方 ${i + 1}`),
      onChange: () => renderResult(),
    });
    renderConfigPanel(oppEl, state.current.cfg, {
      unitBadge: (i) => (i === 0 ? '对手 1' : `对手 ${i + 1}`),
      onChange: () => renderResult(),
    });
  }

  function renderPool(): void {
    const rows = state.pool
      .map(
        (p, i) => `<tr class="${p.id === state.current.id ? 'on' : ''}" data-pool="${i}">
          <td><input class="bs-note" data-note="${i}" value="${escapeAttr(p.note)}" /></td>
          <td class="rm-skills">${unitTemplates(p.cfg)
            .map((t) => t.name)
            .join(' ｜ ')}</td>
          <td><button class="rm-btn rm-btn-ghost" type="button" data-use="${i}">用作对手</button></td>
          <td><button class="rm-del" type="button" data-del="${i}">×</button></td>
        </tr>`
      )
      .join('');
    poolEl.innerHTML = `
      <h2>对手池 <span class="rm-dim">（${state.pool.length} 条，存在浏览器本地）</span></h2>
      <div class="bs-poolbar">
        <button class="rm-btn" type="button" id="bs-save-opp">把当前对手存入池子</button>
        <span class="rm-dim">当前对手：<b id="bs-cur-note">${escapeHtml(state.current.note)}</b></span>
      </div>
      <details class="bs-import">
        <summary>导入识别结果（截图 → 队伍集.json）</summary>
        <textarea id="bs-import-text" spellcheck="false" placeholder='粘贴 已识别敌对队伍集/队伍集.json 全文，或单条识别 JSON'></textarea>
        <div class="bs-poolbar">
          <button class="rm-btn" type="button" id="bs-import-apply">导入</button>
          <button class="rm-btn rm-btn-ghost" type="button" id="bs-import-fetch">从 已识别敌对队伍集/队伍集.json 读</button>
          <span class="rm-dim" id="bs-import-status"></span>
        </div>
      </details>
      ${
        state.pool.length
          ? `<table class="rm-table op-table"><thead><tr><th>备注名</th><th>阵容</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`
          : '<div class="rm-note">还没有保存的对手——右侧配好对手阵容后点「把当前对手存入池子」。</div>'
      }
    `;
    poolEl.querySelectorAll<HTMLInputElement>('[data-note]').forEach((el) =>
      el.addEventListener('change', () => {
        const i = Number(el.dataset.note);
        state.pool[i].note = el.value;
        if (state.pool[i].id === state.current.id) state.current = state.pool[i];
        savePool(state.pool);
        renderPool();
      })
    );
    poolEl.querySelectorAll<HTMLButtonElement>('[data-use]').forEach((el) =>
      el.addEventListener('click', () => {
        state.current = state.pool[Number(el.dataset.use)];
        renderPanels();
        renderPool();
        renderResult();
      })
    );
    poolEl.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((el) =>
      el.addEventListener('click', () => {
        state.pool.splice(Number(el.dataset.del), 1);
        savePool(state.pool);
        if (!state.pool.find((p) => p.id === state.current.id)) {
          state.current = state.pool[0] ?? { id: `opp-${Date.now()}`, note: '对手 1', cfg: defaultMine() };
        }
        renderPanels();
        renderPool();
      })
    );
    poolEl.querySelector<HTMLButtonElement>('#bs-save-opp')?.addEventListener('click', () => {
      const existing = state.pool.find((p) => p.id === state.current.id);
      if (existing) {
        existing.cfg = JSON.parse(JSON.stringify(state.current.cfg));
        existing.note = state.current.note;
      } else {
        state.pool.push(JSON.parse(JSON.stringify(state.current)));
      }
      savePool(state.pool);
      renderPool();
    });

    // 「导入识别结果」：粘贴 队伍集.json / 归档 JSON / 原始识别 JSON（口径见 docs/截图识别-敌对队伍集.md）
    const applyImport = (raw: string): void => {
      // 状态行每次重新查（导入成功会 renderPool() 换掉整块 DOM）
      const show = (msg: string): void => {
        const el = poolEl.querySelector<HTMLElement>('#bs-import-status');
        if (el) el.textContent = msg;
      };
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        show(`解析失败：${String(err).slice(0, 80)}`);
        return;
      }
      const { entries, problems, notices } = importScanEntries(parsed);
      let added = 0;
      for (const e of entries) {
        const exist = state.pool.find((p) => p.note === e.name);
        if (exist) exist.cfg = e.cfg as typeof exist.cfg;
        else state.pool.push({ id: `opp-${Date.now()}-${added}`, note: e.name, cfg: e.cfg as typeof state.current.cfg });
        added += 1;
      }
      if (added) {
        savePool(state.pool);
        state.current = state.pool[state.pool.length - 1];
        renderPanels();
        renderResult();
        renderPool();
      }
      const tail = [...problems, ...notices].slice(0, 1);
      show(added ? `导入 ${added} 队${tail.length ? `（${tail[0]}）` : ''}` : `没有导入：${problems[0] ?? '内容为空'}`);
    };
    poolEl.querySelector<HTMLButtonElement>('#bs-import-apply')?.addEventListener('click', () => {
      applyImport(poolEl.querySelector<HTMLTextAreaElement>('#bs-import-text')?.value ?? '');
    });
    poolEl.querySelector<HTMLButtonElement>('#bs-import-fetch')?.addEventListener('click', () => {
      void (async () => {
        try {
          const res = await fetch(`/${encodeURIComponent('已识别敌对队伍集')}/${encodeURIComponent('队伍集.json')}`);
          if (!res.ok) throw new Error(String(res.status));
          applyImport(await res.text());
        } catch (err) {
          const el = poolEl.querySelector<HTMLElement>('#bs-import-status');
          if (el) el.textContent = `读取失败：${String(err).slice(0, 80)}（该文件由 scripts/scan_team.mts 生成）`;
        }
      })();
    });
  }

  function renderResult(): void {
    if (!result) {
      resultEl.innerHTML = '<div class="rm-note">点上方「开始模拟」——结果只出统计（胜率 / 占比 / 成员饼图），不出战报。</div>';
      return;
    }
    const r = result;
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
    const pie = pieSvg(
      r.skillDamageShare.map((s, i) => ({ ...s, color: PIE_COLORS[i % PIE_COLORS.length] })),
      r.perUnit.find((u) => u.name === pieUnit)?.avgDamage
    );
    resultEl.innerHTML = `
      <div class="bs-hero">
        <div class="bs-hero-num">
          <span class="bs-hero-label">胜率（${r.runs} 场）</span>
          <span class="bs-hero-value">${(r.winRate * 100).toFixed(1)}%</span>
          <span class="rm-dim">± ${(r.winRateHalfWidth * 100).toFixed(1)}%（95%）</span>
        </div>
        <div class="bs-hero-side">
          <div><span>胜 / 平 / 负</span><b>${r.win} / ${r.draw} / ${r.loss}</b></div>
          <div><span>平均剩余兵力优势</span><b>${r.troopAdvantage >= 0 ? '+' : ''}${r.troopAdvantage.toFixed(1)} 点</b></div>
          <div><span>平均回合数</span><b>${r.avgRounds}</b></div>
          <div><span>耗时</span><b>${(r.ms / 1000).toFixed(1)} 秒</b></div>
        </div>
      </div>
      <div class="bs-bars">
        ${bar('我方伤害占比', r.damageShare, '#4da3ff')}
        ${bar('我方控制占比（人回合）', shareOf(r.controlMine, r.controlEnemy), '#b48cff', `我方 ${r.controlMine} / 敌方 ${r.controlEnemy}`)}
        ${bar('我方恢复占比', r.healShare, '#3ddc97', `我方 ${fmt(r.avgHealMine)} / 敌方 ${fmt(r.avgHealEnemy)}`)}
      </div>
      <div class="bs-detail">
        <div>
          <div class="rm-group-title">我方成员（每场平均）</div>
          <table class="rm-table">
            <thead><tr><th>武将</th><th>伤害</th><th>承伤</th><th>恢复</th><th>被控人回合</th></tr></thead>
            <tbody>${r.perUnit
              .map(
                (u) => `<tr class="${u.name === pieUnit ? 'on' : ''}" data-pie="${escapeAttr(u.name)}">
                  <td>${escapeHtml(u.name)}</td><td class="rm-num rm-strong">${fmt(u.avgDamage)}</td>
                  <td class="rm-num rm-dim">${fmt(u.avgTaken)}</td><td class="rm-num">${fmt(u.avgHeal)}</td>
                  <td class="rm-num rm-dim">${u.avgControlTaken}</td></tr>`
              )
              .join('')}</tbody>
          </table>
        </div>
        <div>
          <div class="rm-group-title">伤害构成（点成员看其战法占比）</div>
          <div class="bs-pie">${pie}</div>
        </div>
      </div>
      <div class="rm-group-title" style="margin-top:12px">我方战法明细（每场平均）</div>
      <table class="rm-table">
        <thead><tr><th>来源</th><th>战法</th><th>次数</th><th>伤害</th><th>控制人回合</th><th>恢复</th></tr></thead>
        <tbody>${r.perSkill
          .map(
            (s) => `<tr><td class="rm-dim">${escapeHtml(s.unitName)}</td><td>${escapeHtml(s.skillName)}</td>
              <td class="rm-num">${s.avgCasts}</td><td class="rm-num rm-strong">${fmt(s.avgDamage)}</td>
              <td class="rm-num">${s.avgControl}</td><td class="rm-num">${fmt(s.avgHeal)}</td></tr>`
          )
          .join('')}</tbody>
      </table>
      <div class="rm-note">伤害口径：普攻 + 战法 + DoT 跳伤 + 分兵；控制口径：控制状态的人回合（混乱/暴走/怯战/犹豫，时长从施加事件解析）；
        恢复口径：heal 事件的恢复兵力。全部为「我方」视角统计。</div>
    `;
    resultEl.querySelectorAll<HTMLTableRowElement>('[data-pie]').forEach((row) =>
      row.addEventListener('click', () => {
        pieUnit = row.dataset.pie === pieUnit ? null : row.dataset.pie ?? null;
        renderResult();
      })
    );
  }

  runBtn.addEventListener('click', () => {
    void (async () => {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      statusEl.textContent = '模拟中…';
      progressEl.style.width = '0%';
      try {
        const mine = generalsOf(state.mine, state.mine.morale);
        const opp = generalsOf(state.current.cfg, state.current.cfg.morale);
        if (mine.length < 3 || opp.length < 3) {
          statusEl.textContent = '双方都需要 3 名武将';
          return;
        }
        result = await runBatchAsync(mine, opp, {
          runs: state.runs,
          env: state.env,
          yieldEvery: 25,
          onProgress: (done, total) => {
            progressEl.style.width = `${(done / total) * 100}%`;
            statusEl.textContent = `${done} / ${total} 场…`;
          },
        });
        statusEl.textContent = `完成：胜率 ${(result.winRate * 100).toFixed(1)}% ± ${(result.winRateHalfWidth * 100).toFixed(1)}%（${(result.ms / 1000).toFixed(1)} 秒）`;
        pieUnit = result.perUnit[0]?.name ?? null;
      } catch (err) {
        statusEl.textContent = `出错：${String(err).slice(0, 160)}`;
      } finally {
        running = false;
        runBtn.disabled = false;
        renderResult();
      }
    })();
  });

  root.querySelector<HTMLSelectElement>('#bs-runs')?.addEventListener('change', (ev) => {
    state.runs = Number((ev.target as HTMLSelectElement).value) || 500;
  });
  root.querySelector<HTMLInputElement>('#bs-swap')?.addEventListener('change', (ev) => {
    state.env = { ...state.env, swapSides: (ev.target as HTMLInputElement).checked };
  });

  renderPanels();
  renderPool();
  renderResult();
}

const PIE_COLORS = ['#4da3ff', '#3ddc97', '#ffce67', '#ff6b6b', '#b48cff', '#5ad0e6', '#ff9f6b', '#8b93a3'];

/** 占比条 */
function bar(label: string, ratio: number, color: string, hint?: string): string {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return `<div class="bs-bar-row">
    <span class="bs-bar-label">${label}</span>
    <span class="bs-bar-track"><span class="bs-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></span></span>
    <span class="bs-bar-pct">${pct.toFixed(1)}%</span>
    ${hint ? `<span class="rm-dim bs-bar-hint">${hint}</span>` : ''}
  </div>`;
}

const shareOf = (mine: number, enemy: number): number => (mine + enemy > 0 ? mine / (mine + enemy) : 0);

/** 饼图（SVG 环形）：只画有伤害的战法 */
function pieSvg(
  parts: Array<{ name: string; value: number; color: string }>,
  centerLabel?: number
): string {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return '<div class="rm-note">没有伤害记录</div>';
  const R = 78;
  const r0 = 46;
  const cx = 90;
  const cy = 90;
  let angle = -Math.PI / 2;
  let svg = `<svg viewBox="0 0 180 180" class="bs-pie-svg">`;
  for (const p of parts) {
    const frac = p.value / total;
    const a1 = angle;
    const a2 = angle + frac * Math.PI * 2;
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2);
    const y2 = cy + R * Math.sin(a2);
    const xi1 = cx + r0 * Math.cos(a1);
    const yi1 = cy + r0 * Math.sin(a1);
    const xi2 = cx + r0 * Math.cos(a2);
    const yi2 = cy + r0 * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    svg += `<path d="M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${r0} ${r0} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${p.color}" opacity="0.85"><title>${escapeHtml(
      p.name
    )}：${fmt(p.value)}（${(frac * 100).toFixed(1)}%）</title></path>`;
    angle = a2;
  }
  svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" class="bs-pie-center">${
    centerLabel !== undefined ? fmt(centerLabel) : fmt(total)
  }</text>`;
  svg += '</svg>';
  const legend = parts
    .map(
      (p) =>
        `<div class="lg-item"><span class="lg-dot" style="background:${p.color}"></span><span>${escapeHtml(
          p.name
        )}</span><span class="lg-pct">${((p.value / total) * 100).toFixed(1)}%</span></div>`
    )
    .join('');
  return `${svg}<div class="sc-legend">${legend}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] ?? m));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
void SLOTTED_HEROES;
void TROOP_CHAR;
