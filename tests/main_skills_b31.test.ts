/**
 * 计定山越（诸葛恪·吴·弓 h522 主战法）：主动 B，1 回合准备，发动率 40%，距离 4，敌军群体 2 目标。
 * ① 使敌军群体陷入恐慌状态（伤害率 134%，受谋略属性影响），每回合损失兵力，持续 2 回合；
 * ② 若敌军群体士气一般或低落，额外使其陷入围困状态（无法恢复兵力）；
 * ③ 使自身和友军单体恢复一定兵力（恢复率 98%，受谋略属性影响）。
 * 官方数据：scripts/skill_extra.json id 200762（主动 / B / 40% / 距离 4 / 敌军群体 2 / 弓；
 * 1 级描述：恐慌 67%、恢复 49%）。
 * 引擎配套：**无需新机制** —— ② 走既有 `morale_branch`（by:'target'、threshold 100：
 * 士气 >100 高昂走 high（空）、一般（=100）/低落（<100）走 low）；① 走既有 panic DoT；③ 走既有 heal。
 * 成长率：「受谋略属性影响」的恐慌 134% 与恢复 98% 成长率未确认 → 留空（growthRate: 0 = 不缩放、用基值）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import { calcHealAmount } from '../src/engine/formulas';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
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

/** 深拷贝战法写入 ctx.skills，用于强制 triggerRate（避免改到 registry 单例）。 */
function forceSkill(ctx: CombatContext, id: string, patch: (s: Skill) => void): void {
  const cloned = structuredClone(SKILL_REGISTRY[id]) as Skill;
  patch(cloned);
  ctx.skills.set(id, cloned);
}

/** 40 级真实武将挂指定槽位，站位可覆盖。 */
function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

/** 强制发动并等到释放：第 1 次行动进入准备，第 2 次行动（下一回合）释放。 */
function castJiding(ctx: CombatContext, caster: UnitState): void {
  actUnit(ctx, caster);
  expect(caster.isPreparing).toBe(true);
  ctx.currentRound += 1;
  actUnit(ctx, caster);
  expect(caster.isPreparing).toBe(false);
}

function healEvents(ctx: CombatContext): Extract<BattleEvent, { type: 'heal' }>[] {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: 'heal' }> =>
    e.type === 'heal' && e.skillId === 'jiding_shanyue',
  );
}

function dotTicks(ctx: CombatContext): Extract<BattleEvent, { type: 'dot_tick' }>[] {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: 'dot_tick' }> =>
    e.type === 'dot_tick' && e.skillId === 'jiding_shanyue',
  );
}

describe('计定山越（诸葛恪 h522）', () => {
  it('装配：注册表定义 + 挂槽名（主动 B / 40% / 距离 4 / 敌军群体 2 / 弓）', () => {
    const hero = HERO_REGISTRY['h522'];
    expect(hero.name).toBe('诸葛恪');
    expect(hero.mainSkillName).toBe('计定山越');
    expect(hero.troopType).toBe('archer');

    const s = SKILL_REGISTRY['jiding_shanyue'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(true);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['heal', 'panic', 'siege']);

    // ① 恐慌 134%（受谋略，成长率留空 = 0 不缩放）
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'panic', duration: 2, rate: 134, growthRate: 0 },
    });
    // ② 士气分支：high 空、low 施加围困（逐目标判定，阈值 100）
    expect(s.output[1]).toMatchObject({ kind: 'morale_branch', threshold: 100, by: 'target', high: [] });
    const branch = s.output[1] as Extract<Skill, { type: 'active' }>['output'][number];
    if (branch.kind === 'morale_branch') {
      expect(branch.low).toHaveLength(1);
      expect(branch.low[0]).toMatchObject({
        kind: 'inflict_status',
        status: { type: 'siege', duration: 2 },
      });
    }
    // ③ 自身恢复 98% + ④ 友军单体恢复 98%（不含自身）
    expect(s.output[2]).toMatchObject({ kind: 'heal', rate: 98, strategyScaled: true, growthRate: 0, target: 'self' });
    expect(s.output[3]).toMatchObject({
      kind: 'heal',
      rate: 98,
      strategyScaled: true,
      growthRate: 0,
      targetSide: 'ally',
      targetMode: 'random_single',
      excludeSelf: true,
    });
  });

  it('强制释放（敌军士气 100 一般）：恐慌 + 围困都落在同 2 个目标上，各持续 2 回合', () => {
    const me = heroUnit('h522', '前锋', { activeSkillIds: ['jiding_shanyue'] });
    const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e-mid', '中军'), 'enemy');
    const e3 = makeUnit(dummy('e-camp', '大营'), 'enemy');
    const ctx = makeCtx([me], [e1, e2, e3]);
    forceSkill(ctx, 'jiding_shanyue', (s) => {
      s.triggerRate = 1;
    });

    castJiding(ctx, me);

    const enemies = [e1, e2, e3];
    const panicked = enemies.filter((u) => u.statuses.some((x) => x.type === 'panic'));
    const besieged = enemies.filter((u) => u.statuses.some((x) => x.type === 'siege'));
    // 敌军群体（有效距离内 2 个目标）
    expect(panicked).toHaveLength(2);
    expect(besieged).toHaveLength(2);
    expect(besieged.map((u) => u.general.id).sort()).toEqual(panicked.map((u) => u.general.id).sort());
    for (const u of panicked) {
      const panic = u.statuses.find((x) => x.type === 'panic');
      expect(panic && 'remaining' in panic ? panic.remaining : 0).toBe(2);
    }
    for (const u of besieged) {
      const siege = u.statuses.find((x) => x.type === 'siege');
      expect(siege && 'remaining' in siege ? siege.remaining : 0).toBe(2);
    }
    // 恐慌是 DoT：攻击/策略面板之外的独立 dot_tick，不产生 damage 事件
    expect(
      ctx.events.some((e) => e.type === 'damage' && e.skillId === 'jiding_shanyue'),
    ).toBe(false);
  });

  it('士气逐目标判定：一般（100）吃围困、高昂（130）不吃', () => {
    const me = heroUnit('h522', '前锋', { activeSkillIds: ['jiding_shanyue'] });
    const low = makeUnit(dummy('e-low', '前锋', { morale: 100 }), 'enemy');
    const high = makeUnit(dummy('e-high', '中军', { morale: 130 }), 'enemy');
    const ctx = makeCtx([me], [low, high]);
    forceSkill(ctx, 'jiding_shanyue', (s) => {
      s.triggerRate = 1;
    });

    castJiding(ctx, me);

    expect(low.statuses.some((s) => s.type === 'panic')).toBe(true);
    expect(high.statuses.some((s) => s.type === 'panic')).toBe(true);
    expect(low.statuses.some((s) => s.type === 'siege')).toBe(true);
    expect(high.statuses.some((s) => s.type === 'siege')).toBe(false);
  });

  it('恐慌持续 2 回合 = 携带者行动 2 次各跳 1 次；第 3 次行动已失效', () => {
    const me = heroUnit('h522', '前锋', { activeSkillIds: ['jiding_shanyue'] });
    const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e-mid', '中军'), 'enemy');
    const ctx = makeCtx([me], [e1, e2]);
    forceSkill(ctx, 'jiding_shanyue', (s) => {
      s.triggerRate = 1;
    });
    castJiding(ctx, me);

    // 第 2 回合（施加当回合）行动：跳第 1 次
    actUnit(ctx, e1);
    expect(dotTicks(ctx).filter((e) => e.targetId === 'e-front')).toHaveLength(1);
    // 第 3 回合行动：跳第 2 次（此时 remaining 2→1）
    ctx.currentRound += 1;
    actUnit(ctx, e1);
    expect(dotTicks(ctx).filter((e) => e.targetId === 'e-front')).toHaveLength(2);
    // 第 4 回合行动：remaining 1→0 到期，不再跳
    ctx.currentRound += 1;
    actUnit(ctx, e1);
    expect(dotTicks(ctx).filter((e) => e.targetId === 'e-front')).toHaveLength(2);
    expect(e1.statuses.some((s) => s.type === 'panic')).toBe(false);
    // 恐慌伤害为策略伤害，归属本战法
    const tick = dotTicks(ctx).find((e) => e.targetId === 'e-front');
    expect(tick?.dotType).toBe('panic');
    expect(tick?.casterId).toBe('h522');
    expect(tick?.damage).toBeGreaterThan(0);
  });

  it('恢复：自身 + 1 名友军单体各 1 次，恢复率 98% 基值（成长率留空不缩放）', () => {
    const me = heroUnit('h522', '前锋', { activeSkillIds: ['jiding_shanyue'] });
    const ally = makeUnit(dummy('ally-mid', '中军'));
    me.troops = 5000;
    ally.troops = 5000;
    const enemy = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const ctx = makeCtx([me, ally], [enemy]);
    forceSkill(ctx, 'jiding_shanyue', (s) => {
      s.triggerRate = 1;
    });

    castJiding(ctx, me);

    const heals = healEvents(ctx);
    expect(heals).toHaveLength(2);
    expect(heals.map((h) => h.targetId).sort()).toEqual(['ally-mid', 'h522']);
    expect(heals.every((h) => h.sourceId === 'h522')).toBe(true);
    // 恢复值 = floor(round(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100)；恢复率 98% 为基值
    const selfExpected = calcHealAmount(5000, 98);
    const selfHeal = heals.find((h) => h.targetId === 'h522');
    expect(selfHeal?.amount).toBe(selfExpected);
    // 友军段在「自身恢复」之后结算 → 施法者兵力已回涨，恢复值按回涨后兵力重算（引擎既有口径）
    const allyExpected = calcHealAmount(5000 + selfExpected, 98);
    expect(heals.find((h) => h.targetId === 'ally-mid')?.amount).toBe(allyExpected);
    expect(me.troops).toBe(5000 + selfExpected);
    expect(ally.troops).toBe(5000 + allyExpected);
  });

  it('成长率留空口径：谋略 80 与 300 的恢复量完全相同（恢复率不缩放、用基值）', () => {
    const at = (strategy: number) => {
      const me = heroUnit('h522', '前锋', { activeSkillIds: ['jiding_shanyue'] }, { strategy });
      me.troops = 5000;
      const ally = makeUnit(dummy('ally-mid', '中军'));
      ally.troops = 5000;
      const ctx = makeCtx([me, ally], [makeUnit(dummy('e-front', '前锋'), 'enemy')]);
      forceSkill(ctx, 'jiding_shanyue', (s) => {
        s.triggerRate = 1;
      });
      castJiding(ctx, me);
      return healEvents(ctx).map((h) => h.amount);
    };

    const low = at(80);
    const high = at(300);
    expect(low).toEqual([calcHealAmount(5000, 98), calcHealAmount(5000 + calcHealAmount(5000, 98), 98)]);
    expect(high).toEqual(low);
  });

  it('整场跑通（runBattle）：出现恐慌跳伤 / 围困 / 恢复三类事件', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h522']), { activeSkillIds: ['jiding_shanyue'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), leader, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    const ticks = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'dot_tick' }> =>
        e.type === 'dot_tick' && e.skillId === 'jiding_shanyue',
    );
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((e) => e.dotType === 'panic')).toBe(true);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'siege')).toBe(true);
    expect(
      report.events.some((e) => e.type === 'heal' && e.skillId === 'jiding_shanyue'),
    ).toBe(true);
  });
});
