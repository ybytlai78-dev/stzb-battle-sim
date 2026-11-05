/**
 * 胜兵求战「任意友军发动主动战法后，自身下一次主动战法造成的伤害提高 15%」：
 * 「友军」= 其余队友，**不含自己**。
 *
 * 用户 2026-10-30 口径（原话）：「胜兵求战的描述『任意友军施放主动战法』不包括其自身。
 * 目标为两个队友，我军群体才是我方三选二，友军是不包括自己的」。
 *
 * 旧实现 `triggerCastKindHooks` 未排除 `holder === actor`（注释还写着「按仓库口径含自己」）：
 * 携带者自己每次成功发动主动战法都白叠 1 层（先被消耗旧层、随后本次发动又叠 1 层 → 常驻 15%）。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string, position: Position, side: 'my' | 'enemy'): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 120, defense: 80, strategy: 100, speed: 60, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

/** 100% 发动的合成主动战法：去掉随机性，只考察「谁发动才叠层」 */
const ACTIVE: Skill = {
  id: 'test_active',
  name: '测试主动',
  type: 'active',
  prepare: false,
  range: 5,
  triggerRate: 1,
  targetMode: 'single',
  targetSide: 'enemy',
  tags: ['damage'],
  output: [{ kind: 'physical_damage', rate: 100 }],
};

/** 携带者（前锋·带胜兵求战）+ 队友（中军·带 100% 主动）+ 敌方裸将 */
function field(selfActive = false) {
  const sbqz = SKILL_REGISTRY['shengbing_qiuzhan'];
  if (!sbqz) throw new Error('胜兵求战未注册');
  const holder = makeUnit('holder', '前锋', 'my');
  holder.general.commandSkillIds = ['shengbing_qiuzhan'];
  if (selfActive) holder.general.activeSkillIds = ['test_active'];
  const mate = makeUnit('mate', '中军', 'my');
  mate.general.activeSkillIds = ['test_active'];
  const foe = makeUnit('foe', '前锋', 'enemy');
  const ctx: CombatContext = {
    rng: new Rng(20261030),
    myTeam: [holder, mate],
    enemyTeam: [foe],
    events: [],
    skills: new Map<string, Skill>([
      [ACTIVE.id, ACTIVE],
      [sbqz.id, sbqz],
    ]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  return { ctx, holder, mate, foe };
}

function boosts(u: UnitState): Array<Extract<Status, { type: 'damage_boost' }>> {
  return u.statuses.filter(
    (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
  );
}

describe('胜兵求战：任意友军 = 队友（不含自己）', () => {
  it('队友成功发动主动战法 → 携带者自身叠 1 层 15%（造成的伤害提高）', () => {
    const { ctx, holder, mate } = field();
    actUnit(ctx, mate);

    const b = boosts(holder);
    expect(b).toHaveLength(1);
    expect(b[0].rate).toBeCloseTo(0.15, 8);
    expect(b[0].direction).toBe('caused');
  });

  it('携带者自己发动主动战法 → 不叠层（报障回归）', () => {
    const { ctx, holder } = field(true);
    actUnit(ctx, holder);

    expect(boosts(holder)).toHaveLength(0);
  });
});
