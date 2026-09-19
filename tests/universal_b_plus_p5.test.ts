/**
 * 拆解通用 B+ 第五阶段 · 士气组：
 * 望风而降 / 激水之疾 / 蓄盈待竭 / 胜负先征 / 及锋而试。
 * 每战法 ≥3 个测试：装配挂槽与字段、机制分支结构、窗口（相对士气比较 / 伤害率递增）。
 */
import { describe, it, expect } from 'vitest';
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  General,
  Position,
  Skill,
  SkillOutput,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  effectiveMorale,
  triggerActiveSkill,
  triggerPassiveSkills,
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

function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.activeSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.passiveSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
}

/** 取输出段的单个 CreateStatus（数组形态返回 undefined） */
function inflictStatusOf(out: SkillOutput | undefined) {
  if (!out || out.kind !== 'inflict_status' || Array.isArray(out.status)) return undefined;
  return out.status;
}

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

/** 直接释放一次主动战法（发动率改 1），施法者 = myTeam 中挂该战法者 */
function castActive(
  ctx: CombatContext,
  skillId: string,
  patch: Record<string, unknown> = {}
): Extract<Skill, { type: 'active' }> {
  const base = asActive(skillId);
  const copy = { ...base, triggerRate: 1, ...patch } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  const caster = ctx.myTeam.find((u) => u.general.activeSkillIds.includes(skillId)) ?? ctx.myTeam[0];
  triggerActiveSkill(ctx, caster, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
  return copy;
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.skillId === skillId
  );

const triggers = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId
  );

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);
const hasStatus = (u: UnitState, type: string) => u.statuses.some((s) => s.type === type);
const setAllMorale = (units: UnitState[], morale: number) => {
  for (const u of units) u.general.morale = morale;
};

describe('望风而降（A 主动 40% 距离 5：2×策略 108% + 恐慌 98%，目标士气低于自身则几率 100%）', () => {
  it('装配：普通主动、random_single、range 5；三段输出（策略 ×2 + 士气分支）', () => {
    expect(activeTeam('wangfeng_erjiang')[0].activeSkillIds).toContain('wangfeng_erjiang');
    const s = asActive('wangfeng_erjiang');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'strategy_damage', 'morale_branch']);
  });

  it('机制：两段策略 108 受谋略无 growthRate；morale_branch compareTo caster，high 段 chance 0.5、low 段必中，恐慌 duration 1', () => {
    const s = asActive('wangfeng_erjiang');
    for (const out of s.output.slice(0, 2)) {
      if (out.kind !== 'strategy_damage') throw new Error('应为策略伤害');
      expect(out.rate).toBe(108);
      expect(out.strategyScaled).toBe(true);
      expect(out.growthRate).toBeUndefined();
    }
    const branch = s.output[2];
    if (branch.kind !== 'morale_branch') throw new Error('应为士气分支');
    expect(branch.compareTo).toBe('caster');
    expect(branch.by).toBe('target');
    expect(branch.high).toHaveLength(1);
    expect(branch.low).toHaveLength(1);
    expect(branch.high[0].kind === 'inflict_status' && branch.high[0].chance).toBe(0.5);
    expect(branch.low[0].kind === 'inflict_status' && branch.low[0].chance).toBeUndefined();
    const panic = inflictStatusOf(branch.low[0]);
    expect(panic?.type).toBe('panic');
    if (panic?.type === 'panic') {
      expect(panic.rate).toBe(98);
      expect(panic.duration).toBe(1);
      expect(panic.growthRate).toBe(0); // DoT growthRate 必填：0 = 不缩放
    }
  });

  it('窗口：目标士气低于自身 → 走 low 分支必定恐慌（同一目标吃 2 段策略 + 恐慌）', () => {
    const ctx = makeCtx(activeTeam('wangfeng_erjiang'));
    setAllMorale(ctx.enemyTeam, 50); // < 施法者 140
    castActive(ctx, 'wangfeng_erjiang');
    const hits = damageEvents(ctx, 'wangfeng_erjiang');
    expect(hits).toHaveLength(2);
    expect(hits[0].targetId).toBe(hits[1].targetId);
    const target = ctx.enemyTeam.find((u) => u.general.id === hits[0].targetId);
    expect(target && hasStatus(target, 'panic')).toBe(true);
  });

  it('窗口：目标士气不低于自身 → 走 high 分支，50% 几率按士气修正判定（140 士气 → 62%）', () => {
    const ctx = makeCtx(activeTeam('wangfeng_erjiang'));
    setAllMorale(ctx.enemyTeam, 200); // > 施法者 140
    castActive(ctx, 'wangfeng_erjiang');
    const roll = triggers(ctx, 'wangfeng_erjiang').find((e) => e.type === 'skill_trigger' && e.baseRate === 50);
    expect(roll?.type).toBe('skill_trigger');
    if (roll?.type === 'skill_trigger') {
      // 0.5 × 1.24 = 62%：几率类一律吃士气加成（用户 2026-09-19 口径）
      expect(roll.rate).toBe(62);
      expect(roll.baseRate).toBe(50);
      expect(roll.morale).toBe(140);
    }
  });
});

describe('激水之疾（A 主动 35% 距离 4：群体策略 180%，目标士气低于自身则谋略 −20）', () => {
  it('装配：普通主动、群体 2 目标、range 4；输出为策略 + 士气分支', () => {
    const s = asActive('jishui_zhiji');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'morale_branch']);
  });

  it('机制：策略 180 受谋略无 growthRate；high 段空、low 段谋略 −20 duration 2 受谋略无 growthRate', () => {
    const s = asActive('jishui_zhiji');
    const dmg = s.output[0];
    if (dmg.kind !== 'strategy_damage') throw new Error('应为策略伤害');
    expect(dmg.rate).toBe(180);
    expect(dmg.strategyScaled).toBe(true);
    expect(dmg.growthRate).toBeUndefined();
    const branch = s.output[1];
    if (branch.kind !== 'morale_branch') throw new Error('应为士气分支');
    expect(branch.compareTo).toBe('caster');
    expect(branch.by).toBe('target');
    expect(branch.high).toHaveLength(0);
    const st = inflictStatusOf(branch.low[0]);
    expect(st?.type).toBe('strategy_buff');
    if (st?.type === 'strategy_buff') {
      expect(st.amount).toBe(-20);
      expect(st.duration).toBe(2); // 「持续 1 回合」= 覆盖目标下一个行动回合（辕门射戟口径）
      expect(st.strategyScaled).toBe(true);
      expect(st.growthRate).toBeUndefined();
    }
  });

  it('窗口：两名目标士气都低于自身 → 两名都吃谋略 −20（duration 2）', () => {
    const ctx = makeCtx(activeTeam('jishui_zhiji'));
    setAllMorale(ctx.enemyTeam, 100); // < 施法者 140
    castActive(ctx, 'jishui_zhiji');
    const debuffed = ctx.enemyTeam.filter((u) => {
      const st = statusOf(u, 'strategy_buff');
      return st?.type === 'strategy_buff' && st.amount === -20;
    });
    expect(debuffed).toHaveLength(2);
    for (const u of debuffed) {
      const st = statusOf(u, 'strategy_buff');
      if (st?.type === 'strategy_buff') expect(st.remaining).toBe(2);
    }
  });

  it('窗口：目标士气高于自身 → 走 high 空段，不打谋略 debuff', () => {
    const ctx = makeCtx(activeTeam('jishui_zhiji'));
    setAllMorale(ctx.enemyTeam, 200); // > 施法者 140
    castActive(ctx, 'jishui_zhiji');
    expect(ctx.enemyTeam.some((u) => hasStatus(u, 'strategy_buff'))).toBe(false);
    expect(damageEvents(ctx, 'jishui_zhiji').length).toBeGreaterThan(0);
  });
});

describe('蓄盈待竭（B 主动 35% 距离 4：随机敌单体——士气低于自身则攻击 200%，否则自身三维 +60）', () => {
  it('装配：普通主动、random_single、range 4；单段士气分支', () => {
    const s = asActive('xuying_daijie');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('random_single');
    expect(s.output.map((o) => o.kind)).toEqual(['morale_branch']);
  });

  it('机制：compareTo caster；low = 攻击 200%；high = 自身攻/防/谋 +60 duration 2', () => {
    const branch = asActive('xuying_daijie').output[0];
    if (branch.kind !== 'morale_branch') throw new Error('应为士气分支');
    expect(branch.compareTo).toBe('caster');
    expect(branch.by).toBe('target');
    const dmg = branch.low[0];
    if (dmg.kind !== 'physical_damage') throw new Error('应为攻击伤害');
    expect(dmg.rate).toBe(200);
    expect(branch.high).toHaveLength(3);
    const types = branch.high.map((o) => inflictStatusOf(o)?.type);
    expect(types).toEqual(['attack_buff', 'defense_buff', 'strategy_buff']);
    for (const o of branch.high) {
      const st = inflictStatusOf(o);
      if (st && 'amount' in st) expect(st.amount).toBe(60);
      if (st && 'duration' in st) expect(st.duration).toBe(2);
    }
  });

  it('窗口：目标士气低于自身 → 结算一次攻击、自身不拿三维增益', () => {
    const ctx = makeCtx(activeTeam('xuying_daijie'));
    setAllMorale(ctx.enemyTeam, 60); // < 施法者 140
    castActive(ctx, 'xuying_daijie');
    const hits = damageEvents(ctx, 'xuying_daijie');
    expect(hits).toHaveLength(1);
    expect(['enemy-front', 'enemy-mid', 'enemy-back']).toContain(hits[0].targetId);
    expect(ctx.myTeam.some((u) => hasStatus(u, 'attack_buff'))).toBe(false);
  });

  it('窗口：目标士气不低于自身 → 不结算伤害，自身攻/防/谋 +60', () => {
    const ctx = makeCtx(activeTeam('xuying_daijie'));
    setAllMorale(ctx.enemyTeam, 200); // > 施法者 140
    castActive(ctx, 'xuying_daijie');
    expect(damageEvents(ctx, 'xuying_daijie')).toHaveLength(0);
    const caster = ctx.myTeam.find((u) => u.general.id === 'carrier');
    if (!caster) throw new Error('无载体');
    for (const type of ['attack_buff', 'defense_buff', 'strategy_buff']) {
      const st = statusOf(caster, type);
      expect(st?.type).toBe(type);
      if (st && 'amount' in st) expect(st.amount).toBe(60);
    }
  });
});

describe('胜负先征（A 被动：己方士气高昂 → 主动/追击伤害 +40%；一般/低落 → 受击恢复 75%）', () => {
  it('装配：round_start 被动、目标自己；单段士气分支', () => {
    expect(passiveTeam('shengfu_xianzheng')[0].passiveSkillIds).toContain('shengfu_xianzheng');
    const s = asPassive('shengfu_xianzheng');
    expect(s.timing).toBe('round_start');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(1);
    expect(s.output.map((o) => o.kind)).toEqual(['morale_branch']);
  });

  it('机制：by caster + threshold 100；high = 主动/追击 +40% duration 1；low = grant_first_aid 75% duration 1', () => {
    const branch = asPassive('shengfu_xianzheng').output[0];
    if (branch.kind !== 'morale_branch') throw new Error('应为士气分支');
    expect(branch.by).toBe('caster');
    expect(branch.threshold).toBe(100);
    expect(branch.compareTo).toBeUndefined(); // 缺省 = 阈值口径
    const boost = inflictStatusOf(branch.high[0]);
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') {
      expect(boost.rate).toBe(0.4);
      expect(boost.duration).toBe(1);
      expect(boost.direction).toBe('caused');
      expect(boost.skillTypes).toEqual(['active', 'pursuit']);
    }
    const aid = branch.low[0];
    expect(aid.kind).toBe('grant_first_aid');
    if (aid.kind === 'grant_first_aid') {
      expect(aid.rate).toBe(100);
      expect(aid.healRate).toBe(75);
      expect(aid.healGrowthRate).toBe(0); // 受谋略但成长率未确认 → 0 = 不缩放
      expect(aid.duration).toBe(1);
    }
  });

  it('窗口：士气 140（高昂）→ 自身获得主动/追击 +40%', () => {
    const ctx = makeCtx(passiveTeam('shengfu_xianzheng'));
    const carrier = ctx.myTeam[0];
    ctx.currentRound = 1;
    triggerPassiveSkills(ctx, carrier, 'round_start');
    const boost = statusOf(carrier, 'damage_boost');
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') expect(boost.rate).toBe(0.4);
    expect(hasStatus(carrier, 'first_aid')).toBe(false);
  });

  it('窗口：士气 80（低落）→ 自身获得受击恢复（first_aid 75%）', () => {
    const ctx = makeCtx(passiveTeam('shengfu_xianzheng'));
    const carrier = ctx.myTeam[0];
    carrier.general.morale = 80;
    // 恢复率受谋略缩放：谋略 ≥80 且 growthRate 0 → 恰为基值 75（谋略 <80 会走 <80 折减，属既有口径）
    carrier.general.strategy = 100;
    ctx.currentRound = 1;
    triggerPassiveSkills(ctx, carrier, 'round_start');
    const aid = statusOf(carrier, 'first_aid');
    expect(aid?.type).toBe('first_aid');
    if (aid?.type === 'first_aid') {
      expect(aid.healRate).toBe(75);
      expect(aid.remaining).toBe(1);
    }
    expect(hasStatus(carrier, 'damage_boost')).toBe(false);
  });

  it('窗口：士气恰好 100（一般）→ 走 low（一般/低落），与计定山越同口径', () => {
    const ctx = makeCtx(passiveTeam('shengfu_xianzheng'));
    const carrier = ctx.myTeam[0];
    carrier.general.morale = 100;
    ctx.currentRound = 1;
    triggerPassiveSkills(ctx, carrier, 'round_start');
    expect(hasStatus(carrier, 'first_aid')).toBe(true);
    expect(hasStatus(carrier, 'damage_boost')).toBe(false);
  });
});

describe('及锋而试（S 主动 35% 距离 5：群体攻击 120% + 士气 −10，每次发动后伤害率 +40%）', () => {
  it('装配：普通主动、群体 2 目标、range 5、damageRatePerCast 40', () => {
    const s = asActive('jifeng_ershi');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.damageRatePerCast).toBe(40);
  });

  it('机制：攻击 120 + 士气 −10 整场常驻（morale_boost 负值）', () => {
    const s = asActive('jifeng_ershi');
    const dmg = s.output[0];
    if (dmg.kind !== 'physical_damage') throw new Error('应为攻击伤害');
    expect(dmg.rate).toBe(120);
    const st = inflictStatusOf(s.output[1]);
    expect(st?.type).toBe('morale_boost');
    if (st?.type === 'morale_boost') {
      expect(st.amount).toBe(-10);
      expect(st.duration).toBe(999);
    }
  });

  it('窗口：此前发动 1 次时伤害率按 +40 结算（同种子对比：后续发动更痛）', () => {
    const base = makeCtx(activeTeam('jifeng_ershi'), 7);
    castActive(base, 'jifeng_ershi');
    const dmg1 = damageEvents(base, 'jifeng_ershi')[0].damage;

    const boosted = makeCtx(activeTeam('jifeng_ershi'), 7);
    boosted.skillCastCounters = new Map([['carrier:jifeng_ershi', 1]]);
    castActive(boosted, 'jifeng_ershi');
    const dmg2 = damageEvents(boosted, 'jifeng_ershi')[0].damage;

    expect(dmg2).toBeGreaterThan(dmg1);
  });

  it('窗口：每次发动后计数 +1，且两名目标士气 −10（100 → 90）', () => {
    const ctx = makeCtx(activeTeam('jifeng_ershi'));
    castActive(ctx, 'jifeng_ershi');
    expect(ctx.skillCastCounters?.get('carrier:jifeng_ershi')).toBe(1);
    const hits = damageEvents(ctx, 'jifeng_ershi');
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      const target = ctx.enemyTeam.find((u) => u.general.id === hit.targetId);
      if (!target) throw new Error('无目标');
      expect(effectiveMorale(target)).toBe(90);
    }
    castActive(ctx, 'jifeng_ershi');
    expect(ctx.skillCastCounters?.get('carrier:jifeng_ershi')).toBe(2);
  });
});
