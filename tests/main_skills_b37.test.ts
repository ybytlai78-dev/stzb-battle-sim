/**
 * 霸王渡江（孙策·吴骑 h450 主战法）：被动 A，距离 5，敌军单体。
 * 每回合有 40% 的几率对有效距离 5 以内的敌军单体发动三次猛烈攻击（伤害率 150%），每次攻击目标独立判定；
 * 本场战斗中自身无法发动主动战法；每次攻击造成伤害后可使霸王渡江发动率提升 3%，该效果可叠加 5 次。
 * 官方：scripts/skill_extra.json id 200771（官网两版本拼接 → 按仓库口径只用前半 3%/层）。
 * 全文无「受 XX 属性影响」→ 不登记下架（孙策上架）。
 * 引擎配套：新增 `chanceBoostPerDamage`（按造成伤害次数递增 chance_group 基础率）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, triggerPassiveSkills, type CombatContext } from '../src/engine/action';
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
    faction: '吴',
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

function forceSkill(ctx: CombatContext, id: string, patch: (s: Skill) => void): void {
  const cloned = structuredClone(SKILL_REGISTRY[id]) as Skill;
  patch(cloned);
  ctx.skills.set(id, cloned);
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

function damages(ctx: CombatContext, skillId = 'bawang_dujiang') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

function triggers(ctx: CombatContext, skillId = 'bawang_dujiang') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId,
  );
}

/** 孙策 + 3 木桩；被动 roundStartRepeat 的 40% 判定强制为必中，其余行为照旧。 */
function setup(maxStacks = 5, seed = 1) {
  const me = heroUnit('h450', '中军', { passiveSkillIds: ['bawang_dujiang'] });
  const foes = [
    makeUnit(dummy('e-front', '前锋'), 'enemy'),
    makeUnit(dummy('e-mid', '中军'), 'enemy'),
    makeUnit(dummy('e-camp', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([me], foes, seed);
  forceSkill(ctx, 'bawang_dujiang', (s) => {
    if (s.type === 'passive' && s.roundStartRepeat) {
      const group = s.roundStartRepeat.output[0];
      if (group.kind === 'chance_group') group.chance = 1; // 强制发动，便于逐层观察
    }
    s.chanceBoostPerDamage = { increment: 0.03, maxStacks };
  });
  return { me, foes, ctx };
}

describe('霸王渡江（孙策 h450）', () => {
  it('装配：注册表定义 + 挂槽名（被动 A / 距离 5 / 敌军单体 / 每回合 40% 三连击）', () => {
    const hero = HERO_REGISTRY['h450'];
    expect(hero.name).toBe('孙策');
    expect(hero.mainSkillName).toBe('霸王渡江');

    const s = SKILL_REGISTRY['bawang_dujiang'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(5);
    expect([...s.tags].sort()).toEqual(['damage', 'hesitation']);
    expect(s.chanceBoostPerDamage).toEqual({ increment: 0.03, maxStacks: 5 });
    // 自身犹豫（本场无法发动主动战法）
    expect(s.output[0]).toMatchObject({ kind: 'inflict_status', status: { type: 'hesitation', duration: 999 } });
    // 每回合 40% 三连击，每次独立选目标
    const group = s.roundStartRepeat?.output[0];
    expect(group).toMatchObject({ kind: 'chance_group', chance: 0.4 });
    if (group?.kind === 'chance_group') {
      expect(group.outputs[0]).toMatchObject({
        kind: 'physical_damage',
        rate: 150,
        targetMode: 'random_single',
        repeats: 3,
      });
    }
  });

  it('可上架：全文无「受属性影响」→ 不在未确认成长名单', () => {
    expect(isHeroListed({ mainSkillId: 'bawang_dujiang' })).toBe(true);
  });

  it('开战：自身被施加犹豫（持续至战斗结束），被动/指挥不受影响', () => {
    const me = heroUnit('h450', '中军', { passiveSkillIds: ['bawang_dujiang'] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([me], [foe]);
    triggerPassiveSkills(ctx, me, 'battle_start'); // 准备阶段 battle_start 被动
    const hes = me.statuses.find((s) => s.type === 'hesitation');
    expect(hes).toBeTruthy();
    expect(hes && 'remaining' in hes ? hes.remaining : 0).toBeGreaterThanOrEqual(999);
  });

  it('每回合判定三次攻击，每次独立选目标（多目标分布）', () => {
    const { me, foes, ctx } = setup();
    actUnit(ctx, me); // 行动阶段的 roundStartRepeat
    const dmg = damages(ctx);
    expect(dmg).toHaveLength(3);
    expect(dmg.every((d) => d.damageType === 'physical')).toBe(true);
    // 三次攻击命中不同目标（1 次行动内 spread 到多个木桩）
    const hitIds = new Set(dmg.map((d) => d.targetId));
    expect(hitIds.size).toBeGreaterThanOrEqual(1);
    expect([...hitIds].every((id) => foes.some((f) => f.general.id === id))).toBe(true);
  });

  it('每次造成伤害后发动率 +3%，最多 5 层（40% → 55%）', () => {
    const { me, ctx } = setup(5);
    for (let round = 1; round <= 4; round++) {
      ctx.currentRound = round;
      actUnit(ctx, me);
    }
    // 每次行动 3 次攻击 → 每回合 +3 层，第 2 回合即封顶 5 层
    expect(ctx.skillDamageCounters?.get('h450:bawang_dujiang')).toBe(5);

    /** 预置层数后，读一次判定的基础率（士气 100 → 系数 1） */
    const baseRateWithStacks = (stacks: number) => {
      const me2 = heroUnit('h450', '中军', { passiveSkillIds: ['bawang_dujiang'] });
      const ctx2 = makeCtx([me2], [makeUnit(dummy('foe', '前锋'), 'enemy')], 3);
      ctx2.skillDamageCounters = new Map([['h450:bawang_dujiang', stacks]]);
      actUnit(ctx2, me2);
      return triggers(ctx2)[0]?.baseRate;
    };
    expect(baseRateWithStacks(0)).toBe(40);
    expect(baseRateWithStacks(3)).toBe(49);
    expect(baseRateWithStacks(5)).toBe(55);
    expect(baseRateWithStacks(99)).toBe(55); // 封顶
  });

  it('整场跑通（runBattle）：出现三次一组的攻击与发动率递增判定', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h450']), { passiveSkillIds: ['bawang_dujiang'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 6,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), leader, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-camp', '大营')],
    });
    const trig = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'bawang_dujiang',
    );
    expect(trig.length).toBeGreaterThan(0);
    expect(trig.every((t) => t.baseRate !== undefined && t.baseRate >= 40)).toBe(true);
    expect(report.events.filter((e) => e.type === 'damage' && e.skillId === 'bawang_dujiang').length).toBeGreaterThan(0);
  });
});
