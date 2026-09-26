/**
 * 百分比属性增减 + 正负分桶测试（v0.10）：
 *  - percent 属性增减按「目标当前生效属性（含点数增减后）」结算（魏武之世 -15% 受谋略）
 *  - 属性类状态一减一增（曹操魏武之世 vs 张辽其疾如风）互不冲突，各自共存
 *  - 同号属性类冲突仍取数值较高
 * 全部通过 inflictStatus / effectiveStat 单元测试，不依赖战法发动率 RNG。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, hasStatus, effectiveStat } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string, stats: Partial<Pick<UnitState['general'], 'attack' | 'defense' | 'strategy' | 'speed'>> = {}): UnitState {
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
      attack: 200,
      defense: 150,
      strategy: 100,
      speed: 100,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
      ...stats,
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
    rng: new Rng(1),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const debuff15: CreateStatus = { type: 'attack_buff', amount: -15, percent: true, duration: 999 };
const buff41: CreateStatus = { type: 'speed_buff', amount: 41, duration: 3 };
const debuffSpeed15: CreateStatus = { type: 'speed_buff', amount: -15, percent: true, duration: 999 };

describe('百分比属性增减（percent）', () => {
  it('百分比降低按目标当前生效属性结算（基础 200 → 降 30 点）', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, debuff15, 'command', 'weiwu_zhishi');
    expect(effectiveStat(u, 'attack')).toBe(170); // 200 × 15% = 30
  });

  it('百分比与点数增减叠加：先算点数（210）再按百分比降（-32 点）', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    // 点数 +10（如友军攻击增益）
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 10, duration: 3 }, 'command', 'some_buff');
    // 魏武之世 -15%（percent）
    inflictStatus(ctx, u, debuff15, 'command', 'weiwu_zhishi');
    // 生效 = 200+10=210；210×15% = 31.5 → 32 点降低 → 178
    expect(effectiveStat(u, 'attack')).toBe(178);
  });

  it('百分比 buff 事件带 % 标识', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, debuff15, 'command', 'weiwu_zhishi');
    const ev = ctx.events.find((e) => e.type === 'status_inflicted' && e.statusType === 'attack_buff');
    expect(ev && 'detail' in ev ? ev.detail : '').toBe('【a】的攻击属性降低了15%(30)(170)');
  });
});

describe('属性类正负分桶（一减一增互不冲突）', () => {
  it('其疾如风速度+41 与 魏武之世速度-15% 同类型不同战法：各自共存', () => {
    const ctx = makeCtx();
    const u = makeUnit('a', { speed: 100 });
    // 张辽其疾如风：speed_buff +41（点数，受谋略）
    inflictStatus(ctx, u, buff41, 'command', 'qiji_rufeng');
    // 曹操魏武之世：speed_buff -15%（百分比）
    inflictStatus(ctx, u, debuffSpeed15, 'command', 'weiwu_zhishi');
    // 两状态共存（无冲突拒绝）
    const speedStatuses = u.statuses.filter((s) => s.type === 'speed_buff');
    expect(speedStatuses.length).toBe(2);
    const conflicts = ctx.events.filter((e) => e.type === 'status_conflict' && 'statusType' in e && e.statusType === 'speed_buff');
    expect(conflicts.length).toBe(0);
    // 生效速度 = (100+41) × (1-0.15) = 141 × 0.85 = 119.85 → 120（round 绝对值）
    expect(effectiveStat(u, 'speed')).toBe(120);
  });

  it('同号属性类冲突：数值取较高（+41 vs +30 → 41）', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, buff41, 'command', 'qiji_rufeng');
    inflictStatus(ctx, u, { type: 'speed_buff', amount: 30, duration: 3 }, 'command', 'other_speed');
    const speedStatuses = u.statuses.filter((s) => s.type === 'speed_buff');
    expect(speedStatuses.length).toBe(1);
    expect(speedStatuses[0].amount).toBe(41);
  });

  it('增益与减益即使同为点数也互不冲突（+30 与 -30）', () => {
    const ctx = makeCtx();
    const u = makeUnit('a');
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 30, duration: 3 }, 'active', 'buff_skill');
    inflictStatus(ctx, u, { type: 'attack_buff', amount: -30, duration: 2 }, 'active', 'debuff_skill');
    expect(u.statuses.filter((s) => s.type === 'attack_buff').length).toBe(2);
    expect(effectiveStat(u, 'attack')).toBe(200); // +30 与 -30 各自生效
  });
});
