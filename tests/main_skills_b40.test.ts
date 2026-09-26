/**
 * 其徐如林（司马懿·晋步 h807 主战法）：指挥 S，距离 5，我军全体。
 * 我军全体在正式回合后施加的策略伤害，在生效时会对目标相邻的敌军额外造成一次策略伤害
 * （伤害率为原伤害率的 15%），此比例每回合结束时额外提升 5%，可叠加，持续至战斗结束。
 * 官方：scripts/skill_extra.json id 200282（1 级 7.5% / 2.5%）。
 * 引擎配套：新增 `CommandSkill.strategyAdjacentBonus`（策略伤害相邻跳伤光环）。
 * 成长率：两处「受谋略属性影响」未确认 → 留空（strategyScaled 在、不给 growthRate → 基值不缩放）→ 登记下架。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '晋',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 90,
    speed: 50,
    attackRange: 5,
    maxTroops: 20000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
    hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

/** 测试用策略伤害主动战法（固定单体、必中，便于确定性断言） */
function probeSkill(id = 'probe_strat'): Skill {
  return {
    id,
    name: '试探策略',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: false }],
  };
}

function damages(ctx: CombatContext, skillId: string) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

/** 司马懿登记其徐如林 + 1 名打手（带策略战法） vs 2 个相邻木桩 */
function setup(seed = 1, round = 1) {
  const sima = heroUnit('h807', '大营', { commandSkillIds: ['qixu_rulin'] });
  const striker = makeUnit(dummy('striker', '前锋', { activeSkillIds: ['probe_strat'] }));
  const front = makeUnit(dummy('e-front', '前锋'), 'enemy');
  const mid = makeUnit(dummy('e-mid', '中军'), 'enemy');
  const ctx = makeCtx([striker, sima], [front, mid], seed);
  ctx.skills.set('probe_strat', probeSkill());
  triggerCommandSkills(ctx, sima);
  ctx.currentRound = round;
  return { sima, striker, front, mid, ctx };
}

describe('其徐如林（司马懿·晋 h807）', () => {
  it('装配：注册表定义 + 挂槽名（指挥 S / 距离 5 / 我军全体 / 相邻跳伤 15% + 每回合 5%）', () => {
    const hero = HERO_REGISTRY['h807'];
    expect(hero.name).toBe('司马懿');
    expect(hero.mainSkillName).toBe('其徐如林');

    const s = SKILL_REGISTRY['qixu_rulin'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect([...s.tags]).toEqual(['damage']);
    expect(s.output).toEqual([]);
    expect(s.strategyAdjacentBonus).toEqual({ baseRate: 15, perRound: 5, strategyScaled: true });
    // 成长率留空：不给 growthRate（不缩放、用基值）
    expect(s.strategyAdjacentBonus?.growthRate).toBeUndefined();
    expect(isHeroListed({ mainSkillId: 'qixu_rulin' })).toBe(false); // 受谋略成长未确认 → 下架
  });

  it('相邻跳伤：策略伤害命中后，对目标相邻敌军额外结算一次（skillId 为其徐如林）', () => {
    const { striker, front, mid, ctx } = setup();
    actUnit(ctx, striker);

    const normal = damages(ctx, 'probe_strat');
    expect(normal).toHaveLength(1);
    const hitTarget = normal[0].targetId;
    const bonus = damages(ctx, 'qixu_rulin');
    // 2 名木桩互为单位（前锋—中军），被命中者的邻居只有 1 个
    expect(bonus).toHaveLength(1);
    const expectedNeighbor = hitTarget === 'e-front' ? mid : front;
    expect(bonus[0].targetId).toBe(expectedNeighbor.general.id);
    expect(bonus[0].damageType).toBe('strategy');
    expect(bonus[0].sourceId).toBe('striker'); // 沿用原伤害造成者
    expect(bonus[0].damage).toBeGreaterThan(0);
    // 15% 比例 → 明显低于原伤害
    expect(bonus[0].damage).toBeLessThan(normal[0].damage);
  });

  it('比例每回合结束时 +5%：第 3 回合的跳伤高于第 1 回合（同种子）', () => {
    const bonusAt = (round: number) => {
      const { striker, ctx } = setup(5, round);
      actUnit(ctx, striker);
      return damages(ctx, 'qixu_rulin')[0]?.damage ?? 0;
    };
    const r1 = bonusAt(1);
    const r3 = bonusAt(3);
    expect(r1).toBeGreaterThan(0);
    expect(r3).toBeGreaterThan(r1); // 15% → 25%
  });

  it('只覆盖本侧伤害：敌军对我方造成的策略伤害不触发跳伤', () => {
    const { striker, ctx } = setup();
    // 让木桩成为「造成策略伤害」的一方：直接构造一个敌军单位带同样的策略战法
    const foeCaster = ctx.enemyTeam[0];
    ctx.skills.set('probe_foe', probeSkill('probe_foe'));
    foeCaster.general.activeSkillIds.push('probe_foe');
    ctx.currentRound = 1;
    actUnit(ctx, foeCaster);

    expect(damages(ctx, 'qixu_rulin')).toHaveLength(0);
    expect(striker.alive).toBe(true);
  });

  it('整场跑通（runBattle）：出现其徐如林的跳伤事件', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h807']), { commandSkillIds: ['qixu_rulin'] }),
      position: '大营',
    };
    const caster: General = {
      ...withSkills(level40(HERO_REGISTRY['h496']), { activeSkillIds: ['qixu_rulin'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 12,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), caster, leader],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    // 司马懿 其徐如林挂在队里即注册；只要本队出现策略伤害便会伴随跳伤
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillId === 'qixu_rulin')).toBe(true);
  });
});
