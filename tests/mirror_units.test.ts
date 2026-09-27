/**
 * 红蓝同将（对方可能有相同武将）单位 id 去重
 *   - 引擎全程用 `general.id` 作为单位身份（事件 unitId / 统计 / 实时距离 / 状态来源 / 计数器）。
 *   - 同一武将同时上阵红蓝两队时，runBattle 先把第二份改写为 `原id#2`，并把原武将 id 记入 `heroId`。
 *   - 无重复时不得产生任何行为差异（既有 golden 逐字节不变）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleConfig, General } from '../src/engine/types';
import { ensureUniqueUnitIds, runBattle } from '../src/engine/combat';

function mk(id: string, name: string, position: General['position'], extra: Partial<General> = {}): General {
  return {
    id,
    name,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 150,
    defense: 100,
    strategy: 80,
    speed: 60,
    attackRange: 2,
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

/** 镜像对局：两队的前锋是同一名武将（id 相同） */
function mirrorConfig(): BattleConfig {
  return {
    myTeam: [mk('mirror', '同一个', '前锋', { speed: 70 }), mk('my-mid', '我方中军', '中军', { speed: 40 })],
    enemyTeam: [mk('mirror', '同一个', '前锋', { speed: 50 }), mk('en-mid', '敌方中军', '中军', { speed: 45 })],
    seed: 424242,
    maxRounds: 3,
  };
}

describe('红蓝同将：单位 id 去重', () => {
  it('ensureUniqueUnitIds：无重复时原样返回（引用都不变，既有战报零影响）', () => {
    const my = [mk('a', '甲', '前锋'), mk('b', '乙', '中军')];
    const enemy = [mk('c', '丙', '前锋')];
    const r = ensureUniqueUnitIds(my, enemy);
    expect(r.myTeam).toBe(my);
    expect(r.enemyTeam).toBe(enemy);
  });

  it('ensureUniqueUnitIds：后出现的重复 id 改写为 #2 / #3 并记下 heroId', () => {
    // 队内重复属异常输入，去重也要兜底（红蓝同将是正常输入）
    const my = [mk('a', '甲', '前锋'), mk('a', '甲二号', '中军')];
    const enemy = [mk('a', '甲三号', '前锋')];
    const r = ensureUniqueUnitIds(my, enemy);
    expect(r.myTeam.map((g) => g.id)).toEqual(['a', 'a#2']);
    expect(r.enemyTeam.map((g) => g.id)).toEqual(['a#3']);
    expect(r.myTeam[0].heroId).toBeUndefined(); // 首份保留原 id，无需 heroId
    expect(r.myTeam[1].heroId).toBe('a');
    expect(r.enemyTeam[0].heroId).toBe('a');
  });

  it('镜像对局：事件中的 unitId 全局唯一、统计按单位分开', () => {
    const report = runBattle(mirrorConfig());
    // 红队首份保留原 id；蓝队副本 id 去重 + heroId 还原真实武将
    expect(report.myTeam[0].id).toBe('mirror');
    expect(report.enemyTeam[0].id).toBe('mirror#2');
    expect(report.enemyTeam[0].heroId).toBe('mirror');
    // battle_start 出手顺序：4 个单位 4 个不同 id
    const start = report.events.find((e) => e.type === 'battle_start');
    expect(start?.type).toBe('battle_start');
    if (start?.type === 'battle_start') expect(new Set(start.turnOrder).size).toBe(start.turnOrder.length);
    // 统计条目与单位一一对应（同名不再被合并成一条）
    const ids = [...report.myTeam, ...report.enemyTeam].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(report.stats.map((s) => s.unitId).sort()).toEqual([...ids].sort());
    // 任何一次攻击的源与目标都不是同一个单位（去重前会出现「mirror 打 mirror」的自击歧义）
    for (const ev of report.events) {
      if (ev.type === 'attack_hit' || ev.type === 'damage') {
        expect(ev.sourceId, `事件 ${ev.type} 源/目标同一单位`).not.toBe(ev.targetId);
      }
    }
    // 双方同名单位都真实出手 / 造成伤害（若 id 串味，蓝队副本会被并进红队的统计）
    const myDupe = report.stats.find((s) => s.unitId === 'mirror');
    const enDupe = report.stats.find((s) => s.unitId === 'mirror#2');
    expect(myDupe?.side).toBe('my');
    expect(enDupe?.side).toBe('enemy');
    expect((myDupe?.attackCount ?? 0) + (myDupe?.skillCount ?? 0)).toBeGreaterThan(0);
    expect((enDupe?.attackCount ?? 0) + (enDupe?.skillCount ?? 0)).toBeGreaterThan(0);
  });

  it('镜像对局与「预先手工改写 id」的控制组逐事件一致（去重不改战斗逻辑）', () => {
    const dup = runBattle(mirrorConfig());
    const cfg = mirrorConfig();
    const ctrl = runBattle({
      ...cfg,
      enemyTeam: [{ ...cfg.enemyTeam[0], id: 'mirror#2' }, cfg.enemyTeam[1]],
    });
    expect(dup.events).toEqual(ctrl.events);
    expect(dup.stats).toEqual(ctrl.stats);
    expect(dup.finalMyTroops).toEqual(ctrl.finalMyTroops);
    expect(dup.finalEnemyTroops).toEqual(ctrl.finalEnemyTroops);
  });

  it('报告里的队伍可直接再次开打（已唯一 → 幂等，不再叠后缀）', () => {
    const first = runBattle(mirrorConfig());
    const second = runBattle({ myTeam: first.myTeam, enemyTeam: first.enemyTeam, seed: 424242, maxRounds: 3 });
    expect(second.myTeam.map((g) => g.id)).toEqual(first.myTeam.map((g) => g.id));
    expect(second.enemyTeam.map((g) => g.id)).toEqual(first.enemyTeam.map((g) => g.id));
    expect(second.enemyTeam[0].heroId).toBe('mirror');
    expect(second.events).toEqual(first.events);
  });
});
