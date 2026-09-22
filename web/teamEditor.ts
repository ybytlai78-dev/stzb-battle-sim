/**
 * 选将 + 配战法 UI（纯 DOM，无框架）
 * 布局：红队（左，大营/中军/前锋）｜武将池｜蓝队（右，前锋/中军/大营）
 * 点击武将 → 率土风武将详情页（左画像右数据：四维+成长 / 加点 / 红度 / 兵种转换占位 / 三战法栏）
 * 战法判定顺序：被动 > 指挥 > 主动 > 追击；同类型内主战法先判定、装配战法按添加顺序。
 */
import { HEROES, SLOTTED_HEROES, OFFLINE_HEROES, offlineReason, getHeroById, SKILL_TYPE_NAME, avatarSrc, portraitSrc, isFemale, freePointBudget, troopCapacity, skillGrade, skillTypeIcon, gradeFrame, gradeRibbon, gradePlate, SKILL_DESCS, isMainSkill, isLearnableSkillListed, rednessStars, buildGeneral, TROOP_CHAR as TYPE_CHAR, factionIconSrc, cardFrameSrc } from './heroes';
import type { HeroJson } from './heroes';
import pinyinJson from './data/pinyin.json';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES, TREASURES_BY_ID, AFFIXES } from '../src/data/treasures';
import type { TreasureDef, AffixDef } from '../src/data/treasures';
import type { General, Skill, TroopType, FormationBonus, TreasureLoadout } from '../src/engine/types';
import type { BattleReport } from '../src/engine/types';
import { computeTroopBonuses, ZERO_BONUS } from '../src/engine/troopBonus';
import {
  SECONDARY_TROOPS,
  TRAIT_SLOTS_MAX,
  traitsFor,
  type GeneralTrait,
  type SecondaryTroopType,
} from '../src/engine/secondaryTroop';
import { HERO_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { showNotice } from './notice';
import { createBattleView } from './battleView';
import { createBattleSummary, createStatsView } from './battleSummary';
import { asset } from './assets';

/** 词条数值档位（与官方/社区口径一致）：红 = 达到上限档，粉 = 高于蓝区上限，其余为蓝 */
export type AffixTier = 'blue' | 'pink' | 'red';

/** 按玩家选定数值自动判定蓝/粉/红（上限档无数据时只分蓝/粉） */
export function affixTier(a: AffixDef, value: number): AffixTier {
  const h = a.hint;
  if (!h) return 'blue';
  if (h.red != null && value >= h.red) return 'red';
  if (value > h.blueMax) return 'pink';
  return 'blue';
}

export const AFFIX_TIER_NAME: Record<AffixTier, string> = { blue: '蓝', pink: '粉', red: '红' };

export interface SlotState {
  heroId: string | null;
  /** 装配战法 id（不含主战法），同类型按数组顺序判定 */
  extraSkillIds: string[];
  freePoints: { attack: number; defense: number; strategy: number; speed: number };
  /** 红度 0-5（五星武将满红五红；每红 +10 自由属性点 +200 携带兵力） */
  redness: number;
  /** 等级 40~50（属性随成长率更新；携带兵力 = 等级×100+5000+红度×200） */
  level: number;
  /**
   * 二级兵种转换（高级兵种，可选）：只能取该武将的两个转换方向之一；
   * undefined = 未转换（沿用基础兵种）。见 `docs/兵种转换调研.md`。
   */
  secondaryTroop?: SecondaryTroopType;
  /** 已学兵系通用特性（0~2 个，须属于该二级兵种的兵系池；见 TRAIT_SLOTS_MAX） */
  secondaryTraits?: GeneralTrait[];
  /**
   * 佩戴的宝物（率土宝物系统，见 `src/data/treasures.ts`）：
   * 默认 10 级（一阶/二阶特效 = 官方值 × 5、三阶固定）；`affix` 为锻造词条 + 玩家自选数值。
   */
  treasure: TreasureLoadout | null;
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
  /** 设置/清除二级兵种转换（undefined = 转回基础兵种）；切换兵种会清空已学通用特性 */
  onSetSecondaryTroop: (team: 'red' | 'blue', slotIndex: number, troop: SecondaryTroopType | undefined) => void;
  /** 切换某个通用特性栏（slot: 0/1；trait = undefined 表示清空该栏） */
  onSetSecondaryTrait: (team: 'red' | 'blue', slotIndex: number, slot: number, trait: GeneralTrait | undefined) => void;
  /** 写入/清除佩戴的宝物（null = 卸下） */
  onSetTreasure: (team: 'red' | 'blue', slotIndex: number, treasure: TreasureLoadout | null) => void;
  /**
   * 保存本队为阵容预设（可选：未提供时不渲染「保存预设」按钮）。
   * 由上层（main.ts）打开命名弹窗并写入 localStorage 存档；见 `web/presetStore.ts`。
   */
  onSavePreset?: (team: 'red' | 'blue') => void;
  onRemoveHero: (team: 'red' | 'blue', slotIndex: number) => void;
  onClearTeam: (team: 'red' | 'blue') => void;
}

export const emptySlot = (): SlotState => ({ heroId: null, extraSkillIds: [], freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 }, redness: 0, level: 40, treasure: null });

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

const TYPE_NAME: Record<string, string> = { cavalry: '骑兵', infantry: '步兵', archer: '弓兵' };
const FACTION_CLS: Record<string, string> = { 汉: 'fc-han', 魏: 'fc-wei', 蜀: 'fc-shu', 吴: 'fc-wu', 群: 'fc-qun', 晋: 'fc-jin' };

/** 武将筛选：势力 + 兵种 多选 tag。跨类别（势力×兵种）取交集 AND，同类别多选取并集 OR */
interface HeroFilter {
  faction: Set<string>;
  type: Set<string>;
}
const FACTION_TAGS = ['汉', '魏', '蜀', '吴', '群', '晋'];
const TYPE_TAGS = ['骑', '步', '弓'];

/** 拼音检索表（`scripts/gen_pinyin.mjs` 生成）：i = 首字母串，f = 全拼（ü 统一记作 v） */
const PINYIN: Record<string, { i: string; f: string }> = pinyinJson as Record<string, { i: string; f: string }>;

/** 查询是否命中拼音：首字母前缀（l → 吕布/刘备）或全拼包含（lubu / lvbu → 吕布） */
function pinyinHit(id: string, q: string): boolean {
  const p = PINYIN[id];
  if (!p) return false;
  if (p.i.startsWith(q)) return true;
  const qv = q.replace(/ü/g, 'v');
  return p.f.includes(qv) || p.f.replace(/v/g, 'u').includes(qv);
}

function heroMatchesFilter(hero: HeroJson, sel: HeroFilter, q: string): boolean {
  if (sel.faction.size > 0 && !sel.faction.has(hero.faction)) return false;
  if (sel.type.size > 0 && !sel.type.has(TYPE_CHAR[hero.troopType] ?? '')) return false;
  if (
    q &&
    !(
      hero.name.toLowerCase().includes(q) ||
      hero.faction.toLowerCase().includes(q) ||
      hero.tags.join(',').includes(q) ||
      pinyinHit(hero.id, q)
    )
  )
    return false;
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

/**
 * 战法信息摘要芯片。
 * 准备主动用 `prepareTurns ?? 1`，避免长坂之吼等 2 回合准备被写成「1回合准备」。
 */
export function skillMeta(s: Skill): string {
  const parts: string[] = [];
  if (s.type === 'active' && s.prepare) parts.push(`${s.prepareTurns ?? 1}回合准备`);
  parts.push(`距离${s.range}`);
  if (s.type === 'active' || s.type === 'pursuit') {
    const tr = Array.isArray(s.triggerRate) ? s.triggerRate[0] : s.triggerRate;
    parts.push(`发动率${Math.round(tr * 100)}%`);
  }
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

/** 主战法显示名（未实装 / 无主战法时给可读占位）。**只用于卡片 title 悬浮提示，不画进卡面** */
export function heroMainSkillName(hero: HeroJson): string {
  return hero.mainSkillId ? (SKILL_REGISTRY[hero.mainSkillId]?.name ?? hero.mainSkillName) : hero.mainSkillName || '（无主战法）';
}

/** 武将卡内部内容（.art 画像 / .frame 卡框 / .plate 覆盖信息——由调用方包 .hero-card）。
 *  结构对齐官方卡（wujiang5 卡框）：左上势力图标 + 竖排名、右上五星、底部 Lv·兵种。
 *  ⚠️ 主战法名**不进卡面**（2026-09-19 回退「卡上画战法名」的决策）：卡面只留 势力/姓名/星级/Lv/兵种，
 *     战法名与描述走 `card.title` 悬浮提示。
 *  @param level 展示等级（武将池传该武将当前上阵等级，缺省 40＝引擎默认等级）
 *  @param offlineNote 下架原因；有值时姓名后加「下架」角标（配将池「显示下架武将」开关打开时） */
function heroCardHtml(hero: HeroJson, level = 40, offlineNote?: string): string {
  const art = portraitSrc(hero.id) || '';
  const frame = cardFrameSrc();
  const sp = hero.tags.includes('sp');
  const tag = offlineNote ? ' <span class="offline-tag">下架</span>' : '';
  return `
      <img class="art" src="${art}" alt="" draggable="false" loading="lazy" decoding="async" />
      <div class="frame" style="background-image:url('${frame}')"></div>
      <div class="plate">
        <img class="fac" data-faction="${hero.faction}" alt="${hero.faction}" src="${factionIconSrc(hero.faction)}" />
        <div class="n">${hero.name}${tag}</div>
        ${sp ? '<div class="sp-badge">SP</div>' : ''}
        <div class="stars">★★★★★</div>
        <div class="bar">
          <span class="lv"><i>Lv.</i>${level}</span>
          <span class="troop" title="兵种">${TYPE_CHAR[hero.troopType] ?? '?'}</span>
        </div>
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
  // 搜索框挂到顶栏固定栏（#pool-search-slot）：从武将池里挪出去，给池子多留一行高度
  const searchSlot = root.ownerDocument.getElementById('pool-search-slot') ?? undefined;
  root.appendChild(renderHeroPool(state, h, searchSlot));
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
  if (h.onSavePreset) {
    const savePreset = document.createElement('button');
    savePreset.className = 'btn ghost team-save-preset';
    savePreset.type = 'button';
    savePreset.textContent = '保存预设';
    savePreset.title = '把本队三将（战法/兵种/宝物/加点）存为阵容预设，下次可一键上场';
    savePreset.onclick = () => h.onSavePreset?.(team);
    actions.append(bonus, savePreset, clear);
  } else {
    actions.append(bonus, clear);
  }
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
      buildGeneral(s.heroId, s.extraSkillIds, s.freePoints, POS[i], s.redness, s.level, 120, s.secondaryTroop, s.secondaryTraits)
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

  /**
   * 一个分区：徽章 + 标题 + 生效范围 + 内容（武将加成行 / 空态 / 称号提示）。
   * 骨架是普通长方形弹窗里的纵向三段，不做三栏并排（原来 980px 宽 × 三列，长宽比夸张）。
   */
  const section = (
    badge: string,
    title: string,
    scope: 'battle' | 'global',
    lines: typeof factionLines,
    emptyHint: string,
    body?: string,
  ): string => `
        <section class="bm-card">
          <div class="bm-card-head">
            <span class="bm-badge">${badge}</span>
            <span class="bm-card-title">${title}</span>
            <span class="bm-tag ${scope}">${scope === 'battle' ? '战斗中生效' : '全局生效'}</span>
          </div>
          <div class="bm-list">${body ?? heroRows(lines, emptyHint)}</div>
        </section>`;

  // 兵种徽章用单字（骑/步/弓），与武将卡底部兵种位、筛选栏用字一致；不用图案/图标
  const troopBadge = mainTroop ? TYPE_CHAR[mainTroop] ?? '—' : '—';

  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal bonus-modal">
      <div class="m-head"><h3>部队加成 · ${teamLabel}</h3><span class="m-close">×</span></div>
      <div class="m-body bm-body">
        ${section(mainFaction, `阵营加成-${mainFaction}`, 'battle', factionLines, '上阵 ≥2 名同阵营武将可触发')}
        ${section('号', '称号加成', 'global', titleLines, '', titleBody)}
        ${section(troopBadge, `兵种加成-${mainTroop ? TROOP_CN[mainTroop] : '—'}`, 'battle', troopLines, '上阵 ≥2 名同兵种武将可触发')}
      </div>
      <div class="m-foot"><button type="button" class="btn ghost done">完成</button></div>
    </div>`;
  const close = () => mask.remove();
  mask.querySelector('.m-close')!.addEventListener('click', close);
  (mask.querySelector('.done') as HTMLElement).addEventListener('click', close);
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

/** 属性格：图标 + 加成数字（0 灰显） */
function statCell(key: string, v: number): string {
  const on = v > 0;
  return `<span class="bm-stat${on ? ' on' : ''}" title="${STAT_CN[key]}">${BM_STAT_ICONS[key]}<i>${v > 0 ? '+' + v : v}</i></span>`;
}

/**
 * 配将槽位「宝物条」（用户 2026-09-21 口径：取代原「阵营 · 兵种 · 距离 · 兵力」小字）：
 * 宝物图 + 宝物名/稀有度等级 + 锻造词条（词条按选定数值自动 蓝/粉/红 着色）。
 * 未佩戴 → 灰字占位（宝物在「武将详情」左栏佩戴）。
 */
export function slotTreasureHtml(slot: SlotState): string {
  const cur = slot.treasure;
  const t = cur ? TREASURES_BY_ID[cur.treasureId] : null;
  if (!cur || !t) return `<span class="slot-treasure empty" title="在武将详情中佩戴宝物">未佩戴宝物</span>`;
  const level = cur.level ?? 10;
  const affix = cur.affix ? AFFIXES[cur.affix.name] : null;
  const value = cur.affix && affix ? `${cur.affix.value}${affix.unit === 'percent' ? '%' : ''}` : '';
  const tier = affix && cur.affix ? affixTier(affix, cur.affix.value) : 'none';
  const effText = t.effects.map((e) => `${e.name}：${e.desc}`).join('\n');
  const tip = `${t.name}（${t.type}）· 稀世 ${level} 级\n【自带特效】\n${effText}\n【锻造词条】${
    affix && cur.affix ? `${affix.name} ${value}（区间 ${affix.min}~${affix.max}）` : '未锻造'
  }`;
  const affixHtml =
    affix && cur.affix
      ? `<span class="st-affix ${tier}">${affix.name}<b>${value}</b></span>`
      : `<span class="st-affix none">未锻造</span>`;
  return `<span class="slot-treasure" title="${tip}">
      <img class="st-img" src="${asset(t.icon)}" alt="${t.name}" onerror="this.style.display='none'" />
      <span class="st-info">
        <span class="st-name">${t.name}<i>稀世 ${level} 级</i></span>
        ${affixHtml}
      </span>
    </span>`;
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
    el.innerHTML = `<img class="slot-add-icon" src="${asset('/skills/slot-add.png')}" alt="" /><span>点击选择 ${label}</span>`;
    el.onclick = () => openHeroPicker(team, i, h);
    return el;
  }

  const hero = getHeroById(slot.heroId)!;
  const portrait = portraitSrc(hero.id);
  const avatar = avatarSrc(hero.id);
  const div = document.createElement('div');
  div.className = 'slot-inner';
  /* 左＝官方卡面（wujiang5 卡框：画像铺满 / 左上势力图标 + 竖排名 / 右上红度 / 底部 Lv·兵种），
     右＝配将信息列（站位、头像、宝物条、三战法位）。名称只画一次（在卡面竖排，类名仍是 .hero-name）。 */
  div.innerHTML = `
    <div class="slot-card">
      <div class="slot-art" style="background-image:url('${portrait}')"></div>
      <div class="frame" style="background-image:url('${cardFrameSrc()}')"></div>
      <div class="plate">
        <img class="fac" data-faction="${hero.faction}" alt="${hero.faction}" src="${factionIconSrc(hero.faction)}" />
        <div class="hero-name">${hero.name}</div>
        ${hero.tags.includes('sp') ? '<div class="sp-badge">SP</div>' : ''}
        <div class="hero-stars" title="红度 ${slot.redness}/5">${rednessStars(slot.redness)}</div>
        <div class="card-bar">
          <span class="lv"><i>Lv.</i>${slot.level}</span>
          <span class="troop" title="${slot.secondaryTroop ? `二级兵种：${slot.secondaryTroop}` : TYPE_NAME[hero.troopType] ?? '兵种'}">${slot.secondaryTroop ?? TYPE_CHAR[hero.troopType] ?? '?'}</span>
        </div>
      </div>
    </div>
    <div class="slot-main">
      <div class="hero-line">
        <span class="slot-label">${label}</span>
        <img class="slot-avatar" src="${avatar}" alt="" onerror="this.style.display='none'" />
        ${slotTreasureHtml(slot)}
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
      const plate = gradePlate(grade);
      item.innerHTML = `${skillIconHtml(x.id, 'css')}<span class="slot-skill-name${plate ? ' has-plate' : ''}"${plate ? ` style="background-image:url('${plate}')"` : ''}>${s.name}</span>`;
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

/** 「显示下架武将」调试开关状态（跨重渲染保持；默认关）。
 *  下架 = 主战法已实现、但「受属性影响」的成长率未确认（`OFFLINE_MAIN_SKILLS`，数值按基值不缩放），
 *  默认不进池；打开后可显示并配将，用于在 App 里验证这些武将的机制。 */
let poolShowOffline = false;

/** 开关 HTML（勾选状态跟随 `poolShowOffline`）；也用于「选择武将」弹窗 */
function offlineToggleHtml(): string {
  return `
      <label class="offline-toggle" title="下架武将＝主战法已实现、但受属性影响的成长率未确认（数值按基值不缩放）。勾选后可显示并配将（调试用）。">
        <input type="checkbox" class="offline-toggle-input"${poolShowOffline ? ' checked' : ''} />显示下架武将（${OFFLINE_HEROES.length}）
      </label>`;
}

/** 绑定开关：变更写回 `poolShowOffline` 并重画 */
function bindOfflineToggle(root: HTMLElement, draw: () => void): void {
  const cb = root.querySelector('.offline-toggle-input') as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener('change', () => { poolShowOffline = cb.checked; draw(); });
}

/** 当前池子展示的武将集合：默认上架池；开关打开时并入下架武将 */
function poolHeroes(): HeroJson[] {
  return poolShowOffline ? SLOTTED_HEROES : HEROES;
}

/** 武将池（含搜索/筛选/详情弹窗），供主站与伤害测试实验室复用。
 *  池内卡可拖入槽位；已入队卡可拖回本池卸下（onRemoveHero）。 */
/**
 * 武将池。`searchSlot` 传了（首页）就把搜索框搬到那个固定栏里；
 * 不传（伤害测试实验室 .lab-pool）则搜索框留在池内，行为与改动前一致。
 */
export function renderHeroPool(state: EditorState, h: EditorHandlers, searchSlot?: HTMLElement): HTMLElement {
  const pool = document.createElement('div');
  pool.className = 'hero-pool';
  pool.innerHTML = `
    <div class="toolbar">
      <input type="text" placeholder="搜索武将名 / 拼音 / 势力 / SP…" />
    </div>
    ${heroFilterHtml()}
    ${offlineToggleHtml()}
    <div class="hero-grid"></div>
  `;
  const toolbar = pool.querySelector('.toolbar') as HTMLElement;
  // 先把引用取好再搬节点：搬走之后 pool.querySelector('input') 就找不到了
  const input = toolbar.querySelector('input') as HTMLInputElement;
  const grid = pool.querySelector('.hero-grid') as HTMLElement;
  if (searchSlot) {
    // 整个 .toolbar 节点搬过去（不是复制）：已绑定的监听与输入内容都保留
    searchSlot.replaceChildren(toolbar);
  }
  const selected: HeroFilter = { faction: new Set(), type: new Set() };

  const picked = new Set<string>();
  /** 已上阵武将的当前等级（卡底 Lv 显示；未上阵用引擎默认 40 级） */
  const levelOf = new Map<string, number>();
  for (const team of [state.red, state.blue]) {
    for (const s of team) {
      if (!s.heroId) continue;
      picked.add(s.heroId);
      levelOf.set(s.heroId, s.level);
    }
  }

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
    for (const hero of poolHeroes()) {
      if (!heroMatchesFilter(hero, selected, q)) continue;
      const reason = offlineReason(hero);
      const card = document.createElement('div');
      card.className = 'hero-card' + (reason ? ' offline' : '') + (picked.has(hero.id) ? ' picked' : '');
      card.innerHTML = heroCardHtml(hero, levelOf.get(hero.id) ?? 40, reason);
      card.title = reason
        ? `【已下架 · 调试显示】${reason}\n${heroMainSkillName(hero)}｜${hero.skillDesc || ''}`
        : `${heroMainSkillName(hero)}｜${hero.skillDesc || ''}`;
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
  bindOfflineToggle(pool, draw);
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
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal hero-detail-modal';
  modal.innerHTML = `
    <div class="m-head"><h3><img class="modal-avatar" src="${avatarSrc(heroId)}" alt="" onerror="this.style.display='none'" />武将详情 · ${hero.name}</h3><div class="hd-tabs-slot"></div><span class="m-close">×</span></div>
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

  /** 详情页三个板块（按参考图骨架划分，不照抄）：详情 / 配点 / 兵种 */
  let activeTab: 'detail' | 'points' | 'troop' = 'detail';

  const redraw = () => {
    // 左右布局（按参考图）：左边「阵营 + 名字 + 画像 + 星级」三个板块共用、切换时不重建内容；
    // 右边是详情 / 配点 / 兵种 三个板块之一；切换条放在顶栏（中间偏右）。
    body.innerHTML = `
      <div class="hd-split">
        <aside class="hd-side">${hdSideHtml()}</aside>
        <div class="hd-main">${hdPanelHtml()}</div>
      </div>`;
    const tabsSlot = modal.querySelector('.hd-tabs-slot');
    if (tabsSlot) tabsSlot.innerHTML = hdTabsHtml();
    foot.innerHTML = '';
    bindBodyEvents();
    bindFooter();
  };

  /** 板块 1 · 详情：兵种 / 攻击距离 / 四维属性与成长 / 战法栏 */
  const hdDetailHtml = (): string => {
    const { base, grow } = statsAt(hero, slot.level);
    const r = slot.redness;
    const budget = freePointBudget(heroId, r, slot.level);
    const used = STAT_NAMES.reduce((a, [k]) => a + (slot.freePoints[k] ?? 0), 0);
    const remain = Math.max(0, budget - used);
    const troops = troopCapacity(slot.level, r);

    const statRows = STAT_NAMES.map(([k, name]) => {
      const v = base[k] + (slot.freePoints[k] ?? 0);
      return `
        <div class="stat-row">
          <span class="k">${name}</span>
          <span class="v">${v}</span>
          <span class="g">（+${grow[k].toFixed(2)}）</span>
        </div>`;
    }).join('');

    const mainSkill = hero.mainSkillId && SKILL_REGISTRY[hero.mainSkillId] ? hero.mainSkillId : null;
    const mainSkillEl = mainSkill
      ? skillSlotHtml(mainSkill, true, `${SKILL_REGISTRY[mainSkill].name}（主战法）`)
      : `<div class="skill-slot-row main disabled"><span class="tip">主战法未实现</span></div>`;

    const equips = [0, 1].map((i) => {
      const sid = slot.extraSkillIds[i];
      if (!sid) {
        const canAdd = slot.extraSkillIds.length < 2;
        return `
          <div class="skill-slot-row add ${editable && canAdd ? '' : 'disabled'}" data-slot="${i}" title="${editable ? '点击装配战法' : '放入阵容后可装配'}">
            <img class="sslot-add" src="${asset('/skills/slot-add.png')}" alt="" />
            <span class="sslot-empty-tip">可学习</span>
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

    return `
      <div class="hd-meta-row">
        <span class="hd-meta"><i>兵种</i>${TYPE_NAME[hero.troopType] ?? TYPE_CHAR[hero.troopType] ?? '?'}</span>
        <span class="hd-meta"><i>攻击距离</i>${hero.attackRange}</span>
      </div>
      <div class="hd-level-row" title="等级 40~50，属性随成长率更新；携带兵力 = 等级×100 + 5000 + 红度×200">
        <span class="lbl">等级</span>
        <input type="number" min="40" max="50" value="${slot.level}" data-level="1" ${editable ? '' : 'disabled'}>
        <span class="hd-troops">携带兵力 <b>${troops}</b><i class="tip">${slot.level}×100+5000+${r}×200</i></span>
      </div>
      <div class="hd-redness">
        <span class="lbl">红度</span>
        <span class="redness-pick" title="点击设置红度（每红 +10 自由属性点 +200 携带兵力，满红 +50 点 +1000 兵）">
          ${[1, 2, 3, 4, 5].map((i) => `<i class="rstars ${i <= r ? 'on' : ''}" data-r="${i}">★</i>`).join('')}
        </span>
        <span class="hd-budget">自由属性剩余 <b>${remain}</b> / ${budget} 点${r > 0 ? ` <i class="red-extra">（含红度 +${r * 10}）</i>` : ''}</span>
      </div>
      <div class="hd-stats">${statRows}</div>
      <div class="hd-skills">
        <div class="skills-title">战法</div>
        <div class="skills-row">${mainSkillEl}${equips}</div>
      </div>
    `;
  };


  /** 左侧固定栏：阵营 + 名字（竖排，仿参考图）+ 画像 + 星级 —— 三个板块共用 */
  const hdSideHtml = (): string => {
    const sp = hero.tags.includes('sp');
    return `
      <div class="hd-side-labels">
        <span class="faction-badge ${FACTION_CLS[hero.faction] ?? ''}">${hero.faction}</span>
        <span class="hd-side-name">${hero.name}${sp ? '<span class="sp-tag">SP</span>' : ''}${isFemale(heroId) ? '<span class="hd-female">女</span>' : ''}</span>
      </div>
      <div class="hd-side-col">
        <div class="hd-portrait">
          <img src="${portraitSrc(heroId)}" alt="${hero.name}" onerror="this.style.display='none'" />
          <div class="hd-stars" title="红度 ${slot.redness}/5（每红 +10 自由属性点）">${rednessStars(slot.redness)}</div>
        </div>
        ${hdTreasureSlotHtml()}
      </div>`;
  };

  /**
   * 左栏宝物槽（游戏卡面样式）：未佩戴 = 空槽（点击进入第 1 步选宝物）；
   * 已佩戴 = 立绘 + 「稀世」角标 + 锻造词条名（**按数值自动蓝/粉/红**）+ 宝物名；
   * 再次点击图片可直接选第 4 条（锻造词条）并拖滑杆调值，右上 × 卸下。
   */
  const hdTreasureSlotHtml = (): string => {
    const cur = slot.treasure;
    if (!cur) {
      // 外层 wrapper 高度由 flex 决定（不参与内容撑高），卡绝对定位填满 → 卡底边自动与右栏战法栏齐平
      return `<div class="hd-treasure-wrap"><div class="hd-treasure empty" ${editable ? 'data-treasure-open="1"' : ''} title="${editable ? '点击选择宝物' : '放入阵容后可佩戴宝物'}">
        <span class="ts-plus">＋</span><span class="ts-tip">选择宝物</span><span class="ts-sub">未佩戴</span>
      </div></div>`;
    }
    const t = TREASURES_BY_ID[cur.treasureId];
    if (!t) return '';
    const affix = cur.affix ? AFFIXES[cur.affix.name] : null;
    const tier = affix && cur.affix ? affixTier(affix, cur.affix.value) : null;
    const effText = t.effects.map((e) => `${e.name}：${e.desc}`).join('\n');
    const affixLine =
      affix && cur.affix
        ? `<span class="ts-affix ${tier}">${affix.name}<b>${cur.affix.value}${affix.unit === 'percent' ? '%' : ''}</b></span>`
        : `<span class="ts-affix none">未锻造</span>`;
    const tip = `${t.name}（${t.type}）· ${cur.level ?? 10} 级\n【自带特效】\n${effText}${
      affix && cur.affix
        ? `\n【锻造词条】${affix.name} ${cur.affix.value}${affix.unit === 'percent' ? '%' : ''}（区间 ${affix.min}~${affix.max}）`
        : '\n【锻造词条】未选择（点击图片可选）'
    }`;
    // 横版卡面（用户 2026-09-21 口径）：左侧宝物图，右侧竖排「稀有度 / 锻造词条 / 宝物名」；
    // 卡宽 = 左栏宽（与画像同宽 156），高度自适应到与右栏战法栏底部齐平。
    return `<div class="hd-treasure-wrap"><div class="hd-treasure filled" ${editable ? 'data-treasure-open="1"' : ''} title="${tip}">
      <img class="ts-img" src="${asset(t.image)}" alt="${t.name}" onerror="this.style.display='none'" />
      <div class="ts-info">
        <span class="ts-rarity">稀世<i>${cur.level ?? 10} 级</i></span>
        ${affixLine}
        <span class="ts-name">${t.name}</span>
      </div>
      ${editable ? '<span class="ts-remove" title="卸下宝物">×</span>' : ''}
    </div></div>`;
  };

  /** 板块切换条（详情 / 配点 / 兵种） */
  const hdTabsHtml = (): string => {
    const tabs: Array<['detail' | 'points' | 'troop', string]> = [
      ['detail', '详情'], ['points', '配点'], ['troop', '兵种'],
    ];
    return `<nav class="hd-tabs" aria-label="武将详情板块">${tabs
      .map(([id, label]) => `<button type="button" class="hd-tab${id === activeTab ? ' on' : ''}" data-tab="${id}">${label}</button>`)
      .join('')}</nav>`;
  };

  const hdPanelHtml = (): string =>
    activeTab === 'detail' ? hdDetailHtml() : activeTab === 'points' ? hdPointsHtml() : hdTroopHtml();

  /**
   * 板块 2 · 配点：每项 − / + / 最大（把剩余点数全加进该项），外加「重置」返还全部点数。
   * 「进阶」按用户要求不做。
   */
  const hdPointsHtml = (): string => {
    const { base } = statsAt(hero, slot.level);
    const budget = freePointBudget(heroId, slot.redness, slot.level);
    const used = STAT_NAMES.reduce((a, [k]) => a + (slot.freePoints[k] ?? 0), 0);
    const remain = Math.max(0, budget - used);
    const dis = (on: boolean): string => (editable && on ? '' : 'disabled');

    const rows = STAT_NAMES.map(([k, name]) => {
      const cur = slot.freePoints[k] ?? 0;
      return `
        <div class="pt-row">
          <div class="pt-head">
            <span class="pt-k">${name}</span>
            <span class="pt-d">+${cur}</span>
          </div>
          <div class="pt-line">
            <span class="pt-before">${base[k]}</span>
            <span class="pt-arrow">»</span>
            <span class="pt-after">${base[k] + cur}</span>
            <span class="pt-actions">
              <button type="button" class="pt-btn" data-dec="${k}" ${dis(cur > 0)}>−</button>
              <button type="button" class="pt-btn" data-inc="${k}" ${dis(remain > 0)}>＋</button>
              <button type="button" class="pt-btn pt-max" data-max="${k}" ${dis(remain > 0)}>最大</button>
            </span>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="pt-wrap">
        <div class="pt-bar">
          <span class="pt-title">自由属性分配</span>
          <span class="pt-remain">剩余 <b>${remain}</b> / ${budget} 点${editable ? '' : ' <i class="tip">（放入阵容后可分配）</i>'}</span>
          <button type="button" class="btn beige pt-reset" ${dis(used > 0)}>重置</button>
        </div>
        <div class="pt-list">${rows}</div>
      </div>`;
  };

  /**
   * 板块 3 · 兵种：二级兵种转换（两个方向二选一）+ 专属特性 + 2 个通用特性栏。
   * 数据源 `HERO_SECONDARY_TROOPS`（官方武将表解码，161/161 对齐）；未收录的武将显示未开放。
   */
  const hdTroopHtml = (): string => {
    const options: SecondaryTroopType[] = HERO_SECONDARY_TROOPS[heroId] ?? [];
    if (options.length === 0) {
      return `
        <div class="hd-troop">
          <div class="hd-troop-title">兵种转换</div>
          <div class="ph-tip">该武将暂无二级兵种转换数据（官方武将表未收录）</div>
        </div>`;
    }
    const cur = slot.secondaryTroop;
    const cards = options
      .map((t) => {
        const def = SECONDARY_TROOPS[t];
        const selected = t === cur;
        const exclusive = def.exclusiveTrait.length
          ? def.exclusiveTrait.map((s) => `<li>${s}</li>`).join('')
          : '<li class="pending">专属特性待补（占位）</li>';
        return `
        <div class="troop-card ${selected ? 'selected' : ''}" data-troop="${t}" title="${selected ? '当前兵种' : '点击转换为' + t}">
          <div class="tc-head">
            <i class="tc-check">${selected ? '✓' : ''}</i>
            <span class="tc-name">${t}</span>
            ${def.exclusive ? '<span class="tc-exclusive">专属</span>' : ''}
          </div>
          <div class="tc-family">${def.family}</div>
          <ul class="tc-traits">${exclusive}</ul>
        </div>`;
      })
      .join('');

    const pool: GeneralTrait[] = cur ? traitsFor(cur) : [];
    const learned = slot.secondaryTraits ?? [];
    const traitSlots = Array.from({ length: TRAIT_SLOTS_MAX }, (_, i) => {
      const picked = learned[i];
      const chosen = picked
        ? `<button class="trait-chip picked" data-slot="${i}" title="点击更换/清空">${picked}<i class="chip-x">×</i></button>`
        : `<button class="trait-chip empty" data-slot="${i}">+ 选择特性</button>`;
      return `<div class="trait-slot"><span class="ts-label">特性 ${i + 1}</span>${chosen}</div>`;
    }).join('');

    const poolHtml = !cur
      ? '<div class="ph-tip">先选择二级兵种，再学习通用特性</div>'
      : `<div class="trait-pool">${pool
          .map((t) => {
            const used = learned.includes(t);
            return `<button class="trait-option ${used ? 'used' : ''}" data-pick="${t}" ${used ? 'disabled' : ''}>${t}</button>`;
          })
          .join('')}</div>`;

    return `
      <div class="hd-troop">
        <div class="hd-troop-title">兵种转换<span class="ht-hint">基础兵种 · ${TYPE_NAME[hero.troopType] ?? ''}${cur ? ` → <b>${cur}</b>` : ''}</span></div>
        <div class="troop-cards">${cards}</div>
        <div class="hd-troop-title">通用特性<span class="ht-hint">每个高级兵种 ${TRAIT_SLOTS_MAX} 栏，选自本兵系特性池</span></div>
        <div class="trait-slots">${traitSlots}</div>
        ${poolHtml}
        ${cur ? `<div class="ht-reset"><button class="troop-reset" data-reset="1">转回基础兵种（${TYPE_NAME[hero.troopType] ?? ''}）</button></div>` : ''}
      </div>`;
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
    // 宝物（左栏卡面）：点击图片 → 选/换宝物，或（已佩戴时）直接进第 2 步选第 4 条锻造词条；右上 × 卸下
    const tSlot = body.querySelector('[data-treasure-open]') as HTMLElement | null;
    tSlot?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('ts-remove')) return;
      if (!editable) { showNotice('放入阵容后可佩戴宝物'); return; }
      openTreasurePicker({
        heroId,
        team: placed!.team,
        idx: placed!.idx,
        slot,
        handlers: h,
        startStep: slot.treasure ? 2 : 1,
        onDone: () => redraw(),
      });
    });
    const rmTreasure = body.querySelector('.hd-treasure .ts-remove') as HTMLElement | null;
    rmTreasure?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!editable) return;
      h.onSetTreasure(placed!.team, placed!.idx, null);
      redraw();
    });
    // 板块切换（详情 / 配点 / 兵种）——切换条在顶栏里，所以从 modal 上取而不是 body
    modal.querySelectorAll('.hd-tab').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        activeTab = (el as HTMLElement).dataset.tab as typeof activeTab;
        redraw();
      };
    });
    // 配点：− / ＋ / 最大（剩余点数全加进该项）/ 重置（四项归零，返还全部点数）
    const remainPoints = (): number => {
      const budget = freePointBudget(heroId, slot.redness, slot.level);
      const used = STAT_NAMES.reduce((a, [k]) => a + (slot.freePoints[k] ?? 0), 0);
      return Math.max(0, budget - used);
    };
    const applyFree = (k: keyof SlotState['freePoints'], value: number): void => {
      if (!editable) { showNotice('放入阵容后可分配属性点'); return; }
      h.onSetFreePoints(placed!.team, placed!.idx, k, Math.max(0, value));
      redraw();
    };
    body.querySelectorAll('.pt-btn[data-inc]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const k = (el as HTMLElement).dataset.inc as keyof SlotState['freePoints'];
        applyFree(k, (slot.freePoints[k] ?? 0) + 1);
      };
    });
    body.querySelectorAll('.pt-btn[data-dec]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const k = (el as HTMLElement).dataset.dec as keyof SlotState['freePoints'];
        applyFree(k, (slot.freePoints[k] ?? 0) - 1);
      };
    });
    body.querySelectorAll('.pt-btn[data-max]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const k = (el as HTMLElement).dataset.max as keyof SlotState['freePoints'];
        applyFree(k, (slot.freePoints[k] ?? 0) + remainPoints());
      };
    });
    body.querySelector('.pt-reset')?.addEventListener('click', () => {
      if (!editable) { showNotice('放入阵容后可分配属性点'); return; }
      for (const [k] of STAT_NAMES) h.onSetFreePoints(placed!.team, placed!.idx, k, 0);
      redraw();
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

    // ── 兵种转换板块（兵种二选一 + 通用特性 2 栏）──
    const requireEditable = (): { team: 'red' | 'blue'; idx: number } | null => {
      if (!placed) {
        showNotice('放入阵容后可转换兵种');
        return null;
      }
      return { team: placed.team, idx: placed.idx };
    };
    body.querySelectorAll('.troop-card').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const at = requireEditable();
        if (!at) return;
        const t = (el as HTMLElement).dataset.troop as SecondaryTroopType;
        // 再点当前兵种 = 取消（转回基础兵种）
        h.onSetSecondaryTroop(at.team, at.idx, slot.secondaryTroop === t ? undefined : t);
        redraw();
      };
    });
    const resetBtn = body.querySelector('.troop-reset') as HTMLElement | null;
    if (resetBtn) {
      resetBtn.onclick = () => {
        const at = requireEditable();
        if (!at) return;
        h.onSetSecondaryTroop(at.team, at.idx, undefined);
        redraw();
      };
    }
    body.querySelectorAll('.trait-chip.picked').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const at = requireEditable();
        if (!at) return;
        h.onSetSecondaryTrait(at.team, at.idx, Number((el as HTMLElement).dataset.slot), undefined);
        redraw();
      };
    });
    body.querySelectorAll('.trait-option:not(.used)').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const at = requireEditable();
        if (!at) return;
        // 填到第一个空栏；两栏都满时替换第 1 栏
        const learned = slot.secondaryTraits ?? [];
        const target = learned.length >= TRAIT_SLOTS_MAX ? 0 : learned.length;
        h.onSetSecondaryTrait(at.team, at.idx, target, (el as HTMLElement).dataset.pick as GeneralTrait);
        redraw();
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
      rm.className = 'btn beige rm-hero';
      rm.style.marginRight = '10px';
      rm.textContent = '移除武将';
      rm.onclick = () => { h.onRemoveHero(placed!.team, placed!.idx); close(); };
      foot.appendChild(rm);
    }
    const done = document.createElement('button');
    done.className = 'btn done beige';
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
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal skill-detail-modal';
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
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  // 手机端与武将选择/背包一致：整屏页面（搜索在固定顶栏、筛选固定、列表内部滚）
  modal.className = 'modal page-modal skill-pick-modal';
  modal.innerHTML = `
    <div class="m-head">
      <h3>装配战法（${getHeroById(slot.heroId!)!.name}）</h3>
      <div class="pick-toolbar">
        <input type="text" placeholder="搜索战法名…" />
      </div>
      <span class="m-close">×</span>
    </div>
    <div class="m-body">
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
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  // 专属类名：手机端要靠它把这个弹窗（以及战法详情、背包、历史、武将详情）改成页面级视图，
  // 而 openPlacePicker / openSkillPicker 那两个裸 .modal 保持居中弹窗
  modal.className = 'modal page-modal hero-pick-modal';
  // 搜索框放在页面顶部固定栏里（.m-head）——它不随武将网格滚动，翻到第 N 屏也能直接改搜索词
  modal.innerHTML = `
    <div class="m-head">
      <h3>选择武将</h3>
      <div class="pick-toolbar"><input type="text" placeholder="搜索武将名 / 拼音 / 势力 / SP…" /></div>
      <span class="m-close">×</span>
    </div>
    <div class="m-body">
      ${offlineToggleHtml()}
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
    for (const hero of poolHeroes()) {
      if (!heroMatchesFilter(hero, selected, q)) continue;
      const reason = offlineReason(hero);
      const card = document.createElement('div');
      card.className = 'hero-card' + (reason ? ' offline' : '');
      card.innerHTML = heroCardHtml(hero, 40, reason);
      card.title = reason
        ? `【已下架 · 调试显示】${reason}\n${heroMainSkillName(hero)}｜${hero.skillDesc || ''}`
        : `${heroMainSkillName(hero)}｜${hero.skillDesc || ''}`;
      card.onclick = () => { close(); openHeroDetail(hero.id, { target: { team, idx: slotIndex }, handlers: h }); };
      grid.appendChild(card);
    }
  };
  input.addEventListener('input', draw);
  bindHeroFilter(modal, selected, draw);
  bindOfflineToggle(modal, draw);
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
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal bag-modal';
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
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal history-modal';
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

/**
 * 宝物三步弹窗（P4）：① 选宝物（38 件稀世网格）② 选词条（该宝物词条池 6~7 条）
 * ③ 选数值（官方区间内任意值，滑杆刻度用蓝/粉/红标注）。确认后写回 `SlotState.treasure`（默认 10 级）。
 */
export function openTreasurePicker(opts: {
  heroId: string;
  team: 'red' | 'blue';
  idx: number;
  slot: SlotState;
  handlers: EditorHandlers;
  onDone?: () => void;
  /** 打开时直接进入的步骤（已佩戴宝物 → 从第 2 步「选第 4 条锻造词条」开始） */
  startStep?: 1 | 2 | 3;
}): void {
  const cur = opts.slot.treasure;
  let step: 1 | 2 | 3 = opts.startStep ?? (cur ? 2 : 1);
  let treasureId = cur?.treasureId ?? TREASURES[0].id;
  let affixName: string | null = cur?.affix?.name ?? null;
  let value = cur?.affix?.value ?? 0;

  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal treasure-modal';
  mask.appendChild(modal);
  document.body.appendChild(mask);
  const close = (): void => mask.remove();
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });

  const treasure = (): TreasureDef => TREASURES_BY_ID[treasureId];
  const affixOf = (): AffixDef | null => (affixName ? AFFIXES[affixName] ?? null : null);
  const suffix = (a: AffixDef | null): string =>
    a && a.unit === 'percent' ? '%' : a && a.unit === 'round' ? ' 回合' : '';
  const fmt = (n: number, a: AffixDef | null): string => `${n}${suffix(a)}`;

  const stepBar = (): string =>
    `<div class="tp-steps"><span class="${step === 1 ? 'on' : ''}">① 选宝物</span><span class="${step === 2 ? 'on' : ''}">② 选词条</span><span class="${step === 3 ? 'on' : ''}">③ 选数值</span></div>`;

  const step1 = (): string => {
    const cards = TREASURES.map(
      (t) => `<button class="tp-card${t.id === treasureId ? ' on' : ''}" data-tid="${t.id}" title="${t.name}（${t.type}）">
        <img src="${asset(t.icon)}" alt="" onerror="this.style.display='none'" />
        <span class="tp-name">${t.name}</span><span class="tp-type">${t.type}</span>
      </button>`,
    ).join('');
    const t = treasure();
    const eff = t.effects.map((e) => `<div class="tp-eff"><b>${e.name}</b>：${e.desc}</div>`).join('');
    return `${stepBar()}
      <div class="tp-grid">${cards}</div>
      <div class="tp-detail"><div class="tp-detail-name">${t.name} · ${t.type} · 稀世</div>${eff}
        <div class="tp-hint">自带特效按宝物等级计算（默认 10 级：一阶/二阶 = 官方数值 × 5，三阶固定）</div></div>
      <div class="tp-foot"><button class="tp-next">下一步：选词条</button></div>`;
  };

  const step2 = (): string => {
    const t = treasure();
    const rows = t.affixPool
      .map((name) => {
        const a = AFFIXES[name];
        if (!a) return '';
        const color = a.hint
          ? `蓝 ≤ ${fmt(a.hint.blueMax, a)} ｜ 粉 ${fmt(a.hint.pinkMin, a)}${
              a.hint.pinkMin === a.hint.pinkMax ? '' : '~' + fmt(a.hint.pinkMax, a)
            } ｜ 红 ${a.hint.red == null ? '—' : fmt(a.hint.red, a)}`
          : '';
        return `<button class="tp-affix${name === affixName ? ' on' : ''}" data-affix="${name}">
          <span class="tp-affix-name">${name}</span>
          <span class="tp-affix-desc">${a.desc}</span>
          <span class="tp-affix-color">${color}</span>
        </button>`;
      })
      .join('');
    return `${stepBar()}
      <div class="tp-sub">「${t.name}」可锻造出的词条（第 4 条 · ${t.affixPool.length} 条随机其一；前 3 条为宝物自带特效）</div>
      <div class="tp-affixes">${rows}</div>
      <div class="tp-foot"><button class="tp-back">← 上一步</button><button class="tp-skip">不锻造（仅用自带特效）</button></div>`;
  };

  const step3 = (): string => {
    const a = affixOf();
    if (!a) return step2();
    const tier = affixTier(a, value);
    const ticks = a.hint
      ? `<div class="tp-legend">
          <span class="dot blue${tier === 'blue' ? ' on' : ''}"></span><span class="blue">蓝</span>
          <span class="dot pink${tier === 'pink' ? ' on' : ''}"></span><span class="pink">粉</span>
          <span class="dot red${tier === 'red' ? ' on' : ''}"></span><span class="red">红</span>
          <span class="tp-legend-text">蓝 ≤ ${fmt(a.hint.blueMax, a)} ｜ 粉 ${fmt(a.hint.pinkMin, a)}${
            a.hint.pinkMin === a.hint.pinkMax ? '' : '~' + fmt(a.hint.pinkMax, a)
          } ｜ 红 ${a.hint.red == null ? '—' : fmt(a.hint.red, a)}</span>
        </div>`
      : '';
    return `${stepBar()}
      <div class="tp-sub">第 4 条 · 锻造词条「${a.name}」：${a.desc}</div>
      <div class="tp-slider">
        <input type="range" min="${a.min}" max="${a.max}" step="1" value="${value}" class="tp-range" />
        <div class="tp-value"><b class="${tier}">${fmt(value, a)}</b><span class="tp-tier ${tier}">当前档位：${AFFIX_TIER_NAME[tier]}</span><span class="tp-range-text">官方区间 ${fmt(a.min, a)} ~ ${fmt(a.max, a)}</span></div>
        ${ticks}
      </div>
      <div class="tp-foot"><button class="tp-back">← 上一步</button><button class="tp-ok">确认佩戴</button></div>`;
  };

  const confirm = (): void => {
    const a = affixOf();
    const loadout: TreasureLoadout = {
      treasureId,
      level: 10,
      ...(affixName && a ? { affix: { name: affixName, value } } : {}),
    };
    opts.handlers.onSetTreasure(opts.team, opts.idx, loadout);
    opts.onDone?.();
    close();
  };

  const render = (): void => {
    modal.innerHTML = `<div class="tp-body">${step === 1 ? step1() : step === 2 ? step2() : step3()}</div>`;
    modal.querySelectorAll('.tp-card').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const id = Number((el as HTMLElement).dataset.tid);
        treasureId = id;
        if (affixName && !TREASURES_BY_ID[id].affixPool.includes(affixName)) affixName = null;
        render();
      };
    });
    modal.querySelectorAll('.tp-affix').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        affixName = (el as HTMLElement).dataset.affix ?? null;
        const a = affixOf();
        if (a) value = a.hint?.red ?? a.max;
        step = 3;
        render();
      };
    });
    const range = modal.querySelector('.tp-range') as HTMLInputElement | null;
    range?.addEventListener('input', () => {
      value = Number(range.value);
      const a = affixOf();
      if (!a) return;
      const t = affixTier(a, value);
      const box = modal.querySelector('.tp-value b');
      if (box) {
        box.textContent = fmt(value, a);
        box.className = t;
      }
      const chip = modal.querySelector('.tp-tier');
      if (chip) {
        chip.className = `tp-tier ${t}`;
        chip.textContent = `当前档位：${AFFIX_TIER_NAME[t]}`;
      }
      modal.querySelectorAll('.tp-legend .dot').forEach((d) => {
        const el = d as HTMLElement;
        el.classList.toggle('on', el.classList.contains(t));
      });
    });
    (modal.querySelector('.tp-next') as HTMLElement | null)?.addEventListener('click', () => {
      step = 2;
      render();
    });
    (modal.querySelector('.tp-back') as HTMLElement | null)?.addEventListener('click', () => {
      step = step === 3 ? 2 : 1;
      render();
    });
    (modal.querySelector('.tp-skip') as HTMLElement | null)?.addEventListener('click', () => {
      affixName = null;
      confirm();
    });
    (modal.querySelector('.tp-ok') as HTMLElement | null)?.addEventListener('click', confirm);
  };

  render();
}
