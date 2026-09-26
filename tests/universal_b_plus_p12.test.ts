/**
 * 拆解通用 B+ 第十二阶段 · 行动后叠层（A 级 2 个）：
 * 乘间击隙（自身主动主战法发动后攻击伤害 +15%×3 层，满 3 层打一次群体 240% 并清空）、
 * 勠力同心（大营发动主动/追击后，前锋中军 下次行动阶段主动/追击伤害 +40%，最多 2 层）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
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
    morale: 140,
  };
}

function enemyTeam(): General[] {
  const front = dummy('enemy-front', '前锋');
  front.speed = 200;
  front.attack = 180;
  return [front, dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function asCommand(id: string): Extract<Skill, { type: 'command' }> {
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

function unitFrom(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

function makeCtx(my: General[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemyTeam().map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const boostsOn = (u: UnitState, skillId: string) =>
  u.statuses.filter(
    (s): s is Extract<typeof s, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === skillId
  );

/** 携带主动主战法 jingong 的单位发动一次主动战法 */
function castMainActive(ctx: CombatContext, unit: UnitState): void {
  const copy = { ...asActive('jingong'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set('jingong', copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

describe('乘间击隙（A 指挥：自身主动主战法发动后攻击伤害 +15%×3，满 3 层群体 240% 后清空）', () => {
  it('装配：prep、self、range 4；afterMainActiveStacks 3 层 + 触发段 240% 群体 3', () => {
    const s = asCommand('chengjian_jixi');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(4);
    expect(s.output).toHaveLength(0);
    expect(s.afterMainActiveStacks?.maxStacks).toBe(3);
    const st = inflictStatusOf({ kind: 'inflict_status', status: s.afterMainActiveStacks!.status } as SkillOutput);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.15);
      expect(st.direction).toBe('caused');
      expect(st.attackOnly).toBe(true);
      expect(st.maxStacks).toBe(3);
    }
    const trig = s.afterMainActiveStacks?.triggerOutput[0];
    expect(trig?.kind).toBe('physical_damage');
    if (trig?.kind === 'physical_damage') {
      expect(trig.rate).toBe(240);
      expect(trig.targetMode).toBe('group');
      expect(trig.groupCount).toBe(3);
    }
  });

  it('窗口：主战法发动 3 次 → 前两次叠层（15%→30%），第三次打出群体 240% 后清空', () => {
    const front = dummy('carrier', '前锋');
    front.commandSkillIds = ['chengjian_jixi'];
    front.activeSkillIds = ['jingong'];
    front.mainSkillId = 'jingong';
    const ctx = makeCtx([front, dummy('ally-mid', '中军'), dummy('ally-back', '大营')]);
    const unit = ctx.myTeam[0];
    castMainActive(ctx, unit);
    expect(boostsOn(unit, 'chengjian_jixi')[0]?.stacks).toBe(1);
    castMainActive(ctx, unit);
    const st2 = boostsOn(unit, 'chengjian_jixi')[0];
    if (st2?.type === 'damage_boost') {
      expect(st2.stacks).toBe(2);
      expect(st2.rate).toBeCloseTo(0.3, 6);
    }
    castMainActive(ctx, unit);
    // 第 3 层触发一次群体攻击（3 名敌军各 1 条 damage），随后增伤清空
    const trig = damageEvents(ctx, 'chengjian_jixi');
    expect(trig).toHaveLength(3);
    expect(boostsOn(unit, 'chengjian_jixi')).toHaveLength(0);
  });

  it('窗口：非主战法发动不加层', () => {
    const front = dummy('carrier', '前锋');
    front.commandSkillIds = ['chengjian_jixi'];
    front.activeSkillIds = ['jingong'];
    front.mainSkillId = 'some_other_main';
    const ctx = makeCtx([front, dummy('ally-mid', '中军'), dummy('ally-back', '大营')]);
    const unit = ctx.myTeam[0];
    for (let i = 0; i < 3; i++) castMainActive(ctx, unit);
    expect(boostsOn(unit, 'chengjian_jixi')).toHaveLength(0);
    expect(damageEvents(ctx, 'chengjian_jixi')).toHaveLength(0);
  });
});

describe('勠力同心（A 指挥：大营发动主动/追击后，前锋中军 下次行动阶段主动/追击伤害 +40%，最多 2 层）', () => {
  function team(): General[] {
    const front = dummy('ally-front', '前锋');
    front.commandSkillIds = ['luli_tongxin'];
    const mid = dummy('ally-mid', '中军');
    const back = dummy('ally-back', '大营');
    back.activeSkillIds = ['jingong'];
    back.mainSkillId = 'jingong';
    return [front, mid, back];
  }

  it('装配：prep、self、range 2；dapingCastBuff 大营→前锋/中军，40% 主动+追击，最多 2 层', () => {
    const s = asCommand('luli_tongxin');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.output).toHaveLength(0);
    const cfg = s.dapingCastBuff;
    expect(cfg?.actorPositions).toEqual(['大营']);
    expect(cfg?.targetPositions).toEqual(['前锋', '中军']);
    const st = cfg?.status;
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.4);
      expect(st.direction).toBe('caused');
      expect(st.skillTypes).toEqual(['active', 'pursuit']);
      expect(st.duration).toBe(2);
      expect(st.maxStacks).toBe(2);
    }
  });

  it('窗口：大营发动主动战法 → 前锋/中军各得 1 层（大营自身不得），再发动封顶 2 层', () => {
    const ctx = makeCtx(team());
    const [front, mid, back] = ctx.myTeam;
    castMainActive(ctx, back);
    expect(boostsOn(front, 'luli_tongxin')[0]?.stacks).toBe(1);
    expect(boostsOn(mid, 'luli_tongxin')[0]?.stacks).toBe(1);
    expect(boostsOn(back, 'luli_tongxin')).toHaveLength(0);
    castMainActive(ctx, back);
    castMainActive(ctx, back);
    expect(boostsOn(front, 'luli_tongxin')[0]?.stacks).toBe(2); // 封顶
    const st = boostsOn(front, 'luli_tongxin')[0];
    if (st?.type === 'damage_boost') expect(st.rate).toBeCloseTo(0.8, 6);
  });

  it('窗口：非大营发动主动战法不触发', () => {
    const ctx = makeCtx(team());
    const mid = ctx.myTeam[1];
    mid.general.activeSkillIds = ['jingong'];
    mid.general.mainSkillId = 'jingong';
    castMainActive(ctx, mid);
    expect(ctx.myTeam.every((u) => boostsOn(u, 'luli_tongxin').length === 0)).toBe(true);
  });
});
