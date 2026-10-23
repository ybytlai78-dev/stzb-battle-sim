/**
 * 链式战法（含子战法的战法）的**杀伤统计归属 + 子战法标识**（用户 2026-10-23 报障）。
 *
 * 报障：「战报统计里部分含子战法的战法统计不到杀伤」，点名的有王允【连环计】、典藏【河内世泽】；
 * 口径「参照刘秀（光武中兴）的战报统计方式」——事件归父战法、子战法名另标。
 *
 * 本文件守住的契约：
 *  ① 子战法的 damage / skill_cast / status 事件 `skillId` / `skillName` = **父战法**，
 *     子战法名放在 `subSkill`（详情战报据此显示「连环计·伐谋」「河内世泽·火辎」）；
 *  ② `computeDetailedStats` 里父战法一行拿到全部次数与杀伤，子战法不再单独成行（= 报障的「杀伤 0」消失）；
 *  ③ 子战法挂出的 DoT（火辎 / 毒泉）状态 `sourceSkillId` = 父战法 —— 否则滞后跳伤（本步之后才发生）
 *     会继续记在子战法那一行，杀伤仍然漏；
 *  ④ 其徐如林（司马懿·晋 h807）的**相邻跳伤 = 包内机制码 546 株杀（诛杀）**：该笔伤害事件带
 *     `subSkill: '诛杀'`，详情战报在其旁边标〈诛杀〉。
 */
import { describe, it, expect } from 'vitest';
import { triggerActiveSkill, type CombatContext, type LockedCommand } from '../src/engine/action';
import { computeDetailedStats } from '../src/engine/stats';
import type { BattleEvent, CommandSkill, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';
import { reportToText } from '../src/engine/report';

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

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 7): CombatContext {
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

/** 必定发动（去掉发动率对断言的影响） */
const sure = (id: string, patch: Partial<Skill> = {}): Skill =>
  ({ ...(SKILL_REGISTRY[id] as Skill), triggerRate: 1, ...patch }) as Skill;

function cast(ctx: CombatContext, caster: UnitState, skill: Skill) {
  triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
}

type DamageEv = Extract<BattleEvent, { type: 'damage' }>;
const damages = (ctx: CombatContext): DamageEv[] =>
  ctx.events.filter((e): e is DamageEv => e.type === 'damage');

describe('连环计（王允 h693）· 子战法归属父战法', () => {
  const setup = () => {
    // 谋略 120 > 目标 60 → 迷阵那一步也会结算（伐谋 → 迷阵 两段伤害）
    const caster = unit(general('wangyun', '大营', { strategy: 120, attackRange: 4 }), 'my');
    const foes = [
      unit(general('e1', '前锋', { strategy: 60 }), 'enemy'),
      unit(general('e2', '中军', { strategy: 60 }), 'enemy'),
    ];
    const ctx = makeCtx([caster], foes);
    cast(ctx, caster, sure('lianhuanji'));
    return { ctx, caster, foes };
  };

  it('伤害事件记父战法（连环计），子战法名放 subSkill', () => {
    const { ctx } = setup();
    const dmg = damages(ctx);
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      expect(d.skillId).toBe('lianhuanji');
      expect(d.skillName).toBe('连环计');
      expect(d.subSkill).toBeTruthy();
    }
    expect(new Set(dmg.map((d) => d.subSkill))).toContain('伐谋');
  });

  it('skill_cast / skill_target 也记父战法，并带子战法名', () => {
    const { ctx } = setup();
    // 父战法自身的「发动」那一条不带 subSkill（它不是子战法），子战法的每一条都带
    const casts = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast'
    );
    expect(casts.every((c) => c.skillId === 'lianhuanji' && c.skillName === '连环计')).toBe(true);
    const chainCasts = casts.filter((c) => c.subSkill);
    expect(chainCasts.length).toBeGreaterThan(0);
    expect(chainCasts.map((c) => c.subSkill)).toContain('伐谋');
    expect(casts.length - chainCasts.length).toBe(1); // 只剩连环计自身那一次

    const targets = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_target' }> => e.type === 'skill_target'
    );
    expect(targets.every((t) => t.skillId === 'lianhuanji')).toBe(true);
    expect(targets.filter((t) => t.subSkill).length).toBeGreaterThan(0);
  });

  it('统计里【连环计】一行拿到次数与杀伤，子战法不再单独成行（报障的「杀伤 0」）', () => {
    const { ctx, caster, foes } = setup();
    const stats = computeDetailedStats(ctx.events, [caster, ...foes]);
    const row = stats.find((s) => s.unitId === 'wangyun');
    expect(row).toBeTruthy();
    const main = row!.skills.find((s) => s.skillId === 'lianhuanji');
    expect(main).toBeTruthy();
    expect(main!.castCount).toBeGreaterThan(0);
    expect(main!.damage).toBeGreaterThan(0);
    // 子战法（伐谋 / 迷阵 / 落雷）不再有自己的统计行
    for (const sub of ['famou', 'mizhen', 'luolei']) {
      expect(row!.skills.find((s) => s.skillId === sub)).toBeUndefined();
    }
    // 父战法一行的杀伤 = 全部子战法伤害之和
    const total = damages(ctx).reduce((a, d) => a + d.damage, 0);
    expect(main!.damage).toBe(total);
  });

  it('文本战报标出子战法（【连环计·伐谋】与伤害行〈伐谋〉）', () => {
    const { ctx, caster, foes } = setup();
    const text = reportToText({
      events: ctx.events,
      myTeam: [caster.general],
      enemyTeam: foes.map((f) => f.general),
      seed: 7,
      maxRounds: 1,
      result: 'win',
      rounds: 1,
      finalMyTroops: [caster.troops],
      finalEnemyTroops: foes.map((f) => f.troops),
      finalMyWounded: [0],
      finalEnemyWounded: [0],
      finalMyDead: [0],
      finalEnemyDead: [0],
      stats: [],
    } as unknown as Parameters<typeof reportToText>[0]);
    expect(text).toContain('【连环计·伐谋】');
    expect(text).toContain('〈伐谋〉');
  });
});

describe('河内世泽（典藏）· 子战法归属父战法', () => {
  it('随机到的子战法伤害记【河内世泽】，DoT 状态的 sourceSkillId 也是河内世泽（滞后跳伤才算得到）', () => {
    const caster = unit(general('simayi', '大营', { strategy: 130 }), 'my');
    const foes = [
      unit(general('e1', '前锋'), 'enemy'),
      unit(general('e2', '中军'), 'enemy'),
      unit(general('e3', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([caster], foes, 11);
    // 多放几次，覆盖两组随机（组 1：落雷/迷阵/溃堤/夹攻；组 2：伐谋/雀伏/火辎/毒泉）
    for (let i = 0; i < 10; i++) cast(ctx, caster, sure('heneishize'));

    const dmg = damages(ctx);
    expect(dmg.length).toBeGreaterThan(0);
    for (const d of dmg) {
      expect(d.skillId).toBe('heneishize');
      expect(d.skillName).toBe('河内世泽');
      expect(d.subSkill).toBeTruthy();
    }

    // DoT（火辎=燃烧 / 毒泉）状态必须挂父战法 id：跳伤发生在这一步之后，只靠事件窗口标不到
    const dots = foes.flatMap((f) => f.statuses.filter((s) => ['burning', 'sorcery', 'curse', 'panic'].includes(s.type)));
    for (const s of dots) expect(s.sourceSkillId).toBe('heneishize');

    const stats = computeDetailedStats(ctx.events, [caster, ...foes]);
    const row = stats.find((s) => s.unitId === 'simayi')!;
    const main = row.skills.find((s) => s.skillId === 'heneishize')!;
    expect(main.castCount).toBeGreaterThan(0);
    expect(main.damage).toBe(dmg.reduce((a, d) => a + d.damage, 0));
  });
});

describe('其徐如林（司马懿·晋 h807）· 诛杀标注', () => {
  it('相邻跳伤那笔伤害带 subSkill「诛杀」，统计仍计入【其徐如林】', () => {
    const sima = unit(general('simayi', '大营', { strategy: 150 }), 'my');
    const ally = unit(general('a1', '中军', { strategy: 120 }), 'my');
    const foes = [
      unit(general('e1', '前锋'), 'enemy'),
      unit(general('e2', '中军'), 'enemy'),
      unit(general('e3', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([sima, ally], foes, 5);
    // 一类指挥光环按准备阶段锁定；单元级直接塞进 lockedCommands
    ctx.lockedCommands.push({
      skill: SKILL_REGISTRY.qixu_rulin as CommandSkill,
      casterId: 'simayi',
      targets: [],
      currentRate: 1,
    } satisfies LockedCommand);

    // 友军打策略伤害 → 目标相邻敌军额外吃一次跳伤
    cast(ctx, ally, sure('luolei'));

    const splash = damages(ctx).filter((d) => d.skillId === 'qixu_rulin');
    expect(splash.length).toBeGreaterThan(0);
    for (const s of splash) {
      expect(s.skillName).toBe('其徐如林');
      expect(s.subSkill).toBe('诛杀');
    }

    const stats = computeDetailedStats(ctx.events, [sima, ally, ...foes]);
    const row = stats.find((s) => s.unitId === 'simayi')!;
    const main = row.skills.find((s) => s.skillId === 'qixu_rulin')!;
    expect(main.damage).toBe(splash.reduce((a, d) => a + d.damage, 0));
  });

  it('文本战报在跳伤行前标〈诛杀〉', () => {
    const sima = unit(general('simayi', '大营', { strategy: 150 }), 'my');
    const ally = unit(general('a1', '中军', { strategy: 120 }), 'my');
    const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '中军'), 'enemy')];
    const ctx = makeCtx([sima, ally], foes, 6);
    ctx.lockedCommands.push({
      skill: SKILL_REGISTRY.qixu_rulin as CommandSkill,
      casterId: 'simayi',
      targets: [],
      currentRate: 1,
    } satisfies LockedCommand);
    cast(ctx, ally, sure('luolei'));

    const text = reportToText({
      events: ctx.events,
      myTeam: [sima.general, ally.general],
      enemyTeam: foes.map((f) => f.general),
      seed: 6,
      maxRounds: 1,
      result: 'win',
      rounds: 1,
      finalMyTroops: [sima.troops, ally.troops],
      finalEnemyTroops: foes.map((f) => f.troops),
      finalMyWounded: [0, 0],
      finalEnemyWounded: [0, 0],
      finalMyDead: [0, 0],
      finalEnemyDead: [0, 0],
      stats: [],
    } as unknown as Parameters<typeof reportToText>[0]);
    expect(text).toContain('〈诛杀〉');
  });
});
