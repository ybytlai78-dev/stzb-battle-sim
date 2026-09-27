/**
 * 典籍战法批次 3（4 张）：绝水遏敌（A 准备主动 200826）/ 极火佐攻（A 准备主动 200817）/
 * 磐阵善守（A 指挥 200816）/ 形兵之极（B 指挥 200813）。
 * 下架：绝水遏敌（策略 230% 受谋略）、极火佐攻（燃烧 200% / 受伤 +26% 受谋略）——官方未给系数。
 */
import { describe, it, expect } from 'vitest';
import {
  applyDamage,
  tickRoundStartStatuses,
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

/** 直接释放（跳过准备、发动率固定 1） */
function castActive(ctx: CombatContext, unit: UnitState, skillId: string): void {
  const base = asActive(skillId);
  const copy = { ...base, prepare: false, triggerRate: 1 } as Extract<Skill, { type: 'active' }>;
  ctx.skills.set(skillId, copy);
  triggerActiveSkill(ctx, unit, copy, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);
}

const dmg = (ctx: CombatContext, id: string) => ctx.events.filter((e) => e.type === 'damage' && e.skillId === id);

// ── 绝水遏敌 ──────────────────────────────────────────────────────

describe('绝水遏敌（A 准备主动·距离 4·50%·敌军群体 2-3：策略 230% + 围困 1 回合）', () => {
  it('装配：1 回合准备 / groupCount [2,3] / 策略 230%（受谋略无系数）+ 围困 1 回合', () => {
    const s = asActive('jueshui_edi');
    expect(s.prepare).toBe(true);
    expect(s.triggerRate).toBe(0.5);
    expect(s.range).toBe(4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toEqual([2, 3]);
    expect(s.output[0]).toMatchObject({ kind: 'strategy_damage', rate: 230, strategyScaled: true });
    expect(s.output[1]).toMatchObject({ kind: 'inflict_status', status: { type: 'siege', duration: 1 } });
  });

  it('下架：策略 230% 受谋略成长未确认', () => {
    expect(isLearnableSkillListed('jueshui_edi')).toBe(false);
  });

  it('释放：命中 2~3 个敌军，各挂围困（无法恢复兵力）1 回合', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['jueshui_edi'] });
    const ctx = makeCtx(
      [makeUnit(me)],
      [makeUnit(dummy('e1', '前锋'), 'enemy'), makeUnit(dummy('e2', '中军'), 'enemy'), makeUnit(dummy('e3', '大营'), 'enemy')]
    );
    castActive(ctx, ctx.myTeam[0], 'jueshui_edi');
    const hits = dmg(ctx, 'jueshui_edi');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(3);
    const sieged = ctx.enemyTeam.filter((u) => u.statuses.some((s) => s.type === 'siege'));
    expect(sieged.length).toBe(hits.length);
  });
});

// ── 极火佐攻 ──────────────────────────────────────────────────────

describe('极火佐攻（A 准备主动·距离 4·50%·敌军群体 2：燃烧 200% + 下次主动战法受伤 +26%）', () => {
  it('装配：1 回合准备 / groupCount 2 / 燃烧 growthRate 0 + taken 增伤 charges 1（仅主动战法）', () => {
    const s = asActive('jihuo_zuogong');
    expect(s.prepare).toBe(true);
    expect(s.groupCount).toBe(2);
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'burning', duration: 1, rate: 200, growthRate: 0 },
    });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      status: {
        type: 'damage_boost',
        rate: 0.26,
        duration: 999,
        direction: 'taken',
        skillTypes: ['active'],
        charges: 1,
        strategyScaled: true,
      },
    });
  });

  it('下架：两段受谋略成长未确认', () => {
    expect(isLearnableSkillListed('jihuo_zuogong')).toBe(false);
  });

  it('释放：目标陷入燃烧 + 带「下 1 次主动战法受伤 +26%」标记', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['jihuo_zuogong'] });
    const ctx = makeCtx([makeUnit(me)], [makeUnit(dummy('e1', '前锋'), 'enemy')]);
    castActive(ctx, ctx.myTeam[0], 'jihuo_zuogong');
    const foe = ctx.enemyTeam[0];
    expect(foe.statuses.some((s) => s.type === 'burning')).toBe(true);
    const mark = foe.statuses.find(
      (s): s is Extract<Status, { type: 'damage_boost' }> =>
        s.type === 'damage_boost' && s.direction === 'taken'
    );
    expect(mark?.rate).toBeCloseTo(0.26, 5);
    expect(mark?.charges).toBe(1);
  });

  it('标记只吃主动战法伤害：主动战法伤害计入并消耗；普攻不吃也不消耗', () => {
    const me = dummy('me', '前锋', { activeSkillIds: ['jihuo_zuogong', 'tujin'], attack: 150 });
    const ctx = makeCtx([makeUnit(me)], [makeUnit(dummy('e1', '前锋'), 'enemy')]);
    castActive(ctx, ctx.myTeam[0], 'jihuo_zuogong');
    const foe = ctx.enemyTeam[0];
    const markOf = () =>
      foe.statuses.find(
        (s): s is Extract<Status, { type: 'damage_boost' }> =>
          s.type === 'damage_boost' && s.direction === 'taken'
      );

    // ① 普攻（damageSource basic、无 skillType）不吃也不消耗
    applyDamage(ctx, foe, 500, ctx.myTeam[0], 'physical', 'basic');
    expect(markOf()?.charges).toBe(1);

    // ② 主动战法伤害（skillType active）→ 计入（伤害事件 modifiers.taken 含该来源）并消耗
    ctx.events.length = 0;
    castActive(ctx, ctx.myTeam[0], 'tujin');
    const hit = dmg(ctx, 'tujin')[0] as Extract<BattleEvent, { type: 'damage' }>;
    expect((hit.modifiers?.taken ?? []).some((m) => m.skillId === 'jihuo_zuogong')).toBe(true);
    expect(foe.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
  });
});

// ── 磐阵善守 ──────────────────────────────────────────────────────

describe('磐阵善守（A 指挥·一类·距离 2·我军单体：前 4 回合每回合最低兵力首击减伤 + 随机单体 1 层规避）', () => {
  it('装配：roundStartRepeat 1~4 回合；两条 charges 减伤轨 + 一层规避', () => {
    const s = SKILL_REGISTRY['panzhen_shanshou'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.output).toHaveLength(0);
    const rs = s.roundStartRepeat;
    expect(rs).toMatchObject({ startRound: 1, endRound: 4 });
    expect(rs?.output[0]).toMatchObject({
      kind: 'inflict_status',
      targetPick: 'lowest_troops_ally',
      status: { type: 'damage_reduce', rate: 0.9, duration: 1, damageType: 'physical', charges: 1 },
    });
    expect(rs?.output[1]).toMatchObject({
      kind: 'inflict_status',
      targetPick: 'lowest_troops_ally',
      status: { type: 'damage_reduce', rate: 0.9, duration: 1, damageType: 'strategy', charges: 1 },
    });
    expect(rs?.output[2]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      targetMode: 'random_single',
      status: { type: 'evasion', stacks: 1 },
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('panzhen_shanshou')).toBe(true);
  });

  it('结算：兵力最低者拿两条「首次攻击 / 首次策略」减伤（各 1 次），随机友军拿 1 层规避', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['panzhen_shanshou'] });
    const front = dummy('front', '前锋');
    const mid = dummy('mid', '中军');
    const ctx = makeCtx(
      [makeUnit(front), makeUnit(mid), makeUnit(carrier)],
      [makeUnit(dummy('e', '前锋'), 'enemy')]
    );
    ctx.myTeam[1].troops -= 5000; // mid 兵力最低
    triggerCommandSkills(ctx, ctx.myTeam[2]);
    ctx.events.length = 0;
    // 一类指挥 roundStartRepeat 在回合开始统一结算（tickRoundStartStatuses）
    tickRoundStartStatuses(ctx);

    const reds = ctx.myTeam[1].statuses.filter(
      (s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce'
    );
    expect(reds.length).toBe(2);
    expect(reds.map((s) => s.damageType).sort()).toEqual(['physical', 'strategy']);
    expect(reds.every((s) => s.charges === 1)).toBe(true);
    expect(reds.every((s) => s.rate === 0.9)).toBe(true);
    const evasions = ctx.myTeam.filter((u) => u.statuses.some((s) => s.type === 'evasion'));
    expect(evasions.length).toBe(1);
  });

  it('第 5 回合起不再挂盘阵善守（窗口 1~4 回合）', () => {
    const carrier = dummy('carrier', '大营', { commandSkillIds: ['panzhen_shanshou'] });
    const ctx = makeCtx(
      [makeUnit(dummy('front', '前锋')), makeUnit(dummy('mid', '中军')), makeUnit(carrier)],
      [makeUnit(dummy('e', '前锋'), 'enemy')]
    );
    triggerCommandSkills(ctx, ctx.myTeam[2]);
    ctx.events.length = 0;
    ctx.currentRound = 5;
    tickRoundStartStatuses(ctx);
    expect(ctx.myTeam.every((u) => !u.statuses.some((s) => s.type === 'damage_reduce' || s.type === 'evasion'))).toBe(true);
  });
});

// ── 形兵之极 ──────────────────────────────────────────────────────

/** 三将兵系：骑 / 步 / 弓（两两不同）——形兵之极门闩 */
function distinctTroopTeam(): General[] {
  const carrier = dummy('carrier', '大营', { commandSkillIds: ['xingbing_zhiji'], troopType: 'archer' });
  return [
    dummy('front', '前锋', { troopType: 'cavalry' }),
    dummy('mid', '中军', { troopType: 'infantry' }),
    carrier,
  ];
}

describe('形兵之极（B 指挥·一类·距离 2·我军全体：3 将兵系均不相同时生效）', () => {
  it('装配：teamTroopDistinct 门闩 + 大营发动率 +10%（主战法）/ 前锋前 4 回合减伤 50% / 中军每回合首次增伤 40%', () => {
    const s = SKILL_REGISTRY['xingbing_zhiji'];
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect(s.teamTroopDistinct).toBe(true);
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      positions: ['大营'],
      status: { type: 'trigger_boost', rate: 0.1, duration: 999, skillTypes: ['active', 'pursuit'], mainSkillOnly: true },
    });
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      positions: ['前锋'],
      status: { type: 'damage_reduce', rate: 0.5, duration: 4 },
    });
    expect(s.roundStartRepeat?.output[0]).toMatchObject({
      kind: 'inflict_status',
      positions: ['中军'],
      status: { type: 'damage_boost', rate: 0.4, duration: 1, direction: 'caused', charges: 1 },
    });
  });

  it('上架：全文无受属性段', () => {
    expect(isLearnableSkillListed('xingbing_zhiji')).toBe(true);
  });

  it('兵系两两不同：准备阶段挂「大营发动率 / 前锋减伤」，回合开始再给中军挂首次增伤', () => {
    const ctx = makeCtx(distinctTroopTeam().map((g) => makeUnit(g)), [makeUnit(dummy('e', '前锋'), 'enemy')]);
    triggerCommandSkills(ctx, ctx.myTeam[2]);
    const [front, mid, back] = ctx.myTeam;
    expect(front.statuses.some((s) => s.type === 'damage_reduce')).toBe(true);
    expect(back.statuses.some((s) => s.type === 'trigger_boost')).toBe(true);
    expect(mid.statuses.some((s) => s.type === 'damage_boost')).toBe(false);

    tickRoundStartStatuses(ctx);
    const boost = mid.statuses.find(
      (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost'
    );
    expect(boost?.rate).toBeCloseTo(0.4, 5);
    expect(boost?.charges).toBe(1);
  });

  it('兵系不满足（两名步兵）：整次不生效，谁也不挂状态', () => {
    const team = distinctTroopTeam();
    team[0] = dummy('front', '前锋', { troopType: 'infantry' }); // 与中军同为步兵
    const ctx = makeCtx(team.map((g) => makeUnit(g)), [makeUnit(dummy('e', '前锋'), 'enemy')]);
    triggerCommandSkills(ctx, ctx.myTeam[2]);
    tickRoundStartStatuses(ctx);
    expect(
      ctx.myTeam.every(
        (u) => !u.statuses.some((s) => s.type === 'trigger_boost' || s.type === 'damage_reduce' || s.type === 'damage_boost')
      )
    ).toBe(true);
  });
});
