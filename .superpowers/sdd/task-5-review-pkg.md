# Task 5 six skills
**Base:** e16ca80 (working tree; no commit)
**Head:** working tree

## Commits
(none)

## Diff stat

 scripts/build_heroes_seed.mjs |  19 ++
 src/data/listing.ts           |   3 +
 src/data/skills.ts            | 580 ++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 602 insertions(+)


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
import { initHeroDB, HERO_REGISTRY, withSkills } from '../src/data/heroes';
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

```
