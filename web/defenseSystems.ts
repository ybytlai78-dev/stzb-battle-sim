/**
 * 防守体系。
 * ---------------------------------------------------------------------------
 * 每支队伍都要有一套作用在前三回合的防守（或增伤）战法。A/S 全账号只能上阵一次，
 * 所以一套体系整套锁进骨架，不拆开只带半套。
 *
 * - 战磐 = 战必断金 + 磐阵善守。克制普攻 / 追击；反击流不要带战必。
 * - 神赏 = 神兵天降 + 大赏三军。给前三回合能稳定出伤的队伍，通常再带反计之策。
 *   准备阶段就结算伤害的核心，必须由速度更快的队友携带。
 * - 双减 = 避其锋芒 + 无心恋战。适合有回复的半肉、大肉。
 * - 百战 = 百战无怯。给前锋 / 中军里要靠兵力保住输出的人。
 * - 双封 = 战必断金 + 反计之策。生存最强。强势武将不多时优先拿来抬胜率。
 * - 垒石 = 垒实迎击（用户常称垒石迎击）。给主战法是主动的前锋 / 中军，也给其他要保血的前排。
 * - 攻其 = 攻其不备。增伤，不是防守，队伍还要另有一套防守。给速度快的辅助；全队加速的将优先带。
 */
import type { Skill } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { defaultFreePoints, getHeroById, skillGrade } from './heroes';
import {
  campNeedsOpener,
  heroRoles,
  SHEN_PAIR,
  type HeroRole,
  type SlotAssign,
  type TeamLayout,
} from './teamRoles';

/** 战磐：战必断金 + 磐阵善守 */
export const ZHANPAN = ['zhanbi_duanjin', 'panzhen_shanshou'] as const;
/** 双减：避其锋芒 + 无心恋战 */
export const SHUANGJIAN = ['biqi_fengmang', 'wuxin_lianzhan'] as const;
/** 双封：战必断金 + 反计之策 */
export const SHUANGFENG = ['zhanbi_duanjin', 'fanji_zhence'] as const;
/** 百战无怯。只在中军 / 前锋生效。 */
export const BAIZHAN = 'baizhan_wuqie';
/** 垒实迎击（垒石）。援护只在中军 / 前锋生效。 */
export const LEISHI = 'leishi_yingji';
/** 攻其不备。增伤受携带者速度影响。 */
export const GONGQI = 'gongqi_bubei';
/**
 * 攻其不备的速度门槛（40 级面板 + 默认自由点）。
 * 低于这档的辅助不带，收益配不上一个 S 槽。
 */
export const GONGQI_MIN_SPEED = 120;
/** 神赏队伍通常再带的反计之策 */
export const FANJI = 'fanji_zhence';

/** 成套防守战法。骨架填充跳过它们，避免只带进半套。 */
export const DEFENSE_SKILL_IDS: readonly string[] = [
  ...ZHANPAN,
  ...SHEN_PAIR,
  ...SHUANGJIAN,
  BAIZHAN,
  LEISHI,
  GONGQI,
  FANJI,
];

export type DefenseSystemId = 'zhanpan' | 'shenshang' | 'shuangjian' | 'baizhan' | 'shuangfeng' | 'leishi';

export const DEFENSE_LABEL: Record<DefenseSystemId, string> = {
  zhanpan: '战磐',
  shenshang: '神赏',
  shuangjian: '双减',
  baizhan: '百战',
  shuangfeng: '双封',
  leishi: '垒石',
};

/** 一次配将最多出几支队伍。 */
export const MAX_DEFENSE_TEAMS = 5;

/** 一套体系要齐的战法。顺序即出队优先级：能同时凑齐时，双封让给战磐（两套都要战必）。 */
const SYSTEM_SKILLS: Record<DefenseSystemId, readonly string[]> = {
  shenshang: SHEN_PAIR,
  zhanpan: ZHANPAN,
  shuangjian: SHUANGJIAN,
  baizhan: [BAIZHAN],
  leishi: [LEISHI],
  shuangfeng: SHUANGFENG,
};

const PACK_ORDER: readonly DefenseSystemId[] = ['shenshang', 'zhanpan', 'shuangjian', 'baizhan', 'leishi', 'shuangfeng'];

/**
 * 按手头战法能凑齐几套防守体系。
 * A/S 从池里拿走，下一套不能再用；凑不齐的跳过。最多 {@link MAX_DEFENSE_TEAMS} 套。
 * @param skillIds 这次能用的战法 id
 */
export function packDefenseSystems(skillIds: readonly string[]): DefenseSystemId[] {
  const have = new Set(skillIds);
  const out: DefenseSystemId[] = [];
  for (const id of PACK_ORDER) {
    if (out.length >= MAX_DEFENSE_TEAMS) break;
    const need = SYSTEM_SKILLS[id];
    if (!need.every((sid) => have.has(sid))) continue;
    out.push(id);
    for (const sid of need) {
      const g = skillGrade(sid);
      if (g === 'S' || g === 'A') have.delete(sid);
    }
  }
  return out;
}

/**
 * 强势输出少到这个数以下，默认体系从战磐改成双封。
 * 计数看整个将池，不看这一支三个人。
 */
export const FEW_STRONG_HEROES = 3;

const CARRY_ROLES = new Set<HeroRole>(['support', 'sustain', 'shenSupport', 'burstBuff', 'liaoEngine']);
const DOT = new Set(['panic', 'burning', 'sorcery', 'curse', 'ignite']);

export interface DefenseOptions {
  /** 整个将池。用来判断强势武将多不多。缺省只看这一支队伍。 */
  poolHeroIds?: readonly string[];
  /** 用户点名必须携带的战法落在这个将身上，该格不再装体系。 */
  lockHeroId?: string;
  lockSkillIds?: readonly string[];
  /** 速度按这个等级的裸面板，再加上账号默认倾泻的自由点。 */
  level?: number;
}

/**
 * 40 级（或指定等级）速度。含默认自由点里加在速度上的那一部分。
 * @param heroId 武将 id
 * @param level 等级，缺省 40
 */
export function heroSpeed(heroId: string, level = 40): number {
  const h = getHeroById(heroId);
  if (!h) return 0;
  return Math.round(h.baseSpeed + (level - 1) * h.growthSpeed) + defaultFreePoints(heroId, 0, level).speed;
}

/**
 * 主战法在准备阶段就把伤害算死（延迟段预存，或分段延迟里带伤害 / 持续伤害）。
 * 神赏要在他出手之前挂上，否则这段吃不到。
 * @param heroId 武将 id
 */
export function prepSettledDamage(heroId: string): boolean {
  const skill = mainSkill(heroId);
  if (!skill || skill.type !== 'command' || skill.phase !== 'prep') return false;
  const chunks: unknown[] = [];
  if ('delayedOutput' in skill && skill.delayedOutput) chunks.push(skill.delayedOutput);
  if ('delayedOutputs' in skill && skill.delayedOutputs) chunks.push(skill.delayedOutputs);
  return chunks.some((c) => dealsDamage(c));
}

/**
 * 普攻 / 追击链。反击将不算：他们要对方打过来，战必会拆掉自己的输出。
 * @param heroId 武将 id
 */
export function attackChain(heroId: string): boolean {
  if (heroRoles(heroId).has('counterVan')) return false;
  return campNeedsOpener(heroId);
}

/**
 * 将池里能当输出核的人数（大营输出、菜刀核、反击前锋）。
 * @param heroIds 将池
 */
export function strongHeroCount(heroIds: readonly string[]): number {
  return heroIds.filter((id) => {
    const roles = heroRoles(id);
    return roles.has('campDps') || roles.has('bladeCore') || roles.has('counterVan');
  }).length;
}

/**
 * 按这支队伍的结构锁上一套防守体系。
 * 战法不在池子里就不装。点名锁死的那一格不动。
 * @param layout 站位
 * @param skillIds 这次能用的可学战法
 * @param opts 将池、锁将、等级
 */
export function applyDefense(layout: TeamLayout, skillIds: readonly string[], opts: DefenseOptions = {}): TeamLayout {
  const level = opts.level ?? 40;
  const have = new Set(skillIds);
  const slots = layout.slots.map((s) => ({
    ...s,
    ...(s.lockedSkillIds ? { lockedSkillIds: [...s.lockedSkillIds] } : {}),
    ...(s.pinnedSkillIds ? { pinnedSkillIds: [...s.pinnedSkillIds] } : {}),
  }));
  const blocked = new Set<number>();
  slots.forEach((s, i) => {
    if ((s.lockedSkillIds?.length ?? 0) >= 2 && !isShenLock(s.lockedSkillIds)) blocked.add(i);
  });
  if (opts.lockHeroId && (opts.lockSkillIds?.length ?? 0) > 0) {
    const i = slots.findIndex((s) => s.heroId === opts.lockHeroId);
    if (i >= 0) blocked.add(i);
  }

  const counter = isCounterTeam(layout, slots);
  const system = chooseSystem(layout, slots, have, counter, opts.poolHeroIds ?? slots.map((s) => s.heroId), level);
  const notes: string[] = [];
  let defenseId: DefenseSystemId | undefined;

  if (system === 'shenshang') {
    if (placeShen(slots, blocked, have, level, layout.template === 'shenshang', notes)) defenseId = 'shenshang';
  } else if (system === 'zhanpan' || system === 'shuangjian' || system === 'shuangfeng') {
    const pair = system === 'zhanpan' ? ZHANPAN : system === 'shuangjian' ? SHUANGJIAN : SHUANGFENG;
    const slot = carrySlot(slots, blocked, false, level, undefined, have.has(GONGQI));
    if (slot != null && pair.every((id) => have.has(id))) {
      slots[slot].lockedSkillIds = [...pair];
      blocked.add(slot);
      defenseId = system;
      notes.push(pairNote(system));
    }
  }

  const leishiAt = have.has(LEISHI) ? leishiSlot(slots, blocked, have.has(BAIZHAN)) : null;
  if (leishiAt != null) {
    pinSkill(slots[leishiAt], LEISHI);
    blocked.add(leishiAt);
    const who = heroName(slots[leishiAt].heroId);
    const active = activeMain(slots[leishiAt].heroId);
    notes.push(
      active
        ? `垒实迎击给${who}（${slots[leishiAt].position}），主动战法前排靠规避、援护和回复保血`
        : `垒实迎击给${who}（${slots[leishiAt].position}），前排保血`
    );
    if (!defenseId) defenseId = 'leishi';
  }

  const baizhanAt = have.has(BAIZHAN) ? baizhanSlot(slots, blocked) : null;
  if (baizhanAt != null) {
    pinSkill(slots[baizhanAt], BAIZHAN);
    const who = heroName(slots[baizhanAt].heroId);
    notes.push(`百战无怯给${who}（${slots[baizhanAt].position}），减伤和回复保住兵力`);
    if (!defenseId) defenseId = 'baizhan';
  }

  const gongqiAt = have.has(GONGQI) ? gongqiSlot(slots, blocked, level) : null;
  if (gongqiAt != null) {
    pinSkill(slots[gongqiAt], GONGQI);
    const who = heroName(slots[gongqiAt].heroId);
    notes.push(
      grantsTeamSpeed(slots[gongqiAt].heroId)
        ? `攻其不备给${who}，主战法会给全队加速，受速度影响收益高；这套是增伤，还要靠防守体系保护`
        : `攻其不备给${who}，携带者要快才划算；这套是增伤，还要靠防守体系保护`
    );
  }

  if (defenseId && notes.length) notes.unshift(`防守体系：${DEFENSE_LABEL[defenseId]}`);

  return {
    ...layout,
    slots,
    defenseId,
    defenseNote: notes.length ? notes.join('。') : undefined,
    ...(defenseId ? { fillerSkip: [...DEFENSE_SKILL_IDS] } : {}),
    blockSkillIds: counter ? ['zhanbi_duanjin'] : undefined,
  };
}

function mainSkill(heroId: string): Skill | null {
  const id = getHeroById(heroId)?.mainSkillId;
  return id ? SKILL_REGISTRY[id] ?? null : null;
}

function heroName(heroId: string): string {
  return getHeroById(heroId)?.name ?? heroId;
}

function isShenLock(ids: string[] | undefined): boolean {
  return Boolean(ids && ids.length === SHEN_PAIR.length && SHEN_PAIR.every((id) => ids.includes(id)));
}

function isCounterTeam(layout: TeamLayout, slots: SlotAssign[]): boolean {
  if (layout.template === 'counter') return true;
  return slots.some((s) => s.role === 'counterVan' || heroRoles(s.heroId).has('counterVan'));
}

function healTeam(slots: SlotAssign[]): boolean {
  return slots.filter((s) => heroRoles(s.heroId).has('sustain')).length >= 2;
}

function chooseSystem(
  layout: TeamLayout,
  slots: SlotAssign[],
  have: Set<string>,
  counter: boolean,
  poolHeroIds: readonly string[],
  level: number
): DefenseSystemId | null {
  const has = (ids: readonly string[]): boolean => ids.every((id) => have.has(id));
  if (counter) {
    if (has(SHUANGJIAN)) return 'shuangjian';
    if (have.has(BAIZHAN) && baizhanSlot(slots, new Set()) != null) return 'baizhan';
    return null;
  }
  if (wantsShen(layout, slots, have, level)) return 'shenshang';
  const few = strongHeroCount(poolHeroIds) < FEW_STRONG_HEROES;
  if (few && has(SHUANGFENG)) return 'shuangfeng';
  if (healTeam(slots) && has(SHUANGJIAN)) return 'shuangjian';
  if (has(ZHANPAN)) return 'zhanpan';
  if (has(SHUANGFENG)) return 'shuangfeng';
  if (has(SHUANGJIAN)) return 'shuangjian';
  if (have.has(BAIZHAN) && baizhanSlot(slots, new Set()) != null) return 'baizhan';
  return null;
}

function wantsShen(layout: TeamLayout, slots: SlotAssign[], have: Set<string>, level: number): boolean {
  if (!SHEN_PAIR.every((id) => have.has(id))) return false;
  const forced = layout.template === 'shenshang';
  const prep = slots.filter((s) => prepSettledDamage(s.heroId));
  const early = forced || layout.template === 'blade' || prep.length > 0 || slots.some((s) => attackChain(s.heroId));
  if (!early) return false;
  if (forced || prep.length === 0) return true;
  const cap = Math.max(...prep.map((s) => heroSpeed(s.heroId, level)));
  return slots.some((s) => !prepSettledDamage(s.heroId) && heroSpeed(s.heroId, level) > cap);
}

function pairNote(system: 'zhanpan' | 'shuangjian' | 'shuangfeng'): string {
  if (system === 'zhanpan') return '战必封普攻和追击，磐阵再挡主动战法';
  if (system === 'shuangjian') return '双减交给有回复的半肉，保护弱于战磐和双封';
  return '战必防普攻队，反计防主动队';
}

function placeShen(
  slots: SlotAssign[],
  blocked: Set<number>,
  have: Set<string>,
  level: number,
  forced: boolean,
  notes: string[]
): boolean {
  const prep = slots.filter((s) => prepSettledDamage(s.heroId));
  const cap = prep.length ? Math.max(...prep.map((s) => heroSpeed(s.heroId, level))) : -1;
  const needFaster = prep.length > 0;
  const shenBlocked = new Set(blocked);
  slots.forEach((s, i) => {
    if (isShenLock(s.lockedSkillIds)) shenBlocked.delete(i);
  });
  let carrier = carrySlot(slots, shenBlocked, true, level, needFaster ? cap : undefined);
  if (carrier == null && forced) carrier = carrySlot(slots, shenBlocked, true, level);
  if (carrier == null) return false;
  for (const s of slots) {
    if (isShenLock(s.lockedSkillIds)) delete s.lockedSkillIds;
  }
  slots[carrier].lockedSkillIds = [...SHEN_PAIR];
  blocked.add(carrier);
  const who = heroName(slots[carrier].heroId);
  const slowCore = prep.find((s) => heroSpeed(s.heroId, level) >= heroSpeed(slots[carrier]!.heroId, level));
  if (slowCore) {
    notes.push(`神赏由${who}携带，速度不高于${heroName(slowCore.heroId)}，准备阶段结算的伤害吃不到`);
  } else if (prep.length) {
    notes.push(`神赏由更快的${who}携带，${prep.map((s) => heroName(s.heroId)).join('、')}的准备结算能吃到`);
  } else {
    notes.push(`神赏由${who}携带，加前三回合伤害`);
  }
  if (!have.has(FANJI)) return true;
  const extra = carrySlot(slots, blocked, false, level);
  if (extra == null) return true;
  const pinned = slots[extra].pinnedSkillIds ?? [];
  if (!pinned.includes(FANJI)) slots[extra].pinnedSkillIds = [...pinned, FANJI];
  const baiyi = slots.some((s) => getHeroById(s.heroId)?.mainSkillId === 'baiyi_dujiang');
  notes.push(baiyi ? '另带反计之策，配合白衣渡江的前两回合怯战，接近双封' : '另带反计之策，防主动战法');
  return true;
}

/**
 * 挑一个装体系的格子。
 * @param fasterThan 有准备结算核心时，携带者速度必须高于这个数
 */
function carrySlot(
  slots: SlotAssign[],
  blocked: Set<number>,
  forShen: boolean,
  level: number,
  fasterThan?: number,
  /** 队里有攻其不备时，成套防守尽量别占住全队加速的那一格 */
  keepSpeedAura = false
): number | null {
  const rows = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !blocked.has(i) && (s.lockedSkillIds?.length ?? 0) < 2)
    .filter(({ s }) => fasterThan == null || (!prepSettledDamage(s.heroId) && heroSpeed(s.heroId, level) > fasterThan));
  if (!rows.length) return null;
  rows.sort((a, b) => {
    if (keepSpeedAura && !forShen) {
      const ag = grantsTeamSpeed(a.s.heroId) ? 1 : 0;
      const bg = grantsTeamSpeed(b.s.heroId) ? 1 : 0;
      if (ag !== bg) return ag - bg;
    }
    if (forShen && fasterThan != null) return heroSpeed(b.s.heroId, level) - heroSpeed(a.s.heroId, level);
    const ar = CARRY_ROLES.has(a.s.role) ? 1 : 0;
    const br = CARRY_ROLES.has(b.s.role) ? 1 : 0;
    return br - ar || heroSpeed(b.s.heroId, level) - heroSpeed(a.s.heroId, level);
  });
  if (forShen && fasterThan != null) {
    const supports = rows.filter((r) => CARRY_ROLES.has(r.s.role));
    if (supports.length) return supports[0].i;
  }
  return rows[0].i;
}

function baizhanSlot(slots: SlotAssign[], blocked: Set<number>): number | null {
  const rows = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => {
      if (blocked.has(i)) return false;
      if (s.position !== '中军' && s.position !== '前锋') return false;
      if ((s.lockedSkillIds?.length ?? 0) >= 2) return false;
      if ((s.pinnedSkillIds?.length ?? 0) >= 2) return false;
      return wantsBaizhan(s);
    });
  rows.sort((a, b) => {
    const af = a.s.position === '前锋' ? 1 : 0;
    const bf = b.s.position === '前锋' ? 1 : 0;
    return bf - af;
  });
  return rows[0]?.i ?? null;
}

function wantsBaizhan(slot: SlotAssign): boolean {
  if (slot.role === 'counterVan' || heroRoles(slot.heroId).has('counterVan')) return true;
  if (attackChain(slot.heroId)) return true;
  if (prepSettledDamage(slot.heroId)) return true;
  const skill = mainSkill(slot.heroId);
  return Boolean(skill && 'actLayer' in skill && skill.actLayer);
}

/**
 * 主战法是主动（含准备主动）。垒石优先给这种前锋 / 中军。
 * @param heroId 武将 id
 */
export function activeMain(heroId: string): boolean {
  return mainSkill(heroId)?.type === 'active';
}

/**
 * 主战法会在准备阶段给我军群体 / 全体加速度。攻其不备优先给这种将。
 * @param heroId 武将 id
 */
export function grantsTeamSpeed(heroId: string): boolean {
  const skill = mainSkill(heroId);
  if (!skill || skill.type === 'active' || skill.type === 'pursuit') return false;
  const mode = 'targetMode' in skill ? skill.targetMode : undefined;
  if (mode !== 'all' && mode !== 'group') return false;
  const side = 'targetSide' in skill ? skill.targetSide : undefined;
  if (side === 'enemy') return false;
  return speedBuffPositive(skill);
}

function pinSkill(slot: SlotAssign, id: string): void {
  const cur = slot.pinnedSkillIds ?? [];
  if (!cur.includes(id)) slot.pinnedSkillIds = [...cur, id];
}

function hasRoom(slot: SlotAssign): boolean {
  return (slot.lockedSkillIds?.length ?? 0) < 2 && (slot.pinnedSkillIds?.length ?? 0) < 2;
}

/**
 * 垒石给中军 / 前锋。主动战法优先；非主动的保血前排在没有百战时才用垒石。
 */
function leishiSlot(slots: SlotAssign[], blocked: Set<number>, haveBaizhan: boolean): number | null {
  const rows = frontRows(slots, blocked).filter((r) => activeMain(r.s.heroId) || wantsBaizhan(r.s));
  const active = rows.filter((r) => activeMain(r.s.heroId));
  if (active.length) return preferVan(active);
  if (haveBaizhan) return null;
  return preferVan(rows);
}

function gongqiSlot(slots: SlotAssign[], blocked: Set<number>, level: number): number | null {
  const rows = slots
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !blocked.has(i) && hasRoom(s));
  const aura = rows.filter((r) => grantsTeamSpeed(r.s.heroId));
  if (aura.length) {
    aura.sort((a, b) => heroSpeed(b.s.heroId, level) - heroSpeed(a.s.heroId, level));
    return aura[0].i;
  }
  const fast = rows.filter((r) => CARRY_ROLES.has(r.s.role) && heroSpeed(r.s.heroId, level) >= GONGQI_MIN_SPEED);
  if (!fast.length) return null;
  fast.sort((a, b) => heroSpeed(b.s.heroId, level) - heroSpeed(a.s.heroId, level));
  return fast[0].i;
}

function frontRows(slots: SlotAssign[], blocked: Set<number>): Array<{ s: SlotAssign; i: number }> {
  return slots
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !blocked.has(i) && hasRoom(s) && (s.position === '中军' || s.position === '前锋'));
}

function preferVan(rows: Array<{ s: SlotAssign; i: number }>): number | null {
  if (!rows.length) return null;
  rows.sort((a, b) => (b.s.position === '前锋' ? 1 : 0) - (a.s.position === '前锋' ? 1 : 0));
  return rows[0].i;
}

function speedBuffPositive(node: unknown, seen = new Set<object>()): boolean {
  if (!node || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => speedBuffPositive(x, seen));
  const raw = node as Record<string, unknown>;
  if (String(raw.kind ?? '') === 'inflict_status') {
    const list = Array.isArray(raw.status) ? raw.status : raw.status ? [raw.status] : [];
    if (list.some((st) => st && typeof st === 'object' && (st as { type?: string }).type === 'speed_buff' && Number((st as { amount?: number }).amount ?? 0) > 0)) {
      return true;
    }
  }
  return Object.values(raw).some((v) => v && typeof v === 'object' && speedBuffPositive(v, seen));
}

function dealsDamage(node: unknown, seen = new Set<object>()): boolean {
  if (!node || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => dealsDamage(x, seen));
  const raw = node as Record<string, unknown>;
  const kind = String(raw.kind ?? '');
  if (kind === 'physical_damage' || kind === 'strategy_damage' || kind === 'positional_physical_damage') return true;
  if (kind === 'inflict_status') {
    const list = Array.isArray(raw.status) ? raw.status : raw.status ? [raw.status] : [];
    if (list.some((st) => st && typeof st === 'object' && DOT.has(String((st as { type?: string }).type ?? '')))) return true;
  }
  return Object.values(raw).some((v) => v && typeof v === 'object' && dealsDamage(v, seen));
}
