/**
 * 出手顺序：每回合按当前生效速度重排（含加点 / 速度增益），同速站位前锋>中军>大营。
 * 局外加点后的面板速度必须进入局内排序（卫瓘加点快过吕蒙 → 卫瓘先手）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle, buildTurnOrder, buildPriorityOrder } from '../src/engine/combat';
import { inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, speed: number, troops = 9000): General {
  return {
    id,
    name: id,
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
    speed,
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

function toUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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
  };
}

/** 每回合首次 unit_act_start 出现顺序 = 该回合实际出手顺序 */
function uniqueActOrder(events: BattleEvent[], round: number): string[] {
  const start = events.findIndex((e) => e.type === 'round_start' && e.round === round);
  if (start < 0) return [];
  const end = events.findIndex((e, i) => i > start && e.type === 'round_start');
  const slice = events.slice(start, end < 0 ? undefined : end);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const e of slice) {
    if (e.type !== 'unit_act_start') continue;
    if (seen.has(e.unitId)) continue;
    seen.add(e.unitId);
    order.push(e.unitId);
  }
  return order;
}

describe('每回合按当前速度排序', () => {
  it('加点后面板速度进入排序：卫瓘速度点超过吕蒙则每回合都先于吕蒙行动', () => {
    const weiguan = level40({ ...HERO_REGISTRY.weiguan }, { speed: 40 });
    weiguan.position = '中军';
    const lvmeng = level40({ ...HERO_REGISTRY.lvmeng }, { speed: 0 });
    lvmeng.position = '大营';
    expect(weiguan.speed).toBeGreaterThan(lvmeng.speed);

    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [weiguan, lvmeng],
      enemyTeam: [dummy('e1', '前锋', 10), dummy('e2', '中军', 10), dummy('e3', '大营', 10)],
    });

    for (let r = 1; r <= report.rounds; r++) {
      const order = uniqueActOrder(report.events, r);
      const wi = order.indexOf(weiguan.id);
      const li = order.indexOf(lvmeng.id);
      if (wi < 0 || li < 0) continue; // 已阵亡则本回合不再出现
      expect(wi, `第 ${r} 回合卫瓘应排在吕蒙前面：${order.join(' > ')}`).toBeLessThan(li);
    }
  });

  it('round_start.turnOrder 为当回合按当前速度排出的行动序', () => {
    const fast = dummy('fast', '大营', 120);
    const slow = dummy('slow', '前锋', 40);
    const report = runBattle({
      seed: 3,
      maxRounds: 2,
      myTeam: [fast, slow],
      enemyTeam: [dummy('e1', '前锋', 10), dummy('e2', '中军', 10), dummy('e3', '大营', 10)],
    });
    const r1 = report.events.find((e): e is Extract<BattleEvent, { type: 'round_start' }> => e.type === 'round_start' && e.round === 1);
    expect(r1?.turnOrder?.[0]).toBe('fast');
    expect(uniqueActOrder(report.events, 1)[0]).toBe('fast');
  });

  it('速度增益在下一回合重排中生效：慢将叠速度后超过快将则下一回合先手', () => {
    const slow = toUnit(dummy('slow', '前锋', 60));
    const fast = toUnit(dummy('fast', '中军', 80), 'enemy');
    const skills = new Map<string, Skill>(Object.entries(SKILL_REGISTRY));

    expect(buildPriorityOrder([slow, fast], 1, skills)[0].general.id).toBe('fast');

    const ctx: CombatContext = {
      rng: new Rng(1),
      myTeam: [slow],
      enemyTeam: [fast],
      events: [],
      skills,
      lockedCommands: [],
      stackBuffs: [],
      currentRound: 1,
    };
    inflictStatus(ctx, slow, { type: 'speed_buff', amount: 50, duration: 2 }, 'active', 'test_speed', slow.general.id);

    expect(buildTurnOrder([slow, fast])[0].general.id).toBe('slow');
    expect(buildPriorityOrder([slow, fast], 2, skills)[0].general.id).toBe('slow');
  });
});
