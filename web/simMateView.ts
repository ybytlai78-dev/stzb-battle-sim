/**
 * L3 优化武将（队友）· 模拟测评的视图层（参数条 + 名单 + 排行 + 口径提示），与页面挂载解耦：
 * 纯函数出 HTML（好测），`web/optimizeView.ts` 只负责事件绑定 / 进度 / 异步跑批 / 应用队友。
 * 口径见 `web/simMate.ts` 头部（把队友位当空槽；勾 2 个位 = 成对评估；靶子与排序口径与 L2 完全一致）。
 */
import { fmt } from './roundChart';
import { FINAL_RUNS_MIN } from './simExpectation';
import type { MateProgress, MateSimResult } from './simMate';
import { heroMainSkillName } from './simMate';

const esc = (s: string): string => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] ?? m));
const pct = (v: number, digits = 1): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

export interface MateControlsInit {
  coarseRuns: number;
  finalRuns: number;
  unitKeep: number;
  pairCarriers: number;
  coarseTop: number;
  maxCombos: number;
  rankBy: 'total' | 'first3';
  dummyTroops: number;
  seed: number;
  swapSides: boolean;
  includeOffline: boolean;
  /** 候选进场带不带该位已配战法（`keep` 缺省 / `clear` 白板） */
  slotSkills: 'keep' | 'clear';
  /** 匹配位现在已配的战法名（每组一个；用来提示「白板进场」与显示本次基准） */
  baseSkills: string[][];
  /** 有 L2 结果时给一个「把 L2 榜首那套战法填进左栏」的按钮（两步衔接的反向入口） */
  l2BestLabel?: string;
  /** 候选池规模（上架 / 含下架），写进提示文案 */
  poolSizes: { listed: number; all: number };
  /** 三个位：名字 + 站位 + 是否核心 + 可否参与匹配（非核心位） */
  units: Array<{ unit: number; name: string; position: string; isCore: boolean; canMatch: boolean }>;
  /** 参与匹配的队友位（勾选状态） */
  matchUnits: number[];
  /** 排序口径的核心位（勾选状态；空 = 自动识别） */
  coreUnitIdx: number[];
  autoCoreName: string;
  /** 预计真跑场次（页面用 `estimateMateBattles` 算好传进来） */
  estimate?: number;
}

/** 参数区：粗筛 3 场 / 决赛 ≥20 场 / 进决赛支数 / 队友位与核心位勾选都是可配置参数 */
export function mateControlsHtml(init: MateControlsInit): string {
  const keepOptions = [10, 20, 32, 50]
    .map((v) => `<option value="${v}" ${v === init.unitKeep ? 'selected' : ''}>${v} 个</option>`)
    .join('');
  const pairOptions = [3, 5, 10, 15, 20]
    .map((v) => `<option value="${v}" ${v === init.pairCarriers ? 'selected' : ''}>${v} 个</option>`)
    .join('');
  const topOptions = [8, 16, 32, 50]
    .map((v) => `<option value="${v}" ${v === init.coarseTop ? 'selected' : ''}>${v} 支</option>`)
    .join('');
  const coreSet = new Set(init.coreUnitIdx);
  const matched = init.matchUnits;
  const pairMode = matched.length >= 2;
  return `
    <div class="rm-simbar">
      <label>粗筛场次<input id="mt-coarse" type="number" min="1" max="20" step="1" value="${init.coarseRuns}" /></label>
      <label>决赛场次<input id="mt-final" type="number" min="${FINAL_RUNS_MIN}" max="1000" step="10" value="${init.finalRuns}" /></label>
      <label>每组保留<select id="mt-keep">${keepOptions}</select></label>
      <label>配对基准<select id="mt-paircars">${pairOptions}</select></label>
      <label>进决赛组合<select id="mt-top">${topOptions}</select></label>
      <label>组合评估上限<input id="mt-maxcombo" type="number" min="1" max="5000" step="50" value="${init.maxCombos}" /></label>
      <label>时间窗<select id="mt-rank">
        <option value="total" ${init.rankBy === 'total' ? 'selected' : ''}>整局</option>
        <option value="first3" ${init.rankBy === 'first3' ? 'selected' : ''}>前三回合</option>
      </select></label>
      <label>木桩兵力<input id="mt-troops" type="number" min="500" max="999999" step="10000" value="${init.dummyTroops}" /></label>
      <label>种子<input id="mt-seed" type="number" min="1" step="1" value="${init.seed}" /></label>
      <label>候选武将池<select id="mt-pool">
        <option value="listed" ${init.includeOffline ? '' : 'selected'}>上架武将（${init.poolSizes.listed}）</option>
        <option value="all" ${init.includeOffline ? 'selected' : ''}>上架 + 下架（${init.poolSizes.all}）</option>
      </select></label>
      <label>候选带入战法<select id="mt-slotskills">
        <option value="keep" ${init.slotSkills === 'keep' ? 'selected' : ''}>保留该位已配战法</option>
        <option value="clear" ${init.slotSkills === 'clear' ? 'selected' : ''}>清空（白板进场）</option>
      </select></label>
      <label class="rm-sim-check"><input id="mt-swap" type="checkbox" ${init.swapSides ? 'checked' : ''} /> 交换场地</label>
      ${
        init.l2BestLabel
          ? `<button class="rm-btn rm-btn-ghost" type="button" id="mt-usel2" title="把 L2 跑出来的榜首战法填进左栏：候选就带着这套战法被评估">⇦ 填入 L2 榜首战法</button>`
          : ''
      }
      <button class="rm-btn rm-sim-run" type="button" id="mt-run">开始匹配队友</button>
    </div>
    <div class="rm-simscope">
      <div class="rm-simscope-col">
        <div class="rm-group-title">参与匹配的队友位（把队友当那个空槽；最多勾 2 个 → 成对评估）</div>
        ${init.units
          .map(
            (u) =>
              `<label class="rm-simscope-item"><input type="checkbox" data-mt-match="${u.unit}" ${
                matched.includes(u.unit) ? 'checked' : ''
              } ${u.canMatch ? '' : 'disabled'} /> ${esc(u.position)}·${esc(u.name)}<span class="rm-dim">${
                u.canMatch ? '' : u.isCore ? '（核心位：固定不动）' : '（已有 2 个队友位在匹配）'
              }</span></label>`
          )
          .join('')}
      </div>
      <div class="rm-simscope-col">
        <div class="rm-group-title">核心位（勾中 ⇒ 该将伤害计入排序目标；不勾 = 自动识别「${esc(init.autoCoreName)}」）</div>
        ${init.units
          .map(
            (u) =>
              `<label class="rm-simscope-item"><input type="checkbox" data-mt-core="${u.unit}" ${
                coreSet.has(u.unit) ? 'checked' : ''
              } /> ${esc(u.position)}·${esc(u.name)}</label>`
          )
          .join('')}
      </div>
    </div>
    <div class="rm-note">
      靶子 = <b>不还手的木桩 ×3</b>（不放战法、不普攻）——与 L2 同一个靶子，所以两层的数字可以直接比。<br />
      <b>L3 搜的是武将、不搜战法</b>：候选武将按「等级沿用该位、加点清零、兵种取本体、不带宝物 / 特性」进场；
      战法看上面的「<b>候选带入战法</b>」——<b>保留</b>（缺省）= 候选**带着该位现在配的那套战法**被评估
      （先把两个队友位配好战法、或先在 L2 跑一轮让它填，再回来跑 L3：这样「靠战法吃饭的辅助」才不会被低估）；
      <b>清空</b> = 候选白板进场，只反映主战法与白板属性（战法留给 L2 那一步配）。未勾选的将（核心等）原样保留。
      候选池 = 上架池 − 队内已上阵 −
      <b>与固定将互斥的</b>（引擎配队规则：赵云 ↔ SP赵云、姜维 ↔ SP姜维 不可同队）。<br />
      ${
        init.slotSkills === 'keep' && init.baseSkills.every((s) => s.length === 0)
          ? `<span class="rm-down"><b>注意：两个队友位现在是空的 ⇒ 等于白板进场</b>，靠战法放大的辅助（曹纯 / 张辽 这类）会被低估 ——
             先给这两个位配好战法（或先在 L2 跑一轮，把榜首那套「应用」到左栏），再回来匹配队友。</span><br />`
          : ''
      }
      流程 = ${
        pairMode
          ? `① <b>成对评估</b>（勾了 2 个队友位）：先跑一圈单挂拿「搭子基准」（每个位前 ${init.pairCarriers} 名），
      再用基准 × 全部候选两两配对，两个位各作一次基准方向（谁站大营 / 谁站前锋都会跑到）→ 每组保留前 ${init.unitKeep} 个选项 →`
          : `① 单槽粗筛（每个候选武将在该位 ${init.coarseRuns} 场）→ 保留前 ${init.unitKeep} 个 →`
      }
      ② 组合粗筛<b>榜单</b>（每个组合 ${init.coarseRuns} 场，按「不同武将套」去重）→ ③ 前 <b>${init.coarseTop}</b> 套进决赛，
      每套 <b>${init.finalRuns}</b> 场汇总伤害期望排行。选中一行点「应用」= 把武将写进左栏对应的位（该位战法槽清空）。<br />
      排序口径 = <b>核心将的伤害期望</b>（同 L2；全队总伤只作参考列）。
      <span id="mt-est">预计真跑 <b>${init.estimate ?? 0}</b> 场</span>
    </div>`;
}

/** 进度条文案 */
export function mateProgressHtml(p: MateProgress): string {
  const phase = p.phase === 'slot' ? '队友位粗筛' : p.phase === 'combo' ? '组合粗筛' : '决赛';
  const w = p.phaseTotal ? Math.min(100, (p.phaseDone / p.phaseTotal) * 100) : 0;
  return `<div class="rm-sim-live"><i style="width:${w.toFixed(1)}%"></i></div>
    <div class="rm-dim rm-sim-status">${phase} ${p.phaseDone} / ${p.phaseTotal} 场 · 累计 ${p.battle} 场 · ${esc(p.label)}</div>`;
}

/** ① 队友位粗筛：勾 1 个位 = 候选武将榜；勾 2 个位 = 有序武将对榜（成对评估） */
function groupHtml(result: MateSimResult): string {
  if (!result.groups.length) return '';
  const blocks = result.groups
    .map((g) => {
      const rows = g.rows
        .slice(0, 12)
        .map(
          (r) => `<tr class="${r.kept ? 'rm-sim-kept' : ''}">
            <td class="rm-num rm-dim">${r.rank}</td>
            <td>${r.kept ? '<span class="rm-strong">★ </span>' : ''}${esc(r.label)}${
              r.from === 'pair' ? '' : '<span class="rm-dim">（单挂）</span>'
            }</td>
            <td class="rm-dim">${r.picks.map((p) => esc(heroMainSkillName(p.heroId))).join(' + ')}</td>
            <td class="rm-num rm-dim">${r.damages.map((d) => fmt(d)).join(' / ')}</td>
            <td class="rm-num rm-strong">${fmt(r.meanCore)}</td>
            <td class="rm-num rm-dim">${fmt(r.meanTotal)}</td>
            <td class="rm-num">${fmt(r.meanCoreFirst3)}</td>
            <td class="rm-dim">${r.kept ? '进组合' : '淘汰'}</td>
          </tr>`
        )
        .join('');
      const heads = g.positions.join(' / ');
      return `<div class="rm-sim-slot">
        <div class="rm-sim-slot-head">粗筛 · ${esc(g.unitNames.join(' / '))}（${esc(heads)}）${
        g.mode === 'pair' ? '：双位·成对评估（有序对）' : '：单位粗筛'
      }
          <span class="rm-dim">${g.rows.length} 个${g.mode === 'pair' ? '组合' : '候选'} × ${result.options.coarseRuns} 场 · 保留 ${
        g.keptKeys.length
      } 个</span>
        </div>
        <table class="rm-table">
          <thead><tr><th>名次</th><th>${g.mode === 'pair' ? '武将组合（两个位一起）' : '候选武将'}</th><th>主战法</th><th>逐场（核心将伤害）</th><th>核心将·整局</th><th>全队·整局</th><th>核心将·前三</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${g.rows.length > 12 ? `<div class="rm-note">只显示前 12 名，其余 ${g.rows.length - 12} 个已淘汰。</div>` : ''}
      </div>`;
    })
    .join('');
  return `<div class="rm-sim-section"><h3>① 队友位粗筛：${
    result.groups[0]?.mode === 'pair'
      ? `两个队友位按**成对组合**评估（先跑单挂拿搭子基准，再用基准 × 全部候选配对；带满搭档才见效的武将不会被单挂成绩误杀）`
      : `单槽粗筛（每个候选武将在该位真跑 ${result.options.coarseRuns} 场）`
  } × ${result.options.coarseRuns} 场（排序列 = 核心将「${esc(result.coreLabel)}」伤害${
    result.slotSkills === 'keep' && result.baseSkillNames.some((s) => s.length)
      ? `；候选带着该位已配战法进场：${result.baseSkillNames
          .map((s, i) => `${esc(result.groups[0]?.unitNames[i] ?? '')}${s.length ? `·${s.map(esc).join('+')}` : '·空'}`)
          .join(' ｜ ')}`
      : '；候选白板进场（只算主战法）'
  }）</h3>${blocks}</div>`;
}

/** ② 组合粗筛榜单：整队武将组合 + 3 场伤害，前 N 套进决赛 */
function combosHtml(result: MateSimResult): string {
  if (!result.combos.length) return '';
  const rows = result.combos
    .slice(0, 20)
    .map(
      (c) => `<tr class="${c.advanced ? 'rm-sim-kept' : ''}">
        <td class="rm-num rm-dim">${c.rank}</td>
        <td>${c.advanced ? '<span class="rm-strong">★ </span>' : ''}${esc(c.label)}${
          c.duplicateOf !== null ? `<span class="rm-dim">（与第 ${c.duplicateOf} 名同套武将，换了个站位）</span>` : ''
        }</td>
        <td class="rm-num rm-dim">${c.damages.map((d) => fmt(d)).join(' / ')}</td>
        <td class="rm-num rm-strong">${fmt(c.meanCore)}</td>
        <td class="rm-num rm-dim">${fmt(c.meanTotal)}</td>
        <td class="rm-num">${fmt(c.meanCoreFirst3)}</td>
        <td class="rm-dim">${c.advanced ? '进决赛' : c.duplicateOf !== null ? '同套武将（保留最好的站位）' : '止步粗筛'}</td>
      </tr>`
    )
    .join('');
  return `<div class="rm-sim-section">
    <h3>② 组合粗筛榜单：评估 ${result.combos.length} 个组合 × ${result.options.coarseRuns} 场（${result.distinctCombos} 套不同武将，前 ${result.options.coarseTop} 套进决赛）</h3>
    <table class="rm-table">
      <thead><tr><th>名次</th><th>队友组合</th><th>逐场（核心将伤害）</th><th>核心将·整局</th><th>全队·整局</th><th>核心将·前三</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${result.combos.length > 20 ? `<div class="rm-note">只显示前 20 名，共评估 ${result.combos.length} 个组合（${result.distinctCombos} 套不同武将）。</div>` : ''}
    <div class="rm-note">进决赛按「不同武将套」取前 ${result.options.coarseTop}：同两位武将换个站位（谁站大营 / 前锋）算同一套，
      只保留成绩最好的一种排法（其余在表里标「与第 N 名同套武将」）。</div>
    ${
      result.combosCapped
        ? `<div class="rm-note rm-down">组合数达到「组合评估上限」，更靠后的组合没跑；想覆盖更多请调大上限或每组保留数。</div>`
        : ''
    }
  </div>`;
}

/** ③ 决赛排行：每套队友配置的伤害期望 + 「应用」 */
function finalsHtml(result: MateSimResult): string {
  if (!result.finals.length) {
    return `<div class="rm-sim-section"><h3>③ 决赛排行</h3><div class="rm-note">没有可用的决赛组合（候选池为空，或保留名单拼不出合法组合）。</div></div>`;
  }
  const base = result.baseline.mean;
  const rows = result.finals
    .map((f) => {
      const delta = base ? (f.mean - base) / base : 0;
      return `<tr>
        <td class="rm-num rm-strong">${f.rank}</td>
        <td>${esc(f.label)}</td>
        <td class="rm-num">${f.runs}</td>
        <td class="rm-num rm-strong">${fmt(f.mean)}</td>
        <td class="rm-num rm-dim">±${fmt(f.halfWidth)}</td>
        <td class="rm-num rm-dim">${fmt(f.sd)}</td>
        <td class="rm-num rm-dim">${fmt(f.min)} ~ ${fmt(f.max)}</td>
        <td class="rm-num rm-dim">${fmt(f.meanTotal)}</td>
        <td class="rm-num">${fmt(f.meanFirst3)}</td>
        <td class="rm-num ${delta >= 0 ? 'rm-up' : 'rm-down'}">${pct(delta)}</td>
        <td><button class="rm-btn rm-btn-ghost" type="button" data-mate-apply="${f.rank - 1}">应用</button></td>
      </tr>`;
    })
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
    <h3>③ 决赛排行：${result.finals.length} 套队友 × ${result.options.finalRuns} 场（排序口径 = 核心将「${esc(
    result.coreLabel
  )}」伤害期望；全队总伤列仅供参考）</h3>
    <table class="rm-table">
      <thead><tr>
        <th>排行</th><th>队友组合</th><th>场次</th><th>核心将期望</th><th>95% 半宽</th><th>标准差</th>
        <th>单场区间</th><th>全队总伤</th><th>核心将·前三</th><th>相对当前</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${details}
    <div class="rm-note">点「应用」= 把该行的武将写进左栏对应的队友位（<b>该位战法槽清空</b>，接着去 L2 配全队战法）。</div>
  </div>`;
}

/**
 * 「配队规则」相关的三条提示（互斥剔除 / 当前配置违规 / 真跑异常）——
 * **单独抽出**：没有决赛结果时（例如整队都违反互斥）整个 ④ 段不能消失，否则最该看到提示的时候反而空白。
 */
function guardNotesHtml(result: MateSimResult): string {
  return `<li><b>同队互斥已剔掉</b>：引擎规定同「互斥组」的武将不可同队（现只有
        <b>赵云 ↔ SP赵云</b>、<b>姜维 ↔ SP姜维</b>；其余同名武将如关羽蜀/魏可同队）。候选池里与「不参与匹配的将」
        互斥的武将已剔除${result.poolSkippedMutual ? `（本次 ${result.poolSkippedMutual} 个）` : ''}；成对 / 组合里撞组的也会被跳过${
    result.skippedIllegal ? `（本次跳过 ${result.skippedIllegal} 项）` : ''
  } —— 不会让跑批中途抛「配队非法」。</li>${
    result.baselineIllegal
      ? `<li><span class="rm-down"><b>当前配置本身违反互斥规则</b>（如同时上了赵云与 SP赵云）→ 对照基线没跑；
              请先在左栏把冲突的将改掉，再重新匹配。</span></li>`
      : ''
  }${
    result.errors.length
      ? `<li><span class="rm-down"><b>真跑里出现过异常</b>：${result.errors.map(esc).join('；')} —— 已跳过出错的项，但建议把这条报给我。</span></li>`
      : ''
  }`;
}

/** ④ 口径与提示：木桩不还手 / 截断告警 / 3 场噪声 / 榜首显著性 / 对照基线 */
function notesHtml(result: MateSimResult): string {
  const guards = guardNotesHtml(result);
  const best = result.finals[0];
  if (!best) {
    return `<div class="rm-sim-section rm-sim-verdict">
    <h3>④ 口径与提示</h3>
    <ul class="rm-sim-list">
      <li><span class="rm-down">没有评估出任何合法组合</span>（候选池为空、候选全部与队内互斥、或当前配置本身就违规）。</li>
      ${guards}
    </ul>
  </div>`;
  }
  const worstBias = result.finals.reduce((a, b) => (Math.abs(a.coarseBias) > Math.abs(b.coarseBias) ? a : b), result.finals[0]);
  const cv = best.mean ? best.sd / best.mean : 0;
  const second = result.finals[1];
  const overlap = second ? Math.abs(best.mean - second.mean) < best.halfWidth + second.halfWidth : false;
  const base = result.baseline;
  const baseDelta = base.mean ? (best.mean - base.mean) / base.mean : 0;
  return `<div class="rm-sim-section rm-sim-verdict">
    <h3>④ 口径与提示</h3>
    <ul class="rm-sim-list">
      <li><b>这一层搜的是武将</b>：参与匹配的队友位 = <b>${esc(result.matchLabel)}</b>，
        其余将（核心等）原样保留、一位都不动；<b>匹配位的战法槽在试跑前已清空</b>（战法由 L2 那一步配）。</li>
      <li><b>候选进场带什么战法</b>：${
        result.slotSkills === 'keep'
          ? `本次 = <b>保留该位已配战法</b>，候选是<b>带着这套</b>被评估的：${result.baseSkillNames
              .map((s, i) => `${esc(result.groups[0]?.unitNames[i] ?? `位${i + 1}`)}·${s.length ? s.map(esc).join('+') : '<b>空</b>'}`)
              .join(' ｜ ')}。${
              result.baseSkillNames.every((s) => s.length === 0)
                ? '<span class="rm-down">两位都空着 ⇒ 等于白板进场：只算主战法 + 白板属性，靠战法放大的辅助（曹纯 / 张辽 这类）会被低估。先去 L2 跑一轮、用「填入 L2 榜首战法」，或手动给这两个位配好战法，再回来匹配。</span>'
                : '（想换基准就改左栏这两格的战法，或换「清空（白板进场）」口径重跑。）'
            }`
          : '本次 = <b>清空（白板进场）</b>：候选只带主战法与白板属性，战法留给 L2 那一步配 —— 这个口径会低估「靠战法吃饭」的辅助。'
      }</li>
      <li><b>靶子</b>：${esc(result.dummyLabel)}，<b>不还手</b>（不放战法、不普攻）——与 L2 同一个靶子，
        所以 L3 选完队友切 L2 时数字可以直接比；代价是<b>防御 / 控制型队友的价值量不出来</b>（这是「伤害期望」口径的边界，
        胜率与防御体系看 L4）。</li>
      <li><b>排序口径</b>：<b>核心将「${esc(result.coreLabel)}」的伤害期望</b>（可多选核心位 → 求和）；全队总伤只作参考列（不参与排名）。</li>
      <li><b>对照基线</b>：当前队友（匹配位战法槽已清空 = L3 交给 L2 的起始状态）${base.runs} 场核心将场均
        <b>${fmt(base.mean)}</b>；榜首比它 <b class="${baseDelta >= 0 ? 'rm-up' : 'rm-down'}">${pct(baseDelta)}</b>。</li>
      <li><b>木桩兵力截断</b>：${
        result.wipedCombos
          ? `<span class="rm-down">有 ${result.wipedCombos} 个组合出现木桩被打空（伤害被截断，期望偏低）→ 把「木桩兵力」调大再跑。</span>`
          : '没有组合把木桩打空，伤害没有被兵力截断。'
      }</li>
      <li><b>期望与单场波动</b>：榜首 ${best.runs} 场核心将场均 <b>${fmt(best.mean)}</b>（±${fmt(
    best.halfWidth
  )}，95%），单场区间 ${fmt(best.min)} ~ ${fmt(best.max)}（标准差 ${fmt(best.sd)}，变异系数 ${(cv * 100).toFixed(1)}%）。</li>
      <li><b>3 场粗筛够不够</b>：同组合「粗筛 ${result.options.coarseRuns} 场」与决赛 ${result.options.finalRuns} 场的偏差，
        最大的一条是「${esc(worstBias.label)}」${pct(worstBias.coarseBias)}；粗筛榜单排序与决赛排序成对一致率 <b>${(
    result.rankAgreement * 100
  ).toFixed(0)}%</b> —— 3 场只能用来淘汰，别用它定名次。</li>
      <li><b>榜首是否显著更强</b>：${
        second
          ? `比第二名「${esc(second.label)}」${pct((best.mean - second.mean) / (second.mean || 1))}，两套的 95% 区间${
              overlap ? '<b>有重叠</b>（差距不够显著，建议加大决赛场次）' : '不重叠'
            }。`
          : '只有一套进决赛，无从比较。'
      }</li>
      <li><b>成对评估覆盖度</b>：${
        result.groups[0]?.mode === 'pair'
          ? `勾了 2 个队友位 → 每个位取单挂前 ${result.options.pairCarriers} 名当「搭子基准」，与全部 ${result.candidateCount} 个候选配对
             （两个位各作一次基准方向），另留最多 3 个单挂选项；没进基准名单的组合不会被评到 ——
             想看更全就把「配对基准」调大（场次成正比）。`
          : '这次只勾了 1 个队友位（单槽粗筛）；勾 2 个位会切成成对评估。'
      }</li>
      ${guards}
    </ul>
  </div>`;
}

/** 结果整体：概览 + 队友位粗筛 + 组合榜单 + 决赛排行 + 口径提示 */
export function mateResultHtml(result: MateSimResult): string {
  const head = `<div class="rm-sim-sum">
    <span>参与匹配 <b>${esc(result.matchLabel || '（无队友位）')}</b></span>
    <span>排序口径 <b>核心将·${esc(result.coreLabel)}</b></span>
    <span>候选武将 <b>${result.candidateCount}</b> 个<span class="rm-dim">（${esc(result.poolLabel)}，排除队内已上阵 ${result.candidateSkipped}${
      result.poolSkippedMutual ? `，互斥剔除 ${result.poolSkippedMutual}` : ''
    }）</span></span>
    <span>${
      result.groups[0]?.mode === 'pair' ? '成对评估' : '单槽粗筛'
    } <b>${result.groups[0]?.rows.length ?? 0}</b> 个选项</span>
    <span>评估组合 <b>${result.combos.length}</b> 个<span class="rm-dim">（${result.distinctCombos} 套不同武将）</span></span>
    <span>进决赛 <b>${result.finals.length}</b> 套</span>
    <span>真跑 <b>${result.battles}</b> 场</span>
    <span>耗时 <b>${(result.ms / 1000).toFixed(1)}</b> s</span>
    ${result.noMatchSlot ? '<span class="rm-dim">（没有可匹配的队友位：直接测评当前配置）</span>' : ''}
  </div>`;
  return head + groupHtml(result) + combosHtml(result) + finalsHtml(result) + notesHtml(result);
}
