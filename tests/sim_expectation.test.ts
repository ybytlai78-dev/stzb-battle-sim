/**
 * L2 伤害期望模型 · 模拟测评（web/simExpectation.ts）测试
 * ---------------------------------------------------------------------------
 * 用户口径（2026-09-28）：
 *   ① 靶子只有**不还手的木桩**（不放战法、不普攻）——本模型只算伤害期望，不掺胜负（胜负是 L4）；
 *   ② 用户指定的战法原样保留、只填空槽；匹配 = 整队战法组合按伤害排榜单，**粗筛前十进决赛**，
 *      决赛 ≥20 场汇总伤害期望并排行；
 *   ③ 粗筛 3 场 / 决赛 20 场都是可配置参数（决赛低于 20 一律抬回 20），固定种子可复现。
 * 另覆盖：候选排除已占用 / 宽配置（[主战法,可学,可学]）第 3 格可匹配 / 合法组合枚举与上限截断 /
 * 统计不变量 / 木桩兵力截断告警 / 进度事件 / 视图 HTML / 页面端到端。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { runOne } from '../web/battleSim';
import { HERO_RECORDS } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { parseSkill } from '../web/roundModel';
import { defaultCfg, generalsOf, type ViewCfg } from '../web/teamConfig';
import {
  autoCoreUnits,
  candidateSkills,
  comboLegal,
  dummyLabel,
  dummyTeamFromEnemy,
  estimateBattles,
  FINAL_RUNS_MIN,
  legalCombos,
  pairAgreement,
  runSimExpectation,
  simExpectationSteps,
  simSlots,
  usedSkillIds,
  withSlotSkill,
  type SimExpectProgress,
  type UnitCoarse,
  type UnitOptionRow,
} from '../web/simExpectation';
import { simControlsHtml, simProgressHtml, simResultHtml } from '../web/simExpectView';
import { mountRoundModel } from '../web/roundModelView';

/** 夹具用的真实战法 id（全部在注册表里；见 src/data/skills.ts） */
const SK = {
  tujin: 'tujin', // 突进（主动）
  lianzhan: 'lianzhan', // 连战
  yuzhan: 'yuzhan_yuyong', // 愈战愈勇
  xianqu: 'xianqu_tuji', // 先驱突击
  shenbing: 'shenbing_tianjiang', // 神兵天降
  dashang: 'dashang_sanjun', // 大赏三军
  qingnang: 'qingnang_miyao', // 青囊秘要
  daoxing: 'daoxing_xianzu', // 道行险阻
};

/** 基线配置：三将（默认队伍），战法槽清空 */
function baseCfg(): ViewCfg {
  const cfg = defaultCfg(['h3', 'h5', 'h16']);
  cfg.slots.forEach((s) => {
    s.skillIds = [];
  });
  return cfg;
}

/** 填满 unit i 的战法槽 */
function fill(cfg: ViewCfg, unit: number, ids: string[]): ViewCfg {
  cfg.slots[unit].skillIds = [...ids];
  return cfg;
}

/** 夹具：unit0 / unit1 填满 → 只剩 unit2 的两个空槽 */
function twoSlotCfg(): ViewCfg {
  const cfg = baseCfg();
  fill(cfg, 0, [SK.tujin, SK.lianzhan]);
  fill(cfg, 1, [SK.yuzhan, SK.xianqu]);
  return cfg;
}

/** 夹具：unit0 填满、unit1 留 1 个空槽、unit2 留 2 个 → 共 3 个空槽 */
function threeSlotCfg(): ViewCfg {
  const cfg = baseCfg();
  fill(cfg, 0, [SK.tujin, SK.lianzhan]);
  fill(cfg, 1, [SK.yuzhan]);
  return cfg;
}

const TWO_CANDIDATES = [SK.shenbing, SK.dashang];
const THREE_CANDIDATES = [SK.shenbing, SK.dashang, SK.qingnang];
/** 4 个候选：才有「不同战法套」可言（3 个候选填 3 个空槽 = 永远同一套） */
const FOUR_CANDIDATES = [SK.shenbing, SK.dashang, SK.qingnang, SK.daoxing];

describe('候选口径：只填空槽、保留用户指定战法', () => {
  it('空槽位识别：默认队伍 3 将 × 2 槽 = 6 个空槽；指定战法的槽位不再参与匹配', () => {
    const cfg = fill(baseCfg(), 0, [SK.tujin]);
    const slots = simSlots(cfg);
    expect(slots).toHaveLength(5);
    expect(slots.some((s) => s.unit === 0 && s.slot === 0)).toBe(false);
    expect(slots.filter((s) => s.unit === 0).map((s) => s.slot)).toEqual([1]);
    expect(slots[0].unitName).toBe(HERO_RECORDS['h3'].name);
  });

  it('截图识别的配置（skillIds = [主战法, 可学, 可学]）：第 3 格清空也能被匹配到', () => {
    const cfg = baseCfg();
    fill(cfg, 0, [HERO_RECORDS['h3'].mainSkillId ?? SK.tujin, SK.lianzhan, '']);
    const slots = simSlots(cfg);
    expect(slots.some((s) => s.unit === 0 && s.slot === 2)).toBe(true);
    expect(slots.some((s) => s.unit === 0 && s.slot === 0)).toBe(false);
    const next = withSlotSkill(cfg, 0, 2, SK.shenbing);
    expect(next.slots[0].skillIds[0]).toBe(cfg.slots[0].skillIds[0]);
    expect(next.slots[0].skillIds[2]).toBe(SK.shenbing);
  });

  it('队内已占用战法（含主战法）一律不进候选池', () => {
    const cfg = fill(baseCfg(), 0, [SK.tujin, SK.lianzhan]);
    const used = usedSkillIds(cfg);
    expect(used.has(SK.tujin)).toBe(true);
    expect(used.has(SK.lianzhan)).toBe(true);
    const mainId = HERO_RECORDS['h3'].mainSkillId;
    expect(mainId ? used.has(mainId) : true).toBe(true);

    const pool = candidateSkills(cfg, { candidateIds: [SK.tujin, SK.lianzhan, SK.yuzhan, 'no_such_skill'] });
    expect(pool).toEqual([SK.yuzhan]);
  });

  it('withSlotSkill 只改目标槽位，其余槽位（含用户指定的）原样保留', () => {
    const cfg = fill(baseCfg(), 0, [SK.tujin]);
    const next = withSlotSkill(cfg, 0, 1, SK.lianzhan);
    expect(next.slots[0].skillIds).toEqual([SK.tujin, SK.lianzhan]);
    expect(cfg.slots[0].skillIds).toEqual([SK.tujin]); // 原 cfg 不被改写
    expect(next.slots[1].skillIds).toEqual(cfg.slots[1].skillIds);
  });

  it('组合合法性：同一战法不得出现在两个槽位（空槽不计）', () => {
    expect(comboLegal([{ skillId: 'a' }, { skillId: 'b' }])).toBe(true);
    expect(comboLegal([{ skillId: 'a' }, { skillId: 'a' }])).toBe(false);
    expect(comboLegal([{ skillId: '' }, { skillId: '' }])).toBe(true);
  });
});

describe('靶子：不还手的木桩（不放战法、不普攻）', () => {
  it('木桩三只同模板：防御 / 谋略 / 兵种取「目标」栏，无战法、兵力可配', () => {
    const cfg = baseCfg();
    cfg.enemy = { defense: 240, strategy: 180, troopType: 'cavalry' };
    const team = dummyTeamFromEnemy(cfg.enemy, cfg.morale, 20000);
    expect(team).toHaveLength(3);
    for (const g of team) {
      expect(g.defense).toBe(240);
      expect(g.strategy).toBe(180);
      expect(g.troopType).toBe('cavalry');
      expect(g.maxTroops).toBe(20000);
      expect([...g.activeSkillIds, ...g.passiveSkillIds, ...g.commandSkillIds, ...g.pursuitSkillIds]).toEqual([]);
      expect(g.name).toBe('木桩');
    }
    expect(team.map((g) => g.position)).toEqual(['大营', '中军', '前锋']);
    expect(dummyLabel(cfg.enemy, 20000)).toContain('不还手木桩');
  });

  it('木桩不还手：我方造成伤害，木桩方伤害恒为 0（含交换场地那一半场次）', () => {
    const cfg = twoSlotCfg();
    const enemy = dummyTeamFromEnemy(cfg.enemy, cfg.morale, 30000);
    const mine = generalsOf(cfg, cfg.morale);
    const env = { maxRounds: 8, swapSides: true, baseSeed: 20260922, inertSides: ['enemy' as const] };
    let myTotal = 0;
    for (let i = 0; i < 6; i += 1) {
      const raw = runOne(mine, enemy, i, env);
      myTotal += raw.myDamage;
      // i 为奇数时我方被放到右侧：木桩视角跟着翻，仍然不能还手
      expect(raw.enemyDamage, `第 ${i + 1} 场木桩不应造成伤害`).toBe(0);
      expect(raw.myFinalTroops.every((t) => t > 0), '我方不应掉兵').toBe(true);
    }
    expect(myTotal).toBeGreaterThan(0);
  });

  it('不传 inertSides：木桩照常还手（引擎默认行为未变）', () => {
    const cfg = twoSlotCfg();
    const enemy = dummyTeamFromEnemy(cfg.enemy, cfg.morale, 30000);
    const raw = runOne(generalsOf(cfg, cfg.morale), enemy, 0, {
      maxRounds: 8,
      swapSides: true,
      baseSeed: 20260922,
    });
    expect(raw.enemyDamage).toBeGreaterThan(0);
  });

  it('木桩兵力太小 → 伤害被截断：wipedRuns 如实上报（提示调大兵力）', () => {
    const cfg = twoSlotCfg();
    cfg.enemy = { defense: 80, strategy: 80, troopType: 'infantry' };
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 1,
      coarseTop: 1,
      dummyTroops: 300, // 明显不够打：木桩会被打空
    });
    expect(res.finals).toHaveLength(1);
    expect(res.finals[0].wipedRuns).toBeGreaterThan(0);
    expect(res.wipedCombos).toBe(1);
  });
});

describe('排序口径：核心将伤害（不是全队总伤）', () => {
  it('自动识别核心将：主战法带伤害段的将里取属性最高者；核心位可覆盖', () => {
    const cfg = threeSlotCfg();
    const auto = autoCoreUnits(cfg);
    expect(auto).toHaveLength(1);
    const mainId = HERO_RECORDS[cfg.slots[auto[0]].heroId].mainSkillId;
    const parsed = parseSkill(SKILL_REGISTRY[mainId], cfg.morale);
    expect(parsed.segments.length + parsed.dots.length).toBeGreaterThan(0);

    // 显式指定核心 = 另一个将
    const other = [0, 1, 2].find((u) => u !== auto[0])!;
    const res = runSimExpectation(cfg, { candidateIds: TWO_CANDIDATES, coarseRuns: 3, finalRuns: 20, unitKeep: 1, coreUnits: [other] });
    expect(res.coreUnits).toEqual([other]);
    expect(res.coreLabel).toBe(HERO_RECORDS[cfg.slots[other].heroId].name);
  });

  it('◀ 口径不变量：排行的 mean = 核心将场均伤害（多选核心 = 这些将之和；全选 = 全队总伤）', () => {
    const cfg = twoSlotCfg();
    const core = [2];
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 2,
      coreUnits: core,
    });
    expect(res.finals.length).toBeGreaterThan(0);
    for (const f of res.finals) {
      const coreSum = f.byUnit.filter((u) => u.core).reduce((a, u) => a + u.mean, 0);
      expect(f.mean).toBeCloseTo(coreSum, 6); // 排名键 = 核心将伤害
      expect(f.meanTotal).toBeCloseTo(
        f.byUnit.reduce((a, u) => a + u.mean, 0),
        6
      ); // 全队总伤只是参考列
      expect(f.meanTotal).toBeGreaterThan(f.mean); // 单核时总伤更大
      expect(f.byUnit.filter((u) => u.core).map((u) => u.unit)).toEqual(core);
    }
  });

  it('核心 = 全队时，口径值 = 全队总伤（等价旧口径）', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 1,
      coarseTop: 1,
      coreUnits: [0, 1, 2],
    });
    const f = res.finals[0];
    expect(f.mean).toBeCloseTo(f.meanTotal, 6);
  });
});

describe('参与匹配的将：只搜勾选的将，其余将战法不动', () => {
  it('matchUnits=[0] 时只有 0 号位的空槽参与匹配（真跑场次随之下降）', () => {
    const cfg = threeSlotCfg();
    const only0 = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 2,
      matchUnits: [0],
    });
    expect(only0.matchUnits).toEqual([0]);
    expect(only0.slots.every((s) => s.unit === 0)).toBe(true);
    // 0 号位有 2 个空槽（夹具里 unit0 填满、unit1 留 1 个、unit2 留 2 个 → 这里 unit0 无空槽）
    // 因此改用真正留空的将再验一次
    const only2 = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 2,
      matchUnits: [2],
    });
    expect(only2.slots).toHaveLength(2);
    expect(only2.slots.every((s) => s.unit === 2)).toBe(true);
    expect(only2.matchLabel).toBe(HERO_RECORDS[cfg.slots[2].heroId].name);
    // 只搜 unit2（双槽将 → 按对评估）：一个将上榜、组合与决赛照常出
    expect(only2.coarse).toHaveLength(1);
    expect(only2.coarse[0].mode).toBe('pair');
    expect(only2.combos.length).toBeGreaterThan(0);
    expect(only2.finals.length).toBeGreaterThan(0);
    expect(estimateBattles(cfg, { candidateIds: TWO_CANDIDATES, coarseRuns: 3, finalRuns: 20, unitKeep: 2, coarseTop: 2, matchUnits: [2] })).toBeGreaterThanOrEqual(
      only2.battles
    );
  });

  it('simSlots 按 matchUnits 过滤（空数组 / 不传 = 全部）', () => {
    const cfg = threeSlotCfg();
    expect(simSlots(cfg).length).toBe(3);
    expect(simSlots(cfg, [2]).every((s) => s.unit === 2)).toBe(true);
    expect(simSlots(cfg, [2])).toHaveLength(2);
  });
});

describe('合法组合枚举（全队战法唯一，按「将选项」拼）', () => {
  const opt = (picks: Array<[number, string]>, score: number, kept = true): UnitOptionRow => ({
    picks: picks.map(([slot, skillId]) => ({ slot, skillId, skillName: skillId })),
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
  const unitCoarse = (unit: number, slots: number[], rows: Array<UnitOptionRow | [Array<[number, string]>, number, boolean]>): UnitCoarse => {
    const norm = rows.map((r) => (Array.isArray(r) ? opt(r[0], r[1], r[2]) : r));
    norm.forEach((r, i) => {
      r.rank = i + 1;
    });
    return {
      unit,
      unitName: `将${unit}`,
      slots,
      mode: slots.length >= 2 ? 'pair' : 'single',
      rows: norm,
      keptKeys: norm.filter((r) => r.kept).map((r) => r.picks.map((p) => p.skillId).sort().join('+')),
    };
  };

  it('单槽将：组合 = 各将选项的并集，撞同一战法的不合法', () => {
    const a = unitCoarse(0, [0], [
      [[[0, 'x']], 100, true],
      [[[0, 'y']], 90, true],
    ]);
    const b = unitCoarse(1, [1], [
      [[[1, 'x']], 100, true],
      [[[1, 'z']], 80, true],
    ]);
    const combos = legalCombos([a, b], 64, true).map((c) => c.map((p) => p.skillId).join('+'));
    // x+x 撞车被排除，其余三个合法
    expect(combos.sort()).toEqual(['x+z', 'y+x', 'y+z']);
  });

  it('双槽将：一个选项带两个战法一起进组合（成对评估的结果直接当整队候选）', () => {
    const a = unitCoarse(0, [0, 1], [
      [
        [
          [0, 'jishi'],
          [1, 'yiji'],
        ],
        200,
        true,
      ],
    ]);
    const b = unitCoarse(1, [1], [[[[1, 'tujin']], 100, true]]);
    const combos = legalCombos([a, b], 64, true);
    expect(combos).toHaveLength(1);
    expect(combos[0].map((p) => p.skillId).sort()).toEqual(['jishi', 'tujin', 'yiji']);
  });

  it('按名次优先展开，取满 cap 即停', () => {
    const a = unitCoarse(0, [0], [
      [[[0, 'a']], 100, true],
      [[[0, 'b']], 90, true],
    ]);
    const b = unitCoarse(1, [1], [
      [[[1, 'a']], 100, true],
      [[[1, 'b']], 90, true],
    ]);
    expect(legalCombos([a, b], 64, true).map((c) => c.map((p) => p.skillId).join('+'))).toEqual(['a+b', 'b+a']);
    expect(legalCombos([a, b], 1, true)).toHaveLength(1);
  });

  it('保留名单拼不出组合（两个将都只剩同一个战法）→ 空', () => {
    const a = unitCoarse(0, [0], [[[[0, 'x']], 100, true]]);
    const b = unitCoarse(1, [1], [[[[1, 'x']], 100, true]]);
    expect(legalCombos([a, b], 64, true)).toEqual([]);
    // 放开到全量选项后能补出一个（另一将多一个未保留的选项）
    const b2 = unitCoarse(1, [1], [
      [[[1, 'x']], 100, true],
      [[[1, 'y']], 90, false],
    ]);
    expect(legalCombos([a, b2], 64, false).map((c) => c.map((p) => p.skillId).join('+'))).toEqual(['x+y']);
  });
});

describe('保留名单兜底', () => {
  it('保留名单拼不出组合时整体流程会放开到全量选项（comboFallback）', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 1,
      coarseTop: 2,
    });
    expect(res.combos.length).toBeGreaterThan(0);
    expect(res.finals.length).toBeGreaterThan(0);
    if (res.comboFallback) expect(res.combos.length).toBeGreaterThan(0);
  });
});

describe('三阶段：逐将粗筛 → 组合榜单 → 决赛排行', () => {
  it('阈值可配置；决赛场次低于 20 被抬回下限', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 2,
      finalRuns: 5, // 低于下限 → 抬回 20
      unitKeep: 2,
      coarseTop: 10,
    });
    expect(res.options.coarseRuns).toBe(2);
    expect(res.options.finalRuns).toBe(FINAL_RUNS_MIN);
    // 双槽将：只有一个「将」参与匹配，且按**成对组合**评估（选项 = 配对 + 少量单挂）
    expect(res.coarse).toHaveLength(1);
    expect(res.coarse[0].mode).toBe('pair');
    expect(res.coarse[0].slots).toHaveLength(2);
    expect(res.coarse[0].rows.some((r) => r.from === 'pair' && r.picks.length === 2)).toBe(true);
    for (const r of res.coarse[0].rows) {
      expect(r.runs).toBe(2);
      expect(r.damages).toHaveLength(2);
    }
    expect(res.finals.every((f) => f.runs === FINAL_RUNS_MIN)).toBe(true);
    expect(res.battles).toBeGreaterThan(0);
  });

  it('双槽将的候选按「对」评估：带满槽才见效的增伤战法不会被单挂成绩误杀', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: FOUR_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 10,
      pairCarriers: 4,
    });
    const unit = res.coarse[0];
    expect(unit.mode).toBe('pair');
    // 每个候选都以「搭档」身份出现在某个成对选项里（4 个候选 → 至少 C(4,2)=6 个不同的对）
    const pairKeys = new Set(
      unit.rows.filter((r) => r.from === 'pair').map((r) => r.picks.map((p) => p.skillId).sort().join('+'))
    );
    expect(pairKeys.size).toBe(6);
    for (const id of FOUR_CANDIDATES) {
      expect([...pairKeys].some((k) => k.split('+').includes(id))).toBe(true);
    }
    // 单挂选项也留着（留个「单挂更优」的出口），但数量受控
    expect(unit.rows.filter((r) => r.from === 'single').length).toBeLessThanOrEqual(3);
  });

  it('同一套战法的换将排列只留成绩最好的一种进决赛（duplicateOf 标注）', () => {
    // 两个「单槽将」各留 A/B 两个候选 → 组合 (u0=A,u1=B) 与 (u0=B,u1=A) 是同一套战法
    const cfg = baseCfg();
    fill(cfg, 0, [SK.tujin]);
    fill(cfg, 1, [SK.lianzhan]);
    fill(cfg, 2, [SK.yuzhan, SK.xianqu]); // 第三个将填满 → 不参与
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 5,
      matchUnits: [0, 1],
    });
    expect(res.combos).toHaveLength(2);
    expect(res.combos[0].skillKey).toBe(res.combos[1].skillKey);
    expect(res.combos.filter((c) => c.advanced)).toHaveLength(1);
    expect(res.combos[1].duplicateOf).toBe(res.combos[0].rank);
    expect(res.finals).toHaveLength(1);
  });

  it('榜单进决赛：按「不同战法套」取前 coarseTop 套，决赛名次可重排', () => {
    const cfg = threeSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: FOUR_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 3,
    });
    expect(res.combos.length).toBeGreaterThan(1);
    // 不变量：distinctCombos = 榜单里不同战法套数；进决赛套数 = min(coarseTop, distinctCombos)
    expect(res.distinctCombos).toBe(new Set(res.combos.map((c) => c.skillKey)).size);
    const expectedAdvance = Math.min(3, res.distinctCombos);
    expect(res.finals).toHaveLength(expectedAdvance);
    const advanced = res.combos.filter((c) => c.advanced);
    expect(advanced).toHaveLength(expectedAdvance);
    // 进决赛的必须是不同战法套，且名次按粗筛成绩升序（同套只保留最好的一种）
    expect(new Set(advanced.map((c) => c.skillKey)).size).toBe(expectedAdvance);
    const advancedRanks = advanced.map((c) => c.rank);
    expect([...advancedRanks].sort((a, b) => a - b)).toEqual(advancedRanks);
    // 「同套」标注必须指向同 skillKey 的更靠前一条
    for (const c of res.combos.filter((x) => !x.advanced && x.duplicateOf !== null)) {
      const first = res.combos.find((x) => x.rank === c.duplicateOf)!;
      expect(first.skillKey).toBe(c.skillKey);
      expect(first.rank).toBeLessThan(c.rank);
    }
    // 决赛排行按场均期望降序 + 名次 1..n
    const means = res.finals.map((f) => f.mean);
    expect([...means].sort((a, b) => b - a)).toEqual(means);
    expect(res.finals.map((f) => f.rank)).toEqual(res.finals.map((_, i) => i + 1));
    expect(new Set(res.finals.map((f) => f.label)).size).toBe(expectedAdvance);
  });

  it('无空槽：退化为「当前配置跑粗筛 + 决赛」，仍出期望', () => {
    const cfg = baseCfg();
    fill(cfg, 0, [SK.tujin, SK.lianzhan]);
    fill(cfg, 1, [SK.yuzhan, SK.xianqu]);
    fill(cfg, 2, [SK.shenbing, SK.dashang]);
    const res = runSimExpectation(cfg, { coarseRuns: 3, finalRuns: 20 });
    expect(res.noEmptySlot).toBe(true);
    expect(res.candidateCount).toBe(0);
    expect(res.coarse).toHaveLength(0);
    expect(res.combos).toHaveLength(1);
    expect(res.finals).toHaveLength(1);
    expect(res.finals[0].label).toBe('（当前配置）');
    expect(res.battles).toBe(3 + 20);
  });

  it('组合评估上限：maxCombos 截断并如实上报 combosCapped', () => {
    const cfg = threeSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: THREE_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 3,
      coarseTop: 2,
      maxCombos: 3,
    });
    expect(res.combos).toHaveLength(3);
    expect(res.combosCapped).toBe(true);
    // 前 2 套不同战法进决赛（评估到 3 条里可能含同套，故 ≤2 且 ≥1）
    expect(res.finals.length).toBeGreaterThan(0);
    expect(res.finals.length).toBeLessThanOrEqual(2);
  });

  it('预计真跑场次 ≥ 实际场次（页面开跑前提示用）', () => {
    const cfg = twoSlotCfg();
    const opts = { candidateIds: TWO_CANDIDATES, coarseRuns: 3, finalRuns: 20, unitKeep: 2, coarseTop: 2 };
    const estimate = estimateBattles(cfg, opts);
    const res = runSimExpectation(cfg, opts);
    expect(estimate).toBeGreaterThanOrEqual(res.battles);
    expect(estimate).toBe(2 * 2 * 3 + 2 * 2 * 3 + 2 * 20);
  });
});

describe('统计与复现', () => {
  const opts = {
    candidateIds: TWO_CANDIDATES,
    coarseRuns: 3,
    finalRuns: 20,
    unitKeep: 2,
    coarseTop: 2,
  } as const;

  it('固定种子 → 两次跑批逐场伤害完全一致（可复现）', () => {
    const cfg = twoSlotCfg();
    const a = runSimExpectation(cfg, opts);
    const b = runSimExpectation(cfg, opts);
    expect(a.finals.map((f) => f.label)).toEqual(b.finals.map((f) => f.label));
    expect(a.finals[0].damages).toEqual(b.finals[0].damages);
    expect(a.finals[0].mean).toBeCloseTo(b.finals[0].mean, 9);
  });

  it('统计不变量：min ≤ 均值 ≤ max、前三回合均值 ≤ 整局均值、95% 半宽 ≥ 0、每将伤害和 > 0', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, opts);
    for (const f of res.finals) {
      expect(f.min).toBeLessThanOrEqual(f.mean);
      expect(f.mean).toBeLessThanOrEqual(f.max);
      expect(f.meanFirst3).toBeLessThanOrEqual(f.mean);
      expect(f.halfWidth).toBeGreaterThanOrEqual(0);
      expect(f.byUnit.reduce((a, u) => a + u.mean, 0)).toBeGreaterThan(0);
    }
  });

  it('逐回合伤害之和 = 该场总伤（前三回合口径的底座）', () => {
    const cfg = twoSlotCfg();
    const raw = runOne(generalsOf(cfg, cfg.morale), dummyTeamFromEnemy(cfg.enemy, cfg.morale, 30000), 0, {
      maxRounds: 8,
      swapSides: true,
      baseSeed: 20260922,
      inertSides: ['enemy'],
    });
    const sum = raw.myDamageByRound.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(raw.myDamage, 6);
    expect(raw.myDamageByRound.length).toBeGreaterThan(0);
  });

  it('比对字段齐备：粗筛均值 / 粗筛偏差 / 旧解析值 / 排序一致率', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, opts);
    const f = res.finals[0];
    expect(f.coarseMean).toBeGreaterThan(0);
    expect(Number.isFinite(f.coarseBias)).toBe(true);
    expect(f.analyticTotal).toBeGreaterThan(0);
    expect(f.analyticFirst3).toBeGreaterThan(0);
    expect(Number.isFinite(f.deltaTotal)).toBe(true);
    expect(Number.isFinite(f.deltaFirst3)).toBe(true);
    expect(res.rankAgreement).toBeGreaterThanOrEqual(0);
    expect(res.rankAgreement).toBeLessThanOrEqual(1);
  });

  it('成对一致率：同序 = 1、反序 = 0', () => {
    expect(pairAgreement([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(pairAgreement([1, 2, 3], [3, 2, 1])).toBe(0);
    expect(pairAgreement([5], [9])).toBe(1);
  });
});

describe('进度事件：逐槽粗筛 → 组合粗筛 → 决赛，逐场上报', () => {
  it('事件数 = 真跑场次；阶段顺序与阶段总量正确', () => {
    const cfg = twoSlotCfg();
    const events: SimExpectProgress[] = [];
    const gen = simExpectationSteps(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 1,
    });
    let step = gen.next();
    while (!step.done) {
      events.push(step.value);
      step = gen.next();
    }
    const result = step.value;
    const slotEvents = events.filter((e) => e.phase === 'slot');
    const comboEvents = events.filter((e) => e.phase === 'combo');
    const finalEvents = events.filter((e) => e.phase === 'final');
    // 逐场上报 + 阶段顺序：slot → combo → final；事件数 = 真跑场次（跳过的重复配对不记账）
    expect(slotEvents.length).toBeGreaterThan(0);
    expect(comboEvents.length).toBeGreaterThan(0);
    expect(finalEvents.length).toBeGreaterThan(0);
    expect(events).toHaveLength(result.battles);
    expect(events[0].phase).toBe('slot');
    expect(events[events.length - 1].phase).toBe('final');
    expect(events[events.length - 1].battle).toBe(result.battles);
    // 决赛事件数 = 进决赛支数 × 决赛场次；组合/决赛阶段没有跳过项 → 进度推到总量
    expect(finalEvents).toHaveLength(result.finals.length * result.options.finalRuns);
    for (const e of comboEvents) expect(e.phaseDone).toBeLessThanOrEqual(e.phaseTotal);
    expect(comboEvents[comboEvents.length - 1].phaseDone).toBe(comboEvents[0].phaseTotal);
    expect(finalEvents[finalEvents.length - 1].phaseDone).toBe(finalEvents[0].phaseTotal);
    // 逐将阶段可能跳过「自己配自己 / 重复对」，故只要求进度单调不减、不超总量
    for (const e of slotEvents) expect(e.phaseDone).toBeLessThanOrEqual(e.phaseTotal);
  });
});

describe('视图层（web/simExpectView.ts）', () => {
  it('参数区：粗筛 / 决赛 / 每将保留 / 配对基准 / 进决赛组合 / 木桩兵力都是可见可配的', () => {
    const html = simControlsHtml({
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 10,
      pairCarriers: 10,
      coarseTop: 32,
      maxCombos: 1000,
      rankBy: 'total',
      dummyTroops: 150000,
      seed: 20260922,
      swapSides: true,
      units: [
        { unit: 0, name: '甲', hasEmptySlot: true },
        { unit: 1, name: '乙', hasEmptySlot: false },
      ],
      matchUnits: [0],
      emptySlots: [{ key: '0-1', unit: 0, slot: 1, unitName: '甲' }],
      coreSlotKeys: ['0-1'],
      autoCoreName: '甲',
      estimate: 1234,
    });
    expect(html).toContain('id="rm-sim-coarse"');
    expect(html).toContain('value="3"');
    expect(html).toContain('id="rm-sim-final"');
    expect(html).toContain(`min="${FINAL_RUNS_MIN}"`);
    expect(html).toContain('id="rm-sim-keep"');
    expect(html).toContain('id="rm-sim-paircars"');
    expect(html).toContain('id="rm-sim-top"');
    expect(html).toContain('id="rm-sim-troops"');
    expect(html).toContain('id="rm-sim-run"');
    expect(html).toContain('不还手的木桩');
    expect(html).toContain('只填空槽');
    expect(html).toContain('预计真跑 <b>1234</b> 场');
  });

  it('结果区：逐槽粗筛 / 组合榜单 / 决赛排行 / 口径提示四段齐全，不出现 undefined / NaN', () => {
    const cfg = twoSlotCfg();
    const res = runSimExpectation(cfg, {
      candidateIds: TWO_CANDIDATES,
      coarseRuns: 3,
      finalRuns: 20,
      unitKeep: 2,
      coarseTop: 2,
    });
    const html = simResultHtml(res);
    expect(html).toContain('① 逐将粗筛');
    expect(html).toContain('② 组合粗筛榜单');
    expect(html).toContain('③ 决赛排行');
    expect(html).toContain('④ 口径与提示');
    expect(html).toContain('不还手');
    expect(html).toContain('3 场粗筛够不够');
    expect(html).toContain('每将 / 每战法拆解');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    // 不掺胜负：结果里不出现胜负派生指标（胜率在提示语里只作为「看 L4」的指引出现）
    expect(html).not.toContain('斩首');
    expect(html).not.toContain('平局');
    expect(html).not.toContain('兵力优势');
  });

  it('进度条：阶段文案 + 百分比宽度', () => {
    const html = simProgressHtml({ phase: 'combo', phaseDone: 30, phaseTotal: 120, battle: 500, label: '组合粗筛 3/90' });
    expect(html).toContain('组合粗筛 30 / 120');
    expect(html).toContain('width:25.0%');
    expect(html).toContain('累计 500 场');
  });
});

describe('页面（round-model.html）：模拟测评区接线', () => {
  /** 等页面 data-state 变成目标值（真跑几百场，给够时间） */
  async function waitState(el: HTMLElement, want: string, ms = 20000): Promise<string> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (el.dataset.state === want) return want;
      await new Promise((r) => setTimeout(r, 20));
    }
    return el.dataset.state ?? '';
  }

  it('挂载后就有「模拟测评」区与参数（粗筛 3 / 决赛 20，下限 20 / 木桩兵力 150000）', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountRoundModel(root);

    const sim = root.querySelector<HTMLElement>('#rm-sim');
    expect(sim, '应有模拟测评区').toBeTruthy();
    expect(sim!.dataset.state).toBe('idle');
    expect(root.querySelector<HTMLInputElement>('#rm-sim-coarse')!.value).toBe('3');
    const final = root.querySelector<HTMLInputElement>('#rm-sim-final')!;
    expect(final.value).toBe('20');
    expect(final.min).toBe(String(FINAL_RUNS_MIN));
    expect(root.querySelector<HTMLInputElement>('#rm-sim-troops')!.value).toBe('150000');
    expect(root.querySelector('#rm-sim-run'), '应有开始按钮').toBeTruthy();
    expect(root.textContent).toContain('只填空槽');
    expect(root.textContent).toContain('不还手的木桩');
  });

  it('点「开始模拟测评」→ 跑完出伤害期望排行（零空槽：3 + 20 场）', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountRoundModel(root);

    // 把 6 个战法槽都填上（零空槽 → 直接测评当前配置，跑 3 + 20 场），走面板自身的 change 事件改 cfg
    const ids = [SK.tujin, SK.lianzhan, SK.yuzhan, SK.xianqu, SK.shenbing, SK.dashang];
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
    const sim = root.querySelector<HTMLElement>('#rm-sim')!;
    expect(await waitState(sim, 'done')).toBe('done');

    const text = root.querySelector<HTMLElement>('#rm-sim-result')!.textContent ?? '';
    expect(text).toContain('决赛排行');
    expect(text).toContain('真跑');
    expect(text).toContain('23'); // 3 场粗筛 + 20 场决赛
    expect(text).not.toContain('undefined');
    expect(root.querySelector('#rm-sim-hint')!.textContent).toContain('结果对应当前配置');
  });
});
