/**
 * 阵容预设存档单测（纯逻辑，无 DOM）。
 * 覆盖：编号递增/持久化往返/同边同名覆盖/异边同名独立/搜索（用户例子）/上限/坏数据容错/深拷贝隔离。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { SlotState } from './teamEditor';
import {
  PRESET_MAX,
  PRESET_STORAGE_KEY,
  addPreset,
  cloneSlots,
  defaultStorage,
  findPreset,
  heroCount,
  nameError,
  normalizeName,
  overwritePreset,
  readPresetFile,
  removePreset,
  renamePreset,
  searchPresets,
  writePresetFile,
  type PresetFile,
  type PresetStorage,
  type TeamSide,
} from './presetStore';

/** 内存存储（单测不依赖 jsdom localStorage 的跨用例残留） */
function memStorage(seed?: string): PresetStorage & { dump: () => string | null } {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(PRESET_STORAGE_KEY, seed);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    dump: () => map.get(PRESET_STORAGE_KEY) ?? null,
  };
}

/** 造槽位（只填关键字段，其余用默认） */
function slot(heroId: string | null, skills: string[] = [], free: Partial<SlotState['freePoints']> = {}): SlotState {
  return {
    heroId,
    extraSkillIds: skills,
    freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0, ...free },
    redness: 0,
    level: 40,
    treasure: null,
  };
}

/** 一支三将队伍（魏智示例：曹操/荀彧/郭嘉） */
const weiTeam = (skills: string[] = ['hun_luan', 'shen_mou']): SlotState[] => [
  slot('h101', [], { strategy: 10 }),
  slot('h102', skills),
  slot('h103'),
];

const save = (file: PresetFile, name: string, side: TeamSide = 'red', slots = weiTeam(), now = 1000) => {
  const r = addPreset(file, { name, side, slots, now });
  if (!r) throw new Error('save failed');
  return r;
};

describe('presetStore · 保存与编号', () => {
  it('新增预设：编号从 1 递增，第二条为 2', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(), 1000);
    expect(a.replaced).toBe(false);
    expect(a.preset.no).toBe(1);
    const b = save(a.file, '战磐魏智', 'red', weiTeam(), 2000);
    expect(b.preset.no).toBe(2);
    expect(b.file.list.map((p) => p.no)).toEqual([1, 2]);
  });

  it('持久化往返：写盘后读回编号/名字/边/槽位一致', () => {
    const st = memStorage();
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'blue', weiTeam(['a_skill', 'b_skill']), 1000);
    expect(writePresetFile(a.file, st)).toBe(true);
    const back = readPresetFile(st);
    expect(back.maxNo).toBe(1);
    expect(back.list).toHaveLength(1);
    expect(back.list[0]).toMatchObject({ no: 1, name: '双减魏智', side: 'blue' });
    expect(back.list[0].slots[1].extraSkillIds).toEqual(['a_skill', 'b_skill']);
    expect(back.list[0].slots[0].freePoints.strategy).toBe(10);
  });

  it('未配置任何武将（全空槽）也能存：heroCount 用于上层提示，不进存档校验', () => {
    const empty = [slot(null), slot(null), slot(null)];
    expect(heroCount(empty)).toBe(0);
    const a = save({ maxNo: 0, list: [] }, '空队', 'red', empty, 1000);
    expect(a.preset.slots.map((s) => s.heroId)).toEqual([null, null, null]);
  });
});

describe('presetStore · 覆盖与编号稳定', () => {
  it('同边同名 → 覆盖：编号不变、槽位更新、条数不增、replaced=true', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(['s1']), 1000);
    const b = save(a.file, '双减魏智', 'red', weiTeam(['s2', 's3']), 3000);
    expect(b.replaced).toBe(true);
    expect(b.preset.no).toBe(1);
    expect(b.preset.createdAt).toBe(1000);
    expect(b.preset.updatedAt).toBe(3000);
    expect(b.file.list).toHaveLength(1);
    expect(b.file.list[0].slots[1].extraSkillIds).toEqual(['s2', 's3']);
  });

  it('同名但不同边 → 两条独立预设（红蓝同名互不覆盖）', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(), 1000);
    const b = save(a.file, '双减魏智', 'blue', weiTeam(), 2000);
    expect(b.replaced).toBe(false);
    expect(b.file.list).toHaveLength(2);
    expect(b.file.list.map((p) => p.side)).toEqual(['red', 'blue']);
  });

  it('名字前后空白/中间多空格视为同名（覆盖）', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(), 1000);
    const b = save(a.file, '  双减 魏智 ', 'red', weiTeam(), 2000);
    expect(b.replaced).toBe(true);
    expect(b.preset.name).toBe('双减 魏智');
    expect(b.file.list).toHaveLength(1);
  });

  it('删除后编号不回填：删掉 #2 再存新预设得 #3（水位保留）', () => {
    const a = save({ maxNo: 0, list: [] }, 'A', 'red', weiTeam(), 1000);
    const b = save(a.file, 'B', 'red', weiTeam(), 2000);
    const del = removePreset(b.file, b.preset.id);
    expect(del.list.map((p) => p.no)).toEqual([1]);
    expect(del.maxNo).toBe(2);
    const c = save(del, 'C', 'red', weiTeam(), 3000);
    expect(c.preset.no).toBe(3);
  });

  it('上限 50：满了新增返回 null，覆盖已有预设不受限', () => {
    let file: PresetFile = { maxNo: 0, list: [] };
    for (let i = 0; i < PRESET_MAX; i++) file = save(file, `队伍${i + 1}`, 'red', weiTeam(), 1000 + i).file;
    expect(file.list).toHaveLength(PRESET_MAX);
    expect(addPreset(file, { name: '第51条', side: 'red', slots: weiTeam() })).toBeNull();
    const over = addPreset(file, { name: '队伍1', side: 'red', slots: weiTeam(['x']) });
    expect(over?.replaced).toBe(true);
    expect(over?.file.list).toHaveLength(PRESET_MAX);
  });
});

describe('presetStore · 搜索（用户场景）', () => {
  let file: PresetFile;
  beforeEach(() => {
    file = { maxNo: 0, list: [] };
    file = save(file, '双减魏智', 'red', weiTeam(['skill_a']), 1000).file;
    file = save(file, '战磐魏智', 'red', weiTeam(['skill_b']), 2000).file;
    file = save(file, '马超蜀骑', 'blue', [slot('h200'), slot('h201'), slot('h202')], 3000).file;
  });

  it('搜「魏智」命中两支同名套路不同战法的队伍', () => {
    const hit = searchPresets(file.list, '魏智');
    expect(hit.map((p) => p.name)).toEqual(['双减魏智', '战磐魏智']);
  });

  it('搜索忽略大小写与空白；无命中返回空数组；空查询返回全部（编号升序）', () => {
    expect(searchPresets(file.list, ' 魏  智 ').map((p) => p.no)).toEqual([1, 2]);
    expect(searchPresets(file.list, 'SP 赵云')).toEqual([]);
    expect(searchPresets(file.list, '   ').map((p) => p.no)).toEqual([1, 2, 3]);
  });

  it('支持按编号搜（#2 / 2）与按武将名搜（heroNameOf）', () => {
    expect(searchPresets(file.list, '#2').map((p) => p.name)).toEqual(['战磐魏智']);
    expect(searchPresets(file.list, '2').map((p) => p.name)).toEqual(['战磐魏智']);
    const nameOf = (id: string) => ({ h101: '曹操', h102: '荀彧', h103: '郭嘉', h200: '马超', h201: '关羽', h202: '张飞' })[id] ?? '';
    expect(searchPresets(file.list, '郭嘉', nameOf).map((p) => p.name)).toEqual(['双减魏智', '战磐魏智']);
    expect(searchPresets(file.list, '张飞', nameOf).map((p) => p.name)).toEqual(['马超蜀骑']);
  });
});

describe('presetStore · 命名校验与重命名', () => {
  it('空名/纯空白 → nameError 提示；addPreset 也不接受空名', () => {
    expect(nameError('   ', { maxNo: 0, list: [] }, 'red')).toBe('预设名不能为空');
    expect(normalizeName(' 减 魏 ')).toBe('减 魏');
    expect(addPreset({ maxNo: 0, list: [] }, { name: '  ', side: 'red', slots: weiTeam() })).toBeNull();
  });

  it('同边同名 → nameError 拦下；不同边同名放行；excludeId 让「改回自己名字」放行', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(), 1000);
    expect(nameError('双减魏智', a.file, 'red')).toContain('已有同名预设');
    expect(nameError('双减魏智', a.file, 'blue')).toBeNull();
    expect(nameError('双减 魏智', a.file, 'red', a.preset.id)).toBeNull();
  });

  it('重命名：改名成功且保留编号；空名/找不到时原样返回', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(), 1000);
    const renamed = renamePreset(a.file, a.preset.id, '双减魏智·改', 5000);
    expect(renamed.list[0]).toMatchObject({ no: 1, name: '双减魏智·改', updatedAt: 5000 });
    expect(renamePreset(a.file, a.preset.id, '  ')).toBe(a.file);
    expect(renamePreset(a.file, 'not_exist', 'X').list).toHaveLength(1);
  });

  it('覆盖为当前配置：编号/名字/创建时间不变，槽位换成新的', () => {
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', weiTeam(['old']), 1000);
    const next = overwritePreset(a.file, a.preset.id, weiTeam(['new1', 'new2']), 9000);
    expect(next.list[0]).toMatchObject({ no: 1, name: '双减魏智', createdAt: 1000, updatedAt: 9000 });
    expect(next.list[0].slots[1].extraSkillIds).toEqual(['new1', 'new2']);
    expect(findPreset(next, a.preset.id)?.slots[1].extraSkillIds).toEqual(['new1', 'new2']);
  });
});

describe('presetStore · 容错与隔离', () => {
  it('坏 JSON / 空存储 → 空存档，不抛异常', () => {
    expect(readPresetFile(memStorage('{不是 JSON')).list).toEqual([]);
    expect(readPresetFile(memStorage()).list).toEqual([]);
    expect(readPresetFile(null).list).toEqual([]);
  });

  it('结构损坏：丢弃坏条目、修正越界字段（红度/等级/多余战法）', () => {
    const raw = JSON.stringify({
      maxNo: 7,
      list: [
        { id: 'ok', no: 3, name: '好条目', side: 'blue', slots: [{ heroId: 'h1', extraSkillIds: ['a', 'b', 'c'], freePoints: { attack: -5, speed: 'x' }, redness: 99, level: 999 }], createdAt: 1, updatedAt: 2 },
        { no: 4, name: '缺 id', slots: [] },
        { id: 'noname', no: 5, name: '   ', slots: [] },
        'not-an-object',
      ],
    });
    const file = readPresetFile(memStorage(raw));
    expect(file.list.map((p) => p.id)).toEqual(['ok']);
    const s = file.list[0].slots[0];
    expect(s.extraSkillIds).toEqual(['a', 'b']);
    expect(s.freePoints).toMatchObject({ attack: 0, speed: 0 });
    expect(s.redness).toBe(5);
    expect(s.level).toBe(50);
    expect(file.list[0].slots).toHaveLength(3); // 不足 3 槽补齐空槽
    expect(file.list[0].slots[2].heroId).toBeNull();
    expect(file.maxNo).toBe(7);
  });

  it('写盘失败（存储不可用/抛异常）→ 返回 false，不抛', () => {
    expect(writePresetFile({ maxNo: 1, list: [] }, null)).toBe(false);
    const boom: PresetStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(writePresetFile({ maxNo: 1, list: [] }, boom)).toBe(false);
  });

  it('深拷贝隔离：改配将区槽位不动已存预设，改预设也不动源对象', () => {
    const src = weiTeam(['s1']);
    const a = save({ maxNo: 0, list: [] }, '双减魏智', 'red', src, 1000);
    src[1].extraSkillIds.push('后加的战法');
    src[0].freePoints.strategy = 999;
    expect(a.preset.slots[1].extraSkillIds).toEqual(['s1']);
    expect(a.preset.slots[0].freePoints.strategy).toBe(10);
    const cloned = cloneSlots(a.preset.slots);
    cloned[0].freePoints.strategy = 1;
    expect(a.preset.slots[0].freePoints.strategy).toBe(10);
  });

  it('默认存储 = localStorage（jsdom 环境可用）', () => {
    const st = defaultStorage();
    expect(st).not.toBeNull();
    st!.setItem(PRESET_STORAGE_KEY, '');
    expect(readPresetFile().list).toEqual([]);
  });
});
