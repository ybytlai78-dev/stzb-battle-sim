/**
 * 破凰（司马懿·魏步 h472 主战法）：主动 A，距离 5，45%，敌军单体。
 * ① 立即引发敌军全体由破凰带来的剩余妖术效果；
 * ② 对敌军单体发动一次策略攻击（155%，受谋略属性影响）；
 * ③ 使其每受到伤害时额外引发一次妖术伤害（130%，受谋略属性影响），最多生效 3 次，持续 3 回合。
 * 官方：scripts/skill_extra.json id 200080（满级 155%/130%，1 级 77.5%/65%）。
 * 口径（用户逐条确认）：
 *  - ① 的「剩余妖术」= **本战法自身**此前施加的条件妖术剩余次数：先引爆（剩余 N 次 → 连打 N 次并移除），
 *    再 ②③ 施加新的条件妖术；首次发动无存量 → ① 空转。
 *  - 两版拼接描述取第一版「敌军单体」（第二版「兵力最低的单体」需特殊目标选择机制，本战法不引入）。
 *  - 155% / 130% 两段「受谋略」成长率未确认 → 按基值（strategyScaled 在；DoT growthRate 给 0）→ 司马懿下架。
 * 引擎配套：`sorcery` 状态新增 `onHurt` / `charges`（受击触发妖术 + 次数上限），
 * 新增输出段 `detonate_sorcery_marks`（引爆敌军全体由本战法施加的受击触发妖术剩余次数）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  actUnit,
  applyDamage,
  inflictStatus,
  triggerActiveSkill,
  type CombatContext,
} from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { runBattle } from '../src/engine/combat';
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

/** 40 级武将面板（主战法挂槽后返回 General，供 runBattle 使用） */
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

/** 发动率拉满的战法定义副本（直接驱动 triggerActiveSkill，不依赖 45% 判定） */
function forceSkill(id: string): Skill {
  const s = structuredClone(SKILL_REGISTRY[id]) as Skill;
  s.triggerRate = 1;
  return s;
}

function setup(seed = 1) {
  const sima = heroUnit('h472', '大营', { activeSkillIds: ['po_huang'] });
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
  const ctx = makeCtx([sima], [foe], seed);
  return { sima, foe, ctx };
}

/** 破凰的条件妖术（受击触发妖术）状态 */
function hurtMark(unit: UnitState): Extract<Status, { type: 'sorcery' }> | undefined {
  return unit.statuses.find(
    (s): s is Extract<Status, { type: 'sorcery' }> => s.type === 'sorcery' && s.onHurt === true,
  );
}

function dotTicks(ctx: CombatContext) {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'dot_tick' }> => e.type === 'dot_tick',
  );
}

function damages(ctx: CombatContext, skillId = 'po_huang') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

const markCreate = {
  type: 'sorcery',
  duration: 3,
  rate: 130,
  growthRate: 0,
  onHurt: true,
  charges: 3,
} as const;

describe('破凰（司马懿 h472）', () => {
  it('装配：注册表定义 + h472 挂槽 + 受谋略成长未确认下架', () => {
    const hero = HERO_REGISTRY['h472'];
    expect(hero.name).toBe('司马懿');
    expect(hero.mainSkillName).toBe('破凰');

    const s = SKILL_REGISTRY['po_huang'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.45);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['damage', 'sorcery']);
    expect(s.output[0]).toEqual({ kind: 'detonate_sorcery_marks' });
    expect(s.output[1]).toMatchObject({ kind: 'strategy_damage', rate: 155, strategyScaled: true });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'sorcery', duration: 3, rate: 130, growthRate: 0, onHurt: true, charges: 3 },
    });

    // 策略 155% / 条件妖术 130% 受谋略成长未确认 → 登记下架（按基值不缩放）
    expect(OFFLINE_MAIN_SKILLS['po_huang']).toBeTruthy();
    expect(isHeroListed({ mainSkillId: 'po_huang' })).toBe(false);
  });

  it('首次发动：无存量 → 引爆段空转；策略攻击 155% + 挂条件妖术（剩余 3 次 / 持续 3 回合）', () => {
    const { ctx, sima, foe } = setup();
    triggerActiveSkill(ctx, sima, forceSkill('po_huang'), [foe], [sima], [foe]);

    // ① 无剩余妖术 → 引爆段空转
    expect(dotTicks(ctx)).toHaveLength(0);
    // ② 策略攻击 155%
    const dmg = damages(ctx);
    expect(dmg).toHaveLength(1);
    expect(dmg[0].damageType).toBe('strategy');
    expect(dmg[0].targetId).toBe(foe.general.id);
    // ③ 挂条件妖术
    const inflicted = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted',
    );
    expect(inflicted).toHaveLength(1);
    expect(inflicted[0].detail).toContain('受击触发 剩余 3 次');
    const mark = hurtMark(foe);
    expect(mark?.rate).toBe(130);
    expect(mark?.charges).toBe(3);
    expect(mark?.remaining).toBe(3);
  });

  it('条件妖术：每次受击额外引发 1 次妖术伤害，3 次用尽即移除（第 4 次受击不再触发）', () => {
    const { ctx, sima, foe } = setup();
    inflictStatus(ctx, foe, markCreate, 'active', 'po_huang', sima.general.id);
    expect(hurtMark(foe)?.charges).toBe(3);

    applyDamage(ctx, foe, 1, sima, 'physical', 'skill');
    // 一次受击只触发 1 次——妖术伤害自身的 applyDamage 不得再次触发本标记
    expect(dotTicks(ctx)).toHaveLength(1);
    expect(hurtMark(foe)?.charges).toBe(2);

    applyDamage(ctx, foe, 1, sima, 'physical', 'skill');
    expect(dotTicks(ctx)).toHaveLength(2);
    expect(hurtMark(foe)?.charges).toBe(1);

    applyDamage(ctx, foe, 1, sima, 'physical', 'skill');
    expect(dotTicks(ctx)).toHaveLength(3);
    expect(hurtMark(foe)).toBeUndefined();
    expect(ctx.events.filter((e) => e.type === 'status_expired')).toHaveLength(1);

    applyDamage(ctx, foe, 1, sima, 'physical', 'skill');
    expect(dotTicks(ctx)).toHaveLength(3);
  });

  it('条件妖术不在行动时跳伤（对照：普通妖术照常跳伤）', () => {
    const sima = heroUnit('h472', '大营', { activeSkillIds: ['po_huang'] });
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const plain = makeUnit(dummy('plain', '中军'), 'enemy');
    const ctx = makeCtx([sima], [foe, plain]);

    inflictStatus(ctx, foe, markCreate, 'active', 'po_huang', sima.general.id);
    inflictStatus(
      ctx,
      plain,
      { type: 'sorcery', duration: 3, rate: 100, growthRate: 0 },
      'active',
      'other_skill',
      sima.general.id,
    );

    actUnit(ctx, foe);
    expect(dotTicks(ctx).filter((e) => e.sourceId === foe.general.id)).toHaveLength(0);

    actUnit(ctx, plain);
    expect(dotTicks(ctx).filter((e) => e.sourceId === plain.general.id)).toHaveLength(1);
  });

  it('第二次发动：引爆剩余次数（剩 2 → 连打 2 次冻结伤害并移除），再施加新的 3 次', () => {
    const { ctx, sima, foe } = setup();
    const skill = forceSkill('po_huang');

    // 第 1 次：挂 3 次
    triggerActiveSkill(ctx, sima, skill, [foe], [sima], [foe]);
    const first = hurtMark(foe);
    expect(first?.charges).toBe(3);

    // 受 1 次伤害消耗 1 次 → 剩 2
    applyDamage(ctx, foe, 1, sima, 'physical', 'skill');
    expect(dotTicks(ctx)).toHaveLength(1);

    // 第 2 次：先引爆剩余 2 次，再 155% 策略，再挂新的 3 次
    triggerActiveSkill(ctx, sima, skill, [foe], [sima], [foe]);
    const ticks = dotTicks(ctx);
    expect(ticks).toHaveLength(3);
    expect(ticks[1].dotType).toBe('sorcery');
    expect(ticks[1].casterId).toBe(sima.general.id);
    // 引爆沿用「挂上时冻结」的每次伤害（不重算）
    expect(ticks[1].damage).toBe(ticks[0].damage);
    expect(ticks[2].damage).toBe(ticks[0].damage);
    expect(damages(ctx)).toHaveLength(2);

    const next = hurtMark(foe);
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    expect(next?.charges).toBe(3);
    expect(next?.remaining).toBe(3);
  });

  it('整场战斗（8 回合）：引爆/条件妖术伤害均归属破凰，charges 从不超过 3', () => {
    // runBattle 收 General[]（非 UnitState[]）
    const sima = heroGeneral('h472', '大营', { activeSkillIds: ['po_huang'] });
    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [dummy('ally', '前锋'), dummy('mid', '中军'), sima],
      enemyTeam: [dummy('foe', '前锋')],
    });

    // 条件妖术（含引爆）打出的 dot_tick 全部归属破凰 / 司马懿，且为妖术类型
    const ticks = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'dot_tick' }> => e.type === 'dot_tick',
    );
    expect(ticks.length).toBeGreaterThan(0);
    expect(
      ticks.every(
        (t) => t.skillId === 'po_huang' && t.casterId === sima.id && t.dotType === 'sorcery',
      ),
    ).toBe(true);

    // 每次施加的条件妖术剩余次数不超过 3
    const marks = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && e.statusType === 'sorcery',
    );
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((e) => /剩余 [123] 次/.test(e.detail ?? ''))).toBe(true);
  });
});
