/**
 * 热门预设（内置固定层，`web/data/hot_presets.json`）：数据合法性 + 「删不掉改不了」的读取语义。
 *
 * 这批队伍是要发给玩家用的，**不许编造**：每个武将 / 装配战法 / 二级兵种 / 兵系特性 / 宝物 / 锻造词条
 * 都必须能在库里查到，且组合要真能用（转换方向、词条池、词条数值区间），否则玩家点了配不出来、引擎跑不通。
 * 用户口径 2026-10-16：「预设」改名「热门预设」，固定一批热门队伍（名单由用户提供），自己加预设的功能不变。
 */
import { describe, expect, it } from 'vitest';
import hotJson from '../web/data/hot_presets.json';
import { HOT_ID_PREFIX, hotVersion, isHotId, loadHotPresets } from '../web/hotPresets';
import { HERO_RECORDS, freePointBudget } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { BAIJIA_SKILLS } from '../src/data/baijia';
import { SECONDARY_TROOPS, traitsFor } from '../src/engine/secondaryTroop';
import { HERO_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { AFFIXES, TREASURES_BY_ID } from '../src/data/treasures';
import type { SlotState } from '../web/teamEditor';

const FILE = hotJson as { version: string; entries: Array<{ id: string; name: string; side: string; slots: SlotState[] }> };

describe('热门预设 · 数据文件', () => {
  it('带版本号（改动数据后要往上提）', () => {
    expect(typeof FILE.version).toBe('string');
    expect(FILE.version.length).toBeGreaterThan(0);
    expect(hotVersion()).toBe(FILE.version);
    expect(Array.isArray(FILE.entries)).toBe(true);
  });

  it('id 以 hot- 开头且唯一、预设名非空、红蓝边合法', () => {
    const ids = FILE.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of FILE.entries) {
      expect(e.id.startsWith(HOT_ID_PREFIX)).toBe(true);
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(['red', 'blue']).toContain(e.side);
    }
  });

  it('每条都是满 3 将，武将 / 战法 / 二级兵种 + 特性 / 宝物 + 词条全在库内且组合合法', () => {
    for (const e of FILE.entries) {
      const slots = loadHotPresets().find((p) => p.id === e.id)?.slots ?? [];
      expect(slots.length, `${e.id} 槽位数`).toBe(3);
      for (const [i, s] of slots.entries()) {
        const at = `${e.id} 第 ${i + 1} 槽`;
        expect(s.heroId, `${at} 武将不能为空`).toBeTruthy();
        expect(HERO_RECORDS[s.heroId as string], `${at} 武将 ${s.heroId} 不在武将库`).toBeTruthy();
        expect((s.extraSkillIds ?? []).length, `${at} 装配战法最多 2 个`).toBeLessThanOrEqual(2);
        for (const id of s.extraSkillIds ?? []) {
          // 百家战法（bj_*）由 skills.ts 末尾 `...BAIJIA_SKILLS` 并入注册表，与普通战法同池。
          expect(SKILL_REGISTRY[id], `${at} 战法 ${id} 不在战法库`).toBeTruthy();
        }
        const troop = s.secondaryTroop;
        if (troop) {
          expect(SECONDARY_TROOPS[troop], `${at} 二级兵种 ${troop} 不在库内`).toBeTruthy();
          // 该武将的转换方向里必须真有这个兵种（面板只列可转方向，录错会让玩家根本配不出来）
          const dirs = (HERO_SECONDARY_TROOPS as Record<string, string[] | undefined>)[s.heroId as string] ?? [];
          expect(dirs, `${at} 武将 ${s.heroId} 的转换方向里没有 ${troop}`).toContain(troop);
          const pool = traitsFor(troop);
          for (const t of s.secondaryTraits ?? []) {
            expect(pool.includes(t), `${at} 特性 ${t} 不属于 ${troop}`).toBe(true);
          }
        } else {
          expect(s.secondaryTraits?.length ?? 0, `${at} 未转换二级兵种就不该有兵系特性`).toBe(0);
        }
        if (s.treasure) {
          const t = TREASURES_BY_ID[s.treasure.treasureId];
          expect(t, `${at} 宝物 ${s.treasure.treasureId} 不在宝物库`).toBeTruthy();
          if (s.treasure.affix) {
            const { name, value } = s.treasure.affix;
            expect(
              (t as { affixPool?: string[] }).affixPool ?? [],
              `${at} 宝物「${t.name}」的词条池里没有「${name}」`
            ).toContain(name);
            const def = AFFIXES[name];
            expect(def, `${at} 词条「${name}」不在词条表`).toBeTruthy();
            if (def) {
              expect(value, `${at} 词条「${name}」数值 ${value} 低于官方下限 ${def.min}`).toBeGreaterThanOrEqual(def.min);
              expect(value, `${at} 词条「${name}」数值 ${value} 高于官方上限 ${def.max}`).toBeLessThanOrEqual(def.max);
            }
          }
        }
        expect(s.level).toBeGreaterThanOrEqual(40);
        expect(s.level).toBeLessThanOrEqual(50);
        expect(s.redness).toBeGreaterThanOrEqual(0);
        expect(s.redness).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('热门预设 · 读取语义（固定层，删不掉也改不了）', () => {
  it('每次返回新拷贝：页面上的编辑动不到原件', () => {
    const a = loadHotPresets();
    a.forEach((p) => p.slots.forEach((s) => { s.heroId = null; }));
    const b = loadHotPresets();
    expect(b.map((p) => p.id)).toEqual(a.map((p) => p.id));
    for (const p of b) expect(p.slots.some((s) => s.heroId)).toBe(true);
  });

  it('不编号（编号是用户存档的单调水位，内置条目不借用）且不带时间戳', () => {
    for (const p of loadHotPresets()) {
      expect(p.no).toBe(0);
      expect(p.createdAt).toBe(0);
      expect(p.updatedAt).toBe(0);
    }
  });

  it('isHotId 只认 hot- 前缀（用户预设是 p_…，两边不会撞）', () => {
    expect(isHotId('hot-abc')).toBe(true);
    expect(isHotId('p_1_2')).toBe(false);
    expect(isHotId('')).toBe(false);
  });
});

/**
 * 2026-10-21 从十二张配将截图识图录入的十二条（用户口径「识别并加入到热门预设当中」）。
 * 口径：截图三格 = **主战法（武将档案带出）+ 2 个装配战法**，这里两样都钉死，
 * 免得后续改库时把「主战法被误写成装配战法」这类错默默放行。
 * 加点 / 红度按 `freePointBudget` 反推（40 级男将 0 红 = 40、5 红 = 90；女将每档 15 → 5 红 = 110）。
 */
describe('热门预设 · 2026-10-21 识图录入十二条', () => {
  const pick = (id: string) => loadHotPresets().find((p) => p.id === id);
  const mainSkill = (heroId: string) => HERO_RECORDS[heroId]?.mainSkillId;
  const points = (attack = 0, defense = 0, strategy = 0, speed = 0) => ({ attack, defense, strategy, speed });

  it('汉荀彧·沮授·司马懿（红）：重步 / 重步 / 白衣死士，全白板', () => {
    const p = pick('hot-hanxunyu-jushou-simayi');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('汉荀彧·沮授·司马懿');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h794', 'h771', 'h807']);
    // 截图第一格
    expect(['h794', 'h771', 'h807'].map(mainSkill)).toEqual(['juxian_jueji', 'huanshi_xuchi', 'qixu_rulin']);
    // 截图第二、三格（左 → 右 = 判定顺序）
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['bugong', 'xitun_duoqi'],
      ['xiansheng_duoren', 'kuidi'],
      ['jiuzhan_shumou', 'fanji_zhence'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['重步兵', '重步兵', '白衣死士']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['守备', '文韬'], ['守备', '勇毅'], ['守备', '勇毅']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(0, 0, 40), points(0, 0, 40), points(0, 0, 40)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([0, 0, 0]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([null, null, null]);
  });

  it('甘宁·司马炎·孙权（红）：甘宁满红满点 + 彤素至策，司马炎别鸣艮止，孙权大将机敏', () => {
    const p = pick('hot-ganning-simayan-sunquan');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('甘宁·司马炎·孙权');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h34', 'h703', 'sunquan']);
    expect(['h34', 'h703', 'sunquan'].map(mainSkill)).toEqual(['qinlue_ruhuo', 'mouyi_hongtu', 'jiuxi_huanglong']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['jifeng_ershi', 'sishuiguan'],
      ['zhanbi_duanjin', 'wuxin_lianzhan'],
      ['hunshui_moyu', 'leishi_yingji'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['长枪兵', '禁卫', '死士']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['列阵'], ['守备', '勇毅'], ['地利', '迂回']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(90, 0, 0), points(0, 0, 40), points(0, 40)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 0, 0]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1003, affix: { name: '至策', value: 16 } },
      { treasureId: 1027, affix: { name: '艮止', value: 21 } },
      { treasureId: 1072, affix: { name: '机敏', value: 6 } },
    ]);
  });

  it('乐进·司马炎·典韦（蓝）：司马炎未转二级兵种，乐进禁卫利刃，典韦长枪兵守备', () => {
    const p = pick('hot-lejin-simayan-dianwei');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('乐进·司马炎·典韦');
    expect(p!.side).toBe('blue');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h703', 'h685', 'h769']);
    expect(['h703', 'h685', 'h769'].map(mainSkill)).toEqual(['mouyi_hongtu', 'fenji_xiandeng', 'sheshen_weizhu']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['sanjun_zhizhong', 'bairen'],
      ['jishi', 'baizhan_jingbing'],
      ['kongcheng', 'shanbing_bugua'],
    ]);
    // 司马炎这一槽截图只有「步兵」，没转二级兵种 → 既无 secondaryTroop 也无特性
    expect(p!.slots[0].secondaryTroop).toBeUndefined();
    expect(p!.slots[0].secondaryTraits ?? []).toEqual([]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual([undefined, '禁卫', '长枪兵']);
    expect(p!.slots[1].secondaryTraits).toEqual(['利刃']);
    expect(p!.slots[2].secondaryTraits).toEqual(['守备']);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(0, 0, 40), points(0, 0, 0, 40), points(0, 40)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([0, 0, 0]);
  });

  it('刘秀·司马懿·司马炎（红）：三只满红满谋略，轻骑兵疾行/扰后 + 游飘筹算，白衣死士 + 仁风艮止，禁卫 + 大将稳固', () => {
    const p = pick('hot-liuxiu-simayi-simayan');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('刘秀·司马懿·司马炎');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h841', 'h807', 'h703']);
    // 截图第一格
    expect(['h841', 'h807', 'h703'].map(mainSkill)).toEqual(['guangwu_zhongxing', 'qixu_rulin', 'mouyi_hongtu']);
    // 截图第二、三格（左 → 右 = 判定顺序）
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['weiyu_choumou', 'lingwu_kongxuan'],
      ['wuxin_lianzhan', 'jiuzhan_shumou'],
      ['leishi_yingji', 'qiqin_qizong'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['轻骑兵', '白衣死士', '禁卫']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['疾行', '扰后'], ['守备', '勇毅'], ['守备', '勇毅']]);
    // 截图三槽都是「谋略+90」= 40 级满红（40 + 5×10）
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(0, 0, 90), points(0, 0, 90), points(0, 0, 90)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1051, affix: { name: '筹算', value: 15 } },
      { treasureId: 1054, affix: { name: '艮止', value: 30 } },
      { treasureId: 1072, affix: { name: '稳固', value: 20 } },
    ]);
  });

  it('庞统·司马懿·刘备（蓝）：弩兵 / 白衣死士 / 禁卫；司马懿第三格「桃源问津」库里只有百家主战法版本，装备栏选不到 → 只录 1 个装配战法', () => {
    const p = pick('hot-pangtong-simayi-liubei');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('庞统·司马懿·刘备');
    expect(p!.side).toBe('blue');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h477', 'h807', 'h16']);
    expect(['h477', 'h807', 'h16'].map(mainSkill)).toEqual(['mimou_dingshu', 'qixu_rulin', 'huangyi_liuli']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['huoshaolianying', 'sanshu_qimou'],
      ['wuxin_lianzhan'],
      ['leishi_yingji', 'lianzhong_dingqi'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['弩兵', '白衣死士', '禁卫']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['地利', '齐射'], ['守备', '勇毅'], ['勇毅', '守备']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(0, 0, 90), points(0, 0, 90), points(0, 0, 90)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1051, affix: { name: '筹算', value: 15 } },
      { treasureId: 1057, affix: { name: '天资', value: 15 } },
      { treasureId: 1048, affix: { name: '仁心', value: 15 } },
    ]);
  });

  it('曹彰·张春华·孙权（蓝）：张春华是女将，加点上限 4×15+50 = 110（男将是 90，不是笔误）', () => {
    const p = pick('hot-caozhang-zhangchunhua-sunquan');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('曹彰·张春华·孙权');
    expect(p!.side).toBe('blue');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h683', 'h29', 'sunquan']);
    expect(['h683', 'h29', 'sunquan'].map(mainSkill)).toEqual(['wubing_zhilie', 'qiangshi', 'jiuxi_huanglong']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['lingwu_kongxuan', 'yiji_dangqian'],
      ['shiji', 'dingzujiangdong'],
      ['zhanbi_duanjin', 'jixian_yuanjin'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['轻骑兵', '长弓兵', '长弓兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['扰后', '挫锐'], ['地利', '迂回'], ['地利', '散射']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(90, 0, 0), points(0, 0, 110), points(0, 0, 0, 90)]);
    // 女将每 10 级 15 点、男将 10 点，红度每星再加 10（5 红 = +50）
    expect(freePointBudget('h29', 5, 40)).toBe(110);
    expect(freePointBudget('h683', 5, 40)).toBe(90);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1003, affix: { name: '英勇', value: 15 } },
      { treasureId: 1027, affix: { name: '机敏', value: 9 } },
      { treasureId: 1072, affix: { name: '机敏', value: 9 } },
    ]);
  });

  it('曹彰·木鹿大王·曹操（蓝）：轻骑兵疾行/扰后 + 象兵出奇/难测 + 重骑兵，木鹿别鸣灵动 30', () => {
    const p = pick('hot-caozhang-molu-caocao');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('曹彰·木鹿大王·曹操');
    expect(p!.side).toBe('blue');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h683', 'h452', 'h23']);
    expect(['h683', 'h452', 'h23'].map(mainSkill)).toEqual(['wubing_zhilie', 'kui_xiangta', 'weiwu_zhishi']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['lingwu_kongxuan', 'yiji_dangqian'],
      ['gongqi_bubei', 'fengshi'],
      ['fanji_zhence', 'danqijiuzhu'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['轻骑兵', '象兵', '重骑兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['疾行', '扰后'], ['出奇', '难测'], ['出奇', '难测']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(90, 0, 0), points(0, 0, 0, 90), points(0, 0, 90)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1003, affix: { name: '英勇', value: 15 } },
      { treasureId: 1027, affix: { name: '灵动', value: 30 } },
      { treasureId: 1072, affix: { name: '稳固', value: 20 } },
    ]);
  });

  it('郝昭·马谡·曹操（蓝）：沧（海）不屈 9 / 别鸣艮止 30 / 大将稳固 20，曹操这一队换 措手不及 + 白刃', () => {
    const p = pick('hot-haozhao-masu-caocao');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('郝昭·马谡·曹操');
    expect(p!.side).toBe('blue');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h475', 'h799', 'h23']);
    expect(['h475', 'h799', 'h23'].map(mainSkill)).toEqual(['budong_rushan', 'xinzhan_weishang', 'weiwu_zhishi']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['sanjun_qichu', 'jianzu_budai'],
      ['chue_wujin', 'henge'],
      ['cuoshou_buji', 'bairen'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['禁卫', '铁骑兵', '重骑兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['利刃', '守备'], ['难测', '出奇'], ['出奇', '难测']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(90, 0, 0), points(0, 0, 90), points(0, 0, 90)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1108, affix: { name: '不屈', value: 9 } },
      { treasureId: 1027, affix: { name: '艮止', value: 30 } },
      { treasureId: 1072, affix: { name: '稳固', value: 20 } },
    ]);
  });

  it('XP陆逊·XP程昱·XP周瑜（红）：疲兵沮意 / 审时定计 / 衔命建功 三个 XP 主战法，全 0 红（加点合计 40）', () => {
    const p = pick('hot-xpluxun-xpchengyu-xpzhouyu');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('XP陆逊·XP程昱·XP周瑜');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h791', 'h787', 'h784']);
    expect(['h791', 'h787', 'h784'].map(mainSkill)).toEqual(['pibing_juyi', 'shenshi_dingji', 'xianming_jiangong']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['shenmou_yuanlv', 'huoshaolianying'],
      ['jiuzhan_shumou', 'dingzujiangdong'],
      ['zhanbi_duanjin', 'panzhen_shanshou'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['弩兵', '死士', '长枪兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['地利', '迂回'], ['地利', '迂回'], ['守备', '勇毅']]);
    // 中军是 谋略+25 速度+15 的两段加点，合计仍是 0 红预算 40
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(0, 0, 40), points(0, 0, 25, 15), points(0, 0, 40)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([0, 0, 0]);
    for (const s of p!.slots) {
      const heroId = s.heroId ?? '';
      const fp = s.freePoints;
      expect(fp.attack + fp.defense + fp.strategy + fp.speed, heroId).toBe(freePointBudget(heroId, s.redness, s.level));
    }
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1051, affix: { name: '天资', value: 10 } },
      { treasureId: 1027, affix: { name: '仁心', value: 10 } },
      { treasureId: 1027, affix: { name: '坚忍', value: 16 } },
    ]);
  });

  it('SP太史慈·卫瓘·吕蒙（蓝）：太史慈 fangzhen_yansha、卫瓘 chijie_zhenxi、吕蒙 baiyi_dujiang，全 5 红（90）', () => {
    const p = pick('hot-sptaishici-weiguan-lvmeng');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('SP太史慈·卫瓘·吕蒙');
    expect(p!.side).toBe('blue');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h102003', 'weiguan', 'lvmeng']);
    expect(['h102003', 'weiguan', 'lvmeng'].map(mainSkill)).toEqual(['fangzhen_yansha', 'chijie_zhenxi', 'baiyi_dujiang']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['xianqu_tuji', 'xiaoxiong'],
      ['jixian_yuanjin', 'fanji_zhence'],
      ['dashang_sanjun', 'shenbing_tianjiang'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['弩兵', '重步兵', '死士']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['齐射', '散射'], ['利刃', '勇毅'], ['地利', '迂回']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(90, 0, 0), points(80, 0, 0, 10), points(0, 0, 90)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    for (const s of p!.slots) {
      const heroId = s.heroId ?? '';
      const fp = s.freePoints;
      expect(fp.attack + fp.defense + fp.strategy + fp.speed, heroId).toBe(freePointBudget(heroId, s.redness, s.level));
    }
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1102, affix: { name: '骁锐', value: 15 } },
      { treasureId: 1057, affix: { name: '骁锐', value: 15 } },
      { treasureId: 1045, affix: { name: '天资', value: 15 } },
    ]);
  });

  it('张飞·诸葛亮·孙权（红）：螣蛇熟虑 14（截图写作「腾蛇」）；诸葛亮有两个版本，这里取 h496（明其虚实）不是 h17（诸葛锦囊）', () => {
    const p = pick('hot-zhangfei-zhugeliang-sunquan');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('张飞·诸葛亮·孙权');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h22', 'h496', 'sunquan']);
    expect(['h22', 'h496', 'sunquan'].map(mainSkill)).toEqual(['changban_zhihou', 'mingqi_xushi', 'jiuxi_huanglong']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['shengbing_qiuzhan', 'jishi'],
      ['shiji', 'dingzujiangdong'],
      ['jixian_yuanjin', 'zhanbi_duanjin'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['轻骑兵', '长弓兵', '长弓兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['扰后', '挫锐'], ['地利', '迂回'], ['地利', '迂回']]);
    // 中军是 谋略+3 速度+37、前锋是 防御+15 速度+25，都是两段加点、合计 40（0 红）
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(40, 0, 0), points(0, 0, 3, 37), points(0, 15, 0, 25)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([0, 0, 0]);
    for (const s of p!.slots) {
      const heroId = s.heroId ?? '';
      const fp = s.freePoints;
      expect(fp.attack + fp.defense + fp.strategy + fp.speed, heroId).toBe(freePointBudget(heroId, s.redness, s.level));
    }
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1087, affix: { name: '熟虑', value: 14 } },
      { treasureId: 1057, affix: { name: '天资', value: 10 } },
      { treasureId: 1072, affix: { name: '机敏', value: 6 } },
    ]);
  });

  it('刘备·XP马良·夏侯惇（红）：桃园结义这次库里有（taoyuanjieyi）；夏侯惇主战法是「盲侯奋勇」不是「盲侯奋击」', () => {
    const p = pick('hot-liubei-xpmaliang-xiahoudun');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('刘备·XP马良·夏侯惇');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h16', 'h792', 'h449']);
    expect(['h16', 'h792', 'h449'].map(mainSkill)).toEqual(['huangyi_liuli', 'yalv_shishi', 'manghou_fenyong']);
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['lianzhong_dingqi', 'taoyuanjieyi'],
      ['wuxin_lianzhan', 'yaoshu'],
      ['yifudangguan', 'baizhan_wuqie'],
    ]);
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['重步兵', '重步兵', '重骑兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['守备', '勇毅'], ['守备', '勇毅'], ['难测', '出奇']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(0, 0, 40), points(0, 0, 40), points(40, 0, 0)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([0, 0, 0]);
    for (const s of p!.slots) {
      const heroId = s.heroId ?? '';
      const fp = s.freePoints;
      expect(fp.attack + fp.defense + fp.strategy + fp.speed, heroId).toBe(freePointBudget(heroId, s.redness, s.level));
    }
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1048, affix: { name: '仁心', value: 10 } },
      { treasureId: 1048, affix: { name: '艮止', value: 22 } },
      { treasureId: 1108, affix: { name: '戒备', value: 22 } },
    ]);
  });

  it('曹彰·木鹿大王·曹操（攻其不备版，红）：木鹿第三槽是百家战法「西陲立功（靖边）」bj_550008', () => {
    const p = pick('hot-caozhang-molu-caocao-gongqi');
    expect(p, '条目存在').toBeTruthy();
    expect(p!.name).toBe('曹彰·木鹿大王·曹操（攻其不备）');
    expect(p!.side).toBe('red');
    expect(p!.slots.map((s) => s.heroId)).toEqual(['h683', 'h452', 'h23']);
    expect(['h683', 'h452', 'h23'].map(mainSkill)).toEqual(['wubing_zhilie', 'kui_xiangta', 'weiwu_zhishi']);
    // 与「曹彰·木鹿大王·曹操」的区别就在这三处：曹彰两槽顺序、木鹿带百家战法、曹操带攻其不备
    expect(p!.slots.map((s) => s.extraSkillIds)).toEqual([
      ['yiji_dangqian', 'lingwu_kongxuan'],
      ['hunshui_moyu', 'bj_550008'],
      ['fanji_zhence', 'gongqi_bubei'],
    ]);
    // 百家战法在 skills.ts 里已并入 SKILL_REGISTRY（与 BAIJIA_SKILLS 是同一批对象），显示名是官方「西陲立功」
    expect(SKILL_REGISTRY['bj_550008']).toBe(BAIJIA_SKILLS['bj_550008']);
    expect(SKILL_REGISTRY['bj_550008']?.name).toBe('西陲立功');
    expect(BAIJIA_SKILLS['bj_550008']?.name).toBe('西陲立功');
    expect(BAIJIA_SKILLS['bj_550008']?.type).toBe('active');
    expect(p!.slots.map((s) => s.secondaryTroop)).toEqual(['轻骑兵', '象兵', '重骑兵']);
    expect(p!.slots.map((s) => s.secondaryTraits)).toEqual([['疾行', '扰后'], ['疾行', '出奇'], ['难测', '出奇']]);
    expect(p!.slots.map((s) => s.freePoints)).toEqual([points(90, 0, 0), points(0, 0, 0, 90), points(0, 0, 90)]);
    expect(p!.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    for (const s of p!.slots) {
      const heroId = s.heroId ?? '';
      const fp = s.freePoints;
      expect(fp.attack + fp.defense + fp.strategy + fp.speed, heroId).toBe(freePointBudget(heroId, s.redness, s.level));
    }
    expect(p!.slots.map((s) => s.treasure)).toEqual([
      { treasureId: 1003, affix: { name: '英勇', value: 15 } },
      { treasureId: 1012, affix: { name: '坚毅', value: 6 } },
      { treasureId: 1072, affix: { name: '稳固', value: 20 } },
    ]);
  });

  it('十三条都进内置层，且不占用用户预设编号', () => {
    const hot = loadHotPresets();
    expect(hot.length).toBe(17);
    for (const id of [
      'hot-hanxunyu-jushou-simayi',
      'hot-ganning-simayan-sunquan',
      'hot-lejin-simayan-dianwei',
      'hot-liuxiu-simayi-simayan',
      'hot-pangtong-simayi-liubei',
      'hot-caozhang-zhangchunhua-sunquan',
      'hot-caozhang-molu-caocao',
      'hot-haozhao-masu-caocao',
      'hot-xpluxun-xpchengyu-xpzhouyu',
      'hot-sptaishici-weiguan-lvmeng',
      'hot-zhangfei-zhugeliang-sunquan',
      'hot-liubei-xpmaliang-xiahoudun',
      'hot-caozhang-molu-caocao-gongqi',
    ]) {
      const p = hot.find((x) => x.id === id);
      expect(p, id).toBeTruthy();
      expect(p!.no).toBe(0);
      expect(p!.slots.filter((s) => s.heroId)).toHaveLength(3);
    }
  });
});
