/**
 * 全局「设置」弹窗（`web/settings.ts`）——主站与 AI配将独立页共用同一个
 * ---------------------------------------------------------------------------
 * 设计口径：`docs/AI配将-页面布局设计.md` §6（① 模型接入 ② 额度与确认 ③ 我的 box ④ 数据 ⑤ 调试）
 * 需求③：API key 只在这里；严格模式在全应用只有一份状态（设置弹窗与 box 面板是同一份）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
  subscribeSettings,
  isDryRun,
  setDryRun,
  openSettingsPanel,
  closeSettingsPanel,
  isSettingsOpen,
  __resetSettings,
} from './settings';
import { SESSION_KEY, PROFILE_KEY } from './advisor/memory';
import { BOX_KEY } from './advisor/box';

const modal = (): HTMLElement | null => document.querySelector('#advisor-settings-modal');

describe('设置（真源 + 弹窗）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSettings();
  });

  it('同一把键读写：saveSettings → 落盘 → 重新读回（两个页面看到同一份）', () => {
    saveSettings({ baseUrl: 'https://example.test/v1', model: 'my-model', key: 'sk-test', maxCalls: 7, strictBox: false });
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as Record<string, unknown>;
    expect(raw.model).toBe('my-model');
    expect(raw.key).toBe('sk-test');
    expect(raw.strictBox).toBe(false);

    __resetSettings(); // 等价于"换一个页面打开"
    const again = loadSettings();
    expect(again.baseUrl).toBe('https://example.test/v1');
    expect(again.maxCalls).toBe(7);
    expect(again.strictBox).toBe(false);
  });

  it('弹窗：打开后 5 组齐全、字段带值、能改能关；改动即时落盘并广播', () => {
    saveSettings({ model: 'ds-flash', maxBattles: 60000 });
    openSettingsPanel();
    const m = modal();
    expect(m).toBeTruthy();
    expect(isSettingsOpen()).toBe(true);
    expect(m!.textContent).toContain('① 模型接入');
    expect(m!.textContent).toContain('④ 数据');
    expect((m!.querySelector('#adv-model') as HTMLInputElement).value).toBe('ds-flash');
    expect((m!.querySelector('#adv-maxbattles') as HTMLInputElement).value).toBe('60000');

    const seen: boolean[] = [];
    const un = subscribeSettings((s) => seen.push(s.strictBox));
    const strict = m!.querySelector('#set-strict') as HTMLInputElement;
    strict.checked = false;
    strict.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seen).toEqual([false]);
    expect(loadSettings().strictBox).toBe(false);
    un();

    closeSettingsPanel();
    expect(isSettingsOpen()).toBe(false);
  });

  it('严格模式只有一份状态：saveSettings 改它 → 弹窗重新打开时跟着变（不各存一份）', () => {
    openSettingsPanel();
    closeSettingsPanel();
    saveSettings({ strictBox: false });
    openSettingsPanel();
    expect((modal()!.querySelector('#set-strict') as HTMLInputElement).checked).toBe(false);
  });

  it('干跑是运行态：不落盘；没 key 时默认开（旧抽屉口径）', () => {
    expect(isDryRun()).toBe(true); // 默认没 key
    setDryRun(false);
    expect(loadSettings().key).toBe('');
    expect(Object.keys(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'))).not.toContain('dryRun');
    saveSettings({ key: 'sk-x' });
    __resetSettings();
    expect(isDryRun()).toBe(false); // 有 key 就不再自动干跑
  });

  it('干跑开关是活的：设置弹窗里拨它真的切状态（原来没绑事件，2026-09-29 真机抓到）', () => {
    openSettingsPanel();
    const fake = modal()!.querySelector('#set-fake') as HTMLInputElement;
    expect(fake.checked).toBe(true); // 没 key → 默认干跑
    fake.checked = false;
    fake.dispatchEvent(new Event('change', { bubbles: true }));
    expect(isDryRun()).toBe(false);
    fake.checked = true;
    fake.dispatchEvent(new Event('change', { bubbles: true }));
    expect(isDryRun()).toBe(true);
  });

  it('填上 key 后自动切回真模型（除非用户自己拨过干跑开关）', () => {
    expect(isDryRun()).toBe(true);
    saveSettings({ key: 'sk-real' });
    expect(isDryRun()).toBe(false); // 填 key = 想用真模型，不该继续干跑

    setDryRun(true); // 用户显式拨回干跑
    saveSettings({ key: 'sk-real-2' });
    expect(isDryRun()).toBe(true); // 尊重他的选择
  });

  it('④ 数据：清空当前会话 / 偏好档案 / box 真的落盘（键名与面板一致）', () => {
    localStorage.setItem(SESSION_KEY, '{"turns":[]}');
    localStorage.setItem(PROFILE_KEY, '{"items":[]}');
    localStorage.setItem(BOX_KEY, '{"profiles":[]}');
    openSettingsPanel();
    const click = (kind: string): void => {
      (modal()!.querySelector(`[data-clear="${kind}"]`) as HTMLButtonElement).click();
    };
    click('session');
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    click('profile');
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
    click('box');
    expect(localStorage.getItem(BOX_KEY)).toBeNull(); // 清空 = 删键（box.ts clearBoxStore 的口径）
  });
});
