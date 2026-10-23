/**
 * 敛微穷极 ·「伤害率 + 浮动区间」视觉自检页（内部脚本 `_` 前缀，仅 dev 用）
 * ---------------------------------------------------------------------------
 * 目的：把真实引擎跑出来的战报挂到主站自己的 `createBattleView` 上，让人眼在**详情战报**里
 * 看到谋略伤害行的「伤害率 X%（浮动 a%~b% → c%）」，并看到状态行逐回合收敛。
 * 数据全部来自引擎，无手写文案。
 *
 * 注意：浏览器侧不能碰 `src/data/heroes.ts`（它会拖进 mysql2）——武将一律用 `web/heroes.ts`
 * 的 `buildGeneral`（主站自己的口径，数据来自 web/data/heroes.json）。
 *
 * 用法（先起服务：`npm run web`）：
 *   http://127.0.0.1:5173/scripts/_flux_shot.html
 * 取证：`window.__FLUX`（每条谋略伤害的 rate / flux + 状态行文案）供 `scripts/_flux_shot.mjs` 读取。
 */
import '../web/styles.css';
import { runBattle } from '../src/engine/combat';
import { buildGeneral } from '../web/heroes';
import { createBattleView } from '../web/battleView';

function main(): void {
  // 刘徽（h814）自带主战法敛微穷极；另一将带迷阵 / 楚歌四起负责打出策略伤害
  const liuhui = buildGeneral('h814', [], {}, '前锋', 0, 40);
  // 烽火覆周发动率 100%：保证每回合都有一条策略伤害，好让「区间逐回合收敛」肉眼可见
  const caster = buildGeneral('h16', ['fenghuo_fuzhou', 'mizhen'], {}, '中军', 0, 40);
  const pacer = buildGeneral('h23', ['fenghuo_fuzhou'], {}, '大营', 0, 40);

  const report = runBattle({
    myTeam: [liuhui, caster, pacer],
    enemyTeam: [
      buildGeneral('h42', [], {}, '前锋', 0, 40),
      buildGeneral('h803', [], {}, '中军', 0, 40),
      buildGeneral('h784', [], {}, '大营', 0, 40),
    ],
    seed: 7,
    maxRounds: 8,
    inertSides: ['enemy'],
  });

  const view = createBattleView(report, { myLabel: '我方（刘徽队）', enemyLabel: '敌方（木桩）' });
  document.getElementById('root')?.append(view.el);

  const hits = report.events
    .filter((e) => e.type === 'damage' && e.damageType === 'strategy')
    .map((e) => {
      const d = e as Extract<typeof e, { type: 'damage' }>;
      return { damage: d.damage, damageRate: d.damageRate, rateFlux: d.rateFlux };
    });
  const applied = report.events
    .filter((e) => e.type === 'status_inflicted' && e.statusType === 'strategy_flux')
    .map((e) => (e as Extract<typeof e, { type: 'status_inflicted' }>).detail);
  const converged = report.events
    .filter((e) => e.type === 'status_changed' && e.statusType === 'strategy_flux')
    .map((e) => (e as Extract<typeof e, { type: 'status_changed' }>).detail);

  const w = window as unknown as Record<string, unknown>;
  w.__FLUX = { hits, applied, converged, rounds: view.roundCount() };
  w.__READY = true;

  w.__setRound = (r: number) => view.setRound(r);
  w.__focus = (round: number) => {
    view.setRound(round);
    // 只认带浮动的那一小字（敌方打我们的事件行也有「伤害率」但不带区间）
    const all = Array.from(document.querySelectorAll<HTMLElement>('.dmg-rate'));
    const rate = all.find((el) => (el.textContent ?? '').includes('浮动')) ?? all[0];
    rate?.scrollIntoView({ block: 'center' });
    return rate ? (rate.textContent ?? '') : '';
  };
}

main();
