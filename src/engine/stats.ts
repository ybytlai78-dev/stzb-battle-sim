/**
 * 战斗统计（v0.3）：从事件流汇总每位武将的战斗数据
 * 统计口径：
 *   - 普攻次数 / 普攻总伤害  → attack_hit 事件
 *   - 战法释放次数 / 战法总伤害 → skill_cast 计数，damage / dot_tick / split_damage 事件累计伤害
 * 追击战法计入战法统计；受规避免疫的伤害不算命中。
 * 分兵溅射（split_damage）计入**授予该分兵的来源战法**（三军齐出 / 长兵方阵 / 先声夺人 / 其徐如林…）与
 * 该战法施法者，不计入普攻 —— 用户 2026-09-26 口径（原实现两处都不计，分兵伤害整段丢失）。
 */
import type { BattleEvent, StatusType, UnitState } from './types';

/**
 * 伤害类事件的统计归属武将：`creditToId` 优先（指挥代打 / 分兵施法者），否则 `sourceId`。
 * ⚠️ 只有伤害事件用这个口径；`attackCount`（普攻次数）等**行为**计数仍看 `sourceId`。
 */
function damageOwnerId(ev: Extract<BattleEvent, { type: 'damage' | 'split_damage' }>): string {
  return ev.creditToId ?? ev.sourceId;
}

export interface UnitStats {
  unitId: string;
  name: string;
  side: 'my' | 'enemy';
  /** 普通攻击命中次数 */
  attackCount: number;
  /** 普通攻击造成的总伤害 */
  attackDamage: number;
  /** 战法（含追击/准备）释放命中次数 */
  skillCount: number;
  /** 战法造成的总伤害 */
  skillDamage: number;
  /** 回复触发次数（heal 事件计数，归属施法者：持续型急救等恢复战法按此统计，而非战法释放次数/杀伤） */
  healCount: number;
  /** 回复兵力总量（heal 事件 amount 求和） */
  healAmount: number;
}

export type StatsSummary = UnitStats[];

/** 通过某战法造成杀伤的武将（战法统计下按**实际打人者**拆分）。 */
export interface SkillKiller {
  unitId: string;
  name: string;
  /** 该武将通过此战法造成的杀伤合计 */
  damage: number;
}

/** 单个战法的战斗统计（按战法 id 拆分） */
export interface SkillStat {
  skillId: string;
  /** 释放次数：skill_cast 事件计数（指挥战法准备阶段算 1 次，如魏武之世 释放1 杀伤0） */
  castCount: number;
  /** 该战法造成的总伤害（damage / dot_tick / split_damage 事件 skillId 匹配求和，不含普攻） */
  damage: number;
  /** 该战法的回复触发次数（heal 事件 skillId 匹配计数，归属施法者） */
  healCount: number;
  /** 该战法的回复兵力总量（heal 事件 amount 求和） */
  healAmount: number;
  /** 通过该战法造成杀伤的武将明细（普攻/无杀伤战法为空数组；顺序 = 首次造成杀伤的先后） */
  killers: SkillKiller[];
}

/** 武将级详细统计：普攻 + 按战法拆分的释放/杀伤 */
export interface UnitDetailedStats {
  unitId: string;
  name: string;
  side: 'my' | 'enemy';
  /** 普通攻击命中次数 */
  attackCount: number;
  /** 普通攻击造成的总伤害 */
  attackDamage: number;
  /** 按战法拆分（按首次出现顺序） */
  skills: SkillStat[];
}

export type DetailedStatsSummary = UnitDetailedStats[];

/** 按战法拆分的详细统计：普攻次数/杀伤 + 每战法释放次数/杀伤 */
export function computeDetailedStats(events: BattleEvent[], units: UnitState[]): DetailedStatsSummary {
  const byId = new Map<string, UnitDetailedStats>();
  const unitById = new Map(units.map((u) => [u.general.id, u]));

  const ensure = (unitId: string): UnitDetailedStats => {
    let s = byId.get(unitId);
    if (!s) {
      const u = unitById.get(unitId);
      s = {
        unitId,
        name: u?.general.name ?? unitId,
        side: u?.side ?? 'my',
        attackCount: 0,
        attackDamage: 0,
        skills: [],
      };
      byId.set(unitId, s);
    }
    return s;
  };

  const skillOf = (s: UnitDetailedStats, skillId: string): SkillStat => {
    let sk = s.skills.find((x) => x.skillId === skillId);
    if (!sk) {
      sk = { skillId, castCount: 0, damage: 0, healCount: 0, healAmount: 0, killers: [] };
      s.skills.push(sk);
    }
    return sk;
  };

  /**
   * 记一笔「通过某战法造成的杀伤」：总数 + 按**实际打人者**（`killerId`）拆分。
   * 两个 id 是两个口径，别混：
   *  - 战法统计的归属武将 = 调用方 `ensure()` 的那个（谁的战法栏记这笔，同 `computeStats` 口径）；
   *  - `killerId` = **实际打出这次伤害的武将**（伤害事件的 `sourceId`）—— 长兵方阵给友军挂分兵时
   *    前者是施法者、后者是打人的友军；弹窗「通过该战法造成杀伤的武将」要的是后者。
   *  DoT 的归属维叫 `casterId`（与 sourceId 不同名），所以 killer 单独传。
   */
  const addDamage = (sk: SkillStat, killerId: string, damage: number): void => {
    sk.damage += damage;
    let k = sk.killers.find((x) => x.unitId === killerId);
    if (!k) {
      k = { unitId: killerId, name: unitById.get(killerId)?.general.name ?? killerId, damage: 0 };
      sk.killers.push(k);
    }
    k.damage += damage;
  };

  for (const ev of events) {
    if (ev.type === 'attack_hit') {
      const s = ensure(ev.sourceId);
      s.attackCount += 1;
      s.attackDamage += ev.damage;
    } else if (ev.type === 'skill_cast') {
      skillOf(ensure(ev.unitId), ev.skillId).castCount += 1;
    } else if (ev.type === 'damage' && ev.skillId) {
      // 指挥队友攻击（奇兵拒北借友军）：杀伤归属 creditToId（施法者），缺省 sourceId
      const ownerId = damageOwnerId(ev);
      addDamage(skillOf(ensure(ownerId), ev.skillId), ev.sourceId, ev.damage);
    } else if (ev.type === 'split_damage' && ev.skillId) {
      // 分兵溅射：计入**授予分兵的来源战法**（三军齐出 / 长兵方阵 / 先声夺人 / 其徐如林…），
      // 统计归属该战法施法者（长兵方阵挂友军时 creditToId = 施法者 ≠ sourceId），
      // 而「造成杀伤的武将」名单记打出普攻的友军（sourceId）。
      const ownerId = damageOwnerId(ev);
      addDamage(skillOf(ensure(ownerId), ev.skillId), ev.sourceId, ev.damage);
    } else if (ev.type === 'dot_tick' && ev.skillId) {
      // DoT（妖术/燃烧/恐慌）伤害计入来源战法杀伤（归属施法者）
      addDamage(skillOf(ensure(ev.casterId), ev.skillId), ev.sourceId, ev.damage);
    } else if (ev.type === 'heal') {
      // 回复统计：触发次数 + 回复兵力（归属施法者；持续型急救等恢复战法按此口径）
      const sk = skillOf(ensure(ev.sourceId), ev.skillId);
      sk.healCount += 1;
      sk.healAmount += ev.amount;
    }
  }

  // 以参战顺序输出，未行动的单位也出现在表中
  return units.map((u) => byId.get(u.general.id) ?? {
    unitId: u.general.id,
    name: u.general.name,
    side: u.side,
    attackCount: 0,
    attackDamage: 0,
    skills: [],
  });
}

/** 由事件流 + 参战单位汇总统计 */
export function computeStats(events: BattleEvent[], units: UnitState[]): StatsSummary {
  const byId = new Map<string, UnitStats>();
  const unitById = new Map(units.map((u) => [u.general.id, u]));

  const ensure = (unitId: string): UnitStats => {
    let s = byId.get(unitId);
    if (!s) {
      const u = unitById.get(unitId);
      s = {
        unitId,
        name: u?.general.name ?? unitId,
        side: u?.side ?? 'my',
        attackCount: 0,
        attackDamage: 0,
        skillCount: 0,
        skillDamage: 0,
        healCount: 0,
        healAmount: 0,
      };
      byId.set(unitId, s);
    }
    return s;
  };

  for (const ev of events) {
    if (ev.type === 'attack_hit') {
      const s = ensure(ev.sourceId);
      s.attackCount += 1;
      s.attackDamage += ev.damage;
    } else if (ev.type === 'skill_cast') {
      const s = ensure(ev.unitId);
      s.skillCount += 1;
    } else if (ev.type === 'damage' && ev.skillId) {
      // 指挥队友攻击（奇兵拒北借友军）：杀伤归属 creditToId（施法者），缺省 sourceId
      const s = ensure(damageOwnerId(ev));
      s.skillDamage += ev.damage;
    } else if (ev.type === 'split_damage' && ev.skillId) {
      // 分兵溅射计入来源战法杀伤（归属授予分兵的施法者），不计入普攻
      const s = ensure(damageOwnerId(ev));
      s.skillDamage += ev.damage;
    } else if (ev.type === 'dot_tick' && ev.skillId) {
      // DoT 伤害计入来源战法杀伤（归属施法者）
      const s = ensure(ev.casterId);
      s.skillDamage += ev.damage;
    } else if (ev.type === 'heal') {
      // 回复统计：触发次数 + 回复兵力（归属施法者；持续型急救等恢复战法按此口径）
      const s = ensure(ev.sourceId);
      s.healCount += 1;
      s.healAmount += ev.amount;
    }
  }

  // 以参战顺序输出，未行动的单位也出现在表中
  return units.map((u) => byId.get(u.general.id) ?? zeroStats(u));
}

function zeroStats(u: UnitState): UnitStats {
  return {
    unitId: u.general.id,
    name: u.general.name,
    side: u.side,
    attackCount: 0,
    attackDamage: 0,
    skillCount: 0,
    skillDamage: 0,
    healCount: 0,
    healAmount: 0,
  };
}

/** 计入控制占比的状态（demo 口径：经典控制 + 挑衅；细项拆分后续补充） */
const CONTROL_STATUS: ReadonlySet<StatusType> = new Set([
  'confusion',
  'rampage',
  'cowardice',
  'hesitation',
  'taunt',
]);

/** 武将在本队中的贡献占比（伤害 / 恢复 / 控制） */
export interface UnitShareStats {
  unitId: string;
  name: string;
  side: 'my' | 'enemy';
  /** 造成总伤害（普攻 + 战法 + DoT + 分兵，口径与 computeStats 一致） */
  damage: number;
  /** 本队伤害占比 0~100，1% 粒度 */
  damagePct: number;
  /** 回复兵力总量（heal 归属施法者） */
  heal: number;
  /** 本队恢复占比 0~100 */
  healPct: number;
  /** 控制次数（见 CONTROL_STATUS，归属最近一次 skill_cast / 成功 skill_trigger 的施法者） */
  control: number;
  /** 本队控制占比 0~100 */
  controlPct: number;
}

/**
 * 按本队合计把绝对量折成百分比（1 位小数；队合计为 0 则全员 0）。
 * @param part 该武将的绝对量
 * @param total 本队合计
 */
function roundPct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * 各武将本队贡献占比（战报「详情」demo）。
 * 伤害 / 恢复口径与 {@link computeStats} 一致；控制按事件流最近施法者归属，细项后续再拆。
 */
export function computeContributionShares(events: BattleEvent[], units: UnitState[]): UnitShareStats[] {
  const byId = new Map<string, { damage: number; heal: number; control: number }>();
  const ensure = (unitId: string) => {
    let s = byId.get(unitId);
    if (!s) {
      s = { damage: 0, heal: 0, control: 0 };
      byId.set(unitId, s);
    }
    return s;
  };

  let lastCaster: string | null = null;
  for (const ev of events) {
    if (ev.type === 'attack_hit') {
      ensure(ev.sourceId).damage += ev.damage;
    } else if (ev.type === 'damage' && ev.skillId) {
      ensure(damageOwnerId(ev)).damage += ev.damage;
    } else if (ev.type === 'split_damage' && ev.skillId) {
      // 分兵溅射计入来源战法施法者的伤害（原实现两处都不计 → 伤害占比被低估）
      ensure(damageOwnerId(ev)).damage += ev.damage;
    } else if (ev.type === 'dot_tick' && ev.skillId) {
      ensure(ev.casterId).damage += ev.damage;
    } else if (ev.type === 'heal') {
      ensure(ev.sourceId).heal += ev.amount;
    } else if (ev.type === 'skill_cast') {
      lastCaster = ev.unitId;
    } else if (ev.type === 'skill_trigger' && ev.success) {
      lastCaster = ev.unitId;
    } else if (ev.type === 'status_inflicted' && CONTROL_STATUS.has(ev.statusType) && lastCaster) {
      ensure(lastCaster).control += 1;
    }
  }

  const raw = units.map((u) => {
    const s = byId.get(u.general.id) ?? { damage: 0, heal: 0, control: 0 };
    return { unitId: u.general.id, name: u.general.name, side: u.side, ...s };
  });

  const totals = (side: 'my' | 'enemy') => {
    const members = raw.filter((x) => x.side === side);
    return {
      damage: members.reduce((a, x) => a + x.damage, 0),
      heal: members.reduce((a, x) => a + x.heal, 0),
      control: members.reduce((a, x) => a + x.control, 0),
    };
  };
  const myT = totals('my');
  const enT = totals('enemy');

  return raw.map((x) => {
    const t = x.side === 'my' ? myT : enT;
    return {
      unitId: x.unitId,
      name: x.name,
      side: x.side,
      damage: x.damage,
      damagePct: roundPct(x.damage, t.damage),
      heal: x.heal,
      healPct: roundPct(x.heal, t.heal),
      control: x.control,
      controlPct: roundPct(x.control, t.control),
    };
  });
}
