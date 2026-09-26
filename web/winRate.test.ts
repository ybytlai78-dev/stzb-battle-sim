// @vitest-environment jsdom
/**
 * 「统计胜率」单测：判定口径（斩首 / 打满回合按剩余兵力 / 完全平）、异步进度、弹窗渲染与关闭。
 * 引擎侧全量覆盖在 Node 测试里；这里只验这一层薄壳。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_HEROES, buildGeneral } from './heroes';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import {
  WIN_RATE_RUNS,
  openWinRatePanel,
  simulateWinRate,
  simulateWinRateAsync,
} from './winRate';

const POSITIONS: General['position'][] = ['大营', '中军', '前锋'];

function heroId(name: string): string {
  const h = ALL_HEROES.find((x) => x.name === name);
  if (!h) throw new Error(`测试武将不存在：${name}`);
  return h.id;
}

/** 组队：站位 大营→中军→前锋，40 级白板（9000 兵）、士气 120、无自由加点 */
function team(names: string[]): General[] {
  return names.map((n, i) => buildGeneral(heroId(n), [], {}, POSITIONS[i] ?? '前锋', 0, 40, 120));
}

const sumTroops = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const RED = ['孙权', '周瑜', '太史慈'];
const BLUE = ['马云禄', '魏延', '张辽'];

describe('统计胜率（200 场快速模拟）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('默认 200 场；同种子同队伍结果可复现、三分类自洽', () => {
    expect(WIN_RATE_RUNS).toBe(200);
    const my = team(RED);
    const enemy = team(BLUE);
    const a = simulateWinRate(my, enemy, { runs: 20, baseSeed: 314159 });
    const b = simulateWinRate(my, enemy, { runs: 20, baseSeed: 314159 });
    const withoutMs = ({ ms: _ms, ...rest }: typeof a): Omit<typeof a, 'ms'> => rest;
    expect(withoutMs(a)).toEqual(withoutMs(b)); // 基础种子 + 场次 → 完全可复现（耗时除外）
    expect(a.runs).toBe(20);
    expect(a.win + a.loss + a.draw).toBe(20);
    expect(a.winRate + a.lossRate + a.drawRate).toBeCloseTo(1, 10);
    // 构成拆分守恒：斩首 / 兵力判定 / 完全平
    expect(a.decapWin + a.troopWin).toBe(a.win);
    expect(a.decapLoss + a.troopLoss).toBe(a.loss);
    expect(a.troopWin + a.troopLoss + a.evenDraw).toBe(a.capped);
    expect(a.capped).toBeLessThanOrEqual(20);
  });

  it('打满回合（引擎原生平局）按剩余兵力判定：不等则分胜负，完全相同才算平', () => {
    const my = team(RED);
    const enemy = team(BLUE);
    let capped = 0;
    for (let seed = 4000; seed < 4040; seed += 1) {
      // 手跑一场（独立新对象，避免与统计内部共享引用）拿引擎原生结果
      const report = runBattle({ myTeam: team(RED), enemyTeam: team(BLUE), seed, maxRounds: 8 });
      const one = simulateWinRate(my, enemy, { runs: 1, baseSeed: seed });
      const myTroops = sumTroops(report.finalMyTroops);
      const enemyTroops = sumTroops(report.finalEnemyTroops);
      expect(one.win + one.loss + one.draw).toBe(1);
      if (report.result === 'draw') {
        capped += 1;
        expect(one.capped).toBe(1);
        if (myTroops === enemyTroops) {
          expect(one.evenDraw).toBe(1);
          expect(one.draw).toBe(1);
        } else if (myTroops > enemyTroops) {
          expect(one.troopWin).toBe(1);
          expect(one.draw).toBe(0);
        } else {
          expect(one.troopLoss).toBe(1);
          expect(one.draw).toBe(0);
        }
      } else if (report.result === 'win') {
        expect(one.decapWin).toBe(1);
      } else {
        expect(one.decapLoss).toBe(1);
      }
    }
    expect(capped, '该组合应出现打满 8 回合（引擎原生平局）').toBeGreaterThan(0);
  });

  it('交换红蓝后两次统计必然互补（胜率之和 = 100%）——每颗种子正/反各跑一场', () => {
    // 用「镜像队」（同阵容同加点，速度全同、引擎本身有红先手偏向）验证统计层已做正反对调
    const A = team(['孙权', '周瑜', '太史慈']);
    const B = team(['孙权', '周瑜', '太史慈']);
    const ab = simulateWinRate(A, B, { runs: 60, baseSeed: 540720 });
    const ba = simulateWinRate(B, A, { runs: 60, baseSeed: 540720 });
    expect(ab.runs).toBe(60);
    expect(ba.runs).toBe(60);
    // 60 场 = 30 颗种子 × 正/反两场：每场或分胜负（两方各计 1 胜）、或完全平（两边都记平）
    expect(ab.win + ba.win + (ab.draw + ba.draw) / 2).toBe(60);
    expect(ab.winRate + ba.winRate + (ab.drawRate + ba.drawRate) / 2).toBeCloseTo(1, 10);
  });

  it('异步版分片跑批并回报进度（页面用）', async () => {
    const seen: number[] = [];
    const s = await simulateWinRateAsync(team(['太史慈']), team(['马云禄']), {
      runs: 12,
      baseSeed: 88,
      yieldEvery: 5,
      onProgress: (done) => seen.push(done),
    });
    expect(s.runs).toBe(12);
    expect(s.win + s.loss + s.draw).toBe(12);
    expect(seen[seen.length - 1]).toBe(12);
    expect(seen.length).toBeGreaterThan(1); // 分片
  });

  it('弹窗：先显进度条 → 跑完渲染 胜/平/负 三行概率（含场次）→ 可关闭', async () => {
    const my = team(['太史慈']);
    const enemy = team(['马云禄']);
    const mask = openWinRatePanel({ myTeam: my, enemyTeam: enemy, runs: 10, baseSeed: 12345, yieldEvery: 4 });
    expect(mask.dataset.state).toBe('running');
    expect(mask.querySelector('.wr-status')!.textContent).toContain('模拟中');

    await vi.waitFor(() => expect(mask.dataset.state).toBe('done'));
    expect((mask.querySelector('.wr-live') as HTMLElement).hidden).toBe(true);

    const rows = Array.from(mask.querySelectorAll('.wr-row'));
    expect(rows.map((r) => r.querySelector('.wr-label')!.textContent)).toEqual(['胜利', '平局', '失败']);
    const counts = rows.map((r) => Number(/^(\d+) 场$/.exec(r.querySelector('.wr-n')!.textContent!)![1]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    rows.forEach((r, i) => {
      expect(r.querySelector('.wr-pct')!.textContent).toBe(`${((counts[i] / 10) * 100).toFixed(1)}%`);
    });
    // 口径与种子可复现说明都在面板里
    expect(mask.textContent).toContain('打满 8 回合');
    expect(mask.textContent).toContain('基础种子 12345');
    expect(mask.textContent).toContain('12345~12349');
    expect(mask.textContent).toContain('必然互补');

    (mask.querySelector('.wr-done') as HTMLElement).click();
    expect(document.querySelector('.wr-mask')).toBeNull();
  });

  it('连点两次只留一层弹窗（旧面板先撤下）', async () => {
    const my = team(['太史慈']);
    const enemy = team(['马云禄']);
    openWinRatePanel({ myTeam: my, enemyTeam: enemy, runs: 6, baseSeed: 11, yieldEvery: 3 });
    const second = openWinRatePanel({ myTeam: my, enemyTeam: enemy, runs: 6, baseSeed: 22, yieldEvery: 3 });
    expect(document.querySelectorAll('.wr-mask').length).toBe(1);
    await vi.waitFor(() => expect(second.dataset.state).toBe('done'));
    expect(second.textContent).toContain('基础种子 22');
    (second.querySelector('.m-close') as HTMLElement).click();
    expect(document.querySelector('.wr-mask')).toBeNull();
  });
});
