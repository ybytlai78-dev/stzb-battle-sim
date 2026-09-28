/**
 * 队伍配置面板（L2 回合模型 / L3 优化器共用）
 * ---------------------------------------------------------------------------
 * 抽出原因：两个独立页（round-model.html / optimizer.html）都需要「三将 + 等级 + 加点 + 兵种 + 战法槽 + 目标/环境」这套输入。
 * 面板只负责编辑 `ViewCfg`；发什么战法、算什么，由调用方决定。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { getTreasure } from '../src/data/treasures';
import type { TreasureLoadout, TroopType } from '../src/engine/types';
import type { GeneralTrait } from '../src/engine/secondaryTroop';
import { baseStatsAt, freePointBudget, HERO_RECORDS, isFemale, isLearnableSkillListed, isMainSkill, SLOTTED_HEROES, SKILL_GRADES, TROOP_CHAR, troopCapacity } from './heroes';
import type { HeroJson } from './heroes';
import pinyinJson from './data/pinyin.json';
import { simulateRounds, skillById, SLOT_LABEL, type ParseContext, type RoundModelResult, type RoundUnit, type SkillSlot } from './roundModel';

export const TROOP_OPTIONS: Array<[TroopType, string]> = [
  ['cavalry', '骑兵'],
  ['infantry', '步兵'],
  ['archer', '弓兵'],
];

/** 宝物展示名：`游飘（颖悟 10）· Lv10`（截图识别写入的宝物在槽位卡上可见） */
function treasureLabel(t: TreasureLoadout): string {
  const name = getTreasure(t.treasureId)?.name ?? `#${t.treasureId}`;
  const affix = t.affix ? `（${t.affix.name} ${t.affix.value}）` : '';
  return `${name}${affix} · Lv${t.level ?? 10}`;
}

export interface SlotCfg {
  heroId: string;
  level: number;
  addAttack: number;
  addStrategy: number;
  troopType: TroopType;
  skillIds: string[];
  /** 兵系通用特性（截图识别写入；缺省 = 没学） */
  traits?: GeneralTrait[];
  /** 佩戴宝物（截图识别写入；缺省 = 没佩戴） */
  treasure?: TreasureLoadout | null;
}

export interface ViewCfg {
  slots: SlotCfg[];
  morale: number;
  enemy: { defense: number; strategy: number; troopType: TroopType; /** 敌方士气（士气分支判定；缺省 = 我方士气） */ morale?: number };
  rounds: number;
  manual: { boostCaused: number; boostTaken: number; reduce: number };
}

/** 拼音检索表（`scripts/gen_pinyin.mjs` 生成）：i = 首字母串，f = 全拼（ü 统一记作 v）。
 *  与主站武将池搜索（`teamEditor.ts`）用同一份数据，口径一致。 */
const PINYIN = pinyinJson as Record<string, { i: string; f: string }>;

/** 武将候选的搜索匹配串：名字 / 势力 / 兵种 / 标签（SP 等）/ id / 拼音首字母 + 全拼 */
function heroMatchText(h: HeroJson): string {
  const py = PINYIN[h.id];
  return [h.name, h.faction, TROOP_CHAR[h.troopType] ?? '', h.tags.join(' '), h.id, py?.i ?? '', py?.f ?? '']
    .join(' ')
    .toLowerCase();
}

export const HERO_OPTIONS = SLOTTED_HEROES.map((h) => ({
  id: h.id,
  label: `${h.name}（${h.faction}·${TROOP_CHAR[h.troopType] ?? ''}）`,
  /** 搜索用匹配串（见 `heroMatchText`） */
  match: heroMatchText(h),
}));
const HERO_OPTIONS_HTML = HERO_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');

export interface SkillOption {
  id: string;
  label: string;
  slot: SkillSlot;
  /** 搜索用匹配串：名称 / id / 出手位 / 品级 */
  match: string;
}

const SLOT_ORDER: SkillSlot[] = ['active', 'prepared', 'pursuit', 'command-prep', 'command-round', 'passive'];

/** 可学习战法池：注册表里排除「武将主战法」（主战法不能被别的武将学；拆解后的是另一条可学习战法） */
export const LEARNABLE_SKILL_IDS: string[] = Object.keys(SKILL_REGISTRY).filter((id) => !isMainSkill(id));

/** 可携带战法（只列「可学习战法」= 排除主战法），带出手位标注；按出手位分组排序 */
export const SKILL_OPTIONS: SkillOption[] = LEARNABLE_SKILL_IDS
  .map((id) => {
    const parsed = skillById(id, 100);
    const offline = !isLearnableSkillListed(id);
    return parsed
      ? {
          id,
          label: `${SLOT_LABEL[parsed.slot]}·${SKILL_REGISTRY[id].name}（${SKILL_GRADES[id] ?? '?'}${offline ? '·待补成长率' : ''}）`,
          slot: parsed.slot,
          match: `${SKILL_REGISTRY[id].name} ${id} ${SLOT_LABEL[parsed.slot]} ${SKILL_GRADES[id] ?? ''}${
            offline ? ' 待补成长率' : ''
          }`.toLowerCase(),
        }
      : undefined;
  })
  .filter((v): v is SkillOption => Boolean(v))
  .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.label.localeCompare(b.label, 'zh'));
const SKILL_OPTIONS_HTML = SKILL_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');

/* ──────────────────── 候选搜索（武将 / 战法选取共用同一套行为） ────────────────────
 * 候选太长：武将 158、可学战法 240+，靠滚动找一条很费劲（用户 2026-09-28 反馈）。
 * 做法：给每个选取 select 配一个搜索框，**只重建该 select 的 `<option>` 列表**：
 *   · 不碰选中值 —— 已选项与「（空槽）」始终留在列表里，`select.value` 全程不变；
 *   · 不发 `change`、不重渲染、不回调 onChange —— 选取逻辑与加搜索前一字不差；
 *   · 武将框与战法框走同一个函数（空白分词 AND、大小写不敏感），两个下拉框行为一致。
 */
type PickKind = 'hero' | 'skill';

interface PickOption {
  value: string;
  label: string;
  /** 搜索匹配串（小写）：名称 / id / 拼音 … 命中任一关键词即可 */
  match: string;
}

/** 每个候选的匹配串（按 value 查；空槽项等查不到的回退到显示文本） */
const PICK_MATCH: Record<PickKind, Map<string, string>> = {
  hero: new Map(HERO_OPTIONS.map((o) => [o.id, o.match])),
  skill: new Map(SKILL_OPTIONS.map((o) => [o.id, o.match])),
};

/**
 * 搜索词状态：按「面板根节点 + cfg 身份」隔离。
 *  - 同一个 cfg 重渲染（改等级 / 换将 / 换兵种都会重建面板）→ 搜索词保持，不用重打；
 *  - 换 cfg（L4 battle-sim 切对手是换一个 cfg 对象）→ 视为新面板，搜索词清零。
 */
const pickSearchState = new WeakMap<HTMLElement, { cfg: ViewCfg; queries: Map<string, string> }>();

/** select 的完整候选（懒取一次：过滤永远从全量出发，不会层层收窄） */
const pickOptionCache = new WeakMap<HTMLSelectElement, PickOption[]>();

/** 关键词 → 分词（空白分隔；全部命中才算匹配；大小写不敏感） */
function pickTokens(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 完整候选列表（首次调用时从 DOM 取，此后以缓存为准） */
function pickFullOptions(sel: HTMLSelectElement, kind: PickKind): PickOption[] {
  let list = pickOptionCache.get(sel);
  if (!list) {
    const byValue = PICK_MATCH[kind];
    list = Array.from(sel.options).map((o) => {
      const label = o.textContent ?? '';
      return { value: o.value, label, match: byValue.get(o.value) ?? label.toLowerCase() };
    });
    pickOptionCache.set(sel, list);
  }
  return list;
}

/** 把搜索词作用到候选列表（只重建 `<option>`；返回命中候选数） */
function applyPickQuery(sel: HTMLSelectElement, kind: PickKind, query: string): number {
  const all = pickFullOptions(sel, kind);
  const tokens = pickTokens(query);
  const selected = sel.value;
  const hit = (o: PickOption): boolean => tokens.every((t) => o.match.includes(t));
  const matches = tokens.length ? all.filter(hit) : all;
  // 空槽项（清空槽位）与已选项始终保留：搜索绝不改变已选值
  const shown = tokens.length ? all.filter((o) => hit(o) || o.value === '' || o.value === selected) : all;
  if (tokens.length || sel.options.length !== shown.length) {
    const frag = document.createDocumentFragment();
    for (const o of shown) {
      const node = document.createElement('option');
      node.value = o.value;
      node.textContent = o.label;
      if (o.value === selected) node.selected = true;
      frag.appendChild(node);
    }
    sel.replaceChildren(frag);
  }
  return matches.length;
}

/** 可搜索选取框 HTML：搜索行 + 原 select（select 自身的 data 属性由调用方给） */
function pickHtml(
  key: string,
  placeholder: string,
  selectHtml: string,
  opts: { disabled?: boolean; cls?: string } = {}
): string {
  return `<div class="rm-pick${opts.cls ? ` ${opts.cls}` : ''}">
    <div class="rm-pick-bar">
      <input class="rm-pick-input" type="search" data-pick-input="${key}" placeholder="${placeholder}"
        autocomplete="off" spellcheck="false"${opts.disabled ? ' disabled' : ''} />
      <span class="rm-pick-hint" data-pick-hint="${key}"></span>
    </div>
    ${selectHtml}
  </div>`;
}

/** 渲染后绑定面板内全部搜索框（只改候选 DOM：不动 cfg、不发 change、不重渲染） */
function bindPickSearches(root: HTMLElement, cfg: ViewCfg): void {
  let st = pickSearchState.get(root);
  if (!st || st.cfg !== cfg) {
    st = { cfg, queries: new Map() };
    pickSearchState.set(root, st);
  }
  const queries = st.queries;
  root.querySelectorAll<HTMLInputElement>('[data-pick-input]').forEach((input) => {
    const key = input.dataset.pickInput ?? '';
    const kind = key.slice(0, key.indexOf(':')) as PickKind;
    const sel = root.querySelector<HTMLSelectElement>(`[data-pick-select="${key}"]`);
    const hint = root.querySelector<HTMLElement>(`[data-pick-hint="${key}"]`);
    if (!sel || (kind !== 'hero' && kind !== 'skill')) return;
    const apply = (): void => {
      const q = input.value;
      const active = pickTokens(q).length > 0;
      if (active) queries.set(key, q);
      else queries.delete(key);
      const matches = applyPickQuery(sel, kind, q);
      if (!hint) return;
      hint.textContent = !active ? '' : matches ? `${matches} 项匹配` : '无匹配';
      hint.classList.toggle('no-hit', active && matches === 0);
    };
    input.addEventListener('input', apply);
    input.addEventListener('search', apply); // 原生 × 清空只发 search、不发 input
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !input.value) return;
      input.value = ''; // 只清搜索词，不动选中值
      apply();
    });
    const kept = queries.get(key); // 面板重建后恢复上次的搜索词
    if (kept) {
      input.value = kept;
      apply();
    }
  });
}

/** 每将可携带的额外战法槽数（率土：主战法 + 2 个可学战法；与 teamEditor 的 `canAdd < 2` 一致） */
export const SKILL_SLOTS = 2;

/** 默认配置：输出将 + 两名支援（可传自定义 heroIds） */
export function defaultCfg(heroIds: string[] = ['h3', 'h5', 'h16']): ViewCfg {
  const slots: SlotCfg[] = heroIds.map((heroId) => {
    const rec = HERO_RECORDS[heroId];
    return {
      heroId,
      level: 40,
      addAttack: 0,
      addStrategy: 0,
      troopType: (rec?.troopType ?? 'infantry') as TroopType,
      skillIds: [],
    };
  });
  return {
    slots,
    morale: 120,
    enemy: { defense: 150, strategy: 100, troopType: 'infantry' },
    rounds: 8,
    manual: { boostCaused: 0, boostTaken: 0, reduce: 0 },
  };
}

export interface UnitTemplate {
  id: string;
  name: string;
  heroId: string;
  attack: number;
  strategy: number;
  defense: number;
  speed: number;
  troops: number;
  troopType: TroopType;
  /** 阵营 / 性别（典藏【追加】段与队伍构成门槛用） */
  faction: string;
  gender: 'male' | 'female';
  /** 站位：0=大营 1=中军 2=前锋（沿用主站 POS 顺序） */
  position: '大营' | '中军' | '前锋';
  /** 固定携带（主战法） */
  mainSkillId?: string;
}

/** 单位基础模板（不含可变战法槽） */
export function unitTemplates(cfg: ViewCfg): UnitTemplate[] {
  return cfg.slots.map((s, i) => {
    const rec = HERO_RECORDS[s.heroId];
    const base = rec ? baseStatsAt(rec, s.level) : { attack: 100, defense: 100, strategy: 100, speed: 50 };
    return {
      id: `u${i}`,
      name: rec?.name ?? s.heroId,
      heroId: s.heroId,
      attack: base.attack + s.addAttack,
      strategy: base.strategy + s.addStrategy,
      defense: base.defense,
      speed: base.speed,
      troops: troopCapacity(s.level, 0),
      troopType: s.troopType,
      faction: rec?.faction ?? '群',
      gender: isFemale(s.heroId) ? 'female' : 'male',
      position: (['大营', '中军', '前锋'] as const)[i] ?? '中军',
      mainSkillId: rec?.mainSkillId,
    };
  });
}

/**
 * 第 unitIdx 个单位的解析上下文（施法者自身 + 我方三人构成）——
 * 典藏【追加】段 / 队伍兵种·阵营·性别门槛 / 士气分支都要用它。
 */
export function unitParseContext(cfg: ViewCfg, unitIdx: number): ParseContext {
  const ts = unitTemplates(cfg);
  const self = ts[unitIdx];
  return {
    casterName: self?.name,
    casterFaction: self?.faction,
    casterPosition: self?.position,
    teamFactions: ts.map((t) => t.faction),
    teamTroops: ts.map((t) => t.troopType),
    teamGenders: ts.map((t) => t.gender),
    enemyMorale: cfg.enemy.morale ?? cfg.morale,
  };
}

export function buildUnits(cfg: ViewCfg): RoundUnit[] {
  return unitTemplates(cfg).map((t, i) => ({
    id: t.id,
    name: t.name,
    heroId: t.heroId,
    attack: t.attack,
    strategy: t.strategy,
    defense: t.defense,
    speed: t.speed,
    troops: t.troops,
    troopType: t.troopType,
    skills: [t.mainSkillId, ...cfg.slots[i].skillIds]
      .filter((v): v is string => Boolean(v))
      .map((id) => skillById(id, cfg.morale, unitParseContext(cfg, i)))
      .filter((v): v is NonNullable<typeof v> => Boolean(v)),
  }));
}

export function computeResult(cfg: ViewCfg, rounds?: number): RoundModelResult {
  return simulateRounds({
    units: buildUnits(cfg),
    enemy: cfg.enemy,
    morale: cfg.morale,
    rounds: rounds ?? cfg.rounds,
    manual: cfg.manual,
  });
}

export interface ConfigPanelOpts {
  /** 配置变化后回调（面板已重渲染完毕） */
  onChange?: () => void;
  /** 面板底部按钮区（HTML；按钮自身在 bindFooter 里绑定事件） */
  footerHtml?: string;
  bindFooter?: (el: HTMLElement, rerender: () => void) => void;
  /** 单位标题右侧的附加标签（如「输出将」） */
  unitBadge?: (index: number) => string;
  /** 禁用某些单位的编辑（返回 true 表示该单位只读） */
  unitLocked?: (index: number) => boolean;
}

/** 渲染配置面板（内部自带重渲染：任何改动 → 重渲染 + onChange） */
export function renderConfigPanel(el: HTMLElement, cfg: ViewCfg, opts: ConfigPanelOpts = {}): void {
  /** 同队唯一性提示（率土规则：武将与战法在一支队伍里都不能重复） */
  const duplicates = (): string[] => {
    const out: string[] = [];
    const heroIds = cfg.slots.map((s) => s.heroId).filter(Boolean);
    const dupHeroes = heroIds.filter((id, i) => heroIds.indexOf(id) !== i);
    if (dupHeroes.length) out.push(`武将重复上阵：${[...new Set(dupHeroes)].map((id) => HERO_RECORDS[id]?.name ?? id).join('、')}`);
    const skills = cfg.slots.flatMap((s) =>
      [HERO_RECORDS[s.heroId]?.mainSkillId, ...s.skillIds].filter((v): v is string => Boolean(v))
    );
    const dupSkills = skills.filter((id, i) => skills.indexOf(id) !== i);
    if (dupSkills.length)
      out.push(`战法同队重复携带：${[...new Set(dupSkills)].map((id) => SKILL_REGISTRY[id]?.name ?? id).join('、')}`);
    return out;
  };

  const rerender = (): void => {
    renderConfigPanel(el, cfg, opts);
    opts.onChange?.();
  };

  el.innerHTML = `
    <div class="rm-group">
      <div class="rm-group-title">我方队伍</div>
      ${cfg.slots
        .map((s, i) => {
          const rec = HERO_RECORDS[s.heroId];
          const budget = freePointBudget(s.heroId, 0, s.level);
          const locked = opts.unitLocked?.(i) ?? false;
          return `
        <div class="rm-unit" data-unit="${i}">
          <div class="rm-unit-head">
            ${pickHtml(
              `hero:${i}`,
              '搜索武将：名 / 拼音 / 势力',
              `<select data-unit-hero="${i}" data-pick-select="hero:${i}" ${locked ? 'disabled' : ''}>${HERO_OPTIONS_HTML}</select>`,
              { disabled: locked }
            )}
            <button class="rm-del" type="button" data-unit-reset="${i}" title="清空该将战法与加点">↺</button>
          </div>
          ${opts.unitBadge?.(i) ? `<div class="rm-badge">${opts.unitBadge(i)}</div>` : ''}
          <div class="rm-unit-row">
            <label>等级<input type="number" min="40" max="50" step="1" value="${s.level}" data-unit-level="${i}" /></label>
            <label>兵种<select data-unit-troop="${i}">
              ${TROOP_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
            </select></label>
          </div>
          <div class="rm-unit-row">
            <label>加点·攻<input type="number" min="0" max="${budget}" step="5" value="${s.addAttack}" data-unit-atk="${i}" /></label>
            <label>加点·谋<input type="number" min="0" max="${budget}" step="5" value="${s.addStrategy}" data-unit-str="${i}" /></label>
          </div>
          <div class="rm-points">加点预算 ${budget}（已用 ${s.addAttack + s.addStrategy}）· 主战法 ${rec?.mainSkillName ?? '无'}</div>
        ${
          s.traits?.length || s.treasure
            ? `<div class="rm-points">${
                s.traits?.length ? `兵系特性 ${s.traits.join(' / ')}` : ''
              }${
                s.treasure
                  ? `${s.traits?.length ? ' · ' : ''}宝物 ${treasureLabel(s.treasure)}`
                  : ''
              }</div>`
            : ''
        }
          ${Array.from({ length: SKILL_SLOTS }, (_, k) => k)
            .map((k) =>
              pickHtml(
                `skill:${i}-${k}`,
                `搜索战法 ${k + 1}：名 / 出手位`,
                `<select class="rm-skill" data-unit-skill="${i}-${k}" data-pick-select="skill:${i}-${k}">
                <option value="">（空槽 ${k + 1}）</option>
                ${SKILL_OPTIONS_HTML}
              </select>`,
                { cls: 'rm-pick-skill' }
              )
            )
            .join('')}
        </div>`;
        })
        .join('')}
      ${duplicates().length ? `<div class="rm-warn-inline">⚠ ${duplicates().join('；')}（游戏内一支队伍不能重复使用同一武将 / 同一战法）</div>` : ''}
    </div>
    <div class="rm-group">
      <div class="rm-group-title">目标 / 环境</div>
      <div class="rm-unit-row">
        <label>目标防御<input type="number" min="0" max="800" step="10" value="${cfg.enemy.defense}" data-enemy="defense" /></label>
        <label>目标谋略<input type="number" min="0" max="800" step="10" value="${cfg.enemy.strategy}" data-enemy="strategy" /></label>
      </div>
      <div class="rm-unit-row">
        <label>目标兵种<select data-enemy="troopType">
          ${TROOP_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
        </select></label>
        <label>士气<input type="number" min="80" max="140" step="1" value="${cfg.morale}" data-global="morale" /></label>
      </div>
      <div class="rm-unit-row">
        <label>回合数<input type="number" min="3" max="8" step="1" value="${cfg.rounds}" data-global="rounds" /></label>
        <label>手填增伤%<input type="number" step="5" value="${Math.round(cfg.manual.boostCaused * 100)}" data-manual="boostCaused" /></label>
      </div>
      <div class="rm-unit-row">
        <label>手填减伤%<input type="number" step="5" value="${Math.round(cfg.manual.reduce * 100)}" data-manual="reduce" /></label>
        <label>敌方受到增伤%<input type="number" step="5" value="${Math.round(cfg.manual.boostTaken * 100)}" data-manual="boostTaken" /></label>
      </div>
    </div>
    ${opts.footerHtml ?? ''}
  `;

  // 回填下拉选中值（option 列表是共享字符串，选中态在渲染后设置，避免每次拼接 3000+ 选项）
  cfg.slots.forEach((s, i) => {
    const heroSel = el.querySelector<HTMLSelectElement>(`[data-unit-hero="${i}"]`);
    if (heroSel) heroSel.value = s.heroId;
    const troopSel = el.querySelector<HTMLSelectElement>(`[data-unit-troop="${i}"]`);
    if (troopSel) troopSel.value = s.troopType;
    for (let k = 0; k < SKILL_SLOTS; k += 1) {
      const sel = el.querySelector<HTMLSelectElement>(`[data-unit-skill="${i}-${k}"]`);
      if (sel) sel.value = s.skillIds[k] ?? '';
    }
  });
  const enemyTroopSel = el.querySelector<HTMLSelectElement>('[data-enemy="troopType"]');
  if (enemyTroopSel) enemyTroopSel.value = cfg.enemy.troopType;

  // 候选搜索（武将 / 战法下拉框）：绑定在选中值回填之后，搜索只收窄候选、不改选中值
  bindPickSearches(el, cfg);

  const bindChange = (node: Element | null, fn: () => void, rerenderAfter = true): void => {
    if (!node) return;
    node.addEventListener('change', () => {
      fn();
      if (rerenderAfter) rerender();
    });
  };

  cfg.slots.forEach((s, i) => {
    if (opts.unitLocked?.(i)) return;
    bindChange(el.querySelector(`[data-unit-hero="${i}"]`), () => {
      s.heroId = el.querySelector<HTMLSelectElement>(`[data-unit-hero="${i}"]`)!.value;
      s.addAttack = 0;
      s.addStrategy = 0;
      s.troopType = (HERO_RECORDS[s.heroId]?.troopType ?? 'infantry') as TroopType;
    });
    bindChange(el.querySelector(`[data-unit-level="${i}"]`), () => {
      const input = el.querySelector<HTMLInputElement>(`[data-unit-level="${i}"]`)!;
      s.level = Math.max(40, Math.min(50, Number(input.value) || 40));
    });
    bindChange(el.querySelector(`[data-unit-troop="${i}"]`), () => {
      s.troopType = el.querySelector<HTMLSelectElement>(`[data-unit-troop="${i}"]`)!.value as TroopType;
    });
    bindChange(el.querySelector(`[data-unit-atk="${i}"]`), () => {
      const input = el.querySelector<HTMLInputElement>(`[data-unit-atk="${i}"]`)!;
      s.addAttack = Math.max(0, Number(input.value) || 0);
      const budget = freePointBudget(s.heroId, 0, s.level);
      s.addStrategy = Math.min(s.addStrategy, Math.max(0, budget - s.addAttack));
    });
    bindChange(el.querySelector(`[data-unit-str="${i}"]`), () => {
      const input = el.querySelector<HTMLInputElement>(`[data-unit-str="${i}"]`)!;
      s.addStrategy = Math.max(0, Number(input.value) || 0);
      const budget = freePointBudget(s.heroId, 0, s.level);
      s.addAttack = Math.min(s.addAttack, Math.max(0, budget - s.addStrategy));
    });
    el.querySelector(`[data-unit-reset="${i}"]`)?.addEventListener('click', () => {
      s.skillIds = [];
      s.addAttack = 0;
      s.addStrategy = 0;
      rerender();
    });
    for (let k = 0; k < SKILL_SLOTS; k += 1) {
      const sel = el.querySelector<HTMLSelectElement>(`[data-unit-skill="${i}-${k}"]`);
      if (!sel) continue;
      // 战法变更不影响面板其他内容 → 不重渲染（3000+ option 重排代价高）
      sel.addEventListener('change', () => {
        const picks = Array.from({ length: SKILL_SLOTS }, (_, j) =>
          el.querySelector<HTMLSelectElement>(`[data-unit-skill="${i}-${j}"]`)?.value ?? ''
        );
        s.skillIds = picks.filter((v, idx) => v !== '' && picks.indexOf(v) === idx);
        opts.onChange?.();
      });
    }
  });

  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-enemy]').forEach((node) => {
    bindChange(node, () => {
      const key = node.dataset.enemy as 'defense' | 'strategy' | 'troopType';
      if (key === 'troopType') cfg.enemy.troopType = node.value as TroopType;
      else cfg.enemy[key] = Math.max(0, Number(node.value) || 0);
    });
  });
  el.querySelectorAll<HTMLInputElement>('[data-manual]').forEach((node) => {
    bindChange(node, () => {
      const key = node.dataset.manual as 'boostCaused' | 'boostTaken' | 'reduce';
      cfg.manual[key] = (Number(node.value) || 0) / 100;
    });
  });
  bindChange(el.querySelector('[data-global="morale"]'), () => {
    const input = el.querySelector<HTMLInputElement>('[data-global="morale"]')!;
    cfg.morale = Math.max(80, Math.min(140, Number(input.value) || 100));
  });
  bindChange(el.querySelector('[data-global="rounds"]'), () => {
    const input = el.querySelector<HTMLInputElement>('[data-global="rounds"]')!;
    cfg.rounds = Math.max(3, Math.min(8, Number(input.value) || 8));
  });

  opts.bindFooter?.(el, rerender);
}
