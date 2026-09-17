/**
 * 列营守险（SP姜维主战法）：主动。
 * 使我军全体攻击/防御/速度/谋略属性提高 29.2（受谋略属性影响），持续 2 回合；
 * 同时友军全体受到下 3 次伤害时有 50% 几率进入规避状态，免疫该次伤害；
 * 若自身士气高昂时，规避状态的目标变为我军全体。
 * 官方：主动 A，有效距离 4，发动率 40%，目标「我军群体（有效距离内 3 个目标）」
 * （scripts/skill_extra.json id 200072；挂槽依据 scripts/hero_extra.json「SP姜维 methodName 列营守险」）。
 *
 * 引擎配套（本条战法补了 2 项）：
 *   ① 概率规避 evade_chance：受击消耗 1 次机会并掷率，命中完全免疫该次伤害 —— 并入 consumeEvasion
 *      统一入口（普攻/战法/DoT/反击各结算点自动生效），与层数式 evasion 区分（后者必挡）。
 *   ② morale_branch.by:'caster'：按施法者自身士气整体判定一次（此前只按各目标士气逐目标分支）。
 * 「受谋略属性影响」的四维 29.2 成长率未确认 → 留空（strategyScaled 标记在，但不给 growthRate → 引擎不缩放、用基值）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { actUnit, consumeEvasion, inflictStatus, type CombatContext } from '../src/engine/action';
import { Rng } from '../src/engine/rng';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, morale = 100): General {
  return {
    id,
    name: `木桩${position}`,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 60,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 带列营守险的主将 + 两名木桩友军（主将居中） */
function fullTeam(morale = 100): General[] {
  const leader = withSkills(
    { ...level40(hero('sp_jiangwei')), position: '中军', morale },
    { activeSkillIds: ['lieying_shouxian'] }
  );
  return [dummy('ally-front', '前锋'), leader, dummy('ally-back', '大营')];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

// ─── 确定性直构单元（对照 main_skills_b9.test.ts）───

function makeUnit(
  id: string,
  opts: { position?: Position; morale?: number; activeSkillIds?: string[] } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '蜀',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: opts.position ?? '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: opts.activeSkillIds ?? [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: opts.morale ?? 100,
    },
    side: 'my',
    troops: 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(next: number): CombatContext {
  return {
    rng: {
      next: () => next,
      int: () => 0,
      intInclusive: () => 0,
      chance: (p: number) => next < p,
    } as unknown as Rng,
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

type Inflicted = Extract<BattleEvent, { type: 'status_inflicted' }>;
const ATTRS = ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'];
const inflicted = (ctx: CombatContext, statusType: string): Inflicted[] =>
  ctx.events.filter(
    (e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === statusType
  );

/** 让主将发动一次列营守险（固定 rng < 40% → 必发动） */
function castOnce(next = 0.1, morale = 100): CombatContext {
  const caster = makeUnit('sp', { position: '中军', morale, activeSkillIds: ['lieying_shouxian'] });
  const a1 = makeUnit('a1', { position: '前锋' });
  const a2 = makeUnit('a2', { position: '大营' });
  const e1 = makeUnit('e1', { position: '前锋' });
  e1.side = 'enemy';
  const ctx = makeCtx(next);
  ctx.myTeam = [a1, caster, a2];
  ctx.enemyTeam = [e1];
  actUnit(ctx, caster);
  return ctx;
}

describe('列营守险（SP姜维，主动：我军全体四维 + 概率规避 + 士气分支）', () => {
  it('装配挂槽 + 战法元数据（主动 / 距离 4 / 发动率 40% / 我军群体 3 目标）', () => {
    const g = hero('sp_jiangwei');
    expect(g.name).toBe('SP姜维');
    expect(g.activeSkillIds).toContain('lieying_shouxian');

    const s = SKILL_REGISTRY['lieying_shouxian'];
    expect(s.type).toBe('active');
    expect(s.type === 'active' && s.prepare).toBe(false);
    expect(s.range).toBe(4);
    expect(s.triggerRate).toBe(0.4);
    expect(s.groupCount).toBe(3);
    expect(s.tags).toEqual(expect.arrayContaining(ATTRS.concat(['evasion'])));
  });

  it('发动后我军全体四维提高（按施法者谋略缩放；12 条 = 四维 × 3 人，含施法者自身）', () => {
    const ctx = castOnce();
    const buffs = ctx.events.filter(
      (e): e is Inflicted =>
        e.type === 'status_inflicted' && ATTRS.includes(e.statusType)
    );
    expect(buffs).toHaveLength(12);
    // 引擎按「生效谋略」实时取值（同一次发动内会自我叠加）：
    //   sp 的攻/防/谋三条按谋略 100 算（29.2+0.115×20 = 31.5 → 32）；
    //   其谋略 buff 随即生效（132）→ sp 的速度条与友军那 8 条按 132 算（29.2+0.115×52 = 35.18 → 35）。
    // ⚠️ 是否改为「战法发动瞬间快照施法者谋略」待用户拍板；游戏显示 1 位小数（42.4）口径亦待拍板。
    const details = buffs.map((e) => e.detail);
    expect(details.filter((d) => d.includes('提高了32')).length).toBe(3);
    expect(details.filter((d) => d.includes('提高了35')).length).toBe(9);
    expect([...new Set(buffs.map((e) => e.unitId))].sort()).toEqual(['a1', 'a2', 'sp']);
  });

  it('四维「受谋略属性影响」成长率 0.115/点（用户实测：谋略 195 → +42.4；基值 29.2 @ 谋略 80）', () => {
    const s = SKILL_REGISTRY['lieying_shouxian'];
    const seg = s.output.find((o) => o.kind === 'inflict_status' && Array.isArray(o.status));
    expect(seg).toBeTruthy();
    if (seg && seg.kind === 'inflict_status' && Array.isArray(seg.status)) {
      expect(seg.status).toHaveLength(4);
      for (const st of seg.status) {
        expect('strategyScaled' in st && st.strategyScaled).toBe(true);
        expect('growthRate' in st && st.growthRate).toBe(0.115);
        expect('amount' in st && st.amount).toBe(29.2);
        expect('duration' in st && st.duration).toBe(2);
      }
    }
    // 实测点复算：谋略 195 → 29.2 + 0.115×115 = 42.425 → 游戏显示 42.4（1 位小数）
    expect(Math.round((29.2 + 0.115 * (195 - 80)) * 10) / 10).toBe(42.4);
  });

  it('概率规避挂上：50% 共 3 次机会（evade_chance）', () => {
    const ctx = castOnce();
    const evades = inflicted(ctx, 'evade_chance');
    expect(evades.length).toBeGreaterThan(0);
    expect(evades[0].detail).toContain('概率规避 50%');
    expect(evades[0].detail).toContain('共 3 次');
  });

  it('士气分支（按施法者自身）：高昂 → 我军全体；一般/低落 → 仅友军（不含自身）', () => {
    const high = castOnce(0.1, 120);
    expect(inflicted(high, 'evade_chance').map((e) => e.unitId).sort()).toEqual(['a1', 'a2', 'sp']);

    const low = castOnce(0.1, 100);
    expect(inflicted(low, 'evade_chance').map((e) => e.unitId).sort()).toEqual(['a1', 'a2']);
    // 属性段不受士气影响：仍是全军三人
    expect(
      [...new Set(inflicted(low, 'attack_buff').map((e) => e.unitId))].sort()
    ).toEqual(['a1', 'a2', 'sp']);
  });

  it('概率规避判定：命中完全免疫且消耗机会，用尽即移除（命中率 100% 的确定性口径）', () => {
    const ctx = makeCtx(0.1);
    const u = makeUnit('u1', { position: '前锋' });
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'evade_chance', rate: 1, charges: 3, duration: 2 }, 'active', 'lieying_shouxian', 'sp');

    expect(consumeEvasion(ctx, u, 'e1')).toBe(true);
    expect(consumeEvasion(ctx, u, 'e1')).toBe(true);
    expect(consumeEvasion(ctx, u, 'e1')).toBe(true);
    // 3 次机会用尽 → 状态移除、不再免疫
    expect(consumeEvasion(ctx, u, 'e1')).toBe(false);
    expect(u.statuses.some((s) => s.type === 'evade_chance')).toBe(false);
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked')).toHaveLength(3);
  });

  it('概率规避未命中：不免疫但同样消耗机会；层数式 evasion 优先于概率规避', () => {
    const ctx = makeCtx(0.9); // 0.9 > 0.5 → 未命中
    const u = makeUnit('u2', { position: '前锋' });
    ctx.myTeam = [u];
    inflictStatus(ctx, u, { type: 'evade_chance', rate: 0.5, charges: 3, duration: 2 }, 'active', 'lieying_shouxian', 'sp');

    expect(consumeEvasion(ctx, u, 'e1')).toBe(false);
    expect(consumeEvasion(ctx, u, 'e1')).toBe(false);
    expect(consumeEvasion(ctx, u, 'e1')).toBe(false);
    expect(consumeEvasion(ctx, u, 'e1')).toBe(false); // 机会已耗尽
    expect(ctx.events.filter((e) => e.type === 'evasion_blocked')).toHaveLength(0);

    // 层数式规避（必挡）优先消耗，且不消耗概率机会
    const ctx2 = makeCtx(0.9);
    const v = makeUnit('u3', { position: '前锋' });
    ctx2.myTeam = [v];
    inflictStatus(ctx2, v, { type: 'evasion', stacks: 1 }, 'active', 'jiuxi_huanglong', 'x');
    inflictStatus(ctx2, v, { type: 'evade_chance', rate: 0.5, charges: 3, duration: 2 }, 'active', 'lieying_shouxian', 'sp');
    expect(consumeEvasion(ctx2, v, 'e1')).toBe(true); // 必挡
    const after = v.statuses.find((s) => s.type === 'evade_chance');
    expect(after && 'charges' in after && after.charges).toBe(3); // 概率机会未被消耗
  });

  it('实战回归：整场战斗可发动并挂上四维与规避（真实 runBattle）', () => {
    const report = run(fullTeam(120), 3, 8);
    const ev = report.events.filter(
      (e): e is Inflicted => e.type === 'status_inflicted' && e.statusType === 'evade_chance'
    );
    const buffs = report.events.filter(
      (e): e is Inflicted => e.type === 'status_inflicted' && ATTRS.includes(e.statusType)
    );
    expect(buffs.length).toBeGreaterThan(0);
    expect(ev.length).toBeGreaterThan(0);
  });
});
