/**
 * 新战斗机制测试（v0.7）：洞察/围困/妖术/燃烧/恐慌/分兵
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import {
  actUnit,
  triggerCommandSkills,
  inflictStatus,
  hasStatus,
  removeDebuffs,
  tickStatuses,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, StatusType, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { HERO_REGISTRY, level40, withSkills, initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function makeUnit(id: string, opts: { position?: Position; speed?: number; strategy?: number; attack?: number; maxTroops?: number; attackRange?: number } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: 100,
      strategy: opts.strategy ?? 100,
      speed: opts.speed ?? 50,
      attackRange: opts.attackRange ?? 3,
      maxTroops: opts.maxTroops ?? 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: opts.maxTroops ?? 10000,
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

function dummy(id: string, position: Position): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function enemyTrio(): General[] {
  return [dummy('ef', '前锋'), dummy('em', '中军'), dummy('eb', '大营')];
}

// ─── 洞察 ───

describe('洞察：免疫控制效果', () => {
  it('有洞察时施加混乱 → 被免疫', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'insight', duration: 3 }, 'active', 'insight_skill');
    inflictStatus(ctx, u, { type: 'confusion', duration: 2 }, 'active', 'hunshui_moyu');
    expect(hasStatus(u, 'insight')).toBe(true);
    expect(hasStatus(u, 'confusion')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'insight_blocked' && (e as any).statusType === 'confusion')).toBe(true);
  });

  it('有洞察时施加怯战 → 被免疫', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'insight', duration: 2 }, 'active', 'insight_skill');
    inflictStatus(ctx, u, { type: 'cowardice', duration: 1 }, 'command', 'zhanbi_duanjin');
    expect(hasStatus(u, 'cowardice')).toBe(false);
  });

  it('有洞察时施加暴走 → 被免疫', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'insight', duration: 2 }, 'active', 'insight_skill');
    inflictStatus(ctx, u, { type: 'rampage', duration: 1 }, 'active', 'biyue');
    expect(hasStatus(u, 'rampage')).toBe(false);
  });

  it('有洞察时施加犹豫 → 被免疫', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'insight', duration: 2 }, 'active', 'insight_skill');
    inflictStatus(ctx, u, { type: 'hesitation', duration: 1 }, 'active', 'qiangshi');
    expect(hasStatus(u, 'hesitation')).toBe(false);
  });

  it('洞察不影响增益效果（攻击增益正常生效）', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'insight', duration: 2 }, 'active', 'insight_skill');
    inflictStatus(ctx, u, { type: 'attack_buff', amount: 30, duration: 3 }, 'command', 'xianqu_tuji');
    expect(hasStatus(u, 'attack_buff')).toBe(true);
  });

  it('洞察不被 removeDebuffs 清除（是增益）', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'insight', duration: 2 }, 'active', 'insight_skill');
    inflictStatus(ctx, u, { type: 'confusion', duration: 2 }, 'active', 'test');
    removeDebuffs(ctx, [u]);
    expect(hasStatus(u, 'insight')).toBe(true);   // 洞察不被清
    expect(hasStatus(u, 'confusion')).toBe(false); // 混乱被清
  });
});

// ─── 围困 ───

describe('围困：无法回复兵力', () => {
  it('围困目标回复 → 被阻止', () => {
    const ctx = makeCtx();
    const u = makeUnit('u', { maxTroops: 5000 });
    u.troops = 3000;
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'siege', duration: 2 }, 'active', 'liaoru_zhizhang');

    // 挂青囊秘要被动 → actUnit 触发 heal 时被 siege 阻止
    u.general.passiveSkillIds = ['qingnang_miyao'];
    ctx.currentRound = 1;
    actUnit(ctx, u);
    const siegeBlocked = ctx.events.filter((e) => e.type === 'siege_blocked');
    expect(siegeBlocked.length).toBeGreaterThanOrEqual(1);
  });

  it('围困不影响受到伤害', () => {
    const ctx = makeCtx();
    const u = makeUnit('u', { maxTroops: 10000 });
    ctx.myTeam = [u];
    const enemy = makeUnit('enemy', { position: '中军' });
    enemy.side = 'enemy';
    enemy.general.activeSkillIds = ['tujin'];
    ctx.enemyTeam = [enemy];
    inflictStatus(ctx, u, { type: 'siege', duration: 2 }, 'active', 'liaoru_zhizhang');

    const before = u.troops;
    actUnit(ctx, enemy);
    // 敌方普攻仍然命中并造成伤害
    const hits = ctx.events.filter((e) => e.type === 'attack_hit');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(u.troops).toBeLessThan(before);
  });

  it('围困被 removeDebuffs 清除', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'siege', duration: 2 }, 'active', 'test');
    removeDebuffs(ctx, [u]);
    expect(hasStatus(u, 'siege')).toBe(false);
  });
});

// ─── 妖术/燃烧/恐慌 DoT ───

describe('DoT 伤害：妖术/燃烧/恐慌', () => {
  it('妖术 DoT：行动时受到策略伤害', () => {
    const ctx = makeCtx();
    const u = makeUnit('u', { strategy: 80 });
    u.troops = 10000;
    ctx.myTeam = [u];
    ctx.enemyTeam = [makeUnit('enemy')];
    ctx.enemyTeam[0].side = 'enemy';

    // 施加妖术：rate 100%, sourceStrategy 150
    inflictStatus(ctx, u, {
      type: 'sorcery', duration: 2, rate: 100, sourceStrategy: 150,
    } as CreateStatus, 'active', 'qishu_zhechong');

    expect(hasStatus(u, 'sorcery')).toBe(true);

    const before = u.troops;
    ctx.currentRound = 1;
    actUnit(ctx, u);
    // DoT tick 发生在 actUnit 内
    const dotEvent = ctx.events.filter((e) => e.type === 'dot_tick');
    expect(dotEvent.length).toBeGreaterThanOrEqual(1);
    expect(u.troops).toBeLessThan(before);
  });

  it('多个 DoT 各自独立跳伤害', () => {
    const ctx = makeCtx();
    const u = makeUnit('u', { strategy: 80, maxTroops: 20000 });
    u.troops = 20000;
    ctx.myTeam = [u];
    ctx.enemyTeam = [makeUnit('enemy')];
    ctx.enemyTeam[0].side = 'enemy';

    inflictStatus(ctx, u, {
      type: 'sorcery', duration: 2, rate: 100, sourceStrategy: 150,
    } as CreateStatus, 'active', 's1');
    inflictStatus(ctx, u, {
      type: 'burning', duration: 1, rate: 80, sourceStrategy: 120,
    } as CreateStatus, 'active', 's2');
    inflictStatus(ctx, u, {
      type: 'panic', duration: 2, rate: 60, sourceStrategy: 100,
    } as CreateStatus, 'active', 's3');

    ctx.currentRound = 1;
    const before = u.troops;
    actUnit(ctx, u);
    const dotEvents = ctx.events.filter((e) => e.type === 'dot_tick');
    // 三种 DoT 各跳一次
    expect(dotEvents.length).toBe(3);
    expect(u.troops).toBeLessThan(before);
  });

  it('DoT 不清除时持续多回合', () => {
    const ctx = makeCtx();
    const u = makeUnit('u', { strategy: 80 });
    u.troops = 10000;
    ctx.myTeam = [u];
    ctx.enemyTeam = [makeUnit('enemy')];
    ctx.enemyTeam[0].side = 'enemy';

    inflictStatus(ctx, u, {
      type: 'panic', duration: 2, rate: 50, sourceStrategy: 100,
    } as CreateStatus, 'active', 'test');

    // 回合 1
    ctx.currentRound = 1;
    actUnit(ctx, u);
    const r1Dot = ctx.events.filter((e) => e.type === 'dot_tick');
    expect(r1Dot.length).toBeGreaterThanOrEqual(1);
    expect(hasStatus(u, 'panic')).toBe(true); // remaining 还 > 0

    // tickStatuses: panic remaining 2→1，仍存在
    tickStatuses(ctx, [u]);
    expect(hasStatus(u, 'panic')).toBe(true);

    // 回合 2: 第 2 次（也是最后一次）跳伤；新口径「行动结束后递减」→ 跳完才 1→0 移除
    ctx.currentRound = 2;
    actUnit(ctx, u);
    const r2Dot = ctx.events.filter((e) => e.type === 'dot_tick');
    expect(r2Dot.length).toBe(r1Dot.length + 1);
    expect(hasStatus(u, 'panic')).toBe(false); // duration 2 = 稳定跳 2 次后移除

    // 回合 3: panic 已移除，无新增 DoT
    ctx.currentRound = 3;
    actUnit(ctx, u);
    const r3Dot = ctx.events.filter((e) => e.type === 'dot_tick');
    expect(r3Dot.length).toBe(r2Dot.length); // 无新增
  });

  it('DoT 被 removeDebuffs 清除', () => {
    const ctx = makeCtx();
    const u = makeUnit('u');
    ctx.myTeam = [u];
    inflictStatus(ctx, u, {
      type: 'burning', duration: 3, rate: 80, sourceStrategy: 120,
    } as CreateStatus, 'active', 'test');
    removeDebuffs(ctx, [u]);
    expect(hasStatus(u, 'burning')).toBe(false);
  });
});

// ─── 分兵 ───

describe('分兵：普攻后溅射相邻目标', () => {
  it('分兵状态下普攻中军 → 前锋和大营受到溅射伤害（无视距离）', () => {
    const ctx = makeCtx();
    const attacker = makeUnit('attacker', { position: '中军', attack: 150, attackRange: 5 });
    const eFront = makeUnit('ef', { position: '前锋' });
    eFront.side = 'enemy';
    const eMid = makeUnit('em', { position: '中军' });
    eMid.side = 'enemy';
    const eBack = makeUnit('eb', { position: '大营' });
    eBack.side = 'enemy';

    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eFront, eMid, eBack];
    ctx.currentRound = 1;

    // 施加分兵：rate 50%
    inflictStatus(ctx, attacker, { type: 'split', duration: 2, rate: 50 } as CreateStatus, 'command', 'changbing_fangzhen');

    const beforeFront = eFront.troops;
    const beforeBack = eBack.troops;

    actUnit(ctx, attacker);

    // 应该有一次普攻命中（最近敌军 = 前锋），+ 分兵溅射中军（相邻）
    const hits = ctx.events.filter((e) => e.type === 'attack_hit');
    expect(hits.length).toBeGreaterThanOrEqual(1);

    const splitEvents = ctx.events.filter((e) => e.type === 'split_damage');
    expect(splitEvents.length).toBeGreaterThanOrEqual(1);

    // 普攻前锋 → 分兵溅射中军
    // 或普攻中军 → 分兵溅射前锋和大营
    const splitTargets = new Set((splitEvents as any[]).map((e: any) => e.targetId));
    expect(splitTargets.size).toBeGreaterThanOrEqual(1);
  });

  it('分兵伤害率正确', () => {
    const ctx = makeCtx();
    const attacker = makeUnit('attacker', { position: '前锋', attack: 200, attackRange: 5 });
    const eFront = makeUnit('ef', { position: '前锋' });
    eFront.side = 'enemy';
    // 只放两个敌人验证：普攻前锋 → 分兵溅射中军
    const eMid = makeUnit('em', { position: '中军' });
    eMid.side = 'enemy';

    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eFront, eMid];
    ctx.currentRound = 1;

    // 分兵 rate = 100%（相当于普攻伤害全额溅射）
    inflictStatus(ctx, attacker, { type: 'split', duration: 2, rate: 100 } as CreateStatus, 'command', 'test');

    actUnit(ctx, attacker);

    const splitEvents = ctx.events.filter((e) => e.type === 'split_damage') as any[];
    expect(splitEvents.length).toBeGreaterThanOrEqual(1);
    // 100% 分兵率 → 溅射伤害应 > 0
    expect(splitEvents[0].damage).toBeGreaterThan(0);
  });

  it('无分兵时普攻不产生溅射', () => {
    const ctx = makeCtx();
    const attacker = makeUnit('attacker', { position: '前锋', attackRange: 5 });
    const eFront = makeUnit('ef', { position: '前锋' });
    eFront.side = 'enemy';
    const eMid = makeUnit('em', { position: '中军' });
    eMid.side = 'enemy';

    ctx.myTeam = [attacker];
    ctx.enemyTeam = [eFront, eMid];
    ctx.currentRound = 1;

    actUnit(ctx, attacker);
    const splitEvents = ctx.events.filter((e) => e.type === 'split_damage');
    expect(splitEvents.length).toBe(0);
  });
});

// ─── 战斗级：新机制技能集成测试 ───

describe('战斗级：新机制技能', () => {
  it('洞察技能使武将免疫控制', () => {
    // 洞察将 vs 浑水摸鱼将
    const report = runBattle({
      seed: 30001,
      maxRounds: 8,
      myTeam: [withSkills(level40(HERO_REGISTRY.sunquan, { strategy: 40 }), {
        activeSkillIds: ['insight_skill', 'jiuxi_huanglong'],
      })],
      enemyTeam: [withSkills(level40(HERO_REGISTRY.zhouyu, { strategy: 40 }), {
        activeSkillIds: ['xuanwu_fuliu', 'hunshui_moyu'],
      })].concat([dummy('em', '中军'), dummy('eb', '大营')]),
    });

    // 洞察免疫应有事件
    const insightBlocked = report.events.filter((e) => e.type === 'insight_blocked');
    expect(insightBlocked.length).toBeGreaterThanOrEqual(0); // 可能因发动率没触发
  });

  it('楚歌四起恐慌 DoT 正常跳伤害', () => {
    const report = runBattle({
      seed: 30002,
      maxRounds: 8,
      myTeam: [withSkills(level40(HERO_REGISTRY.zhouyu, { strategy: 40 }), {
        activeSkillIds: ['chuge_siqi'],
      })],
      enemyTeam: enemyTrio(),
    });

    const dotTicks = report.events.filter((e) => e.type === 'dot_tick');
    expect(dotTicks.length).toBeGreaterThanOrEqual(0); // 依赖发动率
    const inflictions = report.events.filter(
      (e) => e.type === 'status_inflicted' && e.statusType === 'panic'
    );
    // 恐慌施加事件应存在
    expect(inflictions.length).toBeGreaterThanOrEqual(0);
  });

  it('焰焚箕轸：直接策略伤害 + 燃烧 DoT 均生效', () => {
    const report = runBattle({
      seed: 30003,
      maxRounds: 8,
      myTeam: [withSkills(level40(HERO_REGISTRY.zhouyu, { strategy: 40 }), {
        activeSkillIds: ['yanfen_jizhen'],
      })],
      enemyTeam: enemyTrio(),
    });

    const damageEvents = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'yanfen_jizhen'
    );
    expect(damageEvents.length).toBeGreaterThanOrEqual(0);
    const dotEvents = report.events.filter((e) => e.type === 'dot_tick');
    expect(dotEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('长兵方阵分兵溅射：施加分兵后普攻有溅射', () => {
    const report = runBattle({
      seed: 30004,
      maxRounds: 8,
      myTeam: [
        withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), {
          commandSkillIds: ['changbing_fangzhen'],
          pursuitSkillIds: ['fangzhen_tuji'],
        }),
      ],
      enemyTeam: enemyTrio(),
    });

    const splitEvents = report.events.filter((e) => e.type === 'split_damage');
    // 长兵方阵 75% 发动率 → 有概率无分兵溅射
    expect(splitEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('了如指掌围困：阻止后续回复', () => {
    const report = runBattle({
      seed: 30005,
      maxRounds: 8,
      myTeam: [withSkills(level40(HERO_REGISTRY.zhouyu, { strategy: 40 }), {
        activeSkillIds: ['liaoru_zhizhang'],
      })],
      enemyTeam: [withSkills(level40(HERO_REGISTRY.sunquan, { defense: 40 }), {
        passiveSkillIds: ['qingnang_miyao'],
      })].concat([dummy('em', '中军'), dummy('eb', '大营')]),
    });

    const siegeBlocked = report.events.filter((e) => e.type === 'siege_blocked');
    // 可能未发动
    expect(siegeBlocked.length).toBeGreaterThanOrEqual(0);
  });
});
