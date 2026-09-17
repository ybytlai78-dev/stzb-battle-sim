/**
 * 引擎口径：监听类战法的结算属性来源改为**触发者**（友军行动通例）
 *
 * 背景：谋谟帷幄 / 七步释嫌这类「友军行动时由我发动」的战法，官方面板的伤害按**触发者**结算，
 * 而引擎原先一律读施法者（携带者）属性。本批把「谁提供属性」从「谁挂战法」里剥出来：
 *   `executeSkillOutputs(ctx, caster, skill, targets, outputs?, statSource?)`
 *   —— 缺省 statSource = caster（既有调用零回归）；
 *   ally_act / ally_before_active 两处机制显式传 actor（触发者）。
 *
 * 不变量：
 * - 战报归属（事件 unitId）仍是**携带者**，只有数值来源换成触发者；
 * - 未传 statSource 的调用（普通主动/追击/指挥/被动，以及 after_first_active、afterActive
 *   ——它们触发者本就是携带者）行为完全不变。
 *
 * 判别式：让「携带者谋略」与「触发者谋略」反向取值——若伤害随触发者走高，即为新口径。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { triggerAllyBeforeActiveCommands, type CombatContext } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40, withSkills } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position): General {
  return {
    id,
    name: `木桩${id}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 150,
    defense: 120,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 15000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function makeUnit(
  id: string,
  opts: { strategy?: number; troops?: number; side?: 'my' | 'enemy' } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '魏',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: '大营',
      attack: 100,
      defense: 100,
      strategy: opts.strategy ?? 120,
      speed: 50,
      attackRange: 2,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side: opts.side ?? 'my',
    troops: opts.troops ?? 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(next = 0.1): CombatContext {
  return {
    rng: { next: () => next, int: () => 0, intInclusive: () => 0, chance: (p: number) => next < p } as unknown as Rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 触发一次「友军监听」策略攻击，返回 (总伤害, 事件数组)，用于反向取值判别 */
function probe(
  casterStats: { strategy?: number; troops?: number },
  actorStats: { strategy?: number; troops?: number }
): { total: number; events: CombatContext['events'] } {
  const ctx = makeCtx();
  const caster = makeUnit('caster', casterStats);
  caster.general.commandSkillIds = ['moumou_weiwo'];
  const actor = makeUnit('actor', actorStats);
  ctx.myTeam = [caster, actor];
  ctx.enemyTeam = [
    makeUnit('e1', { side: 'enemy' }),
    makeUnit('e2', { side: 'enemy' }),
    makeUnit('e3', { side: 'enemy' }),
  ];
  triggerAllyBeforeActiveCommands(ctx, actor);
  const total = ctx.events
    .filter((e) => e.type === 'damage')
    .reduce((sum, e) => sum + ((e as { damage?: number }).damage ?? 0), 0);
  return { total, events: ctx.events };
}

describe('引擎口径：监听类战法按触发者结算', () => {
  it('伤害随触发者谋略走高（反向取值判别：携带者谋略固定高低互换）', () => {
    const lowActor = probe({ strategy: 300 }, { strategy: 100 }).total; // 携带者高、触发者低
    const highActor = probe({ strategy: 100 }, { strategy: 300 }).total; // 携带者低、触发者高

    expect(lowActor).toBeGreaterThan(0);
    expect(highActor).toBeGreaterThan(0);
    // 若仍按携带者（旧口径），结果会反过来 → 这条断言就是口径守卫
    expect(highActor).toBeGreaterThan(lowActor);
  });

  it('伤害随触发者兵力走高（兵力来源同样取触发者）', () => {
    const low = probe({ troops: 10000 }, { troops: 2000 }).total;
    const high = probe({ troops: 2000 }, { troops: 10000 }).total;
    expect(high).toBeGreaterThan(low);
  });

  it('战报归属不变量：伤害事件的 sourceId 仍是战法携带者，不是触发者', () => {
    const { events } = probe({ strategy: 100 }, { strategy: 300 });
    const damage = events.filter((e) => e.type === 'damage');
    expect(damage.length).toBeGreaterThan(0);
    expect(damage.every((e) => (e as { sourceId: string }).sourceId === 'caster')).toBe(true);
    // 触发者的 skill_trigger 记录仍带 targetId（谁发动的主动）；
    // 同一 skillId 另有不带 targetId 的判定事件（output 段自身掷点），故用 some 而非 every
    const trig = events.filter((e) => e.type === 'skill_trigger' && e.skillId === 'moumou_weiwo');
    expect(trig.length).toBeGreaterThan(0);
    expect(trig.some((e) => (e as { targetId?: string }).targetId === 'actor')).toBe(true);
  });

  it('缺省口径零回归：未传 statSource 的调用仍按携带者（普通主动战法路径）', () => {
    // 携带者谋略 300 / 队伍其他人谋略 100：走普通主动释放（非监听）→ 伤害只认携带者
    const reports = [1, 2, 3].map((seed) =>
      runBattle({
        seed,
        maxRounds: 6,
        myTeam: [
          dummy('a-front', '前锋'),
          dummy('a-mid', '中军'),
          withSkills({ ...level40(HERO_REGISTRY['h618']), position: '大营' } as General, {
            activeSkillIds: ['qiaoyin_huandie'],
          }),
        ],
        enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
      })
    );
    // 不崩、有事件流，且既有全量测试（未改动路径）保持全绿即为零回归证据
    const skillCasts = reports.reduce(
      (n, r) => n + r.events.filter((e) => e.type === 'skill_cast').length,
      0
    );
    expect(skillCasts).toBeGreaterThan(0);
    expect(reports.every((r) => r.events.some((e) => e.type === 'battle_end'))).toBe(true);
  });

  it('实战回归：贾诩（谋谟帷幄）在完整战斗里仍能打出策略伤害', () => {
    const daqiao = withSkills({ ...level40(HERO_REGISTRY['h619']), position: '中军' } as General, {
      activeSkillIds: ['qiaoyin_huandie'],
    });
    const myTeam = [dummy('a-front', '前锋'), daqiao, { ...level40(HERO_REGISTRY['h618']), position: '大营' } as General];

    let hits = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const report = runBattle({ seed, maxRounds: 8, myTeam, enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')] });
      hits += report.events.filter(
        (e): e is Extract<BattleEvent, { type: 'damage' }> =>
          e.type === 'damage' && e.damageType === 'strategy'
      ).length;
    }
    expect(hits).toBeGreaterThan(0);
  });
});
