/**
 * 未雨绸缪（通用·主动 A）—— 再发动判定 + 机制 161「无视敌方属性」。
 *
 * 官方（包内 tb_cfg_skill 200301，9.2.2）：下回合开始后 2 回合内，自身下一次造成策略伤害的主动战法
 *   发动后可再次发动一次（跳过准备回合），造成原战法 50.0% 的伤害和恢复效果，
 *   该战法造成的伤害无视目标 30.0% 的谋略属性（受谋略属性影响）。
 *
 * 本文件守住两处用户报障（m01313）的回归：
 *  ① 再发动**必须递归识别策略伤害**——光武中兴的伤害在 `random_pick → combo_tag` 里、
 *     道行险阻在 `schedule_strike` 里，旧实现只看顶层，这两类永远不会再发动；
 *  ② 机制 161 既要在引擎里生效（目标谋略被折减），也要在事件流里可观测（`damage.ignoreStrategy`）。
 *  ③ 触发判定必须认得**子技能**与**谋略 DoT**（2026-10-22 报障：河内世泽 / 十常侍·乱政 / 连环计
 *     的谋略伤害都不在本战法自有输出段里，旧实现整类不触发）。
 */
import { describe, it, expect } from 'vitest';
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
import type { General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function general(id: string, position: Position, patch: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 90,
    defense: 80,
    strategy: 95,
    speed: 90,
    attackRange: 5,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 11): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 必发动的战法副本（去掉发动率对断言的影响） */
const sure = (id: string, patch: Partial<Skill> = {}): Skill =>
  ({ ...(SKILL_REGISTRY[id] as Skill), triggerRate: 1, ...patch }) as Skill;

/** 未雨绸缪给的标记：`repeat_strategy` duration 2 */
const marker = {
  type: 'repeat_strategy',
  duration: 2,
  remaining: 2,
  appliedRound: 0,
  sourceSkillType: 'passive',
  sourceSkillId: 'weiyu_choumou',
} as UnitState['statuses'][number];

function cast(ctx: CombatContext, caster: UnitState, skill: Skill) {
  triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
}

const casts = (ctx: CombatContext) => ctx.events.filter((e) => e.type === 'skill_cast');
const damages = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'damage') as Array<{
    damageType: string;
    damage: number;
    ignoreStrategy?: { pct: number };
  }>;

describe('未雨绸缪 · 数据口径', () => {
  it('战法面板：主动 · 距离 1 · 45% · 无准备 · 给自己挂 repeat_strategy(duration 2)', () => {
    const s = SKILL_REGISTRY.weiyu_choumou as Extract<Skill, { type: 'active' }>;
    expect(s.name).toBe('未雨绸缪');
    expect(s.type).toBe('active');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(1);
    expect(s.triggerRate).toBe(0.45);
    expect(s.targetMode).toBe('self');
    const st = s.output.find((o) => o.kind === 'inflict_status');
    expect(st?.kind).toBe('inflict_status');
    if (st?.kind !== 'inflict_status') return;
    expect(st.status).toMatchObject({ type: 'repeat_strategy', duration: 2 });
  });

  it('机制 161 的 X 落在战法配置上：recastRate 0.5 / 无视 30% / 成长 0.15 每点谋略', () => {
    const s = SKILL_REGISTRY.weiyu_choumou as Extract<Skill, { type: 'active' }>;
    expect(s.repeatStrategy).toEqual({
      recastRate: 0.5,
      ignoreStrategyPct: 30,
      ignoreStrategyGrowthRate: 0.15,
    });
  });
});

describe('未雨绸缪 · 再发动（报障 ①）', () => {
  it('顶层带策略伤害的主动战法：再发动一次', () => {
    const caster = unit(general('c1', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e1', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    expect(casts(ctx).map((e) => (e as { skillId: string }).skillId)).toEqual(['luolei', 'luolei']);
    expect(damages(ctx)).toHaveLength(2);
  });

  it('伤害藏在 random_pick → combo_tag 里（光武中兴）同样再发动', () => {
    const caster = unit(general('c2', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e2', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('guangwu_zhongxing'));
    expect(casts(ctx)).toHaveLength(2);
    const flag = casts(ctx)[1] as { recastBy?: string; recastRate?: number };
    expect(flag.recastBy).toBe('未雨绸缪');
    expect(flag.recastRate).toBe(0.5);
  });

  it('伤害藏在 schedule_strike 里（道行险阻）也算「造成策略伤害的战法」', () => {
    const caster = unit(general('c3', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e3', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('daoxing_xianzu'));
    // 延迟结算，本次行动没有伤害段，但「再次发动」必须已经发生
    expect(casts(ctx)).toHaveLength(2);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(false);
  });

  it('不含策略伤害的主动战法不再发动，标记保留', () => {
    const caster = unit(general('c4', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e4', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    // 只有攻击伤害的主动战法（复用落雷的外壳，换成 pure physical）
    const physicalOnly = sure('luolei', {
      output: [{ kind: 'physical_damage', rate: 100 }],
    } as Partial<Skill>);
    cast(ctx, caster, physicalOnly);
    expect(casts(ctx)).toHaveLength(1);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(true);
  });

  it('标记只消费一次：第三次发动不再追加', () => {
    const caster = unit(general('c5', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e5', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    cast(ctx, caster, sure('luolei'));
    expect(casts(ctx)).toHaveLength(3); // 第 1 次 2 发 + 第 2 次 1 发
  });

  it('未雨绸缪自己不会触发再发动', () => {
    const caster = unit(general('c6', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e6', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('weiyu_choumou'));
    expect(casts(ctx)).toHaveLength(1);
  });
});

describe('未雨绸缪 · 机制 161 无视敌方属性（报障 ②）', () => {
  it('本次发动与再次发动都带 ignoreStrategy：30% + 0.15/点谋略（谋略 95 → 32%）', () => {
    const caster = unit(general('c7', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e7', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    const [first, second] = damages(ctx);
    expect(first.ignoreStrategy?.pct).toBe(32);
    expect(second.ignoreStrategy?.pct).toBe(32);
  });

  it('两趟各持一份、不叠加：同一次发动最多 2 段，且比例恒为配置值（不是 32+32=64）', () => {
    const caster = unit(general('c7b', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e7b', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    const list = damages(ctx);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.ignoreStrategy?.pct)).toEqual([32, 32]);
    // 标记已被一次性消费：后续发动不带 ignore
    cast(ctx, caster, sure('luolei'));
    expect(damages(ctx)).toHaveLength(3);
    expect(damages(ctx)[2].ignoreStrategy).toBeUndefined();
  });

  it('两份同型标记只触发一次再发动（标记一次性全清，不叠加）', () => {
    const caster = unit(general('c7c', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e7c', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker }, { ...marker });
    cast(ctx, caster, sure('luolei'));
    expect(casts(ctx)).toHaveLength(2);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(false);
  });

  it('无标记时不注入：普通策略主动战法照原样结算（不影响其它战法）', () => {
    const caster = unit(general('c7d', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e7d', '中军'), 'enemy')]);
    cast(ctx, caster, sure('luolei'));
    expect(damages(ctx)).toHaveLength(1);
    expect(damages(ctx)[0].ignoreStrategy).toBeUndefined();
  });

  it('标记在身但本战法不含策略伤害：不注入、不再发动、标记保留', () => {
    const caster = unit(general('c7e', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e7e', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    const physicalOnly = sure('luolei', {
      output: [{ kind: 'physical_damage', rate: 100 }],
    } as Partial<Skill>);
    cast(ctx, caster, physicalOnly);
    expect(casts(ctx)).toHaveLength(1);
    expect((ctx.events.find((e) => e.type === 'damage') as { ignoreStrategy?: unknown })?.ignoreStrategy).toBeUndefined();
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(true);
  });

  it('X 取自战法配置：把 repeatStrategy 改成 40% / 0.2 → 谋略 95 时 43%', () => {
    const caster = unit(general('c7f', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e7f', '中军'), 'enemy')]);
    const base = SKILL_REGISTRY.weiyu_choumou as Skill;
    ctx.skills.set('weiyu_choumou', {
      ...base,
      repeatStrategy: { recastRate: 0.5, ignoreStrategyPct: 40, ignoreStrategyGrowthRate: 0.2 },
    } as Skill);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    expect(damages(ctx).map((d) => d.ignoreStrategy?.pct)).toEqual([43, 43]);
  });

  it('谋略越高折减越多：谋略 200 → 30 + 0.15×120 = 48%', () => {
    const caster = unit(general('c8', '中军', { strategy: 200 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e8', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    expect(damages(ctx)[0].ignoreStrategy?.pct).toBe(48);
    expect(damages(ctx)[1].ignoreStrategy?.pct).toBe(48);
  });

  it('机制生效：同一发策略伤害，挂 ignoreStrategy 的比不挂的打得多', () => {
    const plain: SkillOutput = { kind: 'strategy_damage', rate: 200, strategyScaled: false };
    const ignoring: SkillOutput = {
      kind: 'strategy_damage',
      rate: 200,
      strategyScaled: false,
      ignoreStrategyPct: 30,
      ignoreStrategyGrowthRate: 0.15,
    };
    const base = SKILL_REGISTRY.luolei as Extract<Skill, { type: 'active' }>;
    const run = (output: SkillOutput[]) => {
      const caster = unit(general('c9', '中军', { strategy: 95 }), 'my');
      const ctx = makeCtx([caster], [unit(general('e9', '中军', { strategy: 200 }), 'enemy')]);
      cast(ctx, caster, { ...base, triggerRate: 1, output } as Skill);
      return damages(ctx)[0];
    };
    const a = run([plain]);
    const b = run([ignoring]);
    expect(a.ignoreStrategy).toBeUndefined();
    expect(b.ignoreStrategy?.pct).toBe(32);
    expect(b.damage).toBeGreaterThan(a.damage);
  });

  it('再发动按 50% 结算：第二次伤害低于第一次', () => {
    const caster = unit(general('c10', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e10', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    const [first, second] = damages(ctx);
    expect(second.damage).toBeLessThan(first.damage);
  });

  it('策略伤害挂在钩子容器里（heal.onHealCast）也注入：本次与再次发动都带、无标记时不带', () => {
    // 光武中兴的 6 段策略伤害就在 `output[i].onHealCast.outputs` 里（治疗结算时判定子战法），
    // 钩子容器本身没有 `kind`，只按 kind 递归会整块跳过 —— 这条守住「结构递归下钻」。
    const hooked: SkillOutput = {
      kind: 'heal',
      rate: 100,
      targetSide: 'ally',
      targetPick: 'lowest_troops_ally',
      onHealCast: { chance: 1, outputs: [{ kind: 'strategy_damage', rate: 100 }] },
    } as SkillOutput;
    const run = (withMarker: boolean) => {
      const caster = unit(general('c11', '中军', { strategy: 95 }), 'my');
      caster.troops = 5000; // 兵力缺口 → 治疗量 > 0 → 钩子必然触发
      const ctx = makeCtx([caster], [unit(general('e11', '中军'), 'enemy')]);
      if (withMarker) caster.statuses.push({ ...marker });
      cast(ctx, caster, sure('luolei', { output: [hooked] } as Partial<Skill>));
      return damages(ctx);
    };
    const withMarker = run(true);
    // 首次发动 + 再次发动各触发一次钩子
    expect(withMarker).toHaveLength(2);
    expect(withMarker.map((d) => d.ignoreStrategy?.pct)).toEqual([32, 32]);
    expect(run(false).map((d) => d.ignoreStrategy?.pct)).toEqual([undefined]);
  });
});

/**
 * 用户 2026-10-22 报障（子技能造成谋略伤害不触发）：
 * 「部分战法自身不直接造成谋略伤害，而是依赖**子技能**去造成谋略伤害（十常侍主战法、河内世泽），
 *   按预期子技能造成谋略伤害时应当能触发未雨绸缪，但当前无法触发」。
 *
 * 根因 = 判定只看**自有 output 树**里的 `strategy_damage` 段：
 *  - 河内世泽：伤害在被 `chainSkillPickGroups` 随机到的子战法里（本战法 output 只有一段司马懿追加）；
 *  - 十常侍·乱政：谋略伤害由恐慌/燃烧/妖术的**跳伤**打出（本战法只挂 DoT）；
 *  - 连环计：伤害全在 `chainSkills` 引用的伐谋/迷阵/落雷里（本战法 `output: []`）。
 */
describe('未雨绸缪 · 子技能 / 谋略 DoT 触发（报障 ③）', () => {
  const recasts = (ctx: CombatContext) =>
    casts(ctx).filter((e) => (e as { recastBy?: string }).recastBy === '未雨绸缪');
  /** 再发动那一趟（recastRate = 0.5）；首次发动的子战法也挂 recastBy，但 recastRate = 1 */
  const replayed = (ctx: CombatContext) =>
    recasts(ctx).filter((e) => (e as { recastRate?: number }).recastRate === 0.5);

  it('河内世泽：谋略伤害全在被随机到的子战法里 → 触发，且每个子战法只重放一次', () => {
    const run = (withMarker: boolean) => {
      const caster = unit(general('c12', '中军'), 'my');
      const ctx = makeCtx([caster], [unit(general('e12', '中军'), 'enemy')]);
      if (withMarker) caster.statuses.push({ ...marker });
      cast(ctx, caster, sure('heneishize'));
      return {
        all: casts(ctx).length,
        half: replayed(ctx).length,
        tagged: recasts(ctx).length,
        markerLeft: caster.statuses.some((s) => s.type === 'repeat_strategy'),
      };
    };
    const plain = run(false);
    expect(plain.tagged).toBe(0);
    expect(plain.all).toBeGreaterThan(1); // 伤害确实由子战法打出
    const buffed = run(true);
    expect(buffed.all).toBe(plain.all * 2); // 一次原发动 + 一次重放
    expect(buffed.half).toBe(plain.all); // 重放恰好一次，不重复触发
    // 首次发动的那几段子战法同样挂机制 161（recastRate 1），故带标签的比重放的多
    expect(buffed.tagged).toBe(plain.all * 2 - 1);
    expect(buffed.markerLeft).toBe(false);
  });

  it('河内世泽再次发动：子战法输出按 50% 结算并带机制 161（合成战法组只含落雷，结果确定）', () => {
    const dispatch = sure('heneishize', {
      output: [],
      chainSkillPickGroups: [{ skillIds: ['luolei'] }],
    } as Partial<Skill>);
    const run = (withMarker: boolean) => {
      const caster = unit(general('c13', '中军', { strategy: 95 }), 'my');
      const ctx = makeCtx([caster], [unit(general('e13', '中军'), 'enemy')]);
      if (withMarker) caster.statuses.push({ ...marker });
      cast(ctx, caster, dispatch);
      return damages(ctx);
    };
    const plain = run(false);
    expect(plain).toHaveLength(1);
    expect(plain[0].ignoreStrategy).toBeUndefined();
    const recast = run(true);
    expect(recast).toHaveLength(2); // 本次发动的落雷 + 再发动的落雷
    // 本次发动也吃机制 161（用户 2026-10-21 口径），再发动那一发按 50% 结算
    expect(recast.map((d) => d.ignoreStrategy?.pct)).toEqual([32, 32]);
    expect(recast[1].damage).toBeLessThan(recast[0].damage);
  });

  it('十常侍·乱政：谋略伤害只由恐慌/燃烧/妖术的跳伤打出 → 标记照样触发', () => {
    const caster = unit(general('c14', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e14', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luanzheng'));
    expect(recasts(ctx)).toHaveLength(1);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(false);
  });

  it('密谋定蜀（只有恐慌 + 妖术诅咒，无直接伤害段）同样触发', () => {
    const caster = unit(general('c15', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e15', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('mimou_dingshu'));
    expect(recasts(ctx)).toHaveLength(1);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(false);
  });

  it('连环计：output 为空、伤害全在战法链里 → 照样触发（含机制 161 与 50% 缩放）', () => {
    const run = (withMarker: boolean) => {
      const caster = unit(general('c16', '中军', { strategy: 95 }), 'my');
      const ctx = makeCtx([caster], [unit(general('e16', '中军'), 'enemy')]);
      if (withMarker) caster.statuses.push({ ...marker });
      cast(ctx, caster, sure('lianhuanji'));
      return {
        dmg: damages(ctx),
        all: casts(ctx).length,
        half: replayed(ctx).length,
        markerLeft: caster.statuses.some((s) => s.type === 'repeat_strategy'),
      };
    };
    const plain = run(false);
    expect(plain.dmg.length).toBeGreaterThan(0); // 伤害全部来自战法链
    expect(plain.all).toBeGreaterThan(1);
    const buffed = run(true);
    expect(buffed.all).toBe(plain.all * 2);
    expect(buffed.half).toBe(plain.all);
    expect(buffed.dmg).toHaveLength(plain.dmg.length * 2);
    expect(buffed.dmg.every((d) => d.ignoreStrategy?.pct === 32)).toBe(true);
    expect(buffed.markerLeft).toBe(false);
  });

  it('再次发动的谋略 DoT 按 50% 缩放，且状态数组里每一项都缩（乱政的 10 选 1 池即数组口径）', () => {
    // 数组形态 = 每个目标独立随机选 1 项施加 → 两项都给 DoT，只断言被选中那条的 rate
    const dot = sure('luanzheng', {
      output: [
        {
          kind: 'inflict_status',
          status: [
            { type: 'panic', duration: 2, rate: 60, growthRate: 0 },
            { type: 'burning', duration: 2, rate: 60, growthRate: 0 },
          ],
        },
      ],
    } as Partial<Skill>);
    const run = (withMarker: boolean) => {
      const caster = unit(general('c17', '中军'), 'my');
      const enemy = unit(general('e17', '中军'), 'enemy');
      const ctx = makeCtx([caster], [enemy]);
      if (withMarker) caster.statuses.push({ ...marker });
      cast(ctx, caster, dot);
      return enemy.statuses
        .filter((s) => s.type === 'panic' || s.type === 'burning')
        .map((s) => (s as { rate?: number }).rate ?? -1)
        .sort((a, b) => b - a);
    };
    expect(run(false)).toEqual([60]);
    // DoT 每次都新建实例（不刷新）：再发动叠一条 50% 的 → [60, 30]
    expect(run(true)).toEqual([60, 30]);
  });

  it('只挂动摇（物理 DoT）不算「造成策略伤害」：不触发、标记保留', () => {
    const caster = unit(general('c18', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e18', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    const unrestOnly = sure('luanzheng', {
      output: [{ kind: 'inflict_status', status: { type: 'unrest', duration: 2, rate: 100 } }],
    } as Partial<Skill>);
    cast(ctx, caster, unrestOnly);
    expect(recasts(ctx)).toHaveLength(0);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(true);
  });

  it('多种来源同时命中同一战法（火势风威 = 策略伤害段 + 引燃 DoT）也只再发动一次', () => {
    const caster = unit(general('c19', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e19', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('huoshi_fengwei', { prepare: false } as Partial<Skill>));
    expect(recasts(ctx)).toHaveLength(1);
    // 两趟各 1 段策略伤害（第二趟 50%）：不因「伤害段 + DoT」双命中而多打一趟
    expect(damages(ctx)).toHaveLength(2);
    expect(damages(ctx)[1].damage).toBeLessThan(damages(ctx)[0].damage);
  });
});
