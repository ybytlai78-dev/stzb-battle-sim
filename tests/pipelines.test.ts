/**
 * 指挥/被动管线测试（v0.3）：验证 T7 装配战法的机制生效
 *  - 指挥战法准备阶段触发一次（先驱突击→连击、战必断金→怯战全体）
 *  - 被动战法每回合开始触发（步步为营→防御增益、青囊密要→治疗）
 *  - 连击：每回 2 次普攻；多追击：每次普攻后逐个追击战法判定
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleConfig, General } from '../src/engine/types';
import { buildAllFixtures } from './fixtures';
import { initHeroDB } from '../src/data/heroes';

let ALL: Record<string, BattleConfig>;

beforeAll(async () => {
  await initHeroDB();
  ALL = buildAllFixtures();
});

const T7 = () => ALL.T7_LOADOUT;

function eventsOf(report: ReturnType<typeof runBattle>, type: string) {
  return report.events.filter((e) => e.type === type);
}

describe('指挥/被动管线（T7）', () => {
  it('指挥战法在准备阶段触发一次', () => {
    const report = runBattle(T7());
    const prepareIdx = report.events.findIndex((e) => e.type === 'preparation_end');
    const rounds = report.events.filter((e) => e.type === 'round_start').length;

    // 先驱突击（taishici 释放）只应在准备阶段出现一次
    const xianqu = report.events.filter(
      (e) => e.type === 'skill_cast' && e.skillName === '先驱突击'
    );
    expect(xianqu.length).toBe(1);
    expect(report.events.indexOf(xianqu[0])).toBeLessThan(prepareIdx);

    // 战必断金是「锁定目标 + 每回合 roundRepeat 判定」指挥预备战法：
    // 准备阶段锁定敌军群体2目标并施加首次怯战，第 2、3 回合对锁定目标各判定一次
    const zhanbi = report.events.filter(
      (e) => e.type === 'skill_cast' && e.skillName === '战必断金'
    );
    // 首次 cast 发生在准备阶段（锁定目标）
    expect(report.events.indexOf(zhanbi[0])).toBeLessThan(prepareIdx);
    // 至多 3 次：准备阶段 + 第 2、3 回合
    expect(zhanbi.length).toBeLessThanOrEqual(3);
  });

  it('连击使每回普攻次数翻倍（仅前 3 回合）', () => {
    const report = runBattle(T7());
    const taishici = report.stats.find((s) => s.unitId === 'taishici');
    // 前 3 回合连击 2 次普攻，后 5 回合 1 次：3×2 + 5×1 = 11
    expect(taishici!.attackCount).toBe(11);
  });

  it('多追击：方阵突击 + 温酒斩将各自触发多次', () => {
    const report = runBattle(T7());
    const fz = eventsOf(report, 'skill_cast').filter((e) => 'skillName' in e && e.skillName === '方阵突击');
    const wj = eventsOf(report, 'skill_cast').filter((e) => 'skillName' in e && e.skillName === '温酒斩将');
    expect(fz.length).toBeGreaterThan(0);
    expect(wj.length).toBeGreaterThan(0);
    // 太史慈战法次数 = 先驱突击×1 + 两追击之和
    const taishici = report.stats.find((s) => s.unitId === 'taishici');
    expect(fz.length + wj.length).toBe(taishici!.skillCount - 1);
  });

  it('被动战法在武将行动时触发（步步为营×8 + 青囊密要×8）', () => {
    const report = runBattle(T7());
    const passivePhase = eventsOf(report, 'unit_act_start').filter(
      (e) => 'phase' in e && e.phase === 'passive_skill' && e.unitId === 'sunquan'
    );
    // 被动已改为武将行动阶段触发（不在准备阶段）：8 回合 × 2 个被动
    expect(passivePhase.length).toBe(16); // 8 回合 × 2 个被动
  });

  it('青囊密要在受伤后能恢复兵力', () => {
    // 孙权放前锋会被木桩前锋普攻打中，受伤后青囊密要（回合开始）应恢复兵力
    const sunquanFront: General = {
      ...T7().myTeam[2],
      id: 'sunquan',
      position: '前锋',
      passiveSkillIds: ['qingnang_miyao'],
      commandSkillIds: [],
      activeSkillIds: [],
    };
    const enemyFront: General = {
      ...T7().enemyTeam[0],
      attack: 150,
      attackRange: 2,
    };
    const config: BattleConfig = {
      seed: 70001,
      maxRounds: 8,
      myTeam: [sunquanFront],
      enemyTeam: [enemyFront],
    };
    const report = runBattle(config);
    const heals = report.events.filter(
      (e): e is Extract<(typeof report.events)[number], { type: 'heal' }> =>
        e.type === 'heal' && e.targetId === 'sunquan'
    );
    expect(heals.length).toBeGreaterThan(0);
    // 治疗量应为正
    for (const h of heals) {
      expect(h.amount).toBeGreaterThan(0);
    }
  });
});
