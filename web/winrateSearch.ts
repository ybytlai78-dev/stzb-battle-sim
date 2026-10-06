/**
 * 在对手池上做两段式胜率搜索。
 * ---------------------------------------------------------------------------
 * 粗筛用较少场次丢掉明显更差的候选，决赛对留下的方案打满场次。
 * 排序键默认是综合胜率；`rankBy: 'worst'` 时改按最差对手胜率（用户说要稳）。
 * 一次最多动两个空位：再多的空槽请用 match 参数指定，避免组合爆炸。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import { getHeroById } from './heroes';
import { mutualGroupOf } from './advisor/gate';
import { normalizePlan, PLAN_POSITIONS, type AdvisorPlan, type PlanPosition } from './advisor/types';
import { ratesIndistinguishable, type PoolMatchup } from './poolMatchup';

/** 每个空位粗筛时最多试多少个候选 */
export const MAX_PER_HOLE = 40;
/** 两个空位各自留下多少个再两两配对 */
export const PAIR_KEEP = 6;
/** 决赛最多留下几套 */
export const FINALISTS_MAX = 8;

/** 一个可填的战法位：unit = 槽位下标，index = 该将的第几个可学战法（0 或 1） */
export interface SkillHole {
  unit: number;
  index: number;
}

export type RankBy = 'winRate' | 'worst';

/** 综合胜率，或最差对手胜率 */
export function rankScore(m: Pick<PoolMatchup, 'winRate' | 'worst'>, rankBy: RankBy): number {
  return rankBy === 'worst' ? m.worst.winRate : m.winRate;
}

/**
 * 两套方案是不是「只换了一处」。
 * 一处 = 某一个槽位只换了武将，或只换了一个可学战法（替换 / 新增 / 去掉一个）。
 * 同一槽位又换将又换战法，算两处。
 */
export function singleChangeBetween(a: AdvisorPlan, b: AdvisorPlan): { ok: true; label: string } | { ok: false; reason: string } {
  const left = normalizePlan(a);
  const right = normalizePlan(b);
  if (left.slots.length !== 3 || right.slots.length !== 3) return { ok: false, reason: '两套方案都要有大营 / 中军 / 前锋' };
  const changes: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const x = left.slots[i];
    const y = right.slots[i];
    if (x.position !== y.position) return { ok: false, reason: '两套方案的站位顺序不一致' };
    const heroChanged = x.heroId !== y.heroId;
    const skillChanged = x.skillIds.join('|') !== y.skillIds.join('|');
    if (!heroChanged && !skillChanged && x.level === y.level) continue;
    if (x.level !== y.level) changes.push(`${x.position}等级`);
    if (heroChanged) changes.push(`${x.position}武将`);
    if (skillChanged) {
      const onlyOneSkill = skillDeltaSize(x.skillIds, y.skillIds) === 1;
      if (!onlyOneSkill) return { ok: false, reason: `${x.position}的可学战法一次动了不止一个` };
      changes.push(`${x.position}战法`);
    }
  }
  if (changes.length === 0) return { ok: false, reason: '两套方案没有差别' };
  if (changes.length > 1) return { ok: false, reason: `一次只能换一处，现在动了：${changes.join('、')}` };
  return { ok: true, label: changes[0] };
}

/** 对称差里「新增或去掉」的个数；替换一个 = 去掉 1 加上 1，仍算 1 处 */
function skillDeltaSize(a: string[], b: string[]): number {
  const left = [...a];
  const right = [...b];
  for (const id of a) {
    const at = right.indexOf(id);
    if (at >= 0) {
      right.splice(at, 1);
      left.splice(left.indexOf(id), 1);
    }
  }
  return Math.max(left.length, right.length);
}

/** 空着的可学战法位。显式 key（"0-1"）优先；否则按大营→前锋取前两个空位。 */
export function skillHoles(plan: AdvisorPlan, keys?: string[]): SkillHole[] {
  const p = normalizePlan(plan);
  if (keys?.length) {
    const holes: SkillHole[] = [];
    for (const key of keys) {
      const [u, i] = String(key).split('-').map((x) => Number(x));
      if (Number.isInteger(u) && Number.isInteger(i) && u >= 0 && u < p.slots.length && i >= 0 && i < 2) holes.push({ unit: u, index: i });
    }
    return holes.slice(0, 2);
  }
  const holes: SkillHole[] = [];
  p.slots.forEach((s, unit) => {
    for (let index = s.skillIds.length; index < 2; index += 1) holes.push({ unit, index });
  });
  return holes.slice(0, 2);
}

/** 把一个战法填进（或替换到）指定位，返回新方案 */
export function fillSkill(plan: AdvisorPlan, hole: SkillHole, skillId: string): AdvisorPlan {
  const base = normalizePlan(plan);
  const slots = base.slots.map((s) => ({ ...s, skillIds: [...s.skillIds] }));
  const ids = slots[hole.unit].skillIds;
  if (hole.index < ids.length) ids[hole.index] = skillId;
  else if (hole.index === ids.length) ids.push(skillId);
  slots[hole.unit] = { ...slots[hole.unit], skillIds: ids };
  return { ...base, slots };
}

/** 换掉某个站位的武将，战法原样保留 */
export function fillHero(plan: AdvisorPlan, unit: number, heroId: string): AdvisorPlan {
  const base = normalizePlan(plan);
  const slots = base.slots.map((s) => ({ ...s, skillIds: [...s.skillIds] }));
  slots[unit] = { ...slots[unit], heroId };
  return { ...base, slots };
}

/** 队内已经占着的战法。替换某一格时，那一格上的旧战法不算占用。 */
function takenSkills(plan: AdvisorPlan, hole?: SkillHole): Set<string> {
  const ids = new Set<string>();
  plan.slots.forEach((s, unit) => {
    s.skillIds.forEach((id, index) => {
      if (hole && hole.unit === unit && hole.index === index) return;
      ids.add(id);
    });
  });
  return ids;
}

function legalSkill(plan: AdvisorPlan, hole: SkillHole, skillId: string): boolean {
  if (!SKILL_REGISTRY[skillId]) return false;
  if (takenSkills(plan, hole).has(skillId)) return false;
  return true;
}

function legalHero(plan: AdvisorPlan, unit: number, heroId: string): boolean {
  if (!getHeroById(heroId)) return false;
  const others = plan.slots.filter((_, i) => i !== unit).map((s) => s.heroId);
  if (others.includes(heroId)) return false;
  const group = mutualGroupOf(heroId);
  if (group && others.some((id) => mutualGroupOf(id) === group)) return false;
  return true;
}

export interface SearchEval {
  (plan: AdvisorPlan, runsPerOpponent: number): Promise<PoolMatchup>;
}

export interface WinRateSearchOptions {
  base: AdvisorPlan;
  mode: 'skill' | 'hero';
  /** 战法模式：要填的位。缺省由 {@link skillHoles} 决定，调用方传进来。 */
  holes?: SkillHole[];
  /** 武将模式：要换的站位下标（最多 2 个） */
  heroUnits?: number[];
  candidateIds: string[];
  coarseRuns: number;
  finalRuns: number;
  finalists: number;
  rankBy: RankBy;
  signal?: AbortSignal;
  /** 报价时估的总场次，进度条分母用它 */
  totalBattles?: number;
  onProgress?: (done: number, total: number) => void;
  evalPlan: SearchEval;
}

export interface WinRateRow {
  label: string;
  plan: AdvisorPlan;
  matchup: PoolMatchup;
  tieWithBest: boolean;
  baseline?: boolean;
}

export interface WinRateSearchResult {
  rows: WinRateRow[];
  baseline: WinRateRow | null;
  battles: number;
  capped: boolean;
  rankBy: RankBy;
}

interface Draft {
  label: string;
  plan: AdvisorPlan;
  matchup?: PoolMatchup;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('已取消');
    err.name = 'AbortError';
    throw err;
  }
}

function skillLabel(plan: AdvisorPlan): string {
  return plan.slots
    .map((s) => {
      const hero = getHeroById(s.heroId)?.name ?? s.heroId;
      const skills = s.skillIds.map((id) => SKILL_REGISTRY[id]?.name ?? id).join('+') || '无战法';
      return `${hero}·${skills}`;
    })
    .join(' / ');
}

/**
 * 粗筛场次的上限估计（给报价用，不真跑）。
 * `candidates` = 每一侧候选人数，`holes` = 1 或 2。
 */
export function estimateWinRateBattles(opts: {
  opponents: number;
  candidates: number;
  holes: number;
  coarseRuns: number;
  finalRuns: number;
  finalists: number;
}): number {
  const per = Math.min(MAX_PER_HOLE, Math.max(0, opts.candidates));
  const holes = Math.min(2, Math.max(1, opts.holes));
  const screen = holes <= 1 ? per : per * holes;
  const pairs = holes <= 1 ? 0 : PAIR_KEEP * PAIR_KEEP;
  const coarse = screen + pairs;
  const finals = Math.min(FINALISTS_MAX, Math.max(1, opts.finalists)) + 1;
  return Math.max(1, opts.opponents) * (coarse * opts.coarseRuns + finals * opts.finalRuns);
}

/**
 * 两段式搜索。`evalPlan` 负责真打对手池。
 * 决赛数字才进榜；粗筛只用来决定谁留下。
 */
export async function runWinRateSearch(opts: WinRateSearchOptions): Promise<WinRateSearchResult> {
  const coarseRuns = Math.max(1, Math.floor(opts.coarseRuns));
  const finalRuns = Math.max(1, Math.floor(opts.finalRuns));
  const finalists = Math.min(FINALISTS_MAX, Math.max(1, Math.floor(opts.finalists)));
  const base = normalizePlan(opts.base);
  let battles = 0;
  let capped = false;
  let progress = 0;
  const bump = (runs: number): void => {
    battles += runs;
    progress += runs;
    opts.onProgress?.(progress, Math.max(opts.totalBattles ?? progress, 1));
  };

  const evalOne = async (plan: AdvisorPlan, runs: number): Promise<PoolMatchup> => {
    throwIfAborted(opts.signal);
    const m = await opts.evalPlan(plan, runs);
    const opponents = Math.max(1, m.opponents.length);
    bump(runs * opponents);
    return m;
  };

  const screenIds = opts.candidateIds.slice(0, MAX_PER_HOLE);
  if (opts.candidateIds.length > MAX_PER_HOLE) capped = true;

  let drafts: Draft[] = [];
  if (opts.mode === 'skill') {
    const holes = (opts.holes ?? []).slice(0, 2);
    if (!holes.length) throw new Error('没有可搜的战法空位。用 matchSlotKeys 指定要替换的槽（如 "0-1"），或先空出可学槽。');
    drafts = await screenSkills(base, holes, screenIds, coarseRuns, evalOne);
    if (holes.length === 2) {
      const paired = pairSkills(base, holes, drafts, screenIds, opts.rankBy);
      if (paired.length) drafts = await scoreDrafts(paired, coarseRuns, evalOne);
    }
  } else {
    const units = (opts.heroUnits ?? []).slice(0, 2);
    if (!units.length) throw new Error('没有指定要换的武将位');
    drafts = await screenHeroes(base, units, screenIds, coarseRuns, evalOne);
    if (units.length === 2) {
      const paired = pairHeroes(base, units, drafts, screenIds, opts.rankBy);
      if (paired.length) drafts = await scoreDrafts(paired, coarseRuns, evalOne);
    }
  }

  drafts = drafts.filter((d) => d.matchup);
  drafts.sort((a, b) => rankScore(b.matchup!, opts.rankBy) - rankScore(a.matchup!, opts.rankBy));
  const best = drafts[0]?.matchup;
  const kept = best
    ? drafts.filter((d) => {
        const m = d.matchup!;
        const worse = rankScore(m, opts.rankBy) + m.halfWidth < rankScore(best, opts.rankBy) - best.halfWidth;
        return !worse;
      })
    : [];
  const finalDrafts = (kept.length ? kept : drafts).slice(0, finalists);

  const rows: WinRateRow[] = [];
  for (const d of finalDrafts) {
    const matchup = await evalOne(d.plan, finalRuns);
    rows.push({ label: d.label, plan: d.plan, matchup, tieWithBest: false });
  }
  rows.sort((a, b) => rankScore(b.matchup, opts.rankBy) - rankScore(a.matchup, opts.rankBy));
  if (rows[0]) {
    for (const row of rows) row.tieWithBest = row !== rows[0] && ratesIndistinguishable(row.matchup, rows[0].matchup);
  }

  const baselineMatch = await evalOne(base, finalRuns);
  const baseline: WinRateRow = { label: '当前配置', plan: base, matchup: baselineMatch, tieWithBest: false, baseline: true };
  if (rows[0]) baseline.tieWithBest = ratesIndistinguishable(baseline.matchup, rows[0].matchup);

  return { rows, baseline, battles, capped, rankBy: opts.rankBy };
}

async function scoreDrafts(drafts: Draft[], runs: number, evalOne: (plan: AdvisorPlan, runs: number) => Promise<PoolMatchup>): Promise<Draft[]> {
  const out: Draft[] = [];
  for (const d of drafts) out.push({ ...d, matchup: await evalOne(d.plan, runs) });
  return out;
}

async function screenSkills(
  base: AdvisorPlan,
  holes: SkillHole[],
  ids: string[],
  runs: number,
  evalOne: (plan: AdvisorPlan, runs: number) => Promise<PoolMatchup>
): Promise<Draft[]> {
  const drafts: Draft[] = [];
  for (const hole of holes) {
    if (hole.index > base.slots[hole.unit].skillIds.length) continue;
    for (const id of ids) {
      if (!legalSkill(base, hole, id)) continue;
      const plan = fillSkill(base, hole, id);
      const name = SKILL_REGISTRY[id]?.name ?? id;
      drafts.push({ label: `${skillLabel(plan)}（试${name}）`, plan, matchup: await evalOne(plan, runs) });
    }
  }
  return drafts;
}

/** 粗筛草稿的排序分。还没打过的记 0。 */
function draftScore(d: Draft, rankBy: RankBy): number {
  return d.matchup ? rankScore(d.matchup, rankBy) : 0;
}

function pairSkills(base: AdvisorPlan, holes: SkillHole[], screened: Draft[], ids: string[], rankBy: RankBy): Draft[] {
  const top = (hole: SkillHole): string[] => {
    const rows = screened.filter((d) => d.plan.slots[hole.unit]?.skillIds[hole.index]);
    const ranked = [...rows].sort((a, b) => draftScore(b, rankBy) - draftScore(a, rankBy));
    const picked: string[] = [];
    for (const row of ranked) {
      const id = row.plan.slots[hole.unit].skillIds[hole.index];
      if (id && !picked.includes(id)) picked.push(id);
      if (picked.length >= PAIR_KEEP) break;
    }
    return picked.length ? picked : ids.slice(0, PAIR_KEEP);
  };
  const a = top(holes[0]);
  const b = top(holes[1]);
  const drafts: Draft[] = [];
  for (const x of a) {
    for (const y of b) {
      if (x === y) continue;
      if (!legalSkill(base, holes[0], x)) continue;
      const mid = fillSkill(base, holes[0], x);
      if (!legalSkill(mid, holes[1], y)) continue;
      const plan = fillSkill(mid, holes[1], y);
      drafts.push({ label: skillLabel(plan), plan });
    }
  }
  return drafts;
}

async function screenHeroes(
  base: AdvisorPlan,
  units: number[],
  ids: string[],
  runs: number,
  evalOne: (plan: AdvisorPlan, runs: number) => Promise<PoolMatchup>
): Promise<Draft[]> {
  const drafts: Draft[] = [];
  for (const unit of units) {
    for (const id of ids) {
      if (!legalHero(base, unit, id)) continue;
      const plan = fillHero(base, unit, id);
      drafts.push({ label: skillLabel(plan), plan, matchup: await evalOne(plan, runs) });
    }
  }
  return drafts;
}

function pairHeroes(base: AdvisorPlan, units: number[], screened: Draft[], ids: string[], rankBy: RankBy): Draft[] {
  const top = (unit: number): string[] => {
    const rows = screened.filter((d) => d.plan.slots[unit]?.heroId && d.plan.slots[unit].heroId !== base.slots[unit].heroId);
    const ranked = [...rows].sort((a, b) => draftScore(b, rankBy) - draftScore(a, rankBy));
    const picked: string[] = [];
    for (const row of ranked) {
      const id = row.plan.slots[unit].heroId;
      if (!picked.includes(id)) picked.push(id);
      if (picked.length >= PAIR_KEEP) break;
    }
    return picked.length ? picked : ids.slice(0, PAIR_KEEP);
  };
  const drafts: Draft[] = [];
  for (const x of top(units[0])) {
    for (const y of top(units[1])) {
      if (x === y) continue;
      if (!legalHero(base, units[0], x)) continue;
      const mid = fillHero(base, units[0], x);
      if (!legalHero(mid, units[1], y)) continue;
      drafts.push({ label: skillLabel(fillHero(mid, units[1], y)), plan: fillHero(mid, units[1], y) });
    }
  }
  return drafts;
}

/** 解析「要换的站位」：站位名或下标 */
export function heroUnitsOf(plan: AdvisorPlan, positions?: string[]): number[] {
  if (!positions?.length) return [];
  const p = normalizePlan(plan);
  const out: number[] = [];
  for (const raw of positions) {
    const asPos = PLAN_POSITIONS.indexOf(raw as PlanPosition);
    if (asPos >= 0) {
      out.push(asPos);
      continue;
    }
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < p.slots.length) out.push(n);
  }
  return [...new Set(out)].slice(0, 2);
}
