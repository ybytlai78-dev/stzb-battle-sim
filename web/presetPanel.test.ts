/**
 * 阵容预设面板（jsdom）：列表/编号/搜索/详情/上场/木桩队伍/重命名/删除二次确认/命名弹窗/按键标准。
 * 数据用 presetStore 真实构造 + 真实武将数据（HEROES / SKILL_REGISTRY），只把「副作用」替换成 spy。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addPreset, type PresetFile, type TeamPreset, type TeamSide } from './presetStore';
import { openPresetPanel, openPresetNameDialog, fmtTime, slotsSummary, type PresetActionResult, type PresetPanelDeps } from './presetPanel';
import { HEROES, SLOTTED_HEROES } from './heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { SlotState } from './teamEditor';

const sampleSkill = Object.keys(SKILL_REGISTRY)[0];

function slot(heroId: string | null, skills: string[] = [], extra: Partial<SlotState> = {}): SlotState {
  return {
    heroId,
    extraSkillIds: skills,
    freePoints: { attack: 0, defense: 0, strategy: 0, attackBonus: 0 } as unknown as SlotState['freePoints'],
    redness: 0,
    level: 40,
    treasure: null,
    ...extra,
  };
}

/** 三将队伍（真实武将 id，含主战法的那批） */
const trio = (): SlotState[] => [
  slot(SLOTTED_HEROES[0].id, [sampleSkill], { freePoints: { attack: 0, defense: 0, strategy: 20, speed: 0 }, level: 45, redness: 2 }),
  slot(SLOTTED_HEROES[1].id),
  slot(SLOTTED_HEROES[2].id),
];

/** 造存档：魏智两支（战法不同）+ 一支别的队伍 */
function makeFile(): { file: PresetFile; weiA: TeamPreset; weiB: TeamPreset; other: TeamPreset } {
  let file: PresetFile = { maxNo: 0, list: [] };
  const a = addPreset(file, { name: '双减魏智', side: 'red', slots: trio(), now: 1_700_000_000_000 })!;
  file = a.file;
  const b = addPreset(file, { name: '战磐魏智', side: 'blue', slots: trio(), now: 1_700_000_060_000 })!;
  file = b.file;
  const c = addPreset(file, { name: '白马义从', side: 'red', slots: trio(), now: 1_700_000_120_000 })!;
  file = c.file;
  return { file, weiA: a.preset, weiB: b.preset, other: c.preset };
}

/** 额外依赖：木桩动作（useAsDummy）/ 木桩模式（dummyMode）；其余动作都是 spy */
function mount(
  getPresets: () => TeamPreset[],
  extra: { useAsDummy?: PresetPanelDeps['useAsDummy']; dummyMode?: boolean; omitUseAsDummy?: boolean } = {}
) {
  // 每个动作都是 spy，返回类型显式声明 → 既能被 openPresetPanel 接受，也能用 mockReturnValueOnce 注入错误分支
  const saveCurrent = vi.fn<(side: TeamSide, name: string) => PresetActionResult>(() => ({ presetId: 'new_id' }));
  const rename = vi.fn<(id: string, name: string) => PresetActionResult>(() => ({ presetId: 'x' }));
  const deps = {
    getPresets,
    saveCurrent,
    apply: vi.fn<(preset: TeamPreset, side: TeamSide) => void>(),
    rename,
    remove: vi.fn<(id: string) => void>(),
    onClose: vi.fn<() => void>(),
    ...(extra.omitUseAsDummy ? {} : { useAsDummy: extra.useAsDummy ?? vi.fn<(preset: TeamPreset) => void>() }),
    ...(extra.dummyMode ? { dummyMode: true } : {}),
  };
  const handle = openPresetPanel(deps);
  return { deps, handle, modal: document.querySelector('.preset-modal') as HTMLElement };
}

const items = () => Array.from(document.querySelectorAll('.preset-item'));
const itemNames = () => items().map((el) => (el.querySelector('.pi-name') as HTMLElement).textContent);
const clickByText = (root: ParentNode, text: string): void => {
  const el = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`找不到按钮：${text}`);
  (el as HTMLElement).click();
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('presetPanel · 列表与编号', () => {
  it('空存档：列表空态提示 + 详情占位 + 计数 0', () => {
    mount(() => []);
    expect(document.querySelector('.preset-empty')!.textContent).toContain('暂无预设');
    expect(document.querySelector('.preset-detail')!.textContent).toContain('从左侧选择一条预设查看详情');
    expect(document.querySelector('.preset-count')!.textContent).toBe('共 0 条 · 上限 50 条');
  });

  it('按编号升序展示，编号徽章 #1/#2/#3，默认选中第一条', () => {
    const { file } = makeFile();
    mount(() => file.list);
    expect(items()).toHaveLength(3);
    expect(items().map((el) => (el.querySelector('.pi-no') as HTMLElement).textContent)).toEqual(['#1', '#2', '#3']);
    expect(items()[0].classList.contains('on')).toBe(true);
    expect(document.querySelector('.preset-count')!.textContent).toBe('共 3 条 · 上限 50 条');
  });

  it('列表项展示：预设名、红/蓝标签、三将名、更新时间', () => {
    const { file, weiA } = makeFile();
    mount(() => file.list);
    const first = items()[0];
    expect(first.querySelector('.pi-name')!.textContent).toBe('双减魏智');
    expect(first.querySelector('.pi-side')!.textContent).toBe('红队');
    expect(first.querySelector('.pi-heroes')!.textContent).toBe(slotsSummary(weiA.slots));
    expect(first.querySelector('.pi-time')!.textContent).toBe(fmtTime(weiA.updatedAt));
    expect(items()[1].querySelector('.pi-side')!.textContent).toBe('蓝队');
  });

  it('点第二条 → 选中态与详情都切到该预设（编号/名字/边）', () => {
    const { file } = makeFile();
    mount(() => file.list);
    (items()[1] as HTMLElement).click();
    expect(items()[1].classList.contains('on')).toBe(true);
    expect(items()[0].classList.contains('on')).toBe(false);
    const head = document.querySelector('.preset-detail .pd-head')!;
    expect(head.querySelector('.pi-no')!.textContent).toBe('#2');
    expect(head.querySelector('.pd-title')!.textContent).toBe('战磐魏智');
    expect(head.querySelector('.pi-side')!.textContent).toBe('蓝队');
  });
});

describe('presetPanel · 搜索（用户场景）', () => {
  it('搜「魏智」命中两支同名套路不同战法的队伍；计数显示筛选比例', () => {
    const { file } = makeFile();
    mount(() => file.list);
    const search = document.querySelector('.preset-search') as HTMLInputElement;
    search.value = '魏智';
    search.dispatchEvent(new Event('input'));
    expect(itemNames()).toEqual(['双减魏智', '战磐魏智']);
    expect(document.querySelector('.preset-count')!.textContent).toBe('筛选出 2 / 3 条');
  });

  it('搜索无结果 → 提示；清空搜索恢复全部', () => {
    const { file } = makeFile();
    mount(() => file.list);
    const search = document.querySelector('.preset-search') as HTMLInputElement;
    search.value = '不存在的队';
    search.dispatchEvent(new Event('input'));
    expect(items()).toHaveLength(0);
    expect(document.querySelector('.preset-empty')!.textContent).toContain('没有匹配');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(items()).toHaveLength(3);
  });

  it('可按武将名搜索（面板内部把 heroId 解析成武将名）', () => {
    const { file } = makeFile();
    mount(() => file.list);
    const search = document.querySelector('.preset-search') as HTMLInputElement;
    search.value = HEROES[0].name;
    search.dispatchEvent(new Event('input'));
    const hit = itemNames();
    expect(hit.length).toBeGreaterThan(0);
    expect(hit).toContain('双减魏智');
  });
});

describe('presetPanel · 详情与动作', () => {
  it('详情展示三槽明细（大营/中军/前锋 + 武将名 + 等级 + 主战法）', () => {
    const { file } = makeFile();
    mount(() => file.list);
    const slots = document.querySelectorAll('.pd-slot');
    expect(slots).toHaveLength(3);
    expect(slots[0].querySelector('.pd-pos')!.textContent).toBe('大营');
    expect(slots[0].querySelector('.pd-hero-name')!.textContent).toBe(SLOTTED_HEROES[0].name);
    expect(slots[0].querySelector('.pd-lv')!.textContent).toBe('Lv.45');
    expect(slots[0].querySelector('.pd-skill.main')!.textContent).toBe(SKILL_REGISTRY[SLOTTED_HEROES[0].mainSkillId!].name);
    expect(slots[1].querySelector('.pd-meta')!.textContent).toContain('未佩戴宝物');
  });

  it('上场到红/蓝：把预设与目标边交给上层（主按钮随保存边切换）；上场后关闭面板', () => {
    const { file, weiA } = makeFile();
    const { deps } = mount(() => file.list);
    const actions = document.querySelector('.pd-actions')!;
    expect((actions.querySelector('[data-act="apply-red"]') as HTMLElement).className).not.toContain('beige');
    expect((actions.querySelector('[data-act="apply-blue"]') as HTMLElement).className).toContain('beige');
    clickByText(actions, '上场到蓝队');
    expect(deps.apply).toHaveBeenCalledWith(expect.objectContaining({ id: weiA.id, no: 1 }), 'blue');
    expect(document.querySelector('.preset-modal')).toBeNull();
    const second = mount(() => file.list);
    clickByText(document.querySelector('.pd-actions')!, '上场到红队');
    expect(second.deps.apply).toHaveBeenLastCalledWith(expect.objectContaining({ id: weiA.id }), 'red');
    expect(document.querySelector('.preset-modal')).toBeNull();
  });

  it('木桩队伍：点击把预设交给上层并关面板；原有的「覆盖为当前配置」按钮已撤', () => {
    const { file, weiB } = makeFile();
    const { deps } = mount(() => file.list);
    (items()[1] as HTMLElement).click();
    // 用户 2026-09-22：「上场到红队」本身就是覆盖红队 → 原「覆盖为当前配置」按钮已撤，原位改「设为木桩队伍」
    expect(document.querySelector('[data-act="overwrite"]')).toBeNull();
    const btn = document.querySelector('[data-act="dummy"]') as HTMLElement;
    expect(btn.textContent).toBe('设为木桩队伍');
    btn.click();
    expect(deps.useAsDummy).toHaveBeenCalledWith(expect.objectContaining({ id: weiB.id, no: 2 }));
    expect(document.querySelector('.preset-modal')).toBeNull(); // 与「上场」同口径：动作后关面板
  });

  it('重命名：弹窗预填原名，提交把新名字交给上层；失败时弹窗保留并显示错误', () => {
    const { file, weiA } = makeFile();
    const { deps } = mount(() => file.list);
    (document.querySelector('[data-act="rename"]') as HTMLElement).click();
    const input = document.querySelector('.preset-name-modal .pn-input') as HTMLInputElement;
    expect(input.value).toBe('双减魏智');
    deps.rename.mockReturnValueOnce({ error: '红队已有同名预设「双减魏智」，换个名字或直接覆盖' });
    input.value = '别的名字';
    clickByText(document.querySelector('.preset-name-modal')!, '保存名称');
    expect(deps.rename).toHaveBeenCalledWith(weiA.id, '别的名字');
    expect(document.querySelector('.preset-name-modal')).not.toBeNull();
    expect(document.querySelector('.pn-error')!.textContent).toContain('已有同名预设');
    deps.rename.mockReturnValueOnce({ presetId: weiA.id });
    clickByText(document.querySelector('.preset-name-modal')!, '保存名称');
    expect(document.querySelector('.preset-name-modal')).toBeNull();
  });

  it('删除需二次确认：第一次只改文案、第二次才真删', () => {
    const { file, weiA } = makeFile();
    const { deps } = mount(() => file.list);
    const btn = () => document.querySelector('[data-act="remove"]') as HTMLElement;
    btn().click();
    expect(deps.remove).not.toHaveBeenCalled();
    expect(btn().textContent).toBe('再点一次确认删除');
    btn().click();
    expect(deps.remove).toHaveBeenCalledWith(weiA.id);
  });

  it('切换选中会把「待确认删除」复位（避免误删另一条）', () => {
    const { file } = makeFile();
    const { deps } = mount(() => file.list);
    (document.querySelector('[data-act="remove"]') as HTMLElement).click();
    (items()[1] as HTMLElement).click();
    expect(document.querySelector('[data-act="remove"]')!.textContent).toBe('删除');
    (document.querySelector('[data-act="remove"]') as HTMLElement).click();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('底部「保存红队」：打开命名弹窗并调用 saveCurrent，成功后选中新预设', () => {
    const { file, other } = makeFile();
    const list = [...file.list];
    const { deps } = mount(() => list);
    deps.saveCurrent.mockImplementation(() => {
      const r = addPreset({ maxNo: 3, list }, { name: '新队', side: 'red', slots: trio(), now: 1 })!;
      list.length = 0;
      list.push(...r.file.list);
      return { presetId: r.preset.id };
    });
    clickByText(document.querySelector('.preset-foot')!, '保存红队');
    const input = document.querySelector('.preset-name-modal .pn-input') as HTMLInputElement;
    input.value = '新队';
    clickByText(document.querySelector('.preset-name-modal')!, '保存预设');
    expect(deps.saveCurrent).toHaveBeenCalledWith('red', '新队');
    expect(items()).toHaveLength(4);
    expect(document.querySelector('.preset-item.on .pi-name')!.textContent).toBe('新队');
    expect(other.no).toBe(3);
  });

  it('关闭：点「完成」移除面板并回调 onClose（点「×」同样）', () => {
    const { file } = makeFile();
    const { deps, handle } = mount(() => file.list);
    clickByText(document.querySelector('.preset-modal')!, '完成');
    expect(document.querySelector('.preset-modal')).toBeNull();
    expect(deps.onClose).toHaveBeenCalledTimes(1);
    mount(() => file.list);
    handle.close();
    expect(document.querySelectorAll('.preset-modal')).toHaveLength(1); // 第一次已关，第二次挂载的仍在
  });
});

describe('presetPanel · 命名弹窗', () => {
  it('空名提交 → 显示错误且不关闭；成功提交 → 关闭', () => {
    const onSubmit = vi.fn((name: string) => (name.trim() ? null : '预设名不能为空'));
    openPresetNameDialog({ title: '保存预设 · 红队', onSubmit });
    const input = document.querySelector('.pn-input') as HTMLInputElement;
    clickByText(document.querySelector('.preset-name-modal')!, '保存预设');
    expect(onSubmit).toHaveBeenCalledWith('');
    expect(document.querySelector('.preset-name-modal')).not.toBeNull();
    expect(document.querySelector('.pn-error')!.textContent).toBe('预设名不能为空');
    input.value = '双减魏智';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.pn-error')!.textContent).toBe('');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSubmit).toHaveBeenLastCalledWith('双减魏智');
    expect(document.querySelector('.preset-name-modal')).toBeNull();
  });

  it('取消按钮关闭弹窗且不提交', () => {
    const onSubmit = vi.fn(() => null);
    openPresetNameDialog({ title: '保存预设 · 蓝队', onSubmit });
    clickByText(document.querySelector('.preset-name-modal')!, '取消');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('.preset-name-modal')).toBeNull();
  });
});

describe('presetPanel · 工具函数', () => {
  it('fmtTime 固定 MM-DD HH:mm；slotsSummary 连接三将名、空槽显示空缺', () => {
    expect(fmtTime(new Date(2026, 8, 21, 15, 4).getTime())).toBe('09-21 15:04');
    expect(fmtTime(Number.NaN)).toBe('—');
    expect(slotsSummary([slot(null), slot(null), slot(null)])).toBe('空缺');
    const half = slotsSummary([slot(SLOTTED_HEROES[0].id), slot(null), slot(SLOTTED_HEROES[1].id)]);
    expect(half).toBe(`${SLOTTED_HEROES[0].name}、${SLOTTED_HEROES[1].name}`);
  });

  it('「保存预设」与队头另两个按钮共用同一套样式（米黄实心），不做金色特例', () => {
    const css = readFileSync(join('web', 'styles.css'), 'utf8');
    // 队头三个按钮必须在同一个 .btn.ghost.xxx 组里 → 外观完全一致
    expect(
      /\.btn\.ghost\.team-bonus,\s*\.btn\.ghost\.team-save-preset,\s*\.btn\.ghost\.team-clear\s*\{/.test(css)
    ).toBe(true);
    expect(/\.btn\.ghost\.team-bonus:hover,\s*\.btn\.ghost\.team-save-preset:hover,\s*\.btn\.ghost\.team-clear:hover\s*\{/.test(css)).toBe(true);
    // 不得再单独给「保存预设」改色（曾误加金色描边，与左右两个米黄按钮不一致）
    expect(/\.team-save-preset\s*\{/.test(css)).toBe(false);
  });

  it('面板 / 命名弹窗的按键都走「项目按键标准」（.btn.beige 米黄实心），不再有裸文字 .btn.ghost', () => {
    const { file } = makeFile();
    mount(() => file.list);
    const modal = document.querySelector('.preset-modal')!;
    const keys = [
      ...Array.from(modal.querySelectorAll<HTMLElement>('.pd-actions .btn')),
      ...Array.from(modal.querySelectorAll<HTMLElement>('.preset-foot .btn')),
    ];
    expect(keys.map((k) => k.textContent)).toEqual(['上场到红队', '上场到蓝队', '设为木桩队伍', '重命名', '删除', '保存红队', '保存蓝队', '完成']);
    for (const k of keys) {
      expect(k.classList.contains('btn'), `${k.textContent} 应是按钮`).toBe(true);
      expect(k.classList.contains('ghost'), `${k.textContent} 不该是裸文字按钮`).toBe(false);
      expect(k.classList.contains('done'), `${k.textContent} 不该是裸文字按钮`).toBe(false);
    }
    // 5 个动作里 4 个米黄（当前预设的保存边那个是金色主按钮）＋ 底栏 3 个米黄
    expect(modal.querySelectorAll('.pd-actions .btn.beige').length).toBe(4);
    expect(modal.querySelectorAll('.preset-foot .btn.beige').length).toBe(3);
    // 命名弹窗同样：取消也应该是米黄实心按钮
    openPresetNameDialog({ title: '保存预设 · 红队', onSubmit: () => null });
    const cancel = document.querySelector('.preset-name-modal .pn-cancel') as HTMLElement;
    expect(cancel.classList.contains('beige')).toBe(true);
    expect(cancel.classList.contains('ghost')).toBe(false);
  });
});

describe('presetPanel · 边与数据契约', () => {
  it('保存边为蓝队时，主按钮是「上场到蓝队」', () => {
    const { file } = makeFile();
    mount(() => file.list);
    (items()[1] as HTMLElement).click();
    const actions = document.querySelector('.pd-actions')!;
    expect((actions.querySelector('[data-act="apply-blue"]') as HTMLElement).className).not.toContain('beige');
    expect((actions.querySelector('[data-act="apply-red"]') as HTMLElement).className).toContain('beige');
    const side: TeamSide = 'blue';
    expect(side).toBe('blue');
  });
});

/**
 * 木桩队伍（用户 2026-09-22）：预设详情多一个「设为木桩队伍」动作 ——
 * 交给上层（main）设成伤害测试敌方并跳转实验室；从实验室打开时这个按钮是主按钮。
 */
describe('presetPanel · 木桩队伍动作', () => {
  it('提供 useAsDummy 时出现按钮：点击把预设交给上层并关面板；未提供则不渲染', () => {
    const { file, weiA } = makeFile();
    const plain = mount(() => file.list, { omitUseAsDummy: true });
    expect(plain.modal.querySelector('[data-act="dummy"]')).toBeNull();
    plain.handle.close();

    const useAsDummy = vi.fn<(preset: TeamPreset) => void>();
    const { modal } = mount(() => file.list, { useAsDummy });
    const btn = modal.querySelector('[data-act="dummy"]') as HTMLElement;
    expect(btn.textContent).toBe('设为木桩队伍');
    expect(btn.title).toContain('伤害测试');
    btn.click();
    expect(useAsDummy).toHaveBeenCalledWith(expect.objectContaining({ id: weiA.id, no: 1, name: '双减魏智' }));
    expect(document.querySelector('.preset-modal')).toBeNull(); // 与「上场」同口径：动作后关面板
  });

  it('木桩模式（dummyMode）：主按钮变「设为木桩队伍」，上场按钮退成米黄 beige', () => {
    const { file } = makeFile();
    const { modal } = mount(() => file.list, { useAsDummy: vi.fn(), dummyMode: true });
    const actions = modal.querySelector('.pd-actions')!;
    expect((actions.querySelector('[data-act="dummy"]') as HTMLElement).className).not.toContain('beige'); // 主按钮＝金色
    expect((actions.querySelector('[data-act="apply-red"]') as HTMLElement).className).toContain('beige');
    expect((actions.querySelector('[data-act="apply-blue"]') as HTMLElement).className).toContain('beige');
    // 其余动作不受影响（「覆盖为当前配置」已撤）
    expect(actions.querySelector('[data-act="overwrite"]')).toBeNull();
    expect(actions.querySelector('[data-act="remove"]')).toBeTruthy();
  });

  it('slotDetailHtml 导出：给实验室「木桩队伍」面板复用（含站位/等级/兵种特性/战法）', async () => {
    const { slotDetailHtml } = await import('./presetPanel');
    const html = slotDetailHtml(
      slot(SLOTTED_HEROES[0].id, [sampleSkill], { level: 45, secondaryTroop: '弩兵', secondaryTraits: ['齐射', '地利'] }),
      0
    );
    expect(html).toContain('大营');
    expect(html).toContain('Lv.45');
    expect(html).toContain('弩兵');
    expect(html).toContain('齐射');
  });
});
