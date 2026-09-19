/**
 * 赐剑长驱（刘禅·蜀步 h689 主战法）：指挥 A，距离 3，官方目标「友军全体」。
 * 战斗中自身无法释放主动战法或进行普通攻击，令友军全体每回合首次成功释放主动战法后，
 * 有 40.0% 几率（受谋略属性影响）再次发动（跳过所有准备回合），造成原战法 50.0% 的伤害和恢复效果。
 * 官方：scripts/skill_extra.json id 200962（指挥 A / 距离 3 / 友军全体 / 兵种步；1 级 发动率 20% / 效果 25%）。
 * 入档：再次发动几率 40%「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 刘禅**下架**。
 * 引擎配套：
 *   ① 自身封禁 = 准备阶段对自身施加 犹豫（无法主动）+ 怯战（无法普攻）duration 999（与官方效果标签一致）；
 *   ② `CommandSkill.allyRecast` + `triggerAllyRecastCommands`（友军每回合首次成功主动后按几率再次发动，
 *      跳过准备；伤害/恢复按 factor 缩放，见 scaleDamageHealOutputs）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  getStatus,
  triggerActiveSkill,
  triggerAllyRecastCommands,
  triggerCommandSkills,
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

const SKILL_ID = 'cijian_changqu';

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

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function forcedSkill(id: string, ctx: CombatContext): Skill {
  const s = structuredClone(SKILL_REGISTRY[id]) as Skill;
  s.triggerRate = 1;
  ctx.skills.set(id, s);
  return s;
}

/** 把「再次发动」几率覆盖为指定值（缺省拉满，避免几率 RNG；0 = 必不发动对照） */
function setRecastRate(ctx: CombatContext, rate: number): void {
  const cmd = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (cmd.type === 'command' && cmd.allyRecast) cmd.allyRecast = { ...cmd.allyRecast, rate };
  ctx.skills.set(SKILL_ID, cmd);
}

/** 刘禅（大营·带主战法）+ 1 名友军（前锋，可带主动战法）+ 3 敌军 */
function setup(seed = 1, allySkillIds: string[] = [], recastRate = 100) {
  const liushan = heroUnit('h689', '大营', { commandSkillIds: [SKILL_ID] });
  const ally = makeUnit(dummy('ally', '前锋', { activeSkillIds: allySkillIds }));
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([liushan, ally], foes, seed);
  setRecastRate(ctx, recastRate);
  return { liushan, ally, foes, ctx, allies: [liushan, ally] };
}

describe('赐剑长驱（刘禅 h689）', () => {
  it('装配：注册表定义（自身犹豫/怯战 + 友军再发动）+ h689 挂槽 + 受谋略成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h689'];
    expect(hero.name).toBe('刘禅');
    expect(hero.mainSkillName).toBe('赐剑长驱');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep'); // 战斗开始即封禁自身
    expect(s.range).toBe(3);
    expect(s.targetMode).toBe('self'); // output 只作用于自身（「友军全体」是监听范围）
    expect(s.output).toEqual([
      { kind: 'inflict_status', status: { type: 'hesitation', duration: 999 } },
      { kind: 'inflict_status', status: { type: 'cowardice', duration: 999 } },
    ]);
    expect(s.allyRecast).toEqual({ rate: 40, factor: 0.5 });

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('自身封禁：准备阶段对自身施加 犹豫 + 怯战（整场常驻）', () => {
    const { liushan, ctx } = setup();
    triggerCommandSkills(ctx, liushan);
    const hesitation = getStatus(liushan, 'hesitation');
    const cowardice = getStatus(liushan, 'cowardice');
    expect(hesitation).toBeTruthy();
    expect(cowardice).toBeTruthy();
    expect(hesitation?.remaining).toBe(999);
    expect(cowardice?.remaining).toBe(999);
  });

  it('友军首次主动成功后再次发动：同一战法释放两次，且第二次伤害/恢复为 50%', () => {
    const { liushan, ally, foes, ctx, allies } = setup(3, ['jijiu']);
    for (const u of allies) u.troops = 3000; // 先掉血，恢复可观测
    const jijiu = forcedSkill('jijiu', ctx);

    triggerActiveSkill(ctx, ally, jijiu, foes, allies, [...foes, ...allies]);

    // 触发判定（归属刘禅、目标为发动者）
    const triggers = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].success).toBe(true);
    expect(triggers[0].targetId).toBe(ally.general.id);

    // 同一战法释放两次（本体 + 再次发动），恢复量第二次约为第一次的一半
    expect(eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === 'jijiu')).toHaveLength(2);
    const heals = eventsOf(ctx, 'heal').filter((e) => e.skillId === 'jijiu');
    expect(heals).toHaveLength(2);
    expect(heals[1].amount).toBeGreaterThanOrEqual(Math.floor(heals[0].amount * 0.45));
    expect(heals[1].amount).toBeLessThanOrEqual(Math.ceil(heals[0].amount * 0.55));
  });

  it('每回合每名友军只判定一次：同回合第二次成功主动不再触发再次发动', () => {
    const { ally, foes, ctx, allies } = setup(5, ['jijiu']);
    for (const u of allies) u.troops = 3000;
    const jijiu = forcedSkill('jijiu', ctx);

    triggerActiveSkill(ctx, ally, jijiu, foes, allies, [...foes, ...allies]);
    triggerActiveSkill(ctx, ally, jijiu, foes, allies, [...foes, ...allies]);

    expect(eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === 'jijiu')).toHaveLength(3); // 本体2 + 再次发动1
    expect(eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID)).toHaveLength(1);
  });

  it('再次发动跳过所有准备回合：准备战法被监听直接结算输出，不进入准备', () => {
    const { ally, foes, ctx, allies } = setup(7);
    const prep = structuredClone(SKILL_REGISTRY['xiongbing_podi']) as Skill;

    triggerAllyRecastCommands(ctx, ally, prep);

    // 直接打出伤害（不需要准备回合）
    expect(eventsOf(ctx, 'damage').filter((e) => e.skillId === 'xiongbing_podi').length).toBeGreaterThan(0);
    expect(eventsOf(ctx, 'prepare_start')).toHaveLength(0);
    expect(ally.isPreparing).toBe(false);
    // 属性降低段同样落地（非伤害恢复段不缩放）
    expect(foes.some((f) => f.statuses.some((st) => st.type === 'defense_buff'))).toBe(true);
  });

  it('几率未命中则不再次发动（对照）', () => {
    const { ally, foes, ctx, allies } = setup(9, ['jijiu'], 0);
    for (const u of allies) u.troops = 3000;
    const jijiu = forcedSkill('jijiu', ctx);

    triggerActiveSkill(ctx, ally, jijiu, foes, allies, [...foes, ...allies]);

    const triggers = eventsOf(ctx, 'skill_trigger').filter((e) => e.skillId === SKILL_ID);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].success).toBe(false);
    expect(eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === 'jijiu')).toHaveLength(1);
  });

  it('整场跑通（runBattle）：刘禅整场不发动主动、不普攻；友军正常出手', () => {
    const liushan: General = {
      ...withSkills(level40(HERO_REGISTRY['h689']), {
        commandSkillIds: [SKILL_ID],
        activeSkillIds: ['mizhen'], // 带上会被自身犹豫禁掉的主动战法
      }),
      position: '大营',
    };
    const report = runBattle({
      seed: 11,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋', { activeSkillIds: ['mizhen'] }), dummy('a-mid', '中军'), liushan],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    // 刘禅自身：无任何攻击/伤害事件，也没有主动战法释放（自身犹豫）；只有本战法准备阶段的一次 skill_cast
    expect(report.events.filter((e) => e.type === 'attack_hit' && e.sourceId === 'h689')).toHaveLength(0);
    expect(report.events.filter((e) => e.type === 'damage' && e.sourceId === 'h689')).toHaveLength(0);
    expect(
      report.events.filter((e) => e.type === 'skill_cast' && e.unitId === 'h689' && e.skillId === 'mizhen'),
    ).toHaveLength(0);
    expect(
      report.events.filter((e) => e.type === 'skill_trigger' && e.unitId === 'h689' && e.skillId === 'mizhen'),
    ).toHaveLength(0);
    // 友军正常出手（本队有伤害产出）
    expect(report.events.some((e) => e.type === 'attack_hit' && e.sourceId === 'a-front')).toBe(true);
  });
});
