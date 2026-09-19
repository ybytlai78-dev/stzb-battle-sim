/**
 * 拆解通用 B+ 第六阶段 · 受击链路收尾：
 * 垒实迎击 / 百战无怯 / 疾风迅雷 / 反击 / 诱敌深入。
 * 每战法 ≥3 个测试：装配挂槽与字段、机制结构、窗口（受击触发 / 层数 / 先手 / 反击）。
 */
import { describe, it, expect } from 'vitest';
import type {
  BattleEvent,
  CreateStatus,
  General,
  OnHurtConfig,
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
  tickRoundStartStatuses,
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

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

function asCommand(id: string): Extract<Skill, { type: 'command' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
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

function onHurtList(skill: Extract<Skill, { type: 'passive' }> | Extract<Skill, { type: 'command' }>): OnHurtConfig[] {
  const cfg = skill.onHurt;
  if (!cfg) return [];
  return Array.isArray(cfg) ? cfg : [cfg];
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

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);
const hasStatus = (u: UnitState, type: string) => u.statuses.some((s) => s.type === type);
const healEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter((e) => e.type === 'heal' && e.skillId === skillId);

describe('垒实迎击（S 被动：受普攻 50% 回血／解负面／规避；中军前锋每回合 50% 援护友军全体）', () => {
  it('装配：battle_start、self；onHurt 三段 + roundStartRepeat 援护段', () => {
    expect(passiveTeam('leishi_yingji')[0].passiveSkillIds).toContain('leishi_yingji');
    const s = asPassive('leishi_yingji');
    expect(s.timing).toBe('battle_start');
    expect(s.targetMode).toBe('self');
    expect(onHurtList(s)).toHaveLength(3);
    expect(s.roundStartRepeat?.output).toHaveLength(1);
  });

  it('机制：三段各自 rate 0.5 / damageSource basic / applyTo victim；② debuffsOnly；③ grant_evasion；④ cover + 段级 casterPositions + chance 0.5', () => {
    const s = asPassive('leishi_yingji');
    const cfgs = onHurtList(s);
    for (const c of cfgs) {
      expect(c.rate).toBe(0.5);
      expect(c.damageSource).toBe('basic');
      expect(c.applyTo).toBe('victim');
      expect(c.victim).toBe('self');
    }
    const rm = cfgs[1].output?.[0];
    expect(rm?.kind).toBe('remove_by_source_skill_type');
    if (rm?.kind === 'remove_by_source_skill_type') {
      expect(rm.skillTypes).toEqual(['active', 'pursuit']);
      expect(rm.debuffsOnly).toBe(true);
    }
    const ev = cfgs[2].output?.[0];
    expect(ev?.kind).toBe('grant_evasion');
    if (ev?.kind === 'grant_evasion') expect(ev.stacks).toBe(1);
    const cover = s.roundStartRepeat?.output[0];
    expect(cover?.kind).toBe('inflict_status');
    if (cover?.kind === 'inflict_status') {
      expect(cover.casterPositions).toEqual(['中军', '前锋']);
      expect(cover.chance).toBe(0.5);
      const st = Array.isArray(cover.status) ? undefined : cover.status;
      expect(st?.type).toBe('cover');
      expect(st && 'duration' in st ? st.duration : undefined).toBe(1);
    }
  });

  it('窗口：受普攻后三段同时生效（回血 + 只移除负面 + 获得规避）', () => {
    const ctx = makeCtx(passiveTeam('leishi_yingji'));
    const s = asPassive('leishi_yingji');
    // 三段各改 100% 便于确定性断言（同一场受击各自独立判定）
    const patched = { ...s, onHurt: onHurtList(s).map((c) => ({ ...c, rate: 1 })) };
    ctx.skills.set('leishi_yingji', patched);
    const carrier = ctx.myTeam[0];
    // 主动战法带来的负面效果（应被移除）
    inflictStatus(ctx, carrier, { type: 'hesitation', duration: 2 }, 'active', 'some_active');
    // 主动战法带来的正面效果（debuffsOnly → 应保留）
    inflictStatus(ctx, carrier, { type: 'attack_buff', amount: 20, duration: 2 }, 'active', 'some_active');
    applyDamage(ctx, carrier, 800, ctx.enemyTeam[0], 'physical', 'basic');
    expect(hasStatus(carrier, 'hesitation')).toBe(false);
    expect(hasStatus(carrier, 'attack_buff')).toBe(true);
    expect(hasStatus(carrier, 'evasion')).toBe(true);
    expect(healEvents(ctx, 'leishi_yingji').length).toBeGreaterThan(0);
  });

  it('窗口：站位满足时每回合开始获得援护（cover duration 1）', () => {
    const ctx = makeCtx(passiveTeam('leishi_yingji'));
    const s = asPassive('leishi_yingji');
    const patched = {
      ...s,
      roundStartRepeat: {
        output: [{ kind: 'inflict_status', target: 'self', casterPositions: ['中军', '前锋'], chance: 1, status: { type: 'cover', duration: 1 } }],
      },
    } as Extract<Skill, { type: 'passive' }>;
    ctx.skills.set('leishi_yingji', patched);
    const carrier = ctx.myTeam[0];
    ctx.currentRound = 1;
    actUnit(ctx, carrier);
    const cover = statusOf(carrier, 'cover');
    expect(cover?.type).toBe('cover');
    if (cover?.type === 'cover') expect(cover.remaining).toBe(1);
  });
});

describe('百战无怯（S 被动：中军/前锋开局 3 层减伤 20%/层；造成伤害 +1；回合开始/受击 −1 并回血 200%）', () => {
  it('装配：battle_start、self、casterPositions 中军/前锋；stacksReduceHeal 3 层 20% 恢复 200%', () => {
    const s = asPassive('baizhan_wuqie');
    expect(s.timing).toBe('battle_start');
    expect(s.targetMode).toBe('self');
    expect(s.casterPositions).toEqual(['中军', '前锋']);
    expect(s.stacksReduceHeal).toEqual({ perStack: 0.2, maxStacks: 3, healRate: 200, healGrowthRate: 0 });
    expect(passiveTeam('baizhan_wuqie')[0].passiveSkillIds).toContain('baizhan_wuqie');
  });

  it('窗口：战斗开始即 3 层，减伤 rate = 0.6', () => {
    const ctx = makeCtx(passiveTeam('baizhan_wuqie'));
    const carrier = ctx.myTeam[0];
    triggerPassiveSkills(ctx, carrier, 'battle_start');
    expect(ctx.stacksReduceCounters?.get('carrier:baizhan_wuqie')).toBe(3);
    const reduce = statusOf(carrier, 'damage_reduce');
    expect(reduce?.type).toBe('damage_reduce');
    if (reduce?.type === 'damage_reduce') expect(reduce.rate).toBeCloseTo(0.6, 6);
  });

  it('窗口：造成伤害 +1 层（封顶 3），受击 −1 层并回血', () => {
    const ctx = makeCtx(passiveTeam('baizhan_wuqie'));
    const carrier = ctx.myTeam[0];
    triggerPassiveSkills(ctx, carrier, 'battle_start');
    // 开局 3 层已满 → 造成伤害不再增加（封顶）
    applyDamage(ctx, ctx.enemyTeam[0], 500, carrier, 'physical', 'skill');
    expect(ctx.stacksReduceCounters?.get('carrier:baizhan_wuqie')).toBe(3);
    // 受击 −1 → 2 层并回血，rate 同步 0.4
    applyDamage(ctx, carrier, 500, ctx.enemyTeam[0], 'physical', 'basic');
    expect(ctx.stacksReduceCounters?.get('carrier:baizhan_wuqie')).toBe(2);
    const reduce = statusOf(carrier, 'damage_reduce');
    if (reduce?.type === 'damage_reduce') expect(reduce.rate).toBeCloseTo(0.4, 6);
    expect(healEvents(ctx, 'baizhan_wuqie').length).toBe(1);
  });

  it('窗口：每回合开始 −1 层并回血；0 层时不掉层也不回血', () => {
    const ctx = makeCtx(passiveTeam('baizhan_wuqie'));
    const carrier = ctx.myTeam[0];
    triggerPassiveSkills(ctx, carrier, 'battle_start');
    carrier.troops = 8000; // 先掉血，掉层恢复才有可恢复量（满兵时恢复 0、不产生 heal 事件）
    ctx.currentRound = 3;
    tickRoundStartStatuses(ctx);
    expect(ctx.stacksReduceCounters?.get('carrier:baizhan_wuqie')).toBe(2);
    expect(healEvents(ctx, 'baizhan_wuqie').length).toBe(1);
    // 清零后再跑：不掉层、不回血
    ctx.stacksReduceCounters?.set('carrier:baizhan_wuqie', 0);
    ctx.events.length = 0;
    tickRoundStartStatuses(ctx);
    expect(ctx.stacksReduceCounters?.get('carrier:baizhan_wuqie')).toBe(0);
    expect(healEvents(ctx, 'baizhan_wuqie')).toHaveLength(0);
  });

  it('窗口：站位不满足（大营）时整次不生效（无层数、无减伤）', () => {
    const carrier = dummy('carrier', '大营', 10000);
    carrier.passiveSkillIds = ['baizhan_wuqie'];
    const ctx = makeCtx([dummy('ally-front', '前锋', 10000), dummy('ally-mid', '中军', 10000), carrier]);
    triggerPassiveSkills(ctx, ctx.myTeam[2], 'battle_start');
    expect(ctx.stacksReduceCounters?.get('carrier:baizhan_wuqie')).toBeUndefined();
    expect(hasStatus(ctx.myTeam[2], 'damage_reduce')).toBe(false);
  });
});

describe('疾风迅雷（B 指挥：全程先手 + 第 3 回合起自身普攻命中后 40% 使目标混乱 1 回合）', () => {
  it('装配：一类指挥、self、priorityRounds 999；onBasicHit rate 0.4 startRound 3 混乱 duration 2', () => {
    const s = asCommand('jifeng_xunlei');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.priorityRounds).toBe(999);
    expect(s.output).toHaveLength(0);
    expect(s.onBasicHit?.rate).toBe(0.4);
    expect(s.onBasicHit?.startRound).toBe(3);
    const st = inflictStatusOf(s.onBasicHit?.output[0]);
    expect(st?.type).toBe('confusion');
    expect(st && 'duration' in st ? st.duration : undefined).toBe(2);
  });

  it('窗口：第 3 回合普攻命中后触发混乱（自身普攻）', () => {
    const ctx = makeCtx(commandTeam('jifeng_xunlei'));
    const s = asCommand('jifeng_xunlei');
    ctx.skills.set('jifeng_xunlei', { ...s, onBasicHit: { ...s.onBasicHit!, rate: 1 } });
    const carrier = ctx.myTeam[1];
    ctx.currentRound = 3;
    actUnit(ctx, carrier);
    expect(ctx.enemyTeam.some((u) => hasStatus(u, 'confusion'))).toBe(true);
    expect(ctx.events.some((e) => e.type === 'attack_hit' && e.sourceId === 'carrier')).toBe(true);
  });

  it('窗口：第 2 回合不触发（startRound 3）', () => {
    const ctx = makeCtx(commandTeam('jifeng_xunlei'));
    const s = asCommand('jifeng_xunlei');
    ctx.skills.set('jifeng_xunlei', { ...s, onBasicHit: { ...s.onBasicHit!, rate: 1 } });
    const carrier = ctx.myTeam[1];
    ctx.currentRound = 2;
    actUnit(ctx, carrier);
    expect(ctx.enemyTeam.some((u) => hasStatus(u, 'confusion'))).toBe(false);
  });
});

describe('反击（D 主动 30%：自身受普攻时反击 75%，持续 2 回合 → duration 3）', () => {
  it('装配：普通主动、self、range 1；counter rate 75 duration 3', () => {
    const s = asActive('fanji_counter');
    expect(s.id).toBe('fanji_counter');
    expect(s.name).toBe('反击');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(1);
    expect(s.triggerRate).toBe(0.3);
    expect(s.targetMode).toBe('self');
    const st = inflictStatusOf(s.output[0]);
    expect(st?.type).toBe('counter');
    if (st?.type === 'counter') {
      expect(st.rate).toBe(75);
      expect(st.duration).toBe(3);
    }
  });

  it('窗口：释放后获得反击资格（counter remaining 3）', () => {
    const ctx = makeCtx(activeTeam('fanji_counter'));
    castActive(ctx, 'fanji_counter');
    const carrier = ctx.myTeam[0];
    const st = statusOf(carrier, 'counter');
    expect(st?.type).toBe('counter');
    if (st?.type === 'counter') expect(st.remaining).toBe(3);
  });

  it('窗口：受到普通攻击时对来源结算反击伤害（归属本战法）', () => {
    const ctx = makeCtx(activeTeam('fanji_counter'));
    castActive(ctx, 'fanji_counter');
    const carrier = ctx.myTeam[0];
    applyDamage(ctx, carrier, 300, ctx.enemyTeam[0], 'physical', 'basic');
    const counters = damageEvents(ctx, 'fanji_counter');
    expect(counters).toHaveLength(1);
    expect(counters[0].targetId).toBe('enemy-front');
  });
});

describe('诱敌深入（A 指挥：第 3 回合起，每名友军每回合首次受伤后 50% 对来源策略 136%）', () => {
  it('装配：一类指挥、self；onHurt victim ally / rate 0.5 / startRound 3 / oncePerRound / applyTo source', () => {
    const s = asCommand('youdi_shenru');
    expect(s.phase).toBe('prep');
    expect(s.targetMode).toBe('self');
    expect(s.range).toBe(5);
    const cfgs = onHurtList(s);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0].victim).toBe('ally');
    expect(cfgs[0].rate).toBe(0.5);
    expect(cfgs[0].startRound).toBe(3);
    expect(cfgs[0].oncePerRound).toBe(true);
    expect(cfgs[0].applyTo).toBe('source');
    const dmg = cfgs[0].output?.[0];
    expect(dmg?.kind).toBe('strategy_damage');
    if (dmg?.kind === 'strategy_damage') {
      expect(dmg.rate).toBe(136);
      expect(dmg.strategyScaled).toBe(true);
      expect(dmg.growthRate).toBeUndefined();
    }
  });

  it('窗口：第 2 回合不触发、第 3 回合触发（对伤害来源策略伤害）', () => {
    const ctx = makeCtx(commandTeam('youdi_shenru'));
    ctx.skills.set('youdi_shenru', {
      ...asCommand('youdi_shenru'),
      onHurt: { ...onHurtList(asCommand('youdi_shenru'))[0], rate: 1 },
    });
    const ally = ctx.myTeam[0];
    const foe = ctx.enemyTeam[0];
    ctx.currentRound = 2;
    applyDamage(ctx, ally, 300, foe, 'physical', 'skill');
    expect(damageEvents(ctx, 'youdi_shenru')).toHaveLength(0);
    ctx.currentRound = 3;
    applyDamage(ctx, ally, 300, foe, 'physical', 'skill');
    const hits = damageEvents(ctx, 'youdi_shenru');
    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe('enemy-front');
    expect(hits[0].damageType).toBe('strategy');
  });

  it('窗口：每名友军各自每回合首次（同一友军第二次不触发）', () => {
    const ctx = makeCtx(commandTeam('youdi_shenru'));
    ctx.skills.set('youdi_shenru', {
      ...asCommand('youdi_shenru'),
      onHurt: { ...onHurtList(asCommand('youdi_shenru'))[0], rate: 1 },
    });
    ctx.currentRound = 3;
    const foe = ctx.enemyTeam[0];
    const front = ctx.myTeam[0];
    const mid = ctx.myTeam[1];
    applyDamage(ctx, front, 200, foe, 'physical', 'skill');
    applyDamage(ctx, front, 200, foe, 'physical', 'skill');
    expect(damageEvents(ctx, 'youdi_shenru')).toHaveLength(1);
    // 另一名友军本回合首次受伤 → 可再触发
    applyDamage(ctx, mid, 200, foe, 'physical', 'skill');
    expect(damageEvents(ctx, 'youdi_shenru')).toHaveLength(2);
  });
});
