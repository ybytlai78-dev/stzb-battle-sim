/**
 * 单武将行动阶段 + 指挥/被动管线（率土标准流程，v0.3）
 *   指挥（准备阶段）→ 被动（回合开始）→ 单回合内：
 *     混乱检查 → 怯战检查 → 准备检查 → 主动战法(逐个) → 普通攻击(连击×N) → 追击战法(逐个)
 */
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  DamageBreakdown,
  DamageModifierSource,
  DamageModifiers,
  DotStoredDamage,
  OnHurtConfig,
  Position,
  Skill,
  SkillOutput,
  SkillType,
  Status,
  StatusType,
  UnitState,
  WoundedMortalityConfig,
} from './types';
import type { Rng } from './rng';
import { calcDamage, applyTroopCap, scaledValue, roundRate, sumRates, buffMult, calcHealAmount, moraleRate, applyIgnoreDef, troopCounterReduce } from './formulas';
import { nearestEnemy, skillTargets, distanceBetween, adjacentUnits, sameSideDistance, POSITION_INDEX } from './target';

/** 兵种克制减伤率（加算进增减伤单一总和）：被克制方攻击克制方 0.3，否则 0 */
function troopCounterReduceOf(source: UnitState, target: UnitState): number {
  return troopCounterReduce(source.general.troopType, target.general.troopType);
}

/** 带发动率属性的战法生效概率 = 基础率 × 施法者士气系数（四舍五入取整到百分位），上限 100% */
function moraleTriggerRate(morale: number, baseRate: number): number {
  return Math.min(1, Math.round(baseRate * moraleRate(morale) * 100) / 100);
}

/**
 * 发动率提升后的基础率（士气封顶前）。
 *  缺省（难知如阴）：基础率 × (1 + rate)，主动/追击都吃。
 *  additive（动如雷震）：基础率 + rate（+100% = +1.0），超过 100% 由 moraleTriggerRate 封顶。
 *  skillTypes 限定战法类型（动如雷震仅追击）；多种 trigger_boost 按施加顺序叠加。
 */
function boostedBaseRate(unit: UnitState, skillType: SkillType, baseRate: number): number {
  let rate = baseRate;
  for (const s of unit.statuses) {
    if (s.type !== 'trigger_boost') continue;
    if (s.skillTypes && s.skillTypes.length > 0 && !s.skillTypes.includes(skillType)) continue;
    if (s.additive) rate += s.rate;
    else rate *= 1 + s.rate;
  }
  return rate;
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
  /** 受击 hook 重入保护：反击/引爆等二次 applyDamage 不再触发 onHurt（防盲侯循环） */
  resolvingHurtHooks?: boolean;
  /**
   * 二类指挥友军行动累计（七步释嫌）：key `${casterId}:${skillId}` → 已发动次数。
   * 可选字段：单元测试直接构造 ctx 时可省略，执行时惰性初始化。
   */
  allyActCounters?: Map<string, number>;
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
      // 尊重战法 targetMode（all=全体 / group=群体2目标），缺省按 group
      const allyMode: 'single' | 'group' | 'all' =
        skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
          ? skill.targetMode
          : 'group';
      targets = skillTargets(ctx, unit, allies, skill.range, allyMode);
    } else if (skill.targetSide === 'enemy') {
      // 对敌指挥（白楼独舞：前 3 回合敌军群体减伤）：按 targetMode 选敌军
      const enemyMode: 'single' | 'group' | 'all' =
        skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
          ? skill.targetMode
          : 'all';
      targets = skillTargets(ctx, unit, enemies, skill.range, enemyMode);
    } else {
      const lockMode: 'single' | 'group' | 'all' =
        skill.roundRepeat?.targetMode ??
        (skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all'
          ? skill.targetMode
          : 'all');
      targets = skillTargets(ctx, unit, enemies, skill.range, lockMode);
    }
    if (targets.length === 0) continue;
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
      const mode: 'single' | 'group' | 'all' =
        skill.delayedOutput.targetMode ?? (skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all' ? skill.targetMode : 'all');
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
      const rrMode: 'single' | 'group' | 'all' =
        skill.roundRepeat!.targetMode === 'single' || skill.roundRepeat!.targetMode === 'group' || skill.roundRepeat!.targetMode === 'all'
          ? skill.roundRepeat!.targetMode
          : 'all';
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

    // 普通一类指挥（无 roundRepeat/delayedOutput/onHurt）：直接执行一次（先驱/避其锋芒/共饮）
    // onHurt 战法准备阶段只登记，output 留到受击时结算（盲侯反击 / 缓师 debuff）
    if (!skill.roundRepeat && !skill.delayedOutput && !skill.onHurt) {
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

/** 一类指挥 delayedOutput：到 atRound 回合自动结算（白衣第3回合打出预先结算伤害） */
export function triggerDelayedOutputs(ctx: CombatContext, round: number): void {
  for (const l of ctx.lockedCommands) {
    const { skill } = l;
    if (skill.phase !== 'prep' || !skill.delayedOutput) continue;
    if (round !== skill.delayedOutput.atRound) continue;
    // 一类指挥施法者阵亡后效果仍存在（retainAfterDeath）或施法者存活
    const caster = ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === l.casterId);
    if (caster && !caster.alive && !skill.retainAfterDeath) continue;
    if (l.storedDamage && l.storedDamage.length > 0) {
      // 用预先结算的伤害直接打出（不重新计算）。
      // 注：持节镇西叠层已在准备阶段结算时触发一次（白衣=友军策略伤害），此处不重复叠层
      for (const d of l.storedDamage) {
        const target = ctx.myTeam.concat(ctx.enemyTeam).find((u) => u.general.id === d.targetId);
        if (!target || !target.alive) continue;
        ctx.events.push({
          type: 'damage',
          sourceId: l.casterId,
          targetId: target.general.id,
          skillId: skill.id,
          skillName: skill.name,
          damageType: 'strategy',
          damage: d.damage,
          breakdown: d.breakdown,
        });
        applyDamage(ctx, target, d.damage, caster);
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
        const mode: 'single' | 'group' | 'all' = skill.targetMode === 'single' || skill.targetMode === 'group' || skill.targetMode === 'all' ? skill.targetMode : 'all';
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
      executeSkillOutputs(ctx, caster, skill, []);

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
        executeSkillOutputs(ctx, caster, skill, [], skill.allyActEvery.output);
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
        const { causedMult, takenMult } = damageBoosts(ctx, source, t);
        const reduce = sumRates(t.statuses, 'damage_reduce') + troopCounterReduceOf(source, t);
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
        modifiers: collectDamageModifiers(ctx, source, t),
      });
      applyDamage(ctx, t, capped, source);
    }
    if (attacked) consumeAttackCharges(ctx, source);
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
    if (out.kind === 'strategy_damage' && out.strategyScaled) {
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
    // 受击触发被动（同仇敌忾）：战斗开始只登记，output 留到受伤时结算
    if (skill.onHurt) {
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
 * 怀德畏威借出手：无存活友军时返回 undefined，调用方跳过该段物理伤害。
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
 * 常驻伤害前叠层（持节镇西）：友军每次造成攻击/策略伤害前 → 对施法者叠攻击/谋略；受到伤害前 → 对受击者叠防御。
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
    // 物理伤害 → 施法者叠攻击；策略伤害 → 施法者叠谋略（只对持有者友军生效）
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

/** 叠 1 层属性 buff（持节镇西）：同来源同类型已达 maxStacks 则不再叠；否则 push 新层（每层各自 1 回合） */
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
  const capExceeded = sameSource.length >= maxStacks;
  const label = type === 'attack_buff' ? '攻击' : type === 'defense_buff' ? '防御' : '谋略';
  ctx.events.push({
    type: 'status_inflicted',
    unitId: unit.general.id,
    statusType: type,
    detail: capExceeded
      ? `${label}已叠加 ${maxStacks} 层（封顶）`
      : `${label} +${amount}（${sameSource.length + 1}/${maxStacks} 层）`,
  });
  if (capExceeded) return;
  const status: Status =
    type === 'attack_buff'
      ? { type: 'attack_buff', amount, remaining: 1, appliedRound: ctx.currentRound, sourceSkillType: 'command', sourceSkillId: eff.skillId }
      : type === 'defense_buff'
        ? { type: 'defense_buff', amount, remaining: 1, appliedRound: ctx.currentRound, sourceSkillType: 'command', sourceSkillId: eff.skillId }
        : { type: 'strategy_buff', amount, remaining: 1, appliedRound: ctx.currentRound, sourceSkillType: 'command', sourceSkillId: eff.skillId };
  unit.statuses.push(status);
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
  dot: { rate: number; sourceStrategy: number }
): DotStoredDamage {
  const { causedMult, takenMult } = damageBoosts(ctx, caster, target);
  const reduce = sumRates(target.statuses, 'damage_reduce') + troopCounterReduceOf(caster, target);
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
    modifiers: collectDamageModifiers(ctx, caster, target),
  };
}

/** 结算一次 DoT/诅咒/引燃伤害：push dot_tick 事件并扣兵。
 *  滞后触发：有挂上时冻结的 stored（引擎施加路径）时直接打出冻结伤害（仅按目标当前兵力截断）；
 *  否则（直接 inflictStatus 且施法者不可解析的单元测试）回退为触发时实时结算：
 *  冻结 rate + sourceStrategy，目标当前生效防御/谋略减免，mult=1 不吃增伤。 */
function dealDotDamage(
  ctx: CombatContext,
  unit: UnitState,
  dot: Extract<Status, { type: 'sorcery' | 'burning' | 'panic' | 'curse' | 'ignite' }>
): void {
  const src = dot.sourceUnitId ? castUnit(ctx, dot.sourceUnitId) : undefined;
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
    applyDamage(ctx, unit, capped, src);
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
  applyDamage(ctx, unit, capped, src);
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
    dealDotDamage(ctx, unit, dot);
    if (!unit.alive) return;
  }
}

/** 分兵攻击：普攻命中后，对目标同队的相邻存活单位造成比例物理伤害（无视攻击距离） */
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
    const { causedMult, takenMult } = damageBoosts(ctx, unit, adjTarget);
    const reduce = sumRates(adjTarget.statuses, 'damage_reduce') + troopCounterReduceOf(unit, adjTarget);
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
      modifiers: collectDamageModifiers(ctx, unit, adjTarget),
    });
    applyDamage(ctx, adjTarget, capped, unit);
  }
}

// ─── 单武将行动 ───

/** 行动中施加的状态（appliedRound>0）：该单位下次行动开始前计数器减一（非消耗型，remaining 到 0 移除）。
 *  仅递减「上一回合或更早施加」的状态（appliedRound < currentRound）——同一回合刚施加的不减（连击等持续到本回合行动结束）。
 *  行动前施加（appliedRound=0）由回合末 tickStatuses 递减，不在此处理。 */
function tickStatusesOnActStart(ctx: CombatContext, unit: UnitState): void {
  for (const s of [...unit.statuses]) {
    if (s.type === 'evasion') continue; // 规避按层数，不递减
    // 次数型下一次攻击：不按回合递减，打出后由 consumeAttackCharges 移除
    if (s.type === 'damage_boost' && 'charges' in s && s.charges != null) continue;
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

  // 行动阶段判定顺序：被动 → 指挥（预备怯战 + 二类） → DoT → 主动 → 普攻 → 追击 → 分兵
  // 混乱：无法发动主动战法 + 普攻；但被动/指挥/DoT仍正常判定

  // 0. 被动战法（武将行动阶段判定）：只触发 round_start 型；
  //    battle_start 型（血溅黄砂/百战精兵等）已在准备阶段由 triggerPassiveSkills 触发一次，此处跳过避免每回合重复叠加
  for (const id of unit.general.passiveSkillIds) {
    const passive = resolveSkill(ctx, id);
    if (passive?.type !== 'passive' || passive.timing !== 'round_start') continue;
    ctx.events.push({
      type: 'unit_act_start',
      unitId: unit.general.id,
      name: unit.general.name,
      position: unit.general.position,
      phase: 'passive_skill',
    });
    executeSkillWithTargets(ctx, unit, passive, enemies, allies, mixedPool(ctx, unit));
  }

  // 1. 指挥预备负面效果判定（战必/措手/白衣，目标行动时）
  triggerPreparedEffectOnAct(ctx, unit);

  // 2. 二类指挥判定（奇兵拒北，行动时）
  triggerRoundCommandOnAct(ctx, unit);

  // 2.5 休整：每回合行动时按挂上时冻结值恢复（指挥预备判定之后、DoT 之前）
  tickRests(ctx, unit);

  // 3. DoT 结算（妖术/燃烧/恐慌：行动时受到伤害）
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
  //  - 上回合准备好的战法：本回合主动战法阶段自动释放（不做发动率判定、不受犹豫影响）；
  //    释放后本回合不再进行其他主动战法判定（极端情况 8 回合最多释放 4 次：
  //    第 1/3/5/7 回合判定成功进入准备 → 第 2/4/6/8 回合释放）
  //  - 无准备战法：逐槽判定主动战法（含准备战法的发动率判定，判定成功即进入准备，本回合不再判定其他主动）
  const canCastActive = !hasStatus(unit, 'hesitation');
  if (unit.isPreparing && unit.preparingSkillId) {
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
  const type = create.type;

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
      });
    }
    pushStatus(ctx, target, create, sourceSkillType, sourceSkillId, casterId, stored);
    return;
  }

  // 增减伤方向：damage_boost 按方向匹配（造成侧与受到侧各自独立，不互相冲突/累加）
  const boostDir = type === 'damage_boost' ? (create.type === 'damage_boost' ? (create.direction ?? 'taken') : undefined) : undefined;

  // 同一战法此前施加过的同名效果（damage_boost 需同方向；first_aid 已在顶部特判，此处排除以收窄类型）
  const sameSource = target.statuses.find(
    (s) =>
      s.type !== 'first_aid' &&
      s.type !== 'rest' &&
      s.type === type &&
      s.sourceSkillType === sourceSkillType &&
      s.sourceSkillId === sourceSkillId &&
      (boostDir === undefined || !('direction' in s) || s.direction === boostDir)
  );
  // 同战法类型、不同战法施加的同名效果（damage_boost 需同方向）
  const sameType = target.statuses.find(
    (s) =>
      s.type !== 'first_aid' &&
      s.type !== 'rest' &&
      s.type === type &&
      s.sourceSkillType === sourceSkillType &&
      s.sourceSkillId !== sourceSkillId &&
      (boostDir === undefined || !('direction' in s) || s.direction === boostDir)
  );
  // 不同战法类型施加的同名效果
  const diffType = target.statuses.find((s) => s.type !== 'first_aid' && s.type !== 'rest' && s.type === type && s.sourceSkillType !== sourceSkillType);

  if (sameSource) {
    // 次数型下一次增减伤 / 待生效暴走：已有则不刷新，避免叠加或永控
    if (type === 'damage_boost' && create.type === 'damage_boost' && create.charges != null && !create.chargesStack) return;
    if (type === 'rampage' && create.type === 'rampage' && create.pendingNextAct) return;
    // 同一战法重复触发：数值类累加，规避加层，控制刷新剩余
    if (sameSource.type === 'evasion') {
      if (create.type === 'evasion') sameSource.stacks += create.stacks;
    } else if (sameSource.type === 'attack_buff' || sameSource.type === 'defense_buff' || sameSource.type === 'strategy_buff' || sameSource.type === 'speed_buff' || sameSource.type === 'damage_reduce' || sameSource.type === 'damage_boost' || sameSource.type === 'trigger_boost' || sameSource.type === 'morale_boost') {
      if ('amount' in sameSource && 'amount' in create) sameSource.amount += create.amount;
      else if ('rate' in sameSource && 'rate' in create) {
        sameSource.rate += create.rate;
        // 叠层计数（银龙冲阵）：带上限的增减伤每层 +1
        if (type === 'damage_boost' && 'stacks' in sameSource) {
          (sameSource as { stacks?: number }).stacks = (sameSource.stacks ?? 1) + ('stacks' in create ? (create.stacks ?? 1) : 1);
        }
      }
      if (create.type !== 'evasion') sameSource.remaining = Math.max(sameSource.remaining, create.duration);
    } else if (create.type !== 'evasion' && 'remaining' in sameSource) {
      sameSource.remaining = Math.max(sameSource.remaining, create.duration);
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
    // 增减伤（damage_boost）：同类型不同战法**同号冲突、数值取较高替换**（用户确认——大赏三军 30% 与
    // 奋疾先登叠层同为指挥增伤互相冲突替换，不叠加）。奋疾先登自身的层数计数与满层触发攻击
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
    const signOf = (v: number) => (v < 0 ? -1 : v > 0 ? 1 : 0);
    if ((isAttrBuff || isBoost) && signOf(incomingVal) !== signOf(curVal)) {
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
        sameType.sourceSkillId = sourceSkillId;
        if (casterId) (sameType as { sourceUnitId?: string }).sourceUnitId = casterId;
      }
    }
    if (sameType.type !== 'evasion' && create.type !== 'evasion' && 'remaining' in sameType) {
      sameType.remaining = Math.max(sameType.remaining, create.duration);
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
  const remaining = type === 'evasion' ? 0 : 'duration' in create ? create.duration : 0;
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
  if (type === 'attack_buff' || type === 'defense_buff' || type === 'strategy_buff' || type === 'speed_buff' || type === 'damage_reduce' || type === 'damage_boost' || type === 'trigger_boost' || type === 'morale_boost' || type === 'ignore_def') {
    const amount = 'amount' in create ? create.amount : create.rate;
    const push: Status = { type, remaining, appliedRound, sourceSkillType, sourceSkillId } as Status;
    if ('amount' in create) (push as { amount: number }).amount = create.amount;
    else (push as { rate: number }).rate = create.rate;
    // 百分比属性增减（魏武之世 -15%）：标记 percent，结算按目标当前生效属性
    if ('amount' in create && 'percent' in create && create.percent) (push as { percent?: boolean }).percent = true;
    // 增减伤方向（damage_boost 才有）：缺省 'taken'（受到侧）
    if (type === 'damage_boost') (push as { direction: 'caused' | 'taken' }).direction = create.direction ?? 'taken';
    // 叠层计数（带上限的增减伤，银龙冲阵最多 3 层）：首层记 1，同战法累加时 +1
    if (type === 'damage_boost' && 'stacks' in create) (push as { stacks?: number }).stacks = create.stacks ?? 1;
    if (type === 'damage_boost' && 'charges' in create && create.charges != null) {
      (push as { charges?: number }).charges = create.charges;
    }
    // 谋议宏图减伤按 8/8 衰减：冻结满额减伤率为 baseRate
    if (type === 'damage_reduce' && 'decayEighths' in create && create.decayEighths) {
      (push as { eighths?: number }).eighths = create.decayEighths;
      (push as { baseRate?: number }).baseRate = create.rate;
    }
    // 属性/增减伤/发动率类状态记录施法者（战报归因用）：神兵天降/大赏三军/减伤/奋疾先登降速等
    if (casterId) {
      (push as { sourceUnitId?: string }).sourceUnitId = casterId;
    }
    if (type === 'trigger_boost' && 'skillTypes' in create && create.skillTypes) {
      (push as { skillTypes?: SkillType[] }).skillTypes = create.skillTypes;
    }
    if (type === 'trigger_boost' && 'additive' in create && create.additive) {
      (push as { additive?: boolean }).additive = true;
    }
    target.statuses.push(push);
    // 战报 detail：duration ≥ 999（战斗结束约定）→「持续至战斗结束」；
    // damage_boost 用百分数 + 语义化（0.08 → 「造成的伤害提高8%」；≤ -90% → 「造成的伤害大幅降低」）
    const durText = create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`;
    let detail: string;
    if (type === 'damage_boost') {
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
    target.statuses.push(status);
    ctx.events.push({
      type: 'status_inflicted',
      unitId: target.general.id,
      statusType: type,
      detail: `${statusName(type)} ${Math.round(create.rate)}% ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
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
    target.statuses.push({
      type: 'split',
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
      detail: `${statusName(type)} ${Math.round(create.rate)}% ${create.duration >= 999 ? '持续至战斗结束' : `持续 ${create.duration} 回合`}`,
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
    detail: `${statusName(type)} ${create.duration} 回合`,
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
      if (s.type === 'rest') continue; // 休整 remaining 只在跳恢复时递减
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
 * 回合前准备阶段（谋议宏图）：`round_start` 之后、单位行动之前。
 * 1. 带 `eighths` 的减伤衰减 1/8（≤0 则移除）
 * 2. 一类指挥 `roundStartRepeat` 对锁定目标再结算（士气叠层，同战法累加）
 */
export function tickRoundStartStatuses(ctx: CombatContext): void {
  const units = [...ctx.myTeam, ...ctx.enemyTeam];
  for (const unit of units) {
    if (!unit.alive) continue;
    for (const s of [...unit.statuses]) {
      if (s.type !== 'damage_reduce' || s.eighths === undefined || s.baseRate === undefined) continue;
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
      ctx.events.push({
        type: 'status_inflicted',
        unitId: unit.general.id,
        statusType: 'damage_reduce',
        detail: `${statusName('damage_reduce')} ${s.rate} 剩余 ${s.eighths}/8 ${durText}`,
      });
    }
  }

  for (const locked of ctx.lockedCommands) {
    const skill = locked.skill;
    if (!skill.roundStartRepeat) continue;
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

/** 规避：消耗 1 层免疫该次伤害 */
export function consumeEvasion(ctx: CombatContext, target: UnitState, sourceId: string): boolean {
  const ev = getStatus(target, 'evasion');
  if (!ev) return false;
  ev.stacks -= 1;
  ctx.events.push({
    type: 'evasion_blocked',
    unitId: target.general.id,
    sourceId,
    remainingStacks: ev.stacks,
  });
  return true;
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
 * 物理伤害用的目标防御：先生效属性，再按攻击方 ignore_def 比例折减。
 * 攻防差 = 攻击 − 目标防御 × (1 − 无视比例)。
 */
function physicalTargetDefense(attacker: UnitState, target: UnitState): number {
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

/** 造成伤害减伤因子：目标上的 damage_reduce 状态（率土中减伤为伤害降低） */
/**
 * 增减伤倍率（神兵天降/大赏三军/血溅黄砂）：伤害方的「造成伤害提高」与受击方的「受到伤害提高」，
 * 分别由各自 statuses 上对应方向（caused/taken）的 damage_boost 状态数值相加，无效果时为 1。
 * 造成侧增伤（血溅黄砂等）不会放大自身受到的伤害。
 * 消费方：buffMult 按「单一总和」模型把两侧增伤与受击方减伤（damage_reduce）求和后 clamp 下限 10%。
 */
function damageBoosts(
  ctx: CombatContext,
  source: UnitState,
  target: UnitState
): { causedMult: number; takenMult: number } {
  const causedBoost = sumRates(source.statuses, 'damage_boost', 'caused');
  const takenBoost = sumRates(target.statuses, 'damage_boost', 'taken');
  return { causedMult: 1 + causedBoost, takenMult: 1 + takenBoost };
}

/**
 * 收集单次伤害的增减伤来源（战报「增减伤统计」归因用）：
 *  造成侧（大赏三军：攻击方自身造成伤害提高）→ caused；
 *  受到侧（神兵天降：受击方受到伤害提高）→ taken；
 *  减伤（步步为营等受击方 damage_reduce + 兵种克制）→ reduce。
 *  includeBoosts=false：DoT 实时回退路径（挂上时结算不可用的单元测试场景）
 *  不携带增减伤提升（mult=1），只带减伤来源；引擎路径的 DoT 在挂上时结算，
 *  增伤/减伤来源均已在 computeDotTickDamage 冻结。
 */
function collectDamageModifiers(
  ctx: CombatContext,
  source: UnitState,
  target: UnitState,
  includeBoosts = true
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
        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'caused')
        .map((s) => toSrc(s, 'caused'))
    : [];
  const taken = includeBoosts
    ? target.statuses
        .filter((s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.direction === 'taken')
        .map((s) => toSrc(s, 'taken'))
    : [];
  const reduce = target.statuses
    .filter((s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce')
    .map((s) => toSrc(s, 'reduce'));
  const cr = troopCounterReduceOf(source, target);
  if (cr > 0) {
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
    case 'combo': return '连击';
    case 'attack_buff': return '攻击增益';
    case 'defense_buff': return '防御增益';
    case 'strategy_buff': return '谋略增益';
    case 'speed_buff': return '速度增益';
    case 'damage_reduce': return '减伤';
    case 'damage_boost': return '增伤';
    case 'trigger_boost': return '发动率提升';
    case 'insight': return '洞察';
    case 'siege': return '围困';
    case 'sorcery': return '妖术';
    case 'burning': return '燃烧';
    case 'panic': return '恐慌';
    case 'curse': return '妖术诅咒';
    case 'ignite': return '引燃';
    case 'split': return '分兵';
    case 'jump_prep': return '跳过准备';
    case 'taunt': return '挑衅';
    case 'cover': return '援護';
    case 'first_aid': return '持续型急救';
    case 'rest': return '休整';
    case 'morale_boost': return '士气提高';
    case 'ignore_def': return '无视防御';
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
 * 将本次物理伤害的结算目标改为承担者（防御/规避/兵力/受击均视其为受击者）。
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

/** 次数型「下一次攻击」：一次 physical/strategy/positional 输出或一次普攻消耗 1 次（不按目标数） */
function consumeAttackCharges(ctx: CombatContext, attacker: UnitState): void {
  for (const s of [...attacker.statuses]) {
    if (s.type !== 'damage_boost' || s.charges == null) continue;
    s.charges -= 1;
    if (s.charges <= 0) attacker.statuses = attacker.statuses.filter((x) => x !== s);
  }
}

function executeSkillOutputs(
  ctx: CombatContext,
  caster: UnitState,
  skill: Skill,
  targets: UnitState[],
  outputs?: SkillOutput[]
): void {
  const list = outputs ?? skill.output;
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
    // 被动输出级独立发动率（击势两效果各 65%）：士气修正后判定，失败则跳过该段
    if (skill.type === 'passive' && 'chance' in out && out.chance != null) {
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
    const outTarget = out.kind === 'positional_physical_damage' || out.kind === 'morale_branch' ? undefined : out.target;
    const outMode =
      out.kind === 'physical_damage' || out.kind === 'strategy_damage' ? out.targetMode : undefined;
    const outRange =
      out.kind === 'physical_damage' && out.ignoreRange ? Number.POSITIVE_INFINITY : skill.range;
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
              ? skillTargets(ctx, caster, enemies, skill.range, outSideMode ?? 'single')
              : outSide === 'ally'
                ? skillTargets(ctx, caster, allyPool, skill.range, outSideMode ?? 'single')
                : targets;
    // 怀德畏威：混乱只打「友军随机单体攻击 ∩ 自身群体策略」重合目标，不再按战法整体目标重选
    if (out.kind === 'inflict_status' && out.onlyIfOverlapPrevious) {
      const overlap = new Set(lastDamageTargetIds.filter((id) => prevDamageTargetIds.includes(id)));
      pool = ctx.myTeam.concat(ctx.enemyTeam).filter((u) => u.alive && overlap.has(u.general.id));
    }
    switch (out.kind) {
      case 'physical_damage': {
        const source =
          out.attacker === 'lowest_strategy_ally' ? lowestStrategyAlly(allies, caster) : caster;
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
            const def = physicalTargetDefense(source, t);
            const { causedMult, takenMult } = damageBoosts(ctx, source, t);
            const reduce = sumRates(t.statuses, 'damage_reduce') + troopCounterReduceOf(source, t);
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
              modifiers: collectDamageModifiers(ctx, source, t),
            });
            applyDamage(ctx, t, capped, source);
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
        if (attacked) consumeAttackCharges(ctx, source);
        break;
      }
      case 'strategy_damage': {
        const effStrategy = effectiveStat(caster, 'strategy');
        let rate = out.rate;
        if (out.strategyScaled) {
          const scaled = scaledValue(out.rate, out.growthRate, effStrategy);
          rate = roundRate(scaled);
        }
        const selectedIds: string[] = [];
        for (const t of pool) {
          if (!t.alive) continue;
          if (out.requireStatuses?.length && !out.requireStatuses.some((st) => hasStatus(t, st))) continue;
          selectedIds.push(t.general.id);
          // 常驻伤害前叠层（持节镇西）：施法者叠谋略、受击者叠防御
          triggerStackBuff(ctx, caster, t, 'strategy');
          // 规避：默认免疫一次伤害；ignoresEvasion 时无视
          if (!out.ignoresEvasion && consumeEvasion(ctx, t, caster.general.id)) continue;
          const { causedMult, takenMult } = damageBoosts(ctx, caster, t);
          const reduce = sumRates(t.statuses, 'damage_reduce') + troopCounterReduceOf(caster, t);
          const { damage, breakdown } = calcDamage(
            {
              damageType: 'strategy',
              rate,
              attackerAttack: caster.general.attack,
              attackerStrategy: effStrategy,
              attackerTroops: caster.troops,
              targetDefense: t.general.defense,
              targetStrategy: t.general.strategy,
              mult: buffMult(causedMult, takenMult, reduce),
            },
            ctx.rng
          );
          const capped = applyTroopCap(damage, t.troops);
          ctx.events.push({
            type: 'damage',
            sourceId: caster.general.id,
            targetId: t.general.id,
            skillId: skill.id,
            skillName: skill.name,
            damageType: 'strategy',
            damage: capped,
            breakdown,
            modifiers: collectDamageModifiers(ctx, caster, t),
          });
          applyDamage(ctx, t, capped, caster);
        }
        rememberDamageTargets(selectedIds);
        if (pool.some((t) => t.alive)) consumeAttackCharges(ctx, caster);
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
          // 状态数组（奇佐鬼谋随机 1 种控制）：每次对每个目标独立随机选 1 个
          const create = Array.isArray(out.status) ? out.status[ctx.rng.int(out.status.length)] : out.status;
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
        for (const t of pool) {
          if (!t.alive) continue;
          const branch = effectiveMorale(t) > threshold ? out.high : out.low;
          executeSkillOutputs(ctx, caster, skill, [t], branch);
        }
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
  // 发动率提升：乘算（难知如阴）或加算封顶（动如雷震），再乘士气系数
  const base = boostedBaseRate(unit, 'active', skill.triggerRate);
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
  const base = boostedBaseRate(unit, 'pursuit', skill.triggerRate);
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
      reason: `攻击距离 ${unit.general.attackRange} 内无存活敌军`,
    });
    return null;
  }

  const distance = distanceBetween(ctx, unit, target);
  dealAttack(ctx, unit, target, distance);
  // 七步释嫌等：成功发动普通攻击（含规避命中）后触发
  triggerAllyActCommands(ctx, unit);
  return target;
}

/** 计算并结算一次兵刃普攻（含连击的追击加成待做） */
function dealAttack(ctx: CombatContext, unit: UnitState, target: UnitState, distance: number): void {
  const hit = redirectPhysicalHit(ctx, target);
  if (!hit.alive) return;
  // 常驻伤害前叠层（持节镇西）：攻击方叠攻击、受击者叠防御
  triggerStackBuff(ctx, unit, hit, 'physical');
  const atk = effectiveStat(unit, 'attack');
  const def = physicalTargetDefense(unit, hit);
  const { causedMult, takenMult } = damageBoosts(ctx, unit, hit);
  const reduce = sumRates(hit.statuses, 'damage_reduce') + troopCounterReduceOf(unit, hit);
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
    consumeAttackCharges(ctx, unit);
    return;
  }

  ctx.events.push({
    type: 'attack_hit',
    sourceId: unit.general.id,
    targetId: hit.general.id,
    distance,
    damage: capped,
    breakdown,
    modifiers: collectDamageModifiers(ctx, unit, hit),
  });
  applyDamage(ctx, hit, capped, unit);
  consumeAttackCharges(ctx, unit);
}

/** 持续型急救受击触发（皇裔流离/金匮要略）：目标受到伤害后判定。
 *  每个急救状态独立判定一次：按战法级计数器当前触发率 rng 判定，成功则恢复兵力（受围困拦截），
 *  并累计战法级总生效次数——每达到 triggerUpEvery 次，触发率 +triggerUpIncrement（可叠加）。 */
function triggerFirstAidOnHurt(ctx: CombatContext, target: UnitState): void {
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

/** 恢复兵力（heal/持续急救统一入口）：配置了伤兵机制时只能从伤兵池恢复——死亡兵力（totalDead）不可恢复，
 *  实际恢复量 = min(请求量, 伤兵池剩余, 兵力缺口) 且扣减伤兵池；
 *  未配置机制（直接构造 ctx 的单元测试）时保持旧行为：恢复只受兵力上限限制。 */
export function recoverTroops(ctx: CombatContext, target: UnitState, amount: number): number {
  const pool = ctx.woundedMortality ? Math.min(target.wounded, target.general.maxTroops - target.troops) : target.general.maxTroops - target.troops;
  const recoverable = Math.max(0, Math.min(amount, pool));
  if (recoverable > 0) {
    target.troops += recoverable;
    if (ctx.woundedMortality) target.wounded -= recoverable;
  }
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

/** 受击触发（盲侯奋勇/陷储立齐/同仇敌忾/缓师徐持）：扣兵后、阵亡标记前判定。
 *  反击等二次 applyDamage 不再递归（resolvingHurtHooks），避免盲侯循环。 */
function triggerOnHurt(ctx: CombatContext, victim: UnitState, source?: UnitState): void {
  if (ctx.resolvingHurtHooks) return;
  ctx.resolvingHurtHooks = true;
  try {
    const all = ctx.myTeam.concat(ctx.enemyTeam);
    for (const caster of all) {
      const ids = [...caster.general.commandSkillIds, ...caster.general.passiveSkillIds];
      for (const id of ids) {
        const skill = resolveSkill(ctx, id);
        if (!skill || (skill.type !== 'command' && skill.type !== 'passive') || !skill.onHurt) continue;
        const cfg = skill.onHurt;
        if (!caster.alive && !skill.retainAfterDeath) continue;
        if (!matchOnHurtVictim(cfg, caster, victim)) continue;
        if (cfg.onlyIfActed && !victim.hasActedThisRound) continue;
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
        const rolls = cfg.rolls ?? 1;
        for (let i = 0; i < rolls; i++) {
          const rolled = rollOnHurt(ctx, caster, skill, cfg);
          if ((cfg.rate ?? 1) < 1 || cfg.rateStrategyScaled) {
            ctx.events.push({
              type: 'skill_trigger',
              unitId: caster.general.id,
              targetId: victim.general.id,
              skillId: skill.id,
              skillName: skill.name,
              success: rolled.success,
              rate: Math.round(rolled.rate * 100),
              baseRate: Math.round(rolled.baseRate * 100),
              morale: effectiveMorale(caster),
            });
          }
          if (!rolled.success) continue;
          applyOnHurtEffect(ctx, caster, skill, cfg, victim, source);
        }
      }
    }
  } finally {
    ctx.resolvingHurtHooks = false;
  }
}

/** 受击触发：受伤者是否匹配战法 victim 侧 */
function matchOnHurtVictim(cfg: OnHurtConfig, caster: UnitState, victim: UnitState): boolean {
  if (cfg.victim === 'self') return caster.general.id === victim.general.id;
  if (cfg.victim === 'ally') return caster.side === victim.side;
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
    executeSkillOutputs(ctx, caster, skill, targets);
    return;
  }

  if (cfg.applyTo === 'source') {
    if (!source || !source.alive) return;
    executeSkillOutputs(ctx, caster, skill, [source]);
    return;
  }

  if (cfg.applyTo === 'victim') {
    executeSkillOutputs(ctx, caster, skill, [victim]);
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
    executeSkillOutputs(ctx, caster, skill, allies);
  }
}

export function applyDamage(ctx: CombatContext, target: UnitState, damage: number, source?: UnitState): void {
  target.troops -= damage;
  if (target.troops <= 0) target.troops = 0;
  // 伤兵死亡机制：损失按「当回合死亡率」即时拆分为死亡（永久损失，不可恢复）与伤兵（入池，可恢复）。
  // 死亡按受伤量结算，治疗不冲减死亡（避免高恢复队伍在战场上太过逆天）。
  // 配置了机制即入池（base=0 时全部为伤兵）；未配置（直接构造 ctx）不启用。
  if (ctx.woundedMortality && damage > 0) {
    const rate = mortalityRate(ctx, ctx.currentRound);
    const dead = Math.round((damage * rate) / 100);
    const wounded = damage - dead;
    if (wounded > 0) target.wounded += wounded;
    target.totalDead += dead;
  }
  // 受击引燃（火势风威）：受到伤害时额外引发一次燃烧（触发后移除标记）
  triggerIgniteOnHurt(ctx, target);
  // 受到伤害时：持续型急救（皇裔流离/金匮要略）判定——致死伤害也可触发恢复救回
  triggerFirstAidOnHurt(ctx, target);
  // 受击触发战法（盲侯/陷储/同仇/缓师）：在阵亡标记前判定，致死一击仍可反击
  if (damage > 0) triggerOnHurt(ctx, target, source);
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
