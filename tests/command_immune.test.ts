/**
 * 指挥免疫（象兵「野性」/ 藤甲突击 `commandImmune`）—— 用户 2026-10-27 报障后的口径：
 *
 * 「凡是指挥类型的效果都无法对免疫指挥目标生效」—— 不只是战必 / 反计那类控制状态：
 *   · 指挥战法的**伤害**（二类指挥的站位伤害、一类指挥的预存延迟伤害）
 *   · 指挥战法的 **DoT**（匠心不竭的恐慌 / 燃烧 / 妖术）
 *   · 指挥战法衍生的**相邻溅射**（其徐如林〈诛杀〉）
 * 全部对免疫目标无效；**允许被选中**（`skill_target` 照常列出目标），但不产生任何实际效果。
 *
 * 两个免疫来源口径不同（别混）：
 *   · 象兵「野性」= 不受**任何**指挥战法影响，敌我双向（我方指挥增益也吃不到）；
 *   · 藤甲突击 `commandImmune` = 只写「不受**敌方**指挥战法的影响」，友方指挥照常生效。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { initHeroDB } from '../src/data/heroes';
import type { BattleEvent, General, TroopType } from '../src/engine/types';
import type { SecondaryTroopType } from '../src/engine/secondaryTroop';

beforeAll(async () => {
  await initHeroDB();
});

type Rep = ReturnType<typeof runBattle>;
type DmgEvent = Extract<BattleEvent, { type: 'damage' }>;
type DotEvent = Extract<BattleEvent, { type: 'dot_tick' }>;
type StatusEvent = Extract<BattleEvent, { type: 'status_inflicted' }>;

function makeGeneral(
  id: string,
  troopType: TroopType,
  opts: {
    attack?: number;
    defense?: number;
    strategy?: number;
    speed?: number;
    attackRange?: number;
    secondaryTroop?: SecondaryTroopType;
    passiveSkillIds?: string[];
    commandSkillIds?: string[];
    activeSkillIds?: string[];
    position?: '大营' | '中军' | '前锋';
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
    position: opts.position ?? '大营',
    attack: opts.attack ?? 120,
    defense: opts.defense ?? 120,
    strategy: opts.strategy ?? 150,
    speed: opts.speed ?? 100,
    attackRange: opts.attackRange ?? 3,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: opts.activeSkillIds ?? [],
    passiveSkillIds: opts.passiveSkillIds ?? [],
    commandSkillIds: opts.commandSkillIds ?? [],
    pursuitSkillIds: [],
    morale: 100,
    secondaryTroop: opts.secondaryTroop,
  };
}

/** 藤甲突击（兀突骨主战法）＝ `commandImmune` 的唯一数据来源 */
const TENGJIA = 'tengjia_tuji';

const run = (myTeam: General[], enemyTeam: General[], seed = 31) =>
  runBattle({ myTeam, enemyTeam, seed, maxRounds: 8 });

const dmgOn = (rep: Rep, unitId: string, skillId?: string): DmgEvent[] =>
  rep.events.filter(
    (e): e is DmgEvent =>
      e.type === 'damage' && e.targetId === unitId && (skillId == null || e.skillId === skillId)
  );
const dotOn = (rep: Rep, unitId: string): DotEvent[] =>
  rep.events.filter((e): e is DotEvent => e.type === 'dot_tick' && e.targetId === unitId);
const statusOn = (rep: Rep, unitId: string, type: string): StatusEvent[] =>
  rep.events.filter(
    (e): e is StatusEvent => e.type === 'status_inflicted' && e.unitId === unitId && e.statusType === type
  );
const blockedOn = (rep: Rep, unitId: string, skillId?: string) =>
  rep.events.filter(
    (e) =>
      e.type === 'command_immune_blocked' && e.unitId === unitId && (skillId == null || e.skillId === skillId)
  );

describe('指挥免疫 · 二类指挥的伤害（魏延 奇兵拒北）', () => {
  const attacker = () => makeGeneral('u', 'infantry', { speed: 200, commandSkillIds: ['qibing_jubei'] });

  it('藤甲突击：敌方指挥的站位伤害 0 条，且战报记「免疫」', () => {
    const plain = run([attacker()], [makeGeneral('e', 'infantry', { speed: 1 })]);
    const immune = run([attacker()], [makeGeneral('e', 'infantry', { speed: 1, passiveSkillIds: [TENGJIA] })]);

    expect(dmgOn(plain, 'e', 'qibing_jubei').length).toBeGreaterThan(0);
    expect(dmgOn(immune, 'e', 'qibing_jubei').length).toBe(0);
    expect(blockedOn(immune, 'e', 'qibing_jubei').length).toBeGreaterThan(0);
  });

  it('象兵：同样 0 条（野性口径，既有行为回归）', () => {
    const immune = run([
      attacker(),
    ], [makeGeneral('e', 'infantry', { speed: 1, secondaryTroop: '象兵' })]);
    expect(dmgOn(immune, 'e', 'qibing_jubei').length).toBe(0);
  });
});

describe('指挥免疫 · 一类指挥的预存延迟伤害（吕蒙 白衣渡江）', () => {
  const caster = () => makeGeneral('u', 'infantry', { speed: 200, strategy: 200, commandSkillIds: ['baiyi_dujiang'] });

  it('藤甲突击：第 3 回合的预存伤害不打出来，只留「效果消失」', () => {
    const plain = run([caster()], [makeGeneral('e', 'infantry', { speed: 1 })]);
    const immune = run([caster()], [makeGeneral('e', 'infantry', { speed: 1, passiveSkillIds: [TENGJIA] })]);

    expect(dmgOn(plain, 'e', 'baiyi_dujiang').length).toBeGreaterThan(0);
    expect(dmgOn(immune, 'e', 'baiyi_dujiang').length).toBe(0);
    expect(immune.events.some((e) => e.type === 'stored_effect_expired' && e.unitId === 'e')).toBe(true);
  });

  it('象兵：同样打不出来', () => {
    const immune = run([caster()], [makeGeneral('e', 'infantry', { speed: 1, secondaryTroop: '象兵' })]);
    expect(dmgOn(immune, 'e', 'baiyi_dujiang').length).toBe(0);
  });
});

describe('指挥免疫 · 指挥 DoT（黄月英 匠心不竭）', () => {
  const caster = () => makeGeneral('u', 'infantry', { speed: 200, strategy: 200, commandSkillIds: ['jiangxin_bujie'] });

  it('藤甲突击：恐慌不施加、也没有跳伤；目标仍出现在 skill_target 里（可选中、无效果）', () => {
    const plain = run([caster()], [makeGeneral('e', 'infantry', { speed: 1 })]);
    const immune = run([caster()], [makeGeneral('e', 'infantry', { speed: 1, passiveSkillIds: [TENGJIA] })]);

    expect(statusOn(plain, 'e', 'panic').length).toBeGreaterThan(0);
    expect(dotOn(plain, 'e').length).toBeGreaterThan(0);

    expect(statusOn(immune, 'e', 'panic').length).toBe(0);
    expect(dotOn(immune, 'e').length).toBe(0);

    const targeted = immune.events.some(
      (e) => e.type === 'skill_target' && e.skillId === 'jiangxin_bujie' && e.targetIds.includes('e')
    );
    expect(targeted).toBe(true);
  });

  it('象兵：恐慌同样不施加、无跳伤', () => {
    const immune = run([caster()], [makeGeneral('e', 'infantry', { speed: 1, secondaryTroop: '象兵' })]);
    expect(statusOn(immune, 'e', 'panic').length).toBe(0);
    expect(dotOn(immune, 'e').length).toBe(0);
  });
});

describe('指挥免疫 · 指挥衍生的相邻溅射（XP司马懿 其徐如林〈诛杀〉）', () => {
  // 我方：司马懿（其徐如林 · 指挥光环）+ 黄月英（匠心不竭 · 指挥 DoT 提供策略伤害源）
  const myTeam = () => [
    makeGeneral('simayi', 'infantry', { speed: 190, strategy: 200, commandSkillIds: ['qixu_rulin'] }),
    makeGeneral('huangyueying', 'infantry', { speed: 180, strategy: 200, commandSkillIds: ['jiangxin_bujie'] }),
  ];
  type Slot = '前锋' | '中军' | '大营';
  const SLOT_ID: Record<Slot, string> = { 前锋: 'front', 中军: 'mid', 大营: 'back' };

  /** 敌方三人阵，可指定某一位挂上指挥免疫（藤甲突击 / 象兵） */
  const enemyTeam = (immune?: { slot: Slot; kind: 'tengjia' | 'elephant' }) =>
    (['前锋', '中军', '大营'] as Slot[]).map((pos) => {
      const hit = !!immune && immune.slot === pos;
      return makeGeneral(SLOT_ID[pos], 'infantry', {
        speed: 1,
        position: pos,
        passiveSkillIds: hit && immune!.kind === 'tengjia' ? [TENGJIA] : [],
        secondaryTroop: hit && immune!.kind === 'elephant' ? '象兵' : undefined,
      });
    });

  const zhushaOn = (rep: Rep, unitId: string) =>
    rep.events.filter((e): e is DmgEvent => e.type === 'damage' && e.subSkill === '诛杀' && e.targetId === unitId);

  it('基线：〈诛杀〉确实会溅射到相邻单位', () => {
    const plain = run(myTeam(), enemyTeam());
    // 中军吃 DoT 时相邻的锋/营被溅射；锋吃 DoT 时中军被溅射
    expect(zhushaOn(plain, 'front').length).toBeGreaterThan(0);
    expect(zhushaOn(plain, 'mid').length).toBeGreaterThan(0);
  });

  it('藤甲突击挂前锋：自己吃到 0 条〈诛杀〉，与之相邻的中军吃 DoT 后仍把溅射打到普通的大营', () => {
    const immune = run(myTeam(), enemyTeam({ slot: '前锋', kind: 'tengjia' }));
    expect(zhushaOn(immune, 'front').length).toBe(0);
    // 免疫只挡自己那一条，光环本身没被整条关掉
    expect(zhushaOn(immune, 'back').length).toBeGreaterThan(0);
    expect(blockedOn(immune, 'front').length).toBeGreaterThan(0);
  });

  it('藤甲突击挂中军：〈诛杀〉对相邻的免疫目标 0 条', () => {
    const immune = run(myTeam(), enemyTeam({ slot: '中军', kind: 'tengjia' }));
    expect(zhushaOn(immune, 'mid').length).toBe(0);
  });

  it('象兵挂中军：〈诛杀〉同样 0 条', () => {
    const immune = run(myTeam(), enemyTeam({ slot: '中军', kind: 'elephant' }));
    expect(zhushaOn(immune, 'mid').length).toBe(0);
  });
});

describe('指挥免疫 · 状态类（战必断金）回归', () => {
  it('藤甲突击：怯战不施加，战报记「免疫」', () => {
    const caster = () => makeGeneral('u', 'infantry', { speed: 200, commandSkillIds: ['zhanbi_duanjin'] });
    const plain = run([caster()], [makeGeneral('e', 'infantry', { speed: 1 })]);
    const immune = run([caster()], [makeGeneral('e', 'infantry', { speed: 1, passiveSkillIds: [TENGJIA] })]);

    expect(statusOn(plain, 'e', 'cowardice').length).toBeGreaterThan(0);
    expect(statusOn(immune, 'e', 'cowardice').length).toBe(0);
    expect(blockedOn(immune, 'e', 'zhanbi_duanjin').length).toBeGreaterThan(0);
  });
});

describe('指挥免疫 · 覆盖范围（别把「敌方指挥」扩成「所有指挥」）', () => {
  it('藤甲突击：友方指挥的增益照常生效（其疾如风的速度 +41 落在持有者身上）', () => {
    const rep = run(
      [
        makeGeneral('liao', 'cavalry', { speed: 200, strategy: 150, commandSkillIds: ['qiji_rufeng'] }),
        makeGeneral('wutugu', 'infantry', { speed: 100, passiveSkillIds: [TENGJIA], position: '中军' }),
      ],
      [makeGeneral('e', 'cavalry', { speed: 1 })]
    );
    expect(statusOn(rep, 'wutugu', 'speed_buff').length).toBeGreaterThan(0);
  });

  it('象兵：友方指挥的增益照样吃不到（野性双向，既有口径回归）', () => {
    const rep = run(
      [
        makeGeneral('liao', 'cavalry', { speed: 200, strategy: 150, commandSkillIds: ['qiji_rufeng'] }),
        makeGeneral('eleph', 'cavalry', { speed: 100, secondaryTroop: '象兵', position: '中军' }),
      ],
      [makeGeneral('e', 'cavalry', { speed: 1 })]
    );
    expect(statusOn(rep, 'eleph', 'speed_buff').length).toBe(0);
  });
});
