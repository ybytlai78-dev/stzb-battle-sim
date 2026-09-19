/**
 * 匠心不竭（黄月英·蜀步 h20 主战法）：指挥 A，距离 6，敌军全体。
 * 战斗开始后，使敌军全体从第 1、3、5 回合开始，逐渐陷入恐慌（34%）、燃烧（41%）、妖术（44%）
 * （均受谋略属性影响），每回合开始时损失一定兵力，持续直到战斗结束；所造成的伤害无视规避。
 * 官方：scripts/skill_extra.json id 200020（满级 34%/41%/44%，1 级 17%/20.5%/22%）。
 * 引擎配套：新增 `CommandSkill.delayedOutputs`（一类指挥多次分段延迟施加，第 atRound 回合开始、
 * 单位行动前对锁定目标执行该条目 output）。
 * 成长率：「受谋略属性影响」三段未确认 → 留空（DoT 的 growthRate 为必填字段，给 0 = 不缩放用基值）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { triggerCommandSkills, triggerDelayedOutputs, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
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
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 60,
    defense: 80,
    strategy: 60,
    speed: 30,
    attackRange: 2,
    maxTroops: 50000,
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

/** 单位身上指定 DoT 状态 */
function dotOf(unit: UnitState, type: 'panic' | 'burning' | 'sorcery') {
  return unit.statuses.find((s) => s.type === type);
}

describe('匠心不竭（黄月英 h20）', () => {
  it('装配：注册表定义 + 挂槽名（指挥 A / 距离 6 / 敌军全体 / 1、3、5 回合三段）', () => {
    const hero = HERO_REGISTRY['h20'];
    expect(hero.name).toBe('黄月英');
    expect(hero.mainSkillName).toBe('匠心不竭');

    const s = SKILL_REGISTRY['jiangxin_bujie'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.triggerRate).toBe(1);
    expect(s.range).toBe(6);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['burning', 'panic', 'sorcery']);
    expect(s.output).toEqual([]);
    expect(s.delayedOutputs?.map((d) => d.atRound)).toEqual([1, 3, 5]);
    const expectDot = (round: number, type: string, rate: number) => {
      const entry = s.delayedOutputs?.find((d) => d.atRound === round);
      expect(entry?.output[0]).toMatchObject({
        kind: 'inflict_status',
        status: { type, duration: 999, rate, growthRate: 0 },
      });
    };
    expectDot(1, 'panic', 34);
    expectDot(3, 'burning', 41);
    expectDot(5, 'sorcery', 44);
  });

  it('分段延迟：第 1 回合全体恐慌 / 第 2 回合无新增 / 第 3 回合全体燃烧 / 第 5 回合全体妖术', () => {
    const me = heroUnit('h20', '中军', { commandSkillIds: ['jiangxin_bujie'] });
    const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e-mid', '中军'), 'enemy');
    const e3 = makeUnit(dummy('e-camp', '大营'), 'enemy');
    const ctx = makeCtx([me], [e1, e2, e3]);

    triggerCommandSkills(ctx, me); // 准备阶段：锁目标 + 登记（不立刻结算）
    expect(ctx.lockedCommands).toHaveLength(1);
    expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === 'jiangxin_bujie')).toBe(true);
    for (const u of [e1, e2, e3]) expect(u.statuses).toHaveLength(0);

    triggerDelayedOutputs(ctx, 1);
    for (const u of [e1, e2, e3]) expect(dotOf(u, 'panic')).toBeTruthy();
    for (const u of [e1, e2, e3]) {
      expect(dotOf(u, 'burning')).toBeUndefined();
      expect(dotOf(u, 'sorcery')).toBeUndefined();
    }
    const panicRate = dotOf(e1, 'panic');
    expect(panicRate && 'rate' in panicRate ? panicRate.rate : 0).toBe(34);

    triggerDelayedOutputs(ctx, 2); // 非分段回合：不再施加
    for (const u of [e1, e2, e3]) expect(dotOf(u, 'burning')).toBeUndefined();

    triggerDelayedOutputs(ctx, 3);
    for (const u of [e1, e2, e3]) expect(dotOf(u, 'burning')).toBeTruthy();

    triggerDelayedOutputs(ctx, 4);
    for (const u of [e1, e2, e3]) expect(dotOf(u, 'sorcery')).toBeUndefined();

    triggerDelayedOutputs(ctx, 5);
    for (const u of [e1, e2, e3]) expect(dotOf(u, 'sorcery')).toBeTruthy();
    // 三种 DoT 各自的伤害率
    const rates = [e1, e2, e3].map((u) => {
      const p = dotOf(u, 'panic');
      const b = dotOf(u, 'burning');
      const s = dotOf(u, 'sorcery');
      return [
        p && 'rate' in p ? p.rate : 0,
        b && 'rate' in b ? b.rate : 0,
        s && 'rate' in s ? s.rate : 0,
      ];
    });
    expect(rates).toEqual([
      [34, 41, 44],
      [34, 41, 44],
      [34, 41, 44],
    ]);
  });

  it('锁定目标阵亡后跳过：第 5 回合只给存活者挂妖术', () => {
    const me = heroUnit('h20', '中军', { commandSkillIds: ['jiangxin_bujie'] });
    const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e-mid', '中军'), 'enemy');
    const e3 = makeUnit(dummy('e-camp', '大营'), 'enemy');
    const ctx = makeCtx([me], [e1, e2, e3]);
    triggerCommandSkills(ctx, me);

    e3.alive = false; // 锁定后阵亡
    triggerDelayedOutputs(ctx, 5);

    expect(dotOf(e1, 'sorcery')).toBeTruthy();
    expect(dotOf(e2, 'sorcery')).toBeTruthy();
    expect(dotOf(e3, 'sorcery')).toBeUndefined();
  });

  it('成长率留空：谋略 80 与 300 的三段伤害率都是 34/41/44（不缩放）', () => {
    const ratesAt = (strategy: number) => {
      const me = heroUnit('h20', '中军', { commandSkillIds: ['jiangxin_bujie'] }, { strategy });
      const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
      const ctx = makeCtx([me], [e1]);
      triggerCommandSkills(ctx, me);
      triggerDelayedOutputs(ctx, 1);
      triggerDelayedOutputs(ctx, 3);
      triggerDelayedOutputs(ctx, 5);
      return ['panic', 'burning', 'sorcery'].map((t) => {
        const s = dotOf(e1, t as 'panic' | 'burning' | 'sorcery');
        return s && 'rate' in s ? s.rate : 0;
      });
    };
    expect(ratesAt(80)).toEqual([34, 41, 44]);
    expect(ratesAt(300)).toEqual([34, 41, 44]);
  });

  it('整场跑通（runBattle）：第 1 回合起恐慌、第 3 回合起燃烧、第 5 回合起妖术，每回合各跳一次', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h20']), { commandSkillIds: ['jiangxin_bujie'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 3,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), leader, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-camp', '大营')],
    });

    let round = 0;
    const firstRoundOf: Record<string, number> = {};
    const tickRounds: Record<string, number[]> = { panic: [], burning: [], sorcery: [] };
    for (const ev of report.events) {
      if (ev.type === 'round_start') round = ev.round;
      if (ev.type === 'dot_tick' && ev.skillId === 'jiangxin_bujie' && ev.dotType in tickRounds) {
        tickRounds[ev.dotType].push(round);
        firstRoundOf[ev.dotType] ??= round;
      }
    }
    expect(firstRoundOf['panic']).toBe(1);
    expect(firstRoundOf['burning']).toBe(3);
    expect(firstRoundOf['sorcery']).toBe(5);
    // 每回合每个目标各跳一次（首跳回合起持续到战斗结束）
    for (const type of ['panic', 'burning', 'sorcery'] as const) {
      expect(tickRounds[type].length).toBeGreaterThan(0);
      expect(tickRounds[type].length % 3).toBe(0); // 3 名敌军同回合各跳一次
    }
  });
});
