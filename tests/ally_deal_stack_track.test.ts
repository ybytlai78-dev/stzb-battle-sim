/**
 * `allyDealStack` 只认「本轨跟踪状态」的身份契约（2026-10-18 用户报障）
 *
 * 用户口径（原话）：「知己知彼对敌方也有增伤效果，目标选取对方是使敌方受到伤害提高，不是给敌方增伤」
 * —— 敌方侧必须是 `damage_boost { direction: 'taken' }`（受到伤害提高），不能变成敌方自己的增伤。
 *
 * 缺陷根因：`triggerAllyDealStack` 原先只按「载体身上的状态 → `sourceSkillId` → 战法的 `allyDealStack`」
 * 回溯，**不比对状态本身**。知己知彼同一战法在两侧各挂一套状态：
 *   我军侧（`allyDealStack`）= caused 增伤跟踪；敌军侧（`initialOutput` + `onHurt`）= taken 增伤。
 * 于是敌方单位**自己打出伤害**时，它身上那份 taken 状态也会命中我军侧的 caused 轨，
 * 按 60% 判定给**敌方自己**叠「造成的伤害提高 8%」——最高 5 层 = 敌方增伤 +40%。
 * 修复后只有与 `type + direction + damageType` 都相同的跟踪状态才叠层（`isDealStackTrack`）。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';
import { runBattle } from '../src/engine/combat';

const SKILL_ID = 'test_both_side_stack';

function makeUnit(id: string, position: Position, side: 'my' | 'enemy'): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 120, defense: 80, strategy: 100, speed: 60, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

/** 合成「知己知彼式」战法：我军侧 caused 增伤跟踪 + 敌军侧 taken 增伤（同一战法 id、两侧各一套状态） */
function bothSideSkill(): Skill {
  return {
    id: SKILL_ID,
    name: '测试知己知彼',
    type: 'command',
    phase: 'prep',
    range: 5,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'ally',
    tags: ['damage_boost'],
    output: [],
    // 无 `rate` → 必中，去掉随机性，让本测试只考察「身份匹配」
    allyDealStack: [
      {
        damageType: 'physical',
        status: {
          type: 'damage_boost', rate: 0.08, duration: 999,
          direction: 'caused', damageType: 'physical', stack: true, maxStacks: 5,
        },
      },
    ],
  };
}

/** 我军侧跟踪状态（准备阶段由 allyDealStack 挂上） */
function causedTrack(): CreateStatus {
  return {
    type: 'damage_boost', rate: 0.08, duration: 999,
    direction: 'caused', damageType: 'physical', stack: true, maxStacks: 5,
  };
}

/** 敌军侧状态（准备阶段由 initialOutput / 受击由 onHurt 挂上） */
function takenStatus(): CreateStatus {
  return {
    type: 'damage_boost', rate: 0.08, duration: 999,
    direction: 'taken', damageType: 'physical', stack: true, maxStacks: 5,
  };
}

interface Field {
  ctx: CombatContext;
  ally: UnitState;
  enemy: UnitState;
}

/**
 * 搭一个「知己知彼已生效」的战场：我方持有 caused 跟踪层、敌方持有 taken 层，
 * 两者 `sourceSkillId` 都是同一战法（带 sourceUnitId = 我方携带者，与真引擎一致）。
 */
function field(): Field {
  const skill = bothSideSkill();
  const ally = makeUnit('my-front', '前锋', 'my');
  const enemy = makeUnit('enemy-front', '前锋', 'enemy');
  const ctx: CombatContext = {
    rng: new Rng(20261018),
    myTeam: [ally],
    enemyTeam: [enemy],
    events: [],
    skills: new Map<string, Skill>([[skill.id, skill]]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  inflictStatus(ctx, ally, causedTrack(), 'command', SKILL_ID, ally.general.id);
  inflictStatus(ctx, enemy, takenStatus(), 'command', SKILL_ID, ally.general.id);
  return { ctx, ally, enemy };
}

function boosts(u: UnitState, direction: 'caused' | 'taken'): Array<Extract<Status, { type: 'damage_boost' }>> {
  return u.statuses.filter(
    (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === direction
  );
}

describe('allyDealStack 只认本轨跟踪状态', () => {
  it('敌方持有 taken 状态时，敌方自己造成伤害不会叠「造成伤害提高」层（报障回归）', () => {
    const { ctx, enemy } = field();
    // 敌方普攻我方 → 敌方造成物理伤害：修复前会命中我军侧 caused 轨，给敌方自己 +8%
    actUnit(ctx, enemy);

    expect(boosts(enemy, 'caused')).toHaveLength(0);
    // 敌方那份 taken 状态原样保留（既没被叠层、也没被换成 caused）
    const taken = boosts(enemy, 'taken');
    expect(taken).toHaveLength(1);
    expect(taken[0].rate).toBeCloseTo(0.08, 8);
  });

  it('对照组：我方 caused 跟踪状态照常叠层（修复不误伤正常路径）', () => {
    const { ctx, ally } = field();
    actUnit(ctx, ally);

    const caused = boosts(ally, 'caused');
    expect(caused).toHaveLength(1);
    // 首层 8% + 本次造成攻击伤害后同源再施加一次 = 16%
    expect(caused[0].rate).toBeCloseTo(0.16, 8);
  });

  it('双轨战法不串轨：策略伤害只叠策略轨（攻击轨不动）', () => {
    const skill = bothSideSkill();
    skill.allyDealStack = [
      { damageType: 'physical', status: { ...(causedTrack() as Extract<CreateStatus, { type: 'damage_boost' }>) } },
      {
        damageType: 'strategy',
        status: {
          type: 'damage_boost', rate: 0.08, duration: 999,
          direction: 'caused', damageType: 'strategy', stack: true, maxStacks: 5,
        },
      },
    ];
    const ally = makeUnit('my-front', '前锋', 'my');
    const enemy = makeUnit('enemy-front', '前锋', 'enemy');
    const caster = makeUnit('my-caster', '大营', 'my');
    caster.general.activeSkillIds = [];
    const ctx: CombatContext = {
      rng: new Rng(7),
      myTeam: [caster, ally],
      enemyTeam: [enemy],
      events: [],
      skills: new Map<string, Skill>([[skill.id, skill]]),
      lockedCommands: [],
      stackBuffs: [],
      currentRound: 1,
    };
    inflictStatus(ctx, ally, causedTrack(), 'command', SKILL_ID, caster.general.id);
    inflictStatus(
      ctx, ally,
      { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused', damageType: 'strategy', stack: true, maxStacks: 5 },
      'command', SKILL_ID, caster.general.id
    );
    // 我方造成物理伤害（普攻）→ 只有攻击轨叠层
    actUnit(ctx, ally);
    const phys = boosts(ally, 'caused').filter((s) => s.damageType === 'physical');
    const strat = boosts(ally, 'caused').filter((s) => s.damageType === 'strategy');
    expect(phys[0].rate).toBeCloseTo(0.16, 8);
    expect(strat[0].rate).toBeCloseTo(0.08, 8);
  });
});

describe('知己知彼数据口径：我军侧 caused、敌军侧 taken、两侧初始 0 层', () => {
  const zzb = SKILL_REGISTRY['zhiji_zhibi'] as unknown as {
    allyDealStack: Array<{ status: { direction?: string }; initialLayers?: number }>;
    initialOutput?: Array<{ status: { direction?: string } }>;
    onHurt: Array<{ output: Array<{ status: { direction?: string } }> }>;
  };

  it('我军侧两条轨都是 caused，且都是初始 0 层（准备阶段不预挂）', () => {
    expect(zzb.allyDealStack).toHaveLength(2);
    expect(zzb.allyDealStack.every((t) => t.status.direction === 'caused')).toBe(true);
    expect(zzb.allyDealStack.every((t) => t.initialLayers === 0)).toBe(true);
  });

  it('敌军侧不再有 initialOutput 免费首层，两条受击轨全部是 taken', () => {
    expect(zzb.initialOutput).toBeUndefined();
    const enemySide = zzb.onHurt.flatMap((h) => h.output.map((o) => o.status));
    expect(enemySide).toHaveLength(2);
    expect(enemySide.every((s) => s.direction === 'taken')).toBe(true);
  });
});

describe('知己知彼：初始 0 层（2026-10-30 用户口径）', () => {
  function gen(id: string, position: Position, commandSkillIds: string[] = []): General {
    return {
      id, name: id, rarity: '5星', cost: 3, faction: '汉', tags: [],
      mutualExclusionGroup: null, troopType: 'infantry', position,
      attack: 120, defense: 100, strategy: 100, speed: 60, attackRange: 2, maxTroops: 9000,
      mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
      commandSkillIds, pursuitSkillIds: [], morale: 100,
    };
  }

  const isBoostInflict = (
    e: BattleEvent
  ): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
    e.type === 'status_inflicted' && e.statusType === 'damage_boost';

  /** 双方裸将、只有我方前锋带知己知彼：本局出现的增伤层只可能来自它 */
  function run(): BattleEvent[] {
    return runBattle({
      myTeam: [gen('my-front', '前锋', ['zhiji_zhibi']), gen('my-mid', '中军'), gen('my-back', '大营')],
      enemyTeam: [gen('enemy-front', '前锋'), gen('enemy-mid', '中军'), gen('enemy-back', '大营')],
      seed: 20261030,
      maxRounds: 8,
    }).events;
  }

  it('准备阶段与首次扣兵之前没有任何增伤层（不再有免费首层 8%）', () => {
    const events = run();
    const firstDamage = events.findIndex((e) => e.type === 'damage' || e.type === 'attack_hit');
    expect(firstDamage).toBeGreaterThan(-1);
    expect(events.slice(0, firstDamage).filter(isBoostInflict)).toHaveLength(0);
  });

  it('首次叠层就是第 1 层 8%（不是「免费首层 + 首击」的 16%）', () => {
    const events = run();
    const idx = events.findIndex(isBoostInflict);
    expect(idx).toBeGreaterThan(-1);
    const detail = (events[idx] as Extract<BattleEvent, { type: 'status_inflicted' }>).detail;
    expect(detail).toMatch(/(造成的|受到的)(攻击|策略攻击)伤害提高 8%/);
    expect(detail).not.toContain('16%');
  });
});
