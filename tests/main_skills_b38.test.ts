/**
 * 人公将军（张梁·群步 h557 主战法）：指挥 B，距离 3，我军群体 3 目标。
 * 战斗前 4 回合：我军全体防御属性提高 60；我军前锋、中军受到普通攻击时会进行反击（伤害率 75%）；
 * 在此期间，敌方武将存在妖术效果时造成的攻击伤害降低 20%。
 * 官方：scripts/skill_extra.json id 200795（1 级 30 / 37.5% / 10%）。
 * 全文无「受 XX 属性影响」→ 不登记下架（张梁上架）。
 * 引擎配套：新增 `damage_reduce.requireSelfStatus`（条件减伤：仅当携带者自身带该状态时生效）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
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

/** 张梁 + 1 名打手 vs 1 个木桩；张梁登记人公将军 */
function battle3(extraFoe: Partial<General> = {}, seed = 1) {
  const zhangliang = heroUnit('h557', '中军', { commandSkillIds: ['rengong_jiangjun'] });
  const striker = makeUnit(dummy('striker', '前锋', { attack: 120 }));
  const foe = makeUnit(dummy('foe', '前锋', extraFoe), 'enemy');
  const ctx = makeCtx([zhangliang, striker], [foe], seed);
  triggerCommandSkills(ctx, zhangliang);
  return { zhangliang, striker, foe, ctx };
}

function enemyReduceStatus(unit: UnitState): Extract<Status, { type: 'damage_reduce' }> | undefined {
  return unit.statuses.find(
    (s): s is Extract<Status, { type: 'damage_reduce' }> =>
      s.type === 'damage_reduce' && s.sourceSkillId === 'rengong_jiangjun',
  );
}

describe('人公将军（张梁 h557）', () => {
  it('装配：注册表定义 + 挂槽名（指挥 B / 距离 3 / 我军群体 3）', () => {
    const hero = HERO_REGISTRY['h557'];
    expect(hero.name).toBe('张梁');
    expect(hero.mainSkillName).toBe('人公将军');

    const s = SKILL_REGISTRY['rengong_jiangjun'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect([...s.tags].sort()).toEqual(['counter', 'damage_reduce', 'defense_buff']);
    // ① 我军全体防御 +60（前 4 回合）
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'defense_buff', amount: 60, duration: 4 },
    });
    // ② 我军前锋 / 中军 反击 75%
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      positions: ['前锋', '中军'],
      status: { type: 'counter', duration: 4, rate: 75 },
    });
    // ③ 条件减伤：带妖术的敌军攻击伤害 −20%
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'enemy',
      targetMode: 'all',
      status: {
        type: 'damage_reduce',
        rate: 0.2,
        duration: 4,
        damageType: 'physical',
        requireSelfStatus: 'sorcery',
      },
    });
  });

  it('可上架：全文无「受属性影响」→ 不在未确认成长名单', () => {
    expect(isHeroListed({ mainSkillId: 'rengong_jiangjun' })).toBe(true);
  });

  it('准备阶段释放：我军全体防御 +60、仅前锋中军获反击资格、敌军全体挂条件减伤', () => {
    const zhangliang = heroUnit('h557', '大营', { commandSkillIds: ['rengong_jiangjun'] });
    const front = makeUnit(dummy('ally-front', '前锋'));
    const mid = makeUnit(dummy('ally-mid', '中军'));
    const foes = [
      makeUnit(dummy('e-front', '前锋'), 'enemy'),
      makeUnit(dummy('e-mid', '中军'), 'enemy'),
      makeUnit(dummy('e-camp', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([front, mid, zhangliang], foes);
    triggerCommandSkills(ctx, zhangliang);

    // 一类指挥从准备阶段就结算 output（不是延迟）
    for (const u of [front, mid, zhangliang]) {
      const buff = u.statuses.find((s) => s.type === 'defense_buff');
      expect(buff && 'amount' in buff ? buff.amount : 0).toBe(60);
    }
    // 反击：只有前锋 / 中军
    expect(front.statuses.some((s) => s.type === 'counter')).toBe(true);
    expect(mid.statuses.some((s) => s.type === 'counter')).toBe(true);
    expect(zhangliang.statuses.some((s) => s.type === 'counter')).toBe(false);
    // 条件减伤：敌军全体
    for (const f of foes) expect(enemyReduceStatus(f)).toBeTruthy();
  });

  it('条件减伤按「携带者是否带妖术」实时判定：无妖术不吃、有妖术吃 20%', () => {
    const { striker, foe, ctx } = battle3();
    expect(enemyReduceStatus(foe)).toBeTruthy();

    // ① 无妖术：普攻伤害不吃这条减伤（归因里没有人公将军）
    actUnit(ctx, striker);
    const hitNoSorcery = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit',
    );
    expect(hitNoSorcery).toBeTruthy();
    const dmgNoSorcery = hitNoSorcery!.damage;
    expect((hitNoSorcery!.modifiers?.reduce ?? []).some((m) => m.skillId === 'rengong_jiangjun')).toBe(false);

    // ② 给木桩挂「妖术」后再次受击：减伤立即生效（20% 归因出现在 reduce 列表）
    ctx.events.length = 0;
    inflictStatus(
      ctx,
      foe,
      { type: 'sorcery', duration: 2, rate: 30, growthRate: 0 },
      'active',
      'probe_sorcery',
      striker.general.id,
    );
    ctx.currentRound = 2; // 让打手再行动一轮
    actUnit(ctx, striker);
    const hitWithSorcery = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit',
    );
    expect(hitWithSorcery).toBeTruthy();
    const entry = (hitWithSorcery!.modifiers?.reduce ?? []).find((m) => m.skillId === 'rengong_jiangjun');
    expect(entry?.rate).toBeCloseTo(0.2, 5);
    expect(hitWithSorcery!.damage).toBeLessThan(dmgNoSorcery);
  });

  it('同种子对照：带妖术的木桩吃到的普攻伤害低于不带妖术的同配置木桩', () => {
    const damageTo = (withSorcery: boolean) => {
      const { striker, foe, ctx } = battle3({}, 11);
      if (withSorcery) {
        inflictStatus(
          ctx,
          foe,
          { type: 'sorcery', duration: 2, rate: 30, growthRate: 0 },
          'active',
          'probe_sorcery',
          striker.general.id,
        );
      }
      actUnit(ctx, striker);
      const hit = ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit',
      );
      return hit?.damage ?? 0;
    };
    const plain = damageTo(false);
    const cursed = damageTo(true);
    expect(plain).toBeGreaterThan(0);
    expect(cursed).toBeLessThan(plain);
  });

  it('整场跑通（runBattle）：出现防御加成与反击资格', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h557']), { commandSkillIds: ['rengong_jiangjun'] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 8,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), leader],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(
      report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'defense_buff'),
    ).toBe(true);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'counter')).toBe(true);
    expect(
      report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'damage_reduce'),
    ).toBe(true);
  });
});
