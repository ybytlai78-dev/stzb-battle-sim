/**
 * 徽言龙凤（司马徽·群步 h811 主战法）：指挥 S，距离 5，友军全体。
 * 友军全体共计造成 6 次伤害后，使友军全体获得：士气提升 10（受谋略）；每回合行动时造成的所有伤害
 * 提升 7%（受谋略），可叠加；每回合行动时有 60% 的几率对随机敌军单体造成 1 次攻击伤害（150%）
 * 或策略攻击伤害（120%，受谋略），由攻击或谋略属性中较高的属性决定。
 * 官方：scripts/skill_extra.json id 200294（1 级 士气 5 / 增伤 3.5% / 攻击 100% / 策略 60%）。
 * 引擎配套：新增 `teamDamageThreshold`（全队累计伤害门槛）+ `recipientDamageByHigherStat`（代打定轨）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { applyDamage, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

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

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

function forceProcs(ctx: CombatContext, chance: number): void {
  const cloned = structuredClone(SKILL_REGISTRY['huiyan_longfeng']) as Skill;
  if (cloned.type === 'command' && cloned.roundStartRepeat) {
    const out = cloned.roundStartRepeat.output[1];
    if (out.kind === 'physical_damage') out.chance = chance;
  }
  ctx.skills.set('huiyan_longfeng', cloned);
}

function damages(ctx: CombatContext, skillId = 'huiyan_longfeng') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

function setup(seed = 1, chance?: number) {
  const sima = heroUnit('h811', '大营', { commandSkillIds: ['huiyan_longfeng'] });
  const warrior = makeUnit(dummy('ally-war', '前锋', { attack: 200, strategy: 50 }));
  const mage = makeUnit(dummy('ally-mage', '中军', { attack: 50, strategy: 200 }));
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
  const ctx = makeCtx([warrior, mage, sima], [foe], seed);
  // 先替换 ctx.skills 里的定义（锁定发生在 triggerCommandSkills，之后替换对已锁定实例无效）
  if (chance != null) forceProcs(ctx, chance);
  triggerCommandSkills(ctx, sima);
  return { sima, warrior, mage, foe, ctx };
}

/** 让本侧累计造成 n 次伤害（每次 1 点，走 applyDamage 全链路计数） */
function dealDamage(ctx: CombatContext, source: UnitState, target: UnitState, n: number): void {
  for (let i = 0; i < n; i++) applyDamage(ctx, target, 1, source, 'physical', 'skill');
}

describe('徽言龙凤（司马徽 h811）', () => {
  it('装配：注册表定义 + 挂槽名（指挥 S / 距离 5 / 友军全体 / 6 次伤害门槛）', () => {
    const hero = HERO_REGISTRY['h811'];
    expect(hero.name).toBe('司马徽');
    expect(hero.mainSkillName).toBe('徽言龙凤');

    const s = SKILL_REGISTRY['huiyan_longfeng'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect([...s.tags].sort()).toEqual(['damage', 'damage_boost', 'morale_boost']);
    expect(s.output).toEqual([]);
    expect(s.teamDamageThreshold).toMatchObject({
      count: 6,
      output: [{ kind: 'inflict_status', status: { type: 'morale_boost', amount: 10, duration: 999 } }],
    });
    const rs = s.roundStartRepeat?.output ?? [];
    expect(rs[0]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'damage_boost', rate: 0.07, direction: 'caused', strategyScaled: true, stacks: 1 },
    });
    expect(rs[1]).toMatchObject({
      kind: 'physical_damage',
      attacker: 'recipient',
      recipientDamageByHigherStat: { attackRate: 150, strategyRate: 120 },
      chance: 0.6,
      targetMode: 'random_single',
    });
    expect(isHeroListed({ mainSkillId: 'huiyan_longfeng' })).toBe(false); // 受谋略未确认 → 下架
  });

  it('门槛：本队造成 5 次伤害不激活；第 6 次伤害后激活并给友军全体 +10 士气', () => {
    const { sima, warrior, mage, foe, ctx } = setup();
    dealDamage(ctx, warrior, foe, 5);
    expect(ctx.teamDamageCounters?.get('h811:huiyan_longfeng')).toBe(5);
    expect(sima.statuses.some((s) => s.type === 'morale_boost')).toBe(false);

    dealDamage(ctx, mage, foe, 1); // 第 6 次（可由任意友军造成）
    expect(ctx.teamThresholdActive?.has('h811:huiyan_longfeng')).toBe(true);
    for (const u of [warrior, mage, sima]) {
      const mb = u.statuses.find((s) => s.type === 'morale_boost');
      expect(mb && 'amount' in mb ? mb.amount : 0).toBe(10);
    }
  });

  it('激活前不执行每回合段：roundStartRepeat 在门槛达成前不施加增伤、也不触发追加攻击', () => {
    const { warrior, foe, ctx } = setup(1, 1); // 即使必中也该因未激活而不执行
    dealDamage(ctx, warrior, foe, 3); // 未达 6 次
    tickRoundStartStatuses(ctx);
    expect(warrior.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
    expect(damages(ctx)).toHaveLength(0);
  });

  it('激活后每回合：友军全体获得叠层增伤 +7%，且每人各自 60% 追加一次攻击', () => {
    const { warrior, mage, foe, ctx } = setup(1, 1); // 强制必中，便于确定性断言
    dealDamage(ctx, warrior, foe, 6); // 激活
    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);

    // ② 每人一条 +7% 增伤（direction=caused）
    for (const u of [warrior, mage]) {
      const boost = u.statuses.find((s) => s.type === 'damage_boost' && s.sourceSkillId === 'huiyan_longfeng');
      expect(boost && 'rate' in boost ? boost.rate : 0).toBeCloseTo(0.07, 5);
      expect(boost && 'direction' in boost ? boost.direction : '').toBe('caused');
    }

    // ③ 两名友军各打一次（每回合各 60%）：战士 200 攻 → 攻击伤害；法师 200 谋 → 策略伤害
    const dmg = damages(ctx);
    expect(dmg).toHaveLength(3); // 三名友军（含施法者本人）各一次
    const fromWarrior = dmg.find((d) => d.sourceId === 'ally-war');
    const fromMage = dmg.find((d) => d.sourceId === 'ally-mage');
    expect(fromWarrior?.damageType).toBe('physical'); // 攻 200 > 谋 50
    expect(fromMage?.damageType).toBe('strategy'); // 谋 200 > 攻 50
    expect(dmg.every((d) => d.targetId === 'foe')).toBe(true);

    // 再过一个回合：同战法同源累加 → 同一个状态实例的 rate 叠到 14%（可叠加）
    ctx.currentRound = 3;
    tickRoundStartStatuses(ctx);
    const boosts = warrior.statuses.filter(
      (s) => s.type === 'damage_boost' && s.sourceSkillId === 'huiyan_longfeng',
    );
    expect(boosts).toHaveLength(1);
    expect(boosts[0] && 'rate' in boosts[0] ? boosts[0].rate : 0).toBeCloseTo(0.14, 5);
  });

  it('定轨按代打者自身属性：攻击高者走攻击伤害、谋略高者走策略伤害（同一回合各一次）', () => {
    const { warrior, mage, foe, ctx } = setup(1, 1);
    dealDamage(ctx, warrior, foe, 6);
    ctx.currentRound = 2;
    tickRoundStartStatuses(ctx);
    const dmg = damages(ctx);
    // 战士（攻 200 / 谋 50）→ physical；法师（攻 50 / 谋 200）→ strategy
    expect(dmg.find((d) => d.sourceId === warrior.general.id)?.damageType).toBe('physical');
    expect(dmg.find((d) => d.sourceId === mage.general.id)?.damageType).toBe('strategy');
  });

  it('整场跑通（runBattle）：司马徽在场不报错并产生士气提升事件', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h811']), { commandSkillIds: ['huiyan_longfeng'] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 13,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), leader],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillId === 'huiyan_longfeng')).toBe(true);
  });
});
