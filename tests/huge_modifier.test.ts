/**
 * 「大幅度降低 / 大幅减伤」口径（用户 2026-10-21 报障后钉死）：
 *
 * 文案写「大幅度」的减伤**不是一个能被增伤抵掉的 90%**，而是一个**很大的值**
 * （`HUGE_MODIFIER_RATE` = 1000%），配合 `buffMult` 的 10% 伤害下限 ⇒
 * 无论对方增伤多高，最终伤害都压到下限。
 *
 * 台账（包内 `tb_cfg_skill_detail`，effect 522 受攻击伤害降低 / 524 受策略攻击伤害降低）：
 *   - 磐阵善守 200816 → 子战法 21081601 / 21081602：`constant_param = 9000`；
 *   - 西乡武功 200791 → 子战法 21079112 / 21079113：`constant_param = 9000`；
 *   - 息交2 550033 → 子战法 55103301：`constant_param = 9000`、`available_hit = 2`。
 * 按「百分比修正 = const / 100」只是 90.0% —— 旧实现照抄成 `rate: 0.9`，
 * 于是敌方 +50% 增伤时只剩 60% 伤害（`1 + 0.5 − 0.9 = 0.6`），与「大幅度降低」的语义冲突。
 * 现行口径：一律取 `HUGE_MODIFIER_RATE`（1000%），同类「大幅度」的造成伤害侧取 `-HUGE_MODIFIER_RATE`。
 */
import { describe, it, expect } from 'vitest';
import { applyDamage, inflictStatus, sumReduce, type CombatContext } from '../src/engine/action';
import { buffMult, HUGE_MODIFIER_RATE, sumRates } from '../src/engine/formulas';
import { SKILL_REGISTRY } from '../src/data/skills';
import { BAIJIA_SKILLS } from '../src/data/baijia';
import { Rng } from '../src/engine/rng';
import type {
  BattleEvent,
  CreateStatus,
  General,
  Position,
  Skill,
  SkillOutput,
  UnitState,
} from '../src/engine/types';

function makeUnit(id: string, position: Position, side: 'my' | 'enemy'): UnitState {
  const general: General = {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    defense: 80,
    strategy: 100,
    speed: 60,
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
  return {
    general,
    side,
    troops: general.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
    hasActedThisRound: false,
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [makeUnit('my-front', '前锋', 'my'), makeUnit('my-mid', '中军', 'my')],
    enemyTeam: [makeUnit('enemy-front', '前锋', 'enemy'), makeUnit('enemy-mid', '中军', 'enemy')],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 收集某战法里所有 `damage_reduce` 输出段的 rate（覆盖 initial / roundStartRepeat / onActSegments） */
function reduceRatesOf(skill: Skill): number[] {
  const rates: number[] = [];
  const walk = (outs: readonly SkillOutput[] | undefined): void => {
    for (const o of outs ?? []) {
      if (o.kind !== 'inflict_status') continue;
      const st = o.status as CreateStatus | CreateStatus[];
      for (const one of Array.isArray(st) ? st : [st]) {
        if (one.type === 'damage_reduce') rates.push(one.rate);
      }
    }
  };
  const sk = skill as unknown as {
    output?: SkillOutput[];
    initialOutput?: SkillOutput[];
    roundStartRepeat?: { output: SkillOutput[] };
    onActSegments?: Array<{ output: SkillOutput[] }>;
  };
  walk(sk.output);
  walk(sk.initialOutput);
  walk(sk.roundStartRepeat?.output);
  for (const seg of sk.onActSegments ?? []) walk(seg.output);
  return rates;
}

describe('「大幅」减伤的哨兵值（HUGE_MODIFIER_RATE = 1000%）', () => {
  it('90% 会被敌方增伤抵掉，哨兵值一律压到 10% 伤害下限', () => {
    // 敌方造成伤害 +200%（causedMult 3.0）时：
    expect(buffMult(1 + 2, 1, 0.9)).toBeCloseTo(2.1, 5); // 旧口径：还剩 210% 伤害
    expect(buffMult(1 + 2, 1, HUGE_MODIFIER_RATE)).toBeCloseTo(0.1, 10); // 大幅：无条件触底
    // 增伤再高也压得住（+900%）
    expect(buffMult(1 + 9, 1, HUGE_MODIFIER_RATE)).toBeCloseTo(0.1, 10);
    // 普通减伤（≤84%）不受影响：疮痍累身 84% 仍是 1 − 0.84
    expect(buffMult(1, 1, 0.84)).toBeCloseTo(0.16, 10);
  });

  it('磐阵善守 / 西乡武功 / 息交2 的「大幅度」减伤都取哨兵值', () => {
    expect(reduceRatesOf(SKILL_REGISTRY.panzhen_shanshou!)).toEqual([HUGE_MODIFIER_RATE, HUGE_MODIFIER_RATE]);
    expect(reduceRatesOf(SKILL_REGISTRY.xixiang_wugong!)).toEqual([HUGE_MODIFIER_RATE, HUGE_MODIFIER_RATE]);
    const xijiao = BAIJIA_SKILLS.bj_550032;
    expect(xijiao, '息交2 应已入库').toBeTruthy();
    // 首段 0.4 = 「息交1」官方给了数字的物理减伤（const 20 + intel 50 ⇒ 40%），不走哨兵；
    // 第二段 = 息交2（子战法 55103301，const 9000 的「大幅降低」）⇒ 哨兵
    expect(reduceRatesOf(xijiao!)).toEqual([0.4, HUGE_MODIFIER_RATE]);
  });

  it('真实状态汇总路径：敌方 +200% 增伤 + 磐阵减伤 → 净倍率仍是下限 10%', () => {
    const ctx = makeCtx();
    const victim = ctx.myTeam[0]!;
    const attacker = ctx.enemyTeam[0]!;
    inflictStatus(
      ctx,
      attacker,
      { type: 'damage_boost', rate: 2, duration: 999, direction: 'caused' },
      'passive',
      'test_boost_200'
    );
    inflictStatus(
      ctx,
      victim,
      { type: 'damage_reduce', rate: HUGE_MODIFIER_RATE, duration: 1, damageType: 'physical', charges: 1 },
      'command',
      'panzhen_shanshou',
      attacker.general.id
    );

    const hit = { damageSource: 'basic' as const, damageType: 'physical' as const };
    const caused = sumRates(attacker.statuses, 'damage_boost', 'caused');
    const taken = sumRates(victim.statuses, 'damage_boost', 'taken');
    const reduce = sumReduce(ctx, victim, hit, attacker);
    expect(caused).toBeCloseTo(2, 10);
    expect(reduce).toBeCloseTo(HUGE_MODIFIER_RATE, 10);
    expect(buffMult(1 + caused, 1 + taken, reduce)).toBeCloseTo(0.1, 10);
  });

  it('战报 detail 写「大幅降低」而不是账面数字；次数用完即移除', () => {
    const ctx = makeCtx();
    const victim = ctx.myTeam[0]!;
    const attacker = ctx.enemyTeam[0]!;
    inflictStatus(
      ctx,
      victim,
      { type: 'damage_reduce', rate: HUGE_MODIFIER_RATE, duration: 1, damageType: 'physical', charges: 1 },
      'command',
      'panzhen_shanshou',
      attacker.general.id
    );
    const inflicted = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted).toHaveLength(1);
    expect(inflicted[0]!.detail).toContain('大幅降低');
    expect(inflicted[0]!.detail).not.toContain('1000');

    // 匹配的伤害打出一次 → charges 1 → 0，状态移除
    applyDamage(ctx, victim, 500, attacker, 'physical', 'skill', undefined, { skillType: 'active' });
    expect(victim.statuses.some((s) => s.type === 'damage_reduce')).toBe(false);
  });
});
