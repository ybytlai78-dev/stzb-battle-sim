/**
 * 四世三公（袁绍·汉步 h6 主战法）：主动 B，发动率 35%，距离 5，敌军单体。
 * ① 使我军全体分别对距离 5 以内的敌军单体发动一次攻击（伤害率 150%），每次目标独立判定；
 * ② 额外使我军攻击属性最高单体，对敌军防御最低单体发动一次攻击（伤害率 160%）。
 * 官方：scripts/skill_extra.json id 200006（1 级 75% / 80%）。
 * 全文无「受 XX 属性影响」→ 不登记下架（袁绍·汉上架）。
 * 引擎配套：`physical_damage.attackerPick: 'highest_attack'` + `targetPick: 'lowest_defense'`
 *   （挂在既有 attacker:'recipient' 代打路径上）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
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
    maxTroops: 20000,
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

function damages(ctx: CombatContext, skillId = 'sishisan_gong') {
  return ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === skillId,
  );
}

describe('四世三公（袁绍·汉 h6）', () => {
  it('装配：注册表定义 + 挂槽名（主动 B / 35% / 距离 5 / 我军全体代打 + 额外一段）', () => {
    const hero = HERO_REGISTRY['h6'];
    expect(hero.name).toBe('袁绍');
    expect(hero.mainSkillName).toBe('四世三公');

    const s = SKILL_REGISTRY['sishisan_gong'];
    expect(s).toBeTruthy();
    expect(s.type).toBe('active');
    if (s.type !== 'active') return;
    expect(s.triggerRate).toBe(0.35);
    expect(s.range).toBe(5);
    expect(s.targetMode).toBe('all');
    expect(s.targetSide).toBe('ally');
    expect([...s.tags]).toEqual(['damage']);
    expect(s.output[0]).toMatchObject({
      kind: 'physical_damage',
      rate: 150,
      attacker: 'recipient',
      targetMode: 'random_single',
      range: 5,
    });
    expect(s.output[1]).toMatchObject({
      kind: 'physical_damage',
      rate: 160,
      attacker: 'recipient',
      attackerPick: 'highest_attack',
      targetPick: 'lowest_defense',
    });
  });

  it('可上架：全文无「受属性影响」→ 不在未确认成长名单', () => {
    expect(isHeroListed({ mainSkillId: 'sishisan_gong' })).toBe(true);
  });

  it('强制释放：我军 3 人各打 1 次 + 攻击最高者额外打 1 次（共 4 段）', () => {
    const yuanshao = heroUnit('h6', '大营', { activeSkillIds: ['sishisan_gong'] }, { attack: 60 });
    const a = makeUnit(dummy('ally-a', '前锋', { attack: 200 }));
    const b = makeUnit(dummy('ally-b', '中军', { attack: 100 }));
    const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
    const ctx = makeCtx([a, b, yuanshao], [foe]);
    forceSkill(ctx, 'sishisan_gong', (s) => {
      s.triggerRate = 1;
    });

    actUnit(ctx, yuanshao);

    const dmg = damages(ctx);
    expect(dmg).toHaveLength(4); // ① 全体 3 段 + ② 最高攻击者 1 段
    const first3 = dmg.slice(0, 3);
    // ① 我军全体分别出手：3 段的来源互不相同（各打一次）
    expect(new Set(first3.map((d) => d.sourceId)).size).toBe(3);
    expect(new Set(first3.map((d) => d.sourceId))).toEqual(new Set(['ally-a', 'ally-b', 'h6']));
    // ② 额外段由攻击属性最高的 ally-a 出手
    const extra = dmg[3];
    expect(extra.sourceId).toBe('ally-a');
    expect(extra.targetId).toBe('foe');
  });

  it('额外段钉「敌军防御最低单体」与「我军攻击最高单体」', () => {
    const yuanshao = heroUnit('h6', '大营', { activeSkillIds: ['sishisan_gong'] }, { attack: 60 });
    const strong = makeUnit(dummy('ally-strong', '前锋', { attack: 220 }));
    const weak = makeUnit(dummy('ally-weak', '中军', { attack: 90 }));
    const tanky = makeUnit(dummy('foe-tanky', '前锋', { defense: 400, maxTroops: 60000 }), 'enemy');
    const squishy = makeUnit(dummy('foe-squishy', '大营', { defense: 10, maxTroops: 60000 }), 'enemy');
    const ctx = makeCtx([strong, weak, yuanshao], [tanky, squishy]);
    forceSkill(ctx, 'sishisan_gong', (s) => {
      s.triggerRate = 1;
    });

    actUnit(ctx, yuanshao);

    const dmg = damages(ctx);
    // 第二段（额外段）= 每条伤害里的第 4 条
    const extra = dmg[3];
    expect(extra.sourceId).toBe('ally-strong');
    expect(extra.targetId).toBe('foe-squishy');
  });

  it('① 段每次目标独立判定：多次释放可命中不同敌军', () => {
    const targets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const yuanshao = heroUnit('h6', '大营', { activeSkillIds: ['sishisan_gong'] });
      const mate = makeUnit(dummy('ally-a', '前锋'));
      const foes = [
        makeUnit(dummy('e-front', '前锋', { maxTroops: 60000 }), 'enemy'),
        makeUnit(dummy('e-mid', '中军', { maxTroops: 60000 }), 'enemy'),
        makeUnit(dummy('e-camp', '大营', { maxTroops: 60000 }), 'enemy'),
      ];
      const ctx = makeCtx([mate, yuanshao], foes, seed);
      forceSkill(ctx, 'sishisan_gong', (s) => {
        s.triggerRate = 1;
      });
      actUnit(ctx, yuanshao);
      for (const d of damages(ctx).slice(0, 2)) targets.add(d.targetId);
    }
    expect(targets.size).toBeGreaterThan(1);
  });

  it('整场跑通（runBattle）：出现本战法攻击伤害', () => {
    const leader: General = {
      ...withSkills(level40(HERO_REGISTRY['h6']), { activeSkillIds: ['sishisan_gong'] }),
      position: '大营',
    };
    const report = runBattle({
      seed: 9,
      maxRounds: 8,
      myTeam: [dummy('a-front', '前锋'), dummy('a-mid', '中军'), leader],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });
    expect(report.events.some((e) => e.type === 'damage' && e.skillId === 'sishisan_gong')).toBe(true);
  });
});
