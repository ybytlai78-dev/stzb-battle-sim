/**
 * 威震河朔（袁绍·群弓 h670 主战法）：主动 A，发动率 70%，距离 5，敌军群体（有效距离内 2 个目标）。
 * ① 对敌军群体发动一次攻击（伤害率 200%）；
 * ② 使自身与友军单体的主动战法伤害提升 20%（受攻击属性影响），持续 2 回合；
 * ③ 此战法每发动一次，其发动率降低 10%。
 * 官方：scripts/skill_extra.json id 200947；官网该条为「攻击版 + 策略版」两段拼接，
 * 按仓库口径只用前半（与 web/data/heroes.json h670 清洗后描述一致）。
 * 引擎配套：新增 `triggerRateDecayPerCast`（主动战法发动率递减，每次成功发动后基础率 −10%，可叠、最低 0）。
 * 成长率：「受攻击属性影响」的 20% 未确认 → 留空（attackScaled: true 且不给 growthRate → 按基值不缩放）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
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
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 80,
    defense: 80,
    strategy: 80,
    speed: 50,
    attackRange: 5,
    maxTroops: 10000,
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

function forceSkill(ctx: CombatContext, id: string, patch: (s: Skill) => void): void {
  const cloned = structuredClone(SKILL_REGISTRY[id]) as Skill;
  patch(cloned);
  ctx.skills.set(id, cloned);
}

function heroUnit(
  heroId: string,
  position: Position,
  skills: Parameters<typeof withSkills>[1],
  extra: Partial<General> = {},
): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), skills), position, ...extra });
}

function triggers(ctx: CombatContext, skillId: string): Extract<BattleEvent, { type: 'skill_trigger' }>[] {
  return ctx.events.filter((e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
    e.type === 'skill_trigger' && e.skillId === skillId,
  );
}

/** 取某个单位身上「威震河朔」施加的增伤状态 */
function boostOf(unit: UnitState) {
  return unit.statuses.find(
    (s): s is Extract<UnitState['statuses'][number], { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === 'weizhen_heshuo',
  );
}

describe('威震河朔（袁绍 h670）', () => {
  it('装配：注册表定义 + 挂槽名（主动 A / 70% / 距离 5 / 敌军群体 2 / 弓）', () => {
    const hero = HERO_REGISTRY['h670'];
    expect(hero.name).toBe('袁绍');
    expect(hero.mainSkillName).toBe('威震河朔');

    const s = SKILL_REGISTRY['weizhen_heshuo'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.prepare).toBe(false);
    expect(s.triggerRate).toBe(0.7);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['damage', 'damage_boost']);
    // ③ 发动率递减 −10%/次
    expect(s.triggerRateDecayPerCast).toBe(0.1);
    // ① 攻击 200%
    expect(s.output[0]).toMatchObject({ kind: 'physical_damage', rate: 200 });
    // ② 自身 / 友军单体：主动战法伤害 +20%（受攻击，无 growthRate = 不缩放）
    expect(s.output[1]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'self',
      status: {
        type: 'damage_boost',
        rate: 0.2,
        duration: 2,
        direction: 'caused',
        skillTypes: ['active'],
        attackScaled: true,
      },
    });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      targetSide: 'ally',
      targetMode: 'random_single',
      excludeSelf: true,
    });
    const friend = s.output[2];
    if (friend.kind === 'inflict_status' && !Array.isArray(friend.status)) {
      expect(friend.status).toMatchObject({ type: 'damage_boost', rate: 0.2, skillTypes: ['active'] });
      expect('growthRate' in friend.status ? friend.status.growthRate : undefined).toBeUndefined();
    }
  });

  it('强制释放：群体 2 目标各吃一次攻击 + 自身与友军单体各挂一条主动战法增伤', () => {
    const me = heroUnit('h670', '中军', { activeSkillIds: ['weizhen_heshuo'] });
    const ally = makeUnit(dummy('ally-front', '前锋'));
    const e1 = makeUnit(dummy('e-front', '前锋'), 'enemy');
    const e2 = makeUnit(dummy('e-mid', '中军'), 'enemy');
    const e3 = makeUnit(dummy('e-camp', '大营'), 'enemy');
    const ctx = makeCtx([me, ally], [e1, e2, e3]);
    forceSkill(ctx, 'weizhen_heshuo', (s) => {
      s.triggerRate = 1;
    });

    actUnit(ctx, me);

    const hits = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillId === 'weizhen_heshuo',
    );
    expect(hits).toHaveLength(2); // 敌军群体（有效距离内 2 个目标）
    expect(hits.every((h) => h.damageType === 'physical')).toBe(true);

    const mine = boostOf(me);
    const theirs = boostOf(ally);
    expect(mine?.rate).toBe(0.2);
    expect(theirs?.rate).toBe(0.2);
    // 只对主动战法生效的过滤维
    expect(mine?.skillTypes).toEqual(['active']);
    expect(mine?.direction).toBe('caused');
    // 仅这两条（第三人未参与）
    const boosted = [me, ally, e1, e2, e3].filter((u) => boostOf(u));
    expect(boosted.map((u) => u.general.id).sort()).toEqual(['ally-front', 'h670']);
  });

  it('发动率递减：预置已发动 3 次 → 首次判定基础率 70%−30% = 40%', () => {
    const me = heroUnit('h670', '中军', { activeSkillIds: ['weizhen_heshuo'] });
    const fo = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([me], [fo]);
    ctx.skillCastCounters = new Map([['h670:weizhen_heshuo', 3]]);

    actUnit(ctx, me);

    const first = triggers(ctx, 'weizhen_heshuo')[0];
    expect(first).toBeTruthy();
    expect(first.baseRate).toBe(40);
    expect(first.rate).toBe(40); // 士气 100 → 系数 1
  });

  it('发动率递减：每成功发动一次再 −10%，最低 0（多回合实跑不变量）', () => {
    const me = heroUnit('h670', '中军', { activeSkillIds: ['weizhen_heshuo'] });
    const fo = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([me], [fo]);
    forceSkill(ctx, 'weizhen_heshuo', (s) => {
      s.triggerRate = 1; // 从 100% 起，便于观察递减序列
    });

    for (let round = 1; round <= 12; round++) {
      ctx.currentRound = round;
      actUnit(ctx, me);
    }

    const list = triggers(ctx, 'weizhen_heshuo');
    expect(list.length).toBeGreaterThanOrEqual(11);
    let success = 0;
    for (const t of list) {
      // 每次判定读到的都是「已成功发动次数」对应后的基础率
      expect(t.baseRate).toBe(Math.max(0, 100 - 10 * success));
      if (t.success) success += 1;
    }
    expect(success).toBeGreaterThanOrEqual(1);
    // 递减确实发生：序列里出现过不止一个取值
    expect(new Set(list.map((t) => t.baseRate)).size).toBeGreaterThan(1);
  });

  it('只吃主动战法：友军主动战法伤害吃到 +20%，同回合普通攻击不吃', () => {
    const me = heroUnit('h670', '中军', { activeSkillIds: ['weizhen_heshuo'] }, { speed: 200 });
    const ally = makeUnit(dummy('ally-front', '前锋', { activeSkillIds: ['tujin'], attack: 120 }));
    const fo = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([me, ally], [fo]);
    forceSkill(ctx, 'weizhen_heshuo', (s) => {
      s.triggerRate = 1;
    });
    forceSkill(ctx, 'tujin', (s) => {
      s.triggerRate = 1;
    });

    actUnit(ctx, me); // 先挂增伤（自身 + 友军单体）
    actUnit(ctx, ally); // 主动战法 + 普通攻击

    const skillHits = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === 'tujin',
    );
    expect(skillHits.length).toBeGreaterThan(0);
    expect(skillHits.some((h) => (h.modifiers?.caused ?? []).some((m) => m.skillId === 'weizhen_heshuo'))).toBe(
      true,
    );

    const basicHits = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> => e.type === 'attack_hit',
    );
    expect(basicHits.length).toBeGreaterThan(0);
    expect(
      basicHits.every((h) => !(h.modifiers?.caused ?? []).some((m) => m.skillId === 'weizhen_heshuo')),
    ).toBe(true);
  });

  it('成长率留空：攻击 80 与 300 的增伤都是 20%（不缩放）+ 整场跑通', () => {
    const buffRateAt = (attack: number) => {
      const me = heroUnit('h670', '中军', { activeSkillIds: ['weizhen_heshuo'] }, { attack });
      const ally = makeUnit(dummy('ally-front', '前锋'));
      const fo = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([me, ally], [fo]);
      forceSkill(ctx, 'weizhen_heshuo', (s) => {
        s.triggerRate = 1;
      });
      actUnit(ctx, me);
      return [boostOf(me)?.rate, boostOf(ally)?.rate];
    };
    expect(buffRateAt(80)).toEqual([0.2, 0.2]);
    expect(buffRateAt(300)).toEqual([0.2, 0.2]);

    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h670']), { activeSkillIds: ['weizhen_heshuo'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 2,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), leader, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'skill_trigger' && e.skillId === 'weizhen_heshuo')).toBe(true);
    expect(
      report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'damage_boost'),
    ).toBe(true);
  });
});
