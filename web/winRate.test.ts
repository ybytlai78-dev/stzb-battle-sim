/**
 * 「统计胜率」四档判定 + 战损比（用户 2026-11-06 口径）
 * ---------------------------------------------------------------------------
 * 这一组测试要守住三件最容易被算反 / 算错的事：
 *  ① 四档互斥且守恒：胜利 + 优势平 + 劣势平 + 失败 = 总场次（完全平并入优势平）；
 *  ② 战损比 = **每场比值的算术平均**（不是总量比），分母 0 的场次跳过、全跳过给 null；
 *  ③ `swap` 场的阵亡数必须还原成我方视角（否则一半场次分子分母颠倒）。
 * 另外锁住旧的 `win / draw / loss` 三桶语义 —— `poolMatchup` / `templateSearch` / `advisor/*` 共用它。
 */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import {
  deathRatioText,
  mapDeaths,
  playOne,
  resultHtml,
  summarizePlays,
  simulateWinRate,
  simulateWinRateSample,
  type PlayedBattle,
} from './winRate';

const POSITIONS: General['position'][] = ['前锋', '中军', '大营'];

function makeGeneral(
  id: string,
  position: General['position'],
  opts: { attack?: number; defense?: number; troops?: number } = {}
): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: opts.attack ?? 120,
    defense: opts.defense ?? 90,
    strategy: 60,
    speed: 40,
    attackRange: 2,
    maxTroops: opts.troops ?? 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function makeTeam(prefix: string, opts: { attack?: number; defense?: number; troops?: number } = {}): General[] {
  return POSITIONS.map((pos, i) => makeGeneral(`${prefix}-${i}`, pos, opts));
}

function cloneTeam(team: General[]): General[] {
  return team.map((g) => ({
    ...g,
    activeSkillIds: [...g.activeSkillIds],
    passiveSkillIds: [...g.passiveSkillIds],
    commandSkillIds: [...g.commandSkillIds],
    pursuitSkillIds: [...g.pursuitSkillIds],
  }));
}

/** 手工构造单场（bucket 必须与 flags 自洽，和 playOne 的写法一致） */
function play(over: Partial<PlayedBattle>): PlayedBattle {
  return {
    bucket: 'loss',
    decapWin: false,
    decapLoss: false,
    advDraw: false,
    disadvDraw: false,
    evenDraw: false,
    myDead: 0,
    enemyDead: 0,
    myDamage: 0,
    first3: 0,
    controlMine: 0,
    ...over,
  };
}

const decapWin = (): PlayedBattle => play({ bucket: 'win', decapWin: true });
const advWin = (): PlayedBattle => play({ bucket: 'win', advDraw: true });
const even = (): PlayedBattle => play({ bucket: 'draw', evenDraw: true });
const disadv = (): PlayedBattle => play({ bucket: 'draw', disadvDraw: true });
const decapLoss = (): PlayedBattle => play({ bucket: 'loss', decapLoss: true });

describe('四档判定（胜利 / 优势平 / 劣势平 / 失败）', () => {
  it('一胜 + 一优势平 + 一完全平 + 一劣势平 + 一负 → 1 / 2 / 1 / 1，和 = 5', () => {
    const stats = summarizePlays([decapWin(), advWin(), even(), disadv(), decapLoss()]);

    expect(stats.runs).toBe(5);
    expect(stats.victory).toBe(1);
    // 完全平并入优势平（用户明确选择）
    expect(stats.edgeDraw).toBe(2);
    expect(stats.deficitDraw).toBe(1);
    expect(stats.defeat).toBe(1);
    expect(stats.victory + stats.edgeDraw + stats.deficitDraw + stats.defeat).toBe(stats.runs);

    expect(stats.victoryRate).toBeCloseTo(0.2, 12);
    expect(stats.edgeDrawRate).toBeCloseTo(0.4, 12);
    expect(stats.deficitDrawRate).toBeCloseTo(0.2, 12);
    expect(stats.defeatRate).toBeCloseTo(0.2, 12);
    expect(stats.victoryRate + stats.edgeDrawRate + stats.deficitDrawRate + stats.defeatRate).toBeCloseTo(1, 12);
  });

  it('旧的 win / draw / loss 三桶语义不变（对手池与顾问的排序口径）', () => {
    const stats = summarizePlays([decapWin(), advWin(), even(), disadv(), decapLoss()]);

    expect(stats.win).toBe(2); // 斩首胜 1 + 优势平 1（旧三桶里完全平仍算平局）
    expect(stats.draw).toBe(2); // 劣势平 + 完全平
    expect(stats.loss).toBe(1); // 只有斩首负
    expect(stats.win).toBe(stats.decapWin + stats.advDraw);
    expect(stats.draw).toBe(stats.disadvDraw + stats.evenDraw);
    expect(stats.loss).toBe(stats.decapLoss);
    expect(stats.capped).toBe(stats.advDraw + stats.disadvDraw + stats.evenDraw);
  });
});

describe('战损比', () => {
  it('我方死 20 / 敌方死 80 → 0.25；分母 0 的场次跳过且不计入均值', () => {
    const stats = summarizePlays([
      play({ decapWin: true, bucket: 'win', myDead: 20, enemyDead: 80 }),
      play({ evenDraw: true, bucket: 'draw', myDead: 30, enemyDead: 30 }),
      play({ decapLoss: true, myDead: 10, enemyDead: 0 }), // 跳过
      play({ disadvDraw: true, bucket: 'draw', myDead: 0, enemyDead: 0 }), // 跳过
    ]);

    // (20/80 + 30/30) / 2 = (0.25 + 1) / 2
    expect(stats.deathRatio).not.toBeNull();
    expect(stats.deathRatio!).toBeCloseTo(0.625, 12);
    expect(stats.deathRatioSamples).toBe(2);
    expect(stats.deathRatioSkipped).toBe(2);
    // 旁注：只统计参与均值的场次
    expect(stats.meanMyDead).toBeCloseTo(25, 12);
    expect(stats.meanEnemyDead).toBeCloseTo(55, 12);
  });

  it('是每场比值的算术平均，不是总量比', () => {
    const stats = summarizePlays([
      play({ myDead: 1, enemyDead: 2 }),
      play({ myDead: 1, enemyDead: 10 }),
    ]);

    expect(stats.deathRatio!).toBeCloseTo(0.3, 12); // (0.5 + 0.1) / 2
    expect(stats.deathRatio!).not.toBeCloseTo(2 / 12, 12); // 总量比 = 0.1667，必须不同
  });

  it('全部场次分母为 0 → null（显示 —，不给 NaN / Infinity）', () => {
    const stats = summarizePlays([play({ myDead: 12 }), play({ myDead: 0 })]);

    expect(stats.deathRatio).toBeNull();
    expect(stats.deathRatioSkipped).toBe(2);
    expect(stats.deathRatioSamples).toBe(0);
    expect(deathRatioText(stats)).toBe('—');
    expect(Number.isNaN(stats.deathRatio as unknown as number)).toBe(false);
  });

  it('有样本时主数字保留两位小数', () => {
    expect(deathRatioText({ deathRatio: 0.25 })).toBe('0.25');
    expect(deathRatioText({ deathRatio: 1 })).toBe('1.00');
  });
});

describe('swap 场不得把分子分母算反', () => {
  it('映射函数：swap 时我方阵亡取右侧', () => {
    expect(mapDeaths(120, 340, false)).toEqual({ my: 120, enemy: 340 });
    expect(mapDeaths(120, 340, true)).toEqual({ my: 340, enemy: 120 });
  });

  it('playOne 的阵亡数与同参数的 runBattle 逐侧对齐（swap / 非 swap 各一次）', () => {
    const strong = makeTeam('strong', { attack: 260, defense: 200 });
    const weak = makeTeam('weak', { attack: 60, defense: 40 });
    const seed = 20261106;

    for (const swap of [false, true]) {
      const played = playOne(strong, weak, seed, 8, swap);
      const left = swap ? weak : strong;
      const right = swap ? strong : weak;
      const report = runBattle({
        myTeam: cloneTeam(left),
        enemyTeam: cloneTeam(right),
        seed,
        maxRounds: 8,
      });
      const leftDead = report.finalMyDead.reduce((a, b) => a + b, 0);
      const rightDead = report.finalEnemyDead.reduce((a, b) => a + b, 0);

      expect(played.myDead).toBe(swap ? rightDead : leftDead);
      expect(played.enemyDead).toBe(swap ? leftDead : rightDead);
    }
  });
});

describe('200 场：两条跑批路径口径一致', () => {
  const myTeam = makeTeam('me', { attack: 180, defense: 120 });
  const enemyTeam = makeTeam('foe', { attack: 140, defense: 100 });
  const opts = { runs: 200, baseSeed: 20261106, swapSides: true, maxRounds: 8 } as const;

  it('simulateWinRate 与 simulateWinRateSample 的四档 / 战损比完全相同', () => {
    const a = simulateWinRate(myTeam, enemyTeam, opts);
    const b = simulateWinRateSample(myTeam, enemyTeam, opts);

    expect(a.runs).toBe(200);
    expect(a.victory + a.edgeDraw + a.deficitDraw + a.defeat).toBe(a.runs);
    expect(a.victoryRate + a.edgeDrawRate + a.deficitDrawRate + a.defeatRate).toBeCloseTo(1, 12);

    expect(b.victory).toBe(a.victory);
    expect(b.edgeDraw).toBe(a.edgeDraw);
    expect(b.deficitDraw).toBe(a.deficitDraw);
    expect(b.defeat).toBe(a.defeat);
    expect(b.deathRatio).toBe(a.deathRatio);
    expect(b.deathRatioSkipped).toBe(a.deathRatioSkipped);
    expect(b.deathRatioSamples).toBe(a.deathRatioSamples);
  });

  it('战损比 = 同一批 playOne 的逐场比值均值（跳过分母 0）', () => {
    const stats = simulateWinRate(myTeam, enemyTeam, { ...opts, runs: 40 });
    const plays = Array.from({ length: 40 }, (_, i) =>
      playOne(myTeam, enemyTeam, opts.baseSeed + Math.floor(i / 2), 8, i % 2 === 1)
    );
    const ratios = plays.filter((p) => p.enemyDead > 0).map((p) => p.myDead / p.enemyDead);
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;

    expect(stats.deathRatioSamples).toBe(ratios.length);
    expect(stats.deathRatioSkipped).toBe(plays.length - ratios.length);
    expect(stats.deathRatio!).toBeCloseTo(mean, 12);
  });

  it('同种子可复现（四档与战损比全等）', () => {
    const a = simulateWinRate(myTeam, enemyTeam, { ...opts, runs: 20 });
    const b = simulateWinRate(myTeam, enemyTeam, { ...opts, runs: 20 });

    expect(b).toMatchObject({
      victory: a.victory,
      edgeDraw: a.edgeDraw,
      deficitDraw: a.deficitDraw,
      defeat: a.defeat,
      deathRatio: a.deathRatio,
    });
  });
});

describe('卡片 HTML（四行 + 战损比块）', () => {
  it('四档各有独立样式键，战损比与口径文案齐备', () => {
    const stats = summarizePlays([
      play({ bucket: 'win', decapWin: true, myDead: 20, enemyDead: 80 }),
      play({ bucket: 'win', advDraw: true, myDead: 10, enemyDead: 10 }),
      play({ bucket: 'draw', evenDraw: true, myDead: 5, enemyDead: 5 }),
      play({ bucket: 'draw', disadvDraw: true, myDead: 40, enemyDead: 20 }),
      play({ bucket: 'loss', decapLoss: true, myDead: 60, enemyDead: 10 }),
    ]);
    const html = resultHtml(stats, 8);

    for (const cls of ['wr-victory', 'wr-edge', 'wr-deficit', 'wr-defeat']) {
      expect(html).toContain(`wr-row ${cls}`);
    }
    expect(html).toContain('胜利');
    expect(html).toContain('优势平');
    expect(html).toContain('劣势平');
    expect(html).toContain('失败');
    expect(html).toContain('40.0%'); // 优势平 2/5
    expect(html).toContain('wr-ratio');
    // (0.25 + 1 + 1 + 2 + 6) / 5 = 2.05
    expect(html).toContain('2.05');
    expect(html).toContain('完全平并入优势平');
    expect(html).toContain('不是总量比');
  });
});
