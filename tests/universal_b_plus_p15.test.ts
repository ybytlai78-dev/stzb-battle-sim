/**
 * 拆解通用 B+ 第十五阶段 · 延迟结算（A 级 1 个）：
 * 翕处还张（准备主动：群体 132% 策略 + 1~2 目标「下一次造成伤害后再受 165% 策略伤害」）。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { applyDamage, triggerActiveSkill, type CombatContext } from '../src/engine/action';
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
    morale: 140,
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

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
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

/** 直接释放（准备战法补 prepare:false），施法者固定 myTeam[0] */
function castActive(ctx: CombatContext, skillId: string): Extract<Skill, { type: 'active' }> {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, ctx.myTeam[0], copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
  return copy;
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

describe('翕处还张（A 准备主动 40%：群体 132% 策略 + 1~2 目标造成伤害后再受 165% 策略）', () => {
  it('装配：准备主动、距离 5、groupCount [2,3]；主段 132% + mark_deal_punish 165% / [1,2]', () => {
    const s = asActive('xichu_haizhang');
    expect(s.prepare).toBe(true);
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toEqual([2, 3]);
    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'mark_deal_punish']);
    const dmg = s.output[0];
    if (dmg.kind === 'strategy_damage') {
      expect(dmg.rate).toBe(132);
      expect(dmg.strategyScaled).toBe(true);
      expect(dmg.growthRate).toBeUndefined();
    }
    const mark = s.output[1];
    if (mark.kind === 'mark_deal_punish') {
      expect(mark.rate).toBe(165);
      expect(mark.strategyScaled).toBe(true);
      expect(mark.groupCount).toEqual([1, 2]);
    }
  });

  it('窗口：释放后给 1~2 名敌军挂标记，主段打 2~3 名敌军', () => {
    const ctx = makeCtx(activeTeam('xichu_haizhang'));
    castActive(ctx, 'xichu_haizhang');
    const hits = damageEvents(ctx, 'xichu_haizhang');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(3);
    const marks = ctx.dealPunishMarks ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks.length).toBeLessThanOrEqual(2);
    for (const m of marks) {
      expect(m.casterId).toBe('carrier');
      expect(m.skillId).toBe('xichu_haizhang');
      expect(m.rate).toBe(165);
    }
  });

  it('窗口：标记持有者下一次「造成伤害」后，被原施法者再打一次策略伤害并消耗标记', () => {
    const ctx = makeCtx(activeTeam('xichu_haizhang'), 3);
    castActive(ctx, 'xichu_haizhang');
    const marks = ctx.dealPunishMarks ?? [];
    expect(marks.length).toBeGreaterThan(0);
    const holderId = marks[0].holderId;
    const holder = ctx.enemyTeam.find((u) => u.general.id === holderId);
    if (!holder) throw new Error('无标记目标');
    // 标记持有者出手造成伤害（用任意来源）→ 触发反噬
    applyDamage(ctx, ctx.myTeam[1], 100, holder, 'physical', 'skill');
    const punish = damageEvents(ctx, 'xichu_haizhang').filter((e) => e.targetId === holderId);
    // 主段（若命中该目标）之外的额外一条 = 反噬
    expect(punish.length).toBeGreaterThan(0);
    const last = punish[punish.length - 1];
    expect(last.damageType).toBe('strategy');
    expect(last.sourceId).toBe('carrier');
    // 标记已被消耗
    expect((ctx.dealPunishMarks ?? []).some((m) => m.holderId === holderId)).toBe(false);
  });

  it('窗口：标记只在 1~2 个目标上（不超过 2），主段与标记目标可不同', () => {
    const ctx = makeCtx(activeTeam('xichu_haizhang'), 5);
    castActive(ctx, 'xichu_haizhang');
    const marks = ctx.dealPunishMarks ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks.length).toBeLessThanOrEqual(2);
    const ids = new Set(marks.map((m) => m.holderId));
    expect(ids.size).toBe(marks.length);
    for (const id of ids) expect(ctx.enemyTeam.some((u) => u.general.id === id)).toBe(true);
  });
});
