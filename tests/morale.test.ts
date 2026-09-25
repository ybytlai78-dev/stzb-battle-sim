/**
 * 士气机制测试（v0.7）
 *   士气：每点 +0.6%，提升百分比四舍五入取整；120 士气 → +12%（系数 1.12）。
 *   士气影响带发动率属性的所有战法：主动/追击 = 发动率，指挥（预备负面 roundRepeat / 二类动态）/被动 = 生效几率。
 *   士气 100 时不变；士气影响做最终乘算，四舍五入取整到百分位，超过 100% 按 100%。
 *   测试统一按 120 士气打木桩。
 */
import { describe, it, expect } from 'vitest';
import { moraleRate } from '../src/engine/formulas';
import { Rng } from '../src/engine/rng';
import {
  actUnit,
  triggerRoundCommandOnAct,
  triggerCommandSkills,
  type CombatContext,
} from '../src/engine/action';
import type { Position, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(
  id: string,
  opts: { position?: Position; morale?: number; speed?: number } = {}
): UnitState {
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
      position: opts.position ?? '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: opts.speed ?? 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: opts.morale ?? 100,
    },
    side: 'my',
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('moraleRate 士气系数', () => {
  it('士气 100 不变（系数 1）', () => {
    expect(moraleRate(100)).toBe(1);
  });
  it('士气 120 → +12%（每点 0.6%，20×0.6=12 取整），系数 1.12', () => {
    expect(moraleRate(120)).toBe(1.12);
  });
  it('士气 80 → -12%，系数 0.88', () => {
    expect(moraleRate(80)).toBe(0.88);
  });
  it('士气 103 → +1.8% 四舍五入 +2%，系数 1.02', () => {
    expect(moraleRate(103)).toBe(1.02);
  });
  it('士气 102 → +1.2% 四舍五入 +1%，系数 1.01', () => {
    expect(moraleRate(102)).toBe(1.01);
  });
});

describe('士气 × 主动战法发动率', () => {
  it('士气 120：突进 25% → 25×1.12=28%（打木桩发动率提升）', () => {
    const ctx = makeCtx();
    const attacker = makeUnit('a', { position: '前锋', morale: 120 });
    attacker.general.activeSkillIds = ['tujin'];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [e1];

    actUnit(ctx, attacker);

    const triggers = ctx.events.filter(
      (e): e is Extract<import('../src/engine/types').BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'tujin'
    );
    // 本 seed 下判定成功（120 士气 28% 命中该次随机）
    expect(triggers.some((t) => t.success)).toBe(true);
  });

  it('士气 100：突进 25% 按原发动率（同一 seed 对照组）', () => {
    const ctx = makeCtx();
    const attacker = makeUnit('a', { position: '前锋', morale: 100 });
    attacker.general.activeSkillIds = ['tujin'];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [e1];

    actUnit(ctx, attacker);
    // 士气 100 不影响，发动率仍 25%（不因士气提升）
    const triggers = ctx.events.filter(
      (e): e is Extract<import('../src/engine/types').BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'tujin'
    );
    expect(triggers.some((t) => t.success)).toBe(true);
  });
});

describe('士气 × 追击战法发动率', () => {
  it('士气 120：温酒斩将 35% → 39%（固定随机 0.37，35% 不触发、39% 触发）', () => {
    // 注入固定 next()=0.37：介于 35%（士气100）与 39%（士气120）之间，确定性验证士气乘算
    const ctxWith = (next: number): CombatContext =>
      ({
        ...makeCtx(),
        rng: {
          next: () => next,
          int: () => 0,
          intInclusive: () => 0,
          chance: (p: number) => next < p,
        } as unknown as import('../src/engine/rng').Rng,
      });

    const runPursuit = (morale: number) => {
      const ctx = ctxWith(0.37);
      const attacker = makeUnit('a', { position: '前锋', morale });
      attacker.general.pursuitSkillIds = ['wenjiu_zhanjiang'];
      const e1 = makeUnit('e1', { position: '前锋' });
      e1.side = 'enemy';
      ctx.myTeam = [attacker];
      ctx.enemyTeam = [e1];
      actUnit(ctx, attacker);
      return ctx.events.filter(
        (e): e is Extract<import('../src/engine/types').BattleEvent, { type: 'skill_trigger' }> =>
          e.type === 'skill_trigger' && e.skillId === 'wenjiu_zhanjiang'
      );
    };

    // 士气 100：35% → 0.37 >= 0.35 不触发
    const t100 = runPursuit(100);
    expect(t100.length).toBeGreaterThan(0);
    expect(t100.every((t) => t.success)).toBe(false);
    // 士气 120：39% → 0.37 < 0.39 触发
    const t120 = runPursuit(120);
    expect(t120.length).toBeGreaterThan(0);
    expect(t120.every((t) => t.success)).toBe(true);
  });
});

describe('士气 × 奇兵拒北（二类指挥动态发动率）', () => {
  it('士气 120：初始 30% → 30×1.12=33.6 取整 34%', () => {
    const ctx = makeCtx();
    const weiyan = makeUnit('weiyan', { position: '前锋', morale: 120 });
    weiyan.general.commandSkillIds = ['qibing_jubei'];
    const e1 = makeUnit('e1', { position: '前锋' });
    const e2 = makeUnit('e2', { position: '中军' });
    const e3 = makeUnit('e3', { position: '大营' });
    [e1, e2, e3].forEach((u) => (u.side = 'enemy'));
    ctx.myTeam = [weiyan];
    ctx.enemyTeam = [e1, e2, e3];

    triggerRoundCommandOnAct(ctx, weiyan);

    const triggers = ctx.events.filter(
      (e): e is Extract<import('../src/engine/types').BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'qibing_jubei'
    );
    expect(triggers.length).toBe(1);
    expect(triggers[0].success).toBe(true); // 34% 命中该次随机
  });
});

describe('士气 × 战必断金（一类指挥预备负面 roundRepeat）', () => {
  it('士气 120：90% 预备判定生效', () => {
    const ctx = makeCtx();
    const caster = makeUnit('caster', { position: '中军', morale: 120 });
    caster.general.commandSkillIds = ['zhanbi_duanjin'];
    // 手动锁定（准备阶段）：锁定敌方前锋
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.myTeam = [caster];
    ctx.enemyTeam = [e1];
    const skill = ctx.skills.get('zhanbi_duanjin')! as import('../src/engine/types').CommandSkill;
    ctx.lockedCommands.push({ skill, casterId: 'caster', targets: [e1], currentRate: 1 });

    ctx.currentRound = 1;
    actUnit(ctx, e1);

    // 90%×1.12 判定生效 → e1 怯战
    const cowardice = e1.statuses.filter((s) => s.type === 'cowardice');
    expect(cowardice.length).toBeGreaterThan(0);
  });
});

describe('战报几率显示（skill_trigger 携带士气修正后的当前生效几率，v0.14）', () => {
  type Trigger = Extract<import('../src/engine/types').BattleEvent, { type: 'skill_trigger' }>;

  it('追击判定：rate = 士气修正后生效几率、baseRate = 基础率、morale = 施法者士气（30%×1.12 → 34%）', () => {
    const ctx = makeCtx();
    const attacker = makeUnit('a', { position: '前锋', morale: 120 });
    attacker.general.pursuitSkillIds = ['fangzhen_tuji']; // 追击 30%
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.myTeam = [attacker];
    ctx.enemyTeam = [e1];
    actUnit(ctx, attacker);
    const t = ctx.events.find(
      (e): e is Trigger => e.type === 'skill_trigger' && e.skillId === 'fangzhen_tuji'
    );
    expect(t).toBeTruthy();
    expect(t!.rate).toBe(34); // round(30×1.12)=33.6 → 34
    expect(t!.baseRate).toBe(30);
    expect(t!.morale).toBe(120);
    expect(t!.targetId).toBeUndefined(); // 自身判定
  });

  it('奋疾先登（actLayer 速度对比判定）：70%×1.12 = 78%（用户示例【刘备】来自【乐进】的【奋疾先登】当前生效几率为78%）', () => {
    const ctx = makeCtx();
    const lejin = makeUnit('lejin', { position: '前锋', speed: 100, morale: 120 });
    lejin.general.commandSkillIds = ['fenji_xiandeng'];
    const ally = makeUnit('ally', { position: '中军', speed: 40 });
    const e1 = makeUnit('e1', { position: '前锋', speed: 20 });
    e1.side = 'enemy';
    ctx.myTeam = [lejin, ally];
    ctx.enemyTeam = [e1];
    actUnit(ctx, lejin);
    // 乐进速度高于所有对比目标 → 70% 基础 × 士气系数 1.12 = 78%
    const triggers = ctx.events.filter(
      (e): e is Trigger => e.type === 'skill_trigger' && e.skillId === 'fenji_xiandeng'
    );
    expect(triggers.length).toBeGreaterThan(0);
    for (const t of triggers) {
      expect(t.baseRate).toBe(70);
      expect(t.rate).toBe(78); // round(70×1.12)=78.4 → 78
      expect(t.morale).toBe(120);
      expect(t.targetId).toBeTruthy(); // 速度对比目标（被判定单位）
    }
  });

  it('战必断金（roundRepeat 预备负面）：90%×1.12 = 100%（封顶），targetId = 行动目标', () => {
    const ctx = makeCtx();
    const caster = makeUnit('caster', { position: '中军', morale: 120 });
    caster.general.commandSkillIds = ['zhanbi_duanjin'];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    ctx.myTeam = [caster];
    ctx.enemyTeam = [e1];
    const skill = ctx.skills.get('zhanbi_duanjin')! as import('../src/engine/types').CommandSkill;
    ctx.lockedCommands.push({ skill, casterId: 'caster', targets: [e1], currentRate: 1 });
    ctx.currentRound = 1;
    actUnit(ctx, e1);
    const t = ctx.events.find(
      (e): e is Trigger => e.type === 'skill_trigger' && e.skillId === 'zhanbi_duanjin'
    );
    expect(t).toBeTruthy();
    expect(t!.rate).toBe(100); // min(100, 90×1.12=100.8 → 101) 封顶 100
    expect(t!.baseRate).toBe(90);
    expect(t!.morale).toBe(120);
    expect(t!.targetId).toBe('e1'); // 目标行动时判定
  });

  it('持续型急救（first_aid）触发率受施法者士气：120 士气（56%）恢复次数 > 100 士气（50%）', () => {
    const run = (morale: number): number => {
      const ctx = makeCtx();
      const liubei = makeUnit('liubei', { position: '中军', morale });
      liubei.general.commandSkillIds = ['huangyi_liuli'];
      const u1 = makeUnit('u1', { position: '前锋' });
      ctx.myTeam = [liubei, u1];
      const e1 = makeUnit('e1', { position: '前锋' });
      e1.side = 'enemy';
      ctx.enemyTeam = [e1];
      triggerCommandSkills(ctx, liubei); // 准备阶段施加急救 + 战法级计数器
      // e1 反复普攻 u1（同种子同行动序列：仅触发率阈值不同）
      for (let i = 0; i < 20; i++) {
        actUnit(ctx, e1);
        if (!u1.alive) break;
      }
      return ctx.events.filter((e) => e.type === 'heal').length;
    };
    const h100 = run(100);
    const h120 = run(120);
    expect(h120).toBeGreaterThan(h100); // 56% > 50%：120 士气触发次数更多
  });
});
