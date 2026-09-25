/**
 * 拆解通用 B+ 第九阶段 · 兵力阈值 / 恢复次数（A 级 2 个）：
 * 甚陷不惧（兵力首次低于 90/70/50/30% → 下次行动主战法发动率 +50%）、
 * 胜敌益强（每回合行动恢复 1~4 次，恢复率 120% 受防御）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { actUnit, applyDamage, triggerActiveSkill, type CombatContext } from '../src/engine/action';
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

function passiveTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.passiveSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function asPassive(id: string): Extract<Skill, { type: 'passive' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'passive') throw new Error(`${id} 不是被动`);
  return s;
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
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
    currentRound: 1,
  };
}

const triggers = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === skillId
  );

const healEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter((e) => e.type === 'heal' && e.skillId === skillId);

const boosts = (u: UnitState, skillId: string) =>
  u.statuses.filter((s) => s.type === 'trigger_boost' && s.sourceSkillId === skillId);

describe('甚陷不惧（A 被动：兵力首次低于 90/70/50/30% → 自身下次行动主战法发动率 +50%）', () => {
  it('装配：battle_start、self；四档阈值 + 主战法/伤害类/行动末清除 的发动率提升', () => {
    const s = asPassive('shenxian_bujv');
    expect(s.timing).toBe('battle_start');
    expect(s.targetMode).toBe('self');
    expect(s.output).toHaveLength(0);
    expect(s.troopThresholdBuff?.thresholds).toEqual([90, 70, 50, 30]);
    const st = inflictStatusOf(s.troopThresholdBuff?.output[0]);
    expect(st?.type).toBe('trigger_boost');
    if (st?.type === 'trigger_boost') {
      expect(st.rate).toBe(0.5);
      expect(st.mainSkillOnly).toBe(true);
      expect(st.damageSkillsOnly).toBe(true);
      expect(st.expireAfterOwnAct).toBe(true);
    }
  });

  it('窗口：跨过 90% 触发一次；同档不重复；跨 70% 档不叠加（同源只一个）', () => {
    const ctx = makeCtx(passiveTeam('shenxian_bujv'));
    const carrier = ctx.myTeam[0];
    const foe = ctx.enemyTeam[0];
    applyDamage(ctx, carrier, 1500, foe, 'physical', 'skill'); // 10000 → 8500（85%，跨 90）
    expect(boosts(carrier, 'shenxian_bujv')).toHaveLength(1);
    applyDamage(ctx, carrier, 500, foe, 'physical', 'skill'); // 8000（80%，未跨 70）
    expect(boosts(carrier, 'shenxian_bujv')).toHaveLength(1);
    applyDamage(ctx, carrier, 1500, foe, 'physical', 'skill'); // 6500（65%，跨 70）
    expect(boosts(carrier, 'shenxian_bujv')).toHaveLength(1);
    expect(ctx.troopThresholdKeys?.size).toBe(2);
  });

  it('机制：只提升携带者**主战法**且是伤害类——同技能非主战法 / 非伤害主战法都不吃', () => {
    const run = (mainSkillId: string | undefined) => {
      const team = passiveTeam('shenxian_bujv');
      const carrier = team[0];
      carrier.mainSkillId = mainSkillId;
      carrier.activeSkillIds = ['jingong'];
      const ctx = makeCtx(team);
      const unit = ctx.myTeam[0];
      const foe = ctx.enemyTeam[0];
      applyDamage(ctx, unit, 1500, foe, 'physical', 'skill'); // 触发 90% 档 → 挂 +50% 发动率
      const active = asActive('jingong');
      const copy = { ...active, triggerRate: 0.1 } as Extract<Skill, { type: 'active' }>;
      ctx.skills.set('jingong', copy);
      triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
      return triggers(ctx, 'jingong')[0];
    };
    // 近攻是伤害类且为主战法 → 0.1 + 0.5 = 60%
    expect(run('jingong')?.baseRate).toBe(60);
    // 非主战法 → 不提升
    expect(run('some_other_skill')?.baseRate).toBe(10);
    // 主战法但非伤害类（看破只有清增益 + 减防）→ 不提升
    expect(run('kanpo')?.baseRate).toBe(10);
  });

  it('窗口：消耗于自身下次行动（行动末清除）', () => {
    const ctx = makeCtx(passiveTeam('shenxian_bujv'));
    const carrier = ctx.myTeam[0];
    applyDamage(ctx, carrier, 1500, ctx.enemyTeam[0], 'physical', 'skill');
    expect(boosts(carrier, 'shenxian_bujv')).toHaveLength(1);
    actUnit(ctx, carrier);
    expect(boosts(carrier, 'shenxian_bujv')).toHaveLength(0);
    expect(ctx.events.some((e) => e.type === 'status_expired' && e.statusType === 'trigger_boost')).toBe(true);
  });
});

describe('胜敌益强（A 被动：每回合行动恢复 1 次，第 2/4/6 回合起提升至 2/3/4 次）', () => {
  it('装配：battle_start、self；四段次数 + 恢复率 120 受防御（成长率 0 = 不缩放）', () => {
    const s = asPassive('shengdi_yiqiang');
    expect(s.timing).toBe('battle_start');
    expect(s.targetMode).toBe('self');
    expect(s.recoverEachRound?.tiers).toEqual([
      { startRound: 1, times: 1 },
      { startRound: 2, times: 2 },
      { startRound: 4, times: 3 },
      { startRound: 6, times: 4 },
    ]);
    expect(s.recoverEachRound?.rate).toBe(120);
    expect(s.recoverEachRound?.growthRate).toBe(0);
    expect(s.recoverEachRound?.defenseScaled).toBe(true);
  });

  it('窗口：第 1/2/4/6 回合分别恢复 1/2/3/4 次', () => {
    const runRound = (round: number) => {
      const ctx = makeCtx(passiveTeam('shengdi_yiqiang'));
      const carrier = ctx.myTeam[0];
      carrier.troops = 5000; // 先掉血，恢复才有可恢复量
      ctx.currentRound = round;
      actUnit(ctx, carrier);
      return healEvents(ctx, 'shengdi_yiqiang').length;
    };
    expect(runRound(1)).toBe(1);
    expect(runRound(2)).toBe(2);
    expect(runRound(4)).toBe(3);
    expect(runRound(6)).toBe(4);
  });

  it('机制：恢复率受防御缩放（补 growthRate 后，防御越高单次恢复越多）', () => {
    const run = (defense: number) => {
      const ctx = makeCtx(passiveTeam('shengdi_yiqiang'));
      const carrier = ctx.myTeam[0];
      carrier.general.defense = defense;
      carrier.troops = 5000;
      const s = asPassive('shengdi_yiqiang');
      ctx.skills.set('shengdi_yiqiang', {
        ...s,
        recoverEachRound: { ...s.recoverEachRound!, growthRate: 0.2 },
      } as Extract<Skill, { type: 'passive' }>);
      ctx.currentRound = 1;
      actUnit(ctx, carrier);
      const heal = ctx.events.find((e) => e.type === 'heal' && e.skillId === 'shengdi_yiqiang');
      return heal?.type === 'heal' ? heal.amount : 0;
    };
    expect(run(180)).toBeGreaterThan(run(100));
  });
});
