/**
 * 西陵克晋（陆抗·吴步 h574 主战法）：指挥 S，距离 4，目标自己，每回合 50% 几率。
 * 使我军当前攻击属性最高的武将对距离 4 以内敌军发动一次攻击（150%），
 * 我军当前谋略属性最高的武将对距离 4 以内敌军发动一次策略攻击（150%，受谋略属性影响），并各自恢复一定兵力。
 * 官方：scripts/skill_extra.json id 200824；官方攻略（stzb.163.com/strategy/zfxq/2019/10/09/21006_836478.html）补充：
 *  - Ⅱ 类指挥战法（每回合行动时判定，混乱/犹豫不阻止执行）→ phase:'round' + roundTrigger:'on_act'；
 *  - 伤害由**代打者自身属性**决定（吃代打者自己的增伤）；
 *  - 恢复为**立即型急救**：与任何恢复类战法不冲突，恢复量与属性无关、仅由执行时自身兵力决定。
 * 口径（本次认定，待复核）：官方文本只有一处 50% → 由二类指挥 triggerRate 承载（dynamicTriggerRate base 0.5），两段同时结算。
 * 恢复率：官方未给 → 取基值 100%（9000 兵力 = 216；与攻略「约 300」有差距，已记入 OFFLINE 说明）。
 * 成长率：谋略段受谋略成长未确认 → 按基值 → 陆抗下架。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { triggerRoundCommandOnAct, type CombatContext } from '../src/engine/action';
import { calcHealAmount } from '../src/engine/formulas';
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

function makeUnit(g: General, side: 'my' | 'enemy' = 'my', troops?: number): UnitState {
  return {
    general: g,
    side,
    troops: troops ?? g.maxTroops,
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
  troops?: number,
): UnitState {
  return makeUnit(
    { ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position },
    'my',
    troops,
  );
}

/** 发动率拉满的二类指挥（去掉 dynamicTriggerRate → 用 triggerRate 1，必发动） */
function forcedCommand(): Skill {
  const s = structuredClone(SKILL_REGISTRY['xiling_kejin']) as Skill;
  s.triggerRate = 1;
  if (s.type === 'command') delete s.dynamicTriggerRate;
  return s;
}

function damages(ctx: CombatContext, skillId = 'xiling_kejin') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

function heals(ctx: CombatContext, skillId = 'xiling_kejin') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === skillId,
  );
}

/** 陆抗 + 攻击最高友军 + 谋略最高友军 + 单个敌军 */
function setup(seed = 3, opts: { attackerAttack?: number; mageStrategy?: number; riderTroops?: number } = {}) {
  const luchen = heroUnit('h574', '大营', { commandSkillIds: ['xiling_kejin'] });
  const bruiser = makeUnit(
    dummy('ally-atk', '前锋', { attack: opts.attackerAttack ?? 300, strategy: 40, troopType: 'infantry' }),
    'my',
    opts.riderTroops,
  );
  const mage = makeUnit(
    dummy('ally-mag', '中军', { attack: 40, strategy: opts.mageStrategy ?? 300, troopType: 'infantry' }),
    'my',
    opts.riderTroops,
  );
  const foe = makeUnit(dummy('foe', '前锋', { troopType: 'infantry' }), 'enemy');
  const ctx = makeCtx([bruiser, mage, luchen], [foe], seed);
  ctx.skills.set('xiling_kejin', forcedCommand());
  return { luchen, bruiser, mage, foe, ctx };
}

describe('西陵克晋（陆抗 h574）', () => {
  it('装配：注册表定义（二类指挥 on_act / 恒定 50% / 两段代打 + 各自恢复）+ h574 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h574'];
    expect(hero.name).toBe('陆抗');
    expect(hero.mainSkillName).toBe('西陵克晋');

    const s = SKILL_REGISTRY['xiling_kejin'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('self');
    // CommandSkill.triggerRate 定型为 1：固定 50% 走 dynamicTriggerRate（increment 0 = 恒定）
    expect(s.triggerRate).toBe(1);
    expect(s.dynamicTriggerRate).toEqual({ base: 0.5, increment: 0 });
    expect(s.output[0]).toMatchObject({
      kind: 'physical_damage',
      rate: 150,
      attacker: 'highest_attack_ally',
      healSource: { rate: 100 },
    });
    expect(s.output[1]).toMatchObject({
      kind: 'strategy_damage',
      rate: 150,
      strategyScaled: true,
      attacker: 'highest_strategy_ally',
      healSource: { rate: 100 },
    });

    expect(OFFLINE_MAIN_SKILLS['xiling_kejin']).toBeTruthy();
    expect(isHeroListed({ mainSkillId: 'xiling_kejin' })).toBe(false);
  });

  it('代打者选取：物理段由攻击最高者出手、策略段由谋略最高者出手，杀伤归属陆抗', () => {
    const { luchen, bruiser, mage, foe, ctx } = setup();
    triggerRoundCommandOnAct(ctx, luchen);

    const dmg = damages(ctx);
    expect(dmg).toHaveLength(2);
    const phys = dmg.find((d) => d.damageType === 'physical')!;
    const strat = dmg.find((d) => d.damageType === 'strategy')!;
    expect(phys.sourceId).toBe(bruiser.general.id); // 攻击最高
    expect(strat.sourceId).toBe(mage.general.id); // 谋略最高
    // 杀伤统计归属施法者（陆抗的西陵克晋）
    expect(phys.creditToId).toBe(luchen.general.id);
    expect(strat.creditToId).toBe(luchen.general.id);
    expect(foe.troops).toBeLessThan(foe.general.maxTroops);
  });

  it('伤害按**代打者自身属性**结算（改变代打者攻击 → 物理段伤害随之变化）', () => {
    const low = setup(5, { attackerAttack: 100 });
    triggerRoundCommandOnAct(low.ctx, low.luchen);
    const lowDmg = damages(low.ctx).find((d) => d.damageType === 'physical')!;

    const high = setup(5, { attackerAttack: 300 });
    triggerRoundCommandOnAct(high.ctx, high.luchen);
    const highDmg = damages(high.ctx).find((d) => d.damageType === 'physical')!;

    expect(highDmg.damage).toBeGreaterThan(lowDmg.damage);
  });

  it('各自恢复：代打者按**自身当前兵力**走恢复公式（5000 兵力 = 176），heal 归属陆抗', () => {
    const { luchen, bruiser, mage, ctx } = setup(7, { riderTroops: 5000 });
    triggerRoundCommandOnAct(ctx, luchen);

    const h = heals(ctx);
    expect(h).toHaveLength(2); // 两段各恢复一次
    const expected = calcHealAmount(5000, 100); // floor(round(300×5000/8500) × 1) = 176
    expect(expected).toBe(176);
    expect(h.every((e) => e.amount === expected)).toBe(true);
    expect(h.every((e) => e.sourceId === luchen.general.id)).toBe(true); // 统计归属施法者
    expect(h.map((e) => e.targetId).sort()).toEqual([bruiser.general.id, mage.general.id].sort());
    expect(bruiser.troops).toBe(5000 + expected);
    expect(mage.troops).toBe(5000 + expected);
    // 立即型急救：不落状态、与恢复类战法不冲突
    expect(bruiser.statuses).toHaveLength(0);
    expect(mage.statuses).toHaveLength(0);
  });

  it('满兵时代打者无兵力缺口 → 不产生 heal 事件（恢复受兵力上限截断）', () => {
    const { luchen, ctx } = setup(9);
    triggerRoundCommandOnAct(ctx, luchen);
    expect(damages(ctx)).toHaveLength(2);
    expect(heals(ctx)).toHaveLength(0);
  });

  it('整场战斗（8 回合）：50% 判定下多次发动，伤害与恢复均出现', () => {
    const luchen = { ...withSkills(level40(HERO_REGISTRY['h574']), { commandSkillIds: ['xiling_kejin'] }), position: '大营' as Position };
    const report = runBattle({
      seed: 51,
      maxRounds: 8,
      myTeam: [
        dummy('ally-atk', '前锋', { attack: 300 }),
        dummy('ally-mag', '中军', { strategy: 300 }),
        luchen,
      ],
      enemyTeam: [dummy('foe-a', '前锋'), dummy('foe-b', '中军'), dummy('foe-c', '大营')],
    });

    const dmg = report.events.filter((e) => e.type === 'damage' && e.skillId === 'xiling_kejin');
    expect(dmg.length).toBeGreaterThan(0);
    // 8 回合 × 50%：发动次数应在合理区间（确定性种子）
    const casts = report.events.filter(
      (e) => e.type === 'skill_trigger' && e.skillId === 'xiling_kejin' && e.success,
    );
    expect(casts.length).toBeGreaterThanOrEqual(1);
    expect(casts.length).toBeLessThanOrEqual(8);
  });
});
