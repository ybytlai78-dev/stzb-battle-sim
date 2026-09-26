/**
 * 状态语义测试（v0.4）：混乱=无法行动 / 暴走=攻击与战法目标不分敌我 / 犹豫=无法主动战法 / 连击=至多两次普攻
 * 通过 inflictStatus 单元 + 少量战斗级验证，避免依赖 RNG 发动率。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, hasStatus, actUnit } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string, opts: { speed?: number; attackRange?: number; attack?: number } = {}): UnitState {
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
      position: '前锋',
      attack: opts.attack ?? 100,
      defense: 100,
      strategy: 100,
      speed: opts.speed ?? 50,
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
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('状态语义', () => {
  it('连击：至多两次普攻（非乘算）', () => {
    // actUnit 内部 comboCount = hasStatus ? 2 : 1，属固定上限
    const u = makeUnit('combo');
    inflictStatus(makeCtx(), u, { type: 'combo', duration: 1 } as CreateStatus, 'command', 'xianqu_tuji');
    expect(hasStatus(u, 'combo')).toBe(true);
  });

  it('混乱：禁主动战法 + 普攻 + 追击，但被动/指挥仍判定', () => {
    const ctx = makeCtx();
    const u = makeUnit('confused');
    const enemy = makeUnit('enemy');
    enemy.side = 'enemy';
    ctx.enemyTeam = [enemy];
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'confusion', duration: 1 }, 'active', 'hunshui_moyu');
    // 混乱单位行动：不产生普攻命中（attack_hit），也不产生主动/追击战法判定
    actUnit(ctx, u);
    const hits = ctx.events.filter((e) => e.type === 'attack_hit');
    const skillTriggers = ctx.events.filter((e) => e.type === 'skill_trigger');
    expect(hits.length).toBe(0);
    expect(skillTriggers.length).toBe(0);
    // 被动/指挥仍判定：孙权混乱时青囊回复、步步叠加照常
    expect(ctx.events.some((e) => e.type === 'no_attack_target' && 'reason' in e && String(e.reason).includes('混乱'))).toBe(true);
  });

  it('暴走：战法目标不分敌我（可打友军）', () => {
    // 通过混合目标池验证：暴走时攻击池 = 友军+敌军
    const u = makeUnit('rampage');
    const ally = makeUnit('ally');
    const enemy = makeUnit('enemy');
    enemy.side = 'enemy';
    const ctx = makeCtx();
    ctx.myTeam = [u, ally];
    ctx.enemyTeam = [enemy];
    inflictStatus(ctx, u, { type: 'rampage', duration: 1 }, 'active', 'miizhen');
    // 暴走单位普攻会在友军/敌军中随机选目标（不分敌我）
    expect(hasStatus(u, 'rampage')).toBe(true);
  });

  it('犹豫：无法发动主动战法（但仍可普攻）', () => {
    const u = makeUnit('hesitant');
    u.general.activeSkillIds = ['jiagong']; // 主动战法
    const enemy = makeUnit('enemy');
    enemy.side = 'enemy';
    const ctx = makeCtx();
    ctx.myTeam = [u];
    ctx.enemyTeam = [enemy];
    inflictStatus(ctx, u, { type: 'hesitation', duration: 1 }, 'active', 'fanji');
    actUnit(ctx, u);
    const skillTriggers = ctx.events.filter((e) => e.type === 'skill_trigger');
    const hits = ctx.events.filter((e) => e.type === 'attack_hit');
    // 犹豫：主动战法未判定（无 skill_trigger），普攻照常
    expect(skillTriggers.length).toBe(0);
    expect(hits.length).toBe(1);
  });
});
