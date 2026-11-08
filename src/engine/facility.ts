/**
 * 设施加成（四大营，2026-11-08 用户口径 + 官方设施详情面板原文）。
 *
 * 口径来源：
 *  - 用户 2026-11-08：「准备阶段的兵种加成以前增加一个设施加成……红蓝两边所有武将直接加上的
 *    加成是 20 点四维，这个不写到战报里但直接加成，战报里只描述四大营的特殊效果。」
 *  - 官方设施详情面板：
 *      军机营（提高本城部队的谋略）：战斗开始后首回合，使我军单体进入洞察状态。
 *      尚武营（提高本城部队的攻击）：战斗开始后，使我军单体首次攻击无视相克。
 *      疾风营（提高本城部队的速度）：战斗开始后首回合，使我军全体速度 +10。
 *      铁壁营（提高本城部队的防御）：战斗开始后，使我军单体免疫首次伤害。
 *
 * 数值口径：四级设施每级「部队攻击/防御/谋略/速度 +20」的满级值 → 每名武将四维各 +20
 * （不是「只加对应营的那一项」——四营同时满级、四项同时生效）。20 点直接并入
 * `UnitState.formationBonus`，走 `effectiveStat` 的既有加成通道，**不**进战报。
 *
 * 随机口径（用户明确选择）：单体目标 = 随机 1 名、按战斗种子可复现；不用固定站位、不给全队。
 * **不得消耗主 `ctx.rng`**：否则所有既有战斗的随机序列整体位移，伤害全变、无法归因。
 * 因此单独派生一条 `seed ^ FACILITY_SEED_SALT` 的 Rng 子流，只给设施选人用。
 *
 * 特效复用现有状态机，不新造并行机制：
 *  - 洞察 → 现有 `insight` 状态（首回合 duration 1，免疫混乱/犹豫/怯战/暴走/挑衅）；
 *  - 规避（设施）→ 现有 `evasion` 1 层（受击必挡一次，由既有 consumeEvasion 消耗）；
 *  - 速度 +10 → 首回合 `speed_buff`（不永久改面板，避免与四维 +20 混为一谈）；
 *  - 无视兵种相克（设施）→ `UnitState.facilityIgnoreTroopCounter` 一次性标记，
 *    由 `action.ts` 本地 `troopCounterReduceOf` 归零、首次物理实际扣兵后消耗
 *    （不在 20 个伤害调用点各改一遍）。
 *
 * 状态来源统一 `facility:<营 id>`（见 `facility-source.ts`）：`action.ts` 的冲突判定
 * 会把设施状态当作「与后续战法不冲突」的既有状态排除，避免铁壁营的 1 层规避把
 * 雪奋短兵等战法规避顶掉（设施是准备阶段白给的一次性效果，不应反向锁死战法）。
 */
import type { CombatContext } from './action';
import { effectiveStat, formatAttrChangeDetail } from './action';
import type { Side, Status, UnitState } from './types';
import { Rng } from './rng';
import { facilitySourceId } from './facility-source';

/** 四级设施满级：每名武将四项各 +20（点数，走 formationBonus） */
export const FACILITY_STAT_BONUS = 20;

/**
 * 设施随机子流固定盐。只用于「三条单体效果各选 1 名武将」，与主战斗 RNG 完全隔离。
 * 改这个值会改变所有战斗的设施选人（但不会改变伤害随机序列）。
 */
export const FACILITY_SEED_SALT = 0x5f3759df;

export type FacilityEffect = 'insight' | 'speed' | 'ignore_counter' | 'evasion';

export interface FacilityDef {
  /** 内部 id（事件 / 状态来源 `facility:<id>`） */
  id: 'junji' | 'jifeng' | 'shangwu' | 'tiebi';
  /** 官方营名 */
  name: string;
  /** 该营对应的四维项（文档用；四维 +20 是四项全加） */
  stat: 'attack' | 'defense' | 'strategy' | 'speed';
  /** 特殊效果种类 */
  effect: FacilityEffect;
  /** `src/data/mechanisms.ts` 的「设施」场景码（811 洞察 / 814 规避 / 871 无视兵种相克；疾风营速度无对应码） */
  mechanism?: number;
  /** 官方效果原文（注释与后续调数值时的锚点） */
  desc: string;
}

/**
 * 战报顺序 = 用户截图顺序：军机营 → 疾风营 → 尚武营 → 铁壁营。
 * 数组顺序同时决定「设施随机子流」的抽签顺序（军机营 → 尚武营 → 铁壁营，疾风营不抽）。
 */
export const FACILITIES: readonly FacilityDef[] = [
  {
    id: 'junji',
    name: '军机营',
    stat: 'strategy',
    effect: 'insight',
    mechanism: 811,
    desc: '提高本城部队的谋略：战斗开始后首回合，使我军单体进入洞察状态。',
  },
  {
    id: 'jifeng',
    name: '疾风营',
    stat: 'speed',
    effect: 'speed',
    desc: '提高本城部队的速度：战斗开始后首回合，使我军全体速度 +10。',
  },
  {
    id: 'shangwu',
    name: '尚武营',
    stat: 'attack',
    effect: 'ignore_counter',
    mechanism: 871,
    desc: '提高本城部队的攻击：战斗开始后，使我军单体首次攻击无视相克。',
  },
  {
    id: 'tiebi',
    name: '铁壁营',
    stat: 'defense',
    effect: 'evasion',
    mechanism: 814,
    desc: '提高本城部队的防御：战斗开始后，使我军单体免疫首次伤害。',
  },
];

/**
 * 设施专用随机子流：`seed ^ 固定盐`。
 * 独立开流的原因见文件头——设施选人若走 `ctx.rng`，会把后续每一次普攻/战法判定的随机数
 * 整体推后，既有战斗的伤害与 golden 全变，且无法判断变化来自设施还是随机位移。
 */
export function makeFacilityRng(seed: number): Rng {
  return new Rng((seed ^ FACILITY_SEED_SALT) >>> 0);
}

/**
 * 准备阶段单一入口：先给全队四维 +20（不进战报），再按 军机营 → 疾风营 → 尚武营 → 铁壁营
 * 施加特殊效果并推 `facility_bonus` 事件。
 *
 * 调用方必须保证：
 *  - 在 `applyTeamBonus` **之后**调用（它会整块重写 formationBonus，先加 +20 会被覆盖）；
 *  - 在 `battle_start` 事件之后、`prep_phase:'formation'` 之前调用（战报顺序）；
 *  - 调用完立即 `refreshTurnOrder()`（疾风营 +10 要进入首回合出手顺序）。
 */
export function applyFacilityBonuses(
  ctx: CombatContext,
  team: UnitState[],
  side: Side,
  rng: Rng
): void {
  if (team.length === 0) return;

  // 四维 +20：四项同时生效，直接并进既有部队加成通道；战报的 formation_bonus 只渲染
  // 阵营/称号/兵种三类 lines，这里不新增 line，所以这 20 点不会出现在战报里。
  for (const unit of team) {
    const base = unit.formationBonus ?? { attack: 0, defense: 0, strategy: 0, speed: 0 };
    unit.formationBonus = {
      attack: base.attack + FACILITY_STAT_BONUS,
      defense: base.defense + FACILITY_STAT_BONUS,
      strategy: base.strategy + FACILITY_STAT_BONUS,
      speed: base.speed + FACILITY_STAT_BONUS,
    };
  }

  /** 三条单体效果各抽 1 名；抽签顺序固定为 军机营 → 尚武营 → 铁壁营（疾风营不抽）。 */
  const pickOne = (): UnitState => team[rng.int(team.length)];

  const emit = (facility: FacilityDef, unit: UnitState, detail: string): void => {
    ctx.events.push({
      type: 'facility_bonus',
      side,
      facilityId: facility.id,
      facilityName: facility.name,
      unitId: unit.general.id,
      unitName: unit.general.name,
      detail,
    });
  };

  const baseStatus = (facility: FacilityDef) => ({
    appliedRound: ctx.currentRound,
    sourceSkillType: 'passive' as const,
    sourceSkillId: facilitySourceId(facility.id),
  });

  for (const facility of FACILITIES) {
    switch (facility.effect) {
      case 'insight': {
        // 军机营：首回合单体洞察。直接 push 现有 insight 状态（duration 1），
        // 不调用 inflictStatus —— 设施事件本身已经描述效果，再发 status_inflicted 会重复一行。
        const unit = pickOne();
        const status: Status = { type: 'insight', remaining: 1, ...baseStatus(facility) };
        unit.statuses.push(status);
        emit(facility, unit, `【${unit.general.name}】进入洞察状态中`);
        break;
      }

      case 'speed': {
        // 疾风营：首回合全体 speed_buff +10（状态而非永久面板，回合末自动到期）。
        // 战报按「加后速度」降序排列，与官方面板一致；+10 对所有人相同，排序键用加前值即可。
        const ordered = [...team].sort(
          (a, b) => effectiveStat(b, 'speed') - effectiveStat(a, 'speed')
        );
        for (const unit of ordered) {
          const before = effectiveStat(unit, 'speed');
          const status: Status = { type: 'speed_buff', amount: 10, remaining: 1, ...baseStatus(facility) };
          unit.statuses.push(status);
          const after = effectiveStat(unit, 'speed');
          // 与 action.ts 的 formatAttrChangeDetail 点数档同格式：
          //   【张春华】的速度属性提高了10(209.7)
          const detail = formatAttrChangeDetail(unit, 'speed_buff', { amount: 10, before, after });
          emit(facility, unit, detail);
        }
        break;
      }

      case 'ignore_counter': {
        // 尚武营：单体首次攻击无视兵种相克。单位级一次性标记，由 action.ts 的
        // troopCounterReduceOf 在物理伤害结算时归零、applyDamage 实际扣兵后清除。
        const unit = pickOne();
        unit.facilityIgnoreTroopCounter = true;
        emit(facility, unit, `【${unit.general.name}】的无视兵种相克(设施)效果已施加`);
        break;
      }

      case 'evasion': {
        // 铁壁营：单体规避 1 层（免疫首次伤害）。复用现有 evasion 状态机；
        // 来源前缀让 action.ts 的冲突判定不把它当成「既有战法规避」。
        const unit = pickOne();
        const status: Status = { type: 'evasion', stacks: 1, ...baseStatus(facility) };
        unit.statuses.push(status);
        emit(facility, unit, `【${unit.general.name}】的规避(设施)效果已施加`);
        break;
      }
    }
  }
}
