/**
 * 兵行巧变（张郃·群骑 h593 主战法）：主动 A（1 回合准备），距离 4，发动率 40%。
 * 满级（官方原文为**两版拼接** → 策略 A ②取**前半 v1**）：
 *   1 回合准备，对敌军群体 2 目标发动一次攻击（伤害率 260.0%），使其攻击、防御、谋略属性下降 40.0
 *   （受攻击属性影响），同时我军群体攻击、防御、谋略属性提升 40.0，持续 2 回合；
 *   或对敌军全体 3 目标发动一次攻击（伤害率 200.0%），并使其攻击、防御、谋略属性下降 80.0
 *   （受攻击属性影响），持续 2 回合。
 * 1 级：攻击 130.0% / 属性 −20 与 +20；分支 B 攻击 100.0% / 属性 −40。
 * 官方：scripts/skill_extra.json id 200849（主动 / 距离 4 / 敌军群体（有效距离内 2-3 个目标）/ 兵种骑；
 *   effect 标签 攻击伤害;攻击属性降低;防御属性降低;谋略属性降低;攻击属性提高;防御属性提高;谋略属性提高）。
 *   来源 https://stzb.163.com/m/skilllist/200849.html
 * 口径（策略 A，照仓库既有先例；推定处见 skills.ts 注释）：
 *   ① 两版拼接取**前半 v1**（v2 缺「我军群体属性提升」句、结尾写 3 回合——不采用）；
 *   ② 分支 A / B 之间的「或」= **50/50 随机**（复用 `random_pick` count:1 + 两组 options）——**推定**；
 *   ③ 属性下降段「受攻击属性影响」官方未给成长率 → 基值不缩放 → 登记 OFFLINE_MAIN_SKILLS（武将下架）；
 *   ④ 「我军群体」属性提升 = 我军全体（`targetSide:'ally'` + `targetMode:'all'`，含施术者自身）；
 *   ⑤ 减益段 `sameTargetsAsLastDamage`（打在攻击段同一批命中目标上）；⑥ 持续 2 回合 = `duration: 2`。
 * 兵力口径：`heroUnit()` 走 `level40()` → 兵力 9000（非 dummy 30000）。
 * 分支确定性：`executeSkillOutputs` 未导出，故在 `ctx.skills` 里塞克隆并把 `random_pick.options`
 *   只留一支（另把 `triggerRate` 改 1 求确定），再走「进入准备 → 下一回合释放」主动链路。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'bingxing_qiaobian';
const HERO_ID = 'h593';

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

function heroUnit(heroId: string, position: Position, skills: Parameters<typeof withSkills>[1]): UnitState {
  // level40 → 兵力 9000
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position });
}

function eventsOf<T extends BattleEvent['type']>(ctx: CombatContext, type: T) {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

/** 敌军三件套（前锋 / 中军 / 大营），每次新建避免跨用例状态污染 */
function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy', 30000),
    makeUnit(dummy('foe-mid', '中军'), 'enemy', 30000),
    makeUnit(dummy('foe-back', '大营'), 'enemy', 30000),
  ];
}

/** 克隆注册表定义：triggerRate 改 1 求确定，并把 random_pick 只留一个分支 */
function singleBranch(branch: 0 | 1): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'active') throw new Error('兵行巧变应为主动战法');
  s.triggerRate = 1;
  const seg = s.output[0];
  if (!seg || seg.kind !== 'random_pick') throw new Error('兵行巧变首段应为 random_pick');
  seg.options = [seg.options[branch]!];
  return s;
}

/**
 * 克隆「单分支 + 自定义伤害率」：结构与 singleBranch 完全一致（RNG 消耗不变），
 * 故同种子下命中目标相同、`breakdown.main` 与伤害率严格成正比 → 可反推 260% / 200%。
 */
function branchWithRate(branch: 0 | 1, rate: number): Skill {
  const s = singleBranch(branch);
  const seg = s.output[0];
  if (!seg || seg.kind !== 'random_pick') throw new Error('兵行巧变首段应为 random_pick');
  const first = seg.options[0]![0];
  if (!first || first.kind !== 'physical_damage') throw new Error('兵行巧变分支首段应为 physical_damage');
  first.rate = rate;
  return s;
}

/** 保留两支 options（triggerRate 改 1），用于 50/50 分支统计 */
function bothBranches(): Skill {
  const s = structuredClone(SKILL_REGISTRY[SKILL_ID]) as Skill;
  if (s.type !== 'active') throw new Error('兵行巧变应为主动战法');
  s.triggerRate = 1;
  return s;
}

/**
 * 「1 回合准备」释放链路：第 1 次 actUnit 进准备，第 2 回合 actUnit 释放。
 * `skill` 由调用方克隆（triggerRate 1 / options 单分支）；`allyCount` 控制我军人数（1 或 3）。
 */
function castRun(
  skill: Skill,
  cfg: { seed: number; enemies: UnitState[]; allyCount?: number }
): { ctx: CombatContext; me: UnitState; allies: UnitState[] } {
  const me = heroUnit(HERO_ID, '前锋', { activeSkillIds: [SKILL_ID] });
  const allies: UnitState[] = [me];
  const extraPositions: Position[] = ['中军', '大营'];
  for (let i = 0; i < (cfg.allyCount ?? 1) - 1; i++) {
    allies.push(makeUnit(dummy(`ally-${i + 1}`, extraPositions[i] ?? '大营'), 'my', 9000));
  }
  const ctx = makeCtx(allies, cfg.enemies, cfg.seed);
  ctx.skills.set(SKILL_ID, skill);
  ctx.currentRound = 1;
  actUnit(ctx, me); // 进入准备（prepare_start）
  ctx.currentRound = 2;
  actUnit(ctx, me); // prepare_end + 释放
  return { ctx, me, allies };
}

/** 本战法伤害事件 */
function skillDamage(ctx: CombatContext) {
  return eventsOf(ctx, 'damage').filter((e) => e.skillId === SKILL_ID);
}

/** 某单位身上某属性状态的 amount（找不到返回 undefined） */
function buffAmount(u: UnitState, type: 'attack_buff' | 'defense_buff' | 'strategy_buff'): number | undefined {
  const st = u.statuses.find((s) => s.type === type);
  return st && 'amount' in st ? st.amount : undefined;
}

describe('兵行巧变（张郃 h593）', () => {
  it('装配：主动·1 回合准备·距离 4·40%·random_pick 两支分支·h593 主动槽·下架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('张郃');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('cavalry');
    expect(hero.mainSkillName).toBe('兵行巧变');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    // 主战法已自动挂入主动槽（mainSkillSlot 依战法类型）
    expect(hero.activeSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(true);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.4);
    expect(s.tags).toEqual([
      'damage',
      'debuff_attack',
      'debuff_defense',
      'debuff_strategy',
      'attack_buff',
      'defense_buff',
      'strategy_buff',
    ]);

    expect(s.output).toHaveLength(1);
    const seg = s.output[0];
    expect(seg?.kind).toBe('random_pick');
    if (!seg || seg.kind !== 'random_pick') return;
    expect(seg.count).toBe(1); // 「或」= 50/50 随机二选一（推定）
    expect(seg.options).toHaveLength(2);

    // 分支 A：敌军群体 2 目标 260% + 同批目标三属性 −40（受攻击、基值）+ 我军全体三属性 +40
    const a = seg.options[0]!;
    expect(a).toHaveLength(3);
    expect(a[0]).toEqual({ kind: 'physical_damage', rate: 260, targetMode: 'group', groupCount: 2 });
    expect(a[1]).toEqual({
      kind: 'inflict_status',
      targetSide: 'enemy',
      sameTargetsAsLastDamage: true,
      applyAll: true,
      status: [
        { type: 'attack_buff', amount: -40, duration: 2, attackScaled: true },
        { type: 'defense_buff', amount: -40, duration: 2, attackScaled: true },
        { type: 'strategy_buff', amount: -40, duration: 2, attackScaled: true },
      ],
    });
    expect(a[2]).toEqual({
      kind: 'inflict_status',
      targetSide: 'ally',
      targetMode: 'all',
      applyAll: true,
      status: [
        { type: 'attack_buff', amount: 40, duration: 2 },
        { type: 'defense_buff', amount: 40, duration: 2 },
        { type: 'strategy_buff', amount: 40, duration: 2 },
      ],
    });

    // 分支 B：敌军全体 3 目标 200% + 三属性 −80（无我军增益段）
    const b = seg.options[1]!;
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({ kind: 'physical_damage', rate: 200, targetMode: 'all' });
    expect(b[1]).toEqual({
      kind: 'inflict_status',
      targetSide: 'enemy',
      sameTargetsAsLastDamage: true,
      applyAll: true,
      status: [
        { type: 'attack_buff', amount: -80, duration: 2, attackScaled: true },
        { type: 'defense_buff', amount: -80, duration: 2, attackScaled: true },
        { type: 'strategy_buff', amount: -80, duration: 2, attackScaled: true },
      ],
    });

    // 属性下降段「受攻击属性影响」但官方未给成长率（取基值）→ 下架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeTruthy();
    expect(isHeroListed(HERO_RECORDS[HERO_ID]!)).toBe(false);
  });

  it('机制·分支 A：释放 → 2 条 damage 260%（敌军群体 2 目标）+ 命中目标三属性 −40（duration 2）+ 我军全体 3 人三属性 +40', () => {
    const foes = enemyTrio();
    const { ctx, me, allies } = castRun(singleBranch(0), { seed: 11, enemies: foes, allyCount: 3 });

    // 准备链路 + 释放一次
    const casts = eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID);
    expect(casts).toHaveLength(1);
    expect(casts[0]?.unitId).toBe(HERO_ID);

    // ① 攻击段：敌军群体 2 目标 → 每个命中目标 1 条物理伤害
    const dmg = skillDamage(ctx);
    expect(dmg).toHaveLength(2);
    expect(dmg.every((d) => d.sourceId === HERO_ID && d.damageType === 'physical')).toBe(true);
    const hitIds = dmg.map((d) => d.targetId);
    expect(new Set(hitIds).size).toBe(2); // 两个不同目标
    // 三个 dummy 敌军防御相同 → 两条 main 相等；且 260% = 同种子 100% 基线的 2.6 倍
    expect(dmg[0]!.breakdown.main).toBe(dmg[1]!.breakdown.main);
    const base = castRun(branchWithRate(0, 100), { seed: 11, enemies: enemyTrio(), allyCount: 3 });
    const baseDmg = skillDamage(base.ctx);
    expect(baseDmg).toHaveLength(2);
    expect(dmg[0]!.breakdown.main / baseDmg[0]!.breakdown.main).toBeCloseTo(2.6, 2);

    // ② 减益段：sameTargetsAsLastDamage → 恰好打在两个命中目标上，三属性 −40、duration 2
    const hits = foes.filter((f) => hitIds.includes(f.general.id));
    expect(hits).toHaveLength(2);
    for (const f of hits) {
      for (const t of ['attack_buff', 'defense_buff', 'strategy_buff'] as const) {
        expect(buffAmount(f, t)).toBe(-40); // attackScaled 但无 growthRate → 基值不缩放
      }
      const st = f.statuses.find((s) => s.type === 'attack_buff');
      expect(st && 'remaining' in st ? st.remaining : undefined).toBe(2);
      expect(st?.sourceSkillId).toBe(SKILL_ID);
      expect(st?.sourceSkillType).toBe('active');
    }
    const untouched = foes.filter((f) => !hitIds.includes(f.general.id));
    expect(untouched).toHaveLength(1);
    expect(untouched[0]!.statuses).toHaveLength(0); // 未命中者不吃减益

    // ③ 我军全体（3 人，含施术者自身）三属性 +40
    expect(allies).toHaveLength(3);
    for (const a of allies) {
      for (const t of ['attack_buff', 'defense_buff', 'strategy_buff'] as const) {
        expect(buffAmount(a, t)).toBe(40); // 未标受属性影响 → 固定值
      }
    }
    // 未行动的两名友军 remaining = 2；施术者自身本次行动之内施加，行动结束按「第 2 组补递减」→ 1
    for (const a of allies.slice(1)) {
      const st = a.statuses.find((s) => s.type === 'attack_buff');
      expect(st && 'remaining' in st ? st.remaining : undefined).toBe(2);
    }
    const selfSt = me.statuses.find((s) => s.type === 'attack_buff');
    expect(selfSt && 'remaining' in selfSt ? selfSt.remaining : undefined).toBe(1);
  });

  it('机制·分支 B：释放 → 3 条 damage 200%（敌军全体 3 目标）+ 三属性 −80；无我军增益段', () => {
    const foes = enemyTrio();
    const { ctx, allies } = castRun(singleBranch(1), { seed: 13, enemies: foes, allyCount: 3 });

    const casts = eventsOf(ctx, 'skill_cast').filter((e) => e.skillId === SKILL_ID);
    expect(casts).toHaveLength(1);

    // ① 攻击段：敌军全体 3 目标 → 3 条物理伤害
    const dmg = skillDamage(ctx);
    expect(dmg).toHaveLength(3);
    expect(new Set(dmg.map((d) => d.targetId)).size).toBe(3);
    expect(dmg.every((d) => d.sourceId === HERO_ID && d.damageType === 'physical')).toBe(true);
    expect(dmg.every((d) => d.breakdown.main === dmg[0]!.breakdown.main)).toBe(true);
    // 200% = 同种子 100% 基线的 2.0 倍
    const base = castRun(branchWithRate(1, 100), { seed: 13, enemies: enemyTrio(), allyCount: 3 });
    const baseDmg = skillDamage(base.ctx);
    expect(baseDmg).toHaveLength(3);
    expect(dmg[0]!.breakdown.main / baseDmg[0]!.breakdown.main).toBeCloseTo(2.0, 2);

    // ② 减益段：全部 3 个敌军三属性 −80、duration 2
    for (const f of foes) {
      for (const t of ['attack_buff', 'defense_buff', 'strategy_buff'] as const) {
        expect(buffAmount(f, t)).toBe(-80);
      }
      const st = f.statuses.find((s) => s.type === 'strategy_buff');
      expect(st && 'remaining' in st ? st.remaining : undefined).toBe(2);
    }

    // ③ 分支 B 无「我军群体属性提升」段
    for (const a of allies) expect(a.statuses).toHaveLength(0);
  });

  it('机制·「或」= 50/50 随机：多组种子下 260%（2 目标）与 200%（3 目标）两支都出现过', () => {
    let mainA = 0; // 分支 A（2 目标）的 breakdown.main
    let mainB = 0; // 分支 B（3 目标）的 breakdown.main
    const seen = new Set<number>(); // 命中目标数：2 = 分支 A / 3 = 分支 B

    for (let seed = 1; seed <= 60 && !(mainA > 0 && mainB > 0); seed++) {
      const { ctx } = castRun(bothBranches(), { seed, enemies: enemyTrio(), allyCount: 1 });
      const dmg = skillDamage(ctx);
      if (dmg.length === 2) {
        seen.add(2);
        mainA ||= dmg[0]!.breakdown.main;
      } else if (dmg.length === 3) {
        seen.add(3);
        mainB ||= dmg[0]!.breakdown.main;
      }
    }

    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
    // 两支的伤害率 260% / 200% = 1.3（敌军同为 dummy，breakdown.main 与伤害率成正比）
    expect(mainA).toBeGreaterThan(0);
    expect(mainB).toBeGreaterThan(0);
    expect(mainA / mainB).toBeCloseTo(1.3, 2);
  });

  it('整场跑通（runBattle·8 回合）：skill_cast（兵行巧变）/ damage / status_inflicted / battle_end 齐全', () => {
    const zhanghe: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { activeSkillIds: [SKILL_ID] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 5,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), zhanghe],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);

    // 准备战法：释放前必有一次 prepare_start（1 回合准备）
    expect(
      report.events.some((e) => e.type === 'prepare_start' && e.skillId === SKILL_ID)
    ).toBe(true);

    const casts = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast' && e.skillId === SKILL_ID
    );
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((e) => e.unitId === HERO_ID)).toBe(true);

    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.sourceId === HERO_ID && e.damageType === 'physical')).toBe(true);
    // 按 skill_cast 分组：单次发动命中数 = 分支 A 2 人 / 分支 B 3 人
    const perCast: number[] = [];
    let castIdx = -1;
    for (const e of report.events) {
      if (e.type === 'skill_cast' && e.skillId === SKILL_ID) {
        perCast.push(0);
        castIdx += 1;
      } else if (e.type === 'damage' && e.skillId === SKILL_ID && castIdx >= 0) {
        perCast[castIdx] = (perCast[castIdx] ?? 0) + 1;
      }
    }
    expect(perCast).toHaveLength(casts.length);
    expect(perCast.every((n) => n === 2 || n === 3)).toBe(true);

    const inflicted = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' &&
        (e.statusType === 'attack_buff' ||
          e.statusType === 'defense_buff' ||
          e.statusType === 'strategy_buff')
    );
    expect(inflicted.length).toBeGreaterThan(0);
    // 减益段（敌军三属性下降）至少命中过一次
    expect(
      inflicted.some(
        (e) => e.unitId.startsWith('e-') && /降低/.test(e.detail)
      )
    ).toBe(true);
  });
});
