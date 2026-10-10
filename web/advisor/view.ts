/**
 * AI 顾问 · 主站抽屉（view 层）
 * ---------------------------------------------------------------------------
 * 纪律（见 `docs/AI配将顾问-设计.md` §2/§7）：
 *   · **不认识引擎**——数字一律从 `AdvisorTurn.checks` / `ToolResult.data` 直读，不自己算；
 *   · LLM 也不参与数字路径——方案卡上的每个数都能点回某次工具返回或标准口径复算；
 *   · 三道关（合法 / 可溯源 / 已复算）缺一不可，`check.apply.enabled` 为 false 时「应用」禁用并显示原因。
 *
 * 记忆层（`docs/AI配将顾问-设计.md` §14，对应 harness 的 pre-step 注入 + turn-stopping 写回）：
 *   · **会话**：每轮结束（含中断）把「对话 + 证据清单 + 方案卡结论」落进 `memory.ts` 的会话键；
 *     挂载时 `renderAll()` 从盘上重放（正文 + 证据清单 + 最后一轮方案卡可继续点「应用」）→ 刷新不丢上下文；
 *   · **偏好**：每轮把 `renderProfileBlock()` 交给 loop 作为 system 块注入；轮末再跑一次抽取（`prefs.ts`）
 *     合并进档案。抽取是**旁路**：失败、没 key、关掉开关都只影响档案，不影响对话。
 */
import { SKILL_REGISTRY } from '../../src/data/skills';
import { avatarSrc, getHeroById, gradeFrame, gradeRibbon, MAIN_SKILL_IDS, skillGrade, skillTypeIcon, SLOTTED_HEROES } from '../heroes';
import {
  activeProfile,
  addProfile,
  boxAddHeroes,
  boxAddSkills,
  boxRemoveHero,
  boxRemoveSkill,
  boxSummaryText,
  boxViewOf,
  emptyBox,
  heroRows,
  loadBoxStore,
  matchRecognition,
  mergeRecognition,
  removeProfile,
  renameProfile,
  renderBoxBlock,
  saveBoxStore,
  searchHeroCandidates,
  searchSkillCandidates,
  setActiveProfile,
  skillRows,
  withBox,
  type BoxMatchResult,
  type BoxProfile,
  type BoxStore,
  type BoxView,
  type HeroMatch,
  type SkillMatch,
} from './box';
import { createLocalCache } from './cache';
import { cfgOf } from './gate';
import { runAdvisorTurn, type AdvisorEvent } from './loop';
import { routeBadge } from './router';
import { evidenceZh, toolZh, TraceLine } from './trace';
import {
  MAX_IMAGES,
  SAMPLE_BOX_REPLY,
  filesToDataUrls,
  recognizeBox,
} from './vision';
import {
  appendTurn,
  clearProfile,
  clearSession,
  defaultStore,
  emptySession,
  ensureTask,
  historyFrom,
  loadProfile,
  loadSession,
  mergePreferences,
  newTurnId,
  normalizePref,
  removePreference,
  renderProfileBlock,
  renderTaskBlock,
  saveProfile,
  saveSession,
  stampText,
  stripInjected,
  toStoredTurn,
  updateTurn,
  type AdvisorSession,
  type PrefProfile,
  type StoredTurn,
} from './memory';
import { createProfileExtractor, type PrefExtractResult } from './prefs';
import { createBrowserTransport, createFakeTransport, type AdvisorSettings, type TokenUsage } from './transport';
import { makeCtx, type ToolCtx } from './tools';
import { asset } from '../assets';
/** 设置真源：`web/settings.ts`（主站顶栏 ⚙ 与独立页共用同一个弹窗，只有一份状态） */
import {
  isDryRun,
  loadSettings,
  openSettingsPanel,
  saveSettings,
  subscribeSettings,
  type AdvisorSettings as AdvisorConfig,
} from '../settings';
import {
  DEFAULT_BUDGET,
  DEFAULT_CONFIRM_BATTLES,
  DEFAULT_DUMMY,
  PLAN_POSITIONS,
  type AdvisorPlan,
  type AdvisorTurn,
  type PlanCheck,
  type PlanPosition,
  type PoolHint,
  type SearchQuote,
  type ToolCallRecord,
} from './types';
import type { AdvisorHost } from '../advisorHost';
/** 槽位卡直接复用主站 `renderSlot`（立绘 + 战法图标）：侧栏与主站看起来必须是同一套东西 */
import { emptySlot, renderSlot, type EditorHandlers, type SlotState } from '../teamEditor';
import { addPresetIdToPool, loadMergedPool, removeUserOpponent, setOpponentEnabled } from '../opponentPool';
import { readPresetFile } from '../presetStore';

/** 只读槽位卡的占位 handler：侧栏不可编辑（点击已被 CSS 关掉，这里只是 renderSlot 的形参） */
const READONLY_HANDLERS: EditorHandlers = {
  onPickHero: () => {},
  onMoveSlot: () => {},
  onAddSkill: () => {},
  onRemoveSkill: () => {},
  onSetFreePoints: () => {},
  onSetRedness: () => {},
  onSetLevel: () => {},
  onSetSecondaryTroop: () => {},
  onSetSecondaryTrait: () => {},
  onSetTreasure: () => {},
  onRemoveHero: () => {},
  onClearTeam: () => {},
};

const FAKE_RUNS = 20;

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const heroName = (id: string): string => getHeroById(id)?.name ?? id;
const skillName = (id: string): string => SKILL_REGISTRY[id]?.name ?? id;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const clipText = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 干跑演示用的方案：优先用面板当前队伍；**面板为空时**退回库里示例三人（正文里会说明） */
function fakePlanFor(hostPlan: AdvisorPlan): { plan: AdvisorPlan; demo: boolean } {
  if (hostPlan.slots.length >= 1) return { plan: hostPlan, demo: false };
  const ids = SLOTTED_HEROES.slice(0, 3).map((h) => h.id);
  return {
    plan: {
      slots: ids.map((heroId, i) => ({ position: PLAN_POSITIONS[i] ?? '中军', heroId, level: 40, skillIds: [] })),
      coreUnitIds: [],
      dummy: { ...DEFAULT_DUMMY },
    },
    demo: true,
  };
}

/** 干跑脚本（没配 key 时用）：读配置 → 真跑 20 场 → 用真实 evidenceId 出方案，链路完全一样 */
function fakeScript(plan: AdvisorPlan, demo: boolean) {
  return createFakeTransport([
    { calls: [{ id: 'c1', name: 'get_config', args: {} }] },
    { calls: [{ id: 'c2', name: 'simulate', args: { plan, runs: FAKE_RUNS } }] },
    {
      text: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'tool');
        const id = /"evidenceId":"([^"]+)"/.exec(last?.content ?? '')?.[1] ?? 'ev-unknown';
        return [
          '（干跑演示：没接真模型，只验证链路与校验门）',
          demo ? '（你的配将区还是空的，这里用库里的示例三人演示一遍完整流程）' : '',
          '',
          '我先读了当前配将区，再对标准木桩真跑 20 场，拿到核心将伤害期望与 95% 半宽（见方案卡上的证据行）。',
          '方案卡上的数字来自「标准口径复算」（固定种子 20 场），不是模型写的。',
          '',
          '```json',
          JSON.stringify({ plans: [{ title: demo ? '示例三人（面板为空）' : '当前配置（原样）', plan, evidenceIds: [id] }] }),
          '```',
        ]
          .filter((x) => x !== '')
          .join('\n');
      },
    },
  ]);
}

export interface AdvisorViewOpts {
  host: AdvisorHost;
  /** 测试注入：假 transport（生产走 `createBrowserTransport`） */
  transport?: ReturnType<typeof createFakeTransport>;
  /** 测试注入：完整 ctx（生产按设置构造） */
  ctx?: ToolCtx;
  /** 强制干跑（无 key 时自动干跑） */
  fake?: boolean;
  /**
   * 偏好抽取器：缺省 = 用本轮 transport 造一个（`transport.once` 不存在时自动空转）。
   * 传 `false` = 本轮不整理偏好（测试 / 想完全手填时用）。
   */
  extract?: ((input: { userText: string; answer: string; profile: PrefProfile }) => Promise<PrefExtractResult>) | false;
  /**
   * 主站内嵌时的「回配将台」。只换房间，调用方负责把本视图藏起来；
   * 本轮请求继续跑，回来还能看到进度。
   */
  onLeave?: () => void;
  /** 一轮开始 / 结束。主站用来在顶栏留「还在跑」的标记。 */
  onRunning?: (running: boolean) => void;
}

export interface AdvisorView {
  open(): void;
  close(): void;
  /** 人去了另一个房间：键盘 / 粘贴不再由这里接管，进行中的一轮不中断 */
  park(): void;
  isOpen(): boolean;
  destroy(): void;
  /** 测试专用：等价于输入并点「发送」 */
  __send(text: string): Promise<void>;
}

export function mountAdvisor(root: HTMLElement, opts: AdvisorViewOpts): AdvisorView {
  let settings = loadSettings();
  /** Esc：先关浮层；运行中连按两次 = 停止（设计文档 §7.4） */
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  const unsubSettings = subscribeSettings((s) => {
    settings = s;
    if (built) syncSettingsViews();
  });
  let built = false;
  let destroyed = false;
  let running = false;
  /** 人在配将台：视图还在，但不抢 Esc / 粘贴 */
  let parked = false;
  let controller: AbortController | null = null;
  let usage: TokenUsage | null = null;
  let battles = 0;
  let tokens = 0;
  let trace = new TraceLine();

  // ── 记忆层状态（挂载即从盘上恢复：刷新不丢上下文）──
  const store = defaultStore();
  let session: AdvisorSession = loadSession(store) ?? emptySession();
  let profile: PrefProfile = loadProfile(store);
  /** 本轮正在跑的 id / 提问 / 模式 / 已收到的正文 / 已跑完的证据（中断兜底用） */
  let inFlight: { id: string; q: string; mode: string; text: string; records: ToolCallRecord[] } | null = null;

  // ── 「我的 box」状态（识图建档，设计文档 §15）──
  /** 多档案（每个用户一份）+ 当前档案；挂载即从盘上恢复 */
  let boxStore: BoxStore = loadBoxStore(store);
  /** 已选但还没识别的截图（data URL，只在这个面板的生命周期里活着；不落盘） */
  let pendingImages: string[] = [];
  /** 上一次识别里"需要人来定"的条目（同名多版 / 库里没有）——不落盘，重识别即可复现 */
  let pendingMatches: BoxMatchResult | null = null;
  let recognizing = false;

  const wrap = document.createElement('div');
  /* 独立页（设计文档 §9/§17）：不再是右侧抽屉，而是整页骨架；`.open` 表示"页面已就绪" */
  wrap.className = 'advisor-page open';
  root.appendChild(wrap);

  const el = <T extends HTMLElement>(sel: string): T => wrap.querySelector(sel) as T;

  function build(): void {
    built = true;
    wrap.innerHTML = `
      <header class="advisor-top">
        <button type="button" class="advisor-rail-toggle" aria-expanded="false" aria-controls="advisor-rail" title="展开 / 收起左侧栏（展开 = 工作台）">
          <svg class="advisor-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9.5 4.5v15"/></svg>
        </button>
        <img class="advisor-logo" src="${asset('/rate-logo.png')}" alt="率土之滨" title="率土之滨" />
        <h1 class="advisor-title">AI配将 <span class="advisor-team">· ${esc(opts.host.teamLabel)}</span></h1>
        <span class="advisor-team-inline"></span>
        <span class="advisor-top-spacer"></span>
        <button type="button" class="advisor-chip on" data-sheet="box" title="当前 box 档案（点击管理）">
          <span class="advisor-chip-dot"></span><span class="advisor-box-sum">还没建档</span>
        </button>
        <span class="advisor-chip advisor-strict-chip" title="严格模式：配将搜索只在你有的将法里选（比较 / 测算不受限）">严格按 box</span>
        <span class="advisor-top-divider"></span>
        <a class="btn beige sm advisor-back" href="./index.html" title="回到主站配将台">← 返回配将</a>
        <button type="button" class="btn beige sm advisor-icon-btn" data-settings title="设置（模型 / 额度 / 数据）" aria-label="设置">
          <svg class="advisor-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.6l1.9 1.1M17.2 15.3l1.9 1.1M4.9 16.4l1.9-1.1M17.2 8.7l1.9-1.1"/></svg>
        </button>
      </header>

      <div class="advisor-shell">
        <aside class="advisor-rail" id="advisor-rail" aria-label="侧栏：当前阵容与功能">
          <div class="advisor-rail-inner">
            <button type="button" class="advisor-rail-close" data-rail-close aria-label="收起侧栏" title="收起侧栏（Esc）">×</button>
            <nav class="advisor-nav" aria-label="功能">
              <button type="button" class="advisor-nav-item advisor-new">新会话</button>
              <button type="button" class="advisor-nav-item" data-sheet="box">我的 box</button>
              <button type="button" class="advisor-nav-item" data-sheet="pool">对手池</button>
              <button type="button" class="advisor-nav-item" data-sheet="prefs">偏好</button>
              <button type="button" class="advisor-nav-item" data-sheet="history">历史</button>
            </nav>
            <section class="advisor-sec">
              <div class="advisor-sec-h">当前阵容（只读）</div>
              <a class="btn beige sm advisor-goto-main" href="./index.html" title="回主站配将台改加点 / 红度 / 兵种 / 宝物">在主站编辑 ↗</a>
              <div class="advisor-team-list"></div>
            </section>
          </div>
        </aside>

        <main class="advisor-main" id="advisor-main">
          <div class="advisor-main-inner">
            <div class="advisor-hero">
              <h2>说说你想怎么配</h2>
              <p>读你现在的队伍，在对手池上按综合胜率搜。</p>
            </div>
            <div class="advisor-session-bar">
              <span class="advisor-session-meta"></span>
              <button type="button" class="advisor-text-btn advisor-new">新会话</button>
            </div>
            <div class="advisor-log"></div>
            <div class="advisor-confirm" hidden></div>
            <footer class="advisor-composer">
              <div class="advisor-composer-inner">
                <div class="advisor-guide" hidden>
                  <span>还没配模型。需要你自己的接口地址、模型和密钥。</span>
                  <button type="button" class="advisor-text-btn" data-settings>打开设置</button>
                </div>
                <div class="advisor-bar">
                  <button type="button" class="advisor-shot" data-sheet="box" title="识别截图，建 box" aria-label="识别截图">
                    <svg class="advisor-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                  <textarea class="advisor-input" rows="1" placeholder="问点什么，一起看看这队"></textarea>
                  <button type="button" class="advisor-send" aria-label="发送">
                    <svg class="advisor-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
                  </button>
                  <button type="button" class="advisor-stop" aria-label="停止" disabled>
                    <svg class="advisor-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
                  </button>
                </div>
                <div class="advisor-bar-meta">
                  <span class="advisor-model"></span>
                  <span class="advisor-cost"></span>
                </div>
                <div class="advisor-hero-ask">
                  <button type="button" class="advisor-ask">这队对对手池的胜率是多少？</button>
                  <button type="button" class="advisor-ask">前锋换个谁，综合胜率最高？</button>
                  <button type="button" class="advisor-ask">在 box 里把大营配到胜率最高</button>
                </div>
              </div>
            </footer>
          </div>
        </main>
      </div>

      <div class="advisor-mask" hidden></div>

      <aside class="advisor-sheet" data-sheet-panel="box" role="dialog" aria-modal="true" aria-label="我的 box">
        <details class="advisor-box" open>
          <summary class="advisor-sheet-head">
            <span class="advisor-sheet-title">我的 box（识图）</span>
            <button type="button" class="advisor-sheet-x" data-sheet-close aria-label="关闭">×</button>
          </summary>
          <div class="advisor-sheet-body">
            <div class="advisor-row">
              <label>档案 <select class="advisor-box-profile"></select></label>
              <button type="button" class="btn advisor-box-new">新建</button>
              <button type="button" class="btn advisor-box-rename">改名</button>
              <button type="button" class="btn advisor-box-del">删除</button>
            </div>
            <div class="advisor-row advisor-box-rename-row" hidden>
              <input class="advisor-box-name" placeholder="档案名，如：我的号 / 朋友的号" />
              <button type="button" class="btn advisor-box-name-ok">确定</button>
            </div>
            <label class="advisor-chk"><input id="adv-strict" type="checkbox" /> 严格按我的 box 推荐（配将搜索只在你有的将法里选；方案里出现没有的将法会标出来、不能一键应用）</label>
            <div class="advisor-box-drop">
              <input type="file" class="advisor-box-file" accept="image/*" multiple hidden />
              <button type="button" class="btn advisor-box-pick">选截图</button>
              <span class="advisor-box-hint">把「五星武将」「五星战法」的截图拖进来，或直接 Ctrl+V 粘贴（可多张）</span>
            </div>
            <div class="advisor-box-thumbs"></div>
            <div class="advisor-row">
              <button type="button" class="btn primary advisor-box-run">开始识别</button>
              <button type="button" class="btn advisor-box-clear">清空 box</button>
              <span class="advisor-box-status"></span>
            </div>
            <div class="advisor-box-review"></div>
            <p class="advisor-note">识别用的是**设置里同一个模型**（你的 ds flash，具备识图能力）——不换模型、不加第二套配置。截图只在本机压成 data URL 发给它；识别结果按档案存在本机（<code>dsh-advisor-box-v1</code>）。**每个用户一份 box**，切换档案互不影响。</p>
          </div>
        </details>
      </aside>

      <aside class="advisor-sheet" data-sheet-panel="prefs" role="dialog" aria-modal="true" aria-label="你的偏好">
        <details class="advisor-profile" open>
          <summary class="advisor-sheet-head">
            <span class="advisor-sheet-title advisor-profile-title">你的偏好</span>
            <button type="button" class="advisor-sheet-x" data-sheet-close aria-label="关闭">×</button>
          </summary>
          <div class="advisor-sheet-body">
            <div class="advisor-pref-list"></div>
            <div class="advisor-row">
              <label>标签 <input id="adv-pref-key" placeholder="口径" /></label>
              <label>内容 <input id="adv-pref-val" placeholder="只看核心将伤害期望" /></label>
              <button type="button" class="btn advisor-pref-add">添加</button>
            </div>
            <div class="advisor-row">
              <label class="advisor-chk"><input id="adv-autoprofile" type="checkbox" /> 每轮自动整理偏好</label>
              <button type="button" class="btn advisor-pref-clear">清空档案</button>
            </div>
            <p class="advisor-note">档案存在本机浏览器（<code>dsh-advisor-profile-v1</code>），每一轮都会带进上下文；与本轮明确要求冲突时以本轮为准。自动整理会多一次很小的请求。</p>
          </div>
        </details>
      </aside>

      <aside class="advisor-sheet" data-sheet-panel="history" role="dialog" aria-modal="true" aria-label="历史">
        <div class="advisor-sheet-head">
          <span class="advisor-sheet-title">历史与证据</span>
          <button type="button" class="advisor-sheet-x" data-sheet-close aria-label="关闭">×</button>
        </div>
        <div class="advisor-sheet-body">
          <div class="advisor-history"></div>
          <p class="advisor-note">会话 + 证据清单落本机（<code>dsh-advisor-session-v1</code>，轮末一次原子写）；刷新、关页面都续得上。</p>
        </div>
      </aside>

      <aside class="advisor-sheet" data-sheet-panel="pool" role="dialog" aria-modal="true" aria-label="对手池">
        <div class="advisor-sheet-head">
          <span class="advisor-sheet-title">对手池</span>
          <button type="button" class="advisor-sheet-x" data-sheet-close aria-label="关闭">×</button>
        </div>
        <div class="advisor-sheet-body">
          <p class="advisor-note">固定测试集随站发布、删不掉，但<b>每一条都能单独开关</b>：关掉的队伍留在池子里、不参与胜率比较。自加的那部分还能移出。顾问和实战胜率页读的是同一份池子（只算开着的）。</p>
          <div class="advisor-pool-list"></div>
          <div class="advisor-row">
            <label>从预设加入 <select class="advisor-pool-preset"></select></label>
            <button type="button" class="btn advisor-pool-add">加入对手池</button>
          </div>
          <p class="advisor-pool-status advisor-note"></p>
        </div>
      </aside>`;

    // ── 独立页骨架接线（设计文档 §17：一个骨架两态 + 按需面板）──
    const railToggle = el<HTMLButtonElement>('.advisor-rail-toggle');
    const maskEl = el<HTMLElement>('.advisor-mask');
    const narrow = (): boolean => window.innerWidth <= 1100;
    const syncMask = (): void => {
      const sheetOn = Boolean(wrap.querySelector('.advisor-sheet.on'));
      const railOn = wrap.classList.contains('rail-open') && narrow();
      maskEl.hidden = !(sheetOn || railOn);
    };
    const setRail = (open: boolean): void => {
      wrap.classList.toggle('rail-open', open);
      railToggle.setAttribute('aria-expanded', String(open));
      syncMask();
    };
    const openSheet = (name: string | null): void => {
      for (const s of wrap.querySelectorAll<HTMLElement>('.advisor-sheet')) {
        s.classList.toggle('on', s.dataset.sheetPanel === name);
      }
      /* 窄屏侧栏是浮层 → 与面板互斥；宽屏侧栏是推挤栏 → 可以和面板并存 */
      if (name && narrow()) setRail(false);
      if (name === 'box') renderBoxPanel();
      syncMask();
    };
    railToggle.addEventListener('click', () => setRail(!wrap.classList.contains('rail-open')));
    el('.advisor-rail-close').addEventListener('click', () => setRail(false));
    maskEl.addEventListener('click', () => {
      openSheet(null);
      setRail(false);
    });
    wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const leave = t.closest<HTMLAnchorElement>('a.advisor-back, a.advisor-goto-main');
      if (leave && opts.onLeave) {
        e.preventDefault();
        opts.onLeave();
        return;
      }
      const sheetBtn = t.closest<HTMLElement>('[data-sheet]');
      if (sheetBtn) {
        openSheet(sheetBtn.dataset.sheet ?? null);
        return;
      }
      if (t.closest('[data-sheet-close]')) {
        openSheet(null);
        return;
      }
      if (t.closest('[data-settings]')) {
        openSettingsPanel();
        return;
      }
      const procHead = t.closest<HTMLElement>('.advisor-proc-head');
      if (procHead) {
        const body = procHead.parentElement?.querySelector<HTMLElement>('.advisor-proc-body');
        if (body) {
          const open = body.hidden;
          body.hidden = !open;
          procHead.setAttribute('aria-expanded', String(open));
        }
      }
    });
    let lastEsc = 0;
    onKeyDown = (e: KeyboardEvent): void => {
      if (parked || e.key !== 'Escape') return;
      /* 宽屏侧栏是常驻栏，不占 Esc；只有窄屏浮层才算挡住了停止手势 */
      const overlay = Boolean(wrap.querySelector('.advisor-sheet.on')) || (wrap.classList.contains('rail-open') && narrow());
      if (overlay) {
        openSheet(null);
        setRail(false);
        lastEsc = 0;
        return;
      }
      const now = Date.now();
      if (running && now - lastEsc < 500) {
        controller?.abort();
        lastEsc = 0;
        return;
      }
      lastEsc = now;
    };
    document.addEventListener('keydown', onKeyDown);

    el('.advisor-send').addEventListener('click', () => void send(el<HTMLTextAreaElement>('.advisor-input').value));
    el('.advisor-stop').addEventListener('click', () => controller?.abort());
    el<HTMLTextAreaElement>('.advisor-input').addEventListener('input', () => {
      const ta = el<HTMLTextAreaElement>('.advisor-input');
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
    });
    el<HTMLTextAreaElement>('.advisor-input').addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      /* Enter 发送 / Shift+Enter 换行；输入法组合中不抢 Enter（中文输入必踩） */
      if (ke.key === 'Enter' && !ke.shiftKey && !ke.isComposing) {
        ke.preventDefault();
        void send(el<HTMLTextAreaElement>('.advisor-input').value);
      }
    });
    for (const box of wrap.querySelectorAll<HTMLInputElement>('#adv-autoprofile')) {
      box.addEventListener('change', () => {
        settings = saveSettings({ autoProfile: box.checked });
      });
    }
    el('.advisor-pref-add').addEventListener('click', () => addPref());
    el('.advisor-pref-clear').addEventListener('click', () => {
      profile = { v: 1, items: [], updatedAt: Date.now() };
      clearProfile(store);
      renderProfilePanel();
      append('\n【记忆】偏好档案已清空\n');
    });
    for (const btn of wrap.querySelectorAll<HTMLButtonElement>('.advisor-ask')) {
      btn.addEventListener('click', () => void send(btn.textContent?.trim() ?? ''));
    }
    for (const btn of wrap.querySelectorAll<HTMLButtonElement>('.advisor-new')) {
      btn.addEventListener('click', () => onNewSession(btn));
    }

    // ── 我的 box（识图建档）──
    el<HTMLSelectElement>('.advisor-box-profile').addEventListener('change', (e) => {
      boxStore = setActiveProfile(boxStore, (e.target as HTMLSelectElement).value);
      saveBox();
      pendingMatches = null;
      renderBoxPanel();
    });
    el('.advisor-box-new').addEventListener('click', () => {
      boxStore = addProfile(boxStore, `档案 ${boxStore.profiles.length + 1}`);
      saveBox();
      pendingMatches = null;
      renderBoxPanel();
      setBoxStatus(`已新建档案「${activeBox().name}」——识别结果只进这一档`);
    });
    el('.advisor-box-rename').addEventListener('click', () => {
      const row = el<HTMLElement>('.advisor-box-rename-row');
      row.hidden = !row.hidden;
      const input = el<HTMLInputElement>('.advisor-box-name');
      input.value = activeBox().name;
      if (!row.hidden) input.focus();
    });
    el('.advisor-box-name-ok').addEventListener('click', () => {
      const name = el<HTMLInputElement>('.advisor-box-name').value.trim();
      if (name) {
        boxStore = renameProfile(boxStore, activeBox().id, name);
        saveBox();
      }
      el<HTMLElement>('.advisor-box-rename-row').hidden = true;
      renderBoxPanel();
    });
    el('.advisor-box-del').addEventListener('click', () => {
      const btn = el<HTMLButtonElement>('.advisor-box-del');
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认删除？';
        setTimeout(() => {
          if (btn.dataset.armed === '1') {
            delete btn.dataset.armed;
            btn.textContent = '删除';
          }
        }, 3000);
        return;
      }
      delete btn.dataset.armed;
      btn.textContent = '删除';
      const gone = activeBox().name;
      boxStore = removeProfile(boxStore, activeBox().id);
      saveBox();
      pendingMatches = null;
      renderBoxPanel();
      setBoxStatus(`已删除档案「${gone}」（至少保留一份档案）`);
    });
    el<HTMLInputElement>('#adv-strict').addEventListener('change', () => {
      settings = saveSettings({ strictBox: el<HTMLInputElement>('#adv-strict').checked });
      renderBoxPanel();
    });
    el('.advisor-box-pick').addEventListener('click', () => el<HTMLInputElement>('.advisor-box-file').click());
    el<HTMLInputElement>('.advisor-box-file').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files?.length) void handleShotFiles(input.files);
      input.value = '';
    });
    const drop = el<HTMLElement>('.advisor-box-drop');
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files?.length) void handleShotFiles(files);
    });
    el('.advisor-box-run').addEventListener('click', () => void runRecognize());
    el('.advisor-box-clear').addEventListener('click', () => {
      const btn = el<HTMLButtonElement>('.advisor-box-clear');
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认清空？';
        setTimeout(() => {
          if (btn.dataset.armed === '1') {
            delete btn.dataset.armed;
            btn.textContent = '清空 box';
          }
        }, 3000);
        return;
      }
      delete btn.dataset.armed;
      btn.textContent = '清空 box';
      boxStore = withBox(boxStore, activeBox().id, emptyBox());
      saveBox();
      pendingMatches = null;
      renderBoxPanel();
      setBoxStatus('box 已清空（重新识别或手动补）');
    });
    document.addEventListener('paste', onPaste);
    bindOpponentPool();

    // 刷新 / 关页面：把"这一轮已经跑出来的东西"兜底落盘（正课在每轮结束时，这里只兜中断）
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    renderAll();
    renderProfilePanel();
    renderBoxPanel();
    renderOpponentPool();
    renderTeam();
    syncSettingsViews();
    renderProcDetail();
    if (window.innerWidth > 1100) setRail(true);
  }

  function readSettings(): AdvisorConfig {
    return loadSettings();
  }

  /** 报价 + 确认：挂一个气条，点「开始」才返回 true（取消/中断按不跑处理，避免挂住） */
  function askConfirm(q: SearchQuote): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const bar = el('.advisor-confirm');
      bar.hidden = false;
      bar.innerHTML = `<span>即将执行 —— ${esc(q.label)}</span><button type="button" class="btn primary advisor-go">开始</button><button type="button" class="btn advisor-skip">不跑</button>`;
      el('.advisor-trace').textContent = `${trace.text()} · ⏳ 等你确认`;
      scrollLogToEnd();
      const finish = (v: boolean): void => {
        bar.hidden = true;
        bar.innerHTML = '';
        el('.advisor-trace').textContent = trace.text();
        resolve(v);
      };
      bar.querySelector('.advisor-go')!.addEventListener('click', () => finish(true));
      bar.querySelector('.advisor-skip')!.addEventListener('click', () => finish(false));
      controller?.signal.addEventListener('abort', () => finish(false), { once: true });
    });
  }

  /** 系统一行（已应用 / 失败 / 记忆）。不进气泡，避免和正文挤成一块。 */
  function append(line: string): void {
    const text = line.replace(/^\n+|\n+$/g, '').trim();
    if (!text) return;
    const log = el('.advisor-log');
    const row = document.createElement('p');
    row.className = 'advisor-sys';
    row.textContent = text;
    log.appendChild(row);
    scrollLogToEnd();
  }

  /**
   * 滚到最新一行。滚动体是 `.advisor-main`。
   * ⚠️ 必须在页面可见之后调用：不可见时 `scrollHeight` 是 0，历史会停在最旧一屏。
   */
  function scrollLogToEnd(): void {
    const main = el<HTMLElement>('.advisor-main');
    main.scrollTop = main.scrollHeight;
  }

  // ─────────────────────────── 记忆层渲染（刷新后由这里还原） ───────────────────────────

  const PROC_CHEV = `<svg class="advisor-ico advisor-proc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

  /** 顾问正文按段排，不再塞进一块等宽字。 */
  function answerHtml(text: string): string {
    const parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return '<p>（空回答）</p>';
    return parts.map((p) => `<p>${esc(p)}</p>`).join('');
  }

  function procRowsHtml(records: Array<Pick<ToolCallRecord, 'name' | 'brief' | 'summary' | 'stats'>>): string {
    return records
      .map((r) => {
        const cost = [
          r.stats?.battles ? `${num(r.stats.battles)} 场` : '',
          r.stats?.cached ? '缓存' : '',
          r.stats?.ms ? `${(r.stats.ms / 1000).toFixed(1)}s` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          `<div class="advisor-proc-row"><span class="advisor-proc-dot"></span>` +
          `<span class="advisor-proc-name">${esc(toolZh(r.name))}</span>` +
          `<span class="advisor-proc-arg">${esc(clipText(r.brief || r.summary || '', 70))}</span>` +
          `<span class="advisor-proc-cost">${cost}</span></div>`
        );
      })
      .join('');
  }

  function traceLabelOf(t: StoredTurn, active: boolean): string {
    // 档位徽标（§16.26）：生产页唯一能看见"模型这一轮拿到多大工具面"的地方。
    // 放在工具列表**之后**，且进行中就显示（用户能当场看出这轮被锚定/只给了基础档）。
    const badge = t.route ? routeBadge(t.route, t.selfCorrect) : '';
    const head = active && trace.text() ? trace.text() : t.evidence.length ? t.evidence.map((e) => toolZh(e.name)).join(' · ') : '没有工具调用';
    return badge ? `${head} · ${badge}` : head;
  }

  /**
   * 一轮：你的话靠右，工具一行折叠，顾问的话靠左，方案卡跟在这一轮正文后面。
   * 进行中的那轮带 `.live`，流式往里写。方案卡在轮内，下一句用户消息会把它顶上去。
   */
  function turnArticle(t: StoredTurn, active: boolean, live = false, turnIndex = 0): string {
    const label = traceLabelOf(t, active);
    const body = active
      ? `<div class="advisor-proc-body" hidden></div>`
      : `<div class="advisor-proc-body" hidden>${procRowsHtml(t.evidence)}</div>`;
    const sum = active
      ? `<span class="advisor-trace">${esc(label)}</span>`
      : `<span class="advisor-proc-sum">${esc(label)}</span>`;
    const answer = t.answer || (t.partial ? '（这一轮中断了，没有结论）' : '（空回答）');
    const mem = t.note ? `<p class="advisor-mem">记忆 · ${esc(t.note)}</p>` : '';
    const plans = t.checks.length ? `<div class="advisor-plans">${renderLineup(t.checks, turnIndex)}</div>` : '';
    return `<article class="advisor-turn${live ? ' live' : ''}">
      <div class="advisor-bubble user"><p>${esc(t.userText)}</p></div>
      <div class="advisor-proc">
        <button type="button" class="advisor-proc-head" aria-expanded="false">${PROC_CHEV}${sum}</button>
        ${body}
      </div>
      <div class="advisor-bubble assistant">${answerHtml(answer)}</div>
      ${mem}
      ${plans}
    </article>`;
  }

  function beginLive(q: string): void {
    wrap.classList.remove('is-empty');
    const log = el('.advisor-log');
    log.querySelectorAll('.advisor-trace').forEach((n) => {
      n.classList.remove('advisor-trace');
      n.classList.add('advisor-proc-sum');
    });
    const article = document.createElement('article');
    article.className = 'advisor-turn live';
    article.innerHTML =
      `<div class="advisor-bubble user"><p></p></div>` +
      `<div class="advisor-proc"><button type="button" class="advisor-proc-head" aria-expanded="false">${PROC_CHEV}` +
      `<span class="advisor-trace">还没有工具调用</span></button><div class="advisor-proc-body" hidden></div></div>` +
      `<div class="advisor-bubble assistant"></div>`;
    article.querySelector('.advisor-bubble.user p')!.textContent = q;
    log.appendChild(article);
    scrollLogToEnd();
  }

  /** 一轮的证据清单（用户要的「证据清单落盘」在界面上的样子：编号 · 摘要 · 场次） */
  function evidenceBlock(t: StoredTurn, index: number): string {
    if (!t.evidence.length && !t.plans.length) return '';
    const rows = t.evidence
      .map((e) => {
        const cost = e.stats?.battles ? `${num(e.stats.battles)} 场` : e.stats?.cached ? '用上次结果' : '查表';
        return `<div class="ae-row"><span class="ae-id">${esc(evidenceZh(e.evidenceId))}</span><span class="ae-sum">${esc(clipText(e.summary ?? '', 140))}</span><span class="ae-cost">${esc(cost)}</span></div>`;
      })
      .join('');
    const plans = t.plans
      .map((p, j) => {
        const c = t.checks[j];
        const st = c
          ? c.apply.enabled
            ? '三关通过'
            : c.boxIssues?.length
              ? '含 box 外的将法（不可应用）'
              : c.legal
                ? c.evidenceOk
                  ? '未复算'
                  : '证据核验失败'
                : '不合法'
          : '';
        return `<div class="ae-plan">方案 ${j + 1}：${esc(p.title)}${st ? `<span class="dim">（${st}）</span>` : ''}</div>`;
      })
      .join('');
    return `<div class="advisor-evidence"><div class="ae-head">第 ${index + 1} 轮证据清单${t.partial ? '（中断）' : ''}</div>${rows}${plans}</div>`;
  }

  /** 方案卡上的切队、查看详情、一键应用。卡在各自那一轮里，用轮次下标找回那一轮的校验结果。 */
  function bindPlanApplies(): void {
    el('.advisor-log').querySelectorAll('.advisor-plan-card').forEach((card) => {
      card.querySelectorAll<HTMLButtonElement>('.pc-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          const i = tab.dataset.team;
          card.querySelectorAll('.pc-tab').forEach((t) => t.classList.toggle('on', (t as HTMLElement).dataset.team === i));
          card.querySelectorAll<HTMLElement>('.pc-team').forEach((p) => {
            if (p.dataset.team === i) p.removeAttribute('hidden');
            else p.setAttribute('hidden', '');
          });
        });
      });
      card.querySelectorAll<HTMLButtonElement>('.pc-detail-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const detail = btn.closest('.pc-team')?.querySelector<HTMLElement>('.pc-detail');
          if (!detail) return;
          const open = detail.hasAttribute('hidden');
          if (open) detail.removeAttribute('hidden');
          else detail.setAttribute('hidden', '');
          btn.textContent = open ? '收起详情' : '查看详情';
        });
      });
    });
    el('.advisor-log').querySelectorAll('.advisor-apply').forEach((btn) =>
      btn.addEventListener('click', () => {
        const elBtn = btn as HTMLElement;
        const turn = session.turns[Number(elBtn.dataset.turn)];
        const check = turn?.checks[Number(elBtn.dataset.plan)];
        if (!check?.apply.enabled) return;
        const r = opts.host.applyPlan(check.plan);
        append(r.ok ? '\n【已应用】方案写入配将区。\n' : `\n【应用失败】${r.message ?? ''}\n`);
      })
    );
  }

  /** 从盘上的会话整体重放界面（挂载时 / 每轮结束后都走它：**实时与刷新后的样子一致**） */
  function renderAll(): void {
    const log = el<HTMLElement>('.advisor-log');
    const turns = session.turns;
    log.innerHTML = turns.map((t, i) => turnArticle(t, i === turns.length - 1, false, i)).join('');
    bindPlanApplies();
    scrollLogToEnd();
    el('.advisor-history').innerHTML = turns.map((t, i) => evidenceBlock(t, i)).join('');
    renderSessionBar();
    renderProcDetail();
  }

  /** 设置 → 界面（严格 chip 文案 / 模型名 / 未配模型引导条 / 两个复选框），单向：state → DOM */
  function syncSettingsViews(): void {
    for (const chip of wrap.querySelectorAll<HTMLElement>('.advisor-strict-chip')) {
      chip.textContent = `严格按我的 box：${settings.strictBox ? '开' : '关'}`;
      chip.classList.toggle('on', settings.strictBox);
    }
    const model = wrap.querySelector<HTMLElement>('.advisor-model');
    if (model) model.textContent = `模型：${settings.model || '—'}`;
    const guide = wrap.querySelector<HTMLElement>('.advisor-guide');
    if (guide) guide.hidden = Boolean(settings.key);
    const auto = wrap.querySelector<HTMLInputElement>('#adv-autoprofile');
    if (auto) auto.checked = settings.autoProfile;
    const strict = wrap.querySelector<HTMLInputElement>('#adv-strict');
    if (strict) strict.checked = settings.strictBox;
  }

  /**
   * 当前阵容（只读）：顶栏那一行文字 + 侧栏三张卡。
   * 卡片**直接复用主站 `renderSlot`**（同款立绘卡面 + 战法图标 + 等级/兵种行），顺序也照主站 [大营, 中军, 前锋]；
   * 侧栏只读 → 交互由 CSS 关掉（`.advisor-team-list .slot{cursor:default;pointer-events:none}`）。
   * 显示走 `readSlots()`（真槽位：红度 / 宝物 / 兵种都在），AI 那条路仍走 `readTeam()` 的 plan。
   */
  function renderTeam(): void {
    const listEl = wrap.querySelector<HTMLElement>('.advisor-team-list');
    if (!listEl) return;
    const slots: SlotState[] | null = opts.host.readSlots?.() ?? null;
    const plan = opts.host.readTeam();
    const byPos = new Map(plan.slots.map((s) => [s.position, s]));
    const inline: string[] = [];
    listEl.innerHTML = '';
    for (let i = 0; i < PLAN_POSITIONS.length; i++) {
      const label = PLAN_POSITIONS[i];
      const raw: SlotState | null = slots?.[i] ?? null;
      const fromPlan = byPos.get(label);
      const heroId = raw?.heroId ?? fromPlan?.heroId ?? null;
      if (!heroId) {
        const empty = document.createElement('div');
        empty.className = 'advisor-slot empty';
        empty.innerHTML = `<span class="advisor-slot-pos">${label}</span><span class="advisor-slot-who">未放置</span>`;
        listEl.appendChild(empty);
        continue;
      }
      inline.push(`${label} ${heroName(heroId)}`);
      /* 没有 readSlots 的宿主（老测试 / 第三方）：拿 plan 兜一个最小槽位，照样画得出卡 */
      const slot: SlotState = raw ?? {
        ...emptySlot(),
        heroId,
        level: fromPlan?.level ?? 40,
        extraSkillIds: [...(fromPlan?.skillIds ?? [])],
      };
      const card = renderSlot('red', i, slot, label, READONLY_HANDLERS);
      card.classList.add('advisor-slot-card');
      listEl.appendChild(card);
    }
    const inlineEl = wrap.querySelector<HTMLElement>('.advisor-team-inline');
    if (inlineEl) inlineEl.textContent = inline.length ? inline.join(' ｜ ') : '还没配队伍';
  }

  function renderSessionBar(): void {
    const meta = el('.advisor-session-meta');
    /* 空态 hero：只有真聊过才收起来（设计文档 §7.5 三态） */
    wrap.classList.toggle('is-empty', session.turns.length === 0 && !inFlight);
    if (!session.turns.length) {
      meta.textContent = '新会话（还没聊过）';
      return;
    }
    const last = session.turns[session.turns.length - 1];
    meta.textContent = `继续上次会话：${stampText(last.at)} · ${session.turns.length} 轮${session.dropped ? `（更早 ${session.dropped} 轮已清理）` : ''} · 刷新不丢`;
  }

  function renderProfilePanel(): void {
    el('.advisor-profile-title').textContent = `你的偏好（${profile.items.length} 条）`;
    const list = el('.advisor-pref-list');
    if (!profile.items.length) {
      list.innerHTML = '<div class="advisor-note">还没记下任何偏好：聊几轮后会自动整理（也可以在上面手填一条）。</div>';
      return;
    }
    list.innerHTML = [...profile.items]
      .sort((a, b) => b.at - a.at)
      .map(
        (it) => `<div class="advisor-pref-row" data-pref="${esc(it.value)}">
          <span class="apf-key">${esc(it.key)}</span>
          <span class="apf-val">${esc(it.value)}${it.seen > 1 ? `<span class="dim">（${it.seen} 次）</span>` : ''}</span>
          <button type="button" class="advisor-pref-del" title="删除这条">×</button>
        </div>`
      )
      .join('');
    list.querySelectorAll('.advisor-pref-del').forEach((btn) =>
      btn.addEventListener('click', () => {
        const row = (btn as HTMLElement).closest('.advisor-pref-row') as HTMLElement | null;
        const value = row?.dataset.pref ?? '';
        const out = removePreference(profile, value);
        profile = out.profile;
        saveProfile(profile, store);
        renderProfilePanel();
        append(`\n【记忆】已删除偏好「${value}」\n`);
      })
    );
  }

  function addPref(): void {
    const norm = normalizePref(el<HTMLInputElement>('#adv-pref-key').value, el<HTMLInputElement>('#adv-pref-val').value);
    if (!norm) {
      append('\n【记忆】偏好内容不能为空\n');
      return;
    }
    profile = mergePreferences(profile, [norm]).profile;
    saveProfile(profile, store);
    el<HTMLInputElement>('#adv-pref-val').value = '';
    renderProfilePanel();
    append(`\n【记忆】已记下偏好「${norm.key}：${norm.value}」\n`);
  }

  // ─────────────────────────── 「我的 box」（识图建档，设计文档 §15） ───────────────────────────

  const activeBox = (): BoxProfile => activeProfile(boxStore);
  /** 当前档案 + 严格模式 → 只读视图：注入 loop、塞给 ToolCtx、交给关 1（`strict` 缺省取闭包里的设置） */
  const currentBoxView = (strict: boolean = settings.strictBox): BoxView => boxViewOf(activeBox(), strict);
  const saveBox = (): void => {
    boxStore = saveBoxStore(boxStore, store);
  };

  function setBoxStatus(text: string, kind: 'ok' | 'bad' | 'busy' = 'ok'): void {
    const node = el<HTMLElement>('.advisor-box-status');
    node.textContent = text;
    node.className = `advisor-box-status${kind === 'ok' ? '' : ` ${kind}`}`;
  }

  /** 粘贴截图（只在抽屉打开时接管；非图片的粘贴照旧） */
  function onPaste(e: ClipboardEvent): void {
    if (!built || destroyed || parked || !wrap.classList.contains('open')) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void handleShotFiles(files);
  }

  /** 选 / 拖 / 粘进来的截图 → 压成 data URL 排进待识别队列（**不落盘**，识别完就丢） */
  async function handleShotFiles(files: ArrayLike<File>): Promise<void> {
    if (recognizing) return;
    try {
      setBoxStatus('正在压缩图片…', 'busy');
      const room = Math.max(0, MAX_IMAGES - pendingImages.length);
      if (!room) {
        setBoxStatus(`一次最多 ${MAX_IMAGES} 张——先识别这批再加`, 'bad');
        return;
      }
      const urls = await filesToDataUrls(files, { maxImages: room });
      pendingImages = [...pendingImages, ...urls].slice(0, MAX_IMAGES);
      renderBoxThumbs();
      setBoxStatus(`已加入 ${urls.length} 张（待识别 ${pendingImages.length} 张）——点「开始识别」`);
    } catch (e) {
      setBoxStatus(`图片读不了：${(e as Error)?.message ?? String(e)}`, 'bad');
    }
  }

  function renderBoxThumbs(): void {
    const box = el('.advisor-box-thumbs');
    if (!pendingImages.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = pendingImages
      .map(
        (src, i) =>
          `<span class="abr-thumb" data-i="${i}"><img src="${src}" alt="截图 ${i + 1}" /><button type="button" class="abr-thumb-del" title="移除这张">×</button></span>`
      )
      .join('');
    box.querySelectorAll('.abr-thumb-del').forEach((btn) =>
      btn.addEventListener('click', () => {
        const i = Number((btn as HTMLElement).closest('.abr-thumb')?.getAttribute('data-i'));
        pendingImages = pendingImages.filter((_, k) => k !== i);
        renderBoxThumbs();
        setBoxStatus(`待识别 ${pendingImages.length} 张`);
      })
    );
  }

  /** 识别：截图 → 模型（同一个 baseUrl/model/key）→ 原始清单 → 确定性对齐 → 合并进当前档案 */
  async function runRecognize(): Promise<void> {
    if (recognizing) return;
    if (!pendingImages.length) {
      setBoxStatus('先选几张截图（五星武将 / 五星战法）', 'bad');
      return;
    }
    const s = settings;
    const fake = opts.fake === true || isDryRun();
    if (!fake && (!s.key || !s.baseUrl || !s.model)) {
      setBoxStatus('真模型模式需要 baseURL / model / key（或勾上「干跑」看链路）', 'bad');
      return;
    }
    saveSettings(s);
    recognizing = true;
    const t0 = Date.now();
    const count = pendingImages.length;
    setBoxStatus(`正在识图（${count} 张）…`, 'busy');
    // 干跑：假传输直接吐一份**示例**清单（界面会标注"不是真读图"）——用来验证识别→对齐→入库→约束整条链
    const transport = opts.transport ?? (fake ? createFakeTransport([], { onceReply: () => SAMPLE_BOX_REPLY }) : createBrowserTransport(s));
    try {
      const res = await recognizeBox({
        images: pendingImages,
        transport,
        onProgress: (p) => setBoxStatus(p.phase === 'done' ? '正在对齐清单…' : `正在识图…（${p.done}/${p.total} 张）`, 'busy'),
      });
      const match = matchRecognition(res.raw, { mainSkills: MAIN_SKILL_IDS });
      const cur = activeBox();
      const box = mergeRecognition(cur.box, match, {
        at: Date.now(),
        images: count,
        model: fake ? '干跑（示例，不是真读图）' : s.model,
      });
      boxStore = withBox(boxStore, cur.id, box);
      saveBox();
      pendingMatches = match;
      pendingImages = [];
      renderBoxThumbs();
      renderBoxPanel();
      const pending = match.pendingHeroes.length + match.pendingSkills.length;
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      setBoxStatus(
        `识别完成（${secs}s）：武将 +${match.heroIds.length} / 战法 +${match.skillIds.length}${pending ? `；${pending} 条要你确认（见下面）` : ''}${fake ? '（干跑示例）' : ''}`
      );
      if (res.raw.unrecognized?.length) append(`\n【识图】模型说看不清这几处：${res.raw.unrecognized.join('；')}\n`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      setBoxStatus(`识别失败：${msg}`, 'bad');
      append(`\n【识图失败】${msg}\n`);
    } finally {
      recognizing = false;
    }
  }

  /** 复核表 + 待确认区 + 手动补（每次都按当前档案重画，操作即时落盘） */
  function renderBoxPanel(): void {
    const p = activeBox();
    el('.advisor-box-sum').textContent = boxSummaryText(p);
    const sel = el<HTMLSelectElement>('.advisor-box-profile');
    sel.innerHTML = boxStore.profiles
      .map((x) => {
        const n = x.box.heroIds.length + x.box.skillIds.length;
        return `<option value="${esc(x.id)}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}（${n ? `${x.box.heroIds.length} 将 / ${x.box.skillIds.length} 法` : '空'}）</option>`;
      })
      .join('');
    el<HTMLInputElement>('.advisor-box-name').value = p.name;
    renderBoxReview();
  }

  function rowHtml(kind: 'hero' | 'skill', r: { id: string; name: string; sub: string; warn?: string }): string {
    return `<span class="abr-item${r.warn ? ' warn' : ''}" ${r.warn ? `title="${esc(r.warn)}"` : ''}>
      <span class="abr-name">${esc(r.name)}</span><span class="abr-sub">${esc(r.sub)}</span>
      <button type="button" class="abr-del" data-kind="${kind}" data-id="${esc(r.id)}" title="从 box 里删掉">×</button>
    </span>`;
  }

  function renderBoxReview(): void {
    const box = el('.advisor-box-review');
    const cur = activeBox().box;
    const heroes = heroRows({ heroIds: cur.heroIds });
    const skills = skillRows({ skillIds: cur.skillIds });
    const pm = pendingMatches;
    const pending: string[] = [];
    if (pm?.pendingHeroes.length || pm?.pendingSkills.length) {
      pending.push('<div class="abr-pending"><div class="abr-pending-head">待你确认（识别到但没定下来，点一下选它 / 或跳过）</div>');
      pm.pendingHeroes.forEach((m: HeroMatch, i) => {
        const cands = (m.candidates ?? [])
          .map((c) => `<button type="button" class="btn abr-pick" data-kind="hero" data-i="${i}" data-id="${esc(c.id)}">${esc(c.name)}（${esc(c.faction)}·${esc(c.troopType)}）</button>`)
          .join('');
        pending.push(
          `<div class="abr-pending-row"><span class="abr-raw">「${esc(m.raw.name)}」</span><span class="dim">${esc(m.note ?? '')}</span>${cands}<button type="button" class="btn abr-skip" data-kind="hero" data-i="${i}">跳过</button></div>`
        );
      });
      pm.pendingSkills.forEach((m: SkillMatch, i) => {
        const cands = (m.candidates ?? [])
          .map((c) => `<button type="button" class="btn abr-pick" data-kind="skill" data-i="${i}" data-id="${esc(c.id)}">${esc(c.name)}</button>`)
          .join('');
        pending.push(
          `<div class="abr-pending-row"><span class="abr-raw">「${esc(m.raw.name)}」</span><span class="dim">${esc(m.note ?? '')}</span>${cands}<button type="button" class="btn abr-skip" data-kind="skill" data-i="${i}">跳过</button></div>`
        );
      });
      pending.push('</div>');
    }
    const unmatched = cur.unmatched.length
      ? `<div class="abr-unmatched">还没对上的原始名字（${cur.unmatched.length}）：${esc(cur.unmatched.slice(0, 12).join('、'))}${cur.unmatched.length > 12 ? '…' : ''}</div>`
      : '';
    box.innerHTML = `
      <div class="abr-cols">
        <div class="abr-col"><div class="abr-head">五星武将（${heroes.length}）</div><div class="abr-list">${heroes.map((r) => rowHtml('hero', r)).join('') || '<span class="dim">（空）</span>'}</div>
          <div class="advisor-row abr-add"><input class="abr-add-hero" placeholder="补一个武将（名字/拼音）" /><button type="button" class="btn abr-add-hero-btn">加</button></div>
          <div class="abr-cands abr-cands-hero"></div>
        </div>
        <div class="abr-col"><div class="abr-head">五星战法（${skills.length}）</div><div class="abr-list">${skills.map((r) => rowHtml('skill', r)).join('') || '<span class="dim">（空）</span>'}</div>
          <div class="advisor-row abr-add"><input class="abr-add-skill" placeholder="补一个战法（名字）" /><button type="button" class="btn abr-add-skill-btn">加</button></div>
          <div class="abr-cands abr-cands-skill"></div>
        </div>
      </div>
      ${pending.join('')}
      ${unmatched}`;

    box.querySelectorAll('.abr-del').forEach((btn) =>
      btn.addEventListener('click', () => {
        const kind = (btn as HTMLElement).dataset.kind as 'hero' | 'skill';
        const id = (btn as HTMLElement).dataset.id ?? '';
        const cur2 = activeBox().box;
        boxStore = withBox(boxStore, activeBox().id, kind === 'hero' ? boxRemoveHero(cur2, id) : boxRemoveSkill(cur2, id));
        saveBox();
        renderBoxPanel();
        setBoxStatus(`已从 box 移除 ${kind === 'hero' ? heroName(id) : skillName(id)}`);
      })
    );
    box.querySelectorAll('.abr-pick').forEach((btn) =>
      btn.addEventListener('click', () => {
        const node = btn as HTMLElement;
        const kind = node.dataset.kind as 'hero' | 'skill';
        const i = Number(node.dataset.i);
        const id = node.dataset.id ?? '';
        resolvePending(kind, i, id);
      })
    );
    box.querySelectorAll('.abr-skip').forEach((btn) =>
      btn.addEventListener('click', () => {
        const node = btn as HTMLElement;
        skipPending(node.dataset.kind as 'hero' | 'skill', Number(node.dataset.i));
      })
    );
    const addRow = (kind: 'hero' | 'skill'): void => {
      const input = el<HTMLInputElement>(kind === 'hero' ? '.abr-add-hero' : '.abr-add-skill');
      const cands = el(kind === 'hero' ? '.abr-cands-hero' : '.abr-cands-skill');
      const q = input.value.trim();
      if (!q) return;
      const hits =
        kind === 'hero'
          ? searchHeroCandidates(q, 12).map((c) => ({ id: c.id, name: c.name, sub: `${c.faction}·${c.troopType}` }))
          : searchSkillCandidates(q, 12, MAIN_SKILL_IDS).map((c) => ({ id: c.id, name: c.name, sub: c.troopType }));
      if (!hits.length) {
        cands.innerHTML = `<span class="dim">库里没有匹配「${esc(q)}」的${kind === 'hero' ? '武将' : '战法'}</span>`;
        return;
      }
      cands.innerHTML = hits
        .map((h) => `<button type="button" class="btn abr-cand" data-id="${esc(h.id)}">${esc(h.name)}<span class="dim"> ${esc(h.sub)}</span></button>`)
        .join('');
      cands.querySelectorAll('.abr-cand').forEach((b) =>
        b.addEventListener('click', () => {
          const id = (b as HTMLElement).dataset.id ?? '';
          addToBox(kind, id);
          input.value = '';
          cands.innerHTML = '';
        })
      );
    };
    el('.abr-add-hero-btn').addEventListener('click', () => addRow('hero'));
    el('.abr-add-skill-btn').addEventListener('click', () => addRow('skill'));
    el<HTMLInputElement>('.abr-add-hero').addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') addRow('hero');
    });
    el<HTMLInputElement>('.abr-add-skill').addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') addRow('skill');
    });
  }

  function addToBox(kind: 'hero' | 'skill', id: string): void {
    const cur = activeBox().box;
    boxStore = withBox(boxStore, activeBox().id, kind === 'hero' ? boxAddHeroes(cur, [id]) : boxAddSkills(cur, [id]));
    saveBox();
    renderBoxPanel();
    setBoxStatus(`已加入 ${kind === 'hero' ? heroName(id) : skillName(id)}`);
  }

  /** 待确认条目：点候选 = 定下来并入库；跳过 = 从待确认里去掉（`unmatched` 里仍留着原始名字） */
  function resolvePending(kind: 'hero' | 'skill', i: number, id: string): void {
    addToBox(kind, id);
    dropPending(kind, i);
  }

  function skipPending(kind: 'hero' | 'skill', i: number): void {
    dropPending(kind, i);
    setBoxStatus('这条先跳过（原始名字仍记在 box 的"还没对上"里）');
  }

  function dropPending(kind: 'hero' | 'skill', i: number): void {
    if (!pendingMatches) return;
    pendingMatches =
      kind === 'hero'
        ? { ...pendingMatches, pendingHeroes: pendingMatches.pendingHeroes.filter((_, k) => k !== i) }
        : { ...pendingMatches, pendingSkills: pendingMatches.pendingSkills.filter((_, k) => k !== i) };
    renderBoxPanel();
  }

  function onNewSession(btn: HTMLButtonElement): void {
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = '确认清空？';
      setTimeout(() => {
        if (btn.dataset.armed === '1') {
          delete btn.dataset.armed;
          btn.textContent = '新会话';
        }
      }, 3000);
      return;
    }
    delete btn.dataset.armed;
    btn.textContent = '新会话';
    session = emptySession();
    clearSession(store);
    renderAll();
    append('\n【记忆】已开新会话（偏好档案保留）\n');
  }

  /**
   * 中断兜底：把"已经跑出来的"存成一轮半成品（`partial`）。
   * 同一轮再写一次会盖掉这条半成品（切走页面时先存的空快照，不能挡住后来的结论）。
   * 失败 / 取消 / 刷新都会走它；正文只到断点，证据只到已跑完的那几个（不编、不补）。
   */
  function flush(): void {
    if (!built || !inFlight) return;
    const f = inFlight;
    const shell: AdvisorTurn = {
      messages: [],
      toolCalls: f.records,
      plans: [],
      checks: [],
      answer: f.text.trim(),
      verdict: { legal: true, verified: false, recomputed: false, apply: { enabled: false, reason: '这一轮中断了，没有结论' } },
    };
    session = appendTurn(session, toStoredTurn(shell, f.q, { id: f.id, at: Date.now(), partial: true, mode: f.mode }));
    session = saveSession(session, store);
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') flush();
  }

  /**
   * 一轮里的多支队伍合成一张合阵容卡。
   * 左边一队一个大营头像；右边是选中那队的武将头像和战法图标。
   * @param checks 这一轮过完三关的方案，一队一条
   * @param turnIndex 落在第几轮，应用时用它找回方案
   */
  function renderLineup(checks: PlanCheck[], turnIndex: number): string {
    const tabs = checks
      .map((c, i) => {
        const camp = c.plan.slots.find((s) => s.position === '大营') ?? c.plan.slots[0];
        const src = camp ? avatarSrc(camp.heroId) : '';
        const face = src ? `<img src="${esc(src)}" alt="">` : '';
        return `<button type="button" class="pc-tab${i === 0 ? ' on' : ''}" data-team="${i}">${face}<span>部队${i + 1}</span></button>`;
      })
      .join('');
    const teams = checks.map((c, i) => teamHtml(c, i, turnIndex)).join('');
    const title = checks.length > 1 ? '配将合阵容' : checks[0].title;
    return `<div class="advisor-plan-card" data-turn="${turnIndex}"><div class="pc-title">${esc(title)}</div><div class="pc-shell"><div class="pc-rail">${tabs}</div><div class="pc-stage">${teams}</div></div></div>`;
  }

  /** 右边一队：顶栏综合胜率，三行头像 + 战法图标，详情默认收起。 */
  function teamHtml(check: PlanCheck, index: number, turnIndex: number): string {
    const rows = (['大营', '中军', '前锋'] as const)
      .map((pos) => {
        const slot = check.plan.slots.find((s) => s.position === pos);
        if (!slot) return `<div class="pc-hero"><div class="pc-who"><b class="dim">空</b><span>${pos}</span></div></div>`;
        const src = avatarSrc(slot.heroId);
        const face = src ? `<img class="pc-avatar" src="${esc(src)}" alt="">` : '';
        return `<div class="pc-hero">${face}<div class="pc-who"><b>${esc(heroName(slot.heroId))}</b><span>${pos}</span></div><div class="pc-skills">${skillSlots(slot.heroId, slot.skillIds)}</div></div>`;
      })
      .join('');
    const win = check.pool ? `${check.pool.winRatePct.toFixed(1)}%` : '—';
    const headline = check.pool ? poolCardHtml(check.pool) : dummyCardHtml(check);
    const notes = [
      check.legal ? '' : `<div class="pc-metric bad">不合法：${esc(check.legalErrors.join('；'))}</div>`,
      check.boxIssues?.length ? `<div class="pc-metric warn">含你 box 外的将法 ${check.boxIssues.length} 处：${esc(check.boxIssues.join('；'))}</div>` : '',
      check.evidenceOk ? '' : `<div class="pc-metric bad">证据核验失败：${esc(check.evidenceReason ?? '')}</div>`,
    ].join('');
    return `<div class="pc-team" data-team="${index}"${index === 0 ? '' : ' hidden'}>
      <div class="pc-bar"><span>${esc(check.title)}</span><span class="pc-win">综合胜率 <b>${win}</b></span></div>
      ${rows}
      <div class="pc-detail" hidden>${headline}${notes}</div>
      <div class="pc-actions">
        <button type="button" class="btn pc-detail-btn">查看详情</button>
        <button type="button" class="btn primary advisor-apply" data-turn="${turnIndex}" data-plan="${index}" ${check.apply.enabled ? '' : 'disabled'}>一键应用</button>
        <span class="advisor-verify-note">${check.apply.enabled ? '三关通过（合法 / 可溯源 / 已复算）' : esc(check.apply.reason ?? '')}</span>
      </div>
    </div>`;
  }

  /** 主战法 + 两个可学槽。空槽留灰框。 */
  function skillSlots(heroId: string, learned: string[]): string {
    const main = getHeroById(heroId)?.mainSkillId;
    const cells = [main ? skillIcon(main) : emptySkill(), ...[0, 1].map((i) => (learned[i] ? skillIcon(learned[i]) : emptySkill()))];
    return cells.join('');
  }

  function skillIcon(skillId: string): string {
    const grade = skillGrade(skillId);
    return `<span class="pc-skill" title="${esc(skillName(skillId))}"><span class="sslot-icon"><img class="ti" src="${skillTypeIcon(skillId)}" alt=""><img class="kf" src="${gradeFrame(grade)}" alt=""><img class="rb" src="${gradeRibbon(grade)}" alt=""></span><span class="pc-skill-name">${esc(skillName(skillId))}</span></span>`;
  }

  function emptySkill(): string {
    return '<span class="pc-skill"><span class="pc-skill-empty"></span></span>';
  }

  /** 对手池对打的主数字。胜率来自工具证据，八回合总伤和前三回合是同一批战斗。 */
  function poolCardHtml(pool: PoolHint): string {
    const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;
    const rows = pool.opponents
      .map(
        (o) =>
          `<div class="pc-metric dim">${esc(o.note || '对手')} 胜率 ${pct(o.winRate)}（胜 ${o.win} / 平 ${o.draw} / 负 ${o.loss}）总伤 ${num(o.meanTotal)} 前三 ${num(o.meanFirst3)}</div>`,
      )
      .join('');
    return [
      `<div class="pc-metric"><b>综合胜率</b> <b>${pool.winRatePct.toFixed(1)}%</b> ±${(pool.halfWidth * 100).toFixed(1)} 个百分点（${pool.runs} 场，来自「${esc(evidenceZh(pool.evidenceId))}」）</div>`,
      `<div class="pc-metric">最差对手 <b>${esc(pool.worstNote || '—')}</b> ${pct(pool.worstRate)}</div>`,
      `<div class="pc-metric">同一批对打：<b>八回合全队总伤</b> <b>${num(pool.meanTotal)}</b>｜<b>前三回合爆发</b> <b>${num(pool.meanFirst3)}</b></div>`,
      rows,
      pool.fingerprint ? `<div class="pc-metric dim">对手池 ${esc(pool.fingerprint)}</div>` : '',
    ].join('');
  }

  /** 没有打过对手池时，仍显示木桩复算（应用门用的那套）。 */
  function dummyCardHtml(check: PlanCheck): string {
    const rc = check.recompute;
    const search = check.search;
    const metrics = rc
      ? `<div class="pc-metric"><b>标准口径复算</b>（${rc.runs} 场 / 种子 ${rc.seed}）：核心将期望 <b>${num(rc.mean)}</b> ±${num(rc.halfWidth)}</div>
         <div class="pc-metric"><b>八回合全队总伤</b> <b>${num(rc.meanTotal)}</b>｜<b>前三回合爆发</b> <b>${num(rc.meanFirst3)}</b><span class="dim">（每场平均；比较两套配置就看这两个数）</span></div>`
      : '<div class="pc-metric bad">标准口径复算未完成</div>';
    const compare = search
      ? `<div class="pc-metric">搜索口径（来自「${evidenceZh(search.evidenceId)}」，${search.runs} 场）：${num(search.mean)} ±${num(search.halfWidth)} → ${
          check.judge === 'consistent' ? '区间重叠，<b>一致</b>' : '复算明显更低，<b>对口径敏感，谨慎采纳</b>'
        }</div>`
      : '<div class="pc-metric bad">方案没引用任何实测证据（未验证）</div>';
    return metrics + compare;
  }

  /** 侧栏「对手池」：每条一个参战开关（关掉的不参与胜率比较）；预设加入和移出都要再点一次确认。 */
  function renderOpponentPool(): void {
    const pool = loadMergedPool(undefined, { includeDisabled: true });
    const fixed = pool.entries.filter((e) => e.source === 'benchmark').length;
    const added = pool.entries.length - fixed;
    const on = pool.entries.filter((e) => e.enabled !== false).length;
    const off = pool.entries.length - on;
    const rows = pool.entries
      .map((e) => {
        const badge = e.source === 'benchmark' ? '固定' : '自加';
        const enabled = e.enabled !== false;
        const sw = (id: string, on: boolean, label: string): string =>
          `<button type="button" class="advisor-pool-switch${on ? ' on' : ''}" data-toggle="${esc(id)}" aria-pressed="${on}" title="${on ? '点击关闭：不参与胜率比较' : '点击开启：参与胜率比较'}">${label}</button>`;
        const remove =
          e.source === 'user' ? `<button type="button" class="btn advisor-pool-remove" data-id="${esc(e.id)}">移出</button>` : '';
        return `<div class="advisor-pool-row${enabled ? '' : ' off'}" data-source="${e.source}"><span class="advisor-pool-badge">${badge}</span><span class="advisor-pool-note">${esc(e.note)}</span>${sw(e.id, enabled, enabled ? '参战' : '已关')}${remove}</div>`;
      })
      .join('');
    el('.advisor-pool-list').innerHTML =
      `<div class="advisor-note">固定 ${fixed} · 自加 ${added} · 参战 ${on}${off ? ` · 已关 ${off}` : ''} · 版本 ${esc(pool.version)}</div>` +
      (rows || '<div class="dim">对手池是空的</div>');
    const sel = el<HTMLSelectElement>('.advisor-pool-preset');
    const presets = readPresetFile().list.filter((p) => p.slots.filter((s) => s.heroId).length >= 3);
    const prev = sel.value;
    sel.innerHTML = presets.length
      ? presets.map((p) => `<option value="${esc(p.id)}">#${p.no} ${esc(p.name)}</option>`).join('')
      : '<option value="">还没有满编预设</option>';
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function setPoolStatus(msg: string): void {
    el('.advisor-pool-status').textContent = msg;
  }

  /** 加入 / 移出 / 参战开关。加入与移出第一次点变成确认文案，第二次才写；开关一次点到底（可逆）。 */
  function bindOpponentPool(): void {
    el('.advisor-pool-list').addEventListener('click', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLButtonElement>('.advisor-pool-switch');
      if (sw) {
        const res = setOpponentEnabled(sw.dataset.toggle ?? '', !sw.classList.contains('on'));
        setPoolStatus(res.message);
        renderOpponentPool();
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.advisor-pool-remove');
      if (!btn) return;
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认移出？';
        setTimeout(() => {
          if (btn.dataset.armed === '1') {
            delete btn.dataset.armed;
            btn.textContent = '移出';
          }
        }, 3000);
        return;
      }
      const res = removeUserOpponent(btn.dataset.id ?? '');
      setPoolStatus(res.message);
      renderOpponentPool();
    });
    el('.advisor-pool-add').addEventListener('click', () => {
      const btn = el<HTMLButtonElement>('.advisor-pool-add');
      const id = el<HTMLSelectElement>('.advisor-pool-preset').value;
      if (!id) {
        setPoolStatus('先在主站把一支满编队伍存成预设');
        return;
      }
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认加入？';
        setTimeout(() => {
          if (btn.isConnected && btn.dataset.armed === '1') {
            delete btn.dataset.armed;
            btn.textContent = '加入对手池';
          }
        }, 3000);
        return;
      }
      delete btn.dataset.armed;
      btn.textContent = '加入对手池';
      const res = addPresetIdToPool(id);
      setPoolStatus(res.message);
      renderOpponentPool();
    });
  }

  function onEvent(e: AdvisorEvent): void {
    // 工具调用**压成一行**：轨迹行原地刷新，正文只写模型的话
    if (e.type === 'tool_start') trace.start(e.name);
    else if (e.type === 'tool_end') {
      battles += e.battles;
      trace.end(e.name, { battles: e.battles, ms: e.ms, cached: e.cached, ...(e.error ? { error: e.error } : {}) });
    } else if (e.type === 'tool_progress') trace.progress(e.name, e.done, e.total, e.label);
    else if (e.type === 'delta') {
      const bubble = wrap.querySelector<HTMLElement>('.advisor-turn.live .advisor-bubble.assistant');
      if (bubble) bubble.textContent += e.text;
      scrollLogToEnd();
      if (inFlight) inFlight.text += e.text;
    } else if (e.type === 'usage') {
      usage = e.usage;
      tokens += e.usage.totalTokens;
    }
    const traceNode = wrap.querySelector('.advisor-trace');
    if (trace.text() && traceNode) traceNode.textContent = trace.text();
    el('.advisor-cost').textContent = `本轮：${trace.count} 次工具调用 · ${num(battles)} 场 · 词元 ${num(tokens)}`;
    renderProcDetail();
    void usage;
  }

  /**
   * 过程行明细：摘要永远是一行（`.advisor-trace`），逐条工具调用折叠在下面。
   * 进行中优先用 `inFlight.records`（这轮刚开始、还没落盘），否则用最后一轮的记录。
   */
  function renderProcDetail(): void {
    const body = wrap.querySelector<HTMLElement>('.advisor-trace')?.closest('.advisor-proc')?.querySelector<HTMLElement>('.advisor-proc-body');
    if (!body) return;
    const last = session.turns[session.turns.length - 1];
    /* 进行中优先用内存里的 records；已落盘的轮次读 evidence（同一个 ToolCallRecord，去掉 data） */
    const records = inFlight?.records ?? last?.evidence ?? [];
    body.innerHTML = records.length ? procRowsHtml(records) : '<div class="advisor-proc-empty">这一轮还没调用工具。</div>';
  }

  /** 轮末整理偏好（旁路：不抛错、不阻塞对话；开关关掉 / 假传输没脚本 / 没 key 时静默空转） */
  async function refreshProfile(
    turn: AdvisorTurn,
    turnId: string,
    userText: string,
    extractor: ((input: { userText: string; answer: string; profile: PrefProfile }) => Promise<PrefExtractResult>) | null
  ): Promise<void> {
    const s = settings;
    if (!s.autoProfile || !extractor) return;
    if (!turn.answer.trim() && !turn.toolCalls.length) return;
    const res = await extractor({ userText, answer: stripInjected(turn.answer), profile });
    let next = mergePreferences(profile, res.add);
    let removed = 0;
    for (const needle of res.remove) {
      const out = removePreference(next.profile, needle);
      removed += out.removed;
      next = { ...next, profile: out.profile };
    }
    const { added, bumped } = next;
    if (!added && !bumped && !removed) return;
    profile = next.profile;
    saveProfile(profile, store);
    if (destroyed) return;
    renderProfilePanel();
    const note = `档案 +${added}${bumped ? ` · 确认 ${bumped}` : ''}${removed ? ` · 删除 ${removed}` : ''}（共 ${profile.items.length} 条）`;
    session = saveSession(updateTurn(session, turnId, { note }), store);
    append(`\n【记忆】${note}\n`);
    el('.advisor-cost').textContent += ` · ${note}`;
  }

  async function send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || running) return;
    if (!built) build();
    const s = settings;
    const fake = opts.fake === true || isDryRun();
    if (!fake && (!s.key || !s.baseUrl || !s.model)) {
      append('\n【提示】真模型模式需要 baseURL / model / key（或勾上「干跑」看链路演示）。\n');
      return;
    }
    saveSettings(s);
    running = true;
    opts.onRunning?.(true);
    tokens = 0;
    trace = new TraceLine();
    el('.advisor-cost').textContent = '';
    el<HTMLTextAreaElement>('.advisor-input').value = '';
    el<HTMLButtonElement>('.advisor-send').disabled = true;
    el<HTMLButtonElement>('.advisor-stop').disabled = false;
    controller = new AbortController();

    const mode = fake ? '干跑（假传输）' : `${s.model} @ ${s.baseUrl}`;
    const turnId = newTurnId();
    inFlight = { id: turnId, q, mode, text: '', records: [] };
    beginLive(q);

    const hostPlan = opts.host.readTeam();
    const fakePick = fakePlanFor(hostPlan);
    const ctx =
      opts.ctx ??
      makeCtx({
        fakeRuns: false,
        // 每次工具调用都重新读面板（`get_config` 要拿"此刻"的配置，不是开局快照）
        deps: { getConfig: () => cfgOf(opts.host.readTeam()) },
        budget: { maxCalls: s.maxCalls, maxBattles: s.maxBattles, maxTokens: s.maxTokens },
        // 跑批缓存：一次 L2 搜索 ≈8,000 场 / 60 秒，重复问不该重跑（刷新页面也还在）
        cache: createLocalCache(),
      });
    // 「我的 box」：两条路径（生产 / 测试注入）都要按**当前档案 + 严格模式**收窄
    const boxView = currentBoxView(s.strictBox);
    ctx.box = boxView;
    const transport = opts.transport ?? (fake ? fakeScript(fakePick.plan, fakePick.demo) : createBrowserTransport(s));
    // 偏好抽取：与对话**同一条**传输层（同 baseUrl / model / key）；`once` 不存在时自动空转
    const extractor = opts.extract === false ? null : opts.extract ?? createProfileExtractor(transport, { signal: () => controller?.signal });
    // 报价 + 确认：长搜索开跑前问一句（用户可在设置里关掉或改阈值）
    if (s.askBeforeSearch) {
      ctx.confirm = opts.ctx?.confirm ?? askConfirm;
      ctx.confirmFrom = s.askFrom;
    }
    try {
      // 「本次会话的任务」= 会话开头那句话（S2）：**开跑前**就定下来，第一轮也带得上；
      // 落盘仍在轮末统一做（这一份只是本轮注入用）
      const taskSession = ensureTask(session, q);
      const turn = await runAdvisorTurn({
        userText: q,
        ctx,
        transport,
        // 记忆层：上一轮的紧凑转录 + 「你的偏好」档案（每轮都带，摆位见 loop.ts）
        history: historyFrom(session),
        profileText: renderProfileBlock(profile),
        // 「本次会话的任务」静态回显块（防跑题；空任务不注入）
        taskText: renderTaskBlock(taskSession),
        // 首轮锚定（S3）：这个会话还没跑过任何工具 → 本轮第一个请求只发 get_config（+常驻层）
        anchor: session.turns.every((t) => (t.evidence ?? []).length === 0),
        // 「我的 box」：**配将的前提条件**，每轮都进上下文（空 box 也进一小段：先要截图，别假设）
        boxText: renderBoxBlock(boxView),
        signal: controller.signal,
        onEvent,
        onToolRecord: (r) => inFlight?.records.push(r),
      });
      // 落盘：轮次 + 「本次会话的任务」（首问，S2 起随会话持久化——刷新页面后仍然每轮回显）
      session = saveSession(ensureTask(appendTurn(session, toStoredTurn(turn, q, { id: turnId, at: Date.now(), mode })), q), store);
      inFlight = null;
      renderAll();
      // 偏好整理是旁路：它自己抛错也只当"这轮没得记"，绝不能把一轮成功的对话记成失败
      try {
        await refreshProfile(turn, turnId, q, extractor);
      } catch {
        /* 忽略 */
      }
    } catch (e) {
      const msg = `\n【失败】${(e as Error)?.message ?? String(e)}\n`;
      // 中断 / 失败：已跑出来的正文与证据清单照样落盘（不丢半成品），再整体重放一次
      flush();
      inFlight = null;
      if (destroyed) return;
      renderAll();
      append(msg);
    } finally {
      running = false;
      opts.onRunning?.(false);
      if (!destroyed) {
        el<HTMLButtonElement>('.advisor-send').disabled = false;
        el<HTMLButtonElement>('.advisor-stop').disabled = true;
      }
      controller = null;
    }
  }

  function open(): void {
    parked = false;
    if (!built) build();
    wrap.classList.add('open');
    if (!built) return;
    renderTeam();
    scrollLogToEnd();
  }
  function park(): void {
    parked = true;
  }
  function close(): void {
    controller?.abort();
    wrap.classList.remove('open');
  }

  /* 独立页：挂载即构建并显示（没有"收起态"；`open()` 留给测试与兼容） */
  open();

  return {
    open,
    close,
    park,
    isOpen: () => wrap.classList.contains('open'),
    destroy() {
      destroyed = true;
      controller?.abort();
      unsubSettings();
      if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('paste', onPaste);
      wrap.remove();
    },
    __send: send,
  };
}
