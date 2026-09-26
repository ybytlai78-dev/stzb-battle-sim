/**
 * 奉令护蜀（马岱·蜀骑 h615 主战法）：被动 A，距离 2，目标自己。
 * 战斗中，任意友军发动普通攻击、主动战法、追击战法后，马岱的下 1 次普通攻击造成的伤害提升 35.0%
 * （受攻击属性影响），下 1 次受到的所有伤害降低 20.0%（受防御属性影响），以上效果可叠加 5 次。
 * 官方：scripts/skill_extra.json id 200865（被动 A / 距离 2 / 自己 / 兵种骑；1 级 17.5% / 10.0%）。
 * 口径（用户确认）：层数上限 5；攻击段与减伤段**共用同一层数**、都 = 基值 × 层数，
 *   各自在对应时机（普攻打出后 / 首次受击实际扣兵后）**清空全部层数**。
 * 口径（本次推定，待复核）：「任意友军」含马岱自身（沿用徽言龙凤「友军全体」含己的先例）。
 * 成长率：35% 受攻击、20% 受防御 两段成长率未确认 → 按基值 → 马岱下架。
 * 引擎配套：`PassiveSkill.allyActStacks`（友军成功发动后叠层）+ 新状态 `pending_stacks`。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  triggerActHooks,
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

/** 直接挂 n 层待发（等价于友军已叠 n 层；不走 RNG，便于精确对比伤害） */
function pushLayers(unit: UnitState, n: number): void {
  unit.statuses.push({
    type: 'pending_stacks',
    stacks: n,
    maxStacks: 5,
    perLayerBoost: 0.35,
    perLayerReduce: 0.2,
    appliedRound: 1,
    sourceSkillType: 'passive',
    sourceSkillId: 'fengling_hushu',
    sourceUnitId: unit.general.id,
  });
}

function layerStatus(unit: UnitState) {
  return unit.statuses.find((s) => s.type === 'pending_stacks');
}

function physicalSkill(id: string): Skill {
  return {
    id,
    name: '测试攻击',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
  } as Skill;
}

describe('奉令护蜀（马岱 h615）', () => {
  it('装配：注册表定义（叠层上限 5 / 每层 35% 增伤 + 20% 减伤）+ h615 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h615'];
    expect(hero.name).toBe('马岱');
    expect(hero.mainSkillName).toBe('奉令护蜀');

    const s = SKILL_REGISTRY['fengling_hushu'];
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(2);
    expect(s.targetMode).toBe('self');
    expect(s.output).toEqual([]);
    expect(s.allyActStacks).toEqual({
      maxStacks: 5,
      boostRate: 0.35,
      boostAttackScaled: true,
      reduceRate: 0.2,
      reduceDefenseScaled: true,
    });

    // 35% 受攻击 / 20% 受防御 成长率未确认 → 登记下架
    expect(OFFLINE_MAIN_SKILLS['fengling_hushu']).toBeTruthy();
    expect(isHeroListed({ mainSkillId: 'fengling_hushu' })).toBe(false);
  });

  it('叠层：友军每次成功发动 +1 层（含主动战法路径），上限 5 层', () => {
    const mada = heroUnit('h615', '大营', { passiveSkillIds: ['fengling_hushu'] });
    const ally = makeUnit(dummy('ally', '前锋'));
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([ally, mada], [foe], 3);

    // 友军成功发动主动战法 → 马岱 +1 层
    triggerActiveSkill(ctx, ally, physicalSkill('t_ally'), [foe], [ally, mada], [foe]);
    expect((layerStatus(mada) as { stacks?: number } | undefined)?.stacks).toBe(1);

    // 再叠 6 次 → 封顶 5 层
    for (let i = 0; i < 6; i++) triggerActHooks(ctx, ally);
    expect((layerStatus(mada) as { stacks?: number } | undefined)?.stacks).toBe(5);
  });

  it('友军普攻路径也会叠层（actUnit 真实行动）', () => {
    const mada = heroUnit('h615', '大营', { passiveSkillIds: ['fengling_hushu'] });
    const ally = makeUnit(dummy('ally', '前锋'));
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([ally, mada], [foe], 3);

    actUnit(ctx, ally);
    // 友军一次行动：普攻 1 次 → 马岱 1 层
    expect((layerStatus(mada) as { stacks?: number } | undefined)?.stacks).toBe(1);
  });

  it('下次普攻增伤 = 35% × 层数，且普攻打出后清空全部层数', () => {
    const run = (layers: number) => {
      const mada = heroUnit('h615', '前锋', { passiveSkillIds: ['fengling_hushu'] });
      if (layers > 0) pushLayers(mada, layers);
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([mada], [foe], 17);
      actUnit(ctx, mada); // 普攻（距离 1）
      const dmg = ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit',
      );
      return { dmg, mada };
    };

    const plain = run(0);
    const boosted = run(3);
    expect(plain.dmg?.damage ?? 0).toBeGreaterThan(0);
    // troopBase（兵力基础）不乘 mult：增量 = (基线伤害 − troopBase) × 35% × 3
    // （马岱骑兵攻步兵 = 克制方，无兵种相克惩罚 → 基线 mult = 1）
    const expectedDelta = (plain.dmg!.damage - plain.dmg!.breakdown.troopBase) * 0.35 * 3;
    expect(Math.abs((boosted.dmg!.damage - plain.dmg!.damage) - expectedDelta)).toBeLessThanOrEqual(2);

    // 攻击打出后清空全部层数（两段共用计数器）；「任意友军」不含自身 → 不会被自己补层
    expect(layerStatus(boosted.mada)).toBeUndefined();
  });

  it('下次受击减伤 = 20% × 层数，且实际扣兵后清空全部层数', () => {
    const run = (layers: number) => {
      const mada = heroUnit('h615', '前锋', { passiveSkillIds: ['fengling_hushu'] });
      if (layers > 0) pushLayers(mada, layers);
      const foe = makeUnit(dummy('foe', '前锋', { attack: 150, troopType: 'cavalry' }), 'enemy');
      const ctx = makeCtx([mada], [foe], 23);
      triggerActiveSkill(ctx, foe, physicalSkill('t_foe'), [mada], [foe], [mada]);
      const dmg = ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage',
      );
      return { dmg, mada };
    };

    const plain = run(0);
    const reduced = run(3);
    expect(plain.dmg?.damage ?? 0).toBeGreaterThan(0);
    const expectedDrop = (plain.dmg!.damage - plain.dmg!.breakdown.troopBase) * 0.2 * 3;
    expect(Math.abs((plain.dmg!.damage - reduced.dmg!.damage) - expectedDrop)).toBeLessThanOrEqual(2);

    // 实际扣兵后清空全部层数
    expect(layerStatus(reduced.mada)).toBeUndefined();
    // 对照：未叠层时状态本就不存在
    expect(layerStatus(plain.mada)).toBeUndefined();
  });

  it('整场战斗（8 回合）：叠层出现且能积累到 5/5，不按回合递减', () => {
    const mada = heroGeneral('h615', '前锋', { passiveSkillIds: ['fengling_hushu'] });
    const report = runBattle({
      seed: 31,
      maxRounds: 8,
      myTeam: [mada, dummy('ally-b', '中军'), dummy('ally-c', '大营')],
      enemyTeam: [dummy('foe-a', '前锋'), dummy('foe-b', '中军'), dummy('foe-c', '大营')],
    });

    const layered = report.events.filter(
      (e) =>
        e.type === 'status_inflicted' &&
        e.statusType === 'pending_stacks' &&
        e.unitId === 'h615',
    );
    expect(layered.length).toBeGreaterThan(0);
    // 跨回合累积（未触发消耗时不被回合递减）：至少叠到 2/5
    const stackCounts = layered.map((e) => Number(/(\d)\/5/.exec((e as { detail?: string }).detail ?? '')?.[1] ?? 0));
    expect(Math.max(...stackCounts)).toBeGreaterThanOrEqual(2);
    // 被普攻 / 受击消耗过
    const cleared = report.events.filter(
      (e) => e.type === 'status_expired' && e.statusType === 'pending_stacks',
    );
    expect(cleared.length).toBeGreaterThan(0);
  });
});
