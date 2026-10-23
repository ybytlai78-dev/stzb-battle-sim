/**
 * 战斗主循环（v0.2）
 *   准备阶段：速度排序、battle_start 被动、一类指挥战法（一次）→ 8 回合逐个行动 → 胜负判定
 *   行动阶段（被动 → 指挥预备/二类 → 主动 → 普攻 → 追击）
 *   混乱：禁主动战法 + 普攻；被动/指挥仍正常判定
 *   胜利规则（斩首制）：一侧大营阵亡即失败（不再要求全灭）
 */
import type { BattleConfig, BattleEvent, BattleReport, General, Skill, UnitState } from './types';
import { Rng } from './rng';
import { actUnit, triggerCommandSkills, triggerPassiveSkills, triggerDelayedOutputs, triggerPostDelayedRoundStartCommands, triggerPendingRoundOutputs, triggerRangeDecayPassives, triggerRoundEndCommands, triggerImperialDecrees, triggerRoundStartChance, triggerRoundEndChanceOutputs, tickStatuses, tickRoundStartStatuses, effectiveStat, grantSecondaryTroopStatuses, decayWoundedPool, type CombatContext } from './action';
import { computeStats } from './stats';
import { SKILL_REGISTRY } from '../data/skills';
import { BAIJIA_SKILLS } from '../data/baijia';
import { applyBaijia } from './baijia';
import { validateMutualExclusion } from '../data/hero-utils';
import { computeTroopBonuses } from './troopBonus';
import { applyTreasureEffects, triggerTreasureRoundStart } from './treasure';
import { applyChenshouEffects, applyChenshouPrepass } from './chenshou';
import { SECONDARY_TROOPS } from './secondaryTroop';

const POSITION_PRIORITY: Record<string, number> = { 前锋: 0, 中军: 1, 大营: 2 };

/**
 * 单位 id 全局唯一化：红蓝两队可以上阵**同一名武将**（对方可能有相同武将），
 * 而引擎全程用 `general.id` 作为单位身份（事件 unitId、统计、实时距离、状态来源、各类计数器都按它索引）——
 * 直接同名会让两边的单位互相串味（如「A 打 A」、统计合并、距离为 0）。
 *
 * 规则：按「红队 → 蓝队」顺序，首次出现的 id 保留；后续重复副本改写为 `原id#2`、`原id#3`…，
 * 并把原始武将 id 记入 `General.heroId` 供 UI 还原（画像 / 势力 / 主战法 / 复用队伍）。
 * **无重复时原样返回**（不产生任何对象改写，既有战报逐字节不变）。
 *
 * @param myTeam 红队（我方）
 * @param enemyTeam 蓝队（敌方）
 */
export function ensureUniqueUnitIds(
  myTeam: General[],
  enemyTeam: General[]
): { myTeam: General[]; enemyTeam: General[] } {
  const taken = new Set<string>();
  let changed = false;
  const normalize = (team: General[]): General[] =>
    team.map((g) => {
      if (!taken.has(g.id)) {
        taken.add(g.id);
        return g;
      }
      let n = 2;
      let id = `${g.id}#${n}`;
      while (taken.has(id)) {
        n += 1;
        id = `${g.id}#${n}`;
      }
      taken.add(id);
      changed = true;
      return { ...g, id, heroId: g.heroId ?? g.id };
    });
  const my = normalize(myTeam);
  const enemy = normalize(enemyTeam);
  return changed ? { myTeam: my, enemyTeam: enemy } : { myTeam, enemyTeam };
}

export function runBattle(config: BattleConfig): BattleReport {
  // 红蓝同将去重：先保证单位 id 全局唯一（无重复时为 no-op），再做互斥校验与全部结算
  const teams = ensureUniqueUnitIds(config.myTeam, config.enemyTeam);
  // 同队互斥校验：SP 与普通重名武将不可同队（SP赵云 + 赵云）
  const conflict = validateMutualExclusion(teams.myTeam) ?? validateMutualExclusion(teams.enemyTeam);
  if (conflict) throw new Error(`配队非法：${conflict}`);
  const rng = new Rng(config.seed);
  const events: BattleEvent[] = [];
  const skills: Map<string, Skill> = new Map([
    ...Object.entries(SKILL_REGISTRY),
    ...Object.entries(BAIJIA_SKILLS),
  ]);
  // 陈寿预处理会改写阵营/统率；每场使用独立面板，不能污染输入或缓存中的配置。
  // 战报保留 teams 的原始装配，供复用时重新应用一次特性。
  const myGenerals = teams.myTeam.map((g) => applyBaijia({ ...g }));
  const enemyGenerals = teams.enemyTeam.map((g) => applyBaijia({ ...g }));

  const myTeam = toUnitStates(myGenerals, 'my', config.inertSides?.includes('my') === true);
  const enemyTeam = toUnitStates(enemyGenerals, 'enemy', config.inertSides?.includes('enemy') === true);

  const ctx: CombatContext = {
    rng,
    myTeam,
    enemyTeam,
    events,
    skills,
    lockedCommands: [],
    stackBuffs: [],
    basicHitProcs: [],
    currentRound: 0,
    defenderSide: config.defenderSide,
    actLayerCounters: new Map(),
    mainActiveCastCounters: new Map(),
    // 伤兵机制：默认启用（受击损失固定 5% 直接死亡 + 95% 入伤兵池；每回合开始池阵亡 14%）
    woundedMortality: config.woundedMortality ?? { deathRate: 5, woundedDecayRate: 14 },
    awakenedSkillIds: config.awakenedSkillIds,
  };

  // ── 准备阶段：阵容加成写入（mutate ctx 内同一 team 引用）→ 速度重排 → 三段事件 → 被动/指挥 ──
  // 【陈寿特性·纵横 / 出师】阵营与统率改写必须在部队加成结算**之前**：
  // 阵营加成的计数（`computeTroopBonuses` 里的 facCount）读的就是 `general.faction`，晚了会按旧阵营计数。
  applyChenshouPrepass([...myTeam, ...enemyTeam].map((u) => u.general));
  const applyTeamBonus = (team: UnitState[]) => {
    const result = computeTroopBonuses(team.map((u) => u.general));
    for (const u of team) {
      u.formationBonus = result.byUnit.get(u.general.id);
    }
    return result;
  };
  const myBonus = applyTeamBonus(myTeam);
  const enemyBonus = applyTeamBonus(enemyTeam);

  const turnOrderTieBreaks = buildTurnOrderTieBreaks([...myTeam, ...enemyTeam], config.seed);
  const turnOrder = buildTurnOrder([...myTeam, ...enemyTeam], turnOrderTieBreaks);
  const battleStartEv: Extract<BattleEvent, { type: 'battle_start' }> = {
    type: 'battle_start',
    turnOrder: turnOrder.map((u) => u.general.id),
    seed: config.seed,
  };
  events.push(battleStartEv);

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
  // 二级兵种专属/通用特性的**状态类**效果：重骑兵「重骑冲阵」（前 2 回合反击 75%）、
  // 通用特性「散射」（首次普攻附带分兵 40%）——准备阶段一次性授予，走状态冲突闸门
  for (const unit of turnOrder) grantSecondaryTroopStatuses(ctx, unit);
  // 【宝物】佩戴宝物的单位先在宝物阶段结算（纯提升、与其他来源不冲突），再走 battle_start 被动 / 一类指挥
  const treasureUnits = turnOrder.filter((u) => u.general.treasure);
  if (treasureUnits.length > 0) {
    events.push({ type: 'prep_phase', phase: 'treasure' });
    for (const unit of treasureUnits) applyTreasureEffects(ctx, unit);
  }
  // 【陈寿特性】状态类效果（精进 / 昂扬 / 审慎 / 砥砺）：与宝物同口径，在战法之前挂载，
  // 保证 battle_start 被动与一类指挥读到的是已加成的属性。
  // （阵营 / 统率类不在这里 —— 它们已在部队加成之前由 `applyChenshouPrepass` 改写。）
  const chenshouUnits = turnOrder.filter((u) => u.general.chenshou);
  if (chenshouUnits.length > 0) {
    events.push({ type: 'prep_phase', phase: 'chenshou' });
    for (const unit of chenshouUnits) applyChenshouEffects(ctx, unit);
  }
  events.push({ type: 'prep_phase', phase: 'skill' });
  // 【战法】先判定全部 battle_start 被动（百战精兵等加属性），再判定一类指挥（持节镇西等读生效属性）
  // 木桩（inertSides）不参与这两步：不还手就不该在准备阶段打出指挥伤害
  for (const unit of turnOrder) {
    if (unit.inert) continue;
    triggerPassiveSkills(ctx, unit, 'battle_start');
  }
  for (const unit of turnOrder) {
    if (unit.inert) continue;
    triggerCommandSkills(ctx, unit);
  }
  events.push({ type: 'preparation_end' });

  // ── 正式回合 1..maxRounds ──
  const outcome = (): 'win' | 'loss' | null =>
    !backGeneralAlive(myTeam) ? 'loss' : !backGeneralAlive(enemyTeam) ? 'win' : null;
  let winner: 'win' | 'loss' | 'draw' | null = outcome();
  let rounds = 0;
  // 回合前/末钩子也可造成阵亡；在阶段边界判胜，不能只在武将行动前判胜。
  const runPhase = (phase: () => void): void => {
    if (winner) return;
    phase();
    winner = outcome();
  };

  for (let round = 1; round <= config.maxRounds; round++) {
    if (winner) break;
    rounds = round;
    const roundStartEv: BattleEvent = { type: 'round_start', round };
    events.push(roundStartEv);
    ctx.currentRound = round;
    // 伤兵机制：回合开始时先结算累计伤兵池阵亡（固定 14%）——先于本回合任何行动/恢复，
    // 故本回合的恢复只能使用阵亡结算后的剩余伤兵（有伤兵才能恢复）。
    decayWoundedPool(ctx);
    for (const u of [...myTeam, ...enemyTeam]) {
      u.hasActedThisRound = false;
      u.firstActiveSucceededThisRound = false;
    }

    // 一类指挥回合前准备阶段（谋议宏图）：减伤按 1/8 衰减 + 士气叠层，再进入 delayedOutput / 单位行动
    runPhase(() => tickRoundStartStatuses(ctx));
    // 宝物·回合窗口效果（再战 第 5 回合连击 / 清毅 第 N 回合洞察）——无宝物时零开销、不发事件
    runPhase(() => triggerTreasureRoundStart(ctx));
    runPhase(() => triggerImperialDecrees(ctx));
    // 一类指挥·每回合开始前几率判定（锦车持节）：命中则挂本回合状态，并登记待回合末的附加恢复
    runPhase(() => triggerRoundStartChance(ctx));

    // 一类指挥 delayedOutput：白衣渡江第 3 回合自动结算（无视规避，预先结算的伤害）
    runPhase(() => triggerDelayedOutputs(ctx, round));
    // 一类指挥 roundStartRepeat 中标记 afterDelayedOutputs 的段（酒池肉林段二）：
    // 必须晚于上面的延迟指挥效果，避免帝临回光等同回合施加的 DoT 被 −99.99% 冻结整场
    runPhase(() => triggerPostDelayedRoundStartCommands(ctx));
    // 延迟到回合开始的 output（当阳桥 1/2 回合后控制、正始之变达标后的下回合效果）
    runPhase(() => triggerPendingRoundOutputs(ctx, round));

    // 每回合按当前生效速度重排（含加点、部队加成、速度增益/减益）；先手组（priorityRounds）仍优先
    const roundOrder = buildPriorityOrder(
      [...myTeam, ...enemyTeam],
      round,
      skills,
      turnOrderTieBreaks
    );
    const roundOrderIds = roundOrder.map((u) => u.general.id);
    roundStartEv.turnOrder = roundOrderIds;
    // 准备阶段的「始」出手顺序与第 1 回合实际序对齐（含先手组 / 准备阶段速度变化）；
    // 正式回合仍以各自 round_start.turnOrder 为权威（回合前钩子可能再改速度）。
    if (round === 1) battleStartEv.turnOrder = roundOrderIds;

    for (const unit of roundOrder) {
      if (winner) break;
      if (!unit.alive) continue;
      // 斩首制：一方大营阵亡立即结束（在行动前检查，避免大营已空仍行动）
      winner = outcome();
      if (winner) break;
      actUnit(ctx, unit);
      // 最后一名行动者也可能斩首；不能拖到下一回合才检查。
      winner = outcome();
      if (winner) break;
    }

    // 回合结束：被动攻击距离递减（雪奋短兵「每回合结束时使自身攻击距离 −1」）→ 一类指挥回合末结算
    // （佐命晋武「每回合结束时为我军兵力最低单体恢复 2 次」）→ 状态结算
    runPhase(() => triggerRangeDecayPassives(ctx));
    // 回合末「已触发」的几率判定附加段（锦车持节：恢复我军兵力最低单体）→ 再走一类指挥回合末结算
    runPhase(() => triggerRoundEndChanceOutputs(ctx));
    runPhase(() => triggerRoundEndCommands(ctx));
    runPhase(() => tickStatuses(ctx, [...myTeam, ...enemyTeam]));

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
    rounds,
    myTroops: myTeam.map((u) => u.troops),
    enemyTroops: enemyTeam.map((u) => u.troops),
  });

  return {
    schemaVersion: '1.0',
    seed: config.seed,
    maxRounds: config.maxRounds,
    result,
    rounds,
    myTeam: teams.myTeam,
    enemyTeam: teams.enemyTeam,
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

function toUnitStates(generals: General[], side: 'my' | 'enemy', inert = false): UnitState[] {
  return generals.map((g) => ({
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
    hasActedThisRound: false,
    ...(inert ? { inert: true } : {}),
  }));
}

/**
 * 同速同站位的中立 tie-break：独立 Rng 流（不消耗主 rng，避免改变战斗随机序列）。
 * 每次战斗给每个单位一个 [0,1) 的固定键；红蓝双方各自独立，镜像队不再固定红方先手。
 */
export function buildTurnOrderTieBreaks(
  units: UnitState[],
  seed: number
): Map<UnitState, number> {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const tieBreaks = new Map<UnitState, number>();
  for (const unit of units) tieBreaks.set(unit, rng.next());
  return tieBreaks;
}

/** 出手顺序：速度（含速度增益）降序 → 同速站位先手（前锋>中军>大营）→ 同速同站位用中立 tie-break */
export function buildTurnOrder(
  units: UnitState[],
  tieBreaks?: ReadonlyMap<UnitState, number>
): UnitState[] {
  const sortBySpeed = (a: UnitState, b: UnitState): number => {
    const sa = effectiveStat(a, 'speed', { ignoreExpired: true });
    const sb = effectiveStat(b, 'speed', { ignoreExpired: true });
    if (sb !== sa) return sb - sa;
    const pos = POSITION_PRIORITY[a.general.position] - POSITION_PRIORITY[b.general.position];
    if (pos !== 0) return pos;
    return (tieBreaks?.get(a) ?? 0) - (tieBreaks?.get(b) ?? 0);
  };
  return [...units].sort(sortBySpeed);
}

/** 每回合实际行动顺序：携带 priorityRounds（如先驱突击前 3 回合）的单位先出手，其余按当前生效速度 */
export function buildPriorityOrder(
  turnOrder: UnitState[],
  round: number,
  skills: Map<string, Skill>,
  tieBreaks?: ReadonlyMap<UnitState, number>
): UnitState[] {
  const troopPriority = (u: UnitState): boolean => {
    const troop = u.general.secondaryTroop ? SECONDARY_TROOPS[u.general.secondaryTroop] : undefined;
    // 先发 / 奇袭：前 N 回合无条件优先行动（攻守双方同口径，用户 2026-10-19 纠正）
    return troop?.priorityRounds != null && round <= troop.priorityRounds;
  };
  const inPriority = (u: UnitState): boolean =>
    // ① 通用特性「疾行」：骑兵系高级兵种前 3 回合优先行动
    (u.general.secondaryTraits?.includes('疾行') === true && round <= 3) ||
    // ② 包内先发/奇袭：前 N 回合优先（长弓兵 / 白衣死士均不限攻守）
    troopPriority(u) ||
    // ④ 主动战法发动后授予的 priority 状态（诸葛锦囊）
    u.statuses.some((st) => st.type === 'priority') ||
    // ⑤ 指挥战法常驻（先驱突击前 N 回合）
    u.general.commandSkillIds.some((id) => {
      const s = skills.get(id);
      return s?.type === 'command' && s.priorityRounds !== undefined && round <= s.priorityRounds;
    }) ||
    // ⑥ 被动先手（侵掠如火「在战斗中可以优先行动」，priorityRounds 999 = 全程）
    u.general.passiveSkillIds.some((id) => {
      const s = skills.get(id);
      return s?.type === 'passive' && s.priorityRounds !== undefined && round <= s.priorityRounds;
    });
  const sortBySpeed = (a: UnitState, b: UnitState): number => {
    const sa = effectiveStat(a, 'speed', { ignoreExpired: true });
    const sb = effectiveStat(b, 'speed', { ignoreExpired: true });
    if (sb !== sa) return sb - sa;
    const pos = POSITION_PRIORITY[a.general.position] - POSITION_PRIORITY[b.general.position];
    if (pos !== 0) return pos;
    return (tieBreaks?.get(a) ?? 0) - (tieBreaks?.get(b) ?? 0);
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
