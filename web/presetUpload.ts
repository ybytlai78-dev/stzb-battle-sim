/**
 * 预设识图 · 上传弹窗（「热门预设」面板头部那个「上传图片」的落点）
 * ---------------------------------------------------------------------------
 * 用户口径（2026-10-21）：
 *   · 入口在「热门预设」面板右上角（截图标注的位置，× 左边）；
 *   · 上传游戏「阵容详情」截图 → 识别 **三将 / 红度 / 每人三个战法**；
 *   · 兵种 / 宝物 / 加点**由用户自己在配将区加**，**等级一律 40**；
 *   · 识别完**先给确认卡**（三将 + 红度 + 战法一眼能核对、可改预设名、可切红/蓝队），点一下才落进「我的预设」（可删）。
 *
 * 分工：本文件只做界面与流程；对齐在 `web/presetScan.ts`、读图在 `web/presetScanVision.ts`。
 * 存档写入由调用方注入（`deps.save` → main.ts 的 `saveSlotsAsPreset`），便于单测直接喂假数据。
 */
import './presetUpload.css';
import { isDryRun, loadSettings, openSettingsPanel } from './settings';
import { createBrowserTransport, createFakeTransport, type AdvisorTransport } from './advisor/transport';
import { recognizeTeam, scanImageToDataUrl, SAMPLE_TEAM_REPLY } from './presetScanVision';
import { matchTeamScan, scanSummaryText, toSlotStates, type ScanSlotResult, type TeamScanJson, type TeamScanResult } from './presetScan';
import { SIDE_LABEL, type TeamSide } from './presetStore';
import { avatarSrc, rednessStars, TROOP_CHAR } from './heroes';
import type { SlotState } from './teamEditor';

export interface PresetScanSaveInput {
  name: string;
  side: TeamSide;
  slots: SlotState[];
}

export interface PresetUploadDeps {
  /** 存进「我的预设」（同边同名 = 覆盖）；返回 `error` 时弹窗保留并内联提示 */
  save: (input: PresetScanSaveInput) => { error?: string; presetId?: string };
  /** 默认落哪一队（缺省红队；确认卡上可改） */
  defaultSide?: TeamSide;
  /** 落库成功后回调（面板用来刷新列表并选中新条目） */
  onSaved?: (presetId?: string) => void;
  onClose?: () => void;
  /** 测试注入：传输层（给了就不按设置建真实传输） */
  transport?: AdvisorTransport;
  /** 测试注入：直接给 data URL（跳过选图与图片压缩） */
  images?: string[];
  /** 测试注入：干跑（用示例回复跑通「识别 → 对齐 → 确认卡 → 落库」） */
  fake?: boolean;
}

export interface PresetUploadHandle {
  close: () => void;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const POS_LABEL = ['大营', '中军', '前锋'];

/** 单槽一行：位置 / 头像 / 名字 / 红度 / 三个战法 / 备注（候选、未命中、下架） */
function slotRowHtml(s: ScanSlotResult, i: number): string {
  const pos = POS_LABEL[i] ?? s.position;
  const hero = s.heroId ? { id: s.heroId, name: s.heroName } : null;
  if (!hero) {
    const cands = s.candidates
      .map(
        (c) =>
          `<button type="button" class="btn beige scan-pick" data-pos="${esc(s.position)}" data-id="${esc(c.id)}" title="库里对得上这个名字的版本，点一下用它">${esc(c.name)}（${esc(c.faction)}·${esc(c.troopType)}）</button>`
      )
      .join('');
    return `<div class="scan-row bad">
      <span class="scan-pos">${esc(pos)}</span>
      <span class="scan-av none">?</span>
      <div class="scan-main">
        <div class="scan-hero"><span class="scan-name">${esc(s.raw.heroName || '（没读到）')}</span><span class="scan-tag">未识别</span></div>
        <div class="scan-note">这个槽位会留空——也可以点下面的按钮直接指定${cands ? '：' : '（库里没有这个名字，确认是不是 SP / XP 版本）'}</div>
        ${cands ? `<div class="scan-cands">${cands}</div>` : ''}
      </div>
    </div>`;
  }
  const skills = [
    s.mainSkillName ? `<span class="scan-skill main" title="主战法（随武将自带）">${esc(s.mainSkillName)}</span>` : '',
    ...s.extraSkillNames.map((n) => `<span class="scan-skill">${esc(n)}</span>`),
  ].join('');
  const cands = s.candidates.length
    ? `<div class="scan-cands">${s.candidates
        .map(
          (c) =>
            `<button type="button" class="btn beige scan-pick" data-pos="${esc(s.position)}" data-id="${esc(c.id)}" title="同名多版，点一下换这个">${esc(c.name)}（${esc(c.faction)}·${esc(c.troopType)}）</button>`
        )
        .join('')}</div>`
    : '';
  const notes = [
    s.unmatchedSkills.length ? `没认出来的战法：${s.unmatchedSkills.map((n) => `「${esc(n)}」`).join('')}（已跳过，可在配将区补）` : '',
    s.warn ? esc(s.warn) : '',
    s.rawLevel && s.rawLevel !== 40 ? `截图 Lv${s.rawLevel} → 按 40 级存（口径如此）` : '',
  ].filter(Boolean);
  return `<div class="scan-row">
      <span class="scan-pos">${esc(pos)}</span>
      <img class="scan-av" src="${avatarSrc(hero.id)}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="scan-main">
        <div class="scan-hero">
          <span class="scan-name">${esc(hero.name)}</span>
          <span class="scan-lv">Lv.40</span>
          <span class="scan-red" title="红度 ${s.redness}/5">${rednessStars(s.redness)}</span>
          <span class="scan-troop">${esc(TROOP_CHAR[(s.raw.troopType ?? '')] ?? s.raw.troopType ?? '')}</span>
        </div>
        <div class="scan-skills">${skills || '<span class="scan-skill none">没读到战法</span>'}</div>
        ${notes.length ? `<div class="scan-note">${notes.join(' · ')}</div>` : ''}
        ${cands}
      </div>
    </div>`;
}

/**
 * 打开「上传图片 · 识别队伍」弹窗。
 * 选图后**自动开始识别**（少一次点击）；识别完进确认卡，点「存入我的预设」才落库。
 */
export function openPresetUploadDialog(deps: PresetUploadDeps): PresetUploadHandle {
  let images: string[] = [...(deps.images ?? [])];
  let raw: TeamScanJson | null = null;
  let result: TeamScanResult | null = null;
  let overrides: Partial<Record<string, string>> = {};
  let side: TeamSide = deps.defaultSide ?? 'red';
  let scanning = false;
  let destroyed = false;
  /** 用户在确认卡里改过的预设名（重画确认卡时不能把它冲掉） */
  let nameText = '';
  /** 真模型模式但没配模型 → 页脚给一个「去设置」的入口（别让用户卡在"识别失败"） */
  let needSettings = false;

  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal scan-modal';
  modal.innerHTML = `
    <div class="m-head">
      <h3>上传图片 · 识别队伍</h3>
      <span class="scan-badge"></span>
      <span class="spacer"></span>
      <span class="m-close">×</span>
    </div>
    <div class="m-body scan-body"></div>
    <div class="m-foot scan-foot"></div>
  `;
  const body = modal.querySelector('.scan-body') as HTMLElement;
  const foot = modal.querySelector('.scan-foot') as HTMLElement;
  const badge = modal.querySelector('.scan-badge') as HTMLElement;

  const close = (): void => {
    destroyed = true;
    document.removeEventListener('paste', onPaste);
    mask.remove();
    deps.onClose?.();
  };

  /** 干跑：没配模型（或测试强制）时用示例回复跑通链路，界面必须标「不是真读图」 */
  const isFake = (): boolean => deps.fake === true || (!deps.transport && isDryRun());

  function setStatus(text: string, kind: 'ok' | 'bad' | 'busy' = 'ok'): void {
    const node = body.querySelector('.scan-status');
    if (!node) return;
    node.textContent = text;
    node.className = `scan-status${kind === 'ok' ? '' : ` ${kind}`}`;
  }

  // ─────────────────────────── 选图 / 识别 ───────────────────────────

  async function addFiles(files: ArrayLike<File>): Promise<void> {
    if (scanning || destroyed) return;
    const file = files[0];
    if (!file) return;
    setStatus('正在读取图片…', 'busy');
    try {
      const url = await scanImageToDataUrl(file);
      images = [url];
      raw = null;
      result = null;
      overrides = {};
      render();
      await run();
    } catch (e) {
      setStatus(`图片读不了：${(e as Error)?.message ?? String(e)}`, 'bad');
    }
  }

  async function run(): Promise<void> {
    if (scanning) return;
    const image = images[0];
    if (!image) {
      setStatus('先选一张「阵容详情」截图', 'bad');
      return;
    }
    const s = loadSettings();
    const fake = isFake();
    if (!deps.transport && !fake && (!s.key || !s.baseUrl || !s.model)) {
      needSettings = true;
      render();
      setStatus('真模型模式需要先在 ⚙ 设置里填「接口地址 / 模型 / 密钥」——识图用的是你自己接入的那个模型', 'bad');
      return;
    }
    const transport =
      deps.transport ?? (fake ? createFakeTransport([], { onceReply: () => SAMPLE_TEAM_REPLY }) : createBrowserTransport(s));
    scanning = true;
    setStatus(fake ? '正在识别（干跑示例，不是真读图）…' : '正在读图…', 'busy');
    try {
      const res = await recognizeTeam({ image, transport });
      raw = res.raw;
      overrides = {};
      result = matchTeamScan(raw, { heroOverrides: overrides });
      render();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      setStatus(`识别失败：${msg}`, 'bad');
    } finally {
      scanning = false;
    }
  }

  /** 粘一张图进来（只在弹窗开着时接管；非图片的粘贴照旧） */
  function onPaste(e: ClipboardEvent): void {
    if (destroyed) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  }

  // ─────────────────────────── 渲染 ───────────────────────────

  function render(): void {
    if (destroyed) return;
    badge.textContent = isFake() && result ? '干跑示例（不是真读图）' : '';
    badge.className = `scan-badge${isFake() && result ? ' on' : ''}`;
    body.innerHTML = result ? reviewHtml(result) : pickHtml();
    foot.innerHTML = result
      ? `<span class="scan-foot-hint"></span><span class="spacer"></span>
         <button type="button" class="btn beige scan-reset">重选图片</button>
         <button type="button" class="btn beige scan-cancel">取消</button>
         <button type="button" class="btn scan-save">存入我的预设</button>`
      : `<span class="scan-foot-hint">识别：三将 · 红度 · 每人三个战法｜兵种 / 宝物 / 加点你自己加，等级一律 40</span>
         <span class="spacer"></span>
         ${needSettings ? '<button type="button" class="btn beige scan-settings">去设置里填模型</button>' : ''}
         <button type="button" class="btn beige scan-cancel">取消</button>`;

    // 顶部关闭 / 取消
    foot.querySelector('.scan-cancel')?.addEventListener('click', close);
    foot.querySelector('.scan-settings')?.addEventListener('click', () => openSettingsPanel());
    foot.querySelector('.scan-reset')?.addEventListener('click', () => {
      raw = null;
      result = null;
      overrides = {};
      images = [];
      render();
    });

    if (!result) {
      const drop = body.querySelector('.scan-drop') as HTMLElement;
      const fileInput = body.querySelector('.scan-file') as HTMLInputElement;
      // 隐藏 input 的 click 也会冒泡到这里 → 必须拦住，否则 fileInput.click() 递归打不开
      drop.addEventListener('click', (e) => {
        if ((e.target as HTMLElement)?.classList?.contains('scan-file')) return;
        fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files?.length) void addFiles(fileInput.files);
      });
      for (const ev of ['dragover', 'dragenter'] as const) {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('on');
        });
      }
      for (const ev of ['dragleave', 'drop'] as const) {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove('on');
        });
      }
      drop.addEventListener('drop', (e) => {
        const files = (e as DragEvent).dataTransfer?.files;
        if (files?.length) void addFiles(files);
      });
      return;
    }

    // 预设名 / 落哪一队
    const nameInput = body.querySelector('.scan-name-input') as HTMLInputElement;
    nameInput.value = nameText || result.name;
    nameInput.addEventListener('input', () => {
      nameText = nameInput.value;
      foot.querySelector('.scan-foot-hint')!.textContent = '';
    });
    body.querySelectorAll<HTMLElement>('.scan-side-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        side = btn.dataset.side === 'blue' ? 'blue' : 'red';
        body.querySelectorAll<HTMLElement>('.scan-side-btn').forEach((b) => b.classList.toggle('on', b === btn));
      });
    });
    body.querySelectorAll<HTMLElement>('.scan-side-btn').forEach((b) => b.classList.toggle('on', b.dataset.side === side));

    // 同名多版：点候选直接定案（重跑对齐，其余口径不变）
    body.querySelectorAll<HTMLElement>('.scan-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pos = btn.dataset.pos ?? '';
        const id = btn.dataset.id ?? '';
        if (!pos || !id || !raw) return;
        overrides = { ...overrides, [pos]: id };
        result = matchTeamScan(raw, { heroOverrides: overrides });
        render();
      });
    });

    foot.querySelector('.scan-save')?.addEventListener('click', () => {
      const hint = foot.querySelector('.scan-foot-hint') as HTMLElement;
      if (!result) return;
      if (result.heroCount === 0) {
        hint.textContent = '一个武将都没认出来——换张清晰的截图，或在配将区手动配置';
        return;
      }
      // 名字以输入框当前值为准（`nameText` 只用来跨重画保住用户改过的内容）
      const name = nameInput.value.trim() || result.name;
      const r = deps.save({ name, side, slots: toSlotStates(result) });
      if (r.error) {
        hint.textContent = r.error;
        return;
      }
      close();
      deps.onSaved?.(r.presetId);
    });
  }

  function pickHtml(): string {
    const thumb = images.length
      ? `<div class="scan-thumb"><img src="${images[0]}" alt="待识别截图" /></div>`
      : '';
    return `
      <div class="scan-drop" role="button" tabindex="0">
        <div class="scan-drop-title">把「阵容详情」截图拖进来</div>
        <div class="scan-drop-sub">或点这里选图 / 直接 Ctrl+V 粘贴。一张图 = 一支队伍（大营 / 中军 / 前锋三行）。</div>
        <input type="file" class="scan-file" accept="image/*" hidden />
      </div>
      ${thumb}
      <div class="scan-status">${images.length ? '' : '支持 png / jpg / webp，单张 8MB 以内'}</div>
    `;
  }

  function reviewHtml(res: TeamScanResult): string {
    const issues = res.issues.filter((i) => i.level === 'warn');
    const errors = res.issues.filter((i) => i.level === 'error');
    const issueHtml = [...errors, ...issues]
      .slice(0, 8)
      .map((i) => `<div class="scan-issue${i.level === 'error' ? ' err' : ''}">${esc(i.message)}</div>`)
      .join('');
    return `
      <div class="scan-review-head">
        <span class="scan-review-title">识别结果</span>
        <span class="scan-sum">${esc(scanSummaryText(res))}</span>
        ${res.unrecognized.length ? `<span class="scan-unrec">看不清：${esc(res.unrecognized.slice(0, 4).join('；'))}</span>` : ''}
      </div>
      <div class="scan-rows">${res.slots.map((s, i) => slotRowHtml(s, i)).join('')}</div>
      ${issueHtml ? `<div class="scan-issues">${issueHtml}</div>` : ''}
      <div class="scan-form">
        <label class="scan-name-wrap">预设名<input class="scan-name-input" type="text" maxlength="20" placeholder="如：识图·司马炎-乐进-于禁" /></label>
        <div class="scan-side">
          <span class="scan-side-label">落哪一队</span>
          <button type="button" class="btn beige scan-side-btn${side === 'red' ? ' on' : ''}" data-side="red">${SIDE_LABEL.red}</button>
          <button type="button" class="btn beige scan-side-btn${side === 'blue' ? ' on' : ''}" data-side="blue">${SIDE_LABEL.blue}</button>
        </div>
      </div>
      <div class="scan-hint-line">兵种转换 / 兵系特性 / 宝物 / 加点按口径留空，落库后在配将区自己加；等级一律 40。</div>
    `;
  }

  (modal.querySelector('.m-close') as HTMLElement).addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  document.addEventListener('paste', onPaste);
  mask.appendChild(modal);
  document.body.appendChild(mask);
  render();
  // 调用方直接喂了图（测试 / 复跑）：进弹窗就开始识别
  if (images.length) void run();
  return { close };
}
