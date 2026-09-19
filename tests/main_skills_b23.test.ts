/**
 * 怀橘遗亲（陆绩·吴·弓 主战法）：一类指挥，每回合开始时
 * 降低自身与我军除大营外友军单体 10 点攻击/防御/谋略，并提升我军大营 20 点攻击/防御/谋略。
 *
 * 引擎配套：「按站位筛友军」= inflict_status.positions + targetSide:'ally'（本轮扩展；
 * 此前 positions 只用于敌军，如落首箭打大营），且站位筛选后仍遵守 targetMode
 * （单体/随机单体 → 从筛后的池取 1 个）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 陆绩坐在指定站位，其余位置放木桩 */
function teamWithLuAt(pos: Position): General[] {
  const lj = withSkills(level40(hero('h789')), { commandSkillIds: ['huai_ju_yiqin'] });
  const slots = [dummy('ally-front', '前锋'), dummy('ally-mid', '中军'), dummy('ally-back', '大营')];
  const idx = slots.findIndex((s) => s.position === pos);
  slots[idx] = { ...lj, position: pos };
  return slots;
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
const STATS = ['attack_buff', 'defense_buff', 'strategy_buff'];
const statEvents = (events: BattleEvent[]): Inflicted[] =>
  events.filter((e): e is Inflicted => e.type === 'status_inflicted' && STATS.includes(e.statusType));

describe('怀橘遗亲（陆绩，一类指挥：每回合开始时大营 +20 / 自身与非大营单体 -10）', () => {
  it('装配挂槽：陆绩主战法挂入指挥槽，一类指挥对我军', () => {
    const g = hero('h789');
    expect(g.name).toBe('陆绩');
    expect(g.commandSkillIds).toContain('huai_ju_yiqin');

    const s = SKILL_REGISTRY['huai_ju_yiqin'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    expect(s.type === 'command' && s.targetSide === 'ally').toBe(true);
    expect(s.type === 'command' && s.range).toBe(2);
    expect(s.tags).toEqual(expect.arrayContaining(STATS));
    expect(s.type === 'command' && Boolean(s.roundStartRepeat)).toBe(true);
  });

  it('机制：自身 -10，大营另获 +20（陆绩坐前锋，三段目标互不重叠）', () => {
    const report = run(teamWithLuAt('前锋'), 1, 2);
    const stats = statEvents(report.events);

    const plus = stats.filter((e) => e.detail.includes('20'));
    const minus = stats.filter((e) => e.detail.includes('降低了10'));

    // 大营（木桩）获得 +20 攻/防/谋
    expect(plus.length).toBeGreaterThanOrEqual(3);
    expect(plus.every((e) => e.unitId === 'ally-back')).toBe(true);

    // 自身（陆绩）+ 除大营外友军单体（中军）各 -10
    expect(minus.length).toBeGreaterThanOrEqual(6);
    expect(minus.some((e) => e.unitId === 'h789')).toBe(true);
  });

  it('机制：陆绩坐大营时，「除大营外友军单体」只命中 1 名（站位筛选 + 随机单体）', () => {
    const report = run(teamWithLuAt('大营'), 1, 1);
    const nonBackMinus = statEvents(report.events).filter((e) => e.detail.includes('降低了10') && e.unitId !== 'h789');
    const hit = new Set(nonBackMinus.map((e) => e.unitId));
    expect(hit.size).toBe(1);
    expect(nonBackMinus).toHaveLength(3); // 攻/防/谋各一条
    expect(['ally-front', 'ally-mid']).toContain([...hit][0]);
  });

  it('数值：每回合三段各 3 条（自身 3 + 非大营单体 3 + 大营 3）；上回合状态在行动结束后到期 → 次回合重新施加', () => {
    const report = run(teamWithLuAt('前锋'), 1, 2);
    const r2 = report.events.findIndex((e) => e.type === 'round_start' && e.round === 2);
    expect(r2).toBeGreaterThan(0);
    expect(statEvents(report.events.slice(0, r2))).toHaveLength(9);
    // 新口径（行动结束后递减）：第 1 回合施加的属性在携带者行动结束时到期，
    // 第 2 回合开始重新施加（同源刷新）→ 再推 9 条（「持续至该回合结束」不再依赖静默刷新路径）
    expect(statEvents(report.events.slice(r2))).toHaveLength(9);
  });

  it('数值（重复施加默认刷新）：怀橘遗亲每回合重挂仍是 −10（不是 −20/−30）、大营 +20（不是 +40）', () => {
    const report = run(teamWithLuAt('前锋'), 1, 3);
    const attackOf = (unitId: string) =>
      report.events.filter(
        (e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === 'attack_buff' && e.unitId === unitId
      );
    const self = attackOf('h789');
    expect(self.length).toBeGreaterThanOrEqual(3); // 每回合 1 条 attack_buff
    expect(self.every((e) => e.detail.includes('降低了10'))).toBe(true);
    expect(self.some((e) => e.detail.includes('降低了20') || e.detail.includes('降低了30'))).toBe(false);

    const back = attackOf('ally-back');
    expect(back.length).toBeGreaterThanOrEqual(3);
    expect(back.every((e) => e.detail.includes('提高了20'))).toBe(true);
    expect(back.some((e) => e.detail.includes('提高了40'))).toBe(false);
  });
});
