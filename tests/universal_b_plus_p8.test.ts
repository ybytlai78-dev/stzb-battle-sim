/**
 * 拆解通用 B+ 第八阶段 · 兵力比例 / 闪击（B 级 2 个）：
 * 亡命一搏（自身兵力 <25% → 伤害率 160→460）、闪击（攻击 50% + 敌军单体下一次攻击伤害降至下限）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { actUnit, inflictStatus, triggerActiveSkill, type CombatContext } from '../src/engine/action';
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
    currentRound: 0,
  };
}

function castActive(ctx: CombatContext, skillId: string): Extract<Skill, { type: 'active' }> {
  const base = asActive(skillId);
  const copy = { ...base, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  const caster = ctx.myTeam.find((u) => u.general.activeSkillIds.includes(skillId)) ?? ctx.myTeam[0];
  triggerActiveSkill(ctx, caster, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
  return copy;
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const attackHits = (ctx: CombatContext, sourceId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
      e.type === 'attack_hit' && e.sourceId === sourceId
  );

const hasStatus = (u: UnitState, type: string) => u.statuses.some((s) => s.type === type);

describe('亡命一搏（B 主动 25% 距离 3：群体 2 猛击 160%，自身兵力 <25% → 460%）', () => {
  it('装配：普通主动、群体 2 目标、range 3；rateBySelfTroopRatio 低于 25% 换 460', () => {
    const s = asActive('wangming_yibo');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.25);
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    const out = s.output[0];
    if (out.kind !== 'physical_damage') throw new Error('应为攻击伤害');
    expect(out.rate).toBe(160);
    expect(out.rateBySelfTroopRatio).toEqual({ cond: { below: 25 }, rate: 460 });
  });

  it('窗口：兵力充足用 160 基准；兵力低于 25% 换成 460 基准（同兵力、同种子对比）', () => {
    const runOnce = (maxTroops: number) => {
      const ctx = makeCtx(activeTeam('wangming_yibo'), 5);
      // troops 保持 10000：只改「初始兵力」把比例压到 25% 以下，排除兵力对伤害的影响
      ctx.myTeam[0].general.maxTroops = maxTroops;
      castActive(ctx, 'wangming_yibo');
      return damageEvents(ctx, 'wangming_yibo')[0]?.damage ?? 0;
    };
    const normal = runOnce(10000); // 100% → 160%
    const desperate = runOnce(50000); // 20% → 460%
    expect(normal).toBeGreaterThan(0);
    expect(desperate).toBeGreaterThan(normal);
  });

  it('窗口：兵力恰好 25% 不触发（below = 严格低于）', () => {
    const runOnce = (maxTroops: number) => {
      const ctx = makeCtx(activeTeam('wangming_yibo'), 5);
      ctx.myTeam[0].general.maxTroops = maxTroops;
      castActive(ctx, 'wangming_yibo');
      return damageEvents(ctx, 'wangming_yibo')[0]?.damage ?? 0;
    };
    // troops 10000 / maxTroops 40000 = 25% → 不满足 below:25
    expect(runOnce(40000)).toBe(runOnce(10000));
  });
});

describe('闪击（B 主动 50% 距离 4：群体 2 攻击 50% + 敌军单体下一次攻击伤害降至下限 10%）', () => {
  it('装配：普通主动、群体 2、range 4；output 顺序 攻击 → 敌军单体 debuff', () => {
    const s = asActive('shanji');
    expect(s.triggerRate).toBe(0.5);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.output.map((o) => o.kind)).toEqual(['physical_damage', 'inflict_status']);
    const debuff = s.output[1];
    if (debuff.kind !== 'inflict_status') throw new Error('应为状态');
    expect(debuff.targetSide).toBe('enemy');
    expect(debuff.targetMode).toBe('random_single');
    const st = inflictStatusOf(debuff);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(-99.99);
      expect(st.direction).toBe('caused');
      expect(st.attackOnly).toBe(true);
      expect(st.charges).toBe(1);
      expect(st.duration).toBe(999);
    }
  });

  it('窗口：释放后 2 条伤害 + 恰好 1 名敌军拿到「下一次攻击大幅降低」debuff', () => {
    const ctx = makeCtx(activeTeam('shanji'));
    castActive(ctx, 'shanji');
    expect(damageEvents(ctx, 'shanji')).toHaveLength(2);
    const debuffed = ctx.enemyTeam.filter((u) => hasStatus(u, 'damage_boost'));
    expect(debuffed).toHaveLength(1);
    const st = debuffed[0].statuses.find((s) => s.type === 'damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(-99.99);
      expect(st.charges).toBe(1);
    }
  });

  it('机制：debuff 后普攻伤害 = 兵力基础 + 其余 ×10%（buffMult 下限，兵力基础不乘增减伤）', () => {
    const runPing = (withDebuff: boolean) => {
      const ctx = makeCtx(activeTeam('shanji'), 3);
      const foe = ctx.enemyTeam[0];
      if (withDebuff) {
        inflictStatus(
          ctx,
          foe,
          { type: 'damage_boost', rate: -99.99, duration: 999, direction: 'caused', attackOnly: true, charges: 1 },
          'active',
          'shanji'
        );
      }
      ctx.currentRound = 1;
      actUnit(ctx, foe);
      const hit = attackHits(ctx, 'enemy-front')[0];
      if (!hit) throw new Error('无普攻事件');
      return hit;
    };
    const baseline = runPing(false);
    const buffed = runPing(true);
    const troopBase = baseline.breakdown.troopBase;
    const expected = Math.round(troopBase + (baseline.damage - troopBase) * 0.1);
    expect(Math.abs(buffed.damage - expected)).toBeLessThanOrEqual(1);
    expect(buffed.damage).toBeGreaterThan(0);
  });
});
