/**
 * 推演模拟 · 镜头归并（纯函数，无 DOM）
 * ---------------------------------------------------------------------------
 * 把一次 `runBattle` 产生的事件流整理成「镜头」（shot）：一镜只讲一件事 ——
 * 谁、用什么、打谁、多少、这次的增减伤从哪来；恢复与状态也各自归到镜头里。
 *
 * 口径（与 `design-sets/a2-playback.html` 已验收的播片版一致，见 `docs/推演模拟-落地设计.md`）：
 *  · 失败的 `skill_trigger` 不进播片（否则一半镜头是「没发动」）；
 *  · `attack_hit` 自成镜（普攻没有战法名）；
 *  · `heal` 落在**当前镜**（受击触发的急救跟着伤害镜走），当前镜为空才自开一镜；
 *  · `status_inflicted` 若当前镜为空、但与上一镜同回合同施法者且上一镜无伤害 → 并入上一镜；
 *  · 每个镜头带 `troops` / `wounded` / `dead` 快照 —— **跳镜时直接回填**，
 *    不能用终局值（否则第 1 回合就显示残血，跳镜后数字与条形对不上）。
 *
 * 不依赖 `web/heroes.ts`（立绘解析在 `units.ts`），因此可在 node 环境直接单测。
 */
import { SKILL_REGISTRY } from '../../src/data/skills';
import type {
  BattleEvent,
  BattleReport,
  DamageModifierSource,
  DamageModifiers,
  Position,
  SkillType,
  StatusType,
} from '../../src/engine/types';

export type Side = 'my' | 'enemy';
export type HitKind = 'attack' | 'damage' | 'dot' | 'split';

/** 增减伤归因（引擎 `DamageModifiers`，与战报弹窗同一份数据） */
export interface Mods {
  /** 造成伤害的增伤合计（0.99 = +99%） */
  caused?: number;
  /** 受到伤害的增伤合计 */
  taken?: number;
  /** 逐条减伤来源 */
  reduce?: { n: string; r: number }[];
  /** 造成侧增伤的来源战法名（最多 2 个，用于 chip 上标注） */
  causedFrom?: string[];
  /** 受到侧增伤的来源战法名（最多 2 个） */
  takenFrom?: string[];
}

export interface Breakdown {
  troopBase: number;
  base: number;
  main: number;
}

export interface PlaybackHit {
  to: string;
  kind: HitKind;
  amount: number;
  skillId?: string;
  /** 战法名（普攻为 undefined） */
  skill?: string;
  /** 伤害类型（attack / damage 时给） */
  type?: 'physical' | 'strategy';
  /** 普攻距离 */
  dist?: number;
  mods?: Mods;
  bd?: Breakdown;
  /** 本次结算后目标剩余兵力 */
  after?: number;
}

export interface PlaybackHeal {
  to: string;
  amount: number;
  /** 必须取 heal 事件自己的战法名（§ 已知坑：否则会错标成当前镜的战法） */
  skill?: string;
  before?: number;
  after?: number;
}

export interface PlaybackStatus {
  to: string;
  st: StatusType;
  detail?: string;
  skill?: string;
}

export interface PlaybackShot {
  /** 0-based 序号 */
  i: number;
  round: number;
  /** 施法者 unitId */
  actor: string | null;
  /** 战法名（普攻 / 分兵 / 持续伤害为 null） */
  skill: string | null;
  /** 战法类型 */
  type: SkillType | null;
  hits: PlaybackHit[];
  heals: PlaybackHeal[];
  statuses: PlaybackStatus[];
  /** 该镜结束时六将兵力 */
  troops: Record<string, number>;
  /** 该镜时点的伤兵池（可恢复损失） */
  wounded: Record<string, number>;
  /** 该镜时点的累计阵亡（永久损失） */
  dead: Record<string, number>;
  /** 关键镜 */
  key: boolean;
  /** 本回合行动顺序（`round_start.turnOrder`，缺失时不渲染） */
  order?: string[];
}

export interface PlaybackUnit {
  id: string;
  name: string;
  side: Side;
  position: Position;
  faction: string;
  troopType: string;
  maxTroops: number;
  redness?: number;
  level?: number;
}

export interface BeatifyResult {
  shots: PlaybackShot[];
  units: PlaybackUnit[];
  /** 关键镜数量 */
  keyCount: number;
  /** 战法类型统计（顶栏/调试用） */
  totals: { hits: number; heals: number; statuses: number };
}

/* ────────────────────────── 文案 ────────────────────────── */

export const TYPE_CN: Record<string, string> = {
  active: '主动',
  prepared: '主动',
  command: '指挥',
  passive: '被动',
  pursuit: '追击',
  status: '状态',
  attack: '普攻',
  dot: '持续',
  split: '分兵',
  heal: '恢复',
};

export const KIND_CN: Record<HitKind, string> = {
  attack: '攻击伤害',
  damage: '战法伤害',
  dot: '持续伤害',
  split: '分兵伤害',
};

/** 状态 → 一行短文案（优先用引擎 detail，缺省给类型名） */
const STATUS_CN: Partial<Record<StatusType, string>> = {
  confusion: '混乱',
  taunt: '挑衅',
  hesitation: '犹豫',
  unrest: '动摇',
  cowardice: '怯战',
  siege: '围困',
  insight: '洞察',
  combo: '连击',
  split: '分兵',
  evasion: '规避',
  cover: '援护',
  burning: '燃烧',
  panic: '恐慌',
  curse: '妖术诅咒',
  ignite: '引燃',
  first_aid: '急救',
  heal_boost: '受到恢复提升',
  damage_reduce: '减伤',
  damage_boost: '增伤',
  ignore_def: '无视防御',
  ignore_evasion: '无视规避',
  attack_buff: '攻击提升',
  defense_buff: '防御提升',
  strategy_buff: '谋略提升',
  speed_buff: '速度提升',
  range_buff: '距离提升',
  trigger_boost: '触发提升',
};

/** 状态的短名（档案 chips / 图例用，不带数值） */
export function statusName(st: StatusType): string {
  return STATUS_CN[st] ?? st;
}

export interface StatusLabel {
  /** 展示文本 */
  t: string;
  /** 语义色：heal 绿 / buff 金 / debuff 红 / state 蓝 */
  c: 'heal' | 'buff' | 'debuff' | 'state';
}

/**
 * 状态文案：`规避 +1 层`、`动摇 125%`、`减伤 5%`、`造成的伤害提高 40%`。
 * 引擎 detail 本身已本地化，能直接读就用；读不到（或太长）回退到类型名。
 */
export function statusLabel(st: StatusType, detail?: string): StatusLabel {
  const raw = (detail ?? '').trim();
  const base = STATUS_CN[st] ?? raw.slice(0, 8) ?? '效果';
  const color: StatusLabel['c'] =
    st === 'first_aid' || st === 'heal_boost'
      ? 'heal'
      : st === 'damage_reduce' || st === 'evasion' || st === 'insight' || st === 'cover'
        ? 'buff'
        : ['confusion', 'taunt', 'hesitation', 'unrest', 'cowardice', 'siege', 'burning', 'panic', 'curse', 'ignite'].includes(st)
          ? 'debuff'
          : 'state';

  // detail 里的百分比：有 % 用原值；纯小数（0.05）按 ×100 转百分比。
  const pct = (num: string): string => {
    const v = Number(num);
    if (!Number.isFinite(v)) return num;
    return (v > 0 && v < 1 ? Math.round(v * 100) : Math.round(v)) + '%';
  };

  if (!raw) return { t: base, c: color };

  // 百分比类：把 detail 里的 0.05 变成 5%
  if (st === 'damage_reduce' || st === 'heal_boost') {
    // 「大幅度降低」类（引擎 detail = 「受到…伤害大幅降低 持续 N 回合」，账面是 1000% 哨兵）：
    // 不能把后面的「N 回合」当百分比，直接给一句中文
    if (raw.includes('大幅')) return { t: st === 'damage_reduce' ? '大幅减伤' : '受到恢复大幅提升', c: color };
    const m = raw.match(/(-?\d+(?:\.\d+)?)/);
    if (m) return { t: `${st === 'damage_reduce' ? '减伤' : '受到恢复'} ${pct(m[1])}`, c: color };
  }

  // detail 本身够短就直接用（如「规避 +1 层」「连击 1 回合」「动摇 125% 普攻触发」）
  const t = raw.length <= 14 ? raw : raw.slice(0, 14) + '…';
  return { t, c: color };
}

/** 镜头标题：有战法用战法名；普攻 / 分兵 / 持续 / 纯状态各自一套 */
export function shotTitle(shot: PlaybackShot): string {
  if (shot.skill) return shot.skill;
  if (shot.hits.length) {
    const k = shot.hits[0].kind;
    if (k === 'attack') return '普通攻击';
    if (k === 'split') return '分兵';
    if (k === 'dot') return shot.hits[0].skill ?? '持续伤害';
  }
  if (shot.heals.length) return shot.heals[0].skill ?? '恢复';
  if (shot.statuses.length) {
    // 同一镜里可能同时挂多条状态（战前宝物 / 兵种 / 被动）：同源取战法名，多源就叫「状态」
    const names = Array.from(new Set(shot.statuses.map((st) => st.skill).filter(Boolean))) as string[];
    if (shot.statuses.length > 1) return names.length === 1 ? names[0] : '状态';
    return names[0] ?? statusLabel(shot.statuses[0].st, shot.statuses[0].detail).t;
  }
  return '—';
}

/** 镜头类型徽标 */
export function shotBadge(shot: PlaybackShot): string {
  if (shot.type) return TYPE_CN[shot.type] ?? '战法';
  if (shot.hits.length) return TYPE_CN[shot.hits[0].kind] ?? '伤害';
  if (shot.heals.length) return '恢复';
  return '状态';
}

export interface ModChip {
  /** `增伤` / `承伤` / `减伤` */
  label: string;
  /** 带符号的百分比文本，如 `+99%` / `−12%` */
  value: string;
  dir: 'up' | 'dn' | 'taken';
  /** 来源名 */
  name: string;
}

/** 该次命中的增减伤来源（数字下方 / 底部横条共用） */
export function modChips(hit: PlaybackHit, max = 5): ModChip[] {
  const out: ModChip[] = [];
  const m = hit.mods;
  if (!m) return out;
  if (m.caused) {
    out.push({ label: '增伤', value: signed(m.caused), dir: m.caused > 0 ? 'up' : 'dn', name: (m.causedFrom ?? []).join(' · ') || '造成伤害修正' });
  }
  if (m.taken) {
    out.push({ label: '承伤', value: signed(m.taken), dir: 'taken', name: (m.takenFrom ?? []).join(' · ') || '受到伤害修正' });
  }
  for (const r of m.reduce ?? []) {
    out.push({ label: '减伤', value: signed(-Math.abs(r.r)), dir: 'dn', name: r.n });
  }
  return out.slice(0, max);
}

function signed(v: number): string {
  const pct = Math.round(Math.abs(v) * 100);
  return `${v < 0 ? '−' : '+'}${pct}%`;
}

/* ────────────────────────── 归并 ────────────────────────── */

/** 来源名洗白：宝物 / 陈寿特性在引擎里以 `treasure:` / `chenshou:` 前缀出现 */
function prettySource(name: string): string {
  if (!name) return '效果';
  if (name.startsWith('treasure:')) return '宝物';
  if (name.startsWith('chenshou:')) return '陈寿特性';
  return name;
}

/** 引擎 `DamageModifiers`（逐来源数组）→ 展示用（合计数 + 减伤来源清单） */
function toMods(src: DamageModifiers | undefined): Mods | undefined {
  if (!src) return undefined;
  const sum = (list: DamageModifierSource[] | undefined): number =>
    (list ?? []).reduce((a, x) => a + x.rate, 0);
  const caused = sum(src.caused);
  const taken = sum(src.taken);
  const reduce = (src.reduce ?? []).map((x) => ({ n: prettySource(x.skillName), r: x.rate }));
  const names = (list: DamageModifierSource[] | undefined): string[] =>
    Array.from(new Set((list ?? []).map((x) => prettySource(x.skillName)))).slice(0, 2);
  if (!caused && !taken && reduce.length === 0) return undefined;
  return { caused, taken, reduce, causedFrom: names(src.caused), takenFrom: names(src.taken) };
}

function skillTypeOf(id: string | undefined): SkillType | null {
  if (!id) return null;
  const s = SKILL_REGISTRY[id];
  return (s?.type as SkillType | undefined) ?? null;
}

function skillNameOf(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return SKILL_REGISTRY[id]?.name;
}

/** 关键镜判据：大伤害 / 大治疗 / 控制 / 多目标 */
const CONTROL: StatusType[] = ['confusion', 'taunt', 'hesitation', 'unrest', 'siege', 'curse', 'panic', 'burning'];

export function beatify(report: BattleReport): BeatifyResult {
  const units: PlaybackUnit[] = [
    ...report.myTeam.map((g) => unitOf(g, 'my')),
    ...report.enemyTeam.map((g) => unitOf(g, 'enemy')),
  ];

  const troops: Record<string, number> = {};
  const wounded: Record<string, number> = {};
  const dead: Record<string, number> = {};
  for (const u of units) {
    troops[u.id] = u.maxTroops;
    wounded[u.id] = 0;
    dead[u.id] = 0;
  }

  const shots: PlaybackShot[] = [];
  // 包一层对象持有当前镜：`cur` 若用裸 let，TS 跨函数调用会把它窄化成 null，
  // 后面 `cur.actor` 就报「不存在于 never」。用对象属性读写可以让控制流分析失效。
  const st: { cur: PlaybackShot | null } = { cur: null };
  let round = 1;
  let curOrder: string[] = [];
  let lastActor: string | null = null;

  const snap = (): PlaybackShot['troops'] => ({ ...troops });

  const push = (): void => {
    const cur = st.cur;
    if (!cur) return;
    if (!cur.hits.length && !cur.heals.length && !cur.statuses.length) {
      st.cur = null;
      return;
    }
    cur.troops = snap();
    cur.wounded = { ...wounded };
    cur.dead = { ...dead };
    shots.push(cur);
    st.cur = null;
  };

  const open = (actor: string | null, skill: string | null, type: SkillType | null): PlaybackShot => {
    push();
    const next: PlaybackShot = {
      i: shots.length,
      round,
      actor,
      skill,
      type,
      hits: [],
      heals: [],
      statuses: [],
      troops: {},
      wounded: {},
      dead: {},
      key: false,
      order: curOrder.length ? [...curOrder] : undefined,
    };
    st.cur = next;
    return next;
  };

  const applyAfter = (id: string, after: number | undefined, fallbackLoss: number): void => {
    troops[id] = after ?? Math.max(0, (troops[id] ?? 0) - fallbackLoss);
  };

  for (const e of report.events as BattleEvent[]) {
    switch (e.type) {
      case 'round_start':
        push();
        round = e.round;
        curOrder = (e.turnOrder ?? []).slice();
        break;

      case 'unit_act_start':
        lastActor = e.unitId;
        break;

      case 'skill_trigger':
        if (!e.success) break;
        open(e.unitId, e.skillName, skillTypeOf(e.skillId));
        break;

      case 'skill_cast': {
        const c = st.cur;
        if (!(c && c.actor === e.unitId && c.skill === e.skillName)) {
          open(e.unitId, e.skillName, skillTypeOf(e.skillId));
        }
        break;
      }

      case 'attack_hit': {
        const c = st.cur;
        if (!(c && c.actor === e.sourceId && !c.skill)) open(e.sourceId, null, null);
        const s = st.cur as PlaybackShot;
        s.hits.push({
          to: e.targetId,
          kind: 'attack',
          amount: e.damage,
          dist: e.distance,
          mods: toMods(e.modifiers),
          bd: e.breakdown as Breakdown,
          after: e.afterTroops,
        });
        applyAfter(e.targetId, e.afterTroops, e.damage);
        break;
      }

      case 'damage': {
        const caster = e.creditToId ?? e.sourceId;
        if (!(st.cur && st.cur.actor === caster)) open(caster, e.skillName, skillTypeOf(e.skillId));
        const s = st.cur as PlaybackShot;
        s.hits.push({
          to: e.targetId,
          kind: 'damage',
          amount: e.damage,
          skillId: e.skillId,
          skill: e.skillName,
          type: e.damageType === 'strategy' ? 'strategy' : 'physical',
          mods: toMods(e.modifiers),
          bd: e.breakdown as Breakdown,
          after: e.afterTroops,
        });
        applyAfter(e.targetId, e.afterTroops, e.damage);
        break;
      }

      case 'dot_tick': {
        if (!(st.cur && st.cur.actor === e.casterId)) open(e.casterId, skillNameOf(e.skillId) ?? '持续伤害', null);
        const s = st.cur as PlaybackShot;
        s.hits.push({
          to: e.targetId,
          kind: 'dot',
          amount: e.damage,
          skillId: e.skillId,
          skill: skillNameOf(e.skillId),
          type: 'strategy',
          mods: toMods(e.modifiers),
          bd: e.breakdown as Breakdown,
          after: e.afterTroops,
        });
        applyAfter(e.targetId, e.afterTroops, e.damage);
        break;
      }

      case 'split_damage': {
        const caster = e.creditToId ?? e.sourceId;
        if (!(st.cur && st.cur.actor === caster)) open(caster, skillNameOf(e.skillId) ?? '分兵', null);
        const s = st.cur as PlaybackShot;
        s.hits.push({
          to: e.targetId,
          kind: 'split',
          amount: e.damage,
          skillId: e.skillId,
          skill: skillNameOf(e.skillId),
          type: 'physical',
          mods: toMods(e.modifiers),
          bd: e.breakdown as Breakdown,
          after: e.afterTroops,
        });
        applyAfter(e.targetId, e.afterTroops, e.damage);
        break;
      }

      case 'heal': {
        // 受击触发的急救跟着当前伤害镜走；没有当前镜才自开一镜
        if (!st.cur) open(e.sourceId, e.skillName, skillTypeOf(e.skillId));
        const s = st.cur as PlaybackShot;
        s.heals.push({ to: e.targetId, amount: e.amount, skill: e.skillName, before: e.before, after: e.after });
        troops[e.targetId] = e.after;
        break;
      }

      case 'status_inflicted': {
        const prev = shots[shots.length - 1];
        const mergeable = !st.cur && prev && prev.round === round && prev.actor === lastActor && !prev.hits.length;
        if (!st.cur && !mergeable) open(lastActor, null, null);
        const box = (st.cur ?? prev) as PlaybackShot;
        box.statuses.push({ to: e.unitId, st: e.statusType, detail: e.detail, skill: box.skill ?? undefined });
        break;
      }

      case 'round_end': {
        push();
        const mine = e.myTroops, foe = e.enemyTroops;
        report.myTeam.forEach((g, i) => {
          troops[g.id] = mine[i] ?? troops[g.id];
          wounded[g.id] = e.myWounded[i] ?? wounded[g.id];
          dead[g.id] = e.myDead[i] ?? dead[g.id];
        });
        report.enemyTeam.forEach((g, i) => {
          troops[g.id] = foe[i] ?? troops[g.id];
          wounded[g.id] = e.enemyWounded[i] ?? wounded[g.id];
          dead[g.id] = e.enemyDead[i] ?? dead[g.id];
        });
        break;
      }

      default:
        break;
    }
  }
  push();

  markKey(shots);

  return {
    shots,
    units,
    keyCount: shots.filter((s) => s.key).length,
    totals: {
      hits: shots.reduce((a, s) => a + s.hits.length, 0),
      heals: shots.reduce((a, s) => a + s.heals.length, 0),
      statuses: shots.reduce((a, s) => a + s.statuses.length, 0),
    },
  };
}

function unitOf(g: BattleReport['myTeam'][number], side: Side): PlaybackUnit {
  return {
    id: g.id,
    name: g.name,
    side,
    position: g.position,
    faction: g.faction,
    troopType: g.secondaryTroop ?? g.troopType,
    maxTroops: g.maxTroops,
    redness: g.redness,
    level: g.level,
  };
}

/** 关键镜判据（常数与文档 §4.5 一致；要调密度只动这里） */
export function markKey(shots: PlaybackShot[]): void {
  const peak = new Map<number, number>();
  for (const s of shots) {
    for (const h of s.hits) peak.set(s.round, Math.max(peak.get(s.round) ?? 0, h.amount));
  }
  for (const s of shots) {
    const th = Math.max(600, (peak.get(s.round) ?? 0) * 0.25);
    s.key =
      s.hits.some((h) => h.amount >= th) ||
      s.heals.some((h) => h.amount >= 600) ||
      s.statuses.some((x) => CONTROL.includes(x.st)) ||
      new Set(s.hits.map((h) => h.to)).size >= 2;
  }
}
