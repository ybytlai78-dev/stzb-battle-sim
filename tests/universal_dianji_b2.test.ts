/**
 * 典籍战法批次 2（5 张）：文启（B 指挥 200820）/ 分险（B 被动 200787）/ 兵贵神速（C 指挥 200812）/
 * 武锋（B 主动 200823）/ 掠敌之利（B 追击 200786）。
 * 下架：文启（策略 60% 受谋略）、兵贵神速（防御 +10 受速度）、武锋（属性 −56 受速度）——
 * 官方未给系数（按基值不缩放）；分险 / 掠敌之利全文无受属性段 → 上架。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  applyDamage,
  triggerActiveSkill,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { isLearnableSkillListed } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 20000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
    ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
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

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function asActive(id: string): Extract<Skill, { type: 'active' }> {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'active') throw new Error(`${id} 不是主动战法`);
  return s;
}

function castActive(ctx: CombatContext, unit: UnitState, skillId: string): void {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

const damageEvents = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter((e) => e.type === 'damage' && e.skillId === skillId);

/** 攻击伤害对比用：返回受击后剩余兵力（attack_hit 的 damage 是扣减前值，不含 before_damage 减伤） */
function basicHitDamage(skillIds: string[], seed: number): number {
  const victim = dummy('victim', '前锋', {
    passiveSkillIds: skillIds,
    commandSkillIds: [],
  });
  const ctx = makeCtx([makeUnit(victim)], [makeUnit(dummy('striker', '前锋', { attack: 150 }), 'enemy')], seed);
  actUnit(ctx, ctx.enemyTeam[0]);
  return ctx.myTeam[0].troops;
}

// ── 文启 ──────────────────────────────────────────────────────────

describe('文启（B 指挥·一类·优先行动 + 受攻击伤害 50% 反击策略 60%）', () => {
  it('装配：prep / 全程先手 / onHurt 攻击伤害 50% → 距离 3 内敌军单体策略 60%（受谋略无系数）', () => {
    const s = SKILL_REGISTRY['wenqi'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.priorityRounds).toBe(999);
    expect(s.retainAfterDeath).toBe(true);
    expect(s.targetMode).toBe('random_single');
    expect(s.range).toBe(3); // 面板距离 1（目标是自己）→ 引擎按「有效距离 3 以内」取 3（推定）
    const oh = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    expect(oh).toMatchObject({ victim: 'self', damageKind: 'physical', rate: 0.5, applyTo: 'skill_targets' });
    expect(oh?.output?.[0]).toMatchObject({ kind: 'strategy_damage', rate: 60, strategyScaled: true });
  });

  it('下架：策略 60% 受谋略成长未确认', () => {
    expect(isLearnableSkillListed('wenqi')).toBe(false);
  });

  it('受到攻击伤害 → 掷 50%（技能触发事件）；命中则对距离内敌军单体打出策略伤害', () => {
    let hit: CombatContext | undefined;
    for (let seed = 1; seed <= 40 && !hit; seed += 1) {
      const carrier = dummy('carrier', '大营', { commandSkillIds: ['wenqi'] });
      const ctx = makeCtx(
        [makeUnit(carrier), makeUnit(dummy('ally', '前锋'))],
        [makeUnit(dummy('e', '前锋'), 'enemy')],
        seed
      );
      triggerCommandSkills(ctx, ctx.myTeam[0]);
      ctx.events.length = 0;
      applyDamage(ctx, ctx.myTeam[0], 500, ctx.enemyTeam[0], 'physical', 'skill');
      const trig = ctx.events.filter(
        (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
          e.type === 'skill_trigger' && e.skillId === 'wenqi'
      );
      expect(trig.length).toBe(1);
      expect(trig[0].baseRate).toBe(50);
      if (trig[0].success && damageEvents(ctx, 'wenqi').length > 0) hit = ctx;
    }
    expect(hit).toBeTruthy();
    const dmg = damageEvents(hit!, 'wenqi')[0] as Extract<BattleEvent, { type: 'damage' }>;
    expect(dmg.damageType).toBe('strategy');
    expect(dmg.damage).toBeGreaterThan(0);
  });

  it('策略伤害（damageKind:strategy）不触发本钩子', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['wenqi'] });
    const ctx = makeCtx([makeUnit(carrier)], [makeUnit(dummy('e', '前锋'), 'enemy')], 3);
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    ctx.events.length = 0;
    applyDamage(ctx, ctx.myTeam[0], 500, ctx.enemyTeam[0], 'strategy', 'skill');
    expect(ctx.events.some((e) => e.type === 'skill_trigger' && e.skillId === 'wenqi')).toBe(false);
  });
});

// ── 分险 ──────────────────────────────────────────────────────────

describe('分险（B 被动·攻击距离 +1 + 受击 50% 本次伤害 −32%）', () => {
  it('装配：range_buff +1；before_damage 50% thisHitReduce 0.32', () => {
    const s = SKILL_REGISTRY['fenxian'];
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'range_buff', amount: 1, duration: 999 },
    });
    const oh = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    expect(oh).toMatchObject({ victim: 'self', rate: 0.5, timing: 'before_damage', thisHitReduce: 0.32, applyTo: 'victim' });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('fenxian')).toBe(true);
  });

  it('同种子对照：带分险遭受的普攻伤害 ≤ 不带（50% 判定命中时 −32%）', () => {
    let reduced = false;
    for (let seed = 1; seed <= 12 && !reduced; seed += 1) {
      const plain = basicHitDamage([], seed);
      const withSkill = basicHitDamage(['fenxian'], seed);
      expect(plain).toBeLessThan(20000); // 确实挨了一刀
      expect(withSkill).toBeGreaterThanOrEqual(plain);
      if (withSkill > plain) reduced = true;
    }
    expect(reduced).toBe(true);
  });

  it('整场跑通：被动登记后攻击距离 +1 生效（range_buff 状态）', () => {
    const report = runBattle({
      seed: 2,
      maxRounds: 2,
      myTeam: [dummy('me', '前锋', { passiveSkillIds: ['fenxian'] }), dummy('a', '中军'), dummy('b', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });
    expect(
      report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'range_buff')
    ).toBe(true);
  });
});

// ── 兵贵神速 ──────────────────────────────────────────────────────

describe('兵贵神速（C 指挥·一类·我军群体 3 目标：骑兵受攻击伤害后防御 +10，可叠 8 层）', () => {
  it('装配：locked 受击钩子 + 骑兵过滤 + 显式叠层上限 8 + 受速度（无系数）', () => {
    const s = SKILL_REGISTRY['bingui_shensu'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect(s.groupCount).toBe(3);
    const oh = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    expect(oh).toMatchObject({ victim: 'locked', damageKind: 'physical', applyTo: 'victim' });
    expect(oh?.output?.[0]).toMatchObject({
      kind: 'inflict_status',
      troopTypes: ['cavalry'],
      status: { type: 'defense_buff', amount: 10, duration: 999, speedScaled: true, stack: true, maxStacks: 8 },
    });
  });

  it('下架：防御 +10 受速度成长未确认', () => {
    expect(isLearnableSkillListed('bingui_shensu')).toBe(false);
  });

  it('骑兵每次受到攻击伤害 +10 防御、封顶 8 层（+80）；步兵不吃', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['bingui_shensu'], troopType: 'cavalry' });
    const cav = dummy('cav', '前锋', { troopType: 'cavalry' });
    const inf = dummy('inf', '中军', { troopType: 'infantry' });
    const ctx = makeCtx(
      [makeUnit(carrier), makeUnit(cav), makeUnit(inf)],
      [makeUnit(dummy('e', '前锋'), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const striker = ctx.enemyTeam[0];

    for (let i = 0; i < 9; i += 1) {
      ctx.myTeam[1].troops = ctx.myTeam[1].general.maxTroops; // 补满便于重复受击
      applyDamage(ctx, ctx.myTeam[1], 300, striker, 'physical', 'skill');
    }
    applyDamage(ctx, ctx.myTeam[2], 300, striker, 'physical', 'skill');

    const cavBuff = ctx.myTeam[1].statuses.find(
      (s): s is Extract<Status, { type: 'defense_buff' }> => s.type === 'defense_buff'
    );
    expect(cavBuff?.amount).toBe(80); // 8 层封顶
    expect(ctx.myTeam[2].statuses.some((s) => s.type === 'defense_buff')).toBe(false); // 步兵不吃
  });
});

// ── 武锋 ──────────────────────────────────────────────────────────

describe('武锋（B 主动·距离 4·40%·敌军单体：攻击 209% + 攻谋 −56 受速度 2 回合）', () => {
  it('装配：random_single；两段属性下降 speedScaled 且无 growthRate', () => {
    const s = asActive('wufeng');
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('random_single');
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 209 });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'attack_buff', amount: -56, duration: 2, speedScaled: true },
    });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'strategy_buff', amount: -56, duration: 2, speedScaled: true },
    });
  });

  it('下架：属性 −56 受速度成长未确认', () => {
    expect(isLearnableSkillListed('wufeng')).toBe(false);
  });

  it('释放：对敌军单体打出 209% 攻击并挂攻/谋 −56（2 回合）', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['wufeng'] });
    const ctx = makeCtx([makeUnit(me)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    castActive(ctx, ctx.myTeam[0], 'wufeng');
    expect(damageEvents(ctx, 'wufeng').length).toBe(1);
    const foe = ctx.enemyTeam[0];
    const atk = foe.statuses.find(
      (s): s is Extract<Status, { type: 'attack_buff' }> => s.type === 'attack_buff'
    );
    const str = foe.statuses.find(
      (s): s is Extract<Status, { type: 'strategy_buff' }> => s.type === 'strategy_buff'
    );
    expect(atk?.amount).toBe(-56);
    expect(str?.amount).toBe(-56);
    expect(atk?.remaining).toBe(2);
  });
});

// ── 掠敌之利 ──────────────────────────────────────────────────────

describe('掠敌之利（B 追击·35%：170% 攻击 + 吸取攻击 36 两回合）', () => {
  it('装配：追击 170% + 目标 −36 攻击 / 自身 +36 攻击', () => {
    const s = SKILL_REGISTRY['luedi_zhili'];
    expect(s.type).toBe('pursuit');
    if (s.type !== 'pursuit') return;
    expect(s.triggerRate).toBe(0.35);
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 170 });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'attack_buff', amount: -36, duration: 2 },
    });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'attack_buff', amount: 36, duration: 2 },
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('luedi_zhili')).toBe(true);
  });

  it('整场跑通：打出追击伤害，并把 −36 挂给攻击目标、+36 挂给自己', () => {
    const carrier = dummy('carrier', '前锋', { pursuitSkillIds: ['luedi_zhili'], attack: 200 });
    const report = runBattle({
      seed: 4,
      maxRounds: 8,
      myTeam: [carrier, dummy('a', '中军'), dummy('b', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });
    const hits = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === 'luedi_zhili' && e.damageType === 'physical'
    );
    expect(hits.length).toBeGreaterThan(0);
    const buffs = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'attack_buff'
    );
    expect(buffs.some((e) => e.unitId === 'carrier')).toBe(true); // 附加于自身
    expect(buffs.some((e) => e.unitId !== 'carrier')).toBe(true); // 吸取目标
  });
});
