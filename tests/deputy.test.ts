/**
 * 北伐副本 · 副将机制（web/deputy.ts）
 * ---------------------------------------------------------------------------
 * 守的三件事（用户 2026-11-05 口径）：
 *   1. 主将四维 = 主将 70% + 副将 30%（逐项四舍五入），兵力不变；
 *   2. 副将主战法占**第二战法格** → 判定顺序「主将主战法 → 副将主战法 → 装配战法」，装配上限收到 1；
 *   3. 副将等级跟随主将、加点独立；常规赛季路径与历史行为逐字段一致（引擎零改动）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildGeneralForSlot,
  deputyBudget,
  deputyRejectReason,
  deputySkillId,
  deputyStatsAt,
  emptyDeputy,
  equipLimit,
  mixStats,
  normalizeDeputy,
} from '../web/deputy';
import { HERO_RECORDS, SLOTTED_HEROES, buildGeneral, freePointBudget } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { mainSkillSlot } from '../src/data/hero-utils';
import { emptySlot } from '../web/teamEditor';
import type { SlotState } from '../web/teamEditor';
import { normalizeSlot as normalizePresetSlot } from '../web/presetStore';

/** 同阵营的一对主将 / 副将（都挂了已实装主战法） */
const usable = SLOTTED_HEROES.filter((h) => h.mainSkillId && SKILL_REGISTRY[h.mainSkillId]);
const mainHero = usable.find((h) => usable.some((o) => o.id !== h.id && o.faction === h.faction))!;
const deputyHero = usable.find((o) => o.id !== mainHero.id && o.faction === mainHero.faction)!;
const otherFaction = usable.find((o) => o.faction !== mainHero.faction)!;

function slotOf(patch: Partial<SlotState> = {}): SlotState {
  return {
    ...emptySlot(),
    heroId: mainHero.id,
    level: 40,
    ...patch,
  };
}

describe('副将合成公式（主将 70% + 副将 30%）', () => {
  it('逐项四舍五入，不是先加后乘', () => {
    expect(mixStats({ attack: 1000, defense: 800, strategy: 600, speed: 400 }, { attack: 500, defense: 400, strategy: 300, speed: 200 })).toEqual({
      attack: 850,
      defense: 680,
      strategy: 510,
      speed: 340,
    });
  });

  it('奇数加权按四舍五入落到整数', () => {
    // 1001*0.7 + 502*0.3 = 700.7 + 150.6 = 851.3 → 851
    expect(mixStats({ attack: 1001, defense: 0, strategy: 0, speed: 0 }, { attack: 502, defense: 0, strategy: 0, speed: 0 }).attack).toBe(851);
  });

  it('带副将的 General 四维 = 主将面板 ×0.7 + 副将面板 ×0.3，兵力仍按主将', () => {
    const slot = slotOf({ deputy: emptyDeputy(deputyHero.id) });
    const g = buildGeneralForSlot(slot, '前锋', 120, 'beifa')!;
    const mainOnly = buildGeneral(mainHero.id, [], slot.freePoints, '前锋', 0, 40, 120);
    const d = deputyStatsAt(slot.deputy!, 40);
    expect(g.attack).toBe(Math.round(mainOnly.attack * 0.7 + d.attack * 0.3));
    expect(g.defense).toBe(Math.round(mainOnly.defense * 0.7 + d.defense * 0.3));
    expect(g.strategy).toBe(Math.round(mainOnly.strategy * 0.7 + d.strategy * 0.3));
    expect(g.speed).toBe(Math.round(mainOnly.speed * 0.7 + d.speed * 0.3));
    expect(g.maxTroops).toBe(mainOnly.maxTroops);
  });

  it('副将等级跟随主将：主将升到 50 级，副将面板按 50 级参与加权', () => {
    const slot40 = slotOf({ level: 40, deputy: emptyDeputy(deputyHero.id) });
    const slot50 = slotOf({ level: 50, deputy: emptyDeputy(deputyHero.id) });
    const g40 = buildGeneralForSlot(slot40, '中军', 120, 'beifa')!;
    const g50 = buildGeneralForSlot(slot50, '中军', 120, 'beifa')!;
    const d40 = deputyStatsAt(slot40.deputy!, 40);
    const d50 = deputyStatsAt(slot50.deputy!, 50);
    expect(d50.attack).toBeGreaterThan(d40.attack);
    expect(g50.attack).toBeGreaterThan(g40.attack);
  });

  it('副将加点独立：只改副将加点也影响合成结果', () => {
    const base = slotOf({ deputy: emptyDeputy(deputyHero.id) });
    const plus = slotOf({ deputy: { heroId: deputyHero.id, freePoints: { attack: 10, defense: 0, strategy: 0, speed: 0 } } });
    const a = buildGeneralForSlot(base, '前锋', 120, 'beifa')!;
    const b = buildGeneralForSlot(plus, '前锋', 120, 'beifa')!;
    expect(b.attack).toBeGreaterThan(a.attack);
  });
});

describe('第二战法格与装配上限', () => {
  it('常规赛季 / 北伐未挂副将 = 2 个装配位；北伐挂副将 = 1 个', () => {
    expect(equipLimit(slotOf(), 'classic')).toBe(2);
    expect(equipLimit(slotOf(), 'beifa')).toBe(2);
    expect(equipLimit(slotOf({ deputy: emptyDeputy(deputyHero.id) }), 'beifa')).toBe(1);
  });

  it('战法顺序：主将主战法 → 副将主战法 → 主将装配战法', () => {
    const deputySkill = deputySkillId(emptyDeputy(deputyHero.id))!;
    const slotKey = mainSkillSlot(deputySkill)!;
    const type = SKILL_REGISTRY[deputySkill].type;
    // 取一个与副将主战法同类型、且不是它的装配战法
    const equipId = Object.keys(SKILL_REGISTRY).find((id) => SKILL_REGISTRY[id].type === type && id !== deputySkill && id !== mainHero.mainSkillId)!;

    const slot = slotOf({ extraSkillIds: [equipId], deputy: emptyDeputy(deputyHero.id) });
    const g = buildGeneralForSlot(slot, '前锋', 120, 'beifa')!;
    const list = g[slotKey] as string[];
    expect(list[0]).toBe(mainHero.mainSkillId);
    expect(list[1]).toBe(deputySkill);
    expect(list[2]).toBe(equipId);
  });

  it('常规赛季不挂副将战法（即使槽位里存了 deputy）', () => {
    const slot = slotOf({ deputy: emptyDeputy(deputyHero.id) });
    const g = buildGeneralForSlot(slot, '前锋', 120, 'classic')!;
    const dSkill = deputySkillId(slot.deputy!)!;
    const slotKey = mainSkillSlot(dSkill)!;
    expect(g[slotKey] as string[]).not.toContain(dSkill);
    // 与历史 buildGeneral 逐字段一致
    expect(g).toEqual(buildGeneral(mainHero.id, [], slot.freePoints, '前锋', 0, 40, 120));
  });
});

describe('副将合法性与存档校正', () => {
  it('同阵营合法；跨阵营 / 同一张卡被拒并给出人话原因', () => {
    expect(deputyRejectReason(mainHero.id, deputyHero.id)).toBeNull();
    expect(deputyRejectReason(mainHero.id, mainHero.id)).toContain('同一张卡');
    expect(deputyRejectReason(mainHero.id, otherFaction.id)).toContain('同阵营');
  });

  it('加点预算按「等级跟主将、红度 0」算', () => {
    const d = emptyDeputy(deputyHero.id);
    expect(deputyBudget(d, 40)).toBe(freePointBudget(deputyHero.id, 0, 40));
    expect(deputyBudget(d, 50)).toBe(freePointBudget(deputyHero.id, 0, 50));
  });

  it('存档校正：超预算的加点被裁到预算内，非法副将被丢弃', () => {
    const d = normalizeDeputy(
      { heroId: deputyHero.id, freePoints: { attack: 999, defense: 999, strategy: 0, speed: 0 } },
      mainHero.id,
      40
    )!;
    const sum = d.freePoints.attack + d.freePoints.defense + d.freePoints.strategy + d.freePoints.speed;
    expect(sum).toBeLessThanOrEqual(deputyBudget(d, 40));
    expect(normalizeDeputy({ heroId: otherFaction.id }, mainHero.id, 40)).toBeUndefined();
    expect(normalizeDeputy({ heroId: 'does-not-exist' }, mainHero.id, 40)).toBeUndefined();
  });

  it('主将未放时拒绝佩戴', () => {
    expect(deputyRejectReason(null, deputyHero.id)).toContain('主将');
    expect(HERO_RECORDS[deputyHero.id]).toBeTruthy();
  });
});

describe('第二格占位的两道防线（老存档 / 预设 / 直接构造）', () => {
  const deputySkill = deputySkillId(emptyDeputy(deputyHero.id))!;
  const slotKey = mainSkillSlot(deputySkill)!;
  // 与副将主战法同类型的两个装配战法（顺序断言才有意义）
  const sameType = Object.keys(SKILL_REGISTRY).filter(
    (id) => SKILL_REGISTRY[id].type === SKILL_REGISTRY[deputySkill].type && id !== deputySkill && id !== mainHero.mainSkillId
  );

  it('预设校正：带副将的槽位最多保留 1 个装配战法', () => {
    const slot = normalizePresetSlot({
      heroId: mainHero.id,
      level: 40,
      extraSkillIds: sameType.slice(0, 2),
      deputy: { heroId: deputyHero.id, freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 } },
    });
    expect(slot.deputy?.heroId).toBe(deputyHero.id);
    expect(slot.extraSkillIds.length).toBe(1);
    // 不带副将 → 仍保留 2 个
    const plain = normalizePresetSlot({ heroId: mainHero.id, level: 40, extraSkillIds: sameType.slice(0, 2) });
    expect(plain.extraSkillIds.length).toBe(2);
  });

  it('合成入口兜底：即使槽位塞了 2 个装配战法，北伐下也只挂第一格', () => {
    const slot = slotOf({ extraSkillIds: sameType.slice(0, 2), deputy: emptyDeputy(deputyHero.id) });
    const g = buildGeneralForSlot(slot, '前锋', 120, 'beifa')!;
    const list = g[slotKey] as string[];
    expect(list).toEqual([mainHero.mainSkillId, deputySkill, sameType[0]]);
  });
});
