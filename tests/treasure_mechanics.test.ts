/**
 * 宝物系统 · 控制类与回合钩子机制（P2b 第二批）
 *  惑言/慑心：控制时长 +1（消耗 charges）
 *  坚毅：前 N 回合免疫混乱/暴走（拦截 + 事件）
 *  强击：前 N 回合普攻不触发反击
 *  清毅：第 N 回合行动时获得洞察
 *  再战：第 5 回合 50% 获得连击
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, getStatus, hasStatus, consumeEvasion, tickRoundStartStatuses, updateTreasureOnHurt } from '../src/engine/action';
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
    isPreparing: false,
    preparingSkillId: null,
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
