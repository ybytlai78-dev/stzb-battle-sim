/**
 * 批量19：谋谟帷幄（贾诩）+ 持玺兴兵（卫子夫）
 *
 * 谋谟帷幄（二类指挥 S）：我军全体每次试图发动主动前，施法者 60% 判定 → 敌军单体策略攻击 171%（受谋略）；
 *   发动者兵力低于**其**初始兵力 60% 时追加一次独立判定（76%，受谋略）。「每回合首次」按
 *   「回合 × 战法 × 施法者 × 发动者」去重。
 * 持玺兴兵（指挥 A）：友军全体受到伤害后，若其兵力低于初始 50% → 恢复 200%（受谋略）+ 攻/谋 30；
 *   同时施法者自身攻/谋 -30；整场共 3 次。
 *
 * 两处「受谋略属性影响」官方均未给具体成长率 → 留空（strategyScaled 标记在、growthRate 取 0，按基值不缩放）。
 * 引擎配套机制（本批新增）：roundTrigger 'ally_before_active' + oncePerRoundPerTarget + extraByTroopRatio；
 *   onHurt.troopRatio / onHurt.maxTriggers / onHurt.selfOutput。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { troopRatioMatches, triggerAllyBeforeActiveCommands, type CombatContext } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

/** 强化的木桩：保证打满回合、能吃出 50% 兵力阈值 */
function dummy(id: string, position: Position): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 150,
    defense: 120,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 15000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function enemyTeam(): General[] {
  return [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')];
}

/** 我方：木桩前锋 + 大乔（带主动，供谋谟帷幄监听）+ 贾诩大营 */
function teamWithJiaxu(): General[] {
  return [
    dummy('a-front', '前锋'),
    withSkills({ ...level40(hero('h619')), position: '中军' }, { activeSkillIds: ['qiaoyin_huandie'] }),
    { ...level40(hero('h618')), position: '大营' } as General,
  ];
}

/** 我方：木桩前锋挨打 + 卫子夫大营（自身受罚要看非施法者受伤，故施法者不站前排） */
function teamWithWeiZifu(): General[] {
  return [
    dummy('a-front', '前锋'),
    dummy('a-mid', '中军'),
    { ...level40(hero('h786')), position: '大营' } as General,
  ];
}

function makeUnit(id: string, opts: { troops?: number; maxTroops?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '魏',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: '大营',
      attack: 100,
      defense: 100,
      strategy: 120,
      speed: 50,
      attackRange: 2,
      maxTroops: opts.maxTroops ?? 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: opts.troops ?? 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(next = 0.1): CombatContext {
  return {
    rng: { next: () => next, int: () => 0, intInclusive: () => 0, chance: (p: number) => next < p } as unknown as Rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const triggerCount = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'moumou_weiwo').length;

type StatusInflicted = { type: 'status_inflicted'; unitId: string; statusType: string; detail: string };

describe('谋谟帷幄（贾诩，二类指挥：友军监听试图发动主动）', () => {
  it('装配挂槽 + 战法元数据（指挥 round / 距离 5 / 敌军单体 / 发动率走段级 chance）', () => {
    const g = hero('h618');
    expect(g.name).toBe('贾诩');
    expect(g.commandSkillIds).toContain('moumou_weiwo');

    const s = SKILL_REGISTRY['moumou_weiwo'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') throw new Error('谋谟帷幄应为指挥');
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('ally_before_active');
    expect(s.oncePerRoundPerTarget).toBe(true);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(1); // 指挥发动率恒 1，实际几率走段级 chance
    expect(s.extraByTroopRatio?.cond).toEqual({ below: 60 });

    const main = s.output[0];
    const extra = s.extraByTroopRatio?.output[0];
    expect(main.kind === 'strategy_damage' && main.rate).toBe(171);
    expect(main.kind === 'strategy_damage' && main.chance).toBe(0.6);
    expect(extra?.kind === 'strategy_damage' && extra.rate).toBe(76);
    // 171% 段：实测反解已确认 1.825（4 点观测，与大明州 §6.2 表一致）
    expect(main.kind === 'strategy_damage' && main.growthRate).toBe(1.825);
    // 追加 76% 段：尚无实测点 → 暂取 0（按基值不缩放），待补「兵力 < 初始 60%」观测
    expect(extra?.kind === 'strategy_damage' && extra.growthRate).toBe(0);
  });

  it('每回合对同一发动者只判定一次，换回合后可再判定', () => {
    const ctx = makeCtx();
    const jiaxu = makeUnit('jiaxu');
    jiaxu.general.commandSkillIds = ['moumou_weiwo'];
    const actor = makeUnit('actor');
    ctx.myTeam = [jiaxu, actor];
    ctx.enemyTeam = [makeUnit('e1'), makeUnit('e2')];

    triggerAllyBeforeActiveCommands(ctx, actor);
    const after1 = triggerCount(ctx);
    expect(after1).toBeGreaterThan(0);

    triggerAllyBeforeActiveCommands(ctx, actor); // 同回合同一发动者 → 去重
    expect(triggerCount(ctx)).toBe(after1);

    ctx.currentRound = 2;
    triggerAllyBeforeActiveCommands(ctx, actor); // 新回合 → 重新判定
    expect(triggerCount(ctx)).toBeGreaterThan(after1);
  });

  it('追加段门槛：发动者兵力严格低于初始 60% 才满足', () => {
    const u = makeUnit('u', { troops: 6000, maxTroops: 10000 }); // 恰好 60%
    expect(troopRatioMatches(u, { below: 60 })).toBe(false);
    u.troops = 5999;
    expect(troopRatioMatches(u, { below: 60 })).toBe(true);
  });

  it('实战回归：我方试图发动主动时，贾诩判定并打出策略伤害', () => {
    // 注意：引擎的 rng 在每回合开头会重置序列，故「回合内第一次判定」在各回合取同一个值——
    // 单个 seed 下 60% 判定可能整场全落空（实测 seed 5）。故累计多个 seed 后再断言。
    const casts: Array<{ unitId: string }> = [];
    let strategyHits = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const report = runBattle({ seed, maxRounds: 8, myTeam: teamWithJiaxu(), enemyTeam: enemyTeam() });
      casts.push(
        ...report.events
          .filter(
            (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
              e.type === 'skill_cast' && e.skillId === 'moumou_weiwo'
          )
          .map((e) => ({ unitId: e.unitId }))
      );
      strategyHits += report.events.filter(
        (e) => e.type === 'damage' && (e as { damageType?: string }).damageType === 'strategy'
      ).length;
    }
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((c) => c.unitId === 'h618')).toBe(true); // 只有我方贾诩持有
    expect(strategyHits).toBeGreaterThan(0);
  });
});

describe('持玺兴兵（卫子夫，指挥：友军受击 + 兵力阈值 + 整场 3 次）', () => {
  it('装配挂槽 + 战法元数据（onHurt 兵力阈值 50% / 整场 3 次 / 自身落点 / 距离 2）', () => {
    const g = hero('h786');
    expect(g.name).toBe('卫子夫');
    expect(g.commandSkillIds).toContain('chixi_xingbing');

    const s = SKILL_REGISTRY['chixi_xingbing'];
    expect(s.type).toBe('command');
    expect(s.range).toBe(2);
    const cfg = s.type === 'command' && s.onHurt && !Array.isArray(s.onHurt) ? s.onHurt : undefined;
    expect(cfg).toBeTruthy();
    expect(cfg?.victim).toBe('ally');
    expect(cfg?.troopRatio).toEqual({ below: 50 });
    expect(cfg?.maxTriggers).toBe(3);
    expect(cfg?.applyTo).toBe('victim');

    // 受伤者落点：恢复 200%（受谋略，成长率留空）+ 攻/谋 +30
    const outs = cfg?.output ?? [];
    const heal = outs.find((o) => o.kind === 'heal');
    expect(heal?.kind === 'heal' && heal.rate).toBe(200);
    expect(heal?.kind === 'heal' && heal.strategyScaled).toBe(true);
    expect(heal?.kind === 'heal' && heal.growthRate).toBe(0);
    expect(outs.filter((o) => o.kind === 'inflict_status').length).toBe(2);

    // 施法者自身落点：攻/谋 -30
    const self = cfg?.selfOutput ?? [];
    expect(self.length).toBe(2);
    for (const out of self) {
      expect(out.kind).toBe('inflict_status');
      if (out.kind === 'inflict_status' && !Array.isArray(out.status)) {
        expect(out.status.type).toMatch(/^(attack|strategy)_buff$/);
        expect('amount' in out.status && out.status.amount).toBe(-30);
      }
    }
  });

  it('实战回归：受伤者得恢复与增益、施法者自身受罚，且整场触发不超过 3 次', () => {
    const report = runBattle({ seed: 5, maxRounds: 12, myTeam: teamWithWeiZifu(), enemyTeam: enemyTeam() });

    // 每次触发恰好一段恢复 → 用恢复次数判定实际触发次数（官方面板：共可触发 3 次）
    const heals = report.events.filter(
      (e) => e.type === 'heal' && (e as { skillName?: string }).skillName === '持玺兴兵'
    );
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.length).toBeLessThanOrEqual(3);

    const si = report.events.filter((e): e is BattleEvent & StatusInflicted => e.type === 'status_inflicted');
    // 受伤者落点：+30（提高），落在非施法者身上
    const victimUp = si.filter(
      (e) => e.statusType === 'attack_buff' && e.unitId !== 'h786' && e.detail.includes('提高')
    );
    expect(victimUp.length).toBeGreaterThan(0);
    // 施法者自身落点：-30（降低），落在卫子夫身上
    const selfDown = si.filter(
      (e) => e.statusType === 'attack_buff' && e.unitId === 'h786' && e.detail.includes('降低')
    );
    expect(selfDown.length).toBeGreaterThan(0);
    // 谋略维同口径
    expect(
      si.filter((e) => e.statusType === 'strategy_buff' && e.unitId === 'h786' && e.detail.includes('降低')).length
    ).toBeGreaterThan(0);
  });
});
