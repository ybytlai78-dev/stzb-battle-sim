/**
 * 「控制效果 +1 目标」（`control_spread`，鸾凤和鸣）机制契约（2026-10-18 用户报障后建立）。
 *
 * 用户报障（原话）：「小乔给队友的状态没有正确生效，控制目标为加一」
 * 现场截图：第 7 回合【小乔&大乔】发动【双艳】，目标：贾诩、荀彧，紧接一行「小乔&大乔 的 control_spread 状态解除」
 * —— 状态被消耗了，战报里却看不到任何「+1 目标」的效果。
 *
 * 根因（旧实现）：
 *   ① 额外目标纯随机，若随机到**已处于同一控制**的敌军，同源重挂只是刷新 remaining 且不发事件 → 战报全静默；
 *   ② 没有额外目标（敌军全在本段目标池内 / 已阵亡 / 距离外）时照样消耗标记 → 状态白消耗；
 *   ③ 额外命中没有任何专门战报行，玩家无法分辨「这是 +1 目标」。
 *
 * 现口径（本文件锁定）：
 *   a. 额外目标优先取「当前没有该控制」的敌军（+1 一定带来新的被控对象）；
 *   b. 额外施加后必发一条 `status_changed`「控制扩散额外命中」战报（刷新时也发）；
 *   c. 只有本次控制真的产生了「新的被控对象」才消耗标记，否则保留到下一次控制。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, triggerActiveSkill, hasStatus, pickExtraControlTarget } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { General, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function general(id: string, patch: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position: '前锋',
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 50,
    attackRange: 3,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

function unit(id: string, side: 'my' | 'enemy', patch: Partial<General> = {}): UnitState {
  return {
    general: general(id, patch),
    side,
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function ctxOf(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  } as CombatContext;
}

/** 合成战法：对敌军群体 2 个目标施加暴走（等价双艳的控制段，发动率 100% 去掉随机性） */
function groupControlSkill(id = 'test_group_control'): Skill {
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['rampage'],
    output: [{ kind: 'inflict_status', status: { type: 'rampage', duration: 2 } }],
  } as Skill;
}

/** 合成战法：非控制的群体状态段（增伤 10%），用来验证「非控制段不触发扩散」 */
function groupBoostSkill(id = 'test_group_boost'): Skill {
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'group',
    groupCount: 2,
    targetSide: 'enemy',
    tags: ['damage_boost'],
    output: [{ kind: 'inflict_status', status: { type: 'damage_boost', rate: 0.1, duration: 2, direction: 'caused' } }],
  } as Skill;
}

function grantSpread(ctx: CombatContext, holder: UnitState): void {
  inflictStatus(ctx, holder, { type: 'control_spread', duration: 999 }, 'command', 'luanfeng_heming', holder.general.id);
}

function cast(ctx: CombatContext, caster: UnitState, skill: Skill): void {
  ctx.skills.set(skill.id, skill);
  triggerActiveSkill(ctx, caster, skill, [...ctx.enemyTeam], [...ctx.myTeam], [...ctx.enemyTeam]);
}

const spreadEvents = (ctx: CombatContext) => ctx.events.filter((e) => e.type === 'status_changed');

describe('控制扩散（control_spread，鸾凤和鸣）', () => {
  it('群体控制 + 第 3 名未被控的敌军 → 额外命中 1 个目标并消耗标记', () => {
    const caster = unit('caster', 'my');
    const e1 = unit('e1', 'enemy');
    const e2 = unit('e2', 'enemy');
    const e3 = unit('e3', 'enemy');
    const ctx = ctxOf([caster], [e1, e2, e3]);
    grantSpread(ctx, caster);

    cast(ctx, caster, groupControlSkill());

    // 本段 2 个 + 额外 1 个 = 3 名敌军全部陷入暴走
    for (const e of [e1, e2, e3]) expect(hasStatus(e, 'rampage')).toBe(true);
    // 额外命中发可见战报，且标注「新增控制」
    const changed = spreadEvents(ctx);
    expect(changed).toHaveLength(1);
    expect(changed[0].type === 'status_changed' && changed[0].detail).toContain('控制扩散额外命中');
    expect(changed[0].type === 'status_changed' && changed[0].detail).toContain('新增控制');
    // 标记用完即解除
    expect(hasStatus(caster, 'control_spread')).toBe(false);
    expect(
      ctx.events.some((e) => e.type === 'status_expired' && e.statusType === 'control_spread')
    ).toBe(true);
  });

  it('额外目标优先取「当前没有该控制」的敌军；全候选都已受控时退回任意候选（走刷新）', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const caster = unit('caster', 'my');
      const e1 = unit('e1', 'enemy', { position: '前锋' });
      const e2 = unit('e2', 'enemy', { position: '中军' });
      const e3 = unit('e3', 'enemy', { position: '大营' });
      const ctx = ctxOf([caster], [e1, e2, e3], seed);
      // e2 已处于暴走，e3 干净
      inflictStatus(ctx, e2, { type: 'rampage', duration: 2 }, 'active', 'test_group_control', caster.general.id);

      // 候选 = e2（已暴走）+ e3（干净）→ 必选 e3
      const picked = pickExtraControlTarget(ctx, caster, 5, [e1.general.id], 'rampage');
      expect(picked?.general.id).toBe('e3');

      // 候选只剩已暴走的 e2 → 退回全体候选（仍按官方口径额外施加一次，走刷新）
      const fallback = pickExtraControlTarget(ctx, caster, 5, [e1.general.id, e3.general.id], 'rampage');
      expect(fallback?.general.id).toBe('e2');

      // 候选全在同一距离外 → 无额外目标
      expect(pickExtraControlTarget(ctx, caster, 1, [e1.general.id], 'rampage')).toBeUndefined();
    }
  });

  it('三人敌军 + 群体控制：无论本段随机命中哪两人，额外目标都补上第三人', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const caster = unit('caster', 'my');
      const e1 = unit('e1', 'enemy', { position: '前锋' });
      const e2 = unit('e2', 'enemy', { position: '中军' });
      const e3 = unit('e3', 'enemy', { position: '大营' });
      const ctx = ctxOf([caster], [e1, e2, e3], seed);
      grantSpread(ctx, caster);

      cast(ctx, caster, groupControlSkill());

      // 本段 2 人 + 额外 1 人 = 3 人全部受控，且额外那次一定是「新增控制」
      expect([e1, e2, e3].every((e) => hasStatus(e, 'rampage'))).toBe(true);
      const changed = spreadEvents(ctx);
      expect(changed).toHaveLength(1);
      expect(changed[0].type === 'status_changed' && changed[0].detail).toContain('新增控制');
      expect(hasStatus(caster, 'control_spread')).toBe(false);
    }
  });

  it('敌军人数不多于本段目标数 → 没有额外目标，标记不消耗', () => {
    const caster = unit('caster', 'my');
    const e1 = unit('e1', 'enemy');
    const e2 = unit('e2', 'enemy');
    const ctx = ctxOf([caster], [e1, e2]);
    grantSpread(ctx, caster);

    cast(ctx, caster, groupControlSkill());

    expect(hasStatus(e1, 'rampage')).toBe(true);
    expect(hasStatus(e2, 'rampage')).toBe(true);
    expect(spreadEvents(ctx)).toHaveLength(0);
    // 空放不消耗
    expect(hasStatus(caster, 'control_spread')).toBe(true);
  });

  it('全场都已处于该控制 → 标记保留，且按「先施加者生效」不刷新时长（只发一条「本次不生效」）', () => {
    const caster = unit('caster', 'my');
    const enemies = [unit('e1', 'enemy'), unit('e2', 'enemy'), unit('e3', 'enemy')];
    const ctx = ctxOf([caster], enemies);
    const skill = groupControlSkill();
    for (const e of enemies) {
      inflictStatus(ctx, e, { type: 'rampage', duration: 2 }, 'active', skill.id, caster.general.id);
    }
    grantSpread(ctx, caster);
    ctx.events.length = 0;

    cast(ctx, caster, skill);

    // 包内 replace_type=3「不叠加·先施加者生效」（用户 2026-10-19 口径）：
    // 同源重挂不再刷新 remaining，而是明确「本次不生效」
    expect(
      ctx.events.some((e) => e.type === 'status_conflict' && e.statusType === 'rampage' && e.detail.includes('先施加者生效'))
    ).toBe(true);
    expect(
      ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'rampage' && e.detail.includes('（刷新）'))
    ).toBe(false);
    // 时长没有被续上
    const rampage = enemies[0].statuses.find((x) => x.type === 'rampage')!;
    expect(rampage.remaining).toBeLessThanOrEqual(2);
    // 额外目标只能落空，没有产生新的被控对象 → 标记保留
    const changed = spreadEvents(ctx);
    expect(changed).toHaveLength(1);
    expect(changed[0].type === 'status_changed' && changed[0].detail).toContain('先施加者生效');
    expect(hasStatus(caster, 'control_spread')).toBe(true);
  });

  it('非控制状态段（增伤）不触发扩散、不消耗标记', () => {
    const caster = unit('caster', 'my');
    const ctx = ctxOf([caster], [unit('e1', 'enemy'), unit('e2', 'enemy'), unit('e3', 'enemy')]);
    grantSpread(ctx, caster);

    cast(ctx, caster, groupBoostSkill());

    expect(spreadEvents(ctx)).toHaveLength(0);
    expect(hasStatus(caster, 'control_spread')).toBe(true);
  });

  it('数据口径：鸾凤和鸣每回合自身行动时给我军全体挂 control_spread（消耗制）', () => {
    const skill = SKILL_REGISTRY['luanfeng_heming'] as any;
    expect(skill.type).toBe('command');
    expect(skill.phase).toBe('round');
    expect(skill.roundTrigger).toBe('on_act');
    expect(skill.targetMode).toBe('all');
    expect(skill.targetSide).toBe('ally');
    const out = skill.output[0];
    expect(out.kind).toBe('inflict_status');
    expect(out.status.type).toBe('control_spread');
    expect(out.status.duration).toBe(999); // 占位：消耗制，不按回合递减
  });
});
