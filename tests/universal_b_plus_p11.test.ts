/**
 * 拆解通用 B+ 第十一阶段 · 叠层钩子（B/A 2 个）：
 * 以直报怨（每回合首次造成/受到伤害后 → 造成/受到伤害 −10%，可叠 6）、
 * 久战熟谋（友军群体每造成一次策略伤害 → 其策略伤害 +5%，最多 5 层）。
 */
import { describe, it, expect } from 'vitest';
import type { General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { applyDamage, triggerCommandSkills, type CombatContext } from '../src/engine/action';
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

function commandTeam(skillId: string, position: Position = '中军'): General[] {
  const carrier = dummy('carrier', position, 10000);
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

function asCommand(id: string): Extract<Skill, { type: 'command' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
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

const boostsFrom = (u: UnitState, skillId: string) =>
  u.statuses.filter(
    (s): s is Extract<typeof s, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === skillId
  );

describe('以直报怨（B 指挥：每回合首次造成/受到伤害后 → 造成/受到伤害 −10%，可叠 6）', () => {
  it('装配：prep、self、range 5；dealFirstPerRound（caused −0.1 / 6 层）+ onHurt（taken −0.1 / 6 层）', () => {
    const s = asCommand('yizhibaoyuan');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(5);
    expect(s.output).toHaveLength(0);
    const deal = inflictStatusOf(s.dealFirstPerRound?.output[0]);
    expect(deal?.type).toBe('damage_boost');
    if (deal?.type === 'damage_boost') {
      expect(deal.rate).toBe(-0.1);
      expect(deal.direction).toBe('caused');
      expect(deal.maxStacks).toBe(6);
    }
    expect(s.onHurt).toBeDefined();
    const hurt = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt!;
    expect(hurt.victim).toBe('self');
    expect(hurt.oncePerRound).toBe(true);
    const taken = inflictStatusOf(hurt.output?.[0]);
    expect(taken?.type).toBe('damage_boost');
    if (taken?.type === 'damage_boost') {
      expect(taken.rate).toBe(-0.1);
      expect(taken.direction).toBe('taken');
      expect(taken.maxStacks).toBe(6);
    }
  });

  it('窗口：每回合首次造成伤害使「被伤害目标」造成伤害 −10%；同回合第二次不再触发，跨回合再叠一层', () => {
    const ctx = makeCtx(commandTeam('yizhibaoyuan'));
    const carrier = ctx.myTeam[1];
    triggerCommandSkills(ctx, carrier);
    const foe = ctx.enemyTeam[0];
    applyDamage(ctx, foe, 100, carrier, 'physical', 'skill');
    expect(boostsFrom(foe, 'yizhibaoyuan')).toHaveLength(1);
    // 同回合第二次造成伤害：不触发
    applyDamage(ctx, ctx.enemyTeam[1], 100, carrier, 'physical', 'skill');
    expect(boostsFrom(ctx.enemyTeam[1], 'yizhibaoyuan')).toHaveLength(0);
    // 第 2 回合：同源叠加到 2 层
    ctx.currentRound = 2;
    applyDamage(ctx, foe, 100, carrier, 'physical', 'skill');
    const st = boostsFrom(foe, 'yizhibaoyuan')[0];
    if (st?.type === 'damage_boost') {
      expect(st.stacks).toBe(2);
      expect(st.rate).toBeCloseTo(-0.2, 6);
    }
  });

  it('窗口：自身首次受到伤害后使我军单体受到伤害 −10%（每回合一次）', () => {
    const ctx = makeCtx(commandTeam('yizhibaoyuan'));
    const carrier = ctx.myTeam[1];
    triggerCommandSkills(ctx, carrier);
    applyDamage(ctx, carrier, 300, ctx.enemyTeam[0], 'physical', 'basic');
    const hit = ctx.myTeam.filter((u) => boostsFrom(u, 'yizhibaoyuan').length > 0);
    expect(hit).toHaveLength(1);
    const st = boostsFrom(hit[0], 'yizhibaoyuan')[0];
    if (st?.type === 'damage_boost') {
      expect(st.direction).toBe('taken');
      expect(st.rate).toBe(-0.1);
    }
    // 同回合再来一次：不新增
    applyDamage(ctx, ctx.myTeam[2], 300, ctx.enemyTeam[0], 'physical', 'basic');
    expect(ctx.myTeam.reduce((n, u) => n + boostsFrom(u, 'yizhibaoyuan').length, 0)).toBe(1);
  });
});

describe('久战熟谋（A 指挥：友军群体每造成一次策略伤害 → 其策略伤害 +5%，最多 5 层）', () => {
  it('装配：prep、ally 群体 2；allyDealStack damageType strategy + 状态 0.05 / maxStacks 5 / 受谋略', () => {
    const s = asCommand('jiuzhan_shumou');
    expect(s.phase).toBe('prep');
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.output).toHaveLength(0);
    expect(s.allyDealStack?.damageType).toBe('strategy');
    const st = s.allyDealStack?.status;
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.05);
      expect(st.direction).toBe('caused');
      expect(st.damageType).toBe('strategy');
      expect(st.strategyScaled).toBe(true);
      expect(st.growthRate).toBeUndefined();
      expect(st.maxStacks).toBe(5);
    }
  });

  it('窗口：准备阶段挂到 2 名友军身上（初始 1 层）', () => {
    const ctx = makeCtx(commandTeam('jiuzhan_shumou'));
    triggerCommandSkills(ctx, ctx.myTeam[1]);
    const holders = ctx.myTeam.filter((u) => boostsFrom(u, 'jiuzhan_shumou').length > 0);
    expect(holders).toHaveLength(2);
    for (const u of holders) {
      const st = boostsFrom(u, 'jiuzhan_shumou')[0];
      if (st?.type === 'damage_boost') {
        expect(st.stacks).toBe(1);
        expect(st.rate).toBeCloseTo(0.05, 6);
      }
    }
    expect(ctx.lockedCommands[0].targets).toHaveLength(2);
  });

  it('窗口：每次造成策略伤害同源叠 1 层、5 层封顶；造成物理伤害不叠', () => {
    const ctx = makeCtx(commandTeam('jiuzhan_shumou'));
    triggerCommandSkills(ctx, ctx.myTeam[1]);
    const holder = ctx.myTeam[0];
    const foe = ctx.enemyTeam[0];
    for (let i = 0; i < 6; i++) applyDamage(ctx, foe, 50, holder, 'strategy', 'skill');
    let st = boostsFrom(holder, 'jiuzhan_shumou')[0];
    if (st?.type === 'damage_boost') {
      expect(st.stacks).toBe(5);
      expect(st.rate).toBeCloseTo(0.25, 6);
    }
    // 物理伤害不叠（damageType 过滤）
    applyDamage(ctx, foe, 50, holder, 'physical', 'skill');
    st = boostsFrom(holder, 'jiuzhan_shumou')[0];
    if (st?.type === 'damage_boost') expect(st.stacks).toBe(5);
  });
});
