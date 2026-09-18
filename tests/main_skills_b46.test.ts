/**
 * 地公将军（张宝·群弓 h562 主战法）：主动 B，距离 4，40%，敌军群体（有效距离内 2 个目标）。
 * 对敌军群体发动策略攻击（136%，受谋略属性影响），并吸取其 24.0 的防御、谋略属性并附加于友军群体
 * （受谋略属性影响），若有目标存在妖术效果，则额外附加属性至自身，持续 2 回合。
 * 官方：scripts/skill_extra.json id 200796（主动 B / 距离 4 / 敌军群体2 / 弓；1 级 68% / 12）。
 * 口径（用户确认）：「友军群体」= 有效距离内 2 个目标；「妖术效果」= sorcery（妖术）| curse（妖术诅咒）。
 * 口径（本次推定，待复核）：友军段 excludeSelf——原文「**额外**附加属性至自身」表明自身不在友军群体内。
 * 成长率：136% 与 24.0 两处受谋略成长未确认 → 按基值 → 张宝下架。
 * 引擎配套：新增 `inflict_status.requireAnyPrevDamageTargetStatus`（整段开关）；敌军段复用 `sameTargetsAsLastDamage`。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  effectiveStat,
  inflictStatus,
  triggerActiveSkill,
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

function heroGeneral(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): General {
  return { ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position };
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
): UnitState {
  return makeUnit(heroGeneral(heroId, position, skills));
}

/** 发动率拉满的地公将军（只考察效果，不掺发动率 RNG） */
function forcedSkill(): Skill {
  const s = structuredClone(SKILL_REGISTRY['digong_jiangjun']) as Skill;
  s.triggerRate = 1;
  return s;
}

/** 三人敌军 + 张宝与两名友军 */
function setup(seed = 5) {
  const zhangbao = heroUnit('h562', '大营', { activeSkillIds: ['digong_jiangjun'] });
  const allyA = makeUnit(dummy('ally-a', '前锋'));
  const allyB = makeUnit(dummy('ally-b', '中军'));
  const foes = [
    makeUnit(dummy('foe-a', '前锋'), 'enemy'),
    makeUnit(dummy('foe-b', '中军'), 'enemy'),
    makeUnit(dummy('foe-c', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([allyA, allyB, zhangbao], foes, seed);
  return { zhangbao, allyA, allyB, foes, ctx };
}

/** 给单位挂一条妖术（sorcery）状态（无施法者上下文，够本测用） */
function putSorcery(unit: UnitState): void {
  unit.statuses.push({
    type: 'sorcery',
    remaining: 2,
    rate: 100,
    sourceStrategy: 100,
    appliedRound: 1,
    sourceSkillType: 'active',
    sourceSkillId: 'test_sorcery',
  });
}

function statusesOfType(unit: UnitState, type: 'defense_buff' | 'strategy_buff') {
  return unit.statuses.filter(
    (s): s is Extract<UnitState['statuses'][number], { type: 'defense_buff' | 'strategy_buff' }> =>
      s.type === type,
  );
}

describe('地公将军（张宝 h562）', () => {
  it('装配：注册表定义（四段：伤害 / 吸取 / 附加友军 2 目标 / 妖术条件段）+ h562 挂槽 + 下架', () => {
    const hero = HERO_REGISTRY['h562'];
    expect(hero.name).toBe('张宝');
    expect(hero.mainSkillName).toBe('地公将军');

    const s = SKILL_REGISTRY['digong_jiangjun'];
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');

    expect(s.output[0]).toMatchObject({
      kind: 'strategy_damage',
      rate: 136,
      strategyScaled: true,
    });
    // 吸取段：打在上一段伤害的同一批目标上
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      sameTargetsAsLastDamage: true,
      applyAll: true,
      status: [
        { type: 'defense_buff', amount: -24, duration: 2, strategyScaled: true },
        { type: 'strategy_buff', amount: -24, duration: 2, strategyScaled: true },
      ],
    });
    // 友军段：2 目标、不含自身
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      targetMode: 'group',
      groupCount: 2,
      excludeSelf: true,
    });
    // 妖术条件段
    expect(s.output[3]).toMatchObject({
      kind: 'inflict_status',
      target: 'self',
      requireAnyPrevDamageTargetStatus: ['sorcery', 'curse'],
    });

    expect(OFFLINE_MAIN_SKILLS['digong_jiangjun']).toBeTruthy();
    expect(isHeroListed({ mainSkillId: 'digong_jiangjun' })).toBe(false);
  });

  it('敌军段：−24 防御 / −24 谋略 只落在本段策略攻击命中的那批目标上', () => {
    const { zhangbao, foes, ctx } = setup();
    triggerActiveSkill(ctx, zhangbao, forcedSkill(), foes, [zhangbao], foes);

    const damaged = new Set(
      ctx.events
        .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage')
        .map((e) => e.targetId),
    );
    const debuffed = new Set(
      foes.filter((f) => statusesOfType(f, 'defense_buff').length > 0).map((f) => f.general.id),
    );
    expect(damaged.size).toBe(2);
    expect(debuffed.size).toBe(2);
    expect([...debuffed].sort()).toEqual([...damaged].sort());
    // 数值：−24 / −24，持续 2 回合
    for (const f of foes.filter((x) => debuffed.has(x.general.id))) {
      expect(statusesOfType(f, 'defense_buff')[0].amount).toBe(-24);
      expect(statusesOfType(f, 'strategy_buff')[0].amount).toBe(-24);
      expect(statusesOfType(f, 'defense_buff')[0].remaining).toBe(2);
    }
  });

  it('友军段：两名友军各 +24 防御 / +24 谋略，且**不含张宝自身**', () => {
    const { zhangbao, allyA, allyB, foes, ctx } = setup();
    triggerActiveSkill(ctx, zhangbao, forcedSkill(), foes, [zhangbao], foes);

    for (const ally of [allyA, allyB]) {
      expect(statusesOfType(ally, 'defense_buff')[0]?.amount).toBe(24);
      expect(statusesOfType(ally, 'strategy_buff')[0]?.amount).toBe(24);
    }
    // 无妖术 → 张宝自身不获得属性（excludeSelf + 条件段未触发）
    expect(statusesOfType(zhangbao, 'defense_buff')).toHaveLength(0);
    expect(statusesOfType(zhangbao, 'strategy_buff')).toHaveLength(0);
  });

  it('妖术条件段：目标带妖术（sorcery）时张宝额外获得 +24 防御 / +24 谋略', () => {
    const { zhangbao, foes, ctx } = setup();
    for (const f of foes) putSorcery(f);
    triggerActiveSkill(ctx, zhangbao, forcedSkill(), foes, [zhangbao], foes);

    expect(statusesOfType(zhangbao, 'defense_buff')[0]?.amount).toBe(24);
    expect(statusesOfType(zhangbao, 'strategy_buff')[0]?.amount).toBe(24);
    // 属性生效（effectiveStat 体现）
    expect(effectiveStat(zhangbao, 'defense')).toBe(zhangbao.general.defense + 24);
  });

  it('妖术条件段：妖术诅咒（curse）同样满足条件', () => {
    const { zhangbao, foes, ctx } = setup();
    // 只给其中一个目标挂 curse，且确保它被本段命中：全部目标挂，覆盖命中的那两个
    for (const f of foes) {
      inflictStatus(
        ctx,
        f,
        { type: 'curse', duration: 2, rate: 100, growthRate: 0 },
        'active',
        'test_curse',
      );
    }
    triggerActiveSkill(ctx, zhangbao, forcedSkill(), foes, [zhangbao], foes);
    expect(statusesOfType(zhangbao, 'defense_buff')[0]?.amount).toBe(24);
  });

  it('整场战斗：地公将军造成伤害并施加属性变化', () => {
    const zhangbao = heroGeneral('h562', '大营', { activeSkillIds: ['digong_jiangjun'] });
    const report = runBattle({
      seed: 41,
      maxRounds: 8,
      myTeam: [dummy('ally-a', '前锋'), dummy('ally-b', '中军'), zhangbao],
      enemyTeam: [dummy('foe-a', '前锋'), dummy('foe-b', '中军'), dummy('foe-c', '大营')],
    });

    const dmg = report.events.filter(
      (e) => e.type === 'damage' && e.skillId === 'digong_jiangjun',
    );
    expect(dmg.length).toBeGreaterThan(0);
    const buffs = report.events.filter(
      (e) =>
        e.type === 'status_inflicted' &&
        (e.statusType === 'defense_buff' || e.statusType === 'strategy_buff'),
    );
    expect(buffs.length).toBeGreaterThan(0);
  });
});
