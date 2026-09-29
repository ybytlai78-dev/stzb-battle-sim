/**
 * 战斗诊断（只读 / 因果归因）测试。
 *
 * 覆盖口径：
 *  1. 因果账本：反解公式 m = clamp(1+Σcaused+Σtaken−Σreduce, 0.1)、逐来源贡献、闭合自检、触底、无归因路径；
 *  2. 增益/减益覆盖率：采样点 = 单位回合行动开始，分母 = 该侧行动窗口数；
 *  3. 控制：被控回合数 / 占比 / 流失判定机会 + 事件佐证；
 *  4. 兵种克制：应交条数 vs 实交条数、克制损失（被克 30% 实际生效情况）；
 *  5. 技能顺序缺口：孙策【霸王渡江】早于【击势】→ 吃不到（有/无对照）；
 *  6. 主战法空转：释放 / 判定失败 / 空放 / 有效生效回合 / 空转率；
 *  7. 批量：同阵容共性问题 + 跨阵容差异因子；
 *  8. 只读：诊断前后战报逐字节不变；战斗主循环未引用诊断模块；空事件流不抛错。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { diagnoseBattle, diagnoseBatch, DIAGNOSIS_THRESHOLDS } from '../src/engine/diagnosis';
import { diagnosisToText, batchDiagnosisToText } from '../src/engine/diagnosisReport';
import { runBattle } from '../src/engine/combat';
import { actUnit, type CombatContext } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import type { BattleConfig, BattleEvent, BattleReport, General, Position, Skill, UnitState } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

// ─── 合成战报工具 ───

function dummy(id: string, over: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position: '前锋',
    attack: 100,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...over,
  };
}

function mkReport(
  events: BattleEvent[],
  my: General[],
  enemy: General[],
  over: Partial<BattleReport> = {}
): BattleReport {
  return {
    schemaVersion: '1.0',
    seed: 1,
    maxRounds: 8,
    result: 'draw',
    rounds: 3,
    myTeam: my,
    enemyTeam: enemy,
    finalMyTroops: my.map((g) => g.maxTroops),
    finalEnemyTroops: enemy.map((g) => g.maxTroops),
    finalMyWounded: my.map(() => 0),
    finalEnemyWounded: enemy.map(() => 0),
    finalMyDead: my.map(() => 0),
    finalEnemyDead: enemy.map(() => 0),
    events,
    stats: [],
    ...over,
  };
}

const BKD = (troopBase: number, base: number, main: number) => ({ troopBase, base, main });

function attackHit(sourceId: string, targetId: string, damage: number, bkd = BKD(50, 120, 240)): BattleEvent {
  return { type: 'attack_hit', sourceId, targetId, distance: 1, damage, breakdown: bkd };
}

/** 一个「行动窗口」：unit_act_start → … → unit_act_end */
function window(unitId: string, name: string, round: number, inner: BattleEvent[], position: Position = '前锋'): BattleEvent[] {
  return [
    { type: 'round_start', round },
    { type: 'unit_act_start', unitId, name, position, phase: 'normal_attack' },
    ...inner,
    { type: 'unit_act_end', unitId },
  ];
}

// ─── 1. 因果账本 ───

describe('因果账本：由伤害事件 modifiers 反解基线与逐来源贡献', () => {
  it('增伤 50% + 减伤 30%：基线 = 可作用分量 / 1.2，逐来源贡献之和 = 实际 − 基线', () => {
    const my = dummy('a', { name: '甲' });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events = window('a', '甲', 1, [
      {
        type: 'attack_hit',
        sourceId: 'a',
        targetId: 'e',
        distance: 2,
        // breakdown 是**结算后**的分量（base/main 已乘 m=1.2）：120 + 240 = 360；兵力基础不参与增减伤
        damage: 410,
        breakdown: BKD(50, 120, 240),
        modifiers: {
          caused: [{ unitId: 'a', skillId: 'dashang', skillName: '大赏三军', rate: 0.5, direction: 'caused' }],
          taken: [],
          reduce: [{ unitId: 'e', skillId: 'bishi', skillName: '避其锋芒', rate: 0.3, direction: 'reduce' }],
        },
      },
    ]);
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const l = d.my.ledger;
    // usable = 360（base+main），m = 1 + 0.5 − 0.3 = 1.2 → baseline = 300
    expect(l.attributedHits).toBe(1);
    expect(Math.round(l.baseline)).toBe(300);
    expect(Math.round(l.actual)).toBe(410);
    expect(l.troopBase).toBe(50);
    expect(l.clampedHits).toBe(0);
    // 逐来源：+150（大赏 300×0.5）、−90（避其 300×0.3）
    const dashang = l.entries.find((e) => e.skillId === 'dashang')!;
    const bishi = l.entries.find((e) => e.skillId === 'bishi')!;
    expect(dashang.amount).toBe(150);
    expect(dashang.direction).toBe('caused');
    expect(bishi.amount).toBe(-90);
    expect(bishi.direction).toBe('reduce');
    // 闭合：Σ贡献 = 可作用分量 − 基线 = 60
    expect(l.entries.reduce((s, e) => s + e.amount, 0)).toBe(60);
    expect(Math.abs(l.closedCheck)).toBeLessThan(0.5);
    expect(Math.round(l.byKind.boost)).toBe(150);
    expect(Math.round(l.byKind.reduce)).toBe(-90);
  });

  it('触底（减伤 120% → 净额 ≤ −90%）：按 10% 结算，贡献按比例缩放并标记 clamped', () => {
    const my = dummy('a', { name: '甲' });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events = window('a', '甲', 1, [
      {
        type: 'attack_hit',
        sourceId: 'a',
        targetId: 'e',
        distance: 2,
        damage: 80, // troopBase 50 + round(300 × 0.1) = 80
        breakdown: BKD(50, 10, 20),
        modifiers: {
          caused: [],
          taken: [],
          reduce: [{ unitId: 'e', skillId: 'yuannen', skillName: '辕门射戟', rate: 1.2, direction: 'reduce' }],
        },
      },
    ]);
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const l = d.my.ledger;
    expect(l.clampedHits).toBe(1);
    expect(Math.round(l.baseline)).toBe(300); // 30 / 0.1
    // 实际 − 基线 = 30 − 300 = −270，逐来源之和必须等于它（比例缩放后）
    expect(Math.abs(l.entries.reduce((s, e) => s + e.amount, 0) - (30 - 300))).toBeLessThan(1);
    expect(Math.abs(l.closedCheck)).toBeLessThan(0.5);
  });

  it('无归因路径（一类指挥预存伤害：无 modifiers）计入 unattributed，不进账本', () => {
    const my = dummy('a', { name: '甲' });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events = window('a', '甲', 1, [
      { type: 'damage', sourceId: 'a', targetId: 'e', skillId: 'baijiu', skillName: '白衣渡江', damageType: 'strategy', damage: 500, breakdown: BKD(0, 200, 300), delayedEffect: true },
    ]);
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    expect(d.my.ledger.attributedHits).toBe(0);
    expect(d.my.ledger.unattributed).toBe(500);
    expect(d.my.ledger.entries.length).toBe(0);
    expect(d.notes.some((n) => n.includes('无增减伤归因'))).toBe(true);
  });
});

// ─── 2. 覆盖率 ───

describe('增益/减益覆盖率：采样点 = 单位回合行动开始，分母 = 该侧行动窗口数', () => {
  it('第 1 回合行动中才挂上、第 2/3 回合生效 → 覆盖 2/3 = 66.7%', () => {
    const my = dummy('a', { name: '甲' });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const act = (round: number, inner: BattleEvent[]): BattleEvent[] => [
      { type: 'round_start', round },
      { type: 'unit_act_start', unitId: 'a', name: '甲', position: '前锋', phase: 'normal_attack' },
      ...inner,
      { type: 'unit_act_end', unitId: 'a' },
    ];
    const events: BattleEvent[] = [
      // 第 1 回合：增益在**行动开始之后**才施加 → 本次行动开始时尚未生效（采样点语义）
      ...act(1, [
        { type: 'skill_trigger', unitId: 'a', skillId: 'buff_skill', skillName: '增益战法', success: true, rate: 100, baseRate: 100, morale: 100 },
        { type: 'skill_cast', unitId: 'a', skillId: 'buff_skill', skillName: '增益战法' },
        { type: 'status_inflicted', unitId: 'a', statusType: 'damage_boost', detail: '造成的伤害提高 30% 持续 2 回合' },
        attackHit('a', 'e', 100),
      ]),
      // 第 2、3 回合：行动开始时已生效
      ...act(2, [attackHit('a', 'e', 100)]),
      ...act(3, [attackHit('a', 'e', 100)]),
      { type: 'status_expired', unitId: 'a', statusType: 'damage_boost' },
    ];
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const boost = d.my.effects.find((e) => e.statusType === 'damage_boost')!;
    expect(boost.appliedCount).toBe(1);
    // 分母 = 我方 3 个行动窗口；采样点在第 2、3 回合行动开始时生效 → 2/3
    expect(boost.eligibleUnitRounds).toBe(3);
    expect(boost.coveredUnitRounds).toBe(2);
    expect(boost.coveragePct).toBe(66.7);
    expect(boost.sources[0].skillId).toBe('buff_skill');
    expect(boost.kind).toBe('增益');
  });
});

// ─── 3. 控制 ───

describe('控制：被控回合数 / 被控占比 / 流失判定机会', () => {
  it('混乱覆盖第 1、2 回合 → 被控 2/3 回合（66.7%），流失主动判定机会 2 次', () => {
    const my = dummy('a', { name: '甲', mainSkillId: 'main_active', mainSkillName: '主战法', activeSkillIds: ['main_active'] });
    const enemy = dummy('m', { name: '控', position: '中军' });
    const events: BattleEvent[] = [
      { type: 'round_start', round: 1 },
      { type: 'skill_cast', unitId: 'm', skillId: 'confuse_skill', skillName: '混乱战法' },
      { type: 'status_inflicted', unitId: 'a', statusType: 'confusion', detail: '混乱 持续 2 回合' },
      { type: 'unit_act_start', unitId: 'a', name: '甲', position: '前锋', phase: 'normal_attack' },
      { type: 'no_attack_target', unitId: 'a', name: '甲', reason: '混乱：无法行动' },
      { type: 'unit_act_end', unitId: 'a' },
      { type: 'round_start', round: 2 },
      { type: 'unit_act_start', unitId: 'a', name: '甲', position: '前锋', phase: 'normal_attack' },
      { type: 'no_attack_target', unitId: 'a', name: '甲', reason: '混乱：无法行动' },
      { type: 'unit_act_end', unitId: 'a' },
      { type: 'status_expired', unitId: 'a', statusType: 'confusion' },
      { type: 'round_start', round: 3 },
      { type: 'unit_act_start', unitId: 'a', name: '甲', position: '前锋', phase: 'active_skill' },
      { type: 'skill_trigger', unitId: 'a', skillId: 'main_active', skillName: '主战法', success: false, rate: 40, baseRate: 40, morale: 100 },
      { type: 'unit_act_end', unitId: 'a' },
    ];
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const row = d.my.control.taken.find((x) => x.unitId === 'a')!;
    expect(row.controlledRounds).toBe(2);
    expect(row.actedRounds).toBe(3);
    expect(row.controlledPct).toBe(66.7);
    expect(row.skippedActiveAttempts).toBe(2);
    expect(row.byType.confusion).toBe(2);
    expect(d.my.control.takenPct).toBe(66.7);
    expect(d.my.control.evidence.some((e) => e.reason.includes('混乱'))).toBe(true);
    // 对手视角：混乱覆盖我方第 1、2 回合的行动 → 施加控制覆盖 2/3 个我方行动窗口
    expect(d.enemy.control.dealtRounds).toBe(2);
    expect(d.enemy.control.dealtPct).toBe(66.7);
    expect(d.enemy.control.unattributedDealtRounds).toBe(0);
    // 主战法空转：被控 2 回合不计入空转，第 3 回合判定失败计入
    const main = d.my.mainSkills[0];
    expect(main.controlledSkips).toBe(2);
    expect(main.idleRounds).toBe(1);
  });
});

// ─── 4. 兵种克制 ───

describe('兵种克制：双方克制关系与实际生效情况', () => {
  it('步兵打骑兵（被克 −30%）：应交 = 实交，账本出现「兵种克制」负贡献', () => {
    const me = dummy('inf', { name: '步兵甲', troopType: 'infantry' });
    const foe = dummy('cav', { name: '骑兵乙', troopType: 'cavalry', position: '中军' });
    const report = runBattle({
      myTeam: [me],
      enemyTeam: [foe],
      seed: 7,
      maxRounds: 8,
    } satisfies BattleConfig);
    const d = diagnoseBattle(report);
    expect(d.my.counters.expectedHits).toBeGreaterThan(0);
    expect(d.my.counters.confirmedHits).toBe(d.my.counters.expectedHits);
    expect(d.my.counters.compliancePct).toBe(100);
    expect(d.my.counters.counteredHits).toBeGreaterThan(0);
    expect(d.my.counters.counteredLoss).toBeGreaterThan(0);
    const counterEntry = d.my.ledger.entries.find((e) => e.isCounter)!;
    expect(counterEntry).toBeTruthy();
    expect(counterEntry.amount).toBeLessThan(0);
    expect(counterEntry.skillName).toBe('兵种克制');
    // 反向：骑兵打步兵不惩罚 → 敌方对我们没有克制损失
    expect(d.enemy.counters.counteredHits).toBe(0);
    // 我方承受的普攻伤害带克制归因（30% 实际生效在对手身上？不——我方被克只影响我打出去）
    expect(d.my.counters.pairs[0].expectedReduce).toBeCloseTo(0.3, 6);
  });
});

// ─── 5. 技能顺序缺口 ───

describe('技能顺序缺口：孙策【霸王渡江】早于槽 2【击势】→ 吃不到增伤', () => {
  function setupOrder(slotOrder: 'main-first' | 'jishi-first'): BattleReport {
    const passives = slotOrder === 'main-first' ? ['bawang_dujiang', 'jishi'] : ['jishi', 'bawang_dujiang'];
    const g = { ...withSkills(level40(HERO_REGISTRY['h450']), { passiveSkillIds: passives }), position: '前锋' as Position };
    const me: UnitState = {
      general: g, side: 'my', troops: g.maxTroops, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [],
    };
    const foes: UnitState[] = ['前锋', '中军', '大营'].map((p, i) => {
      const f = dummy(`e${i}`, { name: `木桩${i}`, position: p as Position, maxTroops: 30000, attack: 20 });
      return { general: f, side: 'enemy' as const, troops: f.maxTroops, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] };
    });
    const ctx: CombatContext = {
      rng: new Rng(3),
      myTeam: [me],
      enemyTeam: foes,
      events: [],
      skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
      lockedCommands: [],
      stackBuffs: [],
      currentRound: 1,
    };
    // 强制必中，保证每回合都能观察到顺序
    const bawang = structuredClone(SKILL_REGISTRY['bawang_dujiang']) as Skill;
    if (bawang.type === 'passive' && bawang.roundStartRepeat) {
      const group = bawang.roundStartRepeat.output[0];
      if (group.kind === 'chance_group') group.chance = 1;
    }
    ctx.skills.set('bawang_dujiang', bawang);
    const jishi = structuredClone(SKILL_REGISTRY['jishi']) as Skill;
    if (jishi.type === 'passive') for (const out of jishi.output) if (out.kind === 'inflict_status') out.chance = 1;
    ctx.skills.set('jishi', jishi);

    for (let round = 1; round <= 3; round++) {
      ctx.currentRound = round;
      ctx.events.push({ type: 'round_start', round });
      actUnit(ctx, me);
    }
    return mkReport(ctx.events, [g], foes.map((f) => f.general), { rounds: 3 });
  }

  it('主战法在槽 1：产出顺序缺口，来源 = 击势，估算少打 > 0，scope = self', () => {
    const d = diagnoseBattle(setupOrder('main-first'));
    expect(d.my.orderGaps.length).toBeGreaterThan(0);
    const gap = d.my.orderGaps[0];
    expect(gap.buffSkillName).toBe('击势');
    expect(gap.skillName).toBe('霸王渡江');
    expect(gap.scope).toBe('self');
    expect(gap.direction).toBe('caused');
    expect(gap.estimatedMissed).toBeGreaterThan(0);
    expect(gap.rate).toBeCloseTo(0.5, 6);
    // 账本实证：同一行动内的普攻吃到了击势（不再有缺口），说明击势本身生效
    const ledgerJishi = d.my.ledger.entries.find((e) => e.skillId === 'jishi');
    expect(ledgerJishi).toBeTruthy();
    expect(ledgerJishi!.amount).toBeGreaterThan(0);
    // 病灶清单里能看到顺序缺口
    expect(d.issues.some((i) => i.kind === 'skill_order_gap')).toBe(true);
  });

  it('对照：击势排到槽 1 时，霸王渡江吃得到增伤 → 无顺序缺口', () => {
    const d = diagnoseBattle(setupOrder('jishi-first'));
    expect(d.my.orderGaps.length).toBe(0);
    expect(d.issues.some((i) => i.kind === 'skill_order_gap')).toBe(false);
  });

  it('账本只记「实际吃到」的增伤：独立复算 = Σ(带击势归因的伤害 × 基线 × 50%)，缺口估算不混入', () => {
    const report = setupOrder('main-first');
    const d = diagnoseBattle(report);
    // 独立复算（不走诊断代码）：只统计 modifiers 里真的带击势的那些伤害
    const sumRate = (ev: BattleEvent): number => {
      const mods = (ev as { modifiers?: { caused: { rate: number }[]; taken: { rate: number }[]; reduce: { rate: number }[] } }).modifiers;
      if (!mods) return 0;
      return mods.caused.reduce((a, x) => a + x.rate, 0) + mods.taken.reduce((a, x) => a + x.rate, 0) - mods.reduce.reduce((a, x) => a + x.rate, 0);
    };
    let expected = 0;
    for (const ev of report.events) {
      if (ev.type !== 'attack_hit' && ev.type !== 'damage' && ev.type !== 'split_damage') continue;
      if (!ev.modifiers?.caused.some((m) => m.skillId === 'jishi')) continue;
      const usable = ev.breakdown.base + ev.breakdown.main;
      const m = Math.max(0.1, 1 + sumRate(ev));
      expected += (usable / m) * 0.5;
    }
    const jishi = d.my.ledger.entries.find((e) => e.skillId === 'jishi')!;
    expect(expected).toBeGreaterThan(0);
    expect(jishi.amount).toBeCloseTo(expected, -1); // 允许四舍五入到十位
    // 缺口估算与账本收益互不重复：缺口 >= 0 且账本收益只来自实际带归因的伤害
    expect(d.my.orderGaps.every((g) => g.estimatedMissed! >= 0)).toBe(true);
  });
});

// ─── 6. 主战法空转 ───

describe('主战法空转：释放 / 判定失败 / 空放 / 有效生效回合', () => {
  it('判定失败 2 回合 + 空放 1 回合 → 空转 3/3，证据可读', () => {
    const my = dummy('a', { name: '甲', mainSkillId: 'main_x', mainSkillName: '空转主战法', activeSkillIds: ['main_x'] });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const mk = (round: number, inner: BattleEvent[]): BattleEvent[] => [
      { type: 'round_start', round },
      { type: 'unit_act_start', unitId: 'a', name: '甲', position: '前锋', phase: 'active_skill' },
      ...inner,
      { type: 'unit_act_end', unitId: 'a' },
    ];
    const events: BattleEvent[] = [
      ...mk(1, [
        { type: 'skill_trigger', unitId: 'a', skillId: 'main_x', skillName: '空转主战法', success: false, rate: 35, baseRate: 35, morale: 100 },
      ]),
      ...mk(2, [
        { type: 'skill_trigger', unitId: 'a', skillId: 'main_x', skillName: '空转主战法', success: false, rate: 35, baseRate: 35, morale: 100 },
      ]),
      ...mk(3, [
        { type: 'skill_trigger', unitId: 'a', skillId: 'main_x', skillName: '空转主战法', success: true, rate: 35, baseRate: 35, morale: 100 },
        { type: 'skill_cast', unitId: 'a', skillId: 'main_x', skillName: '空转主战法' },
        // 释放了但没有任何效果事件（被规避/无有效目标）
        { type: 'evasion_blocked', unitId: 'e', sourceId: 'a', remainingStacks: 0 },
      ]),
    ];
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const m = d.my.mainSkills[0];
    expect(m.triggers).toBe(3);
    expect(m.triggerFailures).toBe(2);
    expect(m.casts).toBe(1);
    expect(m.noEffectCasts).toBe(1);
    expect(m.effectiveRounds).toBe(0);
    expect(m.idleRounds).toBe(3);
    expect(m.idleRatePct).toBe(100);
    expect(m.avgDamagePerEffectiveRound).toBe(0);
    expect(m.evidence.some((e) => e.kind === 'trigger_failed')).toBe(true);
    expect(m.evidence.some((e) => e.kind === 'cast_no_effect')).toBe(true);
    expect(d.issues.some((i) => i.kind === 'main_skill_idle')).toBe(true);
    expect(d.verdict.findings.some((f) => f.kind === 'main_skill_idle')).toBe(true);
  });

  it('一类指挥（prep）不参与每回合空转口径', () => {
    const my = dummy('a', { name: '甲', mainSkillId: 'baiyi_dujiang', mainSkillName: '白衣渡江', commandSkillIds: ['baiyi_dujiang'] });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events: BattleEvent[] = [
      { type: 'skill_cast', unitId: 'a', skillId: 'baiyi_dujiang', skillName: '白衣渡江' },
      ...window('a', '甲', 1, [attackHit('a', 'e', 100)]),
      ...window('a', '甲', 2, [attackHit('a', 'e', 100)]),
    ];
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const m = d.my.mainSkills[0];
    expect(m.oneTime).toBe(true);
    expect(m.idleRounds).toBe(0);
    expect(m.idleRatePct).toBe(0);
  });

  it('真实战报：有效生效 + 被控跳过 + 准备中 + 空转 = 行动回合（口径自洽）', () => {
    const report = runBattle({
      myTeam: [
        dummy('p1', { name: '甲', mainSkillId: 'jishi', mainSkillName: '击势', passiveSkillIds: ['jishi'] }),
        dummy('p2', { name: '乙', position: '中军', mainSkillId: 'lianzhan', mainSkillName: '连战', activeSkillIds: ['lianzhan'] }),
      ],
      enemyTeam: [dummy('e1', { name: '丙', position: '中军', maxTroops: 20000 })],
      seed: 11,
      maxRounds: 8,
    } satisfies BattleConfig);
    const d = diagnoseBattle(report);
    expect(d.my.mainSkills.length).toBe(2);
    for (const m of d.my.mainSkills) {
      if (m.oneTime) continue;
      expect(m.effectiveRounds + m.controlledSkips + m.preparingRounds + m.idleRounds).toBe(m.actedRounds);
    }
  });
});

// ─── 7. 归因结论 ───

describe('归因结论：回答「伤害差异到底是哪个」', () => {
  it('被克制为主因时 primary = counter，且结论串里带数值与证据', () => {
    const me = dummy('inf', { name: '步兵甲', troopType: 'infantry', attack: 200 });
    const foe = dummy('cav', { name: '骑兵乙', troopType: 'cavalry', position: '中军', attack: 5, defense: 300 });
    const report = runBattle({ myTeam: [me], enemyTeam: [foe], seed: 3, maxRounds: 8 } satisfies BattleConfig);
    const d = diagnoseBattle(report);
    expect(d.verdict.myDamage).toBe(d.my.totalDamage);
    expect(d.verdict.findings.length).toBe(4);
    expect(d.verdict.findings.map((f) => f.kind)).toContain('counter');
    expect(d.verdict.primary).toBe('counter');
    expect(d.verdict.summary).toContain('主因');
    expect(d.verdict.findings.find((f) => f.kind === 'counter')!.confidence).toBe('confirmed');
  });
});

// ─── 8. 批量 ───

describe('批量诊断：同阵容共性问题 + 跨阵容差异因子', () => {
  /** 造一场「主战法全空转」的战报（用于共性问题） */
  function idleReport(unitId: string, seed: number): BattleReport {
    const my = dummy(unitId, { name: `空转${unitId}`, mainSkillId: 'main_x', mainSkillName: '空转主战法', activeSkillIds: ['main_x'] });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events: BattleEvent[] = [1, 2, 3].flatMap((round) => [
      { type: 'round_start' as const, round },
      { type: 'unit_act_start' as const, unitId, name: my.name, position: '前锋' as Position, phase: 'active_skill' },
      { type: 'skill_trigger' as const, unitId, skillId: 'main_x', skillName: '空转主战法', success: false, rate: 35, baseRate: 35, morale: 100 },
      { type: 'unit_act_end' as const, unitId },
    ]);
    return mkReport(events, [my], [enemy], { seed, rounds: 3, result: 'loss' });
  }

  it('同阵容 3 场都空转 → 共性问题上报（100%）', () => {
    const b = diagnoseBatch([
      { report: idleReport('a', 1) },
      { report: idleReport('a', 2) },
      { report: idleReport('a', 3) },
    ]);
    expect(b.groups.length).toBe(1);
    expect(b.groups[0].reports).toBe(3);
    const common = b.common[0];
    expect(common.issues.some((i) => i.kind === 'main_skill_idle')).toBe(true);
    const issue = common.issues.find((i) => i.kind === 'main_skill_idle')!;
    expect(issue.sharePct).toBe(100);
    expect(issue.reports).toBe(3);
    expect(b.summary).toContain('共性问题');
  });

  it('样本不足（< batchMinReports）不做共性问题统计', () => {
    const b = diagnoseBatch([{ report: idleReport('a', 1) }, { report: idleReport('a', 2) }]);
    expect(DIAGNOSIS_THRESHOLDS.batchMinReports).toBe(3);
    expect(b.common[0].issues.length).toBe(0);
    expect(b.common[0].notes.join('')).toContain('样本不足');
  });

  it('两个不同阵容 → 差异因子对照，最高/最低组按每回合伤害排序', () => {
    const b = diagnoseBatch([
      { report: mkBatchReport('s', '强', 5000, 1) },
      { report: mkBatchReport('s', '强', 4200, 2) },
      { report: mkBatchReport('w', '弱', 100, 3) },
      { report: mkBatchReport('w', '弱', 120, 4) },
    ]);
    expect(b.groups.length).toBe(2);
    expect(b.comparison).toBeTruthy();
    expect(b.comparison!.best.label).toContain('强');
    expect(b.comparison!.worst.label).toContain('弱');
    expect(b.comparison!.factors.length).toBeGreaterThan(0);
    expect(b.comparison!.summary).toContain('相关对照');
    expect(b.groups[0].metrics.damagePerRound).toBeGreaterThanOrEqual(b.groups[1].metrics.damagePerRound);
    const strong = b.groups.find((g) => g.label.includes('强'))!;
    const weak = b.groups.find((g) => g.label.includes('弱'))!;
    expect(weak.metrics.damagePerRound).toBeLessThan(strong.metrics.damagePerRound);
  });

  function mkBatchReport(id: string, name: string, damage: number, seed: number): BattleReport {
    const my = dummy(id, { name });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events = window(id, name, 1, [attackHit(id, 'e', damage)]);
    return mkReport(events, [my], [enemy], { seed });
  }
});

// ─── 9. 只读 / 边界 / 渲染 ───

describe('只读、守卫与边界', () => {
  it('诊断不改动输入战报（逐字节一致）', () => {
    const my = dummy('a', { name: '甲' });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const events = window('a', '甲', 1, [attackHit('a', 'e', 100)]);
    const report = mkReport(events, [my], [enemy]);
    const before = JSON.stringify(report);
    diagnoseBattle(report);
    diagnoseBatch([{ report }]);
    expect(JSON.stringify(report)).toBe(before);
  });

  it('战斗主循环（combat.ts / action.ts）不引用诊断模块 → 线上零开销', () => {
    const root = path.resolve(__dirname, '..');
    for (const f of ['src/engine/combat.ts', 'src/engine/action.ts', 'src/engine/stats.ts']) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      expect(text.includes('diagnosis')).toBe(false);
    }
  });

  it('空事件流不抛错，各项指标为 0', () => {
    const my = dummy('a', { name: '甲', mainSkillId: 'main_x', mainSkillName: '空' });
    const enemy = dummy('e', { name: '乙', position: '中军' });
    const d = diagnoseBattle(mkReport([], [my], [enemy]));
    expect(d.my.totalDamage).toBe(0);
    expect(d.my.ledger.entries.length).toBe(0);
    expect(d.my.effects.length).toBe(0);
    expect(d.my.control.actedRounds).toBe(0);
    expect(d.my.mainSkills[0].idleRounds).toBe(0);
    expect(d.verdict.primary).toBe('none');
    expect(diagnosisToText(d)).toContain('战斗诊断');
  });

  it('diagnoseBatch 空输入报错；单场文本渲染包含全部小节', () => {
    expect(() => diagnoseBatch([])).toThrow();
    const my = dummy('a', { name: '甲', mainSkillId: 'main_x', mainSkillName: '空转主战法', activeSkillIds: ['main_x'] });
    const enemy = dummy('e', { name: '乙', position: '中军', troopType: 'cavalry' });
    const events = window('a', '甲', 1, [
      { type: 'skill_trigger', unitId: 'a', skillId: 'main_x', skillName: '空转主战法', success: false, rate: 35, baseRate: 35, morale: 100 },
      attackHit('a', 'e', 300),
    ]);
    const d = diagnoseBattle(mkReport(events, [my], [enemy]));
    const text = diagnosisToText(d);
    for (const kw of ['归因结论', '病灶清单', '因果账本', '效果覆盖', '控制', '兵种克制', '主战法空转证据', '技能顺序缺口', '口径与提示', '账本闭合自检']) {
      expect(text).toContain(kw);
    }
    const batchText = batchDiagnosisToText(diagnoseBatch([{ report: mkReport(events, [my], [enemy]) }]));
    expect(batchText).toContain('批量战斗诊断');
  });
});
