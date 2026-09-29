/**
 * 全局「设置」面板 —— 主站顶栏 ⚙ 与 AI配将独立页共用**同一个弹窗**
 * ---------------------------------------------------------------------------
 * 设计口径：`docs/AI配将-页面布局设计.md` §6（① 模型接入 ② 额度与确认 ③ 我的 box ④ 数据 ⑤ 调试）
 * 真源：localStorage `dsh-advisor-settings-v1`（字段与旧抽屉逐字一致，迁移零成本）
 *
 * 纪律（需求③）：
 *   · **API key 只在这里**——独立页主界面与主站首屏都不出现 key 控件；
 *   · 严格模式（`strictBox`）在全应用**只有一份状态**：设置弹窗与「我的 box」面板各是一个视图，
 *     都走 `saveSettings` + `subscribeSettings`，不各存一份。
 */
import { DEFAULT_BUDGET, DEFAULT_CONFIRM_BATTLES } from './advisor/types';
import './settings.css';
import {
  SESSION_KEY,
  PROFILE_KEY,
  clearProfile,
  clearSession,
  defaultStore,
} from './advisor/memory';
import { BOX_KEY, clearBoxStore, loadBoxStore } from './advisor/box';
import { showNotice } from './notice';

export const SETTINGS_KEY = 'dsh-advisor-settings-v1';
/** 跑批缓存键（`web/advisor/cache.ts` 的默认 storageKey） */
export const CACHE_KEY = 'dsh-advisor-cache-v1';

export interface AdvisorSettings {
  baseUrl: string;
  model: string;
  key: string;
  maxCalls: number;
  maxBattles: number;
  maxTokens: number;
  /** 长搜索前先问（报价 + 确认） */
  askBeforeSearch: boolean;
  /** 超过多少场才问 */
  askFrom: number;
  /** 每轮结束自动整理「你的偏好」 */
  autoProfile: boolean;
  /** 严格按「我的 box」推荐（默认开） */
  strictBox: boolean;
}

const DEFAULTS: AdvisorSettings = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  key: '',
  maxCalls: DEFAULT_BUDGET.maxCalls,
  maxBattles: DEFAULT_BUDGET.maxBattles,
  maxTokens: DEFAULT_BUDGET.maxTokens,
  askBeforeSearch: true,
  askFrom: DEFAULT_CONFIRM_BATTLES,
  autoProfile: true,
  strictBox: true,
};

function coerce(p: Partial<AdvisorSettings>): AdvisorSettings {
  return {
    baseUrl: typeof p.baseUrl === 'string' && p.baseUrl ? p.baseUrl : DEFAULTS.baseUrl,
    model: typeof p.model === 'string' && p.model ? p.model : DEFAULTS.model,
    key: typeof p.key === 'string' ? p.key : DEFAULTS.key,
    maxCalls: Math.max(1, Math.floor(Number(p.maxCalls) || DEFAULTS.maxCalls)),
    maxBattles: Math.max(100, Math.floor(Number(p.maxBattles) || DEFAULTS.maxBattles)),
    maxTokens: Math.max(1000, Math.floor(Number(p.maxTokens) || DEFAULTS.maxTokens)),
    askBeforeSearch: p.askBeforeSearch ?? DEFAULTS.askBeforeSearch,
    askFrom: Math.max(1, Math.floor(Number(p.askFrom) || DEFAULTS.askFrom)),
    autoProfile: p.autoProfile ?? DEFAULTS.autoProfile,
    strictBox: p.strictBox ?? DEFAULTS.strictBox,
  };
}

let current: AdvisorSettings = readStored();

function readStored(): AdvisorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return coerce(JSON.parse(raw) as Partial<AdvisorSettings>);
  } catch {
    /* localStorage 不可用 → 默认值 */
  }
  return { ...DEFAULTS };
}

/** 干跑（不联网）：运行态，不落盘；没配 key 时自动开（旧抽屉口径） */
let dryRun = !current.key;
/** 用户**显式**在设置里拨过干跑开关（拨过之后就不再用"有没有 key"自动覆盖他的选择） */
let dryRunExplicit = false;

const listeners = new Set<(s: AdvisorSettings) => void>();

/** 当前设置（拷贝，调用方改不动内部状态） */
export function loadSettings(): AdvisorSettings {
  return { ...current };
}

/** 读-改-写，并广播给所有订阅者（设置弹窗 / 顾问页 / box 面板同步） */
export function saveSettings(patch: Partial<AdvisorSettings>): AdvisorSettings {
  const prevKey = current.key;
  current = coerce({ ...current, ...patch });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* 存不了只影响下次打开 */
  }
  // 刚填上 key 且他没显式拨过干跑开关 → 自动走真模型（否则"填了 key 却一直干跑"，2026-09-29 真机抓到）
  if (!dryRunExplicit && current.key && !prevKey) {
    dryRun = false;
    const box = document.querySelector<HTMLInputElement>('#set-fake');
    if (box) box.checked = false;
  }
  for (const cb of listeners) cb({ ...current });
  return { ...current };
}

export function subscribeSettings(cb: (s: AdvisorSettings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isDryRun(): boolean {
  return dryRun;
}

export function setDryRun(v: boolean): void {
  dryRun = v;
  dryRunExplicit = true;
  const box = document.querySelector<HTMLInputElement>('#set-fake');
  if (box) box.checked = v;
}

/* ─────────────────────────── 弹窗 ─────────────────────────── */

let maskEl: HTMLElement | null = null;
/** 弹窗 → DOM 的单向刷新（打开时与真源对齐；开着时被外部改动也跟着刷） */
let paintModal: (() => void) | null = null;

function buildModal(): HTMLElement {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.id = 'advisor-settings-modal';
  mask.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
      <div class="m-head">
        <h3>设置</h3>
        <button type="button" class="m-close" data-set-close aria-label="关闭">×</button>
      </div>
      <div class="m-body">
        <div class="set-group">
          <div class="set-gh">① 模型接入</div>
          <div class="set-fields">
            <label class="set-field wide">接口地址<input id="adv-base" type="text" /></label>
            <label class="set-field">模型<input id="adv-model" type="text" /></label>
            <label class="set-field">密钥<input id="adv-key" type="password" placeholder="sk-..." /></label>
          </div>
          <p class="set-hint">密钥只存在本机浏览器里，直连厂商；本页不发往任何服务器。</p>
        </div>
        <div class="set-group">
          <div class="set-gh">② 额度与确认</div>
          <div class="set-fields">
            <label class="set-field">调用次数上限<input id="adv-maxcalls" type="number" min="1" max="500" /></label>
            <label class="set-field">场次上限<input id="adv-maxbattles" type="number" min="100" step="1000" /></label>
            <label class="set-field">词元上限<input id="adv-maxtokens" type="number" min="1000" step="10000" /></label>
            <label class="set-field">超过多少场先问<input id="adv-askfrom" type="number" min="1" step="500" /></label>
          </div>
          <label class="set-chk"><input id="adv-ask" type="checkbox" /> <span>长搜索先问我（报价 + 确认后才跑）</span></label>
        </div>
        <div class="set-group">
          <div class="set-gh">③ 我的 box</div>
          <label class="set-chk"><input id="set-strict" type="checkbox" /> <span>严格按我的 box 推荐（与「我的 box」面板同一个开关，只有一份状态）：**配将搜索**只在你有的将法里选；方案里出现没有的将法会被标出来、不能一键应用（比较 / 测算不受它限制）</span></label>
        </div>
        <div class="set-group">
          <div class="set-gh">④ 数据</div>
          <div class="set-row">
            <button type="button" class="btn ghost set-clear" data-clear="cache">清空跑批缓存</button>
            <button type="button" class="btn ghost set-clear" data-clear="session">清空当前会话</button>
            <button type="button" class="btn ghost set-clear" data-clear="profile">清空偏好档案</button>
            <button type="button" class="btn ghost set-clear" data-clear="box">清空我的 box</button>
          </div>
          <p class="set-hint">键名：<code>${CACHE_KEY}</code> / <code>${SESSION_KEY}</code> / <code>${PROFILE_KEY}</code> / <code>${BOX_KEY}</code></p>
        </div>
        <div class="set-group">
          <div class="set-gh">⑤ 调试</div>
          <label class="set-chk"><input id="set-fake" type="checkbox" /> <span>干跑（不联网、不花 token，链路完全一样）</span></label>
        </div>
      </div>
      <div class="m-foot">
        <span class="set-hint">改动即时生效并落盘</span>
        <span style="flex:1 1 auto"></span>
        <button type="button" class="btn beige" data-set-close>完成</button>
      </div>
    </div>`;
  document.body.appendChild(mask);

  const v = <T extends HTMLElement>(sel: string): T => mask.querySelector(sel) as T;

  /** 把内部状态刷到控件上（唯一方向：state → DOM） */
  const paint = (): void => {
    v<HTMLInputElement>('#adv-base').value = current.baseUrl;
    v<HTMLInputElement>('#adv-model').value = current.model;
    v<HTMLInputElement>('#adv-key').value = current.key;
    v<HTMLInputElement>('#adv-maxcalls').value = String(current.maxCalls);
    v<HTMLInputElement>('#adv-maxbattles').value = String(current.maxBattles);
    v<HTMLInputElement>('#adv-maxtokens').value = String(current.maxTokens);
    v<HTMLInputElement>('#adv-askfrom').value = String(current.askFrom);
    v<HTMLInputElement>('#adv-ask').checked = current.askBeforeSearch;
    v<HTMLInputElement>('#set-strict').checked = current.strictBox;
    v<HTMLInputElement>('#set-fake').checked = dryRun;
  };
  paint();
  paintModal = paint;

  const read = (): void => {
    saveSettings({
      baseUrl: v<HTMLInputElement>('#adv-base').value.trim(),
      model: v<HTMLInputElement>('#adv-model').value.trim(),
      key: v<HTMLInputElement>('#adv-key').value.trim(),
      maxCalls: Number(v<HTMLInputElement>('#adv-maxcalls').value),
      maxBattles: Number(v<HTMLInputElement>('#adv-maxbattles').value),
      maxTokens: Number(v<HTMLInputElement>('#adv-maxtokens').value),
      askFrom: Number(v<HTMLInputElement>('#adv-askfrom').value),
      askBeforeSearch: v<HTMLInputElement>('#adv-ask').checked,
      strictBox: v<HTMLInputElement>('#set-strict').checked,
    });
  };

  // 「干跑」是运行态开关（不落盘）：勾上 = 不联网、不花 token（原来这个框没绑事件，是死的 —— 2026-09-29 真机抓到）。
  // ⚠️ 必须注册在 `read` **之前**：`read()` 会 saveSettings → 广播 → `paint()` 把 `#set-fake` 刷回 dryRun，
  // 排在后面读到的 `t.checked` 已被刷回旧值（先跑才发现这个坑）。
  mask.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t?.id === 'set-fake') setDryRun(t.checked);
  });
  // 输入即存（失焦/回车都落盘；不做节流——字段极少）
  mask.addEventListener('change', read);
  mask.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-set-close]')) {
      closeSettingsPanel();
      return;
    }
    const clear = t.closest<HTMLElement>('[data-clear]');
    if (clear) {
      const kind = clear.dataset.clear;
      const store = defaultStore();
      if (kind === 'cache') {
        try {
          localStorage.removeItem(CACHE_KEY);
        } catch {
          /* 忽略 */
        }
        showNotice('已清空跑批缓存');
      } else if (kind === 'session') {
        clearSession(store);
        showNotice('已清空当前会话（刷新后从空白开始）');
      } else if (kind === 'profile') {
        clearProfile(store);
        showNotice('已清空偏好档案');
      } else if (kind === 'box') {
        clearBoxStore(store);
        showNotice(`已清空我的 box（当前 ${loadBoxStore(store).profiles.length} 个档案）`);
      }
      return;
    }
    if (e.target === mask) closeSettingsPanel();
  });

  // 外部改状态（别处改了严格模式）→ 同步到弹窗
  subscribeSettings(() => {
    if (mask.classList.contains('on')) paint();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mask.classList.contains('on')) closeSettingsPanel();
  });

  return mask;
}

/** 打开设置弹窗（同一个 DOM 节点反复复用；主站与独立页共用） */
export function openSettingsPanel(): void {
  if (!maskEl) maskEl = buildModal();
  maskEl.classList.add('on');
  /* 打开即与真源对齐：关着的时候别处改过设置（比如 box 面板关了严格模式），不能拿旧值糊弄 */
  paintModal?.();
  const first = maskEl.querySelector<HTMLInputElement>('#adv-base');
  first?.focus({ preventScroll: true });
}

export function closeSettingsPanel(): void {
  maskEl?.classList.remove('on');
}

export function isSettingsOpen(): boolean {
  return Boolean(maskEl?.classList.contains('on'));
}

/** 测试用：丢掉已建的弹窗（每次挂载重建，避免跨用例残留） */
export function __resetSettingsPanel(): void {
  maskEl?.remove();
  maskEl = null;
  paintModal = null;
}

/**
 * 测试用：把内存态重置成"从盘上重读"——等价于新开一个页面。
 * `localStorage.clear()` 已经不够了：设置现在是模块单例（跨用例会串），所以两个都要做。
 */
export function __resetSettings(): void {
  current = readStored();
  dryRun = !current.key;
  dryRunExplicit = false;
  listeners.clear();
  __resetSettingsPanel();
}
