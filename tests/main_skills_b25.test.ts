/**
 * 帝临回光（灵帝·汉·弓 主战法）：一类指挥。
 * 战斗开始后第 3 回合起，以无法恢复兵力（围困）为代价，使自身攻击距离 +1、进入分兵状态
 * （伤害率 50%，受谋略属性影响），同时令敌军群体陷入恐慌（伤害率 69%，受谋略属性影响，
 * 每回合损失兵力），持续直到战斗结束；恐慌伤害无视规避。
 *
 * 引擎配套：新增「攻击距离提高」机制 —— `range_buff` 状态（types.ts）+
 * `target.ts attackRangeOf`（普攻可达距离上限 = 面板 attackRange + Σ range_buff.amount；
 * 战法有效距离 skill.range 不受影响）。
 * 分兵 50% / 恐慌 69% 的「受谋略属性影响」成长率未确认 → 留空（不缩放、按基值）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { recoverTroops, inflictStatus } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { attackRangeOf } from '../src/engine/target';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';

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

/** 灵帝坐在指定站位（缺省大营），其余位置放木桩 */
function teamWithLingdi(opts: { position?: Position; attackRange?: number } = {}): General[] {
  const position = opts.position ?? '大营';
  const ld = { ...level40(hero('h101')), position };
  if (opts.attackRange != null) ld.attackRange = opts.attackRange;
  const slots = [dummy('ally-front', '前锋'), dummy('ally-mid', '中军'), dummy('ally-back', '大营')];
  slots[slots.findIndex((s) => s.position === position)] = ld;
  return slots;
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
type AttackHit = Extract<BattleEvent, { type: 'attack_hit' }>;
type DotTick = Extract<BattleEvent, { type: 'dot_tick' }>;
const inflicted = (events: BattleEvent[], statusType: string): Inflicted[] =>
  events.filter((e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === statusType);

/** 单元测试用木桩单位（同 distance.test.ts 手法） */
function makeUnit(id: string, position: Position, attackRange = 4): UnitState {
  return {
    general: {
      ...dummy(id, position),
      attackRange,
    },
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(myTeam: UnitState[], enemyTeamUnits: UnitState[]): CombatContext {
  return {
    rng: new Rng(1),
    myTeam,
    enemyTeam: enemyTeamUnits,
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('帝临回光（灵帝，一类指挥：围困 + 攻击距离 +1 + 分兵 + 敌军群体恐慌）', () => {
  it('装配挂槽 + 战法元数据（指挥 / 一类准备阶段 / 距离 5 / 目标自己）', () => {
    const g = hero('h101');
    expect(g.name).toBe('灵帝');
    expect(g.commandSkillIds).toContain('diling_huiguang');

    const s = SKILL_REGISTRY['diling_huiguang'];
    expect(s.type).toBe('command');
    expect(s.type === 'command' && s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.type === 'command' && s.targetMode).toBe('self');
    expect(s.type === 'command' && s.delayedOutput?.atRound).toBe(3);
    expect(s.tags).toEqual(expect.arrayContaining(['siege', 'split', 'panic', 'range_buff']));
  });

  it('延迟到第 3 回合才结算：前 2 回合自身无任何状态，第 3 回合起四条同时挂上', () => {
    const early = run(teamWithLingdi(), 1, 2);
    expect(inflicted(early.events, 'range_buff')).toHaveLength(0);
    expect(inflicted(early.events, 'siege')).toHaveLength(0);
    expect(inflicted(early.events, 'split')).toHaveLength(0);
    expect(inflicted(early.events, 'panic')).toHaveLength(0);

    const later = run(teamWithLingdi(), 1, 4);
    expect(inflicted(later.events, 'siege').map((e) => e.unitId)).toEqual(['h101']);
    expect(inflicted(later.events, 'range_buff').map((e) => e.unitId)).toEqual(['h101']);
    expect(inflicted(later.events, 'split').map((e) => e.unitId)).toEqual(['h101']);
    expect(inflicted(later.events, 'range_buff')[0].detail).toContain('攻击距离 +1');
    expect(inflicted(later.events, 'split')[0].detail).toContain('50');
  });

  it('恐慌打敌军全体：三个敌方单位各挂一条恐慌，并由施法者跳 DoT 策略伤害', () => {
    const report = run(teamWithLingdi(), 1, 5);
    const panics = inflicted(report.events, 'panic');
    expect(panics.map((e) => e.unitId).sort()).toEqual(['enemy-back', 'enemy-front', 'enemy-mid']);
    expect(panics.every((e) => e.detail.includes('69'))).toBe(true);

    // 恐慌跳伤：施法者为灵帝的策略 DoT（挂上时冻结，行动时打出）
    const dots = report.events.filter(
      (e): e is DotTick => e.type === 'dot_tick' && e.skillId === 'diling_huiguang'
    );
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((e) => e.targetId.startsWith('enemy-'))).toBe(true);
  });

  it('攻击距离 +1 生效：大营 attackRange 2 打不到任何敌军，第 3 回合起射程 3 可打到前锋', () => {
    const noBuff = run(teamWithLingdi({ attackRange: 2 }), 1, 2);
    const blocked = noBuff.events.filter(
      (e): e is Extract<BattleEvent, { type: 'no_attack_target' }> =>
        e.type === 'no_attack_target' && e.unitId === 'h101'
    );
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toContain('攻击距离 2');

    const withBuff = run(teamWithLingdi({ attackRange: 2 }), 1, 3);
    const lingdiAttacks = withBuff.events.filter(
      (e): e is AttackHit => e.type === 'attack_hit' && e.sourceId === 'h101'
    );
    expect(lingdiAttacks.length).toBeGreaterThan(0);
    // 射程 3 只覆盖敌方前锋（我方大营 ↔ 敌方前锋 = 3）
    expect(lingdiAttacks.every((e) => e.targetId === 'enemy-front')).toBe(true);
  });

  it('range_buff 只放大普攻射程，不影响战法有效距离（attackRangeOf 求和口径）', () => {
    const ctx = makeCtx([], []);
    const u = makeUnit('u1', '大营', 2);
    expect(attackRangeOf(u)).toBe(2);
    inflictStatus(ctx, u, { type: 'range_buff', amount: 1, duration: 999 }, 'command', 'diling_huiguang', 'h101');
    expect(attackRangeOf(u)).toBe(3);
    // 同源重挂：默认刷新（数值替换为本次 1，不累加成 2）→ 射程仍 3、状态实例不增加
    inflictStatus(ctx, u, { type: 'range_buff', amount: 1, duration: 999 }, 'command', 'diling_huiguang', 'h101');
    expect(u.statuses.filter((s) => s.type === 'range_buff')).toHaveLength(1);
    expect(attackRangeOf(u)).toBe(3);
    // 不同战法类型各自共存 → attackRangeOf 求和口径：3 → 4
    inflictStatus(ctx, u, { type: 'range_buff', amount: 1, duration: 999 }, 'passive', 'other_range', 'h999');
    expect(attackRangeOf(u)).toBe(4);
    expect(SKILL_REGISTRY['diling_huiguang'].range).toBe(5);
  });

  it('围困（无法恢复兵力）：第 3 回合起带围困，恢复尝试被拦截（siege_blocked）', () => {
    // 给灵帝加一个每回合恢复的被动（青囊秘要），围困生效后恢复应被拦截
    const team = teamWithLingdi().map((g) =>
      g.id === 'h101' ? { ...g, passiveSkillIds: ['qingnang_miyao'] } : g
    );

    const early = run(team, 1, 2);
    expect(early.events.some((e) => e.type === 'siege_blocked' && e.unitId === 'h101')).toBe(false);

    const later = run(team, 1, 5);
    expect(later.events.some((e) => e.type === 'siege_blocked' && e.unitId === 'h101')).toBe(true);
  });
});
