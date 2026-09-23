/**
 * 组合优化器（L3）：用 L2 的解析期望模型当代价函数，搜索
 *   ① 战法最优解 —— 给定队伍，为指定武将搜索 N 个战法槽的最佳搭配（束搜索 beam search）
 *   ② 队友最佳搭配 —— 固定输出将，扫描候选队友（单挑扫一遍 → 取 top K 再枚举双人组合）
 *
 * 目标函数：**前三回合总伤**（E[回合 1..3 伤害] 之和，口径同 L2：不含控制/规避/兵力截断）。
 * 搜索必然依赖近似，所以每步都保留「束」而不是贪心单链：beam 越宽越稳（代价线性）。
 *
 * 为什么快：单个组合评估 = simulateRounds(3 回合) ≈ 0.2ms（引擎 calcDamage 直采、战法解析结果缓存）。
 * beam=24、候选≈200、2 槽 × 3 将 ≈ 29k 次评估 ≈ 6s，页面按步让出主线程显示进度。
 */
import { SKILL_REGISTRY } from '../src/data/skills';
import type { TroopType } from '../src/engine/types';
import { baseStatsAt, HERO_RECORDS, isLearnableSkillListed, isMainSkill, troopCapacity } from './heroes';
import { parseSkill, simulateRounds, type ParseContext, type ParsedSkill, type RoundUnit } from './roundModel';
import { unitParseContext, unitTemplates, type UnitTemplate, type ViewCfg } from './teamConfig';

// ─────────────────────── 候选池 ───────────────────────

const parsedCache = new Map<string, ParsedSkill>();

/** 战法解析结果缓存（按 战法 × 士气 × 上下文 缓存；搜索里同一战法会被评估上万次） */
export function parsedSkill(id: string, morale: number, ctx: ParseContext = {}): ParsedSkill | undefined {
  const key = `${id}@${morale}@${ctxKey(ctx)}`;
  const hit = parsedCache.get(key);
  if (hit) return hit;
  const skill = SKILL_REGISTRY[id];
  if (!skill) return undefined;
  const parsed = parseSkill(skill, morale, ctx);
  parsedCache.set(key, parsed);
  return parsed;
}

/** 上下文 → 缓存 key（顺序稳定） */
function ctxKey(ctx: ParseContext): string {
  return [
    ctx.casterName ?? '',
    ctx.casterFaction ?? '',
    ctx.casterPosition ?? '',
    (ctx.teamFactions ?? []).join('/'),
    (ctx.teamTroops ?? []).join('/'),
    (ctx.teamGenders ?? []).join('/'),
    ctx.enemyMorale ?? '',
  ].join('|');
}

/** 该战法在本模型口径下是否有输出贡献（伤害段 / 持续伤害 / 增减伤·属性·连击·发动率修正） */
export function hasContribution(id: string, morale: number): boolean {
  const p = parsedSkill(id, morale);
  if (!p) return false;
  return (
    p.segments.length > 0 ||
    p.dots.length > 0 ||
    p.effects.some((e) => e.value !== 0 || e.scaledBase !== undefined)
  );
}

export interface CandidatePool {
  /** 严格池（默认）：有输出贡献 且 没有未建模字段 —— 搜索排名可信 */
  strict: string[];
  /** 有输出贡献（含部分建模，排名仅供参考） */
  contributing: string[];
  /** 全量注册表 */
  all: string[];
  /** 被严格池排除的「部分建模」战法及原因 */
  excluded: Array<{ id: string; name: string; notes: string[] }>;
}

/** 未建模字段清单（战法级 / 段级 / 状态级任一）——近似处理（approx）不算未建模 */
export function unmodeledNotes(id: string, morale: number): string[] {
  const p = parsedSkill(id, morale);
  if (!p) return ['战法不存在'];
  return [
    ...new Set([
      ...p.unmodeled,
      ...p.segments.flatMap((s) => s.unmodeled),
      ...p.dots.flatMap((d) => d.unmodeled),
      ...p.effects.flatMap((e) => e.unmodeled),
    ]),
  ];
}

/** 近似处理清单（模型算了、但用了简化口径）——不影响严格池资格，只在 UI 提示 */
export function approximationNotes(id: string, morale: number): string[] {
  const p = parsedSkill(id, morale);
  if (!p) return [];
  return [
    ...new Set([
      ...p.segments.flatMap((s) => s.approx ?? []),
      ...p.effects.flatMap((e) => e.approx ?? []),
      ...p.dots.flatMap((d) => d.approx ?? []),
    ]),
  ];
}

/** 该战法是否被模型完整覆盖（无未建模字段） */
export function isFullyModeled(id: string, morale: number): boolean {
  return unmodeledNotes(id, morale).length === 0;
}

const poolCache = new Map<number, CandidatePool>();

/**
 * 候选池三档（按士气缓存）。
 * 底座 = **可学习战法**（排除武将主战法——主战法不能被别的武将学，这是率土的装备规则）。
 *  strict        可学习 + 已上架 + 有输出贡献 + 无未建模字段（默认：排名可信）
 *  contributing  可学习 + 有输出贡献（含部分建模，排名仅供参考）
 *  all           全部可学习战法
 */
export function candidatePool(morale: number): CandidatePool {
  const hit = poolCache.get(morale);
  if (hit) return hit;
  const learnable = Object.keys(SKILL_REGISTRY).filter((id) => !isMainSkill(id));
  const contributing = learnable.filter((id) => hasContribution(id, morale));
  const strict = contributing.filter((id) => isLearnableSkillListed(id) && isFullyModeled(id, morale));
  const excluded = contributing
    .filter((id) => !isFullyModeled(id, morale) || !isLearnableSkillListed(id))
    .map((id) => ({
      id,
      name: parsedSkill(id, morale)?.name ?? id,
      notes: isLearnableSkillListed(id) ? unmodeledNotes(id, morale) : ['未上架（成长率待补）'],
    }));
  const pool: CandidatePool = { strict, contributing, all: learnable, excluded };
  poolCache.set(morale, pool);
  return pool;
}

// ─────────────────────── 评估 ───────────────────────

export interface Env {
  enemy: { defense: number; strategy: number; troopType: TroopType };
  morale: number;
}

/** 把单位模板 + 每将战法选择 组装成可结算单位 */
export function toUnits(
  templates: UnitTemplate[],
  picks: Record<number, string[]>,
  env: Env,
  cfg: ViewCfg
): RoundUnit[] {
  return templates.map((t, i) => ({
    id: t.id,
    name: t.name,
    heroId: t.heroId,
    attack: t.attack,
    strategy: t.strategy,
    defense: t.defense,
    speed: t.speed,
    troops: t.troops,
    troopType: t.troopType,
    skills: [t.mainSkillId, ...(picks[i] ?? [])]
      .filter((v): v is string => Boolean(v))
      .map((id) => parsedSkill(id, env.morale, unitParseContext(cfg, i)))
      .filter((v): v is ParsedSkill => Boolean(v)),
  }));
}

export interface Evaluator {
  /** 目标口径总伤（默认前三回合；objectiveRounds 可设 8 = 整局） */
  score(picks: Record<number, string[]>): number;
  /** 兼容别名（= score，历史口径「前三回合总伤」） */
  first3(picks: Record<number, string[]>): number;
  /** 完整 cfg.rounds 回合结果（展示用） */
  full(picks: Record<number, string[]>): ReturnType<typeof simulateRounds>;
  /** 目标口径回合数 */
  objectiveRounds: number;
  count: number;
}

/** objectiveRounds：目标口径回合数（3 = 前三回合，8 = 整局） */
export function makeEvaluator(cfg: ViewCfg, objectiveRounds = 3): Evaluator {
  const templates = unitTemplates(cfg);
  const env: Env = { enemy: cfg.enemy, morale: cfg.morale };
  const rounds = Math.max(1, Math.min(objectiveRounds, cfg.rounds));
  const score = (picks: Record<number, string[]>): number => {
    evaluator.count += 1;
    return simulateRounds({
      units: toUnits(templates, picks, env, cfg),
      enemy: env.enemy,
      morale: env.morale,
      rounds,
    }).total;
  };
  const evaluator: Evaluator = {
    count: 0,
    objectiveRounds: rounds,
    score,
    first3: score,
    full(picks) {
      evaluator.count += 1;
      return simulateRounds({
        units: toUnits(templates, picks, env, cfg),
        enemy: env.enemy,
        morale: env.morale,
        rounds: cfg.rounds,
      });
    },
  };
  return evaluator;
}

// ─────────────────────── 束搜索（战法最优解）───────────────────────

export interface LoadoutState {
  /** 与 unitIdxs 对齐：picks[u] = 该将已选战法 */
  picks: Record<number, string[]>;
  /** 目标口径总伤（3 = 前三回合，8 = 整局） */
  score: number;
}

export interface SearchOptions {
  /** 参与优化的武将下标 */
  unitIdxs: number[];
  /** 每个参与优化的武将搜索几个槽 */
  slots: number;
  /** 候选战法 id */
  candidates: string[];
  /** 束宽（保留前 N 个中间态） */
  beam: number;
  /** 返回前 N 个结果 */
  top: number;
  /** 目标口径回合数：3 = 前三回合，8 = 整局（缺省 3） */
  rounds?: number;
}

export interface SearchReport {
  results: LoadoutState[];
  /** 槽位替换建议（对最优解逐槽试遍候选，报告第一名以外的可选项） */
  alternatives: Array<{ unitIdx: number; slot: number; skillId: string; score: number; delta: number }>;
  evaluated: number;
  steps: number;
}

export interface Progress {
  step: number;
  steps: number;
  evaluated: number;
  bestSoFar: number;
}

const keyOf = (picks: Record<number, string[]>): string =>
  Object.keys(picks)
    .sort()
    .map((k) => `${k}:${[...picks[Number(k)]].sort().join(',')}`)
    .join('|');

/**
 * 逐槽束搜索（生成器版）：按 (槽位, 武将) 顺序逐个决定带什么战法，每步只保留前 `beam` 个中间态。
 * 代价 = steps × beam × |candidates|，而不是 |candidates|^(槽数×将数)。
 * 约束：**同一战法整队只能带一次**（率土规则：同队战法不可重复），主战法也占位。
 * 每完成一步 yield 一次进度 —— 页面据此让出主线程（await 一次）避免长任务冻界面。
 */
export function* searchLoadoutsSteps(
  cfg: ViewCfg,
  options: SearchOptions
): Generator<Progress, SearchReport, void> {
  const evaluator = makeEvaluator(cfg, options.rounds ?? 3);
  const templates = unitTemplates(cfg);
  const { unitIdxs, slots, candidates, beam, top } = options;

  /** 主战法占位（任何单位的自身主战法都不能被别的单位再带一次） */
  const mainSkills = new Set(templates.map((t) => t.mainSkillId).filter((v): v is string => Boolean(v)));
  /** 该战法是否已被队伍里任何人占用（含主战法） */
  const usedAnywhere = (picks: Record<number, string[]>, id: string): boolean => {
    if (mainSkills.has(id)) return true;
    return Object.keys(picks).some((k) => (picks[Number(k)] ?? []).includes(id));
  };

  // 非搜索单位的战法取用户手选；搜索单位从空槽开始
  const fixed: Record<number, string[]> = {};
  cfg.slots.forEach((s, i) => {
    fixed[i] = unitIdxs.includes(i) ? [] : [...s.skillIds];
  });

  let frontier: LoadoutState[] = [{ picks: { ...fixed }, score: evaluator.score({ ...fixed }) }];
  const steps = slots * unitIdxs.length;
  let step = 0;
  let bestSoFar = frontier[0].score;

  for (let slot = 0; slot < slots; slot += 1) {
    for (const unitIdx of unitIdxs) {
      const previous = frontier;
      const next = new Map<string, LoadoutState>();
      for (const state of frontier) {
        for (const id of candidates) {
          // 整队唯一：已被任何单位（含主战法）占用的战法不能再带
          if (usedAnywhere(state.picks, id)) continue;
          const picks: Record<number, string[]> = { ...state.picks };
          picks[unitIdx] = [...(state.picks[unitIdx] ?? []), id];
          const k = keyOf(picks);
          if (next.has(k)) continue;
          next.set(k, { picks, score: evaluator.score(picks) });
        }
      }
      frontier = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beam);
      if (frontier.length === 0) {
        // 候选不足以填满全部槽位（整队唯一约束下无解）→ 保留上一步的最优态，不再扩展本步
        frontier = previous.length ? previous : [];
      }
      step += 1;
      bestSoFar = Math.max(bestSoFar, frontier[0]?.score ?? 0);
      yield { step, steps, evaluated: evaluator.count, bestSoFar };
    }
  }

  const best = frontier[0];
  const alternatives: SearchReport['alternatives'] = [];
  if (best) {
    for (const unitIdx of unitIdxs) {
      for (let slot = 0; slot < slots; slot += 1) {
        const current = best.picks[unitIdx]?.[slot];
        if (!current) continue;
        for (const id of candidates) {
          if (id === current || usedAnywhere(best.picks, id)) continue;
          const picks: Record<number, string[]> = { ...best.picks };
          picks[unitIdx] = [...best.picks[unitIdx]];
          picks[unitIdx][slot] = id;
          const value = evaluator.score(picks);
          if (value >= best.score) continue;
          alternatives.push({ unitIdx, slot, skillId: id, score: value, delta: value - best.score });
        }
      }
    }
  }
  const bySkill = new Map<string, SearchReport['alternatives'][number]>();
  for (const alt of alternatives) {
    const key = `${alt.unitIdx}-${alt.slot}`;
    const prev = bySkill.get(key);
    if (!prev || alt.score > prev.score) bySkill.set(key, alt);
  }

  return {
    results: frontier.slice(0, top),
    alternatives: [...bySkill.values()].sort((a, b) => b.delta - a.delta),
    evaluated: evaluator.count,
    steps,
  };
}

/** 同步版（脚本 / 测试用）：跑完整个生成器并回调进度 */
export function searchLoadouts(
  cfg: ViewCfg,
  options: SearchOptions,
  onProgress?: (p: Progress) => void
): SearchReport {
  const iterator = searchLoadoutsSteps(cfg, options);
  let step = iterator.next();
  while (!step.done) {
    onProgress?.(step.value);
    step = iterator.next();
  }
  return step.value;
}

// ─────────────────────── 队友搭配 ───────────────────────

export interface TeammateSearchOptions {
  /** 候选队友武将 id 池 */
  pool: string[];
  /** 单将粗筛保留数（进入两两枚举） */
  keep: number;
  /** 返回前 N */
  top: number;
  /** 目标口径回合数：3 = 前三回合，8 = 整局（缺省 3） */
  rounds?: number;
}

export interface TeammateResult {
  /** 两名候选队友（武将 id） */
  heroIds: string[];
  /** 目标口径总伤 */
  score: number;
  /** 单将粗筛成绩（该队友单独上场时的目标口径总伤，用于显示增量） */
  singleScores: number[];
}

/**
 * 队友搭配搜索：固定输出将（slot 0，带其当前战法），用候选池里的武将替换 slot 1 / 2。
 * 两阶段：① 单队友扫描（只比总伤排序，作粗筛）→ ② 取前 keep 名两两组合精算。
 * 队友只带**自身主战法**（不做队友战法搜索，那是「战法最优解」模式的事）。
 */
export function searchTeammates(
  cfg: ViewCfg,
  options: TeammateSearchOptions,
  onProgress?: (p: Progress) => void
): { results: TeammateResult[]; evaluated: number } {
  const templates = unitTemplates(cfg);
  const env: Env = { enemy: cfg.enemy, morale: cfg.morale };
  const rounds = Math.max(1, Math.min(options.rounds ?? 3, cfg.rounds));
  const output = toUnits(templates, { 0: cfg.slots[0].skillIds, 1: [], 2: [] }, env, cfg)[0];
  const heroUnit = (heroId: string, index: number): RoundUnit => {
    const rec = HERO_RECORDS[heroId];
    const base = rec ? baseStatsAt(rec, 40) : { attack: 100, defense: 100, strategy: 100, speed: 50 };
    return {
      id: `t${index}`,
      name: rec?.name ?? heroId,
      heroId,
      attack: base.attack,
      strategy: base.strategy,
      defense: base.defense,
      speed: base.speed,
      troops: troopCapacity(40, 0),
      troopType: (rec?.troopType ?? 'infantry') as TroopType,
      skills: rec?.mainSkillId ? [parsedSkill(rec.mainSkillId, env.morale)].filter((v): v is ParsedSkill => Boolean(v)) : [],
    };
  };
  const evalUnits = (heroIds: string[]): number => {
    const units = [output, ...heroIds.map((id, i) => heroUnit(id, i + 1))];
    return simulateRounds({ units, enemy: env.enemy, morale: env.morale, rounds }).total;
  };

  let evaluated = 0;
  /** 输出将已占用的战法（主战法 + 携带）——队友主战法撞车就不合法 */
  const takenByOutput = new Set<string>(
    [templates[0]?.mainSkillId, ...cfg.slots[0].skillIds].filter((v): v is string => Boolean(v))
  );
  const heroMain = (heroId: string): string | undefined => HERO_RECORDS[heroId]?.mainSkillId ?? undefined;
  const collides = (heroIds: string[]): boolean => {
    const seen = new Set(takenByOutput);
    for (const id of heroIds) {
      const main = heroMain(id);
      if (!main) continue;
      if (seen.has(main)) return true;
      seen.add(main);
    }
    return false;
  };

  const singles: Array<{ heroId: string; score: number }> = [];
  for (const heroId of options.pool) {
    if (heroId === cfg.slots[0].heroId) continue;
    if (collides([heroId])) continue;
    singles.push({ heroId, score: evalUnits([heroId]) });
    evaluated += 1;
  }
  singles.sort((a, b) => b.score - a.score);
  const keep = singles.slice(0, Math.max(2, options.keep));
  onProgress?.({ step: 1, steps: 2, evaluated, bestSoFar: keep[0]?.score ?? 0 });

  const singleOf = new Map(singles.map((s) => [s.heroId, s.score]));
  const results: TeammateResult[] = [];
  for (let i = 0; i < keep.length; i += 1) {
    for (let j = i + 1; j < keep.length; j += 1) {
      const a = keep[i].heroId;
      const b = keep[j].heroId;
      if (collides([a, b])) continue; // 队友之间 / 与输出将的主战法撞车 → 非法配置
      results.push({
        heroIds: [a, b],
        score: evalUnits([a, b]),
        singleScores: [singleOf.get(a) ?? 0, singleOf.get(b) ?? 0],
      });
      evaluated += 1;
    }
  }
  results.sort((x, y) => y.score - x.score);
  onProgress?.({ step: 2, steps: 2, evaluated, bestSoFar: results[0]?.score ?? 0 });
  return { results: results.slice(0, options.top), evaluated };
}
