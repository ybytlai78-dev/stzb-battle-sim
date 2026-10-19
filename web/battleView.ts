/**
 * 战报详情：紧凑结果横幅 + 图三三栏（出手顺序 / 事件流 / 回合轨）。
 * 事件文案仍由 `renderEvents` / `renderPrepEvents` / `appendDamageModifierLine` 产出。
 */
import type { BattleEvent, BattleReport, DamageModifierSource, DamageModifiers, General } from '../src/engine/types';
import { formatBonusText } from '../src/engine/troopBonus';
import { SECONDARY_TROOPS } from '../src/engine/secondaryTroop';
import { SKILL_REGISTRY } from '../src/data/skills';
import { avatarSrc, heroIdOf } from './heroes';
import { RESULT_GLYPH } from './resultGlyph';

/** 事件流渲染附加上下文：组头兵力与红蓝分色（不改事件字符串口径） */
interface RenderEvCtx {
  /** 按 unitId 查当前回合开始时兵力 */
  troopsOf?: (unitId: string) => number | undefined;
  /** 我方单位 id，用于 `.act-head` 红/蓝底 */
  myIds?: Set<string>;
  /** 按 unitId 取真实武将 id 的头像（跨队同将副本 id 无法直接查武将） */
  iconOf?: (unitId: string) => string;
}

/** 准备阶段标题：阵容（内含四段加成）/ 宝物 / 陈寿特性 / 战法 */
const PHASE_LABEL: Record<'formation' | 'treasure' | 'chenshou' | 'skill', string> = {
  formation: '阵容',
  treasure: '宝物',
  chenshou: '陈寿特性',
  skill: '战法',
};

const PHASE_NAME: Record<string, string> = {
  active_skill: '主动战法判定',
  normal_attack: '普通攻击',
  pursuit_skill: '追击战法判定',
  command_skill: '指挥战法',
  passive_skill: '被动战法',
  dot_tick: '持续伤害',
};

/** 站位序：准备阶段的行按 大营 → 中军 → 前锋 排 */
const POS_ORDER: Record<string, number> = { 大营: 0, 中军: 1, 前锋: 2 };

/** 阵营/称号/兵种/兵种特性四段：标题下各自的展示行 */
type PrepBonusCategory = 'faction' | 'title' | 'troop';

const PREP_CATEGORY_LABEL: Record<PrepBonusCategory, string> = {
  faction: '阵营加成',
  title: '称号加成',
  troop: '兵种加成',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 二级兵种专属特性名：数据里是「名字：效果」或「名字A / 名字B：效果」。
 * 准备阶段「兵种特性加成」只列名字（效果交给战斗过程），与官方准备面板一致。
 */
function traitNamesOf(desc: string): string[] {
  const head = desc.split(/[：:]/, 1)[0] ?? desc;
  return head
    .split(/\s*\/\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 准备阶段里的标题行；`sub` 用于四段加成（比【阵容】低一档） */
function appendPhaseHead(container: HTMLElement, label: string, cls = ''): HTMLElement {
  const h = document.createElement('div');
  h.className = `es-phase${cls ? ` ${cls}` : ''}`;
  h.textContent = `【${label}】`;
  container.appendChild(h);
  return h;
}

/** 准备阶段里的一行事件文案（HTML，名字已分色） */
function appendPhaseLine(container: HTMLElement, cls: string, html: string): void {
  const d = document.createElement('div');
  d.className = `ev ${cls}`;
  d.innerHTML = html;
  container.appendChild(d);
}

/**
 * 兵种特性加成条目：专属特性 + 已学习的通用特性，按队伍 / 站位排序。
 * 只在配置了二级兵种或通用特性时产生；没有条目就不出标题。
 */
function troopTraitEntries(teams: General[][]): Array<{ unitId: string; trait: string }> {
  const out: Array<{ unitId: string; trait: string }> = [];
  for (const team of teams) {
    const sorted = [...team].sort(
      (a, b) => (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9)
    );
    for (const g of sorted) {
      if (!g.secondaryTroop && (g.secondaryTraits?.length ?? 0) === 0) continue;
      const names = new Set<string>();
      if (g.secondaryTroop) {
        for (const desc of SECONDARY_TROOPS[g.secondaryTroop]?.exclusiveTrait ?? []) {
          for (const name of traitNamesOf(desc)) names.add(name);
        }
      }
      for (const trait of g.secondaryTraits ?? []) names.add(trait);
      for (const trait of names) out.push({ unitId: g.id, trait });
    }
  }
  return out;
}

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

  // 单位 id → 名字 / 展示用武将 id（红蓝同将时引擎副本 id 为 `h16#2`，原 id 在 heroId）
  const nameById = new Map<string, string>();
  const heroIdById = new Map<string, string>();
  for (const g of report.myTeam) {
    nameById.set(g.id, g.name);
    heroIdById.set(g.id, heroIdOf(g));
  }
  for (const g of report.enemyTeam) {
    nameById.set(g.id, g.name);
    heroIdById.set(g.id, heroIdOf(g));
  }
  const nm = (id: string) => nameById.get(id) ?? id;
  /** 头像等展示素材按真实武将 id 取（跨队同将的副本 id 不能直接查武将） */
  const heroIcon = (id: string) => avatarSrc(heroIdById.get(id) ?? id);

  // ── 武将名分色（用户口径：红方/我方红字，蓝方/敌方绿字）──
  const sideById = new Map<string, 'my' | 'enemy'>();
  for (const g of report.myTeam) sideById.set(g.id, 'my');
  for (const g of report.enemyTeam) sideById.set(g.id, 'enemy');
  /** 名字 → 出现过的阵营；同一名字横跨红蓝（镜像局）时不猜，保留行原色 */
  const nameSides = new Map<string, Set<'my' | 'enemy'>>();
  for (const [id, side] of sideById) {
    const name = nm(id);
    const set = nameSides.get(name) ?? new Set<'my' | 'enemy'>();
    set.add(side);
    nameSides.set(name, set);
  }
  const heroNameRe = nameSides.size > 0
    ? new RegExp(
        [...nameSides.keys()]
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp)
          .join('|'),
        'g'
      )
    : null;
  /** 已知 unitId 的名字 HTML（前缀/顺序行用，镜像局也能按 id 分色） */
  const nameHtml = (id: string): string => {
    const side = sideById.get(id);
    if (!side) return escapeHtml(nm(id));
    return `<span class="${side === 'my' ? 'hn-my' : 'hn-enemy'}">${escapeHtml(nm(id))}</span>`;
  };
  /**
   * 把已渲染文本里的武将名包成侧别色。只处理「名字只属于一队」的情况：
   * 跨队同名（镜像局）无法从纯文本判断是谁，保留原色，避免染错。
   * 已经包过 `.hn-*` 的节点跳过（重复渲染不会套娃）。
   */
  const colorizeHeroNames = (rootEl: HTMLElement): void => {
    if (!heroNameRe) return;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent || parent.closest('.hn-my, .hn-enemy')) continue;
      const text = node.nodeValue ?? '';
      if (!text || !heroNameRe.test(text)) continue;
      heroNameRe.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = heroNameRe.exec(text)) !== null) {
        if (m.index > last) frag.append(text.slice(last, m.index));
        const sides = nameSides.get(m[0]);
        if (sides?.size === 1) {
          const span = document.createElement('span');
          span.className = sides.has('my') ? 'hn-my' : 'hn-enemy';
          span.textContent = m[0];
          frag.append(span);
        } else {
          frag.append(m[0]);
        }
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  };

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

  const myIds = new Set(report.myTeam.map((g) => g.id));
  let current = 0;
  /**
   * 按 unitId 查当前回合开始时兵力（myTeam/enemyTeam 配置序对照 myTroops/enemyTroops）。
   */
  const troopsOf = (unitId: string): number | undefined => {
    const { my, enemy } = troopsAt(current);
    const mi = report.myTeam.findIndex((g) => g.id === unitId);
    if (mi >= 0) return my[mi] ?? report.myTeam[mi]!.maxTroops;
    const ei = report.enemyTeam.findIndex((g) => g.id === unitId);
    if (ei >= 0) return enemy[ei] ?? report.enemyTeam[ei]!.maxTroops;
    return undefined;
  };
  const evCtx: RenderEvCtx = { troopsOf, myIds, iconOf: heroIcon };

  // ── 结果横幅（紧凑，供 smoke / 历史详情识别）──
  const banner = document.createElement('div');
  banner.className = `result-banner ${report.result}`;
  const resLabel = report.result === 'win' ? (opts.resultWin ?? '红队胜利') : report.result === 'loss' ? (opts.resultLoss ?? '蓝队胜利') : '平局';
  const glyph = RESULT_GLYPH[report.result];
  banner.innerHTML = `
    <img class="res-glyph" src="${glyph.src}" alt="${glyph.alt}" />
    <span class="res">${resLabel}</span>
    <span>进行 ${report.rounds} 回合 · 种子 ${report.seed}</span>
    <span>${myLabel}剩余 ${report.finalMyTroops.reduce((a, b) => a + b, 0).toLocaleString()} ｜ ${enemyLabel}剩余 ${report.finalEnemyTroops.reduce((a, b) => a + b, 0).toLocaleString()}</span>
  `;
  root.appendChild(banner);

  const startEv = report.events.find((e) => e.type === 'battle_start');
  const startTurnOrder: string[] =
    startEv && startEv.type === 'battle_start' && startEv.turnOrder.length > 0
      ? startEv.turnOrder
      : [...report.myTeam, ...report.enemyTeam].map((g) => g.id);

  /**
   * 指定回合的出手顺序：准备阶段用开场序；正式回合用该回合 round_start.turnOrder
   * （按当时生效速度重排，含速度增益 / 先手组）。
   */
  const turnOrderForRound = (r: number): string[] => {
    if (r <= 0) return startTurnOrder;
    const ev = report.events.find((e) => e.type === 'round_start' && e.round === r);
    if (ev && ev.type === 'round_start' && ev.turnOrder && ev.turnOrder.length > 0) return ev.turnOrder;
    return startTurnOrder;
  };

  /** 轨上按钮 */
  const railBtn = (text: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    return b;
  };
  const railSep = (): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'sep';
    return s;
  };

  // ── 图三三栏 ──
  const dv = document.createElement('div');
  dv.className = 'dv';

  const turns = document.createElement('aside');
  turns.className = 'dv-turns';
  const turnBtns: HTMLButtonElement[] = [];

  const mid = document.createElement('section');
  mid.className = 'dv-mid';
  const dvHead = document.createElement('div');
  dvHead.className = 'dv-head';
  const headTitle = document.createElement('strong');
  dvHead.appendChild(headTitle);
  const log = document.createElement('div');
  log.className = 'dv-log scroll-quiet event-stream';
  mid.append(dvHead, log);

  const rail = document.createElement('aside');
  rail.className = 'dv-rail';
  const btnDetail = railBtn('详');
  const btnSimple = railBtn('简');
  const btnPrev = railBtn('上');
  const tabBtns: HTMLButtonElement[] = [];
  for (let r = 0; r <= report.rounds; r++) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'rtab';
    t.textContent = r === 0 ? '始' : String(r);
    t.onclick = () => setRound(r);
    tabBtns.push(t);
  }
  const btnNext = railBtn('下');
  const btnPlay = railBtn('播');
  rail.append(btnDetail, btnSimple, railSep(), btnPrev, ...tabBtns, btnNext, railSep(), btnPlay);

  dv.append(turns, mid, rail);
  root.appendChild(dv);

  let timer: number | null = null;

  btnDetail.classList.add('is-on');
  btnDetail.onclick = () => {
    dv.classList.remove('is-simple');
    btnDetail.classList.add('is-on');
    btnSimple.classList.remove('is-on');
  };
  btnSimple.onclick = () => {
    dv.classList.add('is-simple');
    btnSimple.classList.add('is-on');
    btnDetail.classList.remove('is-on');
  };

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
    colorizeHeroNames(popup);
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

  /**
   * 把日志滚到指定单位的行动组顶部。不用 scrollIntoView（外壳缩放会错位）。
   * 本回合没有该单位的 `.act-group` 时不操作。
   */
  function scrollLogToUnit(unitId: string): void {
    const group = Array.from(log.querySelectorAll('.act-group')).find(
      (el) => (el as HTMLElement).dataset.unitId === unitId,
    ) as HTMLElement | undefined;
    if (!group) return;
    turnBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.unitId === unitId));
    log.scrollTop += group.getBoundingClientRect().top - log.getBoundingClientRect().top;
  }

  /** 按当前回合出手顺序刷新左侧头像列 */
  function renderTurnOrder(r: number): void {
    const ids = turnOrderForRound(r);
    turns.innerHTML = '';
    turnBtns.length = 0;
    ids.forEach((id, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'turn';
      btn.dataset.unitId = id;
      btn.innerHTML = `<span class="n">${i + 1}</span><span class="av"><img src="${heroIcon(id)}" alt="" onerror="this.style.display='none'" /></span>`;
      btn.onclick = () => scrollLogToUnit(id);
      turns.appendChild(btn);
      turnBtns.push(btn);
    });
  }

  function setRound(r: number): void {
    current = Math.max(0, Math.min(report.rounds, r));
    headTitle.textContent = current === 0 ? '回合前阶段' : `第 ${current} 回合`;
    btnPrev.disabled = current === 0;
    btnNext.disabled = current >= report.rounds;
    tabBtns.forEach((t, i) => {
      t.classList.toggle('on', i === current);
      t.classList.toggle('is-on', i === current);
    });
    renderRound();
  }

  function renderRound(): void {
    closePopup();
    renderTurnOrder(current);
    log.innerHTML = '';
    if (current === 0) {
      renderPrepEvents(
        log,
        prepEvents(report.events),
        nm,
        { toggle: togglePopup },
        { nameHtml, myTeam: report.myTeam, enemyTeam: report.enemyTeam },
        evCtx
      );
    } else {
      const evs = roundEvents[current - 1] ?? [];
      if (evs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ev dim';
        empty.textContent = '（本回合无行动）';
        log.appendChild(empty);
      } else {
        // 回合前阶段 = 首个 unit_act_start 之前的事件（谋谟帷幄 / 先发 / 出奇 / DoT 回合前结算…）。
        // 单独加标题，避免这些行看起来像是第一位行动武将的行动组。
        const firstAct = evs.findIndex((e) => e.type === 'unit_act_start');
        const preEnd = firstAct < 0 ? evs.length : firstAct;
        const pre = evs.slice(0, preEnd);
        const rest = evs.slice(preEnd);
        if (pre.length > 0) {
          appendPhaseHead(log, '回合前阶段', 'es-round-pre');
          renderEvents(log, pre, nm, { toggle: togglePopup }, evCtx);
        }
        if (rest.length > 0) renderEvents(log, rest, nm, { toggle: togglePopup }, evCtx);
      }
    }
    colorizeHeroNames(log);
  }

  btnPrev.onclick = () => setRound(current - 1);
  btnNext.onclick = () => setRound(current + 1);
  btnPlay.onclick = () => {
    if (timer !== null) {
      clearInterval(timer); timer = null;
      btnPlay.textContent = '播';
      btnPlay.classList.remove('is-on');
      return;
    }
    if (current >= report.rounds) setRound(0);
    btnPlay.textContent = '停';
    btnPlay.classList.add('is-on');
    timer = window.setInterval(() => {
      if (current >= report.rounds) {
        clearInterval(timer!); timer = null;
        btnPlay.textContent = '播';
        btnPlay.classList.remove('is-on');
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
 * 准备阶段事件流：【阵容】四段加成（阵营 / 称号 / 兵种 / 兵种特性）、
 * 【宝物】【陈寿特性】【战法】。不调用 `appendEv(null, …)`（group 为 null 时直接 return）。
 * 出手顺序不在战报里重复展示（用户 2026-10-19 口径）。
 */
function renderPrepEvents(
  container: HTMLElement,
  evs: BattleEvent[],
  nm: (id: string) => string,
  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void },
  heroApi: { nameHtml: (id: string) => string; myTeam: General[]; enemyTeam: General[] },
  ctx?: RenderEvCtx
): void {
  const sections: Record<'formation' | 'troop' | 'treasure' | 'chenshou' | 'skill', BattleEvent[]> = {
    formation: [],
    troop: [],
    treasure: [],
    chenshou: [],
    skill: [],
  };
  let cur: 'formation' | 'troop' | 'treasure' | 'chenshou' | 'skill' | null = null;
  for (const ev of evs) {
    if (ev.type === 'prep_phase') {
      cur = ev.phase;
      continue;
    }
    if (ev.type === 'battle_start' || ev.type === 'preparation_end') continue;
    if (cur) sections[cur].push(ev);
  }

  appendPhaseHead(container, PHASE_LABEL.formation);

  const bonuses = sections.formation.filter(
    (e): e is Extract<BattleEvent, { type: 'formation_bonus' }> => e.type === 'formation_bonus'
  );
  // 兵种特性加成：按武将配置列「获得【特性】」，不再把 grantSecondaryTroopStatuses 的
  // 施加日志（sections.troop）原样混进来，避免与特性名重复。
  const traits = troopTraitEntries([heroApi.myTeam, heroApi.enemyTeam]);

  if (bonuses.length === 0 && traits.length === 0) {
    appendPhaseLine(container, 'dim', '无部队加成');
  } else {
    for (const cat of ['faction', 'title', 'troop'] as const) {
      const lines = bonuses.filter((e) => e.category === cat);
      if (lines.length === 0) continue;
      appendPhaseHead(container, PREP_CATEGORY_LABEL[cat], 'es-sub');
      for (const ev of lines) {
        const name = heroApi.nameHtml(ev.unitId);
        const title = cat === 'title' && ev.titleName ? `「${escapeHtml(ev.titleName)}」` : '';
        const suffix = title ? ` ${title}：` : ' ';
        appendPhaseLine(container, 'good', `${name}${suffix}${formatBonusText(ev.bonuses)}`);
      }
    }

    if (traits.length > 0) {
      appendPhaseHead(container, '兵种特性加成', 'es-sub');
      for (const entry of traits) {
        appendPhaseLine(
          container,
          'good',
          `${heroApi.nameHtml(entry.unitId)} 获得【${escapeHtml(entry.trait)}】`
        );
      }
    }
  }

  // 宝物（佩戴才发 prep_phase: 'treasure'）：展示准备阶段挂载的宝物效果
  if (sections.treasure.length > 0) {
    appendPhaseHead(container, PHASE_LABEL.treasure);
    renderEvents(container, sections.treasure, nm, popupApi, ctx);
  }

  // 陈寿特性（使用才发 prep_phase: 'chenshou'）：展示准备阶段挂载的特性效果
  if (sections.chenshou.length > 0) {
    appendPhaseHead(container, PHASE_LABEL.chenshou);
    renderEvents(container, sections.chenshou, nm, popupApi, ctx);
  }

  appendPhaseHead(container, PHASE_LABEL.skill);
  const skillEvs = sections.skill;
  if (skillEvs.length === 0) {
    appendPhaseLine(container, 'dim', '（无战法）');
  } else {
    renderEvents(container, skillEvs, nm, popupApi, ctx);
  }
}

/** 事件流渲染：按 unit_act_start 分组 */
function renderEvents(
  container: HTMLElement,
  evs: BattleEvent[],
  nm: (id: string) => string,
  popupApi: { toggle: (link: HTMLElement, mods: DamageModifiers) => void },
  ctx?: RenderEvCtx
): void {
  let group: HTMLElement | null = null;

  const flush = () => {
    if (group) { container.appendChild(group); group = null; }
  };

  /**
   * delayedOutput / 回合开始结算发生在首个 unit_act_start 之前。
   * 无行动组时建无头组，避免 appendEv(null) 静默丢行。
   */
  const ensureGroup = () => {
    if (group) return;
    group = document.createElement('div');
    group.className = 'act-group';
    const body = document.createElement('div');
    body.className = 'act-body';
    group.appendChild(body);
  };

  const add = (cls: string, html: string) => {
    ensureGroup();
    appendEv(group, cls, html);
  };

  for (const ev of evs) {
    switch (ev.type) {
      case 'unit_act_start': {
        flush();
        group = document.createElement('div');
        group.className = 'act-group';
        group.dataset.unitId = ev.unitId;
        const head = document.createElement('div');
        const side = ctx?.myIds?.has(ev.unitId) ? 'red' : ctx?.myIds ? 'blue' : '';
        head.className = side ? `act-head ${side}` : 'act-head';
        const n = ctx?.troopsOf?.(ev.unitId);
        const troopHtml = n !== undefined ? `<span class="troops">${n.toLocaleString()}</span>` : '';
        head.innerHTML = `<img class="act-avatar" src="${ctx?.iconOf?.(ev.unitId) ?? avatarSrc(ev.unitId)}" alt="" onerror="this.style.display='none'" /><span class="hl">${nm(ev.unitId)}</span><span class="phase">${PHASE_NAME[ev.phase] ?? ev.phase}</span>${troopHtml}`;
        group.appendChild(head);
        const body = document.createElement('div');
        body.className = 'act-body';
        group.appendChild(body);
        break;
      }
      case 'skill_trigger': {
        if (ev.rate !== undefined) {
          // 只保留主干：当前生效几率（含士气修正）；括号内的计算过程与判定字样不输出
          const who =
            ev.targetId && ev.targetId !== ev.unitId
              ? `【${nm(ev.targetId)}】来自【${nm(ev.unitId)}】的`
              : `【${nm(ev.unitId)}】`;
          add(ev.success ? 'good' : 'dim', `${who}【${ev.skillName}】当前生效几率为${ev.rate}%`);
        } else {
          const s = SKILL_REGISTRY[ev.skillId];
          const tr = s && (s.type === 'active' || s.type === 'pursuit') ? s.triggerRate : undefined;
          const trNum = tr == null ? undefined : Array.isArray(tr) ? tr[0] : tr;
          const base = trNum != null ? `（基础发动率 ${Math.round(trNum * 100)}%）` : '';
          add(ev.success ? 'good' : 'dim',
            `战法「${ev.skillName}」判定：${ev.success ? '发动' : '未发动'} <span class="sub">${base}</span>`);
        }
        break;
      }
      case 'skill_target': {
        add('dim', `　目标：${ev.targetIds.map(nm).join('、')}`);
        break;
      }
      case 'skill_cast': {
        add('status', `【${nm(ev.unitId)}】发动【${ev.skillName}】！`);
        break;
      }
      case 'damage': {
        if (ev.delayedEffect && ev.afterTroops !== undefined) {
          const cls = ev.damageType === 'physical' ? 'dmg-phy' : 'dmg-stg';
          add(cls,
            `【${nm(ev.sourceId)}】【${ev.skillName}】的效果使【${nm(ev.targetId)}】损失了<b>${ev.damage.toLocaleString()}</b>兵力${afterSuffix(ev.afterTroops)}`);
          break;
        }
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        const cls = ev.damageType === 'physical' ? 'dmg-phy' : 'dmg-stg';
        const typeName = ev.damageType === 'physical' ? '攻击' : '谋略';
        add(cls,
          `对「${nm(ev.targetId)}」造成<b> ${typeName}伤害 ${ev.damage.toLocaleString()} </b>${afterSuffix(ev.afterTroops)}`);
        break;
      }
      case 'stored_effect_expired': {
        const kind = ev.damageType === 'strategy' ? '策略攻击伤害效果' : '攻击伤害效果';
        add('dim', `【${nm(ev.unitId)}】的来自【${nm(ev.sourceId)}】【${ev.skillName}】的${kind}消失了`);
        break;
      }
      case 'attack_hit': {
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        add('dmg-phy',
          `普攻命中「${nm(ev.targetId)}」（距离${ev.distance}）造成 <b>${ev.damage.toLocaleString()}</b>${afterSuffix(ev.afterTroops)}`);
        break;
      }
      case 'no_attack_target':
        add('dim', `　无法普攻：${ev.reason}`);
        break;
      case 'cover':
        // 援护代受（移花接木 / 疮痍累身）：仅普通攻击转移，战法伤害不转移
        add('good', `援护：「${nm(ev.unitId)}」为「${nm(ev.targetId)}」抵挡普通攻击`);
        break;
      case 'heal':
        add('heal', `「${nm(ev.targetId)}」恢复兵力 <b>${ev.amount.toLocaleString()}</b>（${ev.before.toLocaleString()} → ${ev.after.toLocaleString()}）`);
        break;
      case 'share_damage': {
        // 伤害分摊（言出必克 / 雅虑适时）：unitId = 分摊者（自己扣兵），targetId = 被分摊的原受击者。
        // 引擎分摊时不另发 damage 事件 —— 只有这一条 → 不渲染就完全看不出「谁替谁挨了多少」。
        const shareSkill = SKILL_REGISTRY[ev.skillId];
        add('share',
          `【${nm(ev.unitId)}】为【${nm(ev.targetId)}】分摊伤害 <b>${ev.amount.toLocaleString()}</b>${shareSkill ? `（${shareSkill.name}）` : ''}${afterSuffix(ev.afterTroops)}`);
        break;
      }
      case 'status_inflicted':
        if (isAttrReportDetail(ev.detail) || /】使【/.test(ev.detail)) {
          // 属性增减 / 持节镇西：官方两行，不再套「获得：」
          for (const line of ev.detail.split('\n')) {
            add('status', line.replace(/(提高了|降低了)(.+)$/, '$1<b>$2</b>'));
          }
        } else {
          add('status', `${nm(ev.unitId)} 获得：${ev.detail}`);
        }
        break;
      case 'status_conflict':
        add('conflict', `✘ ${nm(ev.unitId)} ${ev.detail}`);
        break;
      case 'skill_exec':
        // 战法效果执行行（疮痍累身）：官方口径「【周泰】执行来自【周泰】的【疮痍累身】效果！」
        add('status', ev.detail);
        break;
      case 'status_changed':
        // 受击递减（疮痍累身每受该类型伤 −1/12）：官方口径
        // 「【周泰】的受到攻击伤害降低效果下降了」+ 递减后的新值一行
        add(
          /^【/.test(ev.detail) ? 'status' : 'dim',
          /^【/.test(ev.detail) ? ev.detail : `${nm(ev.unitId)} 的${ev.detail}`
        );
        break;
      case 'status_expired':
        // 控制扩散（鸾凤和鸣）是消耗制：写「已用掉」，别让玩家以为是状态到期
        add(
          'dim',
          ev.statusType === 'control_spread'
            ? `　${nm(ev.unitId)} 的控制扩散已用掉（本次控制额外命中 1 个目标）`
            : `　${nm(ev.unitId)} 的${statusName(ev.statusType)}状态解除`
        );
        break;
      case 'evasion_blocked':
        add('good', `规避：「${nm(ev.unitId)}」免疫伤害（剩余 ${ev.remainingStacks} 层）`);
        break;
      case 'insight_blocked':
        add('good', `洞察：「${nm(ev.unitId)}」免疫了${statusName(ev.statusType)}`);
        break;
      case 'command_immune_blocked': {
        // 免疫负面（临时定策 / XP程昱）：整次施加被免疫；statusType 缺省时只写「负面」
        const s = SKILL_REGISTRY[ev.skillId];
        add('good', `【${nm(ev.unitId)}】免疫了${ev.statusType ? statusName(ev.statusType) : '负面'}效果${s ? `（${s.name}）` : ''}`);
        break;
      }
      case 'cowardice_immune_blocked':
        add('good', `【${nm(ev.unitId)}】免疫了${statusName(ev.statusType)}效果`);
        break;
      case 'control_immune_blocked':
        add('good', `【${nm(ev.unitId)}】免疫了${statusName(ev.statusType)}效果（坚毅）`);
        break;
      case 'treasure_evade_triggered':
        add('good', `【${nm(ev.unitId)}】首次受击触发避险：进入规避（免疫下 1 次伤害）`);
        break;
      case 'status_resisted': {
        // 抵御负面（暂时定策，XP程昱）：该次施加被取消
        const s = SKILL_REGISTRY[ev.skillId];
        add('good', `【${nm(ev.unitId)}】抵御了${statusName(ev.statusType)}效果${s ? `（${s.name}）` : ''}`);
        break;
      }
      case 'seal_settle':
        // 玉玺结转（僭号天子）：口径与 src/engine/report.ts 一致
        add('status', `【${nm(ev.unitId)}】【${ev.skillName}】玉玺结转：上一回合承担 ${ev.carried.toLocaleString()}，按 ${Math.round(ev.ratio * 100)}% 使其损失 ${ev.damage.toLocaleString()} 兵力（剩余 ${ev.afterTroops.toLocaleString()}）`);
        break;
      case 'siege_blocked':
        add('conflict', `✘ 「${nm(ev.unitId)}」受围困影响，无法回复兵力`);
        break;
      case 'dot_tick': {
        // DoT（燃烧/恐慌/妖术/动摇/诅咒/引燃）：增减伤归因在挂上时冻结（modifiers 恒存在），
        // 归属施法者（casterId）而非受击者
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        add('dmg-stg', `「${nm(ev.targetId)}」受到${dotName(ev.dotType)}伤害 <b>${ev.damage.toLocaleString()}</b>${afterSuffix(ev.afterTroops)}`);
        break;
      }
      case 'split_damage': {
        appendDamageModifierLine(group, ev.modifiers, popupApi);
        // 标注来源战法（三军齐出 / 长兵方阵…）：分兵伤害计入该战法统计
        const splitSrc = ev.skillId ? SKILL_REGISTRY[ev.skillId]?.name : undefined;
        add('dmg-phy', `分兵溅射「${nm(ev.targetId)}」造成 <b>${ev.damage.toLocaleString()}</b>${afterSuffix(ev.afterTroops)}${splitSrc ? `（${splitSrc}）` : ''}`);
        break;
      }
      case 'prepare_start':
        add('status', `${nm(ev.unitId)} 开始准备「${ev.skillName}」`);
        break;
      case 'prepare_skip':
        add('good', `${nm(ev.unitId)} 跳过准备，直接发动「${ev.skillName}」`);
        break;
      case 'prepare_end':
        // 只标「准备完成」：紧接着的 skill_cast 才是「发动」那一次，避免同一回合两行「发动」被读成两次发动
        add('status', `${nm(ev.unitId)} 准备完成「${ev.skillName}」`);
        break;
      case 'unit_dead':
        add('dead', `${nm(ev.unitId)} 阵亡`);
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

/** 属性增减 / 持节镇西战报行：官方口径，不套「获得：」 */
function isAttrReportDetail(detail: string): boolean {
  return detail.includes('执行来自') || /的(攻击|防御|谋略|速度)属性(提高了|降低了)/.test(detail);
}

/** 动兵力行统一后缀：结算后剩余兵力（引擎在事件里带 afterTroops；缺省不显示） */
function afterSuffix(after?: number): string {
  return after === undefined ? '' : `（剩余 ${after.toLocaleString()}）`;
}

function appendEv(group: HTMLElement | null, cls: string, html: string): void {
  if (!group) return;
  const div = document.createElement('div');
  div.className = `ev ${cls}`;
  div.innerHTML = html;
  const body = group.querySelector(':scope > .act-body');
  (body ?? group).appendChild(div);
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
  if (!group || !mods || net === 0) return;
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
  const body = group.querySelector(':scope > .act-body');
  (body ?? group).appendChild(div);
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
    const kind = s.attackOnly ? '攻击伤害' : '伤害';
    // 超过 90% 的降低（如辕门射戟 -9999% debuff）：实际效果受 10% 伤害下限保护，显示「攻击伤害大幅降低」不显示数值
    item.textContent = pct > 90 && s.rate < 0
      ? `【${nm(s.unitId)}】【${s.skillName}】${kind}大幅降低`
      : `【${nm(s.unitId)}】【${s.skillName}】${kind}${label} ${pct}%`;
    sec.appendChild(item);
  }
  return sec;
}

function statusName(t: string): string {
  const m: Record<string, string> = {
    confusion: '混乱', rampage: '暴走', cowardice: '怯战', hesitation: '犹豫', evasion: '规避',
    evade_chance: '概率规避',
    combo: '连击', attack_buff: '攻击增益', defense_buff: '防御增益', strategy_buff: '谋略增益',
    speed_buff: '速度增益', damage_reduce: '减伤', damage_boost: '增伤', trigger_boost: '发动率提升',
    heal_boost: '恢复提升',
    morale_boost: '士气提高', ignore_def: '无视防御', range_buff: '攻击距离',
    insight: '洞察', siege: '围困', sorcery: '妖术', burning: '燃烧', panic: '恐慌', unrest: '动摇',
    split: '分兵', jump_prep: '跳过准备', taunt: '挑衅', cover: '援護',
    first_aid: '持续型急救', rest: '休整',
    control_spread: '控制扩散',
  };
  return m[t] ?? t;
}

function dotName(t: string): string {
  const m: Record<string, string> = {
    sorcery: '妖术',
    burning: '燃烧',
    panic: '恐慌',
    unrest: '动摇',
    curse: '妖术诅咒',
    ignite: '引燃',
  };
  return m[t] ?? t;
}
