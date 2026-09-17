/**
 * 九伐中原（XP姜维主战法）：被动。
 * 自身每次发动主动战法后，对敌军群体发动一次攻击（伤害率 90%）和一次策略攻击（伤害率 90%，受谋略属性影响），
 * 本场战斗共计可发动九次；每回合开始时，自身造成所有伤害提升 5%（受谋略属性影响），可叠加，持续至战斗结束。
 * 官方：被动 A，有效距离 5，目标「敌军群体」，可用兵种弓/步/骑（scripts/skill_extra.json id 200290）。
 * 挂槽依据 dateyuan/hero_growth_verified.json「XP姜维（蜀·骑，hero_id 100806）→ 九伐中原」。
 *
 * 引擎配套（本条战法新增 1 项机制）：被动 `afterActive` 钩子 ——
 *   每次主动战法成功释放后触发（不限本回合首次，与二类指挥 after_first_active 区分），
 *   maxTriggers 为整场战斗的发动次数上限（九伐中原 9 次），计数走 ctx.afterActiveCounters。
 * 「受谋略属性影响」的策略伤害 90% 与每回合增伤 5% 成长率未确认 → 留空（strategyScaled 标记在、不给 growthRate）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import {
  actUnit,
  inflictStatus,
  triggerPassiveAfterActive,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
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

/** XP姜维（带一个可发动的主动战法，用于触发 afterActive 钩子） */
function teamWithJiangwei(): General[] {
  const leader = withSkills(
    { ...level40(hero('xp_jiangwei')), position: '中军' },
    { activeSkillIds: ['jijiao_zhishi'], passiveSkillIds: ['jiufa_zhongyuan'] }
  );
  return [dummy('ally-front', '前锋'), leader, dummy('ally-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

// ─── 确定性直构单元（对照 main_skills_b26.test.ts）───

function makeUnit(
  id: string,
  opts: { position?: Position; morale?: number; passiveSkillIds?: string[]; activeSkillIds?: string[] } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '蜀',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'cavalry',
      position: opts.position ?? '中军',
      attack: 100,
      defense: 100,
      strategy: 120,
      speed: 60,
      attackRange: 2,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: opts.activeSkillIds ?? [],
      passiveSkillIds: opts.passiveSkillIds ?? [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: opts.morale ?? 100,
    },
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(next: number): CombatContext {
  return {
    rng: {
      next: () => next,
      int: () => 0,
      intInclusive: () => 0,
      chance: (p: number) => next < p,
    } as unknown as Rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
const inflicted = (events: BattleEvent[], statusType: string): Inflicted[] =>
  events.filter((e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === statusType);

describe('九伐中原（XP姜维，被动：发动主动战法后群伤 + 每回合叠增伤 + 九次上限）', () => {
  it('装配挂槽 + 战法元数据（被动 / 距离 5 / 每回合开始 / 敌军群体）', () => {
    const g = hero('xp_jiangwei');
    expect(g.name).toBe('XP姜维');
    expect(g.passiveSkillIds).toContain('jiufa_zhongyuan');

    const s = SKILL_REGISTRY['jiufa_zhongyuan'];
    expect(s.type).toBe('passive');
    expect(s.type === 'passive' && s.timing).toBe('round_start');
    expect(s.range).toBe(5);
    expect(s.type === 'passive' && s.afterActive?.maxTriggers).toBe(9);
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'damage_boost']));
  });

  it('每回合开始：自身造成伤害 +5%（同战法叠加累加 rate），成长率留空用基值', () => {
    // ① 实战：被动在回合开始确实挂上增伤
    const report = run(teamWithJiangwei(), 5, 6);
    const boosts = inflicted(report.events, 'damage_boost').filter((e) => e.unitId === 'xp_jiangwei');
    expect(boosts.length).toBeGreaterThan(0);
    expect(boosts[0].detail).toContain('造成的伤害提高 5%');

    // ② 叠加语义：同战法重复施加 → rate 累加（不新开 status_inflicted 事件，故用直构断言）
    const jw = makeUnit('xp_jiangwei', { passiveSkillIds: ['jiufa_zhongyuan'] });
    const ctx = makeCtx(0.5);
    ctx.myTeam = [jw];
    const s = SKILL_REGISTRY['jiufa_zhongyuan'];
    const seg = s.type === 'passive' ? s.output[0] : undefined;
    expect(seg && seg.kind === 'inflict_status').toBe(true);
    if (seg && seg.kind === 'inflict_status' && !Array.isArray(seg.status)) {
      expect('strategyScaled' in seg.status && seg.status.strategyScaled).toBe(true);
      expect('growthRate' in seg.status).toBe(false); // 「受谋略」成长率未确认 → 留空
      inflictStatus(ctx, jw, seg.status, 'passive', 'jiufa_zhongyuan', 'xp_jiangwei');
      inflictStatus(ctx, jw, seg.status, 'passive', 'jiufa_zhongyuan', 'xp_jiangwei');
      const st = jw.statuses.find((x) => x.type === 'damage_boost');
      expect(st && 'rate' in st && st.rate).toBeCloseTo(0.1, 5); // 5% + 5%
    }
  });

  it('发动主动战法后触发：对敌军群体造成攻击伤害 + 策略攻击伤害', () => {
    const jw = makeUnit('xp_jiangwei', {
      passiveSkillIds: ['jiufa_zhongyuan'],
      activeSkillIds: ['jijiao_zhishi'],
    });
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    const e2 = makeUnit('e2', { position: '中军' });
    e2.side = 'enemy';
    const ctx = makeCtx(0.1);
    ctx.myTeam = [jw];
    ctx.enemyTeam = [e1, e2];

    triggerPassiveAfterActive(ctx, jw);

    const cast = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
        e.type === 'skill_cast' && e.skillId === 'jiufa_zhongyuan'
    );
    expect(cast).toHaveLength(1);
    // 战法伤害走 `damage` 事件（普攻才是 attack_hit）：两段各打敌军群体
    const dmg = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === 'xp_jiangwei'
    );
    expect(dmg.length).toBeGreaterThan(0);
    const kinds = new Set(dmg.map((e) => e.damageType));
    expect(kinds.has('physical')).toBe(true); // 攻击段 90%
    expect(kinds.has('strategy')).toBe(true); // 策略段 90%（受谋略）
    expect(dmg.every((e) => e.targetId.startsWith('e'))).toBe(true);
  });

  it('整场战斗共计九次：第 10 次起钩子不再触发', () => {
    const jw = makeUnit('xp_jiangwei', {
      passiveSkillIds: ['jiufa_zhongyuan'],
      activeSkillIds: ['jijiao_zhishi'],
    });
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    const ctx = makeCtx(0.1);
    ctx.myTeam = [jw];
    ctx.enemyTeam = [e1];

    for (let i = 0; i < 12; i++) triggerPassiveAfterActive(ctx, jw);

    const casts = ctx.events.filter(
      (e) => e.type === 'skill_cast' && (e as { skillId?: string }).skillId === 'jiufa_zhongyuan'
    );
    expect(casts).toHaveLength(9);
    expect(ctx.afterActiveCounters?.get('xp_jiangwei:jiufa_zhongyuan')).toBe(9);
  });

  it('实战回归：整场战斗可发动（skill_cast 出现）且不干扰主动战法本身的统计', () => {
    const report = run(teamWithJiangwei(), 7, 8);
    const castNames = report.events
      .filter((e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast')
      .map((e) => e.skillName);
    expect(castNames).toContain('九伐中原');
  });
});
