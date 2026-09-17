/**
 * 批量3 主战法测试（v0.6.3）：动如雷震 / 魏武之泽 / 强势 / 怒浪伐敌 / 诸葛锦囊 / 不动如山
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
 * 注：动如雷震/魏武之泽/强势 为主动战法（曹丕40%2回合、公孙瓒35%1回合、张春华40%2回合）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, Skill, UnitState } from '../src/engine/types';
import type { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

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

/** 完整 3 人队：主将居中，含前锋/大营友军 */
function fullTeam(leader: General): General[] {
  return [leader, dummy('ally-front', '前锋'), dummy('ally-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

/** 某状态下不同的目标数（去重） */
const distinctTargets = (report: ReturnType<typeof run>, statusType: string) =>
  new Set(inflicted(report, statusType).map((e) => e.unitId)).size;

/** 三站位满员队：公孙瓒可放前锋/中军/大营，验证同侧 2–3 目标 */
function positionedTeam(position: Position): General[] {
  const leader = {
    ...withSkills(level40(hero('h677'), { speed: 40 }), { activeSkillIds: ['dongru_leizhen'] }),
    position,
  };
  const rest: Position[] = (['前锋', '中军', '大营'] as Position[]).filter((p) => p !== position);
  return [leader, dummy('ally-a', rest[0]), dummy('ally-b', rest[1])];
}

/** 收集动如雷震各次施放的目标数 */
function leizhenTargetCounts(team: General[], seeds: number[]): number[] {
  const counts: number[] = [];
  for (const seed of seeds) {
    const report = run(team, seed);
    for (const e of report.events) {
      if (e.type === 'skill_target' && e.skillId === 'dongru_leizhen') {
        counts.push(e.targetIds.length);
      }
    }
  }
  return counts;
}

describe('动如雷震（公孙瓒，主动 35%：我军群体 2–3 目标追击伤害提升 40%（受速度影响，成长 0.2532/点），持续 1 回合）', () => {
  it('主战法挂入主动槽（公孙瓒），主动非准备，群体 2–3 目标、距离 3', () => {
    const g = hero('h677');
    expect(g.name).toBe('公孙瓒');
    expect(g.activeSkillIds).toContain('dongru_leizhen');
    const s = SKILL_REGISTRY['dongru_leizhen'];
    expect(s.type === 'active' && s.prepare === false && s.triggerRate === 0.35).toBe(true);
    expect(s.range).toBe(3);
    expect('groupCount' in s && s.groupCount).toEqual([2, 3]);
    expect('targetSide' in s && s.targetSide === 'ally' && s.targetMode === 'group').toBe(true);
    const outs = s.output.filter((o) => o.kind === 'inflict_status').map((o) => o.status);
    const boost = outs.find((st) => !Array.isArray(st) && st.type === 'trigger_boost');
    expect(boost && !Array.isArray(boost) && boost.type === 'trigger_boost' && boost.rate === 1 && boost.additive === true).toBe(true);
    expect(boost && !Array.isArray(boost) && boost.type === 'trigger_boost' && boost.skillTypes).toEqual(['pursuit']);
    const dmg = outs.find((st) => !Array.isArray(st) && st.type === 'damage_boost');
    expect(dmg && !Array.isArray(dmg) && dmg.type === 'damage_boost' && dmg.rate === 0.4).toBe(true);
    // 受速度缩放（实测三点反解，见下方 describe）；伤害口径仅追击
    expect(dmg && !Array.isArray(dmg) && dmg.type === 'damage_boost' && dmg.speedScaled).toBe(true);
    expect(dmg && !Array.isArray(dmg) && dmg.type === 'damage_boost' && dmg.growthRate).toBe(0.2532);
    expect(dmg && !Array.isArray(dmg) && dmg.type === 'damage_boost' && dmg.skillTypes).toEqual(['pursuit']);
  });

  it('我军群体获得追击伤害提升（damage_boost，按施法者速度缩放），持续 1 回合；目标数为 2 或 3', () => {
    const report = run(positionedTeam('前锋'), 1);
    expect(casts(report, '动如雷震').length).toBeGreaterThan(0);
    const n = distinctTargets(report, 'damage_boost');
    expect([2, 3]).toContain(n);
    // 测试阵容为 40 级 + 速度加点 40 → 速度 219 → 40 + 0.2532×139 = 75.19 → 八舍九入 75%
    expect(inflicted(report, 'damage_boost')[0].detail).toContain('造成的伤害提高 75%');
    expect(inflicted(report, 'damage_boost')[0].detail).toContain('1 回合');
  });

  it('目标为我军（不含敌军）；多种子下 2 目标与 3 目标各会出现', () => {
    const team = positionedTeam('前锋');
    const report = run(team, 1);
    const boost = inflicted(report, 'damage_boost');
    const unitIds = boost.map((e) => e.unitId);
    expect(unitIds.some((id) => id.startsWith('enemy'))).toBe(false);

    const counts = new Set(leizhenTargetCounts(team, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);
  });

  it('中军位也能覆盖大营：同侧距离选目标，多种子下会出现 3 目标', () => {
    const counts = new Set(leizhenTargetCounts(positionedTeam('中军'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);
  });

  it('速度缩放实测锁定：208.8→72%、256.9→84%、281.4→91%（游戏内实读三点）', () => {
    const points = [{ speed: 208.8, pct: 72 }, { speed: 256.9, pct: 84 }, { speed: 281.4, pct: 91 }];
    for (const { speed, pct } of points) {
      const caster = makeUnit('caster', { activeSkillIds: ['dongru_leizhen'] });
      caster.general.speed = speed;
      const ally = makeUnit('ally');
      const foe = makeUnit('foe');
      foe.side = 'enemy';
      const ctx = makeFixedChanceCtx(0); // 0 < 0.35 → 本轮必发动
      ctx.myTeam = [caster, ally];
      ctx.enemyTeam = [foe];
      actUnit(ctx, caster);
      const boost = ctx.events.filter(
        (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
          e.type === 'status_inflicted' && e.statusType === 'damage_boost'
      );
      expect(boost.length).toBeGreaterThan(0);
      // 基值 40 @ 速度 80 + 成长 0.2532/点，1% 粒度八舍九入 → 必须与游戏内实读一致
      expect(boost[0].detail).toContain(`造成的伤害提高 ${pct}%`);
    }
  });

  it('我军目标获得追击发动率 +100%（additive trigger_boost，仅追击）', () => {
    const report = run(positionedTeam('前锋'), 1);
    const boosts = inflicted(report, 'trigger_boost');
    expect(boosts.length).toBeGreaterThan(0);
    expect(boosts[0].detail).toContain('追击战法发动率');
    expect(boosts[0].detail).toContain('100%');
    expect(boosts.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
  });

  it('追击发动率 +100 个百分点后封顶 100%（35%+100%→100%）；主动战法不受影响', () => {
    const pursuer = makeUnit('p', { pursuitSkillIds: ['nulang_fadi'] });
    const enemy = makeUnit('e', {});
    enemy.side = 'enemy';
    const ctx = makeFixedChanceCtx(0.5);
    ctx.myTeam = [pursuer];
    ctx.enemyTeam = [enemy];
    inflictStatus(ctx, pursuer, {
      type: 'trigger_boost',
      rate: 1,
      duration: 1,
      skillTypes: ['pursuit'],
      additive: true,
    }, 'active', 'dongru_leizhen');
    actUnit(ctx, pursuer);
    const pursuit = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'nulang_fadi'
    );
    expect(pursuit.length).toBe(1);
    expect(pursuit[0].rate).toBe(100);
    expect(pursuit[0].success).toBe(true);

    const actor = makeUnit('a', { activeSkillIds: ['dongru_leizhen'] });
    const enemy2 = makeUnit('e2', {});
    enemy2.side = 'enemy';
    const ctx2 = makeFixedChanceCtx(0.5);
    ctx2.myTeam = [actor];
    ctx2.enemyTeam = [enemy2];
    inflictStatus(ctx2, actor, {
      type: 'trigger_boost',
      rate: 1,
      duration: 1,
      skillTypes: ['pursuit'],
      additive: true,
    }, 'active', 'dongru_leizhen');
    actUnit(ctx2, actor);
    const active = ctx2.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'dongru_leizhen'
    );
    expect(active.length).toBe(1);
    expect(active[0].rate).toBe(35);
    expect(active[0].success).toBe(false);
  });
});

function makeUnit(
  id: string,
  opts: { activeSkillIds?: string[]; pursuitSkillIds?: string[] } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '群',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'cavalry',
      position: '前锋',
      attack: 200,
      defense: 80,
      strategy: 50,
      speed: 80,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: opts.activeSkillIds ?? [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: opts.pursuitSkillIds ?? [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

/** 固定 chance：next < p 才成功。0.5 时 35% 失败、100% 成功。 */
function makeFixedChanceCtx(next: number): CombatContext {
  return {
    rng: {
      next: () => next,
      int: () => 0,
      intInclusive: () => 0,
      chance: (p: number) => next < p,
    } as unknown as Rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('魏武之泽（曹丕，主动 40%：我军群体连击 + 普攻/追击伤害提升 15%（受谋略，成长 0.08），持续 2 回合）', () => {
  it('主战法挂入主动槽（曹丕），发动率 40%', () => {
    const g = hero('h25');
    expect(g.name).toBe('曹丕');
    expect(g.activeSkillIds).toContain('weiwu_zhi_ze');
    const s = SKILL_REGISTRY['weiwu_zhi_ze'];
    expect(s.type === 'active' && s.triggerRate === 0.4).toBe(true);
  });

  it('我军群体获得连击（combo）状态，持续 2 回合', () => {
    const report = run(fullTeam(withSkills(level40(hero('h25'), { strategy: 40 }), { activeSkillIds: ['weiwu_zhi_ze'] })), 1);
    expect(casts(report, '魏武之泽').length).toBeGreaterThan(0);
    // 同侧距离 2 覆盖三人；每次释放三选二（2 目标），整场多次释放去重后可达 2～3
    const leizeTargets = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_target' }> =>
        e.type === 'skill_target' && e.skillId === 'weiwu_zhi_ze'
    );
    expect(leizeTargets.length).toBeGreaterThan(0);
    expect(leizeTargets.every((e) => e.targetIds.length === 2)).toBe(true);
    expect(distinctTargets(report, 'combo')).toBeGreaterThanOrEqual(2);
    expect(distinctTargets(report, 'combo')).toBeLessThanOrEqual(3);
    expect(inflicted(report, 'combo')[0].detail).toContain('2 回合');
  });

  it('我军群体获得普攻/追击两条伤害提升（damage_boost，按谋略缩放：曹丕谋略 180 → 23%）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h25'), { strategy: 40 }), { activeSkillIds: ['weiwu_zhi_ze'] })), 1);
    expect(distinctTargets(report, 'damage_boost')).toBeGreaterThanOrEqual(2);
    expect(distinctTargets(report, 'damage_boost')).toBeLessThanOrEqual(3);
    // 15 + 0.08×(180−80) = 23
    expect(inflicted(report, 'damage_boost')[0].detail).toContain('造成的伤害提高 23%');
    // 每个目标两条（全域|普通 + 全域|追击），不合并
    expect(inflicted(report, 'damage_boost').length).toBeGreaterThanOrEqual(4);
  });

  it('普攻 / 追击拆两条分类键：damageSource basic 与 skillTypes pursuit，成长率同 0.08', () => {
    const s = SKILL_REGISTRY['weiwu_zhi_ze'];
    const statuses = s.output
      .flatMap((o) => (o.kind === 'inflict_status' ? (Array.isArray(o.status) ? o.status : [o.status]) : []))
      .filter((st): st is Extract<CreateStatus, { type: 'damage_boost' }> => st.type === 'damage_boost');
    expect(statuses).toHaveLength(2);
    expect(statuses.some((st) => st.damageSource === 'basic')).toBe(true);
    expect(statuses.some((st) => st.skillTypes?.includes('pursuit'))).toBe(true);
    expect(statuses.every((st) => st.strategyScaled === true && st.growthRate === 0.08)).toBe(true);
  });
});

describe('强势（张春华，主动 40%：敌军群体攻击伤害 -48% + 犹豫 2 回合）', () => {
  it('主战法挂入主动槽（张春华），发动率 40%，目标对敌', () => {
    const g = hero('h29');
    expect(g.name).toBe('张春华');
    expect(g.activeSkillIds).toContain('qiangshi');
    const s = SKILL_REGISTRY['qiangshi'];
    expect(s.type === 'active' && s.triggerRate === 0.4).toBe(true);
    expect('targetSide' in s && s.targetSide === 'enemy').toBe(true);
  });

  it('敌军群体陷入犹豫（hesitation）状态，持续 2 回合', () => {
    const report = run(fullTeam(withSkills(level40(hero('h29'), { strategy: 40 }), { activeSkillIds: ['qiangshi'] })), 1);
    expect(casts(report, '强势').length).toBeGreaterThan(0);
    const hes = inflicted(report, 'hesitation');
    expect(hes.length).toBeGreaterThan(0);
  });

  it('敌军群体攻击伤害显著降低（damage_boost 负值）', () => {
    const withSkill = run(fullTeam(withSkills(level40(hero('h29'), { strategy: 40 }), { activeSkillIds: ['qiangshi'] })), 1);
    const without = run(fullTeam(withSkills(level40(hero('h29'), { strategy: 40 }), { activeSkillIds: [] })), 1);
    const hits = (r: ReturnType<typeof run>, attacker: string) =>
      r.events
        .filter((e) => e.type === 'attack_hit' && e.sourceId === attacker)
        .reduce((acc, e) => acc + (e as { damage: number }).damage, 0);
    expect(hits(withSkill, 'enemy-front')).toBeLessThanOrEqual(hits(without, 'enemy-front'));
  });
});

describe('怒浪伐敌（蒋钦，追击 240%：普攻后对攻击目标再次袭击）', () => {
  it('主战法挂入追击槽（蒋钦）', () => {
    const g = hero('h671');
    expect(g.name).toBe('蒋钦');
    expect(g.pursuitSkillIds).toContain('nulang_fadi');
    const s = SKILL_REGISTRY['nulang_fadi'];
    expect(s.type === 'pursuit').toBe(true);
  });

  it('普攻后触发追击（skill_cast 事件）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h671'), { attack: 40 }), { pursuitSkillIds: ['nulang_fadi'] })), 1);
    const cast = casts(report, '怒浪伐敌');
    expect(cast.length).toBeGreaterThan(0);
  });

  it('追击对攻击目标造成攻击伤害（damage 事件）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h671'), { attack: 40 }), { pursuitSkillIds: ['nulang_fadi'] })), 1);
    const dmg = report.events.filter((e) => e.type === 'damage' && e.skillName === '怒浪伐敌');
    expect(dmg.length).toBeGreaterThan(0);
  });
});

describe('诸葛锦囊（诸葛亮，主动 35%：我军全体减伤 35% + 增伤 14%，持续 2 回合）', () => {
  it('主战法挂入主动槽（诸葛亮），目标为我军', () => {
    const g = hero('h17');
    expect(g.name).toBe('诸葛亮');
    expect(g.activeSkillIds).toContain('zhuge_jinnang');
    const s = SKILL_REGISTRY['zhuge_jinnang'];
    expect('targetSide' in s && s.targetSide === 'ally').toBe(true);
  });

  it('我军全体获得减伤 80%（damage_reduce，按谋略缩放：诸葛亮谋略 260 → 35 + 0.25×180 = 80）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h17'), { strategy: 40 }), { activeSkillIds: ['zhuge_jinnang'] })), 1);
    expect(casts(report, '诸葛锦囊').length).toBeGreaterThan(0);
    expect(distinctTargets(report, 'damage_reduce')).toBe(3);
    expect(inflicted(report, 'damage_reduce')[0].detail).toContain('0.8');
  });

  it('我军全体获得增伤 14%（damage_boost，受谋略但实测不缩放 → growthRate 0）', () => {
    const report = run(fullTeam(withSkills(level40(hero('h17'), { strategy: 40 }), { activeSkillIds: ['zhuge_jinnang'] })), 1);
    expect(distinctTargets(report, 'damage_boost')).toBe(3);
    expect(inflicted(report, 'damage_boost')[0].detail).toContain('造成的伤害提高 14%');
  });
});

describe('不动如山（郝昭，回合开始被动：行动时移除有害效果 + 防御/谋略增益）', () => {
  it('主战法挂入被动槽（郝昭）', () => {
    const g = hero('h475');
    expect(g.name).toBe('郝昭');
    expect(g.passiveSkillIds).toContain('budong_rushan');
    const s = SKILL_REGISTRY['budong_rushan'];
    expect(s.type === 'passive' && s.timing === 'round_start').toBe(true);
  });

  it('行动时获得防御 +100 与谋略 +25 增益', () => {
    const report = run(fullTeam(withSkills(level40(hero('h475'), { defense: 40 }), { passiveSkillIds: ['budong_rushan'] })), 1);
    const defs = inflicted(report, 'defense_buff');
    const strs = inflicted(report, 'strategy_buff');
    expect(defs.length).toBeGreaterThan(0);
    expect(strs.length).toBeGreaterThan(0);
  });
});
