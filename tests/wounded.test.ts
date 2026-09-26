/**
 * 伤兵机制测试（v0.15 修正，用户 2026-09-22 口径）
 *  1. 受击损失按**固定**直接死亡率拆分：每 100 点伤害 → 5 直接死亡（永久损失，不可恢复）+ 95 伤兵（入池，可恢复）
 *     死亡率固定不随回合变化（第 2 回合受伤 100 仍是死 5 伤 95）
 *  2. 每回合开始时，累计伤兵池按**固定** 14% 阵亡；池跨回合累计、随恢复减少
 *     例：第 1 回合受伤 1000 → 死 50 伤 950；第 2 回合开始 → 950×0.86 = 817（再阵亡 133）
 *  3. 恢复（heal/持续急救）只能从伤兵池扣除（有伤兵才能恢复，恢复量从池中减）；治疗不冲减死亡
 *  4. runBattle：round_end 事件输出每回合兵力/伤兵/死亡数组，恒等式 troops+wounded+dead = maxTroops
 *  5. 配置自定义（deathRate/woundedDecayRate）与关闭（0/0）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { applyDamage, decayWoundedPool, recoverTroops, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function makeUnit(id: string, maxTroops = 10000): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: '前锋',
      attack: 50,
      defense: 100,
      strategy: 80,
      speed: 50,
      attackRange: 2,
      maxTroops,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(wounded: { deathRate: number; woundedDecayRate: number } | null): CombatContext {
  const ctx: CombatContext = {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  if (wounded) ctx.woundedMortality = wounded;
  return ctx;
}

describe('伤兵机制（单元：受击损失按固定直接死亡率拆分）', () => {
  it('每 100 伤害 → 直接死 5、伤 95（用户示例：1000 伤害 → 死 50 伤 950）', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1');
    applyDamage(ctx, u, 1000);
    expect(u.troops).toBe(9000);
    expect(u.totalDead).toBe(50); // 死亡 = round(受伤量 × 5%)
    expect(u.wounded).toBe(950); // 伤兵 = 受伤量 - 死亡
  });

  it('直接死亡率固定，不随回合变化：第 2/3 回合受伤 100 仍是死 5 伤 95', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1');
    ctx.currentRound = 2;
    applyDamage(ctx, u, 100);
    expect(u.totalDead).toBe(5);
    expect(u.wounded).toBe(95);
    ctx.currentRound = 3;
    applyDamage(ctx, u, 100);
    expect(u.totalDead).toBe(10); // 5 + 5（不再 +14%/回合）
    expect(u.wounded).toBe(190); // 95 + 95
  });

  it('回合开始池阵亡 14%：950 → 817（用户示例：950×(1−0.14)）', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1');
    ctx.myTeam.push(u);
    applyDamage(ctx, u, 1000); // 死 50 伤 950
    expect(u.wounded).toBe(950);

    expect(decayWoundedPool(ctx)).toBe(133); // 第 2 回合开始：round(950 × 14%) = 133
    expect(u.wounded).toBe(817); // 950 × 0.86
    expect(u.totalDead).toBe(183); // 50 + 133
    expect(u.troops).toBe(9000); // 池阵亡只转死亡，不改变当前兵力
  });

  it('池阵亡后本回合新伤害继续入池：817 + 950 = 1767 → 再一回合 1520', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1');
    ctx.myTeam.push(u);
    applyDamage(ctx, u, 1000); // 第 1 回合：死 50 伤 950
    decayWoundedPool(ctx); // 第 2 回合开始：阵亡 133 → 池 817、累计死 183
    applyDamage(ctx, u, 1000); // 第 2 回合：死 50 伤 950 → 池 1767、累计死 233
    expect(u.wounded).toBe(1767);
    expect(decayWoundedPool(ctx)).toBe(247); // 第 3 回合开始：round(1767 × 14%)
    expect(u.wounded).toBe(1520); // 1767 − 247
    expect(u.totalDead).toBe(480); // 183 + 50 + 247
    expect(u.troops + u.wounded + u.totalDead).toBe(10000); // 恒等式
  });

  it('池阵亡按 Math.round 取整（小池示例：7 → 阵亡 1）', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1');
    u.wounded = 7;
    ctx.myTeam.push(u);
    expect(decayWoundedPool(ctx)).toBe(1); // round(0.98)
    expect(u.wounded).toBe(6);
    expect(u.totalDead).toBe(1);
  });

  it('DoT/溢出伤害同样结算：cap 后伤害按固定 5% 拆分（调用方先 cap，applyDamage 收到即为实际扣减量）', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1', 100); // 兵力 100
    applyDamage(ctx, u, 100); // cap 后实际扣减 100（溢出部分不结算）
    expect(u.troops).toBe(0);
    expect(u.totalDead).toBe(5); // 100 × 5%
    expect(u.wounded).toBe(95);
  });

  it('未配置机制（直接构造 ctx）：无死亡/伤兵入池，decayWoundedPool 也是 no-op', () => {
    const ctx = makeCtx(null);
    const u = makeUnit('u1');
    ctx.myTeam.push(u);
    applyDamage(ctx, u, 1000);
    expect(u.totalDead).toBe(0);
    expect(u.wounded).toBe(0);
    u.wounded = 500;
    expect(decayWoundedPool(ctx)).toBe(0);
    expect(u.wounded).toBe(500);
  });
});

describe('伤兵机制（单元：有伤兵才能恢复，恢复量从池中减）', () => {
  it('恢复量 = min(请求量, 伤兵池, 兵力缺口)；死亡兵力不可恢复', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1', 10000);
    applyDamage(ctx, u, 1000); // 死 50 伤 950，兵力 9000
    expect(u.totalDead).toBe(50);
    expect(u.wounded).toBe(950);

    expect(recoverTroops(ctx, u, 600)).toBe(600); // 池充足
    expect(u.troops).toBe(9600);
    expect(u.wounded).toBe(350);
    expect(u.totalDead).toBe(50); // 死亡不因治疗减少

    expect(recoverTroops(ctx, u, 9999)).toBe(350); // 池耗尽：只恢复 350
    expect(u.troops).toBe(9950);
    expect(u.wounded).toBe(0);
    expect(u.totalDead).toBe(50); // 死亡 50 永久损失，兵力最多回到 9950
    expect(u.troops).toBe(u.general.maxTroops - u.totalDead);

    // 有伤兵才能恢复：池为 0 时再请求恢复 → 0
    expect(recoverTroops(ctx, u, 100)).toBe(0);
    expect(u.troops).toBe(9950);
  });

  it('死亡按受伤量结算，治疗不冲减死亡（先受伤后治疗示例）', () => {
    const ctx = makeCtx({ deathRate: 5, woundedDecayRate: 14 });
    const u = makeUnit('u1');
    applyDamage(ctx, u, 100); // 死 5 伤 95
    recoverTroops(ctx, u, 60); // 治疗 60 → 只消耗伤兵池
    expect(u.totalDead).toBe(5); // 死亡仍为 5
    expect(u.wounded).toBe(35);
    expect(u.troops).toBe(9960);
  });

  it('未配置机制（直接构造 ctx）：无死亡/伤兵入池，恢复不受池限制', () => {
    const ctx = makeCtx(null);
    const u = makeUnit('u1');
    applyDamage(ctx, u, 1000);
    expect(u.totalDead).toBe(0);
    expect(u.wounded).toBe(0);
    expect(recoverTroops(ctx, u, 600)).toBe(600); // 不受池限制（兼容旧行为）
    expect(u.troops).toBe(9600);
  });
});

function dummy(id: string, position: Position, troops = 10000): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

type RoundEndEvent = Extract<BattleEvent, { type: 'round_end' }>;

/** 恒等式断言：每回合每单位 troops + 伤兵 + 死亡 = maxTroops（损失只在三者间流转） */
function expectConservation(report: ReturnType<typeof runBattle>) {
  const teams = [
    { units: report.myTeam, prefix: 'my' as const },
    { units: report.enemyTeam, prefix: 'enemy' as const },
  ];
  for (const ev of report.events.filter((e): e is RoundEndEvent => e.type === 'round_end')) {
    for (const { units, prefix } of teams) {
      const wounded = prefix === 'my' ? ev.myWounded : ev.enemyWounded;
      const dead = prefix === 'my' ? ev.myDead : ev.enemyDead;
      const troops = prefix === 'my' ? ev.myTroops : ev.enemyTroops;
      units.forEach((g, i) => {
        expect(troops[i] + wounded[i] + dead[i]).toBe(g.maxTroops);
      });
    }
  }
  // final 字段与最后一个 round_end 一致
  const last = report.events.filter((e): e is RoundEndEvent => e.type === 'round_end').pop();
  if (last) {
    expect(report.finalMyTroops).toEqual(last.myTroops);
    expect(report.finalMyWounded).toEqual(last.myWounded);
    expect(report.finalMyDead).toEqual(last.myDead);
    expect(report.finalEnemyWounded).toEqual(last.enemyWounded);
    expect(report.finalEnemyDead).toEqual(last.enemyDead);
  }
}

describe('伤兵机制（runBattle 集成）', () => {
  const roundEnd = (report: ReturnType<typeof runBattle>, round: number) =>
    report.events.find((e): e is RoundEndEvent => e.type === 'round_end' && e.round === round);

  it('默认启用（固定 5% 直接死亡 / 回合开始池阵亡 14%）：round_end 输出每回合伤兵/死亡数组，恒等式成立', () => {
    const report = runBattle({
      seed: 11,
      maxRounds: 8,
      myTeam: [dummy('a1', '前锋'), dummy('a2', '中军'), dummy('a3', '大营')],
      enemyTeam: [dummy('b1', '前锋'), dummy('b2', '中军'), dummy('b3', '大营')],
    });
    expectConservation(report);
    const last = report.events.filter((e): e is RoundEndEvent => e.type === 'round_end').pop()!;
    expect(last.myDead.some((d) => d > 0)).toBe(true); // 机制生效：有永久死亡
    expect(last.myWounded.some((w) => w > 0)).toBe(true);
  });

  it('池阵亡在回合开始结算：第 2 回合死亡 − 直接 5% − round(第 1 回合池×14%) ≈ 0', () => {
    const report = runBattle({
      seed: 11,
      maxRounds: 8,
      myTeam: [dummy('a1', '前锋'), dummy('a2', '中军'), dummy('a3', '大营')],
      enemyTeam: [dummy('b1', '前锋'), dummy('b2', '中军'), dummy('b3', '大营')],
    });
    const r1 = roundEnd(report, 1);
    const r2 = roundEnd(report, 2);
    expect(r1 && r2).toBeTruthy(); // 该对局至少打到第 2 回合
    report.myTeam.forEach((g, i) => {
      const loss1 = g.maxTroops - r1!.myTroops[i];
      const loss2 = r1!.myTroops[i] - r2!.myTroops[i];
      // ① 受击即时死亡：固定 5% 左右（每次受击各自取整 → 容差 ±2）
      expect(Math.abs(r1!.myDead[i] - loss1 * 0.05)).toBeLessThanOrEqual(2);
      // ② 第 2 回合开始池阵亡：从第 2 回合死亡增量中减去 round(上回合池 × 14%) 后，
      //    剩下的应恰为第 2 回合的「直接 5%」——证明池阵亡按 14% 在回合开始结算
      const instantDead2 = r2!.myDead[i] - r1!.myDead[i] - Math.round(r1!.myWounded[i] * 0.14);
      expect(Math.abs(instantDead2 - loss2 * 0.05)).toBeLessThanOrEqual(2);
    });
  });

  it('有治疗阵容（刘备皇裔流离）：恢复只消耗伤兵池、死亡不可恢复，恒等式仍成立', () => {
    const liubei = level40(hero('h16'), { strategy: 40 });
    liubei.position = '大营';
    const report = runBattle({
      seed: 21,
      maxRounds: 8,
      myTeam: [liubei, dummy('a1', '前锋'), dummy('a2', '中军')],
      enemyTeam: [dummy('b1', '前锋'), dummy('b2', '中军'), dummy('b3', '大营')],
    });
    expectConservation(report);
    const heals = report.events.filter((e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal');
    expect(heals.length).toBeGreaterThan(0); // 急救在生效
    expect(report.finalMyDead.reduce((a, b) => a + b, 0)).toBeGreaterThan(0); // 仍有永久死亡
  });

  it('配置自定义：deathRate=10, woundedDecayRate=0 → 每回合恒 10% 直接死亡、池不阵亡', () => {
    const report = runBattle({
      seed: 31,
      maxRounds: 3,
      woundedMortality: { deathRate: 10, woundedDecayRate: 0 },
      myTeam: [dummy('a1', '前锋'), dummy('a2', '中军'), dummy('a3', '大营')],
      enemyTeam: [dummy('b1', '前锋'), dummy('b2', '中军'), dummy('b3', '大营')],
    });
    expectConservation(report);
    // 直接死亡率恒 10%：某单位累计死亡 ≈ 累计受伤×10%（多段伤害各自取整 → 容差 ±2）
    const ev = roundEnd(report, 2)!;
    const liu = report.myTeam.findIndex((g) => g.id === 'a1');
    const loss = 10000 - ev.myTroops[liu];
    expect(Math.abs(ev.myDead[liu] - loss * 0.1)).toBeLessThanOrEqual(2);
  });

  it('deathRate=0, woundedDecayRate=0：无死亡（全部入池可恢复、池不阵亡），恒等式成立', () => {
    const report = runBattle({
      seed: 41,
      maxRounds: 4,
      woundedMortality: { deathRate: 0, woundedDecayRate: 0 },
      myTeam: [dummy('a1', '前锋'), dummy('a2', '中军'), dummy('a3', '大营')],
      enemyTeam: [dummy('b1', '前锋'), dummy('b2', '中军'), dummy('b3', '大营')],
    });
    expect(report.finalMyDead.every((d) => d === 0)).toBe(true);
    expect(report.finalMyWounded.some((w) => w > 0)).toBe(true); // 损失全部为伤兵
    expectConservation(report);
  });
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}
