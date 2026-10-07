import { remainingToMax } from '../../src/rogue/pool';
import type { PoolState } from '../../src/rogue/types';
import { esc } from './dom';

/**
 * 卡池页：红度、等级、兵力、还差几次满红。
 * @param view 卡池与展示名
 */
export function poolHtml(view: {
  pool: PoolState;
  nameOf: (heroId: string) => string;
  portraitOf: (heroId: string) => string;
}): string {
  const cards = view.pool.heroes
    .map((hero) => {
      const portrait = view.portraitOf(hero.heroId);
      const img = portrait ? `<img alt="" src="${esc(portrait)}" />` : '';
      const left = remainingToMax(hero.copies);
      return `<article class="rg-hero-card">${img}<h3>${esc(view.nameOf(hero.heroId))}</h3><p>${hero.redness} 红 · ${hero.level} 级</p><p>兵力 ${hero.troops}/${hero.maxTroops}</p><p>${left === 0 ? '已满红' : `还差 ${left} 次满红`}</p></article>`;
    })
    .join('');
  return `
    <section id="rg-pool">
      <h2>卡池 · ${view.pool.heroes.length} 人 · 战法 ${view.pool.skills.length} · 宝物 ${view.pool.treasures.length}</h2>
      <div class="rg-cards">${cards || '<p>还没有武将。先去五连抽。</p>'}</div>
    </section>`;
}
