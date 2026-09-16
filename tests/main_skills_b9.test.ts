/**
 * 批量9 主战法测试（v0.11）：难知如阴（法正）/ 黄天余音（张宁）
 * 新增引擎机制：主动发动率提升（trigger_boost）+ 属性吸取（inflict_status output targetSide/targetMode 覆盖）
 * 每战法 3 个测试：装配挂槽、机制（事件/状态/目标）、数值。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import { Rng } from '../src/engine/rng';
import { actUnit, triggerRoundCommandOnAct, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function hero(id: string): General {
  return { ...HERO_REGISTRY[id] };
}

function dummy(id: string, position: Position, troops = 10000): General {
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
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  };
}

function enemyTeam(): General[] {
  return [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];
}

/** 完整 3 人队：主将居中，含前锋/大营友军 */
function fullTeam(leader: General): General[] {
  return [leader, dummy('ally-front', '前锋'), dummy('ally-back', '大营')];
}

/**
 * 张宁固定谋略（覆盖 40 级面板），用于锁定吸取基值 / 成长。
 * @param strategy 生效谋略
 */
function zhangningAt(strategy: number): General {
  return withSkills(
    { ...level40(hero('h474'), { strategy: 0 }), position: '中军', strategy },
    { activeSkillIds: ['huangtian_yuyin'] }
  );
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({ seed, maxRounds, myTeam: team, enemyTeam: enemyTeam() });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const inflicted = (report: ReturnType<typeof run>, statusType: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'status_inflicted' }> =>
      e.type === 'status_inflicted' && e.statusType === statusType
  );

// ─── 确定性直构单元（对照 morale.test.ts）───

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
      faction: '吴',
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
    alive: true,
    wounded: 0,
    totalDead: 0,
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

describe('难知如阴（法正，二类指挥：每2回合友军主动发动率+120% + 跳过准备）', () => {
  it('主战法挂入指挥槽（法正），二类指挥每2回合', () => {
    const g = hero('h582');
    expect(g.name).toBe('法正');
    expect(g.commandSkillIds).toContain('nanzhi_ruyin');
    const s = SKILL_REGISTRY['nanzhi_ruyin'];
    expect(s.type === 'command' && s.phase === 'round').toBe(true);
    expect('everyNRounds' in s && s.everyNRounds === 2).toBe(true);
    const cmd = s as Extract<typeof s, { type: 'command' }>;
    expect(cmd.targetSide === 'ally').toBe(true);
  });

  it('每 2 回合（第 1/3/5...回合）对友军施加发动率提升 trigger_boost + 跳过准备 jump_prep', () => {
    const report = run(fullTeam(withSkills(level40(hero('h582'), { strategy: 99 }), { commandSkillIds: ['nanzhi_ruyin'] })), 1);
    // 第 1 回合即触发（每2回合），8 回合内至少触发 3 次（第 1/3/5 回合）
    expect(casts(report, '难知如阴').length).toBeGreaterThanOrEqual(3);
    // trigger_boost 施加在友军（法正自身或友军，非敌军）
    const boost = inflicted(report, 'trigger_boost');
    expect(boost.length).toBeGreaterThan(0);
    expect(boost.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
    // 跳过准备状态同样施加于友军
    const jump = inflicted(report, 'jump_prep');
    expect(jump.length).toBeGreaterThan(0);
    expect(jump.every((e) => !e.unitId.startsWith('enemy'))).toBe(true);
  });

  it('携带 trigger_boost 的友军主动战法发动率显著提升（35% → 77%，固定随机 0.37 从失败变成功）', () => {
    const boosted = makeUnit('f', { position: '前锋', activeSkillIds: ['jiangmen_hunv'] });
    boosted.statuses.push({ type: 'trigger_boost', rate: 1.2, remaining: 1, appliedRound: 1, sourceSkillType: 'command', sourceSkillId: 'nanzhi_ruyin' });
    const e1 = makeUnit('e1', { position: '前锋' });
    e1.side = 'enemy';
    const ctx = makeCtx(0.37);
    ctx.myTeam = [boosted];
    ctx.enemyTeam = [e1];
    actUnit(ctx, boosted);
    const cast = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast' && e.skillName === '将门虎女'
    );
    expect(cast.length).toBeGreaterThan(0); // 35%×2.2=77% > 0.37 → 触发

    // 对照：无 boost 时 35% < 0.37 → 不触发
    const plain = makeUnit('f2', { position: '前锋', activeSkillIds: ['jiangmen_hunv'] });
    const e2 = makeUnit('e2', { position: '前锋' });
    e2.side = 'enemy';
    const ctx2 = makeCtx(0.37);
    ctx2.myTeam = [plain];
    ctx2.enemyTeam = [e2];
    actUnit(ctx2, plain);
    const cast2 = ctx2.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_cast' }> => e.type === 'skill_cast' && e.skillName === '将门虎女'
    );
    expect(cast2.length).toBe(0);
  });
});

describe('黄天余音（张宁，主动：吸取敌军单体全属性 26 附加于自身与友军单体）', () => {
  it('主战法挂入主动槽（张宁），主动战法对敌单体', () => {
    const g = hero('h474');
    expect(g.name).toBe('张宁');
    expect(g.activeSkillIds).toContain('huangtian_yuyin');
    const s = SKILL_REGISTRY['huangtian_yuyin'];
    expect(s.type === 'active' && s.prepare === false).toBe(true);
    expect(s.triggerRate).toBe(1); // 用户确认：100% 发动
    const act = s as Extract<typeof s, { type: 'active' }>;
    expect(act.targetMode === 'random_single' && act.targetSide === 'enemy').toBe(true);
  });

  it('吸取敌军单体全属性（-26 减益）+ 附加自身与友军单体，目标池分离', () => {
    // 谋略 80：敌/自身为基值 26；先补给自身后再给队友 → 队友 26+0.20×26=31
    const report = run(fullTeam(zhangningAt(80)), 1);
    expect(casts(report, '黄天余音').length).toBeGreaterThan(0);
    const enemyDebuffs = inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy'));
    expect(enemyDebuffs.length).toBeGreaterThan(0);
    expect(enemyDebuffs.every((e) => e.detail.includes('降低了26('))).toBe(true);
    const selfBuffs = inflicted(report, 'attack_buff').filter((e) => e.unitId === 'h474');
    const allyBuffs = inflicted(report, 'attack_buff').filter((e) => !e.unitId.startsWith('enemy') && e.unitId !== 'h474');
    expect(selfBuffs.length).toBeGreaterThan(0);
    expect(selfBuffs.every((e) => e.detail.includes('提高了26('))).toBe(true);
    expect(allyBuffs.length).toBeGreaterThan(0);
    expect(allyBuffs.every((e) => e.detail.includes('提高了31('))).toBe(true);
  });

  it('吸取数值：谋略 80 时敌/自身 ±26、队友 31；仅持续 1 回合', () => {
    const report = run(fullTeam(zhangningAt(80)), 1);
    for (const st of ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff']) {
      const enemyAll = inflicted(report, st).filter((e) => e.unitId.startsWith('enemy'));
      expect(enemyAll.length).toBeGreaterThan(0);
      expect(enemyAll.every((e) => e.detail.includes('降低了26('))).toBe(true);
      const selfAll = inflicted(report, st).filter((e) => e.unitId === 'h474');
      expect(selfAll.length).toBeGreaterThan(0);
      expect(selfAll.every((e) => e.detail.includes('提高了26('))).toBe(true);
      const allyAll = inflicted(report, st).filter((e) => !e.unitId.startsWith('enemy') && e.unitId !== 'h474');
      expect(allyAll.length).toBeGreaterThan(0);
      expect(allyAll.every((e) => e.detail.includes('提高了31('))).toBe(true);
    }
  });

  it('吸取成长 0.20：谋略 283 时敌/自身 67，补给自身后再给队友 80', () => {
    const report = run(fullTeam(zhangningAt(283)), 1);
    const enemy = inflicted(report, 'attack_buff').filter((e) => e.unitId.startsWith('enemy'));
    const self = inflicted(report, 'attack_buff').filter((e) => e.unitId === 'h474');
    const ally = inflicted(report, 'attack_buff').filter((e) => !e.unitId.startsWith('enemy') && e.unitId !== 'h474');
    expect(enemy.every((e) => e.detail.includes('降低了67('))).toBe(true);
    expect(self.every((e) => e.detail.includes('提高了67('))).toBe(true);
    expect(ally.every((e) => e.detail.includes('提高了80('))).toBe(true);
  });

  it('只选两个目标：一个敌军吸四维、一个友军加四维（不含自身），多种子下不是最近锁死', () => {
    const STATS = ['attack_buff', 'defense_buff', 'strategy_buff', 'speed_buff'] as const;
    const allyIds = new Set<string>();
    const enemyIds = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const report = run(fullTeam(zhangningAt(80)), seed, 1);
      expect(casts(report, '黄天余音').length).toBeGreaterThan(0);
      const allySet = new Set<string>();
      const enemySet = new Set<string>();
      for (const st of STATS) {
        const evs = inflicted(report, st);
        const enemies = evs.filter((e) => e.unitId.startsWith('enemy')).map((e) => e.unitId);
        const allies = evs
          .filter((e) => !e.unitId.startsWith('enemy') && e.unitId !== 'h474')
          .map((e) => e.unitId);
        expect(enemies, `${st} 敌军`).toHaveLength(1);
        expect(allies, `${st} 友军`).toHaveLength(1);
        enemySet.add(enemies[0]);
        allySet.add(allies[0]);
      }
      expect(enemySet.size, '敌军四维同一人').toBe(1);
      expect(allySet.size, '友军四维同一人').toBe(1);
      enemyIds.add([...enemySet][0]);
      allyIds.add([...allySet][0]);
    }
    expect(enemyIds.size).toBeGreaterThan(1);
    expect(allyIds.size).toBeGreaterThan(1);
    expect([...allyIds].every((id) => id !== 'h474')).toBe(true);
  });
});
