// @vitest-environment jsdom
/**
 * 网页详细战报的「回合前阶段」结构回归（用户 2026-10-19 三条渲染口径）：
 *   ① 准备阶段按 阵营加成 / 称号加成 / 兵种加成 / 兵种特性加成 四段出标题；
 *   ② 每回合行动前的事件单独挂「回合前阶段」标题，不再混进第一位行动武将的行动组；
 *   ③ 武将名分色：红方（我方）红字、蓝方（敌方）绿字；
 *   ④ 出手顺序不在战报里重复展示（用户 2026-10-19 追加）。
 *
 * 用合成 BattleReport 钉结构，不依赖引擎随机（真实战报的文案口径仍由其它测试守）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createBattleView } from '../web/battleView';
import type { BattleEvent, BattleReport, General } from '../src/engine/types';

function makeGeneral(
  id: string,
  name: string,
  position: General['position'],
  extra: Partial<General> = {}
): General {
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
    ...extra,
  };
}

function makeReport(withPreRoundEvents: boolean): BattleReport {
  const my1 = makeGeneral('my1', '红将甲', '大营', {
    secondaryTroop: '重骑兵',
    secondaryTraits: ['扰后'],
  });
  const my2 = makeGeneral('my2', '红将乙', '中军');
  const enemy1 = makeGeneral('enemy1', '蓝将甲', '大营', { secondaryTroop: '长弓兵' });
  const enemy2 = makeGeneral('enemy2', '蓝将乙', '中军');

  const preRound: BattleEvent[] = withPreRoundEvents
    ? [
        {
          type: 'status_inflicted',
          unitId: 'my1',
          statusType: 'attack_buff',
          detail: '【红将甲】执行来自【红将甲】的【测试战法】效果！',
        },
        {
          type: 'status_inflicted',
          unitId: 'enemy1',
          statusType: 'defense_buff',
          detail: '【蓝将甲】的防御属性提高了10%',
        },
      ]
    : [];

  const events: BattleEvent[] = [
    { type: 'battle_start', turnOrder: ['my1', 'my2', 'enemy1', 'enemy2'], seed: 1 },
    { type: 'prep_phase', phase: 'formation' },
    {
      type: 'formation_bonus',
      unitId: 'my1',
      unitName: '红将甲',
      category: 'faction',
      bonuses: { attack: 10, defense: 8, strategy: 0, speed: 0 },
    },
    {
      type: 'formation_bonus',
      unitId: 'my1',
      unitName: '红将甲',
      category: 'title',
      titleName: '魏之智',
      bonuses: { attack: 0, defense: 0, strategy: 32, speed: 0 },
    },
    {
      type: 'formation_bonus',
      unitId: 'my1',
      unitName: '红将甲',
      category: 'troop',
      bonuses: { attack: 5, defense: 0, strategy: 0, speed: 5 },
    },
    {
      type: 'formation_bonus',
      unitId: 'my2',
      unitName: '红将乙',
      category: 'faction',
      bonuses: { attack: 0, defense: 0, strategy: 0, speed: 4 },
    },
    {
      type: 'formation_bonus',
      unitId: 'enemy1',
      unitName: '蓝将甲',
      category: 'faction',
      bonuses: { attack: 9, defense: 0, strategy: 0, speed: 0 },
    },
    {
      type: 'formation_bonus',
      unitId: 'enemy2',
      unitName: '蓝将乙',
      category: 'faction',
      bonuses: { attack: 0, defense: 0, strategy: 0, speed: 2 },
    },
    { type: 'prep_phase', phase: 'troop' },
    { type: 'prep_phase', phase: 'skill' },
    { type: 'preparation_end' },
    { type: 'round_start', round: 1, turnOrder: ['my1', 'my2', 'enemy1', 'enemy2'] },
    ...preRound,
    { type: 'unit_act_start', unitId: 'my1', name: '红将甲', position: '大营', phase: 'active_skill' },
    { type: 'skill_cast', unitId: 'my1', skillId: 'test', skillName: '测试战法' },
    { type: 'unit_act_end', unitId: 'my1' },
    {
      type: 'round_end',
      round: 1,
      myTroops: [9000, 9000],
      enemyTroops: [8900, 9000],
      myWounded: [0, 0],
      enemyWounded: [0, 0],
      myDead: [0, 0],
      enemyDead: [0, 0],
    },
    {
      type: 'battle_end',
      result: 'draw',
      rounds: 1,
      myTroops: [9000, 9000],
      enemyTroops: [8900, 9000],
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
    finalMyTroops: [9000, 9000],
    finalEnemyTroops: [8900, 9000],
    finalMyWounded: [0, 0],
    finalEnemyWounded: [0, 0],
    finalMyDead: [0, 0],
    finalEnemyDead: [0, 0],
    events,
    stats: [],
  };
}

function mount(withPreRoundEvents: boolean) {
  const view = createBattleView(makeReport(withPreRoundEvents));
  document.body.append(view.el);
  return view;
}

describe('详细战报 · 回合前阶段标题与武将名分色', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('准备阶段：四段加成各自成标题，兵种特性列出专属 / 通用特性', () => {
    const view = mount(false);
    view.setRound(0);

    const phases = [...view.el.querySelectorAll('.es-phase')].map((el) => el.textContent);
    expect(phases).toEqual([
      '【阵容】',
      '【阵营加成】',
      '【称号加成】',
      '【兵种加成】',
      '【兵种特性加成】',
      '【战法】',
    ]);

    // formatBonusText 以两个空格分隔不同属性（引擎文本战报口径），断言前统一空白
    const text = (view.el.textContent ?? '').replace(/\s+/g, ' ');
    // 出手顺序不在战报里重复展示（用户 2026-10-19 口径）
    expect(text).not.toContain('出手顺序');
    expect(text).toContain('红将甲 攻击+10 防御+8');
    expect(text).toContain('红将甲 「魏之智」：谋略+32');
    expect(text).toContain('红将甲 攻击+5 速度+5');
    // 兵种特性：重骑兵专属「迎击」+ 自选通用「扰后」；长弓兵专属「先发 / 远离」
    expect(text).toContain('红将甲 获得【迎击】');
    expect(text).toContain('红将甲 获得【扰后】');
    expect(text).toContain('蓝将甲 获得【先发】');
    expect(text).toContain('蓝将甲 获得【远离】');
  });

  it('准备阶段：红方名字包 hn-my、蓝方名字包 hn-enemy，且不套娃', () => {
    const view = mount(false);
    view.setRound(0);

    const myNames = [...view.el.querySelectorAll('.hn-my')].map((el) => el.textContent);
    const enemyNames = [...view.el.querySelectorAll('.hn-enemy')].map((el) => el.textContent);
    expect(myNames).toEqual(expect.arrayContaining(['红将甲', '红将乙']));
    expect(enemyNames).toEqual(expect.arrayContaining(['蓝将甲', '蓝将乙']));
    expect(view.el.querySelector('.hn-my .hn-my')).toBeNull();
    expect(view.el.querySelector('.hn-enemy .hn-enemy')).toBeNull();
  });

  it('第 1 回合：行动前事件挂「回合前阶段」标题，且排在第一个行动组之前', () => {
    const view = mount(true);
    view.setRound(1);

    const log = view.el.querySelector('.dv-log') as HTMLElement;
    const html = log.innerHTML;
    expect(log.querySelector('.es-phase.es-round-pre')?.textContent).toBe('【回合前阶段】');
    expect(html.indexOf('【回合前阶段】')).toBeLessThan(html.indexOf('act-head'));

    // 回合前事件里的武将名也要分色（详情文本走 colorizeHeroNames 兜底）
    const text = view.el.textContent ?? '';
    expect(text).toContain('【红将甲】执行来自【红将甲】的【测试战法】效果！');
    expect([...view.el.querySelectorAll('.hn-my')].map((el) => el.textContent)).toContain('红将甲');
    expect([...view.el.querySelectorAll('.hn-enemy')].map((el) => el.textContent)).toContain('蓝将甲');
  });

  it('第 1 回合：没有行动前事件时不凭空出「回合前阶段」标题', () => {
    const view = mount(false);
    view.setRound(1);
    expect(view.el.querySelector('.es-phase.es-round-pre')).toBeNull();
  });
});
