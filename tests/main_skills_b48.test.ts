/**
 * 缚父临危（吕姬·群步 h634 主战法）：主动 B，距离 4，35%，敌军群体（有效距离内 2 个目标）。
 * 对敌军群体发动一次攻击（210%），并使自身及友军攻击属性最高的单体下两次攻击造成的伤害提升 30.0%。
 * 同时使友军中吕布下一次造成的伤害无视规避。
 * 官方：scripts/skill_extra.json id 200902（主动 B / 距离 4 / 敌军群体2 / 步；1 级 105% / 15%）。
 * 口径（用户确认）：「攻击」= 普攻 / 物理主动 / 追击（不含分兵/反击/指挥代打/DoT）；无视规避覆盖**任意**伤害类型；
 *   「友军中吕布」按武将名匹配（h3 汉骑 / h479 群弓 SP 两张都算）。
 * 三段均无「受…属性影响」→ 无待确认成长率，吕姬**上架**。
 * 引擎配套：inflict_status.targetPick（highest_attack_ally / ally_named）+ damage_boost.attackOnly
 *   + 新状态 ignore_evasion（consumeEvasion 统一入口消耗）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  inflictStatus,
  triggerActiveSkill,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
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
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 30000,
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
    isPreparing: false,
    preparingSkillId: null,
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
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

/** 发动率拉满的缚父临危 */
function forcedSkill(): Skill {
  const s = structuredClone(SKILL_REGISTRY['fufu_linwei']) as Skill;
  s.triggerRate = 1;
  return s;
}

function activeSkill(id: string, output: Skill['output']): Skill {
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output,
  } as Skill;
}

const PHYS = activeSkill('t_phys', [{ kind: 'physical_damage', rate: 100 }]);
const STRAT = activeSkill('t_strat', [{ kind: 'strategy_damage', rate: 100, strategyScaled: false }]);

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function boostOf(unit: UnitState) {
  return unit.statuses.find((s) => s.type === 'damage_boost');
}
function ignoreEvasionOf(unit: UnitState) {
  return unit.statuses.find((s) => s.type === 'ignore_evasion');
}

/** 吕姬 + 攻击最高友军（可指定攻击）+ 任意友军 + 两名敌军 */
function setup(seed = 3, atk = 300) {
  const lvji = heroUnit('h634', '大营', { activeSkillIds: ['fufu_linwei'] });
  const bruiser = makeUnit(dummy('ally-atk', '前锋', { attack: atk }));
  const other = makeUnit(dummy('ally-other', '中军', { attack: 60, strategy: 200 }));
  const foes = [
    makeUnit(dummy('foe-a', '前锋'), 'enemy'),
    makeUnit(dummy('foe-b', '中军'), 'enemy'),
  ];
  const ctx = makeCtx([bruiser, other, lvji], foes, seed);
  return { lvji, bruiser, other, foes, ctx };
}

describe('缚父临危（吕姬 h634）', () => {
  it('装配：注册表定义（三段）+ h634 挂槽 + 三段无成长率待确认（吕姬上架）', () => {
    const hero = HERO_REGISTRY['h634'];
    expect(hero.name).toBe('吕姬');
    expect(hero.mainSkillName).toBe('缚父临危');

    const s = SKILL_REGISTRY['fufu_linwei'];
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.35);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 210, targetMode: 'group', groupCount: 2 });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      targetPick: 'highest_attack_ally',
      status: { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused', charges: 2, attackOnly: true },
    });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      targetPick: 'ally_named',
      targetPickName: '吕布',
      status: { type: 'ignore_evasion', duration: 999 },
    });

    // 无「受…属性影响」→ 不登记下架
    expect(OFFLINE_MAIN_SKILLS['fufu_linwei']).toBeUndefined();
    expect(isHeroListed({ mainSkillId: 'fufu_linwei' })).toBe(true);
  });

  it('① 对敌军群体（有效距离内 2 目标）发动一次攻击 210%', () => {
    const { lvji, foes, ctx } = setup();
    triggerActiveSkill(ctx, lvji, forcedSkill(), foes, [lvji], foes);
    const dmg = eventsOf(ctx, 'damage');
    expect(dmg).toHaveLength(2);
    expect(dmg.every((d) => d.damageType === 'physical')).toBe(true);
    expect(new Set(dmg.map((d) => d.targetId)).size).toBe(2);
    expect(foes.every((f) => f.troops < f.general.maxTroops)).toBe(true);
  });

  it('② 增伤落在「我军攻击属性最高单体」（含自身）：攻击最高者是友军时给友军', () => {
    const { lvji, bruiser, other, foes, ctx } = setup(5, 300);
    triggerActiveSkill(ctx, lvji, forcedSkill(), foes, [lvji], foes);
    expect(boostOf(bruiser)?.type).toBe('damage_boost');
    expect(boostOf(other)).toBeUndefined();
    expect(boostOf(lvji)).toBeUndefined();
  });

  it('② 吕姬自身攻击最高时增伤落在自身（「自身及友军」含己）', () => {
    const lvji = heroUnit('h634', '大营', { activeSkillIds: ['fufu_linwei'] });
    // 吕姬攻击拉高到全队第一
    lvji.general.attack = 500;
    const ally = makeUnit(dummy('ally-low', '前锋', { attack: 100 }));
    const foes = [makeUnit(dummy('foe-a', '前锋'), 'enemy')];
    const ctx = makeCtx([ally, lvji], foes, 7);
    triggerActiveSkill(ctx, lvji, forcedSkill(), foes, [lvji], foes);
    expect(boostOf(lvji)?.type).toBe('damage_boost');
    expect(boostOf(ally)).toBeUndefined();
  });

  it('② 下两次「进行攻击」+30% 且逐次消耗；策略伤害不吃（attackOnly）', () => {
    const run = (withBoost: boolean, skill: Skill) => {
      const atk = makeUnit(dummy('atk', '前锋', { attack: 200 }));
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([atk], [foe], 11);
      ctx.skills.set(skill.id, skill);
      if (withBoost) {
        inflictStatus(
          ctx,
          atk,
          { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused', charges: 2, attackOnly: true },
          'active',
          'fufu_linwei',
        );
      }
      triggerActiveSkill(ctx, atk, skill, [foe], [atk], [foe]);
      const d = eventsOf(ctx, 'damage')[0];
      return { d, atk };
    };

    // 物理攻击：吃 +30%（同种子同 RNG 消耗，可精确对比）
    const plain = run(false, PHYS);
    const boosted = run(true, PHYS);
    const expected = (plain.d!.damage - plain.d!.breakdown.troopBase) * 0.3;
    expect(Math.abs((boosted.d!.damage - plain.d!.damage) - expected)).toBeLessThanOrEqual(2);
    // 消耗 1 次（charges 2 → 1）
    expect((boostOf(boosted.atk) as { charges?: number } | undefined)?.charges).toBe(1);

    // 策略伤害：不吃（attackOnly 过滤），charges 不变
    const strat = run(true, STRAT);
    expect(strat.d?.damage).toBe(run(false, STRAT).d?.damage);
    expect((boostOf(strat.atk) as { charges?: number } | undefined)?.charges).toBe(2);
  });

  it('③ 吕布：两张卡（h3 汉骑 / h479 群弓）都获得「下一次伤害无视规避」；队里无吕布时空转', () => {
    for (const lvbuId of ['h3', 'h479']) {
      const lvji = heroUnit('h634', '大营', { activeSkillIds: ['fufu_linwei'] });
      const lvbu = heroUnit(lvbuId, '前锋', {});
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([lvbu, lvji], [foe], 13);
      triggerActiveSkill(ctx, lvji, forcedSkill(), [foe], [lvji], [foe]);
      expect(lvbu.general.name).toBe('吕布');
      expect(ignoreEvasionOf(lvbu)?.type).toBe('ignore_evasion');
    }

    // 队里无吕布 → 该段空转（不报错、无人获得标记）
    const { lvji, bruiser, foes, ctx } = setup(13);
    triggerActiveSkill(ctx, lvji, forcedSkill(), foes, [lvji], foes);
    expect(ignoreEvasionOf(bruiser)).toBeUndefined();
    expect(eventsOf(ctx, 'status_inflicted').some((e) => e.statusType === 'ignore_evasion')).toBe(false);
  });

  it('③ 生效：吕布打带规避的敌人不再被规避，且标记消耗；对照无标记时被规避', () => {
    const run = (withMark: boolean) => {
      const lvbu = makeUnit(dummy('lvbu', '前锋', { name: '吕布', attack: 200 }));
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([lvbu], [foe], 17);
      ctx.skills.set(PHYS.id, PHYS);
      // 敌人带 1 层必挡规避
      inflictStatus(ctx, foe, { type: 'evasion', stacks: 1 }, 'active', 'test_evasion');
      if (withMark) {
        lvbu.statuses.push({
          type: 'ignore_evasion',
          appliedRound: 1,
          sourceSkillType: 'active',
          sourceSkillId: 'fufu_linwei',
          sourceUnitId: lvbu.general.id,
        });
      }
      triggerActiveSkill(ctx, lvbu, PHYS, [foe], [lvbu], [foe]);
      return { ctx, lvbu, foe };
    };

    const marked = run(true);
    expect(eventsOf(marked.ctx, 'evasion_blocked')).toHaveLength(0); // 无视规避
    expect(eventsOf(marked.ctx, 'damage')).toHaveLength(1); // 伤害正常打出
    expect(ignoreEvasionOf(marked.lvbu)).toBeUndefined(); // 已消耗
    expect(foe0Troops(marked.foe)).toBe(true);

    const plain = run(false);
    expect(eventsOf(plain.ctx, 'evasion_blocked')).toHaveLength(1); // 对照：被规避
    expect(eventsOf(plain.ctx, 'damage')).toHaveLength(0);
  });

  it('整场战斗：缚父临危造成伤害并施加两类状态', () => {
    const lvji = { ...withSkills(level40(HERO_REGISTRY['h634']), { activeSkillIds: ['fufu_linwei'] }), position: '大营' as Position };
    const lvbu = { ...level40(HERO_REGISTRY['h479']), position: '前锋' as Position };
    const report = runBattle({
      seed: 61,
      maxRounds: 8,
      myTeam: [lvbu, dummy('ally-b', '中军'), lvji],
      enemyTeam: [dummy('foe-a', '前锋'), dummy('foe-b', '中军'), dummy('foe-c', '大营')],
    });
    const dmg = report.events.filter((e) => e.type === 'damage' && e.skillId === 'fufu_linwei');
    expect(dmg.length).toBeGreaterThan(0);
    const inflicted = report.events.filter(
      (e) =>
        e.type === 'status_inflicted' &&
        (e.statusType === 'damage_boost' || e.statusType === 'ignore_evasion'),
    );
    expect(inflicted.length).toBeGreaterThan(0);
  });
});

/** 便利断言：该单位已扣兵 */
function foe0Troops(u: UnitState): boolean {
  return u.troops < u.general.maxTroops;
}
