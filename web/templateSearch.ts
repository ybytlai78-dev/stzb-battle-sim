/**
 * 模板配将：先定模板，再配将，再搜战法。
 * ---------------------------------------------------------------------------
 * 每套模板用角色池生成站位，骨架战法粗筛后只留 3 套进战法搜索。
 * 标准队 / 半肉反击按对手池胜率排。法刀内部按三侍卫前三回合输出排，
 * 冠军再打 200 场，前三回合胜率不到 90% 不进最终比较。
 * 过线的冠军各打一遍对手池，综合胜率最高的是推荐。
 */
import type { General } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { cfgOf } from './advisor/gate';
import { normalizePlan, type AdvisorPlan, type DummySpec } from './advisor/types';
import { binomialHalfWidth, ratesIndistinguishable, type PoolMatchup } from './poolMatchup';
import { generalsOf } from './teamConfig';
import { applyDefense } from './defenseSystems';
import {
  ALL_TEMPLATES,
  LAYOUT_SIM_CAP,
  OPENERS,
  TEMPLATE_LABEL,
  buildPools,
  campNeedsOpener,
  layoutsFor,
  skeletonSkills,
  templatesForHero,
  type HeroRole,
  type RolePools,
  type TeamLayout,
  type TeamTemplateId,
} from './teamRoles';
import { estimateWinRateBattles, MAX_PER_HOLE, runWinRateSearch } from './winrateSearch';
import { getHeroById, isLearnableSkillListed, isMainSkill, SKILL_GRADES } from './heroes';
import { playOne } from './winRate';

/** 每套模板留下进战法搜索的站位数 */
export const LAYOUT_KEEP = 3;
/** 法刀及格：同一批三侍卫对局里前三回合胜率 */
export const BLADE_GATE = 0.9;
/** 法刀冠军卡及格线的场次 */
export const GUARD_GATE_RUNS = 200;
/** 法刀只打前三回合 */
export const GUARD_ROUNDS = 3;
/** 三侍卫 D 级战法的固定种子，不每次重随 */
export const BLADE_GUARD_SEED = 20261007;

const SKILL_ORDER = [1, 2, 0];
const ROLE_ZH: Record<HeroRole, string> = {
  campDps: '大营输出',
  support: '辅助',
  counterVan: '反击前锋',
  sustain: '续航',
  liaoEngine: '连击',
  burstBuff: '增伤拐',
  bladeCore: '输出核',
  shenSupport: '神赏拐',
};

/** 三侍卫一场的汇总。胜率口径与主站一致（斩首胜 + 优势平）。 */
export interface GuardScore {
  winRate: number;
  halfWidth: number;
  meanFirst3: number;
  runs: number;
}

export interface TemplateChampion {
  template: TeamTemplateId;
  label: string;
  plan: AdvisorPlan | null;
  roleLine: string;
  reason?: string;
  /** `null` = 这套没跑成。法刀没过 90% 为 `false`。 */
  passedGate: boolean | null;
  guardWinRate?: number;
  meanFirst3?: number;
  matchup?: PoolMatchup;
}

export interface TemplateSearchResult {
  champions: TemplateChampion[];
  /** 区间重叠时不硬排，这里是 null */
  recommended: TemplateChampion | null;
  tied: boolean;
  battles: number;
  note?: string;
}

export interface TemplateSearchOptions {
  heroIds: string[];
  skillIds: string[];
  templates?: TeamTemplateId[];
  lockHeroId?: string;
  dummy: DummySpec;
  level?: number;
  coarseRuns: number;
  finalRuns: number;
  /** 法刀内部粗筛场次。缺省用 {@link coarseRuns}。 */
  guardCoarseRuns?: number;
  guardGateRuns?: number;
  /** 点名武将必须携带的可学战法（最多 2 个）。该格不再搜。 */
  lockSkillIds?: string[];
  /** 每个战法格最多试多少个。缺省 40。预算不够时由报价收小，搜索用同一个数。 */
  skillCap?: number;
  /** 进度条分母。缺省用已经跑过的场次。 */
  totalBattles?: number;
  seed: number;
  signal?: AbortSignal;
  matchup: (plan: AdvisorPlan, runsPerOpponent: number) => Promise<PoolMatchup>;
  /** 缺省打固定三侍卫。测试注入假对打。 */
  guards?: (plan: AdvisorPlan, runs: number) => Promise<GuardScore>;
  onProgress?: (done: number, total: number) => void;
}

/**
 * 报价用的上限，按真正会打的场次估。
 * 战法搜索的决赛用粗筛场次；只有每套冠军打对手池时才用 `finalRuns`。
 */
export function estimateTemplateBattles(opts: {
  templates: number;
  opponents: number;
  candidates: number;
  coarseRuns: number;
  finalRuns: number;
}): number {
  const opponents = Math.max(1, opts.opponents);
  const templates = Math.max(1, opts.templates);
  const coarse = Math.max(1, opts.coarseRuns);
  const oneSkill = estimateWinRateBattles({
    opponents,
    candidates: Math.min(MAX_PER_HOLE, Math.max(0, opts.candidates)),
    holes: 2,
    coarseRuns: coarse,
    finalRuns: coarse,
    finalists: 4,
  });
  const screen = (LAYOUT_SIM_CAP + LAYOUT_KEEP) * coarse * opponents;
  const skills = LAYOUT_KEEP * SKILL_ORDER.length * oneSkill;
  const tail = opts.finalRuns * opponents + GUARD_GATE_RUNS;
  return templates * (screen + skills + tail);
}

/**
 * 把粗筛场次和每格候选收到本轮剩余场次装得下。
 * 候选不低于 8，粗筛不低于 4；再不够就原样返回，让调用方拒绝。
 */
export function fitTemplateBudget(opts: {
  templates: number;
  opponents: number;
  candidates: number;
  coarseRuns: number;
  finalRuns: number;
  remaining: number;
}): { coarseRuns: number; candidates: number; est: number; shrunk: boolean } {
  let candidates = Math.min(MAX_PER_HOLE, Math.max(0, opts.candidates));
  let coarseRuns = Math.max(1, opts.coarseRuns);
  const quote = (): number =>
    estimateTemplateBattles({
      templates: opts.templates,
      opponents: opts.opponents,
      candidates,
      coarseRuns,
      finalRuns: opts.finalRuns,
    });
  let est = quote();
  const started = { candidates, coarseRuns };
  while (est > opts.remaining && candidates > 8) {
    candidates = Math.max(8, Math.floor(candidates / 2));
    est = quote();
  }
  while (est > opts.remaining && coarseRuns > 4) {
    coarseRuns = Math.max(4, Math.floor(coarseRuns / 2));
    est = quote();
  }
  return { coarseRuns, candidates, est, shrunk: candidates !== started.candidates || coarseRuns !== started.coarseRuns };
}

let cachedGuards: General[] | null = null;

/**
 * 三名会还手的侍卫。防御 200、谋略 150、兵力 9000，攻击 82、速度 58 沿用亲卫默认。
 * 三人共用同一组固定种子抽出的 D 级战法。
 */
export function bladeGuardTeam(): General[] {
  if (cachedGuards) return cachedGuards;
  const pool = Object.keys(SKILL_REGISTRY)
    .filter((id) => SKILL_GRADES[id] === 'D' && !isMainSkill(id) && isLearnableSkillListed(id))
    .sort();
  const skillIds = new Rng(BLADE_GUARD_SEED).pickN(pool, 3);
  const positions: General['position'][] = ['大营', '中军', '前锋'];
  cachedGuards = positions.map((position, i) => {
    const g: General = {
      id: `blade-guard-${i}`,
      name: '侍卫',
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position,
      attack: 82,
      defense: 200,
      strategy: 150,
      speed: 58,
      attackRange: 2,
      maxTroops: 9000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 120,
    };
    for (const id of skillIds) {
      const s = SKILL_REGISTRY[id];
      if (!s) continue;
      if (s.type === 'active') g.activeSkillIds.push(id);
      else if (s.type === 'passive') g.passiveSkillIds.push(id);
      else if (s.type === 'command') g.commandSkillIds.push(id);
      else g.pursuitSkillIds.push(id);
    }
    return g;
  });
  return cachedGuards;
}

/**
 * 打三侍卫 `runs` 场，只打 {@link GUARD_ROUNDS} 回合，不交换场地。
 */
export function evalBladeGuards(plan: AdvisorPlan, runs: number, seed: number): GuardScore {
  const my = generalsOf(cfgOf(plan), 120);
  const enemy = bladeGuardTeam();
  const n = Math.max(0, Math.floor(runs));
  let win = 0;
  let first3 = 0;
  for (let i = 0; i < n; i++) {
    const played = playOne(my, enemy, seed + i, GUARD_ROUNDS, false);
    if (played.bucket === 'win') win += 1;
    first3 += played.first3;
  }
  const winRate = n > 0 ? win / n : 0;
  return { winRate, halfWidth: binomialHalfWidth(winRate, n), meanFirst3: n > 0 ? first3 / n : 0, runs: n };
}

function isBlade(id: TeamTemplateId): boolean {
  return id === 'blade' || id === 'shenshang';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('已取消');
    err.name = 'AbortError';
    throw err;
  }
}

function tallyOf(m: PoolMatchup, asked: number): number {
  if (m.battles > 0) return m.battles;
  return asked * Math.max(1, m.opponents?.length ?? 1);
}

function asMatchup(g: GuardScore, seed: number): PoolMatchup {
  const win = Math.round(g.winRate * g.runs);
  const row = {
    id: 'guards',
    note: '三侍卫',
    source: 'benchmark' as const,
    runs: g.runs,
    win,
    draw: 0,
    loss: Math.max(0, g.runs - win),
    winRate: g.winRate,
    halfWidth: g.halfWidth,
    meanTotal: g.meanFirst3,
    meanFirst3: g.meanFirst3,
    controlMine: 0,
  };
  return {
    version: 'blade-guard',
    fingerprint: '三侍卫',
    baseSeed: seed,
    runsPerOpponent: g.runs,
    opponents: [row],
    runs: g.runs,
    win,
    draw: 0,
    loss: row.loss,
    winRate: g.winRate,
    halfWidth: g.halfWidth,
    meanTotal: g.meanFirst3,
    meanFirst3: g.meanFirst3,
    controlMine: 0,
    worst: { id: 'guards', note: '三侍卫', winRate: g.winRate },
    battles: g.runs,
    ms: 0,
  };
}

function planFrom(layout: TeamLayout, skills: string[][], dummy: DummySpec, level: number): AdvisorPlan {
  const core = layout.template === 'counter' ? layout.slots[2].heroId : layout.slots[0].heroId;
  return normalizePlan({
    slots: layout.slots.map((s, i) => ({
      position: s.position,
      heroId: s.heroId,
      level,
      skillIds: skills[i] ?? [],
    })),
    coreUnitIds: [core],
    dummy,
  });
}

function roleLine(layout: TeamLayout, plan: AdvisorPlan): string {
  return plan.slots
    .map((s, i) => {
      const hero = getHeroById(s.heroId)?.name ?? s.heroId;
      const skills = s.skillIds.map((id) => SKILL_REGISTRY[id]?.name ?? id).join('+') || '无战法';
      const role = ROLE_ZH[layout.slots[i]?.role] ?? '';
      return `${s.position}${hero}（${role}）${skills}`;
    })
    .join(' / ');
}

function emptyChampion(template: TeamTemplateId, reason: string): TemplateChampion {
  return { template, label: TEMPLATE_LABEL[template], plan: null, roleLine: '', reason, passedGate: null };
}

/**
 * 跑能凑齐的模板。`lockHeroId` 只跑该将能进的模板，并锁在对应格子上。
 */
export async function runTemplateSearch(opts: TemplateSearchOptions): Promise<TemplateSearchResult> {
  const level = opts.level ?? 40;
  const coarse = Math.max(1, Math.floor(opts.coarseRuns));
  const finals = Math.max(1, Math.floor(opts.finalRuns));
  const guardCoarse = Math.max(1, Math.floor(opts.guardCoarseRuns ?? coarse));
  const gateRuns = Math.max(1, Math.floor(opts.guardGateRuns ?? GUARD_GATE_RUNS));
  const rawGuards = opts.guards ?? ((plan, runs) => Promise.resolve(evalBladeGuards(plan, runs, opts.seed)));
  let battles = 0;
  const locks = (opts.lockSkillIds ?? []).filter(Boolean).slice(0, 2);
  const skillCap = Math.min(MAX_PER_HOLE, Math.max(1, Math.floor(opts.skillCap ?? MAX_PER_HOLE)));
  const bump = (n: number): void => {
    battles += n;
    opts.onProgress?.(battles, Math.max(opts.totalBattles ?? battles, 1));
  };

  const requested = opts.templates?.length
    ? opts.templates
    : opts.lockHeroId
      ? templatesForHero(opts.lockHeroId, opts.heroIds, opts.skillIds)
      : ALL_TEMPLATES;
  if (!requested.length) {
    return { champions: [], recommended: null, tied: false, battles: 0, note: '点名的武将进不了任何模板' };
  }

  const champions: TemplateChampion[] = [];
  for (const template of requested) {
    throwIfAborted(opts.signal);
    champions.push(await searchOne(template));
  }

  const contenders = champions.filter((c) => c.plan && c.passedGate === true);
  for (const c of contenders) {
    throwIfAborted(opts.signal);
    const m = await opts.matchup(c.plan!, finals);
    bump(tallyOf(m, finals));
    c.matchup = m;
  }
  contenders.sort((a, b) => b.matchup!.winRate - a.matchup!.winRate);
  const top = contenders[0] ?? null;
  const tied = Boolean(top && contenders.slice(1).some((c) => ratesIndistinguishable(c.matchup!, top.matchup!)));
  return { champions, recommended: tied ? null : top, tied, battles };

  async function searchOne(template: TeamTemplateId): Promise<TemplateChampion> {
    const { layouts, reason } = layoutsFor(template, opts.heroIds, opts.skillIds, opts.lockHeroId);
    if (!layouts.length) return emptyChampion(template, reason ?? '凑不出合法站位');
    const pools = buildPools(opts.heroIds, opts.skillIds);
    const ready = layouts.flatMap((layout) => {
      const dressed = applyDefense(layout, opts.skillIds, {
        poolHeroIds: opts.heroIds,
        level,
        ...(opts.lockHeroId ? { lockHeroId: opts.lockHeroId } : {}),
        ...(locks.length ? { lockSkillIds: locks } : {}),
      });
      const skills = skeletonSkills(dressed, pools);
      if (!skills || skills.some((row) => row.length < 1)) return [];
      return [{ layout: dressed, plan: stampLockedSkills(planFrom(dressed, skills, opts.dummy, level), opts.lockHeroId, locks) }];
    });
    if (!ready.length) return emptyChampion(template, '没有可用的骨架战法');

    const scored: Array<{ layout: TeamLayout; plan: AdvisorPlan; score: number }> = [];
    for (const item of ready) {
      throwIfAborted(opts.signal);
      scored.push({ ...item, score: await scoreOf(template, item.plan) });
    }
    scored.sort((a, b) => b.score - a.score || b.layout.score - a.layout.score);
    const kept = scored.slice(0, LAYOUT_KEEP);

    const finished: Array<{ layout: TeamLayout; plan: AdvisorPlan; score: number }> = [];
    for (const item of kept) {
      throwIfAborted(opts.signal);
      const plan = await fillSkills(template, item.layout, item.plan, pools);
      finished.push({ layout: item.layout, plan, score: await scoreOf(template, plan) });
    }
    finished.sort((a, b) => b.score - a.score || b.layout.score - a.layout.score);
    const winner = finished[0];
    const champ: TemplateChampion = {
      template,
      label: TEMPLATE_LABEL[template],
      plan: winner.plan,
      roleLine: [winner.layout.defenseNote, roleLine(winner.layout, winner.plan)].filter(Boolean).join('。'),
      passedGate: true,
    };
    if (!isBlade(template)) return champ;
    const gate = await rawGuards(winner.plan, gateRuns);
    bump(gate.runs);
    champ.guardWinRate = gate.winRate;
    champ.meanFirst3 = gate.meanFirst3;
    champ.passedGate = gate.winRate + 1e-9 >= BLADE_GATE;
    if (!champ.passedGate) champ.reason = '未过及格线';
    return champ;
  }

  async function scoreOf(template: TeamTemplateId, plan: AdvisorPlan): Promise<number> {
    if (isBlade(template)) {
      const g = await rawGuards(plan, guardCoarse);
      bump(g.runs);
      return g.meanFirst3;
    }
    const m = await opts.matchup(plan, coarse);
    bump(tallyOf(m, coarse));
    return m.winRate;
  }

  async function fillSkills(template: TeamTemplateId, layout: TeamLayout, base: AdvisorPlan, pools: RolePools): Promise<AdvisorPlan> {
    const blade = isBlade(template);
    const evalPlan = async (plan: AdvisorPlan, runs: number): Promise<PoolMatchup> => {
      if (!blade) return opts.matchup(plan, runs);
      return asMatchup(await rawGuards(plan, runs), opts.seed);
    };
    const stageCoarse = blade ? guardCoarse : coarse;
    const stageFinal = stageCoarse;
    let current = base;
    for (const unit of SKILL_ORDER) {
      throwIfAborted(opts.signal);
      const slot = layout.slots[unit];
      if (!slot || slot.lockedSkillIds?.length) continue;
      if (opts.lockHeroId && slot.heroId === opts.lockHeroId && locks.length) continue;
      const holes = holesFor(layout, unit, current);
      if (!holes.length) continue;
      const candidates = candidatesFor(layout, unit, pools).slice(0, skillCap);
      if (!candidates.length) continue;
      const searched = await runWinRateSearch({
        base: current,
        mode: 'skill',
        holes,
        candidateIds: candidates,
        coarseRuns: stageCoarse,
        finalRuns: stageFinal,
        finalists: 4,
        rankBy: 'winRate',
        ...(blade ? { scoreOf: (m: PoolMatchup) => m.meanFirst3 } : {}),
        signal: opts.signal,
        evalPlan,
      });
      bump(searched.battles);
      const best = searched.rows[0];
      const base = searched.baseline;
      const bestScore = best ? (blade ? best.matchup.meanFirst3 : best.matchup.winRate) : -1;
      const baseScore = base ? (blade ? base.matchup.meanFirst3 : base.matchup.winRate) : -1;
      if (best && bestScore >= baseScore) current = best.plan;
    }
    return current;
  }
}

/** 点名武将的格子换成他指定的战法。没指定就原样返回。 */
function stampLockedSkills(plan: AdvisorPlan, heroId: string | undefined, skillIds: string[]): AdvisorPlan {
  if (!heroId || !skillIds.length) return plan;
  return {
    ...plan,
    slots: plan.slots.map((s) => (s.heroId === heroId ? { ...s, skillIds: skillIds.slice(0, 2) } : s)),
  };
}

function openerCamp(layout: TeamLayout, unit: number): boolean {
  const slot = layout.slots[unit];
  return layout.template === 'shenshang' && slot?.position === '大营' && campNeedsOpener(slot.heroId);
}

/**
 * 还能搜的可学槽。锁满的格子、已钉住的体系战法、神赏大营的先手件都不换。
 * @param layout 带防守体系的站位
 * @param unit 武将下标
 * @param plan 当前方案
 */
function holesFor(layout: TeamLayout, unit: number, plan: AdvisorPlan): Array<{ unit: number; index: number }> {
  const slot = layout.slots[unit];
  if (!slot || slot.lockedSkillIds?.length) return [];
  const pinned = new Set(slot.pinnedSkillIds ?? []);
  const ids = plan.slots[unit]?.skillIds ?? [];
  const holes: Array<{ unit: number; index: number }> = [];
  for (let index = 0; index < 2; index += 1) {
    const id = ids[index];
    if (id && pinned.has(id)) continue;
    if (index === 0 && openerCamp(layout, unit) && id && (OPENERS as readonly string[]).includes(id)) continue;
    holes.push({ unit, index });
  }
  return holes;
}

function candidatesFor(layout: TeamLayout, unit: number, pools: RolePools): string[] {
  const slot = layout.slots[unit];
  if (!slot) return [];
  const blocked = new Set(layout.blockSkillIds ?? []);
  const raw = openerCamp(layout, unit)
    ? pools.skills.dps.filter((id) => !(OPENERS as readonly string[]).includes(id))
    : pools.skills[slot.skillKind];
  return raw.filter((id) => !blocked.has(id));
}
