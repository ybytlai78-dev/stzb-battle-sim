/**
 * 全主诿异（孙鲁班·吴弓 h654 主战法）：主动 B，发动率 40%，距离 5。
 * ① 使敌军全体被施加的燃烧、恐慌和妖术诅咒伤害提升 20%（受谋略属性影响），持续 3 回合；
 * ② 同时对敌军群体 1-2 目标额外发动 1 次策略攻击（伤害率 197%，受谋略属性影响）。
 * 官方：scripts/skill_extra.json id 200937（满级 20% / 197%，1 级 10% / 98.5%）。
 * 引擎配套：新增 `damage_boost.dotTypes` 过滤维（DoT 挂上时结算按 dotType 过滤）。
 * 成长率：两处「受谋略属性影响」未确认 → 留空（strategyScaled 在、不给 growthRate → 按基值不缩放）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type {
  BattleEvent,
  CreateStatus,
  DotStoredDamage,
  General,
  Position,
  Skill,
  Status,
  UnitState,
} from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
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
    faction: '吴',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 10000,
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

function forceSkill(ctx: CombatContext, id: string, patch: (s: Skill) => void): void {
  const cloned = structuredClone(SKILL_REGISTRY[id]) as Skill;
  patch(cloned);
  ctx.skills.set(id, cloned);
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

function boostOf(unit: UnitState) {
  return unit.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === 'quanzhu_weiyi',
  );
}

/** 全主诿异的 DoT 增伤状态模板（与 skills.ts 定义一致） */
const WEIYI_BOOST: CreateStatus = {
  type: 'damage_boost',
  rate: 0.2,
  duration: 3,
  direction: 'taken',
  dotTypes: ['burning', 'panic', 'curse'],
  strategyScaled: true,
};

function storedOf(unit: UnitState, type: 'burning' | 'sorcery' | 'curse'): DotStoredDamage | undefined {
  const s = unit.statuses.find((x) => x.type === type);
  return s && 'stored' in s ? s.stored : undefined;
}

describe('全主诿异（孙鲁班 h654）', () => {
  it('装配：注册表定义 + 挂槽名（主动 B / 40% / 距离 5 / 群体 1-2 目标）', () => {
    const hero = HERO_REGISTRY['h654'];
    expect(hero.name).toBe('孙鲁班');
    expect(hero.mainSkillName).toBe('全主诿异');

    const s = SKILL_REGISTRY['quanzhu_weiyi'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.triggerRate).toBe(0.4);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toEqual([1, 2]);
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['damage', 'damage_boost']);
    // ① 敌军全体：DoT 增伤（受谋略，无 growthRate = 不缩放）
    expect(s.output[0]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'enemy',
      targetMode: 'all',
      status: {
        type: 'damage_boost',
        rate: 0.2,
        duration: 3,
        direction: 'taken',
        dotTypes: ['burning', 'panic', 'curse'],
        strategyScaled: true,
      },
    });
    if (s.output[0].kind === 'inflict_status' && !Array.isArray(s.output[0].status)) {
      expect('growthRate' in s.output[0].status ? s.output[0].status.growthRate : undefined).toBeUndefined();
    }
    // ② 额外策略攻击 197%（受谋略，成长率留空）
    expect(s.output[1]).toMatchObject({ kind: 'strategy_damage', rate: 197, strategyScaled: true });
    if (s.output[1].kind === 'strategy_damage') {
      expect(s.output[1].growthRate).toBeUndefined();
    }
  });

  it('强制释放：敌军全体吃 DoT 增伤 + 1-2 名敌军吃额外策略攻击', () => {
    const me = heroUnit('h654', '中军', { activeSkillIds: ['quanzhu_weiyi'] });
    const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e-mid', '中军'), 'enemy');
    const e3 = makeUnit(dummy('e-camp', '大营'), 'enemy');
    const ctx = makeCtx([me], [e1, e2, e3]);
    forceSkill(ctx, 'quanzhu_weiyi', (s) => {
      s.triggerRate = 1;
    });

    actUnit(ctx, me);

    for (const u of [e1, e2, e3]) {
      const boost = boostOf(u);
      expect(boost?.rate).toBe(0.2);
      expect(boost?.direction).toBe('taken');
      expect(boost && 'dotTypes' in boost ? boost.dotTypes : undefined).toEqual(['burning', 'panic', 'curse']);
    }
    const dmg = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === 'quanzhu_weiyi',
    );
    expect(dmg.length).toBeGreaterThanOrEqual(1);
    expect(dmg.length).toBeLessThanOrEqual(2);
    expect(dmg.every((d) => d.damageType === 'strategy')).toBe(true);
  });

  it('dotTypes 过滤精度：燃烧 / 妖术诅咒吃 +20%，妖术（未列出）不吃', () => {
    const caster = makeUnit(dummy('caster', '大营'));
    const eBurn = makeUnit(dummy('e-burn', '前锋'), 'enemy');
    const eSorc = makeUnit(dummy('e-sorc', '中军'), 'enemy');
    const eCurse = makeUnit(dummy('e-curse', '大营'), 'enemy');
    const ctx = makeCtx([caster], [eBurn, eSorc, eCurse]);

    // 三个目标都挂上全主诿异的 DoT 增伤
    for (const t of [eBurn, eSorc, eCurse]) {
      inflictStatus(ctx, t, WEIYI_BOOST, 'active', 'quanzhu_weiyi', caster.general.id);
    }
    // 同一施法者、同参数依次施加燃烧 / 妖术 / 妖术诅咒（DoT 伤害在挂上时冻结，无随机项）
    const dot = (type: 'burning' | 'sorcery' | 'curse'): CreateStatus => ({
      type,
      duration: 2,
      rate: 100,
      growthRate: 0,
    });
    inflictStatus(ctx, eBurn, dot('burning'), 'active', 'dot_probe', caster.general.id);
    inflictStatus(ctx, eSorc, dot('sorcery'), 'active', 'dot_probe', caster.general.id);
    inflictStatus(ctx, eCurse, dot('curse'), 'active', 'dot_probe', caster.general.id);

    const burn = storedOf(eBurn, 'burning');
    const sorc = storedOf(eSorc, 'sorcery');
    const curse = storedOf(eCurse, 'curse');
    expect(burn?.damage).toBeGreaterThan(0);
    expect(sorc?.damage).toBeGreaterThan(0);
    expect(curse?.damage).toBeGreaterThan(0);

    const listed = (s?: DotStoredDamage) =>
      (s?.modifiers.taken ?? []).some((m) => m.skillId === 'quanzhu_weiyi');
    expect(listed(burn)).toBe(true); // 燃烧在列表
    expect(listed(curse)).toBe(true); // 妖术诅咒在列表
    expect(listed(sorc)).toBe(false); // 妖术不在列表

    // 加成约 +20%（未加成者同参数，作基线；小数值下三部分各自取整 → 用区间判断）
    expect(burn!.damage).toBeGreaterThan(sorc!.damage);
    for (const boosted of [burn!, curse!]) {
      const ratio = boosted.damage / sorc!.damage;
      expect(ratio).toBeGreaterThan(1.1);
      expect(ratio).toBeLessThan(1.35);
    }
  });

  it('成长率留空：谋略 80 与 300 的 DoT 增伤都是 20%（不缩放）', () => {
    const rateAt = (strategy: number) => {
      const me = heroUnit('h654', '中军', { activeSkillIds: ['quanzhu_weiyi'] }, { strategy });
      const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
      const ctx = makeCtx([me], [e1]);
      forceSkill(ctx, 'quanzhu_weiyi', (s) => {
        s.triggerRate = 1;
      });
      actUnit(ctx, me);
      return boostOf(e1)?.rate;
    };
    expect(rateAt(80)).toBe(0.2);
    expect(rateAt(300)).toBe(0.2);
  });

  it('整场跑通（runBattle）：出现策略伤害与 DoT 增伤状态', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h654']), { activeSkillIds: ['quanzhu_weiyi'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 5,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), leader, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(
      report.events.some((e) => e.type === 'damage' && e.skillId === 'quanzhu_weiyi'),
    ).toBe(true);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'damage_boost',
    );
    expect(inflicted.length).toBeGreaterThan(0);
  });
});
