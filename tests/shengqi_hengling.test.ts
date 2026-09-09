/**
 * 盛气横凌（文鸯·追击）
 * 普攻命中后猛攻 260%；再按目标生效士气分支：
 *  - 高昂（>100）→ 混乱 1 回合
 *  - 一般或低落（≤100）→ 额外攻击 80%~160%
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, hasStatus, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

/** stub rng：追击必中；区间伤害率取中值 */
function stubRng(): Rng {
  return {
    next: () => 0.5,
    int: () => 0,
    intInclusive: (min: number, max: number) => Math.round((min + max) / 2),
    chance: () => true,
  } as unknown as Rng;
}

function makeUnit(id: string, opts: { position?: Position; morale?: number; pursuit?: boolean } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3.5,
      faction: '晋',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'cavalry',
      position: opts.position ?? '前锋',
      attack: 200,
      defense: 80,
      strategy: 40,
      speed: 120,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '盛气横凌',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: opts.pursuit ? ['shengqi_hengling'] : [],
      morale: opts.morale ?? 100,
    },
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function field(targetMorale: number): { ctx: CombatContext; wenyang: UnitState; enemy: UnitState } {
  const ctx: CombatContext = {
    rng: stubRng(),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  const wenyang = makeUnit('wenyang', { pursuit: true, morale: 100 });
  const enemy = makeUnit('enemy', { position: '前锋', morale: targetMorale });
  enemy.side = 'enemy';
  enemy.general.speed = 10;
  ctx.myTeam = [wenyang];
  ctx.enemyTeam = [enemy];
  return { ctx, wenyang, enemy };
}

const skillDamage = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'shengqi_hengling'
  );

describe('盛气横凌（文鸯，追击：猛攻 260% + 士气分支）', () => {
  it('装配挂槽：文鸯主战法挂入追击槽', () => {
    const g = hero('h704');
    expect(g.name).toBe('文鸯');
    expect(g.pursuitSkillIds).toContain('shengqi_hengling');
    const s = SKILL_REGISTRY['shengqi_hengling'];
    expect(s.type).toBe('pursuit');
    expect(s.triggerRate).toBe(0.5);
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'confusion']));
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 260 });
    const branch = s.output[1];
    expect(branch.kind).toBe('morale_branch');
    if (branch.kind === 'morale_branch') {
      expect(branch.high).toEqual([{ kind: 'inflict_status', status: { type: 'confusion', duration: 1 } }]);
      expect(branch.low).toEqual([{ kind: 'physical_damage', rate: [80, 160] }]);
    }
  });

  it('机制：目标士气高昂（>100）则混乱 1 回合，不再额外攻击', () => {
    const { ctx, wenyang, enemy } = field(120);
    actUnit(ctx, wenyang);
    expect(skillDamage(ctx)).toHaveLength(1);
    expect(hasStatus(enemy, 'confusion')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillName === '盛气横凌')).toBe(true);
  });

  it('数值：士气 ≤100 额外攻击两段且无混乱；morale_boost 使 100 变为高昂', () => {
    const low = field(100);
    actUnit(low.ctx, low.wenyang);
    const lowDmg = skillDamage(low.ctx);
    expect(lowDmg).toHaveLength(2);
    expect(hasStatus(low.enemy, 'confusion')).toBe(false);
    expect(lowDmg[1].damage).toBeLessThan(lowDmg[0].damage);

    const boosted = field(100);
    inflictStatus(boosted.ctx, boosted.enemy, { type: 'morale_boost', amount: 8, duration: 999 }, 'command', 'mouyi_hongtu');
    actUnit(boosted.ctx, boosted.wenyang);
    expect(skillDamage(boosted.ctx)).toHaveLength(1);
    expect(hasStatus(boosted.enemy, 'confusion')).toBe(true);
  });
});
