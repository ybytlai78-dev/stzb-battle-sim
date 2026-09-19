/**
 * 拆解通用 B+ 第十三阶段 · 准备战法时机（B 级 2 个）：
 * 谋定后动（发动准备主战法 → 洞察 2 回合；发动主动战法后 → 我军群体攻/防/谋 +55）、
 * 胜兵求战（准备战法 80% 跳过准备；任意友军发动主动后自身下一个主动伤害 +15%，最多 3 层）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { triggerActiveSkill, triggerPassiveSkills, type CombatContext } from '../src/engine/action';
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

function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
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
    currentRound: 1,
  };
}

const hasStatus = (u: UnitState, type: string) => u.statuses.some((s) => s.type === type);
const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);
const boostsOn = (u: UnitState, skillId: string) =>
  u.statuses.filter(
    (s): s is Extract<typeof s, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === skillId
  );

describe('谋定后动（B 被动：发动准备主战法 → 洞察 2 回合；发动主动后我军群体攻/防/谋 +55）', () => {
  it('装配：battle_start、self；onPrepareStart（mainSkillOnly + insight 2）+ afterActive（三维修正 55 / 2 回合）', () => {
    const s = asPassive('mouding_houdong');
    expect(s.timing).toBe('battle_start');
    expect(s.targetMode).toBe('self');
    expect(s.onPrepareStart?.mainSkillOnly).toBe(true);
    const ig = inflictStatusOf(s.onPrepareStart?.output[0]);
    expect(ig?.type).toBe('insight');
    if (ig?.type === 'insight') expect(ig.duration).toBe(2);
    expect(s.afterActive?.output).toHaveLength(3);
    const types = s.afterActive?.output.map((o) => inflictStatusOf(o)?.type);
    expect(types).toEqual(['attack_buff', 'defense_buff', 'strategy_buff']);
    for (const o of s.afterActive?.output ?? []) {
      const st = inflictStatusOf(o);
      if (st && 'amount' in st) expect(st.amount).toBe(55);
      if (st && 'duration' in st) expect(st.duration).toBe(2);
    }
  });

  it('窗口：进入准备时获得洞察（仅对主战法准备生效）', () => {
    const run = (mainSkillId: string) => {
      const team = passiveTeam('mouding_houdong');
      team[0].activeSkillIds = ['yuanshe']; // 远射：1 回合准备主动
      team[0].mainSkillId = mainSkillId;
      const ctx = makeCtx(team);
      const unit = ctx.myTeam[0];
      const copy = { ...asActive('yuanshe'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
      ctx.skills.set('yuanshe', copy);
      triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      return hasStatus(unit, 'insight');
    };
    expect(run('yuanshe')).toBe(true);
    expect(run('some_other_main')).toBe(false);
  });

  it('窗口：发动主动战法后我军群体获得攻/防/谋 +55（持续 2 回合）', () => {
    const team = passiveTeam('mouding_houdong');
    team[0].activeSkillIds = ['jingong'];
    const ctx = makeCtx(team);
    const unit = ctx.myTeam[0];
    const copy = { ...asActive('jingong'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
    ctx.skills.set('jingong', copy);
    triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    for (const u of ctx.myTeam) {
      for (const type of ['attack_buff', 'defense_buff', 'strategy_buff']) {
        const st = statusOf(u, type);
        expect(st?.type).toBe(type);
        if (st && 'amount' in st) expect(st.amount).toBe(55);
      }
    }
  });
});

describe('胜兵求战（B 指挥：准备战法 80% 跳过准备；任意友军发动主动后自身下一个主动伤害 +15%，最多 3 层）', () => {
  it('装配：prep、self；output 挂 jump_prep(0.8)；allyActiveCastStack 追击…主动增伤 chargesStack', () => {
    const s = asCommand('shengbing_qiuzhan');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    const jump = inflictStatusOf(s.output[0]);
    expect(jump?.type).toBe('jump_prep');
    if (jump && 'rate' in jump) {
      expect(jump.rate).toBe(0.8);
      expect(jump.duration).toBe(999);
    }
    const st = s.allyActiveCastStack?.status;
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.15);
      expect(st.direction).toBe('caused');
      expect(st.skillTypes).toEqual(['active']);
      expect(st.maxStacks).toBe(3);
      expect(st.charges).toBe(1);
      expect(st.chargesStack).toBe(true);
    }
  });

  it('窗口：任意友军（含自己）发动主动战法后，携带者叠 1 层、3 层封顶', () => {
    const ctx = makeCtx(commandTeam('shengbing_qiuzhan'));
    const carrier = ctx.myTeam[0];
    const ally = ctx.myTeam[1];
    ally.general.activeSkillIds = ['jingong'];
    ally.general.mainSkillId = 'jingong';
    const copy = { ...asActive('jingong'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
    ctx.skills.set('jingong', copy);
    for (let i = 0; i < 4; i++) {
      triggerActiveSkill(ctx, ally, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    }
    const st = boostsOn(carrier, 'shengbing_qiuzhan')[0];
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.stacks).toBe(3);
      expect(st.rate).toBeCloseTo(0.45, 6);
    }
  });

  it('窗口：自身发动主动战法时增伤被消耗；因「任意友军」含自己，本次发动后又重新叠 1 层（净 1 层）', () => {
    const ctx = makeCtx(commandTeam('shengbing_qiuzhan'));
    const carrier = ctx.myTeam[0];
    carrier.general.activeSkillIds = ['jingong'];
    carrier.general.mainSkillId = 'jingong';
    const copy = { ...asActive('jingong'), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
    ctx.skills.set('jingong', copy);
    // 先由友军发动一次 → 携带者 1 层
    const ally = ctx.myTeam[1];
    triggerActiveSkill(ctx, ally, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    expect(boostsOn(carrier, 'shengbing_qiuzhan')).toHaveLength(1);
    // 携带者自己发动主动：本次伤害吃掉旧层（charges 消耗），随后「自己发动」又叠 1 层 → 仍是 1 层
    triggerActiveSkill(ctx, carrier, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    const after = boostsOn(carrier, 'shengbing_qiuzhan');
    expect(after).toHaveLength(1);
    if (after[0]?.type === 'damage_boost') expect(after[0].stacks).toBe(1);
    expect(after[0]?.rate).toBeCloseTo(0.15, 6);
  });
});
