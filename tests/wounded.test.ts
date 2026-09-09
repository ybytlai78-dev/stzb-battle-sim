/**
 * 伤兵死亡机制测试（v0.13）
 *  1. 每回合损失按「当回合死亡率」即时拆分：死亡（永久损失，不可恢复）+ 伤兵（入池，可恢复）
 *     第 1 回合 5%、每回合 +14%（第 2 回合 19%、第 3 回合 33%…），封顶 100%（第 8 回合 = 103% → 100%）
 *  2. 恢复（heal/持续急救）只能从伤兵池扣除；死亡按受伤量结算，治疗不冲减死亡
 *  3. 伤兵池跨回合累计；未配置机制（直接构造 ctx）时不启用
 *  4. runBattle：round_end 事件输出每回合兵力/伤兵/死亡数组，恒等式 troops+wounded+dead = maxTroops
 *  5. 配置自定义（base/perRound）与关闭（0/0）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { applyDamage, recoverTroops, type CombatContext } from '../src/engine/action';
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
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(mortality: { base: number; perRound: number } | null): CombatContext {
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
  if (mortality) ctx.woundedMortality = mortality;
  return ctx;
}

describe('伤兵死亡机制（单元：按当回合死亡率即时拆分）', () => {
  it('第 1 回合死亡率 5%：受伤 100 → 死亡 5、伤兵 95（用户示例）', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
    const u = makeUnit('u1');
    applyDamage(ctx, u, 100);
    expect(u.troops).toBe(9900);
    expect(u.totalDead).toBe(5); // 死亡 = 受伤量 × 5%
    expect(u.wounded).toBe(95); // 伤兵 = 受伤量 - 死亡
  });

  it('死亡率每回合 +14%：第 2 回合 19%、第 3 回合 33%（用户示例）', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
    const u = makeUnit('u1');
    ctx.currentRound = 2;
    applyDamage(ctx, u, 100);
    expect(u.totalDead).toBe(19);
    expect(u.wounded).toBe(81);
    ctx.currentRound = 3;
    applyDamage(ctx, u, 100);
    expect(u.totalDead).toBe(52); // 19 + 33
    expect(u.wounded).toBe(148); // 81 + 67
  });

  it('死亡率封顶 100%：第 8 回合（5+14×7=103 → 100%）损失全部死亡、无伤兵', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
    const u = makeUnit('u1');
    ctx.currentRound = 8;
    applyDamage(ctx, u, 100);
    expect(u.totalDead).toBe(100);
    expect(u.wounded).toBe(0);
  });

  it('伤兵池跨回合累计：两回合各受伤 100 → 累计死亡 24、伤兵池 176', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
    const u = makeUnit('u1');
    applyDamage(ctx, u, 100); // 第 1 回合：死 5 伤 95
    ctx.currentRound = 2;
    applyDamage(ctx, u, 100); // 第 2 回合：死 19 伤 81
    expect(u.totalDead).toBe(24);
    expect(u.wounded).toBe(176);
  });

  it('DoT/溢出伤害同样结算：cap 后伤害按死亡率拆分（调用方先 cap，applyDamage 收到即为实际扣减量）', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
    const u = makeUnit('u1', 100); // 兵力 100
    applyDamage(ctx, u, 100); // cap 后实际扣减 100（溢出部分不结算）
    expect(u.troops).toBe(0);
    expect(u.totalDead).toBe(5); // 100 × 5%
    expect(u.wounded).toBe(95);
  });
});

describe('伤兵死亡机制（单元：恢复只能消耗伤兵池）', () => {
  it('恢复量 = min(请求量, 伤兵池, 兵力缺口)；死亡兵力不可恢复', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
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
  });

  it('死亡按受伤量结算，治疗不冲减死亡（先受伤后治疗示例）', () => {
    const ctx = makeCtx({ base: 5, perRound: 14 });
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

describe('伤兵死亡机制（runBattle 集成）', () => {
  it('默认启用（5% / +14%）：round_end 输出每回合伤兵/死亡数组，恒等式 troops+伤兵+死亡 = maxTroops', () => {
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

  it('配置自定义：base=10, perRound=0 → 每回合恒 10% 死亡', () => {
    const report = runBattle({
      seed: 31,
      maxRounds: 3,
      woundedMortality: { base: 10, perRound: 0 },
      myTeam: [dummy('a1', '前锋'), dummy('a2', '中军'), dummy('a3', '大营')],
      enemyTeam: [dummy('b1', '前锋'), dummy('b2', '中军'), dummy('b3', '大营')],
    });
    expectConservation(report);
    // 每回合死亡率恒 10%：某单位单回合受伤 → 死亡 = round(受伤×10%)
    const ev = report.events.find((e): e is RoundEndEvent => e.type === 'round_end' && e.round === 2);
    const liu = report.myTeam.findIndex((g) => g.id === 'a1');
    const round1Loss = 10000 - ev!.myTroops[liu];
    const round1Dead = ev!.myDead[liu];
    expect(round1Dead).toBe(Math.round(round1Loss * 0.1));
  });

  it('base=0, perRound=0：无死亡（全部入池可恢复），恒等式成立', () => {
    const report = runBattle({
      seed: 41,
      maxRounds: 4,
      woundedMortality: { base: 0, perRound: 0 },
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
