/**
 * 回合伤害图（L2 / L3 共用）：每回合按来源堆叠柱 + 累计虚线。
 * 样式类名沿用 roundModel.css 的 rm-*（optimizer.html 也引该样式表）。
 */
import { SOURCE_ORDER, type RoundModelResult } from './roundModel';

export const SOURCE_COLOR: Record<string, string> = {
  普攻: '#4da3ff',
  追击: '#5ad0e6',
  主动: '#3ddc97',
  准备: '#ffce67',
  一类指挥: '#b48cff',
  二类指挥: '#ff9f6b',
  被动: '#8b93a3',
  持续伤害: '#ff6b6b',
};

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function renderRoundLegend(el: HTMLElement): void {
  el.innerHTML = SOURCE_ORDER.map((s) => `<span><i style="background:${SOURCE_COLOR[s]}"></i>${s}</span>`).join('');
}

/** 画图：柱 = 每回合期望伤害（按来源堆叠），虚线 = 累计；`highlight` = 高亮的口径回合数（默认前三回合） */
export function renderRoundChart(el: HTMLElement, result: RoundModelResult, opts: { highlight?: number } = {}): void {
  const highlight = Math.max(0, Math.min(opts.highlight ?? 3, result.rows.length));
  const W = 960;
  const H = 380;
  const ml = 62;
  const mr = 20;
  const mt = 18;
  const mb = 44;
  const rows = result.rows;
  const top = Math.max(1, result.total);
  const x = (i: number): number => ml + ((i + 0.5) / rows.length) * (W - ml - mr);
  const barW = Math.min(64, ((W - ml - mr) / rows.length) * 0.62);
  const y = (v: number): number => mt + (1 - v / top) * (H - mt - mb);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每回合期望伤害">`;
  for (let i = 0; i <= 4; i += 1) {
    const v = (top * i) / 4;
    svg += `<line class="rm-grid-line" x1="${ml}" y1="${y(v)}" x2="${W - mr}" y2="${y(v)}" />`;
    svg += `<text class="rm-axis" x="${ml - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  const x3 = ml + (highlight / rows.length) * (W - ml - mr);
  if (highlight > 0) {
    svg += `<rect x="${ml}" y="${mt}" width="${Math.max(0, x3 - ml)}" height="${H - mt - mb}" fill="#4da3ff" opacity="0.06" />`;
    svg += `<text class="rm-lbl" x="${(ml + x3) / 2}" y="${mt + 12}" text-anchor="middle">${
      highlight === rows.length ? '整局口径' : `前 ${highlight} 回合口径`
    }</text>`;
  }

  rows.forEach((r, i) => {
    let acc = 0;
    SOURCE_ORDER.forEach((src) => {
      const v = r.bySource[src] ?? 0;
      if (v <= 0) return;
      const y0 = y(acc + v);
      const y1 = y(acc);
      svg += `<rect x="${x(i) - barW / 2}" y="${y0}" width="${barW}" height="${Math.max(0.6, y1 - y0)}" fill="${SOURCE_COLOR[src]}" rx="2" />`;
      acc += v;
    });
    svg += `<text class="rm-axis" x="${x(i)}" y="${H - mb + 16}" text-anchor="middle">${r.round}</text>`;
  });

  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)} ${y(r.cumulative)}`).join(' ');
  svg += `<path d="${line}" fill="none" stroke="#ffce67" stroke-width="2.2" stroke-dasharray="6 4" />`;
  svg += `<text class="rm-lbl" x="${ml}" y="${mt - 4}">伤害 / 累计（同一尺度，柱=每回合，虚线=累计）</text>`;
  svg += `<text class="rm-axis" x="${W - mr}" y="${H - mb + 32}" text-anchor="end">回合</text>`;
  svg += '</svg>';
  el.innerHTML = svg;
}
