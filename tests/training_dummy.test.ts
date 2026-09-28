/**
 * 木桩（`BattleConfig.inertSides`）——L2 伤害期望测评的「不还手靶子」。
 * ---------------------------------------------------------------------------
 * 用户口径（2026-09-28）：敌方目标仅为**不还手的木桩**，不释放战法、也不普攻；
 * 但**我方打在木桩身上的 DoT / 延迟伤害必须照常结算**（否则测不出自己的持续伤害与道行险阻这类段）。
 * 因此出口放在 `actUnit` 里「混乱」那一处：被动 / 指挥 / DoT / 「目标下次行动前」延迟伤害都已结算完，
 * 只封「主动战法 + 普攻 + 追击」。
 */
import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleConfig, BattleEvent, General } from '../src/engine/types';

function general(partial: Partial<General>): General {
  return {
    id: partial.id ?? 'g',
    name: partial.name ?? '无名武将',
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: partial.troopType ?? 'infantry',
    position: partial.position ?? '前锋',
    attack: partial.attack ?? 200,
    defense: partial.defense ?? 100,
    strategy: partial.strategy ?? 100,
    speed: partial.speed ?? 60,
    attackRange: partial.attackRange ?? 2,
    maxTroops: partial.maxTroops ?? 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: partial.activeSkillIds ?? [],
    passiveSkillIds: partial.passiveSkillIds ?? [],
    commandSkillIds: partial.commandSkillIds ?? [],
    pursuitSkillIds: partial.pursuitSkillIds ?? [],
    morale: partial.morale ?? 120,
  };
}

/** 木桩靶子：三只（大营/中军/前锋），无战法 */
function dummies(troops = 30000): General[] {
  return (['大营', '中军', '前锋'] as const).map((position, i) =>
    general({ id: `dummy-${i}`, name: '木桩', position, attack: 100, defense: 150, strategy: 100, speed: 50, maxTroops: troops })
  );
}

/** 我方：一只带战法的打手 */
function attacker(active: string[] = []): General[] {
  return [general({ id: 'me-0', name: '打手', position: '前锋', activeSkillIds: active })];
}

const run = (my: General[], enemy: General[], extra: Partial<BattleConfig> = {}): BattleConfig & { myTeam: General[]; enemyTeam: General[] } => ({
  myTeam: my,
  enemyTeam: enemy,
  seed: 20260928,
  maxRounds: 8,
  ...extra,
});

const damageFrom = (events: BattleEvent[], ids: Set<string>): number => {
  let sum = 0;
  for (const ev of events) {
    if (ev.type === 'attack_hit' && ids.has(ev.sourceId)) sum += ev.damage;
    else if (ev.type === 'damage' && ids.has(ev.creditToId ?? ev.sourceId)) sum += ev.damage;
    else if (ev.type === 'split_damage' && ids.has(ev.creditToId ?? ev.sourceId)) sum += ev.damage;
    else if (ev.type === 'dot_tick' && ids.has(ev.casterId)) sum += ev.damage;
  }
  return sum;
};

describe('木桩：不还手（不普攻 / 不发动战法）', () => {
  it('inertSides=["enemy"]：木桩不产生任何伤害事件，我方兵力零损失', () => {
    const my = attacker(['tujin']);
    const foe = dummies();
    const report = runBattle(run(my, foe, { inertSides: ['enemy'] }) as BattleConfig);
    const foeIds = new Set(foe.map((g) => g.id));
    expect(damageFrom(report.events, foeIds)).toBe(0);
    expect(report.events.some((e) => e.type === 'skill_cast' && foeIds.has(e.unitId))).toBe(false);
    expect(report.finalMyTroops[0]).toBe(my[0].maxTroops);
    expect(report.finalEnemyTroops.reduce((a, b) => a + b, 0)).toBeLessThan(
      foe.reduce((a, g) => a + g.maxTroops, 0)
    );
  });

  it('不传 inertSides：木桩照常普攻（默认行为一字未改）', () => {
    const my = attacker();
    const foe = dummies();
    const report = runBattle(run(my, foe) as BattleConfig);
    const foeIds = new Set(foe.map((g) => g.id));
    expect(damageFrom(report.events, foeIds)).toBeGreaterThan(0);
    expect(report.finalMyTroops[0]).toBeLessThan(my[0].maxTroops);
  });

  it('木桩行动出口可识别：事件流带「木桩：不还手」原因', () => {
    const report = runBattle(run(attacker(), dummies(), { inertSides: ['enemy'] }) as BattleConfig);
    const inert = report.events.filter(
      (e) => e.type === 'no_attack_target' && typeof e.reason === 'string' && e.reason.includes('木桩')
    );
    expect(inert.length).toBeGreaterThan(0);
  });

  it('我方 DoT 打在木桩身上照常跳（出口在 DoT 之后，不会被木桩不还手吃掉）', () => {
    // 焰焚箕轸：施加「燃烧」DoT（rate 段）—— 木桩不动也必须照常结算每回合跳伤
    const my = attacker(['yanfen_jizhen']);
    const foe = dummies();
    const myIds = new Set(my.map((g) => g.id));
    let ticks = 0;
    let dotDamage = 0;
    for (let i = 0; i < 12 && ticks === 0; i += 1) {
      const report = runBattle({ ...run(my, foe, { inertSides: ['enemy'] }), seed: 20260928 + i } as BattleConfig);
      for (const ev of report.events) {
        if (ev.type === 'dot_tick' && myIds.has(ev.casterId)) {
          ticks += 1;
          dotDamage += ev.damage;
        }
      }
    }
    expect(ticks, '12 颗种子里应至少跳出一次我方 DoT').toBeGreaterThan(0);
    expect(dotDamage).toBeGreaterThan(0);
  });

  it('木桩兵力即伤害上限：兵力压小 → 我方伤害被截断（故测评要把兵力给足）', () => {
    const my = attacker(['tujin']);
    const myIds = new Set(my.map((g) => g.id));
    const small = dummies(500);
    const big = dummies(30000);
    const smallDamage = damageFrom(runBattle(run(my, small, { inertSides: ['enemy'] }) as BattleConfig).events, myIds);
    const bigDamage = damageFrom(runBattle(run(my, big, { inertSides: ['enemy'] }) as BattleConfig).events, myIds);
    // 打空即止：小兵力靶子的伤害被兵力截断，给足兵力的靶子才能测出真实输出
    expect(smallDamage).toBeLessThanOrEqual(small.reduce((a, g) => a + g.maxTroops, 0));
    expect(smallDamage).toBeLessThan(bigDamage);
  });
});
