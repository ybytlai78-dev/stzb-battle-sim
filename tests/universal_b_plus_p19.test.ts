/**
 * 拆解通用 B+ 第十九阶段 · 美人计（B 指挥·距离 5·我军全体）：
 * **正式回合开始后**，我方 3 名武将均为女武将时——
 * ① 大营造成的所有伤害提升 14%；② 中军每回合行动前随机使敌军单体男武将
 * 「下一次攻击或策略攻击造成的伤害降低 60%」；③ 前 4 回合前锋首次受到伤害时进入规避状态，免疫该次伤害。
 */
import { describe, it, expect } from 'vitest';
import type { BattleEvent, CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  applyDamage,
  teamGendersMatch,
  triggerCommandSkills,
  triggerDelayedOutputs,
  triggerPreparedEffectOnAct,
  type CombatContext,
} from '../src/engine/action';
import { Rng } from '../src/engine/rng';

function dummy(
  id: string,
  position: Position,
  opts: { gender?: 'male' | 'female'; troops?: number } = {}
): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: opts.troops ?? 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    gender: opts.gender,
  };
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

function makeCtx(my: General[], enemies: General[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my.map((g) => unitFrom(g, 'my')),
    enemyTeam: enemies.map((g) => unitFrom(g, 'enemy')),
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 我军 3 名女将（前锋携带美人计） */
function femaleTeam(skillId: string): General[] {
  const carrier = dummy('carrier', '前锋', { gender: 'female' });
  carrier.commandSkillIds = [skillId];
  return [
    carrier,
    dummy('ally-mid', '中军', { gender: 'female' }),
    dummy('ally-back', '大营', { gender: 'female' }),
  ];
}

/** 敌军：前锋/中军男将，大营女将（验证「随机男武将」的预过滤） */
function enemyTeam(): General[] {
  return [
    dummy('enemy-front', '前锋', { gender: 'male' }),
    dummy('enemy-mid', '中军', { gender: 'male' }),
    dummy('enemy-back', '大营', { gender: 'female' }),
  ];
}

function commandSkill(id: string): CommandSkill {
  const s = SKILL_REGISTRY[id];
  if (s.type !== 'command') throw new Error(`${id} 不是指挥`);
  return s;
}

const debuffedBy = (ctx: CombatContext) =>
  ctx.myTeam
    .concat(ctx.enemyTeam)
    .filter((u) => u.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'meiren_ji'));

describe('美人计（B 指挥：女将组合 → 大营增伤 14% / 中军男将降伤 60% / 前 4 回合前锋首次受击规避）', () => {
  it('装配：一类指挥 prep、距离 5、我军全体、女将条件；三段机制字段齐备', () => {
    const s = commandSkill('meiren_ji');
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect(s.teamGenderFilter).toBe('female');
    expect(s.retainAfterDeath).toBe(true);
    expect(s.tags).toEqual(expect.arrayContaining(['damage_boost', 'evasion']));

    // ③ 中军每回合行动前（roundRepeat 判定落在锁定目标行动时，onlyPositions 限定中军）
    expect(s.roundRepeat).toEqual({ startRound: 1, endRound: 8, rate: 1, onlyPositions: ['中军'] });
    const debuff = s.output[0];
    if (debuff.kind !== 'inflict_status' || Array.isArray(debuff.status)) throw new Error('期望单个状态');
    expect(debuff.targetSide).toBe('enemy');
    expect(debuff.targetMode).toBe('random_single');
    expect(debuff.requireGender).toBe('male');
    expect(debuff.status.type).toBe('damage_boost');
    if (debuff.status.type === 'damage_boost') {
      expect(debuff.status.rate).toBe(-0.6);
      expect(debuff.status.direction).toBe('caused');
      expect(debuff.status.charges).toBe(1); // 「下一次攻击或策略攻击」
      expect(debuff.status.duration).toBe(999);
    }

    // ② 正式回合开始后：大营造成伤害 +14%
    expect(s.delayedOutputs).toHaveLength(1);
    expect(s.delayedOutputs?.[0].atRound).toBe(1);
    const boost = s.delayedOutputs![0].output[0];
    if (boost.kind !== 'inflict_status' || Array.isArray(boost.status)) throw new Error('期望单个状态');
    expect(boost.requirePositions).toEqual(['大营']);
    if (boost.status.type === 'damage_boost') {
      expect(boost.status.rate).toBe(0.14);
      expect(boost.status.direction).toBe('caused');
      expect(boost.status.duration).toBe(999);
    }

    // ④ 前 4 回合前锋首次受击 → 规避（受击前授予 1 层并当场消耗）
    const cfg = Array.isArray(s.onHurt) ? s.onHurt[0] : s.onHurt;
    if (!cfg) throw new Error('期望受击配置');
    expect(cfg.victim).toBe('locked');
    expect(cfg.victimPositions).toEqual(['前锋']);
    expect(cfg.timing).toBe('before_damage');
    expect(cfg.startRound).toBe(1);
    expect(cfg.endRound).toBe(4);
    expect(cfg.maxTriggers).toBe(1);
    expect(cfg.output?.[0].kind).toBe('grant_evasion');
  });

  it('性别条件：我军 3 将均为女将才生效；含男将则整次不生效', () => {
    const ok = makeCtx(femaleTeam('meiren_ji'), enemyTeam());
    triggerCommandSkills(ok, ok.myTeam[0]);
    expect(ok.lockedCommands).toHaveLength(1);
    expect(ok.events.some((e) => e.type === 'skill_cast' && e.skillId === 'meiren_ji')).toBe(true);

    const mixedTeam = femaleTeam('meiren_ji');
    mixedTeam[2].gender = 'male';
    const bad = makeCtx(mixedTeam, enemyTeam());
    triggerCommandSkills(bad, bad.myTeam[0]);
    expect(bad.lockedCommands).toHaveLength(0);
    expect(bad.events.some((e) => e.type === 'skill_cast' && e.skillId === 'meiren_ji')).toBe(false);

    // 单元口径：3 将须全为女将（不足 3 人 / 含无性别数据者均不满足）
    expect(teamGendersMatch(ok.myTeam, 'female')).toBe(true);
    expect(teamGendersMatch(bad.myTeam, 'female')).toBe(false);
  });

  it('大营增伤：准备阶段不施加；第 1 回合开始（正式回合）只给大营 +14%', () => {
    const ctx = makeCtx(femaleTeam('meiren_ji'), enemyTeam());
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    // 准备阶段只锁目标，不结算 output（官方「正式回合开始后」）
    expect(ctx.myTeam.every((u) => u.statuses.length === 0)).toBe(true);

    triggerDelayedOutputs(ctx, 1);
    const [front, mid, back] = ctx.myTeam;
    expect(front.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
    expect(mid.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
    const st = back.statuses.find((s) => s.type === 'damage_boost');
    if (st?.type !== 'damage_boost') throw new Error('期望大营获得增伤');
    expect(st.rate).toBe(0.14);
    expect(st.direction).toBe('caused');
    expect(st.remaining).toBe(999);
  });

  it('中军每回合行动前：随机敌军单体男武将挂「下一次攻击/策略伤害 −60%」（前锋/大营行动不触发）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = makeCtx(femaleTeam('meiren_ji'), enemyTeam(), seed);
      const carrier = ctx.myTeam[0];
      triggerCommandSkills(ctx, carrier);
      triggerPreparedEffectOnAct(ctx, ctx.myTeam[1]); // 中军行动前

      const hit = debuffedBy(ctx);
      expect(hit, `seed ${seed}`).toHaveLength(1);
      expect(hit[0].side).toBe('enemy'); // 只作用于敌军
      expect(hit[0].general.gender).toBe('male'); // 女将不会被随机到（随机前预过滤）
      const st = hit[0].statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'meiren_ji');
      if (st?.type !== 'damage_boost') throw new Error('期望 damage_boost');
      expect(st.rate).toBe(-0.6);
      expect(st.direction).toBe('caused');
      expect(st.charges).toBe(1);
      // 战报：skill_trigger 归属美人计（unitId = 战法携带者），被判定目标 = 中军
      const trig = ctx.events.find(
        (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
          e.type === 'skill_trigger' && e.skillId === 'meiren_ji'
      );
      expect(trig?.unitId).toBe('carrier');
      expect(trig?.targetId).toBe('ally-mid');
      expect(trig?.skillName).toBe('美人计');

      // 前锋 / 大营行动前不判定（onlyPositions: ['中军']）
      const before = hit[0].statuses.length;
      triggerPreparedEffectOnAct(ctx, ctx.myTeam[0]);
      triggerPreparedEffectOnAct(ctx, ctx.myTeam[2]);
      expect(debuffedBy(ctx)[0].statuses.length).toBe(before);
      expect(ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'meiren_ji')).toHaveLength(1);
    }
  });

  it('前 4 回合前锋首次受击：规避并免疫该次伤害；第二次不再免伤，非前锋不受保护', () => {
    const ctx = makeCtx(femaleTeam('meiren_ji'), enemyTeam());
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const [front, mid] = ctx.myTeam;
    const src = ctx.enemyTeam[0];

    const frontTroops = front.troops;
    applyDamage(ctx, front, 500, src, 'physical', 'basic');
    expect(front.troops).toBe(frontTroops); // 首次受击被规避 → 完全免疫
    expect(front.statuses.some((s) => s.type === 'evasion')).toBe(false); // 规避当场消耗

    applyDamage(ctx, front, 500, src, 'physical', 'basic');
    expect(front.troops).toBe(frontTroops - 500); // 仅首次

    // 非前锋（中军）不受保护
    const midTroops = mid.troops;
    applyDamage(ctx, mid, 500, src, 'physical', 'basic');
    expect(mid.troops).toBe(midTroops - 500);
  });

  it('前 4 回合窗口：第 5 回合前锋首次受击不再免伤', () => {
    const ctx = makeCtx(femaleTeam('meiren_ji'), enemyTeam());
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    const front = ctx.myTeam[0];
    const src = ctx.enemyTeam[0];
    ctx.currentRound = 5;

    const troops = front.troops;
    applyDamage(ctx, front, 500, src, 'physical', 'basic');
    expect(front.troops).toBe(troops - 500);
    expect(front.statuses.some((s) => s.type === 'evasion')).toBe(false);
  });
});
