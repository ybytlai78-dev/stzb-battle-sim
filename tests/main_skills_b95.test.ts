/**
 * 鏖兵卫主（XP程普·吴步 h684 主战法）：指挥 A（两段异时机：每回合行动判定的二类指挥 + 兵力阈值事件监听），
 * 距离 3，我军群体（有效距离内 2 个目标），发动率 --。
 * 满级：使我军群体每回合有 45.0% 几率增加 50.0 点防御属性（受防御属性影响），持续 1 回合；同时当自身位于
 *   中军及前锋时，大营兵力首次低于初始兵力的 90%、70%、50% 时，自身必定援护友军群体 1 回合，
 *   且自身下 2 次受到的伤害大幅度降低。1 级：防御 +25.0 点。
 * 官方：scripts/skill_extra.json id 200958。来源 https://stzb.163.com/m/skilllist/200958.html
 * 口径（策略 A + 用户 2026-09-20 口径；推定处已标注）：
 *   ① 45% 段 = 二类指挥 `roundTrigger:'on_act'` + 段级 `chance: 0.45`（走士气）+ 段级重选我军群体 2 目标；
 *   ② 防御 +50「受防御属性影响」→ 新增 `defenseScaled`（属性类）标记在、成长率未确认 → 基值 50 不缩放 → 下架；
 *   ③ 大营三档阈值 = 新引擎件 `CommandSkill.allyTroopThreshold`（每档 1 次、同次结算跨档只算一次）；
 *   ④ 「大幅度」= 极大值（用户口径）→ taken 侧 rate −99.99（−9999%）+ `charges: 2`（下 2 次受击各扣 1）。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, applyDamage, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, CreateStatus, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'aobing_weizhu';
const HERO_ID = 'h684';

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

function makeUnit(g: General, side: 'my' | 'enemy' = 'my', troops?: number): UnitState {
  return {
    general: g,
    side,
    troops: troops ?? g.maxTroops,
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

function heroUnit(heroId: string, position: Position): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

const statusOf = <T extends Status['type']>(u: UnitState, type: T) =>
  u.statuses.find((s) => s.type === type && s.sourceSkillId === SKILL_ID) as
    | Extract<Status, { type: T }>
    | undefined;

const thresholdEvents = (ctx: CombatContext) =>
  eventsOf(ctx, 'status_changed').filter((e) => e.detail.includes('兵力首次跌破阈值'));

/** 克隆注册表定义并覆盖防御段的段级发动率（45% 掷骰会让机制断言不确定） */
function withChance(chance: number): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'command') throw new Error('鏖兵卫主应为指挥战法');
  const seg = s.output.find((o) => o.kind === 'inflict_status');
  if (!seg || seg.kind !== 'inflict_status') throw new Error('缺少防御段');
  seg.chance = chance;
  return s;
}

/** 阈值段的减伤 CreateStatus（从注册表定义里取，保证与实装同款） */
function reduceCreate(): CreateStatus {
  const s = SKILL_REGISTRY[SKILL_ID];
  if (s.type !== 'command' || !s.allyTroopThreshold) throw new Error('缺少 allyTroopThreshold');
  const seg = s.allyTroopThreshold.output.find(
    (o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'damage_boost'
  );
  if (!seg || seg.kind !== 'inflict_status' || Array.isArray(seg.status)) throw new Error('缺少减伤段');
  return seg.status;
}

/** 程普（中军）+ 前锋/大营友军 + 1 名敌军 */
function setup(seed = 3) {
  const chengPu = heroUnit(HERO_ID, '中军');
  const front = makeUnit(dummy('ally-front', '前锋'), 'my', 30000);
  const back = makeUnit(dummy('ally-back', '大营'), 'my', 30000);
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy', 30000);
  const ctx = makeCtx([front, chengPu, back], [foe], seed);
  return { ctx, chengPu, front, back, foe };
}

/** 敌军被试战法：1 次物理攻击（100%、必定发动） */
function testPhysSkill(): Skill {
  return {
    id: 't_phys',
    name: '测试猛攻',
    type: 'active',
    prepare: false,
    range: 5,
    triggerRate: 1,
    targetMode: 'random_single',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
  };
}

/** 敌军连打程普 acts 次（我方仅程普一人；敌军吃到怯战 → 只放战法、不普攻，便于逐次计数 charges） */
function chengPuHits(withDebuff: boolean, acts: number, seed = 41) {
  const chengPu = heroUnit(HERO_ID, '前锋');
  const foe = makeUnit(dummy('foe', '前锋', { activeSkillIds: ['t_phys'] }), 'enemy', 30000);
  const ctx = makeCtx([chengPu], [foe], seed);
  ctx.skills.set('t_phys', testPhysSkill());
  // 怯战封普攻：每次行动只打 1 次战法伤害，charges 消耗节奏可逐次断言
  inflictStatus(ctx, foe, { type: 'cowardice', duration: 999 }, 'active', 'test_seal', foe.general.id);
  if (withDebuff) inflictStatus(ctx, chengPu, reduceCreate(), 'command', SKILL_ID, chengPu.general.id);
  const damages: number[] = [];
  const troopBases: number[] = [];
  for (let i = 0; i < acts; i++) {
    const before = ctx.events.length;
    actUnit(ctx, foe);
    const ev = ctx.events
      .slice(before)
      .filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 't_phys');
    damages.push(ev[0]?.damage ?? 0);
    troopBases.push(ev[0]?.breakdown.troopBase ?? 0);
  }
  return { ctx, chengPu, damages, troopBases };
}

describe('鏖兵卫主（XP程普 h684）', () => {
  it('装配：二类指挥 on_act·距离 3·我军群体 2·45% 防御 +50（受防御）+ 大营三档阈值·挂槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('XP程普');
    expect(hero.faction).toBe('吴');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('鏖兵卫主');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.commandSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('ally');
    expect(s.tags).toEqual(['defense_buff', 'cover', 'damage_boost']);
    expect(s.output).toEqual([
      {
        kind: 'inflict_status',
        targetSide: 'ally',
        targetMode: 'group',
        groupCount: 2,
        chance: 0.45,
        status: { type: 'defense_buff', amount: 50, duration: 1, defenseScaled: true },
      },
    ]);
    expect(s.allyTroopThreshold).toEqual({
      watchPosition: '大营',
      thresholds: [90, 70, 50],
      casterPositions: ['中军', '前锋'],
      output: [
        { kind: 'inflict_status', target: 'self', status: { type: 'cover', duration: 1 } },
        {
          kind: 'inflict_status',
          target: 'self',
          status: { type: 'damage_boost', rate: -99.99, duration: 999, direction: 'taken', charges: 2 },
        },
      ],
    });

    // 防御点数受防御成长率未确认 → 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·每回合行动 45%：命中则我军群体 2 人防御 +50（持续 1 回合），未命中则不施加', () => {
    const hit = setup(6);
    hit.ctx.skills.set(SKILL_ID, withChance(1));
    actUnit(hit.ctx, hit.chengPu);
    const buffed = hit.ctx.myTeam.filter((u) => statusOf(u, 'defense_buff'));
    expect(buffed).toHaveLength(2); // 我军群体（有效距离内 2 个目标）
    for (const u of buffed) {
      const st = statusOf(u, 'defense_buff')!;
      expect(st.amount).toBe(50); // 受防御未确认 → 基值 50（不缩放）
      expect(st.remaining).toBeLessThanOrEqual(1);
    }
    // 尚未行动的友军：duration 1 = 本回合内生效（remaining 1）
    const mate = buffed.find((u) => u.general.id !== HERO_ID);
    expect(mate, '至少 1 名非施法者友军应吃到增益').toBeTruthy();
    expect(statusOf(mate!, 'defense_buff')!.remaining).toBe(1);

    const miss = setup(6);
    miss.ctx.skills.set(SKILL_ID, withChance(0));
    actUnit(miss.ctx, miss.chengPu);
    expect(miss.ctx.myTeam.some((u) => statusOf(u, 'defense_buff'))).toBe(false);
  });

  it('机制·大营兵力首发跌破 90%/70%/50%：程普得援护 + 下 2 次受伤大幅降低（−9999%），同次跨档只结算 1 次', () => {
    const { ctx, chengPu, back } = setup(8);

    // 30000 → 24000（80%）：只跨 90% 一档
    applyDamage(ctx, back, 6000, undefined, 'physical', 'skill');
    expect(statusOf(chengPu, 'cover')?.remaining).toBe(1);
    const reduce = statusOf(chengPu, 'damage_boost');
    expect(reduce?.direction).toBe('taken');
    expect(reduce?.rate).toBeCloseTo(-99.99, 6);
    expect(reduce?.charges).toBe(2);
    expect(thresholdEvents(ctx)).toHaveLength(1);

    // 24000 → 12000（40%）：一次结算同时跨 70%/50% 两档 → 仍只结算 1 次（同源次数型不重复施加）
    applyDamage(ctx, back, 12000, undefined, 'physical', 'skill');
    expect(thresholdEvents(ctx)).toHaveLength(2);
    expect(chengPu.statuses.filter((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)).toHaveLength(1);

    // 三档已全部触发 → 继续掉兵不再结算
    applyDamage(ctx, back, 2000, undefined, 'physical', 'skill');
    expect(thresholdEvents(ctx)).toHaveLength(2);
  });

  it('机制·下 2 次受到伤害大幅降低：前两次被压到下限（troopBase 之外 ×10%），第三次恢复正常', () => {
    const base = chengPuHits(false, 3);
    const debuffed = chengPuHits(true, 3);
    expect(base.damages.every((d) => d > 0)).toBe(true);
    // calcDamage 的 troopBase（兵力基础）不乘 mult → buffed = troopBase + (基线 − troopBase) × 0.1（±1 取整）
    for (const i of [0, 1]) {
      const expected = Math.round(debuffed.troopBases[i] + (base.damages[i] - debuffed.troopBases[i]) * 0.1);
      expect(Math.abs(debuffed.damages[i] - expected)).toBeLessThanOrEqual(1);
    }
    // charges 2 → 两次后耗尽，第三次不再减伤（与基线完全一致）
    expect(debuffed.chengPu.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)).toBe(false);
    expect(debuffed.damages[2]).toBe(base.damages[2]);
  });

  it('整场跑通（runBattle·8 回合）：防御增益/援护出现，battle_end 齐全', () => {
    const chengPu: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '中军' };
    const report = runBattle({
      seed: 313,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), chengPu, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const statuses = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(statuses.some((e) => e.statusType === 'defense_buff')).toBe(true);
    // 大营被打到阈值 → 援护（cover）出现
    expect(statuses.some((e) => e.statusType === 'cover')).toBe(true);
  });
});
