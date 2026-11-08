/**
 * 准备阶段「改速度的来源」必须全部进入出手排序（用户 2026-11-06 报障）
 *
 * 现场：卫瓘 40 级面板 82 速、吕蒙 88 速。卫瓘佩戴「灵动」锻造词条 +30 速（`TreasureLoadout.affix`）后
 * 有效速度 112，已快过吕蒙，但战报里「战斗开始前」仍是吕蒙先放一类指挥 —— 因为 `combat.ts` 先
 * `buildTurnOrder` 再 `applyTreasureEffects`，准备阶段按不含宝物的顺序遍历；正式回合每回合按生效速度
 * 重排，于是同一场战斗出现两套顺序。同一个根因还有第二处：`battle_start` 被动也会给自身加速度
 * （百战精兵 +32、速战兵法 +28、疾风突击 / 运筹帷幄 / 速战坚守 +24），它们同样在排序之后施加。
 *
 * 修复口径：`refreshTurnOrder()` 在**每一个**改速度的环节之后重算一次 ——
 * ① 宝物 / 陈寿状态挂载完成、进入 `prep_phase: 'skill'` 之前；② 全部 `battle_start` 被动跑完、一类指挥之前。
 * 施加顺序（`applyOrder`）保持不变：冲突判定「先施加者生效」与 `prep_phase` 事件顺序都不许被这次修复挪动。
 *
 * 反例守卫：① 不戴宝物、不带速度被动时吕蒙先（顺序差异确实来自这些来源，不是被无条件反转）；
 * ② `prep_phase` 顺序不变（formation → troop → treasure → skill）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';
import type { BattleEvent, General, Position } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

/** 抄自 `tests/turn_order.test.ts`：木桩单位，速度远低于真实将，不干扰两队之间的排序 */
function dummy(id: string, position: Position, speed = 10): General {
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
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

/**
 * 卫瓘（中军）+ 吕蒙（大营）同队：两者主战法都是一类指挥，准备阶段各出手一次。
 * `configure` 用于给卫瓘挂速度来源（宝物 / 被动战法），可返回新对象（`withSkills`）。
 */
function buildTeams(configure?: (weiguan: General) => General) {
  let weiguan = level40({ ...HERO_REGISTRY.weiguan }) as General;
  weiguan.position = '中军';
  if (configure) weiguan = configure(weiguan);
  const lvmeng = level40({ ...HERO_REGISTRY.lvmeng }) as General;
  lvmeng.position = '大营';
  return {
    weiguan,
    lvmeng,
    myTeam: [weiguan, dummy('w_front', '前锋'), lvmeng],
    enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
  };
}

/** 准备阶段（preparation_end 之前）一类指挥的出手顺序（`triggerCommandSkills` 发 phase: 'command_skill'） */
function prepCommandOrder(events: BattleEvent[]): string[] {
  const end = events.findIndex((e) => e.type === 'preparation_end');
  return events
    .slice(0, end < 0 ? undefined : end)
    .filter(
      (e): e is Extract<BattleEvent, { type: 'unit_act_start' }> =>
        e.type === 'unit_act_start' && e.phase === 'command_skill',
    )
    .map((e) => e.unitId);
}

const roundOneOrder = (events: BattleEvent[]): string[] =>
  events.find(
    (e): e is Extract<BattleEvent, { type: 'round_start' }> => e.type === 'round_start' && e.round === 1,
  )?.turnOrder ?? [];

const prepPhases = (events: BattleEvent[]): string[] =>
  events
    .filter((e): e is Extract<BattleEvent, { type: 'prep_phase' }> => e.type === 'prep_phase')
    .map((e) => e.phase);

describe('准备阶段改速度的来源进入出手排序', () => {
  it('宝物 +30 速（灵动词条）：准备阶段一类指挥卫瓘先，且与第 1 回合顺序一致', () => {
    const { weiguan, lvmeng, myTeam, enemyTeam } = buildTeams((w) => {
      w.treasure = { treasureId: 1057, level: 10, affix: { name: '灵动', value: 30 } };
      return w;
    });
    // 前提：面板速度吕蒙更快，只靠 +30 速才反超
    expect(weiguan.speed).toBeLessThan(lvmeng.speed);

    const report = runBattle({ seed: 7, maxRounds: 2, myTeam, enemyTeam });

    expect(prepCommandOrder(report.events)).toEqual(['weiguan', 'lvmeng']);
    const r1 = roundOneOrder(report.events);
    expect(r1.indexOf('weiguan')).toBeLessThan(r1.indexOf('lvmeng'));
    // battle_start 的顺序必须与准备阶段实际出手顺序同源（修复它曾被第 1 回合回填成"正确"值而掩盖）
    const bs = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'battle_start' }> => e.type === 'battle_start',
    );
    expect(bs?.turnOrder.indexOf('weiguan')).toBeLessThan(bs?.turnOrder.indexOf('lvmeng') ?? -1);
  });

  it('battle_start 被动 +32 速（百战精兵）：同一根因，准备阶段同样卫瓘先', () => {
    const { weiguan, lvmeng, myTeam, enemyTeam } = buildTeams(
      (w) => withSkills(w, { passiveSkillIds: ['baizhan_jingbing'] }) as General,
    );
    expect(weiguan.speed).toBeLessThan(lvmeng.speed);

    const report = runBattle({ seed: 7, maxRounds: 2, myTeam, enemyTeam });

    expect(prepCommandOrder(report.events)).toEqual(['weiguan', 'lvmeng']);
    const r1 = roundOneOrder(report.events);
    expect(r1.indexOf('weiguan')).toBeLessThan(r1.indexOf('lvmeng'));
  });

  it('两个来源都不挂时吕蒙先 —— 反超来自速度来源，不是顺序被无条件反转', () => {
    const { weiguan, lvmeng, myTeam, enemyTeam } = buildTeams();
    expect(weiguan.speed).toBeLessThan(lvmeng.speed);

    const report = runBattle({ seed: 7, maxRounds: 2, myTeam, enemyTeam });
    expect(prepCommandOrder(report.events)).toEqual(['lvmeng', 'weiguan']);
  });

  it('prep_phase 顺序：facility → formation → troop → treasure → skill（设施最前、宝物仍在战法阶段之前）', () => {
    const { myTeam, enemyTeam } = buildTeams((w) => {
      w.treasure = { treasureId: 1057, level: 10, affix: { name: '灵动', value: 30 } };
      return w;
    });
    const report = runBattle({ seed: 7, maxRounds: 1, myTeam, enemyTeam });
    expect(prepPhases(report.events)).toEqual(['facility', 'formation', 'troop', 'treasure', 'skill']);
  });

  it('一类指挥自身改速度（其疾如风 +41 我军全体）：执行完立即重排剩余，不再与第 1 回合分叉', () => {
    // 张辽 211 先手；吕蒙加到 100；卫瓘 82 —— 重排二时顺序是 张辽 > 吕蒙 > 卫瓘。
    // 其疾如风把卫瓘抬到 123，理想顺序应为 张辽 > 卫瓘 > 吕蒙；若不逐个重排，卫瓘会被留在最后。
    const zhangliao = level40({ ...HERO_REGISTRY.h27 }) as General;
    zhangliao.position = '大营';
    const weiguan = level40({ ...HERO_REGISTRY.weiguan }) as General;
    weiguan.position = '中军';
    const lvmeng = level40({ ...HERO_REGISTRY.lvmeng }, { speed: 12 }) as General;
    lvmeng.position = '中军';
    expect(weiguan.speed).toBeLessThan(lvmeng.speed);

    const report = runBattle({
      seed: 7,
      maxRounds: 1,
      myTeam: [dummy('w_front', '前锋'), weiguan, zhangliao],
      enemyTeam: [dummy('e1', '前锋'), lvmeng, dummy('e3', '大营')],
    });

    const prep = prepCommandOrder(report.events);
    expect(prep).toEqual(['h27', 'weiguan', 'lvmeng']);
    const r1 = roundOneOrder(report.events);
    expect(r1.filter((id) => prep.includes(id))).toEqual(prep);
  });
});
