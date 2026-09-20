/**
 * 伤害测试实验室（并入主站版 v2，按用户反馈重构）
 *  - 布局：三栏分割（左：我方测试队伍配置，不分红蓝，竖排上中下画像卡 ｜ 中：可滚动武将池 ｜ 右：侍卫靶子面板）
 *  - 交互：底部「模拟一次/十次」→ 进入独立「伤害分析」页（与实验室分离），可返回继续调整
 *  - 分析页：伤害分析（每将场均伤害 + SVG 饼图占比 + 数学统计）/ 简略战报（我方在左、侍卫在右，带画像）/ 统计 / 战报详情
 *  - 兵种相克（引擎）：骑克步、步克弓、弓克骑；被克制方攻击克制方时伤害 -30%
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, BattleReport, General, TroopType } from '../src/engine/types';
import { buildGeneral, getHeroById, SKILL_GRADES, avatarSrc, isMainSkill, isLearnableSkillListed } from './heroes';
import {
  renderHeroPool,
  renderSlot,
  openTroopBonusPanel,
  type EditorHandlers,
  type EditorState,
} from './teamEditor';
import { createBattleView, type BattleViewOpts } from './battleView';
import { createBattleSummary, createStatsView, type SummaryOpts } from './battleSummary';
import { SKILL_REGISTRY } from '../src/data/skills';

const MAX_ROUNDS = 8;

// ─── 侍卫默认画像 ───
// 联网未检索到官方「五星侍卫」面板；按亲卫 NPC 模板（防≥攻≥谋、低速、步、攻击距离 2）放大到五星面板
// 参考：https://shouyou.3dmgame.com/gl/22430.html（亲卫·群步 49/48/41/20）
//      https://m.ali213.net/gonglue/151023/180323.html（亲卫·吴步 40/54/49/21）
const GUARD_DEFAULT = {
  attack: 82,
  defense: 92,
  strategy: 78,
  speed: 58,
  troops: 9000,
  troopType: 'infantry' as TroopType,
};

export interface GuardConfig {
  attack: number;
  defense: number;
  strategy: number;
  speed: number;
  troops: number;
  troopType: TroopType;
  /** 3 个随机 D 级战法（锁定后多次模拟不重随，可手动刷新） */
  skillIds: string[];
}

let guard: GuardConfig = { ...GUARD_DEFAULT, skillIds: [] };
let myMorale = 120;

/** D 级可学习战法池（排除主战法与暂时下架） */
const D_SKILLS: string[] = Object.keys(SKILL_REGISTRY).filter(
  (id) => SKILL_GRADES[id] === 'D' && !isMainSkill(id) && isLearnableSkillListed(id)
);

function randomDSkills(count = 3): string[] {
  const pool = [...D_SKILLS];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

const RED_POSITIONS: General['position'][] = ['大营', '中军', '前锋'];
const TYPE_NAME: Record<string, string> = { cavalry: '骑兵', infantry: '步兵', archer: '弓兵' };
const SKILL_TYPE_NAME: Record<string, string> = { active: '主动', passive: '被动', command: '指挥', pursuit: '追击' };

function typeName(t: string): string {
  return SKILL_TYPE_NAME[t] ?? t;
}

// ─── 挂载状态 ───
let app: HTMLElement;
let state: EditorState;
let handlers: EditorHandlers;
let onExit: () => void;
let teamRoot: HTMLElement; // 左栏：我方队伍
let guardPanel: HTMLElement; // 右栏：侍卫
let labMain: HTMLElement; // 三栏主体
let controlBar: HTMLElement; // 底部操作栏
let analysisRoot: HTMLElement; // 分析页容器
let seedInfo: HTMLElement;
let poolRoot: HTMLElement; // 中栏：武将池

/** 构造侍卫队伍：三将四维/兵力/兵种相同，战法按类型分槽；攻击距离：骑/步 2、弓 3 */
export function buildGuardTeam(): General[] {
  return RED_POSITIONS.map((position, i) => {
    const g: General = {
      id: `guard-${i}`,
      name: '侍卫',
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: guard.troopType,
      position,
      attack: guard.attack,
      defense: guard.defense,
      strategy: guard.strategy,
      speed: guard.speed,
      attackRange: guard.troopType === 'archer' ? 3 : 2,
      maxTroops: guard.troops,
      mainSkillName: guard.skillIds[0] ? (SKILL_REGISTRY[guard.skillIds[0]]?.name ?? '') : '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 120,
    };
    for (const id of guard.skillIds) {
      const s = SKILL_REGISTRY[id];
      if (!s) continue;
      switch (s.type) {
        case 'active': g.activeSkillIds.push(id); break;
        case 'passive': g.passiveSkillIds.push(id); break;
        case 'command': g.commandSkillIds.push(id); break;
        case 'pursuit': g.pursuitSkillIds.push(id); break;
      }
    }
    return g;
  });
}

export function getGuard(): GuardConfig {
  return { ...guard, skillIds: [...guard.skillIds] };
}

export function setGuard(g: Partial<GuardConfig>): void {
  guard = { ...guard, ...g };
}

export function setMorale(m: number): void {
  myMorale = Math.max(80, Math.min(140, Math.round(m) || 120));
}

// ─── 左栏：我方队伍（槽位卡复用主站 renderSlot：左画像右信息；Drop-Zone 拖拽投放由 renderSlot 内建）───

/** 左栏面板：部队加成 + 清空 + 3 槽位（槽位=纯立绘，复用主站 renderSlot；
 *  「我方测试队伍」标题已删（用户 2026-09-19：纯立绘呈现，省一行高度）） */
function renderLabTeam(): void {
  teamRoot.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'lab-team-head';
  const bonus = document.createElement('button');
  bonus.className = 'btn ghost team-bonus';
  bonus.type = 'button';
  bonus.textContent = '部队加成';
  bonus.onclick = () => openTroopBonusPanel('我方', state.red);
  const clear = document.createElement('button');
  clear.className = 'btn ghost team-clear';
  clear.type = 'button';
  clear.textContent = '清空本队';
  clear.onclick = () => {
    handlers.onClearTeam('red');
    renderLabTeam();
  };
  head.append(bonus, clear);
  teamRoot.appendChild(head);

  const slots = document.createElement('div');
  slots.className = 'lab-slots';
  state.red.forEach((s, i) => slots.appendChild(renderSlot('red', i, s, RED_POSITIONS[i], wrappedHandlers())));
  teamRoot.appendChild(slots);
}

/** 包装 handlers：调用原 handler 后刷新实验室左栏与武将池（主站 refresh 由原 handler 自行处理） */
function wrappedHandlers(): EditorHandlers {
  const proxy: Record<string, unknown> = {};
  for (const k of Object.keys(handlers) as Array<keyof EditorHandlers>) {
    proxy[k] = (...args: unknown[]) => {
      (handlers[k] as (...a: unknown[]) => void)(...args);
      renderLabTeam();
      refreshPool();
    };
  }
  return proxy as unknown as EditorHandlers;
}

/** 主站顶栏的搜索框容器（#pool-search-slot）——实验室的池子也把 .toolbar 搬上去。
 *  不搬的话，搜索框 + 势力/兵种筛选行会留在中栏（用户 2026-09-19 反馈「实验室中栏多余部分」）。
 *  主站与实验室共用同一个容器，所以退出实验室时 main.ts 要 refresh() 让主站 toolbar 搬回来。 */
function heroSearchSlot(): HTMLElement | undefined {
  return app?.ownerDocument.getElementById('pool-search-slot') ?? undefined;
}

/** 重建武将池（已选标记 picked 随 state 刷新） */
function refreshPool(): void {
  if (!poolRoot || !poolRoot.parentElement) return;
  const next = renderHeroPool(state, wrappedHandlers(), heroSearchSlot());
  next.classList.add('lab-pool');
  poolRoot.parentElement.replaceChild(next, poolRoot);
  poolRoot = next;
}

// ─── 侍卫面板 ───

function bindGuardPanel(): void {
  const num = (id: string, apply: (v: number) => void) => {
    const el = guardPanel.querySelector<HTMLInputElement>(`#${id}`)!;
    el.addEventListener('change', () => {
      const v = Math.max(0, Math.floor(Number(el.value) || 0));
      el.value = String(v);
      apply(v);
    });
  };
  num('g-attack', (v) => (guard.attack = v));
  num('g-defense', (v) => (guard.defense = v));
  num('g-strategy', (v) => (guard.strategy = v));
  num('g-speed', (v) => (guard.speed = v));
  num('g-troops', (v) => (guard.troops = v));

  guardPanel.querySelectorAll<HTMLButtonElement>('.g-troops button').forEach((b) => {
    b.addEventListener('click', () => {
      guardPanel.querySelectorAll('.g-troops button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      guard.troopType = b.dataset.troop as TroopType;
    });
  });

}

/** 侍卫战法只在后台随机（C/D 级，见 guard.skillIds 初始化），前端不展示
 *  （用户 2026-09-19：不展示侍卫战法，省高度做到不下滑看全）。 */

// ─── 统计：普攻 / 主战法 / 携带战法一 / 携带战法二 ───

interface Share {
  attack: number;
  main: number;
  extra1: number;
  extra2: number;
}

/** 按事件流汇总某武将四类伤害（口径与引擎 stats 一致：damage 归属 creditToId ?? sourceId，DoT 归属施法者） */
function computeShare(events: BattleEvent[], heroId: string, mainSkillId: string, extraSkillIds: string[]): Share {
  const [e1, e2] = extraSkillIds;
  const s: Share = { attack: 0, main: 0, extra1: 0, extra2: 0 };
  const classify = (skillId: string, amount: number) => {
    if (skillId === mainSkillId) s.main += amount;
    else if (e1 && skillId === e1) s.extra1 += amount;
    else if (e2 && skillId === e2) s.extra2 += amount;
    else s.main += amount; // 兜底（正常不会发生）
  };
  for (const ev of events) {
    if (ev.type === 'attack_hit' && ev.sourceId === heroId) {
      s.attack += ev.damage;
    } else if (ev.type === 'damage' && ev.skillId && (ev.creditToId ?? ev.sourceId) === heroId) {
      classify(ev.skillId, ev.damage);
    } else if (ev.type === 'dot_tick' && ev.skillId && ev.casterId === heroId) {
      classify(ev.skillId, ev.damage);
    }
  }
  return s;
}

/** 某将单场造成的总伤害（普攻 + 战法 + DoT，口径与 computeShare 一致） */
function dealtDamage(report: BattleReport, heroId: string): number {
  let total = 0;
  for (const ev of report.events) {
    if (ev.type === 'attack_hit' && ev.sourceId === heroId) total += ev.damage;
    else if (ev.type === 'damage' && ev.skillId && (ev.creditToId ?? ev.sourceId) === heroId) total += ev.damage;
    else if (ev.type === 'dot_tick' && ev.skillId && ev.casterId === heroId) total += ev.damage;
  }
  return total;
}

/** 某将单场受到的伤害（普攻/战法/DoT/分兵溅射） */
function takenDamage(report: BattleReport, heroId: string): number {
  let total = 0;
  for (const ev of report.events) {
    if (ev.type === 'attack_hit' && ev.targetId === heroId) total += ev.damage;
    else if (ev.type === 'damage' && ev.targetId === heroId) total += ev.damage;
    else if (ev.type === 'dot_tick' && ev.targetId === heroId) total += ev.damage;
    else if (ev.type === 'split_damage' && ev.targetId === heroId) total += ev.damage;
  }
  return total;
}

/** 某将单场造成的治疗量（heal 归属施法者） */
function healedAmount(report: BattleReport, heroId: string): number {
  let total = 0;
  for (const ev of report.events) {
    if (ev.type === 'heal' && ev.sourceId === heroId) total += ev.amount;
  }
  return total;
}

/** 基础数学统计：总和/均值/最高/最低/标准差（总体）/变异系数/中位数 */
function mathStats(values: number[]): { sum: number; avg: number; max: number; min: number; std: number; cv: number; median: number } {
  const n = values.length;
  if (n === 0) return { sum: 0, avg: 0, max: 0, min: 0, std: 0, cv: 0, median: 0 };
  const sum = values.reduce((a, v) => a + v, 0);
  const avg = sum / n;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const variance = values.reduce((a, v) => a + (v - avg) ** 2, 0) / n; // 总体方差（n=1 → 0）
  const std = Math.sqrt(variance);
  const cv = avg > 0 ? std / avg : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { sum, avg, max, min, std, cv, median };
}

const SHARE_META: Array<{ key: keyof Share; label: string; color: string }> = [
  { key: 'attack', label: '普攻', color: '#c9a063' },
  { key: 'main', label: '主战法', color: '#e06c5a' },
  { key: 'extra1', label: '携带战法一', color: '#5a8fc9' },
  { key: 'extra2', label: '携带战法二', color: '#6bbf6b' },
];

/** 手写 SVG 饼图（零依赖） */
function pieSvg(parts: Array<{ value: number; color: string }>): string {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) {
    return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#2a2a30"/></svg>`;
  }
  let angle = -90;
  const arcs: string[] = [];
  for (const p of parts) {
    const sweep = (p.value / total) * 360;
    const a1 = (angle * Math.PI) / 180;
    const a2 = ((angle + sweep) * Math.PI) / 180;
    const x1 = 50 + 40 * Math.cos(a1);
    const y1 = 50 + 40 * Math.sin(a1);
    const x2 = 50 + 40 * Math.cos(a2);
    const y2 = 50 + 40 * Math.sin(a2);
    const large = sweep > 180 ? 1 : 0;
    arcs.push(`<path d="M50,50 L${x1.toFixed(2)},${y1.toFixed(2)} A40,40 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${p.color}"/>`);
    angle += sweep;
  }
  return `<svg viewBox="0 0 100 100">${arcs.join('')}</svg>`;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// ─── 模拟 ───

function collectMyTeam(): General[] {
  return state.red
    .map((s, i) =>
      s.heroId
        ? buildGeneral(s.heroId, s.extraSkillIds, s.freePoints, RED_POSITIONS[i], s.redness, s.level, myMorale, s.secondaryTroop, s.secondaryTraits)
        : null
    )
    .filter((g): g is General => g !== null);
}

export function runOne(seed: number): BattleReport {
  const my = collectMyTeam();
  if (my.length === 0) throw new Error('我方至少需要 1 名武将');
  return runBattle({ myTeam: my, enemyTeam: buildGuardTeam(), seed, maxRounds: MAX_ROUNDS });
}

let lastReports: BattleReport[] = [];

/** 模拟 count 场（每次新随机种子），进入伤害分析页 */
export function simulate(count: 1 | 10): void {
  const errBox = app.querySelector<HTMLElement>('.lab-err');
  if (errBox) errBox.textContent = '';
  if (guard.skillIds.length === 0) {
    // 侍卫战法只在后台随机（D/C 级），前端不展示
    guard.skillIds = randomDSkills(3);
  }
  try {
    const seeds: number[] = [];
    for (let i = 0; i < count; i++) seeds.push(Math.floor(Math.random() * 1000000));
    seedInfo.textContent = count === 1 ? String(seeds[0]) : `${seeds[0]} …（共 ${count} 个种子）`;
    lastReports = seeds.map((s) => runOne(s));
    showAnalysis();
  } catch (e) {
    if (errBox) errBox.textContent = `模拟失败：${(e as Error).message}`;
  }
}

// ─── 伤害分析页（与实验室分离）───

type AnalysisTab = 'analysis' | 'summary' | 'stats' | 'detail';

let analysisTab: AnalysisTab = 'analysis';
let analysisPick = 0; // 十次时战报选场（0-based）

function showAnalysis(): void {
  labMain.style.display = 'none';
  controlBar.style.display = 'none';
  analysisRoot.style.display = '';
  analysisTab = 'analysis';
  analysisPick = 0;
  renderAnalysis();
}

function backToLab(): void {
  analysisRoot.style.display = 'none';
  labMain.style.display = '';
  controlBar.style.display = '';
}

function renderAnalysis(): void {
  analysisRoot.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'la-head';
  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← 返回实验室';
  back.onclick = backToLab;
  head.appendChild(back);

  const tabs: Array<[AnalysisTab, string]> = [
    ['analysis', '伤害分析'],
    ['summary', '简略战报'],
    ['stats', '统计'],
    ['detail', '战报详情'],
  ];
  const tabBar = document.createElement('div');
  tabBar.className = 'la-tabs';
  for (const [t, label] of tabs) {
    const b = document.createElement('button');
    b.className = 'btn ghost' + (t === analysisTab ? ' on' : '');
    b.textContent = label;
    b.onclick = () => {
      analysisTab = t;
      renderAnalysis();
    };
    tabBar.appendChild(b);
  }
  head.appendChild(tabBar);
  // 十次：战报类 tab 提供选场
  if (lastReports.length > 1 && analysisTab !== 'analysis') {
    const sel = document.createElement('select');
    sel.innerHTML = lastReports
      .map((r, i) => `<option value="${i}"${i === analysisPick ? ' selected' : ''}>第 ${i + 1} 场（种子 ${r.seed}，${resultName(r.result)}）</option>`)
      .join('');
    sel.addEventListener('change', () => {
      analysisPick = Number(sel.value);
      renderAnalysis();
    });
    head.appendChild(sel);
  }
  analysisRoot.appendChild(head);

  const body = document.createElement('div');
  body.className = analysisTab === 'summary' ? 'la-body la-fill' : 'la-body';
  if (analysisTab === 'analysis') renderDamageAnalysis(body);
  else if (analysisTab === 'summary') {
    const r = lastReports[analysisPick] ?? lastReports[0];
    body.appendChild(createBattleSummary(r, summaryOpts()));
  } else if (analysisTab === 'stats') {
    const r = lastReports[analysisPick] ?? lastReports[0];
    body.appendChild(createStatsView(r));
  } else {
    const r = lastReports[analysisPick] ?? lastReports[0];
    body.appendChild(createBattleView(r, viewOpts()).el);
  }
  analysisRoot.appendChild(body);
}

function summaryOpts(): SummaryOpts {
  return { myLeft: true, myLabel: '我方', enemyLabel: '侍卫', resultLabels: { win: '我方胜利', loss: '侍卫胜利' } };
}

function viewOpts(): BattleViewOpts {
  return { myLabel: '我方', enemyLabel: '侍卫', resultWin: '我方胜利', resultLoss: '侍卫胜利' };
}

function resultName(r: BattleReport['result']): string {
  return r === 'win' ? '胜' : r === 'loss' ? '败' : '平';
}

/** 伤害分析：队伍统计 + 每将卡片（场均伤害 + 饼图 + 数学统计）+ 敌方侍卫折叠 */
function renderDamageAnalysis(container: HTMLElement): void {
  const reports = lastReports;
  const n = reports.length;

  // 队伍统计块（场次 / 胜场 / 负场 / 平局 / 胜率 / 平均回合）已按用户要求删除（2026-09-19）：
  // 这些数据在「简略战报」tab 里已有；伤害分析页腾出高度给「每将卡片一行三张」。

  // ── 每将卡片 ──
  const cards = document.createElement('div');
  cards.className = 'share-cards';
  const myTeam = reports[0].myTeam;
  for (const g of myTeam) {
    const hero = getHeroById(g.id);
    const mainId = hero?.mainSkillId ?? '';
    const extras = g.activeSkillIds.concat(g.passiveSkillIds, g.commandSkillIds, g.pursuitSkillIds).filter((id) => id !== mainId);
    const extraIds = extras.slice(0, 2);

    const perBattle: number[] = reports.map((r) => dealtDamage(r, g.id));
    const taken: number[] = reports.map((r) => takenDamage(r, g.id));
    const healed: number[] = reports.map((r) => healedAmount(r, g.id));
    const ms = mathStats(perBattle);
    const takenAvg = mathStats(taken).avg;
    const healedAvg = mathStats(healed).avg;

    const totalShare: Share = { attack: 0, main: 0, extra1: 0, extra2: 0 };
    for (const r of reports) {
      const sh = computeShare(r.events, g.id, mainId, extraIds);
      totalShare.attack += sh.attack;
      totalShare.main += sh.main;
      totalShare.extra1 += sh.extra1;
      totalShare.extra2 += sh.extra2;
    }
    const totalDmg = totalShare.attack + totalShare.main + totalShare.extra1 + totalShare.extra2;
    const parts = SHARE_META.map((m) => ({ label: m.label, color: m.color, value: totalShare[m.key] }));

    const card = document.createElement('div');
    card.className = 'share-card';
    card.innerHTML = `
      <div class="sc-head">
        <img class="sc-avatar" src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" />
        <span>${g.name}</span><span class="sc-pos">${g.position ?? '前锋'} · Lv${g.level ?? 40}</span>
        <span class="sc-main-skill">${mainId ? (SKILL_REGISTRY[mainId]?.name ?? '') : '无主战法'}</span>
      </div>
      <div class="sc-body">
        <div class="sc-pie">${pieSvg(parts)}</div>
        <div class="sc-legend">
          ${parts
            .map((p) => {
              const pct = totalDmg > 0 ? ((p.value / totalDmg) * 100).toFixed(1) : '0.0';
              return `<div class="lg-item"><span class="lg-dot" style="background:${p.color}"></span><span>${p.label}</span><span class="lg-pct">${pct}%</span></div>`;
            })
            .join('')}
        </div>
      </div>
      <div class="sc-foot"><span>场均伤害</span><span class="sc-total">${fmt(ms.avg)}</span></div>
      <table class="math-table">
        <tr><td>总伤害</td><td>${fmt(ms.sum)}</td><td>单场最高</td><td>${fmt(ms.max)}</td></tr>
        <tr><td>单场最低</td><td>${fmt(ms.min)}</td><td>标准差</td><td>${fmt(ms.std)}</td></tr>
        <tr><td>变异系数</td><td>${(ms.cv * 100).toFixed(1)}%</td><td>中位数</td><td>${fmt(ms.median)}</td></tr>
        <tr><td>场均承伤</td><td>${fmt(takenAvg)}</td><td>场均治疗</td><td>${fmt(healedAvg)}</td></tr>
      </table>
    `;
    cards.appendChild(card);
  }
  container.appendChild(cards);

  // ── 敌方（侍卫）统计：折叠展开 ──
  const gs = document.createElement('details');
  gs.className = 'guard-stats';
  const guardTeam = reports[0].enemyTeam;
  const guardRows = guardTeam
    .map((g) => {
      let d = 0;
      let t = 0;
      for (const r of reports) {
        d += dealtDamage(r, g.id);
        t += takenDamage(r, g.id);
      }
      return `<tr><td>${g.position} 侍卫</td><td>${fmt(d / n)}</td><td>${fmt(t / n)}</td></tr>`;
    })
    .join('');
  gs.innerHTML = `
    <summary>敌方侍卫（${typeName(guard.troopType)} ×3）场均 造成 / 受到 伤害</summary>
    <table><thead><tr><th>单位</th><th>场均造成</th><th>场均受到</th></tr></thead><tbody>${guardRows}</tbody></table>
  `;
  container.appendChild(gs);
}

// ─── 挂载 ───

export interface DamageLabOptions {
  state: EditorState;
  handlers: EditorHandlers;
  /** 返回配将（由主站提供：隐藏 lab、恢复配将区） */
  onExit: () => void;
}

/** 挂载伤害测试实验室到容器。重复调用会重建内部视图（保留侍卫配置与队伍引用）。 */
export function mountDamageLab(root: HTMLElement, opts: DamageLabOptions): void {
  state = opts.state;
  handlers = opts.handlers;
  onExit = opts.onExit;
  app = root;
  app.innerHTML = '';
  app.className = 'lab-shell';

  // 顶部标题行已删除（用户 2026-09-19：省掉一整行给主体腾高度）。
  // 返回入口改到主站顶栏：实验室态把「伤害测试」导航按钮换成「返回配将」（见 main.ts enterLab/exitLab）。

  // ── 三栏主体 ──
  labMain = document.createElement('div');
  labMain.className = 'lab-main';
  app.appendChild(labMain);

  // 左栏：我方队伍
  teamRoot = document.createElement('section');
  teamRoot.className = 'lab-team';
  labMain.appendChild(teamRoot);
  renderLabTeam();

  // 中栏：武将池（可滚动）；搜索/筛选 toolbar 搬到主站顶栏容器，中栏只留卡格
  poolRoot = renderHeroPool(state, wrappedHandlers(), heroSearchSlot());
  poolRoot.classList.add('lab-pool');
  labMain.appendChild(poolRoot);

  // 右栏：侍卫面板
  guardPanel = document.createElement('aside');
  guardPanel.id = 'guard-panel';
  guardPanel.className = 'lab-guard';
  labMain.appendChild(guardPanel);
  const troopOn = (t: TroopType) => (guard.troopType === t ? ' class="on"' : '');
  guardPanel.innerHTML = `
    <h2>木桩侍卫</h2>
    <div class="g-row"><label>兵种</label><div class="g-troops">
      <button type="button" data-troop="cavalry"${troopOn('cavalry')}>骑</button>
      <button type="button" data-troop="infantry"${troopOn('infantry')}>步</button>
      <button type="button" data-troop="archer"${troopOn('archer')}>弓</button>
    </div></div>
    <div class="g-grid">
      <div class="g-row"><label>攻击</label><input type="number" id="g-attack" value="${guard.attack}" min="0" /></div>
      <div class="g-row"><label>防御</label><input type="number" id="g-defense" value="${guard.defense}" min="0" /></div>
      <div class="g-row"><label>谋略</label><input type="number" id="g-strategy" value="${guard.strategy}" min="0" /></div>
      <div class="g-row"><label>速度</label><input type="number" id="g-speed" value="${guard.speed}" min="0" /></div>
    </div>
    <div class="g-row g-row-full"><label>兵力</label><input type="number" id="g-troops" value="${guard.troops}" min="0" step="100" /></div>
  `;
  bindGuardPanel();

  // ── 底部操作栏：种子 + 士气 + 模拟按钮（模拟后进入伤害分析页）──
  controlBar = document.createElement('footer');
  controlBar.className = 'control-bar lab-control';
  controlBar.innerHTML = `
    <label title="随机种子由系统自动生成，每次模拟都会更换">随机种子 <span class="fixed" id="lab-seed">自动</span></label>
    <label>我方士气 <input type="number" id="lab-morale" value="${myMorale}" min="80" max="140" title="影响战法发动率：120 → 系数 1.12" /></label>
    <span class="spacer"></span>
    <button id="sim-1" class="btn">模拟一次</button>
    <button id="sim-10" class="btn">模拟十次</button>
  `;
  app.appendChild(controlBar);
  seedInfo = controlBar.querySelector('#lab-seed')!;
  (controlBar.querySelector('#lab-morale') as HTMLInputElement).addEventListener('change', (e) => {
    myMorale = Math.max(80, Math.min(140, Math.round(Number((e.target as HTMLInputElement).value) || 120)));
    (e.target as HTMLInputElement).value = String(myMorale);
  });
  controlBar.querySelector('#sim-1')!.addEventListener('click', () => simulate(1));
  controlBar.querySelector('#sim-10')!.addEventListener('click', () => simulate(10));

  // 错误提示 + 分析页容器
  const errBox = document.createElement('div');
  errBox.className = 'err-msg lab-err';
  app.appendChild(errBox);
  analysisRoot = document.createElement('div');
  analysisRoot.className = 'lab-analysis';
  analysisRoot.style.display = 'none';
  app.appendChild(analysisRoot);
}
