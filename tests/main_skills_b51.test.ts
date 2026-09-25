/**
 * 鸾凤和鸣（小乔·吴弓 h687 主战法）：指挥 A，距离 3，我军全体。
 * 战斗中，自身每回合首次发动主动战法后，使我军群体 2 目标恢复一定兵力（恢复率 85.0%，受谋略属性影响）；
 * 每回合自身行动时，使我军全体 3 目标造成的下一次随机目标的控制效果（混乱、犹豫、暴走、怯战）额外对一个目标生效。
 * 官方：scripts/skill_extra.json id 200960（指挥 A / 距离 3 / 我军全体 / 兵种弓；1 级 42.5%）。
 * 入档：85% 恢复率「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 小乔**下架**。
 * 引擎配套：
 *   ① 新状态 `control_spread`（控制效果 +1 目标，消耗制，不按回合递减）；
 *   ② `CommandSkill.afterFirstActiveOutput`（与 roundTrigger 解耦的「本回合首次主动战法成功释放后」附加段）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  inflictStatus,
  getStatus,
  triggerActiveSkill,
  triggerRoundCommandOnAct,
  tickStatuses,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'luanfeng_heming';

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
    preparations: [],
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

/** 发动率拉满的已注册战法（小乔的主动段 / 友军的控制段都靠它避免发动率 RNG） */
function forcedSkill(id: string, ctx: CombatContext): Skill {
  const s = structuredClone(SKILL_REGISTRY[id]) as Skill;
  s.triggerRate = 1;
  ctx.skills.set(id, s);
  return s;
}

function controlSpreads(u: UnitState) {
  return u.statuses.filter((s) => s.type === 'control_spread');
}

/** 小乔（大营·带主战法）+ 2 友军（前锋/中军）+ 3 敌军 */
function setup(seed = 1, withActive = false) {
  const xiaoqiao = heroUnit('h687', '大营', {
    commandSkillIds: [SKILL_ID],
    ...(withActive ? { activeSkillIds: ['mizhen'] } : {}),
  });
  const allyFront = makeUnit(dummy('ally-front', '前锋'));
  const allyMid = makeUnit(dummy('ally-mid', '中军'));
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([xiaoqiao, allyFront, allyMid], foes, seed);
  return { xiaoqiao, allyFront, allyMid, foes, ctx, allies: [xiaoqiao, allyFront, allyMid] };
}

describe('鸾凤和鸣（小乔 h687）', () => {
  it('装配：注册表定义（两个时机）+ h687 挂槽 + 受谋略成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h687'];
    expect(hero.name).toBe('小乔');
    expect(hero.mainSkillName).toBe('鸾凤和鸣');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act'); // ② 每回合自身行动时
    expect(s.range).toBe(3);
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('all'); // 我军全体 3 目标
    // ② 我军全体获得「控制效果 +1 目标」标记（消耗制）
    expect(s.output).toEqual([{ kind: 'inflict_status', status: { type: 'control_spread', duration: 999 } }]);
    // ① 每回合首次发动主动战法后：我军群体 2 目标恢复 85%（受谋略，成长率留空 = 基值不缩放）
    expect(s.afterFirstActiveOutput).toEqual([
      {
        kind: 'heal',
        rate: 85,
        strategyScaled: true,
        growthRate: 0,
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
      },
    ]);

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('每回合自身行动时：我军全体（含小乔自己）获得标记，重复授予只刷新不叠加', () => {
    const { xiaoqiao, ctx, allies } = setup();
    triggerRoundCommandOnAct(ctx, xiaoqiao);

    for (const u of allies) expect(controlSpreads(u)).toHaveLength(1);
    expect(eventsOf(ctx, 'skill_target').map((e) => e.targetIds).flat()).toEqual([
      'h687',
      'ally-front',
      'ally-mid',
    ]);

    // 同回合再次行动（refresh）：仍是 1 个实例
    triggerRoundCommandOnAct(ctx, xiaoqiao);
    for (const u of allies) expect(controlSpreads(u)).toHaveLength(1);
  });

  it('每回合首次主动战法后：我军群体 2 目标恢复兵力；同回合第二次主动不再恢复', () => {
    const { xiaoqiao, foes, ctx, allies } = setup(3, true);
    // 先让友军掉血，恢复才可观测
    for (const u of allies) u.troops = 5000;
    const mizhen = forcedSkill('mizhen', ctx);

    triggerActiveSkill(ctx, xiaoqiao, mizhen, foes, allies, [...foes, ...allies]);
    const heals = eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID);
    expect(heals).toHaveLength(2); // 我军群体 2 目标
    expect(new Set(heals.map((e) => e.targetId)).size).toBe(2);
    for (const h of heals) {
      expect(allies.map((u) => u.general.id)).toContain(h.targetId);
      expect(h.amount).toBeGreaterThan(0);
    }

    // 同回合第二次成功发动主动：已用过本回合的那一次 → 不再恢复
    for (const u of allies) u.troops = 5000;
    triggerActiveSkill(ctx, xiaoqiao, mizhen, foes, allies, [...foes, ...allies]);
    expect(eventsOf(ctx, 'heal').filter((e) => e.skillId === SKILL_ID)).toHaveLength(2);
  });

  it('控制 +1 目标：携带者打出随机单体控制（迷阵）时额外命中 1 个敌军，随后消耗标记', () => {
    const { xiaoqiao, allyFront, foes, ctx, allies } = setup(5);
    // 授予标记（等价于小乔行动时的那一段）
    inflictStatus(ctx, allyFront, { type: 'control_spread', duration: 999 }, 'command', SKILL_ID, xiaoqiao.general.id);
    expect(controlSpreads(allyFront)).toHaveLength(1);

    const mizhen = forcedSkill('mizhen', ctx);
    triggerActiveSkill(ctx, allyFront, mizhen, foes, allies, [...foes, ...allies]);

    // 迷阵本体 1 个随机目标 + 额外 1 个 → 两名敌军陷入暴走
    const rampaged = foes.filter((f) => f.statuses.some((s) => s.type === 'rampage'));
    expect(rampaged).toHaveLength(2);
    expect(rampaged[0].general.id).not.toBe(rampaged[1].general.id);
    // 标记已消耗
    expect(controlSpreads(allyFront)).toHaveLength(0);
    expect(getStatus(allyFront, 'control_spread')).toBeUndefined();
  });

  it('对照：无标记时迷阵只命中 1 个目标；未打出控制（伐谋）则标记不消耗、也不因回合递减消失', () => {
    // 对照 1：无标记 → 只有 1 名敌军暴走
    const plain = setup(5);
    triggerActiveSkill(
      plain.ctx,
      plain.allyFront,
      forcedSkill('mizhen', plain.ctx),
      plain.foes,
      plain.allies,
      [...plain.foes, ...plain.allies],
    );
    expect(plain.foes.filter((f) => f.statuses.some((s) => s.type === 'rampage'))).toHaveLength(1);

    // 对照 2：非控制段（伐谋 = 策略伤害 + 攻/谋下降）不消耗标记，tick 也不递减（消耗制）
    const neg = setup(9);
    inflictStatus(neg.ctx, neg.allyFront, { type: 'control_spread', duration: 999 }, 'command', SKILL_ID, neg.xiaoqiao.general.id);
    triggerActiveSkill(
      neg.ctx,
      neg.allyFront,
      forcedSkill('famou', neg.ctx),
      neg.foes,
      neg.allies,
      [...neg.foes, ...neg.allies],
    );
    expect(controlSpreads(neg.allyFront)).toHaveLength(1);
    tickStatuses(neg.ctx, [...neg.allies, ...neg.foes]);
    expect(controlSpreads(neg.allyFront)).toHaveLength(1);
  });

  it('整场跑通（runBattle）：小乔每回合行动授予标记，主动战法后恢复友军', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h687']), {
        commandSkillIds: [SKILL_ID],
        activeSkillIds: ['mizhen'],
      }),
      position: '大营',
    };
    const report = runBattle({
      seed: 17,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), leader],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(
      report.events.some((e) => e.type === 'skill_cast' && e.skillId === SKILL_ID),
    ).toBe(true);
  });
});
