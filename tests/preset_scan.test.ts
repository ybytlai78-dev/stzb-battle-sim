/**
 * 预设识图 · 对齐层（纯逻辑）
 * ---------------------------------------------------------------------------
 * 两张 fixture 就是用户验收给的真截图（`阵容详情` 界面）的识别结果：
 *   A = 我方·司马炎 / 乐进 / 于禁（全员 5 红，Lv.50）
 *   B = 我方·甘宁 / 陆抗 / 周泰（5 / 4 / 4 红，Lv.43 / 41 / 41）
 * 这里锁的是「模型报名字 → 库内 id → 预设槽位」这条确定性链，
 * 主战法不得进装配槽、兵种/宝物/加点留空、等级一律 40（用户 2026-10-21 口径）。
 */
import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import {
  SCAN_LEVEL,
  matchTeamScan,
  normalizeTeamScan,
  parseTeamScanReply,
  scanSummaryText,
  scannedPresetName,
  toSlotStates,
  type TeamScanJson,
} from '../web/presetScan';
import { PRESET_NAME_MAX } from '../web/presetStore';
import { getHeroById } from '../web/heroes';

/** 截图 A：我方·司马炎队（三行全员 5 红星，Lv.50） */
const SHOT_A: TeamScanJson = {
  side: '我方',
  slots: [
    { position: '大营', heroName: '司马炎', redness: 5, level: 50, faction: '晋', troopType: '步', skillNames: ['谋议宏图', '白刃', '兵无常势'] },
    { position: '中军', heroName: '乐进', redness: 5, level: 50, faction: '魏', troopType: '步', skillNames: ['奋疾先登', '百战无怯', '击势'] },
    { position: '前锋', heroName: '于禁', redness: 5, level: 50, faction: '魏', troopType: '步', skillNames: ['当敌制决', '以诱待来', '胜敌益强'] },
  ],
  unrecognized: ['特性图标：勇毅 / 守备 / 利刃（按口径不识别）'],
};

/** 截图 B：我方·甘宁队（1 / 0 / 0 红 —— 卡面 5 颗星里只有甘宁第一颗是红的，Lv.43 / 41 / 41；第三个战法带 S2 赛季角标） */
const SHOT_B: TeamScanJson = {
  side: '我方',
  slots: [
    { position: '大营', heroName: '甘宁', redness: 1, level: 43, faction: '吴', troopType: '步', skillNames: ['侵掠如火', '及锋而试', '汜水关'] },
    { position: '中军', heroName: '陆抗', redness: 0, level: 41, faction: '吴', troopType: '步', skillNames: ['西陵克晋', '援军秘策', '无心恋战'] },
    { position: '前锋', heroName: '周泰', redness: 0, level: 41, faction: '吴', troopType: '步', skillNames: ['疮痍累身', '回马', '青囊秘要'] },
  ],
};

describe('截图 A（司马炎 / 乐进 / 于禁）', () => {
  const res = matchTeamScan(SHOT_A);

  it('三将按 大营 / 中军 / 前锋 对齐到库内 id', () => {
    expect(res.slots.map((s) => s.position)).toEqual(['大营', '中军', '前锋']);
    expect(res.slots.map((s) => s.heroId)).toEqual(['h703', 'h685', 'h796']);
    expect(res.slots.map((s) => s.heroName)).toEqual(['司马炎', '乐进', '于禁']);
    expect(res.heroCount).toBe(3);
  });

  it('红度照识别结果（全员 5 红）', () => {
    expect(res.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
  });

  it('每人两个装配战法，主战法被剔除（绝不进 extraSkillIds）', () => {
    expect(res.slots.map((s) => s.mainSkillName)).toEqual(['谋议宏图', '奋疾先登', '当敌制决']);
    expect(res.slots.map((s) => s.extraSkillNames)).toEqual([
      ['白刃', '兵无常势'],
      ['百战无怯', '击势'],
      ['以诱待来', '胜敌益强'],
    ]);
    for (const s of res.slots) {
      expect(s.extraSkillIds).toHaveLength(2);
      expect(s.extraSkillIds).not.toContain(s.mainSkillId);
    }
  });

  it('落库槽位：等级一律 40、兵种/特性/宝物/加点全留空', () => {
    const slots = toSlotStates(res);
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.level)).toEqual([SCAN_LEVEL, SCAN_LEVEL, SCAN_LEVEL]);
    expect(slots.map((s) => s.treasure)).toEqual([null, null, null]);
    for (const s of slots) {
      expect(s.freePoints).toEqual({ attack: 0, defense: 0, strategy: 0, speed: 0 });
      expect(s.secondaryTroop).toBeUndefined();
      expect(s.secondaryTraits).toBeUndefined();
      expect(s.chenshou).toBeUndefined();
    }
  });

  it('自动预设名 = 识图·三名，且没有 error 级问题', () => {
    expect(res.name).toBe('识图·司马炎-乐进-于禁');
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(scanSummaryText(res)).toBe('3 将 · 9 战法');
  });
});

describe('截图 B（甘宁 / 陆抗 / 周泰，红度 1/0/0）', () => {
  const res = matchTeamScan(SHOT_B);

  it('三将 + 红度逐条照识别结果', () => {
    expect(res.slots.map((s) => s.heroId)).toEqual(['h34', 'h574', 'h589']);
    expect(res.slots.map((s) => s.redness)).toEqual([1, 0, 0]);
  });

  it('主战法剔除后只剩两条装配战法（含 S2 角标那条）', () => {
    expect(res.slots.map((s) => s.mainSkillName)).toEqual(['侵掠如火', '西陵克晋', '疮痍累身']);
    expect(res.slots.map((s) => s.extraSkillNames)).toEqual([
      ['及锋而试', '汜水关'],
      ['援军秘策', '无心恋战'],
      ['回马', '青囊秘要'],
    ]);
  });

  it('截图上的等级只留痕，落库仍是 40 级', () => {
    expect(res.slots.map((s) => s.rawLevel)).toEqual([43, 41, 41]);
    expect(toSlotStates(res).map((s) => s.level)).toEqual([40, 40, 40]);
    // 确认卡上会说清「截图 Lv43 → 按 40 级存」这件事（不改数据，只标注）
    expect(res.slots[0].rawLevel).not.toBe(SCAN_LEVEL);
  });
});

describe('主战法纪律（把主战法塞进装配槽 = 引擎会判定两次）', () => {
  it('主战法排在中间也认得出，照样剔除', () => {
    const res = matchTeamScan({
      slots: [{ position: '大营', heroName: '司马炎', redness: 3, skillNames: ['白刃', '谋议宏图', '兵无常势'] }],
    });
    expect(res.slots[0].mainSkillName).toBe('谋议宏图');
    expect(res.slots[0].extraSkillNames).toEqual(['白刃', '兵无常势']);
  });

  it('模型把主战法名读错（当敌制胜 ≠ 库内 当敌制决）→ 第 1 条按主战法处理并留 warn', () => {
    const res = matchTeamScan({
      slots: [{ position: '前锋', heroName: '于禁', redness: 5, skillNames: ['当敌制胜', '以诱待来', '胜敌益强'] }],
    });
    expect(res.slots[2].heroId).toBe('h796');
    expect(res.slots[2].extraSkillNames).toEqual(['以诱待来', '胜敌益强']);
    expect(res.slots[2].extraSkillIds).not.toContain(res.slots[2].mainSkillId);
    expect(res.issues.some((i) => i.rule === 'main-skill')).toBe(true);
  });

  it('三条里只有主战法（没有装配战法）→ 空装配槽，不硬凑', () => {
    const res = matchTeamScan({ slots: [{ position: '大营', heroName: '甘宁', redness: 0, skillNames: ['侵掠如火'] }] });
    expect(res.slots[0].extraSkillIds).toEqual([]);
    expect(res.issues.some((i) => i.rule === 'skill-count')).toBe(true);
  });

  it('把别的武将的主战法当装配战法报上来 → 跳过并说明', () => {
    const mainOfLijin = getHeroById('h685')!.mainSkillName!;
    const res = matchTeamScan({
      slots: [{ position: '大营', heroName: '司马炎', redness: 5, skillNames: ['谋议宏图', '白刃', mainOfLijin] }],
    });
    expect(res.slots[0].extraSkillNames).toEqual(['白刃']);
    expect(res.slots[0].unmatchedSkills).toEqual([mainOfLijin]);
    expect(res.issues.some((i) => i.message.includes('武将主战法'))).toBe(true);
  });
});

describe('认不准时的行为（不猜、不静默丢）', () => {
  it('同名多版 → 列候选、该槽位留空、落库前必须点一下', () => {
    const res = matchTeamScan({ slots: [{ position: '大营', heroName: '吕布', redness: 5, skillNames: [] }] });
    expect(res.slots[0].heroId).toBeNull();
    expect(res.slots[0].candidates.length).toBeGreaterThan(1);
    expect(res.issues.some((i) => i.rule === 'hero-ambiguous')).toBe(true);
  });

  it('人工定案（heroOverrides）后按指定的 id 对齐', () => {
    const plain = matchTeamScan({ slots: [{ position: '大营', heroName: '吕布', redness: 5, skillNames: [] }] });
    const pick = plain.slots[0].candidates[0].id;
    const res = matchTeamScan({ slots: [{ position: '大营', heroName: '吕布', redness: 5, skillNames: [] }] }, { heroOverrides: { 大营: pick } });
    expect(res.slots[0].heroId).toBe(pick);
    expect(res.issues.some((i) => i.level === 'error')).toBe(false);
    expect(res.heroCount).toBe(1);
  });

  it('库里没有的武将 → error + 留空（不拿近似的顶替）', () => {
    const res = matchTeamScan({ slots: [{ position: '中军', heroName: '查无此将', redness: 5, skillNames: [] }] });
    expect(res.slots[1].heroId).toBeNull();
    expect(res.issues.some((i) => i.rule === 'hero-unknown')).toBe(true);
  });

  it('库里没有的战法 → 记进 unmatchedSkills 并 warn，其余战法照常落', () => {
    const res = matchTeamScan({
      slots: [{ position: '大营', heroName: '司马炎', redness: 5, skillNames: ['谋议宏图', '不存在的战法', '兵无常势'] }],
    });
    expect(res.slots[0].extraSkillNames).toEqual(['兵无常势']);
    expect(res.slots[0].unmatchedSkills).toEqual(['不存在的战法']);
    expect(res.issues.some((i) => i.rule === 'skill-unknown')).toBe(true);
  });

  it('缺一行的位置留空并 warn；重复位置只取第一条并报 error', () => {
    const missing = matchTeamScan({ slots: [{ position: '大营', heroName: '司马炎', redness: 5, skillNames: [] }] });
    expect(missing.slots.map((s) => s.heroId)).toEqual(['h703', null, null]);
    expect(missing.issues.filter((i) => i.rule === 'position-missing').length).toBe(2);

    const dup = matchTeamScan({
      slots: [
        { position: '大营', heroName: '司马炎', redness: 5, skillNames: [] },
        { position: '大营', heroName: '甘宁', redness: 5, skillNames: [] },
      ],
    });
    expect(dup.slots[0].heroId).toBe('h703');
    expect(dup.issues.some((i) => i.rule === 'position-dup')).toBe(true);
  });

  it('红度看不清（null）→ 按 0 红落库 + warn（不阻塞）', () => {
    const res = matchTeamScan({ slots: [{ position: '大营', heroName: '甘宁', redness: null, skillNames: ['侵掠如火'] }] });
    expect(res.slots[0].redness).toBe(0);
    expect(res.issues.some((i) => i.rule === 'redness')).toBe(true);
  });

  it('红度越界 → 夹到 0~5', () => {
    expect(matchTeamScan({ slots: [{ position: '大营', heroName: '甘宁', redness: 9, skillNames: [] }] }).slots[0].redness).toBe(5);
    expect(matchTeamScan({ slots: [{ position: '大营', heroName: '甘宁', redness: -3, skillNames: [] }] }).slots[0].redness).toBe(0);
  });
});

describe('解析与命名', () => {
  it('```json 围栏 / 裸 JSON 都能取到；不是 JSON 就抛错（绝不静默变空）', () => {
    const body = JSON.stringify({ slots: [{ position: '大营', heroName: '司马炎', redness: 5, skillNames: ['谋议宏图'] }] });
    expect(parseTeamScanReply('好的：\n```json\n' + body + '\n```').slots).toHaveLength(1);
    expect(parseTeamScanReply(`说明文字 ${body} 结尾`).slots[0].heroName).toBe('司马炎');
    expect(() => parseTeamScanReply('我读不出来这张图')).toThrow(/不是能认的 JSON/);
  });

  it('字段别名 / 字符串红度 / 缺字段都容错，但绝不补内容', () => {
    const raw = normalizeTeamScan({
      slots: [{ pos: '大营', hero: '司马炎', stars: '5', skills: [{ name: '谋议宏图' }, '白刃'] }],
    });
    expect(raw.slots[0]).toMatchObject({ position: '大营', heroName: '司马炎', redness: 5, skillNames: ['谋议宏图', '白刃'] });
    expect(normalizeTeamScan({}).slots).toEqual([]);
  });

  it('自动名超长按上限截断', () => {
    const long = scannedPresetName([{ heroName: '一二三四五六七八九十' }, { heroName: '甲乙丙丁戊己庚辛壬癸' }]);
    expect(long.length).toBe(PRESET_NAME_MAX);
    expect(long.startsWith('识图·')).toBe(true);
  });

  it('空槽用「空」占位，名字不塌', () => {
    const res = matchTeamScan({ slots: [{ position: '大营', heroName: '司马炎', redness: 5, skillNames: [] }] });
    expect(res.name).toBe('识图·司马炎-空-空');
  });
});

describe('战法名容错（游戏截图会带赛季 / 品级角标）', () => {
  it('「汜水关S2」按近似名落到「汜水关」', () => {
    const res = matchTeamScan({
      slots: [{ position: '大营', heroName: '甘宁', redness: 5, skillNames: ['侵掠如火', '及锋而试', '汜水关S2'] }],
    });
    expect(res.slots[0].extraSkillNames).toEqual(['及锋而试', '汜水关']);
    const id = res.slots[0].extraSkillIds[1];
    expect(SKILL_REGISTRY[id]?.name).toBe('汜水关');
  });
});
