/**
 * 实战胜率批量模拟（L4 · 阶段 1）
 * ---------------------------------------------------------------------------
 * 用引擎真跑战斗（`runBattle`，含控制 / 规避 / 兵力截断 / 伤兵），**只看统计、不渲染战报**。
 *
 * 标准（用户 2026-09-22 定稿）：
 *  · 判定 = 引擎原生（8 回合：一方全灭判负；否则比剩余兵力比例；相同为平）
 *  · 样本 = 默认 500 场，固定种子序列（seed = 基种子 + 场次，可复现）
 *  · 交换场地 = 奇数场把我方放右侧（消除先手/站位偏差），胜负按我方视角还原
 *  · 主指标 = 胜率（含 95% 置信半宽）+ 平均剩余兵力优势（我方剩余% − 敌方剩余%）
 *  · 控制口径 = 平均控制「人回合」（从 status_inflicted 的 detail 解析时长；无法解析按 1 计）
 *  · 恢复口径 = 恢复兵力（heal.amount），报双方占比
 *  · 伤害口径 = 普攻 attack_hit + 战法 damage + DoT dot_tick + 分兵 split_damage（与战报统计一致）
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, BattleReport, General } from '../src/engine/types';

export interface SimEnv {
  maxRounds: number;
  /** 是否交换场地跑一半（缺省 true） */
  swapSides: boolean;
  /** 基种子（固定 → 结果可复现） */
  baseSeed: number;
}

export const DEFAULT_ENV: SimEnv = { maxRounds: 8, swapSides: true, baseSeed: 20260922 };

/** 控制类状态（口径：混乱 / 暴走 / 怯战 / 犹豫） */
export const CONTROL_STATUSES = new Set(['confusion', 'rampage', 'cowardice', 'hesitation']);

export interface UnitStat {
  id: string;
  name: string;
  avgDamage: number;
  avgTaken: number;
  avgHeal: number;
  /** 每场平均被控人回合 */
  avgControlTaken: number;
}

export interface SkillStat {
  unitName: string;
  skillId: string;
  skillName: string;
  avgCasts: number;
  avgDamage: number;
  avgControl: number;
  avgHeal: number;
}

export interface BatchStats {
  runs: number;
  win: number;
  loss: number;
  draw: number;
  winRate: number;
  drawRate: number;
  /** 胜场里「斩首胜」与「兵力判定胜」各多少场 */
  winDecap: number;
  winTroops: number;
  /** 胜率 95% 置信半宽（正态近似） */
  winRateHalfWidth: number;
  /** 平均剩余兵力优势（我方剩余% − 敌方剩余%），百分点 */
  troopAdvantage: number;
  avgRounds: number;
  /** 我方伤害占双方总伤害比（0~1） */
  damageShare: number;
  /** 双方场均伤害 */
  avgDamageMine: number;
  avgDamageEnemy: number;
  /** 平均控制人回合（每场） */
  controlMine: number;
  controlEnemy: number;
  /** 恢复兵力占比（我方 / 双方） */
  healShare: number;
  avgHealMine: number;
  avgHealEnemy: number;
  /** 我方每将（按平均伤害降序） */
  perUnit: UnitStat[];
  /** 我方战法明细（按平均伤害降序） */
  perSkill: SkillStat[];
  /** 我方各战法伤害占比（饼图数据） */
  skillDamageShare: Array<{ name: string; value: number }>;
  ms: number;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 从 status_inflicted.detail 解析持续回合；「持续至战斗结束」→ 剩余回合数 */
export function parseDuration(detail: string, round: number, maxRounds: number): number {
  const m = /持续\s*(\d+)\s*回合/.exec(detail);
  if (m) return Number(m[1]);
  if (detail.includes('持续至战斗结束')) return Math.max(1, maxRounds - round + 1);
  return 1;
}

interface UnitAcc {
  damage: number;
  taken: number;
  heal: number;
  controlTaken: number;
}
interface SkillAcc {
  unitName: string;
  skillName: string;
  casts: number;
  damage: number;
  control: number;
  heal: number;
}

export interface RunRaw {
  win: boolean;
  draw: boolean;
  /** 胜负来自「斩首」（大营阵亡）还是「兵力判定」（打满回合比剩余兵力） */
  winKind: 'decap' | 'troops' | 'none';
  myTroopRatio: number;
  enemyTroopRatio: number;
  rounds: number;
  myDamage: number;
  enemyDamage: number;
  controlMine: number;
  controlEnemy: number;
  healMine: number;
  healEnemy: number;
  perUnit: Map<string, UnitAcc>;
  perSkill: Map<string, SkillAcc>;
}

/**
 * 实战判定（率土口径）：斩首（一方大营阵亡，引擎已判 win/loss）优先；
 * 打满回合双方大营都在 → **比剩余兵力比例，高者胜**（完全相同才算平）。
 * 引擎原生此时返回 `draw`，所以这层是 L4 的实战化补充。
 */
export function judgeOutcome(
  engineResult: 'win' | 'loss' | 'draw',
  myRatio: number,
  enemyRatio: number
): { win: boolean; draw: boolean; kind: 'decap' | 'troops' | 'none' } {
  if (engineResult === 'win') return { win: true, draw: false, kind: 'decap' };
  if (engineResult === 'loss') return { win: false, draw: false, kind: 'decap' };
  const diff = myRatio - enemyRatio;
  if (Math.abs(diff) < 1e-9) return { win: false, draw: true, kind: 'none' };
  return { win: diff > 0, draw: false, kind: 'troops' };
}

/**
 * 单场统计。`myIds` = 本局中「我方单位」的 id 集合（交换场地后传入右侧单位 id）。
 * 交换场地的胜负还原由调用方 `runOne` 处理，这里只按 id 归属统计。
 */
export function collectRun(report: BattleReport, myIds: Set<string>): RunRaw {
  const acc: RunRaw = {
    win: report.result === 'win',
    draw: report.result === 'draw',
    winKind: report.result === 'draw' ? 'none' : 'decap',
    myTroopRatio: 0,
    enemyTroopRatio: 0,
    rounds: report.rounds,
    myDamage: 0,
    enemyDamage: 0,
    controlMine: 0,
    controlEnemy: 0,
    healMine: 0,
    healEnemy: 0,
    perUnit: new Map(),
    perSkill: new Map(),
  };
  const unit = (id: string): UnitAcc => {
    let hit = acc.perUnit.get(id);
    if (!hit) {
      hit = { damage: 0, taken: 0, heal: 0, controlTaken: 0 };
      acc.perUnit.set(id, hit);
    }
    return hit;
  };
  const skill = (skillId: string, unitName: string, skillName: string): SkillAcc => {
    let hit = acc.perSkill.get(skillId);
    if (!hit) {
      hit = { unitName, skillName, casts: 0, damage: 0, control: 0, heal: 0 };
      acc.perSkill.set(skillId, hit);
    }
    return hit;
  };
  const nameOf = new Map<string, string>();
  for (const g of [...report.myTeam, ...report.enemyTeam]) nameOf.set(g.id, g.name);
  const name = (id: string | undefined): string => (id ? nameOf.get(id) ?? id : '（未知）');

  // 结束时兵力比例（按 myIds 归属双方，交换场地也成立）
  const sumFinal = (team: General[], troops: number[]): number =>
    team.reduce((a, g, i) => a + (myIds.has(g.id) ? troops[i] ?? 0 : 0), 0);
  const sumStart = (team: General[]): number => team.reduce((a, g) => a + (myIds.has(g.id) ? g.maxTroops : 0), 0) || 1;
  const sumFinalVs = (team: General[], troops: number[]): number =>
    team.reduce((a, g, i) => a + (myIds.has(g.id) ? 0 : troops[i] ?? 0), 0);
  const sumStartVs = (team: General[]): number => team.reduce((a, g) => a + (myIds.has(g.id) ? 0 : g.maxTroops), 0) || 1;
  acc.myTroopRatio =
    (sumFinal(report.myTeam, report.finalMyTroops) + sumFinal(report.enemyTeam, report.finalEnemyTroops)) /
    (sumStart(report.myTeam) + sumStart(report.enemyTeam));
  acc.enemyTroopRatio =
    (sumFinalVs(report.myTeam, report.finalMyTroops) + sumFinalVs(report.enemyTeam, report.finalEnemyTroops)) /
    (sumStartVs(report.myTeam) + sumStartVs(report.enemyTeam));

  let round = 1;
  for (const ev of report.events as BattleEvent[]) {
    if (ev.type === 'round_start') {
      round = ev.round ?? round;
      continue;
    }
    switch (ev.type) {
      case 'attack_hit':
      case 'split_damage': {
        const mine = myIds.has(ev.sourceId);
        unit(ev.sourceId).damage += ev.damage;
        unit(ev.targetId).taken += ev.damage;
        if (mine) acc.myDamage += ev.damage;
        else acc.enemyDamage += ev.damage;
        break;
      }
      case 'damage': {
        const owner = ev.creditToId ?? ev.sourceId;
        const mine = myIds.has(owner);
        unit(owner).damage += ev.damage;
        unit(ev.targetId).taken += ev.damage;
        if (mine) acc.myDamage += ev.damage;
        else acc.enemyDamage += ev.damage;
        if (ev.skillId) skill(ev.skillId, name(owner), ev.skillName ?? ev.skillId).damage += ev.damage;
        break;
      }
      case 'dot_tick': {
        const caster = ev.casterId;
        const mine = myIds.has(caster);
        unit(caster).damage += ev.damage;
        unit(ev.targetId).taken += ev.damage;
        if (mine) acc.myDamage += ev.damage;
        else acc.enemyDamage += ev.damage;
        skill(ev.skillId, name(caster), ev.skillId).damage += ev.damage;
        break;
      }
      case 'heal': {
        const mine = myIds.has(ev.sourceId);
        unit(ev.sourceId).heal += ev.amount;
        if (mine) acc.healMine += ev.amount;
        else acc.healEnemy += ev.amount;
        skill(ev.skillId, name(ev.sourceId), ev.skillName ?? ev.skillId).heal += ev.amount;
        break;
      }
      case 'status_inflicted': {
        if (!CONTROL_STATUSES.has(ev.statusType)) break;
        // 引擎事件只带 unitId（被施加者）→ 由「被控者属于谁」反推施法方
        const targetIsMine = myIds.has(ev.unitId);
        const duration = parseDuration(ev.detail, round, report.maxRounds);
        if (targetIsMine) acc.controlEnemy += duration;
        else acc.controlMine += duration;
        unit(ev.unitId).controlTaken += duration;
        break;
      }
      case 'skill_cast': {
        skill(ev.skillId, name(ev.unitId), ev.skillName ?? ev.skillId).casts += 1;
        break;
      }
      default:
        break;
    }
  }
  return acc;
}

/** 单场：按种子跑一局（交换场地时把我方放右侧），并按实战口径判定胜负 */
export function runOne(myTeam: General[], enemyTeam: General[], index: number, env: SimEnv): RunRaw {
  const swap = env.swapSides && index % 2 === 1;
  // myTeam 是「我方名单」：交换场地只把双方放到不同侧，id 名单不变
  const left = swap ? enemyTeam : myTeam;
  const right = swap ? myTeam : enemyTeam;
  const report = runBattle({
    myTeam: left,
    enemyTeam: right,
    maxRounds: env.maxRounds,
    seed: env.baseSeed + index,
  } as never);
  // 我方单位 id 与「站在哪一侧」无关：始终取 myTeam（交换场地只换侧别）
  const myIds = new Set(myTeam.map((g) => g.id));
  const raw = collectRun(report, myIds);
  // 引擎结果是「左侧视角」→ 交换场地时先还原成我方视角
  const engineResult: 'win' | 'loss' | 'draw' = swap
    ? report.result === 'win'
      ? 'loss'
      : report.result === 'loss'
        ? 'win'
        : 'draw'
    : report.result;
  const judged = judgeOutcome(engineResult, raw.myTroopRatio, raw.enemyTroopRatio);
  raw.win = judged.win;
  raw.draw = judged.draw;
  raw.winKind = judged.kind;
  return raw;
}

interface Acc {
  runs: number;
  win: number;
  winDecap: number;
  winTroops: number;
  loss: number;
  draw: number;
  myDamage: number;
  enemyDamage: number;
  controlMine: number;
  controlEnemy: number;
  healMine: number;
  healEnemy: number;
  troopAdv: number;
  rounds: number;
  perUnit: Map<string, UnitAcc & { name: string }>;
  perSkill: Map<string, SkillAcc & { skillId: string }>;
}

function emptyAcc(): Acc {
  return {
    runs: 0,
    win: 0,
    winDecap: 0,
    winTroops: 0,
    loss: 0,
    draw: 0,
    myDamage: 0,
    enemyDamage: 0,
    controlMine: 0,
    controlEnemy: 0,
    healMine: 0,
    healEnemy: 0,
    troopAdv: 0,
    rounds: 0,
    perUnit: new Map(),
    perSkill: new Map(),
  };
}

function merge(acc: Acc, raw: RunRaw, myTeam: General[]): void {
  acc.runs += 1;
  if (raw.win) {
    acc.win += 1;
    if (raw.winKind === 'decap') acc.winDecap += 1;
    else if (raw.winKind === 'troops') acc.winTroops += 1;
  } else if (raw.draw) acc.draw += 1;
  else acc.loss += 1;
  acc.myDamage += raw.myDamage;
  acc.enemyDamage += raw.enemyDamage;
  acc.controlMine += raw.controlMine;
  acc.controlEnemy += raw.controlEnemy;
  acc.healMine += raw.healMine;
  acc.healEnemy += raw.healEnemy;
  acc.troopAdv += (raw.myTroopRatio - raw.enemyTroopRatio) * 100;
  acc.rounds += raw.rounds;
  for (const [id, v] of raw.perUnit) {
    const hit = acc.perUnit.get(id) ?? { ...v, name: '' };
    if (!acc.perUnit.has(id)) acc.perUnit.set(id, hit);
    hit.damage += v.damage;
    hit.taken += v.taken;
    hit.heal += v.heal;
    hit.controlTaken += v.controlTaken;
  }
  for (const [id, v] of raw.perSkill) {
    let hit = acc.perSkill.get(id);
    if (!hit) {
      hit = { ...v, skillId: id };
      acc.perSkill.set(id, hit);
    }
    hit.casts += v.casts;
    hit.damage += v.damage;
    hit.control += v.control;
    hit.heal += v.heal;
  }
  for (const g of myTeam) {
    if (!acc.perUnit.has(g.id)) acc.perUnit.set(g.id, { name: g.name, damage: 0, taken: 0, heal: 0, controlTaken: 0 });
  }
}

function finalize(acc: Acc, myTeam: General[], myIds: Set<string>, ms: number): BatchStats {
  const n = Math.max(1, acc.runs);
  const winRate = acc.win / n;
  const totalDamage = acc.myDamage + acc.enemyDamage || 1;
  const totalHeal = acc.healMine + acc.healEnemy || 1;
  const perUnit: UnitStat[] = [...acc.perUnit.entries()]
    .filter(([id]) => myIds.has(id))
    .map(([id, v]) => ({
      id,
      name: v.name || myTeam.find((g) => g.id === id)?.name || id,
      avgDamage: r1(v.damage / n),
      avgTaken: r1(v.taken / n),
      avgHeal: r1(v.heal / n),
      avgControlTaken: r2(v.controlTaken / n),
    }))
    .sort((a, b) => b.avgDamage - a.avgDamage);
  const myNames = new Set(myTeam.map((g) => g.name));
  const perSkill: SkillStat[] = [...acc.perSkill.entries()]
    .filter(([, v]) => myNames.has(v.unitName))
    .map(([skillId, v]) => ({
      unitName: v.unitName,
      skillId,
      skillName: v.skillName,
      avgCasts: r1(v.casts / n),
      avgDamage: r1(v.damage / n),
      avgControl: r2(v.control / n),
      avgHeal: r1(v.heal / n),
    }))
    .filter((s) => s.avgDamage > 0 || s.avgControl > 0 || s.avgHeal > 0)
    .sort((a, b) => b.avgDamage - a.avgDamage);
  return {
    runs: acc.runs,
    win: acc.win,
    loss: acc.loss,
    draw: acc.draw,
    winRate,
    drawRate: acc.draw / n,
    winDecap: acc.winDecap,
    winTroops: acc.winTroops,
    winRateHalfWidth: 1.96 * Math.sqrt((winRate * (1 - winRate)) / n),
    troopAdvantage: r1(acc.troopAdv / n),
    avgRounds: r2(acc.rounds / n),
    damageShare: acc.myDamage / totalDamage,
    avgDamageMine: r1(acc.myDamage / n),
    avgDamageEnemy: r1(acc.enemyDamage / n),
    controlMine: r2(acc.controlMine / n),
    controlEnemy: r2(acc.controlEnemy / n),
    healShare: acc.healMine / totalHeal,
    avgHealMine: r1(acc.healMine / n),
    avgHealEnemy: r1(acc.healEnemy / n),
    perUnit,
    perSkill,
    skillDamageShare: perSkill.filter((s) => s.avgDamage > 0).map((s) => ({ name: `${s.unitName}·${s.skillName}`, value: s.avgDamage })),
    ms,
  };
}

export interface BatchOptions {
  runs: number;
  env: SimEnv;
  onProgress?: (done: number, total: number) => void;
  /** 浏览器用：每 N 场让出一次主线程 */
  yieldEvery?: number;
}

/** 同步批量（脚本 / 测试） */
export function runBatch(myTeam: General[], enemyTeam: General[], opts: BatchOptions): BatchStats {
  const acc = emptyAcc();
  const myIds = new Set(myTeam.map((g) => g.id));
  const t0 = Date.now();
  for (let i = 0; i < opts.runs; i += 1) {
    merge(acc, runOne(myTeam, enemyTeam, i, opts.env), myTeam);
    opts.onProgress?.(i + 1, opts.runs);
  }
  return finalize(acc, myTeam, myIds, Date.now() - t0);
}

/** 异步批量（页面用：可显示进度且不卡界面） */
export async function runBatchAsync(myTeam: General[], enemyTeam: General[], opts: BatchOptions): Promise<BatchStats> {
  const acc = emptyAcc();
  const myIds = new Set(myTeam.map((g) => g.id));
  const t0 = Date.now();
  const every = Math.max(1, opts.yieldEvery ?? 25);
  for (let i = 0; i < opts.runs; i += 1) {
    merge(acc, runOne(myTeam, enemyTeam, i, opts.env), myTeam);
    if ((i + 1) % every === 0) {
      opts.onProgress?.(i + 1, opts.runs);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  opts.onProgress?.(opts.runs, opts.runs);
  return finalize(acc, myTeam, myIds, Date.now() - t0);
}
