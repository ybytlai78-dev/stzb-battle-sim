/**
 * 单武将行动阶段 + 指挥/被动管线（率土标准流程，v0.3）
 *   准备阶段【战法】：battle_start 被动 → 一类指挥 → 正式回合单将行动：
 *     被动（round_start）→ 指挥预备/二类 → 混乱检查 → 怯战检查 → 准备检查 → 主动战法(逐个) → 普通攻击(连击×N) → 追击战法(逐个)
 */
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  DamageBreakdown,
  DamageModifierSource,
  DamageModifiers,
  DamageType,
  DotStoredDamage,
  DotType,
  OnHealConfig,
  OnHurtConfig,
  Position,
  Skill,
  SkillOutput,
  SkillType,
  Status,
  StatusType,
  TroopType,
  TroopRatioCond,
  UnitState,
  WoundedMortalityConfig,
} from './types';
import type { Rng } from './rng';
import { calcDamage, applyTroopCap, scaledValue, roundRate, sumRates, buffMult, calcHealAmount, moraleRate, applyIgnoreDef, troopCounterReduce } from './formulas';
import { nearestEnemy, skillTargets, distanceBetween, adjacentUnits, sameSideDistance, attackRangeOf, POSITION_INDEX } from './target';

/** 兵种克制减伤率（加算进增减伤单一总和）：被克制方攻击克制方 0.3，否则 0 */
function troopCounterReduceOf(source: UnitState, target: UnitState): number {
  return troopCounterReduce(source.general.troopType, target.general.troopType);
}

/** skillTargets 能吃的四种选敌；`self` 等回退 fallback，避免 random_single 被降成 all/group */
type CombatTargetMode = 'single' | 'random_single' | 'group' | 'all';
function resolveCombatTargetMode(mode: string | undefined, fallback: CombatTargetMode): CombatTargetMode {
  if (mode === 'single' || mode === 'random_single' || mode === 'group' || mode === 'all') return mode;
  return fallback;
}

/**
 * 开场上阵兵种集合是否 ⊆ allowed（不论 alive）。
 * @param team 该侧部署名单
 * @param allowed 允许的兵种
 */
export function teamPassesTroopFilter(team: UnitState[], allowed: TroopType[]): boolean {
  const set = new Set(team.map((u) => u.general.troopType));
  for (const t of set) {
    if (!allowed.includes(t)) return false;
  }
  return set.size > 0 || allowed.length === 0;
}

/** 带发动率属性的战法生效概率 = 基础率 × 施法者士气系数（四舍五入取整到百分位），上限 100% */
function moraleTriggerRate(morale: number, baseRate: number): number {
  return Math.min(1, Math.round(baseRate * moraleRate(morale) * 100) / 100);
}

/**
 * 发动率提升后的基础率（士气封顶前）。
 * **率土口径：「使 X 战法发动率提升 N%」= 与基础发动率直接相加（百分点加算）** ——
 * 例：追击战法基础 30% 受到「提升 100%」→ 130%；超过 100% 由 moraleTriggerRate 封顶为必定发动。
 * ⚠️ 旧实现缺省走乘算（基础率 × (1+rate)），会把「提高 120%」记成 35% → 77%，
 *    与官方「100% 发动率」不符，已按官方口径纠正为缺省相加。
 * `additive: false` 显式声明时才退回乘算；skillTypes 限定战法类型（动如雷震仅追击）；
 * 多种 trigger_boost 按施加顺序逐条相加叠加。
 */
/** 「攻击类」战法：输出段（含 chance_group / random_pick 内层）含 physical_damage
 *  （侵掠如火「攻击类主动战法发动率提升 20.0%」的过滤维） */
function isAttackClassSkill(skill: Skill): boolean {
  const walk = (outs: SkillOutput[]): boolean =>
    outs.some((o) => {
      if (o.kind === 'physical_damage') return true;
      if (o.kind === 'chance_group') return walk(o.outputs);
      if (o.kind === 'random_pick') return walk(o.options.flat());
      return false;
    });
  return walk(skill.output);
}

function boostedBaseRate(unit: UnitState, skillType: SkillType, baseRate: number, skill?: Skill): number {
  let rate = baseRate;
  for (const s of unit.statuses) {
    if (s.type !== 'trigger_boost') continue;
    if (s.skillTypes && s.skillTypes.length > 0 && !s.skillTypes.includes(skillType)) continue;
    // 攻击类过滤（侵掠如火）：只对输出含物理伤害的战法生效
    if (s.attackSkillsOnly && (!skill || !isAttackClassSkill(skill))) continue;
    if (s.additive === false) rate *= 1 + s.rate;
    else rate += s.rate;
  }
  return rate;
}

/**
 * 发动率：数字原样；区间则每次用 intInclusive 抽整数百分再 /100（烽火覆周 50–100）。
 */
function rollTriggerRate(rng: Rng, triggerRate: number | [number, number]): number {
  if (!Array.isArray(triggerRate)) return triggerRate;
  return rng.intInclusive(Math.round(triggerRate[0] * 100), Math.round(triggerRate[1] * 100)) / 100;
}

/**
 * CreateStatus.duration：数字原样。区间应在 inflictStatus 入口已掷成数字；若仍是元组则取下界兜底。
 */
function remainingFromDuration(duration: number | [number, number] | undefined): number {
  if (Array.isArray(duration)) return duration[0];
  return duration ?? 0;
}

/** 指挥战法锁定目标：准备阶段锁定，后续回合/延迟结算用 */
export interface LockedCommand {
  skill: CommandSkill;
  casterId: string;
  targets: UnitState[];
  /**
   * roundRepeat 目标侧与战法 targetSide 不同时的预备判定目标（母仪浮梦：规避锁友军，减伤锁敌军）。
   * 缺省沿用 targets。
   */
  repeatTargets?: UnitState[];
  /** 二类指挥动态发动率当前值（未生效 +increment，生效重置为 base） */
  currentRate: number;
  /** 一类指挥 delayedOutput：准备阶段已结算伤害（按准备时兵力/属性），条件符合直接打出 */
  storedDamage?: Array<{ targetId: string; damage: number; breakdown: DamageBreakdown }>;
}

export interface CombatContext {
  rng: Rng;
  myTeam: UnitState[];
  enemyTeam: UnitState[];
  events: BattleEvent[];
  /** 战法查找表：id → Skill */
  skills: Map<string, Skill>;
  /** 指挥战法锁定目标（一类预备/延迟结算 + 二类每回合判定共用） */
  lockedCommands: LockedCommand[];
  /** 常驻伤害前叠层 buff（持节镇西）：准备阶段对友军全体注册，友军每次造成/受到伤害前按层叠属性 */
  stackBuffs: StackBuffEffect[];
  /** 当前回合数（预备怯战/延迟结算判定用） */
  currentRound: number;
  /** 二类指挥行动叠层计数器（奋疾先登）：key `${casterId}:${skillId}` → 当前增伤层数。
   *  可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化 */
  actLayerCounters?: Map<string, number>;
  /** 持续型急救计数器（皇裔流离）：战法级共享触发率与总生效次数（全队合计，每达到 N 次提升）。
   *  可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化 */
  firstAidCounters?: FirstAidCounter[];
  /** 伤兵死亡机制配置（可选）：缺省 = 机制关闭（单元测试直接构造 ctx 时不受影响）。
   *  runBattle 总是注入（默认 { base: 5, perRound: 14 }），引擎战斗默认启用。 */
  woundedMortality?: WoundedMortalityConfig;
  /** 受击触发「每单位每回合首次」（陷储立齐）：key = `${round}:${skillId}:${casterId}:${victimId}` */
  hurtOnceKeys?: Set<string>;
  /** 首次受击必触发已用标记（疮痍累身），键为 `skillId:casterId:victimId` */
  hurtFirstKeys?: Set<string>;
  /** 受击 hook 重入保护：反击/引爆等二次 applyDamage 不再触发 onHurt（防盲侯循环） */
  resolvingHurtHooks?: boolean;
  /** 受恢复 hook 重入保护：赏顺伐逆群体奶不再触发 onHeal */
  resolvingHealHooks?: boolean;
  /**
   * 二类指挥友军行动累计（七步释嫌）：key `${casterId}:${skillId}` → 已发动次数。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  allyActCounters?: Map<string, number>;
  /**
   * 被动「发动主动战法后」计数（九伐中原）：key `${casterId}:${skillId}` → 已发动次数（整场累计）。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  afterActiveCounters?: Map<string, number>;
  /**
   * 主动战法成功发动计数（发动率递减：威震河朔）：key `${casterId}:${skillId}` → 已发动次数（整场累计）。
   * 每次实际释放（含准备完成释放）后 +1，用于把基础发动率按 `triggerRateDecayPerCast` 递减。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  skillCastCounters?: Map<string, number>;
  /**
   * 「按造成伤害次数递增发动率」计数（霸王渡江）：key `${casterId}:${skillId}` → 已造成伤害次数
   * （上限取 `skill.chanceBoostPerDamage.maxStacks`）。可选字段：单元测试直接构造 ctx 时可省略，
   * 执行时惰性初始化。
   */
  skillDamageCounters?: Map<string, number>;
  /**
   * 全队累计伤害计数（徽言龙凤）：key `${casterId}:${skillId}` → 该战法视角下「本侧已造成伤害次数」。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  teamDamageCounters?: Map<string, number>;
  /** 全队累计伤害门槛已激活标记（徽言龙凤）：键同 teamDamageCounters */
  teamThresholdActive?: Set<string>;
  /**
   * 二类指挥·友军监听试图发动主动（谋谟帷幄）：key `${round}:${skillId}:${casterId}:${actorId}` → 已判定，
   * 保证「其每回合首次试图发动主动战法时」对每个发动者只走一次。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  beforeActiveOnceKeys?: Set<string>;
  /**
   * 受击触发整场次数上限（持玺兴兵）：key `${casterId}:${skillId}` → 已触发次数（整场累计，不随回合重置）。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  hurtTriggerCounters?: Map<string, number>;
}

/** 持续型急救战法级计数器（皇裔流离/金匮要略）：一个战法一个实例，全队共享。
 *  - rate：当前触发率（%），初始为战法配置（如 50），全队总生效次数每达到 triggerUpEvery 次 +triggerUpIncrement
 *  - triggerCount：全队总生效次数（每成功触发一次恢复 +1） */
export interface FirstAidCounter {
  skillId: string;
  casterId: string;
  rate: number;
  triggerCount: number;
}

/** 常驻伤害前叠层效果（持节镇西）：持有者 + 战法配置，友军伤害前触发 */
export interface StackBuffEffect {
  skillId: string;
  casterId: string;
  config: NonNullable<CommandSkill['stackBuff']>;
}

/** 暴走/混乱目标池：所有存活单位（不分敌我，不含自己） */
function mixedPool(ctx: CombatContext, unit: UnitState): UnitState[] {
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  return [...allies, ...enemies].filter((t) => t.alive && t !== unit);
}

// ─── 指挥 / 被动管线 ───

/**
 * 指挥战法：准备阶段（战斗开始）触发一次
 *  - 一类（phase='prep'）：只释放一次。buff/状态照常施加；
 *    - roundRepeat 预备负面（战必/措手/白衣）：锁目标，条件满足时判定生效
 *    - delayedOutput（白衣）：按准备时兵力/属性**预先结算伤害**存入 storedDamage，到 atRound 回合直接打出
 *  - 二类（phase='round'）：不在此触发，由武将行动时判定
 */
export function triggerCommandSkills(ctx: CombatContext, unit: UnitState): void {
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const id of unit.general.commandSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'command') continue;
    if (skill.battleStartOnce) {
      // 当敌制决：入库类型为二类指挥，但效果为战斗开始一次性（self 减伤），不参与每回合判定
      ctx.events.push({
        type: 'unit_act_start',
        unitId: unit.general.id,
        name: unit.general.name,
        position: unit.general.position,
        phase: 'command_skill',
      });
      executeSkillOutputs(ctx, unit, skill, [unit]);
      continue;
    }
    if (skill.phase === 'round') continue; // 二类指挥：行动时判定

    // 一类指挥：准备阶段释放一次
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'command_skill',
    });

    // 锁定目标：self → 施法者自己；targetSide='ally' → 友军群体；否则按 targetMode 选敌军
    // 预备负面（roundRepeat）可用 targetMode 覆盖（白衣怯战为 2 目标群体，与全体伤害分离）
    let targets: UnitState[];
    if (skill.targetMode === 'self') {
      targets = [unit];
    } else if (skill.targetSide === 'ally') {
      // 增益型指挥（金匮要略：我军全体减伤；大赏三军：我军群体造成伤害提高）
      // 尊重战法 targetMode（all=全体 / group=群体2目标 / random_single=随机单体），缺省按 group
      const allyMode = resolveCombatTargetMode(skill.targetMode, 'group');
      targets = skillTargets(ctx, unit, allies, skill.range, allyMode, skill.groupCount);
    } else if (skill.targetSide === 'enemy') {
      // 对敌指挥（白楼独舞：前 3 回合敌军群体减伤）：按 targetMode 选敌军
      const enemyMode = resolveCombatTargetMode(skill.targetMode, 'all');
      targets = skillTargets(ctx, unit, enemies, skill.range, enemyMode);
    } else {
      const lockMode = resolveCombatTargetMode(skill.roundRepeat?.targetMode ?? skill.targetMode, 'all');
      targets = skillTargets(ctx, unit, enemies, skill.range, lockMode);
    }
    if (targets.length === 0) continue;
    if (skill.teamTroopFilter && !teamPassesTroopFilter(
      unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam,
      skill.teamTroopFilter
    )) continue;
    ctx.events.push({
      type: 'skill_target',
      unitId: unit.general.id,
      skillId: skill.id,
      targetIds: targets.map((t) => t.general.id),
    });
    ctx.events.push({
      type: 'skill_cast',
      unitId: unit.general.id,
      skillId: skill.id,
      skillName: skill.name,
    });

    // 白衣渡江 delayedOutput：按准备时兵力/属性预先结算伤害（无视规避）
    let storedDamage: LockedCommand['storedDamage'];
    if (skill.delayedOutput) {
      storedDamage = [];
      // 延迟结算目标：默认锁定目标；白衣为全体伤害，用 delayedOutput.targetMode 覆盖
      const mode = resolveCombatTargetMode(skill.delayedOutput.targetMode ?? skill.targetMode, 'all');
      const dmgTargets = skillTargets(ctx, unit, enemies, skill.range, mode);
      // 常驻伤害前叠层（持节镇西）：延迟结算战法在准备阶段对每个目标结算伤害前触发
      const delayedType: 'physical' | 'strategy' = skill.delayedOutput.output.some((o) => o.kind === 'strategy_damage')
        ? 'strategy'
        : 'physical';
      // 各目标结算一次 → 触发一次「造成伤害前叠层」；全体 3 目标叠 3 层，群体 2 目标叠 2 层
      for (const t of dmgTargets) {
        if (!t.alive) continue;
        triggerStackBuff(ctx, unit, t, delayedType);
      }
      // 各目标伤害按结算时的生效属性（含刚叠的谋略增益层）预存
      for (const t of dmgTargets) {
        if (!t.alive) continue;
        const dmg = computeStoredDamage(ctx, unit, skill, t, skill.delayedOutput.output);
        if (dmg) storedDamage.push({ targetId: t.general.id, ...dmg });
      }
    }

    // roundRepeat 目标侧与战法不同时（母仪浮梦：友军规避 + 敌军减伤）另锁一套预备判定目标
    let repeatTargets: UnitState[] | undefined;
    const rrSide = skill.roundRepeat?.targetSide;
    const skillSide = skill.targetSide ?? 'enemy';
    if (rrSide && rrSide !== skillSide) {
      const rrMode = resolveCombatTargetMode(skill.roundRepeat!.targetMode, 'all');
      const rrPool = rrSide === 'ally' ? allies : enemies;
      repeatTargets = skillTargets(ctx, unit, rrPool, skill.range, rrMode);
    }

    ctx.lockedCommands.push({
      skill,
      casterId: unit.general.id,
      targets,
      repeatTargets,
      currentRate: 1,
      storedDamage,
    });

    // 常驻伤害前叠层（持节镇西）：准备阶段对持有者友军全体注册，友军伤害前按层叠属性
    if (skill.stackBuff) {
      ctx.stackBuffs.push({ skillId: skill.id, casterId: unit.general.id, config: skill.stackBuff });
    }

    // 准备阶段一次性效果（其疾如风前3回合速度+41）：无条件施加，不参与 roundRepeat 每回合判定
    if (skill.initialOutput) {
      executeSkillOutputs(ctx, unit, skill, targets, skill.initialOutput);
    }

    // 普通一类指挥（无 roundRepeat/delayedOutput/delayedOutputs/onHurt）：直接执行一次（先驱/避其锋芒/共饮）
    // onHurt 战法准备阶段只登记，output 留到受击时结算（盲侯反击 / 缓师 debuff）
    // onAttrChange 战法准备阶段只登记，output 留到属性升降前结算（举贤决机）
    if (
      !skill.roundRepeat &&
      !skill.delayedOutput &&
      !skill.delayedOutputs &&
      !skill.onHurt &&
      !skill.onAttrChange &&
      !skill.strategyAdjacentBonus
    ) {
      executeSkillOutputs(ctx, unit, skill, targets);
    }
  }
}

/**
 * 预备负面效果判定（战必断金/措手不及/白衣渡江前2回合怯战）：
 * 当锁定目标武将行动时判定，命中该目标则按概率生效
 */
export function triggerPreparedEffectOnAct(ctx: CombatContext, unit: UnitState): void {
  const locked = ctx.lockedCommands.filter((l) => l.skill.roundRepeat && l.skill.phase === 'prep');
  for (const l of locked) {
    const { skill, casterId } = l;
    if (ctx.currentRound < skill.roundRepeat!.startRound || ctx.currentRound > skill.roundRepeat!.endRound) continue;
    const repeatPool = l.repeatTargets ?? l.targets;
    if (!repeatPool.includes(unit)) continue; // 只作用于当前行动的预备判定目标
    if (!unit.alive) continue;
    // 士气修正：预备负面生效几率（战必断金 90% 等）按施法者士气乘算
    const caster = castUnit(ctx, casterId);
    const morale = caster ? effectiveMorale(caster) : 100;
    const rate = moraleTriggerRate(morale, skill.roundRepeat!.rate);
    const success = ctx.rng.chance(rate);
    ctx.events.push({
      type: 'unit_act_start',
      unitId: casterId,
      name: casterName(ctx, casterId),
      position: '中军',
      phase: 'command_skill',
    });
    ctx.events.push({
      type: 'skill_trigger',
      unitId: casterId,
      targetId: unit.general.id,
      skillId: skill.id,
      skillName: skill.name,
      success,
      rate: Math.round(rate * 100),
      baseRate: Math.round(skill.roundRepeat!.rate * 100),
      morale,
    });
    if (!success) continue;
    executeSkillOutputs(ctx, caster ?? unit, skill, [unit]);
  }
}

/**
 * 属性升降「之前」判定（举贤决机）：`inflictStatus` 内、属性状态成功施加**之前**（冲突判定之前）触发。
 * 逐条规则命中「侧别 + 升降方向」时，由存活施法者按 rate（一类指挥生效几率 → 走士气）判定，
 * 命中则对**被施加者**结算该条 output；每次判定发 `skill_trigger`（targetId = 被施加者）。
 */
export function triggerOnAttrChange(
  ctx: CombatContext,
  target: UnitState,
  sign: 'up' | 'down'
): void {
  const rulesOf = (s: Skill): NonNullable<CommandSkill['onAttrChange']> | undefined =>
    s.type === 'command' ? s.onAttrChange : undefined;
  for (const l of [...ctx.lockedCommands]) {
    const rules = rulesOf(l.skill);
    if (!rules || rules.length === 0) continue;
    const caster = ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === l.casterId);
    if (!caster) continue;
    if (!caster.alive && !l.skill.retainAfterDeath) continue;
    const victimSide = caster.side === target.side ? 'ally' : 'enemy';
    for (const rule of rules) {
      if (rule.victim !== victimSide || rule.sign !== sign) continue;
      const morale = effectiveMorale(caster);
      const rate = moraleTriggerRate(morale, rule.rate);
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: caster.general.id,
        skillId: l.skill.id,
        skillName: l.skill.name,
        targetId: target.general.id,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(rule.rate * 100),
        morale,
      });
      if (!success) continue;
      executeSkillOutputs(ctx, caster, l.skill, [target], rule.output);
      if (!caster.alive) break;
    }
  }
}

/**
 * 全队累计伤害门槛（徽言龙凤）：本侧单位每造成 1 次伤害（实际扣兵 > 0）计数 +1，
 * 达到 `count` 时**激活**该战法 —— 立即对锁定目标结算激活段 output，并允许其 roundStartRepeat 开始执行。
 * 计数与激活标记按「战法 × 施法者」记（ctx.teamDamageCounters / ctx.teamThresholdActive）。
 */
function noteTeamDamage(ctx: CombatContext, source: UnitState): void {
  for (const l of [...ctx.lockedCommands]) {
    const cfg = l.skill.type === 'command' ? l.skill.teamDamageThreshold : undefined;
    if (!cfg) continue;
    const caster = castUnit(ctx, l.casterId);
    if (!caster || caster.side !== source.side) continue;
    const key = `${l.casterId}:${l.skill.id}`;
    if (ctx.teamThresholdActive?.has(key)) continue;
    ctx.teamDamageCounters ??= new Map();
    const n = (ctx.teamDamageCounters.get(key) ?? 0) + 1;
    ctx.teamDamageCounters.set(key, n);
    if (n < cfg.count) continue;
    ctx.teamThresholdActive ??= new Set();
    ctx.teamThresholdActive.add(key);
    if (!caster.alive && !l.skill.retainAfterDeath) continue;
    const targets = l.targets.filter((t) => t.alive);
    if (targets.length > 0) executeSkillOutputs(ctx, caster, l.skill, targets, cfg.output);
  }
}

/**
 * 其徐如林：**本侧**单位造成策略伤害生效后，对目标**同侧相邻**单位额外造成一次策略伤害
 * （伤害率 = 原伤害率 × 当前比例；比例 = baseRate + perRound × (当前回合 - 1)，可叠至战斗结束）。
 *  - 光环注册于 `ctx.lockedCommands`（一类指挥）；仅覆盖与施法者**同侧**的伤害来源，施法者阵亡即失效。
 *  - 额外伤害由**原伤害的造成者**结算（沿用其攻击/兵力/增减伤口径），战报 skillId / skillName 记为其徐如林。
 *  - 直接构造 damage 事件（不经 strategy_damage 输出分支）→ 不会递归触发本光环。
 */
function triggerStrategyAdjacentBonus(
  ctx: CombatContext,
  source: UnitState,
  target: UnitState,
  originalRate: number
): void {
  const auras = ctx.lockedCommands.filter(
    (l): l is LockedCommand & { skill: CommandSkill } =>
      l.skill.type === 'command' && !!l.skill.strategyAdjacentBonus
  );
  if (auras.length === 0) return;
  const team = target.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const adjacents = adjacentUnits(target, team);
  if (adjacents.length === 0) return;
  for (const l of auras) {
    const cfg = l.skill.strategyAdjacentBonus!;
    const owner = castUnit(ctx, l.casterId);
    if (!owner) continue;
    if (!owner.alive && !l.skill.retainAfterDeath) continue;
    if (owner.side !== source.side) continue; // 只覆盖「我军全体施加的策略伤害」
    const scale = (v: number): number =>
      cfg.strategyScaled && cfg.growthRate !== undefined
        ? roundRate(scaledValue(v, cfg.growthRate, effectiveStat(owner, 'strategy')))
        : v;
    const ratioPct = scale(cfg.baseRate) + scale(cfg.perRound) * Math.max(0, ctx.currentRound - 1);
    const rate = (originalRate * ratioPct) / 100;
    for (const raw of adjacents) {
      if (!raw.alive) continue;
      triggerStackBuff(ctx, source, raw, 'strategy');
      const hit: DamageHitContext = { damageSource: 'skill', damageType: 'strategy', skillType: l.skill.type };
      const { causedMult, takenMult } = damageBoosts(ctx, source, raw, hit);
      const reduce = sumReduce(raw, hit) + troopCounterReduceOf(source, raw);
      const { damage, breakdown } = calcDamage(
        {
          damageType: 'strategy',
          rate,
          attackerAttack: source.general.attack,
          attackerStrategy: effectiveStat(source, 'strategy'),
          attackerTroops: source.troops,
          targetDefense: raw.general.defense,
          targetStrategy: raw.general.strategy,
          mult: buffMult(causedMult, takenMult, reduce),
        },
        ctx.rng
      );
      const capped = applyTroopCap(damage, raw.troops);
      ctx.events.push({
        type: 'damage',
        sourceId: source.general.id,
        targetId: raw.general.id,
        skillId: l.skill.id,
        skillName: l.skill.name,
        damageType: 'strategy',
        damage: capped,
        breakdown,
        modifiers: collectDamageModifiers(ctx, source, raw, true, hit),
      });
      applyDamage(ctx, raw, capped, source, 'strategy', 'skill');
    }
  }
}

/** 一类指挥延迟结算：到 atRound 回合自动结算。
 *  ① `delayedOutput`（单次、伤害预存）：白衣渡江第 3 回合打出预先结算的伤害。
 *     战报口径（官方）：「【施法者】【战法】的效果使【目标】损失了X兵力(剩余)」+ 「【目标】的来自【施法者】【战法】的策略攻击伤害效果消失了」
 *  ② `delayedOutputs`（多次、不预存）：匠心不竭第 1/3/5 回合分别对锁定目标施加恐慌 / 燃烧 / 妖术。 */
export function triggerDelayedOutputs(ctx: CombatContext, round: number): void {
  for (const l of ctx.lockedCommands) {
    const { skill } = l;
    if (skill.phase !== 'prep') continue;
    if (!skill.delayedOutput && !skill.delayedOutputs) continue;
    // 一类指挥施法者阵亡后效果仍存在（retainAfterDeath）或施法者存活
    const caster = ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === l.casterId);
    if (caster && !caster.alive && !skill.retainAfterDeath) continue;

    if (skill.delayedOutput && round === skill.delayedOutput.atRound) {
      if (l.storedDamage && l.storedDamage.length > 0) {
        // 用预先结算的伤害直接打出（不重新计算）。
        // 注：持节镇西叠层已在准备阶段结算时触发一次（白衣=友军策略伤害），此处不重复叠层
        const damageType: DamageType = skill.delayedOutput.output.some((o) => o.kind === 'strategy_damage')
          ? 'strategy'
          : 'physical';
        for (const d of l.storedDamage) {
          const target = ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === d.targetId);
          if (!target || !target.alive) continue;
          const actual = Math.min(Math.max(0, d.damage), target.troops);
          ctx.events.push({
            type: 'damage',
            sourceId: l.casterId,
            targetId: target.general.id,
            skillId: skill.id,
            skillName: skill.name,
            damageType,
            damage: d.damage,
            breakdown: d.breakdown,
            delayedEffect: true,
            afterTroops: target.troops - actual,
          });
          ctx.events.push({
            type: 'stored_effect_expired',
            unitId: target.general.id,
            sourceId: l.casterId,
            skillId: skill.id,
            skillName: skill.name,
            damageType,
          });
          applyDamage(ctx, target, d.damage, caster, damageType, 'skill');
        }
      } else if (caster) {
        // 非伤害类延迟输出（令明负榇：第 4 回合起进入分兵状态）→ 对锁定目标执行 output
        const aliveTargets = l.targets.filter((t) => t.alive);
        if (aliveTargets.length > 0) {
          executeSkillOutputs(ctx, caster, skill, aliveTargets, skill.delayedOutput.output);
        }
      }
    }

    // 多次分段延迟施加（匠心不竭：第 1 回合恐慌 / 第 3 回合燃烧 / 第 5 回合妖术）
    if (skill.delayedOutputs && caster) {
      for (const entry of skill.delayedOutputs) {
        if (entry.atRound !== round) continue;
        const aliveTargets = l.targets.filter((t) => t.alive);
        if (aliveTargets.length > 0) executeSkillOutputs(ctx, caster, skill, aliveTargets, entry.output);
      }
    }
  }
}

/** 二类指挥（奇兵拒北）：武将行动时判定。动态发动率：未生效+increment，生效重置为 base。施法者兵力为 0 后无法生效 */
export function triggerRoundCommandOnAct(ctx: CombatContext, unit: UnitState): void {
  if (!unit.alive) return; // 二类指挥看实时数据，施法者兵力为 0 后无法生效
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const id of unit.general.commandSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'command' || skill.phase !== 'round') continue;
    if (skill.roundTrigger !== 'on_act') continue;
    if (skill.battleStartOnce) continue; // 战斗开始一次性（当敌制决），不参与每回合判定
    // 每 N 回合判定一次（难知如阴「每2回合」）：1 起算，第 1/3/5...回合生效
    if (skill.everyNRounds && ctx.currentRound % skill.everyNRounds !== 1) continue;

    // 行动叠层（奋疾先登）：行动时稳定叠层（无发动率判定、不锁目标），满层触发攻击
    if (skill.actLayer) {
      ctx.events.push({
        type: 'unit_act_start',
        unitId: unit.general.id,
        name: unit.general.name,
        position: unit.general.position,
        phase: 'command_skill',
      });
      executeActLayer(ctx, unit, skill);
      continue;
    }

    // 查找/初始化锁定目标（二类：准备阶段锁定一次）
    let locked = ctx.lockedCommands.find((l) => l.skill.id === skill.id && l.casterId === unit.general.id);
    if (!locked) {
      let targets: UnitState[];
      if (skill.targetMode === 'self') {
        // 自我增益类（不动如山）：目标为施法者自身
        targets = [unit];
      } else {
        const side = skill.targetSide ?? 'enemy';
        const pool = side === 'ally' ? allies : enemies;
        const mode = resolveCombatTargetMode(skill.targetMode, 'all');
        targets = skillTargets(ctx, unit, pool, skill.range, mode, skill.groupCount);
      }
      if (targets.length === 0) continue;
      locked = { skill, casterId: unit.general.id, targets, currentRate: skill.dynamicTriggerRate?.base ?? skill.triggerRate };
      ctx.lockedCommands.push(locked);
    }

    const currentRate = locked.currentRate;
    // 士气修正：最终发动率 = 动态发动率 × 士气系数，四舍五入取整到百分位，上限 100%
    const morale = effectiveMorale(unit);
    const rate = moraleTriggerRate(morale, currentRate);
    const success = ctx.rng.chance(rate);
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'command_skill',
    });
    if (success) {
      locked.currentRate = skill.dynamicTriggerRate?.base ?? skill.triggerRate; // 生效重置
      ctx.events.push({
        type: 'skill_trigger',
        unitId: unit.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success: true,
        rate: Math.round(rate * 100),
        baseRate: Math.round(currentRate * 100),
        morale,
      });
      executeRoundCommand(ctx, unit, skill, locked.targets);
    } else {
      // 未生效：发动率 +increment
      if (skill.dynamicTriggerRate) {
        locked.currentRate = Math.min(1, locked.currentRate + skill.dynamicTriggerRate.increment);
      }
      ctx.events.push({
        type: 'skill_trigger',
        unitId: unit.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success: false,
        rate: Math.round(rate * 100),
        baseRate: Math.round(currentRate * 100),
        morale,
      });
    }
  }
}

/**
 * 二类指挥·试图发动主动战法前（运筹决胜）：
 * 每次进入主动战法发动率判定前，按各输出 `chance` 独立判定（士气修正），
 * 再按输出自身的目标覆盖结算。准备完成释放、混乱/犹豫无法判定主动、施法者阵亡均不进入此函数。
 */
export function triggerBeforeActiveCommands(ctx: CombatContext, unit: UnitState): void {
  if (!unit.alive) return;
  for (const id of unit.general.commandSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'command' || skill.phase !== 'round') continue;
    if (skill.roundTrigger !== 'before_active') continue;

    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'command_skill',
    });

    const morale = effectiveMorale(unit);
    const passed: SkillOutput[] = [];
    for (const out of skill.output) {
      const chance = 'chance' in out && out.chance != null ? out.chance : 1;
      const rate = moraleTriggerRate(morale, chance);
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: unit.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(chance * 100),
        morale,
      });
      if (success) passed.push(out);
    }
    if (passed.length === 0) continue;
    ctx.events.push({
      type: 'skill_cast',
      unitId: unit.general.id,
      skillId: skill.id,
      skillName: skill.name,
    });
    executeSkillOutputs(ctx, unit, skill, [], passed);
  }
  // 友军监听试图发动主动（谋谟帷幄）：我军全体每次试图发动主动前，由 ally_before_active 指挥判定
  triggerAllyBeforeActiveCommands(ctx, unit);
}

/**
 * 二类指挥·友军监听试图发动主动（谋谟帷幄）：
* 我军全体（含施法者自己）每次试图发动主动战法前，场上存活的 `ally_before_active` 指挥按 triggerRate 判定一次，
* 命中则对敌军按 skill.output 结算；`oncePerRoundPerTarget` 实现「其每回合首次」，
* `extraByTroopRatio` 在**发动者**兵力满足阈值时追加一段独立判定（低于初始兵力 60% 额外策略攻击）。
* 施法者阵亡不触发（二类指挥看实时数据）。
*/
export function triggerAllyBeforeActiveCommands(ctx: CombatContext, actor: UnitState): void {
const team = actor.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
for (const caster of team) {
  if (!caster.alive) continue;
  for (const id of caster.general.commandSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'command' || skill.phase !== 'round') continue;
    if (skill.roundTrigger !== 'ally_before_active') continue;

    if (skill.oncePerRoundPerTarget) {
      ctx.beforeActiveOnceKeys ??= new Set();
      const onceKey = `${ctx.currentRound}:${skill.id}:${caster.general.id}:${actor.general.id}`;
      if (ctx.beforeActiveOnceKeys.has(onceKey)) continue;
      ctx.beforeActiveOnceKeys.add(onceKey);
    }

    const morale = effectiveMorale(caster);
    // 主段：逐 output 按各自 chance 独立判定（沿用 before_active 惯例；缺省必发）
    const passed: SkillOutput[] = [];
    for (const out of skill.output) {
      const chance = 'chance' in out && out.chance != null ? out.chance : 1;
      const rate = moraleTriggerRate(morale, chance);
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: caster.general.id,
        targetId: actor.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(chance * 100),
        morale,
      });
      if (success) passed.push(out);
    }
    if (passed.length > 0) {
      ctx.events.push({
        type: 'skill_cast',
        unitId: caster.general.id,
        skillId: skill.id,
        skillName: skill.name,
      });
      // 友军监听通例：伤害按触发者结算（actor），战报归属仍为携带者（caster）
      executeSkillOutputs(ctx, caster, skill, [], passed, false, actor);
    }

    // 发动者兵力阈值追加段（谋谟帷幄：「我军全体各自低于初始兵力 60% 时…额外发动一次策略攻击」）
    const extra = skill.extraByTroopRatio;
    if (!extra || !troopRatioMatches(actor, extra.cond)) continue;
    const exPassed: SkillOutput[] = [];
    for (const out of extra.output) {
      const chance = 'chance' in out && out.chance != null ? out.chance : 1;
      const rate = moraleTriggerRate(morale, chance);
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: caster.general.id,
        targetId: actor.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(chance * 100),
        morale,
      });
      if (success) exPassed.push(out);
    }
    if (exPassed.length === 0) continue;
    ctx.events.push({
      type: 'skill_cast',
      unitId: caster.general.id,
      skillId: skill.id,
      skillName: skill.name,
    });
    executeSkillOutputs(ctx, caster, skill, [], exPassed, false, actor);
  }
}
}

/**
 * 二类指挥·友军行动监听（七步释嫌）：
 * 我军全体每次发动普攻、试图发动主动或追击时，存活施法者发动一次 skill.output
 * （随机敌军下一次造成伤害降低）；每累计 allyActEvery.count 次再执行追加 output（恢复）。
 * 施法者阵亡不触发（二类指挥看实时数据）。
 */
export function triggerAllyActCommands(ctx: CombatContext, actor: UnitState): void {
  const team = actor.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const caster of team) {
    if (!caster.alive) continue;
    for (const id of caster.general.commandSkillIds) {
      const skill = resolveSkill(ctx, id);
      if (skill?.type !== 'command' || skill.phase !== 'round') continue;
      if (skill.roundTrigger !== 'ally_act') continue;

      const morale = effectiveMorale(caster);
      const rate = moraleTriggerRate(morale, skill.triggerRate);
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: caster.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(skill.triggerRate * 100),
        morale,
      });
      if (!success) continue;

      ctx.events.push({
        type: 'skill_cast',
        unitId: caster.general.id,
        skillId: skill.id,
        skillName: skill.name,
      });
      executeSkillOutputs(ctx, caster, skill, [], skill.output, false, actor);

      ctx.allyActCounters = ctx.allyActCounters ?? new Map();
      const key = `${caster.general.id}:${skill.id}`;
      const n = (ctx.allyActCounters.get(key) ?? 0) + 1;
      ctx.allyActCounters.set(key, n);

      if (skill.allyActEvery && n % skill.allyActEvery.count === 0) {
        ctx.events.push({
          type: 'skill_cast',
          unitId: caster.general.id,
          skillId: skill.id,
          skillName: skill.name,
        });
        executeSkillOutputs(ctx, caster, skill, [], skill.allyActEvery.output, false, actor);
      }
    }
  }
}

/** 二类指挥·行动叠层（奋疾先登）：
 *  行动时获得 1 层增伤（perLayer%，作为 damage_boost 状态累加，可叠加）；
 *  再与场上所有存活单位（不含自己）速度对比：速度高于目标 → speedHigherChance 额外 +1 层，
 *  低于或等于目标 → speedLowerOrEqualChance 额外 +1 层；
 *  **每叠 1 层后立即检查**：层数 × perLayer 达到 cap（40% = 5 层）时，立即对距离 range 内敌军群体
 *  （targetMode）发动一次攻击（skill.output 的 physical_damage，攻击时增伤层仍生效），
 *  发动后层数清空（计数器归零 + 增伤状态移除），并使攻击目标速度属性降低 speedReduce
 *  （同战法重复施加数值累加 = 可叠加，持续到战斗结束），随后**继续**剩余速度对比判定——
 *  一轮行动中可能多次叠满触发多次攻击。 */
function executeActLayer(ctx: CombatContext, unit: UnitState, skill: CommandSkill): void {
  const cfg = skill.actLayer!;
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const key = `${unit.general.id}:${skill.id}`;
  ctx.actLayerCounters = ctx.actLayerCounters ?? new Map();
  let layers = ctx.actLayerCounters.get(key) ?? 0;

  ctx.events.push({
    type: 'skill_cast',
    unitId: unit.general.id,
    skillId: skill.id,
    skillName: skill.name,
  });

  // 触发攻击：对距离 range 内敌军群体发动攻击（当前层数增伤生效），随后清空层数 + 目标降速
  const triggerAttack = (): void => {
    const targets = skillTargets(ctx, unit, enemies, cfg.range, cfg.targetMode);
    if (targets.length > 0) {
      ctx.events.push({
        type: 'skill_target',
        unitId: unit.general.id,
        skillId: skill.id,
        targetIds: targets.map((t) => t.general.id),
      });
      // 攻击：skill.output 的 physical_damage（190%），层数增伤在攻击时仍生效
      executeSkillOutputs(ctx, unit, skill, targets);
      // 攻击目标速度属性降低（可叠加、持续到战斗结束）
      for (const t of targets) {
        if (!t.alive) continue;
        inflictStatus(
          ctx,
          t,
          { type: 'speed_buff', amount: -cfg.speedReduce, duration: 999 },
          skill.type,
          skill.id,
          unit.general.id
        );
      }
    }
    // 层数清空：计数器归零 + 移除本战法施加的增伤状态
    unit.statuses = unit.statuses.filter((s) => !(s.type === 'damage_boost' && s.sourceSkillId === skill.id));
    layers = 0;
  };

  // 叠 1 层后立即检查阈值：达到 cap 立即触发攻击并清空，随后继续判定
  const addLayerAndCheck = (): void => {
    layers += 1;
    // 每层 8% 造成侧增伤（同战法重复施加数值累加）
    inflictStatus(
      ctx,
      unit,
      { type: 'damage_boost', rate: cfg.perLayer / 100, duration: 999, direction: 'caused' },
      skill.type,
      skill.id,
      unit.general.id
    );
    if (layers * cfg.perLayer >= cfg.cap) {
      triggerAttack();
    }
  };

  // 1. 行动时基础 1 层
  addLayerAndCheck();

  // 2. 与场上所有存活单位（不含自己）速度对比，逐单位按概率额外叠层（每次叠满立即触发）。
  //    生效几率受施法者士气修正（战报显示：当前生效几率 = 基础 × 士气系数，如 70% × 1.12 = 78%）
  const mySpeed = effectiveStat(unit, 'speed');
  const actMorale = effectiveMorale(unit);
  for (const t of [...allies, ...enemies]) {
    if (!t.alive || t === unit) continue;
    const tSpeed = effectiveStat(t, 'speed');
    const higher = mySpeed > tSpeed;
    const base = higher ? cfg.speedHigherChance : cfg.speedLowerOrEqualChance;
    const rate = moraleTriggerRate(actMorale, base);
    const ok = ctx.rng.chance(rate);
    ctx.events.push({
      type: 'skill_trigger',
      unitId: unit.general.id,
      targetId: t.general.id,
      skillId: skill.id,
      skillName: skill.name,
      success: ok,
      rate: Math.round(rate * 100),
      baseRate: Math.round(base * 100),
      morale: actMorale,
    });
    if (ok) addLayerAndCheck();
  }

  // 3. 剩余层数（未达阈值部分）存入计数器，供下回合继续累计
  ctx.actLayerCounters.set(key, layers);
}

/** 二类指挥执行：奇兵拒北对锁定目标（敌军大营+中军）打伤害 + 借速度最高友军 */
function executeRoundCommand(ctx: CombatContext, unit: UnitState, skill: CommandSkill, targets: UnitState[]): void {
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  ctx.events.push({
    type: 'skill_target',
    unitId: unit.general.id,
    skillId: skill.id,
    targetIds: targets.map((t) => t.general.id),
  });
  ctx.events.push({
    type: 'skill_cast',
    unitId: unit.general.id,
    skillId: skill.id,
    skillName: skill.name,
  });
  for (const out of skill.output) {
    if (out.kind !== 'positional_physical_damage') {
      // 非伤害输出（不动如山：移除有害效果 + 增益状态）：走通用执行器，目标为锁定目标
      executeSkillOutputs(ctx, unit, skill, targets);
      return;
    }
    // 对指定位置的存活目标（大营/中军）
      const positioned = targets.filter((t) => out.positions.includes(t.general.position) && t.alive);
    // 伤害源：施法者自己 或 速度最高的友军（不含自己）
    const source = out.source === 'self' ? unit : fastestAlly(allies, unit);
    if (!source) continue;
      // 伤害率：固定值 或 区间内每次随机
      const rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
      let attacked = false;
      for (const raw of positioned) {
        if (!raw.alive) continue;
        const t = redirectPhysicalHit(ctx, raw);
        if (!t.alive) continue;
        attacked = true;
        // 常驻伤害前叠层（持节镇西）：伤害源叠攻击、受击者叠防御
        triggerStackBuff(ctx, source, t, 'physical');
        const atk = effectiveStat(source, 'attack');
        const def = physicalTargetDefense(source, t);
        const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: 'command' };
        const { causedMult, takenMult } = damageBoosts(ctx, source, t, hit);
        const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(source, t);
        const reduce = sumReduce(t, hit) + counterReduce;
        const { damage, breakdown } = calcDamage(
          {
            damageType: 'physical',
            rate,
            attackerAttack: atk,
            attackerStrategy: source.general.strategy,
            attackerTroops: source.troops,
            targetDefense: def,
            targetStrategy: t.general.strategy,
            mult: buffMult(causedMult, takenMult, reduce),
          },
          ctx.rng
        );
        const capped = applyTroopCap(damage, t.troops);
      ctx.events.push({
        type: 'damage',
        sourceId: source.general.id,
        // 借速度最高友军攻击（奇兵拒北）：杀伤统计归属施法者（creditToId），而非实际打人者
        creditToId: source.general.id === unit.general.id ? undefined : unit.general.id,
        targetId: t.general.id,
        skillId: skill.id,
        skillName: skill.name,
        damageType: 'physical',
        damage: capped,
        breakdown,
        modifiers: collectDamageModifiers(ctx, source, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
      });
      applyDamage(ctx, t, capped, source, 'physical', 'skill');
    }
    if (attacked) consumeAttackCharges(ctx, source, { damageSource: 'skill', damageType: 'physical', skillType: 'command' });
  }
}

/** 一类指挥 delayedOutput 预先结算：按准备时兵力/属性计算伤害（无视规避）。
 *  生效属性走 effectiveStat（含准备阶段已叠的谋略增益层，如卫瓘持节镇西对吕蒙的叠加） */
function computeStoredDamage(
  ctx: CombatContext,
  caster: UnitState,
  skill: CommandSkill,
  target: UnitState,
  outputs: SkillOutput[]
): { damage: number; breakdown: DamageBreakdown } | null {
  for (const out of outputs) {
    if (out.kind !== 'strategy_damage' && out.kind !== 'physical_damage') continue;
    const damageType = out.kind === 'strategy_damage' ? 'strategy' : 'physical';
    let rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
    const effStrategy = effectiveStat(caster, 'strategy');
    if (out.kind === 'strategy_damage' && out.strategyScaled && out.growthRate !== undefined) {
      rate = roundRate(scaledValue(out.rate, out.growthRate, effStrategy));
    }
    const { damage, breakdown } = calcDamage(
      {
        damageType,
        rate,
        attackerAttack: caster.general.attack,
        attackerStrategy: effStrategy,
        attackerTroops: caster.troops,
        targetDefense: damageType === 'physical' ? physicalTargetDefense(caster, target) : target.general.defense,
        targetStrategy: target.general.strategy,
        // 延迟结算不吃战法增减伤状态，但兵种克制仍加算
        mult: buffMult(1, 1, troopCounterReduceOf(caster, target)),
      },
      ctx.rng
    );
    return { damage: Math.max(1, Math.round(damage)), breakdown };
  }
  return null;
}

/** 被动战法：按 timing 触发（round_start=每回合行动阶段；battle_start=战斗开始准备阶段一次） */
export function triggerPassiveSkills(
  ctx: CombatContext,
  unit: UnitState,
  timing: 'battle_start' | 'round_start' = 'round_start'
): void {
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const id of unit.general.passiveSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'passive' || skill.timing !== timing) continue;
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'passive_skill',
    });
    // 受击触发被动（同仇敌忾）：战斗开始只登记，output 留到受伤时结算。
    // 例外：受击配置自带 output（疮痍累身「每次受伤后叠属性」）时，战法 output 属「准备阶段」段
    // （两轨减伤 + 援护），必须照常结算，否则整段 battle_start 效果丢失。
    const hurtCfg = skill.onHurt ? (Array.isArray(skill.onHurt) ? skill.onHurt : [skill.onHurt]) : [];
    const onHurtOwnsOutput = hurtCfg.some((c) => (c.output?.length ?? 0) > 0);
    if (skill.onHurt && !onHurtOwnsOutput) {
      ctx.events.push({
        type: 'skill_cast',
        unitId: unit.general.id,
        skillId: skill.id,
        skillName: skill.name,
      });
      continue;
    }
    executeSkillWithTargets(ctx, unit, skill, enemies, allies, mixedPool(ctx, unit));
  }
}

function casterName(ctx: CombatContext, casterId: string): string {
  return ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === casterId)?.general.name ?? casterId;
}

function castUnit(ctx: CombatContext, casterId: string): UnitState | undefined {
  return ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === casterId);
}

/** 指挥战法施法者的生效士气（含 morale_boost，缺省 100，系数 1 不变） */
function casterMorale(ctx: CombatContext, casterId: string): number {
  const u = castUnit(ctx, casterId);
  return u ? effectiveMorale(u) : 100;
}

/** 速度最高的存活友军（奇兵拒北借行动；友军=同队其他武将，不含自己）。按生效速度（含速度增益）比较 */
function fastestAlly(allies: UnitState[], exclude?: UnitState): UnitState | undefined {
  const alive = allies.filter((a) => a.alive && a !== exclude);
  if (alive.length === 0) return undefined;
  return alive.reduce((best, cur) => (effectiveStat(cur, 'speed') > effectiveStat(best, 'speed') ? cur : best));
}

/**
 * 谋略最低的存活友军（不含施法者）。并列时速度更低优先，再比站位（前锋 > 中军 > 大营）。
 * 怀德畏威借出手：无存活友军时返回 undefined，调用方跳过该段攻击伤害。
 */
function lowestStrategyAlly(allies: UnitState[], exclude: UnitState): UnitState | undefined {
  const alive = allies.filter((a) => a.alive && a !== exclude);
  if (alive.length === 0) return undefined;
  return alive.reduce((best, cur) => {
    const cs = effectiveStat(cur, 'strategy');
    const bs = effectiveStat(best, 'strategy');
    if (cs !== bs) return cs < bs ? cur : best;
    const cspd = effectiveStat(cur, 'speed');
    const bspd = effectiveStat(best, 'speed');
    if (cspd !== bspd) return cspd < bspd ? cur : best;
    return POSITION_INDEX[cur.general.position] < POSITION_INDEX[best.general.position] ? cur : best;
  });
}

/**
 * 指定属性**最高**的存活友军（西陵克晋：我军当前攻击 / 谋略属性最高的武将）。
 * **含施法者自身**（官方：「也有可能施加给陆抗自己」）；并列时速度更高优先，再比站位（前锋 > 中军 > 大营）。
 * 无存活友军时返回 undefined，调用方跳过该段。
 */
function highestStatAlly(allies: UnitState[], stat: 'attack' | 'strategy'): UnitState | undefined {
  const alive = allies.filter((a) => a.alive);
  if (alive.length === 0) return undefined;
  return alive.reduce((best, cur) => {
    const cs = effectiveStat(cur, stat);
    const bs = effectiveStat(best, stat);
    if (cs !== bs) return cs > bs ? cur : best;
    const cspd = effectiveStat(cur, 'speed');
    const bspd = effectiveStat(best, 'speed');
    if (cspd !== bspd) return cspd > bspd ? cur : best;
    return POSITION_INDEX[cur.general.position] < POSITION_INDEX[best.general.position] ? cur : best;
  });
}

/**
 * 代打者结算后恢复（西陵克晋「并各自恢复一定兵力」）：**立即型急救**——按**代打者当前兵力**走恢复公式，
 * 不落状态、与任何恢复类战法不冲突；官方口径「恢复量与任何属性无关，仅由执行时自身兵力决定」。
 * 恢复值 = calcHealAmount(代打者当前兵力, rate)；heal 事件按仓库口径归属**施法者**（战报统计到陆抗·西陵克晋）。
 */
function healDamageSource(
  ctx: CombatContext,
  skill: Skill,
  caster: UnitState,
  source: UnitState,
  rate: number
): void {
  if (!source.alive || source.troops <= 0) return;
  // 围困：无法回复兵力
  if (hasStatus(source, 'siege')) {
    ctx.events.push({ type: 'siege_blocked', unitId: source.general.id, skillId: skill.id });
    return;
  }
  const amount = calcHealAmount(source.troops, rate);
  const before = source.troops;
  const healed = recoverTroops(ctx, source, amount);
  if (healed > 0) {
    ctx.events.push({
      type: 'heal',
      sourceId: caster.general.id,
      targetId: source.general.id,
      skillId: skill.id,
      skillName: skill.name,
      amount: healed,
      before,
      after: source.troops,
    });
  }
}

/**
 * 常驻伤害前叠层（持节镇西）：友军每次造成攻击伤害前 → 出手方叠攻击；造成策略伤害前 → 出手方叠谋略；
 * 受到伤害前 → 受击者叠防御。攻击/策略/DoT/诅咒/引燃均走此入口。
 * 只作用于持有者的友军（同侧，含持有者自身）。每层各自持续 1 回合（回合结束掉 1 层），至多 maxStacks 层；
 * 数值按持有者（卫瓘）自身对应属性缩放。
 */
function triggerStackBuff(
  ctx: CombatContext,
  actor: UnitState,
  target: UnitState,
  damageType: 'physical' | 'strategy'
): void {
  for (const eff of ctx.stackBuffs) {
    const caster = ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === eff.casterId);
    if (!caster) continue;
    // 一类指挥（持节镇西 retainAfterDeath）：卫瓘阵亡后效果仍存在，按当前面板属性缩放
    // 攻击伤害 → 施法者叠攻击；策略伤害 → 施法者叠谋略（只对持有者友军生效）
    if (actor.side === caster.side) {
      const cfg = damageType === 'physical' ? eff.config.onAttack : eff.config.onStrategy;
      if (cfg) {
        // 攻击 buff 按持有者攻击缩放；谋略 buff 按持有者谋略缩放
        const baseAttr = damageType === 'physical' ? caster.general.attack : caster.general.strategy;
        const amount = Math.round(cfg.perStack + cfg.growthRate * (baseAttr - 80));
        addStackLayer(ctx, actor, damageType === 'physical' ? 'attack_buff' : 'strategy_buff', amount, eff);
      }
    }
    // 两类伤害都 → 受击者叠防御（只对持有者友军生效）
    if (target.side === caster.side && eff.config.onDefense) {
      const amount = Math.round(eff.config.onDefense.perStack + eff.config.onDefense.growthRate * (caster.general.defense - 80));
      addStackLayer(ctx, target, 'defense_buff', amount, eff);
    }
  }
}

const ATTR_STAT_KIND = {
  attack_buff: 'attack',
  defense_buff: 'defense',
  strategy_buff: 'strategy',
  speed_buff: 'speed',
} as const;

const ATTR_STAT_LABEL = {
  attack_buff: '攻击属性',
  defense_buff: '防御属性',
  strategy_buff: '谋略属性',
  speed_buff: '速度属性',
} as const;

/**
 * 属性增减战报（官方口径）：
 *  - 百分比：【目标】的攻击属性降低了22%(30)(170) → 比率(变化点数)(变化后)
 *  - 点数：【目标】的谋略属性提高了32(182) → 增幅(变化后)
 */
function formatAttrChangeDetail(
  target: UnitState,
  type: keyof typeof ATTR_STAT_LABEL,
  opts: { amount: number; percent?: boolean; before: number; after: number; srcPrefix?: string }
): string {
  const verb = opts.amount >= 0 ? '提高了' : '降低了';
  const label = ATTR_STAT_LABEL[type];
  const p = opts.srcPrefix ?? '';
  if (opts.percent) {
    const pct = Math.abs(opts.amount);
    const delta = Math.abs(opts.after - opts.before);
    return `${p}【${target.general.name}】的${label}${verb}${pct}%(${delta})(${opts.after})`;
  }
  return `${p}【${target.general.name}】的${label}${verb}${Math.abs(opts.amount)}(${opts.after})`;
}

/**
 * 叠 1 层属性 buff（持节镇西）：同来源同类型已达 maxStacks 则不再叠；否则 push 新层（每层各自 1 回合）。
 * 战报不按层数：先「执行来自」再接统一属性增减行「提高了增幅(增加后数值)」。
 */
function addStackLayer(
  ctx: CombatContext,
  unit: UnitState,
  type: 'attack_buff' | 'defense_buff' | 'strategy_buff',
  amount: number,
  eff: StackBuffEffect
): void {
  const maxStacks = (
    type === 'attack_buff' ? eff.config.onAttack
      : type === 'defense_buff' ? eff.config.onDefense
        : eff.config.onStrategy
  )!.maxStacks;
  const sameSource = unit.statuses.filter(
    (s) => s.type === type && s.sourceSkillId === eff.skillId
  );
  if (sameSource.length >= maxStacks) return;
  const status: Status =
    type === 'attack_buff'
      ? { type: 'attack_buff', amount, remaining: 1, appliedRound: ctx.currentRound, sourceSkillType: 'command', sourceSkillId: eff.skillId }
      : type === 'defense_buff'
        ? { type: 'defense_buff', amount, remaining: 1, appliedRound: ctx.currentRound, sourceSkillType: 'command', sourceSkillId: eff.skillId }
        : { type: 'strategy_buff', amount, remaining: 1, appliedRound: ctx.currentRound, sourceSkillType: 'command', sourceSkillId: eff.skillId };
  const kind = ATTR_STAT_KIND[type];
  const before = effectiveStat(unit, kind);
  unit.statuses.push(status);
  const after = effectiveStat(unit, kind);
  const caster = casterName(ctx, eff.casterId);
  const skillName = resolveSkill(ctx, eff.skillId)?.name ?? eff.skillId;
  ctx.events.push({
    type: 'status_inflicted',
    unitId: unit.general.id,
    statusType: type,
    detail:
      `【${unit.general.name}】执行来自【${caster}】的【${skillName}】效果！\n` +
      formatAttrChangeDetail(unit, type, { amount, before, after }),
  });
}

// ─── DoT / 分兵 ───

/**
 * DoT 挂上时结算（滞后触发）：按挂上时的增减伤单一总和、施法者兵力、
 * 目标当前防御/谋略、减伤预先计算每次跳伤并冻结，之后每次行动触发直接打出冻结值。
 *  - 兵力按施法者（attacker）挂上时兵力计算（调研公式 calcStrategyDamage 用 attacker.troops）
 *  - 增减伤 = max(10%, 1 + Σ增伤 − Σ减伤)（挂上时冻结，挂上后变化不影响）
 */
function computeDotTickDamage(
  ctx: CombatContext,
  caster: UnitState,
  target: UnitState,
  dot: { rate: number; sourceStrategy: number; sourceSkillId?: string; dotType?: DotType }
): DotStoredDamage {
  const skillType = dot.sourceSkillId ? resolveSkill(ctx, dot.sourceSkillId)?.type : undefined;
  const hit: DamageHitContext = {
    damageSource: 'skill',
    damageType: 'strategy',
    ...(skillType ? { skillType } : {}),
    // DoT 类型维（全主诿异「被施加的燃烧/恐慌/妖术诅咒伤害提升」按此过滤）
    ...(dot.dotType ? { dotType: dot.dotType } : {}),
  };
  const { causedMult, takenMult } = damageBoosts(ctx, caster, target, hit);
  const reduce = sumReduce(target, hit) + troopCounterReduceOf(caster, target);
  const { damage, breakdown } = calcDamage(
    {
      damageType: 'strategy',
      rate: dot.rate,
      attackerAttack: effectiveStat(caster, 'attack'),
      attackerStrategy: dot.sourceStrategy,
      attackerTroops: caster.troops, // 挂上时施法者兵力
      targetDefense: effectiveStat(target, 'defense'),
      targetStrategy: effectiveStat(target, 'strategy'),
      mult: buffMult(causedMult, takenMult, reduce), // 挂上时增减伤合计（含兵种克制）
      isDot: true, // 妖术/燃烧/恐慌：兵力基础 ×1/3、谋略基础 ×0.25
    },
    ctx.rng
  );
  return {
    damage, // 已含挂上时减伤（单一总和内）
    breakdown,
    // 挂上时的增减伤归因（caused/taken/reduce，含兵种克制，战报「增减伤统计」用）
    modifiers: collectDamageModifiers(ctx, caster, target, true, hit),
  };
}

/** 结算一次 DoT/诅咒/引燃伤害：先走持节镇西（策略伤害前叠谋略 / 受击前叠防御），再 push dot_tick 并扣兵。
 *  滞后触发：有挂上时冻结的 stored（引擎施加路径）时直接打出冻结伤害（仅按目标当前兵力截断）；
 *  否则（直接 inflictStatus 且施法者不可解析的单元测试）回退为触发时实时结算：
 *  冻结 rate + sourceStrategy，目标当前生效防御/谋略减免，mult=1 不吃增伤。 */
function dealDotDamage(
  ctx: CombatContext,
  unit: UnitState,
  dot: Extract<Status, { type: 'sorcery' | 'burning' | 'panic' | 'curse' | 'ignite' }>
): void {
  const src = dot.sourceUnitId ? castUnit(ctx, dot.sourceUnitId) : undefined;
  // 燃烧/恐慌/妖术/诅咒/引燃均按策略伤害：友军施法者叠谋略，友军受击者叠防御（持节镇西）
  if (src) {
    triggerStackBuff(ctx, src, unit, 'strategy');
  }
  if (dot.stored) {
    // 滞后触发：挂上时已结算（增伤/兵力/减伤冻结），仅按目标当前兵力截断
    const capped = applyTroopCap(dot.stored.damage, unit.troops);
    ctx.events.push({
      type: 'dot_tick',
      sourceId: unit.general.id,
      targetId: unit.general.id,
      dotType: dot.type,
      skillId: dot.sourceSkillId,
      casterId: dot.sourceUnitId ?? '',
      damage: capped,
      breakdown: dot.stored.breakdown,
      // 挂上时冻结的增减伤归因
      modifiers: dot.stored.modifiers,
    });
    applyDamage(ctx, unit, capped, src, 'strategy', 'skill');
    return;
  }
  // 回退：实时结算（无挂上时冻结上下文）
  const atk = effectiveStat(unit, 'attack');
  const def = effectiveStat(unit, 'defense');
  const strat = effectiveStat(unit, 'strategy');
  const { damage, breakdown } = calcDamage(
    {
      damageType: 'strategy',
      rate: dot.rate,
      attackerAttack: atk,
      attackerStrategy: dot.sourceStrategy,
      attackerTroops: unit.troops,
      targetDefense: def,
      targetStrategy: strat,
      mult: buffMult(1, 1, sumRates(unit.statuses, 'damage_reduce')), // 无增伤（施法者不可解析）；减伤并入单一总和
      isDot: true, // 妖术/燃烧/恐慌：兵力基础 ×1/3、谋略基础 ×0.25
    },
    ctx.rng
  );
  const capped = applyTroopCap(damage, unit.troops);
  ctx.events.push({
    type: 'dot_tick',
    sourceId: unit.general.id,
    targetId: unit.general.id,
    dotType: dot.type,
    skillId: dot.sourceSkillId,
    casterId: dot.sourceUnitId ?? '',
    damage: capped,
    breakdown,
    // 回退路径不携带增减伤提升，只带受击方减伤来源
    modifiers: collectDamageModifiers(ctx, unit, unit, false),
  });
  applyDamage(ctx, unit, capped, src, 'strategy', 'skill');
}

/** 休整每次恢复值：挂上时按施法者兵力/谋略冻结。无施法者时回退目标满兵 + 基础率。 */
function computeRestHealAmount(
  caster: UnitState | undefined,
  target: UnitState,
  create: Extract<CreateStatus, { type: 'rest' }>
): number {
  let rate = create.rate;
  if (create.strategyScaled !== false) {
    const strategy = caster ? effectiveStat(caster, 'strategy') : 80;
    rate = roundRate(scaledValue(create.rate, create.growthRate, strategy));
  }
  const troops = caster ? caster.troops : target.general.maxTroops;
  return calcHealAmount(troops, rate);
}

/** 休整结算：当前回合 ≥ startRound 时按冻结值恢复，然后 remaining -1。 */
function tickRests(ctx: CombatContext, unit: UnitState): void {
  const rests = unit.statuses.filter((s): s is Extract<Status, { type: 'rest' }> => s.type === 'rest');
  for (const s of rests) {
    if (!unit.alive) return;
    if (ctx.currentRound < s.startRound) continue;
    // 兵力阈值条件（巧音唤蝶休整「当目标兵力低于初始兵力 50% 时恢复」）：不满足则本次不跳恢复
    if (s.troopRatio && !troopRatioMatches(unit, s.troopRatio)) continue;
    if (hasStatus(unit, 'siege')) {
      ctx.events.push({ type: 'siege_blocked', unitId: unit.general.id, skillId: s.sourceSkillId });
    } else {
      const before = unit.troops;
      const healed = recoverTroops(ctx, unit, s.healAmount);
      if (healed > 0) {
        ctx.events.push({
          type: 'heal',
          sourceId: s.sourceUnitId ?? unit.general.id,
          targetId: unit.general.id,
          skillId: s.sourceSkillId,
          skillName: resolveSkill(ctx, s.sourceSkillId)?.name ?? s.sourceSkillId,
          amount: healed,
          before,
          after: unit.troops,
        });
      }
    }
    s.remaining -= 1;
    if (s.remaining <= 0) {
      unit.statuses = unit.statuses.filter((x) => x !== s);
      ctx.events.push({
        type: 'status_expired',
        unitId: unit.general.id,
        statusType: 'rest',
      });
    }
  }
}

/** DoT 结算（妖术/燃烧/恐慌）：行动时自动受到伤害 */
function tickDots(ctx: CombatContext, unit: UnitState): void {
  const DOT_TYPES: StatusType[] = ['sorcery', 'burning', 'panic'];
  for (const s of unit.statuses) {
    if (!DOT_TYPES.includes(s.type as StatusType)) continue;
    const dot = s as Extract<Status, { type: 'sorcery' | 'burning' | 'panic' }>;
    // 受击触发妖术（破凰「条件妖术」）：不在行动时跳伤，改由携带者受到伤害时触发
    if (dot.type === 'sorcery' && dot.onHurt) continue;
    // 兵力阈值条件（巧音唤蝶燃烧「当目标兵力高于初始兵力 50% 时受到一次策略伤害」）：不满足则本回合不跳伤
    if (dot.troopRatio && !troopRatioMatches(unit, dot.troopRatio)) continue;
    dealDotDamage(ctx, unit, dot);
    if (!unit.alive) return;
  }
}

/**
 * 兵力阈值判定（troopRatio）：当前兵力 / 初始兵力（maxTroops）× 100。
 * below = 兵力百分比**低于**此值才满足；above = **高于**才满足；两者同时给出须同时满足。
 */
export function troopRatioMatches(target: UnitState, cond: TroopRatioCond): boolean {
  const pct = (target.troops / target.general.maxTroops) * 100;
  if (cond.below != null && !(pct < cond.below)) return false;
  if (cond.above != null && !(pct > cond.above)) return false;
  return true;
}

/** 分兵攻击：普攻命中后，对目标同队的相邻存活单位造成比例攻击伤害（无视攻击距离） */
function executeSplitAttack(
  ctx: CombatContext,
  unit: UnitState,
  primaryTarget: UnitState,
  splitRate: number,
  allies: UnitState[],
  enemies: UnitState[]
): void {
  const targetTeam = primaryTarget.side === 'my' ? allies : enemies;
  const adj = adjacentUnits(primaryTarget, targetTeam);
  for (const adjRaw of adj) {
    if (!adjRaw.alive) continue;
    const adjTarget = redirectPhysicalHit(ctx, adjRaw);
    if (!adjTarget.alive) continue;
    // 常驻伤害前叠层
    triggerStackBuff(ctx, unit, adjTarget, 'physical');
    // 规避
    if (consumeEvasion(ctx, adjTarget, unit.general.id)) continue;
    const atk = effectiveStat(unit, 'attack');
    const def = physicalTargetDefense(unit, adjTarget);
    const hit: DamageHitContext = { damageSource: 'basic', damageType: 'physical', split: true };
    const { causedMult, takenMult } = damageBoosts(ctx, unit, adjTarget, hit);
    const reduce = sumReduce(adjTarget, hit) + troopCounterReduceOf(unit, adjTarget);
    const { damage, breakdown } = calcDamage(
      {
        damageType: 'physical',
        rate: splitRate,
        attackerAttack: atk,
        attackerStrategy: unit.general.strategy,
        attackerTroops: unit.troops,
        targetDefense: def,
        targetStrategy: adjTarget.general.strategy,
        mult: buffMult(causedMult, takenMult, reduce),
      },
      ctx.rng
    );
    const capped = applyTroopCap(damage, adjTarget.troops);
    ctx.events.push({
      type: 'split_damage',
      sourceId: unit.general.id,
      targetId: adjTarget.general.id,
      damage: capped,
      breakdown,
      modifiers: collectDamageModifiers(ctx, unit, adjTarget, true, hit),
    });
    applyDamage(ctx, adjTarget, capped, unit, 'physical', 'skill');
  }
}

// ─── 单武将行动 ───

/** 行动中施加的状态（appliedRound>0）：该单位下次行动开始前计数器减一（非消耗型，remaining 到 0 移除）。
 *  仅递减「上一回合或更早施加」的状态（appliedRound < currentRound）——同一回合刚施加的不减（连击等持续到本回合行动结束）。
 *  行动前施加（appliedRound=0）由回合末 tickStatuses 递减，不在此处理。 */
function tickStatusesOnActStart(ctx: CombatContext, unit: UnitState): void {
  for (const s of [...unit.statuses]) {
    if (s.type === 'evasion') continue; // 规避按层数，不递减
    // 叠层待发（奉令护蜀）：只由「普攻打出 / 受到实际伤害」清空，不按回合递减
    if (s.type === 'pending_stacks') continue;
    // 下一次伤害无视规避（缚父临危）：消耗制，不按回合递减
    if (s.type === 'ignore_evasion') continue;
    // 次数型下一次攻击：不按回合递减，打出后由 consumeAttackCharges 移除
    if (s.type === 'damage_boost' && 'charges' in s && s.charges != null) continue;
    // 次数型分兵：不按回合递减，打出后由 consumeSplitCharges 移除
    if (s.type === 'split' && 'charges' in s && s.charges != null) continue;
    // 待下次行动再生效的暴走（青丘媚祸）：本行动开始时激活，不递减；再下一次行动开始前才到期
    if (s.type === 'rampage' && s.pendingNextAct) {
      s.pendingNextAct = false;
      s.appliedRound = ctx.currentRound;
      continue;
    }
    // first_aid：remaining 递减（Infinity 整场常驻恒不减；金匮要略前 3 回合到期移除）
    if (s.type === 'rest') continue; // 休整 remaining 只在跳恢复时递减
    if (s.appliedRound === 0) continue; // 行动前施加：回合末递减
    if (s.appliedRound >= ctx.currentRound) continue; // 本回合刚施加：持续到行动结束
    s.remaining -= 1;
    if (s.remaining <= 0) {
      unit.statuses = unit.statuses.filter((x) => x !== s);
      // 不 push status_expired（行动开始时静默失效，避免在行动事件流前插入状态过期事件干扰时序断言）
    }
  }
}

export function actUnit(ctx: CombatContext, unit: UnitState): void {
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;

  // 0. 行动中施加的状态递减：计数器回合持续到下次行动开始前（连击/行动中怯战等）
  tickStatusesOnActStart(ctx, unit);
  // 忠克猛烈：施法者行动时清除其施加的受击追加攻击标记（窗口「直到施法者下回合行动前」）
  expireRetaliateOnCasterAct(ctx, unit);

  // 行动阶段判定顺序：被动 → 指挥（预备怯战 + 二类） → DoT → 主动 → 普攻 → 追击 → 分兵
  // 混乱：无法发动主动战法 + 普攻；但被动/指挥/DoT仍正常判定

  // 0. 被动战法（武将行动阶段判定）：只触发 round_start 型；
  //    battle_start 型（血溅黄砂/百战精兵等）已在准备阶段由 triggerPassiveSkills 触发一次，此处跳过避免每回合重复叠加
  for (const id of unit.general.passiveSkillIds) {
    const passive = resolveSkill(ctx, id);
    if (passive?.type !== 'passive' || passive.timing !== 'round_start') continue;
    if (passive.startRound != null && ctx.currentRound < passive.startRound) continue;
    if (passive.endRound != null && ctx.currentRound > passive.endRound) continue;
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'passive_skill',
    });
    executeSkillWithTargets(ctx, unit, passive, enemies, allies, mixedPool(ctx, unit));
  }

  // 0.5 被动 roundStartRepeat：每回合行动阶段、round_start 被动之后、指挥之前。
  // 不在 battle_start 的 triggerPassiveSkills 里跑（开战 output 只走一次）。
  for (const id of unit.general.passiveSkillIds) {
    const p = resolveSkill(ctx, id);
    if (p?.type !== 'passive' || !p.roundStartRepeat) continue;
    const rs = p.roundStartRepeat;
    if (rs.startRound != null && ctx.currentRound < rs.startRound) continue;
    if (rs.endRound != null && ctx.currentRound > rs.endRound) continue;
    if (rs.oddRounds && ctx.currentRound % 2 === 0) continue;
    executeSkillOutputs(ctx, unit, p, [unit], rs.output);
  }

  // 1. 指挥预备负面效果判定（战必/措手/白衣，目标行动时）
  triggerPreparedEffectOnAct(ctx, unit);

  // 2. 二类指挥判定（奇兵拒北，行动时）
  triggerRoundCommandOnAct(ctx, unit);

  // 2.5 休整：每回合行动时按挂上时冻结值恢复（指挥预备判定之后、DoT 之前）
  tickRests(ctx, unit);

  // 3. DoT 结算（妖术/燃烧/恐慌：行动时受到伤害）。先单独开行动组，避免跳伤/持节镇西叠层串进上一位武将的普攻组。
  const hasDot = unit.statuses.some(
    (s) =>
      (s.type === 'sorcery' && !s.onHurt) || s.type === 'burning' || s.type === 'panic'
  );
  if (hasDot) {
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'dot_tick',
    });
  }
  tickDots(ctx, unit);
  if (!unit.alive) {
    unit.hasActedThisRound = true;
    ctx.events.push({ type: 'unit_act_end', unitId: unit.general.id });
    return;
  }

  // 混乱：禁主动战法 + 普攻 + 追击（但被动/指挥/DoT已在上方判定完成）
  if (hasStatus(unit, 'confusion')) {
    ctx.events.push({
      type: 'no_attack_target',
      unitId: unit.general.id,
      name: unit.general.name,
      reason: '混乱：无法行动',
    });
    unit.hasActedThisRound = true;
    ctx.events.push({ type: 'unit_act_end', unitId: unit.general.id });
    return;
  }

  // 4. 怯战检查：怯战期间无法普攻（但可放主动战法）
  const canNormalAttack = !hasStatus(unit, 'cowardice');

  // 暴走：攻击与战法目标不分敌我（可打友军/敌军，不打自己）
  const rampage = hasStatus(unit, 'rampage');
  const combinedPool = [...allies, ...enemies].filter((t) => t.alive && t !== unit);
  const attackPool = rampage ? combinedPool : enemies;

  // 5+6. 主动战法阶段：
  //  - 准备中：prepareLeft > 1 则减 1 继续准备（仍普攻、不再判定其他主动）；
  //    prepareLeft === 1 则 prepare_end 并释放。缺省 1 回合准备与旧行为一致。
  //  - 无准备战法：逐槽判定主动战法（含准备战法的发动率判定，判定成功即进入准备，本回合不再判定其他主动）
  const canCastActive = !hasStatus(unit, 'hesitation');
  if (unit.isPreparing && unit.preparingSkillId) {
    const left = unit.prepareLeft ?? 1;
    if (left > 1) {
      unit.prepareLeft = left - 1;
      // 不释放、不判定其他主动；后面仍普攻
    } else {
      const prepared = resolveSkill(ctx, unit.preparingSkillId);
      if (prepared) {
        ctx.events.push({
          type: 'prepare_end',
          unitId: unit.general.id,
          skillId: prepared.id,
          skillName: prepared.name,
          success: true,
        });
        executePreparedSkill(ctx, unit, prepared, enemies, attackPool);
      } else {
        ctx.events.push({
          type: 'prepare_end',
          unitId: unit.general.id,
          skillId: unit.preparingSkillId,
          skillName: unit.preparingSkillId,
          success: false,
          reason: '战法不存在',
        });
      }
      unit.isPreparing = false;
      unit.preparingSkillId = null;
      unit.prepareLeft = null;
    }
  } else if (canCastActive) {
    for (const id of unit.general.activeSkillIds) {
      const active = resolveSkill(ctx, id);
      if (!active) continue;
      // 运筹决胜等：判定该主动战法发动率之前先走二类指挥 before_active
      triggerBeforeActiveCommands(ctx, unit);
      if (!unit.alive) break;
      ctx.events.push({
        type: 'unit_act_start',
        unitId: unit.general.id,
        name: unit.general.name,
        position: unit.general.position,
        phase: 'active_skill',
      });
      triggerActiveSkill(ctx, unit, active, enemies, allies, attackPool);
      if (unit.isPreparing) break; // 已进入准备，本回合不再判定其他主动
    }
  }

  // 7+8. 普通攻击阶段（连击：至多两次普攻，非乘算；怯战无法普攻）。
  // 追击战法在每次普攻命中后立即判定（连击：普攻→追击→普攻→追击），而非全部普攻结束后统一判定。
  // 时序依赖追击的战法（烈火焚舟：第二刀引爆第一刀挂上的燃烧）依赖该穿插顺序。
  const comboCount = hasStatus(unit, 'combo') ? 2 : 1;
  const hits: UnitState[] = [];
  for (let i = 0; i < comboCount; i++) {
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'normal_attack',
    });
    const hit = normalAttack(ctx, unit, attackPool, allies, canNormalAttack);
    if (hit) {
      hits.push(hit);
      // 本次普攻命中后：逐追击槽判定（目标已死时追击对死目标判定，内部无目标则不生效）
      for (const id of unit.general.pursuitSkillIds) {
        const pursuit = resolveSkill(ctx, id);
        if (!pursuit) continue;
        ctx.events.push({
          type: 'unit_act_start',
          unitId: unit.general.id,
          name: unit.general.name,
          position: unit.general.position,
          phase: 'pursuit_skill',
        });
        triggerPursuitSkill(ctx, unit, pursuit, hit, enemies);
      }
      if (!hit.alive) continue; // 目标已死，继续按连击打下一个
    }
  }

  // 9. 分兵攻击阶段（普攻后无视攻击距离对相邻目标造成比例伤害）
  const splitStatus = getStatus(unit, 'split');
  if (splitStatus) {
    for (const hitTarget of hits) {
      if (!hitTarget.alive) continue;
      executeSplitAttack(ctx, unit, hitTarget, splitStatus.rate, allies, enemies);
      // 次数型分兵（鱼鳞/飒沓）按输出次数消耗；鹤翼等无 charges 的分兵不扣
      if ('charges' in splitStatus && splitStatus.charges != null) consumeSplitCharges(unit);
    }
  }

  unit.hasActedThisRound = true;
  ctx.events.push({ type: 'unit_act_end', unitId: unit.general.id });
}

function resolveSkill(ctx: CombatContext, id: string): Skill | null {
  return ctx.skills.get(id) ?? null;
}

// ─── 状态辅助函数 ───

export function hasStatus(unit: UnitState, type: StatusType): boolean {
  return unit.statuses.some((s) => s.type === type);
}

export function getStatus<T extends StatusType>(
  unit: UnitState,
  type: T
): Extract<Status, { type: T }> | undefined {
  return unit.statuses.find((s) => s.type === type) as Extract<Status, { type: T }> | undefined;
}

/** 施加状态（带冲突判定）：
 *  规则：先判战法类型（被动/指挥/主动/追击），再判非「伤害」标签是否冲突
 *  - 同一战法重复触发 → 增益累加 / 控制刷新剩余（步步为营每回合叠加）
 *  - 同类型不同战法 → 冲突：控制先施加者生效、增益数值替换取较高（战必 vs 措手不及 / 避其锋芒 vs 共饮避世）
 *  - 不同类型 → 各自计数共存（战必指挥怯战 vs 玄武洰流主动怯战）
 */
export function inflictStatus(
  ctx: CombatContext,
  target: UnitState,
  create: CreateStatus,
  sourceSkillType: SkillType,
  sourceSkillId: string,
  casterId?: string
): void {
  if ('duration' in create && Array.isArray(create.duration)) {
    const [a, b] = create.duration;
    create = { ...create, duration: ctx.rng.intInclusive(a, b) } as CreateStatus;
  }
  const type = create.type;

  // 属性升降「之前」判定（举贤决机）：属性状态成功施加**之前**（冲突判定之前）先判一次。
  // 「每种属性单独计算」= 攻击/防御/谋略/速度各是一个状态，这里每个状态各触发一次。
  const ATTR_STATUS_TYPES: StatusType[] = ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'];
  if (ATTR_STATUS_TYPES.includes(type) && 'amount' in create) {
    triggerOnAttrChange(ctx, target, create.amount >= 0 ? 'up' : 'down');
  }

  // 洞察：免疫控制类效果（混乱/怯战/暴走/犹豫）
  const CONTROL_TYPES: StatusType[] = ['confusion', 'rampage', 'cowardice', 'hesitation'];
  if (CONTROL_TYPES.includes(type) && hasStatus(target, 'insight')) {
    ctx.events.push({
      type: 'insight_blocked',
      unitId: target.general.id,
      statusType: type,
    });
    return;
  }

  // 免疫怯战（魏武之泽）：只挡怯战、不挡其他控制；同样在施加前判定，免疫状态在则不施加
  if (type === 'cowardice' && hasStatus(target, 'cowardice_immune')) {
    ctx.events.push({
      type: 'cowardice_immune_blocked',
      unitId: target.general.id,
      statusType: type,
    });
    return;
  }

  // 持续型急救（皇裔流离/金匮要略）：同为指挥战法的持续型急救互斥——先施加者生效，后施加者被拒；
  // 不同战法类型（被动/主动/追击的急救）各自独立共存
  if (type === 'first_aid') {
    const existing = target.statuses.find((s) => s.type === 'first_aid');
    if (existing && existing.sourceSkillType === 'command' && sourceSkillType === 'command') {
      ctx.events.push({
        type: 'status_conflict',
        unitId: target.general.id,
        statusType: type,
        sourceSkillType,
        detail: `持续型急救冲突（已有${skillTypeName(existing.sourceSkillType)}战法${resolveSkill(ctx, existing.sourceSkillId)?.name ?? existing.sourceSkillId}施加的持续型急救），先施加者生效，未生效`,
      });
      return;
    }
    pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
    return;
  }

  // 休整：挂上时冻结每次恢复值。指挥与主动不同类型共存；同类型不同战法取 healAmount 较高替换。
  if (type === 'rest') {
    const restCreate = create as Extract<CreateStatus, { type: 'rest' }>;
    const caster = casterId ? castUnit(ctx, casterId) : undefined;
    const healAmount = computeRestHealAmount(caster, target, restCreate);
    const sameSource = target.statuses.find(
      (s): s is Extract<Status, { type: 'rest' }> =>
        s.type === 'rest' && s.sourceSkillType === sourceSkillType && s.sourceSkillId === sourceSkillId
    );
    if (sameSource) {
      sameSource.remaining = Math.max(sameSource.remaining, restCreate.duration);
      sameSource.healAmount = healAmount;
      sameSource.startRound = Math.min(sameSource.startRound, restCreate.startRound ?? 1);
      ctx.events.push({
        type: 'status_inflicted',
        unitId: target.general.id,
        statusType: 'rest',
        detail: `休整 刷新 每次恢复 ${healAmount}`,
      });
      return;
    }
    const sameType = target.statuses.find(
      (s): s is Extract<Status, { type: 'rest' }> =>
        s.type === 'rest' && s.sourceSkillType === sourceSkillType && s.sourceSkillId !== sourceSkillId
    );
    if (sameType) {
      if (healAmount > sameType.healAmount) {
        target.statuses = target.statuses.filter((s) => s !== sameType);
        pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
      } else {
        ctx.events.push({
          type: 'status_conflict',
          unitId: target.general.id,
          statusType: 'rest',
          sourceSkillType,
          detail: `休整冲突（已有${skillTypeName(sameType.sourceSkillType)}战法${resolveSkill(ctx, sameType.sourceSkillId)?.name ?? sameType.sourceSkillId}），取较高未替换`,
        });
      }
      return;
    }
    pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
    return;
  }

  // 受击追加攻击标记（忠克猛烈）：独立共存，不参与冲突判定
  if (type === 'retaliate') {
    pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
    return;
  }

  // DoT（妖术/燃烧/恐慌）+ 妖术诅咒（curse）+ 引燃标记（ignite）：各自独立共存，不参与冲突判定。
  // 挂上时结算（滞后触发）：施法者可解析时，按挂上时的增伤合计/施法者兵力/目标防御谋略/减伤
  // 预先计算每次跳伤并冻结（stored），之后触发直接打出；施法者不可解析时无 stored，
  // 由 dealDotDamage 回退为触发时实时结算
  const DOT_TYPES: StatusType[] = ['sorcery', 'burning', 'panic', 'curse', 'ignite'];
  if (DOT_TYPES.includes(type)) {
    const caster = casterId ? castUnit(ctx, casterId) : undefined;
    let stored: DotStoredDamage | undefined;
    if (caster) {
      const dotCreate = create as Extract<CreateStatus, { type: 'sorcery' | 'burning' | 'panic' | 'curse' | 'ignite' }>;
      stored = computeDotTickDamage(ctx, caster, target, {
        rate: dotCreate.rate,
        sourceStrategy: dotCreate.sourceStrategy ?? effectiveStat(caster, 'strategy'),
        sourceSkillId,
        dotType: dotCreate.type,
      });
    }
    pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId, stored);
    return;
  }

  // 增减伤方向：damage_boost 按方向匹配（造成侧与受到侧各自独立，不互相冲突/累加）
  const boostDir = type === 'damage_boost' ? (create.type === 'damage_boost' ? (create.direction ?? 'taken') : undefined) : undefined;

  // 同一战法此前施加过的同名效果（damage_boost 需同方向且过滤维一致；
  // 方圆普攻减伤 vs 主动/追击增伤是两段独立效果，不得把 rate 累成 −0.032）
  const sameSource = target.statuses.find(
    (s) =>
      s.type !== 'first_aid' &&
      s.type !== 'rest' &&
      s.type === type &&
      s.sourceSkillType === sourceSkillType &&
      s.sourceSkillId === sourceSkillId &&
      (boostDir === undefined || !('direction' in s) || s.direction === boostDir) &&
      sameDamageBoostFilter(s, create)
  );
  // 同战法类型、不同战法施加的同名效果（damage_boost 需同方向）。
  // 增减伤 / 属性类必须找同号：跳过反号实例。否则 find 先命中方圆 −20% basic，
  // 大赏 +30% 被当成「正负相反、共存」，同号的 +16.8% 永远进不了取较高。
  const sameTypeUsesSign =
    type === 'damage_boost' ||
    type === 'attack_buff' || type === 'defense_buff' ||
    type === 'strategy_buff' || type === 'speed_buff';
  const incomingSign = sameTypeUsesSign ? conflictSign(statusValue(create)) : undefined;
  // 增减伤「分类键」（大类|小类）：分类不同的增伤/减伤是**不同效果**，各自共存进加算池，
  // 不得被判同类取较高吞掉（用户口径 2026-09-16：【攻击伤害提高】+【主动战法伤害提高】直接相加）。
  // 非增减伤一律 undefined → 不进这道闸门，属性类/控制类行为不变。
  const incomingClass = createClassKey(create);
  const sameType = target.statuses.find(
    (s) =>
      s.type !== 'first_aid' &&
      s.type !== 'rest' &&
      s.type === type &&
      s.sourceSkillType === sourceSkillType &&
      s.sourceSkillId !== sourceSkillId &&
      (incomingClass === undefined || statusClassKey(s) === incomingClass) &&
      (boostDir === undefined || !('direction' in s) || s.direction === boostDir) &&
      (incomingSign === undefined || conflictSign(statusValue(s)) === incomingSign)
  );
  // 不同战法类型施加的同名效果
  const diffType = target.statuses.find((s) => s.type !== 'first_aid' && s.type !== 'rest' && s.type === type && s.sourceSkillType !== sourceSkillType);

  if (sameSource) {
    // 次数型下一次增减伤 / 待生效暴走：已有则不刷新，避免叠加或永控
    if (type === 'damage_boost' && create.type === 'damage_boost' && create.charges != null && !create.chargesStack) return;
    if (type === 'rampage' && create.type === 'rampage' && create.pendingNextAct) return;
    // 同战法同过滤维叠层达到 maxStacks 后不再加 rate（文德椒房 3）
    if (type === 'damage_boost' && create.type === 'damage_boost' && create.maxStacks != null) {
      const stacks = (sameSource as { stacks?: number }).stacks ?? 1;
      if (stacks >= create.maxStacks) return;
    }
    // 同一战法重复触发：数值类累加，规避加层，控制刷新剩余
    if (sameSource.type === 'evasion') {
      if (create.type === 'evasion') sameSource.stacks += create.stacks;
    } else if (sameSource.type === 'attack_buff' || sameSource.type === 'defense_buff' || sameSource.type === 'strategy_buff' || sameSource.type === 'speed_buff' || sameSource.type === 'damage_reduce' || sameSource.type === 'damage_boost' || sameSource.type === 'trigger_boost' || sameSource.type === 'morale_boost' || sameSource.type === 'range_buff') {
      if ('amount' in sameSource && 'amount' in create) {
        sameSource.amount += create.amount;
        // 官方口径（疮痍累身截图）：同类属性增益重复施加 → 「【周泰】的攻击属性提高效果刷新了」
        if (type in ATTR_STAT_LABEL) {
          const label = ATTR_STAT_LABEL[type as keyof typeof ATTR_STAT_LABEL];
          ctx.events.push({
            type: 'status_changed',
            unitId: target.general.id,
            statusType: type,
            detail: `${label}${create.amount >= 0 ? '提高' : '降低'}效果刷新了`,
          });
        }
      } else if ('rate' in sameSource && 'rate' in create) {
        sameSource.rate += create.rate;
        // 叠层计数（银龙冲阵）：带上限的增减伤每层 +1
        if (type === 'damage_boost' && 'stacks' in sameSource) {
          (sameSource as { stacks?: number }).stacks = (sameSource.stacks ?? 1) + ('stacks' in create ? (create.stacks ?? 1) : 1);
        }
      }
      if (create.type !== 'evasion') sameSource.remaining = Math.max(sameSource.remaining, remainingFromDuration(create.duration));
    } else if (create.type !== 'evasion' && 'remaining' in sameSource) {
      sameSource.remaining = Math.max(sameSource.remaining, remainingFromDuration(create.duration));
    }
    /**
     * 反击同战法重挂：刷新 appliedRound，并沿用本次 rate。
     * 否则第 2 回合 roundStartRepeat 只续 remaining，行动开始时 tickStatusesOnActStart
     * 会把 appliedRound=1 当成「上回合施加」递减掉，本回合行动后反击失效。
     */
    if (sameSource.type === 'counter' && create.type === 'counter') {
      sameSource.appliedRound = ctx.currentRound;
      sameSource.rate = create.rate;
    }
    // 士气提高同战法累加需发战报（谋议宏图：8→16→32），否则回合前叠层无事件
    if (sameSource.type === 'morale_boost' && 'amount' in sameSource) {
      const durText = sameSource.remaining >= 999 ? '持续至战斗结束' : `持续 ${sameSource.remaining} 回合`;
      ctx.events.push({
        type: 'status_inflicted',
        unitId: target.general.id,
        statusType: 'morale_boost',
        detail: `${statusName('morale_boost')} ${sameSource.amount} ${durText}`,
      });
    }
    if (sameSource.type === 'damage_boost' && create.type === 'damage_boost' && create.chargesStack && 'rate' in sameSource) {
      const pct = Math.round(Math.abs(sameSource.rate) * 100);
      const dirName = sameSource.direction === 'caused' ? '造成的' : '受到的';
      const verb = sameSource.rate < 0 && pct > 90 ? '大幅降低' : `${sameSource.rate >= 0 ? '提高' : '降低'} ${pct}%`;
      ctx.events.push({
        type: 'status_inflicted',
        unitId: target.general.id,
        statusType: 'damage_boost',
        detail: `下一次${dirName}伤害${verb}`,
      });
    }
    return;
  }

  if (sameType) {
    // 同类型不同战法：冲突
    if (sameType.type === 'confusion' || sameType.type === 'rampage' || sameType.type === 'cowardice' || sameType.type === 'hesitation' || sameType.type === 'combo') {
      // 控制：先施加者生效，后施加者被拒
      ctx.events.push({
        type: 'status_conflict',
        unitId: target.general.id,
        statusType: sameType.type,
        sourceSkillType,
        detail: `${statusName(sameType.type)}冲突（已有${skillTypeName(sameType.sourceSkillType)}战法施加的${statusName(sameType.type)}），未生效`,
      });
      return;
    }
    // 增减伤（damage_boost）：**同分类键 + 同类型不同战法**才冲突、数值取较高替换（用户确认——大赏三军 30% 与
    // 奋疾先登叠层同为指挥增伤互相冲突替换，不叠加）。分类键（大类|小类，见 damageClassKey）不同 →
    // 两者在 sameType 查找阶段就已错过，走下方「不同类型各自共存」新增独立实例、进同一加算池。
    // 奋疾先登自身的层数计数与满层触发攻击
    // 独立于增伤状态冲突（actLayerCounters 战法级计数），层照叠、满 5 层照砍。
    // 银龙冲阵等带 stacks 上限的增减伤各自独立计数（施加方自行封顶）。
    // **正负号相反（增伤 vs 减伤，如无心恋战 -30% 与奋疾先登叠层 +32%）不冲突、各自共存**，
    // 由 buffMult 单一总和模型互相抵消（率土增伤减伤加算）——避免「增伤冲突」误报与减伤被替换吞掉。
    // 属性类（attack/defense/strategy/speed_buff）：按正负分桶——
    // 一减一增（如曹操魏武之世速度-15 与张辽其疾如风速度+41）互不冲突，各自共存；
    // 同号才冲突：数值替换取较高、持续取较长
    const isAttrBuff =
      sameType.type === 'attack_buff' || sameType.type === 'defense_buff' ||
      sameType.type === 'strategy_buff' || sameType.type === 'speed_buff';
    const isBoost = sameType.type === 'damage_boost';
    const incomingVal = statusValue(create);
    const curVal = statusValue(sameType);
    if ((isAttrBuff || isBoost) && conflictSign(incomingVal) !== conflictSign(curVal)) {
      // 正负相反 → 不冲突，新增独立实例共存（增伤与减伤由 buffMult 单一总和模型互相抵消）
      pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
      return;
    }
    // 增益（或同号属性类）：数值替换取较高，持续取较长
    if (incomingVal > curVal) {
      if (sameType.type === 'evasion') {
        if (create.type === 'evasion') sameType.stacks = create.stacks;
      } else if (sameType.type === 'attack_buff' || sameType.type === 'defense_buff' || sameType.type === 'strategy_buff' || sameType.type === 'speed_buff' || sameType.type === 'damage_reduce' || sameType.type === 'damage_boost' || sameType.type === 'trigger_boost' || sameType.type === 'morale_boost' || sameType.type === 'ignore_def') {
        // 维度不同（点数 vs 百分比）无法直接比较时，后施加者替换
        const sameDim =
          ('amount' in sameType && 'amount' in create) &&
          ('percent' in sameType ? Boolean(sameType.percent) : false) ===
            ('percent' in create ? Boolean(create.percent) : false);
        if (sameDim) {
          if ('amount' in sameType && 'amount' in create) sameType.amount = create.amount;
          else if ('rate' in sameType && 'rate' in create) sameType.rate = create.rate;
        } else {
          // 异维替换：直接替换数值与模式
          if ('amount' in sameType && 'amount' in create) {
            sameType.amount = create.amount;
            (sameType as { percent?: boolean }).percent = Boolean('percent' in create && create.percent);
          } else if ('rate' in sameType && 'rate' in create) {
            sameType.rate = create.rate;
          }
        }
        if (create.type === 'trigger_boost' && sameType.type === 'trigger_boost') {
          sameType.skillTypes = create.skillTypes;
          sameType.additive = create.additive;
        }
        // 增减伤过滤元数据随胜者走（与 trigger_boost.skillTypes 同理）：有则写入，缺省则清掉败者残留
        if (
          (create.type === 'damage_boost' && sameType.type === 'damage_boost') ||
          (create.type === 'damage_reduce' && sameType.type === 'damage_reduce')
        ) {
          applyDamageFilterFromWinner(sameType, create);
        }
        sameType.sourceSkillId = sourceSkillId;
        if (casterId) (sameType as { sourceUnitId?: string }).sourceUnitId = casterId;
      }
    }
    if (sameType.type !== 'evasion' && create.type !== 'evasion' && 'remaining' in sameType) {
      sameType.remaining = Math.max(sameType.remaining, remainingFromDuration(create.duration));
    }
    ctx.events.push({
      type: 'status_conflict',
      unitId: target.general.id,
      statusType: sameType.type,
      sourceSkillType,
      detail: `${statusName(sameType.type)}冲突，数值取较高 ${Math.max(incomingVal, curVal)}`,
    });
    return;
  }

  // 不同类型：各自计数共存（新增独立实例）
  pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId);
}

/**
 * 同源 damage_boost 只有过滤维（来源 / 战法类型 / 伤害类型 / 有无 charges）一致才视为同一条、允许累加。
 * charges 只比「有/无」，不比具体次数。过滤维不同则视为独立效果（火兽冲锋常驻 vs 次数刀）。
 * 非 damage_boost 一律视为可累加。
 */
/** 伤害类型中文口径（疮痍累身按类型分轨的文案）：率土只有「攻击伤害 / 策略攻击伤害」两类 */
function damageKindText(t?: 'physical' | 'strategy'): string {
  if (t === 'physical') return '攻击伤害';
  if (t === 'strategy') return '策略攻击伤害';
  return '伤害';
}

/**
 * 增伤/减伤「分类键」（用户口径 2026-09-16）= `大类|小类`：
 *
 * - **大类**（伤害类型维）：`全域`（无限定，官方措辞「造成的伤害提高」）｜`攻击`（damageType physical）
 *   ｜`谋略`（damageType strategy）
 * - **小类**（战法来源维）：`普通`（damageSource basic，官方措辞「普通攻击伤害提高」）｜
 *   `主动` / `追击` / `指挥`（skillTypes，可多值，官方措辞「×战法伤害提高」）｜`无`
 *
 * 规则：**分类键不同 → 各自共存、进同一加算池**（buffMult 单一总和模型天然加算）；
 * 分类键相同 **且来源战法类型相同** → 冲突、数值取较高。全域是独立一类，
 * 与攻击/谋略大类、与四个小类都能叠加（血溅黄砂 +120% 全域 与 虎步关右 +70% 攻击 → +190%）。
 *
 * 依据：官方战法库措辞分布（造成的伤害提高 21 条 / 攻击伤害提高 5 / 策略伤害提高 1 /
 * 主动战法伤害提高 23 / 追击 8 / 指挥 1 / 普通攻击 10），分类必须照官方措辞切，不得合并。
 */
export function damageClassKey(s: {
  damageType?: 'physical' | 'strategy';
  damageSource?: 'basic' | 'skill';
  skillTypes?: SkillType[];
}): string {
  const major = s.damageType === 'physical' ? '攻击' : s.damageType === 'strategy' ? '谋略' : '全域';
  // 小类优先级：普攻（damageSource basic）> 具体战法类型（skillTypes，可多值）> 战法通类（只有 damageSource skill）
  // > 无限制。三种「来源维」互不混淆：全伤害提高 ≠ 战法伤害提高 ≠ 普通攻击伤害提高。
  const minor =
    s.damageSource === 'basic'
      ? '普通'
      : s.skillTypes && s.skillTypes.length > 0
        ? [...s.skillTypes].sort().map(skillTypeName).join('/')
        : s.damageSource === 'skill'
          ? '战法'
          : '无';
  return `${major}|${minor}`;
}

/** 状态实例的分类键；非增减伤返回 undefined（不参与分类判定）。 */
function statusClassKey(s: Status): string | undefined {
  if (s.type !== 'damage_boost' && s.type !== 'damage_reduce') return undefined;
  return damageClassKey(s);
}

/** 新施加效果的分类键；非增减伤返回 undefined。 */
function createClassKey(c: CreateStatus): string | undefined {
  if (c.type !== 'damage_boost' && c.type !== 'damage_reduce') return undefined;
  return damageClassKey(c);
}

function sameDamageBoostFilter(existing: Status, incoming: CreateStatus): boolean {
  // 增减伤的同源合并必须过滤维一致：疮痍累身「受攻击伤害减伤 / 受策略伤害减伤」是两条
  // 独立衰减轨，若被判同源会把 rate 累成 1.68；方圆「普攻减伤 vs 主动/追击增伤」同理。
  if (existing.type !== 'damage_boost' && existing.type !== 'damage_reduce') return true;
  if (incoming.type !== 'damage_boost' && incoming.type !== 'damage_reduce') return true;
  const norm = (types?: SkillType[]) => [...(types ?? [])].sort().join(',');
  const normDots = (types?: DotType[]) => [...(types ?? [])].sort().join(',');
  // charges 仅 damage_boost 有（次数型下一次攻击）；damage_reduce 无此字段，用 in 安全探测
  const hasCharges = (s: Status | CreateStatus): boolean =>
    'charges' in s ? (s as { charges?: number }).charges != null : false;
  return (
    (existing.damageSource ?? undefined) === (incoming.damageSource ?? undefined) &&
    (existing.damageType ?? undefined) === (incoming.damageType ?? undefined) &&
    norm(existing.skillTypes) === norm(incoming.skillTypes) &&
    normDots(existing.dotTypes) === normDots('dotTypes' in incoming ? incoming.dotTypes : undefined) &&
    hasCharges(existing) === hasCharges(incoming) &&
    // 「仅进行攻击」维（缚父临危）：与全局增伤是两条独立轨，不判同源
    ('attackOnly' in existing ? Boolean(existing.attackOnly) : false) ===
      ('attackOnly' in incoming ? Boolean(incoming.attackOnly) : false)
  );
}

/**
 * 同类型冲突「取较高替换」时，把胜者的伤害过滤字段写到存活实例。
 * 胜者有字段则写入；胜者缺省则 delete，避免败者过滤维残留导致错吃/错收窄。
 */
function applyDamageFilterFromWinner(
  surviving: { damageSource?: 'basic' | 'skill'; skillTypes?: SkillType[]; damageType?: 'physical' | 'strategy' },
  winner: { damageSource?: 'basic' | 'skill'; skillTypes?: SkillType[]; damageType?: 'physical' | 'strategy' },
): void {
  if ('damageSource' in winner && winner.damageSource != null) surviving.damageSource = winner.damageSource;
  else delete surviving.damageSource;
  if ('skillTypes' in winner && winner.skillTypes != null) surviving.skillTypes = winner.skillTypes;
  else delete surviving.skillTypes;
  if ('damageType' in winner && winner.damageType != null) surviving.damageType = winner.damageType;
  else delete surviving.damageType;
}

/**
 * 冲突分桶用正负号：负 / 零 / 正 → -1 / 0 / 1。
 * sameType 找同号时跳过反号，让同号走取较高；反号仍走既有共存。
 */
function conflictSign(v: number): -1 | 0 | 1 {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/** 读取状态数值（规避取层数，攻击/防御/减伤取数值/比率） */
function statusValue(x: CreateStatus | Status): number {
  if (x.type === 'evasion') return x.stacks;
  return 'amount' in x ? x.amount : 'rate' in x ? x.rate : 0;
}

function pushStatus(
  ctx: CombatContext,
  target: UnitState,
  create: CreateStatus,
  sourceSkillType: SkillType,
  sourceSkillId: string,
  casterId?: string,
  stored?: DotStoredDamage
): void {
  const type = create.type;
  // 施加回合：准备阶段 currentRound=0 → 行动前施加；正式回合 → 行动中施加
  const appliedRound = ctx.currentRound;
  // 计数器型回合数：行动前施加（appliedRound=0）回合末递减（tickStatuses）；
  // 行动中施加（appliedRound>0）持续到该单位下次行动开始前递减（actUnit 开头）。
  // remaining 统一为 duration（两种施加点都从 duration 开始数）；规避按层数无 remaining
  const remaining = type === 'evasion' ? 0 : remainingFromDuration('duration' in create ? create.duration : 0);
  if (type === 'evasion') {
    target.statuses.push({ type: 'evasion', stacks: create.stacks, appliedRound, sourceSkillType, sourceSkillId });
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `规避 +${create.stacks} 层`,
    });
    return;
  }
  if (type === 'ignore_evasion') {
    // 缚父临危：下一次造成伤害无视规避（消耗制；同战法重复施加只刷新，不叠加）
    const dup = target.statuses.some((s) => s.type === 'ignore_evasion' && s.sourceSkillId === sourceSkillId);
    if (!dup) {
      target.statuses.push({ type: 'ignore_evasion', appliedRound, sourceSkillType, sourceSkillId, sourceUnitId: casterId });
    }
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: '下一次造成的伤害无视规避',
    });
    return;
  }
  if (type === 'evade_chance') {
    // 概率规避（列营守险）：受击时消耗 1 次机会并掷 rate，命中则完全免疫该次伤害（见 consumeEvasion）
    const push: Status = { type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status;
    (push as { rate: number }).rate = create.rate;
    (push as { charges: number }).charges = create.charges;
    if (casterId) (push as { sourceUnitId?: string }).sourceUnitId = casterId;
    target.statuses.push(push);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `概率规避 ${Math.round(create.rate * 100)}% 共 ${create.charges} 次 ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
    });
    return;
  }
  if (type === 'retaliate') {
    // 受击追加攻击标记（忠克猛烈）：标记挂在**目标**身上，施法者在目标每次受攻击伤害后追加 1 次攻击
    const push: Status = {
      type: 'retaliate',
      rate: create.rate,
      maxTriggers: create.maxTriggers,
      triggers: 0,
      remaining,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
      sourceUnitId: casterId ?? '',
    };
    target.statuses.push(push);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `每受到攻击伤害由施法者追加 1 次攻击（${create.rate}%，最多 ${create.maxTriggers} 次，直到施法者下回合行动前）`,
    });
    return;
  }
  if (type === 'range_buff') {    // 攻击距离提高（帝临回光「使自身攻击距离 +1」）：只放大普攻可达距离上限，
    // 由 target.ts attackRangeOf 求和，不影响战法有效距离（skill.range）
    const push: Status = { type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status;
    (push as { amount: number }).amount = create.amount;
    if (casterId) (push as { sourceUnitId?: string }).sourceUnitId = casterId;
    target.statuses.push(push);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `攻击距离 +${create.amount} ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
    });
    return;
  }
  if (type === 'attack_buff' || type === 'defense_buff' || type === 'strategy_buff' || type === 'speed_buff') {
    const kind = ATTR_STAT_KIND[type];
    const before = effectiveStat(target, kind);
    const push: Status = { type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status;
    (push as { amount: number }).amount = create.amount;
    if (create.percent) (push as { percent?: boolean }).percent = true;
    if (casterId) (push as { sourceUnitId?: string }).sourceUnitId = casterId;
    target.statuses.push(push);
    const after = effectiveStat(target, kind);
    // 官方口径（见疮痍累身战报截图）：属性增减行前缀「【施法者】【战法名】的效果使」；
    // 取不到施法者/战法名时（直连 inflictStatus 的单测等）不加前缀，保持原格式
    const srcUnit = casterId ? castUnit(ctx, casterId) : undefined;
    const srcSkillName = ctx.skills.get(sourceSkillId)?.name;
    const srcPrefix = srcUnit && srcSkillName ? `【${srcUnit.general.name}】【${srcSkillName}】的效果使` : '';
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: formatAttrChangeDetail(target, type, {
        amount: create.amount,
        percent: create.percent,
        before,
        after,
        srcPrefix,
      }),
    });
    return;
  }
  if (type === 'damage_reduce' || type === 'damage_boost' || type === 'trigger_boost' || type === 'morale_boost' || type === 'ignore_def') {
    const amount = 'amount' in create ? create.amount : create.rate;
    const push: Status = { type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status;
    if ('amount' in create) (push as { amount: number }).amount = create.amount;
    else (push as { rate: number }).rate = create.rate;
    // 增减伤方向（damage_boost 才有）：缺省 'taken'（受到侧）
    if (type === 'damage_boost') (push as { direction: 'caused' | 'taken' }).direction = create.direction ?? 'taken';
    // 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）：首层记 1，同战法累加时 +1
    if (type === 'damage_boost' && 'stacks' in create) (push as { stacks?: number }).stacks = create.stacks ?? 1;
    if (type === 'damage_boost' && 'charges' in create && create.charges != null) {
      (push as { charges?: number }).charges = create.charges;
    }
    // 增减伤按本次伤害过滤（方圆/锋矢/白刃）：拷到 Status，缺省不过滤
    if ((type === 'damage_boost' || type === 'damage_reduce') && 'damageSource' in create && create.damageSource != null) {
      (push as { damageSource?: 'basic' | 'skill' }).damageSource = create.damageSource;
    }
    if ((type === 'damage_boost' || type === 'damage_reduce') && 'skillTypes' in create && create.skillTypes != null) {
      (push as { skillTypes?: SkillType[] }).skillTypes = create.skillTypes;
    }
    if ((type === 'damage_boost' || type === 'damage_reduce') && 'damageType' in create && create.damageType != null) {
      (push as { damageType?: 'physical' | 'strategy' }).damageType = create.damageType;
    }
    // DoT 类型维过滤（全主诿异：只提升被施加的燃烧 / 恐慌 / 妖术诅咒）
    if (type === 'damage_boost' && 'dotTypes' in create && create.dotTypes != null) {
      (push as { dotTypes?: DotType[] }).dotTypes = create.dotTypes;
    }
    // 条件减伤（人公将军）：仅当携带者自身带该状态时生效
    if (type === 'damage_reduce' && 'requireSelfStatus' in create && create.requireSelfStatus != null) {
      (push as { requireSelfStatus?: StatusType }).requireSelfStatus = create.requireSelfStatus;
    }
    // 仅「进行攻击」的增减伤（缚父临危「下两次**攻击**造成的伤害提升 30%」）：普攻 / 物理主动 / 追击
    if (type === 'damage_boost' && 'attackOnly' in create && create.attackOnly) {
      (push as { attackOnly?: boolean }).attackOnly = true;
    }
    // 谋议宏图减伤 / 虎豹督军增伤按 8/8 衰减：冻结满额率为 baseRate
    if ((type === 'damage_reduce' || type === 'damage_boost') && 'decayEighths' in create && create.decayEighths) {
      (push as { eighths?: number }).eighths = create.decayEighths;
      (push as { baseRate?: number }).baseRate = create.rate;
    }
    // 受击按份衰减（恃强淬锋增减伤 / 疮痍累身减伤）：冻结满额份数 fifthsBase 与满额 rate
    if ((type === 'damage_boost' || type === 'damage_reduce') && 'decayFifths' in create && create.decayFifths) {
      (push as { fifths?: number }).fifths = create.decayFifths;
      (push as { fifthsBase?: number }).fifthsBase = create.decayFifths;
      (push as { baseRate?: number }).baseRate = create.rate;
    }
    // 增减伤/发动率类状态记录施法者（战报归因用）：神兵天降/大赏三军/减伤/奋疾先登降速等
    if (casterId) {
      (push as { sourceUnitId?: string }).sourceUnitId = casterId;
    }
    if (type === 'trigger_boost' && 'skillTypes' in create && create.skillTypes) {
      (push as { skillTypes?: SkillType[] }).skillTypes = create.skillTypes;
    }
    if (type === 'trigger_boost' && 'additive' in create && create.additive) {
      (push as { additive?: boolean }).additive = true;
    }
    // 攻击类过滤（侵掠如火：只提升攻击类主动战法发动率）
    if (type === 'trigger_boost' && 'attackSkillsOnly' in create && create.attackSkillsOnly) {
      (push as { attackSkillsOnly?: boolean }).attackSkillsOnly = true;
    }
    target.statuses.push(push);
    // 战报 detail：duration ≥ 999（战斗结束约定）→「持续至战斗结束」；
    // damage_boost 用百分数 + 语义化（0.08 → 「造成的伤害提高8%」；≤ -90% → 「造成的伤害大幅降低」）
    const durText = create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`;
    let detail: string;
    if (type === 'damage_boost' && 'decayEighths' in create && create.decayEighths) {
      const pct = Math.round(Math.abs(create.rate) * 100);
      const dirName = (create.direction ?? 'taken') === 'caused' ? '造成的' : '受到的';
      detail = `${dirName}伤害${create.rate >= 0 ? '提高' : '降低'} ${pct}% 剩余 ${create.decayEighths}/8 ${durText}`;
    } else if (type === 'damage_boost' && 'decayFifths' in create && create.decayFifths) {
      const pct = Math.round(Math.abs(create.rate) * 100);
      const dirName = (create.direction ?? 'taken') === 'caused' ? '造成的' : '受到的';
      detail = `${dirName}伤害${create.rate >= 0 ? '提高' : '降低'} ${pct}% 剩余 ${create.decayFifths}/${create.decayFifths} ${durText}`;
    } else if (type === 'damage_boost') {
      const pct = Math.round(Math.abs(create.rate) * 100);
      const dirName = (create.direction ?? 'taken') === 'caused' ? '造成的' : '受到的';
      const verb = create.rate < 0 && pct > 90 ? '大幅降低' : `${create.rate >= 0 ? '提高' : '降低'} ${pct}%`;
      const once = 'charges' in create && create.charges ? '下一次' : '';
      detail = `${once}${dirName}伤害${verb} ${'charges' in create && create.charges ? '' : durText}`.trim();
    } else if (type === 'trigger_boost') {
      const pct = Math.round(create.rate * 100);
      const pursuitOnly =
        'skillTypes' in create &&
        create.skillTypes?.length === 1 &&
        create.skillTypes[0] === 'pursuit';
      const scope = pursuitOnly ? '追击战法发动率' : '发动率';
      const verb = 'additive' in create && create.additive ? '提高' : '提升';
      detail = `${scope}${verb} ${pct}% ${durText}`;
    } else if (type === 'damage_reduce' && 'decayFifths' in create && create.decayFifths) {
      // 疮痍累身：官方口径「【疮痍累身】使【周泰】受到攻击伤害降低84%」——
      // 受攻击 / 受策略两条独立轨，受击后各自按 1/12 递减（见 decayFifthsOnHit）
      const pct = Math.round(Math.abs(create.rate) * 100);
      const kind = damageKindText(create.damageType);
      const srcName = ctx.skills.get(sourceSkillId)?.name ?? sourceSkillId;
      detail = `【${srcName}】使【${target.general.name}】受到${kind}降低${pct}% ${durText}`;
    } else if (type === 'damage_reduce' && 'decayEighths' in create && create.decayEighths) {
      detail = `${statusName(type)} ${create.rate} 剩余 ${create.decayEighths}/8 ${durText}`;
    } else if (type === 'ignore_def') {
      detail = `无视防御 ${Math.round(create.rate * 100)}% ${durText}`;
    } else {
      detail = `${statusName(type)} ${amount}${'amount' in create && 'percent' in create && create.percent ? '%' : ''} ${durText}`;
    }
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail,
    });
    return;
  }
  if (type === 'sorcery' || type === 'burning' || type === 'panic' || type === 'curse' || type === 'ignite') {
    const status: Status = {
      type,
      remaining,
      rate: create.rate,
      sourceStrategy: 'sourceStrategy' in create ? create.sourceStrategy : 0,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
      sourceUnitId: casterId ?? '',
    } as Status;
    // 挂上时结算（滞后触发）：冻结每次跳伤/拆解/增减伤归因
    if (stored) (status as { stored?: DotStoredDamage }).stored = stored;
    // 兵力阈值条件（巧音唤蝶燃烧）：跳伤时按携带者当前兵力判定
    if ('troopRatio' in create && create.troopRatio) {
      (status as { troopRatio?: TroopRatioCond }).troopRatio = create.troopRatio;
    }
    // 受击触发妖术（破凰「条件妖术」）：行动时不跳伤，改为携带者受击时触发，charges 次用尽即移除
    const hurtMark = create.type === 'sorcery' && create.onHurt === true ? create : undefined;
    if (hurtMark) {
      const mark = status as Extract<Status, { type: 'sorcery' }>;
      mark.onHurt = true;
      mark.charges = hurtMark.charges ?? 0;
    }
    target.statuses.push(status);
    const durText = create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`;
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: hurtMark
        ? `${statusName(type)} ${Math.round(create.rate)}% 受击触发 剩余 ${hurtMark.charges ?? 0} 次 ${durText}`
        : `${statusName(type)} ${Math.round(create.rate)}% ${durText}`,
    });
    return;
  }
  if (type === 'first_aid') {
    // 持续型急救（皇裔流离/金匮要略）：remaining = duration（缺省 Infinity = 整场战斗常驻）；
    // 触发率走战法级计数器；healTroops = 施法者挂上时兵力（缺省回退目标当前兵力）
    target.statuses.push({
      type: 'first_aid',
      remaining: 'duration' in create ? (create.duration ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY,
      healRate: 'healRate' in create ? create.healRate : 0,
      healGrowthRate: 'healGrowthRate' in create ? create.healGrowthRate : 0,
      triggerUpEvery: 'triggerUpEvery' in create ? create.triggerUpEvery : 0,
      triggerUpIncrement: 'triggerUpIncrement' in create ? create.triggerUpIncrement : 0,
      healTroops: 'healTroops' in create && create.healTroops ? create.healTroops : target.troops,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
      sourceUnitId: casterId ?? '',
    } as Status);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `持续型急救 ${Math.round(create.healRate)}% 恢复率 ${'duration' in create && create.duration ? `持续 ${create.duration} 回合` : '持续至战斗结束'}`,
    });
    return;
  }
  if (type === 'rest') {
    const restCreate = create as Extract<CreateStatus, { type: 'rest' }>;
    const caster = casterId ? castUnit(ctx, casterId) : undefined;
    const healAmount = computeRestHealAmount(caster, target, restCreate);
    const startRound = restCreate.startRound ?? 1;
    const durText = restCreate.duration >= 999 ? '持续至战斗结束' : `持续 ${restCreate.duration} 回合`;
    const startText = startRound > 1 ? `第${startRound}回合起 ` : '';
    target.statuses.push({
      type: 'rest',
      remaining: restCreate.duration,
      healAmount,
      startRound,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
      sourceUnitId: casterId,
      ...(restCreate.troopRatio ? { troopRatio: restCreate.troopRatio } : {}),
    });
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `休整 ${startText}${durText} 每次恢复 ${healAmount}`,
    });
    return;
  }
  if (type === 'split') {
    const src = create as Extract<CreateStatus, { type: 'split' }>;
    const push: Extract<Status, { type: 'split' }> = {
      type: 'split',
      remaining: src.duration,
      rate: src.rate,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
    };
    if (src.charges != null) push.charges = src.charges;
    target.statuses.push(push);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `${statusName(type)} ${Math.round(src.rate)}% ${src.duration >= 999 ? '持续至战斗结束' : `持续 ${src.duration} 回合`}`,
    });
    return;
  }
  if (type === 'jump_prep') {
    target.statuses.push({
      type: 'jump_prep',
      remaining,
      rate: create.rate,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
    } as Status);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `${statusName(type)} ${Math.round(create.rate * 100)}% ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
    });
    return;
  }
  if (type === 'rampage') {
    target.statuses.push({
      type: 'rampage',
      remaining: remaining ?? 1,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
      pendingNextAct: create.type === 'rampage' ? create.pendingNextAct : undefined,
    });
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: create.type === 'rampage' && create.pendingNextAct
        ? '暴走 下次行动时生效，持续到下回合行动前'
        : `暴走 ${create.duration} 回合`,
    });
    return;
  }
  if (type === 'counter') {
    const counterCreate = create as Extract<CreateStatus, { type: 'counter' }>;
    target.statuses.push({
      type: 'counter',
      remaining: counterCreate.duration,
      rate: counterCreate.rate,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
      sourceUnitId: casterId,
    });
    const durText = counterCreate.duration >= 999 ? '持续至战斗结束' : `持续 ${counterCreate.duration} 回合`;
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `反击 伤害率${counterCreate.rate}% ${durText}`,
    });
    return;
  }
  if (type === 'taunt') {
    target.statuses.push({
      type: 'taunt',
      remaining,
      targetId: create.targetId,
      appliedRound,
      sourceSkillType,
      sourceSkillId,
    } as Status);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `挑衅 ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
    });
    return;
  }
  // insight / siege / cover / 控制类：通用简化字段
  target.statuses.push({ type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status);
  ctx.events.push({
    type: 'status_inflicted',
    unitId: target.general.id,
    statusType: type,
    detail: `${statusName(type)} ${remaining} 回合`,
  });
}

/** 回合结束：只递减「行动前施加」（appliedRound=0，准备阶段）的计数器回合，到 0 移除。
 *  行动中施加（appliedRound>0）持续到该单位下次行动开始前，由 tickStatusesOnActStart 递减。 */
export function tickStatuses(ctx: CombatContext, units: UnitState[]): void {
  for (const unit of units) {
    if (!unit.alive) continue;
    for (const s of [...unit.statuses]) {
      if (s.type === 'evasion') {
        if (s.stacks <= 0) {
          unit.statuses = unit.statuses.filter((x) => x !== s);
        }
        continue;
      }
      if (s.appliedRound !== 0) continue; // 行动中施加：下次行动开始前递减
      if (s.type === 'pending_stacks') continue; // 叠层待发：不按回合递减（奉令护蜀）
      if (s.type === 'ignore_evasion') continue; // 无视规避：消耗制，不按回合递减（缚父临危）
      if (s.type === 'rest') continue; // 休整 remaining 只在跳恢复时递减
      // 次数型分兵（准备阶段施加）：不按回合递减
      if (s.type === 'split' && 'charges' in s && s.charges != null) continue;
      // split/insight/siege/sorcery/burning/panic/first_aid 都按 remaining 递减
      // （first_aid：Infinity 整场常驻恒不减；金匮要略前 3 回合到期移除）
      s.remaining -= 1;
      if (s.remaining <= 0) {
        unit.statuses = unit.statuses.filter((x) => x !== s);
        ctx.events.push({
          type: 'status_expired',
          unitId: unit.general.id,
          statusType: s.type,
        });
      }
    }
  }
}

/**
 * 回合前准备阶段（谋议宏图 / 恃强淬锋）：`round_start` 之后、单位行动之前。
 * 1. 带 `eighths` 的减伤/增伤（谋议宏图 / 虎豹督军）衰减 1/8（≤0 则移除）；**不对 fifths 做回合衰减**
 *    ⚠️ 时点（用户口径 2026-09-17）：**第 1 回合保持满额 8/8**，从第 2 回合开始每回合 −1/8（第 8 回合 1/8）。
 *    此前实现是「准备阶段 8/8 → 第 1 回合开始即 7/8」，整体早了一回合。
 * 2. 被动 `selfPhysBoost.onRoundStart` 给持有者叠 1 层造成攻击伤害提高
 * 3. 一类指挥 `roundStartRepeat` 对锁定目标再结算（士气叠层，同战法累加）
 */
export function tickRoundStartStatuses(ctx: CombatContext): void {
  const decayEighthsNow = ctx.currentRound !== 1; // 第 1 回合不衰减（保 8/8）
  const units = [...ctx.myTeam, ...ctx.enemyTeam];
  for (const unit of units) {
    if (!unit.alive || !decayEighthsNow) continue;
    for (const s of [...unit.statuses]) {
      if ((s.type !== 'damage_reduce' && s.type !== 'damage_boost') || s.eighths === undefined || s.baseRate === undefined) continue;
      s.eighths -= 1;
      if (s.eighths <= 0) {
        unit.statuses = unit.statuses.filter((x) => x !== s);
        ctx.events.push({
          type: 'status_expired',
          unitId: unit.general.id,
          statusType: s.type,
        });
        continue;
      }
      s.rate = s.baseRate * (s.eighths / 8);
      const durText = s.remaining >= 999 ? '持续至战斗结束' : `持续 ${s.remaining} 回合`;
      const decayDetail =
        s.type === 'damage_boost'
          ? `${(s.direction ?? 'taken') === 'caused' ? '造成的' : '受到的'}伤害${s.rate >= 0 ? '提高' : '降低'} ${Math.round(Math.abs(s.rate) * 100)}% 剩余 ${s.eighths}/8 ${durText}`
          : `${statusName(s.type)} ${s.rate} 剩余 ${s.eighths}/8 ${durText}`;
      ctx.events.push({
        type: 'status_inflicted',
        unitId: unit.general.id,
        statusType: s.type,
        detail: decayDetail,
      });
    }
  }

  for (const unit of units) {
    if (!unit.alive) continue;
    for (const id of unit.general.passiveSkillIds) {
      const skill = resolveSkill(ctx, id);
      if (skill?.type !== 'passive' || !skill.selfPhysBoost?.onRoundStart) continue;
      applySelfPhysBoost(ctx, unit, skill);
    }
  }

  for (const locked of ctx.lockedCommands) {
    const skill = locked.skill;
    if (!skill.roundStartRepeat) continue;
    // 全队累计伤害门槛（徽言龙凤）：未激活前整段不执行
    if (
      skill.teamDamageThreshold &&
      !ctx.teamThresholdActive?.has(`${locked.casterId}:${skill.id}`)
    ) {
      continue;
    }
    const rs = skill.roundStartRepeat;
    if (rs.startRound != null && ctx.currentRound < rs.startRound) continue;
    if (rs.endRound != null && ctx.currentRound > rs.endRound) continue;
    if (rs.oddRounds && ctx.currentRound % 2 === 0) continue;
    const caster = castUnit(ctx, locked.casterId);
    if (!caster) continue;
    if (!caster.alive && !skill.retainAfterDeath) continue;
    const targets = locked.targets.filter((t) => t.alive);
    if (targets.length === 0) continue;
    executeSkillOutputs(ctx, caster, skill, targets, skill.roundStartRepeat.output);
  }
}

/** 移除所有有害状态（孙权九锡黄龙） */
export function removeDebuffs(ctx: CombatContext, targets: UnitState[]): void {
  const DEBUFF_TYPES: StatusType[] = ['confusion', 'rampage', 'cowardice', 'hesitation', 'siege', 'sorcery', 'burning', 'panic', 'curse', 'ignite', 'taunt'];
  for (const t of targets) {
    if (!t.alive) continue;
    const before = t.statuses.filter((s) => DEBUFF_TYPES.includes(s.type as StatusType));
    for (const s of before) {
      ctx.events.push({
        type: 'status_expired',
        unitId: t.general.id,
        statusType: s.type,
      });
    }
    t.statuses = t.statuses.filter((s) => !DEBUFF_TYPES.includes(s.type as StatusType));
  }
}

/**
 * 规避判定（所有伤害结算点的统一入口）：
 * ① 层数式 `evasion`：消耗 1 层，必定免疫该次伤害。
 * ② 概率式 `evade_chance`（列营守险「受到下 N 次伤害时有 X% 几率进入规避状态，免疫该次伤害」）：
 *    每次受击消耗 1 次机会并掷 X%——命中则完全免疫该次伤害，未命中照常结算（机会同样消耗）。
 * stacks / charges <= 0 视为无效（不挡、不发 evasion_blocked），减到 0 时立刻移除，
 * 避免同回合后续伤害白嫖残留层。
 */
export function consumeEvasion(ctx: CombatContext, target: UnitState, sourceId: string): boolean {
  // 缚父临危：攻击方带「下一次造成的伤害无视规避」标记时，跳过规避判定并消耗该标记
  // （覆盖任意伤害类型；所有伤害路径统一经本入口，故只此一处接线）
  const attacker = sourceId ? castUnit(ctx, sourceId) : undefined;
  const ignore = attacker?.statuses.find(
    (s): s is Extract<Status, { type: 'ignore_evasion' }> => s.type === 'ignore_evasion'
  );
  if (attacker && ignore) {
    attacker.statuses = attacker.statuses.filter((s) => s !== ignore);
    ctx.events.push({ type: 'status_expired', unitId: attacker.general.id, statusType: 'ignore_evasion' });
    return false;
  }
  const ev = getStatus(target, 'evasion');
  if (ev && ev.stacks > 0) {
    ev.stacks -= 1;
    if (ev.stacks <= 0) {
      target.statuses = target.statuses.filter((s) => s !== ev);
    }
    ctx.events.push({
      type: 'evasion_blocked',
      unitId: target.general.id,
      sourceId,
      remainingStacks: ev.stacks,
    });
    return true;
  }
  const ec = getStatus(target, 'evade_chance');
  if (ec && ec.charges > 0) {
    ec.charges -= 1;
    const evaded = ctx.rng.chance(ec.rate);
    if (ec.charges <= 0) {
      target.statuses = target.statuses.filter((s) => s !== ec);
    }
    if (evaded) {
      ctx.events.push({
        type: 'evasion_blocked',
        unitId: target.general.id,
        sourceId,
        remainingStacks: ec.charges,
      });
      return true;
    }
  }
  return false;
}

/** 生效属性：面板基础值 + 部队加成点数 + 战法点数增减（攻击/防御/谋略/速度）+ 百分比增减。
 *  百分比按「当前生效属性（含部队加成与点数增减后）」结算：eff = base + formation + flat，再 + round(eff × Σpercent/100)。
 *  正负独立：攻击增益(+)与攻击降低(-)互不抵消，各自相加。 */
export function effectiveStat(unit: UnitState, kind: 'attack' | 'defense' | 'strategy' | 'speed'): number {
  const g = unit.general;
  const base = kind === 'attack' ? g.attack : kind === 'defense' ? g.defense : kind === 'strategy' ? g.strategy : g.speed;
  const formation = unit.formationBonus?.[kind] ?? 0;
  const buffs = unit.statuses.filter((s) =>
    kind === 'attack' ? s.type === 'attack_buff'
      : kind === 'defense' ? s.type === 'defense_buff'
        : kind === 'strategy' ? s.type === 'strategy_buff'
          : s.type === 'speed_buff'
  );
  const flat = formation + buffs.reduce((acc, s) => acc + (('amount' in s && !('percent' in s && s.percent) ? s.amount : 0) as number), 0);
  const pct = buffs.reduce((acc, s) => acc + (('amount' in s && 'percent' in s && s.percent ? s.amount : 0) as number), 0);
  const eff = base + flat;
  if (pct === 0) return eff;
  // 四舍五入按绝对值（-31.5 → -32，与「降低 32 点」直觉一致）
  const bonus = Math.round(Math.abs((eff * pct) / 100)) * Math.sign(pct);
  return eff + bonus;
}

/**
 * 攻击伤害用的目标防御：先生效属性，再按攻击方 ignore_def 比例折减。
 * 攻防差 = 攻击 − 目标防御 × (1 − 无视比例)。
 */
function physicalTargetDefense(attacker: UnitState, target: UnitState, ignoresDefense = false): number {
  if (ignoresDefense) return 0; // 忠克猛烈：本战法造成的伤害无视目标防御属性
  return applyIgnoreDef(effectiveStat(target, 'defense'), sumRates(attacker.statuses, 'ignore_def'));
}

/**
 * 生效士气 = 面板士气 + 所有 morale_boost 点数之和。
 * 不改写 `general.morale`（避免污染 BattleConfig 原对象）。
 */
export function effectiveMorale(unit: UnitState): number {
  const base = unit.general.morale ?? 100;
  const bonus = unit.statuses
    .filter((s): s is Extract<Status, { type: 'morale_boost' }> => s.type === 'morale_boost')
    .reduce((sum, s) => sum + s.amount, 0);
  return base + bonus;
}

/**
 * 本次伤害上下文：增减伤按来源 / 战法类型 / 伤害类型过滤。
 * 缺省字段 = 该维不限制。
 */
export type DamageHitContext = {
  damageSource?: 'basic' | 'skill';
  damageType?: DamageType;
  skillType?: SkillType;
  /** DoT 类型（仅 DoT 挂上时结算携带）：供 `dotTypes` 过滤维使用（全主诿异） */
  dotType?: DotType;
  /** 分兵溅射伤害（普攻衍生）：不算「进行攻击」（侵掠如火概率增伤不吃分兵） */
  split?: boolean;
};

/**
 * 增减伤/减伤是否计入本次伤害。hit 缺省或某维缺省 = 该维不限制。
 */
export function statusMatchesHit(
  s: { damageSource?: 'basic' | 'skill'; skillTypes?: SkillType[]; damageType?: 'physical' | 'strategy'; dotTypes?: DotType[]; attackOnly?: boolean },
  hit?: DamageHitContext
): boolean {
  if (!hit) return true;
  // 仅「进行攻击」（缚父临危）：普攻 / 物理主动 / 追击，不含分兵溅射、反击、指挥代打与 DoT
  if (s.attackOnly && !isAttackHitForProc(hit)) return false;
  if (s.damageSource && hit.damageSource && s.damageSource !== hit.damageSource) return false;
  if (s.damageType && hit.damageType && s.damageType !== hit.damageType) return false;
  if (s.dotTypes && s.dotTypes.length > 0) {
    if (!hit.dotType || !s.dotTypes.includes(hit.dotType)) return false;
  }
  if (s.skillTypes && s.skillTypes.length > 0) {
    if (!hit.skillType || !s.skillTypes.includes(hit.skillType)) return false;
  }
  return true;
}

/** 受击方减伤合计；hit 过滤后仍走 formulas.sumRates，不改其签名。
 *  条件减伤（人公将军）：`requireSelfStatus` 未满足时本减伤不生效（按**携带者当前**状态实时判定）。 */
function sumReduce(target: UnitState, hit?: DamageHitContext): number {
  const list = target.statuses.filter(
    (s) =>
      s.type === 'damage_reduce' &&
      statusMatchesHit(s, hit) &&
      (!('requireSelfStatus' in s) || !s.requireSelfStatus || hasStatus(target, s.requireSelfStatus))
  );
  return sumRates(list, 'damage_reduce') + pendingStacksReduceOf(target);
}

/**
 * 增减伤倍率（神兵天降/大赏三军/血溅黄砂）：伤害方的「造成伤害提高」与受击方的「受到伤害提高」，
 * 分别由各自 statuses 上对应方向（caused/taken）的 damage_boost 状态数值相加，无效果时为 1。
 * 造成侧增伤（血溅黄砂等）不会放大自身受到的伤害。
 * 消费方：buffMult 按「单一总和」模型把两侧增伤与受击方减伤（damage_reduce）求和后 clamp 下限 10%。
 * @param hit 本次伤害上下文；缺省不过滤（旧调用保持原行为）
 */
/** 「进行攻击」判定（侵掠如火口径）：普通攻击 / 物理主动战法 / 追击战法；
 *  不含分兵溅射（split）、反击、指挥代打（skillType:'command'）与 DoT。 */
function isAttackHitForProc(hit?: DamageHitContext): boolean {
  if (!hit || hit.damageType !== 'physical' || hit.dotType || hit.split) return false;
  if (hit.damageSource === 'basic') return true;
  return hit.skillType === 'active' || hit.skillType === 'pursuit';
}

/** 进行攻击时概率增伤（侵掠如火）：按施法者被动 `attackProcBoost` 逐条掷一次，命中累加 rate。
 *  官方未写受士气影响（非战法发动率，属效果几率）→ 按固定概率判定，不走 moraleTriggerRate。 */
function attackProcBoostOf(ctx: CombatContext, source: UnitState, hit?: DamageHitContext): number {
  if (!isAttackHitForProc(hit)) return 0;
  let boost = 0;
  for (const id of source.general.passiveSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'passive') continue;
    const cfg = skill.attackProcBoost;
    if (!cfg) continue;
    if (ctx.rng.chance(cfg.chance)) boost += cfg.rate;
  }
  return boost;
}

function damageBoosts(
  ctx: CombatContext,
  source: UnitState,
  target: UnitState,
  hit?: DamageHitContext
): { causedMult: number; takenMult: number } {
  const causedBoost = sumRates(
    source.statuses.filter((s) => s.type === 'damage_boost' && statusMatchesHit(s, hit)),
    'damage_boost',
    'caused'
  );
  const takenBoost = sumRates(
    target.statuses.filter((s) => s.type === 'damage_boost' && statusMatchesHit(s, hit)),
    'damage_boost',
    'taken'
  );
  // 被动概率增伤（侵掠如火）：命中则并入造成侧合计（数值体现在伤害本身，不进战报增减伤明细）
  // 叠层待发·下次普攻增伤（奉令护蜀）：同属「进行攻击」的一次性造成侧增伤
  return {
    causedMult: 1 + causedBoost + attackProcBoostOf(ctx, source, hit) + pendingStacksBoostOf(source, hit),
    takenMult: 1 + takenBoost,
  };
}

/**
 * 收集单次伤害的增减伤来源（战报「增减伤统计」归因用）：
 *  造成侧（大赏三军：攻击方自身造成伤害提高）→ caused；
 *  受到侧（神兵天降：受击方受到伤害提高）→ taken；
 *  减伤（步步为营等受击方 damage_reduce + 兵种克制）→ reduce。
 *  includeBoosts=false：DoT 实时回退路径（挂上时结算不可用的单元测试场景）
 *  不携带增减伤提升（mult=1），只带减伤来源；引擎路径的 DoT 在挂上时结算，
 *  增伤/减伤来源均已在 computeDotTickDamage 冻结。
 * @param hit 本次伤害上下文；缺省不过滤
 * @param opts.ignoresTroopCounter 为 true 时不写入 troop_counter 减伤来源
 */
function collectDamageModifiers(
  ctx: CombatContext,
  source: UnitState,
  target: UnitState,
  includeBoosts = true,
  hit?: DamageHitContext,
  opts?: { ignoresTroopCounter?: boolean }
): DamageModifiers {
  const toSrc = (s: Extract<Status, { sourceUnitId?: string }>, dir: DamageModifierSource['direction']): DamageModifierSource => ({
    unitId: s.sourceUnitId || (dir === 'caused' ? source.general.id : target.general.id),
    skillId: s.sourceSkillId,
    skillName: resolveSkill(ctx, s.sourceSkillId)?.name ?? s.sourceSkillId,
    rate: 'rate' in s ? s.rate : 0,
    direction: dir,
  });
  const caused = includeBoosts
    ? source.statuses
        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused' && statusMatchesHit(s, hit))
        .map((s) => toSrc(s, 'caused'))
    : [];
  const taken = includeBoosts
    ? target.statuses
        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'taken' && statusMatchesHit(s, hit))
        .map((s) => toSrc(s, 'taken'))
    : [];
  const reduce = target.statuses
    .filter(
      (s): s is Extract<Status, { type: 'damage_reduce' }> =>
        s.type === 'damage_reduce' &&
        statusMatchesHit(s, hit) &&
        (!s.requireSelfStatus || hasStatus(target, s.requireSelfStatus))
    )
    .map((s) => toSrc(s, 'reduce'));
  const cr = troopCounterReduceOf(source, target);
  if (cr > 0 && !opts?.ignoresTroopCounter) {
    reduce.push({
      unitId: target.general.id,
      skillId: 'troop_counter',
      skillName: '兵种克制',
      rate: cr,
      direction: 'reduce',
    });
  }
  return { caused, taken, reduce };
}

function statusName(type: StatusType): string {
  switch (type) {
    case 'confusion': return '混乱';
    case 'rampage': return '暴走';
    case 'cowardice': return '怯战';
    case 'hesitation': return '犹豫';
    case 'evasion': return '规避';
    case 'evade_chance': return '概率规避';
    case 'combo': return '连击';
    case 'attack_buff': return '攻击增益';
    case 'defense_buff': return '防御增益';
    case 'strategy_buff': return '谋略增益';
    case 'speed_buff': return '速度增益';
    case 'damage_reduce': return '减伤';
    case 'damage_boost': return '增伤';
    case 'trigger_boost': return '发动率提升';
    case 'insight': return '洞察';
    case 'cowardice_immune': return '免疫怯战';
    case 'siege': return '围困';
    case 'sorcery': return '妖术';
    case 'burning': return '燃烧';
    case 'panic': return '恐慌';
    case 'curse': return '妖术诅咒';
    case 'ignite': return '引燃';
    case 'split': return '分兵';
    case 'jump_prep': return '跳过准备';
    case 'taunt': return '挑衅';
    case 'counter': return '反击';
    case 'cover': return '援護';
    case 'priority': return '先手';
    case 'first_aid': return '持续型急救';
    case 'rest': return '休整';
    case 'morale_boost': return '士气提高';
    case 'ignore_def': return '无视防御';
    case 'retaliate': return '受击追加攻击';
    case 'pending_stacks': return '叠层待发';
    case 'ignore_evasion': return '无视规避';
    case 'range_buff': return '攻击距离';
  }
}

function skillTypeName(type: SkillType): string {
  switch (type) {
    case 'passive': return '被动';
    case 'command': return '指挥';
    case 'active': return '主动';
    case 'pursuit': return '追击';
  }
}

// ─── 战法执行 ───

/**
 * 承担友军攻击伤害（舍身卫主）：前 N 回合、承担者位于指定站位时，
 * 将本次攻击伤害的结算目标改为承担者（防御/规避/兵力/受击均视其为受击者）。
 */
function redirectPhysicalHit(ctx: CombatContext, original: UnitState): UnitState {
  const team = original.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const u of team) {
    if (!u.alive) continue;
    for (const id of u.general.passiveSkillIds) {
      const skill = resolveSkill(ctx, id);
      if (skill?.type !== 'passive' || !skill.redirectAllyPhysical) continue;
      const cfg = skill.redirectAllyPhysical;
      if (ctx.currentRound < 1 || ctx.currentRound > cfg.rounds) continue;
      if (!cfg.positions.includes(u.general.position)) continue;
      return u;
    }
  }
  return original;
}

/**
 * 次数型「下一次攻击」：一次 physical/strategy/positional 输出或一次普攻消耗 1 次（不按目标数）。
 * 只扣 caused（青丘 / 全军突击），taken 由受击路径消耗。
 * `hit` 过滤不匹配的 charges（虎步关右 physical 不被策略消耗）；无 hit 时不过滤（兼容青丘等无过滤 charges）。
 */
function consumeAttackCharges(ctx: CombatContext, attacker: UnitState, hit?: DamageHitContext): void {
  for (const s of [...attacker.statuses]) {
    if (s.type !== 'damage_boost' || s.charges == null) continue;
    if (s.direction === 'taken') continue;
    if (!statusMatchesHit(s, hit)) continue;
    s.charges -= 1;
    if (s.charges <= 0) attacker.statuses = attacker.statuses.filter((x) => x !== s);
  }
}

/**
 * 受击次数型 taken charges（文伐：下一次受到策略攻击）：
 * 本次伤害已计入该层（damageBoosts 在 applyDamage 之前算完），扣兵后再 −1，到 0 移除。
 * 攻击受击不匹配 strategy taken，不消耗。
 */
function consumeTakenCharges(target: UnitState, hit: DamageHitContext): void {
  for (const s of [...target.statuses]) {
    if (s.type !== 'damage_boost' || s.direction !== 'taken' || s.charges == null) continue;
    if (!statusMatchesHit(s, hit)) continue;
    s.charges -= 1;
    if (s.charges <= 0) target.statuses = target.statuses.filter((x) => x !== s);
  }
}

/**
 * 受击按份衰减（恃强淬锋 / 疮痍累身）：受匹配伤害且实际扣兵后 fifths −1；
 * rate = baseRate × fifths / fifthsBase；fifths ≤ 0 则移除。
 * damage_boost（恃强淬锋，增减伤）与 damage_reduce（疮痍累身，减伤，按 damageType 分轨）通用。
 */
function decayFifthsOnHit(ctx: CombatContext, target: UnitState, hit: DamageHitContext): void {
  for (const s of [...target.statuses]) {
    if (
      (s.type !== 'damage_boost' && s.type !== 'damage_reduce') ||
      s.fifths === undefined ||
      s.baseRate === undefined ||
      s.fifthsBase === undefined
    ) {
      continue;
    }
    if (!statusMatchesHit(s, hit)) continue;
    s.fifths -= 1;
    if (s.fifths <= 0) {
      target.statuses = target.statuses.filter((x) => x !== s);
      ctx.events.push({ type: 'status_expired', unitId: target.general.id, statusType: s.type });
      continue;
    }
    s.rate = s.baseRate * (s.fifths / s.fifthsBase);
    // 战报（官方口径，疮痍累身）：先「受到攻击伤害降低效果下降了」，再给递减后的新值。
    // 仅减伤轨推送（damage_boost 的恃强淬锋保持原事件流，零回归）。
    if (s.type === 'damage_reduce') {
      const kind = damageKindText(s.damageType);
      ctx.events.push({
        type: 'status_changed',
        unitId: target.general.id,
        statusType: s.type,
        detail: `受到${kind}降低效果下降了`,
      });
      const pct = Math.round(Math.abs(s.rate) * 100);
      const srcName = ctx.skills.get(s.sourceSkillId)?.name ?? s.sourceSkillId;
      ctx.events.push({
        type: 'status_changed',
        unitId: target.general.id,
        statusType: s.type,
        detail: `【${srcName}】使【${target.general.name}】受到${kind}降低${pct}%`,
      });
    }
  }
}

/**
 * 恃强淬锋：给持有者叠 1 层造成攻击伤害提高（sameSource 累加，maxStacks 封顶）。
 */
function applySelfPhysBoost(ctx: CombatContext, unit: UnitState, skill: Extract<Skill, { type: 'passive' }>): void {
  const cfg = skill.selfPhysBoost;
  if (!cfg) return;
  inflictStatus(
    ctx,
    unit,
    {
      type: 'damage_boost',
      rate: cfg.perStack,
      duration: cfg.duration,
      direction: 'caused',
      damageType: 'physical',
      stacks: 1,
      maxStacks: cfg.maxStacks,
      attackScaled: cfg.attackScaled,
    },
    skill.type,
    skill.id,
    unit.general.id
  );
}

/** 次数型分兵：每次分兵攻击消耗 1 次，charges 耗尽则移除（鱼鳞/飒沓如星） */
function consumeSplitCharges(unit: UnitState): void {
  for (const s of [...unit.statuses]) {
    if (s.type !== 'split' || !('charges' in s) || s.charges == null) continue;
    s.charges -= 1;
    if (s.charges <= 0) unit.statuses = unit.statuses.filter((x) => x !== s);
  }
}

/**
 * 伤害段连锁：当前概率 `p = chance`；`p > 0` 时按施法者士气判定，成功则去掉 chain 后以 `random_single` 再打同一段，然后 `p -= decay`。
 * 递归调用已剥离 chain，不会无限递归；decay ≤ 0 时只追加一段后停止。
 */
function executeDamageChain(
  ctx: CombatContext,
  caster: UnitState,
  skill: Skill,
  targets: UnitState[],
  out: Extract<SkillOutput, { kind: 'physical_damage' } | { kind: 'strategy_damage' }>
): void {
  if (!out.chain) return;
  let p = out.chain.chance;
  while (p > 0) {
    const morale = effectiveMorale(caster);
    const rate = moraleTriggerRate(morale, p);
    const success = ctx.rng.chance(rate);
    ctx.events.push({
      type: 'skill_trigger',
      unitId: caster.general.id,
      skillId: skill.id,
      skillName: skill.name,
      success,
      rate: Math.round(rate * 100),
      baseRate: Math.round(p * 100),
      morale,
    });
    if (!success) break;
    const { chain: _omit, ...rest } = out;
    executeSkillOutputs(ctx, caster, skill, targets, [{ ...rest, chain: undefined, targetMode: 'random_single' }]);
    p -= out.chain.decay;
    if (out.chain.decay <= 0) break;
  }
}

/**
 * 战法链（连环计）：最外层发动时依次把**其他已注册战法**的 output 当作本战法效果执行
 * （官方「每个战法的效果与原战法在同等级下效果相同」→ 直接用注册表里该战法的 output，事件归属该战法）。
 * 每步条件在**该步执行时**求值：前一步可能降主目标谋略（伐谋）或给主目标挂暴走（迷阵命中主目标），
 * 从而影响后一步（迷阵 / 落雷）是否结算——顺序不可预先求值。
 */
function runChainSkills(ctx: CombatContext, caster: UnitState, skill: Skill, targets: UnitState[]): void {
  const chain = 'chainSkills' in skill ? skill.chainSkills : undefined;
  if (!chain || chain.length === 0) return;
  const enemies = caster.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  const primary = targets[0]; // 本战法主目标 = 连环计目标
  for (const step of chain) {
    if (step.requireTargetStrategyBelowSelf) {
      if (!primary || !primary.alive) continue;
      if (effectiveStat(primary, 'strategy') >= effectiveStat(caster, 'strategy')) continue;
    }
    if (step.requireTargetStatus) {
      if (!primary || !primary.alive || !hasStatus(primary, step.requireTargetStatus)) continue;
    }
    const ref = resolveSkill(ctx, step.skillId);
    if (!ref) continue;
    const pool: UnitState[] =
      step.targetMode === 'random_single'
        ? skillTargets(ctx, caster, enemies, ref.range ?? skill.range, 'random_single')
        : primary
          ? [primary]
          : [];
    if (pool.length === 0) continue;
    ctx.events.push({
      type: 'skill_target',
      unitId: caster.general.id,
      skillId: ref.id,
      targetIds: pool.map((t) => t.general.id),
    });
    ctx.events.push({
      type: 'skill_cast',
      unitId: caster.general.id,
      skillId: ref.id,
      skillName: ref.name,
    });
    executeSkillOutputs(ctx, caster, ref, pool, ref.output, false);
    if (!caster.alive) break;
  }
}

function executeSkillOutputs(
  ctx: CombatContext,
  caster: UnitState,
  skill: Skill,
  targets: UnitState[],
  outputs?: SkillOutput[],
  /** 重复施加奖励防自递归（诸葛锦囊：追加结算 repeatBonus.output 时置 true） */
  skipRepeat = false,
  /**
   * 结算属性来源（监听类通例）：友军行动触发的战法（ally_act / ally_before_active），
   * 伤害按**触发者**的谋略/攻击/兵力与增减伤结算，而战报归属（unitId）仍是战法携带者。
   * 缺省 = caster（既有调用全部零回归）；after_first_active / afterActive 的触发者本就是携带者，无需传。
   * 注意：skipRepeat 占第 6 位，本参数为第 7 位——监听类调用点须写 `..., false, actor`。
   */
  statSource?: UnitState
): void {
  // 重复施加奖励（诸葛锦囊「若发动时目标已有诸葛锦囊效果，则额外恢复目标一定兵力」）：
  // 发动时逐目标判定——目标身上已带本战法施加的状态则追加结算 repeatBonus.output。
  // skipRepeat 防自递归；在入口处按「每次发动」结算一次，不随 output 段数重复。
  if (!skipRepeat && skill.repeatBonus && skill.repeatBonus.output.length > 0) {
    for (const t of targets) {
      if (!t.alive) continue;
      if (!t.statuses.some((st) => st.sourceSkillId === skill.id)) continue;
      executeSkillOutputs(ctx, caster, skill, [t], skill.repeatBonus.output, true);
    }
  }
  const list = outputs ?? skill.output;
  // 战法链（连环计）：仅最外层发动执行（nested 调用都带显式 outputs，故不会递归触发）
  if (!outputs) runChainSkills(ctx, caster, skill, targets);
  /** 属性/兵力/增减伤的读取来源；缺省与施法者同体（旧口径） */
  const statU = statSource ?? caster;
  /** 上两段伤害输出的实际目标，供 onlyIfOverlapPrevious（怀德畏威重合混乱）取交集 */
  let prevDamageTargetIds: string[] = [];
  let lastDamageTargetIds: string[] = [];
  const rememberDamageTargets = (ids: string[]) => {
    prevDamageTargetIds = lastDamageTargetIds;
    lastDamageTargetIds = ids;
  };
  for (const out of list) {
    if (out.kind === 'physical_damage') {
      if (out.startRound != null && ctx.currentRound < out.startRound) continue;
      if (out.endRound != null && ctx.currentRound > out.endRound) continue;
    }
    if (out.kind === 'random_pick') {
      const picked = ctx.rng.pickN(out.options, out.count);
      executeSkillOutputs(ctx, caster, skill, targets, picked.flat());
      continue;
    }
    if (out.kind === 'chance_group') {
      const morale = effectiveMorale(caster);
      // 按造成伤害次数递增发动率（霸王渡江：40% + 3%/层，最多 5 层）
      const boostCfg = skill.chanceBoostPerDamage;
      const stacks = boostCfg
        ? Math.min(boostCfg.maxStacks, ctx.skillDamageCounters?.get(`${caster.general.id}:${skill.id}`) ?? 0)
        : 0;
      const baseChance = boostCfg ? out.chance + boostCfg.increment * stacks : out.chance;
      const rate = moraleTriggerRate(morale, Math.min(1, baseChance));
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: caster.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(Math.min(1, baseChance) * 100),
        morale,
      });
      if (success) executeSkillOutputs(ctx, caster, skill, targets, out.outputs);
      continue;
    }
    // 被动/指挥输出级独立发动率（击势 65%、指挥 roundStartRepeat chance）：士气修正后判定，失败则跳过该段
    // before_active 指挥（运筹决胜）已在 triggerBeforeActiveCommands 逐段判定，此处不再重复
    // recipient 代打改在每人上 roll，不走整段一次判定（先声夺人等非代打仍走此处）
    if (
      (skill.type === 'passive' || (skill.type === 'command' && skill.roundTrigger !== 'before_active')) &&
      'chance' in out &&
      out.chance != null &&
      !(out.kind === 'physical_damage' && out.attacker === 'recipient')
    ) {
      const morale = effectiveMorale(caster);
      const rate = moraleTriggerRate(morale, out.chance);
      const success = ctx.rng.chance(rate);
      ctx.events.push({
        type: 'skill_trigger',
        unitId: caster.general.id,
        skillId: skill.id,
        skillName: skill.name,
        success,
        rate: Math.round(rate * 100),
        baseRate: Math.round(out.chance * 100),
        morale,
      });
      if (!success) continue;
    }
    // 单输出目标池：target:'self' → 施法者；targetMode 覆盖 → 按战法距离重新选敌/友军目标
    const enemies = caster.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
    const allies = caster.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
    const outTarget = out.kind === 'positional_physical_damage' || out.kind === 'morale_branch' || out.kind === 'detonate_sorcery_marks' ? undefined : out.target;
    const outMode =
      out.kind === 'physical_damage' || out.kind === 'strategy_damage' ? out.targetMode : undefined;
    const outIgnoreRange =
      (out.kind === 'physical_damage' || out.kind === 'strategy_damage') && 'ignoreRange' in out && out.ignoreRange;
    const outExplicitRange =
      (out.kind === 'physical_damage' || out.kind === 'strategy_damage') && 'range' in out && out.range != null
        ? out.range
        : undefined;
    const outRange = outIgnoreRange ? Number.POSITIVE_INFINITY : (outExplicitRange ?? skill.range);
    // 属性吸取（黄天余音）/ 分流治疗（合流、三军之众、利兵谋胜）：
    // inflict_status / heal 可带 targetSide/targetMode 单输出目标池覆盖
    const outSide = out.kind === 'inflict_status' || out.kind === 'heal' ? out.targetSide : undefined;
    const outSideMode = out.kind === 'inflict_status' || out.kind === 'heal' ? out.targetMode : undefined;
    const allyPool =
      (out.kind === 'heal' || out.kind === 'inflict_status') && out.excludeSelf
        ? allies.filter((u) => u.general.id !== caster.general.id)
        : allies;
    let pool =
      outTarget === 'self'
        ? [caster]
        : outMode
          ? skillTargets(ctx, caster, enemies, outRange, outMode, 'groupCount' in out ? out.groupCount : undefined)
          : outSide === 'self'
            ? [caster]
            : outSide === 'enemy'
              ? skillTargets(ctx, caster, enemies, skill.range, outSideMode ?? 'random_single')
              : outSide === 'ally'
                ? skillTargets(
                    ctx,
                    caster,
                    allyPool,
                    skill.range,
                    outSideMode ?? 'random_single',
                    'groupCount' in out ? out.groupCount : undefined
                  )
                : targets;
    // 兵力阈值条件（段级 troopRatio）：不满足的目标从本段目标池剔除
    // （巧音唤蝶「兵力低于初始 50% 时恢复 82%」/ 持玺兴兵「兵力低于初始 50% 才恢复」）
    if ('troopRatio' in out && out.troopRatio) {
      const cond = out.troopRatio;
      pool = pool.filter((t) => troopRatioMatches(t, cond));
    }
    // 怀德畏威：混乱只打「友军随机单体攻击 ∩ 自身群体策略」重合目标，不再按战法整体目标重选
    if (out.kind === 'inflict_status' && out.onlyIfOverlapPrevious) {
      const overlap = new Set(lastDamageTargetIds.filter((id) => prevDamageTargetIds.includes(id)));
      pool = ctx.myTeam.concat(ctx.enemyTeam).filter((u) => u.alive && overlap.has(u.general.id));
    }
    // 地公将军：整段开关——上一段伤害的命中目标中存在妖术（sorcery）/ 妖术诅咒（curse）才结算本段
    if (
      out.kind === 'inflict_status' &&
      out.requireAnyPrevDamageTargetStatus &&
      out.requireAnyPrevDamageTargetStatus.length > 0
    ) {
      const prevTargets = ctx.myTeam
        .concat(ctx.enemyTeam)
        .filter((u) => u.alive && lastDamageTargetIds.includes(u.general.id));
      const hit = prevTargets.some((u) =>
        u.statuses.some((st) => out.requireAnyPrevDamageTargetStatus!.includes(st.type))
      );
      if (!hit) continue;
    }
    // 缚父临危：状态段的友军目标选取（① 我军当前攻击属性最高单体，② 按武将名匹配「吕布」等指定武将）
    if (out.kind === 'inflict_status' && out.targetPick) {
      if (out.targetPick === 'highest_attack_ally') {
        const pick = highestStatAlly(allies, 'attack'); // 含施法者自身（「自身及友军攻击属性最高的单体」）
        pool = pick ? [pick] : [];
      } else if (out.targetPick === 'ally_named') {
        pool = allies.filter((u) => u.alive && u.general.name === out.targetPickName);
      }
    }
    // 三军夺帅 / 地公将军：本段状态打在**上一段伤害**的同一批命中目标上（不按本段 targetMode 重选）
    if (out.kind === 'inflict_status' && out.sameTargetsAsLastDamage) {
      pool = ctx.myTeam
        .concat(ctx.enemyTeam)
        .filter((u) => u.alive && lastDamageTargetIds.includes(u.general.id));
    }
    if (out.kind === 'inflict_status' && out.positions && out.positions.length > 0) {
      // 阵营池：缺省敌军（落首箭混乱打大营）；targetSide:'ally' 时改按友军站位筛（怀橘遗亲：大营 / 前锋中军）
      const sidePool =
        out.targetSide === 'ally'
          ? caster.side === 'my'
            ? ctx.myTeam
            : ctx.enemyTeam
          : out.targetSide === 'self'
            ? [caster]
            : caster.side === 'my'
              ? ctx.enemyTeam
              : ctx.myTeam;
      let positioned = sidePool.filter((u) => u.alive && out.positions!.includes(u.general.position));
      // 「除自己外」的池（怀橘遗亲：自身单列，友军单体不含自己）
      if (out.excludeSelf) positioned = positioned.filter((u) => u.general.id !== caster.general.id);
      // 站位筛选后仍须遵守本段目标模式：单体（含随机）只取 1 个
      // （怀橘遗亲「我军除大营外友军单体」= 随机 1 名前锋/中军）
      if ((out.targetMode === 'single' || out.targetMode === 'random_single') && positioned.length > 1) {
        const idx = out.targetMode === 'random_single' ? ctx.rng.int(positioned.length) : 0;
        pool = [positioned[idx]];
      } else {
        pool = positioned;
      }
    }
    // recipient 代打：忽略 targetMode 从敌军重建的池，用锁定/战法目标（友军）再滤兵种
    if (out.kind === 'physical_damage' && out.attacker === 'recipient') {
      pool = targets;
    }
    // 施法者站位条件（疮痍累身：仅「位于前锋及中军时」才援护友军全体）：
    // 与该段是否结算绑定，不满足则整段跳过（减伤段无此字段，故不受限）
    if (
      out.kind === 'inflict_status' &&
      out.casterPositions &&
      out.casterPositions.length > 0 &&
      !out.casterPositions.includes(caster.general.position)
    ) {
      continue;
    }
    if ('troopTypes' in out && out.troopTypes && out.troopTypes.length > 0) {
      pool = pool.filter((u) => out.troopTypes!.includes(u.general.troopType));
    }
    switch (out.kind) {
      case 'detonate_sorcery_marks': {
        // 破凰：引爆敌军全体身上由本战法施加的「受击触发妖术」剩余次数
        // （剩余 N 次 → 连打 N 次挂上时冻结的妖术伤害，随后移除该状态；无存量则空转）
        for (const foe of enemies) {
          if (!foe.alive) continue;
          const marks = foe.statuses.filter(
            (s): s is Extract<Status, { type: 'sorcery' }> =>
              s.type === 'sorcery' && s.onHurt === true && s.sourceSkillId === skill.id
          );
          if (marks.length === 0) continue;
          // 先移除标记再逐次结算（结算伤害走 applyDamage 不会再触发本标记）
          foe.statuses = foe.statuses.filter(
            (s) => !(s.type === 'sorcery' && s.onHurt === true && s.sourceSkillId === skill.id)
          );
          for (const mark of marks) {
            for (let k = 0; k < (mark.charges ?? 0); k++) {
              if (!foe.alive) break;
              dealDotDamage(ctx, foe, mark);
            }
          }
        }
        break;
      }
      case 'physical_damage': {
        if (out.attacker === 'recipient') {
          const atkRange = out.range ?? skill.range;
          const selectedIds: string[] = [];
          // 代打者挑选：highest_attack = 只由我军攻击属性最高者出手（四世三公「额外…」段）
          const riders =
            out.attackerPick === 'highest_attack'
              ? (() => {
                  const alive = pool.filter((u) => u.alive);
                  if (alive.length === 0) return [] as UnitState[];
                  return [
                    alive.reduce((best, u) =>
                      effectiveStat(u, 'attack') > effectiveStat(best, 'attack') ? u : best
                    ),
                  ];
                })()
              : pool;
          for (const rider of riders) {
            if (!rider.alive) continue;
            if (out.chance != null) {
              const morale = effectiveMorale(caster);
              const rate = moraleTriggerRate(morale, out.chance);
              const success = ctx.rng.chance(rate);
              ctx.events.push({
                type: 'skill_trigger',
                unitId: caster.general.id,
                skillId: skill.id,
                skillName: skill.name,
                success,
                rate: Math.round(rate * 100),
                baseRate: Math.round(out.chance * 100),
                morale,
                targetId: rider.general.id,
              });
              if (!success) continue;
            }
            // 选敌覆盖：lowest_defense = 直接取存活敌军中防御最低者（无视距离；四世三公「对敌军防御最低单体」段）
            const foes =
              out.targetPick === 'lowest_defense'
                ? (() => {
                    const alive = enemies.filter((e) => e.alive);
                    if (alive.length === 0) return [] as UnitState[];
                    return [
                      alive.reduce((best, u) =>
                        effectiveStat(u, 'defense') < effectiveStat(best, 'defense') ? u : best
                      ),
                    ];
                  })()
                : skillTargets(ctx, rider, enemies, atkRange, resolveCombatTargetMode(out.targetMode, 'random_single'));
            let riderAttacked = false;
            for (const raw of foes) {
              if (!raw.alive) continue;
              const t = redirectPhysicalHit(ctx, raw);
              if (!t.alive) continue;
              riderAttacked = true;
              selectedIds.push(t.general.id);
              // 代打伤害按代打者属性孰高定轨（徽言龙凤「由攻击或谋略属性中较高的属性决定」）：
              // 生效攻击 > 生效谋略 → 攻击伤害（attackRate），否则策略伤害（strategyRate）
              const byHigher = out.recipientDamageByHigherStat;
              const useStrategy = byHigher
                ? effectiveStat(rider, 'strategy') >= effectiveStat(rider, 'attack')
                : false;
              const damageType: DamageType = useStrategy ? 'strategy' : 'physical';
              triggerStackBuff(ctx, rider, t, damageType);
              if (!out.ignoresEvasion && consumeEvasion(ctx, t, rider.general.id)) continue;
              const atk = effectiveStat(rider, 'attack');
              const def = useStrategy ? t.general.defense : physicalTargetDefense(rider, t);
              const hit: DamageHitContext = { damageSource: 'skill', damageType, skillType: skill.type };
              const { causedMult, takenMult } = damageBoosts(ctx, rider, t, hit);
              const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(rider, t);
              const reduce = sumReduce(t, hit) + counterReduce;
              const rate = byHigher
                ? useStrategy
                  ? byHigher.strategyRate
                  : byHigher.attackRate
                : Array.isArray(out.rate)
                  ? ctx.rng.intInclusive(out.rate[0], out.rate[1])
                  : out.rate;
              const { damage, breakdown } = calcDamage(
                {
                  damageType,
                  rate,
                  attackerAttack: atk,
                  attackerStrategy: effectiveStat(rider, 'strategy'),
                  attackerTroops: rider.troops,
                  targetDefense: def,
                  targetStrategy: t.general.strategy,
                  mult: buffMult(causedMult, takenMult, reduce),
                },
                ctx.rng
              );
              const capped = applyTroopCap(damage, t.troops);
              ctx.events.push({
                type: 'damage',
                sourceId: rider.general.id,
                targetId: t.general.id,
                skillId: skill.id,
                skillName: skill.name,
                damageType,
                damage: capped,
                breakdown,
                modifiers: collectDamageModifiers(ctx, rider, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
              });
              applyDamage(ctx, t, capped, rider, damageType, 'skill');
            }
            if (riderAttacked) consumeAttackCharges(ctx, rider, { damageSource: 'skill', damageType: 'physical', skillType: skill.type });
          }
          rememberDamageTargets(selectedIds);
          executeDamageChain(ctx, caster, skill, targets, out);
          break;
        }
        const source =
          out.attacker === 'lowest_strategy_ally'
            ? lowestStrategyAlly(allies, caster)
            : out.attacker === 'highest_attack_ally'
              ? highestStatAlly(allies, 'attack')
              : caster;
        if (!source) {
          rememberDamageTargets([]);
          break;
        }
        let attacked = false;
        const selectedIds: string[] = [];
        const times = Array.isArray(out.repeats)
          ? ctx.rng.intInclusive(out.repeats[0], out.repeats[1])
          : (out.repeats ?? 1);
        for (let hitI = 0; hitI < times; hitI++) {
          const hitPool =
            hitI === 0
              ? pool
              : out.targetMode
                ? skillTargets(
                    ctx,
                    caster,
                    enemies,
                    out.ignoreRange ? Number.POSITIVE_INFINITY : skill.range,
                    out.targetMode,
                    out.groupCount
                  )
                : pool;
          for (const raw of hitPool) {
            if (!raw.alive) continue;
            const t = redirectPhysicalHit(ctx, raw);
            if (!t.alive) continue;
            attacked = true;
            selectedIds.push(t.general.id);
            // 常驻伤害前叠层（持节镇西）：伤害源叠攻击、受击者叠防御
            triggerStackBuff(ctx, source, t, 'physical');
            // 规避：默认免疫一次伤害；ignoresEvasion 时无视
            if (!out.ignoresEvasion && consumeEvasion(ctx, t, source.general.id)) continue;
            const atk = effectiveStat(source, 'attack');
            const def = physicalTargetDefense(source, t, out.ignoresDefense === true);
            const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: skill.type };
            const { causedMult, takenMult } = damageBoosts(ctx, source, t, hit);
            const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(source, t);
            const reduce = sumReduce(t, hit) + counterReduce;
            const rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
            const { damage, breakdown } = calcDamage(
              {
                damageType: 'physical',
                rate,
                attackerAttack: atk,
                attackerStrategy: source.general.strategy,
                attackerTroops: source.troops,
                targetDefense: def,
                targetStrategy: t.general.strategy,
                mult: buffMult(causedMult, takenMult, reduce),
              },
              ctx.rng
            );
            const capped = applyTroopCap(damage, t.troops);
            ctx.events.push({
              type: 'damage',
              sourceId: source.general.id,
              // 借谋略最低友军攻击（怀德畏威）：杀伤统计归属施法者
              creditToId: source.general.id === caster.general.id ? undefined : caster.general.id,
              targetId: t.general.id,
              skillId: skill.id,
              skillName: skill.name,
              damageType: 'physical',
              damage: capped,
              breakdown,
              modifiers: collectDamageModifiers(ctx, source, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
            });
            applyDamage(ctx, t, capped, source, 'physical', 'skill');
            // 按造成伤害次数递增发动率（霸王渡江）：本战法每造成 1 次伤害计 1 层（上限 maxStacks）
            if (skill.chanceBoostPerDamage && capped > 0) {
              ctx.skillDamageCounters ??= new Map();
              const key = `${source.general.id}:${skill.id}`;
              const used = ctx.skillDamageCounters.get(key) ?? 0;
              if (used < skill.chanceBoostPerDamage.maxStacks) {
                ctx.skillDamageCounters.set(key, used + 1);
              }
            }
            // 首次攻击标记（辕门射戟）：对本次攻击目标施加「造成攻击伤害降低」debuff（damage_boost caused 负值，
            // buffMult 10% 伤害下限 → 强制目标造成伤害降为 min 10%），持续 duration 回合；第二次攻击独立选目标不受影响
            if (out.markCausedReduce && t.alive) {
              inflictStatus(
                ctx,
                t,
                { type: 'damage_boost', rate: out.markCausedReduce.rate, duration: out.markCausedReduce.duration, direction: 'caused' },
                skill.type,
                skill.id,
                caster.general.id
              );
            }
            // 受击增伤标记（银龙冲阵：首次攻击的目标受到伤害提高）：
            // 受施法者攻击属性缩放（20% 基础，每点攻击 +0.1%），持续至战斗结束，最多叠加 3 层
            if (out.markTakenBoost && t.alive) {
              const scaled = roundRate(
                scaledValue(out.markTakenBoost.rate, out.markTakenBoost.growthRate, effectiveStat(caster, 'attack'))
              );
              const layerRate = scaled / 100;
              const existing = t.statuses.find(
                (s): s is Extract<Status, { type: 'damage_boost' }> =>
                  s.type === 'damage_boost' && s.direction === 'taken' && s.sourceSkillId === skill.id
              );
              if (existing && (existing.stacks ?? 1) >= out.markTakenBoost.maxStacks) {
                // 已达叠加上限：不再施加
              } else {
                inflictStatus(
                  ctx,
                  t,
                  { type: 'damage_boost', rate: layerRate, duration: out.markTakenBoost.duration, direction: 'taken', stacks: 1 },
                  skill.type,
                  skill.id,
                  caster.general.id
                );
              }
            }
          }
        }
        rememberDamageTargets(selectedIds);
        if (attacked) consumeAttackCharges(ctx, source, { damageSource: 'skill', damageType: 'physical', skillType: skill.type });
        // 西陵克晋：代打者结算后按自身当前兵力恢复（每次发动一段恢复一次，不随目标数叠加）
        if (attacked && out.healSource) healDamageSource(ctx, skill, caster, source, out.healSource.rate);
        executeDamageChain(ctx, caster, skill, targets, out);
        break;
      }
      case 'strategy_damage': {
        const selectedIds: string[] = [];
        // 代打者（西陵克晋）：我军当前谋略属性最高者出手；缺省 = statU（既有口径零回归）
        const stratRider =
          out.attacker === 'highest_strategy_ally' ? highestStatAlly(allies, 'strategy') : undefined;
        if (out.attacker === 'highest_strategy_ally' && !stratRider) {
          rememberDamageTargets([]);
          break;
        }
        const stratSrc = stratRider ?? statU;
        const stratActor = stratRider ?? caster;
        for (const t of pool) {
          if (!t.alive) continue;
          if (out.requireStatuses?.length && !out.requireStatuses.some((st) => hasStatus(t, st))) continue;
          selectedIds.push(t.general.id);
          // 常驻伤害前叠层（持节镇西）：施法者叠谋略、受击者叠防御
          triggerStackBuff(ctx, stratSrc, t, 'strategy');
          // 规避：默认免疫一次伤害；ignoresEvasion 时无视
          if (!out.ignoresEvasion && consumeEvasion(ctx, t, stratSrc.general.id)) continue;
          // 叠层后再读生效谋略（与攻击伤害先叠攻击再读 effectiveStat 对齐；
          // 群体逐目标叠层，每段伤害吃到截至本目标的全部层）
          const effStrategy = effectiveStat(stratSrc, 'strategy');
          let rate = out.rate;
          if (out.strategyScaled && out.growthRate !== undefined) {
            rate = roundRate(scaledValue(out.rate, out.growthRate, effStrategy));
          }
          const hit: DamageHitContext = { damageSource: 'skill', damageType: 'strategy', skillType: skill.type };
          const { causedMult, takenMult } = damageBoosts(ctx, stratSrc, t, hit);
          const reduce = sumReduce(t, hit) + troopCounterReduceOf(stratSrc, t);
          const { damage, breakdown } = calcDamage(
            {
              damageType: 'strategy',
              rate,
              attackerAttack: stratSrc.general.attack,
              attackerStrategy: effStrategy,
              attackerTroops: stratSrc.troops,
              targetDefense: t.general.defense,
              targetStrategy: t.general.strategy,
              mult: buffMult(causedMult, takenMult, reduce),
            },
            ctx.rng
          );
          const capped = applyTroopCap(damage, t.troops);
          ctx.events.push({
            type: 'damage',
            sourceId: stratActor.general.id,
            // 代打（西陵克晋）：杀伤统计归属施法者
            creditToId: stratActor.general.id === caster.general.id ? undefined : caster.general.id,
            targetId: t.general.id,
            skillId: skill.id,
            skillName: skill.name,
            damageType: 'strategy',
            damage: capped,
            breakdown,
            modifiers: collectDamageModifiers(ctx, stratSrc, t, true, hit),
          });
          applyDamage(ctx, t, capped, stratActor, 'strategy', 'skill');
          // 其徐如林：本侧施加的策略伤害生效后，对目标同侧相邻敌军额外造成一次策略伤害（原伤害率 × 比例）
          if (capped > 0) triggerStrategyAdjacentBonus(ctx, caster, t, rate);
        }
        rememberDamageTargets(selectedIds);
        if (pool.some((t) => t.alive)) consumeAttackCharges(ctx, stratActor, { damageSource: 'skill', damageType: 'strategy', skillType: skill.type });
        // 西陵克晋：代打者结算后按自身当前兵力恢复（每次发动一段恢复一次，不随目标数叠加）
        if (selectedIds.length > 0 && out.healSource) {
          healDamageSource(ctx, skill, caster, stratActor, out.healSource.rate);
        }
        executeDamageChain(ctx, caster, skill, targets, out);
        break;
      }
      case 'heal': {
        let rate = out.rate;
        if (out.strategyScaled) {
          const scaled = scaledValue(out.rate, out.growthRate, caster.general.strategy);
          rate = roundRate(scaled);
        }
        for (const t of pool) {
          if (!t.alive) continue;
          // 围困：无法回复兵力
          if (hasStatus(t, 'siege')) {
            ctx.events.push({
              type: 'siege_blocked',
              unitId: t.general.id,
              skillId: skill.id,
            });
            continue;
          }
          // 恢复值 = floor(round(300×施法者兵力/(3500+施法者兵力)) × 恢复率/100 × (1+恢复提高))（十面埋伏《率土秘卷一》公式）
          // 施法者兵力 = 主动恢复结算时的当前兵力；恢复提高效果（博浪抖擞/锻造仁心）未建模按 1
          const amount = calcHealAmount(caster.troops, rate);
          const before = t.troops;
          // 伤兵机制：恢复只能从伤兵池扣除（死亡兵力不可恢复）
          const healed = recoverTroops(ctx, t, amount);
          if (healed > 0) {
            ctx.events.push({
              type: 'heal',
              sourceId: caster.general.id,
              targetId: t.general.id,
              skillId: skill.id,
              skillName: skill.name,
              amount: healed,
              before,
              after: t.troops,
            });
          }
        }
        break;
      }
      case 'grant_first_aid': {
        // 持续型急救（皇裔流离/金匮要略）：友军受击时按几率触发恢复。
        // 恢复率受施法者谋略缩放（roundRate(scaledValue(...))）；触发率战法级共享计数（每 every 次 +increment）；
        // 恢复值按施法者「挂上时兵力」冻结（十面埋伏：状态类恢复的变量取自状态被施加那一刻）
        const healRate = roundRate(scaledValue(out.healRate, out.healGrowthRate, effectiveStat(caster, 'strategy')));
        const every = out.triggerUp?.every ?? 0;
        const increment = out.triggerUp?.increment ?? 0;
        // 战法级计数器：全队共享触发率与总生效次数（懒初始化）
        ctx.firstAidCounters ??= [];
        let counter = ctx.firstAidCounters.find((c) => c.skillId === skill.id && c.casterId === caster.general.id);
        if (!counter) {
          counter = { skillId: skill.id, casterId: caster.general.id, rate: out.rate, triggerCount: 0 };
          ctx.firstAidCounters.push(counter);
        }
        for (const t of pool) {
          if (!t.alive) continue;
          inflictStatus(
            ctx,
            t,
            {
              type: 'first_aid',
              healRate,
              healGrowthRate: out.healGrowthRate,
              triggerUpEvery: every,
              triggerUpIncrement: increment,
              duration: out.duration,
              healTroops: caster.troops, // 施法者挂上时兵力（恢复值计算用，冻结）
            },
            skill.type,
            skill.id,
            caster.general.id
          );
        }
        break;
      }
      case 'inflict_status': {
        for (const t of pool) {
          if (!t.alive) continue;
          // 状态数组：缺省每个目标随机 1 个（奇佐鬼谋）；applyAll 则全部施加（黄天余音四维）
          const creates: CreateStatus[] = Array.isArray(out.status)
            ? (out.applyAll ? out.status : [out.status[ctx.rng.int(out.status.length)]])
            : [out.status];
          for (const create of creates) {
          if (!t.alive) break;
          // DoT/诅咒/引燃 类型：预缩放 rate + 冻结 caster 谋略
          if (create.type === 'sorcery' || create.type === 'burning' || create.type === 'panic' || create.type === 'curse' || create.type === 'ignite') {
            const effStrategy = effectiveStat(caster, 'strategy');
            // 引爆判定（烈火焚舟）：目标已存在「本战法」施加的同类 DoT →
            // 立即结算剩余 DoT 伤害（剩余回合数 × 每次伤害）并移除该 DoT，
            // 再对目标及其相邻单位施加更高倍率、更短持续的同类 DoT（其他战法的 DoT 不引爆）
            if (out.detonate) {
              const existing = t.statuses.find(
                (s): s is Extract<Status, { type: 'sorcery' | 'burning' | 'panic' }> =>
                  s.type === create.type && s.sourceSkillId === skill.id
              );
              if (existing) {
                // 剩余回合数 × 每次伤害：2 回合燃烧 → 结算 2 次、1 回合 → 结算 1 次
                for (let k = 0; k < existing.remaining; k++) {
                  dealDotDamage(ctx, t, existing);
                  if (!t.alive) break;
                }
                t.statuses = t.statuses.filter((s) => s !== existing);
                // 引爆后：目标及其相邻单位陷入更高倍率、短持续同类 DoT（烈火焚舟：270% 持续 1 回合）
                const scaled = scaledValue(
                  out.detonate.rate,
                  out.detonate.growthRate ?? create.growthRate ?? 0,
                  effStrategy
                );
                const burnCreate = {
                  ...create,
                  rate: roundRate(scaled),
                  duration: out.detonate.duration,
                } as unknown as CreateStatus;
                if (t.alive) {
                  inflictStatus(ctx, t, burnCreate, skill.type, skill.id, caster.general.id);
                }
                if (out.detonate.adjacent) {
                  const team = t.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
                  for (const adj of adjacentUnits(t, team)) {
                    if (!adj.alive) continue;
                    inflictStatus(ctx, adj, burnCreate, skill.type, skill.id, caster.general.id);
                  }
                }
                continue;
              }
            }
            // 普通 DoT 施加：预缩放 rate + 冻结施法者谋略
            const scaled = scaledValue(create.rate, create.growthRate, effStrategy);
            // casterId：DoT 伤害统计归属施法者
            inflictStatus(ctx, t, {
              ...create,
              rate: roundRate(scaled),
              sourceStrategy: effStrategy,
            } as unknown as CreateStatus, skill.type, skill.id, caster.general.id);
          } else if (create.type === 'taunt') {
            // 挑衅：强制目标普攻施法者，targetId 填施法者 id
            inflictStatus(ctx, t, { ...create, targetId: caster.general.id }, skill.type, skill.id);
          } else if (create.type === 'damage_reduce' && create.strategyScaled && create.growthRate !== undefined) {
            // 减伤受谋略影响（金匮要略 20.4% 成长 0.13/点）：百分比按 1% 粒度八舍九入后转小数
            const scaled = roundRate(scaledValue(create.rate * 100, create.growthRate, effectiveStat(caster, 'strategy'))) / 100;
            inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
          } else if (create.type === 'damage_boost' && create.strategyScaled && create.growthRate !== undefined) {
            // 增减伤受谋略影响（密谋定蜀 +5% / 母仪浮梦 -40%，成长 0.15/点）：
            // 按绝对值缩放再恢复符号，使负向减伤随谋略增强（-40% 谋略 180 → -55%）
            const sign = Math.sign(create.rate) || 1;
            const scaled =
              (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'strategy'))) /
                100) *
              sign;
            inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
          } else if (create.type === 'damage_boost' && create.defenseScaled && create.growthRate !== undefined) {
            /** 增减伤受防御影响（当敌制决 +8%，成长 0.026/点）：公式同受谋略，属性换生效防御 */
            const sign = Math.sign(create.rate) || 1;
            const scaled =
              (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'defense'))) /
                100) *
              sign;
            inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
          } else if (create.type === 'damage_boost' && create.speedScaled) {
            /** 增减伤受速度影响（攻其不备 +11.6%）；growthRate 缺省时不缩放、用基值 */
            if (create.growthRate !== undefined) {
              const sign = Math.sign(create.rate) || 1;
              const scaled =
                (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'speed'))) /
                  100) *
                sign;
              inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
            } else {
              inflictStatus(ctx, t, create, skill.type, skill.id, caster.general.id);
            }
          } else if (
            (create.type === 'damage_boost' || create.type === 'damage_reduce') &&
            create.attackScaled
          ) {
            /** 增减伤受攻击影响（万箭 −50%、恃强 −30%）；growthRate 缺省时不缩放、用基值 */
            if (create.growthRate !== undefined) {
              const sign = Math.sign(create.rate) || 1;
              const scaled =
                (roundRate(scaledValue(Math.abs(create.rate) * 100, create.growthRate, effectiveStat(caster, 'attack'))) /
                  100) *
                sign;
              inflictStatus(ctx, t, { ...create, rate: scaled }, skill.type, skill.id, caster.general.id);
            } else {
              inflictStatus(ctx, t, create, skill.type, skill.id, caster.general.id);
            }
          } else if (
            (create.type === 'attack_buff' || create.type === 'defense_buff' || create.type === 'strategy_buff' || create.type === 'speed_buff') &&
            create.strategyScaled && create.growthRate !== undefined
          ) {
            // 属性 buff 受谋略影响（其疾如风速度+41 / 魏武之世四维-15%）：
            // 实际数值 = 基础 + 成长率×(生效谋略-80)；按绝对值缩放后恢复符号
            // （减益类基础值为负，效果幅度随谋略增强：如 -15% 谋略216 → -35%）
            // 百分比类（percent）按 1% 粒度「八舍九入」取整；点数类四舍五入
            const scaled = scaledValue(Math.abs(create.amount), create.growthRate, effectiveStat(caster, 'strategy'));
            const amount = (create.percent ? roundRate(scaled) : Math.round(scaled)) * Math.sign(create.amount);
            inflictStatus(ctx, t, { ...create, amount }, skill.type, skill.id);
          } else {
            // 增减伤/减伤（步步为营等）：记录施法者，供战报「增减伤统计」归因
            inflictStatus(ctx, t, create, skill.type, skill.id, caster.general.id);
          }
          }
        }
        break;
      }
      case 'remove_debuffs':
        removeDebuffs(ctx, pool);
        break;
      case 'grant_evasion':
        for (const t of pool) {
          if (!t.alive) continue;
          inflictStatus(ctx, t, { type: 'evasion', stacks: out.stacks }, skill.type, skill.id);
        }
        break;
      case 'grant_damage_boost': {
        // 受生效谋略影响（effectiveStat，含持节镇西等谋略增益层）：
        // 实际增伤% = 基础 + 成长率×(生效谋略-80)，八舍九入后转小数（0.4 = 40%）
        const scaled = scaledValue(out.rate, out.growthRate, effectiveStat(caster, 'strategy'));
        const rate = roundRate(scaled) / 100;
        const direction = out.direction ?? 'taken';
        for (const t of pool) {
          if (!t.alive) continue;
          inflictStatus(ctx, t, { type: 'damage_boost', rate, duration: out.duration, direction }, skill.type, skill.id, caster.general.id);
        }
        break;
      }
      case 'morale_branch': {
        const threshold = out.threshold ?? 100;
        // by:'caster'（列营守险「若自身士气高昂时，规避状态的目标变为我军全体」）：
        // 按施法者自身士气**整体判定一次**，对整个目标池执行选中分支
        // （逐目标判定会按目标数重复施加同一段状态，战报出现多条重复）
        if (out.by === 'caster') {
          const branch = effectiveMorale(caster) > threshold ? out.high : out.low;
          executeSkillOutputs(ctx, caster, skill, pool, branch);
          break;
        }
        // 缺省 'target'：逐目标按各自士气分支（盛气横凌）
        for (const t of pool) {
          if (!t.alive) continue;
          const branch = effectiveMorale(t) > threshold ? out.high : out.low;
          executeSkillOutputs(ctx, caster, skill, [t], branch);
        }
        break;
      }
      case 'positional_physical_damage': {
        const positioned = enemies.filter((t) => out.positions.includes(t.general.position) && t.alive);
        const source = out.source === 'self' ? caster : fastestAlly(allies, caster);
        if (!source) {
          rememberDamageTargets([]);
          break;
        }
        const rate = Array.isArray(out.rate) ? ctx.rng.intInclusive(out.rate[0], out.rate[1]) : out.rate;
        let attacked = false;
        const selectedIds: string[] = [];
        for (const raw of positioned) {
          if (!raw.alive) continue;
          const t = redirectPhysicalHit(ctx, raw);
          if (!t.alive) continue;
          attacked = true;
          selectedIds.push(t.general.id);
          triggerStackBuff(ctx, source, t, 'physical');
          const atk = effectiveStat(source, 'attack');
          const def = physicalTargetDefense(source, t);
          const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: skill.type };
          const { causedMult, takenMult } = damageBoosts(ctx, source, t, hit);
          const counterReduce = out.ignoresTroopCounter ? 0 : troopCounterReduceOf(source, t);
          const reduce = sumReduce(t, hit) + counterReduce;
          const { damage, breakdown } = calcDamage(
            {
              damageType: 'physical',
              rate,
              attackerAttack: atk,
              attackerStrategy: source.general.strategy,
              attackerTroops: source.troops,
              targetDefense: def,
              targetStrategy: t.general.strategy,
              mult: buffMult(causedMult, takenMult, reduce),
            },
            ctx.rng
          );
          const capped = applyTroopCap(damage, t.troops);
          ctx.events.push({
            type: 'damage',
            sourceId: source.general.id,
            creditToId: source.general.id === caster.general.id ? undefined : caster.general.id,
            targetId: t.general.id,
            skillId: skill.id,
            skillName: skill.name,
            damageType: 'physical',
            damage: capped,
            breakdown,
            modifiers: collectDamageModifiers(ctx, source, t, true, hit, { ignoresTroopCounter: out.ignoresTroopCounter }),
          });
          applyDamage(ctx, t, capped, source, 'physical', 'skill');
        }
        rememberDamageTargets(selectedIds);
        if (attacked) consumeAttackCharges(ctx, source, { damageSource: 'skill', damageType: 'physical', skillType: skill.type });
        break;
      }
    }
  }
}

/** 主动战法：发动率判定 → 准备检查 → 目标选择 → 执行效果 */
export function triggerActiveSkill(
  ctx: CombatContext,
  unit: UnitState,
  skill: Skill,
  enemies: UnitState[],
  allies: UnitState[],
  attackPool: UnitState[]
): void {
  // 七步释嫌等：进入主动发动率判定即「试图发动」
  triggerAllyActCommands(ctx, unit);
  if (!unit.alive) return;
  // 发动率递减（威震河朔）：每次成功发动后基础率 −decay，可叠、最低 0（在 trigger_boost 与士气之前）
  const decayPerCast = skill.triggerRateDecayPerCast ?? 0;
  const castCount = decayPerCast > 0 ? (ctx.skillCastCounters?.get(`${unit.general.id}:${skill.id}`) ?? 0) : 0;
  const rolled = rollTriggerRate(ctx.rng, skill.triggerRate);
  const decayed = decayPerCast > 0 ? Math.max(0, rolled - decayPerCast * castCount) : rolled;
  // 发动率提升：乘算（难知如阴）或加算封顶（动如雷震），再乘士气系数
  const base = boostedBaseRate(unit, 'active', decayed, skill);
  const morale = effectiveMorale(unit);
  const rate = moraleTriggerRate(morale, base);
  const success = ctx.rng.chance(rate);
  ctx.events.push({
    type: 'skill_trigger',
    unitId: unit.general.id,
    skillId: skill.id,
    skillName: skill.name,
    success,
    // 战报显示：当前生效几率（含士气修正）——70% × 士气系数 1.12 = 78%
    rate: Math.round(rate * 100),
    baseRate: Math.round(base * 100),
    morale,
  });
  if (!success) return;

  // 1 回合准备：本回合只登记准备，不释放。
  // 难知如阴跳过准备：施法者被施加 jump_prep 状态（rate=0~1 概率）时，发动即按概率直接释放（无准备回合）
  if (skill.type === 'active' && skill.prepare) {
    const jump = getStatus(unit, 'jump_prep');
    if (jump && ctx.rng.chance(jump.rate)) {
      ctx.events.push({
        type: 'prepare_skip',
        unitId: unit.general.id,
        skillId: skill.id,
        skillName: skill.name,
      });
    } else {
      unit.isPreparing = true;
      unit.preparingSkillId = skill.id;
      unit.prepareLeft = (skill.type === 'active' && skill.prepare ? (skill.prepareTurns ?? 1) : 1);
      ctx.events.push({
        type: 'prepare_start',
        unitId: unit.general.id,
        skillId: skill.id,
        skillName: skill.name,
      });
      return;
    }
  }

  executeSkillWithTargets(ctx, unit, skill, enemies, allies, attackPool);
  triggerAfterFirstActiveCommands(ctx, unit);
  triggerPassiveAfterActive(ctx, unit);
  // 三军夺帅：成功发动主动战法后触发；奉令护蜀：本侧友军行动叠层
  triggerActHooks(ctx, unit);
}

/** 准备完成的战法自动发动 */
function executePreparedSkill(
  ctx: CombatContext,
  unit: UnitState,
  skill: Skill,
  enemies: UnitState[],
  attackPool: UnitState[]
): void {
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  executeSkillWithTargets(ctx, unit, skill, enemies, allies, attackPool);
  triggerAfterFirstActiveCommands(ctx, unit);
  triggerPassiveAfterActive(ctx, unit);
  // 三军夺帅：成功发动主动战法后触发；奉令护蜀：本侧友军行动叠层
  triggerActHooks(ctx, unit);
}

/**
 * 本回合首次主动战法实际释放成功后触发二类指挥（文德椒房）。
 * 进入准备不算；准备完成释放与 jump_prep 跳过准备直放都算。
 * 每次按战法距离 / groupCount 重选目标；施法者已阵亡则只记标记不结算。
 */
function triggerAfterFirstActiveCommands(ctx: CombatContext, unit: UnitState): void {
  if (unit.firstActiveSucceededThisRound) return;
  unit.firstActiveSucceededThisRound = true;
  if (!unit.alive) return;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  for (const id of unit.general.commandSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'command' || skill.phase !== 'round') continue;
    if (skill.roundTrigger !== 'after_first_active') continue;
    const side = skill.targetSide ?? 'ally';
    const pool = side === 'ally' ? allies : enemies;
    const mode = resolveCombatTargetMode(skill.targetMode, 'group');
    const selected = skillTargets(ctx, unit, pool, skill.range, mode, skill.groupCount);
    ctx.events.push({
      type: 'skill_cast',
      unitId: unit.general.id,
      skillId: skill.id,
      skillName: skill.name,
    });
    executeSkillOutputs(ctx, unit, skill, selected);
  }
}

/**
 * 友军行动叠层（奉令护蜀）：本侧每次成功发动普攻 / 主动 / 追击后，给带 `allyActStacks` 被动的**其他**友军
 * 挂 / 叠加 1 层 `pending_stacks`（**不含行动者自身**——官方「任意友军」与「我军全体」措辞刻意区分，待复核）。
 * 每层数值在**首次叠层**时按持有者生效攻击 / 生效防御缩放后冻结（受攻击 / 受防御；成长率未确认时按基值）。
 */
export function triggerAllyActStacks(ctx: CombatContext, actor: UnitState): void {
  const team = actor.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const holder of team) {
    if (!holder.alive) continue;
    // 「任意友军」= 除行动者自身以外的友军（待复核：官方另有「我军全体」措辞用于含己场景）
    if (holder === actor) continue;
    for (const id of holder.general.passiveSkillIds) {
      const skill = resolveSkill(ctx, id);
      if (skill?.type !== 'passive' || !skill.allyActStacks) continue;
      addPendingStack(ctx, holder, skill);
    }
  }
}

/** 「成功发动」后的统一监听入口（普攻 / 主动 / 追击三来源共用）：
 *  ① 行动者自身 `afterAct`（三军夺帅）；② 本侧 `allyActStacks` 叠层（奉令护蜀）。
 *  叠层发生在本次行动**之后**，不影响本次行动的伤害结算。 */
export function triggerActHooks(ctx: CombatContext, actor: UnitState): void {
  triggerPassiveAfterAct(ctx, actor);
  triggerAllyActStacks(ctx, actor);
}

/** 叠 1 层待发（奉令护蜀）：首次叠层时冻结「每层增伤 / 每层减伤」，此后只加层数（上限 maxStacks）。 */
function addPendingStack(
  ctx: CombatContext,
  holder: UnitState,
  skill: Extract<Skill, { type: 'passive' }>
): void {
  const cfg = skill.allyActStacks;
  if (!cfg) return;
  const existing = holder.statuses.find(
    (s): s is Extract<Status, { type: 'pending_stacks' }> =>
      s.type === 'pending_stacks' && s.sourceSkillId === skill.id
  );
  if (existing) {
    if (existing.stacks < cfg.maxStacks) existing.stacks += 1;
    ctx.events.push({
      type: 'status_inflicted',
      unitId: holder.general.id,
      statusType: 'pending_stacks',
      detail: `${skill.name} ${existing.stacks}/${cfg.maxStacks} 层`,
    });
    return;
  }
  // 每层数值：受攻击 / 受防御缩放（growthRate 未确认时不缩放、用基值），挂上时冻结
  const atk = effectiveStat(holder, 'attack');
  const def = effectiveStat(holder, 'defense');
  const perLayerBoost =
    cfg.boostAttackScaled && cfg.boostGrowthRate !== undefined
      ? roundRate(scaledValue(cfg.boostRate * 100, cfg.boostGrowthRate, atk)) / 100
      : cfg.boostRate;
  const perLayerReduce =
    cfg.reduceDefenseScaled && cfg.reduceGrowthRate !== undefined
      ? roundRate(scaledValue(cfg.reduceRate * 100, cfg.reduceGrowthRate, def)) / 100
      : cfg.reduceRate;
  holder.statuses.push({
    type: 'pending_stacks',
    stacks: 1,
    maxStacks: cfg.maxStacks,
    perLayerBoost,
    perLayerReduce,
    appliedRound: ctx.currentRound,
    sourceSkillType: 'passive',
    sourceSkillId: skill.id,
    sourceUnitId: holder.general.id,
  });
  ctx.events.push({
    type: 'status_inflicted',
    unitId: holder.general.id,
    statusType: 'pending_stacks',
    detail: `${skill.name} 1/${cfg.maxStacks} 层`,
  });
}

/** 清空叠层待发（奉令护蜀）：普攻打出 / 受到实际伤害后**全部层数**清零（两段共用计数器，先到先清）。 */
function consumePendingStacks(ctx: CombatContext, unit: UnitState): void {
  const list = unit.statuses.filter((s) => s.type === 'pending_stacks');
  if (list.length === 0) return;
  unit.statuses = unit.statuses.filter((s) => s.type !== 'pending_stacks');
  for (const _s of list) {
    ctx.events.push({ type: 'status_expired', unitId: unit.general.id, statusType: 'pending_stacks' });
  }
}

/** 叠层待发·下次普攻增伤（奉令护蜀）：仅**普通攻击**读取（不含分兵溅射） */
function pendingStacksBoostOf(source: UnitState, hit?: DamageHitContext): number {
  if (!hit || hit.damageSource !== 'basic' || hit.split) return 0;
  let boost = 0;
  for (const s of source.statuses) {
    if (s.type === 'pending_stacks') boost += s.perLayerBoost * s.stacks;
  }
  return boost;
}

/** 叠层待发·下次受击减伤（奉令护蜀）：**任何**伤害都读取 */
function pendingStacksReduceOf(target: UnitState): number {
  let reduce = 0;
  for (const s of target.statuses) {
    if (s.type === 'pending_stacks') reduce += s.perLayerReduce * s.stacks;
  }
  return reduce;
}

/**
 * 被动「成功发动普通攻击 / 主动战法 / 追击战法后」触发（三军夺帅）：三种来源每次成功后各结算一次 output。
 * 与 `triggerPassiveAfterActive`（仅主动战法）区分；无次数上限。
 * 调用点：普攻（performNormalAttack）／主动释放（普通 + 准备完成）／追击成功释放。
 * 注意：本钩子输出的伤害段**不再**回触发本钩子（只有三类「发动」动作会调用它），故无自递归。
 */
export function triggerPassiveAfterAct(ctx: CombatContext, unit: UnitState): void {
  if (!unit.alive) return;
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  for (const id of unit.general.passiveSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'passive' || !skill.afterAct) continue;
    ctx.events.push({
      type: 'skill_cast',
      unitId: unit.general.id,
      skillId: skill.id,
      skillName: skill.name,
    });
    executeSkillOutputs(ctx, unit, skill, enemies, skill.afterAct.output);
  }
}

/**
 * 被动「发动主动战法后」触发（九伐中原）：**每次**主动战法成功释放后结算（不限本回合首次，
 * 与二类指挥 after_first_active 区分）。maxTriggers = 整场战斗可发动次数上限（九伐中原 9 次），
 * 计数走战法级计数器 ctx.afterActiveCounters（整场累计、不随回合重置）。
 * 目标池：交给 output 段的 targetMode 重选（缺省传入对侧全体存活作为兜底）。
 */
export function triggerPassiveAfterActive(ctx: CombatContext, unit: UnitState): void {
  if (!unit.alive) return;
  const enemies = unit.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
  for (const id of unit.general.passiveSkillIds) {
    const skill = resolveSkill(ctx, id);
    if (skill?.type !== 'passive' || !skill.afterActive) continue;
    const cfg = skill.afterActive;
    if (cfg.maxTriggers != null) {
      ctx.afterActiveCounters ??= new Map();
      const key = `${unit.general.id}:${skill.id}`;
      const used = ctx.afterActiveCounters.get(key) ?? 0;
      if (used >= cfg.maxTriggers) continue;
      ctx.afterActiveCounters.set(key, used + 1);
    }
    ctx.events.push({
      type: 'skill_cast',
      unitId: unit.general.id,
      skillId: skill.id,
      skillName: skill.name,
    });
    executeSkillOutputs(ctx, unit, skill, enemies, cfg.output);
  }
}

function executeSkillWithTargets(
  ctx: CombatContext,
  unit: UnitState,
  skill: Skill,
  enemies: UnitState[],
  allies: UnitState[],
  attackPool: UnitState[]
): void {
  if (skill.type === 'pursuit') {
    // 追击战法由普攻命中触发，不在此处理
    return;
  }
  // 发动率递减计数：本战法实际释放一次（威力上即「发动一次」，准备主动在释放时计一次）
  if (skill.triggerRateDecayPerCast) {
    ctx.skillCastCounters ??= new Map();
    const key = `${unit.general.id}:${skill.id}`;
    ctx.skillCastCounters.set(key, (ctx.skillCastCounters.get(key) ?? 0) + 1);
  }

  const targetMode = skill.targetMode;
  let targets: UnitState[];
  if (targetMode === 'self') {
    targets = [unit];
  } else {
    // 暴走：战法目标不分敌我（含友军/敌军）
    const rampage = hasStatus(unit, 'rampage');
    // 增益类效果（清 debuff / 上规避 / 治疗 / 正向属性 buff）作用于友军（非暴走时）。
    // 负值属性 buff（debuff，amount<0）作用于敌军；target:'self' 的输出只作用于施法者自身，不决定战法整体目标池
    const selfBuff = skill.output.some(
      (o) =>
        o.kind !== 'positional_physical_damage' &&
        o.kind !== 'morale_branch' &&
        o.kind !== 'random_pick' &&
        o.kind !== 'chance_group' &&
        o.kind !== 'detonate_sorcery_marks' &&
        o.target !== 'self' &&
        // 单输出已覆盖目标池的 heal/inflict 不决定战法整体目标（利兵谋胜：伤敌 + 治友）
        !('targetSide' in o && o.targetSide) &&
        (o.kind === 'remove_debuffs' ||
          o.kind === 'grant_evasion' ||
          o.kind === 'heal' ||
          (o.kind === 'inflict_status' &&
            (Array.isArray(o.status) ? o.status : [o.status]).some(
              (st) =>
                (st.type === 'attack_buff' && (st.amount ?? 0) > 0) ||
                (st.type === 'defense_buff' && (st.amount ?? 0) > 0) ||
                (st.type === 'strategy_buff' && (st.amount ?? 0) > 0) ||
                (st.type === 'speed_buff' && (st.amount ?? 0) > 0) ||
                st.type === 'damage_reduce' ||
                st.type === 'evasion'
            )))
    );
    // targetSide 覆盖：'enemy'=对敌施放（闭月等防御减益）、'ally'=对友施放；缺省按启发式
    const targetSide = 'targetSide' in skill ? skill.targetSide : undefined;
    const pool =
      targetSide === 'enemy'
        ? enemies
        : targetSide === 'ally'
          ? allies
          : rampage
            ? attackPool
            : selfBuff
              ? allies
              : enemies;
    targets = skillTargets(ctx, unit, pool, skill.range, targetMode, skill.groupCount ?? 2);
  }

  ctx.events.push({
    type: 'skill_target',
    unitId: unit.general.id,
    skillId: skill.id,
    targetIds: targets.map((t) => t.general.id),
  });
  if (targets.length === 0) return;
  if (skill.teamTroopFilter && !teamPassesTroopFilter(
    unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam,
    skill.teamTroopFilter
  )) return;

  ctx.events.push({
    type: 'skill_cast',
    unitId: unit.general.id,
    skillId: skill.id,
    skillName: skill.name,
  });
  executeSkillOutputs(ctx, unit, skill, targets);
}

/** 追击战法：普攻命中后，对命中目标执行 */
function triggerPursuitSkill(
  ctx: CombatContext,
  unit: UnitState,
  skill: Skill,
  hitTarget: UnitState,
  enemies: UnitState[]
): void {
  // 妖术诅咒（密谋定蜀）：试图发动追击战法时（进入判定，无论发动率结果）受到妖术诅咒伤害；诅咒致死则终止判定
  triggerCurseOnPursuit(ctx, unit);
  if (!unit.alive) return;
  // 七步释嫌等：进入追击发动率判定即「试图发动」
  triggerAllyActCommands(ctx, unit);
  if (!unit.alive) return;
  // 发动率提升：追击同样吃 trigger_boost（动如雷震仅追击加算 +100 个百分点）
  const rolled = rollTriggerRate(ctx.rng, skill.triggerRate);
  const base = boostedBaseRate(unit, 'pursuit', rolled, skill);
  const morale = effectiveMorale(unit);
  const rate = moraleTriggerRate(morale, base);
  const success = ctx.rng.chance(rate);
  ctx.events.push({
    type: 'skill_trigger',
    unitId: unit.general.id,
    skillId: skill.id,
    skillName: skill.name,
    success,
    rate: Math.round(rate * 100),
    baseRate: Math.round(base * 100),
    morale,
  });
  if (!success) return;

  ctx.events.push({
    type: 'skill_target',
    unitId: unit.general.id,
    skillId: skill.id,
    targetIds: [hitTarget.general.id],
  });
  ctx.events.push({
    type: 'skill_cast',
    unitId: unit.general.id,
    skillId: skill.id,
    skillName: skill.name,
  });
  executeSkillOutputs(ctx, unit, skill, [hitTarget]);
  // 三军夺帅：成功发动追击战法后触发；奉令护蜀：本侧友军行动叠层
  triggerActHooks(ctx, unit);
}

// ─── 普通攻击 ───

/** 普通攻击选敌：优先被挑衅/援護强制引走，否则按最近敌军。
 *  挑衅：攻击者身上有 taunt 状态 → 强制普攻挑衅者（targetId）。
 *  援護：攻击者最近目标有 cover 保护的友军 → 普攻目标改为 cover 持有者。 */
function selectAttackTarget(
  ctx: CombatContext,
  unit: UnitState,
  enemies: UnitState[],
  allies: UnitState[]
): UnitState | null {
  // 1. 挑衅：攻击者被挑衅 → 无视距离强制普攻挑衅者
  const taunt = getStatus(unit, 'taunt');
  if (taunt) {
    const taunter = enemies.find((e) => e.alive && e.general.id === taunt.targetId);
    if (taunter) {
      ctx.events.push({
        type: 'status_inflicted',
        unitId: unit.general.id,
        statusType: 'taunt',
        detail: `挑衅：强制普攻 ${taunter.general.name}`,
      });
      return taunter;
    }
  }
  // 2. 援護：攻击者最近目标有 cover 保护 → 普攻改为打 cover 持有者
  const nearest = nearestEnemy(ctx, unit, enemies);
  if (nearest) {
    const cover = getStatus(nearest, 'cover');
    if (cover) {
      const coverer = allies.find((a) => a.alive && a !== nearest && hasStatus(a, 'cover'));
      if (coverer) {
        ctx.events.push({
          type: 'status_inflicted',
          unitId: unit.general.id,
          statusType: 'cover',
          detail: `${coverer.general.name} 援護 ${nearest.general.name}`,
        });
        return coverer;
      }
    }
  }
  return nearest;
}

/** 普通攻击：返回命中的目标；未命中返回 null */
function normalAttack(
  ctx: CombatContext,
  unit: UnitState,
  enemies: UnitState[],
  allies: UnitState[],
  canAttack: boolean
): UnitState | null {
  if (!canAttack) {
    ctx.events.push({
      type: 'no_attack_target',
      unitId: unit.general.id,
      name: unit.general.name,
      reason: '怯战：无法进行普通攻击',
    });
    return null;
  }

  const target = selectAttackTarget(ctx, unit, enemies, allies);
  if (!target) {
    ctx.events.push({
      type: 'no_attack_target',
      unitId: unit.general.id,
      name: unit.general.name,
      reason: `攻击距离 ${attackRangeOf(unit)} 内无存活敌军`,
    });
    return null;
  }

  const distance = distanceBetween(ctx, unit, target);
  dealAttack(ctx, unit, target, distance);
  // 七步释嫌等：成功发动普通攻击（含规避命中）后触发
  triggerAllyActCommands(ctx, unit);
  // 三军夺帅：成功发动普通攻击后触发；奉令护蜀：本侧友军行动叠层
  triggerActHooks(ctx, unit);
  return target;
}

/** 计算并结算一次攻击伤害普攻（含连击的追击加成待做） */
function dealAttack(ctx: CombatContext, unit: UnitState, target: UnitState, distance: number): void {
  const hit = redirectPhysicalHit(ctx, target);
  if (!hit.alive) return;
  // 常驻伤害前叠层（持节镇西）：攻击方叠攻击、受击者叠防御
  triggerStackBuff(ctx, unit, hit, 'physical');
  const atk = effectiveStat(unit, 'attack');
  const def = physicalTargetDefense(unit, hit);
  const hitCtx: DamageHitContext = { damageSource: 'basic', damageType: 'physical' };
  const { causedMult, takenMult } = damageBoosts(ctx, unit, hit, hitCtx);
  const reduce = sumReduce(hit, hitCtx) + troopCounterReduceOf(unit, hit);
  const { damage, breakdown } = calcDamage(
    {
      damageType: 'physical',
      rate: 100,
      attackerAttack: atk,
      attackerStrategy: unit.general.strategy,
      attackerTroops: unit.troops,
      targetDefense: def,
      targetStrategy: hit.general.strategy,
      mult: buffMult(causedMult, takenMult, reduce),
    },
    ctx.rng
  );
  const capped = applyTroopCap(damage, hit.troops);

  // 规避：命中前判定免疫
  if (consumeEvasion(ctx, hit, unit.general.id)) {
    consumeAttackCharges(ctx, unit, { damageSource: 'basic', damageType: 'physical' });
    // 奉令护蜀：本次普攻已打出 → 清空待发层数（含未能造成伤害的规避情形）
    consumePendingStacks(ctx, unit);
    return;
  }

  ctx.events.push({
    type: 'attack_hit',
    sourceId: unit.general.id,
    targetId: hit.general.id,
    distance,
    damage: capped,
    breakdown,
    modifiers: collectDamageModifiers(ctx, unit, hit, true, hitCtx),
  });
  applyDamage(ctx, hit, capped, unit, 'physical', 'basic');
  consumeAttackCharges(ctx, unit, { damageSource: 'basic', damageType: 'physical' });
  // 奉令护蜀：普攻打出后清空待发层数（攻击已消耗本次增伤）
  consumePendingStacks(ctx, unit);
}

/** 持续型急救受击触发（皇裔流离/金匮要略）：目标受到伤害后判定。
 *  每个急救状态独立判定一次：按战法级计数器当前触发率 rng 判定，成功则恢复兵力（受围困拦截），
 *  并累计战法级总生效次数——每达到 triggerUpEvery 次，触发率 +triggerUpIncrement（可叠加）。
 *  兵力已归零或已阵亡时不判定（致死一击不可救回、不可复活）。 */
function triggerFirstAidOnHurt(ctx: CombatContext, target: UnitState): void {
  // 致死一击（兵力已归零）或已阵亡：不判定急救，避免「打死又复活」
  if (!target.alive || target.troops <= 0) return;
  const aids = target.statuses.filter((s) => s.type === 'first_aid') as Extract<Status, { type: 'first_aid' }>[];
  for (const aid of aids) {
    ctx.firstAidCounters ??= [];
    const counter = ctx.firstAidCounters.find((c) => c.skillId === aid.sourceSkillId && c.casterId === aid.sourceUnitId);
    if (!counter) continue; // 计数器缺失（单元测试直构状态）：不触发
    // 触发率受施法者士气修正（一类指挥生效几率，如 50% × 士气系数 1.12 = 56%）
    const rate = moraleTriggerRate(casterMorale(ctx, aid.sourceUnitId), counter.rate / 100);
    if (!ctx.rng.chance(rate)) continue; // 触发率判定（皇裔流离 50%）

    const skill = resolveSkill(ctx, aid.sourceSkillId);
    // 恢复值 = floor(round(单位伤害(施法者挂上时兵力)) × 恢复率/100 × (1+恢复提高))：
    // 恢复率与施法者兵力均在挂上时冻结（十面埋伏《率土秘卷一》）；直构状态（无 healTroops）回退目标当前兵力
    const amount = calcHealAmount(aid.healTroops ?? target.troops, aid.healRate);
    if (hasStatus(target, 'siege')) {
      // 围困：无法回复兵力（判定成功但恢复被拦截，仍计生效次数）
      ctx.events.push({
        type: 'siege_blocked',
        unitId: target.general.id,
        skillId: aid.sourceSkillId,
      });
    } else {
      const before = target.troops;
      // 伤兵机制：恢复只能从伤兵池扣除（死亡兵力不可恢复；受伤即刻入池，受击恢复立即可用）
      const healed = recoverTroops(ctx, target, amount);
      if (healed > 0) {
        ctx.events.push({
          type: 'heal',
          sourceId: aid.sourceUnitId,
          targetId: target.general.id,
          skillId: aid.sourceSkillId,
          skillName: skill?.name ?? aid.sourceSkillId,
          amount: healed,
          before,
          after: target.troops,
        });
      }
    }
    // 总生效次数 +1；每达到 triggerUpEvery 次 → 触发率 +triggerUpIncrement（可叠加：50→55→60…）
    counter.triggerCount += 1;
    if (aid.triggerUpEvery > 0 && counter.triggerCount % aid.triggerUpEvery === 0) {
      counter.rate += aid.triggerUpIncrement;
      ctx.events.push({
        type: 'status_inflicted',
        unitId: target.general.id,
        statusType: 'first_aid',
        detail: `持续型急救生效几率提升至 ${counter.rate}%（累计生效 ${counter.triggerCount} 次）`,
      });
    }
  }
}

/** 伤兵死亡机制：当前回合死亡率（%）= base + perRound×(回合-1)，封顶 100%。
 *  未配置机制（直接构造 ctx 的单元测试）返回 0 = 不启用。 */
function mortalityRate(ctx: CombatContext, round: number): number {
  const c = ctx.woundedMortality;
  if (!c) return 0;
  return Math.max(0, Math.min(100, c.base + c.perRound * (round - 1)));
}

/** 受恢复触发：被恢复者是否匹配战法 victim 侧（self=施法者自身 / ally=同侧含自己） */
function matchOnHealVictim(cfg: OnHealConfig, caster: UnitState, target: UnitState): boolean {
  if (cfg.victim === 'self') return caster.general.id === target.general.id;
  return caster.side === target.side;
}

/** 受恢复触发率：基础率 × 施法者士气系数（缺省必中） */
function rollOnHeal(
  ctx: CombatContext,
  caster: UnitState,
  cfg: OnHealConfig
): { success: boolean; rate: number; baseRate: number } {
  const base = cfg.rate ?? 1;
  const rate = moraleTriggerRate(effectiveMorale(caster), base);
  return { success: ctx.rng.chance(rate), rate, baseRate: base };
}

/** 受恢复触发效果落点：self=只对施法者结算；allies=友军全体（含自己） */
function applyOnHealEffect(
  ctx: CombatContext,
  caster: UnitState,
  skill: Skill,
  cfg: OnHealConfig
): void {
  ctx.events.push({
    type: 'skill_cast',
    unitId: caster.general.id,
    skillId: skill.id,
    skillName: skill.name,
  });
  if (cfg.applyTo === 'self') {
    executeSkillOutputs(ctx, caster, skill, [caster], cfg.output);
    return;
  }
  const team = caster.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  const allies = team.filter((a) => a.alive);
  executeSkillOutputs(ctx, caster, skill, allies, cfg.output);
}

/**
 * 受恢复触发（赏顺伐逆）：`recoverTroops` 实际恢复 > 0 后判定。
 * 群体奶再走 `recoverTroops` 时由 `resolvingHealHooks` 防重入，避免自己奶自己再套一层。
 */
function triggerOnHeal(ctx: CombatContext, target: UnitState): void {
  if (ctx.resolvingHealHooks) return;
  ctx.resolvingHealHooks = true;
  try {
    const all = ctx.myTeam.concat(ctx.enemyTeam);
    for (const caster of all) {
      const ids = [...caster.general.commandSkillIds, ...caster.general.passiveSkillIds];
      for (const id of ids) {
        const skill = resolveSkill(ctx, id);
        if (!skill || (skill.type !== 'command' && skill.type !== 'passive') || !skill.onHeal) continue;
        const cfg = skill.onHeal;
        if (!caster.alive && !skill.retainAfterDeath) continue;
        if (!matchOnHealVictim(cfg, caster, target)) continue;
        const rolled = rollOnHeal(ctx, caster, cfg);
        if ((cfg.rate ?? 1) < 1) {
          ctx.events.push({
            type: 'skill_trigger',
            unitId: caster.general.id,
            targetId: target.general.id,
            skillId: skill.id,
            skillName: skill.name,
            success: rolled.success,
            rate: Math.round(rolled.rate * 100),
            baseRate: Math.round(rolled.baseRate * 100),
            morale: effectiveMorale(caster),
          });
        }
        if (!rolled.success) continue;
        applyOnHealEffect(ctx, caster, skill, cfg);
      }
    }
  } finally {
    ctx.resolvingHealHooks = false;
  }
}

/** 恢复兵力（heal/持续急救统一入口）：配置了伤兵机制时只能从伤兵池恢复——死亡兵力（totalDead）不可恢复，
 *  实际恢复量 = min(请求量, 伤兵池剩余, 兵力缺口) 且扣减伤兵池；
 *  未配置机制（直接构造 ctx 的单元测试）时保持旧行为：恢复只受兵力上限限制。
 *  已阵亡或兵力已为 0 时返回 0（不可复活）。
 *  实际恢复 > 0 后走 `triggerOnHeal`（主动奶 / 持续急救 / 休整共用）。 */
export function recoverTroops(ctx: CombatContext, target: UnitState, amount: number): number {
  // 已阵亡（兵力 0）不可被急救/休整/主动恢复复活
  if (!target.alive || target.troops <= 0) return 0;
  const pool = ctx.woundedMortality ? Math.min(target.wounded, target.general.maxTroops - target.troops) : target.general.maxTroops - target.troops;
  const recoverable = Math.max(0, Math.min(amount, pool));
  if (recoverable > 0) {
    target.troops += recoverable;
    if (ctx.woundedMortality) target.wounded -= recoverable;
  }
  if (recoverable > 0) triggerOnHeal(ctx, target);
  return recoverable;
}

export /** 妖术诅咒（密谋定蜀）：携带者试图发动追击战法时触发——结算一次妖术伤害（挂上时冻结），
 *  每次判定追击都触发、不消耗状态；诅咒致死则终止后续追击判定。 */
function triggerCurseOnPursuit(ctx: CombatContext, unit: UnitState): void {
  const curses = unit.statuses.filter((s): s is Extract<Status, { type: 'curse' }> => s.type === 'curse');
  for (const curse of curses) {
    dealDotDamage(ctx, unit, curse);
    if (!unit.alive) break;
  }
}

/** 引燃标记（火势风威）：携带者受到伤害时触发——额外引发一次燃烧伤害（挂上时冻结），
 *  随后标记移除（一次性）。 */
function triggerIgniteOnHurt(ctx: CombatContext, target: UnitState): void {
  const ignites = target.statuses.filter((s): s is Extract<Status, { type: 'ignite' }> => s.type === 'ignite');
  if (ignites.length === 0) return;
  // 先移除标记（一次性），再结算伤害（结算伤害走 applyDamage 不会再触发本标记）
  target.statuses = target.statuses.filter((s) => s.type !== 'ignite');
  for (const ignite of ignites) {
    dealDotDamage(ctx, target, ignite);
    if (!target.alive) break;
  }
}

/** 受击触发妖术（破凰「条件妖术」）：携带者每受到 1 次伤害额外引发 1 次妖术伤害
 *  （挂上时冻结 stored，滞后触发），charges 递减、用尽即移除；
 *  与 remaining 持续回合两者先到先失效。
 *  结算前**临时移除本标记**再打伤害——否则本次妖术伤害走 applyDamage 会再次触发本标记，
 *  一次受击就把剩余次数全部吃掉（对照 ignite 一次性标记的「先移除再结算」）。 */
function triggerSorceryMarkOnHurt(ctx: CombatContext, target: UnitState): void {
  const marks = target.statuses.filter(
    (s): s is Extract<Status, { type: 'sorcery' }> => s.type === 'sorcery' && s.onHurt === true
  );
  for (const mark of marks) {
    if (!target.alive) break;
    const left = (mark.charges ?? 0) - 1;
    target.statuses = target.statuses.filter((x) => x !== mark);
    dealDotDamage(ctx, target, mark);
    if (!target.alive) break;
    if (left > 0) {
      mark.charges = left;
      target.statuses.push(mark);
    } else {
      ctx.events.push({ type: 'status_expired', unitId: target.general.id, statusType: 'sorcery' });
    }
  }
}

/** 受击触发（盲侯奋勇/陷储立齐/同仇敌忾/缓师徐持）：扣兵后、阵亡标记前判定。
 *  反击等二次 applyDamage 不再递归（resolvingHurtHooks），避免盲侯循环。
 *  @param damageType 本次伤害类型；缺省不按 `onHurt.damageKind` 过滤（旧调用保持原行为）
 *  @param damageSource 伤害来源；缺省不传或 `'basic'` 均匹配 `cfg.damageSource==='basic'`，仅 `'skill'` 被拒绝
 *  @param timing 判定时机；缺省 `after_damage`（扣兵后）。`before_damage` 由 `applyDamage` 扣兵前调用 */
function triggerOnHurt(
  ctx: CombatContext,
  victim: UnitState,
  source?: UnitState,
  damageType?: DamageType,
  damageSource?: 'basic' | 'skill',
  timing: 'before_damage' | 'after_damage' = 'after_damage'
): { thisHitReduce: number; evasionBlocked: boolean } {
  const none = { thisHitReduce: 0, evasionBlocked: false };
  if (ctx.resolvingHurtHooks) return none;
  ctx.resolvingHurtHooks = true;
  /** 剩余伤害系数，多条 thisHitReduce 各自乘算 (1 − rate) */
  let remaining = 1;
  let evasionBlocked = false;
  try {
    const all = ctx.myTeam.concat(ctx.enemyTeam);
    for (const caster of all) {
      const ids = [...caster.general.commandSkillIds, ...caster.general.passiveSkillIds];
      for (const id of ids) {
        const skill = resolveSkill(ctx, id);
        if (!skill || (skill.type !== 'command' && skill.type !== 'passive') || !skill.onHurt) continue;
        if (!caster.alive && !skill.retainAfterDeath) continue;
        const cfgs = Array.isArray(skill.onHurt) ? skill.onHurt : [skill.onHurt];
        for (const cfg of cfgs) {
          const hookTiming = cfg.timing ?? 'after_damage';
          if (hookTiming !== timing) continue;
          if (cfg.damageSource === 'basic' && damageSource === 'skill') continue;
          if (cfg.startRound != null && ctx.currentRound < cfg.startRound) continue;
          if (cfg.endRound != null && ctx.currentRound > cfg.endRound) continue;
          if (!matchOnHurtVictim(ctx, skill, cfg, caster, victim)) continue;
          if (cfg.damageKind && damageType && cfg.damageKind !== damageType) continue;
          if (cfg.onlyIfActed && !victim.hasActedThisRound) continue;
          if (cfg.onlyIfSourceTauntsVictim) {
            if (!source || !source.alive) continue;
            if (!source.statuses.some((s) => s.type === 'taunt' && s.targetId === victim.general.id)) continue;
          }
          if (cfg.applyTo === 'source' || cfg.sourceMaxDistance != null) {
            if (!source || !source.alive || source.side === caster.side) continue;
            if (cfg.sourceMaxDistance != null && distanceBetween(ctx, caster, source) > cfg.sourceMaxDistance) continue;
          }
          if (cfg.oncePerRound) {
            ctx.hurtOnceKeys ??= new Set();
            const key = `${ctx.currentRound}:${skill.id}:${caster.general.id}:${victim.general.id}`;
            if (ctx.hurtOnceKeys.has(key)) continue;
            ctx.hurtOnceKeys.add(key);
          }
          // 兵力阈值（持玺兴兵：「若其兵力低于初始兵力 50%」）——判定受伤者实时兵力
          if (cfg.troopRatio && !troopRatioMatches(victim, cfg.troopRatio)) continue;
          // 整场触发次数上限（持玺兴兵：「该效果共可触发 3 次」）——按「战法 × 施法者」整场累计
          if (cfg.maxTriggers != null) {
            ctx.hurtTriggerCounters ??= new Map();
            const tKey = `${caster.general.id}:${skill.id}`;
            if ((ctx.hurtTriggerCounters.get(tKey) ?? 0) >= cfg.maxTriggers) continue;
          }
          // 首次受击必触发，且额外触发 1 次（疮痍累身：
          // 「首次受到伤害时，该效果必定触发且额外触发1次」）
          let guaranteedFirst = false;
          if (cfg.firstGuaranteed) {
            ctx.hurtFirstKeys ??= new Set();
            const firstKey = `${skill.id}:${caster.general.id}:${victim.general.id}`;
            if (!ctx.hurtFirstKeys.has(firstKey)) {
              ctx.hurtFirstKeys.add(firstKey);
              guaranteedFirst = true;
            }
          }
          const rolls = (cfg.rolls ?? 1) + (guaranteedFirst ? 1 : 0);
          for (let i = 0; i < rolls; i++) {
            const rolled = rollOnHurt(ctx, caster, skill, cfg);
            // 首次必中：覆盖判定结果，但 rate/baseRate 仍取原值供战报显示
            const hitOk = guaranteedFirst || rolled.success;
            if ((cfg.rate ?? 1) < 1 || cfg.rateStrategyScaled) {
              ctx.events.push({
                type: 'skill_trigger',
                unitId: caster.general.id,
                targetId: victim.general.id,
                skillId: skill.id,
                skillName: skill.name,
                success: hitOk,
                rate: Math.round(rolled.rate * 100),
                baseRate: Math.round(rolled.baseRate * 100),
                morale: effectiveMorale(caster),
              });
            }
            if (!hitOk) continue;
            if (cfg.maxTriggers != null) {
              ctx.hurtTriggerCounters ??= new Map();
              const tKey = `${caster.general.id}:${skill.id}`;
              ctx.hurtTriggerCounters.set(tKey, (ctx.hurtTriggerCounters.get(tKey) ?? 0) + 1);
            }
            // 官方口径（疮痍累身）：自带 output 的受击战法在每次触发时先出一行
            // 「【周泰】执行来自【周泰】的【疮痍累身】效果！」——仅此类战法推送，
            // 盲侯/陷储/同仇等「output 落在战法整体」的既有受击战法事件流不变（零回归）
            if (cfg.output && cfg.output.length > 0) {
              ctx.events.push({
                type: 'skill_exec',
                unitId: victim.general.id,
                detail: `【${victim.general.name}】执行来自【${caster.general.name}】的【${skill.name}】效果！`,
              });
            }
            if (timing === 'before_damage') {
              if (cfg.thisHitReduce != null) remaining *= 1 - cfg.thisHitReduce;
              const outs = cfg.output;
              if (outs && outs.length > 0) {
                applyOnHurtEffect(ctx, caster, skill, cfg, victim, source);
                if (outs.some((o) => o.kind === 'grant_evasion')) {
                  if (consumeEvasion(ctx, victim, source?.general.id ?? '')) {
                    evasionBlocked = true;
                    return { thisHitReduce: 1 - remaining, evasionBlocked: true };
                  }
                }
              }
            } else {
              applyOnHurtEffect(ctx, caster, skill, cfg, victim, source);
              // 施法者自身落点（持玺兴兵：「同时自身攻击、谋略属性下降 30」）
              if (cfg.selfOutput && cfg.selfOutput.length > 0) {
                executeSkillOutputs(ctx, caster, skill, [caster], cfg.selfOutput);
              }
            }
          }
        }
      }
    }
  } finally {
    ctx.resolvingHurtHooks = false;
  }
  return { thisHitReduce: 1 - remaining, evasionBlocked };
}

/** 受击触发：受伤者是否匹配战法 victim 侧（含一类指挥 locked 锁定目标） */
function matchOnHurtVictim(
  ctx: CombatContext,
  skill: Skill,
  cfg: OnHurtConfig,
  caster: UnitState,
  victim: UnitState
): boolean {
  if (cfg.victim === 'self') return caster.general.id === victim.general.id;
  if (cfg.victim === 'ally') return caster.side === victim.side;
  if (cfg.victim === 'locked') {
    return ctx.lockedCommands.some(
      (l) =>
        l.skill.id === skill.id &&
        l.casterId === caster.general.id &&
        l.targets.some((t) => t.general.id === victim.general.id)
    );
  }
  return caster.side !== victim.side;
}

/** 受击触发率：可选谋略缩放 + 士气修正 */
function rollOnHurt(
  ctx: CombatContext,
  caster: UnitState,
  _skill: Skill,
  cfg: OnHurtConfig
): { success: boolean; rate: number; baseRate: number } {
  let base = cfg.rate ?? 1;
  if (cfg.rateStrategyScaled) {
    const growth = cfg.rateGrowthRate ?? 0.15;
    base = roundRate(scaledValue(base * 100, growth, effectiveStat(caster, 'strategy'))) / 100;
  }
  const rate = moraleTriggerRate(effectiveMorale(caster), base);
  return { success: ctx.rng.chance(rate), rate, baseRate: base };
}

const STEAL_STAT_TYPE: Record<'attack' | 'defense' | 'strategy', 'attack_buff' | 'defense_buff' | 'strategy_buff'> = {
  attack: 'attack_buff',
  defense: 'defense_buff',
  strategy: 'strategy_buff',
};

/** 受击触发效果落点 */
function applyOnHurtEffect(
  ctx: CombatContext,
  caster: UnitState,
  skill: Skill,
  cfg: OnHurtConfig,
  victim: UnitState,
  source?: UnitState
): void {
  if (cfg.applyTo === 'steal') {
    if (!source || !cfg.steal || source.general.id === victim.general.id) return;
    const stats = cfg.steal.stats;
    const pick = stats[ctx.rng.int(stats.length)];
    const type = STEAL_STAT_TYPE[pick];
    inflictStatus(ctx, source, { type, amount: -cfg.steal.amount, duration: cfg.steal.duration }, skill.type, skill.id, caster.general.id);
    inflictStatus(ctx, victim, { type, amount: cfg.steal.amount, duration: cfg.steal.duration }, skill.type, skill.id, caster.general.id);
    return;
  }

  if (cfg.maxStacks && (cfg.applyTo === 'victim' || cfg.applyTo === 'source')) {
    const dest = cfg.applyTo === 'source' ? source : victim;
    if (!dest) return;
    const existing = dest.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === skill.id);
    const stacks = existing && 'stacks' in existing ? (existing.stacks ?? 1) : 0;
    if (stacks >= cfg.maxStacks) return;
  }

  ctx.events.push({
    type: 'skill_cast',
    unitId: caster.general.id,
    skillId: skill.id,
    skillName: skill.name,
  });

  if (cfg.applyTo === 'skill_targets') {
    const enemies = caster.side === 'my' ? ctx.enemyTeam : ctx.myTeam;
    const targetMode = 'targetMode' in skill ? skill.targetMode : 'group';
    const mode =
      targetMode === 'single' || targetMode === 'random_single' || targetMode === 'group' || targetMode === 'all'
        ? targetMode
        : 'group';
    const targets = skillTargets(ctx, caster, enemies, skill.range, mode, 'groupCount' in skill ? skill.groupCount : 2);
    executeSkillOutputs(ctx, caster, skill, targets, cfg.output);
    return;
  }

  if (cfg.applyTo === 'source') {
    if (!source || !source.alive) return;
    executeSkillOutputs(ctx, caster, skill, [source], cfg.output);
    return;
  }

  if (cfg.applyTo === 'victim') {
    executeSkillOutputs(ctx, caster, skill, [victim], cfg.output);
    return;
  }

  if (cfg.applyTo === 'allies_within') {
    const team = victim.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
    const within = cfg.withinDistance ?? 1;
    const allies = team.filter((a) => {
      if (!a.alive && a.general.id !== victim.general.id) return false;
      if (sameSideDistance(ctx, victim, a) > within) return false;
      if (!cfg.maxStacks) return true;
      const existing = a.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === skill.id);
      const stacks = existing && 'stacks' in existing ? (existing.stacks ?? 1) : 0;
      return stacks < cfg.maxStacks;
    });
    if (allies.length === 0) return;
    executeSkillOutputs(ctx, caster, skill, allies, cfg.output);
  }
}

/**
 * 普攻实际扣兵后结算反击：按 dealAttack 同口径对来源打攻击。
 * 调用方须已设 `resolvingHurtHooks`，使本次 applyDamage 不再套 before/after/counter。
 * 不消耗 counter 状态。
 */
function settleCounterOnHurt(ctx: CombatContext, holder: UnitState, attacker: UnitState): void {
  const counters = holder.statuses.filter(
    (s): s is Extract<Status, { type: 'counter' }> => s.type === 'counter'
  );
  for (const status of counters) {
    if (!attacker.alive) break;
    const atk = effectiveStat(holder, 'attack');
    const def = physicalTargetDefense(holder, attacker);
    const hit: DamageHitContext = { damageSource: 'skill', damageType: 'physical', skillType: 'command' };
    const { causedMult, takenMult } = damageBoosts(ctx, holder, attacker, hit);
    const reduce = sumReduce(attacker, hit) + troopCounterReduceOf(holder, attacker);
    const { damage, breakdown } = calcDamage(
      {
        damageType: 'physical',
        rate: status.rate,
        attackerAttack: atk,
        attackerStrategy: holder.general.strategy,
        attackerTroops: holder.troops,
        targetDefense: def,
        targetStrategy: attacker.general.strategy,
        mult: buffMult(causedMult, takenMult, reduce),
      },
      ctx.rng
    );
    const capped = applyTroopCap(damage, attacker.troops);
    ctx.events.push({
      type: 'damage',
      sourceId: holder.general.id,
      creditToId: holder.general.id,
      targetId: attacker.general.id,
      skillId: status.sourceSkillId,
      skillName: resolveSkill(ctx, status.sourceSkillId)?.name ?? status.sourceSkillId,
      damageType: 'physical',
      damage: capped,
      breakdown,
      modifiers: collectDamageModifiers(ctx, holder, attacker, true, hit),
    });
    applyDamage(ctx, attacker, capped, holder, 'physical', 'skill');
  }
}

/**
 * 扣减目标兵力并走受击钩子（急救 / 引燃 / onHurt）。
 * @param damageType 本次伤害类型；缺省不按 `onHurt.damageKind` 过滤，旧调用保持原行为
 * @param damageSource 伤害来源；缺省不传或 `'basic'` 均匹配 `onHurt.damageSource==='basic'`，仅明确 `'skill'` 被拒绝
 */
/**
 * 援护（移花接木 / 疮痍累身）：受击者为友军时，由同阵营带 cover 状态且存活的单位代为承受。
 * 官方口径为「为其抵挡普通攻击」——仅普攻伤害转移，战法伤害不转移；援护者不援护自己。
 */
function findCoverGuard(ctx: CombatContext, victim: UnitState): UnitState | undefined {
  const team = victim.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  return team.find(
    (u) =>
      u.alive &&
      u.general.id !== victim.general.id &&
      u.statuses.some((s) => s.type === 'cover')
  );
}

export function applyDamage(
  ctx: CombatContext,
  target: UnitState,
  damage: number,
  source?: UnitState,
  damageType?: DamageType,
  damageSource?: 'basic' | 'skill'
): void {
  // 已阵亡单位不再吃伤害、不再走急救（阻止伤兵池膨胀后被救回）
  if (!target.alive) return;
  // 援护代受：被援护者的普攻转由援护者承接（战报记 cover 事件，原目标本次不受伤害）。
  // 嵌套结算（反击/引爆）不再次转移，避免与 ctx.resolvingHurtHooks 下的二次 applyDamage 打架。
  if (damageSource === 'basic' && !ctx.resolvingHurtHooks) {
    const guard = findCoverGuard(ctx, target);
    if (guard) {
      const coverStatus = guard.statuses.find((s) => s.type === 'cover');
      ctx.events.push({
        type: 'cover',
        unitId: guard.general.id,
        targetId: target.general.id,
        skillId:
          coverStatus && 'sourceSkillId' in coverStatus ? coverStatus.sourceSkillId : undefined,
      });
      target = guard;
    }
  }
  /** 本段 thisHitReduce 合计（缺省 0）；嵌套 applyDamage 跳过 before/after */
  let reduceRate = 0;
  if (!ctx.resolvingHurtHooks) {
    const before = triggerOnHurt(ctx, target, source, damageType, damageSource, 'before_damage');
    if (before.evasionBlocked) return;
    reduceRate = before.thisHitReduce;
  }
  const incoming = Math.round(Math.max(0, damage) * (1 - reduceRate));
  const actual = Math.min(incoming, target.troops);
  target.troops -= actual;
  if (target.troops <= 0) target.troops = 0;
  const lethal = target.troops <= 0;
  // 伤兵死亡机制：损失按「当回合死亡率」即时拆分为死亡（永久损失，不可恢复）与伤兵（入池，可恢复）。
  // 死亡按受伤量结算，治疗不冲减死亡（避免高恢复队伍在战场上太过逆天）。
  // 配置了机制即入池（base=0 时全部为伤兵）；未配置（直接构造 ctx）不启用。
  // 按实际扣减量拆分（溢出伤害不入池），避免致死溢出把伤兵池撑爆后再被急救拉回。
  if (ctx.woundedMortality && actual > 0) {
    const rate = mortalityRate(ctx, ctx.currentRound);
    const dead = Math.round((actual * rate) / 100);
    const wounded = actual - dead;
    if (wounded > 0) target.wounded += wounded;
    target.totalDead += dead;
  }
  if (actual > 0) {
    const hit: DamageHitContext = { damageSource, damageType };
    // 全队累计伤害门槛（徽言龙凤）：本侧造成伤害即计数，达到门槛激活光环
    if (source) noteTeamDamage(ctx, source);
    consumeTakenCharges(target, hit);
    decayFifthsOnHit(ctx, target, hit);
    // 奉令护蜀：受到实际伤害后清空待发层数（本次减伤已被 sumReduce 计入）
    consumePendingStacks(ctx, target);
    if (source && damageType === 'physical') {
      for (const id of source.general.passiveSkillIds) {
        const skill = resolveSkill(ctx, id);
        if (skill?.type === 'passive' && skill.selfPhysBoost?.onDealPhysical) {
          applySelfPhysBoost(ctx, source, skill);
        }
      }
    }
  }
  // 受击引燃（火势风威）：受到伤害时额外引发一次燃烧（触发后移除标记）
  triggerIgniteOnHurt(ctx, target);
  // 受击触发妖术（破凰「条件妖术」）：受到伤害时额外引发一次妖术伤害（charges 次用尽移除）
  triggerSorceryMarkOnHurt(ctx, target);
  // 持续型急救：仅非致死（扣兵后仍有兵力）可触发；兵力归零立即阵亡，不得复活
  if (!lethal && target.alive && target.troops > 0) {
    triggerFirstAidOnHurt(ctx, target);
  }
  // 受击触发战法（盲侯/陷储/同仇/缓师）：在阵亡标记前判定，致死一击仍可反击
  if (actual > 0) triggerOnHurt(ctx, target, source, damageType, damageSource);
  // 反击：after_damage 已清 resolvingHurtHooks，必须再包一层，避免反击段重入 before/after/counter
  if (
    !ctx.resolvingHurtHooks &&
    actual > 0 &&
    damageSource === 'basic' &&
    source &&
    source.alive &&
    source !== target
  ) {
    ctx.resolvingHurtHooks = true;
    try {
      settleCounterOnHurt(ctx, target, source);
    } finally {
      ctx.resolvingHurtHooks = false;
    }
  }
  // 忠克猛烈：目标每受到 1 次攻击伤害 → 标记施法者追加 1 次攻击（最多 2 次）。
  // 同样包一层 resolvingHurtHooks：追加攻击段不再触发受击/反击/引燃等二次钩子（防循环）
  if (!ctx.resolvingHurtHooks && actual > 0 && damageType === 'physical') {
    ctx.resolvingHurtHooks = true;
    try {
      settleRetaliateOnHurt(ctx, target);
    } finally {
      ctx.resolvingHurtHooks = false;
    }
  }
  if (target.troops <= 0 && target.alive) {
    target.alive = false;
    ctx.events.push({
      type: 'unit_dead',
      unitId: target.general.id,
      name: target.general.name,
      side: target.side,
    });
  }
}

/**
 * 忠克猛烈：携带者每受到 1 次**攻击伤害**（普攻 / 攻击战法 / 反击均可），由标记施法者对其追加 1 次攻击
 * （伤害率 rate，无视兵种相克与目标防御 —— 与该战法主动段同口径），每个标记最多 maxTriggers 次。
 */
function settleRetaliateOnHurt(ctx: CombatContext, target: UnitState): void {
  const marks = target.statuses.filter(
    (s): s is Extract<Status, { type: 'retaliate' }> => s.type === 'retaliate',
  );
  for (const mark of marks) {
    if (!target.alive) return;
    const caster = castUnit(ctx, mark.sourceUnitId);
    const skill = resolveSkill(ctx, mark.sourceSkillId);
    if (!caster || !caster.alive || !skill) continue;
    executeSkillOutputs(ctx, caster, skill, [target], [
      { kind: 'physical_damage', rate: mark.rate, ignoresTroopCounter: true, ignoresDefense: true },
    ]);
    mark.triggers += 1;
    if (mark.triggers >= mark.maxTriggers) {
      target.statuses = target.statuses.filter((s) => s !== mark);
    }
  }
}

/**
 * 忠克猛烈：施法者下一次行动开始时，清除其施加的「受击追加攻击」标记（官方「直到陈到下回合行动前」）。
 * 标记挂在目标身上，故不能走目标的 tickStatusesOnActStart，需要在**施法者**行动时全局清扫。
 */
function expireRetaliateOnCasterAct(ctx: CombatContext, actor: UnitState): void {
  for (const u of [...ctx.myTeam, ...ctx.enemyTeam]) {
    u.statuses = u.statuses.filter(
      (s) =>
        !(
          s.type === 'retaliate' &&
          s.sourceUnitId === actor.general.id &&
          s.appliedRound < ctx.currentRound
        ),
    );
  }
}
