/**
 * 典籍战法批次 1（`dateyuan/通用战法待添加名单.md` §三，5 张）：
 *   合众（B 被动 200822）/ 疾战（B 主动 200819）/ 并进（B 主动 200827）/
 *   励军（B 主动 200821）/ 反间（A 指挥 200818）
 * 五张全文无「受 XX 属性影响」→ 均上架（不进 OFFLINE_LEARNABLE_SKILLS）。
 */
import { describe, it, expect } from 'vitest';
import {
  applyDamage,
  triggerActiveSkill,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, DamageModifiers, General, Position, Skill, Status, UnitState } from '../src/engine/types';
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

/** 直接释放（发动率固定 1、去掉准备） */
function castActive(ctx: CombatContext, unit: UnitState, skillId: string): void {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

function magnitude(rate: number): DamageModifiers {
  return {
    caused: [{ unitId: 'x', skillId: 'probe', skillName: '试探增伤', rate, direction: 'caused' }],
    taken: [],
    reduce: [],
  };
}

/** 事件所属回合：按 round_end 事件回溯（heal / skill_trigger 本身不带回合号）；首回合事件标 1 */
function roundOfEvents(report: { events: BattleEvent[] }): number[] {
  let round = 1;
  return report.events.map((e) => {
    if (e.type === 'round_end') round = e.round + 1;
    return round;
  });
}

// ── 合众 ──────────────────────────────────────────────────────────

describe('合众（B 被动·距离 1·优先行动 + 每 2 回合恢复 260%）', () => {
  it('装配：被动战斗开始 / priorityRounds 999 / 第 2·4·6·8 回合恢复 260%（不缩放）', () => {
    const s = SKILL_REGISTRY['hezhong'];
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.priorityRounds).toBe(999);
    expect(s.output).toHaveLength(0);
    expect(s.roundStartRepeat?.rounds).toEqual([2, 4, 6, 8]);
    expect(s.roundStartRepeat?.output[0]).toMatchObject({
      kind: 'heal',
      rate: 260,
      strategyScaled: false,
      growthRate: 0,
      target: 'self',
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('hezhong')).toBe(true);
  });

  it('整场跑通：恢复只发生在偶数回合（2/4/6/8）', () => {
    const carrier: General = {
      ...dummy('carrier', '大营', { passiveSkillIds: ['hezhong'], maxTroops: 12000 }),
    };
    const report = runBattle({
      seed: 5,
      maxRounds: 8,
      myTeam: [carrier, dummy('a-mid', '中军'), dummy('a-front', '前锋')],
      enemyTeam: [
        dummy('e1', '大营', { attack: 200 }),
        dummy('e2', '中军', { attack: 200 }),
        dummy('e3', '前锋', { attack: 200 }),
      ],
    });
    const rounds = roundOfEvents(report);
    const healRounds = report.events
      .map((e, i) => ({ e, round: rounds[i] }))
      .filter(({ e }) => e.type === 'heal' && e.skillId === 'hezhong')
      .map(({ round }) => round);
    expect(healRounds.length).toBeGreaterThan(0);
    for (const r of healRounds) expect([2, 4, 6, 8]).toContain(r);
  });
});

// ── 疾战 ──────────────────────────────────────────────────────────

describe('疾战（B 主动·距离 1·自己·30%~40%）', () => {
  it('装配：区间发动率 [0.3, 0.4]、连击 + 免疫怯战（本回合）', () => {
    const s = asActive('jizhan');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(1);
    expect(s.triggerRate).toEqual([0.3, 0.4]);
    expect(s.targetMode).toBe('self');
    expect([...s.tags].sort()).toEqual(['combo', 'cowardice_immune']);
    expect(s.output[0]).toMatchObject({ kind: 'inflict_status', target: 'self', status: { type: 'combo', duration: 1 } });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'cowardice_immune', duration: 1 },
    });
  });

  it('上架', () => {
    expect(isLearnableSkillListed('jizhan')).toBe(true);
  });

  it('释放：自身获得连击 + 免疫怯战（各 1 回合）', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['jizhan'] });
    const ctx = makeCtx([makeUnit(me)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    castActive(ctx, ctx.myTeam[0], 'jizhan');
    const types = ctx.myTeam[0].statuses.map((s) => s.type).sort();
    expect(types).toEqual(['combo', 'cowardice_immune']);
    for (const s of ctx.myTeam[0].statuses) {
      if ('remaining' in s) expect(s.remaining).toBe(1);
    }
  });
});

// ── 并进 ──────────────────────────────────────────────────────────

describe('并进（B 主动·距离 1·自己·40%）', () => {
  it('装配：分兵 100% + 免疫怯战；1 回合', () => {
    const s = asActive('bingjin');
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(1);
    expect([...s.tags].sort()).toEqual(['cowardice_immune', 'split']);
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'cowardice_immune', duration: 1 },
    });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: { type: 'split', rate: 100, duration: 1 },
    });
  });

  it('上架', () => {
    expect(isLearnableSkillListed('bingjin')).toBe(true);
  });

  it('释放：自身进入分兵（100%）且免疫怯战', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['bingjin'] });
    const ctx = makeCtx([makeUnit(me)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    castActive(ctx, ctx.myTeam[0], 'bingjin');
    const split = ctx.myTeam[0].statuses.find(
      (s): s is Extract<Status, { type: 'split' }> => s.type === 'split'
    );
    expect(split?.rate).toBe(100);
    expect(ctx.myTeam[0].statuses.some((s) => s.type === 'cowardice_immune')).toBe(true);
  });
});

// ── 励军 ──────────────────────────────────────────────────────────

describe('励军（B 主动·距离 3·敌军单体·35%）', () => {
  it('装配：攻击 180% + 自身主动战法下一次伤害 +35%（一次性 charges 1）', () => {
    const s = asActive('lijun');
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(3);
    // 敌军单体 = 距离内均匀随机（仓库口径：不用 `single`）
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 180 });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      status: {
        type: 'damage_boost',
        rate: 0.35,
        direction: 'caused',
        skillTypes: ['active'],
        charges: 1,
      },
    });
  });

  it('上架', () => {
    expect(isLearnableSkillListed('lijun')).toBe(true);
  });

  it('释放：打出伤害并把 +35% 挂到自身；下一次主动战法伤害打出即消耗', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['lijun'] });
    const ctx = makeCtx([makeUnit(me)], [makeUnit(dummy('e', '前锋'), 'enemy')]);
    castActive(ctx, ctx.myTeam[0], 'lijun');
    expect(ctx.events.some((e) => e.type === 'damage' && e.skillId === 'lijun')).toBe(true);
    const buff = ctx.myTeam[0].statuses.find(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
    );
    expect(buff?.rate).toBeCloseTo(0.35, 5);
    expect(buff?.charges).toBe(1);

    // 再释放一次励军（主动战法伤害）→ 旧的一次性效果被消耗，刷新为新的 1 次
    castActive(ctx, ctx.myTeam[0], 'lijun');
    const after = ctx.myTeam[0].statuses.filter((s) => s.type === 'damage_boost');
    expect(after.length).toBe(1);
    expect(after[0].charges).toBe(1);
  });
});

// ── 反间 ──────────────────────────────────────────────────────────

describe('反间（A 指挥·一类·距离 4·敌军群体 2 目标）', () => {
  it('装配：两条独立轨（攻击 / 策略各 −8%、上限 5 层、70% 判定、持续到战斗结束）', () => {
    const s = SKILL_REGISTRY['fanjian'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    expect(s.output).toHaveLength(0);
    const rawStacks = s.allyDealStack;
    expect(Array.isArray(rawStacks)).toBe(true);
    const list = Array.isArray(rawStacks) ? rawStacks : rawStacks ? [rawStacks] : [];
    expect(list.map((c) => c.damageType)).toEqual(['physical', 'strategy']);
    for (const cfg of list) {
      expect(cfg.rate).toBe(0.7);
      expect(cfg.status).toMatchObject({
        type: 'damage_boost',
        rate: -0.08,
        duration: 999,
        direction: 'caused',
        stack: true,
        maxStacks: 5,
      });
    }
  });

  it('上架', () => {
    expect(isLearnableSkillListed('fanjian')).toBe(true);
  });

  it('准备阶段：锁定敌军 2 目标并各挂「攻击 / 策略」两条降伤轨', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['fanjian'] });
    const ctx = makeCtx(
      [makeUnit(carrier)],
      [makeUnit(dummy('e1', '前锋'), 'enemy'), makeUnit(dummy('e2', '大营'), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[0]);
    expect(ctx.lockedCommands[0].targets.length).toBe(2);
    for (const t of ctx.lockedCommands[0].targets) {
      const tracks = t.statuses.filter(
        (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
      );
      expect(tracks.length).toBe(2);
      expect(tracks.map((s) => s.damageType).sort()).toEqual(['physical', 'strategy']);
    }
  });

  it('敌军造成物理伤害 → 70% 判定；命中则物理轨 +1 层（另一轨不动）', () => {
    let hit: { ctx: CombatContext; foe: UnitState } | undefined;
    for (let seed = 1; seed <= 40 && !hit; seed += 1) {
      const carrier = dummy('carrier', '大营', { commandSkillIds: ['fanjian'] });
      const ctx = makeCtx(
        [makeUnit(carrier), makeUnit(dummy('ally', '前锋'))],
        [makeUnit(dummy('e1', '前锋'), 'enemy'), makeUnit(dummy('e2', '大营'), 'enemy')],
        seed
      );
      triggerCommandSkills(ctx, ctx.myTeam[0]);
      const foe = ctx.lockedCommands[0].targets[0];
      ctx.events.length = 0;
      applyDamage(ctx, ctx.myTeam[1], 800, foe, 'physical', 'skill', magnitude(0.1));
      const trig = ctx.events.filter(
        (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
          e.type === 'skill_trigger' && e.skillId === 'fanjian'
      );
      expect(trig.length).toBe(1);
      expect(trig[0].baseRate).toBe(70);
      if (trig[0].success) hit = { ctx, foe };
    }
    expect(hit).toBeTruthy();
    const tracks = hit!.foe.statuses.filter(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
    );
    const phys = tracks.find((s) => s.damageType === 'physical')!;
    const strat = tracks.find((s) => s.damageType === 'strategy')!;
    expect(phys.stacks).toBe(2);
    expect(phys.rate).toBeCloseTo(-0.16, 5);
    expect(strat.stacks).toBe(1); // 另一轨不动
    expect(strat.rate).toBeCloseTo(-0.08, 5);
  });

  it('封顶 5 层：物理轨连续触发 6 次只到 5 层', () => {
    let target: { ctx: CombatContext; foe: UnitState } | undefined;
    for (let seed = 1; seed <= 60 && !target; seed += 1) {
      const carrier = dummy('carrier', '大营', { commandSkillIds: ['fanjian'] });
      const ctx = makeCtx(
        [makeUnit(carrier), makeUnit(dummy('ally', '前锋'))],
        [makeUnit(dummy('e1', '前锋'), 'enemy')],
        seed
      );
      triggerCommandSkills(ctx, ctx.myTeam[0]);
      const foe = ctx.lockedCommands[0].targets[0];
      for (let i = 0; i < 8; i += 1) {
        applyDamage(ctx, ctx.myTeam[1], 500, foe, 'physical', 'skill', magnitude(0.1));
        ctx.myTeam[1].troops = ctx.myTeam[1].general.maxTroops;
      }
      const phys = foe.statuses.find(
        (s): s is Extract<Status, { type: 'damage_boost' }> =>
          s.type === 'damage_boost' && s.damageType === 'physical'
      );
      // 至少有一次判定命中 → 层数落在 2~5 之间且不超过上限
      if ((phys?.stacks ?? 1) > 1) target = { ctx, foe };
    }
    expect(target).toBeTruthy();
    const phys = target!.foe.statuses.find(
      (s): s is Extract<Status, { type: 'damage_boost' }> =>
        s.type === 'damage_boost' && s.damageType === 'physical'
    )!;
    expect(phys.stacks).toBeGreaterThan(1);
    expect(phys.stacks).toBeLessThanOrEqual(5);
    expect(phys.rate).toBeCloseTo(-0.08 * phys.stacks!, 5);
  });
});
