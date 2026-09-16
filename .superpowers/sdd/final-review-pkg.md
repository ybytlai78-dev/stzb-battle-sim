# Phase 2 whole-branch review package
**Base:** e16ca80 (working tree; no commit)
**Head:** working tree

## Commits
(none)

## Diff stat

 ...234\272\345\210\266\346\270\205\347\202\271.md" |  13 +-
 scripts/build_heroes_seed.mjs                      |   9 +
 src/data/skills.ts                                 | 299 ++++++++++++++++++++
 src/engine/action.ts                               | 309 ++++++++++++++++++---
 src/engine/types.ts                                |  33 ++-
 5 files changed, 609 insertions(+), 54 deletions(-)


## Untracked files

### tests/troop_filter.test.ts

```
/**
 * 阵容门闩 teamTroopFilter + 输出 troopTypes 目标兵种过滤。
 * 测试战法只挂进 ctx.skills，不改 SKILL_REGISTRY。
 */
import { describe, it, expect } from 'vitest';
import { teamPassesTroopFilter, triggerCommandSkills, statusMatchesHit, inflictStatus, actUnit, tickRoundStartStatuses, type CombatContext } from '../src/engine/action';
import type { General, Position, Skill, SkillOutput, SkillType, UnitState } from '../src/engine/types';
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

  it('basic 不匹配 skill 物理', () => {
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
});

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

```

### tests/universal_b_plus_p2.test.ts

```
/**
 * 拆解通用 B 级以上 · 第二阶段兵种阵型：
 * 方圆 / 疏数 / 衡轭 / 锋矢 / 鱼鳞 / 鹤翼 / 白刃 / 全军突击 / 飒沓如星。
 * 每战法 3 个测试：装配挂槽与字段、机制事件/状态、窗口或兵种。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CommandSkill,
  General,
  Position,
  Skill,
  SkillOutput,
  TroopType,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  triggerActiveSkill,
  triggerCommandSkills,
  tickRoundStartStatuses,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';

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
  const front = dummy('enemy-front', '前锋');
  front.speed = 200;
  front.attack = 180;
  return [front, dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '中军', 10000);
  carrier.attack = 120;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

/**
 * 一类指挥挂在前锋：受击钩子需要载体被打到。
 */
function commandFront(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 120;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

/**
 * 主动战法挂前锋；morale 140 便于发动（装配测仍不依赖发动成功）。
 */
function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.activeSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

/** 给整队设兵种（骑兵/弓兵木桩）。 */
function withTroop(team: General[], troopType: TroopType): General[] {
  for (const g of team) g.troopType = troopType;
  return team;
}

/** 按站位设三种兵种（前锋/中军/大营）。 */
function withTroops(team: General[], types: [TroopType, TroopType, TroopType]): General[] {
  team[0].troopType = types[0];
  team[1].troopType = types[1];
  team[2].troopType = types[2];
  return team;
}

function asCommand(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

function inflictStatusOf(out: SkillOutput | undefined) {
  if (!out || out.kind !== 'inflict_status' || Array.isArray(out.status)) return undefined;
  return out.status;
}

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

/** 按 round_start 给事件打回合号（准备阶段为 0）。 */
function withRound(events: BattleEvent[]): Array<{ round: number; ev: BattleEvent }> {
  let round = 0;
  return events.map((ev) => {
    if (ev.type === 'round_start') round = ev.round;
    return { round, ev };
  });
}

function unitFrom(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

function makeCtx(my: General[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemyTeam().map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

/** 准备阶段释放一类指挥，返回 ctx（可查 statuses）。 */
function prepCommand(skillId: string, team: General[], seed = 1): CombatContext {
  const ctx = makeCtx(team, seed);
  const caster = ctx.myTeam.find((u) => u.general.commandSkillIds.includes(skillId));
  if (!caster) throw new Error(`无载体 ${skillId}`);
  triggerCommandSkills(ctx, caster);
  return ctx;
}

/** 多 seed 尝试发动主动，成功则返回 ctx。 */
function fireActive(skillId: string, team: General[], maxSeed = 80): CombatContext | undefined {
  const skill = SKILL_REGISTRY[skillId];
  for (let seed = 1; seed <= maxSeed; seed++) {
    const ctx = makeCtx(team, seed);
    ctx.currentRound = 1;
    const caster = ctx.myTeam.find((u) => u.general.activeSkillIds.includes(skillId));
    if (!caster) throw new Error(`无载体 ${skillId}`);
    triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    if (ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === skillId)) return ctx;
  }
  return undefined;
}

describe('方圆（B 一类指挥：步兵普攻 −20%，主动/追击 +16.8%）', () => {
  it('装配：range 3 groupCount 3，两条 inflict troopTypes infantry', () => {
    expect(commandTeam('fangyuan')[1].commandSkillIds).toContain('fangyuan');
    const s = asCommand('fangyuan');
    expect(s.range).toBe(3);
    expect(s.groupCount).toBe(3);
    expect(s.output).toHaveLength(2);
    expect(s.output.every((o) => o.kind === 'inflict_status' && o.troopTypes?.[0] === 'infantry')).toBe(true);
  });

  it('机制：三步兵队伍 run 后步兵有 damageSource basic 的 caused −0.2', () => {
    const team = commandTeam('fangyuan');
    const ctx = prepCommand('fangyuan', team);
    for (const u of ctx.myTeam) {
      const basic = u.statuses.find(
        (st) => st.type === 'damage_boost' && 'damageSource' in st && st.damageSource === 'basic'
      );
      expect(basic).toBeTruthy();
      if (basic?.type === 'damage_boost') {
        expect(basic.rate).toBe(-0.2);
        expect(basic.direction).toBe('caused');
      }
    }
    const report = run(team);
    expect(inflicted(report, 'damage_boost').some((e) => e.detail.includes('降低 20%'))).toBe(true);
  });

  it('窗口：步兵主动/追击分流，skillTypes 含 pursuit', () => {
    const ctx = prepCommand('fangyuan', commandTeam('fangyuan'));
    const skillBoost = ctx.myTeam[0].statuses.find(
      (st) => st.type === 'damage_boost' && 'damageSource' in st && st.damageSource === 'skill'
    );
    expect(skillBoost).toBeTruthy();
    if (skillBoost?.type === 'damage_boost') {
      expect(skillBoost.skillTypes).toEqual(['active', 'pursuit']);
      expect(skillBoost.skillTypes).toContain('pursuit');
      expect(skillBoost.rate).toBe(0.168);
    }
  });
});

describe('疏数（B 一类指挥：仅弓+骑；弓兵防御 +50）', () => {
  it('装配：teamTroopFilter 弓+骑', () => {
    expect(commandTeam('shushu')[1].commandSkillIds).toContain('shushu');
    const s = asCommand('shushu');
    expect(s.teamTroopFilter).toEqual(['archer', 'cavalry']);
  });

  it('机制：弓+骑+步 run 无 skill_cast 疏数', () => {
    const team = withTroops(commandTeam('shushu'), ['archer', 'cavalry', 'infantry']);
    const report = run(team);
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillName === '疏数')).toBe(false);
  });

  it('窗口：弓+骑队伍弓兵 defense_buff 50', () => {
    const team = withTroops(commandTeam('shushu'), ['archer', 'cavalry', 'archer']);
    const ctx = prepCommand('shushu', team);
    const archers = ctx.myTeam.filter((u) => u.general.troopType === 'archer');
    const cavs = ctx.myTeam.filter((u) => u.general.troopType === 'cavalry');
    expect(archers.every((u) => u.statuses.some((st) => st.type === 'defense_buff' && st.amount === 50))).toBe(true);
    expect(cavs.every((u) => u.statuses.every((st) => st.type !== 'defense_buff'))).toBe(true);
  });
});

describe('衡轭（B 一类指挥：仅骑+步；骑兵谋略 +50，步兵普攻 +50%）', () => {
  it('装配：teamTroopFilter 骑+步', () => {
    expect(commandTeam('henge')[1].commandSkillIds).toContain('henge');
    expect(asCommand('henge').teamTroopFilter).toEqual(['cavalry', 'infantry']);
  });

  it('机制：骑兵 strategy_buff 50', () => {
    const team = withTroops(commandTeam('henge'), ['cavalry', 'cavalry', 'infantry']);
    const ctx = prepCommand('henge', team);
    const cavs = ctx.myTeam.filter((u) => u.general.troopType === 'cavalry');
    expect(cavs.every((u) => u.statuses.some((st) => st.type === 'strategy_buff' && st.amount === 50))).toBe(true);
  });

  it('窗口：步兵 caused basic +0.5', () => {
    const team = withTroops(commandTeam('henge'), ['cavalry', 'infantry', 'infantry']);
    const ctx = prepCommand('henge', team);
    const inf = ctx.myTeam.filter((u) => u.general.troopType === 'infantry');
    for (const u of inf) {
      const boost = u.statuses.find((st) => st.type === 'damage_boost');
      expect(boost).toBeTruthy();
      if (boost?.type === 'damage_boost') {
        expect(boost.rate).toBe(0.5);
        expect(boost.direction).toBe('caused');
        expect(boost.damageSource).toBe('basic');
      }
    }
  });
});

describe('锋矢（B 一类指挥：骑兵普攻 −25%，仅主动 +18%）', () => {
  it('装配：骑兵 basic −0.25', () => {
    const team = withTroop(commandTeam('fengshi'), 'cavalry');
    expect(team[1].commandSkillIds).toContain('fengshi');
    const st = inflictStatusOf(asCommand('fengshi').output[0]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(-0.25);
      expect(st.damageSource).toBe('basic');
      expect(st.direction).toBe('caused');
    }
    const out0 = asCommand('fengshi').output[0];
    expect(out0.kind).toBe('inflict_status');
    if (out0.kind === 'inflict_status') expect(out0.troopTypes).toEqual(['cavalry']);
    const ctx = prepCommand('fengshi', team);
    for (const u of ctx.myTeam) {
      const basic = u.statuses.find(
        (s) => s.type === 'damage_boost' && 'damageSource' in s && s.damageSource === 'basic'
      );
      expect(basic).toBeTruthy();
      if (basic?.type === 'damage_boost') expect(basic.rate).toBe(-0.25);
    }
  });

  it('机制：第二条 skillTypes 仅 active', () => {
    const st = inflictStatusOf(asCommand('fengshi').output[1]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.skillTypes).toEqual(['active']);
      expect(st.damageSource).toBe('skill');
      expect(st.rate).toBe(0.18);
    }
  });

  it('窗口：步兵队伍挂锋矢，步兵无这些 boost', () => {
    const ctx = prepCommand('fengshi', commandTeam('fengshi'));
    expect(ctx.myTeam.every((u) => u.general.troopType === 'infantry')).toBe(true);
    expect(ctx.myTeam.every((u) => u.statuses.filter((st) => st.type === 'damage_boost').length === 0)).toBe(true);
  });
});

describe('鱼鳞（B 一类指挥：仅步+弓；步兵防御 +50，弓兵策略 taken −35%）', () => {
  it('装配：teamTroopFilter 步+弓', () => {
    expect(commandTeam('yulin')[1].commandSkillIds).toContain('yulin');
    expect(asCommand('yulin').teamTroopFilter).toEqual(['infantry', 'archer']);
  });

  it('机制：步兵防御 +50', () => {
    const team = withTroops(commandTeam('yulin'), ['infantry', 'infantry', 'archer']);
    const ctx = prepCommand('yulin', team);
    const inf = ctx.myTeam.filter((u) => u.general.troopType === 'infantry');
    expect(inf.every((u) => u.statuses.some((st) => st.type === 'defense_buff' && st.amount === 50))).toBe(true);
  });

  it('窗口：弓兵 taken −0.35 damageType strategy', () => {
    const team = withTroops(commandTeam('yulin'), ['infantry', 'archer', 'archer']);
    const ctx = prepCommand('yulin', team);
    const archers = ctx.myTeam.filter((u) => u.general.troopType === 'archer');
    for (const u of archers) {
      const boost = u.statuses.find((st) => st.type === 'damage_boost');
      expect(boost).toBeTruthy();
      if (boost?.type === 'damage_boost') {
        expect(boost.rate).toBe(-0.35);
        expect(boost.direction).toBe('taken');
        expect(boost.damageType).toBe('strategy');
      }
    }
  });
});

describe('鹤翼（B 一类指挥：奇数回合弓兵分兵 49% 持续 1 回合）', () => {
  it('装配：oddRounds true、output 空', () => {
    expect(commandFront('heyi')[0].commandSkillIds).toContain('heyi');
    const s = asCommand('heyi');
    expect(s.output).toEqual([]);
    expect(s.roundStartRepeat?.oddRounds).toBe(true);
  });

  it('机制：run maxRounds 2，第 1 回合弓兵有 split，第 2 回合 split 已尽', () => {
    const team = withTroop(commandTeam('heyi'), 'archer');
    const tagged = withRound(run(team, 1, 2).events);
    const r1split = tagged.some(
      ({ round, ev }) => round === 1 && ev.type === 'status_inflicted' && ev.statusType === 'split'
    );
    const r2split = tagged.some(
      ({ round, ev }) => round === 2 && ev.type === 'status_inflicted' && ev.statusType === 'split'
    );
    const r2splitDmg = tagged.some(({ round, ev }) => round === 2 && ev.type === 'split_damage');
    expect(r1split).toBe(true);
    expect(r2split).toBe(false);
    expect(r2splitDmg).toBe(false);
  });

  it('窗口：骑兵挂鹤翼无 split', () => {
    const team = withTroop(commandTeam('heyi'), 'cavalry');
    const ctx = prepCommand('heyi', team);
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    expect(ctx.myTeam.every((u) => u.statuses.every((st) => st.type !== 'split'))).toBe(true);
    const report = run(team, 1, 2);
    expect(inflicted(report, 'split')).toHaveLength(0);
  });
});

describe('白刃（A 一类指挥：前 3 回合策略 −35%；骑/步防 +45；第 4 回合攻 +45）', () => {
  it('装配：两段 targetSide ally/enemy all 策略 −0.35 duration 3', () => {
    expect(commandTeam('bairen')[1].commandSkillIds).toContain('bairen');
    const s = asCommand('bairen');
    expect(s.output[0].kind).toBe('inflict_status');
    expect(s.output[1].kind).toBe('inflict_status');
    if (s.output[0].kind === 'inflict_status') {
      expect(s.output[0].targetSide).toBe('ally');
      expect(s.output[0].targetMode).toBe('all');
    }
    if (s.output[1].kind === 'inflict_status') {
      expect(s.output[1].targetSide).toBe('enemy');
      expect(s.output[1].targetMode).toBe('all');
    }
    const ally = inflictStatusOf(s.output[0]);
    const enemy = inflictStatusOf(s.output[1]);
    for (const st of [ally, enemy]) {
      expect(st?.type).toBe('damage_boost');
      if (st?.type === 'damage_boost') {
        expect(st.rate).toBe(-0.35);
        expect(st.duration).toBe(3);
        expect(st.direction).toBe('caused');
        expect(st.damageType).toBe('strategy');
      }
    }
  });

  it('机制：骑/步 defense 45', () => {
    const team = withTroops(commandTeam('bairen'), ['cavalry', 'infantry', 'infantry']);
    const ctx = prepCommand('bairen', team);
    expect(
      ctx.myTeam.every((u) => u.statuses.some((st) => st.type === 'defense_buff' && st.amount === 45))
    ).toBe(true);
  });

  it('窗口：run 到第 4 回合骑/步出现 attack_buff 45', () => {
    const team = withTroops(commandTeam('bairen'), ['cavalry', 'infantry', 'infantry']);
    const tagged = withRound(run(team, 1, 4).events);
    expect(tagged.some(({ ev }) => ev.type === 'round_start' && ev.round === 4)).toBe(true);
    const atk = tagged.filter(
      ({ round, ev }) => round === 4 && ev.type === 'status_inflicted' && ev.statusType === 'attack_buff'
    );
    expect(atk.length).toBeGreaterThan(0);
    expect(
      atk.every(
        (row) => row.ev.type === 'status_inflicted' && row.ev.detail.includes('45') && !row.ev.unitId.startsWith('enemy')
      )
    ).toBe(true);
  });
});

describe('全军突击（A 主动 35%：驱散骑/步 + 单体物理 145% + 下 2 次 +28%）', () => {
  it('装配：active 0.35 range 4 group 3 ally', () => {
    expect(activeTeam('quanjun_tuji')[0].activeSkillIds).toContain('quanjun_tuji');
    const s = asActive('quanjun_tuji');
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(4);
    expect(s.groupCount).toBe(3);
    expect(s.targetSide).toBe('ally');
    expect(s.prepare).toBe(false);
  });

  it('机制：output 三段 kind', () => {
    const s = asActive('quanjun_tuji');
    expect(s.output.map((o) => o.kind)).toEqual(['remove_debuffs', 'physical_damage', 'inflict_status']);
    expect(s.output[0].kind === 'remove_debuffs' && s.output[0].troopTypes).toEqual(['cavalry', 'infantry']);
    expect(s.output[1].kind === 'physical_damage' && s.output[1].rate).toBe(145);
  });

  it('窗口：骑兵 charges 2 caused 0.28', () => {
    const st = inflictStatusOf(asActive('quanjun_tuji').output[2]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.charges).toBe(2);
      expect(st.rate).toBe(0.28);
      expect(st.direction).toBe('caused');
    }
    const ctx = fireActive('quanjun_tuji', withTroop(activeTeam('quanjun_tuji'), 'cavalry'));
    expect(ctx).toBeDefined();
    const boosted = ctx!.myTeam.filter((u) =>
      u.statuses.some((s) => s.type === 'damage_boost' && 'charges' in s && s.charges === 2 && s.rate === 0.28)
    );
    expect(boosted.length).toBeGreaterThan(0);
  });
});

describe('飒沓如星（B 主动 40%：骑兵普攻 +36% 持续 2，下 2 次分兵 55%）', () => {
  it('装配：groupCount 2', () => {
    expect(activeTeam('sata_ruxing')[0].activeSkillIds).toContain('sata_ruxing');
    const s = asActive('sata_ruxing');
    expect(s.groupCount).toBe(2);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(2);
    expect(s.targetSide).toBe('ally');
  });

  it('机制：骑兵 basic +0.36 duration 2', () => {
    const st = inflictStatusOf(asActive('sata_ruxing').output[0]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.36);
      expect(st.duration).toBe(2);
      expect(st.damageSource).toBe('basic');
      expect(st.direction).toBe('caused');
    }
    const ctx = fireActive('sata_ruxing', withTroop(activeTeam('sata_ruxing'), 'cavalry'));
    expect(ctx).toBeDefined();
    const boosted = ctx!.myTeam.filter((u) =>
      u.statuses.some(
        (s) => s.type === 'damage_boost' && s.damageSource === 'basic' && s.rate === 0.36 && s.remaining === 2
      )
    );
    expect(boosted.length).toBeGreaterThan(0);
  });

  it('窗口：split charges 2 rate 55', () => {
    const st = inflictStatusOf(asActive('sata_ruxing').output[1]);
    expect(st?.type).toBe('split');
    if (st?.type === 'split') {
      expect(st.charges).toBe(2);
      expect(st.rate).toBe(55);
    }
    const ctx = fireActive('sata_ruxing', withTroop(activeTeam('sata_ruxing'), 'cavalry'));
    expect(ctx).toBeDefined();
    const splitters = ctx!.myTeam.filter((u) =>
      u.statuses.some((s) => s.type === 'split' && s.charges === 2 && s.rate === 55)
    );
    expect(splitters.length).toBeGreaterThan(0);
  });
});

```

## Full diff (tracked)

```diff
diff --git "a/docs/\345\276\205\350\241\245\345\205\205\346\234\272\345\210\266\346\270\205\347\202\271.md" "b/docs/\345\276\205\350\241\245\345\205\205\346\234\272\345\210\266\346\270\205\347\202\271.md"
index 95986b7..ad6656d 100644
--- "a/docs/\345\276\205\350\241\245\345\205\205\346\234\272\345\210\266\346\270\205\347\202\271.md"
+++ "b/docs/\345\276\205\350\241\245\345\205\205\346\234\272\345\210\266\346\270\205\347\202\271.md"
@@ -1,41 +1,39 @@
 # 待补充机制清点（Skipped 通用战法）
 
-本文件是 **199 个可学习通用战法中 skipped 战法**的机制清点（当前 **69** 个，含援军之策：机制已有、仅标 `pending_strategy_scale`）。每个战法因需要引擎缺失机制而暂缓录入（未实现不算遗漏，算**待机制**）。受谋略缩放未确认的，只打标签、本轮不录入。
+本文件是 **199 个可学习通用战法中 skipped 战法**的机制清点（当前 **60** 个，含援军之策：机制已有、仅标 `pending_strategy_scale`）。每个战法因需要引擎缺失机制而暂缓录入（未实现不算遗漏，算**待机制**）。受谋略缩放未确认的，只打标签、本轮不录入。
 
 **目的**：机制补全后，可依本文件立即可开始实现。建议顺序 = 受益战法最多的机制优先。
 
 **联动**：数据库 `skills` 表 `missing_mechanics` 列（自然语言描述）+ `mechanism_key` 列（稳定键）。机制实现后，用 `SELECT * FROM skills WHERE status='skipped' AND mechanism_key='<键>'` 立即捞出该机制下的全部战法。
 
 ---
 
 ## 一、机制分组清单（按受益战法数排序）
 
 | 缺失机制 | mechanism_key | 战法（type/quality） | 数量 |
 |---|---|---|---|
 | 受击触发（受击后概率触发效果） | on_attacked | 垒实迎击(passive/S)、百战无怯(passive/S)、疾风迅雷(command/B) | 3 |
 | 位置条件（中军/前锋才生效） | position_cond | 百战无怯(passive/S) | 1 |
 | 造成伤害后叠层 | on_deal_damage | 百战无怯(passive/S) | 1 |
-| 兵种限定（按兵种判断生效） | troop_type | 方圆(B)、疏数(B)、衡轭(B)、锋矢(B)、鱼鳞(B)、鹤翼(B)、白刃(A) | 7 |
 | 反击（受击后对攻击者发动攻击） | counter | 反击(active/D)、诱敌深入(command/A) | 2 |
 | 士气比较（目标士气 vs 自身士气） | morale_compare | 望风而降(A)、激水之疾(A)、蓄盈待竭(B)、胜负先征(A) | 4 |
 | 士气降低（降低目标士气值） | morale_reduce | 及锋而试(S) | 1 |
 | 移除敌军有益状态 | dispel_enemy | 看破(active/D)、索敌(active/D)、驱逐(pursuit/D)、火积(pursuit/B) | 4 |
 | 距离+1（攻击距离永久增加） | range_plus | 远攻秘策(B)、远攻之策(C)、远攻奇略(passive/C)、远攻强化(passive/C)、合纵连横(A) | 5 |
 | 兵力比例/兵力条件 | troop_ratio | 亡命一搏(B)、甚陷不惧(passive/A)、临危(C)、死士突击(C) | 4 |
 | 特定回合起每回合效果（第N回合起） | round_from | 援军之策(C 第5回合起heal；引擎 `startRound` 已有，仅缺受谋略成长 → `pending_strategy_scale`) | 1 |
 | 恢复次数递增 | heal_count_growth | 胜敌益强(passive/A) | 1 |
 | 下一次攻击/策略伤害增减 | next_damage | 文伐(pursuit/B，228% 受谋略 → `pending_strategy_scale`；「下一次受到策略攻击」charges 尚不区分物理/策略)、闪击(active/B，「大幅度降低」无数值不编造) | 2 |
 | 下次造成伤害后再结算 | next_act | 翕处还张(active/A)、道行险阻(active/A) | 2 |
 | 追击多段（独立目标/独立判定） | pursuit_multi | 乘胜追击(S) | 1 |
 | 特殊目标选择（距离/兵力/属性） | special_target | 近攻(最近)、远射(最远)、连环(最远)、兼弱攻昧(防御/谋略最低)、始计(兵力最多)、铁戟金戈(2或3目标) | 6 |
-| 兵种限定+下N次效果 | troop_next | 全军突击(下N次增伤)、飒沓如星(下2次分兵) | 2 |
 | 攻城属性 | siege_stat | 云梯(D)、投石轰击(D)、毁墙(D) | 3 |
 | 每回合概率双效果 | round_prob_multi | 鸟云山兵(command/A) | 1 |
 | 女武将组合（限定性别） | gender_cond | 美人计(command/B) | 1 |
 | 阵营组合+距离+1 | faction_range | 合纵连横(command/A) | 1 |
 | 群体先手 | group_priority | 长驱直入(command/C) | 1 |
 | 主动先手（主动战法获得优先行动） | active_priority | 抢攻(active/C) | 1 |
 | 70%概率先手（指挥） | priority_chance | 先驱(command/D) | 1 |
 | 发动主动战法伤害降低 | active_dmg_reduce | 反计之策(command/S) | 1 |
 | 发动主战法后叠加 | after_cast_stack | 乘间击隙(command/A)、久战熟谋(command/A) | 2 |
 | 造成/受到伤害后触发 | dmg_hook | 以直报怨(command/B) | 1 |
@@ -46,50 +44,51 @@
 | 每回合策略攻击（不攻） | per_round_strategy | 不攻(command/S) | 1 |
 | 试图发动前触发 | before_cast | 众谋不懈(command/S) | 1 |
 | 50%概率额外段 | extra_hit | 觑隙(active/C) | 1 |
 | 随机单体大幅降低无数值 | random_single | 万箭齐发(A)、十面埋伏(S) | 2 |
 | 援护友军单体 | cover_single | 援护(active/D) | 1 |
 | 援护友军全体 | cover_group | 移花接木(active/C) | 1 |
 | 援护全体+前锋条件 | cover_front | 一夫当关(command/A) | 1 |
 | 每回合行动时判定+概率提升 | round_act_prob | 鸟云山兵(command/A) | 1 |
 | 追击触发后机制 | pursuit_hook | 势无虚动(passive/A) | 1 |
 
-> 注：单个战法可属多个机制（如百战无怯＝位置条件+造成伤害叠层+受击/回合开始掉层恢复）。上表按机制统计，跨组战法重复计入。`全军突击`/`飒沓如星` 归 `troop_next`（兵种限定+下N次效果），不再计入 troop_type。百战无怯条件是站位（中军/前锋），不是兵力比例。
+> 注：单个战法可属多个机制（如百战无怯＝位置条件+造成伤害叠层+受击/回合开始掉层恢复）。上表按机制统计，跨组战法重复计入。百战无怯条件是站位（中军/前锋），不是兵力比例。
 
 ---
 
 ## 二、引擎现状核对（2026-08-04）
 
 **已实现**（从"缺失"清单剔除）：
 - **士气发动率系数**（`formulas.ts` `moraleRate` + `action.ts` `moraleTriggerRate`）：士气 100→系数1，120→1.12，80→0.88，作用于带发动率属性的所有战法。**但仅影响发动率**——`士气比较`（目标士气 vs 自身）与`士气降低`（及锋而试 目标士气-10）仍是缺失机制。
 - **受击触发（onHurt p1，2026-09-15）**：`onHurt` 已支持 `damageSource:'basic'` / `timing:'before_damage'` / `victim:'locked'` / `thisHitReduce` / `counter` 状态 / 被动 `endRound` / `roundStartRepeat` 窗口。空城、回马、攻其不备、健卒不殆、反击之策已入库。
+- **兵种过滤 / 普攻主动分流已入库**（2026-09-15 p2）：`teamTroopFilter`、输出 `troopTypes`、`damage_boost` 的 `damageSource`/`skillTypes`/`damageType`、`split.charges`、`oddRounds`、代打 `attacker:'recipient'`。方圆、疏数、衡轭、锋矢、鱼鳞、鹤翼、白刃、全军突击、飒沓如星已入库。
 - **围困 / 妖术 / 燃烧 / 恐慌 DoT / 分兵 / 挑衅 / 先手**（priorityRounds 仅指挥战法）已有状态类型与测试。
 - **击势 / 兵无常势**（2026-08-25）：`ignore_def` 作用于物理攻防差的目标防御；`random_pick` 每回合不放回抽 N 组效果；被动输出级 `chance` 独立判定。
 - **穷追猛打 / 激昂 / 疾击其后 / 扬威**（2026-09-15）：现有机制可做、无受谋略，已入库。`roundRepeat.startRound`、被动 `chance`、追击两段独立 `random_single`+区间率、`charges:1` 下一次增伤均已验证。
 - **援军之策**：同援军秘策（休整 + `startRound:5`），只差受谋略成长率 → `pending_strategy_scale`，下次做，不取基值硬做。
 
-**确认仍缺**：士气比较 / 士气降低 / 禁普攻 / 援护 / 受击触发（垒实迎击、百战无怯、疾风迅雷等仍缺） / 距离+1 / 兵力比例 / 特殊目标选择 / 恢复次数递增（胜敌益强） / 下一次攻击增减伤 / 追击多段 / 攻城属性 / 移除敌军有益 / 兵种限定 / 女武将组合 / 准备跳过 等。反击已作为 `counter` 状态入库（反击之策）；诱敌深入仍 skipped。
+**确认仍缺**：士气比较 / 士气降低 / 禁普攻 / 援护 / 受击触发（垒实迎击、百战无怯、疾风迅雷等仍缺） / 距离+1 / 兵力比例 / 特殊目标选择 / 恢复次数递增（胜敌益强） / 下一次攻击增减伤 / 追击多段 / 攻城属性 / 移除敌军有益 / 女武将组合 / 准备跳过 等。反击已作为 `counter` 状态入库（反击之策）；诱敌深入仍 skipped。
 
 **已入库恢复（本轮）**：重整旗鼓、援军秘策（休整状态，第 5 回合起）；合流、三军之众、利兵谋胜（heal 输出级 `targetSide`）；养精蓄锐、休整、收拢（主动休整）。援军之策仍缺成长率。
 
 ---
 
 ## 三、机制补全后实施路径
 
 1. **机制实现**：在 `src/engine/` 补全对应机制（受击 hook → `onAttacked` 事件点；追击多段 → `triggerPursuitSkill` 改造等）。
 2. **取出战法**：`SELECT * FROM skills WHERE status='skipped' AND mechanism_key='<键>'`（或本文件按机制分组查）。
 3. **实现战法**：按录入规则（`src/data/skills.ts` 定义 + 每战法 3 测试）逐个实现。
 4. **更新 DB**：`mechanism_key` 已实现机制的 key → 战法 `status` 改 `implemented`、补 `mechanism_tags`。
 5. **同步本文件**：移除已实现机制分组，更新清点。
 
 ## 四、建议实现顺序（按受益战法数）
 
-1. **兵种限定**（7 战法）— 最易（`troopType` 字段已有，仅需生效判断）
+1. **特殊目标选择**（6）— 目标选取扩展（`skillTargets` 加模式）
 2. **受击触发**（3：垒实迎击、百战无怯、疾风迅雷）→ **反击**（2：反击 D、诱敌深入）— 同受击 hook 链路；p1 已入库回马/空城/攻其不备/健卒不殆/反击之策
-3. **特殊目标选择**（6）— 目标选取扩展（`skillTargets` 加模式）
+3. **距离+1**（5）— 攻击距离永久增加
 4. **受谋略缩放批次** — 援军之策（`pending_strategy_scale`，机制已有只差成长率）及后续同类
 5. **士气比较/降低**（5）— `moraleRate` 相邻扩展
 6. 其余单机制战法按需推进
 
 ---
 
 *维护：本文件与 `scripts/seed_universal_skills.mjs` 的 `missing_mechanics` 保持一致。改分类前先同步两处。*
diff --git a/scripts/build_heroes_seed.mjs b/scripts/build_heroes_seed.mjs
index 86b2bbf..8bf5b8e 100644
--- a/scripts/build_heroes_seed.mjs
+++ b/scripts/build_heroes_seed.mjs
@@ -91,20 +91,29 @@ const SKILL_ID_BY_NAME = {
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
 };
 
 /** 现有 8 个武将固定拼音 id（测试直接引用 HERO_REGISTRY.<id>） */
 const FIXED_IDS = {
   太史慈: 'taishici',
   周瑜: 'zhouyu',
   孙权: 'sunquan',
   卫瓘: 'weiguan',
   魏延: 'weiyan',
   吕蒙: 'lvmeng',
diff --git a/src/data/skills.ts b/src/data/skills.ts
index 3301b11..d775760 100644
--- a/src/data/skills.ts
+++ b/src/data/skills.ts
@@ -3310,11 +3310,310 @@ export const SKILL_REGISTRY: Record<string, Skill> = {
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
 };
diff --git a/src/engine/action.ts b/src/engine/action.ts
index 2506099..ffff435 100644
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
@@ -172,37 +186,41 @@ export function triggerCommandSkills(ctx: CombatContext, unit: UnitState): void
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
@@ -688,22 +706,23 @@ function executeRoundCommand(ctx: CombatContext, unit: UnitState, skill: Command
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
+        const reduce = sumReduce(t, hit) + troopCounterReduceOf(source, t);
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
@@ -715,21 +734,21 @@ function executeRoundCommand(ctx: CombatContext, unit: UnitState, skill: Command
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
+        modifiers: collectDamageModifiers(ctx, source, t, true, hit),
       });
       applyDamage(ctx, t, capped, source, 'physical', 'skill');
     }
     if (attacked) consumeAttackCharges(ctx, source);
   }
 }
 
 /** 一类指挥 delayedOutput 预先结算：按准备时兵力/属性计算伤害（无视规避）。
  *  生效属性走 effectiveStat（含准备阶段已叠的谋略增益层，如卫瓘持节镇西对吕蒙的叠加） */
 function computeStoredDamage(
@@ -952,43 +971,49 @@ function addStackLayer(
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
@@ -1127,58 +1152,61 @@ function executeSplitAttack(
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
@@ -1347,20 +1375,22 @@ export function actUnit(ctx: CombatContext, unit: UnitState): void {
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
@@ -1473,38 +1503,41 @@ export function inflictStatus(
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
   // 同战法类型、不同战法施加的同名效果（damage_boost 需同方向）
   const sameType = target.statuses.find(
     (s) =>
       s.type !== 'first_aid' &&
       s.type !== 'rest' &&
       s.type === type &&
       s.sourceSkillType === sourceSkillType &&
       s.sourceSkillId !== sourceSkillId &&
       (boostDir === undefined || !('direction' in s) || s.direction === boostDir)
@@ -1618,20 +1651,27 @@ export function inflictStatus(
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
       sameType.remaining = Math.max(sameType.remaining, create.duration);
     }
     ctx.events.push({
       type: 'status_conflict',
       unitId: target.general.id,
@@ -1639,20 +1679,50 @@ export function inflictStatus(
       sourceSkillType,
       detail: `${statusName(sameType.type)}冲突，数值取较高 ${Math.max(incomingVal, curVal)}`,
     });
     return;
   }
 
   // 不同类型：各自计数共存（新增独立实例）
   pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
 }
 
+/**
+ * 同源 damage_boost 只有过滤维（来源 / 战法类型 / 伤害类型）一致才视为同一条、允许累加。
+ * 过滤维不同则视为独立效果（方圆、锋矢各两条）。非 damage_boost 一律视为可累加。
+ */
+function sameDamageBoostFilter(existing: Status, incoming: CreateStatus): boolean {
+  if (existing.type !== 'damage_boost' || incoming.type !== 'damage_boost') return true;
+  const norm = (types?: SkillType[]) => [...(types ?? [])].sort().join(',');
+  return (
+    (existing.damageSource ?? undefined) === (incoming.damageSource ?? undefined) &&
+    (existing.damageType ?? undefined) === (incoming.damageType ?? undefined) &&
+    norm(existing.skillTypes) === norm(incoming.skillTypes)
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
 /** 读取状态数值（规避取层数，攻击/防御/减伤取数值/比率） */
 function statusValue(x: CreateStatus | Status): number {
   if (x.type === 'evasion') return x.stacks;
   return 'amount' in x ? x.amount : 'rate' in x ? x.rate : 0;
 }
 
 function pushStatus(
   ctx: CombatContext,
   target: UnitState,
   create: CreateStatus,
@@ -1705,20 +1775,30 @@ function pushStatus(
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
     // 增减伤/发动率类状态记录施法者（战报归因用）：神兵天降/大赏三军/减伤/奋疾先登降速等
     if (casterId) {
       (push as { sourceUnitId?: string }).sourceUnitId = casterId;
     }
     if (type === 'trigger_boost' && 'skillTypes' in create && create.skillTypes) {
@@ -1827,33 +1907,36 @@ function pushStatus(
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
@@ -1940,20 +2023,22 @@ export function tickStatuses(ctx: CombatContext, units: UnitState[]): void {
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
@@ -1993,20 +2078,21 @@ export function tickRoundStartStatuses(ctx: CombatContext): void {
       });
     }
   }
 
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
@@ -2079,71 +2165,116 @@ function physicalTargetDefense(attacker: UnitState, target: UnitState): number {
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
  */
 function collectDamageModifiers(
   ctx: CombatContext,
   source: UnitState,
   target: UnitState,
-  includeBoosts = true
+  includeBoosts = true,
+  hit?: DamageHitContext
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
   if (cr > 0) {
     reduce.push({
       unitId: target.general.id,
       skillId: 'troop_counter',
       skillName: '兵种克制',
       rate: cr,
       direction: 'reduce',
     });
@@ -2218,20 +2349,29 @@ function redirectPhysicalHit(ctx: CombatContext, original: UnitState): UnitState
 
 /** 次数型「下一次攻击」：一次 physical/strategy/positional 输出或一次普攻消耗 1 次（不按目标数） */
 function consumeAttackCharges(ctx: CombatContext, attacker: UnitState): void {
   for (const s of [...attacker.statuses]) {
     if (s.type !== 'damage_boost' || s.charges == null) continue;
     s.charges -= 1;
     if (s.charges <= 0) attacker.statuses = attacker.statuses.filter((x) => x !== s);
   }
 }
 
+/** 次数型分兵：每次分兵攻击消耗 1 次，charges 耗尽则移除（鱼鳞/飒沓如星） */
+function consumeSplitCharges(unit: UnitState): void {
+  for (const s of [...unit.statuses]) {
+    if (s.type !== 'split' || !('charges' in s) || s.charges == null) continue;
+    s.charges -= 1;
+    if (s.charges <= 0) unit.statuses = unit.statuses.filter((x) => x !== s);
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
@@ -2245,21 +2385,27 @@ function executeSkillOutputs(
       if (out.startRound != null && ctx.currentRound < out.startRound) continue;
       if (out.endRound != null && ctx.currentRound > out.endRound) continue;
     }
     if (out.kind === 'random_pick') {
       const picked = ctx.rng.pickN(out.options, out.count);
       executeSkillOutputs(ctx, caster, skill, targets, picked.flat());
       continue;
     }
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
@@ -2294,22 +2440,99 @@ function executeSkillOutputs(
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
+              const reduce = sumReduce(t, hit) + troopCounterReduceOf(rider, t);
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
+                modifiers: collectDamageModifiers(ctx, rider, t, true, hit),
+              });
+              applyDamage(ctx, t, capped, rider, 'physical', 'skill');
+            }
+            if (riderAttacked) consumeAttackCharges(ctx, rider);
+          }
+          rememberDamageTargets(selectedIds);
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
@@ -2333,22 +2556,23 @@ function executeSkillOutputs(
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
+            const reduce = sumReduce(t, hit) + troopCounterReduceOf(source, t);
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
@@ -2361,21 +2585,21 @@ function executeSkillOutputs(
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
+              modifiers: collectDamageModifiers(ctx, source, t, true, hit),
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
@@ -2423,22 +2647,23 @@ function executeSkillOutputs(
           triggerStackBuff(ctx, caster, t, 'strategy');
           // 规避：默认免疫一次伤害；ignoresEvasion 时无视
           if (!out.ignoresEvasion && consumeEvasion(ctx, t, caster.general.id)) continue;
           // 叠层后再读生效谋略（与物理伤害先叠攻击再读 effectiveStat 对齐；
           // 群体逐目标叠层，每段伤害吃到截至本目标的全部层）
           const effStrategy = effectiveStat(caster, 'strategy');
           let rate = out.rate;
           if (out.strategyScaled) {
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
@@ -2448,21 +2673,21 @@ function executeSkillOutputs(
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
         if (pool.some((t) => t.alive)) consumeAttackCharges(ctx, caster);
         break;
       }
       case 'heal': {
         let rate = out.rate;
         if (out.strategyScaled) {
@@ -2807,20 +3032,24 @@ function executeSkillWithTargets(
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
 
@@ -2952,22 +3181,23 @@ function normalAttack(
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
@@ -2982,21 +3212,21 @@ function dealAttack(ctx: CombatContext, unit: UnitState, target: UnitState, dist
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
   consumeAttackCharges(ctx, unit);
 }
 
 /** 持续型急救受击触发（皇裔流离/金匮要略）：目标受到伤害后判定。
  *  每个急救状态独立判定一次：按战法级计数器当前触发率 rng 判定，成功则恢复兵力（受围困拦截），
  *  并累计战法级总生效次数——每达到 triggerUpEvery 次，触发率 +triggerUpIncrement（可叠加）。
  *  兵力已归零或已阵亡时不判定（致死一击不可救回、不可复活）。 */
 function triggerFirstAidOnHurt(ctx: CombatContext, target: UnitState): void {
@@ -3396,22 +3626,23 @@ function applyOnHurtEffect(
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
@@ -3422,21 +3653,21 @@ function settleCounterOnHurt(ctx: CombatContext, holder: UnitState, attacker: Un
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
diff --git a/src/engine/types.ts b/src/engine/types.ts
index b3c7d68..d4f1076 100644
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -88,22 +88,28 @@ export type SkillOutput =
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
@@ -174,22 +180,24 @@ export type SkillOutput =
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
@@ -219,20 +227,22 @@ export type SkillOutput =
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
@@ -255,46 +265,46 @@ export type CreateStatus =
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
+  | { type: 'damage_reduce'; rate: number; duration: number; strategyScaled?: boolean; growthRate?: number; /** 按 8 份衰减（谋议宏图）：准备阶段 8/8，每回合开始 -1/8 */ decayEighths?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
   /** direction：'caused'=自身造成伤害提高/降低（血溅黄砂、强势）；'taken'=自身受到伤害提高/降低（神兵天降、名士在野）。缺省 'taken'。
    *  stacks：叠层计数（带上限的增减伤，银龙冲阵），同战法累加时 +1
    *  strategyScaled=true 且给 growthRate 时（密谋定蜀每次发动 +5% 受谋略）：rate 为谋略 80 时的基础值，实际数值按 scaledValue 缩放
    *  defenseScaled=true（当敌制决 +8%）：公式同受谋略，属性换生效防御
    *  speedScaled=true（攻其不备 +11.6%）：受速度缩放；growthRate === undefined 时不缩放、用基值
    *  charges：次数型「下一次攻击」，有值时按攻击输出次数消耗，不按回合递减（青丘媚祸 charges:1）
    *  chargesStack：同战法重复施加时累加 rate（七步释嫌）；缺省不叠加（青丘媚祸） */
-  | { type: 'damage_boost'; rate: number; duration: number; direction?: 'caused' | 'taken'; stacks?: number; strategyScaled?: boolean; /** 受防御缩放（当敌制决 +8%，公式同受谋略，属性换生效防御） */ defenseScaled?: boolean; /** 受速度缩放（攻其不备 +11.6%）；growthRate === undefined 时不缩放、用基值 */ speedScaled?: boolean; growthRate?: number; charges?: number; chargesStack?: boolean }
+  | { type: 'damage_boost'; rate: number; duration: number; direction?: 'caused' | 'taken'; stacks?: number; strategyScaled?: boolean; /** 受防御缩放（当敌制决 +8%，公式同受谋略，属性换生效防御） */ defenseScaled?: boolean; /** 受速度缩放（攻其不备 +11.6%）；growthRate === undefined 时不缩放、用基值 */ speedScaled?: boolean; growthRate?: number; charges?: number; chargesStack?: boolean; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
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
@@ -318,20 +328,25 @@ interface BaseSkill {
   name: string;
   type: SkillType;
   /** 战法有效距离 */
   range: number;
   /** 发动率 0~1（指挥/被动为 1） */
   triggerRate: number;
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
@@ -462,20 +477,22 @@ export interface CommandSkill extends BaseSkill {
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
 
@@ -760,41 +777,41 @@ export type Status =
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
+  | { type: 'damage_boost'; rate: number; remaining: number; appliedRound: number; sourceSkillType: SkillType; sourceSkillId: string; direction: 'caused' | 'taken'; sourceUnitId?: string; /** 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）；无上限时不设置 */ stacks?: number; /** 次数型下一次攻击（青丘媚祸） */ charges?: number; /** 伤害来源过滤：basic=普攻 / skill=战法；缺省两类都吃 */ damageSource?: 'basic' | 'skill'; /** 只对这些战法类型生效；缺省主动+追击+指挥+被动都吃 */ skillTypes?: SkillType[]; /** 只对该伤害类型生效；缺省物理+策略都吃 */ damageType?: 'physical' | 'strategy' }
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

```
