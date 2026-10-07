import { ECONOMY } from '../../src/rogue/economy';
import type { PendingPull } from '../../src/rogue/types';
import { esc } from './dom';

/**
 * 抽卡页：未付款 / 五选一 / 等待爽玩。
 * @param view 当前抽卡状态
 */
export function gachaHtml(view: {
  pull: PendingPull | null;
  canPay: boolean;
  feedback: string;
  nameOf: (heroId: string) => string;
  portraitOf: (heroId: string) => string;
}): string {
  const feedback = `<p id="rg-feedback">${esc(view.feedback)}</p>`;
  if (!view.pull) {
    return `
      <section id="rg-gacha">
        <h2>五连抽</h2>
        <p>一次 ${ECONOMY.gachaCost} 玉符。建议开局抽 ${ECONOMY.openingPulls} 次：五张里选一张，再点「爽玩」免费再得一张。</p>
        <button id="rg-pull" type="button" ${view.canPay ? '' : 'disabled'}>五连抽</button>
        ${feedback}
      </section>`;
  }
  if (!view.pull.picked) {
    const cards = view.pull.shown
      .map((heroId, index) => {
        const portrait = view.portraitOf(heroId);
        const img = portrait ? `<img alt="" src="${esc(portrait)}" />` : '';
        return `<button id="rg-card-${index}" class="rg-card" type="button">${img}<span>${esc(view.nameOf(heroId))}</span></button>`;
      })
      .join('');
    return `
      <section id="rg-gacha">
        <h2>五选一</h2>
        <div class="rg-cards">${cards}</div>
        ${feedback}
      </section>`;
  }
  return `
    <section id="rg-gacha">
      <h2>爽玩</h2>
      <p>已选 ${esc(view.nameOf(view.pull.picked))}。再免费随机获得一名武将。</p>
      <button id="rg-bonus" type="button">爽玩</button>
      ${feedback}
    </section>`;
}
