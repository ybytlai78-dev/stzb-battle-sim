/**
 * 战报渲染：结果横幅 + 回合导航 + 每回合兵力条 + 事件流 + 统计表
 */
import type { BattleEvent, BattleReport, DamageModifierSource, DamageModifiers } from '../src/engine/types';
import { formatBonusText } from '../src/engine/troopBonus';
import { SKILL_REGISTRY } from '../src/data/skills';
import { avatarSrc } from './heroes';

/** 准备阶段三段标题：阵容 / 兵种 / 战法 */
const PHASE_LABEL: Record<'formation' | 'troop' | 'skill', string> = {
  formation: '阵容',
  troop: '兵种',
  skill: '战法',
};

const PHASE_NAME: Record<string, string> = {
  active_skill: '主动战法判定',
  normal_attack: '普通攻击',
  pursuit_skill: '追击战法判定',
  command_skill: '指挥战法',
  passive_skill: '被动战法',
};

export interface BattleView {
  el: HTMLElement;
  setRound(r: number): void;
  roundCount(): number;
}

/** 详细战报选项：双方标签与结果文案（默认红队/蓝队——保持主站行为；实验室传 我方/侍卫） */
export interface BattleViewOpts {
  myLabel?: string;
  enemyLabel?: string;
  /** 胜利/失败横幅文案（默认 红队胜利/蓝队胜利） */
  resultWin?: string;
  resultLoss?: string;
}

export function createBattleView(report: BattleReport, opts: BattleViewOpts = {}): BattleView {
  const myLabel = opts.myLabel ?? '红队（我方）';
  const enemyLabel = opts.enemyLabel ?? '蓝队（敌方）';
  const root = document.createElement('div');
  root.className = 'battle-view';

  // 单位 id → 名字
  const nameById = new Map<string, string>();
  for (const g of report.myTeam) nameById.set(g.id, g.name);
  for (const g of report.enemyTeam) nameById.set(g.id, g.name);
  const nm = (id: string) => nameById.get(id) ?? id;

  // 按回合分组事件
  const roundEvents: Array<Array<BattleEvent>> = [];
  let cur: BattleEvent[] = [];
  for (const ev of report.events) {
    if (ev.type === 'round_start') { cur = []; continue; }
    if (ev.type === 'round_end') { roundEvents.push(cur); continue; }
    cur.push(ev);
  }

  // 每回合结束时的兵力快照（myTroops/enemyTroops 按配置顺序）
  const roundEndTroops: Array<{ my: number[]; enemy: number[] }> = [];
  for (const ev of report.events) {
    if (ev.type === 'round_end') roundEndTroops.push({ my: ev.myTroops, enemy: ev.enemyTroops });
  }
  const initialMy = report.myTeam.map((g) => g.maxTroops);
  const initialEnemy = report.enemyTeam.map((g) => g.maxTroops);

  // 回合 r（0=初始）开始时的兵力
  const troopsAt = (r: number) =>
    r === 0
      ? { my: initialMy, enemy: initialEnemy }
      : roundEndTroops[r - 1] ?? { my: initialMy, enemy: initialEnemy };

  // ── 结果横幅 ──
  const banner = document.createElement('div');
  banner.className = `result-banner ${report.result}`;
  const resLabel = report.result === 'win' ? (opts.resultWin ?? '红队胜利') : report.result === 'loss' ? (opts.resultLoss ?? '蓝队胜利') : '平局';
  banner.innerHTML = `
    <span class="res">${resLabel}</span>
    <span>进行 ${report.rounds} 回合 · 种子 ${report.seed}</span>
    <span>${myLabel}剩余 ${report.finalMyTroops.reduce((a, b) => a + b, 0).toLocaleString()} ｜ ${enemyLabel}剩余 ${report.finalEnemyTroops.reduce((a, b) => a + b, 0).toLocaleString()}</span>
  `;
  root.appendChild(banner);

  // ── 回合导航 ──
  const nav = document.createElement('div');
  nav.className = 'round-nav';
  const btnPrev = document.createElement('button');
  btnPrev.className = 'rbtn'; btnPrev.textContent = '◀ 上一回合';
  const btnNext = document.createElement('button');
  btnNext.className = 'rbtn'; btnNext.textContent = '下一回合 ▶';
  const btnPlay = document.createElement('button');
  btnPlay.className = 'rbtn'; btnPlay.textContent = '▶ 自动播放';
  const label = document.createElement('span');
  label.className = 'rlabel';
  const tabs = document.createElement('div');
  tabs.className = 'rtabs';
  const tabBtns: HTMLButtonElement[] = [];
  for (let r = 0; r <= report.rounds; r++) {
    const t = document.createElement('button');
    t.className = 'rtab';
    t.textContent = r === 0 ? '始' : String(r);
    t.onclick = () => setRound(r);
    tabs.appendChild(t);
    tabBtns.push(t);
  }
  nav.append(btnPrev, label, btnNext, btnPlay, tabs);
  root.appendChild(nav);

  // ── 回合内容（兵力 + 事件流）──
  const body = document.createElement('div');
  root.appendChild(body);

  let current = 0;
  let timer: number | null = null;

  // ── 增减伤统计弹窗（单实例：点击「x%」在链接旁弹出）──
  let popup: HTMLElement | null = null;
  let popupOwner: HTMLElement | null = null;
  const closePopup = () => {
    if (popup) {
      const line = popup.parentElement;
      if (line) line.style.zIndex = '';
      popup.remove();
      popup = null;
      popupOwner = null;
    }
  };
  /**
   * 在百分比链接旁弹出增减伤明细。
   * 必须挂到 `.ev.dmg-mod`（链接所在行）并用 offsetLeft 定位：若挂到滚动容器
   * `.battle-view` 再按 getBoundingClientRect 差计算 top/left，滚动后坐标相对内容原点
   * 会偏到可视区外，被 overflow-y:auto 裁掉，表现为「点了数字却弹不出」。
   */
  const togglePopup = (link: HTMLElement, mods: DamageModifiers) => {
    if (popup && popupOwner === link) { closePopup(); return; }
    closePopup();
    const line = link.parentElement;
    if (!line) return;
    popup = buildModPopup(mods, nm);
    popupOwner = link;
    line.style.zIndex = '20';
    line.appendChild(popup);
    const gap = 8;
    const spaceRight = line.clientWidth - link.offsetLeft - link.offsetWidth - gap;
    const needLeft = popup.offsetWidth > spaceRight && link.offsetLeft > popup.offsetWidth;
    popup.style.left = needLeft
      ? `${Math.max(0, link.offsetLeft - popup.offsetWidth - gap)}px`
      : `${link.offsetLeft + link.offsetWidth + gap}px`;
    popup.style.top = `${Math.max(0, link.offsetTop - 6)}px`;
  };
  // 点击链接以外的任意处关闭弹窗（链接点击自身 stopPropagation）
  document.addEventListener('click', (e) => {
    if (popup && !(e.target as HTMLElement).closest('.dmg-popup, .dmg-link')) closePopup();
  });

  function setRound(r: number): void {
    current = Math.max(0, Math.min(report.rounds, r));
    label.textContent = current === 0 ? '战斗开始前' : `第 ${current} 回合`;
    btnPrev.disabled = current === 0;
    btnNext.disabled = current >= report.rounds;
    tabBtns.forEach((t, i) => t.classList.toggle('on', i === current));
    renderRound();
  }

  function renderRound(): void {
    closePopup();
    body.innerHTML = '';
    const { my, enemy } = troopsAt(current);

    const wrap = document.createElement('div');
    wrap.className = 'troops-wrap';
    wrap.appendChild(renderTroopCol('red', myLabel, report.myTeam, my));
    wrap.appendChild(renderTroopCol('blue', enemyLabel, report.enemyTeam, enemy));
    body.appendChild(wrap);

    // 事件流
    const stream = document.createElement('div');
    stream.className = 'event-stream';
    const title = document.createElement('div');
    title.className = 'es-title';
    title.textContent = current === 0 ? '准备阶段事件' : `第 ${current} 回合行动明细`;
    stream.appendChild(title);
    if (current === 0) {
      renderPrepEvents(stream, prepEvents(report.events), nm, { toggle: togglePopup });
    } else {
      const evs = roundEvents[current - 1] ?? [];
      if (evs.length === 0) stream.innerHTML += `<div class="ev dim">（本回合无行动）</div>`;
      else renderEvents(stream, evs, nm, { toggle: togglePopup });
    }
    body.appendChild(stream);
  }

  // ── 统计表 ──
  root.appendChild(renderStatsTable(report));

  btnPrev.onclick = () => setRound(current - 1);
  btnNext.onclick = () => setRound(current + 1);
  btnPlay.onclick = () => {
    if (timer !== null) {
      clearInterval(timer); timer = null;
      btnPlay.textContent = '▶ 自动播放';
      return;
    }
    if (current >= report.rounds) setRound(0);
    btnPlay.textContent = '⏸ 暂停';
    timer = window.setInterval(() => {
      if (current >= report.rounds) {
        clearInterval(timer!); timer = null;
        btnPlay.textContent = '▶ 自动播放';
        return;
      }
      setRound(current + 1);
    }, 900);
  };

  setRound(0);
  return { el: root, setRound, roundCount: () => report.rounds };
}

/** 准备阶段事件（battle_start ~ preparation_end 之间，不含 round_*） */
function prepEvents(events: BattleEvent[]): BattleEvent[] {
  const out: BattleEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'round_start') break;
    out.push(ev);
  }
  return out;
}

/**
 * 准备阶段事件流：【阵容】出手顺序 + 部队加成、【兵种】暂无效果、【战法】指挥/被动。
 * 不调用 `appendEv(null, …)`（group 为 null 时直接 return）。
 */
function renderPrepEvents(
  container: HTMLElement,
  evs: BattleEvent[],
  nm: (id: string) => string,
  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void }
): void {
  const start = evs.find((e) => e.type === 'battle_start');
  const sections: Record<'formation' | 'troop' | 'skill', BattleEvent[]> = {
    formation: [],
    troop: [],
    skill: [],
  };
  let cur: 'formation' | 'troop' | 'skill' | null = null;
  for (const ev of evs) {
    if (ev.type === 'prep_phase') {
      cur = ev.phase;
      continue;
    }
    if (ev.type === 'battle_start' || ev.type === 'preparation_end') continue;
    if (cur) sections[cur].push(ev);
  }

  const addHead = (label: string) => {
    const h = document.createElement('div');
    h.className = 'es-phase';
    h.textContent = `【${label}】`;
    container.appendChild(h);
  };

  addHead(PHASE_LABEL.formation);
  if (start && start.type === 'battle_start') {
    const order = document.createElement('div');
    order.className = 'ev status';
    order.textContent = `出手顺序：${start.turnOrder.map(nm).join(' > ')}`;
    container.appendChild(order);
  }
  const fac = sections.formation.filter((e) => e.type === 'formation_bonus');
  if (fac.length === 0) {
    const d = document.createElement('div');
    d.className = 'ev dim';
    d.textContent = '无部队加成';
    container.appendChild(d);
  } else {
    for (const ev of fac) {
      if (ev.type !== 'formation_bonus') continue;
      const cat =
        ev.category === 'faction' ? '阵营加成'
          : ev.category === 'title' ? `称号加成「${ev.titleName ?? ''}」`
            : '兵种加成';
      const d = document.createElement('div');
      d.className = 'ev good';
      d.textContent = `${nm(ev.unitId)} ${cat}：${formatBonusText(ev.bonuses)}`;
      container.appendChild(d);
    }
  }

  addHead(PHASE_LABEL.troop);
  const empty = document.createElement('div');
  empty.className = 'ev dim';
  empty.textContent = '暂无效果';
  container.appendChild(empty);

  addHead(PHASE_LABEL.skill);
  const skillEvs = sections.skill;
  if (skillEvs.length === 0) {
    const d = document.createElement('div');
    d.className = 'ev dim';
    d.textContent = '（无战法）';
    container.appendChild(d);
  } else {
    renderEvents(container, skillEvs, nm, popupApi);
  }
}

function renderTroopCol(
  cls: string,
  title: string,
  team: BattleReport['myTeam'],
  troops: number[]
): HTMLElement {
  const col = document.createElement('div');
  col.className = `troop-col ${cls}`;
  const hd = document.createElement('h4');
  hd.textContent = title;
  col.appendChild(hd);
  team.forEach((g, i) => {
    const t = troops[i] ?? g.maxTroops;
    const pct = Math.max(0, Math.min(100, (t / g.maxTroops) * 100));
    const row = document.createElement('div');
    row.className = 'troop-row' + (t <= 0 ? ' dead' : '');
    row.innerHTML = `
      <span class="tavatar"><img src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" /></span>
      <span class="tname" title="${g.name}">${g.name}</span>
      <span class="tbar"><span class="tfill" style="width:${pct}%"></span></span>
      <span class="tnum">${t.toLocaleString()}${t <= 0 ? ' 阵亡' : ''}</span>
    `;
    col.appendChild(row);
  });
  return col;
}

/** 事件流渲染：按 unit_act_start 分组 */
function renderEvents(
  container: HTMLElement,
  evs: BattleEvent[],
  nm: (id: string) => string,
  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void }
): void {
  let group: HTMLElement | null = null;

  const flush = () => {
    if (group) { container.appendChild(group); group = null; }
  };

  for (const ev of evs) {
    switch (ev.type) {
      case 'unit_act_start': {
        flush();
        group = document.createElement('div');
        group.className = 'act-group';
        const head = document.createElement('div');
        head.className = 'act-head';
        head.innerHTML = `<img class="act-avatar" src="${avatarSrc(ev.unitId)}" alt="" onerror="this.style.display='none'" /><span class="dot"></span><span class="hl">${nm(ev.unitId)}</span><span class="phase">${PHASE_NAME[ev.phase] ?? ev.phase}</span>`;
        group.appendChild(head);
        break;
      }
      case 'skill_trigger': {
        if (ev.rate !== undefined) {
          // 只保留主干：当前生效几率（含士气修正）；括号内的计算过程与判定字样不输出
          const who =
            ev.targetId && ev.targetId !== ev.unitId
              ? `【${nm(ev.targetId)}】来自【${nm(ev.unitId)}】的`
              : `【${nm(ev.unitId)}】`;
          appendEv(group, ev.success ? 'good' : 'dim', `${who}【${ev.skillName}】当前生效几率为${ev.rate}%`);
        } else {
          const s = SKILL_REGISTRY[ev.skillId];
          const base = s && (s.type === 'active' || s.type === 'pursuit') ? `（基础发动率 ${Math.round(s.triggerRate * 100)}%）` : '';
          appendEv(group, ev.success ? 'good' : 'dim',
            `战法「${ev.skillName}」判定：${ev.success ? '发动' : '未发动'} <span class="sub">${base}</span>`);
        }
        break;
      }
      case 'skill_target': {
        appendEv(group, 'dim', `　目标：${ev.targetIds.map(nm).join('、')}`);
        break;
      }
      case 'skill_cast': {
        appendEv(group, 'status', `${nm(ev.unitId)} 释放「${ev.skillName}」`);
        break;
      }
      case 'damage': {
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        const cls = ev.damageType === 'physical' ? 'dmg-phy' : 'dmg-stg';
        const typeName = ev.damageType === 'physical' ? '兵刃' : '谋略';
        appendEv(group, cls,
          `对「${nm(ev.targetId)}」造成<b> ${typeName}伤害 ${ev.damage.toLocaleString()} </b>`);
        break;
      }
      case 'attack_hit': {
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        appendEv(group, 'dmg-phy',
          `普攻命中「${nm(ev.targetId)}」（距离${ev.distance}）造成 <b>${ev.damage.toLocaleString()}</b>`);
        break;
      }
      case 'no_attack_target':
        appendEv(group, 'dim', `　无法普攻：${ev.reason}`);
        break;
      case 'heal':
        appendEv(group, 'heal', `「${nm(ev.targetId)}」恢复兵力 <b>${ev.amount.toLocaleString()}</b>（${ev.before.toLocaleString()} → ${ev.after.toLocaleString()}）`);
        break;
      case 'status_inflicted':
        appendEv(group, 'status', `${nm(ev.unitId)} 获得：${ev.detail}`);
        break;
      case 'status_conflict':
        appendEv(group, 'conflict', `✘ ${nm(ev.unitId)} ${ev.detail}`);
        break;
      case 'status_expired':
        appendEv(group, 'dim', `　${nm(ev.unitId)} 的${statusName(ev.statusType)}状态解除`);
        break;
      case 'evasion_blocked':
        appendEv(group, 'good', `规避：「${nm(ev.unitId)}」免疫伤害（剩余 ${ev.remainingStacks} 层）`);
        break;
      case 'insight_blocked':
        appendEv(group, 'good', `洞察：「${nm(ev.unitId)}」免疫了${statusName(ev.statusType)}`);
        break;
      case 'siege_blocked':
        appendEv(group, 'conflict', `✘ 「${nm(ev.unitId)}」受围困影响，无法回复兵力`);
        break;
      case 'dot_tick': {
        // DoT（燃烧/恐慌/妖术/诅咒/引燃）：增减伤归因在挂上时冻结（modifiers 恒存在），
        // 归属施法者（casterId）而非受击者
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        appendEv(group, 'dmg-stg', `「${nm(ev.targetId)}」受到${dotName(ev.dotType)}伤害 <b>${ev.damage.toLocaleString()}</b>`);
        break;
      }
      case 'split_damage': {
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        appendEv(group, 'dmg-phy', `分兵溅射「${nm(ev.targetId)}」造成 <b>${ev.damage.toLocaleString()}</b>`);
        break;
      }
      case 'prepare_start':
        appendEv(group, 'status', `${nm(ev.unitId)} 开始准备「${ev.skillName}」`);
        break;
      case 'prepare_skip':
        appendEv(group, 'good', `${nm(ev.unitId)} 跳过准备，直接发动「${ev.skillName}」`);
        break;
      case 'prepare_end':
        appendEv(group, 'status', `${nm(ev.unitId)} 准备完成，发动「${ev.skillName}」`);
        break;
      case 'unit_dead':
        appendEv(group, 'dead', `${nm(ev.unitId)} 阵亡`);
        break;
      case 'unit_act_end':
      case 'prep_phase':
      case 'formation_bonus':
      case 'battle_start':
      case 'preparation_end':
      case 'round_start':
      case 'round_end':
      case 'battle_end':
        break;
    }
  }
  flush();
}

function appendEv(group: HTMLElement | null, cls: string, html: string): void {
  if (!group) return;
  const div = document.createElement('div');
  div.className = `ev ${cls}`;
  div.innerHTML = html;
  group.appendChild(div);
}

// ─── 增减伤统计（伤害数字前插入「此次伤害共计提升/降低 z%」净合计行，z 可点击弹出统计面板）───

/** 正增伤来源（受到侧 + 造成侧，rate > 0）：伤害提升（神兵天降类在前，大赏三军类在后） */
function boostSources(mods: DamageModifiers): DamageModifierSource[] {
  return [...mods.taken, ...mods.caused].filter((s) => s.rate > 0);
}

/** 负增伤来源（rate < 0，如无心恋战：造成伤害降低 = 负增伤）：展示为「伤害降低」 */
function negativeBoostSources(mods: DamageModifiers): DamageModifierSource[] {
  return [...mods.caused, ...mods.taken].filter((s) => s.rate < 0);
}

/** 伤害提升合计（正增伤，小数 → 百分比整数）——弹窗「伤害提升合计」栏 */
function boostTotalPct(mods?: DamageModifiers): number {
  if (!mods) return 0;
  return Math.round(boostSources(mods).reduce((a, s) => a + s.rate, 0) * 100);
}

/** 伤害降低合计（受击方减伤 + 负增伤绝对值，小数 → 百分比整数） */
function reduceTotalPct(mods?: DamageModifiers): number {
  if (!mods) return 0;
  const red = mods.reduce.reduce((a, s) => a + s.rate, 0);
  const neg = negativeBoostSources(mods).reduce((a, s) => a + Math.abs(s.rate), 0);
  return Math.round((red + neg) * 100);
}

/** 增减伤净合计（提升 − 降低，小数 → 百分比整数）：净合计行的 x。
 *  实际增减伤受伤害下限保护（buffMult min 10%）：净降低超过 90% 时实际只降低 90%（净提升无上限） */
function netBoostPct(mods?: DamageModifiers): number {
  if (!mods) return 0;
  const net = boostTotalPct(mods) - reduceTotalPct(mods);
  return net < -90 ? -90 : net;
}

/** 伤害数字前插入增减伤净合计行：x = 提升合计 − 降低合计（正 → 「共计提升」；负 → 「共计降低」）。
 *  点击 x 弹出「增减伤统计」面板（提升/降低两栏 + 各来源明细【武将】【战法】）。
 *  无任何增减伤或净值为 0 时不显示。
 *  行本身 `position:relative`，作为明细弹窗的包含块（避免挂到滚动容器后错位）。 */
function appendDamageModifierLine(
  group: HTMLElement | null,
  mods: DamageModifiers | undefined,
  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void }
): void {
  const net = netBoostPct(mods);
  if (!mods || net === 0) return;
  const div = document.createElement('div');
  div.className = 'ev dmg-mod';
  // 弹窗绝对定位的包含块：必须在行内，不能依赖滚动容器 .battle-view
  div.style.position = 'relative';
  const verb = net > 0 ? '提升' : '降低';
  div.append(`此次伤害共计${verb} `);
  const link = document.createElement('a');
  link.className = 'dmg-link';
  link.href = 'javascript:void(0)';
  link.textContent = `${Math.abs(net)}%`;
  link.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    popupApi.toggle(link, mods);
  };
  div.appendChild(link);
  group!.appendChild(div);
}

/** 构建「增减伤统计」弹窗：伤害提升合计（神兵天降类在前，大赏三军类在后）+ 伤害降低合计 */
function buildModPopup(mods: DamageModifiers, nm: (id: string) => string): HTMLElement {
  const pop = document.createElement('div');
  pop.className = 'dmg-popup';
  const title = document.createElement('div');
  title.className = 'dmg-pop-title';
  title.textContent = '增减伤统计';
  pop.appendChild(title);
  pop.appendChild(buildModSection(`伤害提升合计：${boostTotalPct(mods)}%`, boostSources(mods), '提升', nm));
  // 降低合计同样受 10% 伤害下限保护：超过 90% 显示 90%（实际增减伤）
  pop.appendChild(buildModSection(`伤害降低合计：${Math.min(reduceTotalPct(mods), 90)}%`, [...negativeBoostSources(mods), ...mods.reduce], '降低', nm));
  return pop;
}

function buildModSection(
  header: string,
  sources: DamageModifierSource[],
  label: '提升' | '降低',
  nm: (id: string) => string
): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'dmg-pop-sec';
  const h = document.createElement('div');
  h.className = 'dmg-pop-sec-h';
  h.textContent = header;
  sec.appendChild(h);
  for (const s of sources) {
    const item = document.createElement('div');
    item.className = 'dmg-pop-item';
    const pct = Math.round(Math.abs(s.rate) * 100);
    // 超过 90% 的降低（如辕门射戟 -9999% debuff）：实际效果受 10% 伤害下限保护，显示「伤害大幅降低」不显示数值
    item.textContent = pct > 90 && s.rate < 0
      ? `【${nm(s.unitId)}】【${s.skillName}】伤害大幅降低`
      : `【${nm(s.unitId)}】【${s.skillName}】伤害${label} ${pct}%`;
    sec.appendChild(item);
  }
  return sec;
}

function statusName(t: string): string {
  const m: Record<string, string> = {
    confusion: '混乱', rampage: '暴走', cowardice: '怯战', hesitation: '犹豫', evasion: '规避',
    combo: '连击', attack_buff: '攻击增益', defense_buff: '防御增益', strategy_buff: '谋略增益',
    speed_buff: '速度增益', damage_reduce: '减伤', damage_boost: '增伤', trigger_boost: '发动率提升',
    morale_boost: '士气提高', ignore_def: '无视防御',
    insight: '洞察', siege: '围困', sorcery: '妖术', burning: '燃烧', panic: '恐慌',
    split: '分兵', jump_prep: '跳过准备', taunt: '挑衅', cover: '援護',
    first_aid: '持续型急救', rest: '休整',
  };
  return m[t] ?? t;
}

function dotName(t: string): string {
  return t === 'sorcery' ? '妖术' : t === 'burning' ? '燃烧' : '恐慌';
}

function renderStatsTable(report: BattleReport): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stats-table';
  const rows = report.stats
    .map((s) => `
      <tr>
        <td class="side-${s.side}"><img class="stat-avatar" src="${avatarSrc(s.unitId)}" alt="" onerror="this.style.display='none'" />${s.name}</td>
        <td>${s.attackCount}</td>
        <td>${s.attackDamage.toLocaleString()}</td>
        <td>${s.skillCount}</td>
        <td>${s.skillDamage.toLocaleString()}</td>
      </tr>`)
    .join('');
  wrap.innerHTML = `
    <table>
      <thead><tr><th>武将</th><th>普攻次数</th><th>普攻伤害</th><th>战法次数</th><th>战法伤害</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="tip">统计口径：战法次数含追击/准备战法释放；受规避免疫的伤害不计。</div>
  `;
  return wrap;
}
