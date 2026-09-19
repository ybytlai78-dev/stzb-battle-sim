/**
 * 拆解通用 B+ 第十阶段 · 追击链路（S/A 2 个）：
 * 乘胜追击（150% + 60%→40%→20% 递减连锁再打同一目标）、
 * 势无虚动（每次试图发动追击：无视规避 + 追击伤害 +40% 最多 3 层，下一次追击打出后清空）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { actUnit, type CombatContext } from '../src/engine/action';
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

function pursuitTeam(skillId: string, passiveId?: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.pursuitSkillIds = [skillId];
  if (passiveId) carrier.passiveSkillIds = [passiveId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function asPursuit(id: string): Extract<Skill, { type: 'pursuit' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'pursuit') throw new Error(`${id} 不是追击`);
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
    currentRound: 1,
  };
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const statusOf = (u: UnitState, type: string) => u.statuses.find((s) => s.type === type);

describe('乘胜追击（S 追击 35%：150% + 60%→40%→20% 递减连锁，均打攻击目标）', () => {
  it('装配：追击、output = 150% 基础 + 100% 连锁（chance 0.6 / decay 0.2 / sameTarget）', () => {
    const s = asPursuit('chengsheng_zhuiji');
    expect(s.triggerRate).toBe(0.35);
    expect(s.output).toHaveLength(2);
    if (s.output[0].kind === 'physical_damage') {
      expect(s.output[0].rate).toBe(150);
      expect(s.output[0].chain).toBeUndefined();
    }
    const chainOut = s.output[1];
    if (chainOut.kind === 'physical_damage') {
      expect(chainOut.rate).toBe(100);
      expect(chainOut.chance).toBe(0.6);
      expect(chainOut.chain).toEqual({ chance: 0.4, decay: 0.2, sameTarget: true });
    }
  });

  it('窗口：普攻命中后连锁最多 4 次伤害（1 基础 + 3 连锁），且全部打同一目标', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = makeCtx(pursuitTeam('chengsheng_zhuiji'), seed);
      ctx.skills.set('chengsheng_zhuiji', { ...asPursuit('chengsheng_zhuiji'), triggerRate: 1 });
      actUnit(ctx, ctx.myTeam[0]);
      const hits = damageEvents(ctx, 'chengsheng_zhuiji');
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.length).toBeLessThanOrEqual(4);
      const targetIds = new Set(hits.map((h) => h.targetId));
      expect(targetIds.size).toBe(1);
      // 连锁全部打「本次普攻的命中目标」（普攻目标本身是攻击距离内随机，故按 attack_hit 对齐）
      const ping = ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
          e.type === 'attack_hit' && e.sourceId === 'carrier'
      );
      expect([...targetIds][0]).toBe(ping?.targetId);
    }
  });

  it('机制：连锁按士气修正逐次判定（chain chance 0.6 的 skill_trigger 事件带 baseRate 60）', () => {
    const ctx = makeCtx(pursuitTeam('chengsheng_zhuiji'), 3);
    ctx.skills.set('chengsheng_zhuiji', { ...asPursuit('chengsheng_zhuiji'), triggerRate: 1 });
    actUnit(ctx, ctx.myTeam[0]);
    const rolls = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'chengsheng_zhuiji'
    );
    // 第一条是追击自身发动率（已 patch 成 1），其后为连锁判定（60/40/20 递减）
    const chainRolls = rolls.filter((r) => r.baseRate !== 100);
    expect(chainRolls.length).toBeGreaterThanOrEqual(1);
    expect(chainRolls[0].baseRate).toBe(60);
    for (const r of chainRolls) expect([60, 40, 20]).toContain(r.baseRate);
  });
});

describe('势无虚动（A 被动：每次试图发动追击 → 无视规避 + 追击伤害 +40% 最多 3 层，打出后清空）', () => {
  it('装配：battle_start 被动、output 空、onPursuitAttempt 两段（ignore_evasion + 追击增伤 chargesStack）', () => {
    const s = asPassive('shiwu_xudong');
    expect(s.timing).toBe('battle_start');
    expect(s.output).toHaveLength(0);
    expect(s.onPursuitAttempt?.output).toHaveLength(2);
    const ig = inflictStatusOf(s.onPursuitAttempt?.output[0]);
    expect(ig?.type).toBe('ignore_evasion');
    const boost = inflictStatusOf(s.onPursuitAttempt?.output[1]);
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') {
      expect(boost.rate).toBe(0.4);
      expect(boost.direction).toBe('caused');
      expect(boost.skillTypes).toEqual(['pursuit']);
      expect(boost.stacks).toBe(1);
      expect(boost.maxStacks).toBe(3);
      expect(boost.charges).toBe(1);
      expect(boost.chargesStack).toBe(true);
    }
  });

  it('窗口：每次「试图发动」叠 1 层（追击判定失败也算），3 层封顶', () => {
    const ctx = makeCtx(pursuitTeam('quzhu', 'shiwu_xudong'));
    // 追击发动率设为 0：只「试图发动」，不打出伤害 → 层数保留
    ctx.skills.set('quzhu', { ...asPursuit('quzhu'), triggerRate: 0 });
    const carrier = ctx.myTeam[0];
    for (let i = 0; i < 4; i++) actUnit(ctx, carrier);
    const boost = statusOf(carrier, 'damage_boost');
    expect(boost?.type).toBe('damage_boost');
    if (boost?.type === 'damage_boost') {
      expect(boost.stacks).toBe(3);
      expect(boost.rate).toBeCloseTo(1.2, 6);
    }
    expect(statusOf(carrier, 'ignore_evasion')?.type).toBe('ignore_evasion');
  });

  it('窗口：下一次追击实际打出后清空全部层数（charges 消耗 + 无视规避一并消耗）', () => {
    const ctx = makeCtx(pursuitTeam('quzhu', 'shiwu_xudong'));
    ctx.skills.set('quzhu', { ...asPursuit('quzhu'), triggerRate: 1 });
    const carrier = ctx.myTeam[0];
    actUnit(ctx, carrier);
    // 追击打出了伤害
    expect(damageEvents(ctx, 'quzhu').length).toBeGreaterThan(0);
    // 增伤层与无视规避都被消耗
    expect(statusOf(carrier, 'damage_boost')).toBeUndefined();
    expect(statusOf(carrier, 'ignore_evasion')).toBeUndefined();
  });
});
