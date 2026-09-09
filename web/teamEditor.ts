/**
 * 选将 + 配战法 UI（纯 DOM，无框架）
 * 布局：红队（左，大营/中军/前锋）｜武将池｜蓝队（右，前锋/中军/大营）
 * 点击武将 → 率土风武将详情页（左画像右数据：四维+成长 / 加点 / 红度 / 兵种转换占位 / 三战法栏）
 * 战法判定顺序：被动 > 指挥 > 主动 > 追击；同类型内主战法先判定、装配战法按添加顺序。
 */
import { HEROES, getHeroById, SKILL_TYPE_NAME, avatarSrc, portraitSrc, isFemale, freePointBudget, troopCapacity, skillGrade, skillTypeIcon, gradeFrame, gradeRibbon, SKILL_DESCS, isMainSkill, isLearnableSkillListed, rednessStars, buildGeneral } from './heroes';
import type { HeroJson } from './heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { General, Skill, TroopType, FormationBonus } from '../src/engine/types';
import type { BattleReport } from '../src/engine/types';
import { computeTroopBonuses, ZERO_BONUS } from '../src/engine/troopBonus';
import { showNotice } from './notice';
import { createBattleView } from './battleView';
import { createBattleSummary, createStatsView } from './battleSummary';

export interface SlotState {
  heroId: string | null;
  /** 装配战法 id（不含主战法），同类型按数组顺序判定 */
  extraSkillIds: string[];
  freePoints: { attack: number; defense: number; strategy: number; speed: number };
  /** 红度 0-5（五星武将满红五红；每红 +10 自由属性点 +200 携带兵力） */
  redness: number;
  /** 等级 40~50（属性随成长率更新；携带兵力 = 等级×100+5000+红度×200） */
  level: number;
}

export interface EditorState {
  /** 红队与蓝队均为 [大营, 中军, 前锋]（从上到下） */
  red: SlotState[];
  blue: SlotState[];
}

export interface EditorHandlers {
  onPickHero: (team: 'red' | 'blue', slotIndex: number, heroId: string) => void;
  /**
   * 已入队武将整卡移动/互换（保留加点、红度、等级、装配战法）。
   * 同源同槽为 no-op；跨队时由上层做同名/SP 互斥校验。
   */
  onMoveSlot: (fromTeam: 'red' | 'blue', fromIdx: number, toTeam: 'red' | 'blue', toIdx: number) => void;
  onAddSkill: (team: 'red' | 'blue', slotIndex: number, skillId: string) => void;
  onRemoveSkill: (team: 'red' | 'blue', slotIndex: number, skillId: string) => void;
  onSetFreePoints: (team: 'red' | 'blue', slotIndex: number, key: keyof SlotState['freePoints'], value: number) => void;
  onSetRedness: (team: 'red' | 'blue', slotIndex: number, redness: number) => void;
  onSetLevel: (team: 'red' | 'blue', slotIndex: number, level: number) => void;
  onRemoveHero: (team: 'red' | 'blue', slotIndex: number) => void;
  onClearTeam: (team: 'red' | 'blue') => void;
}

export const emptySlot = (): SlotState => ({ heroId: null, extraSkillIds: [], freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 }, redness: 0, level: 40 });

export const emptyEditor = (): EditorState => ({
  red: [emptySlot(), emptySlot(), emptySlot()],
  blue: [emptySlot(), emptySlot(), emptySlot()],
});

/** 武将池拖拽仅带 heroId；槽位拖拽带来源队伍+下标，整卡移动以保留配置 */
type PoolDragPayload = { kind: 'pool'; heroId: string };
type SlotDragPayload = { kind: 'slot'; team: 'red' | 'blue'; idx: number; heroId: string };
type HeroDragPayload = PoolDragPayload | SlotDragPayload;

/** 当前正在拖动的已入队槽位；null 表示来自武将池或未在拖 */
let draggingSlot: SlotDragPayload | null = null;
/** 槽位拖拽结束后吞掉误触发的 click，避免打开详情页 */
let suppressSlotClick = false;

/**
 * 解析 dataTransfer 文本。槽位拖拽为 JSON；武将池仍为裸 heroId（兼容既有测试）。
 * @param raw `text/plain` 内容
 */
function parseDragPayload(raw: string): HeroDragPayload | null {
  if (!raw) return null;
  if (raw.charAt(0) === '{') {
    try {
      const o = JSON.parse(raw) as Partial<SlotDragPayload>;
      if (o.kind === 'slot' && (o.team === 'red' || o.team === 'blue') && typeof o.idx === 'number' && typeof o.heroId === 'string') {
        return { kind: 'slot', team: o.team, idx: o.idx, heroId: o.heroId };
      }
    } catch {
      /* 非槽位 JSON，按武将池 heroId 处理 */
    }
  }
  return { kind: 'pool', heroId: raw };
}

/**
 * 投放时解析来源：优先模块内 draggingSlot（dragstart 已记下），否则读 dataTransfer。
 * @param e 投放或经过时的拖拽事件
 */
function resolveHeroDrag(e: DragEvent): HeroDragPayload | null {
  if (draggingSlot) return draggingSlot;
  return parseDragPayload(e.dataTransfer?.getData('text/plain') ?? '');
}

/** 是否为已入队槽位拖拽（决定投放光标与武将池是否高亮） */
function isSlotDragEvent(e: DragEvent): boolean {
  return draggingSlot !== null || e.dataTransfer?.effectAllowed === 'move';
}

const RED_SLOTS: Array<[string, string]> = [['大营', 'red-大营'], ['中军', 'red-中军'], ['前锋', 'red-前锋']];
const BLUE_SLOTS: Array<[string, string]> = [['大营', 'blue-大营'], ['中军', 'blue-中军'], ['前锋', 'blue-前锋']];

const TYPE_CHAR: Record<string, string> = { cavalry: '骑', infantry: '步', archer: '弓' };
const TYPE_NAME: Record<string, string> = { cavalry: '骑兵', infantry: '步兵', archer: '弓兵' };
const FACTION_CLS: Record<string, string> = { 汉: 'fc-han', 魏: 'fc-wei', 蜀: 'fc-shu', 吴: 'fc-wu', 群: 'fc-qun', 晋: 'fc-jin' };

/** 武将筛选：势力 + 兵种 多选 tag。跨类别（势力×兵种）取交集 AND，同类别多选取并集 OR */
interface HeroFilter {
  faction: Set<string>;
  type: Set<string>;
}
const FACTION_TAGS = ['汉', '魏', '蜀', '吴', '群', '晋'];
const TYPE_TAGS = ['骑', '步', '弓'];

function heroMatchesFilter(hero: HeroJson, sel: HeroFilter, q: string): boolean {
  if (sel.faction.size > 0 && !sel.faction.has(hero.faction)) return false;
  if (sel.type.size > 0 && !sel.type.has(TYPE_CHAR[hero.troopType] ?? '')) return false;
  if (q && !(hero.name.toLowerCase().includes(q) || hero.faction.toLowerCase().includes(q) || hero.tags.join(',').includes(q))) return false;
  return true;
}

/** 筛选栏 HTML（势力 + 兵种 多选） */
function heroFilterHtml(): string {
  const tag = (dim: 'faction' | 'type', v: string) =>
    `<span class="filter-tag" data-dim="${dim}" data-v="${v}">${v}</span>`;
  return `
    <div class="hero-filter">
      <span class="hf-label">势力</span>
      ${FACTION_TAGS.map((t) => tag('faction', t)).join('')}
      <span class="hf-label">兵种</span>
      ${TYPE_TAGS.map((t) => tag('type', t)).join('')}
      <button class="btn ghost hf-reset" type="button">重置</button>
    </div>`;
}

/** 战法筛选：品级与类别各单选，空串=全部，两维同时生效（如 S+指挥） */
interface SkillFilter {
  grade: string;
  type: string;
}

const SKILL_GRADE_TAGS = ['S', 'A', 'B', 'C'] as const;
const SKILL_TYPE_TAGS: Array<[string, string]> = [
  ['passive', '被动'],
  ['command', '指挥'],
  ['active', '主动'],
  ['pursuit', '追击'],
];

/** 品级 + 类别筛选栏 HTML（两行各单选） */
function skillFilterHtml(): string {
  const chip = (dim: 'grade' | 'type', v: string, label: string, on: boolean) =>
    `<span class="tagf${on ? ' on' : ''}" data-dim="${dim}" data-v="${v}">${label}</span>`;
  return `
    <div class="skill-filter">
      <div class="filter-row" data-dim="grade">
        <span class="hf-label">品级</span>
        ${chip('grade', '', '全部', true)}
        ${SKILL_GRADE_TAGS.map((g) => chip('grade', g, g, false)).join('')}
      </div>
      <div class="filter-row" data-dim="type">
        <span class="hf-label">类别</span>
        ${chip('type', '', '全部', true)}
        ${SKILL_TYPE_TAGS.map(([id, name]) => chip('type', id, name, false)).join('')}
      </div>
    </div>`;
}

/** 品级、类别、搜索同时匹配才显示 */
function skillMatchesFilter(id: string, s: Skill, sel: SkillFilter, q: string): boolean {
  if (sel.grade && skillGrade(id) !== sel.grade) return false;
  if (sel.type && s.type !== sel.type) return false;
  if (q && !s.name.toLowerCase().includes(q) && !id.includes(q)) return false;
  return true;
}

/** 绑定品级/类别芯片：同维互斥，异维共存 */
function bindSkillFilter(host: HTMLElement, sel: SkillFilter, redraw: () => void): void {
  host.querySelectorAll('.skill-filter .tagf').forEach((el) => {
    (el as HTMLElement).onclick = () => {
      const dim = (el as HTMLElement).dataset.dim as 'grade' | 'type';
      const v = (el as HTMLElement).dataset.v ?? '';
      sel[dim] = v;
      host.querySelectorAll(`.skill-filter .tagf[data-dim="${dim}"]`).forEach((x) => x.classList.remove('on'));
      (el as HTMLElement).classList.add('on');
      redraw();
    };
  });
}

/** 绑定筛选栏事件（多选 toggle + 重置） */
function bindHeroFilter(host: HTMLElement, sel: HeroFilter, redraw: () => void): void {
  host.querySelectorAll('.filter-tag').forEach((el) => {
    (el as HTMLElement).onclick = () => {
      const dim = (el as HTMLElement).dataset.dim as 'faction' | 'type';
      const v = (el as HTMLElement).dataset.v!;
      const set = sel[dim];
      if (set.has(v)) set.delete(v);
      else set.add(v);
      (el as HTMLElement).classList.toggle('on', set.has(v));
      redraw();
    };
  });
  host.querySelector('.hf-reset')?.addEventListener('click', () => {
    sel.faction.clear();
    sel.type.clear();
    host.querySelectorAll('.filter-tag').forEach((el) => el.classList.remove('on'));
    redraw();
  });
}

/** 战法信息摘要 */
export function skillMeta(s: Skill): string {
  const parts: string[] = [];
  if (s.type === 'active' && s.prepare) parts.push('1回合准备');
  parts.push(`距离${s.range}`);
  if (s.type === 'active' || s.type === 'pursuit') parts.push(`发动率${Math.round(s.triggerRate * 100)}%`);
  if (s.type === 'command') {
    const c = s as Extract<Skill, { type: 'command' }>;
    if (c.phase === 'prep') parts.push('一类指挥');
    else parts.push('二类指挥');
  }
  if (s.type === 'passive') parts.push('被动');
  return parts.join(' · ');
}

/** 配将卡展示顺序：主战法在左，其后为装配战法（添加顺序）。战斗内仍按类型判定。 */
export function slottedSkills(slot: SlotState): Array<{ id: string; main: boolean }> {
  const hero = slot.heroId ? getHeroById(slot.heroId) : undefined;
  const list: Array<{ id: string; main: boolean }> = [];
  if (hero?.mainSkillId && SKILL_REGISTRY[hero.mainSkillId]) {
    list.push({ id: hero.mainSkillId, main: true });
  }
  for (const id of slot.extraSkillIds) {
    if (SKILL_REGISTRY[id]) list.push({ id, main: false });
  }
  return list;
}

/** 同队互斥校验：返回冲突武将名（如有） */
export function mutualConflict(team: SlotState[], heroId: string): string | null {
  const group = getHeroById(heroId)?.mutualExclusionGroup;
  if (!group) return null;
  for (const s of team) {
    if (!s.heroId) continue;
    const g = getHeroById(s.heroId)?.mutualExclusionGroup;
    if (g === group) return getHeroById(s.heroId)!.name;
  }
  return null;
}

// ─── 率土风武将卡 ───

/** 武将卡内部内容（art + plate，不含外层 .hero-card 容器——由调用方包裹，避免嵌套）。
 *  保留 .n/.f/.s 类名供测试与样式使用。 */
function heroCardHtml(hero: HeroJson): string {
  const mainName = hero.mainSkillId ? (SKILL_REGISTRY[hero.mainSkillId]?.name ?? hero.mainSkillName) : hero.mainSkillName || '（无主战法）';
  const art = portraitSrc(hero.id) || '';
  const sp = hero.tags.includes('sp');
  return `
      <div class="art" style="background-image:url('${art}')"></div>
      <div class="plate">
        <div class="n">${hero.name}${sp ? ' <span class="sp-tag">SP</span>' : ''}</div>
        <div class="f">${hero.faction} · ${TYPE_CHAR[hero.troopType] ?? '?'}</div>
        <div class="s">${mainName}</div>
        <div class="stars">★★★★★</div>
      </div>`;
}

/**
 * 战法槽位图标：类型剪影（主动/被动/指挥/追击）+ 品级框 + 品级角标。
 * @param skillId 战法 id
 * @param size 像素边长；`'css'` 时不写内联尺寸，由样式控制（配将卡三列战法位）
 */
function skillIconHtml(skillId: string, size: number | 'css' = 46): string {
  const grade = skillGrade(skillId);
  const dim = size === 'css' ? '' : `style="width:${size}px;height:${size}px"`;
  return `
    <span class="sslot-icon" ${dim}>
      <img class="ti" src="${skillTypeIcon(skillId)}" alt="">
      <img class="kf" src="${gradeFrame(grade)}" alt="">
      <img class="rb" src="${gradeRibbon(grade)}" alt="">
    </span>`;
}

/** 任意等级基础面板（属性 = 初始 + (L-1)×成长，四舍五入）+ 成长 */
function statsAt(hero: HeroJson, level: number): { base: Record<'attack' | 'defense' | 'strategy' | 'speed', number>; grow: Record<'attack' | 'defense' | 'strategy' | 'speed', number> } {
  const grow = {
    attack: hero.growthAttack, defense: hero.growthDefense, strategy: hero.growthStrategy, speed: hero.growthSpeed,
  } as const;
  const base = {
    attack: Math.round(hero.baseAttack + (level - 1) * grow.attack),
    defense: Math.round(hero.baseDefense + (level - 1) * grow.defense),
    strategy: Math.round(hero.baseStrategy + (level - 1) * grow.strategy),
    speed: Math.round(hero.baseSpeed + (level - 1) * grow.speed),
  };
  return { base, grow };
}

// ─── 渲染 ───

export function renderTeamEditor(root: HTMLElement, state: EditorState, h: EditorHandlers): void {
  root.innerHTML = '';
  root.className = 'team-editor';

  root.appendChild(renderTeamPanel('red', '红队', state.red, RED_SLOTS, h, 'my'));
  root.appendChild(renderHeroPool(state, h));
  root.appendChild(renderTeamPanel('blue', '蓝队', state.blue, BLUE_SLOTS, h, 'enemy'));
}

/**
 * 渲染单队面板：标题行含「部队加成」「清空本队」，三槽均分高度，已选卡为紧凑一览（点卡进详情）。
 */
function renderTeamPanel(
  team: 'red' | 'blue',
  title: string,
  slots: SlotState[],
  defs: Array<[string, string]>,
  h: EditorHandlers,
  _side: 'my' | 'enemy'
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = `team-panel ${team}`;

  const head = document.createElement('div');
  head.className = 'team-head';
  const hd = document.createElement('h2');
  hd.textContent = title;
  const actions = document.createElement('div');
  actions.className = 'team-head-actions';
  const bonus = document.createElement('button');
  bonus.className = 'btn ghost team-bonus';
  bonus.type = 'button';
  bonus.textContent = '部队加成';
  bonus.onclick = (e) => {
    e.stopPropagation();
    openTroopBonusPanel(title, slots);
  };
  const clear = document.createElement('button');
  clear.className = 'btn ghost team-clear';
  clear.type = 'button';
  clear.textContent = '清空本队';
  clear.onclick = () => h.onClearTeam(team);
  actions.append(bonus, clear);
  head.appendChild(hd);
  head.appendChild(actions);
  panel.appendChild(head);

  const slotsBox = document.createElement('div');
  slotsBox.className = 'slots';
  slots.forEach((slot, i) => {
    slotsBox.appendChild(renderSlot(team, i, slot, defs[i][0], h));
  });
  panel.appendChild(slotsBox);
  return panel;
}

/**
 * 打开本队「部队加成」弹层（率土手游复刻：三栏并列卡片，无 tab、无底部按钮）：
 * 按当前槽位组装 General，只展示本队阵营/称号/兵种加成。空槽跳过；站位顺序与槽位一致（大营/中军/前锋）。
 */
export function openTroopBonusPanel(teamLabel: string, slots: SlotState[]): void {
  const POS: Array<General['position']> = ['大营', '中军', '前锋'];
  const generals: General[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s.heroId) continue;
    generals.push(
      buildGeneral(s.heroId, s.extraSkillIds, s.freePoints, POS[i], s.redness, s.level, 120)
    );
  }
  const result = computeTroopBonuses(generals);

  // 阵营 / 兵种按人数取多数
  const facCount = new Map<string, number>();
  const troopCount = new Map<TroopType, number>();
  for (const g of generals) {
    facCount.set(g.faction, (facCount.get(g.faction) ?? 0) + 1);
    troopCount.set(g.troopType, (troopCount.get(g.troopType) ?? 0) + 1);
  }
  const mainFaction = [...facCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  const mainTroop = [...troopCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as TroopType | undefined;
  const TROOP_CN: Record<TroopType, string> = { cavalry: '骑兵系', infantry: '步兵系', archer: '弓兵系' };

  const factionLines = result.lines.filter((l) => l.category === 'faction');
  const titleLines = result.lines.filter((l) => l.category === 'title');
  const troopLines = result.lines.filter((l) => l.category === 'troop');

  const heroRows = (lines: typeof factionLines, emptyHint: string): string => {
    if (lines.length === 0) {
      return `<div class="bm-empty">未激活<span>${emptyHint}</span></div>`;
    }
    return generals
      .map((g) => {
        const b: FormationBonus = lines.find((l) => l.unitId === g.id)?.bonuses ?? ZERO_BONUS;
        return `<div class="bm-hero">
          <img class="bm-av" src="${avatarSrc(g.id)}" alt="" onerror="this.style.display='none'" />
          <div class="bm-hero-main">
            <span class="bm-hero-name">${g.name}</span>
            <div class="bm-stats">${statCell('attack', b.attack)}${statCell('strategy', b.strategy)}${statCell('defense', b.defense)}${statCell('speed', b.speed)}</div>
          </div>
        </div>`;
      })
      .join('');
  };

  // 称号卡：已激活 → 称号名 + 武将行；未激活 → 提示文字
  const titleNames = [...new Set(titleLines.map((l) => l.titleName).filter((n): n is string => Boolean(n)))];
  const titleBody =
    titleNames.length > 0
      ? `<div class="bm-title-act">${titleNames.map((n) => `<span class="bm-title-chip">${n}</span>`).join('')}</div>${heroRows(titleLines, '')}`
      : `<div class="bm-hint">配置指定武将组合可激活<span class="bm-hint-link">前往查看 &gt;&gt;</span></div>`;

  const mask = document.createElement('div');
  mask.className = 'bm-mask';
  mask.innerHTML = `
    <div class="bonus-modal">
      <div class="bm-head">
        <span class="bm-title">部队加成</span>
        <span class="bm-close" title="关闭">×</span>
      </div>
      <div class="bm-cols">
        <div class="bm-card">
          <div class="bm-card-head">
            <span class="bm-badge bm-faction-badge">${mainFaction}</span>
            <span class="bm-card-title">阵营加成-${mainFaction}</span>
            <span class="bm-tag battle">战斗中生效</span>
          </div>
          <div class="bm-list">${heroRows(factionLines, '上阵 ≥2 名同阵营武将可触发')}</div>
        </div>
        <div class="bm-card">
          <div class="bm-card-head">
            <span class="bm-badge bm-title-badge">号</span>
            <span class="bm-card-title">称号加成</span>
            <span class="bm-tag global">全局生效</span>
          </div>
          <div class="bm-list">${titleBody}</div>
        </div>
        <div class="bm-card">
          <div class="bm-card-head">
            <span class="bm-badge bm-troop-badge">${BM_HORSE_SVG}</span>
            <span class="bm-card-title">兵种加成-${mainTroop ? TROOP_CN[mainTroop] : '—'}</span>
            <span class="bm-tag battle">战斗中生效</span>
          </div>
          <div class="bm-list">${heroRows(troopLines, '上阵 ≥2 名同兵种武将可触发')}</div>
        </div>
      </div>
    </div>`;
  const close = () => mask.remove();
  mask.querySelector('.bm-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
}

// ─── 部队加成弹窗（率土手游复刻）图标与属性格 ───

const STAT_CN: Record<string, string> = { attack: '攻击', strategy: '谋略', defense: '防御', speed: '速度' };

/** 属性小图标（内联 SVG 线条风，currentColor） */
const BM_STAT_ICONS: Record<string, string> = {
  attack:
    '<svg class="bm-ic" viewBox="0 0 24 24"><path d="M20 4l-9.5 9.5M20 4l-1.4-2.6-2.6 1.4 4 4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10.5 13.5L4.5 19.5l2 2 6-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  strategy:
    '<svg class="bm-ic" viewBox="0 0 24 24"><path d="M12 5C10 3.5 7 3 4 3v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V3c-3 0-6 .5-8 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 5v14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  defense:
    '<svg class="bm-ic" viewBox="0 0 24 24"><path d="M12 2.5l7 3v6.2c0 4.8-3 8-7 9.8-4-1.8-7-5-7-9.8V5.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  speed:
    '<svg class="bm-ic" viewBox="0 0 24 24"><path d="M5 21h9.5c2.2 0 3.2-1.8 3.2-3.6V13c1.6 0 2.6-1.6 2.6-3.2V6.8c0-1.2-1-2.2-2.2-2.2h-3.8c-1.2 0-2.2 1-2.2 2.2V9c0 1 .6 1.8 1.5 2.2L13 13l-2.6 3.6H5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
};

/** 兵种徽章：马头剪影（金色） */
const BM_HORSE_SVG = `<svg class="bm-horse" viewBox="0 0 48 44"><path d="M6 36c0-12 8-22 22-24 1-7 7-10 12-8-3 4-5 7-7 10 9 2 15 9 15 20v2H6z" fill="currentColor"/><circle cx="37" cy="17" r="1.8" fill="#2b1a18"/><path d="M9 34c6-6 13-9 21-9" fill="none" stroke="#2b1a18" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** 属性格：图标 + 绿色加成数字（0 灰显） */
function statCell(key: string, v: number): string {
  const on = v > 0;
  return `<span class="bm-stat${on ? ' on' : ''}" title="${STAT_CN[key]}">${BM_STAT_ICONS[key]}<i>${v > 0 ? '+' + v : v}</i></span>`;
}

/** 槽位卡（左画像右信息）。主站红蓝配将区与伤害测试实验室共用；同时是 Drop-Zone：
 *  武将池卡 → 空槽放入 / 已选槽替换（onPickHero）；已入队卡可再拖：队内换位、跨队移动（onMoveSlot）。 */
export function renderSlot(team: 'red' | 'blue', i: number, slot: SlotState, label: string, h: EditorHandlers): HTMLElement {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.team = team;
  el.dataset.slotIndex = String(i);
  if (slot.heroId) el.dataset.heroId = slot.heroId;

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = isSlotDragEvent(e) ? 'move' : 'copy';
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');
    const payload = resolveHeroDrag(e);
    draggingSlot = null;
    if (!payload) return;
    if (payload.kind === 'slot') h.onMoveSlot(payload.team, payload.idx, team, i);
    else h.onPickHero(team, i, payload.heroId);
  });

  if (!slot.heroId) {
    el.classList.add('empty');
    el.innerHTML = `<span>+ 点击选择 ${label}</span>`;
    el.onclick = () => openHeroPicker(team, i, h);
    return el;
  }

  const hero = getHeroById(slot.heroId)!;
  const portrait = portraitSrc(hero.id);
  const avatar = avatarSrc(hero.id);
  const div = document.createElement('div');
  div.className = 'slot-inner';
  div.innerHTML = `
    <div class="slot-art" style="background-image:url('${portrait}')"></div>
    <div class="slot-main">
      <div class="hero-line">
        <span class="slot-label">${label}</span>
        <img class="slot-avatar" src="${avatar}" alt="" onerror="this.style.display='none'" />
        <span class="hero-name">${hero.name}${hero.tags.includes('sp') ? ' <span class="sp-tag">SP</span>' : ''}</span>
      </div>
      <div class="slot-sub">
        <div class="hero-stars" title="红度 ${slot.redness}/5">${rednessStars(slot.redness)}</div>
        <div class="hero-meta">${hero.faction} · ${TYPE_NAME[hero.troopType] ?? ''} · 距离${hero.attackRange} · ${slot.level}级 · 兵力${troopCapacity(slot.level, slot.redness)}</div>
      </div>
      <div class="hero-skills"></div>
    </div>
  `;
  const skillBox = div.querySelector('.hero-skills')!;
  const slotted = slottedSkills(slot);
  if (slotted.length === 0) {
    skillBox.innerHTML = `<span class="tip">无战法（主战法未实现）</span>`;
  } else {
    for (const x of slotted) {
      const s = SKILL_REGISTRY[x.id];
      const grade = skillGrade(x.id).toLowerCase();
      const item = document.createElement('div');
      item.className = `slot-skill grade-${grade}${x.main ? ' main' : ''}`;
      item.title = s.name;
      item.innerHTML = `${skillIconHtml(x.id, 'css')}<span class="slot-skill-name">${s.name}</span>`;
      skillBox.appendChild(item);
    }
  }
  el.appendChild(div);
  el.querySelectorAll('img').forEach((img) => { img.draggable = false; });

  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    suppressSlotClick = false;
    draggingSlot = { kind: 'slot', team, idx: i, heroId: slot.heroId! };
    const payload = JSON.stringify(draggingSlot);
    e.dataTransfer?.setData('text/plain', payload);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    draggingSlot = null;
    el.classList.remove('dragging');
    suppressSlotClick = true;
    setTimeout(() => { suppressSlotClick = false; }, 0);
  });
  el.addEventListener('click', () => {
    if (suppressSlotClick) return;
    openHeroDetail(hero.id, { placed: { team, idx: i, slot }, handlers: h });
  });
  return el;
}

/** 武将池（含搜索/筛选/详情弹窗），供主站与伤害测试实验室复用。
 *  池内卡可拖入槽位；已入队卡可拖回本池卸下（onRemoveHero）。 */
export function renderHeroPool(state: EditorState, h: EditorHandlers): HTMLElement {
  const pool = document.createElement('div');
  pool.className = 'hero-pool';
  pool.innerHTML = `
    <div class="toolbar">
      <input type="text" placeholder="搜索武将名 / 势力 / SP…" />
    </div>
    ${heroFilterHtml()}
    <div class="hero-grid"></div>
  `;
  const input = pool.querySelector('input') as HTMLInputElement;
  const grid = pool.querySelector('.hero-grid') as HTMLElement;
  const selected: HeroFilter = { faction: new Set(), type: new Set() };

  const picked = new Set<string>();
  for (const team of [state.red, state.blue]) for (const s of team) if (s.heroId) picked.add(s.heroId);

  pool.addEventListener('dragover', (e) => {
    if (!isSlotDragEvent(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    pool.classList.add('drag-over');
  });
  pool.addEventListener('dragleave', (e) => {
    if (e.relatedTarget instanceof Node && pool.contains(e.relatedTarget)) return;
    pool.classList.remove('drag-over');
  });
  pool.addEventListener('drop', (e) => {
    e.preventDefault();
    pool.classList.remove('drag-over');
    const payload = resolveHeroDrag(e);
    draggingSlot = null;
    if (payload?.kind === 'slot') h.onRemoveHero(payload.team, payload.idx);
  });

  const draw = () => {
    grid.innerHTML = '';
    const q = input.value.trim().toLowerCase();
    for (const hero of HEROES) {
      if (!heroMatchesFilter(hero, selected, q)) continue;
      const card = document.createElement('div');
      card.className = 'hero-card' + (picked.has(hero.id) ? ' picked' : '');
      card.innerHTML = heroCardHtml(hero);
      card.title = `${hero.skillDesc || ''}`;
      card.draggable = true;
      card.dataset.heroId = hero.id;
      card.addEventListener('dragstart', (e) => {
        draggingSlot = null;
        e.dataTransfer?.setData('text/plain', hero.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      card.onclick = () => {
        openHeroDetail(hero.id, { pool: true, handlers: h });
      };
      grid.appendChild(card);
    }
  };
  input.addEventListener('input', draw);
  bindHeroFilter(pool, selected, draw);
  draw();
  return pool;
}

// ─── 武将详情页（率土风：左画像 / 右数据+加点+兵种转换；下方三战法栏） ───

interface DetailOpts {
  /** 已放入阵容：可编辑加点/红度/战法 */
  placed?: { team: 'red' | 'blue'; idx: number; slot: SlotState };
  /** 从武将选择弹窗进入：底部显示「放入此槽位」 */
  target?: { team: 'red' | 'blue'; idx: number };
  /** 从武将池进入：底部显示「放入阵容」 */
  pool?: boolean;
  handlers: EditorHandlers;
}

const STAT_NAMES: Array<[keyof SlotState['freePoints'], string]> = [
  ['attack', '攻击'], ['defense', '防御'], ['strategy', '谋略'], ['speed', '速度'],
];

export function openHeroDetail(heroId: string, opts: DetailOpts): void {
  const hero = getHeroById(heroId)!;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal hero-detail-modal';
  modal.innerHTML = `
    <div class="m-head"><h3><img class="modal-avatar" src="${avatarSrc(heroId)}" alt="" onerror="this.style.display='none'" />武将详情 · ${hero.name}</h3><span class="m-close">×</span></div>
    <div class="m-body hd-body"></div>
    <div class="m-foot hd-foot"></div>
  `;
  mask.appendChild(modal);
  document.body.appendChild(mask);

  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });

  const body = modal.querySelector('.hd-body') as HTMLElement;
  const foot = modal.querySelector('.hd-foot') as HTMLElement;
  const placed = opts.placed;
  const editable = !!placed;
  const slot = placed?.slot ?? emptySlot();
  const h = opts.handlers;

  const redraw = () => {
    body.innerHTML = heroDetailBody(hero, slot, { editable, placeTarget: opts.target ? slotLabel(opts.target.team, opts.target.idx) : null });
    foot.innerHTML = '';
    bindBodyEvents();
    bindFooter();
  };

  /** 详情主体：左画像 + 右数据 + 三战法栏（说明文案已去掉，避免弹窗出现滚动条）。 */
  const heroDetailBody = (hero: HeroJson, s: SlotState, cfg: { editable: boolean; placeTarget: string | null }): string => {
    const { base, grow } = statsAt(hero, s.level);
    const r = s.redness;
    const budget = freePointBudget(heroId, r, s.level);
    const used = STAT_NAMES.reduce((a, [k]) => a + (s.freePoints[k] ?? 0), 0);
    const remain = Math.max(0, budget - used);
    const sp = hero.tags.includes('sp');
    const troops = troopCapacity(s.level, r);

    const statRows = STAT_NAMES.map(([k, name]) => {
      const v = base[k] + (s.freePoints[k] ?? 0);
      return `
        <div class="stat-row">
          <span class="k">${name}</span>
          <span class="v">${v}</span>
          <span class="g">（+${grow[k].toFixed(2)}）</span>
        </div>`;
    }).join('');

    const pointsInputs = STAT_NAMES.map(([k, name]) => `
      <label>${name} <input type="number" min="0" max="${budget}" value="${s.freePoints[k] ?? 0}" data-k="${k}" ${cfg.editable ? '' : 'disabled'}></label>
    `).join('');

    const mainSkill = hero.mainSkillId && SKILL_REGISTRY[hero.mainSkillId] ? hero.mainSkillId : null;
    const mainSkillEl = mainSkill
      ? skillSlotHtml(mainSkill, true, `${SKILL_REGISTRY[mainSkill].name}（主战法）`)
      : `<div class="skill-slot-row main disabled"><span class="tip">主战法未实现</span></div>`;

    const equips = [0, 1].map((i) => {
      const sid = s.extraSkillIds[i];
      if (!sid) {
        const canAdd = s.extraSkillIds.length < 2;
        return `
          <div class="skill-slot-row add ${cfg.editable && canAdd ? '' : 'disabled'}" data-slot="${i}" title="${cfg.editable ? '装配战法' : '放入阵容后可装配'}">
            <span class="sslot-add">＋</span>
            <span class="sslot-empty-tip">未装配</span>
          </div>`;
      }
      const sk = SKILL_REGISTRY[sid];
      return `
        <div class="skill-slot-row equipped" data-skill="${sid}" data-slot="${i}" title="点击查看「${sk.name}」详情">
          <span class="sslot-rm" data-rm="${sid}" title="卸下战法">−</span>
          ${skillIconHtml(sid)}
          <span class="sslot-name">${sk.name}</span>
          <span class="sslot-type">${SKILL_TYPE_NAME[sk.type]}</span>
        </div>`;
    }).join('');

    const troopBoxes = ['骑', '步', '弓'].map((c) => {
      const cur = c === TYPE_CHAR[hero.troopType];
      return `<span class="troop-box ${cur ? 'cur' : ''}" title="${c === '骑' ? '骑兵' : c === '步' ? '步兵' : '弓兵'}">${c}</span>`;
    }).join('');

    return `
      <div class="hd-layout">
        <div class="hd-left">
          <div class="hd-portrait">
            <img src="${portraitSrc(heroId)}" alt="${hero.name}" onerror="this.style.display='none'" />
            <div class="hd-stars" title="红度 ${r}/5（每红 +10 自由属性点）">${rednessStars(r)}</div>
          </div>
        </div>
        <div class="hd-right">
          <div class="hd-head">
            <span class="hd-name">${hero.name}${sp ? ' <span class="sp-tag">SP</span>' : ''}</span>
            <span class="faction-badge ${FACTION_CLS[hero.faction] ?? ''}">${hero.faction}</span>
            <span class="type-badge">${TYPE_CHAR[hero.troopType] ?? '?'}</span>
            <span class="hd-level">${s.level}级${isFemale(heroId) ? ' · 女性' : ''}</span>
          </div>
          <div class="hd-level-row" title="等级 40~50，属性随成长率更新；携带兵力 = 等级×100 + 5000 + 红度×200">
            <span class="lbl">等级</span>
            <input type="number" min="40" max="50" value="${s.level}" data-level="1" ${cfg.editable ? '' : 'disabled'}>
            <span class="hd-troops">携带兵力 <b>${troops}</b><i class="tip">${s.level}×100+5000+${r}×200</i></span>
          </div>
          <div class="hd-redness">
            <span class="lbl">红度</span>
            <span class="redness-pick" title="点击设置红度（每红 +10 自由属性点 +200 携带兵力，满红 +50 点 +1000 兵）">
              ${[1, 2, 3, 4, 5].map((i) => `<i class="rstars ${i <= r ? 'on' : ''}" data-r="${i}">★</i>`).join('')}
            </span>
            <span class="hd-budget">自由属性剩余 <b>${remain}</b> / ${budget} 点${r > 0 ? ` <i class="red-extra">（含红度 +${r * 10}）</i>` : ''}</span>
          </div>
          <div class="hd-stats">${statRows}</div>
          <div class="hd-points">
            <div class="points-title">自由属性分配 ${cfg.editable ? '' : '<span class="tip">（放入阵容后可分配）</span>'}</div>
            <div class="points-inputs">${pointsInputs}</div>
          </div>
          <div class="hd-troop">
            <div class="points-title">兵种转换 <span class="tip">（未开放）</span></div>
            <div class="troop-boxes">${troopBoxes}</div>
          </div>
        </div>
      </div>
      <div class="hd-skills">
        <div class="skills-title">战法</div>
        <div class="skills-row">${mainSkillEl}${equips}</div>
      </div>
    `;
  };

  const skillSlotHtml = (sid: string, main: boolean, tip: string): string => {
    const sk = SKILL_REGISTRY[sid];
    return `
      <div class="skill-slot-row ${main ? 'main' : ''}" data-skill="${sid}" title="${tip}">
        ${skillIconHtml(sid)}
        <span class="sslot-name">${main ? '主·' : ''}${sk.name}</span>
        <span class="sslot-type">${SKILL_TYPE_NAME[sk.type]}</span>
      </div>`;
  };

  const slotLabel = (team: 'red' | 'blue', idx: number): string => {
    const defs = team === 'red' ? RED_SLOTS : BLUE_SLOTS;
    return `${team === 'red' ? '红队' : '蓝队'}·${defs[idx][0]}`;
  };

  const bindBodyEvents = () => {
    // 红度
    body.querySelectorAll('.redness-pick i').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        if (!editable) { showNotice('放入阵容后可设置红度'); return; }
        const r = Number((el as HTMLElement).dataset.r);
        const next = r === slot.redness && r === 1 ? 0 : r;
        h.onSetRedness(placed!.team, placed!.idx, next);
        redraw();
      };
    });
    // 等级（40~50）：属性随成长率更新、携带兵力按公式自动重算
    const levelInp = body.querySelector('[data-level]') as HTMLInputElement | null;
    levelInp?.addEventListener('change', () => {
      if (!editable) return;
      const v = Math.max(40, Math.min(50, Math.floor(Number(levelInp.value) || 40)));
      h.onSetLevel(placed!.team, placed!.idx, v);
      redraw();
    });
    // 加点
    body.querySelectorAll('.points-inputs input').forEach((inp) => {
      (inp as HTMLInputElement).addEventListener('change', () => {
        if (!editable) return;
        const k = (inp as HTMLElement).dataset.k as keyof SlotState['freePoints'];
        const v = Math.max(0, Math.min(freePointBudget(heroId, slot.redness, slot.level), Number((inp as HTMLInputElement).value) || 0));
        h.onSetFreePoints(placed!.team, placed!.idx, k, v);
        redraw();
      });
    });
    // 主战法 / 已装战法 → 点击查看战法详情
    body.querySelectorAll('.skill-slot-row.main:not(.disabled), .skill-slot-row.equipped').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const sid = (el as HTMLElement).dataset.skill;
        if (sid) openSkillDetail(sid);
      };
    });
    // 已装战法右上角「−」→ 卸下
    body.querySelectorAll('.sslot-rm').forEach((el) => {
      (el as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        const sid = (el as HTMLElement).dataset.rm!;
        h.onRemoveSkill(placed!.team, placed!.idx, sid);
        redraw();
      };
    });
    // 空战法槽 → 战法库
    body.querySelectorAll('.skill-slot-row.add:not(.disabled)').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        openSkillPicker(placed!.team, placed!.idx, slot, (sid) => {
          h.onAddSkill(placed!.team, placed!.idx, sid);
          redraw();
        });
      };
    });
  };

  const bindFooter = () => {
    if (opts.target) {
      const b = document.createElement('button');
      b.className = 'btn btn-place';
      b.textContent = `放入：${slotLabel(opts.target.team, opts.target.idx)}`;
      b.onclick = () => { h.onPickHero(opts.target!.team, opts.target!.idx, heroId); close(); };
      foot.appendChild(b);
    } else if (opts.pool) {
      const b = document.createElement('button');
      b.className = 'btn btn-place';
      b.textContent = '放入阵容';
      b.onclick = () => openPlacePicker(heroId, (team, idx) => { h.onPickHero(team, idx, heroId); close(); });
      foot.appendChild(b);
    }
    if (placed) {
      const rm = document.createElement('button');
      rm.className = 'btn ghost rm-hero';
      rm.style.marginRight = '10px';
      rm.textContent = '移除武将';
      rm.onclick = () => { h.onRemoveHero(placed!.team, placed!.idx); close(); };
      foot.appendChild(rm);
    }
    const done = document.createElement('button');
    done.className = 'btn ghost done';
    done.textContent = '完成';
    done.onclick = close;
    foot.appendChild(done);
  };

  redraw();
}

/** 战法详情弹窗：图标 + 品级 + 属性（类型/距离/发动率/目标）+ 官方描述（1级/满级） */
export function openSkillDetail(skillId: string): void {
  const s = SKILL_REGISTRY[skillId];
  if (!s) return;
  const grade = skillGrade(skillId);
  const info = SKILL_DESCS[skillId];
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal skill-detail-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>战法详情</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="sd-head">
        ${skillIconHtml(skillId, 64)}
        <div class="sd-title">
          <div class="sd-name">${s.name}<i class="grade grade-${grade.toLowerCase()}">${grade}</i></div>
          <div class="sd-meta">${SKILL_TYPE_NAME[s.type]} · ${skillMeta(s)}${info?.targetType ? ` · 目标：${info.targetType}` : ''}</div>
        </div>
      </div>
      <div class="sd-desc">
        <div class="sd-desc-title">满级效果</div>
        <p>${info?.desc || '（暂无官方描述）'}</p>
        ${info?.desc1 && info.desc1 !== info.desc ? `<div class="sd-desc-title lv1">1级效果</div><p>${info.desc1}</p>` : ''}
      </div>
    </div>
    <div class="m-foot"><button class="btn ghost done">完成</button></div>
  `;
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  (modal.querySelector('.done') as HTMLElement).onclick = close;
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
}

// ─── 武将放置弹窗：选队伍 + 槽位（互斥校验由上层 onPickHero 处理并提示） ───

function openPlacePicker(heroId: string, onPlace: (team: 'red' | 'blue', idx: number) => void): void {
  const hero = getHeroById(heroId)!;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = 'min(560px, 92vw)';

  let html = `
    <div class="m-head"><h3><img class="modal-avatar" src="${avatarSrc(hero.id)}" alt="" onerror="this.style.display='none'" />将「${hero.name}」放入哪个位置？</h3><span class="m-close">×</span></div>
    <div class="m-body">
  `;
  const pickSide = (team: 'red' | 'blue') => {
    html += `<div style="margin: 10px 0 4px; font-size: 13px; color:${team === 'red' ? '#c74e3f' : '#5d8ac2'}; font-weight:600">${team === 'red' ? '红队' : '蓝队'}</div>`;
    const defs = team === 'red' ? RED_SLOTS : BLUE_SLOTS;
    for (const [label] of defs) {
      html += `<button class="btn ghost place-btn" data-team="${team}" data-label="${label}" style="margin:2px;width:104px">${label}</button>`;
    }
  };
  pickSide('red');
  pickSide('blue');
  html += `</div>`;
  modal.innerHTML = html;

  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  modal.querySelectorAll('.place-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const team = (b as HTMLElement).dataset.team as 'red' | 'blue';
      const label = (b as HTMLElement).dataset.label!;
      const idx = (team === 'red' ? RED_SLOTS : BLUE_SLOTS).findIndex((d) => d[0] === label);
      onPlace(team, idx);
      close();
    });
  });
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
}

/** 战法库弹窗：搜索 + 品级/类别筛选 + 已装配置灰 */
function openSkillPicker(team: 'red' | 'blue', slotIndex: number, slot: SlotState, onPick: (skillId: string) => void): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="m-head"><h3>装配战法（${getHeroById(slot.heroId!)!.name}）</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="pick-toolbar">
        <input type="text" placeholder="搜索战法名…" />
      </div>
      ${skillFilterHtml()}
      <div class="skill-pick-list"></div>
    </div>
  `;

  const input = modal.querySelector('input') as HTMLInputElement;
  const listBox = modal.querySelector('.skill-pick-list') as HTMLElement;
  const sel: SkillFilter = { grade: '', type: '' };

  const used = new Set<string>();
  const hero = getHeroById(slot.heroId!)!;
  if (hero.mainSkillId) used.add(hero.mainSkillId);
  slot.extraSkillIds.forEach((id) => used.add(id));

  const draw = () => {
    listBox.innerHTML = '';
    const q = input.value.trim().toLowerCase();
    /** 只列出可携带通用战法，不含任何武将主战法（与战法背包一致） */
    const entries = Object.entries(SKILL_REGISTRY).filter(([id]) => !isMainSkill(id) && isLearnableSkillListed(id));
    for (const [id, s] of entries) {
      if (!skillMatchesFilter(id, s, sel, q)) continue;
      const item = document.createElement('div');
      item.className = 'skill-pick-item' + (used.has(id) ? ' used' : '');
      const tags = s.tags.length ? ` · ${s.tags.join(',')}` : '';
      item.innerHTML = `
        <div class="pick-line">
          ${skillIconHtml(id, 34)}
          <div class="pick-info">
            <div class="sn">${s.name}<i class="grade grade-${skillGrade(id).toLowerCase()}">${skillGrade(id)}</i></div>
            <div class="sm">${SKILL_TYPE_NAME[s.type]} · ${skillMeta(s)}${tags}</div>
          </div>
        </div>
      `;
      item.onclick = () => {
        if (used.has(id)) return;
        onPick(id);
        close();
      };
      listBox.appendChild(item);
    }
  };
  input.addEventListener('input', draw);
  bindSkillFilter(modal, sel, draw);
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
  draw();
}

/** 武将选择弹窗（槽位点击时打开）：搜索 + 列表；点击武将 → 详情页 → 放入。供主站与伤害测试实验室复用 */
export function openHeroPicker(team: 'red' | 'blue', slotIndex: number, h: EditorHandlers): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="m-head"><h3>选择武将</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="pick-toolbar"><input type="text" placeholder="搜索武将名 / 势力 / SP…" /></div>
      ${heroFilterHtml()}
      <div class="pick-grid"></div>
    </div>
  `;
  const input = modal.querySelector('input') as HTMLInputElement;
  const grid = modal.querySelector('.pick-grid') as HTMLElement;
  const selected: HeroFilter = { faction: new Set(), type: new Set() };
  const draw = () => {
    grid.innerHTML = '';
    const q = input.value.trim().toLowerCase();
    for (const hero of HEROES) {
      if (!heroMatchesFilter(hero, selected, q)) continue;
      const card = document.createElement('div');
      card.className = 'hero-card';
      card.innerHTML = heroCardHtml(hero);
      card.onclick = () => { close(); openHeroDetail(hero.id, { target: { team, idx: slotIndex }, handlers: h }); };
      grid.appendChild(card);
    }
  };
  input.addEventListener('input', draw);
  bindHeroFilter(modal, selected, draw);
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
  draw();
}

// ─── 战法背包（可携带战法一览，武将主战法除外）───

export function openSkillBag(): void {
  const bagSkills = Object.entries(SKILL_REGISTRY).filter(([id]) => !isMainSkill(id) && isLearnableSkillListed(id));
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal bag-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>战法背包</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="pick-toolbar"><input type="text" placeholder="搜索战法名…" /></div>
      ${skillFilterHtml()}
      <div class="bag-grid"></div>
      <div class="bag-note"></div>
    </div>
  `;
  const input = modal.querySelector('input') as HTMLInputElement;
  const grid = modal.querySelector('.bag-grid') as HTMLElement;
  const note = modal.querySelector('.bag-note') as HTMLElement;
  const sel: SkillFilter = { grade: '', type: '' };

  const draw = () => {
    grid.innerHTML = '';
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const [id, s] of bagSkills) {
      if (!skillMatchesFilter(id, s, sel, q)) continue;
      shown += 1;
      const item = document.createElement('div');
      item.className = 'bag-item';
      item.innerHTML = `
        ${skillIconHtml(id, 44)}
        <div class="bag-info">
          <div class="bag-name">${s.name}<i class="grade grade-${skillGrade(id).toLowerCase()}">${skillGrade(id)}</i></div>
          <div class="bag-meta">${SKILL_TYPE_NAME[s.type]} · ${skillMeta(s)}</div>
        </div>
      `;
      item.onclick = () => openSkillDetail(id);
      grid.appendChild(item);
    }
    note.textContent = shown === bagSkills.length
      ? `共 ${bagSkills.length} 种可装配战法（武将主战法除外），点击查看详情`
      : `显示 ${shown} / ${bagSkills.length} 种可装配战法`;
  };
  input.addEventListener('input', draw);
  bindSkillFilter(modal, sel, draw);
  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
  draw();
}

// ─── 战报历史（已模拟的战斗记录 + 详情）───

export interface BattleRecord {
  id: string;
  ts: number;
  label: string;
  result: 'win' | 'loss' | 'draw';
  rounds: number;
  seed: number;
  /** 红队武将名（按槽位） */
  myTeam: string[];
  /** 蓝队武将名（按槽位） */
  enemyTeam: string[];
  report: BattleReport;
}

const RESULT_LABEL: Record<string, string> = { win: '红胜', loss: '蓝胜', draw: '平局' };

export function openHistoryPanel(records: BattleRecord[], onClear?: () => void, onReuse?: (report: BattleReport) => void): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal history-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>战报</h3><span class="m-close">×</span></div>
    <div class="m-body history-body">
      <div class="hist-list"></div>
      <div class="hist-detail">
        <div class="hist-empty">从左侧选择一场战斗查看详情</div>
      </div>
    </div>
    <div class="m-foot">
      <button class="btn ghost hist-clear" type="button">清空战报</button>
      <button class="btn ghost done">完成</button>
    </div>
  `;
  const list = modal.querySelector('.hist-list') as HTMLElement;
  const detail = modal.querySelector('.hist-detail') as HTMLElement;

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  const renderList = () => {
    list.innerHTML = '';
    if (records.length === 0) {
      list.innerHTML = `<div class="hist-empty">暂无战报，先进行一场模拟</div>`;
      return;
    }
    records.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'hist-item';
      item.innerHTML = `
        <div class="hi-head">
          <span class="hi-time">${fmtTime(r.ts)}</span>
          <span class="hi-res ${r.result}">${RESULT_LABEL[r.result]}</span>
          <span class="hi-rounds">${r.rounds}回合</span>
        </div>
        <div class="hi-teams">
          <span class="hi-red">${r.myTeam.join('、') || '空缺'}</span>
          <span class="hi-vs">vs</span>
          <span class="hi-blue">${r.enemyTeam.join('、') || '空缺'}</span>
        </div>
      `;
      item.onclick = () => {
        list.querySelectorAll('.hist-item').forEach((x) => x.classList.remove('on'));
        item.classList.add('on');
        renderDetail(r);
      };
      list.appendChild(item);
    });
    // 默认选中最新一条
    (list.querySelector('.hist-item') as HTMLElement)?.click();
  };

  const renderDetail = (r: BattleRecord) => {
    detail.innerHTML = '';
    // 优先展示简略战报（武将画像 + 总兵力条），可切换「统计」「展开详细战报」；「复用队伍」把本场配置复制到红蓝两侧
    const wrap = document.createElement('div');
    wrap.className = 'hist-detail-summary';
    wrap.appendChild(createBattleSummary(r.report));

    const bar = document.createElement('div');
    bar.className = 'hist-actions';

    const btnStats = document.createElement('button');
    btnStats.className = 'btn ghost';
    btnStats.textContent = '统计';
    btnStats.onclick = () => {
      detail.innerHTML = '';
      const back = document.createElement('button');
      back.className = 'btn ghost expand-btn';
      back.textContent = '返回简略战报 ▴';
      back.onclick = () => renderDetail(r);
      detail.appendChild(back);
      detail.appendChild(createStatsView(r.report));
    };

    const btnReuse = document.createElement('button');
    btnReuse.className = 'btn';
    btnReuse.textContent = '复用队伍';
    btnReuse.title = '将本场红蓝双方的武将、战法与加点复制到配将区，便于快速实验';
    btnReuse.onclick = () => {
      onReuse?.(r.report);
      close();
    };

    const btnExpand = document.createElement('button');
    btnExpand.className = 'btn ghost';
    btnExpand.textContent = '展开详细战报 ▾';
    btnExpand.onclick = () => {
      detail.innerHTML = '';
      const d2 = document.createElement('div');
      d2.appendChild(createBattleView(r.report).el);
      const collapse = document.createElement('button');
      collapse.className = 'btn ghost expand-btn';
      collapse.textContent = '收起详细战报 ▴';
      collapse.onclick = () => renderDetail(r);
      detail.appendChild(collapse);
      detail.appendChild(d2);
    };

    bar.appendChild(btnStats);
    bar.appendChild(btnReuse);
    bar.appendChild(btnExpand);
    wrap.appendChild(bar);
    detail.appendChild(wrap);
  };

  const close = () => mask.remove();
  modal.querySelector('.m-close')!.addEventListener('click', close);
  (modal.querySelector('.done') as HTMLElement).onclick = close;
  (modal.querySelector('.hist-clear') as HTMLElement).onclick = () => {
    if (records.length === 0) return;
    records.length = 0;
    onClear?.();
    detail.innerHTML = `<div class="hist-empty">从左侧选择一场战斗查看详情</div>`;
    renderList();
  };
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
  renderList();
}
