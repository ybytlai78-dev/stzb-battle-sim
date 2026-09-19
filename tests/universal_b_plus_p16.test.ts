/**
 * 拆解通用 B+ 第十六阶段 · 道行险阻（A 主动：防御 −50 受攻击 / 谋略 −50 受谋略，持续 1 回合；
 * 目标下一次行动前对其策略 150% + 攻击 150%）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { actUnit, triggerActiveSkill, type CombatContext } from '../src/engine/action';
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

function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.activeSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
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

function castActive(ctx: CombatContext, skillId: string): void {
  const copy = { ...asActive(skillId), triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, ctx.myTeam[0], copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);

describe('道行险阻（A 主动：防御 −50 受攻击 / 谋略 −50 受谋略，目标下次行动前策略+攻击各 150%）', () => {
  it('装配：普通主动、random_single、range 4；两段属性 debuff（attackScaled / strategyScaled）+ schedule_strike 两段', () => {
    const s = asActive('daoxing_xianzu');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('random_single');
    expect(s.output.map((o) => o.kind)).toEqual(['inflict_status', 'inflict_status', 'schedule_strike']);
    const def = inflictStatusOf(s.output[0]);
    expect(def?.type).toBe('defense_buff');
    if (def?.type === 'defense_buff') {
      expect(def.amount).toBe(-50);
      expect(def.duration).toBe(2);
      expect(def.attackScaled).toBe(true);
      expect(def.growthRate).toBeUndefined();
    }
    const strat = inflictStatusOf(s.output[1]);
    expect(strat?.type).toBe('strategy_buff');
    if (strat?.type === 'strategy_buff') {
      expect(strat.amount).toBe(-50);
      expect(strat.strategyScaled).toBe(true);
      expect(strat.growthRate).toBeUndefined();
    }
    const sched = s.output[2];
    if (sched.kind === 'schedule_strike') {
      expect(sched.output.map((o) => o.kind)).toEqual(['strategy_damage', 'physical_damage']);
      if (sched.output[0].kind === 'strategy_damage') {
        expect(sched.output[0].rate).toBe(150);
        expect(sched.output[0].strategyScaled).toBe(true);
        expect(sched.output[0].growthRate).toBeUndefined();
      }
      if (sched.output[1].kind === 'physical_damage') expect(sched.output[1].rate).toBe(150);
    }
  });

  it('窗口：释放后给目标挂减防/减谋，并排入延迟队列（尚未结算伤害）', () => {
    const ctx = makeCtx(activeTeam('daoxing_xianzu'));
    castActive(ctx, 'daoxing_xianzu');
    expect(ctx.pendingStrikes).toHaveLength(1);
    expect(damageEvents(ctx, 'daoxing_xianzu')).toHaveLength(0);
    const targetId = ctx.pendingStrikes![0].targetId;
    const target = ctx.enemyTeam.find((u) => u.general.id === targetId);
    if (!target) throw new Error('无目标');
    expect(statusOf(target, 'defense_buff')?.type).toBe('defense_buff');
    expect(statusOf(target, 'strategy_buff')?.type).toBe('strategy_buff');
  });

  it('窗口：目标下一次行动开始前结算两段伤害（策略 + 攻击），随后队列消耗', () => {
    const ctx = makeCtx(activeTeam('daoxing_xianzu'), 3);
    castActive(ctx, 'daoxing_xianzu');
    const targetId = ctx.pendingStrikes![0].targetId;
    const target = ctx.enemyTeam.find((u) => u.general.id === targetId);
    if (!target) throw new Error('无目标');
    // 施法者行动（或直接让目标行动）：这里直接让目标行动，行动开始前应先吃到两段
    actUnit(ctx, target);
    const hits = damageEvents(ctx, 'daoxing_xianzu');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const types = hits.map((h) => h.damageType);
    expect(types).toContain('strategy');
    expect(types).toContain('physical');
    expect(hits.every((h) => h.targetId === targetId)).toBe(true);
    expect(ctx.pendingStrikes ?? []).toHaveLength(0);
  });

  it('机制：属性 buff 受攻击缩放（补 growthRate 后攻击越高减防越多）', () => {
    const run = (attack: number) => {
      const team = activeTeam('daoxing_xianzu');
      team[0].attack = attack;
      const ctx = makeCtx(team);
      const s = asActive('daoxing_xianzu');
      ctx.skills.set('daoxing_xianzu', {
        ...s,
        triggerRate: 1,
        output: [
          {
            kind: 'inflict_status',
            status: { type: 'defense_buff', amount: -50, duration: 2, attackScaled: true, growthRate: 0.5 },
          },
        ],
      } as Extract<Skill, { type: 'active' }>);
      triggerActiveSkill(ctx, ctx.myTeam[0], ctx.skills.get('daoxing_xianzu')!, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      const targetId = ctx.enemyTeam.find((u) => statusOf(u, 'defense_buff'))?.general.id;
      const target = ctx.enemyTeam.find((u) => u.general.id === targetId);
      const st = target && statusOf(target, 'defense_buff');
      return st && 'amount' in st ? st.amount : 0;
    };
    // 攻击 180：−50 − 0.5×100 = −100；攻击 80：−50（基值）
    expect(run(180)).toBe(-100);
    expect(run(80)).toBe(-50);
  });
});
