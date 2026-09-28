/**
 * L2 伤害期望模型 · 模拟测评的视图层（参数条 + 榜单 + 排行 + 口径提示），与页面挂载解耦：
 * 纯函数出 HTML（好测），`web/roundModelView.ts` 只负责事件绑定 / 进度 / 异步跑批。
 * 口径见 `web/simExpectation.ts` 头部（木桩不还手；粗筛 3 场 → 榜单前十 → 决赛 20 场）。
 */
import { FINAL_RUNS_MIN, type FinalRow, type SimExpectProgress, type SimExpectResult } from './simExpectation';
import { fmt } from './roundChart';

const esc = (s: string): string => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] ?? m));
const pct = (v: number, digits = 1): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

export interface SimControlsInit {
  coarseRuns: number;
  finalRuns: number;
  /** 每个将粗筛后保留的选项数（双槽将的选项 = 成对组合） */
  unitKeep: number;
  /** 双槽将的配对基准数（单挂前 N 名 × 全部候选） */
  pairCarriers: number;
  coarseTop: number;
  maxCombos: number;
  rankBy: 'total' | 'first3';
  dummyTroops: number;
  seed: number;
  swapSides: boolean;
  /** 全部武将（下标 + 名字 + 是否有空槽）：渲染「参与匹配的将」勾选 */
  units: Array<{ unit: number; name: string; hasEmptySlot: boolean }>;
  /** 参与匹配的将（勾选状态） */
  matchUnits: number[];
  /** 空槽位（下标 + 武将名）：渲染「核心位」勾选 */
  emptySlots: Array<{ key: string; unit: number; slot: number; unitName: string }>;
  /** 被勾成核心位的槽位 key 集合（勾中该槽 ⇒ 该将伤害计入排序目标） */
  coreSlotKeys: string[];
  /** 自动识别的核心将名（未勾任何槽位时生效） */
  autoCoreName: string;
  /** 预计真跑场次（页面用 `estimateBattles` 算好传进来） */
  estimate?: number;
}

/** 参数区：粗筛 3 场 / 决赛 ≥20 场 / 榜单前十进决赛都是可配置参数 */
export function simControlsHtml(init: SimControlsInit): string {
  const keepOptions = [10, 20, 32, 50]
    .map((v) => `<option value="${v}" ${v === init.unitKeep ? 'selected' : ''}>${v} 个</option>`)
    .join('');
  const pairOptions = [3, 5, 10, 15, 20]
    .map((v) => `<option value="${v}" ${v === init.pairCarriers ? 'selected' : ''}>${v} 个</option>`)
    .join('');
  const topOptions = [8, 16, 32, 50]
    .map((v) => `<option value="${v}" ${v === init.coarseTop ? 'selected' : ''}>${v} 支</option>`)
    .join('');
  const coreKeys = new Set(init.coreSlotKeys);
  return `
    <div class="rm-simbar">
      <label>粗筛场次<input id="rm-sim-coarse" type="number" min="1" max="20" step="1" value="${init.coarseRuns}" /></label>
      <label>决赛场次<input id="rm-sim-final" type="number" min="${FINAL_RUNS_MIN}" max="1000" step="10" value="${init.finalRuns}" /></label>
      <label>每将保留<select id="rm-sim-keep">${keepOptions}</select></label>
      <label>配对基准<select id="rm-sim-paircars">${pairOptions}</select></label>
      <label>进决赛组合<select id="rm-sim-top">${topOptions}</select></label>
      <label>组合评估上限<input id="rm-sim-maxcombo" type="number" min="1" max="5000" step="50" value="${init.maxCombos}" /></label>
      <label>时间窗<select id="rm-sim-rank">
        <option value="total" ${init.rankBy === 'total' ? 'selected' : ''}>整局</option>
        <option value="first3" ${init.rankBy === 'first3' ? 'selected' : ''}>前三回合</option>
      </select></label>
      <label>木桩兵力<input id="rm-sim-troops" type="number" min="500" max="999999" step="10000" value="${init.dummyTroops}" /></label>
      <label>种子<input id="rm-sim-seed" type="number" min="1" step="1" value="${init.seed}" /></label>
      <label class="rm-sim-check"><input id="rm-sim-swap" type="checkbox" ${init.swapSides ? 'checked' : ''} /> 交换场地</label>
      <button class="rm-btn rm-sim-run" type="button" id="rm-sim-run">开始模拟测评</button>
    </div>
    <div class="rm-simscope">
      <div class="rm-simscope-col">
        <div class="rm-group-title">参与匹配的将（其余将的战法原样保留、不动）</div>
        ${init.units
          .map(
            (u) => `<label class="rm-simscope-item"><input type="checkbox" data-sim-match="${u.unit}" ${
              init.matchUnits.includes(u.unit) ? 'checked' : ''
            } ${u.hasEmptySlot ? '' : 'disabled'} /> ${esc(u.name)}<span class="rm-dim">${
              u.hasEmptySlot ? '（有空槽）' : '（无空槽）'
            }</span></label>`
          )
          .join('')}
      </div>
      <div class="rm-simscope-col">
        <div class="rm-group-title">核心位（勾中 ⇒ 该将伤害计入排序目标；不勾 = 自动识别「${esc(init.autoCoreName)}」）</div>
        ${
          init.emptySlots.length
            ? init.emptySlots
                .map(
                  (s) =>
                    `<label class="rm-simscope-item"><input type="checkbox" data-sim-core="${s.key}" ${
                      coreKeys.has(s.key) ? 'checked' : ''
                    } /> ${esc(s.unitName)}·槽${s.slot + 1}</label>`
                )
                .join('')
            : '<span class="rm-dim">（当前没有空槽位）</span>'
        }
      </div>
    </div>
    <div class="rm-note">
      靶子 = <b>不还手的木桩 ×3</b>（不放战法、不普攻；防御 / 谋略 / 兵种取左侧「目标」栏）——本页只算<b>伤害期望</b>，胜率是 L4 的事。<br />
      <b>排序口径 = 核心将的伤害期望</b>（不是全队总伤）：辅助战法的强度不随施法者变，用总伤排会出现「主C带辅助、辅助带输出」；
      改成核心将口径后，输出战法只有放在核心将身上才涨目标，定位自然落位。<br />
      流程 = ① 逐将粗筛（每个候选战法 <b>${init.coarseRuns}</b> 场；**双槽将按成对组合评估**——单挂成绩看不出「击势」这类
      带满槽才见效的增伤战法，故取单挂前 ${init.pairCarriers} 名当搭子基准、与全部候选各配一次；每将保留前 ${init.unitKeep} 个选项）→
      ② 组合粗筛<b>榜单</b>（每个整队组合 ${init.coarseRuns} 场）→ ③ 前 <b>${init.coarseTop}</b> 支不同战法套进决赛，每支
      <b>${init.finalRuns}</b> 场汇总期望排行。<br />
      只填空槽：<b>已指定战法的槽位原样保留</b>（可以把空槽先改成自定义防御体系战法再评测）；候选池 = 全部可学战法 − 队内已占用。
      <span id="rm-sim-est">预计真跑 <b>${init.estimate ?? 0}</b> 场</span>
    </div>`;
}

/** 进度条文案 */
export function simProgressHtml(p: SimExpectProgress): string {
  const phase = p.phase === 'slot' ? '逐槽粗筛' : p.phase === 'combo' ? '组合粗筛' : '决赛';
  const w = p.phaseTotal ? Math.min(100, (p.phaseDone / p.phaseTotal) * 100) : 0;
  return `<div class="rm-sim-live"><i style="width:${w.toFixed(1)}%"></i></div>
    <div class="rm-dim rm-sim-status">${phase} ${p.phaseDone} / ${p.phaseTotal} 场 · 累计 ${p.battle} 场 · ${esc(p.label)}</div>`;
}

/** ① 逐将粗筛：每个参与匹配的将一张表（单槽 = 单战法；双槽 = 成对组合） */
function slotHtml(result: SimExpectResult): string {
  if (!result.coarse.length) return '';
  const blocks = result.coarse
    .map((unit) => {
      const rows = unit.rows
        .slice(0, 12)
        .map(
          (r) => `<tr class="${r.kept ? 'rm-sim-kept' : ''}">
            <td class="rm-num rm-dim">${r.rank}</td>
            <td>${r.kept ? '<span class="rm-strong">★ </span>' : ''}${esc(r.label)}${
              r.from === 'pair' ? '' : '<span class="rm-dim">（单挂）</span>'
            }</td>
            <td class="rm-num rm-dim">${r.damages.map((d) => fmt(d)).join(' / ')}</td>
            <td class="rm-num rm-strong">${fmt(r.meanCore)}</td>
            <td class="rm-num rm-dim">${fmt(r.meanTotal)}</td>
            <td class="rm-num">${fmt(r.meanCoreFirst3)}</td>
            <td class="rm-dim">${r.kept ? '进组合' : '淘汰'}</td>
          </tr>`
        )
        .join('');
      return `<div class="rm-sim-slot">
        <div class="rm-sim-slot-head">粗筛 · ${esc(unit.unitName)}（${unit.mode === 'pair' ? '双槽·成对评估' : '单槽'}：槽${unit.slots
        .map((s) => s + 1)
        .join(' + 槽')}）
          <span class="rm-dim">${unit.rows.length} 个${unit.mode === 'pair' ? '组合' : '候选'} × ${result.options.coarseRuns} 场 · 保留 ${
        unit.keptKeys.length
      } 个</span>
        </div>
        <table class="rm-table">
          <thead><tr><th>名次</th><th>${unit.mode === 'pair' ? '战法组合（两个槽一起）' : '候选战法'}</th><th>逐场（核心将伤害）</th><th>核心将·整局</th><th>全队·整局</th><th>核心将·前三</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${unit.rows.length > 12 ? `<div class="rm-note">只显示前 12 名，其余 ${unit.rows.length - 12} 个已淘汰。</div>` : ''}
      </div>`;
    })
    .join('');
  const pairUnits = result.coarse.filter((u) => u.mode === 'pair').length;
  return `<div class="rm-sim-section"><h3>① 逐将粗筛：${result.coarse.length} 个将 × 候选${
    pairUnits ? `（其中 ${pairUnits} 个双槽将按**成对组合**评估——带满槽才见效的增伤战法不会被单挂成绩误杀）` : ''
  } × ${result.options.coarseRuns} 场（排序列 = 核心将「${esc(result.coreLabel)}」伤害）</h3>${blocks}</div>`;
}

/** ② 组合粗筛榜单：整队组合 + 3 场伤害，前十进决赛 */
function combosHtml(result: SimExpectResult): string {
  if (!result.combos.length) return '';
  const rows = result.combos
    .slice(0, 20)
    .map(
      (c) => `<tr class="${c.advanced ? 'rm-sim-kept' : ''}">
        <td class="rm-num rm-dim">${c.rank}</td>
        <td>${c.advanced ? '<span class="rm-strong">★ </span>' : ''}${esc(c.label)}${
          c.duplicateOf !== null ? `<span class="rm-dim">（与第 ${c.duplicateOf} 名同套战法）</span>` : ''
        }</td>
        <td class="rm-num rm-dim">${c.damages.map((d) => fmt(d)).join(' / ')}</td>
        <td class="rm-num rm-strong">${fmt(c.meanCore)}</td>
        <td class="rm-num rm-dim">${fmt(c.meanTotal)}</td>
        <td class="rm-num">${fmt(c.meanCoreFirst3)}</td>
        <td class="rm-dim">${c.advanced ? '进决赛' : c.duplicateOf !== null ? '同套战法（保留最好的排法）' : '止步粗筛'}</td>
      </tr>`
    )
    .join('');
  return `<div class="rm-sim-section">
    <h3>② 组合粗筛榜单：评估 ${result.combos.length} 个组合 × ${result.options.coarseRuns} 场（${result.distinctCombos} 套不同战法，前 ${result.options.coarseTop} 套进决赛）</h3>
    <table class="rm-table">
      <thead><tr><th>名次</th><th>整队战法组合</th><th>逐场（核心将伤害）</th><th>核心将·整局</th><th>全队·整局</th><th>核心将·前三</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${result.combos.length > 20 ? `<div class="rm-note">只显示前 20 名，共评估 ${result.combos.length} 个组合（${result.distinctCombos} 套不同战法）。</div>` : ''}
    <div class="rm-note">进决赛按「不同战法套」取前 ${result.options.coarseTop}：换将 / 换槽的排列常打出完全一样的结果，
      同一套战法只保留成绩最好的一种排法（其余在表里标「与第 N 名同套战法」）。</div>
    ${
      result.combosCapped
        ? `<div class="rm-note rm-down">组合数达到「组合评估上限」，更靠后的组合没跑（按各槽位粗筛名次优先展开）；想覆盖更多请调大上限或每槽保留数。</div>`
        : ''
    }
  </div>`;
}

/** ③ 决赛排行：每套配置的伤害期望 */
function finalsHtml(result: SimExpectResult): string {
  if (!result.finals.length) {
    return `<div class="rm-sim-section"><h3>③ 决赛排行</h3><div class="rm-note">没有可用的决赛组合（候选全被队内已占用，或空槽位的保留名单拼不出合法组合）。</div></div>`;
  }
  const rows = result.finals
    .map(
      (f) => `<tr>
        <td class="rm-num rm-strong">${f.rank}</td>
        <td>${esc(f.label)}</td>
        <td class="rm-num">${f.runs}</td>
        <td class="rm-num rm-strong">${fmt(f.mean)}</td>
        <td class="rm-num rm-dim">±${fmt(f.halfWidth)}</td>
        <td class="rm-num rm-dim">${fmt(f.sd)}</td>
        <td class="rm-num rm-dim">${fmt(f.min)} ~ ${fmt(f.max)}</td>
        <td class="rm-num rm-dim">${fmt(f.meanTotal)}</td>
        <td class="rm-num">${fmt(f.meanFirst3)}</td>
        <td class="rm-num rm-dim">${f.coarseRank}</td>
        <td class="rm-num ${f.coarseBias >= 0 ? 'rm-up' : 'rm-down'}">${pct(f.coarseBias)}</td>
      </tr>`
    )
    .join('');
  const details = result.finals
    .map(
      (f) => `<details class="rm-sim-detail">
        <summary>#${f.rank} ${esc(f.label)} · 核心将 ${fmt(f.mean)}（每将 / 每战法拆解）</summary>
        <div class="rm-sim-detail-grid">
          <table class="rm-table">
            <thead><tr><th>武将</th><th>场均伤害</th></tr></thead>
            <tbody>${f.byUnit
              .map(
                (u) =>
                  `<tr><td>${u.core ? '<span class="rm-strong">★ </span>' : ''}${esc(u.name)}${
                    u.core ? '<span class="rm-dim">（核心位）</span>' : ''
                  }</td><td class="rm-num">${fmt(u.mean)}</td></tr>`
              )
              .join('')}</tbody>
          </table>
          <table class="rm-table">
            <thead><tr><th>战法</th><th>场均伤害</th></tr></thead>
            <tbody>${
              f.bySkill.length
                ? f.bySkill.map((s) => `<tr><td>${esc(s.name)}</td><td class="rm-num">${fmt(s.mean)}</td></tr>`).join('')
                : '<tr><td colspan="2" class="rm-dim">该配置没有战法伤害（全靠普攻）</td></tr>'
            }</tbody>
          </table>
        </div>
      </details>`
    )
    .join('');
  return `<div class="rm-sim-section">
    <h3>③ 决赛排行：${result.finals.length} 个组合 × ${result.options.finalRuns} 场（排序口径 = 核心将「${esc(
    result.coreLabel
  )}」伤害期望；全队总伤列仅供参考）</h3>
    <table class="rm-table">
      <thead><tr>
        <th>排行</th><th>整队战法组合</th><th>场次</th><th>核心将期望</th><th>95% 半宽</th><th>标准差</th>
        <th>单场区间</th><th>全队总伤</th><th>核心将·前三</th><th>粗筛名次</th><th>粗筛偏差</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${details}
  </div>`;
}

/** ④ 口径与提示：木桩不还手 / 截断告警 / 3 场噪声 / 排序一致率 / 旧解析对照 */
function notesHtml(result: SimExpectResult): string {
  const best = result.finals[0];
  if (!best) return '';
  const worstBias = result.finals.reduce((a, b) => (Math.abs(a.coarseBias) > Math.abs(b.coarseBias) ? a : b), result.finals[0]);
  const med = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
  };
  const cv = best.mean ? best.sd / best.mean : 0;
  const second = result.finals[1];
  const overlap = second ? Math.abs(best.mean - second.mean) < best.halfWidth + second.halfWidth : false;
  return `<div class="rm-sim-section rm-sim-verdict">
    <h3>④ 口径与提示</h3>
    <ul class="rm-sim-list">
      <li><b>靶子</b>：${esc(result.dummyLabel)}，<b>不还手</b>（不放战法、不普攻）——我方输出的 DoT / 延迟伤害照常结算；
        因此这里量到的是<b>纯伤害期望</b>，不含胜负判定（胜率看 L4）。</li>
      <li><b>木桩兵力截断</b>：${
        result.wipedCombos
          ? `<span class="rm-down">有 ${result.wipedCombos} 个组合出现木桩被打空（伤害被截断，期望偏低）→ 把「木桩兵力」调大再跑。</span>`
          : '没有组合把木桩打空，伤害没有被兵力截断。'
      }</li>
      <li><b>排序口径</b>：<b>核心将「${esc(result.coreLabel)}」的伤害期望</b>（可多选核心位 → 求和）；
        参与匹配的将 = ${esc(result.matchLabel)}，其余将的战法原样保留、不参与搜索。全队总伤只作参考列（不参与排名）。</li>
      <li><b>期望与单场波动</b>：榜首「${esc(best.label)}」${best.runs} 场核心将场均 <b>${fmt(best.mean)}</b>（±${fmt(
    best.halfWidth
  )}，95%），单场区间 ${fmt(best.min)} ~ ${fmt(best.max)}（标准差 ${fmt(best.sd)}，变异系数 ${(cv * 100).toFixed(1)}%）。</li>
      <li><b>3 场粗筛够不够</b>：同一组合「粗筛 ${result.options.coarseRuns} 场」与决赛 ${result.options.finalRuns} 场的偏差，最大的一条是「${esc(
    worstBias.label
  )}」${pct(worstBias.coarseBias)}；粗筛榜单排序与决赛排序成对一致率 <b>${(result.rankAgreement * 100).toFixed(
    0
  )}%</b> —— 3 场只能用来淘汰，别用它定名次。</li>
      <li><b>榜首是否显著更强</b>：${
        second
          ? `比第二名「${esc(second.label)}」${pct((best.mean - second.mean) / (second.mean || 1))}，两套的 95% 区间${
              overlap ? '<b>有重叠</b>（差距不够显著，建议加大决赛场次）' : '不重叠'
            }。`
          : '只有一个组合进决赛，无从比较。'
      }</li>
      <li><b>旧解析口径对照</b>：解析值相对模拟期望的中位偏差 整局 <b>${pct(
        med(result.finals.map((f) => f.deltaTotal))
      )}</b>、前三回合 <b>${pct(
        med(result.finals.map((f) => f.deltaFirst3))
      )}</b>（正 = 模拟更高）。解析模型按抽象目标模板算、不含控制 / 规避 / 兵力截断——两条口径不一样，仅作历史对照。</li>
    </ul>
  </div>`;
}

/** 结果整体：概览 + 逐槽粗筛 + 组合榜单 + 决赛排行 + 口径提示 */
export function simResultHtml(result: SimExpectResult): string {
  const head = `<div class="rm-sim-sum">
    <span>参与匹配 <b>${esc(result.matchLabel)}</b></span>
    <span>排序口径 <b>核心将·${esc(result.coreLabel)}</b></span>
    <span>空槽位 <b>${result.slots.length}</b> 个</span>
    <span>候选战法 <b>${result.candidateCount}</b> 个${result.candidateSkipped ? `<span class="rm-dim">（排除已占用 ${result.candidateSkipped}）</span>` : ''}</span>
    <span>评估组合 <b>${result.combos.length}</b> 个<span class="rm-dim">（${result.distinctCombos} 套不同战法）</span></span>
    <span>进决赛 <b>${result.finals.length}</b> 个</span>
    <span>真跑 <b>${result.battles}</b> 场</span>
    <span>耗时 <b>${(result.ms / 1000).toFixed(1)}</b> s</span>
    ${result.noEmptySlot ? '<span class="rm-dim">（无空槽：直接测评当前配置）</span>' : ''}
  </div>`;
  return head + slotHtml(result) + combosHtml(result) + finalsHtml(result) + notesHtml(result);
}

/** 单条结果的摘要行（脚本 / 文档复用同一套文案口径） */
export function finalSummaryLine(f: FinalRow, coarseRuns: number): string {
  return `#${f.rank} ${f.label}：场均 ${fmt(f.mean)} ±${fmt(f.halfWidth)}（${f.runs} 场；粗筛 ${coarseRuns} 场均值 ${fmt(
    f.coarseMean
  )}，偏差 ${pct(f.coarseBias)}；解析 ${fmt(f.analyticTotal)}，偏差 ${pct(f.deltaTotal)}）`;
}
