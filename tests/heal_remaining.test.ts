/**
 * 剩余可入库恢复战法：重整旗鼓 / 援军秘策 / 合流 / 三军之众 / 利兵谋胜 /
 * 养精蓄锐 / 休整 / 收拢。
 * 每战法 3 个测试：装配挂槽、机制事件、数值或目标侧。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

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

/** 高攻高距先手敌军，保证第 1 回合就打出伤兵、三排都能挨打 */
function enemyTeam(): General[] {
  return (['前锋', '中军', '大营'] as Position[]).map((p) => {
    const g = dummy(
      p === '前锋' ? 'enemy-front' : p === '中军' ? 'enemy-mid' : 'enemy-back',
      p
    );
    g.attack = 220;
    g.speed = 80;
    g.attackRange = 5;
    return g;
  });
}

/**
 * 施法者放前锋：同侧距离矩阵下前锋→中军 2、前锋→大营 3，range 3 能锁满友军。
 */
function frontTeam(skillId: string, slot: 'command' | 'active'): General[] {
  const carrier = dummy('carrier', '前锋', 10000);
  carrier.attack = 80;
  carrier.defense = 90;
  carrier.strategy = 85;
  carrier.speed = 40;
  if (slot === 'command') carrier.commandSkillIds = [skillId];
  else carrier.activeSkillIds = [skillId];
  return [carrier, dummy('ally-mid', '中军', 10000), dummy('ally-back', '大营', 10000)];
}

function run(team: General[], seed = 1, maxRounds = 8) {
  return runBattle({
    seed,
    maxRounds,
    myTeam: team,
    enemyTeam: enemyTeam(),
    woundedMortality: { base: 0, perRound: 0 },
  });
}

const casts = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter((e) => e.type === 'skill_cast' && e.skillName === name);

const healed = (report: ReturnType<typeof run>, name: string) =>
  report.events.filter(
    (e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal' && e.skillName === name
  );

/** 按 round_start 把 heal 事件标上回合号 */
function healsWithRound(report: ReturnType<typeof run>, name: string): { round: number; ev: Extract<BattleEvent, { type: 'heal' }> }[] {
  let round = 0;
  const out: { round: number; ev: Extract<BattleEvent, { type: 'heal' }> }[] = [];
  for (const e of report.events) {
    if (e.type === 'round_start') round = e.round;
    if (e.type === 'heal' && e.skillName === name) out.push({ round, ev: e });
  }
  return out;
}

function runUntilCast(skillId: string, name: string, seeds = [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const s of seeds) {
    const report = run(frontTeam(skillId, 'active'), s);
    if (casts(report, name).length > 0) return report;
  }
  return run(frontTeam(skillId, 'active'), seeds[0]);
}

describe('重整旗鼓（S 一类指挥：第 5 回合起休整恢复我军群体 140%）', () => {
  it('装配：指挥槽挂入，prep 休整 startRound 5', () => {
    const t = frontTeam('chongzheng_qigu', 'command');
    expect(t[0].commandSkillIds).toContain('chongzheng_qigu');
    const s = SKILL_REGISTRY['chongzheng_qigu'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
    const rest = s.output.find((o) => o.kind === 'inflict_status');
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest' && rest.status.startRound === 5).toBe(true);
  });

  it('准备阶段释放一次并施加休整；第 5 回合前无恢复，第 5 回合起对友军恢复', () => {
    const report = run(frontTeam('chongzheng_qigu', 'command'));
    expect(casts(report, '重整旗鼓').length).toBe(1);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'rest')).toBe(true);
    const hs = healsWithRound(report, '重整旗鼓');
    expect(hs.filter((h) => h.round < 5)).toEqual([]);
    expect(hs.filter((h) => h.round >= 5).length).toBeGreaterThan(0);
    expect(hs.every((h) => !h.ev.targetId.startsWith('enemy'))).toBe(true);
  });

  it('锁定我军群体 2 目标；休整成长率 1.13', () => {
    const report = run(frontTeam('chongzheng_qigu', 'command'));
    const lock = report.events.find(
      (e): e is Extract<BattleEvent, { type: 'skill_target' }> =>
        e.type === 'skill_target' && e.skillId === 'chongzheng_qigu'
    );
    expect(lock?.targetIds.length).toBe(2);
    expect(lock?.targetIds.every((id) => !id.startsWith('enemy'))).toBe(true);
    const rest = SKILL_REGISTRY['chongzheng_qigu'].output.find((o) => o.kind === 'inflict_status');
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest' && rest.status.growthRate).toBe(1.13);
  });
});

describe('援军秘策（B 一类指挥：第 5 回合起休整恢复我军群体 103%）', () => {
  it('装配：指挥槽挂入，prep 休整 startRound 5', () => {
    expect(frontTeam('yuanjun_mice', 'command')[0].commandSkillIds).toContain('yuanjun_mice');
    const s = SKILL_REGISTRY['yuanjun_mice'];
    expect(s.type === 'command' && s.phase === 'prep').toBe(true);
  });

  it('第 5 回合前无恢复，第 5 回合起对友军恢复', () => {
    const report = run(frontTeam('yuanjun_mice', 'command'));
    expect(casts(report, '援军秘策').length).toBe(1);
    const hs = healsWithRound(report, '援军秘策');
    expect(hs.filter((h) => h.round < 5)).toEqual([]);
    expect(hs.filter((h) => h.round >= 5).length).toBeGreaterThan(0);
    expect(hs.every((h) => !h.ev.targetId.startsWith('enemy'))).toBe(true);
  });

  it('恢复率 103%、成长率 0.85', () => {
    const rest = SKILL_REGISTRY['yuanjun_mice'].output.find((o) => o.kind === 'inflict_status');
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest' && rest.status.rate).toBe(103);
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest' && rest.status.growthRate).toBe(0.85);
  });
});

describe('合流（B 主动：自身 + 友军单体恢复 131%）', () => {
  it('装配：主动槽挂入', () => {
    expect(frontTeam('heliu', 'active')[0].activeSkillIds).toContain('heliu');
  });

  it('发动后恢复自身与另一名友军（不含敌军）', () => {
    const report = runUntilCast('heliu', '合流');
    expect(casts(report, '合流').length).toBeGreaterThan(0);
    const h = healed(report, '合流');
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(h.some((e) => e.targetId === 'carrier')).toBe(true);
    expect(h.some((e) => e.targetId === 'ally-mid' || e.targetId === 'ally-back')).toBe(true);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('两段 heal 成长率均为 1.375，友军段 excludeSelf', () => {
    const heals = SKILL_REGISTRY['heliu'].output.filter((o) => o.kind === 'heal');
    expect(heals).toHaveLength(2);
    expect(heals.every((o) => o.kind === 'heal' && o.growthRate === 1.375)).toBe(true);
    const ally = heals.find((o) => o.kind === 'heal' && o.targetSide === 'ally');
    expect(ally?.kind === 'heal' && ally.excludeSelf).toBe(true);
  });
});

describe('三军之众（S 准备主动：我军单体恢复 4 次，每次独立判定）', () => {
  it('装配：主动槽挂入，1 回合准备', () => {
    expect(frontTeam('sanjun_zhizhong', 'active')[0].activeSkillIds).toContain('sanjun_zhizhong');
    const s = SKILL_REGISTRY['sanjun_zhizhong'];
    expect(s.type === 'active' && s.prepare).toBe(true);
  });

  it('发动后产生 4 次友军恢复（目标均为我军）', () => {
    const report = runUntilCast('sanjun_zhizhong', '三军之众');
    expect(casts(report, '三军之众').length).toBeGreaterThan(0);
    const h = healed(report, '三军之众');
    expect(h.length).toBeGreaterThanOrEqual(4);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('4 条 heal 输出均为 random_single，成长率 1.575', () => {
    const heals = SKILL_REGISTRY['sanjun_zhizhong'].output.filter((o) => o.kind === 'heal');
    expect(heals).toHaveLength(4);
    expect(heals.every((o) => o.kind === 'heal' && o.targetMode === 'random_single' && o.growthRate === 1.575)).toBe(
      true
    );
  });
});

describe('利兵谋胜（S 准备主动：敌军群体策略 200% + 自身及友军单体恢复 149%）', () => {
  it('装配：主动槽挂入，1 回合准备', () => {
    expect(frontTeam('libing_mousheng', 'active')[0].activeSkillIds).toContain('libing_mousheng');
    const s = SKILL_REGISTRY['libing_mousheng'];
    expect(s.type === 'active' && s.prepare).toBe(true);
    expect(s.range).toBe(4);
  });

  it('发动后对敌军造成策略伤害，并恢复自身与另一名友军', () => {
    const report = runUntilCast('libing_mousheng', '利兵谋胜');
    expect(casts(report, '利兵谋胜').length).toBeGreaterThan(0);
    const dmg = report.events.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.skillName === '利兵谋胜' && e.damageType === 'strategy'
    );
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.targetId.startsWith('enemy'))).toBe(true);
    const h = healed(report, '利兵谋胜');
    expect(h.some((e) => e.targetId === 'carrier')).toBe(true);
    expect(h.some((e) => e.targetId === 'ally-mid' || e.targetId === 'ally-back')).toBe(true);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('策略伤害成长 2.25，恢复成长 1.175', () => {
    const s = SKILL_REGISTRY['libing_mousheng'];
    const dmg = s.output.find((o) => o.kind === 'strategy_damage');
    expect(dmg?.kind === 'strategy_damage' && dmg.growthRate).toBe(2.25);
    const heals = s.output.filter((o) => o.kind === 'heal');
    expect(heals.every((o) => o.kind === 'heal' && o.growthRate === 1.175)).toBe(true);
  });
});

describe('养精蓄锐（B 准备主动：友军全体休整 2 回合）', () => {
  it('装配：主动槽挂入，1 回合准备', () => {
    expect(frontTeam('yangjing_xurui', 'active')[0].activeSkillIds).toContain('yangjing_xurui');
    const s = SKILL_REGISTRY['yangjing_xurui'];
    expect(s.type === 'active' && s.prepare).toBe(true);
  });

  it('发动后对我军施加休整，随后每回合恢复（不含敌军）', () => {
    const report = runUntilCast('yangjing_xurui', '养精蓄锐');
    expect(casts(report, '养精蓄锐').length).toBeGreaterThan(0);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'rest')).toBe(true);
    const h = healed(report, '养精蓄锐');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('休整 122%、成长 1.15、持续 2 回合', () => {
    const rest = SKILL_REGISTRY['yangjing_xurui'].output.find((o) => o.kind === 'inflict_status');
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest').toBe(true);
    if (rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest') {
      expect(rest.status.rate).toBe(122);
      expect(rest.status.growthRate).toBe(1.15);
      expect(rest.status.duration).toBe(2);
    }
  });
});

describe('休整（D 主动：友军群体 1–2 目标休整 2 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(frontTeam('xiuzheng', 'active')[0].activeSkillIds).toContain('xiuzheng');
  });

  it('发动后施加休整并对友军恢复', () => {
    const report = runUntilCast('xiuzheng', '休整');
    expect(casts(report, '休整').length).toBeGreaterThan(0);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'rest')).toBe(true);
    const h = healed(report, '休整');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('目标群体 1–2，恢复率 87%', () => {
    const s = SKILL_REGISTRY['xiuzheng'];
    expect(s.groupCount).toEqual([1, 2]);
    const rest = s.output.find((o) => o.kind === 'inflict_status');
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest' && rest.status.rate).toBe(87);
  });
});

describe('收拢（D 主动：友军单体休整 2 回合）', () => {
  it('装配：主动槽挂入', () => {
    expect(frontTeam('shoulong', 'active')[0].activeSkillIds).toContain('shoulong');
  });

  it('发动后施加休整并对友军单体恢复', () => {
    const report = runUntilCast('shoulong', '收拢');
    expect(casts(report, '收拢').length).toBeGreaterThan(0);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.statusType === 'rest')).toBe(true);
    const h = healed(report, '收拢');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => !e.targetId.startsWith('enemy'))).toBe(true);
  });

  it('单体目标，恢复率 82%', () => {
    const s = SKILL_REGISTRY['shoulong'];
    expect(s.type === 'active' && s.targetMode === 'single').toBe(true);
    const rest = s.output.find((o) => o.kind === 'inflict_status');
    expect(rest?.kind === 'inflict_status' && !Array.isArray(rest.status) && rest.status.type === 'rest' && rest.status.rate).toBe(82);
  });
});
