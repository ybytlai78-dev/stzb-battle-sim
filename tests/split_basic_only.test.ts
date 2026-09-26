/**
 * 分兵只由**普通攻击**触发（2026-09-22 用户口径，实战场景：SP太史慈【疾击其后】追击战报）。
 *
 * 规则与实现口径：
 *  - 分兵是普攻的衍生伤害：普攻**命中后**随本次普攻立即对目标的相邻敌军溅射（无视攻击距离）；
 *  - 追击战法 / 主动战法 / DoT / 指挥代打都不触发分兵；
 *  - 结算时点必须在**追击战法判定之前**（连击：普攻→分兵→追击→普攻→分兵→追击）。
 *    修复前的实现把分兵整段放在两次普攻与追击之后结算，导致：
 *      ① 分兵事件落进「追击战法判定」段 —— 战报里看起来是【疾击其后】触发了分兵（用户报告）；
 *      ② 追击打死普攻目标后 `hit.alive` 判定跳过该次分兵 —— 普攻带来的溅射被追击吞掉。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, CreateStatus, Position, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(
  id: string,
  opts: {
    position?: Position;
    side?: 'my' | 'enemy';
    attack?: number;
    attackRange?: number;
    maxTroops?: number;
    pursuit?: string[];
  } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 200,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: opts.attackRange ?? 5,
      maxTroops: opts.maxTroops ?? 30000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: opts.pursuit ?? [],
      morale: 100,
    },
    side: opts.side ?? 'my',
    troops: opts.maxTroops ?? 30000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(seed = 7): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 发动率提升 +100 个百分点（动如雷震口径）→ 追击必定发动，测试不依赖 seed 的发动率掷点 */
function forcepursuit(attacker: UnitState): void {
  attacker.statuses.push({
    type: 'trigger_boost',
    rate: 1,
    remaining: 999,
    appliedRound: 1,
    sourceSkillType: 'passive',
    sourceSkillId: 'tmp_force_pursuit',
    skillTypes: ['pursuit'],
  } as Extract<Status, { type: 'trigger_boost' }>);
}

function give(unit: UnitState, create: CreateStatus, skillType: Status['sourceSkillType'] = 'command', skillId = 'test_split'): void {
  const ctx = makeCtx();
  ctx.myTeam = [unit];
  inflictStatus(ctx, unit, create, skillType, skillId);
}

function sections(events: BattleEvent[]): { phase: string; start: number; end: number }[] {
  const list: { phase: string; start: number; end: number }[] = [];
  events.forEach((e, i) => {
    if (e.type === 'unit_act_start') list.push({ phase: e.phase, start: i, end: events.length });
  });
  list.forEach((s, i) => {
    if (i + 1 < list.length) s.end = list[i + 1].start;
  });
  return list;
}

function idxs(events: BattleEvent[], type: BattleEvent['type']): number[] {
  const out: number[] = [];
  events.forEach((e, i) => {
    if (e.type === type) out.push(i);
  });
  return out;
}

describe('分兵只由普通攻击触发（追击不触发分兵）', () => {
  it('分兵事件落在普攻段：追击【疾击其后】判定之前结算', () => {
    const ctx = makeCtx(4);
    const attacker = makeUnit('atk', { position: '前锋', pursuit: ['jiji_qihou'] });
    const eFront = makeUnit('ef', { position: '前锋', side: 'enemy' });
    const eMid = makeUnit('em', { position: '中军', side: 'enemy' });
    const eBack = makeUnit('eb', { position: '大营', side: 'enemy' });
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eFront, eMid, eBack];
    give(attacker, { type: 'split', duration: 999, rate: 55 } as CreateStatus);
    forcepursuit(attacker);

    actUnit(ctx, attacker);

    // 追击确实发动了（否则本用例失去意义）
    const pursuitCasts = ctx.events.filter((e) => e.type === 'skill_cast' && e.skillId === 'jiji_qihou');
    expect(pursuitCasts.length).toBe(1);
    const pursuitDamage = ctx.events.filter((e) => e.type === 'damage' && e.skillId === 'jiji_qihou');
    expect(pursuitDamage.length).toBe(2); // 疾击其后 2 段攻击

    const splitIdxs = idxs(ctx.events, 'split_damage');
    expect(splitIdxs.length).toBeGreaterThanOrEqual(1);

    // ① 每一条分兵事件都必须落在 normal_attack 段内（不得出现在 pursuit_skill 段）
    const secs = sections(ctx.events);
    const pursuitSec = secs.find((s) => s.phase === 'pursuit_skill')!;
    const normalSec = secs.find((s) => s.phase === 'normal_attack')!;
    for (const i of splitIdxs) {
      expect(i, '分兵事件必须在普攻段内').toBeGreaterThan(normalSec.start);
      expect(i, '分兵事件不得落进追击段').toBeLessThan(pursuitSec.start);
    }
    // ② 追击伤害必然在分兵之后（追击判定不参与分兵结算）
    const firstPursuitDamage = idxs(ctx.events, 'damage')[0];
    expect(firstPursuitDamage).toBeGreaterThan(Math.max(...splitIdxs));
  });

  it('连击：每次普攻各自结算分兵（普攻→分兵→追击 逐次穿插）', () => {
    const ctx = makeCtx(13);
    const attacker = makeUnit('atk', { position: '前锋', pursuit: ['jiji_qihou'] });
    const eFront = makeUnit('ef', { position: '前锋', side: 'enemy' });
    const eMid = makeUnit('em', { position: '中军', side: 'enemy' });
    const eBack = makeUnit('eb', { position: '大营', side: 'enemy' });
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eFront, eMid, eBack];
    give(attacker, { type: 'split', duration: 999, rate: 55 } as CreateStatus);
    give(attacker, { type: 'combo', duration: 1 } as CreateStatus, 'passive', 'tmp_combo');
    forcepursuit(attacker);

    actUnit(ctx, attacker);

    const normalSecs = sections(ctx.events).filter((s) => s.phase === 'normal_attack');
    expect(normalSecs).toHaveLength(2); // 连击 = 至多 2 次普攻

    const splitIdxs = idxs(ctx.events, 'split_damage');
    expect(splitIdxs.length).toBeGreaterThanOrEqual(2); // 两次普攻各结算一批分兵

    for (const sec of normalSecs) {
      const inSec = splitIdxs.filter((i) => i > sec.start && i < sec.end);
      expect(inSec.length, '每次普攻都要有自己的分兵结算').toBeGreaterThanOrEqual(1);
    }
    // 逐次穿插：第 2 次普攻（attack_hit）之前只有第 1 次普攻的分兵，第 2 次普攻的分兵在其之后
    const hits = idxs(ctx.events, 'attack_hit');
    expect(hits).toHaveLength(2);
    const firstBatch = splitIdxs.filter((i) => i < hits[1]);
    const secondBatch = splitIdxs.filter((i) => i > hits[1]);
    expect(firstBatch.length).toBeGreaterThanOrEqual(1);
    expect(secondBatch.length).toBeGreaterThanOrEqual(1);
  });

  it('回归：追击击杀普攻目标时，普攻带来的分兵照常结算（不再被追击吞掉）', () => {
    const ctx = makeCtx(7);
    // 普攻目标（中军，最近敌）只留 900 兵力：普攻打不死，紧接着的追击必定击杀
    const attacker = makeUnit('atk', { position: '前锋', pursuit: ['fangzhen_tuji'] });
    const eMid = makeUnit('em', { position: '中军', side: 'enemy', maxTroops: 900 });
    const eBack = makeUnit('eb', { position: '大营', side: 'enemy' });
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eMid, eBack];
    give(attacker, { type: 'split', duration: 999, rate: 55 } as CreateStatus);
    forcepursuit(attacker);

    actUnit(ctx, attacker);

    // 目标确实被追击击杀（修复前：分兵阶段见 hit.alive === false → 整段跳过）
    expect(eMid.alive).toBe(false);

    const splitIdxs = idxs(ctx.events, 'split_damage');
    expect(splitIdxs.length, '普攻已命中 → 分兵必须结算，不因追击击杀而消失').toBeGreaterThanOrEqual(1);

    // 分兵在追击伤害之前打出（追击判定不参与分兵）
    const pursuitDamageIdx = ctx.events.findIndex((e) => e.type === 'damage' && e.skillId === 'fangzhen_tuji');
    expect(pursuitDamageIdx).toBeGreaterThan(Math.max(...splitIdxs));
  });

  it('次数型分兵（飒沓/鱼鳞 charges）：按普攻次数消耗，追击不额外消耗', () => {
    const ctx = makeCtx(13);
    const attacker = makeUnit('atk', { position: '前锋', pursuit: ['jiji_qihou'] });
    const eFront = makeUnit('ef', { position: '前锋', side: 'enemy' });
    const eMid = makeUnit('em', { position: '中军', side: 'enemy' });
    const eBack = makeUnit('eb', { position: '大营', side: 'enemy' });
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eFront, eMid, eBack];
    // 次数型分兵：只有 1 次 → 只覆盖第 1 次普攻（连击第 2 次普攻不再溅射）
    give(attacker, { type: 'split', duration: 999, rate: 55, charges: 1 } as CreateStatus);
    give(attacker, { type: 'combo', duration: 1 } as CreateStatus, 'passive', 'tmp_combo');
    forcepursuit(attacker);

    actUnit(ctx, attacker);

    const normalSecs = sections(ctx.events).filter((s) => s.phase === 'normal_attack');
    expect(normalSecs).toHaveLength(2);
    const splitIdxs = idxs(ctx.events, 'split_damage');
    expect(splitIdxs.length).toBeGreaterThanOrEqual(1);
    // 全部分兵事件都属于第 1 次普攻段；第 2 次普攻段无分兵（charges 已在普攻时点耗尽）
    for (const i of splitIdxs) {
      expect(i).toBeGreaterThan(normalSecs[0].start);
      expect(i).toBeLessThan(normalSecs[0].end);
    }
    expect(attacker.statuses.some((s) => s.type === 'split')).toBe(false);
  });
});
