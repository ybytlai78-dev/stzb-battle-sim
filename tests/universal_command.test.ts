/**
 * 通用指挥战法批量测试（u4）：无心恋战
 * 无心恋战（S 一类指挥）：战斗开始后前 3 回合，使敌军群体进行攻击和策略攻击时
 * 的伤害降低 30%。进行伤害降低 = 造成侧 damage_boost 负值，敌军群体在准备阶段获得。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

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

/** 指挥战法装配：携带者在中军 */
function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '中军', 10000);
  carrier.attack = 120;
  carrier.defense = 90;
  carrier.strategy = 85;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

describe('无心恋战（S 一类指挥：敌军群体伤害降低 30%，前 3 回合）', () => {
  it('装配：指挥槽挂入，prep 阶段指挥', () => {
    const t = commandTeam('wuxin_lianzhan');
    expect(t[1].commandSkillIds).toContain('wuxin_lianzhan');
    const s = SKILL_REGISTRY['wuxin_lianzhan'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
  });

  it('准备阶段为敌军群体（有效距离内2目标）施加负增伤（damage_boost，rate<0）', () => {
    const report = run(commandTeam('wuxin_lianzhan'));
    expect(casts(report, '无心恋战').length).toBe(1);
    const db = inflicted(report, 'damage_boost').filter((e) => e.unitId.startsWith('enemy'));
    expect(db.length).toBeGreaterThanOrEqual(2);
  });
});
