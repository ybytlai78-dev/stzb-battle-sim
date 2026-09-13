/**
 * 指挥战法一二类机制测试（v0.5）
 *  一类指挥（白衣渡江）：准备阶段释放一次、锁目标、预备怯战、第3回合延迟结算
 *    （按准备时兵力/属性预存伤害、无视规避）、施法者阵亡后仍生效
 *  二类指挥（奇兵拒北）：准备阶段不触发、行动时判定、动态发动率（未生效+5%、生效重置30%）、
 *    按位置只打敌军大营+中军、借速度最高友军、施法者阵亡后无法生效
 *  混乱：禁主动+普攻+追击，但被动/指挥仍判定（青囊回血照常）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import {
  actUnit,
  triggerCommandSkills,
  triggerDelayedOutputs,
  triggerRoundCommandOnAct,
  inflictStatus,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { level40, withSkills, HERO_REGISTRY, initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function makeUnit(id: string, opts: { position?: Position; speed?: number; strategy?: number } = {}): UnitState {
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
      strategy: opts.strategy ?? 100,
      speed: opts.speed ?? 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: 'my',
    troops: 10000,
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

const damageEvents = (events: BattleEvent[], skillId: string) =>
  events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId
  );

describe('一类指挥：白衣渡江（吕蒙）', () => {
  it('准备阶段释放一次，锁定全军并预存延迟伤害', () => {
    const ctx = makeCtx();
    const lvmeng = makeUnit('lvmeng', { position: '大营', strategy: 120 });
    lvmeng.general.commandSkillIds = ['baiyi_dujiang'];
    ctx.myTeam = [lvmeng];
    ctx.enemyTeam = [makeUnit('e1', { position: '前锋' }), makeUnit('e2', { position: '中军' })];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, lvmeng);
    const cast = ctx.events.filter((e) => e.type === 'skill_cast' && e.skillName === '白衣渡江');
    expect(cast.length).toBe(1); // 一类指挥只释放一次
    const lock = ctx.lockedCommands.find((l) => l.skill.id === 'baiyi_dujiang')!;
    expect(lock).toBeDefined();
    expect(lock.storedDamage).toBeDefined();
    expect(lock.storedDamage!.length).toBe(2); // 每个锁定目标一份预存伤害
  });

  it('第3回合延迟结算；未到回合不结算', () => {
    const ctx = makeCtx();
    const lvmeng = makeUnit('lvmeng', { position: '大营' });
    lvmeng.general.commandSkillIds = ['baiyi_dujiang'];
    ctx.myTeam = [lvmeng];
    ctx.enemyTeam = [makeUnit('e1', { position: '前锋' })];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, lvmeng);
    triggerDelayedOutputs(ctx, 2);
    expect(damageEvents(ctx.events, 'baiyi_dujiang').length).toBe(0);
    triggerDelayedOutputs(ctx, 3);
    const dmg = damageEvents(ctx.events, 'baiyi_dujiang');
    expect(dmg.length).toBe(1);
    expect(dmg[0].damageType).toBe('strategy');
  });

  it('无视规避：目标有规避层数仍能打出（不消耗规避）', () => {
    const ctx = makeCtx();
    const lvmeng = makeUnit('lvmeng', { position: '大营' });
    lvmeng.general.commandSkillIds = ['baiyi_dujiang'];
    ctx.myTeam = [lvmeng];
    const e1 = makeUnit('e1', { position: '前锋' });
    ctx.enemyTeam = [e1];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, lvmeng);
    inflictStatus(ctx, e1, { type: 'evasion', stacks: 3 }, 'command', 'test');
    triggerDelayedOutputs(ctx, 3);
    expect(damageEvents(ctx.events, 'baiyi_dujiang').length).toBe(1);
    // 白衣伤害未触发任何规避消耗
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked' && e.sourceId === 'lvmeng').length).toBe(0);
    expect(getStacks(e1)).toBe(3);
  });

  it('施法者阵亡后延迟结算仍生效（retainAfterDeath）', () => {
    const ctx = makeCtx();
    const lvmeng = makeUnit('lvmeng', { position: '大营' });
    lvmeng.general.commandSkillIds = ['baiyi_dujiang'];
    ctx.myTeam = [lvmeng];
    ctx.enemyTeam = [makeUnit('e1', { position: '前锋' })];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, lvmeng);
    lvmeng.alive = false; // 施法者阵亡（一类：效果仍存在）
    lvmeng.troops = 0;
    triggerDelayedOutputs(ctx, 3);
    expect(damageEvents(ctx.events, 'baiyi_dujiang').length).toBe(1);
  });

  it('战斗级：前2回合怯战 + 第3回合全体谋略（40级面板）', () => {
    const report = runBattle({
      seed: 20001,
      maxRounds: 8,
      myTeam: [level40(HERO_REGISTRY.lvmeng)],
      enemyTeam: enemyTrio(),
    });

    const cast = report.events.filter((e) => e.type === 'skill_cast' && e.skillName === '白衣渡江');
    expect(cast.length).toBe(1);
    const prepIdx = report.events.findIndex((e) => e.type === 'preparation_end');
    expect(report.events.indexOf(cast[0])).toBeLessThan(prepIdx);

    // 前2回合怯战判定（目标行动时，rate=1 必中）
    const cow = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'cowardice'
    );
    expect(cow.length).toBeGreaterThan(0);

    // 第3回合才出现白衣伤害（回合3前无伤害事件）
    const r3Idx = report.events.findIndex((e) => e.type === 'round_start' && e.round === 3);
    const early = report.events.slice(0, r3Idx).filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'baiyi_dujiang'
    );
    expect(early.length).toBe(0);
    const dmg = damageEvents(report.events, 'baiyi_dujiang');
    expect(dmg.length).toBe(3); // 敌军全体
    expect(dmg.every((d) => d.damageType === 'strategy')).toBe(true);
  });
});

describe('二类指挥：奇兵拒北（魏延）', () => {
  it('准备阶段不触发（二类指挥由行动时判定）', () => {
    const ctx = makeCtx();
    const weiyan = makeUnit('weiyan', { position: '前锋' });
    weiyan.general.commandSkillIds = ['qibing_jubei'];
    ctx.myTeam = [weiyan];
    ctx.enemyTeam = [makeUnit('e1', { position: '前锋' })];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, weiyan);
    expect(ctx.events.filter((e) => e.type === 'skill_cast' && e.skillName === '奇兵拒北').length).toBe(0);
    expect(ctx.lockedCommands.length).toBe(0);
  });

  it('动态发动率：未生效 +5%，生效重置 30%', () => {
    const ctx = makeCtx();
    const weiyan = makeUnit('weiyan', { position: '前锋' });
    weiyan.general.commandSkillIds = ['qibing_jubei'];
    ctx.myTeam = [weiyan];
    ctx.enemyTeam = [makeUnit('e1', { position: '前锋' })];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    let fired = false;
    for (let i = 0; i < 30 && !fired; i++) {
      ctx.currentRound = i + 1;
      const before = ctx.lockedCommands[0]?.currentRate ?? 0.3;
      const beforeCount = ctx.events.filter((e) => e.type === 'skill_cast' && e.skillName === '奇兵拒北').length;
      triggerRoundCommandOnAct(ctx, weiyan);
      const castDelta =
        ctx.events.filter((e) => e.type === 'skill_cast' && e.skillName === '奇兵拒北').length - beforeCount;
      const after = ctx.lockedCommands[0]!.currentRate;
      if (castDelta > 0) {
        expect(after).toBe(0.3); // 生效 → 重置
        fired = true;
      } else {
        expect(after).toBe(Math.min(1, before + 0.05)); // 未生效 → +5%
      }
    }
    expect(fired).toBe(true);
  });

  it('只打敌军大营+中军，借速度最高友军（自身 180% + 友军 120~180%）', () => {
    const ctx = makeCtx();
    const weiyan = makeUnit('weiyan', { position: '前锋', speed: 50 });
    weiyan.general.commandSkillIds = ['qibing_jubei'];
    const fastAlly = makeUnit('fast-ally', { position: '中军', speed: 90 });
    ctx.myTeam = [weiyan, fastAlly];
    const eFront = makeUnit('ef', { position: '前锋' });
    const eMid = makeUnit('em', { position: '中军' });
    const eBack = makeUnit('eb', { position: '大营' });
    ctx.enemyTeam = [eFront, eMid, eBack];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    let fired = false;
    for (let i = 0; i < 30 && !fired; i++) {
      ctx.currentRound = i + 1;
      triggerRoundCommandOnAct(ctx, weiyan);
      fired = ctx.events.some((e) => e.type === 'skill_cast' && e.skillName === '奇兵拒北');
    }
    const dmg = damageEvents(ctx.events, 'qibing_jubei');
    // 自身 × 大营/中军 + 友军 × 大营/中军 = 4 次
    expect(dmg.length).toBe(4);
    const targets = new Set(dmg.map((d) => d.targetId));
    expect(targets.has('ef')).toBe(false); // 不打前锋
    expect(targets.has('em')).toBe(true);
    expect(targets.has('eb')).toBe(true);
    const sources = new Set(dmg.map((d) => d.sourceId));
    expect(sources.has('weiyan')).toBe(true); // 自身
    expect(sources.has('fast-ally')).toBe(true); // 借速度最高友军
    expect(dmg.every((d) => d.damageType === 'physical')).toBe(true);
  });

  it('施法者阵亡后无法生效（二类看实时数据）', () => {
    const ctx = makeCtx();
    const weiyan = makeUnit('weiyan', { position: '前锋' });
    weiyan.general.commandSkillIds = ['qibing_jubei'];
    ctx.myTeam = [weiyan];
    ctx.enemyTeam = [makeUnit('e1', { position: '前锋' })];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));
    weiyan.alive = false; // 阵亡
    triggerRoundCommandOnAct(ctx, weiyan);
    expect(ctx.events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'qibing_jubei').length).toBe(0);
  });

  it('战斗级：行动时判定，只打大营+中军，借速度最高友军（40级面板）', () => {
    const report = runBattle({
      seed: 20002,
      maxRounds: 8,
      myTeam: [
        withSkills(level40(HERO_REGISTRY.weiyan, { attack: 40 }), {}),
        withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), { pursuitSkillIds: ['fangzhen_tuji'] }),
      ],
      enemyTeam: enemyTrio(),
    });

    const casts = report.events.filter((e) => e.type === 'skill_cast' && e.skillName === '奇兵拒北');
    expect(casts.length).toBeGreaterThan(0);
    const dmg = damageEvents(report.events, 'qibing_jubei');
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((d) => d.targetId !== 'ef')).toBe(true); // 不打前锋
    const sources = new Set(dmg.map((d) => d.sourceId));
    expect(sources.has('weiyan')).toBe(true);
    // 太史慈 40级速度(106) < 魏延(124)，但借友军≠自身，故仍借太史慈
    expect(sources.has('taishici')).toBe(true);
  });
});

describe('混乱语义', () => {
  it('混乱单位：禁主动+普攻+追击，但被动/指挥仍判定', () => {
    const ctx = makeCtx();
    const sunquan = makeUnit('sunquan', { position: '大营' });
    sunquan.general.passiveSkillIds = ['qingnang_miyao'];
    sunquan.troops = 5000; // 受伤以便青囊回血可见
    ctx.myTeam = [sunquan];
    const e1 = makeUnit('e1', { position: '前锋' });
    ctx.enemyTeam = [e1];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    inflictStatus(ctx, sunquan, { type: 'confusion', duration: 3 }, 'active', 'test');
    ctx.currentRound = 1;
    actUnit(ctx, sunquan);

    // 被动青囊照常回血
    const heals = ctx.events.filter((e) => e.type === 'heal' && e.targetId === 'sunquan');
    expect(heals.length).toBe(1);
    // 无普攻、无主动/追击战法判定
    expect(ctx.events.filter((e) => e.type === 'attack_hit').length).toBe(0);
    expect(ctx.events.some((e) => e.type === 'no_attack_target' && 'reason' in e && String(e.reason).includes('混乱'))).toBe(true);
  });
});

describe('指挥阶段时序联动：卫瓘持节镇西 × 吕蒙白衣渡江 × 神兵/大赏', () => {
  it('卫瓘先手：白衣渡江准备阶段结算触发持节镇西 → 吕蒙叠谋略层 → 神兵/大赏读生效谋略更高', () => {
    const ctx = makeCtx();
    const weiguan = makeUnit('weiguan', { position: '中军', speed: 120, strategy: 146 });
    weiguan.general.commandSkillIds = ['chijie_zhenxi'];
    const lvmeng = makeUnit('lvmeng', { position: '大营', speed: 100, strategy: 197 });
    lvmeng.general.commandSkillIds = ['baiyi_dujiang', 'shenbing_tianjiang', 'dashang_sanjun'];
    ctx.myTeam = [weiguan, lvmeng];
    const e1 = makeUnit('e1', { position: '前锋' });
    const e2 = makeUnit('e2', { position: '中军' });
    const e3 = makeUnit('e3', { position: '大营' });
    ctx.enemyTeam = [e1, e2, e3];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    // 按速度释放指挥：卫瓘(120) → 吕蒙(100)
    triggerCommandSkills(ctx, weiguan);
    triggerCommandSkills(ctx, lvmeng);

    // 白衣渡江伤害全体(3目标) → 对每个目标结算前触发持节镇西「造成策略伤害前」→ 吕蒙叠 3 层谋略
    const layers = lvmeng.statuses.filter((s) => s.type === 'strategy_buff' && s.sourceSkillId === 'chijie_zhenxi');
    expect(layers.length).toBe(3);
    // 每层按卫瓘谋略(146)缩放：round(22 + 0.15×(146-80)) = 32
    expect(layers.reduce((a, s) => a + ('amount' in s ? s.amount : 0), 0)).toBe(3 * 32);

    // 神兵/大赏读生效谋略（197+96=293）：roundRate(30+0.15×(293-80))=61.95 → 八舍九入 62 → 0.62
    const boost = (u: UnitState) =>
      u.statuses.filter((s) => s.type === 'damage_boost').reduce((a, s) => a + ('rate' in s ? s.rate : 0), 0);
    // 神兵天降 range 4：吕蒙(大营) 够不到敌方大营(e3 距离5)，只命中 e1/e2 两个目标
    expect(boost(e1)).toBe(0.62);
    expect(boost(e2)).toBe(0.62);
    expect(boost(e3)).toBe(0);
  });

  it('白衣怯战为 2 目标群体、伤害为全体（目标分离）', () => {
    const ctx = makeCtx();
    const lvmeng = makeUnit('lvmeng', { position: '大营', strategy: 197 });
    lvmeng.general.commandSkillIds = ['baiyi_dujiang'];
    ctx.myTeam = [lvmeng];
    const e1 = makeUnit('e1', { position: '前锋' });
    const e2 = makeUnit('e2', { position: '中军' });
    const e3 = makeUnit('e3', { position: '大营' });
    ctx.enemyTeam = [e1, e2, e3];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, lvmeng);

    // 预备怯战锁定 2 目标群体
    const lock = ctx.lockedCommands.find((l) => l.skill.id === 'baiyi_dujiang')!;
    expect(lock.targets.length).toBe(2);
    // 延迟伤害为全体 → 预存 3 份伤害
    expect(lock.storedDamage!.length).toBe(3);
    expect(new Set(lock.storedDamage!.map((d) => d.targetId)).size).toBe(3);
  });

  it('神兵/大赏无谋略增益时按裸面板（对照组）', () => {
    const ctx = makeCtx();
    const weiguan = makeUnit('weiguan', { position: '中军', speed: 120, strategy: 146 });
    weiguan.general.commandSkillIds = ['chijie_zhenxi'];
    const lvmeng = makeUnit('lvmeng', { position: '大营', speed: 100, strategy: 197 });
    // 吕蒙不带白衣：无延迟结算触发叠层
    lvmeng.general.commandSkillIds = ['shenbing_tianjiang', 'dashang_sanjun'];
    ctx.myTeam = [weiguan, lvmeng];
    const e1 = makeUnit('e1', { position: '前锋' });
    const e2 = makeUnit('e2', { position: '中军' });
    ctx.enemyTeam = [e1, e2];
    ctx.enemyTeam.forEach((u) => (u.side = 'enemy'));

    triggerCommandSkills(ctx, weiguan);
    triggerCommandSkills(ctx, lvmeng);

    // 吕蒙无谋略增益层
    expect(lvmeng.statuses.filter((s) => s.type === 'strategy_buff').length).toBe(0);
    // 神兵/大赏按裸面板谋略 197：roundRate(30+0.15×117)=47 → 0.47
    const boost = (u: UnitState) =>
      u.statuses.filter((s) => s.type === 'damage_boost').reduce((a, s) => a + ('rate' in s ? s.rate : 0), 0);
    expect(boost(e1)).toBe(0.47);
  });
});

function getStacks(u: UnitState): number {
  return u.statuses.find((s) => s.type === 'evasion')?.stacks ?? 0;
}
