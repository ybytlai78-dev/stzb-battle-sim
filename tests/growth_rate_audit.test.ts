import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { BattleEvent, General, Skill } from '../src/engine/types';

/**
 * 成长率审计（2026-10-23，始计报障后系统排查）：
 *
 * 引擎的缩放分支（`executeSkillOutputs` / `scaleDirectStatus`）普遍要求三条件齐备：
 *   `type` 匹配 + `xxxScaled === true` + **`growthRate !== undefined`**
 * 缺成长率 ⇒ 落 else 用基值 ⇒ 数值恒定、不随属性增长（报障同型）。
 *
 * 本文件守两件事：
 *   ① 数据守卫：任何声明了受属性缩放的段都必须带 `growthRate`（缺口归零，防回归）；
 *   ② 行为守卫：抽样战法在真实战斗里数值确实随属性增长（不是只写在数据里）。
 *
 * 数值口径（客户端 `tb_cfg_skill_detail` 反解，见 `docs/成长率反推规律速查.md`）：
 *   值@80 = const + 0.4 × intel；**百分比类**（rate 小数）成长 = intel/200（百分点/点属性）；
 *   **点数类**（amount 点）成长 = intel/20000（点/点属性）。
 */

const SCALED_KEYS = [
  'strategyScaled',
  'speedScaled',
  'defenseScaled',
  'attackScaled',
  'rateStrategyScaled',
  'rateAttackScaled',
  'chainScaled',
  'reduceDefenseScaled',
  'boostAttackScaled',
] as const;

type Missing = { skill: string; at: string; scaled: string; type: string };

/** 递归收集「声明了缩放却缺 growthRate」的段（与缩放分支的判定条件一致） */
function collectMissing(node: Skill | unknown, skillName: string, at = 'skill'): Missing[] {
  const missing: Missing[] = [];
  const walk = (n: unknown, path: string, depth: number): void => {
    if (depth > 8 || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }
    const obj = n as Record<string, unknown>;
    const scaled = SCALED_KEYS.filter((k) => obj[k] === true);
    if (scaled.length > 0 && typeof obj.type === 'string' && obj.growthRate === undefined) {
      missing.push({ skill: skillName, at: path, scaled: scaled.join('+'), type: String(obj.type) });
    }
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`, depth + 1);
  };
  walk(node, at, 0);
  return missing;
}

describe('成长率审计：受属性缩放的段不得缺 growthRate', () => {
  it('全库无缺口（缺 growthRate 会让数值恒定不随属性增长）', () => {
    const missing = Object.values(SKILL_REGISTRY).flatMap((s) => collectMissing(s, s.name));
    expect(missing).toEqual([]);
  });

  it('自证：注入一个缺 growthRate 的缩放段能被抓出来', () => {
    const fake = {
      id: 'fake',
      name: '假战法',
      type: 'passive',
      triggerRate: 1,
      timing: 'battle_start',
      range: 5,
      targetMode: 'self',
      tags: [],
      output: [
        {
          kind: 'inflict_status',
          status: { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused', strategyScaled: true },
        },
      ],
    };
    expect(collectMissing(fake, '假战法')).toHaveLength(1);
  });

  it('恃强淬锋 selfPhysBoost 也走同一套缩放（attackScaled 必须带 growthRate）', () => {
    const skill = SKILL_REGISTRY.shiqiang_cuifeng as Extract<Skill, { type: 'passive' }>;
    expect(skill.selfPhysBoost?.attackScaled).toBe(true);
    // 包内子战法 21029902：const 3 + intel 1 ⇒ 3.4%、成长 1/200
    expect(skill.selfPhysBoost?.growthRate).toBe(0.005);
  });

  it('激水之疾的谋略 −20 包内 intel 0 ⇒ 固定值，不带缩放标记', () => {
    const skill = SKILL_REGISTRY.jishui_zhiji as Extract<Skill, { type: 'active' }>;
    const branch = skill.output.find((o) => o.kind === 'morale_branch') as unknown as {
      low: { status: Record<string, unknown> }[];
    };
    expect(branch.low[0].status).toMatchObject({ type: 'strategy_buff', amount: -20 });
    expect(branch.low[0].status.strategyScaled).toBeUndefined();
    expect(branch.low[0].status.growthRate).toBeUndefined();
  });

  it('包内反解的成长率与基值自洽（值@80 = const + 0.4×intel，成长 = intel/200）', () => {
    const statusOf = (id: string, idx: number) =>
      (SKILL_REGISTRY[id].output[idx] as unknown as { status: { rate: number; growthRate?: number } }).status;
    const cases: [string, { rate: number; growthRate?: number }, number, number][] = [
      ['fengshi', statusOf('fengshi', 1), 10, 20],
      ['fangyuan', statusOf('fangyuan', 1), 10, 17],
      ['wanjian_qifa', statusOf('wanjian_qifa', 1), 36, 35],
    ];
    for (const [, seg, c, i] of cases) {
      const value80 = (c + 0.4 * i) / 100;
      expect(Math.abs(Math.abs(seg.rate) - value80)).toBeLessThanOrEqual(0.001);
      expect(seg.growthRate).toBeCloseTo(i / 200, 10);
    }
  });

  it('点数类成长按 intel/20000（道行险阻 6000、地公将军 3500）', () => {
    const dx = SKILL_REGISTRY.daoxing_xianzu.output as unknown as { status: { amount: number; growthRate?: number } }[];
    expect(dx[0].status).toMatchObject({ type: 'defense_buff', amount: -50, growthRate: 0.3 });
    expect(dx[1].status).toMatchObject({ type: 'strategy_buff', amount: -50, growthRate: 0.3 });

    const dg = SKILL_REGISTRY.digong_jiangjun.output as unknown as {
      status?: { amount: number; growthRate?: number }[];
    }[];
    const gained = dg.flatMap((o) => (Array.isArray(o.status) ? o.status : [])).filter((st) => st.amount === 24);
    expect(gained).toHaveLength(4); // ③友军 2 条 + ④自身 2 条
    for (const st of gained) expect(st.growthRate).toBe(0.175);
  });

  it('守静却敌 onHeal 增伤段成长 0.05（包内 const 6 + intel 10 ⇒ 10%）', () => {
    const skill = SKILL_REGISTRY.shoujing_quedi as unknown as {
      onHeal: { output: { status: { rate: number; growthRate?: number } }[] };
    };
    expect(skill.onHeal.output[0].status).toMatchObject({ type: 'damage_boost', rate: 0.1, growthRate: 0.05 });
  });
});

// ─── 行为守卫：真实战斗里数值随属性增长 ───

type AttrKey = 'speed' | 'defense' | 'attack' | 'strategy';

function gen(p: Partial<General> & { id: string; position: General['position'] }): General {
  return {
    name: p.id,
    rarity: '5星',
    cost: 3,
    faction: '蜀',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    attack: 120,
    defense: 120,
    strategy: 100,
    speed: 50,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...p,
  };
}

/** 跑一场，取出「造成的伤害提高 N%」里的 N（同场多条取最大） */
function boostPercents(
  attr: AttrKey,
  value: number,
  field: 'commandSkillIds' | 'activeSkillIds',
  skillId: string,
  troop: General['troopType'],
  dir: '提高' | '降低' = '提高'
): number[] {
  const boost = { [attr]: value } as Partial<General>;
  const me = gen({ id: 'a1', position: '前锋', troopType: troop, ...boost, [field]: [skillId] });
  const mates = ([0, 1] as const).map((i) =>
    gen({ id: 'a' + (i + 2), position: (['中军', '大营'] as const)[i], troopType: troop })
  );
  const foe = ([0, 1, 2] as const).map((i) =>
    gen({ id: 'e' + i, position: (['前锋', '中军', '大营'] as const)[i], attack: 100, defense: 100, speed: 40 })
  );
  const events: BattleEvent[] = runBattle({ myTeam: [me, ...mates], enemyTeam: foe, seed: 5, maxRounds: 4 }).events;
  const out: number[] = [];
  for (const e of events) {
    if (e.type !== 'status_inflicted') continue;
    const d = (e as { detail?: string }).detail ?? '';
    const m = new RegExp('伤害' + dir + ' ([0-9]+)%').exec(d);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : NaN);

describe('成长率行为守卫：数值随属性增长', () => {
  it('锋矢（受速度，18% + 0.10/点）：速度 60 < 200 < 300 三档递增', () => {
    const low = maxOf(boostPercents('speed', 60, 'commandSkillIds', 'fengshi', 'cavalry'));
    const mid = maxOf(boostPercents('speed', 200, 'commandSkillIds', 'fengshi', 'cavalry'));
    const high = maxOf(boostPercents('speed', 300, 'commandSkillIds', 'fengshi', 'cavalry'));
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    // 300 速度：18 + 0.1×(300−80) = 40，允许有效属性（兵种/加成）带来的 ±10 浮动
    expect(Math.abs(high - 40)).toBeLessThanOrEqual(10);
  });

  it('方圆（受防御，16.8% + 0.085/点）：防御 60 < 200 < 300 三档递增', () => {
    const low = maxOf(boostPercents('defense', 60, 'commandSkillIds', 'fangyuan', 'infantry'));
    const mid = maxOf(boostPercents('defense', 200, 'commandSkillIds', 'fangyuan', 'infantry'));
    const high = maxOf(boostPercents('defense', 300, 'commandSkillIds', 'fangyuan', 'infantry'));
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    // 300 防御：16.8 + 0.085×(300−80) = 35.5
    expect(Math.abs(high - 35.5)).toBeLessThanOrEqual(10);
  });

  it('万箭齐发（受攻击，50% + 0.175/点）：攻击 60 < 200 递增', () => {
    const low = maxOf(boostPercents('attack', 60, 'activeSkillIds', 'wanjian_qifa', 'archer', '降低'));
    const high = maxOf(boostPercents('attack', 200, 'activeSkillIds', 'wanjian_qifa', 'archer', '降低'));
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });
});

// ─── 反向守卫：官方文案声称受属性影响 ⇒ 数据必须挂成长率 ───

import { readFileSync } from 'node:fs';

const DESC: Record<string, { name: string; desc: string; desc1: string }> = JSON.parse(
  readFileSync(new URL('../web/data/skill_desc.json', import.meta.url), 'utf8')
);
const CLAIM = /受(攻击|谋略|防御|速度)属性影响/;

/** 任意层级的缩放标记或成长率字段（含 healGrowthRate / ignoreStrategyGrowthRate 这类别名） */
function hasGrowth(node: unknown, depth = 0): boolean {
  if (depth > 8 || node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((v) => hasGrowth(v, depth + 1));
  const obj = node as Record<string, unknown>;
  if (SCALED_KEYS.some((k) => obj[k] === true)) return true;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && /Growth(Rate)?$/i.test(k)) return true;
  }
  return Object.values(obj).some((v) => hasGrowth(v, depth + 1));
}

describe('反向守卫：文案声称受属性影响却整段没挂成长率', () => {
  it('全库无缺口（查文案 × 数据的错位，报障同型）', () => {
    const byName = new Map(Object.values(SKILL_REGISTRY).map((s) => [s.name, s]));
    const missing: string[] = [];
    for (const entry of Object.values(DESC)) {
      const text = `${entry.desc ?? ''} ${entry.desc1 ?? ''}`;
      const m = CLAIM.exec(text);
      if (!m) continue;
      const skill = byName.get(entry.name);
      if (!skill) continue; // 未实现的战法不在 SKILL_REGISTRY
      if (!hasGrowth(skill)) missing.push(`${entry.name}（${skill.id}，声称受${m[1]}影响）`);
    }
    expect(missing).toEqual([]);
  });

  it('历史报障的 9 个战法都已挂成长率（包内 const/intel 反解）', () => {
    const expectGrowth: [string, number][] = [
      ['lingming_fuchen', 0.175], // 令明负榇 分兵伤害率 受速度（20083701 const 36 + intel 35）
      ['nimou', 0.1], // 逆谋 减伤 受攻击（20000902/03 const 22 + intel 20）
      ['dingjun_yangwei', 0.175], // 定军扬威 减伤 受防御（20068023 const 11 + intel 35）
      ['guoshi_wushuang', 0.15], // 国士无双 增伤 受攻击（20086403 const 13 + intel 30）
      ['jieduan', 0.1], // 截断 增伤 受速度（20069801 const 5 + intel 20）
      ['judun', 0.125], // 拒盾 减伤 受防御（20069501/02 const 5 + intel 25）
      ['pojin', 0.125], // 迫近 增伤 受防御（20069601 const 5 + intel 25）
      ['tuibi', 0.15], // 退避 减伤 受速度（20069701/02 const 6 + intel 30）
      ['nanzhi_ruyin', 0.15], // 难知如阴 跳过准备几率 受速度（21082803 const 48 + intel 30）
    ];
    for (const [id, growth] of expectGrowth) {
      const skill = SKILL_REGISTRY[id];
      expect(skill, id).toBeTruthy();
      expect(collectMissing(skill, skill.name), id).toEqual([]);
      expect(JSON.stringify(skill)).toContain(`"growthRate":${growth}`);
    }
  });
});

// ─── 反向行为守卫：补齐后数值确实随属性增长 ───

/** 跑一场，收集指定状态类型的 detail（去掉持续时间尾巴、去重） */
function statusDetails(
  attr: AttrKey,
  value: number,
  field: 'commandSkillIds' | 'activeSkillIds',
  skillId: string,
  troop: General['troopType'],
  statusType: string
): string[] {
  const boost = { [attr]: value } as Partial<General>;
  const me = gen({ id: 'a1', position: '前锋', troopType: troop, ...boost, [field]: [skillId] });
  const mates = ([0, 1] as const).map((i) =>
    gen({ id: 'a' + (i + 2), position: (['中军', '大营'] as const)[i], troopType: troop })
  );
  const foe = ([0, 1, 2] as const).map((i) =>
    gen({ id: 'e' + i, position: (['前锋', '中军', '大营'] as const)[i], attack: 100, defense: 100, speed: 40 })
  );
  const events: BattleEvent[] = runBattle({ myTeam: [me, ...mates], enemyTeam: foe, seed: 5, maxRounds: 4 }).events;
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== 'status_inflicted') continue;
    const ev = e as { statusType?: string; detail?: string };
    if (ev.statusType !== statusType) continue;
    out.add((ev.detail ?? '').split(' 持续')[0]);
  }
  return [...out];
}

/** 从 detail 里取最后一个数字（分兵 47% / 减伤 0.16 / 跳过准备 56%） */
const lastNum = (texts: string[]) => {
  const nums = texts.map((t) => Number(/([0-9]+(?:\.[0-9]+)?)%?$/.exec(t)?.[1]));
  return nums.length ? Math.max(...nums) : NaN;
};

describe('反向行为守卫：补齐成长率后随属性增长', () => {
  it('令明负榇（分兵伤害率受速度 50% + 0.175/点）：60 < 200 < 300 递增', () => {
    const at = (v: number) =>
      lastNum(statusDetails('speed', v, 'commandSkillIds', 'lingming_fuchen', 'cavalry', 'split'));
    const low = at(60);
    const mid = at(200);
    const high = at(300);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeGreaterThanOrEqual(90); // 300 速度：有效速度更高，50 + 0.175×(eff−80) ≈ 99
  });

  it('退避（减伤受速度 18% + 0.15/点）：60 < 200 < 300 递增', () => {
    const at = (v: number) => lastNum(statusDetails('speed', v, 'activeSkillIds', 'tuibi', 'infantry', 'damage_reduce'));
    const low = at(60);
    const mid = at(200);
    const high = at(300);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('难知如阴（跳过准备几率受速度 60% + 0.15/点）：60 < 200，且封顶 100%', () => {
    const at = (v: number) =>
      lastNum(statusDetails('speed', v, 'commandSkillIds', 'nanzhi_ruyin', 'cavalry', 'jump_prep'));
    const low = at(60);
    const mid = at(200);
    const high = at(300);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
  });
});
