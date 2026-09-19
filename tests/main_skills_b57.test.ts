/**
 * 举抑臧否（许劭·汉弓 h770 主战法）：指挥 A，距离 5，官方目标「敌友单体」。
 * 每回合自身行动时随机选取攻击、防御、谋略三种属性之一：使该属性最低的敌军单体对应属性降低 20.0
 * （受谋略属性影响），并有 60.0% 几率获得犹豫、怯战、围困中的 1 种效果，持续 1 回合；
 * 使该属性最高的友军单体对应属性提升 20.0（受谋略属性影响），并有 60.0% 几率获得先手、洞察、
 * 无视规避中的 1 种效果，持续 1 回合。
 * 官方：scripts/skill_extra.json id 200242（指挥 A / 距离 5 / 敌友单体 / 兵种弓；1 级 属性 10 / 30%）。
 * 入档：属性 ±20「受谋略属性影响」而官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 许劭**下架**。
 * 引擎配套：随机属性选取复用 `random_pick`；`inflict_status.targetPick` 扩展
 *   `highest_{attack|defense|strategy}_ally` / `lowest_{attack|defense|strategy}_enemy`。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  effectiveStat,
  triggerRoundCommandOnAct,
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

const SKILL_ID = 'juyizangfou';
type Stat = 'attack' | 'defense' | 'strategy';
const STATS: Stat[] = ['attack', 'defense', 'strategy'];
const ENEMY_CONTROLS = ['hesitation', 'cowardice', 'siege'];
const ALLY_BUFFS = ['priority', 'insight', 'ignore_evasion'];

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

/**
 * 把随机属性固定为指定属性，并把两处 60% 几率覆盖为 chance（只考察机制语义、不掺 RNG）。
 * 必须在 triggerRoundCommandOnAct 之前替换（on_act 每次从 ctx.skills 解析）。
 */
function forceAttr(ctx: CombatContext, attr: Stat, chance = 1): void {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'command') return;
  const out = s.output[0];
  if (out.kind !== 'random_pick') return;
  out.options = out.options.filter((_, i) => STATS[i] === attr);
  for (const seg of out.options[0]) {
    // 只覆盖「本来就是 60% 判定」的段（属性段没有 chance，误加会把属性也判掉）
    if (seg.kind === 'inflict_status' && 'chance' in seg) seg.chance = chance;
  }
  ctx.skills.set(SKILL_ID, s);
}

/** 许劭（大营）+ 1 友军（前锋，攻击最高）+ 2 敌军（foe-1 全属性最低） */
function setup(seed = 1) {
  const xushao = heroUnit('h770', '大营', { commandSkillIds: [SKILL_ID] });
  const ally = makeUnit(
    dummy('ally', '前锋', { attack: 300, defense: 50, strategy: 40 }),
  );
  const foes = [
    makeUnit(dummy('foe-low', '前锋', { attack: 40, defense: 40, strategy: 40 }), 'enemy'),
    makeUnit(dummy('foe-mid', '中军', { attack: 60, defense: 60, strategy: 60 }), 'enemy'),
  ];
  const ctx = makeCtx([xushao, ally], foes, seed);
  return { xushao, ally, foes, ctx, allies: [xushao, ally] };
}

/** 属性状态对应关系 */
const STAT_STATUS: Record<Stat, string> = {
  attack: 'attack_buff',
  defense: 'defense_buff',
  strategy: 'strategy_buff',
};

describe('举抑臧否（许劭 h770）', () => {
  it('装配：注册表定义（每回合行动时 + 随机三选一）+ h770 挂槽 + 受谋略成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h770'];
    expect(hero.name).toBe('许劭');
    expect(hero.mainSkillName).toBe('举抑臧否');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('round');
    expect(s.roundTrigger).toBe('on_act');
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('self');
    const out = s.output[0];
    expect(out.kind).toBe('random_pick');
    if (out.kind !== 'random_pick') return;
    expect(out.count).toBe(1);
    expect(out.options).toHaveLength(3); // 攻击 / 防御 / 谋略三组
    // 每组 4 段：敌最低 −20、敌最低 60% 控制、友最高 +20、友最高 60% 增益
    for (const [i, option] of out.options.entries()) {
      const stat = STATS[i];
      expect(option).toHaveLength(4);
      expect(option[0]).toMatchObject({
        kind: 'inflict_status',
        targetPick: `lowest_${stat}_enemy`,
        status: { type: STAT_STATUS[stat], amount: -20, strategyScaled: true, growthRate: 0 },
      });
      expect(option[1]).toMatchObject({ kind: 'inflict_status', targetPick: `lowest_${stat}_enemy`, chance: 0.6 });
      expect(option[2]).toMatchObject({
        kind: 'inflict_status',
        targetPick: `highest_${stat}_ally`,
        status: { type: STAT_STATUS[stat], amount: 20, strategyScaled: true, growthRate: 0 },
      });
      expect(option[3]).toMatchObject({ kind: 'inflict_status', targetPick: `highest_${stat}_ally`, chance: 0.6 });
    }

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('目标选取：敌最低得 −20、友最高得 +20（逐属性断言，含施法者自身参选）', () => {
    for (const attr of STATS) {
      const { xushao, ally, foes, ctx, allies } = setup();
      forceAttr(ctx, attr);
      triggerRoundCommandOnAct(ctx, xushao);

      const statusType = STAT_STATUS[attr];
      const debuffed = foes.filter((f) => f.statuses.some((s) => s.type === statusType));
      const buffed = allies.filter((u) => u.statuses.some((s) => s.type === statusType));
      // 敌军 · 该属性最低单体（foe-low 全属性最低）
      expect(debuffed.map((f) => f.general.id)).toEqual(['foe-low']);
      // 友军 · 该属性最高单体（以生效属性为准，含许劭自身）
      const expected = [...allies].sort((a, b) => effectiveStat(b, attr) - effectiveStat(a, attr))[0];
      expect(buffed.map((u) => u.general.id)).toEqual([expected.general.id]);

      const debuff = debuffed[0].statuses.find((s) => s.type === statusType);
      const buff = buffed[0].statuses.find((s) => s.type === statusType);
      expect(debuff && 'amount' in debuff ? debuff.amount : 0).toBe(-20);
      expect(buff && 'amount' in buff ? buff.amount : 0).toBe(20);
    }
  });

  it('随机属性选取：跨 seed 出现多种属性；每次只结算一个属性组', () => {
    const seen = new Set<Stat>();
    for (let seed = 1; seed <= 12; seed++) {
      const { xushao, foes, ctx, allies } = setup(seed);
      triggerRoundCommandOnAct(ctx, xushao);
      const kinds = new Set<string>();
      for (const u of [...allies, ...foes]) {
        for (const s of u.statuses) {
          if (s.type === 'attack_buff' || s.type === 'defense_buff' || s.type === 'strategy_buff') kinds.add(s.type);
        }
      }
      expect(kinds.size).toBe(1); // 只随机到一个属性组
      const [only] = [...kinds];
      seen.add(STATS.find((st) => STAT_STATUS[st] === only)!);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('60% 控制 / 增益：命中时敌军获得犹豫/怯战/围困之一、友军获得先手/洞察/无视规避之一', () => {
    const { xushao, foes, ctx, allies } = setup(3);
    forceAttr(ctx, 'strategy', 1); // 几率拉满
    triggerRoundCommandOnAct(ctx, xushao);

    const enemyControls = foes[0].statuses.filter((s) => ENEMY_CONTROLS.includes(s.type));
    expect(enemyControls).toHaveLength(1);
    // 该属性最高的友军（含施法者自身）获得先手/洞察/无视规避之一
    const expectedAlly = [...allies].sort((a, b) => effectiveStat(b, 'strategy') - effectiveStat(a, 'strategy'))[0];
    const allyBuffs = expectedAlly.statuses.filter((s) => ALLY_BUFFS.includes(s.type));
    expect(allyBuffs).toHaveLength(1);
    expect(ALLY_BUFFS).toContain(allyBuffs[0].type); // 先手 / 洞察 / 无视规避 三选一
    expect(ENEMY_CONTROLS).toContain(enemyControls[0].type); // 犹豫 / 怯战 / 围困 三选一
  });

  it('60% 未命中：只有属性段落地，无控制/增益', () => {
    const { xushao, foes, ctx, allies } = setup(5);
    forceAttr(ctx, 'attack', 0); // 几率置零
    triggerRoundCommandOnAct(ctx, xushao);

    expect(foes[0].statuses.some((s) => s.type === 'attack_buff')).toBe(true); // 攻击最低敌军 −20
    expect(foes[0].statuses.filter((s) => ENEMY_CONTROLS.includes(s.type))).toHaveLength(0);
    for (const u of allies) expect(u.statuses.filter((s) => ALLY_BUFFS.includes(s.type))).toHaveLength(0);
  });

  it('整场跑通（runBattle）：许劭每回合行动均产生属性升降，战报事件正常', () => {
    const xushao: General = {
      ...withSkills(level40(HERO_REGISTRY['h770']), { commandSkillIds: [SKILL_ID] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 37,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), xushao, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const statEvents = report.events.filter(
      (e) =>
        e.type === 'status_inflicted' &&
        (e.statusType === 'attack_buff' || e.statusType === 'defense_buff' || e.statusType === 'strategy_buff'),
    );
    expect(statEvents.length).toBeGreaterThan(0);
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillId === SKILL_ID)).toBe(true);
  });
});
