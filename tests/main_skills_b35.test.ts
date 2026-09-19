/**
 * 举贤决机（荀彧·魏步 h794 主战法）：指挥 S，距离 5，敌我全体。
 * 首回合起，我军全体在被成功施加属性「提升」效果前，有 40% 几率使其恢复一定兵力（恢复率 60%，受谋略）；
 * 敌军全体在被成功施加属性「下降」效果前，有 40% 几率对其造成一次策略伤害（伤害率 100%，受谋略）；
 * 每种属性单独计算。
 * 官方：scripts/skill_extra.json id 200269（满级 60% / 100%，1 级 30% / 50%）。
 * 引擎配套：新增 `CommandSkill.onAttrChange`（属性升降「之前」判定，inflictStatus 内、冲突判定之前触发）。
 * 成长率：「受谋略属性影响」两处未确认 → 留空（heal 的 growthRate 必填 → 0；策略伤害不给 growthRate）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { inflictStatus, triggerCommandSkills, type CombatContext, type LockedCommand } from '../src/engine/action';
import { calcHealAmount } from '../src/engine/formulas';
import type { BattleEvent, CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
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
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 10000,
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
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

/** 克隆举贤决机并把两条规则的触发率改成 1（确定性单测），注册为已锁定指挥。 */
function lockJuxian(ctx: CombatContext, caster: UnitState, rate = 1): void {
  const cloned = structuredClone(SKILL_REGISTRY['juxian_jueji']) as CommandSkill;
  cloned.onAttrChange = (cloned.onAttrChange ?? []).map((r) => ({ ...r, rate }));
  const locked: LockedCommand = {
    skill: cloned,
    casterId: caster.general.id,
    targets: ctx.myTeam,
    currentRate: 1,
  };
  ctx.lockedCommands.push(locked);
}

function healEvents(ctx: CombatContext, skillId = 'juxian_jueji') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === skillId,
  );
}

function dmgEvents(ctx: CombatContext, skillId = 'juxian_jueji') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

function triggers(ctx: CombatContext, skillId = 'juxian_jueji') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId,
  );
}

describe('举贤决机（荀彧 h794）', () => {
  it('装配：注册表定义 + 挂槽名（指挥 S / 距离 5 / 敌我全体两条规则）', () => {
    const hero = HERO_REGISTRY['h794'];
    expect(hero.name).toBe('荀彧');
    expect(hero.mainSkillName).toBe('举贤决机');

    const s = SKILL_REGISTRY['juxian_jueji'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(1);
    expect([...s.tags].sort()).toEqual(['damage', 'heal']);
    expect(s.output).toEqual([]);
    expect(s.onAttrChange).toHaveLength(2);
    expect(s.onAttrChange?.[0]).toMatchObject({
      victim: 'ally',
      sign: 'up',
      rate: 0.4,
      output: [{ kind: 'heal', rate: 60, strategyScaled: true, growthRate: 0 }],
    });
    expect(s.onAttrChange?.[1]).toMatchObject({
      victim: 'enemy',
      sign: 'down',
      rate: 0.4,
      output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: true }],
    });
    const strat = s.onAttrChange?.[1].output[0];
    if (strat?.kind === 'strategy_damage') expect(strat.growthRate).toBeUndefined();
  });

  it('一类指挥：准备阶段只登记锁定目标，不立刻结算任何效果', () => {
    const caster = heroUnit('h794', '中军', { commandSkillIds: ['juxian_jueji'] });
    const ally = makeUnit(dummy('ally-front', '前锋'));
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([caster, ally], [foe]);

    triggerCommandSkills(ctx, caster);

    expect(ctx.lockedCommands).toHaveLength(1);
    expect(ctx.lockedCommands[0].skill.id).toBe('juxian_jueji');
    expect(ctx.lockedCommands[0].casterId).toBe('h794');
    expect(ctx.events.some((e) => e.type === 'heal')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'damage')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === 'juxian_jueji')).toBe(true);
  });

  it('双向触发：我军被加属性 → 恢复；敌军被降属性 → 策略伤害；反向不触发', () => {
    const caster = heroUnit('h794', '中军', { commandSkillIds: ['juxian_jueji'] });
    const ally = makeUnit(dummy('ally-front', '前锋'));
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([caster, ally], [foe]);
    lockJuxian(ctx, caster, 1); // 强制必触发

    // 反例先行：我军被「下降」、敌军被「提升」都不该有反应
    inflictStatus(ctx, ally, { type: 'attack_buff', amount: -10, duration: 1 }, 'active', 'probe', caster.general.id);
    inflictStatus(ctx, foe, { type: 'attack_buff', amount: 10, duration: 1 }, 'active', 'probe', caster.general.id);
    expect(healEvents(ctx)).toHaveLength(0);
    expect(dmgEvents(ctx)).toHaveLength(0);

    // 正例：我军被提升 → 恢复（恢复率 60% 基值，恢复量按施法者兵力）
    ally.troops = 6000;
    inflictStatus(ctx, ally, { type: 'strategy_buff', amount: 20, duration: 1 }, 'active', 'probe', caster.general.id);
    const heals = healEvents(ctx);
    expect(heals).toHaveLength(1);
    expect(heals[0].targetId).toBe('ally-front');
    expect(heals[0].amount).toBe(calcHealAmount(caster.troops, 60));

    // 正例：敌军被下降 → 策略伤害
    inflictStatus(ctx, foe, { type: 'defense_buff', amount: -20, duration: 1 }, 'active', 'probe', caster.general.id);
    const dmgs = dmgEvents(ctx);
    expect(dmgs).toHaveLength(1);
    expect(dmgs[0].targetId).toBe('foe');
    expect(dmgs[0].damageType).toBe('strategy');
    expect(dmgs[0].damage).toBeGreaterThan(0);
    // 判定事件带被施加者
    expect(triggers(ctx).map((t) => t.targetId)).toEqual(['ally-front', 'foe']);
  });

  it('每种属性单独计算：一次同施四维提升 → 4 次独立判定', () => {
    const caster = heroUnit('h794', '中军', { commandSkillIds: ['juxian_jueji'] });
    const ally = makeUnit(dummy('ally-front', '前锋'));
    const ctx = makeCtx([caster, ally], [makeUnit(dummy('foe', '前锋'), 'enemy')]);
    lockJuxian(ctx, caster, 1);
    ally.troops = 6000; // 预留兵力缺口，恢复才能落地（recoverTroops 受兵力上限截断）

    for (const type of ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'] as const) {
      inflictStatus(ctx, ally, { type, amount: 10, duration: 1 }, 'active', 'probe', caster.general.id);
    }

    expect(triggers(ctx)).toHaveLength(4);
    expect(healEvents(ctx)).toHaveLength(4);
    expect(new Set(triggers(ctx).map((t) => t.targetId))).toEqual(new Set(['ally-front']));
  });

  it('判定几率走施法者士气：士气 120 → 40% × 1.12 = 45%', () => {
    const caster = heroUnit('h794', '中军', { commandSkillIds: ['juxian_jueji'] }, { morale: 120 });
    const ally = makeUnit(dummy('ally-front', '前锋'));
    const ctx = makeCtx([caster, ally], [makeUnit(dummy('foe', '前锋'), 'enemy')]);
    lockJuxian(ctx, caster, 0.4); // 保留官方 40%

    inflictStatus(ctx, ally, { type: 'attack_buff', amount: 10, duration: 1 }, 'active', 'probe', caster.general.id);

    const t = triggers(ctx)[0];
    expect(t).toBeTruthy();
    expect(t.baseRate).toBe(40);
    expect(t.rate).toBe(45);
    expect(t.morale).toBe(120);
  });

  it('成长率留空：谋略 80 与 300 的恢复量相同（恢复率 60% 不缩放）', () => {
    const healAt = (strategy: number) => {
      const caster = heroUnit('h794', '中军', { commandSkillIds: ['juxian_jueji'] }, { strategy });
      const ally = makeUnit(dummy('ally-front', '前锋'));
      const ctx = makeCtx([caster, ally], [makeUnit(dummy('foe', '前锋'), 'enemy')]);
      lockJuxian(ctx, caster, 1);
      ally.troops = 6000;
      inflictStatus(ctx, ally, { type: 'attack_buff', amount: 10, duration: 1 }, 'active', 'probe', caster.general.id);
      return healEvents(ctx)[0]?.amount;
    };
    expect(healAt(80)).toBe(calcHealAmount(9000, 60));
    expect(healAt(300)).toBe(calcHealAmount(9000, 60));
  });
});
