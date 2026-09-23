/**
 * 回合期望模型（web/roundModel.ts）测试
 * ① 解析层：出手位归类 / 发动率士气修正 / 目标数 / DoT / 增减伤抽取 / 未建模字段如实上报；
 * ② 期望发动次数：主动 p、准备 p(1−p)^(t−2)、追击 = 普攻次数 × p、动态发动率递推；
 * ③ 逐回合期望：纯普攻队 / 加主动 / 加准备 / 一类指挥 buff / 兵种克制 / 属性加成；
 * ④ 口径窗口：前三回合 / 前 N 回合 / 整局 8 回合（windowTotals）；
 * ⑤ 模型扩展：属性缩放 / 作用范围过滤 / roundStartRepeat / 无视防御 / 叠层增长；
 * ⑥ 冲突聚合：同类型取较高、同源叠层累加；
 * ⑦ 页面挂载：结构 + 切口径 + 存方案。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import { roundRate, scaledValue } from '../src/engine/formulas';
import { makeEvaluator } from '../web/optimizer';
import { defaultCfg } from '../web/teamConfig';
import {
  aggregateEffects,
  chainExtraRepeats,
  dynamicRateSeries,
  effectValue,
  parseSkill,
  preparedCastProb,
  simulateRounds,
  stackLayers,
  windowTotals,
  type ParsedSkill,
  type RoundUnit,
  type SkillSlot,
} from '../web/roundModel';
import { mountRoundModel } from '../web/roundModelView';

const unit = (over: Partial<RoundUnit> = {}): RoundUnit => ({
  id: 'u0',
  name: '测试将',
  heroId: 'h-test',
  attack: 200,
  strategy: 200,
  troops: 9000,
  troopType: 'infantry',
  skills: [],
  ...over,
});

const enemy = { defense: 150, strategy: 100, troopType: 'infantry' as const };

const sim = (units: RoundUnit[], rounds = 8, manual?: { boostCaused?: number }) =>
  simulateRounds({ units, enemy, morale: 100, rounds, manual });

describe('解析层：出手位与发动率', () => {
  it('主动 / 准备 / 一类指挥 各归其位', () => {
    const slotOf = (id: string): SkillSlot => parseSkill(SKILL_REGISTRY[id], 100).slot;
    expect(slotOf('tujin')).toBe('active'); // 突进（主动）
    expect(slotOf('yiji_dangqian')).toBe('prepared'); // 一骑当千（准备）
    expect(slotOf('dashang_sanjun')).toBe('command-prep'); // 大赏三军（一类指挥）
    expect(SKILL_REGISTRY['tujin'].triggerRate).toBe(0.25);
  });

  it('发动率按士气修正（120 士气 → ×1.12），被动与一类指挥恒为 1', () => {
    expect(parseSkill(SKILL_REGISTRY['tujin'], 120).rate).toBeCloseTo(0.25 * 1.12, 6);
    expect(parseSkill(SKILL_REGISTRY['dashang_sanjun'], 140).rate).toBe(1);
  });

  it('目标数：random_single=1、group=2、all=3', () => {
    expect(parseSkill(SKILL_REGISTRY['tujin'], 100).segments[0].targets).toBe(1);
    expect(parseSkill(SKILL_REGISTRY['yanfen_jizhen'], 100).segments[0].targets).toBe(2);
    expect(parseSkill(SKILL_REGISTRY['yiji_dangqian'], 100).segments[0].targets).toBe(3);
  });

  it('DoT 抽取：恐慌（楚歌四起）/ 燃烧（焰焚箕轸）跳数与伤害率', () => {
    const chuge = parseSkill(SKILL_REGISTRY['chuge_siqi'], 100);
    expect(chuge.dots).toHaveLength(1);
    expect(chuge.dots[0].label).toBe('恐慌');
    expect(chuge.dots[0].rate).toBe(127);
    expect(chuge.dots[0].ticks).toBe(2);
    expect(chuge.dots[0].targets).toBe(2);

    const yanfen = parseSkill(SKILL_REGISTRY['yanfen_jizhen'], 100);
    expect(yanfen.segments).toHaveLength(1);
    expect(yanfen.dots[0].label).toBe('燃烧');
  });

  it('增减伤抽取：大赏三军 = 我方造成伤害提高（受谋略缩放）、神兵天降 = 敌方受到伤害提高', () => {
    const das = parseSkill(SKILL_REGISTRY['dashang_sanjun'], 100).effects[0];
    expect(das.kind).toBe('boostCaused');
    expect(das.side).toBe('self');
    expect(das.scaledBase).toBe(30);
    expect(das.duration).toBe(3);

    const shen = parseSkill(SKILL_REGISTRY['shenbing_tianjiang'], 100).effects[0];
    expect(shen.kind).toBe('boostTaken');
    expect(shen.side).toBe('enemy');
  });

  it('连击：其疾如风 roundRepeat 70% 折算成 0.7 连击几率', () => {
    const qiji = parseSkill(SKILL_REGISTRY['qiji_rufeng'], 100);
    const combo = qiji.effects.find((e) => e.kind === 'combo');
    expect(combo?.value).toBeCloseTo(0.7, 6);
  });

  it('未建模字段如实上报（控制类不算未建模、但也不计入输出）', () => {
    const zhanbi = parseSkill(SKILL_REGISTRY['zhanbi_duanjin'], 100);
    expect(zhanbi.effects).toHaveLength(0); // 怯战 = 控制，不进输出修正
    expect(zhanbi.unmodeled).toHaveLength(0); // 控制类不再算「未覆盖」
  });
});

describe('期望发动次数', () => {
  it('准备主动：第 t 回合释放期望 = p(1−p)^(t−2)（t≥2），累计前三回合 = p + p(1−p)', () => {
    const p = 0.4;
    expect(preparedCastProb(p, 1, 1)).toBe(0);
    expect(preparedCastProb(p, 1, 2)).toBeCloseTo(p, 10);
    expect(preparedCastProb(p, 1, 3)).toBeCloseTo(p * (1 - p), 10);
    const first3 = preparedCastProb(p, 1, 1) + preparedCastProb(p, 1, 2) + preparedCastProb(p, 1, 3);
    expect(first3).toBeCloseTo(p + p * (1 - p), 10);
  });

  it('准备回合数 k=2：第 3 回合才可能释放', () => {
    expect(preparedCastProb(0.5, 2, 2)).toBe(0);
    expect(preparedCastProb(0.5, 2, 3)).toBeCloseTo(0.5, 10);
  });

  it('动态发动率递推：未生效递增、生效重置（奇兵拒北 30% +5%）', () => {
    const series = dynamicRateSeries(0.3, 0.05, 4);
    expect(series[0]).toBeCloseTo(0.3, 10);
    expect(series[1]).toBeCloseTo(0.3 * 0.3 + 0.7 * 0.35, 10);
    expect(series[2]).toBeGreaterThan(series[1]);
  });
});

describe('逐回合期望伤害', () => {
  it('纯普攻队：每回合一条普攻，三回合 = 3 × 单次', () => {
    const result = sim([unit()]);
    expect(result.rows).toHaveLength(8);
    const r1 = result.rows[0].total;
    expect(r1).toBeGreaterThan(0);
    expect(result.rows[1].total).toBeCloseTo(r1, 6);
    expect(result.first3).toBeCloseTo(r1 * 3, 6);
    expect(result.first3BySource['普攻']).toBeCloseTo(r1 * 3, 6);
  });

  it('加主动战法（突进 25%·115%·单体）：每回合增量 = p × 单次伤害', () => {
    const base = sim([unit()]);
    const withSkill = sim([unit({ skills: [parseSkill(SKILL_REGISTRY['tujin'], 100)] })]);
    const inc = withSkill.rows[0].total - base.rows[0].total;
    expect(inc).toBeGreaterThan(0);
    expect(withSkill.rows[1].total - base.rows[1].total).toBeCloseTo(inc, 6);
    expect(withSkill.first3 - base.first3).toBeCloseTo(inc * 3, 6);
  });

  it('准备战法（一骑当千 30%·280%·全体）：第 1 回合无贡献、第 2 回合 = p×3目标伤害', () => {
    const base = sim([unit()]);
    const withSkill = sim([unit({ skills: [parseSkill(SKILL_REGISTRY['yiji_dangqian'], 100)] })]);
    expect(withSkill.rows[0].total).toBeCloseTo(base.rows[0].total, 6);
    const d2 = withSkill.rows[1].total - base.rows[1].total;
    const d3 = withSkill.rows[2].total - base.rows[2].total;
    expect(d2).toBeGreaterThan(0);
    expect(d3).toBeCloseTo(d2 * 0.7, 1); // 第 3 回合释放几率 = p(1−p) → 比值 (1−p) = 0.7
  });

  it('一类指挥大赏三军：前 3 回合我方增伤（谋略 200 → 30 + 0.15×120 = 48%）', () => {
    const base = sim([unit()]);
    const withBuff = sim([unit({ skills: [parseSkill(SKILL_REGISTRY['dashang_sanjun'], 100)] })]);
    const gain = withBuff.first3 / base.first3 - 1;
    expect(gain).toBeGreaterThan(0.2);
    expect(gain).toBeLessThan(0.48); // 兵力基础不吃增伤 → 提升小于 48%
    const log = withBuff.effectLog.find((e) => e.kind === 'boostCaused');
    expect(log?.value).toBeCloseTo(0.48, 2);
    expect(log?.from).toBe(1);
    expect(log?.to).toBe(3);
  });

  it('兵种克制：被克制方（步兵打骑兵）普攻伤害明显下降', () => {
    const plain = sim([unit({ troopType: 'infantry' })]);
    const countered = simulateRounds({
      units: [unit({ troopType: 'infantry' })],
      enemy: { ...enemy, troopType: 'cavalry' },
      morale: 100,
      rounds: 8,
    });
    expect(countered.rows[0].total).toBeLessThan(plain.rows[0].total);
    expect(countered.rows[0].total / plain.rows[0].total).toBeLessThan(0.9);
  });

  it('属性加成提升伤害（谋略 buff 让策略战法更强）', () => {
    const strat = parseSkill(SKILL_REGISTRY['chuge_siqi'], 100);
    const low = sim([unit({ strategy: 150, skills: [strat] })]);
    const high = sim([unit({ strategy: 250, skills: [strat] })]);
    expect(high.first3).toBeGreaterThan(low.first3);
  });

  it('连击战法（其疾如风）提升普攻次数 → 伤害比 = 1 + 连击几率', () => {
    const base = sim([unit()]);
    const combo = sim([unit({ skills: [parseSkill(SKILL_REGISTRY['qiji_rufeng'], 100)] })]);
    expect(combo.first3 / base.first3).toBeCloseTo(1.7, 6);
  });

  it('每回合不变量：伤害 > 0、来源拆分之和 = 回合总量、累计单调递增', () => {
    const result = sim([unit({ skills: [parseSkill(SKILL_REGISTRY['yanfen_jizhen'], 100)] })]);
    let prev = 0;
    result.rows.forEach((r) => {
      expect(r.total).toBeGreaterThan(0);
      expect(Object.values(r.bySource).reduce((a, b) => a + b, 0)).toBeCloseTo(r.total, 6);
      expect(r.cumulative).toBeGreaterThan(prev);
      prev = r.cumulative;
    });
    expect(result.total).toBeCloseTo(result.rows[result.rows.length - 1].cumulative, 6);
  });
});

describe('口径窗口（前三回合 / 前 N 回合 / 整局 8 回合）', () => {
  it('windowTotals：前 3 = first3、整局 = total，且分单位/分来源求和一致', () => {
    const result = sim([unit({ skills: [parseSkill(SKILL_REGISTRY['yanfen_jizhen'], 100)] })], 8);
    const w3 = windowTotals(result, 3);
    const w8 = windowTotals(result, 8);
    expect(w3.total).toBeCloseTo(result.first3, 6);
    expect(w8.total).toBeCloseTo(result.total, 6);
    expect(w8.total).toBeGreaterThan(w3.total);
    expect(Object.values(w3.bySource).reduce((a, b) => a + b, 0)).toBeCloseTo(w3.total, 6);
    expect(w3.byUnit.reduce((a, b) => a + b, 0)).toBeCloseTo(w3.total, 6);
  });

  it('口径可切换：整局 > 前三回合，且前 5 回合介于两者之间', () => {
    const result = sim([unit()], 8);
    const rows3 = result.rows.slice(0, 3).reduce((a, r) => a + r.total, 0);
    expect(windowTotals(result, 3).total).toBeCloseTo(rows3, 6);
    expect(windowTotals(result, 5).total).toBeGreaterThan(windowTotals(result, 3).total);
    expect(windowTotals(result, 5).total).toBeLessThan(windowTotals(result, 8).total);
  });
});

describe('模型扩展：属性缩放 / 作用范围过滤 / 每回合段', () => {
  it('增减伤受谋略缩放（引擎口径：sign × roundRate(scaledValue(|rate|×100, growth, 谋略)) / 100）', () => {
    const p = parseSkill(SKILL_REGISTRY['mimou_dingshu'], 100);
    const eff = p.effects.find((e) => e.kind === 'boostCaused');
    expect(eff).toBeTruthy();
    expect(eff!.scaling?.attr).toBe('strategy');
    const v80 = effectValue(eff!, { attack: 100, strategy: 80 });
    const v200 = effectValue(eff!, { attack: 100, strategy: 200 });
    expect(v80).toBeGreaterThan(0);
    expect(v200).toBeGreaterThan(v80);
    const expected = roundRate(scaledValue(Math.abs(eff!.value) * 100, eff!.scaling!.growth, 200)) / 100;
    expect(v200).toBeCloseTo(expected, 10);
  });

  it('damageType 过滤：白刃的「策略伤害降低」只压策略段，普攻（兵刃）分文不动', () => {
    const physical = parseSkill(SKILL_REGISTRY['yiji_dangqian'], 100);
    const strategy = parseSkill(SKILL_REGISTRY['yanfen_jizhen'], 100);
    const bairen = parseSkill(SKILL_REGISTRY['bairen'], 100);
    const base = simulateRounds({ units: [unit({ skills: [physical, strategy] })], enemy, morale: 100, rounds: 3 });
    const withBairen = simulateRounds({
      units: [unit({ skills: [physical, strategy, bairen] })],
      enemy,
      morale: 100,
      rounds: 3,
    });
    expect(withBairen.first3BySource['普攻']).toBeCloseTo(base.first3BySource['普攻'], 6);
    expect(withBairen.first3).toBeLessThan(base.first3);
    expect(withBairen.effectLog.find((e) => e.kind === 'boostCaused')?.value).toBeLessThan(0);
  });

  it('roundStartRepeat：指定回合必执行的段带窗口（白刃第 4 回合的攻击加成）', () => {
    const bairen = parseSkill(SKILL_REGISTRY['bairen'], 100);
    expect(bairen.unmodeled).toHaveLength(0);
    const rsr = bairen.effects.find((e) => e.window);
    expect(rsr?.window?.start).toBe(4);
    expect(rsr?.window?.end).toBe(4);
    expect(rsr?.kind).toBe('attack');
    expect(bairen.effects.find((e) => e.kind === 'boostCaused')?.window).toBeUndefined();
  });

  it('次数型（charges）仍按未建模处理（按整场有效会明显高估）', () => {
    const yangwei = parseSkill(SKILL_REGISTRY['yangwei'], 100);
    expect(yangwei.effects.some((e) => e.unmodeled.some((k) => k.includes('charges')))).toBe(true);
  });

  it('近似处理与未建模分开记账（近似不卡严格池）', () => {
    const jiji = parseSkill(SKILL_REGISTRY['jiji_qihou'], 100);
    expect(jiji.segments.every((s) => s.unmodeled.length === 0)).toBe(true);
    expect(jiji.segments.some((s) => (s.approx ?? []).length > 0)).toBe(true);
  });
});

describe('模型扩展（二）：无视防御 / 叠层增长 / 口径取舍', () => {
  it('无视防御：击势的 ignore_def 已建模（不再算未覆盖）', () => {
    const jishi = parseSkill(SKILL_REGISTRY['jishi'], 120);
    expect(jishi.unmodeled).toHaveLength(0);
    const ign = jishi.effects.find((e) => e.kind === 'ignoreDef');
    // 状态带 65% 触发几率（经士气修正 120→×1.12）→ 期望值 = 0.6 × 0.65 × 1.12
    expect(ign?.value).toBeCloseTo(0.6 * 0.65 * 1.12, 4);
    // 高防目标下，无视防御 60% 提升伤害
    const tank = { defense: 400, strategy: 100, troopType: 'infantry' as const };
    const plain = simulateRounds({ units: [unit({ attack: 300 })], enemy: tank, morale: 100, rounds: 3 });
    const withJishi = simulateRounds({
      units: [unit({ attack: 300, skills: [jishi] })],
      enemy: tank,
      morale: 100,
      rounds: 3,
    });
    expect(withJishi.first3).toBeGreaterThan(plain.first3);
  });

  it('叠层类状态：层数随回合增长（被动每回合重挂 +1 层），不是固定 1 层', () => {
    const yuzhan = parseSkill(SKILL_REGISTRY['yuzhan_yuyong'], 120);
    const eff = yuzhan.effects[0];
    expect(eff.stack).toBe(true);
    expect(eff.maxStacks).toBe(0); // 0 = 无上限
    expect(stackLayers(yuzhan, 1, 1, eff.maxStacks)).toBe(1);
    expect(stackLayers(yuzhan, 1, 4, eff.maxStacks)).toBe(4);
    const result = sim([unit({ skills: [yuzhan] })], 8);
    expect(result.rows[7].total).toBeGreaterThan(result.rows[0].total * 1.15);
  });

  it('整局口径下叠层增伤 > 3 回合型增伤（大赏三军）——解释口径切换后的排序翻转', () => {
    const cfgBase = defaultCfg(['h3', 'h5', 'h16']);
    const ev8 = makeEvaluator(cfgBase, 8);
    const ev3 = makeEvaluator(cfgBase, 3);
    const empty = { 0: [], 1: [], 2: [] };
    const yuzhan = { 0: ['yuzhan_yuyong'], 1: [], 2: [] };
    const dashang = { 0: ['dashang_sanjun'], 1: [], 2: [] };
    const g3y = ev3.score(yuzhan) / ev3.score(empty);
    const g8y = ev8.score(yuzhan) / ev8.score(empty);
    const g8d = ev8.score(dashang) / ev8.score(empty);
    expect(g8y).toBeGreaterThan(g8d * 1.15); // 叠层 ≈ +30% vs 3 回合型 ≈ +5%
    expect(g8y).toBeGreaterThan(g3y); // 叠层在整局口径下更值钱
  });
});

describe('模型扩展（三）：伤害类型过滤 / 连锁段 / 衰减', () => {
  it('深谋远虑只加策略伤害、愈战愈勇只加攻击伤害（官方文案口径，2026-09-22 修复）', () => {
    expect(parseSkill(SKILL_REGISTRY['shenmou_yuanlv'], 100).effects[0].filters?.damageType).toBe('strategy');
    expect(parseSkill(SKILL_REGISTRY['yuzhan_yuyong'], 100).effects[0].filters?.damageType).toBe('physical');
  });

  it('物理输出将：深谋远虑不提供伤害（0%），愈战愈勇有效', () => {
    const cfgBase = defaultCfg(['h3', 'h5', 'h16']);
    const ev = makeEvaluator(cfgBase, 8);
    const empty = { 0: [], 1: [], 2: [] };
    const base = ev.score(empty);
    expect(ev.score({ 0: ['shenmou_yuanlv'], 1: [], 2: [] })).toBeCloseTo(base, 6);
    expect(ev.score({ 0: ['yuzhan_yuyong'], 1: [], 2: [] })).toBeGreaterThan(base * 1.1);
  });

  it('策略输出将：深谋远虑有效（同一口径）', () => {
    const cfgBase = defaultCfg(['h3', 'h5', 'h16']);
    const ev = makeEvaluator(cfgBase, 8);
    const strat = { 0: ['chuge_siqi'], 1: [], 2: [] };
    const withShen = { 0: ['chuge_siqi', 'shenmou_yuanlv'], 1: [], 2: [] };
    expect(ev.score(withShen)).toBeGreaterThan(ev.score(strat));
  });

  it('连锁段（乘胜追击）：折算成额外重复次数', () => {
    expect(chainExtraRepeats(0.5, 0.2)).toBeCloseTo(0.665, 6);
    expect(chainExtraRepeats(0, 0.2)).toBe(0);
    const cheng = parseSkill(SKILL_REGISTRY['chengsheng_zhuiji'], 100);
    expect(cheng.segments).toHaveLength(2);
    expect(cheng.segments[1].repeats).toBeGreaterThan(1);
    expect((cheng.segments[1].approx ?? []).join('')).toContain('连锁');
    expect(cheng.unmodeled).toHaveLength(0);
  });

  it('衰减类（虎豹督军 8 份）：解析出 round 衰减，后续回合系数降低', () => {
    const eff = parseSkill(SKILL_REGISTRY['hubao_dujun'], 100).effects[0];
    expect(eff.decay).toEqual({ parts: 8, mode: 'round' });
    const factor = (round: number): number => Math.max(0, eff.decay!.parts - (round - 1)) / eff.decay!.parts;
    expect(factor(1)).toBeCloseTo(1, 6);
    expect(factor(8)).toBeCloseTo(1 / 8, 6);
    expect(factor(9)).toBe(0);
  });
});
describe('模型扩展（四）：典藏【追加】段 / 士气分支 / 分兵 / 队伍门槛', () => {
  it('conditional：典藏【追加】段按条件求值（火烧连营已完整建模）', () => {
    const huoshao = parseSkill(SKILL_REGISTRY['huoshaolianying'], 120, {
      casterName: '陆逊',
      casterFaction: '吴',
      teamFactions: ['吴', '吴', '吴'],
      teamTroops: ['archer', 'archer', 'archer'],
    });
    expect(huoshao.unmodeled).toHaveLength(0);
    expect(huoshao.segments.length).toBeGreaterThan(0);
  });

  it('队伍兵种门槛（teamTroopFilter）：不满足时整次不生效，且不算未覆盖', () => {
    const ok = parseSkill(SKILL_REGISTRY['henge'], 120, { teamTroops: ['cavalry', 'infantry', 'infantry'] });
    const bad = parseSkill(SKILL_REGISTRY['henge'], 120, { teamTroops: ['cavalry', 'archer', 'infantry'] });
    expect(ok.gated).toBeUndefined();
    expect(ok.effects.length).toBeGreaterThan(0);
    expect(bad.gated).toBeTruthy();
    expect(bad.effects).toHaveLength(0);
    expect(bad.unmodeled).toHaveLength(0);
  });

  it('morale_branch：按敌方士气选分支（望风而降），两个分支都不算未覆盖', () => {
    const id = Object.keys(SKILL_REGISTRY).find((k) => SKILL_REGISTRY[k].name === '望风而降');
    expect(id).toBeTruthy();
    const high = parseSkill(SKILL_REGISTRY[id!], 120, { enemyMorale: 130 });
    const low = parseSkill(SKILL_REGISTRY[id!], 120, { enemyMorale: 60 });
    expect(high.unmodeled).toHaveLength(0);
    expect(low.unmodeled).toHaveLength(0);
    expect(high.segments.length + high.dots.length + high.effects.length).toBeGreaterThan(0);
  });

  it('分兵：令明负榇第 4 回合起挂分兵 → 普攻追加伤害', () => {
    const p = parseSkill(SKILL_REGISTRY['lingming_fuchen'], 120);
    const split = p.effects.find((e) => e.kind === 'split');
    expect(split?.value).toBe(50);
    expect(p.effects.find((e) => e.kind === 'boostCaused')?.filters?.damageType).toBe('physical');
    const enemy = { defense: 150, strategy: 100, troopType: 'infantry' as const };
    const plain = simulateRounds({ units: [unit()], enemy, morale: 120, rounds: 8 });
    const withSplit = simulateRounds({ units: [unit({ skills: [p] })], enemy, morale: 120, rounds: 8 });
    expect(withSplit.total).toBeGreaterThan(plain.total);
  });
});
describe('状态类互斥（连击 / 分兵：不同来源不可叠加、先施加者生效）', () => {
  it('连击是状态类：先驱突击已满连击时，其疾如风不再增加普攻次数', () => {
    const enemy = { defense: 150, strategy: 100, troopType: 'infantry' as const };
    const xianqu = parseSkill(SKILL_REGISTRY['xianqu_tuji'], 120); // 连击 p=1，3 回合
    const qiji = parseSkill(SKILL_REGISTRY['qiji_rufeng'], 120); // 连击 p=0.7×1.12
    const solo = simulateRounds({ units: [unit({ skills: [xianqu] })], enemy, morale: 120, rounds: 3 });
    const both = simulateRounds({ units: [unit({ skills: [xianqu, qiji] })], enemy, morale: 120, rounds: 3 });
    // 普攻次数：两者都是「至多 2 次」→ 逐回合普攻伤害完全相同
    expect(both.rows[0].bySource['普攻']).toBeCloseTo(solo.rows[0].bySource['普攻'], 6);
    expect(both.rows[1].bySource['普攻']).toBeCloseTo(solo.rows[1].bySource['普攻'], 6);
  });

  it('连击概率经士气修正（chance 0.6 → 0.6×1.12）', () => {
    const xiansheng = parseSkill(SKILL_REGISTRY['xiansheng_duoren'], 120);
    expect(xiansheng.effects.find((e) => e.kind === 'combo')?.probability).toBeCloseTo(0.6 * 1.12, 4);
    expect(xiansheng.segments[0].chance).toBeCloseTo(0.6 * 1.12, 4);
    expect(xiansheng.effects.find((e) => e.kind === 'split')?.probability).toBeCloseTo(0.6 * 1.12, 4);
  });

  it('分兵是状态类：两个来源都有 100% 施加时，只有「先施加者」生效（不叠加）', () => {
    const a = mkSplitSkill('splitA', 60, 1);
    const b = mkSplitSkill('splitB', 70, 1);
    const onlyA = basicOf([a]);
    const onlyB = basicOf([b]);
    const both = basicOf([a, b]);
    expect(onlyB).toBeGreaterThan(onlyA); // 70% 分兵更强
    expect(both).toBeCloseTo(onlyA, 6); // 先施加者（列表在前）生效，后者被拒
    expect(basicOf([b, a])).toBeCloseTo(onlyB, 6); // 顺序反了则以 B 为先
  });

  it('分兵互斥按「首次成功者」求期望率（p<1 时不是简单相加）', () => {
    const a = mkSplitSkill('splitA', 60, 0.5);
    const b = mkSplitSkill('splitB', 70, 0.5);
    const base = basicOf([]);
    const onlyA = basicOf([a]) - base;
    const onlyB = basicOf([b]) - base;
    const both = basicOf([a, b]) - base;
    expect(both).toBeLessThan(onlyA + onlyB - 1e-6); // 不允许双份叠加
    expect(both).toBeGreaterThan(Math.max(onlyA, onlyB) - 1e-6);
  });
});

describe('冲突聚合（引擎口径）', () => {
  it('同类型不同战法取较高；同源叠层按层数累加', () => {
    expect(
      aggregateEffects([
        { value: 0.3, source: 'A', stack: false, maxStacks: 0 },
        { value: 0.2, source: 'B', stack: false, maxStacks: 0 },
      ])
    ).toBeCloseTo(0.3, 10);
    expect(
      aggregateEffects([
        { value: 0.3, source: 'A', stack: false, maxStacks: 0 },
        { value: -0.5, source: 'C', stack: false, maxStacks: 0 },
      ])
    ).toBeCloseTo(-0.5, 10);
    expect(
      aggregateEffects([
        { value: 0.08, source: 'A', stack: true, maxStacks: 5 },
        { value: 0.08, source: 'A', stack: true, maxStacks: 5 },
      ])
    ).toBeCloseTo(0.16, 10);
  });
});

describe('页面挂载（jsdom）', () => {
  it('渲染结论 / 图表 / 拆解，改配置后重绘，切口径变大，存方案出现对比', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountRoundModel(root);

    const heroValue = root.querySelector('.rm-hero-value')!.textContent!.replace(/,/g, '');
    expect(Number(heroValue)).toBeGreaterThan(0);
    expect(root.querySelector('#rm-chart svg')).toBeTruthy();
    expect(root.querySelectorAll('.rm-unit')).toHaveLength(3);
    expect(root.querySelectorAll('#dm-readout, #rm-readout tbody tr').length).toBeGreaterThanOrEqual(0);
    expect(root.querySelector('#rm-chart')!.innerHTML).not.toContain('NaN');
    expect(root.querySelector('#rm-explain, #rm-effects')!.textContent).toBeTruthy();

    const before = root.querySelector('.rm-hero-value')!.textContent;
    const sel = root.querySelector<HTMLSelectElement>('[data-unit-skill="0-0"]')!;
    sel.value = 'yiji_dangqian';
    sel.dispatchEvent(new Event('change'));
    expect(root.querySelector('.rm-hero-value')!.textContent).not.toBe(before);

    root.querySelector<HTMLButtonElement>('#rm-snapshot')!.click();
    expect(root.querySelector('.rm-snaps')).toBeTruthy();

    // 口径切换：前三回合 → 整局，大数字应变大
    const objSel = root.querySelector<HTMLSelectElement>('#rm-objective');
    expect(objSel).toBeTruthy();
    const before3 = Number(root.querySelector('.rm-hero-value')!.textContent!.replace(/,/g, ''));
    objSel!.value = String(objSel!.options[objSel!.options.length - 1].value);
    objSel!.dispatchEvent(new Event('change'));
    const after8 = Number(root.querySelector('.rm-hero-value')!.textContent!.replace(/,/g, ''));
    expect(after8).toBeGreaterThan(before3);

    root.remove();
  });
});

/** 合成「只带分兵」的战法，用于隔离验证状态类互斥语义 */
function mkSplitSkill(id: string, rate: number, probability: number): ParsedSkill {
  return {
    id,
    name: id,
    slot: 'passive',
    timing: 'round_start',
    rate: 1,
    prepareTurns: 1,
    decayPerCast: 0,
    ratePerCast: 0,
    segments: [],
    dots: [],
    unmodeled: [],
    effects: [
      {
        kind: 'split',
        value: rate,
        probability,
        duration: 999,
        side: 'self',
        scope: 'caster',
        stack: false,
        maxStacks: 0,
        unmodeled: [],
      },
    ],
  } as ParsedSkill;
}

/** 该组战法下「第 1 回合普攻来源」的期望伤害 */
function basicOf(skills: ParsedSkill[]): number {
  const enemy = { defense: 150, strategy: 100, troopType: 'infantry' as const };
  return simulateRounds({ units: [unit({ skills })], enemy, morale: 120, rounds: 3 }).rows[0].bySource['普攻'];
}