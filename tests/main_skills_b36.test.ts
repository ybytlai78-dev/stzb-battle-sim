/**
 * 忠克猛烈（陈到·蜀步 h793 主战法）：主动 S，发动率 50%，距离 5，敌军单体。
 * 本战法造成的伤害无视兵种相克及目标的防御属性；对敌军单体发动 1 次攻击（伤害率 300%），
 * 并使其陷入犹豫状态（无法发动主动战法）持续 1 回合；直到陈到下回合行动前，目标每受到 1 次攻击伤害，
 * 陈到对其发动 1 次攻击（伤害率 120%），期间最多可触发 2 次。
 * 官方：scripts/skill_extra.json id 200268（1 级 150% / 60%）。
 * 全文无「受 XX 属性影响」→ 无成长率留空问题，**不需要 OFFLINE_MAIN_SKILLS 登记**（本批首个可上架）。
 * 引擎配套：`physical_damage.ignoresDefense` + 新状态 `retaliate`（受击追加攻击标记，最多 2 次）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, applyDamage, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed } from '../src/data/listing';
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
    faction: '蜀',
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

function skillDamages(ctx: CombatContext, skillId = 'zhongke_menglie') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

function markOf(unit: UnitState): Extract<Status, { type: 'retaliate' }> | undefined {
  return unit.statuses.find((s): s is Extract<Status, { type: 'retaliate' }> => s.type === 'retaliate');
}

/** 陈到对单个木桩强制释放一次 */
function castOnce(seed = 1) {
  const me = heroUnit('h793', '中军', { activeSkillIds: ['zhongke_menglie'] });
  const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
  const ctx = makeCtx([me], [foe], seed);
  forceSkill(ctx, 'zhongke_menglie', (s) => {
    s.triggerRate = 1;
  });
  actUnit(ctx, me);
  return { me, foe, ctx };
}

describe('忠克猛烈（陈到 h793）', () => {
  it('装配：注册表定义 + 挂槽名（主动 S / 50% / 距离 5 / 敌军单体）', () => {
    const hero = HERO_REGISTRY['h793'];
    expect(hero.name).toBe('陈到');
    expect(hero.mainSkillName).toBe('忠克猛烈');

    const s = SKILL_REGISTRY['zhongke_menglie'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.triggerRate).toBe(0.5);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('random_single');
    expect(s.targetSide).toBe('enemy');
    expect([...s.tags].sort()).toEqual(['damage', 'hesitation', 'retaliate']);
    expect(s.output[0]).toMatchObject({
      kind: 'physical_damage',
      rate: 300,
      ignoresTroopCounter: true,
      ignoresDefense: true,
    });
    expect(s.output[1]).toMatchObject({ kind: 'inflict_status', status: { type: 'hesitation', duration: 1 } });
    expect(s.output[2]).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'retaliate', rate: 120, maxTriggers: 2 },
    });
  });

  it('可上架：全文无「受属性影响」→ 不在未确认成长名单（本批首个上架武将）', () => {
    const rec = { mainSkillId: 'zhongke_menglie' };
    expect(isHeroListed(rec)).toBe(true);
  });

  it('强制释放：300% 攻击 + 犹豫 + 受击追加攻击标记（普攻随即触发 1 次追加）', () => {
    const { foe, ctx } = castOnce();
    const dmg = skillDamages(ctx);
    // 主动段 300% + 本次行动普攻命中后触发的追加攻击 120%
    expect(dmg).toHaveLength(2);
    expect(dmg[0].targetId).toBe('foe');
    expect(dmg[0].damageType).toBe('physical');
    expect(dmg[0].damage).toBeGreaterThan(dmg[1].damage); // 300% > 120%
    expect(foe.statuses.some((s) => s.type === 'hesitation')).toBe(true);
    const mark = markOf(foe);
    expect(mark).toBeTruthy();
    expect(mark?.rate).toBe(120);
    expect(mark?.maxTriggers).toBe(2);
    expect(mark?.triggers).toBe(1);
    expect(mark?.sourceUnitId).toBe('h793');
  });

  it('受击追加攻击：最多触发 2 次，用满后标记消失、再受击不追加', () => {
    const { me, foe, ctx } = castOnce();
    const before = skillDamages(ctx).length;
    expect(before).toBe(2); // 主动段 + 普攻触发的第 1 次追加
    expect(markOf(foe)?.triggers).toBe(1);

    // 第 2 次受攻击伤害 → 追加 1 次并达到上限、标记移除
    applyDamage(ctx, foe, 300, me, 'physical', 'skill');
    expect(skillDamages(ctx)).toHaveLength(before + 1);
    expect(markOf(foe)).toBeUndefined();

    // 第 3 次受击 → 不再追加
    applyDamage(ctx, foe, 300, me, 'physical', 'skill');
    expect(skillDamages(ctx)).toHaveLength(before + 1);

    for (const d of skillDamages(ctx)) expect(d.damage).toBeGreaterThan(0);
  });

  it('谋略伤害不触发标记（只有攻击伤害才算）', () => {
    const { me, foe, ctx } = castOnce();
    const before = skillDamages(ctx).length;
    applyDamage(ctx, foe, 300, me, 'strategy', 'skill');
    expect(skillDamages(ctx)).toHaveLength(before);
    expect(markOf(foe)?.triggers).toBe(1); // 仍是普攻触发的那 1 次
  });

  it('窗口到期：施法者下回合行动后标记被清除，不再追加攻击', () => {
    const { me, foe, ctx } = castOnce();
    expect(markOf(foe)).toBeTruthy();

    forceSkill(ctx, 'zhongke_menglie', (s) => {
      s.triggerRate = 0; // 防止下回合再次施放（否则会重新挂标记）
    });
    ctx.currentRound = 2;
    actUnit(ctx, me); // 陈到下回合行动 → 标记到期（其后的普攻不再触发追加攻击）

    expect(markOf(foe)).toBeUndefined();
    const before = skillDamages(ctx).length;
    applyDamage(ctx, foe, 300, me, 'physical', 'skill');
    expect(skillDamages(ctx)).toHaveLength(before);
  });

  it('无视目标防御：同种子下比不无视防御的对照组伤害更高', () => {
    const damageWith = (ignoresDefense: boolean) => {
      const me = heroUnit('h793', '中军', { activeSkillIds: ['zhongke_menglie'] });
      const foe = makeUnit(dummy('foe', '前锋', { defense: 200 }), 'enemy');
      const ctx = makeCtx([me], [foe], 7);
      forceSkill(ctx, 'zhongke_menglie', (s) => {
        s.triggerRate = 1;
        const out = s.output[0];
        if (out.kind === 'physical_damage') out.ignoresDefense = ignoresDefense;
      });
      actUnit(ctx, me);
      return skillDamages(ctx)[0]?.damage ?? 0;
    };
    const withIgnore = damageWith(true);
    const without = damageWith(false);
    expect(withIgnore).toBeGreaterThan(without);
  });

  it('整场跑通（runBattle）：出现攻击伤害 + 犹豫状态', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h793']), { activeSkillIds: ['zhongke_menglie'] }),
      position: '中军',
    };
    const report = runBattle({
      seed: 4,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), leader, dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'damage' && e.skillId === 'zhongke_menglie')).toBe(true);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'retaliate')).toBe(true);
  });
});
