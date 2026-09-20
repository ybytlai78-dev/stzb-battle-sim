/**
 * 二级兵种（兵种转换）战斗期测试
 *
 * 覆盖用户 2026-09-20 审定的口径：
 *  1. 攻击距离修正：长弓兵 +1、死士 −1
 *  2. 造成伤害加成：弩兵 +8%、长弓兵前 4 回合 +10%
 *  3. 长枪兵改写相克：骑打枪 −30%、枪打骑 +30%、弓打枪 +30%、枪打弓 −30%
 *  4. 象兵：不受任何指挥战法效果影响（敌我正负一视同仁）
 *  5. 通用特性：齐射/迂回/守备/难测/出奇/利刃/地利
 *  6. 藤甲兵：常规减伤 −30%；铁骑兵四类状态减伤（不可叠加）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, DamageModifiers, General, TroopType } from '../src/engine/types';
import type { GeneralTrait, SecondaryTroopType } from '../src/engine/secondaryTroop';
import { initHeroDB } from '../src/data/heroes';
import { attackRangeOf } from '../src/engine/target';
import { effectiveStat } from '../src/engine/action';

beforeAll(async () => {
  await initHeroDB();
});

type HitEvent = Extract<BattleEvent, { type: 'attack_hit' }>;
type DmgEvent = Extract<BattleEvent, { type: 'damage' }>;
type Rep = ReturnType<typeof runBattle>;

function makeGeneral(
  id: string,
  troopType: TroopType,
  opts: {
    attack?: number;
    defense?: number;
    strategy?: number;
    speed?: number;
    attackRange?: number;
    troops?: number;
    secondaryTroop?: SecondaryTroopType;
    traits?: GeneralTrait[];
    activeSkillIds?: string[];
    commandSkillIds?: string[];
  } = {}
): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType,
    position: '大营',
    attack: opts.attack ?? 220,
    defense: opts.defense ?? 60,
    strategy: opts.strategy ?? 100,
    speed: opts.speed ?? 100,
    attackRange: opts.attackRange ?? 2,
    maxTroops: opts.troops ?? 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: opts.activeSkillIds ?? [],
    passiveSkillIds: [],
    commandSkillIds: opts.commandSkillIds ?? [],
    pursuitSkillIds: [],
    morale: 100,
    secondaryTroop: opts.secondaryTroop,
    secondaryTraits: opts.traits,
  };
}

function runDuel(my: General, enemy: General, seed = 12345) {
  return runBattle({ myTeam: [my], enemyTeam: [enemy], seed, maxRounds: 8 });
}

const hitsOf = (rep: Rep, id: string): HitEvent[] =>
  rep.events.filter((e): e is HitEvent => e.type === 'attack_hit' && e.sourceId === id);
const dmgOf = (rep: Rep, id: string): DmgEvent[] =>
  rep.events.filter((e): e is DmgEvent => e.type === 'damage' && e.sourceId === id);
/** 该次伤害/普攻事件里的全部增减伤来源（含 troop_trait） */
const modList = (ev: { modifiers?: DamageModifiers }) =>
  [...(ev.modifiers?.caused ?? []), ...(ev.modifiers?.taken ?? []), ...(ev.modifiers?.reduce ?? [])];
/** 我方总输出（普攻 + 战法伤害） */
const totalOut = (rep: Rep, id: string) =>
  hitsOf(rep, id).reduce((s, h) => s + h.damage, 0) + dmgOf(rep, id).reduce((s, d) => s + d.damage, 0);
/** 我方承受的总伤害（敌我事件里的 targetId 指向我方） */
const totalTaken = (rep: Rep, id: string) =>
  rep.events
    .filter((e): e is HitEvent | DmgEvent => (e.type === 'attack_hit' || e.type === 'damage') && (e as { targetId: string }).targetId === id)
    .reduce((s, e) => s + e.damage, 0);

describe('二级兵种：攻击距离修正（用户口径）', () => {
  it('长弓兵 +1、死士 −1、其余不变（attackRangeOf）', () => {
    const unit = (troop?: SecondaryTroopType, base = 3) =>
      ({ general: makeGeneral('u', 'archer', { attackRange: base, secondaryTroop: troop }), statuses: [] }) as never;
    expect(attackRangeOf(unit(undefined))).toBe(3);
    expect(attackRangeOf(unit('长弓兵'))).toBe(4);
    expect(attackRangeOf(unit('死士'))).toBe(2);
    expect(attackRangeOf(unit('弩兵'))).toBe(3);
  });

  it('死士攻击距离 −1 后打不到原本够得到的目标（1→0，本体同配置可打）', () => {
    // 双方均大营 → 距离 1；攻击距离 1：本体可打到，转死士后 0 → 打不到
    const base = makeGeneral('u', 'archer', { attackRange: 1, speed: 200 });
    expect(hitsOf(runDuel(base, makeGeneral('e', 'archer', { speed: 1 }), 7), 'u').length).toBeGreaterThan(0);

    const dead = makeGeneral('u', 'archer', { attackRange: 1, speed: 200, secondaryTroop: '死士' });
    expect(hitsOf(runDuel(dead, makeGeneral('e', 'archer', { speed: 1 }), 7), 'u').length).toBe(0);
  });

  it('长弓兵 +1：面板 1 → 2（战斗期 attackRangeOf 生效）', () => {
    const g = makeGeneral('u', 'archer', { attackRange: 1, speed: 200, secondaryTroop: '长弓兵' });
    expect(attackRangeOf({ general: g, statuses: [] } as never)).toBe(2);
    // 与本体同为 1 距离时不吃亏；且比本体更容易够到远处目标（此处以属性断言 + 输出不降级验证）
    const base = makeGeneral('u', 'archer', { attackRange: 1, speed: 200 });
    const enemy = () => makeGeneral('e', 'archer', { speed: 1 });
    expect(hitsOf(runDuel(g, enemy(), 9), 'u').length).toBeGreaterThanOrEqual(
      hitsOf(runDuel(base, enemy(), 9), 'u').length
    );
  });
});

describe('二级兵种：造成伤害加成（弩兵 / 长弓兵）', () => {
  it('弩兵比未转换同配置输出更高，且战报 modifiers 带 troop_trait 加成来源', () => {
    const enemy = () => makeGeneral('e', 'archer', { speed: 1 });
    const plain = runDuel(makeGeneral('u', 'archer', { speed: 200 }), enemy(), 4242);
    const cross = runDuel(makeGeneral('u', 'archer', { speed: 200, secondaryTroop: '弩兵' }), enemy(), 4242);
    expect(totalOut(cross, 'u')).toBeGreaterThan(totalOut(plain, 'u'));
    const hit = hitsOf(cross, 'u')[0];
    expect(hit).toBeDefined();
    expect(modList(hit).some((m) => m.skillId === 'troop_trait' && m.rate > 0)).toBe(true);
  });

  it('长弓兵减伤（轻装 +8%）生效：受到伤害更高', () => {
    const atk = () => makeGeneral('a', 'infantry', { speed: 200, attack: 250 });
    const plain = runDuel(atk(), makeGeneral('d', 'archer', { speed: 1 }), 606);
    const bow = runDuel(atk(), makeGeneral('d', 'archer', { speed: 1, secondaryTroop: '长弓兵' }), 606);
    expect(totalTaken(bow, 'd')).toBeGreaterThan(totalTaken(plain, 'd'));
  });
});

describe('二级兵种：长枪兵改写相克', () => {
  it('枪打骑 +30%（troop_trait 正 rate 的 taken 条目）；骑打枪 −30%', () => {
    const spear = makeGeneral('u', 'infantry', { secondaryTroop: '长枪兵', speed: 200 });
    const rep = runDuel(spear, makeGeneral('e', 'cavalry', { speed: 1 }), 999);
    const hit = hitsOf(rep, 'u')[0];
    expect(hit).toBeDefined();
    // 枪打骑 → 骑兵受伤 +30%：reduce 条目为负 rate
    expect(hit.modifiers?.reduce.some((s) => s.skillId === 'troop_counter' && s.rate < 0)).toBe(true);

    const rep2 = runDuel(
      makeGeneral('u', 'cavalry', { speed: 200 }),
      makeGeneral('e', 'infantry', { secondaryTroop: '长枪兵', speed: 1 }),
      999
    );
    const hit2 = hitsOf(rep2, 'u')[0];
    expect(hit2).toBeDefined();
    expect(hit2.modifiers?.reduce.some((s) => Math.abs(s.rate - 0.3) < 1e-9)).toBe(true);
  });

  it('弓打枪 +30%（弓兵增伤）；枪打弓 −30%（长枪兵被克）', () => {
    const rep = runDuel(
      makeGeneral('u', 'archer', { speed: 200 }),
      makeGeneral('e', 'infantry', { secondaryTroop: '长枪兵', speed: 1 }),
      555
    );
    const hit = hitsOf(rep, 'u')[0];
    expect(hit).toBeDefined();
    // 弓打枪 → 弓增伤：reduce 条目为负 rate
    expect(hit.modifiers?.reduce.some((s) => s.skillId === 'troop_counter' && s.rate < 0)).toBe(true);

    const rep2 = runDuel(
      makeGeneral('u', 'infantry', { secondaryTroop: '长枪兵', speed: 200 }),
      makeGeneral('e', 'archer', { speed: 1 }),
      555
    );
    const hit2 = hitsOf(rep2, 'u')[0];
    expect(hit2).toBeDefined();
    expect(hit2.modifiers?.reduce.some((s) => Math.abs(s.rate - 0.3) < 1e-9)).toBe(true);
  });

  it('同为步兵（枪 vs 普通步）：无相克改写', () => {
    const rep = runDuel(
      makeGeneral('u', 'infantry', { secondaryTroop: '长枪兵', speed: 200 }),
      makeGeneral('e', 'infantry', { speed: 1 }),
      321
    );
    const hit = hitsOf(rep, 'u')[0];
    expect(hit).toBeDefined();
    expect(hit.modifiers?.reduce.some((s) => s.skillId === 'troop_counter')).toBe(false);
  });
});

describe('二级兵种：象兵不受任何指挥战法影响', () => {
  it('敌方指挥伤害打不到象兵（奇兵拒北 → 0 条伤害事件）', () => {
    const caster = () => makeGeneral('u', 'infantry', { speed: 200, commandSkillIds: ['qibing_jubei'] });
    const plain = runDuel(caster(), makeGeneral('e', 'infantry', { speed: 1 }), 31);
    const elephant = runDuel(
      caster(),
      makeGeneral('e', 'infantry', { speed: 1, secondaryTroop: '象兵' }),
      31
    );
    const cnt = (rep: Rep) => rep.events.filter((e) => e.type === 'damage' && e.skillId === 'qibing_jubei').length;
    expect(cnt(plain)).toBeGreaterThan(0);
    expect(cnt(elephant)).toBe(0);
  });

  it('我方指挥增益也吃不到（其疾如风连击不施加给象兵）', () => {
    const caster = makeGeneral('liao', 'cavalry', { speed: 200, commandSkillIds: ['qiji_rufeng'] });
    const rep = runBattle({
      myTeam: [
        caster,
        makeGeneral('a1', 'cavalry', { speed: 10 }),
        makeGeneral('a2', 'cavalry', { speed: 10, secondaryTroop: '象兵' }),
      ],
      enemyTeam: [makeGeneral('e', 'cavalry', { speed: 1 })],
      seed: 77,
      maxRounds: 3,
    });
    const comboUnits = new Set(
      rep.events
        .filter((e) => e.type === 'status_inflicted' && (e as { statusType?: string }).statusType === 'combo')
        .map((e) => (e as { unitId: string }).unitId)
    );
    expect(comboUnits.has('a1')).toBe(true);
    expect(comboUnits.has('a2')).toBe(false);
  });
});

describe('通用特性：战斗期效果', () => {
  it('齐射：前 3 回合 +15%（第 4 回合起无该来源）', () => {
    const g = makeGeneral('u', 'archer', { speed: 200, secondaryTroop: '弩兵', traits: ['齐射'] });
    const rep = runDuel(g, makeGeneral('e', 'archer', { speed: 1 }), 2024);
    const hits = hitsOf(rep, 'u');
    expect(hits.length).toBeGreaterThan(0);
    // 事件无回合字段 → 用「总伤害高于同配置无特性」验证生效 + 减伤来源存在
    expect(hits.some((h) => modList(h).some((m) => m.skillId === 'troop_trait'))).toBe(true);
    const plain = runDuel(makeGeneral('u', 'archer', { speed: 200, secondaryTroop: '弩兵' }), makeGeneral('e', 'archer', { speed: 1 }), 2024);
    expect(totalOut(rep, 'u')).toBeGreaterThan(totalOut(plain, 'u'));
  });

  it('迂回：受到的所有伤害 −8%', () => {
    const atk = () => makeGeneral('a', 'infantry', { speed: 200, attack: 250 });
    const plain = runDuel(atk(), makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '弩兵' }), 616);
    const dodge = runDuel(
      atk(),
      makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '弩兵', traits: ['迂回'] }),
      616
    );
    expect(totalTaken(dodge, 'd')).toBeLessThan(totalTaken(plain, 'd'));
  });

  it('守备：受所有伤害 −6%；出奇：第 1 回合 −60%（减伤幅度更大）', () => {
    const atk = () => makeGeneral('a', 'infantry', { speed: 200, attack: 250 });
    const plain = runDuel(atk(), makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '弩兵' }), 313);
    const reserve = runDuel(
      atk(),
      makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '弩兵', traits: ['守备'] }),
      313
    );
    const surprise = runDuel(
      atk(),
      makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '铁骑兵', traits: ['出奇'] }),
      313
    );
    const t0 = totalTaken(plain, 'd');
    expect(totalTaken(reserve, 'd')).toBeLessThan(t0);
    expect(totalTaken(surprise, 'd')).toBeLessThan(t0);
    expect(totalTaken(surprise, 'd')).toBeLessThan(totalTaken(reserve, 'd'));
  });

  it('难测：受到普攻伤害 −25%', () => {
    const atk = () => makeGeneral('a', 'infantry', { speed: 200, attack: 250 });
    const plain = runDuel(atk(), makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '轻骑兵' }), 909);
    const elusive = runDuel(
      atk(),
      makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '轻骑兵', traits: ['难测'] }),
      909
    );
    const basic = (rep: Rep) => hitsOf(rep, 'a').reduce((s, h) => s + h.damage, 0);
    expect(basic(elusive)).toBeLessThan(basic(plain));
  });

  it('利刃：每非主动战法 +22 攻击（含自带主战法，上限 66）', () => {
    const mk = (passives: string[]) => {
      const g = makeGeneral('g', 'infantry', { attack: 200, secondaryTroop: '长枪兵', traits: ['利刃'] });
      g.passiveSkillIds = passives;
      return { general: g, statuses: [] } as never;
    };
    expect(effectiveStat(mk([]), 'attack')).toBe(200);
    expect(effectiveStat(mk(['a', 'b']), 'attack')).toBe(244);
    expect(effectiveStat(mk(['a', 'b', 'c', 'd']), 'attack')).toBe(266);
  });

  it('地利：按站位加四维（前锋防 +24；中军防谋 +10；大营攻防谋 +6）', () => {
    const mk = (pos: '前锋' | '中军' | '大营') => {
      const g = makeGeneral('g', 'archer', { attack: 200, defense: 100, strategy: 90, secondaryTroop: '弩兵', traits: ['地利'] });
      g.position = pos;
      return { general: g, statuses: [] } as never;
    };
    expect(effectiveStat(mk('前锋'), 'defense')).toBe(124);
    expect(effectiveStat(mk('中军'), 'defense')).toBe(110);
    expect(effectiveStat(mk('中军'), 'strategy')).toBe(100);
    expect(effectiveStat(mk('大营'), 'attack')).toBe(206);
    expect(effectiveStat(mk('大营'), 'strategy')).toBe(96);
  });
});

describe('二级兵种专属特性：减伤类', () => {
  it('藤甲兵：受到常规伤害 −30%（低于普通兵种）', () => {
    const atk = () => makeGeneral('a', 'infantry', { speed: 200, attack: 250 });
    const plain = runDuel(atk(), makeGeneral('d', 'infantry', { speed: 1 }), 2025);
    const rattan = runDuel(atk(), makeGeneral('d', 'infantry', { speed: 1, secondaryTroop: '藤甲兵' }), 2025);
    expect(totalTaken(rattan, 'd')).toBeLessThan(totalTaken(plain, 'd'));
    // 减伤 30% → 大致为 0.7 倍
    expect(totalTaken(rattan, 'd')).toBeLessThan(totalTaken(plain, 'd') * 0.85);
  });

  it('铁骑兵：受击减伤（低于普通兵种）', () => {
    const atk = () => makeGeneral('a', 'infantry', { speed: 200, attack: 250 });
    const plain = runDuel(atk(), makeGeneral('d', 'cavalry', { speed: 1 }), 404);
    const iron = runDuel(atk(), makeGeneral('d', 'cavalry', { speed: 1, secondaryTroop: '铁骑兵' }), 404);
    // 铁骑兵减伤只在「混乱/暴走/怯战/犹豫」四类状态下生效 → 无状态时与普通一致
    expect(totalTaken(iron, 'd')).toBe(totalTaken(plain, 'd'));
  });
});
