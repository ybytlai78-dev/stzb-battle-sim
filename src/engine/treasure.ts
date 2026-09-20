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
import type { CreateStatus, General, SkillType, TreasureLoadout, UnitState } from './types';
import type { CombatContext } from './action';
import {
  AFFIXES,
  TREASURES_BY_ID,
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

/** 单个词条 → 状态模板（value 已按等级/自选数值算好） */
type Mechanic = (value: number, effect: TreasureEffectDef, self: General) => CreateStatus[];

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

  // ── 增伤 ──
  陷阵: boost({ damageSource: 'basic' }), // 普通攻击伤害提高
  无畏: boost({ skillTypes: ['pursuit'] }), // 追击战法伤害提高
  至策: boost({ skillTypes: ['active'] }), // 主动战法伤害提高
  妙算: boost({ skillTypes: ['active'], damageType: 'strategy' }), // 主动战法的策略伤害提高
  勇猛: boost({ damageType: 'physical' }), // 造成的攻击伤害提高
  睚眦: boost({ dotTypes: ['panic', 'sorcery', 'burning', 'ignite'] }), // 恐慌/妖术/燃烧/火攻
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
  明镜: '初始统率 <3 的额外防御（属性条件）',
  安贞: '「控制状态下」条件减伤（多控制类型）',
  护主: '援护我军大营（cover + 指定保护对象）',
  避险: '首次受击后进入规避',
  再战: '第 5 回合几率获得连击（回合钩子）',
  迸发: '首次追击额外选 1 个目标',
  劲弩: '首回合禁普攻 + 次回合全体普攻',
  谋断: '第 2 次准备战法跳过 1 个准备回合',
  慑心: '追击主战法施加的控制 +1 回合',
  阵舞: '女性携带：控制目标受伤害提高（对目标 debuff）',
  矜节: '女性携带：主战法恢复效果提高',
  燮理: '燃烧伤害后恢复（恢复率）',
  归心: '我军每 2 次主动战法 → 自身恢复',
  破浪: '受伤叠层增伤（上限 10 层）',
  破障: '普攻后移除目标 1 种增益',
  鸠佑: '主动主战法发动后叠层增伤',
  迅猛: '连击状态下普攻增伤（条件）',
  奇袭: '按距离增伤（条件）',
  机敏_: '—',
  筹算: '策略伤害武将主战法发动率（条件发动率）',
  熟虑: '需准备的主动战法发动率（准备限定）',
  善谋: '第 4/6 回合发动率提高（回合窗口）',
  坚毅: '前 N 回合免疫混乱/暴走',
  清毅: '第 N~M 回合获得洞察（回合窗口）',
  惑言: '主战法控制 +1 回合',
  识破: '前 N 回合战法伤害无视规避',
  强击: '前 N 回合普攻不触发反击',
  不屈: '受击叠层减伤',
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
): { create: CreateStatus; sourceId: string; label: string }[] {
  const treasure = TREASURES_BY_ID[loadout.treasureId];
  if (!treasure) return [];
  const level = loadout.level ?? 10;
  const out: { create: CreateStatus; sourceId: string; label: string }[] = [];

  for (const effect of treasure.effects) {
    const fn = mechanicFor(treasure.id, effect);
    if (!fn) continue; // 未实现（见 PENDING）
    const value = treasureEffectValue(effect, level);
    if (!value && effect.slot !== 3) continue;
    for (const create of fn(value, effect, self)) {
      out.push({ create, sourceId: `${TREASURE_SOURCE_PREFIX}${treasure.id}:${effect.slot}`, label: effect.name });
    }
  }

  if (loadout.affix) {
    const affix = AFFIXES[loadout.affix.name];
    const fn = affix ? (OVERRIDES[`affix:${affix.name}`] ?? MECHANICS[affix.name]) : undefined;
    if (affix && fn) {
      for (const create of fn(loadout.affix.value, { slot: 3, name: affix.name, desc: affix.desc, value: loadout.affix.value, unit: affix.unit === 'percent' ? 'percent' : 'point', numbers: [] }, self)) {
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
  for (const { create, sourceId } of buildTreasureStatuses(loadout, unit.general)) {
    inflictStatus(ctx, unit, create, TREASURE_SOURCE_TYPE, sourceId, unit.general.id);
  }
}
