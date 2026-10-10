/**
 * 模板配将的角色池。
 * ---------------------------------------------------------------------------
 * 扫战法输出结构（目标阵营、受击钩子、代打、状态类型、追击、前三回合窗口），
 * 不手写武将名单。一个武将可以同时落在多个角色里。谋略成长只参与排序，不踢人。
 */
import type { Skill } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { mutualGroupOf } from './advisor/gate';
import type { PlanPosition } from './advisor/types';
import { getHeroById, HEROES, isFemale, isLearnableSkillListed, isMainSkill, SKILL_GRADES } from './heroes';

/** 神赏拐位锁死的两件 */
export const SHEN_PAIR = ['shenbing_tianjiang', 'dashang_sanjun'] as const;
/** 追击 / 自增伤大营必须带的其中一件 */
export const OPENERS = ['xiansheng_duoren', 'xianqu_tuji'] as const;

export type HeroRole =
  | 'campDps'
  | 'support'
  | 'counterVan'
  | 'sustain'
  | 'liaoEngine'
  | 'burstBuff'
  | 'bladeCore'
  | 'shenSupport';

export type SkillKind = 'dps' | 'support' | 'sustain' | 'burstBuff';

export type TeamTemplateId = 'standard' | 'counter' | 'blade' | 'shenshang';

export const TEMPLATE_LABEL: Record<TeamTemplateId, string> = {
  standard: '标准队',
  counter: '半肉反击',
  blade: '菜刀',
  shenshang: '神赏法刀',
};

export const ALL_TEMPLATES: TeamTemplateId[] = ['standard', 'counter', 'blade', 'shenshang'];

/** 进模拟的粗筛上限。再多只留静态分最高的。 */
export const LAYOUT_SIM_CAP = 8;
/** ponytail: 每格先留 16 人再做笛卡尔积。全池上百人时全积没有信息增益。 */
const SLOT_CAP = 16;

const CONTROL = new Set(['confusion', 'rampage', 'cowardice', 'hesitation', 'taunt', 'siege']);
const ATTR = new Set(['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff']);
const GRADE_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

type Side = 'ally' | 'enemy' | 'self';

/** 从战法结构读出来的事实，角色都从这里派生 */
export interface SkillProfile {
  enemyDamage: boolean;
  selfDamageBoost: boolean;
  /** 给我军群体 / 全体的增益（不含只给自己） */
  allyGroupBuff: boolean;
  commandAllyAttack: boolean;
  enemyControl: boolean;
  /** 自己受伤才打出去，或自身反击 */
  selfCounter: boolean;
  allyOrSelfReduce: boolean;
  allyOrSelfHeal: boolean;
  allyOrSelfEvasion: boolean;
  /** 给我军挂连击，且窗口落在前三回合 */
  allyComboEarly: boolean;
  allyDamageBoost: boolean;
  enemyStatDown: boolean;
  /** 让敌军受到的伤害提高（神兵天降这一类） */
  enemyTakenBoost: boolean;
  pursuit: boolean;
  first3Damage: boolean;
}

interface Acc extends SkillProfile {
  allyCombo: boolean;
  earlyWindow: boolean;
}

function emptyAcc(): Acc {
  return {
    enemyDamage: false,
    selfDamageBoost: false,
    allyGroupBuff: false,
    commandAllyAttack: false,
    enemyControl: false,
    selfCounter: false,
    allyOrSelfReduce: false,
    allyOrSelfHeal: false,
    allyOrSelfEvasion: false,
    allyComboEarly: false,
    allyDamageBoost: false,
    enemyStatDown: false,
    enemyTakenBoost: false,
    pursuit: false,
    first3Damage: false,
    allyCombo: false,
    earlyWindow: false,
  };
}

function sideOf(raw: Record<string, unknown>, fallback: Side): Side {
  if (raw.target === 'self' || raw.targetSide === 'self' || raw.lockedSide === 'self') return 'self';
  if (raw.targetSide === 'ally' || raw.lockedSide === 'ally') return 'ally';
  if (raw.targetSide === 'enemy' || raw.lockedSide === 'enemy') return 'enemy';
  return fallback;
}

function isGroup(raw: Record<string, unknown>, inherited?: string): boolean {
  const mode = (typeof raw.targetMode === 'string' ? raw.targetMode : inherited) ?? '';
  return mode === 'all' || mode === 'group';
}

function asStatuses(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>;
}

function noteStatus(st: Record<string, unknown>, side: Side, group: boolean, acc: Acc): void {
  const type = String(st.type ?? '');
  if (CONTROL.has(type) && side === 'enemy') acc.enemyControl = true;
  if ((type === 'counter' || type === 'retaliate') && side === 'self') acc.selfCounter = true;
  if (type === 'damage_reduce' && side !== 'enemy') acc.allyOrSelfReduce = true;
  if ((type === 'first_aid' || type === 'rest') && side !== 'enemy') acc.allyOrSelfHeal = true;
  if ((type === 'evasion' || type === 'evade_chance') && side !== 'enemy') acc.allyOrSelfEvasion = true;
  if (type === 'combo' && side === 'ally') acc.allyCombo = true;
  if (type === 'damage_boost') {
    const rate = Number(st.rate ?? 0);
    const dir = st.direction === 'taken' ? 'taken' : 'caused';
    if (rate > 0 && dir === 'caused' && side === 'self') acc.selfDamageBoost = true;
    if (rate > 0 && dir === 'caused' && side === 'ally') {
      acc.allyDamageBoost = true;
      if (group) acc.allyGroupBuff = true;
    }
    if (rate > 0 && dir === 'taken' && side === 'enemy') acc.enemyTakenBoost = true;
  }
  if (ATTR.has(type) || type === 'range_buff' || type === 'skill_range_buff') {
    const amount = Number(st.amount ?? 0);
    if (amount < 0 && side === 'enemy') acc.enemyStatDown = true;
    if (amount > 0 && side === 'ally' && group) acc.allyGroupBuff = true;
  }
  if (group && side === 'ally' && (type === 'insight' || type === 'morale_boost' || type === 'evasion' || type === 'combo' || type === 'damage_reduce' || type === 'first_aid' || type === 'rest')) {
    acc.allyGroupBuff = true;
  }
}

function noteOutput(raw: Record<string, unknown>, fallback: Side, groupMode: string | undefined, when: 'always' | 'early', acc: Acc): void {
  const kind = String(raw.kind ?? '');
  const side = sideOf(raw, fallback);
  const group = isGroup(raw, groupMode);
  if (kind === 'physical_damage' || kind === 'strategy_damage' || kind === 'positional_physical_damage') {
    const dmgSide = raw.targetSide || raw.lockedSide || raw.target === 'self' ? side : 'enemy';
    if (dmgSide === 'enemy') {
      acc.enemyDamage = true;
      if (when === 'early') acc.first3Damage = true;
    }
    const attacker = String(raw.attacker ?? '');
    if (attacker.includes('ally') || attacker === 'recipient' || raw.source === 'fastest_ally') acc.commandAllyAttack = true;
    if (raw.healSource) acc.allyOrSelfHeal = true;
  }
  if (kind === 'heal' && side !== 'enemy') {
    acc.allyOrSelfHeal = true;
    if (group && side === 'ally') acc.allyGroupBuff = true;
  }
  if (kind === 'grant_evasion' || kind === 'remove_debuffs') {
    const beneficial: Side = raw.targetSide === 'enemy' ? 'enemy' : raw.target === 'self' || raw.targetSide === 'self' ? 'self' : 'ally';
    if (kind === 'grant_evasion' && beneficial !== 'enemy') acc.allyOrSelfEvasion = true;
    if (beneficial === 'ally' && (group || isGroup(raw, groupMode))) acc.allyGroupBuff = true;
  }
  if (kind === 'grant_first_aid') acc.allyOrSelfHeal = true;
  if (kind === 'grant_damage_boost') {
    const rate = Number(raw.rate ?? 0);
    const dir = raw.direction === 'caused' ? 'caused' : 'taken';
    if (rate > 0 && dir === 'caused' && side === 'self') acc.selfDamageBoost = true;
    if (rate > 0 && dir === 'caused' && (side === 'ally' || (side !== 'enemy' && group))) {
      acc.allyDamageBoost = true;
      if (group) acc.allyGroupBuff = true;
    }
    if (rate > 0 && dir === 'taken' && side === 'enemy') acc.enemyTakenBoost = true;
  }
  if (kind === 'inflict_status') {
    for (const st of asStatuses(raw.status)) noteStatus(st, side, group, acc);
    const by = raw.byHigherStatStatus as { attack?: unknown; strategy?: unknown } | undefined;
    if (by) {
      for (const st of asStatuses(by.attack)) noteStatus(st, side, group, acc);
      for (const st of asStatuses(by.strategy)) noteStatus(st, side, group, acc);
    }
  }
}

function earlySkill(skill: Skill): boolean {
  const s = skill as Skill & {
    endRound?: number;
    roundRepeat?: { endRound?: number; startRound?: number };
    roundStartRepeat?: { endRound?: number };
  };
  if (typeof s.endRound === 'number' && s.endRound <= 3) return true;
  const rr = s.roundRepeat;
  if (rr && (rr.endRound ?? 99) <= 3 && (rr.startRound ?? 1) <= 3) return true;
  const rs = s.roundStartRepeat;
  if (rs && (rs.endRound ?? 99) <= 3) return true;
  return false;
}

function walk(node: unknown, fallback: Side, groupMode: string | undefined, when: 'always' | 'early', acc: Acc, seen: Set<object>): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) walk(x, fallback, groupMode, when, acc, seen);
    return;
  }
  const raw = node as Record<string, unknown>;
  const side = sideOf(raw, fallback);
  const mode = typeof raw.targetMode === 'string' ? raw.targetMode : groupMode;
  const nextWhen = (typeof raw.atRound === 'number' && raw.atRound <= 3) || (typeof raw.endRound === 'number' && raw.endRound <= 3) ? 'early' : when;
  if (typeof raw.kind === 'string') noteOutput(raw, side, mode, nextWhen, acc);
  for (const v of Object.values(raw)) {
    if (v && typeof v === 'object') walk(v, side, mode, nextWhen, acc, seen);
  }
}

/** 读一个战法的结构事实。主战法和可学战法共用。 */
export function profileOfSkill(skill: Skill): SkillProfile {
  const acc = emptyAcc();
  const early = earlySkill(skill);
  acc.earlyWindow = early;
  if (skill.type === 'pursuit') acc.pursuit = true;
  const s = skill as Skill & { targetSide?: Side; targetMode?: string; attackProcBoost?: unknown; selfPhysBoost?: unknown; onHurt?: unknown };
  if (s.attackProcBoost || s.selfPhysBoost) acc.selfDamageBoost = true;
  const hooks = skill as Skill & {
    stackBuff?: { onAttack?: unknown; onStrategy?: unknown };
    allySlotBoost?: { damageRate?: number; baseCount?: number };
  };
  if (hooks.stackBuff) {
    acc.allyGroupBuff = true;
    if (hooks.stackBuff.onAttack || hooks.stackBuff.onStrategy) acc.allyDamageBoost = true;
  }
  if (hooks.allySlotBoost && (hooks.allySlotBoost.damageRate ?? 0) > 0) {
    acc.allyDamageBoost = true;
    if ((hooks.allySlotBoost.baseCount ?? 0) >= 2 || s.targetMode === 'all' || s.targetMode === 'group') acc.allyGroupBuff = true;
  }
  const mode = s.targetMode;
  const base: Side = s.targetSide ?? (mode === 'self' ? 'self' : 'enemy');
  const chunks: unknown[] = [skill.output];
  if ('initialOutput' in skill) chunks.push(skill.initialOutput);
  if ('delayedOutput' in skill) chunks.push(skill.delayedOutput);
  if ('delayedOutputs' in skill) chunks.push(skill.delayedOutputs);
  if ('roundStartRepeat' in skill) chunks.push(skill.roundStartRepeat);
  if ('roundStartChance' in skill) chunks.push(skill.roundStartChance);
  if ('onHurt' in skill) chunks.push(skill.onHurt);
  if ('dealExtraStrike' in skill) chunks.push(skill.dealExtraStrike);
  const seen = new Set<object>();
  for (const c of chunks) walk(c, base, mode, early ? 'early' : 'always', acc, seen);
  const hurts = asStatuses(s.onHurt);
  if (hurts.some((h) => h.victim === 'self' && (h.applyTo === 'skill_targets' || acc.enemyDamage))) acc.selfCounter = true;
  acc.allyComboEarly = acc.allyCombo && acc.earlyWindow;
  if (acc.enemyDamage && acc.earlyWindow) acc.first3Damage = true;
  return acc;
}

const profileCache = new Map<string, SkillProfile>();

function profileById(skillId: string): SkillProfile | null {
  const hit = profileCache.get(skillId);
  if (hit) return hit;
  const skill = SKILL_REGISTRY[skillId];
  if (!skill) return null;
  const p = profileOfSkill(skill);
  profileCache.set(skillId, p);
  return p;
}

function mainProfile(heroId: string): SkillProfile | null {
  const hero = getHeroById(heroId);
  if (!hero?.mainSkillId) return null;
  return profileById(hero.mainSkillId);
}

/** 这张卡的主战法落在哪些角色上 */
export function heroRoles(heroId: string): Set<HeroRole> {
  const p = mainProfile(heroId);
  const roles = new Set<HeroRole>();
  if (!p) return roles;
  const allyTeam = p.allyGroupBuff || p.commandAllyAttack;
  if (p.selfCounter) roles.add('counterVan');
  if (!p.selfCounter && (p.enemyDamage || p.selfDamageBoost) && !allyTeam) roles.add('campDps');
  if (p.allyGroupBuff || p.commandAllyAttack || p.enemyControl) roles.add('support');
  if (p.allyOrSelfReduce || p.allyOrSelfHeal || p.allyOrSelfEvasion) roles.add('sustain');
  if (p.allyComboEarly) roles.add('liaoEngine');
  if (p.allyDamageBoost || p.enemyStatDown) roles.add('burstBuff');
  if (!p.selfCounter && (p.pursuit || p.selfDamageBoost || p.enemyDamage)) roles.add('bladeCore');
  if (!p.selfCounter && (p.allyDamageBoost || p.commandAllyAttack || p.enemyDamage || p.first3Damage || p.enemyStatDown || p.enemyTakenBoost)) {
    roles.add('shenSupport');
  }
  return roles;
}

/** 大营主战法是追击或自增伤时，神赏法刀必须再带先声 / 先驱 */
export function campNeedsOpener(heroId: string): boolean {
  const p = mainProfile(heroId);
  return Boolean(p && (p.pursuit || p.selfDamageBoost));
}

/** 男 ≥ 2.0、女 ≥ 1.5 排到神赏拐位前面。低于线的仍留在池里。 */
export function shenGrowthFirst(heroId: string): boolean {
  const h = getHeroById(heroId);
  if (!h) return false;
  const g = h.growthStrategy;
  return isFemale(heroId) ? g >= 1.5 : g >= 2;
}

function roleScore(heroId: string, role: HeroRole): number {
  const p = mainProfile(heroId);
  const g = getHeroById(heroId)?.growthStrategy ?? 0;
  if (role === 'shenSupport') return (shenGrowthFirst(heroId) ? 1000 : 0) + g;
  if (role === 'bladeCore') return p && (p.pursuit || p.selfDamageBoost) ? 100 : 10;
  if (role === 'sustain') return p && p.allyOrSelfReduce && p.allyOrSelfHeal ? 20 : 5;
  return 0;
}

function byGrade(a: string, b: string): number {
  return (GRADE_RANK[SKILL_GRADES[a]] ?? 9) - (GRADE_RANK[SKILL_GRADES[b]] ?? 9) || a.localeCompare(b);
}

/** 可学战法按品级排序。调用方再截断到搜索上限。 */
export function skillKindOf(skillId: string): Set<SkillKind> {
  const kinds = new Set<SkillKind>();
  const p = profileById(skillId);
  if (!p) return kinds;
  if (p.pursuit || p.enemyDamage || p.selfDamageBoost) kinds.add('dps');
  if (p.allyGroupBuff || p.enemyControl || p.commandAllyAttack || p.allyDamageBoost || p.allyOrSelfHeal || p.allyOrSelfReduce) kinds.add('support');
  if (p.allyOrSelfReduce || p.allyOrSelfHeal || p.allyOrSelfEvasion) kinds.add('sustain');
  if (p.allyDamageBoost || p.enemyStatDown || p.enemyTakenBoost) kinds.add('burstBuff');
  return kinds;
}

export interface RolePools {
  heroes: Record<HeroRole, string[]>;
  skills: Record<SkillKind, string[]>;
}

/** 在给定将法里分角色。武将按角色分排序，战法按品级排序。 */
export function buildPools(heroIds: string[], skillIds: string[]): RolePools {
  const heroes = {} as Record<HeroRole, string[]>;
  const roles: HeroRole[] = ['campDps', 'support', 'counterVan', 'sustain', 'liaoEngine', 'burstBuff', 'bladeCore', 'shenSupport'];
  for (const role of roles) {
    const ids = heroIds.filter((id) => heroRoles(id).has(role));
    heroes[role] = ids.sort((a, b) => roleScore(b, role) - roleScore(a, role) || a.localeCompare(b));
  }
  const skills = { dps: [] as string[], support: [] as string[], sustain: [] as string[], burstBuff: [] as string[] };
  const learnable = skillIds.filter((id) => SKILL_REGISTRY[id] && !isMainSkill(id) && isLearnableSkillListed(id));
  for (const id of learnable) {
    const kinds = skillKindOf(id);
    if ((OPENERS as readonly string[]).includes(id)) kinds.add('dps');
    for (const kind of kinds) skills[kind].push(id);
  }
  for (const kind of Object.keys(skills) as SkillKind[]) skills[kind].sort(byGrade);
  return { heroes, skills };
}

/** 没点 box 时用上架池 */
export function listedHeroIds(): string[] {
  return HEROES.map((h) => h.id);
}

export interface SlotAssign {
  position: PlanPosition;
  heroId: string;
  role: HeroRole;
  skillKind: SkillKind;
  /** 锁死、不参与战法搜索（两格都占满） */
  lockedSkillIds?: string[];
  /**
   * 骨架先占住、搜索不能换掉。
   * 不满 2 个时，空着的那一格仍可搜。
   */
  pinnedSkillIds?: string[];
}

export interface TeamLayout {
  template: TeamTemplateId;
  slots: SlotAssign[];
  score: number;
  /**
   * 粗筛填充时跳过这些战法。
   * 防守体系要成套带，不能在骨架里只塞进半套。
   */
  fillerSkip?: string[];
  /** 战法搜索候选里排除。反击队排除战必断金。 */
  blockSkillIds?: string[];
  /** 这套站位锁上的防守体系 id（战磐 / 神赏 / 双减 / 百战 / 双封） */
  defenseId?: string;
  /** 给顾问开口用的体系说明 */
  defenseNote?: string;
}

function capSlot(ids: string[], role: HeroRole, lock?: string): string[] {
  const top = ids.slice(0, SLOT_CAP);
  if (lock && ids.includes(lock) && !top.includes(lock)) {
    const next = top.slice(0, SLOT_CAP - 1);
    next.push(lock);
    return next.sort((a, b) => roleScore(b, role) - roleScore(a, role) || a.localeCompare(b));
  }
  return top;
}

function legalTrio(ids: string[]): boolean {
  if (new Set(ids).size !== ids.length) return false;
  const groups = ids.map((id) => mutualGroupOf(id)).filter((g): g is string => Boolean(g));
  return new Set(groups).size === groups.length;
}

function layoutOf(template: TeamTemplateId, slots: SlotAssign[]): TeamLayout {
  const score = slots.reduce((s, slot) => s + roleScore(slot.heroId, slot.role), 0);
  return { template, slots, score };
}

function pushTriples(
  out: TeamLayout[],
  template: TeamTemplateId,
  cols: Array<{ role: HeroRole; skillKind: SkillKind; ids: string[]; locked?: string[] }>,
  lock?: string
): void {
  const positions: PlanPosition[] = ['大营', '中军', '前锋'];
  for (const a of cols[0].ids) {
    for (const b of cols[1].ids) {
      for (const c of cols[2].ids) {
        const ids = [a, b, c];
        if (!legalTrio(ids)) continue;
        if (lock && !ids.includes(lock)) continue;
        const picked = [cols[0], cols[1], cols[2]];
        out.push(
          layoutOf(
            template,
            ids.map((heroId, i) => ({
              position: positions[i],
              heroId,
              role: picked[i].role,
              skillKind: picked[i].skillKind,
              ...(picked[i].locked ? { lockedSkillIds: picked[i].locked } : {}),
            }))
          )
        );
      }
    }
  }
}

function openersIn(skillIds: readonly string[]): boolean {
  return OPENERS.some((id) => skillIds.includes(id));
}

/**
 * 某一套模板的合法站位。凑不齐时 `reason` 说明缺什么，`layouts` 为空。
 * `lockHeroId` 给定时，每套站位都包含这个武将。
 */
export function layoutsFor(
  template: TeamTemplateId,
  heroIds: string[],
  skillIds: readonly string[],
  lockHeroId?: string
): { layouts: TeamLayout[]; reason?: string } {
  const pools = buildPools(heroIds, [...skillIds]);
  const lock = lockHeroId && heroIds.includes(lockHeroId) ? lockHeroId : undefined;
  const out: TeamLayout[] = [];
  if (template === 'standard') {
    if (!pools.heroes.campDps.length) return { layouts: [], reason: '没有大营输出' };
    if (pools.heroes.support.length < 2) return { layouts: [], reason: '辅助不足两名' };
    pushTriples(out, template, [
      { role: 'campDps', skillKind: 'dps', ids: capSlot(pools.heroes.campDps, 'campDps', lock) },
      { role: 'support', skillKind: 'support', ids: capSlot(pools.heroes.support, 'support', lock) },
      { role: 'support', skillKind: 'support', ids: capSlot(pools.heroes.support, 'support', lock) },
    ], lock);
  } else if (template === 'counter') {
    if (!pools.heroes.counterVan.length) return { layouts: [], reason: '没有反击前锋' };
    if (pools.heroes.sustain.length < 2) return { layouts: [], reason: '续航不足两名' };
    pushTriples(out, template, [
      { role: 'sustain', skillKind: 'sustain', ids: capSlot(pools.heroes.sustain, 'sustain', lock) },
      { role: 'sustain', skillKind: 'sustain', ids: capSlot(pools.heroes.sustain, 'sustain', lock) },
      { role: 'counterVan', skillKind: 'dps', ids: capSlot(pools.heroes.counterVan, 'counterVan', lock) },
    ], lock);
  } else if (template === 'blade') {
    if (!pools.heroes.liaoEngine.length) return { layouts: [], reason: '没有前三回合给队友连击的武将' };
    if (!pools.heroes.bladeCore.length) return { layouts: [], reason: '没有输出核' };
    const liao = capSlot(pools.heroes.liaoEngine, 'liaoEngine', lock);
    const cores = capSlot(pools.heroes.bladeCore, 'bladeCore', lock);
    if (pools.heroes.burstBuff.length) {
      const buff = capSlot(pools.heroes.burstBuff, 'burstBuff', lock);
      pushTriples(out, template, [
        { role: 'bladeCore', skillKind: 'dps', ids: cores },
        { role: 'liaoEngine', skillKind: 'support', ids: liao },
        { role: 'burstBuff', skillKind: 'burstBuff', ids: buff },
      ], lock);
      pushTriples(out, template, [
        { role: 'bladeCore', skillKind: 'dps', ids: cores },
        { role: 'burstBuff', skillKind: 'burstBuff', ids: buff },
        { role: 'liaoEngine', skillKind: 'support', ids: liao },
      ], lock);
    } else if (cores.length >= 2) {
      pushTriples(out, template, [
        { role: 'bladeCore', skillKind: 'dps', ids: cores },
        { role: 'liaoEngine', skillKind: 'support', ids: liao },
        { role: 'bladeCore', skillKind: 'dps', ids: cores },
      ], lock);
      pushTriples(out, template, [
        { role: 'bladeCore', skillKind: 'dps', ids: cores },
        { role: 'bladeCore', skillKind: 'dps', ids: cores },
        { role: 'liaoEngine', skillKind: 'support', ids: liao },
      ], lock);
    } else {
      return { layouts: [], reason: '没有增伤拐，输出核也不足两名' };
    }
  } else {
    if (!SHEN_PAIR.every((id) => skillIds.includes(id))) return { layouts: [], reason: '缺少神兵天降或大赏三军' };
    if (!pools.heroes.shenSupport.length) return { layouts: [], reason: '没有神赏拐' };
    const haveOpener = openersIn(skillIds);
    const campCores = pools.heroes.bladeCore.filter((id) => haveOpener || !campNeedsOpener(id));
    const flankCores = pools.heroes.bladeCore;
    if (!campCores.length || flankCores.length < 2) {
      return { layouts: [], reason: '输出核不足，或追击/自增伤大营缺少先声夺人与先驱突击' };
    }
    const locked = [...SHEN_PAIR];
    const shen = capSlot(pools.heroes.shenSupport, 'shenSupport', lock);
    const campIds = capSlot(campCores, 'bladeCore', lock);
    const flankIds = capSlot(flankCores, 'bladeCore', lock);
    pushTriples(out, template, [
      { role: 'bladeCore', skillKind: 'dps', ids: campIds },
      { role: 'shenSupport', skillKind: 'burstBuff', ids: shen, locked },
      { role: 'bladeCore', skillKind: 'dps', ids: flankIds },
    ], lock);
    pushTriples(out, template, [
      { role: 'bladeCore', skillKind: 'dps', ids: campIds },
      { role: 'bladeCore', skillKind: 'dps', ids: flankIds },
      { role: 'shenSupport', skillKind: 'burstBuff', ids: shen, locked },
    ], lock);
  }
  if (!out.length) return { layouts: [], reason: lock ? '点名的武将进不了这一套' : '凑不出合法站位' };
  out.sort((a, b) => b.score - a.score || layoutKey(a).localeCompare(layoutKey(b)));
  return { layouts: out.slice(0, LAYOUT_SIM_CAP) };
}

function layoutKey(l: TeamLayout): string {
  return l.slots.map((s) => s.heroId).join(',');
}

/** 点名武将能进哪些模板 */
export function templatesForHero(heroId: string, heroIds: string[], skillIds: readonly string[]): TeamTemplateId[] {
  return ALL_TEMPLATES.filter((id) => layoutsFor(id, heroIds, skillIds, heroId).layouts.length > 0);
}

/**
 * 骨架战法：每格用品级最高的 1 个，全队不重复。
 * 神赏拐位直接装上神兵天降 + 大赏三军。追击/自增伤的神赏大营先占一件先声或先驱，再加 1 个输出。
 * `pinnedSkillIds` 先占住，不再用别的战法把它填掉。`fillerSkip` 里的战法不拿来凑这 1 个。
 * 某一格一个可学战法都没有时返回 null（不能拿空战法去比武将）。
 */
export function skeletonSkills(layout: TeamLayout, pools: RolePools): string[][] | null {
  const taken = new Set<string>();
  const rows: string[][] = [];
  for (const slot of layout.slots) {
    if (slot.lockedSkillIds?.length) {
      for (const id of slot.lockedSkillIds) taken.add(id);
      rows.push([...slot.lockedSkillIds]);
      continue;
    }
    const skip = new Set(layout.fillerSkip ?? []);
    const pinned = (slot.pinnedSkillIds ?? []).filter((id) => !taken.has(id));
    const open = pools.skills[slot.skillKind].filter((id) => !taken.has(id));
    const preferred = open.filter((id) => !skip.has(id));
    const pool = preferred.length ? preferred : open;
    const picked: string[] = [...pinned];
    for (const id of pinned) taken.add(id);
    const openerCamp = layout.template === 'shenshang' && slot.position === '大营' && campNeedsOpener(slot.heroId) && picked.length < 2;
    if (openerCamp) {
      const opener = OPENERS.filter((id) => pool.includes(id)).sort(byGrade)[0];
      if (!opener && picked.length === 0) return null;
      if (opener && !picked.includes(opener)) {
        picked.unshift(opener);
        taken.add(opener);
      }
    }
    const target = picked.length > 0 ? Math.min(2, openerCamp ? 2 : picked.length) : 1;
    for (const id of pool) {
      if (picked.length >= target) break;
      if (picked.includes(id)) continue;
      picked.push(id);
      taken.add(id);
    }
    if (!picked.length) return null;
    rows.push(picked);
  }
  return rows;
}
