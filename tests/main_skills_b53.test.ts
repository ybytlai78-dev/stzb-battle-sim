/**
 * 僭号天子（袁术·群步 h790 主战法）：指挥 S，距离 3，我军全体。
 * 战斗开始后获得玉玺：我军全体受到的所有伤害的 32.0%（受防御属性影响）由玉玺承担；
 * 第二回合起，每回合开始时玉玺对袁术造成其上一回合承担的所有伤害，袁术仅受到来自玉玺伤害的 50%，
 * 该比例每回合上升 10%。
 * 官方：scripts/skill_extra.json id 200262（指挥 S / 距离 3 / 我军全体 / 兵种步；1 级 16%）。
 * 入档：32%「受防御属性影响」官方未给成长系数 → 按基值不缩放 + 登记 OFFLINE_MAIN_SKILLS → 袁术**下架**。
 * 引擎配套：`CommandSkill.sealTransfer` + `ctx.sealLedgers`（applyDamage 内按比例转移）+
 *   `tickRoundStartStatuses` 每回合开始结转 + 独立事件 `seal_settle`（不计入杀伤统计）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { applyDamage, tickRoundStartStatuses, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jianhao_tianzi';

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

function ledgerOf(ctx: CombatContext) {
  return ctx.sealLedgers?.[0];
}

/** 袁术（大营·带主战法，已注册玉玺账本）+ 1 友军（前锋）+ 3 敌军 */
function setup(seed = 1) {
  const yuanshu = heroUnit('h790', '大营', { commandSkillIds: [SKILL_ID] });
  const ally = makeUnit(dummy('ally', '前锋'));
  const foes = [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
  const ctx = makeCtx([yuanshu, ally], foes, seed);
  triggerCommandSkills(ctx, yuanshu);
  return { yuanshu, ally, foes, ctx };
}

describe('僭号天子（袁术 h790）', () => {
  it('装配：注册表定义（玉玺转移 32%）+ h790 挂槽 + 受防御成长未确认 → 下架', () => {
    const hero = HERO_REGISTRY['h790'];
    expect(hero.name).toBe('袁术');
    expect(hero.mainSkillName).toBe('僭号天子');

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('command');
    if (s.type !== 'command') return;
    expect(s.phase).toBe('prep');
    expect(s.range).toBe(3);
    expect(s.targetSide).toBe('ally');
    expect(s.targetMode).toBe('all');
    expect(s.output).toEqual([]); // 本身无直接输出：效果全在玉玺账本 + 回合结转
    expect(s.sealTransfer).toEqual({ rate: 32 });

    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed({ mainSkillId: SKILL_ID })).toBe(false);
  });

  it('转移：我方全体（含袁术自己）受击的 32% 转入玉玺账本，本回合不扣兵', () => {
    const { yuanshu, ally, foes, ctx } = setup();
    expect(ledgerOf(ctx)?.carried).toBe(0);
    const allyStart = ally.troops;
    const yuanshuStart = yuanshu.troops;

    // 友军受击 1000 → 玉玺承担 320，友军只扣 680
    applyDamage(ctx, ally, 1000, foes[0], 'physical', 'skill');
    expect(ledgerOf(ctx)?.carried).toBe(320);
    expect(ally.troops).toBe(allyStart - 680);

    // 袁术自己受击同样转移
    applyDamage(ctx, yuanshu, 1000, foes[0], 'physical', 'skill');
    expect(ledgerOf(ctx)?.carried).toBe(640);
    expect(yuanshu.troops).toBe(yuanshuStart - 680);

    // 玉玺结转自身（sealResolving）不再被玉玺转移
    ctx.sealResolving = true;
    applyDamage(ctx, ally, 1000, foes[0], 'physical', 'skill');
    ctx.sealResolving = false;
    expect(ledgerOf(ctx)?.carried).toBe(640);
    expect(ally.troops).toBe(allyStart - 680 - 1000);

    // 持有者阵亡后不再转移
    yuanshu.alive = false;
    applyDamage(ctx, ally, 1000, foes[0], 'physical', 'skill');
    expect(ledgerOf(ctx)?.carried).toBe(640);
  });

  it('结转：第 1 回合不结算；第 2 回合起每回合开始时按比例对袁术结算并清零账本', () => {
    const { yuanshu, ally, foes, ctx } = setup();
    applyDamage(ctx, ally, 1000, foes[0], 'physical', 'skill'); // 账本 320
    expect(ledgerOf(ctx)?.carried).toBe(320);

    // 第 1 回合：不结算
    tickRoundStartStatuses(ctx);
    expect(ledgerOf(ctx)?.carried).toBe(320);
    expect(eventsOf(ctx, 'seal_settle')).toHaveLength(0);

    // 第 2 回合：承担比例 50% → 320 × 0.5 = 160
    ctx.currentRound = 2;
    const before = yuanshu.troops;
    tickRoundStartStatuses(ctx);
    const settles = eventsOf(ctx, 'seal_settle');
    expect(settles).toHaveLength(1);
    expect(settles[0]).toMatchObject({
      unitId: 'h790',
      skillId: SKILL_ID,
      skillName: '僭号天子',
      carried: 320,
      ratio: 0.5,
      damage: 160,
    });
    expect(settles[0].afterTroops).toBe(yuanshu.troops);
    expect(yuanshu.troops).toBe(before - 160);
    expect(ledgerOf(ctx)?.carried).toBe(0); // 结转后清零
  });

  it('结转比例：50% 起每回合 +10%，第 6 回合起封顶 100%', () => {
    const { yuanshu, ctx } = setup();
    const start = yuanshu.troops;
    const expected = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1]; // 第 2~8 回合
    let lost = 0;
    for (let round = 2; round <= 8; round++) {
      ctx.currentRound = round;
      ledgerOf(ctx)!.carried = 1000;
      tickRoundStartStatuses(ctx);
      const ev = eventsOf(ctx, 'seal_settle').at(-1)!;
      expect(ev.ratio).toBeCloseTo(expected[round - 2], 5);
      expect(ev.damage).toBe(Math.round(1000 * expected[round - 2]));
      lost += ev.damage;
    }
    // 袁术只承担了各回合比例之和（且始终不超过结转量）
    expect(yuanshu.troops).toBe(start - lost);
  });

  it('整场跑通（runBattle）：玉玺开始转移并在第 2 回合起产生结转事件', () => {
    const yuanshu: General = {
      ...withSkills(level40(HERO_REGISTRY['h790']), { commandSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 23,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), yuanshu],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    const settles = report.events.filter((e) => e.type === 'seal_settle');
    expect(settles.length).toBeGreaterThan(0);
    expect(settles[0].skillId).toBe(SKILL_ID);
    expect(settles[0].ratio).toBe(0.5); // 首次结转在第 2 回合
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
  });
});
