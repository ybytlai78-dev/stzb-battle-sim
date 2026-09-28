/**
 * AI 配将顾问 · 校验门
 * ---------------------------------------------------------------------------
 * 本切片（实施计划 Task 1~3）只实现 **关 1 · 方案合法性**：
 *   plan → ScanJson → 复用截图识别的校验器 `validateScan`（一份实现，不另立一套）
 *   ＋ 跨槽规则（截图识别是单侧扫描，管不到这些）：全队战法唯一 / 同队互斥 / 同将重复 / 每将槽位数。
 *
 * 关 2（数字溯源 `evidenceId`）与关 3（标准口径独立复算）见 `docs/AI配将顾问-实施计划.md` Task 5，
 * 本切片不做——**方案卡上的数字仍然只来自工具返回**（这是渲染层的规矩，不依赖关 2/3 是否已实现）。
 */
import { SKILL_REGISTRY } from '../../src/data/skills';
import { HERO_RECORDS, getHeroById, isMainSkill } from '../heroes';
import { DUMMY_TROOPS_DEFAULT } from '../simExpectation';
import { LEARNABLE_SKILL_IDS, SKILL_SLOTS, defaultCfg, type ViewCfg } from '../teamConfig';
import { browserTables } from '../teamScanBrowser';
import { validateScan, type ScanJson } from '../teamScan';
import { PLAN_POSITIONS, normalizePlan, type AdvisorPlan, type ProposedPlan, type ToolCallRecord } from './types';

export interface PlanIssue {
  /** 给 AI 自纠用的机器码（unknown_hero / duplicate_skill / mutual_exclusion / main_skill_in_slot / slot-position …） */
  code: string;
  message: string;
  slotIndex?: number;
}

export interface PlanVerdict {
  ok: boolean;
  errors: PlanIssue[];
  /** 规范化后的方案（排序 / 补默认等级 / 去空战法）——工具与渲染都用它 */
  normalized: AdvisorPlan;
}

const LEARNABLE = new Set(LEARNABLE_SKILL_IDS);
/** 底栏口径（士气 120 / 8 回合 / 手动增减伤 0）：直接取自 `defaultCfg()`，避免把数字抄两遍 */
const BASE_CFG: ViewCfg = defaultCfg();

/** 同队互斥组（与引擎 `validateMutualExclusion`、`web/simMate.ts` 的 `mutualGroupOf` 同一口径） */
export function mutualGroupOf(heroId: string): string | null {
  return HERO_RECORDS[heroId]?.mutualExclusionGroup ?? null;
}

/** `ViewCfg`（面板配置）→ `AdvisorPlan`（顾问方案）：`get_config` 工具用 */
export function configToPlan(cfg: ViewCfg): AdvisorPlan {
  return {
    slots: cfg.slots.map((s, i) => ({
      position: PLAN_POSITIONS[i] ?? '中军',
      heroId: s.heroId,
      level: s.level,
      skillIds: [...s.skillIds],
    })),
    // 缺省 = 空数组 → L2 的 `autoCoreUnits` 自动识别核心将（排序口径 = 核心将伤害期望）
    coreUnitIds: [],
    dummy: {
      defense: cfg.enemy.defense,
      strategy: cfg.enemy.strategy,
      troopType: cfg.enemy.troopType,
      troops: DUMMY_TROOPS_DEFAULT,
    },
  };
}

/** `AdvisorPlan` → `ViewCfg`（跑批用）：站位按 大营/中军/前锋 顺序，士气/回合走底栏口径 */
export function cfgOf(plan: AdvisorPlan): ViewCfg {
  const p = normalizePlan(plan);
  return {
    slots: p.slots.map((s) => ({
      heroId: s.heroId,
      level: s.level,
      addAttack: 0,
      addStrategy: 0,
      troopType: (getHeroById(s.heroId)?.troopType ?? 'infantry') as ViewCfg['slots'][number]['troopType'],
      skillIds: [...s.skillIds],
    })),
    morale: BASE_CFG.morale,
    enemy: { defense: p.dummy.defense, strategy: p.dummy.strategy, troopType: p.dummy.troopType },
    rounds: BASE_CFG.rounds,
    manual: { ...BASE_CFG.manual },
  };
}

/** 方案 → 识别 JSON（第 1 个战法补成该武将的主战法，满足校验器的「主战法断言」） */
export function planToScanJson(plan: AdvisorPlan): ScanJson {
  return {
    source: { file: 'advisor-plan' },
    label: 'AI 方案',
    side: 'ally',
    slots: plan.slots.map((s) => {
      const hero = getHeroById(s.heroId);
      const main = hero?.mainSkillName ?? '';
      const names = [main, ...s.skillIds.map((id) => SKILL_REGISTRY[id]?.name ?? id)].filter(Boolean);
      return {
        position: s.position,
        heroName: hero?.name ?? s.heroId,
        heroId: s.heroId,
        level: s.level,
        troopTrait: null,
        skillNames: names,
        treasure: null,
      };
    }),
  };
}

/**
 * 关 1：方案合法性。错误**如实返回**（带 code）而不是静默丢弃——AI 拿到 code 才能自纠。
 */
export function validateAdvisorPlan(plan: AdvisorPlan): PlanVerdict {
  const normalized = normalizePlan(plan);
  const errors: PlanIssue[] = [];

  normalized.slots.forEach((s, i) => {
    if (!getHeroById(s.heroId)) errors.push({ code: 'unknown_hero', message: `武将「${s.heroId}」不在库`, slotIndex: i });
    if (s.skillIds.length > SKILL_SLOTS)
      errors.push({ code: 'too_many_skills', message: `每将最多 ${SKILL_SLOTS} 个可学战法，收到 ${s.skillIds.length} 个`, slotIndex: i });
    s.skillIds.forEach((id) => {
      const def = SKILL_REGISTRY[id];
      if (!def) errors.push({ code: 'unknown_skill', message: `战法「${id}」不在库`, slotIndex: i });
      else if (isMainSkill(id)) errors.push({ code: 'main_skill_in_slot', message: `「${def.name}」是武将主战法，不能放进可学槽`, slotIndex: i });
      else if (!LEARNABLE.has(id)) errors.push({ code: 'skill_not_learnable', message: `战法「${def.name}」不在可学习池（可能已下架）`, slotIndex: i });
    });
  });

  const heroIds = normalized.slots.map((s) => s.heroId);
  const dupHeroes = [...new Set(heroIds.filter((id, i) => heroIds.indexOf(id) !== i))];
  if (dupHeroes.length) errors.push({ code: 'duplicate_hero', message: `同一武将出现多次：${dupHeroes.join(' / ')}` });

  const seenSkill = new Set<string>();
  normalized.slots.forEach((s, i) =>
    s.skillIds.forEach((id) => {
      if (seenSkill.has(id))
        errors.push({
          code: 'duplicate_skill',
          message: `战法「${SKILL_REGISTRY[id]?.name ?? id}」出现在多个槽位（全队战法唯一）`,
          slotIndex: i,
        });
      else seenSkill.add(id);
    })
  );

  const byGroup = new Map<string, string[]>();
  for (const s of normalized.slots) {
    const g = mutualGroupOf(s.heroId);
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), s.heroId]);
  }
  for (const [g, ids] of byGroup)
    if (ids.length > 1) errors.push({ code: 'mutual_exclusion', message: `同队互斥：${ids.join(' / ')} 同属互斥组「${g}」` });

  // 复用截图识别的校验器：位置齐全 / 武将名唯一命中 / 战法在库 / 主战法断言 / 等级夹取
  const scan = validateScan(planToScanJson(normalized), browserTables());
  for (const issue of scan.issues) if (issue.level === 'error') errors.push({ code: issue.rule, message: issue.message, slotIndex: issue.slot });

  return { ok: errors.length === 0, errors, normalized };
}

// ─────────────────────────── 关 2 · 数字溯源 ───────────────────────────

/** 相对容差（0.5%）：防止「26,500 写成 2.65 万」被误杀 */
export const TOLERANCE_REL = 0.005;
/** 绝对容差（1）：小数舍入不算撒谎，但 26,500 说成 31,000 混不过去 */
export const TOLERANCE_ABS = 1;

export function withinTolerance(claimed: number, actual: number): boolean {
  return Math.abs(claimed - actual) <= Math.max(TOLERANCE_REL * Math.abs(actual), TOLERANCE_ABS);
}

/** 深度遍历工具明细里的全部数字（供溯源比对；纯数字字符串也算） */
export function collectNumbers(data: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out.push(v);
    } else if (typeof v === 'string') {
      const t = v.trim();
      if (/^-?\d+(?:\.\d+)?$/.test(t)) out.push(Number(t));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(data);
  return out;
}

export interface ClaimFailure {
  value: number;
  evidenceId: string;
  reason: string;
}

/**
 * 核对回答里的数字引用：格式 `数字[[evidenceId]]`（系统提示词写死了这个格式）。
 * `evidenceId` 必须在本轮 trace 里，且数字要在**那次工具返回的明细**里找得到。
 */
export function verifyClaims(answer: string, trace: ToolCallRecord[]): { ok: boolean; failures: ClaimFailure[] } {
  const failures: ClaimFailure[] = [];
  const re = /(-?\d[\d,]*(?:\.\d+)?)\s*\[\[([^\]]+)\]\]/g;
  for (const m of answer.matchAll(re)) {
    const value = Number(m[1].replace(/,/g, ''));
    const id = m[2].trim();
    const hit = trace.find((t) => t.evidenceId === id);
    if (!hit) {
      failures.push({ value, evidenceId: id, reason: 'evidenceId 不存在于本轮 trace' });
      continue;
    }
    if (!collectNumbers(hit.data).some((n) => withinTolerance(value, n))) {
      failures.push({ value, evidenceId: id, reason: '该次工具返回里找不到这个数字' });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** 方案自带的证据引用同样要核：一个证据都不带的方案 = 未验证（没跑过的方案不许应用） */
export function verifyPlanEvidence(plan: ProposedPlan, trace: ToolCallRecord[]): { ok: boolean; reason?: string } {
  if (!plan.evidenceIds.length) return { ok: false, reason: '方案未附实测依据（evidenceIds 为空）' };
  const missing = plan.evidenceIds.filter((id) => !trace.some((t) => t.evidenceId === id));
  return missing.length ? { ok: false, reason: `方案引用的证据不存在：${missing.join('、')}` } : { ok: true };
}

/** 三道关缺一不可（关 3 未接入时 `recomputed: false` → 应用保持禁用，不假装通过） */
export function decideApply(v: { legal: boolean; verified: boolean; recomputed: boolean }): { enabled: boolean; reason?: string } {
  if (!v.legal) return { enabled: false, reason: '方案不合法（见错误清单）' };
  if (!v.verified) return { enabled: false, reason: '有数字或方案依据无法追溯（标「未验证」）' };
  if (!v.recomputed) return { enabled: false, reason: '标准口径独立复算未接入（实施计划 Task 5）' };
  return { enabled: true };
}
