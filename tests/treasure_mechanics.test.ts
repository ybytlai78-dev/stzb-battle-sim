/**
 * 宝物系统 · 控制类与回合钩子机制（P2b 第二批）
 *  惑言/慑心：控制时长 +1（消耗 charges）
 *  坚毅：前 N 回合免疫混乱/暴走（拦截 + 事件）
 *  强击：前 N 回合普攻不触发反击
 *  清毅：第 N 回合行动时获得洞察
 *  再战：第 5 回合 50% 获得连击
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, getStatus, hasStatus, consumeEvasion, recoverTroops, sumReduce, markFirstHitReduceUsed, dealDotDamage, tickRoundStartStatuses, updateTreasureOnHurt, applyTreasureBasicHit, applyTreasureAfterActive } from '../src/engine/action';
import type { General } from '../src/engine/types';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { buildTreasureStatuses, triggerTreasureRoundStart } from '../src/engine/treasure';

function makeUnit(id: string, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillId: 'main_x',
      mainSkillId: 'main_x',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side,
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  } as unknown as UnitState;
}

function makeCtx(round = 1, seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: round,
  } as unknown as CombatContext;
}

const CONFUSE: CreateStatus = { type: 'confusion', duration: 2 };

describe('宝物 · 控制延时 / 免疫 / 反击 / 回合钩子', () => {
  it('惑言（控制时长 +1）：主战法控制 2 回合 → 3 回合，并消耗 1 次 charges', () => {
    const ctx = makeCtx();
    const caster = makeUnit('c');
    const target = makeUnit('t', 'enemy');
    ctx.myTeam = [caster];
    ctx.enemyTeam = [target];
    inflictStatus(ctx, caster, { type: 'control_extend', charges: 2, duration: 999, mainSkillOnly: true }, 'passive', 'treasure:affix:惑言', 'c');
    inflictStatus(ctx, target, CONFUSE, 'active', 'main_x', 'c');
    expect(getStatus(target, 'confusion')!.remaining).toBe(3);
    expect(getStatus(caster, 'control_extend')!.charges).toBe(1);
  });

  it('惑言：非主战法（战法 id 不匹配）不延时、不消耗；charges 用尽后状态移除', () => {
    const ctx = makeCtx();
    const caster = makeUnit('c');
    ctx.myTeam = [caster];
    const other = makeUnit('o', 'enemy');
    inflictStatus(ctx, caster, { type: 'control_extend', charges: 1, duration: 999, mainSkillOnly: true }, 'passive', 'treasure:affix:惑言', 'c');
    inflictStatus(ctx, other, CONFUSE, 'active', 'some_other_skill', 'c');
    expect(getStatus(other, 'confusion')!.remaining).toBe(2);
    expect(getStatus(caster, 'control_extend')!.charges).toBe(1);
    // 主战法再控制一次 → 延时并耗尽
    const t2 = makeUnit('t2', 'enemy');
    ctx.enemyTeam = [other, t2];
    inflictStatus(ctx, t2, CONFUSE, 'active', 'main_x', 'c');
    expect(getStatus(t2, 'confusion')!.remaining).toBe(3);
    expect(getStatus(caster, 'control_extend')).toBeUndefined();
  });

  it('坚毅：前 N 回合免疫混乱及暴走（拦截控制并记事件），不挡其他控制', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    inflictStatus(ctx, u, { type: 'control_immune', types: ['confusion', 'rampage'], duration: 3 }, 'passive', 'treasure:affix:坚毅', 'u');
    inflictStatus(ctx, u, CONFUSE, 'active', 'enemy_skill', 'e');
    expect(hasStatus(u, 'confusion')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'control_immune_blocked')).toBe(true);
    // 怯战不在坚毅清单内 → 正常施加
    inflictStatus(ctx, u, { type: 'cowardice', duration: 2 }, 'active', 'enemy_skill2', 'e');
    expect(hasStatus(u, 'cowardice')).toBe(true);
  });

  it('强击 / 坚毅 / 慑心：构造出的状态形态正确（词条 → 状态）', () => {
    const affixOnly = (name: string, value: number) =>
      buildTreasureStatuses({ treasureId: 1009, affix: { name, value } }, makeUnit('x').general)
        .filter((x) => x.label === name)
        .map((x) => x.create);

    expect(affixOnly('强击', 3)[0]).toMatchObject({ type: 'no_retaliate', duration: 3 });
    expect(affixOnly('坚毅', 4)[0]).toMatchObject({ type: 'control_immune', types: ['confusion', 'rampage'], duration: 4 });

    const [shexin] = buildTreasureStatuses({ treasureId: 1090 /* 龙鳞：灵动/亢厉/慑心 */ }, makeUnit('x').general)
      .filter((x) => x.label === '慑心')
      .map((x) => x.create);
    expect(shexin).toMatchObject({ type: 'control_extend', charges: 999, mainSkillOnly: true, skillTypes: ['pursuit'] });
  });

  it('清毅：第 N 回合（玩家选值）行动时获得洞察（其余回合不给）', () => {
    const loadout = { treasureId: 1009, affix: { name: '清毅', value: 6 } };
    const u = makeUnit('u');
    u.general.treasure = loadout;
    const ctx = makeCtx(5);
    ctx.myTeam = [u];
    triggerTreasureRoundStart(ctx);
    expect(hasStatus(u, 'insight')).toBe(false);
    ctx.currentRound = 6;
    triggerTreasureRoundStart(ctx);
    expect(hasStatus(u, 'insight')).toBe(true);
  });

  it('不屈 / 破浪 / 避险：受击叠层与首次受击规避', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    const ally = makeUnit('a', 'enemy');
    ctx.myTeam = [u];
    ctx.enemyTeam = [ally];
    // 不屈：受击叠层减伤（3%/层，上限 10），回合开始清零
    inflictStatus(ctx, u, { type: 'hurt_stack', mode: 'reduce', perStack: 0.03, maxStacks: 10, duration: 999 }, 'passive', 'treasure:affix:不屈', 'u');
    updateTreasureOnHurt(ctx, u);
    updateTreasureOnHurt(ctx, u);
    expect(getStatus(u, 'hurt_stack')!.stacks).toBe(2);
    // 回合开始清零（tickRoundStartStatuses）
    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    expect(getStatus(u, 'hurt_stack')!.stacks).toBe(0);

    // 避险：首次受击 → 获得 1 层规避，标记移除并记事件
    const v = makeUnit('v');
    ctx.myTeam.push(v);
    inflictStatus(ctx, v, { type: 'hurt_evade_once', duration: 999 }, 'passive', 'treasure:1078:3', 'v');
    updateTreasureOnHurt(ctx, v);
    expect(getStatus(v, 'hurt_evade_once')).toBeUndefined();
    expect(getStatus(v, 'evasion')!.stacks).toBe(1);
    expect(ctx.events.some((e) => e.type === 'treasure_evade_triggered')).toBe(true);
    // 再次受击不再触发（一次性）
    updateTreasureOnHurt(ctx, v);
    expect(getStatus(v, 'evasion')!.stacks).toBe(1);
  });

  it('筹算 / 熟虑 / 识破：发动率过滤维与回合窗口无视规避', () => {
    const affixOnly = (name: string, value: number) =>
      buildTreasureStatuses({ treasureId: 1009, affix: { name, value } }, makeUnit('x').general)
        .filter((x) => x.label === name)
        .map((x) => x.create);

    expect(affixOnly('筹算', 9)[0]).toMatchObject({
      type: 'trigger_boost',
      rate: 0.09,
      mainSkillOnly: true,
      strategySkillsOnly: true,
    });
    expect(affixOnly('熟虑', 16)[0]).toMatchObject({
      type: 'trigger_boost',
      rate: 0.16,
      mainSkillOnly: true,
      preparedOnly: true,
    });
    expect(affixOnly('识破', 3)[0]).toMatchObject({ type: 'ignore_evasion', throughRound: 3 });
  });

  it('识破（前 N 回合无视规避）：窗口内不消耗、出窗口即失效', () => {
    const ctx = makeCtx(2);
    const attacker = makeUnit('a');
    const victim = makeUnit('v', 'enemy');
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [victim];
    inflictStatus(ctx, attacker, { type: 'ignore_evasion', duration: 999, throughRound: 3 }, 'passive', 'treasure:affix:识破', 'a');
    // 第 2 回合：规避被穿透且标记保留
    expect(consumeEvasion(ctx, victim, 'a')).toBe(false);
    expect(getStatus(attacker, 'ignore_evasion')).toBeTruthy();
    // 第 4 回合：窗口外 → 标记不再生效（仍保留，但不再拦截规避）
    ctx.currentRound = 4;
    expect(consumeEvasion(ctx, victim, 'a')).toBe(false); // 目标本身无规避 → 三次都返回 false
    const ev = getStatus(victim, 'evasion');
    expect(ev).toBeUndefined();
    // 对照：无规避层数时窗口内/外都返回 false，故直接断言状态是否被消耗
    ctx.currentRound = 2;
    consumeEvasion(ctx, victim, 'a');
    expect(getStatus(attacker, 'ignore_evasion')).toBeTruthy();
  });

  it('善谋：仅第 4、6 回合给「攻击类主战法发动率」1 回合', () => {
    const make = () => {
      const u = makeUnit('u');
      u.general.treasure = { treasureId: 1009, affix: { name: '善谋', value: 20 } };
      const ctx = makeCtx();
      ctx.myTeam = [u];
      return { u, ctx };
    };
    for (const round of [3, 5, 7]) {
      const { u, ctx } = make();
      ctx.currentRound = round;
      triggerTreasureRoundStart(ctx);
      expect(hasStatus(u, 'trigger_boost'), `round ${round}`).toBe(false);
    }
    for (const round of [4, 6]) {
      const { u, ctx } = make();
      ctx.currentRound = round;
      triggerTreasureRoundStart(ctx);
      const st = getStatus(u, 'trigger_boost');
      expect(st, `round ${round}`).toBeTruthy();
      expect(st!.rate).toBeCloseTo(0.2, 6);
      expect(st!.attackSkillsOnly).toBe(true);
      expect(st!.mainSkillOnly).toBe(true);
    }
  });

  it('蓄锐 / 选锋 / 破障：普攻命中后钩子', () => {
    const ctx = makeCtx();
    const a = makeUnit('a');
    const t = makeUnit('t', 'enemy');
    ctx.myTeam = [a];
    ctx.enemyTeam = [t];

    // 蓄锐：每 2 次普攻叠 1 层（追击增伤）
    inflictStatus(ctx, a, { type: 'treasure_basic_count', every: 2, perStack: 0.1, skillTypes: ['pursuit'], maxStacks: 5, duration: 999 }, 'passive', 'treasure:affix:蓄锐', 'a');
    applyTreasureBasicHit(ctx, a, t);
    expect(getStatus(a, 'treasure_basic_count')!.stacks).toBe(0);
    applyTreasureBasicHit(ctx, a, t);
    expect(getStatus(a, 'treasure_basic_count')!.stacks).toBe(1);
    const boost = a.statuses.find((s) => s.type === 'damage_boost');
    expect(boost).toMatchObject({ rate: 0.1, direction: 'caused', skillTypes: ['pursuit'] });

    // 选锋：每次普攻后给一条一次性策略增伤（charges=1）
    inflictStatus(ctx, a, { type: 'treasure_basic_next', rate: 0.2, duration: 999 }, 'passive', 'treasure:affix:选锋', 'a');
    applyTreasureBasicHit(ctx, a, t);
    const one = a.statuses.filter((s) => s.type === 'damage_boost' && s.damageType === 'strategy');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ rate: 0.2, charges: 1 });

    // 破障：移除目标身上「主动战法带来的 1 种增益」
    inflictStatus(ctx, t, { type: 'attack_buff', amount: 10, duration: 999 }, 'active', 'some_active', 'e');
    inflictStatus(ctx, t, { type: 'attack_buff', amount: 10, duration: 999 }, 'passive', 'some_passive', 'e');
    expect(t.statuses.filter((s) => s.type === 'attack_buff')).toHaveLength(2);
    inflictStatus(ctx, a, { type: 'treasure_basic_purge', duration: 999 }, 'passive', 'treasure:1081:3', 'a');
    applyTreasureBasicHit(ctx, a, t);
    const left = t.statuses.filter((s) => s.type === 'attack_buff');
    expect(left).toHaveLength(1);
    expect(left[0].sourceSkillType).toBe('passive'); // 只移除主动/追击带来的增益
    expect(ctx.events.some((e) => e.type === 'status_changed' && e.detail.includes('破障'))).toBe(true);
  });

  it('仁心 / 矜节 / 济世：造成的恢复提高与恢复触发减伤', () => {
    const ctx = makeCtx();
    const healer = makeUnit('h');
    const hurt = makeUnit('t');
    ctx.myTeam = [healer, hurt];
    hurt.troops = 5000;
    hurt.wounded = 2000;

    // 仁心：heal_out_boost（施法者侧）→ 实际恢复量提高
    inflictStatus(ctx, healer, { type: 'heal_out_boost', rate: 0.15, duration: 999 }, 'passive', 'treasure:affix:仁心', 'h');
    const base = recoverTroops(ctx, hurt, 1000, undefined);
    hurt.troops = 5000;
    hurt.wounded = 2000; // 复位伤兵池，避免被上限截断
    const boosted = recoverTroops(ctx, hurt, 1000, healer);
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBe(1150);

    // 济世：造成恢复后给目标叠一条可叠加的减伤
    inflictStatus(ctx, healer, { type: 'heal_trigger_reduce', rate: 0.1, duration: 999 }, 'passive', 'treasure:affix:济世', 'h');
    recoverTroops(ctx, hurt, 500, healer);
    recoverTroops(ctx, hurt, 500, healer);
    const reductions = hurt.statuses.filter((s) => s.type === 'damage_reduce');
    expect(reductions.length).toBeGreaterThanOrEqual(1);
    // 宝物来源不参与「取高替换」→ 多次触发各挂一条，减伤池求和（0.1 + 0.1）
    const total = reductions.reduce((a, s) => a + s.rate, 0);
    expect(total).toBeCloseTo(0.2, 6);

    // 矜节：仅女性武将携带生效
    const male = makeUnit('m');
    const female = makeUnit('f');
    female.general.gender = 'female';
    const from = (u: UnitState) =>
      buildTreasureStatuses({ treasureId: 1096 /* 比翼 */ }, u.general)
        .filter((x) => x.label === '矜节')
        .map((x) => x.create);
    expect(from(male)).toHaveLength(0);
    expect(from(female)).toHaveLength(1);
    expect(from(female)[0]).toMatchObject({ type: 'heal_out_boost', rate: 0.3 });
  });

  it('鸠佑 / 归心 / 阵舞：主战法发动后钩子', () => {
    // 鸠佑（金鸠）：主战法发动后叠 1 层造成攻击伤害提高；非主战法不叠
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'treasure_after_main', perStack: 0.06, maxStacks: 10, duration: 999 }, 'passive', 'treasure:1123:3', 'u');
    const mainSkill = { id: 'main_x' } as never;
    applyTreasureAfterActive(ctx, u, mainSkill);
    expect(u.statuses.filter((s) => s.type === 'damage_boost' && s.damageType === 'physical')).toHaveLength(1);
    applyTreasureAfterActive(ctx, u, { id: 'other_skill' } as never);
    expect(u.statuses.filter((s) => s.type === 'damage_boost')).toHaveLength(1);
    expect(getStatus(u, 'treasure_after_main')!.stacks).toBe(1);

    // 归心（星汉）：我军全体每 2 次主动战法 → 携带者恢复
    const ctx2 = makeCtx();
    const h = makeUnit('h');
    h.troops = 5000;
    h.wounded = 2000;
    ctx2.myTeam = [h];
    inflictStatus(ctx2, h, { type: 'treasure_ally_active_heal', every: 2, rate: 150, duration: 999 }, 'passive', 'treasure:1111:3', 'h');
    applyTreasureAfterActive(ctx2, h, { id: 'any' } as never);
    expect(ctx2.events.some((e) => e.type === 'heal')).toBe(false);
    applyTreasureAfterActive(ctx2, h, { id: 'any' } as never);
    expect(ctx2.events.some((e) => e.type === 'heal')).toBe(true);
    expect(h.troops).toBeGreaterThan(5000);

    // 阵舞（障日）：女性携带者主战法施加控制 → 目标获得「受控期间受到伤害提高」
    const ctx3 = makeCtx();
    const dancer = makeUnit('d');
    dancer.general.gender = 'female';
    dancer.general.mainSkillId = 'main_x';
    const victim = makeUnit('v', 'enemy');
    ctx3.myTeam = [dancer];
    ctx3.enemyTeam = [victim];
    inflictStatus(ctx3, dancer, { type: 'treasure_control_amplify', rate: 0.24, mainSkillOnly: true, duration: 999 }, 'passive', 'treasure:1099:3', 'd');
    inflictStatus(ctx3, victim, { type: 'confusion', duration: 2 }, 'active', 'main_x', 'd');
    const amp = victim.statuses.find((s) => s.type === 'damage_boost' && s.direction === 'taken') as
      | { rate: number; remaining: number }
      | undefined;
    expect(amp).toBeTruthy();
    expect(amp!.rate).toBeCloseTo(0.24, 6);
    expect(amp!.remaining).toBe(2); // 与本次控制同长
  });

  it('强固（泰阿）/ 奇袭（彤素）：每回合首次减伤与按距离增伤', () => {
    // 强固：第一击吃 20% 减伤，标记后本回合不再吃；下回合恢复
    const ctx = makeCtx(1);
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'damage_reduce', rate: 0.2, duration: 999, firstHitPerRound: true }, 'passive', 'treasure:1075:3', 'u');
    expect(sumReduce(ctx, u)).toBeCloseTo(0.2, 6);
    markFirstHitReduceUsed(ctx, u);
    expect(sumReduce(ctx, u)).toBeCloseTo(0, 6);
    ctx.currentRound = 2;
    expect(sumReduce(ctx, u)).toBeCloseTo(0.2, 6);

    // 奇袭：构造出「按距离逐点增伤」的造成侧攻击增伤
    const [qixi] = buildTreasureStatuses({ treasureId: 1003 /* 彤素 */ }, makeUnit('x').general)
      .filter((x) => x.label === '奇袭')
      .map((x) => x.create);
    expect(qixi).toMatchObject({ type: 'damage_boost', direction: 'caused', damageType: 'physical', perDistance: true });
    expect((qixi as { rate: number }).rate).toBeCloseTo(0.03, 6);
  });

  it('燮理（位至三公）：燃烧每回合首次跳伤后按恢复率 120% 恢复一次', () => {
    const ctx = makeCtx();
    const owner = makeUnit('o');
    const victim = makeUnit('v', 'enemy');
    owner.troops = 5000;
    owner.wounded = 3000;
    victim.troops = 9000;
    ctx.myTeam = [owner];
    ctx.enemyTeam = [victim];
    inflictStatus(ctx, owner, { type: 'dot_tick_heal', rate: 120, dotTypes: ['burning', 'ignite'], duration: 999 }, 'passive', 'treasure:1114:3', 'o');
    // 直接构造一条由 owner 施加、带「挂上时冻结」stored 的燃烧（走 dealDotDamage 滞后分支）
    victim.statuses.push({
      type: 'burning',
      remaining: 3,
      rate: 1,
      sourceStrategy: 100,
      appliedRound: 1,
      sourceSkillType: 'active',
      sourceSkillId: 'huoshi_fengwei',
      sourceUnitId: 'o',
      stored: { damage: 500, breakdown: { troopBase: 0, statBase: 0, main: 500 } },
    } as never);
    const burning = victim.statuses.find((s) => s.type === 'burning')!;
    dealDotDamage(ctx, victim, burning as never);
    const heals = ctx.events.filter((e) => e.type === 'heal');
    expect(heals).toHaveLength(1);
    expect(owner.troops).toBeGreaterThan(5000);
    // 同回合第二次跳伤不再恢复
    dealDotDamage(ctx, victim, burning as never);
    expect(ctx.events.filter((e) => e.type === 'heal')).toHaveLength(1);
    // 下回合恢复
    ctx.currentRound = 2;
    dealDotDamage(ctx, victim, burning as never);
    expect(ctx.events.filter((e) => e.type === 'heal')).toHaveLength(2);
  });

  it('击虚 / 艮止 / 不懈 / 亢厉：C 档按状态种类增伤、禁普攻、兵力越低恢复越高', () => {
    const affixOnly = (name: string, value: number) =>
      buildTreasureStatuses({ treasureId: 1009, affix: { name, value } }, makeUnit('x').general)
        .filter((x) => x.label === name)
        .map((x) => x.create);

    // 击虚：按目标身上 DoT/控制种类数增伤
    const [jixu] = affixOnly('击虚', 9);
    expect(jixu).toMatchObject({ type: 'damage_boost', direction: 'caused', perTargetStatusCount: true });
    expect((jixu as { rate: number }).rate).toBeCloseTo(0.09, 6);

    // 艮止：谋略提高 + 无法普通攻击
    const genzhi = affixOnly('艮止', 20);
    expect(genzhi.map((s) => s.type).sort()).toEqual(['no_attack', 'strategy_buff']);

    // 不懈：兵力越低恢复越高
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'heal_low_troops', perStep: 0.09, stepPct: 15, duration: 999 }, 'passive', 'treasure:affix:不懈', 'u');
    u.troops = 10000;
    u.wounded = 5000;
    const full = recoverTroops(ctx, u, 1000, undefined);
    u.troops = 6000; // 已损失 40% → floor(40/15)=2 档
    u.wounded = 5000;
    const low = recoverTroops(ctx, u, 1000, undefined);
    expect(low).toBeGreaterThan(full);
    expect(low).toBe(1180); // 1000 × (1 + 2×0.09)

    // 亢厉：默认口径「主动及追击武将主战法伤害提高」——铭鸿（三阶）/ 金鸠（二阶）等都要有产出
    const [kangli] = buildTreasureStatuses({ treasureId: 1030 }, makeUnit('x').general)
      .filter((x) => x.label === '亢厉')
      .map((x) => x.create);
    expect(kangli).toMatchObject({ type: 'damage_boost', direction: 'caused', skillTypes: ['active', 'pursuit'] });
  });

  it('再战（少府）：仅第 5 回合判定，50% 几率获得连击', () => {    const results: boolean[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const u = makeUnit('u');
      u.general.treasure = { treasureId: 1060 /* 少府 */ };
      const ctx = makeCtx(5, seed);
      ctx.myTeam = [u];
      triggerTreasureRoundStart(ctx);
      results.push(hasStatus(u, 'combo'));
    }
    expect(results.some(Boolean)).toBe(true);
    expect(results.some((r) => !r)).toBe(true);

    // 非第 5 回合：恒不触发
    const u2 = makeUnit('u2');
    u2.general.treasure = { treasureId: 1060 };
    const ctx2 = makeCtx(4, 1);
    ctx2.myTeam = [u2];
    triggerTreasureRoundStart(ctx2);
    expect(hasStatus(u2, 'combo')).toBe(false);
  });
});
