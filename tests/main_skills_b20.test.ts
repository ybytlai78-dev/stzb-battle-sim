/**
 * 五星主战法第一刀：2 回合准备 + 发动率区间（Task 2）。
 * 后续任务往同一文件追加战法用例。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, triggerActiveSkill, triggerPassiveSkills, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '4星', cost: 1, faction: '晋', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 80, defense: 80, strategy: 80, speed: 50, attackRange: 5, maxTroops: 10000,
    mainSkillName: '', skillDesc: '',
    activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [],
    morale: 100, ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0, alive: true,
    statuses: [], isPreparing: false, preparingSkillId: null, hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

/**
 * 深拷贝战法写入 ctx.skills，用于强制 triggerRate / chance_group / chain。
 * 嵌套 chance_group 与 chain 必须随 structuredClone 一起改，避免改到 registry 单例。
 */
function forceSkill(ctx: CombatContext, id: string, patch: (s: Skill) => void): void {
  const cloned = structuredClone(SKILL_REGISTRY[id]) as Skill;
  patch(cloned);
  ctx.skills.set(id, cloned);
}

/** 指定 skillId 的伤害事件。 */
function skillDamage(ctx: CombatContext, skillId: string): Extract<BattleEvent, { type: 'damage' }>[] {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> =>
    e.type === 'damage' && e.skillId === skillId
  );
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

function prepSkill(extra: Record<string, unknown> = {}): Skill {
  return {
    id: 'test_prep2', name: '二回合准备', type: 'active', prepare: true, prepareTurns: 2,
    range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
    ...extra,
  } as Skill;
}

describe('2 回合准备', () => {
  it('发动成功当回合 prepare_start，下一行动仍准备，再下一行动 prepare_end + damage', () => {
    const skill = prepSkill();
    const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_prep2'], speed: 100 }));
    const foe = makeUnit(dummy('foe', '大营'), 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set(skill.id, skill);

    actUnit(ctx, me); // 进入准备
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === skill.id)).toBe(true);
    expect(ctx.events.some((e) => e.type === 'prepare_end')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === skill.id)).toBe(false);
    expect(me.isPreparing).toBe(true);
    expect(me.prepareLeft).toBe(2);

    ctx.currentRound = 2;
    actUnit(ctx, me); // 中间准备回合
    expect(ctx.events.some((e) => e.type === 'prepare_end')).toBe(false);
    expect(me.isPreparing).toBe(true);
    expect(me.prepareLeft).toBe(1);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === skill.id)).toBe(false);

    ctx.currentRound = 3;
    actUnit(ctx, me); // 释放
    expect(ctx.events.some((e) => e.type === 'prepare_end' && e.skillId === skill.id)).toBe(true);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === skill.id)).toBe(true);
    expect(me.isPreparing).toBe(false);
    expect(me.prepareLeft == null || me.prepareLeft === 0).toBe(true);
  });

  it('缺省 prepareTurns 的 1 回合准备：下一行动直接 prepare_end', () => {
    const skill = prepSkill({ prepareTurns: undefined, id: 'test_prep1', name: '一回合准备' });
    const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_prep1'] }));
    const foe = makeUnit(dummy('foe', '大营'), 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set('test_prep1', skill);
    actUnit(ctx, me);
    expect(me.isPreparing).toBe(true);
    expect(me.prepareLeft).toBe(1);
    ctx.currentRound = 2;
    actUnit(ctx, me);
    expect(ctx.events.some((e) => e.type === 'prepare_end' && e.skillId === 'test_prep1')).toBe(true);
    expect(me.isPreparing).toBe(false);
  });
});

describe('发动率区间', () => {
  it('triggerRate [0.5,1] 每次判定抽出 50–100 再走士气；skill_trigger.baseRate 落在该闭区间', () => {
    const skill: Skill = {
      id: 'test_rate_rng', name: '区间', type: 'active', prepare: false,
      range: 5, triggerRate: [0.5, 1], targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 10 }],
    };
    const bases: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_rate_rng'] }));
      const foe = makeUnit(dummy('foe', '大营'), 'enemy');
      const ctx = makeCtx([me], [foe], seed);
      ctx.skills.set(skill.id, skill);
      triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      const tr = ctx.events.find((e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === skill.id
      );
      const baseRate = tr?.baseRate;
      expect(baseRate).toBeGreaterThanOrEqual(50);
      expect(baseRate).toBeLessThanOrEqual(100);
      if (baseRate != null) bases.push(baseRate);
    }
    expect(new Set(bases).size).toBeGreaterThan(1);
  });
});

describe('chance_group', () => {
  it('成功则执行内层全部 output；失败只发 skill_trigger success:false，内层不跑', () => {
    const mk = (chance: number): Skill => ({
      id: 'test_cg', name: '组', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{
        kind: 'chance_group', chance,
        outputs: [
          { kind: 'physical_damage', rate: 160, targetMode: 'single' },
          { kind: 'inflict_status', target: 'self', status: { type: 'damage_boost', rate: 1.6, duration: 999, direction: 'caused', charges: 1, damageSource: 'basic' } },
        ],
      }],
    });
    const run = (chance: number, seed = 1) => {
      const skill = mk(chance);
      const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_cg'] }));
      const foe = makeUnit(dummy('foe', '大营'), 'enemy');
      const ctx = makeCtx([me], [foe], seed);
      ctx.skills.set(skill.id, skill);
      triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      return { ctx, me };
    };
    const ok = run(1);
    expect(ok.ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_cg')).toBe(true);
    expect(ok.me.statuses.some((s) => s.type === 'damage_boost' && s.charges === 1)).toBe(true);

    const fail = run(0);
    expect(fail.ctx.events.some((e) => e.type === 'skill_trigger' && e.skillId === 'test_cg' && e.success === false)).toBe(true);
    expect(fail.ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_cg')).toBe(false);
    expect(fail.me.statuses.some((s) => s.type === 'damage_boost' && s.charges === 1)).toBe(false);
  });
});

describe('chain', () => {
  it('chance 1 + decay 0.5：首段后再打至少 1 段 random_single；目标可不同', () => {
    const skill: Skill = {
      id: 'test_chain', name: '连锁', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'strategy_damage', rate: 95, strategyScaled: true, chain: { chance: 1, decay: 0.5 } }],
    };
    const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_chain'], strategy: 80 }));
    const a = makeUnit(dummy('a', '前锋'), 'enemy');
    const b = makeUnit(dummy('b', '中军'), 'enemy');
    const c = makeUnit(dummy('c', '大营'), 'enemy');
    const ctx = makeCtx([me], [a, b, c]);
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const hits = ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.skillId === 'test_chain' && e.damageType === 'strategy'
    );
    expect(hits.length).toBeGreaterThan(1);
  });

  it('strategyScaled 且无 growthRate：谋略 80 与 200 伤害率同为基值 95', () => {
    const mk = (strategy: number) => {
      const skill: Skill = {
        id: 'test_base', name: '基值', type: 'active', prepare: false,
        range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
        output: [{ kind: 'strategy_damage', rate: 95, strategyScaled: true }],
      };
      const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_base'], strategy }));
      const foe = makeUnit(dummy('foe', '大营', { defense: 80, strategy: 80 }), 'enemy');
      const ctx = makeCtx([me], [foe], 1);
      ctx.skills.set(skill.id, skill);
      triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      const d = ctx.events.find((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'test_base');
      return d?.breakdown?.main;
    };
    expect(mk(80)).toEqual(mk(200));
  });
});

describe('ignoresTroopCounter', () => {
  it('步打骑：带 ignoresTroopCounter 的伤害 modifiers.reduce 无 troop_counter', () => {
    const skill: Skill = {
      id: 'test_ignore', name: '无视', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 450, ignoresTroopCounter: true }],
    };
    const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_ignore'], troopType: 'infantry' }));
    const foe = makeUnit(dummy('foe', '大营', { troopType: 'cavalry' }), 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const d = ctx.events.find((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'test_ignore');
    expect(d).toBeTruthy();
    expect(d?.modifiers?.reduce.some((r) => r.skillId === 'troop_counter')).toBe(false);
  });
});

describe('inflict_status.positions + 混乱 duration 区间', () => {
  it('positions 大营：混乱只打存活大营；duration [1,2] 的 remaining 为 1 或 2', () => {
    const skill: Skill = {
      id: 'test_camp', name: '大营控', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['confusion'],
      output: [{
        kind: 'inflict_status',
        positions: ['大营'],
        status: { type: 'confusion', duration: [1, 2] },
      }],
    };
    const remainings = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_camp'] }));
      const front = makeUnit(dummy('front', '前锋'), 'enemy');
      const camp = makeUnit(dummy('camp', '大营'), 'enemy');
      const ctx = makeCtx([me], [front, camp], seed);
      ctx.skills.set(skill.id, skill);
      triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      expect(front.statuses.some((s) => s.type === 'confusion')).toBe(false);
      const c = camp.statuses.find((s) => s.type === 'confusion');
      expect(c).toBeTruthy();
      if (c && 'remaining' in c) {
        expect([1, 2]).toContain(c.remaining);
        remainings.add(c.remaining);
      }
    }
    expect(remainings.size).toBe(2);
  });
});

describe('charges 与常驻 damage_boost 共存', () => {
  it('无 charges 的 basic +0.8 与 charges:1 的 basic +1.6 是两条，buffMult 加算', () => {
    const me = makeUnit(dummy('me', '前锋'));
    const ctx = makeCtx([me], [makeUnit(dummy('foe', '大营'), 'enemy')]);
    inflictStatus(ctx, me, { type: 'damage_boost', rate: 0.8, duration: 999, direction: 'caused', damageSource: 'basic' }, 'passive', 'huoshou_chongfeng', me.general.id);
    inflictStatus(ctx, me, { type: 'damage_boost', rate: 1.6, duration: 999, direction: 'caused', charges: 1, damageSource: 'basic' }, 'passive', 'huoshou_chongfeng', me.general.id);
    const boosts = me.statuses.filter((s) => s.type === 'damage_boost');
    expect(boosts).toHaveLength(2);
    expect(boosts.some((s) => s.type === 'damage_boost' && s.rate === 0.8 && s.charges == null)).toBe(true);
    expect(boosts.some((s) => s.type === 'damage_boost' && s.rate === 1.6 && s.charges === 1)).toBe(true);
  });
});

describe('maxStacks', () => {
  it('同战法同过滤维叠到 maxStacks 后不再加 rate', () => {
    const me = makeUnit(dummy('me', '前锋'));
    const ctx = makeCtx([me], [makeUnit(dummy('foe', '大营'), 'enemy')]);
    const layer = {
      type: 'damage_boost' as const, rate: 0.1, duration: 999, direction: 'caused' as const,
      damageType: 'strategy' as const, stacks: 1, maxStacks: 3,
    };
    for (let i = 0; i < 5; i++) inflictStatus(ctx, me, layer, 'command', 'wende_jiaofang', me.general.id);
    const s = me.statuses.find((x) => x.type === 'damage_boost' && x.sourceSkillId === 'wende_jiaofang');
    expect(s?.type === 'damage_boost' && s.rate).toBeCloseTo(0.3);
    expect(s?.type === 'damage_boost' && (s.stacks ?? 0)).toBe(3);
  });
});

describe('after_first_active', () => {
  it('进入准备不叠层；准备完成释放才叠；每次重选 2 友军', () => {
    const cmd: Skill = {
      id: 'test_afa', name: '首次后', type: 'command', phase: 'round',
      roundTrigger: 'after_first_active', range: 5, triggerRate: 1,
      targetMode: 'group', groupCount: 2, targetSide: 'ally', tags: ['damage_boost'],
      output: [{
        kind: 'inflict_status',
        status: { type: 'damage_boost', rate: 0.1, duration: 999, direction: 'caused', damageType: 'strategy', stacks: 1, maxStacks: 3 },
      }],
    };
    const active: Skill = {
      id: 'test_prep_afa', name: '准备主动', type: 'active', prepare: true, prepareTurns: 1,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 10 }],
    };
    const caster = makeUnit(dummy('caster', '中军', { activeSkillIds: ['test_prep_afa'], commandSkillIds: ['test_afa'], speed: 80 }));
    const a = makeUnit(dummy('a', '前锋', { speed: 10 }));
    const b = makeUnit(dummy('b', '大营', { speed: 10 }));
    const foe = makeUnit(dummy('foe', '大营'), 'enemy');
    const ctx = makeCtx([caster, a, b], [foe]);
    ctx.skills.set(cmd.id, cmd);
    ctx.skills.set(active.id, active);

    actUnit(ctx, caster);
    expect(caster.isPreparing).toBe(true);
    const stacked = () => [...ctx.myTeam].filter((u) => u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'test_afa'));
    expect(stacked()).toHaveLength(0);

    ctx.currentRound = 2;
    actUnit(ctx, caster);
    expect(stacked()).toHaveLength(2);
  });
});

describe('被动 roundStartRepeat', () => {
  it('battle_start 的 output 只开战一次；roundStartRepeat 每回合行动阶段再跑', () => {
    const skill: Skill = {
      id: 'test_prs', name: '被动重复', type: 'passive', timing: 'battle_start',
      range: 4, triggerRate: 1, targetMode: 'self', tags: ['damage_boost', 'damage'],
      output: [{
        kind: 'inflict_status', target: 'self',
        status: { type: 'damage_boost', rate: 0.8, duration: 999, direction: 'caused', damageSource: 'basic' },
      }],
      roundStartRepeat: {
        output: [{
          kind: 'chance_group', chance: 1,
          outputs: [{ kind: 'physical_damage', rate: 160, targetMode: 'single' }],
        }],
      },
    };
    const me = makeUnit(dummy('me', '前锋', { passiveSkillIds: ['test_prs'] }));
    const foe = makeUnit(dummy('foe', '大营'), 'enemy');
    const ctx = makeCtx([me], [foe]);
    ctx.skills.set(skill.id, skill);
    triggerPassiveSkills(ctx, me, 'battle_start');
    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.rate === 0.8)).toBe(true);
    expect(ctx.events.filter((e) => e.type === 'damage' && e.skillId === 'test_prs')).toHaveLength(0);

    ctx.currentRound = 1;
    actUnit(ctx, me);
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'test_prs' && e.damageType === 'physical')).toBe(true);
  });
});

describe('charges 消耗过滤', () => {
  it('damageType physical 的 charges 不被策略伤害消耗', () => {
    const me = makeUnit(dummy('me', '前锋', { activeSkillIds: ['test_st'] }));
    const ctx = makeCtx([me], [makeUnit(dummy('foe', '大营'), 'enemy')]);
    inflictStatus(ctx, me, { type: 'damage_boost', rate: 0.7, duration: 999, direction: 'caused', charges: 1, damageType: 'physical' }, 'active', 'hubu_guanyou', me.general.id);
    const skill: Skill = {
      id: 'test_st', name: '策略', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'strategy_damage', rate: 50, strategyScaled: false }],
    };
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.charges === 1 && s.sourceSkillId === 'hubu_guanyou')).toBe(true);
  });
});

describe('落首箭（沙摩柯 h524）', () => {
  it('装配：h524 准备主动槽含 luoshou_jian', () => {
    const g = { ...HERO_REGISTRY['h524'] };
    expect(g.name).toBe('沙摩柯');
    expect(g.activeSkillIds).toContain('luoshou_jian');
    const s = SKILL_REGISTRY['luoshou_jian'];
    expect(s.type).toBe('active');
    if (s.type === 'active') {
      expect(s.prepare).toBe(true);
      expect(s.triggerRate).toBe(0.4);
      expect(s.range).toBe(5);
      expect(s.targetMode).toBe('random_single');
      expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 300 });
      expect('targetMode' in s.output[0] ? s.output[0].targetMode : undefined).toBeUndefined();
    }
  });

  it('强制释放：300% 物理任意单体 + 大营再攻 + 大营混乱', () => {
    const me = heroUnit('h524', '前锋', { activeSkillIds: ['luoshou_jian'] });
    const front = makeUnit(dummy('front', '前锋', { maxTroops: 30000 }), 'enemy');
    const mid = makeUnit(dummy('mid', '中军', { maxTroops: 30000 }), 'enemy');
    const camp = makeUnit(dummy('camp', '大营', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [front, mid, camp]);
    forceSkill(ctx, 'luoshou_jian', (s) => { s.triggerRate = 1; });

    actUnit(ctx, me);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'luoshou_jian')).toBe(true);
    ctx.currentRound += 1;
    actUnit(ctx, me);

    const phys = skillDamage(ctx, 'luoshou_jian').filter((e) => e.damageType === 'physical');
    expect(phys.length).toBeGreaterThanOrEqual(2);
    const campHits = phys.filter((e) => e.targetId === camp.general.id);
    expect(campHits.length).toBeGreaterThanOrEqual(1);
    const first = phys[0];
    expect(first).toBeTruthy();
    if (first && first.targetId !== camp.general.id) {
      expect(first.breakdown.main / campHits[0].breakdown.main).toBeCloseTo(300 / 180, 1);
    } else {
      expect(phys.some((e) => e.breakdown.main >= campHits[0].breakdown.main)).toBe(true);
    }
    expect(camp.statuses.some((s) => s.type === 'confusion')).toBe(true);
  });

  it('第一目标钉大营：大营至少两段 physical 且 skillId 为 luoshou_jian', () => {
    const me = heroUnit('h524', '前锋', { activeSkillIds: ['luoshou_jian'] });
    const camp = makeUnit(dummy('camp', '大营', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [camp]);
    forceSkill(ctx, 'luoshou_jian', (s) => { s.triggerRate = 1; });

    actUnit(ctx, me);
    ctx.currentRound += 1;
    actUnit(ctx, me);

    const campPhys = skillDamage(ctx, 'luoshou_jian').filter(
      (e) => e.damageType === 'physical' && e.targetId === camp.general.id,
    );
    expect(campPhys.length).toBeGreaterThanOrEqual(2);
  });

  it('第一段 300% 为距离内随机单体：战报目标与首刀同一人，且不全是前锋', () => {
    const targets = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const me = heroUnit('h524', '前锋', { activeSkillIds: ['luoshou_jian'] });
      const front = makeUnit(dummy('front', '前锋', { maxTroops: 30000 }), 'enemy');
      const mid = makeUnit(dummy('mid', '中军', { maxTroops: 30000 }), 'enemy');
      const camp = makeUnit(dummy('camp', '大营', { maxTroops: 30000 }), 'enemy');
      const ctx = makeCtx([me], [front, mid, camp], seed);
      forceSkill(ctx, 'luoshou_jian', (s) => { s.triggerRate = 1; });
      actUnit(ctx, me);
      ctx.currentRound += 1;
      actUnit(ctx, me);
      const st = ctx.events.find((e) => e.type === 'skill_target' && e.skillId === 'luoshou_jian');
      const first = skillDamage(ctx, 'luoshou_jian').find((e) => e.damageType === 'physical');
      expect(st && st.type === 'skill_target' ? st.targetIds : []).toEqual(first ? [first.targetId] : []);
      if (first) targets.add(first.targetId);
    }
    expect(targets.size).toBeGreaterThan(1);
    expect([...targets].some((id) => id !== 'front')).toBe(true);
  });
});

describe('武将主战法单体选敌：random_single 而非距离最近', () => {
  it('战法层敌军/友军单体为 random_single', () => {
    for (const id of [
      'luoshou_jian',
      'fenghuo_fuzhou',
      'huangtian_yuyin',
      'jinwu_feijiang',
      'kui_xiangta',
      'minghui_tongtou',
      'shangjiang_panfeng',
      'xiandao_qixing',
      'yinlong_chongzhen',
    ]) {
      const s = SKILL_REGISTRY[id];
      expect('targetMode' in s ? s.targetMode : undefined, id).toBe('random_single');
    }
  });

  it('输出层独立选敌的单体刀也是 random_single', () => {
    const huo = SKILL_REGISTRY['huoshou_chongfeng'];
    expect(huo.type).toBe('passive');
    if (huo.type === 'passive') {
      const dmg = huo.roundStartRepeat?.output
        .flatMap((o) => (o.kind === 'chance_group' ? o.outputs : [o]))
        .find((o) => o.kind === 'physical_damage');
      expect(dmg && dmg.kind === 'physical_damage' ? dmg.targetMode : undefined).toBe('random_single');
    }
    const qizuo = SKILL_REGISTRY['qizuo_guimou'];
    expect(qizuo.type).toBe('active');
    if (qizuo.type === 'active') {
      const ally = qizuo.output.find(
        (o) => o.kind === 'inflict_status' && 'targetSide' in o && o.targetSide === 'ally',
      );
      expect(ally && ally.kind === 'inflict_status' ? ally.targetMode : undefined).toBe('random_single');
    }
  });
});

describe('长坂之吼（张飞 h22）', () => {
  it('装配：h22 准备主动槽含 changban_zhihou', () => {
    const g = { ...HERO_REGISTRY['h22'] };
    expect(g.name).toBe('张飞');
    expect(g.activeSkillIds).toContain('changban_zhihou');
    const s = SKILL_REGISTRY['changban_zhihou'];
    expect(s.type).toBe('active');
    if (s.type === 'active') {
      expect(s.prepare).toBe(true);
      if (s.prepare) {
        expect(s.prepareTurns).toBe(2);
        expect(s.groupCount).toEqual([2, 3]);
        const out = s.output[0];
        expect(out.kind).toBe('physical_damage');
        if (out.kind === 'physical_damage') {
          expect(out.rate).toBe(450);
          expect(out.ignoresTroopCounter).toBe(true);
        }
      }
    }
  });

  it('真实战法走 2 回合准备：prepare_start → 仍准备 → prepare_end + damage', () => {
    const me = heroUnit('h22', '前锋', { activeSkillIds: ['changban_zhihou'] });
    const foes = [
      makeUnit(dummy('a', '前锋', { maxTroops: 30000 }), 'enemy'),
      makeUnit(dummy('b', '中军', { maxTroops: 30000 }), 'enemy'),
      makeUnit(dummy('c', '大营', { maxTroops: 30000 }), 'enemy'),
    ];
    const ctx = makeCtx([me], foes);
    forceSkill(ctx, 'changban_zhihou', (s) => { s.triggerRate = 1; });

    actUnit(ctx, me);
    expect(ctx.events.some((e) => e.type === 'prepare_start' && e.skillId === 'changban_zhihou')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'prepare_end')).toBe(false);
    expect(skillDamage(ctx, 'changban_zhihou')).toHaveLength(0);
    expect(me.isPreparing).toBe(true);
    expect(me.prepareLeft).toBe(2);

    ctx.currentRound += 1;
    actUnit(ctx, me);
    expect(ctx.events.some((e) => e.type === 'prepare_end')).toBe(false);
    expect(me.isPreparing).toBe(true);
    expect(me.prepareLeft).toBe(1);
    expect(skillDamage(ctx, 'changban_zhihou')).toHaveLength(0);

    ctx.currentRound += 1;
    actUnit(ctx, me);
    expect(ctx.events.some((e) => e.type === 'prepare_end' && e.skillId === 'changban_zhihou')).toBe(true);
    expect(skillDamage(ctx, 'changban_zhihou').length).toBeGreaterThan(0);
    expect(me.isPreparing).toBe(false);
  });

  it('步兵打骑兵：伤害 modifiers.reduce 无 troop_counter', () => {
    const me = makeUnit(dummy('zhang', '前锋', {
      troopType: 'infantry', activeSkillIds: ['changban_zhihou'], attack: 200, maxTroops: 9000,
    }));
    const foe = makeUnit(dummy('cavalry', '前锋', { troopType: 'cavalry', maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [foe]);
    forceSkill(ctx, 'changban_zhihou', (s) => { s.triggerRate = 1; });

    actUnit(ctx, me);
    ctx.currentRound += 1;
    actUnit(ctx, me);
    ctx.currentRound += 1;
    actUnit(ctx, me);

    const hits = skillDamage(ctx, 'changban_zhihou');
    expect(hits.length).toBeGreaterThan(0);
    for (const d of hits) {
      expect(d.modifiers?.reduce.some((r) => r.skillId === 'troop_counter')).toBe(false);
    }
  });
});

describe('烽火覆周（褒姒 h376）', () => {
  it('装配：h376 主动槽含 fenghuo_fuzhou', () => {
    const g = { ...HERO_REGISTRY['h376'] };
    expect(g.name).toBe('褒姒');
    expect(g.activeSkillIds).toContain('fenghuo_fuzhou');
    const s = SKILL_REGISTRY['fenghuo_fuzhou'];
    expect(s.type).toBe('active');
    if (s.type === 'active') {
      expect(s.triggerRate).toEqual([0.5, 1]);
      const out = s.output[0];
      expect(out.kind).toBe('strategy_damage');
      if (out.kind === 'strategy_damage') {
        expect(out.chain).toEqual({ chance: 0.6, decay: 0.2 });
        expect(out.growthRate).toBeUndefined();
      }
    }
  });

  it('chain.chance=1 decay=0.5：策略伤害超过 1 段', () => {
    const me = makeUnit(dummy('bao', '前锋', { activeSkillIds: ['fenghuo_fuzhou'], strategy: 80 }));
    const foes = [
      makeUnit(dummy('a', '前锋'), 'enemy'),
      makeUnit(dummy('b', '中军'), 'enemy'),
      makeUnit(dummy('c', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([me], foes);
    forceSkill(ctx, 'fenghuo_fuzhou', (s) => {
      s.triggerRate = 1;
      const out = s.output[0];
      if (out.kind === 'strategy_damage' && out.chain) {
        out.chain.chance = 1;
        out.chain.decay = 0.5;
      }
    });
    const skill = ctx.skills.get('fenghuo_fuzhou')!;
    triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const hits = skillDamage(ctx, 'fenghuo_fuzhou').filter((e) => e.damageType === 'strategy');
    expect(hits.length).toBeGreaterThan(1);
    expect(ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'burning')).toBe(false);
  });

  it('无 growthRate：谋略 80 与 200 的 breakdown.main 相同', () => {
    const firstMain = (strategy: number) => {
      const me = makeUnit(dummy('bao', '前锋', { activeSkillIds: ['fenghuo_fuzhou'], strategy }));
      const foe = makeUnit(dummy('foe', '大营', { defense: 80, strategy: 80 }), 'enemy');
      const ctx = makeCtx([me], [foe], 1);
      forceSkill(ctx, 'fenghuo_fuzhou', (s) => {
        s.triggerRate = 1;
        const out = s.output[0];
        if (out.kind === 'strategy_damage' && out.chain) out.chain.chance = 0;
      });
      const skill = ctx.skills.get('fenghuo_fuzhou')!;
      triggerActiveSkill(ctx, me, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      return skillDamage(ctx, 'fenghuo_fuzhou')[0]?.breakdown.main;
    };
    expect(firstMain(80)).toEqual(firstMain(200));
  });
});

describe('虎步关右（夏侯渊 h435）', () => {
  it('装配：h435 主动槽含 hubu_guanyou', () => {
    const g = { ...HERO_REGISTRY['h435'] };
    expect(g.name).toBe('夏侯渊');
    expect(g.activeSkillIds).toContain('hubu_guanyou');
    const s = SKILL_REGISTRY['hubu_guanyou'];
    expect(s.type).toBe('active');
    if (s.type === 'active') {
      expect(s.triggerRate).toBe(1.2);
      expect(s.targetMode).toBe('self');
    }
  });

  it('强制发动后 charges:1 rate:0.7 physical；打出一次物理后 charges 消失', () => {
    const me = heroUnit('h435', '前锋', { activeSkillIds: ['hubu_guanyou'] });
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [foe]);
    forceSkill(ctx, 'hubu_guanyou', (s) => { s.triggerRate = 1; });
    triggerActiveSkill(ctx, me, ctx.skills.get('hubu_guanyou')!, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);

    const boost = me.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'hubu_guanyou');
    expect(boost?.type === 'damage_boost' && boost.charges).toBe(1);
    expect(boost?.type === 'damage_boost' && boost.rate).toBe(0.7);
    expect(boost?.type === 'damage_boost' && boost.damageType).toBe('physical');

    actUnit(ctx, me);
    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'hubu_guanyou' && s.charges != null)).toBe(false);
  });

  it('策略伤害不消耗 charges，也不吃这 70%', () => {
    const me = heroUnit('h435', '前锋', { activeSkillIds: ['hubu_guanyou', 'test_st_hubu'] });
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [foe]);
    forceSkill(ctx, 'hubu_guanyou', (s) => { s.triggerRate = 1; });
    ctx.skills.set('test_st_hubu', {
      id: 'test_st_hubu', name: '策略刀', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'strategy_damage', rate: 50, strategyScaled: false }],
    });
    triggerActiveSkill(ctx, me, ctx.skills.get('hubu_guanyou')!, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    triggerActiveSkill(ctx, me, ctx.skills.get('test_st_hubu')!, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);

    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.charges === 1 && s.sourceSkillId === 'hubu_guanyou')).toBe(true);
    const st = skillDamage(ctx, 'test_st_hubu')[0];
    expect(st).toBeTruthy();
    expect(st?.modifiers?.caused.some((c) => c.rate === 0.7 && c.skillId === 'hubu_guanyou')).toBe(false);
  });
});

describe('火兽冲锋（祝融夫人 h494）', () => {
  it('装配：h494 被动槽含 huoshou_chongfeng', () => {
    const g = { ...HERO_REGISTRY['h494'] };
    expect(g.name).toBe('祝融夫人');
    expect(g.passiveSkillIds).toContain('huoshou_chongfeng');
    const s = SKILL_REGISTRY['huoshou_chongfeng'];
    expect(s.type).toBe('passive');
    if (s.type === 'passive') {
      expect(s.timing).toBe('battle_start');
      expect(s.roundStartRepeat).toBeTruthy();
    }
  });

  it('chance=1：160% 物理 + charges basic +1.6；普攻 modifiers.caused 同时含 0.8 与 1.6', () => {
    const me = makeUnit(dummy('zhu', '前锋', { passiveSkillIds: ['huoshou_chongfeng'], attackRange: 5, attack: 120 }));
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [foe]);
    forceSkill(ctx, 'huoshou_chongfeng', (s) => {
      if (s.type === 'passive' && s.roundStartRepeat) {
        const g = s.roundStartRepeat.output[0];
        if (g.kind === 'chance_group') g.chance = 1;
      }
    });
    triggerPassiveSkills(ctx, me, 'battle_start');
    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.rate === 0.8 && s.charges == null)).toBe(true);

    actUnit(ctx, me);
    const skillHits = skillDamage(ctx, 'huoshou_chongfeng').filter((e) => e.damageType === 'physical');
    expect(skillHits.length).toBeGreaterThanOrEqual(1);
    const atk = ctx.events.find((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');
    expect(atk).toBeTruthy();
    const caused = atk?.modifiers?.caused ?? [];
    expect(caused.some((c) => c.skillId === 'huoshou_chongfeng' && c.rate === 0.8)).toBe(true);
    expect(caused.some((c) => c.skillId === 'huoshou_chongfeng' && c.rate === 1.6)).toBe(true);
  });

  it('chance=0：无 160% 刀、无 charges 层；常驻 0.8 仍在', () => {
    const me = makeUnit(dummy('zhu', '前锋', { passiveSkillIds: ['huoshou_chongfeng'], attackRange: 5 }));
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([me], [foe]);
    forceSkill(ctx, 'huoshou_chongfeng', (s) => {
      if (s.type === 'passive' && s.roundStartRepeat) {
        const g = s.roundStartRepeat.output[0];
        if (g.kind === 'chance_group') g.chance = 0;
      }
    });
    triggerPassiveSkills(ctx, me, 'battle_start');
    actUnit(ctx, me);
    expect(skillDamage(ctx, 'huoshou_chongfeng')).toHaveLength(0);
    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.rate === 1.6 && s.charges === 1)).toBe(false);
    expect(me.statuses.some((s) => s.type === 'damage_boost' && s.rate === 0.8 && s.charges == null)).toBe(true);
  });
});

describe('文德椒房（郭皇后 h655）', () => {
  it('装配：h655 指挥槽含 wende_jiaofang', () => {
    const g = { ...HERO_REGISTRY['h655'] };
    expect(g.name).toBe('郭皇后');
    expect(g.commandSkillIds).toContain('wende_jiaofang');
    const s = SKILL_REGISTRY['wende_jiaofang'];
    expect(s.type).toBe('command');
    if (s.type === 'command') {
      expect(s.roundTrigger).toBe('after_first_active');
    }
  });

  it('首次主动释放后距离内 2 友军策略造成伤害 +0.1', () => {
    const simple: Skill = {
      id: 'test_simple_wende', name: '简单主动', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 10 }],
    };
    const guo = heroUnit('h655', '中军', {
      activeSkillIds: ['test_simple_wende'], commandSkillIds: ['wende_jiaofang'],
    });
    const a = makeUnit(dummy('a', '前锋', { speed: 10 }));
    const b = makeUnit(dummy('b', '大营', { speed: 10 }));
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 30000 }), 'enemy');
    const ctx = makeCtx([guo, a, b], [foe]);
    ctx.skills.set(simple.id, simple);
    actUnit(ctx, guo);
    const stacked = [...ctx.myTeam].filter((u) =>
      u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'wende_jiaofang' && s.rate === 0.1 && s.damageType === 'strategy' && s.direction === 'caused'),
    );
    expect(stacked).toHaveLength(2);
  });

  it('第二回合可重选；同人最多 3 层；准备进入不叠、释放才叠', () => {
    const prep: Skill = {
      id: 'test_prep_wende', name: '准备主动', type: 'active', prepare: true, prepareTurns: 1,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 10 }],
    };
    const simple: Skill = {
      id: 'test_simple_wende2', name: '简单主动', type: 'active', prepare: false,
      range: 5, triggerRate: 1, targetMode: 'single', tags: ['damage'],
      output: [{ kind: 'physical_damage', rate: 10 }],
    };

    const guoPrep = heroUnit('h655', '中军', {
      activeSkillIds: ['test_prep_wende'], commandSkillIds: ['wende_jiaofang'],
    });
    const pa = makeUnit(dummy('pa', '前锋', { speed: 10 }));
    const pb = makeUnit(dummy('pb', '大营', { speed: 10 }));
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 30000 }), 'enemy');
    const ctxPrep = makeCtx([guoPrep, pa, pb], [foe]);
    ctxPrep.skills.set(prep.id, prep);
    actUnit(ctxPrep, guoPrep);
    expect(guoPrep.isPreparing).toBe(true);
    const stackedPrep = () => [...ctxPrep.myTeam].filter((u) =>
      u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'wende_jiaofang'),
    );
    expect(stackedPrep()).toHaveLength(0);
    ctxPrep.currentRound += 1;
    actUnit(ctxPrep, guoPrep);
    expect(stackedPrep()).toHaveLength(2);

    const guo = heroUnit('h655', '中军', {
      activeSkillIds: ['test_simple_wende2'], commandSkillIds: ['wende_jiaofang'],
    });
    const a = makeUnit(dummy('a', '前锋', { speed: 10 }));
    const ctx = makeCtx([guo, a], [makeUnit(dummy('foe2', '前锋', { maxTroops: 30000 }), 'enemy')]);
    ctx.skills.set(simple.id, simple);
    const selectedIds: string[][] = [];
    for (let round = 1; round <= 4; round++) {
      ctx.currentRound = round;
      guo.firstActiveSucceededThisRound = false;
      guo.hasActedThisRound = false;
      actUnit(ctx, guo);
      selectedIds.push(
        [...ctx.myTeam]
          .filter((u) => u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'wende_jiaofang'))
          .map((u) => u.general.id),
      );
    }
    expect(selectedIds[0]).toHaveLength(2);
    expect(selectedIds[1]).toHaveLength(2);
    for (const u of ctx.myTeam) {
      const s = u.statuses.find((x) => x.type === 'damage_boost' && x.sourceSkillId === 'wende_jiaofang');
      if (s && s.type === 'damage_boost') {
        expect(s.stacks ?? 0).toBeLessThanOrEqual(3);
        expect(s.rate).toBeLessThanOrEqual(0.3 + 1e-9);
      }
    }
    const ally = a.statuses.find((x) => x.type === 'damage_boost' && x.sourceSkillId === 'wende_jiaofang');
    expect(ally?.type === 'damage_boost' && (ally.stacks ?? 0)).toBe(3);
  });
});
