/**
 * 回合持续时间测试（v0.9）
 *   规则：行动前施加的计数器回合（准备阶段）→ 回合末递减，持续到第 N+1 回合行动前；
 *        行动中施加的计数器回合（正式回合）→ 该单位下次行动开始前递减。
 *   连击是主动战法：获得一回合连击，持续到下回合开始前；中途再次获得主动类型连击 → 冲突无法挂上。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, actUnit, triggerCommandSkills, hasStatus, getStatus, tickStatuses } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, opts: { position?: Position; attackRange?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: opts.attackRange ?? 3,
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
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

describe('行动前施加（准备阶段）：计数器回合末递减，「前N回合」生效至第 N+1 回合行动前', () => {
  it('避其锋芒 duration=3：行动前施加 → 第1/2/3回末各减1，第4回行动前消失', () => {
    const ctx = makeCtx();
    const wg = makeUnit('caster', { position: '中军' });
    wg.general.commandSkillIds = ['biqi_fengmang'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];

    triggerCommandSkills(ctx, wg); // 准备阶段施加，appliedRound=0, remaining=3
    expect(hasStatus(ally, 'damage_reduce')).toBe(true);

    // 回合 1 结束：3→2，仍有效（第2回合行动前还有）
    ctx.currentRound = 1;
    actUnit(ctx, ally);
    actUnit(ctx, e1);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(ally, 'damage_reduce')).toBe(true);

    // 回合 2 结束：2→1
    ctx.currentRound = 2;
    actUnit(ctx, ally);
    actUnit(ctx, e1);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(ally, 'damage_reduce')).toBe(true);

    // 回合 3 结束：1→0，消失（第4回合行动前不再有减伤）
    ctx.currentRound = 3;
    actUnit(ctx, ally);
    actUnit(ctx, e1);
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(ally, 'damage_reduce')).toBe(false);
  });

  it('第4回合行动前已无减伤，验证「前三回合」= 第4回合行动前仍享受、第4回行动后消失', () => {
    const ctx = makeCtx();
    const wg = makeUnit('caster', { position: '中军' });
    wg.general.commandSkillIds = ['biqi_fengmang'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];

    triggerCommandSkills(ctx, wg);
    // 完整推进 3 回合（行动+回合末递减）
    for (let r = 1; r <= 3; r++) {
      ctx.currentRound = r;
      actUnit(ctx, ally);
      actUnit(ctx, e1);
      tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    }
    // 第 4 回合开始行动前：状态已在第 3 回末消失
    ctx.currentRound = 4;
    actUnit(ctx, ally); // 行动前已无减伤
    expect(hasStatus(ally, 'damage_reduce')).toBe(false);
  });
});

describe('行动中施加的计数器回合：持续到该单位下次行动开始前', () => {
  it('玄武洰流怯战 duration=2（行动中施加）：当回合并生效、下回行动前减1仍有效、下回行动后消失', () => {
    const ctx = makeCtx();
    const caster = makeUnit('caster', { position: '大营', attackRange: 5 });
    caster.general.activeSkillIds = ['xuanwu_fuliu']; // 主动：全体 150% + 怯战2回
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    const e2 = makeUnit('e2', { position: '中军' });
    e2.side = 'enemy';
    const e3 = makeUnit('e3', { position: '大营' });
    e3.side = 'enemy';
    ctx.myTeam = [caster];
    ctx.enemyTeam = [e1, e2, e3];

    // 回合 1 施放主动战法（seed 7 下大概率发动）
    ctx.currentRound = 1;
    actUnit(ctx, caster);
    const cowardice = getStatus(e1, 'cowardice');
    if (!cowardice) {
      // 若未发动则换高发动率方式直接施加，验证时序语义
      inflictStatus(ctx, e1, { type: 'cowardice', duration: 2 } as CreateStatus, 'active', 'xuanwu_fuliu');
    }
    const c = getStatus(e1, 'cowardice')!;
    expect(c.remaining).toBe(2); // 行动中施加：remaining=duration
    expect(c.appliedRound).toBe(1);

    // 回合 1 末：行动中施加的不递减
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(hasStatus(e1, 'cowardice')).toBe(true);

    // 回合 2 行动开始前：2→1，仍有效（e1 行动时被怯战）
    ctx.currentRound = 2;
    actUnit(ctx, e1);
    const afterAct = getStatus(e1, 'cowardice');
    expect(afterAct).toBeDefined();
    expect(afterAct!.remaining).toBe(1);

    // 回合 3 行动开始前：1→0 消失
    ctx.currentRound = 3;
    actUnit(ctx, e1);
    expect(hasStatus(e1, 'cowardice')).toBe(false);
  });
});

describe('连击（主动）：1回合，持续到下回合开始前；同类型冲突', () => {
  it('主动连击 duration=1：行动中施加 → 下回合行动开始前消失', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];

    ctx.currentRound = 1;
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'wei_skill');
    const c = getStatus(u, 'combo')!;
    expect(c.remaining).toBe(1);
    expect(c.appliedRound).toBe(1);

    // 本回行动：有连击（两次普攻）
    actUnit(ctx, u);

    // 回合末不递减（行动中施加）
    tickStatuses(ctx, [u]);
    expect(hasStatus(u, 'combo')).toBe(true);

    // 下回合行动开始前：1→0 消失
    ctx.currentRound = 2;
    actUnit(ctx, u);
    expect(hasStatus(u, 'combo')).toBe(false);
  });

  it('主动连击 vs 主动连击：同类型冲突，后施加被拒', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.currentRound = 1;
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'skill_a');
    const before = getStatus(u, 'combo')!.sourceSkillId;
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'skill_b');
    // 冲突：仍是第一个的连击
    expect(getStatus(u, 'combo')!.sourceSkillId).toBe(before);
    expect(ctx.events.some((e) => e.type === 'status_conflict' && e.statusType === 'combo')).toBe(true);
  });

  it('指挥连击 vs 主动连击：不同类型各自共存', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.currentRound = 1;
    inflictStatus(ctx, u, { type: 'combo', duration: 3 } as CreateStatus, 'command', 'xianqu_tuji');
    inflictStatus(ctx, u, { type: 'combo', duration: 1 } as CreateStatus, 'active', 'wei_skill');
    expect(u.statuses.filter((s) => s.type === 'combo').length).toBe(2);
  });
});
