/**
 * Web 战报「增减伤统计」测试（jsdom）：
 *  伤害数字前只插入一行「此次伤害共计提升/降低 z%」净合计（z 可点击）；
 *  点击 z 才弹出「增减伤统计」面板——分「伤害提升合计」「伤害降低合计」两栏 + 各来源明细【武将】【战法】。
 *  负增伤（无心恋战类：造成伤害降低 = 负增伤）计入「伤害降低」栏。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createBattleView } from './battleView';
import type { BattleEvent, BattleReport, DamageModifiers, General, Position } from '../src/engine/types';

function mkGeneral(id: string, name: string, position: Position): General {
  return {
    id,
    name,
    rarity: '5星',
    cost: 3,
    faction: '吴',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'archer',
    position,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 50,
    attackRange: 3,
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

function reportWith(mods: DamageModifiers | undefined, extraMy: General[] = []): BattleReport {
  const hit: Extract<BattleEvent, { type: 'attack_hit' }> = {
    type: 'attack_hit',
    sourceId: 'huanggai',
    targetId: 'e1',
    distance: 1,
    damage: 100,
    breakdown: { troopBase: 30, base: 30, main: 40 },
  };
  if (mods) hit.modifiers = mods;
  const events: BattleEvent[] = [
    { type: 'battle_start', turnOrder: ['huanggai', 'lvmeng', 'e1'], seed: 1 },
    { type: 'preparation_end' },
    { type: 'round_start', round: 1 },
    { type: 'unit_act_start', unitId: 'huanggai', name: '黄盖', position: '前锋', phase: 'normal_attack' },
    hit,
    { type: 'round_end', round: 1, myTroops: [9000, 9000], enemyTroops: [8900], myWounded: [0, 0], enemyWounded: [0], myDead: [0, 0], enemyDead: [0] },
    { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000], enemyTroops: [8900] },
  ];
  return {
    schemaVersion: '1.0',
    seed: 1,
    maxRounds: 1,
    result: 'win',
    rounds: 1,
    myTeam: [mkGeneral('huanggai', '黄盖', '前锋'), mkGeneral('lvmeng', '吕蒙', '中军'), ...extraMy],
    enemyTeam: [mkGeneral('e1', '敌军前锋', '前锋')],
    finalMyTroops: [9000, 9000],
    finalEnemyTroops: [8900],
    finalMyWounded: [0, 0],
    finalEnemyWounded: [0],
    finalMyDead: [0, 0],
    finalEnemyDead: [0],
    events,
    stats: [],
  };
}

function mount(mods?: DamageModifiers, extraMy: General[] = []): { view: ReturnType<typeof createBattleView>; el: HTMLElement } {
  const view = createBattleView(reportWith(mods, extraMy));
  view.setRound(1);
  document.body.appendChild(view.el);
  return { view, el: view.el };
}

/** 神兵天降（受到侧）+ 大赏三军（造成侧）各 33%：合计提升 66% */
const boostMods: DamageModifiers = {
  caused: [{ unitId: 'lvmeng', skillId: 'dashang_sanjun', skillName: '大赏三军', rate: 0.33, direction: 'caused' }],
  taken: [{ unitId: 'lvmeng', skillId: 'shenbing_tianjiang', skillName: '神兵天降', rate: 0.33, direction: 'taken' }],
  reduce: [],
};

describe('战报增减伤统计（Web）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('伤害数字前只插入净合计行「此次伤害共计提升 66%」（可点击），无内联明细', () => {
    const { el } = mount(boostMods);
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line).toBeTruthy();
    // 仅净合计一行：无内联的「伤害共计提升 x%」合计行与来源明细行
    expect(line.querySelector('.dmg-total')).toBeNull();
    expect(line.querySelector('.dmg-src')).toBeNull();
    expect(line.textContent).toContain('此次伤害共计提升');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('66%');
    // 提升行应在伤害数字行之前
    const evs = Array.from(el.querySelectorAll('.act-group .ev'));
    const dmgIdx = evs.findIndex((e) => e.classList.contains('dmg-phy'));
    expect(evs.indexOf(line)).toBeLessThan(dmgIdx);
  });

  it('点击 x% 弹出增减伤统计面板：提升/降低两栏 + 【武将】【战法】条目', () => {
    const { el } = mount(boostMods);
    (el.querySelector('.dmg-link') as HTMLElement).click();
    const pop = el.querySelector('.dmg-popup') as HTMLElement;
    expect(pop).toBeTruthy();
    expect(pop.textContent).toContain('增减伤统计');
    expect(pop.textContent).toContain('伤害提升合计：66%');
    // 神兵天降（受到侧）在前、大赏三军（造成侧）在后
    const items = Array.from(pop.querySelectorAll('.dmg-pop-item')).map((i) => i.textContent);
    expect(items).toEqual([
      '【吕蒙】【神兵天降】伤害提升 33%',
      '【吕蒙】【大赏三军】伤害提升 33%',
    ]);
    expect(pop.textContent).toContain('伤害降低合计：0%');
  });

  it('弹窗挂在百分比链接旁（.ev.dmg-mod 内），不挂到战报容器导致滚动后错位裁切', () => {
    const { el } = mount(boostMods);
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    const link = line.querySelector('.dmg-link') as HTMLElement;
    link.click();
    const pop = line.querySelector('.dmg-popup') as HTMLElement;
    expect(pop).toBeTruthy();
    expect(pop.parentElement).toBe(line);
    expect(getComputedStyle(line).position).toBe('relative');
  });

  it('增伤与减伤并存：净合计 x = 提升 − 降低（40% − 30% = 10%）；面板两栏齐全', () => {
    const mods: DamageModifiers = {
      caused: [{ unitId: 'lvmeng', skillId: 'dashang_sanjun', skillName: '大赏三军', rate: 0.4, direction: 'caused' }],
      taken: [],
      reduce: [{ unitId: 'e1', skillId: 'biqi_fengmang', skillName: '避其锋芒', rate: 0.3, direction: 'reduce' }],
    };
    const { el } = mount(mods);
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('此次伤害共计提升');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('10%');
    (el.querySelector('.dmg-link') as HTMLElement).click();
    const pop = el.querySelector('.dmg-popup') as HTMLElement;
    expect(pop.textContent).toContain('伤害提升合计：40%');
    expect(pop.textContent).toContain('伤害降低合计：30%');
    expect(pop.textContent).toContain('【敌军前锋】【避其锋芒】伤害降低 30%');
  });

  it('减伤大于增伤（净合计为负）时显示「此次伤害共计降低」：20% − 30% = 降低 10%', () => {
    const mods: DamageModifiers = {
      caused: [{ unitId: 'lvmeng', skillId: 'dashang_sanjun', skillName: '大赏三军', rate: 0.2, direction: 'caused' }],
      taken: [],
      reduce: [{ unitId: 'e1', skillId: 'biqi_fengmang', skillName: '避其锋芒', rate: 0.3, direction: 'reduce' }],
    };
    const { el } = mount(mods);
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('此次伤害共计降低');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('10%');
  });

  it('负增伤计入降低侧：奋疾先登 32% + 愈战愈勇 10% 提升 42%；无心恋战 -30% + 避其锋芒 30% 降低 60%；净降低 18%', () => {
    const mods: DamageModifiers = {
      caused: [
        { unitId: 'lejin', skillId: 'fenji_xiandeng', skillName: '奋疾先登', rate: 0.32, direction: 'caused' },
        { unitId: 'lejin', skillId: 'yuzhan_yuyong', skillName: '愈战愈勇', rate: 0.1, direction: 'caused' },
        // 无心恋战：造成伤害降低 30% = 造成侧负增伤 → 计入「降低」
        { unitId: 'liubei', skillId: 'wuxin_lianzhan', skillName: '无心恋战', rate: -0.3, direction: 'caused' },
      ],
      taken: [],
      reduce: [{ unitId: 'liubei', skillId: 'biqi_fengmang', skillName: '避其锋芒', rate: 0.3, direction: 'reduce' }],
    };
    const { el } = mount(mods, [mkGeneral('lejin', '乐进', '中军'), mkGeneral('liubei', '刘备', '大营')]);
    // 伤害数字前只有净合计行：42% − 60% = 降低 18%（无内联明细）
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.querySelector('.dmg-total')).toBeNull();
    expect(line.querySelector('.dmg-src')).toBeNull();
    expect(line.textContent).toContain('此次伤害共计降低');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('18%');
    // 点击弹出面板：提升/降低两栏 + 各来源明细（负增伤 无心恋战 在前，减伤 避其锋芒 在后）
    (el.querySelector('.dmg-link') as HTMLElement).click();
    const pop = el.querySelector('.dmg-popup') as HTMLElement;
    expect(pop.textContent).toContain('伤害提升合计：42%');
    const items = Array.from(pop.querySelectorAll('.dmg-pop-item')).map((i) => i.textContent);
    expect(items).toEqual([
      '【乐进】【奋疾先登】伤害提升 32%',
      '【乐进】【愈战愈勇】伤害提升 10%',
      '【刘备】【无心恋战】伤害降低 30%',
      '【刘备】【避其锋芒】伤害降低 30%',
    ]);
    expect(pop.textContent).toContain('伤害降低合计：60%');
  });

  it('再次点击同一 x% 关闭弹窗', () => {
    const { el } = mount(boostMods);
    const link = el.querySelector('.dmg-link') as HTMLElement;
    link.click();
    expect(el.querySelector('.dmg-popup')).toBeTruthy();
    link.click();
    expect(el.querySelector('.dmg-popup')).toBeNull();
  });

  it('点击弹窗以外区域关闭弹窗', () => {
    const { el } = mount(boostMods);
    (el.querySelector('.dmg-link') as HTMLElement).click();
    expect(el.querySelector('.dmg-popup')).toBeTruthy();
    document.body.click();
    expect(el.querySelector('.dmg-popup')).toBeNull();
  });

  it('无增减伤时不插入行；纯减伤时插入「此次伤害共计降低」行（30%）', () => {
    let el = mount(undefined).el;
    expect(el.querySelector('.ev.dmg-mod')).toBeNull();

    const reduceOnly: DamageModifiers = {
      caused: [],
      taken: [],
      reduce: [{ unitId: 'e1', skillId: 'biqi_fengmang', skillName: '避其锋芒', rate: 0.3, direction: 'reduce' }],
    };
    el = mount(reduceOnly).el;
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('此次伤害共计降低');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('30%');
  });

  it('兵种克制减伤与战法减伤同样展示：共计降低 30%，弹窗含【兵种克制】', () => {
    const mods: DamageModifiers = {
      caused: [],
      taken: [],
      reduce: [{ unitId: 'e1', skillId: 'troop_counter', skillName: '兵种克制', rate: 0.3, direction: 'reduce' }],
    };
    const { el } = mount(mods);
    const line = el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line.textContent).toContain('此次伤害共计降低');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('30%');
    (el.querySelector('.dmg-link') as HTMLElement).click();
    const pop = el.querySelector('.dmg-popup') as HTMLElement;
    expect(pop.textContent).toContain('伤害降低合计：30%');
    expect(pop.textContent).toContain('【兵种克制】伤害降低 30%');
  });

  it('DoT 跳伤（dot_tick）同样插入净合计行：归属施法者，挂上时冻结的归因', () => {
    const dot: Extract<BattleEvent, { type: 'dot_tick' }> = {
      type: 'dot_tick',
      sourceId: 'e1',
      targetId: 'e1',
      dotType: 'burning',
      skillId: 'liehuo_fenzhou',
      casterId: 'huanggai',
      damage: 200,
      breakdown: { troopBase: 30, base: 20, main: 150 },
      modifiers: {
        caused: [{ unitId: 'huanggai', skillId: 'jinguo_zhanzhen', skillName: '巾帼战阵', rate: 0.4, direction: 'caused' }],
        taken: [],
        reduce: [],
      },
    };
    const report = reportWith(undefined);
    report.events = [
      { type: 'battle_start', turnOrder: ['huanggai', 'e1'], seed: 1 },
      { type: 'preparation_end' },
      { type: 'round_start', round: 1 },
      { type: 'unit_act_start', unitId: 'e1', name: '敌军前锋', position: '前锋', phase: 'normal_attack' },
      dot,
      { type: 'round_end', round: 1, myTroops: [9000, 9000], enemyTroops: [8900], myWounded: [0, 0], enemyWounded: [100], myDead: [0, 0], enemyDead: [0] },
      { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000], enemyTroops: [8900] },
    ];
    const view = createBattleView(report);
    view.setRound(1);
    document.body.appendChild(view.el);
    const line = view.el.querySelector('.ev.dmg-mod') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('此次伤害共计提升');
    expect((line.querySelector('.dmg-link') as HTMLElement).textContent).toBe('40%');
    // 点击弹出面板归属施法者（黄盖）
    (view.el.querySelector('.dmg-link') as HTMLElement).click();
    const pop = view.el.querySelector('.dmg-popup') as HTMLElement;
    expect(pop.textContent).toContain('【黄盖】【巾帼战阵】伤害提升 40%');
  });

  it('详情左侧出手顺序随回合切换：用该回合 round_start.turnOrder（当前速度序）', () => {
    const report = reportWith(undefined);
    report.events = [
      { type: 'battle_start', turnOrder: ['huanggai', 'lvmeng', 'e1'], seed: 1 },
      { type: 'preparation_end' },
      { type: 'round_start', round: 1, turnOrder: ['lvmeng', 'huanggai', 'e1'] },
      { type: 'unit_act_start', unitId: 'lvmeng', name: '吕蒙', position: '中军', phase: 'normal_attack' },
      { type: 'round_end', round: 1, myTroops: [9000, 9000], enemyTroops: [9000], myWounded: [0, 0], enemyWounded: [0], myDead: [0, 0], enemyDead: [0] },
      { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000], enemyTroops: [9000] },
    ];
    const view = createBattleView(report);
    document.body.appendChild(view.el);
    view.setRound(0);
    expect(Array.from(view.el.querySelectorAll('.dv-turns .turn')).map((b) => (b as HTMLElement).dataset.unitId)).toEqual([
      'huanggai', 'lvmeng', 'e1',
    ]);
    view.setRound(1);
    expect(Array.from(view.el.querySelectorAll('.dv-turns .turn')).map((b) => (b as HTMLElement).dataset.unitId)).toEqual([
      'lvmeng', 'huanggai', 'e1',
    ]);
  });
});

describe('持节镇西详情战报文案', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('两行官方口径：执行效果 + 增幅(增加后数值)，不显示层数', () => {
    const report = reportWith(undefined);
    report.myTeam.push(mkGeneral('weiguan', '卫瓘', '中军'));
    report.events = [
      { type: 'battle_start', turnOrder: ['huanggai', 'weiguan', 'e1'], seed: 1 },
      { type: 'preparation_end' },
      { type: 'round_start', round: 1 },
      { type: 'unit_act_start', unitId: 'huanggai', name: '黄盖', position: '前锋', phase: 'active_skill' },
      {
        type: 'status_inflicted',
        unitId: 'huanggai',
        statusType: 'strategy_buff',
        detail:
          '【黄盖】执行来自【卫瓘】的【持节镇西】效果！\n' +
          '【黄盖】的谋略属性提高了32(182)',
      },
      { type: 'round_end', round: 1, myTroops: [9000, 9000, 9000], enemyTroops: [9000], myWounded: [0, 0, 0], enemyWounded: [0], myDead: [0, 0, 0], enemyDead: [0] },
      { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000, 9000], enemyTroops: [9000] },
    ];
    const view = createBattleView(report);
    view.setRound(1);
    document.body.appendChild(view.el);
    const lines = Array.from(view.el.querySelectorAll('.act-body .ev.status')).map((n) => n.textContent ?? '');
    expect(lines).toContain('【黄盖】执行来自【卫瓘】的【持节镇西】效果！');
    expect(lines.some((t) => t.includes('谋略属性提高了32(182)'))).toBe(true);
    expect(lines.join('')).not.toContain('层');
    expect(lines.join('')).not.toContain('获得：');
  });

  it('魏武之世：百分比降低为 比率(变化点数)(变化后)', () => {
    const report = reportWith(undefined);
    report.myTeam.push(mkGeneral('caocao', '曹操', '大营'));
    report.events = [
      { type: 'battle_start', turnOrder: ['caocao', 'e1'], seed: 1 },
      { type: 'preparation_end' },
      { type: 'round_start', round: 1 },
      { type: 'unit_act_start', unitId: 'caocao', name: '曹操', position: '大营', phase: 'command_skill' },
      { type: 'skill_cast', unitId: 'caocao', skillId: 'weiwu_zhishi', skillName: '魏武之世' },
      {
        type: 'status_inflicted',
        unitId: 'e1',
        statusType: 'attack_buff',
        detail: '【敌军前锋】的攻击属性降低了22%(11)(39)',
      },
      { type: 'round_end', round: 1, myTroops: [9000, 9000, 9000], enemyTroops: [9000], myWounded: [0, 0, 0], enemyWounded: [0], myDead: [0, 0, 0], enemyDead: [0] },
      { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000, 9000], enemyTroops: [9000] },
    ];
    const view = createBattleView(report);
    view.setRound(1);
    document.body.appendChild(view.el);
    const text = view.el.textContent ?? '';
    expect(text).toContain('【曹操】发动【魏武之世】！');
    expect(text).toContain('【敌军前锋】的攻击属性降低了22%(11)(39)');
    expect(text).not.toContain('获得：');
  });
});

describe('白衣渡江详情战报文案', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('第3回合延迟伤害：官方两行，无 unit_act_start 也显示', () => {
    const report = reportWith(undefined);
    report.myTeam = [mkGeneral('lvmeng', '吕蒙', '大营')];
    report.enemyTeam = [mkGeneral('taishici', '太史慈', '前锋')];
    report.events = [
      { type: 'battle_start', turnOrder: ['lvmeng', 'taishici'], seed: 1 },
      { type: 'preparation_end' },
      { type: 'round_start', round: 1 },
      { type: 'round_end', round: 1, myTroops: [9000], enemyTroops: [9000], myWounded: [0], enemyWounded: [0], myDead: [0], enemyDead: [0] },
      { type: 'round_start', round: 2 },
      { type: 'round_end', round: 2, myTroops: [9000], enemyTroops: [9000], myWounded: [0], enemyWounded: [0], myDead: [0], enemyDead: [0] },
      { type: 'round_start', round: 3 },
      {
        type: 'damage',
        sourceId: 'lvmeng',
        targetId: 'taishici',
        skillId: 'baiyi_dujiang',
        skillName: '白衣渡江',
        damageType: 'strategy',
        damage: 1414,
        breakdown: { troopBase: 200, base: 200, main: 1014 },
        delayedEffect: true,
        afterTroops: 7986,
      },
      {
        type: 'stored_effect_expired',
        unitId: 'taishici',
        sourceId: 'lvmeng',
        skillId: 'baiyi_dujiang',
        skillName: '白衣渡江',
        damageType: 'strategy',
      },
      { type: 'round_end', round: 3, myTroops: [9000], enemyTroops: [7986], myWounded: [0], enemyWounded: [1014], myDead: [0], enemyDead: [0] },
      { type: 'battle_end', result: 'win', rounds: 3, myTroops: [9000], enemyTroops: [7986] },
    ];
    report.rounds = 3;
    report.finalMyTroops = [9000];
    report.finalEnemyTroops = [7986];
    const view = createBattleView(report);
    view.setRound(3);
    document.body.appendChild(view.el);
    const text = view.el.textContent ?? '';
    expect(text).toContain('【吕蒙】【白衣渡江】的效果使【太史慈】损失了1414兵力(7986)');
    expect(text).toContain('【太史慈】的来自【吕蒙】【白衣渡江】的策略攻击伤害效果消失了');
    expect(text).not.toContain('对「太史慈」造成');
  });

  it('伤害分摊（share_damage）必须渲染「谁替谁分摊了多少」+ 战法名，且排在触发出来的恢复行之前', () => {
    // 复刻用户现场：XP马良 挨 2093 → 刘备（同心/雅虑适时）替他分摊 280 → 分摊扣血触发刘备的持续型急救恢复 280
    const report: BattleReport = {
      schemaVersion: '1.0',
      seed: 1,
      maxRounds: 1,
      result: 'win',
      rounds: 1,
      myTeam: [mkGeneral('maliang', 'XP马良', '前锋'), mkGeneral('liubei', '刘备', '中军')],
      enemyTeam: [mkGeneral('e1', '敌军前锋', '前锋')],
      finalMyTroops: [9000, 9000],
      finalEnemyTroops: [8900],
      finalMyWounded: [0, 0],
      finalEnemyWounded: [0],
      finalMyDead: [0, 0],
      finalEnemyDead: [0],
      stats: [],
      events: [
        { type: 'battle_start', turnOrder: ['maliang', 'liubei', 'e1'], seed: 1 },
        { type: 'preparation_end' },
        { type: 'round_start', round: 1 },
        { type: 'unit_act_start', unitId: 'e1', name: '敌军前锋', position: '前锋', phase: 'normal_attack' },
        { type: 'attack_hit', sourceId: 'e1', targetId: 'maliang', distance: 1, damage: 2093, breakdown: { troopBase: 0, base: 0, main: 2093 } },
        { type: 'share_damage', unitId: 'liubei', targetId: 'maliang', skillId: 'yalv_shishi', amount: 280 },
        { type: 'heal', sourceId: 'liubei', targetId: 'liubei', skillId: 'huangyi_liuli', skillName: '皇裔流离', amount: 280, before: 6964, after: 7244 },
        { type: 'round_end', round: 1, myTroops: [9000, 9000], enemyTroops: [8900], myWounded: [0, 0], enemyWounded: [0], myDead: [0, 0], enemyDead: [0] },
        { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000], enemyTroops: [8900] },
      ],
    };
    const view = createBattleView(report);
    view.setRound(1);
    document.body.appendChild(view.el);
    const row = view.el.querySelector('.ev.share') as HTMLElement;
    expect(row, '分摊必须有独立一行（否则看不出到底分摊了没）').toBeTruthy();
    expect(row.textContent).toContain('刘备');       // 分摊者
    expect(row.textContent).toContain('XP马良');     // 被分摊的受击者
    expect(row.textContent).toContain('280');        // 承担量
    expect(row.textContent).toContain('雅虑适时');   // 战法名（SKILL_REGISTRY 反查）
    // 事件顺序：先分摊、后（分摊扣血触发的）恢复 —— 行序必须一致
    const evs = Array.from(view.el.querySelectorAll('.ev')) as HTMLElement[];
    expect(evs.findIndex((e) => e.classList.contains('share')))
      .toBeLessThan(evs.findIndex((e) => e.classList.contains('heal')));
  });
});
