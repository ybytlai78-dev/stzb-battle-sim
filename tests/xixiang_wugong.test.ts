/**
 * 西乡武功（SP朱儁·汉弓 h553 主战法：指挥 A · 距离 2 · 我军群体（有效距离内 2 个目标）· 弓）
 *
 * 用户实测口径修正（2026-10-15）——覆盖两条报告：
 *   ① 「使其在第2回合行动前…发动一次策略攻击」= 由**被锁定的我军群体各自出手**（每名武将按自身
 *      谋略/兵力/增减伤结算）；旧实现由朱儁自己打出 ⇒「效果未调动队友」。
 *   ② 第 2 回合**回合开始实时结算**（`delayedOutputs`，不预存）；旧实现走 `delayedOutput`（准备阶段
 *      预存伤害）⇒ 不带增减伤归因、也不触发「我军全体策略伤害相邻溅射」的光环（其徐如林）。
 *   ③ 「使我军群体每回合都能优先行动」= 准备阶段给锁定目标挂 `priority`（第 1~2 回合）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle, buildPriorityOrder } from '../src/engine/combat';
import {
  applyDamage,
  sumReduce,
  triggerCommandSkills,
  triggerDelayedOutputs,
  tickStatuses,
  type CombatContext,
  type DamageHitContext,
} from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';
import { HUGE_MODIFIER_RATE } from '../src/engine/formulas';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, strategy = 60, speed = 20): General {
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
    attack: 100,
    defense: 80,
    strategy,
    speed,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

/** 朱儁：带西乡武功的弓兵（站前锋） */
function zhu(): General {
  const g = dummy('zhu', '前锋', 160);
  g.troopType = 'archer';
  g.commandSkillIds = ['xixiang_wugong'];
  return g;
}

/** 司马懿·晋（其徐如林：我军全体策略伤害相邻溅射） */
function sima(): General {
  const g = dummy('sima', '大营', 260);
  g.commandSkillIds = ['qixu_rulin'];
  return g;
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

function enemyTeam(speed = 20): General[] {
  return [dummy('enemy-front', '前锋', 60, speed), dummy('enemy-mid', '中军', 60, speed), dummy('enemy-back', '大营', 60, speed)];
}

function makeCtx(my: General[], enemies: General[] = enemyTeam(), seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemies.map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

const damagesOf = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

/** 准备阶段释放 + 锁定（一类指挥） */
function lockPrep(ctx: CombatContext, unitId: string): void {
  const unit = ctx.myTeam.find((u) => u.general.id === unitId) ?? ctx.enemyTeam.find((u) => u.general.id === unitId)!;
  triggerCommandSkills(ctx, unit);
}

const lockedTargetsOf = (ctx: CombatContext, skillId: string): UnitState[] =>
  ctx.lockedCommands.find((l) => l.skill.id === skillId)?.targets ?? [];

describe('西乡武功 · 准备阶段（一类指挥释放 + 锁定我军群体 2 目标）', () => {
  it('锁定 2 个我军目标，并给它们挂第 1~2 回合优先行动（priority 2）', () => {
    const ctx = makeCtx([zhu(), dummy('ally-mid', '中军'), dummy('ally-back', '大营')]);
    lockPrep(ctx, 'zhu');

    const locked = lockedTargetsOf(ctx, 'xixiang_wugong');
    expect(locked).toHaveLength(2);
    for (const t of locked) {
      const st = t.statuses.find((s) => s.type === 'priority');
      expect(st, `${t.general.id} 应有 priority`).toBeTruthy();
      expect(st && 'remaining' in st ? st.remaining : -1).toBe(2);
    }
  });

  it('先手：锁定友军（速度低于敌军）第 1 回合排在最快的敌军之前；第 3 回合起失效', () => {
    const fast = enemyTeam(300);
    const ctx = makeCtx([zhu(), dummy('ally-mid', '中军'), dummy('ally-back', '大营')], fast);
    lockPrep(ctx, 'zhu');

    const locked = lockedTargetsOf(ctx, 'xixiang_wugong');
    const allies = locked.filter((t) => t.general.id !== 'zhu');
    expect(allies.length).toBeGreaterThan(0);

    const order1 = buildPriorityOrder([...ctx.myTeam, ...ctx.enemyTeam], 1, ctx.skills);
    const idx = (id: string) => order1.findIndex((u) => u.general.id === id);
    for (const a of allies) {
      expect(idx(a.general.id)).toBeLessThan(idx('enemy-front'));
    }

    // 回合末递减两次（R1、R2）→ 第 3 回合 priority 清空、朱儁的 priorityRounds(2) 也到期
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    ctx.currentRound = 3;
    for (const t of locked) {
      expect(t.statuses.some((s) => s.type === 'priority')).toBe(false);
    }
    const order3 = buildPriorityOrder([...ctx.myTeam, ...ctx.enemyTeam], 3, ctx.skills);
    expect(order3[0].general.id).toBe('enemy-front'); // 速度最高者排前
  });
});

describe('西乡武功 · 第 2 回合结算（我军群体各自出手 + 实时口径）', () => {
  it('每名被锁定的友军各出手一次，伤害按**各自**谋略结算（不是朱儁代打）', () => {
    const ctx = makeCtx([zhu(), dummy('ally-mid', '中军', 300), dummy('ally-back', '大营', 20)]);
    lockPrep(ctx, 'zhu');
    // 只留 1 个敌军：group 2 退化为该单体 → 两名出手者目标一致，可直接比数值
    ctx.enemyTeam.forEach((e) => (e.alive = e.general.id === 'enemy-mid'));

    ctx.currentRound = 2;
    triggerDelayedOutputs(ctx, 2);

    const locked = lockedTargetsOf(ctx, 'xixiang_wugong');
    const lockedIds = locked.map((t) => t.general.id).sort();
    const hits = damagesOf(ctx, 'xixiang_wugong');

    // ① 每名锁定友军各一条；来源 = 那些友军
    expect(hits).toHaveLength(locked.length);
    expect([...new Set(hits.map((h) => h.sourceId))].sort()).toEqual(lockedIds);
    expect(hits.every((h) => h.sourceId !== undefined && lockedIds.includes(h.sourceId))).toBe(true);

    // ② 实时口径：不带 delayedEffect（不预存）、带增减伤归因
    expect(hits.every((h) => !('delayedEffect' in h) || h.delayedEffect !== true)).toBe(true);
    expect(hits.every((h) => h.modifiers !== undefined)).toBe(true);
    expect(ctx.events.some((e) => e.type === 'stored_effect_expired')).toBe(false);

    // ③ 伤害随**出手者自身**谋略：谋略最高的那条 > 谋略最低的那条
    const byStrategy = [...locked].sort((a, b) => a.general.strategy - b.general.strategy);
    const dmgOf = (id: string) => hits.filter((h) => h.sourceId === id).reduce((s, h) => s + h.damage, 0);
    expect(dmgOf(byStrategy[byStrategy.length - 1].general.id)).toBeGreaterThan(
      dmgOf(byStrategy[0].general.id)
    );
  });

  it('代打段触发其徐如林相邻溅射（旧实现预存伤害时零溅射）', () => {
    const ctx = makeCtx([zhu(), sima()], enemyTeam());
    lockPrep(ctx, 'zhu');
    lockPrep(ctx, 'sima');

    ctx.currentRound = 2;
    triggerDelayedOutputs(ctx, 2);

    const lockedIds = lockedTargetsOf(ctx, 'xixiang_wugong').map((t) => t.general.id);
    const splash = damagesOf(ctx, 'qixu_rulin');
    expect(splash.length).toBeGreaterThan(0);
    // 溅射由**实际出手的友军**结算（攻击/兵力/增减伤口径），战法归因记其徐如林施法者
    expect(splash.every((s) => s.sourceId !== undefined && lockedIds.includes(s.sourceId))).toBe(true);
    expect(splash.some((s) => s.creditToId === 'sima')).toBe(true);
    expect(splash.every((s) => s.damage > 0)).toBe(true);
  });

  it('第 2 回合之外不结算（只在第 2 回合）', () => {
    const ctx = makeCtx([zhu(), dummy('ally-mid', '中军')]);
    lockPrep(ctx, 'zhu');
    ctx.currentRound = 3;
    triggerDelayedOutputs(ctx, 3);
    expect(damagesOf(ctx, 'xixiang_wugong')).toHaveLength(0);
  });
});

describe('西乡武功 · 真实武将端到端（朱儁 h553 + 晋司马懿 h807）', () => {
  it('第 2 回合由我军群体出手、吃其徐如林溅射，且不再出现预存伤害事件', () => {
    const zhuReal = withSkills(level40({ ...HERO_REGISTRY['h553'] }, { strategy: 40 }), {
      commandSkillIds: ['xixiang_wugong'],
    });
    const simaReal = withSkills(level40({ ...HERO_REGISTRY['h807'] }, { strategy: 40 }), {
      commandSkillIds: ['qixu_rulin'],
    });

    const report = runBattle({
      seed: 1,
      maxRounds: 8,
      myTeam: [zhuReal, simaReal, dummy('ally-mid', '中军', 100)],
      enemyTeam: enemyTeam(),
    });

    const xh = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'xixiang_wugong'
    );
    expect(xh.length).toBeGreaterThan(0);
    // 调动队友：至少一条由非朱儁的我军打出
    expect(xh.some((e) => e.sourceId !== 'h553')).toBe(true);
    // 实时结算：无预存标记、无「效果消失」事件
    expect(xh.every((e) => e.delayedEffect !== true)).toBe(true);
    expect(report.events.some((e) => e.type === 'stored_effect_expired')).toBe(false);
    // 其徐如林相邻溅射
    expect(
      report.events.some((e) => e.type === 'damage' && e.skillId === 'qixu_rulin' && e.damageType === 'strategy')
    ).toBe(true);
  });
});

describe('西乡武功 · 「下一次受到的伤害大幅降低」', () => {
  const hitOf = (damageType: 'physical' | 'strategy'): DamageHitContext => ({
    damageSource: 'skill',
    damageType,
    skillType: 'active',
  });

  it('准备阶段给锁定友军挂攻击 / 策略两条「大幅降低」次数型减伤（各 1 次）', () => {
    const ctx = makeCtx([zhu(), dummy('ally-mid', '中军'), dummy('ally-back', '大营')]);
    lockPrep(ctx, 'zhu');

    for (const t of lockedTargetsOf(ctx, 'xixiang_wugong')) {
      const reds = t.statuses.filter((s) => s.type === 'damage_reduce');
      expect(reds, `${t.general.id} 应有两条减伤轨`).toHaveLength(2);
      for (const r of reds) {
        // 「大幅度降低」= 极大值哨兵 1000%（用户 2026-10-21 口径），不是 90%
        expect(r.rate).toBeCloseTo(HUGE_MODIFIER_RATE);
        expect('charges' in r ? r.charges : undefined).toBe(1);
      }
      const kinds = reds.map((r) => ('damageType' in r ? r.damageType : undefined)).sort();
      expect(kinds).toEqual(['physical', 'strategy']);
    }
  });

  it('走真实结算路径：下一次策略伤害大幅降低，用完即移除，攻击轨仍留着', () => {
    const ctx = makeCtx([zhu(), dummy('ally-mid', '中军')]);
    lockPrep(ctx, 'zhu');

    const ally = ctx.myTeam.find((u) => u.general.id === 'ally-mid')!;
    const foe = ctx.enemyTeam[0];

    // 两条轨各自匹配自家的伤害类型，各取「大幅」哨兵
    expect(sumReduce(ctx, ally, hitOf('strategy'), foe)).toBeCloseTo(HUGE_MODIFIER_RATE);
    expect(sumReduce(ctx, ally, hitOf('physical'), foe)).toBeCloseTo(HUGE_MODIFIER_RATE);

    // 策略伤害打进来 → 策略轨消耗（扣兵后 −1 到 0 移除），攻击轨不受影响
    applyDamage(ctx, ally, 1000, foe, 'strategy', 'skill', undefined, { skillType: 'active' });
    expect(sumReduce(ctx, ally, hitOf('strategy'), foe)).toBeCloseTo(0);
    expect(sumReduce(ctx, ally, hitOf('physical'), foe)).toBeCloseTo(HUGE_MODIFIER_RATE);
    expect(ally.statuses.filter((s) => s.type === 'damage_reduce')).toHaveLength(1);

    // 该单位无其他减伤来源：非匹配类型（攻击轨道已被用掉后）不再减免
    applyDamage(ctx, ally, 1000, foe, 'physical', 'skill', undefined, { skillType: 'active' });
    expect(ally.statuses.some((s) => s.type === 'damage_reduce')).toBe(false);
  });
});
