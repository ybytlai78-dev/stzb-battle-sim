/**
 * 宝物系统 · 引擎侧（率土之滨）
 *
 * 口径（用户 2026-09-21 确认，见 `dateyuan/宝物系统方案.md` §0）：
 *  1. 宝物效果**与任何来源都不冲突**，纯提升、可叠加 → 施加时跳过 `inflictStatus` 的冲突判定；
 *  2. 默认 10 级：一阶/二阶特效 = 官方数值 × 5（官方数值即「每次强化增量」），三阶固定；
 *  3. 锻造词条由玩家选具体数值（官方区间内任意值）。
 *
 * 本文件是「词条名 → 引擎机制」的映射表（`MECHANICS`），数据来自 `src/data/treasures.ts`。
 * 未实现的词条集中在 `PENDING`（分档见方案 §3.2），随 P3 逐批补齐。
 */
import type { CreateStatus, General, SkillType, StatusType, TreasureLoadout, UnitState } from './types';
import type { CombatContext } from './action';
import {
  AFFIXES,
  TREASURES_BY_ID,
  treasureEffectScale,
  treasureEffectValue,
  type TreasureEffectDef,
} from '../data/treasures';
import { TREASURE_SOURCE_PREFIX } from './treasure-source';
import { inflictStatus } from './action';

export { TREASURE_SOURCE_PREFIX, isTreasureSource } from './treasure-source';
/** 宝物状态登记的 `sourceSkillType`（常驻、不可被驱散类判定命中） */
export const TREASURE_SOURCE_TYPE: SkillType = 'passive';

/** 持续至战斗结束 */
const FOREVER = 999;

/** 四类控制（宝物「安贞」= 控制状态下受伤害降低） */
const CONTROL_TYPES: StatusType[] = ['confusion', 'rampage', 'cowardice', 'hesitation'];

/** 构造期上下文：携带者 / 同侧友军 / 按阶缩放（= 强化次数） */
export interface TreasureBuildCtx {
  self: General;
  allies: UnitState[];
  /** 把「官方单次数值」换算成当前等级下的数值（slot1/2 = ×强化次数，slot3 = ×1） */
  scale: (raw: number) => number;
}

/** 单个词条 → 状态模板（value 已按等级/自选数值算好） */
type Mechanic = (value: number, effect: TreasureEffectDef, ctx: TreasureBuildCtx) => CreateStatus[];

/** 攻击/防御/谋略/速度：数值型属性提升 */
const attr = (type: 'attack_buff' | 'defense_buff' | 'strategy_buff' | 'speed_buff', percent = false) =>
  (v: number): CreateStatus[] => [{ type, amount: v, ...(percent ? { percent: true } : {}), duration: FOREVER } as CreateStatus];

/** 造成伤害提高（可按 来源/战法类型/伤害类型/DoT 类型 限定） */
const boost = (
  filter: Partial<{
    damageSource: 'basic' | 'skill';
    skillTypes: SkillType[];
    damageType: 'physical' | 'strategy';
    dotTypes: ('sorcery' | 'burning' | 'panic' | 'curse' | 'ignite')[];
  }>,
  duration = FOREVER,
) =>
  (v: number): CreateStatus[] => [{ type: 'damage_boost', rate: v / 100, direction: 'caused', duration, ...filter } as CreateStatus];

/** 受到伤害降低（同上过滤维） */
const reduce = (
  filter: Partial<{
    damageSource: 'basic' | 'skill';
    skillTypes: SkillType[];
    damageType: 'physical' | 'strategy';
  }>,
  duration = FOREVER,
) =>
  (v: number): CreateStatus[] => [{ type: 'damage_reduce', rate: v / 100, duration, ...filter } as CreateStatus];

/**
 * 「词条名 → 机制」。键 = 官方词条名（同名在不同宝物上语义一致的走这里；
 * 语义随宝物变化的（如 英才 的属性对、亢厉 的战法类型）走 `OVERRIDES`）。
 */
const MECHANICS: Record<string, Mechanic> = {
  // ── 属性 ──
  骁锐: attr('attack_buff'),
  天资: attr('strategy_buff'),
  稳固: attr('defense_buff'),
  灵动: attr('speed_buff'),

  // ── 减伤 ──
  坚忍: reduce({ skillTypes: ['active'] }), // 受到的主动战法伤害降低
  强韧: reduce({ damageSource: 'basic' }), // 受到的普通攻击伤害降低
  沉稳: reduce({ skillTypes: ['command'] }), // 受到的指挥战法伤害降低
  不移: reduce({ damageType: 'physical' }), // 受攻击伤害降低
  先知: reduce({ damageType: 'strategy' }), // 受策略伤害降低
  戒备: (v) => reduce({}, 2)(v), // 前 2 回合受到的所有伤害降低
  // 安贞：控制状态下受伤害降低（混乱/暴走/怯战/犹豫任一）
  安贞: (v) => [
    { type: 'damage_reduce', rate: v / 100, duration: FOREVER, requireSelfStatus: CONTROL_TYPES } as CreateStatus,
  ],
  // 强固：正式回合后，每回合首次受到的伤害降低 20%（TODO：需「每回合首次」标记，暂列 PENDING）
  // 明镜：谋略属性提高 + 初始统率 < 3 的武将额外防御（泰阿）
  明镜: (v, effect, ctx) => [
    { type: 'strategy_buff', amount: ctx.scale(effect.numbers[0] ?? v), duration: FOREVER } as CreateStatus,
    ...(ctx.self.cost < 3
      ? [{ type: 'defense_buff', amount: ctx.scale(effect.numbers[2] ?? 0), duration: FOREVER } as CreateStatus]
      : []),
  ],
  // 护主：战斗开始后前 N 回合援护我军大营（cover 挂在携带者身上，protectId = 大营）
  护主: (_v, effect, ctx) => {
    const back = ctx.allies.find((a) => a.general.position === '大营');
    if (!back) return [];
    return [{ type: 'cover', duration: effect.numbers[0] ?? 2, protectId: back.general.id } as CreateStatus];
  },

  // ── 增伤 ──
  陷阵: boost({ damageSource: 'basic' }), // 普通攻击伤害提高
  无畏: boost({ skillTypes: ['pursuit'] }), // 追击战法伤害提高
  至策: boost({ skillTypes: ['active'] }), // 主动战法伤害提高
  妙算: boost({ skillTypes: ['active'], damageType: 'strategy' }), // 主动战法的策略伤害提高
  勇猛: boost({ damageType: 'physical' }), // 造成的攻击伤害提高
  睚眦: boost({ dotTypes: ['panic', 'sorcery', 'burning', 'ignite'] }), // 恐慌/妖术/燃烧/火攻
  // 迅猛：处于连击状态时，普通攻击伤害提高（条件增伤：携带者自身带 combo）
  迅猛: (v) => [
    { type: 'damage_boost', rate: v / 100, direction: 'caused', duration: FOREVER, damageSource: 'basic', requireSelfStatus: 'combo' } as CreateStatus,
  ],
  炎势: boost({ dotTypes: ['burning', 'ignite'] }), // 火攻、燃烧
  驱火: boost({ dotTypes: ['burning', 'ignite'] }), // 燃烧及火攻（锻造词条）
  炫惑: boost({ dotTypes: ['panic', 'sorcery'] }), // 恐慌及妖术（锻造词条）
  盛气: (v) => boost({ damageType: 'physical' }, 2)(v), // 前 2 回合造成的攻击伤害提高
  机先: (v) => [
    { type: 'damage_boost', rate: v / 100, direction: 'caused', duration: FOREVER, damageType: 'strategy', charges: 2 } as CreateStatus,
  ], // 前 2 次造成的策略伤害提高
  宿胜: boost({}), // 占位（不存在，保持表结构可读性）
  逐胜: boost({}), // TODO(B 档)：需「目标兵力最低」条件，暂按全域增伤

  // ── 无视防御 / 谋略 ──
  破敌: (v) => [{ type: 'ignore_def', rate: v / 100, duration: FOREVER, damageType: 'physical' } as CreateStatus],
  颖悟: (v) => [{ type: 'ignore_def', rate: v / 100, duration: FOREVER, damageType: 'strategy' } as CreateStatus],

  // ── 距离 ──
  穿杨: () => [{ type: 'range_buff', amount: 1, duration: FOREVER } as CreateStatus],
  豪纵: () => [{ type: 'skill_range_buff', amount: 1, duration: FOREVER } as CreateStatus],

  // ── 恢复 ──
  抖擞: (v) => [{ type: 'heal_boost', rate: v / 100, duration: FOREVER } as CreateStatus],

  // ── 发动率（锻造词条）──
  机敏: (v) => [{ type: 'trigger_boost', rate: v / 100, duration: FOREVER, mainSkillOnly: true } as CreateStatus],
  英勇: (v) => [{ type: 'trigger_boost', rate: v / 100, duration: FOREVER, mainSkillOnly: true, attackSkillsOnly: true } as CreateStatus],
  奔袭: (v) => [{ type: 'trigger_boost', rate: v / 100, duration: FOREVER, skillTypes: ['pursuit'] } as CreateStatus],

  // ── 控制相关 ──
  // 惑言（锻造词条）：主战法施加的前 N 个控制 +1 回合
  惑言: (v) => [{ type: 'control_extend', charges: v, duration: FOREVER, mainSkillOnly: true } as CreateStatus],
  // 慑心（龙鳞）：追击武将主战法施加的控制 +1 回合（不限次数）
  慑心: () => [{ type: 'control_extend', charges: 999, duration: FOREVER, mainSkillOnly: true, skillTypes: ['pursuit'] } as CreateStatus],
  // 坚毅（锻造词条）：前 N 回合免疫混乱及暴走
  坚毅: (v) => [{ type: 'control_immune', types: ['confusion', 'rampage'], duration: v } as CreateStatus],
  // 强击（锻造词条）：前 N 回合普通攻击不会触发反击
  强击: (v) => [{ type: 'no_retaliate', duration: v } as CreateStatus],
  // 不屈（锻造词条）：每次受伤后本回合受到伤害降低（可叠加；本回合语义 → 回合开始清零，上限 10 层）
  不屈: (v) => [{ type: 'hurt_stack', mode: 'reduce', perStack: v / 100, maxStacks: 10, duration: FOREVER } as CreateStatus],
  // 破浪（沧海）：每受到 1 次伤害，本回合造成所有伤害提升 10%（最多 10 层）
  破浪: () => [{ type: 'hurt_stack', mode: 'boost', perStack: 0.1, maxStacks: 10, duration: FOREVER } as CreateStatus],
  // 避险（大橹）：战斗中首次受到伤害后进入规避，免疫下 1 次伤害
  避险: () => [{ type: 'hurt_evade_once', duration: FOREVER } as CreateStatus],
};

/** 同名词条但语义随宝物变化：key = `${treasureId}:${slot}` */
const OVERRIDES: Record<string, Mechanic> = {
  // 英才：属性对随宝物不同（攻+防 / 谋+速 / 攻+谋），点/百分比也随官方文案
  '1027:3': (v) => [...attr('strategy_buff', true)(v), ...attr('speed_buff', true)(v)], // 别鸣：谋略、速度提高 5.0%
  '1018:3': (v) => [...attr('attack_buff', true)(v), ...attr('defense_buff', true)(v)], // 惊鲵：攻击、防御提高 6.0%
  '1030:2': (v) => [...attr('attack_buff')(v), ...attr('strategy_buff')(v)], // 铭鸿：攻击、谋略提高 1.5
  '1033:3': (v) => [...attr('attack_buff')(v), ...attr('strategy_buff')(v), ...attr('speed_buff')(v)], // 锟铻：攻击、谋略、速度提高 8.0
  '1057:3': (v) => [...attr('attack_buff', true)(v), ...attr('strategy_buff', true)(v)], // 徐氏匕首：攻击、谋略提高 5.0%
  '1105:2': (v) => [...attr('attack_buff')(v), ...attr('strategy_buff')(v)], // 神锋：攻击、谋略提高 1.5
  // 亢厉：战法类型随宝物不同
  '1042:2': boost({ skillTypes: ['active'] }), // 旌阳万仞：主动战法伤害提高
  '1063:2': boost({ skillTypes: ['active'] }), // 掩日：主动武将主战法伤害提高
  '1036:3': boost({ skillTypes: ['active'], damageType: 'physical' }), // 悬翦：主动战法的攻击伤害提高
  // 陷阵：少府为「前 4 回合普通攻击伤害提高」
  '1060:2': (v) => boost({ damageSource: 'basic' }, 4)(v),
  // 天资：仁风为「谋略属性提高 8.0%」（百分比）
  '1054:3': attr('strategy_buff', true),
};

/** 尚未落地的词条（分档见方案 §3.2）；键 = 词条名，值 = 需要的机制 */
export const PENDING: Record<string, string> = {
  强固: '每回合首次受伤减伤（回合窗口）',
  迸发: '首次追击额外选 1 个目标',
  劲弩: '首回合禁普攻 + 次回合全体普攻',
  谋断: '第 2 次准备战法跳过 1 个准备回合',
  阵舞: '女性携带：控制目标受伤害提高（对目标 debuff）',
  矜节: '女性携带：主战法恢复效果提高',
  燮理: '燃烧伤害后恢复（恢复率）',
  归心: '我军每 2 次主动战法 → 自身恢复',
  破障: '普攻后移除目标 1 种增益',
  鸠佑: '主动主战法发动后叠层增伤',
  奇袭: '按距离增伤（条件）',
  机敏_: '—',
  筹算: '策略伤害武将主战法发动率（条件发动率）',
  熟虑: '需准备的主动战法发动率（准备限定）',
  善谋: '第 4/6 回合发动率提高（回合窗口）',
  识破: '前 N 回合战法伤害无视规避',
  济世: '恢复触发 → 目标下次受伤降低',
  仁心: '造成的恢复效果提高',
  蓄锐: '每 2 次普攻后追击增伤（计数叠层）',
  选锋: '普攻后下次策略伤害提高（一次性标记）',
  击虚: '按目标身上的 DoT/控制种类数增伤（C 档）',
  驱火_: '—',
};

/** 取某条特效的机制（先查覆盖表，再查同名表） */
function mechanicFor(treasureId: number, effect: TreasureEffectDef): Mechanic | undefined {
  return OVERRIDES[`${treasureId}:${effect.slot}`] ?? MECHANICS[effect.name];
}

/** 把一件宝物的自带特效 + 锻造词条翻译成待施加的状态列表 */
export function buildTreasureStatuses(
  loadout: TreasureLoadout,
  self: General,
  allies: UnitState[] = [],
): { create: CreateStatus; sourceId: string; label: string }[] {
  const treasure = TREASURES_BY_ID[loadout.treasureId];
  if (!treasure) return [];
  const level = loadout.level ?? 10;
  const out: { create: CreateStatus; sourceId: string; label: string }[] = [];

  for (const effect of treasure.effects) {
    const fn = mechanicFor(treasure.id, effect);
    if (!fn) continue; // 未实现（见 PENDING）
    const value = treasureEffectValue(effect, level);
    // 一阶/二阶在尚未强化时为 0（如二阶刚在 5 级解锁）→ 不产出空状态；三阶固定值始终产出
    if (effect.slot !== 3 && value === 0) continue;
    const ctx: TreasureBuildCtx = { self, allies, scale: (raw) => raw * treasureEffectScale(effect, level) };
    for (const create of fn(value, effect, ctx)) {
      out.push({ create, sourceId: `${TREASURE_SOURCE_PREFIX}${treasure.id}:${effect.slot}`, label: effect.name });
    }
  }

  if (loadout.affix) {
    const affix = AFFIXES[loadout.affix.name];
    const fn = affix ? (OVERRIDES[`affix:${affix.name}`] ?? MECHANICS[affix.name]) : undefined;
    if (affix && fn) {
      const ctx: TreasureBuildCtx = { self, allies, scale: (raw) => raw };
      const synthetic: TreasureEffectDef = {
        slot: 3,
        name: affix.name,
        desc: affix.desc,
        value: loadout.affix.value,
        unit: affix.unit === 'percent' ? 'percent' : 'point',
        numbers: [],
      };
      for (const create of fn(loadout.affix.value, synthetic, ctx)) {
        out.push({ create, sourceId: `${TREASURE_SOURCE_PREFIX}affix:${affix.name}`, label: affix.name });
      }
    }
  }
  return out;
}

/**
 * 准备阶段结算该武将佩戴宝物的全部效果（`combat.ts` 的 `prep_phase: 'treasure'` 调用）。
 * 语义：宝物效果与任何来源都不冲突、纯提升可叠加（`action.ts` 按来源前缀跳过冲突判定）。
 */
export function applyTreasureEffects(ctx: CombatContext, unit: UnitState): void {
  const loadout = unit.general.treasure;
  if (!loadout) return;
  const allies = unit.side === 'my' ? ctx.myTeam : ctx.enemyTeam;
  for (const { create, sourceId } of buildTreasureStatuses(loadout, unit.general, allies)) {
    inflictStatus(ctx, unit, create, TREASURE_SOURCE_TYPE, sourceId, unit.general.id);
  }
}

/** 回合开始钩子（每回合由 `combat.ts` 调用）：`value` = 该特效/词条在当前等级下的数值 */
type RoundStartHook = (ctx: CombatContext, unit: UnitState, value: number, sourceId: string) => void;

const ROUND_START_HOOKS: Record<string, RoundStartHook> = {
  // 再战（少府）：第 5 回合有 50% 几率获得连击
  再战: (ctx, unit, _v, sourceId) => {
    if (ctx.currentRound !== 5) return;
    if (!ctx.rng.chance(0.5)) return;
    inflictStatus(ctx, unit, { type: 'combo', duration: 1 }, TREASURE_SOURCE_TYPE, sourceId, unit.general.id);
  },
  // 清毅（锻造词条）：第 N 回合（玩家选值，官方区间 5~8）行动时获得洞察
  清毅: (ctx, unit, value, sourceId) => {
    if (ctx.currentRound !== value) return;
    inflictStatus(ctx, unit, { type: 'insight', duration: 1 }, TREASURE_SOURCE_TYPE, sourceId, unit.general.id);
  },
};

/** 回合开始结算宝物的「回合窗口」类效果（再战 / 清毅） */
export function triggerTreasureRoundStart(ctx: CombatContext): void {
  for (const unit of [...ctx.myTeam, ...ctx.enemyTeam]) {
    if (!unit.alive) continue;
    const loadout = unit.general.treasure;
    if (!loadout) continue;
    const level = loadout.level ?? 10;
    const treasure = TREASURES_BY_ID[loadout.treasureId];
    if (treasure) {
      for (const effect of treasure.effects) {
        const hook = ROUND_START_HOOKS[effect.name];
        if (hook) hook(ctx, unit, treasureEffectValue(effect, level), `${TREASURE_SOURCE_PREFIX}${treasure.id}:${effect.slot}`);
      }
    }
    if (loadout.affix) {
      const hook = ROUND_START_HOOKS[loadout.affix.name];
      if (hook) hook(ctx, unit, loadout.affix.value, `${TREASURE_SOURCE_PREFIX}affix:${loadout.affix.name}`);
    }
  }
}
