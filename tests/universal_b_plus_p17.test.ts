/**
 * 拆解通用 B+ 第十七阶段：
 * ① 鸟云山兵（A 指挥·距离 2·我军群体 2 目标）：每回合行动时 30% 几率（每回合 +10%）使自身受到的
 *    攻击/策略伤害降低 60%，持续 1 回合，**两个效果独立判断**；
 * ② 十面埋伏（S 主动·1 回合准备·距离 5·40%）：敌军全体策略攻击 130%（受谋略）+
 *    随机使敌军群体 1-2 目标造成的所有伤害大幅度降低。
 */
import { describe, it, expect } from 'vitest';
import type {
  BattleEvent,
  CommandSkill,
  General,
  Position,
  Skill,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  actUnit,
  triggerActiveSkill,
  triggerCommandSkills,
  triggerPreparedEffectOnAct,
  type CombatContext,
  type LockedCommand,
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
  return [front, dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

function activeTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.activeSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function commandTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.commandSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
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

function activeSkill(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动`);
  return s;
}

/** 测试用：跳过 1 回合准备直接释放（准备时序由 prepared_timing.test.ts 统一覆盖） */
function directCast(id: string): Extract<Skill, { type: 'active' }> {
  return { ...activeSkill(id), prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
}

function castActive(ctx: CombatContext, skillId: string): void {
  const copy = directCast(skillId);
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, ctx.myTeam[0], copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

function commandSkill(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

/** 测试用：指定 roundRepeat 几率的战法副本（避开 30% 随机） */
function withRepeatRate(id: string, rate: number): CommandSkill {
  const s = commandSkill(id);
  return { ...s, roundRepeat: { ...s.roundRepeat!, rate } };
}

function lock(ctx: CombatContext, skill: CommandSkill, casterId: string, targets: UnitState[]): void {
  const locked: LockedCommand = { skill, casterId, targets, currentRate: 1 };
  ctx.lockedCommands.push(locked);
}

const triggers = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> => e.type === 'skill_trigger' && e.skillId === skillId
  );

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

const reducesOf = (u: UnitState) =>
  u.statuses.filter((s) => s.type === 'damage_reduce' && s.sourceSkillId === 'niaoyun_shanbing');

describe('鸟云山兵（A 指挥：每回合行动时 30%+10%/回合，攻击/策略减伤 60% 两段独立判定）', () => {
  it('装配：一类指挥 prep、距离 2、我军群体 2 目标；roundRepeat 带几率递增与逐段独立判定', () => {
    const s = commandSkill('niaoyun_shanbing');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.triggerRate).toBe(1);
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.roundRepeat).toEqual({
      startRound: 1,
      endRound: 8,
      rate: 0.3,
      rateIncrementPerRound: 0.1,
      independentRolls: true,
    });
    expect(s.tags).toContain('damage_reduce');

    const statuses = s.output.map((o) => (o.kind === 'inflict_status' && !Array.isArray(o.status) ? o.status : null));
    expect(statuses.map((st) => st?.type)).toEqual(['damage_reduce', 'damage_reduce']);
    expect(statuses.map((st) => (st?.type === 'damage_reduce' ? st.damageType : null))).toEqual([
      'physical',
      'strategy',
    ]);
    for (const st of statuses) {
      if (st?.type !== 'damage_reduce') throw new Error('期望 damage_reduce');
      expect(st.rate).toBe(0.6);
      expect(st.duration).toBe(1);
    }
  });

  it('锁定：准备阶段锁 2 名友军，且不立即施加（效果留到各自行动时判定）', () => {
    const ctx = makeCtx(commandTeam('niaoyun_shanbing'));
    const carrier = ctx.myTeam[0];
    triggerCommandSkills(ctx, carrier);

    expect(ctx.lockedCommands).toHaveLength(1);
    expect(ctx.lockedCommands[0].skill.id).toBe('niaoyun_shanbing');
    expect(ctx.lockedCommands[0].casterId).toBe('carrier');
    expect(ctx.lockedCommands[0].targets).toHaveLength(2); // 我军群体（有效距离内 2 个目标）
    expect(ctx.myTeam.every((u) => u.statuses.length === 0)).toBe(true);
  });

  it('递增：第 1~8 回合基础几率 30%→100%，每回合两段各掷一次（逐段独立判定）', () => {
    for (const round of [1, 2, 4, 8]) {
      const ctx = makeCtx(commandTeam('niaoyun_shanbing'), 7);
      const target = ctx.myTeam[0]; // 判定对象 = 自身（士气 100 → 系数 1）
      ctx.currentRound = round;
      lock(ctx, withRepeatRate('niaoyun_shanbing', 0.3), target.general.id, [target]);
      triggerPreparedEffectOnAct(ctx, target);

      const evs = triggers(ctx, 'niaoyun_shanbing');
      const expected = Math.min(100, 30 + 10 * (round - 1));
      expect(evs, `第 ${round} 回合`).toHaveLength(2); // 两个效果独立判断 = 每段一次判定
      expect(evs.map((e) => e.baseRate)).toEqual([expected, expected]);
      expect(evs.map((e) => e.rate)).toEqual([expected, expected]); // 士气 100 → 系数 1
    }
  });

  it('独立判定：40 个种子中「两段都生效」「只生效一段」「都不生效」三档均出现', () => {
    let onlyOne = 0;
    let both = 0;
    let none = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = makeCtx(commandTeam('niaoyun_shanbing'), seed);
      const target = ctx.myTeam[0];
      lock(ctx, withRepeatRate('niaoyun_shanbing', 0.5), target.general.id, [target]);
      triggerPreparedEffectOnAct(ctx, target);

      // 每段一次判定：两个 skill_trigger 事件
      expect(triggers(ctx, 'niaoyun_shanbing')).toHaveLength(2);
      const applied = reducesOf(target);
      expect(applied.length).toBeLessThanOrEqual(2);
      // 攻击伤害轨与策略伤害轨独立共存（同战法、过滤维不同 → 不合并、不冲突）
      const kinds = applied.map((s) => (s.type === 'damage_reduce' ? s.damageType : null)).sort();
      if (kinds.length === 1) expect(['physical', 'strategy']).toContain(kinds[0]);
      if (kinds.length === 2) expect(kinds).toEqual(['physical', 'strategy']);
      if (applied.length === 1) onlyOne++;
      else if (applied.length === 2) both++;
      else none++;
    }
    // 若整次只掷一次骰子，则只可能出现 0 个或 2 个 → onlyOne 必为 0
    expect(onlyOne).toBeGreaterThan(0);
    expect(both).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
  });

  it('持续 1 回合：本次行动仍生效，失效于其下一次行动开始前（行动开始即递减移除）', () => {
    const ctx = makeCtx(commandTeam('niaoyun_shanbing'), 3);
    const target = ctx.myTeam[0];
    lock(ctx, withRepeatRate('niaoyun_shanbing', 1), target.general.id, [target]);
    triggerPreparedEffectOnAct(ctx, target);
    expect(reducesOf(target)).toHaveLength(2); // 必中 → 两段都生效

    // 目标下一次行动（第 2 回合）：状态按「行动结束后递减」口径仍生效（保底让本次行动吃到减伤）
    ctx.lockedCommands = [];
    ctx.currentRound = 2;
    actUnit(ctx, target);
    expect(reducesOf(target)).toHaveLength(2);
    // 其后的行动开始（第 3 回合）：递减到期的状态静默移除 + 按当时几率重新判定
    ctx.currentRound = 3;
    actUnit(ctx, target);
    expect(reducesOf(target)).toHaveLength(0);
  });
});

describe('十面埋伏（S 主动·1 回合准备：敌军全体策略 130% + 随机 1-2 目标造成伤害大幅降低）', () => {
  it('装配：1 回合准备主动、距离 5、40%；策略 130%（受谋略，成长率留空）+ 减伤段 groupCount [1,2]', () => {
    const s = activeSkill('shimian_maifu');
    expect(s.prepare).toBe(true);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetSide).toBe('enemy');
    expect(s.targetMode).toBe('all');
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'damage_boost']));

    expect(s.output.map((o) => o.kind)).toEqual(['strategy_damage', 'inflict_status']);
    const dmg = s.output[0];
    if (dmg.kind !== 'strategy_damage') throw new Error('期望策略伤害');
    expect(dmg.rate).toBe(130);
    expect(dmg.strategyScaled).toBe(true);
    expect(dmg.growthRate).toBeUndefined(); // 受谋略缩放 → 成长率留空（待补名单）

    const reduce = s.output[1];
    if (reduce.kind !== 'inflict_status') throw new Error('期望 inflict_status');
    expect(reduce.targetSide).toBe('enemy');
    expect(reduce.targetMode).toBe('group');
    expect(reduce.groupCount).toEqual([1, 2]);
    const st = Array.isArray(reduce.status) ? reduce.status[0] : reduce.status;
    if (st.type !== 'damage_boost') throw new Error('期望 damage_boost');
    expect(st.rate).toBe(-99.99); // 「大幅度降低」用户口径
    expect(st.direction).toBe('caused');
    expect(st.duration).toBe(2); // 行动中施加给他人口径（辕门射戟）
  });

  it('伤害段：对敌军全体各结算一次策略伤害（3 目标）', () => {
    const ctx = makeCtx(activeTeam('shimian_maifu'), 5);
    castActive(ctx, 'shimian_maifu');

    const hits = damageEvents(ctx, 'shimian_maifu');
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.targetId).sort()).toEqual(['enemy-back', 'enemy-front', 'enemy-mid']);
    expect(hits.every((h) => h.damageType === 'strategy')).toBe(true);
    expect(hits.every((h) => h.sourceId === 'carrier')).toBe(true);
    expect(hits.every((h) => h.damage > 0)).toBe(true);
  });

  it('减伤段：随机 1-2 名敌军「造成的伤害大幅降低」（−99.99，持续 2 回合），不误伤我方', () => {
    const ctx = makeCtx(activeTeam('shimian_maifu'), 9);
    castActive(ctx, 'shimian_maifu');

    const debuffed = ctx.enemyTeam.filter((u) =>
      u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'shimian_maifu')
    );
    expect(debuffed.length).toBeGreaterThanOrEqual(1);
    expect(debuffed.length).toBeLessThanOrEqual(2);
    expect(ctx.myTeam.every((u) => u.statuses.length === 0)).toBe(true);

    for (const u of debuffed) {
      const st = u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'shimian_maifu');
      if (st?.type !== 'damage_boost') throw new Error('期望 damage_boost');
      expect(st.rate).toBe(-99.99);
      expect(st.direction).toBe('caused');
      expect(st.remaining).toBe(2);
    }
    const detail = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_boost'
    )?.detail;
    expect(detail).toContain('造成的伤害大幅降低');
    expect(detail).toContain('持续 2 回合');
  });

  it('准备时序：发动当回合只进入准备，不结算伤害；下回合行动时释放', () => {
    const ctx = makeCtx(activeTeam('shimian_maifu'), 4);
    const carrier = ctx.myTeam[0];
    ctx.skills.set('shimian_maifu', {
      ...activeSkill('shimian_maifu'),
      triggerRate: 1,
    } as Extract<Skill, { type: 'active' }>);

    actUnit(ctx, carrier);
    expect(carrier.preparations).toEqual([{ skillId: 'shimian_maifu', left: 1 }]);
    expect(damageEvents(ctx, 'shimian_maifu')).toHaveLength(0);
    expect(ctx.events.some((e) => e.type === 'prepare_start')).toBe(true);

    ctx.currentRound = 2;
    actUnit(ctx, carrier);
    expect(carrier.preparations).toHaveLength(0);
    expect(ctx.events.some((e) => e.type === 'prepare_end')).toBe(true);
    expect(damageEvents(ctx, 'shimian_maifu')).toHaveLength(3);
  });
});
