import type { SkillRow } from './skillFilter';
import { filterSkills } from './skillFilter';
import { skillTypeLabel } from './catalogue';
import { esc } from './dom';

/**
 * 商店页。货架按搜索展示，玉符不够时按钮禁用。
 * @param root 挂载点
 * @param view 货架与购买回调
 */
export function renderShop(
  root: HTMLElement,
  view: {
    rows: SkillRow[];
    jade: number;
    priceOf: (grade: string) => number;
    onBuy: (skillId: string) => void;
  },
): void {
  let query = '';
  let grade = 'ALL';
  const paint = () => {
    const shown = filterSkills(view.rows, query, grade, 'ALL', 24);
    const list = root.querySelector('#rg-shop-list');
    if (!list) return;
    list.innerHTML =
      shown
        .map((row) => {
          const price = view.priceOf(row.grade);
          const disabled = view.jade < price ? 'disabled' : '';
          return `<button type="button" class="rg-buy" data-skill="${esc(row.id)}" ${disabled}>${esc(row.name)} · ${esc(row.grade)} · ${esc(skillTypeLabel(row.type))} · ${price}</button>`;
        })
        .join('') || '<p>没有符合筛选的战法</p>';
    list.querySelectorAll<HTMLButtonElement>('.rg-buy').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        view.onBuy(button.dataset.skill ?? '');
      });
    });
  };
  root.innerHTML = `
    <section id="rg-shop">
      <h2>商店</h2>
      <p class="rg-note">只卖还没拥有的 A/S。搜索名称后再买，避免把整架铺开。</p>
      <input id="rg-shop-q" type="search" placeholder="搜索战法" />
      <div class="rg-filters">
        <button type="button" class="rg-shop-grade" data-grade="ALL">全部</button>
        <button type="button" class="rg-shop-grade" data-grade="A">A · 600</button>
        <button type="button" class="rg-shop-grade" data-grade="S">S · 1200</button>
      </div>
      <p id="rg-shop-msg"></p>
      <div id="rg-shop-list"></div>
    </section>`;
  root.querySelector('#rg-shop-q')!.addEventListener('input', (event) => {
    query = (event.target as HTMLInputElement).value;
    paint();
  });
  root.querySelectorAll<HTMLButtonElement>('.rg-shop-grade').forEach((button) => {
    button.addEventListener('click', () => {
      grade = button.dataset.grade ?? 'ALL';
      paint();
    });
  });
  paint();
}

/**
 * 在商店页上写一条提示。
 * @param root 挂载点
 * @param message 提示
 */
export function setShopMessage(root: HTMLElement, message: string): void {
  const node = root.querySelector('#rg-shop-msg');
  if (node) node.textContent = message;
}
