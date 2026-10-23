/**
 * 预设识图 · 识别结果 → 预设槽位（纯逻辑，无 DOM、不 import 引擎）
 * ---------------------------------------------------------------------------
 * 用户口径（2026-10-21）：
 *   ① 上传游戏「阵容详情」截图 → 识别 **三将 / 红度 / 每人三个战法**；
 *   ② 兵种转换、兵系特性、宝物、加点**一律不识别**（用户自己在配将区加）；
 *   ③ **等级不识别，固定 40 级**；
 *   ④ 识别结果落进「我的预设」（可删），落库前先给确认卡。
 *
 * 纪律（与 `web/advisor/box.ts` / `web/teamScan.ts` 同一条，别在这里另立一套）：
 *   · **模型只负责报名字**（武将名 / 战法名 / 星数），名字 → 库内 id 一律由本文件的
 *     确定性对齐决定（`matchHero` / `matchSkill`，同名多版列候选、绝不猜）；
 *   · **主战法绝不进 `extraSkillIds`**：`buildGeneral` 已按武将 `mainSkillId` 自带挂一次，
 *     cfg 里再带一份会被引擎判定两次（实测太史慈方阵突击 200 场：6.6 次 / 3524 伤害 vs 3.0 次 / 1551，
 *     见 `docs/截图识别-敌对队伍集.md` §四）。所以「哪条是主战法」必须显式判定并剔除；
 *   · **不静默丢**：认不出的战法、看不清的红度、对不同版本的武将，全部进 `issues` 给人看。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { ALL_HEROES, MAIN_SKILL_IDS, isHeroListed, type HeroJson } from './heroes';
import { PRESET_NAME_MAX } from './presetStore';
import type { SlotState } from './teamEditor';
import { matchHero, matchSkill, normalizeName, type MatchCandidate } from './advisor/box';

/** 三个营位（顺序 = 存档槽位顺序，与 `EditorState` 一致） */
export const SCAN_POSITIONS = ['大营', '中军', '前锋'] as const;
export type ScanPosition = (typeof SCAN_POSITIONS)[number];

/** 等级口径：**不识别等级，一律按 40 级入库**（用户 2026-10-21） */
export const SCAN_LEVEL = 40;
/** 每名武将识别几个战法（主战法 + 2 个装配） */
export const SCAN_SKILLS = 3;
/** 自动预设名的前缀 */
export const SCAN_NAME_PREFIX = '识图·';

/** 模型吐的一条槽位（**只允许出现它真看见的东西**） */
export interface ScannedSlotJson {
  /** 大营 / 中军 / 前锋（截图左侧竖排标签） */
  position: string;
  heroName: string;
  /** 卡面名字右侧的星数 = 红度 0~5；看不清填 null（别猜） */
  redness?: number | null;
  /** 截图上的等级（只留痕：入库一律 40） */
  level?: number | null;
  /** 卡面左上角阵营 / 兵种：只用于同名多版消歧，看不清填 null */
  faction?: string | null;
  troopType?: string | null;
  /** 三个战法，**第 1 个是主战法**（游戏固定顺序） */
  skillNames?: string[];
}

/** 一张「阵容详情」截图的识别结果（模型固定 JSON schema） */
export interface TeamScanJson {
  /** 截图选中的页签：我方 / 敌方（仅记录，不影响落库） */
  side?: string | null;
  slots: ScannedSlotJson[];
  /** 模型明确说看不清的片段（如实保留，确认卡上提示补图） */
  unrecognized?: string[];
}

export interface ScanIssue {
  level: 'error' | 'warn';
  rule: string;
  message: string;
  /** 槽位下标（0=大营 1=中军 2=前锋）；不针对某槽的留空 */
  slot?: number;
}

/** 对齐后的单槽（UI 确认卡与落库共用这一份） */
export interface ScanSlotResult {
  position: ScanPosition;
  /** 模型的原始条目（`heroName` / `redness` 原样留痕，便于人工对照） */
  raw: ScannedSlotJson;
  heroId: string | null;
  /** 显示名：对齐到库就用库内名，否则用模型报的原文 */
  heroName: string;
  /** 红度 0~5（看不清 = 0，并在 issues 里记一条 warn） */
  redness: number;
  /** 截图上的等级（只留痕；`level` 恒为 `SCAN_LEVEL`） */
  rawLevel: number | null;
  mainSkillId: string | null;
  mainSkillName: string | null;
  /** 装配战法 id（**最多 2 个，绝不含主战法**） */
  extraSkillIds: string[];
  /** 装配战法名（与 `extraSkillIds` 一一对应，UI 直接显示） */
  extraSkillNames: string[];
  /** 同名多版候选（确认卡上点一下就定） */
  candidates: MatchCandidate[];
  /** 这条槽位上没认出来的战法名（如实展示） */
  unmatchedSkills: string[];
  /** 该武将库里暂时不可用（下架 / 主战法未实现）→ 确认卡上标一句 */
  warn?: string;
}

export interface TeamScanResult {
  slots: ScanSlotResult[];
  issues: ScanIssue[];
  /** 自动预设名（确认卡里可改） */
  name: string;
  /** 有几名武将对齐到了库内 id（0 = 整张图没读对） */
  heroCount: number;
  unrecognized: string[];
}

// ─────────────────────────── 容错解析（模型回的 JSON） ───────────────────────────

const asText = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** `0~5` 的红度：非数字 / 看不清 → null（**不要瞎猜成 0**，交给调用方决定并留痕） */
function asRedness(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function coerceSlot(v: unknown): ScannedSlotJson | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const heroName = asText(o.heroName ?? o.hero ?? o.name);
  const position = asText(o.position ?? o.pos ?? o.slot);
  if (!heroName && !position) return null;
  const names = Array.isArray(o.skillNames)
    ? o.skillNames.map(asText).filter(Boolean)
    : Array.isArray(o.skills)
      ? o.skills
          .map((x) => asText(typeof x === 'string' ? x : (x as Record<string, unknown>)?.name))
          .filter(Boolean)
      : [];
  return {
    position,
    heroName,
    redness: asRedness(o.redness ?? o.red ?? o.stars ?? o.star),
    level: Number.isFinite(Number(o.level)) ? Math.round(Number(o.level)) : null,
    faction: asText(o.faction ?? o.camp) || null,
    troopType: asText(o.troopType ?? o.troop) || null,
    skillNames: names.slice(0, SCAN_SKILLS),
  };
}

/** 规整成干净结构（字段容错，但**不补内容**：没报的就是没报） */
export function normalizeTeamScan(v: unknown): TeamScanJson {
  const o = (v ?? {}) as Record<string, unknown>;
  const slots = (Array.isArray(o.slots) ? o.slots : [])
    .map(coerceSlot)
    .filter((x): x is ScannedSlotJson => Boolean(x))
    .slice(0, SCAN_SKILLS);
  const unrecognized = (Array.isArray(o.unrecognized) ? o.unrecognized : [])
    .map((x) => (typeof x === 'string' ? x : asText((x as Record<string, unknown>)?.raw ?? '')))
    .filter(Boolean)
    .slice(0, 40);
  const side = asText(o.side);
  return { side: side || null, slots, unrecognized };
}

/**
 * 从模型回复里取识别 JSON：先找 ```json 围栏，再退到「第一个 { 到最后一个 }」。
 * 都不是合法 JSON → 抛错（识图结果绝不静默变空），错误文案带上原文前 200 字便于排错。
 */
export function parseTeamScanReply(text: string): TeamScanJson {
  const src = String(text ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(src);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(src.slice(first, last + 1));
  if (!fenced && !candidates.length) candidates.push(src);
  for (const c of candidates) {
    const t = c.trim();
    if (!t) continue;
    try {
      const parsed = normalizeTeamScan(JSON.parse(t) as unknown);
      if (parsed.slots.length) return parsed;
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(`识图结果不是能认的 JSON（原文前 200 字：${asText(src).slice(0, 200)}）`);
}

// ─────────────────────────── 确定性对齐（名字 → 库内 id） ───────────────────────────

export interface MatchTeamScanOpts {
  heroes?: HeroJson[];
  registry?: typeof SKILL_REGISTRY;
  /** 主战法 id 集合（缺省 `MAIN_SKILL_IDS`）：用于拒绝「把别人的主战法当装配战法」 */
  mainSkills?: Set<string>;
  /**
   * 人工定案（确认卡上点了候选按钮）：营位 → 库内武将 id。
   * 给了就**跳过同名对齐**直接用这个 id（`candidates` 一并清空），其余口径不变。
   */
  heroOverrides?: Partial<Record<ScanPosition, string>>;
}

/**
 * 识别结果 → 可直接落库的槽位（**对齐的唯一入口**）。
 *
 * 顺序口径：
 *  1. 位置按 大营/中军/前锋 归位（缺的留空槽，重复的取第一条并记 error）；
 *  2. 武将名走 `matchHero`（同名多版 → 候选，不猜）；
 *  3. **主战法判定**：与武将库内 `mainSkillName` 同名的那条剔除（不进 `extraSkillIds`）；
 *     三条都对不上主战法名时**按「第 1 条是主战法」处理**并记 warn —— 游戏固定顺序如此，
 *     而把主战法塞进装配槽会被引擎判定两次（见文件头纪律）；
 *  4. 其余两条走 `matchSkill`；认不出 / 是别将主战法的，进 `unmatchedSkills`（不静默丢）。
 */
export function matchTeamScan(raw: TeamScanJson, opts: MatchTeamScanOpts = {}): TeamScanResult {
  const allHeroes = opts.heroes ?? ALL_HEROES;
  const registry = opts.registry ?? SKILL_REGISTRY;
  const mainSkills = opts.mainSkills ?? MAIN_SKILL_IDS;
  const issues: ScanIssue[] = [];
  const input = Array.isArray(raw?.slots) ? raw.slots : [];

  const findSlot = (pos: ScanPosition): ScannedSlotJson | undefined => input.find((s) => asText(s.position) === pos);

  const slots: ScanSlotResult[] = SCAN_POSITIONS.map((position, i) => {
    const hit = findSlot(position);
    const dup = input.filter((s) => asText(s.position) === position).length;
    if (dup > 1) issues.push({ level: 'error', rule: 'position-dup', message: `「${position}」在识别结果里出现了 ${dup} 次，只取第一条`, slot: i });
    if (!hit) {
      issues.push({ level: 'warn', rule: 'position-missing', message: `没读到「${position}」，这个槽位留空（可在配将区补）`, slot: i });
      return {
        position,
        raw: { position, heroName: '' },
        heroId: null,
        heroName: '',
        redness: 0,
        rawLevel: null,
        mainSkillId: null,
        mainSkillName: null,
        extraSkillIds: [],
        extraSkillNames: [],
        candidates: [],
        unmatchedSkills: [],
      };
    }

    const heroName = asText(hit.heroName);
    const m = heroName ? matchHero({ name: heroName, faction: hit.faction ?? null, troopType: hit.troopType ?? null }, allHeroes) : null;
    // 人工定案优先（确认卡上点过候选）：直接认这个 id，不再走同名对齐
    const overrideId = opts.heroOverrides?.[position];
    const hero =
      (overrideId ? allHeroes.find((h) => h.id === overrideId) : undefined) ?? (m?.id ? allHeroes.find((h) => h.id === m.id) : undefined);
    if (!heroName && !hero) {
      issues.push({ level: 'warn', rule: 'hero-empty', message: `「${position}」那一行没读到武将名`, slot: i });
    } else if (!hero) {
      issues.push({
        level: 'error',
        rule: m?.status === 'ambiguous' ? 'hero-ambiguous' : 'hero-unknown',
        message:
          m?.status === 'ambiguous'
            ? `「${heroName}」库里有 ${m.candidates?.length ?? 0} 个版本，需要你点一下是哪一个`
            : `库里没有「${heroName}」，这个槽位留空（若截图是 SP / XP 版本，请照抄卡面上的前缀）`,
        slot: i,
      });
    }

    // ── 主战法判定 ──
    const names = (hit.skillNames ?? []).map(asText).filter(Boolean).slice(0, SCAN_SKILLS);
    const libMainName = hero?.mainSkillName ?? '';
    let mainIdx = libMainName ? names.findIndex((n) => normalizeName(n) === normalizeName(libMainName)) : -1;
    if (mainIdx < 0 && names.length && hero) {
      mainIdx = 0;
      issues.push({
        level: 'warn',
        rule: 'main-skill',
        message:
          `${hero.name} 的三个战法里没有「${libMainName}」——按游戏顺序把第 1 条「${names[0]}」当主战法处理（不进装配槽）` +
          `${normalizeName(names[0]) !== normalizeName(libMainName) ? '；若这条其实是装配战法，请在配将区改' : ''}`,
        slot: i,
      });
    }

    const extraSkillIds: string[] = [];
    const extraSkillNames: string[] = [];
    const unmatchedSkills: string[] = [];
    names.forEach((n, k) => {
      if (k === mainIdx) return;
      const sm = matchSkill({ name: n }, registry, mainSkills);
      if (sm.status === 'ok' && sm.id) {
        if (extraSkillIds.includes(sm.id)) {
          issues.push({ level: 'warn', rule: 'skill-dup', message: `${hero?.name ?? position} 重复带了「${n}」，只算一次`, slot: i });
          return;
        }
        if (extraSkillIds.length >= 2) return;
        extraSkillIds.push(sm.id);
        extraSkillNames.push(registry[sm.id]?.name ?? n);
        if (sm.note) issues.push({ level: 'warn', rule: 'skill-near', message: `${n}：${sm.note}`, slot: i });
        return;
      }
      unmatchedSkills.push(n);
      issues.push({
        level: 'warn',
        rule: sm.status === 'ambiguous' ? 'skill-ambiguous' : sm.status === 'main_skill' ? 'skill-main' : 'skill-unknown',
        message:
          sm.status === 'main_skill'
            ? `「${n}」是武将主战法，不能作为装配战法（已跳过）`
            : sm.status === 'ambiguous'
              ? `「${n}」有 ${sm.candidates?.length ?? 0} 个相近战法，没敢替你定（已跳过）`
              : `库里没有战法「${n}」（已跳过）`,
        slot: i,
      });
    });
    if (names.length && names.length < SCAN_SKILLS) {
      issues.push({ level: 'warn', rule: 'skill-count', message: `${hero?.name ?? heroName} 只读到 ${names.length} 个战法（应为 3 个）`, slot: i });
    }

    // ── 红度 / 等级 ──
    // 这里再夹一次：`normalizeTeamScan` 只在"模型原文"那条路上夹断，直接喂 JSON 的调用方（脚本 / 手写 fixture）也走同一口径
    const redness = hit.redness === null || hit.redness === undefined || !Number.isFinite(Number(hit.redness))
      ? null
      : Math.max(0, Math.min(5, Math.round(Number(hit.redness))));
    if (redness === null && hero) {
      issues.push({ level: 'warn', rule: 'redness', message: `${hero.name} 的红度（星数）没看清，先按 0 红存，可在配将区改`, slot: i });
    }

    // 下架 / 主战法未实现：不影响落库，但确认卡要标一句（避免「识别对了却搜不到」）
    const listed = hero ? isHeroListed(hero) : false;
    const warn = hero && !listed ? (hero.mainSkillId ? '主战法已实现但暂时下架（模拟偏低）' : '主战法未实现（不能进模拟）') : undefined;

    return {
      position,
      raw: hit,
      heroId: hero?.id ?? null,
      heroName: hero?.name ?? heroName,
      redness: redness ?? 0,
      rawLevel: hit.level ?? null,
      mainSkillId: hero?.mainSkillId ?? null,
      mainSkillName: libMainName || null,
      extraSkillIds,
      extraSkillNames,
      candidates: m?.candidates ?? [],
      unmatchedSkills,
      ...(warn ? { warn } : {}),
    };
  });

  // 率土规则：同一战法不能同时出现在队内两人身上（含各将主战法）——只提示，不拦落库
  const used = new Map<string, string>();
  slots.forEach((s, i) => {
    const ids = [...(s.mainSkillId ? [s.mainSkillId] : []), ...s.extraSkillIds];
    for (const id of ids) {
      const owner = used.get(id);
      if (owner && owner !== s.heroName) {
        const label = registry[id]?.name ?? id;
        issues.push({ level: 'warn', rule: 'skill-team-dup', message: `战法「${label}」在队内重复（${owner} / ${s.heroName}）`, slot: i });
      } else used.set(id, s.heroName);
    }
  });

  const heroCount = slots.filter((s) => s.heroId).length;
  return {
    slots,
    issues,
    name: scannedPresetName(slots),
    heroCount,
    unrecognized: raw?.unrecognized ?? [],
  };
}

// ─────────────────────────── 落库形态 ───────────────────────────

/** 自动预设名：`识图·司马炎-乐进-于禁`（未识别用「空」，超长按 `PRESET_NAME_MAX` 截断） */
export function scannedPresetName(slots: Array<{ heroName: string }>): string {
  const names = slots.map((s) => (s.heroName || '空')).join('-');
  return `${SCAN_NAME_PREFIX}${names}`.slice(0, PRESET_NAME_MAX);
}

/**
 * 对齐结果 → 配将区槽位（`SlotState[]`，恒 3 条，顺序 大营/中军/前锋）。
 * 兵种转换 / 特性 / 宝物 / 加点**一律留空**、等级固定 `SCAN_LEVEL`（用户 2026-10-21 口径）。
 */
export function toSlotStates(res: TeamScanResult): SlotState[] {
  return res.slots.map((s) => ({
    heroId: s.heroId,
    extraSkillIds: [...s.extraSkillIds],
    freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 },
    redness: Math.max(0, Math.min(5, Math.round(s.redness))),
    level: SCAN_LEVEL,
    treasure: null,
  }));
}

/** 一行摘要（确认卡标题 / 存档提示共用）：`3 将 · 5 战法 · #识图·司马炎-乐进-于禁` */
export function scanSummaryText(res: TeamScanResult): string {
  const skills = res.slots.reduce((n, s) => n + s.extraSkillIds.length + (s.mainSkillId ? 1 : 0), 0);
  const bad = res.slots.filter((s) => !s.heroId).length;
  return `${res.heroCount} 将 · ${skills} 战法${bad ? ` · ${bad} 个槽位没认出来` : ''}`;
}

/** 有没有 error 级问题（确认卡用来决定是否提示“先修一下”） */
export function scanHasBlockingIssue(res: TeamScanResult): boolean {
  return res.issues.some((i) => i.level === 'error');
}
