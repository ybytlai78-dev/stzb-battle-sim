import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  alignHeroes,
  alignSkill,
  diffHero,
  diffSkill,
  engineFingerprint,
  fingerprint,
  pkgFingerprint,
  SKILL_TYPE_TO_ENGINE,
  type FieldDiff,
} from '../scripts/rag/diff.mts';
import { readFileSync } from 'node:fs';

type Row = Record<string, any>;

const pkgRow = (heroid: number, name: string, o: Partial<Row> = {}): Row => ({
  heroid,
  name,
  country: 3,
  hero_type: 3,
  hit_range: 3,
  quality: 4,
  cost: 25,
  attack_base: 8800,
  defence_base: 8100,
  intel_base: 3000,
  speed_base: 7300,
  attack_grow: 148,
  defence_grow: 136,
  intel_grow: 40,
  speed_grow: 58,
  skill_init: 200001,
  ...o,
});

const engineRow = (id: string, name: string, o: Partial<Row> = {}): Row => ({
  id,
  name,
  rarity: '5星',
  cost: 2.5,
  faction: '蜀',
  troopType: 'cavalry',
  attackRange: 3,
  baseAttack: 88,
  baseDefense: 81,
  baseStrategy: 30,
  baseSpeed: 73,
  growthAttack: 1.48,
  growthDefense: 1.36,
  growthStrategy: 0.4,
  growthSpeed: 0.58,
  mainSkillId: 'x',
  mainSkillName: '某战法',
  ...o,
});

describe('指纹', () => {
  it('抹平包内 ×100 整数与引擎小数的表示差异', () => {
    expect(fingerprint([1.48, 1.36])).toBe(fingerprint([148 / 100, 136 / 100]));
  });

  it('引擎侧与包内同面板得到同一指纹', () => {
    const h = engineRow('h1', '甲');
    const p = pkgRow(1, '甲');
    expect(engineFingerprint(h)).toBe(pkgFingerprint(p));
  });

  it('面板不同则指纹不同', () => {
    expect(engineFingerprint(engineRow('h1', '甲'))).not.toBe(engineFingerprint(engineRow('h2', '乙', { baseAttack: 89 })));
  });
});

describe('alignHeroes', () => {
  const pkg = [
    pkgRow(100494, '祝融夫人', { country: 5 }),
    pkgRow(102016, '祝融夫人', { country: 3 }),
    pkgRow(130494, '祝融夫人', { country: 5 }),
    pkgRow(132016, '祝融夫人', { country: 3 }),
  ];

  it('id 与 heroid 同号时直配（SP 版与普通版同面板也能挑对）', () => {
    const engine = [engineRow('h102016', '祝融夫人', { faction: '群' }), engineRow('h494', '祝融夫人', { faction: '群' })];
    const m = alignHeroes(engine, pkg);
    expect(m.get('h102016')).toBe(102016);
    expect(m.get('h494')).toBe(100494); // 包内没有 494 ⇒ 走指纹候选，13xxxx 副本被降权后落到主记录
  });

  it('id 直配要求旁证：包内同号是别人时不用它', () => {
    const other = [pkgRow(900, '完全不同的武将', { attack_base: 100 })];
    const m = alignHeroes([engineRow('h900', '甲')], other);
    expect(m.get('h900')).toBe(null);
  });

  it('主战法名优先于 heroid 升序（sp 类引擎 id 无数字可用）', () => {
    const skills = new Map<number, string>([
      [200001, '银龙冲阵'],
      [200002, '银龙孤胆'],
    ]);
    const p = [pkgRow(100021, '赵云', { skill_init: 200001 }), pkgRow(102001, '赵云', { skill_init: 200002 })];
    const m = alignHeroes([engineRow('sp_zhaoyun', '赵云', { mainSkillName: '银龙孤胆' })], p, skills);
    expect(m.get('sp_zhaoyun')).toBe(102001);
  });

  it('同分时重复段 13xxxx 降权，落到主记录', () => {
    const p = [pkgRow(130001, '甲'), pkgRow(100001, '甲')];
    const m = alignHeroes([engineRow('x1', '甲')], p);
    expect(m.get('x1')).toBe(100001);
  });

  it('包内无同面板记录时返回 null', () => {
    const m = alignHeroes([engineRow('x1', '孤儿', { baseAttack: 1, baseDefense: 1, baseStrategy: 1, baseSpeed: 1 })], pkg);
    expect(m.get('x1')).toBe(null);
  });
});

describe('diffHero', () => {
  const skills = new Map<number, string>([[200001, '某战法']]);

  it('全同则无差异', () => {
    expect(diffHero(engineRow('h1', '甲'), pkgRow(1, '甲'), skills)).toEqual([]);
  });

  it('数值差异带双侧坐标，便于回查', () => {
    const diffs: FieldDiff[] = diffHero(engineRow('h1', '甲', { baseAttack: 97 }), pkgRow(1, '甲'), skills);
    const d = diffs.find((x) => x.field === '攻击');
    expect(d).toBeDefined();
    expect(d!.engine).toBe('97.00');
    expect(d!.pkg).toBe('88.00');
    expect(d!.engineAt).toBe('web/data/heroes.json/h1/攻击');
    expect(d!.pkgAt).toBe('@pkg:tb_cfg_hero/1/attack_base');
  });

  it('势力按 country 枚举换算后比较', () => {
    const diffs = diffHero(engineRow('h1', '甲', { faction: '群' }), pkgRow(1, '甲', { country: 3 }), skills);
    expect(diffs.map((d) => d.field)).toEqual(['势力']);
  });

  it('兵种按 hero_type 枚举换算后比较', () => {
    expect(diffHero(engineRow('h1', '甲', { troopType: 'archer' }), pkgRow(1, '甲'), skills).map((d) => d.field)).toEqual(['兵种']);
  });

  it('统率占位值（cost ≥ 100）标成未设置，不参与数值换算', () => {
    const diffs = diffHero(engineRow('h1', '甲'), pkgRow(1, '甲', { cost: 200 }), skills);
    const d = diffs.find((x) => x.field === '统率');
    expect(d!.pkg).toBe('未设置(200)'); // 占位值不换算，保留原始值
  });
});

describe('真实包内数据（解包目录不存在时跳过）', () => {
  const P = 'C:/Users/lai15/Desktop/rea_stzb/dec/json';
  const ready = existsSync(`${P}/tb_cfg_hero.json`) && existsSync('web/data/heroes.json');

  it.skipIf(!ready)('170 条引擎武将全部有归属：一致 + 差异 + 引擎独有 = 170', () => {
    const rows = (p: string): Row[] => Object.values(JSON.parse(readFileSync(p, 'utf8')).rows ?? {}) as Row[];
    const pkg = rows(`${P}/tb_cfg_hero.json`);
    const skillNameById = new Map<number, string>(
      rows(`${P}/tb_cfg_skill.json`).map((s) => [Number(s.skill_id), String(s.name ?? '')])
    );
    const engine = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as Row[];
    const align = alignHeroes(engine, pkg, skillNameById);
    expect(align.size).toBe(engine.length);
    for (const h of engine) expect(align.get(String(h.id)) === null || typeof align.get(String(h.id)) === 'number').toBe(true);
  });

  it.skipIf(!ready)('许褚与刘秀在包内无同面板记录（引擎独有，来源待登记）', () => {
    const rows = (p: string): Row[] => Object.values(JSON.parse(readFileSync(p, 'utf8')).rows ?? {}) as Row[];
    const pkg = rows(`${P}/tb_cfg_hero.json`);
    const engine = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as Row[];
    const align = alignHeroes(engine, pkg);
    for (const id of ['h840', 'h841']) {
      expect(engine.some((h) => String(h.id) === id)).toBe(true);
      expect(align.get(id)).toBe(null);
    }
  });
});

const pkgSkill = (skill_id: number, name: string, o: Partial<Row> = {}): Row => ({
  skill_id,
  name,
  skill_type: 3,
  hit_range: 5,
  probability_init: 35,
  probability_max: 35,
  prepare: 0,
  skill_quality_level: 'S',
  ...o,
});

const engineSkill = (id: string, name: string, o: Partial<Row> = {}): Row => ({
  id,
  name,
  type: 'active',
  range: 5,
  triggerRate: 0.35,
  prepare: false,
  ...o,
});

describe('alignSkill', () => {
  const byName = (rows: Row[]): Map<string, Row[]> => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r.name).trim();
      const cur = m.get(k);
      if (cur) cur.push(r);
      else m.set(k, [r]);
    }
    return m;
  };

  it('同名多条时用战法类型收敛', () => {
    const m = byName([pkgSkill(1, '甲', { skill_type: 1 }), pkgSkill(2, '甲', { skill_type: 3 })]);
    expect(alignSkill(engineSkill('x', '甲'), m).pkg?.skill_id).toBe(2);
  });

  it('类型分不开时再用攻击距离收敛', () => {
    const m = byName([pkgSkill(1, '甲', { hit_range: 4 }), pkgSkill(2, '甲', { hit_range: 5 })]);
    expect(alignSkill(engineSkill('x', '甲', { range: 5 }), m).pkg?.skill_id).toBe(2);
  });

  it('再分不开时用发动率收敛', () => {
    const m = byName([pkgSkill(1, '甲', { probability_max: 25 }), pkgSkill(2, '甲', { probability_max: 35 })]);
    expect(alignSkill(engineSkill('x', '甲', { triggerRate: 0.35 }), m).pkg?.skill_id).toBe(2);
  });

  it('收敛不到唯一时取 skill_id 最小并标 ambiguous', () => {
    const r = alignSkill(engineSkill('x', '甲'), byName([pkgSkill(9, '甲'), pkgSkill(3, '甲')]));
    expect(r.pkg?.skill_id).toBe(3);
    expect(r.ambiguous).toBe(true);
  });

  it('包内无同名返回 null 与候选 0', () => {
    expect(alignSkill(engineSkill('x', '不存在'), byName([pkgSkill(1, '甲')]))).toMatchObject({ pkg: null, candidates: 0 });
  });
});

describe('diffSkill', () => {
  it('全同则无差异', () => {
    expect(diffSkill(engineSkill('x', '甲'), pkgSkill(1, '甲'))).toEqual([]);
  });

  it('战法类型比对方向正确：引擎位放引擎值', () => {
    const d = diffSkill(engineSkill('x', '甲', { type: 'command' }), pkgSkill(1, '甲', { skill_type: 1 }));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: '战法类型', engine: 'command', pkg: 'passive' });
    expect(d[0].pkgAt).toBe('@pkg:tb_cfg_skill/1/skill_type');
  });

  it('追击战法不比攻击距离（包内 hit_range 6 是哨兵，引擎用 0）', () => {
    const d = diffSkill(engineSkill('x', '甲', { type: 'pursuit', range: 0 }), pkgSkill(1, '甲', { skill_type: 4, hit_range: 6 }));
    expect(d).toEqual([]);
  });

  it('发动率 ≥100 归一为必定发动，120 与 100% 不算差异', () => {
    const d = diffSkill(engineSkill('x', '甲', { triggerRate: 1 }), pkgSkill(1, '甲', { probability_max: 120 }));
    expect(d).toEqual([]);
  });

  it('发动率差异照实报（引擎 40% vs 包内 35%）', () => {
    const d = diffSkill(engineSkill('x', '甲', { triggerRate: 0.4 }), pkgSkill(1, '甲', { probability_max: 35 }));
    expect(d[0]).toMatchObject({ field: '发动率%', engine: 40, pkg: 35 });
  });

  it('枚举表覆盖包内四种战法类型', () => {
    expect(Object.keys(SKILL_TYPE_TO_ENGINE)).toEqual(['1', '2', '3', '4']);
    expect(SKILL_TYPE_TO_ENGINE[4]).toEqual(['pursuit']);
  });
});
