import { diagnoseBattle } from '../../src/engine/diagnosis';
import { reportToText } from '../../src/engine/report';
import { computeDetailedStats } from '../../src/engine/stats';
import { SKILL_REGISTRY } from '../../src/data/skills';
import type { BattleReport } from '../../src/engine/types';
import type { Outcome } from '../../src/rogue/types';
import { esc } from './dom';

const OUTCOME_LABEL: Record<Outcome, string> = { win: '胜', lose: '败', draw: '平' };

/**
 * 战报页：胜负、兵力、败因、战法统计、逐回合文本。
 * @param root 挂载点
 * @param view 本场战报与继续回调
 */
export function renderReport(
  root: HTMLElement,
  view: { report: BattleReport; outcome: Outcome; elite: boolean; onNext: () => void },
): void {
  const { report, outcome } = view;
  const bars = report.myTeam
    .map((general, index) => {
      const left = report.finalMyTroops[index] ?? 0;
      const max = Math.max(1, general.maxTroops);
      const pct = Math.max(0, Math.min(100, Math.round((left / max) * 100)));
      return `<div class="rg-troop"><span>${esc(general.name)} ${left}/${general.maxTroops}</span><div class="rg-bar"><i style="width:${pct}%"></i></div></div>`;
    })
    .join('');
  const shares = report.stats
    .filter((row) => row.side === 'my')
    .map((row) => `<li>${esc(row.name)}：战法 ${row.skillCount} 次 / 伤害 ${Math.round(row.skillDamage)}，普攻伤害 ${Math.round(row.attackDamage)}</li>`)
    .join('');
  const detailed = computeDetailedStats(report.events, []);
  const casts = detailed
    .flatMap((unit) => unit.skills.filter((skill) => skill.castCount > 0).map((skill) => {
      const name = SKILL_REGISTRY[skill.skillId]?.name ?? skill.skillId;
      return `<li>${esc(name)}：出手 ${skill.castCount} 次，伤害 ${Math.round(skill.damage)}</li>`;
    }))
    .slice(0, 12)
    .join('');
  let cause = '';
  try {
    const diagnosis = diagnoseBattle(report);
    const lines = diagnosis.issues.map((issue) => `${issue.label}：${issue.detail}`);
    cause = lines.length > 0 ? lines.join('\n') : diagnosis.verdict.summary;
  } catch (error) {
    cause = error instanceof Error ? error.message : '败因分析失败';
  }
  root.innerHTML = `
    <section id="rg-report">
      <h2>战报 · ${OUTCOME_LABEL[outcome]} · 第 ${report.rounds} 回合结束</h2>
      ${view.elite ? '<p class="rg-note">幕末精英关：突破奖励本版未开放。</p>' : ''}
      <div id="rg-troops">${bars}</div>
      <h3>败因</h3>
      <pre id="rg-cause">${esc(cause)}</pre>
      <h3>贡献</h3>
      <ul>${shares}</ul>
      <h3>战法统计</h3>
      <ul>${casts || '<li>本场没有记到战法出手</li>'}</ul>
      <h3>逐回合</h3>
      <pre id="rg-timeline"></pre>
      <button id="rg-next" type="button">继续</button>
    </section>`;
  const timeline = root.querySelector('#rg-timeline');
  if (timeline) timeline.textContent = reportToText(report);
  root.querySelector('#rg-next')!.addEventListener('click', view.onNext);
}
