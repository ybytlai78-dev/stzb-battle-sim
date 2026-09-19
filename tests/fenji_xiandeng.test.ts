/**
 * 奋疾先登（乐进·二类指挥·行动叠层）机制测试（v0.11）
 *  1. 行动时获得 1 层增伤 8%（damage_boost 造成侧，同战法累加）
 *  2. 与场上所有存活单位速度对比：高于目标 70% 额外 +1 层、低于或等于目标 30% 额外 +1 层
 *     （用 stub rng 精确控制概率分支）
 *  3. 层数 × 8% 达到 40%（5 层）→ 对距离 3 以内敌军群体发动一次攻击（伤害率 190%），
 *     发动后层数清空（计数器归零 + 增伤状态移除）
 *  4. 攻击目标速度属性降低 20，可叠加、持续到战斗结束
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

/** stub rng：chance 完全由实现函数控制（跳过 mulberry32 随机），其余返回固定值 */
function stubRng(chanceImpl: (p: number) => boolean): Rng {
  return {
    next: () => 0.5,
    int: () => 0,
    intInclusive: () => 0,
    chance: chanceImpl,
  } as unknown as Rng;
}

function makeUnit(id: string, opts: { position?: Position; speed?: number; attackRange?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '魏',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: 100,
      defense: 100,
      strategy: 80,
      speed: opts.speed ?? 100,
      attackRange: opts.attackRange ?? 2,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

/**
 * 战场：乐进（前锋，速度 100）+ 友军 ally（中军，速度 120，低于乐进 → 30% 判定）
 *  敌军：e1 前锋（速度 90，低于乐进 → 70% 判定）、e2 中军（速度 120，高于 → 30%）、
 *        e3 大营（速度 100，等于 → 30%）
 */
function field(chanceImpl: (p: number) => boolean): { ctx: CombatContext; lejin: UnitState } {
  const ctx: CombatContext = {
    rng: stubRng(chanceImpl),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
    actLayerCounters: new Map(),
  };
  const lejin = makeUnit('lejin', { position: '前锋', speed: 100 });
  lejin.general.commandSkillIds = ['fenji_xiandeng'];
  const ally = makeUnit('ally', { position: '中军', speed: 120 });
  ctx.myTeam = [lejin, ally];
  const e1 = makeUnit('e1', { position: '前锋', speed: 90 });
  const e2 = makeUnit('e2', { position: '中军', speed: 120 });
  const e3 = makeUnit('e3', { position: '大营', speed: 100 });
  for (const e of [e1, e2, e3]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, lejin };
}

/**
 * 用户示例战场：6 名武将，乐进速度排行第三（速度 100）
 *  比他快的 2 名：a1（110）、e3（130）→ 各判 30%
 *  比他慢的 3 名：a2（70）、e1（80）、e2（90）→ 各判 70%
 *  （不含自己；无速度相等的情况）
 */
function rankThreeField(chanceImpl: (p: number) => boolean): { ctx: CombatContext; lejin: UnitState } {
  const ctx: CombatContext = {
    rng: stubRng(chanceImpl),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
    actLayerCounters: new Map(),
  };
  const lejin = makeUnit('lejin', { position: '前锋', speed: 100 });
  lejin.general.commandSkillIds = ['fenji_xiandeng'];
  const a1 = makeUnit('a1', { position: '大营', speed: 110 }); // 快于乐进
  const a2 = makeUnit('a2', { position: '中军', speed: 70 }); // 慢于乐进
  ctx.myTeam = [lejin, a1, a2];
  const e1 = makeUnit('e1', { position: '前锋', speed: 80 }); // 慢于乐进
  const e2 = makeUnit('e2', { position: '中军', speed: 90 }); // 慢于乐进
  const e3 = makeUnit('e3', { position: '大营', speed: 130 }); // 快于乐进
  for (const e of [e1, e2, e3]) e.side = 'enemy';
  ctx.enemyTeam = [e1, e2, e3];
  return { ctx, lejin };
}

const fenjiBoost = (u: UnitState) =>
  u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === 'fenji_xiandeng'
  );
const fenjiDamage = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'fenji_xiandeng');
const speedDebuff = (u: UnitState) =>
  u.statuses.find((s) => s.type === 'speed_buff' && s.sourceSkillId === 'fenji_xiandeng') as
    | Extract<Status, { type: 'speed_buff' }>
    | undefined;

describe('奋疾先登（乐进·二类指挥·行动叠层）', () => {
  it('战法定义：二类指挥 on_act、叠层配置（8%/40%/70%/30%/距离3/降速20）、词条标签', () => {
    const s = SKILL_REGISTRY['fenji_xiandeng'] as Extract<import('../src/engine/types').Skill, { type: 'command' }>;
    expect(s.type).toBe('command');
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.actLayer).toEqual({
      perLayer: 8,
      cap: 40,
      speedHigherChance: 0.7,
      speedLowerOrEqualChance: 0.3,
      range: 3,
      speedReduce: 20,
      targetMode: 'group',
    });
    // 词条：造成单次伤害（不冲突）/ 速度属性降低 / 攻击伤害提高
    expect(s.tags).toEqual(expect.arrayContaining(['damage', 'speed_buff', 'damage_boost']));
    // 触发攻击：攻击 190%
    expect(s.output).toEqual([{ kind: 'physical_damage', rate: 190 }]);
  });

  it('行动时获得基础 1 层；速度高于目标才按 70% 判定额外叠层（低于/等于不叠）', () => {
    // chance 只对 0.7 成功：低于乐进的 e1（90<100）判定成功，高于/等于的 e2/e3/ally 判定失败
    const { ctx, lejin } = field((p) => p === 0.7);
    actUnit(ctx, lejin);

    // 基础 1 层 + e1 额外 1 层 = 2 层 → 增伤 16%
    const boost = fenjiBoost(lejin);
    expect(boost).toBeTruthy();
    expect(boost!.rate).toBe(0.16);
    // 第 2 组（damage_boost）在本次行动之内施加 → 本次行动已计入 1 次生效，行动结束补一次递减：
    // 999 → 998（该状态由 actLayerCounters 手动清空，999 只是「持续至战斗结束」的约定值）
    expect(boost!.remaining).toBe(998);
    expect(boost!.sourceUnitId).toBe('lejin');
    // 计数器 2 层，未触发攻击
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(2);
    expect(fenjiDamage(ctx).length).toBe(0);
  });

  it('速度排行第三（6 将：快 2 慢 3，不含自己）：行动时 +1 层，再判 3 次 70% + 2 次 30%', () => {
    // 70% 全成功、30% 全失败 → 基础 1 + 慢于的 3 名 = 4 层
    const a = rankThreeField((p) => p === 0.7);
    actUnit(a.ctx, a.lejin);
    expect(a.ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(4);
    expect(fenjiBoost(a.lejin)!.rate).toBe(0.32);

    // 30% 全成功、70% 全失败 → 基础 1 + 快于的 2 名 = 3 层
    const b = rankThreeField((p) => p === 0.3);
    actUnit(b.ctx, b.lejin);
    expect(b.ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(3);
    expect(fenjiBoost(b.lejin)!.rate).toBe(0.24);
  });

  it('全部概率判定失败时仅 1 层（8%），连续行动累计层数', () => {
    const { ctx, lejin } = field(() => false);
    actUnit(ctx, lejin);
    expect(fenjiBoost(lejin)!.rate).toBe(0.08);
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(1);

    actUnit(ctx, lejin);
    expect(fenjiBoost(lejin)!.rate).toBe(0.16);
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(2);
  });

  it('满 5 层触发攻击：对距离 3 以内敌军群体（2 目标）发动 190% 攻击，层数清空', () => {
    const { ctx, lejin } = field(() => false);
    // 每回合行动 +1 层（速度对比全失败）：第 1~4 回合累计 4 层
    for (let i = 0; i < 4; i++) actUnit(ctx, lejin);
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(4);
    expect(fenjiDamage(ctx).length).toBe(0);
    expect(fenjiBoost(lejin)!.rate).toBe(0.32);

    // 第 5 回合行动 → 5 层 → 触发攻击
    actUnit(ctx, lejin);

    // 攻击：2 目标（前锋 e1 + 中军 e2，group 至多 2；大营 e3 距离 3 在范围内但 group 只取 2）
    const dmg = fenjiDamage(ctx);
    expect(dmg.length).toBe(2);
    expect(dmg.every((e) => e.damageType === 'physical')).toBe(true);
    // 攻击时 5 层增伤仍生效：modifiers.caused 含奋疾先登 40%
    const boostSrc = dmg[0].modifiers?.caused.find((s) => s.skillId === 'fenji_xiandeng');
    expect(boostSrc).toBeTruthy();
    expect(boostSrc!.rate).toBe(0.4);
    // 层数清空：计数器归零 + 增伤状态移除
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(0);
    expect(fenjiBoost(lejin)).toBeUndefined();
    // 攻击目标速度 -20（可叠加、持续到战斗结束）
    for (const t of [ctx.enemyTeam[0], ctx.enemyTeam[1]]) {
      const db = speedDebuff(t);
      expect(db).toBeTruthy();
      expect(db!.amount).toBe(-20);
      expect(db!.remaining).toBe(999);
      expect(db!.sourceUnitId).toBe('lejin');
    }
  });

  it('4 层不触发攻击（不足 5 层）', () => {
    const { ctx, lejin } = field(() => false);
    for (let i = 0; i < 4; i++) actUnit(ctx, lejin);
    expect(fenjiDamage(ctx).length).toBe(0);
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(4);
    expect(speedDebuff(ctx.enemyTeam[0])).toBeUndefined();
  });

  it('速度降低可叠加：再次叠满 5 层触发攻击后目标速度 -40', () => {
    const { ctx, lejin } = field(() => false);
    for (let i = 0; i < 5; i++) actUnit(ctx, lejin); // 第一次触发：-20
    const db1 = speedDebuff(ctx.enemyTeam[0]);
    expect(db1!.amount).toBe(-20);
    for (let i = 0; i < 5; i++) actUnit(ctx, lejin); // 第二次触发：-40（同战法重复施加数值累加）
    const db = speedDebuff(ctx.enemyTeam[0]);
    expect(db).toBeTruthy();
    expect(db!.amount).toBe(-40);
    expect(db!.remaining).toBe(999);
  });

  it('满 5 层立即触发攻击并清空，剩余判定继续叠新层（不再攒超 5 层）', () => {
    // 全部概率判定成功：基础 1 + 慢于的 3 名（70%）+ 快于的 2 名（30%）= 6 次判定
    const { ctx, lejin } = rankThreeField(() => true);
    actUnit(ctx, lejin);

    // 第 5 层立即触发 1 次攻击（攻击时 5 层增伤 40% 生效），第 6 次判定继续叠 1 层
    const dmg = fenjiDamage(ctx);
    expect(dmg.length).toBe(2); // group 2 目标
    const boostSrc = dmg[0].modifiers?.caused.find((s) => s.skillId === 'fenji_xiandeng');
    expect(boostSrc!.rate).toBe(0.4); // 攻击时恰 5 层（40%），而非攒满 6 层（48%）
    // 清空后剩余判定叠的新层保留：1 层（8%）
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(1);
    expect(fenjiBoost(lejin)!.rate).toBe(0.08);
  });

  it('满 5 层立即触发攻击并清空，剩余判定继续叠新层（不再攒超 5 层）', () => {
    // 预存 3 层（计数器 + 增伤状态同步，模拟前几回合残留）：基础 1 → 4 层；
    // 第 1 个对手判定 → 5 层 → 立即攻击清空；剩余 4 个对手判定继续叠 4 层
    const { ctx, lejin } = rankThreeField(() => true);
    ctx.actLayerCounters!.set('lejin:fenji_xiandeng', 3);
    for (let i = 0; i < 3; i++) {
      inflictStatus(
        ctx,
        lejin,
        { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused' },
        'command',
        'fenji_xiandeng',
        'lejin'
      );
    }
    actUnit(ctx, lejin);

    const dmg = fenjiDamage(ctx);
    expect(dmg.length).toBe(2); // group 2 目标，1 次攻击
    // 攻击时恰 5 层（40%）——不会攒成 3+1+5=9 层（72%）才触发
    const boostSrc = dmg[0].modifiers?.caused.find((s) => s.skillId === 'fenji_xiandeng');
    expect(boostSrc!.rate).toBe(0.4);
    // 清空后剩余 4 次判定（5 对手 − 1 已触发）继续叠层：4 层（32%）
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(4);
    expect(fenjiBoost(lejin)!.rate).toBe(0.32);
    // 触发后仍有叠层事件（判定继续）
    expect(ctx.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost')).toBe(true);
  });

  it('攻击穿插在判定间：首次攻击发生在后续判定之前（第 5 层立即触发）', () => {
    // 6 次判定全成功：第 5 次判定触发攻击，之后还有 1 次判定
    const { ctx, lejin } = rankThreeField(() => true);
    actUnit(ctx, lejin);

    const dmgIdx = ctx.events.map((e, i) => ({ e, i })).filter((x) => x.e.type === 'skill_target' && x.e.skillId === 'fenji_xiandeng');
    expect(dmgIdx.length).toBe(1);
    // 攻击后仍有叠层事件（清空后第 6 次判定叠的 1 层）
    const dmgPos = dmgIdx[0].i;
    const boostAfter = ctx.events.findIndex(
      (e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost' && e.unitId === 'lejin'
    );
    // 攻击（skill_target）之后仍有新的增伤叠层事件（status_inflicted damage_boost）
    const inflictedAfter = ctx.events
      .map((e, i) => ({ e, i }))
      .filter((x) => x.i > dmgPos && x.e.type === 'status_inflicted' && x.e.statusType === 'damage_boost');
    expect(inflictedAfter.length).toBeGreaterThan(0);
    expect(boostAfter).toBeGreaterThan(-1);
  });

  it('与大赏三军（同类型指挥 caused 增伤）冲突数值替换，但叠层计数与满 5 层砍刀照常', () => {
    // 大赏三军 30% 先挂；全部概率判定成功（6 次判定）：每层 8% 与大赏三军冲突取较高 → 层增伤被压制
    const { ctx, lejin } = rankThreeField(() => true);
    inflictStatus(
      ctx,
      lejin,
      { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' },
      'command',
      'dashang_sanjun',
      'lvmeng'
    );
    actUnit(ctx, lejin);

    // 增伤冲突事件存在（数值替换，非共存叠加）
    const conflicts = ctx.events.filter((e) => e.type === 'status_conflict' && e.statusType === 'damage_boost');
    expect(conflicts.length).toBeGreaterThan(0);
    // 奋疾先登增伤状态被大赏三军压制（无独立实例）
    expect(lejin.statuses.filter((s) => s.type === 'damage_boost' && s.sourceSkillId === 'fenji_xiandeng').length).toBe(0);
    // 但叠层计数照常：6 次判定叠到 5 层立即砍一刀（攻击照发，增伤来源为大赏三军 30%）
    const dmg = fenjiDamage(ctx);
    expect(dmg.length).toBe(2); // group 2 目标，1 次攻击
    const caused = dmg[0].modifiers!.caused;
    expect(caused.map((s) => [s.skillId, s.rate])).toEqual([['dashang_sanjun', 0.3]]);
    // 清空后剩余 1 次判定继续叠 1 层（计数器照常）
    expect(ctx.actLayerCounters!.get('lejin:fenji_xiandeng')).toBe(1);
  });

  it('奋疾先登层数超过大赏三军时替换生效（40% > 30%），攻击时带奋疾先登 40% 增伤', () => {
    // 预存 4 层奋疾先登（0.32 状态 + 计数器同步）→ 大赏三军 30% 后挂 → 30% < 32% 被拒
    const { ctx, lejin } = rankThreeField(() => true);
    ctx.actLayerCounters!.set('lejin:fenji_xiandeng', 4);
    for (let i = 0; i < 4; i++) {
      inflictStatus(
        ctx,
        lejin,
        { type: 'damage_boost', rate: 0.08, duration: 999, direction: 'caused' },
        'command',
        'fenji_xiandeng',
        'lejin'
      );
    }
    inflictStatus(
      ctx,
      lejin,
      { type: 'damage_boost', rate: 0.3, duration: 3, direction: 'caused' },
      'command',
      'dashang_sanjun',
      'lvmeng'
    );
    expect(ctx.events.some((e) => e.type === 'status_conflict' && e.statusType === 'damage_boost')).toBe(true);
    expect(lejin.statuses.filter((s) => s.type === 'damage_boost').length).toBe(1); // 仍只有奋疾先登

    actUnit(ctx, lejin);
    // 预存 4 层 + 基础 1 层 → 立即砍一刀（5 层）；5 个对手判定再叠满 5 层 → 再砍一刀 = 2 次攻击
    const dmg = fenjiDamage(ctx);
    expect(dmg.length).toBe(4); // 2 次攻击 × group 2 目标
    // 每次攻击时 caused = 奋疾先登 0.4（大赏三军被拒）
    const caused = dmg[0].modifiers!.caused;
    expect(caused.map((s) => [s.skillId, s.rate])).toEqual([['fenji_xiandeng', 0.4]]);
    expect(dmg[2].modifiers!.caused.map((s) => [s.skillId, s.rate])).toEqual([['fenji_xiandeng', 0.4]]);
  });
});
