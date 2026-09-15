/**
 * 赏顺伐逆（贾充）：受恢复 75% 友军全体奶 65%（受谋略成长 0.325）；
 * 受策略伤害 75% 对来源策略 180%（成长未知取基值）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  applyDamage,
  recoverTroops,
  triggerPassiveSkills,
  type CombatContext,
} from '../src/engine/action';
import { firstOnHurt, type BattleEvent, type General, type PassiveSkill, type Position, type Skill, type UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '晋',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function forceOnHealRate(ctx: CombatContext, skillId: string, rate = 1): void {
  const base = ctx.skills.get(skillId);
  if (!base || (base.type !== 'command' && base.type !== 'passive') || !base.onHeal) {
    throw new Error(`forceOnHealRate：${skillId} 无 onHeal`);
  }
  ctx.skills.set(skillId, { ...base, onHeal: { ...base.onHeal, rate } } as Skill);
}

function forceOnHurtRate(ctx: CombatContext, skillId: string, rate = 1): void {
  const base = ctx.skills.get(skillId);
  if (!base || (base.type !== 'command' && base.type !== 'passive') || !base.onHurt) {
    throw new Error(`forceOnHurtRate：${skillId} 无 onHurt`);
  }
  ctx.skills.set(skillId, { ...base, onHurt: { ...firstOnHurt(base.onHurt)!, rate } } as Skill);
}

describe('赏顺伐逆（贾充，被动：受恢复奶全体 / 受策略反击来源）', () => {
  it('装配：贾充主战法挂入被动槽', async () => {
    const g = hero('h708');
    expect(g.name).toBe('贾充');
    expect(g.passiveSkillIds).toContain('shangshun_fani');
    const s = SKILL_REGISTRY['shangshun_fani'];
    expect(s.type).toBe('passive');
    if (s.type === 'passive') {
      expect(s.timing).toBe('battle_start');
      expect(s.range).toBe(5);
      expect(s.onHeal?.rate).toBe(0.75);
      expect(s.onHeal?.applyTo).toBe('allies');
      expect(s.onHeal?.output?.[0]).toMatchObject({ kind: 'heal', rate: 65, strategyScaled: true, growthRate: 0.325 });
      expect(firstOnHurt(s.onHurt)?.damageKind).toBe('strategy');
      expect(firstOnHurt(s.onHurt)?.applyTo).toBe('source');
      expect(firstOnHurt(s.onHurt)?.sourceMaxDistance).toBe(5);
      expect(firstOnHurt(s.onHurt)?.output?.[0]).toMatchObject({
        kind: 'strategy_damage',
        rate: 180,
        strategyScaled: false,
        growthRate: 0,
      });
    }
  });

  it('受恢复后 75% 为友军全体恢复（65% 受谋略成长 0.325）；自身群体奶不重入', () => {
    const jc = makeUnit(withSkills(dummy('h708', '中军', { strategy: 200 }), { passiveSkillIds: ['shangshun_fani'] }));
    const ally = makeUnit(dummy('ally', '前锋'));
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    jc.troops = 5000;
    ally.troops = 5000;
    const ctx = makeCtx([jc, ally], [foe]);
    triggerPassiveSkills(ctx, jc, 'battle_start');
    forceOnHealRate(ctx, 'shangshun_fani', 1);
    recoverTroops(ctx, jc, 100);
    const heals = ctx.events.filter((e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal');
    expect(heals.length).toBe(2);
    expect(heals.map((e) => e.targetId).sort()).toEqual(['ally', 'h708']);
    const casts = ctx.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'shangshun_fani');
    // battle_start 因 onHurt 登记 1 次 + onHeal 群体奶 1 次；重入会变成 3
    expect(casts.length).toBe(2);
  });

  it('受策略伤害反击来源 180%；普攻不反击；DoT 算策略', () => {
    const jc = makeUnit(withSkills(dummy('h708', '中军'), { passiveSkillIds: ['shangshun_fani'] }));
    const foe = makeUnit(dummy('foe', '前锋', { maxTroops: 20000 }), 'enemy');
    foe.troops = 20000;
    const ctx = makeCtx([jc], [foe]);
    triggerPassiveSkills(ctx, jc, 'battle_start');
    forceOnHurtRate(ctx, 'shangshun_fani', 1);
    const hpAfterPhys = foe.troops;
    applyDamage(ctx, jc, 50, foe, 'physical');
    expect(foe.troops).toBe(hpAfterPhys);
    applyDamage(ctx, jc, 50, foe, 'strategy');
    expect(foe.troops).toBeLessThan(hpAfterPhys);
    const dmg = ctx.events.filter(
      (e) => e.type === 'damage' && e.skillId === 'shangshun_fani' && e.damageType === 'strategy'
    );
    expect(dmg.length).toBeGreaterThanOrEqual(1);
  });
});
