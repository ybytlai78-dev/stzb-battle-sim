import type { Position } from '../../src/engine/types';
import type { HeroSlot } from '../../src/rogue/types';
import type { SkillRow } from './skillFilter';
import { skillTypeLabel } from './catalogue';
import { esc } from './dom';

const POSITIONS: readonly Position[] = ['前锋', '中军', '大营'];

export interface TeamDraft {
  heroes: string[];
  skills: string[][];
  treasures: string[];
  query: string;
  grade: string;
  type: string;
  focusSlot: number;
  focusIndex: number;
}

/**
 * 组队页。战法列表由搜索和品级筛过，不一次铺开整个背包。
 * @param root 挂载点
 * @param view 卡池、草稿和出战回调
 */
export function renderTeam(
  root: HTMLElement,
  view: {
    heroes: HeroSlot[];
    nameOf: (heroId: string) => string;
    choices: (query: string, grade: string, type: string) => SkillRow[];
    skillName: (skillId: string) => string;
    treasures: Array<{ id: string; name: string }>;
    draft: TeamDraft;
    onFight: () => void;
  },
): void {
  const heroOptions = (selected: string) =>
    view.heroes
      .map((hero) => {
        const label = `${view.nameOf(hero.heroId)} · ${hero.redness}红 · ${hero.level}级 · 兵${hero.troops}`;
        const on = hero.heroId === selected ? 'selected' : '';
        return `<option value="${esc(hero.heroId)}" ${on}>${esc(label)}</option>`;
      })
      .join('');
  const treasureOptions = (selected: string) =>
    [`<option value="">不佩戴</option>`]
      .concat(
        view.treasures.map((treasure) => {
          const on = treasure.id === selected ? 'selected' : '';
          return `<option value="${esc(treasure.id)}" ${on}>${esc(treasure.name)}</option>`;
        }),
      )
      .join('');
  const slots = POSITIONS.map((position, index) => {
    const skillButtons = [0, 1]
      .map((skillIndex) => {
        const id = view.draft.skills[index]?.[skillIndex] ?? '';
        const label = id ? view.skillName(id) : '空';
        return `<button type="button" class="rg-skill-slot" data-slot="${index}" data-idx="${skillIndex}">战法${skillIndex + 1}：${esc(label)}</button>`;
      })
      .join('');
    return `
      <fieldset>
        <legend>${position}</legend>
        <select id="rg-hero-${index}">${heroOptions(view.draft.heroes[index] ?? '')}</select>
        ${skillButtons}
        <select id="rg-trs-${index}">${treasureOptions(view.draft.treasures[index] ?? '')}</select>
      </fieldset>`;
  }).join('');

  root.innerHTML = `
    <section id="rg-team">
      <h2>组队</h2>
      <p class="rg-note">先点一个战法槽，再用下面的筛选结果填进去。主战法自动携带。</p>
      ${slots}
      <div class="rg-filters">
        <input id="rg-skill-q" type="search" placeholder="搜索战法" value="${esc(view.draft.query)}" />
        ${['ALL', 'D', 'C', 'B', 'A', 'S'].map((grade) => `<button type="button" class="rg-grade" data-grade="${grade}">${grade === 'ALL' ? '全部品级' : grade}</button>`).join('')}
        ${['ALL', 'active', 'command', 'passive', 'pursuit'].map((type) => `<button type="button" class="rg-type" data-type="${type}">${type === 'ALL' ? '全部类型' : skillTypeLabel(type)}</button>`).join('')}
      </div>
      <div id="rg-skill-list"></div>
      <p id="rg-team-error"></p>
      <button id="rg-fight" type="button">出战</button>
    </section>`;

  const paintList = () => {
    const list = root.querySelector('#rg-skill-list');
    if (!list) return;
    const rows = view.choices(view.draft.query, view.draft.grade, view.draft.type);
    list.innerHTML = rows
      .map(
        (row) =>
          `<button type="button" class="rg-skill-pick" data-skill="${esc(row.id)}">${esc(row.name)} · ${esc(row.grade)} · ${esc(skillTypeLabel(row.type))}</button>`,
      )
      .join('') || '<p>没有符合筛选的战法</p>';
    list.querySelectorAll<HTMLButtonElement>('.rg-skill-pick').forEach((button) => {
      button.addEventListener('click', () => {
        const skillId = button.dataset.skill ?? '';
        const slot = view.draft.skills[view.draft.focusSlot] ?? ['', ''];
        if (slot.includes(skillId)) return;
        slot[view.draft.focusIndex] = skillId;
        view.draft.skills[view.draft.focusSlot] = slot;
        const label = root.querySelector<HTMLButtonElement>(
          `.rg-skill-slot[data-slot="${view.draft.focusSlot}"][data-idx="${view.draft.focusIndex}"]`,
        );
        if (label) label.textContent = `战法${view.draft.focusIndex + 1}：${view.skillName(skillId)}`;
      });
    });
  };
  paintList();

  root.querySelectorAll<HTMLButtonElement>('.rg-skill-slot').forEach((button) => {
    button.addEventListener('click', () => {
      view.draft.focusSlot = Number(button.dataset.slot);
      view.draft.focusIndex = Number(button.dataset.idx);
    });
  });
  root.querySelector('#rg-skill-q')!.addEventListener('input', (event) => {
    view.draft.query = (event.target as HTMLInputElement).value;
    paintList();
  });
  root.querySelectorAll<HTMLButtonElement>('.rg-grade').forEach((button) => {
    button.addEventListener('click', () => {
      view.draft.grade = button.dataset.grade ?? 'ALL';
      paintList();
    });
  });
  root.querySelectorAll<HTMLButtonElement>('.rg-type').forEach((button) => {
    button.addEventListener('click', () => {
      view.draft.type = button.dataset.type ?? 'ALL';
      paintList();
    });
  });
  root.querySelector('#rg-fight')!.addEventListener('click', view.onFight);
}

export { POSITIONS };
