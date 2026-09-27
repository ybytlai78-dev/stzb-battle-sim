/**
 * Web 战法统计「通过该战法造成杀伤的武将」弹窗测试（jsdom）：
 *  - 杀伤**不是携带者本人**打出的（调兵代打 / 给友军挂分兵状态类战法）→ 数字变成可点击链接；
 *  - 点一下弹出「通过该战法造成杀伤的武将」面板（逐个武将：头像 + 伤害），再点关闭；
 *  - 携带者自己打出的杀伤（三军齐出等）保持纯文本，不做成可点击。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStatsView } from './battleSummary';
import type { BattleEvent, BattleReport, General, Position } from '../src/engine/types';

const BKD = { troopBase: 0, base: 0, main: 0 };

function mkGeneral(
  id: string,
  name: string,
  position: Position,
  skillIds: { command?: string[]; active?: string[] } = {},
): General {
  return {
    id,
    name,
    rarity: '5星',
    cost: 3,
    faction: '吴',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 50,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: skillIds.active ?? [],
    passiveSkillIds: [],
    commandSkillIds: skillIds.command ?? [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function report(events: BattleEvent[], myTeam: General[], enemyTeam: General[]): BattleReport {
  return {
    schemaVersion: '1.0',
    seed: 13,
    maxRounds: 1,
    result: 'win',
    rounds: 1,
    myTeam,
    enemyTeam,
    finalMyTroops: myTeam.map((g) => g.maxTroops),
    finalEnemyTroops: enemyTeam.map(() => 8000),
    finalMyWounded: myTeam.map(() => 0),
    finalEnemyWounded: enemyTeam.map(() => 0),
    finalMyDead: myTeam.map(() => 0),
    finalEnemyDead: enemyTeam.map(() => 0),
    events,
    stats: [],
  };
}

/** 长兵方阵（caster 大营）给友军挂分兵：伤害由前锋/中军打出，统计归属施法者 */
function longbingReport(): BattleReport {
  const caster = mkGeneral('caster', '长兵施法者', '大营', { command: ['changbing_fangzhen'] });
  const front = mkGeneral('front', '打人前锋', '前锋');
  const mid = mkGeneral('mid', '打人中军', '中军');
  const events: BattleEvent[] = [
    { type: 'battle_start', turnOrder: ['front', 'mid', 'caster'], seed: 13 },
    { type: 'preparation_end' },
    { type: 'skill_cast', unitId: 'caster', skillId: 'changbing_fangzhen', skillName: '长兵方阵' },
    { type: 'round_start', round: 1 },
    { type: 'split_damage', sourceId: 'front', creditToId: 'caster', targetId: 'e1', damage: 100, breakdown: BKD, skillId: 'changbing_fangzhen' },
    { type: 'split_damage', sourceId: 'mid', creditToId: 'caster', targetId: 'e2', damage: 80, breakdown: BKD, skillId: 'changbing_fangzhen' },
    { type: 'split_damage', sourceId: 'front', creditToId: 'caster', targetId: 'e1', damage: 20, breakdown: BKD, skillId: 'changbing_fangzhen' },
    { type: 'round_end', round: 1, myTroops: [9000, 9000, 9000], enemyTroops: [8000, 8000], myWounded: [0, 0, 0], enemyWounded: [0, 0], myDead: [0, 0, 0], enemyDead: [0, 0] },
    { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000, 9000], enemyTroops: [8000, 8000] },
  ];
  return report(events, [front, mid, caster], [mkGeneral('e1', '敌1', '前锋'), mkGeneral('e2', '敌2', '中军')]);
}

/** 三军齐出（被动·自施）：分兵是携带者自己打的 */
function sanjunReport(): BattleReport {
  const atk = mkGeneral('atk', '三军武将', '前锋');
  atk.passiveSkillIds = ['sanjun_qichu'];
  const events: BattleEvent[] = [
    { type: 'battle_start', turnOrder: ['atk'], seed: 11 },
    { type: 'preparation_end' },
    { type: 'round_start', round: 1 },
    { type: 'split_damage', sourceId: 'atk', creditToId: 'atk', targetId: 'e1', damage: 150, breakdown: BKD, skillId: 'sanjun_qichu' },
    { type: 'round_end', round: 1, myTroops: [9000], enemyTroops: [8000], myWounded: [0], enemyWounded: [0], myDead: [0], enemyDead: [0] },
    { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000], enemyTroops: [8000] },
  ];
  return report(events, [atk], [mkGeneral('e1', '敌1', '前锋')]);
}

function mount(rep: BattleReport): HTMLElement {
  const view = createStatsView(rep);
  document.body.appendChild(view);
  return view;
}

/** 找某武将那一行里「名字含指定战法名」的战法格 */
function cellOf(view: HTMLElement, heroName: string, skillName: string): HTMLElement {
  const row = Array.from(view.querySelectorAll<HTMLElement>('.st-row')).find((r) => r.textContent?.includes(heroName));
  expect(row, `找不到武将行：${heroName}`).toBeTruthy();
  const cell = Array.from(row!.querySelectorAll<HTMLElement>('.sk')).find((c) => c.textContent?.includes(skillName));
  expect(cell, `找不到战法格：${skillName}`).toBeTruthy();
  return cell!;
}

describe('战法统计「通过该战法造成杀伤的武将」弹窗（Web）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('杀伤不是携带者打的 → 数字可点击；点击弹出武将明细（头像 + 伤害，按首次造成杀伤顺序）', () => {
    const view = mount(longbingReport());
    const cell = cellOf(view, '长兵施法者', '长兵方阵');
    // 统计总额仍是 200（施法者的战法栏）
    expect(cell.textContent).toContain('杀伤 200');

    const link = cell.querySelector('.sk-kill-link') as HTMLElement;
    expect(link, '非携带者造成的杀伤必须做成可点击').toBeTruthy();
    expect(link.textContent).toBe('杀伤 200');
    expect(document.querySelector('.sk-kill-popup')).toBeNull();

    link.click();
    const pop = document.querySelector('.sk-kill-popup') as HTMLElement;
    expect(pop).toBeTruthy();
    expect(pop.textContent).toContain('通过该战法造成杀伤的武将');
    const items = Array.from(pop.querySelectorAll('.sk-kill-item')).map((i) => ({
      name: i.querySelector('.sk-kill-name')?.textContent,
      dmg: i.querySelector('.sk-kill-num')?.textContent,
      hasAvatar: !!i.querySelector('.sk-kill-av'),
    }));
    expect(items).toEqual([
      { name: '打人前锋', dmg: '120', hasAvatar: true },
      { name: '打人中军', dmg: '80', hasAvatar: true },
    ]);
  });

  it('弹窗挂在数字所在行（.sk-d 内，position:relative），不挂到滚动容器导致错位', () => {
    const view = mount(longbingReport());
    const link = cellOf(view, '长兵施法者', '长兵方阵').querySelector('.sk-kill-link') as HTMLElement;
    link.click();
    const line = link.parentElement as HTMLElement;
    const pop = line.querySelector('.sk-kill-popup') as HTMLElement;
    expect(pop).toBeTruthy();
    expect(pop.parentElement).toBe(line);
    expect(getComputedStyle(line).position).toBe('relative');
    // 样式表同时声明（jsdom 不加载 CSS 时由内联兜底，两条一起保证定位父元素正确）
    expect(readFileSync(join('web', 'styles.css'), 'utf8')).toMatch(/\.sk-d \{[^}]*position: relative/);
  });

  it('再次点击同一数字关闭弹窗；点击别处也关闭', () => {
    const view = mount(longbingReport());
    const link = cellOf(view, '长兵施法者', '长兵方阵').querySelector('.sk-kill-link') as HTMLElement;
    link.click();
    expect(document.querySelector('.sk-kill-popup')).toBeTruthy();
    link.click();
    expect(document.querySelector('.sk-kill-popup')).toBeNull();

    link.click();
    expect(document.querySelector('.sk-kill-popup')).toBeTruthy();
    document.body.click();
    expect(document.querySelector('.sk-kill-popup')).toBeNull();
  });

  it('携带者自己打出的杀伤（三军齐出）→ 纯文本，不可点击', () => {
    const view = mount(sanjunReport());
    const cell = cellOf(view, '三军武将', '三军齐出');
    expect(cell.textContent).toContain('杀伤 150');
    expect(cell.querySelector('.sk-kill-link')).toBeNull();
    expect(view.querySelector('.sk-kill-link')).toBeNull();
  });
});
