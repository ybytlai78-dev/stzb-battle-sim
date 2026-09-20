/**
 * 宝物系统 · 引擎侧（P2）
 * 覆盖：官方数值 → 状态数值的换算（默认 10 级：一阶/二阶 ×5、三阶固定）、词条过滤维、未实现词条不产出。
 */
import { describe, it, expect } from 'vitest';
import type { General, CreateStatus, UnitState } from '../src/engine/types';
import { buildTreasureStatuses, PENDING } from '../src/engine/treasure';
import { TREASURES_BY_ID } from '../src/data/treasures';

const self = {} as General;
const build = (treasureId: number, level = 10) =>
  buildTreasureStatuses({ treasureId, level }, self).map((x) => x.create);

const byType = (list: CreateStatus[], type: string) => list.filter((s) => s.type === type) as Record<string, unknown>[];
const labelled = (treasureId: number, label: string, level = 10) =>
  buildTreasureStatuses({ treasureId, level }, self)
    .filter((x) => x.label === label)
    .map((x) => x.create) as Record<string, unknown>[];

/** 构造一个只带 position/id 的友军（护主 需要找大营） */
const ally = (id: string, position: '大营' | '中军' | '前锋') =>
  ({ general: { id, position } }) as unknown as UnitState;

describe('宝物引擎 · 自带特效换算', () => {
  it('别鸣（1027）10 级：稳固 3×5=15 防御、不移 1×5=5% 攻击伤害减伤、英才 5% 谋略/速度', () => {
    const list = build(1027);
    const def = byType(list, 'defense_buff');
    expect(def).toHaveLength(1);
    expect(def[0].amount).toBe(15); // 官方值 3.0 × 5

    const red = byType(list, 'damage_reduce');
    expect(red).toHaveLength(1);
    expect(red[0].rate).toBeCloseTo(0.05, 6); // 1% × 5
    expect(red[0].damageType).toBe('physical'); // 不移 = 受攻击伤害降低

    const buf = byType(list, 'strategy_buff');
    expect(buf).toHaveLength(1);
    expect(buf[0].amount).toBe(5);
    expect(buf[0].percent).toBe(true);
    const spd = byType(list, 'speed_buff');
    expect(spd[0].percent).toBe(true);
  });

  it('等级换算：一阶 5 级 = ×5、1 级 = ×1；二阶 5 级 = ×0（刚解锁）、10 级 = ×5', () => {
    const at = (lv: number) => build(1027, lv);
    expect(byType(at(1), 'defense_buff')[0].amount).toBe(3);
    expect(byType(at(5), 'defense_buff')[0].amount).toBe(15);
    expect(byType(at(5), 'damage_reduce')).toHaveLength(0); // 二阶在 5 级尚未强化
    expect(byType(at(10), 'damage_reduce')).toHaveLength(1);
  });

  it('三阶固定：屈卢 破敌 = 无视 10% 防御（不随等级翻倍）', () => {
    const [ign] = labelled(1012, '破敌');
    expect(ign.rate).toBeCloseTo(0.1, 6);
    expect(ign.damageType).toBe('physical');
    const [at1] = labelled(1012, '破敌', 1);
    expect(at1.rate).toBeCloseTo(0.1, 6); // 三阶固定，1 级与 10 级同值
  });

  it('过滤维：强韧限普攻、无畏限追击、陷阵限普攻增伤', () => {
    const [jianren] = labelled(1072 /* 大将：稳固/强韧/护主 */, '强韧');
    expect(jianren.damageSource).toBe('basic'); // 强韧 = 受到普通攻击伤害降低
    const [wuyou] = labelled(1009 /* 狰角枪：无畏/骁锐/陷阵 */, '无畏');
    expect(wuyou.skillTypes).toEqual(['pursuit']); // 无畏 = 追击战法伤害提高
    const [xianzhen] = labelled(1009, '陷阵');
    expect(xianzhen.damageSource).toBe('basic'); // 陷阵 = 普通攻击伤害提高
    expect(xianzhen.rate).toBeCloseTo(0.12, 6);
  });

  it('锻造词条：机敏 = 主战法发动率（按玩家选定数值），英勇额外限攻击类', () => {
    const a = buildTreasureStatuses({ treasureId: 1009, affix: { name: '机敏', value: 6 } }, self);
    const t = a.find((x) => x.label === '机敏')!.create as Record<string, unknown>;
    expect(t.type).toBe('trigger_boost');
    expect(t.rate).toBeCloseTo(0.06, 6);
    expect(t.mainSkillOnly).toBe(true);
  });

  it('未实现词条（PENDING）不产出状态，但会被登记', () => {
    expect(Object.keys(PENDING).length).toBeGreaterThan(10);
    const tai = TREASURES_BY_ID[1075]; // 泰阿：骁锐/明镜/强固
    expect(tai.effects.map((e) => e.name)).toEqual(['骁锐', '明镜', '强固']);
    // 强固（每回合首次受伤减伤）未实现 → 只出 骁锐/明镜
    expect(build(1075)).toHaveLength(2);
    expect(PENDING['强固']).toBeTruthy();
  });

  it('明镜（泰阿）：谋略 ×5=10，仅当初始统率 < 3 时额外给 1.5×5=7.5 防御', () => {
    const high = buildTreasureStatuses({ treasureId: 1075 }, { cost: 3 } as General).map((x) => x.create);
    expect(byType(high, 'defense_buff')).toHaveLength(0);
    const low = buildTreasureStatuses({ treasureId: 1075 }, { cost: 1 } as General).map((x) => x.create);
    const def = byType(low, 'defense_buff');
    expect(def).toHaveLength(1);
    expect(def[0].amount).toBeCloseTo(7.5, 6);
    // 泰阿 三阶「强固」仍未实现
    expect(byType(low, 'strategy_buff')).toHaveLength(1);
  });

  it('护主（大将）：前 2 回合援护我军大营（cover + protectId）', () => {
    const allies = [ally('me', '中军'), ally('back', '大营')];
    const list = buildTreasureStatuses({ treasureId: 1072 }, self, allies).map((x) => x.create);
    const cover = byType(list, 'cover');
    expect(cover).toHaveLength(1);
    expect(cover[0].protectId).toBe('back');
    expect(cover[0].duration).toBe(2);
  });

  it('安贞（博浪）：控制状态下受伤害降低 = 1%×5，requireSelfStatus 覆盖四类控制', () => {
    const [anzhen] = labelled(1048, '安贞');
    expect(anzhen.type).toBe('damage_reduce');
    expect(anzhen.rate).toBeCloseTo(0.05, 6);
    expect(anzhen.requireSelfStatus).toEqual(['confusion', 'rampage', 'cowardice', 'hesitation']);
  });
});
