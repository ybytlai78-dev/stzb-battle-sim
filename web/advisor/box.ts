/**
 * AI 配将顾问 · 「我的 box」层（识图建档 → 按用户区分 → 每轮注入 → 硬约束）
 * ---------------------------------------------------------------------------
 * 用户口径（2026-09-29，见 `docs/AI配将顾问-设计.md` §15）：
 *   ① 用**用户当前接入的那个模型**（他自己的 ds flash，具备识图能力）读截图，不换模型；
 *   ② 截图内容 = 他账号里的**五星武将**与**五星战法**；
 *   ③ 识别结果汇总成这位用户的 box（**拥有哪些将 / 哪些战法**），是他后续配将的**前提条件**；
 *   ④ 之后的推荐**只能用 box 里的将法**（工具候选池收窄 + 校验门拒收，见 `tools.ts` / `gate.ts`）；
 *   ⑤ **每个用户的 box 都不同** → 多档案（`dsh-advisor-box-v1` 里按档案分开放，跟当前档案走）。
 *
 * 本文件只做三件事（**纯类型 + 纯函数 + 一把 localStorage 键**，不 import 引擎、不碰 DOM）：
 *   1. **档案存储**：`BoxStore`（多档案 + activeId）/ 容错读写 / 增删改；
 *   2. **确定性对齐**：`matchRecognition()` —— 视觉模型只负责"报名字"，**名字 → 库内 id 一律由这里定**
 *      （口径照 `web/teamScan.ts` 的截图识别规矩：名字唯一命中才算数，同名多版列候选让人来选，
 *      未命中**不静默丢**，进"待确认"区）。与 `teamScan` 一致：识别靠 AI、校验靠确定性代码。
 *   3. **注入块**：`renderBoxBlock()` → `<advisor_box>…</advisor_box>`，由 `loop.ts` 作为 system 块每轮注入。
 */
import { SKILL_REGISTRY } from '../../src/data/skills';
import { ALL_HEROES, SKILL_GRADES, TROOP_CHAR, isHeroListed, isLearnableSkillListed, type HeroJson } from '../heroes';
import { BOX_TAG, defaultStore, type MemoryStore } from './memory';

// ─────────────────────────── 键名与上限（常量，测试直接锁） ───────────────────────────

export const BOX_KEY = 'dsh-advisor-box-v1';
/** 默认档案名（第一次打开就是这一份） */
export const DEFAULT_PROFILE_NAME = '我的号';
/** 注入块字数上限（超大 box 会在末尾提示用 `get_my_box` 取全量） */
export const BOX_BLOCK_MAX_CHARS = 4000;
/** 单份 box 最多记多少条（防御性上限：真出现重复堆积也不会把注入块撑爆） */
export const BOX_MAX_HEROES = 400;
export const BOX_MAX_SKILLS = 500;
/** 档案数量上限（界面上的下拉，不建议太多） */
export const BOX_MAX_PROFILES = 12;

// ─────────────────────────── 类型 ───────────────────────────

/** 一次识别的来源（**只记张数与模型名，不存图片本体**——localStorage 放不下，也不需要） */
export interface BoxMeta {
  /** 最近一次识别 / 编辑时间 */
  at: number;
  /** 识别用了几张截图（0 = 纯手工维护） */
  images: number;
  /** 识别时用的模型（用户当前接入的那个） */
  model: string;
}

/** 一位用户的 box：**拥有的**五星武将 / 可学战法（只存 id，名字与属性一律查库，避免快照漂移） */
export interface AdvisorBox {
  heroIds: string[];
  skillIds: string[];
  /** 识别出来但库里没有 / 没确认的原始名字（**如实保留**，复核面板上要看得见） */
  unmatched: string[];
  meta: BoxMeta | null;
}

export interface BoxProfile {
  id: string;
  name: string;
  box: AdvisorBox;
  updatedAt: number;
}

export interface BoxStore {
  v: 1;
  activeId: string;
  profiles: BoxProfile[];
}

/** 给工具 / 校验门 / loop 用的只读视图（Set 查得快；`strict=false` 时不收窄候选池） */
export interface BoxView {
  profileId: string;
  profileName: string;
  heroIds: Set<string>;
  skillIds: Set<string>;
  /** 严格模式：只在 box 内检索 + 方案里出现 box 外的将法直接拒收 */
  strict: boolean;
  /** 有没有东西（空 box 不进"严格"语义：什么都没识别到 ≠ 什么都不许用） */
  empty: boolean;
}

// ─────────────────────────── 构造 / 容错 ───────────────────────────

export function emptyBox(): AdvisorBox {
  return { heroIds: [], skillIds: [], unmatched: [], meta: null };
}

export function newProfileId(now = Date.now(), rand: number = Math.random()): string {
  return `p${now.toString(36)}${Math.floor(rand * 1e6).toString(36)}`;
}

export function newProfile(name = DEFAULT_PROFILE_NAME, now = Date.now(), id = newProfileId(now)): BoxProfile {
  return { id, name: name || DEFAULT_PROFILE_NAME, box: emptyBox(), updatedAt: now };
}

export function emptyBoxStore(now = Date.now()): BoxStore {
  const p = newProfile(DEFAULT_PROFILE_NAME, now);
  return { v: 1, activeId: p.id, profiles: [p] };
}

const strArray = (v: unknown, max: number): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === 'string' ? x : '';
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

function parseBox(v: unknown): AdvisorBox {
  const o = (v ?? {}) as Partial<AdvisorBox>;
  const meta = o.meta && typeof o.meta === 'object'
    ? {
        at: Number((o.meta as BoxMeta).at) || 0,
        images: Math.max(0, Number((o.meta as BoxMeta).images) || 0),
        model: String((o.meta as BoxMeta).model ?? ''),
      }
    : null;
  return {
    heroIds: strArray(o.heroIds, BOX_MAX_HEROES),
    skillIds: strArray(o.skillIds, BOX_MAX_SKILLS),
    unmatched: strArray(o.unmatched, 200),
    meta,
  };
}

/** 容错读：坏 JSON / 版本不符 / 结构不对 → null（当作"没有 box"，绝不抛） */
export function parseBoxStore(raw: string | null): BoxStore | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<BoxStore>;
    if (!p || !Array.isArray(p.profiles)) return null;
    const profiles: BoxProfile[] = [];
    for (const it of p.profiles) {
      const rec = it as Partial<BoxProfile>;
      if (!rec || typeof rec !== 'object') continue;
      const id = typeof rec.id === 'string' && rec.id ? rec.id : newProfileId();
      profiles.push({
        id,
        name: (typeof rec.name === 'string' && rec.name.trim()) || DEFAULT_PROFILE_NAME,
        box: parseBox(rec.box),
        updatedAt: Number(rec.updatedAt) || 0,
      });
      if (profiles.length >= BOX_MAX_PROFILES) break;
    }
    if (!profiles.length) return null;
    const activeId = typeof p.activeId === 'string' && profiles.some((x) => x.id === p.activeId) ? p.activeId : profiles[0].id;
    return { v: 1, activeId, profiles };
  } catch {
    return null;
  }
}

export function loadBoxStore(store: MemoryStore = defaultStore()): BoxStore {
  return parseBoxStore(store.get(BOX_KEY)) ?? emptyBoxStore();
}

export function saveBoxStore(s: BoxStore, store: MemoryStore = defaultStore()): BoxStore {
  const next: BoxStore = { v: 1, activeId: s.activeId, profiles: s.profiles.slice(0, BOX_MAX_PROFILES) };
  try {
    store.set(BOX_KEY, JSON.stringify(next));
  } catch {
    /* 序列化失败（不该发生）：忽略，不影响对话 */
  }
  return next;
}

export function clearBoxStore(store: MemoryStore = defaultStore()): BoxStore {
  store.remove(BOX_KEY);
  return emptyBoxStore();
}

// ─────────────────────────── 档案操作（纯函数，返回新对象） ───────────────────────────

export function activeProfile(s: BoxStore): BoxProfile {
  return s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0];
}

export function setActiveProfile(s: BoxStore, id: string): BoxStore {
  return s.profiles.some((p) => p.id === id) ? { ...s, activeId: id } : s;
}

/** 新建档案并切过去；超过上限时丢**最久没更新**的那份（当前 active 永不丢） */
export function addProfile(s: BoxStore, name: string, now = Date.now()): BoxStore {
  const p = newProfile(name.trim() || `档案 ${s.profiles.length + 1}`, now);
  let profiles = [...s.profiles, p];
  if (profiles.length > BOX_MAX_PROFILES) {
    const drop = profiles
      .filter((x) => x.id !== p.id)
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    profiles = profiles.filter((x) => x.id !== drop.id);
  }
  return { v: 1, activeId: p.id, profiles };
}

export function renameProfile(s: BoxStore, id: string, name: string): BoxStore {
  const n = name.trim();
  if (!n) return s;
  return { ...s, profiles: s.profiles.map((p) => (p.id === id ? { ...p, name: n } : p)) };
}

/** 删档案（**至少留一份**：删掉最后一份 = 重置成一份空档案） */
export function removeProfile(s: BoxStore, id: string, now = Date.now()): BoxStore {
  const rest = s.profiles.filter((p) => p.id !== id);
  if (!rest.length) return emptyBoxStore(now);
  const activeId = s.activeId === id ? rest[0].id : s.activeId;
  return { v: 1, activeId, profiles: rest };
}

/** 改某一档的 box（唯一写入口，`updatedAt` 一并刷新） */
export function withBox(s: BoxStore, id: string, box: AdvisorBox, now = Date.now()): BoxStore {
  return { v: 1, activeId: s.activeId, profiles: s.profiles.map((p) => (p.id === id ? { ...p, box, updatedAt: now } : p)) };
}

// ─────────────────────────── box 内容的增删 ───────────────────────────

const pushUnique = (arr: string[], ids: string[], max: number): string[] => {
  const out = [...arr];
  for (const id of ids) if (id && !out.includes(id)) out.push(id);
  return out.slice(0, max);
};

export function boxAddHeroes(box: AdvisorBox, ids: string[]): AdvisorBox {
  return { ...box, heroIds: pushUnique(box.heroIds, ids, BOX_MAX_HEROES) };
}

export function boxAddSkills(box: AdvisorBox, ids: string[]): AdvisorBox {
  return { ...box, skillIds: pushUnique(box.skillIds, ids, BOX_MAX_SKILLS) };
}

export function boxRemoveHero(box: AdvisorBox, id: string): AdvisorBox {
  return { ...box, heroIds: box.heroIds.filter((x) => x !== id) };
}

export function boxRemoveSkill(box: AdvisorBox, id: string): AdvisorBox {
  return { ...box, skillIds: box.skillIds.filter((x) => x !== id) };
}

/** 箱子里有几个（界面 / 摘要文案共用） */
export function boxCount(box: AdvisorBox): { heroes: number; skills: number } {
  return { heroes: box.heroIds.length, skills: box.skillIds.length };
}

// ─────────────────────────── 名字归一化（对齐用） ───────────────────────────

/** 归一化：去空白（含全角）、**全角字母数字折半角**、去常见分隔符与书名号、统一大小写 —— **两边都用它**，口径一致 */
export function normalizeName(s: unknown): string {
  return String(s ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角 → 半角（ＳＰ → SP）
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・.．、,，:：;；/\\]/g, '')
    .replace(/[「」『』【】\[\]()（）<>《》]/g, '')
    .toUpperCase();
}

const TROOP_ALIAS: Record<string, string> = {
  骑: 'cavalry',
  骑兵: 'cavalry',
  cavalry: 'cavalry',
  步: 'infantry',
  步兵: 'infantry',
  infantry: 'infantry',
  弓: 'archer',
  弓兵: 'archer',
  archer: 'archer',
};

/** 「骑 / 骑兵 / cavalry」→ 引擎兵种键；认不出来返回 null */
export function normalizeTroop(s: unknown): string | null {
  const t = String(s ?? '').trim().toLowerCase();
  return TROOP_ALIAS[t] ?? TROOP_ALIAS[String(s ?? '').trim()] ?? null;
}

const FACTIONS = ['汉', '魏', '蜀', '吴', '群', '晋'];
/** 「魏 / 曹魏 / wei」→ 阵营字；认不出来返回 null */
export function normalizeFaction(s: unknown): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const hit = FACTIONS.find((f) => t.includes(f));
  return hit ?? null;
}

// ─────────────────────────── 识别结果 → 库内 id（确定性对齐） ───────────────────────────

/** 视觉模型报的一条武将（**只报它看到的**：名字 + 卡面上的阵营 / 兵种，用于消歧） */
export interface RecognizedHero {
  name: string;
  faction?: string | null;
  troopType?: string | null;
}

export interface RecognizedSkill {
  name: string;
  grade?: string | null;
}

/** 识图那一步的原始返回（模型照提示词吐的 JSON） */
export interface RecognitionRaw {
  heroes?: RecognizedHero[];
  skills?: RecognizedSkill[];
  /** 模型明确说"看不清"的原文片段（如实保留，复核面板上提示用户补图） */
  unrecognized?: string[];
}

export interface MatchCandidate {
  id: string;
  name: string;
  faction: string;
  troopType: string;
  listed: boolean;
}

export type MatchStatus = 'ok' | 'ambiguous' | 'unknown' | 'main_skill';

export interface HeroMatch {
  status: MatchStatus;
  raw: RecognizedHero;
  id?: string;
  candidates?: MatchCandidate[];
  note?: string;
}

export interface SkillMatch {
  status: MatchStatus;
  raw: RecognizedSkill;
  id?: string;
  grade?: string | null;
  /** `ambiguous` 时的候选（复核面板让人点一下） */
  candidates?: MatchCandidate[];
  note?: string;
}

export interface BoxMatchResult {
  heroIds: string[];
  skillIds: string[];
  /** 需要人来定的（同名多版 / 库里没有）——**不静默丢**，复核面板上逐条处理 */
  pendingHeroes: HeroMatch[];
  pendingSkills: SkillMatch[];
  /** 对齐过程中的提示（给用户看的一行行说明） */
  notes: string[];
}

const heroRow = (h: HeroJson): MatchCandidate => ({
  id: h.id,
  name: h.name,
  faction: h.faction,
  troopType: TROOP_CHAR[h.troopType] ?? h.troopType,
  listed: isHeroListed(h),
});

const heroMatchRow = (h: HeroJson) => `${h.name}(${h.id}·${h.faction}·${TROOP_CHAR[h.troopType] ?? h.troopType})`;

/** 候选按「阵营 + 兵种」消歧：两个线索都用上，剩一个就确定，剩多个交给用户 */
function disambiguate(cands: HeroJson[], raw: RecognizedHero): HeroJson[] {
  let out = cands;
  const f = normalizeFaction(raw.faction);
  const t = normalizeTroop(raw.troopType);
  if (f) {
    const byFaction = out.filter((h) => h.faction === f);
    if (byFaction.length) out = byFaction;
  }
  if (t) {
    const byTroop = out.filter((h) => h.troopType === t);
    if (byTroop.length) out = byTroop;
  }
  return out;
}

/**
 * 一位武将对齐：
 *  1. 归一化后**同名**命中 → 唯一则定；多版用阵营 / 兵种消歧；还分不出 → `ambiguous`（列候选让人选）
 *  2. 同名没命中 → **近似**命中（含 SP / XP 前缀差异、包含关系）；唯一则定并记 note，否则 `ambiguous` / `unknown`
 *  ⚠️ 与 `teamScan` 同一条纪律：**绝不猜**——猜错会把别人的将写进 box，比报"待确认"危险得多。
 */
export function matchHero(raw: RecognizedHero, all: HeroJson[] = ALL_HEROES): HeroMatch {
  const name = String(raw?.name ?? '').trim();
  if (!name) return { status: 'unknown', raw, note: '名字为空' };
  const n = normalizeName(name);
  const exact = all.filter((h) => normalizeName(h.name) === n);
  const pool = exact.length ? exact : all.filter((h) => {
    const hn = normalizeName(h.name);
    if (hn.length < 2 || n.length < 2) return false;
    return hn.includes(n) || n.includes(hn) || hn.replace(/^(SP|XP)/, '') === n.replace(/^(SP|XP)/, '');
  });
  if (!pool.length) return { status: 'unknown', raw, note: `库里没有「${name}」` };
  const picked = pool.length === 1 ? pool : disambiguate(pool, raw);
  if (picked.length === 1) {
    const h = picked[0];
    const note = exact.length ? (pool.length > 1 ? '按卡面阵营 / 兵种消歧' : '') : `按近似名匹配到「${h.name}」（截图里可能是 ${name}）`;
    return { status: 'ok', raw, id: h.id, ...(note ? { note } : {}) };
  }
  return {
    status: 'ambiguous',
    raw,
    candidates: picked.map(heroRow),
    note: `「${name}」库里有 ${picked.length} 个版本，需要你点一下是哪一个`,
  };
}

/**
 * 一个战法对齐：只认**可学习战法**（武将主战法随武将自带，不进 box 的可学槽）。
 * 名字唯一命中即可；库里没有 → `unknown`（不静默丢）。
 */
export function matchSkill(raw: RecognizedSkill, registry: typeof SKILL_REGISTRY = SKILL_REGISTRY, mainSkills?: Set<string>): SkillMatch {
  const name = String(raw?.name ?? '').trim();
  if (!name) return { status: 'unknown', raw, note: '名字为空' };
  const n = normalizeName(name);
  const entries = Object.entries(registry);
  const exact = entries.filter(([, def]) => normalizeName(def.name) === n);
  if (exact.length) {
    const learnable = exact.filter(([id]) => !(mainSkills?.has(id) ?? false));
    if (!learnable.length) return { status: 'main_skill', raw, note: `「${name}」是武将主战法（随武将自带，不用进 box）` };
    const [id] = learnable[0];
    return { status: 'ok', raw, id, grade: SKILL_GRADES[id] ?? null };
  }
  const near = entries.filter(([, def]) => {
    const dn = normalizeName(def.name);
    return dn.length >= 2 && n.length >= 2 && (dn.includes(n) || n.includes(dn));
  });
  if (near.length === 1) {
    const [id] = near[0];
    return { status: 'ok', raw, id, grade: SKILL_GRADES[id] ?? null, note: `按近似名匹配到「${near[0][1].name}」` };
  }
  if (near.length > 1) {
    return {
      status: 'ambiguous',
      raw,
      candidates: near.map(([id, def]) => ({ id, name: def.name, faction: '', troopType: SKILL_GRADES[id] ?? '?', listed: isLearnableSkillListed(id) })),
      note: `「${name}」有 ${near.length} 个相近战法，需要你确认`,
    };
  }
  return { status: 'unknown', raw, note: `库里没有「${name}」` };
}

/**
 * 一次识别结果 → 可直接入库的 id 清单（**对齐的唯一入口**）。
 * 已确定的进 `heroIds` / `skillIds`；分不出的进 `pending*`（复核面板上人工定）；重复条目自动去重。
 */
export function matchRecognition(
  raw: RecognitionRaw,
  opts: { heroes?: HeroJson[]; registry?: typeof SKILL_REGISTRY; mainSkills?: Set<string> } = {}
): BoxMatchResult {
  const all = opts.heroes ?? ALL_HEROES;
  const heroIds: string[] = [];
  const skillIds: string[] = [];
  const pendingHeroes: HeroMatch[] = [];
  const pendingSkills: SkillMatch[] = [];
  const notes: string[] = [];
  const seenHero = new Set<string>();
  const seenSkill = new Set<string>();

  for (const h of Array.isArray(raw?.heroes) ? raw.heroes : []) {
    const m = matchHero(h, all);
    if (m.status === 'ok' && m.id) {
      if (!seenHero.has(m.id)) {
        seenHero.add(m.id);
        heroIds.push(m.id);
      }
      if (m.note) notes.push(`${m.raw.name}：${m.note}`);
    } else {
      pendingHeroes.push(m);
    }
  }
  for (const s of Array.isArray(raw?.skills) ? raw.skills : []) {
    const m = matchSkill(s, opts.registry ?? SKILL_REGISTRY, opts.mainSkills);
    if (m.status === 'ok' && m.id) {
      if (!seenSkill.has(m.id)) {
        seenSkill.add(m.id);
        skillIds.push(m.id);
      }
      if (m.note) notes.push(`${m.raw.name}：${m.note}`);
    } else if (m.status !== 'main_skill') {
      pendingSkills.push(m);
    } else {
      notes.push(`「${m.raw.name}」是武将主战法，已跳过（随武将自带）`);
    }
  }
  return { heroIds, skillIds, pendingHeroes, pendingSkills, notes };
}

/** 把一次识别合并进 box（**并集** + 去重；`unmatched` 记下还没确认的原始名字，不静默丢） */
export function mergeRecognition(
  box: AdvisorBox,
  res: BoxMatchResult,
  meta: { at: number; images: number; model: string }
): AdvisorBox {
  const unmatched = [
    ...box.unmatched,
    ...res.pendingHeroes.map((p) => p.raw.name),
    ...res.pendingSkills.map((p) => p.raw.name),
  ].filter((x, i, a) => Boolean(x) && a.indexOf(x) === i);
  return {
    heroIds: pushUnique(box.heroIds, res.heroIds, BOX_MAX_HEROES),
    skillIds: pushUnique(box.skillIds, res.skillIds, BOX_MAX_SKILLS),
    unmatched,
    meta,
  };
}

// ─────────────────────────── 只读视图 + 注入块 ───────────────────────────

/** box → 工具 / 校验门 / loop 用的只读视图（`strict` 由界面上的「严格模式」决定，缺省开） */
export function boxViewOf(profile: BoxProfile, strict = true): BoxView {
  const heroIds = new Set(profile.box.heroIds);
  const skillIds = new Set(profile.box.skillIds);
  return {
    profileId: profile.id,
    profileName: profile.name,
    heroIds,
    skillIds,
    strict: strict && (heroIds.size > 0 || skillIds.size > 0),
    empty: heroIds.size === 0 && skillIds.size === 0,
  };
}

const boxHeroLine = (id: string): string => {
  const h = ALL_HEROES.find((x) => x.id === id);
  return h ? `${h.name}(${h.id}·${h.faction}·${TROOP_CHAR[h.troopType] ?? h.troopType})` : `${id}(库内已无此将)`;
};

const boxSkillLine = (id: string): string => {
  const def = SKILL_REGISTRY[id];
  const g = SKILL_GRADES[id];
  return def ? `${def.name}(${id}${g ? `·${g}` : ''})` : `${id}(库内已无此战法)`;
};

/**
 * 注入块（`<advisor_box>…</advisor_box>`，与 `<advisor_prefs>` 同款：**每轮**进 system，
 * 摆在 `SYSTEM_PROMPT → budgetHint → box → prefs → history → 本轮提问`）。
 *
 * ⚠️ 口径（用户 2026-09-29 修正）：box 是**「给这位用户配将」时的范围**，不是"什么都得先传截图"——
 * 比较 / 测算 / 查机制照常，不受清单限制；所以这里写的是"什么时候必须只用清单里的"，
 * 而不是"清单外的一律不许提"。空 box 也注入一小段：**只在配将时才**请他传截图。
 */
export function renderBoxBlock(
  view: BoxView,
  opts: { maxChars?: number; now?: number; model?: string } = {}
): string {
  const maxChars = Math.max(200, opts.maxChars ?? BOX_BLOCK_MAX_CHARS);
  const stamp = new Date(opts.now ?? Date.now());
  const p = (x: number): string => String(x).padStart(2, '0');
  const at = `${p(stamp.getMonth() + 1)}-${p(stamp.getDate())} ${p(stamp.getHours())}:${p(stamp.getMinutes())}`;

  if (view.empty) {
    return [
      `<${BOX_TAG}>`,
      `（「${view.profileName}」这个档案**还没有 box**：不知道他有哪些五星武将 / 战法。）`,
      '（**只有当他明确要你「给他自己配将 / 出方案」时**才需要它：那时先请他把「五星武将」与「五星战法」的截图发到抽屉的「我的 box」面板识别一次，别按通用池假设他有什么。）',
      '（其它问题——比较两个战法 / 某个将什么机制 / 帮我算一算 / 这队为什么低——**照常回答，不受 box 限制**，不要拿 box 当借口拒绝或反过来要求他先传截图。）',
      `</${BOX_TAG}>`,
    ].join('\n');
  }

  const head =
    `（这是「${view.profileName}」这位用户账号**实际拥有**的五星武将 / 战法清单，来自他上传的截图识别 + 人工复核；**每个用户的 box 都不同**。` +
    '**当他明确要你给他自己配将 / 出方案时**，方案里的每一个武将、每一个战法都必须在这份清单里；' +
    '只是比较、测算、查资料时不受这份清单限制。）';
  const strictLine = view.strict
    ? '（**严格模式：开** —— 配将类搜索（optimize_*）已经只在他有的将法里选；方案里出现清单外的将法会被标出来并禁用「应用」（**不算不合法**，对比/参考照看）。）'
    : '（严格模式：关 —— 清单只作事实参考；给他配将时仍优先用清单里的，用到清单外的要**明确标注**「这是你没有的」。）';

  const heroLines: string[] = [];
  const skillLines: string[] = [];
  let len = head.length + strictLine.length + 60;
  let heroShown = 0;
  for (const id of view.heroIds) {
    const line = boxHeroLine(id);
    if (len + line.length + 1 > maxChars) break;
    heroLines.push(line);
    len += line.length + 1;
    heroShown += 1;
  }
  const heroSkipped = view.heroIds.size - heroShown;
  for (const id of view.skillIds) {
    const line = boxSkillLine(id);
    if (len + line.length + 1 > maxChars) break;
    skillLines.push(line);
    len += line.length + 1;
  }
  const skillShown = skillLines.length;
  const skillSkipped = view.skillIds.size - skillShown;

  const foot =
    heroSkipped || skillSkipped
      ? `（清单较长只列了前一部分：武将还有 ${heroSkipped} 个、战法还有 ${skillSkipped} 个 —— 要全量就调 get_my_box 工具。）`
      : `（识别于 ${at}${view.profileName ? ` · 档案「${view.profileName}」` : ''}。）`;

  return [
    `<${BOX_TAG}>`,
    head,
    `武将 ${view.heroIds.size}：${heroLines.join(' ')}`,
    `战法 ${view.skillIds.size}：${skillLines.join(' ')}`,
    strictLine,
    foot,
    `</${BOX_TAG}>`,
  ].join('\n');
}

/** 界面 / 工具共用的一行摘要：`武将 37 · 战法 22 · 识别于 09-29 14:03（3 张图 · ds-flash）` */
export function boxSummaryText(profile: BoxProfile): string {
  const { heroes, skills } = boxCount(profile.box);
  const m = profile.box.meta;
  let when = '';
  if (m?.at) {
    const d = new Date(m.at);
    const p = (x: number): string => String(x).padStart(2, '0');
    when = ` · 识别于 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const src = m ? `（${m.images} 张图${m.model ? ` · ${m.model}` : ''}）` : '';
  return `武将 ${heroes} · 战法 ${skills}${when}${src}`;
}

// ─────────────────────────── 界面用的可读清单（复核面板） ───────────────────────────

export interface BoxRow {
  id: string;
  name: string;
  /** 右边的小字：`魏·骑` / `主动·S` */
  sub: string;
  /** 库里暂时不可用（下架 / 主战法未实现）→ 界面标一下，避免"识别对了但搜不到"的困惑 */
  warn?: string;
}

export function heroRows(box: { heroIds: string[] }): BoxRow[] {
  return box.heroIds.map((id) => {
    const h = ALL_HEROES.find((x) => x.id === id);
    if (!h) return { id, name: id, sub: '（库内已无此将）', warn: '库里没有这条，可能已改名' };
    const listed = isHeroListed(h);
    return {
      id,
      name: h.name,
      sub: `${h.faction}·${TROOP_CHAR[h.troopType] ?? h.troopType}`,
      ...(listed ? {} : { warn: h.mainSkillId ? '主战法已实现但暂时下架（模拟偏低）' : '主战法未实现（不能进模拟）' }),
    };
  });
}

export function skillRows(box: { skillIds: string[] }): BoxRow[] {
  return box.skillIds.map((id) => {
    const def = SKILL_REGISTRY[id];
    if (!def) return { id, name: id, sub: '（库内已无此战法）', warn: '库里没有这条，可能已改名' };
    const g = SKILL_GRADES[id] ?? '?';
    return {
      id,
      name: def.name,
      sub: `${def.type}·${g}`,
      ...(isLearnableSkillListed(id) ? {} : { warn: '该战法已下架（不能进模拟）' }),
    };
  });
}

/** 库里能搜到的武将候选（复核面板「搜名字换一个」用）：按名字 / 拼音子串过滤 */
export function searchHeroCandidates(q: string, limit = 20): MatchCandidate[] {
  const n = normalizeName(q);
  if (!n) return [];
  return ALL_HEROES.filter((h) => normalizeName(h.name).includes(n) || h.id.includes(q.trim().toLowerCase()))
    .slice(0, limit)
    .map(heroRow);
}

/** 库里能搜到的**可学习**战法候选（同上） */
export function searchSkillCandidates(q: string, limit = 20, mainSkills?: Set<string>): MatchCandidate[] {
  const n = normalizeName(q);
  if (!n) return [];
  const out: MatchCandidate[] = [];
  for (const [id, def] of Object.entries(SKILL_REGISTRY)) {
    if (mainSkills?.has(id)) continue;
    if (normalizeName(def.name).includes(n) || id.includes(q.trim().toLowerCase())) {
      out.push({ id, name: def.name, faction: '', troopType: SKILL_GRADES[id] ?? '?', listed: isLearnableSkillListed(id) });
    }
    if (out.length >= limit) break;
  }
  return out;
}
