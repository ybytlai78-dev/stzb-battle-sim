import { describe, it, expect } from 'vitest';
import type { General } from '../src/engine/types';
import { computeTroopBonuses, ZERO_BONUS } from '../src/engine/troopBonus';
import { inflictStatus, effectiveStat } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { CreateStatus, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { runBattle } from '../src/engine/combat';
import { reportToText } from '../src/engine/report';

function g(partial: Partial<General> & Pick<General, 'id' | 'faction' | 'troopType' | 'position'>): General {
  return {
    name: partial.name ?? partial.id,
    rarity: '5星',
    cost: 3,
    tags: [],
    mutualExclusionGroup: null,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 100,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...partial,
  };
}

describe('computeTroopBonuses', () => {
  it('三同阵营：四人维各 +10%（round）', () => {
    const team = [
      g({ id: 'a', faction: '吴', troopType: 'archer', position: '大营', attack: 200, defense: 150, strategy: 180, speed: 120 }),
      g({ id: 'b', faction: '吴', troopType: 'infantry', position: '中军', attack: 200, defense: 150, strategy: 180, speed: 120 }),
      g({ id: 'c', faction: '吴', troopType: 'cavalry', position: '前锋', attack: 200, defense: 150, strategy: 180, speed: 120 }),
    ];
    const r = computeTroopBonuses(team);
    for (const id of ['a', 'b', 'c']) {
      const line = r.lines.find((l) => l.unitId === id && l.category === 'faction');
      expect(line?.bonuses).toEqual({ attack: 20, defense: 15, strategy: 18, speed: 12 });
      expect(r.byUnit.get(id)?.attack).toBeGreaterThanOrEqual(20);
    }
  });

  it('两同阵营 + 一异阵营：仅前两人阵营 8%，第三人无阵营 line', () => {
    const team = [
      g({ id: 'wei1', faction: '魏', troopType: 'infantry', position: '大营' }),
      g({ id: 'wei2', faction: '魏', troopType: 'infantry', position: '中军' }),
      g({ id: 'wu', faction: '吴', troopType: 'archer', position: '前锋' }),
    ];
    const r = computeTroopBonuses(team);
    expect(r.lines.filter((l) => l.category === 'faction' && l.unitId === 'wei1')[0].bonuses.attack).toBe(8);
    expect(r.lines.filter((l) => l.category === 'faction' && l.unitId === 'wu')).toHaveLength(0);
  });

  it('三同骑：仅攻/速 10%，防御谋略无兵种项', () => {
    const team = [
      g({ id: 'a', faction: '群', troopType: 'cavalry', position: '大营', attack: 200, speed: 100, defense: 150, strategy: 80 }),
      g({ id: 'b', faction: '蜀', troopType: 'cavalry', position: '中军', attack: 200, speed: 100, defense: 150, strategy: 80 }),
      g({ id: 'c', faction: '吴', troopType: 'cavalry', position: '前锋', attack: 200, speed: 100, defense: 150, strategy: 80 }),
    ];
    const r = computeTroopBonuses(team);
    const troop = r.lines.filter((l) => l.category === 'troop');
    expect(troop).toHaveLength(3);
    expect(troop[0].bonuses).toEqual({ attack: 20, defense: 0, strategy: 0, speed: 10 });
  });

  it('两骑一步：仅两骑 5% 攻/速', () => {
    const team = [
      g({ id: 'c1', faction: '魏', troopType: 'cavalry', position: '大营', attack: 200, speed: 100 }),
      g({ id: 'c2', faction: '蜀', troopType: 'cavalry', position: '中军', attack: 200, speed: 100 }),
      g({ id: 'inf', faction: '吴', troopType: 'infantry', position: '前锋', attack: 200, speed: 100 }),
    ];
    const r = computeTroopBonuses(team);
    const troopIds = r.lines.filter((l) => l.category === 'troop').map((l) => l.unitId);
    expect(troopIds.sort()).toEqual(['c1', 'c2']);
    expect(r.lines.find((l) => l.category === 'troop' && l.unitId === 'c1')?.bonuses.attack).toBe(10);
  });

  it('攻击 205 三吴三骑：阵营 21 + 兵种 21 = 42', () => {
    const team = ['大营', '中军', '前锋'].map((position, i) =>
      g({
        id: `w${i}`,
        faction: '吴',
        troopType: 'cavalry',
        position: position as General['position'],
        attack: 205,
        defense: 100,
        strategy: 100,
        speed: 100,
      })
    );
    const r = computeTroopBonuses(team);
    expect(r.byUnit.get('w0')?.attack).toBe(42);
    const lines = r.lines.filter((l) => l.unitId === 'w0' && (l.category === 'faction' || l.category === 'troop'));
    expect(lines.map((l) => l.bonuses.attack).sort()).toEqual([21, 21]);
  });

  it('魏之智三将全队谋略+32；缺一人无称号', () => {
    const members = [
      g({ id: 'h24', name: '荀彧', faction: '魏', troopType: 'cavalry', position: '大营' }),
      g({ id: 'h476', name: '郭嘉', faction: '魏', troopType: 'cavalry', position: '中军' }),
      g({ id: 'h618', name: '贾诩', faction: '魏', troopType: 'archer', position: '前锋' }),
    ];
    const ok = computeTroopBonuses(members);
    const titles = ok.lines.filter((l) => l.category === 'title');
    expect(titles).toHaveLength(3);
    expect(titles.every((l) => l.titleId === 'wei_zhi_zhi' && l.bonuses.strategy === 32)).toBe(true);
    const miss = computeTroopBonuses([members[0], members[1], g({ id: 'x', faction: '魏', troopType: 'infantry', position: '前锋' })]);
    expect(miss.lines.filter((l) => l.category === 'title')).toHaveLength(0);
  });

  it('空队：byUnit 空、lines 空', () => {
    const r = computeTroopBonuses([]);
    expect(r.lines).toEqual([]);
    expect(r.byUnit.size).toBe(0);
    expect(ZERO_BONUS).toEqual({ attack: 0, defense: 0, strategy: 0, speed: 0 });
  });
});

function makeUnit(id: string, stats: Partial<Pick<General, 'attack' | 'defense' | 'strategy' | 'speed'>> = {}): UnitState {
  return {
    general: g({ id, faction: '吴', troopType: 'cavalry', position: '前锋', ...stats }),
    side: 'my',
    troops: 9000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(1),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

describe('effectiveStat + formationBonus', () => {
  it('无 formationBonus 时与旧行为一致（面板 200）', () => {
    const u = makeUnit('a', { attack: 200 });
    expect(effectiveStat(u, 'attack')).toBe(200);
  });

  it('部队加成先落地，魏武之世 -15% 打在加成后', () => {
    const ctx = makeCtx();
    const u = makeUnit('a', { attack: 205 });
    u.formationBonus = { attack: 42, defense: 0, strategy: 0, speed: 0 };
    expect(effectiveStat(u, 'attack')).toBe(247);
    const debuff: CreateStatus = { type: 'attack_buff', amount: -15, percent: true, duration: 999 };
    inflictStatus(ctx, u, debuff, 'command', 'weiwu_zhishi');
    // (205+42)=247；247×15%=37.05 → 37；247-37=210
    expect(effectiveStat(u, 'attack')).toBe(210);
  });
});

describe('runBattle 部队加成', () => {
  it('准备事件顺序：阵容 → 兵种 → 战法', () => {
    const report = runBattle({
      myTeam: [
        g({ id: 'wu1', faction: '吴', troopType: 'cavalry', position: '前锋', speed: 100, attack: 100 }),
        g({ id: 'wu2', faction: '吴', troopType: 'cavalry', position: '中军', speed: 50, attack: 100 }),
        g({ id: 'wu3', faction: '吴', troopType: 'cavalry', position: '大营', speed: 40, attack: 100 }),
      ],
      enemyTeam: [
        g({ id: 'e1', faction: '群', troopType: 'infantry', position: '前锋', speed: 20 }),
        g({ id: 'e2', faction: '蜀', troopType: 'archer', position: '中军', speed: 19 }),
        g({ id: 'e3', faction: '汉', troopType: 'cavalry', position: '大营', speed: 18 }),
      ],
      seed: 1,
      maxRounds: 1,
    });
    const types = report.events.map((e) => (e.type === 'prep_phase' ? `prep:${e.phase}` : e.type));
    const iF = types.indexOf('prep:formation');
    const iT = types.indexOf('prep:troop');
    const iS = types.indexOf('prep:skill');
    expect(iF).toBeGreaterThan(-1);
    expect(iT).toBeGreaterThan(iF);
    expect(iS).toBeGreaterThan(iT);
    expect(report.events.some((e) => e.type === 'formation_bonus' && e.category === 'faction')).toBe(true);
  });

  it('加成后速度重排：面板更慢的三吴骑反超无加成的 105 速', () => {
    const report = runBattle({
      myTeam: [
        g({ id: 'slow-wu', faction: '吴', troopType: 'cavalry', position: '前锋', speed: 100, attack: 100 }),
        g({ id: 'wu-b', faction: '吴', troopType: 'cavalry', position: '中军', speed: 30, attack: 100 }),
        g({ id: 'wu-c', faction: '吴', troopType: 'cavalry', position: '大营', speed: 20, attack: 100 }),
      ],
      enemyTeam: [
        g({ id: 'fast-mixed', faction: '魏', troopType: 'infantry', position: '前锋', speed: 105, attack: 50 }),
        g({ id: 'e2', faction: '蜀', troopType: 'archer', position: '中军', speed: 10 }),
        g({ id: 'e3', faction: '汉', troopType: 'cavalry', position: '大营', speed: 10 }),
      ],
      seed: 1,
      maxRounds: 1,
    });
    const start = report.events.find((e) => e.type === 'battle_start');
    expect(start && start.type === 'battle_start' ? start.turnOrder[0] : '').toBe('slow-wu');
  });
});

describe('文本战报', () => {
  it('文本战报含【阵容】【兵种】【战法】与阵营加成行', () => {
    const report = runBattle({
      myTeam: [
        g({ id: 'a', name: '太史慈', faction: '吴', troopType: 'cavalry', position: '前锋', attack: 205, speed: 100 }),
        g({ id: 'b', name: '周瑜', faction: '吴', troopType: 'cavalry', position: '中军', attack: 205, speed: 90 }),
        g({ id: 'c', name: '孙权', faction: '吴', troopType: 'cavalry', position: '大营', attack: 205, speed: 80 }),
      ],
      enemyTeam: [
        g({ id: 'e1', faction: '群', troopType: 'infantry', position: '前锋', speed: 10 }),
        g({ id: 'e2', faction: '蜀', troopType: 'archer', position: '中军', speed: 10 }),
        g({ id: 'e3', faction: '汉', troopType: 'infantry', position: '大营', speed: 10 }),
      ],
      seed: 1,
      maxRounds: 1,
    });
    const text = reportToText(report);
    expect(text).toContain('【阵容】');
    expect(text).toContain('【兵种】');
    expect(text).toContain('【战法】');
    expect(text).toContain('暂无效果');
    expect(text).toMatch(/太史慈 阵营加成：/);
    expect(text).toContain('攻击+21');
  });
});
