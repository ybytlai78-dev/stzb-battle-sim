// @vitest-environment jsdom
/**
 * 「增减伤统计」弹窗口径（用户 2026-10-21 报障）：
 *   90% 的下限保护作用在**增减伤总和**上，不是「减伤」这一栏 —— 减伤本身可以过 100%，
 *   弹窗必须照实列出（本例提升 28% / 降低 117%），净合计那一行才显示受保护的生效值（降低 89%）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createBattleView } from '../web/battleView';
import { HUGE_MODIFIER_RATE } from '../src/engine/formulas';
import type { BattleEvent, BattleReport, DamageModifiers, General } from '../src/engine/types';

function makeGeneral(id: string, name: string, position: General['position']): General {
  return {
    id,
    name,
    rarity: '5星',
    cost: 3,
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 100,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '测试战法',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  };
}

/** 提升 5% + 23% = 28%；降低 35% + 46% + 30% + 6% = 117% ⇒ 净 −89%（未触下限） */
const MODS_NORMAL: DamageModifiers = {
  caused: [{ unitId: 'enemy1', skillId: 'treasure', skillName: 'treasure:1051:2', rate: 0.05, direction: 'caused' }],
  taken: [{ unitId: 'enemy1', skillId: 'troop_trait', skillName: '兵种特性', rate: 0.23, direction: 'taken' }],
  reduce: [
    { unitId: 'my1', skillId: 'bairi', skillName: '白刃', rate: 0.35, direction: 'reduce' },
    { unitId: 'my1', skillId: 'mouyi', skillName: '谋议宏图', rate: 0.46, direction: 'reduce' },
    { unitId: 'my2', skillId: 'restraint', skillName: '兵种克制', rate: 0.3, direction: 'reduce' },
    { unitId: 'my2', skillId: 'troop_trait', skillName: '兵种特性', rate: 0.06, direction: 'reduce' },
  ],
};

/** 降低 200% ⇒ 净 −200%，触到 10% 伤害下限（实际按 90% 计） */
const MODS_OVERFLOW: DamageModifiers = {
  caused: [],
  taken: [],
  reduce: [
    { unitId: 'my1', skillId: 'a', skillName: '甲', rate: 1.2, direction: 'reduce' },
    { unitId: 'my2', skillId: 'b', skillName: '乙', rate: 0.8, direction: 'reduce' },
  ],
};

/**
 * 战法文案「大幅度降低」= 哨兵 `HUGE_MODIFIER_RATE`（1000%，磐阵善守 / 西乡武功 / 息交2 / 辕门射戟）：
 * 账面 1000% 只是哨兵，界面既不露这个数字，也不能退化成 90% 那种「能被增伤抵掉」的数值。
 */
const MODS_HUGE: DamageModifiers = {
  caused: [],
  taken: [],
  reduce: [
    { unitId: 'my1', skillId: 'panzhen_shanshou', skillName: '磐阵善守', rate: HUGE_MODIFIER_RATE, direction: 'reduce' },
    { unitId: 'my1', skillId: 'mouyi', skillName: '谋议宏图', rate: 0.46, direction: 'reduce' },
  ],
};

function makeReport(mods: DamageModifiers): BattleReport {
  const my1 = makeGeneral('my1', '红将甲', '大营');
  const my2 = makeGeneral('my2', '红将乙', '中军');
  const enemy1 = makeGeneral('enemy1', '蓝将甲', '大营');
  const enemy2 = makeGeneral('enemy2', '蓝将乙', '中军');

  const events: BattleEvent[] = [
    { type: 'battle_start', turnOrder: ['my1', 'my2', 'enemy1', 'enemy2'], seed: 1 },
    { type: 'prep_phase', phase: 'formation' },
    { type: 'prep_phase', phase: 'troop' },
    { type: 'prep_phase', phase: 'skill' },
    { type: 'preparation_end' },
    { type: 'round_start', round: 1, turnOrder: ['my1', 'my2', 'enemy1', 'enemy2'] },
    { type: 'unit_act_start', unitId: 'enemy1', name: '蓝将甲', position: '大营', phase: 'basic_attack' },
    {
      type: 'damage',
      sourceId: 'enemy1',
      targetId: 'my1',
      skillId: 'basic_attack',
      skillName: '普通攻击',
      damageType: 'physical',
      damage: 100,
      afterTroops: 8900,
      breakdown: { troopBase: 40, base: 30, main: 30 },
      modifiers: mods,
    },
    { type: 'unit_act_end', unitId: 'enemy1' },
    {
      type: 'round_end',
      round: 1,
      myTroops: [8900, 9000],
      enemyTroops: [9000, 9000],
      myWounded: [0, 0],
      enemyWounded: [0, 0],
      myDead: [0, 0],
      enemyDead: [0, 0],
    },
    {
      type: 'battle_end',
      result: 'draw',
      rounds: 1,
      myTroops: [8900, 9000],
      enemyTroops: [9000, 9000],
    },
  ];

  return {
    schemaVersion: '1.0',
    seed: 1,
    maxRounds: 1,
    result: 'draw',
    rounds: 1,
    myTeam: [my1, my2],
    enemyTeam: [enemy1, enemy2],
    finalMyTroops: [8900, 9000],
    finalEnemyTroops: [9000, 9000],
    finalMyWounded: [0, 0],
    finalEnemyWounded: [0, 0],
    finalMyDead: [0, 0],
    finalEnemyDead: [0, 0],
    events,
    stats: [],
  } as BattleReport;
}

function openPopup(mods: DamageModifiers): { netLine: string; popupText: string } {
  const view = createBattleView(makeReport(mods));
  document.body.append(view.el);
  view.setRound(1);

  const netLine = view.el.querySelector('.dmg-mod')?.textContent ?? '';
  const link = view.el.querySelector('.dmg-mod .dmg-link') as HTMLElement | null;
  expect(link).toBeTruthy();
  link!.click();

  const popupText = view.el.querySelector('.dmg-popup')?.textContent ?? '';
  return { netLine, popupText };
}

describe('详细战报 · 增减伤统计弹窗', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('降低合计照实显示（可过 100%），净合计才受 90% 下限保护', () => {
    const { netLine, popupText } = openPopup(MODS_NORMAL);

    // 净合计行：28 − 117 = −89
    expect(netLine).toContain('此次伤害共计降低');
    expect(netLine).toContain('89%');

    // 弹窗：两栏都是账面真值，降低不被裁到 90%
    expect(popupText).toContain('伤害提升合计：28%');
    expect(popupText).toContain('伤害降低合计：117%');
    expect(popupText).not.toContain('伤害降低合计：90%');

    // 明细逐条照实（46% 这类不再被吞成「大幅降低」）
    expect(popupText).toContain('【谋议宏图】伤害降低 46%');
    expect(popupText).toContain('【白刃】伤害降低 35%');

    // 底部净合计：真实账面 −89%
    expect(popupText).toContain('净合计：降低 89%');
  });

  it('净降低超过 90% 时，净合计行注明按 90% 生效（下限只作用在总和上）', () => {
    const { netLine, popupText } = openPopup(MODS_OVERFLOW);

    // 界面行显示受保护的生效值
    expect(netLine).toContain('90%');
    // 弹窗仍照实列 200%
    expect(popupText).toContain('伤害降低合计：200%');
    expect(popupText).toContain('净合计：降低 200%');
    expect(popupText).toContain('已触伤害下限保护');
  });

  it('「大幅度降低」的哨兵值（1000%）界面不露账面数字，一律「大幅降低」', () => {
    const { netLine, popupText } = openPopup(MODS_HUGE);

    // 明细条目：文案本来就是「大幅度降低」，账面 1000% 只是哨兵，不出现在玩家视野
    expect(popupText).toContain('【磐阵善守】伤害大幅降低');
    expect(popupText).not.toContain('1000%');

    // 同一栏里的普通减伤照实显示（不被「大幅」吞掉）
    expect(popupText).toContain('【谋议宏图】伤害降低 46%');

    // 降低合计整栏也是「大幅降低」，净合计行同样注明触底按 90% 结算
    expect(popupText).toContain('伤害降低合计：大幅降低');
    expect(popupText).toContain('净合计：大幅降低（已触伤害下限保护');
    expect(netLine).toContain('90%');
  });
});
