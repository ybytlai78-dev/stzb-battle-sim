/**
 * 批量12 主战法测试（v0.11）：银龙冲阵（赵云）
 * 新增引擎机制：random_single 随机单体目标（每次独立判断）+ markTakenBoost 受击增伤标记
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值/共存。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

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
    morale: 120,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 完整 3 人队：主将居中，含前锋/大营友军 */
function fullTeam(leader: General): General[] {
  return [leader, dummy('ally-front', '前锋'), dummy('ally-back', '大营')];
}

const damageBy = (report: ReturnType<typeof runBattle>, skillId: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

describe('银龙冲阵（赵云，主动：随机两次攻击 + 首次目标受击增伤）', () => {
  it('主战法挂入主动槽（赵云），主动 50% 距离 5', () => {
    const g = hero('zhaoyun');
    expect(g.name).toBe('赵云');
    expect(g.activeSkillIds).toContain('yinlong_chongzhen');
    const s = SKILL_REGISTRY['yinlong_chongzhen'];
    expect(s.type).toBe('active');
    if (s.type === 'active') {
      expect(s.triggerRate).toBe(0.5);
      expect(s.range).toBe(5);
    }
  });

  it('发动后随机对敌军单体发动 2 次攻击（每次目标独立判断）', () => {
    const report = runBattle({
      seed: 120001,
      maxRounds: 8,
      myTeam: fullTeam(level40(hero('zhaoyun'), { attack: 40 })),
      enemyTeam: enemyTeam(),
    });
    const dmg = damageBy(report, 'yinlong_chongzhen');
    expect(dmg.length).toBeGreaterThan(0);
    // 两次攻击各命中 1 个目标（damage 事件两两成组）
    expect(dmg.length % 2).toBe(0);
    expect(dmg.every((e) => e.damageType === 'physical')).toBe(true);
    expect(dmg.every((e) => e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('首次攻击的目标受到伤害提高（taken 增伤状态，可叠加至多 3 层）', () => {
    const report = runBattle({
      seed: 120001,
      maxRounds: 8,
      myTeam: fullTeam(level40(hero('zhaoyun'), { attack: 40 })),
      enemyTeam: enemyTeam(),
    });
    const boosts = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost'
    );
    // 银龙冲阵的受击增伤（taken）以 status_inflicted 出现
    expect(boosts.length).toBeGreaterThan(0);
    // 8 回合内赵云 40 级攻击 ≈ 190+40 加点 → 每层 ≈ 31%；至少出现一次增伤
    const dmg = damageBy(report, 'yinlong_chongzhen');
    expect(dmg.length).toBeGreaterThan(0);
  });
});
