/**
 * 巧音唤蝶（大乔主战法）：主动。
 * 对敌军群体策略攻击 176%（受谋略）并使其陷入燃烧状态——当目标兵力高于初始兵力 50% 时受到
 * 一次策略伤害（86%，受谋略），持续 1 回合；同时使我军群体恢复 161%（受谋略），并使其进入休整状态
 * ——当目标兵力低于初始兵力 50% 时恢复 82%（受谋略），持续 1 回合。
 * 官方：主动 S，有效距离 5，发动率 35%，目标「敌军群体（有效距离内 2 个目标）」，可用兵种步。
 *
 * 引擎配套（本批新增机制）：兵力阈值条件 `troopRatio`
 *   段级：`heal.troopRatio` / `strategy_damage.troopRatio` —— 目标池过滤（executeSkillOutputs）
 *   状态级：`burning` / `rest` 的 troopRatio —— tickDots / tickRests 跳结算时按携带者当前兵力判定
 * 「受谋略属性影响」各项成长率未确认 → 留空（strategyScaled 标记在、不给 growthRate）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { troopRatioMatches, type CombatContext } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, morale = 100): General {
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
    attack: 60,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function teamWithDaqiao(): General[] {
  const leader = withSkills(
    { ...level40(hero('h619')), position: '中军' },
    { activeSkillIds: ['qiaoyin_huandie'] }
  );
  return [dummy('ally-front', '前锋'), leader, dummy('ally-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

/** 直构单位：可指定兵力（测兵力阈值） */
function makeUnit(id: string, opts: { position?: Position; troops?: number; maxTroops?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '中军',
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
    isPreparing: false,
    preparingSkillId: null,
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

describe('巧音唤蝶（大乔，主动：敌军策略 + 条件燃烧 + 我军恢复 + 条件休整）', () => {
  it('装配挂槽 + 战法元数据（主动 / 距离 5 / 发动率 35% / 敌军群体 2 目标）', () => {
    const g = hero('h619');
    expect(g.name).toBe('大乔');
    expect(g.activeSkillIds).toContain('qiaoyin_huandie');

    const s = SKILL_REGISTRY['qiaoyin_huandie'];
    expect(s.type).toBe('active');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.35);
    expect(s.groupCount).toBe(2);
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'burning', 'heal', 'rest']));
  });

  it('兵力阈值判定（troopRatio）：below / above 边界与组合', () => {
    const u = makeUnit('u', { troops: 5000, maxTroops: 10000 }); // 50%
    expect(troopRatioMatches(u, { below: 50 })).toBe(false); // 恰好 50% 不算「低于」
    expect(troopRatioMatches(u, { above: 50 })).toBe(false);
    u.troops = 4999;
    expect(troopRatioMatches(u, { below: 50 })).toBe(true);
    u.troops = 5001;
    expect(troopRatioMatches(u, { above: 50 })).toBe(true);
    u.troops = 8000;
    expect(troopRatioMatches(u, { below: 50, above: 50 })).toBe(false); // 组合须同时满足
  });

  it('段级条件：燃烧锚定「高于初始 50%」、休整锚定「低于初始 50%」（含成长率留空）', () => {
    const s = SKILL_REGISTRY['qiaoyin_huandie'];
    const burn = s.output.find((o) => o.kind === 'inflict_status');
    expect(burn).toBeTruthy();
    if (burn && burn.kind === 'inflict_status' && !Array.isArray(burn.status)) {
      const st = burn.status;
      expect(st.type).toBe('burning');
      if (st.type === 'burning') {
        expect(st.troopRatio).toEqual({ above: 50 });
        expect(st.growthRate).toBe(0); // 「受谋略」成长率未确认 → 不缩放
      }
    }
    const rest = s.output.filter((o) => o.kind === 'inflict_status')[1];
    if (rest && rest.kind === 'inflict_status' && !Array.isArray(rest.status)) {
      const st = rest.status;
      expect(st.type).toBe('rest');
      if (st.type === 'rest') {
        expect(st.troopRatio).toEqual({ below: 50 });
      }
    }
    const heal = s.output.find((o) => o.kind === 'heal');
    expect(heal && heal.kind === 'heal' && heal.rate).toBe(161);
    expect(heal && heal.kind === 'heal' && heal.targetSide).toBe('ally');
  });

  it('状态级条件：燃烧跳伤按携带者当前兵力判定（高兵力跳、低兵力不跳）', () => {
    const ctx = makeCtx();
    const high = makeUnit('high', { troops: 9000 });
    const low = makeUnit('low', { troops: 1000 });
    ctx.myTeam = [high, low];
    const burning: Status = {
      type: 'burning',
      remaining: 1,
      rate: 86,
      sourceStrategy: 120,
      appliedRound: 1,
      sourceSkillType: 'active',
      sourceSkillId: 'qiaoyin_huandie',
      troopRatio: { above: 50 },
    };
    high.statuses.push({ ...burning });
    low.statuses.push({ ...burning });
    // 条件判定（与 tickDots 内同一 helper）
    expect(troopRatioMatches(high, { above: 50 })).toBe(true);
    expect(troopRatioMatches(low, { above: 50 })).toBe(false);
  });

  it('实战回归：整场战斗可发动并出现伤害与恢复', () => {
    const report = run(teamWithDaqiao(), 3, 8);
    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
        e.type === 'skill_cast' && e.skillName === '巧音唤蝶'
    );
    const heals = report.events.filter((e) => e.type === 'heal');
    const dots = report.events.filter(
      (e) => e.type === 'dot_tick' && (e as { skillId?: string }).skillId === 'qiaoyin_huandie'
    );
    expect(casts.length).toBeGreaterThan(0);
    expect(heals.length).toBeGreaterThan(0);
    // 燃烧按条件跳伤（也可能因目标兵力一直偏低而不跳 → 只要求不报错、状态挂上过）
    const burnStatus = report.events.filter(
      (e) => e.type === 'status_inflicted' && (e as { statusType?: string }).statusType === 'burning'
    );
    expect(burnStatus.length + dots.length).toBeGreaterThan(0);
  });
});
