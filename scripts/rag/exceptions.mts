#!/usr/bin/env tsx
/**
 * 已裁定差异清单：把「查过、有结论、不是 bug」的差异从对拍报告里摘出去。
 *
 * 解决的问题：包内 detail 表不能覆盖所有参数（官方文案里的数值常常没同步进 detail），
 * 有些差异是用户已经拍板的口径。若不登记，对拍每次都会重复报同一条差异，
 * 真差异被噪音埋掉，最后没人再看报告。
 *
 * 两类条目，语义不同，别混：
 *  - `IGNORE_RULES`：**结构性不对等**，两侧本来就不是同一实体或同一粒度（百家变体共用基型槽位、
 *    通用模板与同名独立战法）。这类不该被判为"差异"，连"已裁定"都不算。
 *  - `ACCEPTED_DIVERGENCES`：**同一个实体、确有两套数值**，由人裁定以哪一侧为准，并记录裁定日期与出处。
 *    必须同时记下裁定时的两侧值 —— 任何一侧后来变了，条目就 `stale`（失效），
 *    对拍会重新报警，不会静默吞掉。
 *
 * 新增条目的门槛：必须能指到「谁在什么时候按什么依据拍板的」（AGENTS.md 小节 / 调研文档 / 用户原话）。
 * 拿不准就别写进来 —— 未裁定的差异留在报告里才是对的。
 */

export type DivergenceField = 'value' | 'growth';

export type Verdict = 'none' | 'accepted' | 'ignored' | 'stale';

/** 结构性不对等：按前缀 / id / 槽位模式忽略 */
export interface IgnoreRule {
  match: {
    /** 引擎战法 id 前缀，如 'bj_' */
    skillPrefix?: string;
    /** 引擎战法 id 精确匹配 */
    skill?: string;
    /** 槽位 detail_id 前缀（数字），如 550007 */
    detailPrefix?: number;
    /** 机制码 */
    effectId?: number;
  };
  reason: string;
}

/** 同一实体的两套数值，人工裁定以某一侧为准 */
export interface AcceptedDivergence {
  /** 引擎战法 id（SKILL_REGISTRY 的 key） */
  skillId: string;
  /** 槽位 detail_id */
  detailId: number;
  /** 哪一项存在分歧 */
  field: DivergenceField;
  /** 裁定时的引擎值（null = 引擎没有该输出） */
  engine: number | null;
  /** 裁定时的包内值 */
  pkg: number;
  /** 为什么以这一侧为准 */
  reason: string;
  /** 裁定依据出处与日期 */
  decided: string;
}

export const IGNORE_RULES: IgnoreRule[] = [
  {
    match: { skillPrefix: 'bj_' },
    reason:
      '百家变体（bj_ 前缀）在包内共用基型战法的一条槽位，引擎为每个变体各自配了数值（西陲立功 550007 一条槽位 ↔ bj_550010~550016 六套数值）。逐条比对是拿一个包内槽位比多个引擎实体，结构不对等。',
  },
  {
    match: { skill: 'zhuiji' },
    reason:
      '引擎 `zhuiji` 是通用追击模板（triggerRate 0.5 / rate 50），包内 200206「追击」是同名的独立战法（probability_max 50 / 伤害率 80）。按名对齐命中了，但不是同一实体。⚠️ 若引擎确实拿 zhuiji 当通用追击使用，这 50 的伤害率应按包内校准，属另一件事。',
  },
];

export const ACCEPTED_DIVERGENCES: AcceptedDivergence[] = [
  {
    skillId: 'jiangmen_hunv',
    detailId: 20009401,
    field: 'value',
    engine: 200,
    pkg: 190,
    reason:
      '官方文案为 200%，用户 2026-10-24 同批拍板 190 是旧值；tb_cfg_skill_detail 的 20009401 仍写 190，未随文案更新。以官方文案为准。',
    decided: '2026-10-24 用户拍板（见 AGENTS.md「受击触发动摇 unrest.onHurt」节）',
  },
  {
    skillId: 'jiangmen_hunv',
    detailId: 20009402,
    field: 'value',
    engine: 60,
    pkg: 35,
    reason:
      '官方文案为「引发一次动摇效果（伤害率60.0%）」；detail 表 20009402 写 35%，且该槽位带 available_round=1。以官方文案为准。',
    decided: '2026-10-24 用户拍板（见 AGENTS.md「受击触发动摇 unrest.onHurt」节）',
  },
];

/** 宽松相等：绝对 1e-6 或相对 1e-3（与 slotdiff 的 close 同口径） */
export function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  const d = Math.abs(a - b);
  return d <= 1e-6 || d <= 1e-3 * Math.max(Math.abs(a), Math.abs(b));
}

export interface DivergenceInput {
  skillId: string;
  detailId: number;
  field: DivergenceField;
  engine: number | null;
  pkg: number;
}

export interface DivergenceResult {
  verdict: Verdict;
  /** 命中的条目（accepted / stale）或规则（ignored） */
  entry?: AcceptedDivergence | IgnoreRule;
  note?: string;
}

function matchesIgnore(rule: IgnoreRule, input: DivergenceInput): boolean {
  const m = rule.match;
  if (m.skillPrefix && !input.skillId.startsWith(m.skillPrefix)) return false;
  if (m.skill && input.skillId !== m.skill) return false;
  if (m.detailPrefix !== undefined && Math.trunc(input.detailId / 100) !== m.detailPrefix) return false;
  if (m.effectId !== undefined) return false; // 需要机制码时才用，调用方未提供则跳过（保持保守）
  return true;
}

/**
 * 判定一条槽位差异该如何呈现。
 * - accepted：命中已裁定条目，且两侧值仍与记录一致 → 不报差异
 * - stale：命中条目但值变了 → 必须重新裁定，对拍要报警
 * - ignored：命中结构性不对等规则 → 不计入差异
 * - none：未命中，按真实差异处理
 */
export function checkDivergence(input: DivergenceInput): DivergenceResult {
  const entry = ACCEPTED_DIVERGENCES.find(
    (d) => d.skillId === input.skillId && d.detailId === input.detailId && d.field === input.field
  );
  if (entry) {
    const ok =
      sameNumber(entry.engine, input.engine) && sameNumber(entry.pkg, input.pkg);
    if (ok) return { verdict: 'accepted', entry };
    return {
      verdict: 'stale',
      entry,
      note:
        `例外已失效：登记时 引擎 ${entry.engine ?? '（无）'} / 包内 ${entry.pkg}，` +
        `现在 引擎 ${input.engine ?? '（无）'} / 包内 ${input.pkg} —— 需重新裁定`,
    };
  }
  const rule = IGNORE_RULES.find((r) => matchesIgnore(r, input));
  if (rule) return { verdict: 'ignored', entry: rule };
  return { verdict: 'none' };
}

/** 被忽略 / 已裁定 / 失效的条目摘要，供报告尾部展开 */
export function describeVerdicts(): string[] {
  const out: string[] = [];
  for (const r of IGNORE_RULES) {
    const key = r.match.skill ?? (r.match.skillPrefix ? `${r.match.skillPrefix}*` : JSON.stringify(r.match));
    out.push(`[ignored] ${key}：${r.reason}`);
  }
  for (const d of ACCEPTED_DIVERGENCES) {
    out.push(
      `[accepted] ${d.skillId} 槽 ${d.detailId} ${d.field}：引擎 ${d.engine ?? '（无）'} / 包内 ${d.pkg}` +
        ` —— ${d.reason}（${d.decided}）`
    );
  }
  return out;
}
