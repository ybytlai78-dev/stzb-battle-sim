/**
 * 重复施加规则验收（用户口径）：
 *  - 同源重复施加数值型效果**默认刷新**（数值替换、remaining 取 max，不叠加）；
 *  - 只有带显式叠层标记（`stack` / `stacks` / `chargesStack`）的才累加；
 *  - 状态类（概率规避 evade_chance）同源重挂冲突被拒（status_conflict）；
 *  - 列营守险 连放两次：四维 X（刷新）不变 2X，第二次概率规避被拒且状态数不增加。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  effectiveMorale,
  inflictStatus,
  tickRoundStartStatuses,
  triggerActiveSkill,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import type { CreateStatus, Position, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function makeUnit(
  id: string,
  opts: { position?: Position; attack?: number; defense?: number; strategy?: number; speed?: number } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '蜀',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: opts.defense ?? 100,
      strategy: opts.strategy ?? 100,
      speed: opts.speed ?? 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(units: UnitState[] = []): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: units,
    enemyTeam: [makeUnit('e1')],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY) as [string, Skill][]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('列表：列营守险 连放两次（主动战法数值型效果刷新 + 概率规避冲突）', () => {
  it('四维增益为 X（刷新）而不是 2X；第二次概率规避被拒（status_conflict、状态数不增加）', () => {
    const caster = makeUnit('jiangwei');
    const allyA = makeUnit('a1', { position: '前锋' });
    const allyB = makeUnit('a2', { position: '中军' });
    const allyC = makeUnit('a3', { position: '大营' });
    const allies = [caster, allyA, allyB, allyC];
    const ctx = makeCtx(allies);
    ctx.myTeam = allies;

    // triggerRate 置 1 是为了确定性「连放两次」；效果定义原样取自 SKILL_REGISTRY
    const skill = { ...SKILL_REGISTRY['lieying_shouxian'], triggerRate: 1 } as Skill;
    const aimed = allies.filter((u) => u !== caster); // 非高昂分支：友军全体（不含自身）

    const cast = () => triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, allies, ctx.enemyTeam);
    cast();
    const afterFirst = aimed.map((u) => u.statuses.filter((s) => s.type === 'attack_buff')[0] as { amount: number });
    const X = afterFirst[0].amount;
    const evadeFirst = allies.reduce((n, u) => n + u.statuses.filter((s) => s.type === 'evade_chance').length, 0);
    // 引擎按目标池顺序逐个结算；施法者先吃到自身谋略增益后，后续友军的 29.2 段按
    // 生效谋略 132 缩放 → round(29.2 + 0.115×52) = 35（既有无序细节，与本规则无关）
    expect(X).toBe(35);
    expect(evadeFirst).toBeGreaterThan(0);

    cast();
    // 属性：每个友军仍只有 1 条 attack_buff，数值仍是 X（不是 2X）
    for (const u of aimed) {
      expect(u.statuses.filter((s) => s.type === 'attack_buff')).toHaveLength(1);
      expect((u.statuses.find((s) => s.type === 'attack_buff') as { amount: number }).amount).toBe(X);
    }
    // 概率规避：第二次拒绝 -> 状态数不增加、有 status_conflict
    const evadeSecond = allies.reduce((n, u) => n + u.statuses.filter((s) => s.type === 'evade_chance').length, 0);
    expect(evadeSecond).toBe(evadeFirst);
    const conflicts = ctx.events.filter(
      (e) => e.type === 'status_conflict' && 'statusType' in e && e.statusType === 'evade_chance'
    );
    expect(conflicts.length).toBe(evadeFirst);
    expect((conflicts[0] as { detail: string }).detail).toContain('先施加者生效');
  });
});

describe('列表：叠层类仍叠加（官方「可叠加」才累加）', () => {
  it('谋议宏图：准备不结算；第 1 回合开始 +8、第 2 回合起各再 +8 → 0 → 8 → 16', () => {
    const caster = makeUnit('simayan');
    caster.general.commandSkillIds = ['mouyi_hongtu'];
    const ctx = makeCtx([caster]);
    ctx.currentRound = 0;
    triggerCommandSkills(ctx, caster);
    const afterPrep = effectiveMorale(caster);

    ctx.currentRound = 1;
    tickRoundStartStatuses(ctx);
    const r1 = effectiveMorale(caster);

    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    const r2 = effectiveMorale(caster);

    // settleOnFirstRound（用户 2026-09-18 口径）：准备阶段不结算，第 1 回合才开始 +8
    expect([afterPrep, r1, r2]).toEqual([100, 108, 116]);
  });

  it('同仇敌忾：damage_boost 带 stacks 标记，3 次受击后 2% → 6%、层数 3（不刷新）', () => {
    const u = makeUnit('lusu');
    const ctx = makeCtx([u]);
    const status = (SKILL_REGISTRY['tongchou_dikai'].output[0] as { status: CreateStatus }).status;
    for (let i = 0; i < 3; i++) {
      inflictStatus(ctx, u, status, 'passive', 'tongchou_dikai');
    }
    const boost = u.statuses.find((s) => s.type === 'damage_boost') as { rate: number; stacks: number };
    expect(boost.rate).toBeCloseTo(0.06, 8);
    expect(boost.stacks).toBe(3);
  });

  it('带 stacks + maxStacks 的增减伤（银龙冲阵）：3 层封顶，第 4 次不再累加', () => {
    const u = makeUnit('zhaoyun');
    const ctx = makeCtx([u]);
    const layer: CreateStatus = { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'taken', stacks: 1, maxStacks: 3 };
    for (let i = 0; i < 4; i++) {
      inflictStatus(ctx, u, layer, 'active', 'yinlong_chongzhen');
    }
    const boost = u.statuses.find((s) => s.type === 'damage_boost') as { rate: number; stacks: number };
    expect(boost.rate).toBeCloseTo(0.6, 8);
    expect(boost.stacks).toBe(3);
  });
});
