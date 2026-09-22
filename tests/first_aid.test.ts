/**
 * 持续型急救（皇裔流离/金匮要略）机制测试（v0.12）
 *  1. 一类指挥准备阶段对友军全体（三目标）施加持续型急救，恢复率按施法者谋略缩放冻结
 *  2. 受击时按触发率（战法级共享计数）判定恢复；总生效次数每达到 N 次触发率 +M 可叠加
 *  3. 同为指挥战法的持续型急救冲突：先施加者生效（刘备 vs 张机）；不同战法类型共存
 *  4. 围困拦截急救恢复（siege_blocked）
 * 恢复率公式（调研）：实际恢复率 = roundRate(基础 + 成长率×(谋略-80))，谋略 80 时 = 描述值
 */
import { describe, it, expect } from 'vitest';
import { actUnit, applyDamage, recoverTroops, triggerCommandSkills, inflictStatus, tickStatuses, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, opts: { position?: Position; strategy?: number; maxTroops?: number; attack?: number; attackRange?: number; commandSkillIds?: string[] } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '蜀',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 50,
      defense: 100,
      strategy: opts.strategy ?? 80,
      speed: 50,
      attackRange: opts.attackRange ?? 2,
      maxTroops: opts.maxTroops ?? 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: opts.commandSkillIds ?? [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: opts.maxTroops ?? 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 刘备（施法者，中军）+ 友军 u1（前锋，挨打位）+ 敌方 e1（攻击距离 1 → 只能打前锋） */
function field(liubeiStrategy = 100): { ctx: CombatContext; liubei: UnitState; u1: UnitState; e1: UnitState } {
  const ctx = makeCtx();
  const liubei = makeUnit('liubei', { position: '中军', strategy: liubeiStrategy, commandSkillIds: ['huangyi_liuli'] });
  const u1 = makeUnit('u1', { position: '前锋', maxTroops: 10000 });
  ctx.myTeam = [liubei, u1];
  const e1 = makeUnit('e1', { position: '前锋', attack: 120, attackRange: 1, maxTroops: 10000 });
  e1.side = 'enemy';
  ctx.enemyTeam = [e1];
  return { ctx, liubei, u1, e1 };
}

type HealEvent = Extract<BattleEvent, { type: 'heal' }>;
type AidEvent = Extract<BattleEvent, { type: 'status_inflicted' }>;
const healEvents = (ctx: CombatContext) => ctx.events.filter((e): e is HealEvent => e.type === 'heal');
const aidInflicted = (ctx: CombatContext) => ctx.events.filter((e): e is AidEvent => e.type === 'status_inflicted' && e.statusType === 'first_aid');

/** 让 e1 反复普攻 u1 直到条件成立（固定种子 → 确定性结果）；返回普攻次数 */
function hitUntil(ctx: CombatContext, e1: UnitState, predicate: () => boolean, maxHits = 60): number {
  for (let i = 0; i < maxHits; i++) {
    if (predicate()) return i;
    actUnit(ctx, e1);
  }
  return maxHits;
}

describe('持续型急救（受击触发恢复）', () => {
  it('一类指挥准备阶段对友军全体施加：刘备 + 友军均挂持续型急救，恢复率按施法者谋略缩放冻结', () => {
    const { ctx, liubei, u1 } = field(100);
    triggerCommandSkills(ctx, liubei);

    // 刘备（中军）+ u1（前锋）都挂上；目标为友军全体（非敌军）
    const inflicted = aidInflicted(ctx);
    expect(inflicted.length).toBe(2);
    expect(liubei.statuses.some((s) => s.type === 'first_aid')).toBe(true);
    expect(u1.statuses.some((s) => s.type === 'first_aid')).toBe(true);

    // 恢复率冻结：谋略 100 → roundRate(68 + 0.6×20) = 80%
    const aid = u1.statuses.find((s) => s.type === 'first_aid') as Extract<UnitState['statuses'][number], { type: 'first_aid' }>;
    expect(aid.healRate).toBe(80);
    expect(aid.healGrowthRate).toBe(0.6);
    expect(aid.triggerUpEvery).toBe(3);
    expect(aid.triggerUpIncrement).toBe(5);
    expect(aid.sourceSkillId).toBe('huangyi_liuli');
    expect(aid.sourceUnitId).toBe('liubei');
    // 施法者挂上时兵力冻结（恢复值 = floor(round(300×兵/(3500+兵)) × 恢复率/100 × (1+恢复提高))）
    expect(aid.healTroops).toBe(10000);
  });

  it('谋略 80 → 恢复率 68%（描述值）；谋略 200 → roundRate(68+0.6×120)=140%', () => {
    const low = field(80);
    triggerCommandSkills(low.ctx, low.liubei);
    const aidLow = low.u1.statuses.find((s) => s.type === 'first_aid') as Extract<UnitState['statuses'][number], { type: 'first_aid' }>;
    expect(aidLow.healRate).toBe(68);

    const high = field(200);
    triggerCommandSkills(high.ctx, high.liubei);
    const aidHigh = high.u1.statuses.find((s) => s.type === 'first_aid') as Extract<UnitState['statuses'][number], { type: 'first_aid' }>;
    expect(aidHigh.healRate).toBe(140);
  });

  it('受击触发恢复：敌方普攻友军后按几率出现 heal 事件（归属施法者刘备）', () => {
    const { ctx, liubei, u1, e1 } = field(100);
    triggerCommandSkills(ctx, liubei);

    const hits = hitUntil(ctx, e1, () => healEvents(ctx).length > 0);
    expect(hits, '多次受击后应触发急救恢复').toBeLessThan(60);

    const heal = healEvents(ctx)[0];
    expect(heal!.sourceId).toBe('liubei'); // 回复归属施法者
    expect(heal!.targetId).toBe('u1');
    expect(heal!.skillId).toBe('huangyi_liuli');
    expect(heal!.amount).toBeGreaterThan(0);
    // 恢复值 = floor(round(300×施法者挂上时兵力/(3500+兵力)) × 恢复率/100 × (1+恢复提高))
    //   刘备挂上时 10000 兵 → round(300×10000/13500)=222；谋略 100 → 恢复率 80% → 222×0.8 = 177.6 → 177
    expect(heal!.after - heal!.before).toBe(heal!.amount);
    expect(heal!.amount).toBe(177);
  });

  it('总生效次数每达到 3 次触发率 +5% 可叠加：50% → 55% → 60%（战法级共享计数）', () => {
    const { ctx, liubei, u1, e1 } = field(100);
    triggerCommandSkills(ctx, liubei);
    expect(ctx.firstAidCounters!.find((c) => c.skillId === 'huangyi_liuli')!.rate).toBe(50);

    // 持续受击直到第一次几率提升（第 3 次生效后）
    const hits1 = hitUntil(
      ctx,
      e1,
      () => ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'first_aid' && e.detail.includes('提升至 55%')),
      100
    );
    expect(hits1, '3 次生效后应提升至 55%').toBeLessThan(100);
    expect(ctx.firstAidCounters!.find((c) => c.skillId === 'huangyi_liuli')!.rate).toBe(55);

    // 再 3 次生效 → 60%
    const hits2 = hitUntil(
      ctx,
      e1,
      () => ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'first_aid' && e.detail.includes('提升至 60%')),
      100
    );
    expect(hits2, '累计 6 次生效后应提升至 60%').toBeLessThan(100);
    expect(ctx.firstAidCounters!.find((c) => c.skillId === 'huangyi_liuli')!.rate).toBe(60);
  });

  it('同为指挥战法的持续型急救冲突：先施加者生效，后施加者被拒（刘备 vs 张机）', () => {
    const { ctx, liubei, u1 } = field(100);
    // 刘备先施加
    triggerCommandSkills(ctx, liubei);
    expect(u1.statuses.filter((s) => s.type === 'first_aid').length).toBe(1);

    // 张机（同类指挥急救，模拟金匮要略受击恢复部分）后施加 → 被拒
    inflictStatus(
      ctx,
      u1,
      { type: 'first_aid', healRate: 80, healGrowthRate: 0.75, triggerUpEvery: 0, triggerUpIncrement: 0 },
      'command',
      'jinkui_yaolue',
      'zhangji'
    );
    const conflict = ctx.events.find((e) => e.type === 'status_conflict' && e.statusType === 'first_aid');
    expect(conflict, '应有持续型急救冲突事件').toBeTruthy();
    expect(u1.statuses.filter((s) => s.type === 'first_aid').length).toBe(1); // 仍是刘备的急救
    expect(u1.statuses.find((s) => s.type === 'first_aid')!.sourceSkillId).toBe('huangyi_liuli');

    // 反向：张机先施加 → 刘备被拒
    const ctx2 = field(100).ctx;
    const u1b = ctx2.myTeam[1];
    inflictStatus(
      ctx2,
      u1b,
      { type: 'first_aid', healRate: 80, healGrowthRate: 0.75, triggerUpEvery: 0, triggerUpIncrement: 0 },
      'command',
      'jinkui_yaolue',
      'zhangji'
    );
    triggerCommandSkills(ctx2, ctx2.myTeam[0]);
    expect(u1b.statuses.filter((s) => s.type === 'first_aid').length).toBe(1);
    expect(u1b.statuses.find((s) => s.type === 'first_aid')!.sourceSkillId).toBe('jinkui_yaolue');
  });

  it('不同战法类型的持续型急救各自共存（被动/主动急救不与指挥急救冲突）', () => {
    const { ctx, liubei, u1 } = field(100);
    triggerCommandSkills(ctx, liubei);
    // 被动来源的急救（模拟垒实迎击受击恢复）：不同战法类型 → 共存
    inflictStatus(
      ctx,
      u1,
      { type: 'first_aid', healRate: 200, healGrowthRate: 0, triggerUpEvery: 0, triggerUpIncrement: 0 },
      'passive',
      'leishi_yingji',
      'huangfusong'
    );
    expect(u1.statuses.filter((s) => s.type === 'first_aid').length).toBe(2);
    expect(ctx.events.some((e) => e.type === 'status_conflict' && e.statusType === 'first_aid')).toBe(false);
  });

  it('围困拦截急救恢复：判定成功但恢复被拦截（siege_blocked）', () => {
    const { ctx, liubei, u1, e1 } = field(100);
    triggerCommandSkills(ctx, liubei);
    inflictStatus(ctx, u1, { type: 'siege', duration: 3 }, 'active', 'jiangmen_hunv');

    const hits = hitUntil(
      ctx,
      e1,
      () => ctx.events.some((e) => e.type === 'siege_blocked' && e.skillId === 'huangyi_liuli'),
      100
    );
    expect(hits, '围困期间急救判定成功应产生 siege_blocked').toBeLessThan(100);
    expect(healEvents(ctx).length).toBe(0); // 恢复被拦截
  });

  it('时限持续型急救（金匮要略 duration 3）：前 3 回合生效，第 3 回合末到期移除；皇裔流离（无时限）整场常驻', () => {
    // 张机金匮要略：前 3 回合急救（准备阶段施加 currentRound=0 → 回合末递减）
    const ctx = makeCtx();
    ctx.currentRound = 0;
    const zhangji = makeUnit('zhangji', { position: '中军', strategy: 100, commandSkillIds: ['jinkui_yaolue'] });
    const u1 = makeUnit('u1', { position: '前锋' });
    ctx.myTeam = [zhangji, u1];
    triggerCommandSkills(ctx, zhangji);

    const aid = u1.statuses.find((s) => s.type === 'first_aid') as Extract<UnitState['statuses'][number], { type: 'first_aid' }>;
    expect(aid.remaining).toBe(3); // 前 3 回合
    expect(aid.healRate).toBe(95); // 谋略 100 → 80 + 0.75×20 = 95%
    const detail = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted' && e.statusType === 'first_aid'
    )!.detail;
    expect(detail).toContain('持续 3 回合');

    // 回合 1/2/3 末递减：3→2→1→0 移除
    for (const round of [1, 2, 3]) {
      ctx.currentRound = round;
      tickStatuses(ctx, ctx.myTeam);
    }
    expect(u1.statuses.some((s) => s.type === 'first_aid')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'status_expired' && e.statusType === 'first_aid')).toBe(true);

    // 对照：皇裔流离无时限 → remaining Infinity，任意回合末不减
    const ctx2 = makeCtx();
    ctx2.currentRound = 0;
    const liubei = makeUnit('liubei', { position: '中军', strategy: 100, commandSkillIds: ['huangyi_liuli'] });
    const u1b = makeUnit('u1b', { position: '前锋' });
    ctx2.myTeam = [liubei, u1b];
    triggerCommandSkills(ctx2, liubei);
    const aid2 = u1b.statuses.find((s) => s.type === 'first_aid') as Extract<UnitState['statuses'][number], { type: 'first_aid' }>;
    expect(aid2.remaining).toBe(Number.POSITIVE_INFINITY);
    for (const round of [1, 2, 3, 4, 5, 6, 7, 8]) {
      ctx2.currentRound = round;
      tickStatuses(ctx2, ctx2.myTeam);
    }
    expect(u1b.statuses.some((s) => s.type === 'first_aid')).toBe(true); // 整场常驻
  });
});

describe('持续型急救不得救回致死 / 不得复活阵亡单位', () => {
  /** 皇裔已挂上且触发率 100%，致死一击应阵亡，不得靠急救把兵力从 0 拉回 */
  function lethalField(): { ctx: CombatContext; u1: UnitState } {
    const { ctx, liubei, u1 } = field(100);
    liubei.general.morale = 100;
    triggerCommandSkills(ctx, liubei);
    const counter = ctx.firstAidCounters!.find((c) => c.skillId === 'huangyi_liuli')!;
    counter.rate = 100;
    return { ctx, u1 };
  }

  it('兵力被打到 0：立即阵亡，急救不触发恢复，之后也不会复活', () => {
    const { ctx, u1 } = lethalField();
    ctx.woundedMortality = { deathRate: 5, woundedDecayRate: 14 };
    u1.troops = 80;
    applyDamage(ctx, u1, 80);

    expect(u1.troops).toBe(0);
    expect(u1.alive).toBe(false);
    expect(healEvents(ctx).length).toBe(0);
    expect(ctx.events.some((e) => e.type === 'unit_dead' && e.unitId === 'u1')).toBe(true);

    // 同一目标再挨打 / 再 recover：不得把已阵亡单位救活
    applyDamage(ctx, u1, 50);
    expect(u1.alive).toBe(false);
    expect(u1.troops).toBe(0);
    expect(recoverTroops(ctx, u1, 9999)).toBe(0);
    expect(u1.alive).toBe(false);
    expect(u1.troops).toBe(0);
  });

  it('非致死伤害仍可急救：扣兵后兵力 > 0 时恢复，单位保持存活', () => {
    const { ctx, u1 } = lethalField();
    u1.troops = 5000;
    applyDamage(ctx, u1, 100);

    expect(u1.alive).toBe(true);
    expect(u1.troops).toBeGreaterThan(4900);
    expect(healEvents(ctx).length).toBe(1);
    expect(healEvents(ctx)[0]!.amount).toBeGreaterThan(0);
  });
});
