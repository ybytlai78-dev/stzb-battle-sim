/**
 * 将出关西（华雄·群骑 h647 主战法）：主动 A（无准备），距离 4，发动率 35%，目标随机敌军单体。
 * 满级：对随机敌军单体发动 2-4 次攻击（伤害率 250.0%），每次伤害率减少 40.0%。首次攻击造成的伤害
 *   无视规避，并使该目标无法恢复兵力，持续 2 回合。1 级：伤害率 125.0%、每次减少 20.0%。
 * 官方：scripts/skill_extra.json id 200927。来源 https://stzb.163.com/m/skilllist/200927.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 两版拼接（2-4 / 2-5）→ 取前半 2-4（repeats:[2,4]）；
 *   ② 目标选一次、2-4 次攻击打同一目标（「该目标」为单数，推定）；
 *   ③ 「每次伤害率减少 40%」= 按初始值线性（250→210→170→130，与银龙孤胆递增同口径，推定）；
 *   ④ 首次攻击无视规避 → 新引擎件 physical_damage.ignoresEvasionFirstRepeat；
 *   ⑤ 无法恢复兵力 → 既有 siege（围困）状态 duration 2，同一目标落点；
 *   ⑥ 无数值缺口 → 上架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, SimpleActiveSkill, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'jiangchu_guanxi';
const HERO_ID = 'h647';

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

function heroUnit(heroId: string, position: Position): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), position });
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

/** 释放一次：发动率临时改 1（跳过 35% 判定，保证确定性）；可选覆盖伤害段（repeats / 规避开关） */
function castOnce(ctx: CombatContext, patch?: Partial<Extract<SkillOutput, { kind: 'physical_damage' }>>): void {
  const def = ctx.skills.get(SKILL_ID) as SimpleActiveSkill;
  const output = def.output.map((seg) =>
    seg.kind === 'physical_damage' && patch ? { ...seg, ...patch } : seg
  );
  ctx.skills.set(SKILL_ID, { ...def, triggerRate: 1, output } as SimpleActiveSkill);
  ctx.currentRound = 1;
  actUnit(ctx, ctx.myTeam[0]);
}

const hitsOf = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID);

describe('将出关西（华雄 h647）', () => {
  it('装配：主动·无准备·距离 4·35%·repeats[2,4] 递减 40/首次无视规避 + 围困 2 回合·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('华雄');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('将出关西');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.35);
    expect(s.targetMode).toBe('random_single');
    expect(s.tags).toEqual(['damage', 'siege']);
    expect(s.output).toEqual([
      { kind: 'physical_damage', rate: 250, repeats: [2, 4], ratePerRepeat: -40, ignoresEvasionFirstRepeat: true },
      { kind: 'inflict_status', sameTargetsAsLastDamage: true, status: { type: 'siege', duration: 2 } },
    ]);

    // 无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·2-4 次攻击同一目标且每次伤害率递减 250→210→170→130（main 线性）', () => {
    const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), 6);
    castOnce(ctx, { repeats: 4 });
    const hits = hitsOf(ctx);
    expect(hits).toHaveLength(4);
    expect(new Set(hits.map((h) => h.targetId)).size).toBe(1); // 目标选一次、同一目标吃满 4 次
    const mains = hits.map((h) => h.breakdown.main);
    // 无控制/规避干扰：main 只随伤害率线性 → 严格递减
    for (let i = 1; i < mains.length; i++) expect(mains[i]).toBeLessThan(mains[i - 1]);
    // 递减幅度与伤害率一致：main_i / main_0 ≈ (250 − 40i) / 250
    expect(Math.abs(mains[1] - mains[0] * (210 / 250))).toBeLessThanOrEqual(1);
    expect(Math.abs(mains[3] - mains[0] * (130 / 250))).toBeLessThanOrEqual(1);
  });

  it('机制·首次攻击无视规避（第 2 次起照常判定）：同种子对照首个命中伤害率仍是 250%', () => {
    /** 同种子跑一次：target 是否带 1 层「必挡」规避（层数式 evasion） */
    const firstHitMain = (withEvasion: boolean, firstIgnores: boolean) => {
      const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), 8);
      castOnce(ctx, { repeats: 3, ignoresEvasionFirstRepeat: firstIgnores });
      const target = ctx.enemyTeam.find((e) => e.general.id === hitsOf(ctx)[0]?.targetId) ?? ctx.enemyTeam[0];
      return { main: hitsOf(ctx)[0]?.breakdown.main ?? 0, target };
    };
    // 无规避基线：第 1 次命中 = 250%
    const baseline = firstHitMain(false, true).main;
    expect(baseline).toBeGreaterThan(0);

    // 有 1 层必挡规避 + 首次无视：第 1 次仍打满 250%（照常消耗发生在第 2 次）
    const withFlag = (() => {
      const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), 8);
      const def = ctx.skills.get(SKILL_ID) as SimpleActiveSkill;
      ctx.skills.set(SKILL_ID, {
        ...def,
        triggerRate: 1,
        output: def.output.map((seg) =>
          seg.kind === 'physical_damage' ? { ...seg, repeats: 3, ignoresEvasionFirstRepeat: true } : seg
        ),
      } as SimpleActiveSkill);
      // 施法前给「首个随机目标」加规避无法预知 → 给全部敌军加 1 层（层数式必挡）
      for (const foe of ctx.enemyTeam) {
        inflictStatus(ctx, foe, { type: 'evasion', stacks: 1, duration: 999 } as never, 'active', 'mock_evasion');
      }
      ctx.currentRound = 1;
      actUnit(ctx, ctx.myTeam[0]);
      return hitsOf(ctx)[0]?.breakdown.main ?? 0;
    })();
    expect(Math.abs(withFlag - baseline)).toBeLessThanOrEqual(1);

    // 关闭「首次无视」（对照组）：第 1 次被规避挡下 → 首个命中是第 2 次（210%）
    const withoutFlag = (() => {
      const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), 8);
      const def = ctx.skills.get(SKILL_ID) as SimpleActiveSkill;
      ctx.skills.set(SKILL_ID, {
        ...def,
        triggerRate: 1,
        output: def.output.map((seg) =>
          seg.kind === 'physical_damage' ? { ...seg, repeats: 3, ignoresEvasionFirstRepeat: false } : seg
        ),
      } as SimpleActiveSkill);
      for (const foe of ctx.enemyTeam) {
        inflictStatus(ctx, foe, { type: 'evasion', stacks: 1, duration: 999 } as never, 'active', 'mock_evasion');
      }
      ctx.currentRound = 1;
      actUnit(ctx, ctx.myTeam[0]);
      return hitsOf(ctx)[0]?.breakdown.main ?? 0;
    })();
    expect(Math.abs(withoutFlag - baseline * (210 / 250))).toBeLessThanOrEqual(2);
  });

  it('机制·围困：命中目标被挂 siege（2 回合），期间无法恢复兵力（recoverTroops → 0 + siege_blocked）', () => {
    const ctx = makeCtx([heroUnit(HERO_ID, '前锋')], enemyTrio(), 10);
    castOnce(ctx);
    const hits = hitsOf(ctx);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const target = ctx.enemyTeam.find((e) => e.general.id === hits[0].targetId)!;
    const siege = target.statuses.find((s) => s.type === 'siege' && s.sourceSkillId === SKILL_ID);
    expect(siege).toBeTruthy();
    if (siege?.type !== 'siege') throw new Error('期望 siege');
    expect(siege.remaining).toBe(2);

    // 围困期间「每回合恢复」被拦截（青囊秘要 recoverEachRound 走同一 siege 拦截）
    target.general.passiveSkillIds = ['qingnang_miyao'];
    target.troops = 5000;
    ctx.currentRound = 2;
    const before = ctx.events.length;
    actUnit(ctx, target);
    expect(target.troops).toBe(5000);
    expect(
      ctx.events.slice(before).some((e) => e.type === 'siege_blocked' && e.unitId === target.general.id)
    ).toBe(true);
  });

  it('整场跑通（runBattle·8 回合）：将出关西伤害/围困与 battle_end 齐全', () => {
    const huaxiong: General = { ...withSkills(level40(HERO_REGISTRY[HERO_ID]), {}), position: '前锋' };
    const report = runBattle({
      seed: 44,
      maxRounds: 8,
      myTeam: [huaxiong, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const hits = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> => e.type === 'status_inflicted'
    );
    expect(inflicted.some((e) => e.statusType === 'siege')).toBe(true);
  });
});
