/**
 * 分兵伤害统计归属（用户 2026-09-26 口径）
 * ---------------------------------------------------------------------------
 * 问题：分兵溅射（`split_damage`）既不计入普攻统计、也不计入任何战法统计 —— 战报里整段丢失。
 * 口径：分兵伤害记录在**授予该分兵的来源战法**统计下（三军齐出 / 长兵方阵 / 先声夺人 / 其徐如林…），
 *       不计入普攻；施法者 ≠ 打出普攻的武将时（长兵方阵给友军挂分兵）归属**施法者**。
 *
 * 覆盖：
 *  1. 三军齐出（被动·自施）：分兵伤害计入【三军齐出】杀伤 = 分兵事件合计；普攻统计仍只有普攻。
 *  2. 长兵方阵（一类指挥·挂友军）：友军打出分兵 → 计入**施法者**的【长兵方阵】，友军名下没有分兵。
 *  3. 恒等式：分兵伤害恒 = 分兵事件合计（不再丢失）。
 *  4. 机制层：分兵状态记住授予者（sourceUnitId）→ 事件带 skillId / creditToId。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import { computeStats, computeDetailedStats } from '../src/engine/stats';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { initHeroDB } from '../src/data/heroes';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

beforeAll(async () => {
  await initHeroDB();
});

/**
 * 测试用木桩（无主战法，战法槽由用例显式装配）。
 * 「三军齐出」「长兵方阵」只吃面板兵力/属性，不依赖具体武将。
 */
function dummy(
  id: string,
  position: Position,
  patch: Partial<Pick<General, 'activeSkillIds' | 'passiveSkillIds' | 'commandSkillIds' | 'pursuitSkillIds' | 'attackRange'>> = {}
): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 150,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 2,
    maxTroops: 12000,
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

/** 从 report 构造 UnitState（computeStats/computeDetailedStats 需要） */
function unitsOf(report: ReturnType<typeof runBattle>): UnitState[] {
  return [
    ...report.myTeam.map((g) => ({ general: g, side: 'my' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] })),
    ...report.enemyTeam.map((g) => ({ general: g, side: 'enemy' as const, troops: 0, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] })),
  ];
}

type SplitEvent = Extract<BattleEvent, { type: 'split_damage' }>;

/** 事件流里的分兵事件合计（口径 = 战报真实打出的分兵伤害） */
function splitSum(events: BattleEvent[]): number {
  return events.filter((e): e is SplitEvent => e.type === 'split_damage').reduce((a, e) => a + e.damage, 0);
}

describe('分兵伤害计入来源战法统计', () => {
  it('三军齐出（被动·自施）：分兵伤害计入【三军齐出】杀伤，普攻统计只含普攻', () => {
    const attacker = dummy('atk', '前锋', { passiveSkillIds: ['sanjun_qichu'] });
    const report = runBattle({
      seed: 11,
      maxRounds: 8,
      myTeam: [attacker, dummy('mid', '中军'), dummy('back', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    const splits = report.events.filter((e): e is SplitEvent => e.type === 'split_damage');
    expect(splits.length, '三军齐出每回合给自身分兵 → 必须打出分兵').toBeGreaterThan(0);
    // 每条分兵事件都带来源战法（否则统计无从归属）
    expect(splits.every((s) => s.skillId === 'sanjun_qichu')).toBe(true);

    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const atk = detailed.find((d) => d.unitId === 'atk')!;
    const sj = atk.skills.find((s) => s.skillId === 'sanjun_qichu');
    expect(sj?.damage ?? 0, '分兵伤害必须计入三军齐出').toBe(splitSum(report.events));
    expect(sj!.damage).toBeGreaterThan(0);

    // 普攻统计口径不变：attackDamage = attack_hit 合计（分兵不进普攻）
    const attackHitSum = report.events
      .filter((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit' && e.sourceId === 'atk')
      .reduce((a, e) => a + e.damage, 0);
    expect(atk.attackDamage).toBe(attackHitSum);
    expect(atk.attackCount).toBeGreaterThan(0);

    // 武将级统计：分兵算战法杀伤
    const summary = computeStats(report.events, unitsOf(report));
    const atkSum = summary.find((s) => s.unitId === 'atk')!;
    expect(atkSum.skillDamage).toBeGreaterThanOrEqual(splitSum(report.events));
  });

  it('长兵方阵（一类指挥·挂友军）：友军打出的分兵计入【施法者】的杀伤，友军名下无分兵', () => {
    // 施法者放前锋（自己挨打、顺带打人）、分兵携带者放中军（攻击距离 3，前排对拼阵亡后敌军前压 → 可打到）
    const caster = dummy('caster', '前锋', { commandSkillIds: ['changbing_fangzhen'] });
    const carrier = dummy('carrier', '中军', { attackRange: 3 });
    const report = runBattle({
      seed: 13,
      maxRounds: 8,
      myTeam: [caster, carrier, dummy('back', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    const splits = report.events.filter((e): e is SplitEvent => e.type === 'split_damage');
    expect(splits.length, '长兵方阵给友军挂分兵 → 友军普攻必须打出分兵').toBeGreaterThan(0);
    expect(splits.every((s) => s.skillId === 'changbing_fangzhen')).toBe(true);
    // 打出分兵的是拿到分兵的友军（施法者自身的普攻也会带分兵 → 两种 sourceId 都可能出现），
    // 但归属恒为授予分兵的施法者
    expect(splits.some((s) => s.sourceId === 'carrier'), '友军打出分兵').toBe(true);
    expect(splits.every((s) => s.creditToId === 'caster')).toBe(true);

    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const casterStats = detailed.find((d) => d.unitId === 'caster')!;
    const cb = casterStats.skills.find((s) => s.skillId === 'changbing_fangzhen');
    expect(cb?.damage ?? 0, '分兵伤害计入施法者的长兵方阵').toBe(splitSum(report.events));
    // 打人的友军名下不得出现长兵方阵（否则同一份伤害被记两次）
    const carrierStats = detailed.find((d) => d.unitId === 'carrier')!;
    expect(carrierStats.skills.some((s) => s.skillId === 'changbing_fangzhen')).toBe(false);
    const backStats = detailed.find((d) => d.unitId === 'back')!;
    expect(backStats.skills.some((s) => s.skillId === 'changbing_fangzhen')).toBe(false);

    const summary = computeStats(report.events, unitsOf(report));
    expect(summary.find((s) => s.unitId === 'caster')!.skillDamage).toBeGreaterThanOrEqual(splitSum(report.events));
    expect(summary.find((s) => s.unitId === 'carrier')!.skillDamage).toBe(0);
  });

  it('先声夺人（被动·分兵 70%）：分兵计入【先声夺人】而非普攻', () => {
    const attacker = dummy('atk', '前锋', { passiveSkillIds: ['xiansheng_duoren'] });
    const report = runBattle({
      seed: 17,
      maxRounds: 8,
      myTeam: [attacker, dummy('mid', '中军'), dummy('back', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    const splits = report.events.filter((e): e is SplitEvent => e.type === 'split_damage');
    expect(splits.length).toBeGreaterThan(0);
    expect(splits.every((s) => s.skillId === 'xiansheng_duoren')).toBe(true);

    // 先声夺人还有「敌军单体攻击 110%」段（走 damage 事件）——分兵只占其中 split_damage 部分
    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const xs = detailed.find((d) => d.unitId === 'atk')!.skills.find((s) => s.skillId === 'xiansheng_duoren')!;
    const directSum = report.events
      .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'xiansheng_duoren')
      .reduce((a, e) => a + e.damage, 0);
    expect(xs.damage).toBe(splitSum(report.events) + directSum);
    expect(splitSum(report.events)).toBeGreaterThan(0);
  });

  it('恒等式：分兵事件合计 > 0 时必然计入统计（不再整段丢失）', () => {
    const attacker = dummy('atk', '前锋', { passiveSkillIds: ['sanjun_qichu'] });
    const report = runBattle({
      seed: 23,
      maxRounds: 8,
      myTeam: [attacker, dummy('mid', '中军'), dummy('back', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    const total = splitSum(report.events);
    expect(total).toBeGreaterThan(0);
    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const recorded = detailed
      .flatMap((d) => d.skills)
      .filter((s) => s.skillId === 'sanjun_qichu')
      .reduce((a, s) => a + s.damage, 0);
    expect(recorded, '统计中三军齐出杀伤 = 分兵伤害合计').toBe(total);
  });
});

describe('SkillStat.killers：通过该战法造成杀伤的武将明细（Web 弹窗数据源）', () => {
  const BKD = { troopBase: 0, base: 0, main: 0 };

  it('长兵方阵（挂友军）：杀害明细按实际打人者拆开（多个友军、按首次造成杀伤顺序），总额 = 分兵合计', () => {
    const caster = dummy('caster', '大营', { commandSkillIds: ['changbing_fangzhen'] });
    const front = dummy('front', '前锋');
    const mid = dummy('mid', '中军');
    const enemy1 = dummy('e1', '前锋');
    const enemy2 = dummy('e2', '中军');
    const events: BattleEvent[] = [
      { type: 'skill_cast', unitId: 'caster', skillId: 'changbing_fangzhen', skillName: '长兵方阵' },
      { type: 'split_damage', sourceId: 'front', creditToId: 'caster', targetId: 'e1', damage: 100, breakdown: BKD, skillId: 'changbing_fangzhen' },
      { type: 'split_damage', sourceId: 'mid', creditToId: 'caster', targetId: 'e2', damage: 80, breakdown: BKD, skillId: 'changbing_fangzhen' },
      { type: 'split_damage', sourceId: 'front', creditToId: 'caster', targetId: 'e1', damage: 20, breakdown: BKD, skillId: 'changbing_fangzhen' },
    ];
    const units: UnitState[] = [caster, front, mid, enemy1, enemy2].map((g) => ({
      general: g,
      side: g.id.startsWith('e') ? 'enemy' : 'my',
      troops: 0,
      wounded: 0,
      totalDead: 0,
      alive: true,
      statuses: [],
      preparations: [],
    }));

    const st = computeDetailedStats(events, units).find((d) => d.unitId === 'caster')!.skills.find((s) => s.skillId === 'changbing_fangzhen')!;
    expect(st.damage).toBe(200);
    expect(st.killers.map((k) => [k.unitId, k.damage])).toEqual([
      ['front', 120],
      ['mid', 80],
    ]);
    expect(st.killers.map((k) => k.name)).toEqual(['木桩前锋', '木桩中军']);
    // 携带者自己没打 → 名单里没有施法者（Web 据此把数字做成可点击）
    expect(st.killers.some((k) => k.unitId === 'caster')).toBe(false);
  });

  it('其徐如林（相邻跳伤）：凶手 = 实际打出原策略伤害的友军（含 DoT 归属维）', () => {
    const sima = dummy('sima', '大营', { commandSkillIds: ['qixu_rulin'] });
    const front = dummy('front', '前锋');
    const enemy1 = dummy('e1', '前锋');
    const events: BattleEvent[] = [
      { type: 'skill_cast', unitId: 'sima', skillId: 'qixu_rulin', skillName: '其徐如林' },
      {
        type: 'damage',
        sourceId: 'front',
        creditToId: 'sima',
        targetId: 'e1',
        skillId: 'qixu_rulin',
        skillName: '其徐如林',
        damageType: 'strategy',
        damage: 90,
        breakdown: BKD,
      },
      // DoT 归属维名叫 casterId（不是 sourceId）——明细也要按它算
      { type: 'dot_tick', sourceId: 'front', casterId: 'front', targetId: 'e1', skillId: 'qixu_rulin', dotType: 'burning', damage: 15, breakdown: BKD },
    ];
    const units: UnitState[] = [sima, front, enemy1].map((g) => ({
      general: g,
      side: g.id === 'e1' ? 'enemy' : 'my',
      troops: 0,
      wounded: 0,
      totalDead: 0,
      alive: true,
      statuses: [],
      preparations: [],
    }));

    const det = computeDetailedStats(events, units);
    // 统计归属维：damage 事件 = creditToId ?? sourceId（→ sima）；dot_tick = casterId（→ front）
    const simaSt = det.find((d) => d.unitId === 'sima')!.skills.find((s) => s.skillId === 'qixu_rulin')!;
    expect(simaSt.damage).toBe(90);
    expect(simaSt.killers.map((k) => [k.unitId, k.damage])).toEqual([['front', 90]]);
    expect(simaSt.killers.some((k) => k.unitId === 'sima')).toBe(false); // → Web 做成可点击

    const frontSt = det.find((d) => d.unitId === 'front')!.skills.find((s) => s.skillId === 'qixu_rulin')!;
    expect(frontSt.damage).toBe(15);
    expect(frontSt.killers.map((k) => k.unitId)).toEqual(['front']); // 自己打的 → 不可点击
  });

  it('携带者自己打伤害（三军齐出）：明细只有携带者本人 → Web 不做成可点击', () => {
    const a = dummy('atk', '前锋', { passiveSkillIds: ['sanjun_qichu'] });
    const report = runBattle({
      seed: 11,
      maxRounds: 8,
      myTeam: [a, dummy('mid', '中军'), dummy('back', '大营')],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });
    const st = computeDetailedStats(report.events, unitsOf(report))
      .find((d) => d.unitId === 'atk')!
      .skills.find((s) => s.skillId === 'sanjun_qichu')!;
    expect(st.killers).toEqual([{ unitId: 'atk', name: '木桩前锋', damage: splitSum(report.events) }]);
  });
});

describe('其徐如林（策略伤害相邻跳伤）：伤害记在该战法统计下', () => {
  it('策略伤害的相邻跳伤计入【其徐如林】杀伤，且归属施法者', () => {
    // 司马懿·晋（h807）：主战法其徐如林（一类指挥光环，准备阶段注册）+ 随身策略伤害战法（夹攻）
    const sima: General = dummy('sima', '大营', {
      commandSkillIds: ['qixu_rulin'],
      activeSkillIds: ['jiagong'],
    });
    sima.mainSkillId = 'qixu_rulin';
    expect(SKILL_REGISTRY['qixu_rulin']).toBeTruthy();

    const report = runBattle({
      seed: 29,
      maxRounds: 8,
      myTeam: [dummy('front', '前锋'), dummy('mid', '中军'), sima],
      enemyTeam: [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')],
    });

    const qx = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'qixu_rulin'
    );
    const qxSum = qx.reduce((a, e) => a + e.damage, 0);
    expect(qx.length, '策略伤害生效后应触发相邻跳伤').toBeGreaterThan(0);

    const detailed = computeDetailedStats(report.events, unitsOf(report));
    const simaStats = detailed.find((d) => d.unitId === 'sima')!;
    expect(simaStats.skills.find((s) => s.skillId === 'qixu_rulin')?.damage ?? 0).toBe(qxSum);
  });
});

describe('机制层：分兵状态记住授予者，事件带 skillId / creditToId', () => {
  /** 最小可行动上下文（同 split_basic_only.test.ts） */
  function makeCtx(seed = 5): CombatContext {
    return {
      rng: new Rng(seed),
      myTeam: [],
      enemyTeam: [],
      events: [],
      skills: new Map(Object.entries(SKILL_REGISTRY)),
      lockedCommands: [],
      stackBuffs: [],
      currentRound: 1,
    };
  }

  /** 通用 General → UnitState（引擎内部 toUnitStates 的测试版） */
  function unit(g: General, side: 'my' | 'enemy'): UnitState {
    return {
      general: g,
      side,
      troops: g.maxTroops,
      alive: true,
      wounded: 0,
      totalDead: 0,
      statuses: [],
      preparations: [],
    };
  }

  it('inflictStatus 带施法者 → split 状态记下 sourceUnitId；普攻命中的分兵事件带 creditToId = 施法者', () => {
    const ctx = makeCtx();
    const caster = unit(dummy('caster', '中军'), 'my');
    const carrier = unit(dummy('carrier', '前锋'), 'my');
    const e1 = unit(dummy('e1', '前锋'), 'enemy'); // 被打者
    const e2 = unit(dummy('e2', '中军'), 'enemy'); // 相邻 → 吃分兵
    ctx.myTeam = [carrier, caster, unit(dummy('back', '大营'), 'my')];
    ctx.enemyTeam = [e1, e2, unit(dummy('e3', '大营'), 'enemy')];

    // 队友（caster）给 carrier 挂分兵：来源战法 = tmp_skill，施法者 = caster
    inflictStatus(ctx, carrier, { type: 'split', duration: 999, rate: 60 }, 'command', 'tmp_skill', 'caster');
    const st = carrier.statuses.find((s) => s.type === 'split') as Extract<UnitState['statuses'][number], { type: 'split' }>;
    expect(st.sourceUnitId).toBe('caster');
    expect(st.sourceSkillId).toBe('tmp_skill');

    actUnit(ctx, carrier);

    const splits = ctx.events.filter((e): e is SplitEvent => e.type === 'split_damage');
    expect(splits.length).toBeGreaterThan(0);
    for (const s of splits) {
      expect(s.sourceId).toBe('carrier'); // 打人者是携带者
      expect(s.skillId).toBe('tmp_skill'); // 统计归到来源战法
      expect(s.creditToId).toBe('caster'); // 施法者
    }
  });

  it('无施法者（原始特性/直接构造）→ 分兵伤害归属携带者自身，不产生 undefined 归属', () => {
    const ctx = makeCtx();
    const carrier = unit(dummy('carrier', '前锋'), 'my');
    const e1 = unit(dummy('e1', '前锋'), 'enemy');
    const e2 = unit(dummy('e2', '中军'), 'enemy');
    ctx.myTeam = [carrier, unit(dummy('mid', '中军'), 'my'), unit(dummy('back', '大营'), 'my')];
    ctx.enemyTeam = [e1, e2, unit(dummy('e3', '大营'), 'enemy')];

    inflictStatus(ctx, carrier, { type: 'split', duration: 999, rate: 60 }, 'passive', 'trait_sanshe_split');
    actUnit(ctx, carrier);

    const splits = ctx.events.filter((e): e is SplitEvent => e.type === 'split_damage');
    expect(splits.length).toBeGreaterThan(0);
    for (const s of splits) {
      expect(s.creditToId).toBe('carrier');
      expect(s.skillId).toBe('trait_sanshe_split');
    }
  });
});
