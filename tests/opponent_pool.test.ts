/**
 * 对手池：固定测试集删不掉，用户只能增删自己从预设加进去的队伍。
 */
import { describe, expect, it } from 'vitest';
import {
  EXTRA_POOL_KEY,
  LEGACY_POOL_KEY,
  addPresetIdToPool,
  addPresetToPool,
  loadBenchmark,
  loadMergedPool,
  poolFingerprint,
  removeUserOpponent,
  upsertUserEntry,
} from '../web/opponentPool';
import { PRESET_STORAGE_KEY, writePresetFile, type TeamPreset } from '../web/presetStore';
import type { SlotState } from '../web/teamEditor';

class Mem {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function slot(heroId: string): SlotState {
  return {
    heroId,
    extraSkillIds: [],
    freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
    redness: 0,
    level: 40,
    treasure: null,
  };
}

function preset(id = 'p1', name = '测试队'): TeamPreset {
  return {
    id,
    no: 1,
    name,
    side: 'red',
    slots: [slot('h443'), slot('h474'), slot('lvmeng')],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('对手池合并', () => {
  it('固定集在前，删不掉；用户条目能加能移', () => {
    const storage = new Mem();
    const bench = loadBenchmark();
    expect(bench.length).toBeGreaterThan(0);
    const added = addPresetToPool(preset(), storage);
    expect(added.ok).toBe(true);
    const merged = loadMergedPool(storage);
    expect(merged.entries[0]?.source).toBe('benchmark');
    expect(merged.entries.at(-1)?.source).toBe('user');
    expect(merged.entries.at(-1)?.presetId).toBe('p1');
    expect(poolFingerprint(merged)).toBe(`${merged.version}|${added.entry?.id}`);

    const blocked = removeUserOpponent(bench[0].id, storage);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain('不能删除');
    expect(loadMergedPool(storage).entries.some((e) => e.id === bench[0].id)).toBe(true);

    const removed = removeUserOpponent(added.entry?.id ?? '', storage);
    expect(removed.ok).toBe(true);
    expect(loadMergedPool(storage).entries.every((e) => e.source === 'benchmark')).toBe(true);
  });

  it('同预设再加入是覆盖，不满 3 将拒绝', () => {
    const storage = new Mem();
    addPresetToPool(preset(), storage);
    const again = addPresetToPool(preset('p1', '改名后'), storage);
    expect(again.ok).toBe(true);
    expect(again.message).toContain('更新');
    expect(loadMergedPool(storage).entries.filter((e) => e.source === 'user')).toHaveLength(1);
    expect(loadMergedPool(storage).entries.find((e) => e.source === 'user')?.note).toBe('改名后');

    const short = preset('p2', '缺人');
    short.slots[2] = { ...short.slots[2], heroId: null };
    expect(addPresetToPool(short, storage).ok).toBe(false);
  });

  it('按预设 id 加入，和手写预设文件同一把存储', () => {
    const storage = new Mem();
    writePresetFile({ maxNo: 1, list: [preset()] }, storage);
    expect(storage.getItem(PRESET_STORAGE_KEY)).toBeTruthy();
    const res = addPresetIdToPool('p1', storage);
    expect(res.ok).toBe(true);
    expect(addPresetIdToPool('missing', storage).ok).toBe(false);
  });

  it('旧 L4 池子迁入时，备注与固定集相同的不重复', () => {
    const storage = new Mem();
    const bench = loadBenchmark()[0];
    storage.setItem(
      LEGACY_POOL_KEY,
      JSON.stringify([
        { id: bench.id, note: bench.note, cfg: bench.cfg },
        { id: 'old-user', note: '我的另一队', cfg: bench.cfg },
      ]),
    );
    expect(storage.getItem(EXTRA_POOL_KEY)).toBeNull();
    const merged = loadMergedPool(storage);
    expect(merged.entries.filter((e) => e.note === bench.note)).toHaveLength(1);
    expect(merged.entries.filter((e) => e.source === 'benchmark')[0]?.id).toBe(bench.id);
    expect(merged.entries.some((e) => e.note === '我的另一队' && e.source === 'user')).toBe(true);
    expect(storage.getItem(EXTRA_POOL_KEY)).toContain('我的另一队');
  });

  it('upsert 拒绝改固定集', () => {
    const storage = new Mem();
    const bench = loadBenchmark()[0];
    const res = upsertUserEntry({ ...bench, note: '被改掉' }, storage);
    expect(res.ok).toBe(false);
    expect(loadMergedPool(storage).entries[0]?.note).toBe(bench.note);
  });
});
