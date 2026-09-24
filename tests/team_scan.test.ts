/**
 * 截图识别 · 敌对队伍集：校验规则（spec：docs/截图识别-敌对队伍集.md §四）
 * 表来源与 node 脚本一致：web/data/heroes.json + src/data/{skills,treasures}.ts + secondaryTroop.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AFFIXES, TREASURES } from '../src/data/treasures';
import { SKILL_REGISTRY } from '../src/data/skills';
import { FAMILY_TRAITS } from '../src/engine/secondaryTroop';
import { buildTables, toOpponentEntries, validateScan, type ScanJson } from '../web/teamScan';

const ROOT = process.cwd(); // vitest 的 cwd = 仓库根
const heroesJson = JSON.parse(readFileSync(join(ROOT, 'web/data/heroes.json'), 'utf8')) as Array<{
  id: string;
  name: string;
  mainSkillId?: string;
  mainSkillName?: string;
  troopType?: string;
}>;
const tables = buildTables({
  heroes: heroesJson.map((h) => ({
    id: h.id,
    name: h.name,
    mainSkillId: h.mainSkillId,
    mainSkillName: h.mainSkillName,
    troopType: h.troopType ?? 'infantry',
  })),
  skills: SKILL_REGISTRY,
  treasures: TREASURES,
  affixes: AFFIXES,
  traits: Object.values(FAMILY_TRAITS).flat(),
});
const fx = (f: string): ScanJson =>
  JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/team-scan', f), 'utf8')) as ScanJson;

describe('图1：敌方 陈宫/张宁/吕蒙', () => {
  const res = validateScan(fx('敌方-陈宫张宁吕蒙.json'), tables);
  it('三条校验通过、位置按 大营/中军/前锋 归位', () => {
    expect(res.ok).toBe(true);
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(res.slots.map((s) => [s.position, s.heroId, s.heroName])).toEqual([
      ['大营', 'h443', '陈宫'],
      ['中军', 'h474', '张宁'],
      ['前锋', 'lvmeng', '吕蒙'],
    ]);
  });
  it('战法解析成 id，且第 1 个 = 各自主战法', () => {
    expect(res.slots.map((s) => s.skillIds)).toEqual([
      ['chizhi_nanchou', 'shenbing_tianjiang', 'dashang_sanjun'],
      ['huangtian_yuyin', 'zhongmou_buxie', 'sanshu_qimou'],
      ['baiyi_dujiang', 'fanji_zhence', 'daoxing_xianzu'],
    ]);
  });
  it('地利 ×3 收下', () => {
    expect(res.slots.map((s) => s.troopTrait)).toEqual(['地利', '地利', '地利']);
  });
  it('三件宝物全丢（精品/罕俦/精品，非稀世），treasure 恒 null 且留痕', () => {
    expect(res.slots.map((s) => s.treasure)).toEqual([null, null, null]);
    expect(res.slots.map((s) => s.treasureSeen?.name)).toEqual(['白羽扇', '雕翎扇', '白羽扇']);
    expect(res.issues.filter((i) => i.rule === 'treasure-quality').length).toBe(3);
  });
  it('导出对手配置：三将 3 战法 + 地利，等级 41/41/42 全保留', () => {
    const [entry] = toOpponentEntries([{ label: res.label, slots: res.slots }]);
    expect(entry.name).toBe('敌方·陈宫张宁吕蒙');
    expect(entry.cfg.slots.map((s) => s.level)).toEqual([41, 41, 42]);
    expect(entry.cfg.slots[0].skillIds.length).toBe(3);
    expect(entry.cfg.slots.every((s) => (s.traits ?? []).includes('地利'))).toBe(true);
    expect(entry.cfg.rounds).toBe(8);
  });
});

describe('图2：我方 SP太史慈/曹植/陆抗（无特性/无宝物/等级 <40）', () => {
  const res = validateScan(fx('我方-太史慈曹植陆抗.json'), tables);
  it('校验通过、无特性无宝物', () => {
    expect(res.ok).toBe(true);
    expect(res.slots.map((s) => s.heroId)).toEqual(['h102003', 'h672', 'h574']);
    expect(res.slots.map((s) => s.troopTrait)).toEqual([null, null, null]);
    expect(res.slots.map((s) => s.treasure)).toEqual([null, null, null]);
  });
  it('等级照录 28/27/27，但入库夹到 40（用户口径）并标记', () => {
    expect(res.slots.map((s) => s.rawLevel)).toEqual([28, 27, 27]);
    expect(res.slots.map((s) => s.level)).toEqual([40, 40, 40]);
    expect(res.slots.every((s) => s.levelClampedTo40)).toBe(true);
  });
});

describe('反例：规则逐条拦截', () => {
  const clone = (): ScanJson => JSON.parse(JSON.stringify(fx('敌方-陈宫张宁吕蒙.json'))) as ScanJson;
  const errs = (s: ScanJson): string[] =>
    validateScan(s, tables)
      .issues.filter((i) => i.level === 'error')
      .map((i) => i.rule);

  it('主战法不符 → 拒收', () => {
    const s = clone();
    s.slots[0].skillNames = ['神兵天降', '大赏三军', '迟智难酬'];
    expect(errs(s)).toContain('main-skill');
  });
  it('武将名不在库 → 拒收', () => {
    const s = clone();
    s.slots[1].heroName = '张宁宁';
    expect(errs(s)).toContain('hero-name');
  });
  it('战法名不在库 → 拒收', () => {
    const s = clone();
    s.slots[2].skillNames[1] = '反计之策·改';
    expect(errs(s)).toContain('skill-name');
  });
  it('同队战法重复 → 拒收', () => {
    const s = clone();
    s.slots[1].skillNames[2] = '大赏三军';
    expect(errs(s)).toContain('skill-duplicate');
  });
  it('位置重复 → 拒收', () => {
    const s = clone();
    s.slots[2].position = '大营';
    expect(errs(s)).toContain('slot-position');
  });
  it('特性不在池 → 拒收', () => {
    const s = clone();
    s.slots[0].troopTrait = '地利·改';
    expect(errs(s)).toContain('trait');
  });
  it('稀世宝物 + 词条在池 → 收下，数值取区间中点', () => {
    const s = clone();
    s.slots[0].treasure = { name: '游飘', quality: '稀世', affix: '颖悟', level: 10 };
    const res = validateScan(s, tables);
    expect(res.ok).toBe(true);
    const youpiao = TREASURES.find((t) => t.name === '游飘')!;
    const range = AFFIXES['颖悟'];
    expect(res.slots[0].treasure?.treasureId).toBe(youpiao.id);
    expect(res.slots[0].treasure?.affix?.name).toBe('颖悟');
    expect(res.slots[0].treasure?.affix?.value).toBeCloseTo((range.min + range.max) / 2, 5);
  });
  it('稀世但词条不属于该宝物 → 拒收', () => {
    const s = clone();
    s.slots[0].treasure = { name: '游飘', quality: '稀世', affix: '不存在的词条' };
    expect(errs(s)).toContain('treasure-affix');
  });
  it('非稀世宝物写进 treasure → 丢弃但不算错', () => {
    const s = clone();
    s.slots[0].treasure = { name: '白羽扇', quality: '精品', affix: '颖悟' };
    const res = validateScan(s, tables);
    expect(res.ok).toBe(true);
    expect(res.slots[0].treasure).toBeNull();
    expect(res.issues.some((i) => i.rule === 'treasure-quality')).toBe(true);
  });
});
