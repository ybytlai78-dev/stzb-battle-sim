/**
 * 指挥/被动管线测试（v0.3）：验证 T7 装配战法的机制生效
 *  - 指挥战法准备阶段触发一次（先驱突击→连击、战必断金→怯战全体）
 *  - 被动战法每回合开始触发（步步为营→防御增益、青囊密要→治疗）
 *  - 连击：每回 2 次普攻；多追击：每次普攻后逐个追击战法判定
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleConfig, BattleEvent, General, Position } from '../src/engine/types';
import { buildAllFixtures } from './fixtures';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { roundRate, scaledValue } from '../src/engine/formulas';

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

/** 测试用木桩武将（默谋略 80，便于断言受谋略缩放） */
function dummy(id: string, position: Position, extras: Partial<General> = {}): General {
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
    strategy: 80,
    speed: 20,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extras,
  };
}

/** 三名低速木桩敌军，避免抢准备阶段出手序 */
function enemyDummies(): General[] {
  return [dummy('ef', '前锋', { speed: 1 }), dummy('em', '中军', { speed: 1 }), dummy('eb', '大营', { speed: 1 })];
}

/**
 * 取出准备阶段【战法】事件（`prep_phase skill` 之后、`preparation_end` 之前）。
 * @param report 完整战报
 */
function skillPhaseEvents(report: ReturnType<typeof runBattle>): BattleEvent[] {
  const start = report.events.findIndex((e) => e.type === 'prep_phase' && e.phase === 'skill');
  const end = report.events.findIndex((e) => e.type === 'preparation_end');
  return report.events.slice(start + 1, end);
}

describe('准备阶段【战法】：先全部被动再全部指挥', () => {
  it('卫瓘携带百战精兵：战法阶段先加属性，再释放持节镇西', () => {
    const weiguan = withSkills(level40(HERO_REGISTRY.weiguan), {
      passiveSkillIds: ['baizhan_jingbing'],
    });
    weiguan.position = '中军';
    const report = runBattle({
      seed: 1,
      maxRounds: 1,
      myTeam: [weiguan, dummy('ally-back', '大营', { speed: 10 })],
      enemyTeam: enemyDummies(),
    });
    const phase = skillPhaseEvents(report);
    const baizhan = phase.findIndex((e) => e.type === 'skill_cast' && e.skillName === '百战精兵');
    const chijie = phase.findIndex((e) => e.type === 'skill_cast' && e.skillName === '持节镇西');
    expect(baizhan).toBeGreaterThan(-1);
    expect(chijie).toBeGreaterThan(-1);
    expect(baizhan).toBeLessThan(chijie);
    const stratBuff = phase.findIndex(
      (e) => e.type === 'status_inflicted' && e.statusType === 'strategy_buff' && e.unitId === weiguan.id
    );
    expect(stratBuff).toBeGreaterThan(-1);
    expect(stratBuff).toBeLessThan(chijie);
  });

  it('全场 battle_start 被动均早于一类指挥（快将指挥 vs 慢将被动）', () => {
    const report = runBattle({
      seed: 1,
      maxRounds: 1,
      myTeam: [
        dummy('fast-cmd', '前锋', { speed: 200, commandSkillIds: ['xianqu_tuji'] }),
        dummy('slow-psv', '中军', { speed: 30, passiveSkillIds: ['baizhan_jingbing'] }),
        dummy('back', '大营', { speed: 10 }),
      ],
      enemyTeam: enemyDummies(),
    });
    const phase = skillPhaseEvents(report);
    const lastPassive = phase.reduce(
      (idx, e, i) => (e.type === 'unit_act_start' && e.phase === 'passive_skill' ? i : idx),
      -1
    );
    const firstCommand = phase.findIndex((e) => e.type === 'unit_act_start' && e.phase === 'command_skill');
    expect(lastPassive).toBeGreaterThan(-1);
    expect(firstCommand).toBeGreaterThan(-1);
    expect(lastPassive).toBeLessThan(firstCommand);
  });

  it('指挥受谋略缩放读到百战精兵已加的谋略（大赏三军）', () => {
    const carrier = dummy('carrier', '前锋', {
      strategy: 80,
      speed: 50,
      faction: '群',
      troopType: 'cavalry',
      commandSkillIds: ['dashang_sanjun'],
      passiveSkillIds: ['baizhan_jingbing'],
    });
    const report = runBattle({
      seed: 1,
      maxRounds: 1,
      myTeam: [
        carrier,
        dummy('ally-mid', '中军', { speed: 20, faction: '蜀', troopType: 'archer' }),
        dummy('ally-back', '大营', { speed: 10, faction: '魏', troopType: 'infantry' }),
      ],
      enemyTeam: [
        dummy('ef', '前锋', { speed: 1, faction: '吴', troopType: 'cavalry' }),
        dummy('em', '中军', { speed: 1, faction: '汉', troopType: 'archer' }),
        dummy('eb', '大营', { speed: 1, faction: '晋', troopType: 'infantry' }),
      ],
    });
    const phase = skillPhaseEvents(report);
    const boosts = phase.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_boost'
    );
    expect(boosts.length).toBeGreaterThan(0);
    // 谋略 80+32=112 → roundRate(30 + 0.15×32) = 34%
    const expected = roundRate(scaledValue(30, 0.15, 80 + 32));
    expect(boosts[0].detail).toContain(`造成的伤害提高 ${expected}%`);
  });
});
