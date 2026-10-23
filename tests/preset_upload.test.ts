/** @vitest-environment jsdom */
/**
 * 预设识图 · 上传弹窗（jsdom）
 * ---------------------------------------------------------------------------
 * 锁的是用户验收那条链：选图 → 识别 → **确认卡**（三将 + 红度 + 三战法，可改名 / 可切队 / 可点候选修正）
 * → 「存入我的预设」（交给注入的 `save`，等价 main.ts 的 `saveSlotsAsPreset`）。
 * 读图本身用假传输（`createFakeTransport` 的 `onceReply`），不打网络。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPresetUploadDialog, type PresetScanSaveInput, type PresetUploadHandle } from '../web/presetUpload';
import { openPresetPanel } from '../web/presetPanel';
import { createFakeTransport } from '../web/advisor/transport';
import { SAMPLE_TEAM_REPLY } from '../web/presetScanVision';

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

let handle: PresetUploadHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
  document.body.innerHTML = '';
});

/** 等假传输的 Promise 链跑完（once() → 解析 → 渲染确认卡） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const texts = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').trim());

const reply = (json: unknown): string => ['```json', JSON.stringify(json), '```'].join('\n');

function mount(opts: { replyText?: string; fake?: boolean; save?: (i: PresetScanSaveInput) => { error?: string; presetId?: string } } = {}) {
  const save = vi.fn(opts.save ?? (() => ({ presetId: 'p_scan_1' })));
  const onSaved = vi.fn();
  handle = openPresetUploadDialog({
    save,
    onSaved,
    images: [IMG],
    ...(opts.fake ? { fake: true } : { transport: createFakeTransport([], { onceReply: () => opts.replyText ?? SAMPLE_TEAM_REPLY }) }),
  });
  return { save, onSaved };
}

describe('上传图片 · 识别队伍（确认卡）', () => {
  it('选完图自动识别，确认卡三行 = 大营/中军/前锋 + 红度 + 主战法/装配战法', async () => {
    mount();
    await flush();
    expect(texts('.scan-pos')).toEqual(['大营', '中军', '前锋']);
    expect(texts('.scan-name')).toEqual(['司马炎', '乐进', '于禁']);
    // 等级一律 40（截图上是 50，确认卡显示落库口径）
    expect(texts('.scan-lv')).toEqual(['Lv.40', 'Lv.40', 'Lv.40']);
    // 九条战法：3 主 + 6 装配
    expect(document.querySelectorAll('.scan-skill')).toHaveLength(9);
    expect(texts('.scan-skill.main')).toEqual(['谋议宏图', '奋疾先登', '当敌制决']);
    // 预设名预填 = 三名，落队默认红队
    expect((document.querySelector('.scan-name-input') as HTMLInputElement).value).toBe('识图·司马炎-乐进-于禁');
    expect(document.querySelector('.scan-side-btn.on')?.getAttribute('data-side')).toBe('red');
  });

  it('点「存入我的预设」→ 交给 save（三槽 / 等级 40 / 红度 / 装配战法），成功后关窗并回调', async () => {
    const { save, onSaved } = mount();
    await flush();
    (document.querySelector('.scan-save') as HTMLElement).click();

    expect(save).toHaveBeenCalledTimes(1);
    const input = save.mock.calls[0][0] as PresetScanSaveInput;
    expect(input.name).toBe('识图·司马炎-乐进-于禁');
    expect(input.side).toBe('red');
    expect(input.slots).toHaveLength(3);
    expect(input.slots.map((s) => s.heroId)).toEqual(['h703', 'h685', 'h796']);
    expect(input.slots.map((s) => s.level)).toEqual([40, 40, 40]);
    expect(input.slots.map((s) => s.redness)).toEqual([5, 5, 5]);
    // 主战法不进 extraSkillIds（否则引擎会判定两次），每槽恰好 2 条装配战法
    for (const s of input.slots) expect(s.extraSkillIds).toHaveLength(2);
    expect(onSaved).toHaveBeenCalledWith('p_scan_1');
    expect(document.querySelector('.scan-modal')).toBeNull();
  });

  it('切到蓝队 → side 跟着变', async () => {
    const { save } = mount();
    await flush();
    (document.querySelector('.scan-side-btn[data-side="blue"]') as HTMLElement).click();
    (document.querySelector('.scan-save') as HTMLElement).click();
    expect((save.mock.calls[0][0] as PresetScanSaveInput).side).toBe('blue');
  });

  it('预设名可改（空名回落到自动名）', async () => {
    const { save } = mount();
    await flush();
    const input = document.querySelector('.scan-name-input') as HTMLInputElement;
    input.value = '我的司马炎队';
    (document.querySelector('.scan-save') as HTMLElement).click();
    expect((save.mock.calls[0][0] as PresetScanSaveInput).name).toBe('我的司马炎队');
  });

  it('保存失败（比如同队重复武将）→ 弹窗不关，把错误写在页脚', async () => {
    const { save } = mount({ save: () => ({ error: '识别结果不能直接存：队内重复武将（司马炎）' }) });
    await flush();
    (document.querySelector('.scan-save') as HTMLElement).click();
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.scan-foot-hint')?.textContent).toContain('队内重复武将');
    expect(document.querySelector('.scan-modal')).not.toBeNull();
  });

  it('同名多版：列出候选，点一下就能定案并落库', async () => {
    const { save } = mount({
      replyText: reply({
        slots: [
          { position: '大营', heroName: '吕布', redness: 5, skillNames: [] },
          { position: '中军', heroName: '司马炎', redness: 5, skillNames: [] },
          { position: '前锋', heroName: '甘宁', redness: 5, skillNames: [] },
        ],
      }),
    });
    await flush();
    expect(texts('.scan-tag')).toEqual(['未识别']);
    const picks = [...document.querySelectorAll<HTMLElement>('.scan-pick')];
    expect(picks.length).toBeGreaterThan(1);
    picks[0].click();
    // 定案后不再是「未识别」，武将行出现
    expect(document.querySelectorAll('.scan-tag')).toHaveLength(0);
    (document.querySelector('.scan-save') as HTMLElement).click();
    const input = save.mock.calls[0][0] as PresetScanSaveInput;
    expect(input.slots[0].heroId).toBe(picks[0].dataset.id);
  });

  it('一个武将都没认出来 → 不落库，页脚提示', async () => {
    const { save } = mount({ replyText: reply({ slots: [{ position: '大营', heroName: '查无此将', redness: 5, skillNames: [] }] }) });
    await flush();
    (document.querySelector('.scan-save') as HTMLElement).click();
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector('.scan-foot-hint')?.textContent).toContain('一个武将都没认出来');
  });

  it('干跑模式：界面上明确标注「不是真读图」', async () => {
    mount({ fake: true });
    await flush();
    expect(document.querySelector('.scan-badge')?.textContent).toContain('干跑示例');
    expect(document.querySelectorAll('.scan-row')).toHaveLength(3);
  });

  it('识别失败不静默：状态栏给出原因，仍停在选图页', async () => {
    const save = vi.fn(() => ({ presetId: 'x' }));
    handle = openPresetUploadDialog({
      save,
      images: [IMG],
      transport: createFakeTransport([{ text: '这张图我看不懂' }], { onceReply: () => '这张图我看不懂' }),
    });
    await flush();
    expect(document.querySelector('.scan-status')?.textContent).toContain('识别失败');
    expect(document.querySelector('.scan-status')?.className).toContain('bad');
    expect(document.querySelector('.scan-save')).toBeNull();
  });

  it('重选图片回到选图页（确认卡清空）', async () => {
    mount();
    await flush();
    (document.querySelector('.scan-reset') as HTMLElement).click();
    expect(document.querySelector('.scan-drop')).not.toBeNull();
    expect(document.querySelector('.scan-save')).toBeNull();
  });
});

describe('「热门预设」面板上的入口', () => {
  const openPanel = (saveScanned?: (i: PresetScanSaveInput) => { error?: string; presetId?: string }): void => {
    openPresetPanel({
      getPresets: () => [],
      saveCurrent: () => ({ presetId: 'x' }),
      saveAsMine: () => ({ presetId: 'x' }),
      apply: () => {},
      rename: () => ({ presetId: 'x' }),
      remove: () => {},
      ...(saveScanned ? { saveScanned } : {}),
    });
  };

  it('注入了 saveScanned 才渲染「上传图片」，位置在标题行（× 左边）', () => {
    openPanel(vi.fn(() => ({ presetId: 'p1' })));
    const btn = document.querySelector('.preset-modal .m-head .preset-upload') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('上传图片');
    // 同一行里排在关闭键之前
    const head = document.querySelector('.preset-modal .m-head') as HTMLElement;
    expect([...head.children].map((c) => c.className).indexOf('btn beige preset-upload')).toBeLessThan(
      [...head.children].map((c) => c.className).indexOf('m-close')
    );
  });

  it('没注入 saveScanned（老调用方）→ 不出这个入口', () => {
    openPanel();
    expect(document.querySelector('.preset-upload')).toBeNull();
  });

  it('点「上传图片」→ 打开识图弹窗', () => {
    openPanel(vi.fn(() => ({ presetId: 'p1' })));
    (document.querySelector('.preset-upload') as HTMLElement).click();
    expect(document.querySelector('.scan-modal')).not.toBeNull();
    expect(document.querySelector('.scan-modal .m-head h3')?.textContent).toBe('上传图片 · 识别队伍');
  });
});
