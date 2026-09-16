# Final 五星主战法第一刀
**Base:** e16ca80 (working tree; no commit)
**Head:** working tree

## Commits
(none)

## Diff stat

 scripts/build_heroes_seed.mjs |  19 ++
 src/data/listing.ts           |   3 +
 src/data/skills.ts            | 580 ++++++++++++++++++++++++++++++++
 src/engine/action.ts          | 744 +++++++++++++++++++++++++++++++++++++-----
 src/engine/combat.ts          |   6 +-
 src/engine/types.ts           | 116 ++++++-
 tests/prepared_timing.test.ts |  42 ++-
 7 files changed, 1387 insertions(+), 123 deletions(-)


## Untracked files

### tests/main_skills_b20.test.ts

```
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

```

## Full diff (tracked)

```diff
diff --git a/scripts/build_heroes_seed.mjs b/scripts/build_heroes_seed.mjs
index 86b2bbf..c48a9ea 100644
--- a/scripts/build_heroes_seed.mjs
+++ b/scripts/build_heroes_seed.mjs
@@ -91,20 +91,39 @@ const SKILL_ID_BY_NAME = {
   运筹决胜: 'yunchou_juesheng',
   七步释嫌: 'qibu_shixian',
   怀德畏威: 'huaide_weiwei',
   回马: 'huima',
   空城: 'kongcheng',
   攻其不备: 'gongqi_bubei',
   健卒不殆: 'jianzu_budai',
   反击之策: 'fanji_zhice',
   以诱待来: 'yiyou_dailai',
   先声夺人: 'xiansheng_duoren',
+  方圆: 'fangyuan',
+  疏数: 'shushu',
+  衡轭: 'henge',
+  锋矢: 'fengshi',
+  鱼鳞: 'yulin',
+  鹤翼: 'heyi',
+  白刃: 'bairen',
+  全军突击: 'quanjun_tuji',
+  飒沓如星: 'sata_ruxing',
+  落首箭: 'luoshou_jian',
+  长坂之吼: 'changban_zhihou',
+  烽火覆周: 'fenghuo_fuzhou',
+  虎步关右: 'hubu_guanyou',
+  火兽冲锋: 'huoshou_chongfeng',
+  文德椒房: 'wende_jiaofang',
+  万箭齐发: 'wanjian_qifa',
+  文伐: 'wenfa',
+  不攻: 'bugong',
+  恃强淬锋: 'shiqiang_cuifeng',
 };
 
 /** 现有 8 个武将固定拼音 id（测试直接引用 HERO_REGISTRY.<id>） */
 const FIXED_IDS = {
   太史慈: 'taishici',
   周瑜: 'zhouyu',
   孙权: 'sunquan',
   卫瓘: 'weiguan',
   魏延: 'weiyan',
   吕蒙: 'lvmeng',
diff --git a/src/data/listing.ts b/src/data/listing.ts
index f2bccde..799db03 100644
--- a/src/data/listing.ts
+++ b/src/data/listing.ts
@@ -12,20 +12,23 @@ export const OFFLINE_MAIN_SKILLS: Record<string, string> = {
   zhuge_jinnang: '减伤 35% / 增伤 14% 成长未确认（取基值）',
   tongchou_dikai: '每层 ±2% 成长 0.01 未确认',
   fushi_yehuo: '受击增伤 16% 成长 0.1 未确认（火攻/燃烧 0.95 已确认）',
   huangtian_dangli: '妖术 180% 成长 1.0 未确认',
   weiwu_zhi_ze: '增伤 15% 成长未确认（取基值）',
   minghui_tongtou: '恢复 168% 成长 1.0 未确认',
   hanyun_kuangye: '伤害降低 30% 成长未确认（取基值）',
   bailou_duwu: '伤害降低 26% 成长未确认（取基值）',
   biyue: '防御 -29 成长未确认',
   shangshun_fani: '策略反击 180% 成长未确认（恢复 65%/0.325 已确认）',
+  fenghuo_fuzhou: '火攻 95% 谋略成长未确认',
+  hubu_guanyou: '首次攻击 +70% 速度成长未确认',
+  wende_jiaofang: '策略增伤 10% 谋略成长未确认',
 };
 
 /**
  * 可学习战法：描述含「受谋略」但成长率未确认（含取基值、0.7/1.0 惯例、次要效果未确认）。
  * 主战法不进本表（由 OFFLINE_MAIN_SKILLS + MAIN_SKILL_IDS 处理）。
  */
 export const OFFLINE_LEARNABLE_SKILLS: Record<string, string> = {
   lianzhong_dingqi: '恢复 85% 成长未确认（§七须再问）',
   jijiu: '恢复 108% 成长未确认（§七须再问）',
   baozha: '恢复 98% 成长未确认（§七须再问）',
diff --git a/src/data/skills.ts b/src/data/skills.ts
index 3301b11..95ba529 100644
--- a/src/data/skills.ts
+++ b/src/data/skills.ts
@@ -3310,11 +3310,591 @@ export const SKILL_REGISTRY: Record<string, Skill> = {
     range: 5,
     targetMode: 'self',
     endRound: 3,
     tags: ['combo', 'split', 'damage'],
     output: [
       { kind: 'inflict_status', chance: 0.6, status: { type: 'combo', duration: 1 }, target: 'self' },
       { kind: 'inflict_status', chance: 0.6, status: { type: 'split', rate: 70, duration: 1 }, target: 'self' },
       { kind: 'physical_damage', chance: 0.6, rate: 110, targetMode: 'single' },
     ],
   },
+
+  // ─── 拆解通用 B+ 第二阶段兵种阵型 ───
+
+  /**
+   * 方圆（B 一类指挥）：战斗中使我军全体步兵普攻造成伤害降低 20%，主动、追击战法伤害提高 16.8%（受防御基值，无成长率）。
+   */
+  fangyuan: {
+    id: 'fangyuan',
+    name: '方圆',
+    type: 'command',
+    phase: 'prep',
+    range: 3,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['damage_boost'],
+    output: [
+      {
+        kind: 'inflict_status',
+        troopTypes: ['infantry'],
+        status: { type: 'damage_boost', rate: -0.2, duration: 999, direction: 'caused', damageSource: 'basic' },
+      },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['infantry'],
+        status: {
+          type: 'damage_boost',
+          rate: 0.168,
+          duration: 999,
+          direction: 'caused',
+          damageSource: 'skill',
+          skillTypes: ['active', 'pursuit'],
+          defenseScaled: true,
+        },
+      },
+    ],
+  },
+  /**
+   * 疏数（B 一类指挥）：仅弓+骑阵容生效。弓兵防御 +50，骑兵每回合 40% 对距离 3 敌军单体代打物理 100%。基值无成长率。
+   */
+  shushu: {
+    id: 'shushu',
+    name: '疏数',
+    type: 'command',
+    phase: 'prep',
+    range: 2,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['buff_defense', 'damage'],
+    teamTroopFilter: ['archer', 'cavalry'],
+    output: [
+      {
+        kind: 'inflict_status',
+        troopTypes: ['archer'],
+        status: { type: 'defense_buff', amount: 50, duration: 999 },
+      },
+    ],
+    roundStartRepeat: {
+      output: [
+        {
+          kind: 'physical_damage',
+          rate: 100,
+          attacker: 'recipient',
+          troopTypes: ['cavalry'],
+          chance: 0.4,
+          range: 3,
+          targetMode: 'single',
+        },
+      ],
+    },
+  },
+  /**
+   * 衡轭（B 一类指挥）：仅骑+步阵容生效。骑兵谋略 +50，步兵普攻造成伤害提升 50%。基值无成长率。
+   */
+  henge: {
+    id: 'henge',
+    name: '衡轭',
+    type: 'command',
+    phase: 'prep',
+    range: 2,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['buff_strategy', 'damage_boost'],
+    teamTroopFilter: ['cavalry', 'infantry'],
+    output: [
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry'],
+        status: { type: 'strategy_buff', amount: 50, duration: 999 },
+      },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['infantry'],
+        status: { type: 'damage_boost', rate: 0.5, duration: 999, direction: 'caused', damageSource: 'basic' },
+      },
+    ],
+  },
+  /**
+   * 锋矢（B 一类指挥）：我军全体骑兵普攻造成伤害降低 25%，发动主动战法伤害提高 18%（受速度基值，无成长率；不含追击）。
+   */
+  fengshi: {
+    id: 'fengshi',
+    name: '锋矢',
+    type: 'command',
+    phase: 'prep',
+    range: 3,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['damage_boost'],
+    output: [
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry'],
+        status: { type: 'damage_boost', rate: -0.25, duration: 999, direction: 'caused', damageSource: 'basic' },
+      },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry'],
+        status: {
+          type: 'damage_boost',
+          rate: 0.18,
+          duration: 999,
+          direction: 'caused',
+          damageSource: 'skill',
+          skillTypes: ['active'],
+          speedScaled: true,
+        },
+      },
+    ],
+  },
+  /**
+   * 鱼鳞（B 一类指挥）：仅步+弓阵容生效。步兵防御 +50，弓兵受策略伤害降低 35%。基值无成长率。
+   */
+  yulin: {
+    id: 'yulin',
+    name: '鱼鳞',
+    type: 'command',
+    phase: 'prep',
+    range: 2,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['buff_defense', 'damage_boost'],
+    teamTroopFilter: ['infantry', 'archer'],
+    output: [
+      {
+        kind: 'inflict_status',
+        troopTypes: ['infantry'],
+        status: { type: 'defense_buff', amount: 50, duration: 999 },
+      },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['archer'],
+        status: { type: 'damage_boost', rate: -0.35, duration: 999, direction: 'taken', damageType: 'strategy' },
+      },
+    ],
+  },
+  /**
+   * 鹤翼（B 一类指挥）：第 1/3/5/7 回合弓兵分兵 49%（受谋略基值，无成长率），同时普攻造成伤害降低 20%，持续 1 回合。
+   */
+  heyi: {
+    id: 'heyi',
+    name: '鹤翼',
+    type: 'command',
+    phase: 'prep',
+    range: 3,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['split', 'damage_boost'],
+    output: [],
+    roundStartRepeat: {
+      oddRounds: true,
+      output: [
+        {
+          kind: 'inflict_status',
+          troopTypes: ['archer'],
+          status: { type: 'split', rate: 49, duration: 1, strategyScaled: true },
+        },
+        {
+          kind: 'inflict_status',
+          troopTypes: ['archer'],
+          status: { type: 'damage_boost', rate: -0.2, duration: 1, direction: 'caused', damageSource: 'basic' },
+        },
+      ],
+    },
+  },
+  /**
+   * 白刃（A 一类指挥）：前 3 回合敌我全体策略造成伤害降低 35%；我军骑/步防御 +45；第 4 回合起骑/步攻击 +45 持续 3 回合。基值无成长率。
+   */
+  bairen: {
+    id: 'bairen',
+    name: '白刃',
+    type: 'command',
+    phase: 'prep',
+    range: 5,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['damage_boost', 'buff_defense', 'buff_attack'],
+    output: [
+      {
+        kind: 'inflict_status',
+        targetSide: 'ally',
+        targetMode: 'all',
+        status: { type: 'damage_boost', rate: -0.35, duration: 3, direction: 'caused', damageType: 'strategy' },
+      },
+      {
+        kind: 'inflict_status',
+        targetSide: 'enemy',
+        targetMode: 'all',
+        status: { type: 'damage_boost', rate: -0.35, duration: 3, direction: 'caused', damageType: 'strategy' },
+      },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry', 'infantry'],
+        status: { type: 'defense_buff', amount: 45, duration: 3 },
+      },
+    ],
+    roundStartRepeat: {
+      startRound: 4,
+      endRound: 4,
+      output: [
+        {
+          kind: 'inflict_status',
+          troopTypes: ['cavalry', 'infantry'],
+          status: { type: 'attack_buff', amount: 45, duration: 3 },
+        },
+      ],
+    },
+  },
+  /**
+   * 全军突击（A 主动 35% 距离 4）：移除我军骑/步有害效果，对敌军单体物理 145%，并使骑/步接下来 2 次攻击伤害提高 28%（受谋略基值，无成长率）。
+   */
+  quanjun_tuji: {
+    id: 'quanjun_tuji',
+    name: '全军突击',
+    type: 'active',
+    prepare: false,
+    range: 4,
+    triggerRate: 0.35,
+    targetMode: 'group',
+    groupCount: 3,
+    targetSide: 'ally',
+    tags: ['immunity', 'damage', 'damage_boost'],
+    output: [
+      { kind: 'remove_debuffs', troopTypes: ['cavalry', 'infantry'] },
+      { kind: 'physical_damage', rate: 145, targetMode: 'single' },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry', 'infantry'],
+        status: { type: 'damage_boost', rate: 0.28, duration: 999, direction: 'caused', charges: 2, strategyScaled: true },
+      },
+    ],
+  },
+  /**
+   * 飒沓如星（B 主动 40% 距离 2）：友军群体 2 中骑兵普攻造成伤害提升 36%（受谋略基值，无成长率）持续 2 回合，下 2 次普攻分兵 55%（不受谋略）。
+   */
+  sata_ruxing: {
+    id: 'sata_ruxing',
+    name: '飒沓如星',
+    type: 'active',
+    prepare: false,
+    range: 2,
+    triggerRate: 0.4,
+    targetMode: 'group',
+    groupCount: 2,
+    targetSide: 'ally',
+    tags: ['damage_boost', 'split'],
+    output: [
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry'],
+        status: {
+          type: 'damage_boost',
+          rate: 0.36,
+          duration: 2,
+          direction: 'caused',
+          damageSource: 'basic',
+          strategyScaled: true,
+        },
+      },
+      {
+        kind: 'inflict_status',
+        troopTypes: ['cavalry'],
+        status: { type: 'split', rate: 55, duration: 999, charges: 2 },
+      },
+    ],
+  },
+  /**
+   * 落首箭（沙摩柯 h524·准备主动 40% 距离 5）：前半口径。对敌军单体物理 300%，并对大营再攻 180% + 混乱 1–2 回合（无受击增伤）。
+   */
+  luoshou_jian: {
+    id: 'luoshou_jian',
+    name: '落首箭',
+    type: 'active',
+    prepare: true,
+    range: 5,
+    triggerRate: 0.4,
+    targetMode: 'single',
+    targetSide: 'enemy',
+    tags: ['damage', 'confusion'],
+    output: [
+      { kind: 'physical_damage', rate: 300 },
+      { kind: 'positional_physical_damage', positions: ['大营'], rate: 180, source: 'self' },
+      { kind: 'inflict_status', positions: ['大营'], status: { type: 'confusion', duration: [1, 2] } },
+    ],
+  },
+  /**
+   * 长坂之吼（张飞 h22·准备主动 75% 距离 4）：前半口径。2 回合准备，敌军群体 2–3 目标物理 450%，无视兵种相克（非三次单体）。
+   */
+  changban_zhihou: {
+    id: 'changban_zhihou',
+    name: '长坂之吼',
+    type: 'active',
+    prepare: true,
+    prepareTurns: 2,
+    range: 4,
+    triggerRate: 0.75,
+    targetMode: 'group',
+    groupCount: [2, 3],
+    tags: ['damage'],
+    output: [{ kind: 'physical_damage', rate: 450, ignoresTroopCounter: true }],
+  },
+  /**
+   * 烽火覆周（褒姒 h376·主动 50%–100% 距离 5）：火攻 95% 受谋略但无 growthRate（取基值）；连锁 60% 每次 −20%。
+   */
+  fenghuo_fuzhou: {
+    id: 'fenghuo_fuzhou',
+    name: '烽火覆周',
+    type: 'active',
+    prepare: false,
+    range: 5,
+    triggerRate: [0.5, 1],
+    targetMode: 'single',
+    tags: ['damage'],
+    output: [{
+      kind: 'strategy_damage',
+      rate: 95,
+      strategyScaled: true,
+      chain: { chance: 0.6, decay: 0.2 },
+    }],
+  },
+  /**
+   * 虎步关右（夏侯渊 h435·主动 120% 距离 1）：前半口径。自身首次攻击伤害 +70% 受速度但无 growthRate（取基值），charges 1（无主动战法叠层）。
+   */
+  hubu_guanyou: {
+    id: 'hubu_guanyou',
+    name: '虎步关右',
+    type: 'active',
+    prepare: false,
+    range: 1,
+    triggerRate: 1.2,
+    targetMode: 'self',
+    targetSide: 'ally',
+    tags: ['damage_boost'],
+    output: [{
+      kind: 'inflict_status',
+      target: 'self',
+      status: {
+        type: 'damage_boost',
+        rate: 0.7,
+        duration: 999,
+        direction: 'caused',
+        charges: 1,
+        speedScaled: true,
+        damageType: 'physical',
+      },
+    }],
+  },
+  /**
+   * 火兽冲锋（祝融夫人 h494·被动）：开战普攻造成伤害 +80%；每回合行动阶段 50% 对敌军单体物理 160% 且下一次普攻 +160%（charges 1）。
+   */
+  huoshou_chongfeng: {
+    id: 'huoshou_chongfeng',
+    name: '火兽冲锋',
+    type: 'passive',
+    timing: 'battle_start',
+    range: 4,
+    triggerRate: 1,
+    targetMode: 'self',
+    tags: ['damage', 'damage_boost'],
+    output: [{
+      kind: 'inflict_status',
+      target: 'self',
+      status: {
+        type: 'damage_boost',
+        rate: 0.8,
+        duration: 999,
+        direction: 'caused',
+        damageSource: 'basic',
+      },
+    }],
+    roundStartRepeat: {
+      output: [{
+        kind: 'chance_group',
+        chance: 0.5,
+        outputs: [
+          { kind: 'physical_damage', rate: 160, targetMode: 'single' },
+          {
+            kind: 'inflict_status',
+            target: 'self',
+            status: {
+              type: 'damage_boost',
+              rate: 1.6,
+              duration: 999,
+              direction: 'caused',
+              charges: 1,
+              damageSource: 'basic',
+            },
+          },
+        ],
+      }],
+    },
+  },
+  /**
+   * 文德椒房（郭皇后 h655·二类指挥）：每回合首次主动实际释放后，我军群体 2 策略造成伤害 +10% 受谋略但无 growthRate（取基值），最多 3 层。
+   */
+  wende_jiaofang: {
+    id: 'wende_jiaofang',
+    name: '文德椒房',
+    type: 'command',
+    phase: 'round',
+    roundTrigger: 'after_first_active',
+    range: 2,
+    triggerRate: 1,
+    targetMode: 'group',
+    groupCount: 2,
+    targetSide: 'ally',
+    tags: ['damage_boost'],
+    output: [{
+      kind: 'inflict_status',
+      status: {
+        type: 'damage_boost',
+        rate: 0.1,
+        duration: 999,
+        direction: 'caused',
+        damageType: 'strategy',
+        strategyScaled: true,
+        stacks: 1,
+        maxStacks: 3,
+      },
+    }],
+  },
+  /**
+   * 万箭齐发（A 主动 35% 距离 5）：敌军群体 2 物理 150%；目标策略造成伤害 −50%（受攻击，无成长率）持续 1 回合（行动中施加 duration 2）。
+   */
+  wanjian_qifa: {
+    id: 'wanjian_qifa',
+    name: '万箭齐发',
+    type: 'active',
+    prepare: false,
+    range: 5,
+    triggerRate: 0.35,
+    targetMode: 'group',
+    groupCount: 2,
+    targetSide: 'enemy',
+    tags: ['damage', 'damage_boost'],
+    output: [
+      { kind: 'physical_damage', rate: 150 },
+      {
+        kind: 'inflict_status',
+        status: {
+          type: 'damage_boost',
+          rate: -0.5,
+          duration: 2,
+          direction: 'caused',
+          damageType: 'strategy',
+          attackScaled: true,
+        },
+      },
+    ],
+  },
+  /**
+   * 文伐（B 追击 20%–40%）：对攻击目标策略 228%（受谋略 2.1%/点），再使其下一次受到策略攻击伤害 +20%（taken charges 1，无成长率）。
+   */
+  wenfa: {
+    id: 'wenfa',
+    name: '文伐',
+    type: 'pursuit',
+    range: 0,
+    triggerRate: [0.2, 0.4],
+    tags: ['damage', 'damage_boost'],
+    output: [
+      { kind: 'strategy_damage', rate: 228, strategyScaled: true, growthRate: 2.1 },
+      {
+        kind: 'inflict_status',
+        status: {
+          type: 'damage_boost',
+          rate: 0.2,
+          duration: 999,
+          direction: 'taken',
+          damageType: 'strategy',
+          charges: 1,
+        },
+      },
+    ],
+  },
+  /**
+   * 不攻（S 一类指挥）：自身整场怯战 + 策略造成 +25%；每回合开始后对距离 5 敌军单体策略 83%（满级基值，无成长率）。
+   */
+  bugong: {
+    id: 'bugong',
+    name: '不攻',
+    type: 'command',
+    phase: 'prep',
+    range: 1,
+    triggerRate: 1,
+    targetMode: 'self',
+    tags: ['cowardice', 'damage_boost', 'damage'],
+    output: [
+      { kind: 'inflict_status', status: { type: 'cowardice', duration: 999 } },
+      {
+        kind: 'inflict_status',
+        status: {
+          type: 'damage_boost',
+          rate: 0.25,
+          duration: 999,
+          direction: 'caused',
+          damageType: 'strategy',
+        },
+      },
+    ],
+    roundStartRepeat: {
+      output: [
+        {
+          kind: 'strategy_damage',
+          rate: 83,
+          strategyScaled: true,
+          targetMode: 'single',
+          range: 5,
+        },
+      ],
+    },
+  },
+  /**
+   * 恃强淬锋（A 被动）：受策略伤害 −30%（受攻击，无成长率）五份衰减；回合开始或每次造成物理伤害 +3.4%/层（受攻击，无成长率），最多 12 层至战斗结束。
+   */
+  shiqiang_cuifeng: {
+    id: 'shiqiang_cuifeng',
+    name: '恃强淬锋',
+    type: 'passive',
+    triggerRate: 1,
+    timing: 'battle_start',
+    range: 1,
+    targetMode: 'self',
+    tags: ['damage_boost'],
+    output: [
+      {
+        kind: 'inflict_status',
+        status: {
+          type: 'damage_boost',
+          rate: -0.3,
+          duration: 999,
+          direction: 'taken',
+          damageType: 'strategy',
+          attackScaled: true,
+          decayFifths: 5,
+        },
+      },
+    ],
+    selfPhysBoost: {
+      perStack: 0.034,
+      maxStacks: 12,
+      duration: 999,
+      attackScaled: true,
+      onRoundStart: true,
+      onDealPhysical: true,
+    },
+  },
 };
diff --git a/src/engine/action.ts b/src/engine/action.ts
index 2506099..6cf3180 100644
--- a/src/engine/action.ts
+++ b/src/engine/action.ts
@@ -13,32 +13,46 @@ import type {
   DamageType,
   DotStoredDamage,
   OnHealConfig,
   OnHurtConfig,
   Position,
   Skill,
   SkillOutput,
   SkillType,
   Status,
   StatusType,
+  TroopType,
   UnitState,
   WoundedMortalityConfig,
 } from './types';
 import type { Rng } from './rng';
 import { calcDamage, applyTroopCap, scaledValue, roundRate, sumRates, buffMult, calcHealAmount, moraleRate, applyIgnoreDef, troopCounterReduce } from './formulas';
 import { nearestEnemy, skillTargets, distanceBetween, adjacentUnits, sameSideDistance, POSITION_INDEX } from './target';
 
 /** 兵种克制减伤率（加算进增减伤单一总和）：被克制方攻击克制方 0.3，否则 0 */
 function troopCounterReduceOf(source: UnitState, target: UnitState): number {
   return troopCounterReduce(source.general.troopType, target.general.troopType);
 }
 
+/**
+ * 开场上阵兵种集合是否 ⊆ allowed（不论 alive）。
+ * @param team 该侧部署名单
+ * @param allowed 允许的兵种
+ */
+export function teamPassesTroopFilter(team: UnitState[], allowed: TroopType[]): boolean {
+  const set = new Set(team.map((u) => u.general.troopType));
+  for (const t of set) {
+    if (!allowed.includes(t)) return false;
+  }
+  return set.size > 0 || allowed.length === 0;
+}
+
 /** 带发动率属性的战法生效概率 = 基础率 × 施法者士气系数（四舍五入取整到百分位），上限 100% */
 function moraleTriggerRate(morale: number, baseRate: number): number {
   return Math.min(1, Math.round(baseRate * moraleRate(morale) * 100) / 100);
 }
 
 /**
  * 发动率提升后的基础率（士气封顶前）。
  *  缺省（难知如阴）：基础率 × (1 + rate)，主动/追击都吃。
  *  additive（动如雷震）：基础率 + rate（+100% = +1.0），超过 100% 由 moraleTriggerRate 封顶。
  *  skillTypes 限定战法类型（动如雷震仅追击）；多种 trigger_boost 按施加顺序叠加。
@@ -47,20 +61,36 @@ function boostedBaseRate(unit: UnitState, skillType: SkillType, baseRate: number
   let rate = baseRate;
   for (const s of unit.statuses) {
     if (s.type !== 'trigger_boost') continue;
     if (s.skillTypes && s.skillTypes.length > 0 && !s.skillTypes.includes(skillType)) continue;
     if (s.additive) rate += s.rate;
     else rate *= 1 + s.rate;
   }
   return rate;
 }
 
+/**
+ * 发动率：数字原样；区间则每次用 intInclusive 抽整数百分再 /100（烽火覆周 50–100）。
+ */
+function rollTriggerRate(rng: Rng, triggerRate: number | [number, number]): number {
+  if (!Array.isArray(triggerRate)) return triggerRate;
+  return rng.intInclusive(Math.round(triggerRate[0] * 100), Math.round(triggerRate[1] * 100)) / 100;
+}
+
+/**
+ * CreateStatus.duration：数字原样。区间应在 inflictStatus 入口已掷成数字；若仍是元组则取下界兜底。
+ */
+function remainingFromDuration(duration: number | [number, number] | undefined): number {
+  if (Array.isArray(duration)) return duration[0];
+  return duration ?? 0;
+}
+
 /** 指挥战法锁定目标：准备阶段锁定，后续回合/延迟结算用 */
 export interface LockedCommand {
   skill: CommandSkill;
   casterId: string;
   targets: UnitState[];
   /**
    * roundRepeat 目标侧与战法 targetSide 不同时的预备判定目标（母仪浮梦：规避锁友军，减伤锁敌军）。
    * 缺省沿用 targets。
    */
   repeatTargets?: UnitState[];
@@ -172,37 +202,41 @@ export function triggerCommandSkills(ctx: CombatContext, unit: UnitState): void
     let targets: UnitState[];
     if (skill.targetMode === 'self') {
       targets = [unit];
     } else if (skill.targetSide === 'ally') {
       // 增益型指挥（金匮要略：我军全体减伤；大赏三军：我军群体造成伤害提高）
       // 尊重战法 targetMode（all=全体 / group=群体2目标），缺省按 group
       const allyMode: 'single' | 'group' | 'all' =
         skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
           ? skill.targetMode
           : 'group';
-      targets = skillTargets(ctx, unit, allies, skill.range, allyMode);
+      targets = skillTargets(ctx, unit, allies, skill.range, allyMode, skill.groupCount);
     } else if (skill.targetSide === 'enemy') {
       // 对敌指挥（白楼独舞：前 3 回合敌军群体减伤）：按 targetMode 选敌军
       const enemyMode: 'single' | 'group' | 'all' =
         skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
           ? skill.targetMode
           : 'all';
       targets = skillTargets(ctx, unit, enemies, skill.range, enemyMode);
     } else {
       const lockMode: 'single' | 'group' | 'all' =
         skill.roundRepeat?.targetMode ??
         (skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
           ? skill.targetMode
           : 'all');
       targets = skillTargets(ctx, unit, enemies, skill.range, lockMode);
     }
     if (targets.length === 0) continue;
+    if (skill.teamTroopFilter && !teamPassesTroopFilter(
+      unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam,
+      skill.teamTroopFilter
+    )) continue;
     ctx.events.push({
       type: 'skill_target',
       unitId: unit.general.id,
       skillId: skill.id,
       targetIds: targets.map((t) => t.general.id),
     });
     ctx.events.push({
       type: 'skill_cast',
       unitId: unit.general.id,
       skillId: skill.id,
@@ -688,22 +722,24 @@ function executeRoundCommand(ctx: CombatContext, unit: UnitState, skill: Command
       let attacked = false;
       for (const raw of positioned) {
         if (!raw.alive) continue;
         const t = redirectPhysicalHit(ctx, raw);
         if (!t.alive) continue;
         attacked = true;
         // 常驻伤害前叠层（持节镇西）：伤害源叠攻击、受击者叠防御
         triggerStackBuff(ctx, source, t, 'physical');
         const atk = effectiveStat(source, 'attack');
         const def = physicalTargetDefense(source, t);
-        const { causedMult, takenMult } = damageBoosts(ctx, source, t);
-        const reduce = sumRates(t.statuses, 'damage_reduce') + troopCounterReduceOf(source, t);
+        const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: 'command' };
+        const { causedMult, takenMult } = damageBoosts(ctx, source, t, hit);
+        const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(source, t);
+        const reduce = sumReduce(t, hit) + counterReduce;
         const { damage, breakdown } = calcDamage(
           {
             damageType: 'physical',
             rate,
             attackerAttack: atk,
             attackerStrategy: source.general.strategy,
             attackerTroops: source.troops,
             targetDefense: def,
             targetStrategy: t.general.strategy,
             mult: buffMult(causedMult, takenMult, reduce),
@@ -715,43 +751,43 @@ function executeRoundCommand(ctx: CombatContext, unit: UnitState, skill: Command
         type: 'damage',
         sourceId: source.general.id,
         // 借速度最高友军攻击（奇兵拒北）：杀伤统计归属施法者（creditToId），而非实际打人者
         creditToId: source.general.id === unit.general.id ? undefined : unit.general.id,
         targetId: t.general.id,
         skillId: skill.id,
         skillName: skill.name,
         damageType: 'physical',
         damage: capped,
         breakdown,
-        modifiers: collectDamageModifiers(ctx, source, t),
+        modifiers: collectDamageModifiers(ctx, source, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
       });
       applyDamage(ctx, t, capped, source, 'physical', 'skill');
     }
-    if (attacked) consumeAttackCharges(ctx, source);
+    if (attacked) consumeAttackCharges(ctx, source, { damageSource: 'skill', damageType: 'physical', skillType: 'command' });
   }
 }
 
 /** 一类指挥 delayedOutput 预先结算：按准备时兵力/属性计算伤害（无视规避）。
  *  生效属性走 effectiveStat（含准备阶段已叠的谋略增益层，如卫瓘持节镇西对吕蒙的叠加） */
 function computeStoredDamage(
   ctx: CombatContext,
   caster: UnitState,
   skill: CommandSkill,
   target: UnitState,
   outputs: SkillOutput[]
 ): { damage: number; breakdown: DamageBreakdown } | null {
   for (const out of outputs) {
     if (out.kind !== 'strategy_damage' && out.kind !== 'physical_damage') continue;
     const damageType = out.kind === 'strategy_damage' ? 'strategy' : 'physical';
     let rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
     const effStrategy = effectiveStat(caster, 'strategy');
-    if (out.kind === 'strategy_damage' && out.strategyScaled) {
+    if (out.kind === 'strategy_damage' && out.strategyScaled && out.growthRate !== undefined) {
       rate = roundRate(scaledValue(out.rate, out.growthRate, effStrategy));
     }
     const { damage, breakdown } = calcDamage(
       {
         damageType,
         rate,
         attackerAttack: caster.general.attack,
         attackerStrategy: effStrategy,
         attackerTroops: caster.troops,
         targetDefense: damageType === 'physical' ? physicalTargetDefense(caster, target) : target.general.defense,
@@ -952,43 +988,49 @@ function addStackLayer(
 /**
  * DoT 挂上时结算（滞后触发）：按挂上时的增减伤单一总和、施法者兵力、
  * 目标当前防御/谋略、减伤预先计算每次跳伤并冻结，之后每次行动触发直接打出冻结值。
  *  - 兵力按施法者（attacker）挂上时兵力计算（调研公式 calcStrategyDamage 用 attacker.troops）
  *  - 增减伤 = max(10%, 1 + Σ增伤 − Σ减伤)（挂上时冻结，挂上后变化不影响）
  */
 function computeDotTickDamage(
   ctx: CombatContext,
   caster: UnitState,
   target: UnitState,
-  dot: { rate: number; sourceStrategy: number }
+  dot: { rate: number; sourceStrategy: number; sourceSkillId?: string }
 ): DotStoredDamage {
-  const { causedMult, takenMult } = damageBoosts(ctx, caster, target);
-  const reduce = sumRates(target.statuses, 'damage_reduce') + troopCounterReduceOf(caster, target);
+  const skillType = dot.sourceSkillId ? resolveSkill(ctx, dot.sourceSkillId)?.type : undefined;
+  const hit: DamageHitContext = {
+    damageSource: 'skill',
+    damageType: 'strategy',
+    ...(skillType ? { skillType } : {}),
+  };
+  const { causedMult, takenMult } = damageBoosts(ctx, caster, target, hit);
+  const reduce = sumReduce(target, hit) + troopCounterReduceOf(caster, target);
   const { damage, breakdown } = calcDamage(
     {
       damageType: 'strategy',
       rate: dot.rate,
       attackerAttack: effectiveStat(caster, 'attack'),
       attackerStrategy: dot.sourceStrategy,
       attackerTroops: caster.troops, // 挂上时施法者兵力
       targetDefense: effectiveStat(target, 'defense'),
       targetStrategy: effectiveStat(target, 'strategy'),
       mult: buffMult(causedMult, takenMult, reduce), // 挂上时增减伤合计（含兵种克制）
       isDot: true, // 妖术/燃烧/恐慌：兵力基础 ×1/3、谋略基础 ×0.25
     },
     ctx.rng
   );
   return {
     damage, // 已含挂上时减伤（单一总和内）
     breakdown,
     // 挂上时的增减伤归因（caused/taken/reduce，含兵种克制，战报「增减伤统计」用）
-    modifiers: collectDamageModifiers(ctx, caster, target),
+    modifiers: collectDamageModifiers(ctx, caster, target, true, hit),
   };
 }
 
 /** 结算一次 DoT/诅咒/引燃伤害：先走持节镇西（策略伤害前叠谋略 / 受击前叠防御），再 push dot_tick 并扣兵。
  *  滞后触发：有挂上时冻结的 stored（引擎施加路径）时直接打出冻结伤害（仅按目标当前兵力截断）；
  *  否则（直接 inflictStatus 且施法者不可解析的单元测试）回退为触发时实时结算：
  *  冻结 rate + sourceStrategy，目标当前生效防御/谋略减免，mult=1 不吃增伤。 */
 function dealDotDamage(
   ctx: CombatContext,
   unit: UnitState,
@@ -1127,58 +1169,61 @@ function executeSplitAttack(
   for (const adjRaw of adj) {
     if (!adjRaw.alive) continue;
     const adjTarget = redirectPhysicalHit(ctx, adjRaw);
     if (!adjTarget.alive) continue;
     // 常驻伤害前叠层
     triggerStackBuff(ctx, unit, adjTarget, 'physical');
     // 规避
     if (consumeEvasion(ctx, adjTarget, unit.general.id)) continue;
     const atk = effectiveStat(unit, 'attack');
     const def = physicalTargetDefense(unit, adjTarget);
-    const { causedMult, takenMult } = damageBoosts(ctx, unit, adjTarget);
-    const reduce = sumRates(adjTarget.statuses, 'damage_reduce') + troopCounterReduceOf(unit, adjTarget);
+    const hit: DamageHitContext = { damageSource: 'basic', damageType: 'physical' };
+    const { causedMult, takenMult } = damageBoosts(ctx, unit, adjTarget, hit);
+    const reduce = sumReduce(adjTarget, hit) + troopCounterReduceOf(unit, adjTarget);
     const { damage, breakdown } = calcDamage(
       {
         damageType: 'physical',
         rate: splitRate,
         attackerAttack: atk,
         attackerStrategy: unit.general.strategy,
         attackerTroops: unit.troops,
         targetDefense: def,
         targetStrategy: adjTarget.general.strategy,
         mult: buffMult(causedMult, takenMult, reduce),
       },
       ctx.rng
     );
     const capped = applyTroopCap(damage, adjTarget.troops);
     ctx.events.push({
       type: 'split_damage',
       sourceId: unit.general.id,
       targetId: adjTarget.general.id,
       damage: capped,
       breakdown,
-      modifiers: collectDamageModifiers(ctx, unit, adjTarget),
+      modifiers: collectDamageModifiers(ctx, unit, adjTarget, true, hit),
     });
     applyDamage(ctx, adjTarget, capped, unit, 'physical', 'skill');
   }
 }
 
 // ─── 单武将行动 ───
 
 /** 行动中施加的状态（appliedRound>0）：该单位下次行动开始前计数器减一（非消耗型，remaining 到 0 移除）。
  *  仅递减「上一回合或更早施加」的状态（appliedRound < currentRound）——同一回合刚施加的不减（连击等持续到本回合行动结束）。
  *  行动前施加（appliedRound=0）由回合末 tickStatuses 递减，不在此处理。 */
 function tickStatusesOnActStart(ctx: CombatContext, unit: UnitState): void {
   for (const s of [...unit.statuses]) {
     if (s.type === 'evasion') continue; // 规避按层数，不递减
     // 次数型下一次攻击：不按回合递减，打出后由 consumeAttackCharges 移除
     if (s.type === 'damage_boost' && 'charges' in s && s.charges != null) continue;
+    // 次数型分兵：不按回合递减，打出后由 consumeSplitCharges 移除
+    if (s.type === 'split' && 'charges' in s && s.charges != null) continue;
     // 待下次行动再生效的暴走（青丘媚祸）：本行动开始时激活，不递减；再下一次行动开始前才到期
     if (s.type === 'rampage' && s.pendingNextAct) {
       s.pendingNextAct = false;
       s.appliedRound = ctx.currentRound;
       continue;
     }
     // first_aid：remaining 递减（Infinity 整场常驻恒不减；金匮要略前 3 回合到期移除）
     if (s.type === 'rest') continue; // 休整 remaining 只在跳恢复时递减
     if (s.appliedRound === 0) continue; // 行动前施加：回合末递减
     if (s.appliedRound >= ctx.currentRound) continue; // 本回合刚施加：持续到行动结束
@@ -1210,20 +1255,32 @@ export function actUnit(ctx: CombatContext, unit: UnitState): void {
     ctx.events.push({
       type: 'unit_act_start',
       unitId: unit.general.id,
       name: unit.general.name,
       position: unit.general.position,
       phase: 'passive_skill',
     });
     executeSkillWithTargets(ctx, unit, passive, enemies, allies, mixedPool(ctx, unit));
   }
 
+  // 0.5 被动 roundStartRepeat：每回合行动阶段、round_start 被动之后、指挥之前。
+  // 不在 battle_start 的 triggerPassiveSkills 里跑（开战 output 只走一次）。
+  for (const id of unit.general.passiveSkillIds) {
+    const p = resolveSkill(ctx, id);
+    if (p?.type !== 'passive' || !p.roundStartRepeat) continue;
+    const rs = p.roundStartRepeat;
+    if (rs.startRound != null && ctx.currentRound < rs.startRound) continue;
+    if (rs.endRound != null && ctx.currentRound > rs.endRound) continue;
+    if (rs.oddRounds && ctx.currentRound % 2 === 0) continue;
+    executeSkillOutputs(ctx, unit, p, [unit], rs.output);
+  }
+
   // 1. 指挥预备负面效果判定（战必/措手/白衣，目标行动时）
   triggerPreparedEffectOnAct(ctx, unit);
 
   // 2. 二类指挥判定（奇兵拒北，行动时）
   triggerRoundCommandOnAct(ctx, unit);
 
   // 2.5 休整：每回合行动时按挂上时冻结值恢复（指挥预备判定之后、DoT 之前）
   tickRests(ctx, unit);
 
   // 3. DoT 结算（妖术/燃烧/恐慌：行动时受到伤害）。先单独开行动组，避免跳伤/持节镇西叠层串进上一位武将的普攻组。
@@ -1261,48 +1318,54 @@ export function actUnit(ctx: CombatContext, unit: UnitState): void {
 
   // 4. 怯战检查：怯战期间无法普攻（但可放主动战法）
   const canNormalAttack = !hasStatus(unit, 'cowardice');
 
   // 暴走：攻击与战法目标不分敌我（可打友军/敌军，不打自己）
   const rampage = hasStatus(unit, 'rampage');
   const combinedPool = [...allies, ...enemies].filter((t) => t.alive && t !== unit);
   const attackPool = rampage ? combinedPool : enemies;
 
   // 5+6. 主动战法阶段：
-  //  - 上回合准备好的战法：本回合主动战法阶段自动释放（不做发动率判定、不受犹豫影响）；
-  //    释放后本回合不再进行其他主动战法判定（极端情况 8 回合最多释放 4 次：
-  //    第 1/3/5/7 回合判定成功进入准备 → 第 2/4/6/8 回合释放）
+  //  - 准备中：prepareLeft > 1 则减 1 继续准备（仍普攻、不再判定其他主动）；
+  //    prepareLeft === 1 则 prepare_end 并释放。缺省 1 回合准备与旧行为一致。
   //  - 无准备战法：逐槽判定主动战法（含准备战法的发动率判定，判定成功即进入准备，本回合不再判定其他主动）
   const canCastActive = !hasStatus(unit, 'hesitation');
   if (unit.isPreparing && unit.preparingSkillId) {
-    const prepared = resolveSkill(ctx, unit.preparingSkillId);
-    if (prepared) {
-      ctx.events.push({
-        type: 'prepare_end',
-        unitId: unit.general.id,
-        skillId: prepared.id,
-        skillName: prepared.name,
-        success: true,
-      });
-      executePreparedSkill(ctx, unit, prepared, enemies, attackPool);
+    const left = unit.prepareLeft ?? 1;
+    if (left > 1) {
+      unit.prepareLeft = left - 1;
+      // 不释放、不判定其他主动；后面仍普攻
     } else {
-      ctx.events.push({
-        type: 'prepare_end',
-        unitId: unit.general.id,
-        skillId: unit.preparingSkillId,
-        skillName: unit.preparingSkillId,
-        success: false,
-        reason: '战法不存在',
-      });
+      const prepared = resolveSkill(ctx, unit.preparingSkillId);
+      if (prepared) {
+        ctx.events.push({
+          type: 'prepare_end',
+          unitId: unit.general.id,
+          skillId: prepared.id,
+          skillName: prepared.name,
+          success: true,
+        });
+        executePreparedSkill(ctx, unit, prepared, enemies, attackPool);
+      } else {
+        ctx.events.push({
+          type: 'prepare_end',
+          unitId: unit.general.id,
+          skillId: unit.preparingSkillId,
+          skillName: unit.preparingSkillId,
+          success: false,
+          reason: '战法不存在',
+        });
+      }
+      unit.isPreparing = false;
+      unit.preparingSkillId = null;
+      unit.prepareLeft = null;
     }
-    unit.isPreparing = false;
-    unit.preparingSkillId = null;
   } else if (canCastActive) {
     for (const id of unit.general.activeSkillIds) {
       const active = resolveSkill(ctx, id);
       if (!active) continue;
       // 运筹决胜等：判定该主动战法发动率之前先走二类指挥 before_active
       triggerBeforeActiveCommands(ctx, unit);
       if (!unit.alive) break;
       ctx.events.push({
         type: 'unit_act_start',
         unitId: unit.general.id,
@@ -1347,20 +1410,22 @@ export function actUnit(ctx: CombatContext, unit: UnitState): void {
       if (!hit.alive) continue; // 目标已死，继续按连击打下一个
     }
   }
 
   // 9. 分兵攻击阶段（普攻后无视攻击距离对相邻目标造成比例伤害）
   const splitStatus = getStatus(unit, 'split');
   if (splitStatus) {
     for (const hitTarget of hits) {
       if (!hitTarget.alive) continue;
       executeSplitAttack(ctx, unit, hitTarget, splitStatus.rate, allies, enemies);
+      // 次数型分兵（鱼鳞/飒沓）按输出次数消耗；鹤翼等无 charges 的分兵不扣
+      if ('charges' in splitStatus && splitStatus.charges != null) consumeSplitCharges(unit);
     }
   }
 
   unit.hasActedThisRound = true;
   ctx.events.push({ type: 'unit_act_end', unitId: unit.general.id });
 }
 
 function resolveSkill(ctx: CombatContext, id: string): Skill | null {
   return ctx.skills.get(id) ?? null;
 }
@@ -1385,20 +1450,24 @@ export function getStatus<T extends StatusType>(
  *  - 不同类型 → 各自计数共存（战必指挥怯战 vs 玄武洰流主动怯战）
  */
 export function inflictStatus(
   ctx: CombatContext,
   target: UnitState,
   create: CreateStatus,
   sourceSkillType: SkillType,
   sourceSkillId: string,
   casterId?: string
 ): void {
+  if ('duration' in create && Array.isArray(create.duration)) {
+    const [a, b] = create.duration;
+    create = { ...create, duration: ctx.rng.intInclusive(a, b) } as CreateStatus;
+  }
   const type = create.type;
 
   // 洞察：免疫控制类效果（混乱/怯战/暴走/犹豫）
   const CONTROL_TYPES: StatusType[] = ['confusion', 'rampage', 'cowardice', 'hesitation'];
   if (CONTROL_TYPES.includes(type) && hasStatus(target, 'insight')) {
     ctx.events.push({
       type: 'insight_blocked',
       unitId: target.general.id,
       statusType: type,
     });
@@ -1473,71 +1542,87 @@ export function inflictStatus(
   // 由 dealDotDamage 回退为触发时实时结算
   const DOT_TYPES: StatusType[] = ['sorcery', 'burning', 'panic', 'curse', 'ignite'];
   if (DOT_TYPES.includes(type)) {
     const caster = casterId ? castUnit(ctx, casterId) : undefined;
     let stored: DotStoredDamage | undefined;
     if (caster) {
       const dotCreate = create as Extract<CreateStatus, { type: 'sorcery' | 'burning' | 'panic' | 'curse' | 'ignite' }>;
       stored = computeDotTickDamage(ctx, caster, target, {
         rate: dotCreate.rate,
         sourceStrategy: dotCreate.sourceStrategy ?? effectiveStat(caster, 'strategy'),
+        sourceSkillId,
       });
     }
     pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId, stored);
     return;
   }
 
   // 增减伤方向：damage_boost 按方向匹配（造成侧与受到侧各自独立，不互相冲突/累加）
   const boostDir = type === 'damage_boost' ? (create.type === 'damage_boost' ? (create.direction ?? 'taken') : undefined) : undefined;
 
-  // 同一战法此前施加过的同名效果（damage_boost 需同方向；first_aid 已在顶部特判，此处排除以收窄类型）
+  // 同一战法此前施加过的同名效果（damage_boost 需同方向且过滤维一致；
+  // 方圆普攻减伤 vs 主动/追击增伤是两段独立效果，不得把 rate 累成 −0.032）
   const sameSource = target.statuses.find(
     (s) =>
       s.type !== 'first_aid' &&
       s.type !== 'rest' &&
       s.type === type &&
       s.sourceSkillType === sourceSkillType &&
       s.sourceSkillId === sourceSkillId &&
-      (boostDir === undefined || !('direction' in s) || s.direction === boostDir)
+      (boostDir === undefined || !('direction' in s) || s.direction === boostDir) &&
+      sameDamageBoostFilter(s, create)
   );
-  // 同战法类型、不同战法施加的同名效果（damage_boost 需同方向）
+  // 同战法类型、不同战法施加的同名效果（damage_boost 需同方向）。
+  // 增减伤 / 属性类必须找同号：跳过反号实例。否则 find 先命中方圆 −20% basic，
+  // 大赏 +30% 被当成「正负相反、共存」，同号的 +16.8% 永远进不了取较高。
+  const sameTypeUsesSign =
+    type === 'damage_boost' ||
+    type === 'attack_buff' || type === 'defense_buff' ||
+    type === 'strategy_buff' || type === 'speed_buff';
+  const incomingSign = sameTypeUsesSign ? conflictSign(statusValue(create)) : undefined;
   const sameType = target.statuses.find(
     (s) =>
       s.type !== 'first_aid' &&
       s.type !== 'rest' &&
       s.type === type &&
       s.sourceSkillType === sourceSkillType &&
       s.sourceSkillId !== sourceSkillId &&
-      (boostDir === undefined || !('direction' in s) || s.direction === boostDir)
+      (boostDir === undefined || !('direction' in s) || s.direction === boostDir) &&
+      (incomingSign === undefined || conflictSign(statusValue(s)) === incomingSign)
   );
   // 不同战法类型施加的同名效果
   const diffType = target.statuses.find((s) => s.type !== 'first_aid' && s.type !== 'rest' && s.type === type && s.sourceSkillType !== sourceSkillType);
 
   if (sameSource) {
     // 次数型下一次增减伤 / 待生效暴走：已有则不刷新，避免叠加或永控
     if (type === 'damage_boost' && create.type === 'damage_boost' && create.charges != null && !create.chargesStack) return;
     if (type === 'rampage' && create.type === 'rampage' && create.pendingNextAct) return;
+    // 同战法同过滤维叠层达到 maxStacks 后不再加 rate（文德椒房 3）
+    if (type === 'damage_boost' && create.type === 'damage_boost' && create.maxStacks != null) {
+      const stacks = (sameSource as { stacks?: number }).stacks ?? 1;
+      if (stacks >= create.maxStacks) return;
+    }
     // 同一战法重复触发：数值类累加，规避加层，控制刷新剩余
     if (sameSource.type === 'evasion') {
       if (create.type === 'evasion') sameSource.stacks += create.stacks;
     } else if (sameSource.type === 'attack_buff' || sameSource.type === 'defense_buff' || sameSource.type === 'strategy_buff' || sameSource.type === 'speed_buff' || sameSource.type === 'damage_reduce' || sameSource.type === 'damage_boost' || sameSource.type === 'trigger_boost' || sameSource.type === 'morale_boost') {
       if ('amount' in sameSource && 'amount' in create) sameSource.amount += create.amount;
       else if ('rate' in sameSource && 'rate' in create) {
         sameSource.rate += create.rate;
         // 叠层计数（银龙冲阵）：带上限的增减伤每层 +1
         if (type === 'damage_boost' && 'stacks' in sameSource) {
           (sameSource as { stacks?: number }).stacks = (sameSource.stacks ?? 1) + ('stacks' in create ? (create.stacks ?? 1) : 1);
         }
       }
-      if (create.type !== 'evasion') sameSource.remaining = Math.max(sameSource.remaining, create.duration);
+      if (create.type !== 'evasion') sameSource.remaining = Math.max(sameSource.remaining, remainingFromDuration(create.duration));
     } else if (create.type !== 'evasion' && 'remaining' in sameSource) {
-      sameSource.remaining = Math.max(sameSource.remaining, create.duration);
+      sameSource.remaining = Math.max(sameSource.remaining, remainingFromDuration(create.duration));
     }
     /**
      * 反击同战法重挂：刷新 appliedRound，并沿用本次 rate。
      * 否则第 2 回合 roundStartRepeat 只续 remaining，行动开始时 tickStatusesOnActStart
      * 会把 appliedRound=1 当成「上回合施加」递减掉，本回合行动后反击失效。
      */
     if (sameSource.type === 'counter' && create.type === 'counter') {
       sameSource.appliedRound = ctx.currentRound;
       sameSource.rate = create.rate;
     }
@@ -1586,22 +1671,21 @@ export function inflictStatus(
     // 由 buffMult 单一总和模型互相抵消（率土增伤减伤加算）——避免「增伤冲突」误报与减伤被替换吞掉。
     // 属性类（attack/defense/strategy/speed_buff）：按正负分桶——
     // 一减一增（如曹操魏武之世速度-15 与张辽其疾如风速度+41）互不冲突，各自共存；
     // 同号才冲突：数值替换取较高、持续取较长
     const isAttrBuff =
       sameType.type === 'attack_buff' || sameType.type === 'defense_buff' ||
       sameType.type === 'strategy_buff' || sameType.type === 'speed_buff';
     const isBoost = sameType.type === 'damage_boost';
     const incomingVal = statusValue(create);
     const curVal = statusValue(sameType);
-    const signOf = (v: number) => (v < 0 ? -1 : v > 0 ? 1 : 0);
-    if ((isAttrBuff || isBoost) && signOf(incomingVal) !== signOf(curVal)) {
+    if ((isAttrBuff || isBoost) && conflictSign(incomingVal) !== conflictSign(curVal)) {
       // 正负相反 → 不冲突，新增独立实例共存（增伤与减伤由 buffMult 单一总和模型互相抵消）
       pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
       return;
     }
     // 增益（或同号属性类）：数值替换取较高，持续取较长
     if (incomingVal > curVal) {
       if (sameType.type === 'evasion') {
         if (create.type === 'evasion') sameType.stacks = create.stacks;
       } else if (sameType.type === 'attack_buff' || sameType.type === 'defense_buff' || sameType.type === 'strategy_buff' || sameType.type === 'speed_buff' || sameType.type === 'damage_reduce' || sameType.type === 'damage_boost' || sameType.type === 'trigger_boost' || sameType.type === 'morale_boost' || sameType.type === 'ignore_def') {
         // 维度不同（点数 vs 百分比）无法直接比较时，后施加者替换
@@ -1618,41 +1702,88 @@ export function inflictStatus(
             sameType.amount = create.amount;
             (sameType as { percent?: boolean }).percent = Boolean('percent' in create && create.percent);
           } else if ('rate' in sameType && 'rate' in create) {
             sameType.rate = create.rate;
           }
         }
         if (create.type === 'trigger_boost' && sameType.type === 'trigger_boost') {
           sameType.skillTypes = create.skillTypes;
           sameType.additive = create.additive;
         }
+        // 增减伤过滤元数据随胜者走（与 trigger_boost.skillTypes 同理）：有则写入，缺省则清掉败者残留
+        if (
+          (create.type === 'damage_boost' && sameType.type === 'damage_boost') ||
+          (create.type === 'damage_reduce' && sameType.type === 'damage_reduce')
+        ) {
+          applyDamageFilterFromWinner(sameType, create);
+        }
         sameType.sourceSkillId = sourceSkillId;
         if (casterId) (sameType as { sourceUnitId?: string }).sourceUnitId = casterId;
       }
     }
     if (sameType.type !== 'evasion' && create.type !== 'evasion' && 'remaining' in sameType) {
-      sameType.remaining = Math.max(sameType.remaining, create.duration);
+      sameType.remaining = Math.max(sameType.remaining, remainingFromDuration(create.duration));
     }
     ctx.events.push({
       type: 'status_conflict',
       unitId: target.general.id,
       statusType: sameType.type,
       sourceSkillType,
       detail: `${statusName(sameType.type)}冲突，数值取较高 ${Math.max(incomingVal, curVal)}`,
     });
     return;
   }
 
   // 不同类型：各自计数共存（新增独立实例）
   pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
 }
 
+/**
+ * 同源 damage_boost 只有过滤维（来源 / 战法类型 / 伤害类型 / 有无 charges）一致才视为同一条、允许累加。
+ * charges 只比「有/无」，不比具体次数。过滤维不同则视为独立效果（火兽冲锋常驻 vs 次数刀）。
+ * 非 damage_boost 一律视为可累加。
+ */
+function sameDamageBoostFilter(existing: Status, incoming: CreateStatus): boolean {
+  if (existing.type !== 'damage_boost' || incoming.type !== 'damage_boost') return true;
+  const norm = (types?: SkillType[]) => [...(types ?? [])].sort().join(',');
+  return (
+    (existing.damageSource ?? undefined) === (incoming.damageSource ?? undefined) &&
+    (existing.damageType ?? undefined) === (incoming.damageType ?? undefined) &&
+    norm(existing.skillTypes) === norm(incoming.skillTypes) &&
+    (existing.charges != null) === (incoming.charges != null)
+  );
+}
+
+/**
+ * 同类型冲突「取较高替换」时，把胜者的伤害过滤字段写到存活实例。
+ * 胜者有字段则写入；胜者缺省则 delete，避免败者过滤维残留导致错吃/错收窄。
+ */
+function applyDamageFilterFromWinner(
+  surviving: { damageSource?: 'basic' | 'skill'; skillTypes?: SkillType[]; damageType?: 'physical' | 'strategy' },
+  winner: { damageSource?: 'basic' | 'skill'; skillTypes?: SkillType[]; damageType?: 'physical' | 'strategy' },
+): void {
+  if ('damageSource' in winner && winner.damageSource != null) surviving.damageSource = winner.damageSource;
+  else delete surviving.damageSource;
+  if ('skillTypes' in winner && winner.skillTypes != null) surviving.skillTypes = winner.skillTypes;
+  else delete surviving.skillTypes;
+  if ('damageType' in winner && winner.damageType != null) surviving.damageType = winner.damageType;
+  else delete surviving.damageType;
+}
+
+/**
+ * 冲突分桶用正负号：负 / 零 / 正 → -1 / 0 / 1。
+ * sameType 找同号时跳过反号，让同号走取较高；反号仍走既有共存。
+ */
+function conflictSign(v: number): -1 | 0 | 1 {
+  return v < 0 ? -1 : v > 0 ? 1 : 0;
+}
+
 /** 读取状态数值（规避取层数，攻击/防御/减伤取数值/比率） */
 function statusValue(x: CreateStatus | Status): number {
   if (x.type === 'evasion') return x.stacks;
   return 'amount' in x ? x.amount : 'rate' in x ? x.rate : 0;
 }
 
 function pushStatus(
   ctx: CombatContext,
   target: UnitState,
   create: CreateStatus,
@@ -1660,21 +1791,21 @@ function pushStatus(
   sourceSkillId: string,
   casterId?: string,
   stored?: DotStoredDamage
 ): void {
   const type = create.type;
   // 施加回合：准备阶段 currentRound=0 → 行动前施加；正式回合 → 行动中施加
   const appliedRound = ctx.currentRound;
   // 计数器型回合数：行动前施加（appliedRound=0）回合末递减（tickStatuses）；
   // 行动中施加（appliedRound>0）持续到该单位下次行动开始前递减（actUnit 开头）。
   // remaining 统一为 duration（两种施加点都从 duration 开始数）；规避按层数无 remaining
-  const remaining = type === 'evasion' ? 0 : 'duration' in create ? create.duration : 0;
+  const remaining = type === 'evasion' ? 0 : remainingFromDuration('duration' in create ? create.duration : 0);
   if (type === 'evasion') {
     target.statuses.push({ type: 'evasion', stacks: create.stacks, appliedRound, sourceSkillType, sourceSkillId });
     ctx.events.push({
       type: 'status_inflicted',
       unitId: target.general.id,
       statusType: type,
       detail: `规避 +${create.stacks} 层`,
     });
     return;
   }
@@ -1705,41 +1836,61 @@ function pushStatus(
     const push: Status = { type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status;
     if ('amount' in create) (push as { amount: number }).amount = create.amount;
     else (push as { rate: number }).rate = create.rate;
     // 增减伤方向（damage_boost 才有）：缺省 'taken'（受到侧）
     if (type === 'damage_boost') (push as { direction: 'caused' | 'taken' }).direction = create.direction ?? 'taken';
     // 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）：首层记 1，同战法累加时 +1
     if (type === 'damage_boost' && 'stacks' in create) (push as { stacks?: number }).stacks = create.stacks ?? 1;
     if (type === 'damage_boost' && 'charges' in create && create.charges != null) {
       (push as { charges?: number }).charges = create.charges;
     }
+    // 增减伤按本次伤害过滤（方圆/锋矢/白刃）：拷到 Status，缺省不过滤
+    if ((type === 'damage_boost' || type === 'damage_reduce') && 'damageSource' in create && create.damageSource != null) {
+      (push as { damageSource?: 'basic' | 'skill' }).damageSource = create.damageSource;
+    }
+    if ((type === 'damage_boost' || type === 'damage_reduce') && 'skillTypes' in create && create.skillTypes != null) {
+      (push as { skillTypes?: SkillType[] }).skillTypes = create.skillTypes;
+    }
+    if ((type === 'damage_boost' || type === 'damage_reduce') && 'damageType' in create && create.damageType != null) {
+      (push as { damageType?: 'physical' | 'strategy' }).damageType = create.damageType;
+    }
     // 谋议宏图减伤按 8/8 衰减：冻结满额减伤率为 baseRate
     if (type === 'damage_reduce' && 'decayEighths' in create && create.decayEighths) {
       (push as { eighths?: number }).eighths = create.decayEighths;
       (push as { baseRate?: number }).baseRate = create.rate;
     }
+    // 恃强淬锋 taken 减伤按 N 份衰减：冻结满额份数 fifthsBase 与满额 rate
+    if (type === 'damage_boost' && 'decayFifths' in create && create.decayFifths) {
+      (push as { fifths?: number }).fifths = create.decayFifths;
+      (push as { fifthsBase?: number }).fifthsBase = create.decayFifths;
+      (push as { baseRate?: number }).baseRate = create.rate;
+    }
     // 增减伤/发动率类状态记录施法者（战报归因用）：神兵天降/大赏三军/减伤/奋疾先登降速等
     if (casterId) {
       (push as { sourceUnitId?: string }).sourceUnitId = casterId;
     }
     if (type === 'trigger_boost' && 'skillTypes' in create && create.skillTypes) {
       (push as { skillTypes?: SkillType[] }).skillTypes = create.skillTypes;
     }
     if (type === 'trigger_boost' && 'additive' in create && create.additive) {
       (push as { additive?: boolean }).additive = true;
     }
     target.statuses.push(push);
     // 战报 detail：duration ≥ 999（战斗结束约定）→「持续至战斗结束」；
     // damage_boost 用百分数 + 语义化（0.08 → 「造成的伤害提高8%」；≤ -90% → 「造成的伤害大幅降低」）
     const durText = create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`;
     let detail: string;
-    if (type === 'damage_boost') {
+    if (type === 'damage_boost' && 'decayFifths' in create && create.decayFifths) {
+      const pct = Math.round(Math.abs(create.rate) * 100);
+      const dirName = (create.direction ?? 'taken') === 'caused' ? '造成的' : '受到的';
+      detail = `${dirName}伤害${create.rate >= 0 ? '提高' : '降低'} ${pct}% 剩余 ${create.decayFifths}/${create.decayFifths} ${durText}`;
+    } else if (type === 'damage_boost') {
       const pct = Math.round(Math.abs(create.rate) * 100);
       const dirName = (create.direction ?? 'taken') === 'caused' ? '造成的' : '受到的';
       const verb = create.rate < 0 && pct > 90 ? '大幅降低' : `${create.rate >= 0 ? '提高' : '降低'} ${pct}%`;
       const once = 'charges' in create && create.charges ? '下一次' : '';
       detail = `${once}${dirName}伤害${verb} ${'charges' in create && create.charges ? '' : durText}`.trim();
     } else if (type === 'trigger_boost') {
       const pct = Math.round(create.rate * 100);
       const pursuitOnly =
         'skillTypes' in create &&
         create.skillTypes?.length === 1 &&
@@ -1827,33 +1978,36 @@ function pushStatus(
     });
     ctx.events.push({
       type: 'status_inflicted',
       unitId: target.general.id,
       statusType: type,
       detail: `休整 ${startText}${durText} 每次恢复 ${healAmount}`,
     });
     return;
   }
   if (type === 'split') {
-    target.statuses.push({
+    const src = create as Extract<CreateStatus, { type: 'split' }>;
+    const push: Extract<Status, { type: 'split' }> = {
       type: 'split',
-      remaining,
-      rate: create.rate,
+      remaining: src.duration,
+      rate: src.rate,
       appliedRound,
       sourceSkillType,
       sourceSkillId,
-    } as Status);
+    };
+    if (src.charges != null) push.charges = src.charges;
+    target.statuses.push(push);
     ctx.events.push({
       type: 'status_inflicted',
       unitId: target.general.id,
       statusType: type,
-      detail: `${statusName(type)} ${Math.round(create.rate)}% ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
+      detail: `${statusName(type)} ${Math.round(src.rate)}% ${src.duration >= 999 ? '持续至战斗结束' : `持续 ${src.duration} 回合`}`,
     });
     return;
   }
   if (type === 'jump_prep') {
     target.statuses.push({
       type: 'jump_prep',
       remaining,
       rate: create.rate,
       appliedRound,
       sourceSkillType,
@@ -1922,57 +2076,60 @@ function pushStatus(
       detail: `挑衅 ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
     });
     return;
   }
   // insight / siege / cover / 控制类：通用简化字段
   target.statuses.push({ type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status);
   ctx.events.push({
     type: 'status_inflicted',
     unitId: target.general.id,
     statusType: type,
-    detail: `${statusName(type)} ${create.duration} 回合`,
+    detail: `${statusName(type)} ${remaining} 回合`,
   });
 }
 
 /** 回合结束：只递减「行动前施加」（appliedRound=0，准备阶段）的计数器回合，到 0 移除。
  *  行动中施加（appliedRound>0）持续到该单位下次行动开始前，由 tickStatusesOnActStart 递减。 */
 export function tickStatuses(ctx: CombatContext, units: UnitState[]): void {
   for (const unit of units) {
     if (!unit.alive) continue;
     for (const s of [...unit.statuses]) {
       if (s.type === 'evasion') {
         if (s.stacks <= 0) {
           unit.statuses = unit.statuses.filter((x) => x !== s);
         }
         continue;
       }
       if (s.appliedRound !== 0) continue; // 行动中施加：下次行动开始前递减
       if (s.type === 'rest') continue; // 休整 remaining 只在跳恢复时递减
+      // 次数型分兵（准备阶段施加）：不按回合递减
+      if (s.type === 'split' && 'charges' in s && s.charges != null) continue;
       // split/insight/siege/sorcery/burning/panic/first_aid 都按 remaining 递减
       // （first_aid：Infinity 整场常驻恒不减；金匮要略前 3 回合到期移除）
       s.remaining -= 1;
       if (s.remaining <= 0) {
         unit.statuses = unit.statuses.filter((x) => x !== s);
         ctx.events.push({
           type: 'status_expired',
           unitId: unit.general.id,
           statusType: s.type,
         });
       }
     }
   }
 }
 
 /**
- * 回合前准备阶段（谋议宏图）：`round_start` 之后、单位行动之前。
- * 1. 带 `eighths` 的减伤衰减 1/8（≤0 则移除）
- * 2. 一类指挥 `roundStartRepeat` 对锁定目标再结算（士气叠层，同战法累加）
+ * 回合前准备阶段（谋议宏图 / 恃强淬锋）：`round_start` 之后、单位行动之前。
+ * 1. 带 `eighths` 的减伤衰减 1/8（≤0 则移除）；**不对 fifths 做回合衰减**
+ * 2. 被动 `selfPhysBoost.onRoundStart` 给持有者叠 1 层造成物理伤害提高
+ * 3. 一类指挥 `roundStartRepeat` 对锁定目标再结算（士气叠层，同战法累加）
  */
 export function tickRoundStartStatuses(ctx: CombatContext): void {
   const units = [...ctx.myTeam, ...ctx.enemyTeam];
   for (const unit of units) {
     if (!unit.alive) continue;
     for (const s of [...unit.statuses]) {
       if (s.type !== 'damage_reduce' || s.eighths === undefined || s.baseRate === undefined) continue;
       s.eighths -= 1;
       if (s.eighths <= 0) {
         unit.statuses = unit.statuses.filter((x) => x !== s);
@@ -1987,26 +2144,36 @@ export function tickRoundStartStatuses(ctx: CombatContext): void {
       const durText = s.remaining >= 999 ? '持续至战斗结束' : `持续 ${s.remaining} 回合`;
       ctx.events.push({
         type: 'status_inflicted',
         unitId: unit.general.id,
         statusType: 'damage_reduce',
         detail: `${statusName('damage_reduce')} ${s.rate} 剩余 ${s.eighths}/8 ${durText}`,
       });
     }
   }
 
+  for (const unit of units) {
+    if (!unit.alive) continue;
+    for (const id of unit.general.passiveSkillIds) {
+      const skill = resolveSkill(ctx, id);
+      if (skill?.type !== 'passive' || !skill.selfPhysBoost?.onRoundStart) continue;
+      applySelfPhysBoost(ctx, unit, skill);
+    }
+  }
+
   for (const locked of ctx.lockedCommands) {
     const skill = locked.skill;
     if (!skill.roundStartRepeat) continue;
     const rs = skill.roundStartRepeat;
     if (rs.startRound != null && ctx.currentRound < rs.startRound) continue;
     if (rs.endRound != null && ctx.currentRound > rs.endRound) continue;
+    if (rs.oddRounds && ctx.currentRound % 2 === 0) continue;
     const caster = castUnit(ctx, locked.casterId);
     if (!caster) continue;
     if (!caster.alive && !skill.retainAfterDeath) continue;
     const targets = locked.targets.filter((t) => t.alive);
     if (targets.length === 0) continue;
     executeSkillOutputs(ctx, caster, skill, targets, skill.roundStartRepeat.output);
   }
 }
 
 /** 移除所有有害状态（孙权九锡黄龙） */
@@ -2079,74 +2246,121 @@ function physicalTargetDefense(attacker: UnitState, target: UnitState): number {
  * 不改写 `general.morale`（避免污染 BattleConfig 原对象）。
  */
 export function effectiveMorale(unit: UnitState): number {
   const base = unit.general.morale ?? 100;
   const bonus = unit.statuses
     .filter((s): s is Extract<Status, { type: 'morale_boost' }> => s.type === 'morale_boost')
     .reduce((sum, s) => sum + s.amount, 0);
   return base + bonus;
 }
 
-/** 造成伤害减伤因子：目标上的 damage_reduce 状态（率土中减伤为伤害降低） */
+/**
+ * 本次伤害上下文：增减伤按来源 / 战法类型 / 伤害类型过滤。
+ * 缺省字段 = 该维不限制。
+ */
+export type DamageHitContext = {
+  damageSource?: 'basic' | 'skill';
+  damageType?: DamageType;
+  skillType?: SkillType;
+};
+
+/**
+ * 增减伤/减伤是否计入本次伤害。hit 缺省或某维缺省 = 该维不限制。
+ */
+export function statusMatchesHit(
+  s: { damageSource?: 'basic' | 'skill'; skillTypes?: SkillType[]; damageType?: 'physical' | 'strategy' },
+  hit?: DamageHitContext
+): boolean {
+  if (!hit) return true;
+  if (s.damageSource && hit.damageSource && s.damageSource !== hit.damageSource) return false;
+  if (s.damageType && hit.damageType && s.damageType !== hit.damageType) return false;
+  if (s.skillTypes && s.skillTypes.length > 0) {
+    if (!hit.skillType || !s.skillTypes.includes(hit.skillType)) return false;
+  }
+  return true;
+}
+
+/** 受击方减伤合计；hit 过滤后仍走 formulas.sumRates，不改其签名。 */
+function sumReduce(target: UnitState, hit?: DamageHitContext): number {
+  const list = target.statuses.filter(
+    (s) => s.type === 'damage_reduce' && statusMatchesHit(s, hit)
+  );
+  return sumRates(list, 'damage_reduce');
+}
+
 /**
  * 增减伤倍率（神兵天降/大赏三军/血溅黄砂）：伤害方的「造成伤害提高」与受击方的「受到伤害提高」，
  * 分别由各自 statuses 上对应方向（caused/taken）的 damage_boost 状态数值相加，无效果时为 1。
  * 造成侧增伤（血溅黄砂等）不会放大自身受到的伤害。
  * 消费方：buffMult 按「单一总和」模型把两侧增伤与受击方减伤（damage_reduce）求和后 clamp 下限 10%。
+ * @param hit 本次伤害上下文；缺省不过滤（旧调用保持原行为）
  */
 function damageBoosts(
   ctx: CombatContext,
   source: UnitState,
-  target: UnitState
+  target: UnitState,
+  hit?: DamageHitContext
 ): { causedMult: number; takenMult: number } {
-  const causedBoost = sumRates(source.statuses, 'damage_boost', 'caused');
-  const takenBoost = sumRates(target.statuses, 'damage_boost', 'taken');
+  const causedBoost = sumRates(
+    source.statuses.filter((s) => s.type === 'damage_boost' && statusMatchesHit(s, hit)),
+    'damage_boost',
+    'caused'
+  );
+  const takenBoost = sumRates(
+    target.statuses.filter((s) => s.type === 'damage_boost' && statusMatchesHit(s, hit)),
+    'damage_boost',
+    'taken'
+  );
   return { causedMult: 1 + causedBoost, takenMult: 1 + takenBoost };
 }
 
 /**
  * 收集单次伤害的增减伤来源（战报「增减伤统计」归因用）：
  *  造成侧（大赏三军：攻击方自身造成伤害提高）→ caused；
  *  受到侧（神兵天降：受击方受到伤害提高）→ taken；
  *  减伤（步步为营等受击方 damage_reduce + 兵种克制）→ reduce。
  *  includeBoosts=false：DoT 实时回退路径（挂上时结算不可用的单元测试场景）
  *  不携带增减伤提升（mult=1），只带减伤来源；引擎路径的 DoT 在挂上时结算，
  *  增伤/减伤来源均已在 computeDotTickDamage 冻结。
+ * @param hit 本次伤害上下文；缺省不过滤
+ * @param opts.ignoresTroopCounter 为 true 时不写入 troop_counter 减伤来源
  */
 function collectDamageModifiers(
   ctx: CombatContext,
   source: UnitState,
   target: UnitState,
-  includeBoosts = true
+  includeBoosts = true,
+  hit?: DamageHitContext,
+  opts?: { ignoresTroopCounter?: boolean }
 ): DamageModifiers {
   const toSrc = (s: Extract<Status, { sourceUnitId?: string }>, dir: DamageModifierSource['direction']): DamageModifierSource => ({
     unitId: s.sourceUnitId || (dir === 'caused' ? source.general.id : target.general.id),
     skillId: s.sourceSkillId,
     skillName: resolveSkill(ctx, s.sourceSkillId)?.name ?? s.sourceSkillId,
     rate: 'rate' in s ? s.rate : 0,
     direction: dir,
   });
   const caused = includeBoosts
     ? source.statuses
-        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused')
+        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused' && statusMatchesHit(s, hit))
         .map((s) => toSrc(s, 'caused'))
     : [];
   const taken = includeBoosts
     ? target.statuses
-        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'taken')
+        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'taken' && statusMatchesHit(s, hit))
         .map((s) => toSrc(s, 'taken'))
     : [];
   const reduce = target.statuses
-    .filter((s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce')
+    .filter((s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce' && statusMatchesHit(s, hit))
     .map((s) => toSrc(s, 'reduce'));
   const cr = troopCounterReduceOf(source, target);
-  if (cr > 0) {
+  if (cr > 0 && !opts?.ignoresTroopCounter) {
     reduce.push({
       unitId: target.general.id,
       skillId: 'troop_counter',
       skillName: '兵种克制',
       rate: cr,
       direction: 'reduce',
     });
   }
   return { caused, taken, reduce };
 }
@@ -2209,29 +2423,138 @@ function redirectPhysicalHit(ctx: CombatContext, original: UnitState): UnitState
       if (skill?.type !== 'passive' || !skill.redirectAllyPhysical) continue;
       const cfg = skill.redirectAllyPhysical;
       if (ctx.currentRound < 1 || ctx.currentRound > cfg.rounds) continue;
       if (!cfg.positions.includes(u.general.position)) continue;
       return u;
     }
   }
   return original;
 }
 
-/** 次数型「下一次攻击」：一次 physical/strategy/positional 输出或一次普攻消耗 1 次（不按目标数） */
-function consumeAttackCharges(ctx: CombatContext, attacker: UnitState): void {
+/**
+ * 次数型「下一次攻击」：一次 physical/strategy/positional 输出或一次普攻消耗 1 次（不按目标数）。
+ * 只扣 caused（青丘 / 全军突击），taken 由受击路径消耗。
+ * `hit` 过滤不匹配的 charges（虎步关右 physical 不被策略消耗）；无 hit 时不过滤（兼容青丘等无过滤 charges）。
+ */
+function consumeAttackCharges(ctx: CombatContext, attacker: UnitState, hit?: DamageHitContext): void {
   for (const s of [...attacker.statuses]) {
     if (s.type !== 'damage_boost' || s.charges == null) continue;
+    if (s.direction === 'taken') continue;
+    if (!statusMatchesHit(s, hit)) continue;
     s.charges -= 1;
     if (s.charges <= 0) attacker.statuses = attacker.statuses.filter((x) => x !== s);
   }
 }
 
+/**
+ * 受击次数型 taken charges（文伐：下一次受到策略攻击）：
+ * 本次伤害已计入该层（damageBoosts 在 applyDamage 之前算完），扣兵后再 −1，到 0 移除。
+ * 物理受击不匹配 strategy taken，不消耗。
+ */
+function consumeTakenCharges(target: UnitState, hit: DamageHitContext): void {
+  for (const s of [...target.statuses]) {
+    if (s.type !== 'damage_boost' || s.direction !== 'taken' || s.charges == null) continue;
+    if (!statusMatchesHit(s, hit)) continue;
+    s.charges -= 1;
+    if (s.charges <= 0) target.statuses = target.statuses.filter((x) => x !== s);
+  }
+}
+
+/**
+ * 恃强淬锋：受匹配伤害且实际扣兵后 fifths −1；
+ * rate = baseRate × fifths / fifthsBase；fifths ≤ 0 则移除。
+ */
+function decayFifthsOnHit(ctx: CombatContext, target: UnitState, hit: DamageHitContext): void {
+  for (const s of [...target.statuses]) {
+    if (s.type !== 'damage_boost' || s.fifths === undefined || s.baseRate === undefined || s.fifthsBase === undefined) {
+      continue;
+    }
+    if (!statusMatchesHit(s, hit)) continue;
+    s.fifths -= 1;
+    if (s.fifths <= 0) {
+      target.statuses = target.statuses.filter((x) => x !== s);
+      ctx.events.push({ type: 'status_expired', unitId: target.general.id, statusType: s.type });
+      continue;
+    }
+    s.rate = s.baseRate * (s.fifths / s.fifthsBase);
+  }
+}
+
+/**
+ * 恃强淬锋：给持有者叠 1 层造成物理伤害提高（sameSource 累加，maxStacks 封顶）。
+ */
+function applySelfPhysBoost(ctx: CombatContext, unit: UnitState, skill: Extract<Skill, { type: 'passive' }>): void {
+  const cfg = skill.selfPhysBoost;
+  if (!cfg) return;
+  inflictStatus(
+    ctx,
+    unit,
+    {
+      type: 'damage_boost',
+      rate: cfg.perStack,
+      duration: cfg.duration,
+      direction: 'caused',
+      damageType: 'physical',
+      stacks: 1,
+      maxStacks: cfg.maxStacks,
+      attackScaled: cfg.attackScaled,
+    },
+    skill.type,
+    skill.id,
+    unit.general.id
+  );
+}
+
+/** 次数型分兵：每次分兵攻击消耗 1 次，charges 耗尽则移除（鱼鳞/飒沓如星） */
+function consumeSplitCharges(unit: UnitState): void {
+  for (const s of [...unit.statuses]) {
+    if (s.type !== 'split' || !('charges' in s) || s.charges == null) continue;
+    s.charges -= 1;
+    if (s.charges <= 0) unit.statuses = unit.statuses.filter((x) => x !== s);
+  }
+}
+
+/**
+ * 伤害段连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气判定，成功则去掉 chain 后以 `random_single` 再打同一段，然后 `p -= decay`。
+ * 递归调用已剥离 chain，不会无限递归；decay ≤ 0 时只追加一段后停止。
+ */
+function executeDamageChain(
+  ctx: CombatContext,
+  caster: UnitState,
+  skill: Skill,
+  targets: UnitState[],
+  out: Extract<SkillOutput, { kind: 'physical_damage' } | { kind: 'strategy_damage' }>
+): void {
+  if (!out.chain) return;
+  let p = out.chain.chance;
+  while (p > 0) {
+    const morale = effectiveMorale(caster);
+    const rate = moraleTriggerRate(morale, p);
+    const success = ctx.rng.chance(rate);
+    ctx.events.push({
+      type: 'skill_trigger',
+      unitId: caster.general.id,
+      skillId: skill.id,
+      skillName: skill.name,
+      success,
+      rate: Math.round(rate * 100),
+      baseRate: Math.round(p * 100),
+      morale,
+    });
+    if (!success) break;
+    const { chain: _omit, ...rest } = out;
+    executeSkillOutputs(ctx, caster, skill, targets, [{ ...rest, chain: undefined, targetMode: 'random_single' }]);
+    p -= out.chain.decay;
+    if (out.chain.decay <= 0) break;
+  }
+}
+
 function executeSkillOutputs(
   ctx: CombatContext,
   caster: UnitState,
   skill: Skill,
   targets: UnitState[],
   outputs?: SkillOutput[]
 ): void {
   const list = outputs ?? skill.output;
   /** 上两段伤害输出的实际目标，供 onlyIfOverlapPrevious（怀德畏威重合混乱）取交集 */
   let prevDamageTargetIds: string[] = [];
@@ -2243,23 +2566,46 @@ function executeSkillOutputs(
   for (const out of list) {
     if (out.kind === 'physical_damage') {
       if (out.startRound != null && ctx.currentRound < out.startRound) continue;
       if (out.endRound != null && ctx.currentRound > out.endRound) continue;
     }
     if (out.kind === 'random_pick') {
       const picked = ctx.rng.pickN(out.options, out.count);
       executeSkillOutputs(ctx, caster, skill, targets, picked.flat());
       continue;
     }
+    if (out.kind === 'chance_group') {
+      const morale = effectiveMorale(caster);
+      const rate = moraleTriggerRate(morale, out.chance);
+      const success = ctx.rng.chance(rate);
+      ctx.events.push({
+        type: 'skill_trigger',
+        unitId: caster.general.id,
+        skillId: skill.id,
+        skillName: skill.name,
+        success,
+        rate: Math.round(rate * 100),
+        baseRate: Math.round(out.chance * 100),
+        morale,
+      });
+      if (success) executeSkillOutputs(ctx, caster, skill, targets, out.outputs);
+      continue;
+    }
     // 被动/指挥输出级独立发动率（击势 65%、指挥 roundStartRepeat chance）：士气修正后判定，失败则跳过该段
     // before_active 指挥（运筹决胜）已在 triggerBeforeActiveCommands 逐段判定，此处不再重复
-    if ((skill.type === 'passive' || (skill.type === 'command' && skill.roundTrigger !== 'before_active')) && 'chance' in out && out.chance != null) {
+    // recipient 代打改在每人上 roll，不走整段一次判定（先声夺人等非代打仍走此处）
+    if (
+      (skill.type === 'passive' || (skill.type === 'command' && skill.roundTrigger !== 'before_active')) &&
+      'chance' in out &&
+      out.chance != null &&
+      !(out.kind === 'physical_damage' && out.attacker === 'recipient')
+    ) {
       const morale = effectiveMorale(caster);
       const rate = moraleTriggerRate(morale, out.chance);
       const success = ctx.rng.chance(rate);
       ctx.events.push({
         type: 'skill_trigger',
         unitId: caster.general.id,
         skillId: skill.id,
         skillName: skill.name,
         success,
         rate: Math.round(rate * 100),
@@ -2267,22 +2613,27 @@ function executeSkillOutputs(
         morale,
       });
       if (!success) continue;
     }
     // 单输出目标池：target:'self' → 施法者；targetMode 覆盖 → 按战法距离重新选敌/友军目标
     const enemies = caster.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
     const allies = caster.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
     const outTarget = out.kind === 'positional_physical_damage' || out.kind === 'morale_branch' ? undefined : out.target;
     const outMode =
       out.kind === 'physical_damage' || out.kind === 'strategy_damage' ? out.targetMode : undefined;
-    const outRange =
-      out.kind === 'physical_damage' && out.ignoreRange ? Number.POSITIVE_INFINITY : skill.range;
+    const outIgnoreRange =
+      (out.kind === 'physical_damage' || out.kind === 'strategy_damage') && 'ignoreRange' in out && out.ignoreRange;
+    const outExplicitRange =
+      (out.kind === 'physical_damage' || out.kind === 'strategy_damage') && 'range' in out && out.range != null
+        ? out.range
+        : undefined;
+    const outRange = outIgnoreRange ? Number.POSITIVE_INFINITY : (outExplicitRange ?? skill.range);
     // 属性吸取（黄天余音）/ 分流治疗（合流、三军之众、利兵谋胜）：
     // inflict_status / heal 可带 targetSide/targetMode 单输出目标池覆盖
     const outSide = out.kind === 'inflict_status' || out.kind === 'heal' ? out.targetSide : undefined;
     const outSideMode = out.kind === 'inflict_status' || out.kind === 'heal' ? out.targetMode : undefined;
     const allyPool =
       (out.kind === 'heal' || out.kind === 'inflict_status') && out.excludeSelf
         ? allies.filter((u) => u.general.id !== caster.general.id)
         : allies;
     let pool =
       outTarget === 'self'
@@ -2294,22 +2645,105 @@ function executeSkillOutputs(
             : outSide === 'enemy'
               ? skillTargets(ctx, caster, enemies, skill.range, outSideMode ?? 'single')
               : outSide === 'ally'
                 ? skillTargets(ctx, caster, allyPool, skill.range, outSideMode ?? 'single')
                 : targets;
     // 怀德畏威：混乱只打「友军随机单体攻击 ∩ 自身群体策略」重合目标，不再按战法整体目标重选
     if (out.kind === 'inflict_status' && out.onlyIfOverlapPrevious) {
       const overlap = new Set(lastDamageTargetIds.filter((id) => prevDamageTargetIds.includes(id)));
       pool = ctx.myTeam.concat(ctx.enemyTeam).filter((u) => u.alive && overlap.has(u.general.id));
     }
+    if (out.kind === 'inflict_status' && out.positions && out.positions.length > 0) {
+      const foes = caster.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
+      pool = foes.filter((u) => u.alive && out.positions!.includes(u.general.position));
+    }
+    // recipient 代打：忽略 targetMode 从敌军重建的池，用锁定/战法目标（友军）再滤兵种
+    if (out.kind === 'physical_damage' && out.attacker === 'recipient') {
+      pool = targets;
+    }
+    if ('troopTypes' in out && out.troopTypes && out.troopTypes.length > 0) {
+      pool = pool.filter((u) => out.troopTypes!.includes(u.general.troopType));
+    }
     switch (out.kind) {
       case 'physical_damage': {
+        if (out.attacker === 'recipient') {
+          const atkRange = out.range ?? skill.range;
+          const selectedIds: string[] = [];
+          for (const rider of pool) {
+            if (!rider.alive) continue;
+            if (out.chance != null) {
+              const morale = effectiveMorale(caster);
+              const rate = moraleTriggerRate(morale, out.chance);
+              const success = ctx.rng.chance(rate);
+              ctx.events.push({
+                type: 'skill_trigger',
+                unitId: caster.general.id,
+                skillId: skill.id,
+                skillName: skill.name,
+                success,
+                rate: Math.round(rate * 100),
+                baseRate: Math.round(out.chance * 100),
+                morale,
+                targetId: rider.general.id,
+              });
+              if (!success) continue;
+            }
+            const foes = skillTargets(ctx, rider, enemies, atkRange, 'single');
+            let riderAttacked = false;
+            for (const raw of foes) {
+              if (!raw.alive) continue;
+              const t = redirectPhysicalHit(ctx, raw);
+              if (!t.alive) continue;
+              riderAttacked = true;
+              selectedIds.push(t.general.id);
+              triggerStackBuff(ctx, rider, t, 'physical');
+              if (!out.ignoresEvasion && consumeEvasion(ctx, t, rider.general.id)) continue;
+              const atk = effectiveStat(rider, 'attack');
+              const def = physicalTargetDefense(rider, t);
+              const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: skill.type };
+              const { causedMult, takenMult } = damageBoosts(ctx, rider, t, hit);
+              const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(rider, t);
+              const reduce = sumReduce(t, hit) + counterReduce;
+              const rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
+              const { damage, breakdown } = calcDamage(
+                {
+                  damageType: 'physical',
+                  rate,
+                  attackerAttack: atk,
+                  attackerStrategy: rider.general.strategy,
+                  attackerTroops: rider.troops,
+                  targetDefense: def,
+                  targetStrategy: t.general.strategy,
+                  mult: buffMult(causedMult, takenMult, reduce),
+                },
+                ctx.rng
+              );
+              const capped = applyTroopCap(damage, t.troops);
+              ctx.events.push({
+                type: 'damage',
+                sourceId: rider.general.id,
+                targetId: t.general.id,
+                skillId: skill.id,
+                skillName: skill.name,
+                damageType: 'physical',
+                damage: capped,
+                breakdown,
+                modifiers: collectDamageModifiers(ctx, rider, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
+              });
+              applyDamage(ctx, t, capped, rider, 'physical', 'skill');
+            }
+            if (riderAttacked) consumeAttackCharges(ctx, rider, { damageSource: 'skill', damageType: 'physical', skillType: skill.type });
+          }
+          rememberDamageTargets(selectedIds);
+          executeDamageChain(ctx, caster, skill, targets, out);
+          break;
+        }
         const source =
           out.attacker === 'lowest_strategy_ally' ? lowestStrategyAlly(allies, caster) : caster;
         if (!source) {
           rememberDamageTargets([]);
           break;
         }
         let attacked = false;
         const selectedIds: string[] = [];
         const times = Array.isArray(out.repeats)
           ? ctx.rng.intInclusive(out.repeats[0], out.repeats[1])
@@ -2333,22 +2767,24 @@ function executeSkillOutputs(
             const t = redirectPhysicalHit(ctx, raw);
             if (!t.alive) continue;
             attacked = true;
             selectedIds.push(t.general.id);
             // 常驻伤害前叠层（持节镇西）：伤害源叠攻击、受击者叠防御
             triggerStackBuff(ctx, source, t, 'physical');
             // 规避：默认免疫一次伤害；ignoresEvasion 时无视
             if (!out.ignoresEvasion && consumeEvasion(ctx, t, source.general.id)) continue;
             const atk = effectiveStat(source, 'attack');
             const def = physicalTargetDefense(source, t);
-            const { causedMult, takenMult } = damageBoosts(ctx, source, t);
-            const reduce = sumRates(t.statuses, 'damage_reduce') + troopCounterReduceOf(source, t);
+            const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: skill.type };
+            const { causedMult, takenMult } = damageBoosts(ctx, source, t, hit);
+            const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(source, t);
+            const reduce = sumReduce(t, hit) + counterReduce;
             const rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
             const { damage, breakdown } = calcDamage(
               {
                 damageType: 'physical',
                 rate,
                 attackerAttack: atk,
                 attackerStrategy: source.general.strategy,
                 attackerTroops: source.troops,
                 targetDefense: def,
                 targetStrategy: t.general.strategy,
@@ -2361,21 +2797,21 @@ function executeSkillOutputs(
               type: 'damage',
               sourceId: source.general.id,
               // 借谋略最低友军攻击（怀德畏威）：杀伤统计归属施法者
               creditToId: source.general.id === caster.general.id ? undefined : caster.general.id,
               targetId: t.general.id,
               skillId: skill.id,
               skillName: skill.name,
               damageType: 'physical',
               damage: capped,
               breakdown,
-              modifiers: collectDamageModifiers(ctx, source, t),
+              modifiers: collectDamageModifiers(ctx, source, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
             });
             applyDamage(ctx, t, capped, source, 'physical', 'skill');
             // 首次攻击标记（辕门射戟）：对本次攻击目标施加「造成攻击伤害降低」debuff（damage_boost caused 负值，
             // buffMult 10% 伤害下限 → 强制目标造成伤害降为 min 10%），持续 duration 回合；第二次攻击独立选目标不受影响
             if (out.markCausedReduce && t.alive) {
               inflictStatus(
                 ctx,
                 t,
                 { type: 'damage_boost', rate: out.markCausedReduce.rate, duration: out.markCausedReduce.duration, direction: 'caused' },
                 skill.type,
@@ -2403,42 +2839,44 @@ function executeSkillOutputs(
                   { type: 'damage_boost', rate: layerRate, duration: out.markTakenBoost.duration, direction: 'taken', stacks: 1 },
                   skill.type,
                   skill.id,
                   caster.general.id
                 );
               }
             }
           }
         }
         rememberDamageTargets(selectedIds);
-        if (attacked) consumeAttackCharges(ctx, source);
+        if (attacked) consumeAttackCharges(ctx, source, { damageSource: 'skill', damageType: 'physical', skillType: skill.type });
+        executeDamageChain(ctx, caster, skill, targets, out);
         break;
       }
       case 'strategy_damage': {
         const selectedIds: string[] = [];
         for (const t of pool) {
           if (!t.alive) continue;
           if (out.requireStatuses?.length && !out.requireStatuses.some((st) => hasStatus(t, st))) continue;
           selectedIds.push(t.general.id);
           // 常驻伤害前叠层（持节镇西）：施法者叠谋略、受击者叠防御
           triggerStackBuff(ctx, caster, t, 'strategy');
           // 规避：默认免疫一次伤害；ignoresEvasion 时无视
           if (!out.ignoresEvasion && consumeEvasion(ctx, t, caster.general.id)) continue;
           // 叠层后再读生效谋略（与物理伤害先叠攻击再读 effectiveStat 对齐；
           // 群体逐目标叠层，每段伤害吃到截至本目标的全部层）
           const effStrategy = effectiveStat(caster, 'strategy');
           let rate = out.rate;
-          if (out.strategyScaled) {
+          if (out.strategyScaled && out.growthRate !== undefined) {
             rate = roundRate(scaledValue(out.rate, out.growthRate, effStrategy));
           }
-          const { causedMult, takenMult } = damageBoosts(ctx, caster, t);
-          const reduce = sumRates(t.statuses, 'damage_reduce') + troopCounterReduceOf(caster, t);
+          const hit: DamageHitContext = { damageSource: 'skill', damageType: 'strategy', skillType: skill.type };
+          const { causedMult, takenMult } = damageBoosts(ctx, caster, t, hit);
+          const reduce = sumReduce(t, hit) + troopCounterReduceOf(caster, t);
           const { damage, breakdown } = calcDamage(
             {
               damageType: 'strategy',
               rate,
               attackerAttack: caster.general.attack,
               attackerStrategy: effStrategy,
               attackerTroops: caster.troops,
               targetDefense: t.general.defense,
               targetStrategy: t.general.strategy,
               mult: buffMult(causedMult, takenMult, reduce),
@@ -2448,26 +2886,27 @@ function executeSkillOutputs(
           const capped = applyTroopCap(damage, t.troops);
           ctx.events.push({
             type: 'damage',
             sourceId: caster.general.id,
             targetId: t.general.id,
             skillId: skill.id,
             skillName: skill.name,
             damageType: 'strategy',
             damage: capped,
             breakdown,
-            modifiers: collectDamageModifiers(ctx, caster, t),
+            modifiers: collectDamageModifiers(ctx, caster, t, true, hit),
           });
           applyDamage(ctx, t, capped, caster, 'strategy', 'skill');
         }
         rememberDamageTargets(selectedIds);
-        if (pool.some((t) => t.alive)) consumeAttackCharges(ctx, caster);
+        if (pool.some((t) => t.alive)) consumeAttackCharges(ctx, caster, { damageSource: 'skill', damageType: 'strategy', skillType: skill.type });
+        executeDamageChain(ctx, caster, skill, targets, out);
         break;
       }
       case 'heal': {
         let rate = out.rate;
         if (out.strategyScaled) {
           const scaled = scaledValue(out.rate, out.growthRate, caster.general.strategy);
           rate = roundRate(scaled);
         }
         for (const t of pool) {
           if (!t.alive) continue;
@@ -2620,20 +3059,35 @@ function executeSkillOutputs(
             if (create.growthRate !== undefined) {
               const sign = Math.sign(create.rate) || 1;
               const scaled =
                 (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'speed'))) /
                   100) *
                 sign;
               inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
             } else {
               inflictStatus(ctx, t, create, skill.type, skill.id, caster.general.id);
             }
+          } else if (
+            (create.type === 'damage_boost' || create.type === 'damage_reduce') &&
+            create.attackScaled
+          ) {
+            /** 增减伤受攻击影响（万箭 −50%、恃强 −30%）；growthRate 缺省时不缩放、用基值 */
+            if (create.growthRate !== undefined) {
+              const sign = Math.sign(create.rate) || 1;
+              const scaled =
+                (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'attack'))) /
+                  100) *
+                sign;
+              inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
+            } else {
+              inflictStatus(ctx, t, create, skill.type, skill.id, caster.general.id);
+            }
           } else if (
             (create.type === 'attack_buff' || create.type === 'defense_buff' || create.type === 'strategy_buff' || create.type === 'speed_buff') &&
             create.strategyScaled && create.growthRate !== undefined
           ) {
             // 属性 buff 受谋略影响（其疾如风速度+41 / 魏武之世四维-15%）：
             // 实际数值 = 基础 + 成长率×(生效谋略-80)；按绝对值缩放后恢复符号
             // （减益类基础值为负，效果幅度随谋略增强：如 -15% 谋略216 → -35%）
             // 百分比类（percent）按 1% 粒度「八舍九入」取整；点数类四舍五入
             const scaled = scaledValue(Math.abs(create.amount), create.growthRate, effectiveStat(caster, 'strategy'));
             const amount = (create.percent ? roundRate(scaled) : Math.round(scaled)) * Math.sign(create.amount);
@@ -2668,38 +3122,94 @@ function executeSkillOutputs(
       }
       case 'morale_branch': {
         const threshold = out.threshold ?? 100;
         for (const t of pool) {
           if (!t.alive) continue;
           const branch = effectiveMorale(t) > threshold ? out.high : out.low;
           executeSkillOutputs(ctx, caster, skill, [t], branch);
         }
         break;
       }
+      case 'positional_physical_damage': {
+        const positioned = enemies.filter((t) => out.positions.includes(t.general.position) && t.alive);
+        const source = out.source === 'self' ? caster : fastestAlly(allies, caster);
+        if (!source) {
+          rememberDamageTargets([]);
+          break;
+        }
+        const rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
+        let attacked = false;
+        const selectedIds: string[] = [];
+        for (const raw of positioned) {
+          if (!raw.alive) continue;
+          const t = redirectPhysicalHit(ctx, raw);
+          if (!t.alive) continue;
+          attacked = true;
+          selectedIds.push(t.general.id);
+          triggerStackBuff(ctx, source, t, 'physical');
+          const atk = effectiveStat(source, 'attack');
+          const def = physicalTargetDefense(source, t);
+          const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: skill.type };
+          const { causedMult, takenMult } = damageBoosts(ctx, source, t, hit);
+          const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(source, t);
+          const reduce = sumReduce(t, hit) + counterReduce;
+          const { damage, breakdown } = calcDamage(
+            {
+              damageType: 'physical',
+              rate,
+              attackerAttack: atk,
+              attackerStrategy: source.general.strategy,
+              attackerTroops: source.troops,
+              targetDefense: def,
+              targetStrategy: t.general.strategy,
+              mult: buffMult(causedMult, takenMult, reduce),
+            },
+            ctx.rng
+          );
+          const capped = applyTroopCap(damage, t.troops);
+          ctx.events.push({
+            type: 'damage',
+            sourceId: source.general.id,
+            creditToId: source.general.id === caster.general.id ? undefined : caster.general.id,
+            targetId: t.general.id,
+            skillId: skill.id,
+            skillName: skill.name,
+            damageType: 'physical',
+            damage: capped,
+            breakdown,
+            modifiers: collectDamageModifiers(ctx, source, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
+          });
+          applyDamage(ctx, t, capped, source, 'physical', 'skill');
+        }
+        rememberDamageTargets(selectedIds);
+        if (attacked) consumeAttackCharges(ctx, source, { damageSource: 'skill', damageType: 'physical', skillType: skill.type });
+        break;
+      }
     }
   }
 }
 
 /** 主动战法：发动率判定 → 准备检查 → 目标选择 → 执行效果 */
 export function triggerActiveSkill(
   ctx: CombatContext,
   unit: UnitState,
   skill: Skill,
   enemies: UnitState[],
   allies: UnitState[],
   attackPool: UnitState[]
 ): void {
   // 七步释嫌等：进入主动发动率判定即「试图发动」
   triggerAllyActCommands(ctx, unit);
   if (!unit.alive) return;
   // 发动率提升：乘算（难知如阴）或加算封顶（动如雷震），再乘士气系数
-  const base = boostedBaseRate(unit, 'active', skill.triggerRate);
+  const rolled = rollTriggerRate(ctx.rng, skill.triggerRate);
+  const base = boostedBaseRate(unit, 'active', rolled);
   const morale = effectiveMorale(unit);
   const rate = moraleTriggerRate(morale, base);
   const success = ctx.rng.chance(rate);
   ctx.events.push({
     type: 'skill_trigger',
     unitId: unit.general.id,
     skillId: skill.id,
     skillName: skill.name,
     success,
     // 战报显示：当前生效几率（含士气修正）——70% × 士气系数 1.12 = 78%
@@ -2716,43 +3226,78 @@ export function triggerActiveSkill(
     if (jump && ctx.rng.chance(jump.rate)) {
       ctx.events.push({
         type: 'prepare_skip',
         unitId: unit.general.id,
         skillId: skill.id,
         skillName: skill.name,
       });
     } else {
       unit.isPreparing = true;
       unit.preparingSkillId = skill.id;
+      unit.prepareLeft = (skill.type === 'active' && skill.prepare ? (skill.prepareTurns ?? 1) : 1);
       ctx.events.push({
         type: 'prepare_start',
         unitId: unit.general.id,
         skillId: skill.id,
         skillName: skill.name,
       });
       return;
     }
   }
 
   executeSkillWithTargets(ctx, unit, skill, enemies, allies, attackPool);
+  triggerAfterFirstActiveCommands(ctx, unit);
 }
 
 /** 准备完成的战法自动发动 */
 function executePreparedSkill(
   ctx: CombatContext,
   unit: UnitState,
   skill: Skill,
   enemies: UnitState[],
   attackPool: UnitState[]
 ): void {
   const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
   executeSkillWithTargets(ctx, unit, skill, enemies, allies, attackPool);
+  triggerAfterFirstActiveCommands(ctx, unit);
+}
+
+/**
+ * 本回合首次主动战法实际释放成功后触发二类指挥（文德椒房）。
+ * 进入准备不算；准备完成释放与 jump_prep 跳过准备直放都算。
+ * 每次按战法距离 / groupCount 重选目标；施法者已阵亡则只记标记不结算。
+ */
+function triggerAfterFirstActiveCommands(ctx: CombatContext, unit: UnitState): void {
+  if (unit.firstActiveSucceededThisRound) return;
+  unit.firstActiveSucceededThisRound = true;
+  if (!unit.alive) return;
+  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
+  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
+  for (const id of unit.general.commandSkillIds) {
+    const skill = resolveSkill(ctx, id);
+    if (skill?.type !== 'command' || skill.phase !== 'round') continue;
+    if (skill.roundTrigger !== 'after_first_active') continue;
+    const side = skill.targetSide ?? 'ally';
+    const pool = side === 'ally' ? allies : enemies;
+    const mode: 'single' | 'group' | 'all' =
+      skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
+        ? skill.targetMode
+        : 'group';
+    const selected = skillTargets(ctx, unit, pool, skill.range, mode, skill.groupCount);
+    ctx.events.push({
+      type: 'skill_cast',
+      unitId: unit.general.id,
+      skillId: skill.id,
+      skillName: skill.name,
+    });
+    executeSkillOutputs(ctx, unit, skill, selected);
+  }
 }
 
 function executeSkillWithTargets(
   ctx: CombatContext,
   unit: UnitState,
   skill: Skill,
   enemies: UnitState[],
   allies: UnitState[],
   attackPool: UnitState[]
 ): void {
@@ -2768,20 +3313,21 @@ function executeSkillWithTargets(
   } else {
     // 暴走：战法目标不分敌我（含友军/敌军）
     const rampage = hasStatus(unit, 'rampage');
     // 增益类效果（清 debuff / 上规避 / 治疗 / 正向属性 buff）作用于友军（非暴走时）。
     // 负值属性 buff（debuff，amount<0）作用于敌军；target:'self' 的输出只作用于施法者自身，不决定战法整体目标池
     const selfBuff = skill.output.some(
       (o) =>
         o.kind !== 'positional_physical_damage' &&
         o.kind !== 'morale_branch' &&
         o.kind !== 'random_pick' &&
+        o.kind !== 'chance_group' &&
         o.target !== 'self' &&
         // 单输出已覆盖目标池的 heal/inflict 不决定战法整体目标（利兵谋胜：伤敌 + 治友）
         !('targetSide' in o && o.targetSide) &&
         (o.kind === 'remove_debuffs' ||
           o.kind === 'grant_evasion' ||
           o.kind === 'heal' ||
           (o.kind === 'inflict_status' &&
             (Array.isArray(o.status) ? o.status : [o.status]).some(
               (st) =>
                 (st.type === 'attack_buff' && (st.amount ?? 0) > 0) ||
@@ -2807,20 +3353,24 @@ function executeSkillWithTargets(
     targets = skillTargets(ctx, unit, pool, skill.range, targetMode, skill.groupCount ?? 2);
   }
 
   ctx.events.push({
     type: 'skill_target',
     unitId: unit.general.id,
     skillId: skill.id,
     targetIds: targets.map((t) => t.general.id),
   });
   if (targets.length === 0) return;
+  if (skill.teamTroopFilter && !teamPassesTroopFilter(
+    unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam,
+    skill.teamTroopFilter
+  )) return;
 
   ctx.events.push({
     type: 'skill_cast',
     unitId: unit.general.id,
     skillId: skill.id,
     skillName: skill.name,
   });
   executeSkillOutputs(ctx, unit, skill, targets);
 }
 
@@ -2832,21 +3382,22 @@ function triggerPursuitSkill(
   hitTarget: UnitState,
   enemies: UnitState[]
 ): void {
   // 妖术诅咒（密谋定蜀）：试图发动追击战法时（进入判定，无论发动率结果）受到妖术诅咒伤害；诅咒致死则终止判定
   triggerCurseOnPursuit(ctx, unit);
   if (!unit.alive) return;
   // 七步释嫌等：进入追击发动率判定即「试图发动」
   triggerAllyActCommands(ctx, unit);
   if (!unit.alive) return;
   // 发动率提升：追击同样吃 trigger_boost（动如雷震仅追击加算 +100 个百分点）
-  const base = boostedBaseRate(unit, 'pursuit', skill.triggerRate);
+  const rolled = rollTriggerRate(ctx.rng, skill.triggerRate);
+  const base = boostedBaseRate(unit, 'pursuit', rolled);
   const morale = effectiveMorale(unit);
   const rate = moraleTriggerRate(morale, base);
   const success = ctx.rng.chance(rate);
   ctx.events.push({
     type: 'skill_trigger',
     unitId: unit.general.id,
     skillId: skill.id,
     skillName: skill.name,
     success,
     rate: Math.round(rate * 100),
@@ -2952,54 +3503,55 @@ function normalAttack(
 }
 
 /** 计算并结算一次兵刃普攻（含连击的追击加成待做） */
 function dealAttack(ctx: CombatContext, unit: UnitState, target: UnitState, distance: number): void {
   const hit = redirectPhysicalHit(ctx, target);
   if (!hit.alive) return;
   // 常驻伤害前叠层（持节镇西）：攻击方叠攻击、受击者叠防御
   triggerStackBuff(ctx, unit, hit, 'physical');
   const atk = effectiveStat(unit, 'attack');
   const def = physicalTargetDefense(unit, hit);
-  const { causedMult, takenMult } = damageBoosts(ctx, unit, hit);
-  const reduce = sumRates(hit.statuses, 'damage_reduce') + troopCounterReduceOf(unit, hit);
+  const hitCtx: DamageHitContext = { damageSource: 'basic', damageType: 'physical' };
+  const { causedMult, takenMult } = damageBoosts(ctx, unit, hit, hitCtx);
+  const reduce = sumReduce(hit, hitCtx) + troopCounterReduceOf(unit, hit);
   const { damage, breakdown } = calcDamage(
     {
       damageType: 'physical',
       rate: 100,
       attackerAttack: atk,
       attackerStrategy: unit.general.strategy,
       attackerTroops: unit.troops,
       targetDefense: def,
       targetStrategy: hit.general.strategy,
       mult: buffMult(causedMult, takenMult, reduce),
     },
     ctx.rng
   );
   const capped = applyTroopCap(damage, hit.troops);
 
   // 规避：命中前判定免疫
   if (consumeEvasion(ctx, hit, unit.general.id)) {
-    consumeAttackCharges(ctx, unit);
+    consumeAttackCharges(ctx, unit, { damageSource: 'basic', damageType: 'physical' });
     return;
   }
 
   ctx.events.push({
     type: 'attack_hit',
     sourceId: unit.general.id,
     targetId: hit.general.id,
     distance,
     damage: capped,
     breakdown,
-    modifiers: collectDamageModifiers(ctx, unit, hit),
+    modifiers: collectDamageModifiers(ctx, unit, hit, true, hitCtx),
   });
   applyDamage(ctx, hit, capped, unit, 'physical', 'basic');
-  consumeAttackCharges(ctx, unit);
+  consumeAttackCharges(ctx, unit, { damageSource: 'basic', damageType: 'physical' });
 }
 
 /** 持续型急救受击触发（皇裔流离/金匮要略）：目标受到伤害后判定。
  *  每个急救状态独立判定一次：按战法级计数器当前触发率 rng 判定，成功则恢复兵力（受围困拦截），
  *  并累计战法级总生效次数——每达到 triggerUpEvery 次，触发率 +triggerUpIncrement（可叠加）。
  *  兵力已归零或已阵亡时不判定（致死一击不可救回、不可复活）。 */
 function triggerFirstAidOnHurt(ctx: CombatContext, target: UnitState): void {
   // 致死一击（兵力已归零）或已阵亡：不判定急救，避免「打死又复活」
   if (!target.alive || target.troops <= 0) return;
   const aids = target.statuses.filter((s) => s.type === 'first_aid') as Extract<Status, { type: 'first_aid' }>[];
@@ -3396,22 +3948,23 @@ function applyOnHurtEffect(
  * 不消耗 counter 状态。
  */
 function settleCounterOnHurt(ctx: CombatContext, holder: UnitState, attacker: UnitState): void {
   const counters = holder.statuses.filter(
     (s): s is Extract<Status, { type: 'counter' }> => s.type === 'counter'
   );
   for (const status of counters) {
     if (!attacker.alive) break;
     const atk = effectiveStat(holder, 'attack');
     const def = physicalTargetDefense(holder, attacker);
-    const { causedMult, takenMult } = damageBoosts(ctx, holder, attacker);
-    const reduce = sumRates(attacker.statuses, 'damage_reduce') + troopCounterReduceOf(holder, attacker);
+    const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: 'command' };
+    const { causedMult, takenMult } = damageBoosts(ctx, holder, attacker, hit);
+    const reduce = sumReduce(attacker, hit) + troopCounterReduceOf(holder, attacker);
     const { damage, breakdown } = calcDamage(
       {
         damageType: 'physical',
         rate: status.rate,
         attackerAttack: atk,
         attackerStrategy: holder.general.strategy,
         attackerTroops: holder.troops,
         targetDefense: def,
         targetStrategy: attacker.general.strategy,
         mult: buffMult(causedMult, takenMult, reduce),
@@ -3422,21 +3975,21 @@ function settleCounterOnHurt(ctx: CombatContext, holder: UnitState, attacker: Un
     ctx.events.push({
       type: 'damage',
       sourceId: holder.general.id,
       creditToId: holder.general.id,
       targetId: attacker.general.id,
       skillId: status.sourceSkillId,
       skillName: resolveSkill(ctx, status.sourceSkillId)?.name ?? status.sourceSkillId,
       damageType: 'physical',
       damage: capped,
       breakdown,
-      modifiers: collectDamageModifiers(ctx, holder, attacker),
+      modifiers: collectDamageModifiers(ctx, holder, attacker, true, hit),
     });
     applyDamage(ctx, attacker, capped, holder, 'physical', 'skill');
   }
 }
 
 /**
  * 扣减目标兵力并走受击钩子（急救 / 引燃 / onHurt）。
  * @param damageType 本次伤害类型；缺省不按 `onHurt.damageKind` 过滤，旧调用保持原行为
  * @param damageSource 伤害来源；缺省不传或 `'basic'` 均匹配 `onHurt.damageSource==='basic'`，仅明确 `'skill'` 被拒绝
  */
@@ -3466,20 +4019,33 @@ export function applyDamage(
   // 死亡按受伤量结算，治疗不冲减死亡（避免高恢复队伍在战场上太过逆天）。
   // 配置了机制即入池（base=0 时全部为伤兵）；未配置（直接构造 ctx）不启用。
   // 按实际扣减量拆分（溢出伤害不入池），避免致死溢出把伤兵池撑爆后再被急救拉回。
   if (ctx.woundedMortality && actual > 0) {
     const rate = mortalityRate(ctx, ctx.currentRound);
     const dead = Math.round((actual * rate) / 100);
     const wounded = actual - dead;
     if (wounded > 0) target.wounded += wounded;
     target.totalDead += dead;
   }
+  if (actual > 0) {
+    const hit: DamageHitContext = { damageSource, damageType };
+    consumeTakenCharges(target, hit);
+    decayFifthsOnHit(ctx, target, hit);
+    if (source && damageType === 'physical') {
+      for (const id of source.general.passiveSkillIds) {
+        const skill = resolveSkill(ctx, id);
+        if (skill?.type === 'passive' && skill.selfPhysBoost?.onDealPhysical) {
+          applySelfPhysBoost(ctx, source, skill);
+        }
+      }
+    }
+  }
   // 受击引燃（火势风威）：受到伤害时额外引发一次燃烧（触发后移除标记）
   triggerIgniteOnHurt(ctx, target);
   // 持续型急救：仅非致死（扣兵后仍有兵力）可触发；兵力归零立即阵亡，不得复活
   if (!lethal && target.alive && target.troops > 0) {
     triggerFirstAidOnHurt(ctx, target);
   }
   // 受击触发战法（盲侯/陷储/同仇/缓师）：在阵亡标记前判定，致死一击仍可反击
   if (actual > 0) triggerOnHurt(ctx, target, source, damageType, damageSource);
   // 反击：after_damage 已清 resolvingHurtHooks，必须再包一层，避免反击段重入 before/after/counter
   if (
diff --git a/src/engine/combat.ts b/src/engine/combat.ts
index e912ec9..e2b8ec1 100644
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -90,21 +90,24 @@ export function runBattle(config: BattleConfig): BattleReport {
   events.push({ type: 'preparation_end' });
 
   // ── 正式回合 1..maxRounds ──
   let winner: 'win' | 'loss' | 'draw' | null = null;
 
   for (let round = 1; round <= config.maxRounds; round++) {
     if (winner) break;
     const roundStartEv: BattleEvent = { type: 'round_start', round };
     events.push(roundStartEv);
     ctx.currentRound = round;
-    for (const u of [...myTeam, ...enemyTeam]) u.hasActedThisRound = false;
+    for (const u of [...myTeam, ...enemyTeam]) {
+      u.hasActedThisRound = false;
+      u.firstActiveSucceededThisRound = false;
+    }
 
     // 一类指挥回合前准备阶段（谋议宏图）：减伤按 1/8 衰减 + 士气叠层，再进入 delayedOutput / 单位行动
     tickRoundStartStatuses(ctx);
 
     // 一类指挥 delayedOutput：白衣渡江第 3 回合自动结算（无视规避，预先结算的伤害）
     triggerDelayedOutputs(ctx, round);
 
     // 每回合按当前生效速度重排（含加点、部队加成、速度增益/减益）；先手组（priorityRounds）仍优先
     const roundOrder = buildPriorityOrder([...myTeam, ...enemyTeam], round, skills);
     roundStartEv.turnOrder = roundOrder.map((u) => u.general.id);
@@ -172,20 +175,21 @@ function toUnitStates(generals: General[], side: 'my' | 'enemy'): UnitState[] {
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
+    prepareLeft: null,
   }));
 }
 
 /** 出手顺序：速度（含速度增益）降序 → 同速站位先手（前锋>中军>大营） */
 export function buildTurnOrder(units: UnitState[]): UnitState[] {
   return [...units].sort((a, b) => {
     const sa = effectiveStat(a, 'speed');
     const sb = effectiveStat(b, 'speed');
     if (sb !== sa) return sb - sa;
     return POSITION_PRIORITY[a.general.position] - POSITION_PRIORITY[b.general.position];
diff --git a/src/engine/types.ts b/src/engine/types.ts
index b3c7d68..f2e436e 100644
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -88,63 +88,97 @@ export type SkillOutput =
        */
       markTakenBoost?: {
         rate: number;
         growthRate: number;
         duration: number;
         maxStacks: number;
       };
       /**
        * 借友军出手（怀德畏威）：用谋略最低友军的攻击/兵力/造成侧增伤结算物理伤害。
        * 友军不耗行动、不受混乱拦截；杀伤统计 creditToId 归施法者。缺省为施法者自己。
+       * `'recipient'` = 以每个通过兵种过滤的目标为攻击者，按其攻击/兵力/造成侧增减伤，
+       * 对距离 `range`（缺省战法 range）内敌军单体打物理；杀伤 sourceId 为该单位。
        */
-      attacker?: 'lowest_strategy_ally';
+      attacker?: 'lowest_strategy_ally' | 'recipient';
+      /** 代打选敌距离（疏数骑兵 3）；缺省 skill.range */
+      range?: number;
+      /** 只对这些兵种的当前目标池结算 */
+      troopTypes?: TroopType[];
       /** 当前回合 ≥ 此值才结算（宣威再战第 4 回合起） */
       startRound?: number;
       /** 当前回合 ≤ 此值才结算（宣威再战前 3 回合） */
       endRound?: number;
       /**
        * 选目标时无视战法距离，从全部存活敌军中取（宣威再战第 4 回合起随机单体）。
        * 需配合 targetMode 使用；缺省仍按 skill.range 筛选。
        */
       ignoreRange?: boolean;
       /**
        * 本段重复次数；`[1, 3]` = 均匀随机 1~3 次（宣威再战第 4 回合起）。
        * 每次独立重选目标（若带 targetMode）。
        */
       repeats?: number | [number, number];
       /** 独立发动率（先声夺人第三段 60%）；士气修正后判定，与 inflict_status.chance 同口径 */
       chance?: number;
+      /**
+       * 本段打出后连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气 `moraleTriggerRate(p)`，
+       * 成功则在战法距离内独立 `random_single` 再打同一段（循环驱动，递归调用时去掉 chain），然后 `p -= decay`。
+       */
+      chain?: { chance: number; decay: number };
+      /** 为 true 时本次结算不加算兵种克制 −30% */
+      ignoresTroopCounter?: boolean;
+    }
+  | {
+      kind: 'chance_group';
+      /** 基础发动率 0~1，走施法者士气修正；成功才执行内层全部 output */
+      chance: number;
+      outputs: SkillOutput[];
     }
   | {
       kind: 'strategy_damage';
       rate: number;
       strategyScaled: boolean;
-      growthRate: number;
+      /** strategyScaled 且 growthRate === undefined 时不缩放、用基值 */
+      growthRate?: number;
       ignoresEvasion?: boolean;
       target?: 'self';
       targetMode?: 'single' | 'random_single' | 'group' | 'all';
       groupCount?: number | [number, number];
       /**
        * 独立发动率（运筹决胜策略攻击 50%），缺省必中。
        * 仅 `roundTrigger:'before_active'` 的二类指挥按此逐段判定。
        */
       chance?: number;
       /** 仅对带这些状态之一的目标生效（运筹决胜：混乱 / 暴走） */
       requireStatuses?: StatusType[];
+      /**
+       * 本段打出后连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气 `moraleTriggerRate(p)`，
+       * 成功则在战法距离内独立 `random_single` 再打同一段（循环驱动，递归调用时去掉 chain），然后 `p -= decay`。
+       */
+      chain?: { chance: number; decay: number };
+      /**
+       * 本段选敌距离（不攻每回合策略 5）。缺省 `skill.range`。
+       * 与 physical_damage.range 同口径。
+       */
+      range?: number;
+      /** 选目标时无视战法距离（对称 physical_damage.ignoreRange） */
+      ignoreRange?: boolean;
     }
   | {
       kind: 'positional_physical_damage';
       positions: Position[];
       /** 固定伤害率，或 [min, max] 区间每次随机（奇兵拒北 120~180%） */
       rate: number | [number, number];
       /** self=施法者；fastest_ally=速度最高的友军单体（不耗行动、不受混乱） */
       source: 'self' | 'fastest_ally';
+      /** 为 true 时本次结算不加算兵种克制 −30% */
+      ignoresTroopCounter?: boolean;
     }
   | {
       kind: 'inflict_status';
       /** 单个状态，或状态数组（随机选 1 个施加——奇佐鬼谋随机 1 种控制） */
       status: CreateStatus | CreateStatus[];
       target?: 'self';
       /** 单输出目标池覆盖：'enemy'=按战法距离重选敌军、'ally'=重选友军、'self'=施法者。
        *  用于属性吸取（黄天余音：敌单体 debuff + 自身/友军 buff），缺省沿用战法整体目标 */
       targetSide?: 'enemy' | 'ally' | 'self';
       /** 单输出目标模式覆盖：按战法距离重选目标（配合 targetSide 使用） */
@@ -174,22 +208,28 @@ export type SkillOutput =
         /**
          * 引爆段独立成长率（烈火焚舟二段 2.26）。
          * 缺省沿用 status.growthRate（一段与二段同率时不必写）。
          */
         growthRate?: number;
         /** 引爆后新施加 DoT 的持续回合数（如 1） */
         duration: number;
         /** 是否波及目标相邻单位 */
         adjacent: boolean;
       };
+      /** 只对这些兵种的当前目标池结算 */
+      troopTypes?: TroopType[];
+      /**
+       * 有值时忽略战法整体目标，改为选这些站位上仍存活的敌军（落首箭混乱打大营）。缺员则跳过。
+       */
+      positions?: Position[];
     }
-  | { kind: 'remove_debuffs'; target?: 'self' }
+  | { kind: 'remove_debuffs'; target?: 'self'; troopTypes?: TroopType[] }
   | { kind: 'grant_evasion'; stacks: number; target?: 'self' }
   | {
       kind: 'heal';
       rate: number;
       strategyScaled: boolean;
       growthRate: number;
       target?: 'self';
       /**
        * 单输出目标池覆盖：缺省沿用战法整体目标。
        * 合流/利兵谋胜用 ally 另选友军；三军之众每次独立重选我军单体。
@@ -219,20 +259,22 @@ export type SkillOutput =
       /** 基础增伤（谋略 80 时），受谋略影响：实际 = 基础 + 成长率×(谋略-80)（八舍九入） */
       rate: number;
       growthRate: number;
       duration: number;
       /**
        * 增减伤方向：'caused'=目标造成伤害提高/降低（大赏三军、未笄难言）；
        * 'taken'=目标受到伤害提高/降低（神兵天降、名士在野）。缺省 'taken'。
        */
       direction?: 'caused' | 'taken';
       target?: 'self';
+      /** 只对这些兵种的当前目标池结算 */
+      troopTypes?: TroopType[];
     }
   /**
    * 按目标生效士气分支（盛气横凌）：
    * 生效士气 > threshold（缺省 100，即高昂）走 high，否则（一般/低落）走 low。
    */
   | {
       kind: 'morale_branch';
       /** 高昂阈值，缺省 100（>100 为高昂） */
       threshold?: number;
       high: SkillOutput[];
@@ -243,58 +285,61 @@ export type SkillOutput =
    * 每组是一组同时生效的输出（三维属性加成算一组）。
    */
   | {
       kind: 'random_pick';
       count: number;
       options: SkillOutput[][];
     };
 
 /** 状态施加模板 */
 export type CreateStatus =
-  | { type: 'confusion'; duration: number }
+  | { type: 'confusion'; duration: number | [number, number] }
   | { type: 'rampage'; duration: number; /** 待下次行动才生效（青丘媚祸），避免挂上即控、重复刷新永控 */ pendingNextAct?: boolean }
   | { type: 'cowardice'; duration: number }
   | { type: 'hesitation'; duration: number }
   | { type: 'evasion'; stacks: number }
   | { type: 'combo'; duration: number }
   /** amount 为谋略 80 时的基础值；strategyScaled=true 且给 growthRate 时，实际数值按 scaledValue 缩放。
    *  percent=true 时 amount 为百分比（如 15 = 15%），按目标当前生效属性（含点数增减后）结算 */
   | { type: 'attack_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
   | { type: 'defense_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
   | { type: 'strategy_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
   | { type: 'speed_buff'; amount: number; duration: number; strategyScaled?: boolean; growthRate?: number; percent?: boolean }
-  | { type: 'damage_reduce'; rate: number; duration: number; strategyScaled?: boolean; growthRate?: number; /** 按 8 份衰减（谋议宏图）：准备阶段 8/8，每回合开始 -1/8 */ decayEighths?: number }
+  | { type: 'damage_reduce'; rate: number; duration: number; strategyScaled?: boolean; /** 受攻击缩放（对称字段）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; /** 按 8 份衰减（谋议宏图）：准备阶段 8/8，每回合开始 -1/8 */ decayEighths?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
   /** direction：'caused'=自身造成伤害提高/降低（血溅黄砂、强势）；'taken'=自身受到伤害提高/降低（神兵天降、名士在野）。缺省 'taken'。
    *  stacks：叠层计数（带上限的增减伤，银龙冲阵），同战法累加时 +1
    *  strategyScaled=true 且给 growthRate 时（密谋定蜀每次发动 +5% 受谋略）：rate 为谋略 80 时的基础值，实际数值按 scaledValue 缩放
    *  defenseScaled=true（当敌制决 +8%）：公式同受谋略，属性换生效防御
    *  speedScaled=true（攻其不备 +11.6%）：受速度缩放；growthRate === undefined 时不缩放、用基值
-   *  charges：次数型「下一次攻击」，有值时按攻击输出次数消耗，不按回合递减（青丘媚祸 charges:1）
+   *  charges：次数型。direction:'caused' 时按攻击者打出消耗（青丘媚祸）；
+   *  direction:'taken' 时按受击方吃到匹配伤害后消耗（文伐下一次受到策略），不按回合递减
+   *  attackScaled=true（万箭 −50% / 恃强 −30%）：受攻击缩放；growthRate === undefined 时不缩放、用基值
+   *  decayFifths：按 N 份衰减（恃强 5）：挂上时满额，每次受到匹配伤害且实际扣兵 > 0 则 −1 份，rate = baseRate × fifths/N
    *  chargesStack：同战法重复施加时累加 rate（七步释嫌）；缺省不叠加（青丘媚祸） */
-  | { type: 'damage_boost'; rate: number; duration: number; direction?: 'caused' | 'taken'; stacks?: number; strategyScaled?: boolean; /** 受防御缩放（当敌制决 +8%，公式同受谋略，属性换生效防御） */ defenseScaled?: boolean; /** 受速度缩放（攻其不备 +11.6%）；growthRate === undefined 时不缩放、用基值 */ speedScaled?: boolean; growthRate?: number; charges?: number; chargesStack?: boolean }
+  | { type: 'damage_boost'; rate: number; duration: number; direction?: 'caused' | 'taken'; stacks?: number; /** 同战法同过滤维叠层达到此上限后不再加 rate；文德椒房 3 */ maxStacks?: number; strategyScaled?: boolean; /** 受防御缩放（当敌制决 +8%，公式同受谋略，属性换生效防御） */ defenseScaled?: boolean; /** 受速度缩放（攻其不备 +11.6%）；growthRate === undefined 时不缩放、用基值 */ speedScaled?: boolean; /** 受攻击缩放（万箭齐发 −50%、恃强淬锋 −30% / +3.4%）；growthRate === undefined 时不缩放、用基值 */ attackScaled?: boolean; growthRate?: number; charges?: number; chargesStack?: boolean; /** 按 N 份衰减（恃强淬锋 5）：挂上满额，每次匹配受击实际扣兵后 −1 份 */ decayFifths?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
   /**
    * 发动率提升。rate 为小数（1.2 = +120% / ×2.2）。
    * skillTypes：只对这些战法类型生效（动如雷震仅追击）；缺省主动+追击都吃（难知如阴）。
    * additive：true 时为基础率 + rate（动如雷震 +100 个百分点），超过 100% 由发动率判定封顶；
    * 缺省为乘算 基础率 × (1+rate)（难知如阴）。
    */
   | { type: 'trigger_boost'; rate: number; duration: number; skillTypes?: SkillType[]; additive?: boolean }
   | { type: 'insight'; duration: number }
   | { type: 'siege'; duration: number }
   | { type: 'sorcery'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
   | { type: 'burning'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
   | { type: 'panic'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
   /** 妖术诅咒（密谋定蜀）：携带者试图发动追击战法时触发一次妖术伤害（rate% 受谋略），持续 2 回合 */
   | { type: 'curse'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
   /** 引燃标记（火势风威）：携带者受到下一次伤害时额外引发一次燃烧（rate% 受谋略），触发后移除 */
   | { type: 'ignite'; duration: number; rate: number; growthRate: number; sourceStrategy?: number }
-  | { type: 'split'; duration: number; rate: number }
+  | { type: 'split'; duration: number; rate: number; /** 次数型分兵（鱼鳞）：有值时按攻击输出次数消耗，不按回合递减 */ charges?: number; /** 受谋略缩放（鱼鳞） */ strategyScaled?: boolean }
   | { type: 'jump_prep'; duration: number; rate: number }
   | { type: 'taunt'; duration: number; targetId: string }
   /** 反击资格（反击之策）：携带者被普攻实际扣兵后，对来源打 rate% 物理。不消耗。rate 与 physical_damage 同口径（100=100%） */
   | { type: 'counter'; duration: number; rate: number }
   | { type: 'cover'; duration: number }
   /** 持续型急救（皇裔流离/金匮要略）：受击时按几率触发恢复。
    *  healRate 为谋略 80 时的恢复率（受谋略缩放）；触发率与总生效次数走战法级计数器（grant_first_aid）；
    *  duration 缺省整场战斗（皇裔流离），金匮要略 duration 3（前 3 回合）；
    *  healTroops 为施法者「挂上时」兵力——恢复值 = floor(round(300×兵/(3500+兵)) × 恢复率/100 × (1+恢复提高))，
    *  状态类恢复的变量取自状态被施加那一刻（十面埋伏《率土秘卷一：恢复效果》） */
@@ -312,42 +357,52 @@ export type CreateStatus =
   | { type: 'ignore_def'; rate: number; duration: number };
 
 // ─── 战法（联合类型）───
 
 interface BaseSkill {
   id: string;
   name: string;
   type: SkillType;
   /** 战法有效距离 */
   range: number;
-  /** 发动率 0~1（指挥/被动为 1） */
-  triggerRate: number;
+  /** 发动率 0~1（指挥/被动为 1）；`[0.5, 1]` = 每次判定均匀随机 50%–100%（烽火覆周） */
+  triggerRate: number | [number, number];
   /** 效果标签：冲突判定用（含伤害时永不与其他效果冲突） */
   tags: EffectTag[];
   /** group 模式目标数（仅 targetMode:'group' 有效，缺省 2）；`[2,3]` = 50% 概率 2 目标 / 50% 概率 3 目标（辕门射戟） */
   groupCount?: number | [number, number];
+  /**
+   * 开场上阵单位的 troopType 集合必须 ⊆ 此列表，否则本战法整次不生效（疏数弓+骑）。
+   * 读部署名单（不论 alive）；战斗中不再复查。
+   */
+  teamTroopFilter?: TroopType[];
 }
 
 /** 普通主动战法 */
 export interface SimpleActiveSkill extends BaseSkill {
   type: 'active';
   prepare: false;
   targetMode: TargetMode;
   /** 目标池覆盖：'enemy'=敌军（对敌施放减益类状态如闭月防御下降）、'ally'=友军。缺省按效果启发式推断 */
   targetSide?: 'enemy' | 'ally';
   output: SkillOutput[];
 }
 
-/** 1 回合准备主动战法 */
+/** 准备主动战法 */
 export interface PreparedActiveSkill extends BaseSkill {
   type: 'active';
   prepare: true;
+  /**
+   * 准备回合数。缺省 1（现有 1 回合准备战法零改动）。
+   * 进入准备时 `prepareLeft = prepareTurns ?? 1`；下一行动 `prepareLeft > 1` 则再减 1 并继续准备。
+   */
+  prepareTurns?: number;
   targetMode: 'all' | 'group' | 'single';
   /** 目标池覆盖：'enemy'=敌军、'ally'=友军。缺省按效果启发式推断 */
   targetSide?: 'enemy' | 'ally';
   output: SkillOutput[];
 }
 
 /** 追击战法（普攻命中后触发） */
 export interface PursuitSkill extends BaseSkill {
   type: 'pursuit';
   output: SkillOutput[];
@@ -358,23 +413,24 @@ export interface CommandSkill extends BaseSkill {
   type: 'command';
   triggerRate: 1;
   targetMode: TargetMode;
   /** 指挥战法释放阶段：prep=一类（准备阶段释放一次，按准备时兵力/属性结算）；round=二类（正式回合武将行动时判定，看实时数据） */
   phase: 'prep' | 'round';
   /**
    * 二类指挥（phase='round'）的判定时机：
    * - on_act：武将行动时判定（奇兵拒北「每回合行动时」）
    * - before_active：每次试图发动主动战法前判定（运筹决胜）；准备完成释放 / 混乱 / 犹豫不触发
    * - ally_act：我军全体发动普攻 / 试图发动主动或追击时发动（七步释嫌）；施法者阵亡不触发
+   * - after_first_active：本回合首次主动战法实际释放成功后判定（文德椒房）；进入准备不算，准备完成释放算；每次按战法距离 / groupCount 重选目标
    * 一类指挥无需此字段（准备阶段已释放一次）。
    */
-  roundTrigger?: 'on_act' | 'before_active' | 'ally_act';
+  roundTrigger?: 'on_act' | 'before_active' | 'ally_act' | 'after_first_active';
   /**
    * 二类指挥·友军行动累计（七步释嫌）：每次 ally_act 发动后 +1，每达到 count 次再执行 output。
    * 恢复类 output 按施法者当前兵力实时结算（二类指挥）。
    */
   allyActEvery?: {
     count: number;
     output: SkillOutput[];
   };
   /**
    * 战斗开始一次性效果：类型标为二类指挥（入库类型），但实际在准备阶段只释放一次，不参与每回合 on_act 判定。
@@ -462,20 +518,22 @@ export interface CommandSkill extends BaseSkill {
   };
   /**
    * 一类指挥·回合前再结算（谋议宏图士气叠层）：
    * 每回合 `round_start` 之后、单位行动之前，对锁定目标再执行 output（同战法累加）。
    * 与 roundRepeat（目标行动时概率判定）不同：无发动率、必定执行。
    */
   roundStartRepeat?: {
     output: SkillOutput[];
     startRound?: number;
     endRound?: number;
+    /** 仅奇数回合执行（鱼鳞） */
+    oddRounds?: boolean;
   };
   /**
    * 受击触发（盲侯奋勇/陷储立齐/缓师徐持）：准备阶段只登记，不立刻结算 output。
    * 目标受到伤害后由 applyDamage 判定。
    */
   onHurt?: OnHurtConfig | OnHurtConfig[];
   onHeal?: OnHealConfig;
   output: SkillOutput[];
 }
 
@@ -573,20 +631,44 @@ export interface PassiveSkill extends BaseSkill {
   startRound?: number;
   endRound?: number;
   /** 受击触发（同仇敌忾 / 舍身卫主）：战斗开始只登记，不立刻结算 output */
   onHurt?: OnHurtConfig | OnHurtConfig[];
   onHeal?: OnHealConfig;
   /**
    * 承担友军攻击伤害（舍身卫主）：前 rounds 回合、自身处于 positions 时，
    * 友军受到的物理伤害在结算前将目标改为自己（伤害计算/规避/受击均视自己为受击者）。
    */
   redirectAllyPhysical?: { rounds: number; positions: Position[] };
+  /**
+   * 每回合行动阶段、在主动/普攻之前执行（火兽冲锋 50% 刀）。
+   * `timing:'battle_start'` 的开战 `output` 仍只在准备阶段走一次；本字段不在 battle_start 触发。
+   */
+  roundStartRepeat?: {
+    output: SkillOutput[];
+    startRound?: number;
+    endRound?: number;
+    oddRounds?: boolean;
+  };
+  /**
+   * 自身造成物理伤害叠层（恃强淬锋 +3.4%/层）。
+   * onRoundStart：tickRoundStartStatuses 给持有者 +1 层（不要走 roundStartRepeat，那是行动阶段）。
+   * onDealPhysical：持有者造成普攻/战法物理/分兵/反击且实际扣兵后 +1 层。
+   * 层数走 damage_boost stacks + sameSource 累加，到 maxStacks 停止。
+   */
+  selfPhysBoost?: {
+    perStack: number;
+    maxStacks: number;
+    duration: number;
+    attackScaled?: boolean;
+    onRoundStart?: boolean;
+    onDealPhysical?: boolean;
+  };
   output: SkillOutput[];
 }
 
 /** 战法（v0.3：含普通主动/准备主动/追击/指挥/被动） */
 export type Skill = SimpleActiveSkill | PreparedActiveSkill | PursuitSkill | CommandSkill | PassiveSkill;
 
 /** 四维部队加成（点数，已按面板换算，不写进 General 面板字段） */
 export interface FormationBonus {
   attack: number;
   defense: number;
@@ -760,41 +842,41 @@ export type Status =
   | { type: 'confusion'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'rampage'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; pendingNextAct?: boolean }
   | { type: 'cowardice'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'hesitation'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'evasion'; stacks: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'combo'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'attack_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
   | { type: 'defense_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
   | { type: 'strategy_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
   | { type: 'speed_buff'; amount: number; percent?: boolean; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
-  | { type: 'damage_reduce'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 当前剩余份数（谋议宏图 8→7→…）；无此字段则不按 1/8 衰减 */ eighths?: number; /** 8/8 时的满额减伤率，衰减时 rate = baseRate × eighths/8 */ baseRate?: number }
-  | { type: 'damage_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; direction: 'caused' | 'taken'; sourceUnitId?: string; /** 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）；无上限时不设置 */ stacks?: number; /** 次数型下一次攻击（青丘媚祸） */ charges?: number }
+  | { type: 'damage_reduce'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; /** 当前剩余份数（谋议宏图 8→7→…）；无此字段则不按 1/8 衰减 */ eighths?: number; /** 8/8 时的满额减伤率，衰减时 rate = baseRate × eighths/8 */ baseRate?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
+  | { type: 'damage_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; direction: 'caused' | 'taken'; sourceUnitId?: string; /** 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）；无上限时不设置 */ stacks?: number; /** 次数型下一次攻击（青丘媚祸） */ charges?: number; /** 当前剩余份数（恃强淬锋 5→4→…）；无此字段则不按 1/5 衰减 */ fifths?: number; /** fifths 满额时的 rate，衰减时 rate = baseRate × fifths / 初始份数 */ baseRate?: number; /** decayFifths 挂上时的满额份数（恃强 5），衰减公式分母 */ fifthsBase?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
   | { type: 'trigger_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; skillTypes?: SkillType[]; additive?: boolean }
   | { type: 'insight'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'siege'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'sorcery'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
   | { type: 'burning'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
   | { type: 'panic'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
   /**
    * 妖术诅咒（密谋定蜀）：携带者「试图发动追击战法」时（进入追击判定，无论发动率结果），
    * 立即受到一次妖术诅咒伤害（rate% 受谋略，挂上时冻结 stored 滞后触发，同 DoT），
    * 每次判定追击都触发、不消耗；持续 remaining 回合（密谋定蜀 2 回合）。
    */
   | { type: 'curse'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
   /**
    * 引燃标记（火势风威）：携带者「受到下一次伤害」时，额外引发一次燃烧伤害
    * （rate% 受谋略，挂上时冻结 stored 滞后触发，同 DoT），随后标记移除（一次性）。
    * 未触发时持续到战斗结束（remaining 缺省 999）。
    */
   | { type: 'ignite'; remaining: number; rate: number; sourceStrategy: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string; stored?: DotStoredDamage }
-  | { type: 'split'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
+  | { type: 'split'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; /** 次数型分兵（鱼鳞）：有值时按攻击输出次数消耗，不按回合递减 */ charges?: number; /** 受谋略缩放（鱼鳞） */ strategyScaled?: boolean }
   | { type: 'jump_prep'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'taunt'; remaining: number; targetId: string; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   | { type: 'counter'; remaining: number; rate: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; sourceUnitId?: string }
   | { type: 'cover'; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string }
   /**
    * 持续型急救（皇裔流离/金匮要略）：受击时按几率触发恢复。
    *  - remaining：持续回合计数——缺省 Infinity（整场战斗常驻，皇裔流离）；金匮要略 remaining=3（前 3 回合，回合末递减移除）
    *  - 触发率与计数按「战法级」共享：ctx.firstAidCounters（全队总生效次数每达到 triggerUpEvery 次 +triggerUpIncrement）
    *  - 恢复率 = roundRate(scaledValue(healRate, healGrowthRate, 施法者生效谋略))（挂上时冻结）
    *  - 恢复值 = floor(round(300×施法者挂上时兵力/(3500+兵力)) × 恢复率/100 × (1+恢复提高))（healTroops 挂上时冻结）
@@ -821,20 +903,24 @@ export interface UnitState {
   totalDead: number;
   alive: boolean;
   /** 身上状态（混乱/怯战/规避） */
   statuses: Status[];
   /** 是否处于准备阶段（1 回合准备战法） */
   isPreparing: boolean;
   /** 正在准备的战法 id */
   preparingSkillId: string | null;
   /** 本回合是否已行动完毕（缓师徐持「已行动的敌军」）。回合开始清 false，unit_act_end 置 true */
   hasActedThisRound?: boolean;
+  /** 剩余准备行动次数。缺省 null / 未设 = 非准备。进入准备时 = prepareTurns??1 */
+  prepareLeft?: number | null;
+  /** 本回合是否已有一次主动战法实际释放成功。回合开始清 false */
+  firstActiveSucceededThisRound?: boolean;
   /**
    * 部队加成合计点数（阵营/称号/兵种，准备阶段阵容步写入）。
    * 缺省视为四维 0；不走状态冲突。
    */
   formationBonus?: FormationBonus;
 }
 
 // ─── 战报事件类型 ───
 
 export type BattleEvent =
diff --git a/tests/prepared_timing.test.ts b/tests/prepared_timing.test.ts
index c087130..95ec5ab 100644
--- a/tests/prepared_timing.test.ts
+++ b/tests/prepared_timing.test.ts
@@ -1,14 +1,15 @@
 /**
- * 准备战法时序测试（v0.10）：判定成功本回合进入准备，下回合主动战法阶段释放；
- * 释放后本回合不再进行释放判定 → 极端情况 8 回合最多释放 4 次
- * （第 1/3/5/7 回合判定成功准备 → 第 2/4/6/8 回合释放）。
+ * 准备战法时序测试（v0.10）：判定成功本回合进入准备，`prepareTurns` 回合后主动战法阶段释放；
+ * 释放后本回合不再进行释放判定 → 8 回合最多释放 `Math.floor(8 / (prepareTurns + 1))` 次
+ * （1 回合准备：第 1/3/5/7 回合判定成功准备 → 第 2/4/6/8 回合释放，最多 4 次；
+ *  2 回合准备：最多 2 次）。
  * 使用蜀·关羽主战法「樊渊泅囚」（1 回合准备），固定种子断言时序不变量。
  */
 import { describe, it, expect, beforeAll } from 'vitest';
 import { runBattle } from '../src/engine/combat';
 import type { BattleEvent, General, Position } from '../src/engine/types';
 import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
 import { SKILL_REGISTRY } from '../src/data/skills';
 
 beforeAll(async () => {
   await initHeroDB();
@@ -40,22 +41,25 @@ function dummy(id: string, position: Position): General {
     activeSkillIds: [],
     passiveSkillIds: [],
     commandSkillIds: [],
     pursuitSkillIds: [],
     morale: 100,
   };
 }
 
 const SKILL = '樊渊泅囚';
 
-/** 断言一场 8 回合战斗的准备战法时序不变量（对任意成败组合恒成立） */
-function assertPreparedTiming(skillName: string, seed: number, carrier: General): void {
+/**
+ * 断言一场 8 回合战斗的准备战法时序不变量（对任意成败组合恒成立）。
+ * @param prepareTurns 准备回合数，缺省 1（与 PreparedActiveSkill.prepareTurns ?? 1 一致）
+ */
+function assertPreparedTiming(skillName: string, seed: number, carrier: General, prepareTurns = 1): void {
   const enemy: General[] = ['e1', 'e2', 'e3'].map((id, i) =>
     dummy(id, (['前锋', '中军', '大营'] as Position[])[i])
   );
   const report = runBattle({ myTeam: [carrier], enemyTeam: enemy, seed, maxRounds: 8 });
 
   // 按回合归类事件
   let round = 0;
   const byRound = new Map<number, BattleEvent[]>();
   for (const ev of report.events) {
     if (ev.type === 'round_start') { round = (ev as { round: number }).round; continue; }
@@ -66,54 +70,56 @@ function assertPreparedTiming(skillName: string, seed: number, carrier: General)
   const has = (r: number, type: string) =>
     evs(r).some((e) => e.type === type && 'skillName' in e && e.skillName === skillName);
 
   const casts: number[] = [];
   const preps: number[] = [];
   for (let r = 1; r <= 8; r++) {
     if (has(r, 'skill_cast')) casts.push(r);
     if (has(r, 'prepare_start')) preps.push(r);
   }
 
-  // 释放次数 ≤ 4（8 回合上限：1/3/5/7 准备 → 2/4/6/8 释放）
-  expect(casts.length).toBeLessThanOrEqual(4);
-  // 每个释放回合 r：上一回合已准备，本回合不再进入准备、不做发动率判定
-  for (const r of casts) {
-    expect(preps.includes(r - 1), `[${skillName}] 释放回合 ${r} 前应已准备`).toBe(true);
-    expect(preps.includes(r), `[${skillName}] 释放回合 ${r} 不应再次进入准备`).toBe(false);
-    expect(has(r, 'skill_trigger'), `[${skillName}] 释放回合 ${r} 不应做发动率判定`).toBe(false);
+  const maxCasts = Math.floor(8 / (prepareTurns + 1));
+  expect(casts.length).toBeLessThanOrEqual(maxCasts);
+  // 每个释放回合 c：c - prepareTurns 已准备，本回合不再进入准备、不做发动率判定
+  for (const c of casts) {
+    expect(preps.includes(c - prepareTurns), `[${skillName}] 释放回合 ${c} 前 ${prepareTurns} 回合应已准备`).toBe(true);
+    expect(preps.includes(c), `[${skillName}] 释放回合 ${c} 不应再次进入准备`).toBe(false);
+    expect(has(c, 'skill_trigger'), `[${skillName}] 释放回合 ${c} 不应做发动率判定`).toBe(false);
   }
-  // 每个准备回合 r（r<8）：下一回合必定释放
+  // 每个准备回合 r：若 r + prepareTurns 仍在 8 回合内，该回合必定释放
   for (const r of preps) {
-    if (r < 8) expect(casts.includes(r + 1), `[${skillName}] 准备回合 ${r} 后一回合应释放`).toBe(true);
+    if (r + prepareTurns <= 8) {
+      expect(casts.includes(r + prepareTurns), `[${skillName}] 准备回合 ${r} 后第 ${prepareTurns} 回合应释放`).toBe(true);
+    }
   }
 }
 
 /** 全部已实现准备战法（SKILL_REGISTRY 中 type='active' && prepare=true） */
 const PREPARED_SKILLS = Object.values(SKILL_REGISTRY)
   .filter((s) => s.type === 'active' && s.prepare)
-  .map((s) => ({ id: s.id, name: s.name }));
+  .map((s) => ({ id: s.id, name: s.name, prepareTurns: s.prepareTurns ?? 1 }));
 
 describe('准备战法时序（蜀·关羽 樊渊泅囚）', () => {
   it('主战法为 1 回合准备主动战法', () => {
     const g = hero('h451');
     expect(g.name).toBe('关羽');
     expect(g.activeSkillIds).toContain('fanyuan_qiou');
   });
 
   it('8 回合最多释放 4 次：判定成功回合进入准备，下一回合释放，释放回合不再判定', () => {
     const guanyu = withSkills(level40(hero('h451'), { attack: 40 }), { activeSkillIds: ['fanyuan_qiou'] });
     guanyu.position = '前锋';
     assertPreparedTiming(SKILL, 20260101, guanyu);
   });
 });
 
 describe('全部准备战法统一时序（' + '27 个，引擎管线全局生效）', () => {
-  for (const { id, name } of PREPARED_SKILLS) {
-    it(`${name}（${id}）：8 回合最多释放 4 次，释放回合不判定、下一回合自动释放`, () => {
+  for (const { id, name, prepareTurns } of PREPARED_SKILLS) {
+    it(`${name}（${id}）：8 回合最多释放 ${Math.floor(8 / (prepareTurns + 1))} 次，释放回合不判定、准备结束后自动释放`, () => {
       const carrier = withSkills(level40(hero('h451'), { attack: 40 }), { activeSkillIds: [id] });
       carrier.position = '前锋';
       for (const seed of [777, 20260101, 42]) {
-        assertPreparedTiming(name, seed, carrier);
+        assertPreparedTiming(name, seed, carrier, prepareTurns);
       }
     });
   }
 });

```
