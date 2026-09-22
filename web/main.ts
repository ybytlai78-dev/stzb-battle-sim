/**
 * 战斗模拟器入口：选将 → 配战法 → 运行引擎 → 逐回合可视化战报
 * 布局：100% 固定单屏 —— 顶栏（战报/战法） / 中间配将区 / 底栏（开始模拟）
 */
import './styles.css';
import './mobile.css';
import './lab.css';
import './tutorial.css';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';
import type { BattleReport } from '../src/engine/types';
import { buildGeneral, freePointBudget, getHeroById } from './heroes';
import {
  emptyEditor,
  renderTeamEditor,
  mutualConflict,
  emptySlot,
  openSkillBag,
  openHistoryPanel,
  type BattleRecord,
  type EditorHandlers,
  type EditorState,
  type SlotState,
} from './teamEditor';
import { showNotice } from './notice';
import { openPresetNameDialog, openPresetPanel, type PresetActionResult, type PresetPanelDeps } from './presetPanel';
import {
  PRESET_MAX,
  SIDE_LABEL,
  addPreset,
  cloneSlots,
  heroCount,
  nameError,
  overwritePreset,
  readPresetFile,
  removePreset,
  renamePreset,
  writePresetFile,
  type PresetFile,
  type TeamPreset,
  type TeamSide,
} from './presetStore';
import { TRAIT_SLOTS_MAX, traitsFor } from '../src/engine/secondaryTroop';
import { HERO_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { asset } from './assets';
import { openTutorialPanel } from './tutorial';
import { setupTouchDrag } from './touchDrag';
import { setupBackButton } from './backButton';
import { createBattleView } from './battleView';
import { createBattleSummary, createStatsView } from './battleSummary';
import { mountDamageLab, setDummyPreset } from './damageLab';

// ─── 状态 ───
const state: EditorState = emptyEditor();
/** 最大回合固定 8，不可调整 */
const MAX_ROUNDS = 8;
/** 随机种子：用户不可调整，每次点击「开始模拟」由系统内部自动生成新种子 */
let seed = Math.floor(Math.random() * 1000000);
/** 双方士气（影响战法发动率，120 → 系数 1.12），默认 120 */
let redMorale = 120;
let blueMorale = 120;

/**
 * 构建标记（显示在底栏，用来一眼确认手机上装的是哪一版）。
 * ⚠️ 改 android/app/build.gradle 的 versionName 时，这里同步改 —— 两边保持一致。
 * 起因：测试包 versionCode/versionName 长期不动，装机后分不清装的是新版还是旧版，
 * 只能靠肉眼猜 UI 有没有变。
 */
export const BUILD_TAG = 'v2.0';

const errBox = document.createElement('div');
errBox.className = 'err-msg';
let app: HTMLElement;
let editorRoot: HTMLElement;
let controlBar: HTMLElement;
const battleRoot = document.createElement('div');
battleRoot.className = 'battle-root';

// ─── 战报历史（localStorage 持久化，最多 20 条）───
const HISTORY_KEY = 'stzb_battle_history';
const history: BattleRecord[] = loadHistory();

function loadHistory(): BattleRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as BattleRecord[];
    return Array.isArray(list) ? list.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  } catch {
    /* 存储不可用时静默降级为会话内历史 */
  }
}

function recordBattle(report: BattleReport, my: General[], enemy: General[]): void {
  const names = (team: General[]) =>
    ['大营', '中军', '前锋'].map((p) => team.find((g) => g.position === p)?.name ?? '');
  history.unshift({
    id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    ts: Date.now(),
    label: '',
    result: report.result,
    rounds: report.rounds,
    seed: report.seed,
    myTeam: names(my),
    enemyTeam: names(enemy),
    report,
  });
  history.splice(20);
  saveHistory();
}

// ─── 阵容预设（localStorage 持久化，单队快照；见 web/presetStore.ts）───

/** 存档：list 为编号升序，`maxNo` 记编号水位（删除后不重号） */
let presetFile: PresetFile = readPresetFile();

function persistPresets(): void {
  if (!writePresetFile(presetFile)) showNotice('本机存储不可用，预设仅在本次会话内有效');
}

/**
 * 预设队内合法性（防手改存档造出重复/互斥队伍）：返回错误文案（null = 可上场）。
 * 与 `onPickHero` 同口径：同名/SP 互斥、同一武将不得重复。
 */
function presetTeamError(slots: SlotState[]): string | null {
  const seen = new Set<string>();
  const acc: SlotState[] = [];
  for (const s of slots) {
    if (!s.heroId) continue;
    const name = getHeroById(s.heroId)?.name ?? s.heroId;
    if (seen.has(s.heroId)) return `队内重复武将（${name}）`;
    seen.add(s.heroId);
    const conflict = mutualConflict(acc, s.heroId);
    if (conflict) return `队内互斥：「${conflict}」与「${name}」不能同队`;
    acc.push(s);
  }
  return null;
}

/** 保存当前某边队伍为预设（同边同名 = 覆盖，编号不变） */
function saveCurrentAsPreset(side: TeamSide, name: string): PresetActionResult {
  if (heroCount(state[side]) === 0) return { error: `${SIDE_LABEL[side]}还没有武将，先配置队伍再保存` };
  const result = addPreset(presetFile, { name, side, slots: state[side] });
  if (!result) {
    return { error: presetFile.list.length >= PRESET_MAX ? `预设已达 ${PRESET_MAX} 条上限，请先删除不用的预设` : '预设名不能为空' };
  }
  presetFile = result.file;
  persistPresets();
  const label = `#${result.preset.no}「${result.preset.name}」`;
  showNotice(result.replaced ? `已覆盖预设 ${label}（${SIDE_LABEL[side]}）` : `已保存预设 ${label}（${SIDE_LABEL[side]}）`);
  return { presetId: result.preset.id };
}

/** 预设上场：整边替换（含空槽原样）；对面若已上阵同一武将则先清空（上场方优先） */
function applyPresetToSide(preset: TeamPreset, side: TeamSide): void {
  const slots = cloneSlots(preset.slots);
  const invalid = presetTeamError(slots);
  if (invalid) {
    showNotice(`预设 #${preset.no} 无法上场：${invalid}`);
    return;
  }
  const other: TeamSide = side === 'red' ? 'blue' : 'red';
  const ids = new Set(slots.map((s) => s.heroId).filter((id): id is string => Boolean(id)));
  let cleared = 0;
  state[other].forEach((s, i) => {
    if (s.heroId && ids.has(s.heroId)) {
      state[other][i] = emptySlot();
      cleared += 1;
    }
  });
  state[side] = slots;
  refresh();
  showNotice(`已上场预设 #${preset.no}「${preset.name}」→ ${SIDE_LABEL[side]}${cleared ? `（对面 ${cleared} 个同武将槽位已清空）` : ''}`);
}

/** 用当前配将区该边配置覆盖预设（编号/名字不变） */
function overwritePresetFromCurrent(id: string, side: TeamSide): PresetActionResult {
  const preset = presetFile.list.find((p) => p.id === id);
  if (!preset) return { error: '预设不存在（可能已被删除）' };
  if (heroCount(state[side]) === 0) return { error: `${SIDE_LABEL[side]}还没有武将，无法覆盖预设` };
  presetFile = overwritePreset(presetFile, id, state[side]);
  persistPresets();
  showNotice(`已用当前${SIDE_LABEL[side]}配置覆盖预设 #${preset.no}「${preset.name}」`);
  return { presetId: id };
}

function renamePresetById(id: string, name: string): PresetActionResult {
  const preset = presetFile.list.find((p) => p.id === id);
  if (!preset) return { error: '预设不存在（可能已被删除）' };
  const bad = nameError(name, presetFile, preset.side, id);
  if (bad) return { error: bad };
  presetFile = renamePreset(presetFile, id, name);
  persistPresets();
  return { presetId: id };
}

function removePresetById(id: string): void {
  const preset = presetFile.list.find((p) => p.id === id);
  if (!preset) return;
  presetFile = removePreset(presetFile, id);
  persistPresets();
  showNotice(`已删除预设 #${preset.no}「${preset.name}」（编号不再复用）`);
}

/** 预设 → 木桩队伍（用户 2026-09-22）：设为伤害测试的敌方后直接进实验室，右栏变成该预设三将详情 */
function usePresetAsDummy(preset: TeamPreset): void {
  setDummyPreset(preset);
  showNotice(`已把预设 #${preset.no}「${preset.name}」设为木桩队伍（伤害测试敌方，实验室里可「切回侍卫」）`);
  enterLab();
}

/** 「预设」面板依赖：主站顶栏与伤害测试实验室共用。
 *  `dummyMode` = 从实验室里打开（主按钮变「设为木桩队伍」，上场按钮退成 ghost）。 */
function presetPanelDeps(opts: { dummyMode?: boolean } = {}): PresetPanelDeps {
  return {
    getPresets: () => presetFile.list,
    saveCurrent: saveCurrentAsPreset,
    apply: applyPresetToSide,
    overwrite: overwritePresetFromCurrent,
    rename: renamePresetById,
    remove: removePresetById,
    useAsDummy: usePresetAsDummy,
    dummyMode: opts.dummyMode,
  };
}

// ─── 处理 ───

const handlers: EditorHandlers = {
  onPickHero(team, idx, heroId) {
    // 同队互斥校验
    const conflict = mutualConflict(state[team], heroId);
    if (conflict) {
      showNotice(`互斥冲突：「${conflict}」与所选武将不能同队（同名/SP 武将互斥）`);
      return;
    }
    // 全局唯一：若该武将已在其他槽位，先移除原槽
    for (const t of ['red', 'blue'] as const) {
      state[t].forEach((s, i) => {
        if (s.heroId === heroId && !(t === team && i === idx)) {
          state[t][i] = emptySlot();
        }
      });
    }
    state[team][idx] = { ...emptySlot(), heroId };
    refresh();
  },
  onMoveSlot(fromTeam, fromIdx, toTeam, toIdx) {
    if (fromTeam === toTeam && fromIdx === toIdx) return;
    const from = state[fromTeam][fromIdx];
    const to = state[toTeam][toIdx];
    if (!from.heroId) return;
    // 跨队：对「即将加入该队」的武将做同名/SP 互斥（目标槽会被换走，不参与校验）
    if (fromTeam !== toTeam) {
      const destRest = state[toTeam].filter((_, i) => i !== toIdx);
      const c1 = mutualConflict(destRest, from.heroId);
      if (c1) {
        showNotice(`互斥冲突：「${c1}」与所选武将不能同队（同名/SP 武将互斥）`);
        return;
      }
      if (to.heroId) {
        const srcRest = state[fromTeam].filter((_, i) => i !== fromIdx);
        const c2 = mutualConflict(srcRest, to.heroId);
        if (c2) {
          showNotice(`互斥冲突：「${c2}」与所选武将不能同队（同名/SP 武将互斥）`);
          return;
        }
      }
    }
    state[fromTeam][fromIdx] = to;
    state[toTeam][toIdx] = from;
    refresh();
  },
  onAddSkill(team, idx, skillId) {
    const slot = state[team][idx];
    if (slot.extraSkillIds.length >= 2) {
      showNotice('每名武将最多携带 2 个装配战法（主战法不占位，共最多 3 个）');
      return;
    }
    if (slot.extraSkillIds.includes(skillId)) return;
    slot.extraSkillIds = [...slot.extraSkillIds, skillId];
    refresh();
  },
  onRemoveSkill(team, idx, skillId) {
    const slot = state[team][idx];
    slot.extraSkillIds = slot.extraSkillIds.filter((id) => id !== skillId);
    refresh();
  },
  onSetFreePoints(team, idx, key, value) {
    const slot = state[team][idx];
    if (!slot.heroId) return;
    // 自由属性总额：男性每 10 级 10 点 / 女性每 10 级 15 点（按等级）+ 红度 ×10（每红多 10 点）
    const budget = freePointBudget(slot.heroId, slot.redness, slot.level);
    const others = (Object.keys(slot.freePoints) as Array<keyof SlotState['freePoints']>)
      .filter((k) => k !== key)
      .reduce((a, k) => a + slot.freePoints[k], 0);
    slot.freePoints[key] = Math.max(0, Math.min(budget - others, Math.floor(value) || 0));
    refresh();
  },
  onSetRedness(team, idx, redness) {
    state[team][idx].redness = Math.max(0, Math.min(5, redness));
    refresh();
  },
  onSetSecondaryTroop(team, idx, troop) {
    const slot = state[team][idx];
    if (!slot.heroId) return;
    // 只允许该武将的两个转换方向；切换兵种会清空已学通用特性（学习状态与兵种绑定）
    const allowed = HERO_SECONDARY_TROOPS[slot.heroId] ?? [];
    if (troop && !allowed.includes(troop)) return;
    slot.secondaryTroop = troop;
    slot.secondaryTraits = troop ? [] : undefined;
    refresh();
  },
  onSetSecondaryTrait(team, idx, slotIdx, trait) {
    const slot = state[team][idx];
    if (!slot.heroId || !slot.secondaryTroop) return;
    const pool = traitsFor(slot.secondaryTroop);
    if (trait && !pool.includes(trait)) return;
    const learned = [...(slot.secondaryTraits ?? [])];
    // 同一兵种不可学 2 个相同特性（官方 Q&A 第 4 条）
    if (trait && learned.includes(trait)) return;
    if (trait) learned[slotIdx] = trait;
    else learned.splice(slotIdx, 1);
    slot.secondaryTraits = learned.filter(Boolean).slice(0, TRAIT_SLOTS_MAX);
    refresh();
  },
  onSetTreasure(team, idx, treasure) {
    const slot = state[team][idx];
    if (!slot.heroId) return;
    // 就地改（与 onSetLevel/onSetRedness 同口径）：武将详情弹窗持有同一个 slot 引用，改完 redraw 才能看到
    slot.treasure = treasure;
    refresh();
  },
  onSetLevel(team, idx, level) {
    const slot = state[team][idx];
    if (!slot.heroId) return;
    slot.level = Math.max(40, Math.min(50, Math.round(level) || 40));
    // 等级下调时自由属性预算收缩：超出部分从攻击→防御→谋略→速度依次扣减
    const budget = freePointBudget(slot.heroId, slot.redness, slot.level);
    let used = (Object.keys(slot.freePoints) as Array<keyof SlotState['freePoints']>).reduce((a, k) => a + slot.freePoints[k], 0);
    for (const k of ['attack', 'defense', 'strategy', 'speed'] as const) {
      if (used <= budget) break;
      const cut = Math.min(slot.freePoints[k], used - budget);
      slot.freePoints[k] -= cut;
      used -= cut;
    }
    refresh();
  },
  onSavePreset(team) {
    const side: TeamSide = team;
    if (heroCount(state[side]) === 0) {
      showNotice(`${SIDE_LABEL[side]}还没有武将，先配置队伍再保存预设`);
      return;
    }
    openPresetNameDialog({
      title: `保存预设 · ${SIDE_LABEL[side]}`,
      hint: `把当前${SIDE_LABEL[side]}的三将配置（战法 / 兵种转换 / 宝物 / 属性加点）存为预设，下次一键上场`,
      placeholder: '如：双减魏智',
      onSubmit: (name) => saveCurrentAsPreset(side, name).error ?? null,
    });
  },
  onRemoveHero(team, idx) {
    state[team][idx] = emptySlot();
    refresh();
  },
  onClearTeam(team) {
    state[team] = [emptySlot(), emptySlot(), emptySlot()];
    refresh();
  },
};

// 触屏拖拽（长按武将卡拖动到槽位；HTML5 drag 在触屏不可用，仅触屏设备生效）
setupTouchDrag(handlers);

// 安卓返回键 / 返回手势（仅原生壳生效）：最上层覆盖层 → 实验室 → 战报页 → 都没有才退出应用。
// 这些面板是 DOM 覆盖层而不是真页面，不接管的话在"页面"里按返回会直接退到桌面。
setupBackButton({
  isLabOpen: () => labVisible,
  closeLab: () => exitLab(),
  isReportOpen: () => app.classList.contains('report-open'),
  closeReport: () => closeReportView(),
});

// ─── 渲染 ───

function refresh(): void {
  renderTeamEditor(editorRoot, state, handlers);
}

/** 站位顺序：红队（我方）与蓝队（敌方）都从上到下 大营/中军/前锋 */
const RED_POSITIONS: General['position'][] = ['大营', '中军', '前锋'];
const BLUE_POSITIONS: General['position'][] = ['大营', '中军', '前锋'];

function collectTeam(team: 'red' | 'blue'): General[] {
  const positions = team === 'red' ? RED_POSITIONS : BLUE_POSITIONS;
  const morale = team === 'red' ? redMorale : blueMorale;
  return state[team]
    .map((s, i) =>
      s.heroId
        ? buildGeneral(s.heroId!, s.extraSkillIds, s.freePoints, positions[i], s.redness, s.level, morale, s.secondaryTroop, s.secondaryTraits, s.treasure)
        : null
    )
    .filter((g): g is General => g !== null);
}

function startBattle(): void {
  errBox.textContent = '';
  // 每次模拟由系统内部自动生成全新随机种子（用户不可调整）
  seed = Math.floor(Math.random() * 1000000);
  const seedInfo = document.getElementById('seed-info');
  if (seedInfo) seedInfo.textContent = String(seed);
  const my = collectTeam('red');
  const enemy = collectTeam('blue');
  if (my.length === 0 || enemy.length === 0) {
    errBox.textContent = '红蓝两队都至少需要 1 名武将';
    return;
  }
  try {
    const report = runBattle({ myTeam: my, enemyTeam: enemy, seed, maxRounds: MAX_ROUNDS });
    recordBattle(report, my, enemy);
    // 战报容器须挂载在页面上（返回配将后容器被隐藏，不 remove 以免脱离 DOM）
    if (!battleRoot.isConnected) {
      const host = app.querySelector('main') ?? app;
      host.appendChild(battleRoot);
    }
    battleRoot.style.display = '';
    // 隐藏编辑区，展示战报（默认简略；底栏切换 统计 / 详情）
    editorRoot.style.display = 'none';
    errBox.textContent = '';
    renderBattleView(report, 'summary');
  } catch (e) {
    errBox.textContent = `模拟失败：${(e as Error).message}`;
  }
}

/** 关闭战报页：去掉 report-open、恢复配将区、清空战报 DOM */
function closeReportView(): void {
  app.classList.remove('report-open');
  editorRoot.style.display = '';
  battleRoot.style.display = 'none';
  battleRoot.innerHTML = '';
}

/**
 * 战报视图渲染：summary=简略 / stats=统计 / detail=逐回合详情。
 * 页签在底栏 `.report-dock`，无顶部 `.report-nav`；给 `#app` 加 `report-open` 隐藏品牌顶栏与配将底栏。
 */
function renderBattleView(report: BattleReport, mode: 'summary' | 'stats' | 'detail'): void {
  battleRoot.innerHTML = '';
  app.classList.add('report-open');

  const view = document.createElement('div');
  view.className = 'report-view';

  const body = document.createElement('div');
  body.className = 'report-body';
  if (mode === 'summary') {
    body.appendChild(createBattleSummary(report));
  } else if (mode === 'stats') {
    body.appendChild(createStatsView(report));
  } else {
    body.appendChild(createBattleView(report).el);
  }
  view.appendChild(body);

  const dock = document.createElement('footer');
  dock.className = 'report-dock';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn ghost btn-back';
  back.textContent = '← 返回配将';
  back.onclick = () => closeReportView();
  dock.appendChild(back);

  const tabs = document.createElement('nav');
  tabs.className = 'report-tabs';
  tabs.setAttribute('aria-label', '战报视图');
  const modes: Array<['summary' | 'stats' | 'detail', string]> = [
    ['summary', '简略'],
    ['stats', '统计'],
    ['detail', '详情'],
  ];
  for (const [m, label] of modes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost' + (m === mode ? ' on' : '');
    b.dataset.mode = m;
    b.textContent = label;
    b.onclick = () => renderBattleView(report, m);
    tabs.appendChild(b);
  }
  dock.appendChild(tabs);

  const reuse = document.createElement('button');
  reuse.type = 'button';
  reuse.className = 'btn ghost';
  reuse.textContent = '复用队伍';
  reuse.onclick = () => reuseTeamFromReport(report);
  dock.appendChild(reuse);

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn primary';
  again.textContent = '再打一场';
  again.onclick = () => {
    battleRoot.innerHTML = '';
    startBattle();
  };
  dock.appendChild(again);

  view.appendChild(dock);
  battleRoot.appendChild(view);
}

/** 战报 → SlotState 反推（与 buildGeneral 互逆）：面板 = round(基础 + (L-1)×成长) + 自由加点；
 *  等级/红度随战报透传还原；自由加点按该等级反推（面板精确还原）。 */
function generalToSlot(g: General): SlotState {
  const h = getHeroById(g.id);
  const level = g.level ?? 40;
  const redness = g.redness ?? 0;
  const mainId = h?.mainSkillId ?? '';
  const extra: string[] = [];
  for (const id of [...g.activeSkillIds, ...g.passiveSkillIds, ...g.commandSkillIds, ...g.pursuitSkillIds]) {
    if (id !== mainId && !extra.includes(id)) extra.push(id);
  }
  const free: SlotState['freePoints'] = { attack: 0, defense: 0, strategy: 0, speed: 0 };
  if (h) {
    free.attack = Math.max(0, g.attack - Math.round(h.baseAttack + (level - 1) * h.growthAttack));
    free.defense = Math.max(0, g.defense - Math.round(h.baseDefense + (level - 1) * h.growthDefense));
    free.strategy = Math.max(0, g.strategy - Math.round(h.baseStrategy + (level - 1) * h.growthStrategy));
    free.speed = Math.max(0, g.speed - Math.round(h.baseSpeed + (level - 1) * h.growthSpeed));
  }
  return { heroId: g.id, extraSkillIds: extra.slice(0, 2), freePoints: free, redness, level, treasure: g.treasure ?? null };
}

/** 复用战报队伍：把红/蓝双方（大营→中军→前锋）复制到配将区，返回配将界面 */
function reuseTeamFromReport(report: BattleReport): void {
  const toSlots = (team: General[]): SlotState[] =>
    RED_POSITIONS.map((p) => {
      const g = team.find((x) => x.position === p);
      return g ? generalToSlot(g) : emptySlot();
    });
  state.red = toSlots(report.myTeam);
  state.blue = toSlots(report.enemyTeam);
  refresh();
  closeReportView();
}

/** 应用入口：挂载到 #app（浏览器自动调用；测试可手动调用） */
export function initApp(root?: HTMLElement): void {
  // 重置配将状态（支持重复初始化/测试隔离）
  Object.assign(state, emptyEditor());
  presetFile = readPresetFile();
  redMorale = 120;
  blueMorale = 120;
  seed = Math.floor(Math.random() * 1000000);
  // 重复初始化时旧的 #app 已被丢弃 → 实验室根节点引用必须一起作废，
  // 否则下次 enterLab 会往已脱离文档的旧节点上挂载（界面空白、DOM 查不到）
  labRoot = null;
  labVisible = false;
  app = root ?? document.getElementById('app')!;
  app.innerHTML = '';
  app.className = 'app-shell';

  // ── 顶栏 ──
  // 品牌标题（率土之滨 · 战斗模拟器）已按要求删除：率 logo 已足够表明身份，
  // 腾出来的横向空间放武将池搜索框（见 #pool-search-slot）。
  const header = document.createElement('header');
  header.className = 'app';
  header.innerHTML = `
    <img class="rate-logo" src="${asset('/rate-logo.png')}" alt="率" title="率土之滨" />
    <div class="pool-search" id="pool-search-slot"></div>
    <nav class="app-nav" aria-label="功能">
      <button type="button" class="nav-link" data-nav="history">战报</button>
      <button type="button" class="nav-link" data-nav="presets" title="阵容预设：保存、搜索、一键上场">预设</button>
      <button type="button" class="nav-link" data-nav="skills">战法</button>
      <button type="button" class="nav-link" data-nav="lab">伤害测试</button>
      <button type="button" class="nav-link" data-nav="tutorial">教程</button>
    </nav>
  `;
  app.appendChild(header);

  // ── 中间内容区 ──
  const main = document.createElement('main');
  app.appendChild(main);

  editorRoot = document.createElement('div');
  main.appendChild(editorRoot);
  refresh();

  main.appendChild(errBox);
  main.appendChild(battleRoot);
  battleRoot.style.display = 'none';

  // ── 底栏：参数 + 开始模拟（右下角）──
  controlBar = document.createElement('footer');
  controlBar.className = 'control-bar';
  controlBar.innerHTML = `
    <label title="随机种子由系统自动生成，每次点击「开始模拟」都会更换">随机种子 <span class="fixed" id="seed-info">自动</span></label>
    <label title="最大回合固定为 8，不可调整">最大回合 <span class="fixed">8（固定）</span></label>
    <label>我方士气 <input type="number" id="morale-red" value="${redMorale}" min="80" max="140" title="影响战法发动率：120 → 系数 1.12" /></label>
    <label>敌方士气 <input type="number" id="morale-blue" value="${blueMorale}" min="80" max="140" title="影响战法发动率：120 → 系数 1.12" /></label>
    <span class="build-tag" title="构建标记：与 android/app/build.gradle 的 versionName 同步，用来确认装的是哪一版">${BUILD_TAG}</span>
    <span class="spacer"></span>
    <button id="start" class="btn">开始模拟</button>
  `;
  app.appendChild(controlBar);

  (controlBar.querySelector('#morale-red') as HTMLInputElement).addEventListener('change', (e) => {
    redMorale = Math.max(80, Math.min(140, Math.round(Number((e.target as HTMLInputElement).value) || 120)));
    (e.target as HTMLInputElement).value = String(redMorale);
  });
  (controlBar.querySelector('#morale-blue') as HTMLInputElement).addEventListener('change', (e) => {
    blueMorale = Math.max(80, Math.min(140, Math.round(Number((e.target as HTMLInputElement).value) || 120)));
    (e.target as HTMLInputElement).value = String(blueMorale);
  });
  (controlBar.querySelector('#start') as HTMLButtonElement).addEventListener('click', startBattle);

  header.querySelector('[data-nav="history"]')!.addEventListener('click', () => {
    openHistoryPanel(history, () => saveHistory(), reuseTeamFromReport);
  });
  header.querySelector('[data-nav="skills"]')!.addEventListener('click', () => openSkillBag());
  header.querySelector('[data-nav="presets"]')!.addEventListener('click', () => {
    openPresetPanel(presetPanelDeps());
  });
  header.querySelector('[data-nav="lab"]')!.addEventListener('click', () => {
    labVisible ? exitLab() : enterLab();
  });
  // 引擎使用指南（带截图的教程弹窗）
  header.querySelector('[data-nav="tutorial"]')!.addEventListener('click', () => openTutorialPanel());
}

// ─── 伤害测试实验室视图（顶栏「伤害测试」导航切换）───

let labRoot: HTMLElement | null = null;
let labVisible = false;
let battleWasVisible = false;

function enterLab(): void {
  if (!labRoot) {
    labRoot = document.createElement('div');
    const host = app.querySelector('main') ?? app;
    host.appendChild(labRoot);
  }
  battleWasVisible = battleRoot.style.display !== 'none';
  battleRoot.style.display = 'none';
  editorRoot.style.display = 'none';
  controlBar.style.display = 'none';
  // 每次进入重新挂载：编辑器/木桩面板按当前 state 重建（guard 配置与已选木桩队伍保留在模块内）
  mountDamageLab(labRoot, {
    state,
    handlers,
    onExit: exitLab,
    // 实验室右栏「选木桩队伍」：复用「预设」面板（木桩模式 = 主按钮变「设为木桩队伍」）
    onPickDummy: () => openPresetPanel(presetPanelDeps({ dummyMode: true })),
  });
  labRoot.style.display = '';
  labVisible = true;
  // 顶栏导航在实验室态变成「返回配将」（用户 2026-09-19：实验室内那行返回按钮已删，返回入口收到顶栏）
  const nav = app.querySelector<HTMLButtonElement>('[data-nav="lab"]');
  if (nav) nav.textContent = '返回配将';
}

function exitLab(): void {
  labRoot!.style.display = 'none';
  editorRoot.style.display = '';
  controlBar.style.display = '';
  if (battleWasVisible) battleRoot.style.display = '';
  labVisible = false;
  const nav = app.querySelector<HTMLButtonElement>('[data-nav="lab"]');
  if (nav) nav.textContent = '伤害测试';
  // 实验室的武将池把顶栏 .toolbar（搜索框 + 筛选）搬进了 #pool-search-slot，这里重渲染配将区，
  // 让主站的 toolbar 搬回顶栏 —— 否则回首页后顶栏搜索框还连着实验室那个已隐藏的池子
  refresh();
}

if (typeof document !== 'undefined') {
  const el = document.getElementById('app');
  if (el) initApp(el);
}

// PWA：仅生产构建注册 Service Worker（离线缓存 + 安卓可安装为独立全屏应用）
if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 注册失败（隐私模式等）不影响使用 */
    });
  });
}
