import type { EnemySlot, HeroSlot } from '../../src/rogue/types';
import { SKILL_REGISTRY } from '../../src/data/skills';
import { asset } from '../assets';
import {
  avatarSrc,
  cardFrameSrc,
  factionIconSrc,
  getHeroById,
  gradeFrame,
  gradePlate,
  gradeRibbon,
  portraitSrc,
  rednessStars,
  skillGrade,
  skillTypeIcon,
  TROOP_CHAR,
} from '../heroes';
import { slotTreasureHtml, type SlotState } from '../teamEditor';
import { esc } from './dom';

const TROOP_NAME: Record<string, string> = { cavalry: '骑兵', infantry: '步兵', archer: '弓兵' };
/** 拖完松手会再冒出一次 click，这次不要打开详情。 */
let suppressSlotClick = false;

/**
 * 战法圆标：类型剪影 + 品级环 + 品级角标，和主站槽位同一套图。
 * @param skillId 战法 id
 * @param size 边长像素
 */
export function skillBadgeHtml(skillId: string, size = 46): string {
  const grade = skillGrade(skillId);
  return `<span class="sslot-icon" style="width:${size}px;height:${size}px"><img class="ti" src="${esc(skillTypeIcon(skillId))}" alt="" /><img class="kf" src="${esc(gradeFrame(grade))}" alt="" /><img class="rb" src="${esc(gradeRibbon(grade))}" alt="" /></span>`;
}

/**
 * 主站槽位上的一列战法：圆标在上，名字压在品级板上。
 * @param skillId 战法 id
 * @param main 是否主战法
 * @param extra 写在列上的 data 属性，用来接下落
 * @param focused 当前准备装配的那一格
 */
function skillColumnHtml(skillId: string, main: boolean, extra: string, focused = false): string {
  const skill = SKILL_REGISTRY[skillId];
  if (!skill) return '';
  const grade = skillGrade(skillId).toLowerCase();
  const plate = gradePlate(grade);
  const plateAttr = plate ? ` style="background-image:url('${esc(plate)}')"` : '';
  return `<div class="slot-skill grade-${grade}${main ? ' main' : ''} rg-skill-slot${focused ? ' rg-on' : ''}" ${extra}>${skillBadgeHtml(skillId, 48)}<span class="slot-skill-name${plate ? ' has-plate' : ''}"${plateAttr}>${esc(skill.name)}</span></div>`;
}

export type BoardDrag =
  | { kind: 'hero'; heroId: string }
  | { kind: 'slot'; index: number }
  | { kind: 'skill'; skillId: string }
  | { kind: 'treasure'; treasureId: string };

/**
 * 把拖拽载荷写进 dataTransfer。武将从卡池拖出，槽位之间是移动。
 * @param event 拖拽开始事件
 * @param payload 载荷
 */
export function setBoardDrag(event: DragEvent, payload: BoardDrag): void {
  event.dataTransfer?.setData('text/plain', JSON.stringify(payload));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = payload.kind === 'hero' || payload.kind === 'skill' || payload.kind === 'treasure' ? 'copy' : 'move';
}

/**
 * 读回拖拽载荷。不是本页写下的内容时返回 null。
 * @param event 放下事件
 */
export function readBoardDrag(event: DragEvent): BoardDrag | null {
  const raw = event.dataTransfer?.getData('text/plain') ?? '';
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BoardDrag>;
    if (parsed.kind === 'hero' && typeof parsed.heroId === 'string') return { kind: 'hero', heroId: parsed.heroId };
    if (parsed.kind === 'slot' && typeof parsed.index === 'number') return { kind: 'slot', index: parsed.index };
    if (parsed.kind === 'skill' && typeof parsed.skillId === 'string') return { kind: 'skill', skillId: parsed.skillId };
    if (parsed.kind === 'treasure' && typeof parsed.treasureId === 'string') return { kind: 'treasure', treasureId: parsed.treasureId };
  } catch {
    return null;
  }
  return null;
}

/**
 * 卡池里的一张武将卡，结构和模拟器武将池一致，星级用本局红度。
 * @param hero 卡池槽位
 */
export function ownedCardHtml(hero: HeroSlot): string {
  const record = getHeroById(hero.heroId);
  const art = portraitSrc(hero.heroId);
  const frame = cardFrameSrc();
  const faction = record?.faction ?? '';
  const troop = TROOP_CHAR[record?.troopType ?? ''] ?? '?';
  const sp = record?.tags.includes('sp') ? '<div class="sp-badge">SP</div>' : '';
  return `
    <img class="art" src="${esc(art)}" alt="" draggable="false" />
    <div class="frame" style="background-image:url('${esc(frame)}')"></div>
    <div class="plate">
      <img class="fac" alt="${esc(faction)}" src="${esc(factionIconSrc(faction))}" draggable="false" />
      <div class="n">${esc(record?.name ?? hero.heroId)}</div>
      ${sp}
      <div class="stars">${rednessStars(hero.redness)}</div>
      <div class="bar">
        <span class="lv"><i>Lv.</i>${hero.level}</span>
        <span class="troop">${esc(troop)}</span>
      </div>
    </div>`;
}

export interface SlotHandlers {
  onFocus: (index: number, skillIndex: number) => void;
  /** 点已上阵武将：打开和主站相同的详情 */
  onOpen: (index: number) => void;
  /** 点战法槽：切到战法背包 */
  onSkillSlot: (index: number, skillIndex: number) => void;
  onHero: (index: number, heroId: string) => void;
  onMove: (from: number, to: number) => void;
  onSkill: (index: number, skillId: string) => void;
  onTreasure: (index: number, treasureId: string) => void;
  onClear: (index: number) => void;
}

/**
 * 已上阵武将的主站卡面：左画像，右站位、宝物、等级兵种、主战法与携带战法。
 * @param args 这一格要画的内容
 */
function filledSlotHtml(args: {
  label: string;
  heroId: string;
  name: string;
  redness: number;
  level: number;
  extraSkillIds: readonly string[];
  loadout: Pick<SlotState, 'freePoints' | 'secondaryTroop' | 'secondaryTraits' | 'treasure'>;
  skillExtra: (main: boolean, extraIndex: number) => string;
  focused: (main: boolean, extraIndex: number) => boolean;
}): string {
  const record = getHeroById(args.heroId);
  const traits = (args.loadout.secondaryTraits ?? []).filter((trait) => trait.length > 0);
  const troopName = args.loadout.secondaryTroop ?? TROOP_NAME[record?.troopType ?? ''] ?? '兵种';
  const troopChar = args.loadout.secondaryTroop ?? TROOP_CHAR[record?.troopType ?? ''] ?? '?';
  const slotState: SlotState = {
    heroId: args.heroId,
    extraSkillIds: args.extraSkillIds.filter((id) => id.length > 0),
    freePoints: args.loadout.freePoints,
    redness: args.redness,
    level: args.level,
    secondaryTroop: args.loadout.secondaryTroop,
    secondaryTraits: args.loadout.secondaryTraits,
    treasure: args.loadout.treasure,
  };
  const mainId = record?.mainSkillId && SKILL_REGISTRY[record.mainSkillId] ? record.mainSkillId : '';
  const columns = [
    mainId ? skillColumnHtml(mainId, true, args.skillExtra(true, -1), args.focused(true, -1)) : '',
    ...args.extraSkillIds.map((skillId, extraIndex) =>
      skillId ? skillColumnHtml(skillId, false, args.skillExtra(false, extraIndex), args.focused(false, extraIndex)) : '',
    ),
  ].join('');
  const skills = columns || '<span class="tip">无战法（主战法未实现）</span>';
  return `
    <div class="slot-inner">
      <div class="slot-card">
        <div class="slot-art" style="background-image:url('${esc(portraitSrc(args.heroId))}')"></div>
        <div class="frame" style="background-image:url('${esc(cardFrameSrc())}')"></div>
        <div class="plate">
          <img class="fac" alt="" src="${esc(factionIconSrc(record?.faction ?? ''))}" draggable="false" />
          <div class="hero-name">${esc(args.name)}</div>
          ${record?.tags.includes('sp') ? '<div class="sp-badge">SP</div>' : ''}
          <div class="hero-stars">${rednessStars(args.redness)}</div>
          <div class="card-bar"><span class="lv"><i>Lv.</i>${args.level}</span><span class="troop">${esc(troopChar)}</span></div>
        </div>
      </div>
      <div class="slot-main">
        <div class="hero-line">
          <span class="slot-label">${esc(args.label)}</span>
          <img class="slot-avatar" src="${esc(avatarSrc(args.heroId))}" alt="" draggable="false" />
          ${slotTreasureHtml(slotState)}
        </div>
        <div class="slot-meta">
          <span class="sm-lv">Lv.${args.level}</span>
          <span class="sm-sep">·</span>
          <span class="sm-troop">${esc(troopName)}${traits.length ? `<i>（${esc(traits.join(' + '))}）</i>` : ''}</span>
        </div>
        <div class="hero-skills">${skills}</div>
      </div>
    </div>`;
}

/**
 * 重画左边三个站位，并接上拖入、拖出、换位。
 * @param host 槽位容器
 * @param view 当前草稿
 * @param handlers 放下之后怎么改草稿
 */
export function renderSlots(
  host: HTMLElement,
  view: {
    labels: readonly string[];
    heroes: readonly string[];
    skills: readonly (readonly string[])[];
    treasures: readonly string[];
    loadouts: readonly Pick<SlotState, 'freePoints' | 'secondaryTroop' | 'secondaryTraits' | 'treasure'>[];
    focusSlot: number;
    focusIndex: number;
    nameOf: (heroId: string) => string;
    skillName: (skillId: string) => string;
    treasureName: (treasureId: string) => string;
    rednessOf: (heroId: string) => number;
    levelOf: (heroId: string) => number;
  },
  handlers: SlotHandlers,
): void {
  host.innerHTML = view.labels
    .map((label, index) => {
      const heroId = view.heroes[index] ?? '';
      const on = index === view.focusSlot ? ' rg-on' : '';
      if (!heroId) {
        return `<div class="slot empty${on}" data-slot="${index}"><img class="slot-add-icon" src="${esc(asset('/skills/slot-add.png'))}" alt="" /><span>拖入 ${esc(label)}</span></div>`;
      }
      return `
        <div class="slot${on}" data-slot="${index}" data-hero-id="${esc(heroId)}" title="点击查看详情">
          ${filledSlotHtml({
            label,
            heroId,
            name: view.nameOf(heroId),
            redness: view.rednessOf(heroId),
            level: view.levelOf(heroId),
            extraSkillIds: view.skills[index] ?? [],
            loadout: view.loadouts[index] ?? {
              freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
              treasure: null,
            },
            skillExtra: (_main, extraIndex) => `data-slot="${index}" data-idx="${extraIndex}"`,
            focused: (main, extraIndex) => !main && index === view.focusSlot && extraIndex === view.focusIndex,
          })}
        </div>`;
    })
    .join('');

  /**
   * 允许放下，并写成来源许可的效果。
   * 卡池 / 战法是 copy，槽位换位是 move。写成不允许的效果时，Chrome 会取消 drop。
   * @param event 拖过或进入
   */
  const allowDrop = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    }
    const slot = (event.currentTarget as HTMLElement).closest('.slot');
    slot?.classList.add('drag-over');
  };
  /**
   * 把放下的武将、换位、战法或宝物应用到这个站位。
   * @param index 站位
   * @param event 放下事件
   * @param skillIndex 战法槽序号；只有放下战法时用
   */
  const applyDrop = (index: number, event: DragEvent, skillIndex = view.focusIndex) => {
    const payload = readBoardDrag(event);
    if (!payload) return;
    if (payload.kind === 'hero') handlers.onHero(index, payload.heroId);
    else if (payload.kind === 'slot') handlers.onMove(payload.index, index);
    else if (payload.kind === 'skill') {
      handlers.onFocus(index, skillIndex);
      handlers.onSkill(index, payload.skillId);
    } else handlers.onTreasure(index, payload.treasureId);
  };
  host.querySelectorAll<HTMLElement>('.slot').forEach((slot) => {
    const index = Number(slot.dataset.slot);
    slot.addEventListener('dragenter', allowDrop);
    slot.addEventListener('dragover', allowDrop);
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      slot.classList.remove('drag-over');
      applyDrop(index, event);
    });
    slot.addEventListener('click', () => {
      if (suppressSlotClick) return;
      if (slot.dataset.heroId) handlers.onOpen(index);
      else handlers.onFocus(index, view.focusIndex);
    });
    if (slot.dataset.heroId) {
      slot.draggable = true;
      slot.addEventListener('dragstart', (event) => {
        setBoardDrag(event, { kind: 'slot', index });
        slot.classList.add('dragging');
      });
      slot.addEventListener('dragend', () => {
        slot.classList.remove('dragging');
        suppressSlotClick = true;
        setTimeout(() => {
          suppressSlotClick = false;
        }, 0);
      });
    }
  });
  host.querySelectorAll<HTMLElement>('.rg-skill-slot').forEach((button) => {
    button.addEventListener('dragenter', (event) => {
      allowDrop(event);
      event.stopPropagation();
    });
    button.addEventListener('dragover', (event) => {
      allowDrop(event);
      event.stopPropagation();
    });
    button.addEventListener('dragleave', () => button.closest('.slot')?.classList.remove('drag-over'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.closest('.slot')?.classList.remove('drag-over');
      const skillIndex = Number(button.dataset.idx);
      applyDrop(Number(button.dataset.slot), event, skillIndex < 0 ? view.focusIndex : skillIndex);
    });
  });
}

/**
 * 中间武将池：只放这一局已经抽到的武将，拖到左边即上阵。
 * @param grid 卡片网格
 * @param view 卡池与搜索
 * @param onPick 点卡或拖到槽位之外时，放进当前焦点槽
 */
export function renderOwnedGrid(
  grid: HTMLElement,
  view: {
    heroes: readonly HeroSlot[];
    query: string;
    picked: ReadonlySet<string>;
    nameOf: (heroId: string) => string;
    mainSkillOf: (heroId: string) => string;
  },
  onPick: (heroId: string) => void,
): void {
  const q = view.query.trim();
  const shown = view.heroes.filter((hero) => !q || view.nameOf(hero.heroId).includes(q));
  grid.innerHTML = shown
    .map((hero) => {
      const picked = view.picked.has(hero.heroId) ? ' picked' : '';
      const title = `主战法 ${view.mainSkillOf(hero.heroId)}`;
      return `<div class="hero-card${picked}" draggable="true" data-hero-id="${esc(hero.heroId)}" title="${esc(title)}">${ownedCardHtml(hero)}</div>`;
    })
    .join('') || '<p>还没有武将。先去招募。</p>';
  grid.querySelectorAll<HTMLElement>('.hero-card').forEach((card) => {
    const heroId = card.dataset.heroId ?? '';
    card.addEventListener('dragstart', (event) => setBoardDrag(event, { kind: 'hero', heroId }));
    card.addEventListener('click', () => onPick(heroId));
  });
}

const LINEUP = ['大营', '中军', '前锋'] as const;

/**
 * 右侧敌方阵容，站位顺序与主站蓝队相同：大营、中军、前锋。只展示，不能改。
 * @param host 蓝队槽位容器
 * @param view 本关敌军
 */
export function renderEnemySlots(
  host: HTMLElement,
  view: {
    slots: readonly EnemySlot[];
    nameOf: (heroId: string) => string;
    skillName: (skillId: string) => string;
    mainSkillOf: (heroId: string) => string;
  },
): void {
  host.innerHTML = LINEUP.map((label) => {
    const slot = view.slots.find((item) => item.position === label);
    if (!slot) {
      return `<div class="slot empty"><img class="slot-add-icon" src="${esc(asset('/skills/slot-add.png'))}" alt="" /><span>${esc(label)}</span></div>`;
    }
    return `
      <div class="slot" data-hero-id="${esc(slot.heroId)}">
        ${filledSlotHtml({
          label,
          heroId: slot.heroId,
          name: view.nameOf(slot.heroId),
          redness: slot.redness,
          level: slot.level,
          extraSkillIds: slot.skillIds,
          loadout: { freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 }, treasure: null },
          skillExtra: () => '',
          focused: () => false,
        })}
      </div>`;
  }).join('');
}
