/**
 * 阵容预设面板（顶栏「预设」）＋ 预设命名弹窗。
 *
 * 左列表：搜索框（预设名 / 武将名 / #编号）+ 编号升序列表（#编号 · 预设名 · 红/蓝标签 · 三将 · 更新时间）；
 * 右详情：三将配置明细（战法 / 兵种转换 + 兵系特性 / 宝物 + 词条 / 加点 / 红度 / 等级）
 *         + 动作（上场到红/蓝队、木桩队伍[占位]、重命名、删除[二次确认]）。
 *
 * 面板只负责展示与转发：存档读写、配将区改动都由调用方（main.ts）注入，便于单测直接喂假数据。
 * 按钮一律走项目按键标准 `class="btn beige"`（见 styles.css「项目按键标准」），不用裸文字 .btn.ghost
 * —— 用户 2026-09-22：「所有的按键都为按钮，用按钮的统一 UI 设计」。
 */
import { SIDE_LABEL, searchPresets, type TeamPreset, type TeamSide } from './presetStore';
import { getHeroById, avatarSrc, rednessStars, skillGrade } from './heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID, AFFIXES } from '../src/data/treasures';
import { SECONDARY_TROOPS } from '../src/engine/secondaryTroop';
import type { SlotState } from './teamEditor';

/** 面板动作结果：`error` 有值 = 失败（面板内提示），`presetId` = 新建/覆盖后的预设（自动选中） */
export interface PresetActionResult {
  error?: string;
  presetId?: string;
}

export interface PresetPanelDeps {
  /** 当前全部预设（编号升序） */
  getPresets: () => TeamPreset[];
  /** 保存当前某边队伍；同边同名由实现方按「覆盖」处理 */
  saveCurrent: (side: TeamSide, name: string) => PresetActionResult;
  /** 用预设替换该边队伍 */
  apply: (preset: TeamPreset, side: TeamSide) => void;
  /**
   * 木桩队伍：把这支预设的阵容设为伤害测试的「木桩队伍」并跳转实验室（实验室里可「切回侍卫」）。
   * 面板只转发；不提供则不显示该动作。
   */
  useAsDummy?: (preset: TeamPreset) => void;
  rename: (id: string, name: string) => PresetActionResult;
  remove: (id: string) => void;
  /** 木桩模式（从伤害测试实验室打开）：「设为木桩队伍」当主按钮，上场按钮退成米黄 beige */
  dummyMode?: boolean;
  /** 关闭面板（可选） */
  onClose?: () => void;
}

export interface PresetPanelHandle {
  close: () => void;
}

const POS_LABEL = ['大营', '中军', '前锋'];
const FREE_LABEL: Array<[keyof SlotState['freePoints'], string]> = [
  ['attack', '攻击'],
  ['defense', '防御'],
  ['strategy', '谋略'],
  ['speed', '速度'],
];
const TYPE_NAME: Record<string, string> = { cavalry: '骑兵', infantry: '步兵', archer: '弓兵' };

/** 时间格式化：MM-DD HH:mm（列表与详情共用，测试可断言固定格式） */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 槽位一行摘要（三将名，用「、」连接；空槽标「空缺」） */
export function slotsSummary(slots: SlotState[]): string {
  const names = slots.map((s) => (s.heroId ? getHeroById(s.heroId)?.name ?? s.heroId : '空缺'));
  const filled = names.filter((n) => n !== '空缺');
  return filled.length ? filled.join('、') : '空缺';
}

/** 战法名（主战法在左，其后装配战法；未实装的主战法回退到武将档案里的名字） */
function skillNames(slot: SlotState): Array<{ name: string; main: boolean; grade: string }> {
  const hero = slot.heroId ? getHeroById(slot.heroId) : undefined;
  const out: Array<{ name: string; main: boolean; grade: string }> = [];
  if (slot.heroId && hero?.mainSkillId) {
    const s = SKILL_REGISTRY[hero.mainSkillId];
    out.push({ name: s?.name ?? hero.mainSkillName ?? '（主战法）', main: true, grade: skillGrade(hero.mainSkillId) });
  }
  for (const id of slot.extraSkillIds) {
    const s = SKILL_REGISTRY[id];
    if (s) out.push({ name: s.name, main: false, grade: skillGrade(id) });
  }
  return out;
}

/** 加点摘要：只列非 0 项（如「谋略+20 速度+10」） */
function freePointsText(slot: SlotState): string {
  const parts = FREE_LABEL.filter(([k]) => slot.freePoints[k] > 0).map(([k, label]) => `${label}+${slot.freePoints[k]}`);
  return parts.length ? parts.join(' ') : '无加点';
}

/** 宝物摘要：名称 +（锻造词条 数值） */
function treasureText(slot: SlotState): string {
  const cur = slot.treasure;
  const t = cur ? TREASURES_BY_ID[cur.treasureId] : null;
  if (!cur || !t) return '未佩戴宝物';
  const affix = cur.affix ? AFFIXES[cur.affix.name] : null;
  const v = cur.affix && affix ? ` ${cur.affix.value}${affix.unit === 'percent' ? '%' : ''}` : '';
  return `${t.name}${cur.affix ? `（${cur.affix.name}${v}）` : '（未锻造）'}`;
}

/** 兵种摘要：二级兵种（+兵系家族）或基础兵种 */
function troopText(slot: SlotState, heroTroop: string | undefined): string {
  if (slot.secondaryTroop) {
    const d = SECONDARY_TROOPS[slot.secondaryTroop];
    const traits = (slot.secondaryTraits ?? []).filter(Boolean);
    return `${slot.secondaryTroop}（${d?.family ?? ''}${traits.length ? ` · 特性 ${traits.join('/')}` : ''}）`;
  }
  return TYPE_NAME[heroTroop ?? ''] ?? '—';
}

/** 单槽明细（空槽 → 一行占位）。导出给伤害测试实验室的「木桩队伍」面板复用（用户 2026-09-22）。 */
export function slotDetailHtml(slot: SlotState, i: number): string {
  const pos = POS_LABEL[i] ?? '';
  const hero = slot.heroId ? getHeroById(slot.heroId) : undefined;
  if (!slot.heroId || !hero) {
    return `<div class="pd-slot empty"><span class="pd-pos">${pos}</span><span class="pd-empty">空缺</span></div>`;
  }
  const skills = skillNames(slot);
  const skillHtml = skills.length
    ? skills
        .map((s) => `<span class="pd-skill${s.main ? ' main' : ''}" data-grade="${s.grade}" title="${s.main ? '主战法' : '装配战法'}">${s.name}</span>`)
        .join('')
    : `<span class="pd-skill none">无战法（主战法未实装）</span>`;
  return `<div class="pd-slot">
      <span class="pd-pos">${pos}</span>
      <img class="pd-av" src="${avatarSrc(hero.id)}" alt="" onerror="this.style.display='none'" />
      <div class="pd-slot-main">
        <div class="pd-hero-line">
          <span class="pd-hero-name">${hero.name}</span>
          <span class="pd-lv">Lv.${slot.level}</span>
          <span class="pd-red" title="红度 ${slot.redness}/5">${rednessStars(slot.redness)}</span>
          <span class="pd-troop">${troopText(slot, hero.troopType)}</span>
        </div>
        <div class="pd-skills">${skillHtml}</div>
        <div class="pd-meta">加点 ${freePointsText(slot)}<i>·</i>${treasureText(slot)}</div>
      </div>
    </div>`;
}

/**
 * 预设命名弹窗（每队「保存预设」按钮与管理面板的「保存红队/蓝队」共用）。
 * `onSubmit` 返回错误文案 → 弹窗保留并内联显示；返回 null → 关闭。
 */
export function openPresetNameDialog(opts: {
  title: string;
  hint?: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  onSubmit: (name: string) => string | null;
}): void {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal preset-name-modal';
  modal.innerHTML = `
    <div class="m-head"><h3>${opts.title}</h3><span class="m-close">×</span></div>
    <div class="m-body">
      <div class="pn-hint">${opts.hint ?? '给这支队伍取个名字（如「双减魏智」「战磐魏智」），下次可直接上场'}</div>
      <input class="pn-input" type="text" maxlength="20" placeholder="${opts.placeholder ?? '预设名'}" />
      <div class="pn-error"></div>
    </div>
    <div class="m-foot">
      <button class="btn beige pn-cancel" type="button">取消</button>
      <button class="btn pn-ok" type="button">${opts.confirmText ?? '保存预设'}</button>
    </div>
  `;
  const input = modal.querySelector('.pn-input') as HTMLInputElement;
  const err = modal.querySelector('.pn-error') as HTMLElement;
  input.value = opts.initial ?? '';
  const close = (): void => mask.remove();
  const submit = (): void => {
    const message = opts.onSubmit(input.value);
    if (message) {
      err.textContent = message;
      input.focus();
      input.select();
      return;
    }
    close();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  input.addEventListener('input', () => {
    err.textContent = '';
  });
  (modal.querySelector('.pn-ok') as HTMLElement).addEventListener('click', submit);
  (modal.querySelector('.pn-cancel') as HTMLElement).addEventListener('click', close);
  (modal.querySelector('.m-close') as HTMLElement).addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.appendChild(modal);
  document.body.appendChild(mask);
  input.focus();
}

/**
 * 打开阵容预设面板。列表与详情都从 `deps.getPresets()` 现取现渲染——
 * 存档变更后不必重建面板，重新渲染即可。
 */
export function openPresetPanel(deps: PresetPanelDeps): PresetPanelHandle {
  let query = '';
  let selectedId: string | null = null;
  let armedDelete = false;

  const mask = document.createElement('div');
  mask.className = 'modal-mask page-mask';
  const modal = document.createElement('div');
  modal.className = 'modal page-modal preset-modal';
  modal.innerHTML = `
    <div class="m-head">
      <h3>阵容预设</h3>
      <input class="preset-search" type="text" placeholder="搜索预设名 / 武将名 / #编号…" />
      <span class="m-close">×</span>
    </div>
    <div class="m-body preset-body">
      <div class="preset-list"></div>
      <div class="preset-detail"></div>
    </div>
    <div class="m-foot preset-foot">
      <span class="preset-count"></span>
      <span class="spacer"></span>
      <button class="btn beige preset-save" data-side="red" type="button">保存红队</button>
      <button class="btn beige preset-save" data-side="blue" type="button">保存蓝队</button>
      <button class="btn beige preset-done" type="button">完成</button>
    </div>
  `;
  const listBox = modal.querySelector('.preset-list') as HTMLElement;
  const detailBox = modal.querySelector('.preset-detail') as HTMLElement;
  const countBox = modal.querySelector('.preset-count') as HTMLElement;
  const search = modal.querySelector('.preset-search') as HTMLInputElement;

  const heroNameOf = (id: string): string => getHeroById(id)?.name ?? '';

  /** 搜到的列表（编号升序）；无选中或选中项被过滤掉 → 自动选中第一条 */
  const visible = (): TeamPreset[] => searchPresets(deps.getPresets(), query, heroNameOf);

  const renderList = (): void => {
    const all = deps.getPresets();
    const items = visible();
    if (selectedId && !items.some((p) => p.id === selectedId)) selectedId = null;
    if (!selectedId && items.length) selectedId = items[0].id;

    countBox.textContent = query.trim() ? `筛选出 ${items.length} / ${all.length} 条` : `共 ${all.length} 条 · 上限 50 条`;
    listBox.innerHTML = '';
    if (items.length === 0) {
      listBox.innerHTML = all.length
        ? `<div class="preset-empty">没有匹配「${query.trim()}」的预设</div>`
        : `<div class="preset-empty">暂无预设<br /><span>配置好一边队伍后，点该队标题行的「保存预设」，或用右下角「保存红队 / 保存蓝队」</span></div>`;
      return;
    }
    for (const p of items) {
      const item = document.createElement('div');
      item.className = `preset-item${p.id === selectedId ? ' on' : ''}`;
      item.dataset.presetId = p.id;
      item.dataset.no = String(p.no);
      item.innerHTML = `
        <span class="pi-no">#${p.no}</span>
        <div class="pi-main">
          <div class="pi-head">
            <span class="pi-name" title="${p.name}">${p.name}</span>
            <span class="pi-side ${p.side}">${SIDE_LABEL[p.side]}</span>
          </div>
          <div class="pi-heroes">${slotsSummary(p.slots)}</div>
          <div class="pi-time">${fmtTime(p.updatedAt)}</div>
        </div>
      `;
      item.onclick = () => {
        selectedId = p.id;
        armedDelete = false;
        renderList();
        renderDetail();
      };
      listBox.appendChild(item);
    }
  };

  const renderDetail = (): void => {
    const preset = deps.getPresets().find((p) => p.id === selectedId);
    detailBox.innerHTML = '';
    if (!preset) {
      detailBox.innerHTML = `<div class="hist-empty">从左侧选择一条预设查看详情</div>`;
      return;
    }
    const head = document.createElement('div');
    head.className = 'pd-head';
    head.innerHTML = `
      <span class="pi-no">#${preset.no}</span>
      <span class="pd-title">${preset.name}</span>
      <span class="pi-side ${preset.side}">${SIDE_LABEL[preset.side]}</span>
      <span class="pd-time">保存 ${fmtTime(preset.createdAt)}${preset.updatedAt !== preset.createdAt ? ` · 更新 ${fmtTime(preset.updatedAt)}` : ''}</span>
    `;
    const slots = document.createElement('div');
    slots.className = 'pd-slots';
    slots.innerHTML = preset.slots.map((s, i) => slotDetailHtml(s, i)).join('');
    const actions = document.createElement('div');
    actions.className = 'pd-actions';
    // 木桩模式（从实验室打开）＝「设为木桩队伍」当主按钮（金色 btn），上场按钮退成米黄 beige（用户 2026-09-22 按键标准）
    const primaryApply = (side: TeamSide): string => (preset.side === side && !deps.dummyMode ? '' : ' beige');
    const dummyBtn = deps.useAsDummy
      ? `<button class="btn${deps.dummyMode ? '' : ' beige'}" data-act="dummy" type="button" title="把这支队伍设为伤害测试的木桩对手，并直接进入伤害测试实验室（可随时「切回侍卫」）">设为木桩队伍</button>`
      : '';
    actions.innerHTML = `
      <button class="btn${primaryApply('red')}" data-act="apply-red" type="button">上场到红队</button>
      <button class="btn${primaryApply('blue')}" data-act="apply-blue" type="button">上场到蓝队</button>
      ${dummyBtn}
      <button class="btn beige" data-act="rename" type="button">重命名</button>
      <button class="btn beige danger" data-act="remove" type="button">${armedDelete ? '再点一次确认删除' : '删除'}</button>
    `;
    // 上场 = 整边替换 + 关面板（「快速上场」的主路径）
    actions.querySelector('[data-act="apply-red"]')!.addEventListener('click', () => {
      deps.apply(preset, 'red');
      close();
    });
    actions.querySelector('[data-act="apply-blue"]')!.addEventListener('click', () => {
      deps.apply(preset, 'blue');
      close();
    });
    // 木桩队伍：设为伤害测试的敌方并直接进实验室（与「上场」同口径：动作后关面板）
    actions.querySelector('[data-act="dummy"]')?.addEventListener('click', () => {
      deps.useAsDummy!(preset);
      close();
    });
    actions.querySelector('[data-act="rename"]')!.addEventListener('click', () => {
      openPresetNameDialog({
        title: `重命名预设 #${preset.no}`,
        hint: `当前名称「${preset.name}」`,
        initial: preset.name,
        confirmText: '保存名称',
        onSubmit: (name) => {
          const r = deps.rename(preset.id, name);
          if (r.error) return r.error;
          renderList();
          renderDetail();
          return null;
        },
      });
    });
    actions.querySelector('[data-act="remove"]')!.addEventListener('click', () => {
      if (!armedDelete) {
        armedDelete = true;
        renderDetail();
        return;
      }
      armedDelete = false;
      if (selectedId === preset.id) selectedId = null;
      deps.remove(preset.id);
      renderList();
      renderDetail();
    });
    detailBox.append(head, slots, actions);
  };

  search.addEventListener('input', () => {
    query = search.value;
    armedDelete = false;
    renderList();
    renderDetail();
  });
  modal.querySelectorAll<HTMLElement>('.preset-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = (btn.dataset.side === 'blue' ? 'blue' : 'red') as TeamSide;
      openPresetNameDialog({
        title: `保存预设 · ${SIDE_LABEL[side]}`,
        hint: `把当前${SIDE_LABEL[side]}的三将配置（战法 / 兵种 / 宝物 / 加点）存为预设，下次一键上场`,
        placeholder: '如：双减魏智',
        onSubmit: (name) => {
          const r = deps.saveCurrent(side, name);
          if (r.error) return r.error;
          if (r.presetId) selectedId = r.presetId;
          renderList();
          renderDetail();
          return null;
        },
      });
    });
  });

  const close = (): void => {
    mask.remove();
    deps.onClose?.();
  };
  (modal.querySelector('.m-close') as HTMLElement).addEventListener('click', close);
  (modal.querySelector('.preset-done') as HTMLElement).addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  mask.appendChild(modal);
  document.body.appendChild(mask);
  renderList();
  renderDetail();
  return { close };
}
