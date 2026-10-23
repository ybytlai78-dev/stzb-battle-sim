/**
 * 抵御的来源口径（用户口径）：抵御只覆盖**非一类指挥预备/延迟判定**施加的负面。
 *
 * - 一类指挥**预备**控制（战必断金 / 措手不及 / 白衣渡江的 roundRepeat 怯战）→ 不抵御、不消耗七擒七纵的 7 次计数；
 * - 一类指挥**延迟**结算的控制（帝临回光第 3 回合围困）→ 不抵御；
 * - 一类指挥**即时段 / 后续触发**（合纵连横普攻后 40% 围困）、二类指挥、主动 / 追击 / 被动来源 → 照常抵御；
 * - 七擒七纵的**伤害规避**路径不受影响（同一份 7 次共享计数）。
 */
import { describe, it, expect } from 'vitest';
import {
  applyDamage,
  hasStatus,
  inflictStatus,
  triggerDelayedOutputs,
  triggerPreparedEffectOnAct,
  type CombatContext,
} from '../src/engine/action';
import type { CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function dummyUnit(
  id: string,
  position: Position,
  extra: Partial<General> = {},
  side: 'my' | 'enemy' = 'my',
): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 80, defense: 80, strategy: 80, speed: 50, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

/** 判定一律成功：让「抵御/预备判定」只看规则，不看骰子 */
function alwaysSuccess(ctx: CombatContext): CombatContext {
  ctx.rng.chance = () => true;
  return ctx;
}

function lockCommand(ctx: CombatContext, skillId: string, casterId: string, targets: UnitState[]): void {
  ctx.lockedCommands.push({
    skill: SKILL_REGISTRY[skillId] as CommandSkill,
    casterId,
    targets,
    currentRate: 0,
  });
}

function resistedEvents(ctx: CombatContext) {
  return ctx.events.filter((e) => e.type === 'status_resisted');
}

describe('一类指挥预备判定：抵御不生效', () => {
  it('战必断金的预备怯战不被七擒七纵抵御，也不消耗 7 次计数', () => {
    const qizong = dummyUnit('qizong', '大营', { commandSkillIds: ['qiqin_qizong'] });
    const victim = dummyUnit('victim', '前锋');
    const zhanbi = dummyUnit('zhanbi_caster', '大营', { commandSkillIds: ['zhanbi_duanjin'] }, 'enemy');
    const ctx = alwaysSuccess(makeCtx([qizong, victim], [zhanbi]));
    lockCommand(ctx, 'zhanbi_duanjin', 'zhanbi_caster', [victim]);

    triggerPreparedEffectOnAct(ctx, victim);

    expect(hasStatus(victim, 'cowardice')).toBe(true);
    expect(resistedEvents(ctx)).toHaveLength(0);
    // 连判定都不该掷：七擒七纵不该出现任何 skill_trigger
    expect(ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'qiqin_qizong')).toHaveLength(0);
    expect(ctx.instanceGuards?.get('qizong:qiqin_qizong')?.used ?? 0).toBe(0);
  });

  it('同一战法在窗口外直接施加时仍可抵御（门是「预备窗口」，不是战法身份）', () => {
    const qizong = dummyUnit('qizong', '大营', { commandSkillIds: ['qiqin_qizong'] });
    const victim = dummyUnit('victim', '前锋');
    const zhanbi = dummyUnit('zhanbi_caster', '大营', { commandSkillIds: ['zhanbi_duanjin'] }, 'enemy');
    const ctx = alwaysSuccess(makeCtx([qizong, victim], [zhanbi]));

    inflictStatus(ctx, victim, { type: 'cowardice', duration: 1 }, 'command', 'zhanbi_duanjin', 'zhanbi_caster');

    expect(hasStatus(victim, 'cowardice')).toBe(false);
    expect(resistedEvents(ctx)).toHaveLength(1);
    expect(ctx.instanceGuards?.get('qizong:qiqin_qizong')?.used).toBe(1);
  });
});

describe('一类指挥延迟结算：抵御不生效', () => {
  it('帝临回光第 3 回合的围困不被审时定计抵御', () => {
    const lingdi = dummyUnit('lingdi', '前锋', { commandSkillIds: ['diling_huiguang'] });
    const chengyu = dummyUnit('chengyu', '大营', { commandSkillIds: ['shenshi_dingji'] });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = alwaysSuccess(makeCtx([lingdi, chengyu], [foe]));
    lockCommand(ctx, 'diling_huiguang', 'lingdi', [lingdi]);

    triggerDelayedOutputs(ctx, 3);

    expect(hasStatus(lingdi, 'siege')).toBe(true);
    expect(resistedEvents(ctx)).toHaveLength(0);
  });

  it('合纵连横（一类指挥，但围困来自普攻后的后续触发）仍可被审时定计抵御', () => {
    const chengyu = dummyUnit('chengyu', '大营', { commandSkillIds: ['shenshi_dingji'] });
    const victim = dummyUnit('victim', '前锋');
    const hezong = dummyUnit('hezong_caster', '大营', { commandSkillIds: ['hezong_lianheng'] }, 'enemy');
    const ctx = alwaysSuccess(makeCtx([chengyu, victim], [hezong]));

    // 窗口外（普攻命中后的 basicHitProc 触发时机）由指挥战法施加的围困
    inflictStatus(ctx, victim, { type: 'siege', duration: 2 }, 'command', 'hezong_lianheng', 'hezong_caster');

    expect(hasStatus(victim, 'siege')).toBe(false);
    expect(resistedEvents(ctx)).toHaveLength(1);
  });
});

describe('非预备来源照常抵御', () => {
  it('主动战法的怯战被七擒七纵抵御并计 1 次', () => {
    const qizong = dummyUnit('qizong', '大营', { commandSkillIds: ['qiqin_qizong'] });
    const victim = dummyUnit('victim', '前锋');
    const caster = dummyUnit('active_caster', '大营', {}, 'enemy');
    const ctx = alwaysSuccess(makeCtx([qizong, victim], [caster]));

    inflictStatus(ctx, victim, { type: 'cowardice', duration: 1 }, 'active', 'dangyang_qiao', 'active_caster');

    expect(hasStatus(victim, 'cowardice')).toBe(false);
    expect(resistedEvents(ctx)).toHaveLength(1);
    expect(ctx.instanceGuards?.get('qizong:qiqin_qizong')?.used).toBe(1);
  });

  it('追击战法的怯战被七擒七纵抵御', () => {
    const qizong = dummyUnit('qizong', '大营', { commandSkillIds: ['qiqin_qizong'] });
    const victim = dummyUnit('victim', '前锋');
    const caster = dummyUnit('pursuit_caster', '大营', {}, 'enemy');
    const ctx = alwaysSuccess(makeCtx([qizong, victim], [caster]));

    inflictStatus(ctx, victim, { type: 'cowardice', duration: 1 }, 'pursuit', 'dunbing_cuorui', 'pursuit_caster');

    expect(hasStatus(victim, 'cowardice')).toBe(false);
    expect(resistedEvents(ctx)).toHaveLength(1);
  });

  it('主动来源的围困与被动来源的挑衅仍被审时定计抵御', () => {
    const chengyu = dummyUnit('chengyu', '大营', { commandSkillIds: ['shenshi_dingji'] });
    const victim = dummyUnit('victim', '前锋');
    const caster = dummyUnit('caster', '大营', {}, 'enemy');
    const ctx = alwaysSuccess(makeCtx([chengyu, victim], [caster]));

    inflictStatus(ctx, victim, { type: 'siege', duration: 2 }, 'active', 'fengyi_ting', 'caster');
    inflictStatus(ctx, victim, { type: 'taunt', duration: 2, targetId: 'caster' }, 'passive', 'luoyi_aozhan', 'caster');

    expect(hasStatus(victim, 'siege')).toBe(false);
    expect(hasStatus(victim, 'taunt')).toBe(false);
    expect(resistedEvents(ctx)).toHaveLength(2);
  });
});

describe('七擒七纵的伤害规避路径不受影响', () => {
  it('受到伤害仍整段规避并消耗 1 次共享计数', () => {
    const qizong = dummyUnit('qizong', '大营', { commandSkillIds: ['qiqin_qizong'] });
    const victim = dummyUnit('victim', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = alwaysSuccess(makeCtx([qizong, victim], [foe]));

    applyDamage(ctx, victim, 500, foe, 'physical', 'basic');

    expect(victim.troops).toBe(10000);
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked')).toHaveLength(1);
    expect(ctx.instanceGuards?.get('qizong:qiqin_qizong')?.used).toBe(1);
  });
});
