/**
 * 藤甲突击（兀突骨·群步 h519 主战法）：被动 B（battle_start 登记型），距离 1，目标自己。
 * 满级：不受敌方指挥战法的影响，同时每回合首次发动主动战法后，对距离 4 以内敌军群体发动一次攻击
 *   （伤害率 100.0%），并使其下一次造成的攻击或策略攻击伤害降低 50.0%。1 级：50% / 25%。
 * 官方：scripts/skill_extra.json id 200756。来源 https://stzb.163.com/m/skilllist/200756.html
 * 口径（策略 A，照 skills.ts 注释；推定处已标注）：
 *   ① 两版拼接（v1 每回合首次 / v2 每回合发动时）→ 取前半 v1；
 *   ② 不受敌方指挥战法影响 = 新引擎件 PassiveSkill.commandImmune（状态在 inflictStatus 拦截 +
 *      指挥伤害段逐目标跳过；友方指挥不受影响）；
 *   ③ afterActive + oncePerRound（每回合首次）；
 *   ④ 段级 range:4 + targetMode group（群体 = 2 目标）；
 *   ⑤ 伤害降低 50% = damage_boost caused −0.5 + charges 1（下一次造成伤害时消耗）；
 *   ⑥ 上架。
 * 兵力口径：heroUnit() 走 level40() → 兵力 9000（非 dummy 30000）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, HeroRecord, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_RECORDS, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import { isHeroListed, OFFLINE_MAIN_SKILLS } from '../src/data/listing';
import { Rng } from '../src/engine/rng';

beforeAll(async () => {
  await initHeroDB();
});

const SKILL_ID = 'tengjia_tuji';
const HERO_ID = 'h519';

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

function heroUnit(heroId: string, position: Position, extra: Partial<General> = {}): UnitState {
  return makeUnit({ ...withSkills(level40(HERO_REGISTRY[heroId]), {}), ...extra, position });
}

function enemyTrio(): UnitState[] {
  return [
    makeUnit(dummy('foe-front', '前锋'), 'enemy'),
    makeUnit(dummy('foe-mid', '中军'), 'enemy'),
    makeUnit(dummy('foe-back', '大营'), 'enemy'),
  ];
}

const debuffOf = (u: UnitState) => {
  const st = u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID
  );
  if (!st) throw new Error('期望 damage_boost');
  return st;
};
const hits = (ctx: CombatContext) =>
  ctx.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID);

describe('藤甲突击（兀突骨 h519）', () => {
  it('装配：被动 battle_start·commandImmune·afterActive{每回合首次·群体攻击 100%·下次伤害 −50%}·挂槽·上架', () => {
    const hero = HERO_REGISTRY[HERO_ID];
    expect(hero.name).toBe('兀突骨');
    expect(hero.faction).toBe('群');
    expect(hero.troopType).toBe('infantry');
    expect(hero.mainSkillName).toBe('藤甲突击');
    expect(HERO_RECORDS[HERO_ID]?.mainSkillId).toBe(SKILL_ID);
    expect(hero.passiveSkillIds).toContain(SKILL_ID);

    const s = SKILL_REGISTRY[SKILL_ID];
    expect(s).toBeTruthy();
    expect(s.type).toBe('passive');
    if (s.type !== 'passive') return;
    expect(s.timing).toBe('battle_start');
    expect(s.range).toBe(1);
    expect(s.targetMode).toBe('self');
    expect(s.tags).toEqual(['damage', 'damage_boost']);
    expect(s.commandImmune).toBe(true);
    expect(s.output).toEqual([]);
    expect(s.afterActive).toEqual({
      oncePerRound: true,
      output: [
        { kind: 'physical_damage', rate: 100, targetMode: 'group', groupCount: 2, range: 4 },
        {
          kind: 'inflict_status',
          sameTargetsAsLastDamage: true,
          status: { type: 'damage_boost', rate: -0.5, duration: 999, direction: 'caused', charges: 1 },
        },
      ],
    });

    // 无数值缺口 → 上架
    expect(OFFLINE_MAIN_SKILLS[SKILL_ID]).toBeUndefined();
    expect(isHeroListed(HERO_RECORDS[HERO_ID] as HeroRecord)).toBe(true);
  });

  it('机制·不受敌方指挥战法影响：敌方指挥状态被拦截；友方指挥 / 主动战法不受影响', () => {
    const ctx = makeCtx(
      [heroUnit(HERO_ID, '前锋'), makeUnit(dummy('mate', '中军'), 'my', 9000)],
      [makeUnit(dummy('foe-cc', '中军'), 'enemy')],
      3
    );
    const wutugu = ctx.myTeam[0];
    const foeCaster = ctx.enemyTeam[0];

    // 敌方指挥战法施加 → 拦截
    inflictStatus(ctx, wutugu, { type: 'cowardice', duration: 2 }, 'command', 'mock_enemy_command', foeCaster.general.id);
    expect(wutugu.statuses.some((s) => s.type === 'cowardice')).toBe(false);
    expect(
      ctx.events.some((e) => e.type === 'command_immune_blocked' && e.unitId === wutugu.general.id)
    ).toBe(true);

    // 敌方主动战法施加 → 正常生效
    inflictStatus(ctx, wutugu, { type: 'hesitation', duration: 2 }, 'active', 'mock_active', foeCaster.general.id);
    expect(wutugu.statuses.some((s) => s.type === 'hesitation')).toBe(true);

    // 友方指挥战法施加 → 正常生效（只挡敌方）
    const allyCaster = ctx.myTeam[1];
    inflictStatus(ctx, wutugu, { type: 'attack_buff', amount: 30, duration: 2 }, 'command', 'mock_ally_command', allyCaster.general.id);
    expect(wutugu.statuses.some((s) => s.type === 'attack_buff')).toBe(true);
  });

  it('机制·免疫指挥战法伤害：敌方【西陵克晋】对兀突骨造成 0 伤害（同场景普通单位会受伤）', () => {
    const run = (immune: boolean) => {
      const my = [
        immune ? heroUnit(HERO_ID, '前锋') : makeUnit(dummy('plain', '前锋'), 'my', 9000),
      ];
      const lukan = makeUnit(heroUnit('h574', '中军').general, 'enemy');
      const ctx = makeCtx(my, [lukan], 9);
      // 让西陵克晋必定发动（dynamicTriggerRate base 0.5 → 1）
      const def = ctx.skills.get('xiling_kejin');
      if (def?.type !== 'command') throw new Error('期望 command');
      ctx.skills.set('xiling_kejin', { ...def, dynamicTriggerRate: { base: 1, increment: 0 } });
      ctx.currentRound = 1;
      actUnit(ctx, lukan);
      return {
        // 只统计战法伤害（actUnit 自带的普攻不计）
        damage: ctx.events
          .filter(
            (e): e is Extract<BattleEvent, { type: 'damage' }> =>
              e.type === 'damage' && e.skillId === 'xiling_kejin'
          )
          .reduce((a, e) => a + (e.damage ?? 0), 0),
        blocked: ctx.events.some((e) => e.type === 'command_immune_blocked'),
      };
    };
    const plain = run(false);
    const immune = run(true);
    expect(plain.damage).toBeGreaterThan(0);
    expect(immune.damage).toBe(0);
    expect(immune.blocked).toBe(true);
  });

  it('机制·每回合首次主动后：一个行动内两次主动只触发一次，群体攻击 100% + 目标下次造成伤害 −50%（charges 1）', () => {
    // 两个真实存在的**主动**战法：将出关西（华雄）+ 计谕废立（李儒），并把发动率改成 1
    const wutugu = heroUnit(HERO_ID, '前锋', { activeSkillIds: ['jiangchu_guanxi', 'jiyu_fuili'] } as Partial<General>);
    const ctx = makeCtx([wutugu], enemyTrio(), 11);
    for (const id of ['jiangchu_guanxi', 'jiyu_fuili']) {
      const def = ctx.skills.get(id);
      if (def?.type !== 'active') throw new Error(`期望 active: ${id}`);
      ctx.skills.set(id, { ...def, triggerRate: 1 });
    }
    ctx.currentRound = 1;
    actUnit(ctx, wutugu);

    // 两次主动都成功释放
    const casts = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast'
    );
    expect(casts.filter((e) => e.skillId === SKILL_ID)).toHaveLength(1); // 每回合只触发一次
    expect(casts.filter((e) => e.skillId === 'jiangchu_guanxi' || e.skillId === 'jiyu_fuili')).toHaveLength(2);

    // 藤甲突击的群体攻击（2 目标）落在同一次伤害段里
    const own = hits(ctx);
    expect(own.length).toBe(2);
    expect(own.every((h) => h.damageType === 'physical')).toBe(true);
    for (const h of own) {
      const foe = ctx.enemyTeam.find((e) => e.general.id === h.targetId)!;
      const d = debuffOf(foe);
      expect(d.direction).toBe('caused');
      expect(d.rate).toBeCloseTo(-0.5, 6);
      expect(d.charges).toBe(1);
    }
  });

  it('数值·「下一次造成伤害 −50%」生效：同种子对照，带 debuff 的敌方普攻伤害更低且消耗后移除', () => {
    const run = (withDebuff: boolean) => {
      const target = makeUnit(dummy('victim', '大营'), 'my', 9000);
      const foe = makeUnit(dummy('foe', '前锋'), 'enemy');
      const ctx = makeCtx([target], [foe], 13);
      if (withDebuff) {
        inflictStatus(
          ctx,
          foe,
          { type: 'damage_boost', rate: -0.5, duration: 999, direction: 'caused', charges: 1 },
          'passive',
          SKILL_ID,
          target.general.id
        );
      }
      actUnit(ctx, foe);
      return { loss: target.general.maxTroops - target.troops, foe };
    };
    const plain = run(false);
    const debuffed = run(true);
    expect(plain.loss).toBeGreaterThan(0);
    expect(debuffed.loss).toBeGreaterThan(0);
    expect(debuffed.loss).toBeLessThan(plain.loss);
    // charges 1 → 打出一次后移除
    expect(debuffed.foe.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === SKILL_ID)).toBe(false);
    expect(plain.foe.statuses.some((s) => s.type === 'damage_boost')).toBe(false);
  });

  it('整场跑通（runBattle·8 回合）：藤甲突击攻击与 battle_end 齐全', () => {
    const wutugu: General = {
      ...withSkills(level40(HERO_REGISTRY[HERO_ID]), { activeSkillIds: ['wanjun_qushou'] }),
      position: '前锋',
    };
    const report = runBattle({
      seed: 99,
      maxRounds: 8,
      myTeam: [wutugu, dummy('a-mid', '中军'), dummy('a-back', '大营')],
      enemyTeam: [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')],
    });

    expect(report.events.some((e) => e.type === 'battle_end')).toBe(true);
    const own = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.skillId === SKILL_ID
    );
    expect(own.length).toBeGreaterThan(0);
  });
});
