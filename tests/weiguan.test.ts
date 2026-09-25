/**
 * 持节镇西（卫瓘）机制测试（v0.5）
 *  一类指挥·常驻伤害前叠层：
 *  - 友军造成攻击伤害前 → 攻击 +perStack（受卫瓘攻击属性缩放），可叠 4 层，每层持续 1 回合
 *  - 友军造成策略伤害前 → 谋略 +perStack（受卫瓘谋略缩放）
 *  - 友军受到伤害前 → 防御 +perStack（受卫瓘防御缩放）
 *  - 每层各自持续 1 回合（回合结束掉 1 层），至多 4 层封顶
 *  - 卫瓘阵亡后效果仍存在（一类指挥 retainAfterDeath）
 *  - 属性提升「之前」判定（举贤决机）：叠层**之前**先判一次（汉荀彧 → 被提升者恢复兵力）
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
  type LockedCommand,
} from '../src/engine/action';
import type { BattleEvent, CommandSkill, CreateStatus, Position, Skill, UnitState } from '../src/engine/types';
import { calcHealAmount, targetStratMitigation } from '../src/engine/formulas';
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
    preparations: [],
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

/** 测试用必中追击战法（每次普攻命中后 100% 再打一次攻击伤害 → 各叠 1 层） */
function probePursuit(id: string): Skill {
  return {
    id,
    name: id,
    type: 'pursuit',
    range: 0,
    triggerRate: 1,
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
  };
}

/** 汉荀彧（h794）单位：只作「举贤决机」施法者（判定按 h794 面板谋略 / 兵力） */
function juxianCaster(position: Position = '大营'): UnitState {
  const g = withSkills(level40(HERO_REGISTRY.h794), { commandSkillIds: [] });
  return { ...makeUnit('h794', { position }), general: { ...g, position }, troops: g.maxTroops };
}

/** 直接锁定「举贤决机」并把两条规则的触发率改成 rate（确定性单测，免走准备阶段） */
function lockJuxian(ctx: CombatContext, caster: UnitState, rate = 1): void {
  const cloned = structuredClone(SKILL_REGISTRY['juxian_jueji']) as CommandSkill;
  cloned.onAttrChange = (cloned.onAttrChange ?? []).map((r) => ({ ...r, rate }));
  const locked: LockedCommand = {
    skill: cloned,
    casterId: caster.general.id,
    targets: ctx.myTeam,
    currentRate: 1,
  };
  ctx.lockedCommands.push(locked);
}

const juxianHeals = (src: { events: BattleEvent[] }) =>
  src.events.filter(
    (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillId === 'juxian_jueji'
  );

const juxianTriggers = (src: { events: BattleEvent[] }) =>
  src.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
      e.type === 'skill_trigger' && e.skillId === 'juxian_jueji'
  );

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

  it('至多 4 层封顶：单次行动内 6 次攻击伤害也只保留 4 层', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 }); // 40级卫瓘攻击
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    // 连击 2 次普攻 + 每次普攻命中后 2 个必中追击 = 单次行动 6 次攻击伤害
    ally.general.pursuitSkillIds = ['test_pursuit_a', 'test_pursuit_b'];
    ctx.skills.set('test_pursuit_a', probePursuit('test_pursuit_a'));
    ctx.skills.set('test_pursuit_b', probePursuit('test_pursuit_b'));
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋', defense: 1000, troops: 100000 }); // 高防高血，保证 6 次攻击全部命中
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);
    inflictStatus(ctx, ally, { type: 'combo', duration: 999 } as CreateStatus, 'passive', 'test_combo');

    actUnit(ctx, ally);
    // 6 次攻击伤害 → 同来源封顶 4 层
    expect(buffLayers(ally, 'attack_buff')).toBe(4);
    expect(buffAmount(ally, 'attack_buff')).toBe(4 * 33);
  });

  it('每层持续 1 回合（新口径）：本次行动叠的层本次享受，下次行动开始时移除', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const ally = makeUnit('ally', { position: '前锋' });
    ctx.myTeam = [wg, ally];
    const e1 = makeUnit('e1', { position: '前锋', defense: 1000, troops: 100000 });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);

    // 回合 1：1 次普攻 → 1 层（盟友攻击 100 + 33 = 133）
    actUnit(ctx, ally);
    expect(buffLayers(ally, 'attack_buff')).toBe(1);
    expect(buffAmount(ally, 'attack_buff')).toBe(33);

    // 回合末不递减（第 2 组在携带者行动开始时递减）
    tickStatuses(ctx, [...ctx.myTeam, ...ctx.enemyTeam]);
    expect(buffLayers(ally, 'attack_buff')).toBe(1);

    // 回合 2：上回合那层在「本次行动开始」时移除（行动之内施加的持续 1 回合只覆盖本次行动），
    // 本次新层结算时攻击 100 + 33 = 133
    ctx.currentRound = 2;
    const mark = ctx.events.length;
    actUnit(ctx, ally);
    const layerEvents = ctx.events
      .slice(mark)
      .filter((e): e is Extract<typeof e, { type: 'status_inflicted' }> => e.type === 'status_inflicted' && e.statusType === 'attack_buff');
    expect(layerEvents).toHaveLength(1);
    expect(layerEvents[0].detail).toContain('攻击属性提高了33(133)');

    // 行动结束：本次行动新叠的 1 层仍在身（已计入本次行动 → remaining 0，下次行动开始时移除）
    expect(buffLayers(ally, 'attack_buff')).toBe(1);
    expect(ally.statuses.find((s) => s.type === 'attack_buff')?.appliedRound).toBe(2);
  });
});

describe('持节镇西 × 举贤决机（汉荀彧）：属性提升「之前」判定', () => {
  it('友军造成攻击伤害前：先判举贤决机（恢复）→ 再落攻击层', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 }); // 40级卫瓘攻击
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const xy = juxianCaster('大营');
    const ally = makeUnit('ally', { position: '前锋', attack: 100 });
    ally.troops = 6000; // 留出兵力缺口，恢复才能落地
    ctx.myTeam = [wg, xy, ally];
    const e1 = makeUnit('e1', { position: '前锋', defense: 1000, troops: 100000 });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);
    lockJuxian(ctx, xy);

    actUnit(ctx, ally); // 普攻 → 造成攻击伤害前：举贤决机判定 → 落攻击层

    const healIdx = ctx.events.findIndex((e) => e.type === 'heal' && e.skillId === 'juxian_jueji');
    const layerIdx = ctx.events.findIndex((e) => e.type === 'status_inflicted' && e.statusType === 'attack_buff');
    expect(healIdx).toBeGreaterThanOrEqual(0);
    expect(layerIdx).toBeGreaterThan(healIdx); // 「提升属性前」判定：恢复在叠层之前

    const heals = juxianHeals(ctx);
    expect(heals).toHaveLength(1);
    expect(heals[0].targetId).toBe('ally');
    expect(heals[0].amount).toBe(calcHealAmount(xy.troops, 60)); // 恢复率 60% 按施法者兵力（成长率留空）
    const triggers = juxianTriggers(ctx);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ targetId: 'ally', success: true, rate: 100, baseRate: 100 });

    // 叠层照旧：round(22 + 0.15×(151−80)) = 33
    expect(buffLayers(ally, 'attack_buff')).toBe(1);
    expect(buffAmount(ally, 'attack_buff')).toBe(33);
  });

  it('友军受到伤害前：先判举贤决机（恢复）→ 再落防御层（恢复先于本次受击伤害）', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', defense: 144 }); // 40级卫瓘防御
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const xy = juxianCaster('大营');
    const ally = makeUnit('ally', { position: '前锋' });
    ally.troops = 6000;
    ctx.myTeam = [wg, xy, ally];
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.general.attackRange = 1; // 能打到 ally
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);
    lockJuxian(ctx, xy);

    actUnit(ctx, e1); // 敌方普攻 ally → 受击前：先判举贤决机 → 落防御层

    const healIdx = ctx.events.findIndex((e) => e.type === 'heal' && e.skillId === 'juxian_jueji');
    const hitIdx = ctx.events.findIndex((e) => e.type === 'attack_hit' && e.targetId === 'ally');
    expect(healIdx).toBeGreaterThanOrEqual(0);
    expect(hitIdx).toBeGreaterThan(healIdx);

    const heals = juxianHeals(ctx);
    expect(heals).toHaveLength(1);
    expect(heals[0].targetId).toBe('ally'); // 判定恢复的是「被提升属性」的受击友军
    expect(buffLayers(ally, 'defense_buff')).toBe(1);
    expect(buffAmount(ally, 'defense_buff')).toBe(32); // round(22 + 0.15×(144−80)) = 32
  });

  it('封顶后不落层即不判定：6 次攻击伤害 → 4 层 → 恰好 4 次判定', () => {
    const ctx = makeCtx();
    const wg = makeUnit('weiguan', { position: '中军', attack: 151 });
    wg.general.commandSkillIds = ['chijie_zhenxi'];
    const xy = juxianCaster('大营');
    const ally = makeUnit('ally', { position: '前锋' });
    ally.troops = 6000;
    // 连击 2 次普攻 + 每次普攻命中后 2 个必中追击 = 单次行动 6 次攻击伤害
    ally.general.pursuitSkillIds = ['test_pursuit_a', 'test_pursuit_b'];
    ctx.skills.set('test_pursuit_a', probePursuit('test_pursuit_a'));
    ctx.skills.set('test_pursuit_b', probePursuit('test_pursuit_b'));
    ctx.myTeam = [wg, xy, ally];
    const e1 = makeUnit('e1', { position: '前锋', defense: 1000, troops: 100000 });
    e1.side = 'enemy';
    ctx.enemyTeam = [e1];
    triggerCommandSkills(ctx, wg);
    lockJuxian(ctx, xy);
    inflictStatus(ctx, ally, { type: 'combo', duration: 999 } as CreateStatus, 'passive', 'test_combo');

    actUnit(ctx, ally);

    expect(buffLayers(ally, 'attack_buff')).toBe(4);
    // 「被成功施加属性提升效果前」——封顶后第 5、6 次不再落层、属性不提高，故不再判定
    expect(juxianTriggers(ctx)).toHaveLength(4);
    expect(juxianHeals(ctx)).toHaveLength(4);
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

  it('三将联动（卫瓘 + 汉荀彧 + 沮授）：叠层前的判定恢复 / 降属性前的判定伤害都会出现', () => {
    // 木桩速度高于我方（300/290/280）→ 每回合先行动，满足沮授「已行动的敌军受到伤害后」
    const report = runBattle({
      seed: 20260920,
      maxRounds: 5,
      myTeam: [
        { ...withSkills(level40(HERO_REGISTRY.h794), {}), position: '大营' }, // 汉荀彧（举贤决机）
        { ...withSkills(level40(HERO_REGISTRY.weiguan), {}), position: '中军' }, // 卫瓘（持节镇西）
        { ...withSkills(level40(HERO_REGISTRY.h771), {}), position: '前锋' }, // 沮授（缓师徐持）
      ],
      enemyTeam: [
        { id: 'ef', name: '木桩前', rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null, troopType: 'infantry', position: '前锋', attack: 50, defense: 200, strategy: 200, speed: 300, attackRange: 2, maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100 },
        { id: 'em', name: '木桩中', rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null, troopType: 'infantry', position: '中军', attack: 50, defense: 200, strategy: 200, speed: 290, attackRange: 2, maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100 },
        { id: 'eb', name: '木桩后', rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null, troopType: 'infantry', position: '大营', attack: 50, defense: 200, strategy: 200, speed: 280, attackRange: 2, maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100 },
      ],
    });

    const heals = juxianHeals(report);
    const dmgs = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'juxian_jueji'
    );
    // 我军属性提升（卫瓘叠层）→ 判定恢复；敌军属性下降（沮授 -20）→ 判定策略伤害
    expect(heals.length).toBeGreaterThan(0);
    expect(dmgs.length).toBeGreaterThan(0);
    // 每次恢复都紧接该友军的「持节镇西」叠层事件（判定在落层之前）
    for (const h of heals) {
      const i = report.events.indexOf(h);
      const next = report.events[i + 1];
      expect(next?.type).toBe('status_inflicted');
      const layer = next as Extract<BattleEvent, { type: 'status_inflicted' }>;
      expect(layer.unitId).toBe(h.targetId);
      expect(['attack_buff', 'defense_buff', 'strategy_buff']).toContain(layer.statusType);
      expect(layer.detail).toContain('持节镇西');
    }
  });
});
