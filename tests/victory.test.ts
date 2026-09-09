/**
 * 胜利规则测试（斩首制）：一侧大营阵亡即失败，而非全部阵亡
 *  - 敌方大营被击杀、前锋/中军仍存活 → 判 win 且战斗提前结束
 *  - 我方大营被击杀、其余仍存活 → 判 loss
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

function g(id: string, position: '前锋' | '中军' | '大营', opts: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'archer',
    position,
    attack: 60,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 4,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...opts,
  };
}

describe('斩首制胜利规则', () => {
  it('敌方大营被击杀、前锋中军仍存活 → 判 win 且提前结束', () => {
    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      myTeam: [
        g('tank', '前锋', { defense: 200 }),
        g('zhouyu', '中军', { strategy: 180, speed: 60, activeSkillIds: ['xuanwu_fuliu'] }),
      ],
      enemyTeam: [
        g('ef', '前锋', { attackRange: 1 }),
        g('em', '中军', { attackRange: 1 }),
        g('eb', '大营', { maxTroops: 300, defense: 40, attackRange: 1 }),
      ],
    });

    expect(report.result).toBe('win');
    // 大营阵亡，但前锋/中军仍存活
    expect(report.finalEnemyTroops[2]).toBe(0);
    expect(report.finalEnemyTroops[0]).toBeGreaterThan(0);
    expect(report.finalEnemyTroops[1]).toBeGreaterThan(0);
    // 大营阵亡后战斗立即结束（未跑满 8 回合）
    const roundStarts = report.events.filter((e) => e.type === 'round_start').length;
    expect(roundStarts).toBeLessThan(report.maxRounds);
    // 阵亡事件发生在 battle_end 之前
    const deadIdx = report.events.findIndex((e) => e.type === 'unit_dead' && e.unitId === 'eb');
    const endIdx = report.events.findIndex((e) => e.type === 'battle_end');
    expect(deadIdx).toBeGreaterThan(-1);
    expect(deadIdx).toBeLessThan(endIdx);
  });

  it('我方大营被击杀、其余仍存活 → 判 loss', () => {
    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      // 镜像：我方可被玄武击杀的低血大营
      enemyTeam: [
        g('et', '前锋', { defense: 200 }),
        g('ez', '中军', { strategy: 180, speed: 60, activeSkillIds: ['xuanwu_fuliu'] }),
      ],
      myTeam: [
        g('mf', '前锋', { attackRange: 1 }),
        g('mm', '中军', { attackRange: 1 }),
        g('mb', '大营', { maxTroops: 300, defense: 40, attackRange: 1 }),
      ],
    });

    expect(report.result).toBe('loss');
    expect(report.finalMyTroops[2]).toBe(0);
    expect(report.finalMyTroops[0]).toBeGreaterThan(0);
    expect(report.finalMyTroops[1]).toBeGreaterThan(0);
  });

  it('双方大营 8 回合都存活 → 平局', () => {
    const report = runBattle({
      seed: 10008,
      maxRounds: 8,
      myTeam: [
        g('mf', '前锋', { defense: 200 }),
        g('mm', '中军', { defense: 200 }),
        g('mb', '大营', { defense: 200 }),
      ],
      enemyTeam: [
        g('ef', '前锋', { attackRange: 1 }),
        g('em', '中军', { attackRange: 1 }),
        g('eb', '大营', { attackRange: 1 }),
      ],
    });

    expect(report.result).toBe('draw');
    expect(report.finalMyTroops[2]).toBeGreaterThan(0);
    expect(report.finalEnemyTroops[2]).toBeGreaterThan(0);
  });
});
