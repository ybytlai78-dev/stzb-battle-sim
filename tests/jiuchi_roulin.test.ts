/**
 * 酒池肉林 × 帝临回光（用户 2026-10-19 报障）。
 *
 * 官方文本：前 2 回合我军全体受到的所有伤害降低 32%，此效果结束后 1 回合内
 * 我军全体造成的所有伤害大幅度降低，第 4 回合起自身攻击吸血。
 *
 * 报障现象：己方灵帝【帝临回光】的恐慌伤害整场只剩 10% 左右。
 * 根因：段二（第 3 回合「造成伤害 −9999%」）原先在 `tickRoundStartStatuses` 就挂上，
 * 早于 `triggerDelayedOutputs`——帝临回光第 3 回合的恐慌在施加时把 −99.99% 冻进
 * `stored`（DoT 挂上时结算），于是整场每一跳都按 10% 打。
 *
 * 现口径（本文件守住）：
 *  ① 段二必须晚于同回合的一类指挥 delayedOutput（`afterDelayedOutputs`），恐慌快照不吃它；
 *  ② 段二仍然在第 3 回合生效（不是被删掉），只是排序靠后；
 *  ③ 与不带酒池肉林的对照组相比，恐慌冻结伤害基本一致（旧实现约为 10%，会直接失败）。
 */
import { describe, it, expect } from 'vitest';
import {
  tickStatuses,
  tickRoundStartStatuses,
  triggerCommandSkills,
  triggerDelayedOutputs,
  triggerPostDelayedRoundStartCommands,
  type CombatContext,
} from '../src/engine/action';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { HUGE_MODIFIER_RATE } from '../src/engine/formulas';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(id: string, position: Position, opts: { strategy?: number; defense?: number } = {}): UnitState {
  const general: General = {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    defense: opts.defense ?? 100,
    strategy: opts.strategy ?? 100,
    speed: 50,
    attackRange: 3,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
  return {
    general,
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[]): CombatContext {
  return {
    rng: new Rng(11),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0, // 准备阶段
  };
}

/** 模拟第 1、2 回合结束的状态递减（段一 duration 2 在第 2 回合末过期），然后进入第 3 回合 */
function advanceToRound3(ctx: CombatContext): void {
  for (let round = 1; round <= 2; round++) {
    ctx.currentRound = round;
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
  }
  ctx.currentRound = 3;
}

const causedDebuff = (u: UnitState) =>
  u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      // 「大幅度降低」= −HUGE_MODIFIER_RATE（−1000%），旧口径的 −99.99 已统一成同一个哨兵
      s.type === 'damage_boost' && s.direction === 'caused' && s.rate <= -HUGE_MODIFIER_RATE
  );

function panicOf(u: UnitState) {
  const panic = u.statuses.find((s) => s.type === 'panic');
  if (!panic || panic.type !== 'panic' || !panic.stored) throw new Error(`${u.general.id} 没有带 stored 的恐慌`);
  return panic;
}

/** 灵帝 +（可选带酒池肉林的）队友，对 3 名敌军；返回第 3 回合恐慌冻结值 */
function runRound3(withDongzhuo: boolean) {
  const lingdi = makeUnit('lingdi', '大营', { strategy: 200 });
  lingdi.general.commandSkillIds = ['diling_huiguang'];
  const teammate = makeUnit('teammate', '前锋', { defense: 200 });
  if (withDongzhuo) teammate.general.commandSkillIds = ['jiuchi_roulin'];
  const enemies = [
    makeUnit('e1', '前锋'),
    makeUnit('e2', '中军'),
    makeUnit('e3', '大营'),
  ];
  for (const e of enemies) e.side = 'enemy';

  const ctx = makeCtx([lingdi, teammate], enemies);
  triggerCommandSkills(ctx, lingdi);
  triggerCommandSkills(ctx, teammate);
  advanceToRound3(ctx);

  tickRoundStartStatuses(ctx);
  // 段二在延迟指挥效果之前不得出现（否则恐慌快照会被压到 10%）
  expect(causedDebuff(lingdi)).toBeUndefined();
  triggerDelayedOutputs(ctx, 3);
  const panic = panicOf(enemies[0]!);
  const storedBeforeStage2 = panic.stored!.damage;
  triggerPostDelayedRoundStartCommands(ctx);

  return { ctx, lingdi, teammate, enemies, panic, storedBeforeStage2 };
}

describe('酒池肉林 × 帝临回光：第 3 回合减伤不冻结恐慌快照', () => {
  it('段二晚于 delayedOutput：恐慌不被冻成 10%，段二仍在第 3 回合生效', () => {
    const withDong = runRound3(true);
    const withoutDong = runRound3(false);

    // ① 恐慌快照的增减伤归因里没有酒池肉林（旧实现会带 rate −0.9999 的 caused 条目）
    const causedSkills = withDong.panic.stored!.modifiers.caused.map((m) => m.skillId);
    expect(causedSkills).not.toContain('jiuchi_roulin');

    // ② 与不带酒池肉林的对照组基本一致（旧实现只有约 10%）
    expect(withDong.storedBeforeStage2).toBeGreaterThan(withoutDong.storedBeforeStage2 * 0.9);

    // ③ 段二没有消失：延迟结算后挂在两名友军身上，仍是「大幅降低」，且只持续 1 回合
    const debuff = causedDebuff(withDong.lingdi);
    if (!debuff) throw new Error('酒池肉林段二没有在延迟结算后生效');
    expect(debuff.rate).toBeCloseTo(-HUGE_MODIFIER_RATE, 2);
    expect(debuff.remaining).toBe(1);
    expect(causedDebuff(withDong.teammate)).toBeTruthy();
  });
});
