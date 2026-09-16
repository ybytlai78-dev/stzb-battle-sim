/**
 * 阵容门闩 teamTroopFilter + 输出 troopTypes 目标兵种过滤。
 * 测试战法只挂进 ctx.skills，不改 SKILL_REGISTRY。
 */
import { describe, it, expect } from 'vitest';
import { teamPassesTroopFilter, triggerCommandSkills, statusMatchesHit, inflictStatus, actUnit, tickRoundStartStatuses, type CombatContext } from '../src/engine/action';
import type { General, Position, Skill, SkillOutput, SkillType, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 80, defense: 80, strategy: 80, speed: 50, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], isPreparing: false, preparingSkillId: null, hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

describe('teamPassesTroopFilter', () => {
  it('集合 ⊆ 允许列表则通过；混入第三兵种失败；3 弓算仅弓+骑', () => {
    const a = dummyUnit('a', '前锋', { troopType: 'archer' });
    const c = dummyUnit('c', '中军', { troopType: 'cavalry' });
    const i = dummyUnit('i', '大营', { troopType: 'infantry' });
    expect(teamPassesTroopFilter([a, c], ['archer', 'cavalry'])).toBe(true);
    expect(teamPassesTroopFilter([a, a, a], ['archer', 'cavalry'])).toBe(true);
    expect(teamPassesTroopFilter([a, c, i], ['archer', 'cavalry'])).toBe(false);
  });

  it('阵亡不改集合', () => {
    const a = dummyUnit('a', '前锋', { troopType: 'archer' });
    const inf = dummyUnit('i', '中军', { troopType: 'infantry' });
    inf.alive = false;
    expect(teamPassesTroopFilter([a, inf], ['archer', 'cavalry'])).toBe(false);
  });
});

describe('teamTroopFilter 指挥整法跳过', () => {
  it('混步兵时疏数不发 skill_cast、弓兵无防御 buff', () => {
    const skill: Skill = {
      id: 'test_ss', name: '疏数', type: 'command', phase: 'prep', range: 2, triggerRate: 1,
      targetMode: 'group', groupCount: 3, targetSide: 'ally', tags: ['buff_defense'],
      teamTroopFilter: ['archer', 'cavalry'],
      output: [{ kind: 'inflict_status', troopTypes: ['archer'], status: { type: 'defense_buff', amount: 50, duration: 999 } }],
    };
    const caster = dummyUnit('caster', '前锋', { troopType: 'archer', commandSkillIds: ['test_ss'] });
    const mid = dummyUnit('mid', '中军', { troopType: 'cavalry' });
    const back = dummyUnit('back', '大营', { troopType: 'infantry' });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, mid, back], [foe]);
    ctx.skills.set('test_ss', skill);
    triggerCommandSkills(ctx, caster);
    expect(ctx.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'test_ss')).toHaveLength(0);
    expect(caster.statuses.filter((s) => s.type === 'defense_buff')).toHaveLength(0);
  });

  it('弓+骑上阵则弓兵吃防御，骑兵不吃', () => {
    const skill: Skill = {
      id: 'test_ss', name: '疏数', type: 'command', phase: 'prep', range: 2, triggerRate: 1,
      targetMode: 'group', groupCount: 3, targetSide: 'ally', tags: ['buff_defense'],
      teamTroopFilter: ['archer', 'cavalry'],
      output: [{ kind: 'inflict_status', troopTypes: ['archer'], status: { type: 'defense_buff', amount: 50, duration: 999 } }],
    };
    const caster = dummyUnit('caster', '前锋', { troopType: 'archer', commandSkillIds: ['test_ss'] });
    const mid = dummyUnit('mid', '中军', { troopType: 'cavalry' });
    const back = dummyUnit('back', '大营', { troopType: 'archer' });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, mid, back], [foe]);
    ctx.skills.set('test_ss', skill);
    triggerCommandSkills(ctx, caster);
    expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === 'test_ss')).toBe(true);
    expect(caster.statuses.some((s) => s.type === 'defense_buff' && s.amount === 50)).toBe(true);
    expect(mid.statuses.some((s) => s.type === 'defense_buff')).toBe(false);
    expect(back.statuses.some((s) => s.type === 'defense_buff')).toBe(true);
  });
});

describe('statusMatchesHit', () => {
  const basic = { damageSource: 'basic' as const, damageType: 'physical' as const };
  const activePhys = { damageSource: 'skill' as const, damageType: 'physical' as const, skillType: 'active' as const };
  const pursuitPhys = { damageSource: 'skill' as const, damageType: 'physical' as const, skillType: 'pursuit' as const };
  const strat = { damageSource: 'skill' as const, damageType: 'strategy' as const, skillType: 'active' as const };

  it('缺省不过滤', () => {
    expect(statusMatchesHit({ rate: 0.1 } as never, basic)).toBe(true);
    expect(statusMatchesHit({}, activePhys)).toBe(true);
    expect(statusMatchesHit({}, undefined)).toBe(true);
  });

  it('basic 不匹配 skill 攻击', () => {
    expect(statusMatchesHit({ damageSource: 'basic' }, basic)).toBe(true);
    expect(statusMatchesHit({ damageSource: 'basic' }, activePhys)).toBe(false);
  });

  it('skillTypes active+pursuit 吃主动与追击、不吃指挥', () => {
    const s = { damageSource: 'skill' as const, skillTypes: ['active', 'pursuit'] as SkillType[] };
    expect(statusMatchesHit(s, activePhys)).toBe(true);
    expect(statusMatchesHit(s, pursuitPhys)).toBe(true);
    expect(statusMatchesHit(s, { damageSource: 'skill', damageType: 'physical', skillType: 'command' })).toBe(false);
    expect(statusMatchesHit(s, basic)).toBe(false);
  });

  it('仅 active 不吃追击', () => {
    const s = { damageSource: 'skill' as const, skillTypes: ['active'] as SkillType[] };
    expect(statusMatchesHit(s, activePhys)).toBe(true);
    expect(statusMatchesHit(s, pursuitPhys)).toBe(false);
  });

  it('damageType strategy 不吃普攻', () => {
    expect(statusMatchesHit({ damageType: 'strategy' }, strat)).toBe(true);
    expect(statusMatchesHit({ damageType: 'strategy' }, basic)).toBe(false);
  });
});

describe('同类型 damage_boost 冲突替换过滤字段', () => {
  const activePhys = { damageSource: 'skill' as const, damageType: 'physical' as const, skillType: 'active' as const };

  it('高率带 damageSource:basic 替换无过滤 +30%，过滤字段随胜者', () => {
    const u = dummyUnit('u', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([u], [foe]);
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' }, 'command', 'dashang_sanjun');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.5, duration: 3, direction: 'caused', damageSource: 'basic' }, 'command', 'fengshi');
    const surviving = u.statuses.find((s) => s.type === 'damage_boost');
    expect(surviving?.type).toBe('damage_boost');
    if (surviving?.type !== 'damage_boost') return;
    expect(surviving.rate).toBe(0.5);
    expect(surviving.damageSource).toBe('basic');
  });

  it('无过滤高率替换带 damageSource:basic 低率，清掉残留过滤', () => {
    const u = dummyUnit('u', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([u], [foe]);
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.2, duration: 3, direction: 'caused', damageSource: 'basic' }, 'command', 'fengshi');
    inflictStatus(ctx, u, { type: 'damage_boost', rate: 0.4, duration: 3, direction: 'caused' }, 'command', 'dashang_sanjun');
    const surviving = u.statuses.find((s) => s.type === 'damage_boost');
    expect(surviving?.type).toBe('damage_boost');
    if (surviving?.type !== 'damage_boost') return;
    expect(surviving.rate).toBe(0.4);
    expect(surviving.damageSource).toBeUndefined();
    expect(statusMatchesHit(surviving, activePhys)).toBe(true);
  });

  it('方圆先挂再挂大赏：同号取较高为 +30%，−20% basic 仍在，主动不叠 16.8%', () => {
    const u = dummyUnit('u', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([u], [foe]);
    inflictStatus(ctx, u, {
      type: 'damage_boost', rate: -0.2, duration: 999, direction: 'caused', damageSource: 'basic',
    }, 'command', 'fangyuan');
    inflictStatus(ctx, u, {
      type: 'damage_boost', rate: 0.168, duration: 999, direction: 'caused',
      damageSource: 'skill', skillTypes: ['active', 'pursuit'],
    }, 'command', 'fangyuan');
    inflictStatus(ctx, u, {
      type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused',
    }, 'command', 'dashang_sanjun');
    assertFangyuanDashangEnd(u, activePhys);
  });

  it('大赏先挂再挂方圆：终态同为 −20% basic + 无过滤 +30%，+16.8% 被拒', () => {
    const u = dummyUnit('u', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([u], [foe]);
    inflictStatus(ctx, u, {
      type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused',
    }, 'command', 'dashang_sanjun');
    inflictStatus(ctx, u, {
      type: 'damage_boost', rate: -0.2, duration: 999, direction: 'caused', damageSource: 'basic',
    }, 'command', 'fangyuan');
    inflictStatus(ctx, u, {
      type: 'damage_boost', rate: 0.168, duration: 999, direction: 'caused',
      damageSource: 'skill', skillTypes: ['active', 'pursuit'],
    }, 'command', 'fangyuan');
    assertFangyuanDashangEnd(u, activePhys);
  });
});

/**
 * 方圆 × 大赏终态：同号胜者 0.3 无过滤，负号 −0.2 basic 共存；主动攻击只吃一条正 caused。
 */
function assertFangyuanDashangEnd(
  u: UnitState,
  activePhys: { damageSource: 'skill'; damageType: 'physical'; skillType: 'active' },
): void {
  const caused = u.statuses.filter(
    (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused',
  );
  expect(caused.some((s) => s.rate === 0.168)).toBe(false);
  const neg = caused.find((s) => s.rate < 0);
  expect(neg?.rate).toBe(-0.2);
  expect(neg?.damageSource).toBe('basic');
  const pos = caused.filter((s) => s.rate > 0);
  expect(pos).toHaveLength(1);
  expect(pos[0].rate).toBe(0.3);
  expect(pos[0].sourceSkillId).toBe('dashang_sanjun');
  expect(pos[0].damageSource).toBeUndefined();
  expect(pos[0].skillTypes).toBeUndefined();
  const matchingPos = caused.filter((s) => s.rate > 0 && statusMatchesHit(s, activePhys));
  expect(matchingPos).toHaveLength(1);
  expect(matchingPos[0].rate).toBe(0.3);
}

describe('oddRounds', () => {
  it('仅第 1/3 回合 roundStartRepeat 结算（maxRounds 3 时第 2 回合不挂分兵）', () => {
    const skill: Skill = {
      id: 'test_hy', name: '鹤翼', type: 'command', phase: 'prep', range: 3, triggerRate: 1,
      targetMode: 'group', groupCount: 3, targetSide: 'ally', tags: ['split'],
      output: [],
      roundStartRepeat: {
        oddRounds: true,
        output: [{ kind: 'inflict_status', troopTypes: ['archer'], status: { type: 'split', rate: 49, duration: 1 } }],
      },
    };
    const archer = dummyUnit('ar', '前锋', { troopType: 'archer', commandSkillIds: ['test_hy'], speed: 10 });
    const foe = dummyUnit('foe', '前锋', { speed: 200 }, 'enemy');
    const ctx = makeCtx([archer], [foe]);
    ctx.skills.set('test_hy', skill);
    triggerCommandSkills(ctx, archer);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    expect(archer.statuses.some((s) => s.type === 'split')).toBe(true);
    archer.statuses = [];
    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    expect(archer.statuses.some((s) => s.type === 'split')).toBe(false);
    ctx.currentRound = 3;
    tickRoundStartStatuses(ctx);
    expect(archer.statuses.some((s) => s.type === 'split')).toBe(true);
  });
});

describe('split charges', () => {
  it('有 charges 时 tickStatusesOnActStart 不因回合摘掉', () => {
    const me = dummyUnit('me', '前锋');
    const ctx = makeCtx([me], [dummyUnit('foe', '前锋', {}, 'enemy')]);
    ctx.currentRound = 2;
    me.statuses.push({
      type: 'split', remaining: 999, rate: 55, charges: 2, appliedRound: 1,
      sourceSkillType: 'active', sourceSkillId: 'sata_ruxing',
    });
    actUnit(ctx, me);
    const sp = me.statuses.find((s) => s.type === 'split');
    expect(sp).toBeTruthy();
    expect(sp && 'charges' in sp ? sp.charges : 0).toBeGreaterThanOrEqual(1);
  });
});

describe('attacker recipient', () => {
  it('骑兵代打：伤害 sourceId 为骑兵且 chance=1 必有 damage', () => {
    const skill: Skill = {
      id: 'test_ss2', name: '疏数打', type: 'command', phase: 'prep', range: 2, triggerRate: 1,
      targetMode: 'group', groupCount: 3, targetSide: 'ally', tags: ['damage'],
      teamTroopFilter: ['archer', 'cavalry'],
      output: [],
      roundStartRepeat: {
        output: [{
          kind: 'physical_damage',
          rate: 100,
          attacker: 'recipient',
          troopTypes: ['cavalry'],
          chance: 1,
          range: 3,
          targetMode: 'single',
          targetSide: 'enemy',
        } as SkillOutput],
      },
    };
    const archer = dummyUnit('ar', '前锋', { troopType: 'archer', commandSkillIds: ['test_ss2'] });
    const cav = dummyUnit('cav', '中军', { troopType: 'cavalry', attack: 200 });
    const foe = dummyUnit('foe', '前锋', { defense: 40 }, 'enemy');
    const ctx = makeCtx([archer, cav], [foe]);
    ctx.skills.set('test_ss2', skill);
    triggerCommandSkills(ctx, archer);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const dmg = ctx.events.filter((e) => e.type === 'damage' && e.sourceId === 'cav');
    expect(dmg.length).toBeGreaterThan(0);
  });
});
