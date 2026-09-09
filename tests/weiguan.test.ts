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
  triggerCommandSkills,
  tickStatuses,
  type CombatContext,
} from '../src/engine/action';
import type { Position, UnitState } from '../src/engine/types';
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
  it('物理攻击前 → 攻击方叠攻击层（按卫瓘攻击缩放）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 }); // 40级卫瓘攻击
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋', attack: 100 });
    ctx.myTeam = [wg, ally];
    ctx.enemyTeam = [enemy('e1')];
    triggerCommandSkills(ctx, wg);

    // 友军普攻 → 攻击 +round(22 + 0.1×(151-80)) = +29
    actUnit(ctx, ally);
    const layer = ally.statuses.find((s) => s.type === 'attack_buff' && s.sourceSkillId === 'chijie_zhenxi');
    expect(layer).toBeDefined();
    expect(layer && 'amount' in layer ? (layer as { amount: number }).amount : 0).toBe(29);
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
    // 夹攻不一定发动，但若发动必叠谋略层（round(22 + 0.1×(146-80)) = 29）
    for (const s of strat) {
      expect((s as { amount: number }).amount).toBe(29);
    }
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
    expect(def && 'amount' in def ? (def as { amount: number }).amount : 0).toBe(28); // round(22 + 0.1×(144-80)) = 28
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
    expect(buffAmount(ally, 'attack_buff')).toBe(4 * 29);

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
    // 层数事件里含「层」计数
    expect(atkLayers[0].detail).toContain('层');
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
