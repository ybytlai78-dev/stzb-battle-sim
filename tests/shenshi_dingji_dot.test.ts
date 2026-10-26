/**
 * 审时定计（XP程昱）对「持续伤害类负面」的施加前判定（2026-10-26 用户报障后补）。
 *
 * 报障（用户原话）：「庞统 程昱组队时，庞统施加 dot 负面前没有正确施加程昱增伤，
 * 导致 dot 吃不到程昱审时定计的增伤」。
 *
 * 机制链：DoT 在 `inflictStatus` 时就把伤害冻死（`computeDotTickDamage` 读当时的
 * caused × taken 与 `sumReduce`），所以「施加这一拍**之前**」必须已完成程昱的判定与
 * +30% taken 入栈。顺序本来就是对的（`inflictStatusCore` 顶部先跑判定）——
 * 漏的是**清单**：恐慌 / 燃烧 / 妖术 / 妖术诅咒 / 引燃 / 动摇原先都不在
 * `SPECIAL_DEBUFF_TYPES` 里，判定一次都不掷。
 *
 * 本文件守三件事：① 六类 DoT 都会掷判定；② 命中后 DoT 冻结里确实带上 taken 增伤
 * （伤害比无程昱时高，且归因里点名 shenshi_dingji）；③ 判定失败 / 目标在友军侧 /
 * 非负面数值状态时不触发（口径没被放宽成「任何状态都触发」）。
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  getStatus,
  hasStatus,
  inflictStatus,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function dummyUnit(
  id: string,
  position: Position,
  extra: Partial<General> = {},
  side: 'my' | 'enemy' = 'my',
): UnitState {
  const g: General = {
    id, name: id, rarity: '5星', cost: 3, faction: '魏', tags: [],
    mutualExclusionGroup: null, troopType: 'archer', position,
    attack: 80, defense: 100, strategy: 80, speed: 50, attackRange: 3, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

function makeCtx(seed = 7): CombatContext {
  return {
    rng: new Rng(seed), myTeam: [], enemyTeam: [], events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

type Field = { ctx: CombatContext; pangtong: UnitState; chengyu: UnitState; foe: UnitState };

/** 我方 庞统（施法者）+ 程昱（审时定计）；敌方 foe（受负面）。
 *  `chance` 传入即强制判定结果（只看规则，不看骰子）。 */
function field(opts: { withChengyu?: boolean; chance?: boolean } = {}): Field {
  const ctx = makeCtx();
  const pangtong = dummyUnit('pangtong', '中军', { strategy: 200, mainSkillId: 'mimou_dingshu', activeSkillIds: ['mimou_dingshu'] });
  const chengyu = dummyUnit('chengyu', '大营', { strategy: 80, commandSkillIds: ['shenshi_dingji'] });
  const foe = dummyUnit('foe', '前锋', {}, 'enemy');
  ctx.myTeam = opts.withChengyu === false ? [pangtong] : [pangtong, chengyu];
  ctx.enemyTeam = [foe];
  if (opts.chance !== undefined) {
    const result = opts.chance;
    ctx.rng.chance = () => result;
  }
  return { ctx, pangtong, chengyu, foe };
}

/** 庞统给 foe 挂一个恐慌（2 跳），返回第一跳事件 */
function castPanicAndTick(f: Field): Extract<BattleEvent, { type: 'dot_tick' }> {
  inflictStatus(f.ctx, f.foe, { type: 'panic', duration: 2, rate: 143, growthRate: 1.5, sourceStrategy: 200 }, 'active', 'mimou_dingshu', 'pangtong');
  f.ctx.currentRound = 1;
  actUnit(f.ctx, f.foe);
  const tick = f.ctx.events.find(
    (e): e is Extract<BattleEvent, { type: 'dot_tick' }> => e.type === 'dot_tick' && e.targetId === 'foe',
  );
  if (!tick) throw new Error('应有 DoT 跳伤事件');
  return tick;
}

const shenshiTriggers = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'shenshi_dingji');

describe('审时定计 × 谋略 DoT（庞统报障）', () => {
  it('施加恐慌前先掷判定，命中后 frozen 伤害里带上 shenshi_dingji 的 taken 增伤', () => {
    const f = field({ chance: true });
    const tick = castPanicAndTick(f);

    // ① 判定确实掷了（不是「清单漏项 → 一次都不掷」）
    const triggers = shenshiTriggers(f.ctx);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ unitId: 'chengyu', targetId: 'foe', success: true, baseRate: 50 });

    // ② +30% taken 在 DoT 冻结之前已入栈
    const boost = getStatus(f.foe, 'damage_boost');
    expect(boost, '命中后 foe 应带受到伤害提高').toBeTruthy();
    expect(boost!.rate).toBeCloseTo(0.3, 5);

    // ③ 冻结归因点名 shenshi_dingji（DoT 真的吃到了这一层）
    const taken = tick.modifiers!.taken;
    expect(taken.map((m) => m.skillId)).toContain('shenshi_dingji');
    expect(taken.find((m) => m.skillId === 'shenshi_dingji')!.rate).toBeCloseTo(0.3, 5);

    // ④ 伤害比「没有程昱」高
    const ctrl = castPanicAndTick(field({ withChengyu: false }));
    expect(tick.damage).toBeGreaterThan(ctrl.damage);
  });

  it('判定失败 → 不挂增伤，DoT 也吃不到（不会白送）', () => {
    const f = field({ chance: false });
    const tick = castPanicAndTick(f);
    expect(shenshiTriggers(f.ctx)[0]).toMatchObject({ success: false });
    expect(hasStatus(f.foe, 'damage_boost')).toBe(false);
    expect(tick.modifiers!.taken.map((m) => m.skillId)).not.toContain('shenshi_dingji');

    const hit = castPanicAndTick(field({ chance: true }));
    expect(hit.damage).toBeGreaterThan(tick.damage);
  });

  it('六类持续伤害类负面都会掷判定（恐慌 / 燃烧 / 妖术 / 妖术诅咒 / 引燃 / 动摇）', () => {
    const cases: Array<{ label: string; create: CreateStatus }> = [
      { label: 'panic', create: { type: 'panic', duration: 2, rate: 120, growthRate: 1 } },
      { label: 'burning', create: { type: 'burning', duration: 2, rate: 120, growthRate: 1 } },
      { label: 'sorcery', create: { type: 'sorcery', duration: 2, rate: 120, growthRate: 1 } },
      { label: 'curse', create: { type: 'curse', duration: 2, rate: 120, growthRate: 1 } },
      { label: 'ignite', create: { type: 'ignite', duration: 2, rate: 120, growthRate: 1 } },
      { label: 'unrest', create: { type: 'unrest', duration: 1, rate: 60 } },
    ];
    for (const { label, create } of cases) {
      const f = field({ chance: true });
      inflictStatus(f.ctx, f.foe, create, 'active', 'test_dot', 'pangtong');
      const triggers = shenshiTriggers(f.ctx);
      expect(triggers, `${label} 应掷审时定计判定`).toHaveLength(1);
      expect(triggers[0]).toMatchObject({ success: true, baseRate: 50 });
      expect(hasStatus(f.foe, 'damage_boost'), `${label} 命中后应有增伤`).toBe(true);
    }
  });

  it('口径没放宽：friend 侧被施加恐慌不触发、非负面数值状态不触发', () => {
    // ① 目标在我方（程昱同侧）→ 不是「敌方被施加」
    const f1 = field({ chance: true });
    const ally = dummyUnit('ally', '前锋');
    f1.ctx.myTeam.push(ally);
    inflictStatus(f1.ctx, ally, { type: 'panic', duration: 2, rate: 100, growthRate: 1 }, 'active', 'test_dot', 'pangtong');
    expect(shenshiTriggers(f1.ctx)).toHaveLength(0);

    // ② 数值型正面/减伤状态不在清单
    const f2 = field({ chance: true });
    inflictStatus(f2.ctx, f2.foe, { type: 'damage_reduce', rate: 0.2, duration: 2 }, 'active', 'test_dr', 'pangtong');
    expect(shenshiTriggers(f2.ctx)).toHaveLength(0);

    // ③ 挑衅 / 围困 / 控制四类仍照旧触发（原有口径没被改坏）
    const controls: CreateStatus[] = [
      { type: 'taunt', duration: 1, targetId: 'pangtong' },
      { type: 'siege', duration: 1 },
      { type: 'confusion', duration: 1 },
      { type: 'cowardice', duration: 1 },
    ];
    for (const create of controls) {
      const f3 = field({ chance: true });
      inflictStatus(f3.ctx, f3.foe, create, 'active', 'test_ctrl', 'pangtong');
      expect(shenshiTriggers(f3.ctx), `${create.type} 应触发`).toHaveLength(1);
    }
  });

  it('同一战法的两个 DoT 各判一次（密谋定蜀 恐慌 + 妖术）', () => {
    const f = field({ chance: true });
    inflictStatus(f.ctx, f.foe, { type: 'panic', duration: 2, rate: 143, growthRate: 1.5 }, 'active', 'mimou_dingshu', 'pangtong');
    inflictStatus(f.ctx, f.foe, { type: 'curse', duration: 2, rate: 133, growthRate: 1.225 }, 'active', 'mimou_dingshu', 'pangtong');
    expect(shenshiTriggers(f.ctx)).toHaveLength(2);
    // 两个 DoT 冻结时都读到了同一份 taken 增伤（同源刷新，不叠加）
    const stored = f.foe.statuses.filter((s) => s.type === 'panic' || s.type === 'curse');
    expect(stored).toHaveLength(2);
  });
});
