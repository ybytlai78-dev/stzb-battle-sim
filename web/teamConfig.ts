/**
 * 队伍配置面板（L2 回合模型 / L3 优化器共用）
 * ---------------------------------------------------------------------------
 * 抽出原因：两个独立页（round-model.html / optimizer.html）都需要「三将 + 等级 + 加点 + 兵种 + 战法槽 + 目标/环境」这套输入。
 * 面板只负责编辑 `ViewCfg`；发什么战法、算什么，由调用方决定。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import type { TreasureLoadout, TroopType } from '../src/engine/types';
import type { GeneralTrait } from '../src/engine/secondaryTroop';
import { baseStatsAt, freePointBudget, HERO_RECORDS, isFemale, isLearnableSkillListed, isMainSkill, SLOTTED_HEROES, SKILL_GRADES, TROOP_CHAR, troopCapacity } from './heroes';
import { simulateRounds, skillById, SLOT_LABEL, type ParseContext, type RoundModelResult, type RoundUnit, type SkillSlot } from './roundModel';

export const TROOP_OPTIONS: Array<[TroopType, string]> = [
  ['cavalry', '骑兵'],
  ['infantry', '步兵'],
  ['archer', '弓兵'],
];

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

export const HERO_OPTIONS = SLOTTED_HEROES.map((h) => ({
  id: h.id,
  label: `${h.name}（${h.faction}·${TROOP_CHAR[h.troopType] ?? ''}）`,
}));
const HERO_OPTIONS_HTML = HERO_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');

export interface SkillOption {
  id: string;
  label: string;
  slot: SkillSlot;
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
        }
      : undefined;
  })
  .filter((v): v is SkillOption => Boolean(v))
  .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.label.localeCompare(b.label, 'zh'));
const SKILL_OPTIONS_HTML = SKILL_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');

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
            <select data-unit-hero="${i}" ${locked ? 'disabled' : ''}>${HERO_OPTIONS_HTML}</select>
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
          ${Array.from({ length: SKILL_SLOTS }, (_, k) => k)
            .map(
              (k) => `<select class="rm-skill" data-unit-skill="${i}-${k}">
                <option value="">（空槽 ${k + 1}）</option>
                ${SKILL_OPTIONS_HTML}
              </select>`
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
