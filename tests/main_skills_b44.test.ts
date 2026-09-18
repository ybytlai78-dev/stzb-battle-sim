/**
 * 三军夺帅（杜预·晋弓 h705 主战法）：被动 S，距离 5，目标自己。
 * 自身每成功发动普通攻击、主动及追击战法后，随机二选一（用户确认「或」= 每次触发 50/50）：
 *  ① 对距离 5 以内敌军单体发动一次攻击（180%）并使自身攻击属性提高 10；
 *  ② 对敌军群体 2 目标发动一次策略攻击（100%，受谋略属性影响）并使目标谋略属性降低 5；
 * 属性变化可叠加，持续到战斗结束。
 * 官方：scripts/skill_extra.json id 200987（被动 S / 距离 5 / 自己 / 弓；1 级 90% / 10 / 50% / 5）。
 * 策略段「受谋略属性影响」成长率未确认 → 按基值（strategyScaled 在、growthRate 缺）→ 杜预下架。
 * 引擎配套：`PassiveSkill.afterAct`（普攻/主动/追击后统一钩子）+ 复用 `random_pick` 二选一
 * + `inflict_status.sameTargetsAsLastDamage`（谋略 −5 打在策略段同一批目标上）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  effectiveStat,
  triggerActiveSkill,
  triggerPassiveAfterAct,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
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

function heroGeneral(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): General {
  return { ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position };
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): UnitState {
  return makeUnit(heroGeneral(heroId, position, skills));
}

/** 发动率可控的主动战法（只用来触发 afterAct，不关心自身效果） */
function activeSkill(id: string, triggerRate: number): Skill {
  return {
    id,
    name: '测试主动',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 50 }],
  } as Skill;
}

/** 取三军夺帅的某一条分支（① / ②），用于确定性断言 */
function branchOption(index: 0 | 1): SkillOutput[] {
  const s = SKILL_REGISTRY['sanjun_duoshuai'];
  if (s.type !== 'passive') throw new Error('三军夺帅应为被动');
  const pick = s.afterAct?.output[0];
  if (pick?.kind !== 'random_pick') throw new Error('三军夺帅 afterAct 首段应为 random_pick');
  return pick.options[index];
}

/** 注册一个只走单分支的克隆被动（绕过 random_pick 的 50/50） */
function singleBranchPassive(id: string, index: 0 | 1): Skill {
  const s = structuredClone(SKILL_REGISTRY['sanjun_duoshuai']) as Skill;
  s.id = id;
  if (s.type !== 'passive' || !s.afterAct) throw new Error('克隆失败');
  const pick = s.afterAct.output[0];
  if (pick.kind !== 'random_pick') throw new Error('克隆失败');
  pick.options = [branchOption(index)];
  return s;
}

function casts(ctx: CombatContext, skillId = 'sanjun_duoshuai') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
      e.type === 'skill_cast' && e.skillId === skillId,
  );
}

describe('三军夺帅（杜预 h705）', () => {
  it('装配：注册表定义（三来源钩子 + 50/50 二选一）+ h705 挂槽 + 策略段受谋略下架', () => {
    const hero = HERO_REGISTRY['h705'];
    expect(hero.name).toBe('杜预');
    expect(hero.mainSkillName).toBe('三军夺帅');

    const s = SKILL_REGISTRY['sanjun_duoshuai'];
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(s.output).toEqual([]); // 战斗开始无效果，全部走 afterAct

    const pick = s.afterAct?.output[0];
    expect(pick?.kind).toBe('random_pick');
    if (pick?.kind !== 'random_pick') return;
    expect(pick.count).toBe(1);
    expect(pick.options).toHaveLength(2);
    // ① 距离 5 以内敌军单体攻击 180% + 自身攻击 +10
    expect(pick.options[0][0]).toMatchObject({
      kind: 'physical_damage',
      rate: 180,
      targetMode: 'random_single',
    });
    expect(pick.options[0][1]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'attack_buff', amount: 10, duration: 999 },
    });
    // ② 敌军群体 2 目标策略 100% + 同批目标谋略 −5
    expect(pick.options[1][0]).toMatchObject({
      kind: 'strategy_damage',
      rate: 100,
      strategyScaled: true,
      targetMode: 'group',
      groupCount: 2,
    });
    expect(pick.options[1][1]).toMatchObject({
      kind: 'inflict_status',
      sameTargetsAsLastDamage: true,
      status: { type: 'strategy_buff', amount: -5, duration: 999 },
    });

    expect(OFFLINE_MAIN_SKILLS['sanjun_duoshuai']).toBeTruthy();
    expect(isHeroListed({ mainSkillId: 'sanjun_duoshuai' })).toBe(false);
  });

  it('触发条件：主动战法「成功发动」后触发；未发动（几率 0）不触发', () => {
    const duyu = heroUnit('h705', '大营', { passiveSkillIds: ['sanjun_duoshuai'] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');

    // 发动率 100% → 触发
    const ctx = makeCtx([duyu], [foe], 5);
    triggerActiveSkill(ctx, duyu, activeSkill('t_hit', 1), [foe], [duyu], [foe]);
    expect(casts(ctx)).toHaveLength(1);

    // 发动率 0 → 未发动，不触发
    const duyu2 = heroUnit('h705', '大营', { passiveSkillIds: ['sanjun_duoshuai'] });
    const foe2 = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx2 = makeCtx([duyu2], [foe2], 5);
    triggerActiveSkill(ctx2, duyu2, activeSkill('t_miss', 0), [foe2], [duyu2], [foe2]);
    expect(casts(ctx2)).toHaveLength(0);
  });

  it('普攻与追击：一次行动内普攻触发 1 次、追击成功再触发 1 次', () => {
    const duyu = heroUnit('h705', '前锋', {
      passiveSkillIds: ['sanjun_duoshuai'],
      pursuitSkillIds: ['t_pursuit'],
    });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([duyu], [foe], 7);
    // 追击战法拉满发动率（简化输出，避免混乱等干扰）
    ctx.skills.set('t_pursuit', {
      ...(structuredClone(SKILL_REGISTRY['fangzhen_tuji']) as Skill),
      id: 't_pursuit',
      triggerRate: 1,
      output: [{ kind: 'physical_damage', rate: 60 }],
    } as Skill);

    actUnit(ctx, duyu);
    // 普攻（含规避命中）1 次 + 追击成功 1 次
    expect(casts(ctx)).toHaveLength(2);
  });

  it('50/50 二选一：单次触发只走一条分支，多种子下两条都出现', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const duyu = heroUnit('h705', '大营', { passiveSkillIds: ['sanjun_duoshuai'] });
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([duyu], [foe], seed);
      triggerActiveSkill(ctx, duyu, activeSkill('t_hit', 1), [foe], [duyu], [foe]);

      const types = new Set(
        ctx.events
          .filter(
            (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
              e.type === 'status_inflicted',
          )
          .map((e) => e.statusType),
      );
      const branchA = types.has('attack_buff');
      const branchB = types.has('strategy_buff');
      expect(branchA !== branchB).toBe(true); // 同一次触发不会两支都走
      seen.add(branchA ? 'A' : 'B');
    }
    expect(seen.size).toBe(2); // 24 次里两条分支都出现过
  });

  it('策略段：谋略 −5 只落在本段策略伤害的同一批目标上（不重新选敌）', () => {
    const duyu = heroUnit('h705', '大营', { passiveSkillIds: ['test_b_only'] });
    const foes = [
      makeUnit(dummy('foe-a', '前锋'), 'enemy'),
      makeUnit(dummy('foe-b', '中军'), 'enemy'),
      makeUnit(dummy('foe-c', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([duyu], foes, 9);
    ctx.skills.set('test_b_only', singleBranchPassive('test_b_only', 1));

    triggerPassiveAfterAct(ctx, duyu);

    const damaged = new Set(
      ctx.events
        .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage')
        .map((e) => e.targetId),
    );
    const debuffed = new Set(
      ctx.events
        .filter(
          (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
            e.type === 'status_inflicted' && e.statusType === 'strategy_buff',
        )
        .map((e) => e.unitId),
    );
    expect(damaged.size).toBe(2); // 群体 2 目标
    expect(debuffed.size).toBe(2);
    expect([...debuffed].sort()).toEqual([...damaged].sort());
  });

  it('属性叠加：同分支连续触发累加（攻击 +10 → +20），持续至战斗结束', () => {
    const duyu = heroUnit('h705', '大营', { passiveSkillIds: ['test_a_only'] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([duyu], [foe], 13);
    ctx.skills.set('test_a_only', singleBranchPassive('test_a_only', 0));

    const before = effectiveStat(duyu, 'attack');
    triggerPassiveAfterAct(ctx, duyu);
    expect(effectiveStat(duyu, 'attack') - before).toBe(10);
    triggerPassiveAfterAct(ctx, duyu);
    expect(effectiveStat(duyu, 'attack') - before).toBe(20); // 可叠加

    // 属性 buff 的 detail 用「(生效值)」口径，时长看状态本身：远超 8 回合 = 持续至战斗结束
    const buff = duyu.statuses.find((s) => s.type === 'attack_buff');
    expect(buff?.remaining ?? 0).toBeGreaterThan(8);
  });

  it('整场战斗：三军夺帅随普攻/主动/追击多次触发，属性随战斗累积', () => {
    const duyu = heroGeneral('h705', '前锋', {
      passiveSkillIds: ['sanjun_duoshuai'],
    });
    const report = runBattle({
      seed: 21,
      maxRounds: 8,
      myTeam: [duyu, dummy('ally-b', '中军'), dummy('ally-c', '大营')],
      enemyTeam: [dummy('foe-a', '前锋'), dummy('foe-b', '中军'), dummy('foe-c', '大营')],
    });

    const triggered = report.events.filter(
      (e) => e.type === 'skill_cast' && e.skillId === 'sanjun_duoshuai',
    );
    expect(triggered.length).toBeGreaterThan(0);
    // 三军夺帅造成的伤害归属本战法
    const dmg = report.events.filter(
      (e) => e.type === 'damage' && e.skillId === 'sanjun_duoshuai',
    );
    expect(dmg.length).toBeGreaterThan(0);
  });
});
