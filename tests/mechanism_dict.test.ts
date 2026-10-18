import { describe, expect, it } from 'vitest';

import {
  EXCLUDED_MECHANISMS,
  MECHANISM_DICT,
  mechanismCodesOf,
  mechanismName,
  mechanismNamesOf,
  mechanismsOfFamily,
  SKILL_MECHANISMS,
  slotCountOf,
} from '../src/data/mechanisms';
import { SKILL_REGISTRY } from '../src/data/skills';

/**
 * 机制字典（`src/data/mechanisms.ts`）—— 客户端资源表数据层登记。
 *
 * ⚠️ 文件名注意：`tests/mechanisms.test.ts` 是既有的「指挥战法一二类机制」契约测试，
 * 本文件是**另一件事**（机制字典数据自洽），命名上刻意错开，勿合并。
 *
 * 数据源：客户端资源表静态解析
 *        （机制表 206 条，名字池下标取自每条 24 字节记录的 payload offset 11；
 *         槽位表 12,694 条，取每条的 f0 机制码）
 *
 * 锚点值是拿官方 desc 逐条对出来的（例：101 的战法 desc 都写「攻击属性提高」），
 * **改动这些断言前请先复核官方 desc**，别跟着现状走 —— 本项目历史上就因
 * 「字符串顺序 = 键顺序」的错误对齐，把 101 读成「受兵种伤害-」并写进了断言。
 */
describe('机制字典结构（客户端资源表静态解析）', () => {
  it('206 条，机制码唯一且升序', () => {
    expect(MECHANISM_DICT.length).toBe(206);
    const codes = MECHANISM_DICT.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect(codes[0]).toBe(77);
    expect(codes[codes.length - 1]).toBe(952);
  });

  it('除 77（记录里名字下标为 0）外机制名全部非空', () => {
    const empty = MECHANISM_DICT.filter((m) => !m.name.trim()).map((m) => m.code);
    expect(empty).toEqual([77]);
  });

  it('场景后缀只有 预备 / 设施 / 空，数量为 19 / 13 / 174', () => {
    for (const m of MECHANISM_DICT) expect(['', '预备', '设施']).toContain(m.scene);
    expect(MECHANISM_DICT.filter((m) => m.scene === '预备').length).toBe(19);
    expect(MECHANISM_DICT.filter((m) => m.scene === '设施').length).toBe(13);
    expect(MECHANISM_DICT.filter((m) => m.scene === '').length).toBe(174);
  });

  it('族划分：0xx 9 条 / 1xx 42 条 / 2xx 22 条', () => {
    expect(mechanismsOfFamily(0).length).toBe(9);
    expect(mechanismsOfFamily(100).length).toBe(42);
    expect(mechanismsOfFamily(200).length).toBe(22);
  });

  it('锚点（与官方 desc 逐条核对过）：98/99 受兵种伤害、103 谋略属性提高、402 休整、122 子技能', () => {
    expect(mechanismName(98)).toBe('受兵种伤害+');
    expect(mechanismName(99)).toBe('受兵种伤害-');
    expect(mechanismName(101)).toBe('攻击属性提高');
    expect(mechanismName(102)).toBe('防御属性提高');
    expect(mechanismName(103)).toBe('谋略属性提高');
    expect(mechanismName(104)).toBe('速度属性提高');
    expect(mechanismName(122)).toBe('子技能（有益）');
    expect(mechanismName(301)).toBe('攻击伤害');
    expect(mechanismName(402)).toBe('休整');
    expect(mechanismName(531)).toBe('攻击伤害提高');
  });

  it('未知机制码不抛异常，退化为 #<code>', () => {
    expect(mechanismName(9999)).toBe('#9999');
  });
});

describe('攻城属性不实装（引擎无此维度）', () => {
  it('EXCLUDED_MECHANISMS = [105, 205]，字典里如实保留并标 excluded', () => {
    expect([...EXCLUDED_MECHANISMS].sort((a, b) => a - b)).toEqual([105, 205]);
    const byCode = new Map(MECHANISM_DICT.map((m) => [m.code, m]));
    expect(byCode.get(105)?.name).toBe('攻城属性提高');
    expect(byCode.get(205)?.name).toBe('攻城属性降低');
    expect(byCode.get(105)?.excluded).toBe(true);
    expect(byCode.get(205)?.excluded).toBe(true);
    // 其余条目不得误标
    expect(MECHANISM_DICT.filter((m) => m.excluded).map((m) => m.code)).toEqual([105, 205]);
  });

  it('挂载里不出现攻城属性码（战法跳过生效）', () => {
    const leaked: string[] = [];
    for (const [skillId, m] of Object.entries(SKILL_MECHANISMS)) {
      for (const code of Object.keys(m)) {
        if (EXCLUDED_MECHANISMS.includes(Number(code))) leaked.push(`${skillId}:${code}`);
      }
    }
    expect(leaked).toEqual([]);
  });
});

describe('战法机制码挂载', () => {
  it('每个挂载键都是 SKILL_REGISTRY 里真实存在的战法（防漂移）', () => {
    const missing = Object.keys(SKILL_MECHANISMS).filter((id) => !(id in SKILL_REGISTRY));
    expect(missing).toEqual([]);
  });

  it(`覆盖全部已实现战法（${Object.keys(SKILL_MECHANISMS).length}/${Object.keys(SKILL_REGISTRY).length}，桥接链 = skills.ts 自带的 name）`, () => {
    expect(Object.keys(SKILL_MECHANISMS).length).toBe(Object.keys(SKILL_REGISTRY).length);
  });

  it('每个机制码都能在字典里查到（无野码）', () => {
    const dictCodes = new Set(MECHANISM_DICT.map((m) => m.code));
    const bad: string[] = [];
    for (const [skillId, m] of Object.entries(SKILL_MECHANISMS)) {
      for (const code of Object.keys(m)) {
        if (!dictCodes.has(Number(code))) bad.push(`${skillId}:${code}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('槽位数全部为正整数', () => {
    for (const m of Object.values(SKILL_MECHANISMS)) {
      for (const n of Object.values(m)) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    }
  });

  it('查询 API：未收录战法返回空数组而不抛错', () => {
    expect(mechanismCodesOf('__不存在__')).toEqual([]);
    expect(mechanismNamesOf('__不存在__')).toEqual([]);
    expect(slotCountOf('__不存在__')).toBe(0);
  });

  it('查询 API：已收录战法按机制码升序返回，名字可读', () => {
    const ids = Object.keys(SKILL_MECHANISMS);
    expect(ids.length).toBeGreaterThan(150);
    const sample = ids[0];
    const codes = mechanismCodesOf(sample);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect(codes.length).toBeGreaterThan(0);
    expect(mechanismNamesOf(sample).length).toBe(codes.length);
    expect(slotCountOf(sample)).toBeGreaterThan(0);
  });

  it('语义抽查：列营守险 = 四维属性提高 + 规避(预备)；疮痍累身 = 受攻击/受策略减伤两条', () => {
    expect(mechanismCodesOf('lieying_shouxian')).toEqual([101, 102, 103, 104, 122, 714]);
    expect(mechanismName(714)).toBe('规避');
    const chuangyi = mechanismNamesOf('chuangyi_leishen');
    expect(chuangyi).toContain('受到攻击伤害降低');
    expect(chuangyi).toContain('受到策略攻击伤害降低');
  });

  it('冲突类型：206 条全覆盖、取值域 0/1/2/3，分布 30 / 15 / 57 / 104', () => {
    for (const m of MECHANISM_DICT) {
      expect([0, 1, 2, 3], `机制 ${m.code} ${m.name} 的冲突类型越界`).toContain(m.conflictType);
    }
    const dist: Record<number, number> = {};
    for (const m of MECHANISM_DICT) dist[m.conflictType] = (dist[m.conflictType] ?? 0) + 1;
    expect(dist).toEqual({ 0: 30, 1: 15, 2: 57, 3: 104 });
  });

  it('冲突类型锚点（与客户端资源表逐条对拍）：0 = 属性替换 · 1 = 任何效果都不冲突 · 2/3 = 效果不叠加（数值档/状态档）', () => {
    const ct = (code: number) => MECHANISM_DICT.find((m) => m.code === code)!.conflictType;
    expect(ct(101)).toBe(0); // 攻击属性提高——属性替换（新数值替换旧数值）
    expect(ct(401)).toBe(0); // 急救——同为单值效果
    expect(ct(77)).toBe(1); // 标记——任何效果都不冲突
    expect(ct(322)).toBe(2); // 主动战法伤害提高——效果不叠加·数值档
    expect(ct(514)).toBe(3); // 规避——效果不叠加·状态档（先施加者生效）
  });

  it('冲突类型 3（效果不叠加·状态档）：规避 / 控制 / 免疫 / 状态开关全族一致', () => {
    const ct = (code: number) => MECHANISM_DICT.find((m) => m.code === code)!.conflictType;
    // 规避 / 无视规避（含预备 · 设施场景变体）
    for (const code of [514, 714, 814, 515, 715, 815]) expect(ct(code), `码 ${code}`).toBe(3);
    // 控制（混乱 / 犹豫 / 暴走 / 援护 / 挑衅 / 怯战）
    for (const code of [501, 502, 503, 504, 505, 552]) expect(ct(code), `码 ${code}`).toBe(3);
    // 免疫与免疫破除（抵御 / 洞察 / 看破 / 镇静）
    for (const code of [118, 511, 512, 513]) expect(ct(code), `码 ${code}`).toBe(3);
    // 状态开关（连击 / 同心 / 先攻 / 连击 / 分兵 / 反击）
    for (const code of [200, 409, 543, 544, 545, 551]) expect(ct(code), `码 ${code}`).toBe(3);
  });
});
