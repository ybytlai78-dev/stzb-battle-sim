/**
 * 雪奋短兵（XP丁奉·吴步 h788 主战法）：被动 A，距离 5，目标自己。
 * 自身受到伤害时有 50.0% 概率进入规避状态，每回合结束时使自身攻击距离 −1；攻击距离小于等于 1 时，
 * 不再触发攻击距离下降及规避效果，同时每回合自身行动时，对攻击距离内的敌军单体造成 2 次攻击伤害
 * （伤害率 60.0%），有 70.0% 几率使攻击距离外的敌军群体进入动摇状态，行动时损失一定兵力
 * （伤害率 180.0%），持续 1 回合。
 * 官方：scripts/skill_extra.json id 200258（被动 A / 距离 5 / 自己 / 兵种步；
 *   1 级 规避 25% / 攻击 30% / 动摇 35%・90%）。来源 https://stzb.163.com/m/skilllist/200258.html
 * 入档：**下架** —— 动摇 180% 未写受谋略、成长率未确认（按基值不缩放）→ 登记 OFFLINE_MAIN_SKILLS。
 * 引擎配套（新机制「运行时攻击距离递减」）：`PassiveSkill.rangeDecayPerRound`（回合末 −1，降到 min 停）+
 *   `OnHurtConfig.casterAttackRangeAbove`（攻击距离 >1 才判受击规避）+ `roundStartRepeat.requireAttackRangeAtMost`
 *   （短兵段开关）+ `inflict_status.targetOutsideAttackRange`（动摇只打攻击距离外）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  applyDamage,
  triggerRangeDecayPassives,
  hasStatus,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { attackRangeOf } from '../src/engine/target';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'xuefen_duanbing';

function dummy(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 30000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function makeUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
    hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 把受击规避率 / 动摇几率拉满（只改 ctx 内副本，不动注册表）——机制断言不依赖 RNG 点数 */
function forceCertain(ctx: CombatContext): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'passive') return;
  if (s.onHurt && !Array.isArray(s.onHurt)) s.onHurt.rate = 1;
  for (const out of s.roundStartRepeat?.output ?? []) {
    if (out.kind === 'inflict_status') out.chance = 1;
  }
  ctx.skills.set(SKILL_ID, s);
}

/** 丁奉（前锋，攻距 3）+ 3 敌军（前锋/中军/大营 → 距离 1 / 2 / 3） */
function setup(seed = 1) {
  const caster = heroUnit('h788', '前锋', { passiveSkillIds: [SKILL_ID] });
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([caster], foes, seed);
  forceCertain(ctx);
  return { caster, foes, ctx };
}

describe('雪奋短兵（XP丁奉 h788）', () => {
  it('装配：注册表定义（被动·距离5·自己 + 递距/受击规避/短兵段）+ h788 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h788'];
    expect(hero.name).toBe('XP丁奉');
    expect(hero.mainSkillName).toBe('雪奋短兵');
    expect(hero.attackRange).toBe(3);
    expect(HERO_RECORDS['h788'].mainSkillId).toBe(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    expect(s.tags).toEqual(['evasion', 'damage', 'panic']);

    // ① 受击 50% 规避，且只在攻击距离 > 1 期间判定
    expect(s.onHurt).toMatchObject({
      victim: 'self',
      rate: 0.5,
      casterAttackRangeAbove: 1,
      applyTo: 'victim',
      output: [{ kind: 'grant_evasion', stacks: 1 }],
    });
    // ② 每回合结束攻击距离 −1，降到 1 停止
    expect(s.rangeDecayPerRound).toEqual({ perRound: 1, min: 1 });
    // ③ 攻击距离 ≤1 才结算：2 次 60% 攻击 + 70% 攻击距离外动摇 180%（duration 1）
    expect(s.roundStartRepeat?.requireAttackRangeAtMost).toBe(1);
    expect(s.roundStartRepeat?.output).toEqual([
      { kind: 'physical_damage', rate: 60, targetMode: 'random_single', range: 1 },
      { kind: 'physical_damage', rate: 60, targetMode: 'random_single', range: 1 },
      {
        kind: 'inflict_status',
        chance: 0.7,
        targetOutsideAttackRange: true,
        status: { type: 'panic', duration: 1, rate: 180, growthRate: 0 },
      },
    ]);

    // 动摇成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('机制·攻击距离递减：回合末 3→2→1，到 1 停止（同战法累加为一条 range_buff）', () => {
    const { caster, ctx } = setup(3);
    expect(attackRangeOf(caster)).toBe(3);

    triggerRangeDecayPassives(ctx);
    expect(attackRangeOf(caster)).toBe(2);
    triggerRangeDecayPassives(ctx);
    expect(attackRangeOf(caster)).toBe(1);
    // 已到 min：不再下降（官方「攻击距离小于等于 1 时，不再触发攻击距离下降」）
    triggerRangeDecayPassives(ctx);
    expect(attackRangeOf(caster)).toBe(1);

    const buffs = caster.statuses.filter((s) => s.type === 'range_buff');
    expect(buffs).toHaveLength(1); // 同战法重复施加走 amount 累加，不新增状态
    expect((buffs[0] as { amount: number }).amount).toBe(-2);
    // 战报可读：负值渲染为「攻击距离 -1」而非「+-1」
    const detail = eventsOf(ctx, 'status_inflicted').find((e) => e.statusType === 'range_buff')?.detail;
    expect(detail).toBe('攻击距离 -1 持续至战斗结束');
  });

  it('机制·受击规避：攻击距离 >1 时受击即进入规避；降到 1 后不再判定', () => {
    const { caster, foes, ctx } = setup(5);
    const foe = foes[0];

    // 攻击距离 3：受击触发（forceCertain 把触发率拉满）→ 规避 +1 层
    applyDamage(ctx, caster, 200, foe, 'physical', 'basic');
    expect(hasStatus(caster, 'evasion')).toBe(true);
    const ev = caster.statuses.find((s) => s.type === 'evasion') as { stacks: number };
    expect(ev.stacks).toBe(1);
    expect(
      eventsOf(ctx, 'status_inflicted').some((e) => e.statusType === 'evasion' && e.detail === '规避 +1 层'),
    ).toBe(true);
    expect(eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID)).toHaveLength(1);

    // 攻击距离降到 1 → 不再判定（casterAttackRangeAbove 门控）：无规避、无战法结算事件
    triggerRangeDecayPassives(ctx);
    triggerRangeDecayPassives(ctx);
    expect(attackRangeOf(caster)).toBe(1);
    caster.statuses = caster.statuses.filter((s) => s.type !== 'evasion');
    ctx.events = [];
    applyDamage(ctx, caster, 200, foe, 'physical', 'basic');
    expect(hasStatus(caster, 'evasion')).toBe(false);
    expect(eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID)).toHaveLength(0);
  });

  it('短兵段：攻击距离 >1 时整段不结算；=1 后每回合 2 次攻击打距离内单体 + 动摇只打距离外', () => {
    const { caster, foes, ctx } = setup(7);

    // 第 1 回合（攻距 3）：不进入短兵段，无本战法伤害
    actUnit(ctx, caster);
    expect(eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID)).toHaveLength(0);

    // 两回合末递减 → 第 3 回合攻距 1
    ctx.events = [];
    triggerRangeDecayPassives(ctx);
    triggerRangeDecayPassives(ctx);
    ctx.currentRound = 3;
    actUnit(ctx, caster);

    const dmg = eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
    expect(dmg).toHaveLength(2); // 2 次攻击伤害（各 rate 60）
    expect(dmg.map((e) => e.targetId)).toEqual(['foe-front', 'foe-front']); // 攻击距离内单体（距离 1）
    expect(dmg.every((e) => e.breakdown && e.damage > 0)).toBe(true);

    // 动摇：只打攻击距离外（中军/大营），距离内前锋不沾
    const panic = eventsOf(ctx, 'status_inflicted').filter((e) => e.statusType === 'panic');
    expect(panic.map((e) => e.unitId).sort()).toEqual(['foe-back', 'foe-mid']);
    const front = foes[0];
    expect(front.statuses.some((s) => s.type === 'panic')).toBe(false);
    const midStatus = foes[1].statuses.find((s) => s.type === 'panic') as
      | { rate: number; remaining: number }
      | undefined;
    expect(midStatus).toMatchObject({ rate: 180, remaining: 1 }); // 官方「持续 1 回合」
    // 短兵段本身不在攻击距离内的目标身上
    expect(eventsOf(ctx, 'damage').filter((e) => e.targetId !== 'foe-front')).toHaveLength(0);
  });

  it('整场跑通（runBattle）：第 3 回合起进入短兵段，距离递减与被动手打事件齐全', () => {
    const hero: General = {
      ...withSkills(level40(HERO_REGISTRY['h788']), { passiveSkillIds: [SKILL_ID] }),
      position: '前锋',
    };
    const report = runBattle({
      seed: 17,
      maxRounds: 8,
      myTeam: [hero, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    // 攻击距离递减：准备阶段 3 → 第 1 回合末 2、第 2 回合末 1（此后不再下降）
    const rangeEvents = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'range_buff',
    );
    expect(rangeEvents.length).toBeGreaterThanOrEqual(1);
    // 短兵段 2 次攻击（第 3 回合起，每回合 2 条；斩首制提前结束也算）
    const skillDmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === SKILL_ID,
    );
    expect(skillDmg.length).toBeGreaterThanOrEqual(2);
    expect(skillDmg.length % 2).toBe(0);
    // 动摇（panic DoT）至少命中过距离外目标
    expect(
      report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'panic'),
    ).toBe(true);
  });
});
