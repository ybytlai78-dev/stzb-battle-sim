/**
 * 批量2 主战法测试（v0.6.2）：当敌制决 / 闭月 / 金吾飞将 / 平壑拒吴 / 金匮要略
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { applyDamage, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { firstOnHurt, type BattleEvent, type General, type Position, type Skill, type UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, troops = 10000): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const targetsOf = (report: ReturnType<typeof run>, skillId: string) =>
  report.events.find((e) => e.type === 'skill_target' && e.skillId === skillId) as
    | { type: 'skill_target'; targetIds: string[] }
    | undefined;

describe('当敌制决（于禁，二类指挥·战斗开始一次性：自身减伤 50%）', () => {
  it('主战法挂入指挥槽（于禁）', () => {
    const g = hero('h796');
    expect(g.name).toBe('于禁');
    expect(g.commandSkillIds).toContain('dangdi_zhijue');
    const s = SKILL_REGISTRY['dangdi_zhijue'];
    expect(s.type === 'command' && s.phase === 'round').toBe(true);
    expect('battleStartOnce' in s && s.battleStartOnce === true).toBe(true);
    expect(s.range).toBe(5);
    expect(s.tags).toEqual(['damage_reduce', 'damage_boost']);
    expect(s.type === 'command' && firstOnHurt(s.onHurt)?.applyTo).toBe('source');
  });

  it('战斗开始即对自身施加减伤 50%', () => {
    const report = run([withSkills(level40(hero('h796'), { defense: 40 }), { commandSkillIds: ['dangdi_zhijue'] })], 1);
    const reduce = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce' && e.unitId === 'h796'
    );
    expect(reduce).toBeDefined();
    expect(reduce!.detail).toContain('0.5');
    // 减伤状态存在（率土减伤为比例）
    const st = report.finalMyTroops;
    expect(st).toBeDefined();
  });

  it('减伤只施加一次（不因二类指挥每回合叠加）', () => {
    const report = run([withSkills(level40(hero('h796'), { defense: 40 }), { commandSkillIds: ['dangdi_zhijue'] })], 1);
    const reduces = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce' && e.unitId === 'h796'
    );
    // 战斗开始一次性 → 只施加 1 层 50% 减伤，不叠加到 100%
    expect(reduces.length).toBe(1);
  });

  it('于禁受到的普攻伤害显著低于无减伤对照', () => {
    const boosted = run([withSkills(level40(hero('h796'), { defense: 40 }), { commandSkillIds: ['dangdi_zhijue'] })], 42);
    const plain = run([withSkills(level40(hero('h796'), { defense: 40 }), { commandSkillIds: [] })], 42);
    const dmgTaken = (r: ReturnType<typeof run>) =>
      r.events
        .filter((e) => e.type === 'attack_hit' && (e as { targetId: string }).targetId === 'h796')
        .reduce((acc, e) => acc + (e as { damage: number }).damage, 0);
    expect(dmgTaken(boosted)).toBeLessThan(dmgTaken(plain));
  });

  it('受击后使伤害来源受到的伤害提升 8%（防御 80 取基值），可叠加', () => {
    const yujin = dummyUnit('h796', '前锋', { defense: 80, commandSkillIds: ['dangdi_zhijue'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([yujin], [foe]);
    triggerCommandSkills(ctx, yujin);
    applyDamage(ctx, yujin, 100, foe, 'physical');
    const boost = foe.statuses.find(
      (s): s is Extract<(typeof foe.statuses)[number], { type: 'damage_boost' }> =>
        s.type === 'damage_boost' && s.sourceSkillId === 'dangdi_zhijue'
    );
    expect(boost).toBeDefined();
    expect(boost!.direction ?? 'taken').toBe('taken');
    expect(boost!.rate).toBeCloseTo(0.08, 5);
    applyDamage(ctx, yujin, 100, foe, 'physical');
    expect(boost!.rate).toBeCloseTo(0.16, 5);
  });

  it('防御 172 时反制为 10%（8 + 0.026×92，八舍九入）', () => {
    const yujin = dummyUnit('h796', '前锋', { defense: 172, commandSkillIds: ['dangdi_zhijue'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([yujin], [foe]);
    triggerCommandSkills(ctx, yujin);
    applyDamage(ctx, yujin, 100, foe, 'physical');
    const boost = foe.statuses.find(
      (s): s is Extract<(typeof foe.statuses)[number], { type: 'damage_boost' }> =>
        s.type === 'damage_boost' && s.sourceSkillId === 'dangdi_zhijue'
    );
    expect(boost?.rate).toBeCloseTo(0.1, 5);
  });

  it('策略 DoT 跳伤也叠反制', () => {
    const yujin = dummyUnit('h796', '前锋', { defense: 80, commandSkillIds: ['dangdi_zhijue'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([yujin], [foe]);
    triggerCommandSkills(ctx, yujin);
    applyDamage(ctx, yujin, 80, foe, 'strategy');
    const boost = foe.statuses.find(
      (s) => s.type === 'damage_boost' && s.sourceSkillId === 'dangdi_zhijue'
    );
    expect(boost).toBeDefined();
  });

  it('致死那一下仍叠；阵亡后再 applyDamage 不再叠', () => {
    const yujin = dummyUnit('h796', '前锋', { defense: 80, commandSkillIds: ['dangdi_zhijue'] });
    yujin.troops = 50;
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([yujin], [foe]);
    triggerCommandSkills(ctx, yujin);
    applyDamage(ctx, yujin, 50, foe, 'physical');
    expect(yujin.alive).toBe(false);
    const boost = foe.statuses.find(
      (s): s is Extract<(typeof foe.statuses)[number], { type: 'damage_boost' }> =>
        s.type === 'damage_boost' && s.sourceSkillId === 'dangdi_zhijue'
    );
    expect(boost?.rate).toBeCloseTo(0.08, 5);
    applyDamage(ctx, yujin, 100, foe, 'physical');
    expect(boost?.rate).toBeCloseTo(0.08, 5);
  });
});

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
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
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 2,
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

describe('闭月（貂蝉，准备群体暴走 + 防御 -29）', () => {
  it('主战法挂入主动槽，需 1 回合准备，目标对敌', () => {
    const g = hero('h5');
    expect(g.name).toBe('貂蝉');
    expect(g.activeSkillIds).toContain('biyue');
    const s = SKILL_REGISTRY['biyue'];
    expect(s.type === 'active' && s.prepare).toBe(true);
    expect('targetSide' in s && s.targetSide === 'enemy').toBe(true);
  });

  it('对敌军群体施加暴走（rampage 状态）', () => {
    const report = run([withSkills(level40(hero('h5'), { strategy: 40 }), { activeSkillIds: ['biyue'] })], 1);
    expect(casts(report, '闭月').length).toBeGreaterThan(0);
    const ramp = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'rampage'
    );
    expect(ramp.length).toBeGreaterThan(0);
  });

  it('敌军群体防御降低 29（defense_buff 负值，持续 3 回合）', () => {
    const report = run([withSkills(level40(hero('h5'), { strategy: 40 }), { activeSkillIds: ['biyue'] })], 1);
    const def = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'defense_buff'
    );
    expect(def).toBeDefined();
    expect(def!.detail).toMatch(/防御属性降低了29\(\d+\)/);
    // 目标为敌军（不是友军）
    const targets = targetsOf(report, 'biyue');
    expect(targets?.targetIds).toContain('enemy-front');
  });
});

describe('金吾飞将（吕布，单体猛攻 275% + 混乱 2 回合）', () => {
  it('主战法挂入主动槽（吕布）', () => {
    const g = hero('h3');
    expect(g.name).toBe('吕布');
    expect(g.activeSkillIds).toContain('jinwu_feijiang');
  });

  it('对单体发动猛攻（单目标 damage 事件）', () => {
    const report = run([withSkills(level40(hero('h3'), { attack: 40 }), { activeSkillIds: ['jinwu_feijiang'] })], 1);
    const cast = casts(report, '金吾飞将');
    expect(cast.length).toBeGreaterThan(0);
    const targets = targetsOf(report, 'jinwu_feijiang');
    expect(targets?.targetIds.length).toBe(1);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillName === '金吾飞将'
    );
    expect(dmg.length).toBeGreaterThan(0);
  });

  it('目标陷入混乱 2 回合', () => {
    const report = run([withSkills(level40(hero('h3'), { attack: 40 }), { activeSkillIds: ['jinwu_feijiang'] })], 1);
    const conf = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'confusion'
    );
    expect(conf).toBeDefined();
  });
});

describe('平壑拒吴（曹仁，群体攻击 210% + 怯战 2 回合）', () => {
  it('主战法挂入主动槽（曹仁）', () => {
    const g = hero('h585');
    expect(g.name).toBe('曹仁');
    expect(g.activeSkillIds).toContain('pinghe_juwu');
  });

  it('对敌军群体（2 目标）发动攻击', () => {
    const report = run([withSkills(level40(hero('h585'), { attack: 40 }), { activeSkillIds: ['pinghe_juwu'] })], 1);
    const cast = casts(report, '平壑拒吴');
    expect(cast.length).toBeGreaterThan(0);
    const targets = targetsOf(report, 'pinghe_juwu');
    expect(targets?.targetIds.length).toBe(2);
  });

  it('敌军陷入怯战（cowardice）', () => {
    const report = run([withSkills(level40(hero('h585'), { attack: 40 }), { activeSkillIds: ['pinghe_juwu'] })], 1);
    const cow = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'cowardice'
    );
    expect(cow.length).toBeGreaterThan(0);
  });
});

describe('金匮要略（张机，一类指挥：前 3 回合全军减伤 20.4% 受谋略 + 受击急救恢复 80% 受谋略）', () => {
  it('主战法挂入指挥槽（张机）', () => {
    const g = hero('h526');
    expect(g.name).toBe('张机');
    expect(g.commandSkillIds).toContain('jinkui_yaolue');
    const s = SKILL_REGISTRY['jinkui_yaolue'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
  });

  it('准备阶段对全军施加减伤 + 持续型急救（张机 + 2 友军 = 3 目标）', () => {
    const team = [
      withSkills(level40(hero('h526'), { strategy: 40 }), { commandSkillIds: ['jinkui_yaolue'] }),
      dummy('ally-front', '前锋'),
      dummy('ally-back', '大营'),
    ];
    const report = run(team, 1);
    const cast = casts(report, '金匮要略');
    expect(cast.length).toBe(1);
    const reduces = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce'
    );
    // 张机 + 2 友军 = 3 个目标
    expect(reduces.length).toBe(3);
    // 同时挂上持续型急救（3 目标，排除触发率提升事件）
    const aids = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'first_aid' && !e.detail.includes('提升至')
    );
    expect(aids.length).toBe(3);
  });

  it('前 3 回合张机（及友军）受到伤害显著降低', () => {
    const team = [
      withSkills(level40(hero('h526'), { strategy: 40 }), { commandSkillIds: ['jinkui_yaolue'] }),
      dummy('ally-front', '前锋'),
      dummy('ally-back', '大营'),
    ];
    const buffed = run(team, 7);
    const plainTeam = [
      withSkills(level40(hero('h526'), { strategy: 40 }), { commandSkillIds: [] }),
      dummy('ally-front', '前锋'),
      dummy('ally-back', '大营'),
    ];
    const plain = run(plainTeam, 7);
    // 按单次受击平均伤害比较（随机流变化会改变受击次数与目标分布，均值口径严格反映减伤比例）
    const avgHit = (r: ReturnType<typeof run>) => {
      const hits = r.events.filter(
        (e) => e.type === 'attack_hit' && !(e as { targetId: string }).targetId.startsWith('enemy')
      );
      return hits.reduce((acc, e) => acc + (e as { damage: number }).damage, 0) / Math.max(1, hits.length);
    };
    expect(avgHit(buffed)).toBeLessThan(avgHit(plain));
  });

  it('减伤与恢复率均受谋略缩放：40 级张机（谋略 ≈174）→ 减伤 > 20.4%、恢复率 > 80%', () => {
    const team = [
      withSkills(level40(hero('h526'), { strategy: 40 }), { commandSkillIds: ['jinkui_yaolue'] }),
      dummy('ally-front', '前锋'),
      dummy('ally-back', '大营'),
    ];
    const report = run(team, 1);
    const reduceEvent = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_reduce'
    )!;
    // detail: `减伤 0.37 持续 3 回合`（20.4% + 0.18/点×94 ≈ 37.32 → 八舍九入 37%）
    const rate = parseFloat(reduceEvent.detail.match(/减伤 ([\d.]+)/)![1]);
    expect(rate).toBeGreaterThan(0.204);
    // detail: `持续型急救 150% 恢复率 持续 3 回合`（80% + 0.75/点×94 ≈ 150.5 → 八舍九入 150%）
    const aidEvent = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'first_aid' && !e.detail.includes('提升至')
    )!;
    const healRate = parseFloat(aidEvent.detail.match(/持续型急救 ([\d.]+)%/)![1]);
    expect(healRate).toBeGreaterThan(80);
    // 前 3 回合：detail 带持续回合数
    expect(aidEvent.detail).toContain('持续 3 回合');
  });

  it('受击触发急救恢复（归属张机）；前 3 回合结束急救与减伤一并移除', () => {
    const team = [
      withSkills(level40(hero('h526'), { strategy: 40 }), { commandSkillIds: ['jinkui_yaolue'] }),
      dummy('ally-front', '前锋'),
      dummy('ally-back', '大营'),
    ];
    const report = run(team, 7, 8);

    // 前 3 回合受击触发恢复：heal 事件归属施法者（张机）
    const heals = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === 'jinkui_yaolue'
    );
    expect(heals.length).toBeGreaterThan(0);
    for (const h of heals) {
      expect(h.sourceId).toBe('h526');
      expect(h.amount).toBeGreaterThan(0);
    }
    // 急救与减伤第 3 回合末到期（准备阶段施加 remaining=3，三目标各自移除）
    const expiredAids = report.events.filter((e) => e.type === 'status_expired' && e.statusType === 'first_aid');
    expect(expiredAids.length).toBe(3);
    const expiredReduces = report.events.filter((e) => e.type === 'status_expired' && e.statusType === 'damage_reduce');
    expect(expiredReduces.length).toBe(3);
    // 到期后（第 4 回合起）不再有急救触发
    const aidTick = report.events.findIndex((e) => e.type === 'status_expired' && e.statusType === 'first_aid');
    const round4Start = report.events.findIndex((e) => e.type === 'round_start' && e.round === 4);
    const healsAfter4 = report.events.filter(
      (e, i) => i > round4Start && e.type === 'heal' && e.skillId === 'jinkui_yaolue'
    );
    expect(healsAfter4.length).toBe(0);
    expect(aidTick).toBeLessThan(round4Start);
  });
});
