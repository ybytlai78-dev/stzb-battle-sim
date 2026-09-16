/**
 * 战斗主循环（v0.2）
 *   准备阶段：速度排序、battle_start 被动、一类指挥战法（一次）→ 8 回合逐个行动 → 胜负判定
 *   行动阶段（被动 → 指挥预备/二类 → 主动 → 普攻 → 追击）
 *   混乱：禁主动战法 + 普攻；被动/指挥仍正常判定
 *   胜利规则（斩首制）：一侧大营阵亡即失败（不再要求全灭）
 */
import type { BattleConfig, BattleEvent, BattleReport, General, Skill, UnitState } from './types';
import { Rng } from './rng';
import { actUnit, triggerCommandSkills, triggerPassiveSkills, triggerDelayedOutputs, tickStatuses, tickRoundStartStatuses, effectiveStat, type CombatContext } from './action';
import { computeStats } from './stats';
import { SKILL_REGISTRY } from '../data/skills';
import { validateMutualExclusion } from '../data/hero-utils';
import { computeTroopBonuses } from './troopBonus';

const POSITION_PRIORITY: Record<string, number> = { 前锋: 0, 中军: 1, 大营: 2 };

export function runBattle(config: BattleConfig): BattleReport {
  // 同队互斥校验：SP 与普通重名武将不可同队（SP赵云 + 赵云）
  const conflict = validateMutualExclusion(config.myTeam) ?? validateMutualExclusion(config.enemyTeam);
  if (conflict) throw new Error(`配队非法：${conflict}`);
  const rng = new Rng(config.seed);
  const events: BattleEvent[] = [];
  const skills: Map<string, Skill> = new Map(Object.entries(SKILL_REGISTRY));

  const myTeam = toUnitStates(config.myTeam, 'my');
  const enemyTeam = toUnitStates(config.enemyTeam, 'enemy');

  const ctx: CombatContext = {
    rng,
    myTeam,
    enemyTeam,
    events,
    skills,
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
    actLayerCounters: new Map(),
    // 伤兵死亡机制：默认启用（第 1 回合 5%，每回合 +14%，封顶 100%）
    woundedMortality: config.woundedMortality ?? { base: 5, perRound: 14 },
  };

  // ── 准备阶段：阵容加成写入（mutate ctx 内同一 team 引用）→ 速度重排 → 三段事件 → 被动/指挥 ──
  const applyTeamBonus = (team: UnitState[]) => {
    const result = computeTroopBonuses(team.map((u) => u.general));
    for (const u of team) {
      u.formationBonus = result.byUnit.get(u.general.id);
    }
    return result;
  };
  const myBonus = applyTeamBonus(myTeam);
  const enemyBonus = applyTeamBonus(enemyTeam);

  const turnOrder = buildTurnOrder([...myTeam, ...enemyTeam]);
  events.push({ type: 'battle_start', turnOrder: turnOrder.map((u) => u.general.id), seed: config.seed });

  events.push({ type: 'prep_phase', phase: 'formation' });
  const POS = { 大营: 0, 中军: 1, 前锋: 2 };
  const emitLines = (team: UnitState[], lines: typeof myBonus.lines) => {
    const order = [...team].sort(
      (a, b) => (POS[a.general.position] ?? 9) - (POS[b.general.position] ?? 9)
    );
    for (const u of order) {
      for (const cat of ['faction', 'title', 'troop'] as const) {
        for (const line of lines.filter((l) => l.unitId === u.general.id && l.category === cat)) {
          events.push({
            type: 'formation_bonus',
            unitId: line.unitId,
            unitName: u.general.name,
            category: line.category,
            bonuses: line.bonuses,
            ...(line.titleName ? { titleName: line.titleName } : {}),
          });
        }
      }
    }
  };
  emitLines(myTeam, myBonus.lines);
  emitLines(enemyTeam, enemyBonus.lines);

  events.push({ type: 'prep_phase', phase: 'troop' });
  events.push({ type: 'prep_phase', phase: 'skill' });
  // 【战法】先判定全部 battle_start 被动（百战精兵等加属性），再判定一类指挥（持节镇西等读生效属性）
  for (const unit of turnOrder) {
    triggerPassiveSkills(ctx, unit, 'battle_start');
  }
  for (const unit of turnOrder) {
    triggerCommandSkills(ctx, unit);
  }
  events.push({ type: 'preparation_end' });

  // ── 正式回合 1..maxRounds ──
  let winner: 'win' | 'loss' | 'draw' | null = null;

  for (let round = 1; round <= config.maxRounds; round++) {
    if (winner) break;
    const roundStartEv: BattleEvent = { type: 'round_start', round };
    events.push(roundStartEv);
    ctx.currentRound = round;
    for (const u of [...myTeam, ...enemyTeam]) {
      u.hasActedThisRound = false;
      u.firstActiveSucceededThisRound = false;
    }

    // 一类指挥回合前准备阶段（谋议宏图）：减伤按 1/8 衰减 + 士气叠层，再进入 delayedOutput / 单位行动
    tickRoundStartStatuses(ctx);

    // 一类指挥 delayedOutput：白衣渡江第 3 回合自动结算（无视规避，预先结算的伤害）
    triggerDelayedOutputs(ctx, round);

    // 每回合按当前生效速度重排（含加点、部队加成、速度增益/减益）；先手组（priorityRounds）仍优先
    const roundOrder = buildPriorityOrder([...myTeam, ...enemyTeam], round, skills);
    roundStartEv.turnOrder = roundOrder.map((u) => u.general.id);

    for (const unit of roundOrder) {
      if (!unit.alive) continue;
      // 斩首制：一方大营阵亡立即结束（在行动前检查，避免大营已空仍行动）
      if (!backGeneralAlive(myTeam)) { winner = 'loss'; break; }
      if (!backGeneralAlive(enemyTeam)) { winner = 'win'; break; }
      actUnit(ctx, unit);
    }

    // 回合结束：状态结算（混乱/怯战 remaining--，规避层数清 0）
    tickStatuses(ctx, [...myTeam, ...enemyTeam]);

    events.push({
      type: 'round_end',
      round,
      myTroops: myTeam.map((u) => u.troops),
      enemyTroops: enemyTeam.map((u) => u.troops),
      myWounded: myTeam.map((u) => u.wounded),
      enemyWounded: enemyTeam.map((u) => u.wounded),
      myDead: myTeam.map((u) => u.totalDead),
      enemyDead: enemyTeam.map((u) => u.totalDead),
    });
  }

  // ── 胜负判定（斩首制）──
  if (!winner) {
    const myAlive = backGeneralAlive(myTeam);
    const enemyAlive = backGeneralAlive(enemyTeam);
    winner = !myAlive ? 'loss' : !enemyAlive ? 'win' : 'draw';
  }

  const result = winner;
  events.push({
    type: 'battle_end',
    result,
    rounds: config.maxRounds,
    myTroops: myTeam.map((u) => u.troops),
    enemyTroops: enemyTeam.map((u) => u.troops),
  });

  return {
    schemaVersion: '1.0',
    seed: config.seed,
    maxRounds: config.maxRounds,
    result,
    rounds: config.maxRounds,
    myTeam: config.myTeam,
    enemyTeam: config.enemyTeam,
    finalMyTroops: myTeam.map((u) => u.troops),
    finalEnemyTroops: enemyTeam.map((u) => u.troops),
    finalMyWounded: myTeam.map((u) => u.wounded),
    finalEnemyWounded: enemyTeam.map((u) => u.wounded),
    finalMyDead: myTeam.map((u) => u.totalDead),
    finalEnemyDead: enemyTeam.map((u) => u.totalDead),
    events,
    stats: computeStats(events, [...myTeam, ...enemyTeam]),
  };
}

function toUnitStates(generals: General[], side: 'my' | 'enemy'): UnitState[] {
  return generals.map((g) => ({
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
    hasActedThisRound: false,
    prepareLeft: null,
  }));
}

/** 出手顺序：速度（含速度增益）降序 → 同速站位先手（前锋>中军>大营） */
export function buildTurnOrder(units: UnitState[]): UnitState[] {
  return [...units].sort((a, b) => {
    const sa = effectiveStat(a, 'speed');
    const sb = effectiveStat(b, 'speed');
    if (sb !== sa) return sb - sa;
    return POSITION_PRIORITY[a.general.position] - POSITION_PRIORITY[b.general.position];
  });
}

/** 每回合实际行动顺序：携带 priorityRounds（如先驱突击前 3 回合）的单位先出手，其余按当前生效速度 */
export function buildPriorityOrder(
  turnOrder: UnitState[],
  round: number,
  skills: Map<string, Skill>
): UnitState[] {
  const inPriority = (u: UnitState): boolean =>
    u.general.commandSkillIds.some((id) => {
      const s = skills.get(id);
      return s?.type === 'command' && s.priorityRounds !== undefined && round <= s.priorityRounds;
    });
  const sortBySpeed = (a: UnitState, b: UnitState): number => {
    const sa = effectiveStat(a, 'speed');
    const sb = effectiveStat(b, 'speed');
    if (sb !== sa) return sb - sa;
    return POSITION_PRIORITY[a.general.position] - POSITION_PRIORITY[b.general.position];
  };
  // 先手组：先比速度/站位；随后普通组同样排序。先手排完才轮到其他武将
  const priority = turnOrder.filter((u) => u.alive && inPriority(u)).sort(sortBySpeed);
  const rest = turnOrder.filter((u) => u.alive && !inPriority(u)).sort(sortBySpeed);
  return [...priority, ...rest];
}

/** 斩首制：一侧大营是否存活（大营阵亡即败） */
function backGeneralAlive(team: UnitState[]): boolean {
  const back = team.find((u) => u.general.position === '大营');
  // 无大营配置时退化为全员存活判定，避免误判
  return back ? back.alive : team.some((u) => u.alive);
}
