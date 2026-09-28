/**
 * L3 组合优化 · 优化武将（队友）—— `web/simMate.ts` + `web/optimizeView.ts` 测试
 * ---------------------------------------------------------------------------
 * 用户 2026-09-28 口径：
 *   ① L3 把**队友位当成那个空槽**（L2 是战法槽）——对队友组合做粗筛，靶子 / 排序口径与 L2 完全一致
 *      （不还手木桩 + 核心将伤害期望 + 粗筛 3 场 → 决赛 ≥20 场）；
 *   ② **勾两个队友位 ⇒ 粗筛组按成对评估**（两个队友一起作为一个组合来评，且两个位各作一次基准方向）；
 *   ③ 匹配位的战法槽清空（战法留给 L2 配），未勾选的将原样保留；候选武将排除队内已上阵者；
 *   ④ 页面 `optimize.html`：L2 / L3 共用同一栏左侧配置，切模式只换右侧；L3 应用队友后可直接切 L2 配战法。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ensureUniqueUnitIds } from '../src/engine/combat';
import { runOne } from '../web/battleSim';
import { HERO_RECORDS, SLOTTED_HEROES } from '../web/heroes';
import { autoCoreUnits, coreDamageOf, dummyTeamFromEnemy } from '../web/simExpectation';
import {
  candidateHeroes,
  clearSlotSkills,
  estimateMateBattles,
  heroesMutuallyExclusive,
  heroPoolBase,
  legalHeroCombos,
  MATE_SIM_DEFAULTS,
  mateSlots,
  MAX_MATCH_UNITS,
  mutualGroupOf,
  picksLegal,
  runSimMate,
  simMateSteps,
  slotForHero,
  teamHeroesLegal,
  withHeroPicks,
  withSlotHero,
  type MateGroupCoarse,
  type MateOptionRow,
} from '../web/simMate';
import { mateControlsHtml, mateProgressHtml, mateResultHtml } from '../web/simMateView';
import { mountOptimize } from '../web/optimizeView';
import { defaultCfg, generalsOf, type ViewCfg } from '../web/teamConfig';

/** 默认队伍三将清空战法槽 */
function baseCfg(heroIds: string[] = ['h3', 'h5', 'h16']): ViewCfg {
  const cfg = defaultCfg(heroIds);
  cfg.slots.forEach((s) => {
    s.skillIds = [];
  });
  return cfg;
}

/** 候选武将（从真实武将池里取，避开队内三将 → 对数据变动不敏感） */
const TEAM0 = ['h3', 'h5', 'h16'];
const POOL = SLOTTED_HEROES.map((h) => h.id)
  .filter((id) => !TEAM0.includes(id))
  .slice(0, 3);

/** 快参数：测试只要形状与不变量，不要长跑 */
const FAST = { coarseRuns: 1, finalRuns: 20, unitKeep: 2, pairCarriers: 2, coarseTop: 2, maxCombos: 20 };

const pickOf = (rows: MateOptionRow[], unit: number): string[] =>
  rows.map((r) => r.picks.find((p) => p.unit === unit)?.heroId ?? '');

describe('① 队友位 = 那个空槽：位识别与候选口径', () => {
  it('mateSlots：默认 = 非核心将的全部位（最多 2 个），核心位排除在外', () => {
    const cfg = baseCfg();
    const core = autoCoreUnits(cfg);
    expect(core).toHaveLength(1);
    const slots = mateSlots(cfg, undefined, core);
    expect(slots).toHaveLength(MAX_MATCH_UNITS);
    expect(slots.map((s) => s.unit)).toEqual([0, 1, 2].filter((u) => !core.includes(u)));
    expect(slots[0].position).toBe(['大营', '中军', '前锋'][slots[0].unit]);
    // 显式指定只匹配 1 个位
    expect(mateSlots(cfg, [slots[1].unit], core).map((s) => s.unit)).toEqual([slots[1].unit]);
    // 勾了核心位：被过滤掉（核心是将要围绕的锚，不该被搜掉）
    expect(mateSlots(cfg, [core[0]], core)).toHaveLength(0);
    // 勾 3 个位：只取前 2 个（成对评估的上限）
    expect(mateSlots(cfg, [0, 1, 2], [])).toHaveLength(MAX_MATCH_UNITS);
  });

  it('候选武将池：排除队内已上阵（含核心与未匹配的队友）；底座池可切「含下架」', () => {
    const cfg = baseCfg();
    const pool = candidateHeroes(cfg, { candidateIds: [...TEAM0, ...POOL, 'no_such_hero'] });
    expect(pool).toEqual(POOL); // 队内三将与不存在的 id 都被剔除
    const listed = heroPoolBase({});
    const all = heroPoolBase({ includeOffline: true });
    expect(listed.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThanOrEqual(listed.length);
    // 上架池 − 队内已上阵（默认队伍里可能有人是下架武将 → 不能直接减 3）
    expect(candidateHeroes(cfg, {}).length).toBe(listed.filter((id) => !TEAM0.includes(id)).length);
    expect(candidateHeroes(cfg, { includeOffline: true }).length).toBe(all.filter((id) => !TEAM0.includes(id)).length);
  });

  it('换将口径：等级沿用该位、加点清零、兵种取本体、战法槽清空（战法留给 L2）', () => {
    const cfg = baseCfg();
    cfg.slots[1].level = 47;
    cfg.slots[1].addAttack = 30;
    cfg.slots[1].skillIds = ['tujin'];
    const slot = slotForHero(cfg, 1, POOL[0]);
    expect(slot.heroId).toBe(POOL[0]);
    expect(slot.level).toBe(47);
    expect(slot.addAttack).toBe(0);
    expect(slot.addStrategy).toBe(0);
    expect(slot.skillIds).toEqual([]);
    expect(slot.troopType).toBe(HERO_RECORDS[POOL[0]].troopType);
    expect(slot.treasure ?? null).toBeNull();

    const next = withSlotHero(cfg, 1, POOL[1]);
    expect(next.slots[1].heroId).toBe(POOL[1]);
    expect(next.slots[1].skillIds).toEqual([]); // 换将后战法槽清空
    expect(next.slots[0].heroId).toBe(cfg.slots[0].heroId); // 其余将不动
    expect(next.slots[2].heroId).toBe(cfg.slots[2].heroId);
    expect(cfg.slots[1].heroId).not.toBe(POOL[1]); // 原 cfg 不被改写
  });

  it('试跑基线：只清空「参与匹配的队友位」的战法槽，核心等其余位原样保留', () => {
    const cfg = baseCfg();
    cfg.slots[0].skillIds = ['tujin'];
    cfg.slots[2].skillIds = ['lianzhan'];
    const cleared = clearSlotSkills(cfg, [2]);
    expect(cleared.slots[2].skillIds).toEqual([]);
    expect(cleared.slots[0].skillIds).toEqual(['tujin']);
    expect(cfg.slots[2].skillIds).toEqual(['lianzhan']);
  });

  it('队内武将唯一：同一武将不得占两个位（picksLegal / 候选生成）', () => {
    expect(picksLegal([{ heroId: 'a' }, { heroId: 'b' }])).toBe(true);
    expect(picksLegal([{ heroId: 'a' }, { heroId: 'a' }])).toBe(false);
    expect(picksLegal([{ heroId: '' }, { heroId: '' }])).toBe(true);
    const cfg = baseCfg();
    expect(candidateHeroes(cfg, { candidateIds: TEAM0 })).toEqual([]);
  });
});

describe('② 成对评估：勾两个队友位 → 粗筛组按组合评（用户口径）', () => {
  /** 勾 2 个队友位（核心 = 0 号位，匹配 1/2 号位） */
  function pairCfg(): { cfg: ViewCfg; units: number[] } {
    return { cfg: baseCfg(), units: [1, 2] };
  }

  it('mode = pair；成对选项 = 两个位的有序对（两位一起评），另留单挂出口', () => {
    const { cfg, units } = pairCfg();
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: units, coreUnits: [0], unitKeep: 10 });
    expect(res.groups).toHaveLength(1);
    const g = res.groups[0];
    expect(g.mode).toBe('pair');
    expect(g.units).toEqual(units);
    const pairs = g.rows.filter((r) => r.from === 'pair');
    const singles = g.rows.filter((r) => r.from === 'single');
    expect(pairs.length).toBeGreaterThan(0);
    expect(singles.length).toBeGreaterThan(0); // 单挂出口：只换一个位、另一位保持当前武将
    expect(singles.length).toBeLessThanOrEqual(3);
    for (const r of pairs) {
      expect(r.picks).toHaveLength(2); // **两个队友一起作为一个组合来评**
      expect(r.picks.map((p) => p.unit).sort()).toEqual([...units].sort());
      expect(r.picks[0].heroId).not.toBe(r.picks[1].heroId); // 队内武将唯一
      expect(r.damages).toHaveLength(1); // coarseRuns = 1
    }
    for (const r of singles) {
      expect(r.picks).toHaveLength(1);
      expect(units).toContain(r.picks[0].unit);
    }
    // 只有一个「组」→ 组合粗筛榜单来自这一组的保留名单
    expect(res.combos.length).toBeGreaterThan(0);
    expect(res.combos.every((c) => c.picks.length <= 2)).toBe(true);
  });

  it('两个位各作一次基准方向：大营 / 前锋两种排法都会被评到（不会系统性偏袒站位）', () => {
    const { cfg, units } = pairCfg();
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: units, coreUnits: [0], pairCarriers: 1, unitKeep: 10 });
    const pairs = res.groups[0].rows.filter((r) => r.from === 'pair');
    const heroesA = new Set(pickOf(pairs, units[0]));
    const heroesB = new Set(pickOf(pairs, units[1]));
    // 基准方向 A：位A 固定为基准、位B 遍历候选 → 位B 侧出现多个武将；
    // 基准方向 B：位B 固定为基准、位A 遍历候选 → 位A 侧出现多个武将。
    expect(heroesA.size).toBeGreaterThan(1);
    expect(heroesB.size).toBeGreaterThan(1);
    // 有序对不重复（A→x,B→y 与 A→y,B→x 是两个不同的配置，但同一个有序对只跑一次）
    const keys = pairs.map((r) => `${r.picks.find((p) => p.unit === units[0])?.heroId}>${r.picks.find((p) => p.unit === units[1])?.heroId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('成对选项真的按「整组」真跑：逐场伤害 = 该「两位一起」配置独立跑出来的核心将伤害', () => {
    const { cfg, units } = pairCfg();
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: units, coreUnits: [0], unitKeep: 10 });
    const row = res.groups[0].rows.find((r) => r.from === 'pair')!;
    // 独立复算：匹配位战法槽清空 → 换上这一对武将 → 同种子第 0 场
    const variant = withHeroPicks(clearSlotSkills(cfg, units), row.picks.map((p) => ({ unit: p.unit, heroId: p.heroId })));
    const teams = ensureUniqueUnitIds(generalsOf(variant, cfg.morale), dummyTeamFromEnemy(cfg.enemy, cfg.morale, res.options.dummyTroops));
    const raw = runOne(teams.myTeam, teams.enemyTeam, 0, {
      maxRounds: cfg.rounds,
      swapSides: res.options.swapSides,
      baseSeed: res.options.baseSeed,
      inertSides: ['enemy'],
    });
    const coreId = teams.myTeam[0].id;
    expect(row.damages[0]).toBeCloseTo(coreDamageOf(raw, [coreId]), 6);
    // 同参数再跑一遍：逐场完全一致（固定种子可复现）
    const again = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: units, coreUnits: [0], unitKeep: 10 });
    const same = again.groups[0].rows.find((r) => r.label === row.label && r.from === 'pair')!;
    expect(same.damages).toEqual(row.damages);
  });

  it('单槽模式：只勾 1 个队友位 → mode = single，选项 = 单个武将（另一位不动）', () => {
    const cfg = baseCfg();
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: [2], coreUnits: [0], unitKeep: 10 });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].mode).toBe('single');
    expect(res.groups[0].units).toEqual([2]);
    expect(res.groups[0].rows.every((r) => r.from === 'single' && r.picks.length === 1)).toBe(true);
    expect(res.groups[0].rows.every((r) => r.picks[0].unit === 2)).toBe(true);
  });

  it('没有可匹配的队友位（核心占满）→ 退化为直接测评当前配置，不报错', () => {
    const cfg = baseCfg();
    const res = runSimMate(cfg, { ...FAST, coreUnits: [0, 1, 2] });
    expect(res.noMatchSlot).toBe(true);
    expect(res.matchSlots).toHaveLength(0);
    expect(res.groups).toHaveLength(0);
    expect(res.finals.length).toBeGreaterThan(0);
    expect(res.battles).toBe(20 + 1 + 20); // 基线 20 + 组合粗筛 1 + 决赛 20
  });
});

describe('③ 合法组合枚举与统计不变量', () => {
  const opt = (picks: Array<[number, string]>, score: number, kept = true): MateOptionRow => ({
    picks: picks.map(([unit, heroId]) => ({ unit, unitName: `u${unit}`, heroId, heroName: heroId })),
    label: picks.map(([, id]) => id).join(' + '),
    runs: 3,
    damages: [score, score, score],
    score,
    meanCore: score,
    meanCoreFirst3: score,
    meanTotal: score,
    meanFirst3: score,
    rank: 0,
    kept,
    from: picks.length > 1 ? 'pair' : 'single',
  });
  const group = (rows: MateOptionRow[]): MateGroupCoarse => ({
    units: [1, 2],
    unitNames: ['A', 'B'],
    positions: ['中军', '前锋'],
    mode: 'pair',
    rows,
    keptKeys: rows.filter((r) => r.kept).map((r) => r.picks.map((p) => p.heroId).sort().join('+')),
  });

  it('合法组合枚举守「队内武将唯一」，并受上限截断', () => {
    const g = group([opt([[1, 'a'], [2, 'b']], 10), opt([[1, 'b'], [2, 'a']], 9), opt([[1, 'c'], [2, 'c']], 8, true)]);
    const combos = legalHeroCombos([g], 10);
    expect(combos).toHaveLength(3);
    expect(combos[2].map((p) => p.heroId)).toEqual(['c', 'c']); // 组内唯一由选项自身保证（这里模拟异常项）
    expect(legalHeroCombos([g], 2)).toHaveLength(2); // 上限截断
    expect(legalHeroCombos([], 5)).toEqual([[]]); // 没有组 → 一个空组合（退化用法）
  });

  it('◀ 口径不变量：排行的 mean = 核心将场均伤害；meanTotal = 全队总伤（参考列）', () => {
    const cfg = baseCfg();
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: [1, 2], coreUnits: [0], unitKeep: 4, coarseTop: 3 });
    expect(res.finals.length).toBeGreaterThan(0);
    for (const f of res.finals) {
      const coreSum = f.byUnit.filter((u) => u.core).reduce((a, u) => a + u.mean, 0);
      expect(f.mean).toBeCloseTo(coreSum, 6);
      expect(f.meanTotal).toBeCloseTo(
        f.byUnit.reduce((a, u) => a + u.mean, 0),
        6
      );
      expect(f.meanTotal).toBeGreaterThan(f.mean);
      expect(f.byUnit.filter((u) => u.core).map((u) => u.unit)).toEqual([0]);
      expect(f.damages).toHaveLength(20);
    }
    expect(res.coreLabel).toBe(HERO_RECORDS[cfg.slots[0].heroId].name);
  });

  it('应用队友=换将 + 清空该位战法：不变量「匹配位战法槽为空、其余位原样」（模块层）', () => {
    const cfg = baseCfg();
    cfg.slots[0].skillIds = ['tujin'];
    cfg.slots[2].skillIds = ['lianzhan'];
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: [1, 2], coreUnits: [0], unitKeep: 4, coarseTop: 1 });
    const best = res.finals[0];
    const applied = withHeroPicks(cfg, best.picks.map((p) => ({ unit: p.unit, heroId: p.heroId })));
    for (const p of best.picks) {
      expect(applied.slots[p.unit].heroId).toBe(p.heroId);
      expect(applied.slots[p.unit].skillIds).toEqual([]);
    }
    expect(applied.slots[0].skillIds).toEqual(['tujin']); // 核心将的战法原样保留
  });

  it('木桩兵力太小 → 伤害被截断：wipedRuns 如实上报', () => {
    const cfg = baseCfg();
    cfg.enemy = { defense: 60, strategy: 60, troopType: 'infantry' };
    const res = runSimMate(cfg, {
      ...FAST,
      candidateIds: POOL,
      matchUnits: [1, 2],
      coreUnits: [0],
      unitKeep: 1,
      coarseTop: 1,
      dummyTroops: 300,
    });
    expect(res.finals).toHaveLength(1);
    expect(res.finals[0].wipedRuns).toBeGreaterThan(0);
    expect(res.wipedCombos).toBe(1);
  });
});

describe('④ 阈值可配 / 场次估算 / 复现', () => {
  it('决赛场次低于 20 一律抬回 20；粗筛场次可配', () => {
    const cfg = baseCfg();
    const res = runSimMate(cfg, { ...FAST, finalRuns: 5, coarseRuns: 2, candidateIds: POOL, matchUnits: [2], coreUnits: [0], unitKeep: 1, coarseTop: 1 });
    expect(res.options.finalRuns).toBe(20);
    expect(res.options.coarseRuns).toBe(2);
    expect(res.finals[0].runs).toBe(20);
    expect(res.groups[0].rows[0].damages).toHaveLength(2);
    expect(res.baseline.runs).toBe(20);
  });

  it('预计真跑场次 ≥ 实际场次（跳过「自己配自己」等只会让实际更少）', () => {
    const cfg = baseCfg();
    const opts = { candidateIds: POOL, matchUnits: [1, 2], coreUnits: [0], unitKeep: 4, coarseTop: 3 };
    const res = runSimMate(cfg, { ...FAST, ...opts });
    expect(estimateMateBattles(cfg, { ...FAST, ...opts })).toBeGreaterThanOrEqual(res.battles);
  });

  it('同种子同参数 → 逐场结果完全一致（可复现）', () => {
    const cfg = baseCfg();
    const opts = { ...FAST, candidateIds: POOL, matchUnits: [1, 2], coreUnits: [0], unitKeep: 2, coarseTop: 2 };
    const a = runSimMate(cfg, opts);
    const b = runSimMate(cfg, opts);
    expect(b.finals.map((f) => f.label)).toEqual(a.finals.map((f) => f.label));
    expect(b.finals.map((f) => f.mean)).toEqual(a.finals.map((f) => f.mean));
    expect(b.baseline.damages).toEqual(a.baseline.damages);
    // 换种子 → 数字变（不是写死的常量）
    const c = runSimMate(cfg, { ...opts, baseSeed: 12345 });
    expect(c.baseline.damages).not.toEqual(a.baseline.damages);
  });

  it('进度事件：阶段 + 场次单调递增，最后一场=总场次', () => {
    const cfg = baseCfg();
    const gen = simMateSteps(cfg, { ...FAST, candidateIds: POOL, matchUnits: [1, 2], coreUnits: [0], unitKeep: 2, coarseTop: 1 });
    const seen: string[] = [];
    let battle = 0;
    let step = gen.next();
    while (!step.done) {
      const p = step.value;
      expect(p.battle).toBeGreaterThanOrEqual(battle);
      battle = p.battle;
      seen.push(p.phase);
      step = gen.next();
    }
    expect(seen).toContain('slot');
    expect(seen).toContain('combo');
    expect(seen).toContain('final');
    expect(battle).toBe(step.value.battles);
  });

  it('缺省口径与 L2 同一套（粗筛 3 场 / 决赛 20 / 每将保留 32 / 进决赛 32）', () => {
    expect(MATE_SIM_DEFAULTS.coarseRuns).toBe(3);
    expect(MATE_SIM_DEFAULTS.finalRuns).toBe(20);
    expect(MATE_SIM_DEFAULTS.unitKeep).toBe(32);
    expect(MATE_SIM_DEFAULTS.coarseTop).toBe(32);
    expect(MATE_SIM_DEFAULTS.dummyTroops).toBe(150000);
  });
});

describe('⑤ 视图 HTML（纯函数）', () => {
  function controlsInit(over: Record<string, unknown> = {}): Parameters<typeof mateControlsHtml>[0] {
    return {
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 32,
      pairCarriers: 10,
      coarseTop: 32,
      maxCombos: 1000,
      rankBy: 'total',
      dummyTroops: 150000,
      seed: 20260922,
      swapSides: true,
      includeOffline: false,
      slotSkills: 'keep',
      baseSkills: [[]],
      poolSizes: { listed: 120, all: 160 },
      units: [
        { unit: 0, name: '甲', position: '大营', isCore: true, canMatch: false },
        { unit: 1, name: '乙', position: '中军', isCore: false, canMatch: true },
        { unit: 2, name: '丙', position: '前锋', isCore: false, canMatch: true },
      ],
      matchUnits: [1, 2],
      coreUnitIdx: [0],
      autoCoreName: '甲',
      estimate: 12345,
      ...over,
    };
  }

  it('参数区：粗筛 3 / 决赛 20（下限 20）/ 队友位与核心位勾选 / 预计场次', () => {
    const html = mateControlsHtml(controlsInit());
    expect(html).toContain('id="mt-coarse"');
    expect(html).toContain('value="3"');
    expect(html).toContain('id="mt-final"');
    expect(html).toContain('min="20"');
    expect(html).toContain('data-mt-match="1"');
    expect(html).toContain('data-mt-core="0"');
    expect(html).toContain('核心位：固定不动'); // 核心位的匹配框 disabled
    expect(html).toContain('预计真跑 <b>12345</b> 场');
    expect(html).toContain('成对评估'); // 勾 2 个位 → 文案切成成对口径
    expect(html).not.toContain('undefined');
  });

  it('勾 1 个位 → 文案切成单槽粗筛', () => {
    const html = mateControlsHtml(controlsInit({ matchUnits: [2] }));
    expect(html).toContain('单槽粗筛');
    expect(html).not.toContain('成对评估（勾了 2 个队友位）');
  });

  it('进度条：阶段文案 + 百分比宽度', () => {
    const html = mateProgressHtml({ phase: 'combo', phaseDone: 30, phaseTotal: 120, battle: 500, label: '组合粗筛 3/90' });
    expect(html).toContain('组合粗筛 30 / 120');
    expect(html).toContain('width:25.0%');
    expect(html).toContain('累计 500 场');
  });

  it('结果区：三阶段 + 应用按钮 + 对照基线 + 不掺胜负', () => {
    const cfg = baseCfg();
    const res = runSimMate(cfg, { ...FAST, candidateIds: POOL, matchUnits: [1, 2], coreUnits: [0], unitKeep: 4, coarseTop: 2 });
    const html = mateResultHtml(res);
    expect(html).toContain('① 队友位粗筛');
    expect(html).toContain('成对组合');
    expect(html).toContain('② 组合粗筛榜单');
    expect(html).toContain('③ 决赛排行');
    expect(html).toContain('④ 口径与提示');
    expect(html).toContain('data-mate-apply="0"');
    expect(html).toContain('对照基线');
    expect(html).toContain('匹配位的战法槽在试跑前已清空');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    // 不掺胜负：胜率是 L4 的事
    expect(html).not.toContain('斩首');
    expect(html).not.toContain('平局');
    expect(html).not.toContain('兵力优势');
  });
});

describe('⑥ 页面（optimize.html）：L2 / L3 共用左栏 + 两步衔接', () => {
  /**
   * 挂一页新的（先清空 body）：jsdom 里 `root.querySelector('#id …')` 会按 **document 全局** 解析开头的 `#id`，
   * 同一个文件挂多页就会串到上一页去 —— 每次只留一页最稳。
   */
  function mountPage(): HTMLElement {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountOptimize(root);
    return root;
  }

  /** 等页面 data-state 变成目标值 */
  async function waitState(el: HTMLElement, want: string, ms = 60000): Promise<string> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (el.dataset.state === want) return want;
      await new Promise((r) => setTimeout(r, 20));
    }
    return el.dataset.state ?? '';
  }

  /** 把 L3 参数收小（页面参数都是控件 → 直接改控件值 + 发 change） */
  function shrinkL3Controls(root: HTMLElement): void {
    const set = (sel: string, value: string): void => {
      const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
      if (!el) throw new Error(`控件不存在：${sel}`);
      el.value = value;
      el.dispatchEvent(new Event('change'));
    };
    set('#mt-coarse', '1');
    set('#mt-keep', '10');
    set('#mt-top', '8');
  }

  it('L2 侧参与匹配 = 槽位级：勾哪个槽只搜哪个槽；左栏徽标 / 预计场次 / 「清空」语义跟着走', () => {
    const root = mountPage();
    const boxes = [...root.querySelectorAll<HTMLInputElement>('#op-controls [data-sim-slot]')];
    expect(boxes.map((b) => b.dataset.simSlot)).toEqual(['0-0', '0-1', '1-0', '1-1', '2-0', '2-1']);
    expect(boxes.every((b) => b.checked), '默认全勾 = 全部空槽').toBe(true);
    expect(root.querySelector('#op-controls')!.textContent).toContain('参与匹配的槽位');
    expect(root.querySelector('#op-controls')!.textContent).toContain('排序口径 · 核心将');

    const estNum = (): number => {
      const t = root.querySelector<HTMLElement>('#rm-sim-est')!.textContent ?? '';
      return Number((/([\d,]+)/.exec(t)?.[1] ?? '0').replace(/,/g, ''));
    };
    const estAll = estNum();

    // 只留两个队友的槽 2（用户 2026-09-28 的诉求：别再帮我全搜）
    boxes.forEach((b) => {
      b.checked = false;
    });
    for (const key of ['1-1', '2-1']) {
      const el = root.querySelector<HTMLInputElement>(`[data-sim-slot="${key}"]`)!;
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    }
    const cfgText = root.querySelector('#op-config')!.textContent ?? '';
    expect(cfgText).toContain('L2 参与匹配 0/2 槽'); // 大营一个都没勾
    expect(cfgText).toContain('L2 参与匹配 1/2 槽'); // 中军 / 前锋各勾了槽 2
    expect(estNum(), '搜的槽少了，预计场次应下降').toBeLessThan(estAll);

    // 「清空」= 一个槽都不搜（只测评当前配置），不是悄悄回落成「全搜」
    root.querySelector<HTMLButtonElement>('[data-sim-slots="none"]')!.click();
    const after = [...root.querySelectorAll<HTMLInputElement>('#op-controls [data-sim-slot]')];
    expect(after.every((b) => !b.checked)).toBe(true);
    expect(root.querySelector('#op-controls')!.textContent).toContain('一个槽位都没勾');

    // 「全选」回到全部空槽
    root.querySelector<HTMLButtonElement>('[data-sim-slots="all"]')!.click();
    const back = [...root.querySelectorAll<HTMLInputElement>('#op-controls [data-sim-slot]')];
    expect(back.every((b) => b.checked)).toBe(true);
  });

  it('默认进 L2 模式：左栏配置面板只有一份；切到 L3 只换右侧筛选栏', () => {
    const root = mountPage();

    expect(root.querySelectorAll('#op-config .rm-unit')).toHaveLength(3); // 左栏唯一实例
    expect(root.querySelectorAll('.op-mode')).toHaveLength(2);
    expect(root.querySelector('#rm-sim-coarse'), 'L2 模式的参数条').toBeTruthy();
    expect(root.querySelector('#mt-coarse'), 'L3 的参数条此时不应存在').toBeFalsy();
    expect(root.textContent).toContain('L2 优化战法');
    expect(root.textContent).toContain('L3 优化武将');

    root.querySelector<HTMLButtonElement>('.op-mode[data-mode="l3"]')!.click();
    expect(root.querySelector('#mt-coarse'), '切到 L3 后右侧换成武将匹配参数').toBeTruthy();
    expect(root.querySelector('#rm-sim-coarse'), 'L2 的参数条被换掉').toBeFalsy();
    expect(root.querySelectorAll('#op-config .rm-unit')).toHaveLength(3); // 左栏还是那一份
    expect(root.textContent).toContain('参与匹配的队友位');
    expect(root.textContent).toContain('L3 搜的是武将、不搜战法');

    root.querySelector<HTMLButtonElement>('.op-mode[data-mode="l2"]')!.click();
    expect(root.querySelector('#rm-sim-coarse')).toBeTruthy();
  });

  it('L3 跑完 → 应用队友 → 左栏同步换将；战法按口径保留（缺省）或清空', async () => {
    const root = mountPage();

    // 先给两个队友位各配一个战法，验证「候选带入战法」与「应用后战法怎么处理」
    for (const unit of [1, 2]) {
      const sel = root.querySelector<HTMLSelectElement>(`[data-unit-skill="${unit}-0"]`)!;
      sel.value = 'lianzhan';
      sel.dispatchEvent(new Event('change'));
    }
    expect(root.querySelector<HTMLSelectElement>('[data-unit-skill="1-0"]')!.value).toBe('lianzhan');

    root.querySelector<HTMLButtonElement>('.op-mode[data-mode="l3"]')!.click();
    // 只勾 1 个队友位（单槽模式）→ 测试跑得快；把粗筛/保留/决赛支数收小
    const pairBoxes = [...root.querySelectorAll<HTMLInputElement>('[data-mt-match]')];
    expect(pairBoxes.length).toBe(3);
    const checkedBoxes = pairBoxes.filter((b) => b.checked);
    expect(checkedBoxes.length).toBe(2); // 默认勾 2 个非核心位 = 成对模式
    checkedBoxes[1].checked = false;
    checkedBoxes[1].dispatchEvent(new Event('change'));
    shrinkL3Controls(root);
    expect(root.textContent).toContain('单槽粗筛');
    // 缺省口径 = 候选带着该位已配战法进场（用户 2026-09-29）
    expect(root.querySelector<HTMLSelectElement>('#mt-slotskills')!.value).toBe('keep');
    expect(root.textContent).toContain('保留该位已配战法');

    root.querySelector<HTMLButtonElement>('#mt-run')!.click();
    const panel = root.querySelector<HTMLElement>('#op-panel')!;
    expect(await waitState(panel, 'done')).toBe('done');

    const resultText = root.querySelector<HTMLElement>('#op-result')!.textContent ?? '';
    expect(resultText).toContain('决赛排行');
    expect(resultText).toContain('真跑');
    expect(resultText).toContain('候选进场带什么战法');
    expect(resultText).toContain('连战'); // 该位已配的战法名（带入基准）
    expect(resultText).not.toContain('undefined');

    // 应用榜首队友
    const applyBtn = root.querySelector<HTMLButtonElement>('#op-result [data-mate-apply]')!;
    expect(applyBtn).toBeTruthy();
    const appliedLabel = applyBtn.closest('tr')!.textContent ?? '';
    applyBtn.click();

    // 左栏同步：该位武将换成应用的那位；缺省口径下**战法保留**（评估就是按「带这套」算的）
    const keptUnit = [1, 2].find((u) => root.querySelector<HTMLSelectElement>(`[data-unit-skill="${u}-0"]`)!.value === 'lianzhan')!;
    expect([1, 2]).toContain(keptUnit);
    const heroSel = root.querySelector<HTMLSelectElement>(`[data-unit-hero="${keptUnit}"]`)!;
    expect(heroSel.value).not.toBe('');
    expect(appliedLabel).toContain(HERO_RECORDS[heroSel.value].name); // 应用行 = 左栏现在的武将
    expect(root.textContent).toContain('已应用队友');

    // 切到「清空（白板进场）」口径：同样的应用动作会把该位战法清掉（交给 L2 配）
    root.querySelector<HTMLSelectElement>('#mt-slotskills')!.value = 'clear';
    root.querySelector<HTMLSelectElement>('#mt-slotskills')!.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('#mt-run')!.click();
    expect(await waitState(panel, 'done')).toBe('done');
    expect(root.querySelector<HTMLElement>('#op-result')!.textContent).toContain('白板进场');
    root.querySelector<HTMLButtonElement>('#op-result [data-mate-apply]')!.click();
    const clearedUnit = [1, 2].find((u) => root.querySelector<HTMLSelectElement>(`[data-unit-skill="${u}-0"]`)!.value === '')!;
    expect([1, 2]).toContain(clearedUnit);

    // 两步衔接：切到 L2，左栏是刚应用的队伍（第二次应用的武将），L2 参数条就绪
    root.querySelector<HTMLButtonElement>('#op-go-l2')!.click();
    expect(root.querySelector('#rm-sim-coarse')).toBeTruthy();
    expect(root.querySelector<HTMLSelectElement>(`[data-unit-hero="${clearedUnit}"]`)!.value).not.toBe('');
    expect(root.textContent).toContain('已应用队友');
  }, 30000); // 这一条要跑两轮 L3（keep / clear 各一次）→ 全量并发下放宽超时（同 tests/team_scan.test.ts 的做法）

  it('L2 模式也能跑（零空槽：3 + 20 场）并在结果里给「应用」', async () => {
    const root = mountPage();

    // 6 个槽都填满 → 零空槽：直接测评当前配置（3 场粗筛 + 20 场决赛）
    const ids = ['tujin', 'lianzhan', 'yuzhan_yuyong', 'xianqu_tuji', 'shenbing_tianjiang', 'dashang_sanjun'];
    let k = 0;
    for (let unit = 0; unit < 3; unit += 1) {
      for (let slot = 0; slot < 2; slot += 1) {
        const sel = root.querySelector<HTMLSelectElement>(`[data-unit-skill="${unit}-${slot}"]`)!;
        sel.value = ids[k];
        k += 1;
        sel.dispatchEvent(new Event('change'));
      }
    }

    root.querySelector<HTMLButtonElement>('#rm-sim-run')!.click();
    const panel = root.querySelector<HTMLElement>('#op-panel')!;
    expect(await waitState(panel, 'done')).toBe('done');
    const text = root.querySelector<HTMLElement>('#op-result')!.textContent ?? '';
    expect(text).toContain('决赛排行');
    expect(text).toContain('23'); // 3 场粗筛 + 20 场决赛
    expect(root.querySelector('#op-result [data-sim-apply]'), 'L2 结果行也有「应用」').toBeTruthy();
  });
});

describe('⑦ 候选带入战法（用户 2026-09-29：辅助不该只按主战法排）', () => {
  const KIT_A = ['lianzhan', 'yuzhan_yuyong']; // 增益类：连战 / 愈战愈勇（不打伤害）
  const KIT_B = ['tujin', 'xianqu_tuji']; // 伤害类：突进 / 先驱突击

  const withKit = (): ViewCfg => {
    const cfg = baseCfg();
    cfg.slots.forEach((s) => {
      s.skillIds = [];
    });
    cfg.slots[1].skillIds = [...KIT_A];
    cfg.slots[2].skillIds = [...KIT_B];
    return cfg;
  };

  it('缺省 keep：候选**带着该位已配战法**进场（那套战法真的在打）', () => {
    const cfg = withKit();
    expect(MATE_SIM_DEFAULTS.slotSkills).toBe('keep');
    const res = runSimMate(cfg, { ...FAST, matchUnits: [2], coreUnits: [0] });
    expect(res.slotSkills).toBe('keep');
    expect(res.baseSkillNames[0]).toEqual(['突进', '先驱突击']);
    // 候选进场后该位战法还在（clear 口径下这里是空）
    expect(withSlotHero(cfg, 2, POOL[0], true).slots[2].skillIds).toEqual(KIT_B);
    // 该位战法的伤害确实进了结果（证明真跑带上了，而不是只写在文案里）
    expect(res.finals.some((f) => f.bySkill.some((s) => s.name === '突进' || s.name === '先驱突击'))).toBe(true);
  });

  it('clear：白板进场（该位战法槽清空），与旧行为一致、可选', () => {
    const cfg = withKit();
    const res = runSimMate(cfg, { ...FAST, slotSkills: 'clear', matchUnits: [2], coreUnits: [0] });
    expect(res.slotSkills).toBe('clear');
    expect(res.baseSkillNames[0]).toEqual(['突进', '先驱突击']); // 仍如实上报「这个位配了什么」
    expect(withSlotHero(cfg, 2, POOL[0], false).slots[2].skillIds).toEqual([]);
    expect(res.finals.every((f) => f.bySkill.every((s) => s.name !== '突进' && s.name !== '先驱突击'))).toBe(true);
  });

  it('两种口径会给出不同的数（带战法 ≠ 白板）', () => {
    const cfg = withKit();
    const keep = runSimMate(cfg, { ...FAST, matchUnits: [2], coreUnits: [0] });
    const clear = runSimMate(cfg, { ...FAST, slotSkills: 'clear', matchUnits: [2], coreUnits: [0] });
    expect(keep.finals[0].mean).not.toBe(clear.finals[0].mean);
    expect(keep.finals[0].mean).toBeGreaterThan(0);
    expect(clear.finals[0].mean).toBeGreaterThan(0);
  });

  it('视图：① 表有「主战法」列；④ 口径提示写明带入战法 / 白板进场告警', () => {
    const cfg = withKit();
    const keepHtml = mateResultHtml(runSimMate(cfg, { ...FAST, matchUnits: [2], coreUnits: [0] }));
    expect(keepHtml).toContain('主战法');
    expect(keepHtml).toContain('候选进场带什么战法');
    expect(keepHtml).toContain('保留该位已配战法');
    expect(keepHtml).toContain('突进');
    expect(keepHtml).not.toContain('undefined');

    // 两个位都空着 + keep ⇒ 红字提示「等于白板进场，辅助会被低估」
    const empty = baseCfg();
    empty.slots.forEach((s) => {
      s.skillIds = [];
    });
    const warn = mateResultHtml(runSimMate(empty, { ...FAST, matchUnits: [1], coreUnits: [0] }));
    expect(warn).toContain('白板进场');
    expect(warn).toContain('被低估');

    const clearHtml = mateResultHtml(runSimMate(cfg, { ...FAST, slotSkills: 'clear', matchUnits: [2], coreUnits: [0] }));
    expect(clearHtml).toContain('清空（白板进场）');
  });
});

describe('⑧ 同队互斥（引擎配队规则）：候选与组合先剔掉，不让跑批中途抛「配队非法」', () => {
  const ZHAOYUN = 'zhaoyun';
  const SP_ZHAOYUN = 'sp_zhaoyun';
  const JIANGWEI = 'h74';
  const SP_JIANGWEI = 'sp_jiangwei';

  it('规则口径：赵云 ↔ SP赵云、姜维 ↔ SP姜维 互斥；其余同名武将不互斥；重复上阵不合法', () => {
    expect(mutualGroupOf(ZHAOYUN)).toBe('赵云');
    expect(mutualGroupOf(SP_ZHAOYUN)).toBe('赵云');
    expect(mutualGroupOf(JIANGWEI)).toBe('姜维');
    expect(mutualGroupOf(SP_JIANGWEI)).toBe('姜维');
    expect(heroesMutuallyExclusive(ZHAOYUN, SP_ZHAOYUN)).toBe(true);
    expect(heroesMutuallyExclusive(JIANGWEI, SP_JIANGWEI)).toBe(true);
    expect(heroesMutuallyExclusive(ZHAOYUN, JIANGWEI)).toBe(false);
    expect(heroesMutuallyExclusive('h451', 'h26'), '关羽蜀/魏不再互斥').toBe(false);
    expect(teamHeroesLegal([ZHAOYUN, SP_ZHAOYUN])).toBe(false);
    expect(teamHeroesLegal([ZHAOYUN, SP_ZHAOYUN, JIANGWEI])).toBe(false);
    expect(teamHeroesLegal([ZHAOYUN, JIANGWEI, SP_JIANGWEI])).toBe(false);
    expect(teamHeroesLegal([ZHAOYUN, JIANGWEI, 'h3'])).toBe(true);
    expect(teamHeroesLegal(['h3', 'h3']), '同一武将不得占两个位').toBe(false);
  });

  it('◀ 用户实测场景：核心将 = 赵云 + 候选含 SP赵云 → 不再抛「配队非法」，SP赵云被剔出候选池', () => {
    const cfg = baseCfg(['zhaoyun', 'h5', 'h16']);
    const res = runSimMate(cfg, {
      ...FAST,
      candidateIds: [SP_ZHAOYUN, POOL[0], POOL[1]],
      matchUnits: [1, 2],
      coreUnits: [0],
      unitKeep: 4,
      coarseTop: 2,
    });
    expect(res.poolSkippedMutual, 'SP赵云与固定将赵云互斥 → 池里剔掉').toBe(1);
    expect(res.candidateCount).toBe(2);
    expect(res.errors, '不应再有跑批异常').toEqual([]);
    // 任何选项 / 组合 / 决赛都不含「赵云 + SP赵云」
    const heroSets = [
      ...res.groups[0].rows.map((r) => r.picks.map((p) => p.heroId)),
      ...res.combos.map((c) => c.picks.map((p) => p.heroId)),
      ...res.finals.map((f) => f.picks.map((p) => p.heroId)),
    ];
    expect(heroSets.length).toBeGreaterThan(0);
    for (const set of heroSets) expect(teamHeroesLegal([...set, ZHAOYUN])).toBe(true);
  });

  it('成对评估里「基准 ↔ 候选撞组」的一对会被跳过（赵云 × SP赵云），并计入 skippedIllegal', () => {
    const cfg = baseCfg(); // 队内无赵云 / 姜维 → 候选池本身不剔
    const res = runSimMate(cfg, {
      ...FAST,
      candidateIds: [ZHAOYUN, SP_ZHAOYUN, JIANGWEI, SP_JIANGWEI],
      matchUnits: [1, 2],
      coreUnits: [0],
      pairCarriers: 4,
      unitKeep: 10,
      coarseTop: 2,
    });
    expect(res.poolSkippedMutual).toBe(0);
    expect(res.skippedIllegal, '撞组的配对会被跳过').toBeGreaterThan(0);
    expect(res.errors).toEqual([]);
    for (const r of res.groups[0].rows) expect(teamHeroesLegal(r.picks.map((p) => p.heroId))).toBe(true);
    for (const f of res.finals) expect(teamHeroesLegal(f.picks.map((p) => p.heroId))).toBe(true);
  });

  it('当前配置本身违规（赵云 + SP赵云同队，SP赵云在被匹配的位）→ 不抛错、基线跳过，匹配照常继续', () => {
    const cfg = baseCfg(['zhaoyun', 'sp_zhaoyun', 'h16']);
    const res = runSimMate(cfg, {
      ...FAST,
      candidateIds: [JIANGWEI, POOL[0]],
      matchUnits: [1], // 换掉 SP赵云 这一位
      coreUnits: [0],
      unitKeep: 2,
      coarseTop: 1,
    });
    expect(res.baselineIllegal).toBe(true);
    expect(res.baseline.runs).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.groups[0].rows.length).toBeGreaterThan(0); // 换掉冲突将之后照常评估
    expect(res.finals.length).toBeGreaterThan(0);
    for (const f of res.finals) expect(teamHeroesLegal(f.picks.map((p) => p.heroId))).toBe(true);
  });

  it('整队都非法（冲突发生在固定位上）→ 不抛错，但也搜不出合法选项（如实上报，页面给提示）', () => {
    const cfg = baseCfg(['zhaoyun', 'sp_zhaoyun', 'h16']);
    const res = runSimMate(cfg, {
      ...FAST,
      candidateIds: [JIANGWEI, POOL[0]],
      matchUnits: [2], // 冲突在 0/1 号位（固定不动）→ 任何候选都救不了
      coreUnits: [0],
      unitKeep: 2,
      coarseTop: 1,
    });
    expect(res.baselineIllegal).toBe(true);
    expect(res.finals).toHaveLength(0);
    expect(res.errors).toEqual([]);
  });

  it('视图 HTML：口径提示写出互斥剔除与跳过数；违规基线给红字提示', () => {
    const cfg = baseCfg(['zhaoyun', 'h5', 'h16']);
    const res = runSimMate(cfg, {
      ...FAST,
      candidateIds: [SP_ZHAOYUN, POOL[0]],
      matchUnits: [1],
      coreUnits: [0],
      unitKeep: 2,
      coarseTop: 1,
    });
    const html = mateResultHtml(res);
    expect(html).toContain('同队互斥已剔掉');
    expect(html).toContain('赵云 ↔ SP赵云');
    expect(html).toContain('互斥剔除 1');
    expect(html).not.toContain('undefined');

    const illegalBase = runSimMate(baseCfg(['zhaoyun', 'sp_zhaoyun', 'h16']), {
      ...FAST,
      candidateIds: [JIANGWEI, POOL[0]],
      matchUnits: [2],
      coreUnits: [0],
      unitKeep: 2,
      coarseTop: 1,
    });
    expect(mateResultHtml(illegalBase)).toContain('当前配置本身违反互斥规则');
  });
});
