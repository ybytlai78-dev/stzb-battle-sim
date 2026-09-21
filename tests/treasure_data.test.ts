/**
 * 宝物数据完整性把关（`src/data/treasures.ts` ← `scripts/gen_treasure_data.mjs`）
 *
 * 覆盖：官方数量口径、词条池/词条表一致性、图片落地、官方区间可解析、默认 10 级强化模型。
 * 任何一条挂了，说明生成脚本或官方快照出了问题——先重跑 `node scripts/fetch_gear_data.mjs && node scripts/gen_treasure_data.mjs`。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TREASURES,
  TREASURES_BY_ID,
  AFFIXES,
  AFFIX_GROUPS,
  TREASURE_SLOT_STEPS,
  treasureEffectValue,
} from '../src/data/treasures';

const RAW = JSON.parse(
  readFileSync(fileURLToPath(new URL('../dateyuan/宝物数据.json', import.meta.url)), 'utf8'),
) as {
  treasures: { id: number; name: string; quality: string; skillName: string; featureGroup: number; affixPool: string[] }[];
  affixGroups: { groupId: number; affixes: { name: string; desc: string }[] }[];
};

const gearsDir = fileURLToPath(new URL('../public/gears/', import.meta.url));

describe('宝物数据（稀世）', () => {
  it('数量口径：官方 38 件稀世 = 战斗类 36（入库）+ 内政类 2（大吉/天禄，按口径剔除）', () => {
    const rawXishi = RAW.treasures.filter((t) => t.quality === '稀世');
    expect(rawXishi).toHaveLength(38);
    expect(TREASURES).toHaveLength(36);
    const ids = new Set(TREASURES.map((t) => t.id));
    const dropped = rawXishi.filter((t) => !ids.has(t.id)).map((t) => t.name);
    expect(dropped.sort()).toEqual(['大吉', '天禄']);
  });

  it('id / 名称唯一，类型合法，词条组在 1~11', () => {
    expect(new Set(TREASURES.map((t) => t.id)).size).toBe(TREASURES.length);
    expect(new Set(TREASURES.map((t) => t.name)).size).toBe(TREASURES.length);
    for (const t of TREASURES) {
      expect(['刀', '剑', '长兵', '弓', '扇', '其他']).toContain(t.type);
      expect(t.affixGroup).toBeGreaterThanOrEqual(1);
      expect(t.affixGroup).toBeLessThanOrEqual(11); // 12 = 内政，已剔除
      expect(TREASURES_BY_ID[t.id]).toBe(t);
    }
  });

  it('立绘 / 图标已落地 public/gears', () => {
    for (const t of TREASURES) {
      expect(t.image).toBe(`/gears/gear_${t.id}.jpg`);
      expect(t.icon).toBe(`/gears/gear_${t.id}_s.jpg`);
      expect(existsSync(`${gearsDir}/gear_${t.id}.jpg`), `缺立绘 ${t.name}`).toBe(true);
      expect(existsSync(`${gearsDir}/gear_${t.id}_s.jpg`), `缺图标 ${t.name}`).toBe(true);
    }
  });

  it('自带特效：slot 从 1 连续升序、文案非空、数值合法，且与官方 skillDesc 逐条对齐', () => {
    for (const t of TREASURES) {
      expect(t.effects.length).toBeGreaterThanOrEqual(1);
      expect(t.effects.length).toBeLessThanOrEqual(3);
      t.effects.forEach((e, i) => {
        expect(e.slot).toBe(i + 1);
        expect(e.name.length).toBeGreaterThan(0);
        expect(e.desc.length).toBeGreaterThan(0);
        expect(Number.isFinite(e.value)).toBe(true);
        expect(['percent', 'point']).toContain(e.unit);
      });
      const raw = RAW.treasures.find((x) => x.id === t.id)!;
      const names = raw.skillName.split('；').map((s) => s.trim());
      expect(names).toEqual(t.effects.map((e) => e.name));
    }
  });

  it('锻造词条池：每件 6~7 条且与所属组一致，池内词条都在词条表里', () => {
    for (const t of TREASURES) {
      expect([6, 7]).toContain(t.affixPool.length);
      expect(AFFIX_GROUPS[t.affixGroup]).toEqual(t.affixPool);
      for (const name of t.affixPool) expect(AFFIXES[name], `缺词条 ${name}`).toBeTruthy();
    }
  });

  it('词条表：36 条（官方 42 减去 G12 内政 6 条），区间 min<max，颜色提示单调', () => {
    expect(Object.keys(AFFIXES)).toHaveLength(36);
    const allNames = RAW.affixGroups.flatMap((g) => g.affixes.map((a) => a.name));
    const policyNames = RAW.affixGroups.find((g) => g.groupId === 12)!.affixes.map((a) => a.name);
    expect(new Set(allNames).size).toBe(42);
    expect(policyNames).toHaveLength(6);
    for (const name of policyNames) expect(AFFIXES[name]).toBeUndefined();

    for (const [name, a] of Object.entries(AFFIXES)) {
      expect(a.min, name).toBeLessThan(a.max);
      expect(['percent', 'point', 'round', 'count']).toContain(a.unit);
      expect(a.hint, `${name} 缺颜色提示`).toBeTruthy();
      const h = a.hint!;
      expect(h.blueMax, name).toBeLessThanOrEqual(h.pinkMin);
      expect(h.pinkMin, name).toBeLessThanOrEqual(h.pinkMax);
      if (h.red !== null) expect(h.pinkMax, name).toBeLessThanOrEqual(h.red);
      // 社区档位表的首末值应与官方区间一致（自洽性校验）
      expect(h.red ?? a.max, name).toBe(a.max);
      expect(a.min, name).toBeLessThanOrEqual(h.blueMax);
    }
  });

  it('默认 10 级强化模型：一阶/二阶 = 官方值×5，三阶 = 官方值（固定）', () => {
    expect(TREASURE_SLOT_STEPS).toEqual({ 1: 5, 2: 5, 3: 0 });
    for (const t of TREASURES) {
      for (const e of t.effects) {
        const v = treasureEffectValue(e, 10);
        if (e.slot === 3) expect(v, `${t.name}·${e.name}`).toBeCloseTo(e.value, 6);
        else expect(v, `${t.name}·${e.name}`).toBeCloseTo(e.value * 5, 6);
      }
      // 一阶在 1 级 = ×1、5 级 = ×5；二阶在 5 级 = ×0（刚解锁）、10 级 = ×5
      const s1 = t.effects.find((e) => e.slot === 1)!;
      expect(treasureEffectValue(s1, 1)).toBeCloseTo(s1.value, 6);
      expect(treasureEffectValue(s1, 5)).toBeCloseTo(s1.value * 5, 6);
      const s2 = t.effects.find((e) => e.slot === 2);
      if (s2) {
        expect(treasureEffectValue(s2, 5), `${t.name}·${s2.name} 五级未强化`).toBe(0);
        expect(treasureEffectValue(s2, 10)).toBeCloseTo(s2.value * 5, 6);
      }
    }
  });
});
