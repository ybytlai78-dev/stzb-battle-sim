/**
 * 率尔方雅（胡芳·晋步 h797 主战法）：主动 A，距离 5，发动率 40%，敌我群体（有效距离内 3 个目标）。
 * 对自身以外的随机 3 名武将造成一次攻击伤害（伤害率 10.0%）；
 * 若目标为友军 → 使其造成的所有伤害提升 22.0%（受谋略属性影响）持续 1 回合，
 *   并使其立即对敌军群体发动一次攻击（180.0%）或策略攻击（180.0%，受谋略属性影响）——
 *   伤害类型由该武将自身攻击与谋略孰高决定；
 * 若目标为敌军 → 随机陷入犹豫 / 混乱 / 暴走 / 怯战之一，持续 1 回合。
 * 官方：scripts/skill_extra.json id 200273（主动 A / 距离 5 / 敌我群体3 / 兵种弓步骑 / 发动率 40%；
 *   1 级 10% / 增伤 11% / 90%）。
 * 入档：22% 增伤与 180% 策略段「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 +
 *   登记 OFFLINE_MAIN_SKILLS → 胡芳**下架**。
 * 引擎配套：
 *   ① `BaseSkill.targetPool:'mixed'`（敌我同池随机 N、排除施法者自身）；
 *   ② `SkillOutput.lockedSide`（段级按阵营过滤**锁定目标**，不重选池）——同一批 3 个目标按阵营分派效果；
 *   ③ 友军代打复用 `attacker:'recipient'` + `recipientDamageByHigherStat`（攻击 > 谋略 → 攻击伤害，否则策略）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'lv_er_fang_ya';
/** 率尔方雅「随机 1 种控制」的四种候选 */
const CONTROLS: readonly string[] = ['hesitation', 'confusion', 'rampage', 'cowardice'];

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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

/** 发动率拉满（只考察战法语义，不掺发动率 RNG） */
function forcedSkill(): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  s.triggerRate = 1;
  return s;
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function damagesOf(ctx: CombatContext) {
  return eventsOf(ctx, 'damage').filter((d) => d.skillId === SKILL_ID);
}

function castHu(ctx: CombatContext, hu: UnitState): void {
  triggerActiveSkill(ctx, hu, forcedSkill(), ctx.enemyTeam, ctx.myTeam, [...ctx.enemyTeam, ...ctx.myTeam]);
}

const ALLY_BY_ATTACK: Partial<General> = { attack: 200, strategy: 50 };
const ALLY_BY_STRATEGY: Partial<General> = { attack: 50, strategy: 200 };

/** 胡芳（大营）+ 1 友军 + foeCount 敌军；默认 2 名友军候选（混合池验证用） */
function setup(seed = 1, ally: Partial<General> = ALLY_BY_ATTACK, foeCount = 1, allyCount = 1) {
  const hu = heroUnit('h797', '大营', { activeSkillIds: [SKILL_ID] });
  const positions: Position[] = ['前锋', '中军', '大营'];
  const friends = Array.from({ length: allyCount }, (_, i) =>
    makeUnit(dummy(`ally-${i + 1}`, positions[i], ally)),
  );
  const foes = Array.from({ length: foeCount }, (_, i) => makeUnit(dummy(`foe-${i + 1}`, positions[i]), 'enemy'));
  const ctx = makeCtx([hu, ...friends], foes, seed);
  return { hu, friends, foes, ctx };
}

describe('率尔方雅（胡芳 h797）', () => {
  it('装配：注册表定义（官方数值）+ h797 挂槽 + 受谋略成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h797'];
    expect(hero.name).toBe('胡芳');
    expect(hero.faction).toBe('晋');
    expect(hero.mainSkillName).toBe('率尔方雅');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.4); // 官方发动率 40%
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(3);
    expect(s.targetPool).toBe('mixed'); // 敌我同池随机 3、排除自身
    expect([...s.tags].sort()).toEqual(
      ['confusion', 'cowardice', 'damage', 'damage_boost', 'hesitation', 'rampage'].sort(),
    );

    // ① 对自身以外随机 3 名武将造成一次攻击伤害 10%
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 10 });
    // ② 友军段：造成伤害 +22%（受谋略；成长率留空 → 按基值不缩放）1 回合
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      lockedSide: 'ally',
      status: {
        type: 'damage_boost',
        rate: 0.22,
        direction: 'caused',
        strategyScaled: true,
        duration: 1,
      },
    });
    // ③ 友军段：立即对敌军群体（2 目标）发动攻击/策略 180%，按该将攻击/谋略孰高定轨
    expect(s.output[2]).toMatchObject({
      kind: 'physical_damage',
      attacker: 'recipient',
      lockedSide: 'ally',
      recipientDamageByHigherStat: { attackRate: 180, strategyRate: 180 },
      targetMode: 'group',
      groupCount: 2,
    });
    // ④ 敌军段：随机 1 种控制，持续 1 回合
    expect(s.output[3]).toMatchObject({
      kind: 'inflict_status',
      lockedSide: 'enemy',
      status: [
        { type: 'hesitation', duration: 1 },
        { type: 'confusion', duration: 1 },
        { type: 'rampage', duration: 1 },
        { type: 'cowardice', duration: 1 },
      ],
    });

    // 下架：22% 增伤 / 180% 策略段受谋略成长未确认
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('混合目标池：锁定 3 个目标、不含施法者自身，且友军与敌军都可能入选（跨 seed）', () => {
    const pickedAlly = new Set<string>();
    const pickedFoe = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      // 胡芳 + 2 友军 + 3 敌军 = 5 个候选，随机抽 3
      const { hu, friends, foes, ctx } = setup(seed, ALLY_BY_ATTACK, 3, 2);
      castHu(ctx, hu);
      const targets = eventsOf(ctx, 'skill_target').filter((e) => e.skillId === SKILL_ID);
      expect(targets).toHaveLength(1);
      const ids = targets[0].targetIds;
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3); // 不放回抽取
      expect(ids).not.toContain(hu.general.id); // 排除自身
      // ① 三个目标各吃一条 10% 攻击伤害（施法者＝胡芳；③ 的友军代打伤害 sourceId 是友军，另计）
      const mine = damagesOf(ctx).filter((d) => d.sourceId === hu.general.id);
      expect(mine.map((d) => d.targetId).sort()).toEqual([...ids].sort());
      for (const id of ids) {
        if (friends.some((f) => f.general.id === id)) pickedAlly.add(id);
        if (foes.some((f) => f.general.id === id)) pickedFoe.add(id);
      }
    }
    // 敌我同池：两种阵营都会有名额（纯敌军池永远选不到友军）
    expect(pickedAlly.size).toBeGreaterThan(0);
    expect(pickedFoe.size).toBeGreaterThan(0);
  });

  it('段级按阵营过滤：友军目标得「造成伤害 +22%」且不吃控制；敌军目标吃 1 种控制且不吃增伤', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { hu, friends, foes, ctx } = setup(seed, ALLY_BY_ATTACK, 3, 2);
      castHu(ctx, hu);
      const ids = eventsOf(ctx, 'skill_target').find((e) => e.skillId === SKILL_ID)!.targetIds;
      const all = [...friends, ...foes];
      for (const id of ids) {
        const u = all.find((x) => x.general.id === id)!;
        const isAlly = u.side === 'my';
        const boost = u.statuses.find((s) => s.type === 'damage_boost');
        const controls = u.statuses.filter((s) => CONTROLS.includes(s.type));
        if (isAlly) {
          expect(boost).toBeTruthy();
          if (boost && boost.type === 'damage_boost') {
            // 22% 按谋略 80 基值口径：成长率未确认（留空）→ 不缩放，胡芳谋略 71 也是 22%
            // （strategyScaled/growthRate 只用于施加时缩放，不进 Status，运行期不携带该字段）
            expect(boost.rate).toBeCloseTo(0.22, 5);
            expect(boost.direction).toBe('caused');
            expect(boost.remaining).toBe(1);
          }
          expect(controls).toHaveLength(0); // 友军段不打控制
        } else {
          expect(boost).toBeUndefined(); // 敌军段不打增伤
          expect(controls).toHaveLength(1);
        }
      }
    }
  });

  it('代打：友军目标立即对敌军发动伤害，按该将攻击/谋略孰高定轨（攻高走攻击、谋高走策略）', () => {
    // 攻 200 / 谋 50 → 攻击伤害
    const a = setup(3, ALLY_BY_ATTACK, 1, 1);
    castHu(a.ctx, a.hu);
    const attacker = a.friends[0];
    const foe = a.foes[0];
    const byAttacker = damagesOf(a.ctx).filter((d) => d.sourceId === attacker.general.id);
    expect(byAttacker).toHaveLength(1);
    expect(byAttacker[0].damageType).toBe('physical');
    expect(byAttacker[0].targetId).toBe(foe.general.id);
    expect(byAttacker[0].damage).toBeGreaterThan(0);

    // 谋 200 / 攻 50 → 策略伤害
    const b = setup(3, ALLY_BY_STRATEGY, 1, 1);
    castHu(b.ctx, b.hu);
    const byMage = damagesOf(b.ctx).filter((d) => d.sourceId === b.friends[0].general.id);
    expect(byMage).toHaveLength(1);
    expect(byMage[0].damageType).toBe('strategy');
  });

  it('随机 1 种控制：每个敌军目标恰好 1 个控制状态，跨 seed 会出现多种', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const { hu, foes, ctx } = setup(seed, ALLY_BY_ATTACK, 1, 1);
      castHu(ctx, hu);
      const controls = foes[0].statuses.filter((s) => CONTROLS.includes(s.type));
      expect(controls).toHaveLength(1);
      seen.add(controls[0].type);
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const t of seen) expect(CONTROLS).toContain(t);
  });

  it('整场跑通（runBattle）：胡芳在场发动率判定不报错', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h797']), { activeSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 21,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), leader],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    const attempts = report.events.filter(
      (e) => e.type === 'skill_trigger' && e.skillId === SKILL_ID,
    );
    expect(attempts.length).toBeGreaterThan(0);
  });
});
