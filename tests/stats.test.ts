/**
 * 战斗统计测试（v0.3）：验证 computeStats 的计数口径
 *  - 普攻次数 = attack_hit 数，普攻伤害 = 其 damage 之和
 *  - 战法次数 = skill_cast 数，战法伤害 = damage 事件（skillId 非空）之和
 *  - 规避免疫的伤害不进入任何统计
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { computeStats } from '../src/engine/stats';
import { buildAllFixtures } from './fixtures';
import { initHeroDB } from '../src/data/heroes';

let ALL: Record<string, import('../src/engine/types').BattleConfig>;

beforeAll(async () => {
  await initHeroDB();
  ALL = buildAllFixtures();
});

const T6 = () => ALL.T6_WU_TRIO;

describe('战斗统计', () => {
  it('T6：统计事件数与伤害之和自洽', () => {
    const report = runBattle(T6());

    // 事件流逐项核对
    let attackHits = 0;
    let attackDamage = 0;
    let skillCasts = 0;
    let skillDamage = 0;
    const castById = new Map<string, number>();
    for (const ev of report.events) {
      if (ev.type === 'attack_hit') {
        attackHits += 1;
        attackDamage += ev.damage;
      } else if (ev.type === 'skill_cast') {
        skillCasts += 1;
        castById.set(ev.unitId, (castById.get(ev.unitId) ?? 0) + 1);
      } else if (ev.type === 'damage' && ev.skillId) {
        skillDamage += ev.damage;
      }
    }

    expect(attackHits).toBeGreaterThan(0);
    expect(skillCasts).toBeGreaterThan(0);
    expect(skillDamage).toBeGreaterThan(0);

    const total = report.stats.reduce(
      (acc, s) => acc + s.attackCount + s.skillCount,
      0
    );
    expect(total).toBe(attackHits + skillCasts);

    const totalDamage = report.stats.reduce(
      (acc, s) => acc + s.attackDamage + s.skillDamage,
      0
    );
    expect(totalDamage).toBe(attackDamage + skillDamage);
  });

  it('孙权九锡黄龙计入战法次数但不计战法伤害', () => {
    const report = runBattle(T6());
    const sunquan = report.stats.find((s) => s.unitId === 'sunquan');
    expect(sunquan).toBeDefined();
    expect(sunquan!.skillCount).toBeGreaterThan(0);
    expect(sunquan!.skillDamage).toBe(0);
  });

  it('追击战法（方阵突击）计入战法统计', () => {
    const report = runBattle(T6());
    const tsc = report.stats.find((s) => s.unitId === 'taishici');
    expect(tsc).toBeDefined();
    expect(tsc!.skillCount).toBeGreaterThan(0);
    expect(tsc!.skillDamage).toBeGreaterThan(0);
  });
});
