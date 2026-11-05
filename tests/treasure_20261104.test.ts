/**
 * 2026-11-04 四件新宝物（山君 1126 / 天问 1129 / 镂影 1132 / 奋髯 1135）与曹仁加强。
 *
 * 取证：`docs/逆向对拍/宝物与曹仁加强取证-2026-11-04.md`（P0 客户端热更 `tb_cfg_*`）。
 * 四特技都在 `skill_type 16 / skill_quality 6 / prob 100`，不进发动率判定：
 *   虎啸 400129 —— 行动时主战法每提供 30% 攻击伤害提升 → 本回合追击战法发动率 +1%（向下取整，只覆盖当回合）
 *   观星 400128 —— 主战法施加的**犹豫** 40% 几率 +1 回合（一次性）
 *   奋武 400130 —— 自身普攻增伤 > 250% 时，普通攻击无视规避
 *   穿影 400131 —— 自身每对敌军造成 4 次攻击伤害 → 下次行动前对 3 距离内敌军单体 20% 攻击
 */
import { describe, it, expect } from 'vitest';
import {
  actUnit,
  applyDamage,
  consumeEvasion,
  inflictStatus,
  triggerTreasureStrikes,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID, getTreasure } from '../src/data/treasures';
import { applyTreasureEffects, buildTreasureStatuses } from '../src/engine/treasure';

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = {
    id, name: id, rarity: '5星', cost: 3, faction: '魏', tags: [],
    mutualExclusionGroup: null, troopType: 'cavalry', position,
    attack: 100, defense: 100, strategy: 100, speed: 50, attackRange: 3, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return { general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [], hasActedThisRound: false };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

const find = <T extends Status['type']>(u: UnitState, type: T) =>
  u.statuses.filter((s): s is Extract<Status, { type: T }> => s.type === type);

describe('宝物数据：四条新线路的自带特效', () => {
  it('三阶四件入库，特效名/数值与包内一致', () => {
    expect(Object.keys(TREASURES_BY_ID)).toHaveLength(40);
    const san = getTreasure(1126)!;
    expect(san.name).toBe('山君');
    expect(san.effects.map((e) => e.name)).toEqual(['破敌', '骁锐', '虎啸']);
    expect(san.effects.map((e) => e.value)).toEqual([1.5, 1, 1]);
    // 破敌 = 无视 1.5% 防御（百分比），骁锐 = 攻击 +1.0%（百分比），虎啸 = 每 30% 提升 → +1.0%
    const tian = getTreasure(1129)!;
    expect(tian.name).toBe('天问');
    expect(tian.effects.map((e) => e.name)).toEqual(['不移', '天资', '观星']);
    expect(tian.effects[2].value).toBe(40);
    const lou = getTreasure(1132)!;
    expect(lou.effects.map((e) => e.name)).toEqual(['坚忍', '英才', '穿影']);
    expect(lou.effects[2].numbers.slice(0, 3)).toEqual([4, 3, 1]);
    const feng = getTreasure(1135)!;
    expect(feng.effects.map((e) => e.name)).toEqual(['骁锐', '不移', '奋武']);
    expect(feng.effects[2].value).toBe(250);
  });

  it('二/三阶词条按官方文案落地成对应状态（含同名词条的宝物级覆盖）', () => {
    const self = dummyUnit('caochun', '大营');
    // 山君二阶 = 骁锐「攻击属性提高 1.0%」→ 百分比 buff（与点数型骁锐不同）
    const shan2 = buildTreasureStatuses({ treasureId: 1126, level: 10 }, self.general, []);
    const atk = shan2.filter((x) => x.create.type === 'attack_buff') as { create: Extract<CreateStatus, { type: 'attack_buff' }> }[];
    expect(atk.map((x) => [x.create.amount, !!x.create.percent])).toEqual([[5, true]]);
    const pen = shan2.filter((x) => x.create.type === 'ignore_def') as { create: Extract<CreateStatus, { type: 'ignore_def' }> }[];
    expect(pen.map((x) => [x.create.rate, x.create.damageType])).toEqual([[0.075, 'physical']]);
    // 奋髯二阶 = 不移「受所有伤害降低 1.0%」→ 不带 damageType 过滤（区别于三阶前的一阶/二阶）
    const feng2 = buildTreasureStatuses({ treasureId: 1135, level: 10 }, self.general, []);
    const red = feng2.filter((x) => x.create.type === 'damage_reduce') as { create: Extract<CreateStatus, { type: 'damage_reduce' }> }[];
    expect(red.map((x) => [x.create.rate, x.create.damageType ?? 'all'])).toEqual([[0.05, 'all']]);
  });
});

describe('虎啸（山君）：主战法每 30% 攻击伤害提升 → 本回合追击发动率 +1%', () => {
  const mainBoost = (rate: number): CreateStatus => ({
    type: 'damage_boost', rate, direction: 'caused', duration: 999, damageType: 'physical',
  });

  it('合计 90% → +3%（向下取整）；非主战法来源与策略增伤不计入', () => {
    const self = dummyUnit('caochun', '大营', { mainSkillId: 'pinghe_juwu', treasure: { treasureId: 1126, level: 10 } });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([self], [foe]);
    // 同源（同一战法）重复施加 = 刷新不叠加，因此用一条 90% 的增伤表示「主战法为自身提供 90%」
    inflictStatus(ctx, self, mainBoost(0.9), 'active', 'pinghe_juwu', self.general.id);
    // 干扰项：非主战法来源的策略增伤（同类型的攻击增伤会被冲突规则「取较高」替换掉，不能用来做干扰）
    inflictStatus(ctx, self, { type: 'damage_boost', rate: 2, direction: 'caused', duration: 999, damageType: 'strategy' } as CreateStatus, 'active', 'other_skill', self.general.id);

    actUnit(ctx, self);
    // 加成只覆盖本次行动（duration 1，行动结束即递减移除），因此以事件留痕断言
    const details = ctx.events
      .filter((e): e is Extract<BattleEvent, { type: 'status_changed' }> => e.type === 'status_changed')
      .map((e) => e.detail ?? '')
      .filter((d) => /虎啸/.test(d));
    expect(details.some((d) => d.includes('合计 90%') && d.includes('+3%'))).toBe(true);
    expect(find(self, 'trigger_boost')).toHaveLength(0);
  });

  it('不足 30% 不产生加成；合计 0 时零事件', () => {
    const self = dummyUnit('caochun', '大营', { mainSkillId: 'pinghe_juwu', treasure: { treasureId: 1126, level: 10 } });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([self], [foe]);
    inflictStatus(ctx, self, mainBoost(0.29), 'active', 'pinghe_juwu', self.general.id);
    actUnit(ctx, self);
    expect(ctx.events.some((e) => e.type === 'status_changed' && /虎啸/.test(e.detail ?? ''))).toBe(false);
  });
});

describe('观星（天问）：主战法施加的犹豫 40% 几率 +1 回合', () => {
  const guanxing: CreateStatus = {
    type: 'control_extend', charges: 1, chance: 1, onlyTypes: ['hesitation'], mainSkillOnly: true, duration: 999,
  };

  it('犹豫 +1 回合且消耗 1 次；其它控制不受影响', () => {
    const caster = dummyUnit('pangtong', '大营', { mainSkillId: 'mixiou_dingshu', treasure: { treasureId: 1129, level: 10 } });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    inflictStatus(ctx, caster, guanxing, 'passive', 'treasure:1129:3', caster.general.id);

    inflictStatus(ctx, foe, { type: 'cowardice', duration: 2 }, 'active', 'mixiou_dingshu', caster.general.id);
    expect(find(foe, 'cowardice')[0].remaining).toBe(2);

    inflictStatus(ctx, foe, { type: 'hesitation', duration: 2 }, 'active', 'mixiou_dingshu', caster.general.id);
    expect(find(foe, 'hesitation')[0].remaining).toBe(3);
    expect(find(caster, 'control_extend')).toHaveLength(0); // charges 用尽即移除
  });

  it('非主战法施加的犹豫不延时', () => {
    const caster = dummyUnit('pangtong', '大营', { mainSkillId: 'mixiou_dingshu', treasure: { treasureId: 1129, level: 10 } });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster], [foe]);
    inflictStatus(ctx, caster, guanxing, 'passive', 'treasure:1129:3', caster.general.id);
    inflictStatus(ctx, foe, { type: 'hesitation', duration: 2 }, 'active', 'other_skill', caster.general.id);
    expect(find(foe, 'hesitation')[0].remaining).toBe(2);
    expect(find(caster, 'control_extend')).toHaveLength(1);
  });
});

describe('奋武（奋髯）：普攻增伤 > 250% 时普攻无视规避', () => {
  const setup = (boosts: number[]) => {
    const self = dummyUnit('xiahou', '大营', { treasure: { treasureId: 1135, level: 10 } });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    foe.statuses.push({
      type: 'evasion', stacks: 1, remaining: 999, appliedRound: 0, sourceSkillType: 'passive', sourceSkillId: 'x',
    } as Status);
    const ctx = makeCtx([self], [foe]);
    applyTreasureEffects(ctx, self); // 奋武 → ignore_evasion{requireBasicBoostOver: 2.5}
    for (const r of boosts) {
      inflictStatus(ctx, self, { type: 'damage_boost', rate: r, direction: 'caused', duration: 999, damageSource: 'basic' }, 'passive', 'x', self.general.id);
    }
    return { ctx, self, foe };
  };

  it('增伤 300% → 普攻无视规避（规避层保留，不消耗）', () => {
    const { ctx, self, foe } = setup([3]);
    expect(consumeEvasion(ctx, foe, self.general.id, { damageSource: 'basic', damageType: 'physical' })).toBe(false);
    expect(find(foe, 'evasion')).toHaveLength(1);
  });

  it('增伤 250%（未超过）→ 仍吃规避；非普攻路径也不生效', () => {
    const { ctx, self, foe } = setup([2.5]);
    expect(consumeEvasion(ctx, foe, self.general.id, { damageSource: 'basic', damageType: 'physical' })).toBe(true);
    const again = setup([3]);
    expect(consumeEvasion(again.ctx, again.foe, again.self.general.id, { damageSource: 'skill', damageType: 'physical' })).toBe(true);
  });
});

describe('穿影（镂影）：每 4 次攻击伤害 → 下次行动前补一次 20% 攻击', () => {
  it('4 次物理伤害入队，第 5 次不满 4 次不再入队', () => {
    const self = dummyUnit('zhangliao', '大营', { treasure: { treasureId: 1132, level: 10 } });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([self], [foe]);
    inflictStatus(ctx, self, { type: 'treasure_strike_count', every: 4, rate: 20, maxDistance: 3, duration: 999 }, 'passive', 'treasure:1132:3', self.general.id);
    for (let i = 0; i < 5; i += 1) applyDamage(ctx, foe, 100, self, 'physical', 'skill', undefined, { skillType: 'active' });
    expect(ctx.treasureStrikes).toHaveLength(1);
    expect(ctx.treasureStrikes![0]).toMatchObject({ holderId: self.general.id, rate: 20, maxDistance: 3 });
    // 策略伤害不计入「攻击伤害」
    for (let i = 0; i < 4; i += 1) applyDamage(ctx, foe, 100, self, 'strategy', 'skill', undefined, { skillType: 'active' });
    expect(ctx.treasureStrikes).toHaveLength(1);
  });

  it('行动开始前结算：3 距离内敌军吃一次攻击伤害，队列清空', () => {
    const self = dummyUnit('zhangliao', '大营', { treasure: { treasureId: 1132, level: 10 } });
    const near = dummyUnit('near', '前锋', {}, 'enemy');
    const ctx = makeCtx([self], [near]);
    ctx.treasureStrikes = [{ holderId: self.general.id, rate: 20, maxDistance: 3 }];
    const before = near.troops;
    triggerTreasureStrikes(ctx, self);
    const dmg = ctx.events.filter((e) => e.type === 'damage' && e.skillId === 'treasure_chuanying');
    expect(dmg).toHaveLength(1);
    expect(near.troops).toBeLessThan(before);
    expect(ctx.treasureStrikes).toHaveLength(0);
  });

  it('计次不按回合递减（常驻整场）', () => {
    const self = dummyUnit('zhangliao', '大营');
    const ctx = makeCtx([self], [dummyUnit('foe', '前锋', {}, 'enemy')]);
    inflictStatus(ctx, self, { type: 'treasure_strike_count', every: 4, rate: 20, maxDistance: 3, duration: 999 }, 'passive', 'treasure:1132:3', self.general.id);
    const st = find(self, 'treasure_strike_count')[0];
    expect(st.remaining).toBe(999);
    expect(st.every).toBe(4);
  });
});

describe('曹仁加强：平壑拒吴发动率 35% → 40%', () => {
  it('战法表数值与伤害率/怯战时长', () => {
    const skill = SKILL_REGISTRY['pinghe_juwu'];
    expect(skill.triggerRate).toBe(0.4);
    const out = skill.output as { kind: string; rate?: number; status?: { type: string; duration?: number } }[];
    expect(out[0]).toMatchObject({ kind: 'physical_damage', rate: 210 });
    expect(out[1].status).toMatchObject({ type: 'cowardice', duration: 2 });
  });
});
