/**
 * 疮痍累身（周泰·吴·步 主战法）：被动。
 * 战斗开始使自身受到的所有伤害降低 84.0%（受攻击伤害 / 受策略伤害两条各自独立的衰减轨），
 * 每当受到该类型伤害后该轨减伤降低 1/12；位于前锋及中军时前 2 回合援护友军全体
 * （官方口径「为其抵挡普通攻击」→ 仅普攻转移，战法伤害不转移）；同时每次受到伤害后有 50.0%
 * 几率使攻击/防御/谋略属性提高 20.0，可叠加、持续直到战斗结束；首次受到伤害时该效果必定触发
 * 且额外触发 1 次。
 *
 * 引擎配套（本条战法为此补了 4 项）：
 *   ① damage_reduce 受击按份衰减 decayFifths（af7437a，份数可配 → 12）
 *   ② 输出段施法者站位条件 casterPositions（be29c72）
 *   ③ onHurt 首次必触发 + 额外 1 次 firstGuaranteed（be29c72）
 *   ④ 援护代受：cover 状态 + applyDamage 普攻分支（本轮新增，此前 cover 仅有类型定义无实现）
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

function dummy(id: string, position: Position): General {
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
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
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
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 周泰坐在指定站位，其余位置放木桩 */
function teamWithZhouAt(pos: Position): General[] {
  const zt = { ...level40(hero('h589')), position: pos };
  const slots = [dummy('ally-front', '前锋'), dummy('ally-mid', '中军'), dummy('ally-back', '大营')];
  const idx = slots.findIndex((s) => s.position === pos);
  slots[idx] = zt;
  return slots;
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
const STATS = ['attack_buff', 'defense_buff', 'strategy_buff'];
const statEvents = (events: BattleEvent[]): Inflicted[] =>
  events.filter((e): e is Inflicted => e.type === 'status_inflicted' && STATS.includes(e.statusType));

describe('疮痍累身（周泰，被动：两轨减伤 + 援护 + 受击叠属性）', () => {
  it('装配挂槽 + 战法元数据（被动 / battle_start / 自身）', () => {
    const g = hero('h589');
    expect(g.name).toBe('周泰');
    expect(g.passiveSkillIds).toContain('chuangyi_leishen');

    const s = SKILL_REGISTRY['chuangyi_leishen'];
    expect(s.type).toBe('passive');
    expect(s.type === 'passive' && s.timing).toBe('battle_start');
    expect(s.type === 'passive' && s.targetMode).toBe('self');
    expect(s.range).toBe(1);
    expect(s.tags).toEqual(expect.arrayContaining(['damage_reduce', 'cover']));
  });

  it('战斗开始：挂上受攻击 / 受策略两条独立减伤，且覆盖 cover 段', () => {
    const report = run(teamWithZhouAt('前锋'), 1, 1);
    const reduce = report.events.filter(
      (e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === 'damage_reduce'
    );
    // 两轨（受攻击 / 受策略）各一条
    expect(reduce.length).toBe(2);
    expect(reduce.every((e) => e.unitId === 'h589')).toBe(true);
    expect(reduce.every((e) => e.detail.includes('84'))).toBe(true);
  });

  it('施法者站位条件：坐前锋有 cover 状态，坐大营则没有', () => {
    const front = run(teamWithZhouAt('前锋'), 1, 1);
    const coverFront = front.events.filter(
      (e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === 'cover'
    );
    expect(coverFront).toHaveLength(1);
    expect(coverFront[0].unitId).toBe('h589');

    const back = run(teamWithZhouAt('大营'), 1, 1);
    const coverBack = back.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'cover'
    );
    expect(coverBack).toHaveLength(0);
  });

  it('援护代受：友军被普攻时由周泰（前锋）代为承受，战报记 cover 事件', () => {
    const report = run(teamWithZhouAt('前锋'), 1, 4);
    const covers = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'cover' }> => e.type === 'cover'
    );
    expect(covers.length).toBeGreaterThan(0);
    // 代受者恒为周泰，被援护者为其友军（不含自己）
    expect(covers.every((e) => e.unitId === 'h589')).toBe(true);
    expect(covers.every((e) => e.targetId !== 'h589')).toBe(true);
    // 前 2 回合援护 → 第 3 回合起不再有 cover 事件
    const r3 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 3);
    if (r3 > 0) {
      expect(
        report.events.slice(r3).filter((e) => e.type === 'cover')
      ).toHaveLength(0);
    }
  });

  it('首次受击必触发：首次受击即出现属性增益（攻/防/谋）', () => {
    const report = run(teamWithZhouAt('前锋'), 1, 3);
    const stats = statEvents(report.events);
    expect(stats.length).toBeGreaterThanOrEqual(3);
    expect(stats.every((e) => e.unitId === 'h589')).toBe(true);
    expect(stats.map((e) => e.statusType).slice(0, 3).sort()).toEqual([...STATS].sort());
  });

  it('战报文案（官方口径）：执行来自 / 效果使 / 效果刷新 / 递减 四行齐备', () => {
    const report = run(teamWithZhouAt('前锋'), 1, 4);
    const detailOf = (e: BattleEvent) => ('detail' in e && e.detail ? e.detail : '');
    const changed = report.events
      .filter((e) => e.type === 'skill_exec' || e.type === 'status_changed')
      .map(detailOf);
    const all = report.events.map(detailOf).join('\n');

    // ① 战法效果执行行（受击触发时）
    expect(changed).toContain('【周泰】执行来自【周泰】的【疮痍累身】效果！');
    // ② 属性增减行带来源前缀 +「提高了增幅(变化后)」
    expect(all).toMatch(/【周泰】【疮痍累身】的效果使【周泰】的攻击属性提高了20\(/);
    // ③ 同类属性重复施加 → 效果刷新了
    expect(changed).toContain('攻击属性提高效果刷新了');
    // ④ 受击递减：先「效果下降了」，再给递减后的新值
    expect(changed).toContain('受到攻击伤害降低效果下降了');
    expect(changed.some((d) => /^【疮痍累身】使【周泰】受到攻击伤害降低\d+%$/.test(d))).toBe(true);
  });
});
