/**
 * 卫瓘「持节镇西」× 延迟结算型一类指挥：预结算叠层口径（2026-10-23 用户口径）
 *
 * 口径（勿再询问）：
 *  - DoT（恐慌 / 燃烧 / 妖术 / 引燃）在**施加那一刻**就冻结每次跳伤 ⇒ 属「预结算伤害段」，
 *    与 strategy_damage 同等判为 strategy，叠**谋略层**；分兵 / 攻城 / 属性类状态只施加状态、
 *    不结算伤害 ⇒ 不参与判定（帝临回光因此只叠谋略层，不叠攻击层）。
 *  - 叠层点覆盖三处：prep 预存（delayedOutput）、prep 结算延迟效果**前**（delayedOutputs）、
 *    回合施加前（delayedOutput / delayedOutputs 的 executeSkillOutputs 之前）。
 *
 * 回归：灵帝 prep 谋略 ×3（不再是攻击 ×3）、月英 prep 谋略 ×3、吕蒙不变、反序（卫瓘慢）仍 0 层。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import {
  effectiveStat,
  triggerCommandSkills,
  triggerDelayedOutputs,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { level40, withSkills, HERO_REGISTRY, initHeroDB } from '../src/data/heroes';
import type { General, Position, Skill, UnitState } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

function mkReal(id: string, position: Position, commandSkillIds: string[], speedBonus = 0): UnitState {
  const free = speedBonus > 0 ? { speed: speedBonus } : {};
  const g: General = withSkills(level40(HERO_REGISTRY[id], free), { commandSkillIds }) as General;
  return {
    general: { ...g, position },
    side: 'my',
    troops: 9000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function mkDummy(id: string, position: Position, speed = 40): UnitState {
  const g: General = {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 60,
    strategy: 60,
    speed,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
  return { general: g, side: 'enemy', troops: 9000, alive: true, wounded: 0, totalDead: 0, statuses: [], preparations: [] };
}

function makeCtx(myTeam: UnitState[], enemyTeam: UnitState[]): CombatContext {
  return {
    rng: new Rng(7),
    myTeam,
    enemyTeam,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const layers = (u: UnitState, type: string): number =>
  u.statuses.filter((s) => s.type === type && s.sourceSkillId === 'chijie_zhenxi').length;

const takenRates = (u: UnitState): number[] =>
  u.statuses
    .filter((s) => s.type === 'damage_boost' && (s as { direction?: string }).direction === 'taken')
    .map((s) => ('rate' in s ? s.rate : 0));

type Setup = {
  ctx: CombatContext;
  wg: UnitState;
  core: UnitState;
  enemies: UnitState[];
  order: 'wg-first' | 'core-first';
};

function setup(heroId: string, mainSkill: string, order: 'wg-first' | 'core-first' = 'wg-first'): Setup {
  const extra = ['shenbing_tianjiang', 'dashang_sanjun'];
  const wg = mkReal('weiguan', '中军', ['chijie_zhenxi']);
  const core = mkReal(heroId, '大营', [mainSkill, ...extra]);
  const enemies = (['前锋', '中军', '大营'] as Position[]).map((p, i) => mkDummy(`e${i + 1}`, p));
  const ctx = makeCtx([wg, core], enemies);
  // 复刻 combat.ts 准备阶段：turnOrder 速度降序逐将 triggerCommandSkills
  const turnOrder = order === 'wg-first' ? [wg, core] : [core, wg];
  for (const u of turnOrder) triggerCommandSkills(ctx, u);
  return { ctx, wg, core, enemies, order };
}

describe('卫瓘 × 延迟结算型一类指挥：预结算叠层', () => {
  it('灵帝：prep 叠谋略 ×3（分兵/攻城段不结算伤害 ⇒ 不叠攻击层）', () => {
    const { core, enemies } = setup('h101', 'diling_huiguang');
    expect(layers(core, 'strategy_buff')).toBe(3);
    expect(layers(core, 'attack_buff')).toBe(0);
    expect(effectiveStat(core, 'strategy')).toBe(242); // 146 + 32×3
    // 神兵天降 take 值读施法者当下谋略：30 + 0.15×(242−80) = 54.3 → 0.54
    expect(enemies.flatMap(takenRates)).toContain(0.54);
  });

  it('黄月英：prep 结算延迟效果前叠谋略 ×3', () => {
    const { core, enemies } = setup('h20', 'jiangxin_bujie');
    expect(layers(core, 'strategy_buff')).toBe(3);
    expect(effectiveStat(core, 'strategy')).toBe(264); // 168 + 96
    expect(enemies.flatMap(takenRates)).toContain(0.57); // 30 + 0.15×184 = 57.6
  });

  it('吕蒙回归：白衣 strategy_damage 仍叠谋略 ×3，预存伤害不变', () => {
    const { ctx, core } = setup('lvmeng', 'baiyi_dujiang');
    expect(layers(core, 'strategy_buff')).toBe(3);
    const lock = ctx.lockedCommands.find((l) => l.skill.id === 'baiyi_dujiang');
    expect(lock?.storedDamage?.length).toBe(3);
    const dmgs = (lock?.storedDamage ?? []).map((d) => d.damage);
    expect(new Set(dmgs).size).toBe(1); // 先叠满 3 层、再逐目标预存 ⇒ 三目标同值
    expect(dmgs[0]).toBeGreaterThan(0);
  });

  it('顺序敏感：核心先手（卫瓘未注册）时灵帝 0 层、神兵回落 0.39', () => {
    const { core, enemies } = setup('h101', 'diling_huiguang', 'core-first');
    expect(layers(core, 'strategy_buff')).toBe(0);
    expect(effectiveStat(core, 'strategy')).toBe(146);
    expect(enemies.flatMap(takenRates)).toContain(0.39);
  });

  it('月英 R1：施加恐慌前先叠层（层数升至 maxStacks 4 而非原地不动）', () => {
    const { ctx, core, enemies } = setup('h20', 'jiangxin_bujie');
    expect(layers(core, 'strategy_buff')).toBe(3);
    triggerDelayedOutputs(ctx, 1);
    expect(layers(core, 'strategy_buff')).toBe(4); // maxStacks 4 封顶
    const panics = enemies.flatMap((e) => e.statuses.filter((s) => s.type === 'panic'));
    expect(panics.length).toBe(3);
    // 恐慌在挂上那一刻冻结伤害 ⇒ 三个目标都应有 stored
    expect(
      panics.every((p) => ((p as unknown as { stored?: { damage: number } }).stored?.damage ?? 0) > 0),
    ).toBe(true);
  });

  it('真战斗事件流：灵帝 prep 阶段（preparation_end 之前）出现 ≥3 条谋略叠层且无攻击层', () => {
    const report = runBattle({
      seed: 7,
      maxRounds: 1,
      myTeam: [
        withSkills(level40(HERO_REGISTRY.weiguan, { speed: 40 }), { commandSkillIds: ['chijie_zhenxi'] }),
        withSkills(level40(HERO_REGISTRY.h101), {
          commandSkillIds: ['diling_huiguang', 'shenbing_tianjiang', 'dashang_sanjun'],
        }),
      ],
      enemyTeam: [
        mkDummy('ef', '前锋').general,
        mkDummy('em', '中军').general,
        mkDummy('eb', '大营').general,
      ],
    });
    const events = report.events;
    const prepEnd = events.findIndex((e) => e.type === 'preparation_end');
    expect(prepEnd).toBeGreaterThan(0);
    const prepLayers = events
      .slice(0, prepEnd)
      .filter(
        (e) =>
          e.type === 'status_inflicted' &&
          e.unitId === 'h101' &&
          (e.statusType === 'strategy_buff' || e.statusType === 'attack_buff'),
      );
    expect(prepLayers.filter((e) => e.type === 'status_inflicted' && e.statusType === 'strategy_buff').length).toBe(3);
    expect(prepLayers.filter((e) => e.type === 'status_inflicted' && e.statusType === 'attack_buff').length).toBe(0);
  });
});
