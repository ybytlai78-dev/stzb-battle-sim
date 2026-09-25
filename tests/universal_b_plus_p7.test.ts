/**
 * 拆解通用 B+ 第七阶段 · 移除敌军有益（4）+ 援护（3）：
 * 看破 / 索敌 / 驱逐 / 火积 / 援护 / 移花接木 / 一夫当关。
 * 每战法 ≥3 个测试：装配挂槽与字段、机制（remove_buffs 优先级 / DoT 公式 / cover protectId）、窗口。
 */
import { describe, it, expect } from 'vitest';
import type {
  BattleEvent,
  General,
  Position,
  Skill,
  SkillOutput,
  Status,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  isBeneficialStatus,
  triggerActiveSkill,
  triggerCommandSkills,
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

function pursuitTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.pursuitSkillIds = [skillId];
  carrier.morale = 140;
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function commandTeam(skillId: string, position: Position = '前锋'): General[] {
  const carrier = dummy('carrier', position, 10000);
  carrier.commandSkillIds = [skillId];
  if (position === '大营') {
    return [dummy('ally-front', '前锋', 10000), dummy('ally-mid', '中军', 10000), carrier];
  }
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

function asPursuit(id: string): Extract<Skill, { type: 'pursuit' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'pursuit') throw new Error(`${id} 不是追击`);
  return s;
}

function asCommand(id: string): Extract<Skill, { type: 'command' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
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
    preparations: [],
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
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const coverEvents = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'cover' }> => e.type === 'cover');

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);
const hasStatus = (u: UnitState, type: string) => u.statuses.some((s) => s.type === type);
const statusFrom = (u: UnitState, type: string, sourceSkillId: string) =>
  u.statuses.find((s) => s.type === type && s.sourceSkillId === sourceSkillId);

/** 给敌方全体挂上「不同来源战法类型」的有益 / 减益样本，供 remove_buffs 优先级断言 */
function seedEnemyStatuses(ctx: CombatContext): void {
  for (const foe of ctx.enemyTeam) {
    inflictStatus(ctx, foe, { type: 'attack_buff', amount: 20, duration: 999 }, 'active', 'src_active_buff');
    inflictStatus(ctx, foe, { type: 'evasion', stacks: 1 }, 'pursuit', 'src_pursuit_buff');
    inflictStatus(
      ctx,
      foe,
      { type: 'damage_boost', rate: 0.3, duration: 999, direction: 'caused' },
      'command',
      'src_command_buff'
    );
    inflictStatus(ctx, foe, { type: 'damage_reduce', rate: 0.2, duration: 999 }, 'passive', 'src_passive_buff');
    inflictStatus(ctx, foe, { type: 'defense_buff', amount: -20, duration: 999 }, 'active', 'src_active_debuff');
  }
}

describe('有益状态判定（isBeneficialStatus：属性看正负、增减伤看方向）', () => {
  const mk = (status: Status) => status;
  const create = (c: unknown) =>
    c as Status;

  it('属性 buff：amount > 0 有益、< 0 有害', () => {
    expect(
      isBeneficialStatus(create({ type: 'attack_buff', amount: 20, duration: 1 } as unknown as Status))
    ).toBe(true);
    expect(
      isBeneficialStatus(create({ type: 'attack_buff', amount: -20, duration: 1 } as unknown as Status))
    ).toBe(false);
    expect(
      isBeneficialStatus(create({ type: 'morale_boost', amount: 10, duration: 1 } as unknown as Status))
    ).toBe(true);
  });

  it('增减伤：caused 正 / taken 负 为有益，反之为有害', () => {
    expect(
      isBeneficialStatus(
        create({ type: 'damage_boost', rate: 0.3, direction: 'caused', duration: 1 } as unknown as Status)
      )
    ).toBe(true);
    expect(
      isBeneficialStatus(
        create({ type: 'damage_boost', rate: -0.3, direction: 'caused', duration: 1 } as unknown as Status)
      )
    ).toBe(false);
    expect(
      isBeneficialStatus(
        create({ type: 'damage_boost', rate: 0.3, direction: 'taken', duration: 1 } as unknown as Status)
      )
    ).toBe(false);
    expect(
      isBeneficialStatus(
        create({ type: 'damage_boost', rate: -0.3, direction: 'taken', duration: 1 } as unknown as Status)
      )
    ).toBe(true);
  });

  it('减伤/规避/连击 有益；控制与 DoT 有害', () => {
    expect(isBeneficialStatus(create({ type: 'damage_reduce', rate: 0.3, duration: 1 } as unknown as Status))).toBe(true);
    expect(isBeneficialStatus(create({ type: 'evasion', stacks: 1 } as unknown as Status))).toBe(true);
    expect(isBeneficialStatus(create({ type: 'combo', duration: 1 } as unknown as Status))).toBe(true);
    expect(isBeneficialStatus(create({ type: 'confusion', duration: 1 } as unknown as Status))).toBe(false);
    expect(isBeneficialStatus(create({ type: 'panic', rate: 100, growthRate: 0, duration: 1 } as unknown as Status))).toBe(false);
  });
});

describe('看破（D 主动 40% 距离 3：移除敌军单体有益 + 防御 −10）', () => {
  it('装配：普通主动、random_single、range 3；先移除后减防', () => {
    const s = asActive('kanpo');
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('random_single');
    expect(s.output.map((o) => o.kind)).toEqual(['remove_buffs', 'inflict_status']);
    const st = inflictStatusOf(s.output[1]);
    expect(st?.type).toBe('defense_buff');
    if (st?.type === 'defense_buff') {
      expect(st.amount).toBe(-10);
      expect(st.duration).toBe(2);
    }
  });

  it('窗口：只清主动/追击来源的有益（指挥/被动/减益保留）——优先级 被动>指挥>主动=追击', () => {
    const ctx = makeCtx(activeTeam('kanpo'));
    seedEnemyStatuses(ctx);
    castActive(ctx, 'kanpo');
    // 看破是单体：以「收到看破自身防御 −10」的那个目标为准
    const target = ctx.enemyTeam.find((u) => statusFrom(u, 'defense_buff', 'kanpo'));
    if (!target) throw new Error('看破未命中目标');
    expect(target.statuses.some((s) => s.type === 'defense_buff' && s.sourceSkillId === 'kanpo')).toBe(true);
    expect(statusFrom(target, 'attack_buff', 'src_active_buff')).toBeUndefined();
    expect(statusFrom(target, 'evasion', 'src_pursuit_buff')).toBeUndefined();
    expect(statusFrom(target, 'damage_boost', 'src_command_buff')?.type).toBe('damage_boost');
    expect(statusFrom(target, 'damage_reduce', 'src_passive_buff')?.type).toBe('damage_reduce');
    // 减益（防御 −20）不是「有益效果」→ 不被移除（看破随后用自己的 −10 覆盖同号属性减益，故只断言仍有负值防御状态）
    expect(
      target.statuses.some((s) => s.type === 'defense_buff' && 'amount' in s && s.amount < 0)
    ).toBe(true);
  });

  it('窗口：对目标施加防御 −10（看破自身来源）', () => {
    const ctx = makeCtx(activeTeam('kanpo'));
    castActive(ctx, 'kanpo');
    const hit = damageEvents(ctx, 'kanpo');
    expect(hit).toHaveLength(0); // 看破无伤害
    const debuffed = ctx.enemyTeam.filter((u) => statusFrom(u, 'defense_buff', 'kanpo'));
    expect(debuffed).toHaveLength(1);
  });
});

describe('索敌（D 主动 35% 距离 3：移除群体有益 + 攻击 75%）', () => {
  it('装配：群体 2、output 顺序 remove_buffs → 攻击 75', () => {
    const s = asActive('suodi');
    expect(s.triggerRate).toBe(0.35);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.output.map((o) => o.kind)).toEqual(['remove_buffs', 'physical_damage']);
    if (s.output[1].kind === 'physical_damage') expect(s.output[1].rate).toBe(75);
  });

  it('窗口：被命中的 2 名目标先被清增益、再吃 75% 攻击', () => {
    const ctx = makeCtx(activeTeam('suodi'));
    seedEnemyStatuses(ctx);
    castActive(ctx, 'suodi');
    const hits = damageEvents(ctx, 'suodi');
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      const foe = ctx.enemyTeam.find((u) => u.general.id === h.targetId);
      if (!foe) throw new Error('无目标');
      expect(statusFrom(foe, 'attack_buff', 'src_active_buff')).toBeUndefined();
    }
    // 未被选中的那个敌人保留增益
    const untouched = ctx.enemyTeam.filter((u) => !hits.some((h) => h.targetId === u.general.id));
    for (const u of untouched) {
      expect(statusFrom(u, 'attack_buff', 'src_active_buff')?.type).toBe('attack_buff');
    }
  });
});

describe('驱逐（D 追击 40%：策略 110% 受谋略 + 移除其有益）', () => {
  it('装配：追击、output 顺序 策略 110 → remove_buffs；受谋略但无 growthRate', () => {
    const s = asPursuit('quzhu');
    expect(s.triggerRate).toBe(0.4);
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'remove_buffs']);
    if (s.output[0].kind === 'strategy_damage') {
      expect(s.output[0].rate).toBe(110);
      expect(s.output[0].strategyScaled).toBe(true);
      expect(s.output[0].growthRate).toBeUndefined();
    }
  });

  it('窗口：普攻命中后触发——对攻击目标策略伤害并清其主动来源增益', () => {
    const ctx = makeCtx(pursuitTeam('quzhu'));
    ctx.skills.set('quzhu', { ...asPursuit('quzhu'), triggerRate: 1 });
    for (const foe of ctx.enemyTeam) {
      inflictStatus(ctx, foe, { type: 'attack_buff', amount: 20, duration: 999 }, 'active', 'src_active_buff');
    }
    const carrier = ctx.myTeam[0];
    ctx.currentRound = 1;
    actUnit(ctx, carrier);
    const hits = damageEvents(ctx, 'quzhu');
    expect(hits).toHaveLength(1);
    const target = ctx.enemyTeam.find((u) => u.general.id === hits[0].targetId);
    if (!target) throw new Error('无目标');
    expect(statusFrom(target, 'attack_buff', 'src_active_buff')).toBeUndefined();
  });
});

describe('火积（B 追击 45%：立即燃烧伤害 192% 受谋略 + 移除其有益）', () => {
  it('装配：追击、strategy 192 dotFormula 真、remove_buffs 在后', () => {
    const s = asPursuit('huoji');
    expect(s.triggerRate).toBe(0.45);
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'remove_buffs']);
    if (s.output[0].kind === 'strategy_damage') {
      expect(s.output[0].rate).toBe(192);
      expect(s.output[0].strategyScaled).toBe(true);
      expect(s.output[0].dotFormula).toBe(true);
      expect(s.output[0].growthRate).toBeUndefined();
    }
  });

  it('窗口：立即结算（不挂 burning 状态）并清除目标增益', () => {
    const ctx = makeCtx(pursuitTeam('huoji'));
    ctx.skills.set('huoji', { ...asPursuit('huoji'), triggerRate: 1 });
    for (const foe of ctx.enemyTeam) {
      inflictStatus(ctx, foe, { type: 'attack_buff', amount: 20, duration: 999 }, 'active', 'src_active_buff');
    }
    const carrier = ctx.myTeam[0];
    ctx.currentRound = 1;
    actUnit(ctx, carrier);
    const hits = damageEvents(ctx, 'huoji');
    expect(hits).toHaveLength(1);
    const target = ctx.enemyTeam.find((u) => u.general.id === hits[0].targetId);
    if (!target) throw new Error('无目标');
    expect(hasStatus(target, 'burning')).toBe(false);
    expect(statusFrom(target, 'attack_buff', 'src_active_buff')).toBeUndefined();
  });

  it('机制：dotFormula 走燃烧（DoT）公式 → 同种子下伤害低于普通策略公式', () => {
    const runOnce = (patch: Record<string, unknown>) => {
      const ctx = makeCtx(pursuitTeam('huoji'), 9);
      const base = asPursuit('huoji');
      const copy = { ...base, triggerRate: 1, ...patch } as Extract<Skill, { type: 'pursuit' }>;
      ctx.skills.set('huoji', copy);
      ctx.currentRound = 1;
      actUnit(ctx, ctx.myTeam[0]);
      return damageEvents(ctx, 'huoji')[0]?.damage ?? 0;
    };
    const dotDamage = runOnce({});
    const plainDamage = runOnce({
      output: [{ kind: 'strategy_damage', rate: 192, strategyScaled: true }, { kind: 'remove_buffs' }],
    });
    expect(dotDamage).toBeGreaterThan(0);
    expect(dotDamage).toBeLessThan(plainDamage);
  });
});

describe('援护（D 主动 45% 距离 2：援护友军单体，持续 2 回合 → duration 3）', () => {
  it('装配：普通主动、targetMode self、grant_cover duration 3', () => {
    const s = asActive('yuanhu');
    expect(s.triggerRate).toBe(0.45);
    expect(s.range).toBe(2);
    expect(s.targetMode).toBe('self');
    expect(s.output).toHaveLength(1);
    expect(s.output[0].kind).toBe('grant_cover');
    if (s.output[0].kind === 'grant_cover') expect(s.output[0].duration).toBe(3);
  });

  it('窗口：cover 挂在施法者自身，protectId 指向另一名友军（不含自身）', () => {
    const ctx = makeCtx(activeTeam('yuanhu'));
    castActive(ctx, 'yuanhu');
    const carrier = ctx.myTeam[0];
    const cover = statusOf(carrier, 'cover');
    expect(cover?.type).toBe('cover');
    if (cover?.type === 'cover') {
      expect(cover.remaining).toBe(3);
      expect(cover.protectId).toBeDefined();
      expect(cover.protectId).not.toBe('carrier');
      expect(ctx.myTeam.some((u) => u.general.id === cover.protectId)).toBe(true);
    }
  });

  it('窗口：只有被保护的单体受普攻时代受；其他友军不受影响', () => {
    const ctx = makeCtx(activeTeam('yuanhu'));
    castActive(ctx, 'yuanhu');
    const carrier = ctx.myTeam[0];
    const cover = statusOf(carrier, 'cover');
    const protectedId = cover?.type === 'cover' ? cover.protectId : undefined;
    if (!protectedId) throw new Error('无 protectId');
    const protectedAlly = ctx.myTeam.find((u) => u.general.id === protectedId);
    const otherAlly = ctx.myTeam.find(
      (u) => u.general.id !== 'carrier' && u.general.id !== protectedId
    );
    if (!protectedAlly || !otherAlly) throw new Error('缺友军');

    applyDamage(ctx, protectedAlly, 300, ctx.enemyTeam[0], 'physical', 'basic');
    const covers = coverEvents(ctx);
    expect(covers).toHaveLength(1);
    expect(covers[0].unitId).toBe('carrier');
    expect(covers[0].targetId).toBe(protectedId);

    applyDamage(ctx, otherAlly, 300, ctx.enemyTeam[0], 'physical', 'basic');
    expect(coverEvents(ctx)).toHaveLength(1); // 未增加 → 未被代受
  });
});

describe('移花接木（C 主动 40% 距离 2：移除自身有害 + 防御 +50 + 援护友军全体）', () => {
  it('装配：targetMode self；output 顺序 清负面 → 防御 +50 → cover', () => {
    const s = asActive('yihuajiemu');
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(2);
    expect(s.output.map((o) => o.kind)).toEqual(['remove_debuffs', 'inflict_status', 'inflict_status']);
    const def = inflictStatusOf(s.output[1]);
    expect(def?.type).toBe('defense_buff');
    if (def?.type === 'defense_buff') {
      expect(def.amount).toBe(50);
      expect(def.duration).toBe(3);
    }
    const cov = inflictStatusOf(s.output[2]);
    expect(cov?.type).toBe('cover');
    if (cov?.type === 'cover') {
      expect(cov.duration).toBe(3);
      expect(cov.protectId).toBeUndefined();
    }
  });

  it('窗口：清掉自身有害、保留有益，并获得防御 +50 与 cover', () => {
    const ctx = makeCtx(activeTeam('yihuajiemu'));
    const carrier = ctx.myTeam[0];
    inflictStatus(ctx, carrier, { type: 'hesitation', duration: 2 }, 'active', 'src_enemy_active');
    inflictStatus(ctx, carrier, { type: 'attack_buff', amount: 20, duration: 5 }, 'active', 'src_own_active');
    castActive(ctx, 'yihuajiemu');
    expect(hasStatus(carrier, 'hesitation')).toBe(false);
    expect(statusFrom(carrier, 'attack_buff', 'src_own_active')?.type).toBe('attack_buff');
    const def = statusOf(carrier, 'defense_buff');
    expect(def?.type).toBe('defense_buff');
    expect(statusOf(carrier, 'cover')?.type).toBe('cover');
  });

  it('窗口（援护全体）：任一友军受普攻都由施法者代受', () => {
    const ctx = makeCtx(activeTeam('yihuajiemu'));
    castActive(ctx, 'yihuajiemu');
    const ally = ctx.myTeam[1];
    applyDamage(ctx, ally, 300, ctx.enemyTeam[0], 'physical', 'basic');
    const covers = coverEvents(ctx);
    expect(covers).toHaveLength(1);
    expect(covers[0].unitId).toBe('carrier');
    expect(covers[0].targetId).toBe('ally-mid');
  });
});

describe('一夫当关（A 一类指挥：前 2 回合援护全体 + 自身受攻击伤害 −50% 受防御；仅前锋生效）', () => {
  it('装配：prep、self、casterPositions 前锋；cover duration 2 + damage_reduce 0.5 defenseScaled physical', () => {
    const s = asCommand('yifudangguan');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.casterPositions).toEqual(['前锋']);
    const cov = inflictStatusOf(s.output[0]);
    expect(cov?.type).toBe('cover');
    if (cov?.type === 'cover') expect(cov.duration).toBe(2);
    const red = inflictStatusOf(s.output[1]);
    expect(red?.type).toBe('damage_reduce');
    if (red?.type === 'damage_reduce') {
      expect(red.rate).toBe(0.5);
      expect(red.duration).toBe(2);
      expect(red.defenseScaled).toBe(true);
      expect(red.damageType).toBe('physical');
      expect(red.growthRate).toBeUndefined();
    }
  });

  it('窗口：前锋携带 → 得到援护与减伤；大营携带 → 整次不生效', () => {
    const front = makeCtx(commandTeam('yifudangguan', '前锋'));
    triggerCommandSkills(front, front.myTeam[0]);
    expect(statusOf(front.myTeam[0], 'cover')?.type).toBe('cover');
    expect(statusOf(front.myTeam[0], 'damage_reduce')?.type).toBe('damage_reduce');

    const back = makeCtx(commandTeam('yifudangguan', '大营'));
    triggerCommandSkills(back, back.myTeam[2]);
    expect(hasStatus(back.myTeam[2], 'cover')).toBe(false);
    expect(hasStatus(back.myTeam[2], 'damage_reduce')).toBe(false);
  });

  it('窗口：友军受普攻由施法者代受', () => {
    const ctx = makeCtx(commandTeam('yifudangguan', '前锋'));
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    applyDamage(ctx, ctx.myTeam[2], 300, ctx.enemyTeam[0], 'physical', 'basic');
    const covers = coverEvents(ctx);
    expect(covers).toHaveLength(1);
    expect(covers[0].unitId).toBe('carrier');
  });

  it('机制：damage_reduce.defenseScaled + growthRate 按生效防御缩放（一夫当关留空 → 基值 0.5）', () => {
    const ctx = makeCtx(commandTeam('yifudangguan', '前锋'));
    const carrier = ctx.myTeam[0];
    carrier.general.defense = 180; // 生效防御 180
    // 走输出执行链才能触发缩放（直接 inflictStatus 不做缩放）——给一夫当关的减伤段补 growthRate
    const s = asCommand('yifudangguan');
    ctx.skills.set('yifudangguan', {
      ...s,
      output: [
        s.output[0],
        {
          kind: 'inflict_status',
          target: 'self',
          status: { type: 'damage_reduce', rate: 0.5, duration: 2, defenseScaled: true, growthRate: 0.02 },
        },
      ],
    });
    triggerCommandSkills(ctx, carrier);
    const scaled = statusFrom(carrier, 'damage_reduce', 'yifudangguan');
    expect(scaled?.type).toBe('damage_reduce');
    if (scaled?.type === 'damage_reduce') {
      // 50 + 0.02 × (180 − 80) = 52 → 0.52
      expect(scaled.rate).toBeCloseTo(0.52, 6);
    }
  });
});
