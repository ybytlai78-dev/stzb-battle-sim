/**
 * 拆解通用 B 级以上 · 第三阶段受攻击缩放：
 * 万箭齐发 / 文伐 / 不攻 / 恃强淬锋。
 * 每战法 3 个测试：装配挂槽与字段、机制事件/状态、窗口。
 */
import { describe, it, expect } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CommandSkill,
  General,
  Position,
  Skill,
  SkillOutput,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  triggerActiveSkill,
  triggerPassiveSkills,
  tickRoundStartStatuses,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';

function dummy(id: string, position: Position, troops = 10000): General {
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
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
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
  const front = dummy('enemy-front', '前锋');
  front.speed = 200;
  front.attack = 180;
  return [front, dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '中军', 10000);
  carrier.attack = 120;
  carrier.speed = 40;
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

/**
 * 主动战法挂前锋；morale 140 便于发动（装配测仍不依赖发动成功）。
 */
function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.activeSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function asCommand(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

/**
 * 断言 registry 条目为追击。
 */
function asPursuit(id: string): Extract<Skill, { type: 'pursuit' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'pursuit') throw new Error(`${id} 不是追击`);
  return s;
}

/**
 * 断言 registry 条目为被动。
 */
function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
}

/**
 * 追击挂前锋；morale 140 便于发动（装配测不依赖发动成功）。
 */
function pursuitTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.pursuitSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

/**
 * 被动挂前锋。
 */
function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function inflictStatusOf(out: SkillOutput | undefined) {
  if (!out || out.kind !== 'inflict_status' || Array.isArray(out.status)) return undefined;
  return out.status;
}

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

function unitFrom(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
    hasActedThisRound: false,
  };
}

function makeCtx(my: General[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemyTeam().map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

describe('万箭齐发（A 主动 35%：群体 2 攻击 150% + 策略造成 −50% 受攻击）', () => {
  it('装配：prepare false、triggerRate 0.35、range 5、groupCount 2、group', () => {
    expect(activeTeam('wanjian_qifa')[0].activeSkillIds).toContain('wanjian_qifa');
    const s = asActive('wanjian_qifa');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(5);
    expect(s.groupCount).toBe(2);
    expect(s.targetMode).toBe('group');
  });

  it('机制：output[0] 攻击 150；output[1] 策略 caused −0.5 duration 1 attackScaled 无 growthRate', () => {
    const s = asActive('wanjian_qifa');
    expect(s.output[0].kind).toBe('physical_damage');
    if (s.output[0].kind === 'physical_damage') expect(s.output[0].rate).toBe(150);
    const st = inflictStatusOf(s.output[1]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(-0.5);
      expect(st.duration).toBe(1); // 官方「持续 1 回合」字面值（新口径 action-end 递减）
      expect(st.direction).toBe('caused');
      expect(st.damageType).toBe('strategy');
      expect(st.attackScaled).toBe(true);
      expect(st.growthRate).toBeUndefined();
    }
  });

  it('窗口：attackScaled 且无 growthRate；拷贝 triggerRate 1 可发动挂状态', () => {
    const s = asActive('wanjian_qifa');
    const st = inflictStatusOf(s.output[1]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.attackScaled).toBe(true);
      expect('growthRate' in st).toBe(false);
    }
    const team = activeTeam('wanjian_qifa');
    team[0].morale = 100;
    const ctx = makeCtx(team);
    ctx.currentRound = 1;
    const skillCopy: Skill = { ...s, triggerRate: 1 };
    ctx.skills.set('wanjian_qifa', skillCopy);
    const caster = ctx.myTeam[0];
    triggerActiveSkill(ctx, caster, skillCopy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
    expect(ctx.events.some((e) => e.type === 'skill_cast' && e.skillId === 'wanjian_qifa')).toBe(true);
    expect(
      ctx.enemyTeam.some((u) =>
        u.statuses.some((row) => row.type === 'damage_boost' && row.rate === -0.5 && row.direction === 'caused')
      )
    ).toBe(true);
  });
});

describe('文伐（B 追击 20%–40%：策略 228% + 下一次受到策略 +20%）', () => {
  it('装配：asPursuit triggerRate 为 [0.2, 0.4]', () => {
    expect(pursuitTeam('wenfa')[0].pursuitSkillIds).toContain('wenfa');
    expect(asPursuit('wenfa').triggerRate).toEqual([0.2, 0.4]);
  });

  it('机制：output[0] strategy 228 growthRate 2.1；output[1] taken +0.2 charges 1 strategy', () => {
    const s = asPursuit('wenfa');
    expect(s.output[0].kind).toBe('strategy_damage');
    if (s.output[0].kind === 'strategy_damage') {
      expect(s.output[0].rate).toBe(228);
      expect(s.output[0].growthRate).toBe(2.1);
    }
    const st = inflictStatusOf(s.output[1]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(0.2);
      expect(st.direction).toBe('taken');
      expect(st.charges).toBe(1);
      expect(st.damageType).toBe('strategy');
    }
  });

  it('窗口：output 顺序为 strategy_damage 再 inflict_status', () => {
    expect(asPursuit('wenfa').output.map((o) => o.kind)).toEqual(['strategy_damage', 'inflict_status']);
  });
});

describe('不攻（S 一类指挥：自身怯战 + 策略 +25% + 每回合策略 83%）', () => {
  it('装配：phase prep、targetMode self、range 1', () => {
    expect(commandTeam('bugong')[1].commandSkillIds).toContain('bugong');
    const s = asCommand('bugong');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(1);
  });

  it('机制：output 含怯战 999 与策略 caused +0.25 duration 999', () => {
    const statuses = asCommand('bugong')
      .output.map((o) => inflictStatusOf(o))
      .filter((st): st is NonNullable<typeof st> => st != null);
    expect(statuses.some((st) => st.type === 'cowardice' && st.duration === 999)).toBe(true);
    expect(
      statuses.some(
        (st) =>
          st.type === 'damage_boost' &&
          st.rate === 0.25 &&
          st.duration === 999 &&
          st.direction === 'caused' &&
          st.damageType === 'strategy'
      )
    ).toBe(true);
  });

  it('窗口：run 2 回合载体有怯战、有 bugong 策略伤害、载体无 attack_hit', () => {
    const report = run(commandTeam('bugong'), 1, 2);
    expect(inflicted(report, 'cowardice').some((e) => e.unitId === 'carrier')).toBe(true);
    expect(
      report.events.some(
        (e) => e.type === 'damage' && e.skillId === 'bugong' && e.damageType === 'strategy'
      )
    ).toBe(true);
    expect(report.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'carrier')).toHaveLength(0);
  });
});

describe('恃强淬锋（A 被动：策略 taken −30% 五份衰减 + 攻击叠层 3.4%）', () => {
  it('装配：battle_start、selfPhysBoost maxStacks 12 perStack 0.034', () => {
    expect(passiveTeam('shiqiang_cuifeng')[0].passiveSkillIds).toContain('shiqiang_cuifeng');
    const s = asPassive('shiqiang_cuifeng');
    expect(s.timing).toBe('battle_start');
    expect(s.selfPhysBoost?.maxStacks).toBe(12);
    expect(s.selfPhysBoost?.perStack).toBe(0.034);
  });

  it('机制：output taken −0.3 decayFifths 5 attackScaled damageType strategy', () => {
    const st = inflictStatusOf(asPassive('shiqiang_cuifeng').output[0]);
    expect(st?.type).toBe('damage_boost');
    if (st?.type === 'damage_boost') {
      expect(st.rate).toBe(-0.3);
      expect(st.direction).toBe('taken');
      expect(st.decayFifths).toBe(5);
      expect(st.attackScaled).toBe(true);
      expect(st.damageType).toBe('strategy');
    }
  });

  it('窗口：run 1 回合载体 taken fifths 5，caused physical stacks ≥ 1', () => {
    const team = passiveTeam('shiqiang_cuifeng');
    const report = run(team, 1, 1);
    expect(inflicted(report, 'damage_boost').some((e) => e.unitId === 'carrier')).toBe(true);

    const ctx = makeCtx(team);
    const caster = ctx.myTeam.find((u) => u.general.id === 'carrier');
    if (!caster) throw new Error('无载体');
    triggerPassiveSkills(ctx, caster, 'battle_start');
    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const taken = caster.statuses.find((st) => st.type === 'damage_boost' && st.direction === 'taken');
    expect(taken?.type).toBe('damage_boost');
    if (taken?.type === 'damage_boost') expect(taken.fifths).toBe(5);
    const caused = caster.statuses.find((st) => st.type === 'damage_boost' && st.direction === 'caused');
    expect(caused?.type).toBe('damage_boost');
    if (caused?.type === 'damage_boost') {
      expect(caused.damageType).toBe('physical');
      expect(caused.stacks ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
});
