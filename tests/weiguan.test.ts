/**
 * 持节镇西（卫瓘）机制测试（v0.5）
 *  一类指挥·常驻伤害前叠层：
 *  - 友军造成攻击伤害前 → 攻击 +perStack（受卫瓘攻击属性缩放），可叠 4 层，每层持续 1 回合
 *  - 友军造成策略伤害前 → 谋略 +perStack（受卫瓘谋略缩放）
 *  - 友军受到伤害前 → 防御 +perStack（受卫瓘防御缩放）
 *  - 每层各自持续 1 回合（回合结束掉 1 层），至多 4 层封顶
 *  - 卫瓘阵亡后效果仍存在（一类指挥 retainAfterDeath）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import {
  actUnit,
  inflictStatus,
  triggerActiveSkill,
  triggerCommandSkills,
  tickStatuses,
  type CombatContext,
} from '../src/engine/action';
import type { Position, Skill, UnitState } from '../src/engine/types';
import { targetStratMitigation } from '../src/engine/formulas';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { level40, withSkills, HERO_REGISTRY, initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function makeUnit(
  id: string,
  opts: { position?: Position; attack?: number; defense?: number; strategy?: number; troops?: number } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '晋',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: opts.defense ?? 100,
      strategy: opts.strategy ?? 100,
      speed: 50,
      attackRange: 3,
      maxTroops: opts.troops ?? 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: opts.troops ?? 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(11),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function enemy(id: string): UnitState {
  const u = makeUnit(id, { position: '前锋' });
  u.side = 'enemy';
  return u;
}

function buffLayers(u: UnitState, type: 'attack_buff' | 'strategy_buff' | 'defense_buff'): number {
  return u.statuses.filter((s) => s.type === type && s.sourceSkillId === 'chijie_zhenxi').length;
}

function buffAmount(u: UnitState, type: 'attack_buff' | 'strategy_buff' | 'defense_buff'): number {
  return u.statuses
    .filter((s) => s.type === type && s.sourceSkillId === 'chijie_zhenxi')
    .reduce((acc, s) => acc + ('amount' in s ? s.amount : 0), 0);
}

describe('持节镇西：准备阶段注册', () => {
  it('一类指挥：准备阶段释放一次，注册到 ctx.stackBuffs', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军' });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    ctx.myTeam = [wg];
    ctx.enemyTeam = [enemy('e1')];

    triggerCommandSkills(ctx, wg);
    const casts = ctx.events.filter((e) => e.type === 'skill_cast' && e.skillName === '持节镇西');
    expect(casts.length).toBe(1);
    expect(ctx.stackBuffs.length).toBe(1);
    expect(ctx.stackBuffs[0].casterId).toBe('weiguan');
  });
});

describe('持节镇西：攻击/谋略/防御叠层', () => {
  it('攻击前 → 攻击方叠攻击层（按卫瓘攻击缩放）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 }); // 40级卫瓘攻击
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋', attack: 100 });
    ctx.myTeam = [wg, ally];
    const e1 = enemy('e1');
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    // 友军普攻 → 攻击 +round(22 + 0.15×(151-80)) = +33；增加后 100+33=133
    actUnit(ctx, ally);
    const layer = ally.statuses.find((s) => s.type === 'attack_buff' && s.sourceSkillId === 'chijie_zhenxi');
    expect(layer).toBeDefined();
    expect(layer && 'amount' in layer ? (layer as { amount: number }).amount : 0).toBe(33);
    const ev = ctx.events.find(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'attack_buff'
    );
    expect(ev?.detail).toBe(
      '【ally】执行来自【weiguan】的【持节镇西】效果！\n' +
        '【ally】的攻击属性提高了33(133)'
    );
    // 打敌军：出手方只加攻击，不加防御（防御仅受击前）
    expect(buffLayers(ally, 'defense_buff')).toBe(0);
    expect(buffLayers(e1, 'defense_buff')).toBe(0);
    const inflicted = ctx.events.filter((e) => e.type === 'status_inflicted');
    expect(inflicted.every((e) => e.statusType === 'attack_buff')).toBe(true);
  });

  it('策略伤害前 → 施法者叠谋略层（按卫瓘谋略缩放）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', strategy: 146 }); // 40级卫瓘谋略
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋', strategy: 150 });
    ally.general.activeSkillIds = ['jiagong']; // 夹攻：策略伤害
    ctx.myTeam = [wg, ally];
    ctx.enemyTeam = [enemy('e1')];
    triggerCommandSkills(ctx, wg);

    actUnit(ctx, ally); // 有 45% 概率发动夹攻
    const strat = ally.statuses.filter((s) => s.type === 'strategy_buff' && s.sourceSkillId === 'chijie_zhenxi');
    // 夹攻不一定发动，但若发动必叠谋略层（round(22 + 0.15×(146-80)) = 32）
    for (const s of strat) {
      expect((s as { amount: number }).amount).toBe(32);
    }
  });

  it('策略伤害结算使用叠层后的生效谋略（谋略基础按叠后值）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', strategy: 146 });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋', strategy: 150, troops: 10000 });
    ctx.myTeam = [wg, ally];
    const e1 = enemy('e1');
    e1.general.strategy = 100;
    e1.general.defense = 100;
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    /** 必中单体谋略伤：无受谋略缩放，隔离「谋略基础」是否吃到叠层 */
    const skill: Skill = {
      id: 'test_stg',
      name: '测试谋略伤',
      type: 'active',
      prepare: false,
      range: 5,
      triggerRate: 1,
      targetMode: 'single',
      tags: ['damage'],
      output: [{ kind: 'strategy_damage', rate: 100, strategyScaled: false, growthRate: 0 }],
    };
    triggerActiveSkill(ctx, ally, skill, ctx.enemyTeam, ctx.myTeam, ctx.enemyTeam);

    expect(buffLayers(ally, 'strategy_buff')).toBe(1);
    const stgEv = ctx.events.find(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'strategy_buff'
    );
    expect(stgEv?.detail).toBe(
      '【ally】执行来自【weiguan】的【持节镇西】效果！\n' +
        '【ally】的谋略属性提高了32(182)'
    );
    const dmg = ctx.events.find(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'damage' }> =>
        e.type === 'damage' && e.damageType === 'strategy'
    );
    expect(dmg).toBeDefined();
    // 叠层后谋略 150+32=182；谋略基础 = round(182 × 0.5 × 目标谋略减伤)
    const mit = targetStratMitigation(100);
    expect(dmg!.breakdown.base).toBe(Math.round(182 * 0.5 * mit));
    expect(dmg!.breakdown.base).not.toBe(Math.round(150 * 0.5 * mit));
    expect(buffLayers(ally, 'defense_buff')).toBe(0);
    expect(buffLayers(e1, 'defense_buff')).toBe(0);
  });

  it('燃烧跳伤前 → 友军施法者叠谋略、不叠防御', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', strategy: 146 });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋', strategy: 150 });
    ctx.myTeam = [wg, ally];
    const e1 = enemy('e1');
    e1.general.attackRange = 0; // 跳伤后不普攻，隔离出手叠层
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    inflictStatus(
      ctx,
      e1,
      { type: 'burning', rate: 100, duration: 2, growthRate: 0.5, sourceStrategy: 150 },
      'pursuit',
      'liehuo_fenzhou',
      'ally'
    );
    expect(buffLayers(ally, 'strategy_buff')).toBe(0);

    actUnit(ctx, e1);
    expect(buffLayers(ally, 'strategy_buff')).toBe(1);
    expect(buffLayers(ally, 'defense_buff')).toBe(0);
    expect(buffLayers(ally, 'attack_buff')).toBe(0);
    const stgEv = ctx.events.find(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'strategy_buff'
    );
    expect(stgEv?.detail).toContain('谋略属性提高了');
    expect(stgEv?.detail).not.toContain('防御属性');
  });

  it('友军被燃烧跳伤前 → 受击者叠防御、不叠攻击', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', defense: 144 });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    ally.general.attackRange = 0; // 跳伤后不普攻，隔离出手叠层
    ctx.myTeam = [wg, ally];
    const e1 = enemy('e1');
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    inflictStatus(
      ctx,
      ally,
      { type: 'burning', rate: 100, duration: 2, growthRate: 0.5, sourceStrategy: 100 },
      'active',
      'enemy_fire',
      'e1'
    );

    actUnit(ctx, ally);
    expect(buffLayers(ally, 'defense_buff')).toBe(1);
    expect(buffLayers(ally, 'attack_buff')).toBe(0);
    expect(buffLayers(ally, 'strategy_buff')).toBe(0);
    const defEv = ctx.events.find(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'defense_buff'
    );
    expect(defEv?.detail).toContain('防御属性提高了');
    expect(defEv?.detail).not.toContain('攻击属性');
  });

  it('受到伤害前 → 受击者叠防御层（按卫瓘防御缩放）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', defense: 144 }); // 40级卫瓘防御
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = enemy('e1');
    e1.general.attackRange = 1; // 能打到 ally
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    actUnit(ctx, e1); // 敌方普攻 ally
    const def = ally.statuses.find((s) => s.type === 'defense_buff' && s.sourceSkillId === 'chijie_zhenxi');
    expect(def).toBeDefined();
    expect(def && 'amount' in def ? (def as { amount: number }).amount : 0).toBe(32); // round(22 + 0.15×(144-80)) = 32
    const defEv = ctx.events.find(
      (e): e is Extract<(typeof ctx.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'defense_buff'
    );
    // ally 默认防御 100 +32 = 132
    expect(defEv?.detail).toContain('防御属性提高了32(132)');
    expect(defEv?.detail).not.toContain('层');
  });
});

describe('持节镇西：叠层上限与衰减', () => {
  it('友军伤害只给持有者友军叠层，不给敌军', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军' });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋', defense: 1000, troops: 100000 }); // 高防高血，避免被普攻打死
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    // 友军普攻敌方 → 敌方受击，但敌方不是卫瓘友军，不给敌方叠防御
    actUnit(ctx, ally);
    expect(buffLayers(e1, 'defense_buff')).toBe(0);
    expect(buffLayers(ally, 'attack_buff')).toBeGreaterThan(0);
  });

  it('至多 4 层封顶；每层各自持续 1 回合，回合结束掉 1 层', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 }); // 40级卫瓘攻击
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋', defense: 1000, troops: 100000 }); // 高防高血，保证 6 连击全中
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    // 同一回合内连击：连续多次普攻叠层（模拟高频出手）
    for (let i = 0; i < 6; i++) {
      actUnit(ctx, ally);
    }
    // 同回合内每次普攻都叠 1 层，封顶 4 层
    expect(buffLayers(ally, 'attack_buff')).toBe(4);
    expect(buffAmount(ally, 'attack_buff')).toBe(4 * 33);

    // 行动中施加的叠层：回合末不减，持续到该单位下次行动开始前
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(buffLayers(ally, 'attack_buff')).toBe(4);

    // 下回合行动开始前：旧 4 层各减 1 → 全部消散；本次行动又叠 1 层
    ctx.currentRound = 2;
    actUnit(ctx, ally);
    expect(buffLayers(ally, 'attack_buff')).toBe(1);
  });
});

describe('持节镇西：战斗级（40级面板）', () => {
  it('卫瓘+太史慈：普攻前叠攻击层，伤害随层数提升', () => {
    const report = runBattle({
      seed: 30001,
      maxRounds: 3,
      myTeam: [
        withSkills(level40(HERO_REGISTRY.weiguan), {}),
        withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), { pursuitSkillIds: ['fangzhen_tuji'] }),
      ],
      enemyTeam: [
        { id: 'ef', name: '木桩前', rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null, troopType: 'infantry', position: '前锋', attack: 50, defense: 60, strategy: 60, speed: 20, attackRange: 2, maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100 },
        { id: 'em', name: '木桩中', rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null, troopType: 'infantry', position: '中军', attack: 50, defense: 60, strategy: 60, speed: 15, attackRange: 2, maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100 },
      ],
    });

    const casts = report.events.filter((e) => e.type === 'skill_cast' && e.skillName === '持节镇西');
    expect(casts.length).toBe(1);
    const atkLayers = report.events.filter(
      (e): e is Extract<(typeof report.events)[number], { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'attack_buff' && e.unitId === 'taishici'
    );
    expect(atkLayers.length).toBeGreaterThan(0);
    expect(atkLayers[0].detail).toContain('执行来自');
    expect(atkLayers[0].detail).toMatch(/攻击属性提高了\d+\(\d+\)/);
    expect(atkLayers[0].detail).not.toContain('层');
  });

  it('卫瓘阵亡后持节镇西仍生效（retainAfterDeath）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军' });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    ctx.enemyTeam = [enemy('e1')];
    triggerCommandSkills(ctx, wg);

    wg.alive = false; // 卫瓘阵亡（一类指挥效果仍存在）
    actUnit(ctx, ally);
    expect(buffLayers(ally, 'attack_buff')).toBe(1);
  });
});
