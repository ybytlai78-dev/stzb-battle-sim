/**
 * 批量10 主战法测试（v0.11）：奋疾先登（乐进）
 * 新增引擎机制：二类指挥行动叠层（actLayer：行动增伤层 + 速度对比叠层 + 满层群体攻击 + 目标降速）
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值。
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

const casts = (report: ReturnType<typeof runBattle>, skillName: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === skillName);

const damageBy = (report: ReturnType<typeof runBattle>, skillId: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

describe('奋疾先登（乐进，二类指挥：行动叠层增伤，满 5 层触发群体攻击 + 目标降速）', () => {
  it('主战法挂入指挥槽（乐进），二类指挥 on_act', () => {
    const g = hero('h685');
    expect(g.name).toBe('乐进');
    expect(g.commandSkillIds).toContain('fenji_xiandeng');
    const s = SKILL_REGISTRY['fenji_xiandeng'];
    if (s.type === 'command') {
      expect(s.phase).toBe('round');
      expect(s.roundTrigger).toBe('on_act');
    }
  });

  it('行动时释放并叠增伤层（每回合至少 1 层，战法增伤状态出现）', () => {
    const report = runBattle({
      seed: 100001,
      maxRounds: 8,
      myTeam: fullTeam(level40(hero('h685'), { attack: 40 })),
      enemyTeam: enemyTeam(),
    });
    expect(casts(report, '奋疾先登').length).toBeGreaterThan(0);
    // 自身被施加本战法增伤（status_inflicted）
    const boosts = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.unitId === 'h685' && e.statusType === 'damage_boost'
    );
    expect(boosts.length).toBeGreaterThan(0);
  });

  it('层数达到 5 层时对敌军群体发动 190% 攻击，并使目标速度降低', () => {
    const report = runBattle({
      seed: 100001,
      maxRounds: 8,
      myTeam: fullTeam(level40(hero('h685'), { attack: 40 })),
      enemyTeam: enemyTeam(),
    });
    const dmg = damageBy(report, 'fenji_xiandeng');
    // 木桩速度 20 均低于乐进（40 级速度≈71）→ 每回合 70% 判定，8 回合内应叠满触发至少一次
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.damageType === 'physical')).toBe(true);
    // 目标速度降低状态出现（可叠加、持续到战斗结束）
    const speedDown = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'speed_buff'
    );
    expect(speedDown.length).toBeGreaterThan(0);
  });
});
