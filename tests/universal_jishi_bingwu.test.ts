/**
 * 通用被动：兵无常势 / 击势
 * 每战法 3 个测试：装配挂槽 / 机制事件状态 / 数值或共存。
 * 不依赖英雄库（用木桩装配 extra 被动）。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';

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

/** 被动战法装配：携带者在前锋，士气 100（生效几率不乘士气系数） */
function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 200;
  carrier.defense = 90;
  carrier.strategy = 85;
  carrier.speed = 1;
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({
    seed,
    maxRounds,
    myTeam: team,
    enemyTeam: enemyTeam(),
    /** 无死亡：受伤全部入伤兵池，兵无常势恢复才有事件 */
    woundedMortality: { base: 0, perRound: 0 },
  });
}

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

/**
 * 按一次被动施放切分后续事件，直到下一次同战法 skill_cast 或行动结束。
 */
function eventsAfterCast(
  events: BattleEvent[],
  castIndex: number
): BattleEvent[] {
  const slice = events.slice(castIndex + 1);
  const end = slice.findIndex(
    (e) => e.type === 'skill_cast' || e.type === 'unit_act_end' || e.type === 'round_end'
  );
  return end < 0 ? slice : slice.slice(0, end);
}

describe('兵无常势（A 被动：每回合行动时随机 3 选 2）', () => {
  it('装配：被动槽挂入，round_start 被动', () => {
    const t = passiveTeam('bingwu_changshi');
    expect(t[0].passiveSkillIds).toContain('bingwu_changshi');
    const s = SKILL_REGISTRY['bingwu_changshi'];
    expect(s.type === 'passive' && s.timing === 'round_start').toBe(true);
    expect(s.name).toBe('兵无常势');
  });

  it('每次发动恰好生效两种效果（恢复 / 三维+50 / 减伤 40%）', () => {
    const report = run(passiveTeam('bingwu_changshi'), 1, 8);
    const casts = report.events
      .map((e, i) => ({ e, i }))
      .filter((x): x is { e: Extract<BattleEvent, { type: 'skill_cast' }>; i: number } =>
        x.e.type === 'skill_cast' && x.e.skillId === 'bingwu_changshi'
      );
    expect(casts.length).toBeGreaterThanOrEqual(8);
    const groups = (after: BattleEvent[]): boolean[] => [
      after.some((e) => e.type === 'heal' && e.skillId === 'bingwu_changshi'),
      after.some(
        (e) =>
          (e.type === 'status_inflicted' || e.type === 'status_changed') &&
          ['attack_buff', 'defense_buff', 'strategy_buff'].includes(e.statusType ?? '') &&
          e.unitId === 'carrier'
      ),
      after.some(
        (e) =>
          (e.type === 'status_inflicted' || e.type === 'status_changed') &&
          e.statusType === 'damage_reduce' &&
          e.unitId === 'carrier'
      ),
    ];
    // 首次发动：三种效果池中恰好命中两组（新施加必有事件）
    expect(groups(eventsAfterCast(report.events, casts[0].i)).filter(Boolean)).toHaveLength(2);
    // 后续回合：新口径下上一回合的 buff 会活到本次行动，若连续命中同一组则走同源刷新
    //（属性类发 status_changed、减伤类静默刷新）→ 事件流上至少能看到一组，绝不出现三组
    for (const { i } of casts) {
      const count = groups(eventsAfterCast(report.events, i)).filter(Boolean).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('三维增益为 +50、减伤为 40%；多回合三种效果都会出现', () => {
    const report = run(passiveTeam('bingwu_changshi'), 1, 8);
    const atk = inflicted(report, 'attack_buff').find((e) => e.unitId === 'carrier');
    const def = inflicted(report, 'defense_buff').find((e) => e.unitId === 'carrier');
    const strat = inflicted(report, 'strategy_buff').find((e) => e.unitId === 'carrier');
    const reduce = inflicted(report, 'damage_reduce').find((e) => e.unitId === 'carrier');
    const heals = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === 'bingwu_changshi'
    );
    expect(atk?.detail).toContain('50');
    expect(def?.detail).toContain('50');
    expect(strat?.detail).toContain('50');
    expect(reduce?.detail).toMatch(/0\.4|40%/);
    expect(heals.length).toBeGreaterThan(0);
    expect(atk).toBeDefined();
    expect(reduce).toBeDefined();
  });
});

describe('击势（S 被动：65% 独立判定增伤 50% / 无视防御 60%）', () => {
  it('装配：被动槽挂入，round_start 被动', () => {
    const t = passiveTeam('jishi');
    expect(t[0].passiveSkillIds).toContain('jishi');
    const s = SKILL_REGISTRY['jishi'];
    expect(s.type === 'passive' && s.timing === 'round_start').toBe(true);
    expect(s.name).toBe('击势');
  });

  it('每回合两个效果独立判定（会出现一成一败）', () => {
    let foundSplit = false;
    for (let seed = 1; seed <= 80 && !foundSplit; seed++) {
      const report = run(passiveTeam('jishi'), seed, 4);
      const triggers = report.events.filter(
        (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
          e.type === 'skill_trigger' && e.skillId === 'jishi'
      );
      expect(triggers.length).toBeGreaterThanOrEqual(2);
      expect(triggers[0].baseRate).toBe(65);
      for (let i = 0; i + 1 < triggers.length; i += 2) {
        if (triggers[i].success !== triggers[i + 1].success) foundSplit = true;
      }
    }
    expect(foundSplit).toBe(true);
  });

  it('判定成功时施加增伤 50% 与无视防御 60%', () => {
    const report = run(passiveTeam('jishi'), 1, 8);
    const boost = inflicted(report, 'damage_boost').find((e) => e.unitId === 'carrier');
    const ignore = inflicted(report, 'ignore_def').find((e) => e.unitId === 'carrier');
    expect(boost?.detail).toMatch(/50%/);
    expect(ignore?.detail).toMatch(/60%/);
  });
});
