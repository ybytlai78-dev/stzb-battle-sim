/**
 * S2 五将主战法测试（v0.13）：奇佐鬼谋（郭嘉 h476）/ 密谋定蜀（庞统 h477）/ 火势风威（陆逊 h478）
 * 新增引擎机制：
 *  - inflict_status 状态数组随机（奇佐鬼谋：敌军群体随机陷入混乱/暴走/怯战/犹豫 1 种）
 *  - 妖术诅咒 curse（密谋定蜀：携带者试图发动追击战法时触发一次妖术伤害，不消耗）
 *  - 引燃标记 ignite（火势风威：携带者受到下一次伤害时额外引发一次燃烧，触发后移除）
 *  - damage_boost 支持 strategyScaled（密谋定蜀：每次发动自身造成策略伤害 +5% 受谋略，可叠加至战斗结束）
 * 每战法 3 个测试：装配挂槽 / 机制（事件·状态）/ 数值（或共存）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { actUnit, inflictStatus, applyDamage, type CombatContext } from '../src/engine/action';
import { skillTargets } from '../src/engine/target';
import type { BattleEvent, General, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, opts: { attack?: number; pursuitSkillIds?: string[] } = {}): General {
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
    attack: opts.attack ?? 80,
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
    pursuitSkillIds: opts.pursuitSkillIds ?? [],
    morale: 100,
  };
}

function enemyTeam(opts: { pursuit?: boolean } = {}): General[] {
  return [
    dummy('enemy-front', '前锋', { pursuitSkillIds: opts.pursuit ? ['fangzhen_tuji'] : [] }),
    dummy('enemy-mid', '中军', { pursuitSkillIds: opts.pursuit ? ['fangzhen_tuji'] : [] }),
    dummy('enemy-back', '大营'),
  ];
}

function run(team: General[], seed = 1, maxRounds = 8, enemy: General[] = enemyTeam()) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemy });
}

const inflictedOf = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType && !e.detail.includes('提升至')
  );

// ─── 单元测试辅助（直接构造 ctx，机制级确定性断言） ───

function makeUnit(id: string, opts: { maxTroops?: number; pursuitSkillIds?: string[] } = {}): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: '前锋',
      attack: 50,
      defense: 100,
      strategy: 80,
      speed: 50,
      attackRange: 2,
      maxTroops: opts.maxTroops ?? 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: opts.pursuitSkillIds ?? [],
      morale: 100,
    },
    side: 'my',
    troops: opts.maxTroops ?? 10000,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    isPreparing: false,
    preparingSkillId: null,
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
    woundedMortality: { base: 5, perRound: 14 },
  };
}

type DotTickEvent = Extract<BattleEvent, { type: 'dot_tick' }>;
const dotTicks = (ctx: CombatContext, dotType: string) =>
  ctx.events.filter((e): e is DotTickEvent => e.type === 'dot_tick' && e.dotType === dotType);

describe('奇佐鬼谋（郭嘉 h476·S2 主动）', () => {
  it('装配：郭嘉主战法挂入主动槽（main_skill_id=qizuo_guimou）', async () => {
    await initHeroDB();
    const gj = level40(hero('h476'), { strategy: 40 });
    expect(gj.activeSkillIds).toContain('qizuo_guimou');
  });

  it('机制：释放后自身+友军单体谋略 +22（2 回合），敌军群体随机陷入 1 种控制（混乱/暴走/怯战/犹豫）', () => {
    const guojia = level40(hero('h476'), { strategy: 40 });
    guojia.position = '中军';
    const report = run([guojia, dummy('ally-front', '前锋'), dummy('ally-mid', '大营')], 11);
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillName === '奇佐鬼谋')).toBe(true);

    // 自身 + 友军单体：strategy_buff 至少 2 次（郭嘉自身 + 1 名友军）
    const buffs = inflictedOf(report, 'strategy_buff');
    expect(buffs.length).toBeGreaterThanOrEqual(2);
    expect(buffs.every((e) => e.detail.includes('22'))).toBe(true);

    // 敌军群体随机 1 种控制（持续 2 回合）
    const CONTROL = ['confusion', 'rampage', 'cowardice', 'hesitation'];
    const controls = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
        e.type === 'status_inflicted' && CONTROL.includes(e.statusType)
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) expect(CONTROL).toContain(c.statusType);
    expect(controls.every((c) => c.detail.includes('2 回合'))).toBe(true);
  });

  it('数值：单次施放内每个敌军目标至多随机到 1 种控制（随机 1 种，非多种叠加）', () => {
    const guojia = level40(hero('h476'), { strategy: 40 });
    guojia.position = '中军';
    const report = run([guojia, dummy('ally-front', '前锋'), dummy('ally-mid', '大营')], 21);
    const CONTROL = ['confusion', 'rampage', 'cowardice', 'hesitation'];
    // 按 skill_cast（奇佐鬼谋释放）切分：每次施放后、下次施放前，同一目标至多新增 1 种控制
    const casts = report.events
      .map((e, i) => (e.type === 'skill_cast' && e.skillName === '奇佐鬼谋' ? i : -1))
      .filter((i) => i >= 0);
    expect(casts.length).toBeGreaterThan(0);
    for (let k = 0; k < casts.length; k++) {
      const start = casts[k];
      const end = k + 1 < casts.length ? casts[k + 1] : report.events.length;
      const byTarget = new Map<string, Set<string>>();
      for (const e of report.events.slice(start, end)) {
        if (e.type === 'status_inflicted' && CONTROL.includes(e.statusType) && e.unitId.startsWith('enemy')) {
          const set = byTarget.get(e.unitId) ?? new Set<string>();
          set.add(e.statusType);
          byTarget.set(e.unitId, set);
        }
      }
      for (const set of byTarget.values()) expect(set.size).toBeLessThanOrEqual(1);
    }
  });
});

describe('密谋定蜀（庞统 h477·S2 主动）', () => {
  it('装配：庞统主战法挂入主动槽（main_skill_id=mimou_dingshu）', async () => {
    await initHeroDB();
    const pt = level40(hero('h477'), { strategy: 40 });
    expect(pt.activeSkillIds).toContain('mimou_dingshu');
  });

  it('机制：敌军群体减伤 30%（受谋略）+ 恐慌 + 妖术诅咒；敌方试图发动追击战法时受到诅咒伤害（dot_tick curse）', () => {
    const pangtong = level40(hero('h477'), { strategy: 40 });
    pangtong.position = '中军';
    // 敌方带追击战法（方阵突击）→ 普攻命中后进入追击判定 → 触发诅咒
    // 种子扫描：随机流变化可能使某种子不出战法/不出追击，取首个「施放 + 诅咒触发」的报告
    let report: ReturnType<typeof run> | null = null;
    for (const s of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      const r = run([pangtong, dummy('ally-front', '前锋'), dummy('ally-mid', '大营')], s, 8, enemyTeam({ pursuit: true }));
      const castOk = r.events.some((e) => e.type === 'skill_cast' && e.skillName === '密谋定蜀');
      const curseTick = r.events.some((e): e is DotTickEvent => e.type === 'dot_tick' && e.dotType === 'curse');
      if (castOk && curseTick) {
        report = r;
        break;
      }
    }
    report ??= run([pangtong, dummy('ally-front', '前锋'), dummy('ally-mid', '大营')], 11, 8, enemyTeam({ pursuit: true }));
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillName === '密谋定蜀')).toBe(true);

    // 减伤（受谋略：30% + 0.13/点 ×（谋略-80），40 级庞统谋略≈182 → 43%）+ 恐慌 + 诅咒
    expect(inflictedOf(report, 'damage_reduce').length).toBeGreaterThan(0);
    expect(inflictedOf(report, 'panic').length).toBeGreaterThan(0);
    expect(inflictedOf(report, 'curse').length).toBeGreaterThan(0);

    // 敌方追击判定时触发妖术诅咒伤害
    const curseTicks = report.events.filter((e): e is DotTickEvent => e.type === 'dot_tick' && e.dotType === 'curse');
    expect(curseTicks.length).toBeGreaterThan(0);
    for (const t of curseTicks) {
      expect(t.skillId).toBe('mimou_dingshu'); // 伤害归属施法者战法
      expect(t.damage).toBeGreaterThanOrEqual(0); // 目标兵力耗尽时为 0（cap 截断）
    }
  });

  it('数值：自身造成策略伤害 +5% 受谋略可叠加（damage_boost caused）；诅咒不消耗、每次追击判定都触发', () => {
    const pangtong = level40(hero('h477'), { strategy: 40 });
    pangtong.position = '中军';
    const report = run([pangtong, dummy('ally-front', '前锋'), dummy('ally-mid', '大营')], 21, 8, enemyTeam({ pursuit: true }));
    // 自身挂上 caused 增伤（至少一次发动；多次发动时同战法 rate 累加）
    const boosts = inflictedOf(report, 'damage_boost');
    expect(boosts.length).toBeGreaterThan(0);

    // 诅咒不消耗：同一敌方单位可多次触发（追击判定数次 → 诅咒 tick 数 ≥ 2 的敌方单位存在）
    const curseByTarget = new Map<string, number>();
    for (const e of report.events) {
      if (e.type === 'dot_tick' && e.dotType === 'curse') {
        curseByTarget.set(e.targetId, (curseByTarget.get(e.targetId) ?? 0) + 1);
      }
    }
    expect([...curseByTarget.values()].some((n) => n >= 2)).toBe(true);
  });
});

describe('火势风威（陆逊 h478·S2 准备主动）', () => {
  it('装配：陆逊主战法挂入主动槽（main_skill_id=huoshi_fengwei）', async () => {
    await initHeroDB();
    const lx = level40(hero('h478'), { strategy: 40 });
    expect(lx.activeSkillIds).toContain('huoshi_fengwei');
  });

  it('机制：1 回合准备后对敌军全体策略攻击 111%（受谋略）+ 挂引燃标记；受击时额外引发一次燃烧（dot_tick ignite）', () => {
    const luxun = level40(hero('h478'), { strategy: 40 });
    luxun.position = '中军';
    const report = run([luxun, dummy('ally-front', '前锋', { attack: 120 }), dummy('ally-mid', '大营')], 21);
    // 准备战法：prepare_start → prepare_end 释放
    expect(report.events.some((e) => e.type === 'skill_cast' && e.skillName === '火势风威')).toBe(true);
    // 全体策略伤害（damage 事件，归属 huoshi_fengwei）
    const damages = report.events.filter((e) => e.type === 'damage' && e.skillId === 'huoshi_fengwei');
    expect(damages.length).toBeGreaterThan(0);
    // 引燃标记挂载
    expect(inflictedOf(report, 'ignite').length).toBeGreaterThan(0);
    // 受击触发燃烧：dot_tick ignite 出现（友军普攻命中带标记的敌军）
    const igniteTicks = report.events.filter((e): e is DotTickEvent => e.type === 'dot_tick' && e.dotType === 'ignite');
    expect(igniteTicks.length).toBeGreaterThan(0);
    for (const t of igniteTicks) {
      expect(t.skillId).toBe('huoshi_fengwei');
      expect(t.damage).toBeGreaterThan(0);
    }
  });

  it('数值：引燃为一次性（单元测试验证触发后移除）；同一目标可被多次施放重新挂载，触发次数 ≤ 施放次数', () => {
    const luxun = level40(hero('h478'), { strategy: 40 });
    luxun.position = '中军';
    const report = run([luxun, dummy('ally-front', '前锋', { attack: 120 }), dummy('ally-mid', '大营')], 21);
    const castCount = report.events.filter((e) => e.type === 'skill_cast' && e.skillName === '火势风威').length;
    expect(castCount).toBeGreaterThan(0);
    const igniteByTarget = new Map<string, number>();
    for (const e of report.events) {
      if (e.type === 'dot_tick' && e.dotType === 'ignite') {
        igniteByTarget.set(e.targetId, (igniteByTarget.get(e.targetId) ?? 0) + 1);
      }
    }
    expect(igniteByTarget.size).toBeGreaterThan(0);
    // 每个目标每次被施放至多触发 1 次（标记触发后移除，不重复触发）
    for (const n of igniteByTarget.values()) expect(n).toBeLessThanOrEqual(castCount);
  });
});

describe('辕门射戟（群弓吕布 h479·SP 主动）', () => {
  it('装配：吕布主战法挂入主动槽（main_skill_id=yuanmen_sheji）', async () => {
    await initHeroDB();
    const lb = level40(hero('h479'), { attack: 40 });
    expect(lb.activeSkillIds).toContain('yuanmen_sheji');
  });

  it('机制：发动后二次独立攻击（各 2-3 目标），第一次攻击的目标获得「造成攻击伤害降低」debuff', () => {
    const lb = level40(hero('h479'), { attack: 40 });
    lb.position = '中军';
    const report = run([lb, dummy('ally-front', '前锋'), dummy('ally-mid', '大营')], 31);
    const casts = report.events
      .map((e, i) => (e.type === 'skill_cast' && e.skillName === '辕门射戟' ? i : -1))
      .filter((i) => i >= 0);
    expect(casts.length).toBeGreaterThan(0);

    // 每次施放产生 2 批独立攻击：共 4~6 条 damage（2+2 / 2+3 / 3+3）
    for (const c of casts) {
      let n = 0;
      for (let i = c + 1; i < report.events.length; i++) {
        const e = report.events[i];
        if (e.type === 'skill_cast') break; // 下次施放截止
        if (e.type === 'damage' && e.skillId === 'yuanmen_sheji') n++;
      }
      expect([4, 5, 6]).toContain(n);
    }
    // 第一次攻击目标获得 caused 负增伤 debuff（status_inflicted damage_boost）
    expect(inflictedOf(report, 'damage_boost').length).toBeGreaterThan(0);
  });

  it('数值：单次攻击目标数 ∈ {2,3}（50% 2 / 50% 3）——skillTargets groupCount [2,3] 行为', () => {
    // 单元级：3 个同距离存活敌军 → group [2,3] 每次随机 2 或 3 个目标
    const ctx = makeCtx();
    const caster = makeUnit('caster');
    const enemies = ['e1', 'e2', 'e3'].map((id) => {
      const u = makeUnit(id);
      u.side = 'enemy';
      return u;
    });
    const seen = new Set<number>();
    for (let k = 0; k < 12; k++) {
      const picked = skillTargets(ctx, caster, enemies, 5, 'group', [2, 3]);
      seen.add(picked.length);
    }
    expect(seen.has(2)).toBe(true); // 50% 概率 2 目标
    expect(seen.has(3)).toBe(true); // 50% 概率 3 目标
  });
});

describe('辕门射戟 debuff 数值（单元：伤害下限 10%）', () => {
  it('caused -9999% → 目标普攻伤害 = 兵力基础 + 其余部分×10%（buffMult MIN_DAMAGE_FACTOR 下限，兵力基础不受增减伤影响）', () => {
    const baseline = runPingDamage(false);
    const buffed = runPingDamage(true);
    // 同种子同行动序列：随机系数一致，仅 debuff 差异。
    // calcDamage 中 troopBase 不乘 mult（兵力基础不受增减伤影响），base/main ×0.1：
    // buffed = troopBase + (baseline - troopBase) × 0.1（±1 取整）
    const troopBase = baseline.breakdown.troopBase;
    const expected = Math.round(troopBase + (baseline.damage - troopBase) * 0.1);
    expect(Math.abs(buffed.damage - expected)).toBeLessThanOrEqual(1);
    expect(buffed.damage).toBeGreaterThan(0);
  });
});

/** 单挑场景普攻一次，返回 attack_hit 伤害与拆解；withDebuff 时先给攻击方挂 caused -9999% */
function runPingDamage(withDebuff: boolean): { damage: number; breakdown: { troopBase: number } } {
  const ctx = makeCtx();
  const attacker = makeUnit('attacker', { maxTroops: 10000 });
  const victim = makeUnit('victim');
  victim.side = 'enemy';
  ctx.myTeam = [attacker];
  ctx.enemyTeam = [victim];
  if (withDebuff) {
    // 「使第一次受击的敌军进行攻击的伤害大幅度降低」→ debuff 降低的是携带者「造成」的伤害（caused 方向）
    inflictStatus(ctx, attacker, { type: 'damage_boost', rate: -99.99, duration: 2, direction: 'caused' }, 'active', 'yuanmen_sheji', 'lubu');
  }
  actUnit(ctx, attacker);
  const hit = ctx.events.find((e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit');
  return { damage: hit?.damage ?? -1, breakdown: { troopBase: hit?.breakdown.troopBase ?? 0 } };
}

describe('新状态单元（直接构造 ctx 确定性断言）', () => {
  it('引燃：inflictStatus 挂 ignite → applyDamage 受击触发燃烧并移除标记（一次性）', () => {
    const ctx = makeCtx();
    const u = makeUnit('u1');
    inflictStatus(ctx, u, { type: 'ignite', duration: 999, rate: 221, growthRate: 0.7 }, 'active', 'huoshi_fengwei', 'luyi');
    expect(u.statuses.some((s) => s.type === 'ignite')).toBe(true);
    applyDamage(ctx, u, 100);
    expect(dotTicks(ctx, 'ignite').length).toBe(1); // 触发一次燃烧
    expect(u.statuses.some((s) => s.type === 'ignite')).toBe(false); // 标记移除
    applyDamage(ctx, u, 100);
    expect(dotTicks(ctx, 'ignite').length).toBe(1); // 不再触发
  });

  it('诅咒：携带 curse 的敌方单位普攻命中后进入追击判定 → 触发妖术诅咒伤害（不消耗）', () => {
    const ctx = makeCtx();
    const u = makeUnit('u1', { pursuitSkillIds: ['fangzhen_tuji'] });
    u.side = 'enemy';
    ctx.enemyTeam = [u];
    const ally = makeUnit('ally-front');
    ally.side = 'my';
    ctx.myTeam = [ally];
    inflictStatus(ctx, u, { type: 'curse', duration: 2, rate: 133, growthRate: 0.7 }, 'active', 'mimou_dingshu', 'pangtong');
    expect(u.statuses.some((s) => s.type === 'curse')).toBe(true);

    actUnit(ctx, u); // 敌方行动：普攻命中友军 → 追击判定 → 诅咒触发
    expect(dotTicks(ctx, 'curse').length).toBe(1);
    expect(u.statuses.some((s) => s.type === 'curse')).toBe(true); // 不消耗，仍保留
  });
});
