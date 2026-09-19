/**
 * 拆解通用 B+ 第四阶段 · 距离 +1 与特殊目标选择：
 * 远攻秘策 / 远攻之策 / 远攻奇略 / 远攻强化 / 近攻 / 远射 / 连环 / 兼弱攻昧 / 始计 / 铁戟金戈。
 * 每战法 ≥3 个测试：装配挂槽与字段、机制事件/状态、窗口与目标口径。
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
  applyDamage,
  triggerActiveSkill,
  triggerCommandSkills,
  triggerPassiveSkills,
  triggerRoundCommandOnAct,
  tickRoundStartStatuses,
  type CombatContext,
} from '../src/engine/action';
import { skillTargets } from '../src/engine/target';
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

function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '中军', 10000);
  carrier.commandSkillIds = [skillId];
  return [dummy('ally-front', '前锋', 10000), carrier, dummy('ally-back', '大营', 10000)];
}

function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.passiveSkillIds = [skillId];
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

function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
}

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

/**
 * 直接释放一次主动战法（发动率改 1，准备战法补 prepare:false），用于确定性机制断言。
 * 施法者 = myTeam 中挂该战法者（activeTeam 挂前锋；自定义队伍可挂大营）。
 */
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

const statusTypeOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);

/** CreateStatus 里 evasion 等无 duration 字段的成员：取 duration 时统一走此助手 */
const durationOf = (st: CreateStatus | undefined) => (st && 'duration' in st ? st.duration : undefined);

describe('远攻秘策（B 一类指挥：自身攻/谋 +20、攻击距离 +1；友军前 3 回合同样增益）', () => {
  it('装配：prep、self、range 3；output 4 段（自 3 + 友军 1）', () => {
    expect(commandTeam('yuangong_mice')[1].commandSkillIds).toContain('yuangong_mice');
    const s = asCommand('yuangong_mice');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(3);
    expect(s.output).toHaveLength(4);
    expect(s.tags).toEqual(expect.arrayContaining(['attack_buff', 'strategy_buff', 'range_buff']));
  });

  it('机制：自身三段常驻 999；友军段 excludeSelf + applyAll、三状态 duration 3', () => {
    const s = asCommand('yuangong_mice');
    const selfTypes = s.output.slice(0, 3).map((o) => inflictStatusOf(o)?.type);
    expect(selfTypes).toEqual(['attack_buff', 'strategy_buff', 'range_buff']);
    for (const o of s.output.slice(0, 3)) {
      const st = inflictStatusOf(o);
      expect(durationOf(st)).toBe(999);
    }
    const ally = s.output[3];
    expect(ally.kind).toBe('inflict_status');
    if (ally.kind === 'inflict_status') {
      expect(ally.targetSide).toBe('ally');
      expect(ally.targetMode).toBe('all');
      expect(ally.excludeSelf).toBe(true);
      expect(ally.applyAll).toBe(true);
      expect(Array.isArray(ally.status)).toBe(true);
      if (Array.isArray(ally.status)) {
        expect(ally.status.map((st) => st.type)).toEqual(['attack_buff', 'strategy_buff', 'range_buff']);
        for (const st of ally.status) expect(durationOf(st)).toBe(3);
      }
    }
  });

  it('窗口：准备阶段结算——载体自身常驻距离 +1，两名友军获得前 3 回合增益（不含载体）', () => {
    const ctx = makeCtx(commandTeam('yuangong_mice'));
    const carrier = ctx.myTeam[1];
    triggerCommandSkills(ctx, carrier);
    const carrierRange = statusTypeOf(carrier, 'range_buff');
    expect(carrierRange?.type).toBe('range_buff');
    if (carrierRange?.type === 'range_buff') expect(carrierRange.remaining).toBe(999);
    for (const ally of [ctx.myTeam[0], ctx.myTeam[2]]) {
      const range = statusTypeOf(ally, 'range_buff');
      expect(range?.type).toBe('range_buff');
      if (range?.type === 'range_buff') expect(range.remaining).toBe(3);
      expect(statusTypeOf(ally, 'attack_buff')?.type).toBe('attack_buff');
    }
  });
});

describe('远攻之策（C 一类指挥：前 3 回合我军群体攻击 +20、每回合攻击距离 +1）', () => {
  it('装配：prep、ally 群体 2、roundStartRepeat 1~3 回合', () => {
    const s = asCommand('yuangong_zhiche');
    expect(s.phase).toBe('prep');
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.range).toBe(2);
    expect(s.roundStartRepeat?.startRound).toBe(1);
    expect(s.roundStartRepeat?.endRound).toBe(3);
  });

  it('机制：主 output 攻击 +20 duration 3；回合段为 range_buff +1 duration 1', () => {
    const s = asCommand('yuangong_zhiche');
    const atk = inflictStatusOf(s.output[0]);
    expect(atk?.type).toBe('attack_buff');
    if (atk?.type === 'attack_buff') {
      expect(atk.amount).toBe(20);
      expect(atk.duration).toBe(3);
    }
    const range = inflictStatusOf(s.roundStartRepeat?.output[0]);
    expect(range?.type).toBe('range_buff');
    if (range?.type === 'range_buff') {
      expect(range.amount).toBe(1);
      expect(range.duration).toBe(1);
    }
  });

  it('窗口：准备阶段 2 名我军群体得攻击 +20；第 1 回合开始刷新 range_buff duration 1', () => {
    const ctx = makeCtx(commandTeam('yuangong_zhiche'));
    const carrier = ctx.myTeam[1];
    triggerCommandSkills(ctx, carrier);
    const locked = ctx.lockedCommands[0];
    expect(locked.targets).toHaveLength(2);
    for (const t of locked.targets) expect(statusTypeOf(t, 'attack_buff')?.type).toBe('attack_buff');

    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    for (const t of locked.targets) {
      const range = statusTypeOf(t, 'range_buff');
      expect(range?.type).toBe('range_buff');
      if (range?.type === 'range_buff') expect(range.remaining).toBe(1);
    }
  });

  it('窗口：第 4 回合起不再刷新攻击距离（前 3 回合限定）', () => {
    const ctx = makeCtx(commandTeam('yuangong_zhiche'));
    triggerCommandSkills(ctx, ctx.myTeam[1]);
    ctx.currentRound = 4;
    tickRoundStartStatuses(ctx);
    expect(ctx.myTeam.some((u) => statusTypeOf(u, 'range_buff'))).toBe(false);
  });
});

describe('远攻奇略（C 被动：自身攻击距离 +1 + 策略攻击伤害 +15%）', () => {
  it('装配：battle_start 被动、self、range 1', () => {
    expect(passiveTeam('yuangong_qilue')[0].passiveSkillIds).toContain('yuangong_qilue');
    const s = asPassive('yuangong_qilue');
    expect(s.timing).toBe('battle_start');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(1);
  });

  it('机制：range_buff +1 常驻；damage_boost caused strategy +0.15 无 growthRate', () => {
    const s = asPassive('yuangong_qilue');
    const range = inflictStatusOf(s.output[0]);
    expect(range?.type).toBe('range_buff');
    if (range?.type === 'range_buff') {
      expect(range.amount).toBe(1);
      expect(range.duration).toBe(999);
    }
    const boost = inflictStatusOf(s.output[1]);
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') {
      expect(boost.rate).toBe(0.15);
      expect(boost.direction).toBe('caused');
      expect(boost.damageType).toBe('strategy');
      expect(boost.growthRate).toBeUndefined();
    }
  });

  it('窗口：开战被动结算后载体同时有攻击距离与策略增伤', () => {
    const ctx = makeCtx(passiveTeam('yuangong_qilue'));
    const carrier = ctx.myTeam[0];
    triggerPassiveSkills(ctx, carrier, 'battle_start');
    expect(statusTypeOf(carrier, 'range_buff')?.type).toBe('range_buff');
    const boost = statusTypeOf(carrier, 'damage_boost');
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') expect(boost.rate).toBe(0.15);
  });
});

describe('远攻强化（C 被动：自身攻击距离 +1 + 攻击 +15）', () => {
  it('装配：battle_start 被动、self、range 1', () => {
    expect(passiveTeam('yuangong_qianghua')[0].passiveSkillIds).toContain('yuangong_qianghua');
    const s = asPassive('yuangong_qianghua');
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
  });

  it('机制：range_buff +1 常驻 + attack_buff +15 常驻', () => {
    const s = asPassive('yuangong_qianghua');
    const range = inflictStatusOf(s.output[0]);
    expect(range?.type).toBe('range_buff');
    const atk = inflictStatusOf(s.output[1]);
    expect(atk?.type).toBe('attack_buff');
    if (atk?.type === 'attack_buff') {
      expect(atk.amount).toBe(15);
      expect(atk.duration).toBe(999);
    }
  });

  it('窗口：开战被动结算后载体攻击 +15 且距离 +1', () => {
    const ctx = makeCtx(passiveTeam('yuangong_qianghua'));
    const carrier = ctx.myTeam[0];
    triggerPassiveSkills(ctx, carrier, 'battle_start');
    const atk = statusTypeOf(carrier, 'attack_buff');
    expect(atk?.type).toBe('attack_buff');
    if (atk?.type === 'attack_buff') expect(atk.amount).toBe(15);
    expect(statusTypeOf(carrier, 'range_buff')?.type).toBe('range_buff');
  });
});

describe('近攻（C 主动 30% 距离 3：对有效距离内最近敌军攻击 200%）', () => {
  it('装配：普通主动、targetMode nearest、range 3、攻击 200', () => {
    expect(activeTeam('jingong')[0].activeSkillIds).toContain('jingong');
    const s = asActive('jingong');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.3);
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('nearest');
    expect(s.targetSide).toBe('enemy');
    if (s.output[0].kind === 'physical_damage') expect(s.output[0].rate).toBe(200);
  });

  it('机制：nearest 模式取有效距离内最近（前锋→敌前锋），与 random_single 区分', () => {
    const ctx = makeCtx(activeTeam('jingong'));
    const caster = ctx.myTeam[0];
    const picked = skillTargets(ctx, caster, ctx.enemyTeam, 3, 'nearest');
    expect(picked).toHaveLength(1);
    expect(picked[0].general.id).toBe('enemy-front');
  });

  it('窗口：释放一次只结算 1 条伤害，目标为最近的敌前锋', () => {
    const ctx = makeCtx(activeTeam('jingong'));
    castActive(ctx, 'jingong');
    const hits = damageEvents(ctx, 'jingong');
    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe('enemy-front');
    expect(hits[0].damageType).toBe('physical');
  });
});

describe('远射（C 准备主动 35% 距离 3：对有效距离内最远敌军攻击 255%）', () => {
  it('装配：准备主动、targetMode farthest、range 3、攻击 255', () => {
    const s = asActive('yuanshe');
    expect(s.prepare).toBe(true);
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('farthest');
    if (s.output[0].kind === 'physical_damage') expect(s.output[0].rate).toBe(255);
  });

  it('机制：farthest 模式取有效距离内最远（前锋→敌大营），nearest 则取最近', () => {
    const ctx = makeCtx(activeTeam('yuanshe'));
    const caster = ctx.myTeam[0];
    expect(skillTargets(ctx, caster, ctx.enemyTeam, 3, 'farthest')[0].general.id).toBe('enemy-back');
    expect(skillTargets(ctx, caster, ctx.enemyTeam, 3, 'nearest')[0].general.id).toBe('enemy-front');
  });

  it('窗口：释放一次结算 1 条伤害，目标为最远的敌大营', () => {
    const ctx = makeCtx(activeTeam('yuanshe'));
    castActive(ctx, 'yuanshe', { prepare: false });
    const hits = damageEvents(ctx, 'yuanshe');
    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe('enemy-back');
  });
});

describe('连环（B 准备主动 45% 距离 4：最远单体策略 132% + 随机单体策略 198%）', () => {
  it('装配：准备主动、targetMode farthest、range 4、两段策略', () => {
    const s = asActive('lianhuan');
    expect(s.prepare).toBe(true);
    expect(s.triggerRate).toBe(0.45);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('farthest');
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'strategy_damage']);
  });

  it('机制：132% strategyScaled 无 growthRate；198% 段 targetMode random_single、同样无 growthRate', () => {
    const s = asActive('lianhuan');
    const [first, second] = s.output;
    if (first.kind === 'strategy_damage') {
      expect(first.rate).toBe(132);
      expect(first.strategyScaled).toBe(true);
      expect(first.growthRate).toBeUndefined();
    }
    if (second.kind === 'strategy_damage') {
      expect(second.rate).toBe(198);
      expect(second.strategyScaled).toBe(true);
      expect(second.growthRate).toBeUndefined();
      expect(second.targetMode).toBe('random_single');
    }
  });

  it('窗口：段1 打最远敌大营，段2 在有效距离内独立随机（共 2 条策略伤害）', () => {
    const ctx = makeCtx(activeTeam('lianhuan'));
    castActive(ctx, 'lianhuan', { prepare: false });
    const hits = damageEvents(ctx, 'lianhuan');
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.damageType === 'strategy')).toBe(true);
    expect(hits[0].targetId).toBe('enemy-back');
    expect(['enemy-front', 'enemy-mid', 'enemy-back']).toContain(hits[1].targetId);
  });
});

describe('兼弱攻昧（A 主动 35% 距离 4：有效距离内防御最低攻击 200% + 谋略最低策略 159%）', () => {
  it('装配：普通主动、range 4、两段 targetPick 都限有效距离内', () => {
    const s = asActive('jianruo_gongmei');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    const first = s.output[0];
    const second = s.output[1];
    if (first.kind === 'physical_damage') {
      expect(first.rate).toBe(200);
      expect(first.targetPick).toBe('lowest_defense_in_range');
    }
    if (second.kind === 'strategy_damage') {
      expect(second.rate).toBe(159);
      expect(second.strategyScaled).toBe(true);
      expect(second.growthRate).toBeUndefined();
      expect(second.targetPick).toBe('lowest_strategy_in_range');
    }
  });

  it('机制：两段各自按生效属性最低选人（防御最低 ≠ 谋略最低）', () => {
    const ctx = makeCtx(activeTeam('jianruo_gongmei'));
    ctx.enemyTeam[1].general.defense = 10;
    ctx.enemyTeam[2].general.defense = 200;
    ctx.enemyTeam[1].general.strategy = 300;
    ctx.enemyTeam[2].general.strategy = 5;
    castActive(ctx, 'jianruo_gongmei');
    const hits = damageEvents(ctx, 'jianruo_gongmei');
    const phys = hits.find((h) => h.damageType === 'physical');
    const strat = hits.find((h) => h.damageType === 'strategy');
    expect(phys?.targetId).toBe('enemy-mid');
    expect(strat?.targetId).toBe('enemy-back');
  });

  it('窗口：超出有效距离的最低属性目标不被选中（大营施法距离 4，敌大营距离 5）', () => {
    const carrier = dummy('carrier', '大营', 10000);
    carrier.activeSkillIds = ['jianruo_gongmei'];
    carrier.morale = 140;
    const ctx = makeCtx([dummy('ally-front', '前锋'), dummy('ally-mid', '中军'), carrier]);
    // 敌大营两维最低，但距离 5 超出战法距离 4 → 应取距离 4 内的敌中军
    ctx.enemyTeam[2].general.defense = 1;
    ctx.enemyTeam[2].general.strategy = 1;
    ctx.enemyTeam[1].general.defense = 40;
    ctx.enemyTeam[1].general.strategy = 40;
    castActive(ctx, 'jianruo_gongmei');
    const hits = damageEvents(ctx, 'jianruo_gongmei');
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.targetId === 'enemy-mid')).toBe(true);
  });
});

describe('始计（S 二类指挥：前 4 回合自身行动时，大营下一次伤害 +20% 受谋略 / 敌方兵力最多单体下一次伤害 −30% 受谋略 / 自身受击本回合洞察）', () => {
  it('装配：phase round、roundTrigger on_act、self、range 5；output 空 + onActSegments 1~4 回合', () => {
    expect(commandTeam('shiji')[1].commandSkillIds).toContain('shiji');
    const s = asCommand('shiji');
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(5);
    expect(s.output).toHaveLength(0);
    expect(s.onActSegments?.[0].startRound).toBe(1);
    expect(s.onActSegments?.[0].endRound).toBe(4);
    expect(s.onActSegments?.[0].output).toHaveLength(2);
  });

  it('机制：大营段 positions 大营 + caused charges 1 strategyScaled 无 growthRate；敌方段 targetPick 兵力最多 + taken −0.3 charges 1', () => {
    const seg = asCommand('shiji').onActSegments![0].output;
    const ally = seg[0];
    const enemy = seg[1];
    expect(ally.kind).toBe('inflict_status');
    if (ally.kind === 'inflict_status') {
      expect(ally.targetSide).toBe('ally');
      expect(ally.positions).toEqual(['大营']);
      const st = Array.isArray(ally.status) ? undefined : ally.status;
      expect(st?.type).toBe('damage_boost');
      if (st?.type === 'damage_boost') {
        expect(st.rate).toBe(0.2);
        expect(st.direction).toBe('caused');
        expect(st.charges).toBe(1);
        expect(st.strategyScaled).toBe(true);
        expect(st.growthRate).toBeUndefined();
      }
    }
    expect(enemy.kind).toBe('inflict_status');
    if (enemy.kind === 'inflict_status') {
      expect(enemy.targetPick).toBe('highest_troops_enemy');
      const st = Array.isArray(enemy.status) ? undefined : enemy.status;
      expect(st?.type).toBe('damage_boost');
      if (st?.type === 'damage_boost') {
        expect(st.rate).toBe(-0.3);
        expect(st.direction).toBe('taken');
        expect(st.charges).toBe(1);
        expect(st.strategyScaled).toBe(true);
        expect(st.growthRate).toBeUndefined();
      }
    }
  });

  it('机制：onHurt 受击后给自身本回合洞察（duration 1）', () => {
    const cfg = asCommand('shiji').onHurt;
    const one = Array.isArray(cfg) ? cfg[0] : cfg;
    expect(one?.victim).toBe('self');
    expect(one?.applyTo).toBe('victim');
    const st = inflictStatusOf(one?.output?.[0]);
    expect(st?.type).toBe('insight');
    expect(durationOf(st)).toBe(1);
  });

  it('窗口：第 1 回合行动时——我方大营得 +20% caused、敌方兵力最多者得 −30% taken（载体自身不拿大营段）', () => {
    const ctx = makeCtx(commandTeam('shiji'));
    const carrier = ctx.myTeam[1];
    ctx.enemyTeam[1].troops = 20000; // 敌方中军兵力最多
    ctx.currentRound = 1;
    triggerRoundCommandOnAct(ctx, carrier);
    const daying = ctx.myTeam[2];
    const allyBoost = statusTypeOf(daying, 'damage_boost');
    expect(allyBoost?.type).toBe('damage_boost');
    if (allyBoost?.type === 'damage_boost') {
      expect(allyBoost.rate).toBe(0.2);
      expect(allyBoost.direction).toBe('caused');
    }
    expect(statusTypeOf(carrier, 'damage_boost')).toBeUndefined();
    const enemyBoost = statusTypeOf(ctx.enemyTeam[1], 'damage_boost');
    expect(enemyBoost?.type).toBe('damage_boost');
    if (enemyBoost?.type === 'damage_boost') expect(enemyBoost.rate).toBe(-0.3);
    expect(statusTypeOf(ctx.enemyTeam[0], 'damage_boost')).toBeUndefined();
  });

  it('窗口：第 5 回合起不再生效（前 4 回合限定）', () => {
    const ctx = makeCtx(commandTeam('shiji'));
    ctx.currentRound = 5;
    triggerRoundCommandOnAct(ctx, ctx.myTeam[1]);
    expect(ctx.myTeam.some((u) => statusTypeOf(u, 'damage_boost'))).toBe(false);
    expect(ctx.enemyTeam.some((u) => statusTypeOf(u, 'damage_boost'))).toBe(false);
  });

  it('窗口：自身受到攻击伤害后获得洞察（本回合内）', () => {
    const ctx = makeCtx(commandTeam('shiji'));
    const carrier = ctx.myTeam[1];
    applyDamage(ctx, carrier, 300, ctx.enemyTeam[0], 'physical', 'basic');
    const insight = statusTypeOf(carrier, 'insight');
    expect(insight?.type).toBe('insight');
  });
});

describe('铁戟金戈（B 准备主动 35% 距离 4：每次释放 50/50 抽「2 目标 330%」或「3 目标 225%」）', () => {
  it('装配：准备主动、range 4、triggerRate 0.35、random_pick count 1 两选项', () => {
    const s = asActive('tieji_jinge');
    expect(s.prepare).toBe(true);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.35);
    expect(s.output).toHaveLength(1);
    expect(s.output[0].kind).toBe('random_pick');
    if (s.output[0].kind === 'random_pick') {
      expect(s.output[0].count).toBe(1);
      expect(s.output[0].options).toHaveLength(2);
    }
  });

  it('机制：选项 A = 2 目标 330%；选项 B = 3 目标 225%（伤害率与目标数成对绑定）', () => {
    const out = asActive('tieji_jinge').output[0];
    if (out.kind !== 'random_pick') throw new Error('应为 random_pick');
    const [a, b] = out.options;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    if (a[0].kind === 'physical_damage') {
      expect(a[0].rate).toBe(330);
      expect(a[0].targetMode).toBe('group');
      expect(a[0].groupCount).toBe(2);
    }
    if (b[0].kind === 'physical_damage') {
      expect(b[0].rate).toBe(225);
      expect(b[0].targetMode).toBe('group');
      expect(b[0].groupCount).toBe(3);
    }
  });

  it('窗口：40 个种子各释放一次，2 目标与 3 目标两种结果都出现（50/50 随机）', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = makeCtx(activeTeam('tieji_jinge'), seed);
      castActive(ctx, 'tieji_jinge', { prepare: false });
      counts.add(damageEvents(ctx, 'tieji_jinge').length);
    }
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);
  });
});
